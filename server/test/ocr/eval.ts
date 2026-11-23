// OCR accuracy harness. Run: npm run eval:ocr   (from server/; add --quick for one CV and fewer profiles)
//
// Takes the text-based sample CVs, renders every page to an image, degrades the image the way real scans and phone photos are degraded,
// runs the same OCR + parsing the server uses, and compares what came out with what the parser reads from the original text.
// It measures the OCR and parsing steps; nothing here talks to the database or the queue.
//
// Real documents: put consented scans and phone photos in sample-documents/real/ (git-ignored) with an answer key next to each file,
// <file>.key.json: { "name": "...", "email": "...", "phone": "...", "roles": 3, "skills": ["..."] }. They are scored against the key.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPageAsImage, getDocumentProxy } from "unpdf";
import { extractCandidate } from "../../src/extract";
import { readDocument } from "../../src/parse";
import { cleanOcr, ocrImage, stopOcr } from "../../src/ocr";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const quick = process.argv.includes("--quick");

// ---------------------------------------------------------------- degradations
type Profile = { id: string; note: string; rotate?: number; blur?: number; noise?: number; contrast?: number; shadow?: number; jpeg?: number; width?: number };
export const PROFILES: Profile[] = [
  { id: "clean-scan", note: "flatbed scan, straight and sharp", jpeg: 90 },
  { id: "skewed", note: "page put on the glass slightly crooked (2 degrees)", rotate: 2, jpeg: 85 },
  { id: "faded", note: "faint photocopy: low contrast, grain", contrast: 0.55, noise: 18, jpeg: 70 },
  { id: "phone-good", note: "phone photo in good light, 3 degrees off, soft shadow", rotate: 3, shadow: 0.25, blur: 0.6, jpeg: 80, width: 1600 },
  { id: "phone-poor", note: "phone photo, dim light, strong shadow, 4 degrees off, blurry", rotate: -4, shadow: 0.5, blur: 1.2, noise: 14, contrast: 0.75, jpeg: 55, width: 1300 },
  { id: "bad", note: "worst realistic case: faded, crooked, blurred, heavy compression", rotate: 5, blur: 1.6, noise: 26, contrast: 0.5, shadow: 0.4, jpeg: 35, width: 1100 },
];

/** The same image degrades the same way every time (a fixed-seed generator, not Math.random), so a failure can be reproduced and a golden result can be kept. */
function seeded(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export async function degrade(png: Buffer, p: Profile): Promise<Buffer> {
  const rng = seeded(20260101);
  const img = await loadImage(png);
  const scale = p.width ? p.width / img.width : 1;
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale), pad = p.rotate ? Math.round(Math.max(w, h) * 0.05) : 0;
  const c = createCanvas(w + pad * 2, h + pad * 2), ctx = c.getContext("2d");
  ctx.fillStyle = "#d8d4cc"; ctx.fillRect(0, 0, c.width, c.height);                   // the desk behind the page
  ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(((p.rotate ?? 0) * Math.PI) / 180);
  if (p.blur) ctx.filter = `blur(${p.blur}px)`;
  ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore(); ctx.filter = "none";
  if (p.shadow) { const g = ctx.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, `rgba(0,0,0,${p.shadow})`); g.addColorStop(0.6, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height); }
  if (p.contrast || p.noise) {
    const d = ctx.getImageData(0, 0, c.width, c.height), k = p.contrast ?? 1;
    for (let i = 0; i < d.data.length; i += 4) {
      const n = p.noise ? (rng() - 0.5) * 2 * p.noise : 0;
      for (let j = 0; j < 3; j++) d.data[i + j] = Math.max(0, Math.min(255, (d.data[i + j] - 128) * k + 128 + (k < 1 ? 40 * (1 - k) : 0) + n));
    }
    ctx.putImageData(d, 0, 0);
  }
  return c.toBuffer("image/jpeg", p.jpeg ?? 80);
}

// ---------------------------------------------------------------- scoring
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}@+.]+/gu, " ").trim();
const words = (s: string) => norm(s).split(/\s+/).filter(Boolean);
/** Word-level F1 between what the original says and what OCR read: 1 = every word recovered and nothing extra. */
export function wordF1(truth: string, got: string): number {
  const t = new Map<string, number>(); for (const w of words(truth)) t.set(w, (t.get(w) ?? 0) + 1);
  let hit = 0; const g = words(got);
  for (const w of g) { const n = t.get(w) ?? 0; if (n > 0) { hit++; t.set(w, n - 1); } }
  const total = words(truth).length;
  return total && g.length ? (2 * (hit / g.length) * (hit / total)) / ((hit / g.length) + (hit / total)) : 0;
}
const set = (a: any[]) => new Set(a.map((s) => norm(typeof s === "string" ? s : s.name ?? s.description ?? "")).filter(Boolean));
function f1(truth: Set<string>, got: Set<string>) {
  if (!truth.size) return 1;
  let hit = 0; for (const x of got) if (truth.has(x)) hit++;
  const p = got.size ? hit / got.size : 0, r = hit / truth.size;
  return p + r ? (2 * p * r) / (p + r) : 0;
}
interface Facts { name: string; email: string; phone: string; roles: number; companies: Set<string>; skills: Set<string>; education: number }
const factsOf = (rec: any): Facts => ({ name: rec.name, email: rec.email, phone: rec.phone, roles: rec.workHistory.length, companies: set(rec.workHistory.map((w: any) => w.company)), skills: set(rec.skills), education: rec.education.length });
const digits = (s: string) => s.replace(/\D/g, "");
function compare(truth: Facts, got: Facts) {
  return {
    name: norm(truth.name) === norm(got.name) ? 1 : 0,
    email: truth.email.toLowerCase() === got.email.toLowerCase() ? 1 : 0,
    phone: digits(truth.phone) === digits(got.phone) ? 1 : 0,
    roles: truth.roles ? Math.min(got.roles, truth.roles) / Math.max(got.roles, truth.roles) : 1,
    companies: f1(truth.companies, got.companies),
    skills: f1(truth.skills, got.skills),
    education: truth.education ? Math.min(got.education, truth.education) / Math.max(got.education, truth.education) : 1,
  };
}

// ---------------------------------------------------------------- run
export async function pageImages(pdf: Uint8Array): Promise<Buffer[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf)); const out: Buffer[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) out.push(Buffer.from(await renderPageAsImage(new Uint8Array(pdf), p, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 })));
  return out;
}

/** The OCR route the server takes for an image, as one function the harness (and later the pipeline) can call. */
export async function readPhoto(pages: Buffer[]): Promise<{ text: string; confidence: number }> {
  let text = "", conf = 0;
  for (const p of pages) { const r = await ocrImage(new Uint8Array(p)); text += r.text + "\n"; conf += r.confidence; }
  return { text: cleanOcr(text), confidence: conf / pages.length };
}

type Row = { file: string; profile: string; words: number; confidence: number; ms: number } & ReturnType<typeof compare>;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => String(Math.round(x * 100)).padStart(3) + "%";

async function main() {
  const dir = join(ROOT, "sample-documents/cvs");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".pdf") && !/scanned|heavy-scan|photos/.test(f)).slice(0, quick ? 1 : 8);
  const profiles = quick ? PROFILES.filter((p) => ["clean-scan", "phone-poor"].includes(p.id)) : PROFILES;
  const rows: Row[] = [];
  const keep = join(ROOT, "server/data/ocr-eval"); mkdirSync(keep, { recursive: true });
  for (const f of sources) {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    if ((await getDocumentProxy(new Uint8Array(bytes))).numPages > 4) { console.log(`\nskipping ${f}: more than 4 pages`); continue; } // the harness images up to four pages
    const original = await readDocument(bytes, "pdf");
    const truth = factsOf((await extractCandidate(original.text)).record);
    const pages = await pageImages(bytes);
    for (const p of profiles) {
      const t0 = Date.now();
      const degraded = await Promise.all(pages.map((pg) => degrade(pg, p)));
      if (!quick) writeFileSync(join(keep, `${basename(f, ".pdf")}.${p.id}.jpg`), degraded[0]);
      const read = await readPhoto(degraded);
      const got = factsOf((await extractCandidate(read.text)).record);
      rows.push({ file: f, profile: p.id, words: wordF1(original.text, read.text), confidence: read.confidence, ms: Date.now() - t0, ...compare(truth, got) });
      process.stdout.write(".");
    }
  }
  // real documents with answer keys
  const real = join(ROOT, "sample-documents/real");
  const realRows: string[] = [];
  if (existsSync(real)) for (const f of readdirSync(real).filter((x) => /\.(jpe?g|png|pdf)$/i.test(x))) {
    const keyFile = join(real, f + ".key.json"); if (!existsSync(keyFile)) { realRows.push(`${f}: no answer key (${f}.key.json), skipped`); continue; }
    const key = JSON.parse(readFileSync(keyFile, "utf8")); const bytes = readFileSync(join(real, f));
    const text = extname(f).toLowerCase() === ".pdf" ? (await readDocument(new Uint8Array(bytes), "pdf")).text : (await readPhoto([bytes])).text;
    const rec: any = (await extractCandidate(text)).record, ok = (b: boolean) => (b ? "ok " : "MISS");
    realRows.push(`${f}: name ${ok(norm(rec.name) === norm(key.name ?? ""))} email ${ok(!key.email || rec.email.toLowerCase() === key.email.toLowerCase())} phone ${ok(!key.phone || digits(rec.phone) === digits(key.phone))} roles ${rec.workHistory.length}/${key.roles ?? "?"} skills ${pct(f1(set(key.skills ?? []), set(rec.skills)))}`);
  }
  console.log("\n");
  console.log("profile       words  name email phone roles comps skills educ  conf  s/CV");
  for (const p of profiles) {
    const r = rows.filter((x) => x.profile === p.id);
    console.log(p.id.padEnd(12), pct(mean(r.map((x) => x.words))), " ", pct(mean(r.map((x) => x.name))), pct(mean(r.map((x) => x.email))), " ", pct(mean(r.map((x) => x.phone))), " ", pct(mean(r.map((x) => x.roles))), " ", pct(mean(r.map((x) => x.companies))), pct(mean(r.map((x) => x.skills))), " ", pct(mean(r.map((x) => x.education))), " ", pct(mean(r.map((x) => x.confidence))), (mean(r.map((x) => x.ms)) / 1000).toFixed(1).padStart(5));
  }
  if (realRows.length) { console.log("\nreal documents:"); realRows.forEach((r) => console.log("  " + r)); }
  writeFileSync(join(keep, "report.json"), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  console.log("\nwords = share of the original's words recovered (F1). Fields compare against what the parser reads from the original text.\nPer-image results: server/data/ocr-eval/report.json");
  await stopOcr();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(() => process.exit(0));
