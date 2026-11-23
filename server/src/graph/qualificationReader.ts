// A CV's qualifications read into the capability graph: level (NQF), normal length, knowledge profile (from the named programme and, more strongly, the
// candidate's own majors), and completion as a LADDER OF TELLS. Completion is usually deduced, not stated; every rung says which tell it rests on and
// quotes it, so the deduction is never hidden. Deterministic: the same record always reads the same.
import { classifyQualification } from "../qualifications";
import { areaOfSubject, type Depth } from "./knowledge";
import { levelOf, namedQualification } from "./qualifications";
import type { EducationItem } from "../types";

export type Rung = "stated" | "implied" | "dates_fit" | "year_only" | "not_stated" | "in_progress" | "short_span" | "not_completed";
interface Completion { rung: Rung; tell: string; quote?: string }
export interface ReadQualification {
  degree: string; level: string; nqf: number; normalYears: number;
  named?: { id: string; name: string; reviewed: boolean };
  majors: string[]; profile: Record<string, Depth>; profileFrom: "majors" | "programme" | "majors and programme" | "none";
  completion: Completion;
}

// Registrations that cannot be held without a completed qualification in that field (the candidate's own claim, so still a deduction).
const REGISTRATIONS: [RegExp, string[], string][] = [
  [/\bCA\s*\(SA\)|\bSAICA\b|chartered accountant/i, ["qual:chartered-accounting", "qual:finance", "qual:commerce-general"], "a CA(SA) registration needs an accounting degree"],
  [/\bPr\.?\s*Eng\b|\bECSA\b|professional engineer/i, ["qual:electrical-engineering", "qual:mechanical-engineering", "qual:civil-engineering", "qual:chemical-engineering", "qual:industrial-engineering"], "ECSA registration as a professional engineer needs an engineering degree"],
  [/\bSANC\b|registered (?:professional )?nurse/i, ["qual:nursing"], "SANC registration as a nurse needs a nursing qualification"],
  [/\bHPCSA\b/i, ["qual:medicine", "qual:psychology", "qual:pharmacy"], "HPCSA registration needs the professional qualification"],
  [/admitted attorney|\bLPC\b|legal practice council|advocate of the high court/i, ["qual:law"], "admission as an attorney or advocate needs a law degree"],
];

const YEARS = /\b(19[5-9]\d|20[0-4]\d)\b/g;

function periodOf(year: string, asOf: Date): { start?: number; end?: number; present: boolean } {
  const ys = [...(year ?? "").matchAll(YEARS)].map((m) => Number(m[1]));
  const present = /\b(present|current|now|to date|ongoing)\b/i.test(year ?? "");
  if (present) return { start: ys[0], end: undefined, present: true };
  if (ys.length >= 2) return { start: ys[0], end: ys[ys.length - 1], present: false };
  if (ys.length === 1) return { end: ys[0], present: false };
  return { present: false };
}

/** Majors stated on the qualification's line: "BCom (Economics and Statistics majors)", "majoring in Accounting and Finance". */
export function majorsOf(text: string): string[] {
  const found = new Set<string>();
  const lists = [...text.matchAll(/major(?:ing|ed|s)?\s+in\s+([^.;\n)]+)/gi), ...text.matchAll(/\(([^)]*?)\s+majors?\)/gi), ...text.matchAll(/majors?:\s*([^.;\n)]+)/gi)].map((m) => m[1]);
  for (const l of lists) for (const part of l.split(/,|\band\b|&|\//i)) { const p = part.trim(); if (p.length >= 3) found.add(p); }
  return [...found];
}

export function readQualifications(items: EducationItem[], context: { text?: string; asOf: Date }): ReadQualification[] {
  const asYear = context.asOf.getUTCFullYear(), text = context.text ?? "";
  const base = items.map((e) => {
    const level = e.level ?? classifyQualification(e.degree).level, { nqf, years } = levelOf(e.degree, level);
    return { e, level, nqf, years, period: periodOf(e.year, context.asOf), named: namedQualification(e.degree, level) };
  });
  return base.map((b, i): ReadQualification => {
    const { e, level, nqf, years, period, named } = b;
    // knowledge profile: the programme's typical profile, raised by the candidate's own stated majors (taught to final year)
    const line = text.split(/\n/).find((l) => l.includes(e.degree)) ?? e.degree;
    const majors = majorsOf(`${e.degree} ${line}`);
    const profile: Record<string, Depth> = { ...(named?.profile ?? {}) };
    for (const m of majors) { const a = areaOfSubject(m); if (a) profile[a.id] = Math.max(profile[a.id] ?? 0, nqf >= 7 ? 3 : 2) as Depth; }
    const profileFrom = majors.length && named ? "majors and programme" : majors.length ? "majors" : named ? "programme" : "none";
    return { degree: e.degree, level, nqf, normalYears: years, named: named ? { id: named.q.id, name: named.q.name, reviewed: named.q.reviewed } : undefined, majors, profile, profileFrom, completion: completionOf() };

    function completionOf(): Completion {
      const ev = e.statusEvidence ?? "";
      if (e.status === "not_completed") return { rung: "not_completed", tell: "the CV says it was not completed", quote: ev || undefined };
      if (e.status === "completed" && ev && !/year already past/i.test(ev)) return { rung: "stated", tell: "the CV says so in words", quote: ev };
      if (e.status === "in_progress" || period.present || (period.end !== undefined && period.end > asYear)) return { rung: "in_progress", tell: period.end && period.end > asYear ? `${period.end} is still to come` : "the CV says it is still in progress", quote: ev || e.year || undefined };
      // implied by what came after: a postgraduate qualification needs an undergraduate one; a registration needs the qualification
      if (nqf >= 6 && nqf <= 7) {
        const later = base.find((o, j) => j !== i && o.nqf >= 8 && (o.period.end === undefined || period.end === undefined || o.period.end >= period.end));
        if (later) return { rung: "implied", tell: `a later ${later.level.toLowerCase()} needs it`, quote: later.e.degree };
      }
      if (named) for (const [re, quals, why] of REGISTRATIONS) { const m = text.match(re); if (m && quals.includes(named.q.id)) return { rung: "implied", tell: why, quote: m[0] }; }
      // dates: a span as long as the normal length fits a finished qualification; a span clearly shorter is a question, not a verdict
      if (period.start !== undefined && period.end !== undefined && years > 0) {
        const span = period.end - period.start;
        if (span >= years - 0.5) return { rung: "dates_fit", tell: `${period.start} to ${period.end} is ${span} year${span === 1 ? "" : "s"}, the usual length of a ${level.toLowerCase()}${years !== 3 ? ` of this kind (${years} years)` : ""}`, quote: e.year };
        if (span < years - 1) return { rung: "short_span", tell: `${period.start} to ${period.end} is ${span} year${span === 1 ? "" : "s"}, shorter than the usual ${years}: ask whether it was finished`, quote: e.year };
      }
      if (period.end !== undefined) return { rung: "year_only", tell: `a past year (${period.end}) is given, which is how a finished qualification is usually written`, quote: e.year };
      return { rung: "not_stated", tell: "the CV gives no year and no word about completion" };
    }
  });
}
