import { cleanInvisible } from "./invisible";
import { z } from "zod";
import { config } from "./config";
import { parseCv } from "./rules";
import { yearsCovered } from "./dates";
import { describeQualification, splitCertificate } from "./qualifications";
import { parserVersionLabel } from "./version";
import type { StepReport } from "./cvPlan";
import type { Candidate, ExtractionMeta } from "./types";

// Bullets, tab stops and column bars are layout, not words: the reader turns a tab into " | ", so a quote that kept it would never be found in the original.
const norm = (s: string) => s.toLowerCase().replace(/[|•·▪●■►▶✓✔\u2022]/g, " ").replace(/[\s\u00a0]+/g, " ").replace(/[“”"‘’']/g, "").trim();
/** True when `quote` really appears in the source text (ignoring case and whitespace). */
export const supported = (source: string, quote: string | undefined) => !!quote && quote.trim().length >= 3 && norm(source).includes(norm(quote));

const Quoted = z.object({ quote: z.string().default("") }).passthrough();
const CandidateOut = z.object({
  fullName: z.string().default(""), email: z.string().default(""), phone: z.string().default(""), location: z.string().default(""),
  currentRole: z.string().default(""), summary: z.string().default(""),
  skills: z.array(Quoted.extend({ name: z.string() })).default([]),
  workHistory: z.array(Quoted.extend({ company: z.string().default(""), position: z.string().default(""), startDate: z.string().default(""), endDate: z.string().default(""), responsibilities: z.array(z.string()).default([]) })).default([]),
  education: z.array(Quoted.extend({ qualification: z.string().default(""), institution: z.string().default(""), period: z.string().default("") })).default([]),
  projects: z.array(Quoted.extend({ description: z.string() })).default([]),
  worthNoting: z.array(Quoted.extend({ text: z.string() })).default([]),
  certifications: z.array(z.string()).default([]), languages: z.array(z.string()).default([]),
  sections: z.array(z.any()).default([]),
});
/** Keep only facts whose quote is genuinely present in the document; report what was dropped. */
function keepSupported<T extends { quote?: string }>(source: string, items: T[], label: (i: T) => string, dropped: string[]): T[] {
  return items.filter((item) => {
    if (supported(source, item.quote)) return true;
    // A table read by columns: the record's quote is its cells put back together, and each cell must be in the document. A value still cannot be kept that the document does not hold.
    const cells = String(item.quote ?? "").split(/\s+\|\s+/);
    if (cells.length > 1 && cells.every((c) => supported(source, c))) return true;
    dropped.push(label(item));
    return false;
  });
}

const dedupe = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

export interface Extracted<T> { record: T; confidence: number; meta: ExtractionMeta }

export interface ExtractOptions {
  /** "Today" for the purposes of this extraction (years of experience, whether a course is finished). Passed in so the same document gives the same answer on any day. */
  asOf?: Date;
  /** Lines the layout sets apart (bold, larger). Evidence for what is a heading, where the reader has it. */
  emphasised?: Set<string>;
}

/** The end of the latest year a document states (19xx or 20xx), or 31 December 2000 when it states none. */
function documentDate(text: string): Date {
  const years = [...text.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  return new Date(Date.UTC(years.length ? Math.max(...years) : 2000, 11, 31));
}

export async function extractCandidate(rawText: string, options: ExtractOptions = {}): Promise<Extracted<Omit<Candidate, "id" | "status" | "avatar" | "rating" | "appliedDate">>> {
  const text = cleanInvisible(rawText).text;   // idempotent: readDocument has already done it for files, this covers text that arrives any other way
  const warnings: string[] = [];
  const dropped: string[] = [];
  const method: ExtractionMeta["method"] = "rules";
  const out = rulesCandidate(text, options.emphasised);
  {
    warnings.push("Read by the built-in RoleMatch parser (no AI service). It handles standard CV layouts; unusual layouts may be missed, so check the record against the original CV.");
  }
  const skills = keepSupported(text, out.skills, (s) => `skill "${s.name}"`, dropped).map((s) => s.name.trim());
  const work = keepSupported(text, out.workHistory, (w) => `role "${w.position}"`, dropped);
  // Never the clock: the caller states the date the CV is read as of; without one, the CV's own latest stated year is used, so the same text always gives the same answer.
  const asOf = options.asOf ?? documentDate(text);
  // Degrees, diplomas, school and certifications are ONE list. Certifications a model returned as plain strings join it here.
  const certEntries = out.certifications.map((c) => ({ ...splitCertificate(c), c })).filter((c) => c.degree).map((c) => ({ qualification: c.degree, institution: c.institution, period: c.year, quote: c.c, fromCertifications: true }));
  const eduSupported = keepSupported(text, [...out.education, ...certEntries] as (typeof out.education[number] & { fromCertifications?: boolean })[], (e) => `education "${e.qualification}"`, dropped);
  const edu = eduSupported.filter((e, i, all) => all.findIndex((x) => x.qualification.toLowerCase() === e.qualification.toLowerCase() && x.institution.toLowerCase() === e.institution.toLowerCase()) === i);
  const projects = keepSupported(text, out.projects, () => "a project", dropped).map((p) => p.description);
  const notable = keepSupported(text, out.worthNoting, () => "a worth-noting item", dropped).map((p) => p.text);
  const workHistory = work.map((w) => ({ company: w.company, position: w.position, startDate: w.startDate, endDate: w.endDate, responsibilities: w.responsibilities }));
  const years = yearsCovered(workHistory, asOf);
  if (workHistory.length && !years) warnings.push("Roles were found but their dates could not be read, so years of experience are unknown.");
  if (!out.email) warnings.push("No email address found.");

  // Confidence reflects how complete and well-supported the record is, never how impressive the person is.
  const fields = [out.fullName, out.email, out.phone, out.location, out.summary, skills.length, workHistory.length, edu.length];
  const coverage = fields.filter(Boolean).length / fields.length;
  const confidence = Math.round((0.2 + 0.4 * coverage) * 100) / 100;

  return {
    confidence,
    meta: { method, model: undefined, schemaVersion: config.extractionSchemaVersion, parserVersion: parserVersionLabel(), warnings, droppedUnsupported: dropped, asOf: asOf.toISOString().slice(0, 10), sections: (out as { sections?: StepReport[] }).sections ?? [] },
    record: {
      name: out.fullName, role: out.currentRole, skills: dedupe(skills), experience: years ? String(Math.floor(years)) : "",
      location: out.location, email: out.email, phone: out.phone, workHistory, summary: out.summary,
      education: edu.map((e) => { const q = describeQualification({ degree: e.qualification, institution: e.institution, year: e.period }, asOf.getFullYear(), (e as { fromCertifications?: boolean }).fromCertifications === true, asOf); return { degree: q.degree, institution: q.institution, year: q.year, type: q.type, level: q.level, status: q.status, statusEvidence: q.statusEvidence, ...(q.validity ? { validity: q.validity, ...(q.validityEvidence ? { validityEvidence: q.validityEvidence } : {}) } : {}) }; }),
      projects, worthNoting: notable, certifications: [], languages: out.languages, recruiterNotes: "",
    },
  };
}

// ---------- RoleMatch's own parser (no outside service) ----------
const rulesCandidate = (text: string, emphasised?: Set<string>): z.infer<typeof CandidateOut> => CandidateOut.parse(parseCv(text, { emphasised }));
