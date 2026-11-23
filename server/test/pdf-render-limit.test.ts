// No PDF page is drawn larger than a fixed number of pixels, whatever size the page says it is (code review, 16 Nov 2026, B-M4). Pages were drawn at a fixed
// scale (3.5 for OCR, 200 dpi for the optimiser) with no limit, so a page that declares itself 14,400 points square, the largest a PDF allows, asked for a
// canvas of about 50,000 x 50,000 pixels (some 10 GB) and the reading process failed or died, on every attempt. Here every drawing the readers ask for is
// recorded instead of made (a small white picture stands in for it), so the test asks for nothing large itself. Invented documents only.
import { afterAll, expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const asked = vi.hoisted(() => [] as { page: number; scale: number }[]);
vi.mock("unpdf", async (importOriginal) => {
  const real: any = await importOriginal();
  const { createCanvas } = await import("@napi-rs/canvas");
  const white = () => { const c = createCanvas(400, 400), x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 400, 400); const b = c.toBuffer("image/png"); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  return { ...real, renderPageAsImage: async (_data: unknown, page: number, o: { scale?: number }) => { asked.push({ page, scale: o.scale ?? 1 }); return white(); } };
});
import { MAX_RENDER_PIXELS } from "../src/pdfDoc";
import { ocrPdf, ocrPdfRegions, ocrPdfWords, stopOcr } from "../src/ocr";
import { optimiseScannedPdf } from "../src/optimise";

afterAll(() => stopOcr());
const SIDE = 14_400;   // points: the largest page a PDF allows

test("a page that says it is enormous is drawn no larger than the pixel limit, by every reader that draws pages (code review, 16 Nov 2026, B-M4)", async () => {
  expect(MAX_RENDER_PIXELS).toBeLessThanOrEqual(60_000_000);   // below the limit for a picture (imageprep.ts), so a drawn page can still be cleaned
  const doc = await PDFDocument.create(); doc.addPage([SIDE, SIDE]); doc.addPage([595, 842]);
  const bytes = new Uint8Array(await doc.save());
  const steps: Record<string, () => Promise<unknown>> = {
    "OCR of a scan": () => ocrPdf(bytes, { maxPages: 2 }),
    "OCR with word positions": () => ocrPdfWords(bytes),
    "a closer look at part of a page": () => ocrPdfRegions(bytes, 1, [{ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }]),
    "making a scan smaller": () => optimiseScannedPdf(bytes),
  };
  const largest: Record<string, number> = {}, pages: Record<string, number[]> = {};
  for (const [name, step] of Object.entries(steps)) {
    const from = asked.length; await step().catch(() => {});
    const mine = asked.slice(from), huge = mine.filter((a) => a.page === 1);
    pages[name] = mine.map((a) => a.page);
    largest[name] = Math.max(0, ...huge.map((a) => Math.round(SIDE * a.scale) ** 2));
  }
  for (const name of Object.keys(steps)) expect(pages[name], `${name} drew no page: the test no longer watches it`).toContain(1);
  for (const [name, px] of Object.entries(largest)) expect(px, `${name} asked for ${(px / 1e6).toFixed(0)} million pixels`).toBeLessThanOrEqual(MAX_RENDER_PIXELS * 1.001);
  // An ordinary A4 page is drawn exactly as before: the limit only ever lowers the scale of a page too large for it.
  expect(asked.filter((a) => a.page === 2).map((a) => a.scale)).toContain(3.5);
}, 120_000);
