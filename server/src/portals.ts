// Recruitment portals (migration 019): the ownership boundary for shared recruitment work. A person works in ONE portal at a time and sees only that
// portal's data, and only if a portal_members row says they may. Organisation membership alone grants nothing. The portal for a request comes from the
// browser's x-portal-id header, but it is only a REQUEST: it is checked here against portal_members on every request, and the database then enforces it
// (db.ts forPortal sets app.portal_id for the row rules). An invitation is single-use, expires, is bound to one e-mail address, and is stored as a hash.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { audit, newId, platformSql as sql, type Q } from "./db";
import { batched } from "./lookups";
import { isUuid } from "./store";

export class PortalError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export type PortalRole = "admin" | "recruiter" | "hiring_manager";
const ROLES: PortalRole[] = ["admin", "recruiter", "hiring_manager"];
const INVITE_DAYS = 7;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
/** The link secret for an invitation at a given version: derived from the invitation and the server-side link secret (config.linkSecret), so it can be rebuilt at send time
 * (the outbox carries no secret) and a resend (version + 1) makes every earlier link useless. Only its hash is stored. */
export const inviteLinkToken = (id: string, version: number) => createHmac("sha256", config.linkSecret).update(`invitation:${id}:${version}`).digest("base64url");

// Membership is cached for a few seconds per person (like organisation membership in auth.ts). Removing someone is immediate on the server that did it and
// takes effect on every other server within the cache time.
const cache = new Map<string, { portals: Map<string, { name: string; role: PortalRole; orgId: string }>; until: number }>();
export const forgetMembership = (userId: string) => cache.delete(userId);
type Memberships = Map<string, { name: string; role: PortalRole; orgId: string }>;
const loadMemberships = batched<string, Memberships>(async (ids) => {
  const rows = await sql`select pm.user_id, p.id, p.name, p.org_id, pm.role from portal_members pm join portals p on p.id = pm.portal_id and p.org_id = pm.org_id where pm.user_id = any(${sql.array(ids)}::uuid[]) order by p.created_at`;
  const out = new Map<string, Memberships>();
  for (const r of rows as any[]) { if (!out.has(r.user_id)) out.set(r.user_id, new Map()); out.get(r.user_id)!.set(r.id, { name: r.name, role: r.role, orgId: r.org_id }); }
  return out;
}, new Map());
async function membershipOf(userId: string) {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.portals;
  const portals = await loadMemberships(userId);
  cache.set(userId, { portals, until: Date.now() + 10_000 });
  return portals;
}
export async function portalsOf(userId: string, orgId: string) {
  return [...(await membershipOf(userId))].filter(([, v]) => v.orgId === orgId).map(([id, v]) => ({ id, name: v.name, role: v.role }));
}
/** The portal this request works in: the one asked for if the person is a member of it (in their organisation), else their first portal. Null if they have none. */
export async function resolvePortal(userId: string, orgId: string, requested: string | null): Promise<{ id: string; name: string; role: PortalRole } | "denied" | null> {
  const mine = await portalsOf(userId, orgId);
  if (!mine.length) return null;
  if (requested) return isUuid(requested) ? (mine.find((p) => p.id === requested) ?? "denied") : "denied";   // never a silent fallback for a portal the person asked for and may not use
  return mine[0];
}

/** An organisation's first portal gets its first members: used when an organisation is created and when someone is added by the old routes. */
export async function ensureMainPortal(orgId: string, userId: string, role: PortalRole, q: Q = sql) {
  let p = (await q`select id from portals where org_id = ${orgId} order by created_at limit 1`)[0];
  if (!p) { p = { id: newId() }; await q`insert into portals (id, org_id, name, created_by) values (${p.id}, ${orgId}, 'Main portal', ${userId}) on conflict (org_id, name) do nothing`; p = (await q`select id from portals where org_id = ${orgId} order by created_at limit 1`)[0]; }
  await q`insert into portal_capacity (portal_id, org_id) values (${p.id}, ${orgId}) on conflict do nothing`;
  await q`insert into portal_members (portal_id, org_id, user_id, role, added_by) values (${p.id}, ${orgId}, ${userId}, ${role}, ${userId}) on conflict do nothing`;
  forgetMembership(userId);
  return p.id as string;
}

export async function createPortal(orgId: string, actor: { userId: string; email: string }, name: unknown) {
  const n = String(name ?? "").trim();
  if (n.length < 2 || n.length > 80) throw new PortalError("VAL-001", "A portal needs a name of 2 to 80 characters.");
  const id = newId();
  try { await sql`insert into portals (id, org_id, name, created_by) values (${id}, ${orgId}, ${n}, ${actor.userId})`; }
  catch (e: any) { if (e?.code === "23505") throw new PortalError("CONF-001", "This organisation already has a portal with that name.", 409); throw e; }
  await sql`insert into portal_capacity (portal_id, org_id) values (${id}, ${orgId}) on conflict do nothing`;
  await sql`insert into portal_members (portal_id, org_id, user_id, role, added_by) values (${id}, ${orgId}, ${actor.userId}, 'admin', ${actor.userId})`;
  forgetMembership(actor.userId);
  await audit(sql, orgId, actor.userId, "portal.created", "portal", id, { name: n, actorEmail: actor.email });
  return { id, name: n, role: "admin" as PortalRole };
}

// ---------------------------------------------------------------- members
// Who is in the portal: a member counts as here for six minutes after their last request (the page asks at least every five). One time per person and portal, overwritten, never a trail of movements.
// Written at most every two minutes per person: about 8 small writes a second at a thousand people, whichever server or how many tabs. The request never waits for it, and a failed write changes nothing for the person.
const PRESENCE_WRITE_MS = 2 * 60_000, lastNoted = new Map<string, number>();
export function notePresence(orgId: string, portalId: string, userId: string) {
  const key = `${portalId}:${userId}`, now = Date.now();
  if (now - (lastNoted.get(key) ?? 0) < PRESENCE_WRITE_MS) return;
  if (lastNoted.size > 50_000) lastNoted.clear();
  lastNoted.set(key, now);
  pendingSeen.set(key, { portal_id: portalId, org_id: orgId, user_id: userId });
  if (!seenTimer) { seenTimer = setTimeout(flushSeen, SEEN_FLUSH_MS); seenTimer.unref?.(); }
}
// Everyone seen in the last few seconds goes in one statement, so a crowd costs one write, not one each (experiment X4).
const SEEN_FLUSH_MS = 5_000, pendingSeen = new Map<string, { portal_id: string; org_id: string; user_id: string }>();
let seenTimer: ReturnType<typeof setTimeout> | null = null;
function flushSeen() {
  seenTimer = null;
  const rows = [...pendingSeen.entries()]; pendingSeen.clear();
  if (!rows.length) return;
  sql`update portal_members pm set last_seen_at = now() from jsonb_to_recordset(${sql.json(rows.map(([, r]) => r) as any)}) as seen(portal_id uuid, org_id uuid, user_id uuid)
      where pm.portal_id = seen.portal_id and pm.org_id = seen.org_id and pm.user_id = seen.user_id and (pm.last_seen_at is null or pm.last_seen_at < now() - interval '2 minutes')`
    .then(() => {}, () => { for (const [key] of rows) lastNoted.delete(key); });
}

export async function listMembers(orgId: string, portalId: string) {
  const members = await sql`select pm.user_id, m.email, m.name, pm.role, pm.created_at, pm.last_seen_at, coalesce(pm.last_seen_at > now() - interval '6 minutes', false) as here_now from portal_members pm join members m on m.user_id = pm.user_id where pm.portal_id = ${portalId} and pm.org_id = ${orgId} order by m.email`;
  const invitations = await sql`select id, email, role, invited_by_email, created_at, expires_at, accepted_at, revoked_at, email_state, email_attempts, email_sent_at, resend_count from portal_invitations where portal_id = ${portalId} and org_id = ${orgId} order by created_at desc limit 100`;
  const now = Date.now();
  return {
    members: members.map((m: any) => ({ userId: m.user_id, email: m.email, name: (m.name ?? "") as string, role: m.role, since: new Date(m.created_at).toISOString(), lastSeen: m.last_seen_at ? new Date(m.last_seen_at).toISOString() : null, hereNow: m.here_now as boolean })),
    invitations: invitations.map((i: any) => ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invited_by_email, createdAt: new Date(i.created_at).toISOString(), expiresAt: new Date(i.expires_at).toISOString(),
      emailState: i.email_state, emailAttempts: i.email_attempts, emailSentAt: i.email_sent_at ? new Date(i.email_sent_at).toISOString() : null, resends: i.resend_count,
      status: i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at).getTime() < now ? "expired" : "pending" })),
  };
}

export async function removeMember(orgId: string, portalId: string, actor: { userId: string; email: string }, userId: string) {
  if (!isUuid(userId)) throw new PortalError("RES-001", "Member not found.", 404);
  // One transaction, under the portal row's lock, like every other change that can take away a portal's last administrator (team.ts): without it, two
  // administrators removing each other at the same moment both saw two administrators and left the portal with none, and a failure part-way could lose
  // the audit line (code review, 16 Nov 2026, A-M5).
  await sql.begin(async (q) => {
    await q`select id from portals where id = ${portalId} and org_id = ${orgId} for update`;
    const admins = await q`select user_id from portal_members where portal_id = ${portalId} and org_id = ${orgId} and role = 'admin'`;
    if (admins.length === 1 && admins[0].user_id === userId) throw new PortalError("CONF-001", "A portal needs at least one administrator. Make someone else an administrator first.", 409);
    const r = await q`delete from portal_members where portal_id = ${portalId} and org_id = ${orgId} and user_id = ${userId} returning user_id`;
    if (!r.length) throw new PortalError("RES-001", "Member not found.", 404);
    // The person can no longer send files, so any batch of theirs still waiting for files is treated as an abandoned transfer: files already admitted keep processing, and
    // the reservation is released by the usual rule once the last of them has an end state (reconcileReservations picks it up).
    await q`update upload_batches set last_activity_at = now() - interval '1 day' where portal_id = ${portalId} and org_id = ${orgId} and created_by = ${userId} and reservation_state = 'held'`;
    await audit(q, orgId, actor.userId, "portal.member_removed", "portal", portalId, { removed: userId, actorEmail: actor.email });
  });
  forgetMembership(userId);   // takes effect at once on this server; on others within the cache time
  return { ok: true };
}

// ---------------------------------------------------------------- invitations
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** Creates one invitation per address. The token is returned ONCE here (to be sent to that address); only its hash is stored, and it is never logged. */
export async function invite(orgId: string, portalId: string, actor: { userId: string; email: string }, emails: unknown, role: unknown) {
  const list = [...new Set((Array.isArray(emails) ? emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!list.length || list.length > 50) throw new PortalError("VAL-001", "Give between 1 and 50 e-mail addresses.");
  if (role !== undefined && !ROLES.includes(role as PortalRole)) throw new PortalError("VAL-001", "Choose administrator, recruiter or hiring manager.");   // never guess: an unknown role must not quietly become more access than was meant
  const r = (role ?? "recruiter") as PortalRole;
  const out: { email: string; status: "invited" | "already_member" | "invalid" | "already_invited"; token?: string; id?: string }[] = [];
  for (const email of list) {
    if (!EMAIL.test(email) || email.length > 160) { out.push({ email, status: "invalid" }); continue; }
    if ((await sql`select 1 from portal_members pm join members m on m.user_id = pm.user_id where pm.portal_id = ${portalId} and lower(m.email) = ${email}`).length) { out.push({ email, status: "already_member" }); continue; }
    const id = newId(), token = inviteLinkToken(id, 1);
    try {
      // One statement: the invitation and its e-mail event commit together or not at all.
      await sql`with i as (insert into portal_invitations (id, org_id, portal_id, email, role, token_hash, invited_by, invited_by_email, expires_at, token_version, email_state)
                  values (${id}, ${orgId}, ${portalId}, ${email}, ${r}, ${hashToken(token)}, ${actor.userId}, ${actor.email}, now() + (${INVITE_DAYS} * interval '1 day'), 1, 'queued') returning id)
                insert into outbox (id, org_id, portal_id, kind, class, priority, aggregate_id, version, dedupe_key, expires_at) select ${newId()}, ${orgId}, ${portalId}, 'invitation.email', 'invitation', 1, i.id, 1, ${`invitation.email:${id}:1`}, now() + (${INVITE_DAYS} * interval '1 day') from i`;
    } catch (e: any) { if (e?.code === "23505") { out.push({ email, status: "already_invited" }); continue; } throw e; }
    await audit(sql, orgId, actor.userId, "portal.invited", "portal", portalId, { invitation: id, role: r, actorEmail: actor.email });   // the address is not repeated in the audit detail
    out.push({ email, status: "invited", token, id });
  }
  return out;
}
export async function revokeInvitation(orgId: string, portalId: string, actor: { userId: string; email: string }, id: string) {
  if (!isUuid(id)) throw new PortalError("RES-001", "Invitation not found.", 404);
  const r = await sql`update portal_invitations set revoked_at = now() where id = ${id} and portal_id = ${portalId} and org_id = ${orgId} and accepted_at is null and revoked_at is null returning id`;
  if (!r.length) throw new PortalError("RES-001", "Invitation not found, or it was already used or revoked.", 404);
  await audit(sql, orgId, actor.userId, "portal.invitation_revoked", "portal", portalId, { invitation: id, actorEmail: actor.email });
  return { ok: true };
}
/** A new token for a pending invitation; the old link stops working. */
export async function resendInvitation(orgId: string, portalId: string, actor: { userId: string; email: string }, id: string) {
  if (!isUuid(id)) throw new PortalError("RES-001", "Invitation not found.", 404);
  const cur = (await sql`select token_version from portal_invitations where id = ${id} and portal_id = ${portalId} and org_id = ${orgId} and accepted_at is null and revoked_at is null`)[0];
  if (!cur) throw new PortalError("RES-001", "Invitation not found, or it was already used or revoked.", 404);
  const v = cur.token_version + 1, token = inviteLinkToken(id, v);
  // Compare-and-set on the version: two resends at once cannot both win, and the earlier link stops working in the same statement that queues the new e-mail.
  const r = await sql`with u as (update portal_invitations set token_version = ${v}, token_hash = ${hashToken(token)}, expires_at = now() + (${INVITE_DAYS} * interval '1 day'), email_state = 'queued', email_last_error = null, email_attempts = 0, resend_count = resend_count + 1
                where id = ${id} and portal_id = ${portalId} and org_id = ${orgId} and accepted_at is null and revoked_at is null and token_version = ${cur.token_version} returning id, email),
                o as (insert into outbox (id, org_id, portal_id, kind, class, priority, aggregate_id, version, dedupe_key, expires_at) select ${newId()}, ${orgId}, ${portalId}, 'invitation.email', 'invitation', 1, u.id, ${v}, ${`invitation.email:${id}:${v}`}, now() + (${INVITE_DAYS} * interval '1 day') from u)
              select email from u`;
  if (!r.length) throw new PortalError("CONF-001", "This invitation was changed by someone else at the same moment. Check its status and try again.", 409);
  await audit(sql, orgId, actor.userId, "portal.invitation_resent", "portal", portalId, { invitation: id, actorEmail: actor.email, linkVersion: v });
  return { email: r[0].email as string, token };
}

/** What a link is for, without redeeming it: used before sign-up so the page can say which portal and address. Reveals nothing for a bad link. */
export async function lookupInvitation(token: string) {
  const i = (await sql`select i.id, i.org_id, i.portal_id, i.email, i.role, i.expires_at, i.invited_by_email, i.accepted_at, i.revoked_at, p.name as portal_name, o.name as org_name from portal_invitations i join portals p on p.id = i.portal_id join orgs o on o.id = i.org_id where i.token_hash = ${hashToken(String(token ?? ""))}`)[0];
  if (!i || i.accepted_at || i.revoked_at || new Date(i.expires_at).getTime() < Date.now()) return null;
  return { id: i.id as string, orgId: i.org_id as string, portalId: i.portal_id as string, email: i.email as string, role: i.role as PortalRole, portalName: i.portal_name as string, orgName: i.org_name as string, inviterEmail: i.invited_by_email as string, expiresAt: new Date(i.expires_at).toISOString() };
}
/** Redeems an invitation for a person who is signed in as the invited address, in the invited organisation. Any other account gets the same refusal as a bad link. */
export async function acceptInvitation(session: { userId: string; orgId: string; email: string }, token: string) {
  const inv = await lookupInvitation(token);
  if (!inv) throw new PortalError("RES-001", "This invitation is not valid. It may have expired, been used, or been withdrawn. Ask for a new one.", 404);
  // The link holder already knows which address it was made for, so the mismatch can be explained; nothing about the portal's records is revealed.
  if (inv.email !== session.email.toLowerCase()) throw new PortalError("INVITE-MISMATCH", "This invitation was sent to a different e-mail address than the one you are signed in with. Sign out and sign in with the invited address, or ask for an invitation to this one.", 403);
  if (inv.orgId !== session.orgId) throw new PortalError("INVITE-OTHER-ORG", "This account already belongs to another organisation, and an account can belong to only one. Ask your RoleMatch administrator, or the person who invited you, how to continue; nothing has been changed.", 409);
  return redeem(inv, session.userId, session.email);
}
/** Single use, decided in the database: the update only succeeds for a pending, unexpired invitation. */
export async function redeem(inv: { id: string; orgId: string; portalId: string; role: PortalRole; email: string }, userId: string, email: string, q: Q = sql) {
  // Authority is re-checked at the moment of acceptance: an invitation from someone who has since lost the right to invite (removed, demoted) grants nothing.
  const used = await q`update portal_invitations set accepted_at = now(), accepted_by = ${userId} where id = ${inv.id} and accepted_at is null and revoked_at is null and expires_at > now()
    and (exists (select 1 from portal_members pm where pm.portal_id = portal_invitations.portal_id and pm.user_id = portal_invitations.invited_by and pm.role = 'admin')
      or exists (select 1 from members m where m.user_id = portal_invitations.invited_by and m.org_id = portal_invitations.org_id and m.role = 'admin' and m.left_at is null)) returning id`;
  if (!used.length) {
    const why = (await q`select accepted_at, revoked_at, expires_at from portal_invitations where id = ${inv.id}`)[0];
    if (why && !why.accepted_at && !why.revoked_at && new Date(why.expires_at).getTime() > Date.now()) throw new PortalError("INVITE-INVALIDATED", "The person who invited you no longer has permission to invite to this portal, so this invitation can no longer be used. Ask a current administrator to invite you again.", 409);
    throw new PortalError("RES-001", "This invitation is not valid for this account.", 404);
  }
  await q`insert into portal_members (portal_id, org_id, user_id, role, added_by) values (${inv.portalId}, ${inv.orgId}, ${userId}, ${inv.role}, ${userId}) on conflict do nothing`;
  forgetMembership(userId);
  await audit(q, inv.orgId, userId, "portal.invitation_accepted", "portal", inv.portalId, { invitation: inv.id, actorEmail: email });
  return { portalId: inv.portalId };
}
