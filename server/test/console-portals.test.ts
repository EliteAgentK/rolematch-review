// The console's Portals page (migration 046, owner 11 Nov 2026): every portal, its administrator's e-mail and its AI use, each portal counted on its own.
// Against a real database: two companies, each with its portal and administrator; AI use in each, either side of the start of Johannesburg's month.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { portalsPage, type PortalRow } from "../src/console/view";
import { periodOf } from "../src/console/period";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, db: postgres.Sql;
const A = "portal-admin-a@example.test", B = "portal-admin-b@example.test";

beforeAll(async () => {
  tdb = await setupTestDb();
  await tdb.createUser("Acme Portals Test", A, "Admin A", "a long test password one");
  await tdb.createUser("Beta Portals Test", B, "Admin B", "a long test password two");
  db = postgres(process.env.DATABASE_URL!, { max: 2, connection: { search_path: `${tdb.schema},public,extensions` } });
  const portal = async (email: string) => (await db.unsafe(`select p.id, p.org_id from "${tdb.schema}".portals p join "${tdb.schema}".portal_members pm on pm.portal_id = p.id join auth.users u on u.id = pm.user_id where u.email = $1`, [email]))[0];
  const [pa, pb] = [await portal(A), await portal(B)];
  const start = `(date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')`;
  const use = (p: any, micro: number, when: string) => db.unsafe(`insert into "${tdb.schema}".ai_usage (org_id, portal_id, account_id, purpose, provider, model, input_tokens, output_tokens, cost_micro_usd, outcome, at)
    values ($1, $2, (select id from "${tdb.schema}".billing_accounts where org_id = $1), 'matching', 'anthropic', 'a-model', 10, 10, $3, 'answered', ${when})`, [p.org_id, p.id, micro]);
  await use(pa, 1_000_000, `${start} + interval '1 minute'`);    // this month, just after midnight in Johannesburg
  await use(pa, 2_500_000, `now()`);                             // this month
  await use(pa, 7_000_000, `${start} - interval '1 minute'`);    // last month, a minute before midnight in Johannesburg
  await use(pb, 400_000, `now()`);                               // the other company's portal
}, 120_000);
afterAll(async () => { await db?.end(); await tdb?.teardown(); });

const portals = async () => (await db.unsafe(`set role rolematch_console; select "${tdb.schema}".console_portals() as v; reset role;`).then((r: any) => r[1][0].v)) as PortalRow[];

test("each portal shows its own administrator and its own AI use, this month by Johannesburg's calendar and in all", async () => {
  const list = await portals(), a = list.find((p) => p.admins.includes(A))!, b = list.find((p) => p.admins.includes(B))!;
  expect(a.admins).toEqual([A]); expect(b.admins).toEqual([B]);                       // no portal shows another's administrator
  expect(a.company).toBe("Acme Portals Test"); expect(a.createdBy).toBe(A);
  expect([a.aiCallsMonth, a.aiMicroUsdMonth, a.aiCallsAll, a.aiMicroUsdAll]).toEqual([2, 3_500_000, 3, 10_500_000]);
  expect([b.aiCallsMonth, b.aiMicroUsdMonth, b.aiCallsAll, b.aiMicroUsdAll]).toEqual([1, 400_000, 1, 400_000]);
  expect(a.byPurposeMonth).toEqual({ matching: 3_500_000 });
  expect(list[0].admins).toEqual([A]);                                                  // the busiest this month comes first
});

test("the console's role reads portals only through the function, never the tables themselves", async () => {
  await expect(db.unsafe(`set role rolematch_console; select count(*) from "${tdb.schema}".ai_usage;`)).rejects.toThrow(/permission denied/);
  await db.unsafe("reset role");
  await expect(db.unsafe(`set role rolematch_console; select count(*) from "${tdb.schema}".portals;`)).rejects.toThrow(/permission denied/);
  await db.unsafe("reset role");
});

test("the page names every portal and its administrator, shows each one's cost, keeps itself up to date, and holds no script", async () => {
  // The list shows the period the owner chose (migration 051): here this month, so the same figures as the month's.
  const month = periodOf(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(new Date()));
  const v = await db.begin((q: any) => [q`set local role rolematch_console`, q`select ${q(tdb.schema)}.console_period(${month.from}, ${month.to}, ${month.before}, 'day') as v`]).then((r: any) => r[1][0].v);
  const html = portalsPage(await portals(), "", "token", 0, undefined, month, v.byPortal);
  for (const w of ["Every portal", A, B, "Acme Portals Test", "$3.50", "$10.50 in all", "$0.40", "Who runs each portal"]) expect(html, w).toContain(w);
  expect(html).toMatch(/<meta http-equiv="refresh" content="5">/);
  expect(html).not.toMatch(/<script/i);
  expect(portalsPage(null, "the database did not answer", "t", 0)).toContain("Cannot be shown just now: the database did not answer");
});
