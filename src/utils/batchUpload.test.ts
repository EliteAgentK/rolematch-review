import { expect, test } from "vitest";
import { chooseFiles, sendBatch } from "./batchUpload";

const noSleep = async () => {};
test("only a window of files is in flight: the next file goes in as an earlier one finishes", async () => {
  let inFlight = 0, peak = 0; const order: string[] = [];
  const files = Array.from({ length: 20 }, (_, i) => `f${i}`);
  // The "server" finishes one file every time it is asked how many are in flight
  const r = await sendBatch(files, {
    name: (f) => f, window: 3, sleep: noSleep,
    send: async (f) => { inFlight++; peak = Math.max(peak, inFlight); order.push(f); return {}; },
    inFlight: async () => { inFlight = Math.max(0, inFlight - 2); return inFlight; },
  });
  expect(r.sent).toBe(20); expect(order).toEqual(files); expect(peak).toBeLessThanOrEqual(3);
});

test("busy signals are waited out, a refusal is recorded and the rest continue, a duplicate is counted", async () => {
  let n = 0; const waits: number[] = [];
  const r = await sendBatch(["a", "b", "c", "d"], {
    name: (f) => f, sleep: async (ms) => { waits.push(ms); }, inFlight: async () => 0,
    send: async (f) => {
      if (f === "a" && n++ === 0) throw Object.assign(new Error("slow down"), { status: 429, retryAfterSec: 7 });
      if (f === "b") throw Object.assign(new Error("not a document"), { status: 415 });
      return { duplicate: f === "c" };
    },
  });
  expect(waits.length).toBe(1); expect(waits[0]).toBeGreaterThanOrEqual(7000); expect(waits[0]).toBeLessThanOrEqual(9100);   // the server's 7 s plus up to 30% jitter, so many browsers do not return together
  expect(r.sent).toBe(3); expect(r.duplicates).toBe(1); expect(r.refused).toEqual([{ fileName: "b", message: "not a document" }]);
});

test("a bounded number of busy waits, then the file is refused instead of looping for ever", async () => {
  const r = await sendBatch(["a"], { name: (f) => f, sleep: noSleep, inFlight: async () => 0, maxBusyWaits: 3, send: async () => { throw Object.assign(new Error("busy"), { status: 429 }); } });
  expect(r.sent).toBe(0); expect(r.refused.length).toBe(1);
});

test("a cancelled or full batch (409) stops sending; aborting stops sending", async () => {
  const sent: string[] = [];
  const a = await sendBatch(["a", "b", "c"], { name: (f) => f, concurrency: 1, sleep: noSleep, inFlight: async () => 0, send: async (f) => { sent.push(f); if (f === "b") throw Object.assign(new Error("cancelled"), { status: 409 }); return {}; } });
  expect(a.stopped).toBe(true); expect(sent).toEqual(["a", "b"]);
  const signal = { aborted: false };
  const b = await sendBatch(["a", "b", "c"], { name: (f) => f, concurrency: 1, sleep: noSleep, inFlight: async () => 0, signal, send: async () => { signal.aborted = true; return {}; } });
  expect(b.stopped).toBe(true); expect(b.sent).toBe(1);
});

// Code review, 16 Nov 2026, G-M4: every error without a server answer was taken for a lost connection and retried for ever. A file changed, moved or
// stored online only after it was chosen fails in the browser the same way (Chrome's ERR_UPLOAD_FILE_CHANGED), so that lane retried the same file for ever
// and the batch said "waiting for the connection" while the person was online. When the server can be reached, the failure is the file's: tried a few
// times, then refused with a reason, and the rest of the batch carries on.
test("a file the browser cannot send while the server is reachable is refused after a few tries; the batch finishes", async () => {
  const tries: Record<string, number> = {};
  const r = await sendBatch(["a", "changed.pdf", "c"], {
    name: (f) => f, concurrency: 1, sleep: noSleep, untilOnline: noSleep, inFlight: async () => 0, reachable: async () => true,
    send: async (f) => { tries[f] = (tries[f] ?? 0) + 1; if (f === "changed.pdf") throw new TypeError("Failed to fetch"); return {}; },
  });
  expect(r.sent).toBe(2); expect(r.stopped).toBe(false); expect(r.paused).toBe(false);
  expect(tries["changed.pdf"]).toBe(3);
  expect(r.refused).toEqual([{ fileName: "changed.pdf", message: "This file could not be read from your computer. It may have been changed, moved or be stored online only since it was chosen. Choose it again." }]);
});

test("while the server cannot be reached it is still a lost connection: paused, never refused", async () => {
  let down = 30;
  const r = await sendBatch(["a"], { name: (f) => f, sleep: noSleep, untilOnline: noSleep, inFlight: async () => 0, reachable: async () => down <= 0,
    send: async () => { if (down-- > 0) throw new TypeError("Failed to fetch"); return {}; } });
  expect(r.sent).toBe(1); expect(r.refused).toEqual([]);
});

test("choosing files from a folder keeps supported documents and reports what was left out", () => {
  const f = (name: string, size = 10) => new File([new Uint8Array(size)], name);
  const r = chooseFiles([f("a.pdf"), f("b.DOCX"), f(".DS_Store"), f("~$b.docx"), f("c.txt"), f("d.pdf", 0), f("e.pdf", 999)], [".pdf", ".docx"], 100);
  expect(r.files.map((x) => x.name)).toEqual(["a.pdf", "b.DOCX"]);
  expect(r.skipped).toEqual([{ fileName: "c.txt", reason: "unsupported type" }, { fileName: "d.pdf", reason: "empty" }, { fileName: "e.pdf", reason: "too large" }]);
});

// Owner, 10 Nov 2026: "when Wi-Fi goes down, I don't want this thing automatically saying no, you can't do this ... it just needs to pause, and as soon
// as they're connected again, it needs to follow through. But they should always have the option of cancelling."
test("a lost connection pauses the batch and resumes it, however long it lasts: every file arrives once and none is refused", async () => {
  const sent: string[] = [], seen: boolean[] = []; let down = 100;   // the connection fails 100 times in a row: far past any bounded number of tries
  const r = await sendBatch(["a", "b", "c"], {
    name: (f) => f, concurrency: 2, sleep: noSleep, untilOnline: noSleep, inFlight: async () => 0, onProgress: (p) => seen.push(p.paused),
    send: async (f) => { if (down-- > 0) throw new TypeError("Failed to fetch"); sent.push(f); return {}; },
  });
  expect(r.sent).toBe(3); expect(r.refused).toEqual([]); expect(r.stopped).toBe(false); expect(r.paused).toBe(false);
  expect([...sent].sort()).toEqual(["a", "b", "c"]);   // each once
  expect(seen).toContain(true);                        // it said it was paused while the connection was down
});

test("Cancel while the connection is down stops the batch; nothing is marked as refused for the lost connection", async () => {
  const signal = { aborted: false }; let tries = 0;
  const r = await sendBatch(["a", "b"], { name: (f) => f, concurrency: 1, sleep: noSleep, untilOnline: async () => { if (++tries === 5) signal.aborted = true; }, inFlight: async () => 0, signal,
    send: async () => { throw new TypeError("Failed to fetch"); } });
  expect(r.stopped).toBe(true); expect(r.sent).toBe(0); expect(r.refused).toEqual([]); expect(r.paused).toBe(false);
});
