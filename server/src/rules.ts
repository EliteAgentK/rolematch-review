// RoleMatch's own, deterministic CV and job-description parser. No outside service, no cost, nothing leaves the machine.
// It reads document structure (headings, dates, bullets). It never guesses: if it cannot tell, the field stays empty.
import { BULLET_ITEM } from "./bullets";
import { runStep, type StepReport } from "./cvPlan";
import { cleanInvisible } from "./invisible";
import { PRESENT_WORDS } from "./dates";
import { classifyQualification, DESIGNATIONS, splitCertificate, statusCue } from "./qualifications";
import { isPlaceName } from "./geo";
import { findSkills, isKnownSkillForm, quoteFor, segmentSkills } from "./skills";
import { SKILLS as ALL_SKILLS } from "./skills";
const ALL_SKILL_NAMES = ALL_SKILLS.map((x) => x.name);
import { extractionConfig as readingConfig } from "./extractionConfig";
import { canonicalRoleLines, ROLE_CELL, WRITTEN } from "./roleForms";
import { ruleset } from "./ruleset";

// ---------------------------------------------------------------- shared helpers
const BULLET = BULLET_ITEM;   // every bullet glyph real CVs use
/** A bullet drawn apart from its text reads with column marks around it: "| • | Prepare the accounts". */
const stripBullet = (l: string) => { let t = l, was; do { was = t; t = t.replace(/^\s*\|\s*/, "").replace(BULLET, ""); } while (t !== was); return t.trim(); };
const isBullet = (l: string) => BULLET.test(l);
const clean = (l: string) => l.replace(/[ \t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/** A line longer than this is cut at a space, so no single line can make the pattern matching slow (a document is hostile input until proven otherwise). */
const LONG_LINE = 3000, CUT_AT = 2000;
const chopLong = (line: string): string[] => {
  const out: string[] = [];
  while (line.length > LONG_LINE) {
    const at = line.lastIndexOf(" ", CUT_AT);
    const cut = at > CUT_AT / 2 ? at : CUT_AT;
    out.push(line.slice(0, cut)); line = line.slice(cut).trimStart();
  }
  out.push(line);
  return out;
};

export function toLines(text: string): string[] {
  // Tab stops in Word documents are column separators
  return cleanInvisible(text).text.split("\n").flatMap(chopLong).map((l)=>clean(l.replace(/\t+/g," | "))).filter(Boolean);
}

const norm = (l: string) => l.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z& ]/g, " ").replace(/\s+/g, " ").trim();

type Section = "contact" | "summary" | "skills" | "experience" | "education" | "projects" | "certifications" | "languages" | "notable" | "other";

const SKILLS_BY_NAME = new Set(ALL_SKILL_NAMES.map((x) => x.toLowerCase()));
export const CV_HEADINGS: [Section, RegExp][] = [
  ["summary", /^(professional |career |personal |executive |technical |core |profile )?(summary|profile|about me|about|objective|overview|statement|introduction)$|^(profiel|oor my|oorsig|opsomming|doelwit|loopbaandoelwit)$|^(perfil|resumo|sobre mim|objetivo|objectivo|apresentacao)$/],
  ["skills", /^((key|core|technical|professional|it|relevant|top) )?(skills|competenc(?:ies|y)|technologies|expertise|tech stack|technical (skills|proficiencies)|skills (&|and) (tools|technologies|expertise)|tools (&|and) technologies|capabilities)( (summary|profile))?$|^(vaardighede|kundighede|bevoegdhede|tegniese vaardighede|sleutelvaardighede)$|^(competencias|habilidades|aptidoes|competencias tecnicas)$/],
  ["experience", /^((professional|work|employment|career|relevant|industry) )?(experience|history)$|^(where i (have )?worked|work i have done|jobs i have (had|held)|my (work )?(experience|history)|work background|employment record|positions held|(professional|career|executive) appointments|appointments held)$|^(work experience|employment history|career history|professional experience|work history|experience|employment)$|^(werkservaring|werk ervaring|werksgeskiedenis|ervaring|beroepservaring|loopbaan|loopbaangeskiedenis)$|^(experiencia profissional|experiencia|percurso profissional|historico profissional)$/],
  ["education", /^(education|my education|school|schooling|academic (background|qualifications|history|records?)|educational (background|qualifications|history)|education history|qualifications|qualifications (&|and) training|education (&|and) (training|qualifications)|training (&|and) education|academic|studies)$|^(opleiding|kwalifikasies|onderwys|opvoeding|akademiese kwalifikasies|akademiese agtergrond)$|^(formacao|formacao academica|educacao|habilitacoes|habilitacoes literarias)$/],
  ["projects", /^((current|recent|selected|key|personal|notable|technical|side|self-initiated)( (technical|personal))? )?(projects|portfolio)( (&|and) (delivery|work))?$|^projects and delivery$|^(selected|key|notable) (technical )?(systems|projects|work|delivery|production delivery)( (&|and) (projects|delivery|work|systems))?$|^selected production delivery$|^projekte$|^projetos$/],
  ["certifications", /^(certifications?|certificates?|licen[sc]es?( (&|and) certifications?)?|courses|training|professional development|accreditations?|(professional )?registrations?( (&|and) (certifications?|licen[sc]es?|accreditations?))?)$|^(sertifikate|kursusse|opleidingskursusse)$|^(certificacoes|cursos|formacao complementar)$/],
  ["languages", /^(languages?|language skills)$|^(tale|taalvaardigheid)$|^(idiomas|linguas)$/],
  ["notable", /^(awards?( (&|and) (honou?rs|achievements))?|achievements?|key achievements|accomplishments|honou?rs|volunteer(ing)?( (work|experience))?|publications?|open source( contributions?)?|board (membership|memberships|positions|appointments)|directorships?|leadership( (&|and) activities)?|extracurricular( activities)?|community( involvement)?|worth noting|additional (information|experience))$|^(prestasies|toekennings|vrywilligerswerk|uitkenning)$|^(premios|voluntariado|conquistas)$/],
  ["contact", /^(contact( details| information| me)?|personal (details|information)|details)$|^(kontak|kontakbesonderhede|persoonlike besonderhede|persoonlike inligting|besonderhede)$|^(contacto|contactos|dados pessoais)$/],
  ["other", /^(references?|interests?|hobbies|declaration)$|^(verwysings|belangstellings|stokperdjies|verklaring)$|^(referencias|interesses|declaracao)$/],
];

// Words that make up section headings. Used to re-split headings whose letters were spaced out ("W O R K  E X P E R I E N C E").
const HEADING_VOCAB = new Set(("where worked jobs held had done positions record i my have profile summary about me objective overview statement professional career personal executive skills key core technical competencies competency technologies expertise experience work employment history education academic background qualifications studies projects portfolio selected notable certifications certificates licenses licences courses training development languages language awards achievements accomplishments volunteer volunteering publications leadership references interests hobbies declaration contact details information and relevant industry tools capabilities proficiencies profiel oorsig opsomming vaardighede kundighede werkservaring werksgeskiedenis ervaring opleiding kwalifikasies onderwys projekte sertifikate kursusse tale prestasies verwysings kontak besonderhede persoonlike inligting perfil resumo sobre mim objetivo competencias habilidades experiencia profissional formacao academica educacao projetos certificacoes cursos idiomas linguas premios voluntariado referencias contacto dados pessoais").split(" "));
function resegment(compact: string): string | null {
  const s = compact.toLowerCase();
  const best: (string[] | null)[] = Array(s.length + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= s.length; i++) for (let j = Math.max(0, i - 14); j < i; j++) {
    const prev = best[j];
    if (prev && HEADING_VOCAB.has(s.slice(j, i)) && (!best[i] || prev.length + 1 < best[i]!.length)) best[i] = [...prev, s.slice(j, i)];
  }
  return best[s.length] ? best[s.length]!.join(" ") : null;
}

function headingOf(rawLine: string, table: [string, RegExp][]): string | null {
  // "3. Work Experience" and "Experience:" are headings too
  const line = rawLine.replace(/^\d{1,2}[.)]\s+/, "").replace(/\s*:$/, "");
  // Headings never start in lowercase: a wrapped word such as "leadership" is not a section.
  if (line.length > 48 || isBullet(line) || /[.]$/.test(line) || !/^[\p{Lu}\d]/u.test(line)) return null;
  const n = norm(line);
  if (!n) return null;
  for (const [name, re] of table) if (re.test(n)) return name;
  // A heading whose spaces were lost: WORKEXPERIENCE
  if (!n.includes(" ") && n.length >= 6) {
    const seg = resegment(n);
    if (seg) for (const [name, re] of table) if (re.test(seg)) return name;
  }
  return null;
}

const LABEL_LINE = /^(key skills|core skills|technical skills|skills|languages?|certifications?|education|school|schooling|qualifications|about me|about myself|personal profile|profile|summary|objective|interests|hobbies|references)\s*:\s*(.+)$/i;

export function splitSections<S extends string>(lines: string[], table: [S, RegExp][], unnamed?: (index: number) => S | null) {
  const header: string[] = [];
  const sections = new Map<S, string[]>();
  let current: S | null = null;
  let openedByHeading = false;
  const openedByHeadingFor = new Set<S>(); // sections that have a real heading somewhere
  const open = (h: S, byHeading: boolean) => { current = h; openedByHeading = byHeading; if (byHeading) openedByHeadingFor.add(h); if (!sections.has(h)) sections.set(h, []); };
  const put = (line: string) => { if (current === null) header.push(line); else sections.get(current)!.push(line); };
  let wrapped: { section: S; before: S | null; beforeHeading: boolean } | null = null; // a label line that has not ended its sentence yet
  for (const [index, line] of lines.entries()) {
    if (wrapped) { // the previous label line wrapped: this line continues it
      const w = wrapped; wrapped = null;
      if (!headingOf(line, table as [string, RegExp][]) && /^[\p{Ll}]/u.test(line)) { sections.get(w.section)!.push(line); continue; }
    }
    const h = headingOf(line, table as [string, RegExp][]) as S | null;
    if (h) { open(h, true); continue; }
    const other = unnamed?.(index);
    if (other) { open(other, true); continue; }
    // "SKILLS TypeScript, React..." : an UPPERCASE heading followed by its content on the same line
    const words = line.split(" ");
    let split = false;
    for (let n = Math.min(3, words.length - 1); n >= 1 && !split; n--) { // longest first, so "ABOUT ME: ..." is read as a heading with its text, not as "ABOUT" then "ME: ..."
      const lead = words.slice(0, n).join(" ").replace(/:$/, "");
      if (!/^[A-ZÀ-Þ&]{3,}(?: [A-ZÀ-Þ&]{2,})*$/.test(lead)) continue;
      const hh = headingOf(lead, table as [string, RegExp][]) as S | null;
      if (hh) { open(hh, true); put(words.slice(n).join(" ").replace(/^[|:\s]+/, "")); split = true; }
    }
    if (split) continue;
    // "Key skills: A, B, C." : a labelled run-in line becomes its own section, unless we are already inside a real skills section
    const lab = line.match(LABEL_LINE);
    if (lab && !(current === "skills" && openedByHeading)) {
      const hh = headingOf(lab[1], table as [string, RegExp][]) as S | null;
      if (hh) {
        // A label with no real heading owns only its own line; what follows belongs to whatever section was open before.
        const before: S | null = current, beforeHeading: boolean = openedByHeading;
        open(hh, false); put(lab[2]);
        if (!openedByHeadingFor.has(hh)) { current = before; openedByHeading = beforeHeading; }
        if (!/[.!?]$/.test(lab[2])) wrapped = { section: hh, before, beforeHeading };
        continue;
      }
    }
    put(line);
  }
  return { header, sections };
}

// ---------------------------------------------------------------- tidying the raw text
const ICONS = /^[\p{Extended_Pictographic}\uFE0F\u200d\u2302\u260e\u2706]+\s*/u;

/** Cleans layout artefacts that PDF and Word extraction leave behind, before any structure is read. */
// Personal details that must never reach a record: ID number, date of birth, gender, marital status, nationality, race, religion, health, dependants, age.
// They are removed before anything else reads the CV, so no section, summary or skill can pick them up. (A driver's licence is a credential and is kept.)
const PROTECTED = /^(?:id(?:entity)?\s*(?:number|no\.?|document)|date of birth|d\.?o\.?b\.?|birth\s?date|born(?: on)?|gender|sex|marital status|civil status|nationality|citizenship|passport(?:\s*(?:number|no\.?))?|religion|race|ethnicity|population group|disabilit(?:y|ies)|health(?: status)?|next of kin|dependants?|age|(?:driver.?s?\s+)?licen[sc]e)\s*[:\-–]/i;   // a labelled licence line ("Driver's licence: Code 08") is a personal-details line; a licence in a Certifications list is a credential and is kept
function stripProtected(lines: string[]): string[] {
  return lines.flatMap((line) => {
    if (/(?<!\d)\d{13}(?!\d)/.test(line.replace(/[\s-]/g, ""))) { if (/id|identity/i.test(line) || /^\d[\d\s-]{12,}\d$/.test(line.trim())) return []; }
    const parts = line.split(/\s*\|\s*|\s{3,}|\s*;\s*/).filter(Boolean);
    const keep = parts.filter((p) => !PROTECTED.test(p.trim()));
    if (keep.length === parts.length) return [line];
    const kept = keep.filter((p) => !/^(?:driver.?s?\s+)?licen[sc]e\s*[:\-–]/i.test(p.trim()));   // on a personal-details line, the licence is one more personal detail
    return kept.length ? [kept.join(" | ")] : [];
    // a line that is a run of "label: value" facts with no separators ("Gender: Female Marital status: Married") is dropped whole when it starts with one
    return keep.length ? [keep.join(" | ")] : [];
  });
}

// A role table of two columns, read row by row: "Junior Analyst | Analysed cash flow", "Oakridge Services | Reviewed statements", "2024-02 to Present | Prepared summaries".
// Its heading row says so. Each column is put back together: who and when first, as a role is usually written, then the duties under it.
const ROLE_TABLE_HEAD = /^\s*(?:(?:role|position|job|title|employer|company|period|dates?)\b[\w\s,&/]*)\s*\|\s*(?:(?:key\s+)?(?:responsibilit\w+|duties|achievements?|what i did|work done)[\w\s,&/]*)$/i;
export function unfoldRoleTables(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ROLE_TABLE_HEAD.test(lines[i])) { out.push(lines[i]); continue; }
    // the table runs while rows have two cells, or a single sentence continues the right column
    let who: string[] = [], duties: string[] = [], j = i + 1;
    const flush = () => { if (who.length || duties.length) { out.push(who.join(" | "), ...duties.map((d) => `- ${d}`)); } who = []; duties = []; };
    for (; j < lines.length; j++) {
      const cells = lines[j].split(/\s+\|\s+/);
      if (cells.length === 2) {
        // a new role begins with a new left cell after the dates of the last one, unless it says how the role was held
        const heldAs = /^(permanent|fixed[- ]term|contract|temporary|part[- ]time|full[- ]time|freelance|casual|internship|volunteer)\b/i.test(cells[0]);
        if (who.some((c) => findRange(c)) && !heldAs) flush();
        if (heldAs) duties.push(cells[1]); else { who.push(cells[0]); duties.push(cells[1]); }
      } else if (cells.length === 1 && /[.;!?]$/.test(lines[j].trim()) && who.length) duties.push(lines[j].trim());
      else break;
    }
    flush(); i = j - 1;
  }
  return out;
}

/** "Analyst | Riverstead | 2024-02 to Present Permanent Prepared daily cash" / "position reports. Updated forecasts." A role written straight into its duties: the role becomes its own line, and what follows it its duties, a sentence each. */
const HELD_AS = /^(?:permanent|fixed[- ]term(?: contract)?|contract|contractor|temporary|part[- ]time|full[- ]time|freelance|casual|internship|volunteer)\b\s*/i;
/** A cell-by-cell role line at the start of this text: "Title | Employer | 2020-01 to 2022-01 ...". The dates are a later cell, starting it. */
const startsWithRole = (s: string) => { const cells = s.split(/\s*\|\s*/); if (cells.length < 2 || /[.!?]/.test(cells[0]) || cells[0].length > 90) return false; return cells.slice(1, 3).some((c) => findRange(c)?.index === 0); };
/** Where the last sentence of a line ended: what follows may be the start of a role that the page wrapped. */
const afterLastSentence = (l: string) => { let at = 0; for (const m of l.matchAll(/[.!?]\s+/g)) at = m.index! + m[0].length; return at; };
/** A line the page wrapped runs close to its width: a short line that ends in a few capitalised words simply ended there. */
const WRAPPED_LINE = 50;
/** A title on its way to the next line is a few capitalised words, nothing else. */
const looksLikeTitleStart = (s: string) => s.length <= 60 && s.split(/\s+/).length <= 6 && /^\p{Lu}/u.test(s) && !/[,:;()]/.test(s);
/** A whole career written as one paragraph, wrapped wherever the page ended: "...reviews. Data Engineer | Ashcombe" / "Services | 2012-08 to 2019-01 Permanent Resolved...". Each role is put back at the start of its own line, whole, for unfoldRunInRoles. Only where a sentence ended before it and dates are one of its cells. */
export function separateRunTogetherRoles(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    // A role that the page wrapped: what follows the last sentence here, and the next line, make up a role line.
    const next = lines[i + 1];
    if (next !== undefined && next.trim()) {
      const at = afterLastSentence(l), tail = l.slice(at).trim();
      if (tail && !startsWithRole(tail) && startsWithRole(`${tail.replace(/\|$/, "| ")}${tail.endsWith("|") ? "" : " "}${next.trim()}`) && (tail.includes("|") || (at > 0 && l.length >= WRAPPED_LINE && looksLikeTitleStart(tail)))) {
        lines = [...lines]; lines[i + 1] = `${tail} ${next.trim()}`; l = l.slice(0, at).trim();
        if (!l) continue;
      }
    }
    // Roles inside the line: after any sentence, where a role line begins.
    let from = 0; const parts: string[] = [];
    for (const m of l.matchAll(/[.!?]\s+/g)) { const start = m.index! + m[0].length; if (startsWithRole(l.slice(start))) { parts.push(l.slice(from, start).trim()); from = start; } }
    parts.push(l.slice(from).trim());
    out.push(...(parts.length > 1 ? parts.filter(Boolean) : [l]));
    // Dates ending the line, and how the role was held opening the next one: they belong together.
    const last = out[out.length - 1], cells = last.split(/\s+\|\s+/), r = cells.length >= 2 ? findRange(cells[cells.length - 1]) : null;
    if (r && r.index === 0 && r.full.length === cells[cells.length - 1].trim().length && lines[i + 1] && HELD_AS.test(lines[i + 1].trim())) { lines = [...lines]; lines[i + 1] = `${last} ${lines[i + 1].trim()}`; out.pop(); }
  }
  return out;
}
export function unfoldRunInRoles(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], cells = l.split(/\s+\|\s+/), last = cells[cells.length - 1], r = cells.length >= 2 ? findRange(last) : null;
    const after = r && r.index === 0 ? last.slice(r.full.length).trim() : "";
    if (!after) { out.push(l); continue; }
    const rest = after.replace(HELD_AS, "");
    let paragraph = rest;
    if (!rest) { out.push(`${cells.slice(0, -1).join(" | ")} | ${r!.full}`); continue; }
    // it runs on over the next lines until its sentence ends and something else begins
    while (i + 1 < lines.length && !lines[i + 1].includes("|") && !findRange(lines[i + 1]) && (!/[.!?]$/.test(paragraph.trim()) || /^\p{Ll}/u.test(lines[i + 1]) || (/[.!?]$/.test(lines[i + 1].trim()) && lines[i + 1].length > 40))) paragraph += ` ${lines[++i].trim()}`;
    out.push(`${cells.slice(0, -1).join(" | ")} | ${r!.full}`, ...paragraph.split(/(?<=[.!?])\s+(?=\p{Lu})/u).map((x) => `- ${x.trim()}`));
  }
  return out;
}

// A CV of labelled tables, as many South African CVs are: "Contact number | 071 ..." on one line from a PDF, or the label and its value on separate lines from Word. Each row is rewritten to the plain form the reader knows, by what its label says (configuration: extractionConfig.labelledFacts). An identity number and the like are dropped here: the platform has no use for them and should not hold them.
export function unfoldLabelledFacts(lines: string[]): string[] {
  const F = readingConfig.labelledFacts, low = (l: string) => l.trim().toLowerCase().replace(/:$/, ""), known = new Set(Object.values(F).flat().map((x) => x.toLowerCase()));
  const kindOf = (label: string) => (Object.keys(F) as (keyof typeof F)[]).find((k) => F[k].some((x) => x.toLowerCase() === label));
  // one row, whichever way it was written
  const rows: { label?: string; value: string; raw: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], bar = l.match(/^\s*([^|:]{2,30}?)\s*(?:\||:)\s*(.+)$/);
    if (bar && known.has(low(bar[1]))) { rows.push({ label: low(bar[1]), value: bar[2].trim(), raw: l }); continue; }
    // A label on its own line with its value on the next, as Word gives a table. A word that also heads a section ("Languages") stays a heading: what is under it is read as a list.
    if (known.has(low(l)) && !headingOf(l, CV_HEADINGS as [string, RegExp][]) && lines[i + 1] !== undefined && !known.has(low(lines[i + 1])) && lines[i + 1].length <= 120 && !/^[\p{Lu} &]{5,}$/u.test(lines[i + 1]) && !lines[i + 1].includes("|")) { rows.push({ label: low(l), value: lines[++i].trim(), raw: l }); continue; }
    rows.push({ value: l, raw: l });
  }
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], kind = r.label ? kindOf(r.label) : undefined;
    if (!kind) { out.push(r.raw); continue; }
    if (kind === "drop") continue;
    if (kind === "name") { out.unshift(r.value); continue; }   // the person's name leads the document, as the reader expects
    if (kind === "phone") { out.push(`Phone: ${r.value}`); continue; }
    if (kind === "email") { out.push(`Email: ${r.value}`); continue; }
    if (kind === "languages") { out.push(`Languages: ${r.value}`); continue; }
    // A run of rows about one role: who, what and when, in whatever order. A place on its own is where the person lives; within a role it is where the role was, and is left out, as is why they left.
    const group: Record<string, string> = {}; let j = i;
    for (; j < rows.length; j++) { const k = rows[j].label ? kindOf(rows[j].label!) : undefined; if (!k || !["employer", "position", "period", "place", "leaving"].includes(k) || (group[k] && k !== "place" && k !== "leaving")) break; group[k] = rows[j].value; }
    if (group.position && group.period) { out.push([group.position, group.employer, group.period].filter(Boolean).join(" | ")); i = j - 1; continue; }
    if (kind === "place") out.push(`Location: ${r.value}`); else out.push(r.raw);
  }
  return out;
}
/** "Course | Year" over "Presentation Skills | 2024": the row naming a table's columns. It holds no fact about the person. */
export function withoutTableHeadRows(lines: string[]): string[] {
  const cells = (l: string) => l.split(/\s+\|\s+/);
  return lines.filter((l, i) => { const c = cells(l), next = lines[i + 1]; if (c.length < 2 || !next) return true; const n = cells(next); return !(n.length === c.length && c.every((x) => /^\p{Lu}[\p{L}/ ]*$/u.test(x) && x.split(/\s+/).length <= 2) && (/\d/.test(next) || next.length > l.length + 12) && !DEGREE.test(c[0]) && !ROLE_WORD.test(c[0]) && !findRange(next)); });
}
function tidyLines(input: string[]): string[] {
  // a page number line ("Page 1 of 2", "Page1of 2", "2 / 3" alone) is furniture, never part of a section (it would otherwise sit at the end of the section above it)
  input = input.filter((l) => !/^\s*page\s*\d{1,2}\s*(?:of|\/)\s*\d{1,2}\s*$/i.test(l));
  let lines = input.map((l) => { let x = l; while (ICONS.test(x)) x = x.replace(ICONS, ""); return x.replace(/\s+[\p{Extended_Pictographic}\u2709\u260e\u2302\u2706\u2315]\uFE0F?\s+/gu, " | ").trim(); }).filter(Boolean);

  // A running header: the top three lines (name, headline, contact line) printed again at the start of a later page. Repeats are dropped, because they would
  // otherwise sit inside whichever section the previous page ended with.
  {
    const key = (l: string) => l.toLowerCase().replace(/[^a-z0-9@]/g, "");
    const head = lines.slice(0, 3).map(key);
    if (lines.length > 8 && head.every((k) => k.length >= 4) && /@|\d{3}/.test(lines[2])) {
      for (let i = 3; i + 2 < lines.length; i++) if (key(lines[i]) === head[0] && key(lines[i + 1]) === head[1] && key(lines[i + 2]) === head[2]) { lines.splice(i, 3); i--; }
    }
  }

  // A page printed twice (a scan of the same sheet twice, a CV pasted into itself): a run of four or more lines that repeats an earlier run is dropped, so
  // nothing is read twice and the two copies are never joined into one invented line.
  {
    const key = (l: string) => l.toLowerCase().replace(/[^a-z0-9]/g, ""), keys = lines.map(key), W = 4, seen = new Map<string, number>();
    const remove = new Set<number>();
    for (let i = 0; i + W <= keys.length; i++) {
      const window = keys.slice(i, i + W);
      if (window.join("").length < 80 || window.some((k) => k.length < 3)) continue;
      const id = window.join("|"), first = seen.get(id);
      if (first === undefined) { seen.set(id, i); continue; }
      if (i < first + W) continue;                               // overlapping itself: a list that repeats a pattern, not a second copy
      let j = 0; while (i + j < keys.length && first + j < i && keys[i + j] === keys[first + j]) j++;
      for (let k = 0; k < j; k++) remove.add(i + k);
      i += j - 1;
    }
    if (remove.size) lines = lines.filter((_, i) => !remove.has(i));
  }

  // Designer letter-spacing: "P R O F I L E" becomes PROFILE (word gaps are lost, so headings are re-split later).
  const spaced = (l: string) => { const tok = l.split(" ").filter(Boolean); return tok.length >= 4 && tok.filter((t) => t.length === 1).length / tok.length >= 0.8; };
  const wasSpaced = lines.map(spaced);
  lines = lines.map((l, i) => (wasSpaced[i] ? l.split(" ").filter(Boolean).join("") : l));
  // "E D U C A T I O N  A N D" / "T R A I N I N G" is ONE heading that wrapped: its two halves are joined (the word gap was lost with the letter gaps)
  // (joined only when the two halves together read as a heading and the first does not on its own: a name is never joined)
  for (let i = lines.length - 2; i >= 0; i--) if (wasSpaced[i] && wasSpaced[i + 1] && lines[i].length + lines[i + 1].length <= 40 && (!resegment(lines[i].toLowerCase()) || /and$/i.test(lines[i])) && resegment((lines[i] + lines[i + 1]).toLowerCase().replace(/:$/, ""))) { lines[i] = lines[i] + lines[i + 1]; lines.splice(i + 1, 1); wasSpaced.splice(i + 1, 1); }

  // A heading that wrapped after its "&" / "and" ("EDUCATION |" / "& QUALIFICATIONS" is read the same way): joined when every word is a heading word
  for (let i = lines.length - 2; i >= 0; i--) {
    const a = lines[i].replace(/\s*\|\s*$/, ""), b = lines[i + 1];
    if (/^\p{Lu}[\p{L} ]{2,30}\s+(?:&|and)$/iu.test(a) || /^\p{Lu}[\p{L} ]{2,30}\s*\|\s*(?:&|and)$/iu.test(lines[i])) {
      const joinedText = (a.replace(/\s*\|\s*(?=(?:&|and)$)/i, " ") + " " + b).replace(/:$/, "");
      if (/^\p{Lu}[\p{L} &]{5,60}$/u.test(joinedText) && joinedText.toLowerCase().split(/\s+/).every((w) => w === "&" || HEADING_VOCAB.has(w))) { lines[i] = joinedText + (b.endsWith(":") ? ":" : ""); lines.splice(i + 1, 1); wasSpaced.splice(i + 1, 1); }
    }
  }

  // A qualification name cut after its first word by a narrow column: "University of Cape Town - National" / "Diploma in Marketing (2016 - 2019)"
  lines = lines.reduce<string[]>((acc, l) => { const prev = acc[acc.length - 1]; if (prev !== undefined && /\b(?:National|Higher|Advanced|Postgraduate|Professional|Honours|Bachelor|Master|Associate|Executive)$/.test(prev) && /^(?:Diploma|Certificate|Degree|Programme|Course)\b/.test(l)) acc[acc.length - 1] = `${prev} ${l}`; else acc.push(l); return acc; }, []);

  // A line that ends on a separator ("BSc Computer Science |") continues on the next one
  lines = lines.reduce<string[]>((acc, l) => { const prev = acc[acc.length - 1]; if (prev !== undefined && /\S\s\|$/.test(prev) && !isBullet(l) && !/^\p{Lu}[\p{Lu} &]{3,}:?$/u.test(l)) acc[acc.length - 1] = `${prev} ${l}`; else acc.push(l); return acc; }, []);

  // A date range wrapped over two lines: "Mar 2021 –" / "Present"
  const joinStart = new RegExp(`(?:${DATE})\\s*(?:-|–|—|to|until|till)\\s*$`, "i");
  const joinEnd = new RegExp(`^(?:${END})\\s*$`, "i");
  const joined: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (joinStart.test(lines[i]) && i + 1 < lines.length && joinEnd.test(lines[i + 1])) { joined.push(`${lines[i]} ${lines[i + 1]}`); i++; }
    else joined.push(lines[i]);
  }
  lines = joined;
  // "Dec '19 - Aug" / "'22": a date range cut in the middle of its end date by a narrow column
  const cutEnd = new RegExp(`(?:${DATE})\\s*(?:-|–|—|to|until|till)\\s*[A-Za-z]{3,9}\\.?$`, "i");
  lines = lines.reduce<string[]>((acc, l) => { const prev = acc[acc.length - 1]; if (prev !== undefined && cutEnd.test(prev) && /^'?\d{2}(?:\d{2})?\s*$/.test(l)) acc[acc.length - 1] = `${prev} ${l}`; else acc.push(l); return acc; }, []);

  // A name cut in two by a narrow column. Two shapes are recognised, and nothing else is joined here:
  //   an institution: "BCom Accounting | Tshwane" / "University of Technology | 2005 -"
  //   an employer after "at": "Senior Nurse at Cobalt" / "Digital, 12/2024 - 09/2026"
  lines = lines.reduce<string[]>((acc, l) => {
    const prev = acc[acc.length - 1];
    const institutionTail = prev !== undefined && /[|,]\s*\p{Lu}\p{L}{2,}$/u.test(prev) && !/\d/.test(prev.split(/[|,]/).pop() ?? "") && /^(?:University|Institute|College|Academy|School|Polytechnic|Business School|TVET|of\s)/.test(l);
    const employerTail = prev !== undefined && /\b(?:at|@)\s+\p{Lu}[\p{L}&'.-]+$/u.test(prev) && /^\p{Lu}[\p{L}&'.-]+(?:\s+\p{Lu}[\p{L}&'.-]+){0,2}\s*[,(|–-]\s*(?:\d|[A-Za-z]{3,9}\.? ?'?\d)/u.test(l);
    if (institutionTail || employerTail) acc[acc.length - 1] = `${prev} ${l}`; else acc.push(l);
    return acc;
  }, []);

  // "Key skills: A, B. Languages: C, D." : split at the sentence boundary before a known label
  lines = lines.flatMap((l) => l.split(/\.\s+(?=(?:key skills|core skills|technical skills|skills|languages?|education|certifications?|interests)\s*:)/i).map((x, i, a) => (i < a.length - 1 && !x.endsWith(".") ? x + "." : x)));

  // Running page headers and footers: "Name – Curriculum Vitae – email", "Page 2 of 3", "Confidential"
  const nameLine = lines.slice(0, 4).find((l) => /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){1,3}$/u.test(l) && !NOT_NAME.test(l) && !TITLE_WORD.test(l));
  lines = lines.filter((l, i) => {
    if (i <= 2) return true;
    if (/^page\s+\d+(\s*(of|\/)\s*\d+)?$/i.test(l) || /\bpage\s+\d+\s*(of|\/)\s*\d+\b/i.test(l)) return false;
    if (/\bconfidential\b/i.test(l) && l.length < 70) return false;
    if (/\bcurriculum vitae\b/i.test(l) && l.length < 90) return false;
    if (nameLine && l.length < nameLine.length + 70 && l.toLowerCase().includes(nameLine.toLowerCase()) && /[–—|·]|\s-\s/.test(l)) return false;
    return true;
  });
  return stripProtected(lines);
}

/** Join wrapped lines ("... built\n and shipped ...") into single items; bullets start new items. */
function toItems(lines: string[]): { text: string; raw: string }[] {
  const items: { text: string; raw: string }[] = [];
  for (const raw of lines) {
    const t = stripBullet(raw);
    const continuation = items.length && !isBullet(raw) && /^[a-z(]/.test(t) && !/[.!?:]$/.test(items[items.length - 1].text);
    if (continuation) items[items.length - 1].text += " " + t;
    else items.push({ text: t, raw });
  }
  return items.filter((i) => i.text.length > 1);
}

// ---------------------------------------------------------------- dates
const MON = "(?:jan|feb|fev|mar|maa|apr|abr|may|mai|mei|jun|jul|aug|ago|sep|sept|set|oct|okt|out|nov|dec|des|dez)[a-z\u00e7]*\\.?";
const DATE = `(?:${MON}\\s*['’]\\d{2}|${MON},?\\s+\\d{4}|${MON}\\s+\\d{2}(?!\\d)|\\d{1,2}[/.-]\\d{4}|\\d{4}[-/]\\d{1,2}|\\d{1,2}/\\d{2}(?![\\d/])|\\d{4})`;
const END = `(?:${DATE}|${PRESENT_WORDS})`;
const RANGE = new RegExp(`\\(?\\b(${DATE})\\s*(?:-|–|—|to|until|till)\\s*(${END})\\b\\)?`, "i");

function findRange(line: string) {
  const m = line.match(RANGE);
  return m ? { start: m[1], end: m[2], full: m[0], index: m.index ?? 0 } : null;
}

// ---------------------------------------------------------------- CV
const ROLE_WORD = /\b(leader|developer|engineer|manager|analyst|designer|consultant|architect|specialist|officer|administrator|director|lead|head|intern|assistant|coordinator|executive|associate|technician|representative|supervisor|accountant|teacher|lecturer|scientist|programmer|tester|owner|founder|partner|advisor|adviser|clerk|sales|agent|nurse|driver|operator|trainee|apprentice|graduate|researcher|strategist|recruiter|controller|secretary|receptionist|artisan|foreman|principal|president|cto|ceo|cfo|coo|chef|cook|baker|butcher|plumber|welder|mechanic|fitter|carpenter|painter|builder|bricklayer|tiler|roofer|glazier|boilermaker|machinist|toolmaker|cashier|barista|waiter|waitress|bartender|host|hostess|cleaner|janitor|guard|paralegal|lawyer|attorney|advocate|doctor|physician|surgeon|dentist|therapist|midwife|paramedic|radiographer|optometrist|veterinarian|vet|surveyor|planner|estimator|buyer|merchandiser|stylist|photographer|editor|writer|reporter|correspondent|presenter|producer|translator|interpreter|auditor|bookkeeper|actuary|economist|underwriter|broker|banker|teller|pilot|steward|stewardess|courier|dispatcher|storeman|storekeeper|labourer|laborer|farmer|ranger|guide|trainer|instructor|tutor|professor|educator|librarian|archivist|curator|chemist|biologist|geologist|physicist|mathematician|statistician|technologist|inspector|investigator|detective|constable|sergeant|typist|attendant|caregiver|carer|nanny|housekeeper|gardener|landscaper|upholsterer|tailor|seamstress|dressmaker|jeweller|optician|handyman|hairdresser|barber|beautician|chauffeur|conductor|cutter|packer|picker|stacker|loader|rigger|scaffolder|miner|blaster|drafter|draughtsman|illustrator|animator|dietitian|nutritionist|audiologist|chiropractor|matron|porter|[a-z]{4,}(?:ist|ician))\b/i;
const TITLE_WORD = /\b(leader|developer|engineer|manager|analyst|designer|consultant|architect|specialist|officer|administrator|director|scientist|programmer|accountant|teacher|lecturer|recruiter|coordinator|executive|assistant|technician|supervisor|intern|researcher|strategist|tester)\b/i;
const GREETING = /\b(dear|regards|sincerely|faithfully|thank you|thanks|yours|hiring|to whom)\b/i;
const NOT_NAME = /\b(curriculum|vitae|resume|résumé|cv|profile|summary|contact|curriculum vitae)\b/i;
const DEGREE = /\b(bsc|b\.sc|ba|b\.a|bcom|b\.com|btech|b\.tech|beng|b\.eng|bachelor'?s?|honou?rs|hons|master'?s?|msc|m\.sc|mba|ma|m\.a|meng|phd|ph\.d|doctorate|diploma|advanced diploma|certificate|national (senior )?certificate|nsc|matric|grade 12|degree|nqf|associate|a-levels?|gcse|higher certificate|undergraduate|postgraduate|llb|pgce|bcompt|bed|b\.ed|bcur|bpharm|mbchb|ndip|n\.dip|higher diploma|advanced certificate|n[1-6]|trade (test|certificate)|red seal|nated)\b/i;
const INSTITUTION_HIGH = /\b\p{Lu}\p{L}+(?: \p{Lu}\p{L}+)* High\b/u; // "Bellville High", "Pretoria Boys High"
const INSTITUTION_CORE = /\b(university|college|institute|school|academy|polytechnic|tvet|varsity|campus|wits|unisa|stenden|iie|boland|high school|hoërskool|hoerskool|laerskool|secondary school|primary school|gymnasium|gimnasium)\b/i;
const INSTITUTION = { test: (s: string) => INSTITUTION_CORE.test(s) || INSTITUTION_HIGH.test(s) };

/**
 * A PDF with a sidebar can store the name far from the top of the text (after "Work experience", say). When the top of the document
 * gives no name, look anywhere near the start for a line that is a plausible name AND shares a word with the e-mail address
 * ("SIPHO DLAMINI" with sipho.dlamini@...). The e-mail is the anchor, so an ordinary heading is never mistaken for a person.
 */
function nameNearEmail(lines: string[], email: string): string {
  const flat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const tokens = (email.split("@")[0] ?? "").split(/[._-]+/).map(flat).filter((t) => t.length >= 3);
  if (!tokens.length) return "";
  for (const l of lines.slice(0, 120)) {
    const cand = clean(l);
    if (cand.includes("@") || /\d/.test(cand) || cand.length > 45 || NOT_NAME.test(cand) || TITLE_WORD.test(cand) || GREETING.test(cand)) continue;
    if (!/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3}$/u.test(cand)) continue;
    const f = flat(cand);
    if (tokens.some((t) => f.includes(t))) return cand === cand.toUpperCase() ? cand.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, (c) => c.toUpperCase()) : cand;
  }
  return splitNameFromEmail(lines.slice(0, 120), email);
}

/**
 * A name printed over two or three lines ("Tumelo" / "DAVIDS", or an oversized surname first: "Smith" / "Jessica"). Consecutive single-word lines are
 * joined only when every word is part of the e-mail address's local part, which also gives the order ("jessicasmith" → Jessica Smith); without that
 * corroboration nothing is joined, so two headings never become a name. Experiment E1, docs/assessment/EXPERIMENTS.md.
 */
function splitNameFromEmail(lines: string[], email: string): string {
  const flat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const local = flat(email.split("@")[0] ?? "");
  if (local.length < 4) return "";
  const word = (l: string) => { const c = clean(l); return /^[\p{L}][\p{L}'’-]{1,24}$/u.test(c) && !NOT_NAME.test(c) && !TITLE_WORD.test(c) && !ROLE_WORD.test(c) && !GREETING.test(c) ? c : ""; };
  const rows = lines.map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < rows.length; i++) for (const k of [3, 2]) {
    const ws = rows.slice(i, i + k).map(word);
    if (ws.length < k || ws.some((w) => !w)) continue;
    const at = ws.map((w) => local.indexOf(flat(w)));
    if (at.some((x) => x < 0) || new Set(at).size < k) continue;
    const ordered = ws.map((w, j) => ({ w, at: at[j] })).sort((a, b) => a.at - b.at).map((x) => x.w);
    return ordered.map((w) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(" ");
  }
  return "";
}

// E4 and E5 (register R44): the words these rules use live in extractionConfig.ts. Found on real CVs where "Position Applied for" and "Personal Information" were published as the candidate's name.
/** A name printed directly above a job title, on one line or two ("Tumelo" / "HLONGWANE" / "Senior ESG Analyst"), where headings or a scan's reading order pushed it out of the top lines. */
/** OCR reads a column rule as a bar: "| Siyanda Mahlako", "Siyanda Chauke |", "Wandile | Sayed". */


function parseName(header: string[], email = ""): string {
  for (const raw of header.slice(0, 6)) {
    const l = raw;
    const labelled = l.match(/^(?:full )?name\s*[:\-]\s*(.+)$/i);
    const cand = clean(labelled ? labelled[1] : l);
    if (cand.includes("@") || /\d/.test(cand) || NOT_NAME.test(cand) || TITLE_WORD.test(cand) || GREETING.test(cand)) continue;
    if (/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3}$/u.test(cand) && cand.length <= 45) {
      // a long surname wrapped onto the next line in a narrow column: "Pieter van der" / "Merwe"
      const next = header[header.indexOf(l) + 1];
      const full = /\b(van|der|den|de|du|von|le|la|di|da|bin|al|ten|ter)$/i.test(cand) && next && /^\p{Lu}[\p{L}'’-]+$/u.test(next) ? `${cand} ${next}` : cand;
      // normalise SHOUTING names to Title Case without altering mixed-case names
      return full === full.toUpperCase() ? full.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, (c) => c.toUpperCase()) : full;
    }
  }
  const split = splitNameFromEmail(header.slice(0, 6), email);
  if (split) return split;
  // Letter-spaced names lose their word gaps ("LERATOMOKOENA"); rebuild them from the e-mail address, keeping the document's own letters.
  const local = (email.split("@")[0] ?? "").split(/[._-]+/).filter((t) => t.length > 1);
  // Letter-spaced name whose e-mail only has the first name plus initials/abbreviation: use the first name as an anchor
  // and split the remainder at surname particles ("VANDERMERWE" -> "van der Merwe" style words).
  if (local.length >= 1) {
    const flat = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const first = flat(local[0]);
    for (const l of header.slice(0, 6)) {
      const f = flat(l);
      if (/\s/.test(l.trim()) || !f.startsWith(first) || f.length < first.length + 4 || f.length > 40 || /@|\d/.test(l)) continue;
      const letters = Array.from(l.replace(/[^\p{L}]/gu, ""));
      const given = letters.slice(0, first.length).join("");
      let rest = letters.slice(first.length).join("");
      const words: string[] = [];
      for (let guard = 0; guard < 3; guard++) {
        const m = rest.match(/^(vander|vanden|van|von|ter|ten)(?=\p{L}{4,})/iu);
        if (!m) break;
        words.push(m[1].length > 4 && /^(vander|vanden)$/i.test(m[1]) ? `${m[1].slice(0, 3)} ${m[1].slice(3)}` : m[1]);
        rest = rest.slice(m[1].length);
      }
      const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      return [cap(given), ...words.flatMap((w) => w.split(" ")).map((w) => w.toLowerCase()), cap(rest)].join(" ");
    }
  }
  if (local.length >= 2) {
    const flat = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const want = local.map(flat).join("");
    for (const l of header.slice(0, 6)) {
      if (flat(l) !== want || /\s/.test(l.trim())) continue;
      const letters = Array.from(l.replace(/[^\p{L}]/gu, ""));
      let at = 0;
      return local.map((t) => { const w = letters.slice(at, at + flat(t).length).join(""); at += flat(t).length; return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(" ");
    }
  }
  const intro = header.join(" ").match(/\b(?:[Mm]y name is|[Ii] am|[Ii]'m)\s+(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,2})/u);
  return intro ? intro[1] : "";
}

const COUNTRY = "South Africa|Namibia|Botswana|Zimbabwe|Zambia|Mozambique|Lesotho|Eswatini|Swaziland|Malawi|Angola|Kenya|Nigeria|Ghana|Uganda|Tanzania|Rwanda|Egypt|Morocco|United Kingdom|UK|England|Scotland|Ireland|USA|United States|Canada|Australia|New Zealand|Germany|Netherlands|France|Portugal|Spain|Italy|UAE|United Arab Emirates|India|China|Singapore";
const PROVINCE = "Gauteng|Western Cape|Eastern Cape|Northern Cape|KwaZulu-Natal|KZN|Free State|Limpopo|Mpumalanga|North West";
const PLACE_IN_LINE = new RegExp(`\\p{Lu}[\\p{L}.'’-]+(?:\\s+\\p{Lu}[\\p{L}.'’-]+){0,2},\\s*(?:${PROVINCE}|${COUNTRY})(?:,\\s*(?:${COUNTRY}))?`, "u");
// Numbers that are not telephone numbers: ID numbers, registration numbers, licence numbers.
const NOT_PHONE_LINE = /\b(id|identity|passport|licen[sc]e|reg(istration)?|vat|tax|account|date of birth|dob|born)\b/i;

function parseContact(header: string[], whole: string, name = "") {
  const emails = [...whole.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]);
  // Several addresses (the candidate's and their referees'): prefer the one that contains part of the candidate's own name.
  const flat = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const nameTokens = name.split(/\s+/).map(flat).filter((t) => t.length >= 3);
  const email = emails.find((e) => nameTokens.some((t) => flat(e.split("@")[0]).includes(t))) ?? emails[0] ?? "";
  let phone = "";
  const phoneLines = [...header.slice(0, 40), ...whole.split("\n").slice(0, 60)];
  outer: for (const line of phoneLines) {
    if (NOT_PHONE_LINE.test(line)) continue;
    for (const m of line.matchAll(/(?<!\d)(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\d)/g)) {
      const digits = m[0].replace(/\D/g, "");
      // 13-digit numbers are South African ID numbers, never phones
      if (digits.length >= 9 && digits.length <= 12 && !RANGE.test(m[0]) && !/^(19|20)\d{2}\D*(19|20)\d{2}$/.test(m[0].trim())) { phone = m[0].trim(); break outer; }
    }
  }
  const segments = header.slice(0, 30).flatMap((l) => l.split(/[|•·;]|\s[-–—\/]\s|\s{3,}/)).map(clean).filter(Boolean);
  const CITY_ANYWHERE = /\b(?:johannesburg|cape town|durban|pretoria|sandton|centurion|midrand|randburg|soweto|bloemfontein|polokwane|port elizabeth|gqeberha|east london|nelspruit|mbombela|kimberley|pietermaritzburg|stellenbosch|paarl|george|rustenburg|witbank|emalahleni|umhlanga|ballito|richards bay|potchefstroom|upington|benoni|boksburg|germiston|roodepoort|krugersdorp|vereeniging)\b/i;
  const CITY = /^(johannesburg|cape town|durban|pretoria|sandton|centurion|midrand|randburg|soweto|bloemfontein|polokwane|port elizabeth|gqeberha|east london|nelspruit|mbombela|kimberley|pietermaritzburg|stellenbosch|paarl|george|rustenburg|witbank|emalahleni|umhlanga|ballito|richards bay|potchefstroom|upington|benoni|boksburg|germiston|roodepoort|krugersdorp|vereeniging)$/i;
  const labelled = header.slice(0, 40).map((l) => l.match(/^(?:location|address|city|based in|residence)\s*[:\-]\s*(?:\|\s*)?(.+)$/i)?.[1]).find(Boolean);
  const PLACE = /^\p{Lu}[\p{L}.' -]+(?:,\s*\p{Lu}[\p{L}.' -]+){1,2}$/u;
  const inLine = header.slice(0, 40).map((l) => l.match(PLACE_IN_LINE)?.[0]).find(Boolean);
  // a contact line placed at the END of the page (a footer): find it by the e-mail address or phone number it carries
  const contactLine = !labelled && !inLine && email ? whole.split("\n").filter((l) => l.includes(email) || (phone && l.includes(phone))).map((l) => l.match(PLACE_IN_LINE)?.[0] ?? "").find(Boolean) : "";
  const cityInTop = header.slice(0, 8).filter((l) => !/@|\d{4}/.test(l.replace(/\d{3}\s?\d{3}\s?\d{4}/g, ""))).map((l) => l.match(CITY_ANYWHERE)?.[0]).find(Boolean);
  const location = labelled ?? inLine ?? (contactLine || undefined) ?? segments.slice(0, 20).find((s) => PLACE.test(s) && s.length < 60 && !GREETING.test(s) && !TITLE_WORD.test(s) && s.split(/[\s,]+/).length <= 6) ?? segments.slice(0, 20).find((s) => CITY.test(s)) ?? cityInTop ?? "";
  return { email, phone, location: clean(location) };
}

/**
 * "Smart Vending Systems" on one line and a paragraph about it on the next are ONE project, not two. A short line with no full stop,
 * followed by a sentence-length item, is joined to it as "Title: description". Everything else is left as it was.
 */
function titledItems(items: { text: string; quote: string }[]): { text: string; quote: string }[] {
  const prose = (t: string) => t.split(/\s+/).length >= 8 || /[.!?]$/.test(t);
  const out: { text: string; quote: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i], next = items[i + 1];
    if (next && cur.text.length <= 70 && cur.text.split(/\s+/).length <= 8 && !/[.!?:]$/.test(cur.text) && prose(next.text)) { out.push({ text: `${cur.text}: ${next.text}`, quote: `${cur.quote}\n${next.quote}` }); i++; }
    else out.push(cur);
  }
  return out;
}

// Skills that are written as one capital letter (R22). Kept only inside a list of two or more items in a skills section, exactly as printed. Not added to
// the skills dictionary on purpose: its patterns ignore case, and "r" or "c" would then match almost any text (and "R" is also the rand: "R25 000").
const ONE_LETTER_SKILLS = new Set(["R", "C"]);
function parseSkills(rawLines: string[]): { name: string; quote: string }[] {
  const FUNCTION_WORD = /^(?:and|or|for|the|of|to|with|across|am|is|are|have|has|include|includes|including)$/i;
  const incomplete = (piece: string) => { const w = piece.trim().split(/\s+/); return FUNCTION_WORD.test(w[0]) || FUNCTION_WORD.test(w[w.length - 1]); };
  const out: { name: string; quote: string }[] = [];
  // Rating glyphs from skill bars and star ratings are decoration, not skills.
  const stripped = rawLines.map((l) => l.replace(/[█▓▒░■□▪▫★☆●○◉◯✦✧]+/g, " ").replace(/\s{2,}/g, " ").trim()).filter(Boolean)
    // A line in capitals that names a group of skills ("ARCHITECTURE & SYSTEMS", "DATA, CLOUD & DEVOPS") is a heading, not a skill. Short all-caps tools ("SQL", "AWS") stay.
    .filter((l) => !(/^[A-Z][A-Z0-9 &,/+-]{3,45}$/.test(l) && !/[a-z]/.test(l) && /[ &,]/.test(l) && !/[•·|]/.test(l)));
  // Wrapped lists: "…, Site supervision, Stormwater" / "design", and wrapped sentences: "…Curriculum design and" / "Assessment."
  const lines: string[] = [];
  for (const l of stripped) {
    const prev = lines[lines.length - 1];
    const sentenceOpen = prev !== undefined && /^(?:i am|i'm|i have)\s+(?:proficient|skilled|experienced|competent|fluent|well versed)\b/i.test(prev) && !/[.!?]$/.test(prev);
    const labelled = /^[^:]{2,32}:\s/.test(l); // "Cloud & Data: AWS, Spark" starts a new group
    // a spaced-slash list that wraps: "Excel / Power BI" then "/ Controls", or a line ending in " /" (experiment E2: off unless selected)
    const slashWrap = prev !== undefined && !labelled && (/^\/\s/.test(l) || /\s\/$/.test(prev)) && /\s\/\s/.test(`${prev} ${l}`);
    const midItem = slashWrap || (prev !== undefined && /\p{L}$/u.test(prev) && !/[,;.]$/.test(prev) && !labelled
      && ((/[,;]/.test(prev)) || /\s(?:and|of|&|for|in|with|to)$/i.test(prev) || (/^[a-z][a-z-]*(?=[,;\s]|$)/.test(l) && prev.split(" ").length <= 2)));
    // a spaced-slash list that wrapped in the middle of an item: "Excel / Microsoft" then "Teams / Planning"
    const midSlashItem = prev !== undefined && !labelled && !l.includes("|") && /\s\/\s/.test(prev) && !/[,;.:]$/.test(prev) && l.split(/\s\/\s/)[0].split(/\s+/).length <= 3 && !/[,;:]/.test(l);
    if (sentenceOpen || midItem || midSlashItem) lines[lines.length - 1] = `${prev} ${l}`; else lines.push(l);
  }
  const SENTENCE = /^(?:i am|i'm|i have)\s+(?:proficient|skilled|experienced|competent|fluent|well versed)\s+(?:in|with)\s+/i;
  for (const raw of lines) {
    let t = stripBullet(raw);
    // A list whose separators were dots ("SQL · Python · Power BI · Excel") that OCR read as colons and dashes ("SQL - Python - Power BI: Excel"): when a line
    // already has two or more dash or bar separators, a colon between short phrases is one more separator, not a label.
    if ((t.match(/\s[-–—·|]\s/g) ?? []).length >= 2) t = t.replace(/\s*:\s+/g, " | ");
    // E3: in a " / " list that also contains " | ", the bar is a column boundary (OCR reads two columns into one line); a bar-segment with no " / " is
    // admitted only as a short, capitalised, complete item, otherwise it is text from the other column
    if (/\s\/\s/.test(t) && /\s\|\s/.test(t)) t = t.split(/\s\|\s/).filter((seg) => /\s\/\s|^\/|\/$/.test(seg.trim()) || (seg.trim().split(/\s+/).length <= 3 && !/^\p{Ll}/u.test(seg.trim()) && !incomplete(seg))).join(" / ");
    const label = t.match(/^([A-Za-z &/+#.-]{2,32}):\s*(.+)$/); // "Languages: Python, Java"
    const isProse = (x: string, labelled: boolean) => { // a sentence, as opposed to a list of skills
      const n = x.split(/\s+/).length, parts = x.split(/[,;|•·●▪]|\s\/\s/);   // " / " separates list items too
      if (parts.length >= 3 && parts.every((p) => p.trim().split(/\s+/).length <= 4)) return false; // "Python, Java, SQL, Go": a list
      return (/[.!?]$/.test(x.trim()) && n >= 6) || (n >= 9 && parts.length <= 2) || (labelled && n >= 6 && parts.length === 1); // a wrapped sentence after a label has no punctuation to show it
    };
    if (label && isProse(label[2], true)) { out.push({ name: label[1].trim(), quote: raw }); continue; } // "Leadership & Governance: Proven track record of ...": the heading is the skill, the sentence is a description
    if (!label && !SENTENCE.test(t) && isProse(t, false)) continue;                                                                   // a sentence is not a list of skills
    if (label) t = label[2];
    const asSentence = SENTENCE.test(t); // "I am proficient in A, B and C."
    if (asSentence) t = t.replace(SENTENCE, "");
    const LEVEL = /\s*[(\[]\s*(?:beginner|basic|elementary|intermediate|advanced|expert|proficient|fluent|native|good|excellent|\d+\s*(?:\+\s*)?years?|[1-5]\s*\/\s*5|\d+\s*%)\s*[)\]]/gi;
    t = t.replace(LEVEL, "").replace(/\s+[-–—:]\s*(?:beginner|basic|intermediate|advanced|expert|proficient)\b/gi, "");
    const found = !/[,;|•·●▪]|\s[-–—]\s|\s\/\s/.test(t) && !asSentence ? segmentSkills(t) : null;
    // two or more skills that ran together are split only when each part is itself the name of a skill; otherwise the line is one item, as printed ("Stakeholder communication", though "stakeholder" is another word for one)
    const cells = found && !found.every((x: string) => SKILLS_BY_NAME.has(x.toLowerCase())) ? null : found;   // a table row whose cells ran together
    // a cell that wrapped inside a table row ("Risk" | "management") is one skill when the two halves together are a skill RoleMatch knows
    // " / " between items separates them; a slash inside a name ("CI/CD", "TCP/IP") has no spaces and is kept
    const pieces = cells ?? t.split(asSentence ? /[,;|•·●▪]|\s+and\s+|\s[-–—]\s|\s\/\s|\s{3,}/ : /[,;|•·●▪]|\s[-–—]\s|\s\/\s|\s{3,}/).map((p) => p.trim().replace(/^\/\s*|\s*\/$/g, "")).filter(Boolean);
    for (let i = 0; i + 1 < pieces.length; i++) if (isKnownSkillForm(`${pieces[i]} ${pieces[i + 1]}`) && !(isKnownSkillForm(pieces[i]) && isKnownSkillForm(pieces[i + 1]) && /^[A-Z]/.test(pieces[i + 1]))) pieces.splice(i, 2, `${pieces[i]} ${pieces[i + 1]}`);
    for (const part of pieces) {
      const name = part.trim().replace(/^[()\-–—•·\s]+|[()\s.]+$/g, "");
      if ((name.length < 2 && !(ONE_LETTER_SKILLS.has(name) && pieces.length >= 2)) || name.length > 40 || name.split(" ").length > 4) continue;
      if (/[.!?]$/.test(name) || /\b(years?|experience of|responsible)\b/i.test(name)) continue;
      if (incomplete(name)) continue;   // E3: a piece that begins or ends with a function word is a fragment, not a skill
      out.push({ name, quote: raw });
    }
  }
  return out;
}

/** "Between 2019 to 2021 we doubled throughput." is prose that mentions dates, not a job header. */
function looksLikeSentence(line: string, range: { full: string; index: number }): boolean {
  const words = (t: string) => t.trim().split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;   // a separator such as "|" is not a word
  const before = words(line.slice(0, range.index));
  // what follows the dates: an employment type ("| Fixed term contract") is part of a job line, not the rest of a sentence
  const tail = line.slice(range.index + range.full.length).replace(/^[\s|,;–—-]+/, "").trim();
  const after = EMPLOYMENT_TYPE.test(tail.replace(/[.)]+$/, "")) ? 0 : words(tail);
  const rest = clean(line.replace(range.full, " "));
  return (before >= 1 && after >= 3) || (/[.!?]$/.test(rest) && !(/\(/.test(range.full) && rest.split(" ").length <= 8)) || rest.split(" ").length > 14 || /^(between|from|since|during|in|over|until|after)\b/i.test(rest);
}

/** Rewrites unusual experience layouts into the plain "Position | Company | dates" form the reader understands. */
function canonicaliseExperience(input: string[]): string[] {
  let lines = input;
  // A date range wrapped inside its own column: "January 2026 – | Unit Manager" over "September 2026 | Shoprite Checkers" is ONE role dated January 2026 – September 2026.
  // Only this working copy is joined; the original two lines stay the evidence.
  {
    const open = new RegExp(`^(${DATE})\\s*[-–—]\\s*(?:\\|\\s*(.+))?$`, "i"), close = new RegExp(`^(${END})\\s*(?:\\|\\s*(.+))?$`, "i");
    lines = [...lines];
    // a date that wrapped mid-way ("... Northwind Systems, Nov" / "2016 to Dec 2020", or "Nov 2011 —" / "Aug 2014") is one date; a plain space joins it, which the evidence check allows
    const monthEnd = new RegExp(`(?:^|[\\s,(])${MON}\\s*$`, "i"), openEnd = new RegExp(`${DATE}\\s*(?:-|–|—|to|until|till)\\s*$`, "i"), yearStart = /^\d{4}\b/, endStart = new RegExp(`^(?:${END})\\b`, "i");
    for (let i = 0; i + 1 < lines.length; i++) {
      if (!isBullet(lines[i]) && !isBullet(lines[i + 1]) && ((monthEnd.test(lines[i]) && yearStart.test(lines[i + 1])) || (openEnd.test(lines[i]) && endStart.test(lines[i + 1])))) { lines.splice(i, 2, `${lines[i]} ${lines[i + 1]}`); i--; }
    }
    // the year of the end date wrapped under a date column: "May 2017 - April | Forklift Driver" over "2021 | Coastal Private Hospital", or "Dec '19 - Aug" over "'22"
    const halfEnd = new RegExp(`^(${DATE}\\s*(?:-|–|—|to|until|till)\\s*${MON})\\s*(?:\\|\\s*(.*))?$`, "i"), yearOnly = /^(\d{4}|['’]\d{2})\s*(?:\|\s*(.*))?$/;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i].match(halfEnd), b = a && lines[i + 1].match(yearOnly);
      if (a && b) lines.splice(i, 2, [`${a[1]} ${b[1]}`, a[2], b[2]].filter(Boolean).join(" | "));
    }
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i].match(open), b = a && lines[i + 1].match(close);
      if (a && b) lines.splice(i, 2, [`${a[1]} – ${b[1]}`, a[2], b[2]].filter(Boolean).join(" | "));
    }
  }
  const NARR = new RegExp(`^(?:from\\s+|since\\s+|between\\s+)?(${DATE})\\s+(?:until|to|till|-|–|—|and)\\s+(${END}|the present(?: day)?)\\b[^.]*?\\b(?:worked|employed|served|working)\\s+as\\s+(?:an?\\s+|the\\s+)?(.+?)(?:\\s+(?:at|with|for)\\s+(.+?))?\\.\\s*(.*)$`, "i");
  // Title first, as a paragraph: "Sales Rep at Border Distributors from Jan 2019 till date. Visited clients." Only when the words before "at" name an occupation.
  const LEAD = new RegExp(`^([A-Z][^.,;:|]{1,60}?)\\s+at\\s+([A-Z0-9][^.;:|]{1,60}?)\\s*,?\\s+(?:from\\s+|between\\s+)?(${DATE})\\s*(?:until|to|till|and|-|–|—)\\s*(${END})\\b\\.?\\s*(.*)$`, "i");
  const RUNIN = new RegExp(`^(.{3,100}?)[\\s,|–—-]*\\(?(${DATE})\\s*(?:-|–|—|to|until|till)\\s*(${END})\\)?\\s*:\\s*(.+)$`, "i");
  // A narrative paragraph wrapped over several lines ("From March 2019 until now I worked as ... /  ... at Acme.") becomes one line
  const startsNarrative = new RegExp(`^(?:from|since|between)\\s+(?:${DATE})`, "i");
  const joined: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (startsNarrative.test(l) && !/[.!?]$/.test(l)) {
      let k = i + 1;
      while (k < lines.length && k <= i + 3 && !startsNarrative.test(lines[k]) && !findRange(lines[k])) { l += " " + lines[k]; if (/[.!?]$/.test(lines[k])) { k++; break; } k++; }
      i = k - 1;
    }
    joined.push(l);
  }
  lines = joined;
  const out: string[] = [];
  const remainderOf = (l: string, r: { full: string }) => clean(l.replace(r.full, " ").replace(/[()[\]]/g, " ")).replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, "");
  const headerShaped = (l: string | undefined) => !!l && !isBullet(l) && l.length <= 90 && !/[.:]$/.test(l) && !findRange(l);
  // Which way does THIS CV stack a role: title, company, dates (dates last) or dates, title, company (dates first)? Every date-only line votes by what sits around it,
  // and the majority decides for them all, so a role whose neighbour looks like the opposite layout is not read as that layout.
  let datesLast = 0, datesFirst = 0;
  lines.forEach((l, i) => {
    const rg = findRange(l); if (!rg || isBullet(l) || remainderOf(l, rg).length > 2) return;
    if (i >= 2 && headerShaped(lines[i - 1]) && headerShaped(lines[i - 2]) && ROLE_WORD.test(lines[i - 2])) datesLast++;
    if (headerShaped(lines[i + 1]) && headerShaped(lines[i + 2]) && ROLE_WORD.test(lines[i + 1])) datesFirst++;
  });
  const orientation: "last" | "first" | "unsure" = datesLast > datesFirst * 1.5 ? "last" : datesFirst > datesLast * 1.5 ? "first" : "unsure";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lead = line.match(LEAD);
    if (lead && /^\p{Lu}/u.test(lead[1]) && /^[\p{Lu}\d]/u.test(lead[2]) && ROLE_WORD.test(lead[1]) && lead[1].split(/\s+/).length <= 6) {
      out.push(`${lead[1]} | ${lead[2]} | ${lead[3]} - ${new RegExp(`^(?:${PRESENT_WORDS})$`, "i").test(lead[4]) ? "Present" : lead[4]}`); if (lead[5]) out.push(lead[5]); continue;
    }
    const narr = line.match(NARR);
    if (narr) { out.push(`${narr[3]} | ${narr[4] ?? ""} | ${narr[1]} - ${/present/i.test(narr[2]) ? "Present" : narr[2]}`); if (narr[5]) out.push(narr[5]); continue; }
    const run = line.match(RUNIN);
    if (run && ROLE_WORD.test(run[1])) { out.push(`${run[1].replace(/[()]/g, " | ")} | ${run[2]} - ${run[3]}`); out.push(run[4]); continue; }
    const range = findRange(line);
    if (range) {
      const bare = stripBullet(line);
      if (isBullet(line)) { // "► Senior Developer, Acme — Mar 2021 - Present" (a bullet used as a role marker)
        const r2 = findRange(bare)!;
        if (ROLE_WORD.test(remainderOf(bare, r2)) && remainderOf(bare, r2).length <= 90 && !looksLikeSentence(bare, r2)) { out.push(bare); continue; }
      } else if (remainderOf(line, range).length <= 2) {
        // A line holding only dates: the title is either above it or, in table layouts, below it.
        const above = out[out.length - 1];
        const below = lines[i + 1];
        const aboveOk = headerShaped(above) && above.length <= 80;
        const belowOk = headerShaped(below);
        const preferBelow = orientation === "first" ? true : orientation === "last" ? false : ROLE_WORD.test(below!) && !ROLE_WORD.test(above!);
        if (belowOk && (!aboveOk || preferBelow)) {
          // table layouts often put the company on its own short line under the title
          const next = lines[i + 2];
          const companyBelow = headerShaped(next) && next!.length <= 60 && next!.split(" ").length <= 6 && /^\p{Lu}/u.test(next!) && ROLE_WORD.test(below!) !== ROLE_WORD.test(next!);
          out.push(`${below}${companyBelow ? ` | ${next}` : ""} | ${range.full.replace(/[()]/g, "").trim()}`);
          i += companyBelow ? 2 : 1; continue;
        }
      }
    }
    out.push(line);
  }
  return out;
}

/** Experience written without any dates: "Software Intern, Example Labs" followed by what was done. */
function undatedRoles(lines: string[]) {
  const heads: number[] = [];
  lines.forEach((l, i) => {
    const parts = l.split(/\s*[|,@–—]\s*|\s+at\s+|\s-\s/).filter(Boolean);
    if (!isBullet(l) && l.length <= 90 && !/[.:;]$/.test(l) && parts.length >= 1 && parts.length <= 3 && ROLE_WORD.test(parts[0]) && parts[0].split(" ").length <= 6 && !/^(i|my|we)\b/i.test(l)) heads.push(i);
  });
  return heads.map((h, n) => {
    const parts = lines[h].split(/\s*[|,@–—]\s*|\s+at\s+|\s-\s/).map((p) => p.trim()).filter(Boolean);
    const end = heads[n + 1] ?? lines.length;
    return { company: parts[1] ?? "", position: parts[0], startDate: "", endDate: "", responsibilities: toItems(lines.slice(h + 1, end)).map((i) => i.text), quote: lines[h] };
  });
}

// A length of service written beside the dates ("Aug 2021 – Dec 2023 • 2+ years") is not part of the dates, and must not make the line look like a sentence.
const DURATION_TAIL = /\s*[•·|(]\s*(?:approx\.?\s*|about\s*)?\d+(?:\.\d+)?\+?\s*(?:years?|yrs?|months?|mos?)(?:\s+\d+\s*months?)?\s*\)?\s*$/i;
// A role with only a rough length and no dates: "Enterprise Systems | Enterprise Project Work Approx. 6 months"
const APPROX_ROLE = /^[^•·]{6,140}\s\|\s[^|]{3,90}\s(?:approx\.?|about|around)\s*\d+(?:\.\d+)?\+?\s*(?:years?|yrs?|months?)\s*$/i;

const NOT_DONE_WORDS = new RegExp(`\\b(?:${ruleset.evidence.notDone.join("|")})\\b`, "i");
const saidNotDone = (l: string) => NOT_DONE_WORDS.test(l);
function parseExperience(rawLines: string[], quoteLines: string[] = rawLines) {
  const lines = canonicaliseExperience(rawLines).map((l) => (findRange(l) && !isBullet(l) ? l.replace(DURATION_TAIL, "") : l));
  const dateIdx = lines.map((l, i) => (findRange(l) ? i : -1)).filter((i) => i >= 0);
  const approxIdx = lines.map((l, i) => (!isBullet(l) && !findRange(l) && APPROX_ROLE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!dateIdx.length && !approxIdx.length) return undatedRoles(lines);
  const used = new Set<number>();
  // The quote that backs a role must be words the CV really contains. The reader rewrites some layouts into a plain form first ("worked as X at Y
  // from March 2019" becomes "X | Y | March 2019 - Present"), and that rewritten line is not in the document, so the evidence check would throw the
  // role away. The quote is therefore the original line that carries the dates, in the order the roles appear.
  let cursor = 0;
  const sourceQuote = (range: { start: string; end: string }, fallback: string) => {
    const has = (l: string, t: string) => !!t && l.toLowerCase().includes(t.toLowerCase());
    for (const pass of [(l: string) => has(l, range.start) && has(l, range.end), (l: string) => has(l, range.start)]) {
      for (let i = cursor; i < quoteLines.length; i++) if (pass(quoteLines[i])) { cursor = i + 1; return quoteLines[i]; }
    }
    return fallback;
  };
  type Block = { headerIdx: number[]; dateLine: number; range: NonNullable<ReturnType<typeof findRange>> };
  const blocks: Block[] = [];
  for (const di of dateIdx) {
    const range = findRange(lines[di])!;
    // The same dates again straight under the role's own heading, usually with where it was: "Analyst | Acme | 2016 - 2018" then "2016 - 2018, Durban". One role.
    const last = blocks[blocks.length - 1];
    if (last && last.dateLine === di - 1 && last.range.full && last.range.start === range.start && last.range.end === range.end) { used.add(di); continue; }
    // A date range inside a long bullet is prose ("from 2019 to 2021 we grew..."): skip it.
    if (isBullet(lines[di]) || lines[di].length > 140 || looksLikeSentence(lines[di], range)) continue;
    const remainder = clean(lines[di].replace(range.full, " ").replace(/[()[\]]/g, " ")).replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, "");
    const parts = remainder.split(/\s*[|@•·]\s*|\s+at\s+|\s[–—-]\s|,\s+/).filter(Boolean).filter((p) => !EMPLOYMENT_TYPE.test(p.trim()));
    const idx: number[] = [];
    if (remainder.length > 2 && parts.length >= 2) idx.push(di);
    else {
      if (remainder.length > 2) idx.push(di);
      for (let k = di - 1; k >= 0 && idx.length < 3 && di - k <= 2; k--) {
        const l = lines[k];
        if (used.has(k) || isBullet(l) || l.length > 80 || /[.:]$/.test(l) || findRange(l)) break;
        // a section heading in capitals ("EARLIER EXPERIENCE") ends the search: it is never the employer
        if (/^[\p{Lu}\s&/-]{4,40}$/u.test(l.trim()) && /\b(EXPERIENCE|EMPLOYMENT|HISTORY|CAREER|WORK|ROLES|POSITIONS|PROFESSIONAL)\b/.test(l)) break;
        idx.unshift(k);
      }
      // date-column layouts: "11/2023 – now | Sales Director" with the company on the line BELOW
      const below = lines[di + 1];
      if (remainder.length > 2 && idx.length === 1 && below && !used.has(di + 1) && !isBullet(below) && !findRange(below) && below.length <= 60 && below.split(" ").length <= 6 && !/[.:;!?]$/.test(below) && /^\p{Lu}/u.test(below) && !ROLE_WORD.test(below) && ROLE_WORD.test(remainder)) idx.push(di + 1);
    }
    idx.forEach((k) => used.add(k));
    blocks.push({ headerIdx: idx, dateLine: di, range });
  }
  // Roles that only say roughly how long they lasted get no dates (we never invent them), but they do end the role above.
  for (const ai of approxIdx) if (!used.has(ai)) { used.add(ai); blocks.push({ headerIdx: [ai], dateLine: ai, range: { full: "", start: "", end: "", index: 0 } as any }); }
  blocks.sort((a, b) => a.dateLine - b.dateLine);
  let groupCompany = "";
  return blocks.map((b, n) => {
    const approx = !b.range.full ? lines[b.dateLine].match(/(?:approx\.?|about|around)\s*(\d+(?:\.\d+)?\+?\s*(?:years?|yrs?|months?))/i)?.[1] : undefined;
    const headerTexts = b.headerIdx.map((k) => (k === b.dateLine ? clean((b.range.full ? lines[k].replace(b.range.full, " ") : lines[k].replace(/(?:approx\.?|about|around)\s*\d+(?:\.\d+)?\+?\s*(?:years?|yrs?|months?)\s*$/i, " ")).replace(/[()[\]]/g, " ")) : lines[k]));
    // "Meridian Solutions: Principal Engineer": who, then what. A place beside the dates is where, not who, when anyone else is named.
    const named = headerParts(headerTexts).flatMap((p) => { const m = p.match(/^(.{2,60}?):\s+(.+)$/); return m && (ROLE_WORD.test(m[2]) || TITLE_WORD.test(m[2])) && !(ROLE_WORD.test(m[1]) || TITLE_WORD.test(m[1])) && !isFactLabel(m[1]) ? [m[2], m[1]] : [p]; });
    const parts = named.length > 1 && named.some((p) => !isPlacePart(p)) ? named.filter((p, i) => !isPlacePart(p) || (i === 0 && !named.some((q, j) => j > 0 && !isPlacePart(q)))) : named;
    // Which part is the job title? A seniority word is the strongest sign, then a clear title word, then any occupation word.
    const SENIORITY = /\b(senior|junior|lead|head|chief|principal|assistant|associate|trainee|graduate|intern|deputy|regional|general|executive|apprentice|sous)\b/i;
    const COMPANY_NAME = /\b(group|bank|ltd|limited|pty|inc|corp(?:oration)?|holdings?|plc|llc|capital|securities|insurance|assurance|partners|enterprises|industries|solutions|technologies|services|systems)\b\.?$/i;
    const titleScore = (p: string) => (SENIORITY.test(p) ? 3 : 0) + (TITLE_WORD.test(p) ? 2 : 0) + (ROLE_WORD.test(p) ? 1 : 0) - (COMPANY_NAME.test(p) && !TITLE_WORD.test(p) ? 2 : 0);
    // A role already understood from a form or table says which part is which.
    const roleCells = lines[b.dateLine], understood = roleCells.includes(ROLE_CELL) ? roleCells.split(/[\u241D-\u241F]/) : null, written = roleCells.includes(WRITTEN["employer above title"]) ? "employer above title" : roleCells.includes(WRITTEN["title, employer"]) ? "title, employer" : "";
    const positionPart = understood ? understood[0] : [...parts].sort((a, b) => titleScore(b) - titleScore(a) || parts.indexOf(a) - parts.indexOf(b))[0] ?? "";
    const companyPart = understood ? understood[1] : (parts.find((p) => p !== positionPart && !/south africa|remote|hybrid|on-?site/i.test(p)) ?? "").replace(/[\s.]+$/, "");
    const start = Math.max(b.dateLine + 1, ...b.headerIdx.map((k) => k + 1)) + (used.has(b.dateLine + 1) && !b.headerIdx.includes(b.dateLine + 1) && lines[b.dateLine + 1] && findRange(lines[b.dateLine + 1]) ? 1 : 0);
    const nextHeaderStart = blocks[n + 1] ? Math.min(...blocks[n + 1].headerIdx, blocks[n + 1].dateLine) : lines.length;
    const responsibilities = toItems(joinWrappedDuties(lines.slice(start, nextHeaderStart))).map((i) => i.text);
    const grouped = !!companyPart && b.headerIdx.some((k) => k !== b.dateLine && lines[k].includes(companyPart));
    return { _grouped: grouped, company: companyPart, position: positionPart, startDate: b.range.start, endDate: b.range.end, responsibilities, quote: understood ? (written === "employer above title" ? `${companyPart} | ${positionPart}` : written === "title, employer" ? `${positionPart}, ${companyPart}` : [...positionPart.split(" / "), companyPart].filter(Boolean).join(" | ")) : b.range.full ? sourceQuote(b.range, lines[b.dateLine]) : lines[b.dateLine], ...(approx ? { duration: "Approx. " + approx.trim() } : {}) };
  }).filter((r) => r.position || r.company).map((r) => {
    // Career progression lists the company ONCE, on its own line above several titles. Carry it down only from such a line, never from a role
    // that named its employer beside the title, and never to freelance or self-employed roles.
    const { _grouped, ...role } = r;
    if (r.company) { groupCompany = _grouped ? r.company : ""; return role; }
    const carry = groupCompany && ROLE_WORD.test(r.position) && !/\b(freelance|self[- ]employed|independent|contract(or)?|consultant)\b/i.test(r.position);
    return carry ? { ...role, company: groupCompany } : role;
  });
}

// A comma inside a title is common ("Unit Manager, Adult ICU | Umhlanga Private Hospital"), so a comma splits a role header only when the stronger
// separators (| @ • · a spaced dash, "at") leave no employer beside the title ("Software Engineer, Acme Ltd | Cape Town").
// How someone was employed ("Permanent", "Fixed-term contract", "Full-time") is never the employer, however it is placed on the line.
export const EMPLOYMENT_TYPE = /^(?:permanent|contract(?:or)?|fixed[- ]?term(?: contract)?|temporary|temp|full[- ]?time|part[- ]?time|internship|intern(?:ship)? programme|freelance|casual|seasonal|locum|volunteer|secondment|graduate programme|learnership)(?: (?:position|role|post|employment|basis))?$/i;
const STRONG_SEP = /\s*[|@•·]\s*|\s+at\s+|\s[–—-]\s/;
const tidyParts = (xs: string[]) => xs.map((p) => p.replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, "")).filter(Boolean);
/** "Position: Data Analyst": the word before the colon names the field, it is not an employer. */
const isFactLabel = (l: string) => Object.values(readingConfig.labelledFacts).flat().some((x) => x.toLowerCase() === l.trim().toLowerCase());
const isPlacePart = (p: string) => /south africa|remote|hybrid|on-?site/i.test(p) || isPlaceName(p);
function headerParts(texts: string[]): string[] {
  const strong = tidyParts(texts.flatMap((t) => t.split(STRONG_SEP))).filter((p) => !EMPLOYMENT_TYPE.test(p));
  if (strong.filter((p) => !isPlacePart(p)).length >= 2) return strong.flatMap((p) => { const m = p.match(/^(.*\S),\s+([^,]+)$/); return m && isPlacePart(m[2]) ? [m[1], m[2]] : [p]; });
  return tidyParts(texts.flatMap((t) => t.split(new RegExp(`${STRONG_SEP.source}|,\\s+`)))).filter((p) => !EMPLOYMENT_TYPE.test(p));
}

function parseEducation(rawLines: string[]) {
  // An institution name wrapped in a narrow column: "Tshwane University of" / "Technology"
  const lines: string[] = [];
  for (const l of rawLines) {
    const prev = lines[lines.length - 1];
    // a date range wrapped over two lines ("2014 -" / "2016 (did not complete)") is one range
    const openRange = prev !== undefined && new RegExp(`${DATE}\\s*[-–—]\\s*$`, "i").test(prev) && new RegExp(`^(?:${END})\\b`, "i").test(l);
    const openBracket = prev !== undefined && (prev.match(/\(/g)?.length ?? 0) > (prev.match(/\)/g)?.length ?? 0) && /\)/.test(l) && l.length <= 80; // "... 2010 (did not" / "complete; left in third year)"
    if (openRange || openBracket) lines[lines.length - 1] = `${prev} ${l}`;
    else if (prev !== undefined && (/\b(of|and|for|the|in|at)$/i.test(prev) || /,$/.test(prev)) && !findRange(l)) lines[lines.length - 1] = `${prev} ${l}`; else lines.push(l);
  }
  const entries: { qualification: string; institution: string; period: string; quote: string }[] = [];
  let cur: (typeof entries)[number] | null = null;
  let prevPlain = ""; // the last line that was neither a qualification, an institution nor a date
  const isBareDate = (l: string) => { const x = stripBullet(l); const rg = findRange(x); return !!(rg || /\b(19|20)\d{2}\b/.test(x)) && x.replace(/[\s\-–—()\d]|present|now|current/gi, "").length === 0; };
  const dateFirst = lines.length > 0 && isBareDate(lines[0]);
  let pendingYear = ""; // a date written ABOVE its qualification (table layouts with a date column): it belongs to the next entry, not the previous one
  for (const raw of lines) {
    const line = stripBullet(raw);
    // "I obtained a BSc Computer Science from University X in 2015."
    const sentence = line.match(/(?:obtained|completed|finished|received|earned|achieved|graduated with|holds?)\s+(?:an?\s+|the\s+)?(.+?)\s+(?:from|at)\s+(.+?)(?:\s+in\s+((?:19|20)\d{2}))?\.?$/i);
    if (sentence) { cur = { qualification: sentence[1], institution: sentence[2], period: sentence[3] ?? "", quote: raw }; entries.push(cur); prevPlain = ""; continue; }
    const range = findRange(line);
    const baseYear = range ? `${range.start} - ${range.end}` : line.match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
    // "(did not complete)" or "in progress" written beside the qualification is kept with its dates, in the CV's own words
    const cue = statusCue(line);
    const year = cue && !baseYear.toLowerCase().includes(cue.toLowerCase()) ? `${baseYear} (${cue})`.trim() : baseYear;
    // Brackets are separators only when they hold an institution or a year: "BSc (Hons) IS" stays whole.
    const unbracketed = line.replace(range?.full ?? "", " ").replace(/\(([^)]*)\)/g, (m, inner: string) => (INSTITUTION.test(inner) || /\b(19|20)\d{2}\b/.test(inner) ? `, ${inner}, ` : m));
    const segs = unbracketed.split(/\s*[|,–—]\s*|\s+-\s+/).map((s) => s.replace(/\b(19|20)\d{2}\b/g, "").replace(/\(\s*\)/g, "").replace(/^(?:school|schooling|education|qualification|studies|highest qualification)\s*:\s*/i, "").replace(/\.$/, "").trim()).filter(Boolean);
    // a designation ("CA(SA)", "PMP (in progress)") is a qualification of its own; its status words stay in the period, not in its name
    const deg = segs.find((s) => DEGREE.test(s)) ?? segs.map((s) => s.replace(/\s*\(([^)]*)\)\s*$/, (m, inner: string) => (statusCue(`(${inner})`) ? "" : m)).trim()).find((s) => s.length <= 40 && DESIGNATIONS.some((d) => d.test(s)));
    const inst = segs.find((s) => INSTITUTION.test(s) && s !== deg);
    const bareDate = !deg && !inst && !!year && line.replace(/[\s\-–—()\d]|present|now|current/gi, "").length === 0;
    if (bareDate) {
      // Where do this CV's dates sit? If the first thing in the section is a date, every date comes BEFORE its entry (a date column); otherwise after it.
      if (!dateFirst && cur && !cur.period) cur.period = year;
      else pendingYear = year;
      continue;
    }
    if (deg) {
      cur = { qualification: deg, institution: inst ?? "", period: year || pendingYear, quote: raw }; pendingYear = "";
      entries.push(cur);
    } else if (inst && cur && !cur.institution) {
      cur.institution = inst; if (!cur.period) cur.period = year;
    } else if (inst) {
      // an unrecognised qualification name written on the line before its institution (e.g. "PGCE Senior Phase")
      // ... or before it on the same line: "BEng Electronic Engineering, Durban University of Technology, 2011". What stands before the institution there is what was studied, whether or not we know the word for it.
      const before = segs.slice(0, segs.indexOf(inst)).find((x) => x.length >= 3 && !statusCue(x) && !/^\W*$/.test(x)) ?? "";
      cur = { qualification: before || (!cur || cur.institution ? prevPlain : ""), institution: inst, period: year || pendingYear, quote: raw }; pendingYear = ""; entries.push(cur);
    } else if (cur && year && !cur.period) cur.period = year;
    if (!deg && !inst) prevPlain = line.length <= 80 && !/^\d{4}/.test(line) ? line : "";
    else prevPlain = "";
  }
  return entries.filter((e) => e.qualification || e.institution);
}

const RECORD_END = /(?:\b(?:19|20)\d{2}|\b(?:completed|complete|in progress|ongoing|not completed|incomplete|obtained|awarded|passed|expired))\s*$/i;
/** A record written across one line with bars ("Name | Issuer | Completed | 2023") can wrap in a narrow column. A piece that ends or starts with a bar, or is followed by a line that continues it, is rejoined. */
export function rejoinBarRecords(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1], t = l.trim();
    // A qualification on one line and where it was taken on the next: two pieces of one record, not one long name.
    if (prev !== undefined && !prev.includes("|") && DEGREE.test(prev) && !INSTITUTION.test(prev) && !DEGREE.test(t.split("|")[0].split(",")[0]) && INSTITUTION.test(t.split("|")[0])) { out[out.length - 1] = `${prev.trim()} | ${t}`; continue; }
    if (prev !== undefined && (/\|\s*$/.test(prev) || /^\|/.test(t))) out[out.length - 1] = `${prev.trim()} ${t}`;
    else if (prev !== undefined && t.includes("|") && !prev.includes("|") && !/[.:]$/.test(prev) && !DEGREE.test(t.split("|")[0]) && prev.length <= 60 && !isBullet(t) && !isBullet(prev) && !/\b(?:19|20)\d{2}\)?\s*$/.test(prev)) out[out.length - 1] = `${prev.trim()} ${t}`;
    // a record that has not reached its status or year yet, followed by more of it: "Diploma | Central" then "Valley University | Completed | 2020"
    // a record's issuer on the line below it, with the record already complete: "Reporting Certificate | Completed | 2024" then "Harbour Learning Centre"
    else if (prev !== undefined && RECORD_END.test(prev) && prev.split("|").length === 3 && !t.includes("|") && !isBullet(t) && t.split(/\s+/).length <= 6 && /^\p{Lu}/u.test(t) && !/[.:]$/.test(t) && !DEGREE.test(t)) { const [name, ...rest] = prev.split("|"); out[out.length - 1] = `${name.trim()} | ${t} | ${rest.map((x) => x.trim()).join(" | ")}`; }
    // Two rows with the same number of cells are rows of one table, each already whole.
    else if (prev !== undefined && prev.split("|").length >= 3 && prev.split("|").length === t.split("|").length) out.push(l);
    else if (prev !== undefined && prev.includes("|") && !RECORD_END.test(prev) && !isBullet(t) && !DEGREE.test(t.split("|")[0]) && t.length <= 70 && !/[.:]$/.test(t)) out[out.length - 1] = `${prev.trim()} ${t}`;
    else out.push(l);
  }
  return out;
}
/** "Name | Issuer | Completed | 2023": which piece is which comes from what each piece looks like, and a piece that is nothing recognisable stays with the name rather than being guessed. */
export function splitBarRecord(line: string): { degree: string; institution: string; year: string } | null {
  if (!line.includes("|")) return null;
  const parts = line.split("|").map((x) => x.trim()).filter(Boolean);
  const year = parts.find((x) => /^(?:19|20)\d{2}$/.test(x)) ?? "", status = parts.find((x) => /^(?:completed|complete|in progress|ongoing|not completed|incomplete|obtained|awarded|passed|expired)$/i.test(x)) ?? "", rest = parts.filter((x) => x !== year && x !== status);
  if (!rest.length) return null;
  return { degree: rest[0], institution: rest.slice(1).join(", "), year: status && (statusCue(status) || /expired/i.test(status)) ? `${year} (${status})`.trim() : year || status };
}

// A form's employment record: a position, the row above it naming the employer, the row below giving the dates. "EMPLOYER | Northwind" / "POSITION HELD | Analyst" / "DURATION | Jan 2019 - Mar 2021". Rewritten to the one line the
// experience reader understands; what follows stays as that role's duties.
const FORM_POSITION = /^(?:[➢•·\-\s]*)(?:position(?:\s+held)?|job\s+title|title|role|designation)\s*[:|]?\s*(?:\|\s*)?[➢•·\-\s]*(.+)$/i, FORM_DATES = /^(?:[➢•·\-\s]*)(?:duration|period|dates?|employment\s+dates?|employed)\s*[:|]\s*[➢•·\-\s]*(.+)$/i, FORM_LABELLED = /^([A-Z][A-Za-z ]{2,24}?)\s*[:|]\s*[➢•·\-\s]*(.+)$/;
export function formRoles(input: string[]): string[] {
  // Dates in their own column come before the role: when the first dated line of the section is nothing but dates and stands first, "dates" / "Title" / "Employer | Permanent" is one role.
  const lines = [...input], bare = (l?: string) => { if (!l) return false; const r = findRange(l); return !!r && !isBullet(l) && l.replace(r.full, "").replace(/[\s|()–—-]/g, "") === ""; };
  if (bare(lines[0])) for (let i = 0; i + 2 < lines.length; i++) if (bare(lines[i]) && !isBullet(lines[i + 1]) && !isBullet(lines[i + 2]) && !findRange(lines[i + 1]) && !findRange(lines[i + 2]) && lines[i + 1].length <= 80 && lines[i + 2].length <= 90) { lines.splice(i, 3, `${lines[i + 1].trim()} | ${lines[i + 2].split("|")[0].trim()} | ${lines[i].trim()}`); }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const pos = lines[i].match(FORM_POSITION), dates = lines[i + 1]?.match(FORM_DATES) ?? lines[i + 2]?.match(FORM_DATES);
    if (!pos || !dates || !findRange(dates[1])) { out.push(lines[i]); continue; }
    const prior = out.length ? out[out.length - 1].match(FORM_LABELLED) : null, between = lines[i + 1]?.match(FORM_DATES) ? null : lines[i + 2]?.match(FORM_DATES) ? lines[i + 1].match(FORM_LABELLED) : null;
    const company = between?.[2] ?? prior?.[2] ?? "";
    if (prior && !between) out.pop();
    out.push(`${pos[1].trim()} | ${company.trim()} | ${dates[1].trim()}`);
    i += between ? 2 : lines[i + 1]?.match(FORM_DATES) ? 1 : 2;
  }
  return out;
}

const LANGUAGE_NAME = new RegExp(`\\b(?:${readingConfig.languageNames.join("|")})\\b`, "i");
/** Only what names a language: "English (fluent)" is English, and "Excellent" from a language table is not a language. */
const namedLanguages = (pieces: string[]) => pieces.filter((p) => LANGUAGE_NAME.test(p.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))).map((p) => p.replace(/\s*[([:-].*$/, "").trim()).filter(Boolean);

// R112: an agency's terms are not a summary of the person. See extractionConfig.legalParagraph: a list of words, so a patch, and called that.
const wordIn = (t: string, w: string) => new RegExp(`\\b${w.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t);
export function isLegalParagraph(t: string): boolean {
  const c = readingConfig.legalParagraph, terms = c.terms.filter((w) => wordIn(t, w)).length;
  if (c.speaksOfDocument.some((w) => wordIn(t, w))) return terms >= 1;
  return c.speaksOfCandidate.some((w) => wordIn(t, w)) && terms >= 2;
}

/** The paragraph without what is the agency's: nothing if all of it is, and otherwise without any sentence in the agency's own voice. */
function withoutLegalText(p: string): string {
  if (isLegalParagraph(p)) return "";
  const sentences = p.split(/(?<=[.!?])\s+/), kept = sentences.filter((s) => !readingConfig.legalParagraph.agencyVoice.some((w) => wordIn(s, w)) && !isLegalParagraph(s));
  if (kept.length === sentences.length) return p;   // nothing of the agency's: exactly as it was
  const rest = kept.join(" ").trim();
  return rest.length >= 40 ? rest : "";
}

// ---------------------------------------------------------------- sections from what they hold
// A heading's wording varies without limit, so it cannot decide what a section is. What sits under it can: dated roles are a work history, qualifications are education, short items are a list. A heading's words are
// one piece of evidence among those. Whether a line is a heading at all comes from how it stands out, not from a list of headings. The words here are evidence and never a condition.
const STEMS: [Section, RegExp][] = [["experience", /\b(?:experience|employment|career|work|history|appointments?|positions?|jobs?)\b/i], ["education", /\b(?:education|qualifications?|academic|studies|degrees?|schooling)\b/i], ["certifications", /\b(?:certifications?|certificates?|courses?|training|licen[cs]es?|accreditations?|learning)\b/i], ["skills", /\b(?:skills?|competenc(?:y|ies)|technologies|tools|expertise|capabilit(?:y|ies))\b/i], ["languages", /\blanguages?\b/i], ["summary", /\b(?:summary|profile|overview|about|objective|statement)\b/i], ["projects", /\b(?:projects?|portfolio|assignments?)\b/i], ["notable", /\b(?:achievements?|awards?|accomplishments?|volunteer\w*|publications?|examples?)\b/i], ["contact", /\b(?:contact|details)\b/i], ["other", /\b(?:references?|referees?|interests?|hobbies|declaration|availability|arrangements?|information|disclaimer)\b/i]];
const STATUS_WORD = /\b(?:completed?|in progress|ongoing|not completed|incomplete|obtained|awarded|passed|expired)\b/i, CONTACT_MARK = /@|(?:\+?\d[\d\s()-]{8,}\d)/;
const headingText = (l: string) => l.trim().replace(/^\d{1,2}[.)]\s+/, "").replace(/\s*:$/, "");
// A row of cells or a list is not running text, however many words it holds.
const isSentence = (l: string) => /[.!?]$/.test(l.trim()) || l.split(/\s\/\s|\|/).some((cell) => cell.trim().split(/\s+/).length >= 11);
const isRecordRow = (l: string) => l.includes("|") && (STATUS_WORD.test(l) || /\b(?:19|20)\d{2}\s*$/.test(l.trim()));
const isCapitals = (l: string) => { const letters = l.replace(/[^\p{L}]/gu, ""); return letters.length >= 4 && letters === letters.toUpperCase(); };
function headingShaped(l: string): boolean {
  const t = headingText(l);
  return t.length >= 3 && t.length <= 48 && t.split(/\s+/).length <= 6 && !isBullet(l) && /^[\p{Lu}\d]/u.test(t) && !/[.,;|@]/.test(t) && !findRange(t) && !/\b(?:19|20)\d{2}\b/.test(t) && !/^[^:]{1,30}:\s+\S/.test(l.trim()) && (t.match(/\s\/\s/g) ?? []).length < 2 && !/\s\/\s*$/.test(l.trim());   // two slashes, or one at the end, are a list's row
}
/** A list that wraps says so: its rows end on a separator, or hold several short items. The short line above such a run is what the list is. */
const startsAList = (lines: string[], i: number) => { const rows = lines.slice(i + 1, i + 4).filter(Boolean), marked = rows.filter((r) => /\s[/|,;]$/.test(r.trim()) || (r.split(/\s\/\s|\s\|\s/).length >= 3 && r.split(/\s\/\s|\s\|\s/).every((x) => x.trim().split(/\s+/).length <= 4))); const cells = (r?: string) => (r ?? "").split(/\s\/\s|\s\|\s/); const wideRow = cells(rows[0]).length >= 4 && cells(rows[0]).every((x) => x.trim().split(/\s+/).length <= 4); return rows.length >= 1 && (wideRow || marked.length >= Math.min(2, rows.length)); };
// R99. "Training" under SKILLS can be a skill. A word's meaning cannot tell; how it stands can: where this document's headings are in capitals, a word in plain text between other short lines is the next item of a list.
const capitalHeadings = new WeakMap<string[], number>();
function countCapitalHeadings(lines: string[]) {
  let n = capitalHeadings.get(lines);
  if (n === undefined) { n = lines.filter((l, i) => i > 2 && headingShaped(l) && isCapitals(headingText(l))).length; capitalHeadings.set(lines, n); }
  return n;
}
function isListItemNamedLikeASection(lines: string[], i: number, t: string, emphasised?: Set<string>) {
  const l = lines[i], before = lines[i - 1], next = lines[i + 1];
  if (isCapitals(t) || emphasised?.has(l.trim()) || /:\s*$/.test(l) || t.split(/\s+/).length > 2) return false;
  if (before === undefined || !headingShaped(before) || (next !== undefined && !headingShaped(next))) return false;
  return countCapitalHeadings(lines) >= 2;
}
function looksLikeHeading(lines: string[], i: number, emphasised?: Set<string>): boolean {
  const l = lines[i]; if (!headingShaped(l)) return false;
  // A line naming a course or an issuer can hold a section's word ("Certificate in Business Administration", "Bridgeway Professional Training"). A heading follows the end of something; one of these follows another short line, or says what it is in.
  const before = lines[i - 1];
  const t = headingText(l), next = lines[i + 1], known = !!headingOf(l, CV_HEADINGS as [string, RegExp][]), stem = STEMS.some(([, re]) => re.test(t));
  if (known) return !isListItemNamedLikeASection(lines, i, t, emphasised);
  // the first line of a role or a qualification, not a heading: its dates or its institution come straight after
  const type = classifyQualification(t).type, namesAJob = ROLE_WORD.test(t) || TITLE_WORD.test(t), qualification = ["degree", "diploma", "school"].includes(type) || (type !== "other" && !stem);
  if (next !== undefined && findRange(next) && (namesAJob || (!isCapitals(t) && !emphasised?.has(l.trim())))) return false;
  if (qualification) return false;
  const stands = isCapitals(t) || !!emphasised?.has(l.trim()) || /:\s*$/.test(l) || (!/\s\/\s/.test(t) && startsAList(lines, i));
  if (!stem && !stands) return false;
  // Not standing out, so the line above decides: after another short line that is itself no heading, this one is the next item of a list or record. A named qualification is an item, whatever words it holds.
  if (!stands && (["degree", "diploma", "school"].includes(type) || (type !== "other" && (t.split(/\s+/).length >= 3 || /\b(?:in|of)\b/i.test(t))))) return false;
  const beforeHeads = before !== undefined && (!!headingOf(before, CV_HEADINGS as [string, RegExp][]) || isCapitals(headingText(before)) || (STEMS.some(([, re]) => re.test(headingText(before))) && classifyQualification(headingText(before)).type === "other"));
  if (!stands && before !== undefined && headingShaped(before) && !/\s\/\s/.test(before) && !beforeHeads) return false;
  // a list set in capitals or bold: each item stands out the same way as its neighbours
  if (!stem && next !== undefined && headingShaped(next) && ((isCapitals(t) && isCapitals(headingText(next))) || (!!emphasised?.has(l.trim()) && !!emphasised?.has(next.trim())))) return false;
  if (!stem && i > 0 && headingShaped(lines[i - 1]) && ((isCapitals(t) && isCapitals(headingText(lines[i - 1]))) || (!!emphasised?.has(l.trim()) && !!emphasised?.has(lines[i - 1].trim())))) return false;
  return !namesAJob || stem;
}
/** Many short items in a row, however long the row runs: a list, not a sentence. A long list wraps, and its first row can be as long as any paragraph's. */
export function isListRow(l: string): boolean {
  if (/[.!?]$/.test(l.trim())) return false;
  const parts = l.split(/[,;|•·]/).map((x) => x.trim()).filter(Boolean);
  return parts.length >= 4 && parts.every((x) => x.split(/\s+/).length <= 4);
}
/** What a block of lines holds, with a heading's words as one input. `seen` says what is already there: running text after the summary is not a second summary. */
function blockKind(heading: string, body: string[], at: number, seen: Set<Section>, inWork: boolean): { kind: Section; scores: Partial<Record<Section, number>> } {
  const score: Partial<Record<Section, number>> = {}, add = (k: Section, n: number) => { score[k] = (score[k] ?? 0) + n; };
  const exact = heading ? (headingOf(heading, CV_HEADINGS as [string, RegExp][]) as Section | null) : null;
  const stems = heading ? STEMS.filter(([, re]) => re.test(headingText(heading))).map(([k]) => k) : [];
  if (exact) add(exact, 5); else for (const k of stems) add(k, 3);
  const plain = body.filter((l) => !isBullet(l)), bullets = body.length - plain.length;
  let quals = 0, certs = 0, dated = 0;
  for (const l of plain) {
    const first = l.split("|")[0], type = classifyQualification(first).type, record = isRecordRow(l) && !findRange(l);
    const range = findRange(l);
    if (range && !isSentence(l) && l.length <= 140 && !(DEGREE.test(first) || (INSTITUTION.test(l) && !ROLE_WORD.test(l)))) dated++;
    else if (["degree", "diploma", "school"].includes(type) && !isSentence(l)) quals++;
    else if (record || (type === "certificate" && !isSentence(l))) { if (INSTITUTION.test(first)) quals += 0.5; else certs++; }
    else if (INSTITUTION.test(l) && !isSentence(l) && l.length <= 90) quals += 0.5;
  }
  add("experience", dated * 6 + (dated ? Math.min(bullets * 0.5, 2) : 0)); add("education", quals * 3); add("certifications", certs * 3);
  // lists: several short items across a row, or a run of short rows
  const items = plain.filter((l) => (isListRow(l) || !isSentence(l)) && !CONTACT_MARK.test(l) && !findRange(l) && !isRecordRow(l)), across = items.filter((l) => { const parts = l.split(/\s\/\s|[,;•·|]/).map((x) => x.trim()).filter(Boolean); return parts.length >= 3 && parts.every((x) => x.split(/\s+/).length <= 5) && !DEGREE.test(parts[0]) && !["degree", "diploma", "school"].includes(classifyQualification(parts[0]).type) && !INSTITUTION.test(l); }).length, stacked = items.filter((l) => l.split(/\s+/).length <= 4).length;
  const langs = body.flatMap((l) => l.split(/[,;|•·]/)).map((x) => x.trim()).filter(Boolean), named = langs.filter((x) => new RegExp(`\\b(?:${readingConfig.languageNames.join("|")})\\b`, "i").test(x)).length;
  if (langs.length && named / langs.length >= 0.5) add("languages", 8);
  const prose = body.filter((l) => !isListRow(l) && (isSentence(l) || (!isRecordRow(l) && !/\s\/\s/.test(l) && l.trim().split(/\s+/).length >= 7))).length;
  // dated roles settle it: a role's duties can read like a list, but a list has no dates
  const listShaped = !dated && !prose && !!plain.length && (across / plain.length >= 0.5 || stacked / plain.length >= 0.8);
  if (!dated) add("skills", across * 4 + (stacked >= 3 && !quals && !certs ? 2 + stacked * 0.2 : 0) - (prose && !across && !exact ? 3 : 0));
  const contact = plain.filter((l) => CONTACT_MARK.test(l)).length;
  const firstPerson = !seen.has("summary") && body.some((l) => /\b(?:I|my)\b/.test(l) && isSentence(l));
  if (prose && !dated && !quals && !exact) add(seen.has("summary") ? "notable" : "summary", Math.min(prose, 3) * 2);
  if (contact) add("contact", contact * 3 + (at < 10 ? 6 : 0));
  if (prose && plain.some((l) => /\b(?:19|20)\d{2}\s*$/.test(l.trim()) && !findRange(l) && l.length <= 70 && !l.includes("|"))) add("projects", 4);
  const best = (Object.entries(score) as [Section, number][]).sort((a, b) => b[1] - a[1])[0];
  let kind: Section = best && best[1] >= 2 ? best[0] : "other";
  // Qualifications and courses go to one list, and a heading that names one of the two says which.
  if (exact && (exact === "education" || exact === "certifications") && (kind === "education" || kind === "certifications")) kind = exact;
  // Sections nest. Inside a work history a company's name, "Responsibilities" or a project's title are parts of a role, however they stand out. It ends only where a heading names something else, or the content plainly is something else.
  if (inWork && kind !== "experience") {
    const named = !!exact || stems.some((k) => k !== "experience" && k !== "contact"), plainlyElse = quals >= 1 || certs >= 1 || (kind === "languages") || (listShaped && (plain.length <= 6 || (bullets === 0 && isCapitals(headingText(heading))))) || firstPerson;
    if (!named && !plainlyElse) kind = "experience";
  }
  return { kind, scores: score };
}
/** Splits a document at its headings and decides each section from what it holds. `blocks` keeps each decision and its evidence. */
export function sectionsByContent(lines: string[], emphasised?: Set<string>) {
  const header: string[] = [], sections = new Map<Section, string[]>(), blocks: { heading: string; kind: Section; lines: number; scores: Partial<Record<Section, number>> }[] = [], seen = new Set<Section>();
  const parts: { heading: string; body: string[]; at: number }[] = []; let cur: (typeof parts)[number] | null = null;
  // "Languages: English, isiZulu" and "Skills: A, B" belong to their section wherever they are written, and "Notice period: Two months" to none
  const labelled: [Section, string][] = [];
  lines.forEach((l, i) => {
    const run = l.trim().match(/^([\p{Lu}][\p{L} &/-]{2,28}):\s+(\S.*)$/u);
    if (run) { const stem = STEMS.find(([k, re]) => re.test(run[1]) && (k === "languages" || k === "skills")); if (stem) { labelled.push([stem[0], run[2]]); return; } if (/\b(?:notice|preference|availability|salary|nationality|arrangement)\b/i.test(run[1])) { labelled.push(["other", l]); return; } }
    if (looksLikeHeading(lines, i, emphasised)) { cur = { heading: l, body: [], at: i }; parts.push(cur); return; }
    if (cur) cur.body.push(l); else header.push(l);
  });
  if (!parts.length && !labelled.length) return { header: lines, sections, blocks };
  let inWork = false, previous: Section | null = null;
  for (const p of parts) {
    if (!p.body.length) continue;   // a heading with nothing under it says nothing
    const { kind, scores } = blockKind(p.heading, p.body, p.at, seen, inWork);
    // A line that stands out but names no section ("Brookhaven Industries" in bold, "HRIS" in capitals) only starts a section if what follows is something else. Otherwise it is part of what came before, and stays as content: it may be an employer or a skill.
    const named = !!headingOf(p.heading, CV_HEADINGS as [string, RegExp][]) || STEMS.some(([, re]) => re.test(headingText(p.heading)));
    const content: boolean = !named && !!previous && (kind === previous || kind === "other");
    const into: Section = content ? previous! : kind;
    inWork = into === "experience"; previous = into;
    blocks.push({ heading: p.heading, kind: into, lines: p.body.length, scores }); seen.add(into);
    sections.set(into, [...(sections.get(into) ?? []), ...(content ? [p.heading] : []), ...p.body]);
  }
  for (const [k, l] of labelled) sections.set(k, [...(sections.get(k) ?? []), l]);
  return { header, sections, blocks };
}

/** What the candidate pipeline reads from, and checks every quote against: the same words, with dates written so they read as dates. */
export function candidateText(text: string): string {
  const when = "(?:[A-Za-z]{3,9}\\s+)?(?:\\d{1,2}[/.])?(?:19|20)\\d{2}(?:[/.-]\\d{1,2})?", until = `${when}|present|current|to date|date|now`;
  return text.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.(?=\s*(?:19|20)\d{2})/g, "$1")
    // dates in a narrow column, stacked: "Jan 2021" / "to" / "Current" are one range
    .replace(new RegExp(`^(\\s*${when})\\s*\\n\\s*(to|until|-|–|—)\\s*\\n\\s*(${until})\\s*$`, "gmi"), "$1 $2 $3")
    .replace(new RegExp(`^(\\s*${when})\\s*(-|–|—|to)\\s*\\n\\s*(${until})\\s*$`, "gmi"), "$1 $2 $3");
}

/** The same job listed twice, as a summary and then in detail: one role, the fuller one kept where the first stood. The same start year and the same employer or the same title. */
function withoutRepeatedRoles<T extends { position: string; company: string; startDate?: string; responsibilities: string[] }>(roles: T[]): T[] {
  const out: T[] = [], key = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(), year = (s?: string) => String(s ?? "").match(/(?:19|20)\d{2}/)?.[0] ?? "", close = (a: string, b: string) => !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
  for (const r of roles) {
    const same = year(r.startDate) ? out.find((x) => year(x.startDate) === year(r.startDate) && close(key(x.company), key(r.company)) && close(key(x.position), key(r.position))) : undefined;
    if (!same) { out.push(r); continue; }
    if (r.responsibilities.length > same.responsibilities.length) same.responsibilities = r.responsibilities;
  }
  return out;
}

/** A note in brackets that the page wrapped: "... 2010 (did not" / "complete; left in third year)". One line, before anything decides what section each line belongs to, or its second half is read as something else. */
function joinOpenBrackets(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) { const prev = out[out.length - 1]; if (prev !== undefined && (prev.match(/\(/g)?.length ?? 0) > (prev.match(/\)/g)?.length ?? 0) && /^[^(]*\)/.test(l) && l.trim().length <= 80) out[out.length - 1] = `${prev} ${l.trim()}`; else out.push(l); }
  return out;
}

/** A duty that wrapped: a line that has not finished its sentence, ending on a word that needs more, runs on into the next, even if that one starts with a capital ("...practices, including" / "Guidewire and Azure."). */
function joinWrappedDuties(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) { const prev = out[out.length - 1]; if (prev !== undefined && !isBullet(l) && /\b(?:including|and|or|of|the|for|to|with|in|across|a|an|such as|on|at|by)\s*$/i.test(prev)) out[out.length - 1] = `${prev.trim()} ${l.trim()}`; else out.push(l); }
  return out;
}

/** A role carried over a page repeats its own title with no dates. That is not another role: what follows it belongs to the role it repeats. Judged from the roles, in whatever words the document says "continued". */
function joinCarriedRoles<T extends { position: string; company: string; startDate?: string; responsibilities: string[] }>(roles: T[]): T[] {
  const out: T[] = [], key = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const r of roles) {
    const whole = key(`${r.position} ${r.company}`), earlier = !String(r.startDate ?? "").trim() ? out.find((x) => x.startDate && key(x.position) && whole.includes(key(x.position)) && (!key(x.company) || whole.includes(key(x.company)))) : undefined;
    if (earlier) earlier.responsibilities.push(...r.responsibilities); else out.push(r);
  }
  return out;
}

export function parseCv(text: string, opts: { emphasised?: Set<string> } = {}) {
  text=cleanInvisible(text).text;
  text = candidateText(text);
  const lines = tidyLines(withoutTableHeadRows(unfoldRunInRoles(separateRunTogetherRoles(unfoldRoleTables(unfoldLabelledFacts(canonicalRoleLines(joinOpenBrackets(toLines(text)))))))));
  const byContent = sectionsByContent(lines, opts.emphasised);
  const split = byContent?.sections.size ? byContent : splitSections(lines, CV_HEADINGS);
  const sections = split.sections;
  const get = (s: Section) => sections.get(s) ?? [];
  const header = [...split.header, ...get("contact")]; // a "Contact" block is part of the header, wherever it sits
  const refLines = new Set(get("other"));
  const contactText = lines.filter((l) => !refLines.has(l)).join("\n");
  // A CV with no headings at all: read the whole body for dated roles and qualifications
  const body = [...split.header.slice(2), ...[...sections.values()].flat()];
  const hasHeadings = [...sections.keys()].some((k) => k !== "contact" && k !== "other" && k !== "summary" && k !== "skills" && k !== "languages");
  const reports: StepReport[] = [];
  const asItems = (s: Section) => toItems(get(s)).map((i) => ({ text: i.text, quote: i.raw }));
  // lines that belong to no recognised section other than these are where a missing heading would hide something
  const outside = (...skip: Section[]) => [...split.header.slice(2), ...[...sections].filter(([k]) => !skip.includes(k)).flatMap(([, v]) => v)];

  // ---- The plan, in the order the candidate panel shows it (see cvPlan.ts). Each step runs its ways of looking until one finds something.
  // 1. identity: name and contact come from the header block, then from anywhere in the text
  const readIdentity = (from: string[], searchIn: string) => {
    const c = parseContact(from.filter((l) => !refLines.has(l)), searchIn, parseName(from, searchIn.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? ""));
    return { ...c, fullName: parseName(from, c.email) || nameNearEmail(searchIn.split("\n"), c.email) };
  };
  const identity = runStep("identity", reports, [
    ["header block", () => readIdentity(header, header.join("\n"))],
    ["whole text", () => readIdentity(header, contactText)],
  ], (x) => (x.fullName && (x.email || x.phone) ? [x.fullName, x.email, x.phone, x.location].filter(Boolean).length : 0));
  const { email, phone, location, fullName } = identity;

  // 2. summary
  const summary = runStep("summary", reports, [
    ["Summary heading", () => toItems(get("summary")).map((i) => withoutLegalText(i.text)).filter(Boolean).join(" ")],
    ["opening paragraph before the first heading", () => { const t = split.header.slice(2).filter((l) => l.length > 60 && !l.includes("@") && !isBullet(l)).join(" "); return withoutLegalText(t); }],
    ["sentences anywhere (no headings in this CV)", () => (hasHeadings ? "" : body.filter((l) => l.length > 60 && !l.includes("@")).join(" "))],
  ], (t) => (t.trim() ? 1 : 0)).slice(0, 1500);

  // 3. skills: everything listed under the skills heading, plus recognised skills used in work or projects
  // A wrapped list is joined to be read, and lines between its rows may belong elsewhere, so the joined rows are not always a quote the document holds. Each item is then quoted as itself.
  const contiguous = (q: string) => { const flat = (x: string) => x.replace(/[\s|•·]+/g, ""); return flat(text).includes(flat(q)); };
  // A list of many short items with no heading over it: in a CV without headings, that is the skills. Sentences do not qualify, so a line naming departments in passing stays where it is.
  const unheadedList = () => { const ls = outside("experience", "education", "certifications", "projects", "languages", "contact"), at = ls.findIndex((l) => isListRow(l) && !CONTACT_MARK.test(l) && !/^[^:]{2,32}:\s/.test(l)); return at < 0 ? [] : [ls[at], ...(ls[at + 1] && /^\p{Ll}/u.test(ls[at + 1]) && ls[at + 1].split(/\s+/).length <= 3 ? [ls[at + 1]] : [])]; };
  // "Languages: Python, SQL" is a line of skills that a heading word took away: what is in a languages section and names no spoken language is not a language.
  const notSpoken = get("languages").filter((l) => { const pieces = stripBullet(l).replace(/^languages?\s*:/i, "").split(/[,;|•·]/).map((x) => x.trim()).filter(Boolean); return pieces.length > 0 && !namedLanguages(pieces).length; });
  const skillLines = !get("skills").length ? unheadedList() : get("skills");
  const listed = [...parseSkills(rejoinBarRecords(skillLines)), ...parseSkills(notSpoken.map((l) => stripBullet(l).replace(/^languages?\s*:\s*/i, "")))].map((s) => (!contiguous(s.quote) ? { ...s, quote: s.name } : s));
  const SOFT = new Set(["Communication", "Mentoring", "Technical leadership", "Ownership"]);
  const structured = sections.size > 0;
  const bodyText = structured ? [...get("experience"), ...get("projects"), ...get("summary"), ...get("notable")].join("\n") : text;
  const printed = (name: string) => new RegExp(`(?:^|[^\\p{L}])${name.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}])`, "iu").test(text);   // the candidate pipeline keeps a skill only under a name the document itself prints, never a name from the dictionary
  // A line saying the person has not done something is not evidence that they have: "I have no hands-on experience with PostgreSQL".
  const knownFrom = bodyText.split("\n").filter((l) => !saidNotDone(l)).join("\n");
  const known = findSkills(knownFrom).filter((s) => !SOFT.has(s.name) && printed(s.name)).map((s) => ({ name: s.name, quote: quoteFor(knownFrom, s) ?? "" })).filter((s) => s.quote);
  const seen = new Set<string>();
  const skills = runStep("skills", reports, [
    ["Skills heading", () => dedupeSkills([...listed, ...known], seen)],
    ["skills named in the text", () => dedupeSkills(findSkills(text).filter((x) => !SOFT.has(x.name) && printed(x.name)).map((x) => ({ name: x.name, quote: quoteFor(text, x) ?? "" })).filter((x) => x.quote), new Set())],
  ], (x) => x.length);

  // 4. education: degrees, diplomas, school AND certifications, in one list
  const certFrom = (ls: string[]) => toItems(rejoinBarRecords(ls)).map((i) => ({ ...(splitBarRecord(i.text) ?? splitCertificate(i.text)), raw: i.raw })).filter((c) => c.degree.length >= 2)
    .map((c) => ({ qualification: c.degree, institution: c.institution, period: c.year, quote: c.raw, fromCertifications: true }));
  const eduFrom = (ls: string[]) => parseEducation(rejoinBarRecords(ls)).map((e) => ({ ...e, fromCertifications: false }));
  const certLike = /\b(certified|certification|certificate|licen[sc]e|accredited|short course|diploma in|training course)\b/i;
  const education = runStep("education", reports, [
    ["Education and Certifications headings", () => [...eduFrom(get("education")), ...certFrom(get("certifications"))]],
    ["qualification lines outside the work history", () => { const ls = outside("experience", "projects", "education", "certifications").filter((l) => !isBullet(l) && l.length <= 160); return [...eduFrom(ls.filter((l) => DEGREE.test(l) || INSTITUTION.test(l))), ...certFrom(ls.filter((l) => (isRecordRow(l) && !isSentence(l) && !findRange(l) && !DEGREE.test(l)) || certLike.test(l) && !DEGREE.test(l)))]; }],
    ["qualification lines anywhere in the document", () => { const ls = lines.filter((l) => !isBullet(l) && l.length <= 140); return eduFrom(ls.filter((l) => DEGREE.test(l) && INSTITUTION.test(l))); }],
  ], (x) => x.length);

  // 5. work history
  const roleLooksReal = (r: { position: string; company: string }) => ROLE_WORD.test(r.position) || TITLE_WORD.test(r.position);
  const readRoles = (ls: string[]) => withoutRepeatedRoles(joinCarriedRoles(parseExperience(formRoles(ls), ls)));
  const workHistory = runStep("experience", reports, [
    ["Experience heading", () => readRoles(get("experience").length ? get("experience") : hasHeadings ? [] : body)],
    ["dated roles outside the other sections (no Experience heading)", () => (hasHeadings ? readRoles(outside("education", "certifications", "skills", "summary", "languages", "projects", "other")).filter(roleLooksReal) : [])],
    ["plain sentences (\"I worked for X from 2013 to 2017\")", () => {
      const found: ReturnType<typeof parseExperience> = [];
      for (const sentence of body.flatMap((l) => l.split(/(?<=[.!?])\s+(?=\p{Lu})/u))) {
        const m = sentence.match(/\b(?:worked|working|employed|work)\s+(?:at|for|with)\s+(\p{Lu}[\p{L}&'’. -]{2,50}?)\s*,?\s+(?:from|between)\s+((?:19|20)\d{2})\s+(?:to|until|and|-)\s+((?:19|20)\d{2}|present|now|date)\b/iu);
        if (m) found.push({ company: clean(m[1]), position: "", startDate: m[2], endDate: m[3], responsibilities: [], quote: sentence } as (typeof found)[number]);
      }
      return hasHeadings ? [] : found;
    }],
  ], (x) => x.length);

  // 6, 7. projects and worth noting come only from their own headings
  const projects = runStep("projects", reports, [["Projects heading", () => titledItems(asItems("projects")).map((p) => ({ description: p.text, quote: p.quote }))]], (x) => x.length);
  const worthNoting = runStep("notable", reports, [["Worth noting headings", () => asItems("notable").map((p) => ({ text: p.text, quote: p.quote }))]], (x) => x.length);

  const roleLine = header.slice(0, 4).flatMap((l) => l.split(/\s*[|•·]\s*/)).find((l) => (TITLE_WORD.test(l) || ROLE_WORD.test(l)) && !l.includes("@") && !/\d{3}/.test(l) && l.length < 60 && l.split(" ").length <= 6 && !GREETING.test(l) && !/[,.]$/.test(l) && !l.includes(":")) ?? "";   // a "Label: value" line is a fact, never the headline
  const currentJob = workHistory.find((w) => new RegExp(`^(?:${PRESENT_WORDS})$`, "i").test(w.endDate.trim()));
  return {
    fullName, email, phone, location,
    currentRole: roleLine || currentJob?.position || "",
    summary, skills, workHistory, education, projects, worthNoting,
    certifications: [] as string[], // certifications are entries of the education list (fromCertifications), not a list of their own
    languages: (() => { const all = get("languages").flatMap((l) => stripBullet(l).replace(/^languages?\s*:/i, "").split(/[,;|•·]/)).map((x) => x.trim()).filter((x) => x && x.length < 30); return namedLanguages(all); })(),
    sections: reports,
  };
}

function dedupeSkills<T extends { name: string }>(list: T[], seen: Set<string>): T[] {
  return list.filter((x) => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Job descriptions are read by Claude alone since 10 Nov 2026 (src/jobReader.ts): the job reading rules that stood here are removed, not disabled.
