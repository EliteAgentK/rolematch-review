// The at-a-glance part of a match result (owner, 2026-10-30): one sentence, up to three strengths, up to three gaps, and which warnings must stay in
// view. Written ONLY from the finished structured assessment: every word comes from its counts, states, labels and reasons, so it cannot say anything
// the detail does not, and it needs no AI call. Presentation only: nothing here changes a score, a state or the order of results.
import type { EvidenceState } from "./types";

type Item = { label: string; state: EvidenceState; mandatory?: boolean; share?: number; duplicateOf?: string; reason?: string; explanation: string };
export type Notice = { code: string; text: string; consequential: boolean };
export interface Overview { summary: string; strengths: string[]; gaps: { label: string; state: EvidenceState; reason: string }[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim();
const shortReason = (e: Item) => e.reason ?? firstSentence(e.explanation);

/** Mandatory first, then the larger share of the score: the requirements that matter most to this job come first. */
const byWeight = (a: Item, b: Item) => Number(!!b.mandatory) - Number(!!a.mandatory) || (b.share ?? 0) - (a.share ?? 0);
const GAP_ORDER: EvidenceState[] = ["contradicted", "not_demonstrated", "partial"];

export function overviewOf(evidence: Item[]): Overview {
  const counted = evidence.filter((e) => !e.duplicateOf && e.state !== "not_applicable");
  const n = (s: EvidenceState) => counted.filter((e) => e.state === s).length;
  const v = n("verified"), p = n("partial"), nd = n("not_demonstrated"), c = n("contradicted");
  const openMandatory = counted.filter((e) => e.mandatory && e.state !== "verified").length;
  let summary: string;
  if (!counted.length) summary = "This job has no requirements recorded, so nothing could be assessed.";
  else {
    const parts = [`The CV supports ${v} of ${plural(counted.length, "requirement", "requirements")}`];
    if (p) parts.push(`partly supports ${p}`);
    let s = parts.join(" and ");
    const rest: string[] = [];
    if (nd) rest.push(`${nd} ${nd === 1 ? "is" : "are"} not evidenced`);
    if (c) rest.push(`${c} ${c === 1 ? "is" : "are"} contradicted`);
    if (rest.length) s += `; ${rest.join(" and ")}`;
    if (openMandatory) s += `. ${plural(openMandatory, "mandatory requirement still needs", "mandatory requirements still need")} checking`;
    summary = s + ".";
  }
  const strengths = counted.filter((e) => e.state === "verified").sort(byWeight).slice(0, 2).map((e) => e.label);
  const gaps = counted.filter((e) => GAP_ORDER.includes(e.state)).sort((a, b) => GAP_ORDER.indexOf(a.state) - GAP_ORDER.indexOf(b.state) || byWeight(a, b))
    .slice(0, 1).map((e) => ({ label: e.label, state: e.state, reason: shortReason(e) }));
  return { summary, strengths, gaps };
}
