// One report per run: every field by format, right / wrong and published / omitted, on the same documents for every run compared. A refused document counts as omissions for all it should have
// given, so refusing a hard document cannot look like an improvement. Usage: node --import tsx test/candidate/fields.ts <pack> <batch> <run> [<base run>]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [pack, batch, runId, baseId] = process.argv.slice(2), EVAL = join(import.meta.dirname, "..", "..", "data", "evaluations", batch);
type Tally = { right: number; wrong: number; omitted: number };
const FIELDS = ["name", "email", "phone", "location", "current title", "role found", "role employer", "role start date", "role end date", "role duties, every listed duty under this role", "role duties (employer-role-duty association)", "role precision (no extra roles)", "skill recall", "skill precision (extra, printed)", "skill precision (unsupported: not in the document)", "qualification found", "qualification institution", "qualification completion status", "certification found", "certification name clean (no other fields joined in)", "certification issuer", "certification completion status", "language recall", "language precision"];
const load = (run: string) => JSON.parse(readFileSync(join(EVAL, run, "scores.json"), "utf8")).filter((r: any) => r.kind === "cv") as any[];
const expected = (id: string) => JSON.parse(readFileSync(join(pack, "Reference", "Expected_CVs", `${id}.json`), "utf8"));
const CONDS = ["docx", "pdf", "scan", "photo", "txt"];
function tally(rows: any[], only?: Set<string>) {
  const t: Record<string, Record<string, Tally>> = {}, add = (f: string, c: string, k: keyof Tally, n = 1) => { ((t[f] ??= {})[c] ??= { right: 0, wrong: 0, omitted: 0 })[k] += n; };
  for (const r of rows) {
    if (only && !only.has(r.path)) continue;
    if (!r.checks?.length) { const e = expected(r.id); for (const f of ["name", "email", "phone", "location", "current title"]) add(f, r.condition, "omitted"); add("role found", r.condition, "omitted", e.work_history.length); add("skill recall", r.condition, "omitted", e.skills.length); add("qualification found", r.condition, "omitted", e.education.length); add("certification found", r.condition, "omitted", e.certifications.length); add("language recall", r.condition, "omitted", e.languages.length); continue; }
    for (const c of r.checks) add(c.field, r.condition, c.ok ? "right" : String(c.got ?? "").trim() ? "wrong" : "omitted");
  }
  return t;
}
const show = (x?: Tally) => (x ? `${x.right}/${x.wrong}/${x.omitted}` : "-");
const run = load(runId), paths = new Set(run.map((r) => r.path)), t = tally(run), b = baseId ? tally(load(baseId), paths) : null;
console.log(`right/wrong/omitted, ${paths.size} CV files${baseId ? `, base ${baseId} on the same files` : ""}`);
console.log("field".padEnd(44), ...CONDS.map((c) => c.padStart(baseId ? 24 : 12)));
for (const f of FIELDS) console.log(f.slice(0, 43).padEnd(44), ...CONDS.map((c) => (b ? `${show(b[f]?.[c])} > ${show(t[f]?.[c])}` : show(t[f]?.[c])).padStart(baseId ? 24 : 12)));
const flagged = run.filter((r) => r.reviewState === "needs_review" || r.review === "needs_review").length;
console.log("documents", paths.size, "needing review", flagged);
