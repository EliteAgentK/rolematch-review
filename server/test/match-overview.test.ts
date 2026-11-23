// The at-a-glance match view (owner, 2026-10-30): one sentence, up to two strengths and the most important gap, a short reason per requirement, and the warnings that
// must stay in view. Presentation only. These tests check that the summary agrees with the detailed evidence and the score in every case the owner
// named: strong and low alignment, uncertain extraction, missing evidence and unapproved requirements; and that the scores themselves did not move.
import { expect, test } from "vitest";
import { assess } from "../src/match";
import type { Candidate, Job } from "../src/types";

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", name: "Test Person", role: "Developer", status: "new", avatar: "", skills: ["JavaScript", "React", "TypeScript", "PostgreSQL"], rating: 0, experience: "8",
  location: "Cape Town, South Africa", email: "", phone: "", appliedDate: "2026-01-01",
  workHistory: [{ company: "Acme", position: "Senior Developer", startDate: "2016-01", endDate: "Present", responsibilities: ["Built React and TypeScript applications backed by PostgreSQL.", "Mentored two junior developers."] }],
  extractionConfidence: 0.9, ...over,
});
const job = (over: Partial<Job> = {}): Job => ({
  id: "j", title: "Developer", location: "Cape Town, South Africa", company: "X", skills: [], type: "", department: "", description: "",
  requirements: ["At least five years of professional software development experience", "Strong experience with TypeScript and JavaScript", "Experience with PostgreSQL"],
  preferredRequirements: ["Experience mentoring other developers"], responsibilities: [], postedDate: "", status: "open", extractionConfidence: 0.9, ...over,
});
const AS_OF = new Date("2026-10-30T00:00:00Z");

/** Whatever the case: the sentence's numbers are the detail's numbers, the lists come from the detail, and each short reason is the detail's own. */
function agrees(r: ReturnType<typeof assess>) {
  const counted = r.evidence.filter((e) => !e.duplicateOf && e.state !== "not_applicable");
  const n = (s: string) => counted.filter((e) => e.state === s).length;
  const o = r.overview!;
  expect(o.summary).toContain(`supports ${n("verified")} of ${counted.length} requirement`);
  if (n("partial")) expect(o.summary).toContain(`partly supports ${n("partial")}`); else expect(o.summary).not.toContain("partly supports");
  if (n("not_demonstrated")) expect(o.summary).toContain(`${n("not_demonstrated")} ${n("not_demonstrated") === 1 ? "is" : "are"} not evidenced`);
  for (const s of o.strengths) expect(counted.find((e) => e.label === s)?.state).toBe("verified");
  for (const g of o.gaps) { const e = counted.find((x) => x.label === g.label)!; expect(e.state).toBe(g.state); expect(g.reason).toBe(e.reason); }
  expect(o.strengths.length).toBeLessThanOrEqual(2); expect(o.gaps.length).toBeLessThanOrEqual(1);
  for (const e of r.evidence) { expect(e.reason, e.label).toBeTruthy(); expect(e.reason!.length, e.label).toBeLessThanOrEqual(160); }
  expect(r.notices!.map((x) => x.text)).toEqual(r.warnings);   // every warning keeps its words; the code only says where it is shown
}

test("strong alignment: the summary says what is supported, strengths lead, and nothing says '0 years'", () => {
  const r = assess(cand(), job(), "", AS_OF);
  expect(r.score).toBeGreaterThanOrEqual(80);
  agrees(r);
  expect(r.overview!.strengths[0]).toBe(r.evidence.find((e) => e.mandatory && e.state === "verified")!.label);   // mandatory first
  expect(r.evidence[0].reason).toMatch(/^About [\d.]+ years of relevant, dated roles shown \(5\+ required\)\.$/);
});

test("low alignment and missing evidence: gaps are 'not evidenced' (not a mismatch), and experience that cannot be tied to the role is said to be unestablished, never '0 years'", () => {
  const r = assess(cand(), job({ title: "Data Analyst", requirements: ["Three or more years of experience in a data analyst role", "Advanced SQL skills", "Experience with Power BI or a similar tool"], preferredRequirements: [] }), "", AS_OF);
  expect(r.score).toBeLessThan(40);
  agrees(r);
  const years = r.evidence[0];
  expect(years.reason).toBe("Relevant experience could not be established from the CV.");
  expect(years.explanation).not.toMatch(/\b0 years?\b/);
  expect(r.overview!.gaps.every((g) => g.state !== "contradicted")).toBe(true);
  expect(r.evidence.find((e) => /SQL/.test(e.label))!.reason).toMatch(/^Not found in the CV: SQL\.$/);
});

test("unapproved requirements: the draft warning is consequential and stays in view; the built-in parser note is method, not a warning", () => {
  const r = assess(cand(), job({ status: "draft" }), "", AS_OF);
  agrees(r);
  const draft = r.notices!.find((x) => x.code === "job_unapproved")!;
  expect(draft.consequential).toBe(true);
  const parser = r.notices!.find((x) => x.code === "built_in_parser");
  if (parser) expect(parser.consequential).toBe(false);
});

test("uncertain extraction: an extraction warning stays in view, and confidence (not alignment) carries the uncertainty", () => {
  const sure = assess(cand(), job(), "", AS_OF);
  // Reading quality counts as full from an average of 0.6 (ruleset confidence.extractionFull); 0.1 with the job's 0.9 averages 0.5, below it.
  const unsure = assess(cand({ extractionConfidence: 0.1, extraction: { warnings: ["Some text in this CV could not be read."] } as any }), job(), "", AS_OF);
  agrees(unsure);
  expect(unsure.notices!.find((x) => x.text === "Some text in this CV could not be read.")).toMatchObject({ code: "extraction", consequential: true });
  expect(unsure.score).toBe(sure.score);                          // how well it was read changes confidence, not the alignment percentage
  expect(unsure.confidenceScore).toBeLessThan(sure.confidenceScore);
});

test("no requirements: the summary says nothing could be assessed", () => {
  const r = assess(cand(), job({ requirements: [], preferredRequirements: [] }), "", AS_OF);
  expect(r.overview!.summary).toBe("This job has no requirements recorded, so nothing could be assessed.");
  expect(r.notices!.find((x) => x.code === "no_requirements")!.consequential).toBe(true);
});
