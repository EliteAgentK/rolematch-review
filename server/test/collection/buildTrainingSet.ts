// Builds the reader's fine-tuning set from the fictional packs in Downloads, whose own answer keys say what each CV prints (docs/learning/FINE_TUNE_PLAN_2026-11-06.md).
//   node --import tsx test/collection/buildTrainingSet.ts [outDir]      default ~/rolematch-ml/data
// Each document is read the way live reads it (readDocument), numbered the way the reader numbers it (readerInput), and asked the way live asks it (READER_SYSTEM and
// the same user line). The answer is built from the key, never from a model: every value must be found in the document's own lines, and what validateReading would
// drop or change sinks the whole document rather than being repaired. A CV's Word and PDF copies always go to the same split. The 30 real CVs are never read here;
// any document sharing half its 8-word shingles with one of them is left out. Prints counts only; the set stays on this Mac.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readDocument } from "../../src/parse";
import { sniff } from "../../src/formats";
import { READER_SYSTEM, readerInput, regionInput, validateReading } from "../../src/modelReader";
import { REGION_SYSTEM, regionsOf } from "../../src/hybridReader";

const DL = join(homedir(), "Downloads"), OUT = process.argv[2] ?? join(homedir(), "rolematch-ml", "data");
const PACKS = ["RoleMatch_300_Long_Form_CVs 2", "RoleMatch_60_Visual_Variety_CVs 3", "RoleMatch_Long_CVs"];
const FORMATS = ["01_Word", "02_Searchable_PDF"];   // scans and photos come later, once OCR time on this Mac is known
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+#]+/g, " ").trim();
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_TOKEN = new RegExp(`(${MONTH}\\s*\\d{4}|\\d{1,2}\\s*[/.-]\\s*\\d{4}|\\d{4}\\s*[/.-]\\s*\\d{1,2}|\\d{4}|present|current|now|to date)`, "gi");
const yearOf = (s: string) => (String(s).match(/\d{4}/) ?? [""])[0];
const shingles = (t: string) => { const w = norm(t).split(" "), s = new Set<string>(); for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" ")); return s; };

const testCache = JSON.parse(readFileSync(join("data", "real-cvs", "keys", "text-cache.json"), "utf8"));
const protectedShingles = Object.values(testCache).map((c: any) => shingles(c.text)), protectedTexts = Object.values(testCache).map((c: any) => norm(c.text));
// AGENCIES=1 and SECTIONS=1 build step 5's set (lora3); without them the set is lora2's, as before.
const AGENCIES = process.env.AGENCIES === "1", SECTIONS = process.env.SECTIONS === "1", REGIONS = process.env.REGIONS === "1";
const nearATestCv = (text: string) => { const s = shingles(text); if (!s.size) return false; return protectedShingles.some((p) => { let n = 0; for (const x of s) if (p.has(x)) n++; return n / s.size >= 0.5; }); };

type Lines = Map<number, string>;
const findLine = (lines: Lines, value: string, near?: number, reach = 4): number | undefined => {
  const v = norm(value); if (!v) return undefined;
  const hits = [...lines].filter(([, l]) => ` ${norm(l)} `.includes(` ${v} `)).map(([n]) => n);
  if (near === undefined) return hits[0];
  return hits.filter((n) => Math.abs(n - near) <= reach).sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0];
};
function printedDates(lines: Lines, around: number[], start: string, end: string): { start: string; end: string; line: number } | null {
  const sy = yearOf(start), ey = yearOf(end), open = !ey || /present|current/i.test(end);
  const from = Math.min(...around) - 3, to = Math.max(...around) + 3;
  for (let n = from; n <= to; n++) {
    const l = lines.get(n); if (!l) continue;
    const toks = [...l.matchAll(DATE_TOKEN)].map((m) => m[1].trim());
    const i = toks.findIndex((t) => yearOf(t) === sy); if (i < 0) continue;
    const next = toks[i + 1]; if (!next) continue;
    if (open ? /present|current|now|to date/i.test(next) : yearOf(next) === ey) return { start: toks[i], end: next, line: n };
  }
  return null;
}

function answerFrom(key: any, lines: Lines, text: string): any | string {
  const roles: any[] = [], used = new Set<number>();
  for (const r of key.work_history ?? []) {
    const title = r.title ?? r.role, employer = r.employer ?? r.company;
    // A title also appears in the headline and the summary: the job is the place where title, employer and the job's own dates sit together.
    const titleHits = [...lines].filter(([, l]) => ` ${norm(l)} `.includes(` ${norm(title)} `)).map(([n]) => n);
    if (!titleHits.length) return "a job title is not on its own line";
    // Of the places that qualify, the one where the title stands alone and sits closest to its employer (a page header "Name | Title" also qualifies, wrongly).
    const options: { t: number; e: number; d: NonNullable<ReturnType<typeof printedDates>>; rank: number }[] = [];
    for (const t of titleHits) {
      if (used.has(t)) continue;
      const e = findLine(lines, employer, t); if (e === undefined) continue;
      const d = printedDates(lines, [t, e], r.start, r.end);
      if (d) options.push({ t, e, d, rank: Math.abs(t - e) + (norm(lines.get(t)) === norm(title) ? 0 : 10) });
    }
    const found = options.sort((a, b) => a.rank - b.rank)[0];
    if (!found) return "a job's title, employer and dates were not found together";
    used.add(found.t);
    roles.push({ title, employer, start: found.d.start, end: found.d.end, lines: [...new Set([found.t, found.e, found.d.line])].sort((a, b) => a - b), _y: yearOf(r.start) });
  }
  roles.sort((a, b) => Number(b._y) - Number(a._y)); roles.forEach((r) => delete r._y);
  const education: any[] = [];
  for (const q of key.education ?? []) {
    const qHits = [...lines].filter(([, l]) => ` ${norm(l)} `.includes(` ${norm(q.qualification)} `)).map(([n]) => n);
    if (!qHits.length) return "a qualification is not on its own line";
    const pair = qHits.map((n) => ({ ql: n, il: q.institution ? findLine(lines, q.institution, n) : undefined })).find((p) => !q.institution || p.il !== undefined);
    if (!pair) return "an institution is not near its qualification";
    const { ql, il } = pair;
    const yl = q.year ? [ql, il ?? ql].map((n) => [n - 1, n, n + 1]).flat().find((n) => (lines.get(n) ?? "").includes(String(q.year))) : undefined;
    education.push({ qualification: q.qualification, institution: q.institution ?? "", year: yl !== undefined ? String(q.year) : "", lines: [...new Set([ql, il, yl].filter((n): n is number => n !== undefined))].sort((a, b) => a - b) });
  }
  const printed = (v: unknown) => typeof v === "string" && findLine(lines, v) !== undefined;
  const names = (xs: any[]) => (xs ?? []).map((x) => (typeof x === "string" ? x : x?.name)).filter(printed);
  const agency = key.agencyAdded ?? (key.agency && typeof key.agency === "object" ? key.agency : {});
  return {
    headline: printed(key.title) ? key.title : "",
    roles, education,
    certifications: names(key.certifications),
    skills: names(key.skills),
    languages: names(key.languages),
    location: printed(key.location) ? key.location : "",
    agency: { name: agency.name ?? "", recruiter: agency.recruiter ?? agency.consultant ?? "", recruiterEmail: agency.email ?? agency.recruiterEmail ?? "", recruiterPhone: agency.phone ?? agency.recruiterPhone ?? "" },
  };
}

// Step 5 (lora3): an invented recruitment agency presenting half the CVs, written into the text the way agency CVs carry it, so the label is true because we
// wrote it. Nothing here is taken from the real CVs; every invented name, e-mail and phone is checked absent from them (the run stops if one is not).
const pick = <T>(xs: T[], seed: string, k: string) => xs[parseInt(createHash("sha256").update(`${seed}|${k}`).digest("hex").slice(0, 8), 16) % xs.length];
const digits = (seed: string, k: string, n: number) => [...createHash("sha256").update(`${seed}|${k}`).digest("hex")].filter((c) => /\d/.test(c)).join("").padEnd(n, "7").slice(0, n);
const AGENCY_A = ["Brightpath", "Keystone", "Meridian", "Northgate", "Silverleaf", "Bluecrest", "Ironwood", "Clearwater", "Summit Ridge", "Oakhaven", "Highveld Arc", "Copperline", "Amberfield", "Westbrook", "Lionsgate Peak", "Riverstone"];
const AGENCY_B = ["Recruitment", "Staffing Solutions", "Personnel", "Search Partners", "Talent Group", "Executive Search", "Recruitment Specialists", "People Solutions"];
const FIRST = ["Thandeka", "Lerato", "Sipho", "Megan", "Pieter", "Ayesha", "Kagiso", "Nadia", "Johan", "Zanele", "Ruan", "Priya", "Bongani", "Chloe", "Tumelo", "Fatima"];
const LAST = ["Mokoena", "van der Berg", "Naidoo", "Botha", "Dlamini", "Pillay", "Fletcher", "Nkosi", "Jacobs", "Khumalo", "Petersen", "Govender", "Mahlangu", "Steyn", "Ndlovu", "Adams"];
const TITLES = ["CANDIDATE PRESENTATION", "Candidate Profile", "CONFIDENTIAL CANDIDATE SUMMARY", "Curriculum Vitae presented by"];
function addAgency(text: string, seed: string): { text: string; agency: { name: string; recruiter: string; email: string; phone: string } } {
  const name = `${pick(AGENCY_A, seed, "a")} ${pick(AGENCY_B, seed, "b")}`, domain = `${name.split(" ")[0].toLowerCase()}${pick(["", "-recruit", "talent", "-search"], seed, "d")}.co.za`;
  const first = pick(FIRST, seed, "f"), last = pick(LAST, seed, "l"), d = digits(seed, "p", 9);
  const phone = pick([`+27 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 9)}`, `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 9)}`, `(0${d.slice(0, 2)}) ${d.slice(2, 5)} ${d.slice(5, 9)}`, `08${d.slice(0, 1)} ${d.slice(1, 4)} ${d.slice(4, 8)}`], seed, "pf");
  const email = `${first.toLowerCase()}.${last.toLowerCase().replace(/ /g, "")}@${domain}`;
  const withPerson = pick([true, true, true, true, false], seed, "who"), hasPhone = pick([true, true, true, false], seed, "hp"), hasEmail = pick([true, true, true, false], seed, "he");
  const agency = { name, recruiter: withPerson ? `${first} ${last}` : "", email: withPerson && hasEmail ? email : "", phone: withPerson && hasPhone ? phone : "" };
  const contact = [agency.phone && `Tel: ${agency.phone}`, agency.email && `E-mail: ${agency.email}`].filter(Boolean) as string[];
  const cover = [pick(TITLES, seed, "t"), `Presented by ${name}`, ...(withPerson ? [`Consultant: ${agency.recruiter}`] : []), ...contact, `Ref: ${name.slice(0, 2).toUpperCase()}-${digits(seed, "r", 5)}`];
  const header = [`${name} | ${pick(["Specialist Recruitment", "Finding the right people", "Permanent and Contract Placements", "Executive and Professional Search"], seed, "tag")}`, ...(withPerson ? [[agency.recruiter, agency.phone, agency.email].filter(Boolean).join(" | ")] : [])];
  const closing = ["For more information about this candidate, please contact:", ...(withPerson ? [agency.recruiter] : []), name, ...contact.map((c) => c.replace(/^(Tel|E-mail): /, ""))];
  const lines = text.split("\n"), style = pick(["cover", "header", "closing", "cover+closing", "header+closing"], seed, "style");
  let out = [...lines];
  if (style.includes("header")) { out = []; lines.forEach((l, i) => { if (i % 55 === 0) out.push(...header); out.push(l); }); }
  if (style.includes("cover")) out = [...cover, ...out];
  if (style.includes("closing")) out = [...out, ...closing];
  return { text: out.join("\n"), agency };
}
const shownNumbers = (part: string) => new Set(part.split("\n").map((l) => Number((l.match(/^\[(\d+)\]/) ?? [])[1])).filter(Boolean));
/** What one section of a long CV shows whole, as the answer for that section; null when a job or qualification is cut in two by it. */
function sectionAnswer(answer: any, shown: Set<number>, byNumber: Lines) {
  const inside = (ls: number[]) => ls.every((n) => shown.has(n)), touches = (ls: number[]) => ls.some((n) => shown.has(n));
  if ([...answer.roles, ...answer.education].some((x: any) => touches(x.lines) && !inside(x.lines))) return null;
  const here: Lines = new Map([...byNumber].filter(([n]) => shown.has(n))), on = (v: string) => !!v && findLine(here, v) !== undefined;
  const a = answer.agency, agencyHere = on(a.name);
  if (!agencyHere && [a.recruiter, a.recruiterEmail, a.recruiterPhone].some(on)) return null;   // the consultant without the agency's name: no clean answer
  return { headline: on(answer.headline) ? answer.headline : "", roles: answer.roles.filter((r: any) => inside(r.lines)), education: answer.education.filter((e: any) => inside(e.lines)),
    certifications: answer.certifications.filter(on), skills: answer.skills.filter(on), languages: answer.languages.filter(on), location: on(answer.location) ? answer.location : "",
    agency: agencyHere ? { name: a.name, recruiter: on(a.recruiter) ? a.recruiter : "", recruiterEmail: on(a.recruiterEmail) ? a.recruiterEmail : "", recruiterPhone: on(a.recruiterPhone) ? a.recruiterPhone : "" } : { name: "", recruiter: "", recruiterEmail: "", recruiterPhone: "" } };
}

const counts: Record<string, number> = {}, bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
const out: Record<"train" | "valid", string[]> = { train: [], valid: [] };
for (const pack of PACKS) for (const format of FORMATS) {
  const dir = join(DL, pack, format); if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => /\.(pdf|docx)$/i.test(x)).sort()) {
    const id = f.replace(/\.\w+$/, ""), keyFile = join(DL, pack, "Reference", "Expected_CVs", `${id}.json`);
    if (!existsSync(keyFile)) { bump("no key"); continue; }
    const bytes = new Uint8Array(readFileSync(join(dir, f))), type = sniff(bytes);
    if (!type) { bump("unknown type"); continue; }
    let text: string;
    try { text = (await readDocument(bytes, type, {})).text; } catch { bump("unreadable"); continue; }
    if (nearATestCv(text)) { bump("near a protected real CV"); continue; }
    const key = JSON.parse(readFileSync(keyFile, "utf8")), seed = `agency|${pack}/${id}`;
    const hasOwnAgency = !!(key.agency && typeof key.agency === "object" && key.agency.name);
    if (AGENCIES && !hasOwnAgency && parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) % 2 === 0) {
      const added = addAgency(text, seed);
      const invented = [added.agency.name, added.agency.recruiter, added.agency.email, added.agency.phone].filter(Boolean);
      const leak = invented.find((v) => protectedTexts.some((t) => ` ${t} `.includes(` ${norm(v)} `)));
      if (leak) bump("agency not added: an invented value occurs in a protected real CV");
      else { text = added.text; key.agencyAdded = added.agency; bump(`agency added (${pack.includes("300") ? "long-form" : "other"})`); }
    }
    const { parts, byNumber } = readerInput(text);
    if (parts.length !== 1 && !SECTIONS) { bump("needs sections (left for later)"); continue; }
    const answer = answerFrom(key, byNumber, text);
    if (typeof answer === "string") { bump(`dropped: ${answer}`); continue; }
    // The code checks live applies must keep the answer exactly as built; anything they would drop or alter means the key and the document disagree.
    const checked = validateReading(answer, text, byNumber) as any;
    if (checked.roles.length !== answer.roles.length || checked.education.length !== answer.education.length) { bump("dropped: live's checks disagree with the key"); continue; }
    if (JSON.stringify(checked.agency) !== JSON.stringify(answer.agency)) { bump("dropped: live's checks change the agency"); continue; }
    const split = parseInt(createHash("sha256").update(`${pack}/${id}`).digest("hex").slice(0, 8), 16) % 10 === 0 ? "valid" : "train";
    const ask = (user: string, a: unknown) => JSON.stringify({ messages: [{ role: "system", content: READER_SYSTEM }, { role: "user", content: user }, { role: "assistant", content: JSON.stringify(a) }] });
    if (parts.length === 1) {
      out[split].push(ask(`THE CV, numbered lines:\n${parts[0]}`, answer)); bump(`kept (${split})`);
      // As live asks again about a job the first reading could not place (hybridReader.ts): one job's title and employer lines marked, the rows
      // around them shown, the answer being the jobs that part shows whole. 16 of the 30 real CVs get such questions; lora2 never practised one.
      if (REGIONS && answer.roles.length) {
        const role = pick(answer.roles as any[], seed, "region"), [g] = regionsOf(role.lines.slice(0, 2), byNumber);
        const shown = new Set(Array.from({ length: g.to - g.from + 1 }, (_, k) => g.from + k));
        const part = sectionAnswer(answer, shown, byNumber);
        if (!part) { bump("region skipped: it cuts a job or qualification in two"); continue; }
        const a = { ...part, headline: "", certifications: [], skills: [], languages: [], location: "" };   // the jobs, and education or an agency only where the part shows them
        out[split].push(JSON.stringify({ messages: [{ role: "system", content: REGION_SYSTEM }, { role: "user", content: regionInput(byNumber, g.from, g.to, g.about) }, { role: "assistant", content: JSON.stringify(a) }] })); bump(`kept region (${split})`);
      }
      continue;
    }
    // As live asks a long CV (hybridReader.ts): each section on its own, the answer being what that section shows whole.
    for (const part of parts) {
      const a = sectionAnswer(answer, shownNumbers(part), byNumber);
      if (!a) { bump("section skipped: it cuts a job or qualification in two"); continue; }
      out[split].push(ask(`THE CV (one section of a long document), numbered lines:\n${part}`, a)); bump(`kept section (${split})`);
    }
  }
}
mkdirSync(OUT, { recursive: true, mode: 0o700 });
for (const s of ["train", "valid"] as const) writeFileSync(join(OUT, `${s}.jsonl`), out[s].join("\n") + "\n", { mode: 0o600 });
console.log(JSON.stringify(counts, null, 1));
