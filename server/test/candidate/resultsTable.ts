// Right / wrong / missing with denominators, by field and format, from stored runs, so a report's figures are never typed by hand. A refused document counts as missing for all it should have given.
// Usage: node --import tsx test/candidate/resultsTable.ts <pack> <batch> <run> [<run> ...]   Each cell lists the runs in the order given.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [pack, batch, ...runs] = process.argv.slice(2), EVAL = join(import.meta.dirname, "..", "..", "data", "evaluations", batch);
type T = { right: number; wrong: number; missing: number };
const FIELDS: [string, string][] = [["name", "Name"], ["email", "E-mail"], ["phone", "Phone"], ["location", "Location"], ["current title", "Current title"], ["role found", "Roles found"], ["role employer", "Role's employer"], ["role start date", "Role's start date"], ["role end date", "Role's end date"], ["role duties, every listed duty under this role", "Every listed duty under its role"], ["skill recall", "Skills found"], ["qualification found", "Qualifications found"], ["qualification institution", "Qualification's institution"], ["qualification completion status", "Qualification's status"], ["certification found", "Certifications found"], ["certification name clean (no other fields joined in)", "Certification's name clean"], ["certification issuer", "Certification's issuer"], ["certification completion status", "Certification's status, including expired"], ["language recall", "Languages found"]];
const expected = (id: string) => JSON.parse(readFileSync(join(pack, "Reference", "Expected_CVs", `${id}.json`), "utf8"));
const tally = (run: string) => {
  const rows = JSON.parse(readFileSync(join(EVAL, run, "scores.json"), "utf8")).filter((r: any) => r.kind === "cv") as any[], t: Record<string, Record<string, T>> = {}, add = (f: string, c: string, k: keyof T, n = 1) => { ((t[f] ??= {})[c] ??= { right: 0, wrong: 0, missing: 0 })[k] += n; };
  for (const r of rows) {
    if (!r.checks?.length) { const e = expected(r.id); for (const f of ["name", "email", "phone", "location", "current title"]) add(f, r.condition, "missing"); add("role found", r.condition, "missing", e.work_history.length); add("skill recall", r.condition, "missing", e.skills.length); add("qualification found", r.condition, "missing", e.education.length); add("certification found", r.condition, "missing", e.certifications.length); add("language recall", r.condition, "missing", e.languages.length); continue; }
    for (const c of r.checks) add(c.field, r.condition, c.ok ? "right" : String(c.got ?? "").trim() ? "wrong" : "missing");
  }
  return t;
};
const all = runs.map(tally), conds = ["docx", "pdf", "scan", "photo"].filter((c) => all.some((t) => Object.values(t).some((x) => x[c]))), NAME: Record<string, string> = { docx: "Word", pdf: "Searchable PDF", scan: "Scan", photo: "Photo" };
const cell = (x?: T) => (x ? `${x.right}/${x.wrong}/${x.missing} of ${x.right + x.wrong + x.missing}` : "-");
console.log(`| Field | ${conds.map((c) => NAME[c]).join(" | ")} |`); console.log(`|---|${conds.map(() => "---").join("|")}|`);
for (const [f, label] of FIELDS) if (all.some((t) => t[f])) console.log(`| ${label} | ${conds.map((c) => all.map((t) => cell(t[f]?.[c])).join("<br>")).join(" | ")} |`);
