// The Overview page's figures for one organisation (owner, 10 Nov 2026; docs/architecture/PLAN_OVERVIEW.md). Every figure is counted from what RoleMatch
// already records, read inside the request's own organisation and portal (forPortal: the database's row rules apply), nothing new is stored, and nothing
// here is estimated or invented: a figure the platform does not hold yet (credits remaining, before per-company billing) is said to be missing, never made up.
// Served from a one-minute cache per portal (index.ts), so a page that refreshes every minute costs one small read per organisation per minute.
import { sql } from "./db";
import { recordedFirst } from "./recorded";
import { ON_SHORTLIST } from "./shortlist";
import { sastDates, sastDayOf, sastDayStart, sastMonth, sastMonthStart } from "./sast";
import { attentionList } from "./attention";
import { activityHistory } from "./history";
import type { Session } from "./auth";

export interface OrgOverview {
  days: number; generatedAt: string;
  credits: { usedUsd: number; usedRand: number; month: string; allowanceRand: null };
  candidates: { total: number; inPeriod: number; previous: number };
  jobs: { open: number; newInPeriod: number };
  shortlisted: { count: number; jobs: number; previous: number };
  /** each day of the period: CVs read, jobs opened, matches run, people shortlisted */
  series: { dates: string[]; cv: number[]; jobs: number[]; match: number[]; sl: number[] };
  pipeline: { read: number; matched: number; shortlisted: number; interviewing: number; hired: number };
  strongest: { candidateId: string; candidateName: string; candidateRole: string; jobId: string; jobTitle: string; jobCompany: string; jobLocation: string; score: number }[];
  /** every department with open jobs or candidates: `open` jobs, and `candidates` whose work belongs to it */
  families: { name: string; open: number; candidates: number }[];
  experience: { band: string; count: number }[];
  /** what waits on a recruiter, most urgent first (attention.ts); empty when nothing does */
  attention: { id: string; title: string; detail: string; count: number }[];
  /** the team's latest actions; `candidateId`/`jobId` name the records each was about, for the Matching Board to open (`match`: a match was run) */
  activity: { who: string; whoEmail?: string; what: string; at: string; candidateId?: string; jobId?: string; match?: boolean }[];
}

/** Rand per US dollar only while no day's rate is kept yet (fx_rates, migration 048); otherwise each AI line is converted at its own day's rate. */
const usdToZar = () => Number(process.env.USD_TO_ZAR ?? 18.5);
const FORWARD = [...ON_SHORTLIST];   // one definition of "on the shortlist" (shortlist.ts; code review, 16 Nov 2026, G-M3)
const INTERVIEW = ["awaiting interview", "interviewing", "interviewed"];
const n = (v: unknown) => Number(v ?? 0);

/** Runs the given questions side by side, at most four at once, and returns their answers in the order given. */
async function fourAtATime(tasks: readonly (() => Promise<any>)[]): Promise<any[]> {
  const out: any[] = new Array(tasks.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
  return out;
}

export async function orgOverview(s: Session, days: number): Promise<OrgOverview> {
  // Each query names the organisation and portal itself as well: the database's row rules already allow nothing else, and this keeps it so for any table.
  const since = `${days} days`, now = new Date(), org = s.orgId, portal = s.portalId!;
  // The period is the days the chart shows: today and the days before it, whole Johannesburg days, so every figure of the period counts exactly what is
  // drawn. The period before is as long as this one so far: from the same moment of the day, one period earlier, to now one period earlier. Before, the
  // period was "now minus N days", so the hours of its oldest day before midnight were counted but drawn on no day, and the change set a shortened
  // period against a full one (code review, 16 Nov 2026, G-M1).
  const from = () => sastDayStart(days - 1), inPeriod = (c: "created_at" | "updated_at") => sql`${sql(c)} >= ${from()}`;
  const before = (c: "created_at" | "updated_at") => sql`${sql(c)} >= ${from()} - ${since}::interval and ${sql(c)} < now() - ${since}::interval`;
  // The questions are independent, so they are asked side by side, at most four at a time (the pool holds eight, and the rest serve other requests).
  // Asked one after another they cost one round trip each, and live's database is far from its server (10 Nov 2026: about 20 round trips, many seconds).
  const perDay = async (q: Promise<any[]>) => new Map((await q).map((r: any) => [String(r.d).slice(0, 10), n(r.c)]));
  const [[cand], [jobs], [sl], [flow], [slPrev], cv, opened, match, shortl, [matched], strongest, families, bands, attention, [ai], activityRows] = await fourAtATime([
    () => sql`select count(*)::int as total, count(*) filter (where ${inPeriod("created_at")})::int as in_period,
      count(*) filter (where ${before("created_at")})::int as previous from candidates where org_id = ${org} and portal_id = ${portal}`,
    () => sql`select count(*) filter (where coalesce(data->>'status', 'draft') not in ('closed', 'archived'))::int as open,
      count(*) filter (where ${inPeriod("created_at")})::int as new_in_period from jobs where org_id = ${org} and portal_id = ${portal}`,
    // On shortlists now: people past New and not turned down, for jobs still open (a closed job's shortlist is history, not work in hand).
    () => sql`select count(*)::int as count, count(distinct a.job_id)::int as jobs
      from applications a join jobs j on j.id = a.job_id and j.org_id = a.org_id
      where a.org_id = ${org} and a.portal_id = ${portal} and a.status = any(${FORWARD}) and coalesce(j.data->>'status', 'draft') not in ('closed', 'archived')`,
    // The period's flow, stage by stage, from the audit trail: moves to a shortlist (as the day series counts them), and each person for a job who reached an
    // interview stage or was hired, once, however many of the three interview stages they went through (code review, 16 Nov 2026, G-M2: one person
    // through all three counted three times). The stages count different people over the period, so the page shows no stage as a share of another.
    () => sql`select count(*) filter (where detail->>'to' = 'shortlisted')::int as shortlisted,
      count(distinct entity_id::text || '|' || coalesce(detail->>'jobId', '')) filter (where detail->>'to' = any(${INTERVIEW}))::int as interviewing,
      count(distinct entity_id::text || '|' || coalesce(detail->>'jobId', '')) filter (where detail->>'to' = 'hired')::int as hired from audit_events
      where org_id = ${org} and portal_id = ${portal} and action = 'application.status_changed' and ${inPeriod("created_at")}`,
    () => sql`select count(*)::int as n from audit_events where org_id = ${org} and portal_id = ${portal} and action = 'application.status_changed' and detail->>'to' = 'shortlisted'
      and ${before("created_at")}`,
    // Day by day: CVs read (published), jobs opened, matches run, people shortlisted for a job.
    () => perDay(sql`select ${sastDayOf("updated_at")}::text as d, count(*)::int as c from documents where org_id = ${org} and portal_id = ${portal} and kind = 'cv' and status = 'published' and ${inPeriod("updated_at")} group by 1`),
    () => perDay(sql`select ${sastDayOf("created_at")}::text as d, count(*)::int as c from jobs where org_id = ${org} and portal_id = ${portal} and ${inPeriod("created_at")} group by 1`),
    () => perDay(sql`select ${sastDayOf("created_at")}::text as d, count(*)::int as c from matches where org_id = ${org} and portal_id = ${portal} and ${inPeriod("created_at")} group by 1`),
    () => perDay(sql`select ${sastDayOf("created_at")}::text as d, count(*)::int as c from audit_events where org_id = ${org} and portal_id = ${portal} and action = 'application.status_changed' and detail->>'to' = 'shortlisted' and ${inPeriod("created_at")} group by 1`),
    () => sql`select count(distinct candidate_id)::int as n from matches where org_id = ${org} and portal_id = ${portal} and ${inPeriod("created_at")}`,
    // The strongest scored pairs of the period: each pair's recorded match (recorded.ts), the one its assessment opens on, made in the period.
    () => sql`select * from (select distinct on (m.candidate_id, m.job_id) m.candidate_id, m.job_id, (m.result->>'score')::numeric as score, m.created_at,
        c.data->>'name' as cname, c.data->>'role' as crole, c.data->'displayNames' as names, j.data->>'title' as jtitle, j.data->>'location' as jloc, j.data->>'company' as jco
      from matches m join candidates c on c.id = m.candidate_id join jobs j on j.id = m.job_id
      where m.org_id = ${org} and m.portal_id = ${portal} and m.result->'ai'->>'state' = 'checked' and m.result->>'score' is not null order by m.candidate_id, m.job_id, ${recordedFirst()}) x
      where x.created_at >= ${from()} order by score desc limit 3`,
    // Each standard department with its open jobs (jobReader.ts, JOB_DEPARTMENTS) and the candidates whose work belongs to it (department.ts), so the
    // page can rank by either and show both; a record read before departments existed is not grouped yet. At most 20 departments, so every one is returned.
    () => sql`select name, sum(o)::int as open, sum(c)::int as candidates from (
        select coalesce(nullif(data->>'group', ''), 'Not grouped yet') as name, 1 as o, 0 as c from jobs
          where org_id = ${org} and portal_id = ${portal} and coalesce(data->>'status', 'draft') not in ('closed', 'archived')
        union all
        select coalesce(nullif(data->>'group', ''), 'Not grouped yet'), 0, 1 from candidates where org_id = ${org} and portal_id = ${portal}) x
      group by 1 order by 2 desc, 3 desc, 1`,
    // Years of dated experience of the people who came in this period; a CV with no dated experience is not put in a band.
    () => sql`select case when e < 3 then 'Up to 2 years' when e < 6 then '3 to 5 years' when e < 11 then '6 to 10 years' else 'Over 10 years' end as band, count(*)::int as c
      from (select (data->>'experience')::numeric as e from candidates where org_id = ${org} and portal_id = ${portal} and ${inPeriod("created_at")}
        and coalesce(data->>'experience', '') ~ '^[0-9]+([.][0-9]+)?$') x group by 1`,
    () => attentionList(s),
    // Each line in rands at the rate of its own day (migration 048; owner, 12 Nov 2026: the portals in rands, "always paying attention to the fluctuating
    // exchange rates"); r is null while no rate is kept, and the page then falls back to the set rate and says "about".
    () => sql`select coalesce(sum(cost_micro_usd), 0)::bigint as m, sum(cost_micro_usd * usd_zar_on(sast_day(at))) as r
      from ai_usage where org_id = ${org} and portal_id = ${portal} and at >= ${sastMonthStart()}`,
    () => activityHistory(s, "portal", 50, { detail: true }),
  ] as const) as any[];
  const dates = sastDates(days, now);   // Johannesburg's days, as the buckets above (code review, 16 Nov 2026, C-M5)
  const activity = (activityRows as any[]).map((a: any) => ({ who: a.who, whoEmail: a.whoEmail, what: a.what, at: a.at, ...(a.candidateId ? { candidateId: a.candidateId } : {}), ...(a.jobId ? { jobId: a.jobId } : {}), ...(a.match ? { match: true } : {}) }));
  const usedUsd = n(ai.m) / 1e6, order = ["Up to 2 years", "3 to 5 years", "6 to 10 years", "Over 10 years"], byBand = new Map<string, number>(bands.map((b: any) => [b.band, n(b.c)]));
  return {
    days, generatedAt: now.toISOString(),
    credits: { usedUsd: +usedUsd.toFixed(2), usedRand: ai.r != null ? Math.round(Number(ai.r) / 1e6) : Math.round(usedUsd * usdToZar()), month: sastMonth(now), allowanceRand: null },
    candidates: { total: n(cand.total), inPeriod: n(cand.in_period), previous: n(cand.previous) },
    jobs: { open: n(jobs.open), newInPeriod: n(jobs.new_in_period) },
    shortlisted: { count: n(sl.count), jobs: n(sl.jobs), previous: n(slPrev.n) },
    series: { dates, cv: dates.map((d) => cv.get(d) ?? 0), jobs: dates.map((d) => opened.get(d) ?? 0), match: dates.map((d) => match.get(d) ?? 0), sl: dates.map((d) => shortl.get(d) ?? 0) },
    pipeline: { read: n(cand.in_period), matched: n(matched.n), shortlisted: n(flow.shortlisted), interviewing: n(flow.interviewing), hired: n(flow.hired) },
    strongest: strongest.map((r: any) => ({ candidateId: r.candidate_id, candidateName: r.cname ?? "", candidateRole: (r.names && r.crole && r.names[r.crole]) || (r.crole ?? ""), jobId: r.job_id, jobTitle: r.jtitle ?? "", jobLocation: r.jloc ?? "", jobCompany: r.jco ?? "", score: Math.round(n(r.score)) })),
    families: families.map((f: any) => ({ name: f.name, open: n(f.open), candidates: n(f.candidates) })),
    experience: order.map((band) => ({ band, count: byBand.get(band) ?? 0 })),
    attention,
    activity,
  };
}
