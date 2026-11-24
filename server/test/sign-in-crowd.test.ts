// A whole office behind one address signs in at the same moment, and none is refused (owner, 23 Nov 2026: "we should allow as many people signing in at
// the same time, it shouldn't be a cap"; the first load test refused 10 of 50). The address is still stopped after its limit of WRONG passwords, and each
// account still after its five (ratelimit.ts guess: the account counted before the check, the sender only when wrong).
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, type World } from "./portalKit";

const PASSWORD = "a-long-enough-password-1";   // the kit's (portalKit.ts)
let w: World;
// The address may have 6 wrong passwords here (live: 30), so a crowd of 50 shows plainly that right ones are not counted against it.
beforeAll(async () => { w = await makeWorld(8987, 10, { SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true", MAX_IN_FLIGHT: "500", RATE_OVERRIDES: JSON.stringify({ login_ip: 6, ip: 100000 }) }); }, 300000);
afterAll(async () => { await w?.stop(); }, 120000);

const login = (email: string, password: string, ip: string) =>
  fetch(`${w.base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password }) });

test("fifty right sign-ins at the same moment from one address all succeed, though the address may have only six wrong ones", async () => {
  const crowd = await Promise.all(Array.from({ length: 50 }, (_, i) => login(w.users[i % 10].email, PASSWORD, "10.70.0.1")));
  expect(crowd.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
}, 120000);

test("the address is still stopped after its wrong passwords: six are answered, the seventh is refused, even with a right password", async () => {
  for (let i = 1; i <= 6; i++) expect((await login(`nobody-${i}-${w.run}@example.test`, "wrong-password-xyz", "10.71.0.1")).status).toBe(401);
  const after = await login(w.users[0].email, PASSWORD, "10.71.0.1");
  expect(after.status).toBe(429);
  expect(((await after.json()) as any).error.code).toBe("RATE-001");
  expect((await login(w.users[0].email, PASSWORD, "10.71.0.2")).status).toBe(200);   // another address is not held back
}, 120000);
