// One trip to the database for a whole console page (owner, 11 Nov 2026: "console is also a bit slow when I press something, it takes seconds"). Each
// read used to be its own transaction (begin, set role, query, commit: four trips there and back, one after another, about 0.2 s each to Ireland), and
// a page made three or four of them in a row. Here the session check, the alerts and everything the page shows go in one pipelined transaction as
// rolematch_console: one trip. The heavy summaries are kept for 15 seconds, shared by every page, so moving between pages asks only for what changed.
import { createHash } from "node:crypto";
import { sql } from "../db";
import { IDLE_MS } from "./auth";
import type { OwnerEvent } from "./store";
import { periodOf, type Period } from "./period";

export type Summary = "overview" | "activity" | "organisations" | "database" | "people" | "schema" | "ai" | "portals" | "period";
const CALL: Record<Summary, (q: any, p: Period, page: number) => any> = {
  overview: (q) => q`select console_overview() as v`, activity: (q) => q`select console_activity(30) as v`, organisations: (q) => q`select console_organisations() as v`,
  database: (q) => q`select console_database() as v`, people: (q, _p, page) => q`select console_people(${page}) as v`, schema: (q) => q`select console_schema() as v`, ai: (q) => q`select console_ai() as v`,
  portals: (q) => q`select console_portals() as v`,
  // the period the owner chose (period.ts, migration 051), kept apart for each period
  period: (q, p) => q`select console_period(${p.from}, ${p.to}, ${p.before}, ${p.step}) as v`,
};
// Portals are kept for 2 seconds only (owner, 11 Nov 2026: each portal's use "needs to refresh, almost instantaneously"); the rest for 15.
const KEEP_MS = 9_000, KEEP: Partial<Record<Summary, number>> = { portals: 2_000 }, kept = new Map<string, { at: number; value: any }>();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export interface Trip { session: { started_at: Date; ends_at: Date; owner_email?: string | null } | null; events: OwnerEvent[]; data: Partial<Record<Summary, any>>; errors: Partial<Record<Summary, string>> }

/** The session (touched, as sessionFor does, unless the page reloaded itself: byPerson false), the alerts, and the summaries asked for: whatever is not
 *  kept already, in one pipelined trip. */
export async function trip(sid: string | undefined, wants: Summary[], now = Date.now(), period: Period = periodOf(null), byPerson = true, peoplePage = 1): Promise<Trip> {
  // The People list comes a page at a time (migration 057), each page kept apart.
  const name = (k: Summary) => (k === "period" ? `period:${period.key}` : k === "people" ? `people:${peoplePage}` : k);
  const fresh = (k: Summary) => { const h = kept.get(name(k)); return h && now - h.at < (KEEP[k] ?? KEEP_MS) ? h.value : undefined; };
  const need = wants.filter((k) => fresh(k) === undefined);
  const valid = !!sid && sid.length <= 64;
  const out: Trip = { session: null, events: [], data: {}, errors: {} };
  const results: any[] = await sql.begin((q: any) => [
    q`set local role rolematch_console`,
    !valid ? q`select 1 where false`
      : byPerson ? q`update console_sessions set last_used_at = now() where id_hash = ${hash(sid!)} and ended_at is null and ends_at > now() and last_used_at > now() - (${IDLE_MS / 1000} * interval '1 second') returning started_at, ends_at, owner_email`
      : q`select started_at, ends_at, owner_email from console_sessions where id_hash = ${hash(sid!)} and ended_at is null and ends_at > now() and last_used_at > now() - (${IDLE_MS / 1000} * interval '1 second')`,
    // a year of alerts, so any period the owner chooses has its resolved history (each page shows the chosen period's)
    q`select * from owner_events where (cleared_at is null or cleared_at > now() - interval '400 days') order by (cleared_at is null) desc, case severity when 'urgent' then 0 when 'today' then 1 else 2 end, last_at desc limit 500`,
    ...need.map((k) => CALL[k](q, period, peoplePage)),
  ]);
  out.session = (results[1]?.[0] ?? null) as Trip["session"];
  out.events = (results[2] ?? []) as OwnerEvent[];
  need.forEach((k, i) => { const v = results[3 + i]?.[0]?.v; kept.set(name(k), { at: now, value: v }); });
  for (const k of wants) out.data[k] = fresh(k) ?? kept.get(name(k))?.value;
  return out;
}
