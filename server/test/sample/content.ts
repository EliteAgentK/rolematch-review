// Fictional people and companies for hand-testing RoleMatch. Nothing here is real; any resemblance is accidental.
export interface Section { h?: string; lines: string[]; bullets?: boolean }
export interface Doc { id: string; title: string; format: "docx" | "pdf"; style: "structured" | "plain" | "twocol" | "caps"; sections: Section[] }

export const JOBS: Doc[] = [
  { id: "job01-senior-developer", title: "Senior Software Developer", format: "docx", style: "structured", sections: [
    { lines: ["Company: Fynbos Digital", "Location: Cape Town, South Africa (hybrid, 3 days in the office)", "Employment type: Full-time, permanent", "Department: Engineering"] },
    { h: "About the role", lines: ["Fynbos Digital builds booking software for independent hotels. We are looking for a Senior Software Developer to lead the design of new customer-facing features and to mentor two mid-level developers."] },
    { h: "Responsibilities", bullets: true, lines: ["Design and build web applications with React and TypeScript.", "Build and maintain Node.js REST APIs backed by PostgreSQL.", "Review code and mentor mid-level developers.", "Work with product managers to break down features into deliverable pieces.", "Improve test coverage and release pipelines."] },
    { h: "Requirements", bullets: true, lines: ["At least five years of professional software development experience.", "Strong experience with TypeScript and JavaScript.", "Production experience with React and Node.js.", "Experience with PostgreSQL or another relational database.", "A degree in Computer Science or equivalent practical experience."] },
    { h: "Nice to have", bullets: true, lines: ["Experience with Docker and cloud hosting.", "Experience mentoring other developers."] },
  ] },
  { id: "job02-data-analyst", title: "Data Analyst", format: "docx", style: "structured", sections: [
    { lines: ["Company: Karoo Retail Group", "Location: Johannesburg, South Africa", "Employment type: Full-time", "Department: Business Intelligence"] },
    { h: "Purpose of the role", lines: ["Turn sales and stock data into reports that store managers use every Monday."] },
    { h: "Key duties", bullets: true, lines: ["Write SQL queries to extract and clean data from our data warehouse.", "Build dashboards in Power BI.", "Analyse weekly sales trends and report findings to regional managers.", "Maintain Excel models used by the finance team."] },
    { h: "Minimum requirements", bullets: true, lines: ["A BCom, BSc or similar degree in a quantitative field.", "Three or more years of experience in a data analyst role.", "Advanced SQL skills.", "Experience with Power BI or a similar tool.", "Strong Excel skills."] },
    { h: "Preferred", bullets: true, lines: ["Python or R for analysis.", "Retail industry experience."] },
  ] },
  { id: "job03-theatre-nurse", title: "Registered Nurse (Theatre)", format: "pdf", style: "structured", sections: [
    { lines: ["Employer: Jacaranda Private Hospital", "Location: Pretoria, South Africa", "Employment type: Full-time, shift work", "Department: Theatre"] },
    { h: "Duties", bullets: true, lines: ["Assist surgeons and anaesthetists during procedures.", "Prepare and count instruments and swabs.", "Maintain sterile technique and infection-control standards.", "Complete theatre registers and patient documentation."] },
    { h: "Requirements", bullets: true, lines: ["Registration with the South African Nursing Council (SANC).", "A diploma or degree in nursing with a perioperative qualification.", "At least three years of theatre nursing experience.", "Current BLS certification."] },
    { h: "Advantageous", bullets: true, lines: ["Experience in orthopaedic or cardiac theatre.", "ACLS certification."] },
  ] },
  { id: "job04-financial-accountant", title: "Financial Accountant", format: "docx", style: "plain", sections: [
    { lines: ["Financial Accountant - Durban", "Umhlanga Logistics (Pty) Ltd is looking for a financial accountant to run month-end close for our freight business. You will prepare management accounts, reconcile the general ledger, and support the annual audit. We use Sage for accounting and Excel for reporting.", "The ideal person has a BCom Accounting degree, is a CA(SA) or has completed articles, and has at least four years of accounting experience. Knowledge of IFRS is required. Experience with Sage is essential. Some travel to our Cape Town branch may be needed. This is a permanent role."] },
  ] },
  { id: "job05-sales-rep", title: "Sales Representative", format: "docx", style: "structured", sections: [
    { lines: ["BrightFoods Distribution", "Johannesburg, Gauteng", "Full-time | Field sales"] },
    { h: "The job", lines: ["Sell our range of packaged foods to independent retailers and restaurants in the Gauteng region."] },
    { h: "What you will do", bullets: true, lines: ["Visit 8 to 10 customers a day and take orders.", "Grow sales in your own territory and meet monthly targets.", "Log every visit in our CRM.", "Negotiate pricing and promotions within set limits."] },
    { h: "What we need", bullets: true, lines: ["Two years of proven B2B sales experience.", "A valid driver's licence and your own reliable vehicle.", "Experience using a CRM.", "Strong negotiation skills.", "Matric certificate."] },
  ] },
  { id: "job06-marketing-manager", title: "Digital Marketing Manager", format: "docx", style: "structured", sections: [
    { lines: ["Company: Lumen Learning", "Location: Remote (South Africa)", "Employment type: Full-time", "Work arrangement: Remote"] },
    { h: "Overview", lines: ["Lumen Learning sells online courses to working adults. You will own our paid and organic acquisition channels and manage a team of two."] },
    { h: "Responsibilities", bullets: true, lines: ["Plan and run Google Ads and Meta Ads campaigns.", "Lead SEO and content strategy.", "Report on cost per acquisition and return on ad spend.", "Manage a content writer and a designer."] },
    { h: "Requirements", bullets: true, lines: ["Five or more years in digital marketing.", "Proven experience managing Google Ads budgets above R100,000 a month.", "Strong SEO knowledge.", "Experience with Google Analytics.", "Experience leading a team."] },
  ] },
  { id: "job07-electrician", title: "Electrician", format: "docx", style: "plain", sections: [
    { lines: ["Qualified Electrician needed - Gqeberha (Port Elizabeth)", "Bayside Engineering is hiring a trade-tested electrician for commercial maintenance and installation work.", "Must have: trade test certificate, a valid wireman's licence, at least five years experience in commercial or industrial electrical work, and a valid code 08 driver's licence.", "Duties include installing and maintaining distribution boards, cable pulling, fault finding, and issuing certificates of compliance. Experience with PLC control panels is a plus. Standby duty is rotated between the team."] },
  ] },
  { id: "job08-hr-partner", title: "HR Business Partner", format: "pdf", style: "structured", sections: [
    { lines: ["Company: Meridian Financial Services", "Location: Sandton, Johannesburg", "Type: Permanent", "Department: Human Resources"] },
    { h: "Role purpose", lines: ["Partner with business leaders on people matters across a 300-person organisation."] },
    { h: "Responsibilities", bullets: true, lines: ["Advise managers on disciplinary and grievance processes.", "Lead employee relations cases and CCMA representation.", "Support performance management and talent reviews.", "Analyse turnover data and recommend retention actions."] },
    { h: "Requirements", bullets: true, lines: ["A degree in Human Resources or Industrial Psychology.", "At least six years of HR generalist experience.", "Thorough knowledge of South African labour law.", "Experience representing the company at the CCMA."] },
  ] },
  { id: "job09-devops-engineer", title: "DevOps Engineer", format: "docx", style: "structured", sections: [
    { lines: ["Company: Sable Payments", "Location: Johannesburg, South Africa (hybrid)", "Employment type: Full-time", "Department: Platform"] },
    { h: "About the role", lines: ["Own the infrastructure that processes millions of card payments a day."] },
    { h: "Responsibilities", bullets: true, lines: ["Manage production infrastructure on AWS.", "Run containerised workloads on Kubernetes.", "Write infrastructure as code with Terraform.", "Build and improve CI/CD pipelines.", "Be part of an on-call rotation."] },
    { h: "Requirements", bullets: true, lines: ["Four or more years of DevOps or site reliability experience.", "Hands-on production experience with AWS.", "Production experience with Docker and Kubernetes.", "Experience with Terraform.", "Strong scripting skills in Bash or Python."] },
  ] },
  { id: "job10-support-agent", title: "Customer Support Agent", format: "docx", style: "structured", sections: [
    { lines: ["Company: Tafelberg Telecoms", "Location: Cape Town, South Africa", "Employment type: Full-time, shifts", "Department: Customer Care"] },
    { h: "Duties", bullets: true, lines: ["Answer customer calls and chats about billing and connectivity.", "Log and resolve queries in our ticketing system.", "Escalate complex faults to the technical team.", "Meet quality and resolution-time targets."] },
    { h: "Requirements", bullets: true, lines: ["Matric certificate.", "One or more years of contact centre experience.", "Fluent English and Afrikaans.", "Good computer skills.", "Patience and a calm manner with upset customers."] },
  ] },
];

export const CVS: Doc[] = [
  { id: "cv01-thandi-mokoena", title: "Thandi Mokoena", format: "docx", style: "structured", sections: [
    { lines: ["Thandi Mokoena", "Senior Full-Stack Developer", "thandi.mokoena@example.test | 082 555 0101 | Cape Town, South Africa"] },
    { h: "Summary", lines: ["Full-stack developer with eight years of experience building web applications in TypeScript, React and Node.js. I enjoy mentoring and shipping reliable software."] },
    { h: "Experience", lines: ["Senior Developer, Cobalt Travel (Mar 2020 - Present)"] },
    { lines: ["Led a team of four building a booking platform used by 200 hotels.", "Built React and TypeScript front ends and Node.js REST APIs backed by PostgreSQL.", "Mentored two junior developers and introduced code reviews."], bullets: true },
    { lines: ["Developer, Pixel Foundry (Jan 2016 - Feb 2020)"] },
    { lines: ["Built JavaScript and React single-page applications for retail clients.", "Wrote automated tests with Jest and set up Docker-based builds."], bullets: true },
    { h: "Education", lines: ["BSc Computer Science, University of Cape Town, 2015"] },
    { h: "Skills", lines: ["TypeScript, JavaScript, React, Node.js, PostgreSQL, Docker, Git, REST APIs, Jest, AWS"] },
  ] },
  { id: "cv02-ruan-van-der-merwe", title: "Ruan van der Merwe", format: "docx", style: "structured", sections: [
    { lines: ["Ruan van der Merwe", "Data Analyst", "ruan.vdmerwe@example.test | 083 555 0102 | Johannesburg, South Africa"] },
    { h: "Profile", lines: ["Data analyst with five years of experience in retail and logistics reporting."] },
    { h: "Work experience", lines: ["Data Analyst, Highveld Wholesale (Feb 2021 - Present)"] },
    { lines: ["Wrote SQL queries against a 2 TB data warehouse for weekly sales reporting.", "Built 15 Power BI dashboards used by regional managers.", "Automated Excel reports with Python, saving 10 hours a week."], bullets: true },
    { lines: ["Junior Analyst, Pinnacle Freight (Jan 2019 - Jan 2021)"] },
    { lines: ["Cleaned and reconciled shipment data in SQL and Excel.", "Produced monthly KPI packs for the operations director."], bullets: true },
    { h: "Education", lines: ["BCom Information Systems, University of Pretoria, 2018"] },
    { h: "Skills", lines: ["SQL, Power BI, Excel, Python, Data cleaning, Statistics, Reporting"] },
  ] },
  { id: "cv03-lindiwe-dlamini", title: "Lindiwe Dlamini", format: "pdf", style: "structured", sections: [
    { lines: ["Lindiwe Dlamini", "Professional Nurse - Theatre", "lindiwe.dlamini@example.test | 071 555 0103 | Pretoria, South Africa"] },
    { h: "Profile", lines: ["Perioperative nurse with seven years of theatre experience in private hospitals."] },
    { h: "Experience", lines: ["Theatre Nurse, Pretoria East Clinic (Apr 2019 - Present)"] },
    { lines: ["Scrub and circulating nurse for orthopaedic and general surgery lists.", "Responsible for instrument counts and sterile-field management.", "Trained new theatre staff on infection-control protocols."], bullets: true },
    { lines: ["Staff Nurse, Mamelodi Provincial Hospital (Jan 2016 - Mar 2019)"] },
    { lines: ["Worked in the surgical ward and rotated through theatre."], bullets: true },
    { h: "Education", lines: ["Diploma in Nursing, University of Pretoria, 2015", "Advanced Diploma in Perioperative Nursing, Tshwane University of Technology, 2018"] },
    { h: "Registration and certification", lines: ["SANC registered professional nurse", "BLS certified (current)"] },
  ] },
  { id: "cv04-michael-chen", title: "Michael Chen", format: "docx", style: "structured", sections: [
    { lines: ["Michael Chen", "Accountant", "michael.chen@example.test | 084 555 0104 | Durban, South Africa"] },
    { h: "Summary", lines: ["Accountant with six years of experience in month-end reporting for small and mid-sized businesses."] },
    { h: "Experience", lines: ["Accountant, Coastal Timber (Jun 2020 - Present)"] },
    { lines: ["Prepare monthly management accounts and bank reconciliations in Pastel.", "Handle VAT and PAYE submissions.", "Support the external audit."], bullets: true },
    { lines: ["Bookkeeper, Beachfront Cafes (Feb 2017 - May 2020)"] },
    { lines: ["Captured daily takings and supplier invoices.", "Prepared payroll for 40 staff."], bullets: true },
    { h: "Education", lines: ["BCom Accounting, University of KwaZulu-Natal, 2016"] },
    { h: "Skills", lines: ["Pastel, Excel, Bank reconciliations, VAT, Payroll, Management accounts"] },
  ] },
  { id: "cv05-sipho-ndlovu", title: "Sipho Ndlovu", format: "docx", style: "plain", sections: [
    { lines: ["Sipho Ndlovu", "sipho.ndlovu@example.test  0725550105  Pretoria, Gauteng", "I have worked in sales for about ten years, mostly selling groceries and cleaning products to spaza shops, small supermarkets and restaurants. At Mzansi Cash and Carry I was the top rep in my region for three years running and I looked after about 120 accounts. Before that I worked for Tswane Wholesalers from 2013 to 2017 doing the same kind of work. I use a CRM every day to log visits and I am comfortable negotiating prices and promotions. I have a code 08 licence and my own bakkie. I finished matric at Pretoria Boys in 2009. I am good at Excel and I speak English, Zulu and Sotho."] },
  ] },
  { id: "cv06-aisha-patel", title: "Aisha Patel", format: "pdf", style: "twocol", sections: [
    { lines: ["Aisha Patel", "Digital Marketing Manager"] },
    { h: "Contact", lines: ["aisha.patel@example.test", "072 555 0106", "Remote - Cape Town, South Africa"] },
    { h: "Skills", lines: ["SEO", "Google Ads", "Meta Ads", "Google Analytics", "Email marketing", "Content strategy", "Team leadership"] },
    { h: "Education", lines: ["BA Communication Science, Stellenbosch University, 2013"] },
    { h: "Profile", lines: ["Digital marketing manager with nine years of experience growing online businesses."] },
    { h: "Experience", lines: ["Head of Growth, Shelf Space (Jan 2019 - Present)", "Managed Google and Meta ad budgets of R180,000 a month.", "Grew organic traffic by 140% in two years through SEO and content.", "Led a team of three marketers and one designer.", "Digital Marketer, Bluebird Media (Feb 2014 - Dec 2018)", "Ran paid campaigns for 20 small business clients.", "Reported weekly on cost per acquisition."] },
  ] },
  { id: "cv07-johan-pretorius", title: "Johan Pretorius", format: "docx", style: "structured", sections: [
    { lines: ["Johan Pretorius", "Elektrisiën / Electrician", "johan.pretorius@example.test | 076 555 0107 | Gqeberha, Oos-Kaap"] },
    { h: "Profiel", lines: ["Gekwalifiseerde elektrisiën met twaalf jaar ondervinding in kommersiële en industriële installasies."] },
    { h: "Werkservaring", lines: ["Elektrisiën, Algoa Industrial Services (Jan 2016 - Present)"] },
    { lines: ["Installasie en onderhoud van verdeelborde.", "Foutopsporing op industriële masjinerie en PLC beheerpanele.", "Uitreiking van sertifikate van nakoming."], bullets: true },
    { lines: ["Leerling-elektrisiën, Kouga Contractors (Jan 2012 - Dec 2015)"] },
    { lines: ["Kabeltrek en bedrading op bouprojekte."], bullets: true },
    { h: "Opleiding", lines: ["Ambagstoets (Trade test) - Elektrisiën, 2015", "Matriek, Hoërskool Despatch, 2008"] },
    { h: "Vaardighede", lines: ["Wireman's licence, Code 08 rybewys, PLC programmering, Fault finding"] },
  ] },
  { id: "cv08-zanele-khumalo", title: "Zanele Khumalo", format: "docx", style: "structured", sections: [
    { lines: ["Zanele Khumalo", "HR Generalist", "zanele.khumalo@example.test | 073 555 0108 | Johannesburg, South Africa"] },
    { h: "Employment", lines: ["2019 - Present   HR Manager, Rand Auto Parts", "Advise 12 line managers on discipline and grievances.", "Represented the company at the CCMA in over 25 cases.", "Introduced a quarterly performance review process.", "2015 - 2019   HR Officer, Gold Reef Services", "Handled recruitment, onboarding and employee records.", "Assisted with labour law compliance and disciplinary hearings."] },
    { h: "Qualifications", lines: ["BA Industrial Psychology, University of Johannesburg, 2014", "Certificate in Labour Relations, 2018"] },
    { h: "Skills", lines: ["Labour law, CCMA, Employee relations, Recruitment, Performance management"] },
  ] },
  { id: "cv09-kevin-naidoo", title: "Kevin Naidoo", format: "pdf", style: "structured", sections: [
    { lines: ["Kevin Naidoo", "Junior DevOps Engineer", "kevin.naidoo@example.test | 078 555 0109 | Johannesburg, South Africa"] },
    { h: "Profile", lines: ["Recent graduate with a year and a half of experience in a platform team. Keen to grow in cloud engineering."] },
    { h: "Experience", lines: ["Junior DevOps Engineer, Orbit Systems (Jul 2025 - Present)"] },
    { lines: ["Maintain CI pipelines in GitHub Actions.", "Deploy services to AWS under the guidance of senior engineers.", "Write Bash scripts to automate server housekeeping."], bullets: true },
    { h: "Education", lines: ["BSc Information Technology, University of Johannesburg, 2024"] },
    { h: "Skills", lines: ["AWS, Docker, Kubernetes, Terraform, Linux, Bash, Python, GitHub Actions"] },
  ] },
  { id: "cv10-emma-fourie", title: "Emma Fourie", format: "docx", style: "caps", sections: [
    { lines: ["EMMA FOURIE", "emma.fourie@example.test / 079 555 0110 / CAPE TOWN", "CUSTOMER SERVICE", "ABOUT ME: friendly, patient, good with people. Two years in a call centre after a few years as a waitress. I like helping customers sort out problems.", "WHERE I WORKED", "Call Centre Agent - Cape Connect (2023 to now): answering billing queries by phone and chat, logging tickets, meeting my targets every month.", "Waitress - The Harbour Grill (2019 to 2022).", "SCHOOL: Matric, Bellville High, 2018.", "LANGUAGES: English, Afrikaans (both fluent).", "COMPUTER: Word, Excel, Zendesk."] },
  ] },
];
