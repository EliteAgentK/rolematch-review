import { describe, expect, it } from "vitest";
import { pipelineStages } from "./pipeline";

// Code review, 16 Nov 2026, G-M2: the bars were drawn at the square root of their share, so a stage with a quarter of the largest count stood at half its
// height; and each stage said "x% of" the one before, though the stages count different people over the period (people matched this week were read months
// ago; one person moved through three interview stages), which showed "240% of shortlisted" and "150% of read".
describe("the Pipeline chart", () => {
  const p = { read: 40, matched: 60, shortlisted: 10, interviewing: 24, hired: 0 };
  it("draws each bar in proportion to its count", () => {
    const s = pipelineStages(p, 7), tallest = s.find((x) => x.n === 60)!.height;
    expect(s.find((x) => x.label === "Shortlisted")!.height / tallest).toBeCloseTo(10 / 60, 5);
    expect(s.find((x) => x.label === "Read")!.height / tallest).toBeCloseTo(40 / 60, 5);
    expect(s.find((x) => x.label === "Hired")!.height).toBe(0);   // nothing is drawn as nothing
  });
  it("never shows one stage as a share of another, and never a percentage", () => {
    for (const x of pipelineStages(p, 7)) expect(x.note).not.toMatch(/%/);
  });
  it("says what each stage counts, over the period", () => {
    expect(pipelineStages(p, 30).map((x) => x.note)).toEqual(["CVs read in 30 days", "people matched", "moved to a shortlist", "moved to an interview stage", "marked hired"]);
  });
  it("a count far below the largest is still visible, and never taller than its share allows by more than the floor", () => {
    const s = pipelineStages({ read: 10_000, matched: 1, shortlisted: 0, interviewing: 0, hired: 0 }, 7);
    expect(s[1].height).toBeGreaterThan(0);
    expect(s[1].height).toBeLessThanOrEqual(2);
  });
});
