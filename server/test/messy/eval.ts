// Scores the parser against the answer keys. Usage: node --import tsx test/messy/eval.ts [--details layout__persona] [--worst N]
import { CORPUS_AS_OF } from "./panels";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toMonth } from "../../src/dates";
import { readText } from "../../src/parse";
import { prepareDocument } from "../../src/prepare";
import { parseCv } from "../../src/rules";
import { defaultSettings } from "../../src/settings";
import { findSkills } from "../../src/skills";
import { build, FILES } from "./build";
import { PERSONAS_R4 } from "./personas4";
import { PERSONAS, type Persona } from "./personas";
import { LAYOUTS_R2 } from "./templates2";
import { LAYOUTS_R3 } from "./templates3";
const R2 = new Set(LAYOUTS_R2.map((l) => l.id));
const R3 = new Set(LAYOUTS_R3.map((l) => l.id));
const R4P = new Set(PERSONAS_R4.map((p) => p.id));
const NO_DATES = new Set(["nodates"]); // these layouts carry no dates, so only the job title is checked

const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");
// The corpus is read as of one fixed upload date (panels.ts), never today's clock: "Present" or "Hede" resolves to that date's year.
const REF_YEAR = CORPUS_AS_OF.getUTCFullYear();
const yearOf = (s: string): number | null => {
  const m = toMonth(s, CORPUS_AS_OF);
  if (m !== null) return Math.floor(m / 12);
  const y = s.match(/\b(19|20)\d{2}\b/);
  return y ? Number(y[0]) : null;
};

export interface Score {
  file: string; layout: string; persona: string; format: "pdf" | "docx";
  name: boolean; email: boolean; phone: boolean; location: boolean;
  rolesExpected: number; rolesFound: number; rolesMatched: number; datesOk: number; companiesOk: number;
  skillsExpected: number; skillsFound: number; junkSkills: string[];
  eduExpected: number; eduFound: number; institutionsOk: number;
  leaks: string[]; perfect: boolean; reasons: string[]; parsed: ReturnType<typeof parseCv>;
}

export function score(file: string, layout: string, p: Persona, format: "pdf" | "docx", parsed: ReturnType<typeof parseCv>): Score {
  const matched: { exp: Persona["roles"][number]; got: (typeof parsed.workHistory)[number] }[] = [];
  const used = new Set<number>();
  for (const exp of p.roles) {
    const i = parsed.workHistory.findIndex((r, idx) => !used.has(idx) && (NO_DATES.has(layout) || yearOf(r.startDate) === exp.start[0]) && (n(r.position).includes(n(exp.position)) || n(exp.position).includes(n(r.position))) && n(r.position) !== "");
    if (i >= 0) { used.add(i); matched.push({ exp, got: parsed.workHistory[i] }); }
  }
  const datesOk = matched.filter(({ exp, got }) => NO_DATES.has(layout) || yearOf(got.endDate) === (exp.end ? exp.end[0] : REF_YEAR) || (!exp.end && /present|current|now|date|hede|tans/i.test(got.endDate))).length;
  const companiesOk = matched.filter(({ exp, got }) => (exp.company === "" ? true : n(got.company).includes(n(exp.company)))).length;
  const parsedSkills = parsed.skills.map((s) => n(s.name));
  const skillsFound = p.skills.filter((s) => parsedSkills.includes(n(s))).length;
  const taxonomy = new Set(findSkills(p.skills.join(" ") + " " + p.roles.flatMap((r) => r.bullets).join(" ")).map((s) => n(s.name)));
  const junk = parsed.skills.map((s) => s.name).filter((s) => !p.skills.map(n).includes(n(s)) && !taxonomy.has(n(s)));
  const eduFound = p.education.filter((e) => parsed.education.some((x) => n(x.qualification).includes(n(e.degree)) || n(e.degree).includes(n(x.qualification)) && n(x.qualification) !== "")).length;
  const institutionsOk = p.education.filter((e) => parsed.education.some((x) => n(x.institution).includes(n(e.institution)))).length;
  const blob = JSON.stringify(parsed);
  const leaks = Object.entries(p.sensitive).filter(([, v]) => blob.includes(v) || (v.length > 6 && digits(blob).includes(digits(v)) && /^\d+$/.test(v))).map(([k]) => k);
  // A missing optional "persona has no company" is fine; phone compares digits only.
  const s: Score = {
    file, layout, persona: p.id, format,
    name: n(parsed.fullName) === n(p.name), email: parsed.email.toLowerCase() === p.email, phone: digits(parsed.phone) === digits(p.phone),
    location: n(parsed.location).includes(n(p.city)),
    rolesExpected: p.roles.length, rolesFound: parsed.workHistory.length, rolesMatched: matched.length, datesOk, companiesOk,
    skillsExpected: p.skills.length, skillsFound, junkSkills: junk,
    eduExpected: p.education.length, eduFound, institutionsOk, leaks, perfect: false, reasons: [], parsed,
  };
  const r = s.reasons;
  if (!s.name) r.push(`name "${parsed.fullName}"`);
  if (!s.email) r.push("email");
  if (!s.phone) r.push(`phone "${parsed.phone}"`);
  if (!s.location) r.push(`location "${parsed.location}"`);
  if (s.rolesMatched < s.rolesExpected) r.push(`roles ${s.rolesMatched}/${s.rolesExpected}`);
  if (s.rolesFound > s.rolesExpected) r.push(`extra roles ${s.rolesFound - s.rolesExpected}`);
  if (s.datesOk < s.rolesExpected) r.push(`dates ${s.datesOk}/${s.rolesExpected}`);
  if (s.companiesOk < s.rolesExpected) r.push(`companies ${s.companiesOk}/${s.rolesExpected}`);
  if (s.skillsFound < s.skillsExpected) r.push(`skills missing: ${p.skills.filter((x) => !parsedSkills.includes(n(x))).join("|")}`);
  if (junk.length) r.push(`junk skills: ${junk.join("|")}`);
  if (s.eduFound < s.eduExpected) r.push(`education ${s.eduFound}/${s.eduExpected}`);
  if (s.institutionsOk < s.eduExpected) r.push(`institution ${s.institutionsOk}/${s.eduExpected}`);
  if (leaks.length) r.push(`LEAK ${leaks.join(",")}`);
  s.perfect = s.name && s.email && s.phone && s.location && s.rolesMatched === s.rolesExpected && s.rolesFound === s.rolesExpected && s.datesOk === s.rolesExpected
    && s.companiesOk === s.rolesExpected && s.skillsFound >= s.skillsExpected && s.junkSkills.length === 0 && s.eduFound === s.eduExpected && s.institutionsOk === s.eduExpected && leaks.length === 0;
  return s;
}

/** Every corpus file with its extracted text, so other benchmarks can reuse the same documents. */
export async function loadCorpus() {
  await build(false);
  const out: { file: string; layout: string; persona: Persona; format: "pdf" | "docx"; text: string }[] = [];
  for (const format of ["pdf", "docx"] as const) {
    for (const f of readdirSync(join(FILES, format)).sort()) {
      const [layout, pid] = f.replace(/\.\w+$/, "").split("__");
      const persona = [...PERSONAS, ...PERSONAS_R4].find((x) => x.id === pid)!;
      out.push({ file: `${format}/${f}`, layout, persona, format, text: await readText(new Uint8Array(readFileSync(join(FILES, format, f))), format) });
    }
  }
  return out;
}

export async function evaluate(): Promise<Score[]> {
  await build(false);
  const out: Score[] = [];
  for (const format of ["pdf", "docx"] as const) {
    for (const f of readdirSync(join(FILES, format)).sort()) {
      const [layout, pid] = f.replace(/\.\w+$/, "").split("__");
      const p = [...PERSONAS, ...PERSONAS_R4].find((x) => x.id === pid)!;
      // As the service reads it: the name and contact details come from the identity reader, the rest from the text the document model laid out.
      const prepared: any = await prepareDocument(new Uint8Array(readFileSync(join(FILES, format, f))), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-05T00:00:00Z") });
      const r = prepared.record ?? {};
      out.push(score(`${format}/${f}`, layout, p, format, { ...parseCv(""), fullName: r.name ?? "", email: r.email ?? "", phone: r.phone ?? "", location: r.location ?? "", workHistory: r.workHistory ?? [], skills: (r.skills ?? []).map((name: string) => ({ name, quote: name })), education: (r.education ?? []).map((e: any) => ({ qualification: e.degree, institution: e.institution, period: e.year, quote: "" })), summary: r.summary ?? "" } as any));
    }
  }
  return out;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
export function summarise(rows: Score[]) {
  const sum = (f: (r: Score) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    files: rows.length, perfect: pct(rows.filter((r) => r.perfect).length, rows.length),
    name: pct(rows.filter((r) => r.name).length, rows.length), email: pct(rows.filter((r) => r.email).length, rows.length),
    phone: pct(rows.filter((r) => r.phone).length, rows.length), location: pct(rows.filter((r) => r.location).length, rows.length),
    roleRecall: pct(sum((r) => r.rolesMatched), sum((r) => r.rolesExpected)), rolePrecision: pct(sum((r) => r.rolesMatched), sum((r) => r.rolesFound)),
    dates: pct(sum((r) => r.datesOk), sum((r) => r.rolesExpected)), company: pct(sum((r) => r.companiesOk), sum((r) => r.rolesExpected)),
    skills: pct(sum((r) => r.skillsFound), sum((r) => r.skillsExpected)), junkPerCv: Math.round((sum((r) => r.junkSkills.length) / rows.length) * 10) / 10,
    education: pct(sum((r) => r.eduFound), sum((r) => r.eduExpected)), institution: pct(sum((r) => r.institutionsOk), sum((r) => r.eduExpected)),
    leaks: sum((r) => r.leaks.length),
  };
}

if (import.meta.main) {
  const rows = await evaluate();
  const all = summarise(rows);
  console.log("\nOVERALL", JSON.stringify(all));
  console.log("ROUND 1 (tuned on)", JSON.stringify(summarise(rows.filter((r) => !R4P.has(r.persona) && !R2.has(r.layout) && !R3.has(r.layout)))));
  console.log("ROUND 2 (tuned on after seeing)", JSON.stringify(summarise(rows.filter((r) => !R4P.has(r.persona) && R2.has(r.layout)))));
  console.log("ROUND 3 (tuned on after seeing)", JSON.stringify(summarise(rows.filter((r) => !R4P.has(r.persona) && R3.has(r.layout)))));
  console.log("ROUND 4 (fresh: other occupations)", JSON.stringify(summarise(rows.filter((r) => R4P.has(r.persona)))));
  const layouts = [...new Set(rows.map((r) => r.layout))];
  const cols = ["perfect", "name", "email", "phone", "location", "roleRecall", "rolePrecision", "dates", "company", "skills", "junkPerCv", "education", "institution", "leaks"] as const;
  console.log("\n" + "layout".padEnd(12) + "fmt  " + cols.map((c) => c.slice(0, 7).padStart(8)).join(""));
  for (const l of layouts) for (const fmt of ["pdf", "docx"] as const) {
    const r = rows.filter((x) => x.layout === l && x.format === fmt);
    if (!r.length) continue;
    const s = summarise(r);
    console.log(l.padEnd(12) + fmt.padEnd(5) + cols.map((c) => String(s[c]).padStart(8)).join(""));
  }
  writeFileSync(fileURLToPath(new URL("./report.json", import.meta.url)), JSON.stringify({ summary: all, rows: rows.map(({ parsed, ...r }) => r) }, null, 1));
  if (process.argv.includes("--failures")) {
    console.log("\nNON-PERFECT FILES");
    for (const r of rows.filter((x) => !x.perfect)) console.log(`  ${r.file.padEnd(34)} ${r.reasons.join(" ; ")}`);
  }
  const detailArg = process.argv.indexOf("--details");
  if (detailArg > 0) {
    const key = process.argv[detailArg + 1];
    for (const r of rows.filter((x) => x.file.includes(key))) console.log("\n=====", r.file, "\n", JSON.stringify({ name: r.parsed.fullName, email: r.parsed.email, phone: r.parsed.phone, location: r.parsed.location, role: r.parsed.currentRole, skills: r.parsed.skills.map((s) => s.name), work: r.parsed.workHistory.map((w) => [w.position, w.company, w.startDate, w.endDate, w.responsibilities.length]), edu: r.parsed.education.map((e) => [e.qualification, e.institution, e.period]), certs: r.parsed.certifications, langs: r.parsed.languages, summary: r.parsed.summary.slice(0, 80) }));
  }
}
