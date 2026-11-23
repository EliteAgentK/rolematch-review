// The database itself keeps organisations apart (migration 014, db.ts forOrg): a query that forgets "where org_id" still sees one organisation only.
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, type TestDb, spawnProc } from "./helpers";

let tdb: TestDb;
beforeAll(async () => { tdb = await setupTestDb({ DB_POOL_SIZE: "1" }); }, 120000);
afterAll(async () => { await tdb?.teardown(); }, 60000);

test("work for one organisation sees and changes only that organisation's rows, even through a careless query", async () => {
  const p = spawnProc(["tsx", "test/probes/tenantProbe.ts"], { env: tdb.env });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(code, stderr.slice(0, 500)).toBe(0);
  const r = JSON.parse(stdout.trim().split("\n").pop()!);
  expect(r).toMatchObject({
    platformSeesBoth: 3,
    orgSeesOwnAuditOnly: 1, orgSeesOwnOrgOnly: 1, unsafeSeesOwnOnly: 1, fragmentWorks: 1, transactionSeesOwnOnly: 1,
    writeForOtherOrgRefused: true, queueForOtherOrgRefused: true, otherOrgUpdateTouchesNothing: 0, renamingOrgRefused: true, platformTablesRefused: true,
    platformSqlInsideOrgSeesBoth: 3, asSystemInsideOrgSeesBoth: 3, laterWorkKeepsOrg: 1,
    afterwardsPlatformAgain: 3, unknownOrgSeesNothing: 0,
    // portals (migration 019): the database keeps portals apart inside one organisation, and a named portal of another organisation shows nothing
    platformSeesAllPortalRows: 3, portalSeesOwnRowsOnly: 1, writeToSiblingPortalRefused: true, writeToOtherOrgPortalRefused: true, insertTakesPortalFromScope: 1,
    siblingPortalSeesOwnRowsOnly: 1, otherOrgsPortalNamedByThisOrgSeesNothing: 0, orgWithoutPortalSeesNoPortalRows: 0,
  });
  expect(r.roleAfterwards.o ?? "").toBe("");
  expect(r.roleAfterwards.u).not.toBe("rolematch_tenant");
}, 120000);

test("every table that holds an organisation's data is covered: row rules on, an own-organisation rule, and nothing granted beyond it", async () => {
  const postgres = (await import("postgres")).default;
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const s = tdb.schema;
    const orgTables = (await admin`select table_name as t from information_schema.columns where table_schema = ${s} and column_name = 'org_id'`).map((r: any) => r.t).concat("orgs").sort();
    const covered = (await admin`select tablename as t from pg_policies where schemaname = ${s} and policyname in ('own_org', 'own_portal') and 'rolematch_tenant' = any(roles)`).map((r: any) => r.t).sort();
    expect(covered).toEqual(orgTables);   // a new table with org_id fails here until migration adds its rule
    const rls = await admin`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${s} and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rls.map((r: any) => r.relname)).toEqual([]);
    const granted = (await admin`select distinct table_name as t from information_schema.role_table_grants where table_schema = ${s} and grantee = 'rolematch_tenant'`).map((r: any) => r.t).sort();
    expect(granted).toEqual(orgTables);   // the tenant role reaches organisation tables only, never rate limits, sign-outs or migrations
    const [role] = await admin`select rolbypassrls, rolcanlogin, rolsuper from pg_roles where rolname = 'rolematch_tenant'`;
    expect(role).toEqual({ rolbypassrls: false, rolcanlogin: false, rolsuper: false });
  } finally { await admin.end(); }
}, 60000);
