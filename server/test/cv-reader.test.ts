import { expect, test } from "vitest";
import { contactFromCv, fromLabels, labelLines, labelledAJob, labelledNotAJob, labelsOf, skillItems, unaccountedByLabel, type CvLabel } from "../src/cvReader";
import type { Ask } from "../src/hybridReader";

// The parts of the Claude-only CV reader that are code (src/cvReader.ts): what is done with Claude's line labels and contact answer. Each rule here is one
// the owner asked for on 10 Nov 2026: nothing in a CV quietly disappears, a certificate never becomes a job, a summary line never comes back as a note,
// and nothing Claude says is believed unless the CV holds it. Invented documents; no AI is called.
const cv = ["Thandi Example", "thandi@example.test | 082 555 0101", "PROFILE", "Finance manager with ten years in retail.", "EXPERIENCE", "Finance Manager, Acme Retail", "Jan 2019 - Present",
  "- Ran month-end for nine stores.", "- Cut close from ten days to four.", "CERTIFICATES", "Advanced Excel, Coursera, 2021", "SKILLS", "Tools: SAP, Excel, Power BI", "Budgeting; Forecasting",
  "AWARDS", "Employee of the year 2022", "Reference TE-17"].join("\n");
const byNumber = new Map(cv.split("\n").map((l, i) => [i + 1, l]));
const runs = { runs: [{ from: 1, to: 2, label: "personal" }, { from: 3, to: 3, label: "heading" }, { from: 4, to: 4, label: "summary" }, { from: 5, to: 5, label: "heading" }, { from: 6, to: 6, label: "job_title" },
  { from: 7, to: 7, label: "job_dates" }, { from: 8, to: 9, label: "duty" }, { from: 10, to: 10, label: "heading" }, { from: 11, to: 11, label: "certificate" }, { from: 12, to: 12, label: "heading" },
  { from: 13, to: 14, label: "skill" }, { from: 15, to: 15, label: "heading" }, { from: 16, to: 16, label: "notable" }, { from: 17, to: 17, label: "other" }] };

test("labels are held to the document: a run outside it, backwards or with an unknown label is ignored, and the first label for a line stands", () => {
  const labels = labelsOf({ runs: [...runs.runs, { from: 6, to: 6, label: "duty" }, { from: 40, to: 45, label: "duty" }, { from: 9, to: 8, label: "duty" }, { from: 1, to: 1, label: "made_up" }] }, byNumber);
  expect(labels.size).toBe(17);
  expect(labels.get(6)).toBe("job_title");
});

test("what only the document's own lines give: its summary, what is worth noting, and each item of its skills lines", () => {
  const own = fromLabels(labelsOf(runs, byNumber), byNumber);
  expect(own.summary).toBe("Finance manager with ten years in retail.");
  expect(own.worthNoting).toEqual(["Employee of the year 2022"]);
  expect(own.skills).toEqual(["SAP", "Excel", "Power BI", "Budgeting", "Forecasting"]);   // the "Tools:" label is not a skill
  expect(own.other).toBe(1);   // counted, never silently dropped
});

test("a skills line is its items, never a sentence", () => {
  expect(skillItems("• Python, SQL | Tableau")).toEqual(["Python", "SQL", "Tableau"]);
  expect(skillItems("I have worked with many accounting systems over the years and enjoy learning new ones.")).toEqual([]);
  expect(skillItems("Stakeholder management")).toEqual(["Stakeholder management"]);
  expect(skillItems("coordination / Excel /")).toEqual(["coordination", "Excel"]);   // the "/" a wrapped list leaves at the end of a line is not part of a skill
  expect(skillItems("Ticketing / Troubleshooting / Active Directory / TCP/IP / CI/CD")).toEqual(["Ticketing", "Troubleshooting", "Active Directory", "TCP/IP", "CI/CD"]);   // a spaced slash separates; an unspaced one is part of the name
});

test("a skill heading with a sentence about it is the heading alone; the sentence is never cut at its commas into skills (12 Nov 2026)", () => {
  // Invented lines in the shape of a real CV on live, whose skills came out as "security", "and", "ensuring", "high-performance solutions".
  expect(skillItems("Service Delivery & Support: Skilled in running service desks, security, and support teams, ensuring")).toEqual(["Service Delivery & Support"]);
  expect(skillItems("reliable day-to-day solutions.")).toEqual([]);                                          // the sentence's end, carried onto the next line
  expect(skillItems("overseeing budgets as a member of the executive committee.")).toEqual([]);
  expect(skillItems("People Development: Experience in coaching, team building, and succession planning for growing teams.")).toEqual(["People Development"]);
  expect(skillItems("Tools: SAP, Excel, Power BI")).toEqual(["SAP", "Excel", "Power BI"]);                    // a list still loses its label and keeps its items
  expect(skillItems("Excel, Word, and PowerPoint")).toEqual(["Excel", "Word", "PowerPoint"]);                 // "and" before the last item is not part of it
  expect(skillItems("Python, and")).toEqual(["Python"]);
  expect(skillItems("python, java, sql.")).toEqual(["python", "java", "sql"]);                                // a lower-case list ending in a full stop is still a list
});

test("a certificate can never become a job: a role whose every line is labelled a certificate is not a job; a job's own lines are", () => {
  const labels = labelsOf(runs, byNumber);
  expect(labelledNotAJob([11], labels)).toBe(true);
  expect(labelledNotAJob([6, 7], labels)).toBe(false);
  expect(labelledNotAJob([], labels)).toBe(false);          // nothing cited: no verdict
  expect(labelledAJob([6, 7], labels)).toBe(true);
  expect(labelledAJob([11], labels)).toBe(false);
});

test("the second look: an education line no qualification accounts for is read again; one a qualification sits on is not; jobs are never sent back on the labels' word", () => {
  const labels = new Map<number, CvLabel>([[7, "job_dates"], [30, "job_dates"], [40, "education"], [50, "education"]]);
  const reading: any = { roles: [{ lines: [6, 7] }], education: [{ lines: [50] }] };
  expect(unaccountedByLabel(reading, labels)).toEqual({ lines: [], educationLines: [40] });
});

test("a name may carry an initial; a name the CV does not hold, or one with its letters spaced apart, is asked for once more", async () => {
  const withInitial = "Thandi M Example\nthandi@example.test\nExperience";
  expect((await contactFromCv(answering({ name: "Thandi M Example", email: "", phone: "", location: "" }), withInitial, 1000)).name).toBe("Thandi M Example");
  let n = 0; const twice: Ask = async () => ({ ok: true, json: { name: n++ === 0 ? "T h a n d i Example" : "Thandi Example", email: "", phone: "", location: "" }, raw: "", ms: 1, model: "test" });
  expect((await contactFromCv(twice, cv, 1000)).name).toBe("Thandi Example"); expect(n).toBe(2);
});

const answering = (json: unknown): Ask => async () => ({ ok: true, json, raw: "", ms: 1, model: "test" });
test("every line gets a label: a line Claude passed over is asked about once, and one still unlabelled is counted as other", async () => {
  let asked = 0;
  const ask: Ask = async (o) => { asked++; return { ok: true, json: o.user.includes("left out") ? { runs: [{ from: 16, to: 16, label: "notable" }] } : { runs: runs.runs.filter((r) => r.from < 16) }, raw: "", ms: 1, model: "test" }; };
  const l = await labelLines(ask, cv, 1000);
  expect(asked).toBe(2); expect(l.askedAgain).toBe(true);
  expect(l.labels.get(16)).toBe("notable");
  expect(l.labels.get(17)).toBe("other"); expect(l.unlabelled).toBe(1);
  expect(l.labels.size).toBe(17);
});

test("the person's own details are believed only when the CV holds them", async () => {
  const good = await contactFromCv(answering({ name: "Thandi Example", email: "thandi@example.test", phone: "082 555 0101", location: "" }), cv, 1000);
  expect(good).toMatchObject({ name: "Thandi Example", email: "thandi@example.test", phone: "082 555 0101" });
  const made = await contactFromCv(answering({ name: "Somebody Else", email: "other@example.test", phone: "011 000 0000", location: "Pretoria" }), cv, 1000);
  expect(made.name).toBeUndefined(); expect(made.email).toBeUndefined(); expect(made.phone).toBeUndefined(); expect(made.location).toBeUndefined();
});

test("labels written as text, one run a line, are read the same; a line that is not a label is ignored", () => {
  const labels = labelsOf({ labels: "1-2 personal\n3 heading\n4 summary\nsome words that are not a label\n6 job_title\n7 job_dates\n8-9 duty\n99-120 duty" }, byNumber);
  expect([...labels.entries()]).toEqual([[1, "personal"], [2, "personal"], [3, "heading"], [4, "summary"], [6, "job_title"], [7, "job_dates"], [8, "duty"], [9, "duty"]]);
});

test("two phone numbers given together are two numbers: the first that is in the CV stands", async () => {
  const two = "Thandi Example\n082 555 0101 or 011 555 0199\nExperience";
  const c = await contactFromCv(answering({ name: "Thandi Example", email: "", phone: "082 555 0101 or 011 555 0199", location: "" }), two, 1000);
  expect(c.phone).toBe("082 555 0101");
});

test("a value is held in the CV's own characters, so two readings typed a little differently are the same record", async () => {
  const { asWritten } = await import("../src/cvReader");
  const lines = ["C# / SQL Developer – ANGLO American Mining Company", "Aug 2013 - Dec 2013"];
  expect(asWritten("C#/SQL Developer", lines)).toBe("C# / SQL Developer");
  expect(asWritten("c#/sql developer", lines)).toBe("c# / sql developer");   // the CV's spacing and punctuation; the capitals as given
  expect(asWritten("Anglo American Mining Company", lines)).toBe("Anglo American Mining Company");
  expect(asWritten("June 2022", ["J U N E 2 0 2 2 - P R E S E N T"])).toBe("June 2022");   // letters the CV spaces apart stay put together
  expect(asWritten("Operations Manager (Infrastructure)", ["OPERATIONS MANAGER (INFRASTRUCTURE) | Acme"])).toBe("Operations Manager (Infrastructure)");   // its bracket closed
  expect(asWritten("C# Developer", ["Senior C#  developer, Acme"])).toBe("C# Developer");
  expect(asWritten("Head of Data", lines)).toBe("Head of Data");   // not on these lines: left as given (other checks decide whether it stands)
  expect(asWritten("IT Manager", ["Security Manager, Acme"])).toBe("IT Manager");   // whole words only: never the tail of another word
  expect(asWritten("IT Manager", ["Security Manager and IT  manager, Acme"])).toBe("IT Manager");
});

test("a job read from a summary table takes its duties from the lines labelled as that job's duties", async () => {
  const { dutiesByLabel } = await import("../src/cvReader");
  const doc = ["CAREER SUMMARY", "Finance Manager | Acme | 2019 - Present", "Accountant | Beta | 2015 - 2018", "DETAILS", "FINANCE MANAGER", "Acme Retail", "- Ran month-end.", "- Cut close to four days.", "ACCOUNTANT", "- Prepared statements."];
  const lines = new Map(doc.map((l, i) => [i + 1, l])), labels = new Map<number, CvLabel>([[1, "heading"], [2, "job_title"], [3, "job_title"], [4, "heading"], [5, "job_title"], [6, "employer"], [7, "duty"], [8, "duty"], [9, "job_title"], [10, "duty"]]);
  expect(dutiesByLabel("Finance Manager", labels, lines)).toEqual(["Ran month-end.", "Cut close to four days."]);
  expect(dutiesByLabel("Accountant", labels, lines)).toEqual(["Prepared statements."]);
  expect(dutiesByLabel("Head of Data", labels, lines)).toEqual([]);
});

test("an agency's number is not the person's: judged only on the lines Claude was shown, so a footer repeated on every page cannot save it", async () => {
  const { onlyOthersLines } = await import("../src/cvReader");
  const doc = ["Thandi Example", "Example Recruiters | Tel 011 555 0100", "PROFILE", "Finance manager.", "Example Recruiters | Tel 011 555 0100", "Mobile: 082 555 0101"];
  const lines = new Map(doc.map((l, i) => [i + 1, l]));
  const labels = new Map<number, CvLabel>([[1, "personal"], [2, "agency"], [3, "heading"], [4, "summary"], [6, "personal"]]);   // line 5, a repeat, was not shown
  expect(onlyOthersLines("011 555 0100", true, labels, lines)).toBe(true);
  expect(onlyOthersLines("082 555 0101", true, labels, lines)).toBe(false);
  expect(onlyOthersLines("", true, labels, lines)).toBe(false);
  labels.set(5, "personal");   // the same number on a line labelled the person's own: it stays
  expect(onlyOthersLines("011 555 0100", true, labels, lines)).toBe(false);
});

test("a place broken across a line break is read whole; JHB is Johannesburg (11 Nov 2026, invented lines shaped like a real CV's)", async () => {
  const { wholePlace } = await import("../src/cvReader");
  const lines = new Map([[1, "Thandi Example"], [2, "\ue91e thandi@example.test | \ue947 12 Long Street Gardens Cape"], [3, "\ue964 0825550101 | Town 8001"], [4, "PROFILE"]]);   // with a symbol font's icons, as the real CV has
  expect(wholePlace("Gardens Cape", lines)).toEqual({ town: "Cape Town", city: "Cape Town" });
  expect(wholePlace("Town 8001", lines)).toEqual({ town: "Cape Town", city: "Cape Town" });
  expect(wholePlace("JHB", new Map([[1, "Current Location | JHB"]]))).toEqual({ town: "Johannesburg", city: "Johannesburg" });
  expect(wholePlace("Sandton", lines)).toEqual({ town: "Sandton", city: "Johannesburg" });
  expect(wholePlace("Ggeberha", new Map([[1, "Ggeberha"]]))).toEqual({ town: "Ggeberha", city: "Ggeberha" });   // nothing across a break: as written
});

test("a phone the agency gives as its own is never the candidate's", async () => {
  const { agencysOwnPhone } = await import("../src/cvReader");
  const lines = new Map([[1, "THE EXAMPLE CAREERS GROUP (+27 11) 555 0100 | example careers"], [2, "Candidate: Thandi Example"], [3, "Mobile: 082 555 0101"]]);
  const sub = { agency: { name: "E.X.A (PTY) LTD. T/A Example Careers Group", phone: "" }, recruiter: { phone: "011 555 0199" } };   // registered and trading names
  expect(agencysOwnPhone("+27 11 555 0100", sub, lines)).toBe(true);    // on the agency's own footer line
  expect(agencysOwnPhone("011 555 0199", sub, lines)).toBe(true);       // the consultant's number
  expect(agencysOwnPhone("082 555 0101", sub, lines)).toBe(false);      // the candidate's own, on their own line
  expect(agencysOwnPhone("082 555 0101", undefined, lines)).toBe(false); // no agency, nothing to check
});
