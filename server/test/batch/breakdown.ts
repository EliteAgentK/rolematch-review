// What a comparison means, at every level: checks, fields, documents, independent candidates, formats and layout families, with recall and precision
// apart. Reads the stored comparison (compare.ts) and the two runs' scores; writes breakdown-vs-<incumbent>-<split>.json beside the experiment run.
// Usage: node --import tsx test/batch/breakdown.ts <batch id> <incumbent run> <experiment run> <split>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [batchId, a, b, split, splitsArg] = process.argv.slice(2);   // optional 5th argument: a splits file, as in compare.ts
const D = join(import.meta.dirname, "..", "..", "data", "evaluations", batchId);
const tag = splitsArg ? "-" + splitsArg.replace(".json", "") : "";
const cmp = JSON.parse(readFileSync(join(D, b, `compare-vs-${a}-${split}${tag}.json`), "utf8"));
const roles: Record<string, string> | undefined = splitsArg ? JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "assessment", "batches", batchId, splitsArg), "utf8")).roles : undefined;
const rowsOf = (r: string) => new Map((JSON.parse(readFileSync(join(D, r, "scores.json"), "utf8")) as any[]).map((x) => (roles ? { ...x, split: roles[x.id] === "protected" ? "validation" : roles[x.id] } : x)).filter((x) => split === "all" || x.split === split).map((x) => [x.path, x]));
const A = rowsOf(a), B = rowsOf(b);
const isPrecision = (f: string) => /precision/.test(f), isUnsupported = (f: string) => /unsupported/.test(f);
const fieldOf = (id: string) => id.split("|")[0];

const blank = () => ({ documents: 0, failures: { incumbent: 0, experiment: 0 }, recall: { recovered: 0, lost: 0 }, correctAdded: 0, correctLost: 0, unsupported: { added: 0, removed: 0 }, extraPrinted: { added: 0, removed: 0 }, otherErrors: { added: 0, removed: 0 }, newlyPublishedDocErrors: 0, medianMs: { incumbent: 0, experiment: 0 }, maxRssMb: { incumbent: 0, experiment: 0 } });
const byFormat: Record<string, ReturnType<typeof blank>> = {}, byLayout: Record<string, { documents: Set<string>; gains: number; worsenings: number }> = {};
const byField: Record<string, Record<string, number>> = {};
const docsChanged = new Set<string>(), candidatesChanged = new Set<string>(), candidatesWorse = new Set<string>();
const published = new Set(cmp.changes.filter((c: any) => c.change === "refused → published").map((c: any) => c.path));
for (const [path, x] of A) {
  const f = (byFormat[x.condition + " " + x.kind] ??= blank()); f.documents++;
  if (!x.ok) f.failures.incumbent++; if (!B.get(path)!.ok) f.failures.experiment++;
}
for (const c of cmp.changes) {
  const x = A.get(c.path)!, fmt = byFormat[x.condition + " " + x.kind], field = c.field ?? (c.id ? fieldOf(c.id) : "publication");
  (byField[field] ??= {})[c.change] = ((byField[field] ??= {})[c.change] ?? 0) + 1;
  docsChanged.add(c.path); candidatesChanged.add(x.id);
  const lay = (byLayout[`${x.header} / body ${x.bodyLayout}`] ??= { documents: new Set(), gains: 0, worsenings: 0 }); lay.documents.add(c.path);
  const worse = ["right → wrong", "added error", "removed correct", "published → refused"].includes(c.change);
  if (worse) { lay.worsenings++; candidatesWorse.add(x.id); } else lay.gains++;
  if (c.change === "wrong → right" && field === "skill recall") fmt.recall.recovered++;
  else if (c.change === "right → wrong" && /recall/.test(field)) fmt.recall.lost++;
  else if (c.change === "wrong → right" || c.change === "added correct") fmt.correctAdded++;
  else if (c.change === "right → wrong" || c.change === "removed correct") fmt.correctLost++;
  else if (c.change === "added error" || c.change === "removed error") {
    const k = isUnsupported(field) ? "unsupported" : isPrecision(field) ? "extraPrinted" : "otherErrors";
    (fmt as any)[k][c.change === "added error" ? "added" : "removed"]++;
    if (c.change === "added error" && published.has(c.path)) fmt.newlyPublishedDocErrors++;
  }
}
const median = (xs: number[]) => { const s = xs.filter((v) => typeof v === "number").sort((p, q) => p - q); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
for (const [k, f] of Object.entries(byFormat)) {
  const [cond, kind] = k.split(" ");
  const pick = (m: Map<string, any>) => [...m.values()].filter((r) => r.condition === cond && r.kind === kind);
  f.medianMs = { incumbent: median(pick(A).map((r) => r.ms)), experiment: median(pick(B).map((r) => r.ms)) };
  f.maxRssMb = { incumbent: Math.max(...pick(A).map((r) => r.rssMb)), experiment: Math.max(...pick(B).map((r) => r.rssMb)) };
}
const allCandidates = new Set([...A.values()].map((r) => r.id));
const out = {
  comparatorVersion: cmp.comparatorVersion, scorerVersion: cmp.scorerVersion, batchId, incumbent: a, experiment: b, split,
  levels: {
    checks: cmp.totals, fields: byField,
    documents: { tested: A.size, changed: docsChanged.size },
    independentCandidatesOrJobs: { tested: allCandidates.size, changed: candidatesChanged.size, withAnyWorsening: candidatesWorse.size },
    layoutFamilies: { tested: new Set([...A.values()].map((r) => `${r.header} / body ${r.bodyLayout}`)).size, changed: Object.keys(byLayout).length, withAnyWorsening: Object.values(byLayout).filter((l) => l.worsenings > 0).length },
  },
  byFormat, byLayout: Object.fromEntries(Object.entries(byLayout).map(([k, v]) => [k, { documents: v.documents.size, gains: v.gains, worsenings: v.worsenings }])),
};
writeFileSync(join(D, b, `breakdown-vs-${a}-${split}${tag}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ levels: { ...out.levels, fields: undefined }, byFormat: out.byFormat }, null, 1));
