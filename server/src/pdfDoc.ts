// Opening a PDF with pdf.js, and always closing it again. pdf.js keeps everything it has parsed of an open document (its pages, fonts and pictures) until
// the document is destroyed, and with unpdf that state lives in this process: one CV was opened four to six times (counting pages, reading, what is
// visible, the layout, OCR, the optimiser) and never closed, so a reading worker's memory grew with every PDF until it was stopped for running out
// (code review, 16 Nov 2026, B-M6). Every reader opens a PDF through withPdf, which closes it however the work ends.
import { getDocumentProxy, renderPageAsImage } from "unpdf";

export type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

/** Opens the PDF for `work` and closes it when `work` has finished, failed or been stopped. Nothing of the document may be used after `work` returns. */
export async function withPdf<T>(bytes: Uint8Array, work: (pdf: Pdf) => Promise<T>): Promise<T> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try { return await work(pdf); }
  finally { await pdf.loadingTask.destroy().catch(() => {}); }   // what PDFDocumentProxy.destroy() does
}

/** The most pixels a drawn page may have. A page is drawn at the scale its reader asks for (3.5 for OCR, about 250 dpi; 200 dpi for the optimiser) unless
 *  that would pass this, and then at the largest scale that does not. A page declaring itself 14,400 points square (the largest a PDF allows) asked for a
 *  canvas of about 2,500 million pixels at 3.5, some 10 GB, and the process failed or died on every attempt (code review, 16 Nov 2026, B-M4). Forty
 *  million is an A1 sheet at OCR's scale, below the 60 million a picture may have (imageprep.ts), so a drawn page can still be cleaned for OCR. */
export const MAX_RENDER_PIXELS = 40_000_000;
/** One page drawn as a PNG, and the scale it was really drawn at (positions read from the picture are at that scale). The page is drawn from `bytes`
 *  as before; `pdf` (the same document, already open) only gives its size. */
export async function renderPage(bytes: Uint8Array, pdf: Pdf, page: number, scale: number): Promise<{ png: ArrayBuffer; scale: number }> {
  const view = (await pdf.getPage(page)).getViewport({ scale: 1 });
  const fit = Math.min(scale, Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, view.width * view.height)));
  return { png: await renderPageAsImage(new Uint8Array(bytes), page, { canvasImport: () => import("@napi-rs/canvas"), scale: fit }), scale: fit };
}
