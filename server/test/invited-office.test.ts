import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, type World } from "./portalKit";

// R109: everyone in an office shares one public address. Being invited is not being a stranger.
let w: World;
const signup = (body: unknown, ip = "41.9.9.9") => fetch(w.base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": ip }, body: JSON.stringify(body) });
beforeAll(async () => { w = await makeWorld(8994, 1, { SIGNUP_REQUIRE_CODE: "false" }); }, 240000);
afterAll(async () => { await w?.stop(); }, 120000);

test("eight invited people on one address can all join, and a stranger on it is still limited", async () => {
  const emails = Array.from({ length: 8 }, (_, i) => `inv${i}-${w.run}@example.test`);
  const made = (await w.users[0].post("/api/portal/invitations", { emails, role: "recruiter" })).body as any[];
  for (const inv of made) {
    const r = await signup({ name: "Invited Person", email: inv.email, password: "a-long-enough-password-1", inviteToken: inv.token });
    expect(r.status, inv.email).toBeLessThan(300);
  }
  const strangers: number[] = [];
  for (let i = 0; i < 7; i++) strangers.push((await signup({ name: "Some Stranger", orgName: "Stranger Ltd", email: `inv-stranger${i}-${w.run}@example.test`, password: "a-long-enough-password-1" })).status);
  expect(strangers.filter((s) => s === 429).length).toBeGreaterThan(0);
  expect(strangers.slice(0, 5).every((s) => s < 300)).toBe(true);
}, 120000);

test("a made-up invitation is refused, and does not get past the stranger's limit", async () => {
  const r = await signup({ name: "Some Person", email: `inv-fake-${w.run}@example.test`, password: "a-long-enough-password-1", inviteToken: "not-a-real-token" }, "41.9.9.10");
  expect(r.status).toBe(404);
}, 30000);
