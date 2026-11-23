// Run by tenant-separation.test.ts against a throw-away schema. Asks the database, through the server's own db.ts, deliberately careless
// questions (no "where org_id") as one organisation, and prints what came back. One connection only, so every query reuses the same one.
import { asSystem, forOrg, forPortal, platformSql, sql } from "../../src/db";

const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
await sql`insert into orgs (id, name) values (${a}, 'Probe A'), (${b}, 'Probe B')`;
await sql`insert into audit_events (org_id, action, entity_type) values (${a}, 'probe', 'probe'), (${b}, 'probe', 'probe'), (${b}, 'probe', 'probe')`;
const [pa, pa2, pb] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
await sql`insert into portals (id, org_id, name) values (${pa}, ${a}, 'P1'), (${pa2}, ${a}, 'P2'), (${pb}, ${b}, 'P1')`;
await sql`insert into queue (org_id, portal_id, type, payload) values (${b}, ${pb}, 'probe', '{}')`;
const occ = (org: string, portal: string) => sql`insert into error_occurrences (org_id, portal_id, correlation_id, component, code, kind, severity, defect_key) values (${org}, ${portal}, 'c', 'probe', 'X', 'ambiguous', 'info', 'k')`;
await occ(a, pa); await occ(a, pa2); await occ(b, pb);
const occCount = () => sql`select count(*) as c from error_occurrences where component = 'probe'`;
const count = async (q: any) => Number((await q)[0].c);
const refused = async (run: () => Promise<unknown>) => { try { await run(); return false; } catch (e: any) { return e?.code === "42501" ? true : `unexpected ${e?.code}: ${e?.message}`; } };
const audit = () => sql`select count(*) as c from audit_events where action = 'probe'`;

const out: Record<string, unknown> = {};
out.platformSeesBoth = await count(audit());
await forOrg(a, async () => {
  out.orgSeesOwnAuditOnly = await count(audit());
  out.orgSeesOwnOrgOnly = await count(sql`select count(*) as c from orgs where name like 'Probe %'`);
  out.unsafeSeesOwnOnly = await count(sql.unsafe(`select count(*) as c from audit_events where action = 'probe'`));
  out.fragmentWorks = await count(sql`select count(*) as c from audit_events where ${sql`action = ${"probe"}`}`);
  out.writeForOtherOrgRefused = await refused(() => sql`insert into audit_events (org_id, action, entity_type) values (${b}, 'probe', 'probe')`);
  out.queueForOtherOrgRefused = await refused(() => sql`insert into queue (org_id, portal_id, type, payload) values (${b}, ${pb}, 'probe', '{}')`);
  out.otherOrgUpdateTouchesNothing = (await sql`update queue set status = 'done' where org_id = ${b} returning id`).length;
  out.renamingOrgRefused = await refused(() => sql`update orgs set name = 'changed' where id = ${a}`);
  out.platformTablesRefused = await refused(() => sql`select count(*) from rate_limits`);
  out.transactionSeesOwnOnly = await sql.begin(async (q) => count(q`select count(*) as c from audit_events where action = 'probe'`));
  out.platformSqlInsideOrgSeesBoth = await count(platformSql`select count(*) as c from audit_events where action = 'probe'`);
  out.asSystemInsideOrgSeesBoth = await asSystem(() => count(audit()));
  out.laterWorkKeepsOrg = await new Promise((done) => setTimeout(() => void count(audit()).then(done), 50));   // started inside, run after
});
out.afterwardsPlatformAgain = await count(audit());   // the same single connection: the role and organisation were put back
out.roleAfterwards = (await sql`select current_user as u, current_setting('app.org_id', true) as o`)[0];
await forOrg(crypto.randomUUID(), async () => { out.unknownOrgSeesNothing = await count(audit()); });
// Portals: inside one portal only that portal's rows; a second portal of the SAME organisation, another organisation's portal, and no portal at all see nothing of it
out.platformSeesAllPortalRows = await count(occCount());
await forPortal(a, pa, async () => {
  out.portalSeesOwnRowsOnly = await count(occCount());
  out.writeToSiblingPortalRefused = await refused(() => occ(a, pa2));
  out.writeToOtherOrgPortalRefused = await refused(() => occ(b, pb));
  out.insertTakesPortalFromScope = await count(sql`with i as (insert into error_occurrences (org_id, correlation_id, component, code, kind, severity, defect_key) values (${a}, 'c', 'probe2', 'X', 'ambiguous', 'info', 'k') returning portal_id) select count(*) as c from i where portal_id = ${pa}`);
});
await forPortal(a, pa2, async () => { out.siblingPortalSeesOwnRowsOnly = await count(occCount()); });
await forPortal(a, pb, async () => { out.otherOrgsPortalNamedByThisOrgSeesNothing = await count(occCount()); });
await forOrg(a, async () => { out.orgWithoutPortalSeesNoPortalRows = await count(occCount()); });
console.log(JSON.stringify(out));
process.exit(0);
