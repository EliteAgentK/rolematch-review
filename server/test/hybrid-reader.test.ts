import { expect, test } from "vitest";
import { associationOf, contactFromModel, hasDateRange, heldInATable, isPhoneNumber, hybridRead, regionsOf, unaccountedDates, type Ask } from "../src/hybridReader";
import { CANDIDATE_DEPARTMENT_SYSTEM } from "../src/department";
import { DEPARTMENT_ENUM } from "../src/jobReader";
import { assess } from "../src/match";
import { datesOf, PROFILE_SYSTEM, readerInput, regionInput, spokenLanguages, validateProfile, validateReading, validateWritten } from "../src/modelReader";
import { mergeReading, reconcileRoles, rulesSkillStands } from "../src/reconcile";
import { compareRank } from "../src/scoring";

// The system and the model together. The model here is a stand-in, so what is tested is what code does with its answers. Everything invented.
const CV = ["Thandi Mokoena", "thandi@mail.example", "WORK HISTORY", "November 2021 - Present", "Northwind Traders", "Financial Accountant", "Prepared monthly statements.", "Reconciled accounts.", "March 2019 - October 2021", "Elmstead Advisory", "Junior Accountant", "Captured invoices.", "EDUCATION", "BCom Accounting, University of Pretoria, 2018"].join("\n");
const empty = { roles: [], education: [], certifications: [], skills: [], languages: [], location: "", agency: { name: "", recruiter: "", recruiterEmail: "", recruiterPhone: "" } };
// The career summary (PROFILE_SYSTEM) and the department (CANDIDATE_DEPARTMENT_SYSTEM) are their own questions asked beside the reading; the stand-in answers
// them apart (the department as Finance), and `calls` counts the reading's questions only.
const answering = (...answers: object[]): Ask & { calls: { user: string; system: string }[]; summaries: number; departments: string[] } => { const calls: { user: string; system: string }[] = []; const ask = (async (o: any) => { if (o.system === PROFILE_SYSTEM) { ask.summaries++; return { ok: true, json: { profile: "" }, raw: "", ms: 10, model: "stand-in" }; } if (o.system === CANDIDATE_DEPARTMENT_SYSTEM) { ask.departments.push(o.user); return { ok: true, json: { group: [DEPARTMENT_ENUM.find((d) => d.startsWith("Finance:"))] }, raw: "", ms: 10, model: "stand-in" }; } calls.push(o); const json = answers[Math.min(calls.length - 1, answers.length - 1)]; return { ok: true, json, raw: "", ms: 10, model: "stand-in" }; }) as any; ask.calls = calls; ask.summaries = 0; ask.departments = []; return ask; };
const accountant = { title: "Financial Accountant", employer: "Northwind Traders", start: "November 2021", end: "Present", lines: [4, 5, 6] }, junior = { title: "Junior Accountant", employer: "Elmstead Advisory", start: "March 2019", end: "October 2021", lines: [9, 10, 11] }, degree = { qualification: "BCom Accounting", institution: "University of Pretoria", year: "2018", lines: [14] };

test("a reading whose citations hold is supported, with one model call and its duties from the lines beneath it", async () => {
  const ask = answering({ ...empty, roles: [accountant, junior], education: [degree] }), r = await hybridRead(ask, CV, []);
  expect(ask.calls.length).toBe(1);
  expect(r.employment.state).toBe("supported");
  // The department is asked once, from the headline and the jobs just read, never the CV's text, and kept on the reading.
  expect(ask.departments).toHaveLength(1);
  expect(ask.departments[0]).toContain("Financial Accountant, Northwind Traders");
  expect(ask.departments[0]).not.toContain("Reconciled accounts");
  expect(r.reading?.group).toBe("Finance");
  expect(r.roles.map((x) => x.status)).toEqual(["supported", "supported"]);
  expect(r.roles.find((x) => x.position === "Junior Accountant")?.responsibilities).toEqual(["Captured invoices."]);
});
test("a job heading with a bar between two titles, or with dashes in it, is a job and is kept (12 Nov 2026: a real CV lost its current job this way)", async () => {
  // Invented, in the shape of the CV on live: the current job's title is written "Head of ... | Director", and another job's heading has two dashes,
  // which used to count as words and made it read as a sentence. Both were set aside as unconfirmed, and the summary named the wrong latest job.
  const cv = ["Lindiwe Dube", "WORK EXPERIENCE", "Acme Insurance - Head of Platform Engineering | Director | September 2021 - Present", "Lead the platform group and its engineering practices.",
    "Northwind Bank - Loan Platform Team Lead - Investment Banking | Mar 2017 - Jan 2020", "Managed the full lifecycle of an automation project, meeting all of its milestones on time."].join("\n");
  const head = { title: "Head of Platform Engineering | Director", employer: "Acme Insurance", start: "September 2021", end: "Present", lines: [3, 4] };
  const lead = { title: "Loan Platform Team Lead - Investment Banking", employer: "Northwind Bank", start: "Mar 2017", end: "Jan 2020", lines: [5, 6] };
  const r = await hybridRead(answering({ ...empty, roles: [head, lead] }), cv, []);
  expect(r.roles.map((x) => [x.position, x.status])).toEqual([["Head of Platform Engineering | Director", "supported"], ["Loan Platform Team Lead - Investment Banking", "supported"]]);
  expect(r.employment.state).toBe("supported");
  // A bar between cells that hold a date or a place is still not a title.
  const { byNumber } = readerInput(["Manager | Johannesburg | 2019", "Acme"].join("\n"));
  expect(associationOf({ title: "Manager | Johannesburg | 2019", employer: "Acme", start: "2019", end: "", lines: [1] }, byNumber).whole).toBe(false);
});
test("words somewhere in the CV do not support a role: the employer must sit with the title it is claimed for", () => {
  const { byNumber } = readerInput(CV);
  expect(associationOf({ ...junior, employer: "Northwind Traders" }, byNumber).employer).toBe(false);
  expect(associationOf(junior, byNumber)).toEqual({ title: true, employer: true, dates: true, cited: true, whole: true });
  expect(associationOf({ ...junior, start: "" }, byNumber).dates).toBe(false);
});
test("a role adrift goes back as its region alone, and the corrected answer replaces it", async () => {
  const ask = answering({ ...empty, roles: [accountant, { ...junior, employer: "Northwind Traders" }], education: [degree] }, { ...empty, roles: [junior] }), r = await hybridRead(ask, CV, []);
  expect(ask.calls.length).toBe(2);
  expect(ask.calls[1].user).toContain(">> ");
  expect(ask.calls[1].user.split("\n").length).toBeLessThan(CV.split("\n").length + 2);
  expect(r.roles.find((x) => x.position === "Junior Accountant")?.company).toBe("Elmstead Advisory");
  expect(r.employment.state).toBe("supported");
  expect(r.trace.repaired).toBe(1);
});
test("a job the model left out is noticed from its dates, read again, and added", async () => {
  const ask = answering({ ...empty, roles: [accountant], education: [degree] }, { ...empty, roles: [junior] }), r = await hybridRead(ask, CV, []);
  expect(r.trace.added).toBe(1);
  expect(r.roles.length).toBe(2);
});
test("what stays unresolved is said, not hidden: the state is uncertain with its reason", async () => {
  const r = await hybridRead(answering({ ...empty, roles: [accountant], education: [degree] }, { ...empty }), CV, []);
  expect(r.employment.state).toBe("uncertain");
  expect(r.employment.reasons.join(" ")).toMatch(/date range/);
});
test("no answer never becomes a complete record: the rules' roles stay, marked uncertain", async () => {
  const ask: Ask = async () => ({ ok: false, why: "timeout", detail: "x", ms: 1, model: "stand-in" }), r = await hybridRead(ask, CV, [{ position: "Accountant", company: "Northwind", startDate: "2021", endDate: "Present" }]);
  expect(r.reading).toBeNull();
  expect(r.employment.state).toBe("uncertain");
  expect(r.roles[0].status).toBe("uncertain");
});
test("an answer cut short is asked once more with room, not taken as it stands", async () => {
  let n = 0; const ask: Ask = async (o: any) => { if (o.system === PROFILE_SYSTEM) return { ok: true, json: { profile: "", written: [] }, raw: "", ms: 1, model: "m" } as any; if (o.system === CANDIDATE_DEPARTMENT_SYSTEM) return { ok: true, json: { group: [] }, raw: "", ms: 1, model: "m" } as any; n++; return n === 1 ? { ok: false, why: "truncated", detail: "x", ms: 1, model: "m" } : { ok: true, json: { ...empty, roles: [accountant, junior], education: [degree] }, raw: "", ms: 1, model: "m", ...(o.maxTokens ? {} : {}) } as any; };
  expect((await hybridRead(ask, CV, [])).roles.length).toBe(2); expect(n).toBe(2);
});
test("a long document goes in overlapping sections and a job in the overlap is one job, and nothing is cut off the end", async () => {
  const long = Array.from({ length: 700 }, (_, i) => `Line of ordinary content number ${i} about the work that was done here`).join("\n"), { parts, byNumber } = readerInput(long);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.at(-1)).toContain(`[${byNumber.size}]`);
  const text = `${long}\nNovember 2021 - Present\nNorthwind Traders\nFinancial Accountant`, last = byNumber.size + 1;
  const ask = answering({ ...empty, roles: [{ ...accountant, lines: [last, last + 1, last + 2] }] }), r = await hybridRead(ask, text, []);
  expect(r.roles.length).toBe(1);
});
test("date ranges are recognised however they are written, and study dates cited as education are not missing jobs", () => {
  for (const l of ["Jan 2019 - Mar 2021", "2015 – 2016", "June 2012 to Present", "03/2019 - 05/2020"]) expect(hasDateRange(l)).toBe(true);
  for (const l of ["Reduced costs by 20-30 percent in 2019", "Page 2 of 3", "2019"]) expect(hasDateRange(l)).toBe(false);
  const text = "EDUCATION\nBCom, University of Pretoria\n2015 - 2018\nWORK\nAcme\nClerk\nJan 2019 - Mar 2021", { byNumber } = readerInput(text), v = validateReading({ ...empty, education: [{ qualification: "BCom", institution: "University of Pretoria", year: "2018", lines: [2, 3] }] }, text, byNumber);
  expect(unaccountedDates(v, byNumber)).toEqual([7]);
  expect(unaccountedDates({ ...v, roles: [{ title: "Clerk", employer: "Acme", start: "January 2019", end: "March 2021", lines: [90] }] }, byNumber)).toEqual([]);
  expect(regionsOf([7], byNumber)[0].about).toEqual([7]);
});
test("a role only the rules found is kept apart as competing evidence, not shown as a role", () => {
  const roles = reconcileRoles([{ position: "Page Header Words", company: "Some Company", startDate: "2010", endDate: "2011" }], [{ position: "Clerk", company: "Acme", startDate: "2019", endDate: "2021", lines: [1] }], true);
  const merged = mergeReading({ workHistory: [] }, { reading: validateReading(empty, ""), roles, employment: { state: "supported", reasons: [] }, trace: {} }, { model: "m", promptVersion: "p", asOf: new Date("2022-01-01") });
  expect(merged.workHistory.map((r: any) => r.position)).toEqual(["Clerk"]);
  expect(merged.reading.unconfirmedRoles[0].position).toBe("Page Header Words");
  expect(merged.experience).toBe("2");
});
// R165: a model wrote one job several times, each titled with another line of the CV (a bullet, a department) and each with the job's own dates. None of 698 answer keys
// (30 real CVs, 668 from the packs) holds two jobs at one employer with the same start and end, so those are one job, and the best-evidenced reading of it stands.
test("one employer with the same start and end is one job: the better-evidenced reading stands, then the first", () => {
  const job = { company: "Northwind Traders", startDate: "November 2021", endDate: "Present" };
  const rules = [{ position: "Financial Accountant", ...job }];
  const model = [{ position: "Prepared monthly statements", ...job, lines: [7] }, { position: "Financial Accountant", ...job, lines: [4, 5] }, { position: "Junior Accountant", company: "Northwind Traders", startDate: "March 2019", endDate: "October 2021", lines: [9] }];
  const roles = reconcileRoles(rules, model, true);
  expect(roles.map((r) => r.position)).toEqual(["Financial Accountant", "Junior Accountant"]);   // not the first one written, which the rules' reading contradicts
  expect(roles[0].agreement).not.toBe("conflict");
  const twoTitles = reconcileRoles([], [{ position: "Head of Finance", ...job, lines: [1] }, { position: "Finance Department", ...job, lines: [2] }], true);
  expect(twoTitles.map((r) => r.position)).toEqual(["Head of Finance"]);   // equal evidence: the first stands
  // A promotion at one employer has other dates, and a role with no start is never folded into another.
  expect(reconcileRoles([], [{ position: "Senior Accountant", ...job, lines: [1] }, { position: "Accountant", company: job.company, startDate: "January 2020", endDate: "October 2021", lines: [2] }], true)).toHaveLength(2);
  expect(reconcileRoles([], [{ position: "Clerk", company: "Acme", lines: [1] }, { position: "Typist", company: "Acme", lines: [2] }], true)).toHaveLength(2);
});
test("two readings of one role: the lines bear out one, it stands and the other is kept; they bear out both, it is a conflict", () => {
  const m = [{ position: "Financial Accountant", company: "Northwind Traders", startDate: "2021", endDate: "Present", lines: [4] }], r = [{ position: "Financial Accountant", company: "Reconciled accounts", startDate: "2021", endDate: "Present" }];
  expect(reconcileRoles(r, m, true, () => false)[0]).toMatchObject({ status: "supported", agreement: "conflict", rulesReading: { company: "Reconciled accounts" } });
  expect(reconcileRoles(r, m, true, () => true)[0].status).toBe("conflicting");
});

test("an agency's contact details are not the candidate's, whichever reader took them; a gap is filled only from the document", async () => {
  const reading = { ...validateReading(empty, ""), agency: { name: "BrightStaff", recruiter: "Glenda", recruiterEmail: "glenda@bright.example", recruiterPhone: "011 555 0100" }, location: "Pretoria" };
  const merged = mergeReading({ name: "", email: "glenda@bright.example", phone: "011 555 0100", location: "Black, Male", workHistory: [] }, { reading, roles: [], employment: { state: "supported", reasons: [] }, trace: {}, contact: { name: "Thandi Mokoena", email: "thandi@mail.example", phone: "" } }, { model: "m", promptVersion: "p" });
  expect(merged).toMatchObject({ name: "Thandi Mokoena", email: "thandi@mail.example", phone: "", location: "Pretoria" });
  expect(mergeReading({ location: "Black, Male", workHistory: [] }, { reading: validateReading(empty, ""), roles: [], employment: { state: "supported", reasons: [] }, trace: {} }, { model: "m", promptVersion: "p" }).location).toBe("");
  const ask = answering({ name: "Invented Person", email: "not@in.document", phone: "082 000 0000" });
  expect(await contactFromModel(ask, CV, {}, 1000)).toMatchObject({ name: undefined, email: undefined, phone: undefined });
  const right = answering({ name: "Thandi Mokoena", email: "thandi@mail.example", phone: "" });
  expect(await contactFromModel(right, CV, { phone: "082" }, 1000)).toMatchObject({ name: "Thandi Mokoena", email: "thandi@mail.example" });
  expect((await contactFromModel(right, CV, { name: "x", email: "y", phone: "z" }, 1000)).name).toBeUndefined();
});

test("a skill only the rules found stands when it reads as a skill, and letterheads and names do not", () => {
  const text = "Thandi Mokoena\nDIRECTORS\nElia Salvucci\nLonehill 2062\nSkills\nProcess improvement, Stakeholder management, Requirements Gathering";
  const kept = ["Process improvement", "Stakeholder management", "Requirements Gathering", "DIRECTORS", "Elia Salvucci", "2062", "Thandi Mokoena"].filter((x) => rulesSkillStands(x, text, { name: "Thandi Mokoena" }));
  expect(kept).toEqual(["Process improvement", "Stakeholder management", "Requirements Gathering"]);
});
test("languages come one each, without their level", () => {
  expect(["Zulu and Xhosa", "Afrikaans (basic)", "English (conversational - fluent)", "North and South Sotho"].flatMap(spokenLanguages)).toEqual(["Zulu", "Xhosa", "Afrikaans", "English", "North and South Sotho"]);
});
test("education the rules saw and the model left out is read again, as that part alone", async () => {
  const ask = answering({ ...empty, roles: [accountant, junior], education: [] }, { ...empty, education: [degree, { qualification: "Higher Certificate in Bookkeeping", institution: "Damelin", year: "2014", lines: [16] }] });
  const text = `${CV}\nHigher Certificate in Bookkeeping, Damelin, 2014`, r = await hybridRead(ask, text, [], { rulesEducation: ["BCom Accounting", "Higher Certificate in Bookkeeping"] });
  expect(ask.calls.length).toBe(2);
  expect(r.reading?.education.length).toBe(2);
});
test("an identity number is never taken for a phone number", () => {
  expect(isPhoneNumber("9406015566086")).toBe(false);
  expect(isPhoneNumber("082 555 0199")).toBe(true);
  expect(isPhoneNumber("+27 82 555 0199")).toBe(true);
});
test("a certificate is a name, not a date or only the place that gave it", () => {
  const text = "Certificates\nPMP\nUniversity of Johannesburg\n06/2016 - 10/2016";
  expect(validateReading({ ...empty, certifications: ["PMP", "University of Johannesburg", "06/2016 - 10/2016"] }, text).certifications).toEqual(["PMP"]);
});
test("a whole range given as the start, or a dangling dash, becomes start and end as printed", () => {
  expect(datesOf("Feb 2019 – May 2020", "")).toEqual({ start: "Feb 2019", end: "May 2020" });
  expect(datesOf("JUN 2013 —", "")).toEqual({ start: "JUN 2013", end: "" });
  expect(datesOf("2015-2017", "")).toEqual({ start: "2015-2017", end: "" });
  expect(datesOf("March 2019", "Present")).toEqual({ start: "March 2019", end: "Present" });
});

const job = { id: "j", title: "Accountant", requirements: ["5+ years of accounting experience"], preferredRequirements: [], skills: [], status: "open", location: "" } as any;
const candidate = (employment?: object, workHistory: object[] = []) => ({ id: "c", name: "T", skills: [], experience: "", workHistory, education: [], ...(employment ? { reading: { employment } } : {}) }) as any;
test("unreadable work history that decides a requirement gives Assessment incomplete, with no band and a named reason", () => {
  const r = assess(candidate({ state: "uncertain", reasons: ["Two date ranges are not accounted for"] }), job, "", new Date("2026-01-01"));
  expect(r.assessment?.state).toBe("incomplete");
  expect(r.band).toBe("Assessment incomplete");
  expect(r.assessment?.affected.length).toBe(1);
  expect(r.evidence[0].contract).toMatchObject({ extractionUncertain: true, requirementSource: "mandatory", contradiction: null });
});
test("uncertain work history does not hold up a job that does not count on it", () => {
  const r = assess(candidate({ state: "uncertain", reasons: ["x"] }), { ...job, requirements: ["Knowledge of Excel"] }, "Excel", new Date("2026-01-01"));
  expect(r.assessment?.state).toBe("complete");
});
test("uncertain work history that already meets the requirement is no obstacle", () => {
  const r = assess(candidate({ state: "uncertain", reasons: ["x"] }, [{ position: "Accountant", company: "Acme", startDate: "2010", endDate: "2025", responsibilities: ["accounting"] }]), job, "Accountant accounting", new Date("2026-01-01"));
  expect(r.assessment?.state).toBe("complete");
});
test("a complete reading, or none recorded, assesses as before", () => {
  expect(assess(candidate({ state: "supported", reasons: [] }), job, "", new Date("2026-01-01")).assessment?.state).toBe("complete");
  expect(assess(candidate(), job, "", new Date("2026-01-01")).assessment?.state).toBe("complete");
});
test("incomplete assessments come after ranked ones, in a fixed order that takes nothing from their numbers", () => {
  const row = (id: string, score: number, state = "complete") => ({ id, score, scoreFloor: score, scoreCeiling: score, confidenceScore: 50, assessment: { state } });
  const order = [row("b", 90, "incomplete"), row("a", 5, "incomplete"), row("c", 10), row("d", 40)].sort(compareRank).map((r) => r.id);
  expect(order).toEqual(["d", "c", "a", "b"]);
});

test("a role the AI could not tie to its lines stands when the parser read the same title, employer and start year on its own; anything less stays marked", () => {
  const ai = { position: "Loan Platform Team Lead", company: "Rand Merchant Bank", startDate: "Mar 2017", endDate: "Jan 2020", lines: [40], adrift: true };
  const same = reconcileRoles([{ position: "Loan Platform Team Lead", company: "Rand Merchant Bank", startDate: "03/2017", endDate: "01/2020" }], [ai], true);
  expect(same[0]).toMatchObject({ agreement: "both", status: "supported" });
  const otherYear = reconcileRoles([{ position: "Loan Platform Team Lead", company: "Rand Merchant Bank", startDate: "2018" }], [ai], true);
  expect(otherYear.find((r) => r.agreement !== "rules")?.status).toBe("uncertain");
  const titleOnly = reconcileRoles([{ position: "Loan Platform Team Lead", company: "Elmstead Advisory", startDate: "2017" }], [ai], true);
  expect(titleOnly.find((r) => r.agreement !== "rules")?.status).toBe("uncertain");
});

test("a CV that gives every date range on one line and the roles beneath it: each role stands when its title, employer and own date range are the document's words; an invented range does not", () => {
  const table = ["Riana Example", "EMPLOYMENT SUMMARY", "DATES EMPLOYED JUNE 2012 – MAY 2022 MAR 2011 – FEB 2012", "COMPANY | POSITION", "OLD MUTUAL INSURE | ➢ VARIOUS", "STANLIB INVESTMENT | ➢ UNIT TRUST ADMINISTRATOR"].join("\n");
  const { byNumber } = readerInput(table);
  expect(heldInATable({ title: "UNIT TRUST ADMINISTRATOR", employer: "STANLIB INVESTMENT", start: "MAR 2011", end: "FEB 2012", lines: [3, 6] }, byNumber)).toBe(true);
  expect(heldInATable({ title: "UNIT TRUST ADMINISTRATOR", employer: "STANLIB INVESTMENT", start: "MAR 2014", end: "FEB 2016", lines: [3, 6] }, byNumber)).toBe(false);   // dates the CV does not give
  expect(heldInATable({ title: "FUND MANAGER", employer: "STANLIB INVESTMENT", start: "MAR 2011", end: "FEB 2012", lines: [3, 6] }, byNumber)).toBe(false);            // a title the cited lines do not hold
});

test("the career summary is one question of its own, asked beside the reading, and kept only when its names and numbers are in the CV", async () => {
  const ask = answering({ ...empty, roles: [accountant, junior], education: [] }), r = await hybridRead(ask, CV, []);
  expect(ask.summaries).toBe(1);   // once, whatever the reading needs
  expect(ask.calls.every((c) => c.system !== PROFILE_SYSTEM)).toBe(true);   // the reading's own instructions carry no summary
  expect(r.reading?.profile).toBe("");
  expect(validateProfile({ profile: "Accountant in trading and advisory firms, from junior to financial accountant; prepared monthly statements." }, CV)).toContain("monthly statements");
  expect(validateProfile({ profile: "Accountant who led Deloitte audits." }, CV)).toBe("");   // a name the CV does not hold
  expect(validateProfile({ profile: "Accountant with 12 years in finance." }, CV)).toBe("");   // a number the CV does not hold
  expect(validateProfile({ profile: "Service manager who ran ITIL-based support desks." }, CV + "\nITIL Foundation")).toContain("ITIL-based");   // the name inside a compound
  expect(validateProfile({ profile: "Service manager who ran COBIT-based support desks." }, CV)).toBe("");   // ...and only when the name is in the CV
  // Whole sentences only, never cut off; ".NET" does not end a sentence; at most 45 words.
  const dev = CV + "\nC# .NET Core Angular SQL";
  expect(validateProfile({ profile: "Builds Angular and C# .NET Core systems on SQL. Moved from junior to financial accountant roles and prepared monthly statements." }, dev)).toBe("Builds Angular and C# .NET Core systems on SQL. Moved from junior to financial accountant roles and prepared monthly statements.");
  expect(validateProfile({ profile: "Prepared monthly statements and reconciled accounts. Then moved into a role where the work cove" }, CV)).toBe("Prepared monthly statements and reconciled accounts.");
  expect(validateProfile({ profile: "Prepared monthly statements. " + "Reconciled accounts across many ledgers and periods for the business with care and attention to every detail of the work it was asked to do over a long period of time in the finance team there, month after month, quarter after quarter and year after year." }, CV)).toBe("Prepared monthly statements.");
  expect(validateProfile({ profile: "She prepared monthly statements." }, CV)).toBe("");   // a pronoun gives away gender
  // Protected characteristics never reach the summary, even if the CV states them (owner, 9 Nov 2026: nothing judged on them).
  const stated = CV + "\nGender: Female\nMarital status: Married";
  expect(validateProfile({ profile: "Married female accountant who prepared monthly statements." }, stated)).toBe("");
  expect(validateProfile({ profile: "Accountant who prepared monthly statements and ran single sign-on for the finance systems." }, CV + "\nsingle sign-on")).toContain("single sign-on");
});

test("the AI gives the normal written form of details in capitals, and may change only their capitals", () => {
  const doc = CV + "\nHEAD OF IT\nVMWARE VSPHERE 6.5\nCTI EDUCATION GROUP";
  expect(validateWritten({ written: [
    { asWritten: "HEAD OF IT", normal: "Head of IT" },
    { asWritten: "VMWARE VSPHERE 6.5", normal: "VMware vSphere 6.5" },
    { asWritten: "CTI EDUCATION GROUP", normal: "CTI Education Group" },
    { asWritten: "HEAD OF IT", normal: "Head of Technology" },   // other words: refused
    { asWritten: "CHIEF EXECUTIVE", normal: "Chief Executive" },   // not in the CV: refused
    { asWritten: "Head of IT", normal: "Head Of IT" },   // not written in capitals: nothing to do
  ] }, doc)).toEqual({ "HEAD OF IT": "Head of IT", "VMWARE VSPHERE 6.5": "VMware vSphere 6.5", "CTI EDUCATION GROUP": "CTI Education Group" });
  expect(validateWritten({}, doc)).toEqual({});
});

test("a summary answer cut off by its size is asked again for the summary alone", async () => {
  let summaries = 0; const asked: string[] = [];
  const ask: Ask = async (o: any) => {
    if (o.system === PROFILE_SYSTEM) { summaries++; asked.push(o.user); return summaries === 1 ? { ok: false, why: "truncated", detail: "x", ms: 1, model: "m" } : { ok: true, json: { profile: "Prepared monthly statements and reconciled accounts.", written: [] }, raw: "", ms: 1, model: "m" }; }
    return { ok: true, json: { ...empty, roles: [accountant, junior], education: [] }, raw: "", ms: 1, model: "m" } as any;
  };
  const r = await hybridRead(ask, CV, []);
  expect(summaries).toBe(2);
  expect(asked[1]).toContain("profile only");
  expect(r.reading?.profile).toBe("Prepared monthly statements and reconciled accounts.");
});

// Independent audit, 20 Nov 2026: long lines without a year were cut to 70 or 45 characters (and at 200 when asking about one part), so a fact further along
// never reached the model. Every word of every line now does.
test("every word of a long line reaches the model: past 70 and past 200 characters, in the whole document and in one part of it", () => {
  const duty = "Responsible for the day-to-day running of the warehouse floor and its teams, " + "ordinary words about the work ".repeat(5) + "and qualified as a Certified Zorblat Practitioner in the second year";
  const skills = "Skills: " + Array.from({ length: 40 }, (_, i) => `Quillcraft${i}`).join(", ");
  const text = ["Thandeka Mabaso", "WAREHOUSE SUPERVISOR", duty, skills].join("\n");
  const { parts, byNumber } = readerInput(text), shown = parts.join("\n");
  expect(duty.indexOf("Zorblat")).toBeGreaterThan(200);
  expect(shown).toContain("Certified Zorblat Practitioner in the second year");
  expect(shown).toContain("Quillcraft39");
  expect(shown).not.toContain("…");
  expect(regionInput(byNumber, 1, 4, [3])).toContain("Certified Zorblat Practitioner in the second year");
});
test("a line longer than a section is shown in pieces that each carry its number, and no word is lost or split", () => {
  const words = Array.from({ length: 900 }, (_, i) => `word${i}`), line = words.join(" "), maxChars = 2000;
  const { parts } = readerInput(["Header line", line, "Footer line"].join("\n"), maxChars);
  const pieces = parts.join("\n").split("\n").filter((l) => l.startsWith("[2] "));
  expect(pieces.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(maxChars);
  const seen = new Set(pieces.flatMap((p) => p.slice(4).split(" ")));
  for (const w of words) expect(seen.has(w)).toBe(true);
  expect(parts.join("\n")).toContain("Footer line");
});
