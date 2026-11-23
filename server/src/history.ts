// Settings, History: what was uploaded and which invitations were sent. Read-only views over records that already exist (documents, upload batches,
// portal invitations); nothing here changes anything. Scope: the portal the person is working in, or, for an organisation administrator, every portal in
// the organisation. These queries read across portals on purpose, so every one names the organisation (and the portal when scoped) explicitly.
import { displayCase } from "./displayCase";
import { isAdminNow, type Session } from "./auth";
import { BLOCKED_CODES, CANCELLED } from "./batches";
import { platformSql as sql } from "./db";
import { HIRING_MANAGER, visibleToHiringManager } from "./hiringManager";

export class HistoryError extends Error { constructor(public code: string, message: string, public status = 403) { super(message); } }
export type HistoryScope = "portal" | "org";

async function where(s: Session, scope: HistoryScope) {
  if (scope === "org") {
    if (!(await isAdminNow(s.userId, s.orgId))) throw new HistoryError("PERM-001", "Only an organisation administrator can see the history of every portal.");
    return { orgId: s.orgId, portalId: null as string | null };
  }
  return { orgId: s.orgId, portalId: s.portalId ?? null };
}

/** Every document uploaded, newest first: single files and files sent in a batch alike. */
export async function uploadHistory(s: Session, scope: HistoryScope, limit = 200) {
  const w = await where(s, scope);
  const rows = await sql`
    select d.id, d.kind, d.original_name, d.created_at, d.status, d.stage, d.error_code, d.error_message, d.batch_id,
           coalesce(nullif(d.uploaded_by_email, ''), m.email, '') as uploaded_by, p.name as portal_name, coalesce(b.declared_files, 1) as batch_files,
           coalesce(r.data ->> 'reviewState', 'ok') as review_state, r.id as record_found, d.portal_id, r.data ->> 'status' as record_status
    from documents d
    join portals p on p.id = d.portal_id and p.org_id = d.org_id
    left join members m on m.user_id = d.created_by
    left join upload_batches b on b.id = d.batch_id and b.org_id = d.org_id   -- a single upload is a batch of one internally (its slot reservation); only two files or more is a batch to people
    left join lateral (select id, data from candidates where id = d.record_id and org_id = d.org_id union all select id, data from jobs where id = d.record_id and org_id = d.org_id limit 1) r on true
    where d.org_id = ${w.orgId} and (${w.portalId}::uuid is null or d.portal_id = ${w.portalId})
    order by d.created_at desc limit ${Math.min(Math.max(limit, 1), 500)}`;
  // Uploads whose record was deleted later: the document and the person's data are gone, the line is not (register R101).
  const removed = await sql`
    select r.id, r.kind, r.uploaded_by, r.uploaded_at, r.via_batch, r.deleted_by, r.deleted_at, r.portal_id, p.name as portal_name
    from upload_history_removed r join portals p on p.id = r.portal_id and p.org_id = r.org_id
    where r.org_id = ${w.orgId} and (${w.portalId}::uuid is null or r.portal_id = ${w.portalId})
    order by r.uploaded_at desc limit ${Math.min(Math.max(limit, 1), 500)}`;
  const removedLines = removed.map((r: any) => ({ id: r.id as string, kind: r.kind as "cv" | "jd", fileName: "Name removed when the record was deleted", at: new Date(r.uploaded_at).toISOString(), uploadedBy: r.uploaded_by as string,
    portal: r.portal_name as string, portalId: r.portal_id as string, recordId: null, viaBatch: r.via_batch as boolean, outcome: "deleted" as const, reason: `Deleted by ${r.deleted_by || "a former member"}`, deletedBy: r.deleted_by as string, deletedAt: new Date(r.deleted_at).toISOString() }));
  const current = rows.map((d: any) => {
    const cancelled = d.error_code === CANCELLED, blocked = BLOCKED_CODES.includes(d.error_code);
    // "reviewed" is a record a recruiter has confirmed: added, not waiting. (Deleting a record deletes its document too, so it leaves this list; the audit log keeps the deletion.)
    const outcome = d.status === "published" ? (d.review_state === "needs_review" ? "added_needs_review" : d.review_state === "reviewed" ? "added_reviewed" : "added")
      : d.status === "exception" ? (cancelled ? "cancelled" : blocked ? "held_for_review" : "not_added") : "being_read";
    return { id: d.id as string, kind: d.kind as "cv" | "jd", fileName: d.original_name as string, at: new Date(d.created_at).toISOString(), uploadedBy: d.uploaded_by as string,
      portal: d.portal_name as string, portalId: d.portal_id as string, recordId: d.status === "published" && d.record_found ? (d.record_found as string) : null, viaBatch: !!d.batch_id && d.batch_files > 1, outcome, reason: d.status === "exception" && !cancelled ? ((d.error_message as string | null) ?? null) : null };
  });
  // A hiring manager sees every line, but a CV's file name usually names the person: anyone not on the shortlist stays hidden from this role here too.
  const seen = s.portalRole !== HIRING_MANAGER ? current : current.map((line: any, i: number) => rows[i].kind === "jd" || visibleToHiringManager(rows[i].record_status) ? line : { ...line, fileName: "CV of a candidate not on the shortlist", recordId: null, reason: null });
  return [...seen, ...removedLines].sort((x: any, y: any) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, Math.min(Math.max(limit, 1), 500));
}

// What people did, in plain words, for everyone in the portal to read. Only the action, who and when: audit details can hold a person's data and are never sent. An action not named here is not shown.
const ACTIVITY: Record<string, string> = {
  "candidate.edited": "Changed a candidate record", "candidate.review_confirmed": "Confirmed a candidate record", "candidate.deleted": "Deleted a candidate record",
  "job.edited": "Changed a job", "job.review_confirmed": "Confirmed a job", "job.deleted": "Deleted a job",
  "match.run": "Ran a match", "application.status_changed": "Set a candidate's status for a job", "document.original_viewed": "Opened an original document", "document.retried": "Retried a document", "document.dismissed": "Cleared a failed document",
  "batch.created": "Started a batch upload", "batch.closed": "Closed a batch upload", "batch.cancelled": "Cancelled a batch upload",
  "portal.created": "Created the portal", "portal.invited": "Sent an invitation", "portal.invitation_resent": "Resent an invitation", "portal.invitation_revoked": "Withdrew an invitation", "portal.invitation_accepted": "Joined through an invitation",
  "portal.member_role_changed": "Changed someone's role", "portal.member_removed": "Removed someone from the portal", "portal.member_left": "Left the portal", "portal.admin_appointed": "Appointed a portal administrator",
};
Object.assign(ACTIVITY, {
  "candidate.published": "Added a candidate", "job.published": "Added a job", "candidate.read_again": "Read a CV again with the AI", "job.read_again": "Read a job again with the AI",
  "batch.finished": "Finished a batch upload", "settings.changed": "Changed the settings",
  // production review, 12 Nov 2026: a job's statuses going with the job, and the one-off repair of people's stages (migration 053)
  "application.removed_with_job": "A candidate's status went with a deleted job", "candidate.stage_repaired": "RoleMatch brought a candidate's stage in step with their jobs",
});
const ACTIONS = Object.keys(ACTIVITY);
// The Overview's activity is the work that matters (owner, 10 Nov 2026: anything that used credits, uploads single and batch, matches, invitations,
// joining and leaving, removals, deletions, changes to candidates and their shortlists): every line opens its details. Housekeeping stays in Settings,
// History, where nothing is left out: opening an original, retrying or clearing a failed file, and a batch's opening and closing (its finishing is the
// one line a batch gets, and the files it added have none of their own).
const OVERVIEW_HIDDEN = new Set(["document.original_viewed", "document.retried", "document.dismissed", "batch.created", "batch.closed"]);
const OVERVIEW_ACTIONS = ACTIONS.filter((a) => !OVERVIEW_HIDDEN.has(a));
const UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const FIELD_WORDS: Record<string, string> = { name: "name", email: "e-mail", phone: "phone", location: "location", title: "title", company: "company", status: "status", notes: "notes", summary: "summary", skills: "skills", workHistory: "work history", education: "education", requirements: "requirements", responsibilities: "responsibilities" };
/** The newest things that happened, for this portal or, for an organisation administrator, every portal. Membership actions are recorded against the portal itself, others carry its id. */
/** `detail`: also the person's e-mail address, the records each line was about, and the person and job by name. Only for the Overview (recruiters and
 *  administrators: a hiring manager is refused it, index.ts). History itself stays in plain words with no one's data, for everyone in the portal. */
export async function activityHistory(s: Session, scope: HistoryScope, limit = 200, { detail = false }: { detail?: boolean } = {}) {
  const w = await where(s, scope), n = Math.min(Math.max(limit, 1), 500), wanted = detail ? OVERVIEW_ACTIONS : ACTIONS, fetch = detail ? Math.min(n * 3, 500) : n;
  const columns = (q: typeof sql) => q`a.id, a.action, a.created_at, a.detail #>> '{changes,status,to}' as new_status, a.detail->>'to' as app_to, a.detail->>'jobTitle' as app_job, a.entity_type, a.entity_id, a.detail->>'jobId' as detail_job,
    (select c.data->>'name' from candidates c where a.entity_type = 'candidate' and c.id = a.entity_id and c.org_id = a.org_id) as cand_name,
    (select j.data->>'title' from jobs j where j.org_id = a.org_id and j.id = case when a.entity_type = 'job' then a.entity_id when a.detail->>'jobId' ~ '^[0-9a-f-]{36}$' then (a.detail->>'jobId')::uuid end) as job_title, coalesce(a.portal_id, case when a.entity_type = 'portal' then a.entity_id end) as portal_id, coalesce(nullif(m.name, ''), m.email, a.detail ->> 'actorEmail', '') as who, coalesce(m.email, a.detail ->> 'actorEmail', '') as who_email, a.detail as raw,
    (select d.original_name from documents d where d.org_id = a.org_id and d.id = case when a.detail->>'documentId' ~ ${UUID} then (a.detail->>'documentId')::uuid end) as doc_name,
    (select b.declared_files from documents d join upload_batches b on b.id = d.batch_id where d.org_id = a.org_id and d.id = case when a.detail->>'documentId' ~ ${UUID} then (a.detail->>'documentId')::uuid end) as doc_batch_files,
    (select json_build_object('kind', b.kind, 'files', b.declared_files, 'duplicates', b.duplicate_files, 'by', coalesce(nullif(bm.name, ''), bm.email, ''), 'byEmail', coalesce(bm.email, ''))
       from upload_batches b left join members bm on bm.user_id = b.created_by where a.entity_type = 'batch' and b.id = a.entity_id and b.org_id = a.org_id) as batch,
    (select json_build_object('email', i.email, 'role', i.role) from portal_invitations i where i.org_id = a.org_id and i.id::text = a.detail->>'invitation') as invite,
    (select coalesce(nullif(mm.name, ''), mm.email) from members mm where mm.user_id::text = coalesce(a.detail->>'member', a.detail->>'removed') limit 1) as member_name`;
  const rows = w.portalId
    ? await sql`select * from (
        (select ${columns(sql)} from audit_events a left join members m on m.user_id = a.actor_id where a.portal_id = ${w.portalId} and a.org_id = ${w.orgId} and a.action = any(${wanted}) order by a.created_at desc limit ${fetch})
        union all
        (select ${columns(sql)} from audit_events a left join members m on m.user_id = a.actor_id where a.org_id = ${w.orgId} and a.entity_id = ${w.portalId} and a.entity_type = 'portal' and a.portal_id is null and a.action = any(${wanted}) order by a.created_at desc limit ${fetch})
      ) x order by created_at desc limit ${fetch}`
    : await sql`select ${columns(sql)} from audit_events a left join members m on m.user_id = a.actor_id where a.org_id = ${w.orgId} and a.action = any(${wanted}) order by a.created_at desc limit ${fetch}`;
  const portals = w.portalId ? new Map<string, string>() : new Map((await sql`select id, name from portals where org_id = ${w.orgId}`).map((p: any) => [p.id as string, p.name as string]));
  // A line says exactly what happened, with the person and the job by name where the records still exist (owner, 10 Nov 2026: "see exactly what's
  // happened"); a deleted record falls back to the general wording below. Invitations and people by address and name only for the Overview's details.
  const kindWord = (b: any, n: number) => (b?.kind === "jd" ? (n === 1 ? "job description" : "job descriptions") : n === 1 ? "CV" : "CVs");
  const named = (r: any, batch?: { added: number; notAdded: number }): string | undefined => {
    // Names inside a sentence are shown by the same rule as everywhere else (shown.ts).
    const who = r.cand_name ? displayCase(String(r.cand_name)) : "", job = r.job_title ? displayCase(String(r.job_title)) : r.app_job ? displayCase(String(r.app_job)) : "", raw = r.raw ?? {};
    if (r.action === "application.status_changed" && r.app_to && who) return `Moved ${who} to ${String(r.app_to).toLowerCase()}${job ? ` for ${job}` : ""}`;
    if (r.action === "application.status_changed" && !r.app_to && who) return `Took ${who} off ${job || "a job's list"}`;
    if (r.action === "match.run" && who && job) return `Matched ${who} against ${job}`;
    if ((r.action === "candidate.edited" || r.action === "candidate.review_confirmed") && who && !r.new_status) return `${r.action === "candidate.edited" ? "Changed" : "Confirmed"} ${who}'s record`;
    if ((r.action === "job.edited" || r.action === "job.review_confirmed") && job) return `${r.action === "job.edited" ? "Changed" : "Confirmed"} the job ${job}`;
    if (r.action === "candidate.published" && who) return `Uploaded ${who}'s CV`;
    if (r.action === "job.published" && job) return `Uploaded the job ${job}`;
    if (r.action === "candidate.read_again" && who) return `Read ${who}'s CV again`;
    if (r.action === "job.read_again" && job) return `Read the job ${job} again`;
    if ((r.action === "batch.finished" || r.action === "batch.cancelled") && r.batch) {
      const n = Number(r.batch.files ?? 0), counts = batch ? `: ${batch.added} added${batch.notAdded ? `, ${batch.notAdded} not added` : ""}` : "";
      return `${r.action === "batch.cancelled" ? "Cancelled a batch of" : "Uploaded"} ${n} ${kindWord(r.batch, n)}${counts}`;
    }
    if (r.action === "portal.invited" && r.invite?.email) return `Invited ${r.invite.email} as ${String(r.invite.role ?? raw.role ?? "a member").replace(/_/g, " ")}`;
    if (r.action === "portal.invitation_revoked" && r.invite?.email) return `Withdrew the invitation to ${r.invite.email}`;
    if (r.action === "portal.invitation_accepted") return "Joined the portal";
    if (r.action === "portal.member_removed") return `Removed ${r.member_name || "a former member"} from the portal`;
    if (r.action === "portal.member_role_changed" && raw.to) return `Changed ${r.member_name || "a member"}'s role to ${String(raw.to).replace(/_/g, " ")}`;
    if (r.action === "portal.admin_appointed") return `Made ${r.member_name || "a member"} a portal administrator`;
    return undefined;
  };
  /** What the details show beneath the line: the facts the event recorded, in words, and whether the AI (and so credit) was used. */
  const facts = (r: any, batch?: { added: number; notAdded: number }): string[] => {
    const raw = r.raw ?? {}, out: string[] = [], changed = (c: any) => Object.keys(c ?? {}).map((k) => FIELD_WORDS[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase());
    if (r.action.endsWith(".published")) {
      if (r.doc_name) out.push(`File: ${r.doc_name}`);
      out.push(raw.method === "ai" || raw.aiReading?.state === "read" ? "Read by the AI (uses credit)" : "Read without the AI");
      if (raw.review === "needs_review") out.push("Added for a recruiter to check");
    }
    if (r.action.endsWith(".read_again")) out.push("Read again by the AI (uses credit)");
    if (r.action === "job.read_again" && Object.keys(raw.changes ?? {}).length) out.push(`Changed by the new reading: ${changed(raw.changes).join(", ")}`);
    if (r.action === "match.run") out.push("Scored by the AI (uses credit the first time a pair is matched)");
    if (r.action.endsWith(".edited") && Object.keys(raw.changes ?? {}).length) out.push(`Changed: ${changed(raw.changes).join(", ")}`);
    if (r.action === "application.status_changed") out.push(`From ${raw.from ? String(raw.from).replace(/_/g, " ") : "no status"} to ${raw.to ? String(raw.to).replace(/_/g, " ") : "no status"}${r.app_job ? `, for ${r.app_job}` : ""}`);
    if (r.action.endsWith(".deleted")) out.push("The record and its original document were deleted; nothing of it remains.");
    if (batch) out.push(`${batch.added} added${batch.notAdded ? `, ${batch.notAdded} not added` : ""}${r.batch?.duplicates ? `, ${r.batch.duplicates} already in the portal` : ""}`, "Each file read by the AI (uses credit)");
    if (r.action === "portal.member_role_changed" && raw.from) out.push(`From ${String(raw.from).replace(/_/g, " ")} to ${String(raw.to ?? "").replace(/_/g, " ")}`);
    if (r.action === "portal.invited" && raw.role) out.push(`Role: ${String(raw.role).replace(/_/g, " ")}`);
    if (r.action === "settings.changed" && raw.version) out.push(`Settings version ${raw.version}`);
    return out;
  };
  // The records each line was about, for the Overview to open on the Matching Board; none for a deletion, whose record has gone.
  const about = (r: any) => (String(r.action).endsWith(".deleted") ? {} : { ...(r.entity_type === "candidate" && r.entity_id ? { candidateId: String(r.entity_id) } : {}),
    ...(r.entity_type === "job" && r.entity_id ? { jobId: String(r.entity_id) } : r.detail_job ? { jobId: String(r.detail_job) } : {}), ...(r.action === "match.run" ? { match: true } : {}) });
  // The Overview's lines: a file uploaded in a batch of several has no line of its own (its batch's line lists it), and a single upload's batch (a batch
  // of one, inside) has none either.
  const shown = detail ? rows.filter((r: any) => !(r.action.endsWith(".published") && Number(r.doc_batch_files ?? 1) > 1) && !(r.action.startsWith("batch.") && Number(r.batch?.files ?? 0) <= 1)).slice(0, n) : rows;
  // What each batch on screen added: its records by name, each to open on the board.
  const batchIds = detail ? shown.filter((r: any) => r.action.startsWith("batch.") && r.entity_id).map((r: any) => String(r.entity_id)) : [];
  const contents = new Map<string, { added: number; notAdded: number; records: { id: string; kind: "candidate" | "job"; name: string }[] }>();
  if (batchIds.length) for (const d of await sql`select d.batch_id, d.status, d.kind, d.record_id, coalesce(c.data->>'name', j.data->>'title') as name from documents d
      left join candidates c on c.id = d.record_id and c.org_id = d.org_id left join jobs j on j.id = d.record_id and j.org_id = d.org_id
      where d.org_id = ${w.orgId} and d.batch_id = any(${batchIds}::uuid[]) order by d.created_at` as any[]) {
    const b = contents.get(String(d.batch_id)) ?? { added: 0, notAdded: 0, records: [] };
    if (d.status === "published" && d.record_id && d.name) { b.added++; b.records.push({ id: String(d.record_id), kind: d.kind === "cv" ? "candidate" : "job", name: String(d.name) }); }
    else if (d.status === "published") b.added++;
    else if (d.status === "exception") b.notAdded++;
    contents.set(String(d.batch_id), b);
  }
  return shown.map((r: any) => {
    const batch = r.action.startsWith("batch.") ? contents.get(String(r.entity_id)) : undefined, byBatch = r.action.startsWith("batch.") && r.batch?.by;
    return { id: r.id as string, at: new Date(r.created_at).toISOString(), who: (byBatch ? r.batch.by : r.who ?? "") as string, portal: portals.get(r.portal_id) ?? "",
      ...(detail ? { whoEmail: (byBatch ? r.batch.byEmail : r.who_email ?? "") as string, ...about(r), facts: facts(r, batch), ...(batch?.records.length ? { records: batch.records.slice(0, 50) } : {}) } : {}),
      what: (detail ? named(r, batch) : undefined) ?? (r.action === "candidate.edited" && r.new_status ? `Moved a candidate to ${String(r.new_status).toLowerCase()}` : r.action === "application.status_changed" && r.app_to ? `Moved a candidate to ${String(r.app_to).toLowerCase()}${r.app_job ? ` for ${r.app_job}` : ""}` : r.action === "application.status_changed" ? "Took a candidate off a job's list" : ACTIVITY[r.action])  };
  });
}

/** Every invitation sent, newest first, with what became of it and of its e-mail. Anyone in the portal can read its own (owner's decision, 2026-11-05: history is shared and permanent); the whole organisation's stays with its administrators. */
export async function invitationHistory(s: Session, scope: HistoryScope, limit = 200) {
  const w = await where(s, scope);
  const rows = await sql`
    select i.id, i.email, i.role, i.invited_by_email, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.email_state, i.resend_count, p.name as portal_name
    from portal_invitations i join portals p on p.id = i.portal_id and p.org_id = i.org_id
    where i.org_id = ${w.orgId} and (${w.portalId}::uuid is null or i.portal_id = ${w.portalId})
    order by i.created_at desc limit ${Math.min(Math.max(limit, 1), 500)}`;
  const now = Date.now();
  return rows.map((i: any) => ({
    id: i.id as string, email: i.email as string, role: i.role as string, portal: i.portal_name as string, invitedBy: (i.invited_by_email ?? "") as string,
    sentAt: new Date(i.created_at).toISOString(), expiresAt: new Date(i.expires_at).toISOString(), acceptedAt: i.accepted_at ? new Date(i.accepted_at).toISOString() : null,
    status: i.accepted_at ? "accepted" : i.revoked_at ? "withdrawn" : new Date(i.expires_at).getTime() <= now ? "expired" : "waiting",
    emailState: (i.email_state ?? "not_sent") as string, resends: (i.resend_count ?? 0) as number,
  }));
}
