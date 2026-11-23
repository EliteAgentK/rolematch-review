// The period every page of the console shows (owner, 12 Nov 2026: "last 24 hours, last 7 days, last 30 days, last 3 months, and ... per month ... for
// every section"). Chosen with ?p= in the address: 24h, 7d, 30d (the default), 90d, or a month as YYYY-MM. Kept as the owner moves between pages (every
// link of the console carries it), so one choice holds everywhere until it is changed. Johannesburg's hours and days; South Africa keeps no summer
// time, so a day there always starts at 00:00 +02:00.
export type Step = "hour" | "day";
export interface Period {
  key: string;            // what ?p= says: "24h", "7d", "30d", "90d" or "2026-11"
  label: string;          // "Last 24 hours", "Last 7 days", "November 2026"
  short: string;          // for a tile: "24 hours", "7 days", "Nov 2026"
  from: Date; to: Date;   // the period: from, up to (not including) to
  before: Date;           // the period before it starts here and ends at from
  beforeLabel: string;    // "the 24 hours before", "October 2026"
  step: Step;             // hour by hour or day by day
  month: boolean;         // a calendar month (it may have ended)
}
export const DEFAULT_PERIOD = "30d";
const ZONE = "+02:00", TZ = "Africa/Johannesburg";
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** The start of a Johannesburg day, as a moment. */
const dayStart = (d: Date) => new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)}T00:00:00${ZONE}`);
const monthStart = (y: number, m: number) => new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00${ZONE}`);
const monthName = (y: number, m: number, style: "long" | "short") => monthStart(y, m).toLocaleDateString("en-ZA", { month: style, year: "numeric", timeZone: TZ });
const ym = (d: Date) => { const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d).split("-").map(Number); return { y, m }; };

const RECENT: Record<string, { days: number; label: string; short: string; before: string }> = {
  "7d": { days: 7, label: "Last 7 days", short: "7 days", before: "the 7 days before" },
  "30d": { days: 30, label: "Last 30 days", short: "30 days", before: "the 30 days before" },
  "90d": { days: 90, label: "Last 3 months", short: "3 months", before: "the 3 months before" },
};

/** The period ?p= asks for; anything else (missing, misspelt, a month in the future or before 2026) is the default, never an error. */
export function periodOf(raw: string | null | undefined, now = new Date()): Period {
  const key = String(raw ?? "").trim();
  if (key === "24h") {
    const to = now, from = new Date(now.getTime() - 24 * 3600_000);
    return { key, label: "Last 24 hours", short: "24 hours", from, to, before: new Date(from.getTime() - 24 * 3600_000), beforeLabel: "the 24 hours before", step: "hour", month: false };
  }
  const r = RECENT[key];
  if (r) {
    const from = new Date(dayStart(now).getTime() - (r.days - 1) * 86_400_000);
    return { key, label: r.label, short: r.short, from, to: now, before: new Date(from.getTime() - r.days * 86_400_000), beforeLabel: r.before, step: "day", month: false };
  }
  const m = MONTH.exec(key), here = ym(now);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (y >= 2026 && (y < here.y || (y === here.y && mo <= here.m))) {
      const from = monthStart(y, mo), next = mo === 12 ? monthStart(y + 1, 1) : monthStart(y, mo + 1), before = mo === 1 ? monthStart(y - 1, 12) : monthStart(y, mo - 1);
      const by = mo === 1 ? y - 1 : y, bm = mo === 1 ? 12 : mo - 1;
      return { key, label: monthName(y, mo, "long"), short: monthName(y, mo, "short"), from, to: next < now ? next : now, before, beforeLabel: monthName(by, bm, "long"), step: "day", month: true };
    }
  }
  return periodOf(DEFAULT_PERIOD, now);
}

/** The choices to offer: the four recent periods, then each month from the platform's first (newest first, at most twelve). */
export function choices(since: Date | string | null | undefined, now = new Date()) {
  const recent = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "3 months"]].map(([key, label]) => ({ key, label }));
  const start = since ? ym(new Date(since)) : ym(now), here = ym(now), months: { key: string; label: string }[] = [];
  for (let y = here.y, m = here.m; (y > start.y || (y === start.y && m >= start.m)) && months.length < 12; m === 1 ? (y--, m = 12) : m--)
    months.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: monthName(y, m, "short") });
  return { recent, months };
}

/** A bucket's label on a chart: an hour ("14:00") for the last 24 hours, a day ("12 Nov") otherwise. The database names each bucket by its local time. */
export const bucketLabel = (at: string, step: Step) => step === "hour"
  ? at.slice(11, 16)
  : new Date(`${at.slice(0, 10)}T12:00:00${ZONE}`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: TZ });

/** The address of a console page with the period kept (the default needs nothing). */
export const withPeriod = (href: string, p: Pick<Period, "key">) => (p.key === DEFAULT_PERIOD ? href : `${href}${href.includes("?") ? "&" : "?"}p=${encodeURIComponent(p.key)}`);
