// Makes two text CVs that carry big photographs (a PDF and a Word file), to prove the optimiser shrinks the pictures and never touches the words.
// Run: npm run build:photos   (the results are committed, so tests need no extra tools)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, ImageRun, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

const OUT = fileURLToPath(new URL("../../../sample-documents/cvs", import.meta.url));
const { createCanvas } = await import("@napi-rs/canvas");

/** A grainy, detailed "photograph": gradients, shapes and per-pixel noise, so it cannot be stored small. */
function photo(w: number, h: number, format: "jpeg" | "png", quality = 95): Buffer {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#3a5a78"); g.addColorStop(1, "#c9a27a"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `hsla(${Math.random() * 360},50%,50%,0.25)`; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 140, 0, 7); ctx.fill(); }
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) { const n = Math.floor(Math.random() * 25) - 12; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
  ctx.putImageData(d, 0, 0);
  return format === "jpeg" ? c.toBuffer("image/jpeg", quality) : c.toBuffer("image/png");
}

const lines = [
  "Nomsa Dube", "Marketing Coordinator", "nomsa.dube@example.test | 081 555 0113 | Durban, South Africa",
  "Summary", "Marketing coordinator with four years of experience running events and social media for retail brands.",
  "Experience", "Marketing Coordinator, Sunrise Retail (Feb 2022 - Present)",
  "Planned 24 in-store events a year and grew social media followers by 60%.", "Managed a R400,000 annual campaign budget.",
  "Marketing Assistant, Bayview Stores (Jan 2020 - Jan 2022)", "Produced weekly newsletters and supported store launches.",
  "Education", "BCom Marketing, University of KwaZulu-Natal, 2019", "Skills", "Social media, Event planning, Budgeting, Canva, Excel",
];

const jpeg = photo(3000, 2000, "jpeg"), png = photo(1800, 1200, "png");

// PDF: real text (Helvetica) plus a large JPEG and a large PNG picture
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([595, 842]);
let y = 800; for (const l of lines) { page.drawText(l, { x: 50, y, size: 11, font }); y -= 18; }
page.drawImage(await pdf.embedJpg(jpeg), { x: 50, y: 330, width: 240, height: 160 });
page.drawImage(await pdf.embedPng(png), { x: 300, y: 330, width: 240, height: 160 });
writeFileSync(join(OUT, "cv14-nomsa-text-with-photos.pdf"), await pdf.save());

// Word: real text plus the same large JPEG and PNG
const heading = ["Summary", "Experience", "Education", "Skills"];
const para = (l: string, i: number) => new Paragraph(i === 0 ? { text: l, heading: HeadingLevel.TITLE } : heading.includes(l) ? { text: l, heading: HeadingLevel.HEADING_2 } : { text: l });
const doc = new Document({ sections: [{ children: [...lines.map(para),
  new Paragraph({ children: [new ImageRun({ type: "jpg", data: jpeg, transformation: { width: 240, height: 160 } })] }),
  new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 240, height: 160 } })] })] }] });
writeFileSync(join(OUT, "cv15-nomsa-text-with-photos.docx"), new Uint8Array(await Packer.toBuffer(doc)));
console.log("built cv14 and cv15");
