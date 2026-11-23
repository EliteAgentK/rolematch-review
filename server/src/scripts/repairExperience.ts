// One-off repair (code review, 16 Nov 2026, C-H1): years of experience stored on candidates read before reader 2.16.0 counted every role a month short
// (dates.ts yearsCovered added end - start instead of end - start + 1), so three full years were stored as "2" and a 30-year career as "25". New readings
// count every month; this brings the candidates already read in step, from the work history each record holds now and the day its CV was uploaded (the
// date "Present" meant when it was read). Years of experience are worked out by the platform, never typed by a person, so nothing a recruiter wrote is
// replaced. Recorded matches keep what they recorded (owner, 10 Nov 2026: a recorded match never changes).
//   node src/scripts/repairExperience.js            what would change, by count and by before and after, writing nothing
//   node src/scripts/repairExperience.js --apply    the same, written: each change with a new version of the record and a line in the audit log by RoleMatch
//                                                   (on live also --target-confirmed: target.ts)
// Running it again changes nothing more.
import { audit, platformSql as sql } from "../db";
import { yearsCovered } from "../dates";
import { guardTarget } from "./target";

export const yearsOf = (workHistory: unknown, asOf: Date) => {
  const roles = Array.isArray(workHistory) ? workHistory.map((r: any) => ({ startDate: String(r?.startDate ?? ""), endDate: String(r?.endDate ?? "") })) : [];
  const years = yearsCovered(roles, asOf);
  return years ? String(Math.floor(years)) : "";
};

export async function repairExperience({ apply }: { apply: boolean }) {
  const rows = await sql`select c.id, c.org_id, c.data->'workHistory' as work, coalesce(c.data->>'experience', '') as stored, coalesce(d.created_at, c.created_at) as as_of
    from candidates c left join documents d on d.id = c.document_id and d.org_id = c.org_id`;
  const changes = rows.map((r: any) => ({ id: r.id as string, org: r.org_id as string, from: r.stored as string, to: yearsOf(r.work, new Date(r.as_of)) })).filter((c) => c.from !== c.to);
  if (apply) {
    for (const c of changes) await sql.begin(async (q) => {
      // Only if the record still holds what was read a moment ago: a record changed meanwhile is left for the next run.
      const [done] = await q`update candidates set data = jsonb_set(data, '{experience}', to_jsonb(${c.to}::text)), version = version + 1, updated_at = now()
        where id = ${c.id} and org_id = ${c.org} and coalesce(data->>'experience', '') = ${c.from} returning id`;
      if (done) await audit(q, c.org, null, "candidate.experience_recounted", "candidate", c.id, { field: "experience", from: c.from, to: c.to, reason: "every month a role covers is counted (code review, 16 Nov 2026, C-H1)" });
    });
  }
  const shift = new Map<string, number>();
  for (const c of changes) shift.set(`${c.from || "none"} -> ${c.to || "none"}`, (shift.get(`${c.from || "none"} -> ${c.to || "none"}`) ?? 0) + 1);
  return { candidates: rows.length, changed: changes.length, applied: apply, shifts: Object.fromEntries([...shift].sort((a, b) => b[1] - a[1])) };
}

if (import.meta.main) {
  // Writing says which database first, and needs --target-confirmed for live (target.ts); showing what would change only reads.
  if (process.argv.includes("--apply")) guardTarget("recount years of experience");
  repairExperience({ apply: process.argv.includes("--apply") })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); return sql.end({ timeout: 5 }); })
    .catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
