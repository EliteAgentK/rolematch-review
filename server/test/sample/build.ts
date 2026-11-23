// Builds the hand-testing documents into /sample-documents (jobs/ and cvs/). Run: npm run build:samples
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { spawnProc } from "../helpers";
import { CVS, JOBS, type Doc } from "./content";

const OUT = fileURLToPath(new URL("../../../sample-documents", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function docxFor(d: Doc): Document {
  const kids: Paragraph[] = [];
  d.sections.forEach((s, si) => {
    if (s.h) kids.push(d.style === "structured" ? new Paragraph({ text: s.h, heading: HeadingLevel.HEADING_2 }) : new Paragraph({ children: [new TextRun({ text: s.h, bold: true })] }));
    s.lines.forEach((l, i) => {
      const first = si === 0 && i === 0;
      if (first && d.style !== "plain") kids.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: l, bold: true })] }));
      else if (s.bullets && d.style === "structured") kids.push(new Paragraph({ text: l, bullet: { level: 0 } }));
      else kids.push(new Paragraph(l));
    });
  });
  return new Document({ sections: [{ children: kids }] });
}

function htmlFor(d: Doc): string {
  const block = (s: { h?: string; lines: string[]; bullets?: boolean }) =>
    `${s.h ? `<h3>${esc(s.h)}</h3>` : ""}${s.bullets ? `<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : s.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`;
  const css = "body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;margin:36px;color:#222}h1{margin:0 0 4px}h3{margin:16px 0 4px;border-bottom:1px solid #ccc}p{margin:3px 0}ul{margin:3px 0 3px 18px;padding:0}.cols{display:flex;gap:28px}.side{width:30%}.main{width:70%}";
  if (d.style === "twocol") return `<html><style>${css}</style><body><h1>${esc(d.sections[0].lines[0])}</h1><p>${esc(d.sections[0].lines[1])}</p><div class="cols"><div class="side">${d.sections.slice(1, 4).map(block).join("")}</div><div class="main">${d.sections.slice(4).map(block).join("")}</div></div></body></html>`;
  const [first, ...rest] = d.sections;
  return `<html><style>${css}</style><body><h1>${esc(first.lines[0])}</h1>${first.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join("")}${rest.map(block).join("")}</body></html>`;
}

for (const [dir, docs] of [["jobs", JOBS], ["cvs", CVS]] as const) {
  mkdirSync(join(OUT, dir), { recursive: true });
  for (const d0 of docs) {
    const d = dir === "jobs" && d0.style !== "plain" ? { ...d0, sections: [{ ...d0.sections[0], lines: [d0.title, ...d0.sections[0].lines] }, ...d0.sections.slice(1)] } : d0;
    const out = join(OUT, dir, `${d.id}.${d.format}`);
    if (d.format === "docx") writeFileSync(out, new Uint8Array(await Packer.toBuffer(docxFor(d))));
    else {
      const html = join(tmpdir(), `th-sample-${d.id}.html`);
      writeFileSync(html, htmlFor(d));
      await spawnProc([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${join(tmpdir(), `th-sample-chrome-${d.id}`)}`, `--print-to-pdf=${out}`, `file://${html}`], { stdout: "ignore", stderr: "ignore" }).exited;
    }
    console.log("built", dir, d.id);
  }
}
