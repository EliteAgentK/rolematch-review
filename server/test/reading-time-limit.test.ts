// A document that cannot be read within the time limit fails on its own (code review, 16 Nov 2026, B-M3). The worker used to exit half a second after
// rejecting it, so every other document it was reading at the time died mid-way, lost an attempt, and after three such losses was marked as failed. The
// page count and the optimiser also ran before the limit started. The worker here is a probe process (test/probes/overTimeProbe.ts) run the way a reading
// worker runs (ROLE=api, as in production), with a six-second limit. Invented documents only.
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, spawnProc, type TestDb } from "./helpers";

let tdb: TestDb;
beforeAll(async () => { tdb = await setupTestDb({ PROCESS_MAX_SECONDS: "6", ROLE: "api", WORKER_CONCURRENCY: "4" }); }, 120_000);
afterAll(async () => { await tdb?.teardown(); }, 60_000);

test("a document over its time limit fails alone: the worker keeps running, the other document is read on its first attempt, and the stopped reading really stops (code review, 16 Nov 2026, B-M3)", async () => {
  const p = spawnProc(["tsx", "test/probes/overTimeProbe.ts"], { env: tdb.env });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const last = stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}", r = JSON.parse(last);
  expect(r.exited ?? null, `the worker exited while other work was in flight: ${stdout.slice(-600)} ${stderr.slice(-600)}`).toBeNull();
  expect(code, stderr.slice(-800)).toBe(0);
  expect(r.slow).toEqual({ status: "exception", code: "READING_TIMED_OUT", endedWithinLimit: true });
  expect(r.quick).toEqual({ status: "published", code: null });
  expect(r.jobs).toEqual([{ doc: "slow", status: "done", attempts: 1 }, { doc: "quick", status: "done", attempts: 1 }]);
  expect(r.stoppedSoon, `one page takes ${r.pageMs} ms; the next OCR waited ${r.waitedMs} ms`).toBe(true);
}, 180_000);
