// Compares the built-in parser with a local AI model on a stratified sample of the messy-CV corpus.
// Usage: node --import tsx test/messy/aiBench.ts --model qwen3:8b --n 40 [--repeat 6]
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
process.env.EXTRACTOR = "ollama";
process.env.OLLAMA_MODEL = arg("model", "qwen3:8b");
process.env.DATABASE_URL ??= "postgresql://unused"; // config only; the benchmark never touches the database

const { extractCandidate } = await import("../../src/extract");
const { parseCv } = await import("../../src/rules");
const { loadCorpus, score, summarise } = await import("./eval");

const N = Number(arg("n", "40")), REPEAT = Number(arg("repeat", "0"));
const corpus = await loadCorpus();
// Even spread across the whole list, so every layout family and round is represented
const step = corpus.length / N;
const sample = Array.from({ length: N }, (_, i) => corpus[Math.floor(i * step)]);

const toParsed = (r: Awaited<ReturnType<typeof extractCandidate>>["record"]) => ({
  fullName: r.name, email: r.email, phone: r.phone, location: r.location, currentRole: r.role, summary: r.summary ?? "",
  skills: r.skills.map((name) => ({ name, quote: "" })),
  workHistory: r.workHistory.map((w) => ({ ...w, quote: "" })),
  education: (r.education ?? []).map((e) => ({ qualification: e.degree, institution: e.institution, period: e.year, quote: "" })),
  projects: [], worthNoting: [], certifications: r.certifications ?? [], languages: r.languages ?? [],
});

const aiRows: ReturnType<typeof score>[] = [], rulesRows: ReturnType<typeof score>[] = [];
const secs: number[] = [];
let failures = 0;
const keep: Record<string, string> = {};
for (const [i, c] of sample.entries()) {
  rulesRows.push(score(c.file, c.layout, c.persona, c.format, parseCv(c.text)));
  const t0 = performance.now();
  try {
    const ex = await extractCandidate(c.text);
    secs.push((performance.now() - t0) / 1000);
    keep[c.file] = JSON.stringify(ex.record);
    aiRows.push(score(c.file, c.layout, c.persona, c.format, toParsed(ex.record) as any));
  } catch (e: any) {
    failures++; secs.push((performance.now() - t0) / 1000);
    console.log(`  [${i + 1}/${N}] FAILED ${c.file}: ${String(e?.message ?? e).slice(0, 80)}`);
    continue;
  }
  if ((i + 1) % 5 === 0) console.log(`  [${i + 1}/${N}] avg ${(secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1)}s per CV`);
}
const ok = new Set(aiRows.map((r) => r.file));
const rulesSame = rulesRows.filter((r) => ok.has(r.file));
console.log(`\nMODEL ${process.env.OLLAMA_MODEL}  sample ${N}  failed ${failures}`);
console.log("RULES (same CVs)", JSON.stringify(summarise(rulesSame)));
console.log("AI                ", JSON.stringify(summarise(aiRows)));
const sorted = [...secs].sort((a, b) => a - b);
console.log(`TIME per CV: median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}s, slowest ${sorted[sorted.length - 1].toFixed(1)}s, total ${(secs.reduce((a, b) => a + b, 0) / 60).toFixed(1)} min`);
console.log("\nAI NON-PERFECT (first 25):");
for (const r of aiRows.filter((x) => !x.perfect).slice(0, 25)) console.log(`  ${r.file.padEnd(34)} ${r.reasons.join(" ; ").slice(0, 170)}`);

if (REPEAT > 0) {
  let same = 0;
  for (const c of sample.slice(0, REPEAT)) { const again = JSON.stringify((await extractCandidate(c.text)).record); if (again === keep[c.file]) same++; }
  console.log(`\nREPEATABILITY: ${same}/${REPEAT} CVs gave byte-identical output on a second run`);
}
