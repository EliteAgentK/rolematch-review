// Needs attention (owner, 10 Nov 2026: "think of all the things our platform already does and where the issues could be that would need recruiter
// attention ... it should always be relevant ... there can't always be something to do ... when does this pop up, when does that pop up"). Each rule is
// work that waits on a recruiter, never a fault of the platform's (a document the platform could not read is its problem to solve, not the recruiter's).
// A rule is one query that returns the records it is about, so the count on the Overview and the list the Matching Board shows are the same records,
// for everyone in the portal. A rule with nothing to show is not shown; with nothing at all, the page says so. Read inside the portal (row rules), and every
// query names the organisation and the portal as well. No AI: these are counted from what is already recorded. When each appears is set here, in one
// place (docs/product/NEEDS_ATTENTION.md); the organisation's own settings come next.
import { sql } from "./db";
import { recordedFirst } from "./recorded";
import { ON_SHORTLIST } from "./shortlist";
import type { Session } from "./auth";

/** When each rule appears. Days are whole days since the last change that matters. */
const ATTENTION_RULES = {
  "interview-no-update": { days: 5, title: "Interview stage, no update", detail: (d: number) => `In an interview stage for ${d}+ days without a change` },
  "shortlist-waiting": { days: 5, title: "Shortlisted, waiting", detail: (d: number) => `On a shortlist for ${d}+ days without a next step` },
  "strong-not-acted": { score: 80, days: 30, title: "Strong matches not acted on", detail: (s: number) => `Scored ${s}+ by the AI, not yet on the job's list or turned down` },
  "job-no-shortlist": { days: 7, title: "Open jobs with no shortlist", detail: (d: number) => `Open ${d}+ days with nobody shortlisted` },
  "new-not-matched": { after: 2, within: 14, title: "New candidates not matched", detail: (a: number) => `Added ${a}+ days ago, an open job in their department, not matched yet` },
} as const;
export type AttentionRule = keyof typeof ATTENTION_RULES;
/** Most urgent first: people mid-process before work not yet started. */
const ATTENTION_ORDER: AttentionRule[] = ["interview-no-update", "shortlist-waiting", "strong-not-acted", "job-no-shortlist", "new-not-matched"];
export const isAttentionRule = (v: string): v is AttentionRule => (ATTENTION_ORDER as string[]).includes(v);

const openJob = () => sql`coalesce(j.data->>'status', 'draft') not in ('closed', 'archived')`;
const FORWARD = [...ON_SHORTLIST];   // one definition of "on the shortlist" (shortlist.ts; code review, 16 Nov 2026, G-M3)
const INTERVIEW = ["awaiting interview", "interviewing", "interviewed"];

/** The records one rule is about: candidate ids and job ids, at most `limit` pairs. */
export interface AttentionItem { candidateId?: string; jobId?: string; name?: string; title?: string; score?: number; status?: string }
export async function attentionRecords(s: Session, rule: AttentionRule, limit = 500): Promise<{ candidateIds: string[]; jobIds: string[]; count: number; about: ("candidates" | "jobs")[]; items: AttentionItem[] }> {
  const org = s.orgId, portal = s.portalId!;
  let rows: { c: string | null; j: string | null; score?: string | number | null; status?: string | null }[] = [];
  if (rule === "interview-no-update" || rule === "shortlist-waiting") {
    const r = ATTENTION_RULES[rule], statuses = rule === "shortlist-waiting" ? ["shortlisted"] : INTERVIEW;
    rows = await sql`select a.candidate_id as c, a.job_id as j, a.status from applications a join jobs j on j.id = a.job_id and j.org_id = a.org_id
      where a.org_id = ${org} and a.portal_id = ${portal} and a.status = any(${statuses}) and a.updated_at < now() - (${r.days} * interval '1 day') and ${openJob()}
      order by a.updated_at limit ${limit}` as any;
  } else if (rule === "strong-not-acted") {
    const r = ATTENTION_RULES[rule];
    rows = await sql`select x.c, x.j, x.score from (select distinct on (m.candidate_id, m.job_id) m.candidate_id as c, m.job_id as j, (m.result->>'score')::numeric as score, m.created_at
        from matches m where m.org_id = ${org} and m.portal_id = ${portal} and m.result->'ai'->>'state' = 'checked'
        order by m.candidate_id, m.job_id, ${recordedFirst()}) x
      join jobs j on j.id = x.j and j.org_id = ${org}
      where x.created_at > now() - (${r.days} * interval '1 day') and x.score >= ${r.score} and ${openJob()} and not exists (select 1 from applications a where a.candidate_id = x.c and a.job_id = x.j)
      order by x.score desc limit ${limit}` as any;
  } else if (rule === "job-no-shortlist") {
    const r = ATTENTION_RULES[rule];
    rows = await sql`select null::uuid as c, j.id as j from jobs j where j.org_id = ${org} and j.portal_id = ${portal} and ${openJob()} and j.created_at < now() - (${r.days} * interval '1 day')
      and not exists (select 1 from applications a where a.job_id = j.id and a.status = any(${FORWARD})) order by j.created_at limit ${limit}` as any;
  } else {
    const r = ATTENTION_RULES[rule];
    rows = await sql`select c.id as c, null::uuid as j from candidates c where c.org_id = ${org} and c.portal_id = ${portal}
      and c.created_at < now() - (${r.after} * interval '1 day') and c.created_at > now() - (${r.within} * interval '1 day')
      and coalesce(c.data->>'group', '') <> '' and not exists (select 1 from matches m where m.candidate_id = c.id)
      and exists (select 1 from jobs j where j.org_id = ${org} and j.portal_id = ${portal} and ${openJob()} and j.data->>'group' = c.data->>'group')
      order by c.created_at limit ${limit}` as any;
  }
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x).map(String))];
  const candidateIds = uniq(rows.map((r) => r.c)), jobIds = uniq(rows.map((r) => r.j));
  // What is counted is what a recruiter acts on: people for the rules about people, jobs for the rule about jobs.
  // Which of the board's lists the rule is about: those lists show exactly these records (none, when nothing waits any more); the other list stays whole.
  const about: ("candidates" | "jobs")[] = rule === "job-no-shortlist" ? ["jobs"] : rule === "new-not-matched" ? ["candidates"] : ["candidates", "jobs"];
  // Each item by name, for the Overview to show in place (owner, 10 Nov 2026: "we need a better way to show what those matches are instead of returning
  // to the dashboard"): the person and the job, with the AI's score or the status that is waiting. The first 50; the board shows them all.
  const shownRows = rows.slice(0, 50), cids = uniq(shownRows.map((r) => r.c)), jids = uniq(shownRows.map((r) => r.j));
  const names = new Map<string, string>(cids.length ? (await sql`select id, data->>'name' as n from candidates where org_id = ${org} and id = any(${cids}::uuid[])`).map((r: any) => [String(r.id), String(r.n ?? "")]) : []);
  const titles = new Map<string, string>(jids.length ? (await sql`select id, data->>'title' as t from jobs where org_id = ${org} and id = any(${jids}::uuid[])`).map((r: any) => [String(r.id), String(r.t ?? "")]) : []);
  const items: AttentionItem[] = shownRows.map((r) => ({ ...(r.c ? { candidateId: String(r.c), name: names.get(String(r.c)) ?? "" } : {}), ...(r.j ? { jobId: String(r.j), title: titles.get(String(r.j)) ?? "" } : {}),
    ...(r.score != null ? { score: Math.round(Number(r.score)) } : {}), ...(r.status ? { status: String(r.status) } : {}) }));
  return { candidateIds, jobIds, count: rule === "job-no-shortlist" ? jobIds.length : rows.length, about, items };
}

/** Every rule that has something waiting, most urgent first. Empty when nothing waits: that is a real answer, shown as such. */
export async function attentionList(s: Session) {
  // Asked two at a time (the Overview already asks its own questions four at a time), answered in the rules' order.
  const counts: number[] = [];
  for (let i = 0; i < ATTENTION_ORDER.length; i += 2) counts.push(...(await Promise.all(ATTENTION_ORDER.slice(i, i + 2).map(async (id) => (await attentionRecords(s, id)).count))));
  return ATTENTION_ORDER.flatMap((id, i) => { const r = ATTENTION_RULES[id] as any; return counts[i] > 0 ? [{ id, title: r.title, detail: r.detail(r.score ?? r.days ?? r.after) as string, count: counts[i] }] : []; });
}
