// A contact detail read by OCR is what someone will act on, and one wrong character sends a message to a stranger. So each contact row is read more than once (ocr.ts closerLook), and a value is published
// only when the readings support it. A reading's spaces and slips of punctuation are undone first: "name.5 10@ candidate. example" is one address. Characters are never changed to fit a name or a domain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addressWithDigits, levenshtein } from "../ocr";

const TLDS = new Set(readFileSync(join(import.meta.dirname, "topLevelDomains.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")));
const ADDRESS = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** An address ends in a real top-level domain: "name@company.exampl" lost its end, and however sure the reading is, it is not an address. */
export const endsInRealDomain = (address: string) => TLDS.has(address.split(".").at(-1)!.toLowerCase());
/** An address that has lost its start, "578@firm.example" or ".cv0648@firm.example", is no more an address than one that lost its end. */
export const wholeAddress = (address: string) => { const local = address.split("@")[0]; return endsInRealDomain(address) && /^[a-z0-9]/i.test(local) && (local.match(/[a-z]/gi) ?? []).length >= 2; };

/** Puts an address back together from what OCR did to the spaces and small marks around it. Only spaces and marks change, never a letter or digit. */
export function addressesIn(line: string): string[] {
  let t = line.replace(/\s*@\s*/g, "@").replace(/[(),;:]+@/g, "@");
  // after the @: "@candidate. example", "@candidate .example", "@candidate example" (a dropped dot, only where the next word really is a top-level domain and the domain has no dot of its own)
  t = t.replace(/@([a-z0-9-]+)\s*\.\s*([a-z0-9-]+(?:\s*\.\s*[a-z0-9-]+)*)/gi, (_m, a: string, b: string) => `@${a}.${b.replace(/\s/g, "")}`);
  t = t.replace(/@([A-Za-z0-9-]+)\s+([a-z]{2,})(?=\s*(?:\||$))/g, (m, a: string, b: string) => (TLDS.has(b) ? `@${a}.${b}` : m));
  // before the @: digits split by a space ("name.5 10@", "name.51 1@"), a space after a dot ("name. 502@"), a space before the @ is already gone; a comma for a dot ("name,508@")
  t = t.replace(/([a-z0-9._-]*[.,_-])\s+([a-z0-9._-]+@)/gi, "$1$2").replace(/([.,_-]\d+)\s+(\d+@)/g, "$1$2").replace(/([a-z])\s+(\d+@)/gi, "$1.$2").replace(/([a-z0-9]),(\d+@)/gi, "$1.$2");
  // the end of an address that wrapped in a narrow cell: "@candidate.exampl e", "@candidate.exam ple". It is joined only where the join makes a real domain of what was not one.
  t = t.replace(/(@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z0-9-]*)\s+(?:\|\s*)?([a-z]{1,8})(?=\s|\||$)/g, (m, address: string, rest: string) => (!TLDS.has(address.split(".").at(-1)!.toLowerCase()) && TLDS.has((address.split(".").at(-1)! + rest).toLowerCase()) ? address + rest : m));
  return [...new Set((t.match(ADDRESS) ?? []).map((a) => a.toLowerCase().replace(/[.,;]+$/, "")))];
}
/** The part of a cut-off address that is missing, looked for in the lines near it: the short word that makes a real domain of it. */
export function wrappedEnd(address: string, nearby: string[]): string | null {
  const last = address.split(".").at(-1)!.toLowerCase(); if (TLDS.has(last)) return null;
  return nearby.map((l) => l.trim()).find((l) => /^[a-z]{1,10}$/.test(l) && TLDS.has(last + l)) ?? null;
}

const PHONE = /(?<![\d/-])[+#]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?![\d/-])/g;
/** The digits of each phone number on a line, in the form the number takes on a CV. A plus OCR read as 4, 1 or # is put back only where the rest is the country code a plus would lead ("427 00..."). */
export function numbersIn(line: string): { digits: string; printed: string }[] {
  const out: { digits: string; printed: string }[] = [];
  for (const m of line.replace(/@\S+/g, " ").matchAll(PHONE)) {
    const printed = m[0].trim(); let digits = printed.replace(/\D/g, "");
    if (/^[14]27\s/.test(printed) && digits.length === 12) digits = digits.slice(1);
    if (digits.length >= 9 && digits.length <= 12 && !/^(?:19|20)\d{2}\D+(?:19|20)\d{2}$/.test(printed)) out.push({ digits, printed: /^[14#]27\s/.test(printed) ? printed.replace(/^[14#]/, "+") : printed });
  }
  return out;
}

export interface Resolved { value: string; status: "agreed" | "single" | "uncertain"; readings: string[]; rejected: string[] }

/**
 * What the readings support, by rule rather than by any one engine's confidence:
 * - two readings give the same value: it is published;
 * - one reading alone gives a whole value and the others gave nothing whole: published only if the value carries a word of the person's name, the one outside check a document offers;
 * - readings disagree and more than one value is possible: the value carrying every word of the name wins if exactly one does, otherwise nothing is published and a person is told what was read.
 * A truncated address counts as nothing at all: it is kept for the note, never published.
 */
export function resolveAddress(readings: string[], nameWords: string[], misreadWord: (word: string) => boolean = () => false): Resolved | null {
  // A number with a letter in it is a number before the readings are compared, so "name.5i8" and "name.518" are one vote, not two (ocr.ts addressWithDigits).
  const all = readings.map((r) => addressesIn(r).map(addressWithDigits)), found = all.flat();
  if (!found.length) return null;
  // A domain one letter from a common word and not itself one is a misreading the name cannot vouch for: "eandidate", "candidare".
  const usable = (a: string) => wholeAddress(a) && !misreadWord(a.split("@")[1].split(".")[0]);
  const complete = all.map((list) => list.filter(usable)), rejected = [...new Set(found.filter((a) => !usable(a)))], counts = new Map<string, number>();
  for (const list of complete) for (const a of new Set(list)) counts.set(a, (counts.get(a) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]), distinct = ranked.map(([a]) => a), local = (a: string) => a.split("@")[0].replace(/[^a-z]/g, "");
  if (!ranked.length) return { value: "", status: "uncertain", readings: [], rejected };
  // An address one or two letters from the person's whole name is far more likely a misreading than a different spelling: "ficardontuli" for Ricardo Ntuli. Even two readings can share one slip, and an address is what someone will act on.
  const whole = nameWords.join(""), slip = (a: string) => { if (nameWords.length < 2) return false; const l = local(a); if (l.includes(whole) || nameWords.every((w) => l.includes(w))) return false; const d = Math.min(levenshtein(l, whole), levenshtein(l, [...nameWords].reverse().join(""))); return d >= 1 && d <= 2; };
  // The word beside an address can stick to its front: "londonlethabomthethwa" and "lethabomthethwa" are the same address, and what is left without the extra word is the one that was printed.
  const glued = distinct.find((a) => distinct.some((b) => b !== a && b.endsWith(a) && b.split("@")[0].length > a.split("@")[0].length && /^[a-z]+$/.test(b.slice(0, b.length - a.length)))); if (glued && nameWords.every((w) => local(glued).includes(w))) return { value: glued, status: "single", readings: distinct, rejected };
  if (slip(ranked[0][0])) { const better = distinct.find((a) => !slip(a) && nameWords.length >= 2 && nameWords.every((w) => local(a).includes(w))); return better ? { value: better, status: "single", readings: distinct, rejected } : { value: "", status: "uncertain", readings: distinct, rejected }; }
  if (ranked[0][1] >= 2 && (ranked.length === 1 || ranked[1][1] < ranked[0][1])) return { value: ranked[0][0], status: "agreed", readings: distinct, rejected };
  // The name can only vouch for the part before the @, so the part after it must not be in dispute among anything that was read, whole or cut off.
  const domainOf = (a: string) => a.split("@")[1].split(".")[0], settled = (a: string) => [...distinct, ...rejected].every((x) => domainOf(x) === domainOf(a));
  if (ranked.length === 1) return nameWords.some((w) => local(ranked[0][0]).includes(w)) && settled(ranked[0][0]) ? { value: ranked[0][0], status: "single", readings: distinct, rejected } : { value: "", status: "uncertain", readings: distinct, rejected };
  const carrying = distinct.filter((a) => nameWords.length >= 2 && nameWords.every((w) => local(a).includes(w)));
  if (carrying.length === 1 && settled(carrying[0])) return { value: carrying[0], status: "single", readings: distinct, rejected };
  return { value: "", status: "uncertain", readings: distinct, rejected };
}

/** The same for a phone number, which has no name to check against: two readings must agree, and one reading alone is enough only if no other reading gave a different number. */
export function resolveNumbers(readings: string[]): { value: string; status: Resolved["status"]; readings: string[] }[] {
  const all = readings.map(numbersIn), counts = new Map<string, { n: number; printed: string }>();
  for (const list of all) for (const key of new Set(list.map((x) => x.digits))) { const c = counts.get(key); if (c) c.n++; else counts.set(key, { n: 1, printed: list.find((x) => x.digits === key)!.printed }); }
  if (!counts.size) return [];
  const ranked = [...counts].sort((a, b) => b[1].n - a[1].n), near = (a: string, b: string) => { if (a.length !== b.length) return a.slice(-9) === b.slice(-9); let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d <= 3; };
  const out: { value: string; status: Resolved["status"]; readings: string[] }[] = [], used = new Set<string>();
  // Several numbers can share a row. Readings of one number differ by a few digits, so those are grouped and judged together.
  for (const [key, c] of ranked) {
    if (used.has(key)) continue;
    const rivals = ranked.filter(([k]) => k !== key && !used.has(k) && near(k, key)).map(([k]) => k); for (const r of rivals) used.add(r); used.add(key);
    const tied = rivals.some((r) => counts.get(r)!.n === c.n);
    if (c.n >= 2 && !tied) out.push({ value: c.printed, status: "agreed", readings: [c.printed] });
    else if (!rivals.length) out.push({ value: c.printed, status: "single", readings: [c.printed] });
    else out.push({ value: "", status: "uncertain", readings: [c.printed, ...rivals.map((r) => counts.get(r)!.printed)] });
  }
  return out;
}
