import { expect, test } from "vitest";
import { assess } from "../src/match";
import { compareRank } from "../src/scoring";
import { jobAreas, readQualificationNeed } from "../src/graph/qualificationMatch";
import { candidateOf, jobOf, AS_OF } from "./candidate/judgementCases";

// Brief of 2026-11-05, section 10. What must hold whatever the wording or order, on invented people. They test the chain from evidence to score; they do not show a recruiter would agree.
const DUTIES = ["Reconciled supplier and bank accounts every month.", "Prepared monthly management accounts in Excel.", "Investigated ledger variances with budget owners."];
const person = (over: any = {}) => candidateOf({ cv: { skills: ["Excel", "Reconciliations"], duties: DUTIES, position: "Senior Accountant", company: "Elmstead Advisory", start: "2018-01", end: "2024-01", ...over } } as any);
const JOB = ["Experience with Excel", "Experience with reconciliations", "Experience with variance analysis"];
const run = (c: any, reqs = JOB, text?: string, extra: any = {}) => assess(c, { ...jobOf(reqs), ...extra }, text ?? (c.workHistory ?? []).flatMap((w: any) => w.responsibilities ?? []).join("\n"), AS_OF) as any;

test("reordering the requirements changes nothing", () => {
  const base = run(person()), reversed = run(person(), [...JOB].reverse());
  expect(reversed.score).toBe(base.score);
  expect(reversed.confidence).toBe(base.confidence);
  expect([...reversed.evidence].map((e: any) => e.state).sort()).toEqual([...base.evidence].map((e: any) => e.state).sort());
});

test("reordering or repeating a CV's bullets changes nothing", () => {
  const base = run(person());
  expect(run(person({ duties: [...DUTIES].reverse() })).score).toBe(base.score);
  expect(run(person({ duties: [...DUTIES, ...DUTIES] })).score).toBe(base.score);
});

test("the same requirement written twice does not count twice", () => {
  const once = run(person(), ["Experience with Excel", "Experience with Kubernetes"]), twice = run(person(), ["Experience with Excel", "Experience with Excel", "Experience with Kubernetes"]);
  expect(twice.score).toBe(once.score);
});

test("the same thing in other words earns the same state", () => {
  const a = run(person({ skills: [], duties: ["Reconciled supplier accounts every month."] }), ["Experience with reconciliations"]);
  const b = run(person({ skills: [], duties: ["Performed monthly reconciliations of supplier accounts."] }), ["Experience with reconciliations"]);
  expect(a.evidence[0].state).toBe(b.evidence[0].state);
});

// R110, decided by the owner 2026-11-05: a title earns credit where it is relevant to the requirement, and it is not presented as described work. See title-relevance.test.ts.
test("a title with no duties behind it earns named credit, not described use", () => {
  const m = run(person({ position: "Senior Java Developer", skills: [], duties: ["Answered the phones at reception.", "Ordered stationery for the office."] }), ["Experience with Java"]);
  expect(m.evidence[0].state).toBe("partial");
});

test("overlapping roles are not counted twice towards years", () => {
  const c: any = person();
  const role = (company: string) => ({ ...c.workHistory[0], company, position: "Accountant", startDate: "2021-01", endDate: "2024-01", start: "2021-01", end: "2024-01" });
  const one = { ...c, workHistory: [role("A Ltd")] }, both = { ...c, workHistory: [role("A Ltd"), role("B Ltd")] };
  const need = ["5+ years of accounting experience"];
  expect(run(both, need).evidence[0].state).toBe(run(one, need).evidence[0].state);
});

test("absence is not contradiction, and an empty CV is low confidence with nothing contradicted", () => {
  const missing = run(person(), ["Experience with Kubernetes"]);
  expect(missing.evidence[0].state).toBe("not_demonstrated");
  const empty = run(person({ skills: [], duties: [], position: "" }), JOB, "");
  expect(empty.score).toBe(0);
  expect(empty.confidence).toBe("Low");
  for (const e of empty.evidence) expect(e.state).not.toBe("contradicted");
});

test("an agency's selling line about the candidate is not evidence the candidate did the work", () => {
  const m = run(person({ skills: [], duties: ["Answered the phones at reception."], summary: "" }), ["Experience with SAP"], "Presented by Talent Bridge Recruitment. Our consultants have placed many SAP specialists.\nAnswered the phones at reception.");
  expect(m.evidence[0].state).not.toBe("verified");
});

test("a clear fit is above an adjacent role, and that above someone from another field; the order is complete", () => {
  const fit = run(person()), adjacent = run(person({ position: "Bookkeeper", skills: ["Excel"], duties: ["Captured supplier invoices in Excel.", "Filed the monthly statements."] })), other = run(person({ position: "Chef", skills: ["Menu planning"], duties: ["Planned the weekly menu.", "Trained kitchen staff."] }));
  expect(fit.score).toBeGreaterThan(adjacent.score);
  expect(adjacent.score).toBeGreaterThan(other.score);
  const a = { ...fit, id: "a" }, b = { ...fit, id: "b" };
  expect(compareRank(a, b)).not.toBe(0);
  expect(compareRank(a, b)).toBe(-compareRank(b, a));
});

test("a percentage is the arithmetic of the evidence shown, and every state is one of the five", () => {
  const m = run(person(), JOB);
  const points = m.evidence.reduce((n: number, e: any) => n + e.points, 0), possible = m.evidence.reduce((n: number, e: any) => n + e.possible, 0);
  // rules 3.0.0: each line's share of 100 (its part's share times its weight within the part) times its credit adds up to the score
  void points; void possible;
  expect(m.score).toBe(Math.round(m.evidence.reduce((n: number, e: any) => n + (e.share ?? 0) * (e.credit?.exp ?? 0), 0)));
  for (const e of m.evidence) expect(["verified", "partial", "not_demonstrated", "contradicted", "not_applicable"]).toContain(e.state);
  expect(m.disclaimer).toMatch(/human review/i);
});

test("a CV that says it has no experience of something is contradicted, whatever else names it, and says which line", () => {
  const text = `${DUTIES.join("\n")}\nI have no hands-on experience with PostgreSQL, although I have worked alongside colleagues who do.\nAdvanced PostgreSQL Performance, 2023`;
  const e = run(person({ skills: ["Excel", "Reconciliations", "PostgreSQL"] }), ["Experience with PostgreSQL"], text).evidence[0] as any;
  expect(e.state).toBe("contradicted");
  expect(e.credit.exp).toBe(0);
  expect(e.explanation).toMatch(/no hands-on experience with PostgreSQL/);
});
test("no experience of one thing is not a statement about the next thing in the sentence", () => {
  const text = `${DUTIES.join("\n")}\nI have no experience with Terraform but used Kubernetes daily to run our services.`;
  expect((run(person(), ["Experience with Kubernetes"], text).evidence[0] as any).state).not.toBe("contradicted");
});
test("what the person did with it elsewhere still counts: a line about one project is not the whole CV", () => {
  const text = `${DUTIES.join("\n")}\nBuilt and tuned the reporting schema in PostgreSQL for five regional offices.\nThere was no experience with PostgreSQL in the team before I joined.`;
  expect((run(person({ duties: [...DUTIES, "Built and tuned the reporting schema in PostgreSQL for five regional offices."] }), ["Experience with PostgreSQL"], text).evidence[0] as any).state).toBe("verified");
});
test("a job naming a field earns nothing from a degree in another: the level alone does not meet it", () => {
  const degree = (d: string) => candidateOf({ cv: { skills: [], duties: DUTIES, position: "Engineer", company: "Elmstead", education: [{ degree: d, institution: "University of Pretoria", year: "2012" }] } } as any);
  const need = ["Postgraduate Diploma in Critical Care Nursing or equivalent"];
  const other = run(degree("BEng Computer Engineering"), need, "BEng Computer Engineering, University of Pretoria, 2012").evidence[0] as any;
  expect(other.state).toBe("not_demonstrated");
  expect(other.credit.exp).toBe(0);
  expect(other.explanation).toMatch(/Nursing/);
  const same = run(degree("Postgraduate Diploma in Critical Care Nursing"), need, "Postgraduate Diploma in Critical Care Nursing, University of Pretoria, 2012").evidence[0] as any;
  expect(same.credit.exp).toBeGreaterThan(0);
});

// The field matters, named or not (the owner, 2026-11-05). "A relevant field" means relevant to this job: the level alone is not it.
const qualified = (degree: string) => candidateOf({ cv: { skills: [], duties: DUTIES, position: "Officer", company: "Elmstead", education: [{ degree, institution: "University of Pretoria", year: "2012" }] } } as any);
const relevantTo = (title: string, degree: string, requirements: string[] = []) => run(qualified(degree), ["A degree in a relevant field", ...requirements], `${degree}, University of Pretoria, 2012`, { title }).evidence[0] as any;
test("a degree in a relevant field: relevant to this job, and the reason says so", () => {
  for (const [title, degree] of [["ICU Nurse", "Bachelor of Nursing"], ["Financial Accountant", "BCom Accounting"], ["Data Analyst", "BSc Statistics"], ["Software Developer", "BSc Computer Science"], ["Civil Engineer", "BEng Civil Engineering"]]) {
    const e = relevantTo(title, degree);
    expect(e.credit.exp, `${degree} for ${title}`).toBeGreaterThanOrEqual(0.5);
    expect(e.explanation, `${degree} for ${title}`).toMatch(/relevant/i);
  }
});
test("a degree in a relevant field: another field earns nothing, and says it is a gap, not a finding", () => {
  for (const [title, degree] of [["ICU Nurse", "BEng Computer Engineering"], ["Financial Accountant", "Bachelor of Nursing"], ["Software Developer", "BA Drama"], ["Civil Engineer", "BCom Marketing"]]) {
    const e = relevantTo(title, degree);
    expect(e.state, `${degree} for ${title}`).toBe("not_demonstrated");
    expect(e.credit.exp, `${degree} for ${title}`).toBe(0);
    expect(e.explanation, `${degree} for ${title}`).toMatch(/not proof|recruiter/i);
  }
});
test("a degree the list cannot place earns credit only if its own words are about this job, and then only as possible", () => {
  expect(relevantTo("Viticulture Assistant", "Bachelor of Viticulture").credit.exp).toBeGreaterThan(0);
  expect(relevantTo("Viticulture Assistant", "Bachelor of Viticulture").state).toBe("partial");
  expect(relevantTo("Viticulture Assistant", "BA Drama").credit.exp).toBe(0);
});
test("a degree in any field stays any field", () => {
  expect((run(qualified("BA Drama"), ["A degree in any discipline"], "BA Drama, University of Pretoria, 2012", { title: "Civil Engineer" }).evidence[0] as any).credit.exp).toBeGreaterThanOrEqual(0.5);
});
test("'or equivalent relevant experience' is about the experience: the field named before it still decides", () => {
  const need = ["Diploma in Operations Management or equivalent relevant experience"];
  const opts = { title: "Operations Manager" };
  const same = run(qualified("Diploma in Operations Management"), need, "Diploma in Operations Management, University of Pretoria, 2012", opts).evidence[0] as any;
  expect(same.credit.exp).toBeGreaterThan(0);
  const other = run(qualified("Diploma in Nutrition"), need, "Diploma in Nutrition, University of Pretoria, 2012", opts).evidence[0] as any;
  expect(other.credit.exp).toBe(0);
});
test("a named field whose own core the qualification does not teach earns nothing: passing knowledge of a neighbouring subject is not the field", () => {
  const need = ["Degree in Supply Chain Management"], text = (d: string) => `${d}, University of Pretoria, 2012`;
  expect((run(qualified("BCom Accounting"), need, text("BCom Accounting")).evidence[0] as any).credit.exp).toBe(0);
  expect((run(qualified("BCom Logistics"), need, text("BCom Logistics")).evidence[0] as any).credit.exp).toBeGreaterThan(0);
  // a neighbouring degree that does teach part of the core still earns its share
  expect((run(qualified("BSc Mathematics"), ["Degree in Actuarial Science"], text("BSc Mathematics")).evidence[0] as any).credit.exp).toBeGreaterThan(0);
});
test("a field can be named before the word degree, and words every field shares do not make two fields one", () => {
  const text = (d: string) => `${d}, University of Pretoria, 2012`;
  expect((run(qualified("BCom Accounting"), ["Veterinary degree or equivalent relevant experience"], text("BCom Accounting")).evidence[0] as any).credit.exp).toBe(0);
  expect((run(qualified("Bachelor of Veterinary Science"), ["Veterinary degree or equivalent relevant experience"], text("Bachelor of Veterinary Science")).evidence[0] as any).credit.exp).toBeGreaterThan(0);
  expect((run(qualified("BCom Management Accounting"), ["Diploma in Project Management"], text("BCom Management Accounting")).evidence[0] as any).credit.exp).toBe(0);
  expect((run(qualified("BCom Business Management"), ["Diploma in Business Management"], text("BCom Business Management")).evidence[0] as any).credit.exp).toBeGreaterThan(0);
  // not a field: these say what kind of degree, not in what
  expect(readQualificationNeed("A bachelor's degree").namedSubject).toBeUndefined();
  expect(readQualificationNeed("Postgraduate degree").namedSubject).toBeUndefined();
  expect(readQualificationNeed("Any degree").namedSubject).toBeUndefined();
  expect(readQualificationNeed("Tertiary diploma").namedSubject).toBeUndefined();
});

// The model decides what the rules cannot: whether this qualification is in this field (A5). The arithmetic stays arithmetic, and what it decided is said in the reasons.
const FIELD_JOB = ["Diploma in Dental Technology"];
const deg = (d: string) => `${d}, University of Pretoria, 2012`;
const judged = (req: string, d: string, verdict: string, why = "Because of what it teaches.") => ({ [req]: { [d]: { verdict, why } } }) as any;
const withJudgement = (d: string, req: string[], j: any, title = "Dental Technician") => assess(qualified(d), { ...jobOf(req), title } as any, deg(d), AS_OF, j).evidence[0] as any;
test("the model can say a field counts where the rules' list could not place it, and the reason shows who said so", () => {
  const before = withJudgement("Diploma in Oral Prosthetics", FIELD_JOB, undefined), after = withJudgement("Diploma in Oral Prosthetics", FIELD_JOB, judged(FIELD_JOB[0], "Diploma in Oral Prosthetics", "same_field"));
  expect(before.credit.exp).toBe(0);
  expect(after.credit.exp).toBeGreaterThan(0);
  expect(after.state).not.toBe("not_demonstrated");
  expect(after.explanation).toMatch(/language model/i);
  expect(after.explanation).toMatch(/Because of what it teaches/);
});
test("a neighbouring field earns less than the field itself", () => {
  const same = withJudgement("Diploma in Oral Prosthetics", FIELD_JOB, judged(FIELD_JOB[0], "Diploma in Oral Prosthetics", "same_field")), near = withJudgement("Diploma in Oral Prosthetics", FIELD_JOB, judged(FIELD_JOB[0], "Diploma in Oral Prosthetics", "related_field"));
  expect(near.credit.exp).toBeGreaterThan(0);
  expect(near.credit.exp).toBeLessThan(same.credit.exp);
});
test("the model can say a field does not count, and that takes the credit away and says it is a gap", () => {
  const req = ["A degree in a relevant field"], before = withJudgement("BSc Computer Science", req, undefined, "Software Developer"), after = withJudgement("BSc Computer Science", req, judged(req[0], "BSc Computer Science", "different_field"), "Software Developer");
  expect(before.credit.exp).toBeGreaterThan(0);
  expect(after.credit.exp).toBe(0);
  expect(after.state).toBe("not_demonstrated");
  expect(after.explanation).toMatch(/language model/i);
  expect(after.explanation).toMatch(/not proof/i);
});
test("the model cannot raise what level and completion hold back: a lower level still does not meet it, and a degree it never saw is unchanged", () => {
  const req = ["A degree in Dental Technology"];
  expect(withJudgement("Higher Certificate in Dental Technology", req, judged(req[0], "Higher Certificate in Dental Technology", "same_field")).credit.exp).toBe(0);
  const j = judged(req[0], "Another degree altogether", "same_field");
  expect(withJudgement("BA Drama", req, j).credit.exp).toBe(0);
});
test("a judgement changes the score by the same arithmetic as everything else, and nothing is judged twice", () => {
  const req = ["Diploma in Dental Technology", "Experience with Excel"], d = "Diploma in Oral Prosthetics", j = judged(req[0], d, "same_field");
  const a = assess(qualified(d), { ...jobOf(req), title: "Dental Technician" } as any, deg(d), AS_OF, j), b = assess(qualified(d), { ...jobOf(req), title: "Dental Technician" } as any, deg(d), AS_OF, j), none = assess(qualified(d), { ...jobOf(req), title: "Dental Technician" } as any, deg(d), AS_OF);
  expect(a.score).toBe(b.score);
  expect(a.score).toBeGreaterThan(none.score);
  expect(a.scoreFloor).toBeLessThanOrEqual(a.score);
  expect(a.score).toBeLessThanOrEqual(a.scoreCeiling);
});

// What today's fixes could themselves get wrong (the owner: "any issues that could arise from the fixes").
const statement = (line: string, req = "Experience with Kubernetes") => (run(person(), [req], `${DUTIES.join("\n")}\n${line}`).evidence[0] as any).state;
test("only the person saying it about themselves now contradicts: a team, a client, the past and an advert do not", () => {
  expect(statement("I have no experience with Kubernetes.")).toBe("contradicted");
  expect(statement("No experience with Kubernetes.")).toBe("contradicted");
  expect(statement("I've never used Kubernetes.")).toBe("contradicted");
  for (const line of ["The team had no experience with Kubernetes, so I brought in training.", "Our client had no experience with Kubernetes.", "I had no experience with Kubernetes when I joined.", "Candidates with no experience with Kubernetes were trained by me.", "No experience with Kubernetes is required for this role, the advert said.", "Colleagues who never used Kubernetes came to me for help."])
    expect(statement(line), line).not.toBe("contradicted");
});
test("a word that merely starts like a field does not place a job there on its own: an account manager is not in accounting", () => {
  expect(jobAreas({ title: "Sales Account Manager", requirements: ["Experience with customer retention", "Experience with marketing campaigns"] })).toContain("area:marketing");
  expect(jobAreas({ title: "Financial Accountant" })).toContain("area:accounting");
  expect(jobAreas({ title: "ICU Nurse" })).toEqual(["area:nursing"]);
  expect(jobAreas({ title: "Civil Engineer" })).toEqual(["area:civil-engineering"]);
  expect((run(qualified("BCom Marketing"), ["A relevant degree", "Experience with marketing campaigns"], "BCom Marketing, University of Pretoria, 2012", { title: "Sales Account Manager" }).evidence[0] as any).credit.exp).toBeGreaterThan(0);
});
