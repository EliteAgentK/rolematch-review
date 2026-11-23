import { expect, test } from "vitest";
import { consume, limitOf } from "../src/ratelimit";

// Found by 2,000 people in one portal: fixed tenant limits meant about 200 active people, and an office behind one address was capped at about 100. A tenant's limits grow with the tenant; one person's do not.
test("a portal's limit is its base until enough people are in it, then grows with them", () => {
  expect(limitOf("api_portal", 10).limit).toBe(3000);
  expect(limitOf("api_portal", 2000).limit).toBe(60000);
  expect(limitOf("status_portal", 2000).limit).toBe(24000);
});
test("one person's own limit does not grow, however large their portal", () => {
  expect(limitOf("user", 2000).limit).toBe(limitOf("user").limit);
  expect(limitOf("status_user", 2000).limit).toBe(limitOf("status_user").limit);
});
test("one portal's use does not count against another of the same size", async () => {
  for (let i = 0; i < 3; i++) await consume("match_portal", "portal-one", 1, 5);
  const before = limitOf("match_portal", 5).limit;
  const other = await consume("match_portal", "portal-two", 1, 5);
  expect(other.allowed).toBe(true); expect(other.remaining).toBe(before - 1);
});
test("many requests past a small portal's limit are refused, and the same number is fine for a large one", async () => {
  const small = limitOf("match_portal", 1).limit; let refused = 0, big = 0;
  for (let i = 0; i < small + 5; i++) if (!(await consume("match_portal", "small-portal", 1, 1)).allowed) refused++;
  expect(refused).toBe(5);
  for (let i = 0; i < small + 5; i++) if (!(await consume("match_portal", "large-portal", 1, 1000)).allowed) big++;
  expect(big).toBe(0);
});
test("a request claiming a session has the signed-in address limit, far above the plain one", () => {
  expect(limitOf("ip_signed_in").limit).toBeGreaterThanOrEqual(limitOf("ip").limit * 10);
});
