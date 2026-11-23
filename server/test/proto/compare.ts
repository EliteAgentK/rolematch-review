// Runs the identity prototype beside the current parser on the same documents and the same checked answers (the owner's fictional Visual Variety 60 pack). Offline only: nothing here touches the running
// application or publishes anything. The current parser's results are read from its stored run, so its work is not repeated.
// Usage: node --import tsx test/proto/compare.ts <pack directory> <current parser's stored run> <output name> [--no-layout]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { identityFields, readIdentity } from "../../src/docmodel/identity";
import { buildDocModel } from "../../src/docmodel/model";
import { extractionConfig, extractionConfigFingerprint } from "../../src/extractionConfig";
import { sniff } from "../../src/formats";
import { stopOcr } from "../../src/ocr";

const [pack, currentRun, outName] = process.argv.slice(2), EVAL = join(import.meta.dirname, "..", "..", "data", "evaluations", "visual60-b1");
const roles = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "assessment", "batches", "visual60-b1", "splits-v3.json"), "utf8")).roles as Record<string, string>;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(pack).filter((p) => !p.includes("/Reference/") && !p.includes("/Jobs/") && /CV\d{4}\.(docx|pdf|txt)$/i.test(p)).sort();
const norm = { name: (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim(), email: (s: string) => String(s ?? "").toLowerCase().trim(), phone: (s: string) => String(s ?? "").replace(/\D/g, "").replace(/^27/, "0") };
type Field = keyof typeof norm;
const blank = () => ({ correct: 0, wrong: 0, reversed: 0, missing: 0, total: 0 });
const tally: Record<string, Record<string, ReturnType<typeof blank>>> = { current: {}, prototype: {}, prototypeNoLayout: {} };
const docs = { current: { accepted: 0, refused: 0, review: 0 }, prototype: { nameSelected: 0, nameAbstained: 0 }, prototypeNoLayout: { nameSelected: 0, nameAbstained: 0 } } as any;
const ms: Record<string, Record<string, number[]>> = { current: {}, prototype: {} };
const rows: any[] = [];
const count = (who: string, group: string, field: Field, expected: string, got: string) => {
  for (const key of [`${group}|${field}`, `all|${field}`]) {
    const t = (tally[who][key] ??= blank()); t.total++;
    const a = norm[field](got), e = norm[field](expected);
    if (!a) t.missing++; else if (a === e) t.correct++; else if (field === "name" && a.split(" ").sort().join(" ") === e.split(" ").sort().join(" ")) t.reversed++; else t.wrong++;
  }
};
for (const p of files) {
  const rel = relative(pack, p), id = rel.match(/CV\d{4}/)![0], format = rel.split("/")[0].replace(/^\d+_/, ""), split = roles[id] ?? "unknown";
  const exp = JSON.parse(readFileSync(join(pack, "Reference", "Expected_CVs", `${id}.json`), "utf8"));
  const expected = { name: exp.full_name ?? exp.name ?? "", email: exp.email ?? exp.contact?.email ?? "", phone: exp.phone ?? exp.contact?.phone ?? "" };
  const cur = JSON.parse(readFileSync(join(EVAL, currentRun, "docs", rel.replace(/[\\/]/g, "__") + ".json"), "utf8"));
  const bytes = new Uint8Array(readFileSync(p)), t0 = performance.now(), model = await buildDocModel(bytes, sniff(bytes)!), withLayout = readIdentity(model), elapsed = performance.now() - t0, noLayout = readIdentity(model, { useLayout: false });
  const a = identityFields(withLayout), b = identityFields(noLayout), c = { fullName: cur.record?.name ?? "", email: cur.record?.email ?? "", phone: cur.record?.phone ?? "" };
  docs.current[cur.ok ? "accepted" : "refused"]++; if (cur.review?.state === "needs_review") docs.current.review++;
  docs.prototype[withLayout.name.status === "selected" ? "nameSelected" : "nameAbstained"]++; docs.prototypeNoLayout[noLayout.name.status === "selected" ? "nameSelected" : "nameAbstained"]++;
  for (const group of [`${split}|${format}`]) for (const [field, key] of [["name", "fullName"], ["email", "email"], ["phone", "phone"]] as const) { count("current", group, field, expected[field], c[key]); count("prototype", group, field, expected[field], a[key]); count("prototypeNoLayout", group, field, expected[field], b[key]); }
  (ms.current[format] ??= []).push(cur.ms); (ms.prototype[format] ??= []).push(elapsed);
  rows.push({ rel, split, format, expectedEmail: expected.email, expectedPhone: expected.phone, email: { current: c.email, prototype: a.email }, phone: { current: c.phone, prototype: a.phone }, contacts: withLayout.contacts.slice(0, 4).map((x) => [x.kind, x.value, x.owner, x.source]), expectedName: expected.name, current: c.fullName, prototype: a.fullName, noLayout: b.fullName, status: withLayout.name.status, reason: withLayout.name.reason ?? null, score: withLayout.name.score ?? null, top: withLayout.nameCandidates.slice(0, 3).map((x) => [x.value, x.score]) });
}
await stopOcr();
const median = (x: number[]) => { const s = [...x].sort((m, n) => m - n); return Math.round(s[Math.floor(s.length / 2)] ?? 0); };
const result = { files: files.length, extractionConfig: `${extractionConfig.version} ${extractionConfigFingerprint}`, tally, docs, latencyMs: Object.fromEntries(Object.keys(ms.prototype).map((f) => [f, { current: median(ms.current[f]), prototype: median(ms.prototype[f]) }])), rows };
writeFileSync(join(EVAL, `proto-${outName}.json`), JSON.stringify(result, null, 1));
const show = (who: string, k: string) => { const t = tally[who][k]; return t ? `${t.correct}/${t.wrong + t.reversed}/${t.missing}` : "-"; };
console.log(`files ${files.length}. Each cell: correct/wrong/missing. Wrong includes the right words in reversed order.`);
const keys = [...new Set(Object.keys(tally.current))].sort();
console.log("group|field".padEnd(38), "current".padEnd(14), "prototype".padEnd(14), "no layout");
for (const k of keys) console.log(k.padEnd(38), show("current", k).padEnd(14), show("prototype", k).padEnd(14), show("prototypeNoLayout", k));
console.log("documents", JSON.stringify(docs)); console.log("median ms per format", JSON.stringify(result.latencyMs));
