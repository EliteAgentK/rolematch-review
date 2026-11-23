// Scores one run's extracted records against the batch's expected records, per field, with denominators, and attributes each error to the layer
// at fault. Expected values were checked to be printed in the canonical text (inventory.ts) and are never regenerated from the system's output.
// Writes server/data/evaluations/<batch>/<run>/scores.json (per document) and summary.json (aggregates by condition, layout and split).
// Usage: node --import tsx test/batch/score.ts <pack directory> <batch id> <run id>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCORER_VERSION } from "./comparelib";

const [packDir, batchId, runId] = process.argv.slice(2);
const RUN = join(import.meta.dirname, "..", "..", "data", "evaluations", batchId, runId);
const splitsFile = join(import.meta.dirname, "..", "..", "..", "docs", "assessment", "batches", batchId, "splits.json");
const splits = (existsSync(splitsFile) ? JSON.parse(readFileSync(splitsFile, "utf8")).roles : {}) as Record<string, string>;   // a pack without assigned splits is scored all the same
const load = (d: string) => !existsSync(join(packDir, "Reference", d)) ? {} : Object.fromEntries(readdirSync(join(packDir, "Reference", d)).map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(packDir, "Reference", d, f), "utf8"))]));
const expCv = load("Expected_CVs"), expJd = load("Expected_Jobs");

export const n = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[‐-―]/g, "-").replace(/[^a-z0-9@+#./-]+/g, " ").replace(/[.]+$/g, "").trim();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const toks = (s: string) => n(s).split(" ").filter(Boolean);
/** Where did a wrong field go wrong? From what the reader produced (the text), not from the record. */
export function attribute(expected: string, text: string, imageOnly: boolean): "parsing or mapping" | "reading order" | "recognition" | "text extraction" {
  const t = n(text), e = n(expected);
  if (e && t.includes(e)) return "parsing or mapping";
  const words = toks(expected), present = words.filter((w) => t.split(" ").includes(w)).length;
  if (words.length && present === words.length) return "reading order";
  return imageOnly ? "recognition" : "text extraction";
}
function levenshtein(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) { const cur = [j]; for (let i = 1; i <= a.length; i++) cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[a.length];
}
// A date is the same date however it is printed ("01/2015", "Jan 2015", "January 2015", "2015-01"). What the record holds is compared by year and month; a CV that gives only a year is compared by year.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ym = (s: unknown) => { const t = String(s ?? "").toLowerCase().trim(); let m = t.match(/^((?:19|20)\d{2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`; m = t.match(/^(\d{1,2})[/.-]((?:19|20)\d{2})/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}`; m = t.match(/([a-z]{3})[a-z]*\.?\s*((?:19|20)\d{2})/); if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`; m = t.match(/((?:19|20)\d{2})/); return m ? m[1] : t; };
const sameDate = (got: unknown, want: unknown) => { const a = ym(got), b = ym(want); return !!a && (a === b || (a.length === 4 && b.startsWith(a))); };
const statusOf = (s: string) => (/progress|current/i.test(s) ? "in_progress" : /not|incomplete|withdr/i.test(s) ? "not_completed" : /complet/i.test(s) ? "completed" : "not_stated");

/** `id` is stable between runs (the field plus the expected value, or the extracted value for precision checks), so a comparison can match the same
 *  check in two runs whether it passed or failed. (Before this, passing checks carried no expected value and right↔wrong changes went unmatched.) */
interface Check { id: string; field: string; ok: boolean; expected?: string; got?: string; layer?: string }
const docs = readdirSync(join(RUN, "docs")).map((f) => JSON.parse(readFileSync(join(RUN, "docs", f), "utf8")));
const rows: any[] = [];
for (const d of docs) {
  const imageOnly = /03_Scanned|04_Phone/.test(d.path), condition = d.path.startsWith("03_") ? "scan" : d.path.startsWith("04_") ? "photo" : d.path.includes("Searchable_PDF") ? "pdf" : d.path.includes("Word") ? "docx" : "txt";
  const e = d.kind === "cv" ? expCv[d.id] : expJd[d.id], text = d.text ?? "", checks: Check[] = [];
  const check = (field: string, ok: boolean, expected?: unknown, got?: unknown) => checks.push({ id: `${field}|${n(expected) || n(got) || "(none)"}`, field, ok, expected: String(expected ?? ""), got: String(got ?? ""), ...(ok ? {} : { layer: expected ? attribute(String(expected), text, imageOnly) : "parsing or mapping" }) });
  const ocr = imageOnly && text ? { cer: levenshtein(n(text), n(e.canonical_text)) / Math.max(1, n(e.canonical_text).length), tokenRecall: (() => { const got = new Set(toks(text)); const want = toks(e.canonical_text); return want.filter((w) => got.has(w)).length / want.length; })() } : null;
  if (d.ok && d.kind === "cv") {
    const r = d.record;
    check("name", n(r.name) === n(e.name), e.name, r.name);
    check("email", n(r.email) === n(e.email), e.email, r.email);
    check("phone", digits(r.phone) === digits(e.phone), e.phone, r.phone);
    check("location", n(r.location).includes(n(e.location)) && !!r.location, e.location, r.location);
    check("current title", n(r.role) === n(e.title), e.title, r.role);
    const got = (r.workHistory ?? []) as any[], used = new Set<number>();
    for (const w of e.work_history) {
      const i = got.findIndex((g, k) => !used.has(k) && n(g.position) === n(w.title) && sameDate(g.startDate, w.start));
      const j = i >= 0 ? i : got.findIndex((g, k) => !used.has(k) && n(g.position) === n(w.title));
      if (j >= 0) used.add(j);
      const g = j >= 0 ? got[j] : undefined;
      check("role found", !!g, `${w.title} (${w.start})`, g ? g.position : "");
      if (!g) continue;
      check("role employer", n(g.company) === n(w.employer), w.employer, g.company);
      check("role start date", sameDate(g.startDate, w.start), w.start, g.startDate);
      check("role end date", w.end ? sameDate(g.endDate, w.end) : /present|current|now|date/i.test(g.endDate), w.end ?? "Present", g.endDate);
      const want = new Set(w.bullets.map(n)), have = new Set((g.responsibilities ?? []).map(n));
      check("role duties, every listed duty under this role", [...want].every((x) => have.has(x) || [...have].some((h) => (h as string).includes(x as string))), w.bullets.join(" / "), (g.responsibilities ?? []).join(" / "));
      check("role duties (employer-role-duty association)", n(g.company) === n(w.employer) && want.size === have.size && [...want].every((x) => have.has(x)), w.bullets.join(" / "), (g.responsibilities ?? []).join(" / "));
    }
    const extraRoles = got.filter((_, k) => !used.has(k));
    for (const x of extraRoles) check("role precision (no extra roles)", false, "", `${x.position} at ${x.company}`);
    const wantSkills = new Set(e.skills.map(n)), gotSkills = (r.skills ?? []).map(n);
    for (const s of e.skills) check("skill recall", gotSkills.includes(n(s)), s, "");
    for (const s of r.skills ?? []) if (!wantSkills.has(n(s))) { const field = n(e.canonical_text).includes(n(s)) ? "skill precision (extra, printed)" : "skill precision (unsupported: not in the document)"; checks.push({ id: `skill precision|${n(s)}`, field, ok: false, expected: "", got: s, layer: "parsing or mapping" }); }
    for (const s of r.skills ?? []) if (wantSkills.has(n(s))) checks.push({ id: `skill precision|${n(s)}`, field: "skill precision (extra, printed)", ok: true, expected: s, got: s });
    const edu = (r.education ?? []) as any[];
    for (const q of e.education) {
      const g = edu.find((x) => n(x.degree) === n(q.qualification) || (n(x.degree).includes(n(q.qualification)) && x.type !== "certificate"));
      check("qualification found", !!g, q.qualification, "");
      if (!g) continue;
      check("qualification institution", n(g.institution) === n(q.institution), q.institution, g.institution);
      check("qualification completion status", g.status === statusOf(q.status), statusOf(q.status), g.status);
    }
    // the schema files certifications as education entries of type "certificate" (types.ts EducationItem), not in a separate list
    for (const c of e.certifications) {
      const g = edu.find((x) => n(x.degree) === n(c.name) || n(x.degree).includes(n(c.name)));
      check("certification found", !!g, c.name, "");
      if (!g) continue;
      check("certification name clean (no other fields joined in)", n(g.degree) === n(c.name), c.name, g.degree);
      check("certification issuer", n(g.institution) === n(c.issuer), c.issuer, g.institution);
      if (/expired/i.test(c.status)) check("certification completion status", g.validity === "expired", "expired", g.validity ?? g.status); else check("certification completion status", g.status === statusOf(c.status), statusOf(c.status), g.status);
    }
    const wantLang = e.languages.map(n), gotLang = (r.languages ?? []).map(n);
    for (const l of e.languages) check("language recall", gotLang.includes(n(l)), l, "");
    for (const l of r.languages ?? []) check("language precision", wantLang.includes(n(l)), "", l);
  }
  if (d.ok && d.kind === "jd") {
    const r = d.record, req = (r.requirements ?? []).map(n), pref = (r.preferredRequirements ?? []).map(n);
    const essential = (e.source_sections["Essential requirements"] ?? []).map(n), desirable = (e.source_sections["Desirable experience"] ?? []).map(n);
    check("job title", n(r.title) === n(e.title), e.title, r.title);
    check("job employer", n(r.company) === n(e.employer), e.employer, r.company);
    check("job location", n(r.location) === n(e.location), e.location, r.location);
    for (const x of essential) check("essential requirement recall", req.includes(x), x, "");
    for (const x of req) check("essential requirement precision", essential.includes(x), "", x);
    for (const x of desirable) check("desirable requirement recall", pref.includes(x), x, "");
    for (const x of pref) check("desirable requirement precision", desirable.includes(x), "", x);
  }
  rows.push({ scorerVersion: SCORER_VERSION, path: d.path, id: d.id, kind: d.kind, condition, split: splits[d.id] ?? "unassigned", layout: e?.layout, header: e?.design?.header, bodyLayout: e?.design?.body_layout, difficulty: e?.difficulty ?? [], ok: d.ok, code: d.code ?? null, review: d.review?.state ?? null, ms: d.ms, rssMb: d.rssMb, ocr, checks });
}
writeFileSync(join(RUN, "scores.json"), JSON.stringify(rows, null, 2));

// aggregates: by field × condition, by layer, by split; denominators always shown
const agg = (sel: (r: any) => boolean) => {
  const out: Record<string, { ok: number; total: number }> = {};
  for (const r of rows.filter(sel)) for (const c of r.checks) { const k = c.field; out[k] ??= { ok: 0, total: 0 }; out[k].total++; if (c.ok) out[k].ok++; }
  return out;
};
const conditions = ["docx", "pdf", "txt", "scan", "photo"];
const byLayer: Record<string, number> = {};
for (const r of rows) for (const c of r.checks) if (!c.ok) byLayer[`${r.condition}: ${c.layer}`] = (byLayer[`${r.condition}: ${c.layer}`] ?? 0) + 1;
const failures = rows.filter((r) => !r.ok).reduce((m: any, r) => { const k = `${r.kind} ${r.condition}: ${r.code}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
const ocrRows = rows.filter((r) => r.ocr);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const summary = {
  batchId, runId, documents: rows.length, published: rows.filter((r) => r.ok).length, refused: failures,
  needsReview: rows.filter((r) => r.review === "needs_review").length,
  fieldsByCondition: Object.fromEntries(conditions.map((c) => [c, agg((r) => r.condition === c)])),
  fieldsBySplit: { development: agg((r) => r.split === "development"), protected: agg((r) => r.split === "protected") },
  errorsByLayer: byLayer,
  ocr: { documents: ocrRows.length, medianCer: median(ocrRows.map((r) => r.ocr.cer)), medianTokenRecall: median(ocrRows.map((r) => r.ocr.tokenRecall)), byCondition: Object.fromEntries(["scan", "photo"].map((c) => [c, { medianCer: median(ocrRows.filter((r) => r.condition === c).map((r) => r.ocr.cer)), medianTokenRecall: median(ocrRows.filter((r) => r.condition === c).map((r) => r.ocr.tokenRecall)) }])) },
  time: { medianMsByCondition: Object.fromEntries(conditions.map((c) => [c, median(rows.filter((r) => r.condition === c).map((r) => r.ms))])), maxMs: Math.max(...rows.map((r) => r.ms)), maxRssMb: Math.max(...rows.map((r) => r.rssMb)) },
};
writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1).slice(0, 6000));
