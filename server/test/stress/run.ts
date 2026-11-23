// npm run stress -- [--n 200] [--from 1] [--variants pdf,scramble,docx,scan,photo] [--failures] [--invariants]
// Generates CVs with known answers in random styles, reads them the way the platform does, scores every card field and panel section, and then finds the
// style choices that the failures have in common.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCandidate } from "../../src/extract";
import { sniff } from "../../src/formats";
import { stopOcr } from "../../src/ocr";
import { readDocument } from "../../src/parse";
import { parseCv } from "../../src/rules";
import { spawnProc } from "../helpers";
import { score } from "../messy/eval";
import { scorePanels, summarisePanels, type PanelResult } from "../messy/panels";
import { degrade, pageImages, PROFILES, readPhoto } from "../ocr/eval";
import { scramblePdf } from "../messy/variants";
import { makePersona } from "./generate";
import { makeStyle, renderHtml, type Style } from "./render";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", "120")), FROM = Number(arg("from", "1")), VARIANTS = arg("variants", "pdf").split(",");
const OUT = fileURLToPath(new URL("../../data/stress/", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Character error rate of OCR text against the document's own text: edit distance over the longer length, on lower-case letters and digits only. */
function cer(got: string, want: string): number {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, ""), a = norm(got), b = norm(want);
  if (!b.length) return a.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return Math.min(1, prev[b.length] / b.length);
}

interface Row { cer?: number; panel?: PanelResult; seed: number; variant: string; perfect: boolean; misses: string[]; style: Style; flags: string[]; pages: number }

async function renderAll(seeds: number[]) {
  mkdirSync(join(OUT, "pdf"), { recursive: true });
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < seeds.length) {
      const seed = seeds[next++], file = join(OUT, "pdf", `${seed}.pdf`);
      if (existsSync(file)) continue;
      const html = join(tmpdir(), `rm-stress-${seed}.html`);
      // the converter keeps text colours but drops backgrounds, so a white banner title would become white on white: these formats are rendered with dark text on a light page
    writeFileSync(html, renderHtml(makePersona(seed), { ...makeStyle(seed), theme: "light" }).replace(/color:\s*#fff(?:fff)?\b/gi, "color:#000"));
      await spawnProc([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${join(tmpdir(), `rm-stress-chrome-${seed}`)}`, `--print-to-pdf=${file}`, `file://${html}`], { stdout: "ignore", stderr: "ignore" }).exited;
    }
  }));
}

async function textFor(seed: number, variant: string): Promise<{ text: string; pages: number } | null> {
  const pdf = new Uint8Array(readFileSync(join(OUT, "pdf", `${seed}.pdf`)));
  if (variant === "pdf") { const r = await readDocument(pdf, "pdf"); return { text: r.text, pages: 0 }; }
  if (variant === "scramble") return { text: (await readDocument(await scramblePdf(pdf, seed), "pdf")).text, pages: 0 };
  if (variant === "docx" || variant === "doc" || variant === "rtf" || variant === "odt") {
    const html = join(tmpdir(), `rm-stress-${seed}.html`), target = join(OUT, `${seed}.${variant}`);
    // the converter keeps text colours but drops backgrounds, so a white banner title would become white on white: these formats are rendered with dark text on a light page
    writeFileSync(html, renderHtml(makePersona(seed), { ...makeStyle(seed), theme: "light" }).replace(/color:\s*#fff(?:fff)?\b/gi, "color:#000"));
    execFileSync("textutil", ["-convert", variant, html, "-output", target], { stdio: "ignore" });
    const bytes = new Uint8Array(readFileSync(target));
    return { text: (await readDocument(bytes, sniff(bytes)!)).text, pages: 0 };
  }
  if (variant === "scan" || variant === "photo") {
    const prof = PROFILES.find((p) => p.id === (variant === "scan" ? "faded" : "phone-good"))!;
    const pages = await pageImages(pdf);
    return { text: (await readPhoto(await Promise.all(pages.map((pg) => degrade(pg, prof))))).text, pages: pages.length };
  }
  return null;
}

const rows: Row[] = [];
const seeds = Array.from({ length: N }, (_, i) => FROM + i);
await renderAll(seeds);
for (const variant of VARIANTS) {
  for (const seed of seeds) {
    const persona = makePersona(seed), style = makeStyle(seed);
    let got; try { got = await textFor(seed, variant); } catch (e: any) { rows.push({ seed, variant, perfect: false, misses: [`could not be read: ${e.message}`], style, flags: persona.flags, pages: 0 }); continue; }
    if (!got) continue;
    const rec = (await extractCandidate(got.text, { asOf: new Date("2026-10-21") })).record;
    const panel: PanelResult = scorePanels(persona, rec, got.text, "stress");
    const raw = score(`${seed}`, "stress", persona, "pdf", parseCv(got.text));
    const misses = [...panel._notes, ...(raw.leaks.length ? [`LEAK ${raw.leaks.join(",")}`] : [])];
    const ocrVariant = variant === "scan" || variant === "photo";
    const want = ocrVariant ? (await textFor(seed, "pdf"))?.text : undefined;
    rows.push({ seed, variant, perfect: misses.length === 0, misses, style, flags: persona.flags, pages: got.pages, panel, cer: want ? cer(got.text, want) : undefined });
    process.stdout.write(misses.length ? "x" : ".");
  }
  console.log(` ${variant}`);
}

// ---------------------------------------------------------------- report
console.log("\nPERFECT (every card field and panel section right) by variant:");
for (const v of VARIANTS) { const r = rows.filter((x) => x.variant === v); console.log(`  ${v.padEnd(9)} ${Math.round((r.filter((x) => x.perfect).length / Math.max(1, r.length)) * 100)}%  (${r.length} CVs)`); }

for (const v of VARIANTS.filter((v) => v === "scan" || v === "photo")) {
  const r = rows.filter((x) => x.variant === v && x.cer !== undefined);
  if (!r.length) continue;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`\n${v.toUpperCase()}: character error rate against the document's own text (lower is better): mean ${(mean(r.map((x) => x.cer!)) * 100).toFixed(1)}%, median ${(r.map((x) => x.cer!).sort((a, b) => a - b)[Math.floor(r.length / 2)] * 100).toFixed(1)}%`);
  console.log("  by colour theme:");
  for (const t of ["light", "darkSide", "darkPage", "colorHeads", "lowContrast", "tinted"]) { const g = r.filter((x) => x.style.theme === t); if (g.length) console.log(`    ${t.padEnd(12)} ${String(g.length).padStart(3)} CVs   error rate ${(mean(g.map((x) => x.cer!)) * 100).toFixed(1).padStart(5)}%   perfect ${Math.round((g.filter((x) => x.perfect).length / g.length) * 100)}%`); }
}
console.log("\nACCURACY PER FIELD (share of CVs, carrying the field, where it was exactly right):");
console.log("field".padEnd(34) + VARIANTS.map((v) => v.padStart(10)).join(""));
const tables = VARIANTS.map((v) => summarisePanels(rows.filter((x) => x.variant === v && x.panel).map((x) => x.panel!)));
tables[0].forEach((t, i) => console.log(`${t.area}:${t.field}`.padEnd(34) + tables.map((tb) => `${tb[i].exact}%`.padStart(10)).join("")));

const fields = new Map<string, { bad: number; all: number }>();
for (const r of rows) for (const m of r.misses) { const k = m.split(":")[0]; const e = fields.get(k) ?? { bad: 0, all: 0 }; e.bad++; fields.set(k, e); }
console.log("\nWHAT GOES WRONG (number of CVs with a miss in each field):");
for (const [k, v] of [...fields].sort((a, b) => b[1].bad - a[1].bad).slice(0, 14)) console.log(`  ${String(v.bad).padStart(4)}  ${k}`);

// which style choices go with failure?
const factors: [string, (r: Row) => string][] = [
  ["font", (r) => r.style.font], ["size", (r) => `${r.style.size}pt`], ["line height", (r) => String(r.style.lineHeight)], ["justified", (r) => String(r.style.justify)], ["margin", (r) => `${r.style.margin}px`],
  ["heading case", (r) => r.style.headingCase], ["heading kind", (r) => r.style.headingKind], ["columns", (r) => r.style.columns], ["bullet", (r) => r.style.bullet], ["dates", (r) => r.style.dates],
  ["role layout", (r) => r.style.roleStyle], ["contact", (r) => r.style.contact], ["name", (r) => r.style.nameAlign], ["photo", (r) => String(r.style.photo)], ["skills", (r) => r.style.skillsStyle],
  ["page furniture", (r) => String(r.style.furniture)], ["page break", (r) => String(r.style.pageBreak)], ["education layout", (r) => r.style.eduStyle], ["all caps body", (r) => String(r.style.bodyCaps)], ["all bold", (r) => String(r.style.boldAll)], ["colour theme", (r) => r.style.theme],
  ["personal details", (r) => String(r.style.personal)], ["career", (r) => (r.flags.includes("long-career") ? "long (6+ roles)" : "normal")], ["education", (r) => r.flags.find((f) => f.startsWith("education-")) ?? ""],
  ["heading wording: experience", (r) => r.style.headings.experience], ["heading wording: summary", (r) => r.style.headings.summary], ["heading wording: education", (r) => r.style.headings.education],
];
for (const v of VARIANTS) {
  const r = rows.filter((x) => x.variant === v), base = r.filter((x) => x.perfect).length / Math.max(1, r.length);
  console.log(`\nHOTSPOTS for ${v}: style choices whose CVs fail much more than the ${Math.round((1 - base) * 100)}% average (at least 6 CVs):`);
  const hot: { name: string; value: string; fail: number; n: number }[] = [];
  for (const [name, f] of factors) { const g = new Map<string, Row[]>(); for (const x of r) { const k = f(x); g.set(k, [...(g.get(k) ?? []), x]); } for (const [value, xs] of g) if (xs.length >= 6) hot.push({ name, value, fail: xs.filter((x) => !x.perfect).length / xs.length, n: xs.length }); }
  for (const h of hot.sort((a, b) => b.fail - a.fail).slice(0, 12)) console.log(`  ${String(Math.round(h.fail * 100)).padStart(3)}% fail  ${h.name}: ${h.value}  (${h.n} CVs)`);
}
if (process.argv.includes("--failures")) for (const r of rows.filter((x) => !x.perfect).slice(0, 60)) console.log(`seed ${r.seed} ${r.variant}: ${r.misses.join(" ; ").slice(0, 200)}`);
writeFileSync(join(OUT, "report.json"), JSON.stringify(rows.map((r) => ({ seed: r.seed, variant: r.variant, perfect: r.perfect, misses: r.misses, cer: r.cer })), null, 1));
await stopOcr(); process.exit(0);
