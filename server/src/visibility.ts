// What a person can see on a PDF's pages: one decision, made once for a document, used by everything that reads it.
// A file's drawing instructions can mark text as unseen, and they cannot tell every case. Design tools draw a line as shapes and lay an invisible copy of its
// text on top so it can be selected: real CVs carry their name, employers and universities that way (register R142). Only the rendered page settles it.
// A marked piece is kept only if OCR reads the same words in the same place. Text nobody can see cannot be read off the page, so this does not let hidden
// instructions through. If OCR fails, everything marked stays out.
import { extractionConfig } from "./extractionConfig";
import { withPdf } from "./pdfDoc";
import { inspectPdf, paintedAreas, type HiddenBox, type PdfInspection } from "./inspect";

export const lettersOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
type HiddenPiece = HiddenBox & { page: number };
export interface Visibility {
  /** The file's inspection, with `hidden` holding only what stayed unseen. */
  inspection: PdfInspection;
  /** Marked in the file, and on the rendered page after all. */
  seen: HiddenPiece[];
  /** Marked in the file, and not confirmed on the page: left out. */
  hidden: HiddenPiece[];
  /** The pages the rendered check covered. Pieces on other pages stay out unchecked. */
  checked: number[];
}
type Pdf = Parameters<typeof inspectPdf>[0];

/** How closely the best unbroken run of read words matches what is marked: a line next door caught in the box must not count against it. */
function agreement(want: string, read: string[], levenshtein: (a: string, b: string) => number) {
  let best = 0;
  for (let i = 0; i < read.length; i++) for (let j = i, got = ""; j < read.length && got.length < want.length * 2; j++) { got += lettersOf(read[j]); if (got) best = Math.max(best, 1 - levenshtein(want, got) / Math.max(want.length, got.length)); }
  return best;
}

async function seenOnRenderedPage(bytes: Uint8Array, pdf: Pdf, marked: HiddenPiece[]) {
  const { maxPages, minAgreement, closerLooks } = extractionConfig.hiddenTextCheck;
  const pages = [...new Set(marked.map((h) => h.page))].sort((a, b) => a - b).slice(0, maxPages), seen = new Set<HiddenPiece>();
  if (!pages.length) return { seen, checked: pages };
  const { levenshtein, ocrPdfRegions, ocrPdfWords } = await import("./ocr");
  const read = await ocrPdfWords(bytes, pages).catch(() => []);
  let looks = closerLooks;
  for (const p of read) {
    const size = (await pdf.getPage(p.page)).getViewport({ scale: 1 }), image = p.image;
    if (!image) continue;
    const pieces = marked.filter((x) => x.page === p.page && lettersOf(x.text).length >= 2), boxOf = (h: HiddenPiece) => { const pad = Math.max(h.h, 6) / 2; return { x0: (h.x - pad) / size.width, x1: (h.x + h.w + pad) / size.width, y0: (size.height - h.y - h.h - pad) / size.height, y1: (size.height - h.y + pad) / size.height }; };
    for (const h of pieces) {
      const b = boxOf(h);
      // Cleaning crops the page's margins, so a word's place on the page is its place in the image plus where the image sits.
      const there = p.words.filter((w) => { const cx = ((w.x0 + w.x1) / 2 + (p.frame?.x ?? 0)) / (p.frame?.width ?? image.width), cy = ((w.y0 + w.y1) / 2 + (p.frame?.y ?? 0)) / (p.frame?.height ?? image.height); return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1; }).sort((x, y) => x.y0 - y.y0 || x.x0 - y.x0);
      if (agreement(lettersOf(h.text), there.map((w) => w.text), levenshtein) >= minAgreement) seen.add(h);
    }
    // A heavy or coloured line can defeat a whole-page reading: read each piece still unconfirmed on its own, from the rendered page. A blank place stays blank.
    const closer = pieces.filter((h) => !seen.has(h)).slice(0, Math.max(0, looks)); looks -= closer.length;
    if (!closer.length) continue;
    const looked = await ocrPdfRegions(bytes, p.page, closer.map(boxOf)).catch(() => [] as string[]);
    closer.forEach((h, k) => { if (looked[k] && agreement(lettersOf(h.text), looked[k].split(/\s+/), levenshtein) >= minAgreement) seen.add(h); });
  }
  return { seen, checked: pages };
}

export async function visibilityOfPdf(bytes: Uint8Array, pdf: Pdf, pageLimit: number, pageSeconds?: number): Promise<Visibility> {
  const inspection = await inspectPdf(pdf, pageLimit, pageSeconds), marked = (inspection.hidden ?? []) as HiddenPiece[];
  const { seen, checked } = await seenOnRenderedPage(bytes, pdf, marked), hidden = marked.filter((h) => !seen.has(h));
  return { inspection: { ...inspection, hidden }, seen: [...seen], hidden, checked };
}

/**
 * Contact details a person can read and the file holds no text for: a designer's sidebar is often a picture. Asked only when the text lacks an email or a phone number, of the first page only. Only lines shaped like contact details come back, never an identity number, and OCR can only read what the page shows.
 */
export async function contactsInPictures(bytes: Uint8Array, text: string): Promise<string[]> {
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/, PHONE = /\+?\d[\d\s()-]{8,}\d/, phoneOk = (l: string) => { const m = l.match(PHONE)?.[0].replace(/\D/g, "") ?? ""; return m.length >= 9 && m.length <= 12; };
  // A referee's details at the end do not stand in for the person's own.
  const own = text.split(/\n\s*(?:references?|referees?)\b/i)[0], needEmail = !EMAIL.test(own), needPhone = ![...own.matchAll(new RegExp(PHONE, "g"))].some((m) => phoneOk(m[0]));
  if (!needEmail && !needPhone) return [];
  const { ocrPdfRegions, ocrPdfWords } = await import("./ocr");
  // A sidebar laid down as a picture or a dark panel, read on its own: a reading of the whole page can pass over light letters on a dark ground.
  const { view, panels, pictures } = await withPdf(bytes, async (pdf) => { const first = await pdf.getPage(1); return { view: first.getViewport({ scale: 1 }), ...(await paintedAreas(first)) }; });   // closed again (code review, 16 Nov 2026, B-M6)
  const areas = [...pictures, ...panels].flatMap((r) => (r && (r.x1 - r.x0) * (r.y1 - r.y0) >= view.width * view.height * 0.04 ? [{ x0: r.x0 / view.width, x1: r.x1 / view.width, y0: (view.height - r.y1) / view.height, y1: (view.height - r.y0) / view.height }] : [])).slice(0, 4);
  const inAreas = areas.length ? await ocrPdfRegions(bytes, 1, areas).catch(() => [] as string[]) : [], found: string[] = [];
  for (const t of inAreas) { if (needEmail) found.push(...(t.match(new RegExp(EMAIL, "g")) ?? [])); if (needPhone) found.push(...[...t.matchAll(new RegExp(PHONE, "g"))].map((m) => m[0].trim()).filter(phoneOk)); }
  if (found.length) return [...new Set(found)].filter((l) => !text.includes(l)).slice(0, 4);
  const [page] = await ocrPdfWords(bytes, [1]).catch(() => []); if (!page) return [];
  const rows: { y: number; words: { x: number; t: string }[] }[] = [];
  for (const w of page.words) { if (!w.text?.trim()) continue; const y = (w.y0 + w.y1) / 2, row = rows.find((r) => Math.abs(r.y - y) < (w.y1 - w.y0) * 0.6); if (row) row.words.push({ x: w.x0, t: w.text }); else rows.push({ y, words: [{ x: w.x0, t: w.text }] }); }
  const seen = rows.sort((a, b) => a.y - b.y).map((r) => r.words.sort((a, b) => a.x - b.x).map((w) => w.t).join(" "));
  return seen.filter((l) => (needEmail && EMAIL.test(l)) || (needPhone && !/\bid\b/i.test(l) && PHONE.test(l) && phoneOk(l))).filter((l) => !text.includes(l)).slice(0, 4);
}

/**
 * Some fonts store a ligature under a wrong code, so the file's text says "administra9on" and "MicrosoB" where the page shows "administration" and "Microsoft". The rendered page settles what each code stands for in this one document: where a word's odd character lines up with letters the page shows, and it does so at least twice, it is corrected throughout. Only then, so an ordinary "B2B" or a name is left alone.
 */
export function learnMisreadGlyphs(native: string, seen: string[]): Map<string, string> {
  const odd = /^([A-Za-z]{2,})([0-9]|[A-Z])([a-z]*)$/, votes = new Map<string, Map<string, number>>(), byEnds = new Map<string, string>();
  for (const w of seen) if (/^[A-Za-z]{4,}$/.test(w)) byEnds.set(w.toLowerCase(), w);
  const page = [...byEnds.keys()];
  for (const raw of new Set(native.match(/[A-Za-z0-9]+/g) ?? [])) {
    const m = raw.match(odd); if (!m || (/[A-Z]/.test(m[2]) && m[3])) continue;
    const [, before, code, after] = m, hit = page.find((w) => w.startsWith(before.toLowerCase()) && w.endsWith(after.toLowerCase()) && w.length >= before.length + after.length + 1 && w.length <= before.length + after.length + 3); if (!hit) continue;
    const meant = hit.slice(before.length, hit.length - after.length); if (!/^[a-z]+$/.test(meant)) continue;
    const v = votes.get(code) ?? new Map<string, number>(); v.set(meant, (v.get(meant) ?? 0) + 1); votes.set(code, v);
  }
  const out = new Map<string, string>();
  for (const [code, v] of votes) { const [meant, n] = [...v].sort((a, b) => b[1] - a[1])[0]; if (n >= 2 && n / [...v.values()].reduce((a, b) => a + b, 0) >= 0.8) out.set(code, meant); }
  // Once a document has shown it does this, one word is enough for another code.
  if (out.size) for (const [code, v] of votes) if (!out.has(code) && v.size === 1) out.set(code, [...v.keys()][0]);
  return out;
}
export const applyMisreadGlyphs = (text: string, map: Map<string, string>) => map.size ? text.replace(/[A-Za-z0-9]+/g, (w) => { const m = w.match(/^([A-Za-z]{2,})([0-9]|[A-Z])([a-z]*)$/); return m && map.has(m[2]) && (!/[A-Z]/.test(m[2]) || !m[3]) ? `${m[1]}${map.get(m[2])}${m[3]}` : /[A-Za-z]{2}[0-9][a-z]/.test(w) ? [...map].reduce((x, [c, r]) => (/[0-9]/.test(c) ? x.replace(new RegExp(`(?<=[A-Za-z])${c}(?=[a-z])`, "g"), r) : x), w) : w; }) : text;
/** Asked only when many words look this way, of the first pages. */
export async function repairMisreadGlyphs(bytes: Uint8Array, text: string): Promise<{ text: string; repaired: Record<string, string> }> {
  const words = text.match(/\b[A-Za-z]{2,}[0-9][a-z]+\b/g) ?? [];
  if (words.length < 5) return { text, repaired: {} };
  const { ocrPdfWords } = await import("./ocr");
  const pages = await ocrPdfWords(bytes, [1, 2]).catch(() => []), map = learnMisreadGlyphs(text, pages.flatMap((p) => p.words.map((w) => w.text.replace(/[^A-Za-z]/g, ""))));
  return { text: applyMisreadGlyphs(text, map), repaired: Object.fromEntries(map) };
}
