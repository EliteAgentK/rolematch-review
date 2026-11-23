// Optical character recognition for documents whose text cannot be read directly: scanned pages, phone photos, and PDFs
// whose embedded text is damaged. Everything runs inside this server (Tesseract compiled to WebAssembly, Apache-2.0, with its
// English and Afrikaans language data from npm), so no document ever leaves our infrastructure. See OcrEngine below for how to change engines.
import { createPaddleReader } from "./paddleOcr";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rtrim } from "./textsafe";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderPage, withPdf } from "./pdfDoc";
import { stopIfAsked } from "./stopping";
import { ImageTooLarge, prepareForOcr } from "./imageprep";
import { SKILLS } from "./skills";
import { wordChecks } from "./ocrQuality";
import { textFromPositions, type Item } from "./layout";

const require = createRequire(import.meta.url);
const MAX_OCR_PAGES = 30; // used only when a caller sets no ceiling; a CV passes no limit so every page is read (a few seconds a page)
const RENDER_SCALE = 3.5; // about 250 dpi: what OCR wants for 10pt text

export interface OcrResult { text: string; confidence: number; pages: number; totalPages: number; /** Things a person should know about how the page was read (two readings that disagree). Become reading issues, so the document is flagged for review. */ notes?: string[];
  /** The words of the same reading with their positions, so a later step never has to read the document again. */ pageWords?: OcrPageWords[] }

/** One recognised word and where it sits on the image (pixels, y grows downward). */
export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; /** The engine's own figure, 0..100, where it gives one. Not a measure of correctness. */ confidence?: number }
export interface Recognition { words: OcrWord[]; text: string; /** 0..1 */ confidence: number }

/**
 * An OCR engine reads one prepared page image. Everything else (cleaning the image, rendering PDF pages, laying out columns, quality
 * gates, repairs) is engine-independent, so changing or adding an engine means writing this one interface and registering it below,
 * and the evaluation harness (npm run eval:ocr) says whether it is better. Nothing else in the platform changes.
 */
export interface OcrEngine {
  name: string;
  recognise(image: Buffer, languages: string): Promise<Recognition>;
  stop(): Promise<void>;
}

/** The language files ship in npm packages (one per language), so nothing is downloaded. The engine wants them in one folder. */
function languageDirectory(langs: string[]): string {
  const from = (l: string) => dirname(require.resolve(`@tesseract.js-data/${l}/package.json`)) + "/4.0.0_best_int";
  if (langs.length === 1) return from(langs[0]);
  const dir = join(tmpdir(), "rolematch-ocr-" + langs.join("-"));
  mkdirSync(dir, { recursive: true });
  for (const l of langs) if (!existsSync(join(dir, `${l}.traineddata.gz`))) copyFileSync(join(from(l), `${l}.traineddata.gz`), join(dir, `${l}.traineddata.gz`));
  return dir;
}

const workers = new Map<string, Promise<any>>();
const tesseract: OcrEngine = {
  name: "tesseract",
  async recognise(image, languages) {
    let w = workers.get(languages);
    if (!w) {
      w = (async () => {
        const { createWorker } = await import("tesseract.js");
        const langs = languages.split("+");
        const worker = await createWorker(langs, 1, { langPath: languageDirectory(langs), cacheMethod: "none", gzip: true });
        // Automatic page segmentation. The library's own default treats the page as one block of text and silently leaves out a large heading (such as the
        // candidate's name in capitals); automatic segmentation reads it. Set explicitly so the behaviour never depends on a library default.
        await worker.setParameters({ tessedit_pageseg_mode: process.env.OCR_PSM ?? "3", ...(process.env.OCR_PARAMS ? JSON.parse(process.env.OCR_PARAMS) : {}) });   // the environment settings exist for measuring only
        return worker;
      })();
      workers.set(languages, w);
    }
    const { data } = await (await w).recognize(image, {}, { text: true, blocks: true });
    const words: OcrWord[] = (data.blocks ?? []).flatMap((blk: any) => blk.paragraphs.flatMap((p: any) => p.lines.flatMap((l: any) => l.words))).map((x: any) => ({ text: x.text, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1, confidence: x.confidence }));
    return { words, text: data.text ?? "", confidence: Math.round(data.confidence) / 100 };
  },
  async stop() { const all = [...workers.values()]; workers.clear(); await Promise.all(all.map(async (w) => (await w).terminate())); },
};

// PaddleOCR (PP-OCRv4, run through ONNX Runtime inside this server; wrapper MIT, models from PaddleOCR, Apache-2.0). A TRIAL engine, switched on only with
// OCR_ENGINE=paddle until it has been measured on real scans (npm run eval:ocr). It finds each line of text first and then reads it, which suits tables and
// columns, but its models are trained for English and Chinese: accented Afrikaans letters are the thing to check. Its recognition network reports a prediction per horizontal
// step, so words come back with real positions (and a gutter between two columns splits a line), which is what the column logic needs (paddleOcr.ts).
let paddle: Promise<any> | null = null;
const paddleEngine: OcrEngine = {
  name: "paddle",
  async recognise(image) {
    paddle ??= (async () => {
      // OCR_PADDLE_DIR points at a folder holding an English recognition model (en_PP-OCRv3_rec_infer.onnx) and its character list (en_dict.txt). Without it the
      // bundled Chinese-and-English model is used, which drops the spaces between English words. The wrapper adds the space character itself after the list, so
      // the list's final newline is removed (left in, it adds an empty entry before that space and shifts the space class; the list itself already contains a space entry, which must stay).
      const dir = process.env.OCR_PADDLE_DIR;
      const { default: bundled } = await import("@gutenye/ocr-models/node" as string);
      let models = { detectionPath: bundled.detectionPath as string, recognitionPath: bundled.recognitionPath as string, dictionaryPath: bundled.dictionaryPath as string };
      if (dir) {
        const dictionaryPath = join(dir, "dictionary.txt");
        writeFileSync(dictionaryPath, readFileSync(join(dir, "en_dict.txt"), "utf8").replace(/\n$/, ""));
        models = { ...models, recognitionPath: join(dir, "en_PP-OCRv3_rec_infer.onnx"), dictionaryPath };
      }
      return createPaddleReader(models);
    })();
    const ocr = await paddle;
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(image);
    // The line detector was trained on pages about 960 to 1500 px on the long edge, while the shared image preparation delivers about 3000 px (right for
    // Tesseract). The page is scaled down to the detector's size (OCR_PADDLE_LONG_EDGE, default 1280) and the boxes are scaled back up afterwards.
    const long = Math.max(img.width, img.height), target = Number(process.env.OCR_PADDLE_LONG_EDGE ?? 1280), sc = target > 0 && long > target ? target / long : 1;
    const w = Math.round(img.width * sc), h = Math.round(img.height * sc), c = createCanvas(w, h), ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const raw = ctx.getImageData(0, 0, w, h); // RGBA in memory: no temporary file ever holds a page
    const out = await ocr.read({ data: raw.data, width: raw.width, height: raw.height });
    const kx = img.width / out.width, ky = img.height / out.height; // positions are in the resized image's pixels, scaled back to the original
    // This English recognition model rarely puts a space after a comma ("Head of Growth,Shelf Space"): a letter straight after one of , ; : is given its space.
    // (A digit after a comma is left alone: "R180,000". Addresses never contain these marks.)
    // The detector's line boxes are padded (it grows its shrunken text region back out), so they come out about 1.6 times taller than the letters (median of 18
    // generated pages, measured against Tesseract's word boxes). The layout logic judges gaps against the text height, so the boxes are brought back to ink height.
    const GROWTH = 1.6;
    const words: OcrWord[] = out.lines.flatMap((l: any) => { const mid = ((l.y0 + l.y1) / 2) * ky, half = ((l.y1 - l.y0) * ky) / (2 * GROWTH); return l.words.map((x: any) => ({ text: x.text.replace(/([,;:])(?=\p{L})/gu, "$1 "), x0: x.x0 * kx, x1: x.x1 * kx, y0: mid - half, y1: mid + half })); });
    // A ruled vertical line between two columns is read as a column of bar characters, one per row, which fills the gutter the column logic looks for.
    // Bars that line up on the same x on four or more rows are a rule, not text, and are dropped; a bar between words on one row (a separator) stays.
    const bars = words.filter((w) => /^[|¦!]+$/.test(w.text)), bucket = (w: OcrWord) => Math.round(((w.x0 + w.x1) / 2) / (img.width / 100));
    const counts = new Map<number, number>(); for (const b of bars) counts.set(bucket(b), (counts.get(bucket(b)) ?? 0) + 1);
    const ruled = new Set([...counts].filter(([, n]) => n >= 4).map(([k]) => k));
    const kept = ruled.size ? words.filter((w) => !(/^[|¦!]+$/.test(w.text) && ruled.has(bucket(w)))) : words;
    const confidence = out.lines.length ? out.lines.reduce((a: number, l: any) => a + l.mean, 0) / out.lines.length : 0;
    return { words: kept, text: kept.map((w) => w.text).join(" "), confidence: Math.round(confidence * 100) / 100 };
  },
  async stop() { paddle = null; },
};

export const OCR_ENGINES: Record<string, OcrEngine> = { tesseract, paddle: paddleEngine };
/** OCR_ENGINE: "tesseract" (the default), "paddle", or "best": read every page with both and keep the clearer reading (see readPage). */
const engine = (): OcrEngine => OCR_ENGINES[process.env.OCR_ENGINE ?? "tesseract"] ?? tesseract;

export interface Reading { engine: string; text: string; confidence: number }

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const phoneKeys = (t: string) => new Set((t.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 9).map((d) => d.slice(-9)));
const emailKeys = (t: string) => new Set((t.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/[.,;]+$/, "")));

/**
 * Two readings of one page, one verdict. Each is scored by how plausible its words are (ocrQuality.ts: no dictionary, so names and tools are not punished)
 * times how much of the page it recovered (its word count against the larger reading: a reading that lost half the page cannot win by being tidy). The higher
 * score is kept; within 0.02 the first reading (the default engine) is kept, so a tie never changes behaviour. An engine's own confidence is not used to
 * choose: PaddleOCR reports 95 to 97% even where it recovered 71% of the words. Its reported confidence is capped by its plausibility score.
 * Any e-mail address or phone number found by one reading and not the other is returned as a note: those are the details a recruiter acts on, and a single
 * wrong character in them is costly, so a person is asked to check them against the original. Pure function: no model is run here.
 */
export function chooseReading(readings: Reading[], page = 1): { chosen: Reading; notes: string[]; scores: number[] } {
  const cleaned = readings.map((r) => cleanOcr(r.text)), checks = cleaned.map(wordChecks), most = Math.max(1, ...checks.map((c) => c.tokens));
  const scores = checks.map((c) => c.score * Math.min(1, c.tokens / most));
  let best = 0;
  for (let i = 1; i < readings.length; i++) if (scores[i] > scores[best] + 0.02) best = i;
  const chosen = { ...readings[best], confidence: best === 0 ? readings[best].confidence : Math.min(readings[best].confidence, checks[best].score) };
  const notes: string[] = [];
  if (readings.length > 1) {
    const mark = `Page ${page}:`;
    const [e0, e1] = [emailKeys(cleaned[0]), emailKeys(cleaned[1])], [p0, p1] = [phoneKeys(cleaned[0]), phoneKeys(cleaned[1])];
    const odd = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
    if (odd(e0, e1).length) notes.push(`${mark} two OCR readings disagree on the e-mail address (${[...e0].join(", ") || "none"} against ${[...e1].join(", ") || "none"}). Check it against the original before contacting the candidate.`);
    if (odd(p0, p1).length) notes.push(`${mark} two OCR readings disagree on a phone number. Check it against the original before calling.`);
  }
  return { chosen, notes, scores };
}

let paddleBroken = false;
/** One prepared page image to text. In "best" mode both engines read it and chooseReading decides; if the second engine cannot start, the first is used alone (and the reason is logged once). */
async function readPage(image: Buffer, page = 1): Promise<{ text: string; confidence: number; notes: string[]; engine: string; words: OcrWord[] }> {
  if ((process.env.OCR_ENGINE ?? "tesseract") !== "best" || paddleBroken) { const e = engine(), r = await e.recognise(image, languages()); return { words: r.words, text: textFromOcr(r), confidence: r.confidence, notes: [], engine: e.name }; } // "best" is not an engine of its own: engine() gives Tesseract
  const first = await tesseract.recognise(image, languages()), reads: Reading[] = [{ engine: "tesseract", text: textFromOcr(first), confidence: first.confidence }];
  try { const second = await paddleEngine.recognise(image, languages()); reads.push({ engine: "paddle", text: textFromOcr(second), confidence: second.confidence }); }
  catch (e) { paddleBroken = true; console.warn("OCR_ENGINE=best: the PaddleOCR engine could not start, so Tesseract reads alone:", e instanceof Error ? e.message : e); }
  const v = chooseReading(reads, page);
  return { text: v.chosen.text, confidence: v.chosen.confidence, notes: v.notes, engine: v.chosen.engine, words: first.words };
}
/** Which language data is loaded: "eng", or "eng+afr" for CVs in both. More languages read more text but cost a little accuracy and time. */
const languages = () => process.env.OCR_LANGUAGES ?? "eng+afr";

/**
 * Engines read a page as one block and may join words across a sidebar and the main column into the same line. They do report where
 * every word is, so the text is rebuilt from those positions with the same column logic the PDF reader uses.
 */
export function textFromOcr(r: Recognition): string {
  const usable = r.words.filter((w) => w.text?.trim());
  if (usable.length < 5) return r.text;
  const heights = usable.map((w) => w.y1 - w.y0).sort((a, b) => a - b), scale = 10 / Math.max(heights[Math.floor(heights.length / 2)], 1); // so a typical word is about 10 units tall, as in a PDF
  const pageH = Math.max(...usable.map((w) => w.y1));
  // Every word is placed by the CENTRE of its box and given the typical height (10), not its own: a word with a descender (g, y) or no
  // ascender, a dash or a bullet all have differently sized boxes, and using those would split one printed line into several.
  const items: Item[] = usable.map((w) => ({ s: w.text.trim(), x: w.x0 * scale, y: (pageH - (w.y0 + w.y1) / 2) * scale, w: (w.x1 - w.x0) * scale, h: 10 }));
  return textFromPositions(items);
}

let queue: Promise<unknown> = Promise.resolve();

/** One page at a time: OCR is CPU-heavy, so requests queue instead of competing. Work stopped while it waited never starts, so the queue moves on. */
const serial = <T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  const run = async () => { stopIfAsked(signal); return job(); };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
};

// Contact rescue. Small, light contact lines next to a dark band ("Gqeberha | name@domain | phone" under a grey header) are a known OCR weak
// spot: the first pass can drop them while reading everything around them. When page 1 yields no e-mail and no phone number, the top 30% of the
// page is read again on its own, enlarged twice, and only lines that really contain an e-mail address or a phone number are kept, placed after
// the page's first two lines (where they were). Nothing is invented: the kept lines are what the second reading saw.
const EMAIL_LIKE = /[\w.+-]+\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)+/, PHONE_LIKE = /(?:\+?\d[\d\s()-]{8,}\d)/;
export async function rescueContact(page: Buffer, text: string, pageNo: number, emailToo = false): Promise<{ text: string; note?: string; found?: string[] }> {
  // The candidate pipeline also looks again when a phone number was read but no whole address was: "1@candidate.example" is what is left of an address whose first letters were lost.
  const wholeAddress = text.match(EMAIL_LIKE)?.some((a) => /^[a-z]/i.test(a));
  if (emailToo ? wholeAddress : EMAIL_LIKE.test(text) || PHONE_LIKE.test(text)) return { text };
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(page), h = Math.round(img.height * 0.3);
    const c = createCanvas(img.width * 2, h * 2), ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, img.width, h, 0, 0, c.width, c.height);
    // PaddleOCR first: it finds each line before reading it, and it reads small grey text next to a dark band far better than Tesseract
    // (measured on the RoleMatch 300 pack, CV0565). Tesseract on the enlarged crop is the fallback when PaddleOCR is not available.
    const keep = (t: string) => t.split("\n").map((l) => l.trim()).filter((l) => EMAIL_LIKE.test(l) || PHONE_LIKE.test(l));
    let found: string[] = [];
    if (!paddleBroken) {
      try { const top = createCanvas(img.width, h); top.getContext("2d").drawImage(img, 0, 0, img.width, h, 0, 0, img.width, h); found = keep(textFromOcr(await paddleEngine.recognise(Buffer.from(await top.encode("png")), languages()))); }
      catch { /* PaddleOCR is optional: fall back to Tesseract */ }
    }
    if (!found.length) found = keep(textFromOcr(await tesseract.recognise(Buffer.from(await c.encode("png")), languages())));
    if (!found.length) return { text };
    const lines = text.split("\n");
    lines.splice(Math.min(2, lines.length), 0, ...found);
    return { text: lines.join("\n"), found, note: "The contact details were missed by the first reading and were read again from the top of the page; check them against the original." };
  } catch { return { text }; }
}

/** A row of the page that holds an e-mail address or a phone number, read again on its own. */
export interface ContactRow { y0: number; y1: number; readings: string[] }
const MAX_CONTACT_ROWS = 10;   // bounds the extra time on a document full of referees' details
const looksLikeContact = (t: string) => t.includes("@") || /\d[\d\s().+-]{7,}\d/.test(t);
/**
 * Contact details are read twice more, each time from the row alone: once enlarged threefold, and once enlarged twice with room below, so an address that wrapped in a narrow cell is seen whole. A word dropped or misread in a page
 * reading is often read correctly from the row, and two readings that agree are evidence one reading cannot give. What the readings mean is decided in docmodel/contactReadings.ts.
 */
async function closerLook(png: Buffer, words: OcrWord[], budget: { left: number }): Promise<ContactRow[]> {
  const usable = words.filter((w) => w.text?.trim()).sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1)), rows: OcrWord[][] = [];
  for (const w of usable) { const mid = (w.y0 + w.y1) / 2, row = rows.find((r) => Math.abs((r[0].y0 + r[0].y1) / 2 - mid) < (w.y1 - w.y0) * 0.6); if (row) row.push(w); else rows.push([w]); }
  const chosen = rows.filter((r) => looksLikeContact(r.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" ")));
  if (!chosen.length) return [];
  const { createCanvas, loadImage } = await import("@napi-rs/canvas"), img = await loadImage(png), out: ContactRow[] = [];
  const crop = async (y0: number, y1: number, scale: number) => { const h = y1 - y0, c = createCanvas(img.width * scale, Math.round(h * scale)), ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, y0, img.width, h, 0, 0, c.width, c.height); return Buffer.from(await c.encode("png")); };
  for (const r of chosen) {
    if (budget.left-- <= 0) break;
    const top = Math.min(...r.map((w) => w.y0)), bottom = Math.max(...r.map((w) => w.y1)), h = Math.max(bottom - top, 8), y0 = Math.max(0, top - h * 0.7), y1 = Math.min(img.height, bottom + h * 0.7), below = Math.min(img.height, bottom + h * 2.2);
    const near = (await tesseract.recognise(await crop(y0, y1, 3), languages())).text, wide = (await tesseract.recognise(await crop(y0, below, 2), languages())).text;
    out.push({ y0: top, y1: bottom, readings: [near, wide].map((t) => t.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")).filter(looksLikeContact) });
  }
  return out;
}

export function ocrPdf(bytes: Uint8Array, opts: { maxPages?: number; emailToo?: boolean; signal?: AbortSignal } = {}): Promise<OcrResult> {
  return serial(() => withPdf(bytes, async (pdf) => {   // closed again once read (code review, 16 Nov 2026, B-M6)
    const pages = Math.min(pdf.numPages, opts.maxPages ?? MAX_OCR_PAGES);
    const texts: string[] = [], notes: string[] = [], pageWords: OcrPageWords[] = [];
    let confSum = 0;
    const closer = { left: MAX_CONTACT_ROWS };
    for (let p = 1; p <= pages; p++) {
      stopIfAsked(opts.signal);
      const { png } = await renderPage(bytes, pdf, p, RENDER_SCALE);   // never larger than MAX_RENDER_PIXELS (code review, 16 Nov 2026, B-M4)
      const cleaned = await prepareForOcr(new Uint8Array(png), { exactPanels: opts.emailToo }).catch(() => null); // a scan can be crooked or shadowed too
      const r = await readPage(cleaned ? cleaned.png : Buffer.from(png), p);
      const rescued: { text: string; note?: string; found?: string[] } = p === 1 ? await rescueContact(Buffer.from(png), r.text, p, opts.emailToo) : { text: r.text };
      const contactRows = opts.emailToo && cleaned ? await closerLook(cleaned.png, r.words, closer).catch(() => []) : [];
      pageWords.push({ page: p, words: r.words, ...(rescued.found?.length ? { rereadLines: rescued.found } : {}), ...(contactRows.length ? { contactRows } : {}) });
      texts.push(rescued.text);
      confSum += r.confidence;
      notes.push(...r.notes, ...(rescued.note ? [rescued.note] : []));
    }
    return { text: texts.join("\n"), confidence: Math.round((confSum / pages) * 100) / 100, pages, totalPages: pdf.numPages, pageWords, ...(notes.length ? { notes } : {}) };
  }), opts.signal);
}

/** The words and where they sit, per page, for the document-model prototype (src/docmodel). The same cleaning and engine as ocrPdf and ocrImage, without flattening. */
export interface OcrPageWords { page: number; width?: number; height?: number; /** The size of the image the words' positions refer to. */ image?: { width: number; height: number }; /** Where that image sits on the whole page, when cleaning cropped it. */ frame?: { x: number; y: number; width: number; height: number }; words: OcrWord[]; /** Contact lines read in a second, enlarged look at the top of the page. */ rereadLines?: string[]; contactRows?: ContactRow[] }
/** `signal`: the caller no longer wants the words (its time ran out); the reading stops after the page under way (code review, 16 Nov 2026, B-M7). */
export function ocrPdfWords(bytes: Uint8Array, only?: number[], signal?: AbortSignal): Promise<OcrPageWords[]> {
  return serial(() => withPdf(bytes, async (pdf) => {   // closed again once read (code review, 16 Nov 2026, B-M6)
    const out: OcrPageWords[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (only && !only.includes(p)) continue;
      stopIfAsked(signal);
      const { png, scale } = await renderPage(bytes, pdf, p, RENDER_SCALE);   // never larger than MAX_RENDER_PIXELS (code review, 16 Nov 2026, B-M4)
      const cleaned = await prepareForOcr(new Uint8Array(png)).catch(() => null);
      const view = (await pdf.getPage(p)).getViewport({ scale });   // the scale it was really drawn at
      out.push({ page: p, image: cleaned ? { width: cleaned.width, height: cleaned.height } : { width: view.width, height: view.height }, ...(cleaned ? { frame: cleaned.frame } : {}), words: (await engine().recognise(cleaned ? cleaned.png : Buffer.from(png), languages())).words });
    }
    return out;
  }), signal);
}
/** A closer look at places on a PDF page: each cut out of the rendered page, enlarged, light on dark turned round, and read on its own. Boxes are shares of the page (0 to 1). */
export function ocrPdfRegions(bytes: Uint8Array, page: number, boxes: { x0: number; y0: number; x1: number; y1: number }[]): Promise<string[]> {
  return serial(async () => {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    // never larger than MAX_RENDER_PIXELS (code review, 16 Nov 2026, B-M4); the boxes are shares of the page, so the scale it was drawn at does not move them
    const img = await loadImage(Buffer.from((await withPdf(bytes, (pdf) => renderPage(bytes, pdf, page, RENDER_SCALE))).png)), out: string[] = [], quietEdge = 24;
    for (const b of boxes) {
      const x = Math.max(0, Math.floor(b.x0 * img.width)), y = Math.max(0, Math.floor(b.y0 * img.height)), w = Math.min(img.width - x, Math.ceil((b.x1 - b.x0) * img.width)), h = Math.min(img.height - y, Math.ceil((b.y1 - b.y0) * img.height));
      if (w < 1 || h < 1) { out.push(""); continue; }
      // enlarged threefold, unless that would make a picture larger than a photo may be (60 million pixels, imageprep.ts): only a region bigger than a whole
      // A4 page drawn for OCR is enlarged less (code review, 16 Nov 2026, B-M4)
      const enlarge = Math.min(3, Math.sqrt(60_000_000 / (w * h))), ew = Math.round(w * enlarge), eh = Math.round(h * enlarge);
      const c = createCanvas(ew + quietEdge * 2, eh + quietEdge * 2), ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, x, y, w, h, quietEdge, quietEdge, ew, eh);
      const px = ctx.getImageData(quietEdge, quietEdge, ew, eh), d = px.data; let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (sum / (d.length / 4) < 128) { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } ctx.putImageData(px, quietEdge, quietEdge); }
      out.push((await tesseract.recognise(Buffer.from(await c.encode("png")), languages())).text.split("\n").map((l) => l.trim()).filter(Boolean).join(" "));
    }
    return out;
  });
}
export function ocrPageWords(bytes: Uint8Array, signal?: AbortSignal): Promise<OcrPageWords[]> {
  return serial(async () => { const cleaned = await prepareForOcr(bytes).catch(() => null); stopIfAsked(signal); return [{ page: 1, words: (await engine().recognise(cleaned ? cleaned.png : Buffer.from(bytes), languages())).words }]; }, signal);
}

export function ocrImage(bytes: Uint8Array, page = 1, opts: { emailToo?: boolean; signal?: AbortSignal } = {}): Promise<OcrResult> {
  return serial(async () => {
    // a refusal for size is final: falling back to the raw bytes would decode the very image that was refused
    const cleaned = await prepareForOcr(bytes, { exactPanels: opts.emailToo }).catch((e) => { if (e instanceof ImageTooLarge) throw e; return null; });
    const r = await readPage(cleaned ? cleaned.png : Buffer.from(bytes), page);
    const rescued: { text: string; note?: string; found?: string[] } = page === 1 ? await rescueContact(cleaned ? cleaned.png : Buffer.from(bytes), r.text, page, opts.emailToo) : { text: r.text };
    const notes = [...r.notes, ...(rescued.note ? [rescued.note] : [])];
    const contactRows = opts.emailToo && cleaned ? await closerLook(cleaned.png, r.words, { left: MAX_CONTACT_ROWS }).catch(() => []) : [];
    return { text: rescued.text, confidence: r.confidence, pages: 1, totalPages: 1, pageWords: [{ page, words: r.words, ...(rescued.found?.length ? { rereadLines: rescued.found } : {}), ...(contactRows.length ? { contactRows } : {}) }], ...(notes.length ? { notes } : {}) };
  }, opts.signal);
}

// OCR drops the small dots in an e-mail address and leaves a space ("aisha patel @example test"), so the address no longer reads as one.
// A dot is put back only where the document itself supports it: the words before the @ must be the candidate's own name (read from the
// top of the page), and the ending must be a real top-level domain. Nothing is invented.
const TLD = "co\\s*[. ]\\s*za|ac\\s*[. ]\\s*za|org\\s*[. ]\\s*za|gov\\s*[. ]\\s*za|com|org|net|edu|gov|io|info|biz|africa|test|za";
export const levenshtein = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/** A number with a letter in it is a number: "l06", "ll4", "5i8", "2O21". Letters alone say nothing. For the part of an address after a separator; a first word could be anything. */
export const digitsMisreadAsLetters = (part: string) => part.length >= 3 && /\d/.test(part) && /^[\dilIOo|]+$/.test(part) ? part.replace(/[ilI|]/g, "1").replace(/[Oo]/g, "0") : part;
export const addressWithDigits = (address: string) => { const [local, domain] = address.split("@"); return `${local.split(/([._-])/).map((p, at) => (at > 0 ? digitsMisreadAsLetters(p) : p)).join("")}@${domain}`; };
export function repairEmails(text: string): string {
  const head = text.split("\n").map((l) => l.trim()).filter((l) => l && !/[@\d]/.test(l)).slice(0, 2).join(" ").toLowerCase(); // the name is at the top, on a line with no address or number
  const nameWords = new Set(head.split(/[^a-z\u00e0-\u00ff]+/).filter((w) => w.length > 1));
  return text.split("\n").map((line) => {
    if (!line.includes("@")) return line;
    // domain: "@example test" or "@example. test" or "@ example.test"
    let out = line.replace(new RegExp(`@\\s*([A-Za-z0-9-]+)\\s*[. ]\\s*(${TLD})\\b`, "i"), (_m, d: string, t: string) => `@${d}.${t.replace(/\s*[. ]\s*/g, ".")}`);
    // local part: "aisha patel @" / "pieter lekota@": join the words before the @ when they are the candidate's own names
    out = out.replace(/([A-Za-z0-9]+)((?:[ ._-]+[A-Za-z0-9]+){1,2})\s*@/, (m, first: string, rest: string) => {
      const words = [first, ...rest.split(/[ ._-]+/).filter(Boolean)];
      // each word must be one of the candidate's own name words, or a single letter-misread away from exactly one of them
      const snap = (w: string) => { const lw = w.toLowerCase(); if (nameWords.has(lw)) return lw; const near = [...nameWords].filter((x) => x.length === lw.length && lw.length >= 4 && levenshtein(x, lw) <= Math.max(1, Math.floor(lw.length / 5))); return near.length === 1 ? near[0] : null; };
      const snapped = words.map(snap);
      if (snapped.every(Boolean) && / /.test(rest)) return snapped.join(".") + "@";
      return m.replace(/\s+@/, "@");
    });
    // letters misread in the local part: each word must be a hair away from a word of the candidate's own name at the top of the page
    out = out.replace(/([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9.-]+)/, (m, local: string, domain: string) => {
      const fixedLocal = local.split(/([._-])/).map((part, at) => {
        if (at > 0) { const digits = digitsMisreadAsLetters(part); if (digits !== part) return digits; }
        if (part.length < 4 || nameWords.has(part.toLowerCase())) return part;
        const near = [...nameWords].filter((w) => w.length === part.length && levenshtein(w, part.toLowerCase()) <= Math.max(1, Math.floor(part.length / 5)));
        return near.length === 1 ? near[0] : part;
      }).join("");
      // the domain is left exactly as written: a domain that is a letter away from a well-known one is a fact in the document, not ours to correct
      return `${fixedLocal}@${domain}`;
    });
    return out;
  }).join("\n");
}

// OCR confuses letters that look alike: I, l, 1 and | ("Power Bl"), O and 0, S and 5. A word is corrected ONLY when, with those confusions ignored, it is
// exactly one known skill name or alias and is not that skill as written: "Power Bl" -> "Power BI", "Exce1" -> "Excel". Nothing else is touched.
const lookalike = (s: string) => s.toLowerCase().replace(/[il1|!]/g, "l").replace(/[o0]/g, "o").replace(/[s5$]/g, "s");
let skillForms: Map<string, string[]> | null = null;
function knownForms() {
  if (skillForms) return skillForms;
  skillForms = new Map();
  for (const sk of SKILLS) for (const form of new Set([sk.name, ...sk.aliases])) {
    if (form.length < 4 || /^[.]/.test(form)) continue;
    const key = lookalike(form), list = skillForms.get(key) ?? []; if (!list.includes(form)) list.push(form);
    skillForms.set(key, list);
  }
  return skillForms;
}
export function repairLookalikes(text: string): string {
  const forms = knownForms();
  return text.split("\n").map((line) => {
    const tokens = line.split(/(\s+)/);                       // keep the spaces so the line is rebuilt exactly
    const wordIdx = tokens.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0);
    for (let w = 0; w < wordIdx.length; w++) {
      for (let n = Math.min(3, wordIdx.length - w); n >= 1; n--) {
        const idx = wordIdx.slice(w, w + n), parts = idx.map((i) => tokens[i]);
        const m = parts.join(" ").match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}+#.]*)$/u);   // punctuation around the phrase stays where it is
        if (!m || !m[2]) continue;
        const phrase = m[2], candidates = forms.get(lookalike(phrase));
        if (candidates && candidates.length === 1 && candidates[0].toLowerCase() !== phrase.toLowerCase() && /[il1|oO05sS$!]/.test(phrase)) {
          const fixed = m[1] + candidates[0] + m[3], pieces = fixed.split(" ");
          if (pieces.length === n) { idx.forEach((i, k) => (tokens[i] = pieces[k])); }
          break;
        }
        if (candidates && candidates.includes(phrase)) break;   // already right: leave it, and do not let a shorter window rewrite part of it
      }
    }
    return tokens.join("");
  }).join("\n");
}

const HEADINGS = ["Experience", "Employment", "Education", "Skills", "Qualifications", "Summary", "Profile", "Certifications", "Projects", "Languages", "References", "Work Experience", "Professional Experience", "Employment History", "Technical Skills", "Personal Details", "Achievements"];
const oneEdit = (a: string, b: string) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.length === b.length ? a.slice(i + 1) === b.slice(i + 1) : (a.length < b.length ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i));
};
/** OCR often misreads one letter of a section heading ("Employmemt"), and the parser relies on headings. Repair only lines that look like a heading and are one letter away from a known one. */
export function cleanOcr(text: string): string {
  // (a bullet that OCR read as a letter or a mark becomes a bullet)
  return repairLookalikes(repairEmails(text.replace(/^([ \t]*)[e»«=+*][ \t]+(?=[A-Z])/gm, "$1• "))).split("\n").map(rtrim).join("\n").replace(/\n{3,}/g, "\n\n").split("\n").map((line) => {
    const t = line.trim();
    if (t.length < 5 || t.length > 30 || !/^[A-Za-z &]+$/.test(t) || t.split(/\s+/).length > 3) return line;
    if (HEADINGS.some((h) => h.toLowerCase() === t.toLowerCase())) return line;
    const near = HEADINGS.filter((h) => oneEdit(t.toLowerCase(), h.toLowerCase()));
    return near.length === 1 ? near[0] : line;
  }).join("\n").trim();
}

export async function stopOcr() {
  await Promise.all(Object.values(OCR_ENGINES).map((e) => e.stop()));
}
