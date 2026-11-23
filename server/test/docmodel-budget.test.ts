// The layout reading's time limit stops the work, not only the waiting for it (code review, 16 Nov 2026, B-M7). The limit was given a promise, which nothing
// can stop, so when a scan's layout ran out of time the reading went on in the background: OCR of every page, inside the one OCR queue every document of the
// process shares, and every other document's OCR waited behind work nobody would use. Invented documents only.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterAll, expect, test } from "vitest";
import { readCandidate } from "../src/candidatePipeline";
import { ocrPdfWords, stopOcr } from "../src/ocr";

afterAll(() => stopOcr());
const scan = new Uint8Array(readFileSync(new URL("../../sample-documents/cvs/cv11-zanele-scanned.pdf", import.meta.url)));
async function pagesOf(n: number) {   // the invented scanned CV's first page, n times over
  const src = await PDFDocument.load(scan), out = await PDFDocument.create();
  for (let i = 0; i < n; i++) { const [p] = await out.copyPages(src, [0]); out.addPage(p); }
  return new Uint8Array(await out.save());
}

test("when the layout reading runs out of time, its OCR stops too and the next document's OCR is not kept waiting (code review, 16 Nov 2026, B-M7)", async () => {
  const one = await pagesOf(1), eight = await pagesOf(8);
  await ocrPdfWords(one);   // warm: the OCR engine is started
  let t = performance.now(); await ocrPdfWords(one); const page = performance.now() - t;   // what one page takes on this machine
  // The reader's own text of a scan is next to nothing, and no OCR words are handed over, so the layout is read by OCR of all eight pages.
  const read = await readCandidate(eight, "pdf", { text: "Curriculum vitae", issues: [] }, 1);
  expect(read.failed).toMatch(/within 1 seconds/);
  t = performance.now(); await ocrPdfWords(one); const waited = performance.now() - t;
  // Stopped, the abandoned reading finishes at most the page it was on: the next page waits for that page and its own, never for seven more.
  expect(waited, `one page takes ${Math.round(page)} ms; the next document waited ${Math.round(waited)} ms`).toBeLessThan(page * 3.5 + 1000);
}, 300_000);
