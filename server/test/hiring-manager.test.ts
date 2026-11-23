import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// Hiring manager / HR (owner, 2026-11-05): read-only, and sees only shortlisted candidates, on every route. Everyone sees the team, who is in the portal and the history, and no other portal or organisation does.
let w: World, other: World, shortlisted: { id: string; doc: string; name: string; file: string }, hidden: { id: string; doc: string; name: string; file: string }, jobId: string;
type U = World["users"][0];
const file = (n: string) => new File([readFileSync(join(import.meta.dirname, "fixtures/journey", n))], n);
const published = async (u: U, id: string) => { for (let i = 0; i < 300; i++) { const d = (await u.get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(100); } throw new Error("not published"); };
const put = (u: U, path: string, body: unknown) => u.req(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const add = async (u: U, name: string) => { const doc = (await u.upload(file(name), { kind: "cv" })).body.id, id = await published(u, doc); return { id, doc, name: (await u.get(`/api/candidates/${id}`)).body.name as string, file: name }; };
// A person's stage is set for a job, never on the person (production review, 12 Nov 2026): New clears it.
const setStatus = async (u: U, id: string, status: string) => { expect((await put(u, "/api/applications", { candidateId: id, jobId, status: status === "new" ? null : status })).status).toBe(200); };

beforeAll(async () => {
  w = await makeWorld(8992, 3, { SIGNUP_REQUIRE_CODE: "false" }); other = await makeWorld(8993, 1, { SIGNUP_REQUIRE_CODE: "false" });
  const s = w.tdb.schema, [admin, , hr] = w.users;
  await w.admin.unsafe(`update "${s}".members set role = 'hiring_manager' where email = $1`, [hr.email]);
  await w.admin.unsafe(`update "${s}".portal_members set role = 'hiring_manager' where user_id = (select user_id from "${s}".members where email = $1)`, [hr.email]);
  await w.admin.unsafe(`update "${s}".members set role = 'recruiter' where email = $1`, [w.users[1].email]);
  await w.admin.unsafe(`update "${s}".portal_members set role = 'recruiter' where user_id = (select user_id from "${s}".members where email = $1)`, [w.users[1].email]);
  await sleep(11_000);   // membership is cached for ten seconds
  shortlisted = await add(admin, "CV0501.docx"); hidden = await add(admin, "CV0519.pdf");
  const jd = (await admin.upload(file("JD0151.docx"), { kind: "jd" })).body;
  jobId = await published(admin, jd.id);
  await setStatus(admin, shortlisted.id, "shortlisted");
  for (const c of [shortlisted, hidden]) expect((await admin.post("/api/matches", { candidateId: c.id, jobId })).status).toBe(200);
}, 300000);
afterAll(async () => { await w?.stop(); await other?.stop(); }, 120000);

test("the candidate list holds only shortlisted people, whatever is asked for", async () => {
  const hr = w.users[2];
  const seen = (await hr.get("/api/candidates")).body;
  expect(seen.items.map((c: any) => c.id)).toEqual([shortlisted.id]);
  expect(seen.total).toBe(1);
  expect((await hr.get("/api/candidates?status=new")).body.items.map((c: any) => c.id)).toEqual([shortlisted.id]);   // asking for another status changes nothing
  expect((await hr.get(`/api/candidates?q=${encodeURIComponent(hidden.name.split(" ")[0])}`)).body.items.every((c: any) => c.id !== hidden.id)).toBe(true);
  expect((await w.users[1].get("/api/candidates")).body.total).toBe(2);   // a recruiter still sees everyone
  expect((await hr.get("/api/jobs")).body.items.map((j: any) => j.id)).toEqual([jobId]);   // jobs are not limited: a filter on candidates once emptied this list
}, 60000);

test("the board page shared within a portal never crosses a role or a portal, and someone who saw a change gets it", async () => {
  const [admin, recruiter, hr] = w.users, ids = (r: any) => r.body.items.map((c: any) => c.id).sort(), everyone = [shortlisted.id, hidden.id].sort();
  // Filled by the recruiter first, then asked for by the hiring manager, and the other way about.
  expect(ids(await recruiter.get("/api/candidates?limit=100"))).toEqual(everyone);
  expect(ids(await hr.get("/api/candidates?limit=100"))).toEqual([shortlisted.id]);
  expect(ids(await hr.get("/api/candidates?limit=99"))).toEqual([shortlisted.id]);
  expect(ids(await recruiter.get("/api/candidates?limit=99"))).toEqual(everyone);
  expect(ids(await hr.get("/api/candidates?limit=100&fresh=1"))).toEqual([shortlisted.id]);
  // Another organisation's portal, asking the same question at the same moment.
  expect((await other.users[0].get("/api/candidates?limit=100")).body.items).toEqual([]);
  // A change made through this server shows at once, without asking for it.
  const c = (await admin.get(`/api/candidates/${hidden.id}`)).body;
  await setStatus(admin, hidden.id, "interviewed");   // set back to where it was at the end of this test
  expect((await recruiter.get("/api/candidates?limit=100")).body.items.find((x: any) => x.id === hidden.id).status).toBe("interviewed");
  // A change another server or the worker made is not seen until the page runs out, unless someone asks for it: which is what the board does after a document finishes.
  const s = w.tdb.schema;
  await w.admin.unsafe(`update "${s}".candidates set data = jsonb_set(data, '{summary}', '"changed elsewhere"') where id = $1`, [hidden.id]);
  expect((await recruiter.get("/api/candidates?limit=100")).body.items.find((x: any) => x.id === hidden.id).summary).not.toBe("changed elsewhere");
  expect((await recruiter.get("/api/candidates?limit=100&fresh=1")).body.items.find((x: any) => x.id === hidden.id).summary).toBe("changed elsewhere");
  expect((await admin.get("/api/candidates?limit=100")).body.items.find((x: any) => x.id === hidden.id).summary).toBe("changed elsewhere");
  await w.admin.unsafe(`update "${s}".candidates set data = data || jsonb_build_object('summary', $2::text) where id = $1`, [hidden.id, c.summary ?? ""]);
  await setStatus(admin, hidden.id, c.status);
}, 60000);

test("anyone else looks exactly like a record that does not exist: record, original CV and saved match", async () => {
  const hr = w.users[2], unknown = crypto.randomUUID();
  const none = await hr.get(`/api/candidates/${unknown}`), notListed = await hr.get(`/api/candidates/${hidden.id}`);
  expect(notListed.status).toBe(404); expect(notListed.body.error.code).toBe(none.body.error.code); expect(notListed.body.error.message).toBe(none.body.error.message);
  expect((await hr.get(`/api/candidates/${shortlisted.id}`)).status).toBe(200);
  expect((await hr.req(`/api/documents/${hidden.doc}/original`)).status).toBe(404);
  expect((await hr.req(`/api/documents/${hidden.doc}/original?as=original`)).status).toBe(404);
  expect((await hr.req(`/api/documents/${shortlisted.doc}/original`)).status).toBe(200);
  expect((await hr.get(`/api/matches?candidateId=${hidden.id}&jobId=${jobId}`)).status).toBe(404);
  const saved = await hr.get(`/api/matches?candidateId=${shortlisted.id}&jobId=${jobId}`);
  expect(saved.status).toBe(200); expect(saved.body.savedAt).toBeTruthy(); expect(saved.body.confidence).toBeDefined();
  expect((await w.users[1].get(`/api/matches?candidateId=${hidden.id}&jobId=${jobId}`)).status).toBe(200);
}, 60000);

test("history shows every line to a hiring manager, with no file name of anyone not shortlisted", async () => {
  const hr = w.users[2], list = await hr.get("/api/history/uploads");
  expect(list.status).toBe(200);
  const text = JSON.stringify(list.body);
  expect(text).not.toContain(hidden.file); expect(text).not.toContain(hidden.name); expect(text).not.toContain(hidden.id);
  expect(list.body.find((l: any) => l.id === hidden.doc)).toMatchObject({ recordId: null, reason: null });
  expect(list.body.find((l: any) => l.id === shortlisted.doc)).toMatchObject({ fileName: shortlisted.file, recordId: shortlisted.id });
  expect(JSON.stringify((await w.users[1].get("/api/history/uploads")).body)).toContain(hidden.file);
}, 60000);

test("files in progress, batches, audit details and second reads stay closed; the board's polling still answers", async () => {
  const hr = w.users[2];
  expect((await hr.get("/api/documents")).body).toEqual([]);
  expect((await hr.get("/api/batches")).body).toEqual([]);
  for (const path of [`/api/documents/${hidden.doc}`, `/api/audit?entityId=${hidden.id}`, `/api/batches/${crypto.randomUUID()}/report`, `/api/batches/${crypto.randomUUID()}`]) {
    const r = await hr.get(path); expect(r.status, path).toBe(403); expect(r.body.error.code, path).toBe("PERM-READ-ONLY");
  }
  for (const path of ["/api/capacity", "/api/settings", "/api/portal/members", "/api/history/invitations", "/api/history/activity", "/api/jobs", `/api/jobs/${jobId}`]) expect((await hr.get(path)).status, path).toBe(200);
}, 60000);

test("nothing can be changed, a match cannot be run and a shortlisted person cannot be moved", async () => {
  const hr = w.users[2], c = (await hr.get(`/api/candidates/${shortlisted.id}`)).body;
  for (const r of [await put(hr, `/api/candidates/${shortlisted.id}`, { status: "new", version: c.version }), await hr.del(`/api/candidates/${shortlisted.id}`), await hr.post("/api/matches", { candidateId: shortlisted.id, jobId }), await hr.post("/api/matches/bulk", { candidateId: shortlisted.id }), await hr.upload(file("CV0525.pdf"), { kind: "cv" }), await hr.post("/api/portal/invitations", { emails: ["x@example.test"], role: "admin" })]) {
    expect(r.status).toBe(403);
  }
  expect((await w.users[0].get(`/api/candidates/${shortlisted.id}`)).body.status).toBe("shortlisted");
}, 60000);

test("moving someone off the shortlist ends a hiring manager's sight of them on the next request, and back again", async () => {
  const hr = w.users[2];
  await setStatus(w.users[0], shortlisted.id, "new");   // back to New: off the shortlist
  expect((await hr.get(`/api/candidates/${shortlisted.id}`)).status).toBe(404);
  expect((await hr.req(`/api/documents/${shortlisted.doc}/original`)).status).toBe(404);
  expect((await hr.get("/api/candidates")).body.items).toEqual([]);
  await setStatus(w.users[0], shortlisted.id, "shortlisted");
  expect((await hr.get(`/api/candidates/${shortlisted.id}`)).status).toBe(200);
}, 60000);

test("the old role and unknown roles are refused, never turned into more access", async () => {
  const admin = w.users[0];
  for (const role of ["viewer", "owner", ""]) expect((await admin.post("/api/portal/invitations", { emails: [`r-${w.run}@example.test`], role })).status, role).toBe(400);
  const s = w.tdb.schema;
  await expect(w.admin.unsafe(`update "${s}".portal_members set role = 'viewer' where user_id = (select user_id from "${s}".members where email = $1)`, [w.users[1].email])).rejects.toThrow(/check/);
}, 30000);

test("everyone sees who is in the portal; no other organisation does", async () => {
  const [admin, recruiter, hr] = w.users;
  await hr.get("/api/candidates"); await recruiter.get("/api/candidates"); await sleep(6000);   // the time is written within a few seconds of the answer, in one statement for everyone seen
  for (const u of [admin, recruiter, hr]) {
    const seen = (await u.get("/api/portal/members")).body;
    for (const who of [recruiter, hr]) expect(seen.members.find((m: any) => m.email === who.email), who.email).toMatchObject({ hereNow: true });
    expect(seen.members.find((m: any) => m.email === hr.email).lastSeen).toBeTruthy();
  }
  // long gone: still listed, no longer "in the portal now", and the last time stays honest
  const s = w.tdb.schema;
  await w.admin.unsafe(`update "${s}".portal_members set last_seen_at = now() - interval '7 minutes' where user_id = (select user_id from "${s}".members where email = $1)`, [recruiter.email]);
  const later = (await hr.get("/api/portal/members")).body.members.find((m: any) => m.email === recruiter.email);
  expect(later.hereNow).toBe(false); expect(later.lastSeen).toBeTruthy();
  const outsider = (await other.users[0].get("/api/portal/members")).body;
  expect(JSON.stringify(outsider)).not.toContain(hr.email);
}, 60000);

test("a thousand requests from one person write the time once", async () => {
  const hr = w.users[2], s = w.tdb.schema;
  const read = async () => (await w.admin.unsafe(`select last_seen_at t, xmin::text x from "${s}".portal_members where user_id = (select user_id from "${s}".members where email = $1)`, [hr.email]))[0];
  const before = await read();
  await Promise.all(Array.from({ length: 40 }, () => hr.get("/api/capacity"))); await sleep(500);
  expect((await read()).x).toBe(before.x);   // the row was not rewritten at all
}, 30000);

test("activity is in plain words, with no one's data, for everyone in the portal and nobody else", async () => {
  const [admin, recruiter, hr] = w.users;
  for (const u of [admin, recruiter, hr]) {
    const list = (await u.get("/api/history/activity")).body, text = JSON.stringify(list);
    expect(list.some((a: any) => a.what === "Ran a match" && a.who)).toBe(true);
    expect(list.some((a: any) => /^Moved a candidate to shortlisted for /.test(a.what))).toBe(true);   // a stage is set for a job, and says which
    expect(text).not.toContain(hidden.name); expect(text).not.toContain(shortlisted.name); expect(text).not.toContain(shortlisted.id);
    for (const a of list) expect(Object.keys(a).sort()).toEqual(["at", "id", "portal", "what", "who"]);
  }
  expect((await recruiter.get("/api/history/activity?scope=org")).status).toBe(403);
  expect((await other.users[0].get("/api/history/activity")).body.some((a: any) => a.who === admin.email)).toBe(false);
  expect(JSON.stringify((await other.users[0].get("/api/history/activity?scope=org")).body)).not.toContain(admin.email);
  // a sibling portal in the same organisation sees none of it
  const sibling = (await admin.post("/api/portals", { name: `Sibling ${w.run}` })).body;
  admin.portal = sibling.id;
  const inSibling = await admin.get("/api/history/activity");
  admin.portal = null;
  expect(inSibling.status).toBe(200);
  expect((inSibling.body as any[]).some((a: any) => a.what === "Ran a match")).toBe(false);
}, 60000);

test("the same file can be in two portals of one organisation, each with its own record: a second upload used to crash", async () => {
  const [admin] = w.users, f = () => new File([readFileSync(join(import.meta.dirname, "fixtures/journey/JD0151.docx"))], "JD0151.docx");
  const portal = (await admin.post("/api/portals", { name: `Twin ${w.run}` })).body;
  admin.portal = portal.id;
  const again = await admin.upload(f(), { kind: "jd" });
  expect(again.status).toBe(202);
  const recordId = await (async () => { for (let i = 0; i < 300; i++) { const d = (await admin.get(`/api/documents/${again.body.id}`)).body; if (d.status === "published") return d.recordId; await sleep(100); } })();
  expect(recordId).not.toBe(jobId);
  expect((await admin.get("/api/jobs")).body.items.map((j: any) => j.id)).toEqual([recordId]);
  expect((await admin.upload(f(), { kind: "jd" })).body.duplicate).toBe(true);   // within one portal it is still one document
  admin.portal = null;
  expect((await admin.get("/api/jobs")).body.items.map((j: any) => j.id)).toEqual([jobId]);
}, 60000);

test("status per job (9 Nov 2026): a hiring manager sees which job a visible candidate is shortlisted for and the job's shortlist, sees nothing of those marked not suitable, and can set no status", async () => {
  const [admin, , hr] = w.users;
  expect((await put(admin, "/api/applications", { candidateId: shortlisted.id, jobId, status: "interviewed" })).status).toBe(200);   // further along than the shortlist: still in sight
  expect((await put(admin, "/api/applications", { candidateId: hidden.id, jobId, status: "declined" })).status).toBe(200);
  expect((await hr.get(`/api/candidates/${shortlisted.id}`)).status).toBe(200);
  expect((await hr.get(`/api/candidates/${hidden.id}`)).status).toBe(404);
  expect((await hr.get("/api/applications")).body.map((x: any) => [x.candidateId, x.status])).toEqual([[shortlisted.id, "interviewed"]]);
  expect((await hr.get(`/api/jobs/${jobId}/shortlist`)).body.map((r: any) => r.candidate.id)).toEqual([shortlisted.id]);
  expect((await put(hr, "/api/applications", { candidateId: shortlisted.id, jobId, status: "hired" })).status).toBe(403);
  expect((await put(admin, "/api/applications", { candidateId: shortlisted.id, jobId, status: null })).status).toBe(200);   // off every shortlist: out of sight on the next request
  expect((await hr.get(`/api/candidates/${shortlisted.id}`)).status).toBe(404);
});
