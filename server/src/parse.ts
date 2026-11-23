import { extractText } from "unpdf";
import { withPdf, type Pdf } from "./pdfDoc";
import { stopIfAsked, Stopped } from "./stopping";
import { zipSync } from "fflate";
import mammoth from "mammoth";
import { trimLineEnds } from "./textsafe";
import { cleanInvisible, removeHiddenFromDocx, type HiddenRun } from "./invisible";
import { inspectionNotes, type HiddenBox, type PdfInspection } from "./inspect";
import { visibilityOfPdf, type Visibility } from "./visibility";
import { columnTabs, linesByPosition, linesToText, orderLines, orderLinesWithAside, scrambled, type Item } from "./layout";
import { GLYPH_MARK, looksDamaged, markControl, repairWithVocabulary, stripMarks } from "./glyphs";

export { scrambled };

import { isImage, sniff, type DocKind } from "./formats";
import { docxHeaderFooterText, readDoc, readOdt, readRtf, readTxt, unpacksSafely, unzipChecked } from "./readers";
export { sniff, type DocKind };

// No document is ever refused for being long: long careers and long dossiers are exactly what this platform is for.
// These ceilings exist only to stop a hostile or broken file from exhausting the server. If one is ever reached, we read what fits
// and say so on the record, which then needs a person's review.
const PAGE_CEILING = 500; // the default when a caller sets no limit; the pipeline passes the organisation's limit for a job description, and NO_PAGE_LIMIT for a CV
/** A CV is read in full however many pages it has (owner rule, 2026-11-02). File size and the per-page time budget still bound the work. */
export const NO_PAGE_LIMIT = Number.POSITIVE_INFINITY;
const TEXT_CEILING = 2_000_000;
const TIFF_MAX_PAGES = 500; // the TIFF decoder's own safety bound (tiff.ts); far beyond what fits in the file-size limit



/**
 * A letter with no Unicode mapping arrives as its own text item holding only a marked control character, with no width.
 * Join it to the word it belongs to: the next item when a space comes right before it ("Hands-on" _ [w] "ork"), otherwise the
 * previous one ("revie" [w]). The merged item is stretched up to the next fragment so the word is not split by a false gap.
 */
function absorbGlyphs(raw: Item[]): Item[] {
  const markOnly = (t: string) => t !== "" && t.replace(new RegExp(GLYPH_MARK + "[0-9a-f]{2}", "g"), "") === "";
  const out: Item[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    if (!markOnly(it.s)) { if (it.s.trim() !== "") out.push(it); continue; }
    const prevRaw = raw[i - 1], next = raw[i + 1];
    const spaceBefore = !prevRaw || prevRaw.s.trim() === "";
    if (spaceBefore && next && next.s.trim() !== "") { raw[i + 1] = { ...next, s: it.s + next.s, x: it.x, w: next.x + next.w - it.x }; continue; }
    const prev = out[out.length - 1];
    if (prev && prevRaw === raw[i - 1] && prevRaw.s.trim() !== "") {
      const merged: Item = { ...prev, s: prev.s + it.s, w: prev.w + it.w };
      if (next && next.s.trim() !== "" && /^[\p{L}]/u.test(next.s)) merged.w = Math.max(merged.w, next.x - merged.x); // the word continues without a space
      out[out.length - 1] = merged; continue;
    }
    out.push(it);
  }
  return out;
}


/**
 * Reads a PDF page by page using the position of every piece of text. Pieces on the same line separated by a wide gap
 * (table columns, tab stops, skill grids) are joined with " | " so the parser can see the column boundary.
 */
async function pdfTextWithColumns(pdf: Pdf, pageLimit: number, drop: HiddenBox[] = [], budget: { seconds: number; skipped: number[] } = { seconds: 20, skipped: [] }, signal?: AbortSignal): Promise<string> {
  type Built = { lines: Item[][]; height: number };
  const built: Built[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, pageLimit); n++) {
    stopIfAsked(signal);   // the document's time ran out: stop between pages (code review, 16 Nov 2026, B-M3)
    const got = await withinBudget(async () => { const pg = await pdf.getPage(n); return { pg, c: await pg.getTextContent() }; }, budget.seconds, () => { (pdf as any).destroy?.()?.catch?.(() => {}); });
    // a page that hangs holds the PDF reader's one worker, so the document is released and the pages from here on are reported as not read
    if (got === "TIMEOUT") { for (let k = n; k <= Math.min(pdf.numPages, pageLimit); k++) budget.skipped.push(k); break; }
    const page = got.pg, content = got.c;
    // text a person cannot see (white on white, invisible, transparent, tiny) is left out when the organisation's policy says so
    const hiddenHere = drop.filter((h) => h.page === n);
    const isHidden = (it: any) => hiddenHere.some((h) => { const cx = it.transform[4] + (it.width || 0) / 2, cy = it.transform[5] + (it.height || 0) / 2; return cx >= h.x - 1 && cx <= h.x + h.w + 1 && cy >= h.y - 1 && cy <= h.y + h.h + 1 && (h.text.includes(String(it.str).trim()) || String(it.str).includes(h.text.trim())); });
    const items = absorbGlyphs((content.items as any[])
      .filter((it) => typeof it.str === "string" && !(hiddenHere.length && it.str.trim() !== "" && isHidden(it)))
      .map((it) => ({ s: markControl(it.str as string), x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0, h: Math.abs(it.transform[3] as number) || (it.height as number) || 10 })));
    // Most PDFs store text in reading order, and a sidebar is often stored whole before the main column, so that order is kept. Only items
    // that follow the previous one on the same baseline, further to the right, join its line; everything else starts a new line.
    // But some exporters (design tools, "print to PDF" from web pages) store the pieces in an order that has nothing to do with the page:
    // headings first, the name in the middle, the summary after the jobs. For those, the order is rebuilt from where each piece sits.
    const lines: (typeof items)[] = scrambled(items) ? linesByPosition(items) : [];
    if (!lines.length) for (const it of items) {
      const line = lines[lines.length - 1];
      const last = line?.[line.length - 1];
      if (line && last && Math.abs(last.y - it.y) <= Math.min(last.h, it.h) * 0.5 && it.x >= last.x + last.w - 2) line.push(it); else lines.push([it]);
    }
    built.push({ lines, height: page.getViewport({ scale: 1 }).height });
  }
  const furniture = pageFurniture(built);
  // a narrower right-hand column on a page that is followed by another page is read after the last page (see orderLinesWithAside)
  const multi = built.length > 1, asides: string[] = [];
  const pages = built.map(({ lines, height }) => { const all = lines.filter((ln) => !isFurniture(ln, height, furniture)), { main, aside } = multi ? orderLinesWithAside(all) : { main: orderLines(all), aside: [] as Item[][] }; if (aside.length) asides.push(linesToText(aside, columnTabs(aside))); return linesToText(main, columnTabs(main)); });
  return [...pages, ...asides].join("\n");
}

// ---- page furniture: a running header or footer ("Name - Curriculum Vitae", "Page 2 of 3") repeated on every page. It is not part of the CV and, left in,
// lands in the middle of a section (or on the same line as a heading) as soon as pages are read one after another.
// A running header or footer sits in the SAME place on every page, so the key includes where (to the nearest 6 units from the page edge). The same job title
// at the bottom of one page and the top of the next is content, not furniture.
export const furnitureKey = (ln: Item[], height = 0) => { const y = Math.min(...ln.map((i) => i.y)); return `${Math.round((y < height / 2 ? y : height - y) / 6)}${y < height / 2 ? "b" : "t"}|` + ln.map((i) => i.s).join(" ").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim(); };
const inMargin = (ln: Item[], height: number) => { const y = Math.min(...ln.map((i) => i.y)); return y < height * 0.09 || y > height * 0.91; };
export function pageFurniture(pages: { lines: Item[][]; height: number }[]): Set<string> {
  const seen = new Map<string, number>();
  // A year alone on a line is a date that wrapped ("October" / "2021"), wherever it falls on the page, not a page number.
  const bareYear = (ln: Item[]) => /^(?:19|20)\d{2}$/.test(ln.map((i) => i.s).join("").trim());
  for (const { lines, height } of pages) for (const key of new Set(lines.filter((ln) => inMargin(ln, height) && !bareYear(ln)).map((ln) => furnitureKey(ln, height)))) seen.set(key, (seen.get(key) ?? 0) + 1);
  const out = new Set<string>();
  for (const [key, n] of seen) if (key && ((pages.length > 1 && n >= 2) || /^(page )?#( of #|\/#)?$/.test(key.split("|")[1] ?? ""))) out.add(key); // on two or more pages, or a bare page number
  return out;
}
/** A line that is only a page number ("Page 8 of 24", "3 / 5", "Page 2"), wherever it stands: never part of the CV (11 Nov 2026: 21 duties on live were
 *  "Page N of M", from documents whose page numbers sat outside the margins the furniture rule looks at, or came from a Word file with no positions). */
export const isPageNumber = (line: string) => /^(?:page\s*\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?|\d{1,3}\s*(?:of|\/)\s*\d{1,3})$/i.test(line.trim());
export const isFurniture = (ln: Item[], height: number, furniture: Set<string>) => furniture.size > 0 && inMargin(ln, height) && furniture.has(furnitureKey(ln, height));

/**
 * Gives a piece of work limited time. A plain promise cannot be stopped, so on timeout this only stops WAITING for it; work that can be stopped is passed as a
 * function: it receives an AbortSignal that is aborted on timeout, and `onTimeout` is called so the caller can release what the work was using.
 */
export async function withinBudget<T>(work: Promise<T> | ((signal: AbortSignal) => Promise<T>), seconds: number, onTimeout?: () => void, parent?: AbortSignal): Promise<T | "TIMEOUT"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ctl = new AbortController();
  parent?.addEventListener("abort", () => ctl.abort(), { once: true });   // the whole document's time ran out: this part stops too (code review, 16 Nov 2026, B-M3)
  const late = new Promise<"TIMEOUT">((resolve) => { timer = setTimeout(() => { ctl.abort(); try { onTimeout?.(); } catch { /* releasing is best effort */ } resolve("TIMEOUT"); }, seconds * 1000); });
  const running = typeof work === "function" ? work(ctl.signal) : work;
  running.catch(() => {});   // a late failure of abandoned work is not an unhandled rejection
  try { return await Promise.race([running, late]); } finally { if (timer) clearTimeout(timer); }
}

export interface Reading { text:string; inspection?:PdfInspection; /** What a person can see on a PDF's pages, decided once, so nothing has to decide it again. */ visibility?:Visibility; hiddenText?:HiddenRun[]; issues:string[];
  /** OCR's words and where they sit, from the same pass that produced the text, so nothing has to read the document twice. */
  ocrPages?:import("./ocr").OcrPageWords[];
  /** The text layer was repaired using OCR, so the file's stored letters are not to be trusted on their own. */
  repaired?:boolean }

/** Reads a document, repairing damaged text layers and falling back to OCR for scans. */
export interface ReadingPolicy { hiddenText:string; forbiddenCopy:string; pageSeconds?:number; hiddenTinyPoints?:number }
const DEFAULT_POLICY: ReadingPolicy = { hiddenText: "exclude_and_flag", forbiddenCopy: "read_and_flag", pageSeconds: 20 };

/** The Word reader drops a line break inside a paragraph, gluing what comes either side of it: "Location" and "Johannesburg" become "LocationJohannesburg". The break is written as text so it survives. */
function docxWithLineBreaks(bytes: Uint8Array): Uint8Array {
  try {
    const files = unzipChecked(bytes), name = "word/document.xml"; if (!files[name]) return bytes;
    const xml = new TextDecoder().decode(files[name]);
    if (!/<w:br\b/.test(xml)) return bytes;
    files[name] = new TextEncoder().encode(xml.replace(/<w:br\b[^>]*\/>/g, '<w:t xml:space="preserve">\n</w:t>'));
    return zipSync(files);
  } catch { return bytes; }
}

/** `signal`: the document's time ran out; the reading stops between pages and throws Stopped (code review, 16 Nov 2026, B-M3). */
export async function readDocument(bytes: Uint8Array, kind: DocKind, opts: { pageCeiling?: number; reading?: ReadingPolicy; emailToo?: boolean; keepLineBreaks?: boolean; signal?: AbortSignal } = {}): Promise<Reading> {
  const issues: string[] = [];
  if (isImage(kind)) return readPhoto(bytes, issues, kind, opts.pageCeiling ?? PAGE_CEILING, opts.emailToo, opts.signal);
  const holder: { inspection?:PdfInspection; visibility?:Visibility; hiddenText?:HiddenRun[] } = {};
  let ocrPages: Reading["ocrPages"], repaired = false;
  const policy = opts.reading ?? DEFAULT_POLICY;
  let text = await readRaw(kind === "docx" && opts.keepLineBreaks ? docxWithLineBreaks(bytes) : bytes, kind, issues, opts.pageCeiling ?? PAGE_CEILING, policy, holder, opts.signal);
  if (holder.inspection) issues.push(...inspectionNotes(holder.inspection, policy));
  if (kind === "pdf") {
    const { ocrPdf, cleanOcr } = await import("./ocr");
    if (looksDamaged(text)) {
      try {
        const ocr = await ocrPdf(bytes, { maxPages: opts.pageCeiling ?? PAGE_CEILING, signal: opts.signal });
        const fixed = repairWithVocabulary(text, ocr.text);
        text = fixed.text; repaired = true;
        issues.push(...(ocr.notes ?? []));
        if (fixed.unresolved) issues.push(`${fixed.unresolved} word${fixed.unresolved > 1 ? "s" : ""} in this PDF had a character that could not be read, so they may contain typos. Check them against the original.`);
      } catch (e) { if (e instanceof Stopped) throw e; text = stripMarks(text); issues.push("This PDF has characters that could not be read, so some words may contain typos."); }
    }
    if (stripMarks(text).replace(/\s+/g, " ").trim().length < 150) {
      try {
        const ocr = await ocrPdf(bytes, { maxPages: opts.pageCeiling ?? PAGE_CEILING, emailToo: opts.emailToo, signal: opts.signal });
        if (ocr.totalPages > ocr.pages) issues.push(`This scanned document has ${ocr.totalPages} pages; only the first ${ocr.pages} could be read by OCR. Later pages are missing from this record.`);
        if (ocr.text.replace(/\s+/g, " ").trim().length >= 150) {
          ocrQuality(ocr.confidence, "scan");
          issues.push(...(ocr.notes ?? []));
          text = cleanOcr(ocr.text); ocrPages = ocr.pageWords;
          issues.push(`This document had no readable text, so it was read by OCR (${Math.round(ocr.confidence * 100)}% average confidence). OCR can misread characters and columns; check it against the original.`);
        }
      } catch (e) { if (e instanceof ParseError || e instanceof Stopped) throw e; /* OCR unavailable: the caller reports the document as unreadable */ }
    }
  }
  const clean = cleanInvisible(stripMarks(text)).text;
  if (clean.length > TEXT_CEILING) issues.push("This document is extremely long, so only the first part of its text was read. Check that nothing important is missing.");
  return { text:clean.slice(0,TEXT_CEILING),issues,inspection:holder.inspection,visibility:holder.visibility,hiddenText:holder.hiddenText,ocrPages,repaired };
}

/** Below this average OCR confidence the text is mostly guesses, so nothing is published from it. */
const OCR_FLOOR = Number(process.env.OCR_MIN_CONFIDENCE ?? 0.5);
function ocrQuality(confidence: number, what: "photo" | "scan") {
  if (confidence < OCR_FLOOR) throw new ParseError(what === "photo" ? "PHOTO_UNREADABLE" : "SCAN_UNREADABLE", what === "photo"
    ? "This photo is too blurry, dark or small to read reliably. Retake it flat, in good light and in focus, or upload the PDF or Word file instead."
    : "This scan is too faint or blurred to read reliably. Try a clearer copy or a text-based PDF.");
}

/** A phone photo or a picture of a page: straightened and cleaned, read by OCR, and refused if the result would mostly be guesses. */
async function readPhoto(bytes: Uint8Array, issues: string[], kind = "jpeg", pageCeiling = PAGE_CEILING, emailToo = false, signal?: AbortSignal): Promise<Reading> {
  const { ocrImage, cleanOcr } = await import("./ocr");
  const { ImageTooLarge } = await import("./imageprep");
  let ocr: { text: string; confidence: number; notes?: string[]; pageWords?: import("./ocr").OcrPageWords[] };
  if (kind === "tiff") {
    // a TIFF may hold many pages (a scanner's output): each is read as a photo and the texts are joined in page order
    // Page by page: each page is decoded, read and let go before the next is decoded, so one page at a time is in memory (code review, 16 Nov 2026, B-M5).
    const { tiffFrames, TiffError } = await import("./tiff");
    const asParseError = (e: unknown) => e instanceof TiffError ? new ParseError(e.code === "TOO_LARGE" ? "FILE_TOO_LARGE" : "UNREADABLE", e.message) : e;
    let decoded;
    try { decoded = tiffFrames(bytes, Math.min(pageCeiling, TIFF_MAX_PAGES)); } catch (e) { throw asParseError(e); }
    if (decoded.total > decoded.reading) issues.push(`This TIFF has ${decoded.total} pages; only the first ${decoded.reading} were read. Later pages are missing from this record.`);
    const texts: string[] = []; let conf = 0, n = 0; const notes: string[] = [], pageWords: import("./ocr").OcrPageWords[] = [];
    for (;;) {
      let next: IteratorResult<Buffer>;
      try { next = decoded.frames.next(); } catch (e) { throw asParseError(e); }
      if (next.done) break;
      n++;
      try { const r = await ocrImage(new Uint8Array(next.value), n, { emailToo, signal }); texts.push(r.text); conf += r.confidence; notes.push(...(r.notes ?? [])); pageWords.push(...(r.pageWords ?? [])); } catch (e) { if (e instanceof Stopped) throw e; throw new ParseError("UNREADABLE", "A page of the TIFF could not be read."); }
    }
    ocr = { text: texts.join("\n"), confidence: conf / Math.max(1, n), notes, pageWords };
  } else {
    try { ocr = await ocrImage(bytes, 1, { emailToo, signal }); } catch (e) { if (e instanceof Stopped) throw e; if (e instanceof ImageTooLarge) throw new ParseError("FILE_TOO_LARGE", e.message); throw new ParseError("UNREADABLE", "The image could not be opened. It may be corrupted."); }
  }
  ocrQuality(ocr.confidence, "photo");
  issues.push(...(ocr.notes ?? []));
  issues.push(`This was read from a photo by OCR (${Math.round(ocr.confidence * 100)}% average confidence). OCR can misread characters and columns; check it against the original.`);
  return { text:cleanInvisible(cleanOcr(ocr.text)).text.slice(0,TEXT_CEILING),issues,ocrPages:ocr.pageWords };
}

export async function readText(bytes: Uint8Array, kind: DocKind): Promise<string> {
  return (await readDocument(bytes, kind)).text;
}

async function readRaw(bytes:Uint8Array,kind:DocKind,issues:string[]=[],pageCeiling=PAGE_CEILING,policy:ReadingPolicy=DEFAULT_POLICY,holder:{inspection?:PdfInspection;visibility?:Visibility;hiddenText?:HiddenRun[]}={},signal?:AbortSignal):Promise<string> {
  let text = "";
  if (kind === "pdf") {
    text = await withPdf(bytes, async (pdf) => {   // closed again once read (code review, 16 Nov 2026, B-M6)
      if (pdf.numPages > pageCeiling) throw new ParseError("PAGES_LIMIT", `This job description PDF has ${pdf.numPages} pages; your organisation's limit is ${pageCeiling}. Send the job description on its own, without attachments, or ask an administrator to raise the limit.`);
      try { holder.visibility = await visibilityOfPdf(bytes, pdf, pageCeiling, policy.pageSeconds ?? 20); holder.inspection = holder.visibility.inspection; } catch { /* inspection is optional */ }
      if (holder.inspection?.copyForbidden && policy.forbiddenCopy === "hold_for_review") throw new ParseError("COPY_FORBIDDEN", "This PDF's settings say its text may not be copied, and your organisation holds such files for a person to look at first. Ask the sender for an unprotected copy, or ask an administrator to change the setting.");
      const budget = { seconds: policy.pageSeconds ?? 20, skipped: [] as number[] };
      try { const read = await pdfTextWithColumns(pdf, pageCeiling, policy.hiddenText === "flag_only" ? [] : (holder.inspection?.hidden ?? []), budget, signal); if (budget.skipped.length) issues.push(`Page${budget.skipped.length > 1 ? "s" : ""} ${budget.skipped.join(", ")} of this PDF took too long to read and ${budget.skipped.length > 1 ? "were" : "was"} left out. The rest was read. Check the original.`); return read; }
      catch (e) { // fall back to the plain reader if the positional one cannot cope with this file
        if (e instanceof Stopped) throw e;
        const result = await extractText(pdf, { mergePages: true });
        return Array.isArray(result.text) ? result.text.join("\n") : result.text;
      }
    });
  } else if (kind === "docx") {
    // text a person cannot see (hidden, white on a plain page, one point) is left out when the policy says so, and always reported
    const stripped = removeHiddenFromDocx(bytes,policy.hiddenText!=="flag_only",policy.hiddenTinyPoints??1);holder.hiddenText=stripped.hidden;
    if (stripped.hidden.length) issues.push(`This Word file contains ${stripped.hidden.length} piece${stripped.hidden.length > 1 ? "s" : ""} of text that cannot be seen on the page (${[...new Set(stripped.hidden.map((h) => h.why))].join(", ")}). ${policy.hiddenText === "flag_only" ? "It was read; check the original." : "It was left out of what was read. Check the original."}`);
    if (!unpacksSafely(stripped.bytes)) throw new Error("This file unpacks to far more data than a document should, so it was not opened.");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(stripped.bytes) });
    // the body reader skips page headers and footers, where many CVs keep the name and contact details
    const furniture = docxHeaderFooterText(stripped.bytes);
    text = [furniture.header, result.value, furniture.footer].filter((t) => t.trim()).join("\n\n");
  } else if (kind === "doc") text = await readDoc(bytes);
  else if(kind==="rtf"||kind==="odt"){
    const hidden:HiddenRun[]=[];const options={remove:policy.hiddenText!=="flag_only",tinyPoints:policy.hiddenTinyPoints??1,hidden};
    text=kind==="rtf"?readRtf(bytes,options):readOdt(bytes,options);holder.hiddenText=hidden;
    if(hidden.length)issues.push(`This ${kind.toUpperCase()} file contains text that cannot be seen (${[...new Set(hidden.map(h=>h.why))].join(", ")}). ${policy.hiddenText==="flag_only"?"It was read; check the original.":"It was left out of what was read. Check the original."}`);
  }
  else if (kind === "txt") text = readTxt(bytes);
  else throw new ParseError("FILE_TYPE", "This kind of file cannot be read as text.");
  const invisible = cleanInvisible(text);
  if (invisible.removed >= 3) issues.push(`${invisible.removed} invisible characters (zero-width or direction marks) were removed from this document. They have no visible shape and can hide text between letters.`);
  text = trimLineEnds(invisible.text).replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export class ParseError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
