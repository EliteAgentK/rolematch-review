import { expect, test } from "vitest";
import { batched } from "../src/lookups";
import { currentOrg, forPortal } from "../src/db";

// X4. Sharing a trip must never mean sharing an answer.
test("everyone gets their own answer, the unknown get the missing value, and it is one trip", async () => {
  let trips = 0; const get = batched<string, string>(async (keys) => { trips++; return new Map(keys.filter((k) => k !== "nobody").map((k) => [k, `answer for ${k}`])); }, "none");
  const r = await Promise.all(["a", "b", "nobody", "a"].map(get));
  expect(r).toEqual(["answer for a", "answer for b", "none", "answer for a"]);
  expect(trips).toBe(1);
});
test("a failed trip fails each caller and the next asks again", async () => {
  let fail = true; const get = batched<string, string>(async (k) => { if (fail) throw new Error("down"); return new Map(k.map((x) => [x, "ok"])); }, "none");
  await expect(Promise.all([get("a"), get("b")])).rejects.toThrow("down");
  fail = false;
  expect(await get("a")).toBe("ok");
});
test("it runs as the platform, not inside the organisation of whoever asked first", async () => {
  let seen: string | null | undefined = "unset"; const get = batched<string, string>(async (k) => { seen = currentOrg(); return new Map(k.map((x) => [x, "ok"])); }, "none");
  await forPortal("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", () => get("a"));
  expect(seen).toBeNull();
});
test("a full batch goes at once", async () => {
  let sizes: number[] = []; const get = batched<number, number>(async (k) => { sizes.push(k.length); return new Map(k.map((x) => [x, x])); }, -1);
  await Promise.all(Array.from({ length: 450 }, (_, i) => get(i)));
  expect(Math.max(...sizes)).toBeLessThanOrEqual(200);
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(450);
});

test("however many ask, one trip at a time goes out, and nobody is left waiting", async () => {
  let out = 0, most = 0, trips = 0; const get = batched<number, number>(async (k) => { out++; trips++; most = Math.max(most, out); await new Promise((r) => setTimeout(r, 20)); out--; return new Map(k.map((x) => [x, x * 2])); }, -1);
  const answers = await Promise.all(Array.from({ length: 500 }, async (_, i) => { await new Promise((r) => setTimeout(r, i % 50)); return get(i); }));
  expect(most).toBe(1);
  expect(answers).toEqual(Array.from({ length: 500 }, (_, i) => i * 2));
  expect(trips).toBeLessThan(20);
});
