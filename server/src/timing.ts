// Stage timings for diagnosis: where does the time go? Each named stage keeps its recent durations (bounded) so the spread, not just an average, can be read
// (p50, p95, max) from /api/health/details by the platform operator (operator token). It stores durations only: no keys, names, addresses or content. It is for finding causes of slowness
// with evidence (docs/learning/investigations/), and costs a few microseconds per mark.
import { monitorEventLoopDelay } from "node:perf_hooks";

const KEEP = 2000;
const stages = new Map<string, number[]>();
export function record(name: string, ms: number) {
  let a = stages.get(name);
  if (!a) { a = []; stages.set(name, a); }
  a.push(ms); if (a.length > KEEP) a.splice(0, a.length - KEEP);
}
/** Runs fn and records how long it took under `name`, whether it succeeds or fails. */
export async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  try { return await fn(); } finally { record(name, performance.now() - t); }
}
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
export function timingStats(reset = false) {
  const out: Record<string, { n: number; p50: number; p95: number; max: number }> = {};
  for (const [k, a] of stages) { const s = [...a].sort((x, y) => x - y); out[k] = { n: s.length, p50: Math.round(pct(s, 0.5)), p95: Math.round(pct(s, 0.95)), max: Math.round(s[s.length - 1]) }; }
  const el = { p50: Math.round(loop.percentile(50) / 1e6), p99: Math.round(loop.percentile(99) / 1e6), max: Math.round(loop.max / 1e6) };   // event-loop delay in ms: pressure on this process itself
  if (reset) { stages.clear(); loop.reset(); }
  return { stages: out, eventLoopMs: el };
}
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
