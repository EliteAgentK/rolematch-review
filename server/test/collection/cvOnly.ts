// The CV reading that is Claude's alone (src/cvReader.ts), measured on real CVs against their checked answer keys and against live's reading of the same
// documents (plan: docs/architecture/PLAN_CV_READING_CLAUDE_ONLY.md, the pass bar). Each original is turned into text exactly as an upload is
// (prepareDocument: type, size, text, OCR, reading order), then read by readCv, the function live calls. Writes data/real-cvs/candidate/<run>.json for
// scoreReal.py and <run>-timing.json (seconds and questions per document). With TWICE=1 every document is read a second time and <run>-b.json is written
// too, for the agreement of two readings (test/collection/agreement.py). CVs and outputs stay on this Mac (data/ is git-ignored).
//   ROLEMATCH_ENV_FILE=/dev/null <local settings> ANTHROPIC_API_KEY=... node --import tsx test/collection/cvOnly.ts <run> <originals.json> [more.json]
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { spentThisMonthUsd } from "../../src/ai/claude";
import { readCv } from "../../src/cvReader";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const [run, ...lists] = process.argv.slice(2), twice = process.env.TWICE === "1";
const where: Record<string, string> = Object.assign({}, ...lists.map((f) => JSON.parse(readFileSync(f, "utf8"))));
const OUT = join("data", "real-cvs", "candidate"), before = await spentThisMonthUsd(), asOf = new Date("2026-11-10T00:00:00Z");
const rows: any[] = [], rowsB: any[] = [], timing: any[] = [], ids = Object.keys(where), AT_ONCE = Number(process.env.AT_ONCE ?? 4);
for (let i = 0; i < ids.length; i += AT_ONCE) {
  await Promise.all(ids.slice(i, i + AT_ONCE).map(async (id) => {
    const t0 = performance.now();
    const p: any = await prepareDocument(new Uint8Array(readFileSync(where[id])), { kind: "cv", org: defaultSettings(), asOf, fieldsByAi: true });
    const prepareS = (performance.now() - t0) / 1000, type = extname(where[id]).toLowerCase();
    if (!p.ok) { console.log(id, "not read:", p.code); timing.push({ id, type, ok: false, code: p.code, prepareS }); return; }
    const once = async () => { const t = performance.now(), r = await readCv(p.text, { purpose: "evaluation", timeoutMs: 120_000, pageStarts: p.meta?.pageStarts, asOf }); return { r, s: (performance.now() - t) / 1000 }; };
    const a = await once();
    if (!a.r.ok) { console.log(id, "NO READING:", a.r.why); timing.push({ id, type, ok: false, code: a.r.why, prepareS, claudeS: a.s }); return; }
    rows.push({ id, ok: true, record: a.r.record, locations: a.r.locations });
    timing.push({ id, type, ok: true, ocr: !!p.meta?.viaOcr, prepareS, claudeS: a.s, questions: a.r.report.questions, lines: a.r.report.lines, unlabelled: a.r.report.unlabelled, other: a.r.report.other, labelled: a.r.report.labelled, notJobs: a.r.report.notJobs, boreOut: a.r.report.boreOut, secondLook: a.r.report.secondLook, wrote: a.r.report.wrote, outTokens: a.r.cost.outTokens });
    console.log(id, "read", `${prepareS.toFixed(1)} s + ${a.s.toFixed(1)} s`, a.r.report.notJobs.length ? `not jobs: ${a.r.report.notJobs.join(" | ")}` : "");
    if (twice) { const b = await once(); if (b.r.ok) rowsB.push({ id, ok: true, record: b.r.record }); }
  }));
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }, p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : 0; };
const read = timing.filter((r) => r.ok), spent = (await spentThisMonthUsd()) - before;
console.log(`\n${read.length} of ${ids.length} read. Claude: median ${median(read.map((r) => r.claudeS)).toFixed(1)} s (90%: ${p90(read.map((r) => r.claudeS)).toFixed(1)}), questions ${median(read.map((r) => r.questions))}, written ${median(read.map((r) => r.outTokens))} tokens. Lines left unlabelled: ${read.reduce((a, r) => a + r.unlabelled, 0)}; labelled "other": ${read.reduce((a, r) => a + r.other, 0)} of ${read.reduce((a, r) => a + r.lines, 0)}. Labels missing for ${read.filter((r) => !r.labelled).length} documents.`);
console.log(`Not read: ${timing.filter((r) => !r.ok).map((r) => `${r.id} (${r.code})`).join(", ") || "none"}. About $${spent.toFixed(4)} for ${ids.length} documents${twice ? ", each read twice" : ""}.`);
writeFileSync(join(OUT, `${run}.json`), JSON.stringify({ commit: run, rows }));
if (twice) writeFileSync(join(OUT, `${run}-b.json`), JSON.stringify({ commit: `${run}-b`, rows: rowsB }));
writeFileSync(join(OUT, `${run}-timing.json`), JSON.stringify({ run, spentUsd: spent, rows: timing }, null, 1));
await stopOcr?.(); process.exit(0);
