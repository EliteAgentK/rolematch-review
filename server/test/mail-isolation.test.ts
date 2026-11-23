import { spawn } from "node:child_process";
import { afterAll, expect, test } from "vitest";
import { FakeSmtp } from "./fakeSmtp";
import { setupTestDb } from "./helpers";

// A burst of invitations must not use up the connections (or the sending allowance) a verification code needs. Simulated mail host with a fixed 800 ms per message: this measures OUR
// scheduling and connection use, not a real host's speed or any inbox arrival time.
const DELAY = 800; let smtp: FakeSmtp;
afterAll(async () => { await smtp?.stop(); });
const run = async (mode: "baseline" | "burst") => {
  smtp.maxConcurrent = 0; smtp.messages.length = 0;
  const tdb = await setupTestDb({ MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: "live", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: "8951", MAIL_SMTP_SECURITY: "none", MAIL_MAX_PER_HOUR: "1000", MAIL_RESERVED_AUTH_PER_HOUR: "100", PROBE_MODE: mode });
  try {
    const out: string = await new Promise((res, rej) => { const c = spawn(process.execPath, ["--import", "tsx", "test/probes/mailBurstProbe.ts"], { env: tdb.env }); let b = ""; c.stdout.on("data", (d) => (b += d)); c.on("close", () => res(b.trim().split("\n").pop()!)); c.on("error", rej); });
    return { ...JSON.parse(out), maxConcurrentConnections: smtp.maxConcurrent, delivered: smtp.messages.length };
  } finally { await tdb.teardown(); }
};
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

test("verification sends are not slowed by an invitation burst, and the burst cannot take more than its own connection", async () => {
  smtp = new FakeSmtp(8951); await smtp.start(); smtp.delayMs = DELAY;
  const base = await run("baseline"), burst = await run("burst");
  console.log(JSON.stringify({ measured: "simulated host, 800 ms per message", baseline: { authMs: base.auth.map((a: any) => a.ms) }, burst: { authMs: burst.auth.map((a: any) => a.ms), bulkTotalMs: burst.bulkTotalMs, maxConcurrentConnections: burst.maxConcurrentConnections } }));
  for (const r of [base, burst]) expect(r.auth.every((a: any) => a.ok)).toBe(true);                         // no failures, no timeouts
  expect(burst.bulkOk).toBe(12); expect(burst.bulkTotalMs).toBeGreaterThanOrEqual(12 * DELAY * 0.85);      // the burst really was slow and queued behind itself
  const b95 = p95(base.auth.map((a: any) => a.ms)), x95 = p95(burst.auth.map((a: any) => a.ms));
  // No absolute limit is asserted: the time per send is mostly database round trips to the remote development database (about 1.5 s above the host delay in the run on
  // 88275e3, 3.4 s for the first, cold send), which says more about where the database is than about this design. It is printed above and reported; the assertion is relative.
  expect(x95).toBeLessThanOrEqual(b95 + 700);                                                                // verification latency with the burst running stays within 0.7 s of idle
  expect(burst.maxConcurrentConnections).toBeLessThanOrEqual(3);                                              // auth pool (2) + bulk pool (1): the host never sees more
  expect(burst.delivered).toBe(16);
}, 300000);
