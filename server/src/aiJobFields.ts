// A job description through Claude, in the pipeline (owner, 10 Nov 2026: jobs are read by the AI alone; jobReader.ts says how). The document reader opens
// the file and takes its text (pipeline.ts); the draft then waits on its document row, out of every panel, while the AI worker asks Claude. A reading that
// cannot be had after the queue's attempts leaves the document as "not read by the AI", with the reason and Retry: never a job built from guesses.
// Read again works the same way: the original's text through today's reader, a recruiter's own corrections kept, every change audited.
import { aiConfigured } from "./ai/claude";
import { audit as dbAudit, sql } from "./db";
import { readJobDocument, TOO_LONG_MESSAGE, type JobReading } from "./jobReader";
import { enqueueIn, kick, registerHandler } from "./queue";
import { reviewJob } from "./review";
import { sameJson } from "./sameJson";
import { getSettings } from "./settings";
import { finishBatchOf } from "./batches";

type Draft = { record: any; confidence: number; meta: any; review: any };
type Publish = (doc: any, draft: Draft, correlationId: string) => Promise<void>;
const NOT_READ_MESSAGE = "The AI could not read this job description, so it was not added. Use Retry to ask again.";

/** What a reading sets on a job: the panel's fields and how the reading went. Workflow fields (status, notes), the posted date and the review are not readings. */
const JOB_READ_FIELDS = ["title", "company", "location", "department", "group", "type", "workArrangement", "remuneration", "reportsTo", "keyFacts", "description", "summarySource",
  "requirements", "requirementGroups", "preferredRequirements", "preferredGroups", "responsibilities", "responsibilityGroups", "skills", "competencies", "extras"] as const;
export const jobRecordOf = (r: JobReading) => ({ ...Object.fromEntries(JOB_READ_FIELDS.map((k) => [k, (r as any)[k]])), aiReading: r.aiReading });
/** How sure the reading is: every value checked against the document, so it is high unless values had to be dropped or lines were left unlabelled. */
const confidenceOf = (r: JobReading) => Math.max(0.5, 0.95 - 0.05 * r.aiReading.dropped - 0.02 * r.aiReading.unlabelled);

/** Queues the job's reading. False only where no AI is set up at all: a job is never read by word rules instead. */
export async function sendJobToAi(orgId: string, documentId: string, draft: Draft): Promise<boolean> {
  if (!aiConfigured()) return false;
  // Marked and queued together, or neither (see enqueueIn): a document is never left waiting for a reading nobody asked for.
  await sql.begin(async (q: any) => {
    await q`update documents set stage = 'auditing', awaiting_audit = ${sql.json(draft as any)}, updated_at = now() where id = ${documentId} and status = 'processing'`;
    await enqueueIn(q, orgId, "model-job-fields", { documentId }, 3);
  });
  kick();
  return true;
}

export function registerJobFieldReading(publish: Publish) {
  registerHandler("model-job-fields", async ({ documentId }: { documentId: string }, job) => {
    const doc = (await sql`select * from documents where id = ${documentId}`)[0];
    if (!doc || doc.status !== "processing" || !doc.awaiting_audit) return;
    const text = String(doc.source_text ?? ""), read = await readJobDocument(text);
    // Too long for the AI: asking again would be paid for and fail the same way, so the document says so now, with the reason (code review, 16 Nov 2026, B-M9).
    if (!read.ok && read.final) { await notRead(documentId, "AI_TOO_LONG", TOO_LONG_MESSAGE(read.lines ?? 0), job.id); return; }
    if (!read.ok) throw new Error(read.why);   // Claude busy or unreachable: the queue asks again shortly; past its attempts the document says it was not read
    const draft: Draft = doc.awaiting_audit, settings = (await getSettings(doc.org_id)).settings;
    draft.record = { ...draft.record, ...jobRecordOf(read.reading) };
    draft.confidence = confidenceOf(read.reading);
    draft.meta = { ...(draft.meta ?? {}), method: "ai", model: read.reading.aiReading.model, readerVersion: read.reading.aiReading.version };
    draft.review = reviewJob(draft.record, draft.confidence, draft.meta, text.length, settings.review);
    await publish(doc, draft, job.id);
  });
  registerHandler("model-job-fields:failed", async ({ documentId }: { documentId: string }, job) => { await notRead(documentId, "AI_NOT_READ", NOT_READ_MESSAGE, job.id); });
  // A job read again from its original: the same reader, a recruiter's corrections kept, the earlier reading kept beside the record.
  registerHandler("model-job-read-again", async ({ jobId, orgId, actorId, correlationId }: { jobId: string; orgId: string; actorId: string; correlationId?: string }) => {
    const [row] = await sql`select d.source_text from jobs j join documents d on d.id = j.document_id and d.org_id = j.org_id where j.id = ${jobId} and j.org_id = ${orgId}`;
    if (!row) return;
    const read = await readJobDocument(String(row.source_text ?? ""));
    if (!read.ok && read.final) { await rereadFailed(jobId, orgId); return; }   // too long for the AI: asking again cannot succeed (code review, 16 Nov 2026, B-M9)
    if (!read.ok) throw new Error(read.why);
    const corrected = new Set((await sql`select distinct jsonb_object_keys(detail -> 'changes') as k from audit_events where org_id = ${orgId} and entity_type = 'job' and entity_id = ${jobId} and action = 'job.edited'`).map((r: any) => r.k as string));
    const settings = (await getSettings(orgId)).settings, fresh: any = jobRecordOf(read.reading);
    await sql.begin(async (q: any) => {
      const [cur] = await q`select data from jobs where id = ${jobId} and org_id = ${orgId} for update`;
      if (!cur) return;
      const current = cur.data, next: any = { ...current }, changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of JOB_READ_FIELDS) {
        if (corrected.has(k)) continue;   // the recruiter's correction stands
        const to = fresh[k] ?? (Array.isArray(current[k]) ? [] : "");
        if (sameJson(current[k] ?? "", to)) continue;
        changes[k] = { from: current[k] ?? null, to }; next[k] = to;
      }
      next.aiReading = fresh.aiReading; next.extractionConfidence = confidenceOf(read.reading);
      next.extraction = { ...(current.extraction ?? {}), method: "ai", model: read.reading.aiReading.model, readerVersion: read.reading.aiReading.version };
      next.review = reviewJob(next, next.extractionConfidence, next.extraction, String(row.source_text ?? "").length, settings.review); next.reviewState = next.review.state;
      next.previousReadings = [...(current.previousReadings ?? []), { at: new Date().toISOString(), readerVersion: current.aiReading?.version ?? current.extraction?.parserVersion ?? null, fields: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.from])) }].slice(-3);
      delete next.rereading; delete next.rereadFailed;
      await q`update jobs set data = ${q.json(next)}, version = version + 1, updated_at = now() where id = ${jobId} and org_id = ${orgId}`;
      await dbAudit(q, orgId, actorId, "job.read_again", "job", jobId, { changes, kept: [...corrected].filter((k) => (JOB_READ_FIELDS as readonly string[]).includes(k)), readerVersion: read.reading.aiReading.version }, correlationId);
    });
  });
  registerHandler("model-job-read-again:failed", async ({ jobId, orgId }: { jobId: string; orgId: string }) => { await rereadFailed(jobId, orgId); });
}

/** The job was not read by the AI: the document says why, is out of the batch, and the reason is audited. Only a document still being read is changed. */
async function notRead(documentId: string, code: "AI_NOT_READ" | "AI_TOO_LONG", message: string, correlationId: string) {
  const [doc] = await sql`update documents set status = 'exception', error_code = ${code}, error_message = ${message}, awaiting_audit = null, updated_at = now()
    where id = ${documentId} and status = 'processing' returning id, org_id`;
  if (!doc) return;
  await dbAudit(sql, doc.org_id, null, "document.exception", "document", doc.id, { code }, correlationId);
  await finishBatchOf(documentId);
}
/** A reading again that could not be had leaves the job as it was, unlocked, and says so on the record. */
const rereadFailed = (jobId: string, orgId: string) => sql`update jobs set data = (data - 'rereading') || jsonb_build_object('rereadFailed', ${new Date().toISOString()}::text) where id = ${jobId} and org_id = ${orgId}`;
