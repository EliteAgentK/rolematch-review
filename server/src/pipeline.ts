import { audit, newId, sql } from "./db";
import { prepareDocument, type Prepared } from "./prepare";
import { contentTypeOf, describeFormats, isOptimisable, sniff } from "./formats";
import { enqueue, registerHandler, restartWhenIdle } from "./queue";
import { stopIfAsked, Stopped } from "./stopping";
import { aiMatchingOn } from "./aiMatch";
import { getSettings } from "./settings";
import { duplicateNotice, findDuplicates } from "./duplicates";
import { getObject, putObject } from "./supabase";
import { config } from "./config";
import { record } from "./timing";
import { recordOccurrence } from "./occurrences";
import { finishBatchOf } from "./batches";
import { withWorthNotingOnly } from "./worthNoting";
import { countPages } from "./pageCount";
import { isScanned, optimiseDocx, optimiseScannedPdf, optimiseTextPdf } from "./optimise";
import { aiReadsCvs, registerAiReading, sendToAi } from "./aiRead";
import { registerJobFieldReading, sendJobToAi } from "./aiJobFields";
import { unpacksSafely } from "./readers";

const STAGES = ["received", "security", "optimising", "reading", "extracting", "validating", "ready", "auditing", "audit_waiting"] as const;
type Stage = (typeof STAGES)[number];

/** A document cancelled, failed or published meanwhile is never put back to processing: its run stops there (review 16 Nov 2026, B-M1). */
async function setStage(id: string, stage: Stage, extra: { scan_result?: string; source_text?: string } = {}) {
  const moved = await sql`update documents set stage = ${stage}, updated_at = now(),
      scan_result = coalesce(${extra.scan_result ?? null}, scan_result), source_text = coalesce(${extra.source_text ?? null}, source_text) where id = ${id} and status = 'processing' returning id`;
  if (!moved.length) throw new NoLongerProcessing();
}

class OverTime extends Error {}
class NoLongerProcessing extends Error {}
class Rejected extends Error { constructor(public code: string, message: string) { super(message); } }

async function reject(doc: any, code: string, message: string, correlationId: string, stage?: string): Promise<never> {
  await sql`update documents set status = 'exception', error_code = ${code}, error_message = ${message}, updated_at = now() where id = ${doc.id} and status = 'processing'`;   // never over a published or cancelled one
  await audit(sql, doc.org_id, null, "document.exception", "document", doc.id, { code }, correlationId);
  console.error(JSON.stringify({ level: "warn", event: "document.rejected", documentId: doc.id, orgId: doc.org_id, code, correlationId })); // the error log: no file names or personal data
  await recordOccurrence({ orgId: doc.org_id, correlationId, component: "pipeline", stage: stage ?? doc.stage, code, documentId: doc.id, batchId: doc.batch_id, userId: doc.created_by, message });   // expected outcomes are recorded too, so their rates can be watched
  await finishBatchOf(doc.id);   // an end state: the batch may now be able to close and release its slots
  throw new Rejected(code, message);
}

/** Publication happens in one statement: the record, the document link and the audit entry together. `extracted` keeps the parser's own reading, whatever the AI's reading changed.
 *  `separateJob`: the CV was read by the AI in a job of its own (aiRead.ts), so its batch may close now. */
export async function publishDraft(doc: any, draft: { record: any; confidence: number; meta: any; review: any; parserRecord?: any }, correlationId: string, separateJob = false): Promise<string> {
  const { record: rec, confidence, meta, review } = draft, recordId = newId(), parser = draft.parserRecord ?? rec;
  const today = new Date().toISOString().slice(0, 10);
  const uploadedAt = new Date(doc.created_at ?? Date.now()).toISOString();   // when the file was uploaded, not when its reading finished
  const asRead = doc.kind === "cv"
    ? { ...parser, status: "new", avatar: "", rating: 0, appliedDate: today, uploadedAt, originalDocumentName: doc.original_name, extractionConfidence: confidence, extraction: meta, review, reviewState: review.state }
    : { ...parser, status: "draft", postedDate: today, uploadedAt, originalDocumentName: doc.original_name, extractionConfidence: confidence, extraction: meta, review, reviewState: review.state };
  const full = withWorthNotingOnly({ ...asRead, ...rec, status: asRead.status, review, reviewState: review.state });   // never the summary or duties again (worthNoting.ts)
  // One statement = one round trip and one atomic change: the record, the document link and the audit entry together.
  const entity = doc.kind === "cv" ? "candidate" : "job";
  const detail = { documentId: doc.id, method: meta.method, confidence, review: review.state, reviewReasons: review.reasons, aiReading: rec.aiReading ? { state: rec.aiReading.state, model: rec.aiReading.model, reason: rec.aiReading.reason } : undefined };
  // Two runs of one document can finish together (a job silent for 120 s is queued again while it may still be running): the document row is held
  // first, so only the run that finds it still processing writes anything; the other publishes nothing (review 16 Nov 2026, B-H3).
  const published = await sql.begin(async (q) => {
    const [now] = await q`select status from documents where id = ${doc.id} for update`;
    if (now?.status !== "processing") return false;
    if (doc.kind === "cv") await q`
      with ins as (insert into candidates (id, org_id, document_id, data, extracted) select ${recordId}, ${doc.org_id}, ${doc.id}, ${sql.json(full)}, ${sql.json(asRead)} where exists (select 1 from documents x where x.id = ${doc.id} and x.status = 'processing') returning id),
           upd as (update documents set status = 'published', stage = 'ready', record_id = ${recordId}, awaiting_audit = null, updated_at = now() where id = ${doc.id} and status = 'processing' and exists (select 1 from ins) returning id)
      insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail, correlation_id)
      select ${newId()}, ${doc.org_id}, ${doc.created_by}, ${entity + ".published"}, ${entity}, ins.id, ${sql.json(detail)}, ${correlationId} from ins`;
    else await q`
      with ins as (insert into jobs (id, org_id, document_id, data, extracted) select ${recordId}, ${doc.org_id}, ${doc.id}, ${sql.json(full)}, ${sql.json(asRead)} where exists (select 1 from documents x where x.id = ${doc.id} and x.status = 'processing') returning id),
           upd as (update documents set status = 'published', stage = 'ready', record_id = ${recordId}, awaiting_audit = null, updated_at = now() where id = ${doc.id} and status = 'processing' and exists (select 1 from ins) returning id)
      insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail, correlation_id)
      select ${newId()}, ${doc.org_id}, ${doc.created_by}, ${entity + ".published"}, ${entity}, ins.id, ${sql.json(detail)}, ${correlationId} from ins`;
    return true;
  });
  if (!published) return "";
  // A job is read by the AI into its requirements straight away (aiJobRead.ts), so the first Match does not wait for it.
  if (doc.kind !== "cv" && aiMatchingOn()) await enqueue(doc.org_id, "model-job-read", { jobId: recordId, orgId: doc.org_id }, 2).catch((e) => console.error(JSON.stringify({ level: "warn", event: "ai.job_read_queue_failed", documentId: doc.id, error: String(e?.message ?? e) })));
  if (separateJob) await finishBatchOf(doc.id);   // read by the AI in a job of its own: the document has its end state now
  return recordId;
}

/** How long a stopped reading may take to reach its next page and stop. OCR of one page takes seconds; a drawn page is capped (pdfDoc.ts). */
const STOP_GRACE_MS = Number(process.env.READING_STOP_GRACE_SECONDS ?? 120) * 1000;
/** A reading told to stop normally does so at its next page. One that has not stopped after STOP_GRACE_MS is stuck where nothing can reach it (a page that
 *  never finishes), holding processor and memory: the process stops taking work and restarts once every other job it holds has finished, so none of them
 *  loses an attempt (code review, 16 Nov 2026, B-M3). As before, a development server that also serves the website (ROLE=all) is not restarted. */
function watchStoppedReading(reading: Promise<unknown>, documentId: string) {
  let stopped = false;
  void reading.then(() => { stopped = true; }, () => { stopped = true; });
  setTimeout(() => {
    if (stopped) return;
    console.error(JSON.stringify({ level: "warn", event: "document.reading_not_stopped", documentId, seconds: STOP_GRACE_MS / 1000 }));
    if (config.role !== "all" || process.env.NODE_ENV === "production") restartWhenIdle("a reading did not stop after its time ran out");
  }, STOP_GRACE_MS).unref?.();
}

/** Idempotent: re-running a document that already published (or was rejected) does nothing. */
async function processDocument({ documentId }: { documentId: string }, job: { id: string }) {
  const doc = (await sql`select * from documents where id = ${documentId}`)[0];
  if (!doc || doc.status === "published" || doc.status === "exception" || doc.awaiting_audit) return;
  const correlationId = job.id;
  let stage: Stage = "received";   // the last stage reached, so a failure says where it happened
  const tStart = performance.now(); let tLast = tStart;
  const st = (next: Stage, extra: { scan_result?: string; source_text?: string } = {}) => { const now = performance.now(); record("process.before_" + next, now - tLast); tLast = now; stage = next; return setStage(doc.id, next, extra); };   // time spent in the previous step, by what came next
  // However long the document, all of its reading has one time limit, from the moment it is taken: fetching it, counting its pages, making it smaller and
  // reading it (the page count and the optimiser once ran before the limit started, with none of their own). When the limit is reached the reading is told
  // to stop, and stops at its next page, and only this document fails. The process carries on: it once exited, and every other document it was reading lost
  // an attempt and could end up failed for nothing (code review, 16 Nov 2026, B-M3).
  const limit = new AbortController();
  const overTime = setTimeout(() => limit.abort(), config.processMaxSeconds * 1000); overTime.unref?.();
  const timedOut = new Promise<never>((_, rej) => limit.signal.addEventListener("abort", () => rej(new OverTime()), { once: true }));
  timedOut.catch(() => {});
  try {
    const reading = (async () => {
      await st("security");
      const bytes = await getObject(doc.storage_path);
      const type = sniff(bytes);
      if (!type) await reject(doc, "FILE_TYPE", `The file is not a supported document (${describeFormats()}).`, correlationId, stage);
      if (type === "docx" || type === "odt") {
        if (!unpacksSafely(bytes)) await reject(doc, "FILE_EXPANDS_TOO_FAR", "This file unpacks to far more data than a document should, so it was not opened.", correlationId, stage);
      }
      // A CV has no page limit (owner rule, 2026-11-02): every CV is read in full, however long. Its page count is recorded for the audit trail only.
      let pageNote = "";
      if (doc.kind === "cv") {
        const pc = await countPages(bytes, type!);
        pageNote = pc.state === "unverified" ? "; page count not verified" : `; ${pc.pages} page${pc.pages === 1 ? "" : "s"} (counted from the ${pc.source})`;
      }
      stopIfAsked(limit.signal);
      // No malware scanner is wired in yet; record that honestly rather than claiming a clean scan.
      // Large files are made smaller for speed: scans are re-encoded, and text documents have only their pictures shrunk. The smaller
      // file replaces the stored one only if the words still read exactly the same (or, for scans, agree on OCR).
      let bytesToRead = bytes, optimisedNote = "";
      if (bytes.length > config.optimiseAboveBytes && isOptimisable(type!)) { // photos and other formats are kept exactly as received; only the size limit below applies to them
        try {
          await st("optimising");
          const smaller = type === "pdf" ? ((await isScanned(bytes)) ? await optimiseScannedPdf(bytes, { signal: limit.signal }) : await optimiseTextPdf(bytes)) : await optimiseDocx(bytes);
          stopIfAsked(limit.signal);
          if (smaller) {
            await putObject(doc.storage_path, smaller.bytes, contentTypeOf(type!));
            await sql`update documents set size = ${smaller.after}, original_size = ${smaller.before}, optimised = true, updated_at = now() where id = ${doc.id}`;
            bytesToRead = smaller.bytes;
            optimisedNote = `file made smaller: ${(smaller.before / 1048576).toFixed(1)} MB to ${(smaller.after / 1048576).toFixed(1)} MB, text agreement ${Math.round(smaller.agreement * 100)}%`;
          }
        } catch (e) { if (e instanceof Stopped || e instanceof NoLongerProcessing) throw e; console.error(JSON.stringify({ level: "warn", event: "optimise.failed", documentId: doc.id, error: String((e as Error)?.message ?? e) })); } // never block a document because the optimiser failed
      }
      const org = (await getSettings(doc.org_id)).settings;
      return prepareDocument(bytesToRead, {
        kind: doc.kind === "cv" ? "cv" : "jd", org, asOf: new Date(doc.created_at), fieldsByAi: doc.kind === "cv" && aiReadsCvs(), signal: limit.signal,
        onStage: (stage, text) => stage === "reading" ? st("reading", { scan_result: "type verified; malware scan NOT performed (no scanner configured)" + pageNote + (optimisedNote ? "; " + optimisedNote : "") }) : st("extracting", { source_text: text }),
        // the same person under a different file: warn, never merge (a person decides)
        // Where Claude reads the CV, the duplicate check runs on its reading of the name and e-mail, after it (aiRead.ts), not on the word rules' here.
        beforeReview: async (record) => { if (doc.kind !== "cv" || aiReadsCvs()) return; const dups = await findDuplicates(doc.org_id, record).catch(() => []); const note = duplicateNotice(dups); if (note) return { issue: note, meta: { possibleDuplicates: dups } }; },
      });
    })();
    let prepared: Awaited<typeof reading>;
    try { prepared = await Promise.race([reading, timedOut]); }
    catch (e) {
      if (!(e instanceof OverTime)) throw e;
      const code = "READING_TIMED_OUT", message = `This document took longer than ${Math.round(config.processMaxSeconds / 60)} minutes to read, so it was stopped. Nothing was added. A person can look at the original.`;
      await reject(doc, code, message, correlationId, stage).catch(() => {});
      watchStoppedReading(reading, doc.id);
      return;
    } finally { clearTimeout(overTime); }
    if (!prepared.ok) await reject(doc, prepared.code, prepared.message, correlationId, stage);
    const { record: rec, confidence, meta, review } = prepared as Prepared;

    const draft = { record: rec, confidence, meta, review };
    // A job is read by the AI alone (aiJobFields.ts, owner 10 Nov 2026); where no AI is set up it is refused with that reason, never read by word rules.
    if (doc.kind !== "cv") {
      if (!(await sendJobToAi(doc.org_id, doc.id, draft))) await reject(doc, "AI_NOT_SET_UP", "Job descriptions are read by the AI, which is not set up on this platform, so this job could not be added.", correlationId, stage);
      record("process.total", performance.now() - tStart); return;
    }
    // Where the AI is set up, every CV is read by Claude alone before it reaches a panel (aiRead.ts, cvReader.ts). Until then the draft waits on its own
    // document row: no panel, search or match can see it. Only where no AI is set up at all is the built-in reader's own reading published.
    if (await sendToAi(doc.org_id, doc.id, draft)) { record("process.total", performance.now() - tStart); return; }
    await publishDraft(doc, draft, correlationId);
    record("process.reading_to_published", performance.now() - tLast); const tFin = performance.now();
    await finishBatchOf(doc.id);   // the document has an end state: the batch may now be able to close and release its slots
    record("process.finish_batch", performance.now() - tFin); record("process.total", performance.now() - tStart);
  } catch (e) {
    if (e instanceof Rejected || e instanceof NoLongerProcessing) return; // a business rejection is final, not retried; a document cancelled or finished meanwhile is left as it is
    // Anything else is retried by the queue: record it now, as temporary trouble, with the stage and attempt, so repeats can be counted before the retries run out.
    await recordOccurrence({ orgId: doc.org_id, correlationId, component: "pipeline", stage, code: "UNEXPECTED_ERROR", documentId: doc.id, batchId: doc.batch_id, userId: doc.created_by, attempt: (job as any).attempts, message: (e as Error)?.message });
    throw e; // anything else (AI timeout, network blip) is retried by the queue
  }
}

export function registerPipeline() {
  registerHandler("process-document", processDocument);
  registerAiReading(async (doc, draft, correlationId) => { await publishDraft(doc, draft, correlationId, true); });
  registerJobFieldReading(async (doc, draft, correlationId) => { await publishDraft(doc, draft, correlationId, true); });
  registerHandler("process-document:failed", async ({ documentId }, job) => {
    const d = (await sql`select org_id, batch_id, created_by, stage from documents where id = ${documentId}`)[0];
    // The retries are used up and the cause is unknown: from here it is a suspected defect (never a confirmed one: only a person confirms).
    if (d) await recordOccurrence({ orgId: d.org_id, correlationId: job.id, component: "pipeline", stage: d.stage, code: "PROCESSING_FAILED", final: true, documentId, batchId: d.batch_id, userId: d.created_by, message: "Processing failed after the permitted attempts." });
    await sql`update documents set status = 'exception', error_code = 'PROCESSING_FAILED', error_message = 'Processing failed after several attempts. It can be retried by an administrator.', updated_at = now() where id = ${documentId} and status = 'processing'`;
    await finishBatchOf(documentId);
  });
}
