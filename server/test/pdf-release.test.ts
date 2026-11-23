// Every PDF the reader opens is closed again when it is done with it (code review, 16 Nov 2026, B-M6). One document was opened by pdf.js four to six times
// (counting pages, reading, what is visible, the layout, OCR, the optimiser) and never closed, so a reading worker's memory grew with every PDF until it
// was stopped for running out. Here every opening is watched, and each step must have closed all it opened by the time it returns. Invented documents only.
import { readFileSync } from "node:fs";
import { afterAll, expect, test, vi } from "vitest";

const opened = vi.hoisted(() => [] as any[]);
vi.mock("unpdf", async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, getDocumentProxy: async (...a: any[]) => { const pdf = await real.getDocumentProxy(...a); opened.push(pdf); return pdf; } };
});
import { countPages } from "../src/pageCount";
import { readDocument } from "../src/parse";
import { buildDocModel } from "../src/docmodel/model";
import { isScanned, optimiseScannedPdf, optimiseTextPdf } from "../src/optimise";
import { contactsInPictures } from "../src/visibility";
import { ocrPdf, stopOcr } from "../src/ocr";

afterAll(() => stopOcr());
const sample = (name: string) => new Uint8Array(readFileSync(new URL(`../../sample-documents/cvs/${name}`, import.meta.url)));
const text = sample("cv06-aisha-patel.pdf"), scan = sample("cv11-zanele-scanned.pdf"), photos = sample("cv14-nomsa-text-with-photos.pdf");
/** Runs a step and says how many PDFs it opened and how many it left open. */
async function closes(step: () => Promise<unknown>) {
  const from = opened.length; await step().catch(() => {});
  const mine = opened.slice(from);
  return { opened: mine.length, leftOpen: mine.filter((p) => !p.loadingTask.destroyed).length };
}

test("every step that opens a PDF closes it again before it returns (code review, 16 Nov 2026, B-M6)", async () => {
  const steps: Record<string, () => Promise<unknown>> = {
    "counting pages": () => countPages(text, "pdf"),
    "reading a text PDF": () => readDocument(text, "pdf"),
    "reading a scan": () => readDocument(scan, "pdf"),
    "OCR of a scan": () => ocrPdf(scan, { maxPages: 1 }),
    "the layout of a text PDF": () => buildDocModel(text, "pdf"),
    "the layout of a scan": () => buildDocModel(scan, "pdf"),
    "deciding whether it is a scan": () => isScanned(scan),
    "making a scan smaller": () => optimiseScannedPdf(scan),
    "making a text PDF's pictures smaller": () => optimiseTextPdf(photos),
    "contact details in pictures": () => contactsInPictures(text, "Aisha Patel\nDigital Marketing Manager"),
  };
  const results: Record<string, { opened: number; leftOpen: number }> = {};
  for (const [name, step] of Object.entries(steps)) results[name] = await closes(step);
  for (const [name, r] of Object.entries(results)) expect(r.opened, `${name} opened no PDF: the test no longer watches it`).toBeGreaterThan(0);
  expect(Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.leftOpen]))).toEqual(Object.fromEntries(Object.keys(steps).map((k) => [k, 0])));
}, 300_000);
