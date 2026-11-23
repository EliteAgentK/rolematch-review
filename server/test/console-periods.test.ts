// Any period on every page of the console (src/console/period.ts, supabase/migrations/051_console_periods.sql; owner, 12 Nov 2026: "last 24 hours, last 7
// days, last 30 days, last 3 months, and ... per month ... for every section").
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { choices, periodOf, withPeriod } from "../src/console/period";
import { shapePeriod } from "../src/console/insights";
import { activityPage, alertsPage, organisationsPage, page, portalsPage } from "../src/console/view";
import { setupTestDb, type TestDb } from "./helpers";

// 10:30 in Johannesburg on 12 November 2026
const NOW = new Date("2026-11-12T08:30:00Z");

test("each choice is an exact period in Johannesburg's hours and days, with the period before it", () => {
  const h = periodOf("24h", NOW);
  expect([h.from.toISOString(), h.to.toISOString(), h.before.toISOString(), h.step]).toEqual(["2026-11-11T08:30:00.000Z", "2026-11-12T08:30:00.000Z", "2026-11-10T08:30:00.000Z", "hour"]);
  const w = periodOf("7d", NOW);   // today and the six days before, from Johannesburg's midnight
  expect([w.from.toISOString(), w.before.toISOString(), w.step, w.label]).toEqual(["2026-11-05T22:00:00.000Z", "2026-10-29T22:00:00.000Z", "day", "Last 7 days"]);
  expect(periodOf("90d", NOW).label).toBe("Last 3 months");
  const m = periodOf("2026-11", NOW);   // this month: up to now; the month before is October
  expect([m.from.toISOString(), m.to.toISOString(), m.before.toISOString(), m.beforeLabel, m.month]).toEqual(["2026-10-31T22:00:00.000Z", NOW.toISOString(), "2026-09-30T22:00:00.000Z", "October 2026", true]);
  expect(periodOf("2026-12", NOW).key).toBe("30d");        // a month still to come is the default, never an error
  expect(periodOf("<script>", NOW).key).toBe("30d");
  expect(periodOf(null, NOW).key).toBe("30d");
});

test("the months offered run from the platform's first to now, newest first; the choice travels with every link", () => {
  expect(choices("2026-09-20T10:00:00Z", NOW).months.map((x) => x.key)).toEqual(["2026-11", "2026-10", "2026-09"]);
  expect(choices(null, NOW).recent.map((x) => x.key)).toEqual(["24h", "7d", "30d", "90d"]);
  expect(withPeriod("/portals", periodOf("7d", NOW))).toBe("/portals?p=7d");
  expect(withPeriod("/portals", periodOf("30d", NOW))).toBe("/portals");
  const html = page("Portals", "", { tab: "portals", token: "t", period: periodOf("7d", NOW), choose: true, since: "2026-11-04T00:00:00Z" });
  expect(html).toContain('href="/activity?p=7d"');
  expect(html).toMatch(/<a href="\?p=7d" aria-current="true">7 days<\/a>/);
  expect(html).toContain('href="?p=2026-11"');
});

test("each page says the chosen period in its own words, never 'this month' or '30 days' when another was chosen", () => {
  const p = periodOf("24h", NOW);
  const a = shapePeriod({ series: [{ at: "2026-11-12T09:00", cvs: 2 }, { at: "2026-11-12T10:00", cvs: 1 }], previous: { cvs: 6 } }, p);
  expect(a.labels).toEqual(["09:00", "10:00"]);
  expect(a.metrics.find((x) => x.key === "cvs")!.change).toBe("down 50% on the 24 hours before");
  const activity = activityPage(a, "", "t", 0, p);
  expect(activity).toContain("Last 24 hours, hour by hour");
  expect(activity).toContain("highest 2 in an hour");
  const portals = portalsPage([{ id: "11111111-1111-1111-1111-111111111111", name: "Main", company: "Acme", since: "2026-11-04", createdBy: null, admins: [], people: 1, cvs: 5, jobs: 1, matches: 2,
    aiCallsMonth: 9, aiMicroUsdMonth: 9_000_000, aiCallsAll: 9, aiMicroUsdAll: 9_000_000, byPurposeMonth: {}, lastActivity: null, history: [] }], "", "t", 0, undefined, p,
    { "11111111-1111-1111-1111-111111111111": { cvs: 3, aiCalls: 2, aiMicroUsd: 1_250_000 } });
  expect(portals).toContain("AI cost · 24 hours");
  expect(portals).toContain("$1.25");
  expect(portals).not.toContain("this month");
  expect(organisationsPage([], "", "t", 0, periodOf("2026-11", NOW))).toContain("AI · Nov 2026");
  const old = { id: 1, title: "Gone", severity: "urgent", source: "monitor", first_at: "2026-10-01T10:00:00Z", last_at: "2026-10-01T10:00:00Z", cleared_at: "2026-10-01T11:00:00Z", times: 1 } as any;
  expect(alertsPage([old], "t", 0, undefined, periodOf("7d", NOW))).toContain("Nothing went wrong in the last 7 days.");
  expect(alertsPage([old], "t", 0, undefined, periodOf("90d", NOW))).toContain("Gone");
});

let tdb: TestDb, db: postgres.Sql;
const ORG = crypto.randomUUID(), PORTAL = crypto.randomUUID();
beforeAll(async () => {
  tdb = await setupTestDb();
  db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: tdb.schema }, onnotice: () => {} });
  await db`insert into orgs (id, name) values (${ORG}, 'Period test company')`;
  await db`insert into portals (id, org_id, name) values (${PORTAL}, ${ORG}, 'Main')`;
  await db`insert into ai_usage (org_id, portal_id, purpose, provider, model, cost_micro_usd, outcome, at) values
    (${ORG}, ${PORTAL}, 'matching', 'anthropic', 'm', 100000, 'answered', now() - interval '2 hours'),
    (${ORG}, ${PORTAL}, 'matching', 'anthropic', 'm', 200000, 'answered', now() - interval '3 days'),
    (${ORG}, ${PORTAL}, 'matching', 'anthropic', 'm', 400000, 'answered', now() - interval '30 hours')`;
}, 120_000);
afterAll(async () => { await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }).catch(() => {}); await tdb?.teardown(); });

const asConsole = (f: (q: any) => any) => db.begin((q: any) => [q`set local role rolematch_console`, f(q)]).then((r: any) => r[1][0].v);

test("the database counts the chosen period hour by hour, the period before it, and each portal's share", async () => {
  const v = await asConsole((q) => q`select console_period(now() - interval '24 hours', now(), now() - interval '48 hours', 'hour') as v`);
  expect(v.series.length).toBeGreaterThanOrEqual(24);
  expect(v.series.reduce((s: number, x: any) => s + Number(x.aiMicroUsd), 0)).toBe(100000);   // only the call 2 hours ago
  expect(Number(v.previous.aiMicroUsd)).toBe(400000);                                            // 30 hours ago is the 24 hours before
  expect(v.byPortal[PORTAL]).toMatchObject({ aiCalls: 1, aiMicroUsd: 100000 });
  expect(v.byOrg[ORG].aiMicroUsd).toBe(100000);
  const week = await asConsole((q) => q`select console_period(now() - interval '7 days', now(), now() - interval '14 days', 'day') as v`);
  expect(Number(week.ai.microUsd)).toBe(700000);
});

test("nonsense is refused, and no company can ask: the console's role only", async () => {
  await expect(asConsole((q) => q`select console_period(now(), now() - interval '1 day', now(), 'day') as v`)).rejects.toThrow(/not valid/);
  await expect(asConsole((q) => q`select console_period(now() - interval '1 day', now(), now() - interval '2 days', 'minute') as v`)).rejects.toThrow(/hour or day/);
  await expect(db.begin((q: any) => [q`set local role rolematch_tenant`, q`select console_period(now() - interval '1 day', now(), now() - interval '2 days', 'day')`])).rejects.toThrow(/permission denied/);
});
