import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, sql: postgres.Sql;
beforeAll(async () => { tdb = await setupTestDb({}); sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }); }, 120000);
afterAll(async () => { await sql?.end(); await tdb?.cleanup?.(); }, 60000);

test("every row rule still names both the organisation and the portal or organisation it did, and reads them once per statement", async () => {
  const rows = await sql.unsafe(`select tablename, policyname, qual, with_check from pg_policies where schemaname = '${tdb.schema}'`);
  expect(rows.length).toBeGreaterThan(20);
  for (const r of rows as any[]) {
    const q = String(r.qual ?? "") + String(r.with_check ?? "");
    if (!q.includes("current_setting")) continue;
    expect(q, `${r.tablename}.${r.policyname}`).not.toMatch(/= \(NULLIF\(current_setting/);
    expect(q, `${r.tablename}.${r.policyname}`).toMatch(/SELECT \(?NULLIF\(current_setting/i);
  }
  const portal = rows.find((r: any) => r.tablename === "candidates") as any;
  expect(portal.qual).toMatch(/app\.org_id/); expect(portal.qual).toMatch(/app\.portal_id/);
});
test("functions have a fixed search path", async () => {
  const rows = await sql.unsafe(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${tdb.schema}' and p.proname in ('upload_history_immutable', 'audit_immutable', 'rate_limit_take', 'quota_take')`);
  expect(rows.length).toBeGreaterThanOrEqual(4);
  for (const r of rows as any[]) expect(JSON.stringify(r.proconfig), r.proname).toMatch(/search_path/);
});
