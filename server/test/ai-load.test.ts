// The AI lane under load (owner, 8 Nov 2026: "if say 400 users, and within them 1,000 portals, all extracting and matching at the same time, this should be
// possible"; "rate limiting has never been so important"). On a throw-away schema of the real database, with the real queue and the real shared limit:
//   - 2,000 calls arriving in one minute are let through only up to the minute's limit, however many arrive at once, and the count is exact;
//   - one organisation flooding the AI queue with 1,000 jobs cannot make 999 other portals wait behind it: each of them is served within the first turns,
//     and the flooding organisation never holds more AI slots than its share;
//   - how long taking the next job takes with 2,000 waiting, so the queue itself is not the bottleneck.
// No AI is called: this measures the platform's own parts, which are what decide who goes when.
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import postgres from "postgres";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, db: postgres.Sql, rate: typeof import("../src/ai/rateLimit"), queue: typeof import("../src/queue");
beforeAll(async () => {
  tdb = await setupTestDb();
  Object.assign(process.env, { DB_SCHEMA: tdb.schema, WORKER_JOBS: "model", AI_PER_ORG_CONCURRENCY: "20", AI_SONNET_RPM: "800", AI_SONNET_ITPM: "400000", AI_SONNET_OTPM: "64000", AI_RATE_MAX_WAIT_MS: "0" });
  vi.resetModules();
  rate = await import("../src/ai/rateLimit"); queue = await import("../src/queue");
  db = postgres(process.env.DATABASE_URL!, { max: 4, connection: { search_path: tdb.schema }, onnotice: () => {} });
}, 120_000);
afterAll(async () => { await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }); await tdb?.teardown(); });

test("2,000 calls in one minute: exactly the minute's request limit gets through, the rest wait, and the count matches what was let through", async () => {
  const model = "claude-sonnet-5-5", t0 = performance.now();
  const places = await Promise.all(Array.from({ length: 2000 }, () => rate.takePlace(model, 200, 30)));
  const granted = places.filter(Boolean).length, ms = performance.now() - t0;
  // The minute may turn over during the run: then the next minute's room is used, and still never more than the limit in any one minute.
  const rows = await db`select minute, requests, input_tokens, output_tokens from ai_rate where model = ${model} order by minute`;
  for (const r of rows as any[]) { expect(r.requests).toBeLessThanOrEqual(800); expect(r.input_tokens).toBeLessThanOrEqual(400_000); expect(r.output_tokens).toBeLessThanOrEqual(64_000); }
  expect(rows.reduce((a: number, r: any) => a + r.requests, 0)).toBe(granted);
  expect(granted).toBeGreaterThanOrEqual(800); expect(granted).toBeLessThanOrEqual(800 * rows.length);   // a slow database can stretch the run over more than one minute
  console.log(`rate limit: ${granted} of 2000 let through in ${Math.round(ms)} ms (${rows.length} minute${rows.length > 1 ? "s" : ""})`);
}, 120_000);

test("tokens count as well as requests: a minute's input allowance stops calls before its request limit does, and what Anthropic counted replaces the estimate", async () => {
  const model = "claude-haiku-5-5";
  process.env.AI_HAIKU_ITPM = "10000";
  const places = await Promise.all(Array.from({ length: 10 }, () => rate.takePlace(model, 3000, 100)));
  // three calls of 3,000 fit a 10,000 allowance; a slow database can let the run cross into the next minute, which has its own allowance
  const perMinute = new Map<number, number>(); for (const p of places) if (p) perMinute.set(p.minute.getTime(), (perMinute.get(p.minute.getTime()) ?? 0) + 1);
  for (const n of perMinute.values()) expect(n).toBe(3);
  const p = places.find(Boolean)!;
  await rate.settlePlace(p, { inputTokens: 1000, outputTokens: 100 });   // most of the input came from the prompt cache, which Anthropic does not count
  const [r] = await db`select input_tokens from ai_rate where model = ${model} and minute = ${p.minute}`;
  expect(r.input_tokens).toBe(7000);
  expect(await rate.takePlace(model, 3000, 100)).not.toBeNull();   // the room given back is used
  delete process.env.AI_HAIKU_ITPM;
}, 240_000);

test("a full minute is waited out, not refused, while the wait is allowed", async () => {
  process.env.AI_RATE_MAX_WAIT_MS = "120000"; process.env.AI_SONNET_RPM = "1";
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const model = "claude-sonnet-5-5-wait";
    expect(await rate.takePlace(model, 10, 10)).not.toBeNull();
    let slept = 0;
    const second = await rate.takePlace(model, 10, 10, async (ms) => { slept += ms; vi.setSystemTime(Date.now() + ms); });
    expect(second).not.toBeNull();
    expect(slept).toBeGreaterThan(0); expect(slept).toBeLessThanOrEqual(62_000);
  } finally { vi.useRealTimers(); process.env.AI_RATE_MAX_WAIT_MS = "0"; process.env.AI_SONNET_RPM = "800"; }
}, 120_000);

test("1,000 portals and one flooding organisation: every other portal is served within the first turns, and the flood never holds more than its share", async () => {
  const flood = crypto.randomUUID(), floodPortal = crypto.randomUUID();
  await db`insert into orgs (id, name) values (${flood}, 'Flooding org')`;
  await db`insert into portals (id, org_id, name) values (${floodPortal}, ${flood}, 'Flood')`;
  // 999 other portals in 333 organisations, one AI job each, queued AFTER the flood's 1,000.
  const others: { org: string; portal: string }[] = [];
  for (let o = 0; o < 333; o++) { const org = crypto.randomUUID(); await db`insert into orgs (id, name) values (${org}, ${"Org " + o})`; for (let p = 0; p < 3; p++) others.push({ org, portal: crypto.randomUUID() }); }
  await db`insert into portals ${db(others.map((x, i) => ({ id: x.portal, org_id: x.org, name: `Portal ${i}` })))}`;
  const job = (org: string, portal: string, at: string) => ({ org_id: org, portal_id: portal, type: "model-matching", payload: JSON.stringify({}), created_at: at });
  await db`insert into queue ${db(Array.from({ length: 1000 }, () => job(flood, floodPortal, "2026-11-08T10:00:00Z")), "org_id", "portal_id", "type", "payload", "created_at")}`;
  await db`insert into queue ${db(others.map((x) => job(x.org, x.portal, "2026-11-08T10:05:00Z")), "org_id", "portal_id", "type", "payload", "created_at")}`;
  // 40 AI slots, as one AI worker runs. Each claimed job runs briefly and finishes; the order of service is recorded.
  const served: string[] = [], claimMs: number[] = []; let floodRunningMax = 0, floodServedInFirst1000 = 0;
  const slot = async () => {
    for (;;) {
      const t = performance.now(), row = await queue.claim(); claimMs.push(performance.now() - t);
      if (!row) return;
      served.push(row.portal_id);
      if (served.length <= 1000 && row.org_id === flood) floodServedInFirst1000++;
      const [r] = await db`select count(*)::int as n from queue where org_id = ${flood} and status = 'running'`; floodRunningMax = Math.max(floodRunningMax, r.n);
      await new Promise((res) => setTimeout(res, 5));
      await db`update queue set status = 'done' where id = ${row.id}`;
      if (served.length >= 1400) return;
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: 40 }, slot));
  const perSecond = served.length / ((performance.now() - t0) / 1000);
  const firstTurns = new Set(served.slice(0, 1100)), sorted = [...claimMs].sort((a, b) => a - b);
  const otherServed = others.filter((x) => firstTurns.has(x.portal)).length;
  console.log(`fairness: ${otherServed} of 999 other portals served in the first 1,100 turns; the flood had ${floodServedInFirst1000} of the first 1,000 turns and at most ${floodRunningMax} running at once; ${perSecond.toFixed(0)} jobs taken a second by 40 slots with up to 2,000 waiting (a slot's wait for its turn: median ${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms, 95th percentile ${sorted[Math.floor(sorted.length * 0.95)].toFixed(0)} ms, as claims of a lane take turns)`);
  expect(otherServed).toBe(999);
  expect(floodRunningMax).toBeLessThanOrEqual(20);
  expect(floodServedInFirst1000).toBeLessThan(500);   // queued first, yet it does not get the first turns: the others go first
}, 1_800_000);   // on the PC's own database it takes well under a minute; over a link to another continent, much longer
