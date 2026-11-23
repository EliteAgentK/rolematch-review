// npm run stress:quality : does a language-independent word-plausibility score (src/ocrQuality.ts) predict the character error rate of OCR text?
// Prints the correlation, and the share of badly read documents (CER 20% or more) that a score threshold catches, against false alarms.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { stopOcr } from "../../src/ocr";
import { readDocument } from "../../src/parse";
import { wordChecks } from "../../src/ocrQuality";
import { degrade, pageImages, PROFILES, readPhoto } from "../ocr/eval";
const OUT = fileURLToPath(new URL("../../data/stress/pdf/", import.meta.url));
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
function cer(a: string, b: string) { a = norm(a); b = norm(b); if (!b.length) return 1; let prev = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return Math.min(1, prev[b.length] / b.length); }
const N = Number(process.argv[2] ?? 40), rows: { cer: number; score: number; conf: number; seed: number; kind: string }[] = [];
for (let seed = 1; seed <= N; seed++) {
  const pdf = new Uint8Array(readFileSync(join(OUT, `${seed}.pdf`)));
  const want = (await readDocument(pdf, "pdf")).text, pages = await pageImages(pdf);
  for (const [kind, id] of [["scan", "faded"], ["photo", "phone-good"]] as const) {
    const got = await readPhoto(await Promise.all(pages.map((p) => degrade(p, PROFILES.find((q) => q.id === id)!))));
    rows.push({ cer: cer(got.text, want), score: wordChecks(got.text).score, conf: got.confidence, seed, kind });
  }
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const pearson = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; }); return n / Math.sqrt(da * db); };
console.log("documents", rows.length, "| correlation with CER: word-score", pearson(rows.map((r) => r.score), rows.map((r) => r.cer)).toFixed(3), " engine confidence", pearson(rows.map((r) => r.conf), rows.map((r) => r.cer)).toFixed(3));
const bad = rows.filter((r) => r.cer >= 0.2);
for (const t of [0.9, 0.92, 0.94, 0.95, 0.96, 0.97]) { const flag = rows.filter((r) => r.score < t); console.log(`score < ${t}: flags ${flag.length}/${rows.length}; catches ${flag.filter((r) => r.cer >= 0.2).length}/${bad.length} bad; false alarms ${flag.filter((r) => r.cer < 0.2).length}`); }
await stopOcr(); process.exit(0);
