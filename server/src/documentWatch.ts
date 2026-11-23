// A document never sits on the board as "being read" with nothing behind it (owner, 10 Nov 2026: two job descriptions stayed at "Being read by the AI"
// after their batch had finished; "I need this to never be an issue again"). The hand-offs are now saved together with their queued work (queue.ts,
// enqueueIn), so the gap that caused it is closed; this watch is the second guard, for any cause not yet thought of. Every few minutes it looks for a
// document still processing, untouched for a while, with no queued or running work for it, and sends it on again: to the AI if it was waiting for the
// AI's reading, otherwise back through processing. After the third such rescue the document stops waiting and says it could not be added, with Retry,
// so the board never shows a bar that will not move. Each rescue is recorded on the document. Runs as the platform, and each rescue inside the
// document's own portal.
import { audit, forPortal, platformSql, sql } from "./db";
import { finishBatchOf } from "./batches";
import { enqueueIn, kick } from "./queue";

const RESCUES = 3;
const STALLED_MESSAGE = "This file stopped while it was being read and could not be restarted, so it was not added. Use Retry to try again.";

async function rescueStalledDocuments(olderThanMinutes = Number(process.env.DOCUMENT_STALL_MINUTES ?? 10)): Promise<{ resent: number; stopped: number }> {
  const rows = await platformSql`select d.id, d.org_id, d.portal_id, d.kind, d.stage, d.awaiting_audit is not null as with_ai,
      (select count(*)::int from audit_events a where a.org_id = d.org_id and a.entity_id = d.id and a.action = 'document.rescued') as rescued
    from documents d
    where d.status = 'processing' and d.portal_id is not null and d.stage <> 'held' and d.updated_at < now() - make_interval(mins => ${olderThanMinutes})
      and not exists (select 1 from queue q where q.org_id = d.org_id and q.status in ('queued', 'running') and q.payload->>'documentId' = d.id::text)
    order by d.updated_at limit 200`;
  let resent = 0, stopped = 0;
  for (const d of rows as any[]) {
    const org = String(d.org_id), portal = String(d.portal_id), id = String(d.id);
    if (d.rescued >= RESCUES) {
      const [done] = await platformSql`update documents set status = 'exception', error_code = 'STALLED', error_message = ${STALLED_MESSAGE}, awaiting_audit = null, updated_at = now()
        where id = ${id} and status = 'processing' returning id`;
      if (!done) continue;
      await audit(platformSql, org, null, "document.exception", "document", id, { code: "STALLED", stage: d.stage, rescues: d.rescued });
      await finishBatchOf(id); stopped++;
      continue;
    }
    // Waiting for the AI's reading: ask for it again (its own retries and failure handling then apply). Otherwise: processing again from the start.
    // Locked, checked again and queued in one transaction, so two watches at the same moment (two servers, or two runs) send it on once.
    const type = d.with_ai ? (d.kind === "jd" ? "model-job-fields" : "model-read") : "process-document";
    const sent = await forPortal(org, portal, () => sql.begin(async (q: any) => {
      const [still] = await q`select id from documents where id = ${id} and status = 'processing' for update skip locked`;
      if (!still) return false;
      const [busy] = await q`select 1 from queue where org_id = ${org} and status in ('queued', 'running') and payload->>'documentId' = ${id} limit 1`;
      if (busy) return false;
      await enqueueIn(q, org, type, { documentId: id }, type === "model-read" ? 2 : 3);
      await audit(q, org, null, "document.rescued", "document", id, { stage: d.stage, sentTo: type, rescue: d.rescued + 1 });
      return true;
    }));
    if (sent) { kick(); resent++; }
  }
  if (resent || stopped) console.log(JSON.stringify({ level: "warn", event: "documents.rescued", resent, stopped }));
  return { resent, stopped };
}

export function startDocumentWatch() {
  let running = false;   // one watch at a time in this process: a slow one is never overlapped by the next
  const every = Number(process.env.DOCUMENT_WATCH_MS ?? 120_000), run = () => {
    if (running) return;
    running = true;
    void rescueStalledDocuments().catch((e) => console.error(JSON.stringify({ level: "warn", event: "documents.watch_failed", reason: String(e?.message ?? e) }))).finally(() => { running = false; });
  };
  setTimeout(run, Math.min(20_000, every)).unref?.();
  setInterval(run, every).unref?.();
}
