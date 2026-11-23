import { expect, test } from "vitest";
import { assess } from "../src/match";
import { ruleset } from "../src/ruleset";
import { SKILLS } from "../src/skills";

// Rules 2.3.0, each from a difference between the live matcher and how a careful reader judged a real pair. Invented people.
const person = (over: any = {}): any => ({ id: "c", name: "Thandi Mokoena", role: "", status: "new", avatar: "", skills: [], rating: 0, experience: "", location: "", email: "", phone: "", appliedDate: "", workHistory: [], summary: "", education: [], languages: [], ...over });
const job = (requirements: string[], over: any = {}): any => ({ id: "j", title: "Senior Software Developer", company: "", location: "", skills: [], type: "", department: "", description: "", requirements, preferredRequirements: [], responsibilities: [], postedDate: "", ...over });
const AS_OF = new Date("2026-11-03T00:00:00Z");
const role = (position: string, responsibilities: string[], startDate = "2018-01", endDate = "2024-01") => ({ company: "Northwind", position, startDate, endDate, responsibilities });
const only = (m: any, text: string) => m.evidence.find((e: any) => e.label.toLowerCase().includes(text.toLowerCase()));

test("R70 a duty described in the document's own words counts as described use", () => {
  const m = assess(person({ skills: ["Diary management"], workHistory: [role("Executive Assistant", ["Managed executive diary and meeting arrangements."])] }), job(["Demonstrated experience with Diary management"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("verified");
});
test("R70 scattered words in different lines do not count", () => {
  const m = assess(person({ skills: ["Diary management"], workHistory: [role("Assistant", ["Managed the budget for the whole office.", "Kept a diary of site visits for the team."])] }), job(["Demonstrated experience with Diary management"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("partial");
});

test("R71 leading people who use a technology is not using it", () => {
  const m = assess(person({ workHistory: [role("Head of Technology", ["Lead the Centre of Excellence, driving technology practices including Azure across the group."])] }), job(["Experience with Azure"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("partial"); expect(m.evidence[0].explanation).toMatch(/leading others|familiarity/);
});
test("R71 managing the technology itself is using it", () => {
  const m = assess(person({ workHistory: [role("Engineer", ["Managed Azure subscriptions and automated their deployment for three product teams."])] }), job(["Experience with Azure"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("verified");
});
test("R71 claiming familiarity is not described use", () => {
  const m = assess(person({ workHistory: [role("Engineer", ["Familiar with Docker and how containers are deployed across environments."])] }), job(["Experience with Docker"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("partial");
});
test("R71 a broad ability is shown by leading", () => {
  const m = assess(person({ skills: ["Stakeholder communication"], workHistory: [role("Team Lead", ["Led the team through stakeholder communication with the executive every month."])] }), job(["Stakeholder communication"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("verified");
});

test("R72 what a skill is built on is implied, for partial credit only, and says so", () => {
  const m = assess(person({ workHistory: [role("Developer", ["Built a customer portal in React with live document status for the operations team."])] }), job(["Strong experience with JavaScript"]), "", AS_OF);
  expect(m.evidence[0].state).toBe("partial"); expect(m.evidence[0].explanation).toMatch(/implied by .*React/);
});
test("R72 nothing is implied from nothing", () => {
  expect(assess(person(), job(["Strong experience with JavaScript"]), "", AS_OF).evidence[0].state).toBe("not_demonstrated");
});
test("R72 every implication names skills that exist, and none loops", () => {
  const names = new Set(SKILLS.map((s) => s.name));
  for (const [from, to] of Object.entries(ruleset.implications)) { expect(names.has(from), from).toBe(true); for (const t of to) { expect(names.has(t), t).toBe(true); expect(ruleset.implications[t] ?? [], `${from} and ${t} imply each other`).not.toContain(from); } }
});

test("R73 managing people is not years of software development", () => {
  const m = assess(person({ workHistory: [role("Head of Technology", ["Oversaw the technology team expanding development and support services.", "Developed and implemented intern programmes for school leavers."], "2010-01", "2024-01")] }), job(["At least five years of professional software-development experience."]), "", AS_OF);
  expect(m.evidence[0].state).not.toBe("verified");
});
test("R73 years of doing it count", () => {
  const m = assess(person({ workHistory: [role("Software Developer", ["Built and maintained software-development tooling for six product teams."], "2015-01", "2024-01")] }), job(["At least five years of professional software-development experience."]), "", AS_OF);
  expect(m.evidence[0].state).toBe("verified");
});

test("R74 a job's vague line does not take the place of its specific one", () => {
  const m = assess(person(), job(["Five or more years", "At least five years of professional software-development experience."]), "", AS_OF);
  expect(only(m, "Five or more years").possible).toBe(0); expect(only(m, "At least five").possible).toBeGreaterThan(0);
});
test("R74 'preferred' is not mandatory wherever it sits, and 'will be considered' is not a requirement", () => {
  const m = assess(person(), job(["A relevant degree is preferred but not mandatory.", "Equivalent professional experience will be considered."]), "", AS_OF);
  expect(only(m, "relevant degree").mandatory).toBe(false);
  expect(only(m, "Equivalent")).toMatchObject({ state: "not_applicable", possible: 0, mandatory: false });
});
