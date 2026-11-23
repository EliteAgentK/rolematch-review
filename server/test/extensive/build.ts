// npm run build:extensive : renders the twelve long CVs (test/extensive/content.ts) into sample-documents/extensive/, with an answer key beside each, and
// checks every one is at least four pages (Word files are measured through an identical PDF rendering). Needs Google Chrome for the PDFs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { getDocumentProxy } from "unpdf";
import { spawnProc } from "../helpers";
import { CVS, type LongCv, type Section } from "./content";

const OUT = fileURLToPath(new URL("../../../sample-documents/extensive", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function docxFor(d: LongCv): Document {
  const kids: Paragraph[] = [];
  d.sections.forEach((s, si) => {
    if (s.h) kids.push(d.style === "plain" ? new Paragraph({ children: [new TextRun({ text: s.h, bold: true })] }) : new Paragraph({ text: s.h, heading: HeadingLevel.HEADING_2 }));
    s.lines.forEach((l, i) => {
      if (si === 0 && i === 0) kids.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: l, bold: true })] }));
      else if (s.bullets && d.style !== "plain") kids.push(new Paragraph({ text: l, bullet: { level: 0 } }));
      else kids.push(new Paragraph(l));
    });
  });
  return new Document({ sections: [{ children: kids }] });
}

const CSS = "@page{size:A4;margin:20mm}body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#222}h1{margin:0 0 4px;font-size:20pt}h3{margin:16px 0 6px;border-bottom:1px solid #ccc}p{margin:4px 0}ul{margin:4px 0 6px 18px;padding:0}li{margin:3px 0}.cols{display:flex;gap:24px}.side{width:30%;font-size:10pt}.main{width:70%}";
const block = (s: Section) => `${s.h ? `<h3>${esc(s.h)}</h3>` : ""}${s.bullets ? `<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : s.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`;
function htmlFor(d: LongCv): string {
  const [first, ...rest] = d.sections;
  const head = `<h1>${esc(first.lines[0])}</h1>${first.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join("")}`;
  if (d.style === "twocol") {
    const side = rest.filter((s) => /^(Skills|Hobbies|Core skills|Personality|Interests|Languages|Registrations and certificates)$/.test(s.h ?? "")), main = rest.filter((s) => !side.includes(s));
    return `<html><style>${CSS}</style><body>${head}<div class="cols"><div class="side">${side.map(block).join("")}</div><div class="main">${main.map(block).join("")}</div></div></body></html>`;
  }
  return `<html><style>${CSS}</style><body>${head}${rest.map(block).join("")}</body></html>`;
}

async function printPdf(html: string, out: string, id: string) {
  const file = join(tmpdir(), `th-ext-${id}.html`);
  writeFileSync(file, html);
  await spawnProc([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${join(tmpdir(), `th-ext-chrome-${id}`)}`, `--print-to-pdf=${out}`, `file://${file}`], { stdout: "ignore", stderr: "ignore" }).exited;
}
const pages = async (pdf: string) => (await getDocumentProxy(new Uint8Array(readFileSync(pdf)))).numPages;

mkdirSync(OUT, { recursive: true });
let short = 0;
for (const d of CVS) {
  const out = join(OUT, `${d.id}.${d.format}`);
  let n: number;
  if (d.format === "docx") {
    writeFileSync(out, new Uint8Array(await Packer.toBuffer(docxFor(d))));
    const measure = join(tmpdir(), `th-ext-measure-${d.id}.pdf`); await printPdf(htmlFor(d), measure, d.id + "-m"); n = await pages(measure); rmSync(measure);
  } else { await printPdf(htmlFor(d), out, d.id); n = await pages(out); }
  writeFileSync(join(OUT, `${d.id}.key.json`), JSON.stringify({ ...d.key, pages: n, format: d.format, style: d.style }, null, 1) + "\n");
  if (n < 4) short++;
  console.log(`${d.id.padEnd(28)} ${d.format.padEnd(5)} ${d.key.quality.padEnd(5)} ${n} pages${n < 4 ? "  << under four" : ""}`);
}
if (short) { console.error(`${short} CV(s) are under four pages`); process.exit(1); }
process.exit(0);
