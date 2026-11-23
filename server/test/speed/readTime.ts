// Run from server/: node --import tsx test/speed/readTime.ts <folder> [folder ...]   (local database settings only; files never leave this machine)
// Times the reading step alone (type check, text, layout; OCR when needed) on local files: no database, no storage, no AI. Prints timings only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";
const dirs = process.argv.slice(2), files: string[] = [];
for (const d of dirs) for (const f of readdirSync(d)) if ([".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png"].includes(extname(f).toLowerCase())) files.push(join(d, f));
const org = defaultSettings(), out: { kind: string; ms: number; kb: number; ok: boolean }[] = [];
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(f)), t = performance.now();
  const r = await prepareDocument(bytes, { kind: "cv", org, asOf: new Date(), fieldsByAi: true }).catch(() => ({ ok: false }));
  out.push({ kind: extname(f).slice(1).toLowerCase(), ms: performance.now() - t, kb: Math.round(statSync(f).size / 1024), ok: !!(r as any).ok });
}
const by = new Map<string, number[]>(); for (const o of out) (by.get(o.kind) ?? by.set(o.kind, []).get(o.kind)!).push(o.ms);
for (const [k, a] of by) { a.sort((x, y) => x - y); console.log(`${k}: ${a.length} files, median ${(a[Math.floor(a.length / 2)] / 1000).toFixed(2)} s, slowest ${(a[a.length - 1] / 1000).toFixed(2)} s`); }
console.log(`read without error: ${out.filter((o) => o.ok).length} of ${out.length}`);
process.exit(0);
