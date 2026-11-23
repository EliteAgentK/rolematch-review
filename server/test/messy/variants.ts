// Tougher versions of the messy corpus, scored against the SAME answer keys. Usage: npm run eval:variants -- <scramble|scan|photo|formats|all> [--failures] [--limit N]
//   scramble  every PDF re-written with its text stored in random order (how some design tools and "print to PDF" export)
//   scan      one CV per layout printed, scanned (slightly crooked, grainy) and read by OCR
//   photo     one CV per layout photographed on a phone (shadow, blur, tilt) and read by OCR
//   formats   every Word file re-saved as .doc, .rtf, .odt and .txt by the operating system (macOS textutil)
// The point is to find what breaks BEFORE a customer's document does, and to see how often the rules alone are not enough.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { readDocument } from "../../src/parse";
import { sniff } from "../../src/formats";
import { parseCv } from "../../src/rules";
import { stopOcr } from "../../src/ocr";
import { degrade, pageImages, PROFILES, readPhoto } from "../ocr/eval";
import { build, FILES } from "./build";
import { extractCandidate } from "../../src/extract";
import { score, summarise, type Score } from "./eval";
import { CORPUS_AS_OF, scorePanels, summarisePanels, type PanelResult } from "./panels";
import { PERSONAS } from "./personas";
import { PERSONAS_R4 } from "./personas4";

const ALL = [...PERSONAS, ...PERSONAS_R4];
const personaOf = (f: string) => { const [layout, pid] = f.replace(/\.\w+$/, "").split("__"); return { layout, persona: ALL.find((x) => x.id === pid)! }; };
const OUT = fileURLToPath(new URL("../../data/variants/", import.meta.url));

/** A small, repeatable shuffle so a failure can be reproduced. */
function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Re-draws every piece of text at its own position, in a random order. The page looks the same; only the stored order is destroyed. */
export async function scramblePdf(bytes: Uint8Array, seed = 7): Promise<Uint8Array> {
  const src = await getDocumentProxy(new Uint8Array(bytes));
  const out = await PDFDocument.create(), font = await out.embedFont(StandardFonts.Helvetica), bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ok = new Set(font.getCharacterSet());
  for (let n = 1; n <= src.numPages; n++) {
    const page = await src.getPage(n), view = page.getViewport({ scale: 1 }), p = out.addPage([view.width, view.height]);
    const items = ((await page.getTextContent()).items as any[]).filter((it) => typeof it.str === "string" && it.str.trim() !== "");
    for (const it of shuffle(items, seed + n)) {
      const text = [...it.str].map((c: string) => (ok.has(c.codePointAt(0)!) ? c : "?")).join("");
      const f = /bold|black|heavy/i.test(it.fontName ?? "") ? bold : font;
      let size = Math.max(5, Math.abs(it.transform[3]) || 10);
      const wide = f.widthOfTextAtSize(text, size);
      if (it.width > 0 && wide > it.width) size = Math.max(4, size * (it.width / wide)); // the stand-in font is wider than the original: shrink it so the piece covers the same space
      p.drawText(text, { x: it.transform[4], y: it.transform[5], size, font: f });
    }
  }
  return new Uint8Array(await out.save());
}

const rows = (name: string) => ({ name, scores: [] as Score[], panels: [] as PanelResult[], panelNotes: [] as { file: string; notes: string[] }[], broken: [] as string[] });
async function viaText(file: string, text: string, r: ReturnType<typeof rows>, layout: string, persona: (typeof ALL)[number], format: "pdf" | "docx") {
  const asOf = CORPUS_AS_OF;   // one reference date for the reader and the answer key, never today's clock (panels.ts)
  r.scores.push(score(file, layout, persona, format, parseCv(text)));
  const rec = (await extractCandidate(text, { asOf })).record; // what the panels would show
  const p = scorePanels(persona, rec, text, layout);
  r.panels.push(p); if (p._notes.length) r.panelNotes.push({ file, notes: p._notes });
}

async function run(which: string, limit: number) {
  await build(false);
  const results: ReturnType<typeof rows>[] = [];
  const pdfs = readdirSync(join(FILES, "pdf")).sort();
  const docxs = readdirSync(join(FILES, "docx")).sort();
  const onePerLayout = (list: string[]) => { const seen = new Set<string>(); return list.filter((f) => { const l = f.split("__")[0]; if (seen.has(l)) return false; seen.add(l); return true; }); };

  if (which === "original" || which === "all") {
    const r = rows("original: the corpus as it is"); results.push(r);
    for (const f of pdfs.slice(0, limit)) { const { layout, persona } = personaOf(f); await viaText(`pdf/${f}`, (await readDocument(new Uint8Array(readFileSync(join(FILES, "pdf", f))), "pdf")).text, r, layout, persona, "pdf"); }
    for (const f of docxs.slice(0, limit)) { const { layout, persona } = personaOf(f); await viaText(`docx/${f}`, (await readDocument(new Uint8Array(readFileSync(join(FILES, "docx", f))), "docx")).text, r, layout, persona, "docx"); }
  }
  if (which === "scramble" || which === "all") {
    const r = rows("scramble: PDF text stored in random order"); results.push(r);
    for (const f of pdfs.slice(0, limit)) {
      const { layout, persona } = personaOf(f);
      try { const text = (await readDocument(await scramblePdf(new Uint8Array(readFileSync(join(FILES, "pdf", f)))), "pdf")).text; await viaText(`pdf/${f}`, text, r, layout, persona, "pdf"); } catch (e: any) { r.broken.push(`${f}: ${e.message}`); }
    }
  }
  const ocrRun = async (profile: string, title: string) => {
    const r = rows(title); results.push(r);
    const prof = PROFILES.find((p) => p.id === profile)!;
    for (const f of onePerLayout(pdfs).slice(0, limit)) {
      const { layout, persona } = personaOf(f);
      try {
        const pages = await pageImages(new Uint8Array(readFileSync(join(FILES, "pdf", f))));
        const text = (await readPhoto(await Promise.all(pages.map((pg) => degrade(pg, prof))))).text;
        await viaText(`pdf/${f}`, text, r, layout, persona, "pdf"); process.stdout.write(".");
      } catch (e: any) { r.broken.push(`${f}: ${e.message}`); }
    }
  };
  if (which === "scan" || which === "all") await ocrRun("faded", "scan: printed, scanned crooked and grainy, read by OCR");
  if (which === "photo" || which === "all") await ocrRun("phone-good", "photo: phone picture with shadow, blur and tilt, read by OCR");
  if (which === "formats" || which === "all") {
    mkdirSync(OUT, { recursive: true });
    for (const ext of ["doc", "rtf", "odt", "txt"]) {
      const r = rows(`formats: Word files re-saved as .${ext}`); results.push(r);
      for (const f of docxs.slice(0, limit)) {
        const { layout, persona } = personaOf(f);
        try {
          const target = join(OUT, f.replace(/\.docx$/, `.${ext}`));
          execFileSync("textutil", ["-convert", ext, join(FILES, "docx", f), "-output", target], { stdio: "ignore" });
          const bytes = new Uint8Array(readFileSync(target)), kind = sniff(bytes);
          if (!kind) { r.broken.push(`${f}: not recognised as ${ext}`); continue; }
          await viaText(`docx/${f}`, (await readDocument(bytes, kind)).text, r, layout, persona, "docx");
        } catch (e: any) { r.broken.push(`${f}: ${e.message}`); }
      }
    }
  }
  return results;
}

if (import.meta.main || (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])) {
  const which = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "all";
  const li = process.argv.indexOf("--limit"), limit = li > 0 ? Number(process.argv[li + 1]) : 10_000;
  const results = await run(which, limit);
  console.log("\n");
  const cols = ["perfect", "name", "email", "phone", "location", "roleRecall", "rolePrecision", "dates", "company", "skills", "junkPerCv", "education"] as const;
  console.log("variant".padEnd(62) + "files " + cols.map((c) => c.slice(0, 7).padStart(8)).join(""));
  for (const r of results) { const s = summarise(r.scores); console.log(r.name.slice(0, 60).padEnd(62) + String(s.files).padEnd(6) + cols.map((c) => String(s[c]).padStart(8)).join("") + (r.broken.length ? `   (${r.broken.length} could not be read)` : "")); }
  // accuracy per card field and per panel section, for each variant
  const fields = summarisePanels(results[0]?.panels ?? []).map((x) => `${x.area}:${x.field}`);
  console.log("\nACCURACY BY CARD FIELD AND PANEL SECTION (share of CVs that carry the field where it was read exactly right; partial credit in brackets)");
  console.log("field".padEnd(26) + results.map((r) => r.name.split(":")[0].padStart(10)).join(""));
  fields.forEach((f, i) => console.log(f.padEnd(26) + results.map((r) => { const x = summarisePanels(r.panels)[i]; return `${x.exact}%`.padStart(10); }).join("")));
  if (process.argv.includes("--panel-misses")) for (const r of results) { console.log(`\nMISSES: ${r.name}`); for (const m of r.panelNotes.slice(0, 80)) console.log(`  ${m.file.padEnd(32)} ${m.notes.join(" ; ").slice(0, 200)}`); }
  if (process.argv.includes("--failures")) for (const r of results) { console.log(`\n${r.name}`); for (const x of r.scores.filter((s) => !s.perfect)) console.log(`  ${x.file.padEnd(34)} ${x.reasons.join(" ; ").slice(0, 170)}`); for (const b of r.broken) console.log("  BROKEN " + b); }
  writeFileSync(join(OUT, "report.json"), JSON.stringify(results.map((r) => ({ name: r.name, summary: summarise(r.scores), broken: r.broken, failures: r.scores.filter((s) => !s.perfect).map((s) => ({ file: s.file, reasons: s.reasons })) })), null, 1));
  await stopOcr();
  process.exit(0);
}
