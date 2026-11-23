import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, type World } from "./portalKit";

// R113. Past what can be finished, the service says busy at once, keeps answering health checks, and has nothing left to work through afterwards.
let w: World;
beforeAll(async () => { w = await makeWorld(8995, 1, { SIGNUP_REQUIRE_CODE: "false", MAX_IN_FLIGHT: "5", RATE_OVERRIDES: JSON.stringify({ api_portal: 100000, api_org: 100000, status_user: 100000, status_portal: 100000 }) }); }, 240000);
afterAll(async () => { await w?.stop(); }, 120000);

test("over the limit: refused at once and clearly; health still answers; afterwards everything works", async () => {
  const u = w.users[0];
  const crowd = Promise.all(Array.from({ length: 60 }, (_, i) => u.get(i % 2 ? "/api/candidates" : "/api/portal/members")));
  const health = await Promise.all(["/api/ready", "/api/health"].map((p) => fetch(w.base + p).then((r) => r.status)));
  expect(health).toEqual([200, 200]);
  const results = await crowd, busy = results.filter((r) => r.status === 503), fine = results.filter((r) => r.status === 200);
  expect(busy.length).toBeGreaterThan(0);
  expect(fine.length).toBeGreaterThan(0);
  expect(busy.length + fine.length).toBe(60);
  expect(busy[0].body.error.code).toBe("SVC-BUSY");
  expect(JSON.stringify(busy[0].body)).not.toMatch(/stack|sql|postgres/i);
  const after = await u.get("/api/candidates");
  expect(after.status).toBe(200);
}, 120000);

test("a refusal says when to try again", async () => {
  const u = w.users[0];
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => u.req(`/api/candidates?q=word${i}`)));   // searches: the board page is shared now, so it no longer fills the server
  const refused = rs.find((r) => r.status === 503);
  expect(refused?.headers.get("retry-after")).toBe("5");
}, 60000);
