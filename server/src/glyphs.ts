// Some PDFs draw a letter from a glyph that has no Unicode mapping, so the text layer holds a stray control character where the
// letter should be ("Hands-on \u0004ork", "Tail\u0004ind") or sometimes next to a letter that decoded wrongly ("Workfloo\u0004").
// The page still LOOKS right, because the shapes are drawn. We read the page image with OCR and use it only as a VOCABULARY:
// a broken word is repaired when exactly one word the OCR also saw fits. The CV's own text and layout are kept, so none of OCR's
// usual noise (bullets read as "«", "AI" as "Al") leaks in. Anything we cannot repair is reported, never guessed.
export const GLYPH_MARK = "";
const MARKED = new RegExp(`${GLYPH_MARK}([0-9a-f]{2})`, "g");
const TOKEN = new RegExp(`([A-Za-z]*(?:${GLYPH_MARK}[0-9a-f]{2}[A-Za-z]*)+)`, "g");
const CANDIDATES = ["", ..."abcdefghijklmnopqrstuvwxyz", "fi", "fl", "ff", "ffi", "ffl", "th"];

export const markControl = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => GLYPH_MARK + c.charCodeAt(0).toString(16).padStart(2, "0"));
const hasUnreadable = (s: string) => s.includes(GLYPH_MARK);

/** Words that start or end with a stray hyphen ("-ith", "revie-") are what a letter decoded as "-" looks like. A suspended hyphen ("site- and") is fine. */
const STRAY_HYPHEN = /(?:^|[\s(])-[a-z]{2,}|[a-z]{3,}-(?=[\s.,;:)]|$)(?!\s+(?:and|or|to)\b)/gi;
export const strayHyphens = (s: string) => (s.match(STRAY_HYPHEN) ?? []).length;
export const looksDamaged = (s: string) => hasUnreadable(s) || strayHyphens(s) >= 3;
export const stripMarks = (s: string) => s.replace(MARKED, "");

export interface Repair { text: string; repaired: number; unresolved: number }

/** True when two words differ by at most one inserted, removed or changed letter. */
function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

const recase = (original: string, word: string) =>
  original.length >= 2 && /^[A-Z]+$/.test(original) ? word.toUpperCase() : /^[A-Z]/.test(original) ? word[0].toUpperCase() + word.slice(1) : word;

export function repairWithVocabulary(text: string, ocrText: string): Repair {
  const vocab = new Set(ocrText.toLowerCase().match(/[a-z]{2,}/g) ?? []);
  const long = [...vocab].filter((w) => w.length >= 5);
  const tally = new Map<string, number>(); // how often each (code, replacement) was the only fit: used to settle ambiguous words
  const parts = (token: string) => token.split(new RegExp(`${GLYPH_MARK}[0-9a-f]{2}`));
  const fits = (token: string) => {
    const codes = [...token.matchAll(MARKED)].map((m) => m[1]);
    const segs = parts(token).map((s) => s.toLowerCase());
    if (codes.length !== 1) return { codes, found: [] as string[] };
    const found = CANDIDATES.filter((c) => vocab.has(segs[0] + c + segs[1]) && (segs[0] + c + segs[1]).length >= 2);
    return { codes, found };
  };
  for (const m of text.matchAll(TOKEN)) { const { codes, found } = fits(m[1]); if (found.length === 1) tally.set(codes[0] + found[0], (tally.get(codes[0] + found[0]) ?? 0) + 1); }

  let repaired = 0, unresolved = 0;
  const out = text.replace(TOKEN, (token: string) => {
    const bare = parts(token).join("");
    const { codes, found } = fits(token);
    let pick: string | undefined;
    if (found.length === 1) pick = found[0];
    else if (found.length > 1) pick = [...found].sort((a, b) => (tally.get(codes[0] + b) ?? 0) - (tally.get(codes[0] + a) ?? 0))[0];
    if (pick !== undefined) { repaired++; const segs = parts(token); return recase(bare, segs[0] + pick + segs[1]); }
    if (!bare) return ""; // a lone symbol (a bullet, say): nothing to repair
    // Last resort: the letters around the break are themselves slightly wrong; accept a single vocabulary word one edit away.
    const lower = bare.toLowerCase();
    if (lower.length >= 5) {
      const near = long.filter((w) => withinOne(lower, w));
      if (near.length === 1) { repaired++; return recase(bare, near[0]); }
    }
    unresolved++;
    return bare;
  });
  // A letter that decoded as a hyphen: "-ith" is "with", "revie-" is "review", "-orkfloo-" is "workflow".
  const seen = new Set((ocrText.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? []));
  const fixed = stripMarks(out).replace(/[A-Za-z]*-[A-Za-z-]*|[A-Za-z]+-/g, (token, at: number, whole: string) => {
    if (token.endsWith("-") && whole[at + token.length] === "\n") return token; // a word broken across two lines
    const lower = token.toLowerCase();
    if (seen.has(lower) || (!/^-|-$|--/.test(token) && lower.split("-").every((p) => seen.has(p)))) return token; // an ordinary compound the page really shows
    if (!/^-|-$|--/.test(token)) { // an inner hyphen is suspect only when swapping it for "w" gives a word the page shows ("re-ards" -> "rewards")
      const inner = lower.replace(/-/g, "w"), joined = lower.replace(/-/g, "");
      if (vocab.has(inner)) { repaired++; return recase(token, inner); }
      if (vocab.has(joined)) { repaired++; return recase(token, joined); } // "softw-are": a ghost hyphen inside a word
      return token;
    }
    const asW = lower.replace(/-/g, "w");
    // The hyphen carries no capital letter, so capitalise only where a sentence or line starts.
    const startsSentence = at === 0 || /(?:^|[.!?•\n]\s*)$/.test(whole.slice(Math.max(0, at - 4), at)) || whole[at - 1] === "\n";
    const cased = (w: string) => (startsSentence ? w[0].toUpperCase() + w.slice(1) : w);
    if (seen.has(asW) || vocab.has(asW)) { repaired++; return cased(asW); }
    if (asW.length >= 5) { const near = long.filter((w) => withinOne(asW, w)); if (near.length === 1) { repaired++; return cased(near[0]); } }
    unresolved++;
    return token;
  });
  return { text: fixed, repaired, unresolved };
}
