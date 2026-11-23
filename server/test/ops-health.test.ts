import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { judgeAi, judgeMail, judgeProcessing, judgeQueue, judgeRequests, noteRequest, requestFigures, validOpsToken, worstOf, type Thresholds } from "../src/opsHealth";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

// What the monitor reads. The judgements are tested on their edges without a server; the endpoint is tested on a real server and an isolated schema.
const t: Thresholds = { queueDegradedSec: 900, queueUnavailableSec: 3600, stuckRunningSec: 300, windowMinutes: 60, failureMinSample: 20, failureDegradedRate: 0.2, failureUnavailableRate: 0.5, failureDegradedCount: 5,
  requestWindowMinutes: 15, requestMinSample: 50, errorDegradedRate: 0.05, errorUnavailableRate: 0.25, latencyDegradedMs: 2000, latencyUnavailableMs: 10000, modelWaitDegradedSec: 900, modelWaitUnavailableSec: 3600, mailDegradedSec: 900, mailUnavailableSec: 3600, loopDegradedMs: 500, loopUnavailableMs: 2000, rssDegradedMb: 1536, rssUnavailableMb: 3072 };
const org = (o: string, oldestSec: number, queued = 1) => ({ org: o, queued, oldestSec });

test("not being able to tell is never healthy, and outranks merely slow", () => {
  expect(worstOf(["healthy", "healthy"])).toBe("healthy");
  expect(worstOf(["healthy", "degraded"])).toBe("degraded");
  expect(worstOf(["degraded", "unknown", "healthy"])).toBe("unknown");
  expect(worstOf(["unknown", "unavailable"])).toBe("unavailable");
});

test("one organisation's backlog is that organisation's problem: it cannot mark the platform unavailable, and every organisation being behind can", () => {
  const one = judgeQueue({ queued: 3, running: 1, stuckRunning: 0, orgs: [org("a", 7200), org("b", 5), org("c", 2)] }, t);
  expect(one).toMatchObject({ state: "degraded", scope: "some_organisations", organisationsBehind: 1, organisationsWithWork: 3 });
  expect((one.behind as any[]).map((o) => o.org)).toEqual(["a"]);
  expect(judgeQueue({ queued: 2, running: 0, stuckRunning: 0, orgs: [org("a", 7200), org("b", 3700)] }, t)).toMatchObject({ state: "unavailable", scope: "platform" });
  expect(judgeQueue({ queued: 1, running: 0, stuckRunning: 0, orgs: [org("a", 899)] }, t).state).toBe("healthy");
  expect(judgeQueue({ queued: 1, running: 0, stuckRunning: 0, orgs: [org("a", 900)] }, t).state).toBe("degraded");
  expect(judgeQueue({ queued: 0, running: 0, stuckRunning: 0, orgs: [] }, t)).toMatchObject({ state: "healthy", note: "nothing waiting", oldestQueuedSec: 0 });
  expect(judgeQueue({ queued: 0, running: 1, stuckRunning: 1, orgs: [] }, t).state).toBe("degraded");
});

test("a percentage is only given above the minimum sample: one failure in two documents is not 50% failing", () => {
  expect(judgeProcessing({ completed: 1, failed: 1 }, t)).toMatchObject({ state: "healthy", failureRate: null });
  expect(judgeProcessing({ completed: 0, failed: 5 }, t)).toMatchObject({ state: "degraded", failureRate: null });   // too few for a rate, but a run of failures is worth a look
  expect(judgeProcessing({ completed: 90, failed: 10 }, t)).toMatchObject({ state: "healthy", failureRate: 0.1 });
  expect(judgeProcessing({ completed: 80, failed: 20 }, t)).toMatchObject({ state: "degraded", failureRate: 0.2 });
  expect(judgeProcessing({ completed: 50, failed: 50 }, t)).toMatchObject({ state: "unavailable", failureRate: 0.5 });
  expect(judgeRequests({ requests: 10, errors: 10, p95Ms: 50 }, t)).toMatchObject({ state: "healthy", errorRate: null });
  expect(judgeRequests({ requests: 100, errors: 5, p95Ms: 50 }, t)).toMatchObject({ state: "degraded", errorRate: 0.05 });
  expect(judgeRequests({ requests: 100, errors: 0, p95Ms: 12000 }, t).state).toBe("unavailable");
});

test("mail: stuck or given-up messages count, and a mailer that is switched off is said to be off", () => {
  expect(judgeMail({ sending: true, pending: 0, dead: 0, oldestUndeliveredSec: 0 }, t).state).toBe("healthy");
  expect(judgeMail({ sending: true, pending: 2, dead: 0, oldestUndeliveredSec: 1000 }, t).state).toBe("degraded");
  expect(judgeMail({ sending: true, pending: 2, dead: 0, oldestUndeliveredSec: 4000 }, t).state).toBe("unavailable");
  expect(judgeMail({ sending: true, pending: 0, dead: 1, oldestUndeliveredSec: 0 }, t).state).toBe("degraded");
  expect(judgeMail({ sending: false, pending: 0, dead: 0, oldestUndeliveredSec: 0 }, t)).toMatchObject({ state: "healthy", sending: false });
  expect(judgeMail({ sending: false, pending: 3, dead: 0, oldestUndeliveredSec: 10 }, t).state).toBe("degraded");
});

test("request figures are bounded, ignore health checks, and forget what is outside the window", () => {
  const now = Date.UTC(2030, 0, 1, 12, 0, 0);
  for (let i = 0; i < 5000; i++) noteRequest("/api/candidates", i % 100 === 0 ? 500 : 200, 10, now);
  noteRequest("/api/health", 500, 9999, now); noteRequest("/api/ready", 503, 9999, now); noteRequest("/api/ops/health", 500, 9999, now);
  expect(requestFigures(15, now)).toMatchObject({ requests: 5000, errors: 50, p95Ms: 10 });
  expect(requestFigures(15, now + 16 * 60_000).requests).toBe(0);
});

test("the token: only the configured one, compared whole, and a short configured token counts as none", () => {
  const good = "x".repeat(40);
  expect(validOpsToken(`Bearer ${good}`, good)).toBe(true);
  expect(validOpsToken(`Bearer ${good}y`, good)).toBe(false);
  expect(validOpsToken(good, good)).toBe(false);
  expect(validOpsToken(null, good)).toBe(false);
  expect(validOpsToken("Bearer short", "short")).toBe(false);
  expect(validOpsToken("Bearer ", "")).toBe(false);
});

// ---------------------------------------------------------------- the real endpoint
const PORT = 8841, base = `http://localhost:${PORT}`, TOKEN = "t".repeat(48);
const NAME = "Opshealth Personname", EMAIL = `ops-${crypto.randomUUID().slice(0, 8)}@example.test`;
let tdb: TestDb, server: Proc;
const ops = (authorization?: string) => fetch(`${base}/api/ops/health`, { headers: authorization ? { authorization } : {} });
beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), OPS_TOKEN: TOKEN, ROLE: "api" });   // website only: nothing reads the queue, so waiting work really waits
  await tdb.createUser("Ops Health Org", EMAIL, NAME, "a-long-enough-password-1");
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(100); }
}, 120000);
afterAll(async () => { server?.kill(); await tdb?.teardown(); }, 60000);

test("without the right token the endpoint does not exist; the public health answer stays minimal", async () => {
  expect((await ops()).status).toBe(404);
  expect((await ops("Bearer wrong")).status).toBe(404);
  expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
}, 30000);

test("with the token: every check reports a state, a backed-up organisation is named by id only, and nothing personal appears", async () => {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const S = `"${tdb.schema}"`;
    const [o] = await admin.unsafe(`select org_id from ${S}.members where email = '${EMAIL}'`);
    const [p] = await admin.unsafe(`select id from ${S}.portals where org_id = '${o.org_id}' limit 1`);
    await admin.unsafe(`insert into ${S}.queue (org_id, portal_id, type, payload, status, created_at, run_after) values ('${o.org_id}', '${p.id}', 'process', '{"note":"payload-marker-7f3a"}', 'queued', now() - interval '2 hours', now() - interval '2 hours')`);
    const res = await ops(`Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    const text = await res.text(), body = JSON.parse(text);
    expect(Object.keys(body.checks).sort()).toEqual(["ai", "database", "mail", "processing", "queue", "readiness", "requests", "resources"]);
    for (const c of Object.values<any>(body.checks)) expect(["healthy", "degraded", "unavailable", "unknown"]).toContain(c.state);
    expect(body.checks.database.state).toBe("healthy");
    expect(body.checks.queue).toMatchObject({ state: "unavailable", scope: "platform", organisationsBehind: 1 });
    expect(body.checks.queue.behind[0].org).toBe(o.org_id);
    expect(body.state).toBe("unavailable");
    for (const secret of [EMAIL, NAME, "Ops Health Org", TOKEN, "payload-marker-7f3a"]) expect(text).not.toContain(secret);
  } finally { await admin.end(); }
}, 30000);

test("the metrics for Prometheus: only with the token, numbers only (no organisation, person or token), requests counted but not the watchers' own", async () => {
  const metrics = (authorization?: string) => fetch(`${base}/api/ops/metrics`, { headers: authorization ? { authorization } : {} });
  expect((await metrics()).status).toBe(404);
  expect((await metrics("Bearer wrong")).status).toBe(404);
  const count4xx = (t: string) => Number(/^rolematch_http_responses_total\{class="4xx"\} (\d+)$/m.exec(t)?.[1] ?? NaN);
  const first = await metrics(`Bearer ${TOKEN}`);
  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toContain("text/plain; version=0.0.4");
  const before = await first.text();
  for (const name of ["rolematch_check_state", "rolematch_queue_jobs", "rolematch_ai_jobs", "rolematch_mail_messages", "rolematch_http_responses_total", "rolematch_http_request_duration_seconds_bucket", "rolematch_build_info"]) expect(before).toContain(name);
  // Every sample line is a name, optional labels and a number: what Prometheus accepts.
  for (const line of before.trim().split("\n").filter((l) => !l.startsWith("#"))) expect(line).toMatch(/^[a-z_][a-z0-9_]*(\{[a-z_][a-z0-9_]*="[^"]*"(,[a-z_][a-z0-9_]*="[^"]*")*\})? -?[0-9.e+]+$/);
  for (let i = 0; i < 3; i++) await fetch(`${base}/api/candidates`);   // not signed in: answered 401
  await fetch(`${base}/api/health`); await ops(`Bearer ${TOKEN}`);
  const after = await (await metrics(`Bearer ${TOKEN}`)).text();
  expect(count4xx(after) - count4xx(before)).toBe(3);
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const [o] = await admin.unsafe(`select org_id from "${tdb.schema}".members where email = '${EMAIL}'`);
    for (const secret of [EMAIL, NAME, "Ops Health Org", TOKEN, String(o.org_id)]) expect(after).not.toContain(secret);
  } finally { await admin.end(); }
}, 30000);

test("a recovered backlog is reported as recovered, and repeated polling within ten seconds shares one measurement", async () => {
  const first = await (await ops(`Bearer ${TOKEN}`)).json() as any;
  const again = await (await ops(`Bearer ${TOKEN}`)).json() as any;
  expect(again.measuredAt).toBe(first.measuredAt);
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try { await admin.unsafe(`delete from "${tdb.schema}".queue`); } finally { await admin.end(); }
  await sleep(10_500);
  const after = await (await ops(`Bearer ${TOKEN}`)).json() as any;
  expect(after.measuredAt).not.toBe(first.measuredAt);
  expect(after.checks.queue).toMatchObject({ state: "healthy", queued: 0 });
}, 30000);

// The model reads every CV before it reaches a panel, so it is on the service's path: a CV kept waiting is the service being slow, and the health report says how fast it has been writing. Off its path, it is only reported.
test("the AI on every CV's path: switched off is healthy, no key or failing calls or a reached cap are worth an alert, and a long wait is the service being slow", () => {
  const m = { reading: true, matching: true, configured: true, queued: 0, running: 3, oldestQueuedSec: 0, answered15m: 40, failed15m: 0, refused15m: 0, spentMonthUsd: 2.5, capUsd: 25 };
  expect(judgeAi(m, t)).toMatchObject({ state: "healthy", reading: "on", matching: "on", spentThisMonthUsd: 2.5, monthlyCapUsd: 25 });
  expect(judgeAi({ ...m, reading: false, matching: false, configured: false }, t)).toMatchObject({ state: "healthy" });
  expect(judgeAi({ ...m, configured: false }, t).state).toBe("degraded");
  expect(judgeAi({ ...m, answered15m: 0, failed15m: 5 }, t)).toMatchObject({ state: "degraded", note: expect.stringContaining("credit") });
  expect(judgeAi({ ...m, answered15m: 1, failed15m: 9 }, t).state).toBe("healthy");   // some answered: a passing blip, not an exhausted credit
  expect(judgeAi({ ...m, spentMonthUsd: 25 }, t).state).toBe("degraded");
  expect(judgeAi({ ...m, spentMonthUsd: 21 }, t)).toMatchObject({ state: "healthy", note: expect.stringContaining("80%") });
  expect(judgeAi({ ...m, queued: 3, oldestQueuedSec: 1000 }, t).state).toBe("degraded");
  expect(judgeAi({ ...m, queued: 3, oldestQueuedSec: 4000 }, t).state).toBe("unavailable");
});
