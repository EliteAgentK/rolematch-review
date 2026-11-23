// What kind of qualification a line describes, and whether the CV says it was finished. Used for every entry of the Education panel:
// degrees, diplomas, school (matric), and certifications all live in that one list, so a recruiter reads them the same way.
// Nothing here guesses: a status is given only when the CV's own words (or a past year) support it, otherwise it says "not stated".
import { PRESENT_WORDS } from "./dates";

type QualType = "degree" | "diploma" | "school" | "certificate" | "other";
/** "listed": the CV lists it with no date and no word on completion; shown as completed, as listed (reconcile.ts). */
type QualStatus = "completed" | "listed" | "in_progress" | "not_completed" | "not_stated";
export interface Classified { type: QualType; /** the words a person reads, e.g. "Honours degree" */ level: string }

const SCHOOL = /\b(matric(?:ulation)?|national senior certificate|nsc|grade\s*12|senior certificate|high school|secondary school|o-?levels?|a-?levels?|igcse|gcse|ib diploma|school leaving|std\.?\s*10|standard 10)\b/i;
const DOCTORATE = /\b(ph\.?d|doctorate|doctoral|dphil|d\.phil)\b/i;
const MASTERS = /\b(master'?s?|msc|m\.sc|mba|mcom|m\.com|m\.a\b|ma\b(?=\s+(?:in|of|degree))|meng|m\.eng|mphil|llm|mtech|m\.tech|med\b|m\.ed)\b/i;
const HONOURS = /\b(honou?rs|hons\b|b\.?(?:sc|a|com|ed|tech|eng)\.?\s*\(?hon)/i;
const BACHELORS = /\b(bachelor'?s?|bsc|b\.sc|ba\b|b\.a\b|bcom|b\.com|bcompt|beng|b\.eng|btech|b\.tech|bed\b|b\.ed|llb|bpharm|b\.pharm|bcur|mbchb|bsocsci|bbusadmin|undergraduate degree|degree)\b/i;
const DIPLOMA = /\b(advanced diploma|postgraduate diploma|national diploma|higher diploma|diploma|ndip|n\.dip|pgce)\b/i;
const HIGHER_CERT = /\bhigher certificate\b/i;
const TRADE = /\b(trade test|trade certificate|national trade certificate|red seal|apprenticeship|artisan)\b/i;
const N_LEVEL = /\bN[1-6]\b/;                                   // South African TVET "N" levels: N6 Electrical Engineering
const NATIONAL_CERT = /\bnational (?:\w+ )?certificate\b/i;
const CERTIFICATE = /\b(certified|certification|certificate|licen[sc]e|registration|registered|accreditation|accredited|short course|course|training|workshop|bootcamp|nqf\s*[1-5]\b|first aid|bls|acls|psara|pmp|prince2|itil|ccna|mcse|a\+|comptia)\b/i;

/** Professional designations, read as qualifications in their own right (CA(SA) is not a degree, but a job can require it). One list, used by the reader and by matching. */
export const DESIGNATIONS: RegExp[] = [/\bCA\s*\(SA\)/i, /\bPr\.?\s*Eng\b/i, /\bPr\.?\s*Tech\b/i, /\bCFA\b/, /\bACCA\b/, /\bCIMA\b/, /\bPMP\b/, /\bSAIPA\b/, /\bCCNA\b/, /\bCISA\b/, /\bCISSP\b/];

/** Level of a qualification from its own wording. A line in a Certifications section that names no degree is a certificate. */
export function classifyQualification(text: string, fromCertificationsSection = false): Classified {
  if (SCHOOL.test(text) && !DIPLOMA.test(text.replace(SCHOOL, ""))) return { type: "school", level: "High school" };
  if (DOCTORATE.test(text)) return { type: "degree", level: "Doctorate" };
  if (MASTERS.test(text)) return { type: "degree", level: "Master's degree" };
  if (HONOURS.test(text)) return { type: "degree", level: "Honours degree" };
  if (/\badvanced diploma\b/i.test(text)) return { type: "diploma", level: "Advanced diploma" };
  if (/\bpostgraduate diploma\b|\bpgce\b/i.test(text)) return { type: "diploma", level: "Postgraduate diploma" };
  if (/\bnational diploma\b|\bndip\b|\bn\.dip\b/i.test(text)) return { type: "diploma", level: "National diploma" };
  if (BACHELORS.test(text)) return { type: "degree", level: /\bdegree\b/i.test(text) && !/\bbachelor|b\./i.test(text) ? "Degree" : "Bachelor's degree" };
  if (DIPLOMA.test(text)) return { type: "diploma", level: "Diploma" };
  if (HIGHER_CERT.test(text)) return { type: "diploma", level: "Higher certificate" };
  if (TRADE.test(text)) return { type: "certificate", level: "Trade certificate" };
  if (N_LEVEL.test(text)) return { type: "diploma", level: "TVET qualification" };
  if (NATIONAL_CERT.test(text)) return { type: "certificate", level: "National certificate" };
  if (CERTIFICATE.test(text) || fromCertificationsSection) return { type: "certificate", level: "Certificate" };
  return { type: "other", level: "Qualification" };
}

const IN_PROGRESS = /\b(in progress|in-progress|currently (?:studying|enrolled|completing|pursuing|busy|doing)|studying (?:towards|for)|busy (?:with|studying)|ongoing|expected(?: completion| graduation| to complete)?|to be completed|due to complete|anticipated|final year|enrolled|pursuing|candidate for|working towards|currently)\b/i;
const NOT_COMPLETED = /\b(incomplete|not completed|not complete|did not (?:complete|finish|graduate)|didn'?t (?:complete|finish)|discontinued|dropped out|withdrew|withdrawn|unfinished|not finished|partially completed|left before|(?:first|second|third|1st|2nd|3rd) year only|studies? (?:not )?(?:completed|finished))\b/i;
const COMPLETED = /\b(completed|graduated|obtained|awarded|passed|achieved|earned|conferred|cum laude|with distinction|with honou?rs|qualified)\b/i;

/** The CV's own words about progress ("did not complete", "in progress", "expected 2027"), or "" when the line has none. */
export function statusCue(line: string): string {
  return line.match(NOT_COMPLETED)?.[0] ?? line.match(IN_PROGRESS)?.[0] ?? "";
}

export interface Status { status: QualStatus; /** the words or year that support it, shown on request */ evidence: string }

/** `asOf` is today's date as a plain number (the year), passed in so the answer never depends on when the code happens to run. */
// How a qualification was studied (part-time) says nothing about whether it is finished, so it is not a cue (review 16 Nov 2026, C-H3).
// On a certificate, "current" and "currently" on their own are about its validity ("AWS Architect – current"), not its progress.
const CERTIFICATE_CURRENT = /\bcurrent(?:ly)?\b(?!\s+(?:studying|enrolled|completing|pursuing|busy|doing))/gi;

export function qualificationStatus(text: string, period: string, asYear: number, certificate = false): Status {
  const all = certificate ? `${text} ${period}`.replace(CERTIFICATE_CURRENT, " ") : `${text} ${period}`;
  const notDone = all.match(NOT_COMPLETED); if (notDone) return { status: "not_completed", evidence: notDone[0] };
  const doing = all.match(IN_PROGRESS); if (doing && !/\bnot (?:currently|ongoing)\b/i.test(all)) return { status: "in_progress", evidence: doing[0] };
  // Dates run to the present only when a date starts the span ("2022 – current"); a dash before "current" alone is not a date.
  if (new RegExp(`(?:\\b(?:19|20)\\d{2}|['’]\\d{2})\\s*(?:[-–—]|to|until|till)\\s*(?:${PRESENT_WORDS})\\b`, "i").test(all)) return { status: "in_progress", evidence: "dates run to the present" };
  const years = [...all.matchAll(/\b(19[5-9]\d|20\d{2})\b/g)].map((m) => Number(m[1]));
  const last = years.length ? Math.max(...years) : null;
  if (last !== null && last > asYear) return { status: "in_progress", evidence: `${last} is still to come` };
  const done = all.match(COMPLETED); if (done) return { status: "completed", evidence: done[0] };
  if (last !== null) return { status: "completed", evidence: `${last}, a year already past, is given as the year it ended` };
  return { status: "not_stated", evidence: "" };
}

/**
 * Whether a certificate still stands is separate from whether it was earned (owner, 2026-11-04): an expired certificate is history. "current" and "expired" need something the CV prints; a completion year alone
 * says nothing about validity, so it is "unknown". A printed date is judged against the assessment date, so one record can be current today and expired next year.
 */
type Validity = "current" | "expired" | "unknown";
export interface CertificateValidity { state: Validity; evidence: string; until?: string }
const VALID_UNTIL = /\b(?:valid\s+(?:until|to|through|till)|expir(?:es|y|y date|ing)(?:\s+on)?|renewal\s+(?:due|by))\b[:\s]*((?:[A-Za-z]{3,9}\s+)?(?:\d{1,2}[/.-])?(?:19|20)\d{2}(?:[/.-]\d{1,2})?)/i;
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The last day a printed period covers: "2027" runs to the end of that year, "03/2027" and "March 2027" to the end of that month. */
function lastDayOf(printed: string): Date {
  const year = Number(printed.match(/(?:19|20)\d{2}/)![0]), name = printed.match(/[a-z]{3}/i)?.[0].toLowerCase(), num = printed.match(/(?:^|[/.-])(\d{1,2})(?:$|[/.-])/)?.[1];
  const month = name && MONTH_NAMES.includes(name) ? MONTH_NAMES.indexOf(name) : num && Number(num) >= 1 && Number(num) <= 12 ? Number(num) - 1 : 11;
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
}
export function certificateValidity(item: { degree: string; institution?: string; year?: string }, asOf: Date): CertificateValidity {
  const all = `${item.degree} ${item.institution ?? ""} ${item.year ?? ""}`;
  // Only where a status is written (the year field or brackets), so "Active Directory" or "Current Affairs" in a course's name say nothing.
  const statusText = `${item.year ?? ""} ${(all.match(/\(([^)]*)\)/g) ?? []).join(" ")}`;
  const lapsed = statusText.match(/\b(?:expired|lapsed)\b/i); if (lapsed) return { state: "expired", evidence: lapsed[0] };
  const dated = all.match(VALID_UNTIL); if (dated) return { state: lastDayOf(dated[1]) >= asOf ? "current" : "expired", evidence: dated[0].trim(), until: dated[1] };
  const stated = statusText.match(/\b(?:currently valid|current|valid|active|in good standing)\b/i); if (stated) return { state: "current", evidence: stated[0] };
  return { state: "unknown", evidence: "" };
}

export interface Qualification { degree: string; institution: string; year: string; type: QualType; level: string; status: QualStatus; statusEvidence: string; validity?: Validity; validityEvidence?: string }

export function describeQualification(raw: { degree: string; institution?: string; year?: string }, asYear: number, fromCertificationsSection = false, asOf: Date = new Date(Date.UTC(asYear, 11, 31))): Qualification {
  const degree = (raw.degree ?? "").trim(), institution = (raw.institution ?? "").trim(), year = (raw.year ?? "").trim();
  const { type, level } = classifyQualification(`${degree} ${institution}`.trim(), fromCertificationsSection);
  // "Valid until 2027" is about the certificate's life, not about a study still under way.
  const { status, evidence } = qualificationStatus(degree.replace(VALID_UNTIL, " "), `${institution} ${year}`.replace(VALID_UNTIL, " ").trim(), asYear, fromCertificationsSection);
  if (type !== "certificate") return { degree, institution, year, type, level, status, statusEvidence: evidence };
  const v = certificateValidity({ degree, institution, year }, asOf);
  return { degree, institution, year, type, level, status, statusEvidence: evidence, validity: v.state, ...(v.evidence ? { validityEvidence: v.evidence } : {}) };
}

/** "Mastering Microsoft Projects, PSAROS (2012)" -> the name, who issued it, and the year. A line with no issuer is just a name. */
export function splitCertificate(line: string): { degree: string; institution: string; year: string } {
  let text = line.replace(/^[\s•·▪●■\-–*]+/, "").trim();
  let year = "";
  const paren = text.match(/\s*[(\[]\s*((?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2}|present))?)\s*[)\]]\s*$/i);
  if (paren) { year = paren[1].trim(); text = text.slice(0, paren.index).trim(); }
  else { const tail = text.match(/[,\-–]\s*((?:19|20)\d{2})\s*\.?$/); if (tail) { year = tail[1]; text = text.slice(0, tail.index).trim(); } }
  const comma = text.lastIndexOf(",");
  if (comma > 0) {
    const issuer = text.slice(comma + 1).trim();
    if (issuer && issuer.split(/\s+/).length <= 5 && !/\b(and|with|for|to|of the|using|in)\b/i.test(issuer) && text.slice(0, comma).trim().length >= 2) return { degree: text.slice(0, comma).trim(), institution: issuer, year };
  }
  return { degree: text, institution: "", year };
}
