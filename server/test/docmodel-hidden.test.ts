import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, expect, test, vi } from "vitest";
import { extractionConfig } from "../src/extractionConfig";
import { buildDocModel } from "../src/docmodel/model";
import * as ocr from "../src/ocr";
import { readDocument } from "../src/parse";
import { applyMisreadGlyphs, learnMisreadGlyphs } from "../src/visibility";

// Text marked as hidden is kept only when the rendered page shows the same words in the same place. Everything invented.
async function build(invisibleOnPages: number) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 0; n < Math.max(invisibleOnPages, 1); n++) {
    const page = pdf.addPage([595, 842]);
    for (let i = 0; i < 12; i++) page.drawText(`Visible line ${i} of an ordinary curriculum page with enough words`, { x: 50, y: 700 - i * 20, size: 11, font });
    if (n < invisibleOnPages) page.drawText("Sipho Dlamini", { x: 50, y: 780, size: 30, font, opacity: 0 });
  }
  return new Uint8Array(await pdf.save());
}
const lines = (m: Awaited<ReturnType<typeof buildDocModel>>) => m.pages.flatMap((p) => p.lines);
afterEach(() => vi.restoreAllMocks());

test("if the page cannot be read, marked text stays out", async () => {
  vi.spyOn(ocr, "ocrPdfWords").mockRejectedValue(new Error("no engine"));
  const m = await buildDocModel(await build(1), "pdf");
  expect(lines(m).some((l) => l.text.includes("Sipho"))).toBe(false);
  expect(m.hiddenText).toEqual({ seenOnPage: 0, excluded: 1, unchecked: 0 });
});

test("words read somewhere else on the page do not vouch for it", async () => {
  vi.spyOn(ocr, "ocrPdfWords").mockResolvedValue([{ page: 1, image: { width: 595, height: 842 }, words: [{ text: "Sipho", x0: 50, y0: 700, x1: 100, y1: 712 }, { text: "Dlamini", x0: 105, y0: 700, x1: 160, y1: 712 }] }]);
  const m = await buildDocModel(await build(1), "pdf");
  expect(lines(m).some((l) => l.text.includes("Sipho"))).toBe(false);
});

test("the same words in the same place are kept, and carry both facts", async () => {
  vi.spyOn(ocr, "ocrPdfWords").mockResolvedValue([{ page: 1, image: { width: 595, height: 842 }, words: [{ text: "Sipho", x0: 50, y0: 40, x1: 130, y1: 62 }, { text: "Dlamini", x0: 135, y0: 40, x1: 240, y1: 62 }] }]);
  const m = await buildDocModel(await build(1), "pdf"), line = lines(m).find((l) => l.text.includes("Sipho"));
  expect(line?.markedHiddenButSeen).toBe(true);
  expect(m.hiddenText).toEqual({ seenOnPage: 1, excluded: 0, unchecked: 0 });
});

test("the number of pages read is bounded, and what was not checked stays out and is counted", async () => {
  const spy = vi.spyOn(ocr, "ocrPdfWords").mockResolvedValue([]), { maxPages } = extractionConfig.hiddenTextCheck;
  const m = await buildDocModel(await build(maxPages + 2), "pdf");
  expect(spy.mock.calls[0][1]).toEqual(Array.from({ length: maxPages }, (_, i) => i + 1));
  expect(m.hiddenText).toEqual({ seenOnPage: 0, excluded: maxPages, unchecked: 2 });
});

test("a PDF with nothing marked costs no reading at all", async () => {
  const spy = vi.spyOn(ocr, "ocrPdfWords");
  const m = await buildDocModel(await build(0), "pdf");
  expect(spy).not.toHaveBeenCalled();
  expect(m.hiddenText).toBeUndefined();
});

test("cleaning crops the page: a word is found in its place on the whole page, and the neighbouring line caught in the box does not count against it (register R142)", async () => {
  // The image starts 100 units across and 200 down the page. Marked at y 780 on an 842 page, size 30, so about 40 to 65 down the page.
  vi.spyOn(ocr, "ocrPdfWords").mockResolvedValue([{ page: 1, image: { width: 400, height: 600 }, frame: { x: 0, y: -10, width: 595, height: 842 }, words: [{ text: "Sipho", x0: 50, y0: 40, x1: 130, y1: 62 }, { text: "Dlamini", x0: 135, y0: 40, x1: 240, y1: 62 }, { text: "ge", x0: 60, y0: 68, x1: 70, y1: 74 }] }]);
  const m = await buildDocModel(await build(1), "pdf");
  expect(lines(m).some((l) => l.text.includes("Sipho Dlamini"))).toBe(true);
});
test("what the whole page misread gets a closer look, and a blank place stays blank", async () => {
  vi.spyOn(ocr, "ocrPdfWords").mockResolvedValue([{ page: 1, image: { width: 595, height: 842 }, words: [{ text: "5l0Da", x0: 50, y0: 40, x1: 130, y1: 62 }] }]);
  const spy = vi.spyOn(ocr, "ocrPdfRegions").mockResolvedValue(["Sipho Dlamini"]);
  expect(lines(await buildDocModel(await build(1), "pdf")).some((l) => l.text.includes("Sipho Dlamini"))).toBe(true);
  spy.mockResolvedValue([""]);
  expect(lines(await buildDocModel(await build(1), "pdf")).some((l) => l.text.includes("Sipho"))).toBe(false);
});
test("the plain reading and the layout reading agree on what is visible, from one check", async () => {
  const words = vi.spyOn(ocr, "ocrPdfWords").mockResolvedValue([{ page: 1, image: { width: 595, height: 842 }, words: [{ text: "Sipho", x0: 50, y0: 40, x1: 130, y1: 62 }, { text: "Dlamini", x0: 135, y0: 40, x1: 240, y1: 62 }] }]);
  const bytes = await build(1), read = await readDocument(bytes, "pdf");
  expect(read.text).toContain("Sipho Dlamini");
  expect(read.inspection?.hidden.length).toBe(0);
  const calls = words.mock.calls.length, m = await buildDocModel(bytes, "pdf", { visibility: read.visibility });
  expect(words.mock.calls.length).toBe(calls);
  expect(m.hiddenText?.seenOnPage).toBe(1);
});

test("a font's wrong codes are learned from the rendered page and corrected throughout, and nothing else is touched", () => {
  const native = "system administra9on and opera9ons at MicrosoB and SoB with B2B sales in Q4 and solu9ons";
  const map = learnMisreadGlyphs(native, ["administration", "operations", "Microsoft", "Soft", "solutions", "sales"]);
  expect(map.get("9")).toBe("ti");
  expect(map.get("B")).toBe("ft");
  expect(applyMisreadGlyphs(native, map)).toBe("system administration and operations at Microsoft and Soft with B2B sales in Q4 and solutions");
  expect(learnMisreadGlyphs("Windows10 and Office365 and Python3", ["Windows", "Office", "Python"]).size).toBe(0);
});
