// TIFF scans (multi-page TIFF is what an office scanner e-mails). Each page is decoded to a PNG so it goes through the same OCR as a photo.
// Decoder: utif2 (MIT), pure JavaScript, no native code.
import { createCanvas, ImageData, type Canvas } from "@napi-rs/canvas";
import UTIF from "utif2";

const MAX_PIXELS = 60_000_000; // a page larger than this is refused rather than decoded into memory

export class TiffError extends Error {
  constructor(
    public code: "TOO_LARGE" | "UNREADABLE",
    message: string,
  ) {
    super(message);
  }
}

/** Validate directory graph and all declared value ranges BEFORE the third-party decoder follows pointers or allocates arrays. */
function preflight(bytes: Uint8Array) {
  if (bytes.length < 8 || bytes.length > 50 * 1024 * 1024)
    throw new TiffError("UNREADABLE", "Invalid TIFF byte length.");
  const le = bytes[0] === 73 && bytes[1] === 73;
  if (!le && !(bytes[0] === 77 && bytes[1] === 77))
    throw new TiffError("UNREADABLE", "Invalid TIFF byte order.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (n: number) => view.getUint16(n, le),
    u32 = (n: number) => view.getUint32(n, le);
  if (u16(2) !== 42)
    throw new TiffError("UNREADABLE", "Only classic TIFF is supported.");
  const seen = new Set<number>(),
    sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  let values = 0;
  const walk = (offset: number, depth: number) => {
    while (offset) {
      if (
        depth > 32 ||
        seen.size >= 4096 ||
        seen.has(offset) ||
        offset < 8 ||
        offset + 2 > bytes.length
      )
        throw new TiffError(
          "UNREADABLE",
          "Cyclic, excessive or invalid TIFF directory.",
        );
      seen.add(offset);
      const count = u16(offset),
        end = offset + 2 + count * 12;
      if (end + 4 > bytes.length)
        throw new TiffError("UNREADABLE", "Truncated TIFF directory.");
      for (let i = 0; i < count; i++) {
        const at = offset + 2 + i * 12,
          tag = u16(at),
          type = u16(at + 2),
          n = u32(at + 4),
          size = sizes[type];
        values += n;
        if (!size || values > 2_000_000)
          throw new TiffError(
            "TOO_LARGE",
            "TIFF metadata exceeds safety budget.",
          );
        const length = n * size,
          start = length <= 4 ? at + 8 : u32(at + 8);
        if (start + length > bytes.length)
          throw new TiffError(
            "UNREADABLE",
            "TIFF value extends beyond the file.",
          );
        if (tag === 50740 || tag === 61440)
          throw new TiffError(
            "UNREADABLE",
            "Unsupported private TIFF directory. Save this scan as a PDF.",
          );
        if ([330, 34665, 34853].includes(tag)) {
          if (![3, 4, 13].includes(type))
            throw new TiffError(
              "UNREADABLE",
              "Invalid TIFF subdirectory pointer.",
            );
          for (let j = 0; j < n; j++)
            walk(
              size === 2 ? u16(start + j * 2) : u32(start + j * 4),
              depth + 1,
            );
        }
      }
      offset = u32(end);
    }
  };
  walk(u32(4), 0);
}

/** All the pages of one TIFF together may hold at most this many pixels; pages past it are not read, and the reader says so, as it does for the page bound.
 *  Each page is decoded only when it is read (below), so this bounds the work, not the memory: about 230 A4 pages scanned at 300 dpi. */
export const MAX_TOTAL_PIXELS = 2_000_000_000;

/**
 * The pages of a TIFF, decoded one at a time as they are asked for: each page is decoded, turned into a PNG and its decoded pixels released before the next
 * is touched. Every page used to be decoded first and all of them held until the last was done (the decoder keeps each page's pixels on its directory), so a
 * small file of many large blank pages could take gigabytes (code review, 16 Nov 2026, B-M5). Sizes are checked from the tags before anything is decoded:
 * a page over MAX_PIXELS is refused, at most `maxPages` pages are read, and no more pages than fit in MAX_TOTAL_PIXELS together. `total` is every page.
 */
export function tiffFrames(bytes: Uint8Array, maxPages: number): { frames: Generator<Buffer>; total: number; reading: number } {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 500)
    throw new TiffError("UNREADABLE", "Invalid TIFF page budget.");
  preflight(bytes);
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  let ifds;
  const decode = UTIF.decode as (
    buffer: ArrayBuffer,
    options: { parseMN: boolean; debug: boolean },
  ) => ReturnType<typeof UTIF.decode>;
  try {
    ifds = decode(buf, { parseMN: false, debug: false });
  } catch {
    throw new TiffError(
      "UNREADABLE",
      "The TIFF could not be opened. It may be corrupted.",
    );
  }
  // the size is in the tags until a page is decoded (256 = width, 257 = height)
  const sizeOf = (p: any): [number, number] => [
    Number(p.t256?.[0] ?? p.width ?? 0),
    Number(p.t257?.[0] ?? p.height ?? 0),
  ];
  const real = ifds.filter((p) => {
    const [w, h] = sizeOf(p);
    return w > 0 && h > 0;
  });
  if (!real.length)
    throw new TiffError(
      "UNREADABLE",
      "The TIFF has no pages that can be read.",
    );
  // Which pages will be read, decided from the tags alone.
  const chosen: typeof real = [];
  let pixels = 0;
  for (const ifd of real.slice(0, maxPages)) {
    const [w, h] = sizeOf(ifd);
    if (w * h > MAX_PIXELS)
      throw new TiffError(
        "TOO_LARGE",
        `A page of this TIFF is very large (${w} x ${h} pixels). Scan at a lower resolution (200 to 300 dpi is enough) or save it as a PDF.`,
      );
    if (chosen.length && pixels + w * h > MAX_TOTAL_PIXELS) break;
    pixels += w * h;
    chosen.push(ifd);
  }
  function* frames(): Generator<Buffer> {
    // One canvas for pages of one size: a canvas's pixels live outside the JavaScript heap, where the garbage collector does not see their weight, so a new
    // canvas a page piled up a page's worth of memory each until a collection happened to run.
    let canvas: Canvas | undefined;
    for (const ifd of chosen) {
      const [w, h] = sizeOf(ifd);
      try {
        UTIF.decodeImage(buf, ifd);
      } catch {
        throw new TiffError(
          "UNREADABLE",
          "A page of this TIFF could not be decoded.",
        );
      }
      const rgba = UTIF.toRGBA8(ifd);
      delete (ifd as any).data;   // the decoded page is let go at once, never held while the next is decoded
      const page: Canvas = canvas && canvas.width === w && canvas.height === h ? canvas : (canvas = createCanvas(w, h));
      // the page's pixels are drawn as they are, without a second copy; every pixel is replaced, so nothing of the previous page remains
      page.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
      yield page.toBuffer("image/png");
    }
  }
  return { frames: frames(), total: real.length, reading: chosen.length };
}

/** Every page to be read as a PNG, for callers that want them together (tests; the viewer takes only the first). Decoded one at a time all the same. */
export function tiffPages(bytes: Uint8Array, maxPages: number): { pages: Buffer[]; total: number } {
  const { frames, total } = tiffFrames(bytes, maxPages);
  return { pages: [...frames], total };
}
