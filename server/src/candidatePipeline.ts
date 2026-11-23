// The candidate reading pipeline, the one way a CV is read. It was once behind a flag: an organisation's reading.candidatePipeline setting, with CANDIDATE_PIPELINE=off stopping it for everyone and =all starting
// it for an evaluation run. The running parser stays as the fallback, so when the document model fails the document is still read, and says so. Nothing here changes a stored record's
// shape for existing readers: name, email and phone stay where they are, and what is new is added (`submission`) or lives in the extraction metadata.
import { buildDocModel, readingText, type DocModel } from "./docmodel/model";
import { couldBePlace, readIdentity, type Decision, type Identity } from "./docmodel/identity";
import { cleanOcr } from "./ocr";
import { withinBudget, type Reading } from "./parse";
import { candidateText } from "./rules";
import type { ReviewInfo, ReviewThresholds } from "./review";
import { config } from "./config";

/** Lines the layout sets apart from the page's ordinary text: evidence for headings. Nothing where a reader has no style. */
export function emphasisedLines(model: DocModel | null): Set<string> {
  const out = new Set<string>(), plain = new Set<string>(); if (!model) return out;
  for (const p of model.pages) { const sizes = p.lines.map((l) => l.style.sizePt ?? 0).filter(Boolean).sort((a, b) => a - b), typical = sizes[Math.floor(sizes.length / 2)] ?? 0; for (const l of p.lines) (l.style.bold || (l.relativeHeight ?? 0) >= 1.15 || (typical && (l.style.sizePt ?? 0) > typical) ? out : plain).add(l.text.trim()); }
  // The reading text does not say which occurrence is which, so words printed both plainly and in bold are not evidence of a heading: "Maintenance" in bold above an example is still an item in the skills list.
  for (const t of plain) out.delete(t);
  return out;
}

/** The four ways a value can be absent are different problems for a recruiter, so they are never reported as one. */
export type FieldState = "found" | "missing" | "unreadable" | "conflict" | "failed";
export interface FieldReport { state: FieldState; reason?: string; source?: string; /** More than one value was read and none could be chosen: someone must look. */ doubtful?: boolean }
export type FieldReports = Record<"name" | "email" | "phone" | "location" | "role" | "skills" | "workHistory" | "education" | "certifications" | "languages", FieldReport>;

export interface CandidateReading { text: string; order: "columns" | "as-read"; model: DocModel | null; identity: Identity | null; failed?: string }

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;
// Roles hang on their dates, so a reading order that breaks date ranges apart has torn a table's rows and is not used.
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s*", DATE_RANGE = new RegExp(`\\b(?:${MONTH})?(?:0?\\d/)?(?:19|20)\\d{2}\\s*(?:-|–|—|to|until)\\s*(?:(?:${MONTH})?(?:0?\\d/)?(?:19|20)\\d{2}|present|current|date|now)`, "gi");
const dateRanges = (s: string) => (s.match(DATE_RANGE) ?? []).length;
/** Reads the document model from what readDocument already read. If it fails or times out, the document keeps its plain reading. */
export async function readCandidate(bytes: Uint8Array, type: string, read: Reading, seconds: number, signal?: AbortSignal): Promise<CandidateReading> {
  let model: DocModel | null = null, failed: string | undefined;
  try {
    // Given as work that can be stopped: when the time runs out, the reading stops at its next page, so a full OCR of a scan does not go on in the
    // background holding the OCR queue every other document waits in (code review, 16 Nov 2026, B-M7).
    const built = await withinBudget((signal) => buildDocModel(bytes, type, { ocrPages: read.ocrPages, text: read.text, visibility: read.visibility, signal }), seconds, undefined, signal);
    if (built === "TIMEOUT") failed = `the document's layout could not be read within ${seconds} seconds`; else model = built;
  } catch { failed = "the document's layout could not be read"; }
  if (!model) return { text: candidateText(read.text), order: "as-read", model: null, identity: null, failed };
  let identity: Identity | null = null;
  try { identity = readIdentity(model); } catch { failed = "the name and contact details could not be worked out from the layout"; }
  // Columns are only trusted when nothing is lost by them: the plain reading is kept if this one has noticeably fewer letters, or if the file's stored letters needed repair.
  let text = read.text, order: CandidateReading["order"] = "as-read";
  const ordered = read.repaired ? "" : readingText(model);
  if (ordered) { const cleaned = model.reader === "pdf-native" ? ordered : cleanOcr(ordered); if (letters(cleaned) >= letters(read.text) * 0.85 && dateRanges(cleaned) >= dateRanges(read.text)) { text = cleaned; order = "columns"; } }
  return { text: candidateText(withoutRunningHeaders(text, identity)), order, model, identity, failed };
}

/** The person's own name on a short line again later in the document is a running header or footer ("Thandi Mokoena | Accountant"), which pages carry and sections do not. The first time it appears stays. */
function withoutRunningHeaders(text: string, identity: Identity | null): string {
  const name = identity?.name.value.toLowerCase(); if (!name) return text;
  let seen = false;
  return text.split("\n").filter((l) => { const t = l.trim(); if (t.length > 90 || !t.toLowerCase().includes(name) || /[.!?]$/.test(t)) return true; if (!seen) { seen = true; return true; } return false; }).join("\n");
}

const sectionPrinted = (text: string, words: RegExp) => text.split("\n").some((l) => l.trim().length <= 40 && words.test(l.trim()));
const decided = (d: Decision | undefined, onAbsent: () => FieldReport): FieldReport => (d?.status === "selected" && d.value ? { state: "found", source: d.source } : onAbsent());

/** What happened to each field. "unreadable" needs a sign in the document that the thing is there; without one a blank is simply missing. */
export function reportFields(rec: any, reading: CandidateReading): FieldReports {
  const { text, identity, failed, model } = reading, ocr = model?.reader === "pdf-ocr" || model?.reader === "image-ocr";
  const failedField = (what: string): FieldReport => ({ state: "failed", reason: `${failed ?? "the document's layout could not be read"}, so the ${what} comes from the plain reader` });
  const listField = (present: boolean, heading: RegExp, what: string): FieldReport => present ? { state: "found" } : sectionPrinted(text, heading) ? { state: "unreadable", reason: `The ${what} heading is in the document but nothing under it could be read.` } : { state: "missing" };
  const name: FieldReport = !identity ? failedField("name") : decided(identity.name, () => /too close/.test(identity.name.reason ?? "") ? { state: "conflict", reason: "Two possible names are too close to choose between." } : identity.nameCandidates.length ? { state: "unreadable", reason: "Nothing in the document confirms any line as the person's name." } : { state: "missing", reason: "No line in the document looks like a person's name." });
  const own = (kind: "email" | "phone"): FieldReport => {
    if (!identity) return failedField(kind === "email" ? "e-mail address" : "phone number");
    const doubtful = identity.contacts.find((c) => c.kind === kind && c.owner === "candidate" && c.uncertain);
    const mine = identity.contacts.filter((c) => c.kind === kind && c.owner === "candidate" && !c.uncertain), top = [...mine].sort((a, b) => b.score - a.score), label = kind === "email" ? /\be-?mail\b|@/i : /\b(?:phone|cell|mobile|tel)\b/i;
    if (kind === "email" && new Set(top.filter((c) => c.score === top[0]?.score).map((c) => c.value)).size > 1 && !top[0].evidence.some((e) => e.id === "carriesName")) return { state: "conflict", reason: "The document gives more than one address with nothing to choose between them." };
    if (doubtful && !mine.length) return { state: "unreadable", doubtful: true, reason: `The ${kind === "email" ? "e-mail address" : "phone number"} could not be read with confidence, so none is shown. It was read as: ${doubtful.uncertain!.slice(0, 3).join(" or ")}. Check it against the original.` };
    return decided(identity[kind], () => identity.contacts.some((c) => c.kind === kind && c.owner === "agency") ? { state: "missing", reason: "Only the recruiting agency's is given." } : ocr && label.test(text) ? { state: "unreadable", reason: `The document seems to give ${kind === "email" ? "an e-mail address" : "a phone number"}, but it could not be read.` } : { state: "missing" });
  };
  const location = !identity ? failedField("location") : decided(identity.location, () => (rec.location ? { state: "found" } : { state: "missing" }));
  const edu = (rec.education ?? []) as { type?: string }[];
  return {
    name, email: own("email"), phone: own("phone"), location,
    role: rec.role || (rec.workHistory ?? []).some((w: any) => w.position) ? { state: "found" } : { state: "missing" },
    skills: listField((rec.skills ?? []).length > 0, /^(?:(?:key|core|technical|professional)\s+)?(?:skills|competenc(?:ies|y))[:\s]*$/i, "skills"),
    workHistory: listField((rec.workHistory ?? []).length > 0, /^(?:(?:work|employment|professional|career)\s+)?(?:experience|history)[:\s]*$/i, "work history"),
    education: listField(edu.some((e) => e.type !== "certificate"), /^(?:education|qualifications?|academic.*)[:\s]*$/i, "education"),
    certifications: listField(edu.some((e) => e.type === "certificate"), /^(?:certifications?|certificates?|courses|training)[:\s]*$/i, "certifications"),
    languages: listField((rec.languages ?? []).length > 0, /^languages?[:\s]*$/i, "languages"),
  };
}

/** What a document says about the agency and the recruiter, as it goes on the record. Absent on a document that did not come through one. */
export function submissionOf(identity: Identity | null) {
  if (!identity?.agency) return undefined;
  const a = identity.agency;
  return { contactRoute: identity.candidateContact, agency: { name: a.name.value, domain: a.domain, email: a.office.email.value, phone: a.office.phone.value }, recruiter: { name: a.recruiter.name.value, email: a.recruiter.email.value, phone: a.recruiter.phone.value }, evidence: identity.agencyEvidence };
}

const wordsInitials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");
/** Puts identity on the record. Where the layout could not be read the plain reader's values stay and the field reports say so. Candidate and agency details are never mixed. */
export function applyIdentity(rec: any, identity: Identity | null): void {
  if (!identity) return;
  rec.name = identity.name.value; rec.email = identity.email.value; rec.phone = identity.phone.value;
  if (identity.location.value) rec.location = identity.location.value; else if (/:\s*$/.test(String(rec.location ?? "")) || !couldBePlace(String(rec.location ?? ""))) rec.location = "";   // a label with its value missing, or a piece of a sentence, is not a place
  // A monogram can sit on the title's row: "NB Senior Accountant" under the name Nomsa Bhengu. Only letters that are this person's initials are taken off.
  const initials = wordsInitials(identity.name.value), mono = String(rec.role ?? "").match(/^([A-Z]{1,3})\s+(\S.*)$/);
  if (mono && initials && initials.startsWith(mono[1])) rec.role = mono[2];
  // A form's label can stick to the title ("Role Office Administrator"): the record's own latest role says where the title really starts.
  const latest = String(rec.workHistory?.[0]?.position ?? "").trim(); if (latest && String(rec.role ?? "").toLowerCase().endsWith(latest.toLowerCase()) && /^(?:role|position|title|job title|designation|occupation|current role)\s*[:|]?\s*$/i.test(String(rec.role).slice(0, rec.role.length - latest.length))) rec.role = latest;   // only a form's label: "Senior" in front of an earlier post is part of the title
  const sub = submissionOf(identity); if (sub) rec.submission = sub;
}

/** A blank name is published only when the document plainly is a CV, so an invoice or a job advert uploaded by mistake is still refused. */
export const usableWithoutName = (rec: any) => (rec.workHistory ?? []).length > 0 || (rec.education ?? []).length > 0 || (rec.skills ?? []).length >= 3;

export const REVIEW_RULES_CANDIDATE = "2.0.0-candidate";
const ROUTINE_NOTICE = /read by OCR|read from a photo by OCR/i;
/**
 * Review only what could lead someone to the wrong person or leave them unable to act: who it is, how to reach them, whether their history could be read, and anything suspicious about the file.
 * A short skills list or a standing notice that OCR was used informs and does not flag, or every scan would be a manual task.
 * Each rule's value is measured in test/candidate/review.ts: how many wrong published values it catches for how many documents it sends to a person.
 */
export function reviewCandidateFields(rec: any, fields: FieldReports, identity: Identity | null, issues: string[], ocr: boolean, textLength: number, th: Pick<ReviewThresholds, "flagNoContact" | "flagNoWorkHistory" | "flagNoEducation" | "minSkills" | "lowConfidence">, confidence = 1): ReviewInfo {
  const reasons: string[] = [], notes: string[] = [];
  const say = (f: FieldReport, fallback: string) => f.reason ?? fallback;
  if (fields.name.state !== "found") reasons.push(say(fields.name, "No name could be confirmed."));
  if (th.flagNoContact && !rec.email && !rec.phone && !rec.submission?.recruiter?.email && !rec.submission?.recruiter?.phone && !rec.submission?.agency?.email && !rec.submission?.agency?.phone) reasons.push("There is no way to reach this candidate or an agency from this record.");
  for (const k of ["email", "phone"] as const) if (fields[k].state === "conflict" || fields[k].state === "failed" || fields[k].doubtful) reasons.push(say(fields[k], `The ${k} could not be confirmed.`));
  // On OCR an address that shares nothing with the name may be a misreading, and an address is what someone will act on.
  if (ocr && rec.email && identity && rec.name) { const parts = rec.name.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3), local = rec.email.split("@")[0].toLowerCase(); if (!parts.some((w: string) => local.includes(w))) reasons.push("The e-mail address was read by OCR and does not resemble the name, so check it against the original."); }
  if (fields.workHistory.state !== "found" && th.flagNoWorkHistory) reasons.push(say(fields.workHistory, "No work history could be read from the document."));
  if (fields.education.state === "unreadable" && th.flagNoEducation) reasons.push(say(fields.education, "Education could not be read."));
  if (fields.skills.state === "unreadable") reasons.push(say(fields.skills, "The skills could not be read."));
  // What an organisation asks for on Settings holds here as everywhere: fewer skills than its minimum, or a reading below its confidence, goes to a person.
  else if ((rec.skills ?? []).length < th.minSkills) reasons.push((rec.skills ?? []).length ? `Only ${rec.skills.length} skill${rec.skills.length > 1 ? "s were" : " was"} found; the document may list more.` : "No skills were found.");
  if (confidence < th.lowConfidence) reasons.push(`Extraction confidence is low (${Math.round(confidence * 100)}%).`);
  if ((rec.workHistory ?? []).length && (rec.workHistory as any[]).every((w) => !String(w.startDate ?? "").trim())) reasons.push("No role has a start date that could be read, so years of experience are unknown.");
  if (textLength < 400) reasons.push("Very little text could be read from the document.");
  // TEMPORARY containment, register R95: scans failed their written accuracy criteria, so until they pass every one goes to a person. Not a fix: wrong values on scans are unchanged.
  if (ocr && config.reviewAllScans) reasons.push("Read from a scan or photo, so check these details against the original.");
  for (const i of issues) (ROUTINE_NOTICE.test(i) ? notes : reasons).push(i);
  for (const [k, f] of Object.entries(fields)) if (f.state !== "found" && f.reason && !reasons.includes(f.reason)) notes.push(`${k}: ${f.reason}`);
  if (!rec.location) notes.push("No location was found.");
  return { state: reasons.length ? "needs_review" : "ok", reasons, notes, rulesVersion: REVIEW_RULES_CANDIDATE };
}
