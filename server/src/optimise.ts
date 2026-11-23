// Our own file-size optimiser. Large scanned PDFs are mostly page pictures stored far bigger than they need to be. We render each page
// at a sensible resolution, re-encode it as JPEG, and rebuild the PDF. It is built from permissively licensed parts only
// (pdf.js to read, Skia through @napi-rs/canvas to resample and encode, pdf-lib to write). A smaller file replaces the stored one ONLY if
// the words on the page still read the same afterwards; otherwise the original is kept. Text-based PDFs and Word files are left alone.
import { extractText } from "unpdf";
import { renderPage, withPdf } from "./pdfDoc";
import { stopIfAsked } from "./stopping";
import { decodePDFRawStream, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { zipSync } from "fflate";
import { unzipChecked } from "./readers";
import mammothText from "mammoth";
import { ocrPdf } from "./ocr";
import { sameJson } from "./sameJson";

export interface OptimiseOptions { dpi?: number; quality?: number; minAgreement?: number; /** the document's time ran out: stop between pages (code review, 16 Nov 2026, B-M3) */ signal?: AbortSignal }
export interface OptimiseResult { bytes: Uint8Array; before: number; after: number; pages: number; agreement: number }

/** A scan has pictures but almost no real text: fewer than 100 characters per page on average. */
export async function isScanned(bytes: Uint8Array): Promise<boolean> {
  return withPdf(bytes, async (pdf) => {   // closed again once read (code review, 16 Nov 2026, B-M6)
    const { text } = await extractText(pdf, { mergePages: true });
    const chars = (Array.isArray(text) ? text.join(" ") : text).replace(/\s+/g, "").length;
    return chars / Math.max(1, pdf.numPages) < 100;
  });
}

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{3,}/g) ?? []));
/** Share of the original's words that are still there afterwards (OCR is noisy, so this is a similarity, not an equality). */
function agreement(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size) return 1;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / A.size;
}

export async function optimiseScannedPdf(bytes: Uint8Array, opts: OptimiseOptions = {}): Promise<OptimiseResult | null> {
  const dpi = opts.dpi ?? 200, quality = Math.round((opts.quality ?? 0.62) * 100), minAgreement = opts.minAgreement ?? 0.9;
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const out = await PDFDocument.create();
  const pages = await withPdf(bytes, async (src) => { for (let p = 1; p <= src.numPages; p++) {
    stopIfAsked(opts.signal);
    const page = await src.getPage(p);
    const [x0, y0, x1, y1] = page.view as number[];
    const widthPt = x1 - x0, heightPt = y1 - y0;
    const { png } = await renderPage(bytes, src, p, dpi / 72);   // never larger than MAX_RENDER_PIXELS (code review, 16 Nov 2026, B-M4)
    const img = await loadImage(Buffer.from(png));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, img.width, img.height); // JPEG has no transparency
    ctx.drawImage(img, 0, 0);
    const jpg = canvas.toBuffer("image/jpeg", quality);
    const embedded = await out.embedJpg(jpg);
    out.addPage([widthPt, heightPt]).drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });
  } return src.numPages; });   // closed again once rendered (code review, 16 Nov 2026, B-M6)
  const smaller = new Uint8Array(await out.save());
  if (smaller.length >= bytes.length * 0.9) return null; // not worth replacing
  // Prove the words survived: compare what OCR reads on the first pages of each.
  const [a, b] = [await ocrPdf(bytes, { maxPages: 2, signal: opts.signal }), await ocrPdf(smaller, { maxPages: 2, signal: opts.signal })];
  const agree = agreement(a.text, b.text);
  if (agree < minAgreement) return null;
  return { bytes: smaller, before: bytes.length, after: smaller.length, pages, agreement: agree };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Phase 2: documents that DO have real text but carry large photos (a profile picture, a pasted screenshot, a portfolio image).
// Only the pictures are shrunk. The text is never touched, and the result is accepted only if it reads exactly the same.
// ---------------------------------------------------------------------------------------------------------------------------

const IMAGE_FLOOR = 120 * 1024; // pictures smaller than this are left exactly as they are
const MAX_SIDE = 1600;          // a CV photo never needs more than this on its longest side
const JPEG_QUALITY = 72;

interface Shrunk { jpeg: Buffer; width: number; height: number }

/** Resample to at most MAX_SIDE on the longest side and encode as JPEG. Returns null if it would not get meaningfully smaller. */
async function shrink(decoded: { data: Uint8Array | Buffer; format: "jpeg" | "png" } | { rgba: Uint8Array; width: number; height: number }, originalBytes: number): Promise<Shrunk | null> {
  const { createCanvas, loadImage, ImageData } = await import("@napi-rs/canvas");
  let srcW: number, srcH: number, draw: (ctx: any, w: number, h: number) => void;
  if ("rgba" in decoded) {
    srcW = decoded.width; srcH = decoded.height;
    const full = createCanvas(srcW, srcH); full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(decoded.rgba), srcW, srcH), 0, 0);
    draw = (ctx, w, h) => ctx.drawImage(full, 0, 0, w, h);
  } else {
    const img = await loadImage(Buffer.from(decoded.data));
    srcW = img.width; srcH = img.height;
    draw = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale));
  const canvas = createCanvas(w, h); const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); draw(ctx, w, h);
  const jpeg = canvas.toBuffer("image/jpeg", JPEG_QUALITY);
  return jpeg.length < originalBytes * 0.85 ? { jpeg, width: w, height: h } : null;
}

const num = (o: any) => (o instanceof PDFNumber ? o.asNumber() : NaN);
const filterOf = (stream: PDFRawStream) => { const f: any = stream.dict.get(PDFName.of("Filter")); return f ? (f.asArray ? f.asArray().map(String).join(",") : String(f)) : ""; };

/** Text-based PDF: replace oversized embedded pictures with smaller JPEGs, leave everything else byte-for-byte. */
export async function optimiseTextPdf(bytes: Uint8Array): Promise<OptimiseResult | null> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  let changed = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (String(d.get(PDFName.of("Subtype"))) !== "/Image" || obj.contents.length < IMAGE_FLOOR) continue;
    // Only plain colour pictures: anything with transparency, masks, odd colour spaces or channel depths is left alone.
    if (d.has(PDFName.of("SMask")) || d.has(PDFName.of("Mask")) || d.has(PDFName.of("Decode")) || String(d.get(PDFName.of("ImageMask"))) === "true") continue;
    const cs = String(d.get(PDFName.of("ColorSpace")));
    const w = num(d.get(PDFName.of("Width"))), h = num(d.get(PDFName.of("Height")));
    if (!Number.isFinite(w) || !Number.isFinite(h) || (cs !== "/DeviceRGB" && cs !== "/DeviceGray")) continue;
    const filter = filterOf(obj);
    try {
      let result: Shrunk | null = null;
      if (filter === "/DCTDecode") result = await shrink({ data: obj.contents, format: "jpeg" }, obj.contents.length);
      else if (num(d.get(PDFName.of("BitsPerComponent"))) === 8 && /^\/(FlateDecode)?$/.test(filter)) {
        const raw = decodePDFRawStream(obj).decode();
        const channels = cs === "/DeviceRGB" ? 3 : 1;
        if (raw.length < w * h * channels) continue;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0, p = 0; i < w * h; i++, p += 4) { const s = i * channels; rgba[p] = raw[s]; rgba[p + 1] = channels === 3 ? raw[s + 1] : raw[s]; rgba[p + 2] = channels === 3 ? raw[s + 2] : raw[s]; rgba[p + 3] = 255; }
        result = await shrink({ rgba, width: w, height: h }, obj.contents.length);
      }
      if (!result) continue;
      const dict = ctx.obj({ Type: "XObject", Subtype: "Image", Width: result.width, Height: result.height, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode", Length: result.jpeg.length });
      ctx.assign(ref, PDFRawStream.of(dict as any, new Uint8Array(result.jpeg)));
      changed++;
    } catch { /* a picture we cannot decode is simply left as it is */ }
  }
  if (!changed) return null;
  const smaller = new Uint8Array(await doc.save());
  if (smaller.length >= bytes.length * 0.9) return null;
  // The text layer must be exactly the same, page for page.
  // Each opened only for its text and closed again (code review, 16 Nov 2026, B-M6).
  const textOf = (b: Uint8Array) => withPdf(b, async (pdf) => ({ pages: pdf.numPages, text: (await extractText(pdf, { mergePages: true })).text }));
  const [ta, tb] = [await textOf(bytes), await textOf(smaller)];
  if (ta.pages !== tb.pages || !sameJson(ta.text, tb.text)) return null;
  return { bytes: smaller, before: bytes.length, after: smaller.length, pages: ta.pages, agreement: 1 };
}

/** Word file: shrink the pictures inside it (word/media), keep every other part untouched, and accept only if the text reads the same.
 *  An opaque PNG (a pasted screenshot or photo) becomes a JPEG, which is far smaller; every reference to it is updated. A PNG with
 *  transparency stays a PNG. */
export async function optimiseDocx(bytes: Uint8Array): Promise<OptimiseResult | null> {
  const files = unzipChecked(bytes);
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const renamed = new Map<string, string>(); // old media name -> new media name (e.g. image2.png -> image2.jpeg)
  const replaced = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    const ext = name.toLowerCase().match(/^word\/media\/.+\.(jpe?g|png)$/)?.[1];
    if (!ext || data.length < IMAGE_FLOOR) continue;
    try {
      const img = await loadImage(Buffer.from(data));
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const canvas = createCanvas(w, h); const ctx = canvas.getContext("2d");
      let encoded: Buffer | null = null, newName = name;
      if (ext === "png") {
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let opaque = true; for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { opaque = false; break; }
        if (opaque) { encoded = canvas.toBuffer("image/jpeg", JPEG_QUALITY); newName = name.replace(/\.png$/i, ".jpeg"); }
        else encoded = canvas.toBuffer("image/png"); // transparent: keep it a PNG
      } else {
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        encoded = canvas.toBuffer("image/jpeg", JPEG_QUALITY);
      }
      if (encoded && encoded.length < data.length * 0.85) { replaced.set(name, new Uint8Array(encoded)); if (newName !== name) renamed.set(name, newName); }
    } catch { /* a picture we cannot decode is left as it is */ }
  }
  if (!replaced.size) return null;
  const td = new TextDecoder(), te = new TextEncoder();
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, data] of Object.entries(files)) {
    if (replaced.has(name)) { out[renamed.get(name) ?? name] = [replaced.get(name)!, { level: 0 }]; continue; }
    let body = data;
    if (renamed.size && /\.rels$/i.test(name)) { // point every relationship at the renamed picture
      let xml = td.decode(data);
      for (const [from, to] of renamed) xml = xml.split("media/" + from.replace(/^word\/media\//, "")).join("media/" + to.replace(/^word\/media\//, ""));
      body = te.encode(xml);
    }
    if (renamed.size && name === "[Content_Types].xml") { // the new file type must be declared
      let xml = td.decode(data);
      if (!/Extension="jpe?g"/i.test(xml)) xml = xml.replace(/<Default /, '<Default Extension="jpeg" ContentType="image/jpeg"/><Default ');
      body = te.encode(xml);
    }
    out[name] = [body, { level: /\.(jpe?g|png|gif)$/i.test(name) ? 0 : 6 }];
  }
  const smaller = zipSync(out as any);
  if (smaller.length >= bytes.length * 0.9) return null;
  // The words must read exactly the same, and the pictures must still be found by the reader.
  const [ta, tb] = [await mammothText.extractRawText({ buffer: Buffer.from(bytes) }), await mammothText.extractRawText({ buffer: Buffer.from(smaller) })];
  if (ta.value !== tb.value) return null;
  const imgs = async (b: Uint8Array) => { let n = 0; await mammothText.convertToHtml({ buffer: Buffer.from(b) }, { convertImage: mammothText.images.imgElement(async () => { n++; return { src: "" }; }) }); return n; };
  if ((await imgs(bytes)) !== (await imgs(smaller))) return null;
  return { bytes: smaller, before: bytes.length, after: smaller.length, pages: 0, agreement: 1 };
}
