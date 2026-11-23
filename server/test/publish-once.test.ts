// A document becomes one record, however many runs of it finish (review 16 Nov 2026, B-H3): the queue re-queues a job silent for 120 s while it
// may still be running, and the publish statement's insert passed on its own snapshot even when the document had been published meanwhile.
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, type TestDb, spawnProc } from "./helpers";

let tdb: TestDb;
beforeAll(async () => { tdb = await setupTestDb({ DB_POOL_SIZE: "4" }); }, 120000);
afterAll(async () => { await tdb?.teardown(); }, 60000);

test("two runs of one document publishing at the same moment make one record, one audit line and one link; a cancelled file is never published", async () => {
  const p = spawnProc(["tsx", "test/probes/publishTwiceProbe.ts"], { env: tdb.env });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(code, stderr.slice(0, 800)).toBe(0);
  const r = JSON.parse(stdout.trim().split("\n").pop()!);
  expect(r).toEqual({ cancelledPublished: 0, candidates: 1, publishedAudits: 1, status: "published", linked: true, errors: [] });
}, 120000);
