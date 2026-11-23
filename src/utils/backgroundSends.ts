// Batches being sent, kept outside any page (owner, 9 Nov 2026: "I should be able to go to other screens while the AI works in the background; I clicked
// Settings and the upload stopped"). Sending used to belong to the board page, so leaving the board stopped it: 14 of 30 files were sent and 16 never were.
// Here it belongs to the app: it carries on whichever screen is open, and the board shows its progress again when it is opened. Only closing the tab or
// the browser stops it (a closed page cannot send), and while files are being sent the browser asks before letting the page close.
import { useEffect, useState } from "react";

export interface Sending { id: string; sent: number; total: number; /** waiting for the connection to come back (src/utils/batchUpload.ts) */ paused?: boolean }
const sends = new Map<string, { sending: Sending; signal: { aborted: boolean } }>();
const listeners = new Set<() => void>();
const changed = () => { listeners.forEach((f) => f()); guard(); };

const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
function guard() { if (sends.size) window.addEventListener("beforeunload", warn); else window.removeEventListener("beforeunload", warn); }

/** Sends one batch in the background. `run` is given the stop signal and a way to report how many files are in. */
export function startSending(id: string, total: number, run: (signal: { aborted: boolean }, report: (sent: number, paused?: boolean) => void) => Promise<unknown>): Promise<void> {
  const signal = { aborted: false };
  sends.set(id, { sending: { id, sent: 0, total }, signal }); changed();
  const report = (sent: number, paused = false) => { const s = sends.get(id); if (s) { s.sending = { id, sent, total, paused }; changed(); } };
  return run(signal, report).then(() => undefined, () => undefined).finally(() => { sends.delete(id); changed(); });
}
/** A person chose Cancel remaining: no more files of this batch are sent. */
export function stopSending(id: string) { const s = sends.get(id); if (s) s.signal.aborted = true; }
/** The batches being sent right now, kept current. */
export function useSendings(): Map<string, Sending> {
  const [, render] = useState(0);
  useEffect(() => { const f = () => render((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return new Map([...sends].map(([id, s]) => [id, s.sending]));
}
