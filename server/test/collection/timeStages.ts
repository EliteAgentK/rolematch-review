// Where one CV's time goes on today's path (plan G.9, 10 Nov 2026): the file into text (and the parser's rules), then Claude's reading as live asks for it
// (the reading, the summary and the contact details side by side; then the department and any unclear places; src/hybridReader.ts). Per document: seconds
// for each part, how many questions Claude was asked, and how much it wrote, since writing is where its time goes. Prints medians by kind of file and
// writes data/real-cvs/candidate/<run>-timing.json. CVs and outputs stay on this Mac (data/ is git-ignored).
//   ROLEMATCH_ENV_FILE=/dev/null <local settings> ANTHROPIC_API_KEY=... node --import tsx test/collection/timeStages.ts <run> <originals.json> [more.json]
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { spentThisMonthUsd } from "../../src/ai/claude";
import { askAi, contactFromModel, hybridRead } from "../../src/hybridReader";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";

const [run, ...lists] = process.argv.slice(2);
const where: Record<string, string> = Object.assign({}, ...lists.map((f) => JSON.parse(readFileSync(f, "utf8"))));
const before = await spentThisMonthUsd(), rows: any[] = [], ids = Object.keys(where), AT_ONCE = Number(process.env.AT_ONCE ?? 4);
for (let i = 0; i < ids.length; i += AT_ONCE) {
  await Promise.all(ids.slice(i, i + AT_ONCE).map(async (id) => {
    const t0 = performance.now();
    const p: any = await prepareDocument(new Uint8Array(readFileSync(where[id])), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-10T00:00:00Z") });
    const prepareS = (performance.now() - t0) / 1000;
    if (!p.ok) { rows.push({ id, type: extname(where[id]).toLowerCase(), ok: false, code: p.code, prepareS }); return; }
    const draft = { record: p.record, meta: p.meta }, text: string = p.text, ms = 120_000, t1 = performance.now();
    const ask = askAi([String(draft.record.name ?? "")].filter((n) => n.trim()), "evaluation");
    const [read] = await Promise.all([
      hybridRead(ask, text, draft.record.workHistory ?? [], { timeoutMs: ms, pageStarts: draft.meta?.pageStarts, rulesEducation: (draft.record.education ?? []).map((e: any) => String(e.degree ?? "")) }),
      contactFromModel(ask, text, draft.record, ms),
    ]);
    rows.push({ id, type: extname(where[id]).toLowerCase(), ok: !!read.reading, ocr: !!p.meta?.viaOcr, lines: text.split("\n").length, chars: text.length, prepareS, claudeS: (performance.now() - t1) / 1000,
      calls: read.trace.calls, regions: read.trace.regions, outTokens: read.trace.cost.outTokens, promptTokens: read.trace.cost.promptTokens });
    console.log(id, rows.at(-1).ok ? "read" : "NO READING", `${prepareS.toFixed(1)} s + ${rows.at(-1).claudeS.toFixed(1)} s`);
  }));
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : 0; };
const read = rows.filter((r) => r.ok);
const line = (name: string, rs: any[]) => console.log(`${name.padEnd(18)} n=${String(rs.length).padStart(2)}  file to text: median ${median(rs.map((r) => r.prepareS)).toFixed(1)} s (90%: ${p90(rs.map((r) => r.prepareS)).toFixed(1)})  Claude: median ${median(rs.map((r) => r.claudeS)).toFixed(1)} s (90%: ${p90(rs.map((r) => r.claudeS)).toFixed(1)})  questions ${median(rs.map((r) => r.calls))}  written ${median(rs.map((r) => r.outTokens))} tokens`);
console.log("");
line("all read", read); line("Word", read.filter((r) => r.type === ".docx")); line("PDF with text", read.filter((r) => r.type === ".pdf" && !r.ocr)); line("PDF scanned (OCR)", read.filter((r) => r.type === ".pdf" && r.ocr));
const spent = (await spentThisMonthUsd()) - before;
console.log(`\nSeconds per 1,000 tokens written: ${(1000 * median(read.map((r) => r.claudeS / Math.max(1, r.outTokens)))).toFixed(1)}. Not read: ${rows.filter((r) => !r.ok).map((r) => `${r.id} (${r.code ?? "no reading"})`).join(", ") || "none"}.`);
console.log(`About $${spent.toFixed(4)} for ${rows.length} documents.`);
writeFileSync(join("data", "real-cvs", "candidate", `${run}-timing.json`), JSON.stringify({ run, spentUsd: spent, rows }, null, 1));
await stopOcr?.(); process.exit(0);
