import { afterAll, beforeAll, expect, test } from "vitest";
import { JOB_DEPARTMENTS } from "../src/jobReader";
import { cvFile, makeWorld, sleep, type World } from "./portalKit";

// Records read before departments existed are placed in one as part of their reading (src/aiRead.ts, queueMissingDepartments; src/department.ts), with no
// button and no person asking: once each, inside the record's own portal, and never asked again. A CV is read by Claude alone now (src/cvReader.ts) and
// gets its department with its reading, so the state of a CV read before 10 Nov 2026 is made here by taking the department off the record once it is
// published; the stand-in's job reading gives no department. The sweep then places both. Invented documents.
let w: World, candidateId = "", jobId = "";
const jd = new File([["Payroll Administrator", "Company: Silver Acorn Financial Group", "Location: Johannesburg", "Requirements", "- Two years of payroll experience.", "Responsibilities", "- Run the monthly payroll for 400 staff and reconcile it to the ledger."].join("\n")], "payroll.txt", { type: "text/plain" });
const published = async (id: string) => { let d: any; for (let i = 0; i < 600; i++) { d = (await w.users[0].get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(200); } throw new Error(`not published: ${JSON.stringify({ status: d?.status, stage: d?.stage, error: d?.errorCode ?? d?.error })}`); };

beforeAll(async () => {
  w = await makeWorld(8996, 1, { SIGNUP_REQUIRE_CODE: "false", AI_READING: "on", DEPARTMENT_SWEEP_MS: "1500" });
  const u = w.users[0];
  candidateId = await published((await u.upload(await cvFile(1), { kind: "cv" })).body.id);
  await w.admin`update ${w.admin(w.tdb.schema)}.candidates set data = data - 'group' where id = ${candidateId}`;   // as read before departments existed
  jobId = await published((await u.upload(jd, { kind: "jd" })).body.id);
}, 300_000);
afterAll(async () => { await w?.stop(); }, 120_000);

test("a candidate and a job with no department are each placed once, by the reading, and never asked again", async () => {
  const u = w.users[0];
  let c: any, j: any;
  for (let i = 0; i < 120 && !(c?.group && j?.group); i++) { await sleep(500); c = (await u.get(`/api/candidates/${candidateId}`)).body; j = (await u.get(`/api/jobs/${jobId}`)).body; }
  expect(JOB_DEPARTMENTS as readonly string[]).toContain(c?.group);
  expect(j?.group).toBe("Finance");   // the stand-in places a payroll job in Finance
  const grouped = async () => (await w.admin`select action, count(*)::int as n from ${w.admin(w.tdb.schema)}.audit_events where action in ('candidate.grouped', 'job.grouped') group by 1 order by 1`).map((r: any) => `${r.action}:${r.n}`);
  expect(await grouped()).toEqual(["candidate.grouped:1", "job.grouped:1"]);
  await sleep(4500);   // three more sweeps: nothing is left to place, so nothing is asked
  expect(await grouped()).toEqual(["candidate.grouped:1", "job.grouped:1"]);
  // The Overview counts them in their departments at once.
  const o = (await u.get("/api/overview?days=30")).body;
  expect(o.families.find((f: any) => f.name === "Finance")?.open).toBe(1);
  expect(o.families.find((f: any) => f.name === "Not grouped yet")).toBeUndefined();
}, 120_000);
