// "Worth noting" never repeats what the panel already shows (owner, 10 Nov 2026: 18 items under Worth noting were the summary and the duties again;
// "I don't know how we let that go"). The parser's word rules file every paragraph of prose after the first under Worth noting, so on a CV with a long
// profile, or a scan whose layout it misreads, the summary and the duties came back a second time. A structural check, not a word list: an item whose
// words are already in the summary, a job's duties, a project or an earlier item is left out. It runs where a record is saved and where a candidate is
// sent, so records saved before it are shown without their repeats too (their stored reading is untouched). The CV pass replaces the parser's guess
// with lines Claude labels (docs/parser/CV_READING_CONTRACT.md).
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The items that say something the rest of the record does not. */
export function worthNotingOnly(record: { worthNoting?: string[]; summary?: string; workHistory?: { responsibilities?: string[] }[]; projects?: unknown[] }): string[] {
  const shown = [record.summary ?? "", ...(record.workHistory ?? []).flatMap((w) => w.responsibilities ?? []), ...(record.projects ?? []).map((p) => (typeof p === "string" ? p : JSON.stringify(p)))].map(words).join(" | ");
  const kept: string[] = [], seen = new Set<string>();
  for (const item of record.worthNoting ?? []) {
    const w = words(String(item ?? ""));
    if (!w || seen.has(w)) continue;
    // Repeated if the item, or most of its sentences, are already there word for word.
    const parts = String(item).split(/(?<=[.;!?])\s+/).map(words).filter((p) => p.split(" ").length >= 4);
    const repeated = shown.includes(w) || (parts.length > 0 && parts.filter((p) => shown.includes(p) || kept.some((k) => words(k).includes(p))).length / parts.length >= 0.5);
    if (repeated) continue;
    seen.add(w); kept.push(String(item));
  }
  return kept;
}
export const withWorthNotingOnly = <T extends { worthNoting?: string[] }>(r: T): T => (r.worthNoting?.length ? { ...r, worthNoting: worthNotingOnly(r as any) } : r);
