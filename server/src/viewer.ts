// "View Original CV" opens the document in its own browser tab; it never has to be downloaded (owner, 2026-10-30).
// A browser shows PDF, images and plain text itself, so those are sent as they are (inline). It cannot show Word or other office formats, so for
// those RoleMatch builds a read-only page from the original file:
//  * .docx: the document's content as a web page (headings, paragraphs, lists, tables, emphasis, pictures), converted by mammoth, which the
//    server already uses to read Word files. Not a pixel copy of the layout, and the page says so.
//  * .doc, .rtf, .odt: the text RoleMatch read from the file, labelled as such.
// The page is untrusted content: it carries its own content policy (no scripts, nothing loaded from anywhere, no forms, cannot be framed), and links
// written in the CV are shown as text, not followed.
import { unpacksSafely } from "./readers";
import mammoth from "mammoth";
import { contentTypeOf, type DocKind } from "./formats";
import { readDocument } from "./parse";
import { tiffPages } from "./tiff";

// Format kinds (formats.ts) a browser shows by itself; TIFF is not one of them, so it is turned into a PNG picture of the same page.
const BROWSER_SHOWS = new Set(["pdf", "jpeg", "png", "gif", "bmp", "txt"]);
export const VIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-same-origin";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);


function page(fileName: string, note: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${esc(fileName)}</title><style>
:root{color-scheme:light dark;--bg:#f4f6f8;--paper:#fff;--ink:#1a202c;--muted:#4a5568;--rule:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:#171923;--paper:#1f2430;--ink:#e2e8f0;--muted:#a0aec0;--rule:#2d3748}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;background:var(--paper);border-bottom:1px solid var(--rule);padding:12px 16px}
header b{display:block;font-size:15px;overflow-wrap:anywhere}header span{font-size:13px;color:var(--muted)}
main{max-width:820px;margin:24px auto;background:var(--paper);padding:40px 48px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);overflow-wrap:anywhere}
@media (max-width:700px){main{margin:0;border-radius:0;padding:20px 16px}}
img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid var(--rule);padding:4px 8px;vertical-align:top}
pre{white-space:pre-wrap;font:inherit;margin:0}.link{text-decoration:underline dotted}
</style></head><body><header><b>${esc(fileName)}</b><span>${esc(note)}</span></header><main>${body}</main></body></html>`;
}

/** The response for "View Original CV": the file itself when a browser can show it, otherwise a read-only page built from it. `kind` is the stored format kind. */
export async function viewResponse(bytes: Uint8Array, kind: string, fileName: string): Promise<Response> {
  const safeName = fileName.replace(/[^\w.\- ]/g, "_");
  const inline = (b: Uint8Array, type: string) => new Response(b as unknown as BodyInit, { headers: { "content-type": type, "content-disposition": `inline; filename="${safeName}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
  if (BROWSER_SHOWS.has(kind)) return inline(bytes, contentTypeOf(kind));
  if (kind === "tiff") return inline(new Uint8Array(tiffPages(bytes, 1).pages[0]), "image/png");
  let html: string;
  // A Word or OpenDocument file is measured before anything unpacks it: "View Original" runs in the website's own server, for any file in the portal,
  // including one the reader refused for unpacking too far (independent security review, 23 Nov 2026).
  if ((kind === "docx" || kind === "odt") && !unpacksSafely(bytes)) {
    html = page(fileName, "This file unpacks to far more data than a document should, so RoleMatch does not open it. Download it only if you trust where it came from.", "");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": VIEW_CSP, "x-frame-options": "DENY", "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
  }
  const out = kind === "docx" ? await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { convertImage: mammoth.images.dataUri }).catch(() => null) : null;
  if (out) {
    // a link in a CV is shown, never followed from RoleMatch: its address stays visible as the text's title
    const body = out.value.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>/g, (_m, href) => `<span class="link" title="${href}">`).replace(/<a\b[^>]*>/g, "<span>").replace(/<\/a>/g, "</span>");
    html = page(fileName, "The original Word document, shown in the browser. The content is the document's own; page layout and fonts may differ from Word.", body);
  } else {
    const r = await readDocument(bytes, kind as DocKind);
    html = page(fileName, kind === "docx" ? "This Word document could not be laid out as a page, so this is the text RoleMatch read from it." : "This file type cannot be shown by a browser, so this is the text RoleMatch read from the original file.", `<pre>${esc(String(r.text ?? ""))}</pre>`);
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": VIEW_CSP, "x-frame-options": "DENY", "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
