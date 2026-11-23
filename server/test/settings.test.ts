import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { adminCreateUser, adminDeleteUser } from "../src/supabase";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

const PORT = 8795, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, admin: postgres.Sql;
interface Who { cookie: string; orgId: string }
const orgs: Record<string, Who> = {};
const S = () => `"${tdb.schema}"`;
const sample = (dir: string, f: string) => new File([readFileSync(fileURLToPath(new URL(`../../sample-documents/${dir}/${f}`, import.meta.url)))], f);
const hdr = (w: Who) => ({ cookie: w.cookie, origin: "http://localhost:5173", "content-type": "application/json" });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");

async function signup(tag: string): Promise<Who> {
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `10.7.${tag.length}.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ name: `Set ${tag}`, orgName: `Settings Org ${tag} ${run}`, email: `st-${run}-${tag}@example.test`, password: "a-long-enough-password-1" }) });
  const body: any = await res.json();
  expect(res.status, `sign-up for ${tag}: ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(300);
  return { cookie: cookieOf(res), orgId: body.user.orgId };
}
const get = (w: Who, p: string) => fetch(base + p, { headers: { cookie: w.cookie } });
const put = (w: Who, p: string, body: unknown) => fetch(base + p, { method: "PUT", headers: hdr(w), body: JSON.stringify(body) });
const settings = async (w: Who) => (await (await get(w, "/api/settings")).json()) as any;
async function upload(w: Who, kind: "cv" | "jd", file: File) {
  const f = new FormData(); f.append("kind", kind); f.append("file", file);
  const res = await fetch(base + "/api/documents", { method: "POST", headers: { cookie: w.cookie, origin: "http://localhost:5173" }, body: f });
  const d: any = await res.json();
  if (res.status !== 202) return { status: res.status, body: d };
  for (let i = 0; i < 90; i++) { const x: any = await (await get(w, `/api/documents/${d.id}`)).json(); if (x.status !== "processing") return { status: res.status, body: x }; await sleep(1000); }
  throw new Error("never finished");
}

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true" });
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  for (const t of ["a", "b", "c", "d"]) orgs[t] = await signup(t);
}, 180000);

afterAll(async () => {
  server?.kill(); await admin?.end(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'st-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test("a new organisation starts on the platform defaults, and the scoring rules are not among the settings", async () => {
  const s = await settings(orgs.a);
  expect(s.version).toBe(0); expect(s.canEdit).toBe(true);
  expect(s.settings.statuses.map((x: any) => x.key)).toEqual(["new", "reviewed", "shortlisted", "awaiting interview", "interviewing", "interviewed", "hired", "declined", "archived"]);
  // Owner, 9 Nov 2026: New, Shortlisted, Interviewed, Hired, Not suitable are in use; the earlier ones stay, switched off, so old records read properly.
  expect(s.settings.statuses.filter((x: any) => x.active).map((x: any) => x.label)).toEqual(["Not yet reviewed", "Shortlisted", "Interviewed", "Hired", "Not suitable"]);
  expect(s.settings.labels.candidate).toEqual({ one: "Candidate", many: "Candidates" });
  expect(s.settings.limits.maxPages).toBe(12);
  expect(s.ceilings.maxPages).toBeGreaterThan(12);
  expect(JSON.stringify(s)).not.toMatch(/weight|ruleset|band/i);
  const tamper = await put(orgs.a, "/api/settings", { version: 0, weights: { mandatory: 99 }, bands: [] });
  expect((await tamper.json() as any).version).toBe(0); // unknown sections are ignored: there is no way to touch scoring
});

test("changes are saved as numbered versions with who changed what, and are audited", async () => {
  const A = orgs.a;
  const next = (await settings(A)).settings;
  const r1 = await put(A, "/api/settings", { version: 0, labels: { candidate: { one: "Applicant", many: "Applicants" } }, statuses: [...next.statuses.map((x: any) => (x.key === "new" ? { ...x, colour: "pink" } : x)), { key: "offer made", label: "Offer made", colour: "green", active: true }] });
  expect(r1.status).toBe(200);
  const saved: any = await r1.json();
  expect(saved.version).toBe(1); expect(saved.settings.labels.candidate.many).toBe("Applicants"); expect(saved.settings.labels.job.many).toBe("Jobs"); // untouched fields keep their value
  expect(saved.settings.statuses.find((x: any) => x.key === "offer made").label).toBe("Offer made");
  const history: any[] = await (await get(A, "/api/settings/history")).json();
  expect(history[0].version).toBe(1); expect(history[0].by).toBe("Set a"); expect(JSON.stringify(history[0].change)).toContain("Applicants");
  expect((await admin.unsafe(`select count(*)::int c from ${S()}.audit_events where action = 'settings.changed' and org_id = $1`, [A.orgId]))[0].c).toBe(1);
  // a no-op save does not create a version
  const same: any = await (await put(A, "/api/settings", { version: 1, labels: { candidate: { one: "Applicant", many: "Applicants" } } })).json();
  expect(same.version).toBe(1);
});

test("two people editing at once cannot overwrite each other", async () => {
  const stale = await put(orgs.a, "/api/settings", { version: 0, limits: { documentsPerDay: 50 } });
  expect(stale.status).toBe(409); expect(((await stale.json()) as any).error.code).toBe("CONF-002");
});

test("bad settings are refused with a clear reason: duplicates, a missing 'new', numbers above the platform ceiling", async () => {
  const B = orgs.b; const cur = (await settings(B)).settings;
  const dup = await put(B, "/api/settings", { version: 0, statuses: [...cur.statuses, { key: "new", label: "Again", colour: "red", active: true }] });
  expect(dup.status).toBe(400); expect(JSON.stringify(await dup.json())).toMatch(/own key/);
  const noNew = await put(B, "/api/settings", { version: 0, statuses: cur.statuses.filter((x: any) => x.key !== "new") });
  expect(noNew.status).toBe(400); expect(JSON.stringify(await noNew.json())).toMatch(/must exist and stay active/);
  const tooBig = await put(B, "/api/settings", { version: 0, limits: { maxPages: 500 } });
  expect(tooBig.status).toBe(400);
  const range = await put(B, "/api/settings", { version: 0, review: { lowConfidence: 3 } });
  expect(range.status).toBe(400);
  const colour = await put(B, "/api/settings", { version: 0, statuses: [{ key: "new", label: "New", colour: "hotpink", active: true }, { key: "x", label: "X", colour: "red", active: true }] });
  expect(colour.status).toBe(400);
  expect((await settings(B)).version).toBe(0); // nothing was saved
});

test("only an administrator can change settings; any member can read them", async () => {
  const A = orgs.a;
  const email = `st-${run}-rec@example.test`, password = "a-long-enough-password-1";
  const userId = await adminCreateUser(email, password, "Recruiter Person");
  await admin.unsafe(`insert into ${S()}.members (user_id, org_id, name, role, email) values ($1, $2, 'Recruiter Person', 'recruiter', $3)`, [userId, A.orgId, email]);
  await admin.unsafe(`insert into ${S()}.portal_members (portal_id, org_id, user_id, role) select id, org_id, $1, 'recruiter' from ${S()}.portals where org_id = $2 order by created_at limit 1`, [userId, A.orgId]);   // a person is in a portal only by membership
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.7.9.9" }, body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const rec: Who = { cookie: cookieOf(login), orgId: A.orgId };
  const read: any = await (await get(rec, "/api/settings")).json();
  expect(read.canEdit).toBe(false); expect(read.settings.labels.candidate.many).toBe("Applicants"); // same organisation, sees the same settings
  const v = read.version;
  const denied = await put(rec, "/api/settings", { version: v, limits: { documentsPerDay: 1 } });
  expect(denied.status).toBe(403); expect(((await denied.json()) as any).error.code).toBe("PERM-001");
});

test("organisations are separate: one organisation's settings never leak into another's", async () => {
  const other = await settings(orgs.c);
  expect(other.version).toBe(0); expect(other.settings.labels.candidate.many).toBe("Candidates");
});

test("a status that people use, on their headline or for any job, cannot be removed, only switched off; a switched-off status cannot be assigned but stays readable", async () => {
  const D = orgs.d;
  expect((await upload(D, "cv", sample("cvs", "cv01-thandi-mokoena.docx"))).body.status).toBe("published");
  expect((await upload(D, "jd", sample("jobs", "job04-financial-accountant.docx"))).body.status).toBe("published");
  expect((await upload(D, "jd", sample("jobs", "job02-data-analyst.docx"))).body.status).toBe("published");
  const cand: any = (await (await get(D, "/api/candidates")).json()).items[0];
  const jobs: any[] = (await (await get(D, "/api/jobs")).json()).items;
  // a person's stage is set for a job (production review, 12 Nov 2026): shortlisted for one, not suitable for the other
  const status = (jobId: string, s: string) => put(D, "/api/applications", { candidateId: cand.id, jobId, status: s });
  expect((await status(jobs[0].id, "shortlisted")).status).toBe(200);
  expect((await status(jobs[1].id, "declined")).status).toBe(200);
  const cur = (await settings(D)).settings;
  const removed = await put(D, "/api/settings", { version: 0, statuses: cur.statuses.filter((x: any) => x.key !== "shortlisted") });
  expect(removed.status).toBe(400); expect(JSON.stringify(await removed.json())).toMatch(/Switch it off/);
  // "Not suitable" is never anyone's headline, but it is held for a job: it is in use too
  const removedDeclined = await put(D, "/api/settings", { version: 0, statuses: cur.statuses.filter((x: any) => x.key !== "declined") });
  expect(removedDeclined.status).toBe(400); expect(JSON.stringify(await removedDeclined.json())).toMatch(/Switch it off/);
  const off = await put(D, "/api/settings", { version: 0, statuses: cur.statuses.map((x: any) => (x.key === "shortlisted" || x.key === "declined" ? { ...x, active: false } : x)) });
  expect(off.status).toBe(200);
  const fresh: any = await (await get(D, `/api/candidates/${cand.id}`)).json();
  expect(fresh.status).toBe("shortlisted"); // still readable on the record
  const assign = await status(jobs[0].id, "declined");
  expect(assign.status).toBe(400); expect(JSON.stringify(await assign.json())).toMatch(/not a status/);
  expect((await status(jobs[0].id, "interviewed")).status).toBe(200);
});

// Review 16 Nov 2026 (A-M1): settings are the organisation's, but the in-use check ran as the administrator's own portal, so a status held only in
// another portal of the same organisation could be removed and its people left with a status the organisation no longer has.
test("a status held in another portal of the organisation is in use too", async () => {
  const D = orgs.d;
  const org_id = D.orgId;
  const [other] = await admin.unsafe(`insert into ${S()}.portals (org_id, name) values ($1, 'Another department') returning id`, [org_id]) as any;
  const [doc] = await admin.unsafe(`insert into ${S()}.documents (org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage) values ($1, $2, 'cv', 'x.pdf', 'application/pdf', 10, $3, $4, 'published', 'ready') returning id`, [org_id, other.id, "h".repeat(64), `${org_id}/x.pdf`]) as any;
  await admin.unsafe(`insert into ${S()}.candidates (org_id, portal_id, document_id, data, extracted) values ($1, $2, $3, $4, '{}')`, [org_id, other.id, doc.id, { name: "Elsewhere", status: "hired" } as any]);
  const cur = await settings(D);
  const removed = await put(D, "/api/settings", { version: cur.version, statuses: cur.settings.statuses.filter((x: any) => x.key !== "hired") });
  expect(removed.status).toBe(400); expect(JSON.stringify(await removed.json())).toMatch(/hired.*Switch it off/);
});

test("the limits an administrator sets are the ones that apply", async () => {
  const C = orgs.c;
  const cur: any = await settings(C);
  expect((await put(C, "/api/settings", { version: cur.version, limits: { documentsPerDay: 1, maxFileMb: 1 } })).status).toBe(200);
  const big = await upload(C, "cv", sample("cvs", "cv13-thandi-heavy-scan.pdf")); // a 4.7 MB scan
  expect(big.status).toBe(413); expect(JSON.stringify(big.body)).toMatch(/larger than 1 MB/);
  const first = await upload(C, "cv", sample("cvs", "cv01-thandi-mokoena.docx"));
  expect(first.body.status).toBe("published");
  const second = await upload(C, "cv", sample("cvs", "cv02-ruan-van-der-merwe.docx"));
  expect(second.status).toBe(429); expect(JSON.stringify(second.body)).toMatch(/limit of 1 uploads/);
  const usage: any = await (await get(C, "/api/usage")).json();
  expect(usage.limits.documentsPerDay).toBe(1);
}, 120000);

test("review thresholds are the organisation's own: a stricter skills minimum flags a CV the defaults accept", async () => {
  const A = orgs.a;
  const ruan = await upload(A, "cv", sample("cvs", "cv02-ruan-van-der-merwe.docx")); // 8 skills
  expect(ruan.body.status).toBe("published");
  const before: any = (await (await get(A, "/api/candidates?q=ruan")).json()).items[0];
  expect(before.reviewState).toBe("ok");
  const cur: any = await settings(A);
  expect((await put(A, "/api/settings", { version: cur.version, review: { minSkills: 9 } })).status).toBe(200);
  const michael = await upload(A, "cv", sample("cvs", "cv07-johan-pretorius.docx")); // 5 skills
  expect(michael.body.status).toBe("published");
  const after: any = (await (await get(A, "/api/candidates?q=johan")).json()).items[0];
  expect(after.reviewState).toBe("needs_review");
  expect(after.review.reasons.join(" ")).toMatch(/Only \d skills/);
}, 120000);

test("what a recruiter may edit: corrections to who the person is are allowed, what the CV states is locked, and the organisation decides", async () => {
  const D = orgs.d;
  expect((await upload(D, "cv", sample("cvs", "cv01-thandi-mokoena.docx"))).body.status).toBe("published");
  const rec: any = (await (await get(D, "/api/candidates?q=thandi")).json()).items[0];
  const edit = (patch: Record<string, unknown>) => put(D, `/api/candidates/${rec.id}`, { version: undefined, changeKind: "extraction_correction", ...patch });   // fields read from the CV need a reason (store.ts)
  // allowed by default: a name or phone correction, notes, workflow status
  expect((await edit({ phone: "082 000 0000" })).status).toBe(200);
  expect((await edit({ recruiterNotes: "Phoned on Monday." })).status).toBe(200);
  // locked by default: what the CV states
  const refused = await edit({ summary: "A different summary the CV does not contain." });
  expect(refused.status).toBe(403);
  const body: any = await refused.json();
  expect(body.error.code).toBe("PERM-002"); expect(body.error.fields).toEqual(["summary"]);
  expect((await edit({ workHistory: [] })).status).toBe(403);
  expect((await edit({ education: [] })).status).toBe(403);
  // a client that sends the whole record back is fine as long as nothing locked actually changes
  const fresh: any = await (await get(D, `/api/candidates/${rec.id}`)).json();
  expect((await edit({ summary: fresh.summary, skills: fresh.skills, workHistory: fresh.workHistory, name: "Thandi M. Mokoena" })).status).toBe(200);
  // what the platform works out is never editable, even for an organisation that unlocks everything
  const cur: any = await settings(D);
  const all = Object.fromEntries(Object.keys(cur.settings.editing.candidate).map((k) => [k, true]));
  expect((await put(D, "/api/settings", { version: cur.version, editing: { ...cur.settings.editing, candidate: all } })).status).toBe(200);
  expect((await edit({ summary: "Now the organisation allows it." })).status).toBe(200);
  const years = await edit({ experience: "99" });
  expect(years.status).toBe(403); expect(((await years.json()) as any).error.fields).toEqual(["experience"]);
  // every allowed change is audited with what it was and what it became (notes: only that they changed)
  const audited: any[] = await admin.unsafe(`select detail from ${S()}.audit_events where entity_id = $1 and action = 'candidate.edited' order by created_at`, [rec.id]);
  const changed = audited.flatMap((a) => Object.keys(a.detail.changes));
  expect(changed).toEqual(expect.arrayContaining(["phone", "recruiterNotes", "name", "summary"]));
  expect(JSON.stringify(audited)).not.toContain("Phoned on Monday");
}, 180000);

test("a job's own specification is editable and its skills are not; the policy is an organisation setting", async () => {
  const D = orgs.d;
  expect((await upload(D, "jd", sample("jobs", "job01-senior-developer.docx"))).body.status).toBe("published");
  const job: any = (await (await get(D, "/api/jobs?q=developer")).json()).items[0];
  expect((await put(D, `/api/jobs/${job.id}`, { title: "Principal Software Developer", changeKind: "recruiter_preference" })).status).toBe(200);
  const refused = await put(D, `/api/jobs/${job.id}`, { skills: ["Invented"] });
  expect(refused.status).toBe(403); expect(((await refused.json()) as any).error.fields).toEqual(["skills"]);
  // a setting the schema does not know is refused, so the policy cannot be widened by accident
  const cur: any = await settings(D);
  expect((await put(D, "/api/settings", { version: cur.version, editing: { candidate: { ...cur.settings.editing.candidate, experience: true }, job: cur.settings.editing.job } })).status).toBe(400);
}, 180000);

test("the organisation's name under the logo: shown by default from the registered name, renamed or hidden by an administrator, versioned, and refused with control characters", async () => {
  const d = orgs.d, s0 = await settings(d);
  expect(s0.orgName).toBe(`Settings Org d ${run}`);
  expect(s0.settings.branding).toEqual({ showOrgName: true, orgDisplayName: "" });
  const renamed = await put(d, "/api/settings", { version: s0.version, branding: { orgDisplayName: "  Settings D Recruitment  " } });
  expect(renamed.status).toBe(200);
  const s1 = await settings(d);
  expect(s1.version).toBe(s0.version + 1);
  expect(s1.settings.branding).toEqual({ showOrgName: true, orgDisplayName: "Settings D Recruitment" });   // trimmed
  const history: any[] = await (await get(d, "/api/settings/history")).json();
  expect(history[0].change.branding.orgDisplayName).toEqual({ from: "", to: "Settings D Recruitment" });
  expect((await put(d, "/api/settings", { version: s1.version, branding: { orgDisplayName: "Line one\nLine two" } })).status).toBe(400);
  expect((await put(d, "/api/settings", { version: s1.version, branding: { orgDisplayName: "x".repeat(61) } })).status).toBe(400);
  expect((await put(d, "/api/settings", { version: s1.version, branding: { showOrgName: false } })).status).toBe(200);
  expect((await settings(d)).settings.branding).toEqual({ showOrgName: false, orgDisplayName: "Settings D Recruitment" });
  expect((await settings(orgs.c)).settings.branding).toEqual({ showOrgName: true, orgDisplayName: "" });   // another organisation is untouched
});

test("history, a NEW upload: one file is a single upload, listed once with its outcome and a link to its record, for this portal and the whole organisation, never another organisation's", async () => {
  const a = await signup("h"), b = orgs.b;                                                  // an organisation of its own: nothing uploaded before this test
  const up = await upload(a, "cv", sample("cvs", "cv04-michael-chen.docx"));
  expect(up.status).toBe(202);                                                               // new to this portal: admitted and read
  expect(up.body.status).toBe("published");
  const rec: any = await (await get(a, `/api/candidates/${up.body.recordId}`)).json();
  const mine: any[] = await (await get(a, "/api/history/uploads")).json();
  expect(mine.filter((r) => r.fileName === "cv04-michael-chen.docx")).toHaveLength(1);
  const row = mine[0];
  expect(row).toMatchObject({ id: up.body.id, viaBatch: false, recordId: rec.id, uploadedBy: `st-${run}-h@example.test` });   // one file is a single upload
  expect(row.outcome).toBe(rec.reviewState === "needs_review" ? "added_needs_review" : "added");   // the record's own state decides the label
  const whole: any[] = await (await get(a, "/api/history/uploads?scope=org")).json();      // the organisation's administrator may see every portal
  expect(whole.some((r) => r.id === row.id && r.portal)).toBe(true);
  const theirs: any[] = await (await get(b, "/api/history/uploads?scope=org")).json();
  expect(theirs.some((r) => r.id === row.id)).toBe(false);                                   // never another organisation's

  // R35: a record a recruiter has confirmed is "Added, reviewed", not still "needs review". R101: deleting the record deletes its document and the name, and the line stays.
  expect((await fetch(base + `/api/candidates/${rec.id}/review`, { method: "POST", headers: hdr(a), body: JSON.stringify({ version: rec.version }) })).status).toBe(200);
  expect(((await (await get(a, "/api/history/uploads")).json()) as any[])[0]).toMatchObject({ outcome: "added_reviewed", recordId: rec.id });
  expect((await fetch(base + `/api/candidates/${rec.id}`, { method: "DELETE", headers: hdr(a) })).status).toBe(200);
  const kept = ((await (await get(a, "/api/history/uploads")).json()) as any[]).find((r) => r.id === row.id);
  expect(kept).toMatchObject({ outcome: "deleted", recordId: null });
  expect(kept.fileName).not.toBe(row.fileName);
});

test("history, a DUPLICATE upload: the same file again is answered with the first document (200), reads nothing again, adds no record and no history row", async () => {
  const a = await signup("i");
  const first = await upload(a, "cv", sample("cvs", "cv05-sipho-ndlovu.docx"));
  expect(first.status).toBe(202);
  const count = async () => ((await (await get(a, "/api/candidates")).json()) as any).total as number;
  const before = await count();
  const again = await upload(a, "cv", sample("cvs", "cv05-sipho-ndlovu.docx"));
  expect(again.status).toBe(200);                                                            // a duplicate is answered, not re-read
  expect(again.body).toMatchObject({ duplicate: true, id: first.body.id, recordId: first.body.recordId });
  expect(await count()).toBe(before);
  const rows: any[] = await (await get(a, "/api/history/uploads")).json();
  expect(rows.filter((r) => r.fileName === "cv05-sipho-ndlovu.docx")).toHaveLength(1);
});

test("history: every invitation sent, for administrators only, never another organisation's", async () => {
  const a = orgs.a, b = orgs.b;
  const inv = await fetch(base + "/api/portal/invitations", { method: "POST", headers: hdr(a), body: JSON.stringify({ emails: [`st-${run}-hist@example.test`], role: "recruiter" }) });
  expect(inv.status).toBe(201);
  const invites: any[] = await (await get(a, "/api/history/invitations")).json();
  const sent = invites.find((i) => i.email === `st-${run}-hist@example.test`);
  expect(sent).toMatchObject({ status: "waiting", role: "recruiter", invitedBy: `st-${run}-a@example.test` });
  expect((await (await get(b, "/api/history/invitations?scope=org")).json() as any[]).some((i) => i.id === sent.id)).toBe(false);
});

test("a status label kept from an earlier default reads as today's wording; one an organisation chose is kept", async () => {
  // Owner, 11 Nov 2026: cards still read "New" in an organisation that had saved its settings before the default became "Not yet reviewed".
  const cur = (await settings(orgs.b)).settings;
  const kept = await put(orgs.b, "/api/settings", { version: 0, statuses: cur.statuses.map((x: any) => (x.key === "new" ? { ...x, label: "New" } : x)) });
  expect(kept.status).toBe(200);
  expect((await settings(orgs.b)).settings.statuses.find((x: any) => x.key === "new").label).toBe("Not yet reviewed");
  const own = await put(orgs.b, "/api/settings", { version: 1, statuses: cur.statuses.map((x: any) => (x.key === "new" ? { ...x, label: "Awaiting first look" } : x)) });
  expect(own.status).toBe(200);
  expect((await settings(orgs.b)).settings.statuses.find((x: any) => x.key === "new").label).toBe("Awaiting first look");
});
