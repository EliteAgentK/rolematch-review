import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// Read again for a job: its original read again by Claude (src/aiJobFields.ts; jobs are read by Claude alone since 10 Nov 2026), here the test stand-in
// (test/fakeJobClaude.ts). The job is marked as being read again until the new reading is saved, a recruiter's correction stands, every change is recorded,
// and the AI's use is metered to the job's portal. Another organisation cannot do it to this job (isolation.test.ts). Invented text.
let w: World, jobId: string;
type U = World["users"][0];
const jd = new File([[
  "Head of Enterprise Programme Delivery", "Company: Silver Acorn Financial Group", "Location: Johannesburg", "Employment: Permanent full-time",
  "Remuneration: R1.35 million to R1.7 million annual total cost to company",
  "Requirements", "- Ten years in programme delivery.", "- A degree in commerce or engineering.",
  "Responsibilities", "- Lead the programme managers and report to the chief operating officer.",
].join("\n")], "programme-head.txt", { type: "text/plain" });
const put = async (u: U, path: string, body: unknown) => { const r = await u.req(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };
const readDone = async (u: U) => { for (let i = 0; i < 300; i++) { const j = (await u.get(`/api/jobs/${jobId}`)).body; if (!j.rereading) return j; await sleep(100); } throw new Error("the reading again did not finish"); };

beforeAll(async () => {
  w = await makeWorld(8998, 1, { SIGNUP_REQUIRE_CODE: "false" });
  const u = w.users[0], up = await u.upload(jd, { kind: "jd" });
  let d: any;
  for (let i = 0; i < 300; i++) { d = (await u.get(`/api/documents/${up.body.id}`)).body; if (d.status === "published") { jobId = d.recordId; break; } await sleep(100); }
  expect(jobId, `the job was not published: ${JSON.stringify({ status: d?.status, stage: d?.stage, error: d?.errorCode ?? d?.error_code, message: d?.errorMessage ?? d?.error_message, upload: up.status, body: up.body })}`).toBeTruthy();
}, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

test("a job is read again by the AI from its original: marked while it is read, a recruiter's correction kept, every change recorded, the AI's use metered", async () => {
  const u = w.users[0];
  // As an earlier reading left it: the company wrong.
  await w.admin.unsafe(`update ${w.tdb.schema}.jobs set data = data || $1::text::jsonb where id = $2`, [JSON.stringify({ company: "Silver Acorn Financial Group | Head of function" }), jobId]);
  // The recruiter corrects the location by hand, with a reason.
  const before = (await u.get(`/api/jobs/${jobId}`)).body;
  expect((await put(u, `/api/jobs/${jobId}`, { location: "Sandton, Johannesburg", version: before.version, changeKind: "recruiter_preference" })).status).toBe(200);

  const asked = (await w.admin.unsafe(`select count(*)::int as n from ${w.tdb.schema}.ai_usage`))[0].n;
  const again = await u.post(`/api/jobs/${jobId}/read-again`, {});
  expect(again.status).toBe(202);
  expect(again.body).toEqual({ queued: true });
  const read = await readDone(u);
  expect(read.company).toBe("Silver Acorn Financial Group");
  expect(read.location).toBe("Sandton, Johannesburg");   // the recruiter's correction stands
  expect(read.aiReading).toMatchObject({ state: "read" });

  const [event] = await w.admin.unsafe(`select detail from ${w.tdb.schema}.audit_events where entity_id = $1 and action = 'job.read_again'`, [jobId]);
  expect(event.detail.changes.company).toEqual({ from: "Silver Acorn Financial Group | Head of function", to: "Silver Acorn Financial Group" });
  expect(event.detail.kept).toEqual(["location"]);
  expect((await w.admin.unsafe(`select count(*)::int as n from ${w.tdb.schema}.ai_usage where purpose = 'extraction' and portal_id is not null`))[0].n).toBeGreaterThan(asked);

  // Read again once more: nothing left to change.
  expect((await u.post(`/api/jobs/${jobId}/read-again`, {})).status).toBe(202);
  await readDone(u);
  const events = await w.admin.unsafe(`select detail from ${w.tdb.schema}.audit_events where entity_id = $1 and action = 'job.read_again' order by created_at`, [jobId]);
  expect(events[1].detail.changes).toEqual({});
  expect((await u.post(`/api/jobs/00000000-0000-4000-8000-000000000000/read-again`, {})).status).toBe(404);
}, 120_000);
