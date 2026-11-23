// Known failures from the error register (docs/learning/ERROR_REGISTER.md), pinned BEFORE they are fixed so the fix is measured, not assumed.
// A `test.fails` here states the CORRECT behaviour and is expected to fail today; when the rule is fixed, vitest reports it as unexpectedly
// passing, and it is turned into an ordinary test in the same change. Invented text only.
import { expect, test } from "vitest";
import { assess } from "../src/match";
import { compareRank } from "../src/scoring";
import type { Candidate, Job } from "../src/types";

const AS_OF = new Date("2026-10-28");
const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", name: "Test Person", role: "Developer", status: "new", avatar: "", skills: ["React"], rating: 0, experience: "6",
  email: "", phone: "", location: "", summary: "", education: [], languages: [], version: 1, extractionConfidence: 0.6,
  workHistory: [{ company: "Acme", position: "Developer", startDate: "2019-01", endDate: "Present", responsibilities: ["Built React interfaces for customers."] }],
  ...over,
} as unknown as Candidate);
const job = (requirement: string): Job => ({
  id: "j", title: "Platform Engineer", company: "Example", location: "", requirements: [requirement], preferredRequirements: [], responsibilities: [],
  postedDate: "", status: "open", extractionConfidence: 0.9, version: 1,
} as unknown as Job);
const kubernetes = (cvText: string) => assess(candidate(), job("Experience with Kubernetes."), cvText, AS_OF).evidence[0];

test("control: a CV that never mentions Kubernetes leaves the requirement not demonstrated", () => {
  expect(kubernetes("Built React interfaces for customers.").state).toBe("not_demonstrated");
});

// R1: a negated skill is evidence of nothing (and, stated by the candidate, it is closer to a contradiction than to support)
test("R1: 'I have no experience with Kubernetes yet' earns no credit", () => {
  const e = kubernetes("Built React interfaces for customers. Career note: I have no experience with Kubernetes yet.");
  expect(e.credit?.low).toBe(0);
  expect(e.state === "not_demonstrated" || e.state === "contradicted").toBe(true);
});

// R2: a wish in a career objective is not evidence of having done it
test.fails("R2: 'I would love to learn Kubernetes' earns no credit", () => {
  const e = kubernetes("Objective: I would love to learn Kubernetes in my next role. Built React interfaces for customers.");
  expect(e.credit?.low).toBe(0);
  expect(e.state).toBe("not_demonstrated");
});

// R8 (the engine itself): the result depends only on the pair, the rules and the reference date, never on what was assessed before it
test("R8: the same pair gives the same result whatever else was assessed, and in whatever order", () => {
  const c = candidate({ skills: ["JavaScript", "React"] }), j = job("Strong experience with JavaScript and React.");
  const first = assess(c, j, "Built React and JavaScript applications.", AS_OF);
  assess(candidate({ skills: ["Python"] }), job("Python scripting."), "Wrote Python scripts.", AS_OF);   // an unrelated pair in between
  const again = assess(c, j, "Built React and JavaScript applications.", AS_OF);
  expect(again).toEqual(first);
});

// R15: equivalent wording must give equivalent results. The same three requirements score differently under rules 2.2.0 only because the advert groups
// them into different bullets (measured 2026-10-28: 75% against 67%), and a repeated requirement or reordered sections must not move it either.
// docs/assessment/MATCHING_SPECIFICATION.md: criteria are atomic before weighting (regression REG-0002), so this passes once Formula A replaces rules 2.2.0.
test.fails("R15: the same requirements in different bullet structures give the same result", () => {
  const c = candidate({ skills: [], workHistory: [{ company: "Fictional Co", position: "Engineer", startDate: "2020-01", endDate: "Present", responsibilities: ["Built Python data pipelines for billing.", "Deployed services on Microsoft Azure for the payments team."] }] });
  const text = "Built Python data pipelines for billing. Deployed services on Microsoft Azure for the payments team.";
  const one = assess(c, { ...job(""), requirements: ["Python and SQL experience.", "Microsoft Azure experience."] } as Job, text, AS_OF);
  const two = assess(c, { ...job(""), requirements: ["Python experience.", "SQL experience.", "Microsoft Azure experience."] } as Job, text, AS_OF);
  const repeated = assess(c, { ...job(""), requirements: ["Microsoft Azure experience.", "Python experience.", "SQL experience.", "Python experience."] } as Job, text, AS_OF);
  expect(one.score).toBe(two.score);
  expect(repeated.score).toBe(two.score);
});

// R16 to R20 were found while testing the matching proposal against the live engine (recorded in docs/learning/ERROR_REGISTER.md;
// the current behaviour itself is pinned in test/assessment/current-engine.test.ts).
const analystRecord = (education: Candidate["education"], over: Partial<Candidate> = {}) => candidate({ skills: [], education, ...over,
  workHistory: [{ company: "Fictional Logistics", position: "Reporting Analyst", startDate: "2020-01", endDate: "2024-12", responsibilities: ["Wrote SQL reporting for the logistics desk.", "Built Power BI reports for fleet costs."] }] });
const ANALYST_TEXT = "Wrote SQL reporting for the logistics desk. Built Power BI reports for fleet costs.";
const analystJob = { ...job(""), requirements: ["SQL experience.", "3+ years of data analysis or reporting experience.", "Completed bachelor's degree in statistics, mathematics or computer science."], preferredRequirements: ["Power BI or Tableau.", "Python.", "Presenting findings to stakeholders.", "Retail sector experience."] } as Job;
const fiveJob = { ...job(""), requirements: ["SQL experience.", "Python experience.", "Power BI experience.", "Excel experience.", "3+ years of data analysis experience."] } as Job;
const monthsRecord = (m: number, id: string, extractionConfidence = 0.6) => {
  const end = new Date(Date.UTC(2024, m - 1, 1)), lines = ["Wrote SQL reports for finance.", "Built Python scripts to clean sales data.", "Built Power BI dashboards for managers.", "Built Excel models for budgets.", "Analysed sales data and reported trends to managers."];
  const r = assess(candidate({ id, skills: [], extractionConfidence, workHistory: [{ company: "Fictional Co", position: "Data Analyst", startDate: "2024-01", endDate: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`, responsibilities: lines }] }), fiveJob, lines.join(" "), AS_OF);
  return { ...r, id };
};

// R16: the order compares percentages rounded to whole numbers, so different evidence that rounds alike is ordered by record id
// R16 fixed in rules 3.0.0: with the score built from the job's parts, 30 and 31 months no longer round alike here (it passed unexpectedly, as the file's rule says it would; now an ordinary test).
// R16 back on 16 Nov 2026: a role now counts every month it covers (review C-H1), so these are 31 and 32 months, which round alike again (98 and 98).
// It concerns the rules engine's own score only; since 9 Nov the AI sets every score people see, and the rules engine keeps the dated facts.
test.fails("R16: more relevant months rank above fewer, whatever the record ids", () => {
  const fewer = monthsRecord(30, "a-first-id"), more = monthsRecord(31, "z-last-id");
  expect([fewer, more].sort(compareRank)[0].id).toBe("z-last-id");
});

// R17: at equal evidence, the better-read document ranks first, because the tie-break uses confidence and confidence includes extraction quality
// (it bites once the CV is read at under 0.3 against a job read at 0.9: a rule-based read scores 0.2 + 0.4 × coverage)
test.fails("R17: equal documented evidence is not ordered by how well the document was read", () => {
  const poorlyRead = monthsRecord(30, "a", 0.2), wellRead = monthsRecord(30, "b", 0.6);
  expect([wellRead, poorlyRead].sort(compareRank)[0].id).toBe("a");   // the record-id order, as for any other exact tie
});

// R18: saying a degree was not completed ranks below saying nothing, because the contradiction cap (40) applies only to the honest candidate
// R18 fixed in rules 3.0.0 for this job: the degree is one part among several, so the honest candidate is no longer ranked below silence (it passed unexpectedly, as the file's rule says it would; now an ordinary test).
test("R18: an honest 'not completed' does not rank below silence about education", () => {
  const honest = assess(analystRecord([{ degree: "BSc Statistics", institution: "Fictional University", year: "2016", status: "not_completed", statusEvidence: "did not complete" }]), analystJob, ANALYST_TEXT, AS_OF);
  const silent = assess(analystRecord([]), analystJob, ANALYST_TEXT, AS_OF);
  expect(honest.scoreFloor).toBe(silent.scoreFloor);
});

// R19: an unreadable passage is assessed as "not mentioned"; the engine has no reading-problem state
test.fails("R19: a line the reader could not read is not assessed as absent", () => {
  const e = assess(candidate({ skills: [], extraction: { method: "rules", schemaVersion: "1", warnings: ["OCR confidence below the reading threshold on page 1"], droppedUnsupported: [] } } as Partial<Candidate>), { ...job("SQL experience.") } as Job, "Wr0te SOL qu3ries fr ... [unreadable]", AS_OF).evidence[0];
  expect(e.state).not.toBe("not_demonstrated");
});

// R20: "3+ years of data analysis or reporting" with 4.9 relevant reporting years earns half, because the OR alternative ("reporting") is not used
// R20 fixed in rules 2.11.0: "or" names alternatives, so the evidenced reporting years earn full credit (it passed unexpectedly, as the file's rule says it would; now an ordinary test).
test("R20: an evidenced OR alternative in a years requirement earns full credit", () => {
  const e = assess(analystRecord([]), { ...job("3+ years of data analysis or reporting experience.") } as Job, ANALYST_TEXT, AS_OF).evidence[0];
  expect(e.credit?.low).toBe(1);
});

// R22 and R23 were found while building E3's protective tests (docs/assessment/experiments.json). Both are in the DEFAULT parser, not caused by E2 or E3.
import { parseCv } from "../src/rules";
const skillsOf = (line: string) => parseCv(`Lerato Example\nData Analyst\nlerato.example@x.example | +27 00 000 0000\n\nEXPERIENCE\nData Analyst\nFictional Co | 2020-01 to Present\nBuilt monthly reports.\n\nSKILLS\n${line}\n\nEDUCATION\nBCom Accounting | Example University | Completed | 2019`).skills.map((s) => s.name);

// R22: a one-letter skill ("R") is dropped from a skills list, because pieces shorter than two characters are discarded
test("R22: the statistics language R is kept in a skills list", () => {
  expect(skillsOf("R, Go, C++, Python")).toContain("R");
});

// R23: depending on the path, the dictionary replaces the printed term with a different or broader concept. In "CI/CD, TCP/IP, UI/UX", TCP/IP becomes
// Networking (a broader category) and UI/UX becomes UX design, while "Microsoft 365, TCP/IP, Excel" keeps both; when a list falls back to the dictionary
// scan, Microsoft 365 becomes Microsoft Office (a different product line). The printed term must be kept; a canonical concept may sit beside it, never replace it.
test.fails("R23: the printed skill terms are kept whatever the path (TCP/IP, UI/UX)", () => {
  const got = skillsOf("CI/CD, TCP/IP, UI/UX");
  expect(got).toContain("TCP/IP");
  expect(got).toContain("UI/UX");
});
