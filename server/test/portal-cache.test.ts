import { expect, test } from "vitest";
import { forgetPortal, limitPortalCache, portalCached, portalCacheHeld } from "../src/portalCache";

// X4. The two things that must never go wrong: one portal's answer reaching another, and a failure being kept.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("one portal's answer never reaches another", async () => {
  const a = await portalCached("portal-a", "capacity", 1000, async () => "A"), b = await portalCached("portal-b", "capacity", 1000, async () => "B");
  expect([a, b]).toEqual(["A", "B"]);
  expect(await portalCached("portal-a", "capacity", 1000, async () => "wrong")).toBe("A");
});
test("the same portal with a different kind is a different answer", async () => {
  await portalCached("p-kinds", "capacity", 1000, async () => 1);
  expect(await portalCached("p-kinds", "documents", 1000, async () => 2)).toBe(2);
});
test("people asking at once share one query, and it is asked again when the time is up", async () => {
  let reads = 0; const read = async () => { reads++; await sleep(20); return reads; };
  const all = await Promise.all(Array.from({ length: 50 }, () => portalCached("p-once", "x", 60, read)));
  expect(reads).toBe(1); expect(new Set(all).size).toBe(1);
  await sleep(80);
  await portalCached("p-once", "x", 60, read);
  expect(reads).toBe(2);
});
test("a failure is not kept: the next person asks again", async () => {
  await expect(portalCached("p-fail", "x", 5000, async () => { throw new Error("no"); })).rejects.toThrow("no");
  await sleep(0);
  expect(await portalCached("p-fail", "x", 5000, async () => "fine")).toBe("fine");
});
test("forgetting one portal leaves others, including one whose id begins the same", async () => {
  await portalCached("p1", "x", 5000, async () => "one"); await portalCached("p11", "x", 5000, async () => "eleven");
  forgetPortal("p1");
  expect(await portalCached("p1", "x", 5000, async () => "new")).toBe("new");
  expect(await portalCached("p11", "x", 5000, async () => "wrong")).toBe("eleven");
});

test("a slow answer is still shared: the time counts from when it arrives (found under load)", async () => {
  let reads = 0; const read = async () => { reads++; await sleep(80); return reads; };
  const first = portalCached("p-slow", "x", 30, read);
  await sleep(50);   // longer than the cache time, while the first is still being asked
  const second = portalCached("p-slow", "x", 30, read);
  expect(await first).toBe(1); expect(await second).toBe(1); expect(reads).toBe(1);
});

test("someone who knows a change has happened gets a new answer, and it is kept for the others", async () => {
  let reads = 0; const read = async () => ++reads;
  expect(await portalCached("p-fresh", "board", 5000, read)).toBe(1);
  expect(await portalCached("p-fresh", "board", 5000, read)).toBe(1);
  expect(await portalCached("p-fresh", "board", 5000, read, { fresh: true })).toBe(2);
  expect(await portalCached("p-fresh", "board", 5000, read)).toBe(2);
});

test("large answers stay within the memory limit: the oldest make room, and one too large to keep is still answered (found under load)", async () => {
  const size = (t: string) => t.length, text = (n: number) => "x".repeat(n);
  const before = portalCacheHeld(); limitPortalCache(before + 250);
  try {
    await portalCached("p-big1", "b", 5000, async () => text(100), { sizeOf: size });
    await portalCached("p-big2", "b", 5000, async () => text(100), { sizeOf: size });
    await portalCached("p-big3", "b", 5000, async () => text(100), { sizeOf: size });
    await sleep(0);
    expect(portalCacheHeld() - before).toBeLessThanOrEqual(250);
    expect(await portalCached("p-big1", "b", 5000, async () => "read again", { sizeOf: size })).toBe("read again");
    await sleep(0);
    expect((await portalCached("p-big4", "b", 5000, async () => text(1000), { sizeOf: size })).length).toBe(1000);
    await sleep(0);
    expect(portalCacheHeld() - before).toBeLessThanOrEqual(250);
    forgetPortal("p-big1"); forgetPortal("p-big2"); forgetPortal("p-big3"); forgetPortal("p-big4");
    expect(portalCacheHeld()).toBe(before);
  } finally { limitPortalCache(256 * 1024 * 1024); }
});

test("a query that runs each time it is awaited still runs once (found under load: the library's queries behave this way)", async () => {
  let runs = 0; const query = { then(ok: (v: number) => void) { runs++; ok(runs); } };
  const all = await Promise.all(Array.from({ length: 20 }, () => portalCached("p-thenable", "x", 1000, () => query as any)));
  expect(runs).toBe(1); expect(new Set(all).size).toBe(1);
});
