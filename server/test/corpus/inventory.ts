// The live workflow corpus: every source ID, its format and files, before anything is uploaded. Page-photo folders also become one image-only PDF each, so the whole record can be tested apart from the photo sequence. The answer key stays out of upload selection.
//   node --import tsx test/corpus/inventory.ts <corpus dir>
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";

const dir = process.argv[2], out = "data/corpus-live", items: any[] = [];
mkdirSync(join(out, "photo-pdfs"), { recursive: true });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16), fmt = (n: string) => n.match(/\[([^\]]+)\]/)?.[1] ?? "unknown";
for (const [kind, folder] of [["cv", "CVs"], ["jd", "Job Descriptions"]] as const) {
  for (const name of readdirSync(join(dir, folder)).sort()) {
    const m = name.match(/^(CV\d+|JD\d+)/); if (!m) { if (!name.startsWith(".")) items.push({ id: null, kind, format: "not a corpus document", files: [join(dir, folder, name)] }); continue; }   // anything else is listed, never uploaded
    const path = join(dir, folder, name), id = m[1];
    if (statSync(path).isDirectory()) {
      const pages = readdirSync(path).filter((f) => /\.jpe?g$/i.test(f)).sort((a, b) => Number(a.match(/\d+/g)?.at(-1)) - Number(b.match(/\d+/g)?.at(-1)));
      const pdf = await PDFDocument.create();
      for (const p of pages) { const img = await pdf.embedJpg(readFileSync(join(path, p))); const page = pdf.addPage([img.width, img.height]); page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height }); }
      const bytes = await pdf.save(), file = join(out, "photo-pdfs", `${id}.pdf`); writeFileSync(file, bytes);
      items.push({ id, kind, format: fmt(name), pages: pages.length, files: pages.map((p) => join(path, p)), pdf: file, sha: sha(bytes) });
    } else { const b = readFileSync(path); items.push({ id, kind, format: fmt(name), files: [path], sha: sha(b), bytes: b.length }); }
  }
}
const qa = readdirSync(join(dir, "Private QA"));
writeFileSync(join(out, "inventory.json"), JSON.stringify({ createdAt: new Date().toISOString(), source: dir, answerKey: qa.map((f) => join(dir, "Private QA", f)), items }, null, 1));
const count = (k: string) => Object.fromEntries(Object.entries(items.filter((i) => i.kind === k).reduce((a: any, i) => ((a[i.format] = (a[i.format] ?? 0) + 1), a), {})));
console.log(`CVs ${items.filter((i) => i.kind === "cv").length}`, JSON.stringify(count("cv")), `jobs ${items.filter((i) => i.kind === "jd").length}`, JSON.stringify(count("jd")), "photo pages", items.filter((i) => i.format === "Page photos").reduce((a, i) => a + i.pages, 0), "duplicate contents", items.length - new Set(items.map((i) => i.sha)).size, "answer key files", qa.length);
process.exit(0);
