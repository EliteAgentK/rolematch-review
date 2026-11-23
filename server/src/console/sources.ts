// What the Today page is built from (docs/database/18_CONSOLE_V0.md). Three sources, each read on its own, so one that fails shows "unknown" and why,
// never a zero or a guess (docs/database/17, section 5): live's own health report, the PC's status file, and the database's counts.
import { readFileSync } from "node:fs";
import { config } from "../config";

export const STALE_SEC = 120;   // older than this, a source's dot turns grey (17, section 5.4)
export type Read<T> = { ok: true; value: T; ageSec: number } | { ok: false; why: string };
const why = (e: any) => String(e?.name === "TimeoutError" ? "no answer in 5 s" : e?.code ?? e?.message ?? e).slice(0, 120);

/** Live's own health report (src/opsHealth.ts), behind the service token. */
export async function health(fetcher: typeof fetch = fetch): Promise<Read<any>> {
  try {
    const r = await fetcher(`http://127.0.0.1:${config.port}/api/ops/health`, { headers: { authorization: `Bearer ${config.opsToken}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, why: `the API answered ${r.status}` };
    const j: any = await r.json();
    return { ok: true, value: j, ageSec: Math.max(0, Math.round((Date.now() - Date.parse(j.measuredAt)) / 1000)) };
  } catch (e) { return { ok: false, why: `the API did not answer (${why(e)})` }; }
}

/** The PC's own measurements, written each minute by deploy/pc/host-status.sh. */
export function host(path = process.env.CONSOLE_HOST_STATUS ?? "/status/host.json", now = Date.now()): Read<any> {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (typeof j.at !== "number") return { ok: false, why: "the PC's status file has no time in it" };
    return { ok: true, value: j, ageSec: Math.max(0, Math.round(now / 1000 - j.at)) };
  } catch (e: any) { return { ok: false, why: e?.code === "ENOENT" ? "the PC's status file is missing (host-status.sh has not run)" : `the PC's status file could not be read (${why(e)})` }; }
}
