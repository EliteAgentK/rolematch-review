import { expect, test } from "vitest";
import { assess } from "../src/match";
import { candidateOf, jobOf, AS_OF } from "./candidate/judgementCases";

// The owner, 2026-11-05: "a job title should earn credit but relevant to specific jobs, not just in general. If I'm a senior Java engineer, what does that have to do with HR?"
const person = (position: string, duties: string[], skills: string[] = []) => candidateOf({ cv: { skills, duties, position, company: "Elmstead Advisory", start: "2014-01", end: "2024-01" } } as any);
const run = (c: any, reqs: string[], title = "Some Role") => (assess(c, { ...jobOf(reqs), title }, (c.workHistory ?? []).flatMap((w: any) => [w.position, ...(w.responsibilities ?? [])]).join("\n"), AS_OF) as any).evidence;
const BLAND = ["Answered the phones at reception.", "Ordered stationery for the office."];

test("a title naming what a requirement asks for earns credit, and says it came from the title", () => {
  const e = run(person("Senior Java Developer", BLAND), ["Experience with Java"])[0];
  expect(["verified", "partial"]).toContain(e.state);
  expect(e.explanation).toMatch(/title/i);
  expect(e.explanation).not.toMatch(/described work/i);
  expect(String(e.source)).toMatch(/Senior Java Developer/);
});
test("a Java engineer's title earns nothing towards an HR requirement", () => {
  const c = person("Senior Java Engineer", ["Built payment services in Java.", "Reviewed code with five engineers."]);
  for (const r of ["Experience with Labour Relations Act", "Experience with employee relations", "HR generalist experience", "Experience with disciplinary hearings"]) expect(run(c, [r])[0].state).toBe("not_demonstrated");
});
test("years in an unrelated profession are not years in this one, even when the titles share a word", () => {
  const eng = person("Engineering Manager", ["Led a team of twenty software engineers.", "Planned releases with product owners."]);
  const e = run(eng, ["5+ years of human resources management experience"])[0];
  expect(e.state).toBe("not_demonstrated");
  const prop = person("Property Manager", ["Collected rent from tenants.", "Arranged repairs with contractors."]);
  expect(run(prop, ["5+ years of project management experience"])[0].state).toBe("not_demonstrated");
  const fin = person("Finance Manager", ["Prepared the monthly board pack.", "Managed the audit."]);
  expect(run(fin, ["5+ years of marketing management experience"])[0].state).toBe("not_demonstrated");
  const sales = person("Sales Manager", ["Grew regional revenue by 20 percent."]);
  expect(run(sales, ["5+ years of supply chain management experience"])[0].state).toBe("not_demonstrated");
});
test("years in the same profession count", () => {
  const hr = person("HR Manager", ["Advised managers on discipline and grievances.", "Ran the annual performance cycle."]);
  expect(["verified", "partial"]).toContain(run(hr, ["5+ years of human resources management experience"])[0].state);
  const pm = person("Project Manager", ["Delivered a fibre rollout programme across two metros."]);
  expect(["verified", "partial"]).toContain(run(pm, ["5+ years of project management experience"])[0].state);
});
test("a requirement that names no subject falls back on the job's title, and the same limits apply", () => {
  const java = person("Senior Java Engineer", ["Built payment services in Java."]);
  expect(run(java, ["5+ years of relevant experience"], "HR Business Partner")[0].state).toBe("not_demonstrated");
  const hr = person("HR Business Partner", ["Advised managers on discipline."]);
  expect(["verified", "partial"]).toContain(run(hr, ["5+ years of relevant experience"], "HR Business Partner")[0].state);
});
test("a generic word in a title gives no credit on its own: a director is not thereby a finance director", () => {
  const ops = person("Operations Director", ["Ran three distribution centres."]);
  expect(run(ops, ["Finance director experience"])[0].state).toBe("not_demonstrated");
});

// Found on the first true long CV: with thousands of words in a document, a general word nearly always appears somewhere, and it was earning credit for requirements about something else.
const NARRATIVE = ["Our compliance team asked for an assessment of the release process, so I reviewed every step with them and wrote up what we found across the company's three sites.", "The school mentorship programme was something I volunteered for. Companies across the region took part.", "I traced the cause of the outage to a misconfigured analysis job and corrected it."];
test("a requirement's own subject must be what the CV is talking about, not one general word from it", () => {
  const eng = person("Principal Engineer", [...NARRATIVE, "Built payment services in Java for the settlement batch."]);
  for (const r of ["Experience with Patient assessment", "Experience with Learner assessment", "Experience with Tax compliance", "Experience with POPIA compliance", "Experience with Companies Act", "Experience with Risk assessment"]) {
    expect([r, run(eng, [r])[0].state]).toEqual([r, "not_demonstrated"]);
  }
});
test("the same general word still earns credit where the CV is talking about that subject", () => {
  const nurse = person("Professional Nurse", ["Performed patient assessment on admission and escalated deterioration using the early warning score."]);
  expect(run(nurse, ["Experience with Patient assessment"])[0].state).toBe("verified");
  const tax = person("Tax Consultant", ["Handled tax compliance including VAT and PAYE submissions, and managed queries from SARS."]);
  expect(run(tax, ["Experience with Tax compliance"])[0].state).toBe("verified");
  const lawyer = person("Compliance Officer", ["Monitored regulatory compliance across the group and reported breaches to the board."]);
  expect(run(lawyer, ["Experience with Compliance"])[0].state).toBe("verified");
});
test("credit given always says which words earned it, and only the sentence that did", () => {
  const nurse = person("Professional Nurse", ["Worked nights for three years. Performed patient assessment on admission and escalated deterioration using the early warning score. Trained two students."]);
  const e = run(nurse, ["Experience with Patient assessment"])[0];
  expect(e.source).toMatch(/patient assessment/i); expect(e.source).not.toMatch(/Worked nights|Trained two/);
});
test("related wording needs the words together in one sentence, and a name in capitals needs the name", () => {
  const c = person("Teacher", ["We ran the audit in March. The internal team helped us.", "Taught mathematics to matric classes for six years."]);
  expect(run(c, ["Internal audit reports"])[0].state).toBe("not_demonstrated");
  const d = person("Auditor", ["Wrote internal audit reports for the committee each quarter."]);
  expect(run(d, ["Internal audit reports"])[0].state).not.toBe("not_demonstrated");
});

// Found tracing matching errors on long CVs back to their stage: words alike or merely near each other were earning credit.
test("words that only look alike, or stand apart in a sentence, earn nothing", () => {
  const c = person("Head of Data Science", ["The actuarial team was used to working with static models and was initially resistant.", "I joined as Head of Data Science, reporting to the general manager with a team of nine people.", "The transition was managed without disrupting services, and performance improved slightly.", "My reports helped secure additional budget for a new payment gateway."]);
  for (const r of ["Experience with Statistics", "Experience with Management reporting", "Experience with Performance management"]) expect([r, run(c, [r])[0].state]).toEqual([r, "not_demonstrated"]);
  expect(run(c, ["Experience with Budgeting"])[0].state).not.toBe("verified");
});
test("the same skill in plain other words still earns credit", () => {
  const c = person("Accountant", ["Reconciled supplier accounts every month and followed up differences.", "Managed the annual budget across eleven cost centres.", "Led performance management for the whole team, including reviews."]);
  expect(run(c, ["Experience with Reconciliations"])[0].state).not.toBe("not_demonstrated");
  expect(run(c, ["Experience with Performance management"])[0].state).toBe("verified");
  expect(run(c, ["Experience with Budgeting"])[0].state).not.toBe("not_demonstrated");
});
