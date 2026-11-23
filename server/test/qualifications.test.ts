import { expect, test } from "vitest";
import { classifyQualification as kind, describeQualification as d, qualificationStatus as st } from "../src/qualifications";

const NOW = 2026; // fixed: the answers must not change as the calendar does

test("what kind of qualification it is", () => {
  const cases: [string, string, string][] = [
    ["BSc Computer Science", "degree", "Bachelor's degree"], ["BCom Accounting", "degree", "Bachelor's degree"], ["Bachelor of Nursing Science", "degree", "Bachelor's degree"], ["LLB", "degree", "Bachelor's degree"],
    ["BSc (Hons) Information Systems", "degree", "Honours degree"], ["BCom Honours Accounting", "degree", "Honours degree"], ["MBA", "degree", "Master's degree"], ["MSc Data Science", "degree", "Master's degree"], ["PhD in Physics", "degree", "Doctorate"],
    ["National Diploma in Marketing", "diploma", "National diploma"], ["Advanced Diploma in Perioperative Nursing", "diploma", "Advanced diploma"], ["Diploma in Nursing", "diploma", "Diploma"], ["PGCE", "diploma", "Postgraduate diploma"], ["Higher Certificate in Management", "diploma", "Higher certificate"],
    ["Matric", "school", "High school"], ["National Senior Certificate", "school", "High school"], ["Grade 12", "school", "High school"], ["Matric, Pretoria Boys High School", "school", "High school"], ["A-Levels", "school", "High school"],
    ["N6 Electrical Engineering", "diploma", "TVET qualification"], ["National Trade Certificate in Plumbing", "certificate", "Trade certificate"], ["Trade test (Red Seal)", "certificate", "Trade certificate"], ["National Certificate: Vocational", "certificate", "National certificate"],
    ["AWS Certified Cloud Practitioner", "certificate", "Certificate"], ["First Aid Level 1", "certificate", "Certificate"], ["MCSE 2000", "certificate", "Certificate"], ["Project Management Short Course", "certificate", "Certificate"], ["PMP", "certificate", "Certificate"],
  ];
  for (const [text, type, level] of cases) expect(kind(text), text).toEqual({ type, level });
  expect(kind("Mastering Microsoft Projects", true).type).toBe("certificate"); // under a Certifications heading and naming no degree
  expect(kind("Operator licence", true).type).toBe("certificate");
});

test("whether it was finished: only what the CV supports", () => {
  const cases: [string, string, string][] = [
    ["BSc Computer Science", "2013 - 2015", "completed"], ["BCom Accounting", "2016", "completed"], ["Diploma in Nursing, completed 2015", "", "completed"], ["Graduated with distinction", "", "completed"],
    ["BSc Computer Science", "2022 - Present", "in_progress"], ["MBA (in progress)", "", "in_progress"], ["Currently studying towards a BCom", "", "in_progress"], ["BSc Information Systems", "expected 2027", "in_progress"], ["Diploma in HR", "2025 - 2027", "in_progress"], ["Final year BCom", "", "in_progress"],
    ["BA Law, did not complete", "2010 - 2012", "not_completed"], ["BSc Engineering (incomplete)", "", "not_completed"], ["BCom, first year only", "2014", "not_completed"], ["Studies discontinued", "", "not_completed"],
    ["Advanced Programming Course", "", "not_stated"], ["BSc Computer Science", "", "not_stated"],
  ];
  for (const [text, period, status] of cases) expect(st(text, period, NOW).status, `${text} ${period}`).toBe(status);
  expect(st("BCom", "2016", NOW).evidence).toMatch(/2016/); // the reason is kept, so a person can see why it says completed
});

test("a qualification is described in one go", () => {
  expect(d({ degree: "BSc (Hons) Information Systems", institution: "University of Pretoria", year: "2016" }, NOW)).toMatchObject({ type: "degree", level: "Honours degree", status: "completed" });
  expect(d({ degree: "Mastering Microsoft Projects", institution: "PSAROS", year: "2012" }, NOW, true)).toMatchObject({ type: "certificate", status: "completed" });
  expect(d({ degree: "Matric", institution: "Pretoria Boys High School", year: "2009" }, NOW)).toMatchObject({ type: "school", level: "High school", status: "completed" });
  expect(d({ degree: "BCom Accounting", institution: "UNISA", year: "2023 - Present" }, NOW)).toMatchObject({ type: "degree", status: "in_progress" });
});

import { extractCandidate } from "../src/extract";
const AS_OF = new Date("2026-10-21"); // the extraction is told what day it is, so these answers are the same whenever the test runs

test("the Education list: every kind in one place, each with what it is and whether it was finished", async () => {
  const cv = `Thandi Nkosi
thandi.nkosi@example.test | 082 555 0100 | Durban, South Africa
Experience
Office Administrator, Bluewater Trading (Mar 2018 - Present)
Handled invoicing and filing.
Education
BCom Accounting, University of KwaZulu-Natal, 2022 - Present
Diploma in Office Administration, Coastal College, 2016 - 2017 (did not complete)
Matric, Durban Girls High School, 2015
Certifications
Pastel Partner Certificate, Pastel Academy (2019)
First Aid Level 1, 2020
Skills
Pastel, Excel, Filing`;
  const rec: any = (await extractCandidate(cv, { asOf: AS_OF })).record;
  const rows = rec.education.map((e: any) => [e.degree, e.type, e.level, e.status]);
  expect(rows).toEqual([
    ["BCom Accounting", "degree", "Bachelor's degree", "in_progress"],
    ["Diploma in Office Administration", "diploma", "Diploma", "not_completed"],
    ["Matric", "school", "High school", "completed"],
    ["Pastel Partner Certificate", "certificate", "Certificate", "completed"],
    ["First Aid Level 1", "certificate", "Certificate", "completed"],
  ]);
  expect(rec.education[0].statusEvidence).toMatch(/present/i);
  expect(rec.education[1].statusEvidence).toMatch(/did not complete/i);
  expect(rec.certifications).toEqual([]);                 // certifications live in the Education list, not in a list of their own
});

test("a CV that never says whether a qualification was finished is not claimed to be", async () => {
  const cv = `Sipho Dlamini\nsipho@example.test | 071 555 0101\nEducation\nBSc Computer Science, University of Pretoria\nSkills\nPython, SQL, Git`;
  const rec: any = (await extractCandidate(cv, { asOf: AS_OF })).record;
  expect(rec.education[0]).toMatchObject({ degree: "BSc Computer Science", status: "not_stated" });
});

test("the same CV gives the same answer on any day: only the date the extraction is told matters", async () => {
  const cv = `Ayanda Mkhize\nayanda@example.test | 072 555 0102\nExperience\nAnalyst, Acme (Jan 2020 - Present)\nBuilt reports.\nEducation\nBSc Statistics, University of Cape Town, 2021 - 2027\nSkills\nSQL, Excel, R programming`;
  const a: any = await extractCandidate(cv, { asOf: new Date("2026-10-21") }), b: any = await extractCandidate(cv, { asOf: new Date("2026-10-21") });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a.record.education[0].status).toBe("in_progress");                                 // 2027 is still to come
  const later: any = await extractCandidate(cv, { asOf: new Date("2028-03-01") });
  expect(later.record.education[0].status).toBe("completed");                                // two years on, the same words say it ended
  expect(a.meta.asOf).toBe("2026-10-21");                                                    // and the record says which day it was read as
  expect(Number(later.record.experience)).toBeGreaterThan(Number(a.record.experience));
});

// Review 16 Nov 2026 (C-H3): how a qualification was studied, or a certificate said to be current, was read as "still studying", and the AI was
// then told "completion: in progress" for a degree finished years ago or a certificate the person holds.
test("part-time is how a qualification was studied, not that it is unfinished", () => {
  expect(st("BCom Accounting (part-time), Unisa", "2012 - 2015", 2026).status).toBe("completed");
  expect(st("BCom Accounting, studied part time", "2019", 2026).status).toBe("completed");
});
test("a certificate said to be current is held: 'current' is about its validity, never its progress", () => {
  for (const name of ["AWS Certified Solutions Architect – current", "AWS Certified Solutions Architect (current)", "Registered Nurse, SANC, currently registered", "Valid driver's licence, currently"])
    expect(d({ degree: name }, 2026, true).status, name).not.toBe("in_progress");
});
test("dates running to the present still mean studying, and so do the CV's own words for it", () => {
  expect(st("BSc Computer Science", "2022 – current", 2026).status).toBe("in_progress");
  expect(st("BSc Computer Science", "Feb '22 - present", 2026).status).toBe("in_progress");
  expect(st("BCom, currently studying part-time", "", 2026).status).toBe("in_progress");
});
