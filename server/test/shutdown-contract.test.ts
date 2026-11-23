import { spawn } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, makeWorld, sleep, type World } from "./portalKit";
import { setupTestDb, type TestDb } from "./helpers";

// Reliability contracts: a request key belongs to its person and its operation; an old browser is told to reload; readiness and liveness are different, and a
// server that is told to stop stops being ready first, then leaves within a bound.
let w: World; let A: Browser, B: Browser;
const NO_RATE = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, reserve_org: 100000, status_user: 100000, status_portal: 100000 });
beforeAll(async () => { w = await makeWorld(8881, 2, { RATE_OVERRIDES: NO_RATE, SIGNUP_REQUIRE_CODE: "false" }); [A, B] = w.users; }, 300000);
afterAll(async () => { await w?.stop(); }, 120000);

test("a request key is scoped to the person and the operation: the same key repeats safely, a different submission under it is refused, another person's key is separate", async () => {
  const key = crypto.randomUUID();
  const one = await A.post("/api/batches", { kind: "cv", files: 3, bytes: 30, requestKey: key });
  const again = await A.post("/api/batches", { kind: "cv", files: 3, bytes: 30, requestKey: key });
  expect(one.status).toBe(201); expect(again.body.id).toBe(one.body.id);                       // one reservation, not two
  const clash = await A.post("/api/batches", { kind: "cv", files: 4, bytes: 30, requestKey: key });
  expect(clash.status).toBe(422); expect(clash.body.error.code).toBe("IDEMPOTENCY-001");
  const kindClash = await A.post("/api/batches", { kind: "jd", files: 3, bytes: 30, requestKey: key });
  expect(kindClash.status).toBe(422);
  const other = await B.post("/api/batches", { kind: "cv", files: 2, bytes: 20, requestKey: key });   // same key text, different person: a different submission
  expect(other.status).toBe(201); expect(other.body.id).not.toBe(one.body.id);
  expect((await A.get("/api/capacity")).body.reserved).toBe(5);                                // 3 + 2, never 3 + 3 + 4
});

test("every answer states the contract version; a browser built for an older contract is told to reload; an unversioned caller is not refused", async () => {
  const ok = await A.req("/api/capacity"); expect(ok.headers.get("x-rolematch-contract")).toBe("1");
  const old = await A.req("/api/capacity", { headers: { "x-client-contract": "0" } });
  expect(old.status).toBe(426); expect(((await old.json()) as any).error.code).toBe("CLIENT-OUTDATED");
  expect((await A.req("/api/capacity", { headers: { "x-client-contract": "1" } })).status).toBe(200);
});

let tdb: TestDb;
test("readiness is separate from liveness, and SIGTERM stops readiness first, then exits within the bound", async () => {
  const PORT = 8882;
  tdb = await setupTestDb({ PORT: String(PORT), SHUTDOWN_MIN_DRAIN_MS: "2500", SHUTDOWN_GRACE_MS: "5000" });
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: tdb.env, stdio: "ignore" });
  const exited = new Promise<number | null>((r) => child.on("close", (c) => r(c)));
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch { /* starting */ } await sleep(250); }
    expect((await fetch(`http://localhost:${PORT}/api/ready`)).status).toBe(200);
    child.kill("SIGTERM");
    await sleep(600);
    const r = await fetch(`http://localhost:${PORT}/api/ready`); expect(r.status).toBe(503); expect(((await r.json()) as any).reason).toBe("draining");
    expect((await fetch(`http://localhost:${PORT}/api/health`)).status).toBe(200);              // still alive while draining
    const code = await Promise.race([exited, sleep(15000).then(() => "timeout" as const)]);
    expect(code).toBe(0);
  } finally { child.kill("SIGKILL"); await tdb.teardown(); }
}, 120000);
