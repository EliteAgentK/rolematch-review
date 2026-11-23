// Upload batches and shared portal capacity.
//
// A portal has a fixed number of document slots (PORTAL_SLOTS, 500 to start), shared by every member, every document type and every batch. A batch RESERVES
// its slots, all at once, before any file is accepted (all-or-nothing); a single upload is a batch of one. The reservation is held until the whole batch
// closes and is then released exactly once: individual documents finishing, or their panels appearing, release nothing. Counts are worked out from the
// documents' own states every time (never stored), so they cannot disagree with the board.
//
// Capacity is not concurrency: the slots are a ceiling on admitted work, while the number of documents actually being read at once is bounded separately by
// the queue (WORKER_CONCURRENCY, PER_ORG_CONCURRENCY). Matching uses no slots at all.
import { portalCached } from "./portalCache";
import { audit, currentPortal, newId, platformSql, sql } from "./db";
import { config } from "./config";
import { enqueue } from "./queue";
import { LimitError, limitsOf, usageOf } from "./limits";
import { isUuid } from "./store";
import { estimate } from "./eta";

/** The failures that asking again can fix: a reading that failed on our side, and a job the AI could not read (busy, out of credit). Every other refusal is
 *  about the document itself and needs a new copy. The one list for the retry, the batch report and the upload panel (which reads `retryable`). */
const RETRYABLE = ["PROCESSING_FAILED", "AI_NOT_READ", "STALLED"] as const;   // STALLED: documentWatch.ts gave up restarting it
const canRetry = (code: string | null | undefined) => (RETRYABLE as readonly string[]).includes(code ?? "");

export class BatchError extends Error { constructor(public code: string, message: string, public status = 400, public extra: Record<string, unknown> = {}) { super(message); } }
export interface Refusal { fileName: string; code: string; message: string; reference?: string }
const MAX_REFUSALS = 100;      // the list is for the person to read; the count beyond it is still kept
export const CANCELLED = "CANCELLED";
/** Blocked by a check before reading: the document is not read, no record is made, and it is not a failure of the system.
 *  Nothing produces these since the CV page limit was removed (2026-11-02); they stay so batches recorded before then still report correctly. */
export const BLOCKED_CODES = ["PAGE_LIMIT", "PAGES_UNVERIFIED"];
type Q = typeof sql;
export interface Actor { userId: string; email: string; isAdmin: boolean; portalId: string }

// ---------------------------------------------------------------- capacity
export interface Capacity { total: number; reserved: number; available: number; cvReserved: number; jdReserved: number; batches: { id: string; kind: "cv" | "jd"; reserved: number; submittedBy: string; createdAt: string; state: "sending" | "processing" }[] }
const reservedNow = async (q: Q, portalId: string) => (await q`select coalesce(sum(reserved_slots), 0)::int as reserved, coalesce(sum(reserved_slots) filter (where kind = 'cv'), 0)::int as cv, coalesce(sum(reserved_slots) filter (where kind = 'jd'), 0)::int as jd from upload_batches where portal_id = ${portalId} and reservation_state = 'held'`)[0];

/** The portal's live allowance, as the server sees it right now. Every member sees the same figures; the browser must still be refused by the server at admission. */
export async function capacityOf(portalId: string): Promise<Capacity> {
  const [r, list] = await Promise.all([reservedNow(sql, portalId), sql`select id, kind, reserved_slots, submitted_by_email, created_at, declared_files, duplicate_files, jsonb_array_length(refusals) as refused, (select count(*) from documents d where d.batch_id = b.id)::int as received from upload_batches b where portal_id = ${portalId} and reservation_state = 'held' order by created_at limit 100`]);
  const total = config.portalSlots;
  return { total, reserved: r.reserved, available: Math.max(0, total - r.reserved), cvReserved: r.cv, jdReserved: r.jd,
    batches: list.map((b: any) => ({ id: b.id, kind: b.kind, reserved: b.reserved_slots, submittedBy: b.submitted_by_email, createdAt: new Date(b.created_at).toISOString(), state: b.received + b.duplicate_files + b.refused >= b.declared_files ? "processing" as const : "sending" as const })) };
}

/** Admit or refuse the whole batch before any file is sent: size limits, the portal's own allowances, then the portal's shared slots, atomically.
 * Without a request key the reservation is ONE statement ("add n to the portal's reserved count if it still fits, and only then create the batch"), so it needs
 * no lock and holds no connection; with a request key (the browser's own submissions) a repeat of the same submission returns the first reservation. */
export async function createBatch(a: Actor & { orgId: string }, input: { kind: unknown; files: unknown; bytes: unknown; skipped?: unknown; requestKey?: unknown; parentBatchId?: string; checkedQuota?: boolean }) {
  const { kind } = input, files = Number(input.files), bytes = Number(input.bytes);
  if (kind !== "cv" && kind !== "jd") throw new BatchError("VAL-001", "Say whether the batch holds CVs ('cv') or job descriptions ('jd').");
  if (!Number.isInteger(files) || files < 1) throw new BatchError("VAL-001", "A batch holds at least one file.");
  if (!Number.isFinite(bytes) || bytes < 0) throw new BatchError("VAL-001", "The total size of the batch is needed.");
  if (files > config.maxBatchFiles) throw new BatchError("BATCH-001", `A batch can hold at most ${config.maxBatchFiles} files. Split it into smaller batches.`, 413);
  if (bytes > config.maxBatchBytes) throw new BatchError("BATCH-001", `A batch can hold at most ${Math.floor(config.maxBatchBytes / 1048576)} MB in total. Split it into smaller batches.`, 413);
  const requestKey = input.requestKey === undefined || input.requestKey === null ? null : String(input.requestKey).slice(0, 100);
  if (!input.checkedQuota) {   // a single upload has just been checked against the same allowances by its own route
    const [u, l] = await Promise.all([usageOf(a.orgId), limitsOf(a.orgId)]);
    if (u.documentsToday + files > l.documentsPerDay) throw new LimitError("QUOTA-001", `This batch would take this portal past today's limit of ${l.documentsPerDay} uploads (${u.documentsToday} used). Send fewer files, or wait for the allowance to reset.`);
    if (u.storageBytes + bytes > l.storageBytes) throw new LimitError("QUOTA-002", `This batch would fill the storage allowance of ${l.storageMb} MB.`);
  }
  // Files the browser left out before sending (unsupported, empty, too large): kept so the report accounts for every file the person chose.
  const skipped = (Array.isArray(input.skipped) ? input.skipped : []).slice(0, 100).map((x: any) => ({ fileName: String(x?.fileName ?? "").slice(0, 200), reason: String(x?.reason ?? "").slice(0, 60) }));
  const id = newId(), ceiling = config.portalSlots;
  const full = async () => {
    const r = (await sql`select reserved from portal_capacity where portal_id = ${a.portalId}`)[0];
    if (!r) { await sql`insert into portal_capacity (portal_id, org_id) values (${a.portalId}, ${a.orgId}) on conflict do nothing`; return null; }   // an older portal without its counter: made now, then tried again
    const available = Math.max(0, ceiling - r.reserved);
    return new BatchError("CAPACITY-001", `This portal has ${available} of ${ceiling} upload slots free and this selection needs ${files}. Choose fewer files, or try again when another batch has closed.`, 409, { available, requested: files, reserved: r.reserved, total: ceiling });
  };
  const detail = { kind, files, bytes, reserved: files, actorEmail: a.email, parentBatchId: input.parentBatchId ?? null };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!requestKey) {
      const row = (await sql`
        with cap as (update portal_capacity set reserved = reserved + ${files} where portal_id = ${a.portalId} and reserved + ${files} <= ${ceiling} returning portal_id),
        ins as (insert into upload_batches (id, org_id, created_by, kind, declared_files, declared_bytes, skipped, reserved_slots, submitted_by_email, parent_batch_id)
                select ${id}, ${a.orgId}, ${a.userId}, ${kind}, ${files}, ${bytes}, ${sql.json(skipped as any)}, ${files}, ${a.email}, ${input.parentBatchId ?? null} where exists (select 1 from cap) returning *),
        aud as (insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail) select ${newId()}, ${a.orgId}, ${a.userId}, 'batch.created', 'batch', ins.id, ${sql.json(detail as any)} from ins)
        select * from ins`)[0];
      if (row) return row;
    } else {
      // The same submission twice (a double click, a retry after an uncertain answer) is ONE reservation: the insert is the idempotency check, and the count is
      // taken in the same transaction, which is undone if the batch does not fit.
      const r: { row: any; repeat: boolean } | null = await sql.begin(async (tx): Promise<{ row: any; repeat: boolean }> => {
        const q = tx as unknown as Q;
        const ins = (await q`insert into upload_batches (id, org_id, created_by, kind, declared_files, declared_bytes, skipped, reserved_slots, submitted_by_email, request_key, parent_batch_id)
          values (${id}, ${a.orgId}, ${a.userId}, ${kind}, ${files}, ${bytes}, ${q.json(skipped as any)}, ${files}, ${a.email}, ${requestKey}, ${input.parentBatchId ?? null})
          on conflict (portal_id, created_by, request_key) where request_key is not null do nothing returning *`)[0];
        if (!ins) return { row: (await q`select * from upload_batches where portal_id = ${a.portalId} and created_by = ${a.userId} and request_key = ${requestKey}`)[0], repeat: true };
        const cap = await q`update portal_capacity set reserved = reserved + ${files} where portal_id = ${a.portalId} and reserved + ${files} <= ${ceiling} returning portal_id`;
        if (!cap.length) throw Object.assign(new Error("does not fit"), { notFit: true });   // rolls the insert back
        return { row: ins, repeat: false };
      }).catch((e) => { if (e?.notFit) return null; throw e; });
      // The key belongs to this person in this portal and to this operation (creating a batch). Reusing it for a DIFFERENT submission is a client mistake, not a repeat.
      if (r?.repeat && (r.row.kind !== kind || r.row.declared_files !== files)) throw new BatchError("IDEMPOTENCY-001", "That request key was already used for a different submission. Start a new submission (a new key); nothing was changed.", 422);
      if (r) { if (!r.repeat) await audit(sql, a.orgId, a.userId, "batch.created", "batch", r.row.id, detail); return r.row; }
    }
    const refusal = await full();
    if (refusal) throw refusal;
  }
  throw new BatchError("CAPACITY-001", "The portal's upload allowance could not be read. Try again in a moment.", 503);
}

/** The batch a file is being added to: it must be this portal's, open, the submitter's own, of the same kind, and not already full. */
export async function openBatchFor(orgId: string, userId: string, batchId: string, kind: string | null) {
  if (!isUuid(batchId)) throw new BatchError("RES-001", "Batch not found.", 404);
  const b = (await sql`select b.*, (select count(*) from documents d where d.org_id = b.org_id and d.batch_id = b.id)::int as received from upload_batches b where b.id = ${batchId} and b.org_id = ${orgId}`)[0];
  if (!b) throw new BatchError("RES-001", "Batch not found.", 404);
  if (b.created_by !== userId) throw new BatchError("BATCH-005", "Only the person who started a batch can add files to it.", 403);
  if (b.cancelled_at) throw new BatchError("BATCH-003", "This batch was cancelled. Start a new batch to add more files.", 409);
  if (b.reservation_state !== "held") throw new BatchError("BATCH-006", "This batch has closed. Start a new batch to add more files.", 409);
  if (kind && b.kind !== kind) throw new BatchError("VAL-001", `This batch holds ${b.kind === "cv" ? "CVs" : "job descriptions"}.`);
  if (b.received + b.duplicate_files + (b.refusals as unknown[]).length >= b.declared_files) throw new BatchError("BATCH-002", `This batch was opened for ${b.declared_files} files and they have all been sent.`, 409);
  // A file is arriving, so the transfer is alive. Not waited for: the lease is minutes long, so one missed refresh changes nothing.
  void sql`update upload_batches set last_activity_at = now() where id = ${batchId} and org_id = ${orgId}`.catch(() => {});
  return b;
}

export const noteDuplicate = (orgId: string, batchId: string, fileName = "") =>
  sql`update upload_batches set duplicate_files = duplicate_files + 1, duplicate_names = case when jsonb_array_length(duplicate_names) < ${MAX_REFUSALS} then duplicate_names || ${sql.json([fileName.slice(0, 200)] as any)} else duplicate_names end where id = ${batchId} and org_id = ${orgId}`;

export const noteRefusal = (orgId: string, batchId: string, r: Refusal) =>
  sql`update upload_batches set refusals = case when jsonb_array_length(refusals) < ${MAX_REFUSALS} then refusals || ${sql.json([{ fileName: r.fileName.slice(0, 200), code: r.code, message: r.message.slice(0, 300), reference: r.reference?.slice(0, 40) }] as any)} else refusals end
      where id = ${batchId} and org_id = ${orgId}`;

// ---------------------------------------------------------------- closing a batch releases its reservation, exactly once
// A batch closes when (1) no admitted document is still being processed, so nothing can publish a late result, AND (2) every admitted file is accounted for,
// or the batch was cancelled, or its transfer was abandoned (no file arrived within the lease). The update below is the ONLY place a reservation is released,
// and it is conditional on the reservation still being held, so however many events, retries, restarts or reconciliation passes call it, it releases once.
const closable = (q: Q) => q`not exists (select 1 from documents d where d.batch_id = b.id and d.status = 'processing')
  and (b.cancelled_at is not null
       or b.declared_files <= (select count(*) from documents d where d.batch_id = b.id) + b.duplicate_files + jsonb_array_length(b.refusals)
       or b.last_activity_at < now() - (${config.batchTransferLeaseSec} * interval '1 second'))`;
/** Releases the batches matched by `which` that can be closed: the state change, the portal's count going down by what the batch held, and the history entry are ONE
 * statement, and it only acts on batches still held, so a reservation is released exactly once however many events or servers ask. Returns how many were released. */
async function release(which: ReturnType<Q>): Promise<number> {
  const r = await platformSql`
    with rel as (update upload_batches b set reservation_state = 'released', released_at = now(), finished_at = now() where b.reservation_state = 'held' and ${which} and ${closable(platformSql)} returning b.id, b.org_id, b.portal_id, b.reserved_slots),
    dec as (update portal_capacity c set reserved = c.reserved - r.s from (select portal_id, sum(reserved_slots)::int as s from rel group by portal_id) r where c.portal_id = r.portal_id returning c.portal_id),
    aud as (insert into audit_events (id, org_id, portal_id, actor_id, action, entity_type, entity_id, detail) select gen_random_uuid(), org_id, portal_id, null, 'batch.finished', 'batch', id, jsonb_build_object('released', reserved_slots, 'by', 'system') from rel)
    select (select count(*) from rel)::int as n`;
  return r[0].n;
}
/** Closes one batch if it can be closed. Returns true only for the call that released the reservation. */
export const finishBatch = async (batchId: string): Promise<boolean> => (await release(platformSql`b.id = ${batchId}`)) > 0;
/** The batch of a document, if any, closed if it can be. Used after every end state a document reaches: one statement. */
export const finishBatchOf = async (documentId: string): Promise<boolean> => (await release(platformSql`b.id = (select d0.batch_id from documents d0 where d0.id = ${documentId})`)) > 0;
/** The safety net: closes every held batch that can be closed, across all portals (a crashed worker, a missed event, an abandoned transfer), and checks that each portal's
 * count equals what its held batches add up to. Safe to run at any time and from any number of servers. */
export const driftReport = { checks: 0, mismatches: 0, last: null as string | null };
export async function reconcileReservations(): Promise<number> {
  const n = await release(platformSql`true`);
  const drift = await platformSql`select c.portal_id, c.reserved, coalesce(sum(b.reserved_slots) filter (where b.reservation_state = 'held'), 0)::int as real from portal_capacity c left join upload_batches b on b.portal_id = c.portal_id group by c.portal_id, c.reserved having c.reserved <> coalesce(sum(b.reserved_slots) filter (where b.reservation_state = 'held'), 0)`;
  driftReport.checks++;
  if (drift.length) { driftReport.mismatches += drift.length; driftReport.last = new Date().toISOString(); console.error(JSON.stringify({ level: "error", event: "capacity.counter_drift", portals: drift.length, note: "the admission count differs from the held batches; reported, not silently corrected" })); }
  return n;
}

// ---------------------------------------------------------------- the view
/** What the batch looks like right now. `complete` means nothing is waiting or being read and every file is accounted for; it does not mean everything succeeded. */
export async function batchView(orgId: string, batchId: string, viewerId?: string) {
  if (!isUuid(batchId)) throw new BatchError("RES-001", "Batch not found.", 404);
  // The batch row, the counts and the failure list do not depend on each other: asked together (several round trips become one wait).
  const [bRows, [c], failureRows, finishedRows, ackRows] = await Promise.all([sql`select * from upload_batches where id = ${batchId} and org_id = ${orgId}`, sql`
    select count(*)::int as received,
      count(*) filter (where d.status = 'processing' and d.stage = 'received')::int as waiting,
      count(*) filter (where d.status = 'processing' and d.stage <> 'received')::int as processing,
      count(*) filter (where d.status = 'published' and coalesce(r.data ->> 'reviewState', 'ok') <> 'needs_review')::int as completed,   -- confirmed by a recruiter ("reviewed") counts as done
      count(*) filter (where d.status = 'published' and r.data ->> 'reviewState' = 'needs_review')::int as needs_review,
      count(*) filter (where d.status = 'exception' and coalesce(d.error_code, '') <> ${CANCELLED} and d.error_code <> all (${BLOCKED_CODES}))::int as failed,
      count(*) filter (where d.status = 'exception' and d.error_code = any (${BLOCKED_CODES}))::int as blocked,
      count(*) filter (where d.status = 'exception' and d.error_code = ${CANCELLED})::int as cancelled
    from documents d
    left join lateral (select data from candidates where id = d.record_id and org_id = d.org_id union all select data from jobs where id = d.record_id and org_id = d.org_id limit 1) r on true
    where d.org_id = ${orgId} and d.batch_id = ${batchId}`,
    sql`select d.id, d.original_name, d.error_code, d.error_message, (select o.correlation_id from error_occurrences o where o.document_id = d.id and o.org_id = d.org_id order by o.occurred_at desc limit 1) as reference from documents d where d.org_id = ${orgId} and d.batch_id = ${batchId} and d.status = 'exception' and coalesce(d.error_code, '') <> ${CANCELLED} order by d.updated_at desc limit 50`,
    sql`select updated_at from documents where org_id = ${orgId} and batch_id = ${batchId} and status in ('published', 'exception') and coalesce(error_code, '') <> ${CANCELLED} order by updated_at desc limit 25`,
    viewerId ? sql`select 1 from batch_acknowledgements where batch_id = ${batchId} and user_id = ${viewerId}` : Promise.resolve([])]);
  const b = bRows[0];
  if (!b) throw new BatchError("RES-001", "Batch not found.", 404);
  const failures = failureRows.map((d: any) => ({ id: d.id as string, fileName: d.original_name as string, errorCode: d.error_code as string | null, errorMessage: d.error_message as string | null, reference: (d.reference as string | null), retryable: canRetry(d.error_code) }));
  const refused = (b.refusals as Refusal[]).length;
  const counts = { declared: b.declared_files, received: c.received, waiting: c.waiting, processing: c.processing, completed: c.completed, needsReview: c.needs_review, failed: c.failed, blocked: c.blocked, cancelled: c.cancelled, duplicates: b.duplicate_files, refused };
  const accounted = c.received + b.duplicate_files + refused;
  const lastActivity = new Date(b.last_activity_at).getTime();
  const abandoned = !b.cancelled_at && c.waiting + c.processing === 0 && accounted < b.declared_files && Date.now() - lastActivity > config.batchTransferLeaseSec * 1000;
  const complete = c.waiting + c.processing === 0 && (accounted >= b.declared_files || !!b.cancelled_at || abandoned);   // the same rule as closable()
  return {
    id: b.id, createdBy: b.created_by as string, submittedByEmail: (b.submitted_by_email || "") as string, parentBatchId: (b.parent_batch_id ?? null) as string | null,
    abandoned, kind: b.kind as "cv" | "jd", createdAt: new Date(b.created_at).toISOString(), cancelledAt: b.cancelled_at ? new Date(b.cancelled_at).toISOString() : null,
    counts, notYetSent: Math.max(0, b.declared_files - accounted), refusals: b.refusals as Refusal[], failures,
    closedAt: b.closed_at ? new Date(b.closed_at).toISOString() : null,
    reservedSlots: b.reserved_slots as number, reservationState: b.reservation_state as "held" | "released", finishedAt: b.finished_at ? new Date(b.finished_at).toISOString() : null,
    complete, active: !complete,
    skipped: b.skipped as { fileName: string; reason: string }[], duplicateNames: b.duplicate_names as string[], acknowledgedByMe: ackRows.length > 0,
    // Elapsed runs from admission to the last file reaching an end state (or to now while work continues). Estimated time left is only ever a range from observed completions.
    elapsedSec: Math.round(((complete && finishedRows[0] ? new Date(finishedRows[0].updated_at).getTime() : Date.now()) - new Date(b.created_at).getTime()) / 1000),
    eta: complete || b.cancelled_at ? ({ state: "none" } as const) : estimate(finishedRows.map((r: any) => new Date(r.updated_at).getTime()), c.waiting + c.processing + (accounted < b.declared_files && !abandoned ? b.declared_files - accounted : 0), Date.now()),
  };
}

/** A batch is shared work, visible to the portal, but only the person who started it (or an administrator) can cancel, retry or close it. */
function assertCanManage(v: { createdBy: string }, a: Actor) {
  if (v.createdBy !== a.userId && !a.isAdmin) throw new BatchError("PERM-001", "Only the person who started this batch, or an administrator, can change it.", 403);
}

/** Stops what has not started. Files already being read finish and are kept. Nothing already published is touched. The reservation stays until they have. */
export async function cancelBatch(orgId: string, a: Actor, batchId: string, requestId: string) {
  assertCanManage(await batchView(orgId, batchId), a); // 404 if it is not this portal's
  await sql`update upload_batches set cancelled_at = coalesce(cancelled_at, now()) where id = ${batchId} and org_id = ${orgId}`;
  const stopped = await sql`update documents set status = 'exception', error_code = ${CANCELLED}, error_message = 'Cancelled before it was read.', updated_at = now()
    where org_id = ${orgId} and batch_id = ${batchId} and status = 'processing' and stage = 'received' returning id`;
  const ids = stopped.map((r: any) => r.id as string);
  if (ids.length) await sql`update queue set status = 'cancelled' where org_id = ${orgId} and type = 'process-document' and status = 'queued' and payload ->> 'documentId' = any(${ids}::text[])`;
  await audit(sql, orgId, a.userId, "batch.cancelled", "batch", batchId, { stopped: ids.length, actorEmail: a.email }, requestId);
  await finishBatch(batchId);   // closes at once if nothing is still being read; otherwise when the last file finishes
  return { stopped: ids.length, view: await batchView(orgId, batchId, a.userId) };
}

/** Puts failed files (not cancelled or blocked ones, and not ones that failed for a reason retrying cannot change) back in the queue, a bounded number of times.
 * While the batch is still open this stays inside its reservation. After it has closed, the retry needs a NEW reservation, linked to the batch it retries. */
export async function retryBatch(orgId: string, a: Actor, batchId: string, requestId: string) {
  const v = await batchView(orgId, batchId);
  assertCanManage(v, a);
  if (v.cancelledAt) throw new BatchError("BATCH-003", "This batch was cancelled. Upload the files again in a new batch.", 409);
  const eligible = sql`status = 'exception' and error_code in ${sql(RETRYABLE as unknown as string[])} and manual_retries < ${config.maxManualRetries}`;
  let target = batchId;
  if (v.reservationState === "released") {
    const [n] = await sql`select count(*)::int as c from documents where org_id = ${orgId} and batch_id = ${batchId} and ${eligible}`;
    if (!n.c) return { retried: 0, notRetryable: v.counts.failed, newBatchId: null as string | null, view: await batchView(orgId, batchId, a.userId) };
    const nb = await createBatch({ ...a, orgId }, { kind: v.kind, files: n.c, bytes: 0, parentBatchId: batchId });   // refused with CAPACITY-001 when the portal is full
    target = nb.id;
  }
  const rows = await sql`update documents set status = 'processing', stage = 'received', error_code = null, error_message = null, dismissed_at = null, manual_retries = manual_retries + 1, batch_id = ${target}, updated_at = now()
    where org_id = ${orgId} and batch_id = ${batchId} and ${eligible} returning id`;
  await sql`update upload_batches set last_activity_at = now(), declared_files = greatest(declared_files, (select count(*) from documents where batch_id = ${target})::int) where id = ${target}`;
  for (const r of rows) { await audit(sql, orgId, a.userId, "document.retried", "document", r.id, { batchId: target, from: batchId, actorEmail: a.email }, requestId); await enqueue(orgId, "process-document", { documentId: r.id }); }
  const [left] = await sql`select count(*)::int as c from documents where org_id = ${orgId} and batch_id = ${batchId} and status = 'exception' and coalesce(error_code, '') <> ${CANCELLED}`;
  return { retried: rows.length, notRetryable: left.c, newBatchId: target === batchId ? null : target, view: await batchView(orgId, target, a.userId) };
}

/** Batches still on the person's screen (not dismissed), newest first: what a refreshed page or a second browser shows again. */
export async function openBatches(orgId: string, userId: string) {
  // A finished single file is not an open batch: nothing ever closes one, and ten of them would cost every open page in the portal ten views on every poll (register R114). The views are shared per portal for a few seconds; only whether this person has acknowledged one is theirs.
  const portal = currentPortal() ?? orgId;
  const views = await portalCached(portal, "open-batch-views", 3000, async () => {
    const rows = await sql`select id from upload_batches where org_id = ${orgId} and closed_at is null and created_at > now() - interval '7 days' and not (declared_files = 1 and reservation_state = 'released') order by created_at desc limit 10`;
    return Promise.all(rows.map((r: any) => batchView(orgId, r.id)));
  });
  if (!views.length) return [];
  const acknowledged = new Set((await sql`select batch_id from batch_acknowledgements where user_id = ${userId} and batch_id = any(${sql.array(views.map((v) => v.id))}::uuid[])`).map((r: any) => r.batch_id as string));
  return views.map((v) => ({ ...v, acknowledgedByMe: acknowledged.has(v.id) }));
}

/** Removes the progress panel from the screen. Only a finished batch can be dismissed; the documents, records and reservation history are untouched. */
export async function closeBatch(orgId: string, a: Actor, batchId: string, requestId: string) {
  const v = await batchView(orgId, batchId);
  assertCanManage(v, a);
  if (!v.complete && !v.cancelledAt) throw new BatchError("BATCH-004", "This batch is still being processed. Cancel it first if you want to stop it.", 409);
  await sql`update upload_batches set closed_at = coalesce(closed_at, now()) where id = ${batchId} and org_id = ${orgId}`;
  await audit(sql, orgId, a.userId, "batch.closed", "batch", batchId, { actorEmail: a.email }, requestId);
  return { ok: true };
}

/** This person has seen the completion summary. It changes nothing for anyone else: each person has their own acknowledgement. */
export async function acknowledgeBatch(orgId: string, userId: string, batchId: string) {
  await batchView(orgId, batchId);   // 404 unless it is in this portal
  await sql`insert into batch_acknowledgements (batch_id, org_id, user_id) values (${batchId}, ${orgId}, ${userId}) on conflict do nothing`;
  return { ok: true };
}

/** One row per file the person chose, with exactly one outcome each, so the report adds up to the files chosen. No document text and no candidate details. */
export async function batchReport(orgId: string, batchId: string) {
  const v = await batchView(orgId, batchId);
  const rows = await sql`select d.id, d.original_name, d.status, d.stage, d.error_code, d.error_message, d.created_at, d.updated_at, d.manual_retries, d.record_id, d.uploaded_by_email,
      coalesce(r.data ->> 'reviewState', 'ok') as review_state, r.data -> 'review' -> 'reasons' as review_reasons
    from documents d
    left join lateral (select data from candidates where id = d.record_id and org_id = d.org_id union all select data from jobs where id = d.record_id and org_id = d.org_id limit 1) r on true
    where d.org_id = ${orgId} and d.batch_id = ${batchId} order by d.created_at`;
  const files = [
    ...rows.map((d: any) => {
      const published = d.status === "published", cancelled = d.error_code === CANCELLED, blocked = BLOCKED_CODES.includes(d.error_code);
      const outcome = published ? (d.review_state === "needs_review" ? "added_needs_review" : "added") : cancelled ? "cancelled" : blocked ? "blocked_needs_review" : d.status === "exception" ? "failed" : d.stage === "received" ? "waiting" : "being_read";
      return { fileName: d.original_name as string, outcome, recordSaved: published, recordId: published ? (d.record_id as string) : null, uploadedBy: (d.uploaded_by_email || null) as string | null, admittedAt: new Date(d.created_at).toISOString(), finishedAt: published || d.status === "exception" ? new Date(d.updated_at).toISOString() : null,
        problem: outcome === "failed" || outcome === "blocked_needs_review" ? explain(d.error_code, d.error_message) : outcome === "added_needs_review" ? (Array.isArray(d.review_reasons) ? d.review_reasons.slice(0, 5).join("; ") : "Flagged for review") : null,
        retryEligible: outcome === "failed" && canRetry(d.error_code) && d.manual_retries < config.maxManualRetries, retries: d.manual_retries as number,
        nextAction: outcome === "blocked_needs_review" ? "Replace the document with a complete version that is within the limit." : outcome === "failed" ? (canRetry(d.error_code) ? "Retry; if it fails again, report it with the reference." : "Replace the document with a clearer or corrected copy.") : outcome === "added_needs_review" ? "Open the record and review the flagged fields." : null };
    }),
    ...v.duplicateNames.map((n) => ({ fileName: n, outcome: "duplicate", recordSaved: false, recordId: null, uploadedBy: null, admittedAt: v.createdAt, finishedAt: null, problem: "Already in this portal; not processed again.", retryEligible: false, retries: 0, nextAction: null })),
    ...v.refusals.map((r) => ({ fileName: r.fileName, outcome: "unsupported_or_refused", recordSaved: false, recordId: null, uploadedBy: null, admittedAt: v.createdAt, finishedAt: null, problem: r.message, retryEligible: false, retries: 0, nextAction: "Replace the document with a supported, readable copy.", reference: r.reference ?? null })),
    ...v.skipped.map((x) => ({ fileName: x.fileName, outcome: "left_out_before_sending", recordSaved: false, recordId: null, uploadedBy: null, admittedAt: v.createdAt, finishedAt: null, problem: `Left out before sending: ${x.reason}.`, retryEligible: false, retries: 0, nextAction: "Convert or replace the file if it should be included." })),
  ];
  const tally: Record<string, number> = {}; for (const f of files) tally[f.outcome] = (tally[f.outcome] ?? 0) + 1;
  return { batch: { id: v.id, kind: v.kind, createdAt: v.createdAt, submittedByEmail: v.submittedByEmail, cancelledAt: v.cancelledAt, complete: v.complete, finishedAt: v.finishedAt, elapsedSec: v.elapsedSec, declared: v.counts.declared, reserved: v.reservedSlots, notYetSent: v.notYetSent, parentBatchId: v.parentBatchId }, tally, files };
}
const explain = (code: string | null, message: string | null) => (message ?? code ?? "Could not be processed").slice(0, 300);
