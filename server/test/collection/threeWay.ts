// The parser alone, Claude alone, and both together (as live reads), side by side on the 30 real CVs with checked answer keys (owner, 10 Nov 2026: "a
// side by side comparison of the parser being used, the AI being used and both being used for the entire CVs"). Each original is read from its file
// exactly as a live upload is (prepareDocument: text, OCR, the parser, identity; free), then by Claude through live's own path (the reading, the contact
// check, the summary and department questions; code checks every value against the document; the two readings reconciled). "Claude alone" is the same
// whole-document answer with no parser roles or education to reconcile against, so it costs nothing more. Writes data/real-cvs/candidate/<run>,
// <run>-parser and <run>-ai-alone for scoreReal.py, plus <run>-detail.json (each method's roles and certificates per CV, for the side-by-side). CVs and
// outputs stay on this Mac (data/ is git-ignored).
//   ROLEMATCH_ENV_FILE=/dev/null <local settings> ANTHROPIC_API_KEY=... node --import tsx test/collection/threeWay.ts <run> <originals.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { READ_MODEL, spentThisMonthUsd } from "../../src/ai/claude";
import { askAi, contactFromModel, hybridRead } from "../../src/hybridReader";
import { READER_PROMPT_VERSION } from "../../src/modelReader";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { mergeReading } from "../../src/reconcile";
import { defaultSettings } from "../../src/settings";

const [run, originalsFile] = process.argv.slice(2), where = JSON.parse(readFileSync(originalsFile, "utf8")) as Record<string, string>;
const OUT = join("data", "real-cvs", "candidate"), before = await spentThisMonthUsd();
const rows: any[] = [], parserRows: any[] = [], aloneRows: any[] = [], detail: any[] = [];
const roleLine = (r: any) => [r.position, r.company, r.startDate, r.endDate].map((x) => String(x ?? "").trim()).join(" | ");
const AT_ONCE = Number(process.env.AT_ONCE ?? 4), ids = Object.keys(where), t0 = performance.now();
for (let i = 0; i < ids.length; i += AT_ONCE) {
  await Promise.all(ids.slice(i, i + AT_ONCE).map(async (id) => {
    const p: any = await prepareDocument(new Uint8Array(readFileSync(where[id])), { kind: "cv", org: defaultSettings(), asOf: new Date("2026-11-10T00:00:00Z") });
    if (!p.ok) { console.log(id, "not read:", p.code); return; }
    const draft = { record: p.record, meta: p.meta }, text = p.text, ms = 120_000;
    const ask = askAi([String(draft.record.name ?? "")].filter((n) => n.trim()), "evaluation");   // one ask per CV: a question asked again is answered once
    const [read, contact] = await Promise.all([
      hybridRead(ask, text, draft.record.workHistory ?? [], { timeoutMs: ms, pageStarts: draft.meta?.pageStarts, rulesEducation: (draft.record.education ?? []).map((e: any) => String(e.degree ?? "")) }),
      contactFromModel(ask, text, draft.record, ms),
    ]);
    const both = read.reading ? mergeReading(draft.record, { ...read, contact, text }, { model: READ_MODEL, promptVersion: READER_PROMPT_VERSION, ms: 0 }) : draft.record;
    const alone = await hybridRead(ask, text, [], { maxRegions: 0, timeoutMs: ms });
    const aiOnly = alone.reading ? mergeReading({ ...draft.record, workHistory: [], education: [], certifications: [], skills: [] }, { ...alone, contact, text }, { model: READ_MODEL, promptVersion: READER_PROMPT_VERSION, ms: 0 }) : {};
    rows.push({ id, ok: true, record: both }); parserRows.push({ id, ok: true, record: draft.record }); aloneRows.push({ id, ok: true, record: aiOnly });
    const shape = (r: any) => ({
      name: r.name ?? "", roles: (r.workHistory ?? []).map(roleLine), certificates: (r.certifications ?? []).map(String),
      education: (r.education ?? []).filter((e: any) => e.type !== "certificate").map((e: any) => String(e.degree ?? "")),
      certsInEducation: (r.education ?? []).filter((e: any) => e.type === "certificate").map((e: any) => String(e.degree ?? "")), skills: (r.skills ?? []).length,
    });
    detail.push({ id, methods: { parser: shape(draft.record), ai: shape(aiOnly), both: shape(both) } });
    console.log(id, read.reading ? "read" : "NO READING", "questions", read.trace.calls);
  }));
}
for (const [suffix, list] of [["", rows], ["-parser", parserRows], ["-ai-alone", aloneRows]] as const) writeFileSync(join(OUT, `${run}${suffix}.json`), JSON.stringify({ commit: `${run}${suffix}`, rows: list }));
writeFileSync(join(OUT, `${run}-detail.json`), JSON.stringify(detail, null, 1));
console.log(`\n${rows.length} CVs in ${((performance.now() - t0) / 1000).toFixed(0)} s. About $${((await spentThisMonthUsd()) - before).toFixed(4)}.`);
await stopOcr?.(); process.exit(0);
