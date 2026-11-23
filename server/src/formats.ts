// The file formats the platform accepts, in ONE place. Adding a format means adding an entry here and a reader in parse.ts (and, for a
// format that is not text or an image, nothing else): the upload check, the stored content type, "View Original" and the list the
// browser shows people all follow this list.
import { looksLikeText, zipKind } from "./readers";

export interface Format {
  kind: string;                 // stored in documents.mime, never changes once published
  label: string;                // what people see: "PDF", "Word (.docx)", "Photo (JPEG)"
  contentType: string;
  extensions: string[];
  /** A picture of a page: read by OCR, never by a text layer. */
  image: boolean;
  /** Large files of this kind may be made smaller (and kept only if every word still reads the same). */
  optimisable: boolean;
  /** Decided from the first bytes, never from the name or the browser's claim. */
  sniff(b: Uint8Array): boolean;
}

const startsWith = (b: Uint8Array, ...sig: number[]) => b.length > sig.length + 1 && sig.every((v, i) => b[i] === v);

export const FORMATS = [
  { kind: "pdf", label: "PDF", contentType: "application/pdf", extensions: [".pdf"], image: false, optimisable: true, sniff: (b) => startsWith(b, 0x25, 0x50, 0x44, 0x46) },
  { kind: "docx", label: "Word (.docx)", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: [".docx"], image: false, optimisable: true, sniff: (b) => startsWith(b, 0x50, 0x4b) && zipKind(b) === "docx" },
  { kind: "odt", label: "OpenDocument (.odt)", contentType: "application/vnd.oasis.opendocument.text", extensions: [".odt"], image: false, optimisable: false, sniff: (b) => startsWith(b, 0x50, 0x4b) && zipKind(b) === "odt" },
  { kind: "jpeg", label: "Photo (JPEG)", contentType: "image/jpeg", extensions: [".jpg", ".jpeg"], image: true, optimisable: false, sniff: (b) => startsWith(b, 0xff, 0xd8, 0xff) },
  { kind: "png", label: "Photo or scan (PNG)", contentType: "image/png", extensions: [".png"], image: true, optimisable: false, sniff: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  { kind: "tiff", label: "Scan (TIFF)", contentType: "image/tiff", extensions: [".tif", ".tiff"], image: true, optimisable: false, sniff: (b) => (b.length > 8 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b.length > 8 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a) },
  { kind: "bmp", label: "Image (BMP)", contentType: "image/bmp", extensions: [".bmp"], image: true, optimisable: false, sniff: (b) => startsWith(b, 0x42, 0x4d) && b.length > 30 && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0 },
  { kind: "gif", label: "Image (GIF)", contentType: "image/gif", extensions: [".gif"], image: true, optimisable: false, sniff: (b) => startsWith(b, 0x47, 0x49, 0x46, 0x38) },
  { kind: "doc", label: "Word 97-2003 (.doc)", contentType: "application/msword", extensions: [".doc"], image: false, optimisable: false, sniff: (b) => startsWith(b, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) },
  { kind: "rtf", label: "Rich Text (.rtf)", contentType: "application/rtf", extensions: [".rtf"], image: false, optimisable: false, sniff: (b) => startsWith(b, 0x7b, 0x5c, 0x72, 0x74, 0x66) },
  // plain text has no signature, so it is tried last and only when the bytes really look like text
  { kind: "txt", label: "Plain text (.txt)", contentType: "text/plain; charset=utf-8", extensions: [".txt"], image: false, optimisable: false, sniff: (b) => looksLikeText(b) },
] as const satisfies readonly Format[];

export type DocKind = (typeof FORMATS)[number]["kind"];

export const sniff = (bytes: Uint8Array): DocKind | null => FORMATS.find((f) => f.sniff(bytes))?.kind ?? null;
const formatOf = (kind: string): Format | undefined => FORMATS.find((f) => f.kind === kind);
export const contentTypeOf = (kind: string) => formatOf(kind)?.contentType ?? "application/octet-stream";
export const isImage = (kind: string) => formatOf(kind)?.image ?? false;
export const isOptimisable = (kind: string) => formatOf(kind)?.optimisable ?? false;
/** "PDF, Word (.docx), Photo (JPEG) or Photo or scan (PNG)" */
/** A file named as one of our formats whose contents are another ("notes.txt" renamed "cv.pdf"): refused, with the reason, never read as the other kind
 *  (11 Nov 2026: a text file named .pdf was taken in as a text CV, and the board said nothing). A name with no extension, or one we do not know, is judged by
 *  its contents alone. */
export function nameDisagrees(fileName: string, kind: DocKind): string | null {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase(), named = FORMATS.find((f) => (f.extensions as readonly string[]).includes(ext)), own = (formatOf(kind)?.extensions ?? []) as readonly string[];
  if (!named || named.kind === kind || (named.extensions as readonly string[]).some((e) => own.includes(e))) return null;
  if (named.image && formatOf(kind)?.image) return null;   // a photo saved under another photo's name (".jpg" that is a PNG) is still a photo of the page
  return `This file is named ${ext} but is not a genuine ${named.label} file. Open it and save it again as ${named.label}, or upload the original.`;
}
export const describeFormats = () => { const l = FORMATS.map((f) => f.label); return l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} or ${l[l.length - 1]}`; };
/** What the browser is told, so its file picker and its own checks follow the same list. */
export const publicFormats = () => FORMATS.map(({ kind, label, contentType, extensions, image }) => ({ kind, label, contentType, extensions, image }));

/** For a file that is not accepted: a more useful answer than the list, when we recognise what it is. */
export function unsupportedHint(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(ascii(8, 12))) return "That looks like an iPhone HEIC photo, which is not supported yet. On the iPhone choose Settings > Camera > Formats > Most Compatible, or share the photo as a JPEG, then upload it again.";
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "WebP images are not supported. Save the image as JPEG or PNG and upload it again.";
  return null;
}
