// The day's exchange rate and each portal's daily totals (supabase/migrations/048_fx_and_portal_daily.sql, src/fx.ts; owner, 12 Nov 2026). The rate service is
// a stand-in here: nothing leaves the machine.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, db: postgres.Sql, fx: typeof import("../src/fx");
const ORG = crypto.randomUUID(), PORTAL = crypto.randomUUID(), OTHER = crypto.randomUUID();
beforeAll(async () => {
  tdb = await setupTestDb();
  Object.assign(process.env, { DB_SCHEMA: tdb.schema });
  vi.resetModules();
  fx = await import("../src/fx");
  db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: tdb.schema }, onnotice: () => {} });
  await db`insert into orgs (id, name) values (${ORG}, 'Totals test company')`;
  await db`insert into portals (id, org_id, name) values (${PORTAL}, ${ORG}, 'Main'), (${OTHER}, ${ORG}, 'Second')`;
}, 120_000);
afterAll(async () => { await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }); await tdb?.teardown(); });

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("an answer from the rate service is taken only when it is a rate: a date and a sensible rand per dollar", () => {
  expect(fx.parseRate({ date: "2026-11-11", rates: { ZAR: 16.5639 } })).toEqual({ published: "2026-11-11", usdZar: 16.5639 });
  expect(fx.parseRate({ date: "2026-11-11", rates: { ZAR: "not a number" } })).toBeNull();
  expect(fx.parseRate({ date: "yesterday", rates: { ZAR: 16.5 } })).toBeNull();
  expect(fx.parseRate({ date: "2026-11-11", rates: { ZAR: 0.06 } })).toBeNull();       // the wrong way round (dollars per rand) is refused
  expect(fx.parseRate(null)).toBeNull();
});

test("the day's rate is kept once, and the first time the last 60 days too; a failed answer changes nothing", async () => {
  const history = { rates: { "2026-10-01": { ZAR: 17.2 }, "2026-11-02": { ZAR: 16.9 } } };
  let asked = 0;
  const service = (async (url: string) => { asked++; return new Response(JSON.stringify(String(url).includes("..") ? history : { date: "2026-11-11", rates: { ZAR: 16.5639 } })); }) as unknown as typeof fetch;
  expect(await fx.refreshRate(service)).toMatch(/^rate 16\.5639/);
  expect(asked).toBe(2);
  expect((await db`select count(*)::int as n from fx_rates`)[0].n).toBe(3);
  expect(await fx.refreshRate(answer({ date: "2026-11-11", rates: { ZAR: 16.5639 } }))).toMatch(/^kept/);
  expect(await fx.refreshRate(answer({ error: "busy" }, 503))).toMatch(/^no rate/);
  expect((await db`select count(*)::int as n from fx_rates`)[0].n).toBe(3);
  // Each day's rate: its own, else the last before it, else the first ever kept.
  expect(Number((await db`select usd_zar_on('2026-10-15') as r`)[0].r)).toBe(17.2);
  expect(Number((await db`select usd_zar_on('2026-11-05') as r`)[0].r)).toBe(16.9);
  expect(Number((await db`select usd_zar_on('2020-01-01') as r`)[0].r)).toBe(17.2);
  expect((await fx.rateNow()).today).toBe(16.5639);
});

test("each AI line is turned into rands at its own day's rate, not one rate for the month", async () => {
  await db`insert into ai_usage (org_id, portal_id, purpose, provider, model, cost_micro_usd, outcome, at) values
    (${ORG}, ${PORTAL}, 'matching', 'anthropic', 'm', 1000000, 'answered', '2026-10-15T10:00:00Z'), (${ORG}, ${PORTAL}, 'matching', 'anthropic', 'm', 1000000, 'answered', '2026-11-05T10:00:00Z')`;
  const [r] = await db`select sum(cost_micro_usd * usd_zar_on((at at time zone 'Africa/Johannesburg')::date)) / 1e6 as rands from ai_usage where portal_id = ${PORTAL}`;
  expect(Number(r.rands)).toBeCloseTo(17.2 + 16.9, 6);
});

test("daily totals: one row per portal per day, counted from the records, the same when counted again, and each portal apart", async () => {
  await db`insert into matches (org_id, portal_id, candidate_id, job_id, created_at) select ${ORG}, ${OTHER}, gen_random_uuid(), gen_random_uuid(), now() where false`.catch(() => {});
  await db`select refresh_portal_daily('2026-10-01')`;
  const rows = await db`select portal_id, day::text, ai_calls, ai_micro_usd from portal_daily order by day`;
  expect(rows.map((r: any) => [r.portal_id, r.day, r.ai_calls, Number(r.ai_micro_usd)])).toEqual([[PORTAL, "2026-10-15", 1, 1000000], [PORTAL, "2026-11-05", 1, 1000000]]);
  await db`select refresh_portal_daily('2026-10-01')`;
  expect((await db`select count(*)::int as n from portal_daily`)[0].n).toBe(2);
  // A line that goes (a portal's record removed) takes its day's row with it when counted again.
  await db`delete from ai_usage where at = '2026-11-05T10:00:00Z'`;
  await db`select refresh_portal_daily('2026-11-01')`;
  expect((await db`select day::text from portal_daily`).map((r: any) => r.day)).toEqual(["2026-10-15"]);
});
