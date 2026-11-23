// What the Trends page shows (docs/ops/TRENDS_AND_LOAD.md): RoleMatch's numbers and the PC's over a chosen period, read from Prometheus on the PC, and the
// trend warnings firing now. Read on the server and drawn as SVG (view.ts): the console sends no script. Every chart is one query; a query that fails
// leaves that chart "unknown" and the others still show. A moment with no number is a gap in the line, never a zero.
export type TrendRange = "24h" | "7d" | "30d" | "90d";
export const RANGES: Record<TrendRange, { label: string; seconds: number; step: number }> = {
  "24h": { label: "24 hours", seconds: 86_400, step: 600 },
  "7d": { label: "7 days", seconds: 7 * 86_400, step: 3_600 },
  "30d": { label: "30 days", seconds: 30 * 86_400, step: 4 * 3_600 },
  "90d": { label: "90 days", seconds: 90 * 86_400, step: 12 * 3_600 },
};
export const rangeOf = (v: string | null): TrendRange => (v && v in RANGES ? (v as TrendRange) : "24h");

export type Unit = "seconds" | "minutes" | "count" | "per_minute" | "percent" | "megabytes";
interface TrendSeries { label: string; colour: string; values: (number | null)[] }
export interface TrendChart { id: string; title: string; line: string; unit: Unit; series: TrendSeries[]; why?: string }
interface Warning { title: string; meaning: string; action: string; since: string | null; severity: string }
export type Trends = { ok: true; times: number[]; charts: TrendChart[]; warnings: Warning[] } | { ok: false; why: string };

// Each series's query, with W standing for the window each point covers (the step, at least five minutes): a point is the worst or the rate over its
// own stretch of time, so a short spike between two points still shows.
const CHARTS: { id: string; title: string; line: string; unit: Unit; series: { label: string; colour: string; q: string }[] }[] = [
  { id: "speed", title: "How fast pages answer", line: "The slowest 5% of answers. Lower is better.", unit: "seconds",
    series: [{ label: "slowest 5%", colour: "r", q: "histogram_quantile(0.95, sum by (le) (rate(rolematch_http_request_duration_seconds_bucket[W])))" }] },
  { id: "requests", title: "Requests", line: "Answered requests a minute, and those that failed on the server.", unit: "per_minute",
    series: [{ label: "requests", colour: "r", q: "sum(rate(rolematch_http_responses_total[W])) * 60" }, { label: "failed on the server", colour: "w", q: "sum(rate(rolematch_http_responses_total{class=\"5xx\"}[W])) * 60" }] },
  { id: "queue", title: "CVs and jobs waiting to be read", line: "The most waiting at any moment.", unit: "count",
    series: [{ label: "waiting", colour: "r", q: "max_over_time(rolematch_queue_jobs{state=\"queued\"}[W])" }] },
  { id: "wait", title: "Longest wait to be read", line: "How long the oldest waiting document had waited.", unit: "minutes",
    series: [{ label: "oldest wait", colour: "r", q: "max_over_time(rolematch_queue_oldest_wait_seconds[W]) / 60" }] },
  { id: "ai", title: "Work waiting for the AI", line: "The most waiting at any moment.", unit: "count",
    series: [{ label: "waiting for the AI", colour: "o", q: "max_over_time(rolematch_ai_jobs{state=\"queued\"}[W])" }] },
  { id: "disk", title: "The PC's disk", line: "Share of the disk in use.", unit: "percent",
    series: [{ label: "in use", colour: "r", q: "100 * (1 - min(node_filesystem_avail_bytes{job=\"pc\",mountpoint=\"/\"}) / min(node_filesystem_size_bytes{job=\"pc\",mountpoint=\"/\"}))" }] },
  { id: "memory", title: "The PC's memory", line: "Share of the memory given to Linux in use.", unit: "percent",
    series: [{ label: "in use", colour: "r", q: "100 * (1 - min_over_time(node_memory_MemAvailable_bytes{job=\"pc\"}[W]) / node_memory_MemTotal_bytes{job=\"pc\"})" }] },
  { id: "cpu", title: "The PC's processors", line: "Share of the processors' time busy.", unit: "percent",
    series: [{ label: "busy", colour: "r", q: "100 * (1 - avg(rate(node_cpu_seconds_total{job=\"pc\",mode=\"idle\"}[W])))" }] },
  { id: "process", title: "The service's memory", line: "Memory the web service (rm-api) holds.", unit: "megabytes",
    series: [{ label: "in use", colour: "r", q: "max_over_time(rolematch_resident_memory_bytes[W]) / 1048576" }] },
];

const why = (e: any) => String(e?.name === "TimeoutError" ? "no answer in 10 s" : e?.message ?? e).slice(0, 120);

/** One series over the period, a value (or null) at each step. */
async function range(base: string, q: string, start: number, end: number, step: number, fetcher: typeof fetch): Promise<(number | null)[]> {
  const u = new URL(`${base}/api/v1/query_range`);
  u.search = new URLSearchParams({ query: q, start: String(start), end: String(end), step: String(step) }).toString();
  const r = await fetcher(u, { signal: AbortSignal.timeout(10_000) });
  const j: any = await r.json();
  if (!r.ok || j?.status !== "success") throw new Error(j?.error ? String(j.error).slice(0, 80) : `Prometheus answered ${r.status}`);
  const out: (number | null)[] = Array.from({ length: Math.floor((end - start) / step) + 1 }, () => null);
  for (const [t, v] of j.data?.result?.[0]?.values ?? []) {
    const i = Math.round((Number(t) - start) / step), x = Number(v);
    if (i >= 0 && i < out.length && Number.isFinite(x)) out[i] = x;   // NaN (no requests in a stretch, say) is a gap, not a number
  }
  return out;
}

export async function readTrends(which: TrendRange, fetcher: typeof fetch = fetch, base = (process.env.PROMETHEUS_URL ?? "").trim(), now = Date.now()): Promise<Trends> {
  if (!base) return { ok: false, why: "trends are not set up on this machine (no PROMETHEUS_URL)" };
  const { seconds, step } = RANGES[which], end = Math.floor(now / 1000 / step) * step, start = end - seconds;
  const window = `${Math.max(step, 300)}s`;
  let warnings: Warning[];
  try {
    const r = await fetcher(`${base}/api/v1/alerts`, { signal: AbortSignal.timeout(10_000) }), j: any = await r.json();
    if (!r.ok || j?.status !== "success") throw new Error(`Prometheus answered ${r.status}`);
    warnings = (j.data?.alerts ?? []).filter((a: any) => a?.state === "firing").map((a: any) => ({ title: String(a.annotations?.title ?? a.labels?.alertname ?? ""), meaning: String(a.annotations?.meaning ?? ""),
      action: String(a.annotations?.action ?? ""), since: a.activeAt ?? null, severity: a.labels?.severity === "urgent" ? "urgent" : "today" }));
    warnings = [...new Map(warnings.map((w) => [w.title, w])).values()];
  } catch (e) { return { ok: false, why: `Prometheus on the PC did not answer (${why(e)})` }; }
  const charts = await Promise.all(CHARTS.map(async (c) => {
    try { return { ...c, series: await Promise.all(c.series.map(async (s) => ({ label: s.label, colour: s.colour, values: await range(base, s.q.replaceAll("[W]", `[${window}]`), start, end, step, fetcher) }))) } as TrendChart; }
    catch (e) { return { id: c.id, title: c.title, line: c.line, unit: c.unit, series: [], why: why(e) } as TrendChart; }
  }));
  const times = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => (start + i * step) * 1000);
  return { ok: true, times, charts, warnings };
}
