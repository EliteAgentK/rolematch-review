import { expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
const text =
  "Thandi Mokoena\nSoftware Developer\nthandi@example.test\nSummary\nBuilds reliable software for local organisations and maintains production web applications.\nSkills\nType\u200bScript, React, Node.js\nExperience\nDeveloper, Acme (2020 - Present)";
vi.mock("../src/ocr", () => ({
  ocrImage: vi.fn(async () => ({
    text,
    confidence: 0.99,
    pages: 1,
    totalPages: 1,
  })),
  ocrPdf: vi.fn(async () => ({
    text,
    confidence: 0.99,
    pages: 1,
    totalPages: 1,
  })),
  cleanOcr: (s: string) => s,
}));
import { readDocument } from "../src/parse";
test("image OCR result crosses the same character normalisation boundary", async () => {
  const r = await readDocument(Buffer.from("mock image"), "png");
  expect(r.text).toContain("TypeScript");
  expect(r.text).not.toContain("\u200b");
});
test("scanned-PDF replacement OCR crosses the same character normalisation boundary", async () => {
  const p = await PDFDocument.create();
  p.addPage();
  const r = await readDocument(await p.save(), "pdf");
  expect(r.text).toContain("TypeScript");
  expect(r.text).not.toContain("\u200b");
});
