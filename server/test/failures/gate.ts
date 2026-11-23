// The evaluation gate. It compares a candidate with the accepted baseline on the same documents and says pass, fail or incomplete. Pure, so the gate itself is tested with deliberately bad candidates
// (test/failure-library.test.ts). It reports; it does not switch anything on. Passing never replaces the running parser by itself.
export interface FieldCounts { correct: number; wrong: number; missing: number; total: number }
export interface Scorecard {
  /** "name|pdf": counts per field and format. */
  fields: Record<string, FieldCounts>;
  /** Case and variant ids that fully pass. */
  passing: string[];
  medianMs: number;
  failures: number;
}
export interface GateResult { verdict: "pass" | "fail" | "incomplete"; problems: string[]; gains: string[] }

export function gate(base: Scorecard, cand: Scorecard, o: { latencyFactor?: number; latencySlackMs?: number } = {}): GateResult {
  const problems: string[] = [], gains: string[] = [];
  const keysA = Object.keys(base.fields).sort(), keysB = Object.keys(cand.fields).sort();
  if (!keysB.length) return { verdict: "incomplete", problems: ["the candidate has no results at all"], gains };
  if (keysA.join() !== keysB.join()) return { verdict: "incomplete", problems: [`different fields or formats were measured: ${[...keysA.filter((k) => !keysB.includes(k)), ...keysB.filter((k) => !keysA.includes(k))].join(", ")}`], gains };
  for (const k of keysA) {
    const a = base.fields[k], b = cand.fields[k];
    if (a.total !== b.total || b.correct + b.wrong + b.missing !== b.total) return { verdict: "incomplete", problems: [`${k}: counts do not reconcile (${a.total} checked before, ${b.correct}+${b.wrong}+${b.missing} of ${b.total} now)`], gains };
    if (b.wrong > a.wrong) problems.push(`${k}: wrong published values rose ${a.wrong} -> ${b.wrong}`);
    if (b.correct < a.correct) problems.push(`${k}: correct values fell ${a.correct} -> ${b.correct}`);   // so refusing difficult documents cannot pass as an improvement
    if (b.wrong < a.wrong) gains.push(`${k}: wrong ${a.wrong} -> ${b.wrong}`);
    if (b.correct > a.correct) gains.push(`${k}: correct ${a.correct} -> ${b.correct}`);
  }
  const lost = base.passing.filter((id) => !cand.passing.includes(id));
  if (lost.length) problems.push(`recurrence: ${lost.length} case(s) that passed now fail: ${lost.slice(0, 10).join(", ")}`);
  if (cand.failures > base.failures) problems.push(`processing failures rose ${base.failures} -> ${cand.failures}`);
  const limit = base.medianMs * (o.latencyFactor ?? 1.5) + (o.latencySlackMs ?? 50);
  if (cand.medianMs > limit) problems.push(`median time rose ${base.medianMs} ms -> ${cand.medianMs} ms (limit ${Math.round(limit)} ms)`);
  return { verdict: problems.length ? "fail" : "pass", problems, gains };
}
