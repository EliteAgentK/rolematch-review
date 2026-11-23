// Estimated time left for a batch, from what has actually been observed: when its files reached an end state. No timers, no assumed speed.
// - Fewer than 3 files finished: "calculating" (not enough to say anything).
// - Otherwise the range runs from the typical gap between completions (median) to a slow one (80th percentile, never less than the mean), times the files left.
//   A batch with 2 files at a time in progress finishes files in bursts, so the gap between completions already includes that overlap.
// - Nothing finished for much longer than usual: "stalled", with no countdown, because a countdown that keeps rising is a false promise.
// It is only ever a range, and it moves as the observations do.
export type Eta = { state: "none" } | { state: "calculating"; finished: number } | { state: "estimating"; lowSec: number; highSec: number; finished: number } | { state: "stalled"; sinceSec: number };

export function estimate(finishedAtMs: number[], remaining: number, nowMs: number): Eta {
  if (remaining <= 0) return { state: "none" };
  const t = [...finishedAtMs].sort((a, b) => a - b);
  if (t.length < 3) return { state: "calculating", finished: t.length };
  const gaps = t.slice(1).map((x, i) => (x - t[i]) / 1000).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)], p80 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.8))], mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const since = (nowMs - t[t.length - 1]) / 1000;
  if (since > Math.max(60, 5 * Math.max(median, mean))) return { state: "stalled", sinceSec: Math.round(since) };
  const low = remaining * Math.max(0.1, median), high = remaining * Math.max(p80, mean, median);
  return { state: "estimating", lowSec: Math.round(low), highSec: Math.round(Math.max(high, low)), finished: t.length };
}
