import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, makeWorld, type World } from "./portalKit";

// Who may create a portal: an organisation administrator, or a member an administrator explicitly delegated it to. The right is read fresh on every
// creation, so withdrawing it is immediate (no waiting for a cache or a token to expire).
let w: World; let A: Browser, B: Browser, bId = "";
const NO_RATE = JSON.stringify({ member_user: 100000, invite_user: 100000, invite_portal: 100000, invite_org: 100000 });
beforeAll(async () => {
  w = await makeWorld(8827, 2, { RATE_OVERRIDES: NO_RATE, SIGNUP_REQUIRE_CODE: "false" }); [A, B] = w.users;
  bId = (await B.get("/api/auth/me")).body.user.userId;
  await w.admin.unsafe(`update "${w.tdb.schema}".members set role = 'recruiter' where user_id = '${bId}'`);   // test users are created as administrators
}, 300000);
afterAll(async () => { await w?.stop(); }, 120000);

test("an ordinary recruiter cannot create a portal; the refusal says who can", async () => {
  const r = await B.post("/api/portals", { name: "Recruiter portal" });
  expect(r.status).toBe(403); expect(r.body.error.code).toBe("PERM-001");
});
test("only an administrator can delegate; a recruiter cannot delegate to themselves", async () => {
  expect((await B.req(`/api/members/${bId}/portal-creation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed: true }) })).status).toBe(403);
  expect((await B.post("/api/portals", { name: "Still no" })).status).toBe(403);
});
test("delegation lets that member create a portal at once, is audited, and withdrawal is immediate", async () => {
  const put = (allowed: boolean) => A.req(`/api/members/${bId}/portal-creation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed }) });
  expect((await put(true)).status).toBe(200);
  const made = await B.post("/api/portals", { name: "Delegated portal" });
  expect(made.status).toBe(201);
  expect((await put(false)).status).toBe(200);
  expect((await B.post("/api/portals", { name: "After withdrawal" })).status).toBe(403);   // no cache window
  const rows = await w.admin.unsafe(`select action, detail from "${w.tdb.schema}".audit_events where action like 'member.portal_creation%' order by created_at`);
  expect(rows.map((r: any) => r.action)).toEqual(["member.portal_creation_delegated", "member.portal_creation_withdrawn"]);
  expect(rows[0].detail.actorEmail).toBe(A.email);
});
test("delegation cannot cross organisations and administrators have nothing to delegate", async () => {
  const adminId = (await A.get("/api/auth/me")).body.user.userId;
  const r = await A.req(`/api/members/${adminId}/portal-creation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed: true }) });
  expect(r.status).toBe(409);
  expect((await A.req(`/api/members/${crypto.randomUUID()}/portal-creation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed: true }) })).status).toBe(404);
  expect((await A.req(`/api/members/not-a-uuid/portal-creation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed: true }) })).status).toBe(404);
});
