// Local visibility inspection. No entities, external links, fonts or images are fetched.
import { unzipSync, zipSync } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
export interface HiddenRun {
  text: string;
  why: "vanish" | "white" | "tiny" | "offpage";
  part?: string;
  location?: string;
}
class VisibilityError extends Error {}
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const O = "urn:oasis:names:tc:opendocument:xmlns:",
  TEXT = O + "text:1.0",
  STYLE = O + "style:1.0",
  FO = O + "xsl-fo-compatible:1.0",
  SVG = O + "svg-compatible:1.0",
  DRAW = O + "drawing:1.0";
type E = any;
const children = (e: E): E[] =>
  Array.from(e?.childNodes ?? []).filter((n: any) => n.nodeType === 1);
const all = (e: E, ns: string, n: string): E[] =>
  Array.from(e.getElementsByTagNameNS(ns, n));
const attr = (e: E, ns: string, n: string) => e?.getAttributeNS(ns, n) ?? "";
const direct = (e: E, ns: string, n: string) =>
  children(e).find((x) => x.namespaceURI === ns && x.localName === n);
const ancestors = (e: E): E[] => {
  const a: E[] = [];
  for (let p = e; p?.nodeType === 1; p = p.parentNode) a.push(p);
  return a;
};
const location = (e: E) =>
  ancestors(e)
    .reverse()
    .map(
      (n) =>
        `${n.localName}[${
          children(n.parentNode)
            .filter((s) => s.localName === n.localName)
            .indexOf(n) + 1
        }]`,
    )
    .join("/");
const white = (s: string) => /^#?(fff|ffffff)$/i.test(s);
const merge = (...ps: any[]) =>
  Object.assign(
    {},
    ...ps.map((p) =>
      Object.fromEntries(
        Object.entries(p ?? {}).filter(([, v]) => v !== undefined),
      ),
    ),
  );
function remember(a: HiddenRun[], e: E, why: HiddenRun["why"], part: string) {
  const text = e.textContent ?? "";
  if (text.trim()) a.push({ text, why, part, location: location(e) });
}

/** Platform safety ceilings. ZIP errors fail closed instead of passing unsafe bytes to the next reader. */
function documentParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, Uint8Array> {
  if (bytes.length > 50 * 1024 * 1024)
    throw new VisibilityError("Compressed document exceeds safety budget");
  let total = 0,
    count = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (
          ++count > 4096 ||
          total > 80 * 1024 * 1024 ||
          !Number.isSafeInteger(total)
        )
          throw new VisibilityError("Archive exceeds expanded safety budget");
        if (wanted(f.name) && f.originalSize > 8 * 1024 * 1024)
          throw new VisibilityError("Document part exceeds safety budget");
        return wanted(f.name);
      },
    });
  } catch (e) {
    throw e instanceof VisibilityError
      ? e
      : new VisibilityError("Document archive cannot be inspected safely");
  }
}
function xml(bytes: Uint8Array): E {
  const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(s))
    throw new VisibilityError("XML declarations are not permitted");
  let bad = false;
  const d = new DOMParser({
    errorHandler: {
      warning: () => {
        bad = true;
      },
      error: () => {
        bad = true;
      },
      fatalError: () => {
        bad = true;
      },
    },
  }).parseFromString(s, "application/xml");
  if (bad || !d.documentElement)
    throw new VisibilityError("Document XML cannot be inspected safely");
  return d;
}
const enabled = (p: E, n: string) => {
  const e = direct(p, W, n);
  return e ? !/^(0|false|off)$/i.test(attr(e, W, "val")) : undefined;
};
function wordProps(p: E) {
  return {
    vanish: enabled(p, "vanish") ?? enabled(p, "specVanish"),
    colour: attr(direct(p, W, "color"), W, "val") || undefined,
    size: attr(direct(p, W, "sz"), W, "val")
      ? Number(attr(direct(p, W, "sz"), W, "val")) / 2
      : undefined,
  };
}
function wordOffPage(e: E, d: E) {
  const pg = all(d, W, "pgSz")[0],
    width = Number(attr(pg, W, "w")) * 635,
    height = Number(attr(pg, W, "h")) * 635;
  for (const p of ancestors(e)) {
    if (p.namespaceURI !== WP || p.localName !== "anchor") continue;
    const extent = direct(p, WP, "extent");
    for (const [axis, limit, size] of [
      ["H", width, Number(extent?.getAttribute("cx"))],
      ["V", height, Number(extent?.getAttribute("cy"))],
    ] as const) {
      const pos = direct(p, WP, "position" + axis),
        node = direct(pos, WP, "posOffset");
      if (pos?.getAttribute("relativeFrom") !== "page" || !node) continue;
      const offset = Number(node.textContent);
      if (
        Number.isFinite(offset) &&
        Number.isFinite(size) &&
        (offset + size < 0 || (limit > 0 && offset > limit))
      )
        return true;
    }
  }
  return false;
}
/** Resolves direct and inherited run styles, local paragraph/cell shading and explicit page anchors. */
export function removeHiddenFromDocx(
  bytes: Uint8Array,
  remove = true,
  tinyPoints = 1,
): { bytes: Uint8Array; hidden: HiddenRun[] } {
  const files = documentParts(bytes, () => true);
  if (!files["word/document.xml"])
    throw new VisibilityError("Missing Word document XML");
  const d = xml(files["word/document.xml"]),
    styles = files["word/styles.xml"] ? xml(files["word/styles.xml"]) : null;
  const byId = new Map<string, E>(
    styles
      ? all(styles, W, "style").map((s) => [attr(s, W, "styleId"), s])
      : [],
  );
  const effective = (id: string, seen = new Set<string>()): any => {
    if (!id) return {};
    if (seen.has(id) || seen.size > 32)
      throw new VisibilityError("Cyclic or excessively deep Word styles");
    seen.add(id);
    const s = byId.get(id);
    return s
      ? merge(
          effective(attr(direct(s, W, "basedOn"), W, "val"), seen),
          wordProps(direct(s, W, "rPr")),
        )
      : {};
  };
  const defaults = styles
    ? wordProps(direct(all(styles, W, "rPrDefault")[0], W, "rPr"))
    : {};
  const hidden: HiddenRun[] = [];
  for (const t of all(d, W, "t")) {
    const chain = ancestors(t),
      r = chain.find((n) => n.namespaceURI === W && n.localName === "r"),
      p = chain.find((n) => n.namespaceURI === W && n.localName === "p"),
      pr = direct(r, W, "rPr"),
      ppr = direct(p, W, "pPr");
    const props = merge(
      defaults,
      effective(attr(direct(ppr, W, "pStyle"), W, "val")),
      effective(attr(direct(pr, W, "rStyle"), W, "val")),
      wordProps(pr),
    );
    const backed = chain
      .flatMap((n) => [
        direct(direct(n, W, "pPr"), W, "shd"),
        direct(direct(n, W, "tcPr"), W, "shd"),
        direct(direct(n, W, "rPr"), W, "shd"),
      ])
      .filter(Boolean)
      .some((s) => {
        const fill = attr(s, W, "fill");
        return /^[0-9a-f]{6}$/i.test(fill) && !white(fill);
      });
    const why: HiddenRun["why"] | null = wordOffPage(t, d)
      ? "offpage"
      : props.vanish
        ? "vanish"
        : white(props.colour ?? "") && !backed
          ? "white"
          : Number.isFinite(props.size) && props.size <= tinyPoints
            ? "tiny"
            : null;
    if (why) {
      remember(hidden, t, why, "word/document.xml");
      if (remove) t.parentNode.removeChild(t);
    }
  }
  if (!remove || !hidden.length) return { bytes, hidden };
  files["word/document.xml"] = new TextEncoder().encode(
    new XMLSerializer().serializeToString(d),
  );
  return { bytes: zipSync(files), hidden };
}
const pt = (s: string): number | null => {
  const m = s.match(/^(-?[\d.]+)(pt|cm|mm|in|pc)$/);
  if (!m) return null;
  const n =
    Number(m[1]) *
    ({ pt: 1, cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pc: 12 } as any)[m[2]];
  return Number.isFinite(n) ? n : null;
};
export function inspectOdt(
  bytes: Uint8Array,
  remove = true,
  tinyPoints = 1,
): { content: string; hidden: HiddenRun[] } {
  const files = documentParts(
    bytes,
    (n) => n === "content.xml" || n === "styles.xml",
  );
  if (!files["content.xml"])
    throw new VisibilityError("Missing OpenDocument content XML");
  const d = xml(files["content.xml"]),
    docs = [...(files["styles.xml"] ? [xml(files["styles.xml"])] : []), d],
    styles = new Map<string, E>();
  for (const doc of docs)
    for (const s of all(doc, STYLE, "style"))
      styles.set(attr(s, STYLE, "family") + ":" + attr(s, STYLE, "name"), s);
  const effective = (
    name: string,
    family: string,
    seen = new Set<string>(),
  ): any => {
    if (!name) return {};
    const key = family + ":" + name;
    if (seen.has(key) || seen.size > 32)
      throw new VisibilityError("Cyclic OpenDocument styles");
    seen.add(key);
    const s = styles.get(key);
    if (!s) return {};
    const p = direct(s, STYLE, "text-properties"),
      pp = direct(s, STYLE, "paragraph-properties");
    return merge(effective(attr(s, STYLE, "parent-style-name"), family, seen), {
      colour: attr(p, FO, "color") || undefined,
      size: pt(attr(p, FO, "font-size")) ?? undefined,
      vanish: attr(p, TEXT, "display") === "none" ? true : undefined,
      background:
        attr(p, FO, "background-color") ||
        attr(pp, FO, "background-color") ||
        undefined,
    });
  };
  const hidden: HiddenRun[] = [];
  const visit = (e: E, inherited: any, off = false) => {
    let props = inherited;
    if (e.namespaceURI === TEXT && ["p", "h", "span"].includes(e.localName))
      props = merge(
        inherited,
        effective(
          attr(e, TEXT, "style-name"),
          e.localName === "span" ? "text" : "paragraph",
        ),
      );
    if (
      e.namespaceURI === DRAW &&
      e.localName === "frame" &&
      attr(e, TEXT, "anchor-type") === "page"
    ) {
      const x = pt(attr(e, SVG, "x")),
        y = pt(attr(e, SVG, "y")),
        w = pt(attr(e, SVG, "width")),
        h = pt(attr(e, SVG, "height"));
      off ||=
        (x !== null && w !== null && x + w < 0) ||
        (y !== null && h !== null && y + h < 0);
    }
    const backed =
        props.background &&
        props.background !== "transparent" &&
        !white(props.background),
      why: HiddenRun["why"] | null = off
        ? "offpage"
        : props.vanish
          ? "vanish"
          : white(props.colour ?? "") && !backed
            ? "white"
            : Number.isFinite(props.size) && props.size <= tinyPoints
              ? "tiny"
              : null;
    if (
      why &&
      e.namespaceURI === TEXT &&
      ["p", "h", "span"].includes(e.localName)
    ) {
      remember(hidden, e, why, "content.xml");
      if (remove) {
        e.parentNode.removeChild(e);
        return;
      }
    }
    for (const c of children(e)) visit(c, props, off);
  };
  visit(d.documentElement, {});
  return { content: new XMLSerializer().serializeToString(d), hidden };
}
const INVISIBLE =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0e\ufeff\uffa0]/g;
const LIGATURES: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};
export function cleanInvisible(text: string): {
  text: string;
  removed: number;
} {
  let removed = 0;
  return {
    text: text
      .replace(INVISIBLE, () => {
        removed++;
        return "";
      })
      .replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c])
      // A bullet drawn from a symbol font (Word's Symbol and Wingdings bullets) arrives as a private character (U+F000 to U+F0FF) that no other font can
      // draw: a box with a question mark on screen (owner, 10 Nov 2026). At the start of a line it is a bullet; anywhere else it is removed and counted.
      .replace(/^([ \t]*)[\uf000-\uf0ff]/gm, "$1•")
      .replace(/[\uf000-\uf0ff]/g, () => {
        removed++;
        return "";
      })
      .replace(/\r\n?/g, "\n"),
    removed,
  };
}
