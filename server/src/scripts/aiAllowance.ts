// Each company's monthly AI allowance (supabase/migrations/047_org_ai_allowance.sql; owner, 12 Nov 2026: "can't have people driving up my clients' AI costs").
//   node src/scripts/aiAllowance.js                         every company: this month's AI spend and its allowance
//   node src/scripts/aiAllowance.js <company id> <dollars>  sets one company's allowance (0 stops its AI; "default" returns it to the platform's)
// Run on the PC through deploy/pc/ai-allowance.sh, as the database's owner: the application itself can read an allowance but never change one. Each change
// is written to the audit log with the figure before and after.
import { sql } from "../db";
import { orgCapUsd } from "../ai/claude";
import { sastMonthStart } from "../sast";
import { guardTarget, ownArgs } from "./target";

const [orgId, value] = ownArgs();
const money = (micro: number | string) => `$${(Number(micro) / 1e6).toFixed(2)}`;
async function list() {
  const rows = await sql`select o.id, o.name, o.created_at, o.ai_monthly_cap_usd as cap,
      coalesce((select sum(u.cost_micro_usd) from ai_usage u where u.org_id = o.id and u.at >= ${sastMonthStart()}), 0)::bigint as month
    from orgs o order by month desc, o.created_at`;
  for (const r of rows) console.log(`${r.id}  ${money(r.month)} of $${r.cap == null ? `${orgCapUsd()} (the platform's)` : Number(r.cap).toFixed(2)}  ${String(r.name).slice(0, 40)}`);
  console.log(`${rows.length} companies. A new company gets the platform's allowance: $${orgCapUsd()} (AI_ORG_MONTHLY_CAP_USD).`);
}
try {
  if (!orgId) await list();
  else {
    if (!/^[0-9a-f-]{36}$/.test(orgId) || !value || !(value === "default" || /^\d{1,6}(\.\d{1,2})?$/.test(value))) throw new Error("Usage: aiAllowance.js <company id> <dollars, e.g. 20 or 7.50, or default>");
    const cap = value === "default" ? null : Number(value);
    guardTarget("ai-allowance");   // changing one: which database, and never live or one elsewhere unless told on purpose (target.ts; code review, 16 Nov 2026, D-M5)
    await sql.begin(async (q) => {
      const [before] = await q`select name, ai_monthly_cap_usd as cap from orgs where id = ${orgId} for update`;
      if (!before) throw new Error(`No company ${orgId}.`);
      await q`update orgs set ai_monthly_cap_usd = ${cap} where id = ${orgId}`;
      await q`insert into audit_events (org_id, actor_id, action, entity_type, entity_id, detail) values (${orgId}, null, 'ai_allowance.set', 'org', ${orgId},
        ${q.json({ by: "the owner, at the PC's terminal", before: before.cap == null ? null : Number(before.cap), after: cap })})`;
      console.log(`${before.name}: monthly AI allowance ${before.cap == null ? "the platform's" : `$${Number(before.cap).toFixed(2)}`} -> ${cap == null ? `the platform's ($${orgCapUsd()})` : `$${cap.toFixed(2)}`}. It applies within 30 seconds.`);
    });
  }
} finally { await sql.end({ timeout: 5 }); }
