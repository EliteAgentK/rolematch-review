import { expect, test } from "vitest";
import { assess } from "../src/match";
import { findSkills } from "../src/skills";
import { toMonth, yearsCovered } from "../src/dates";
import { supported } from "../src/extract";
import type { Candidate, Job } from "../src/types";

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", name: "Test Person", role: "Developer", status: "new", avatar: "", skills: ["JavaScript", "React"], rating: 0, experience: "6",
  location: "Johannesburg, South Africa", email: "", phone: "", appliedDate: "2026-01-01",
  workHistory: [{ company: "Acme", position: "Senior Developer", startDate: "2018-01", endDate: "Present", responsibilities: ["Built React and JavaScript applications."] }],
  extractionConfidence: 0.9, ...over,
});
const job = (over: Partial<Job> = {}): Job => ({
  id: "j", title: "Developer", location: "Johannesburg, South Africa", company: "X", skills: [], type: "", department: "", description: "",
  requirements: ["Strong experience with TypeScript and JavaScript."], responsibilities: [], postedDate: "", status: "open", extractionConfidence: 0.9, ...over,
});

test("whole-word matching: Java does not match JavaScript", () => {
  expect(findSkills("I know JavaScript well").map((s) => s.name)).toEqual(["JavaScript"]);
  expect(findSkills("Experience with Java and Spring Boot").map((s) => s.name)).toContain("Java");
  expect(findSkills("digital marketing").map((s) => s.name)).not.toContain("Git");
});

test("Node.js does not imply JavaScript, and everyday words are not skills", () => {
  expect(findSkills("Built APIs with Node.js").map((s) => s.name)).toEqual(["Node.js"]);
  expect(findSkills("I will take care of the rest of the team in spring").map((s) => s.name)).toEqual([]);
});

test("a JavaScript-only candidate is not credited for a Java requirement", () => {
  const r = assess(cand(), job({ requirements: ["Experience with Java."] }));
  expect(r.evidence[0].state).toBe("not_demonstrated");
  expect(r.evidence[0].points).toBe(0);
});

test("missing evidence lowers the score instead of being removed from it", () => {
  const r = assess(cand({ skills: [], workHistory: [], summary: "" }), job({ location: "", requirements: ["Experience with Java.", "Experience with Python."] }));
  expect(r.score).toBe(0);
  expect(r.scoreCeiling).toBe(100); // ceiling shows what confirmation could change
  expect(r.recommendation).toContain("Verify 2 mandatory");
});

test("an unrelated candidate does not score well just because evidence is absent", () => {
  const designer = cand({ role: "Designer", skills: ["Figma"], workHistory: [{ company: "D", position: "Designer", startDate: "2018-01", endDate: "2024-01", responsibilities: ["Designed interfaces in Figma."] }] });
  const r = assess(designer, job({ requirements: ["Strong experience with TypeScript and JavaScript.", "Production experience with React and Node.js.", "Experience with PostgreSQL."] }));
  expect(r.score).toBeLessThan(30);
});

test("skills that are only listed, never used, are partial not verified", () => {
  const r = assess(cand({ skills: ["TypeScript", "JavaScript"], workHistory: [{ company: "A", position: "Clerk", startDate: "2020-01", endDate: "2021-01", responsibilities: ["Filing."] }] }), job());
  expect(r.evidence[0].state).toBe("partial");
});

test("years requirement uses dated roles and says it is approximate", () => {
  const r = assess(cand(), job({ requirements: ["At least five years of professional software-development experience."] }));
  expect(r.evidence[0].state).toBe("verified");
  expect(r.evidence[0].explanation).toContain("approximate");
  const short = assess(cand({ workHistory: [{ company: "A", position: "Developer", startDate: "2024-01", endDate: "2025-01", responsibilities: [] }] }), job({ requirements: ["At least five years of professional software-development experience."] }));
  expect(short.evidence[0].state).toBe("partial");
});

test("candidate rating never influences the result", () => {
  const a = assess(cand({ rating: 5 }), job());
  const b = assess(cand({ rating: 0 }), job());
  expect(a.score).toBe(b.score);
});

test("confidence is about evidence, and a draft job lowers it", () => {
  const open = assess(cand(), job({ status: "open" }));
  const draft = assess(cand(), job({ status: "draft" }));
  expect(draft.confidenceScore).toBeLessThan(open.confidenceScore);
  expect(draft.warnings.join(" ")).toContain("draft");
});

test("dates: overlapping roles are counted once, present works", () => {
  expect(toMonth("2021-08")).toBe(2021 * 12 + 7);
  expect(yearsCovered([{ startDate: "2020-01", endDate: "2022-01" }, { startDate: "2021-01", endDate: "2023-01" }])).toBe(3.1);   // January 2020 to January 2023, both months worked
  expect(yearsCovered([{ startDate: "unknown", endDate: "x" }])).toBe(0);
});

test("grounding check rejects quotes that are not in the source", () => {
  const source = "Built APIs with   Node.js\nand PostgreSQL";
  expect(supported(source, "built apis with node.js")).toBe(true);
  expect(supported(source, "Led a team of 40 engineers")).toBe(false);
  expect(supported(source, "")).toBe(false);
});

// ---------- harder matching scenarios ----------
import { parseCv } from "../src/rules";
// The three sample jobs as the job reader of 9 Nov 2026 read them, frozen when job reading moved to Claude (10 Nov 2026): these tests are about the
// matching engine, so their jobs stay exactly what they were.
import CORPUS_JOBS from "./fixtures-corpus-jobs.json";
import { CVS, JDS } from "./corpus";

const fromCv = (id: string, extra: Partial<Candidate> = {}): Candidate => {
  const r = parseCv(CVS[id]);
  return { id: "c", name: r.fullName, role: r.currentRole, status: "new", avatar: "", skills: r.skills.map((s) => s.name), rating: 0, experience: "", location: r.location, email: r.email, phone: r.phone, appliedDate: "", workHistory: r.workHistory, summary: r.summary, education: r.education.map((e) => ({ degree: e.qualification, institution: e.institution, year: e.period })), projects: r.projects.map((p) => p.description), worthNoting: r.worthNoting.map((p) => p.text), extractionConfidence: 0.8, ...extra };
};
const fromJd = (id: string, extra: Partial<Job> = {}): Job => {
  const r: any = (CORPUS_JOBS as Record<string, any>)[id];
  return { id: "j", title: r.title, company: r.company, location: r.location, department: r.department, type: r.employmentType, workArrangement: r.workArrangement, description: r.description, skills: r.skills.map((s: any) => s.name), requirements: r.mandatoryRequirements.map((x: any) => x.text), preferredRequirements: r.preferredRequirements.map((x: any) => x.text), responsibilities: r.responsibilities, postedDate: "", status: "open", extractionConfidence: 0.8, ...extra };
};

test("a sales veteran is credited for sales years, not marked as 0 years", () => {
  const r = assess(fromCv("sales"), fromJd("sales"));
  const years = r.evidence.find((e) => e.label.includes("Two years"))!;
  expect(years.state).toBe("verified");
});

test("a developer is not credited for sales experience; a salesperson is not credited for software", () => {
  const dev = assess(fromCv("classic"), fromJd("sales"));
  expect(dev.evidence.find((e) => e.label.includes("Two years"))!.state).not.toBe("verified");
  const sales = assess(fromCv("sales"), fromJd("sample"));
  expect(sales.score).toBeLessThan(30);
  expect(sales.evidence.find((e) => e.label.includes("TypeScript"))!.state).toBe("not_demonstrated");
});

test("the matching developer scores clearly higher than the salesperson on the same job", () => {
  const job = fromJd("sample");
  expect(assess(fromCv("classic"), job).score).toBeGreaterThan(assess(fromCv("sales"), job).score + 30);
});

test("year ranges use the lower bound, and word numbers work", () => {
  const c = fromCv("classic");
  const j = (req: string) => assess(c, fromJd("sample", { requirements: [req] })).evidence[0];
  expect(j("5-7 years of software development experience.").state).toBe("verified");
  expect(j("At least fifteen years of software development experience.").state).not.toBe("verified");
  expect(j("Ten years experience in software development.").state).toBe("verified"); // the fictional CV really spans about 10.8 years
  expect(j("11 years experience in software development.").state).not.toBe("verified");
});

test("education requirements are checked against the CV and never silently ignored", () => {
  const withDegree = assess(fromCv("classic"), fromJd("sample", { requirements: [], preferredRequirements: ["A relevant degree is preferred but not mandatory."] }));
  expect(withDegree.evidence[0].state).toBe("partial");
  const none = assess(fromCv("noheadings"), fromJd("sample", { requirements: ["A degree in Computer Science."] }));
  expect(none.evidence[0].state).toBe("not_demonstrated");
  // The sample CV gives the degree with a year only. A past year is not proof of completion, so it is a stated qualification to confirm (rules 2.2.0:
  // the capability graph's completion ladder), and the recruiter is told what to verify and ask.
  const field = assess(fromCv("classic"), fromJd("sample", { requirements: ["A degree in Computer Science."] }));
  expect(field.evidence[0].state).toBe("partial");
  expect(field.evidence[0].explanation).toMatch(/Completion: year only/);
  expect(field.evidence[0].explanation).toMatch(/To verify:/);
  const stated = fromCv("classic");
  stated.education = (stated.education ?? []).map((e) => ({ ...e, status: "completed", statusEvidence: "graduated" }));
  expect(assess(stated, fromJd("sample", { requirements: ["A degree in Computer Science."] })).evidence[0].state).toBe("verified");
});

test("qualification status: in progress is not met yet; stated as not completed contradicts the requirement unless an equivalent is accepted", () => {
  const withStatus = (status: "in_progress" | "not_completed", statusEvidence: string) => { const c = fromCv("classic"); c.education = (c.education ?? []).map((e) => ({ ...e, status, statusEvidence })); return c; };
  const doing = assess(withStatus("in_progress", "expected 2027"), fromJd("sample", { requirements: ["A degree in Computer Science."] }));
  expect(doing.evidence[0].state).toBe("not_demonstrated"); expect(doing.scoreCeiling).toBeGreaterThan(doing.scoreFloor);
  const dropped = assess(withStatus("not_completed", "did not complete"), fromJd("sample", { requirements: ["A degree in Computer Science."] }));
  expect(dropped.evidence[0].state).toBe("contradicted"); expect(dropped.scoreCeiling).toBeLessThanOrEqual(40);
  const equivalent = assess(withStatus("not_completed", "did not complete"), fromJd("sample", { requirements: ["A degree in Computer Science or equivalent experience."] }));
  // Not completed earns no qualification credit, but it is not a contradiction when equivalent experience is accepted: experience may still close it.
  expect(equivalent.evidence[0].state).toBe("not_demonstrated"); expect(equivalent.scoreCeiling).toBeGreaterThan(equivalent.scoreFloor);
  expect(equivalent.evidence[0].explanation).toMatch(/also accepts equivalent experience/);
});

test("a skill named only in the profile summary or a certificate is named, not described use", () => {
  const summaryOnly = assess(cand({ skills: [], workHistory: [], summary: "Experienced Kubernetes and Terraform engineer." }), job({ location: "", requirements: ["Experience with Kubernetes and Terraform."] }));
  expect(summaryOnly.evidence[0].state).toBe("partial"); expect(summaryOnly.scoreFloor).toBe(37);   // rules 3.0.0: 0.8 for a named skill, in the skills part (0.30), beside a role part with no dated role (0.35): 0.3 × 0.8 / 0.65
  const cert = assess(cand({ skills: [], workHistory: [], certifications: ["AWS Certified Solutions Architect – Associate"] }), job({ location: "", requirements: ["AWS certification."] }));
  expect(cert.evidence[0].state).toBe("partial");
});

test("recency and level are shown as context, never scored", () => {
  const old = cand({ workHistory: [{ company: "A", position: "Java Developer", startDate: "2005-01", endDate: "2008-01", responsibilities: ["Built Java applications."] }] });
  const r = assess(old, job({ location: "", requirements: ["Experience with Java."] }), "", new Date("2026-10-01T00:00:00Z"));
  expect(r.evidence[0].explanation).toMatch(/Last shown in use: Java in 2008/);
  const recent = cand({ workHistory: [{ company: "A", position: "Java Developer", startDate: "2022-01", endDate: "Present", responsibilities: ["Built Java applications."] }] });
  expect(assess(recent, job({ location: "", requirements: ["Experience with Java."] })).scoreFloor).toBe(r.scoreFloor);
  const senior = assess(cand(), job({ title: "Senior Developer" }));
  expect(senior.context?.[0]).toMatch(/suggests a senior role. Level is not part of the score/);
  expect(senior.scoreFloor).toBe(assess(cand(), job({ title: "Developer" })).scoreFloor);
});

test("a job with no requirements warns instead of producing a meaningless score", () => {
  const r = assess(fromCv("classic"), fromJd("sample", { requirements: [], preferredRequirements: [] }));
  expect(r.warnings.join(" ")).toContain("no requirements");
});

test("the same inputs always produce the same result (reproducible)", () => {
  const a = assess(fromCv("stacked"), fromJd("labelled"));
  const b = assess(fromCv("stacked"), fromJd("labelled"));
  expect(a).toEqual(b);
});

test("a candidate with no CV text at all is never scored above zero by absence", () => {
  const empty = fromCv("noheadings", { skills: [], workHistory: [], summary: "", location: "" });
  const r = assess(empty, fromJd("sample", { location: "" }));
  expect(r.score).toBe(0);
});

test("skills a CV lists that are outside our taxonomy still count (Negotiation, CRM)", () => {
  const r = assess(fromCv("sales"), fromJd("sales"));
  expect(r.evidence.find((e) => e.label.includes("Negotiation"))!.state).not.toBe("not_demonstrated");
  expect(r.evidence.find((e) => e.label.includes("CRM"))!.state).toBe("partial");
  expect(r.counts.verified + r.counts.partial + r.counts.notDemonstrated + r.counts.contradicted).toBe(r.evidence.filter((e) => e.state !== "not_applicable").length);
});

// ---------- fairness and rule control ----------
import { fingerprintOf, ruleset, rulesetFingerprint } from "../src/ruleset";
import { readFileSync } from "node:fs";

test("the rules cannot be changed while the program runs", () => {
  expect(() => { (ruleset.weights as any).mandatory = 99; }).toThrow();
  expect(() => { (ruleset.bands as any).push({ min: 1, label: "x" }); }).toThrow();
  expect(ruleset.weights.mandatory).toBe(10);
});

test("every result records the rules version, and the fingerprint changes if any rule or skill alias changes", () => {
  const r = assess(fromCv("classic"), fromJd("sample"));
  expect(r.rulesVersion).toBe(ruleset.version);
  expect(r.rulesFingerprint).toBe(rulesetFingerprint);
  const tweaked = { ...ruleset, weights: { ...ruleset.weights, mandatory: 11 } };
  expect(fingerprintOf(tweaked)).not.toBe(rulesetFingerprint);
});

test("identical evidence gets an identical score whoever the person is", () => {
  const base = fromCv("classic");
  const job = fromJd("sample");
  const a = assess({ ...base, name: "Alice Anderson", email: "alice@x.test", phone: "1", avatar: "a.png", rating: 5 }, job);
  const b = assess({ ...base, name: "Zanele Zulu", email: "zanele@y.test", phone: "2", avatar: "", rating: 0 }, job);
  expect(a.score).toBe(b.score);
  expect(a.confidenceScore).toBe(b.confidenceScore);
  expect(a.evidence).toEqual(b.evidence);
});

test("the matching engine never reads the traits the ruleset says are off limits", () => {
  const src = readFileSync(new URL("../src/match.ts", import.meta.url), "utf8");
  for (const banned of ["candidate.rating", "candidate.name", "candidate.email", "candidate.phone", "candidate.avatar", "c.name", "c.email"]) expect(src.includes(banned), banned).toBe(false);
});

test("there is no way to change the rules through the API", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  expect(/["'`]\/api\/(rules|ruleset|config|weights)/.test(src)).toBe(false);
  expect(/ruleset/.test(src)).toBe(false); // the server entry point does not even import it
});

test("organisation settings (/api/settings) are walled off from scoring: neither side can reach the other", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const settings = read("settings.ts");
  for (const scoring of ["./rules", "./ruleset", "./match"]) expect(settings.includes(`"${scoring}"`), `settings.ts imports ${scoring}`).toBe(false);
  for (const f of ["match.ts", "rules.ts", "ruleset.ts"]) expect(/from "\.\/settings"/.test(read(f)), `${f} imports settings`).toBe(false);
  // nothing in the settings schema is a weight, formula or pass mark
  const keys = [...settings.matchAll(/^\s{2,}([a-zA-Z]+):\s*z\./gm)].map((m) => m[1]);
  expect(keys.length).toBeGreaterThan(10);
  for (const k of keys) expect(/weight|formula|score|mandatory|ruleset|rubric|passMark/i.test(k), `settings key "${k}"`).toBe(false);
});

// ---- the scoring maths at the level of a whole match (the arithmetic itself is proved in scoring.test.ts) ----
const ops = (over: Partial<Candidate> = {}) => cand({
  skills: ["Linux", "Python", "Docker", "AWS", "Terraform"], role: "Cloud Engineer",
  workHistory: [{ company: "Acme", position: "Cloud Operations Engineer", startDate: "2020-01", endDate: "2025-01", responsibilities: ["Ran Linux servers and wrote Python automation.", "Deployed services on AWS with Terraform and Docker."] }], ...over,
});

test("alternatives are alternatives: 'Bash or Python' is met by Python alone", () => {
  const r = assess(ops({ skills: ["Python"], workHistory: [{ company: "A", position: "Engineer", startDate: "2020-01", endDate: "2024-01", responsibilities: ["Wrote Python automation."] }] }), job({ requirements: ["Bash or Python scripting"] }));
  expect(r.evidence[0].state).toBe("verified");
  expect(r.evidence[0].credit!.low).toBe(1);
});

test("'and' is both: credit grows in proportion to how many of the listed skills are evidenced", () => {
  const four = (have: string[]) => assess(ops({ skills: have, workHistory: [{ company: "A", position: "Engineer", startDate: "2020-01", endDate: "2024-01", responsibilities: [`Ran ${have.join(", ")} in production for the payments platform.`] }] }), job({ requirements: ["Professional AWS, Linux, Terraform and Docker experience"] })).evidence[0].credit!.low;
  expect(four(["AWS"])).toBeCloseTo(0.25, 9);
  expect(four(["AWS", "Linux", "Docker"])).toBeCloseTo(0.75, 9);
  expect(four(["AWS", "Linux", "Docker", "Terraform"])).toBe(1);
});

test("years are counted only from roles that are about the subject, not from any role that shares one word", () => {
  const exec = cand({ workHistory: [{ company: "Bank", position: "Head of Technology", startDate: "2010-01", endDate: "2024-01", responsibilities: ["Led IT strategy and operations for the business."] }] });
  const r = assess(exec, job({ requirements: ["3+ years cloud operations or platform engineering."] }));
  expect(r.evidence[0].state).toBe("not_demonstrated");
});

test("every result is ordered: 0 <= floor <= score <= ceiling <= 100, for every CV against every job", () => {
  for (const c of Object.keys(CVS)) for (const j of Object.keys(JDS)) {
    const r = assess(fromCv(c), fromJd(j));
    expect(r.scoreFloor).toBeGreaterThanOrEqual(0);
    expect(r.scoreFloor).toBeLessThanOrEqual(r.score);
    expect(r.score).toBeLessThanOrEqual(r.scoreCeiling);
    expect(r.scoreCeiling).toBeLessThanOrEqual(100);
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(r.confidenceScore).toBeLessThanOrEqual(100);
  }
});

test("the order of requirements does not change the result", () => {
  const reqs = ["Strong experience with TypeScript and JavaScript.", "Production experience with React and Node.js.", "Experience with PostgreSQL.", "At least five years of professional software-development experience."];
  const a = assess(fromCv("classic"), fromJd("sample", { requirements: reqs })), b = assess(fromCv("classic"), fromJd("sample", { requirements: [...reqs].reverse() }));
  expect([a.score, a.scoreFloor, a.scoreCeiling, a.confidenceScore]).toEqual([b.score, b.scoreFloor, b.scoreCeiling, b.confidenceScore]);
});

test("more evidence never lowers the score: describing one more required skill in work history cannot reduce any view", () => {
  const j = job({ requirements: ["Professional AWS, Linux, Terraform and Docker experience", "Bash or Python scripting"] });
  const less = assess(ops({ workHistory: [{ company: "A", position: "Engineer", startDate: "2020-01", endDate: "2024-01", responsibilities: ["Ran Linux servers."] }] }), j);
  const more = assess(ops({ workHistory: [{ company: "A", position: "Engineer", startDate: "2020-01", endDate: "2024-01", responsibilities: ["Ran Linux servers and deployed with Terraform."] }] }), j);
  expect(more.scoreFloor).toBeGreaterThanOrEqual(less.scoreFloor);
  expect(more.score).toBeGreaterThanOrEqual(less.score);
  expect(more.scoreCeiling).toBeGreaterThanOrEqual(less.scoreCeiling);
});

test("who the person is never moves the score: name, email, phone, photo and rating are not inputs", () => {
  const a = assess(ops(), job({ requirements: ["Professional AWS, Linux, Terraform and Docker experience", "3+ years cloud operations."] }));
  const b = assess(ops({ name: "Completely Different", email: "x@y.test", phone: "000", avatar: "face.png", rating: 5 }), job({ requirements: ["Professional AWS, Linux, Terraform and Docker experience", "3+ years cloud operations."] }));
  expect([a.score, a.scoreFloor, a.scoreCeiling, a.confidenceScore]).toEqual([b.score, b.scoreFloor, b.scoreCeiling, b.confidenceScore]);
});

// ---- never counting the same thing twice ----
test("a requirement repeated in the job description is counted once, and a repeat can never outrank the original", () => {
  const base = ["Strong experience with TypeScript and JavaScript.", "Production experience with React and Node.js."];
  const once = assess(fromCv("classic"), fromJd("sample", { requirements: base, preferredRequirements: [] }));
  const repeated = assess(fromCv("classic"), fromJd("sample", { requirements: [...base, "TypeScript and JavaScript experience required.", "Experience with React and Node.js."], preferredRequirements: ["JavaScript and TypeScript"] }));
  expect([repeated.score, repeated.scoreFloor, repeated.scoreCeiling]).toEqual([once.score, once.scoreFloor, once.scoreCeiling]);
  expect(repeated.evidence.filter((e) => e.duplicateOf).length).toBe(3);
  expect(repeated.evidence.filter((e) => e.duplicateOf).every((e) => e.possible === 0)).toBe(true);
});

test("saying the same thing again in a CV earns nothing extra: repeated words, skills, sentences and whole roles", () => {
  const j = job({ requirements: ["Professional AWS, Linux, Terraform and Docker experience", "3+ years cloud operations."] });
  const role = { company: "A", position: "Cloud Operations Engineer", startDate: "2020-01", endDate: "2024-01", responsibilities: ["Ran Linux servers and deployed with Terraform on AWS."] };
  const plain = assess(ops({ skills: ["Linux", "AWS", "Terraform"], workHistory: [role] }), j);
  const stuffed = assess(ops({
    skills: ["Linux", "AWS", "Terraform", "Linux", "AWS", "Terraform", "linux", "aws"],
    workHistory: [{ ...role, responsibilities: Array.from({ length: 40 }, () => "Ran Linux servers and deployed with Terraform on AWS. Linux Linux Linux AWS AWS Terraform Terraform.") }, role, { ...role }],
  }), j);
  expect([stuffed.score, stuffed.scoreFloor, stuffed.scoreCeiling]).toEqual([plain.score, plain.scoreFloor, plain.scoreCeiling]);
});

test("the same CV matched twice gives exactly the same result, down to the evidence", () => {
  const a = assess(fromCv("classic"), fromJd("sample")), b = assess(fromCv("classic"), fromJd("sample"));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

// Review 16 Nov 2026 (C-H1): the total the AI is told to use "without recalculating" counted each role a month short, was rounded down, and was the
// figure frozen when the CV was read; the role lines beside it counted the full span. Three full-year roles went to the AI as "2 years".
test("experience: a role counts every month it covers, the same as the role lines the AI reads", () => {
  const three = [{ startDate: "2020-01", endDate: "2020-12" }, { startDate: "2021-01", endDate: "2021-12" }, { startDate: "2022-01", endDate: "2022-12" }];
  expect(yearsCovered(three)).toBe(3);
  expect(yearsCovered([{ startDate: "2020-01", endDate: "2020-06" }, { startDate: "2020-06", endDate: "2020-12" }])).toBe(1);   // a handover month counted once
  expect(yearsCovered([{ startDate: "2024-03", endDate: "2024-03" }])).toBe(0.1);   // a one-month role is a month, not nothing
});
test("experience: the match states the total worked out on the match's own date, not the figure stored when the CV was read", () => {
  const person = cand({ experience: "2", workHistory: [
    { company: "A", position: "Developer", startDate: "2020-01", endDate: "2020-12", responsibilities: ["Built JavaScript applications."] },
    { company: "B", position: "Developer", startDate: "2021-01", endDate: "2021-12", responsibilities: ["Built JavaScript applications."] },
    { company: "C", position: "Developer", startDate: "2022-01", endDate: "Present", responsibilities: ["Built JavaScript applications."] },
  ] });
  expect(assess(person, job(), "", new Date("2026-12-15")).experienceYears).toBe(7);   // January 2020 to December 2026: 84 months
});
