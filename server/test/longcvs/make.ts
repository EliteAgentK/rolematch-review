// Writes a pack of long invented CVs and job descriptions as real documents: Word and searchable PDF, 15 to 30 pages, in the many shapes people actually send. Everything a document states is recorded as its answer key at the moment it is written, so the key can never be derived from what the system read.
//   node --import tsx test/longcvs/make.ts <out dir> <how many CVs> [seed]
// The result is invented people only. Nothing here reads a real CV.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { CITIES, COMPANY_WORDS, GENERAL_DUTIES, LANGUAGES, LEGAL_LINE, PEOPLE, PROFESSIONS, REASONS_FOR_LEAVING, UNIVERSITIES, type Profession, type Skill } from "./bank";

const [outDir, howMany, seedArg] = process.argv.slice(2);
if (!outDir || !howMany) throw new Error("usage: make.ts <out dir> <how many CVs> [seed]");
let state = Number(seedArg ?? 20261105) >>> 0;
const rnd = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const shuffled = <T,>(xs: readonly T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fill = (s: string) => s.replace("{p}", String(int(11, 46))).replace("{n}", String(int(3, 14))).replace("{m}", String(int(2, 38)));

// ---------------------------------------------------------------- the person's own account of each role, written by the local model and kept
// A hand-written bank cannot fill 15 pages without repeating itself. The model writes in the person's words; the facts stay ours. Whatever it says about a tool this person is not meant to show is removed sentence by sentence, so the answer key stays true.
const STORE = join(outDir, "Reference", "narratives.jsonl"), stored = new Map<string, string>();
mkdirSync(join(outDir, "Reference"), { recursive: true });
if (existsSync(STORE)) for (const l of readFileSync(STORE, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); stored.set(r.k, r.text); }
const WRITER = process.env.CV_WRITER_MODEL ?? "qwen3:4b-instruct-2507-q4_K_M", WRITE = process.env.CV_WRITE !== "off";
const ASPECTS = ["what the business needed when I took this role, what I was responsible for, and how my days actually went", "the hardest problem I dealt with in this role: what had gone wrong, what I tried, what did not work, and how it ended", "the people side of this role: who I worked with, how I led or supported them, a disagreement I handled, and what I learned"];
// The model may be on another machine, and several passages of a round can be written at once (CV_WRITERS).
const WRITER_URL = process.env.CV_WRITER_URL ?? "http://127.0.0.1:11434", WRITERS = Number(process.env.CV_WRITERS ?? 1);
async function written(key: string, r: Role, sector: string, mayUse: string[], mayNot: string[], aspect: string): Promise<string> {
  const hit = stored.get(key); if (hit !== undefined) return hit;
  if (!WRITE) return "";
  const res = await fetch(`${WRITER_URL}/api/chat`, { method: "POST", signal: AbortSignal.timeout(600_000), body: JSON.stringify({ model: WRITER, stream: false, think: false, options: { temperature: 0.9, seed: [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7), num_predict: 900 }, messages: [
    { role: "system", content: "You write part of a real person's long curriculum vitae, in the first person, in plain South African business English. Write flowing paragraphs only: no headings, no lists, no markdown. Be specific: situations, numbers, what was done and what changed. Vary sentence openings and do not begin sentences with 'I' every time. Mention no contact details, no other employers by name, and no software, tools, standards or methods beyond those you are told you may use." },
    { role: "user", content: `Role: ${r.title} at ${r.employer}, in ${sector}, in ${r.city}, from ${r.start} to ${r.end ?? "now"}.\nTools and methods you may name: ${mayUse.join(", ") || "none"}.\nThings to base it on:\n${r.bullets.slice(0, 5).map((b) => `- ${b}`).join("\n")}\nWrite about 350 words on ${aspect}.` }] }) });
  const body: any = await res.json(); let text = String(body?.message?.content ?? "");
  const banned = mayNot.map((x) => x.toLowerCase());
  text = text.replace(/[*#_`]/g, "").split(/(?<=[.!?])\s+/).filter((sentence) => { const l = sentence.toLowerCase(); return !banned.some((b) => l.includes(b)) && !/@|\+27|\b0\d{2}[ -]?\d{3}/.test(sentence) && !/^(here is|here's|sure|certainly)/i.test(sentence.trim()); }).join(" ").trim();
  stored.set(key, text); appendFileSync(STORE, JSON.stringify({ k: key, text }) + "\n");
  return text;
}

// ---------------------------------------------------------------- the document, independent of file format
type Block =
  | { t: "title"; text: string } | { t: "h1"; text: string } | { t: "h2"; text: string } | { t: "p"; text: string } | { t: "b"; text: string } | { t: "small"; text: string }
  | { t: "table"; rows: string[][]; head?: boolean } | { t: "break" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
type DateStyle = "Mon YYYY" | "Month YYYY" | "MM/YYYY" | "YYYY-MM" | "YYYY/MM";
const fmt = (ym: string | null, style: DateStyle, present: string) => {
  if (!ym) return present;
  const [y, m] = ym.split("-").map(Number);
  if (style === "Mon YYYY") return `${MONTHS[m - 1].slice(0, 3)} ${y}`;
  if (style === "Month YYYY") return `${MONTHS[m - 1]} ${y}`;
  if (style === "MM/YYYY") return `${String(m).padStart(2, "0")}/${y}`;
  if (style === "YYYY/MM") return `${y}/${String(m).padStart(2, "0")}`;
  return ym;
};

const LAYOUTS = ["classic", "sa_detailed", "sidebar", "role_tables", "academic", "agency", "functional", "consultant", "oldest_first", "executive"] as const;
type Layout = (typeof LAYOUTS)[number];

interface Role { employer: string; title: string; start: string; end: string | null; city: string; bullets: string[]; narrative: string[]; reason: string; projects: { name: string; story: string; value: string }[]; }
interface Person {
  id: string; name: string; email: string; phone: string; city: string; family: string; layout: Layout; dateStyle: DateStyle; present: string; pdfFont: "Helvetica" | "Times"; runningHeader: boolean;
  summary: string; roles: Role[]; degrees: { qualification: string; institution: string; status: string; year: number }[]; certs: { name: string; issuer: string; status: string; year: number }[];
  courses: { name: string; year: number }[]; memberships: string[]; languages: string[]; listedSkills: string[]; describedSkills: string[]; listedOnly: string[]; denied: string[]; absent: string[];
  references: { name: string; role: string; company: string; phone: string; email: string }[]; agency?: { name: string; recruiter: string; phone: string; email: string }; idNumber?: string; publications: string[];
}

const company = (used: Set<string>) => { for (;;) { const c = `${pick(COMPANY_WORDS.first)} ${pick(COMPANY_WORDS.last)}`; if (!used.has(c)) { used.add(c); return c; } } };
const phoneOf = () => { const n = `${pick(["82", "83", "72", "73", "76", "61", "71"])}${int(1000000, 9999999)}`; return pick([`+27 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`, `0${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`, `0${n}`, `(0${n.slice(0, 2)}) ${n.slice(2, 5)}-${n.slice(5)}`]); };
const ascii = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const emailOf = (first: string, last: string) => `${pick([`${ascii(first)}.${ascii(last)}`, `${ascii(first)[0]}${ascii(last)}`, `${ascii(first)}${int(10, 99)}`])}@${pick(["example.co.za", "example.com", "mail.example.org"])}`;
const paragraphOfContext = (employer: string, sector: string, title: string) => pick([
  `${employer} operates in ${sector}, with about ${int(150, 6000)} employees across ${int(2, 14)} sites. I joined as ${title}, reporting to the ${pick(["divisional head", "general manager", "executive for the function", "managing director"])} with a team of ${int(2, 25)} people.`,
  `This role was based in a ${sector} business turning over about R${int(80, 900)} million a year. As ${title} I was brought in during a period of ${pick(["rapid growth", "restructuring", "new ownership", "regulatory change", "system replacement"])}, and I was given responsibility for the work described here.`,
  `${employer} is a ${pick(["well-established", "family-owned", "listed", "private equity backed", "state-owned"])} ${sector} organisation. My appointment as ${title} followed ${pick(["an internal promotion", "a recommendation by a former colleague", "a competitive selection process", "a fixed-term contract that became permanent"])}.`,
]);

function person(i: number, prof: Profession): Person {
  const first = pick(PEOPLE.first), last = pick(PEOPLE.last), years = int(12, 32), layout = LAYOUTS[i % LAYOUTS.length], used = new Set<string>();
  // What this person shows of their profession's skills is decided first, so what the document says follows from it.
  const skills = shuffled(prof.skills), nDescribed = Math.max(3, Math.round(skills.length * (0.45 + rnd() * 0.3))), described = skills.slice(0, nDescribed), rest = skills.slice(nDescribed);
  const listedOnly = rest.slice(0, Math.ceil(rest.length / 2)), absentOrDenied = rest.slice(listedOnly.length), denied = rnd() < 0.5 && absentOrDenied.length ? [absentOrDenied[0]] : [], absent = absentOrDenied.filter((s) => !denied.includes(s));
  const nRoles = int(6, 11), span = years * 12 / nRoles, roles: Role[] = [];
  const sentences = shuffled(described.flatMap((s) => [...s.used, ...(s.ownWords ?? [])].map((text) => ({ text, skill: s.name })))), duties = shuffled(prof.duties), general = shuffled(GENERAL_DUTIES), wins = shuffled(prof.wins), projects = shuffled(prof.projects);
  // Each described skill appears at least once in work, in a role chosen at random, so the evidence is not always in the most recent role.
  const buckets: string[][] = Array.from({ length: nRoles }, () => []);
  sentences.forEach((s, k) => buckets[k < described.length ? int(0, nRoles - 1) : k % nRoles].push(s.text));
  let month = 2026 * 12 + 9 - int(0, 4);
  const present = pick(["Present", "Current", "To date", "Now", "Ongoing"]);
  for (let r = 0; r < nRoles; r++) {
    const length = Math.max(8, Math.round(span * (0.6 + rnd() * 0.8))), endM = month, startM = endM - length, ym = (m: number) => `${Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, "0")}`;
    const level = Math.max(0, Math.min(prof.ladder.length - 1, prof.ladder.length - 1 - Math.floor((r / nRoles) * prof.ladder.length))), title = prof.ladder[level], employer = company(used), sector = pick(prof.sectors);
    const bullets = [...buckets[r], ...duties.splice(0, int(1, 3)).map((d) => d), ...general.splice(0, 1), ...wins.splice(0, 1).map(fill)];
    const narrative = [paragraphOfContext(employer, sector, title)];
    const proj = projects.splice(0, r < 3 ? 2 : 1).map((p) => ({ ...p, value: `R${int(4, 950)} million` }));
    roles.push({ employer, title, start: ym(startM), end: r === 0 ? (rnd() < 0.8 ? null : ym(endM)) : ym(endM), city: pick(CITIES), bullets, narrative, reason: r === 0 ? "" : pick(REASONS_FOR_LEAVING), projects: proj });
    month = startM - (rnd() < 0.15 ? int(2, 9) : 0);
  }
  const lastYear = Math.floor(month / 12), degs = shuffled(prof.degrees).slice(0, int(1, 3)).map((q, k) => ({ qualification: q, institution: pick(UNIVERSITIES), status: "Completed", year: lastYear - 1 + k * int(2, 5) }));
  if (rnd() < 0.2) degs.push({ qualification: `Master of ${pick(["Business Administration", "Management", "Philosophy"])}`, institution: pick(UNIVERSITIES), status: "In progress", year: 2027 });
  const certs = shuffled(prof.certs).slice(0, int(1, prof.certs.length)).map((name) => { const year = int(lastYear + 3, 2025); return { name, issuer: "", status: rnd() < 0.15 ? "Expired" : "Current", year }; });
  const courses = [...shuffled(prof.courses), "Project Management Fundamentals", "Presentation Skills", "Occupational Health and Safety Awareness", "Time Management", "Emotional Intelligence at Work", "Business Writing", "Finance for Non-Financial Managers", "Conflict Resolution"].map((name) => ({ name, year: int(lastYear + 2, 2025) })).sort((a, b) => b.year - a.year);
  const langs = shuffled(LANGUAGES).slice(0, int(2, 4)); if (!langs.includes("English")) langs[0] = "English";
  const agencyOn = layout === "agency";
  return {
    id: "", name: `${first} ${last}`, email: emailOf(first, last), phone: phoneOf(), city: pick(CITIES), family: prof.family, layout, dateStyle: pick(["Mon YYYY", "Month YYYY", "MM/YYYY", "YYYY-MM", "YYYY/MM"]), present, pdfFont: rnd() < 0.7 ? "Helvetica" : "Times", runningHeader: rnd() < 0.6,
    summary: `${prof.ladder[prof.ladder.length - 2]} with ${years} years of experience in ${prof.sectors.slice(0, 2).join(" and ")}. ${pick(["Known for clear communication and dependable delivery under pressure.", "Comfortable leading teams through change, and equally comfortable doing the detailed work.", "Combines technical depth with a practical understanding of how organisations work.", "Has built teams from small beginnings and mentored many colleagues to senior roles."])} ${pick(["Looking for a role with real responsibility.", "Open to relocation for the right position.", "Most effective where standards matter and people are trusted to do their work."])}`,
    roles, degrees: degs, certs, courses, memberships: prof.memberships, languages: langs, listedSkills: shuffled([...described, ...listedOnly].map((s) => s.name)), describedSkills: described.map((s) => s.name), listedOnly: listedOnly.map((s) => s.name), denied: denied.map((s) => s.name), absent: absent.map((s) => s.name),
    references: Array.from({ length: int(3, 5) }, () => { const f = pick(PEOPLE.first), l = pick(PEOPLE.last); return { name: `${f} ${l}`, role: pick(["Financial Director", "Managing Director", "Head of Department", "Line Manager", "Operations Executive", "Human Resources Manager"]), company: pick(roles).employer, phone: phoneOf(), email: emailOf(f, l) }; }),
    agency: agencyOn ? { name: `${pick(["Talent Bridge", "Northstar", "Bluepeak", "Kasi"])} Recruitment`, recruiter: `${pick(PEOPLE.first)} ${pick(PEOPLE.last)}`, phone: phoneOf(), email: `consultant@${pick(["talentbridge", "northstarpeople", "bluepeak"])}.example.co.za` } : undefined,
    idNumber: layout === "sa_detailed" ? `${int(60, 99)}${String(int(1, 12)).padStart(2, "0")}${String(int(1, 28)).padStart(2, "0")}${int(1000, 9999)}08${int(1, 9)}` : undefined,
    publications: layout === "academic" ? Array.from({ length: int(14, 30) }, (_, k) => `${last}, ${first[0]}., ${pick(PEOPLE.last)}, ${pick(PEOPLE.first)[0]}. (${int(lastYear + 3, 2025)}). ${pick(["Lessons from", "A review of", "Measuring", "Practical limits of", "Rethinking", "Outcomes of"])} ${pick(prof.projects).name.toLowerCase()} in ${pick(prof.sectors)}. ${pick(["South African Journal of Science", "Journal of Applied Practice", "Proceedings of the Annual Conference", "African Review of Management"])}, ${int(4, 44)}(${int(1, 6)}), ${int(10, 90)}-${int(91, 180)}.`) : [],
  };
}

function blocksOf(p: Person): Block[] {
  const out: Block[] = [], date = (x: string | null) => fmt(x, p.dateStyle, p.present), period = (r: Role) => `${date(r.start)} ${pick(["-", "–", "to"])} ${date(r.end)}`;
  const contact = (): Block[] => [{ t: "p", text: `${p.city}, South Africa` }, { t: "p", text: `Mobile: ${p.phone}` }, { t: "p", text: `Email: ${p.email}` }];
  const summaryBlock = (): Block[] => [{ t: "h1", text: pick(["PROFILE", "CAREER SUMMARY", "PROFESSIONAL SUMMARY", "Executive Summary"]) }, { t: "p", text: p.summary }];
  const skillBlock = (): Block[] => {
    const rows = p.listedSkills.map((s) => [s, pick(["Expert", "Advanced", "Proficient", "Working knowledge"]), `${int(2, 18)} years`]);
    const style = p.layout === "sidebar" ? "lines" : pick(["lines", "table", "commas"]);
    const head: Block = { t: "h1", text: pick(["KEY SKILLS", "SKILLS", "COMPETENCIES", "Technical and Professional Skills"]) };
    if (style === "table") return [head, { t: "table", head: true, rows: [["Skill", "Level", "Experience"], ...rows] }];
    if (style === "commas") return [head, { t: "p", text: p.listedSkills.join(", ") + "." }];
    return [head, ...p.listedSkills.map((text) => ({ t: "b", text }) as Block)];
  };
  const role = (r: Role, withReason: boolean): Block[] => {
    const lines: Block[] = [];
    if (p.layout === "role_tables" || p.layout === "sa_detailed") lines.push({ t: "table", rows: [["Company", r.employer], ["Position", r.title], ["Period", period(r)], ["Location", r.city], ...(withReason && r.reason ? [["Reason for leaving", r.reason]] : [])] });
    else lines.push({ t: "h2", text: pick([`${r.title} | ${r.employer} | ${period(r)}`, `${r.title}, ${r.employer}`, `${r.employer}: ${r.title}`]) }, ...(lines.length ? [] : [{ t: "small", text: `${period(r)}, ${r.city}` } as Block]));
    lines.push(...r.narrative.map((text) => ({ t: "p", text }) as Block), { t: "p", text: pick(["Key responsibilities:", "Main duties:", "Responsibilities and achievements:", "What I did:"]) }, ...r.bullets.map((text) => ({ t: "b", text }) as Block));
    for (const pr of r.projects) lines.push({ t: "p", text: `Project: ${pr.name} (value about ${pr.value}). ${pr.story}` });
    if (p.layout === "consultant") lines.push({ t: "table", head: true, rows: [["Engagement", "Team", "Duration", "Outcome"], ...r.projects.map((x) => [x.name, `${int(3, 40)} people`, `${int(3, 30)} months`, pick(["Delivered on time", "Delivered with agreed changes", "Phase one live", "Handed over to operations"])])] });
    return lines;
  };
  const education = (): Block[] => [{ t: "h1", text: pick(["EDUCATION", "QUALIFICATIONS", "Tertiary Education", "ACADEMIC QUALIFICATIONS"]) }, ...(p.layout === "sa_detailed" ? [{ t: "table", head: true, rows: [["Qualification", "Institution", "Year", "Status"], ...p.degrees.map((d) => [d.qualification, d.institution, String(d.year), d.status])] } as Block] : p.degrees.map((d) => ({ t: "p", text: `${d.qualification}, ${d.institution}, ${d.status === "Completed" ? d.year : `${d.status}, expected ${d.year}`}` }) as Block))];
  const certsB = (): Block[] => [{ t: "h1", text: pick(["CERTIFICATIONS", "PROFESSIONAL REGISTRATIONS", "Certificates"]) }, ...p.certs.map((c) => ({ t: "b", text: `${c.name} (${c.status === "Expired" ? `expired ${c.year}` : c.year})` }) as Block)];
  const coursesB = (): Block[] => [{ t: "h1", text: pick(["TRAINING AND COURSES", "SHORT COURSES", "Continuing Professional Development"]) }, { t: "table", head: true, rows: [["Course", "Year"], ...p.courses.map((c) => [c.name, String(c.year)])] }];
  const langsB = (): Block[] => [{ t: "h1", text: "LANGUAGES" }, { t: "p", text: p.languages.join(", ") }];
  const memB = (): Block[] => [{ t: "h1", text: pick(["MEMBERSHIPS", "PROFESSIONAL AFFILIATIONS"]) }, ...p.memberships.map((text) => ({ t: "b", text }) as Block)];
  const refsB = (): Block[] => [{ t: "h1", text: "REFERENCES" }, ...p.references.map((r) => ({ t: "p", text: `${r.name}, ${r.role}, ${r.company}. Tel ${r.phone}. Email ${r.email}` }) as Block)];
  const deniedB = (): Block[] => (p.denied.length ? [{ t: "h1", text: "NOTES ON EXPERIENCE" }, ...p.denied.map((s) => ({ t: "p", text: `I have no hands-on experience with ${s}, although I have worked alongside colleagues who do.` }) as Block)] : []);
  const pubs = (): Block[] => (p.publications.length ? [{ t: "h1", text: "PUBLICATIONS" }, ...p.publications.map((text) => ({ t: "p", text }) as Block)] : []);
  const workHead: Block = { t: "h1", text: pick(["EMPLOYMENT HISTORY", "WORK EXPERIENCE", "CAREER HISTORY", "Professional Experience"]) };
  const work = (order: Role[]): Block[] => [workHead, ...order.flatMap((r) => role(r, p.layout === "sa_detailed"))];
  const legal: Block = { t: "small", text: LEGAL_LINE };

  if (p.agency) out.push({ t: "title", text: p.agency.name }, { t: "p", text: "Candidate presentation prepared for our client" }, { t: "p", text: `Your consultant: ${p.agency.recruiter}, ${p.agency.phone}, ${p.agency.email}` }, { t: "p", text: `Candidate: ${p.name}` }, { t: "p", text: "We have interviewed this candidate and believe they are an excellent fit. Please direct all contact through our office." }, { t: "break" });
  if (p.layout === "sa_detailed") {
    out.push({ t: "title", text: "CURRICULUM VITAE" }, { t: "h1", text: "PERSONAL DETAILS" }, { t: "table", rows: [["Full names", p.name], ["Identity number", p.idNumber ?? ""], ["Driver's licence", "Code 08"], ["Nationality", "South African"], ["Home languages", p.languages.join(", ")], ["Residential area", p.city], ["Contact number", p.phone], ["Email address", p.email]] }, ...education(), ...skillBlock(), ...certsB(), ...coursesB(), ...work(p.roles), ...deniedB(), ...memB(), ...refsB(), legal);
  } else if (p.layout === "oldest_first") {
    out.push({ t: "title", text: p.name }, ...contact(), ...summaryBlock(), ...education(), ...work([...p.roles].reverse()), ...skillBlock(), ...certsB(), ...coursesB(), ...langsB(), ...deniedB(), ...memB(), ...refsB());
  } else if (p.layout === "functional") {
    out.push({ t: "title", text: p.name }, ...contact(), ...summaryBlock(), ...skillBlock(), ...work(p.roles), ...education(), ...certsB(), ...coursesB(), ...langsB(), ...deniedB(), ...memB(), ...refsB());
  } else if (p.layout === "academic") {
    out.push({ t: "title", text: `${p.name}: Curriculum Vitae` }, ...contact(), ...education(), ...work(p.roles), ...pubs(), ...skillBlock(), ...certsB(), ...coursesB(), ...langsB(), ...deniedB(), ...memB(), ...refsB());
  } else {
    out.push({ t: "title", text: p.name }, ...contact(), ...summaryBlock(), ...skillBlock(), ...work(p.roles), ...education(), ...certsB(), ...coursesB(), ...langsB(), ...deniedB(), ...memB(), ...refsB(), ...(rnd() < 0.5 ? [legal] : []));
  }
  return out;
}

// ---------------------------------------------------------------- Word
async function toWord(p: Person, blocks: Block[]) {
  const cell = (text: string, bold = false) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
  const borders = { top: { style: BorderStyle.SINGLE, size: 2, color: "999999" }, bottom: { style: BorderStyle.SINGLE, size: 2, color: "999999" }, left: { style: BorderStyle.SINGLE, size: 2, color: "999999" }, right: { style: BorderStyle.SINGLE, size: 2, color: "999999" }, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" } };
  const children: (Paragraph | Table)[] = blocks.map((b) => {
    if (b.t === "title") return new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.text, bold: true })] });
    if (b.t === "h1") return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: b.text, bold: true })] });
    if (b.t === "h2") return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 40 }, children: [new TextRun({ text: b.text, bold: true })] });
    if (b.t === "b") return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b.text)] });
    if (b.t === "small") return new Paragraph({ children: [new TextRun({ text: b.text, size: 18, italics: true })] });
    if (b.t === "break") return new Paragraph({ pageBreakBefore: true, children: [] });
    if (b.t === "table") return new Table({ width: { size: 9000, type: WidthType.DXA }, borders, rows: b.rows.map((r, i) => new TableRow({ children: r.map((c) => cell(c, !!b.head && i === 0)) })) });
    return new Paragraph({ spacing: { after: 90 }, children: [new TextRun(b.text)] });
  });
  const running = p.runningHeader ? { headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${p.name} | ${p.email}`, size: 16 })] })] }) } } : {};
  const footer = p.agency ? `${p.agency.name} | ${p.agency.phone} | ${p.agency.email}` : `Curriculum Vitae of ${p.name}`;
  const doc = new Document({ sections: [{ ...running, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${footer} | Page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: " of ", size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 })] })] }) }, children }] });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------- searchable PDF
const clean = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, "");
async function toPdf(p: Person, blocks: Block[]) {
  const doc = await PDFDocument.create(), regular = await doc.embedFont(p.pdfFont === "Times" ? StandardFonts.TimesRoman : StandardFonts.Helvetica), bold = await doc.embedFont(p.pdfFont === "Times" ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 54; let page: PDFPage = doc.addPage([W, H]), y = H - M - 12;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M - 12; };
  const wrap = (text: string, font: PDFFont, size: number, width: number) => { const lines: string[] = []; let cur = ""; for (const w of clean(text).split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };
  const line = (text: string, x: number, font: PDFFont, size: number, gap = size + 3.5) => { if (y < M + 14) newPage(); page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) }); y -= gap; };
  const para = (text: string, x: number, font: PDFFont, size: number, width = W - M - x) => { for (const l of wrap(text, font, size, width)) line(l, x, font, size); };
  // A true two-column first page: contact and skills down the side, the person's story beside them. Text read straight across such a page comes out mixed, which is what makes this layout a test.
  let body = blocks;
  if (p.layout === "sidebar") {
    const firstWork = blocks.findIndex((b) => b.t === "h1" && /EMPLOY|WORK|CAREER H|Professional Exp/.test(b.text)), side = blocks.slice(1, firstWork).filter((b) => b.t === "b" || b.t === "h1" && /SKILL|COMPET|Skills/.test(b.text) || b.t === "p" && /Mobile|Email|South Africa/.test(b.text)), mainTop = blocks.slice(1, firstWork).filter((b) => !side.includes(b));
    para((blocks[0] as any).text, M, bold, 18); y -= 10; const top = y; const SW = 165;
    for (const b of side) { const f = b.t === "h1" ? bold : regular; for (const l of wrap((b as any).text, f, 9.5, SW)) { page.drawText(l, { x: M, y, size: 9.5, font: f }); y -= 12.5; } y -= 2; }
    y = top;
    for (const b of mainTop) { const f = b.t === "h1" ? bold : regular, size = b.t === "h1" ? 12 : 10.5; for (const l of wrap((b as any).text, f, size, W - M - (M + SW + 20))) { page.drawText(l, { x: M + SW + 20, y, size, font: f }); y -= size + 3.5; } y -= 4; }
    y = Math.min(y, top - 300); newPage(); body = blocks.slice(firstWork);
  }
  for (const b of body) {
    if (b.t === "break") { newPage(); continue; }
    if (b.t === "title") { y -= 4; para(b.text, M, bold, 18); y -= 8; continue; }
    if (b.t === "h1") { if (y < M + 60) newPage(); y -= 10; para(b.text, M, bold, 12.5); page.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) }); y -= 5; continue; }
    if (b.t === "h2") { if (y < M + 48) newPage(); y -= 7; para(b.text, M, bold, 11); continue; }
    if (b.t === "small") { para(b.text, M, regular, 8.5); y -= 3; continue; }
    if (b.t === "b") { if (y < M + 14) newPage(); page.drawText("-", { x: M + 3, y, size: 10.5, font: regular }); para(b.text, M + 14, regular, 10.5); y -= 1.5; continue; }
    if (b.t === "table") {
      const cols = b.rows[0].length, width = (W - 2 * M) / cols;
      b.rows.forEach((r, i) => { const font = b.head && i === 0 ? bold : regular, wrapped = r.map((c) => wrap(c, font, 9.5, width - 8)), rows = Math.max(...wrapped.map((w) => w.length), 1); if (y - rows * 12.5 < M) newPage(); const top = y; wrapped.forEach((w, c) => w.forEach((l, k) => page.drawText(l, { x: M + 4 + c * width, y: top - k * 12.5, size: 9.5, font }))); y = top - rows * 12.5 - 4; page.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.25, color: rgb(0.7, 0.7, 0.7) }); });
      y -= 7; continue;
    }
    para(b.text, M, regular, 10.5); y -= 3.5;
  }
  const pages = doc.getPages(), footer = clean(p.agency ? `${p.agency.name} | ${p.agency.phone} | ${p.agency.email}` : `Curriculum Vitae of ${p.name}`);
  pages.forEach((pg, i) => {
    if (p.runningHeader) pg.drawText(clean(`${p.name} | ${p.email}`), { x: M, y: H - 34, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) });
    pg.drawText(`${footer} | Page ${i + 1} of ${pages.length}`, { x: M, y: 26, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) });
  });
  return { bytes: await doc.save(), pages: pages.length };
}

// ---------------------------------------------------------------- a job description in the same world
function jobBlocks(id: string, prof: Profession, j: Profession["jobs"][0], employer: string, city: string): { blocks: Block[]; key: any } {
  const blocks: Block[] = [
    { t: "title", text: j.title }, { t: "p", text: `${employer}, ${city}` },
    { t: "h1", text: "Role purpose" }, { t: "p", text: `${employer} is looking for a ${j.title} to join a growing team in ${prof.sectors[0]}. The role carries real responsibility for outcomes, works closely with colleagues across the business, and reports to the head of the function.` },
    { t: "h1", text: "Key responsibilities" }, ...prof.duties.slice(0, 6).map((text) => ({ t: "b", text }) as Block),
    { t: "h1", text: "Essential requirements" }, { t: "b", text: `At least ${j.years} years of relevant experience` }, { t: "b", text: `${j.qualification} or equivalent` }, ...j.must.map((s) => ({ t: "b", text: `Experience with ${s}` }) as Block),
    { t: "h1", text: "Desirable experience" }, ...j.nice.map((s) => ({ t: "b", text: `Experience with ${s}` }) as Block),
    { t: "h1", text: "Location" }, { t: "p", text: `${city}, with some travel between sites.` },
  ];
  return { blocks, key: { id, synthetic: true, title: j.title, employer, role_family: prof.family, adjacent_families: prof.adjacent, minimum_experience_years: j.years, required_skills: j.must, preferred_skills: j.nice, qualification: j.qualification, location: city, source_sections: {} } };
}

// ---------------------------------------------------------------- writing it all out
const dirs = ["01_Word", "02_Searchable_PDF", "Reference/Expected_CVs", "Reference/Expected_Jobs", "Jobs/01_Word", "Jobs/02_Searchable_PDF"].map((d) => join(outDir, d));
for (const d of dirs) mkdirSync(d, { recursive: true });
const count = Number(howMany), manifest: any[] = [];
// One person's random choices depend only on who they are, so a run that stops part way, or starts part way (CV_FROM), makes the same people. The first three CVs in the store predate this and are kept as they are.
const SEED = Number(seedArg ?? 20261105) >>> 0, FROM = Number(process.env.CV_FROM ?? 0);
for (let i = FROM; i < count; i++) {
  state = (SEED + Math.imul(i + 1, 2654435761)) >>> 0;
  state = (Number(seedArg ?? 20261105) + i * 7919) >>> 0;   // each person's own stream, so a pack can be added to and rebuilt exactly
  const prof = PROFESSIONS[i % PROFESSIONS.length], id = `CV${String(7001 + i)}`;
  const p = person(i, prof);
  // Written role by role until the document is long enough, newest roles first, as a person gives most space to recent work. Target length differs per person: 15 to 30 pages.
  const target = int(15, 30), banned = [...p.denied, ...p.absent, ...p.listedOnly], sector = pick(prof.sectors);
  let blocks = blocksOf(p), pdf = await toPdf(p, blocks), incomplete = false;
  const aspectOf = (round: number) => `${ASPECTS[round % ASPECTS.length]}${round >= 3 ? " (a different episode from any you might have told before)" : ""}`;
  outer: for (let round = 0; round < 8 && pdf.pages < target; round++) {
   if (round * 3 + 2 >= ASPECTS.length * 8) break;
   const roles = [...p.roles.entries()];
   await Promise.all(Array.from({ length: WRITERS }, async () => { for (let next = roles.shift(); next; next = roles.shift()) await written(`${id}:${next[0]}:${round}`, next[1], sector, p.describedSkills, banned, aspectOf(round)).catch((e) => console.error(`not written: ${e.message}`)); }));
   for (const [k, r] of p.roles.entries()) {
    const text = await written(`${id}:${k}:${round}`, r, sector, p.describedSkills, banned, aspectOf(round));
    if (!text) { incomplete = true; break outer; }
    for (const para of text.split(/\n+/).filter((x) => x.trim().length > 40)) r.narrative.push(para.trim());
    blocks = blocksOf(p); pdf = await toPdf(p, blocks);
    if (pdf.pages >= target) break outer;
   }
  }
  if (incomplete || pdf.pages < 15) { console.log(`${id}: ${pdf.pages} pages, not long enough yet, left out`); continue; }
  writeFileSync(join(outDir, "01_Word", `${id}.docx`), await toWord(p, blocks));
  writeFileSync(join(outDir, "02_Searchable_PDF", `${id}.pdf`), pdf.bytes);
  writeFileSync(join(outDir, "Reference/Expected_CVs", `${id}.json`), JSON.stringify({ id, synthetic: true, name: p.name, title: p.roles[0].title, role_family: p.family, location: p.city, email: p.email, phone: p.phone, summary: p.summary, skills: p.listedSkills, skills_described: p.describedSkills, skills_listed_only: p.listedOnly, skills_denied: p.denied, skills_absent: p.absent,
    work_history: p.roles.map((r) => ({ employer: r.employer, title: r.title, start: r.start, end: r.end })), education: p.degrees, certifications: p.certs, languages: p.languages, memberships: p.memberships, references: p.references, agency: p.agency ?? null, id_number_present: !!p.idNumber, layout: p.layout, date_style: p.dateStyle, pages: pdf.pages, publications: p.publications.length }, null, 1));
  manifest.push({ id, family: p.family, layout: p.layout, pages: pdf.pages, roles: p.roles.length, skills: p.listedSkills.length, font: p.pdfFont });
}
let jn = 0;
state = SEED;
for (const prof of PROFESSIONS) for (const j of prof.jobs) {
  const id = `JD${String(7001 + jn++)}`, employer = `${pick(COMPANY_WORDS.first)} ${pick(COMPANY_WORDS.last)}`, city = pick(CITIES), { blocks, key } = jobBlocks(id, prof, j, employer, city);
  const fake = { name: j.title, email: "", runningHeader: false, pdfFont: "Helvetica", agency: undefined } as unknown as Person, pdf = await toPdf(fake, blocks);
  writeFileSync(join(outDir, "Jobs/01_Word", `${id}.docx`), await toWord(fake, blocks));
  writeFileSync(join(outDir, "Jobs/02_Searchable_PDF", `${id}.pdf`), pdf.bytes);
  writeFileSync(join(outDir, "Reference/Expected_Jobs", `${id}.json`), JSON.stringify(key, null, 1));
}
const earlier = existsSync(join(outDir, "Reference/manifest.json")) ? JSON.parse(readFileSync(join(outDir, "Reference/manifest.json"), "utf8")).filter((m: any) => !manifest.some((x) => x.id === m.id)) : [];
writeFileSync(join(outDir, "Reference/manifest.json"), JSON.stringify([...earlier, ...manifest], null, 1));
const pages = manifest.map((m) => m.pages).sort((a, b) => a - b);
console.log(`${manifest.length} CVs, ${jn} jobs. Pages: min ${pages[0]}, median ${pages[pages.length >> 1]}, max ${pages[pages.length - 1]}. Layouts: ${[...new Set(manifest.map((m) => m.layout))].length}. Professions: ${PROFESSIONS.length}.`);
process.exit(0);
