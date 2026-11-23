// What long invented CVs are written from: working knowledge of each profession, written out by hand so a document reads like a person's career and not a list of fields.
// Every skill has sentences in which it is used for real (some without using its name, as people write), so what a CV shows of each skill is known for certain: described in work, only listed, denied, or absent.
export interface Skill { name: string; used: string[]; ownWords?: string[] }
export interface Project { name: string; story: string }
export interface Profession {
  family: string; adjacent: string[]; ladder: string[]; sectors: string[]; skills: Skill[]; duties: string[]; wins: string[]; projects: Project[];
  degrees: string[]; certs: string[]; courses: string[]; memberships: string[]; jobs: { title: string; must: string[]; nice: string[]; years: number; qualification: string }[];
}

export const PROFESSIONS: Profession[] = [
  {
    family: "software", adjacent: ["data", "cloud", "security"], ladder: ["Junior Java Developer", "Java Developer", "Senior Java Engineer", "Lead Software Engineer", "Principal Engineer"], sectors: ["retail banking", "short-term insurance", "online retail", "telecommunications"],
    skills: [
      { name: "Java", used: ["Built and maintained payment services in Java 17, including the settlement batch that closes every business day.", "Rewrote a legacy Java 8 claims module, separating the rules from the persistence code so each could be tested alone."] },
      { name: "Spring Boot", used: ["Delivered eleven Spring Boot services behind the customer onboarding journey, each with its own health checks and metrics.", "Moved shared configuration into Spring Boot starters so new services began from one tested baseline."] },
      { name: "Kafka", used: ["Designed the Kafka topics carrying policy events, with partition keys chosen so one policy's events stayed in order.", "Diagnosed consumer lag on a Kafka cluster during month end and introduced back-pressure before the database."] },
      { name: "PostgreSQL", used: ["Tuned PostgreSQL queries on a 900 million row ledger table, replacing sequential scans with partial indexes.", "Planned and ran the PostgreSQL 12 to 15 upgrade with under four minutes of downtime."] },
      { name: "Kubernetes", used: ["Packaged services for Kubernetes and wrote the readiness probes and resource limits for each one.", "Reduced failed Kubernetes rollouts by adding a canary stage that watched error rates before promotion."] },
      { name: "Docker", used: ["Reduced Docker image sizes from 900 MB to 140 MB with layered builds and a distroless base."] },
      { name: "React", used: ["Built the internal case-management screens in React, working with two designers and the operations team."] },
      { name: "REST API design", used: ["Published versioned REST APIs for partner integrations, with contract tests run in each partner's pipeline."], ownWords: ["Wrote the HTTP interfaces our partners call, agreeing resource names and error formats with each of them before any code."] },
      { name: "Microservices", used: ["Split a monolithic billing application into six microservices along the lines of the finance team's own processes."] },
      { name: "CI/CD", used: ["Owned the CI/CD pipelines in GitLab, bringing a release from a two-day manual exercise to under thirty minutes."], ownWords: ["Automated building, testing and deploying every change, so a developer could release safely without the operations team."] },
      { name: "JUnit", used: ["Introduced JUnit 5 and Testcontainers across the team, raising meaningful test coverage on the payments module from 34 to 81 percent."] },
      { name: "AWS", used: ["Migrated the document-store workload onto AWS, using S3 lifecycle rules to halve storage costs."] },
    ],
    duties: ["Led code reviews and held weekly design sessions with five engineers.", "Worked with business analysts to turn regulatory changes into small releases.", "Took a turn on the on-call roster and wrote the runbooks used during incidents.", "Mentored two graduate developers through their first production releases.", "Prepared technical input for vendor evaluations and estimates for the steering committee.", "Investigated production incidents with the support team and wrote blameless reviews afterwards.", "Kept the architecture decision records current and presented changes to the architecture forum.", "Replaced manual reconciliation scripts with monitored scheduled jobs.", "Worked directly with the fraud team to shorten the time from a rule change to production.", "Assessed open-source libraries for licensing and security before they were adopted."],
    wins: ["Reduced average API response time by {p} percent during peak trading.", "Cut production incidents from {n} a quarter to fewer than five.", "Delivered the regulatory reporting release {n} weeks ahead of the statutory deadline.", "Saved roughly R{m} million a year by retiring two licensed middleware products."],
    projects: [
      { name: "Instant payments rebuild", story: "The bank's instant payments platform could not meet the new clearing house availability target. I led the team that separated authorisation from settlement, introduced idempotent processing and ran both platforms side by side for eleven weeks, reconciling every transaction daily before the old platform was switched off." },
      { name: "Claims straight-through processing", story: "Motor claims under a set value waited days for a person to review them. Working with claims assessors we mapped which decisions were truly routine, encoded those rules and kept every other claim with a person. Roughly a third of claims then settled the same day, and complaints fell." },
      { name: "Retail checkout resilience", story: "Black Friday traffic had brought the checkout down two years running. We load tested with recorded traffic, added queues in front of the stock service and agreed degraded modes with the business. The following November the site stayed up through a peak four times the normal load." },
      { name: "Data centre exit", story: "A hosting contract was ending and forty applications had to move. I assessed each one, retired nine, rehosted the simple ones first, and worked with compliance on where customer data could lawfully be kept." },
    ],
    degrees: ["BSc Computer Science", "BEng Electronic Engineering", "National Diploma in Information Technology", "BSc Honours Computer Science"], certs: ["Oracle Certified Professional: Java SE Developer", "AWS Certified Developer Associate", "Certified Kubernetes Application Developer"], courses: ["Domain-Driven Design workshop", "Secure Coding in Java", "Agile Estimation and Planning", "Advanced PostgreSQL Performance"], memberships: ["Institute of Information Technology Professionals South Africa"],
    jobs: [{ title: "Senior Java Engineer", must: ["Java", "Spring Boot", "Kafka", "PostgreSQL"], nice: ["Kubernetes", "AWS"], years: 6, qualification: "BSc Computer Science" }, { title: "Full Stack Developer", must: ["Java", "React", "REST API design"], nice: ["Docker", "CI/CD"], years: 3, qualification: "National Diploma in Information Technology" }],
  },
  {
    family: "data", adjacent: ["software", "finance"], ladder: ["Junior Data Analyst", "Data Analyst", "Data Scientist", "Senior Data Scientist", "Head of Data Science"], sectors: ["retail banking", "mobile telecommunications", "health insurance", "grocery retail"],
    skills: [
      { name: "Python", used: ["Wrote Python pipelines to clean and join eight years of claims data for the actuarial team.", "Packaged reusable Python feature code so models shared one tested definition of each customer measure."] },
      { name: "SQL", used: ["Wrote and optimised SQL against the enterprise warehouse to build monthly customer views.", "Trained the business analysts in SQL window functions, reducing requests to the data team by a third."] },
      { name: "Machine learning", used: ["Built machine learning models that predicted early policy lapse, tested on a period the model had never seen."], ownWords: ["Trained gradient-boosted classifiers to rank customers by likelihood of leaving, and validated them on a later period."] },
      { name: "Power BI", used: ["Designed Power BI dashboards used weekly by forty branch managers, working from their actual questions."] },
      { name: "Spark", used: ["Moved a slow nightly aggregation onto Spark, taking it from seven hours to forty minutes."] },
      { name: "Statistics", used: ["Designed A/B tests with proper sample size calculations and reported confidence intervals rather than single figures."] },
      { name: "Azure Databricks", used: ["Set up Azure Databricks workspaces and access controls for a team of twelve analysts."] },
      { name: "Forecasting", used: ["Produced weekly demand forecasting for 1,400 grocery lines, comparing accuracy against the buyers' own estimates."] },
      { name: "Data governance", used: ["Wrote data governance standards with the privacy office, including who may see personal fields and for how long."] },
      { name: "R", used: ["Maintained survival models in R that the actuaries used for reserve estimates."] },
    ],
    duties: ["Met product owners every fortnight to agree which questions were worth answering.", "Explained model limits to the credit committee in plain language.", "Documented data sources and known defects in a shared catalogue.", "Reviewed colleagues' analyses before they reached decision makers.", "Worked with legal on the lawful use of customer data under POPIA.", "Monitored deployed models for drift and arranged retraining when accuracy fell.", "Recruited and mentored two analysts.", "Presented quarterly findings to the executive committee."],
    wins: ["Reduced lapse among targeted customers by {p} percent in a controlled trial.", "Lowered stock write-offs by R{m} million through better fresh-produce forecasts.", "Replaced {n} spreadsheets with one audited report."],
    projects: [
      { name: "Lapse prediction programme", story: "Retention calls went to whichever customers complained loudest. We built a model of who was likely to lapse, ran it against a holdout group for six months and showed the calls saved policies only when made before the second missed premium, which changed how the call centre was staffed." },
      { name: "Fresh produce forecasting", story: "Stores over-ordered perishable lines and wrote off the waste. Using weather, promotions and store history, we produced store-level forecasts and let buyers override them, recording each override so we could learn from where they were right." },
      { name: "Customer data foundation", story: "Six systems held six versions of each customer. I led the matching rules, agreed with the privacy office how long each field could be retained, and delivered a single customer table with a documented lineage." },
    ],
    degrees: ["BSc Statistics", "BCom Honours Econometrics", "MSc Data Science", "BSc Mathematics"], certs: ["Microsoft Certified: Azure Data Scientist Associate", "Databricks Certified Data Engineer Associate"], courses: ["Causal Inference in Practice", "Responsible AI Foundations", "Advanced SQL for Analysts"], memberships: ["South African Statistical Association"],
    jobs: [{ title: "Senior Data Scientist", must: ["Python", "SQL", "Machine learning", "Statistics"], nice: ["Spark", "Azure Databricks"], years: 5, qualification: "MSc Data Science" }, { title: "BI Analyst", must: ["SQL", "Power BI"], nice: ["Python", "Data governance"], years: 3, qualification: "BSc Statistics" }],
  },
  {
    family: "cloud", adjacent: ["software", "security"], ladder: ["Systems Administrator", "Infrastructure Engineer", "DevOps Engineer", "Senior Cloud Engineer", "Head of Platform"], sectors: ["financial services", "logistics", "mining group shared services", "e-commerce"],
    skills: [
      { name: "Terraform", used: ["Wrote Terraform modules for network, identity and compute so each new environment came from reviewed code."] },
      { name: "AWS", used: ["Ran production workloads across three AWS accounts, separating duties between development and operations."] },
      { name: "Azure", used: ["Designed the Azure landing zone, including hub-and-spoke networking and policy guardrails."] },
      { name: "Kubernetes", used: ["Operated Kubernetes clusters through upgrades with no customer-visible outage."] },
      { name: "Linux administration", used: ["Handled Linux administration for 300 servers, including patching windows agreed with each application owner."] },
      { name: "Ansible", used: ["Automated server configuration with Ansible, removing configuration drift found in the previous audit."] },
      { name: "Prometheus", used: ["Set up Prometheus and Grafana alerts based on what customers experience, cutting alert noise by two thirds."] },
      { name: "Incident management", used: ["Coordinated incident management during major outages and ran reviews that changed how we deploy."] },
    ],
    duties: ["Worked with auditors to evidence access controls and change records.", "Forecast cloud spend each month and agreed reductions with application teams.", "Kept disaster recovery plans current and ran two failover tests a year.", "Supported development teams moving applications to containers.", "Managed relationships with hosting and network suppliers.", "Maintained the on-call roster and escalation paths."],
    wins: ["Cut monthly cloud spend by {p} percent with no loss of capacity.", "Reduced environment build time from {n} days to under an hour.", "Brought recovery time for core systems down to under {n} minutes."],
    projects: [
      { name: "Landing zone and migration", story: "The group had grown cloud accounts by accident. I designed a single landing zone, moved seventy applications in phases, and agreed a shared-cost model with each business unit so nobody was surprised by the bill." },
      { name: "Disaster recovery rebuild", story: "A failed recovery test showed backups nobody had restored. We rebuilt recovery from code, tested it quarterly with the application owners present, and reported the actual recovery time to the risk committee." },
    ],
    degrees: ["BSc Information Systems", "National Diploma in Computer Systems Engineering", "BEng Computer Engineering"], certs: ["AWS Certified Solutions Architect Professional", "HashiCorp Certified Terraform Associate", "Red Hat Certified Engineer", "Microsoft Certified: Azure Administrator Associate"], courses: ["ITIL 4 Foundation", "Site Reliability Engineering Practices"], memberships: ["South African Institute of Computer Scientists and Information Technologists"],
    jobs: [{ title: "Senior DevOps Engineer", must: ["Terraform", "Kubernetes", "AWS"], nice: ["Ansible", "Prometheus"], years: 5, qualification: "BSc Information Systems" }],
  },
  {
    family: "finance", adjacent: ["audit", "data"], ladder: ["Trainee Accountant", "Financial Accountant", "Senior Financial Accountant", "Financial Manager", "Chief Financial Officer"], sectors: ["manufacturing", "property development", "wholesale distribution", "agriculture"],
    skills: [
      { name: "IFRS", used: ["Prepared annual financial statements under IFRS, including the first application of the revenue and lease standards.", "Advised the operations team on how IFRS treated long-term customer rebates."] },
      { name: "General ledger", used: ["Owned the general ledger for three legal entities, including the chart of accounts redesign."] },
      { name: "Reconciliations", used: ["Performed monthly bank and intercompany reconciliations and cleared items aged over ninety days."], ownWords: ["Matched supplier statements and bank accounts to the ledger each month and followed up every difference."] },
      { name: "SAP FI", used: ["Led finance's part of the SAP FI implementation, including migration of open items and user training."] },
      { name: "Budgeting", used: ["Coordinated the annual budgeting cycle across eleven cost centres and challenged assumptions with each manager."] },
      { name: "Excel", used: ["Built Excel models for scenario planning, later reviewed by the external auditors."] },
      { name: "Tax compliance", used: ["Handled tax compliance including VAT, PAYE and provisional tax submissions, and managed SARS queries."] },
      { name: "Cash flow forecasting", used: ["Produced a rolling thirteen-week cash flow forecast the treasury team used to manage facilities."] },
      { name: "Management reporting", used: ["Delivered monthly management reporting packs to the board within five working days."] },
      { name: "Sage", used: ["Ran month end on Sage for the smaller subsidiaries and wrote the procedures their bookkeepers followed."] },
    ],
    duties: ["Supervised a team of four creditors and debtors clerks.", "Coordinated the year-end audit and resolved queries with the audit manager.", "Reviewed fixed asset registers and depreciation.", "Maintained internal controls over payments and supplier changes.", "Prepared board papers on funding and capital expenditure.", "Worked with banks on covenant reporting.", "Wrote finance policies and ran training for budget holders."],
    wins: ["Shortened month end from {n} days to five.", "Recovered R{m} million through a review of supplier overpayments.", "Delivered {n} consecutive unqualified audits.", "Reduced overdue debtors by {p} percent in twelve months."],
    projects: [
      { name: "ERP finance migration", story: "The group replaced an ageing accounting package with SAP. I led the finance workstream, cleaned the opening balances, ran three trial conversions, and stayed with the shared-services team through the first two month ends when most issues appeared." },
      { name: "Refinancing and covenant review", story: "With a term loan maturing in a weak market, I prepared the forecasts and scenario analysis for three lenders, negotiated covenant definitions with our attorneys, and closed the refinancing two months before the maturity date." },
      { name: "Shared services centre", story: "Five subsidiaries each processed their own creditors. We consolidated them into one centre, standardised approval limits and retrained or redeployed the staff affected." },
    ],
    degrees: ["BCom Accounting", "BCom Honours Accounting", "BAcc", "Master of Commerce in Financial Management"], certs: ["Chartered Accountant (SA)", "Professional Accountant (SA)", "SAIPA Tax Practitioner"], courses: ["IFRS 16 Leases Update", "Advanced Excel for Finance", "Treasury Fundamentals"], memberships: ["South African Institute of Chartered Accountants", "South African Institute of Professional Accountants"],
    jobs: [{ title: "Financial Manager", must: ["IFRS", "Budgeting", "Management reporting", "Tax compliance"], nice: ["SAP FI", "Cash flow forecasting"], years: 7, qualification: "BCom Accounting" }, { title: "Financial Accountant", must: ["General ledger", "Reconciliations", "IFRS", "Excel"], nice: ["Sage"], years: 3, qualification: "BCom Accounting" }],
  },
  {
    family: "audit", adjacent: ["finance"], ladder: ["Audit Clerk", "Audit Senior", "Internal Auditor", "Audit Manager", "Head of Internal Audit"], sectors: ["public sector", "banking", "mining", "audit practice"],
    skills: [
      { name: "Internal audit", used: ["Planned and led internal audit reviews of procurement, payroll and IT access across nine sites."] },
      { name: "Risk assessment", used: ["Carried out the annual risk assessment with business heads and turned it into the three-year audit plan."] },
      { name: "ISA standards", used: ["Applied ISA standards on statutory engagements, and reviewed juniors' working papers against them."] },
      { name: "Fraud investigation", used: ["Led a fraud investigation into fictitious suppliers, working with forensics and the police."] },
      { name: "CaseWare", used: ["Built the firm's CaseWare templates for manufacturing clients, reducing repeated review notes."] },
      { name: "King IV", used: ["Advised the audit committee on applying King IV, including how combined assurance should be reported."] },
      { name: "Data analytics for audit", used: ["Used ACL scripts to test every payment rather than a sample, which surfaced duplicate payments."] },
    ],
    duties: ["Presented findings to the audit committee each quarter.", "Followed up management actions and escalated overdue items.", "Trained trainee accountants on working paper quality.", "Agreed findings with process owners before reports were issued.", "Coordinated reliance with external auditors."],
    wins: ["Identified R{m} million in recoverable duplicate payments.", "Closed {n} long-overdue audit findings in one year."],
    projects: [
      { name: "Procurement fraud review", story: "A whistleblower reported irregular awards at one regional office. I led the review, traced supplier bank details against employee records, preserved evidence with forensic specialists, and reported to the audit committee. Recommendations changed how new suppliers were verified across the group." },
      { name: "Combined assurance map", story: "Management, compliance and audit were each testing the same controls and missing others. I mapped who gave assurance over what and presented the gaps to the board's risk committee." },
    ],
    degrees: ["BCom Auditing", "BCom Honours Accounting", "BCom Internal Auditing"], certs: ["Certified Internal Auditor", "Registered Auditor (IRBA)", "Certified Fraud Examiner"], courses: ["Forensic Interviewing", "IT General Controls for Auditors"], memberships: ["Institute of Internal Auditors South Africa"],
    jobs: [{ title: "Internal Audit Manager", must: ["Internal audit", "Risk assessment", "King IV"], nice: ["Fraud investigation", "Data analytics for audit"], years: 7, qualification: "BCom Auditing" }],
  },
  {
    family: "hr", adjacent: ["recruitment"], ladder: ["HR Administrator", "HR Officer", "HR Business Partner", "Senior HR Business Partner", "HR Director"], sectors: ["mining", "hospitality", "retail", "manufacturing"],
    skills: [
      { name: "Labour Relations Act", used: ["Advised line managers on the Labour Relations Act during restructuring, including section 189 consultations."] },
      { name: "Disciplinary hearings", used: ["Chaired disciplinary hearings and prepared the employer's case at the CCMA."], ownWords: ["Ran formal misconduct enquiries and represented the company when dismissals were referred for conciliation."] },
      { name: "Performance management", used: ["Rolled out a performance management cycle for 2,400 staff, including calibration sessions with executives."] },
      { name: "Employment equity", used: ["Prepared employment equity plans and reports, and chaired the consultative forum."] },
      { name: "Talent acquisition", used: ["Ran talent acquisition for senior and specialist roles, working with search firms and hiring managers."] },
      { name: "SAP SuccessFactors", used: ["Led HR's rollout of SAP SuccessFactors, including data clean-up and manager training."] },
      { name: "Remuneration benchmarking", used: ["Led annual remuneration benchmarking using market surveys, and presented the increase mandate to the remuneration committee."] },
      { name: "Skills development", used: ["Compiled workplace skills plans and managed learnerships with the SETA."] },
      { name: "Payroll administration", used: ["Oversaw payroll administration for four sites, resolving discrepancies with the payroll bureau."] },
    ],
    duties: ["Partnered with general managers on organisation design.", "Handled grievances and mediated between staff and supervisors.", "Coordinated wage negotiations with union representatives.", "Managed employee wellness programmes.", "Reported HR measures to the executive committee monthly.", "Supervised two HR officers and an administrator."],
    wins: ["Reduced staff turnover by {p} percent over two years.", "Concluded {n} wage agreements without industrial action.", "Reduced CCMA referrals by {p} percent through better manager training."],
    projects: [
      { name: "Section 189 restructuring", story: "Falling commodity prices forced a restructure at two shafts. I prepared the section 189 notices with counsel, led consultations with three unions, and designed voluntary severance and reskilling options. The process closed without a strike and with far fewer forced retrenchments than first proposed." },
      { name: "HR system rollout", story: "Personnel files were in four systems and many paper cabinets. I led the move to one HR platform, including verifying records with each employee and training managers to use self-service." },
    ],
    degrees: ["BCom Human Resource Management", "BA Industrial Psychology", "BCom Honours Labour Relations", "National Diploma in Human Resource Management"], certs: ["SABPP Chartered HR Professional", "Registered Industrial Psychologist (HPCSA)"], courses: ["Chairing Disciplinary Hearings", "Employment Equity Compliance", "Coaching for Managers"], memberships: ["South African Board for People Practices"],
    jobs: [{ title: "HR Business Partner", must: ["Labour Relations Act", "Performance management", "Employment equity"], nice: ["SAP SuccessFactors", "Disciplinary hearings"], years: 6, qualification: "BCom Human Resource Management" }, { title: "HR Officer", must: ["Disciplinary hearings", "Payroll administration"], nice: ["Skills development"], years: 2, qualification: "National Diploma in Human Resource Management" }],
  },
  {
    family: "civil", adjacent: ["project", "mechanical"], ladder: ["Graduate Civil Engineer", "Civil Engineer", "Senior Civil Engineer", "Principal Engineer", "Technical Director"], sectors: ["roads and bridges", "water infrastructure", "residential development", "mining infrastructure"],
    skills: [
      { name: "Structural design", used: ["Carried out structural design of reinforced concrete reservoirs and pump stations to SANS codes."] },
      { name: "Civil 3D", used: ["Modelled road alignments and stormwater in Civil 3D, coordinating drawings with surveyors."] },
      { name: "Contract administration", used: ["Acted as engineer's representative on FIDIC contracts, assessing claims and payment certificates."] },
      { name: "Site supervision", used: ["Led site supervision for a R400 million road upgrade, including quality checks on earthworks and layers."] },
      { name: "Geotechnical assessment", used: ["Commissioned and interpreted geotechnical assessment reports for dam foundations."] },
      { name: "Stormwater design", used: ["Designed stormwater networks for a 1,200-unit township and obtained municipal approval."] },
      { name: "PRINCE2", used: ["Ran design stages using PRINCE2 controls required by the provincial client."] },
    ],
    duties: ["Prepared tender documents and bills of quantities.", "Chaired monthly site meetings and issued minutes.", "Reviewed contractors' method statements and safety files.", "Liaised with municipalities and environmental consultants.", "Mentored candidate engineers toward professional registration.", "Inspected completed works before handover."],
    wins: ["Delivered a bridge rehabilitation {n} weeks early and under budget.", "Reduced water losses by {p} percent in the distribution zone."],
    projects: [
      { name: "N-route interchange upgrade", story: "Traffic had to keep moving throughout. We staged the works in six phases, built temporary deviations, coordinated service relocations with Eskom and Telkom, and held weekly safety walks with the contractor. The interchange opened to traffic with no serious injuries over thirty-one months." },
      { name: "Regional bulk water pipeline", story: "A 42 km steel pipeline crossed farmland, a river and a railway. I led route selection with landowners, dealt with unexpected rock on the second section, and reported cost changes to the water board's technical committee monthly." },
    ],
    degrees: ["BEng Civil Engineering", "BSc Engineering (Civil)", "MEng Structural Engineering"], certs: ["Professional Engineer (ECSA)", "Government Certificate of Competency", "PRINCE2 Practitioner"], courses: ["FIDIC Contracts in Practice", "Pavement Design", "Construction Health and Safety Regulations"], memberships: ["South African Institution of Civil Engineering"],
    jobs: [{ title: "Senior Civil Engineer", must: ["Structural design", "Contract administration", "Site supervision"], nice: ["Civil 3D", "Stormwater design"], years: 8, qualification: "BEng Civil Engineering" }],
  },
  {
    family: "mechanical", adjacent: ["civil", "artisan"], ladder: ["Engineer in Training", "Mechanical Engineer", "Senior Mechanical Engineer", "Maintenance Manager", "Engineering Manager"], sectors: ["gold mining", "sugar milling", "petrochemicals", "cement production"],
    skills: [
      { name: "Maintenance planning", used: ["Led maintenance planning for crushers and mills, moving tasks from breakdown to planned shutdowns."] },
      { name: "SAP PM", used: ["Set up equipment hierarchies and work orders in SAP PM for a plant of 2,800 tagged items."] },
      { name: "Root cause analysis", used: ["Led root cause analysis after repeated gearbox failures, tracing them to lubrication practice."] },
      { name: "SolidWorks", used: ["Designed replacement chute liners in SolidWorks and supervised fabrication."] },
      { name: "Pressure Equipment Regulations", used: ["Managed compliance with the Pressure Equipment Regulations including statutory inspections."] },
      { name: "Mine Health and Safety Act", used: ["Held a section 16.2 appointment and applied the Mine Health and Safety Act on engineering work."] },
      { name: "Vibration analysis", used: ["Introduced vibration analysis on critical fans, catching bearing faults weeks before failure."] },
    ],
    duties: ["Managed artisans and foremen across three shifts.", "Controlled the engineering capital and maintenance budgets.", "Developed shutdown schedules with production.", "Reviewed contractors' safety files and permits.", "Held daily maintenance meetings with planners."],
    wins: ["Raised plant availability from 84 to {p} percent.", "Reduced maintenance cost per ton by {p} percent."],
    projects: [
      { name: "Mill relining shutdown", story: "The relining shutdown routinely overran and cost production. I rebuilt the plan hour by hour with contractors, prefabricated parts in advance and ran daily reviews, finishing thirty hours ahead of the previous best with no lost-time injuries." },
      { name: "Conveyor reliability programme", story: "Conveyor belts were failing without warning. We introduced inspection routes, thermal scans and a splice standard, and moved to replacing belts on condition instead of after they failed." },
    ],
    degrees: ["BEng Mechanical Engineering", "BTech Mechanical Engineering", "National Diploma in Mechanical Engineering"], certs: ["Government Certificate of Competency (Mechanical)", "Professional Engineer (ECSA)", "Certified Maintenance and Reliability Professional"], courses: ["Reliability Centred Maintenance", "Mine Engineering Legislation"], memberships: ["South African Institution of Mechanical Engineering"],
    jobs: [{ title: "Maintenance Manager", must: ["Maintenance planning", "SAP PM", "Root cause analysis"], nice: ["Vibration analysis", "Mine Health and Safety Act"], years: 8, qualification: "BEng Mechanical Engineering" }],
  },
  {
    family: "nursing", adjacent: ["medical"], ladder: ["Enrolled Nurse", "Registered Nurse", "Professional Nurse", "Senior Professional Nurse", "Nursing Services Manager"], sectors: ["private hospital", "provincial hospital", "primary health clinic", "occupational health"],
    skills: [
      { name: "Critical care nursing", used: ["Provided critical care nursing in a twelve-bed ICU, including ventilated and post-cardiac surgery patients."] },
      { name: "Patient assessment", used: ["Performed patient assessment on admission and escalated deterioration using the early warning score."] },
      { name: "Medication administration", used: ["Managed medication administration and schedule 5 and 6 registers according to policy."] },
      { name: "Infection control", used: ["Acted as infection control link nurse, auditing hand hygiene and leading outbreak response on the ward."] },
      { name: "Wound care", used: ["Led wound care for chronic and post-surgical patients, training staff in dressing selection."] },
      { name: "Primary health care", used: ["Ran primary health care clinics with authority to dispense under section 56(6)."] },
      { name: "HIV management", used: ["Initiated and monitored antiretroviral treatment as part of NIMART-trained HIV management."] },
    ],
    duties: ["Supervised a shift of nine nurses and allocated patients by acuity.", "Trained student nurses during their clinical placements.", "Took part in morbidity and mortality reviews.", "Spoke with families during difficult diagnoses.", "Maintained accurate clinical records.", "Audited crash trolleys and emergency equipment."],
    wins: ["Reduced ward infections by {p} percent over a year.", "Led the unit through {n} successful accreditation surveys."],
    projects: [
      { name: "Falls prevention", story: "Falls among older patients were rising on our medical ward. I led an audit of incidents with physiotherapists, introduced a risk tool and changed night rounds. Falls dropped significantly within a year and the approach was adopted by two other wards." },
      { name: "Outbreak response", story: "During a resistant infection outbreak I worked with the microbiologist to isolate patients, retrain staff and track cases daily until the unit reopened." },
    ],
    degrees: ["Bachelor of Nursing", "Diploma in General Nursing", "Postgraduate Diploma in Critical Care Nursing"], certs: ["SANC Registered Nurse", "Advanced Cardiac Life Support", "NIMART"], courses: ["Basic Life Support Instructor", "Palliative Care Fundamentals"], memberships: ["South African Nursing Council", "Critical Care Society of Southern Africa"],
    jobs: [{ title: "ICU Professional Nurse", must: ["Critical care nursing", "Patient assessment", "Medication administration"], nice: ["Infection control"], years: 4, qualification: "Postgraduate Diploma in Critical Care Nursing" }],
  },
  {
    family: "legal", adjacent: ["hr"], ladder: ["Candidate Attorney", "Attorney", "Senior Associate", "Legal Counsel", "Director"], sectors: ["commercial law firm", "banking group legal", "mining group legal", "state attorney's office"],
    skills: [
      { name: "Commercial contract drafting", used: ["Drafted and negotiated supply, distribution and software agreements for listed clients."] },
      { name: "Litigation", used: ["Ran High Court litigation including urgent applications and instructing counsel."] },
      { name: "Companies Act", used: ["Advised boards on directors' duties and Companies Act compliance during restructures."] },
      { name: "POPIA compliance", used: ["Led POPIA compliance projects, including information officer duties and operator agreements."] },
      { name: "Conveyancing", used: ["Handled conveyancing of commercial property, including sectional title and bond registration."] },
      { name: "Labour law", used: ["Represented employers in labour law disputes before the CCMA and Labour Court."] },
    ],
    duties: ["Managed a matter list of about forty files.", "Supervised candidate attorneys.", "Advised executives on regulatory enquiries.", "Reviewed tender documents for legal risk.", "Prepared board resolutions and minutes."],
    wins: ["Secured dismissal of a R{m} million claim.", "Reduced average contract turnaround by {p} percent."],
    projects: [
      { name: "Group POPIA programme", story: "With eleven subsidiaries holding customer data in different ways, I led the mapping of personal information, rewrote the privacy notices, negotiated operator agreements with main suppliers and trained staff before the compliance date." },
      { name: "Cross-border acquisition", story: "Our client acquired a business in two neighbouring countries. I coordinated local counsel, led due diligence, negotiated warranties and handled Competition Commission filings." },
    ],
    degrees: ["LLB", "BCom Law", "LLM Commercial Law"], certs: ["Admitted Attorney of the High Court", "Conveyancer", "Notary Public"], courses: ["Competition Law", "Advanced Negotiation"], memberships: ["Legal Practice Council", "Law Society of South Africa"],
    jobs: [{ title: "Legal Counsel", must: ["Commercial contract drafting", "Companies Act", "POPIA compliance"], nice: ["Litigation"], years: 5, qualification: "LLB" }],
  },
  {
    family: "teaching", adjacent: ["academic"], ladder: ["Assistant Teacher", "Teacher", "Senior Teacher", "Head of Department", "Deputy Principal"], sectors: ["public high school", "independent school", "further education college", "primary school"],
    skills: [
      { name: "CAPS curriculum", used: ["Planned lessons and assessments in line with the CAPS curriculum for Grades 10 to 12."] },
      { name: "Mathematics teaching", used: ["Taught Mathematics to matric classes, raising the pass rate over three years."] },
      { name: "Classroom management", used: ["Developed classroom management routines that were adopted across the grade."] },
      { name: "Learner assessment", used: ["Moderated learner assessment across the department and analysed results with teachers."] },
      { name: "Curriculum development", used: ["Led curriculum development for a new Grade 9 mathematical literacy bridging course."] },
      { name: "Google Classroom", used: ["Moved the department onto Google Classroom during school closures and trained colleagues."] },
    ],
    duties: ["Held parent meetings each term.", "Coached the debating team and accompanied tours.", "Mentored newly qualified teachers.", "Served on the school governing body.", "Coordinated extra lessons for struggling learners."],
    wins: ["Raised the matric Mathematics pass rate from 61 to {p} percent.", "Led the department to {n} district awards."],
    projects: [
      { name: "Mathematics recovery programme", story: "Many Grade 10 learners arrived years behind. I designed a term-long recovery programme using diagnostic tests, small groups and peer tutors from Grade 12, and tracked each learner's progress. Pass rates in that cohort rose significantly by matric." },
    ],
    degrees: ["Bachelor of Education", "BSc with PGCE", "Advanced Certificate in Education"], certs: ["SACE Registered Educator"], courses: ["Inclusive Education", "Assessment Literacy"], memberships: ["South African Council for Educators"],
    jobs: [{ title: "Head of Department: Mathematics", must: ["Mathematics teaching", "CAPS curriculum", "Learner assessment"], nice: ["Curriculum development"], years: 7, qualification: "Bachelor of Education" }],
  },
  {
    family: "supply", adjacent: ["project", "sales"], ladder: ["Procurement Clerk", "Buyer", "Procurement Specialist", "Supply Chain Manager", "Head of Supply Chain"], sectors: ["FMCG manufacturing", "automotive components", "retail distribution", "pharmaceutical wholesale"],
    skills: [
      { name: "Strategic sourcing", used: ["Ran strategic sourcing events for packaging and logistics, including market analysis and supplier negotiation."] },
      { name: "SAP MM", used: ["Maintained purchase orders and contracts in SAP MM and led cleaning of the material master."] },
      { name: "Inventory management", used: ["Led inventory management across three warehouses, setting reorder levels by item class."] },
      { name: "Supplier negotiation", used: ["Led supplier negotiation on annual contracts of R300 million, agreeing price, service and penalty terms."] },
      { name: "B-BBEE procurement", used: ["Managed B-BBEE procurement targets and supplier development funding."] },
      { name: "Logistics planning", used: ["Led logistics planning for national distribution, including carrier contracts and route changes."] },
    ],
    duties: ["Reported savings and stock measures to the executive monthly.", "Managed a team of six buyers.", "Audited supplier performance quarterly.", "Worked with quality on supplier non-conformances.", "Handled import documentation with clearing agents."],
    wins: ["Saved R{m} million through consolidating suppliers.", "Reduced stock holding by {p} percent without lowering service."],
    projects: [
      { name: "Supplier consolidation", story: "Over 900 suppliers were active for indirect spend. I analysed the spend, ran competitive events and moved most of it to about 120 approved suppliers, while funding two small black-owned suppliers through development." },
    ],
    degrees: ["BCom Supply Chain Management", "National Diploma in Logistics", "BCom Honours Logistics"], certs: ["CIPS Diploma", "APICS CSCP"], courses: ["Incoterms 2020", "Category Management"], memberships: ["Chartered Institute of Procurement and Supply", "SAPICS"],
    jobs: [{ title: "Supply Chain Manager", must: ["Strategic sourcing", "Inventory management", "Supplier negotiation"], nice: ["SAP MM", "B-BBEE procurement"], years: 7, qualification: "BCom Supply Chain Management" }],
  },
  {
    family: "project", adjacent: ["civil", "supply", "software"], ladder: ["Project Coordinator", "Project Manager", "Senior Project Manager", "Programme Manager", "Head of Delivery"], sectors: ["telecommunications rollout", "banking change", "construction", "public sector digital"],
    skills: [
      { name: "Project management", used: ["Led project management of a R60 million branch refit, from business case through handover."] },
      { name: "MS Project", used: ["Built and maintained integrated schedules in MS Project across five workstreams."] },
      { name: "Stakeholder management", used: ["Led stakeholder management with unions, regulators and executives during a difficult rollout."] },
      { name: "Risk management", used: ["Ran risk management sessions weekly, and owned the register reported to the steering committee."] },
      { name: "Agile delivery", used: ["Coached three teams in Agile delivery, with fortnightly demonstrations to the business."] },
      { name: "Budget control", used: ["Took responsibility for budget control and monthly forecasting against a R120 million programme."] },
    ],
    duties: ["Chaired steering committees and prepared status reports.", "Agreed scope changes with sponsors.", "Managed supplier contracts and milestones.", "Ran lessons-learned sessions at project close.", "Planned cutover weekends and rollback."],
    wins: ["Delivered the programme {n} weeks ahead of the regulatory deadline.", "Recovered a failing project and brought it back within {p} percent of budget."],
    projects: [
      { name: "Fibre rollout programme", story: "We had to connect 40,000 homes across two metros with contractors of uneven quality. I set up weekly production tracking, resolved wayleave delays with municipalities, and replaced two contractors whose quality was failing, without missing the funder's milestones." },
      { name: "Core banking change", story: "Changing the core platform affected every channel. I ran an integrated plan across eleven teams, set clear go/no-go criteria, and ran three dress rehearsals before the cutover weekend." },
    ],
    degrees: ["BCom Management", "BSc Project Management", "Postgraduate Diploma in Project Management", "BTech Engineering"], certs: ["Project Management Professional (PMP)", "PRINCE2 Practitioner", "Certified ScrumMaster"], courses: ["Earned Value Management", "Leading Change"], memberships: ["Project Management South Africa"],
    jobs: [{ title: "Senior Project Manager", must: ["Project management", "Risk management", "Stakeholder management", "Budget control"], nice: ["MS Project", "Agile delivery"], years: 7, qualification: "Postgraduate Diploma in Project Management" }],
  },
  {
    family: "marketing", adjacent: ["sales"], ladder: ["Marketing Assistant", "Marketing Coordinator", "Brand Manager", "Marketing Manager", "Marketing Director"], sectors: ["consumer goods", "financial services", "hospitality", "private education"],
    skills: [
      { name: "Brand management", used: ["Led brand management for a R400 million snack range, including repositioning and packaging."] },
      { name: "Digital marketing", used: ["Ran digital marketing campaigns across search and social, reporting cost per acquisition weekly."] },
      { name: "Google Analytics", used: ["Set up Google Analytics goals and taught regional teams to read them."] },
      { name: "Market research", used: ["Commissioned market research and focus groups, then presented what it meant for pricing."] },
      { name: "Content strategy", used: ["Wrote the content strategy for the group's digital channels, including an editorial calendar."] },
      { name: "HubSpot", used: ["Moved lead nurturing into HubSpot and built scoring with the sales team."] },
    ],
    duties: ["Managed agency relationships and briefs.", "Controlled a marketing budget of R30 million.", "Coordinated trade promotions with sales.", "Approved advertising against ASA rules."],
    wins: ["Grew brand share by {p} percent over two years.", "Reduced cost per lead by {p} percent."],
    projects: [
      { name: "Range relaunch", story: "Sales of a heritage range were declining among younger buyers. I commissioned research, worked with design on new packaging, ran a test market in KwaZulu-Natal, and then rolled out nationally with retailers." },
    ],
    degrees: ["BCom Marketing", "Diploma in Marketing Management", "BA Communication"], certs: ["Google Ads Certification", "HubSpot Inbound Certification"], courses: ["Consumer Behaviour", "Trade Marketing"], memberships: ["Marketing Association of South Africa"],
    jobs: [{ title: "Marketing Manager", must: ["Brand management", "Digital marketing", "Market research"], nice: ["HubSpot"], years: 6, qualification: "BCom Marketing" }],
  },
];

// Things that fill a real long CV and are not about any one profession: they keep it honest as a test, because a reader must not mistake them for the person's own skills or contact details.
export const GENERAL_DUTIES = ["Attended the monthly management meeting and reported on progress against plan.", "Took part in the company's safety and wellness committee for two years.", "Helped induct new starters and explained how the department worked.", "Contributed to the annual business planning cycle.", "Represented the department on a cross-functional process improvement team.", "Prepared reports for internal and external audit when required.", "Managed leave schedules and cover during peak periods.", "Supported the transformation committee's work on skills and supplier development.", "Answered escalations from clients and senior managers.", "Kept records according to the company's retention policy.", "Drafted and updated standard operating procedures.", "Volunteered for the company's school mentorship programme."];
export const REASONS_FOR_LEAVING = ["Career progression", "Offered a more senior position", "Company restructured and the division closed", "Relocated for family reasons", "Contract ended", "Sought wider exposure"];
export const COMPANY_WORDS = { first: ["Meridian", "Thornbury", "Kagiso", "Umhlanga", "Protea", "Baobab", "Silverton", "Greenpoint", "Ikhaya", "Sable", "Highveld", "Cape Union", "Marula", "Lethabo", "Northern Cross", "Bluewater", "Ridgeway", "Ubuntu", "Karoo", "Summit"], last: ["Holdings", "Group", "Partners", "Industries", "Consulting", "Solutions", "Services", "Africa", "(Pty) Ltd", "Corporation"] };
export const PEOPLE = {
  first: ["Thandiwe", "Sipho", "Lerato", "Johan", "Priya", "Michael", "Nomsa", "Pieter", "Aisha", "David", "Zanele", "Rajesh", "Fatima", "Tshepo", "Anele", "Claire", "Bongani", "Naledi", "Ruan", "Yusuf", "Karabo", "Megan", "Themba", "Refilwe", "Gareth", "Noluthando", "Imraan", "Sarah", "Lwazi", "Chantal"],
  last: ["Dlamini", "Naidoo", "Van der Merwe", "Mokoena", "Pillay", "Botha", "Khumalo", "Smith", "Nkosi", "Patel", "Mthembu", "Fourie", "Govender", "Ndlovu", "Jacobs", "Sithole", "Le Roux", "Molefe", "Abrahams", "Maseko", "Du Plessis", "Radebe", "Williams", "Tshabalala", "Ismail", "Mahlangu", "Cele", "Kruger", "Zulu", "Adams"],
};
export const CITIES = ["Johannesburg", "Cape Town", "Durban", "Pretoria", "Port Elizabeth", "Bloemfontein", "Polokwane", "Nelspruit", "Rustenburg", "Stellenbosch", "Sandton", "Midrand", "Centurion", "Pietermaritzburg"];
export const UNIVERSITIES = ["University of the Witwatersrand", "University of Cape Town", "University of Pretoria", "Stellenbosch University", "University of Johannesburg", "University of KwaZulu-Natal", "Nelson Mandela University", "University of South Africa", "Tshwane University of Technology", "Durban University of Technology"];
export const LANGUAGES = ["English", "isiZulu", "Sesotho", "isiXhosa", "Setswana", "Afrikaans", "French", "Portuguese", "Tamil", "Sepedi"];
export const LEGAL_LINE = "I consent to my personal information being processed for recruitment purposes in accordance with the Protection of Personal Information Act 4 of 2013. All information in this document is true and correct to the best of my knowledge.";
