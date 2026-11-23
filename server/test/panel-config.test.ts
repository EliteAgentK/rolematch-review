// Every record panel, board card, match assessment, shortlist and the matching zone look the same because their look lives in one configuration
// (src/config/panels.ts) and one set of blocks (src/components/ui/panel.tsx). Owner, 11 Nov 2026: "configure these panels to look the same, no matter
// how the CVs look ... same font, same sizes, same bullet points, same kind of header"; "even the panels on the side need the same treatment"; "I don't
// want this one differing from the next 10". A file here that sets a look of its own would start them drifting apart again, so it fails here.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const FILES = ["CandidateDetails.tsx", "JobDetails.tsx", "CandidateCard.tsx", "JobCard.tsx", "CandidateMatchPanel.tsx", "ShortlistResults.tsx", "MatchShortlistZone.tsx",
  "SavedAssessmentDialog.tsx", "AssessmentDialog.tsx"];
const OWN_LOOK: [string, RegExp][] = [
  ["a light/dark colour pair", /useColorModeValue/],
  ["a type size or weight", /\b(fontSize|fontWeight|lineHeight|letterSpacing)=("|\{\s*\d)/],
  ["a colour shade", /["'][a-zA-Z]+\.\d{2,3}["']/],
  ["a colour code", /#[0-9a-fA-F]{3,6}\b|rgba?\(/],
  ["a colour name", /\bcolorPalette="/],
  ["a size", /\bsize="/],
  ["a spacing number", /\b(m|mt|mb|ml|mr|my|mx|p|pt|pb|pl|pr|px|py|gap)=\{-?\d/],
  ["an inline style", /\bstyle=\{\{/],
];

test("the panel, card, assessment, shortlist and matching-zone files take every size, colour and space from the panel configuration", () => {
  const found: string[] = [];
  for (const f of FILES) {
    const text = readFileSync(new URL(`../../src/components/${f}`, import.meta.url), "utf8");
    text.split("\n").forEach((line, i) => { for (const [what, re] of OWN_LOOK) if (re.test(line)) found.push(`${f}:${i + 1} sets ${what}`); });
  }
  expect(found).toEqual([]);
});

test("both panels are laid out from the configuration, both cards use the one card frame, and every assessment opens in the one window", () => {
  const read = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
  for (const f of ["CandidateDetails.tsx", "JobDetails.tsx"]) expect(read(`components/${f}`)).toMatch(/<PanelLayout kind="(candidate|job)"/);
  for (const f of ["CandidateCard.tsx", "JobCard.tsx"]) expect(read(`components/${f}`)).toMatch(/<RecordCard kind="(candidate|job)"/);
  for (const f of ["components/SavedAssessmentDialog.tsx", "components/ShortlistResults.tsx", "pages/Dashboard.tsx"]) expect(read(f), f).toMatch(/<AssessmentDialog /);
  expect(read("pages/Dashboard.tsx")).not.toMatch(/Match Assessment:/);   // the heading is the window's, never written again
});

test("every heading and tab name is in Title Case, whatever an organisation types", async () => {
  const { titleCase, PANEL_LAYOUT } = await import("../../src/config/panels");
  expect(titleCase("Recruiter notes")).toBe("Recruiter Notes");
  expect(titleCase("projects and delivery")).toBe("Projects and Delivery");
  expect(titleCase("also in the job description")).toBe("Also in the Job Description");
  for (const tab of [...PANEL_LAYOUT.candidate, ...PANEL_LAYOUT.job]) for (const s of tab.sections) if (s.title) expect(titleCase(s.title), s.title).toBe(s.title);
});
