import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// Register R101. History is permanent. Deleting a record removes the person's data and leaves a line saying who uploaded it, who deleted it and when, with no name and no file name, so a privacy deletion can still be honoured.
// Everyone in a portal can read its history; nobody can change it, and another portal or organisation sees none of it.
let w: World, other: World;
const file = (n: string) => new File([readFileSync(join(import.meta.dirname, "fixtures/journey", n))], n);
const published = async (u: World["users"][0], id: string) => { for (let i = 0; i < 300; i++) { const d = (await u.get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(100); } throw new Error("not published"); };
beforeAll(async () => {
  w = await makeWorld(8990, 2, { SIGNUP_REQUIRE_CODE: "false" }); other = await makeWorld(8991, 1, { SIGNUP_REQUIRE_CODE: "false" });
  // the kit adds people as organisation administrators: make the second one really a recruiter, so these tests prove what an ordinary member can do
  const s = w.tdb.schema, email = w.users[1].email;
  await w.admin.unsafe(`update "${s}".members set role = 'recruiter' where email = $1`, [email]);
  await w.admin.unsafe(`update "${s}".portal_members set role = 'recruiter' where user_id = (select user_id from "${s}".members where email = $1)`, [email]);
  await sleep(11_000);   // membership is cached for ten seconds
}, 300000);
afterAll(async () => { await w?.stop(); await other?.stop(); }, 120000);

test("deleting a record keeps its history line, without the person's name or the file's name", async () => {
  const [admin, recruiter] = w.users;
  const doc = (await recruiter.upload(file("CV0501.docx"), { kind: "cv" })).body.id, id = await published(recruiter, doc);
  const candidateName = (await recruiter.get(`/api/candidates/${id}`)).body.name;
  expect((await admin.get("/api/history/uploads")).body.find((h: any) => h.id === doc)).toBeTruthy();
  expect((await admin.del(`/api/candidates/${id}`)).status).toBeLessThan(300);
  const list = (await admin.get("/api/history/uploads")).body, line = list.find((h: any) => h.id === doc);
  expect(line).toMatchObject({ outcome: "deleted", kind: "cv", uploadedBy: recruiter.email, deletedBy: admin.email, recordId: null });
  expect(line.deletedAt).toBeTruthy();
  const text = JSON.stringify(line);
  expect(text).not.toContain("CV0501");
  expect(text).not.toContain(candidateName);
  // the person's data is really gone
  expect((await admin.get(`/api/candidates/${id}`)).status).toBe(404);
  expect((await admin.get(`/api/documents/${doc}`)).status).toBe(404);
}, 120000);

test("the database refuses to change or remove a history line", async () => {
  const s = w.tdb.schema, [row] = await w.admin.unsafe(`select id from "${s}".upload_history_removed limit 1`);
  expect(row).toBeTruthy();
  await expect(w.admin.unsafe(`delete from "${s}".upload_history_removed where id = $1`, [row.id])).rejects.toThrow(/append-only/);
  await expect(w.admin.unsafe(`update "${s}".upload_history_removed set deleted_by = 'someone else' where id = $1`, [row.id])).rejects.toThrow(/append-only/);
}, 30000);

test("everyone in a portal can read its uploads and invitations; another organisation sees none of it", async () => {
  const [admin, recruiter] = w.users, address = `seen-${w.run}@example.test`;
  const made = (await admin.post("/api/portal/invitations", { emails: [address], role: "hiring_manager" })).body[0];
  const asRecruiter = await recruiter.get("/api/history/invitations");
  expect(asRecruiter.status).toBe(200);
  expect(asRecruiter.body.some((i: any) => i.id === made.id)).toBe(true);
  expect((await recruiter.get("/api/history/invitations?scope=org")).status).toBe(403);   // the whole organisation stays with its administrators
  const outsider = other.users[0];
  for (const path of ["/api/history/invitations", "/api/history/uploads", "/api/history/invitations?scope=org", "/api/history/uploads?scope=org"]) {
    const text = JSON.stringify((await outsider.get(path)).body);
    expect(text).not.toContain(made.id); expect(text).not.toContain(address); expect(text).not.toContain(admin.email);
  }
}, 60000);

test("everyone in a portal can see who is on the team and its invitations, but only an administrator can change them", async () => {
  const [admin, recruiter] = w.users, address = `team-${w.run}@example.test`;
  const made = (await admin.post("/api/portal/invitations", { emails: [address], role: "recruiter" })).body[0];
  const seen = (await recruiter.get("/api/portal/members")).body;
  expect(seen.canManage).toBe(false);
  expect(seen.members.map((m: any) => m.email)).toEqual(expect.arrayContaining([admin.email, recruiter.email]));
  expect(seen.invitations.some((i: any) => i.id === made.id)).toBe(true);
  expect(JSON.stringify(seen.invitations)).not.toMatch(/token/i);   // a link is a secret: it is never shown, even to an administrator
  const target = seen.members.find((m: any) => m.email === admin.email).userId;
  expect((await recruiter.post(`/api/portal/invitations/${made.id}/revoke`, {})).status).toBe(403);
  expect((await recruiter.post(`/api/portal/invitations/${made.id}/resend`, {})).status).toBe(403);
  expect((await recruiter.post("/api/portal/invitations", { emails: [`x-${address}`], role: "admin" })).status).toBe(403);
  expect((await recruiter.del(`/api/portal/members/${target}`)).status).toBe(403);
  expect((await recruiter.req(`/api/portal/members/${target}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "hiring_manager" }) })).status).toBe(403);
  expect((await recruiter.get("/api/org/people")).status).toBe(403);   // other portals of the organisation stay with its administrators
}, 60000);

test("nothing can delete history through the service: there is no such route", async () => {
  const [admin] = w.users, before = (await admin.get("/api/history/uploads")).body.length;
  for (const path of ["/api/history/uploads", "/api/history/invitations"]) expect((await admin.del(path)).status).toBeGreaterThanOrEqual(404);
  expect((await admin.get("/api/history/uploads")).body.length).toBe(before);
}, 30000);
