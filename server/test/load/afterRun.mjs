// After a crowd: what the database holds, because a good answer to the crowd proves little if a record was lost, doubled or stuck. Also writes out what was read from each pack document, for scoring against its key.
//   run in tools\bench\server: node ../../afterRun.mjs <out.json> <docs out dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "x.js")), postgres = require("postgres");
const url = process.env.DATABASE_URL, [out, dir] = process.argv.slice(2), sql = postgres(url, { max: 2, onnotice: () => {} });
const one = async (q) => (await sql.unsafe(q));
const r = {};
r.documents = await one(`select status, stage, error_code, count(*)::int as n from documents where created_at > now() - interval '3 hours' group by 1,2,3 order by 4 desc`);
r.queue = await one(`select type, status, count(*)::int as n from queue where created_at > now() - interval '3 hours' group by 1,2 order by 1,2`);
r.queueErrors = await one(`select left(last_error, 160) as e, count(*)::int as n from queue where last_error is not null and created_at > now() - interval '3 hours' group by 1 order by 2 desc limit 20`);
r.stuck = await one(`select count(*)::int as n from documents where status = 'processing' and updated_at < now() - interval '10 minutes'`);
r.publishedWithoutRecord = await one(`select count(*)::int as n from documents where status = 'published' and record_id is null`);
r.doubleRecords = await one(`select (select count(*) from (select document_id from candidates group by 1 having count(*) > 1) x)::int as candidates, (select count(*) from (select document_id from jobs group by 1 having count(*) > 1) x)::int as jobs`);
r.wrongPortal = await one(`select (select count(*) from candidates c join documents d on d.id = c.document_id where c.portal_id <> d.portal_id or c.org_id <> d.org_id)::int as candidates, (select count(*) from matches m join candidates c on c.id = m.candidate_id join jobs j on j.id = m.job_id where m.org_id <> c.org_id or m.org_id <> j.org_id)::int as matches`);
r.holdsLeft = await one(`select count(*)::int as n from quota_holds`);
r.matches = await one(`select count(*)::int as n, count(distinct org_id)::int as orgs from matches where created_at > now() - interval '3 hours'`);
r.limits = await one(`select p.name, o.name as org, (select count(*) from documents d where d.portal_id = p.id and d.created_at > now() - interval '24 hours')::int as documents_today from portals p join orgs o on o.id = p.org_id order by 3 desc limit 6`);
r.fairness = await one(`with w as (select portal_id, extract(epoch from (updated_at - created_at)) as s from documents where status = 'published' and created_at > now() - interval '3 hours') select count(distinct portal_id)::int as portals, round(percentile_cont(0.5) within group (order by s))::int as p50, round(percentile_cont(0.95) within group (order by s))::int as p95, round(max(s))::int as worst from w`);
r.modelReviews = await one(`select kind, status, count(*)::int as n, round(avg(ms))::int as avg_ms from model_reviews group by 1,2 order by 1,2`);
r.audit = await one(`select count(*)::int as n from audit_events where created_at > now() - interval '3 hours'`);
r.slowest = await one(`select calls::int, round(mean_exec_time::numeric, 1)::float as mean_ms, round(total_exec_time)::int as total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 100) as q from extensions.pg_stat_statements where query not ilike '%pg_stat%' order by total_exec_time desc limit 14`);
writeFileSync(out, JSON.stringify(r, null, 1));
if (dir) {
  mkdirSync(dir, { recursive: true });
  const docs = await one(`select d.original_name as name, d.kind, d.status, d.error_code, d.org_id, d.source_text as text, coalesce(c.data, j.data) as record from documents d left join candidates c on c.document_id = d.id left join jobs j on j.document_id = d.id where d.original_name ~ '^(CV|JD)[0-9]+[.]' and d.created_at > now() - interval '3 hours'`);
  const seen = new Map(); let same = 0, differ = 0;
  for (const d of docs) {
    const key = d.name, rec = JSON.stringify({ ...(d.record ?? {}), id: 0, documentId: 0, originalDocumentUrl: 0, status: 0, version: 0, notes: 0, createdAt: 0, updatedAt: 0 });
    if (seen.has(key)) { if (seen.get(key) === rec) same++; else differ++; continue; }
    seen.set(key, rec);
    const cond = /[.]docx$/.test(key) ? "01_Word" : "02_Searchable_PDF", id = key.split(".")[0];
    writeFileSync(join(dir, `${cond}__${id}.json`), JSON.stringify({ ok: d.status === "published" && !!d.record, status: d.status, error: d.error_code, record: d.record, text: d.text }));
  }
  console.log(`${docs.length} pack documents, ${seen.size} different; read again in another organisation: ${same} identical, ${differ} different`);
}
await sql.end(); console.log("written");
