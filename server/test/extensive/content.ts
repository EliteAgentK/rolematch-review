// Twelve invented, long CVs (at least four pages each) with answer keys, to test reading, the capability graph and the AI agents properly.
// Six are well put together and evidence-rich; six are weak in the ways real CVs are weak (vague duties, keyword stuffing, messy or missing dates,
// two-column layouts, typos, a degree finished in one year, a degree never finished, studies in progress, an unexplained gap,
// overlapping jobs, "remote only", "willing to relocate"). Every person, company and contact detail is invented (example.test addresses, 555 numbers).

export type Truth = "completed" | "in_progress" | "not_completed" | "unknown";
export interface Key {
  name: string; email: string; phone: string; location: string; quality: "rich" | "poor";
  roles: { title: string; company: string; start: string; end: string }[];
  education: { degree: string; truth: Truth; note?: string }[];
  skills: string[];
  areas: Record<string, 1 | 2 | 3>;
  traps: string[];
}
export interface Section { h?: string; lines: string[]; bullets?: boolean }
export interface LongCv { id: string; format: "pdf" | "docx"; style: "structured" | "twocol" | "plain"; sections: Section[]; key: Key }

// a small deterministic picker, so the documents are identical on every build
const pick = <T,>(pool: T[], n: number, seed: number) => Array.from({ length: n }, (_, i) => pool[(seed * 7 + i * 5) % pool.length]);
const role = (title: string, company: string, dates: string, bullets: string[]): Section => ({ h: `${title} | ${company} | ${dates}`, lines: bullets, bullets: true });

// ------------------------------------------------------------------ evidence-rich
const ACTUARIAL = [
  "Built and maintained the motor-insurance pricing model using generalised linear models in R, covering 410,000 policies and R2.1 billion of gross written premium.",
  "Presented quarterly pricing reviews to the pricing committee, recommending rate changes that improved the loss ratio from 71% to 64% over two years.",
  "Calculated IBNR reserves for the short-term book using chain-ladder and Bornhuetter-Ferguson methods; reconciled results with the finance team each month.",
  "Automated the monthly experience-monitoring pack in Python, cutting preparation time from four days to six hours.",
  "Led a team of three analysts, reviewing their models and coaching two of them through actuarial exams A211 and A311.",
  "Designed a telematics-based discount for young drivers, tested on 18,000 policies before launch.",
  "Prepared the SAM (Solvency Assessment and Management) technical-provisions inputs for the annual Prudential Authority submission.",
  "Built a lapse-prediction model with gradient boosting in Python that identified 70% of lapses in the top decile of risk.",
  "Reviewed reinsurance treaty pricing for the property book with the reinsurance broker.",
  "Wrote SQL queries against the policy and claims data warehouse to build modelling datasets of 2 million rows.",
  "Validated competitor rate filings and summarised market movements for the executive committee.",
  "Documented model assumptions and limitations for the internal model-governance committee.",
];
const SOFTWARE = [
  "Led a team of six engineers building the card-payments platform in TypeScript and Go, processing 3 million transactions a day at 99.95% availability.",
  "Designed the migration of 40 services from virtual machines to Kubernetes on AWS (EKS), reducing hosting costs by 28%.",
  "Introduced trunk-based development and automated testing in GitHub Actions; deployment frequency rose from fortnightly to several times a day.",
  "Wrote the fraud-rules engine in Go, evaluating 120 rules in under 15 milliseconds per transaction.",
  "Mentored four junior developers and ran weekly architecture reviews.",
  "Built the merchant dashboard in React with server-side rendering in Next.js, used by 12,000 merchants.",
  "Designed PostgreSQL schemas and query plans for a ledger of 900 million rows; cut the slowest report from 40 seconds to 2.",
  "Set up observability with Prometheus, Grafana and OpenTelemetry tracing across all services.",
  "Ran incident response as on-call lead; wrote blameless post-mortems for every severity-one incident.",
  "Implemented PCI DSS controls with the security team, including tokenisation of card numbers.",
  "Managed infrastructure as code in Terraform for three environments.",
  "Interviewed and hired seven engineers over two years.",
];
const ACCOUNTING = [
  "Led statutory audits of listed clients in manufacturing and retail with revenue of up to R6 billion, managing teams of up to eight.",
  "Reviewed IFRS 15 revenue recognition and IFRS 16 lease accounting for three clients during first-time adoption.",
  "Prepared and reviewed group consolidations for a holding company with 23 subsidiaries in four countries.",
  "Prepared corporate income tax returns and provisional tax calculations; resolved two SARS audits without penalties.",
  "Reported key audit matters to audit committees and drafted management letters on internal-control weaknesses.",
  "Built a month-end close checklist that shortened the close from nine to five working days.",
  "Prepared cash-flow forecasts and covenant calculations for the group treasurer.",
  "Reviewed VAT returns and transfer-pricing documentation for cross-border transactions.",
  "Trained 14 first-year trainee accountants on audit methodology and working papers.",
  "Implemented the move from Pastel to Sage Intacct for the group's finance team.",
  "Performed due diligence on two acquisitions, reporting on quality of earnings.",
  "Prepared IFRS annual financial statements and the integrated-report financial review.",
];
const NURSING = [
  "Cared for up to two ventilated patients per shift in a 16-bed adult ICU, including post-cardiac-surgery patients.",
  "Managed arterial lines, central venous lines and continuous renal replacement therapy under protocol.",
  "Acted as shift leader for a team of nine nurses on night duty, allocating patients by acuity.",
  "Trained 22 nurses on the early-warning score and sepsis bundle; sepsis bundle compliance rose from 58% to 91%.",
  "Led the unit's infection-prevention audits; central-line infections fell from 4.1 to 1.2 per 1,000 line days.",
  "Precepted student nurses from the university's nursing programme during their critical-care placements.",
  "Responded as a member of the hospital's resuscitation team, holding current ACLS certification.",
  "Administered and titrated vasoactive infusions, sedation and insulin infusions to protocol.",
  "Documented care in the electronic patient record and audited records for completeness.",
  "Communicated with families daily and arranged multidisciplinary family meetings.",
  "Coordinated transfers with theatre, radiology and the wards.",
  "Took part in the unit's quality-improvement committee.",
];
const CIVIL = [
  "Managed the design and construction of a R480 million water-treatment works upgrade, from tender to commissioning.",
  "Designed reinforced-concrete reservoirs and pipe bridges to SANS 10100 and SANS 10160.",
  "Led a team of five engineers and four technologists across three municipal contracts.",
  "Administered contracts under the GCC 2015 and NEC3, assessing claims and variations worth R32 million.",
  "Produced hydraulic models of a 120 km bulk water network in EPANET to size new pipelines.",
  "Prepared engineering estimates and bills of quantities for 14 tenders.",
  "Reported progress, cost and risk to the client's steering committee each month.",
  "Mentored three candidate engineers through their ECSA training programme.",
  "Supervised site works and quality control, including concrete testing and compaction tests.",
  "Wrote technical specifications for pump stations and pipelines.",
  "Coordinated environmental authorisations with specialist consultants.",
  "Used Civil 3D and Prokon for design and drafting reviews.",
];
const HR = [
  "Partnered with the operations executive and 12 line managers across three plants with 1,400 employees.",
  "Chaired 60 disciplinary hearings and represented the company at the CCMA; won 85% of referred cases.",
  "Negotiated annual wage agreements with two trade unions, concluding without industrial action.",
  "Redesigned the performance-management process, introducing quarterly reviews with calibration panels.",
  "Ran the recruitment of 140 artisans and operators a year with the talent acquisition team.",
  "Prepared the employment-equity report and plan, and chaired the employment-equity committee.",
  "Advised managers on the Labour Relations Act, Basic Conditions of Employment Act and Employment Equity Act.",
  "Introduced exit interviews and a retention dashboard; voluntary turnover fell from 19% to 12%.",
  "Led the section 189 consultation process for a restructuring affecting 85 roles.",
  "Designed a leadership programme for 40 supervisors with a business school.",
  "Analysed engagement-survey results and agreed action plans with each plant.",
  "Managed HR administration and payroll queries with the shared-services centre.",
];

const rich = (sections: Section[], key: Key, id: string, format: LongCv["format"], style: LongCv["style"] = "structured"): LongCv => ({ id, format, style, sections, key });

export const CVS: LongCv[] = [
  rich([
    { lines: ["Ayesha Daniels", "Senior Actuarial Analyst", "ayesha.daniels@example.test | 021 555 0141 | Claremont, Cape Town"] },
    { h: "Profile", lines: ["Actuarial analyst with nine years in short-term insurance pricing and reserving. I build pricing and reserving models, present recommendations to pricing committees, and coach junior analysts through the actuarial exams. Fellow candidate with the Actuarial Society of South Africa."] },
    { h: "Experience", lines: [] },
    role("Senior Actuarial Analyst", "Fynbos Insurance", "Mar 2021 - Present", pick(ACTUARIAL, 7, 1)),
    role("Actuarial Analyst", "Fynbos Insurance", "Jan 2019 - Feb 2021", pick(ACTUARIAL, 6, 2)),
    role("Actuarial Analyst", "Table Bay Mutual", "Feb 2017 - Dec 2018", pick(ACTUARIAL, 6, 3)),
    role("Actuarial Student", "Table Bay Mutual", "Jan 2016 - Jan 2017", pick(ACTUARIAL, 5, 4)),
    { h: "Projects", lines: ["Telematics pricing pilot (2023): designed the rating structure and the test, and reported results to the board risk committee.", "Reserving automation (2022): moved the monthly reserving process from spreadsheets to a tested Python pipeline with version control.", "Exam mentoring (2020 - present): run a weekly study group for six actuarial students."], bullets: true },
    { h: "Education", lines: ["BSc Actuarial Science, University of Cape Town, 2013 - 2015 (graduated with distinction)", "BSc Honours in Actuarial Science, University of Cape Town, 2016", "Actuarial Society of South Africa exams passed: A111, A112, A211, A212, A213, A214, A311"] },
    { h: "Skills", lines: ["R, Python, SQL, generalised linear models, gradient boosting, chain-ladder reserving, SAM, Excel, Power BI"] },
    { h: "Languages", lines: ["English (professional working), Afrikaans (professional working)"] },
  ], { name: "Ayesha Daniels", email: "ayesha.daniels@example.test", phone: "021 555 0141", location: "Claremont, Cape Town", quality: "rich",
    roles: [{ title: "Senior Actuarial Analyst", company: "Fynbos Insurance", start: "2021-03", end: "Present" }, { title: "Actuarial Analyst", company: "Fynbos Insurance", start: "2019-01", end: "2021-02" }, { title: "Actuarial Analyst", company: "Table Bay Mutual", start: "2017-02", end: "2018-12" }, { title: "Actuarial Student", company: "Table Bay Mutual", start: "2016-01", end: "2017-01" }],
    education: [{ degree: "BSc Actuarial Science", truth: "completed", note: "stated: graduated with distinction" }, { degree: "BSc Honours in Actuarial Science", truth: "completed", note: "year only" }],
    skills: ["R", "Python", "SQL", "Excel", "Power BI"], areas: { "area:actuarial": 3, "area:statistics": 3, "area:data-science": 2, "area:financial-mathematics": 2 }, traps: [] }, "x01-ayesha-actuarial", "pdf"),

  rich([
    { lines: ["Sipho Mahlangu", "Engineering Lead", "sipho.mahlangu@example.test | 082 555 0142 | Sandton, Johannesburg"] },
    { h: "Summary", lines: ["Engineering lead with twelve years building payment systems. I design distributed systems, lead teams, and care about reliability, security and developer experience."] },
    { h: "Experience", lines: [] },
    role("Engineering Lead", "Kudu Payments", "Apr 2020 - Present", pick(SOFTWARE, 7, 1)),
    role("Senior Software Engineer", "Kudu Payments", "Jun 2017 - Mar 2020", pick(SOFTWARE, 6, 2)),
    role("Software Engineer", "Baobab Bank", "Feb 2014 - May 2017", pick(SOFTWARE, 6, 3)),
    role("Junior Developer", "Baobab Bank", "Jan 2013 - Jan 2014", pick(SOFTWARE, 4, 4)),
    { h: "Open source and talks", lines: ["Maintainer of a small Go library for idempotent payment requests (1,200 stars).", "Spoke at a local developer conference on running Kubernetes for payments (2023)."], bullets: true },
    { h: "Education", lines: ["BSc Computer Science, University of the Witwatersrand, 2010 - 2012", "BSc Honours in Computer Science, University of the Witwatersrand, 2013"] },
    { h: "Certifications", lines: ["AWS Certified Solutions Architect - Professional (2022)", "Certified Kubernetes Administrator (2021)"] },
    { h: "Skills", lines: ["TypeScript, Go, React, Next.js, Node.js, PostgreSQL, Kubernetes, AWS, Terraform, GitHub Actions, Prometheus, Grafana"] },
  ], { name: "Sipho Mahlangu", email: "sipho.mahlangu@example.test", phone: "082 555 0142", location: "Sandton, Johannesburg", quality: "rich",
    roles: [{ title: "Engineering Lead", company: "Kudu Payments", start: "2020-04", end: "Present" }, { title: "Senior Software Engineer", company: "Kudu Payments", start: "2017-06", end: "2020-03" }, { title: "Software Engineer", company: "Baobab Bank", start: "2014-02", end: "2017-05" }, { title: "Junior Developer", company: "Baobab Bank", start: "2013-01", end: "2014-01" }],
    education: [{ degree: "BSc Computer Science", truth: "completed", note: "implied by the later honours; also 3 years" }, { degree: "BSc Honours in Computer Science", truth: "completed", note: "year only" }],
    skills: ["TypeScript", "Go", "React", "Next.js", "Node.js", "PostgreSQL", "Kubernetes", "AWS", "Terraform", "GitHub Actions", "Prometheus", "Grafana"], areas: { "area:software-engineering": 3, "area:computer-science": 2, "area:networks": 2 }, traps: [] }, "x02-sipho-engineering", "docx"),

  rich([
    { lines: ["Megan van Wyk", "Chartered Accountant (SA)", "megan.vanwyk@example.test | 083 555 0143 | Stellenbosch"] },
    { h: "Profile", lines: ["Chartered accountant with eleven years in audit and corporate finance. Registered with SAICA as a CA(SA) since 2014."] },
    { h: "Experience", lines: [] },
    role("Financial Manager", "Winelands Group", "Aug 2020 - Present", pick(ACCOUNTING, 7, 5)),
    role("Audit Manager", "Theron & Partners Inc.", "Mar 2016 - Jul 2020", pick(ACCOUNTING, 7, 1)),
    role("Audit Senior", "Theron & Partners Inc.", "Jan 2014 - Feb 2016", pick(ACCOUNTING, 6, 2)),
    role("Trainee Accountant (articles)", "Theron & Partners Inc.", "Jan 2011 - Dec 2013", pick(ACCOUNTING, 5, 3)),
    { h: "Education", lines: ["BCom Accounting (majors: Accounting and Taxation), Stellenbosch University, 2007 - 2009", "Postgraduate Diploma in Accounting (CTA), Stellenbosch University, 2010", "CA(SA), South African Institute of Chartered Accountants, 2014"] },
    { h: "Skills", lines: ["IFRS, audit methodology, group consolidations, income tax, VAT, transfer pricing, Sage Intacct, Pastel, Excel"] },
    { h: "Community", lines: ["Treasurer of a children's literacy non-profit since 2018."] },
  ], { name: "Megan van Wyk", email: "megan.vanwyk@example.test", phone: "083 555 0143", location: "Stellenbosch", quality: "rich",
    roles: [{ title: "Financial Manager", company: "Winelands Group", start: "2020-08", end: "Present" }, { title: "Audit Manager", company: "Theron & Partners Inc.", start: "2016-03", end: "2020-07" }, { title: "Audit Senior", company: "Theron & Partners Inc.", start: "2014-01", end: "2016-02" }, { title: "Trainee Accountant (articles)", company: "Theron & Partners Inc.", start: "2011-01", end: "2013-12" }],
    education: [{ degree: "BCom Accounting", truth: "completed", note: "implied by the later postgraduate diploma and CA(SA)" }, { degree: "Postgraduate Diploma in Accounting (CTA)", truth: "completed" }, { degree: "CA(SA)", truth: "completed" }],
    skills: ["IFRS", "Excel", "Pastel"], areas: { "area:accounting": 3, "area:auditing": 3, "area:taxation": 2, "area:finance": 2 }, traps: [] }, "x03-megan-accountant", "pdf"),

  rich([
    { lines: ["Nomvula Zulu", "Registered Nurse - Critical Care", "nomvula.zulu@example.test | 031 555 0144 | Umhlanga, Durban"] },
    { h: "Profile", lines: ["Critical-care nurse with eleven years in adult ICU. Registered with the South African Nursing Council (SANC) as a professional nurse, with a postgraduate diploma in critical care nursing."] },
    { h: "Experience", lines: [] },
    role("Unit Manager, Adult ICU", "Umhlanga Private Hospital", "Feb 2021 - Present", pick(NURSING, 7, 2)),
    role("Senior Professional Nurse, ICU", "Umhlanga Private Hospital", "Mar 2017 - Jan 2021", pick(NURSING, 7, 1)),
    role("Professional Nurse, ICU", "Inkosi Albert Luthuli Hospital", "Jan 2014 - Feb 2017", pick(NURSING, 6, 3)),
    role("Professional Nurse, Medical Ward", "Addington Hospital", "Jan 2013 - Dec 2013", pick(NURSING, 4, 4)),
    { h: "Education", lines: ["Bachelor of Nursing, University of KwaZulu-Natal, 2009 - 2012", "Postgraduate Diploma in Critical Care Nursing, University of KwaZulu-Natal, 2016"] },
    { h: "Registrations and certificates", lines: ["SANC registered professional nurse (registration current)", "ACLS (current, renewed 2025)", "BLS instructor (2024)"] },
    { h: "Skills", lines: ["Mechanical ventilation, CRRT, haemodynamic monitoring, sepsis management, infection prevention, clinical teaching"] },
  ], { name: "Nomvula Zulu", email: "nomvula.zulu@example.test", phone: "031 555 0144", location: "Umhlanga, Durban", quality: "rich",
    roles: [{ title: "Unit Manager, Adult ICU", company: "Umhlanga Private Hospital", start: "2021-02", end: "Present" }, { title: "Senior Professional Nurse, ICU", company: "Umhlanga Private Hospital", start: "2017-03", end: "2021-01" }, { title: "Professional Nurse, ICU", company: "Inkosi Albert Luthuli Hospital", start: "2014-01", end: "2017-02" }, { title: "Professional Nurse, Medical Ward", company: "Addington Hospital", start: "2013-01", end: "2013-12" }],
    education: [{ degree: "Bachelor of Nursing", truth: "completed", note: "4-year degree in 4 years; SANC registration" }, { degree: "Postgraduate Diploma in Critical Care Nursing", truth: "completed" }],
    skills: [], areas: { "area:nursing": 3, "area:clinical-medicine": 2, "area:education": 2 }, traps: [] }, "x04-nomvula-icu-nurse", "pdf", "twocol"),

  rich([
    { lines: ["Johan Botha", "Senior Civil Engineer, Pr.Eng", "johan.botha@example.test | 012 555 0145 | Centurion, Pretoria"] },
    { h: "Profile", lines: ["Professional civil engineer (ECSA registered, Pr.Eng) with fifteen years in water infrastructure: design, contract administration and project management for municipal clients."] },
    { h: "Experience", lines: [] },
    role("Associate, Water", "Highveld Consulting Engineers", "Jul 2019 - Present", pick(CIVIL, 7, 1)),
    role("Senior Civil Engineer", "Highveld Consulting Engineers", "Feb 2014 - Jun 2019", pick(CIVIL, 7, 2)),
    role("Civil Engineer", "Magalies Projects", "Jan 2011 - Jan 2014", pick(CIVIL, 6, 3)),
    role("Candidate Engineer", "Magalies Projects", "Jan 2009 - Dec 2010", pick(CIVIL, 5, 4)),
    { h: "Education", lines: ["BEng Civil Engineering, University of Pretoria, 2005 - 2008", "Professional Engineer (Pr.Eng), Engineering Council of South Africa, 2013"] },
    { h: "Skills", lines: ["Reinforced concrete design, hydraulic modelling (EPANET), contract administration (GCC 2015, NEC3), Civil 3D, Prokon, project management"] },
  ], { name: "Johan Botha", email: "johan.botha@example.test", phone: "012 555 0145", location: "Centurion, Pretoria", quality: "rich",
    roles: [{ title: "Associate, Water", company: "Highveld Consulting Engineers", start: "2019-07", end: "Present" }, { title: "Senior Civil Engineer", company: "Highveld Consulting Engineers", start: "2014-02", end: "2019-06" }, { title: "Civil Engineer", company: "Magalies Projects", start: "2011-01", end: "2014-01" }, { title: "Candidate Engineer", company: "Magalies Projects", start: "2009-01", end: "2010-12" }],
    education: [{ degree: "BEng Civil Engineering", truth: "completed", note: "4 years and Pr.Eng" }],
    skills: [], areas: { "area:civil-engineering": 3, "area:project-management": 3, "area:mathematics": 2 }, traps: [] }, "x05-johan-civil", "docx"),

  rich([
    { lines: ["Lerato Molefe", "HR Business Partner", "lerato.molefe@example.test | 015 555 0146 | Polokwane"] },
    { h: "Profile", lines: ["HR business partner with ten years in manufacturing: employee relations, performance management and employment equity across multi-site operations."] },
    { h: "Experience", lines: [] },
    role("Senior HR Business Partner", "Limpopo Steel Works", "May 2020 - Present", pick(HR, 7, 1)),
    role("HR Business Partner", "Limpopo Steel Works", "Jan 2017 - Apr 2020", pick(HR, 7, 2)),
    role("Employee Relations Officer", "Bushveld Foods", "Feb 2014 - Dec 2016", pick(HR, 6, 3)),
    role("HR Intern", "Bushveld Foods", "Feb 2013 - Jan 2014", pick(HR, 4, 4)),
    { h: "Education", lines: ["BCom Industrial Psychology (majors: Industrial Psychology and Human Resource Management), University of Limpopo, 2009 - 2011", "BCom Honours in Industrial Psychology, University of Limpopo, 2012"] },
    { h: "Skills", lines: ["Employee relations, CCMA representation, wage negotiation, performance management, employment equity, labour law"] },
  ], { name: "Lerato Molefe", email: "lerato.molefe@example.test", phone: "015 555 0146", location: "Polokwane", quality: "rich",
    roles: [{ title: "Senior HR Business Partner", company: "Limpopo Steel Works", start: "2020-05", end: "Present" }, { title: "HR Business Partner", company: "Limpopo Steel Works", start: "2017-01", end: "2020-04" }, { title: "Employee Relations Officer", company: "Bushveld Foods", start: "2014-02", end: "2016-12" }, { title: "HR Intern", company: "Bushveld Foods", start: "2013-02", end: "2014-01" }],
    education: [{ degree: "BCom Industrial Psychology", truth: "completed", note: "implied by the honours" }, { degree: "BCom Honours in Industrial Psychology", truth: "completed" }],
    skills: [], areas: { "area:human-resources": 3, "area:law": 2, "area:management": 2 }, traps: [] }, "x06-lerato-hr", "pdf"),

  // ------------------------------------------------------------------ weak, in the ways real CVs are weak
  {
    id: "x07-thabo-data-analyst", format: "pdf", style: "twocol",
    sections: [
      { lines: ["THABO NKOSI", "Data Analyst / Data Scientist / BI Developer", "thabo.nkosi@example.test | 041 555 0147 | Gqeberha"] },
      { h: "Skills", lines: ["Excel", "Power BI", "SQL", "Python", "Tableau", "R", "SAS", "Hadoop", "Spark", "Machine Learning", "Deep Learning", "AI", "Big Data", "Data Science", "Statistics", "Excel (advanced)", "Power BI (expert)", "SQL (expert)", "Python (expert)", "Communication", "Teamwork", "Problem solving"], bullets: true },
      { h: "Hobbies", lines: ["Soccer, gaming, reading tech blogs, chess, travelling, music"] },
      { h: "Objective", lines: ["A passionate, results-driven and highly motivated data professional looking for an exciting opportunity in a dynamic company where I can use my skills and grow. I am a hard worker, a team player and a fast learner who is passionate about data and making a difference. I want to grow with a company and add value."] },
      { h: "Experience", lines: [] },
      role("Data Analyst", "Coastal Retail", "2022 - now", ["Responsible for reports.", "Assisted with data.", "Worked with Excel and Power BI.", "Attended meetings.", "Helped the team with various tasks as required.", "Responsible for various duties.", "Did data cleaning and stuff.", "Made dashboards."]),
      role("Admin Clerk", "Coastal Retail", "", ["Filing.", "Capturing data on the system.", "Answering phones.", "Assisted with reports.", "General admin duties as required.", "Any other duties as required."]),
      role("Sales Assistant", "Harbour Mall Outlet", "2015-2018", ["Helped customers.", "Worked on the till.", "Packed shelves.", "Did stock take.", "Assisted with various tasks."]),
      { h: "Education", lines: ["BCom, Nelson Mandela University, 2014 - 2015", "Matric, Grey High School, 2013", "Data Science Bootcamp (online), 2023", "Excel course, 2021"] },
      { h: "References", lines: ["Available on request."] },
      { h: "Extra", lines: ["I am a quick learner and I love data. I have done many projects in Python and machine learning on my own time. I am passionate about AI and big data. I am a team player and work well under pressure and can also work alone. I am reliable, honest and punctual.", "Strengths: hard working, passionate, motivated, team player, communication skills, problem solving, analytical thinking, attention to detail, time management, leadership.", "Weaknesses: I work too hard sometimes."] },
    ],
    key: { name: "Thabo Nkosi", email: "thabo.nkosi@example.test", phone: "041 555 0147", location: "Gqeberha", quality: "poor",
      roles: [{ title: "Data Analyst", company: "Coastal Retail", start: "2022", end: "Present" }, { title: "Admin Clerk", company: "Coastal Retail", start: "", end: "" }, { title: "Sales Assistant", company: "Harbour Mall Outlet", start: "2015", end: "2018" }],
      education: [{ degree: "BCom", truth: "unknown", note: "2014 - 2015 is one year for a three-year degree: ask" }, { degree: "Matric", truth: "completed" }],
      skills: ["Excel", "Power BI", "SQL", "Python"], areas: { "area:data-science": 1 }, traps: ["keyword stuffing in skills", "vague duties", "undated role", "BCom in one year", "self-description"] },
  },
  {
    id: "x08-carl-sales", format: "docx", style: "plain",
    sections: [
      { lines: ["Carl Jacobs", "Sales", "carl.jacobs@example.test, 043 555 0148, East London"] },
      { h: "Career Objective", lines: ["To obtain a challenging position in sales where I can use my skills and experience to grow the company and myself. I am looking for remote-only roles as I care for my family at home. Not willing to relocate."] },
      { h: "Work History", lines: ["Sales Rep at Border Distributors from Jan 2019 till date. Responsable for sales in the area. Visited clients. Took orders. Met targets most months. Did reports for the manager. Attended sales meetings every monday.", "Sales Rep at Amatola Beverages 2016 to 2018. Same duties as above. Visited spaza shops and taverns and supermarkets. Took orders. Merchandising.", "Merchandiser at Amatola Beverages 2014 to 2016. Packed shelves. Did promotions. Helped the reps.", "Petrol attendant at Buffalo Fuel 2012 to 2014."] },
      { h: "Education", lines: ["Matric 2011, Selborne College", "Sales course (3 days), 2017"] },
      { h: "Skills", lines: ["Sales, negotiation, customer service, communication, MS Office, Excel, driving, teamwork, honesty, punctuality, sales, customer service, sales, negotiation"] },
      { h: "Personal Details", lines: ["Drivers licence code 08 (code B), own car. Health: excellent. Languages: English, Afrikaans, isiXhosa."] },
      { h: "Hobbies", lines: ["Fishing, rugby, braai, church activities, spending time with family and friends, watching TV, listening to music."] },
      { h: "References", lines: ["Mr P. Peters, Sales Manager, Border Distributors (details on request)", "Mrs L. Ngcobo, Branch Manager, Amatola Beverages (details on request)"] },
      { h: "Additional information", lines: ["I am a hard working, honest and reliable person who works well with people. I am target driven and I always go the extra mile for my clients. I can work under pressure and meet deadlines. I am a team player but can also work on my own without supervision. I am willing to learn new things and I adapt easily to change.", "I believe that I would be an asset to your company and I am available immediately. I thank you for taking the time to read my CV and I look forward to hearing from you.", "Achievements: Rep of the month (several times). Good relationships with clients. Always met my targets (most months)."] },
    ],
    key: { name: "Carl Jacobs", email: "carl.jacobs@example.test", phone: "043 555 0148", location: "East London", quality: "poor",
      roles: [{ title: "Sales Rep", company: "Border Distributors", start: "2019-01", end: "Present" }, { title: "Sales Rep", company: "Amatola Beverages", start: "2016", end: "2018" }, { title: "Merchandiser", company: "Amatola Beverages", start: "2014", end: "2016" }, { title: "Petrol attendant", company: "Buffalo Fuel", start: "2012", end: "2014" }],
      education: [{ degree: "Matric", truth: "completed" }], skills: ["Sales", "Negotiation", "Customer service", "Excel"], areas: { "area:marketing": 1 },
      traps: ["remote-only statement", "not willing to relocate", "work history as prose", "health and church details (never used)", "typos"] },
  },
  {
    id: "x09-pieter-it-support", format: "pdf", style: "structured",
    sections: [
      { lines: ["Pieter Smit", "Network Engineer", "pieter.smit@example.test | 051 555 0149 | Bloemfontein"] },
      { h: "Summary", lines: ["IT professional. Experienced in networking, support, servers and cloud. CCNA (studying)."] },
      { h: "Work Experience", lines: [] },
      role("IT Support Technician", "Mangaung Motors", "03/2018 – now", ["Desktop support for 80 users.", "Reset passwords and set up new laptops.", "Helped with the network.", "Installed switches sometimes.", "Logged tickets on the helpdesk.", "Supported the printers.", "Assisted with the server room."]),
      role("Helpdesk Agent", "Free State Telecoms", "Jan'15 - Feb'18", ["Answered calls.", "Logged tickets.", "Escalated issues to the network team.", "Did remote support.", "Helped customers with their routers.", "Did basic troubleshooting."]),
      role("Network Engineer (contract)", "Rooi Rand Logistics", "2016", ["Network stuff.", "Configured Cisco.", "Set up Wi-Fi."]),
      { h: "Education", lines: ["Diploma in Information Technology, Central University of Technology, 2019 - present", "CCNA (studying)", "Matric, Grey College, 2014", "A+ certificate"] },
      { h: "Skills", lines: ["Cisco, routing, switching, Windows Server, Active Directory, Azure, AWS, VMware, firewalls, Linux, networking, cybersecurity, cloud, VoIP, Office 365"] },
      { h: "Languages", lines: ["Afrikaans (first language), English"] },
      { h: "Other", lines: ["I am a hard working person who loves technology. I fix computers for family and friends. I have a home lab where I practice networking. I want to become a network engineer and later a cloud architect. I am a fast learner and I am passionate about IT. I can work under pressure."] },
      { h: "Projects", lines: ["Home lab with two switches and a router.", "Set up the network at my church.", "Helped a friend's business move to Office 365.", "Built my own PC.", "Learning Python."], bullets: true },
    ],
    key: { name: "Pieter Smit", email: "pieter.smit@example.test", phone: "051 555 0149", location: "Bloemfontein", quality: "poor",
      roles: [{ title: "IT Support Technician", company: "Mangaung Motors", start: "2018-03", end: "Present" }, { title: "Helpdesk Agent", company: "Free State Telecoms", start: "2015-01", end: "2018-02" }, { title: "Network Engineer (contract)", company: "Rooi Rand Logistics", start: "2016", end: "2016" }],
      education: [{ degree: "Diploma in Information Technology", truth: "in_progress" }, { degree: "Matric", truth: "completed" }],
      skills: ["Cisco", "Windows Server", "Active Directory", "Office 365"], areas: { "area:networks": 1, "area:information-systems": 1 },
      traps: ["title claims more than the evidence", "mixed date formats", "overlapping contract role", "diploma in progress", "CCNA studying"] },
  },
  {
    id: "x10-kayla-marketing", format: "pdf", style: "twocol",
    sections: [
      { lines: ["Kayla Pillay", "Digital Marketing Guru | Growth Hacker | Brand Storyteller", "kayla.pillay@example.test | 011 555 0150 | Johannesburg"] },
      { h: "Core skills", lines: ["SEO", "SEM", "Google Ads", "Meta Ads", "Content", "Branding", "Growth hacking", "Influencer marketing", "Copywriting", "Strategy", "Analytics", "SEO", "SEO", "Google Ads", "Google Ads", "Branding", "Branding", "Social media", "Social media", "Social media"], bullets: true },
      { h: "Personality", lines: ["Dynamic, passionate, vibrant, creative go-getter and rockstar team player with a sense of humour."] },
      { h: "About me", lines: ["I am a passionate, creative and dynamic marketer who lives and breathes brands. I love storytelling and creating magic for brands. I am a growth hacker at heart and I think outside the box. I am a team player with an outgoing personality and I bring energy to every room. Social media is my passion and I am always on top of the latest trends."] },
      { h: "Experience", lines: [] },
      role("Marketing Coordinator", "Jozi Lifestyle Brands", "Jun 2021 - Present", ["Managed social media for 5 brands.", "Ran campaigns.", "Worked on SEO.", "Created content.", "Coordinated events.", "Worked with influencers.", "Did branding."]),
      role("Social Media Manager (freelance)", "Self-employed", "Jan 2020 - Dec 2022", ["Managed social media for clients.", "Created content.", "Grew followers.", "Did Google Ads and Meta Ads.", "Did SEO."]),
      role("Marketing Intern", "Rosebank Agency", "2019 - 2020", ["Assisted the team.", "Made posts.", "Helped with events.", "Did research."]),
      { h: "Education", lines: ["BA Communication Science, University of Johannesburg", "Google Ads certification", "HubSpot inbound marketing certificate"] },
      { h: "Achievements", lines: ["Grew a brand's Instagram a lot.", "Ran successful campaigns.", "Best intern."] },
      { h: "Interests", lines: ["Fashion, travel, food, photography, dancing, wellness, spirituality, astrology, coffee."] },
    ],
    key: { name: "Kayla Pillay", email: "kayla.pillay@example.test", phone: "011 555 0150", location: "Johannesburg", quality: "poor",
      roles: [{ title: "Marketing Coordinator", company: "Jozi Lifestyle Brands", start: "2021-06", end: "Present" }, { title: "Social Media Manager (freelance)", company: "Self-employed", start: "2020-01", end: "2022-12" }, { title: "Marketing Intern", company: "Rosebank Agency", start: "2019", end: "2020" }],
      education: [{ degree: "BA Communication Science", truth: "unknown", note: "no year" }],
      skills: ["SEO", "Google Ads", "Social media"], areas: { "area:marketing": 2, "area:communication": 1 },
      traps: ["repeated skills (stuffing)", "buzzwords", "overlapping freelance and employed roles", "degree with no year", "vague achievements"] },
  },
  {
    id: "x11-bongani-electrician", format: "docx", style: "structured",
    sections: [
      { lines: ["Bongani Dlamini", "Electrician", "bongani.dlamini@example.test | 014 555 0151 | Rustenburg"] },
      { h: "Summary", lines: ["Electrician with experience in mining and construction."] },
      { h: "Experience", lines: [] },
      role("Electrician", "Platinum Belt Mining", "2020 - present", ["Maintenance of electrical equipment.", "Fault finding.", "Installations.", "Followed safety rules.", "Completed job cards.", "Worked with the team."]),
      role("Electrician", "Bojanala Construction", "2017 - 2020", ["Maintenance of electrical equipment.", "Fault finding.", "Installations.", "Followed safety rules.", "Completed job cards.", "Worked with the team."]),
      role("Assistant Electrician", "Bojanala Construction", "2014 - 2017", ["Assisted the electrician.", "Carried tools.", "Pulled cables.", "Followed safety rules.", "Cleaned the site."]),
      role("General Worker", "Bojanala Construction", "2012 - 2014", ["General work on site.", "Followed safety rules."]),
      { h: "Qualifications", lines: ["Trade test - Electrician", "N3 Electrical Engineering, Orbit TVET College, 2013", "Matric, 2011", "Wireman's licence (applied)"] },
      { h: "Skills", lines: ["Fault finding, installations, maintenance, motors, PLC basics, reading drawings, safety"] },
      { h: "Personal", lines: ["Driver's licence code 10, own transport. Available immediately. Non-smoker."] },
      { h: "Duties at all my jobs", lines: ["Maintenance of electrical equipment. Fault finding. Installations. Followed safety rules. Completed job cards. Worked with the team. Maintenance of electrical equipment. Fault finding. Installations. Followed safety rules. Completed job cards. Worked with the team."] },
      { h: "Safety", lines: ["I always follow safety rules and wear PPE. I have never had an accident. I attend all safety talks."] },
      { h: "References", lines: ["Available on request."] },
    ],
    key: { name: "Bongani Dlamini", email: "bongani.dlamini@example.test", phone: "014 555 0151", location: "Rustenburg", quality: "poor",
      roles: [{ title: "Electrician", company: "Platinum Belt Mining", start: "2020", end: "Present" }, { title: "Electrician", company: "Bojanala Construction", start: "2017", end: "2020" }, { title: "Assistant Electrician", company: "Bojanala Construction", start: "2014", end: "2017" }, { title: "General Worker", company: "Bojanala Construction", start: "2012", end: "2014" }],
      education: [{ degree: "Trade test - Electrician", truth: "unknown", note: "no year" }, { degree: "N3 Electrical Engineering", truth: "completed", note: "year only" }, { degree: "Matric", truth: "completed" }],
      skills: ["Fault finding"], areas: { "area:electrical-engineering": 2 },
      traps: ["identical duties copied across roles", "repeated paragraph", "trade test without a year", "licence applied, not held", "non-smoker (never used)"] },
  },
  {
    id: "x12-grace-teacher-to-pm", format: "pdf", style: "structured",
    sections: [
      { lines: ["Grace Mokoena", "Project Manager", "grace.mokoena@example.test | 053 555 0152 | Kimberley"] },
      { h: "Profile", lines: ["Former teacher moving into project management. Organised, people-focused and willing to relocate for the right opportunity. PMP (in progress)."] },
      { h: "Experience", lines: [] },
      role("Project Coordinator", "Northern Cape Community Trust", "Jan 2022 - Present", ["Coordinated community projects.", "Kept project plans up to date in Excel.", "Organised meetings and took minutes.", "Tracked budgets.", "Reported to the project manager.", "Worked with stakeholders."]),
      role("Teacher (Grade 10-12 Mathematics)", "Kimberley Girls' High", "Jan 2012 - Dec 2018", ["Taught Grade 10 to 12 Mathematics to classes of 35 learners.", "Prepared learners for the National Senior Certificate exams.", "Organised the school's maths olympiad team.", "Served on the timetable committee.", "Coordinated the Grade 11 excursion each year.", "Mentored student teachers."]),
      role("Tutor (part-time)", "Self-employed", "2010 - 2014", ["Tutored maths learners after school.", "Helped learners prepare for exams."]),
      { h: "Education", lines: ["BEd (Senior Phase and FET Mathematics), Sol Plaatje University, 2008 - 2010 (did not complete; left in third year)", "Advanced Certificate in Teaching, UNISA, 2011", "PMP (in progress)", "Matric, 2007"] },
      { h: "Skills", lines: ["Project planning, stakeholder management, Excel, MS Project, budgeting, communication, teaching, mathematics, leadership, organisation"] },
      { h: "Career break", lines: [] },
      { h: "Other information", lines: ["I am a hard working and organised person. I am passionate about people and community development. I want to build a career in project management and I am studying towards my PMP. I am willing to relocate anywhere in South Africa.", "I enjoy reading, gardening and volunteering at my church's youth programme."] },
      { h: "References", lines: ["Available on request."] },
      { h: "Additional skills", lines: ["Microsoft Word, Excel, PowerPoint, Outlook, Teams, Zoom, Google Workspace, Canva, Trello, Asana, Monday.com, MS Project, Smartsheet, Jira, Confluence, Miro, Slack, Notion, ClickUp, Basecamp"] },
    ],
    key: { name: "Grace Mokoena", email: "grace.mokoena@example.test", phone: "053 555 0152", location: "Kimberley", quality: "poor",
      roles: [{ title: "Project Coordinator", company: "Northern Cape Community Trust", start: "2022-01", end: "Present" }, { title: "Teacher (Grade 10-12 Mathematics)", company: "Kimberley Girls' High", start: "2012-01", end: "2018-12" }, { title: "Tutor (part-time)", company: "Self-employed", start: "2010", end: "2014" }],
      education: [{ degree: "BEd (Senior Phase and FET Mathematics)", truth: "not_completed", note: "did not complete" }, { degree: "Advanced Certificate in Teaching", truth: "completed", note: "year only" }, { degree: "PMP", truth: "in_progress" }, { degree: "Matric", truth: "completed" }],
      skills: ["Excel", "MS Project"], areas: { "area:education": 3, "area:mathematics": 2, "area:project-management": 1 },
      traps: ["title is the goal, not the experience", "degree not completed", "certification in progress", "unexplained gap 2019-2021 (an empty 'career break' heading)", "tool list stuffing", "willing to relocate"] },
  },
];

// ------------------------------------------------------------------ length: real long CVs (at least four pages) carry more than duties
const MORE_RICH: Record<string, { context: string[]; achievements: string[]; training: string[]; memberships: string[] }> = {
  actuarial: {
    context: ["Fynbos Insurance is a short-term insurer with about 1.2 million policies in motor, home and small-business cover.", "Table Bay Mutual is a mutual insurer focused on personal lines in the Western Cape."],
    achievements: ["Reduced the motor loss ratio from 71% to 64% over two years through a re-rated pricing structure.", "Cut monthly experience-monitoring preparation from four days to six hours by automating it in Python.", "Coached two analysts to pass A211 and A311 within one sitting.", "Designed the company's first telematics discount, now used on 26,000 policies."],
    training: ["Advanced R for actuaries (2022)", "Model governance and validation (2021)", "Leadership essentials for team leads (2021)", "SAM technical provisions workshop (2019)", "Data engineering with SQL (2018)"],
    memberships: ["Student member, Actuarial Society of South Africa"],
  },
  software: {
    context: ["Kudu Payments is a payments processor serving 12,000 merchants in Southern Africa.", "Baobab Bank is a retail bank with 2 million customers."],
    achievements: ["Moved 40 services to Kubernetes on AWS with no customer-facing outage, cutting hosting costs by 28%.", "Raised deployment frequency from fortnightly to several times a day.", "Kept the card platform at 99.95% availability for three consecutive years.", "Hired and onboarded seven engineers; four have since been promoted."],
    training: ["AWS Solutions Architect Professional preparation (2022)", "Kubernetes administration (2021)", "Secure coding for payment systems (2020)", "Engineering management fundamentals (2020)", "Site reliability engineering workshop (2019)"],
    memberships: ["Member, local Go user group (organiser since 2021)"],
  },
  accounting: {
    context: ["Winelands Group is a wine and agriculture group with 23 subsidiaries.", "Theron & Partners Inc. is a mid-tier audit firm with listed and private clients."],
    achievements: ["Shortened the group's month-end close from nine to five working days.", "Led the first-time adoption of IFRS 16 for three audit clients without restatement.", "Resolved two SARS audits with no penalties.", "Trained 14 trainee accountants on audit methodology."],
    training: ["IFRS update (annual, 2015 - 2025)", "Tax for finance managers (2021)", "Data analytics for auditors (2019)", "Leadership in professional services (2018)", "Transfer pricing essentials (2017)"],
    memberships: ["CA(SA), South African Institute of Chartered Accountants"],
  },
  nursing: {
    context: ["Umhlanga Private Hospital has a 16-bed adult ICU with cardiac and general surgical patients.", "Inkosi Albert Luthuli Hospital is a central referral hospital with a large critical-care service."],
    achievements: ["Raised sepsis-bundle compliance from 58% to 91% through ward training.", "Reduced central-line infections from 4.1 to 1.2 per 1,000 line days.", "Precepted more than 30 student nurses in critical care.", "Introduced a structured handover tool adopted by three units."],
    training: ["ACLS (renewed 2025)", "BLS instructor course (2024)", "Infection prevention and control (2022)", "Mechanical ventilation masterclass (2020)", "Clinical leadership programme (2021)"],
    memberships: ["SANC registered professional nurse", "Member, Critical Care Society of Southern Africa"],
  },
  civil: {
    context: ["Highveld Consulting Engineers is a consulting firm working mainly for municipalities and water boards.", "Magalies Projects is a civil engineering contractor and consultant in Gauteng and North West."],
    achievements: ["Delivered a R480 million water-treatment works upgrade on time and 3% under budget.", "Assessed claims and variations worth R32 million under GCC 2015 and NEC3.", "Mentored three candidate engineers to ECSA registration.", "Designed bulk pipelines for a 120 km network using EPANET models."],
    training: ["NEC3 contract management (2018)", "Advanced reinforced concrete design (2016)", "Project management for engineers (2015)", "Water network modelling (2012)", "Health and safety for construction (2011)"],
    memberships: ["Pr.Eng, Engineering Council of South Africa", "Member, South African Institution of Civil Engineering"],
  },
  hr: {
    context: ["Limpopo Steel Works employs 1,400 people across three plants.", "Bushveld Foods is a food manufacturer with 600 employees."],
    achievements: ["Concluded two wage agreements without industrial action.", "Reduced voluntary turnover from 19% to 12% through exit interviews and a retention dashboard.", "Won 85% of cases referred to the CCMA.", "Led a section 189 consultation for 85 roles with no unfair-dismissal findings."],
    training: ["Advanced labour law (2022)", "Employment equity compliance (2021)", "Negotiation skills (2019)", "Coaching for HR partners (2018)", "Psychometric assessment user training (2015)"],
    memberships: ["Registered HR Professional, SABPP"],
  },
};
const RICH_KIND: Record<string, keyof typeof MORE_RICH> = { "x01-ayesha-actuarial": "actuarial", "x02-sipho-engineering": "software", "x03-megan-accountant": "accounting", "x04-nomvula-icu-nurse": "nursing", "x05-johan-civil": "civil", "x06-lerato-hr": "hr" };
const POOLS: Record<keyof typeof MORE_RICH, string[]> = { actuarial: ACTUARIAL, software: SOFTWARE, accounting: ACCOUNTING, nursing: NURSING, civil: CIVIL, hr: HR };

// weak CVs are long for the wrong reasons: generic duties, course lists, and personal details that must never be used (all invented)
const VAGUE = ["Responsible for daily tasks.", "Assisted colleagues where needed.", "Attended meetings.", "Ensured good customer service.", "Followed company policies and procedures.", "Worked under pressure.", "Met deadlines.", "Maintained a clean work area.", "Completed admin as required.", "Liaised with other departments.", "Reported to the manager.", "Performed any other duties as required.", "Kept records up to date.", "Supported the team.", "Handled queries."];
const PERSONAL: Record<string, string[]> = {
  "x07-thabo-data-analyst": ["Date of birth: 12 May 1995", "Gender: Male", "Marital status: Single", "ID number: 9505125800087", "Nationality: South African", "Health: Excellent"],
  "x08-carl-sales": ["Date of birth: 3 March 1993", "Gender: Male", "Marital status: Married with two children", "ID number: 9303035800081", "Religion: Christian"],
  "x11-bongani-electrician": ["Date of birth: 20 August 1992", "Gender: Male", "Marital status: Single", "ID number: 9208205800084", "Home language: isiZulu"],
};

for (const cv of CVS) {
  const kind = RICH_KIND[cv.id];
  if (kind) {
    const more = MORE_RICH[kind];
    // each role gets the rest of its profession's duties, after a line on the employer
    let r = 0;
    cv.sections = cv.sections.map((s) => {
      if (!s.bullets || !s.h?.includes(" | ")) return s;
      const company = s.h.split(" | ")[1], ctx = more.context.find((c) => c.startsWith(company));
      const extra = pick(POOLS[kind], 4, 20 + r++).filter((b) => !s.lines.includes(b));
      return { ...s, lines: [...(ctx ? [ctx] : []), ...s.lines, ...extra] };
    });
    cv.sections.push({ h: "Selected achievements", lines: more.achievements, bullets: true }, { h: "Training and development", lines: more.training, bullets: true }, { h: "Professional memberships", lines: more.memberships }, { h: "References", lines: ["Two professional references are available on request, from a current and a previous line manager."] });
  } else {
    let r = 0;
    cv.sections = cv.sections.map((s) => (s.bullets && s.h?.includes(" | ") ? { ...s, lines: [...s.lines, ...pick(VAGUE, 8, r++)] } : s));
    cv.sections.push(
      { h: "Courses attended", lines: ["Customer service excellence (1 day)", "Time management (half day)", "Microsoft Office basics", "First aid level 1", "Fire marshal training", "Team building workshop", "Wellness day", "Induction programme"], bullets: true },
      ...(PERSONAL[cv.id] ? [{ h: "Personal information", lines: PERSONAL[cv.id] }] : []),
      { h: "Declaration", lines: ["I hereby declare that the information given above is true and correct to the best of my knowledge and belief. I am available for an interview at any time and can start immediately. Thank you for considering my application. I look forward to hearing from you soon."] },
    );
  }
}

// earlier roles, so a career reaches back the way real long CVs do (each is also added to the answer key)
const EARLIER: Record<string, { title: string; company: string; dates: string; start: string; end: string }[]> = {
  "x01-ayesha-actuarial": [{ title: "Vacation Student, Actuarial", company: "Atlantic Life", dates: "Dec 2014 - Feb 2015", start: "2014-12", end: "2015-02" }, { title: "Tutor, Statistics", company: "University of Cape Town", dates: "Feb 2014 - Nov 2015", start: "2014-02", end: "2015-11" }],
  "x02-sipho-engineering": [{ title: "Intern Developer", company: "Soweto Code Lab", dates: "Jun 2012 - Dec 2012", start: "2012-06", end: "2012-12" }, { title: "Teaching Assistant, Programming", company: "University of the Witwatersrand", dates: "Feb 2011 - Nov 2012", start: "2011-02", end: "2012-11" }],
  "x03-megan-accountant": [{ title: "Bookkeeper (part-time)", company: "Eikestad Traders", dates: "Feb 2008 - Dec 2010", start: "2008-02", end: "2010-12" }],
  "x04-nomvula-icu-nurse": [{ title: "Community Service Nurse", company: "Prince Mshiyeni Hospital", dates: "Jan 2012 - Dec 2012", start: "2012-01", end: "2012-12" }],
  "x05-johan-civil": [{ title: "Vacation Student", company: "Pretoria Roads Department", dates: "Dec 2006 - Jan 2007", start: "2006-12", end: "2007-01" }, { title: "Site Assistant", company: "Magalies Projects", dates: "Dec 2007 - Jan 2008", start: "2007-12", end: "2008-01" }],
  "x06-lerato-hr": [{ title: "Recruitment Administrator", company: "Capricorn Staffing", dates: "Mar 2012 - Jan 2013", start: "2012-03", end: "2013-01" }],
  "x07-thabo-data-analyst": [{ title: "Cashier", company: "Summerstrand Superstore", dates: "2013-2015", start: "2013", end: "2015" }, { title: "Waiter", company: "Boardwalk Restaurant", dates: "2012", start: "2012", end: "2012" }],
  "x08-carl-sales": [{ title: "Packer", company: "Mdantsane Wholesalers", dates: "2010 to 2012", start: "2010", end: "2012" }, { title: "Car guard", company: "Vincent Park Centre", dates: "2009", start: "2009", end: "2009" }],
  "x09-pieter-it-support": [{ title: "Shop Assistant", company: "Loch Logan Electronics", dates: "2014", start: "2014", end: "2014" }],
  "x10-kayla-marketing": [{ title: "Promoter", company: "Sandton Events Co", dates: "2017 - 2019", start: "2017", end: "2019" }, { title: "Waitress", company: "Melville Cafe", dates: "2016 - 2017", start: "2016", end: "2017" }],
  "x11-bongani-electrician": [{ title: "Packer", company: "Phokeng Stores", dates: "2010 - 2011", start: "2010", end: "2011" }],
  "x12-grace-teacher-to-pm": [{ title: "Assistant Teacher", company: "Galeshewe Primary", dates: "2011", start: "2011", end: "2011" }],
};
const PROJECTS: Record<string, string[]> = {
  "x01-ayesha-actuarial": ["Pricing model rebuild (2022 - 2023): replaced a 12-year-old rating structure with a GLM-based model; ran parallel pricing for three months before switching, with the pricing committee's sign-off at each step.", "Reserving pipeline (2021): moved monthly reserving from 40 linked spreadsheets to a tested Python pipeline with version control and a reconciliation report for finance.", "Lapse model (2020): built and validated a gradient-boosting lapse model; the retention team used it to prioritise 9,000 calls a month."],
  "x02-sipho-engineering": ["Kubernetes migration (2021 - 2022): planned and led the move of 40 services in six waves, with load tests and roll-back plans for each wave, and no customer-facing outage.", "Fraud-rules engine (2019): designed a rules engine in Go evaluating 120 rules in under 15 milliseconds, with rule changes deployable without a release.", "Merchant dashboard (2018): led the rebuild in React and Next.js; page loads fell from 6 seconds to under 1."],
  "x03-megan-accountant": ["Month-end close project (2021): mapped the close across 23 entities and cut it from nine to five working days.", "System migration (2022): moved the group from Pastel to Sage Intacct, including chart-of-accounts redesign and staff training.", "Acquisition due diligence (2023): led quality-of-earnings reviews for two targets."],
  "x04-nomvula-icu-nurse": ["Sepsis bundle project (2019 - 2020): trained 22 nurses and introduced a checklist; compliance rose from 58% to 91%.", "Central-line infection project (2018): audits and a care bundle reduced infections from 4.1 to 1.2 per 1,000 line days.", "Handover tool (2022): introduced structured handover, later adopted by three other units."],
  "x05-johan-civil": ["Water-treatment works upgrade (2019 - 2023): R480 million, from tender to commissioning, delivered 3% under budget.", "Bulk water network (2016 - 2018): 120 km network modelled in EPANET to size new pipelines and pump stations.", "Reservoir programme (2014 - 2016): designed four reinforced-concrete reservoirs to SANS 10100."],
  "x06-lerato-hr": ["Restructuring (2023): led the section 189 consultation for 85 roles with no unfair-dismissal findings.", "Performance management (2021): introduced quarterly reviews and calibration panels across three plants.", "Retention dashboard (2019): introduced exit interviews and monthly turnover reporting; voluntary turnover fell from 19% to 12%."],
};
for (const cv of CVS) {
  const extra = EARLIER[cv.id] ?? [], poor = cv.key.quality === "poor";
  const kind = RICH_KIND[cv.id];
  const at = cv.sections.findIndex((s) => /^(Education|Opleiding|Qualifications)$/.test(s.h ?? ""));
  const roles: Section[] = extra.map((e, i) => role(e.title, e.company, e.dates, poor ? pick(VAGUE, 7, 30 + i) : pick(POOLS[kind!], 5, 40 + i)));
  const projects: Section[] = PROJECTS[cv.id] ? [{ h: "Key projects", lines: PROJECTS[cv.id], bullets: true }] : [];
  const generic: Section[] = poor ? [{ h: "Duties and responsibilities (general)", lines: pick(VAGUE, 12, 50), bullets: true }] : [];
  cv.sections.splice(at < 0 ? cv.sections.length : at, 0, ...roles, ...projects, ...generic);
  cv.key.roles.push(...extra.map((e) => ({ title: e.title, company: e.company, start: e.start, end: e.end })));
}

// the last sections long South African CVs commonly carry
const HIGHLIGHTS: Record<string, { highlights: string; detail: string[] }> = {
  "x03-megan-accountant": { highlights: "Over eleven years I have moved from audit trainee to running the finance function of a group with 23 subsidiaries. In audit I led engagements for listed clients and audit committees; in industry I own the group's reporting, tax compliance, treasury forecasting and the finance systems. I combine technical IFRS depth with a practical focus on faster, cleaner month-ends and well-trained teams.", detail: ["Financial reporting: IFRS 9, 15 and 16, group consolidations, integrated reporting", "Tax: corporate income tax, provisional tax, VAT, transfer-pricing documentation", "Audit: risk-based audit methodology, internal controls, audit-committee reporting", "Systems: Sage Intacct, Pastel, Caseware, advanced Excel, Power BI", "Leadership: teams of up to eight, training programmes for trainees"] },
  "x05-johan-civil": { highlights: "Fifteen years in water infrastructure have taken me from candidate engineer on site to associate leading a water team. I have designed reservoirs, pipelines and pump stations, administered contracts worth hundreds of millions of rand, and mentored candidate engineers to professional registration. Clients value my clear reporting on cost, programme and risk.", detail: ["Design: reinforced concrete (SANS 10100), loading (SANS 10160), pipelines and pump stations", "Hydraulics: EPANET network modelling, surge analysis with specialists", "Contracts: GCC 2015, NEC3, claims and variations, tender evaluation", "Software: Civil 3D, Prokon, EPANET, MS Project, Excel", "Management: teams of up to nine, steering-committee reporting, mentoring candidates"] },
};
const MOTIVATION = "I am writing to apply for a position in your company. I believe that my experience and my passion make me a suitable candidate. Throughout my career I have always worked hard and given my best, and I have learned a lot from every job I have done. I am a team player but I can also work on my own without supervision. I am always willing to learn and grow, and I adapt quickly to new environments. I am punctual, reliable and honest, and I treat everyone with respect. I am confident that I can make a positive contribution to your team and I would welcome the opportunity to discuss my application with you. Thank you for your time and consideration.";
for (const cv of CVS) {
  const h = HIGHLIGHTS[cv.id];
  if (h) cv.sections.splice(2, 0, { h: "Career highlights", lines: [h.highlights] }, { h: "Skills in detail", lines: h.detail, bullets: true });
  if (cv.key.quality === "poor") cv.sections.push(
    { h: "Motivation", lines: [MOTIVATION, "In my free time I like to read and improve myself. I believe in hard work and I never give up. My family and my faith keep me grounded and motivated. I see every challenge as an opportunity to learn."] },
    { h: "Strengths and weaknesses", lines: ["Strengths: hard working, honest, reliable, punctual, team player, good communicator, fast learner, works well under pressure.", "Weaknesses: I sometimes take on too much work because I want to help everyone."] },
    { h: "Computer literacy", lines: ["MS Word: good", "MS Excel: good", "MS PowerPoint: average", "Outlook: good", "Internet and email: excellent"], bullets: true },
  );
}
