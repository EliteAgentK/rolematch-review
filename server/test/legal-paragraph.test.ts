import { expect, test } from "vitest";
import { isLegalParagraph, parseCv } from "../src/rules";

// R112, all invented. Found on real CVs: an agency's terms shown to a recruiter as the person's summary.
test("an agency's terms are not about the person", () => {
  for (const t of ["The personal information in this document is processed with the candidate's consent under POPIA and our terms of business.", "We accept no liability for the accuracy of this CV. Please verify all details with the candidate directly.", "This CV is submitted subject to our terms. A placement fee applies if the candidate is employed within twelve months."]) expect(isLegalParagraph(t), t).toBe(true);
});
test("a person's own words stay, even when they share a word", () => {
  for (const t of ["I manage fee collection and supplier payments for a private school in Durban.", "Responsible for reducing liability exposure across the insurance portfolio, reporting to the risk committee.", "Recruitment specialist who has placed candidates in terms of employment equity plans across three provinces.", "I negotiate terms and conditions with suppliers and manage the placement of orders.", "Senior consultant who helped the candidate pool grow by working with universities."]) expect(isLegalParagraph(t), t).toBe(false);
});
const cv = (...summary: string[]) => ["Test Person", "test.person@example.test", "", "SUMMARY", ...summary, "", "SKILLS", "Excel", "Payroll", "Reporting", "", "EMPLOYMENT HISTORY", "Elmstead Advisory", "Safety Officer | 2022/01 - Current", "- Reviewed site inspections every week."].join("\n");
test("the terms are passed over and the person's paragraph kept; nothing is made up when only terms were there", () => {
  const LEGAL = "This CV is submitted subject to our terms and a placement fee applies.", OWN = "Safety officer with ten years in construction, focused on inspections and training site teams.";
  expect(parseCv(cv(OWN, "", LEGAL)).summary).toBe(OWN);
  expect(parseCv(cv(LEGAL)).summary).toBe("");
});
test("a sentence in the agency's own voice goes, and the person's sentences stay", () => {
  const OWN = "I run payroll for three hundred staff and I reconcile the monthly accounts myself.", AGENCY = "Payment is as per our Terms and Conditions of business.";
  expect(parseCv(cv(`${OWN} ${AGENCY}`)).summary).toBe(OWN);
  expect(parseCv(cv(AGENCY)).summary).toBe("");
});
test("a short line with nothing of the agency's is left exactly as it was", () => {
  const short = "Senior payroll officer.", r = parseCv(cv(short));
  expect(r.summary).toBe(short);
});
