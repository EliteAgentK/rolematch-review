// Compares two scored runs on the SAME inputs with the tested comparator (comparelib.ts), per split. Writes the full list of changes and the totals,
// stamped with the comparator and scorer versions. Usage: node --import tsx test/batch/compare.ts <batch id> <incumbent run> <experiment run> [--split protected|development|all]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMPARATOR_VERSION, compareRows, SCORER_VERSION, tallyChanges, worsenings } from "./comparelib";

const [batchId, a, b] = process.argv.slice(2), split = process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "all";
const D = join(import.meta.dirname, "..", "..", "data", "evaluations", batchId);
// --splits <file> relabels dataset roles (for example splits-v2.json after inspected records moved to development); the stored scores are unchanged
const splitsArg = process.argv.includes("--splits") ? process.argv[process.argv.indexOf("--splits") + 1] : undefined;
const roles: Record<string, string> | undefined = splitsArg ? JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "assessment", "batches", batchId, splitsArg), "utf8")).roles : undefined;
const relabel = (x: any) => (roles ? { ...x, split: roles[x.id] === "protected" ? "validation" : roles[x.id] } : x);
const load = (r: string) => (JSON.parse(readFileSync(join(D, r, "scores.json"), "utf8")) as any[]).map(relabel).filter((x) => split === "all" || x.split === split);
const changes = compareRows(load(a), load(b));
const out = { comparatorVersion: COMPARATOR_VERSION, scorerVersion: SCORER_VERSION, splits: splitsArg ?? "splits.json", batchId, incumbent: a, experiment: b, split, totals: tallyChanges(changes), worsenings: worsenings(changes).length, changes };
writeFileSync(join(D, b, `compare-vs-${a}-${split}${splitsArg ? "-" + splitsArg.replace(".json", "") : ""}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ split, totals: out.totals, worsenings: out.worsenings }));
