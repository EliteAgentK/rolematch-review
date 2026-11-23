// How much of a record depends on a heading's wording: every invented text CV, read as printed and again with each heading replaced by a meaningless one. If sections are really read from what they hold, the two agree.
// Usage: node --import tsx test/candidate/headingInvariance.ts <pack>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prepareDocument } from "../../src/prepare";
import { CV_HEADINGS, splitSections } from "../../src/rules";
import { defaultSettings } from "../../src/settings";

process.env.CANDIDATE_PIPELINE = "all";
const pack = process.argv[2], dir = join(pack, "05_Text"), org = defaultSettings(), asOf = new Date("2026-10-28T00:00:00Z");
const low = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const tally: Record<string, { same: number; total: number; asPrinted: number; nonsense: number }> = {}, note = (f: string, want: string[], a: string[], b: string[]) => { const t = (tally[f] ??= { same: 0, total: 0, asPrinted: 0, nonsense: 0 }); for (const w of want) { t.total++; const x = a.includes(low(w)), y = b.includes(low(w)); if (x) t.asPrinted++; if (y) t.nonsense++; if (x === y) t.same++; } };
for (const f of readdirSync(dir).filter((x) => /^CV\d+\.txt$/.test(x))) {
  const text = readFileSync(join(dir, f), "utf8"), lines = text.split("\n"), known = new Set<string>();
  for (const l of lines) { const one = splitSections([l.trim()], CV_HEADINGS); if (l.trim() && one.sections.size && !one.header.length && [...one.sections.values()].every((v) => !v.length)) known.add(l.trim()); }
  let n = 0; const map = new Map([...known].map((h) => [h, `PART ${++n === 1 ? "ONE" : n === 2 ? "TWO" : n === 3 ? "THREE" : n === 4 ? "FOUR" : n === 5 ? "FIVE" : n === 6 ? "SIX" : "SEVEN"}`]));
  const changed = lines.map((l) => map.get(l.trim()) ?? l).join("\n"), e = JSON.parse(readFileSync(join(pack, "Reference", "Expected_CVs", f.replace(".txt", ".json")), "utf8"));
  const [a, b]: any[] = await Promise.all([prepareDocument(new TextEncoder().encode(text), { kind: "cv", org, asOf }), prepareDocument(new TextEncoder().encode(changed), { kind: "cv", org, asOf })]);
  const roles = (r: any) => (r.record?.workHistory ?? []).map((w: any) => low(w.position)), skills = (r: any) => (r.record?.skills ?? []).map(low), edu = (r: any) => (r.record?.education ?? []).map((x: any) => low(x.degree)), langs = (r: any) => (r.record?.languages ?? []).map(low);
  note("roles", e.work_history.map((w: any) => w.title), roles(a), roles(b)); note("skills", e.skills, skills(a), skills(b)); note("qualifications", e.education.map((q: any) => q.qualification), edu(a), edu(b)); note("certifications", e.certifications.map((c: any) => c.name), edu(a), edu(b)); note("languages", e.languages, langs(a), langs(b));
}
for (const [f, t] of Object.entries(tally)) console.log(`${f.padEnd(16)} found as printed ${t.asPrinted}/${t.total}, under meaningless headings ${t.nonsense}/${t.total}`);
process.exit(0);
