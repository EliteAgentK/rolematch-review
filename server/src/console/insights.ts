// The console's Activity and Organisations pages (docs/database/22_CONSOLE_LOOK.md): fetching (console_activity() and console_organisations(),
// migration 045) kept apart from shaping, so every case is tested without a server. Numbers and organisation names only, as the functions return.
import { bucketLabel, type Period, type Step } from "./period";

const METRICS = [
  { key: "cvs", label: "CVs read", colour: "r" }, { key: "jobs", label: "Jobs read", colour: "l" },
  { key: "matches", label: "Matches", colour: "c" }, { key: "shortlisted", label: "Shortlisted", colour: "e" },
  { key: "people", label: "New people", colour: "r" }, { key: "aiMicroUsd", label: "AI spend", colour: "o" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];
interface Metric { key: MetricKey; label: string; colour: string; total: number; previous: number; change: string; series: number[] }
export interface Activity { days: number; dates: string[]; metrics: Metric[]; labels?: string[]; step?: Step }
export interface Organisation { id?: string; name: string; since: string; portals: number; people: number; cvs: number; jobs: number; matches: number; aiUsd: number; lastActivity: string | null }


/** "up 12% on the 30 days before", "down 3", "the same", or "new" when there was nothing before. Whole numbers only: no false precision. */
export function change(now: number, before: number, beforeLabel = "the period before"): string {
  if (!before) return now ? "new this period" : "none before either";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "the same as before" : `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on ${beforeLabel}`;
}
export const usd = (micro: number) => micro / 1_000_000;

export function shapeActivity(raw: any): Activity {
  const series: any[] = Array.isArray(raw?.series) ? raw.series : [];
  const prev = raw?.previous ?? {};
  const metrics = METRICS.map((m) => {
    const values = series.map((d) => Number(d?.[m.key] ?? 0));
    const total = values.reduce((a, b) => a + b, 0), previous = Number(prev[m.key] ?? 0);
    return { key: m.key, label: m.label, colour: m.colour, total, previous, change: change(total, previous), series: values };
  });
  return { days: Number(raw?.days ?? series.length), dates: series.map((d) => String(d?.date ?? "")), metrics };
}

export function shapeOrganisations(raw: any[]): Organisation[] {
  return (Array.isArray(raw) ? raw : []).map((o) => ({
    id: o?.id ? String(o.id) : undefined, name: String(o?.name ?? ""), since: String(o?.since ?? ""), portals: Number(o?.portals ?? 0), people: Number(o?.people ?? 0), cvs: Number(o?.cvs ?? 0),
    jobs: Number(o?.jobs ?? 0), matches: Number(o?.matches ?? 0), aiUsd: usd(Number(o?.aiMicroUsdThisMonth ?? 0)), lastActivity: o?.lastActivity ? String(o.lastActivity) : null,
  }));
}

/** Any period (console_period(), migration 051): each metric's series hour by hour or day by day, its total, and its change on the period before. */
export function shapePeriod(raw: any, p: Period): Activity {
  const series: any[] = Array.isArray(raw?.series) ? raw.series : [];
  const prev = raw?.previous ?? {};
  const metrics = METRICS.map((m) => {
    const values = series.map((d) => Number(d?.[m.key] ?? 0));
    const total = values.reduce((a, b) => a + b, 0), previous = Number(prev[m.key] ?? 0);
    return { key: m.key, label: m.label, colour: m.colour, total, previous, change: change(total, previous, p.beforeLabel), series: values };
  });
  const dates = series.map((d) => String(d?.at ?? ""));
  return { days: Math.max(1, Math.round((p.to.getTime() - p.from.getTime()) / 86_400_000)), dates, labels: dates.map((d) => bucketLabel(d, p.step)), step: p.step, metrics };
}
