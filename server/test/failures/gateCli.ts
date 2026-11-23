// npm run parser:gate : the current parser and the prototype against the retained failure library, each against its accepted baseline (ledger.json). Exit 0 pass, 1 fail, 2 incomplete.
// Local unless CI runs it. It reports; passing never switches anything on.
import { readFileSync, writeFileSync } from "node:fs";
import { stopOcr } from "../../src/ocr";
import { gate } from "./gate";
import { currentParser, prototype, score } from "./run";

const LEDGER = new URL("./ledger.json", import.meta.url), ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const [cur, pro] = [await score(currentParser), await score(prototype())];
await stopOcr();
const total = (c: any) => Object.values<any>(c.fields).reduce((a, f) => ({ correct: a.correct + f.correct, wrong: a.wrong + f.wrong, missing: a.missing + f.missing, total: a.total + f.total }), { correct: 0, wrong: 0, missing: 0, total: 0 });
console.log("library, all fields and variants:", "current", JSON.stringify(total(cur.card)), "| prototype", JSON.stringify(total(pro.card)));
if (process.argv.includes("--freeze")) {
  const reason = process.argv[process.argv.indexOf("--freeze") + 1];
  if (!reason || reason.startsWith("--")) { console.error("--freeze needs a reason"); process.exit(2); }
  const slim = (c: any) => ({ ...c, medianMs: c.medianMs });
  writeFileSync(LEDGER, JSON.stringify({ ...ledger, baseline: { current: slim(cur.card), prototype: slim(pro.card) }, openInPrototype: Object.fromEntries(pro.failing.map((id: string) => [id, ledger.openInPrototype?.[id] ?? "open"])), history: [...(ledger.history ?? []), { at: new Date().toISOString().slice(0, 10), reason }] }, null, 1) + "\n");
  console.log("baseline frozen:", reason); process.exit(0);
}
const opts = { latencyFactor: 10, latencySlackMs: 500 };   // a small file's time is noise; latency on real documents is reported by the comparison
const results = [["current parser", gate(ledger.baseline.current, cur.card, opts)], ["prototype", gate(ledger.baseline.prototype, pro.card, opts)]] as const;
for (const [who, r] of results) { console.log(`${who}: ${r.verdict.toUpperCase()}`); for (const p of r.problems) console.log("  problem:", p); for (const g of r.gains.slice(0, 8)) console.log("  gain:", g); }
process.exit(results.some(([, r]) => r.verdict === "incomplete") ? 2 : results.some(([, r]) => r.verdict === "fail") ? 1 : 0);
