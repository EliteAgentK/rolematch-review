// People and their access, beyond inviting (portals.ts): role changes, leaving a portal or the organisation, removing someone from the organisation,
// an organisation administrator's recovery route for a portal, and the organisation's list of people.
//
// Rules (docs/product/COLLABORATION.md):
//  * A portal always keeps at least one administrator; an organisation always keeps at least one organisation administrator. Every change that could
//    remove the last one is checked under a lock (the portal row, or the organisation row), so two administrators demoting each other at the same moment
//    cannot both succeed. Anything that can take away a portal administrator (a role change, leaving or removal from the portal, leaving or removal from
//    the organisation) holds that portal's row.
//  * Leaving or being removed revokes future access at once on this server (caches dropped) and within the cache time on others. Records stay: candidates,
//    jobs, documents, notes and their attribution belong to the portal, not to the person. Batches the person was still sending are treated as abandoned
//    transfers (files already admitted keep processing and the reservation is released by the usual rule); nothing is cancelled.
//  * Leaving the organisation never grants anything elsewhere: the sign-in identity remains, with no organisation, and sign-in recovery will not create a
//    new organisation for it. The membership row is marked (left_at, migration 023), never deleted: records refer to it for attribution.
import { forgetMember, isAdminNow, type Session } from "./auth";
import { audit, platformSql as sql, type Q } from "./db";
import { forgetMembership, PortalError, type PortalRole } from "./portals";
import { isUuid } from "./store";

const ROLES: PortalRole[] = ["admin", "recruiter", "hiring_manager"];
type Actor = { userId: string; email: string };

/** Marks a person's batches that are still waiting for files as abandoned, so their reservation is released by the usual rule; nothing is cancelled. */
const abandonOpenTransfers = (q: Q, orgId: string, userId: string, portalId: string | null) =>
  q`update upload_batches set last_activity_at = now() - interval '1 day' where org_id = ${orgId} and created_by = ${userId} and reservation_state = 'held' and (${portalId}::uuid is null or portal_id = ${portalId})`;

/** Changes a member's role in this portal. Refused if it would leave the portal with no administrator. */
export async function setMemberRole(orgId: string, portalId: string, actor: Actor, userId: string, role: unknown) {
  if (!isUuid(userId)) throw new PortalError("RES-001", "Member not found.", 404);
  if (!ROLES.includes(role as PortalRole)) throw new PortalError("VAL-001", "Choose administrator, recruiter or hiring manager.");
  const out = await sql.begin(async (q) => {
    await q`select id from portals where id = ${portalId} and org_id = ${orgId} for update`;   // one membership change per portal at a time
    const cur = (await q`select role from portal_members where portal_id = ${portalId} and org_id = ${orgId} and user_id = ${userId}`)[0];
    if (!cur) throw new PortalError("RES-001", "Member not found.", 404);
    if (cur.role === role) return { from: cur.role as string, changed: false };
    if (cur.role === "admin") {
      const [{ n }] = await q`select count(*)::int n from portal_members where portal_id = ${portalId} and org_id = ${orgId} and role = 'admin'`;
      if (n <= 1) throw new PortalError("LAST-ADMIN", "This is the portal's only administrator. Make someone else an administrator first.", 409);
    }
    await q`update portal_members set role = ${role as string} where portal_id = ${portalId} and org_id = ${orgId} and user_id = ${userId}`;
    await audit(q, orgId, actor.userId, "portal.member_role_changed", "portal", portalId, { member: userId, from: cur.role, to: role, actorEmail: actor.email });
    return { from: cur.role as string, changed: true };
  });
  forgetMembership(userId);
  return { role: role as PortalRole, ...out };
}

/** The person leaves the portal they are working in. The last administrator cannot leave until someone else is an administrator. */
export async function leavePortal(s: Session) {
  await sql.begin(async (q) => {
    await q`select id from portals where id = ${s.portalId!} and org_id = ${s.orgId} for update`;
    const admins = await q`select user_id from portal_members where portal_id = ${s.portalId!} and org_id = ${s.orgId} and role = 'admin'`;
    if (admins.length === 1 && admins[0].user_id === s.userId) throw new PortalError("LAST-ADMIN", `You are the only administrator of ${s.portalName}. Make someone else an administrator first, then leave.`, 409);
    const r = await q`delete from portal_members where portal_id = ${s.portalId!} and org_id = ${s.orgId} and user_id = ${s.userId} returning user_id`;
    if (!r.length) throw new PortalError("RES-001", "You are not a member of this portal.", 404);
    await abandonOpenTransfers(q, s.orgId, s.userId, s.portalId!);
    await audit(q, s.orgId, s.userId, "portal.member_left", "portal", s.portalId!, { actorEmail: s.email });
  });
  forgetMembership(s.userId);
  return { ok: true };
}

/** Takes a person out of the organisation: every portal membership and the organisation membership. By themselves (leaving) or by an organisation
 * administrator (removal). Refused if it would leave the organisation with no administrator or any portal with no administrator. */
export async function leaveOrganisation(orgId: string, actor: Actor, userId: string) {
  if (!isUuid(userId)) throw new PortalError("RES-001", "Member not found.", 404);
  const self = actor.userId === userId;
  if (!self && !(await isAdminNow(actor.userId, orgId))) throw new PortalError("PERM-001", "Only an organisation administrator can remove someone from the organisation.", 403);
  await sql.begin(async (q) => {
    await q`select id from orgs where id = ${orgId} for update`;   // one organisation-membership change at a time
    const m = (await q`select role, email from members where user_id = ${userId} and org_id = ${orgId} and left_at is null`)[0];
    if (!m) throw new PortalError("RES-001", "Member not found.", 404);
    // Every portal the person is in is locked too (in one order, so two of these never deadlock): role changes, leaving a portal and removal from a
    // portal lock only the portal row, so with the organisation row alone this check did not wait for them, and a portal could lose its last
    // administrator to a demotion made at the same moment (code review, 16 Nov 2026, A-M5).
    await q`select p.id from portals p where p.org_id = ${orgId} and exists (select 1 from portal_members pm where pm.portal_id = p.id and pm.user_id = ${userId}) order by p.id for update of p`;
    if (m.role === "admin") {
      const [{ n }] = await q`select count(*)::int n from members where org_id = ${orgId} and role = 'admin' and left_at is null`;
      if (n <= 1) throw new PortalError("LAST-ADMIN", self ? "You are the organisation's only administrator. Make someone else an organisation administrator first." : "This is the organisation's only administrator.", 409);
    }
    const sole = await q`select p.name from portal_members pm join portals p on p.id = pm.portal_id and p.org_id = pm.org_id
                         where pm.org_id = ${orgId} and pm.user_id = ${userId} and pm.role = 'admin'
                           and not exists (select 1 from portal_members o where o.portal_id = pm.portal_id and o.role = 'admin' and o.user_id <> ${userId})`;
    if (sole.length) throw new PortalError("LAST-ADMIN", `${self ? "You are" : "This person is"} the only administrator of ${sole.map((p: any) => p.name).join(", ")}. Make someone else an administrator there first.`, 409);
    await q`delete from portal_members where org_id = ${orgId} and user_id = ${userId}`;
    await q`update members set left_at = now(), can_create_portals = false where org_id = ${orgId} and user_id = ${userId}`;   // kept for attribution, no longer a member
    await abandonOpenTransfers(q, orgId, userId, null);
    await audit(q, orgId, actor.userId, self ? "org.member_left" : "org.member_removed", "user", userId, { actorEmail: actor.email, member: userId });
  });
  forgetMembership(userId); forgetMember(userId);
  return { ok: true };
}

/** Recovery: an organisation administrator makes an organisation member an administrator of any portal of the organisation (adding them if needed),
 * for example when a portal's administrators have all gone. Grants membership only; it shows nothing of the portal's records to the administrator who did it. */
export async function appointPortalAdmin(orgId: string, actor: Actor, portalId: string, userId: string) {
  if (!isUuid(portalId) || !isUuid(userId)) throw new PortalError("RES-001", "Portal or member not found.", 404);
  if (!(await isAdminNow(actor.userId, orgId))) throw new PortalError("PERM-001", "Only an organisation administrator can appoint a portal administrator.", 403);
  await sql.begin(async (q) => {
    const p = (await q`select id from portals where id = ${portalId} and org_id = ${orgId} for update`)[0];
    const m = (await q`select 1 from members where user_id = ${userId} and org_id = ${orgId} and left_at is null`)[0];
    if (!p || !m) throw new PortalError("RES-001", "Portal or member not found.", 404);
    const before = (await q`select role from portal_members where portal_id = ${portalId} and user_id = ${userId}`)[0]?.role ?? null;
    await q`insert into portal_members (portal_id, org_id, user_id, role, added_by) values (${portalId}, ${orgId}, ${userId}, 'admin', ${actor.userId})
            on conflict (portal_id, user_id) do update set role = 'admin'`;
    await audit(q, orgId, actor.userId, "portal.admin_appointed", "portal", portalId, { member: userId, from: before, actorEmail: actor.email });
  });
  forgetMembership(userId);
  return { ok: true };
}

/** The organisation and its people, for its administrators: name as entered, e-mail, organisation role, and each portal with the role in it.
 * Portals come with member counts only, never their records. */
export async function organisationPeople(orgId: string, viewer: Actor) {
  if (!(await isAdminNow(viewer.userId, orgId))) throw new PortalError("PERM-001", "Only an organisation administrator can see everyone in the organisation.", 403);
  const [org] = await sql`select name, created_at from orgs where id = ${orgId}`;
  const people = await sql`select m.user_id, m.name, m.email, m.role, m.can_create_portals, m.created_at from members m where m.org_id = ${orgId} and m.left_at is null order by lower(m.name), m.email`;
  const access = await sql`select pm.user_id, pm.role, p.id, p.name from portal_members pm join portals p on p.id = pm.portal_id and p.org_id = pm.org_id where pm.org_id = ${orgId} order by p.created_at`;
  const portals = await sql`select p.id, p.name, p.created_at, (select count(*)::int from portal_members x where x.portal_id = p.id) as members,
                              (select count(*)::int from portal_members x where x.portal_id = p.id and x.role = 'admin') as admins
                            from portals p where p.org_id = ${orgId} order by p.created_at`;
  return {
    organisation: { name: org.name as string, since: new Date(org.created_at).toISOString() },
    portals: portals.map((p: any) => ({ id: p.id as string, name: p.name as string, members: p.members as number, admins: p.admins as number })),
    people: people.map((p: any) => ({
      userId: p.user_id as string, name: (p.name ?? "") as string, email: (p.email ?? "") as string, orgRole: p.role as string, canCreatePortals: p.role === "admin" || p.can_create_portals === true,
      since: new Date(p.created_at).toISOString(),
      portals: access.filter((a: any) => a.user_id === p.user_id).map((a: any) => ({ id: a.id as string, name: a.name as string, role: a.role as PortalRole })),
    })),
  };
}
