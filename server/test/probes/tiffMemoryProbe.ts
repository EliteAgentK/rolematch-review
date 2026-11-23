// Run by tiff.test.ts in a process of its own, so its peak memory is its own (code review, 16 Nov 2026, B-M5): an invented multi-page TIFF of blank
// 12-million-pixel pages, each page's strip PackBits-compressed and shared by every page, so the file is small and every page decodes in full. It reads
// every page the way the reader does and says how far the process's peak memory rose while it did.
import { tiffFrames } from "../../src/tiff";

/** A classic little-endian TIFF: `pages` directories of 8-bit grey, all pointing at one PackBits strip of white rows. */
export function blankTiff(pages: number, w: number, h: number): Uint8Array {
  const row: number[] = []; for (let left = w; left > 0; left -= 128) row.push(257 - Math.min(128, left), 255);   // a run of up to 128 white pixels
  const strip = new Uint8Array(row.length * h); for (let y = 0; y < h; y++) strip.set(row, y * row.length);
  const tags = 9, ifdSize = 2 + tags * 12 + 4, stripAt = 8, firstIfd = stripAt + strip.length + (strip.length % 2);
  const out = new Uint8Array(firstIfd + pages * ifdSize), v = new DataView(out.buffer);
  out.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, firstIfd, true); out.set(strip, stripAt);
  for (let p = 0; p < pages; p++) {
    let at = firstIfd + p * ifdSize; v.setUint16(at, tags, true); at += 2;
    const tag = (id: number, type: 3 | 4, value: number) => { v.setUint16(at, id, true); v.setUint16(at + 2, type, true); v.setUint32(at + 4, 1, true); type === 3 ? v.setUint16(at + 8, value, true) : v.setUint32(at + 8, value, true); at += 12; };
    tag(256, 4, w); tag(257, 4, h); tag(258, 3, 8); tag(259, 3, 32773); tag(262, 3, 1); tag(273, 4, stripAt); tag(277, 3, 1); tag(278, 4, h); tag(279, 4, strip.length);
    v.setUint32(at, p + 1 < pages ? firstIfd + (p + 1) * ifdSize : 0, true);
  }
  return out;
}

if (process.argv[2] === "run") {
  const pages = Number(process.argv[3] ?? 24), bytes = blankTiff(pages, 3000, 4000);
  const before = process.resourceUsage().maxRSS;
  let read = 0;
  for (const png of tiffFrames(bytes, 500).frames) if (png.length) read++;
  console.log(JSON.stringify({ pages, read, roseMb: Math.round((process.resourceUsage().maxRSS - before) / 1024) }));
}
