import { afterAll, beforeAll, expect, test } from "vitest";
import { cvFile, makeWorld, sleep, type World } from "./portalKit";

// A workflow status belongs to a candidate for ONE job (owner, 9 Nov 2026; migration 043, applications.ts): shortlisting someone for one job says nothing
// about any other. The candidate's own status is the furthest stage any job has them at. Another organisation sees and changes none of it. Invented people.
let a: World, b: World, person: string, jobA: string, jobB: string;
type U = World["users"][0];
const jd = (title: string) => new File([`${title}\nNorthwind Traders\nJohannesburg\nRequirements\n- BCom Accounting\n- Excel\nResponsibilities\n- Prepare monthly statements and reconcile the accounts for the finance team every month.`], `${title}.txt`);
const published = async (u: U, id: string) => { for (let i = 0; i < 300; i++) { const d = (await u.get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(100); } throw new Error("not published"); };
const put = async (u: U, body: unknown) => { const r = await u.req("/api/applications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };
const candidate = async (u: U, id: string) => (await u.get(`/api/candidates/${id}`)).body;

beforeAll(async () => {
  a = await makeWorld(8996, 1, { SIGNUP_REQUIRE_CODE: "false" }); b = await makeWorld(8997, 1, { SIGNUP_REQUIRE_CODE: "false" });
  const u = a.users[0];
  person = await published(u, (await u.upload(await cvFile(3), { kind: "cv" })).body.id);
  jobA = await published(u, (await u.upload(jd("Financial Accountant"), { kind: "jd" })).body.id);
  jobB = await published(u, (await u.upload(jd("Payroll Administrator"), { kind: "jd" })).body.id);
}, 300_000);
afterAll(async () => { await a?.stop(); await b?.stop(); }, 120_000);

test("shortlisting for one job is for that job only; the candidate's own status is the furthest stage any job has them at; clearing it returns them to New", async () => {
  const u = a.users[0];
  const first = await put(u, { candidateId: person, jobId: jobA, status: "shortlisted" });
  expect(first.status).toBe(200);
  expect(first.body.application).toMatchObject({ candidateId: person, jobId: jobA, jobTitle: "Financial Accountant", status: "shortlisted" });
  expect(first.body.candidate.status).toBe("shortlisted");
  // not suitable for the other job: recorded for that job, and the person stays shortlisted for the first
  expect((await put(u, { candidateId: person, jobId: jobB, status: "declined" })).status).toBe(200);
  expect((await candidate(u, person)).status).toBe("shortlisted");
  const all = (await u.get("/api/applications")).body;
  expect(all.map((x: any) => [x.jobTitle, x.status]).sort()).toEqual([["Financial Accountant", "shortlisted"], ["Payroll Administrator", "declined"]]);
  // further along for the first job: the headline follows
  expect((await put(u, { candidateId: person, jobId: jobA, status: "hired" })).body.candidate.status).toBe("hired");
  // the job's shortlist holds the person for the job they are on, and not for the job they were declined for
  const listA = (await u.get(`/api/jobs/${jobA}/shortlist`)).body, listB = (await u.get(`/api/jobs/${jobB}/shortlist`)).body;
  expect(listA.map((r: any) => [r.candidate.id, r.status])).toEqual([[person, "hired"]]);
  expect(listA[0].matchResult).toBeNull();   // no match was run: nothing is calculated to fill the gap
  expect(listB).toEqual([]);
  // cleared for the first job: nobody has them past New any more
  const cleared = await put(u, { candidateId: person, jobId: jobA, status: null });
  expect(cleared.body.application).toBeNull();
  expect(cleared.body.candidate.status).toBe("new");
  // every change is in the audit log: which job, from what, to what
  const log = (await u.get(`/api/audit?entityId=${person}`)).body.filter((e: any) => e.action === "application.status_changed").map((e: any) => [e.detail.jobTitle, e.detail.from, e.detail.to]);
  expect(log).toEqual(expect.arrayContaining([["Financial Accountant", null, "shortlisted"], ["Payroll Administrator", null, "declined"], ["Financial Accountant", "shortlisted", "hired"], ["Financial Accountant", "hired", null]]));
}, 120_000);

test("a status the organisation does not use, New, or a made-up record is refused; another organisation sees none of it and can set none of it", async () => {
  const u = a.users[0], other = b.users[0];
  expect((await put(u, { candidateId: person, jobId: jobA, status: "new" })).status).toBe(400);
  expect((await put(u, { candidateId: person, jobId: jobA, status: "promoted" })).status).toBe(400);
  expect((await put(u, { candidateId: person, jobId: crypto.randomUUID(), status: "shortlisted" })).status).toBe(404);
  expect((await put(u, { candidateId: person, jobId: jobA, status: "shortlisted" })).status).toBe(200);
  expect((await other.get("/api/applications")).body).toEqual([]);
  expect((await other.get(`/api/jobs/${jobA}/shortlist`)).status).toBe(404);
  expect((await put(other, { candidateId: person, jobId: jobA, status: "declined" })).status).toBe(404);
  expect((await candidate(u, person)).status).toBe("shortlisted");   // untouched
}, 120_000);

// Production review, 12 Nov 2026 (docs/architecture/PLAN_STATUS_PER_APPLICATION.md): what goes wrong for real companies, not just one recruiter.
// P1 and P2 are fixed by construction (the candidate's row is locked, the pair is upserted: applications.ts). This test is a guard, not the proof: run
// against the code before the fix, on this machine, it also passed, because the requests did not collide closely enough to show the fault.
test("twenty recruiters at once: the same first status never fails, and two jobs at once leave the headline at the furthest of both (P1, P2)", async () => {
  const u = a.users[0];
  for (const j of [jobA, jobB]) await put(u, { candidateId: person, jobId: j, status: null });
  // the same first status for the same pair, twenty times at once: one row, no error
  const same = await Promise.all(Array.from({ length: 20 }, () => put(u, { candidateId: person, jobId: jobA, status: "shortlisted" })));
  expect(same.map((r) => r.status)).toEqual(Array(20).fill(200));
  expect((await u.get("/api/applications")).body.filter((x: any) => x.candidateId === person && x.jobId === jobA)).toHaveLength(1);
  // two jobs at once, again and again: the headline always ends at the furthest stage either job has them at
  for (let round = 0; round < 5; round++) {
    await Promise.all([put(u, { candidateId: person, jobId: jobA, status: "interviewed" }), put(u, { candidateId: person, jobId: jobB, status: "shortlisted" })]);
    expect((await candidate(u, person)).status).toBe("interviewed");
    await Promise.all([put(u, { candidateId: person, jobId: jobA, status: "shortlisted" }), put(u, { candidateId: person, jobId: jobB, status: "hired" })]);
    expect((await candidate(u, person)).status).toBe("hired");
  }
}, 180_000);

test("deleting the only job someone was shortlisted for returns them to New, says so in the audit log, and leaves other people's jobs alone (P3)", async () => {
  const u = a.users[0];
  for (const j of [jobA, jobB]) await put(u, { candidateId: person, jobId: j, status: null });
  const only = await published(u, (await u.upload(jd("Credit Controller"), { kind: "jd" })).body.id);
  expect((await put(u, { candidateId: person, jobId: only, status: "shortlisted" })).body.candidate.status).toBe("shortlisted");
  expect((await u.del(`/api/jobs/${only}`)).status).toBeLessThan(300);
  expect((await candidate(u, person)).status).toBe("new");
  expect((await u.get("/api/applications")).body.filter((x: any) => x.candidateId === person)).toEqual([]);
  const log = (await u.get(`/api/audit?entityId=${person}`)).body.filter((e: any) => e.action === "application.removed_with_job");
  expect(log.map((e: any) => [e.detail.jobTitle, e.detail.from, e.detail.headline])).toEqual([["Credit Controller", "shortlisted", "new"]]);
  // someone still shortlisted for another job keeps that stage when an unrelated job goes
  expect((await put(u, { candidateId: person, jobId: jobA, status: "shortlisted" })).status).toBe(200);
  const other = await published(u, (await u.upload(jd("Bookkeeper"), { kind: "jd" })).body.id);
  expect((await put(u, { candidateId: person, jobId: other, status: "declined" })).status).toBe(200);
  expect((await u.del(`/api/jobs/${other}`)).status).toBeLessThan(300);
  expect((await candidate(u, person)).status).toBe("shortlisted");
}, 180_000);
