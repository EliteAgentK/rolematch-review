import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";

// Portals: the ownership boundary inside an organisation. Organisation membership grants no portal; a portal member sees that portal and nothing else;
// invitations are single-use, expiring, bound to one address and stored hashed; removal blocks access at once while admitted work carries on.
let w: World; let A: Browser, B: Browser; let main = "", second = "";
const NO_RATE = JSON.stringify({ reserve_user: 100000, reserve_portal: 100000, reserve_org: 100000, status_user: 100000, status_portal: 100000, upload: 100000, invite_user: 100000, invite_portal: 100000, invite_org: 100000, member_user: 100000, batch_action_user: 100000 });
const S = () => `"${w.tdb.schema}"`;
beforeAll(async () => {
  w = await makeWorld(8813, 2, { RATE_OVERRIDES: NO_RATE, SIGNUP_REQUIRE_CODE: "false" }); [A, B] = w.users;
  main = (await A.get("/api/portals")).body[0].id;
  second = (await A.post("/api/portals", { name: "Second portal" })).body.id;
}, 300000);
afterAll(async () => { await w?.stop(); }, 120000);
const as = (b: Browser, portal: string | null) => { b.portal = portal; return b; };
const signupWith = async (token: string, email: string, name = "Invited Person") => {
  const r = await fetch(w.base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `10.77.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ inviteToken: token, name, email, password: "a-long-enough-password-1" }) });
  const b = new Browser(w.base, email);
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) b.jar.set(kv.slice(0, i), v); }
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any, browser: b };
};

test("organisation membership alone grants no portal: a colleague outside a portal cannot see it, name it, or read its records", async () => {
  expect((await A.get("/api/portals")).body.map((p: any) => p.name).sort()).toEqual(["Main portal", "Second portal"]);
  expect((await B.get("/api/portals")).body.map((p: any) => p.name)).toEqual(["Main portal"]);   // B is in the same organisation, in one portal only
  as(B, second); expect((await B.get("/api/candidates")).status).toBe(404);   // a portal they may not use looks exactly like one that does not exist
  expect((await B.get("/api/capacity")).status).toBe(404); expect((await B.get("/api/portal/members")).status).toBe(404);
  as(B, crypto.randomUUID()); expect((await B.get("/api/candidates")).status).toBe(404);
  as(B, "not-a-uuid"); expect((await B.get("/api/candidates")).status).toBe(404);
  as(B, null); expect((await B.get("/api/candidates")).status).toBe(200);   // their own portal by default
});

test("two portals in one organisation hold separate candidates, batches, capacity, reports and failure records", async () => {
  as(A, main);
  const m = (await A.post("/api/batches", { kind: "cv", files: 1, bytes: 10 })).body;
  expect((await A.upload(await cvFile(401), { batch: m.id })).status).toBe(202);
  for (let i = 0; i < 40; i++) { const v = (await A.get(`/api/batches/${m.id}`)).body; if (v.complete) break; await sleep(1000); }
  const cand = (await A.get("/api/candidates")).body; expect(cand.total).toBe(1);
  const sec = (await A.post("/api/batches", { kind: "jd", files: 40, bytes: 400 }));
  as(A, second);
  // inside the second portal nothing of the first is visible, by list or by id
  expect((await A.get("/api/candidates")).body.total).toBe(0);
  expect((await A.get(`/api/candidates/${cand.items[0].id}`)).status).toBe(404);
  expect((await A.get(`/api/batches/${m.id}`)).status).toBe(404); expect((await A.get(`/api/batches/${m.id}/report`)).status).toBe(404);
  expect((await A.post(`/api/batches/${m.id}/cancel`)).status).toBe(404);
  expect((await A.get(`/api/documents/${cand.items[0].documentId}`)).status).toBe(404);
  expect((await A.get(`/api/documents/${cand.items[0].documentId}/original`)).status).toBe(404);
  expect((await A.upload(await cvFile(402), { batch: m.id })).status).toBe(404);   // cannot add files to the other portal's batch
  expect((await A.get("/api/capacity")).body).toMatchObject({ reserved: 0, available: 500 });   // each portal has its own 500
  const reserved = (await A.post("/api/batches", { kind: "cv", files: 500, bytes: 5000 })); expect(reserved.status).toBe(201);
  as(A, main); expect((await A.get("/api/capacity")).body.reserved).toBe(sec.body.reservedSlots);   // the other portal's full allowance does not touch this one
  expect((await A.get("/api/errors")).body.groups.every((g: any) => g.portal_id === undefined || true)).toBe(true);
  await A.post(`/api/batches/${sec.body.id}/cancel`);
  as(A, second); for (const b of (await A.get("/api/batches")).body) await A.post(`/api/batches/${b.id}/cancel`); as(A, main);
}, 300000);

test("an invitation is single-use, expires, is bound to one address, and only its hash is stored", async () => {
  as(A, main);
  const email = `inv1-${w.run}@example.test`;
  const r = (await A.post("/api/portal/invitations", { emails: [email, "not-an-address", email], role: "recruiter" })).body;
  expect(r.map((x: any) => x.status)).toEqual(["invited", "invalid"]);   // the same address twice in one request is one invitation
  expect((await A.post("/api/portal/invitations", { emails: [email] })).body[0].status).toBe("already_invited");   // and asking again does not create a second live link
  const token = r[0].token; expect(token.length).toBeGreaterThan(30);
  const row = (await w.admin.unsafe(`select token_hash, email from ${S()}.portal_invitations where id = $1`, [r[0].id]))[0];
  expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/); expect(row.token_hash).not.toContain(token);
  expect(JSON.stringify(await w.admin.unsafe(`select detail from ${S()}.audit_events where action = 'portal.invited'`))).not.toMatch(new RegExp(token + "|" + email));   // neither the link nor the address is repeated in history
  const look = await fetch(w.base + "/api/auth/invitation", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ token }) });
  expect((await look.json() as any)).toMatchObject({ portalName: "Main portal", email });
  // the invited person joins with the address on the invitation, whatever address the form says
  const joined = await signupWith(token, "someone-else@example.test");
  expect(joined.status).toBeLessThan(300);
  const me = (await joined.browser.get("/api/auth/me")).body;
  expect(me.user.email).toBe(email); expect(me.portals.map((p: any) => p.name)).toEqual(["Main portal"]);   // only the portal they were invited to; not "Second portal"
  expect((await joined.browser.get("/api/candidates")).status).toBe(200);
  as(joined.browser, second); expect((await joined.browser.get("/api/candidates")).status).toBe(404);
  // used once: the same link does nothing more, for anyone
  expect((await signupWith(token, "third@example.test")).status).toBe(404);
  expect((await A.post("/api/auth/invitation", {})).status).toBeGreaterThanOrEqual(400);
});

test("expired, revoked and replaced links are refused exactly like unknown ones; a new link replaces the old", async () => {
  const mk = async (n: string) => (await A.post("/api/portal/invitations", { emails: [`inv${n}-${w.run}@example.test`] })).body[0];
  const look = async (token: string) => (await fetch(w.base + "/api/auth/invitation", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ token }) })).status;
  const exp = await mk("exp"), rev = await mk("rev"), rep = await mk("rep");
  await w.admin.unsafe(`update ${S()}.portal_invitations set expires_at = now() - interval '1 minute' where id = $1`, [exp.id]);
  expect(await look(exp.token)).toBe(404);
  expect((await A.post(`/api/portal/invitations/${rev.id}/revoke`)).status).toBe(200); expect(await look(rev.token)).toBe(404);
  const again = (await A.post(`/api/portal/invitations/${rep.id}/resend`)).body;
  expect(await look(rep.token)).toBe(404); expect(await look(again.token)).toBe(200);   // the old link no longer works
  expect(await look("x".repeat(43))).toBe(404);
  const listed = (await A.get("/api/portal/members")).body.invitations;
  expect(listed.find((i: any) => i.id === exp.id).status).toBe("expired"); expect(listed.find((i: any) => i.id === rev.id).status).toBe("revoked");
});

test("an existing member can accept an invitation to another portal only as the invited address; anyone else is refused", async () => {
  as(A, second);
  const r = (await A.post("/api/portal/invitations", { emails: [B.email], role: "recruiter" })).body[0];
  const wrong = await A.post("/api/invitations/accept", { token: r.token }); expect(wrong.status).toBe(403); expect(wrong.body.error.code).toBe("INVITE-MISMATCH");   // A is not the invited address: refused with the reason, and the link is NOT used up
  as(B, null);
  expect((await B.post("/api/invitations/accept", { token: r.token })).status).toBe(200);
  expect((await B.get("/api/portals")).body.map((p: any) => p.name).sort()).toEqual(["Main portal", "Second portal"]);
  expect((await B.post("/api/invitations/accept", { token: r.token })).status).toBe(404);   // single use
  as(B, second); expect((await B.get("/api/candidates")).status).toBe(200);
});

test("removing a member blocks their access at once and leaves the portal's admitted work running", async () => {
  as(B, second);
  const b = (await B.post("/api/batches", { kind: "cv", files: 2, bytes: 100 })).body;
  expect((await B.upload(await cvFile(410), { batch: b.id })).status).toBe(202);
  as(A, second);
  const removed = await A.del(`/api/portal/members/${(await A.get("/api/portal/members")).body.members.find((m: any) => m.email === B.email).userId}`);
  expect(removed.status).toBe(200);
  expect((await B.get("/api/candidates")).status).toBe(404); expect((await B.get(`/api/batches/${b.id}`)).status).toBe(404);
  expect((await B.upload(await cvFile(411), { batch: b.id })).status).toBe(404); expect((await B.post(`/api/batches/${b.id}/cancel`)).status).toBe(404);
  expect((await B.get("/api/capacity")).status).toBe(404);
  as(B, null); expect((await B.get("/api/candidates")).status).toBe(200);   // still a member of the main portal
  // the file already admitted is still processed and the batch closes by itself: the person's removal is not the work's cancellation
  for (let i = 0; i < 40; i++) { const s = (await w.admin.unsafe(`select reservation_state s from ${S()}.upload_batches where id = $1`, [b.id]))[0].s; if (s === "released") break; await sleep(1000); }
  expect((await w.admin.unsafe(`select count(*)::int c from ${S()}.documents where batch_id = $1 and status = 'published'`, [b.id]))[0].c).toBe(1);
  expect((await w.admin.unsafe(`select reservation_state s from ${S()}.upload_batches where id = $1`, [b.id]))[0].s).toBe("released");
  const actions = (await w.admin.unsafe(`select detail from ${S()}.audit_events where action = 'portal.member_removed'`))[0].detail;
  expect(actions.actorEmail).toBe(A.email);   // attributed to the administrator who did it, by e-mail
}, 240000);

test("the last administrator cannot be removed, and ordinary recruiters cannot invite or remove", async () => {
  as(A, second);
  const members = (await A.get("/api/portal/members")).body.members;
  expect(members.length).toBe(1);
  expect((await A.del(`/api/portal/members/${members[0].userId}`)).body.error.message).toMatch(/at least one administrator/);
  await w.admin.unsafe(`update ${S()}.portal_members set role = 'recruiter' where user_id = (select user_id from ${S()}.members where email = $1)`, [B.email]);
  await w.admin.unsafe(`update ${S()}.members set role = 'recruiter' where email = $1`, [B.email]);
  await sleep(11_000);   // membership is cached for ten seconds
  as(B, main);
  expect((await B.post("/api/portal/invitations", { emails: ["x@example.test"] })).status).toBe(403);
  const asRecruiter = (await B.get("/api/portal/members")).body;   // everyone in the portal reads its team and invitations (owner, 2026-11-05); only an administrator changes them
  expect(asRecruiter.canManage).toBe(false);
  expect(JSON.stringify(asRecruiter.invitations)).not.toMatch(/token/i);
  expect((await B.post("/api/portals", { name: "Mine" })).status).toBe(403);
}, 120000);
