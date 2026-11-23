// The next acceptance run: fresh authorised documents, a person's answers, criteria fixed before the run, and one reading. Machine agreement and unlabelled documents cannot establish accuracy, so without a person's answers the run says only that it behaved.
export interface Answers { checkedBy: string; checkedOn: string; name?: string; email?: string; phone?: string; location?: string; title?: string; roles?: { position: string; company?: string; start?: string }[]; skills?: string[]; qualifications?: string[]; certifications?: string[]; agency?: { name?: string; recruiter?: string; email?: string; phone?: string } | null }
export type Outcome = "right" | "wrong" | "missing";
const n = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}@+.#/-]+/gu, " ").replace(/[.]+$/, "").trim(), digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
/** One value against the person's answer. Where the person left a field out it is not scored: an unchecked value is neither right nor wrong. An answer of "" means the document does not have it, so publishing anything is wrong. */
export function judge(got: unknown, want: string | undefined, same: (a: string, b: string) => boolean = (a, b) => n(a) === n(b)): Outcome | null {
  if (want === undefined) return null;
  const g = String(got ?? "").trim();
  if (!want.trim()) return g ? "wrong" : "right";
  return !g ? "missing" : same(g, want) ? "right" : "wrong";
}
export function scoreDocument(record: any, a: Answers): { field: string; outcome: Outcome }[] {
  const out: { field: string; outcome: Outcome }[] = [], add = (field: string, o: Outcome | null) => { if (o) out.push({ field, outcome: o }); };
  add("name", judge(record.name, a.name)); add("email", judge(record.email, a.email)); add("phone", judge(record.phone, a.phone, (x, y) => digits(x) === digits(y)));
  add("location", judge(record.location, a.location, (x, y) => n(x).includes(n(y)))); add("title", judge(record.role, a.title));
  const roles = (record.workHistory ?? []) as any[], edu = (record.education ?? []) as any[], skills = new Set(((record.skills ?? []) as string[]).map(n));
  for (const r of a.roles ?? []) { const g = roles.find((x) => n(x.position) === n(r.position)); add("role", g ? "right" : "missing"); if (g && r.company !== undefined) add("employer", judge(g.company, r.company)); if (g && r.start !== undefined) add("start date", judge(g.startDate, r.start)); }
  for (const s of a.skills ?? []) add("skill", skills.has(n(s)) ? "right" : "missing");
  for (const q of a.qualifications ?? []) add("qualification", edu.some((x) => x.type !== "certificate" && n(x.degree).includes(n(q))) ? "right" : "missing");
  for (const c of a.certifications ?? []) add("certification", edu.some((x) => x.type === "certificate" && n(x.degree).includes(n(c))) ? "right" : "missing");
  if (a.agency !== undefined) { const s = record.submission; if (a.agency === null) add("agency", s ? "wrong" : "right"); else { add("agency", judge(s?.agency?.name, a.agency.name)); add("recruiter", judge(s?.recruiter?.name, a.agency.recruiter)); add("recruiter email", judge(s?.recruiter?.email, a.agency.email)); add("recruiter phone", judge(s?.recruiter?.phone, a.agency.phone, (x, y) => digits(x) === digits(y))); } }
  return out;
}
export type Tally = Record<string, Record<string, Record<Outcome, number>>>;
export const CRITERIA = {
  version: "acceptance-2",
  minCorrect: 0.9,          // of a field's values with an answer, at least this share right, per field and format (owner: minimum 90% on all CVs)
  maxWrong: 0.02,           // incorrect published values, the release criterion: at most this share for who the person is and how to reach them
  identityFields: ["name", "email", "phone"],
  minValuesForAField: 10,   // under this a field is reported and not judged: too few values to say anything
};
/** Wilson 95% interval: with a few dozen documents a percentage alone flatters. */
export function interval(right: number, total: number): [number, number] {
  if (!total) return [0, 0]; const z = 1.96, p = right / total, d = 1 + (z * z) / total, c = p + (z * z) / (2 * total), m = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
export function verdict(tally: Tally, crashes: number): { pass: boolean; lines: string[] } {
  const lines: string[] = []; let pass = crashes === 0; if (crashes) lines.push(`FAIL ${crashes} documents crashed`);
  for (const [format, fields] of Object.entries(tally)) for (const [field, t] of Object.entries(fields)) {
    const total = t.right + t.wrong + t.missing, [lo, hi] = interval(t.right, total), share = total ? t.right / total : 0, wrongShare = total ? t.wrong / total : 0;
    const judged = total >= CRITERIA.minValuesForAField, bad = judged && (share < CRITERIA.minCorrect || (CRITERIA.identityFields.includes(field) && wrongShare > CRITERIA.maxWrong));
    if (bad) pass = false;
    lines.push(`${judged ? (bad ? "FAIL" : "pass") : "n/a "} ${format} ${field}: ${t.right} right, ${t.wrong} wrong, ${t.missing} missing of ${total} (${Math.round(share * 100)}%, 95% interval ${Math.round(lo * 100)} to ${Math.round(hi * 100)})`);
  }
  return { pass, lines };
}
