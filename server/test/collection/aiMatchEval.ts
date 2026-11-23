// The AI-only matching measured before release (owner, 9 Nov 2026: "only AI matching ... deep thinking"; a score is final per pair): Claude reads each job once,
// then scores real CVs against it with deep thinking, through the very functions live uses (aiJobRead.ts, aiMatch.ts). Prints time, cost, the scores, and how
// steady a score is when the same pair is asked again (live asks once and keeps the answer; the spread says how much a different moment would have moved it).
// The CVs are the AI-read records of the 30 real CVs (data/real-cvs/candidate/<run>.json), so what is scored is what live would hold. Opaque ids only.
//   set -a; . ~/.rolematch/ai.env; set +a; node --import tsx test/collection/aiMatchEval.ts <job file> <how many CVs> <how many asked three times> [<job file> …]
import { readFileSync } from "node:fs";
import { jobKeyOf, jobTextOf, readJob } from "../../src/aiJobRead";
import { aiScore, factsOf, passagesOf } from "../../src/aiMatch";
import { readJobAsLive } from "./liveJob";
import { sniff } from "../../src/formats";
import { assess } from "../../src/match";
import { readDocument } from "../../src/parse";

const args = process.argv.slice(2), RUN = process.env.READ_RUN ?? "haiku-low-par";
const people = (JSON.parse(readFileSync(`data/real-cvs/candidate/${RUN}.json`, "utf8")).rows as any[]).sort((a, b) => (a.id < b.id ? -1 : 1));
const texts = JSON.parse(readFileSync("data/real-cvs/keys/text-cache.json", "utf8"));
const usd = (inTok: number, outTok: number) => (inTok * 2 + outTok * 10) / 1e6;
let allIn = 0, allOut = 0;
for (let a = 0; a < args.length; a += 3) {
  const [file, n, again] = [args[a], Number(args[a + 1] ?? 10), Number(args[a + 2] ?? 0)];
  const bytes = new Uint8Array(readFileSync(file)), advert = (await readDocument(bytes, sniff(bytes)!, {})).text, job = await readJobAsLive(advert);
  const text = jobTextOf(job, advert), t0 = performance.now(), reading = await readJob(job, text, jobKeyOf("job", text), "evaluation");
  if ("failed" in reading) { console.log(`JOB could not be read: ${reading.failed}`); continue; }
  console.log(`\nJOB "${job.title}": ${reading.requirements.length} requirements (${reading.requirements.filter((r) => r.mandatory).length} mandatory), ${reading.dropped} dropped by the quote check, read in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const chosen = people.slice(0, n), asOf = new Date("2026-11-09T00:00:00Z"), rows: { id: string; scores: number[]; conf: string; s: number[]; usd: number[]; counts: string }[] = [];
  await Promise.all(chosen.map(async (p, i) => {
    const facts = assess(p.record, job, texts[p.id]?.text ?? "", asOf), passages = passagesOf(p.record, asOf, texts[p.id]?.text ?? ""), row = { id: p.id.slice(0, 9), scores: [] as number[], conf: "", s: [] as number[], usd: [] as number[], counts: "" };
    for (let k = 0; k < (i < again ? 3 : 1); k++) {
      const r = await aiScore(p.record, job, reading, passages, factsOf(facts.experienceYears), "evaluation");
      allIn += r.cost.promptTokens; allOut += r.cost.outTokens; row.s.push(r.ms / 1000); row.usd.push(usd(r.cost.promptTokens, r.cost.outTokens));
      if (!r.ok) { row.scores.push(NaN); row.conf = r.why.slice(0, 80); continue; }
      row.scores.push(r.scored.score); row.conf = r.scored.confidence;
      const c = (st: string) => r.scored.requirements.filter((x) => x.state === st).length;
      row.counts = `${c("verified")} met, ${c("partial")} partly, ${c("not_demonstrated")} not shown, ${c("contradicted")} contradicted`;
    }
    rows.push(row);
  }));
  rows.sort((x, y) => (y.scores[0] || -1) - (x.scores[0] || -1));
  console.log("  candidate   score(s)      confidence  seconds      cost      requirements");
  for (const r of rows) console.log(`  ${r.id}  ${r.scores.join(", ").padEnd(12)}  ${r.conf.padEnd(10)}  ${r.s.map((x) => x.toFixed(0)).join(", ").padEnd(11)}  $${(r.usd.reduce((x, y) => x + y, 0) / r.usd.length).toFixed(3)}    ${r.counts}`);
  const spreads = rows.filter((r) => r.scores.length > 1).map((r) => Math.max(...r.scores) - Math.min(...r.scores));
  if (spreads.length) console.log(`  asked three times: spread of the score ${spreads.join(", ")} points`);
  const secs = rows.flatMap((r) => r.s).sort((x, y) => x - y);
  console.log(`  seconds per score: median ${secs[Math.floor(secs.length / 2)].toFixed(0)}, slowest ${secs[secs.length - 1].toFixed(0)}`);
}
console.log(`\nTokens ${allIn} in, ${allOut} out: about $${usd(allIn, allOut).toFixed(2)} for scoring (job readings extra, small).`);
process.exit(0);
