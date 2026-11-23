// How plausible is text that OCR produced? Language-independent word checks, in the spirit of the consistency checks Tesseract's own old language model makes
// (script, case, digit and punctuation consistency inside a word). No dictionary: a CV is full of names and tools, and a dictionary would punish them.
// The score is a signal for a person to look at the original, never a reason to reject a candidate. Its thresholds are measured, not assumed (npm run stress:quality).

export interface WordChecks { tokens: number; flagged: number; byCheck: Record<string, number>; score: number }

const LETTERS = /\p{L}/u;
const script = (ch: string) => (/\p{Script=Latin}/u.test(ch) ? "latin" : /\p{Script=Cyrillic}/u.test(ch) ? "cyrillic" : /\p{Script=Greek}/u.test(ch) ? "greek" : "other");

/** The checks that flag a single word as unlikely to be what the page says. Each returns its name, or null. */
function checkWord(word: string): string | null {
  const letters = [...word].filter((c) => LETTERS.test(c));
  if (letters.length < 3) return null;
  if (new Set(letters.map(script)).size > 1) return "mixed-script";                                     // Latin letters beside Cyrillic or Greek ones
  if (/[|\\~^`<>{}[\]_=]/.test(word.replace(/^\W+|\W+$/g, ""))) return "stray-symbol";                    // symbols in the middle of a word
  if (/(.)\1{3,}/.test(word)) return "repeated-letter";                                                  // "lllll", "iiii"
  if (letters.length >= 5 && !/[aeiouyàáâãäåèéêëìíîïòóôõöùúûüAEIOUY]/.test(word) && !/^[A-Z0-9]+$/.test(word)) return "no-vowel";  // long, mixed-case and no vowel
  if (/[a-z]{2,}\d+[a-z]{2,}/i.test(word)) return "digit-in-word";                                       // "ab3cd"
  if (/[a-z][A-Z]{2,}[a-z]/.test(word)) return "odd-case";                                               // "heLLo"
  return null;
}

/** Splits text into words and reports how many are flagged. The score is the share of words that were NOT flagged (1 = no doubt at all). */
export function wordChecks(text: string): WordChecks {
  const words = text.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter((w) => w.length > 0);
  const byCheck: Record<string, number> = {};
  let flagged = 0;
  for (const w of words) { const c = checkWord(w); if (c) { flagged++; byCheck[c] = (byCheck[c] ?? 0) + 1; } }
  return { tokens: words.length, flagged, byCheck, score: words.length ? 1 - flagged / words.length : 0 };
}
