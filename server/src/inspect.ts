// What a PDF contains beyond its visible text, and which of its text a person cannot see.
// Everything here is read-only: nothing is executed, extracted from attachments or written anywhere.
import { getResolvedPDFJS } from "unpdf";
import type { getDocumentProxy } from "unpdf";

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

export interface HiddenBox { page?: number; x: number; y: number; w: number; h: number; text: string; why: "invisible" | "transparent" | "white" | "tiny" }

export interface PdfInspection {
  producer: string; creator: string; createdAt: string; modifiedAt: string;
  pages: number; pageWidth: number; pageHeight: number;
  encrypted: boolean;
  copyForbidden: boolean;                      // the file's permissions say text may not be copied
  hasForm: boolean; hasJavaScript: boolean;
  annotations: Record<string, number>;         // counts by type (Link, Text, FreeText, Stamp, Highlight, ...); never their text
  attachments: number;                         // embedded files, counted and never opened
  scannerLayerPages: number;                   // pages whose invisible text sits over a page image (an OCR layer), which is normal
  hidden: HiddenBox[];                         // text a person cannot see
}

const PERMISSION_COPY = 0x10;

/** Raw operator numbers of PDF.js, resolved once. */
async function ops() { return (await getResolvedPDFJS()).OPS as Record<string, number>; }

/** PDF.js gives colours as "#rrggbb" strings (older builds gave numbers). */
const rgbOf = (a: unknown[]): number[] => {
  const v = a[0];
  if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  if (typeof v === "number") return a.length >= 3 ? [Number(a[0]) / 255, Number(a[1]) / 255, Number(a[2]) / 255] : [v / 255, v / 255, v / 255];
  return [0, 0, 0];
};
type Mat = [number, number, number, number, number, number];
type Rect = { x0: number; y0: number; x1: number; y1: number } | null;
const times = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const rectOf = (m: Mat, x0: number, y0: number, x1: number, y1: number): Rect => {
  const xs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => m[0] * x + m[2] * y + m[4]), ys = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => m[1] * x + m[3] * y + m[5]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const isNearWhite = (rgb: number[]) => rgb.every((c) => c >= 0.97);

/** Where a page paints a coloured area or an image. Positions matter: a coloured dot in a corner says nothing about text elsewhere. */
export async function paintedAreas(page: any): Promise<{ panels: Rect[]; pictures: Rect[] }> {
  const OPS = await ops();
  const list = await page.getOperatorList();
  const panels: Rect[] = [], pictures: Rect[] = [];
  {
    let fill: number[] = [0, 0, 0], ctm: Mat = [1, 0, 0, 1, 0, 0];
    const stack: { fill: number[]; ctm: Mat }[] = [];
    for (let i = 0; i < list.fnArray.length; i++) {
      const fn = list.fnArray[i], a = list.argsArray[i];
      if (fn === OPS.save) stack.push({ fill, ctm });
      else if (fn === OPS.restore) { const s = stack.pop(); if (s) ({ fill, ctm } = s); }
      else if (fn === OPS.transform) ctm = times(a as Mat, ctm);
      else if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray) fill = rgbOf(a);
      else if (fn === OPS.constructPath && [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke].includes(a[0])) {
        if (!isNearWhite(fill)) { const m = a[2] as Record<number, number> | undefined;   // the path's bounding box: PDF.js gives it as {0: minX, 1: minY, 2: maxX, 3: maxY}
        panels.push(m && [0, 1, 2, 3].every((k) => Number.isFinite(m[k])) ? rectOf(ctm, m[0], m[1], m[2], m[3]) : null); }
      } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke) { if (!isNearWhite(fill)) panels.push(null); }   // a fill whose extent is unknown
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) pictures.push(rectOf(ctm, 0, 0, 1, 1));
    }
  }
  return { panels, pictures };
}

/**
 * Walks one page's drawing operations and returns the text items a person cannot see.
 * Invisible text (render mode 3) lying over a picture that covers a quarter of the page is a scanner's OCR layer and is counted apart; anywhere else it is hidden.
 * White text counts as hidden unless it sits on a coloured panel or a large picture (white on a dark panel is ordinary).
 */
async function hiddenOnPage(page: any): Promise<{ hidden: HiddenBox[]; scannerLayer: boolean }> {
  const OPS = await ops();
  const list = await page.getOperatorList();
  const { panels, pictures } = await paintedAreas(page);
  const covers = (rs: Rect[], x: number, y: number, minArea = 0) => rs.some((r) => r === null ? false : x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && (r.x1 - r.x0) * (r.y1 - r.y0) >= minArea);
  // 2. walk again with the text state
  const content = await page.getTextContent({ disableCombineTextItems: true });
  const items = (content.items as any[]).filter((it) => typeof it.str === "string" && it.str.trim() !== "");
  const hidden: HiddenBox[] = [];
  let mode = 0, fill: number[] = [0, 0, 0], alpha = 1, size = 10;
  const stack: { mode: number; fill: number[]; alpha: number }[] = [];
  let shown = 0, off = 0, scannerLayer = false;
  const judged = new Set<any>(); // a piece drawn in several steps is judged once
  const pageArea = Math.max(1, Math.abs((page.view[2] - page.view[0]) * (page.view[3] - page.view[1])));
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i], a = list.argsArray[i];
    if (fn === OPS.save) stack.push({ mode, fill, alpha });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) ({ mode, fill, alpha } = s); }
    else if (fn === OPS.setTextRenderingMode) mode = a[0];
    else if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray) fill = rgbOf(a);
    else if (fn === OPS.setFont) size = Math.abs(a[1]) || size;
    else if (fn === OPS.setGState) { for (const [k, v] of a[0] as [string, number][]) if (k === "ca") alpha = v; }
    else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
      const glyphs = (fn === OPS.showSpacedText ? (a[0] as any[]).filter((g) => typeof g === "object") : a[0]) as { unicode?: string }[];
      const text = (glyphs ?? []).map((g) => g?.unicode ?? "").join("");
      if (text.trim() === "") continue;
      // one drawing operation can come back as several text items (kerned runs are split), so items are taken until the operation's own letters are used up
      // The pairing re-synchronises on the letters themselves, so one odd operation cannot shift every later colour onto the wrong text.
      const target = text.replace(/\s/g, "");
      const mine: any[] = [];
      const strip = (it: any) => String(it.str).replace(/\s/g, "");
      // A drawing step can be a single letter or word of a longer piece of text (designer PDFs draw a heading letter by letter): follow the piece
      // across steps, letter by letter, before looking for a new one.
      if (shown < items.length && strip(items[shown]).slice(off).startsWith(target)) {
        mine.push(items[shown]); off += target.length;
        if (off >= strip(items[shown]).length) { shown++; off = 0; }
      } else {
        // a new piece: the candidate matching the most letters wins, not merely the first that starts the same way (a white headline
        // "Junior Backend Developer | Full-Stack ..." must pair with itself, not with a dark job title "Junior Backend Developer" lower down)
        let at = -1, best = 0, partial = false;
        for (let k = shown; k < Math.min(items.length, shown + 12); k++) {
          const w = strip(items[k]); if (!w) continue;
          if (target.startsWith(w) && w.length > best) { at = k; best = w.length; partial = false; }
          else if (w.startsWith(target) && target.length > best) { at = k; best = target.length; partial = true; }
        }
        if (at >= 0 && partial) { shown = at; off = target.length; mine.push(items[at]); if (off >= strip(items[at]).length) { shown++; off = 0; } }
        else if (at >= 0) {
          shown = at; off = 0;
          for (let got = 0; shown < items.length && got < target.length; ) { const it = items[shown]; const w = strip(it); if (got + w.length > target.length || !target.startsWith(w, got)) break; mine.push(it); shown++; got += w.length; }
        }
      }
      for (const item of mine) {
        if (judged.has(item)) continue;
        judged.add(item);
        let why: HiddenBox["why"] | null = null;
        if (mode === 3 || mode === 7) { if (covers(pictures, item.transform[4], item.transform[5], pageArea * 0.25)) scannerLayer = true; else why = "invisible"; }   // an OCR layer sits over a picture that covers a quarter of the page
        else if (alpha === 0) why = "transparent";
        else if (isNearWhite(fill) && !covers(panels, item.transform[4], item.transform[5]) && !covers(pictures, item.transform[4], item.transform[5], pageArea * 0.25)) why = "white";   // white is ordinary only on a coloured panel or a large picture the text sits on
        else if (item.height > 0 && item.height < 1.5) why = "tiny";
        if (why) hidden.push({ x: item.transform[4], y: item.transform[5], w: item.width, h: item.height, text: item.str, why });
      }
    }
  }
  return { hidden, scannerLayer };
}

/** Reads the document-level facts and the hidden text of every page. Never throws: an inspection that fails reports nothing rather than stopping the read. */
export async function inspectPdf(pdf: Pdf, pageLimit: number, pageSeconds = 20): Promise<PdfInspection> {
  const out: PdfInspection = {
    producer: "", creator: "", createdAt: "", modifiedAt: "", pages: pdf.numPages, pageWidth: 0, pageHeight: 0, encrypted: false, copyForbidden: false,
    hasForm: false, hasJavaScript: false, annotations: {}, attachments: 0, scannerLayerPages: 0, hidden: [],
  };
  try {
    const meta: any = await pdf.getMetadata();
    const info = meta?.info ?? {};
    out.producer = String(info.Producer ?? ""); out.creator = String(info.Creator ?? "");
    out.createdAt = String(info.CreationDate ?? ""); out.modifiedAt = String(info.ModDate ?? "");
    out.encrypted = !!info.EncryptFilterName; out.hasForm = !!info.IsAcroFormPresent;
  } catch { /* metadata is optional */ }
  try { const perms = await pdf.getPermissions(); out.copyForbidden = Array.isArray(perms) && !perms.includes(PERMISSION_COPY); } catch { /* none */ }
  try { out.hasJavaScript = !!(await (pdf as any).hasJSActions?.()); } catch { /* none */ }
  try { const att = await pdf.getAttachments(); out.attachments = att ? Object.keys(att).length : 0; } catch { /* none */ }
  for (let n = 1; n <= Math.min(pdf.numPages, pageLimit); n++) {
    try {
      const page: any = await pdf.getPage(n);
      const timed = await Promise.race([Promise.resolve().then(() => hiddenOnPage(page)), new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), pageSeconds * 1000).unref?.())]);
      if (timed === "TIMEOUT") continue;
      if (n === 1) { out.pageWidth = Math.round(page.view[2] - page.view[0]); out.pageHeight = Math.round(page.view[3] - page.view[1]); }
      for (const an of (await page.getAnnotations()) as { subtype?: string }[]) out.annotations[an.subtype ?? "Unknown"] = (out.annotations[an.subtype ?? "Unknown"] ?? 0) + 1;
      const { hidden, scannerLayer } = timed;
      out.hidden.push(...hidden.map((h) => ({ ...h, page: n }) as HiddenBox));
      if (scannerLayer) out.scannerLayerPages++;
    } catch { /* a page that cannot be inspected is still read */ }
  }
  return out;
}

/** The notes a person should see about this document, in plain words. */
export function inspectionNotes(i: PdfInspection, policy: { hiddenText: string; forbiddenCopy: string }): string[] {
  const notes: string[] = [];
  if (i.hidden.length) notes.push(`This PDF contains ${i.hidden.length} piece${i.hidden.length > 1 ? "s" : ""} of text that cannot be seen on the page (${[...new Set(i.hidden.map((h) => h.why))].join(", ")}). ${policy.hiddenText === "exclude_and_flag" ? "It was left out of what was read. Check the original." : "It was read; check the original."}`);
  if (i.copyForbidden) notes.push(`This PDF's settings say its text may not be copied. It was ${policy.forbiddenCopy === "hold_for_review" ? "held for a person to look at first" : "read anyway"}; please check you are allowed to use it.`);
  if (i.hasJavaScript) notes.push("This PDF contains scripts. They were not run.");
  if (i.attachments) notes.push(`This PDF has ${i.attachments} attached file${i.attachments > 1 ? "s" : ""}. They were not opened.`);
  const comments = Object.entries(i.annotations).filter(([t]) => t !== "Link" && t !== "Widget").reduce((n, [, c]) => n + c, 0);
  if (comments) notes.push(`This PDF has ${comments} note${comments > 1 ? "s" : ""} or mark${comments > 1 ? "s" : ""} added on top of it (${Object.keys(i.annotations).filter((t) => t !== "Link" && t !== "Widget").join(", ")}). Their text was not used.`);
  if (i.hasForm) notes.push("This PDF is a fillable form; typed answers may not be in its text.");
  return notes;
}

/** The short, stored form: counts and a few short samples, never the whole hidden text or any annotation text. */
export function summariseInspection(i: PdfInspection) {
  return {
    producer: i.producer, creator: i.creator, createdAt: i.createdAt, modifiedAt: i.modifiedAt, pages: i.pages, pageSize: `${i.pageWidth} x ${i.pageHeight}`,
    encrypted: i.encrypted, copyForbidden: i.copyForbidden, hasForm: i.hasForm, hasJavaScript: i.hasJavaScript, attachments: i.attachments, annotations: i.annotations,
    scannerLayerPages: i.scannerLayerPages,
    hiddenText: { pieces: i.hidden.length, reasons: [...new Set(i.hidden.map((h) => h.why))], samples: i.hidden.slice(0, 5).map((h) => h.text.slice(0, 60)) },
  };
}
