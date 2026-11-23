// Unusual activity, told to the owner (docs/architecture/PLAN_CONSOLE_OPERATIONS.md; owner, 12 Nov 2026: "things that need me are things that are urgent,
// things that are failing ... people can't read CVs, the AI ..."). Read from each portal's daily totals (portal_daily, migration 048) every 5 minutes by
// the monitor, each against its own usual: the last 14 days. Counts and cost only. A finding is raised once, seen while it lasts, and resolved by itself
// when it no longer holds, so it lands in the console's resolved history with how long it lasted.
import { platformSql as sql } from "./db";
import { orgCapUsd } from "./ai/claude";
import { sastDate, sastMonthStart } from "./sast";

export interface Finding { fingerprint: string; title: string; meaning: string; action: string }
export const UNUSUAL = { uploadsTimes: 10, uploadsAtLeast: 50, aiTimes: 5, aiAtLeastUsd: 2, allowanceShare: 0.8, failedShare: 0.1, failedAtLeast: 5 } as const;

/** What is unusual right now, as findings. Pure apart from its one read, so each rule is tested with figures. */
export function judge(rows: { portal: string; org: string; company: string; day: string; month: string; uploads: number; failed: number; usual: number }[],
  companies: { org: string; company: string; aiToday: number; aiUsual: number; spentMonth: number; cap: number }[], when: { day: string; month: string }): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (r.uploads >= UNUSUAL.uploadsAtLeast && r.uploads > UNUSUAL.uploadsTimes * r.usual)
      out.push({ fingerprint: `unusual:uploads:${r.portal}:${r.day}`, title: `${r.company} read ${r.uploads} CVs and jobs today, over ${UNUSUAL.uploadsTimes} times their usual`,
        meaning: `Their usual is about ${r.usual.toFixed(1)} a day over the last 14 days. It may be a big hiring drive, or something running on its own.`, action: "Open the portal in the console; if it looks wrong, ask the company." });
    const done = r.uploads + r.failed;
    if (r.failed >= UNUSUAL.failedAtLeast && r.failed > UNUSUAL.failedShare * done)
      out.push({ fingerprint: `unusual:failed:${r.portal}:${r.day}`, title: `${r.company}: ${r.failed} of ${done} documents could not be read today`,
        meaning: "More than one in ten of their documents failed to read. People there are waiting on CVs or jobs that will not appear.", action: "Open the portal's log through support access to see which files and why." });
  }
  for (const c of companies) {
    if (c.aiToday >= UNUSUAL.aiAtLeastUsd && c.aiToday > UNUSUAL.aiTimes * c.aiUsual)
      out.push({ fingerprint: `unusual:ai:${c.org}:${when.day}`, title: `${c.company} used $${c.aiToday.toFixed(2)} of AI today, over ${UNUSUAL.aiTimes} times their usual`,
        meaning: `Their usual is about $${c.aiUsual.toFixed(2)} a day. Every portal uses RoleMatch's own credits until each company has its own key.`, action: "Look at the portal; their monthly allowance stops it at its limit either way." });
    if (c.cap > 0 && c.spentMonth >= UNUSUAL.allowanceShare * c.cap)
      out.push({ fingerprint: `unusual:allowance:${c.org}:${when.month}`, title: `${c.company} has used ${Math.round((c.spentMonth / c.cap) * 100)}% of its monthly AI allowance`,
        meaning: `$${c.spentMonth.toFixed(2)} of $${c.cap.toFixed(2)} this month. At the allowance their AI stops until the month turns or you raise it.`, action: "Raise it on the portal's page in the console if they should go on." });
  }
  return out;
}

/** Reads today's totals and each company's month, then judges them. */
export async function unusualNow(): Promise<Finding[]> {
  const today = sastDate();
  const rows = await sql`with t as (select sast_day() as today)
    select d.portal_id::text as portal, d.org_id::text as org, g.name as company, t.today::text as day, to_char(t.today, 'YYYY-MM') as month, d.cvs + d.jobs as uploads, d.failed,
      coalesce((select sum(b.cvs + b.jobs) from portal_daily b where b.portal_id = d.portal_id and b.day >= t.today - 14 and b.day < t.today), 0) / 14.0 as usual
    from portal_daily d join orgs g on g.id = d.org_id, t where d.day = t.today`;
  const companies = await sql`with t as (select sast_day() as today)
    select g.id::text as org, g.name as company, g.ai_monthly_cap_usd as cap,
      coalesce((select sum(d.ai_micro_usd) from portal_daily d where d.org_id = g.id and d.day = t.today), 0) / 1e6 as ai_today,
      coalesce((select sum(d.ai_micro_usd) from portal_daily d where d.org_id = g.id and d.day >= t.today - 14 and d.day < t.today), 0) / 14e6 as ai_usual,
      coalesce((select sum(a.cost_micro_usd) from ai_usage a where a.org_id = g.id and a.at >= ${sastMonthStart()}), 0) / 1e6 as spent
    from orgs g, t`;
  return judge(rows.map((r: any) => ({ ...r, uploads: Number(r.uploads), failed: Number(r.failed), usual: Number(r.usual) })),
    companies.map((c: any) => ({ org: c.org, company: c.company, aiToday: Number(c.ai_today), aiUsual: Number(c.ai_usual), spentMonth: Number(c.spent), cap: c.cap == null ? orgCapUsd() : Number(c.cap) })),
    { day: today, month: today.slice(0, 7) });
}
