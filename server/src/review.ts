// Decides whether a freshly extracted record needs a person to look at it before anyone relies on it.
// The rules are deliberately plain and explained in words, so a recruiter can see exactly why a record was flagged.
// A flag never blocks anything: it asks for human attention. Only a person can clear it ("Mark as reviewed").
type ReviewState = "needs_review" | "ok" | "reviewed";
export interface ReviewInfo {
  state: ReviewState;
  /** Why a person should look at this record. Empty when state is "ok". */
  reasons: string[];
  /** Things that are missing but normal for many documents; shown for information, they do not flag the record. */
  notes: string[];
  rulesVersion: string;
  reviewedBy?: string;
  reviewedAt?: string;
}
const REVIEW_RULES_VERSION = "1.0.0";
export interface ReviewThresholds { lowConfidence: number; minSkills: number; flagNoContact: boolean; flagNoWorkHistory: boolean; flagNoEducation: boolean }
/** The platform defaults; an organisation can change them in its settings. */
const DEFAULT_THRESHOLDS: ReviewThresholds = { lowConfidence: 0.5, minSkills: 3, flagNoContact: true, flagNoWorkHistory: true, flagNoEducation: false };

interface Meta { warnings?: string[]; droppedUnsupported?: string[]; readingIssues?: string[]; sections?: { step: string; status: string; via: string; count: number; tried: string[] }[] }

export function reviewCandidate(rec: any, confidence: number, meta: Meta, textLength: number, th: ReviewThresholds = DEFAULT_THRESHOLDS): ReviewInfo {
  const reasons: string[] = [], notes: string[] = [];
  const history: any[] = Array.isArray(rec.workHistory) ? rec.workHistory : [];
  if (th.flagNoContact && !String(rec.email ?? "").trim() && !String(rec.phone ?? "").trim()) reasons.push("No email address or phone number was found, so the candidate cannot be contacted from this record.");
  if (!String(rec.role ?? "").trim() && !history.some((w) => String(w.position ?? "").trim())) reasons.push("No job title was found.");
  if (!history.length) { if (th.flagNoWorkHistory) reasons.push("No work history could be read from the document."); }
  else {
    const noTitle = history.filter((w) => !String(w.position ?? "").trim()).length;
    if (noTitle && history.length) reasons.push(`${noTitle} of ${history.length} role${history.length > 1 ? "s have" : " has"} no job title.`);
    const noDates = history.filter((w) => !String(w.startDate ?? "").trim()).length;
    if (noDates) reasons.push(`${noDates} of ${history.length} role${history.length > 1 ? "s have" : " has"} no start date, so years of experience may be understated.`);
  }
  if (!(rec.skills ?? []).length) reasons.push("No skills were found.");
  else if (rec.skills.length < th.minSkills) reasons.push(`Only ${rec.skills.length} skill${rec.skills.length > 1 ? "s were" : " was"} found; the document may list more.`);
  if (confidence < th.lowConfidence) reasons.push(`Extraction confidence is low (${Math.round(confidence * 100)}%).`);
  if (textLength < 400) reasons.push("Very little text could be read from the document.");
  if (meta.droppedUnsupported?.length) reasons.push(`${meta.droppedUnsupported.length} extracted item${meta.droppedUnsupported.length > 1 ? "s were" : " was"} dropped because the document did not support ${meta.droppedUnsupported.length > 1 ? "them" : "it"}.`);
  for (const i of meta.readingIssues ?? []) reasons.push(i);
  for (const w of meta.warnings ?? []) notes.push(w); // standing notices (e.g. "read by the built-in parser") apply to every document, so they inform but do not flag
  if (!String(rec.location ?? "").trim()) notes.push("No location was found.");
  // The reader works through the CV in a fixed order and tries every way it knows before it gives up on a part. When it gives up, say what it tried.
  const missed = (step: string) => meta.sections?.find((s) => s.step === step && s.status === "not_found");
  const education = missed("education");
  if (!(rec.education ?? []).length) {
    const why = `No education or certifications were found${education ? ` (looked at: ${education.tried.join("; ")})` : ""}.`;
    if (th.flagNoEducation) reasons.push(why); else notes.push(why);
  }
  return { state: reasons.length ? "needs_review" : "ok", reasons, notes, rulesVersion: REVIEW_RULES_VERSION };
}

export function reviewJob(rec: any, confidence: number, meta: Meta, textLength: number, th: ReviewThresholds = DEFAULT_THRESHOLDS): ReviewInfo {
  // A job is read by Claude, every value held to the document (jobReader.ts): what it did not find is said plainly, for a recruiter to add or check.
  const reasons: string[] = [], notes: string[] = [];
  const mandatory = (rec.requirements ?? []).length, preferred = (rec.preferredRequirements ?? []).length, read = rec.aiReading;
  if (!String(rec.title ?? "").trim()) reasons.push("No job title was found in the job description. Add the title before matching.");
  if (!mandatory && !preferred) reasons.push("No requirements were found in the job description, so it cannot be matched against anyone yet. Add them before matching.");
  else if (!mandatory) reasons.push("The job description lists only advantageous items, no minimum requirements.");
  if (!String(rec.company ?? "").trim()) notes.push("The job description does not name the employer.");
  if (read?.dropped) notes.push(`${read.dropped} value${read.dropped === 1 ? "" : "s"} the AI gave ${read.dropped === 1 ? "was" : "were"} not in the job description's own words and ${read.dropped === 1 ? "was" : "were"} left out.`);
  if (confidence < th.lowConfidence) reasons.push("The reading is unsure. Check the panel against the original.");
  if (textLength < 400) reasons.push("Very little text could be read from the document.");
  for (const i of meta.readingIssues ?? []) reasons.push(i);
  if (read?.unlabelled) notes.push(`${read.unlabelled} line${read.unlabelled === 1 ? "" : "s"} of the job could not be placed by the AI and ${read.unlabelled === 1 ? "is" : "are"} kept under "Also in the job description".`);
  if (!String(rec.location ?? "").trim()) notes.push("The job description does not say where the job is based.");
  if (!(rec.responsibilities ?? []).length) notes.push("The job description lists no responsibilities.");
  return { state: reasons.length ? "needs_review" : "ok", reasons, notes, rulesVersion: REVIEW_RULES_VERSION };
}
