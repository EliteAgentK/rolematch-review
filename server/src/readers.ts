// Readers for the formats that are not PDF, a .docx or a picture. Each one turns the file's bytes into plain text; everything after
// that (sections, roles, skills, evidence) is the same for every format. All of them are plain code with no network access.
import { unzipSync } from "fflate";
import { inflateRawSync } from "node:zlib";
import { rtrim } from "./textsafe";
import { config } from "./config";
import WordExtractor from "word-extractor";
import { cleanInvisible, inspectOdt, type HiddenRun } from "./invisible";

// ---------------------------------------------------------------- plain text
/** UTF-8 when it is valid UTF-8, otherwise Windows-1252 (what older Windows editors saved), without a byte-order mark. */
export function readTxt(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** True for text that is plain enough to be a document: no NUL bytes, and almost everything printable. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  if (n < 20) return false;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return odd / n < 0.02;
}

// ---------------------------------------------------------------- RTF
// Destinations whose contents are not the document's words.
const RTF_SKIP = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "header",
  "footer",
  "headerl",
  "headerr",
  "footerl",
  "footerr",
  "footnote",
  "object",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "xmlnstbl",
  "fldinst",
  "private",
  "revtbl",
  "mmathPr",
  "wgrffmtfilter",
  "pgptbl",
  "fchars",
  "lchars",
]);
const RTF_SYMBOLS: Record<string, string> = {
  par: "\n",
  line: "\n",
  sect: "\n",
  page: "\n",
  tab: "\t",
  bullet: "•",
  endash: "–",
  emdash: "—",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  emspace: " ",
  enspace: " ",
  qmspace: " ",
  cell: "\t",
  row: "\n",
  nestcell: "\t",
  nestrow: "\n",
};

export function rtfToText(
  src: string,
  visibility: {
    remove?: boolean;
    tinyPoints?: number;
    hidden?: HiddenRun[];
  } = {},
): string {
  const out: string[] = [];
  type G = {
    skip: boolean;
    uc: number;
    vanish: boolean;
    size: number;
    colour: number;
    background: number;
    x: number;
    y: number;
    width: number;
    height: number;
    paperWidth: number;
    paperHeight: number;
  };
  const stack: G[] = [];
  let g: G = {
      skip: false,
      uc: 1,
      vanish: false,
      size: 12,
      colour: 0,
      background: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      paperWidth: 12240,
      paperHeight: 15840,
    },
    pendingBytes: number[] = [],
    justOpened = false,
    i = 0;
  const colours = (src.match(/\{\\colortbl[^}]*\}/)?.[0] ?? "")
    .replace(/^\{\\colortbl/, "")
    .replace(/\}$/, "")
    .split(";")
    .map((s) => {
      const v = ["red", "green", "blue"].map((k) =>
        Number(s.match(new RegExp("\\\\" + k + "(\\d+)"))?.[1] ?? 0),
      );
      return v.every((n) => n === 255);
    });
  const reason = (): HiddenRun["why"] | null =>
    g.vanish
      ? "vanish"
      : g.size <= (visibility.tinyPoints ?? 1)
        ? "tiny"
        : colours[g.colour] && !g.background
          ? "white"
          : g.x + g.width < 0 ||
              g.y + g.height < 0 ||
              g.x > g.paperWidth ||
              g.y > g.paperHeight
            ? "offpage"
            : null;
  const put = (s: string) => {
    if (g.skip) return;
    const why = reason();
    if (why && s.trim()) {
      const last = visibility.hidden?.at(-1);
      if (last?.why === why && last.part === "rtf") last.text += s;
      else
        visibility.hidden?.push({
          text: s,
          why,
          part: "rtf",
          location: `byte:${i}`,
        });
    }
    if (!why || visibility.remove === false) out.push(s);
  };
  const flushBytes = () => {
    if (pendingBytes.length) {
      put(
        new TextDecoder("windows-1252").decode(Uint8Array.from(pendingBytes)),
      );
      pendingBytes = [];
    }
  };
  const emit = (s: string) => {
    flushBytes();
    put(s);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "{") {
      flushBytes();
      if (stack.length >= 256)
        throw new Error("RTF nesting exceeds safety budget");
      stack.push({ ...g });
      justOpened = true;
      i++;
      continue;
    }
    if (c === "}") {
      flushBytes();
      g = stack.pop() ?? g;
      justOpened = false;
      i++;
      continue;
    }
    if (c === "\\") {
      const next = src[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
        justOpened = false;
        continue;
      }
      if (next === "\n" || next === "\r") {
        emit("\n");
        i += next === "\r" && src[i + 2] === "\n" ? 3 : 2;
        continue;
      } // a backslash at the end of a line is a paragraph break (how Apple and many editors write it)
      if (next === "~") {
        emit(" ");
        i += 2;
        continue;
      }
      if (next === "_" || next === "-") {
        emit(next === "_" ? "-" : "");
        i += 2;
        continue;
      }
      if (next === "*") {
        if (justOpened) g.skip = true;
        i += 2;
        continue;
      } // "{\*\something": a destination we do not know
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (!g.skip && /^[0-9a-fA-F]{2}$/.test(hex))
          pendingBytes.push(parseInt(hex, 16));
        i += 4;
        justOpened = false;
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      flushBytes();
      const [whole, word, param] = m;
      i += whole.length;
      if (justOpened && RTF_SKIP.has(word)) g.skip = true;
      justOpened = false;
      if (word === "u" && param !== undefined) {
        let cp = parseInt(param, 10);
        if (cp < 0) cp += 65536;
        emit(String.fromCharCode(cp));
        i += g.uc;
        continue;
      } // the next uc characters are a fallback for readers without Unicode
      if (word === "uc" && param !== undefined) {
        const n = Number(param);
        if (n < 0 || n > 16)
          throw new Error("Invalid RTF Unicode fallback length");
        g.uc = n;
        continue;
      }
      if (word === "bin") {
        const n = Number(param);
        if (!Number.isSafeInteger(n) || n < 0 || i + n > src.length)
          throw new Error("Invalid RTF binary length");
        i += n;
        continue;
      }
      if (word === "plain") {
        g.vanish = false;
        g.size = 12;
        g.colour = 0;
        g.background = 0;
      }
      if (word === "v") g.vanish = param !== "0";
      if (word === "fs" && param !== undefined) g.size = Number(param) / 2;
      if (word === "cf" && param !== undefined) g.colour = Number(param);
      if (["highlight", "cb"].includes(word) && param !== undefined)
        g.background = Number(param);
      const fields: Record<string, keyof G> = {
        posx: "x",
        posy: "y",
        absw: "width",
        absh: "height",
        paperw: "paperWidth",
        paperh: "paperHeight",
      };
      if (fields[word] && param !== undefined)
        (g as any)[fields[word]] = Number(param);
      if (word in RTF_SYMBOLS) emit(RTF_SYMBOLS[word]);
      continue;
    }
    if (c === "\n" || c === "\r") {
      i++;
      continue;
    } // line breaks inside the file are layout, not text
    justOpened = false;
    emit(c);
    i++;
  }
  flushBytes();
  return cleanInvisible(out.join("").replace(/ /g, " ")).text;
}
export const readRtf = (
  bytes: Uint8Array,
  visibility?: Parameters<typeof rtfToText>[1],
) =>
  splitDateCells(
    rtfToText(new TextDecoder("latin1").decode(bytes), visibility),
  );

// ---------------------------------------------------------------- ODT (OpenDocument text)
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
export function odtToText(xml: string): string {
  return xml
    .replace(/<text:tab\s*\/>/g, "\t")
    .replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, n) => {
      const count = Number(n ?? 1);
      if (count > 10000) throw new Error("ODT space run exceeds safety budget");
      return " ".repeat(count);
    })
    .replace(/<text:list-item[^>]*>/g, "• ")
    .replace(/<\/text:(?:p|h)>/g, "\n")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<\/table:table-cell>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
      (_m, d, h, n) =>
        n ? ENTITIES[n] : String.fromCodePoint(d ? Number(d) : parseInt(h, 16)),
    )
    .split("\n").map(rtrim).join("\n");
}
export function readOdt(
  bytes: Uint8Array,
  visibility: Parameters<typeof rtfToText>[1] = {},
): string {
  const inspected = inspectOdt(
    bytes,
    visibility.remove !== false,
    visibility.tinyPoints ?? 1,
  );
  visibility.hidden?.push(...inspected.hidden);
  return cleanInvisible(odtToText(inspected.content)).text;
}

// ---------------------------------------------------------------- table cells
/**
 * Older Word and RTF files flatten a table row into one line with tabs between the cells ("Present<tab>Data Analyst"), where .docx keeps each cell on
 * its own line. A cell holding only a date ends the row's first column, so the row is split there and reads the same as the .docx version.
 */
export function splitDateCells(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const m = line.match(
        /^(\s*(?:present|now|current|(?:[A-Za-z]{3,9}\.? )?(?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:[A-Za-z]{3,9}\.? )?(?:19|20)\d{2}|present|now))?)\s*)\t+(\S.*)$/i,
      );
      return m ? [m[1].trim(), m[2].trim()] : [line];
    })
    .join("\n");
}

// ---------------------------------------------------------------- .doc (Word 97-2003)
export async function readDoc(bytes: Uint8Array): Promise<string> {
  const doc = await new WordExtractor().extract(Buffer.from(bytes));
  return splitDateCells(doc.getBody());
}

// ---------------------------------------------------------------- what kind of zip is this?
/**
 * What a zip really unpacks to. Every entry its central directory lists (the index a Word reader follows) is unpacked, up to `budget` bytes in all,
 * and compared with the size it declares; the declared sizes are never trusted (review 16 Nov 2026, B-H2: a Word file saying its parts were tiny
 * passed the old check, and the Word reader then unpacked the real data). `honest` is false when an entry is not the size it says, or cannot be
 * measured (a zip64 or unknown packing a document never needs). Stops counting just past the budget. Null when it is not a zip.
 */
export function expandedSize(bytes: Uint8Array, budget = Number.MAX_SAFE_INTEGER): { bytes: number; entries: number; honest: boolean } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u32 = (i: number) => v.getUint32(i, true), u16 = (i: number) => v.getUint16(i, true);
  let end = -1;   // the end-of-central-directory record sits in the last 64 KiB and 22 bytes
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (u32(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  // One disk, and the entries on it are all the entries: a zip that says otherwise is measured short by this count while an unpacker reads the rest
  // (independent security review, 23 Nov 2026: the honest first entry was measured and an oversized second one unpacked unchecked).
  let at = u32(end + 16), total = 0, entries = 0, honest = u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === u16(end + 10);
  for (let n = u16(end + 10); n > 0; n--) {
    if (at + 46 > bytes.length || u32(at) !== 0x02014b50) return { bytes: total, entries, honest: false };
    const method = u16(at + 10), packed = u32(at + 20), said = u32(at + 24), local = u32(at + 42);
    at += 46 + u16(at + 28) + u16(at + 30) + u16(at + 32); entries++;
    if (packed === 0xffffffff || said === 0xffffffff || local + 30 > bytes.length || u32(local) !== 0x04034b50) { honest = false; continue; }
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + packed > bytes.length || (method !== 0 && method !== 8)) { honest = false; continue; }
    const room = Math.min(budget - total, 0x7fffffff - 1);
    let real = packed;   // stored: the bytes are the content
    if (method === 8) {
      try { real = inflateRawSync(bytes.subarray(start, start + packed), { maxOutputLength: room + 1 }).length; }
      catch (e) { if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") real = room + 1; else { honest = false; continue; } }
    }
    if (real !== said) honest = false;
    total += real;
    if (total > budget) break;
  }
  return { bytes: total, entries, honest };
}

/** Whether a zip may be unpacked: it unpacks, measured, to no more than a document should (MAX_EXPANDED_MB) and says truthfully what it holds. */
export function unpacksSafely(bytes: Uint8Array): boolean {
  const size = expandedSize(bytes, config.maxExpandedBytes);
  return !!size && size.honest && size.bytes <= config.maxExpandedBytes && size.entries <= 20_000;
}
/** The one way a Word or OpenDocument file is unpacked, whole or in part: measured first, so no file can make the server unpack more than a document
 *  should. Unpackers size their output by what a file SAYS it holds, so a few megabytes could otherwise claim, and take, gigabytes of memory. */
export function unzipChecked(bytes: Uint8Array, filter?: (f: { name: string; originalSize: number }) => boolean): Record<string, Uint8Array> {
  if (!unpacksSafely(bytes)) throw new Error("This file unpacks to far more data than a document should, so it was not opened.");
  return unzipSync(bytes, filter ? { filter } : {});
}
/** A .docx and an .odt are both zip files. The names inside tell them apart, and a zip that is neither is not a document. Only the names are read, and the
 *  tiny "mimetype" entry when it is tiny: this runs on every upload before any other check, so it must never unpack what a file merely claims to hold. */
export function zipKind(bytes: Uint8Array): "docx" | "odt" | null {
  try {
    const names: string[] = [];
    const files = unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return f.name === "mimetype" && f.originalSize <= 256;
      },
    });
    if (names.includes("word/document.xml")) return "docx";
    if (
      files["mimetype"] &&
      new TextDecoder().decode(files["mimetype"]).trim() ===
        "application/vnd.oasis.opendocument.text"
    )
      return "odt";
  } catch {
    /* not a readable zip */
  }
  return null;
}

/**
 * Text in a Word file's page headers and footers. Many CVs put the name and contact details in the page header, where the body reader never looks.
 * Each part is read once (it is not repeated per page here), paragraph by paragraph; fields such as page numbers are left out. Runs a person cannot
 * see were already removed from `bytes` by the hidden-text step when the policy says so.
 */
export function docxHeaderFooterText(bytes: Uint8Array): { header: string; footer: string } {
  let files: Record<string, Uint8Array>;
  try { files = unzipChecked(bytes, (f) => /^word\/(header|footer)\d*\.xml$/.test(f.name)); } catch { return { header: "", footer: "" }; }
  const textOf = (xml: string) => xml
    .replace(/<w:fldSimple\b[\s\S]*?<\/w:fldSimple>/g, "")                         // simple fields (PAGE, NUMPAGES)
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "")                         // complex field codes
    .split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim())
    .filter((l) => l && !/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l));         // a bare page number is not content
  const part = (kind: "header" | "footer") => [...new Set(Object.keys(files).filter((n) => n.includes(kind)).sort().flatMap((n) => textOf(new TextDecoder().decode(files[n]))))].join("\n");
  return { header: part("header"), footer: part("footer") };
}
