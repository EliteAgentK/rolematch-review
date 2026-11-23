// Procedural CVs with an answer key. Everything about a CV is drawn from a seeded random generator, so any failure can be reproduced from its seed, and
// the expected panel contents are known by construction (they are what the generator wrote). Two halves: WHO the person is (persona) and HOW the page
// looks (style). The cross product is far larger than anything written by hand.
import type { Persona } from "../messy/personas";

// ---------------------------------------------------------------- seeded randomness
export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 374761393) >>> 0) / 4294967296);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const int = (a: number, b: number) => a + Math.floor(next() * (b - a + 1));
  const chance = (p: number) => next() < p;
  const shuffle = <T,>(xs: readonly T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return { next, pick, int, chance, shuffle };
}
export type Rng = ReturnType<typeof rng>;

// ---------------------------------------------------------------- who: content pools
const FIRST = ["Thandi", "Sipho", "Lerato", "Pieter", "Aisha", "Johan", "Zanele", "Kevin", "Emma", "Nomvula", "Ruan", "Lindiwe", "Michael", "Fatima", "Themba", "Annelie", "Ayanda", "Mohammed", "Busisiwe", "Willem", "Naledi", "Pravin", "Chantelle", "Mpho", "Siyabonga", "Marelize", "Tshepo", "Yusuf", "Karabo", "Hendrik", "Zodwa", "Priya", "Bongani", "Elmarie", "Kagiso", "Rashid", "Nokuthula", "Dumisani", "Tertia", "Vusi"];
const LAST = ["Mokoena", "Ndlovu", "van der Merwe", "Dlamini", "Patel", "Pretorius", "Khumalo", "Naidoo", "Fourie", "Nkosi", "Botha", "Mahlangu", "Chen", "Sithole", "Smit", "Mthembu", "Mohamed", "Jacobs", "Zulu", "du Plessis", "Mabasa", "O'Connor", "Venter", "Moyo", "Khan", "Steyn", "Radebe", "Lekota", "Coetzee", "Maseko", "Van Wyk-Jansen", "Mkhize", "Peters", "Govender", "Molefe", "Ismail", "Kruger", "Ngcobo", "Oosthuizen", "Tshabalala"];
const CITIES = ["Johannesburg", "Cape Town", "Durban", "Pretoria", "Bloemfontein", "Polokwane", "Gqeberha", "Stellenbosch", "Sandton", "Centurion", "Nelspruit", "Pietermaritzburg", "East London", "Midrand", "Kimberley"];
const COMPANIES = ["Brightpath Software", "Cobalt Digital", "FreshLine Distributors", "Savanna Foods", "Coastal Private Hospital", "Mamelodi Provincial Hospital", "Bayside Engineering", "Greenlight Pharmacy", "Mahlangu Attorneys", "Daily Courier", "Hoërskool Dr Havenga", "Zenith Logistics", "Meridian Holdings", "Lumen Agency", "Northwind Systems", "Shoprite Checkers", "The Harbour Grill", "AquaFlow Services", "Limpopo Mining Services", "Umhlanga Logistics (Pty) Ltd", "Standard Bank", "Discovery Health", "Capitec", "Telkom", "Sasol", "Eskom", "City of Tshwane", "University of Pretoria", "Pick n Pay", "Woolworths", "MTN", "Vodacom", "Old Mutual", "Sanlam", "Absa", "Nedbank", "Clicks", "Mr Price", "Dis-Chem", "Engen"];
const SCHOOLS = ["Pretoria Boys High School", "Durban Girls High School", "Bellville High", "Hoërskool Waterkloof", "Westerford High School", "Parktown Boys' High School", "Sutherland High", "Queens High"];
const UNIS: [string, string][] = [["University of the Witwatersrand", "Wits"], ["University of Pretoria", "UP"], ["University of Cape Town", "UCT"], ["Stellenbosch University", "SU"], ["University of KwaZulu-Natal", "UKZN"], ["Tshwane University of Technology", "TUT"], ["University of Johannesburg", "UJ"], ["UNISA", "UNISA"], ["Nelson Mandela University", "NMU"], ["North-West University", "NWU"], ["Capricorn TVET College", "Capricorn"], ["Boland College", "Boland"]];
const DEGREES = ["BSc Computer Science", "BCom Accounting", "BA Communication Science", "Bachelor of Nursing Science", "LLB", "BEng Civil Engineering", "BSc Statistics", "BCom Honours Marketing", "MBA", "MSc Data Science", "National Diploma in Marketing", "Advanced Diploma in Perioperative Nursing", "Diploma in Nursing", "PGCE", "Higher Certificate in Management", "BEd Foundation Phase", "BTech Information Technology", "N6 Electrical Engineering", "Diploma in Hospitality Management", "BSc (Hons) Information Systems"];
const CERTS = ["AWS Certified Cloud Practitioner", "First Aid Level 2", "PMP", "Basic Life Support (BLS)", "Microsoft Azure Fundamentals", "Code 10 Driver's Licence", "PSIRA Grade B", "ITIL Foundation", "Advanced Excel Certificate", "Food Safety Certificate", "Forklift Operator Licence", "Occupational Health and Safety Level 3", "Sales Leadership Programme", "Google Analytics Certification", "CompTIA A+"];
const LANGS = ["English", "Afrikaans", "isiZulu", "isiXhosa", "Sesotho", "Setswana", "Sepedi", "Xitsonga", "Tshivenda", "Gujarati"];

interface Occupation { headline: string; ladder: string[]; skills: string[]; bullets: string[]; summary: string }
const OCC: Occupation[] = [
  { headline: "Software Developer", ladder: ["Junior Developer", "Software Developer", "Senior Developer", "Lead Developer", "Engineering Manager"], skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Docker", "Git", "REST APIs", "AWS", "Python", "CI/CD", "Kubernetes", "GraphQL", "Agile"],
    bullets: ["Built and maintained web applications used by thousands of customers.", "Designed REST APIs and reviewed code for a team of five.", "Reduced page load time by 40% through caching and query tuning.", "Automated deployments with a CI/CD pipeline.", "Mentored two junior developers.", "Migrated a legacy system to a cloud platform."], summary: "Software developer with a focus on reliable, well-tested web applications." },
  { headline: "Registered Nurse", ladder: ["Enrolled Nurse", "Staff Nurse", "Professional Nurse", "Senior Professional Nurse", "Unit Manager"], skills: ["Patient care", "Infection control", "Wound management", "Medication administration", "IV therapy", "Triage", "BLS"],
    bullets: ["Provided care in a 30-bed surgical ward.", "Administered medication and monitored patients after surgery.", "Trained new nursing staff on infection control protocols.", "Handled admissions, discharges and patient records.", "Assisted doctors during rounds and procedures."], summary: "Registered nurse experienced in surgical and high-care wards." },
  { headline: "Accountant", ladder: ["Bookkeeper", "Accounts Clerk", "Accountant", "Senior Accountant", "Financial Manager"], skills: ["IFRS", "Excel", "Pastel", "VAT", "Payroll", "Budgeting", "Financial reporting", "Bank reconciliation"],
    bullets: ["Prepared monthly management accounts and bank reconciliations.", "Handled VAT and PAYE submissions on time.", "Supported the external audit and answered queries.", "Processed payroll for 120 staff.", "Introduced a budgeting process that cut overspend by 12%."], summary: "Accountant with experience in month-end reporting and compliance." },
  { headline: "Sales Representative", ladder: ["Sales Assistant", "Sales Representative", "Key Account Manager", "Regional Sales Manager", "Sales Director"], skills: ["Negotiation", "Account management", "CRM", "Forecasting", "Cold calling", "Excel"],
    bullets: ["Managed 120 accounts across Gauteng.", "Grew regional revenue by 18% through key-account planning.", "Negotiated quarterly contracts with national retailers.", "Led a team of nine representatives.", "Reported weekly on targets and pipeline."], summary: "Results-driven sales professional with FMCG experience." },
  { headline: "Electrician", ladder: ["Apprentice Electrician", "Electrician", "Senior Electrician", "Maintenance Supervisor"], skills: ["PLC programming", "Fault finding", "Electrical wiring", "Hydraulics", "Occupational health and safety"],
    bullets: ["Maintained and repaired motors, drives and control panels.", "Fault found on PLC controlled plant and restored production.", "Completed safety inspections and compliance paperwork.", "Installed distribution boards and cabling for new workshops."], summary: "Qualified electrician with industrial maintenance experience." },
  { headline: "Teacher", ladder: ["Teaching Assistant", "Teacher", "Head of Department", "Deputy Principal"], skills: ["Lesson planning", "Classroom management", "Mathematics", "Curriculum design", "Assessment"],
    bullets: ["Taught Mathematics to Grades 8 to 12.", "Prepared lesson plans and assessments aligned to the curriculum.", "Ran extra lessons after school for struggling learners.", "Coached the school's chess team."], summary: "Mathematics teacher dedicated to building learners' confidence." },
  { headline: "Chef", ladder: ["Commis Chef", "Chef de Partie", "Sous Chef", "Head Chef"], skills: ["Menu planning", "Food safety", "Stock control", "HACCP", "Costing"],
    bullets: ["Ran the pass during busy service for 120 covers.", "Ordered stock and controlled food costs.", "Trained and scheduled kitchen staff.", "Developed seasonal menus with the owner."], summary: "Chef with a strong record in seafood and grill kitchens." },
  { headline: "Marketing Manager", ladder: ["Marketing Assistant", "Digital Marketer", "Marketing Manager", "Head of Marketing"], skills: ["SEO", "Google Ads", "Content strategy", "Email marketing", "Social media", "Google Analytics", "Copywriting"],
    bullets: ["Managed Google and Meta ad budgets of R180,000 a month.", "Grew organic traffic by 140% through SEO and content.", "Led a team of three marketers and one designer.", "Ran monthly email campaigns to 40,000 subscribers."], summary: "Digital marketing manager with nine years of experience growing online businesses." },
  { headline: "Customer Service Agent", ladder: ["Call Centre Agent", "Customer Service Agent", "Team Leader", "Contact Centre Manager"], skills: ["Customer service", "Ticketing", "Zendesk", "Complaint handling", "Data entry"],
    bullets: ["Answered billing queries by phone and chat.", "Logged and tracked tickets in the support system.", "Escalated technical faults to the right team.", "Met monthly targets for resolution and satisfaction."], summary: "Customer service agent with strong written and phone skills." },
  { headline: "Project Manager", ladder: ["Project Coordinator", "Project Manager", "Senior Project Manager", "Programme Manager"], skills: ["Project management", "MS Project", "Stakeholder management", "Risk management", "Budgeting", "Scheduling", "Prince2"],
    bullets: ["Planned and tracked schedules and budgets for civil projects.", "Coordinated contractors and consultants.", "Reported progress to the client every month.", "Delivered a R40 million programme on time."], summary: "Project manager with infrastructure delivery experience." },
  { headline: "Paralegal", ladder: ["Legal Secretary", "Paralegal", "Senior Paralegal", "Legal Practice Manager"], skills: ["Legal research", "Contract drafting", "Case management", "Compliance"],
    bullets: ["Drafted pleadings and notices.", "Managed case files and court deadlines.", "Conducted legal research for senior attorneys.", "Prepared bundles for trial."], summary: "Paralegal supporting commercial litigation teams." },
  { headline: "Warehouse Supervisor", ladder: ["Packer", "Forklift Driver", "Warehouse Supervisor", "Warehouse Manager"], skills: ["Stock management", "Forklift operation", "Scheduling", "Occupational health and safety", "Supply chain management"],
    bullets: ["Supervised a team of 14 packers and drivers.", "Managed stock counts and reduced variances by 30%.", "Scheduled deliveries and loading.", "Enforced safety procedures on the floor."], summary: "Warehouse supervisor with distribution centre experience." },
];

// ---------------------------------------------------------------- who: the persona with its answer key
export interface StressPersona extends Persona { seed: number; flags: string[]; educationStatus: ("completed" | "in_progress" | "not_completed")[]; datesStyle: string }
export type DateStyle = "mon-yyyy" | "month-yyyy" | "mm-yyyy" | "yyyy" | "yy-apos" | "iso" | "todate";
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function formatDate(y: number, m: number, style: DateStyle): string {
  switch (style) {
    case "mon-yyyy": return `${MON3[m - 1]} ${y}`;
    case "month-yyyy": return `${MONTH[m - 1]} ${y}`;
    case "mm-yyyy": return `${String(m).padStart(2, "0")}/${y}`;
    case "yyyy": return `${y}`;
    case "yy-apos": return `${MON3[m - 1]} '${String(y).slice(2)}`;
    case "iso": return `${y}-${String(m).padStart(2, "0")}`;
    case "todate": return `${MON3[m - 1]} ${y}`;
  }
}
export const presentWord = (style: DateStyle, r: Rng) => (style === "todate" ? "to date" : r.pick(["Present", "Present", "Current", "now"]));

export function makePersona(seed: number): StressPersona {
  const r = rng(seed * 7919 + 13);
  const occ = r.pick(OCC), first = r.pick(FIRST), last = r.pick(LAST), flags: string[] = [];
  const name = `${first} ${last}`, city = r.pick(CITIES);
  const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
  const nRoles = r.pick([1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8]);
  if (nRoles >= 6) flags.push("long-career");
  // roles newest first; a tidy timeline with optional gaps and one overlap
  let endY = 2026, endM = 9;
  const roles: Persona["roles"] = [];
  const current = r.chance(0.7);
  for (let i = 0; i < nRoles; i++) {
    const dur = r.int(8, 60); // months
    let sy = endY, sm = endM - dur;
    while (sm < 1) { sm += 12; sy -= 1; }
    const isCurrent = i === 0 && current;
    const title = occ.ladder[Math.min(occ.ladder.length - 1, Math.max(0, occ.ladder.length - 1 - i - (r.chance(0.3) ? 1 : 0)))];
    const nb = r.pick([0, 1, 2, 2, 3, 3, 4, 5, 6]);
    if (nb === 0) flags.push("role-without-bullets");
    const bullets = r.shuffle(occ.bullets).slice(0, Math.min(nb, occ.bullets.length));
    const company = r.chance(0.08) ? "" : r.pick(COMPANIES);
    roles.push({ position: title, company, start: [sy, sm], end: isCurrent ? null : [endY, endM], bullets });
    const gap = r.chance(0.25) ? r.int(1, 8) : 0;
    if (gap) flags.push("gap");
    endY = sy; endM = sm - 1 - gap;
    while (endM < 1) { endM += 12; endY -= 1; }
  }
  const skillsAll = [...occ.skills];
  const skills = r.shuffle(skillsAll).slice(0, r.int(Math.min(3, skillsAll.length), skillsAll.length));
  // education: none, matric only, one or several, sometimes unfinished
  const education: Persona["education"] = [], educationStatus: StressPersona["educationStatus"] = [];
  const kind = r.pick(["none", "matric", "degree", "degree", "two", "diploma", "progress", "incomplete"]);
  const gradYear = roles[roles.length - 1].start[0] - r.int(0, 4);
  const addEdu = (degree: string, inst: string, y0: number, y1: number | null, status: StressPersona["educationStatus"][number], tail = "") => {
    education.push({ degree, institution: inst, period: y1 === null ? `${y0} - Present` : y0 === y1 ? `${y0}` : `${y0} - ${y1}`, year: y1 ?? y0, ...(tail ? { tail } : {}) } as Persona["education"][number]);
    educationStatus.push(status);
  };
  if (kind === "matric") addEdu("Matric", r.pick(SCHOOLS), gradYear - 3, gradYear - 3, "completed");
  if (kind === "degree") { const u = r.pick(UNIS); addEdu(r.pick(DEGREES.filter((d) => /^B|LLB|Nat|N6|Dip|PGCE|Higher/.test(d))), u[0], gradYear - 3, gradYear, "completed"); }
  if (kind === "two") { const u = r.pick(UNIS); addEdu(r.pick(DEGREES.slice(0, 7)), u[0], gradYear - 6, gradYear - 3, "completed"); addEdu("Matric", r.pick(SCHOOLS), gradYear - 7, gradYear - 7, "completed"); }
  if (kind === "diploma") { const u = r.pick(UNIS); addEdu(r.pick(["National Diploma in Marketing", "Diploma in Nursing", "Advanced Diploma in Perioperative Nursing", "Diploma in Hospitality Management"]), u[0], gradYear - 3, gradYear, "completed"); }
  if (kind === "progress") { const u = r.pick(UNIS); addEdu(r.pick(["BCom Accounting", "MBA", "BSc Computer Science", "National Diploma in Marketing"]), u[0], 2024, null, "in_progress"); }
  if (kind === "incomplete") { const u = r.pick(UNIS); addEdu(r.pick(["BSc Computer Science", "LLB", "BCom Accounting"]), u[0], gradYear - 3, gradYear - 1, "not_completed"); }
  flags.push(`education-${kind}`);
  const nCert = r.pick([0, 0, 1, 1, 2, 3, 5]);
  const certs = r.shuffle(CERTS).slice(0, nCert);
  const nLang = r.pick([0, 1, 2, 3]);
  const languages = r.shuffle(LANGS).slice(0, nLang);
  const phone = `0${r.pick(["60", "71", "72", "78", "82", "83", "84"])} 555 ${String(r.int(0, 9999)).padStart(4, "0")}`;
  return {
    seed, flags, educationStatus, datesStyle: "", id: `s${seed}`, name, email: `${handle}${r.chance(0.2) ? r.int(1, 99) : ""}@example.test`, phone, city, location: `${city}, South Africa`,
    headline: occ.headline, summary: occ.summary, skills, roles, education, certs, languages,
    sensitive: { idNumber: `${r.int(60, 99)}0${r.int(1, 9)}${r.int(10, 28)}5800${r.int(100, 999)}`, dob: "1 April 1990", gender: r.pick(["Female", "Male"]), marital: r.pick(["Single", "Married"]), nationality: "South African", licence: "Code 08" },
  };
}
