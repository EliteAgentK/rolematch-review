import { expect, test } from "vitest";
import { parseCv, separateRunTogetherRoles, unfoldRunInRoles } from "../src/rules";
import { assess } from "../src/match";
import { candidateOf, jobOf, AS_OF } from "./candidate/judgementCases";

// Found by measuring long and varied CVs against their answer keys. Each of these lost real information.
const cv = (work: string) => `Tumi Ndlovu
Junior Credit Analyst
Pretoria | tumi@candidate.example | +27 82 000 0296
Profile
Background in banking.
Skills
Financial statements, Credit analysis
${work}
Education
BCom Finance | Central Valley University | Completed | 2023`;
const read = (t: string) => parseCv(t);

test("roles written as a table of two columns are read as roles, with their duties", () => {
  const r = read(cv(`Work history
Role and dates | Responsibilities
Junior Credit Analyst | Analysed cash flow and repayment capacity.
Oakridge Business Services | Reviewed borrower financial statements.
2024-02 to Present | Prepared credit assessment summaries.
Fixed term contract | Monitored covenant reporting.
Introduced a checklist used in 8 recurring reviews.`));
  expect(r.workHistory).toHaveLength(1);
  const w: any = r.workHistory[0];
  expect(w.position).toBe("Junior Credit Analyst"); expect(w.company).toBe("Oakridge Business Services"); expect(w.startDate).toBe("2024-02"); expect(w.endDate).toMatch(/present/i);
  expect(w.responsibilities).toEqual(expect.arrayContaining(["Analysed cash flow and repayment capacity.", "Monitored covenant reporting.", "Introduced a checklist used in 8 recurring reviews."]));
});
test("two roles in such a table stay two roles", () => {
  const r = read(cv(`Employment
Position and period | Duties
Credit Analyst | Analysed cash flow and repayment capacity.
Oakridge Business Services | Reviewed borrower financial statements.
2021-02 to Present | Prepared credit assessment summaries.
Junior Analyst | Captured loan applications accurately.
Riverstead Holdings | Answered branch queries about loan status.
2018-01 to 2021-01 | Kept the arrears list current.`));
  expect(r.workHistory.map((w: any) => w.company)).toEqual(["Oakridge Business Services", "Riverstead Holdings"]);
  expect((r.workHistory[1] as any).responsibilities).toContain("Kept the arrears list current.");
});
test("a long list of skills under a heading that does not say so is read as skills, even when it wraps", () => {
  const full = read(`Tumi Ndlovu
Business Analyst
Pretoria | tumi@candidate.example | +27 82 000 0296
Profile
Background in banking.
What I work with
Requirements gathering, Stakeholder mapping, User stories, Process mapping, Jira, UAT, Microsoft Teams, Document control, Process
improvement
Where I have worked
Business Analyst | Clearhaven Business Services | 2024-02 to Present
Mapped current and proposed business processes.
Education
BCom Finance | Central Valley University | Completed | 2023`);
  const names = full.skills.map((s: any) => s.name);
  expect(names).toEqual(expect.arrayContaining(["Requirements gathering", "User stories", "Jira", "UAT", "Document control", "Process improvement"]));
  expect(full.workHistory).toHaveLength(1);
});
test("credit for years names the roles it rests on, and nothing repeated is counted in the summary", () => {
  const c = candidateOf({ cv: { skills: ["Excel"], duties: ["Prepared monthly management accounts in Excel."], position: "Senior Accountant", company: "Elmstead Advisory", start: "2018-01", end: "2024-01" } } as any);
  const m: any = assess(c, jobOf(["5+ years of accounting experience", "Experience with Excel", "Experience with Excel"]), "Prepared monthly management accounts in Excel.", AS_OF);
  const years = m.evidence.find((e: any) => /years/.test(e.label));
  expect(years.source).toMatch(/Senior Accountant/);
  const shown = m.evidence.filter((e: any) => !e.duplicateOf);
  expect(m.counts.verified + m.counts.partial + m.counts.notDemonstrated + m.counts.contradicted).toBe(shown.filter((e: any) => e.state !== "not_applicable").length);
});

test("a role written straight into its duties, with no line break, is still a role with duties", () => {
  const r = read(`Sibusiso Maseko
Junior Treasury Analyst
Gqeberha | sib@candidate.example | +27 82 000 0333
Where I have worked
Junior Treasury Analyst | Riverstead Business Services | 2024-02 to Present Permanent Prepared daily cash
position reports. Updated short term liquidity forecasts. Coordinated handover records for a team of 12 colleagues.
Studies
BCom Finance | Lakeside College of Technology | Completed | 2023`);
  expect(r.workHistory).toHaveLength(1);
  const w: any = r.workHistory[0];
  expect([w.position, w.company, w.startDate]).toEqual(["Junior Treasury Analyst", "Riverstead Business Services", "2024-02"]);
  expect(w.endDate).toMatch(/present/i);
  expect(w.responsibilities.join(" ")).toMatch(/Prepared daily cash position reports\./);
  expect(w.responsibilities.join(" ")).toMatch(/liquidity forecasts/);
});
test("a CV with no headings at all still gives up its list of skills and its courses", () => {
  const r = read(`Leila Mthembu
Junior Data Engineer
Nairobi | leila@candidate.example | +27 82 000 0481
Background in technology, with practical experience of SQL and Airflow. Currently responsible for
maintaining scheduled data ingestion pipelines. Based in Nairobi.
SQL, Airflow, Data modelling, Python, ETL, PostgreSQL, Presentation skills, Problem solving, Data quality, Stakeholder
communication
Junior Data Engineer | Copperfield Business Services | 2024-02 to Present Permanent Resolved failed data loads and backfills.
Maintained scheduled data ingestion pipelines. Cleared 24 outstanding documentation items.
BSc Information Technology | Northbridge University | Completed | 2023
Advanced Excel Workshop | Northbridge Professional Learning | Completed | 2023
Languages: isiZulu, isiXhosa`);
  const names = r.skills.map((s: any) => s.name);
  expect(names).toEqual(expect.arrayContaining(["Airflow", "Data modelling", "ETL", "Data quality", "Stakeholder communication"]));
  expect(r.workHistory).toHaveLength(1);
  expect(JSON.stringify(r.education)).toMatch(/Advanced Excel Workshop/);
  expect(JSON.stringify(r.education)).toMatch(/BSc Information Technology/);
});
test("ordinary sentences with commas are not taken for a list of skills", () => {
  const r = read(`Leila Mthembu
Data Engineer
Nairobi | leila@candidate.example | +27 82 000 0481
Worked with finance, sales, marketing, operations and legal to agree one view of the customer.
Data Engineer | Copperfield Business Services | 2024-02 to Present`);
  expect(r.skills.map((s: any) => s.name)).not.toContain("sales");
});

// Found on the first true long CV, 21 pages, written by the local model around an answer key.
const long = (body: string) => `Sipho Dlamini
Durban, South Africa
Mobile: 082 555 0143
Email: sipho@example.co.za
${body}`;
test("an employer written before the title with a colon, and a place after the dates, are read as what they are", () => {
  const r = read(long(`CAREER HISTORY
Meridian Solutions: Principal Engineer
February 2025 to Ongoing, Durban
Led the architecture forum across the group.
Bluewater Consulting: Lead Engineer
June 2022 to February 2025, Cape Town
Reviewed designs with five engineers.`));
  expect(r.workHistory.map((w: any) => [w.position, w.company])).toEqual([["Principal Engineer", "Meridian Solutions"], ["Lead Engineer", "Bluewater Consulting"]]);
});
test("a title and employer with a comma, and the dates and place on the line below, are one role", () => {
  const r = read(long(`CAREER HISTORY
Senior Java Engineer, Ubuntu Holdings
January 2016 to January 2018, Midrand
Built payment services in Java.
Java Developer | Lethabo Industries | April 2013 to January 2016
Worked on the claims module.`));
  expect(r.workHistory.map((w: any) => [w.position, w.company])).toEqual([["Senior Java Engineer", "Ubuntu Holdings"], ["Java Developer", "Lethabo Industries"]]);
  expect((r.workHistory[0] as any).responsibilities.join(" ")).toMatch(/payment services/);
});
test("qualifications written with commas are qualifications, under any heading, and never skills", () => {
  const r = read(long(`SKILLS
Java, Kafka, React, Docker
CAREER HISTORY
Java Developer | Lethabo Industries | April 2013 to January 2016
Worked on the claims module in Java.
Tertiary Education
BSc Computer Science, Stellenbosch University, 2009
BEng Electronic Engineering, Durban University of Technology, 2011
Master of Philosophy, University of Pretoria, In progress, expected 2027
CERTIFICATIONS
- AWS Certified Developer Associate (2017)
TRAINING AND COURSES
Course | Year
Presentation Skills | 2024
Time Management | 2023`));
  const edu = JSON.stringify(r.education), skills = r.skills.map((s: any) => s.name);
  for (const q of ["BSc Computer Science", "BEng Electronic Engineering", "Master of Philosophy", "AWS Certified Developer Associate", "Presentation Skills"]) expect(edu).toContain(q);
  expect(skills.join(",")).not.toMatch(/Stellenbosch|BSc/);
  expect(edu).not.toMatch(/"Course"/);
});
test("what a CV says the person has not done is not one of their skills", () => {
  const r = read(long(`SKILLS
Java, Kafka, React, Docker
CAREER HISTORY
Java Developer | Lethabo Industries | April 2013 to January 2016
Worked on the claims module in Java.
NOTES ON EXPERIENCE
I have no hands-on experience with PostgreSQL, although I have worked alongside colleagues who do.`));
  expect(r.skills.map((s: any) => s.name)).not.toContain("PostgreSQL");
});
test("each qualification on its own line stays its own, however they are written", () => {
  const r = read(long(`EDUCATION
BSc Computer Science, Stellenbosch University, 2009
BEng Electronic Engineering, Durban University of Technology, 2011
National Diploma in Information Technology, Tshwane University of Technology, 2015
Master of Philosophy, University of Pretoria, In progress, expected 2027`));
  const names = r.education.map((e: any) => e.qualification);
  expect(names).toEqual(expect.arrayContaining(["BSc Computer Science", "BEng Electronic Engineering", "National Diploma in Information Technology", "Master of Philosophy"]));
  expect(r.education).toHaveLength(4);
});

// A whole career written as one paragraph, however the page happened to wrap it. Found on all 500 invented people, 2026-11-05: 45 lost their roles (narrative and dense layouts).
const CAREER_LINES = [
  ["wrapped as a PDF wraps it", ["Where I have worked", "Volunteer coordinator | Westhaven Programme | 2025-03 to 2025-09 Part time volunteer", "Maintained meeting notes outside normal working hours. Senior HR Administrator | Silverstone Trading |", "2022-02 to Present Permanent Prepared employee onboarding documents. Processed approved HR system changes. HR Administrator | Lakeshore Industries | 2018-02 to 2022-01", "Permanent Maintained personnel and leave records. Responded to routine employee queries. Assistant HR", "Administrator | Riverstead Holdings | 2014-02 to 2018-01 Permanent Prepared employee onboarding documents. Data Clerk | Ashcombe", "Services | 2012-08 to 2014-01 Permanent Filed records.", "Studies"]],
  ["one long paragraph, as Word holds it", ["Where I have worked", "Volunteer coordinator | Westhaven Programme | 2025-03 to 2025-09 Part time volunteer Maintained meeting notes outside normal working hours. Senior HR Administrator | Silverstone Trading | 2022-02 to Present Permanent Prepared employee onboarding documents. Processed approved HR system changes. HR Administrator | Lakeshore Industries | 2018-02 to 2022-01 Permanent Maintained personnel and leave records. Responded to routine employee queries. Assistant HR Administrator | Riverstead Holdings | 2014-02 to 2018-01 Permanent Prepared employee onboarding documents. Data Clerk | Ashcombe Services | 2012-08 to 2014-01 Permanent Filed records.", "Studies"]],
] as const;
for (const [how, lines] of CAREER_LINES) test(`a career run together into a paragraph keeps every role and its own duties: ${how}`, () => {
  const out = separateRunTogetherRoles([...lines]), unfolded = unfoldRunInRoles(out), heads = unfolded.filter((l) => / \| \d{4}-\d{2} to /.test(l));
  expect(heads).toEqual(["Volunteer coordinator | Westhaven Programme | 2025-03 to 2025-09", "Senior HR Administrator | Silverstone Trading | 2022-02 to Present", "HR Administrator | Lakeshore Industries | 2018-02 to 2022-01", "Assistant HR Administrator | Riverstead Holdings | 2014-02 to 2018-01", "Data Clerk | Ashcombe Services | 2012-08 to 2014-01"]);
  const after = (head: string) => unfolded.slice(unfolded.findIndex((l) => l.startsWith(head)) + 1).findIndex((l) => / \| \d{4}-\d{2} to |^Studies/.test(l));
  expect(after("HR Administrator")).toBe(2);
  expect(unfolded.join("\n")).not.toMatch(/Permanent/);
  expect(unfolded).toContain("Studies");
});
test("lines that only look like it are left alone: a sentence with a pipe and no date, a normal role and its bullet, a date in a sentence", () => {
  for (const lines of [["Led the Finance | HR merger. Then moved on."], ["Accountant | Elmstead | 2020-01 to 2022-01", "- Reconciled accounts. Closed the month | on time."], ["Promoted in 2020. Managed payroll from 2020-01 to 2022-01 for the group."], ["Skills: Excel. Word", "Accountant | Elmstead | 2020-01 to 2022-01"]])
    expect(separateRunTogetherRoles([...lines])).toEqual(lines);
});

test("a languages line in a skills section lists programming languages: they are skills, and spoken ones stay languages", () => {
  const text = ["Samantha Ngwenya", "sam@example.test", "TECHNICAL SKILLS", "Languages: Python, SQL, Scala", "Cloud & Tools: AWS, Spark, Docker", "WORK HISTORY", "Lead Data Engineer", "Northwind Analytics | March 2021 - Present", "- Built pipelines.", "LANGUAGES", "English, isiZulu"].join("\n");
  const c = parseCv(text);
  expect(c.skills.map((s: any) => s.name)).toEqual(expect.arrayContaining(["Python", "SQL", "Scala", "AWS", "Spark", "Docker"]));
  expect(c.languages).toEqual(expect.arrayContaining(["English", "isiZulu"]));
  expect(c.languages).not.toContain("Python");
});

test("a CV with no skills heading never takes its contact line for a list of skills", () => {
  const c = parseCv(["Lindiwe Dlamini", "Pretoria, South Africa | lindiwe.dlamini@example.test | 071 555 0103", "Experience", "Theatre Nurse", "Pretoria East Clinic | 2019-01 to Present", "- Assisted in theatre."].join("\n"));
  expect(c.skills.map((s: any) => s.name).join(" ")).not.toMatch(/@|071|Pretoria|South Africa/);
});
test("a skills table's rows stay rows: the last cell of one is not the start of the next", () => {
  const c = parseCv(["Ahmed Patel", "ahmed@example.test", "Skills", "SQL | Python | Power BI", "Excel | Data cleaning | Statistics", "Experience", "Data Analyst, Zenith Logistics | Sep 2021 - Present", "- Built dashboards."].join("\n"));
  expect(c.skills.map((s: any) => s.name)).toEqual(expect.arrayContaining(["SQL", "Python", "Power BI", "Excel", "Data cleaning", "Statistics"]));
  expect(c.skills.map((s: any) => s.name)).not.toContain("Power BI Excel");
});
