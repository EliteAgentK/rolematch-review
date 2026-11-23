// The capability graph's first slice: qualifications read and compared by level, completion (a ladder of tells) and what they teach.
import { expect, test } from "vitest";
import { readQualifications, majorsOf } from "../src/graph/qualificationReader";
import { assessQualification, coverage, readQualificationNeed } from "../src/graph/qualificationMatch";
import { AREAS, areaOfSubject } from "../src/graph/knowledge";
import type { EducationItem } from "../src/types";

const asOf = new Date("2026-10-23T00:00:00Z");
const item = (degree: string, year = "", over: Partial<EducationItem> = {}): EducationItem => ({ degree, institution: "University", year, status: "not_stated", statusEvidence: "", ...over });
const read = (items: EducationItem[], text = "") => readQualifications(items, { asOf, text });

test("the ladder of tells: stated, implied, dates fit, a bare year, nothing, in progress, a short span, not completed", () => {
  const rung = (items: EducationItem[], text = "") => read(items, text)[0].completion.rung;
  expect(rung([item("BSc Computer Science", "2015", { status: "completed", statusEvidence: "graduated" })])).toBe("stated");
  expect(rung([item("BSc Computer Science", "2012 - 2014"), item("BSc Honours Computer Science", "2015")])).toBe("implied");    // a later honours needs it
  expect(rung([item("BCom Accounting", "2012")], "Registered CA(SA) since 2016")).toBe("implied");                            // a registration needs it
  expect(rung([item("BSc Computer Science", "2012 - 2015")])).toBe("dates_fit");                                              // 3 years, the usual length
  expect(rung([item("BEng Electrical", "2010 - 2014")])).toBe("dates_fit");                                                   // 4 years for an engineering degree
  expect(rung([item("BCom", "2015")])).toBe("year_only");
  expect(rung([item("BCom")])).toBe("not_stated");
  expect(rung([item("BCom", "2024 - 2027")])).toBe("in_progress");                                                            // a year still to come
  expect(rung([item("BCom", "2014 - 2015")])).toBe("short_span");                                                             // 1 year for a 3-year degree: ask
  expect(rung([item("BCom", "2014", { status: "not_completed", statusEvidence: "did not complete" })])).toBe("not_completed");
});

test("every deduction says which tell it rests on, in words", () => {
  const [q] = read([item("BSc Computer Science", "2012 - 2015")]);
  expect(q.completion.tell).toMatch(/2012 to 2015 is 3 years, the usual length of a bachelor's degree/);
  expect(q.completion.quote).toBe("2012 - 2015");
});

test("majors are read from the qualification's own line and raise the knowledge to advanced", () => {
  expect(majorsOf("BCom (Economics and Statistics majors)")).toEqual(["Economics", "Statistics"]);
  expect(majorsOf("BCom, majoring in Accounting and Finance")).toEqual(["Accounting", "Finance"]);
  expect(areaOfSubject("Mathematical Statistics")?.id).toBe("area:statistics");
  expect(areaOfSubject("Financial Mathematics")?.id).toBe("area:financial-mathematics");            // the longer name wins over "mathematics"
  const [q] = read([item("BCom (Economics and Statistics majors)", "2015")]);
  expect(q.profile["area:statistics"]).toBe(3); expect(q.profileFrom).toBe("majors and programme");
});

const ACTUARIAL_JOB = "BSc Actuarial Science or a quantitative degree.";
test("the owner's example: an actuarial degree, a BCom with statistics majors and a general BCom do NOT carry the same weight", () => {
  const need = readQualificationNeed(ACTUARIAL_JOB);
  const credit = (degree: string) => assessQualification(need, read([item(degree, "2015", { status: "completed", statusEvidence: "graduated" })])).credit.low;
  const actuarial = credit("BSc Actuarial Science"), statsMajors = credit("BCom (Economics and Statistics majors)"), general = credit("BCom");
  expect(actuarial).toBe(1);
  expect(statsMajors).toBeGreaterThan(general);
  expect(actuarial).toBeGreaterThanOrEqual(statsMajors);
  expect(general).toBeLessThan(0.6);
});

test("the reasons are spelled out: which knowledge is covered and how deeply, and where it came from", () => {
  const v = assessQualification(readQualificationNeed("A BCom Accounting degree."), read([item("BCom", "2015")]));
  const text = v.lines.join(" ");
  expect(text).toMatch(/accounting introductory of advanced needed/);
  expect(text).toMatch(/Completion: year only, because a past year \(2015\)/);
  expect(text).toMatch(/draft profile awaiting review/);
  expect(text).toMatch(/a completed one is assumed; the recruiter can change this/);
});

test("job side: what each common phrasing needs", () => {
  expect(readQualificationNeed("A BCom Accounting degree.")).toMatchObject({ minNqf: 7, completion: "completed", completionDefaulted: true });
  expect(readQualificationNeed("BCom Accounting, or currently studying towards one.").completion).toBe("studying_accepted");
  expect(readQualificationNeed("Completed BSc in Computer Science.")).toMatchObject({ completion: "completed", completionDefaulted: false });
  expect(readQualificationNeed("A degree in any discipline.")).toMatchObject({ fields: [], vague: false });
  expect(readQualificationNeed("Any relevant degree.")).toMatchObject({ fields: [], vague: true });
  expect(readQualificationNeed("A BCom, BSc or similar degree in a quantitative field.").fields.map((f) => f.name)).toContain("a quantitative field");
  expect(readQualificationNeed("Degree in Finance or 5 years of equivalent experience.").equivalentAccepted).toBe(true);
  expect(readQualificationNeed("Matric certificate.").minNqf).toBe(4);
});

test("a vague requirement with no approved field list is possible, not proved; a lower level does not meet a degree requirement", () => {
  const vague = assessQualification(readQualificationNeed("Any relevant degree."), read([item("BSc Computer Science", "2012 - 2015")]));
  // The level is met but nobody has approved which fields count, so only half of the completion credit is proved (dates fit: 0.75 x 0.5); the rest stays possible.
  expect(vague.credit).toMatchObject({ low: 0.375, high: 1 });
  const diploma = assessQualification(readQualificationNeed("A degree in Information Technology."), read([item("National Diploma in Information Technology", "2012 - 2015")]));
  expect(diploma.credit.low).toBe(0);
});

test("studying is accepted only when the job says so", () => {
  const doing = read([item("BCom Accounting", "2024 - 2027")]);
  expect(assessQualification(readQualificationNeed("BCom Accounting degree."), doing).credit.low).toBe(0);
  expect(assessQualification(readQualificationNeed("BCom Accounting, or currently studying towards one."), doing).credit.low).toBe(1);
});

test("properties: coverage is in [0, 1], more knowledge never lowers it, and the institution's name never matters", () => {
  const ids = AREAS.map((a) => a.id);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 500; i++) {
    const needs: Record<string, 0 | 1 | 2 | 3> = {}, has: Record<string, 0 | 1 | 2 | 3> = {};
    for (const id of ids) { if (rnd() < 0.15) needs[id] = (1 + Math.floor(rnd() * 3)) as 1 | 2 | 3; if (rnd() < 0.3) has[id] = Math.floor(rnd() * 4) as 0 | 1 | 2 | 3; }
    const c = coverage(needs, has); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1);
    const k = ids[Math.floor(rnd() * ids.length)], more = { ...has, [k]: Math.min(3, (has[k] ?? 0) + 1) as 0 | 1 | 2 | 3 };
    expect(coverage(needs, more)).toBeGreaterThanOrEqual(c);
  }
  const need = readQualificationNeed(ACTUARIAL_JOB);
  const a = assessQualification(need, readQualifications([{ ...item("BSc Actuarial Science", "2015"), institution: "University of the Witwatersrand" }], { asOf }));
  const b = assessQualification(need, readQualifications([{ ...item("BSc Actuarial Science", "2015"), institution: "A small college nobody has heard of" }], { asOf }));
  expect(a.credit).toEqual(b.credit);
});

test("the best qualification counts, never a sum: a second degree cannot push the credit above the better one", () => {
  const need = readQualificationNeed(ACTUARIAL_JOB);
  const one = assessQualification(need, read([item("BCom", "2015")])).credit.low;
  const two = assessQualification(need, read([item("BCom", "2015"), item("BA", "2018")])).credit.low;
  expect(two).toBe(one);
});

test("like a careful recruiter: every qualification verdict says what to verify and what to ask, never a judgement of the institution", () => {
  const v = assessQualification(readQualificationNeed(ACTUARIAL_JOB), read([item("BCom", "2012 - 2015")]));
  const c = v.checks.join(" ");
  expect(c).toMatch(/Verify BCom with the institution or SAQA/);
  expect(c).toMatch(/Did you complete the BCom/);
  expect(c).toMatch(/which majors or modules/);
  expect(c).not.toMatch(/prestig|rank|top university/i);
  const short = assessQualification(readQualificationNeed("A BCom degree."), read([item("BCom", "2014 - 2015")]));
  expect(short.checks.join(" ")).toMatch(/shorter than the usual length/);
});

test("a named credential is matched as that credential: a nursing diploma does not meet a trade test requirement", () => {
  const need = readQualificationNeed("trade test certificate");
  expect(need.credential).toBe("Trade certificate");
  const nurse = assessQualification(need, read([item("Diploma in Nursing", "2012 - 2015")]));
  expect(nurse.credit.low).toBe(0);
  const electrician = assessQualification(need, read([item("Ambagstoets (Trade test)", "2015")]));
  expect(electrician.credit.low).toBeGreaterThan(0);
});
