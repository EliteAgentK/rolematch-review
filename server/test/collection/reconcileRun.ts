// Scores the reconciler on stored readings. node --import tsx test/collection/reconcileRun.ts <rules run> <model run> <out run>
import { readFileSync, writeFileSync } from "node:fs";
import { mergeReading } from "../../src/reconcile";
const [a, b, out] = process.argv.slice(2), R = "data/real-cvs/candidate", A = JSON.parse(readFileSync(`${R}/${a}.json`, "utf8")), B = JSON.parse(readFileSync(`${R}/${b}.json`, "utf8")), M = new Map(B.rows.map((r: any) => [r.id, r]));
const tally: Record<string, number> = {};
const rows = A.rows.map((r: any) => { const m: any = M.get(r.id); if (!m?.reading) return r; const rec = mergeReading(r.record, m.reading, { model: "x", promptVersion: "x" }); for (const k of Object.keys(rec.reading.roles)) tally[k] = (tally[k] ?? 0) + rec.reading.roles[k]; return { ...r, record: rec }; });
writeFileSync(`${R}/${out}.json`, JSON.stringify({ commit: `reconciled ${a} ${b}`, rows }));
console.log(JSON.stringify(tally));
process.exit(0);
