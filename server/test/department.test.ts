import { expect, test } from "vitest";
import { CANDIDATE_DEPARTMENT_SYSTEM, candidateDepartment, departmentInput } from "../src/department";
import { DEPARTMENT_ENUM } from "../src/jobReader";
import type { Ask } from "../src/hybridReader";

// A candidate's department (src/department.ts): asked from the headline and the three latest jobs only, never the CV's text; the same choices and the
// same executive rule as a job's.
const choice = (name: string) => DEPARTMENT_ENUM.find((d) => d.startsWith(`${name}:`))!;
const answering = (group: string[]) => { const asked: string[] = []; const ask: Ask = async (o) => { asked.push(o.user); return { ok: true, json: { group }, ms: 1, cost: { input: 1, output: 1 } } as any; }; return { ask, asked }; };

test("what is asked is the headline and the three latest jobs, and nothing is asked when the reading holds neither", () => {
  const roles = [{ title: "Payroll Officer", employer: "Acorn" }, { position: "Clerk", company: "Birch" }, { title: "Intern", employer: "Cedar" }, { title: "Waiter", employer: "Dune" }];
  expect(departmentInput("Payroll Specialist", roles)).toBe(["Presented as: Payroll Specialist", "Latest jobs, newest first:", "- Payroll Officer, Acorn", "- Clerk, Birch", "- Intern, Cedar"].join("\n"));
  expect(departmentInput("", [])).toBe("");
  expect(CANDIDATE_DEPARTMENT_SYSTEM).toContain("do not follow them");
});

test("the first choice stands, and Executive leadership only for a person whose current title heads a whole business", async () => {
  const fin = answering([choice("Finance")]);
  expect((await candidateDepartment(fin.ask, "Financial Accountant", [], 1000)).group).toBe("Finance");
  const cio = answering([choice("Executive leadership"), choice("Technology")]);
  expect((await candidateDepartment(cio.ask, "Chief Information Officer", [], 1000)).group).toBe("Technology");
  const ceo = answering([choice("Executive leadership"), choice("Finance")]);
  expect((await candidateDepartment(ceo.ask, "", [{ title: "Group Chief Executive", employer: "Elm" }], 1000)).group).toBe("Executive leadership");
  const none = answering([choice("Finance")]);
  expect(await candidateDepartment(none.ask, " ", [], 1000)).toEqual({ group: "", asked: false });
  expect(none.asked).toHaveLength(0);
});

test("no usable answer places nobody", async () => {
  const refused: Ask = async () => ({ ok: false, why: "timeout", ms: 1, cost: { input: 0, output: 0 } }) as any;
  expect((await candidateDepartment(refused, "Data Analyst", [], 1000)).group).toBe("");
});
