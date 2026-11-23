// Experiment E2 (docs/assessment/EXPERIMENTS.md): skill lists separated by " / " were read as one table cell, so most skills were lost.
// Fictional fixtures modelled on the failure class, with counterexamples: a slash inside a skill name (CI/CD) is not a separator.
// E2 is an experiment, off by default (src/version.ts): these tests select it, and the last test checks the default is unchanged.
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseCv } from "../src/rules";


const cv = (skills: string) => `Lerato Example\nData Analyst\nlerato.example@x.example | +27 00 000 0000\n\nEXPERIENCE\nData Analyst\nFictional Co | 2020-01 to Present\nBuilt monthly reports.\n\nSKILLS\n${skills}\n\nEDUCATION\nBCom Accounting | Example University | Completed | 2019`;
const names = (skills: string) => parseCv(cv(skills)).skills.map((s) => s.name);

test("a spaced-slash list gives every skill", () => {
  expect(names("Ticketing / Troubleshooting / Windows / Networking / Microsoft 365 / Active Directory")).toEqual(expect.arrayContaining(["Ticketing", "Troubleshooting", "Windows", "Networking", "Microsoft 365", "Active Directory"]));
});
test("a spaced-slash list that wraps onto the next line", () => {
  expect(names("Excel / Power BI / Controls\n/ Risk assessment / Reporting")).toEqual(expect.arrayContaining(["Excel", "Power BI", "Controls", "Risk assessment", "Reporting"]));
});
test("counterexample: a slash inside a name is not a separator, and the slash list reads like the comma list", () => {
  const slash = names("CI/CD / TCP/IP / UI/UX"), comma = names("CI/CD, TCP/IP, UI/UX");
  expect(slash).toEqual(comma);   // the dictionary's renaming of TCP/IP and UI/UX is a separate failure class (E3), not tested here
  for (const fragment of ["CI", "CD", "TCP", "IP", "UI", "UX"]) expect(slash).not.toContain(fragment);
});
test("unchanged: comma lists", () => expect(names("Python, SQL, Power BI")).toEqual(expect.arrayContaining(["Python", "SQL", "Power BI"])));

