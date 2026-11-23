// Runs a supplied batch through the application's own document path (src/prepare.ts: type check → native text or OCR → extraction → validation and
// review flags), one document at a time, with no database. Every output, failure and resource figure is written to
// server/data/evaluations/<batch>/<run>/ (git-ignored). A run is immutable: an existing run directory is never overwritten.
// Usage (from server/): node --import tsx test/batch/run.ts <pack directory> <batch id> <run id> [--limit N] [--only CV0501,JD0151] [--formats docx,pdf,txt]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join, relative } from "node:path";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { ruleset, rulesetFingerprint } from "../../src/ruleset";
import { defaultSettings } from "../../src/settings";
import { parserVersionLabel } from "../../src/version";

const args = process.argv.slice(2), flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const [packDir, batchId, runId] = args;
if (!packDir || !batchId || !runId) throw new Error("usage: run.ts <pack directory> <batch id> <run id> [--limit N] [--only ids] [--formats list]");
/** The corpus is read as of one fixed date, never today's clock, so "Present" means the same thing on every run. */
export const AS_OF = new Date("2026-10-28T00:00:00Z");
const DOC_TIMEOUT_S = 180;

const OUT = join(import.meta.dirname, "..", "..", "data", "evaluations", batchId, runId);
if (existsSync(OUT)) throw new Error(`run ${runId} already exists: runs are immutable; choose a new run id`);
mkdirSync(join(OUT, "docs"), { recursive: true });

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const only = flag("--only")?.split(","), formats = flag("--formats")?.split(","), limit = Number(flag("--limit") ?? Infinity);
let files = walk(packDir).filter((p) => !p.includes("/Reference/") && /\.(docx|pdf|txt)$/i.test(p) && !p.endsWith("Visual_Index.pdf")).sort();
if (only) files = files.filter((p) => only.some((id) => p.includes(id)));
if (formats) files = files.filter((p) => formats.some((f) => p.toLowerCase().endsWith("." + f)));
const dirs = flag("--dirs")?.split(","); if (dirs) files = files.filter((p) => dirs.some((d) => relative(packDir, p).startsWith(d)));
files = files.slice(0, limit);

const git = (...a: string[]) => { try { return execFileSync("git", a, { cwd: import.meta.dirname, encoding: "utf8" }).trim(); } catch { return "unknown"; } };
const pkg = (p: string) => { try { return JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "node_modules", p, "package.json"), "utf8")).version; } catch { return "absent"; } };
const meta = {
  batchId, runId, packDir, startedAt: new Date().toISOString(), asOf: AS_OF.toISOString().slice(0, 10),
  code: { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--", "src").length > 0, branch: git("branch", "--show-current") },
  versions: { parser: parserVersionLabel(), experiments: process.env.PARSER_EXPERIMENTS ?? "", rules: ruleset.version, rulesFingerprint: rulesetFingerprint, tesseractJs: pkg("tesseract.js"), unpdf: pkg("unpdf"), mammoth: pkg("mammoth"), ocrLanguages: process.env.OCR_LANGUAGES ?? "eng+afr", ocrPsm: process.env.OCR_PSM ?? "3" },
  settings: "defaultSettings()", runtime: { node: process.version, platform: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) },
  documentTimeoutSeconds: DOC_TIMEOUT_S, seeds: "none (deterministic)", selection: { only, formats, limit: Number.isFinite(limit) ? limit : null, files: files.length },
};
writeFileSync(join(OUT, "run.json"), JSON.stringify(meta, null, 2));

const org = defaultSettings();
const results: any[] = [];
for (const [i, p] of files.entries()) {
  const rel = relative(packDir, p), bytes = new Uint8Array(readFileSync(p)), id = (rel.match(/(CV|JD)\d{4}/) ?? [""])[0], kind = id.startsWith("CV") ? "cv" as const : "jd" as const;
  const started = performance.now(), cpu0 = process.cpuUsage();
  let out: any;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${DOC_TIMEOUT_S} s`)), DOC_TIMEOUT_S * 1000).unref());
    out = await Promise.race([prepareDocument(bytes, { kind, org, asOf: AS_OF }), timeout]);
  } catch (e) { out = { ok: false, stage: "crash", code: "CRASH", message: String((e as Error)?.message ?? e) }; }
  const cpu = process.cpuUsage(cpu0);
  const row = { path: rel, id, kind, inputSha256: createHash("sha256").update(bytes).digest("hex"), ms: Math.round(performance.now() - started), cpuMs: Math.round((cpu.user + cpu.system) / 1000), rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), ...out };
  writeFileSync(join(OUT, "docs", rel.replace(/[\\/]/g, "__") + ".json"), JSON.stringify(row, null, 2));
  results.push({ path: rel, id, kind, ok: row.ok, code: row.code ?? null, ms: row.ms, cpuMs: row.cpuMs, rssMb: row.rssMb, review: row.review?.state ?? null });
  console.log(`${i + 1}/${files.length} ${rel} ${row.ok ? "ok" : row.code} ${row.ms} ms`);
}
await stopOcr();
writeFileSync(join(OUT, "index.json"), JSON.stringify({ ...meta, finishedAt: new Date().toISOString(), results }, null, 2));
console.log(`wrote ${OUT}`);
