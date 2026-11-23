import { expect, test } from "vitest";
import { assess } from "../src/match";
import { certificateValidity, describeQualification } from "../src/qualifications";

// Owner, 2026-11-04: an expired certificate is historical evidence. It does not satisfy a requirement for currently valid certification. Expired, current and unknown are different, judged on the assessment date and the job's actual requirement. Invented people.
const AS_OF = new Date("2026-11-04T00:00:00Z");
const cert = (degree: string, year = "", institution = "") => ({ degree, institution, year, type: "certificate", level: "Certificate", status: "completed" });
const person = (education: any[], over: any = {}): any => ({ id: "c", name: "Thandi Mokoena", role: "", status: "new", avatar: "", skills: [], rating: 0, experience: "", location: "", email: "", phone: "", appliedDate: "", workHistory: [], education, ...over });
const job = (requirements: string[]): any => ({ id: "j", title: "Project Manager", company: "", location: "", skills: [], type: "", department: "", description: "", requirements, preferredRequirements: [] });
const verdict = (education: any[], requirement: string, asOf = AS_OF) => assess(person(education), job([requirement]), "", asOf).evidence[0];

test.each([
  ["Project Management Certificate", "2019 (Expired)", "expired"],
  ["First Aid Certificate", "Lapsed", "expired"],
  ["First Aid Certificate", "Valid until 2027", "current"],
  ["First Aid Certificate", "Expires 03/2026", "expired"],
  ["First Aid Certificate", "Valid until March 2027", "current"],
  ["First Aid Certificate", "Current", "current"],
  ["First Aid Certificate", "2024", "unknown"],
  ["First Aid Certificate", "", "unknown"],
])("%s, %s: %s", (degree, year, state) => { expect(certificateValidity({ degree, year }, AS_OF).state).toBe(state); });

test("words in a course's own name say nothing about its validity", () => {
  expect(certificateValidity({ degree: "Active Directory Certificate", year: "2024" }, AS_OF).state).toBe("unknown");
  expect(certificateValidity({ degree: "Certificate in Current Affairs", year: "2020" }, AS_OF).state).toBe("unknown");
  expect(certificateValidity({ degree: "Certificate in Expired Goods Handling", year: "2020" }, AS_OF).state).toBe("unknown");
});
test("a printed date is judged against the assessment date, so one record changes with time", () => {
  const item = { degree: "First Aid Certificate", year: "Valid until 2026" };
  expect(certificateValidity(item, new Date("2026-12-31T00:00:00Z")).state).toBe("current");
  expect(certificateValidity(item, new Date("2027-01-01T00:00:00Z")).state).toBe("expired");
  expect(certificateValidity({ degree: "First Aid Certificate", year: "Expires 03/2026" }, new Date("2026-03-31T00:00:00Z")).state).toBe("current");
});
test("valid until a future year is not a study still in progress", () => {
  const q = describeQualification({ degree: "First Aid Certificate", year: "2024, valid until 2027" }, 2026, true, AS_OF);
  expect(q.status).toBe("completed"); expect(q.validity).toBe("current");
});
test("a degree has no validity", () => { expect(describeQualification({ degree: "BCom Accounting", year: "2015" }, 2026).validity).toBeUndefined(); });

test("expired against a current requirement is contradicted, says why, and asks about renewal", () => {
  const e = verdict([cert("First Aid Certificate", "2019 (Expired)")], "Current First Aid certificate");
  expect(e.state).toBe("contradicted"); expect(e.explanation).toMatch(/expired/); expect(e.explanation).toMatch(/renewed/); expect(e.credit.exp).toBe(0);
});
test("a mandatory contradicted certificate is not averaged away", () => {
  const m = assess(person([cert("First Aid Certificate", "2019 (Expired)")], { skills: ["Excel", "Budgeting"], workHistory: [{ company: "N", position: "PM", startDate: "2018-01", endDate: "2024-01", responsibilities: ["Used Excel for budgeting."] }] }), job(["Valid First Aid certificate", "Experience with Excel", "Experience with Budgeting"]), "", AS_OF);
  expect(m.evidence.find((x: any) => x.state === "contradicted")).toBeTruthy(); expect(m.recommendation).toMatch(/contradicted/);
});
test("counterexample: expired against a requirement that does not ask for current is history, not a contradiction", () => {
  const e = verdict([cert("First Aid Certificate", "2019 (Expired)")], "First Aid certificate");
  expect(e.state).toBe("partial"); expect(e.explanation).toMatch(/expired/);
});
test("counterexample: validity unknown is a question, never a contradiction", () => {
  const e = verdict([cert("First Aid Certificate", "2024")], "Current First Aid certificate");
  expect(e.state).toBe("partial"); expect(e.explanation).toMatch(/does not say whether it is still valid/);
});
test("counterexample: stated current is a claim, so partial and never verified", () => {
  const e = verdict([cert("First Aid Certificate", "Valid until 2027")], "Valid First Aid certificate");
  expect(e.state).toBe("partial"); expect(e.explanation).toMatch(/verify/i);
});
test("the same certificate turns from current to contradicted as the assessment date passes", () => {
  const edu = [cert("First Aid Certificate", "Valid until 2026")];
  expect(verdict(edu, "Valid First Aid certificate", new Date("2026-06-01T00:00:00Z")).state).toBe("partial");
  expect(verdict(edu, "Valid First Aid certificate", new Date("2027-06-01T00:00:00Z")).state).toBe("contradicted");
});
test("counterexample: another certificate's expiry says nothing about the one required", () => {
  const e = verdict([cert("Forklift Operator Certificate", "2019 (Expired)")], "Current First Aid certificate");
  expect(e.state).toBe("not_demonstrated");
});
test("counterexample: a certificate missing from the CV is a gap, not a contradiction", () => {
  expect(verdict([], "Current First Aid certificate").state).toBe("not_demonstrated");
});
