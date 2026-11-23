// Which model scores like a recruiter (owner, 9 Nov 2026: the platform's scorer must "behave exactly the same" as Claude answering in chat): the same job, read
// once by each model into its brief, and the same CVs, each read in full beside the dated roles, scored by each model through the functions live uses.
// Prints, per model and CV: score, confidence, career, each must-have's state, strengths, gaps, time and cost. CVs stay on this Mac; output goes to the terminal.
//   set -a; . ~/.rolematch/ai.env; set +a; node --import tsx test/collection/aiPairEval.ts <job file> <model,model> <cv file or real-cv id> [...]
import { readFileSync } from "node:fs";
import { jobKeyOf, jobTextOf, readJob } from "../../src/aiJobRead";
import { aiScore, factsOf, passagesOf } from "../../src/aiMatch";
import { extractCandidate } from "../../src/extract";
import { readJobAsLive } from "./liveJob";
import { sniff } from "../../src/formats";
import { assess } from "../../src/match";
import { readDocument } from "../../src/parse";

const [jobFile, modelList, ...cvs] = process.argv.slice(2), models = modelList.split(",");
const PRICE: Record<string, [number, number]> = { "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
const textOf = async (f: string) => { const b = new Uint8Array(readFileSync(f)); return (await readDocument(b, sniff(b)!, {})).text; };
const cache = JSON.parse(readFileSync("data/real-cvs/keys/text-cache.json", "utf8"));
const advert = await textOf(jobFile), job = await readJobAsLive(advert), text = jobTextOf(job, advert), asOf = new Date("2026-11-09T00:00:00Z");
const people = await Promise.all(cvs.map(async (c) => { const t = c.includes("/") ? await textOf(c) : String(Object.entries<any>(cache).find(([id]) => id.startsWith(c))?.[1]?.text ?? ""); return { name: c.includes("/") ? c.split("/").pop()!.replace(/\.\w+$/, "") : c, text: t, record: { ...(await extractCandidate(t)).record, id: c } as any }; }));
let total = 0;
for (const model of models) {
  const [pin, pout] = PRICE[model] ?? [2, 10], usd = (i: number, o: number) => (i * pin + o * pout) / 1e6;
  const t0 = performance.now(), reading = await readJob(job, text, jobKeyOf("job", text), "evaluation", model);
  if ("failed" in reading) { console.log(`${model}: the job could not be read: ${reading.failed}`); continue; }
  const must = reading.requirements.filter((r) => r.importance === "must_have");
  console.log(`\n=== ${model}: job read in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${reading.requirements.length} requirements, ${must.length} must-haves; seniority ${reading.brief?.seniority}; ${reading.requirements.filter((r) => r.fair === false).length} not scored for fairness`);
  console.log(`    must-haves: ${must.map((r) => r.requirement).join(" | ")}`);
  await Promise.all(people.map(async (p) => {
    const facts = assess(p.record, job, p.text, asOf), passages = passagesOf(p.record, asOf, p.text);
    const r = await aiScore(p.record, job, reading, passages, factsOf(facts.experienceYears), "evaluation", model), cost = usd(r.cost.promptTokens, r.cost.outTokens); total += cost;
    if (!r.ok) { console.log(`  ${p.name}: NOT SCORED (${r.why.slice(0, 120)})`); return; }
    const s = r.scored, by = new Map(s.requirements.map((x) => [x.id, x])), label = (id: string) => reading.requirements.find((x) => x.id === id)?.requirement ?? id;
    console.log(`\n  ${p.name}: ${s.score}%  confidence ${s.confidence}  (${(r.ms / 1000).toFixed(0)} s, $${cost.toFixed(3)})`);
    console.log(`    career: seniority ${s.career?.seniority}, industry ${s.career?.industry}, recency ${s.career?.recency}. ${s.career?.note}`);
    console.log(`    must-haves: ${must.map((m) => `${by.get(m.id)?.state ?? "?"}${by.get(m.id)?.inferred ? "(inferred)" : ""}`).join(", ")}`);
    console.log(`    strengths: ${s.strengths.map(label).join(" | ")}`);
    console.log(`    gaps: ${s.gaps.map((id) => `${label(id)} [${by.get(id)?.state}]`).join(" | ")}`);
    console.log(`    summary: ${s.summary}`);
  }));
}
console.log(`\nAbout $${total.toFixed(2)} for the scoring (job readings extra, small).`);
process.exit(0);
