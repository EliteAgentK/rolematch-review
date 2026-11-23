// Durable notification delivery. A change that must be announced (today: invitation e-mails) writes an outbox row in the SAME statement that commits it, so a crash cannot lose the
// announcement. Three separate things are kept apart: the business record (the invitation and its state), the logical notification (this outbox row) and each delivery attempt
// (mail_attempts, one per SMTP try). Five retries are one notification with five attempts, never five invitations.
// Guarantees: at-least-once, bounded. A claim is a lease (a crashed dispatcher's claim is taken back after OUTBOX_LEASE_SEC); a temporary failure backs off with jitter; a permanent refusal
// ends at once; after max_attempts the message is 'dead' and counted for a person to act on; a message past its expiry is never sent late. Validity is re-checked from the database at the
// moment of sending (revoked, used, expired, replaced, inviter no longer authorised), so revoking never depends on a notification arriving. SMTP cannot promise exactly-once: an attempt
// that fails after the message was handed over is 'uncertain' and is retried (the same Message-ID, and the same single-use link, so a duplicate cannot create a second membership).
// Not built (deferred, not claimed): live push to browsers, other notification kinds (see docs/architecture/NOTIFICATIONS.md), inbound bounce reading.
import { appUrlIsLocal, config } from "./config";
import { platformSql as sql } from "./db";
import { renderInvitationEmail, renderWelcomeEmail, inlineLogo, TEMPLATE_VERSION } from "./email";
import { mailStatus, MailCancelled, MailDeferred, messageIdFor, sendMail } from "./mail";
import { MailError } from "./mail/transport";
import { inviteLinkToken } from "./portals";

type Row = { id: string; org_id: string; portal_id: string; kind: string; aggregate_id: string; version: number; attempts: number; max_attempts: number; payload?: any };
type Outcome = "accepted" | "previewed" | "skipped";
const HANDLERS: Record<string, (r: Row) => Promise<{ outcome: Outcome; note?: string }>> = { "invitation.email": sendInvitationEmail, "welcome.email": sendWelcomeEmail };
let timer: ReturnType<typeof setInterval> | null = null, active = 0, draining = false;
const outboxCounters = { accepted: 0, previewed: 0, skipped: 0, retried: 0, deferred: 0, dead: 0, expired: 0 };

async function claim(): Promise<Row | undefined> {
  if (mailStatus().state === "unavailable") return undefined;   // nothing is attempted (and no attempt is used up) while mail cannot be sent
  await sql`update outbox set status = 'expired', done_at = now(), last_error = 'expired before it could be sent' where status in ('pending', 'sending') and expires_at is not null and expires_at <= now()`;
  await sql`update portal_invitations i set email_state = 'expired' from outbox o where o.aggregate_id = i.id and o.status = 'expired' and o.kind = 'invitation.email' and i.email_state = 'queued'`;
  await sql`update mail_attempts set outcome = 'uncertain', finished_at = now(), error_class = 'attempt never finished (process stopped)' where outcome = 'attempting' and started_at < now() - (${config.mail.attemptLeaseSec} * interval '1 second')`;
  await sql`update outbox set status = 'dead', last_error = coalesce(last_error, 'lease expired after the last attempt'), done_at = now() where status = 'sending' and attempts >= max_attempts and locked_at < now() - (${config.outboxLeaseSec} * interval '1 second')`;
  const r = await sql`update outbox set status = 'sending', attempts = attempts + 1, locked_at = now()
    where id = (select id from outbox where attempts < max_attempts and (expires_at is null or expires_at > now()) and ((status = 'pending' and run_after <= now()) or (status = 'sending' and locked_at < now() - (${config.outboxLeaseSec} * interval '1 second')))
                order by priority, created_at limit 1 for update skip locked)
    returning id, org_id, portal_id, kind, aggregate_id, version, attempts, max_attempts, payload`;
  return r[0] as Row | undefined;
}

const loadInvitation = async (r: Row) => (await sql`select i.id, i.email, i.role, i.expires_at, i.invited_by, i.invited_by_email, i.token_version, i.accepted_at, i.revoked_at, p.name as portal_name, o.name as org_name,
      (exists (select 1 from portal_members pm where pm.portal_id = i.portal_id and pm.user_id = i.invited_by and pm.role = 'admin')
       or exists (select 1 from members m where m.user_id = i.invited_by and m.org_id = i.org_id and m.role = 'admin' and m.left_at is null)) as inviter_authorised
    from portal_invitations i join portals p on p.id = i.portal_id join orgs o on o.id = i.org_id where i.id = ${r.aggregate_id} and i.portal_id = ${r.portal_id}`)[0];
/** Revoked, used, expired, replaced by a resend, or the inviter lost authority since: this e-mail must not go out. */
const stillValid = (i: any, r: Row) => !!i && !i.accepted_at && !i.revoked_at && new Date(i.expires_at).getTime() > Date.now() && i.token_version === r.version && i.inviter_authorised === true;

async function sendInvitationEmail(r: Row): Promise<{ outcome: Outcome; note?: string }> {
  const i = await loadInvitation(r);
  if (!stillValid(i, r)) return { outcome: "skipped", note: !i || i.inviter_authorised !== false ? "no longer valid when its turn came" : "the person who invited no longer has authority" };
  // In live mode a link that points at this computer cannot work for anyone else, so nothing is sent. In restricted mode the approved recipients are the owner's own test addresses.
  if (mailStatus().state === "available" && appUrlIsLocal()) throw new MailError("The link is local-only: PUBLIC_APP_URL is not a real address, so no one else could open it.", "permanent");
  const link = `${config.appUrl}/accept-invite?token=${encodeURIComponent(inviteLinkToken(i.id, i.token_version))}`;   // built only from configuration, never from a request header
  const mail = renderInvitationEmail({ orgName: i.org_name, portalName: i.portal_name, inviterEmail: i.invited_by_email, role: i.role, expiresAt: new Date(i.expires_at), link, localOnly: appUrlIsLocal() });
  const sent = await sendMail({ cls: "invitation", to: i.email, subject: mail.subject, html: mail.html, text: mail.text, template: "invitation", templateVersion: TEMPLATE_VERSION, outboxId: r.id, orgId: r.org_id, portalId: r.portal_id, messageId: messageIdFor(r.id), inline: inlineLogo() },
    async () => stillValid(await loadInvitation(r), r));
  return { outcome: sent.outcome };
}

/** The welcome goes to the address the person signed up with, and only while they still belong to the organisation it was queued for (checked again just before sending). */
const loadWelcome = async (r: Row) => (await sql`select m.email, m.name, m.created_at, o.name as org_name, p.name as portal_name from members m join orgs o on o.id = m.org_id join portals p on p.id = ${r.portal_id}
    where m.user_id = ${r.aggregate_id} and m.org_id = ${r.org_id}`)[0];
async function sendWelcomeEmail(r: Row): Promise<{ outcome: Outcome; note?: string }> {
  const m = await loadWelcome(r);
  if (!m?.email) return { outcome: "skipped", note: "the person no longer belongs to this organisation" };
  if (mailStatus().state === "available" && appUrlIsLocal()) throw new MailError("The link is local-only: PUBLIC_APP_URL is not a real address, so no one else could open it.", "permanent");   // same rule as invitations
  const p = r.payload ?? {}, variant = ["admin", "member", "hiring_manager"].includes(p.variant) ? p.variant : "member";
  const inviterEmail = p.invitationId ? (await sql`select invited_by_email from portal_invitations where id = ${p.invitationId} and org_id = ${r.org_id}`)[0]?.invited_by_email : undefined;
  const mail = renderWelcomeEmail({ name: m.name ?? "", orgName: m.org_name, portalName: m.portal_name, variant, inviterEmail: inviterEmail ?? undefined, role: p.role, link: `${config.appUrl}/dashboard`, joinedAt: new Date(m.created_at ?? Date.now()), localOnly: appUrlIsLocal() });
  const sent = await sendMail({ cls: "notification", to: m.email, subject: mail.subject, html: mail.html, text: mail.text, template: "welcome", templateVersion: TEMPLATE_VERSION, outboxId: r.id, orgId: r.org_id, portalId: r.portal_id, messageId: messageIdFor(r.id), inline: inlineLogo() },
    async () => !!(await loadWelcome(r)));
  return { outcome: sent.outcome };
}

const STATE: Record<Outcome, string> = { accepted: "accepted", previewed: "previewed", skipped: "not_sent" };
async function runOne(r: Row) {
  const setInvite = (state: string, note: string | null) => r.kind === "invitation.email" ? sql`update portal_invitations set email_state = ${state}, email_attempts = ${r.attempts}, email_sent_at = ${state === "accepted" ? new Date() : null}, email_last_error = ${note} where id = ${r.aggregate_id} and token_version = ${r.version}` : Promise.resolve();
  try {
    const res = (await HANDLERS[r.kind]?.(r)) ?? { outcome: "skipped" as Outcome, note: "unknown kind" };
    await sql`update outbox set status = ${res.outcome === "accepted" ? "sent" : res.outcome}, done_at = now(), last_error = ${res.note ?? null} where id = ${r.id}`;
    await setInvite(STATE[res.outcome], res.note ?? null);
    outboxCounters[res.outcome]++;
  } catch (e: any) {
    if (e instanceof MailCancelled) {
      await sql`update outbox set status = 'skipped', done_at = now(), last_error = ${e.reason} where id = ${r.id}`;
      await setInvite("not_sent", e.reason); outboxCounters.skipped++; return;
    }
    if (e instanceof MailDeferred) {   // not a failure: the hourly allowance is used up. Keep the message, do not spend an attempt, try later.
      await sql`update outbox set status = 'pending', attempts = greatest(attempts - 1, 0), run_after = now() + (${e.retryAfterSec} * interval '1 second'), last_error = 'waiting for the hourly sending allowance' where id = ${r.id}`;
      outboxCounters.deferred++; return;
    }
    const kind = e instanceof MailError ? e.kind : "temporary";
    const note = (e instanceof MailError ? e.message : "unexpected error").slice(0, 160) + (kind === "uncertain" ? " (the outcome is uncertain: it may have been delivered)" : "");   // never the address, the link or server text
    if (kind === "unavailable") {   // our own configuration or the host: not this message's fault, so it keeps its attempts
      await sql`update outbox set status = 'pending', attempts = greatest(attempts - 1, 0), run_after = now() + interval '60 seconds', last_error = ${note} where id = ${r.id}`;
      outboxCounters.deferred++; return;
    }
    const dead = kind === "permanent" || r.attempts >= r.max_attempts, backoffSec = Math.min(900, config.outboxBackoffSec * 2 ** (r.attempts - 1)) * (0.5 + Math.random());
    await sql`update outbox set status = ${dead ? "dead" : "pending"}, last_error = ${note}, run_after = now() + (${backoffSec} * interval '1 second'), done_at = ${dead ? new Date() : null} where id = ${r.id}`;
    await setInvite(dead ? "failed" : "queued", note);
    if (dead) outboxCounters.dead++; else outboxCounters.retried++;
  }
}

/** Delivers every due message (bounded per call), most urgent class first. Safe with several dispatchers: a row is claimed by exactly one. */
async function drainOutbox(limit = 20) {
  if (draining) return;
  draining = true;
  try { for (let n = 0; n < limit; n++) { const r = await claim(); if (!r) break; active++; try { await runOne(r); } finally { active--; } } }
  catch (e: any) { console.error(JSON.stringify({ outboxError: String(e?.message ?? e).slice(0, 200) })); }
  finally { draining = false; }
}
export function startOutbox() { if (!timer) { timer = setInterval(() => void drainOutbox(), Number(process.env.OUTBOX_POLL_MS ?? 2000)); timer.unref?.(); void drainOutbox(); } }
/** Stops taking new messages; one being sent finishes (its lease protects it if the process dies first). */
export async function stopOutbox(maxMs = config.shutdownGraceMs) { if (timer) clearInterval(timer); timer = null; for (let waited = 0; waited < maxMs && active > 0; waited += 100) await new Promise((r) => setTimeout(r, 100)); }   // a send still hung at the limit is relinquished: its lease returns it to the queue
export async function outboxStats() {
  const r = (await sql`select status, count(*)::int c, extract(epoch from now() - min(created_at))::int oldest from outbox where status in ('pending','sending','dead') group by status`) as { status: string; c: number; oldest: number }[];
  const g = (s: string) => r.find((x) => x.status === s);
  return { pending: g("pending")?.c ?? 0, sending: g("sending")?.c ?? 0, dead: g("dead")?.c ?? 0, oldestUndeliveredSec: Math.max(g("pending")?.oldest ?? 0, g("sending")?.oldest ?? 0), since: outboxCounters };
}
