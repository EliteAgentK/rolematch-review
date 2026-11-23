import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import UTIF from "utif2";
import { expect, test } from "vitest";
import { sniff } from "../src/formats";
import { readDocument } from "../src/parse";
import { stopOcr } from "../src/ocr";
import { tiffPages } from "../src/tiff";
import { pageImages } from "./ocr/eval";

// An office scanner e-mails a TIFF; some tools save BMP or GIF. All are read by OCR like a photo.
async function tiffOf(png: Buffer) {
  const img = await loadImage(png), c = createCanvas(img.width, img.height), x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const rgba = x.getImageData(0, 0, img.width, img.height).data;
  return new Uint8Array(UTIF.encodeImage(new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), img.width, img.height));
}

test("TIFF, BMP and GIF are recognised from their first bytes", async () => {
  expect(sniff(new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0]))).toBe("tiff");
  expect(sniff(new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0]))).toBe("tiff");
  expect(sniff(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"))).toBe("gif");
  const bmp = new Uint8Array(60); bmp[0] = 0x42; bmp[1] = 0x4d; expect(sniff(bmp)).toBe("bmp");
});

test("a scanned CV saved as TIFF is read, page by page", async () => {
  // a committed, invented sample: the generated messy corpus (test/messy/files) is git-ignored, so a clean checkout such as CI does not have it
  const pdf = new Uint8Array(readFileSync(new URL("../../sample-documents/cvs/cv06-aisha-patel.pdf", import.meta.url)));
  const png = (await pageImages(pdf))[0];
  const tiff = await tiffOf(png);
  expect(sniff(tiff)).toBe("tiff");
  const { pages, total } = tiffPages(tiff, 12);
  expect(total).toBe(1); expect(pages.length).toBe(1);
  const r = await readDocument(tiff, "tiff");
  // What this test is about: a TIFF is decoded and read page by page. The page's large name heading is NOT read from this render ("CA | CA"); that is an OCR
  // weakness with large display type, recorded as R42 rather than hidden here.
  expect(r.text).toMatch(/aisha\.patel@example\.test/i);
  expect(r.text).toMatch(/Digital Marketing Manager/i);
  expect(r.text).toMatch(/Shelf Space/i);
  await stopOcr();
}, 120_000);

// A multi-page TIFF is decoded one page at a time (code review, 16 Nov 2026, B-M5). Every page used to be decoded first and all of them held until the
// last was done, so a small file of many large blank pages took gigabytes: 24 blank pages of 12 million pixels raised the reading process's peak memory by
// 2,069 MB. The probe reads in a process of its own, so the peak it reports is the reading's alone.
test("reading a many-page TIFF holds one page at a time: its memory does not grow with the number of pages (code review, 16 Nov 2026, B-M5)", async () => {
  const { spawnProc } = await import("./helpers");
  const run = async (pages: number) => { const p = spawnProc(["tsx", "test/probes/tiffMemoryProbe.ts", "run", String(pages)]); const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]); expect(code, err.slice(-600)).toBe(0); return JSON.parse(out.trim().split("\n").pop()!); };
  const [few, many] = [await run(8), await run(32)];
  expect([few.read, many.read]).toEqual([8, 32]);
  expect(many.roseMb, `8 pages raised the peak by ${few.roseMb} MB, 32 by ${many.roseMb} MB`).toBeLessThan(700);
  expect(many.roseMb - few.roseMb).toBeLessThan(200);   // four times the pages, not four times the memory
}, 180_000);

test("which pages of a TIFF are read is decided from its tags before any is decoded: at most the page bound, and no more pixels than the total limit (code review, 16 Nov 2026, B-M5)", async () => {
  const { blankTiff } = await import("./probes/tiffMemoryProbe");
  const { tiffFrames, MAX_TOTAL_PIXELS } = await import("../src/tiff");
  const t0 = performance.now();
  const big = tiffFrames(blankTiff(200, 3000, 4000), 500);   // 200 pages of 12 million pixels: 2,400 million in all
  expect(big).toMatchObject({ total: 200, reading: Math.floor(MAX_TOTAL_PIXELS / 12_000_000) });
  expect(tiffFrames(blankTiff(20, 3000, 4000), 5)).toMatchObject({ total: 20, reading: 5 });
  expect(performance.now() - t0).toBeLessThan(2000);   // nothing was decoded to decide it
  // a page past the limit for one page is refused before anything is decoded, as before
  expect(() => tiffFrames(blankTiff(1, 8000, 8000), 1)).toThrow(/very large/);
}, 120_000);

test("a damaged TIFF is refused with a plain reason", async () => {
  const junk = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
  await expect(readDocument(junk, "tiff")).rejects.toThrow(/TIFF|image/i);
});
