// Sends a batch of files so the server's queue is never swamped: only a small window of files is waiting or being read at any moment, and the
// next file goes in as an earlier one finishes (is published as a record or fails). The window is the server's own count, read from the batch,
// so a refresh or a second browser cannot make it send more than the window allows. Nothing here estimates time.
// A lost connection is not a failure (owner, 10 Nov 2026: "it just needs to pause, and as soon as they're connected again, it needs to follow through.
// But they should always have the option of cancelling"): a file that could not reach the server is tried again until it does, however long that takes,
// and is never marked "not sent" for it; `paused` says so while it lasts. Only Cancel (the stop signal) ends the wait.
interface SendResult { duplicate?: boolean }
export interface BatchProgress { sent: number; total: number; duplicates: number; refused: { fileName: string; message: string }[]; stopped: boolean; /** waiting for the connection to come back */ paused: boolean }
export interface BatchDeps<F> {
  name: (file: F) => string;
  send: (file: F) => Promise<SendResult>;
  inFlight: () => Promise<number>;            // files the server has accepted that are waiting or being read
  onProgress?: (p: BatchProgress) => void;
  sleep?: (ms: number) => Promise<void>;
  signal?: { aborted: boolean };
  window?: number;
  concurrency?: number;   // files being uploaded at the same moment (each upload waits on storage, so a few at once is faster)
  maxBusyWaits?: number;
  /** Resolves when the connection may be back (the browser's "online" event), so a paused send resumes at once and not at its next try. */
  untilOnline?: (ms: number) => Promise<void>;
  /** After a send failed with no answer from the server: can the server be reached now? If it can, the failure is the file's, not the connection's. Left
   *  out, every such failure is taken for a lost connection. */
  reachable?: () => Promise<boolean>;
  /** How many times a file the browser could not send (while the server was reachable) is tried before it is refused. */
  maxFileErrors?: number;
}
/** Said for a file the browser could not send while the server could be reached (code review, 16 Nov 2026, G-M4). */
export const FILE_UNREADABLE = "This file could not be read from your computer. It may have been changed, moved or be stored online only since it was chosen. Choose it again.";
const DEFAULT_WINDOW = 8, DEFAULT_LANES = 3;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errorOf = (e: unknown) => { const x = e as { status?: number; message?: string; retryAfterSec?: number }; return { status: x?.status ?? 0, message: x?.message ?? "The server could not be reached.", retryAfterSec: x?.retryAfterSec }; };

export async function sendBatch<F>(files: F[], d: BatchDeps<F>): Promise<BatchProgress> {
  const sleep = d.sleep ?? wait, win = d.window ?? DEFAULT_WINDOW, lanes = Math.max(1, Math.min(d.concurrency ?? DEFAULT_LANES, win));
  const p: BatchProgress = { sent: 0, total: files.length, duplicates: 0, refused: [], stopped: false, paused: false };
  let offline = 0;   // lanes waiting for the connection: `paused` while any is
  const pause = (on: boolean) => { offline = Math.max(0, offline + (on ? 1 : -1)); const now = offline > 0; if (now !== p.paused) { p.paused = now; d.onProgress?.({ ...p }); } };
  // Occupancy = what the server last said was waiting or being read, plus what has gone in since, plus what is being sent right now.
  let base = 0, since = 0, sending = 0, next = 0, asking: Promise<void> | null = null;
  const refresh = () => (asking ??= d.inFlight().then((n) => { base = n; since = 0; }, () => { base = win; since = 0; }).finally(() => { asking = null; }));
  const stop = () => { p.stopped = true; };
  async function lane() {
    while (next < files.length && !p.stopped) {
      if (d.signal?.aborted) return stop();
      if (base + since + sending >= win) { await refresh(); if (base + since + sending >= win) { await sleep(1500); } continue; }
      const file = files[next++]; sending++;
      let busy = 0, waiting = false, tries = 0, fileErrors = 0;
      try {
        for (;;) {
          try { const r = await d.send(file); if (waiting) { waiting = false; pause(false); } p.sent++; since++; if (r.duplicate) p.duplicates++; break; }
          catch (e) {
            const { status, message, retryAfterSec } = errorOf(e);
            // No answer from the server, yet the server can be reached: the browser could not send this file (changed, moved or online-only since it was
            // chosen). It used to be retried for ever as "waiting for the connection" (code review, 16 Nov 2026, G-M4); now a few tries, then refused.
            if (status === 0 && d.reachable && await d.reachable().catch(() => false)) {
              if (waiting) { waiting = false; pause(false); }
              if (++fileErrors >= (d.maxFileErrors ?? 3)) { p.refused.push({ fileName: d.name(file), message: FILE_UNREADABLE }); break; }
              await sleep(1000); if (d.signal?.aborted) { stop(); break; }
              continue;
            }
            // No answer from the server at all: the connection is down. Wait and send this same file again, for as long as it takes; never a failure.
            if (status === 0) {
              if (!waiting) { waiting = true; pause(true); }
              await (d.untilOnline ?? sleep)(Math.min(10_000, 2000 * 2 ** Math.min(3, tries++)));
              if (d.signal?.aborted) { pause(false); stop(); break; }
              continue;
            }
            if (waiting) { waiting = false; pause(false); }
            // Busy signals (rate limit, a full queue, saving paused) are waited out, a bounded number of times; anything else refuses this file only.
            if ((status === 429 || status === 503) && ++busy <= (d.maxBusyWaits ?? 20)) { await sleep(Math.round(Math.min(60, (retryAfterSec ?? 5) * (1 + 0.25 * (busy - 1))) * 1000 * (1 + Math.random() * 0.3))); if (d.signal?.aborted) { stop(); break; } continue; }
            if (status === 409) { stop(); break; }   // the batch was cancelled or is full: stop sending
            p.refused.push({ fileName: d.name(file), message }); break;
          }
        }
      } finally { sending--; }
      d.onProgress?.({ ...p });
    }
  }
  await refresh();
  await Promise.all(Array.from({ length: lanes }, lane));
  if (d.signal?.aborted) stop();
  d.onProgress?.({ ...p });
  return p;
}

/** From a chosen folder or a multiple selection: keep supported documents, drop hidden and temporary files, and say what was left out. */
export function chooseFiles(all: File[], extensions: string[], maxBytes: number): { files: File[]; skipped: { fileName: string; reason: string }[] } {
  const files: File[] = [], skipped: { fileName: string; reason: string }[] = [];
  for (const f of all) {
    const n = f.name;
    if (n.startsWith(".") || n.startsWith("~$")) continue;                  // operating-system and Word lock files are not documents
    const ext = "." + (n.split(".").pop() ?? "").toLowerCase();
    if (!extensions.includes(ext)) skipped.push({ fileName: n, reason: "unsupported type" });
    else if (f.size === 0) skipped.push({ fileName: n, reason: "empty" });
    else if (f.size > maxBytes) skipped.push({ fileName: n, reason: "too large" });
    else files.push(f);
  }
  return { files, skipped };
}
