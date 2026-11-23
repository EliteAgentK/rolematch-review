// Permanent deletion of a candidate or a job, requested by a person. Everything that holds the person's data goes: the record, the
// match results that include them, the AI's reviews of the record and of its matches, the stored original file, the extracted text, and the
// personal detail inside past edit-history entries. What remains is a plain audit line saying who deleted what and when, and a permanent line in the upload history (no names, no contents).
import { audit, newId, sql } from "./db";
import { registerHandler } from "./queue";
import { deleteObjects } from "./supabase";
import { config } from "./config";
import { OriginalsCopy } from "./originalsCopy";
import { isUuid } from "./store";
import { syncHeadline } from "./applications";
import { getSettings } from "./settings";

type Kind = "candidate" | "job";

export async function deleteRecord(kind: Kind, orgId: string, actorId: string, id: string, correlationId?: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const table = kind === "candidate" ? "candidates" : "jobs";
  const fk = kind === "candidate" ? "candidate_id" : "job_id";
  const order = kind === "job" ? (await getSettings(orgId)).settings.statuses.map((s) => s.key) : [];
  const done = await sql.begin(async (q) => {
    const rows = await q.unsafe(`select id, document_id, data->>'title' as title from ${table} where org_id = $1 and id = $2 for update`, [orgId, id]);
    if (!rows[0]) return false;
    // A job's statuses go with it, and so must the stage they gave each person (production review, 12 Nov 2026, P3): someone shortlisted only for
    // this job would otherwise stay "Shortlisted", and a hiring manager would still see them, on no shortlist. Each affected person is held after the
    // job, as setApplication holds them, and brought back in step once the job is gone.
    const affected = kind === "job" ? await q`select a.candidate_id, a.status, c.data->>'status' as headline from applications a join candidates c on c.id = a.candidate_id
      where a.job_id = ${id} order by a.candidate_id for update of c` : [];
    const documentId: string = rows[0].document_id;
    const [doc] = await q.unsafe(`select d.storage_path, d.kind, d.portal_id, d.created_at, coalesce(nullif(d.uploaded_by_email, ''), m.email, '') as uploaded_by, coalesce(b.declared_files, 1) > 1 as via_batch
      from documents d left join members m on m.user_id = d.created_by left join upload_batches b on b.id = d.batch_id and b.org_id = d.org_id where d.id = $1 and d.org_id = $2`, [documentId, orgId]);
    // Before the document goes: the history keeps who uploaded it and who deleted it, never the person's or the file's name.
    if (doc) await q.unsafe(`insert into upload_history_removed (id, org_id, portal_id, kind, uploaded_by, uploaded_at, via_batch, deleted_by)
      select $1, $2, $3, $4, $5, $6, $7, coalesce((select email from members where user_id = $8 and org_id = $2), '') on conflict (id) do nothing`, [documentId, orgId, doc.portal_id, doc.kind, doc.uploaded_by, doc.created_at, doc.via_batch, actorId]);
    await q`select set_config('rolematch.scrub', 'on', true)`; // lets this transaction (only) blank the personal detail in old audit entries
    await q.unsafe(`update audit_events set detail = '{"removed":"personal detail removed when the record was deleted"}'::jsonb where org_id = $1 and entity_id = $2 and action = $3`, [orgId, id, `${kind}.edited`]);
    await q.unsafe(`delete from error_register where org_id = $1 and record_id = $2`, [orgId, id]);   // corrections carry the person's details too
    const removed = await q.unsafe(`delete from matches where org_id = $1 and ${fk} = $2 returning id, result->'ai'->>'pair' as pair`, [orgId, id]);
    // The AI's reviews go too (code review, 16 Nov 2026, A-M9): a match's score quotes passages of the CV, a reading holds what the document said, and
    // they were kept for good after the record was deleted. Gone: every review about this record, its document or one of its matches, and every score
    // of a pair one of its matches was waiting for or was given (a score is kept once per pair, not per match). Within this portal only, by its row rules.
    const reviews = await q.unsafe(`delete from model_reviews where org_id = $1 and (subject_id = any($2::uuid[]) or (kind = 'match-score' and input_hash = any($3::text[]))) returning id`,
      [orgId, [id, documentId, ...removed.map((r: any) => r.id as string)], removed.map((r: any) => r.pair as string | null).filter((p): p is string => !!p)]);
    if (reviews.length) await q.unsafe(`delete from queue where org_id = $1 and type like 'model-%' and payload->>'reviewId' = any($2::text[])`, [orgId, reviews.map((r: any) => r.id as string)]);
    await q.unsafe(`delete from ${table} where org_id = $1 and id = $2`, [orgId, id]);   // its statuses (applications) go by cascade
    for (const a of affected as any[]) {
      const headline = await syncHeadline(q, orgId, a.candidate_id, a.headline ?? "new", order);
      await audit(q, orgId, actorId, "application.removed_with_job", "candidate", a.candidate_id, { jobId: id, jobTitle: rows[0].title ?? "", from: a.status, to: null, headline }, correlationId);
    }
    await q.unsafe(`delete from queue where org_id = $1 and payload->>'documentId' = $2`, [orgId, documentId]);
    await q.unsafe(`delete from documents where org_id = $1 and id = $2`, [orgId, documentId]);
    // The file in storage is removed by the queue (with retries) so a storage hiccup can never leave the record half deleted.
    if (doc?.storage_path) await q`insert into queue (id, org_id, type, payload, max_attempts) values (${newId()}, ${orgId}, 'delete-object', ${q.json({ path: doc.storage_path })}, 8)`;
    await audit(q, orgId, actorId, `${kind}.deleted`, kind, id, { matchResultsRemoved: removed.length }, correlationId);
    return true;
  });
  return done as boolean; // the queue's own poll picks up the file deletion within seconds
}

export function registerDeletion() {
  registerHandler("delete-object", async (payload: any) => {
    const path = payload?.path;
    if (typeof path === "string" && path) { await deleteObjects([path], { strict: true }); OriginalsCopy.fromEnv(config.dataDir).remove(path); } // RoleMatch's own copy goes too
  });
}
