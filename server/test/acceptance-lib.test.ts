import { expect, test } from "vitest";
import { interval, judge, scoreDocument, verdict } from "./real/acceptanceLib";

const rec = { name: "Thandi Mokoena", email: "thandi@x.co.za", phone: "+27 82 111 2222", location: "Pretoria, Gauteng", role: "Accountant", workHistory: [{ position: "Accountant", company: "Northwind", startDate: "2020-01" }], skills: ["Excel"], education: [{ type: "degree", degree: "BCom Accounting" }, { type: "certificate", degree: "First Aid" }] };
test("what a person left out is not scored; what a person says is absent must stay absent", () => {
  expect(judge("x", undefined)).toBeNull(); expect(judge("", "")).toBe("right"); expect(judge("x", "")).toBe("wrong"); expect(judge("", "y")).toBe("missing");
});
test("each field is judged on its own", () => {
  const out = scoreDocument(rec, { checkedBy: "A person", checkedOn: "2026-11-04", name: "Thandi Mokoena", email: "other@x.co.za", phone: "082 111 2222", location: "Pretoria", roles: [{ position: "Accountant", company: "Southwind" }, { position: "Clerk" }], skills: ["Excel", "SAP"], qualifications: ["BCom"], certifications: ["PMP"] });
  const of = (f: string) => out.filter((o) => o.field === f).map((o) => o.outcome);
  expect(of("name")).toEqual(["right"]); expect(of("email")).toEqual(["wrong"]); expect(of("phone")).toEqual(["wrong"]); expect(of("location")).toEqual(["right"]);
  expect(of("role")).toEqual(["right", "missing"]); expect(of("employer")).toEqual(["wrong"]); expect(of("skill")).toEqual(["right", "missing"]); expect(of("certification")).toEqual(["missing"]);
});
test("candidate and agency are scored apart: an agency published where the person says there is none is wrong", () => {
  expect(scoreDocument({ ...rec, submission: { agency: { name: "Fake" } } }, { checkedBy: "A", checkedOn: "", agency: null })[0]).toEqual({ field: "agency", outcome: "wrong" });
});
test("a passing share with a wrong published e-mail above the limit fails: wrong values are their own criterion", () => {
  const v = verdict({ pdf: { email: { right: 46, wrong: 4, missing: 0 } } }, 0); expect(v.pass).toBe(false);
  expect(verdict({ pdf: { email: { right: 50, wrong: 1, missing: 0 } } }, 0).pass).toBe(true);
  expect(verdict({ pdf: { skill: { right: 46, wrong: 0, missing: 4 } } }, 0).pass).toBe(true);
});
test("too few values are reported and not judged", () => { const v = verdict({ pdf: { email: { right: 1, wrong: 3, missing: 0 } } }, 0); expect(v.pass).toBe(true); expect(v.lines[0]).toMatch(/^n\/a/); });
test("a crash fails the run", () => { expect(verdict({}, 1).pass).toBe(false); });
test("the interval is honest about few documents", () => { const [lo, hi] = interval(18, 20); expect(lo).toBeLessThan(0.75); expect(hi).toBeGreaterThan(0.95); });
