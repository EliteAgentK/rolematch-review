// Since 10 Nov 2026 a CV is read by Claude alone, as job descriptions are (cvReader.ts; owner: "take the parser out of this"): the file is turned into text
// (pipeline.ts), the draft waits on its document row, out of every panel, search and match, and this job asks Claude. The record is built from Claude's
// checked reading and nothing else; there is no parser reading beside it and none to fall back on. A CV Claude cannot read after its attempts is not
// added: it says "The AI could not read this CV" and can be retried (AI_NOT_READ), exactly as a job description does. Earlier notes, kept for the history:
// Claude read every CV with the parser before it reached a panel (owner, 8 Nov 2026: "no more Ollama"; Haiku 5.5 in its "careful" setting, measured on the
// 30 real CVs: roles fully right 85.7% against 53.1% for the parser alone, median 10.7 s, about R0.04 a CV). The parser and OCR read the document first
// (pipeline.ts); the draft waits on its document row, out of every panel, search and match, while this job asks Claude. Code then checks every value
// Claude gives against the document (hybridReader.ts) and the two readings become one record (reconcile.ts); the parser's own reading is kept beside it.
// A CV waits until Claude has read it (owner, 9 Nov 2026: nothing reaches a panel until the AI is done; a 60-second cut-off had published the parser's reading
// for 6 of 16 real CVs while their paid answers arrived and were thrown away). Only when Claude is switched off, over budget or fails twice is the parser's
// reading published, and the record says why.
// Runs in the AI worker (WORKER_JOBS=model), inside the document's own portal, so every question is billed to that portal (ai/claude.ts).
import { aiConfigured, READ_MODEL } from "./ai/claude";
import { candidateDepartment, CANDIDATE_DEPARTMENT_VERSION, jobDepartment } from "./department";
import { askAi } from "./hybridReader";
import { CV_READER_VERSION, readCv } from "./cvReader";
import { duplicateNotice, findDuplicates } from "./duplicates";
import { finishBatchOf } from "./batches";
import { reviewCandidate } from "./review";
import { getSettings } from "./settings";
import { addressedToSoftware } from "./modelReader";
import { config } from "./config";
import { audit as dbAudit, forPortal, platformSql, sql } from "./db";
import { enqueue, enqueueIn, kick, registerHandler } from "./queue";

type Draft = { record: any; confidence: number; meta: any; review: any };
type Publish = (doc: any, draft: Draft, correlationId: string) => Promise<void>;
const CV_NOT_READ_MESSAGE = "The AI could not read this CV, so it was not added. Use Retry to ask again.";
/** Whether CVs are Claude's to read here: the AI is set up and its reading switched on. Otherwise the built-in reader's own reading is all there is. */
export const aiReadsCvs = () => config.ai.reading && aiConfigured();

/** Queues the CV's reading by Claude. False only where no AI is set up: then the built-in reader's reading is published, and says so. A CV is never
 *  turned away for the queue's length: the portal's upload slots already bound how much can wait, and there is no other reading to publish instead. */
export async function sendToAi(orgId: string, documentId: string, draft: Draft): Promise<boolean> {
  if (!aiReadsCvs()) return false;
  (draft.meta ??= {}).aiQueuedAt = new Date().toISOString();
  // Marked and queued together, or neither (see enqueueIn): a document is never left waiting for a reading nobody asked for.
  await sql.begin(async (q) => {
    await q`update documents set stage = 'auditing', awaiting_audit = ${sql.json(draft as any)}, updated_at = now() where id = ${documentId} and status = 'processing'`;
    await enqueueIn(q, orgId, "model-read", { documentId }, 3);
  });
  kick();
  return true;
}
/** How sure the reading is: every value is checked against the CV, so it is high unless the person could not be named or reached, no work was found, or
 *  the lines could not be labelled. A measure of the evidence read, never of the person. */
const confidenceOf = (rec: any, report: { labelled: boolean; unlabelled: number }) => Math.max(0.4, 0.95 - (String(rec.name ?? "").trim() ? 0 : 0.2) - (String(rec.email ?? "").trim() || String(rec.phone ?? "").trim() ? 0 : 0.1) - ((rec.workHistory ?? []).length ? 0 : 0.15) - (report.labelled ? 0 : 0.05) - Math.min(0.1, 0.01 * report.unlabelled));

export function registerAiReading(publish: Publish) {
  registerHandler("model-read", async ({ documentId }: { documentId: string }, job) => {
    const doc = (await sql`select * from documents where id = ${documentId}`)[0];
    if (!doc || doc.status !== "processing" || !doc.awaiting_audit) return;
    const draft: Draft = doc.awaiting_audit, text = String(doc.source_text ?? "");
    const r = await readCv(text, { timeoutMs: config.ai.readSeconds * 1000, pageStarts: draft.meta?.pageStarts, asOf: new Date(doc.created_at) });
    // No usable reading is a failure, asked again by the queue; past its attempts the CV says it was not read (model-read:failed). Never a guess instead.
    if (!r.ok) throw new Error(`The AI gave no usable reading (${r.why}).`);
    const settings = (await getSettings(doc.org_id)).settings, rec = r.record, meta: any = { ...(draft.meta ?? {}), method: "ai", model: READ_MODEL, readerVersion: CV_READER_VERSION, droppedUnsupported: [] };
    meta.warnings = (meta.warnings ?? []).filter((w: string) => !w.startsWith("Read by the built-in"));
    delete meta.fields;   // the word rules' own report on each field: not this reading's, so it says nothing about it
    // The same person under another file: found from Claude's reading of the name and e-mail, said for a person to decide, never merged.
    const dups = await findDuplicates(doc.org_id, rec).catch(() => []), note = duplicateNotice(dups);
    meta.readingIssues = [...(meta.readingIssues ?? []).filter((i: string) => !/already in|same person|duplicate/i.test(i)), ...(note ? [note] : [])];
    if (note) meta.possibleDuplicates = dups; else delete meta.possibleDuplicates;
    if (text.split("\n").some(addressedToSoftware)) meta.addressedToSoftware = true;
    const confidence = confidenceOf(rec, r.report);
    await publish(doc, { record: rec, confidence, meta, review: reviewCandidate(rec, confidence, meta, text.length, settings.review) }, job.id);
  });
  // A CV read again on a person's request: the earlier reading is kept with the record, roles a person has settled stay settled, the version moves on, and any match on the earlier version says it is out of date.
  registerHandler("model-read-again", async ({ candidateId, orgId, actorId, correlationId }: { candidateId: string; orgId: string; actorId: string; correlationId?: string }) => {
    const row = (await sql`select c.data, d.source_text, d.created_at from candidates c join documents d on d.id = c.document_id and d.org_id = c.org_id where c.id = ${candidateId} and c.org_id = ${orgId}`)[0];
    if (!row) return;
    // Dated as the first reading was: "Present", years of experience and whether a certificate is still valid are as of the day the CV was uploaded, never the
    // day Read again was pressed, so a re-read months later does not add a year or expire a certificate with nothing in the document changed (code review, 16 Nov 2026, B-M10).
    const text = String(row.source_text ?? ""), r = await readCv(text, { timeoutMs: config.ai.readSeconds * 1000, pageStarts: (row.data.extraction as any)?.pageStarts, asOf: new Date(row.created_at) });
    if (!r.ok) throw new Error(`the AI gave no usable reading: ${r.why}`);
    // What a recruiter corrected stays as they set it (the audit trail says which fields); a role a person settled stays settled.
    const corrected = new Set((await sql`select distinct jsonb_object_keys(detail -> 'changes') as k from audit_events where org_id = ${orgId} and entity_type = 'candidate' and entity_id = ${candidateId} and action = 'candidate.edited'`).map((x: any) => String(x.k)));
    const settled = (row.data.workHistory ?? []).filter((x: any) => x.reviewed), READ = ["name", "email", "phone", "location", "role", "workHistory", "education", "certifications", "skills", "languages", "summary", "projects", "worthNoting", "profile", "group", "displayNames", "experience", "submission", "reading"] as const;
    await sql.begin(async (q) => {
      const current = (await q`select data from candidates where id = ${candidateId} and org_id = ${orgId} for update`)[0]?.data; if (!current) return;
      const merged: any = { ...current };
      for (const k of READ) { if (corrected.has(k)) continue; const v = (r.record as any)[k]; if (v === undefined || ((k === "name" || k === "email" || k === "phone") && !String(v).trim())) continue; merged[k] = v; }
      if (!corrected.has("workHistory")) merged.workHistory = [...settled, ...(merged.workHistory ?? []).filter((x: any) => !settled.some((y: any) => y.position === x.position && String(y.startDate).slice(-4) === String(x.startDate).slice(-4)))];
      merged.previousReadings = [...(current.previousReadings ?? []), { at: new Date().toISOString(), workHistory: current.workHistory, education: current.education, reading: current.reading }].slice(-5);
      merged.aiReading = r.report;
      delete merged.rereading;   // read: the card unlocks
      await q`update candidates set data = ${q.json(merged)}, version = version + 1, updated_at = now() where id = ${candidateId} and org_id = ${orgId}`;
      await dbAudit(q, orgId, actorId, "candidate.read_again", "candidate", candidateId, { readerVersion: CV_READER_VERSION, model: READ_MODEL, roles: merged.workHistory.length, kept: [...corrected], employment: merged.reading?.employment?.state }, correlationId);
    });
  });
  // A reading again that failed on every attempt leaves the record as it was, unlocked, and says so on the record.
  registerHandler("model-read-again:failed", async ({ candidateId, orgId }: { candidateId: string; orgId: string }) => {
    await sql`update candidates set data = (data - 'rereading') || jsonb_build_object('rereadFailed', ${new Date().toISOString()}::text) where id = ${candidateId} and org_id = ${orgId}`;
  });
  // Past its attempts the CV is not added, and says so with Retry: there is no other reading to show in its place (owner, 10 Nov 2026).
  registerHandler("model-read:failed", async ({ documentId }: { documentId: string }, job) => {
    const [doc] = await sql`update documents set status = 'exception', error_code = 'AI_NOT_READ', error_message = ${CV_NOT_READ_MESSAGE}, awaiting_audit = null, updated_at = now()
      where id = ${documentId} and status = 'processing' returning id, org_id`;
    if (!doc) return;
    await dbAudit(sql, doc.org_id, null, "document.exception", "document", doc.id, { code: "AI_NOT_READ" }, job.id);
    await finishBatchOf(documentId);
  });
  // Records read before departments existed (10 Nov 2026), placed in one as part of their reading (department.ts), from what each record already holds,
  // never the document again: a candidate from its headline and latest jobs, a job from its title, its own unit and its company. Only a record still
  // without a department is changed, and one that could not be placed is marked as tried, so nothing is ever asked twice. One audit line per job that
  // changed a record; a job that found its records already placed writes none.
  registerHandler("model-group", async ({ orgId, kind, ids }: { orgId: string; kind: "candidate" | "job"; ids: string[] }) => {
    const table = kind === "job" ? sql`jobs` : sql`candidates`, ms = config.ai.readSeconds * 1000;
    const rows = await sql`select id, data from ${table} where org_id = ${orgId} and id = any(${ids}) and coalesce(data->>'group', '') = '' and data->>'groupTried' is null`;
    const placed: Record<string, number> = {}; let tried = 0;
    for (const r of rows) {
      const ask = askAi([String(r.data.name ?? "")].filter(Boolean));
      const d = kind === "job" ? await jobDepartment(ask, String(r.data.title ?? ""), String(r.data.department ?? ""), String(r.data.company ?? ""), ms)
        : await candidateDepartment(ask, String(r.data.role ?? ""), r.data.workHistory ?? [], ms);
      const [u] = d.group
        ? await sql`update ${table} set data = jsonb_set(data, '{group}', to_jsonb(${d.group}::text)) where id = ${r.id} and org_id = ${orgId} and coalesce(data->>'group', '') = '' returning id`
        : await sql`update ${table} set data = jsonb_set(data, '{groupTried}', to_jsonb(${CANDIDATE_DEPARTMENT_VERSION}::text)) where id = ${r.id} and org_id = ${orgId} returning id`;
      if (u && d.group) placed[d.group] = (placed[d.group] ?? 0) + 1; else if (u) tried++;
    }
    if (tried || Object.keys(placed).length) await dbAudit(sql, orgId, null, `${kind}.grouped`, kind, null, { version: CANDIDATE_DEPARTMENT_VERSION, asked: rows.length, placed, notPlaced: tried });
  });
}

/** Finds records read before departments existed and queues them for placing, a portal at a time, 25 records a job, inside that portal so each question
 *  is billed to it. Runs where AI reading is on, in the process that reads with the AI, shortly after start and then every 10 minutes for anything
 *  missed; a portal whose placing is still queued or running is left until it is done. Returns how many records were queued. */
async function queueMissingDepartments(limit = 2000): Promise<number> {
  if (!config.ai.reading || !aiConfigured()) return 0;
  // One sweep at a time across every server and worker: a second one waits here, then sees the first one's jobs as busy and queues nothing twice.
  return platformSql.begin(async (lock) => { await lock`select pg_advisory_xact_lock(hashtext('rolematch.departments.sweep'))`; return sweepDepartments(limit); }) as Promise<number>;
}
async function sweepDepartments(limit: number): Promise<number> {
  const rows = await platformSql`select kind, org_id, portal_id, id from (
      select 'candidate' as kind, org_id, portal_id, id, created_at from candidates where coalesce(data->>'group', '') = '' and data->>'groupTried' is null
      union all
      select 'job', org_id, portal_id, id, created_at from jobs where coalesce(data->>'group', '') = '' and data->>'groupTried' is null) x
    where portal_id is not null order by created_at desc limit ${limit}`;
  const busy = new Set((await platformSql`select distinct portal_id from queue where type = 'model-group' and status in ('queued', 'running')`).map((r: any) => String(r.portal_id)));
  const groups = new Map<string, { org: string; portal: string; kind: "candidate" | "job"; ids: string[] }>();
  for (const r of rows as any[]) {
    if (busy.has(String(r.portal_id))) continue;
    const key = `${r.portal_id}|${r.kind}`, g = groups.get(key) ?? { org: String(r.org_id), portal: String(r.portal_id), kind: r.kind, ids: [] as string[] };
    g.ids.push(String(r.id)); groups.set(key, g);
  }
  let queued = 0;
  for (const g of groups.values()) for (let i = 0; i < g.ids.length; i += 25) {
    const ids = g.ids.slice(i, i + 25);
    await forPortal(g.org, g.portal, () => enqueue(g.org, "model-group", { orgId: g.org, kind: g.kind, ids }, 2)); queued += ids.length;
  }
  if (queued) console.log(JSON.stringify({ level: "info", event: "departments.queued", records: queued, portals: new Set([...groups.values()].map((g) => g.portal)).size }));
  return queued;
}
export function startDepartmentSweep() {
  const every = Number(process.env.DEPARTMENT_SWEEP_MS ?? 600_000), run = () => void queueMissingDepartments().catch((e) => console.error(JSON.stringify({ level: "warn", event: "departments.sweep_failed", reason: String(e?.message ?? e).slice(0, 160) })));
  setTimeout(() => { run(); setInterval(run, every).unref?.(); }, Math.min(30_000, every)).unref?.();
}
