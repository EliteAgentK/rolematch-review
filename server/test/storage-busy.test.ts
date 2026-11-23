import { afterEach, expect, test, vi } from "vitest";

// Found by a working Monday: with the file store overloaded, an upload answered 500. It should wait a little, and if the store still cannot take it, say "busy" so the browser's sender tries again, with nothing lost.
process.env.STORE_CONCURRENCY = "2"; process.env.STORE_RETRY_MS = "1";
const load = async () => await import("../src/supabase");
afterEach(() => { vi.unstubAllGlobals(); });

test("a passing failure of the store is tried again, and nobody notices", async () => {
  const { putObject } = await load(); let calls = 0;
  vi.stubGlobal("fetch", async () => { if (++calls < 3) throw new TypeError("fetch failed"); return new Response("{}", { status: 200 }); });
  await putObject("o/1", new Uint8Array([1]), "application/pdf");
  expect(calls).toBe(3);
});
test("a store that stays down is reported as busy, not as a server error", async () => {
  const { putObject, StoreBusy } = await load();
  vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
  await expect(putObject("o/2", new Uint8Array([1]), "application/pdf")).rejects.toBeInstanceOf(StoreBusy);
  vi.stubGlobal("fetch", async () => new Response("no", { status: 503 }));
  await expect(putObject("o/3", new Uint8Array([1]), "application/pdf")).rejects.toBeInstanceOf(StoreBusy);
});
test("a refusal that is not about load is not retried or dressed up", async () => {
  const { putObject, StoreBusy } = await load(); let calls = 0;
  vi.stubGlobal("fetch", async () => { calls++; return new Response("no", { status: 403 }); });
  const e = await putObject("o/4", new Uint8Array([1]), "application/pdf").catch((x) => x);
  expect(e).toBeInstanceOf(Error); expect(e).not.toBeInstanceOf(StoreBusy); expect(calls).toBe(1);
});
test("never more than the limit are sent to the store at once from one server", async () => {
  process.env.STORE_QUEUE = "100";
  const { putObject } = await load(); let now = 0, most = 0;
  vi.stubGlobal("fetch", async () => { most = Math.max(most, ++now); await new Promise((r) => setTimeout(r, 5)); now--; return new Response("{}", { status: 200 }); });
  await Promise.all(Array.from({ length: 12 }, (_, i) => putObject(`o/${i}`, new Uint8Array([1]), "application/pdf")));
  expect(most).toBeLessThanOrEqual(2);
});

test("past a short line at the store, an upload is told busy at once rather than holding the server's hands: waiting uploads once made every page busy", async () => {
  process.env.STORE_QUEUE = "3";
  const { putObject, StoreBusy } = await load(); let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });
  vi.stubGlobal("fetch", async () => { await gate; return new Response("{}", { status: 200 }); });
  const all = Array.from({ length: 30 }, (_, i) => putObject(`q/${i}`, new Uint8Array([1]), "application/pdf").then(() => "stored", (e) => (e instanceof StoreBusy ? "busy" : "other")));
  await new Promise((r) => setTimeout(r, 20)); release();
  const out = await Promise.all(all);
  expect(out.filter((x) => x === "busy").length).toBeGreaterThan(0);
  expect(out.includes("other")).toBe(false);
  expect(out.filter((x) => x === "stored").length).toBeLessThanOrEqual(16 + 16);
});
