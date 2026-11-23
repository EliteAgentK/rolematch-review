// Real CVs the owner supplied for evaluating and improving the reader (handed over 2026-11-03; docs/parser/REAL_CV_EVALUATION.md). Runs on this machine only, through the application's own path, with no model.
// Everything personal stays in server/data/real-cvs/ (git-ignored, private to this user). What this prints is safe to share: opaque ids, counts, and layouts with every letter and digit masked.
// There is no answer key yet, so nothing here is accuracy. It reports SUSPECTS: what the text itself says should have been found and was not. A person's checked answers come later.
//   node --import tsx test/real/realCvs.ts inventory "<folder>"     once: gives each file an opaque id, groups by person, freezes development and untouched acceptance sets
//   node --import tsx test/real/realCvs.ts run <run id>             reads the development set; runs are immutable
//   node --import tsx test/real/realCvs.ts report <run id> [--vs <earlier run>]
//   node --import tsx test/real/realCvs.ts mask <run id> <id> [from] [to]    the masked layout of one document, for diagnosis
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { sniff } from "../../src/formats";
import { stopOcr } from "../../src/ocr";
import { readDocument } from "../../src/parse";
import { prepareDocument } from "../../src/prepare";
import {  } from "../../src/rules";
import { defaultSettings } from "../../src/settings";
import { extractionConfig, extractionConfigFingerprint } from "../../src/extractionConfig";
import { parserVersionLabel } from "../../src/version";

if (process.env.ANTHROPIC_API_KEY) throw new Error("Refusing: real CVs must not reach any outside service. Run with ANTHROPIC_API_KEY empty (ROLEMATCH_ENV_FILE=/dev/null).");
const PRIVATE = join(import.meta.dirname, "..", "..", "data", "real-cvs");
const AS_OF = new Date("2026-11-03T00:00:00Z"), SUPPORTED = new Set([".pdf", ".docx", ".doc", ".rtf", ".odt", ".txt"]);
const save = (p: string, v: unknown) => { writeFileSync(p, JSON.stringify(v, null, 1), { mode: 0o600 }); chmodSync(p, 0o600); };
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const NOISE = new Set(["cv", "resume", "curriculum", "vitae", "pdf", "docx", "doc", "the", "and", "of", "new", "final", "updated", "copy", "senior", "software", "engineer", "analyst", "security", "cyber", "agent"]);
const nameTokens = (file: string) => file.replace(extname(file), "").toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter((w) => w.length > 2 && !NOISE.has(w));

function inventory(folder: string) {
  const out = join(PRIVATE, "inventory.json");
  if (existsSync(out)) throw new Error("the inventory is frozen; it already exists");
  mkdirSync(PRIVATE, { recursive: true, mode: 0o700 }); chmodSync(PRIVATE, 0o700);
  const salt = randomBytes(16).toString("hex");
  const files = readdirSync(folder).filter((f) => !f.startsWith(".") && SUPPORTED.has(extname(f).toLowerCase())).sort();
  const docs = files.map((f) => { const bytes = readFileSync(join(folder, f)); const sha = createHash("sha256").update(bytes).digest("hex"); return { id: "RC-" + createHmac("sha256", salt).update(sha).digest("hex").slice(0, 6), file: f, sha256: sha, bytes: bytes.length, format: extname(f).slice(1).toLowerCase(), names: nameTokens(f) }; });
  // One person's documents stay on one side of the split: identical files, or file names sharing two or more name words.
  const parent = docs.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  docs.forEach((a, i) => docs.forEach((b, j) => { if (j > i && (a.sha256 === b.sha256 || a.names.filter((w) => b.names.includes(w)).length >= 2)) parent[find(i)] = find(j); }));
  const families = new Map<number, typeof docs>(); docs.forEach((d, i) => families.set(find(i), [...(families.get(find(i)) ?? []), d]));
  // A third of the people, chosen by a salted hash before anything is read, are never looked at while tuning. Word and PDF are balanced.
  const order = [...families.values()].map((f) => ({ f, key: createHmac("sha256", salt).update(f[0].id).digest("hex") })).sort((a, b) => a.key.localeCompare(b.key));
  const seen: Record<string, number> = {};
  const roles: Record<string, string> = {};
  for (const { f } of order) { const k = f[0].format; seen[k] = (seen[k] ?? 0) + 1; for (const d of f) roles[d.id] = seen[k] % 3 === 0 ? "acceptance" : "development"; }
  save(out, { createdAt: new Date().toISOString(), source: folder, salt, permittedUse: "evaluation and parser development on this machine; no model training without separate permission; no copies in Git, logs or outside services", docs: docs.map((d) => ({ ...d, role: roles[d.id] })) });
  const count = (r: string) => docs.filter((d) => roles[d.id] === r);
  console.log(`${docs.length} supported files, ${files.length === readdirSync(folder).filter((f) => !f.startsWith(".")).length ? "no" : "some"} unsupported; ${families.size} people or document families`);
  console.log(`development ${count("development").length}, untouched acceptance ${count("acceptance").length}; identical files ${docs.length - new Set(docs.map((d) => d.sha256)).size}`);
  const fmt = (l: typeof docs) => JSON.stringify(l.reduce<Record<string, number>>((a, d) => ({ ...a, [d.format]: (a[d.format] ?? 0) + 1 }), {}));
  console.log(`formats: development ${fmt(count("development"))}, acceptance ${fmt(count("acceptance"))}`);
}

// ---------------------------------------------------------------- what the text itself says should be there
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const heading = (t: string, re: RegExp) => lines(t).some((l) => l.length <= 45 && re.test(l));
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PHONE = /(?:\+?27|\b0)[\s()-]*\d{2}[\s()-]*\d{3}[\s-]*\d{4}\b/g;
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const RANGE = new RegExp(`(?:(?:${MONTH}\\s*)?(?:19|20)\\d{2}|\\d{1,2}[/.-](?:19|20)\\d{2})\\s*(?:-|–|—|to|until)\\s*(?:(?:${MONTH}\\s*)?(?:19|20)\\d{2}|\\d{1,2}[/.-](?:19|20)\\d{2}|present|current|date|now|today)`, "gi");
const HEAD = {
  skills: /\b(skills?|competenc|technical|technologies|expertise|tools)\b/i, experience: /\b(experience|employment|career|work history)\b/i,
  education: /\b(education|qualifications?|academic)\b/i, certifications: /\b(certifications?|certificates?|licen[cs]es?)\b/i, languages: /^languages?\b/i,
};
export function signals(row: any, doc: { names: string[]; format: string }) {
  const t: string = row.text ?? "", r = row.record ?? {}, low = t.toLowerCase();
  // Details an agency's block or letterhead carries are not expected in the candidate's record (E5), so they are not counted as missed.
  const agency = new Set<string>(), own = t.split("\n").filter((l) => !agency.has(l)).join("\n");
  const emails = [...new Set((own.match(EMAIL) ?? []).map((e) => e.toLowerCase()))], phones = (own.match(PHONE) ?? []).map((p) => p.replace(/\D/g, "").replace(/^27/, "0"));
  const ranges = (t.match(RANGE) ?? []).length, wh: any[] = r.workHistory ?? [];
  const fileNames = doc.names.filter((w) => low.includes(w)), recName = String(r.name ?? "").toLowerCase();
  const s: Record<string, boolean> = {
    "name disagrees with file name": fileNames.length > 0 && !fileNames.some((w) => recName.includes(w)),
    "e-mail in text, not extracted": emails.length > 0 && !r.email,
    "e-mail extracted is not in text": !!r.email && !emails.includes(String(r.email).toLowerCase()),
    "phone in text, not extracted": phones.length > 0 && !r.phone,
    "phone extracted is not in text": !!r.phone && !phones.includes(String(r.phone).replace(/\D/g, "").replace(/^27/, "0")) && !t.replace(/\D/g, "").includes(String(r.phone).replace(/\D/g, "")),
    "no location": !r.location,
    "skills heading, under 5 skills": heading(t, HEAD.skills) && (r.skills ?? []).length < 5,
    "experience heading, no roles": heading(t, HEAD.experience) && wh.length === 0,
    "fewer roles than half the date ranges": ranges >= 2 && wh.length < ranges / 2,
    "role without employer": wh.some((w) => !w.company),
    "role without title": wh.some((w) => !w.position),
    "role without dates": wh.some((w) => !w.startDate),
    "role without duties": wh.length > 0 && wh.filter((w) => !(w.responsibilities ?? []).length).length / wh.length > 0.5,
    "education heading, none found": heading(t, HEAD.education) && (r.education ?? []).length === 0,
    "certification heading, none found": heading(t, HEAD.certifications) && (r.certifications ?? []).length === 0,
    "language heading, none found": heading(t, HEAD.languages) && (r.languages ?? []).length === 0,
  };
  return { suspects: Object.keys(s).filter((k) => s[k]), counts: { words: t.split(/\s+/).filter(Boolean).length, dateRanges: ranges, roles: wh.length, skills: (r.skills ?? []).length, education: (r.education ?? []).length, certifications: (r.certifications ?? []).length, languages: (r.languages ?? []).length } };
}

async function run(runId: string) {
  const inv = load(join(PRIVATE, "inventory.json")), dir = join(PRIVATE, "runs", runId);
  if (existsSync(dir)) throw new Error(`run ${runId} exists: runs are immutable`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: import.meta.dirname, encoding: "utf8" }).trim();
  const meta = { runId, at: new Date().toISOString(), commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--", "src").length > 0, parser: parserVersionLabel(), experiments: process.env.PARSER_EXPERIMENTS ?? "", extractionConfig: `${extractionConfig.version} ${extractionConfigFingerprint}`, asOf: AS_OF.toISOString().slice(0, 10), model: "none" };
  const org = defaultSettings(), rows: any[] = [];
  for (const d of inv.docs.filter((x: any) => x.role === "development")) {
    const bytes = new Uint8Array(readFileSync(join(inv.source, d.file))), t0 = performance.now();
    let out: any;
    try { out = await Promise.race([prepareDocument(bytes, { kind: "cv", org, asOf: AS_OF }), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 180_000).unref())]); }
    catch (e) { out = { ok: false, stage: "crash", code: (e as Error)?.message === "timeout" ? "TIMEOUT" : "CRASH" }; }
    const row = { id: d.id, format: d.format, ms: Math.round(performance.now() - t0), rssMb: Math.round(process.memoryUsage().rss / 1048576), ...out };
    save(join(dir, `${d.id}.json`), row);
    rows.push({ id: d.id, format: d.format, ms: row.ms, rssMb: row.rssMb, ok: !!row.ok, code: row.code ?? null, stage: row.stage ?? null, method: row.meta?.method ?? null, ocr: (row.issues ?? []).some((i: string) => /by OCR/.test(i)), review: row.review?.state ?? null, confidence: row.confidence ?? null, reasons: (row.review?.reasons ?? []).length, ...(row.ok ? signals(row, d) : { suspects: [], counts: {} }) });
  }
  await stopOcr();
  save(join(dir, "summary.json"), { meta, rows });
  report(runId);
}

function report(runId: string, vs?: string) {
  const { meta, rows } = load(join(PRIVATE, "runs", runId, "summary.json")) as { meta: any; rows: any[] };
  const before = vs ? new Map((load(join(PRIVATE, "runs", vs, "summary.json")).rows as any[]).map((r) => [r.id, r])) : null;
  console.log(`run ${meta.runId}: commit ${meta.commit.slice(0, 8)}${meta.dirty ? " +local changes" : ""}, parser ${meta.parser}, experiments "${meta.experiments}", extraction config ${meta.extractionConfig ?? "none"}, model ${meta.model}, read as of ${meta.asOf}`);
  const ok = rows.filter((r) => r.ok), ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`documents ${rows.length}: accepted ${ok.length}, refused ${rows.length - ok.length}, needs review ${ok.filter((r) => r.review === "needs_review").length}; OCR used on ${rows.filter((r) => r.ocr).length}`);
  console.log(`time: median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms.at(-1)} ms; peak memory ${Math.max(...rows.map((r) => r.rssMb))} MB`);
  for (const r of rows.filter((x) => !x.ok)) console.log(`  refused ${r.id} (${r.format}) ${r.code} at ${r.stage}`);
  const tally: Record<string, number> = {}; for (const r of ok) for (const s of r.suspects) tally[s] = (tally[s] ?? 0) + 1;
  console.log(`\nsuspects across ${ok.length} accepted documents (the text says it should be there; NOT verified errors):`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
  console.log(`\nper document (id format ms | words ranges roles skills edu certs langs | suspects):`);
  for (const r of ok) console.log(`  ${r.id} ${r.format.padEnd(4)} ${String(r.ms).padStart(6)} | ${r.counts.words} ${r.counts.dateRanges} ${r.counts.roles} ${r.counts.skills} ${r.counts.education} ${r.counts.certifications} ${r.counts.languages} | ${r.suspects.length}${r.ocr ? " OCR" : ""}`);
  if (before) {
    const n = (l: any[], k: string) => l.filter((r) => r.suspects.includes(k)).length, was = [...before.values()];
    console.log(`\ncompared with ${vs}: accepted ${was.filter((r) => r.ok).length} -> ${ok.length}`);
    for (const k of new Set([...Object.keys(tally), ...was.flatMap((r) => r.suspects)])) { const a = n(was, k), b = n(rows, k); if (a !== b) console.log(`  ${k}: ${a} -> ${b}`); }
    for (const r of rows) { const w: any = before.get(r.id); const diffs = Object.keys(r.counts ?? {}).filter((k) => w?.counts?.[k] !== r.counts[k]); if (diffs.length) console.log(`  ${r.id}: ${diffs.map((k) => `${k} ${w?.counts?.[k]} -> ${r.counts[k]}`).join(", ")}`); }
  }
}

/** Every letter and digit hidden; the common headings a layout is recognised by are kept, so a fault can be diagnosed without anyone reading the person's details. */
const KEEP = /^(?:profile|summary|objective|experience|employment|history|work|career|professional|education|qualifications?|skills?|technical|key|core|competenc(?:y|ies)|certifications?|certificates?|languages?|references?|personal|details?|contact|projects?|achievements?|interests?|hobbies|responsibilities|duties|present|current|name|surname|address|email|e-mail|mail|phone|tel|cell|mobile|location|nationality|gender|date|birth|id|number|company|employer|position|role|title|period|from|to|and|of|the|consultant|recruiter|recruitment|account|manager|agency|candidate|applicant|contact|talent|sourced|submitted|presented|by|for|linkedin|client)$/i;
export const mask = (s: string) => s.replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (w) => (KEEP.test(w) ? w : w.replace(/\p{Lu}/gu, "X").replace(/\p{Ll}/gu, "x").replace(/\p{N}/gu, "9")));
async function showMask(runId: string, id: string, from = 0, to = 60) {
  const row = load(join(PRIVATE, "runs", runId, `${id}.json`));
  if (!row.text) { const inv = load(join(PRIVATE, "inventory.json")), d = inv.docs.find((x: any) => x.id === id); const bytes = new Uint8Array(readFileSync(join(inv.source, d.file))); row.text = (await readDocument(bytes, sniff(bytes)!, { pageCeiling: Number.POSITIVE_INFINITY })).text; await stopOcr(); }
  console.log(`${id}: ok ${row.ok} code ${row.code ?? "-"} ${row.format} words ${(row.text ?? "").split(/\s+/).length}`);
  lines(row.text ?? "").slice(from, to).forEach((l, i) => console.log(String(from + i).padStart(3), mask(l).slice(0, 110)));
}

/** Where the person's name sits, judged from the file name's words, shown masked with those words marked. Never prints the name. */
async function whereName(runId: string, onlyDisagreeing: boolean) {
  const inv = load(join(PRIVATE, "inventory.json")), { rows } = load(join(PRIVATE, "runs", runId, "summary.json"));
  for (const r of rows) {
    if (onlyDisagreeing ? !r.suspects.includes("name disagrees with file name") : r.ok) continue;
    const d = inv.docs.find((x: any) => x.id === r.id), row = load(join(PRIVATE, "runs", runId, `${r.id}.json`));
    if (!row.text) { const bytes = new Uint8Array(readFileSync(join(inv.source, d.file))); row.text = (await readDocument(bytes, sniff(bytes)!, { pageCeiling: Number.POSITIVE_INFINITY })).text; }
    const all = lines(row.text), words: string[] = d.names, hits = all.map((l, i) => ({ l, i })).filter(({ l }) => words.some((w) => l.toLowerCase().includes(w)));
    const mark = (l: string) => { let m = l; for (const w of words) m = m.replace(new RegExp(w, "gi"), "\u0001"); return mask(m).replace(/\u0001/g, "<N>"); };
    console.log(`${r.id}: extracted name ${row.record ? JSON.stringify(mask(row.record.name)) : "none"} of ${row.record?.name ? (all.findIndex((l) => l.includes(row.record.name)) + " line") : "-"}; file-name words ${words.length}; lines with them ${hits.length} of ${all.length}`);
    for (const h of hits.slice(0, 4)) console.log(`   ${String(h.i).padStart(3)} ${mark(h.l).slice(0, 96)}`);
  }
  await stopOcr();
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "inventory") inventory(a);
else if (cmd === "run") await run(a);
else if (cmd === "report") report(a, b === "--vs" ? c : undefined);
else if (cmd === "mask") await showMask(a, b, Number(c ?? 0), Number(process.argv[6] ?? 60));
else if (cmd === "where-name") await whereName(a, b === "--disagreeing");
else throw new Error("usage: inventory <folder> | run <id> | report <id> [--vs <id>] | mask <run> <id> [from] [to]");
