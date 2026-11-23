// A workflow status belongs to a candidate for one job (owner, 9 Nov 2026; migration 043). Shortlist and Not suitable on a match, and the later stages on a
// job's shortlist, are written here for that job only. The candidate's own status is kept as the headline: the furthest stage reached for any job, which
// the board shows and a hiring manager's sight depends on (hiringManager.ts). Every change is audited: who, which job, from what, to what. Nothing here
// decides anything about a person: a recruiter sets each status.
import { audit, sql } from "./db";
import { recordedFirst } from "./recorded";
import { ON_SHORTLIST } from "./shortlist";
import { compareRank } from "./scoring";
import { getSettings } from "./settings";
import { getRecord, getRecords } from "./store";
import type { Candidate, Job } from "./types";

const NOT_SUITABLE = "declined";
/** jobCompany: a job is named with its company wherever it stands beside a person, so thirty jobs with one title can be told apart (owner, 12 Nov 2026). */
export interface ApplicationView { id: string; candidateId: string; jobId: string; jobTitle: string; jobCompany: string; status: string; updatedAt: string }
export class ApplicationError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
const iso = (d: unknown) => new Date(d as any).toISOString();

/** Every application in the signed-in person's portal. `only`: the statuses to return (a hiring manager's are limited to the stages they may see). */
export async function listApplications(only?: readonly string[]): Promise<ApplicationView[]> {
  const rows = await sql`select a.id, a.candidate_id, a.job_id, a.status, a.updated_at, j.data->>'title' as title, j.data->>'company' as company from applications a join jobs j on j.id = a.job_id order by a.updated_at desc limit 5000`;
  return (rows as any[]).filter((r) => !only || only.includes(r.status)).map((r) => ({ id: r.id, candidateId: r.candidate_id, jobId: r.job_id, jobTitle: r.title ?? "", jobCompany: r.company ?? "", status: r.status, updatedAt: iso(r.updated_at) }));
}

/** The headline for a person: the furthest stage any job has them at, in the order the organisation lists its statuses; "new" when no job has them past it. */
function headlineOf(statuses: string[], order: string[]): string {
  const forward = statuses.filter((s) => s !== NOT_SUITABLE && s !== "new");
  return forward.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? "new";
}

/** Brings a candidate's headline in step with every status they hold, inside the caller's transaction (which holds the candidate's row). The version
 *  moves on with any change, so a screen still holding the earlier headline cannot write it back over this one. Returns the headline. */
export async function syncHeadline(q: any, orgId: string, candidateId: string, current: string, order: string[]) {
  const all = await q`select status from applications where candidate_id = ${candidateId}`;
  const headline = headlineOf((all as any[]).map((r) => r.status), order);
  if (headline !== current) await q`update candidates set data = jsonb_set(data, '{status}', to_jsonb(${headline}::text)), version = version + 1, updated_at = now() where id = ${candidateId} and org_id = ${orgId}`;
  return headline;
}

/** Sets (or, with null, clears) one candidate's status for one job, and brings the candidate's headline status in step, in one transaction. */
export async function setApplication(orgId: string, userId: string, candidateId: string, jobId: string, status: string | null, requestId: string) {
  const [candidate, job, { settings }] = await Promise.all([getRecord<Candidate>("candidate", orgId, candidateId), getRecord<Job>("job", orgId, jobId), getSettings(orgId)]);
  if (!candidate || !job) throw new ApplicationError("RES-001", "Candidate or job not found.", 404);
  const order = settings.statuses.map((s) => s.key), active = new Set(settings.statuses.filter((s) => s.active).map((s) => s.key));
  if (status !== null && (status === "new" || !active.has(status))) throw new ApplicationError("VAL-002", `"${status}" is not a status your organisation uses for a job.`);
  return sql.begin(async (q) => {
    // One person's statuses change one at a time (production review, 12 Nov 2026, P1 and P2): the candidate's row is locked, so two recruiters setting
    // statuses for the same person, on one job or on two, wait for each other, and the headline is worked out from every row as it stands after both.
    // Without it, the second of two first-time statuses failed on the unique key, and two jobs at once could leave the headline ignoring one of them.
    // The job is held first (only against its deletion), then the person: deleting a job takes them in the same order (deletion.ts), so the two can
    // never wait on each other in a circle.
    const [jobRow] = await q`select id from jobs where id = ${jobId} and org_id = ${orgId} for key share`;
    const [locked] = jobRow ? await q`select data->>'status' as status from candidates where id = ${candidateId} and org_id = ${orgId} for update` : [];
    if (!locked) throw new ApplicationError("RES-001", "Candidate or job not found.", 404);
    const [before] = await q`select id, status from applications where candidate_id = ${candidateId} and job_id = ${jobId}`;
    if ((before?.status ?? null) !== status) {
      if (status === null) await q`delete from applications where id = ${before.id}`;
      else await q`insert into applications (org_id, candidate_id, job_id, status, created_by, updated_by) values (${orgId}, ${candidateId}, ${jobId}, ${status}, ${userId}, ${userId})
        on conflict (candidate_id, job_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now()`;
      await audit(q, orgId, userId, "application.status_changed", "candidate", candidateId, { jobId, jobTitle: job.title, from: before?.status ?? null, to: status }, requestId);
      await syncHeadline(q, orgId, candidateId, locked.status ?? "new", order);
    }
    const [row] = await q`select a.id, a.candidate_id, a.job_id, a.status, a.updated_at from applications a where a.candidate_id = ${candidateId} and a.job_id = ${jobId}`;
    return row ? ({ id: row.id, candidateId, jobId, jobTitle: job.title ?? "", jobCompany: (job as any).company ?? "", status: row.status, updatedAt: iso(row.updated_at) } as ApplicationView) : null;
  });
}

/** A job's shortlist: everyone a recruiter has moved to Shortlisted for this job or further (shortlist.ts, the one definition the Overview and Needs
 *  attention count too; code review, 16 Nov 2026, G-M3: anyone not marked not suitable was listed, Reviewed included), each with their latest saved
 *  match, in the approved review order. Nothing is calculated: the scores are the saved ones. */
export async function shortlistOf(orgId: string, jobId: string, only?: readonly string[]) {
  const job = await getRecord<Job>("job", orgId, jobId);
  if (!job) return null;
  const apps = (await sql`select candidate_id, status, updated_at from applications where job_id = ${jobId} and status = any(${[...ON_SHORTLIST]})`) as any[];
  const kept = apps.filter((a) => !only || only.includes(a.status));
  if (!kept.length) return { job, rows: [] as { candidate: Candidate; status: string; matchResult: any }[] };
  const ids = kept.map((a) => a.candidate_id);
  // The matches and the people are fetched at the same time, each in one trip (written when a trip to the database in Ireland took about 0.2 s; it
  // stays the right shape wherever the database is).
  const [matches, people] = await Promise.all([
    sql`select distinct on (m.candidate_id) m.candidate_id, m.id, m.result, m.created_at from matches m where m.job_id = ${jobId} and m.candidate_id = any(${sql.array(ids)}::uuid[]) order by m.candidate_id, ${recordedFirst()}` as Promise<any[]>,
    getRecords<Candidate>("candidate", orgId, ids)]);
  const byCandidate = new Map(matches.map((m) => [m.candidate_id, { ...m.result, id: m.id, savedAt: iso(m.created_at) }]));
  const person = new Map(people.map((c) => [c.id, c]));
  const rows: { candidate: Candidate; status: string; matchResult: any }[] = [];
  for (const a of kept) { const candidate = person.get(a.candidate_id); if (candidate) rows.push({ candidate, status: a.status, matchResult: byCandidate.get(a.candidate_id) ?? null }); }
  const scored = (r: any) => r.matchResult && (!r.matchResult.ai || r.matchResult.ai.state === "checked");
  rows.sort((x, y) => Number(scored(y)) - Number(scored(x)) || (scored(x) ? compareRank({ ...x.matchResult, scoreFloor: x.matchResult.scoreFloor ?? x.matchResult.score, id: x.candidate.id }, { ...y.matchResult, scoreFloor: y.matchResult.scoreFloor ?? y.matchResult.score, id: y.candidate.id }) : 0));
  return { job, rows };
}
