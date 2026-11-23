// The shared sending path for every RoleMatch message: policy checks, quota with reserved headroom for authentication mail, suppression, one attempt record per
// SMTP attempt, and honest outcomes. Callers (verification codes, the invitation outbox) never talk to SMTP themselves.
// Outcome vocabulary: "accepted" = the mail server took the message (NOT inbox delivery); "previewed" = written to a file, nothing sent; failures are typed (see MailError).
import { createHmac } from "node:crypto";
import { appUrlIsLocal, config } from "../config";
import { newId, platformSql as sql } from "../db";
import { MailError, transport, type MailMessage } from "./transport";

type MailClass = "authentication" | "invitation" | "notification";   // notification: account news (the welcome e-mail); never ahead of a code or an invitation
/** Thrown when the message stopped being valid between being claimed and being handed to the mail server (checked as the very last step). */
export class MailCancelled extends Error { constructor(public reason: string) { super(reason); } }
export class MailDeferred extends Error { constructor(public retryAfterSec: number) { super("deferred by the sending allowance"); } }

/** One Message-ID per logical message: a retry of the same message carries the same ID, which lets mail systems recognise a duplicate after an uncertain send. */
export const messageIdFor = (id: string) => `<${id}@${senderDomain()}>`;

/** "sending": off = nothing can leave; restricted = only approved test recipients; live = anyone. Contains no credential and no address. */
export function mailStatus() {
  const t = transport("authentication"), r = t?.ready() ?? { ok: false, reason: "No mail transport is configured (set MAIL_TRANSPORT)." };
  const off = !t || !r.ok || (!t.simulated && config.mail.sendMode === "off");
  const state = off ? "unavailable" : t!.simulated ? "preview" : config.mail.sendMode === "live" ? "available" : "restricted";
  const reason = !t || !r.ok ? r.reason : off ? "Sending is switched off (MAIL_SEND_MODE=off)." : state === "preview" ? "Preview only: messages are written to files and nothing is sent." : state === "restricted" ? `Restricted: real mail goes only to ${config.mail.allowedRecipients.length} approved test recipient(s).` : undefined;
  return { state: state as "available" | "restricted" | "preview" | "unavailable", sending: (off ? "off" : state === "available" ? "live" : "restricted") as "off" | "restricted" | "live", transport: t?.name ?? "none", reason,
    sender: config.mail.from, appUrl: config.appUrl, appUrlLocalOnly: appUrlIsLocal(), allowedRecipientCount: config.mail.allowedRecipients.length, maxPerHour: config.mail.maxPerHour, reservedForAuthentication: config.mail.reservedForAuthPerHour };
}
/** Whether this address may receive REAL mail from this server right now. Applies to every kind of message; simulated transports are not restricted. */
/** On an approved list, an entry is an exact address, or "name+*@domain" for one mailbox's tagged addresses (how automated checks get a fresh address per run). */
export const onList = (list: string[], address: string) => { const a = address.trim().toLowerCase(); return list.some((e) => { const star = e.indexOf("+*@"); return star < 0 ? e === a : a.startsWith(e.slice(0, star + 1)) && a.endsWith(e.slice(star + 2)) && a.length > e.length - 1; }); };
export const recipientAllowed = (to: string) => config.mail.sendMode === "live" || onList(config.mail.allowedRecipients, to);

const norm = (e: string) => e.trim().toLowerCase();
/** @public test/move-settings.test.ts loads this module afresh by name, which Knip cannot follow. */
export const recipientHash = (e: string) => createHmac("sha256", config.linkSecret).update(norm(e)).digest("hex");   // keyed: a leaked table cannot be matched against a list of addresses
const domainOf = (e: string) => norm(e).split("@")[1] ?? "";
const senderDomain = () => (config.mail.from.match(/@([^>\s]+)/)?.[1] ?? "localhost");

async function isSuppressed(to: string) {
  return (await sql`select 1 from mail_suppressions where recipient_hash = ${recipientHash(to)} and expires_at > now()`).length > 0;
}

/** Reserves one send against the rolling hour, atomically across every server and worker (an advisory lock around count-and-insert). Authentication mail may use the
 * reserved headroom; other classes stop earlier, so a flood of invitations can never make a verification code wait for quota. */
async function reserve(a: { id: string; cls: MailClass; to: string; template: string; templateVersion: string; outboxId?: string; orgId?: string; portalId?: string; transportName: string; simulated: boolean }) {
  const limit = a.cls === "authentication" ? config.mail.maxPerHour : Math.max(0, config.mail.maxPerHour - config.mail.reservedForAuthPerHour);
  return sql.begin(async (tx: any) => {
    await tx`select pg_advisory_xact_lock(hashtext('rolematch.mail.quota'))`;
    if (!a.simulated) {
      const used = (await tx`select count(*)::int c from mail_attempts where simulated = false and outcome in ('attempting', 'accepted', 'uncertain') and started_at > now() - interval '1 hour'`)[0].c;
      if (used >= limit) return false;
    }
    await tx`insert into mail_attempts (id, outbox_id, org_id, portal_id, class, template, template_version, transport, simulated, recipient_hash, recipient_domain)
             values (${a.id}, ${a.outboxId ?? null}, ${a.orgId ?? null}, ${a.portalId ?? null}, ${a.cls}, ${a.template}, ${a.templateVersion}, ${a.transportName}, ${a.simulated}, ${recipientHash(a.to)}, ${domainOf(a.to)})`;
    return true;
  }) as Promise<boolean>;
}

export interface Outgoing { cls: MailClass; to: string; subject: string; html: string; text: string; template: string; templateVersion: string; outboxId?: string; orgId?: string; portalId?: string; messageId?: string; inline?: MailMessage["inline"] }
/** Sends one message through the configured transport and records exactly what happened. Throws MailError (typed) or MailDeferred. */
export async function sendMail(o: Outgoing, beforeSend?: () => Promise<boolean>): Promise<{ outcome: "accepted" | "previewed"; response: string; attemptId: string }> {
  const t = transport(o.cls); const st = mailStatus();
  if (!t || st.state === "unavailable") throw new MailError(st.reason ?? "Mail is unavailable.", "unavailable");
  if (!t.simulated && !recipientAllowed(o.to)) {   // default deny, before anything else: not on the approved list means nothing is attempted, whatever the kind of message
    await sql`insert into mail_attempts (id, outbox_id, org_id, portal_id, class, template, template_version, transport, simulated, recipient_hash, recipient_domain, outcome, finished_at, error_class) values (${newId()}, ${o.outboxId ?? null}, ${o.orgId ?? null}, ${o.portalId ?? null}, ${o.cls}, ${o.template}, ${o.templateVersion}, ${t.name}, false, ${recipientHash(o.to)}, ${domainOf(o.to)}, 'blocked', now(), 'not on the approved recipient list')`;
    throw new MailError("This server may send real mail only to approved test recipients, and this address is not one of them.", "permanent", undefined, undefined, true);
  }
  if (await isSuppressed(o.to)) { await sql`insert into mail_attempts (id, outbox_id, org_id, portal_id, class, template, template_version, transport, simulated, recipient_hash, recipient_domain, outcome, finished_at, error_class) values (${newId()}, ${o.outboxId ?? null}, ${o.orgId ?? null}, ${o.portalId ?? null}, ${o.cls}, ${o.template}, ${o.templateVersion}, ${t.name}, ${t.simulated}, ${recipientHash(o.to)}, ${domainOf(o.to)}, 'suppressed', now(), 'suppressed')`; throw new MailError("This address recently refused mail permanently, so nothing was sent.", "permanent"); }
  const attemptId = newId();
  if (!(await reserve({ id: attemptId, cls: o.cls, to: o.to, template: o.template, templateVersion: o.templateVersion, outboxId: o.outboxId, orgId: o.orgId, portalId: o.portalId, transportName: t.name, simulated: t.simulated }))) throw new MailDeferred(60 + Math.floor(Math.random() * 30));
  const messageId = o.messageId ?? `<${newId()}@${senderDomain()}>`;
  // The last look before the message leaves: quota and suppression checks above take database round trips, and a revocation can land in between.
  if (beforeSend && !(await beforeSend())) { await sql`update mail_attempts set outcome = 'cancelled', finished_at = now(), error_class = 'no longer valid just before sending' where id = ${attemptId}`; throw new MailCancelled("no longer valid when it was about to be sent"); }
  try {
    const r = await t.send({ to: o.to, from: config.mail.from, replyTo: config.mail.replyTo || undefined, envelopeFrom: config.mail.bounceAddress || undefined, subject: o.subject, html: o.html, text: o.text, messageId, inline: o.inline });
    const outcome = t.simulated ? "previewed" : "accepted";
    await sql`update mail_attempts set outcome = ${t.simulated ? "accepted" : "accepted"}, finished_at = now(), message_id = ${messageId}, response = ${r.response} where id = ${attemptId}`;
    return { outcome, response: r.response, attemptId };
  } catch (e: any) {
    const err = e instanceof MailError ? e : new MailError("The message could not be handed to the mail server.", "temporary");
    const outcome = err.kind === "permanent" ? "permanent_failure" : err.kind === "uncertain" ? "uncertain" : err.kind === "unavailable" ? "unavailable" : "temporary_failure";
    await sql`update mail_attempts set outcome = ${outcome}, finished_at = now(), smtp_code = ${err.smtpCode ?? null}, error_class = ${err.message.slice(0, 80)}, message_id = ${messageId} where id = ${attemptId}`.catch(() => {});
    // Only an address-level refusal is remembered: 550 5.1.x "no such user" style codes. Content, policy or reputation refusals say nothing about the address.
    if (err.kind === "permanent" && (err.enhanced?.startsWith("5.1.") || err.smtpCode === 550 && !err.enhanced)) await sql`insert into mail_suppressions (recipient_hash, reason, enhanced_status, expires_at) values (${recipientHash(o.to)}, 'permanent refusal', ${err.enhanced ?? null}, now() + (${config.mail.suppressionDays} * interval '1 day')) on conflict (recipient_hash) do update set expires_at = excluded.expires_at, enhanced_status = excluded.enhanced_status`.catch(() => {});
    throw err;
  }
}

/** Sending health for operators (no addresses, no content, no codes): counts and acceptance times by class over the last hour. "Accepted" means the mail server took the message. */
export async function mailMetrics() {
  const a = (await sql`select outcome, class, count(*)::int c from mail_attempts where started_at > now() - interval '1 hour' group by outcome, class`) as { outcome: string; class: string; c: number }[];
  const lat = (await sql`select class, count(*)::int n, percentile_cont(0.5) within group (order by extract(epoch from finished_at - started_at))::float p50, percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at))::float p95, percentile_cont(0.99) within group (order by extract(epoch from finished_at - started_at))::float p99
    from mail_attempts where outcome = 'accepted' and simulated = false and finished_at is not null and started_at > now() - interval '1 hour' group by class`) as { class: string; n: number; p50: number; p95: number; p99: number }[];
  const used = a.filter((x) => ["attempting", "accepted", "uncertain"].includes(x.outcome)).reduce((n, x) => n + x.c, 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { lastHour: a, usedOfAllowance: `${used} of ${config.mail.maxPerHour}`, acceptanceSeconds: Object.fromEntries(lat.map((l) => [l.class, { n: l.n, p50: r2(l.p50), p95: r2(l.p95), p99: r2(l.p99) }])),
    timeoutsOrUncertain: a.filter((x) => x.outcome === "uncertain").reduce((n, x) => n + x.c, 0), failures: a.filter((x) => ["temporary_failure", "permanent_failure", "unavailable"].includes(x.outcome)).reduce((n, x) => n + x.c, 0) };
}
