// What the LIVE engine (rules 2.2.0: src/match.ts, src/scoring.ts) actually does on the fictional records the matching proposal cites. These are
// characterisation tests: they pass today and pin the numbers the proposal quotes as "actual engine", so a change to the engine shows which quoted
// numbers went stale. Defects found here are also pinned as known failures (R16 to R20 in known-failures.test.ts). Invented text only.
import { expect, test } from "vitest";
import { assess } from "../../src/match";
import { compareRank } from "../../src/scoring";
import type { Candidate, Job } from "../../src/types";

const AS_OF = new Date("2026-10-28");
export const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", name: "Fictional Person", role: "", status: "new", avatar: "", rating: 0, experience: "4", email: "", phone: "", location: "", summary: "",
  education: [], languages: [], skills: [], version: 1, extractionConfidence: 0.6, workHistory: [], ...over,
} as unknown as Candidate);
export const job = (reqs: string[], pref: string[] = []): Job => ({
  id: "j", title: "Data Analyst", company: "Fictional", location: "", requirements: reqs, preferredRequirements: pref, responsibilities: [], postedDate: "", status: "open", extractionConfidence: 0.9, version: 1,
} as unknown as Job);
const role = (lines: string[], over: object = {}) => ({ company: "Fictional Co", position: "Engineer", startDate: "2018-01", endDate: "Present", responsibilities: lines, ...over });
const rank = (r: ReturnType<typeof assess>, id: string) => ({ ...r, id });

// Score v3 (rules 3.0.0, SCORE_V3.md) ends the disguise: under 2.x ten preferred items hid a missing essential (83, 'Strong documented fit', against 33).
// Now the skills are one part of the job beside the role itself, so the same CV scores 38 and is not called strong; it still ranks above the one with less.
test("no disguise: ten preferred items with a missing essential score 38 ('Limited documented evidence'), not 83 ('Strong'), and still rank above 15", () => {
  const prefs = ["Docker", "Kubernetes", "Terraform", "Jenkins", "Git", "Linux", "AWS", "React", "Node.js", "TypeScript"];
  const xl = [...prefs.map((p) => `Used ${p} daily to ship production services for clients.`), "Wrote SQL reports for finance."];
  const yl = ["Wrote SQL reports for finance.", "Administered Salesforce for the sales team, configuring workflows and user roles."];
  const J = job(["SQL experience.", "Salesforce administration experience."], prefs.map((p) => `${p} experience.`));
  const x = assess(cand({ workHistory: [role(xl)] }), J, xl.join(" "), AS_OF), y = assess(cand({ workHistory: [role(yl)] }), J, yl.join(" "), AS_OF);
  expect([x.scoreFloor, x.band, y.scoreFloor]).toEqual([38, "Limited documented evidence", 15]);
  expect(compareRank(rank(x, "x"), rank(y, "y"))).toBeLessThan(0);   // x ranks first
});

const ANALYST_LINES = ["Wrote SQL reporting for the logistics desk.", "Built Power BI reports for fleet costs."];
const ANALYST_JOB = job(["SQL experience.", "3+ years of data analysis or reporting experience.", "Completed bachelor's degree in statistics, mathematics or computer science."], ["Power BI or Tableau.", "Python.", "Presenting findings to stakeholders.", "Retail sector experience."]);
const analyst = (education: Candidate["education"]) => cand({ education, workHistory: [role(ANALYST_LINES, { company: "Fictional Logistics", position: "Reporting Analyst", startDate: "2020-01", endDate: "2024-12" })] });

test("a contradicted essential caps the result at 40, whatever the parts add up to before it", () => {
  const r = assess(analyst([{ degree: "BSc Statistics", institution: "Fictional University", year: "2016", status: "not_completed", statusEvidence: "did not complete" }]), ANALYST_JOB, ANALYST_LINES.join(" "), AS_OF);
  expect([r.scoreFloor, r.score, r.scoreCeiling]).toEqual([40, 40, 40]);
  // rules 2.11.0: "3+ years of data analysis or reporting" is met by 5 years of reporting ("or" names alternatives), so it is verified, not partial.
  // rules 3.0.0: the last row is the role-fit part ("What they do and did, against this role")
  expect(r.evidence.map((e) => e.state)).toEqual(["verified", "verified", "contradicted", "verified", "not_demonstrated", "not_demonstrated", "not_demonstrated", r.evidence.at(-1)!.state]);
  expect(r.evidence.at(-1)!.dimension).toBe("role");
  // the uncapped weighted mean from the engine's own credits and weights
  // the uncapped value: each line's share of 100 times what it proves (rules 3.0.0); the cap at 40 binds
  const raw = r.evidence.reduce((s, e) => s + (e.share ?? 0) * (e.credit?.low ?? 0), 0);
  expect(raw).toBeGreaterThan(40);
});

test("honesty: the candidate who says the degree was not completed ranks BELOW the one who says nothing about education (40 against 54)", () => {
  const honest = assess(analyst([{ degree: "BSc Statistics", institution: "Fictional University", year: "2016", status: "not_completed", statusEvidence: "did not complete" }]), ANALYST_JOB, ANALYST_LINES.join(" "), AS_OF);
  const silent = assess(analyst([]), ANALYST_JOB, ANALYST_LINES.join(" "), AS_OF);
  expect([honest.scoreFloor, silent.scoreFloor, honest.scoreCeiling, silent.scoreCeiling]).toEqual([40, 54, 40, 100]);
  expect(compareRank(rank(silent, "z"), rank(honest, "a"))).toBeLessThan(0);
});

test("'3+ years of data analysis or reporting': 5 years of reporting (Jan 2020 to Dec 2024, every month counted) earn full credit, because 'or' names alternatives (half credit before rules 2.11.0)", () => {
  const r = assess(analyst([]), job(["3+ years of data analysis or reporting experience."]), ANALYST_LINES.join(" "), AS_OF);
  expect(r.evidence[0].credit).toEqual({ low: 1, exp: 1, high: 1 });
  expect(r.evidence[0].explanation).toMatch(/About 5 years of dated, relevant roles found/);
});

const FIVE = job(["SQL experience.", "Python experience.", "Power BI experience.", "Excel experience.", "3+ years of data analysis experience."]);
const months = (m: number, id: string, extractionConfidence = 0.6) => {
  const end = new Date(Date.UTC(2024, m - 1, 1)), lines = ["Wrote SQL reports for finance.", "Built Python scripts to clean sales data.", "Built Power BI dashboards for managers.", "Built Excel models for budgets.", "Analysed sales data and reported trends to managers."];
  return rank(assess(cand({ id, extractionConfidence, workHistory: [role(lines, { position: "Data Analyst", startDate: "2024-01", endDate: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}` })] }), FIVE, lines.join(" "), AS_OF), id);
};

test("ranking compares ROUNDED percentages: three different evidence levels all show 98 and are then ordered by record id", () => {
  // rules 3.0.0: three neighbouring lengths of role show 98. Reader 2.16.0 counts every month a role covers, so they are 29, 30 and 31 months (the same
  // three roles were counted as 28, 29 and 30 before, a month short); 32 months now shows 99.
  const a = months(29, "b-29"), b = months(30, "c-30"), c = months(31, "a-31");
  expect([a.evidence[4].credit!.low, b.evidence[4].credit!.low, c.evidence[4].credit!.low].map((x) => x.toFixed(3))).toEqual(["0.900", "0.917", "0.933"]);   // rules 2.3.0: "Analysed sales data" now describes data analysis in the CV's own words (R70), which was half credit before
  expect([a.scoreFloor, b.scoreFloor, c.scoreFloor]).toEqual([98, 98, 98]);
  expect([a, b, c].sort(compareRank).map((x) => x.id)).toEqual(["a-31", "b-29", "c-30"]);   // by id, not by evidence
});

test("at equal evidence the better-read document ranks first once reading quality is low enough to lower confidence (below 0.3 here)", () => {
  // confidence multiplies by (CV quality + job quality) / 2 / 0.6, capped at 1: with the job read at 0.9, CV quality from 0.3 up makes no difference
  expect(months(30, "x", 0.3).confidenceScore).toBe(months(30, "y", 0.6).confidenceScore);
  const poor = months(30, "a", 0.2), good = months(30, "b", 0.6);
  expect(poor.scoreFloor).toBe(good.scoreFloor);
  expect([poor, good].sort(compareRank).map((x) => x.id)).toEqual(["b", "a"]);
});

test("an unreadable line is assessed exactly like a line that is not there", () => {
  const garbled = assess(cand(), job(["SQL experience."]), "Wr0te SOL qu3ries fr ... [unreadable]", AS_OF), absent = assess(cand(), job(["SQL experience."]), "", AS_OF);
  expect([garbled.evidence[0].state, garbled.scoreFloor, garbled.scoreCeiling]).toEqual([absent.evidence[0].state, absent.scoreFloor, absent.scoreCeiling]);
});

test("a role titled Data Analyst whose duties are data capture is credited with 4.8 relevant years (the title, not the duties, decides)", () => {
  const c = cand({ role: "Data Analyst", workHistory: [role(["Captured 300 forms a day into the system.", "Checked spelling of customer names on forms."], { company: "Example Stores", position: "Data Analyst", startDate: "2022-01" })] });
  const r = assess(c, job(["3+ years of data analysis experience."]), "Data Analyst, Example Stores, 2022 - Present. Captured 300 forms a day into the system. Checked spelling of customer names on forms.", AS_OF);
  expect(r.evidence[0].explanation).toMatch(/About 4\.8 years of dated, relevant roles found/);
  expect(r.evidence[0].credit?.low).toBe(0.5);
});
