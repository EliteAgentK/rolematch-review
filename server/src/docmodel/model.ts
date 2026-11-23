// One structure for every reader, so what is read keeps where it was and how it looked. The service reads every CV through this (docs/parser/OWN_PARSER_AND_OCR.md).
// It holds only what a reader really knows. What a reader cannot supply stays absent and is named in `missing`: OCR has no fonts, Word has no positions, plain text has neither.
// `engineConfidence` is what an OCR engine reported about itself. It is not a measure of correctness (register R13: 91% reported on a page with 1% of its words recovered).
import { unzipChecked } from "../readers";
import { withPdf, type Pdf } from "../pdfDoc";
import { extractionConfig } from "../extractionConfig";
import { lettersOf, visibilityOfPdf, type Visibility } from "../visibility";
import { linesByPosition, orderLines, scrambled, type Item } from "../layout";
import { furnitureKey, isFurniture, pageFurniture } from "../parse";
import { inColumns, rowsOf, rowText } from "./columns";
import { ocrPageWords, ocrPdfWords, repairEmails, repairLookalikes } from "../ocr";
import { stopIfAsked } from "../stopping";
import { readDocument } from "../parse";
import { removeHiddenFromDocx } from "../invisible";

export interface Box { x0: number; y0: number; x1: number; y1: number }   // y grows downward; in the page's own unit
export interface Style { sizePt?: number; bold?: boolean; font?: string; styleName?: string }
export interface Line {
  id: string;               // "p1.l4": what a value cites as its source
  page: number;
  order: number;            // reading order across the document
  text: string;
  box?: Box;
  style: Style;
  /** This line's height against the page's typical line (1 = typical). From position only, so OCR has it too. */
  relativeHeight?: number;
  engineConfidence?: number;
  /** "table": the line came from a table cell. */
  container?: "body" | "table" | "header" | "footer";
  /** A contact row read again on its own: every reading of it, the page's first. */
  readings?: string[];
  /** The file's drawing instructions say this text cannot be seen, but the rendered page shows these words here. Both facts are kept. */
  markedHiddenButSeen?: boolean;
}
export interface Page { number: number; width?: number; height?: number; unit?: "pt" | "px"; lines: Line[]; /** The page's text in reading order, columns kept apart and running headers and footers left out. Only where positions exist. */ reading?: string[] }
export interface DocModel {
  schema: "docmodel/0.1";
  reader: "pdf-native" | "pdf-ocr" | "image-ocr" | "docx" | "flat-text";
  pages: Page[];
  /** What this reader could not supply, so evidence depending on it is reported as unavailable, not as absent from the document. */
  missing: ("position" | "size" | "bold" | "engineConfidence")[];
  /** Pieces of text marked as hidden: how many the rendered page confirmed, how many stayed out, and how many were never checked because of the page bound. */
  hiddenText?: { seenOnPage: number; excluded: number; unchecked: number };
}
export const allLines = (m: DocModel) => m.pages.flatMap((p) => p.lines);
/** OCR reads the plus of a South African number as a digit: "427 00 525 9425", "127 ...". A number of that shape cannot be anything else. Applied to OCR text only. */
export const repairCountryCode = (s: string) => s.replace(/(^|[\s|(])[14]27(\s\d{2}\s\d{3}\s\d{4})(?!\d)/g, "$1+27$2");

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
function finishPage(number: number, raw: Omit<Line, "id" | "page" | "order" | "relativeHeight">[], start: number, size: Pick<Page, "width" | "height" | "unit">): Page {
  const typical = median(raw.map((l) => (l.box ? l.box.y1 - l.box.y0 : 0)).filter((h) => h > 0));
  return { number, ...size, lines: raw.filter((l) => l.text.trim()).map((l, i) => ({ ...l, id: `p${number}.l${i + 1}`, page: number, order: start + i, ...(l.box && typical ? { relativeHeight: Math.round(((l.box.y1 - l.box.y0) / typical) * 100) / 100 } : {}) })) };
}

/** Closed again once read (code review, 16 Nov 2026, B-M6). */
const fromNativePdf = (bytes: Uint8Array, known?: Visibility, signal?: AbortSignal) => withPdf(bytes, (pdf) => nativePdfModel(bytes, pdf, known, signal));
async function nativePdfModel(bytes: Uint8Array, pdf: Pdf, known?: Visibility, signal?: AbortSignal): Promise<DocModel | null> {
  const visibility = known ?? await visibilityOfPdf(bytes, pdf, pdf.numPages).catch(() => null), seen = visibility?.seen ?? [], hidden = visibility?.hidden ?? [], checked = visibility?.checked ?? [];
  const pages: Page[] = [], placed: { items: Item[]; width: number; height: number }[] = []; let order = 0, chars = 0, sawBold = false;
  for (let n = 1; n <= pdf.numPages; n++) {
    stopIfAsked(signal);
    const pg = await pdf.getPage(n), content = await pg.getTextContent(), height = pg.getViewport({ scale: 1 }).height, width = pg.getViewport({ scale: 1 }).width;
    const hiddenHere = hidden.filter((h) => h.page === n);
    // Bold only where the font's real name says so; the first page only, since it costs a pass over the page and that is where identity lives.
    const fontBold = new Map<string, boolean>();
    if (n === 1) { await pg.getOperatorList().catch(() => null); for (const it of content.items as any[]) if (it.fontName && !fontBold.has(it.fontName)) { try { const f = (pg as any).commonObjs.get(it.fontName); if (f) fontBold.set(it.fontName, !!f.bold || /bold|black|heavy|demi/i.test(String(f.name ?? ""))); } catch { /* not resolved: bold stays unknown */ } } }
    const raw = (content.items as any[]).filter((it) => typeof it.str === "string" && it.str.trim() && !hiddenHere.some((h) => { const cx = it.transform[4] + (it.width || 0) / 2, cy = it.transform[5] + (it.height || 0) / 2; return cx >= h.x - 1 && cx <= h.x + h.w + 1 && cy >= h.y - 1 && cy <= h.y + h.h + 1; }));
    const itemKey = (i: Item) => `${i.s}|${Math.round(i.x)}|${Math.round(i.y)}`, info = new Map<string, { bold?: boolean }>();   // the layout step may hand back copies
    const items: Item[] = raw.map((it) => { const item = { s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0, h: Math.abs(it.transform[3] as number) || (it.height as number) || 10 }; info.set(itemKey(item), { bold: fontBold.get(it.fontName) }); return item; });
    chars += items.reduce((a, i) => a + i.s.trim().length, 0);
    placed.push({ items, width, height });
    let lines: Item[][] = scrambled(items) ? linesByPosition(items) : [];
    if (!lines.length) for (const it of items) { const line = lines.at(-1), last = line?.at(-1); if (line && last && Math.abs(last.y - it.y) <= Math.min(last.h, it.h) * 0.5 && it.x >= last.x + last.w - 2) line.push(it); else lines.push([it]); }
    lines = orderLines(lines);
    const page = finishPage(n, lines.map((ln) => {
      const main = [...ln].sort((a, b) => b.s.length - a.s.length)[0], bold = info.get(itemKey(main))?.bold;
      if (bold !== undefined) sawBold = true;
      const y0 = Math.min(...ln.map((i) => height - i.y - i.h)), y1 = Math.max(...ln.map((i) => height - i.y));
      return { text: ln.map((i, k) => (k && i.x - (ln[k - 1].x + ln[k - 1].w) > Math.max(ln[k - 1].h, i.h) * 1.5 ? " | " : k && !ln[k - 1].s.endsWith(" ") && !i.s.startsWith(" ") && i.x - (ln[k - 1].x + ln[k - 1].w) > 0.5 ? " " : "") + i.s).join("").replace(/\s+/g, " ").trim(), box: { x0: Math.min(...ln.map((i) => i.x)), y0, x1: Math.max(...ln.map((i) => i.x + i.w)), y1 }, style: { sizePt: Math.round(Math.max(...ln.map((i) => i.h)) * 10) / 10, ...(bold === undefined ? {} : { bold }) }, container: "body" as const };
    }), order, { width, height, unit: "pt" });
    for (const h of seen) if (h.page === n) for (const l of page.lines) if (lettersOf(l.text).includes(lettersOf(h.text))) l.markedHiddenButSeen = true;
    order += page.lines.length; pages.push(page);
  }
  if (chars < 150) return null;   // no usable text layer: a scan
  readingOrder(placed).forEach((reading, k) => { pages[k].reading = reading; });
  return { schema: "docmodel/0.1", reader: "pdf-native", pages, missing: [...(sawBold ? [] : ["bold" as const]), "engineConfidence"], ...(seen.length + hidden.length ? { hiddenText: { seenOnPage: seen.length, excluded: hidden.filter((h) => checked.includes(h.page)).length, unchecked: hidden.filter((h) => !checked.includes(h.page)).length } } : {}) };
}

/** Each page's rows in reading order, with what repeats in the margins of page after page left out after the first time it appears: a CV that repeats
 *  the person's name, e-mail, phone and town at the top of every page keeps them once, where they first stand (10 Nov 2026: one real CV's contact block
 *  repeated on page 2 had been dropped from both pages, so its town never reached the reading). A code alone in the very bottom of a page, such as a
 *  reference, is not part of any section. */
function readingOrder(placed: { items: Item[]; width: number; height: number }[], ocr = false): string[][] {
  const rows = placed.map((p) => ({ lines: rowsOf(p.items.filter((i) => i.s.trim())), height: p.height, width: p.width })), furniture = pageFurniture(rows), kept = new Set<string>();
  // A page number ("Page 8 of 24", "3 / 5") is never kept, not even once (11 Nov 2026: one was read as a job's duty).
  const pageNumber = (k: string) => /^(page )?#( of #|\/#)?$/.test(k.split("|")[1] ?? "");
  const repeat = (r: Item[], height: number) => { if (!isFurniture(r, height, furniture)) return false; const k = furnitureKey(r, height); if (pageNumber(k) || kept.has(k)) return true; kept.add(k); return false; };
  return rows.map((p) => inColumns(p.lines.filter((r) => !repeat(r, p.height) && !(p.lines.length > 10 && Math.max(...r.map((i) => i.y)) < p.height * 0.04)), p.width, ocr).map(rowText).filter(Boolean));
}

function ocrPagesToModel(reader: "pdf-ocr" | "image-ocr", read: Awaited<ReturnType<typeof ocrPdfWords>>): DocModel {
  const pages: Page[] = [], placed: { items: Item[]; width: number; height: number }[] = []; let order = 0;
  for (const p of read) {
    const usable = p.words.filter((w) => w.text?.trim()), heights = usable.map((w) => w.y1 - w.y0), scale = 10 / Math.max(median(heights), 1), pageH = Math.max(0, ...usable.map((w) => w.y1));
    // The layout step may hand back copies of items, so a word is found again by what it says and where it starts.
    const key = (s: string, x: number) => `${s}|${Math.round(x * 10)}`, source = new Map<string, (typeof usable)[number]>();
    const items: Item[] = usable.map((w) => { const it = { s: w.text.trim(), x: w.x0 * scale, y: (pageH - (w.y0 + w.y1) / 2) * scale, w: (w.x1 - w.x0) * scale, h: 10 }; source.set(key(it.s, it.x), w); return it; });
    placed.push({ items, width: Math.max(0, ...items.map((i) => i.x + i.w)), height: pageH * scale });
    const reread = (p.rereadLines ?? []).map((text) => ({ text: repairCountryCode(repairEmails(repairLookalikes(text))), style: {}, container: "body" as const }));
    const page = finishPage(p.page, [...orderLines(linesByPosition(items)).map((ln) => {
      const ws = ln.map((i) => source.get(key(i.s, i.x))).filter((w): w is (typeof usable)[number] => !!w), conf = ws.map((w) => w.confidence ?? NaN).filter((c) => Number.isFinite(c));
      return { text: repairCountryCode(repairEmails(repairLookalikes(ln.map((i) => i.s).join(" ")))), box: { x0: Math.min(...ws.map((w) => w.x0)), y0: Math.min(...ws.map((w) => w.y0)), x1: Math.max(...ws.map((w) => w.x1)), y1: Math.max(...ws.map((w) => w.y1)) }, style: {}, ...(conf.length ? { engineConfidence: Math.round((conf.reduce((a, b) => a + b, 0) / conf.length)) / 100 } : {}), container: "body" as const };
    }), ...reread], order, { width: p.width, height: p.height, unit: "px" });
    // Each closer look belongs to the line it was taken of.
    for (const row of p.contactRows ?? []) { const mid = (row.y0 + row.y1) / 2, line = page.lines.find((l) => l.box && l.box.y0 <= mid && l.box.y1 >= mid); if (line) line.readings = [line.text, ...row.readings]; }
    order += page.lines.length; pages.push(page);
  }
  readingOrder(placed, true).forEach((reading, k) => { pages[k].reading = [...(read[k].rereadLines ?? []), ...reading]; });
  return { schema: "docmodel/0.1", reader, pages, missing: ["size", "bold"] };
}

const xmlText = (s: string) => s.replace(/<w:tab\b[^>]*\/>/g, " ").replace(/<w:br\b[^>]*\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
function fromDocx(original: Uint8Array): DocModel {
  const bytes = removeHiddenFromDocx(original, true, extractionConfig.hiddenTextCheck.tinyPoints).bytes;   // what nobody can see in a Word file is never evidence, as in the plain reader
  const files = unzipChecked(bytes, (f) => /^word\/(document|styles|header\d*|footer\d*)\.xml$/.test(f.name)), read = (n: string) => (files[n] ? new TextDecoder().decode(files[n]) : "");
  const styleSize = new Map<string, number>(), styleBold = new Set<string>();
  for (const m of read("word/styles.xml").matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) { const sz = m[2].match(/<w:sz w:val="(\d+)"/); if (sz) styleSize.set(m[1], Number(sz[1]) / 2); if (/<w:b\s*\/>|<w:b w:val="(?:1|true)"/.test(m[2])) styleBold.add(m[1]); }
  // A table holds records when several rows share one shape and their cells are short: "Course | Issuer | Completed | 2024". A table used to lay out a page or a header (a name beside contact details) stays as separate lines.
  const cellsOf = (row: string) => [...row.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => [...c[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>/g)].map((t) => t[1] ?? "\n").join("")).flatMap((t) => t.split("\n")).map((t) => t.trim()).filter(Boolean));
  const shortCells = (cells: string[][]) => cells.length >= 2 && cells.every((c) => c.length <= 3 && c.every((t) => t.split(/\s+/).length <= 12 && !/@/.test(t)));
  const rowsTogether = (xml: string) => xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, (table) => {
    const rows = [...table.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].map((m) => cellsOf(m[0])), width = rows[1]?.length;
    // A table of labelled rows ("Contact number | 071 ...", "Company | Karoo"): each row is one fact, whatever it holds, an address included. It has no row of column names.
    const labels = new Set(Object.values(extractionConfig.labelledFacts).flat().map((x) => x.toLowerCase())), labelled = width === 2 && rows.length >= 2 && rows.every((r) => r.length === 2 && r[0].length === 1) && rows.filter((r) => labels.has(r[0][0].trim().toLowerCase().replace(/:$/, ""))).length / rows.length >= 0.6;
    if (labelled) return rows.map((r) => `<w:p><w:r><w:t>${r[0][0].trim().replace(/:$/, "")}: ${r[1].join(" ")}</w:t></w:r></w:p>`).join("");   // said as a label, so every reader takes it as one
    if (rows.length < 2 || !rows.every((r) => r.length === width && shortCells(r))) return table;
    // a first row with no year or status where the rows below have them names the columns; it is not a record
    const hasValue = (r: string[][]) => /\b(?:19|20)\d{2}\b|completed|progress/i.test(r.flat().join(" ")), named = rows.slice(1).some(hasValue) && !hasValue(rows[0]);
    return (named ? rows.slice(1) : rows).map((r) => `<w:p><w:r><w:t>${r.flat().join(" | ")}</w:t></w:r></w:p>`).join("");
  });
  const paragraphs = (raw: string, container: Line["container"]) => { const xml = rowsTogether(raw); return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => {
    const styleName = p[1].match(/<w:pStyle w:val="([^"]+)"/)?.[1], runs = [...p[1].matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => ({ text: [...r[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)].map((t) => (t[1] === undefined ? (t[0].startsWith("<w:br") ? "\n" : " ") : xmlText(t[1]))).join(""), sz: Number(r[1].match(/<w:sz w:val="(\d+)"/)?.[1] ?? NaN) / 2, bold: /<w:b\s*\/>|<w:b w:val="(?:1|true)"/.test(r[1]) }));
    const joined = runs.map((r) => r.text).join(""), longest = [...runs].sort((a, b) => b.text.length - a.text.length)[0];
    const sizePt = longest && Number.isFinite(longest.sz) ? longest.sz : styleName ? styleSize.get(styleName) : undefined;
    const inTable = container === "body" && xml.lastIndexOf("<w:tc>", p.index ?? 0) > xml.lastIndexOf("</w:tc>", p.index ?? 0);
    // A line break inside a paragraph ("Senior Accountant" / "Pretoria") is two lines to a reader.
    return joined.split("\n").map((t) => ({ text: t.replace(/\s+/g, " ").trim(), style: { ...(sizePt ? { sizePt } : {}), ...(longest ? { bold: longest.bold || (!!styleName && styleBold.has(styleName)) } : {}), ...(styleName ? { styleName } : {}) }, container: inTable ? ("table" as const) : container }));
  }).flat(); };
  const parts = Object.keys(files), headers = parts.filter((n) => /header\d*\.xml$/.test(n)).flatMap((n) => paragraphs(read(n), "header")), footers = parts.filter((n) => /footer\d*\.xml$/.test(n)).flatMap((n) => paragraphs(read(n), "footer"));
  const page = finishPage(1, [...headers, ...paragraphs(read("word/document.xml"), "body"), ...footers], 0, {}); page.reading = page.lines.map((l) => l.text);
  return { schema: "docmodel/0.1", reader: "docx", pages: [page], missing: ["position", "engineConfidence"] };
}

export function fromText(text: string): DocModel {
  return { schema: "docmodel/0.1", reader: "flat-text", pages: [finishPage(1, text.split("\n").map((t) => ({ text: t.trim(), style: {}, container: "body" as const })), 0, {})], missing: ["position", "size", "bold", "engineConfidence"] };
}

/** The model for one file. Formats with no structured reader yet fall back to the existing reader's text, and say so. */
/** `from` hands over what an earlier reading of this document already produced, so OCR is never run twice for one document. `signal`: the caller's time
 *  ran out, and the work stops at the next page instead of going on unseen in the background (code review, 16 Nov 2026, B-M7). */
export async function buildDocModel(bytes: Uint8Array, kind: string, from: { ocrPages?: Awaited<ReturnType<typeof ocrPdfWords>>; text?: string; visibility?: Visibility; signal?: AbortSignal } = {}): Promise<DocModel> {
  if (kind === "pdf") return (await fromNativePdf(bytes, from.visibility, from.signal)) ?? (from.ocrPages?.length ? ocrPagesToModel("pdf-ocr", from.ocrPages) : ocrPagesToModel("pdf-ocr", await ocrPdfWords(bytes, undefined, from.signal)));
  if (kind === "docx") return fromDocx(bytes);
  if (["jpeg", "png", "tiff"].includes(kind)) return from.ocrPages?.length ? ocrPagesToModel("image-ocr", from.ocrPages) : ocrPagesToModel("image-ocr", await ocrPageWords(bytes, from.signal));
  return fromText(from.text ?? (await readDocument(bytes, kind as any, { pageCeiling: Number.POSITIVE_INFINITY })).text);
}
/** The line of a text each of the document's pages starts on, counting non-empty lines from 1, so a line can be traced to its page. */
export function pageStartsOf(text: string, m: DocModel): number[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean), starts: number[] = []; let from = 0;
  for (const p of m.pages) {
    const own = (p.reading ?? p.lines.map((l) => l.text)).map((l) => l.trim()).filter(Boolean).slice(0, 6);
    let at = -1;
    for (const l of own) { at = lines.indexOf(l, from); if (at >= 0) break; }
    if (at < 0) at = from;
    starts.push(at + 1); from = at + 1;
  }
  return starts;
}
/** The document's text in reading order, or "" when no reader gave positions. */
export const readingText = (m: DocModel) => (m.pages.every((p) => p.reading) ? m.pages.flatMap((p) => p.reading!).join("\n") : "");
