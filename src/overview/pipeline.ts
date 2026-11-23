// The Overview's Pipeline chart: each stage's count of the period, its bar and the line under it. Code review, 16 Nov 2026, G-M2: bars were drawn at the
// square root of their share (a quarter of the largest stood at half its height), and each stage said "x% of" the one before, though the stages count
// different people over the period (people matched this week may have been read months ago), which showed figures such as "240% of shortlisted". Bars are
// now in proportion to their counts, and each stage says only what it counts.
import type { OverviewData } from "./types";

export interface PipelineStage { label: string; n: number; colour: string; height: number; note: string }
/** The tallest bar, as a share of the chart's height (%), and the least a count above zero is drawn at, so a single one is still seen beside thousands. */
const TALLEST = 70, LEAST = 2;

export function pipelineStages(p: OverviewData["pipeline"], days: number): PipelineStage[] {
  const S: [string, number, string, string][] = [
    ["Read", p.read, "--cerulean", `CVs read in ${days} days`], ["Matched", p.matched, "--violet", "people matched"], ["Shortlisted", p.shortlisted, "--teal", "moved to a shortlist"],
    ["Interviewing", p.interviewing, "--amber", "moved to an interview stage"], ["Hired", p.hired, "--green", "marked hired"]];
  const max = Math.max(1, ...S.map((s) => s[1]));
  return S.map(([label, n, colour, note]) => ({ label, n, colour, note, height: n > 0 ? Math.max(LEAST, (n / max) * TALLEST) : 0 }));
}
