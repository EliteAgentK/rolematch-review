// Where a day and a month begin, for everything that decides money or counts: South African time (code review, 16 Nov 2026, C-M5; G4 in
// docs/architecture/PLAN_PORTAL_BILLING.md). The database runs on UTC, so date_trunc(..., now()) began each month and day two hours late in Johannesburg.
// The boundaries themselves are database functions (supabase/migrations/065_sast_boundaries.sql), so the service and the console cut at the same moment;
// these are the pieces a query places them with, and the same dates for the service's own labels. South Africa keeps no summer time.
import { sql } from "./db";

const TZ = "Africa/Johannesburg";
/** The moment this Johannesburg month began, for a query: `at >= ${sastMonthStart()}`. */
export const sastMonthStart = () => sql`sast_month_start()`;
/** The moment the Johannesburg day `daysAgo` days before today began (0: today), for a query. */
export const sastDayStart = (daysAgo = 0) => sql`sast_day_start(sast_day() - ${daysAgo}::int)`;
/** A calendar month (YYYY-MM) of Johannesburg time, from its first moment up to (not including) the next month's, for a query. */
export const sastMonthBounds = (month: string) => ({ from: sql`sast_day_start(${month + "-01"}::date)`, to: sql`sast_day_start((${month + "-01"}::date + interval '1 month')::date)` });
/** The Johannesburg date of a column holding a moment, for grouping by day. */
export const sastDayOf = (column: "created_at" | "updated_at" | "at") => sql`sast_day(${sql(column)})`;

/** Johannesburg's date (YYYY-MM-DD) and month (YYYY-MM) of a moment, now by default. */
export const sastDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const sastMonth = (d = new Date()) => sastDate(d).slice(0, 7);
/** The last `days` Johannesburg dates, oldest first, ending with today's. */
export function sastDates(days: number, now = new Date()): string[] {
  const today = Date.parse(`${sastDate(now)}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
