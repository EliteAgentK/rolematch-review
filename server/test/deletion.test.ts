import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { adminDeleteUser, getObject } from "../src/supabase";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

const PORT = 8797, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, admin: postgres.Sql;
interface Org { cookie: string }
const orgs: Record<string, Org> = {};
const sample = (dir: string, f: string) => new File([readFileSync(fileURLToPath(new URL(`../../sample-documents/${dir}/${f}`, import.meta.url)))], f);
const S = () => `"${tdb.schema}"`;

async function signup(tag: string): Promise<Org> {
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `10.5.${tag.length}.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ name: `Del ${tag}`, orgName: `Delete Org ${tag} ${run}`, email: `dl-${run}-${tag}@example.test`, password: "a-long-enough-password-1" }) });
  await res.json();
  return { cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ") };
}
const hdr = (o: Org) => ({ cookie: o.cookie, origin: "http://localhost:5173", "content-type": "application/json" });
const get = (o: Org, p: string) => fetch(base + p, { headers: { cookie: o.cookie } });
const del = (o: Org, p: string) => fetch(base + p, { method: "DELETE", headers: hdr(o) });
async function upload(o: Org, kind: "cv" | "jd", file: File) {
  const f = new FormData(); f.append("kind", kind); f.append("file", file);
  const d: any = await (await fetch(base + "/api/documents", { method: "POST", headers: { cookie: o.cookie, origin: "http://localhost:5173" }, body: f })).json();
  for (let i = 0; i < 90; i++) { const x: any = await (await get(o, `/api/documents/${d.id}`)).json(); if (x.status !== "processing") return x; await sleep(1000); }
  throw new Error("document never finished");
}

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true" });
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  orgs.a = await signup("a"); orgs.b = await signup("b");
}, 180000);

afterAll(async () => {
  server?.kill(); await admin?.end(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'dl-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test("deleting a candidate removes the record, its matches, the stored file, and personal detail in the edit history", async () => {
  const A = orgs.a;
  const cvDoc = await upload(A, "cv", sample("cvs", "cv01-thandi-mokoena.docx"));
  const jdDoc = await upload(A, "jd", sample("jobs", "job01-senior-developer.docx"));
  expect(cvDoc.status).toBe("published"); expect(jdDoc.status).toBe("published");
  const cand: any = (await (await get(A, "/api/candidates")).json()).items[0];
  const job: any = (await (await get(A, "/api/jobs")).json()).items[0];
  const [{ storage_path: path }] = await admin.unsafe(`select storage_path from ${S()}.documents where id = $1`, [cand.documentId]);
  expect((await getObject(path)).length).toBeGreaterThan(100); // the private original exists

  // a recruiter edit puts personal detail into the audit trail, and a match produces a result
  const edited = await fetch(base + `/api/candidates/${cand.id}`, { method: "PUT", headers: hdr(A), body: JSON.stringify({ email: "private.change@example.test", version: cand.version, changeKind: "extraction_correction" }) });
  expect(edited.status).toBe(200);
  expect((await fetch(base + "/api/matches", { method: "POST", headers: hdr(A), body: JSON.stringify({ candidateId: cand.id, jobId: job.id }) })).status).toBe(200);
  const before = await admin.unsafe(`select count(*)::int c from ${S()}.audit_events where detail::text like '%private.change%'`);
  expect(before[0].c).toBe(1);
  // a correction of what was read is also in the error register, with the same personal detail
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.error_register where record_id = $1 and to_value::text like '%private.change%'`, [cand.id]))[0].c).toBe(1);

  const res = await del(A, `/api/candidates/${cand.id}`);
  expect(res.status).toBe(200);

  expect((await get(A, `/api/candidates/${cand.id}`)).status).toBe(404);
  expect(((await (await get(A, "/api/candidates")).json()) as any).total).toBe(0);
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.matches where candidate_id = $1`, [cand.id]))[0].c).toBe(0);
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.documents where id = $1`, [cand.documentId]))[0].c).toBe(0);
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.audit_events where detail::text like '%private.change%'`))[0].c).toBe(0); // the personal detail is gone
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.error_register where record_id = $1`, [cand.id]))[0].c).toBe(0); // and so is its correction
  const trail = await admin.unsafe(`select action, detail from ${S()}.audit_events where entity_id = $1 order by created_at`, [cand.id]);
  expect(trail.map((r: any) => r.action)).toContain("candidate.deleted"); // who deleted it is still on record
  expect(JSON.stringify(trail)).not.toContain("Thandi");

  // the file leaves Supabase Storage too (the queue does it, with retries)
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { try { await getObject(path); await sleep(1000); } catch { gone = true; } }
  expect(gone).toBe(true);
  expect((await get(A, `/api/jobs/${job.id}`)).status).toBe(200); // the job is untouched
});

test("the audit trail is still append-only: nobody can edit or remove entries outside a deletion", async () => {
  await expect(admin.unsafe(`update ${S()}.audit_events set detail = '{}'::jsonb`)).rejects.toThrow(/append-only/);
  await expect(admin.unsafe(`delete from ${S()}.audit_events`)).rejects.toThrow(/append-only/);
});

test("another organisation cannot delete it; bad ids are not found; jobs can be deleted too", async () => {
  const A = orgs.a, B = orgs.b;
  const job: any = (await (await get(A, "/api/jobs")).json()).items[0];
  expect((await del(B, `/api/jobs/${job.id}`)).status).toBe(404);
  expect((await del(A, "/api/candidates/not-a-uuid")).status).toBe(404);
  expect((await get(A, `/api/jobs/${job.id}`)).status).toBe(200);
  expect((await del(A, `/api/jobs/${job.id}`)).status).toBe(200);
  expect((await get(A, `/api/jobs/${job.id}`)).status).toBe(404);
  expect((await del(A, `/api/jobs/${job.id}`)).status).toBe(404); // deleting twice is harmless
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.audit_events where action = 'job.deleted'`))[0].c).toBe(1);
});

test("deleting a candidate or a job also removes the AI's reviews that hold their text, and nothing of anyone else's (code review, 16 Nov 2026, A-M9)", async () => {
  const A = orgs.a;
  const cvDoc = await upload(A, "cv", sample("cvs", "cv02-ruan-van-der-merwe.docx"));
  const jdDoc = await upload(A, "jd", sample("jobs", "job02-data-analyst.docx"));
  const cand = cvDoc.recordId as string, job = jdDoc.recordId as string;
  const matchOf = async (c: string) => {
    expect((await fetch(base + "/api/matches", { method: "POST", headers: hdr(A), body: JSON.stringify({ candidateId: c, jobId: job }) })).status).toBe(200);
    return (await admin.unsafe(`select id, org_id from ${S()}.matches where candidate_id = $1 and job_id = $2`, [c, job]))[0];
  };
  const m = await matchOf(cand);
  const [{ portal_id: portal }] = await admin.unsafe(`select portal_id from ${S()}.documents where id = $1`, [cvDoc.id]);
  // The AI is switched off in the tests, so the reviews it would have written are put in place by hand: the match's score for this pair (its result
  // quotes the CV), the CV's reading, the job's reading, and a score for some other pair that must stay.
  const pair = `pair-${run}`, other = `other-${run}`;
  const scored = (id: string) => admin.unsafe(`update ${S()}.matches set result = jsonb_set(result, '{ai}', $2::jsonb) where id = $1`, [id, JSON.stringify({ state: "checked", pair })]);
  const review = (kind: string, subject: string, hash: string, result: unknown) => admin.unsafe(`insert into ${S()}.model_reviews (id, org_id, portal_id, kind, subject_id, input_hash, status, model, prompt_version, result)
    values (gen_random_uuid(), $1, $2, $3, $4, $5, 'done', 'test-model', 'test', $6::jsonb)`, [m.org_id, portal, kind, subject, hash, JSON.stringify(result)]);
  await scored(m.id);
  await review("match-score", m.id, pair, { evidence: [{ quote: "Ruan van der Merwe led the data team" }] });
  await review("extraction", cand, `cv-${run}`, { name: "Ruan van der Merwe" });
  await review("job-reading", job, `job-${run}`, { requirements: ["SQL"] });
  await review("match-score", crypto.randomUUID(), other, { evidence: [] });
  const left = async () => (await admin.unsafe(`select kind, input_hash from ${S()}.model_reviews where input_hash = any($1) order by kind, input_hash`, [[pair, other, `cv-${run}`, `job-${run}`]])).map((r: any) => `${r.kind}:${r.input_hash}`);

  expect((await del(A, `/api/candidates/${cand}`)).status).toBe(200);
  expect(await left()).toEqual([`job-reading:job-${run}`, `match-score:${other}`]);   // the CV's reading and the match's score went with the candidate

  // A job's own reading goes with the job, and so does every score of a match against it, which quotes the candidate's CV.
  const again = await upload(A, "cv", sample("cvs", "cv04-michael-chen.docx"));
  const m2 = await matchOf(again.recordId);
  await scored(m2.id);
  await review("match-score", m2.id, pair, { evidence: [{ quote: "Michael Chen built the reports" }] });
  expect((await del(A, `/api/jobs/${job}`)).status).toBe(200);
  expect(await left()).toEqual([`match-score:${other}`]);
}, 240000);
