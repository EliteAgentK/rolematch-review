// Runs the failure library through an extractor, on every variant, and scores it. Shared by the test and by npm run parser:gate.
import { readDocument } from "../../src/parse";
import { parseCv } from "../../src/rules";
import { buildDocModel } from "../../src/docmodel/model";
import { identityFields, readIdentity } from "../../src/docmodel/identity";
import { CASES, render, VARIANTS, type Case, type Variant } from "./library";
import type { FieldCounts, Scorecard } from "./gate";

export type Fields = { fullName: string; email: string; phone: string; agency?: string; recruiter?: string; recruiterEmail?: string; recruiterPhone?: string; route?: string };
export type Extractor = (bytes: Uint8Array, type: string) => Promise<Fields>;
export const currentParser: Extractor = async (bytes, type) => { const c = parseCv((await readDocument(bytes, type as any, { pageCeiling: Number.POSITIVE_INFINITY })).text); return { fullName: c.fullName ?? "", email: c.email ?? "", phone: c.phone ?? "" }; };
export const prototype = (useLayout = true): Extractor => async (bytes, type) => { const i = readIdentity(await buildDocModel(bytes, type), { useLayout }); return { ...identityFields(i), agency: i.agency?.name.value ?? "", recruiter: i.agency?.recruiter.name.value ?? "", recruiterEmail: i.agency?.recruiter.email.value ?? "", recruiterPhone: i.agency?.recruiter.phone.value ?? "", route: i.candidateContact }; };

const norm = { name: (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim(), email: (s: string) => s.toLowerCase().trim(), phone: (s: string) => s.replace(/\D/g, "").replace(/^27/, "0"), agency: (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim(), recruiter: (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim(), recruiterEmail: (s: string) => s.toLowerCase().trim(), recruiterPhone: (s: string) => s.replace(/\D/g, "").replace(/^27/, "0"), route: (s: string) => s };
type JudgedField = "name" | "email" | "phone" | "agency" | "recruiter" | "recruiterEmail" | "recruiterPhone" | "route";
export function judge(item: Case, got: Fields) {
  const out: { field: JudgedField; verdict: "correct" | "wrong" | "missing" }[] = [];
  const one = (field: JudgedField, expected: string | null | undefined, value: string, also: string[] = []) => {
    if (expected === undefined) return;
    const v = norm[field](value);
    if (expected === null) out.push({ field, verdict: v ? "wrong" : "correct" });
    else if (!v) out.push({ field, verdict: "missing" });
    else out.push({ field, verdict: [expected, ...also].some((e) => norm[field](e) === v) ? "correct" : "wrong" });
  };
  one("name", item.expect.name, got.fullName, item.alsoAcceptName); one("email", item.expect.email, got.email); one("phone", item.expect.phone, got.phone);
  const a = item.expect; one("agency", a.agency, got.agency ?? ""); one("recruiter", a.recruiter, got.recruiter ?? ""); one("recruiterEmail", a.recruiterEmail, got.recruiterEmail ?? ""); one("recruiterPhone", a.recruiterPhone, got.recruiterPhone ?? ""); one("route", a.route, got.route ?? "");
  return out;
}
export async function score(extract: Extractor, cases: Case[] = CASES, variants: Variant[] = VARIANTS) {
  const fields: Record<string, FieldCounts> = {}, passing: string[] = [], failing: string[] = [], ms: number[] = []; let failures = 0;
  for (const item of cases) for (const v of variants) {
    if (item.onlyVariants && !item.onlyVariants.includes(v)) continue;
    const { bytes, type } = await render(item, v), t = performance.now(); let got: Fields;
    try { got = await extract(bytes, type); } catch { failures++; got = { fullName: "", email: "", phone: "" }; }
    ms.push(performance.now() - t);
    const results = judge(item, got);
    for (const r of results) { const k = `${r.field}|${v}`, f = (fields[k] ??= { correct: 0, wrong: 0, missing: 0, total: 0 }); f[r.verdict]++; f.total++; }
    (results.every((r) => r.verdict === "correct") ? passing : failing).push(`${item.id}/${v}`);
  }
  ms.sort((a, b) => a - b);
  const card: Scorecard = { fields, passing, medianMs: Math.round(ms[Math.floor(ms.length / 2)]), failures };
  return { card, failing };
}
