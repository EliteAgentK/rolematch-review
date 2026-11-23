import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, spawnProc, type TestDb } from "./helpers";

// Regression for R28: the failure recorder stopped recording after migration 019 changed the key of defect_groups, and nothing said so. This runs the REAL recording
// path against the fully migrated schema, and shows that a failure of the recorder itself is counted (not recorded again, so it cannot loop) and does not throw.
let tdb: TestDb;
beforeAll(async () => { tdb = await setupTestDb({ DB_POOL_SIZE: "2" }); }, 180000);
afterAll(async () => { await tdb?.teardown(); }, 60000);

test("occurrences are recorded and grouped through the real path on the current schema; the recorder's own failure is counted, never thrown, never recorded again", async () => {
  const p = spawnProc(["tsx", "test/probes/occurrenceProbe.ts"], { env: tdb.env });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(code, stderr.slice(0, 500)).toBe(0);
  const r = JSON.parse(stdout.trim().split("\n").pop()!);
  expect(r.occurrences).toBe(3);                                            // all three were written (R28: none were)
  expect(r.groups).toEqual([["SOME_CODE", 2, "suspected", "operational_transient"], ["SOME_CODE", 1, "suspected", "operational_transient"]]);   // same stage grouped (count 2), a different stage is its own
  expect(r.storedMessageHasNoAddress).toBe(true);
  expect(r.failureCounted).toBe(1);                                         // the recorder failed once and said so in its own counter
  expect(r.noRecursiveRecord).toBe(0);                                      // and did not try to record that failure in the table that just failed
  expect(r.otherPortalsRowsInvisible).toBe(0);
}, 120000);
