import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// A job description too long for the AI to read is refused at once, with that reason, and never asked again: each try is paid for and cannot succeed
// (code review, 16 Nov 2026, B-M9). Before, the queue asked three times and then said only that the AI could not read it, with Retry. Invented text.
let w: World;
beforeAll(async () => { w = await makeWorld(8972, 1); }, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

test("a job description too long for the AI is refused on the first try, says why, and is not asked again (code review, 16 Nov 2026, B-M9)", async () => {
  const u = w.users[0];
  const text = ["Senior Data Engineer", "Requirements", ...Array.from({ length: 2500 }, (_, i) => `- Requirement ${i + 1}: experience with data pipeline number ${i + 1} and a long sentence that describes the work in detail.`)].join("\n");
  const up = await u.upload(new File([text], "very-long-job.txt", { type: "text/plain" }), { kind: "jd" });
  expect(up.status).toBe(202);
  let d: any;
  for (let i = 0; i < 300; i++) { d = (await u.get(`/api/documents/${up.body.id}`)).body; if (d.status !== "processing") break; await sleep(100); }
  expect(d.status).toBe("exception");
  expect(d.errorCode ?? d.error_code).toBe("AI_TOO_LONG");
  expect(String(d.errorMessage ?? d.error_message)).toMatch(/too long/i);
  const jobs = await w.admin.unsafe(`select status, attempts from ${w.tdb.schema}.queue where type = 'model-job-fields' and payload->>'documentId' = $1`, [up.body.id]);
  expect(jobs).toEqual([{ status: "done", attempts: 1 }]);
  expect((await w.admin.unsafe(`select count(*)::int as n from ${w.tdb.schema}.ai_usage`))[0].n).toBe(0);   // nothing was sent, so nothing was paid
}, 120_000);
