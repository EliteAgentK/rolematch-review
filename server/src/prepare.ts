// The document → canonical record steps the pipeline runs, with no database, storage or queue: type check, size limit, reading (native text or OCR),
// extraction, the hidden-text, inspection and layout notes, the identity check and the review flags. The pipeline (pipeline.ts) and the offline
// evaluation runner both call this, so what is evaluated offline is exactly what the application does.
import { applyIdentity, emphasisedLines, readCandidate, reportFields, reviewCandidateFields, usableWithoutName, type CandidateReading } from "./candidatePipeline";
import { extractCandidate } from "./extract";
import { pageStartsOf } from "./docmodel/model";
import { contactsInPictures, repairMisreadGlyphs } from "./visibility";
import { describeFormats, isImage, sniff } from "./formats";
import { summariseInspection } from "./inspect";
import { NO_PAGE_LIMIT, ParseError, readDocument } from "./parse";
import { reviewCandidate, type ReviewInfo } from "./review";
import type { Settings } from "./settings";
import { layoutFamily } from "./templates";
import { CANDIDATE_PIPELINE_VERSION } from "./version";
import { stopIfAsked, Stopped } from "./stopping";

export type PrepareFailure = { ok: false; code: string; message: string; stage: "security" | "reading" | "validating"; text?: string };
export interface Prepared {
  ok: true; type: NonNullable<ReturnType<typeof sniff>>; text: string; issues: string[];
  record: any; confidence: number; meta: any; review: ReviewInfo;
}
export interface PrepareOptions {
  kind: "cv" | "jd"; org: Settings; asOf: Date;
  /** Runs after extraction and before review, as the pipeline's duplicate check does; it may add a reading issue and metadata. */
  beforeReview?: (record: any) => Promise<{ issue?: string; meta?: Record<string, unknown> } | void>;
  /** Stage changes, in the pipeline's order: "reading" before the document is read, "extracting" (with the text read) before extraction. */
  onStage?: (stage: "reading" | "extracting", text?: string) => Promise<unknown>;
  /** The CV's fields are Claude's to read (cvReader.ts): nothing is refused here for what the word rules could not find, a name included. */
  fieldsByAi?: boolean;
  /** The document's time ran out (pipeline.ts): the reading stops between pages and steps, and throws Stopped (code review, 16 Nov 2026, B-M3). */
  signal?: AbortSignal;
}

export async function prepareDocument(bytes: Uint8Array, o: PrepareOptions): Promise<Prepared | PrepareFailure> {
  const type = sniff(bytes);
  if (!type) return { ok: false, stage: "security", code: "FILE_TYPE", message: `The file is not a supported document (${describeFormats()}).` };
  const processBytes = o.org.limits.processFileMb * 1048576;
  if (bytes.length > processBytes) return { ok: false, stage: "security", code: "FILE_TOO_BIG", message: `The file is ${(bytes.length / 1048576).toFixed(0)} MB, more than the ${o.org.limits.processFileMb} MB limit, and could not be made smaller.` };
  await o.onStage?.("reading");
  const candidate = o.kind === "cv";
  let text = "", issues: string[] = [], inspected: unknown, hiddenText: unknown, ocrPages: Awaited<ReturnType<typeof readDocument>>["ocrPages"], repaired: boolean | undefined;
  try { let inspection; ({ text, issues, inspection, hiddenText, ocrPages, repaired } = await readDocument(bytes, type, { pageCeiling: o.kind === "cv" ? NO_PAGE_LIMIT : o.org.limits.maxPages, reading: o.org.reading, emailToo: candidate, keepLineBreaks: true, signal: o.signal })); inspected = inspection; }
  catch (e: any) {
    if (e instanceof Stopped) throw e;
    if (e instanceof ParseError) return { ok: false, stage: "reading", code: e.code, message: e.message };
    return { ok: false, stage: "reading", code: "UNREADABLE", message: "The document could not be read. It may be corrupted or password-protected." };
  }
  // an image that gave almost no text is a photo problem, said as such
  if (text.length < 150 && isImage(type)) return { ok: false, stage: "reading", code: "PHOTO_UNREADABLE", message: "This photo is too blurry, dark or small to read reliably. Retake it flat, in good light and in focus, or upload the PDF or Word file instead.", text };
  if (text.length < 150) return { ok: false, stage: "reading", code: "NEEDS_OCR", message: "Almost no text could be read, even after trying OCR. The scan may be too faint or blurred. Try a clearer copy or a text-based PDF.", text };

  let reading: CandidateReading | null = null;
  stopIfAsked(o.signal);
  if (candidate) { reading = await readCandidate(bytes, type, { text, issues, ocrPages, repaired }, Math.max(60, o.org.reading.pageSeconds * 3), o.signal); text = reading.text; }
  stopIfAsked(o.signal);
  if (candidate && type === "pdf" && !ocrPages?.length) { const fixed = await repairMisreadGlyphs(bytes, text).catch(() => ({ text, repaired: {} })); text = fixed.text; if (Object.keys(fixed.repaired).length) issues.push("This PDF's font stored some letters under the wrong codes. They were corrected against the rendered page; check names and dates against the original."); const pictured = await contactsInPictures(bytes, text).catch(() => [] as string[]); if (pictured.length) text = `${text}\n${pictured.join("\n")}`; }
  stopIfAsked(o.signal);
  await o.onStage?.("extracting", text);
  // A job description is read by Claude alone (jobReader.ts, owner 10 Nov 2026): here it is only opened, checked and turned into text. Its draft is empty until
  // Claude's reading fills it, and nothing about it is refused for what word rules could or could not find.
  if (o.kind === "jd") {
    const meta: any = { method: "ai", schemaVersion: "job-ai", warnings: [], droppedUnsupported: [], sections: [], readingIssues: issues, viaOcr: !!ocrPages?.length,
      ...(hiddenText ? { hiddenText } : {}), ...(inspected ? { inspection: summariseInspection(inspected as any) } : {}),
      layoutFamily: layoutFamily({ kind: type, producer: (inspected as any)?.producer, creator: (inspected as any)?.creator, text }) };
    const record = { title: "", company: "", location: "", department: "", type: "", workArrangement: "", description: "", requirements: [], preferredRequirements: [], responsibilities: [], skills: [] };
    return { ok: true, type, text, issues, record, confidence: 0, meta, review: { state: "ok", reasons: [], notes: [] } as any };
  }
  const extracted = await extractCandidate(text, { asOf: o.asOf, emphasised: reading ? emphasisedLines(reading.model) : undefined });
  (extracted.meta as any).viaOcr = !!ocrPages?.length;
  if (reading) { applyIdentity(extracted.record, reading.identity); (extracted.meta as any).parserVersion = `${extracted.meta.parserVersion}+${CANDIDATE_PIPELINE_VERSION}`; }
  const extra = o.beforeReview ? await o.beforeReview(extracted.record) : undefined;
  if (extra?.issue) issues.push(extra.issue);
  if (extra?.meta) Object.assign(extracted.meta as any, extra.meta);
  extracted.meta.readingIssues = issues;
  if (hiddenText) (extracted.meta as any).hiddenText = hiddenText;
  if (inspected) (extracted.meta as any).inspection = summariseInspection(inspected as any);
  (extracted.meta as any).layoutFamily = layoutFamily({ kind: type, producer: (inspected as any)?.producer, creator: (inspected as any)?.creator, text });   // a label only; reading is unchanged
  const rec: any = extracted.record;
  if (reading) {
    const fields = reportFields(rec, reading), ocr = reading.model?.reader === "pdf-ocr" || reading.model?.reader === "image-ocr", i = reading.identity;
    if (!o.fieldsByAi && !rec.name.trim() && !usableWithoutName(rec)) return { ok: false, stage: "validating", code: "IDENTITY_UNRESOLVED", message: "No candidate name could be confirmed and the document does not read as a CV, so it was not published. Review the document and try again.", text };
    Object.assign(extracted.meta as any, { pipeline: CANDIDATE_PIPELINE_VERSION, readingOrder: reading.order, ...(reading.model ? { pageStarts: pageStartsOf(text, reading.model) } : {}), fields, reader: reading.model?.reader ?? "plain", ...(reading.model?.hiddenText ? { hiddenTextCheck: reading.model.hiddenText } : {}), ...(i ? { identity: { name: i.name, email: i.email, phone: i.phone, location: i.location, nameCandidates: i.nameCandidates, contacts: i.contacts, agencyDocument: i.agencyDocument, agencyEvidence: i.agencyEvidence, candidateContact: i.candidateContact, agency: i.agency, unavailableEvidence: i.unavailableEvidence } } : {}) });
    const review = reviewCandidateFields(rec, fields, i, issues, ocr, text.length, o.org.review, extracted.confidence);
    return { ok: true, type, text, issues, record: rec, confidence: extracted.confidence, meta: extracted.meta, review };
  }
  if (!o.fieldsByAi && !rec.name.trim()) return { ok: false, stage: "validating", code: "IDENTITY_UNRESOLVED", message: "No candidate name could be confirmed from the document, so it was not published. Review the document and try again.", text };
  const review = reviewCandidate(rec, extracted.confidence, extracted.meta, text.length, o.org.review);
  return { ok: true, type, text, issues, record: rec, confidence: extracted.confidence, meta: extracted.meta, review };
}
