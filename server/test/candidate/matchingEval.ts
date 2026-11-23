// Does matching hold up, measured on the invented pack's 60 candidate and job pairs (20 same role, 20 adjacent, 20 out of domain)? Those relationships are test relationships and not hiring decisions or validated scores, so what can be measured is:
// whether a same-role pair is ranked above an adjacent one and an adjacent above an unrelated one, and how far a score moves when it runs on what was read rather than on the checked record.
// Usage: node --import tsx test/candidate/matchingEval.ts <pack> <batch> <run> [<run> ...]   "verified" is always included: the pack's own checked records.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assess } from "../../src/match";
import { ruleset } from "../../src/ruleset";

const [pack, batch, ...runs] = process.argv.slice(2), EVAL = join(import.meta.dirname, "..", "..", "data", "evaluations", batch);
const pairs = JSON.parse(readFileSync(join(pack, "Reference", "pairing_guide.json"), "utf8")) as { candidate_id: string; job_id: string; intended_relationship: string }[];
const AS_OF = new Date("2026-10-28T00:00:00Z"), load = (d: string, id: string) => JSON.parse(readFileSync(join(pack, "Reference", d, `${id}.json`), "utf8"));
const job = (id: string): any => { const e = load("Expected_Jobs", id), s = e.source_sections ?? {}; return { id, title: e.title, company: e.employer, location: e.location ?? "", skills: e.skills ?? [], type: "", department: "", description: "", requirements: s["Essential requirements"] ?? [], preferredRequirements: s["Desirable experience"] ?? [], responsibilities: s["Responsibilities"] ?? [], postedDate: "", extractionConfidence: 0.6 }; };
const verified = (id: string): { c: any; text: string } => { const e = load("Expected_CVs", id); return { text: e.canonical_text, c: { id, name: e.name, role: e.title, status: "new", avatar: "", skills: e.skills, rating: 0, experience: "", location: e.location, email: e.email, phone: e.phone, appliedDate: "", workHistory: e.work_history.map((w: any) => ({ company: w.employer, position: w.title, startDate: w.start, endDate: w.end ?? "Present", responsibilities: w.bullets })), summary: e.summary, education: [...e.education.map((q: any) => ({ degree: q.qualification, institution: q.institution, year: String(q.year), type: /diploma/i.test(q.qualification) ? "diploma" : "degree", level: "", status: /progress/i.test(q.status) ? "in_progress" : /not/i.test(q.status) ? "not_completed" : "completed", statusEvidence: "" })), ...e.certifications.map((q: any) => ({ degree: q.name, institution: q.issuer, year: String(q.year), type: "certificate", level: "", status: /progress/i.test(q.status) ? "in_progress" : /not/i.test(q.status) ? "not_completed" : "completed", statusEvidence: "" }))], languages: e.languages, extractionConfidence: 0.6 } }; };
const read = (run: string, dir: string, ext: string, id: string): { c: any; text: string } | null => { const f = join(EVAL, run, "docs", `${dir}__${id}.${ext}.json`); if (!existsSync(f)) return null; const d = JSON.parse(readFileSync(f, "utf8")); return d.ok ? { c: { id, status: "new", avatar: "", rating: 0, appliedDate: "", ...d.record, extractionConfidence: d.confidence }, text: d.text } : null; };
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
/** How often a pair of the first kind scores above one of the second (a tie counts half): 1 is perfect, 0.5 is no better than chance. */
const ranks = (a: number[], b: number[]) => { let w = 0; for (const x of a) for (const y of b) w += x > y ? 1 : x === y ? 0.5 : 0; return a.length && b.length ? w / (a.length * b.length) : NaN; };
const KINDS = ["same_base_role", "adjacent_occupation", "out_of_domain"], base = new Map<string, number>();
const report = (name: string, get: (id: string) => { c: any; text: string } | null) => {
  const by: Record<string, number[]> = {}, moved: number[] = [], states: Record<string, number> = {}; let missing = 0;
  for (const p of pairs) { const r = get(p.candidate_id); if (!r) { missing++; continue; } const m: any = assess(r.c, job(p.job_id), r.text, AS_OF); (by[p.intended_relationship] ??= []).push(m.score); for (const e of m.evidence) states[e.state] = (states[e.state] ?? 0) + 1; const key = `${p.candidate_id}|${p.job_id}`; if (name === "verified") base.set(key, m.score); else if (base.has(key)) moved.push(Math.abs(m.score - base.get(key)!)); }
  const [s, a, o] = KINDS.map((k) => by[k] ?? []);
  console.log(`${name.padEnd(22)} median score same ${median(s)} adjacent ${median(a)} unrelated ${median(o)} | same above adjacent ${ranks(s, a).toFixed(2)}, same above unrelated ${ranks(s, o).toFixed(2)}, adjacent above unrelated ${ranks(a, o).toFixed(2)} | moved from verified: median ${moved.length ? median(moved) : "-"}, largest ${moved.length ? Math.max(...moved) : "-"} | unread ${missing} | ${JSON.stringify(states)}`);
};
console.log(`rules ${ruleset.version}, ${pairs.length} pairs. These relationships are for testing; they are not hiring decisions or validated scores.`);
report("verified", verified);
for (const run of runs) for (const [dir, ext] of [["01_Word", "docx"], ["02_Searchable_PDF", "pdf"], ["03_Scanned_PDF", "pdf"], ["04_Phone_Photo_PDF", "pdf"]]) { const anyRow = pairs.some((p) => read(run, dir, ext, p.candidate_id)); if (anyRow) report(`${run} ${dir.slice(3, 12)}`, (id) => read(run, dir, ext, id)); }
process.exit(0);
