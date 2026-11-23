// The console's only way into the database (docs/database/18_CONSOLE_V0.md). Every query runs as rolematch_console inside one transaction, so it can use
// the console's three tables and call console_overview(), which returns counts, and nothing else: no row of any organisation's data (migration 035).
import { sql } from "../db";

type Q = any;
export const asConsole = (fn: (q: Q) => Promise<any>): Promise<any> =>
  sql.begin(async (q) => { await q`set local role rolematch_console`; return fn(q); });

export type Severity = "urgent" | "today" | "info";
export interface OwnerEvent {
  id: number; fingerprint: string; severity: Severity; source: string; title: string; meaning: string | null; action: string | null;
  first_at: Date; last_at: Date; times: number; cleared_at: Date | null; acknowledged_at: Date | null; muted_until: Date | null;
}

/** A problem has started, or started again. The same fingerprint while it is still open is one alert: its count rises, and it asks for attention again. */
export const raise = (e: { fingerprint: string; severity: Severity; source: string; title: string; meaning?: string; action?: string }) =>
  asConsole((q) => q`insert into owner_events (fingerprint, severity, source, title, meaning, action)
    values (${e.fingerprint}, ${e.severity}, ${e.source}, ${e.title.slice(0, 200)}, ${e.meaning ?? null}, ${e.action ?? null})
    on conflict (fingerprint) where cleared_at is null do update set last_at = now(), times = owner_events.times + 1, severity = excluded.severity,
      title = excluded.title, meaning = excluded.meaning, action = excluded.action, acknowledged_at = null
    returning id, times`).then((r: any[]) => r[0] as { id: number; times: number });

/** The problem is still there: seen now, but it has not happened again. Raised if it is not in the feed (its start was missed, say while the database was down). */
export const seen = (e: Parameters<typeof raise>[0]) =>
  asConsole((q) => q`insert into owner_events (fingerprint, severity, source, title, meaning, action)
    values (${e.fingerprint}, ${e.severity}, ${e.source}, ${e.title.slice(0, 200)}, ${e.meaning ?? null}, ${e.action ?? null})
    on conflict (fingerprint) where cleared_at is null do update set last_at = now(), severity = excluded.severity`);

/** Back to normal. The alert stays in the feed, marked with when it cleared. */
export const clearEvent = (fingerprint: string) =>
  asConsole((q) => q`update owner_events set cleared_at = now(), last_at = now() where fingerprint = ${fingerprint} and cleared_at is null returning id`).then((r: any[]) => r.length > 0);

/** Every monitor alert still open whose problem is not among those found now is cleared. The monitor remembers what it raised only while it runs, so an
 *  alert open when it restarted (every release restarts it) was never cleared: the owner saw "the service on the PC is not answering" a day after it
 *  answered again (12 Nov 2026). Checked against the stored alerts on every pass instead. */
export const clearMonitorExcept = (openFingerprints: string[]) =>
  asConsole((q) => q`update owner_events set cleared_at = now(), last_at = now() where fingerprint like 'monitor:%' and cleared_at is null and not (fingerprint = any(${openFingerprints}::text[])) returning id`).then((r: any[]) => r.length);

const RANK = { urgent: 0, today: 1, info: 2 } as const;
/** Open alerts first, the most serious first, then the newest; cleared ones from the last 7 days after them. */
export const listEvents = (severity?: Severity) =>
  asConsole((q) => q`select * from owner_events where (cleared_at is null or cleared_at > now() - interval '30 days') ${severity ? q`and severity = ${severity}` : q``}
    order by (cleared_at is null) desc, case severity when 'urgent' then 0 when 'today' then 1 else 2 end, last_at desc limit 200`) as Promise<OwnerEvent[]>;

export const getEvent = (id: number) => asConsole((q) => q`select * from owner_events where id = ${id}`).then((r: any[]) => (r[0] ?? null) as OwnerEvent | null);
export const acknowledge = (id: number) => asConsole((q) => q`update owner_events set acknowledged_at = now() where id = ${id} and acknowledged_at is null returning id`).then((r: any[]) => r.length > 0);
export const mute = (id: number, minutes: number) =>
  asConsole((q) => q`update owner_events set muted_until = now() + (${Math.min(Math.max(minutes, 1), 24 * 60)} * interval '1 minute') where id = ${id} and cleared_at is null returning id`).then((r: any[]) => r.length > 0);

/** What still asks for the owner: open, not acknowledged, not muted. */
export function needsYou(events: OwnerEvent[], now = new Date()) {
  // A notice (severity info) tells the owner something happened; it does not need them, so it never counts here or turns the page amber (12 Nov 2026).
  return events.filter((e) => e.severity !== "info" && !e.cleared_at && !e.acknowledged_at && !(e.muted_until && e.muted_until > now)).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
