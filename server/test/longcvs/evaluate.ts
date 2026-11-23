// How good is the matchmaker, measured end to end on the application's own document path: what was read from each CV and job against its answer key, what each match concluded about each requirement against what the CV truly shows, whether the right people rank first in both directions, and whether the reasoning given for every single match stands up.
//   node --import tsx test/longcvs/evaluate.ts <cv folder> <job folder> <reference folder> <run name> [--limit N] [--jobs-limit N]
// Invented documents only: nothing about real people is ever written by this script.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assess } from "../../src/match";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";
import { parserVersionLabel } from "../../src/version";

const [cvDir, jobDir, refDir, run] = process.argv.slice(2), arg = (n: string) => { const i = process.argv.indexOf("--" + n); return i < 0 ? undefined : process.argv[i + 1]; };
const LIMIT = Number(arg("limit") ?? Infinity), JOBS_LIMIT = Number(arg("jobs-limit") ?? Infinity), asOf = new Date("2026-11-05T00:00:00Z"), org = defaultSettings();
process.env.CANDIDATE_PIPELINE ??= "all";
const OUT = join(import.meta.dirname, "..", "..", "data", "evaluations", "long", run); mkdirSync(OUT, { recursive: true });
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+#]+/g, " ").trim(), digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^27/, "0");
const has = (hay: string, needle: string) => !!needle && norm(hay).includes(norm(needle));
const key = (kind: string, id: string) => { const f = join(refDir, kind, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");

class Tally { hit = 0; of = 0; add(ok: boolean) { this.of++; if (ok) this.hit++; } get text() { return `${pct(this.hit, this.of)} (${this.hit}/${this.of})`; } }
const fields: Record<string, Tally> = {}, byLayout: Record<string, Tally> = {}, byFormat: Record<string, Tally> = {}, failures: any[] = [];
const T = (k: string) => (fields[k] ??= new Tally());
// Correct, wrong and missing are different problems and are never added together: a wrong value misleads, a missing one only leaves a gap.
const three: Record<string, { correct: number; wrong: number; missing: number }> = {};
const said = (field: string, got: unknown, right: boolean) => { const t = (three[field] ??= { correct: 0, wrong: 0, missing: 0 }); if (right) t.correct++; else if (got === undefined || got === null || String(got).trim() === "") t.missing++; else t.wrong++; };
const score = (id: string, field: string, ok: boolean, detail?: unknown) => { T(field).add(ok); if (!ok) failures.push({ id, field, detail }); };

// ---------------------------------------------------------------- reading CVs
const files = readdirSync(cvDir).filter((f) => /^CV\d+\.(docx|pdf)$/.test(f) && !f.startsWith("._")).sort().slice(0, LIMIT);
const read = new Map<string, { c: any; text: string; e: any; format: string; ms: number }>();
const times: number[] = [];
for (const f of files) {
  const id = f.split(".")[0], e = key("Expected_CVs", id), format = f.split(".")[1], t0 = performance.now();
  if (!e) continue;
  let out: any; try { out = await prepareDocument(new Uint8Array(readFileSync(join(cvDir, f))), { kind: "cv", org, asOf }); } catch (err) { out = { ok: false, code: "CRASH", message: String((err as Error).message).slice(0, 120) }; }
  const ms = performance.now() - t0; times.push(ms);
  score(id, "document read", !!out.ok, out.ok ? undefined : `${out.code}: ${out.message}`);
  if (!out.ok) continue;
  const r = out.record, text = String(out.text ?? "");
  let good = 0, all = 0; const check = (field: string, ok: boolean, detail?: unknown) => { score(id, field, ok, detail); all++; if (ok) good++; };
  check("name", norm(r.name) === norm(e.name), { got: r.name });
  check("email", norm(r.email) === norm(e.email), { got: r.email, want: e.email });
  check("phone", digits(r.phone) === digits(e.phone), { got: r.phone, want: e.phone });
  check("location", has(r.location, e.location) || has(e.location, r.location ?? "\0"), { got: r.location, want: e.location });
  said("name", r.name, norm(r.name) === norm(e.name)); if (e.email) said("email", r.email, norm(r.email) === norm(e.email)); if (e.phone) said("phone", r.phone, digits(r.phone) === digits(e.phone)); said("location", r.location, has(r.location, e.location) || has(e.location, r.location ?? "\0"));
  // Someone else's contact details taken as the candidate's: referees and the agency are in these documents on purpose.
  const others = [...(e.references ?? []), ...(e.agency ? [e.agency] : [])];
  check("not someone else's email", !others.some((o: any) => norm(o.email) === norm(r.email)), { got: r.email });
  check("not someone else's phone", !others.some((o: any) => digits(o.phone) === digits(r.phone)), { got: r.phone });
  check("name is not a referee or agency", !others.some((o: any) => norm(o.name ?? o.recruiter) === norm(r.name)), { got: r.name });
  if (e.agency) { const sub = r.submission ?? {}; check("agency recognised", JSON.stringify(sub).toLowerCase().includes(norm(e.agency.name).split(" ")[0]), { sub }); }
  // Career: every role, with its employer, title and dates, and nothing invented.
  const work: any[] = r.workHistory ?? [];
  for (const k of e.work_history ?? []) {
    const m = work.find((w) => has(w.company, k.employer) && has(w.position, k.title)) ?? work.find((w) => has(w.company, k.employer) || has(`${w.position} ${w.company}`, k.employer));
    if (m) check("role employer in its own field", has(m.company, k.employer), { got: m.company, want: k.employer });
    check("role found", !!m, { want: `${k.title} @ ${k.employer}` });
    said("role: employer", m?.company, !!m && has(m.company, k.employer)); said("role: title", m?.position, !!m && has(m.position, k.title)); said("role: start year", m?.startDate, !!m && String(m.startDate ?? "").includes(String(k.start).slice(0, 4)));
    if (m) {
      check("role title", has(m.position, k.title) || has(k.title, m.position ?? "\0"), { got: m.position, want: k.title });
      const y = String(m.startDate ?? "").match(/(19|20)\d{2}/)?.[0];
      check("role start year", y === String(k.start).slice(0, 4), { got: m.startDate, want: k.start });
      const present = /present|current|now|date|ongoing/i.test(String(m.endDate ?? "")) || !m.endDate;
      check("role end", k.end ? String(m.endDate ?? "").includes(String(k.end).slice(0, 4)) : present, { got: m.endDate, want: k.end });
    }
  }
  const extra = work.filter((w) => !(e.work_history ?? []).some((k: any) => has(w.company, k.employer) || has(`${w.position} ${w.company}`, k.employer)));
  check("no invented roles", extra.length === 0, { extra: extra.slice(0, 4).map((w) => `${w.position} @ ${w.company}`), count: extra.length });
  // Everything else a CV lists.
  const skills: string[] = r.skills ?? [];
  for (const s of e.skills ?? []) check("skill listed is found", skills.some((x) => norm(x) === norm(s) || has(x, s)), { want: s });
  for (const s of e.skills ?? []) { const got = skills.some((x) => norm(x) === norm(s) || has(x, s)); said("skills", got ? s : "", got); }
  for (const x of skills) { const k = [...(e.skills ?? [])].some((s: string) => has(x, s) || has(s, x)); if (!k && !has(text, x)) (three["skills"] ??= { correct: 0, wrong: 0, missing: 0 }).wrong++; }
  for (const s of [...(e.skills_absent ?? []), ...(e.skills_denied ?? [])]) check("skill not claimed is not added", !skills.some((x) => norm(x) === norm(s)), { got: s });
  const eduText = JSON.stringify(r.education ?? []);
  for (const d of e.education ?? []) check("qualification found", has(eduText, d.qualification), { want: d.qualification });
  for (const d of e.education ?? []) { const got = has(eduText, d.qualification); said("qualifications", got ? 1 : "", got); }
  const certText = JSON.stringify([...(r.certifications ?? []), ...(r.education ?? [])]);   // certificates are held in one list with qualifications, marked as such
  for (const c of e.certifications ?? []) check("certification found", has(certText, c.name ?? c), { want: c.name ?? c });
  for (const c of e.certifications ?? []) { const got = has(certText, c.name ?? c); said("certifications", got ? 1 : "", got); }
  const langText = JSON.stringify(r.languages ?? []);
  for (const l of e.languages ?? []) check("language found", has(langText, l), { want: l });
  for (const l of e.languages ?? []) { const got = has(langText, l); said("languages", got ? 1 : "", got); }
  if (e.summary && has(text, String(e.summary).split(/[.!?]/)[0])) check("summary kept", has(r.summary, String(e.summary).split(/[.!?]/)[0]), { got: String(r.summary).slice(0, 80) });
  (byLayout[e.layout ?? "pack"] ??= new Tally()).hit += good; byLayout[e.layout ?? "pack"].of += all;
  (byFormat[format] ??= new Tally()).hit += good; byFormat[format].of += all;
  // The one read for each person, for matching: PDF if both exist, as Word and PDF hold the same content.
  if (!read.has(id) || format === "pdf") read.set(id, { c: { ...r, id, status: "new", extractionConfidence: out.confidence ?? out.meta?.confidence }, text, e, format, ms });
}

// ---------------------------------------------------------------- reading jobs
const jobFiles = readdirSync(jobDir).filter((f) => /^JD\d+\.(pdf)$/.test(f)).sort().slice(0, JOBS_LIMIT), jobs: { job: any; e: any; id: string }[] = [];
for (const f of jobFiles) {
  const id = f.split(".")[0], e = key("Expected_Jobs", id); if (!e) continue;
  let out: any; try { out = await prepareDocument(new Uint8Array(readFileSync(join(jobDir, f))), { kind: "jd", org, asOf }); } catch (err) { out = { ok: false, message: String(err) }; }
  score(id, "job read", !!out.ok, out.ok ? undefined : out.message);
  if (!out.ok) continue;
  const j = out.record, reqs = JSON.stringify([...(j.requirements ?? []), ...(j.skills ?? [])]);
  score(id, "job title", norm(j.title) === norm(e.title), { got: j.title, want: e.title });
  for (const s of e.required_skills ?? []) score(id, "job requirement found", has(reqs, s), { want: s });
  for (const s of e.preferred_skills ?? []) score(id, "job preferred skill found", has(JSON.stringify(j), s), { want: s });
  score(id, "job minimum years", JSON.stringify(j).includes(String(e.minimum_experience_years)), { want: e.minimum_experience_years });
  // Nothing but real requirements may be scored: what is not one lowers every candidate's score and tells the recruiter nothing.
  const wanted = [...(e.required_skills ?? []), ...(e.preferred_skills ?? []), e.qualification].filter(Boolean), given = [...(j.requirements ?? []), ...(j.preferredRequirements ?? [])];
  for (const line of given) score(id, "job line scored is a real requirement", wanted.some((w: string) => has(line, w)) || /\byears?\b/i.test(line) || /\bqualif|degree|diploma|equivalent\b/i.test(line) || /^(experience|proven|demonstrated)\b/i.test(line), { line });
  jobs.push({ job: { ...j, id, status: "open", extractionConfidence: out.confidence ?? out.meta?.confidence }, e, id });
}

// ---------------------------------------------------------------- every match, both directions
const STATES = ["verified", "partial", "not_demonstrated", "contradicted"];
const traced: any[] = []; let scoreChecks = 0, scoreWrong = 0;
const confusion: Record<string, Record<string, number>> = {}, audit: Record<string, Tally> = {}, A = (k: string) => (audit[k] ??= new Tally()), reasonFails: any[] = [];
const auditOne = (id: string, ok: boolean, rule: string, detail?: unknown) => { A(rule).add(ok); if (!ok) reasonFails.push({ pair: id, rule, detail }); };
const relationOf = (cv: any, job: any) => (cv.base_role && cv.base_role === job.base_role ? "same role" : cv.role_family === job.role_family ? "same" : (job.adjacent_families ?? []).includes(cv.role_family) ? "adjacent" : "unrelated");
const scores: { cv: string; job: string; score: number; relation: string; band: string; confidence: string; years: number }[] = [];
// Every qualification requirement judged, so a person can read which fields counted: a specific or relevant field decides these (the owner, 2026-11-05).
const fieldRows: { cv: string; job: string; title: string; relation: string; requirement: string; state: string; degrees: string[]; why: string }[] = [];
// Every requirement that was given credit, with the sentence it was given for: what a second reader has to check.
const creditRows: { cv: string; job: string; requirement: string; said: string; source: string }[] = [];
const truthRows: { pair: string; title: string; requirement: string; truth: string; said: string; source: string }[] = [];
const MATCH_T0 = performance.now();
for (const [cvId, r] of read) for (const { job, e: je, id: jobId } of jobs) {
  const m: any = assess(r.c, job, r.text, asOf), pair = `${cvId}x${jobId}`, relation = relationOf(r.e, je);
  scores.push({ cv: cvId, job: jobId, score: m.score, relation, band: m.band, confidence: m.confidence, years: m.experienceYears });
  for (const ev of m.evidence as any[]) {
    if (/\b(degree|diploma|bachelor|master|honours|qualification|nqf)\b/i.test(ev.label)) fieldRows.push({ cv: cvId, job: jobId, title: job.title, relation, requirement: ev.label, state: ev.state, degrees: (r.c.education ?? []).map((q: any) => q.degree), why: String(ev.explanation).slice(0, 300) });
    if (ev.state === "verified" || ev.state === "partial") creditRows.push({ cv: cvId, job: jobId, requirement: ev.label, said: ev.state, source: String(ev.source ?? "").slice(0, 400) });
  }
  // Reasoning, for each single match.
  auditOne(pair, typeof m.recommendation === "string" && m.recommendation.length > 20, "says what it recommends, in words");
  auditOne(pair, ["High", "Medium", "Low"].includes(m.confidence) && (m.confidenceReasons?.length ?? 0) > 0, "confidence with its reasons");
  auditOne(pair, m.score >= m.scoreFloor && m.score <= m.scoreCeiling, "score lies between what is proved and what is possible", [m.scoreFloor, m.score, m.scoreCeiling]);
  const count = { verified: 0, partial: 0, not_demonstrated: 0, contradicted: 0 } as Record<string, number>;
  for (const ev of m.evidence) {
    if (ev.duplicateOf) continue;
    count[ev.state] = (count[ev.state] ?? 0) + 1;
    auditOne(pair, ["verified", "partial", "not_demonstrated", "contradicted", "not_applicable"].includes(ev.state), "only the five evidence words", ev.state);
    auditOne(pair, !!ev.explanation && ev.explanation.length > 12, "every requirement explained", ev.label);
    if (ev.state === "verified" || ev.state === "partial") {
      auditOne(pair, !!ev.source, "credit given names its source", ev.label);
      if (ev.source) {
        const q = String(ev.source).replace(/^["“]|["”]$/g, "").split(/[.;]/)[0];
        const pieces = /years?\b/i.test(ev.label) ? String(ev.source).split(/;\s*/).flatMap((x) => x.split(/,\s*/)) : [q];   // years rest on roles, named one by one
        auditOne(pair, pieces.every((x) => norm(r.text).includes(norm(x).slice(0, 60))) || /^implied by/i.test(String(ev.source)), "the source quoted is really in the CV", { label: ev.label, source: String(ev.source).slice(0, 90) });
        const ref = [...(r.e.references ?? []).map((x: any) => x.name), r.e.agency?.name, r.e.agency?.recruiter].filter(Boolean);
        auditOne(pair, !ref.some((n: string) => has(ev.source, n)), "credit never comes from a referee or agency line", { source: String(ev.source).slice(0, 90) });
      }
    }
    if (ev.state === "not_demonstrated") auditOne(pair, !/\b(lacks|does not have|has no experience|is unable|cannot do)\b/i.test(ev.explanation.replace(/not proof the candidate lacks it/g, "")), "absence is never stated as proof", { label: ev.label, explanation: ev.explanation.slice(0, 120) });
    // The truth for a skill requirement, as written into this CV.
    const need = [...(je.required_skills ?? []), ...(je.preferred_skills ?? [])].find((s: string) => has(ev.label, s));
    if (need && r.e.skills_described) {
      const truth = r.e.skills_described.includes(need) ? "verified" : r.e.skills_listed_only.includes(need) ? "partial" : r.e.skills_denied.includes(need) ? "contradicted" : "not_demonstrated";
      // The key covers this profession's skills. A skill of another profession that the writing happens to name is not known to be absent, so it is not counted either way.
      if (truth === "not_demonstrated" && has(r.text, need)) continue;
      const row = (confusion[truth] ??= {}); row[ev.state] = (row[ev.state] ?? 0) + 1;
      truthRows.push({ pair, title: job.title, requirement: ev.label, truth, said: ev.state, source: String(ev.source ?? "").slice(0, 500) });
      if (ev.state !== truth) {
        // Where the mistake was made. Reading: the words are not in the text at all. Extraction: in the text, but the record does not hold them. Evidence: the record holds them and the requirement was judged wrongly. Scoring is arithmetic on the state, so it is checked apart (below).
        const inText = has(r.text, need), inRecord = has(JSON.stringify([r.c.skills, r.c.workHistory, r.c.projects]), need);
        const stage = truth === "not_demonstrated" ? (String(ev.source ?? "").toLowerCase().startsWith("implied") ? "evidence: implied by another skill" : "evidence: credit without the skill") : !inText ? "reading: the words are not in the text" : !inRecord ? "extraction: in the text, not in the record" : "evidence: in the record, judged wrongly";
        traced.push({ pair, requirement: ev.label, truth, said: ev.state, stage, source: String(ev.source ?? "").slice(0, 180), explanation: String(ev.explanation).slice(0, 180) });
      }
    }
  }
  // Scoring is arithmetic: the score must be what the requirements' own credit and weights give.
  { const on = m.evidence.filter((x: any) => !x.duplicateOf && x.state !== "not_applicable" && x.possible > 0), w = on.reduce((n: number, x: any) => n + x.possible, 0), expect = w ? Math.round((100 * on.reduce((n: number, x: any) => n + x.possible * (x.credit?.exp ?? 0), 0)) / w) : 0; scoreChecks++; if (Math.abs(expect - m.score) > 1 && !m.evidence.some((x: any) => x.mandatory && x.state === "contradicted")) scoreWrong++; }
  auditOne(pair, m.counts.verified === count.verified && m.counts.contradicted === count.contradicted, "summary counts agree with the requirements shown", [m.counts, count]);
  if (relation === "unrelated") auditOne(pair, !/strong/i.test(m.band), "no strong band across unrelated professions", { band: m.band, score: m.score, cvFamily: r.e.role_family, jobFamily: je.role_family, title: r.c.role, jobTitle: job.title });
}

// ---------------------------------------------------------------- does the right person rank first
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const by = (k: "cv" | "job") => { const m = new Map<string, typeof scores>(); for (const s of scores) m.set(s[k], [...(m.get(s[k]) ?? []), s]); return m; };
const auc = (a: number[], b: number[]) => { let w = 0; for (const x of a) for (const y of b) w += x > y ? 1 : x === y ? 0.5 : 0; return a.length && b.length ? (w / (a.length * b.length)).toFixed(3) : "-"; };
const ofRel = (rel: string, list = scores) => list.filter((s) => s.relation === rel).map((s) => s.score);
const fits = (r: string) => r === "same" || r === "same role";
const direction = (name: "cv" | "job") => { let top1 = 0, top3 = 0, n = 0; for (const [, list] of by(name)) { if (!list.some((s) => fits(s.relation))) continue; const sorted = [...list].sort((a, b) => b.score - a.score); n++; if (fits(sorted[0].relation)) top1++; if (sorted.slice(0, 3).some((s) => fits(s.relation))) top3++; } return `${pct(top1, n)} first, ${pct(top3, n)} within the top three (${n})`; };

// ---------------------------------------------------------------- the report
const lines: string[] = [];
const say = (s = "") => { lines.push(s); console.log(s); };
say(`Run ${run}. Reader ${parserVersionLabel()}. ${files.length} CV files (${read.size} people), ${jobs.length} jobs, ${scores.length} matches in ${((performance.now() - MATCH_T0) / 1000).toFixed(0)} s. Reading: median ${(median(times) / 1000).toFixed(1)} s a document, slowest ${(Math.max(...times) / 1000).toFixed(1)} s.`);
say("\nPARSING, every field against its answer key");
for (const k of Object.keys(fields).sort()) say(`  ${k.padEnd(34)} ${fields[k].text}`);
say("  By layout: " + Object.entries(byLayout).map(([k, v]) => `${k} ${pct(v.hit, v.of)}`).join(", "));
say("  By format: " + Object.entries(byFormat).map(([k, v]) => `${k} ${pct(v.hit, v.of)}`).join(", "));
say("\nCORRECT, WRONG AND MISSING, by field");
for (const k of Object.keys(three).sort()) { const t = three[k], n = t.correct + t.wrong + t.missing; say(`  ${k.padEnd(20)} correct ${pct(t.correct, n).padStart(7)}  wrong ${pct(t.wrong, n).padStart(6)}  missing ${pct(t.missing, n).padStart(6)}  (${n})`); }
say("\nMATCHING, requirement by requirement, against what each CV truly shows (rows: the truth; columns: what the match said)");
say("  " + "".padEnd(18) + STATES.map((s) => s.padStart(18)).join(""));
let right = 0, allStates = 0;
for (const t of STATES) { const row = confusion[t] ?? {}; say("  " + t.padEnd(18) + STATES.map((s) => String(row[s] ?? 0).padStart(18)).join("")); for (const s of STATES) { allStates += row[s] ?? 0; if (s === t) right += row[s] ?? 0; } }
say(`  Exactly right: ${pct(right, allStates)} of ${allStates}. Credit given for something the CV does not show: ${pct((confusion.not_demonstrated?.verified ?? 0) + (confusion.not_demonstrated?.partial ?? 0), Object.values(confusion.not_demonstrated ?? {}).reduce((a, b) => a + b, 0))}. Denied but credited: ${(confusion.contradicted?.verified ?? 0) + (confusion.contradicted?.partial ?? 0)} of ${Object.values(confusion.contradicted ?? {}).reduce((a, b) => a + b, 0)}.`);
const stages: Record<string, number> = {}; for (const t of traced) stages[t.stage] = (stages[t.stage] ?? 0) + 1;
say("  Traced to their stage: " + (Object.entries(stages).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join("; ") || "none"));
say(`  Scoring: the percentage equals the requirements' own credit and weights in ${scoreChecks - scoreWrong} of ${scoreChecks} matches.`);
say("\nRANKING, both directions");
say(`  Median score: same role ${median(ofRel("same role"))}, same profession ${median(ofRel("same"))}, adjacent ${median(ofRel("adjacent"))}, unrelated ${median(ofRel("unrelated"))}.`);
const bands: Record<string, Record<string, number>> = {}; for (const x of scores) { const b = (bands[x.relation] ??= {}); b[x.band] = (b[x.band] ?? 0) + 1; }
say("  Bands: " + Object.entries(bands).map(([k, v]) => `${k}: ${Object.entries(v).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(", ")}`).join(" | "));
const conf: Record<string, number> = {}; for (const x of scores) conf[x.confidence] = (conf[x.confidence] ?? 0) + 1; say("  Confidence: " + JSON.stringify(conf));
say(`  Same role above same profession ${auc(ofRel("same role"), ofRel("same"))}; same role above unrelated ${auc(ofRel("same role"), ofRel("unrelated"))}.`);
say(`  A same-profession pair scores above an unrelated one ${auc([...ofRel("same"), ...ofRel("same role")], ofRel("unrelated"))} of the time; above an adjacent one ${auc(ofRel("same"), ofRel("adjacent"))}; adjacent above unrelated ${auc(ofRel("adjacent"), ofRel("unrelated"))} (1 is perfect, 0.5 is chance).`);
say(`  For each job, the people ranked: someone of that profession ${direction("job")}.`);
say(`  For each person, the jobs ranked: a job in their profession ${direction("cv")}.`);
say("\nREASONING, every single match");
for (const k of Object.keys(audit).sort()) say(`  ${k.padEnd(62)} ${audit[k].text}`);
writeFileSync(join(OUT, "report.txt"), lines.join("\n"));
writeFileSync(join(OUT, "failures.json"), JSON.stringify(failures, null, 1));
writeFileSync(join(OUT, "reasoning-failures.json"), JSON.stringify(reasonFails.slice(0, 5000), null, 1));
writeFileSync(join(OUT, "scores.json"), JSON.stringify(scores));
writeFileSync(join(OUT, "matching-errors.json"), JSON.stringify(traced, null, 1));
writeFileSync(join(OUT, "field-rows.json"), JSON.stringify(fieldRows));
writeFileSync(join(OUT, "credit-rows.json"), JSON.stringify(creditRows));
writeFileSync(join(OUT, "truth-rows.json"), JSON.stringify(truthRows));
writeFileSync(join(OUT, "records.json"), JSON.stringify([...read.entries()].map(([id, r]) => ({ id, record: r.c }))));
await stopOcr?.();
process.exit(0);
