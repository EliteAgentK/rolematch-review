// Controlled skill taxonomy: canonical name plus the wordings that count as the same skill.
// Matching is whole-word, so "Java" never matches "JavaScript".
export interface SkillDef { name: string; aliases: string[] }

const S = (name: string, ...aliases: string[]): SkillDef => ({ name, aliases: [name, ...aliases] });

const TECH_SKILLS: SkillDef[] = [
  S("JavaScript", "ecmascript", "es6"), S("TypeScript"), S("React", "react.js", "reactjs"), S("Node.js", "node", "nodejs"),
  S("Next.js", "nextjs"), S("Vue", "vue.js", "vuejs"), S("Angular"), S("Svelte"), S("HTML"), S("CSS"), S("Tailwind", "tailwind css", "tailwindcss"),
  S("Python"), S("Java"), S("C#", "c sharp", ".net", "dotnet"), S("C++"), S("PHP"), S("Ruby"), S("Rust"), S("Kotlin"), S("Swift"), S("Flutter"), S("Dart"),
  S("FastAPI"), S("Django"), S("Flask"), S("Express", "express.js", "expressjs"), S("Spring Boot"), S("GraphQL"),
  S("REST APIs", "rest api", "restful", "rest apis", "restful apis"), S("Microservices", "microservice"), S("Kafka", "apache kafka"),
  S("PostgreSQL", "postgres", "postgresql"), S("MySQL"), S("SQL"), S("MongoDB", "mongo"), S("Redis"), S("Supabase"), S("Firebase"),
  S("Docker", "containers", "containerised", "containerized"), S("Kubernetes", "k8s"), S("Terraform"),
  S("AWS", "amazon web services"), S("Azure", "microsoft azure"), S("Google Cloud", "gcp", "google cloud platform"), S("Cloudflare"), S("Vercel"),
  S("Cloud deployment", "cloud environment", "cloud deployment", "deployed to cloud", "cloud hosting"),
  S("CI/CD", "ci cd", "continuous integration", "continuous delivery", "continuous deployment", "github actions", "gitlab ci", "jenkins"),
  S("Git", "version control"), S("GitHub"), S("GitLab"),
  S("Automated testing", "unit testing", "unit tests", "integration tests", "test automation", "automated tests", "jest", "vitest", "pytest", "cypress", "playwright", "test-driven", "tdd"),
  S("Code review", "code reviews", "peer review", "pull request reviews"),
  S("Software architecture", "system architecture", "solution architecture", "software architect"),
  S("Application security", "owasp", "secure coding"), S("Performance optimisation", "performance optimization", "performance tuning"),
  S("Machine learning"), S("Data science"), S("SQL Server"), S("Power BI"), S("Excel"), S("SharePoint"),
  S("Agile", "scrum", "kanban"), S("Figma"), S("UX design", "ux", "ui/ux", "user research"),
  S("Communication", "stakeholder", "stakeholders", "client-facing", "client facing", "presented to", "client relationships", "written communication", "verbal communication"),
  S("Mentoring", "mentor", "mentored", "mentoring", "coached", "coaching", "supported junior", "line management"),
  S("Technical leadership", "technical lead", "led a team", "led the team", "team lead", "tech lead", "led technical"),
  S("Ownership", "end-to-end", "end to end", "sole developer", "owned", "from requirements", "planning through production"),
];

// Skills outside software, so that a nurse's, an electrician's or an accountant's job description is read as well as a developer's. Matching is whole-word
// and case-insensitive. Aliases are only wordings that mean the same thing; add a skill here, never a special case elsewhere.
const BROAD_SKILLS: SkillDef[] = [
  // finance and accounting
  S("IFRS"), S("GAAP"), S("VAT", "vat returns", "vat submissions"), S("PAYE"), S("Payroll"), S("Pastel", "sage pastel"), S("SAGE", "sage 50", "sage evolution"), S("Xero"), S("QuickBooks"), S("SAP"),
  S("Financial reporting", "month-end reporting", "management accounts", "financial statements"), S("Budgeting", "budget management"), S("Forecasting", "sales forecasting"),
  S("Bank reconciliation", "bank reconciliations", "reconcile bank", "reconciling"), S("Accounts payable", "creditors"), S("Accounts receivable", "debtors", "credit control"), S("Auditing", "external audit", "internal audit", "audit support"), S("Financial analysis"),
  // people and recruitment
  S("Recruitment", "talent acquisition", "recruiting", "headhunting"), S("Onboarding", "induction"), S("Employee relations", "labour relations", "disciplinary hearings"), S("Labour law", "labour legislation", "employment law", "basic conditions of employment"),
  S("Performance management"), S("HRIS", "hr information system", "hr system"), S("Training and development", "learning and development"),
  // health care
  S("Patient care", "patient-centred care", "nursing care"), S("Infection control", "infection prevention"), S("Wound management", "wound care", "wound dressing"), S("Medication administration", "administering medication", "drug administration"), S("IV therapy", "intravenous therapy", "iv cannulation"),
  S("BLS", "basic life support"), S("ACLS", "advanced cardiac life support"), S("Triage"), S("Dispensing", "dispense medication"), S("Patient counselling", "patient counseling", "counsel patients"), S("Stock management", "stock control", "inventory management", "stock-taking", "stocktaking"),
  S("Phlebotomy"), S("Sterile technique", "sterile field", "sterilisation", "sterilization"), S("Theatre nursing", "scrub nurse", "circulating nurse", "perioperative"), S("Pharmacovigilance"),
  // trades and engineering
  S("PLC programming", "plc", "plcs", "programmable logic controllers"), S("Fault finding", "fault-finding", "fault find", "troubleshooting faults", "diagnosing faults"), S("AutoCAD"), S("Civil 3D"), S("Welding"), S("Blueprint reading", "reading blueprints", "technical drawings", "reading drawings"),
  S("Pipe fitting", "pipefitting"), S("Electrical wiring", "wiring", "electrical installations", "electrical installation"), S("Preventative maintenance", "preventive maintenance", "planned maintenance"), S("Hydraulics"), S("Occupational health and safety", "ohs", "health and safety", "safety inspections", "safety compliance"),
  S("Stormwater design", "stormwater"), S("Site supervision", "site management"), S("Variable speed drives", "vsd", "vsds"), S("Geyser installation"), S("Drainage"),
  // education
  S("Lesson planning", "lesson plans", "prepare lessons"), S("Classroom management", "managing a classroom", "learner discipline"), S("Curriculum design", "curriculum development", "caps curriculum"), S("Assessment", "assessments", "marking and assessment"), S("Mathematics", "maths", "teaching mathematics"),
  // sales, service and support
  S("Negotiation", "negotiate", "negotiating", "negotiations"), S("Account management", "key account management", "key accounts", "account manager"), S("CRM", "customer relationship management", "salesforce", "hubspot", "zoho crm"), S("Cold calling"), S("Lead generation"),
  S("Customer service", "customer care", "client service", "customer support"), S("Ticketing", "support tickets", "ticketing system", "ticket logging", "helpdesk", "help desk"), S("Zendesk"), S("Telephone etiquette"), S("Complaint handling", "handling complaints", "query resolution"),
  // legal
  S("Legal research"), S("Contract drafting", "drafting contracts", "drafting agreements"), S("Case management", "case files", "case file management"), S("Conveyancing"), S("Compliance", "regulatory compliance"),
  // hospitality and food
  S("Menu planning", "menu development", "writing menus", "menu design"), S("Food safety", "food hygiene", "haccp"), S("Costing", "food costing", "food costs", "cost control"), S("Kitchen management", "running the line", "run the pass", "the pass"), S("Barista"),
  // project and operations
  S("Project management", "project manager", "managing projects", "programme management"), S("MS Project", "microsoft project", "ms project"), S("Prince2"), S("PMP"), S("Stakeholder management", "stakeholder engagement", "managing stakeholders"), S("Risk management", "risk assessment"),
  S("Scheduling", "project schedules", "rostering", "shift scheduling"), S("Supply chain management", "supply chain", "logistics management"), S("Procurement", "purchasing", "sourcing"),
  // marketing and content
  S("SEO", "search engine optimisation", "search engine optimization"), S("Google Ads", "google adwords", "ppc"), S("Meta Ads", "facebook ads", "social media advertising"), S("Content strategy", "content planning", "content marketing"), S("Email marketing", "newsletters", "mailchimp"),
  S("Social media", "social media management", "community management"), S("Copywriting", "copywriter"), S("Google Analytics", "ga4"), S("Canva"), S("Adobe Photoshop", "photoshop"), S("Adobe Illustrator", "illustrator"), S("Video editing", "premiere pro", "final cut"), S("Event planning", "events management", "event management"),
  // data and analysis
  S("Statistics", "statistical analysis", "statistical"), S("Data cleaning", "data cleansing", "cleaning data", "data validation"), S("Data analysis", "data analytics", "analysing data"), S("Tableau"), S("R programming", "r studio", "rstudio"), S("Dashboards", "dashboard reporting"),
  // it operations
  S("Linux"), S("Windows Server"), S("Networking", "tcp/ip", "routing and switching"), S("Active Directory"), S("Prometheus"), S("Grafana"), S("Bash", "shell scripting", "bash scripting"), S("PowerShell"), S("Ansible"), S("Infrastructure as code", "iac"), S("Incident response", "incident management"),
  // general professional
  S("Time management"), S("Problem solving", "problem-solving"), S("Attention to detail", "detail-oriented", "detail oriented"), S("Teamwork", "team player", "collaboration"), S("Report writing", "report-writing", "writing reports"), S("Presentation skills", "presentations", "presented", "presenting"),
  S("Microsoft Office", "ms office", "microsoft 365", "office 365"), S("Word"), S("PowerPoint"), S("Data entry", "capturing data", "data capturing"),
];
export const SKILLS: SkillDef[] = [...TECH_SKILLS, ...BROAD_SKILLS];
/** A technology, as opposed to a broad ability: leading people who use it does not show using it. */
export const isTechnicalSkill = (name: string) => !["Communication", "Mentoring", "Technical leadership", "Ownership"].includes(name) && TECH_SKILLS.some((s) => s.name === name);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compiled = SKILLS.map((skill) => ({
  skill,
  patterns: skill.aliases.map((alias) => new RegExp(`(?<![a-z0-9])${escape(alias.toLowerCase())}(?![a-z0-9])`, "i")),
}));

/** Canonical skills mentioned anywhere in `text`. */
export function findSkills(text: string): SkillDef[] {
  const out: SkillDef[] = [];
  for (const { skill, patterns } of compiled) if (patterns.some((p) => p.test(text))) out.push(skill);
  return out;
}

export interface SkillHit { skill: SkillDef; index: number; end: number }
/** Every skill mentioned in `text`, once each, at the place it first appears, in reading order. Used to tell "Bash or Python" (alternatives) from "Docker and Terraform" (both). */
export function skillMatches(text: string): SkillHit[] {
  const hits: SkillHit[] = [];
  for (const { skill, patterns } of compiled) {
    let best: SkillHit | null = null;
    for (const p of patterns) { const m = p.exec(text); if (m && (!best || m.index < best.index)) best = { skill, index: m.index, end: m.index + m[0].length }; }
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function textMentions(text: string, skill: SkillDef): boolean {
  const entry = compiled.find((c) => c.skill.name === skill.name);
  return !!entry && entry.patterns.some((p) => p.test(text));
}

/** The line of `text` that mentions the skill, trimmed - used as a citation. */
export function quoteFor(text: string, skill: SkillDef): string | undefined {
  const entry = compiled.find((c) => c.skill.name === skill.name);
  if (!entry) return undefined;
  const line = text.split(/\n+/).find((l) => entry.patterns.some((p) => p.test(l)));
  return line ? line.trim().slice(0, 220) : undefined;
}

// ---- splitting a run of skills that has no separators: "Costing Food safety HACCP" (cells of a table whose gaps were too small to show)
const knownForms = new Set(SKILLS.flatMap((sk) => [sk.name, ...sk.aliases]).map((f) => f.toLowerCase()));
/**
 * If EVERY word of `line` belongs to a known skill name, returns the skills it is made of (fewest pieces); otherwise null. Used only on a line that has
 * no separators at all, so "Project management" stays one skill and "Costing Food safety HACCP" becomes three.
 */
/** True when the phrase is a skill name or alias RoleMatch knows. */
export const isKnownSkillForm = (phrase: string) => knownForms.has(phrase.trim().toLowerCase());

export function segmentSkills(line: string): string[] | null {
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 14) return null;
  const best: (string[] | null)[] = Array(words.length + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= words.length; i++) for (let j = Math.max(0, i - 5); j < i; j++) {
    const prev = best[j], phrase = words.slice(j, i).join(" ");
    if (prev && knownForms.has(phrase.toLowerCase()) && (!best[i] || prev.length + 1 < best[i]!.length)) best[i] = [...prev, phrase];
  }
  return best[words.length] && best[words.length]!.length >= 2 ? best[words.length] : null;
}
