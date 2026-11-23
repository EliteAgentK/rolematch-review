// The AI-extraction test the owner asked for (8 Nov 2026: "we need to test this before making any decisions"): the 30 real CVs read by the parser and
// Claude Haiku 5.5 together through the hybrid reader (code checks every value against the document and reconciles the two readings), timed per CV.
// Writes data/real-cvs/candidate/<run>.json for scoreReal.py, and prints seconds, tokens and cost. CVs stay on this Mac; output is ids and counts only.
//   ANTHROPIC_API_KEY=… node --import tsx test/collection/aiReadEval.ts <run> [effort] [nothink]      effort: low (default) | medium; nothink: Haiku answers without thinking
// SET=data/packs/vv reads another test set's text-cache.json and writes to its candidate/ folder. Each run also writes <run>-parser (the parser alone, free)
// and <run>-ai-alone (the model's own reading without the parser's roles, from the same cached answer, free) for comparison.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askClaude, READ_MODEL } from "../../src/ai/claude";
import { contactFromModel, hybridRead, type Ask } from "../../src/hybridReader";
import { READER_PROMPT_VERSION } from "../../src/modelReader";
import { mergeReading } from "../../src/reconcile";
import { parseCv } from "../../src/rules";

const [run, effortArg, thinkArg] = process.argv.slice(2), effort = (effortArg ?? "low") as "low" | "medium", think = thinkArg !== "nothink", P = process.env.SET ?? "data/real-cvs";
const cache = JSON.parse(readFileSync(join(P, P === "data/real-cvs" ? "keys/text-cache.json" : "text-cache.json"), "utf8")), ids = Object.keys(cache);
mkdirSync(join(P, "candidate"), { recursive: true });
let inTok = 0, outTok = 0, calls = 0, refusals = 0;
const rows: any[] = [], parserRows: any[] = [], aloneRows: any[] = [], secs: number[] = [];
const AT_ONCE = Number(process.env.AT_ONCE ?? 6), t0 = performance.now();
for (let i = 0; i < ids.length; i += AT_ONCE) {
  await Promise.all(ids.slice(i, i + AT_ONCE).map(async (id) => {
    const c = cache[id], start = performance.now(), rules = parseCv(c.text), names = [String(rules.name ?? c.record?.name ?? "")];
    // The same question asked twice (the reader asks some again) is answered once.
    const answered = new Map<string, Promise<any>>();
    const ask: Ask = (o) => { const key = JSON.stringify([o.system, o.user]); if (!answered.has(key)) answered.set(key, askClaude({ model: READ_MODEL, effort, think, system: o.system, user: o.user, schema: o.schema, maxTokens: Math.max(4000, o.maxTokens * 3), timeoutMs: 60_000, names, purpose: "evaluation" }).then((a) => { calls++; inTok += a.cost?.promptTokens ?? 0; outTok += a.cost?.outTokens ?? 0; if (!a.ok) { refusals++; if (process.env.WHY) console.log("refused:", a.why, a.detail); } return a; })); return answered.get(key)!; };
    const record = { ...c.record, workHistory: rules.workHistory, education: rules.education?.map((e: any) => ({ degree: e.qualification, institution: e.institution, year: e.year })) };
    // The contact check and the reading are asked at the same time.
    const [read, contact] = await Promise.all([hybridRead(ask, c.text, rules.workHistory ?? [], { rulesEducation: (rules.education ?? []).map((e: any) => String(e.qualification ?? "")), timeoutMs: 60_000 }), contactFromModel(ask, c.text, record, 60_000)]);
    const s = (performance.now() - start) / 1000; secs.push(s);
    rows.push({ id, ok: true, record: mergeReading(record, { ...read, contact, text: c.text }, { model: READ_MODEL, promptVersion: READER_PROMPT_VERSION, ms: Math.round(read.trace.ms) }) });
    parserRows.push({ id, ok: true, record: c.record });
    // The model alone: the same whole-document answer (already asked, so free), with no parser roles or education to reconcile against.
    const alone = await hybridRead(ask, c.text, [], { maxRegions: 0, timeoutMs: 60_000 });
    aloneRows.push({ id, ok: true, record: mergeReading({ ...record, workHistory: [], education: [] }, { ...alone, contact, text: c.text }, { model: READ_MODEL, promptVersion: READER_PROMPT_VERSION, ms: Math.round(alone.trace.ms) }) });
    console.log(id.slice(0, 9), read.employment.state, "calls", read.trace.calls, "s", s.toFixed(1));
  }));
}
writeFileSync(join(P, `candidate/${run}.json`), JSON.stringify({ commit: run, rows }));
writeFileSync(join(P, `candidate/${run}-parser.json`), JSON.stringify({ commit: `${run}-parser`, rows: parserRows }));
writeFileSync(join(P, `candidate/${run}-ai-alone.json`), JSON.stringify({ commit: `${run}-ai-alone`, rows: aloneRows }));
const sorted = [...secs].sort((a, b) => a - b), usd = (inTok * 0.1 + outTok * 0.5) / 1e6;
console.log(`\n${rows.length} CVs in ${((performance.now() - t0) / 1000).toFixed(0)} s (${AT_ONCE} at a time). Per CV: median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} s, slowest ${sorted.at(-1)!.toFixed(1)} s.`);
console.log(`${calls} questions, ${refusals} without a usable answer. Tokens: ${inTok} in, ${outTok} out. Cost about $${usd.toFixed(4)} (R${(usd * 18).toFixed(2)}), $${(usd / rows.length).toFixed(5)} per CV.`);
process.exit(0);
