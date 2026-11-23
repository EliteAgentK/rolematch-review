// Two readings of a CV become one record, field by field, and the record says where each value came from and how sure it is. Where both readers found the same role, it stands. Where they differ, the one the document's own lines bear out stands, and the disagreement is recorded for a person. A role only one reader found is marked. Nothing here decides what a value means, only which reading to keep.
import { experienceOf } from "./dates";
import { isOrdinary } from "./docmodel/identity";
import { whereIs } from "./geo";
import { findSkills } from "./skills";
import { certificateValidity, classifyQualification, describeQualification, splitCertificate } from "./qualifications";
import { inDocument, type Reading } from "./modelReader";
import type { FactState } from "./types";

export interface RoleLike { position: string; company: string; startDate?: string; endDate?: string; responsibilities?: string[]; quote?: string }
type Agreement = "both" | "model" | "rules" | "conflict";
const words = (s?: string) => new Set(String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}#+ ]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !["the", "of", "and", "ltd", "pty", "group"].includes(w)));
const near = (a?: string, b?: string) => { const A = words(a), B = words(b); if (!A.size || !B.size) return false; return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size) >= 0.6; };
const year = (s?: string) => String(s ?? "").replace(/\s/g, "").match(/(?:19|20)\d{2}/)?.[0] ?? "";
/** Which rules role, if any, is this model role. A corroborating year and a corroborating name: a title alone never makes two roles one, and a promotion at one employer has another year. */
const sameRole = (m: RoleLike, r: RoleLike) => { const my = year(m.startDate), ry = year(r.startDate); return (!my || !ry ? near(m.position, r.position) && near(m.company, r.company) : my === ry && (near(m.position, r.position) || near(m.company, r.company))); };
/** A rules role fit to stand alone when the model did not find it: a title, an employer and a start date, none of them looking like a page's furniture. */
/** The parser and the AI read one role the same way on their own: the same title, the same employer and the same start year. That stands as a fact even where the AI's answer could not be tied to its lines (owner, 9 Nov 2026). */
export const bothRead = (m: RoleLike, r: RoleLike) => { const y = year(m.startDate); return !!y && y === year(r.startDate) && near(m.position, r.position) && near(m.company, r.company); };
const complete = (r: RoleLike) => !!r.position?.trim() && !!r.company?.trim() && !!year(r.startDate) && !/[|:]|\b(?:rev|form\d+|page \d)/i.test(`${r.position} ${r.company}`) && r.position.length <= 90 && !/^\d/.test(r.position);

/** The four states of a fact, the same everywhere a fact is shown or used. Absence from a readable document is "not evidenced", and is a different thing from a document that could not be read. */
type EvidenceState = FactState;
export interface Employment { state: EvidenceState; reasons: string[] }
export type ReconciledRole = RoleLike & { agreement: Agreement; status: EvidenceState; lines?: number[]; pages?: number[]; rulesReading?: { position: string; company: string } };
const readsAsName = (v?: string) => { const s = String(v ?? "").trim(); return s.length >= 2 && s.length <= 60 && !/^[^\p{L}\p{N}(]/u.test(s) && !/[.:]$/.test(s) && !/\b(?:date|years?|months?)\b/i.test(s) && s.split(/\s+/).length <= 9; };
export function reconcileRoles(rules: RoleLike[], model: (RoleLike & { lines?: number[]; adrift?: boolean; apart?: boolean })[], modelAnswered: boolean, heldIn: (value: string, lines: number[]) => boolean = () => false): ReconciledRole[] {
  // With no model answer the rules' reading is all there is, and nothing has checked it: it is kept, and it does not claim to be sure.
  if (!modelAnswered) return rules.map((r) => ({ ...r, agreement: "rules", status: "uncertain" }));
  const used = new Set<number>(), out: ReconciledRole[] = [];
  for (const { adrift, apart, ...m } of model) {
    const at = rules.findIndex((r, i) => !used.has(i) && sameRole(m, r));
    if (at < 0) { out.push({ ...m, agreement: apart ? "rules" : "model", status: adrift ? "uncertain" : "supported" }); continue; }   // no dates and no second reading: competing evidence, kept apart like a role only the rules found
    used.add(at); const r = rules[at];
    // Two readings of one role: a value is a claim only if it reads as a name. Measured on real CVs, the rules' other reading was right in none of 24 disagreements, and most were blanks, labels or duties.
    const claimsOtherwise = (mine?: string, theirs?: string) => !near(mine, theirs) && readsAsName(theirs), agree = !claimsOtherwise(m.position, r.position) && !claimsOtherwise(m.company, r.company);
    // The one the document's own lines bear out stands. Where those same lines bear out both, it is a real conflict, and it stays one.
    const lines = m.lines ?? [], rulesFit = heldIn(r.position, lines) && heldIn(r.company, lines);
    out.push({ ...m, responsibilities: r.responsibilities?.length ? r.responsibilities : m.responsibilities, quote: r.quote, agreement: agree ? "both" : "conflict", status: adrift && !bothRead(m, r) ? "uncertain" : agree || !rulesFit ? "supported" : "conflicting", ...(agree ? {} : { rulesReading: { position: r.position, company: r.company } }) });
  }
  // A role only the rules found is competing evidence: measured on real CVs it added extras and no correct roles once the model had read the document and its unexplained dates again. It is kept apart, for a person, not presented as a fact.
  rules.forEach((r, i) => { if (!used.has(i) && complete(r)) out.push({ ...r, agreement: "rules", status: "uncertain" }); });
  return oneJobEach(out).sort((a, b) => Number(year(b.startDate) || 0) - Number(year(a.startDate) || 0));
}

const flat = (s?: string) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const AGREEMENT_RANK: Record<Agreement, number> = { both: 0, model: 1, rules: 1, conflict: 2 }, STATUS_RANK: Record<string, number> = { supported: 0, uncertain: 1, conflicting: 2 };
/** R165: one employer, the same start and the same end is one job, however many titles it was written with (a bullet, a department). None of 698 answer keys holds
 *  two jobs like that. The reading with the best evidence stands (both readers, then supported), and the first written on a tie. A role with no start or end, and one
 *  only the rules found, is never folded. */
function oneJobEach(roles: ReconciledRole[]) {
  const keyOf = (r: ReconciledRole) => (r.agreement !== "rules" && flat(r.company) && flat(r.startDate) && flat(r.endDate) ? `${flat(r.company)}|${flat(r.startDate)}|${flat(r.endDate)}` : null);
  const rank = (r: ReconciledRole) => AGREEMENT_RANK[r.agreement] * 3 + (STATUS_RANK[r.status] ?? 1), best = new Map<string, number>();
  roles.forEach((r, i) => { const k = keyOf(r); if (k === null) return; const j = best.get(k); if (j === undefined || rank(r) < rank(roles[j])) best.set(k, i); });
  return roles.filter((r, i) => { const k = keyOf(r); return k === null || best.get(k) === i; });
}

const lower = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}#+]+/gu, " ").trim();
const union = (a: string[], b: string[]) => { const seen = new Set(a.map(lower)); return [...a, ...b.filter((x) => { const k = lower(x); if (seen.has(k)) return false; seen.add(k); return true; })]; };
/**
 * A skill only the rules found stands if it reads as a skill: in the document, a few words, not a number, a web address, a heading in capitals, a place, or a person's name. Measured on real CVs, the rules also take letterheads and directors' names for skills; a skill the platform knows always stands.
 */
export function rulesSkillStands(x: string, text: string | undefined, record: any) {
  if (findSkills(x).length) return true;
  const words = x.trim().split(/\s+/), names = [record.name, record.submission?.recruiter?.name].filter(Boolean).map((n: string) => n.toLowerCase());
  if (!x.trim() || words.length > 5 || (text && !inDocument(x, text)) || !/\p{L}{3}/u.test(x) || /@|https?:|www\.|[\uE000-\uF8FF]|:$/iu.test(x)) return false;
  if (words.length === 1 && x === x.toUpperCase()) return false;
  if (whereIs(x).city || whereIs(x).province || names.some((n: string) => n.includes(x.toLowerCase()))) return false;
  // Two or three capitalised words that are not ordinary English are a person's or a company's name, not a skill.
  if (words.length <= 3 && words.every((w) => /^\p{Lu}/u.test(w)) && !words.some((w) => isOrdinary(w.toLowerCase()))) return false;
  return true;
}
/** The system and the model's reading of a whole CV as one record. Each field keeps to what was measured on real CVs (docs/parser/FIELD_METHODS.md): contact details and the agency stay with the identity reader; roles and education come from the model as checked by code; lists are the union, each held to the document. A role only the rules found stays apart as competing evidence. The record says how sure its employment history is. */
export function mergeReading(record: any, read: { reading: Reading | null; roles: ReconciledRole[]; employment: Employment; trace: object; contact?: { name?: string; email?: string; phone?: string }; /** the document's text, to hold the rules' list items to */ text?: string }, meta: { model: string; promptVersion: string; ms?: number; asOf?: Date }) {
  const { reading } = read, kept = reading ? read.roles.filter((r) => r.agreement !== "rules") : read.roles, apart = reading ? read.roles.filter((r) => r.agreement === "rules") : [];
  const summary = { model: meta.model, promptVersion: meta.promptVersion, ms: meta.ms, employment: read.employment, trace: read.trace, roles: read.roles.reduce((a: Record<string, number>, r) => ((a[r.agreement] = (a[r.agreement] ?? 0) + 1), a), {}), ...(apart.length ? { unconfirmedRoles: apart.map((r) => ({ position: r.position, company: r.company, startDate: r.startDate, endDate: r.endDate })) } : {}) };
  if (!reading) return { ...record, workHistory: kept, reading: summary };
  // Education is the AI's alone (owner, 9 Nov 2026: "for the education, I only want the AI to analyse it"): what it is, where, when, and whether it was finished,
  // each held to the CV's own words by validateReading. Code adds only the kind of qualification for the badge, and a certificate's validity.
  // Completion as a recruiter reads it (owner, 9 Nov 2026: "there has to be a way of telling if something is completed or not"): what the CV says or dates
  // stands as the AI read it. A qualification the CV lists with nothing either way is "listed": shown as completed, as listed, and worth confirming. A
  // certificate listed as held is completed: "Certified SAFe 5 Practitioner" is the certificate. Expiry is a separate fact (validity).
  const asOf = meta.asOf ?? new Date(), degrees = reading.education.map((e) => {
    const { type, level } = classifyQualification(`${e.qualification} ${e.institution}`.trim()), listed = e.status === "not_stated";
    const item = { degree: e.qualification, institution: e.institution, year: e.year, type, level, status: listed ? (type === "certificate" ? "completed" : "listed") : e.status, statusEvidence: listed ? (type === "certificate" ? "listed as a certificate held" : "listed in the CV with no date or word on completion") : e.statusWords, readBy: "ai" };
    if (type !== "certificate") return item;
    const v = certificateValidity({ degree: e.qualification, institution: e.institution, year: e.year }, asOf);
    return { ...item, validity: v.state, ...(v.evidence ? { validityEvidence: v.evidence } : {}) };
  });
  // Certificates are the AI's alone too, each held to the CV by validateReading. Until 10 Nov 2026 the reader's certificates were added beside them, and a
  // CFO's jobs and achievements reached the panel as "Certificate · Completed" after a heading the reader did not know (register R192).
  const certNames = union([], reading.certifications);
  const held = new Set(degrees.map((d) => lower(d.degree)));
  const certificates = certNames.filter((name) => !held.has(lower(name))).map((name) => {
    const q = describeQualification(splitCertificate(name), asOf.getFullYear(), true, asOf), listed = q.status === "not_stated";
    return { degree: q.degree, institution: q.institution, year: q.year, type: "certificate", level: q.level, status: listed ? "completed" : q.status, statusEvidence: listed ? "listed as a certificate held" : q.statusEvidence, ...(q.validity ? { validity: q.validity, ...(q.validityEvidence ? { validityEvidence: q.validityEvidence } : {}) } : {}) };
  });
  const education = [...degrees, ...certificates];
  const fromModel = { location: !!reading.location, agency: !record.submission?.agency?.name && !!reading.agency.name, name: !record.name?.trim() && !!read.contact?.name };
  // An agency's own contact details are not the candidate's, whichever reader took them for it.
  const digits = (s?: string) => String(s ?? "").replace(/\D/g, "").slice(-9), agency = record.submission?.recruiter ?? {}, agencyEmails = [agency.email, reading.agency.recruiterEmail].map((e) => String(e ?? "").toLowerCase()).filter(Boolean), agencyPhones = [agency.phone, reading.agency.recruiterPhone].map(digits).filter(Boolean);
  const own = { email: read.contact?.email && !agencyEmails.includes(read.contact.email.toLowerCase()) ? read.contact.email : "", phone: read.contact?.phone && !agencyPhones.includes(digits(read.contact.phone)) ? read.contact.phone : "" };
  const email = agencyEmails.includes(String(record.email ?? "").toLowerCase()) ? own.email : record.email || own.email, phone = agencyPhones.includes(digits(record.phone)) ? own.phone : record.phone || own.phone;
  return {
    ...record, workHistory: kept, education,
    // A short profile from the AI's reading, held to the CV's words (modelReader.ts); the current job is stated beside it by the panel, from the dated roles.
    ...(reading.profile ? { profile: reading.profile } : {}),
    ...(reading.group ? { group: reading.group } : {}),
    // How details the CV writes in capitals are normally written, for the screen only (modelReader.ts validateWritten); the record keeps the CV's words.
    ...(reading.written && Object.keys(reading.written).length ? { displayNames: reading.written } : {}),
    // Years of experience are worked out from the roles the record now holds, never left over from an earlier reading.
    experience: experienceOf(kept, meta.asOf ?? new Date()),
    // Skills: the model reads them in context; a skill only the rules found stands only if it is a skill the platform knows, because the rules also pick up letterheads and names.
    skills: union(reading.skills, (record.skills ?? []).filter((x: string) => rulesSkillStands(String(x), read.text, record))), languages: union(record.languages ?? [], reading.languages), certifications: union((record.certifications ?? []).map(String), reading.certifications),
    // The headline is a judgement of what the CV presents the person as (a position applied for, a title at the top, the latest job), read in context by the model and checked against the document; the rules' reading stands only where the model gave none (register R150).
    role: reading.headline || record.role, ...(reading.headline && reading.headline !== record.role ? { rulesRole: record.role ?? "" } : {}),
    name: record.name?.trim() ? record.name : read.contact?.name ?? record.name, email, phone,
    // Where the person lives needs reading in context: the model's reading stands, and the rules' only where it names a known place.
    location: reading.location || (whereIs(String(record.location ?? "")).city || whereIs(String(record.location ?? "")).province ? record.location : ""),
    ...(fromModel.agency ? { submission: { ...(record.submission ?? {}), agency: { name: reading.agency.name }, recruiter: { name: reading.agency.recruiter, email: reading.agency.recruiterEmail, phone: reading.agency.recruiterPhone } } } : {}),
    reading: { ...summary, refused: reading.refused, fromModel },
  };
}
