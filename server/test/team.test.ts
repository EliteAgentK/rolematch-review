// People and access: a hiring manager is read-only on the server, role changes keep at least one administrator (also when two administrators act at once),
// leaving a portal or the organisation revokes access at once and keeps the records, a departed person gets no new organisation at sign-in,
// an organisation administrator can recover a portal with no administrator, and the people list is for organisation administrators only.
import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";

let w: World; let U: Browser[];
const PASSWORD = "a-long-enough-password-1";
beforeAll(async () => {
  w = await makeWorld(8816, 4); U = w.users;
  // the kit makes everyone an administrator; here only the first is: the others are ordinary recruiters in the organisation and the portal
  const others = U.slice(1).map((u) => u.email);
  await w.admin.unsafe(`update "${w.tdb.schema}".members set role = 'recruiter' where email = any($1)`, [others]);
  await w.admin.unsafe(`update "${w.tdb.schema}".portal_members pm set role = 'recruiter' from "${w.tdb.schema}".members m where m.user_id = pm.user_id and m.email = any($1)`, [others]);
  await sleep(10500);   // membership caches (10 s) on the server
}, 400000);
afterAll(async () => { await w?.stop(); }, 120000);

const schema = () => `"${w.tdb.schema}"`;
const userId = async (b: Browser) => (await b.get("/api/auth/me")).body.user.userId as string;
const portalOf = async (b: Browser) => (await b.get("/api/portals")).body[0].id as string;
async function published(b: Browser, docId: string) {
  for (let i = 0; i < 90; i++) { const d = (await b.get(`/api/documents/${docId}`)).body; if (d.status !== "processing") return d; await sleep(1000); }
  throw new Error("document never finished");
}
const login = (b: Browser, ip: string) => b.req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email: b.email, password: PASSWORD }) });
const patch = (b: Browser, path: string, body: unknown) => b.req(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a hiring manager can read a shortlisted candidate but not change anything in the portal", async () => {
  const [admin, , , viewer] = U;
  const vid = await userId(viewer);
  expect((await patch(admin, `/api/portal/members/${vid}`, { role: "hiring_manager" })).status).toBe(200);
  await sleep(10500);   // the membership cache on this server was dropped at once; wait out any other copy
  expect((await viewer.get("/api/candidates")).status).toBe(200);
  expect((await viewer.get("/api/portal/members")).status).toBe(200);
  const up = await viewer.upload(await cvFile(951));
  expect(up.status).toBe(403); expect(up.body.error.code).toBe("PERM-READ-ONLY");
  expect((await viewer.post("/api/batches", { kind: "cv", files: 1, bytes: 1000 })).status).toBe(403);
  // a shortlisted candidate: a hiring manager may open it but not edit, delete, review or match with it (hiring-manager.test.ts covers everyone else)
  const doc = await admin.upload(await cvFile(952));
  const rec = (await published(admin, doc.body.id)).recordId as string;
  // shortlisted for a job, as the screens do it: a person's stage is only ever set for a job (production review, 12 Nov 2026)
  const jd = new File(["Financial Accountant\nNorthwind Traders\nJohannesburg\nRequirements\n- BCom Accounting\nResponsibilities\n- Prepare the monthly statements and reconcile the accounts every month."], "team-job.txt", { type: "text/plain" });
  const job = (await published(admin, (await admin.upload(jd, { kind: "jd" })).body.id)).recordId as string;
  expect((await admin.req("/api/applications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId: rec, jobId: job, status: "shortlisted" }) })).status).toBe(200);
  const cand = (await viewer.get(`/api/candidates/${rec}`));
  expect(cand.status).toBe(200);
  expect((await viewer.req(`/api/candidates/${rec}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...cand.body, notes: "x" }) })).status).toBe(403);
  expect((await viewer.del(`/api/candidates/${rec}`)).status).toBe(403);
  expect((await viewer.post(`/api/candidates/${rec}/review`, { version: cand.body.version })).status).toBe(403);
  expect((await admin.get(`/api/candidates/${rec}`)).status).toBe(200);   // nothing changed
}, 240000);

test("role changes never leave a portal without an administrator, even when two administrators demote each other at the same moment", async () => {
  const [a, b] = U;
  const aid = await userId(a), bid = await userId(b);
  expect((await patch(a, `/api/portal/members/${bid}`, { role: "admin" })).status).toBe(200);
  const [r1, r2] = await Promise.all([patch(a, `/api/portal/members/${bid}`, { role: "recruiter" }), patch(b, `/api/portal/members/${aid}`, { role: "recruiter" })]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses[0]).toBe(200); expect([403, 409]).toContain(statuses[1]);   // exactly one wins. The other is refused, as "no longer an administrator" if the first change is seen in time, or by the last-administrator lock if not
  const admins = await w.admin.unsafe(`select count(*)::int n from ${schema()}.portal_members where role = 'admin'`);
  expect(admins[0].n).toBeGreaterThanOrEqual(1);
  // put things back: a is the administrator, b a recruiter
  const winner = r1.status === 200 ? a : b;
  if (winner === b) expect((await patch(b, `/api/portal/members/${aid}`, { role: "admin" })).status).toBe(200);
  await patch(a, `/api/portal/members/${bid}`, { role: "recruiter" });
  const last = await patch(a, `/api/portal/members/${aid}`, { role: "recruiter" });
  expect(last.status).toBe(409); expect((await last.json()).error.code).toBe("LAST-ADMIN");
  expect((await patch(a, `/api/portal/members/${aid}`, { role: "owner" })).status).toBe(400);
  expect((await patch(b, `/api/portal/members/${aid}`, { role: "recruiter" })).status).toBe(403);   // a recruiter cannot change roles
}, 120000);

test("leaving a portal: the last administrator cannot; a recruiter can, loses access at once, and their records stay with the portal", async () => {
  const [a, b] = U;
  const left = await a.post("/api/portal/leave");
  expect(left.status).toBe(409); expect(left.body.error.code).toBe("LAST-ADMIN");
  const doc = await b.upload(await cvFile(953));
  expect(doc.status).toBe(202);
  const rec = (await published(b, doc.body.id)).recordId as string;
  expect((await b.post("/api/portal/leave")).status).toBe(200);
  expect((await b.get("/api/candidates")).status).not.toBe(200);   // no portal any more on this server
  expect((await a.get(`/api/candidates/${rec}`)).status).toBe(200);   // the record stays with the portal
  const audit = await w.admin.unsafe(`select count(*)::int n from ${schema()}.audit_events where action = 'portal.member_left'`);
  expect(audit[0].n).toBe(1);
  // recovery: an organisation administrator puts b back as a portal administrator without any invitation
  const pid = await portalOf(a), bid = await userId(b);
  expect((await a.post(`/api/org/portals/${pid}/admins`, { userId: bid })).status).toBe(200);
  await sleep(500);
  expect((await b.get("/api/candidates")).status).toBe(200);
  expect((await b.post(`/api/org/portals/${pid}/admins`, { userId: bid })).status).toBe(403);   // a portal administrator is not an organisation administrator
}, 240000);

test("a colleague's sign-ins (when, and from which address) cannot be read through the record history route (code review, 16 Nov 2026, A-M4)", async () => {
  const [admin, recruiter] = U, adminId = await userId(admin);
  // The administrator's sign-ins are on the audit log, with the address, as they must be for security.
  expect((await w.admin.unsafe(`select count(*)::int n from ${schema()}.audit_events where action = 'auth.login' and entity_id = $1`, [adminId]))[0].n).toBeGreaterThan(0);
  const asked = await recruiter.get(`/api/audit?entityId=${adminId}`);
  expect(asked.status).toBe(200);
  expect(asked.body).toEqual([]);   // the route is for a candidate's, job's or document's history, never a person's
  expect((await admin.get(`/api/audit?entityId=${adminId}`)).body).toEqual([]);
});

test("the organisation's people: administrators only, names as entered, portals and roles, nothing from another organisation", async () => {
  const [a, b] = U;
  const r = await a.get("/api/org/people");
  expect(r.status).toBe(200);
  expect(r.body.organisation.name).toBe(w.org);
  expect(r.body.people.map((p: any) => p.email).sort()).toEqual(U.map((u) => u.email).sort());
  const one = r.body.people.find((p: any) => p.email === a.email);
  expect(one).toMatchObject({ name: "Kit One", orgRole: "admin" });
  expect(one.portals[0]).toMatchObject({ role: "admin" });
  expect(JSON.stringify(r.body)).not.toMatch(/candidate|skills|@example\.test.*cv/i);
  expect((await b.get("/api/org/people")).status).toBe(403);
});

test("leaving the organisation: the only organisation administrator cannot; a member who has done work can, is signed out, keeps no access, gets no new organisation at sign-in, and their work keeps its attribution", async () => {
  const [a, , c, d] = U;
  const self = await a.post("/api/org/leave");
  expect(self.status).toBe(409); expect(self.body.error.code).toBe("LAST-ADMIN");
  const cid = await userId(c);
  const doc = await c.upload(await cvFile(954));                                                     // a draft that deleted the membership failed here (500): records refer to it
  const rec = (await published(c, doc.body.id)).recordId as string;
  expect((await c.post("/api/org/leave")).status).toBe(200);
  expect((await c.get("/api/candidates")).status).toBe(401);
  const again = await login(c, "10.9.88.1");
  expect(again.status).toBe(401);                                                                    // no organisation, and none is created
  expect((await w.admin.unsafe(`select count(*)::int n from ${schema()}.orgs`))[0].n).toBe(1);
  expect((await w.admin.unsafe(`select left_at is not null as gone from ${schema()}.members where user_id = $1`, [cid]))[0].gone).toBe(true);   // kept for attribution
  expect((await w.admin.unsafe(`select count(*)::int n from ${schema()}.portal_members where user_id = $1`, [cid]))[0].n).toBe(0);
  expect((await w.admin.unsafe(`select count(*)::int n from ${schema()}.audit_events where action = 'org.member_left' and entity_id = $1`, [cid]))[0].n).toBe(1);
  expect((await a.get(`/api/candidates/${rec}`)).status).toBe(200);                                 // the record stays with the portal
  expect(((await a.get("/api/history/uploads")).body as any[]).find((r) => r.id === doc.body.id)?.uploadedBy).toBe(c.email);   // and so does who uploaded it
  expect(((await a.get("/api/org/people")).body.people as any[]).some((p) => p.email === c.email)).toBe(false);
  // an organisation administrator removes someone else, with the same rules; a recruiter cannot
  const did = await userId(d);
  expect((await U[1].req(`/api/org/members/${did}`, { method: "DELETE" })).status).toBe(403);
  expect((await a.req(`/api/org/members/${did}`, { method: "DELETE" })).status).toBe(200);
  expect((await d.get("/api/candidates")).status).toBe(401);
  expect((await w.admin.unsafe(`select count(*)::int n from ${schema()}.audit_events where action = 'org.member_removed' and entity_id = $1`, [did]))[0].n).toBe(1);
}, 180000);

// Code review, 16 Nov 2026, A-M5: removing a portal member took no lock, and removing someone from the organisation locked only the organisation row, so
// neither waited for the other changes that can take away a portal's last administrator. Each now waits on the portal row. The test holds that row from
// outside and checks that both kinds of removal wait for it, and that two administrators removing each other at the same moment leave one administrator.
async function holdingPortal<T>(portalId: string, during: () => Promise<T>): Promise<T> {
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((r) => { release = r; }), isLocked = new Promise<void>((r) => { locked = r; });
  const tx = w.admin.begin(async (q) => { await q.unsafe(`select id from ${schema()}.portals where id = $1 for update`, [portalId]); locked(); await held; });
  await isLocked;
  try { return await during(); } finally { release(); await tx; }
}
const watched = <T,>(p: Promise<T>) => { const t = { done: false, result: p }; p.then(() => { t.done = true; }, () => { t.done = true; }); return t; };
const adminsOf = async (pid: string) => (await w.admin.unsafe(`select count(*)::int n from ${schema()}.portal_members where portal_id = $1 and role = 'admin'`, [pid]))[0].n as number;

test("removing a member, from the portal or the organisation, waits on the portal row, so a portal never loses its last administrator to a race (code review, 16 Nov 2026, A-M5)", async () => {
  const [a, b] = U;
  const pid = await portalOf(a), aid = await userId(a), bid = await userId(b);
  const [{ org_id: oid }] = await w.admin.unsafe(`select org_id from ${schema()}.portals where id = $1`, [pid]);
  const bothAdmins = async () => {
    await w.admin.unsafe(`insert into ${schema()}.portal_members (portal_id, org_id, user_id, role) values ($1, $2, $3, 'admin'), ($1, $2, $4, 'admin') on conflict (portal_id, user_id) do update set role = 'admin'`, [pid, oid, aid, bid]);
    await sleep(10500);   // membership caches
  };
  await bothAdmins();
  // a and b, the portal's two administrators, remove each other at the same moment
  const [one, two] = await holdingPortal(pid, async () => {
    const one = watched(a.del(`/api/portal/members/${bid}`)), two = watched(b.del(`/api/portal/members/${aid}`));
    await sleep(1500);
    expect([one.done, two.done]).toEqual([false, false]);   // both wait for the portal row
    return [one.result, two.result];
  });
  expect([(await one).status, (await two).status].sort()).toEqual([200, 409]);   // exactly one removal; the other would have left no administrator
  expect(await adminsOf(pid)).toBe(1);
  expect((await w.admin.unsafe(`select count(*)::int n from ${schema()}.audit_events where action = 'portal.member_removed'`))[0].n).toBe(1);
  // the organisation administrator removes b from the organisation: that also waits for the portal row
  await bothAdmins();
  const [leaving] = await holdingPortal(pid, async () => {
    const r = watched(a.del(`/api/org/members/${bid}`));
    await sleep(1500);
    expect(r.done).toBe(false);
    return [r.result];   // in an array, so the request is not awaited while the row is still held
  });
  expect((await leaving).status).toBe(200);
  expect(await adminsOf(pid)).toBe(1);
}, 120000);
