// Accuracy measured against what the SITE shows: the fields on a candidate card and the sections of the candidate panel, taken from the
// record the platform really produces (extractCandidate), and for the card from the same helper functions the browser uses.
import { currentEmployer, highestQualification } from "../../../src/utils/candidateFacts";
import { orderSkillsByRecency, splitSkills } from "../../../src/utils/skillOrder";
import { toMonth } from "../../src/dates";
import { findSkills } from "../../src/skills";
import type { Persona } from "./personas";

const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => n(s).split(" ").filter(Boolean);
const f1 = (a: string, b: string) => {
  const t = new Map<string, number>(); for (const w of words(a)) t.set(w, (t.get(w) ?? 0) + 1);
  let hit = 0; const g = words(b);
  for (const w of g) if ((t.get(w) ?? 0) > 0) { hit++; t.set(w, t.get(w)! - 1); }
  const total = words(a).length; if (!total || !g.length) return 0;
  const p = hit / g.length, r = hit / total; return p + r ? (2 * p * r) / (p + r) : 0;
};
const sameList = (want: string[], got: string[]) => ({
  recall: want.length ? want.filter((w) => got.some((g) => n(g).includes(n(w)) || n(w).includes(n(g)))).length / want.length : 1,
  extra: got.filter((g) => !want.some((w) => n(g).includes(n(w)) || n(w).includes(n(g)))).length,
});
const MONTH = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;

/** The corpus is read as if every CV was uploaded on this date, as the live pipeline reads each document as of its upload date. The reader and the
 * answer key use the same date, so no check drifts with today's clock (until 2026-10-28 the expected years came from the clock and the check read 0%). */
export const CORPUS_AS_OF = new Date(Date.UTC(2026, 9, 1));

/** Years of dated experience the persona's roles add up to (overlaps counted once), the same idea the platform uses; a current role runs to `asOf`. */
function expectedYears(p: Persona, asOf: Date): number {
  const nowM = asOf.getUTCFullYear() * 12 + asOf.getUTCMonth();
  const spans = p.roles.map((r) => [r.start[0] * 12 + r.start[1] - 1, r.end ? r.end[0] * 12 + r.end[1] - 1 : nowM] as const).sort((a, b) => a[0] - b[0]);
  let months = 0, cur: [number, number] | null = null;
  for (const [s, e] of spans) { if (cur && s <= cur[1]) cur[1] = Math.max(cur[1], e); else { if (cur) months += cur[1] - cur[0]; cur = [s, e]; } }
  if (cur) months += cur[1] - cur[0];
  return months / 12;
}

export const PANEL_FIELDS = [
  ["card", "name"], ["card", "occupation"], ["card", "employer"], ["card", "years"], ["card", "qualification"], ["card", "location"], ["card", "top skills"],
  ["panel", "summary"], ["panel", "skills: all found"], ["panel", "skills: no junk"], ["panel", "roles"], ["panel", "dates"], ["panel", "companies"], ["panel", "responsibilities"],
  ["panel", "education"], ["panel", "education: type and status"], ["panel", "certifications"],
] as const;
export type PanelKey = (typeof PANEL_FIELDS)[number][1];
export type PanelResult = Partial<Record<PanelKey, number>> & { _notes: string[] };

/** Each field scores 0..1; a field the CV does not carry at all (no summary, no certifications) is left out rather than counted as right. */
export function scorePanels(p: Persona, rec: any, text: string, layout: string): PanelResult {
  const out: PanelResult = { _notes: [] };
  const note = (k: PanelKey, v: number, why: string) => { out[k] = v; if (v < 1) out._notes.push(`${k}: ${why}`); };
  const hist = rec.workHistory ?? [], edu = rec.education ?? [], skills: string[] = rec.skills ?? [];
  note("name", n(rec.name) === n(p.name) ? 1 : 0, `"${rec.name}"`);
  const wantRole = [p.headline, p.roles[0].position].map(n);
  if (layout !== "nodates") note("occupation", wantRole.some((w) => n(rec.role).includes(w) || w.includes(n(rec.role)) && n(rec.role) !== "") ? 1 : 0, `"${rec.role}"`);
  const cur = p.roles.find((r) => !r.end) ?? p.roles[0];
  if (cur.company) note("employer", n(currentEmployer(hist)).includes(n(cur.company)) || n(cur.company).includes(n(currentEmployer(hist))) && currentEmployer(hist) !== "" ? 1 : 0, `"${currentEmployer(hist)}" want "${cur.company}"`);
  const asOf = CORPUS_AS_OF;   // the same reference date the reader was given (variants.ts)
  const years = Number(rec.experience || 0), want = expectedYears(p, asOf);
  if (layout !== "nodates") note("years", Math.abs(years - Math.floor(want)) <= 1 ? 1 : 0, `${rec.experience || "none"} want about ${Math.floor(want)}`);
  const top = [...p.education].sort((a, b) => b.year - a.year)[0];
  if (p.education.length) { const q = highestQualification(edu.map((e: any) => ({ degree: e.degree, institution: e.institution, year: e.year }))); note("qualification", p.education.some((e) => n(q).includes(n(e.degree)) || n(e.degree).includes(n(q)) && q !== "") ? 1 : 0, `"${q}" want one of ${p.education.map((e) => e.degree).join("|")}`); }
  note("location", n(rec.location).includes(n(p.city)) ? 1 : 0, `"${rec.location}"`);
  const cardSkills = splitSkills(orderSkillsByRecency(skills, hist), 3).shown;
  const taxonomy = new Set(findSkills([p.skills.join(" "), p.roles.flatMap((r) => r.bullets).join(" "), p.summary, p.headline, p.certs.join(" "), p.education.map((e) => e.degree).join(" ")].join(" ")).map((s) => n(s.name)));   // anything the CV really says counts
  if (cardSkills.length) note("top skills", cardSkills.every((s) => p.skills.map(n).includes(n(s)) || taxonomy.has(n(s))) ? 1 : 0, `card shows ${cardSkills.join("|")}`);
  if (n(text).includes(n(p.summary))) note("summary", f1(p.summary, rec.summary ?? "") >= 0.85 ? 1 : 0, `"${(rec.summary ?? "").slice(0, 60)}"`);
  const sk = sameList(p.skills, skills);
  note("skills: all found", sk.recall, `missing ${p.skills.filter((w) => !skills.some((g) => n(g) === n(w))).join("|")}`);
  const junk = skills.filter((s) => !p.skills.map(n).includes(n(s)) && !taxonomy.has(n(s)));
  note("skills: no junk", junk.length === 0 ? 1 : 0, `junk ${junk.slice(0, 4).join("|")}`);
  const yr = (s: string) => { const m = toMonth(s, asOf); if (m !== null) return Math.floor(m / 12); const y = s.match(/\b(19|20)\d{2}\b/); return y ? Number(y[0]) : null; }; // "03/19", "Mar '19", "Februarie 2019" all count
  const used = new Set<number>(); let rolesOk = 0, datesOk = 0, compOk = 0, respOk = 0, respTotal = 0;
  for (const exp of p.roles) {
    const i = hist.findIndex((r: any, idx: number) => !used.has(idx) && (layout === "nodates" || yr(r.startDate ?? "") === exp.start[0]) && (n(r.position).includes(n(exp.position)) || n(exp.position).includes(n(r.position)) && n(r.position) !== ""));
    respTotal += exp.bullets.length;
    if (i < 0) continue;
    used.add(i); rolesOk++; const got = hist[i];
    if (layout === "nodates" || yr(got.endDate ?? "") === (exp.end ? exp.end[0] : asOf.getUTCFullYear()) || (!exp.end && /present|current|now|date/i.test(got.endDate ?? ""))) datesOk++;
    if (exp.company === "" || n(got.company).includes(n(exp.company))) compOk++;
    const said = (got.responsibilities ?? []).join(" ");
    respOk += exp.bullets.filter((b) => { const w = words(b); return w.length && w.filter((x) => words(said).includes(x)).length / w.length >= 0.9; }).length; // the bullet's words are all on the panel, as one item or several
  }
  note("roles", rolesOk / p.roles.length - (hist.length > p.roles.length ? 0.01 : 0) >= 1 && hist.length === p.roles.length ? 1 : rolesOk / p.roles.length * (hist.length > p.roles.length ? 0.9 : 1), `${rolesOk}/${p.roles.length} found, ${hist.length} shown`);
  note("dates", datesOk / p.roles.length, `${datesOk}/${p.roles.length}`);
  note("companies", compOk / p.roles.length, `${compOk}/${p.roles.length}`);
  if (respTotal) note("responsibilities", respOk / respTotal, `${respOk}/${respTotal} bullets`);
  if (p.education.length) { const d = p.education.filter((e) => edu.some((x: any) => (n(x.degree).includes(n(e.degree)) || n(e.degree).includes(n(x.degree)) && n(x.degree) !== "") && n(x.institution).includes(n(e.institution)))).length; note("education", d / p.education.length, `${d}/${p.education.length}`); }
  // every entry the panel lists says what it is and whether it was finished; the personas' qualifications all ended in the past
  if (p.education.length) {
    const ok = p.education.filter((e) => { const x = edu.find((y: any) => n(y.degree).includes(n(e.degree)) || n(e.degree).includes(n(y.degree)) && n(y.degree) !== ""); return !!x && x.type && x.type !== "other" && x.status === (layout === "nodates" ? "not_stated" : ((p as any).educationStatus?.[p.education.indexOf(e)] ?? "completed")); }).length; // a CV that gives no dates must NOT be said to be completed
    note("education: type and status", ok / p.education.length, `${ok}/${p.education.length} with a kind and "completed"`);
  }
  // certifications are entries of the same list, kind "certificate"
  if (p.certs.length && n(text).includes(n(p.certs[0]))) { const got = edu.filter((e: any) => e.type === "certificate").map((e: any) => e.degree); const c = sameList(p.certs, got); note("certifications", c.extra ? Math.min(c.recall, 0.99) : c.recall, `recall ${Math.round(c.recall * 100)}%, ${c.extra} extra: ${got.join("|").slice(0, 80)}`); }
  return out;
}

export function summarisePanels(results: PanelResult[]) {
  const row = (k: PanelKey) => { const xs = results.map((r) => r[k]).filter((v): v is number => v !== undefined); return { n: xs.length, pct: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : 100, exact: xs.length ? Math.round((xs.filter((v) => v === 1).length / xs.length) * 100) : 100 }; };
  return PANEL_FIELDS.map(([area, k]) => ({ area, field: k, ...row(k) }));
}
