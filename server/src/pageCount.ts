// Counts the pages of a CV from the file itself, before any reading, OCR or model work. A page count is only given when it comes from the format:
//   PDF   the document's own page tree;      TIFF  the number of images in it;      one-image formats (JPEG, PNG, GIF, BMP)  exactly 1;
//   Word / OpenDocument  the page count the AUTHORING application stored in the file (docProps/app.xml, meta.xml), recorded here as such.
// Everything else (plain text, RTF, legacy .doc, or a Word file whose saving application stored no count) is "unverified": the pages cannot be counted without
// rendering the document, and a word or line count is not a page count, so nothing is guessed. A versioned renderer for reflowable formats is a pending decision.
import { unzipSync } from "fflate";
import { withPdf } from "./pdfDoc";
import { tiffFrames } from "./tiff";

export type PageCount = { state: "counted"; pages: number; source: "pdf" | "tiff" | "image" | "document-metadata" } | { state: "unverified"; reason: string };

export async function countPages(bytes: Uint8Array, type: string): Promise<PageCount> {
  try {
    if (type === "pdf") return await withPdf(bytes, async (pdf) => ({ state: "counted", pages: pdf.numPages, source: "pdf" }));
    if (type === "tiff") return { state: "counted", pages: tiffFrames(bytes, 1).total, source: "tiff" };   // counted from the directories; no page is decoded
    if (["jpeg", "png", "gif", "bmp"].includes(type)) return { state: "counted", pages: 1, source: "image" };
    if (type === "docx" || type === "odt") {
      const wanted = type === "docx" ? "docProps/app.xml" : "meta.xml";
      const files = unzipSync(bytes, { filter: (f) => f.name === wanted && f.originalSize < 200_000 });   // only this one small entry is opened, never the whole archive
      const xml = files[wanted] ? new TextDecoder().decode(files[wanted]) : "";
      const m = type === "docx" ? xml.match(/<Pages>\s*(\d{1,4})\s*<\/Pages>/) : xml.match(/meta:page-count="(\d{1,4})"/);
      if (m && Number(m[1]) >= 1) return { state: "counted", pages: Number(m[1]), source: "document-metadata" };
      return { state: "unverified", reason: "The file does not record its own page count." };
    }
    return { state: "unverified", reason: "Pages cannot be counted for this file type without rendering it." };
  } catch { return { state: "unverified", reason: "The file could not be inspected to count its pages." }; }
}
