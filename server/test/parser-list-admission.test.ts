// Experiment E3 (docs/assessment/experiments.json), written BEFORE the change: a skill-list piece is admitted only if it is a complete item. Runs with
// E2 and E3 selected (src/version.ts); the default parser is unaffected. Fictional lines, modelled on the failure class, plus legitimate difficult skills
// that must survive. No document id, name or observed string is special-cased.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseCv } from "../src/rules";

const cv = (skills: string) => `Lerato Example\nData Analyst\nlerato.example@x.example | +27 00 000 0000\n\nEXPERIENCE\nData Analyst\nFictional Co | 2020-01 to Present\nBuilt monthly reports.\n\nSKILLS\n${skills}\n\nEDUCATION\nBCom Accounting | Example University | Completed | 2019`;
const names = (skills: string) => parseCv(cv(skills)).skills.map((s) => s.name);

describe("not admitted: pieces that are not complete items", () => {
  test("prose from another column interleaved into a slash list, across a column bar", () => {
    const got = names("secretariat assistant and have held roles | Attention to detail / Board packs\nRecent responsibilities include tracking | Records management / Minutes");
    for (const bad of ["secretariat assistant and have held roles", "Recent responsibilities include tracking"]) expect(got).not.toContain(bad);
    expect(got).toEqual(expect.arrayContaining(["Attention to detail", "Board packs", "Records management", "Minutes"]));
  });
  test("pieces that begin or end with a function word, or are only function words", () => {
    const got = names("Planning / and / Minutes / for maintaining workforce / governance actions and / Excel");
    for (const bad of ["and", "for maintaining workforce", "governance actions and"]) expect(got).not.toContain(bad);
    expect(got).toEqual(expect.arrayContaining(["Planning", "Minutes", "Excel"]));
  });
  test("a lower-case fragment on the far side of a column bar", () => {
    const got = names("improvement | Quality systems / Document control / Excel");
    expect(got).not.toContain("improvement");
    expect(got).toEqual(expect.arrayContaining(["Quality systems", "Document control", "Excel"]));
  });
});

describe("still admitted: legitimate difficult skills", () => {
  test("short and symbolic names in a slash list (\"R\" is lost in every list form already: register R22, known failure)", () => {
    expect(names("Go / C++ / C# / .NET / Node.js")).toEqual(expect.arrayContaining(["Go", "C++", "C#", ".NET", "Node.js"]));
  });
  test("slashes inside names, versions and digits", () => {
    const got = names("CI/CD / Python 3.11 / Windows Server 2019 / ISO 9001 / Microsoft Teams");
    for (const ok of ["CI/CD", "Python 3.11", "Windows Server 2019", "ISO 9001", "Microsoft Teams"]) expect(got).toContain(ok);
  });
  test("multi-word names containing a function word in the middle", () => {
    const got = names("Research and development / Quality of service / Health and safety");
    for (const ok of ["Research and development", "Quality of service", "Health and safety"]) expect(got).toContain(ok);
  });
  test("a table row separated by bars only (no slashes) is still a list", () => {
    expect(names("Python | SQL | Excel | Power BI")).toEqual(expect.arrayContaining(["Python", "SQL", "Excel", "Power BI"]));
  });
  test("a long slash list without commas", () => {
    expect(names("Ticketing / Troubleshooting / Windows / Networking / Active Directory / Process improvement / Microsoft Teams")).toHaveLength(7);
  });
});

describe("unchanged by E3 (other factors, recorded separately)", () => {
  test("an OCR split inside one word is not repaired by an admission check", () => {
    expect(names("Pro tection / Testing / Excel")).toContain("Pro tection");   // a recognition fault: E3 does not claim to fix it
  });
  test("a sentence in the skills section is not a list", () => {
    expect(names("I am a reliable team member who enjoys working with people and solving problems.")).not.toContain("I am a reliable team member who enjoys working with people and solving problems.");
  });
});
