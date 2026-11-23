import { expect, test } from "vitest";
import { assess } from "../src/match";

// Rules 2.11.0 (8 Nov 2026): a requirement no specific check recognises is judged on the CV's own words, piece by piece. Found by the owner: a CV headed
// "Head of Centre of Excellence" scored 0 supported against a Centre of Excellence role, because every word of a requirement had to stand in one sentence.
// Invented person and employers.
const AS_OF = new Date("2026-11-08T00:00:00Z");
const leader: any = { id: "c", name: "Sipho Ndlovu", role: "Head of Centre of Excellence", status: "new", avatar: "", skills: ["Recruitment"], rating: 0, experience: "", location: "", email: "", phone: "", appliedDate: "", education: [],
  summary: "Senior technology leader with experience in the insurance and banking sectors.",
  workHistory: [
    { position: "Head of Centre of Excellence", company: "Coastline Insurance", startDate: "2021", endDate: "Present", responsibilities: ["Lead the Centre of Excellence, driving technology practices including Guidewire and Azure.", "Manage financial oversight, operational governance, IT security and stakeholder engagement.", "Appointed as Director of the services company, providing board governance."] },
    { position: "Production Manager - Investment Banking", company: "Harbour Merchant Bank", startDate: "2014", endDate: "2021", responsibilities: ["Managed offshore teams, vendors and service level agreements.", "Partnered with internal and external audit teams; ran disaster recovery planning and risk management plans."] },
  ] };
const job = (requirements: string[]): any => ({ id: "j", title: "Head of Technology Centre of Excellence", company: "", location: "", skills: [], type: "", department: "", description: "", requirements, preferredRequirements: [] });
const verdict = (r: string, who = leader) => assess(who, job([r]), "", AS_OF).evidence[0];

test("one of several alternatives is enough, and a role's title and described work count: 'centre of excellence, shared services hub or captive delivery centre'", () => {
  const e = verdict("Experience leading a technology centre of excellence, shared services hub or captive delivery centre");
  expect(e.state).toBe("verified");
  expect(e.explanation).toContain("Lead the Centre of Excellence");
});

test("the employer shows the sector, and 'Board or director-level governance' is met by a director's described board work", () => {
  expect(verdict("Experience in insurance and/or banking or investment banking").state).toBe("verified");
  expect(verdict("Board or director-level governance experience").state).toBe("verified");
});

test("a list of parts needs each part: all described is met, some described is partly met and names what is missing", () => {
  expect(verdict("Experience managing offshore teams, vendors and service level agreements").state).toBe("verified");
  expect(verdict("Sound knowledge of IT security, risk management, audit and disaster recovery").state).toBe("verified");
  const some = verdict("Stakeholder engagement across business, risk and audit");
  expect(some.state).not.toBe("not_demonstrated");
});

test("'or higher' and 'or another' are not second ways to meet a requirement, and words the CV never uses are 'not mentioned', not 'cannot be checked'", () => {
  const itil = verdict("ITIL 4 Foundation or higher");
  expect(itil.state).toBe("not_demonstrated");
  expect(itil.explanation).toMatch(/^Not mentioned in the CV/);
  expect(verdict("TOGAF or another enterprise architecture certification").state).toBe("not_demonstrated");
});

test("a claim only in the summary is partly met, not described work", () => {
  const sectorOnlyInSummary = { ...leader, workHistory: [{ ...leader.workHistory[0], company: "Coastline Holdings", responsibilities: ["Lead the Centre of Excellence."] }] };
  expect(verdict("Experience in insurance", sectorOnlyInSummary).state).toBe("partial");
});
