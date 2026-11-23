// Education and certificates are the AI's alone (owner, 9 Nov 2026: "for the education, I only want the AI to analyse it"). On 10 Nov the owner found a
// CFO's jobs and achievements under Education as "Certificate · Completed": the reader had taken everything after an unknown heading ("Professional
// appointments") for qualifications, and the merge still added the reader's certificates beside the AI's. Invented CV lines.
import { expect, test } from "vitest";
import { mergeReading } from "../src/reconcile";
import { cleanInvisible } from "../src/invisible";

const reading = { headline: "", profile: "", roles: [], education: [{ qualification: "BCom Honours Accounting", institution: "University of the Witwatersrand", year: "2004", status: "completed", lines: [3] }],
  certifications: ["CA(SA)"], skills: [], languages: [], location: "", agency: { name: "", recruiter: "", recruiterEmail: "", recruiterPhone: "" } } as any;
const parserRecord = { name: "Farai Moyo", workHistory: [], certifications: [], education: [
  { degree: "CA(SA)", type: "other", status: "completed" },
  { degree: "Chief Financial Officer Employer Briarcrest General Insurance, From Aug 2020, To Present", type: "certificate", status: "in_progress" },
  { degree: " Coordinates prudential submissions with risk, actuarial and regulatory teams.", type: "certificate", status: "not_stated" },
] };

test("certificates are the AI's alone: the reader's guesses never reach the panel, the AI's do", () => {
  const out = mergeReading(parserRecord, { reading, roles: [], employment: { state: "complete", reasons: [] } as any, trace: {}, text: "" } as any, { model: "test", promptVersion: "test", ms: 1 });
  const names = out.education.map((e: any) => e.degree);
  expect(names).toContain("BCom Honours Accounting");
  expect(names.some((n: string) => /CA\(SA\)/.test(n))).toBe(true);
  expect(names.some((n: string) => /Briarcrest|prudential/.test(n))).toBe(false);
});

test("a bullet drawn from a symbol font (Word's Symbol and Wingdings bullets) becomes a plain bullet at the start of a line, and is removed anywhere else", () => {
  expect(cleanInvisible(" Coordinates prudential submissions\n   Led sixteen staff").text).toBe("• Coordinates prudential submissions\n  • Led sixteen staff");
  expect(cleanInvisible("Risk management").text).toBe("Risk management");
});
