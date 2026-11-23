// The whole authorised collection in Downloads, as a manifest: every CV and job, by stable ID, with what happened to anything left out and why. Nothing is opened to read its contents here, and nothing about a real person reaches the screen or Git: real documents get opaque IDs.
//   node --import tsx test/collection/inventory.ts           writes server/data/collection/manifest.jsonl and prints counts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";

const HOME = homedir(), DOWNLOADS = join(HOME, "Downloads"), UNPACKED = join(HOME, ".rolematch/collection/unpacked"), OUT = join(import.meta.dirname, "../../data/collection");
mkdirSync(OUT, { recursive: true }); mkdirSync(UNPACKED, { recursive: true });
/** Archives that are this programme's; others in Downloads are about something else and are never opened. */
const ARCHIVES = readdirSync(DOWNLOADS).filter((f) => /^RoleMatch.*\.zip$/i.test(f));
for (const z of ARCHIVES) { const to = join(UNPACKED, z.replace(/\.zip$/i, "")); if (!existsSync(to)) { mkdirSync(to, { recursive: true }); execFileSync("unzip", ["-q", "-n", join(DOWNLOADS, z), "-d", to, "-x", "__MACOSX/*", "*/.DS_Store"]); } }
/** Folders that are this programme's. Real documents are marked: they stay on this machine. */
const ROOTS: { dir: string; collection: string; real?: boolean }[] = [
  { dir: join(DOWNLOADS, "CVs"), collection: "corpus500" }, { dir: join(DOWNLOADS, "Jobs"), collection: "corpus500" },
  { dir: join(DOWNLOADS, "RoleMatch_300_Long_Form_CVs 2"), collection: "longform300" }, { dir: join(DOWNLOADS, "RoleMatch_60_Visual_Variety_CVs 3"), collection: "visual60" },
  { dir: join(DOWNLOADS, "RoleMatch_Long_CVs"), collection: "longcvs" }, { dir: join(DOWNLOADS, "RoleMatch-parser-OCR-test-pack-v1"), collection: "ocrpack" },
  { dir: join(DOWNLOADS, "Sample CVs"), collection: "real30", real: true },
  ...ARCHIVES.map((z) => ({ dir: join(UNPACKED, z.replace(/\.zip$/i, "")), collection: `zip:${z.replace(/^RoleMatch[_-]?|\.zip$/gi, "").slice(0, 24)}` })),
];
const DOCUMENT = new Set([".pdf", ".docx", ".doc", ".odt", ".rtf", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".heic"]);
/** Files in a pack that are about the pack, not a person or a job. Reported, not silently dropped. */
const NOT_A_RECORD = /(^|\/)(readme|read_me|visual_index|layout_prev|full_corpus_guide|verification|manifest)[^/]*$|\/portraits\/|\/reference\/|\/answer_keys\/|expected_/i;
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name.startsWith(".") || e.name === "__MACOSX" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const formatOf = (p: string) => { const e = extname(p).toLowerCase(), l = p.toLowerCase(); if (/phone_photo/.test(l)) return "photo"; if (/scan/.test(l)) return "scan"; return e.slice(1); };
const kindOf = (p: string) => (/\/jobs?\//i.test(p) || /(^|\/)(jd|job)[\d_]/i.test(p) ? "jd" : "cv");
const stemOf = (f: string, real: boolean, hash: string) => (real ? `RC-${hash.slice(0, 6)}` : basename(f, extname(f)));

const rows: any[] = [], excluded: Record<string, number> = {}, bySha = new Map<string, string>();
for (const r of ROOTS) {
  if (!existsSync(r.dir)) continue;
  for (const f of walk(r.dir).sort()) {
    const rel = relative(r.dir, f), ext = extname(f).toLowerCase();
    if (!DOCUMENT.has(ext)) { const why = `other file type ${ext || "(none)"}`; excluded[why] = (excluded[why] ?? 0) + 1; continue; }
    if (NOT_A_RECORD.test(`/${rel}`)) { excluded["part of a pack, not a person or a job"] = (excluded["part of a pack, not a person or a job"] ?? 0) + 1; continue; }
    const hash = sha(f), stem = stemOf(f, !!r.real, hash), format = formatOf(rel), id = `${r.collection}/${stem}/${format}`, first = bySha.get(hash);
    rows.push({ id, family: `${r.collection}/${stem}`, stem, collection: r.collection, kind: kindOf(rel), format, real: !!r.real, sha: hash.slice(0, 16), bytes: statSync(f).size, path: r.real ? undefined : relative(HOME, f), realPath: r.real ? relative(HOME, f) : undefined, duplicateOf: first });
    if (!first) bySha.set(hash, id);
  }
}
// Loose files at the top of Downloads: only what the file name says is a CV or a job, and those are treated as real. Anything else is unrelated until the owner says otherwise.
for (const name of readdirSync(DOWNLOADS)) {
  const f = join(DOWNLOADS, name); if (!statSync(f).isFile() || !DOCUMENT.has(extname(name).toLowerCase())) continue;
  const l = name.toLowerCase(), kind = /\b(cv|resume|curriculum)\b|_cv|cv_/.test(l) ? "cv" : /\b(jd|job|vacancy|position)\b/.test(l) ? "jd" : null;
  if (!kind) { excluded["loose file not named as a CV or job, left alone"] = (excluded["loose file not named as a CV or job, left alone"] ?? 0) + 1; continue; }
  const hash = sha(f), stem = `RL-${hash.slice(0, 6)}`, id = `loose/${stem}/${extname(name).slice(1).toLowerCase()}`, first = bySha.get(hash);
  rows.push({ id, family: `loose/${stem}`, stem, collection: "loose", kind, format: extname(name).slice(1).toLowerCase(), real: true, sha: hash.slice(0, 16), bytes: statSync(f).size, realPath: relative(HOME, f), duplicateOf: first });
  if (!first) bySha.set(hash, id);
}
// A zip copy of a folder is the same person under another collection's name: the same stem across collections, in the same format, is checked by hash above; a family is one person only within its collection.
writeFileSync(join(OUT, "manifest.jsonl"), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
const unique = rows.filter((x) => !x.duplicateOf), people = (k: string) => new Set(unique.filter((x) => x.kind === k).map((x) => x.family)).size;
const count = (l: any[], key: (x: any) => string) => l.reduce((a: Record<string, number>, x) => ((a[key(x)] = (a[key(x)] ?? 0) + 1), a), {});
const summary = { files: rows.length, duplicates: rows.length - unique.length, uniqueFiles: unique.length, uniqueCvs: people("cv"), uniqueJobs: people("jd"), byCollection: count(unique, (x) => `${x.collection} ${x.kind}`), byFormat: count(unique, (x) => `${x.kind} ${x.format}`), real: unique.filter((x) => x.real).length, excluded };
writeFileSync(join(OUT, "inventory.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
void dirname;
