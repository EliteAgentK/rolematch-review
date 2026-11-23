// Did review fall because the values got better, or because more doubtful values are let through? Compares two runs of one pack, on the same files. Usage: reviewAnalysis.ts <batch> <base run> <run>
// Three things answer it. Wrong published values, sent for review and not (a wrong value nobody is asked to check is the one that does harm). The old review rules applied to the new records: what is left of the fall when the rules are held
// still is the part extraction earned. And the documents that left review: did they leave right or wrong?
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewCandidate } from "../../src/review";
import { defaultSettings } from "../../src/settings";

const [batch, baseId, runId] = process.argv.slice(2), EVAL = join(import.meta.dirname, "..", "..", "data", "evaluations", batch);
const load = (run: string) => JSON.parse(readFileSync(join(EVAL, run, "scores.json"), "utf8")).filter((r: any) => r.kind === "cv") as any[];
const doc = (run: string, path: string) => JSON.parse(readFileSync(join(EVAL, run, "docs", path.replace(/[\\/]/g, "__") + ".json"), "utf8"));
const CORE = ["name", "email", "phone", "location", "current title"], ALL = [...CORE, "role employer", "role start date", "role end date", "qualification institution", "qualification completion status", "certification issuer", "certification completion status", "skill precision (unsupported: not in the document)"];
const wrong = (r: any, fields: string[]) => (r.checks ?? []).filter((c: any) => fields.includes(c.field) && !c.ok && String(c.got ?? "").trim());
const missing = (r: any, fields: string[]) => (r.checks ?? []).filter((c: any) => fields.includes(c.field) && !c.ok && !String(c.got ?? "").trim());
const reviewed = (r: any) => r.review === "needs_review";
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const base = load(baseId), run = load(runId), byPath = new Map(base.map((r) => [r.path, r])), org = defaultSettings();
const rows = run.filter((r) => byPath.has(r.path));
const CONDS = [...new Set(rows.map((r) => r.condition))];
console.log(`${batch}: ${baseId} > ${runId}, ${rows.length} documents`);
console.log("\nformat | sent for review, before > after | old review rules on the new records | wrong core values before > after | of those not sent for review, before > after | core values missing before > after");
for (const c of [...CONDS, "all"]) {
  const r = rows.filter((x) => c === "all" || x.condition === c), b = r.map((x) => byPath.get(x.path));
  const published = r.filter((x) => x.ok), oldRules = published.filter((x) => { const d = doc(runId, x.path); return reviewCandidate(d.record, d.confidence, d.meta, (d.text ?? "").length, org.review).state === "needs_review"; }).length;
  const w = (list: any[], only?: (x: any) => boolean) => list.filter(only ?? (() => true)).reduce((a, x) => a + wrong(x, CORE).length, 0), m = (list: any[]) => list.reduce((a, x) => a + missing(x, CORE).length, 0);
  console.log(`${c} | ${b.filter(reviewed).length} of ${b.filter((x) => x.ok).length} > ${r.filter(reviewed).length} of ${published.length} | ${oldRules} | ${w(b)} > ${w(r)} | ${w(b, (x) => !reviewed(x))} > ${w(r, (x) => !reviewed(x))} | ${m(b)} > ${m(r)}`);
}
const left = rows.filter((r) => reviewed(byPath.get(r.path)) && !reviewed(r)), joined = rows.filter((r) => !reviewed(byPath.get(r.path)) && reviewed(r)), stay = rows.filter((r) => reviewed(byPath.get(r.path)) && reviewed(r));
const leftClean = left.filter((r) => !wrong(r, CORE).length), leftWrong = left.filter((r) => wrong(r, CORE).length);
console.log(`\nleft review: ${left.length}. Core values all right or blank now: ${leftClean.length}. With a wrong core value now: ${leftWrong.length} (${pct(leftWrong.length, left.length)}).`);
console.log(`stayed in review: ${stay.length}. newly sent for review: ${joined.length}.`);
const sent = rows.filter(reviewed), sentWithWrong = sent.filter((r) => wrong(r, CORE).length), silent = rows.filter((r) => !reviewed(r) && wrong(r, CORE).length);
console.log(`after: of ${sent.length} sent for review, ${sentWithWrong.length} hold a wrong core value (the rest ask a person to look where nothing is wrong, or something is only blank). ${silent.length} documents hold a wrong core value and are NOT sent for review.`);
console.log("\nwrong values by field, before > after (not sent for review, before > after)");
for (const f of ALL) { const n = (list: any[], only = (_: any) => true) => list.filter(only).reduce((a, x) => a + wrong(x, [f]).length, 0), b = rows.map((r) => byPath.get(r.path)); console.log(`${f.slice(0, 44).padEnd(45)} ${n(b)} > ${n(rows)}   (${n(b, (x) => !reviewed(x))} > ${n(rows, (x) => !reviewed(x))})`); }
if (silent.length) { console.log("\nwrong core values not sent for review:"); for (const r of silent.slice(0, 30)) for (const c of wrong(r, CORE)) console.log(`  ${r.condition} ${r.id} ${c.field}: expected ${c.expected} got ${c.got}`); }
