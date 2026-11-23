import { expect, test } from "vitest";
import { parseCv } from "../src/rules";

// R99: a skill that shares a word with a section heading must not end the list. Counterexamples first: real headings written plainly stay headings.
const cv = (skills: string[], after: string[]) => ["Test Person", "test.person@example.test", "", "PROFILE", "I run health and safety programmes for construction sites across the country.", "", "SKILLS OVERVIEW", ...skills, "", ...after].join("\n");
const WORK = ["EMPLOYMENT HISTORY", "Elmstead Advisory", "Safety Officer | 2022/01 - Current | Permanent", "- Reviewed site inspections every week."];
const read = (t: string) => { const r = parseCv(t); return { ...r, skills: r.skills.map((s: any) => s.name ?? s) }; };

test("a list item named like a section stays in the list, in capitals-headed documents", () => {
  const r = read(cv(["Excel", "Inspections", "Training", "Contractor coordination", "Risk assessments"], WORK));
  expect(r.skills).toEqual(expect.arrayContaining(["Excel", "Inspections", "Training", "Contractor coordination", "Risk assessments"]));
});

test("first and last in the list too", () => {
  expect(read(cv(["Training", "Excel", "Inspections"], WORK)).skills).toEqual(expect.arrayContaining(["Training", "Excel", "Inspections"]));
  expect(read(cv(["Excel", "Inspections", "Training"], WORK)).skills).toEqual(expect.arrayContaining(["Training", "Excel", "Inspections"]));
});

test("capitals and colons still open a section", () => {
  const caps = read(cv(["Excel", "Inspections"], ["TRAINING", "First Aid Level 1 | Red Cross | 2021", ...WORK]));
  expect(caps.skills).not.toContain("First Aid Level 1");
  const colon = read(cv(["Excel", "Inspections"], ["Training:", "First Aid Level 1 | Red Cross | 2021", ...WORK]));
  expect(colon.skills).not.toContain("First Aid Level 1");
});

test("a document with plain headings keeps them", () => {
  const r = read(["Test Person", "test.person@example.test", "", "Skills", "Excel", "Inspections", "", "Experience", "Elmstead Advisory", "Safety Officer | 2022/01 - Current", "- Reviewed site inspections every week.", "", "Education", "BSc Safety Management | University of Pretoria | 2015"].join("\n"));
  expect(r.workHistory).toHaveLength(1);
  expect(r.skills).not.toContain("Experience");
  expect(r.skills).not.toContain("Education");
});

test("a plainly written heading after prose in a capitals document still opens its section", () => {
  const r = read(cv(["Excel", "Inspections"], ["I enjoy explaining outcomes to people who need them.", "Training", "- First Aid Level 1, Red Cross, 2021", ...WORK]));
  expect(r.skills).not.toContain("Training");
});

test("a wide row that wraps is a list, and the plain line above it is its heading", () => {
  const r = read(["Test Person", "test.person@example.test", "", "Professional statement", "I work in operations, with a focus on planned building maintenance across several sites.", "Areas of practice", "Reporting | Vendor management | Excel | Maintenance planning | Helpdesk | Budgets | Report", "writing | Stakeholder communication", "Current appointment", "Senior Coordinator", "Glenford Industries", "2020/01 - Present | Permanent", "- Reviewed the planned maintenance schedule every week."].join("\n"));
  expect(r.skills).toEqual(expect.arrayContaining(["Reporting", "Vendor management", "Maintenance planning", "Helpdesk"]));
});

test("a long list under a capitals heading after the work history is its own section", () => {
  const r = read(["Test Person", "test.person@example.test", "", "EMPLOYMENT HISTORY", "Elmstead Advisory", "Safety Officer | 2022/01 - Current", "- Reviewed site inspections every week.", "AREAS OF PRACTICE", "Excel", "Negotiation", "B2B sales", "Account planning", "CRM", "Forecasting", "Report writing", "Stakeholder communication", "FURTHER DETAILS", "Languages: English, Setswana"].join("\n"));
  expect(r.skills).toEqual(expect.arrayContaining(["B2B sales", "Account planning", "Stakeholder communication"]));
  expect(r.workHistory[0].achievements?.join(" ") ?? "").not.toContain("Account planning");
});

test("a role's own short lines stay inside the role", () => {
  const r = read(["Test Person", "test.person@example.test", "", "EMPLOYMENT HISTORY", "Elmstead Advisory", "Safety Officer | 2022/01 - Current", "Key Tools", "Excel", "Word", "Teams", "Dalesford Industries", "Safety Assistant | 2018/01 - 2021/12", "- Filed the weekly reports."].join("\n"));
  expect(r.workHistory).toHaveLength(2);
});
