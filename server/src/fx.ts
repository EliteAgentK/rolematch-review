// The rand per US dollar, day by day (supabase/migrations/048_fx_and_portal_daily.sql; owner, 12 Nov 2026: the console in dollars, every portal in rands,
// "always be paying attention to the fluctuating exchange rates"). The European Central Bank's reference rate, as published each working day, read
// through api.frankfurter.dev (free, no key, nothing about anyone is sent). Asked for once an hour by the monitor; a day it does not publish (a weekend,
// a holiday) keeps the last rate it did. A failure is logged and changes nothing: the last kept rate stands until a new one arrives.
import { platformSql as sql } from "./db";
import { sastDate } from "./sast";

const SOURCE = "European Central Bank reference rate (api.frankfurter.dev)";
const URL_LATEST = process.env.FX_URL ?? "https://api.frankfurter.dev/v1/latest?base=USD&symbols=ZAR";
const today = () => sastDate();   // yyyy-mm-dd, Johannesburg's day

/** One answer from the rate service: the date it was published and the rand per dollar, or null when the answer is not one. */
export function parseRate(body: unknown): { published: string; usdZar: number } | null {
  const b = body as any, r = Number(b?.rates?.ZAR), d = String(b?.date ?? "");
  return Number.isFinite(r) && r > 1 && r < 1000 && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { published: d, usdZar: r } : null;
}

/** Keeps today's rate (and, the first time, the last 60 days, so earlier AI use is converted at its own day's rate too). Returns what it did. */
export async function refreshRate(fetchImpl: typeof fetch = fetch): Promise<string> {
  const day = today();
  const [have] = await sql`select usd_zar, published::text as published from fx_rates where day = ${day}`;
  const [{ n }] = await sql`select count(*)::int as n from fx_rates`;
  if (n === 0) {
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const res = await fetchImpl(URL_LATEST.replace("/latest", `/${from}..`), { signal: AbortSignal.timeout(10_000) });
    const body: any = res.ok ? await res.json() : null;
    for (const [d, rates] of Object.entries(body?.rates ?? {})) {
      const r = parseRate({ date: d, rates }); if (r) await sql`insert into fx_rates (day, usd_zar, published, source) values (${d}, ${r.usdZar}, ${d}, ${SOURCE}) on conflict (day) do nothing`;
    }
  }
  const res = await fetchImpl(URL_LATEST, { signal: AbortSignal.timeout(10_000) });
  const r = parseRate(res.ok ? await res.json() : null);
  if (!r) return `no rate: the service answered ${res.status}`;
  if (have && Number(have.usd_zar) === r.usdZar && String(have.published).slice(0, 10) === r.published) return `kept ${r.usdZar} (${r.published})`;
  await sql`insert into fx_rates (day, usd_zar, published, source) values (${day}, ${r.usdZar}, ${r.published}, ${SOURCE})
    on conflict (day) do update set usd_zar = excluded.usd_zar, published = excluded.published, fetched_at = now()`;
  return `rate ${r.usdZar} for ${day} (published ${r.published})`;
}

/** The rand per dollar now and 30 days ago, for the console to show how it is moving. */
export async function rateNow(): Promise<{ today: number | null; published: string | null; monthAgo: number | null }> {
  const [r] = await sql`select (select usd_zar from fx_rates order by day desc limit 1) as t, (select published::text from fx_rates order by day desc limit 1) as p,
    usd_zar_on(sast_day() - 30) as m`;
  return { today: r?.t == null ? null : Number(r.t), published: r?.p ? String(r.p).slice(0, 10) : null, monthAgo: r?.m == null ? null : Number(r.m) };
}
