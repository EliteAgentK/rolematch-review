// The service watched from beside it: every minute, is the public address answering, and what does the health report say. On a change of state, one e-mail to the owner
// through RoleMatch's own mail host (never a third-party push service, owner 2026-11-05); while a problem lasts, a reminder each hour; when it clears, how long it lasted.
// It sends through the mail transport directly, not the outbox, because an alert matters most when the database is the thing that is down; it keeps its own small state file.
// Counts and states only: never a document, a person or a token. Runs as its own container (deploy/mac/run.sh): node src/scripts/monitor.js
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../config";
import { notifyOwner } from "../opsNotify";
import { clearEvent, clearMonitorExcept, raise, seen, type Severity } from "../console/store";
import { platformSql } from "../db";
import { refreshRate } from "../fx";
import { unusualNow } from "../unusual";
import { deleteObjects } from "../supabase";
import { OriginalsCopy } from "../originalsCopy";

const TO = (process.env.OPS_ALERT_TO ?? "").trim(), EVERY_MS = Number(process.env.MONITOR_EVERY_SEC ?? 60) * 1000, REMIND_MS = Number(process.env.MONITOR_REMIND_SEC ?? 3600) * 1000;
const STATE = process.env.MONITOR_STATE ?? "/data/monitor-state.json", PORT = Number(process.env.PORT ?? 8787), ALIVE = process.env.MONITOR_ALIVE ?? "/tmp/monitor-alive";
type Problem = { key: string; text: string; severity?: Severity; unknown?: boolean; meaning?: string; action?: string };
type State = { since: Record<string, number>; lastSent: Record<string, number>; unsure?: Record<string, number> };

/** What is wrong right now, each with a stable key so a problem is reported once, not every minute. */
export async function problemsNow(fetcher: typeof fetch = fetch): Promise<Problem[]> {
  const out: Problem[] = [];
  try {
    const r = await fetcher(`${config.appUrl}/api/ready`, { signal: AbortSignal.timeout(15_000) });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j?.ready) out.push({ key: "outside", severity: "urgent", text: `The public address ${config.appUrl} answers ${r.status}${j?.ready === false ? " (not ready)" : ""}.` });
  } catch (e: any) { out.push({ key: "outside", severity: "urgent", text: `The public address ${config.appUrl} does not answer (${e?.name === "TimeoutError" ? "no answer in 15 s" : "connection failed"}).` }); }
  try {
    const r = await fetcher(`http://127.0.0.1:${PORT}/api/ops/health`, { headers: { authorization: `Bearer ${config.opsToken}` }, signal: AbortSignal.timeout(15_000) });
    const j: any = await r.json();
    for (const [name, c] of Object.entries<any>(j?.checks ?? {})) if (c?.state && c.state !== "healthy") out.push({ key: `health:${name}`, severity: c.state === "unavailable" ? "urgent" : "today", text: `${name}: ${c.state}. ${c.note ?? ""}`.trim(), unknown: c.state === "unknown" });
  } catch { out.push({ key: "inside", severity: "urgent", text: "The service does not answer its health check." }); }
  out.push(...(await trendsNow(fetcher)));
  return out;
}

/** The trend alerts Prometheus has firing (deploy/prometheus/rules.yml, docs/ops/TRENDS_AND_LOAD.md): told the same way as everything else, worded by the
 *  rule itself. Only where Prometheus runs (PROMETHEUS_URL); one that does not answer is a check that could not be measured, so it waits a minute (R162). */
export async function trendsNow(fetcher: typeof fetch = fetch, url = (process.env.PROMETHEUS_URL ?? "").trim()): Promise<Problem[]> {
  if (!url) return [];
  try {
    const r = await fetcher(`${url}/api/v1/alerts`, { signal: AbortSignal.timeout(10_000) });
    const j: any = await r.json();
    if (!r.ok || j?.status !== "success") throw new Error(String(r.status));
    const firing = new Map<string, Problem>();
    for (const a of j.data?.alerts ?? []) {
      if (a?.state !== "firing" || typeof a.labels?.alertname !== "string") continue;
      const severity: Severity = a.labels.severity === "urgent" ? "urgent" : "today", key = `trend:${a.labels.alertname}`;
      if (firing.get(key)?.severity === "urgent") continue;   // the same rule firing for two targets is one problem; the more serious wins
      firing.set(key, { key, severity, text: `${a.annotations?.title ?? a.labels.alertname}. ${a.annotations?.meaning ?? ""}${a.annotations?.action ? `\nWhat to do: ${a.annotations.action}` : ""}`.trim(), meaning: a.annotations?.meaning, action: a.annotations?.action });
    }
    return [...firing.values()];
  } catch { return [{ key: "trends", severity: "today", unknown: true, text: "Trends cannot be read: Prometheus on the PC does not answer.", meaning: "The graphs and the warnings about slow change (disk filling, pages slower than last week) have stopped. Live itself is not affected.", action: "Check rm-prometheus on the PC (docker ps; docker logs rm-prometheus), or run deploy/pc/prometheus.sh." }]; }
}

/** R162: a check that could not be measured once ("unknown", usually one slow answer) is a problem only when the next minute cannot measure it either.
 *  Anything actually wrong, and anything already reported, counts at once, so a real fault is never delayed and a reported one does not flap. */
export function confirm(now: Problem[], st: State) {
  const unsure: Record<string, number> = {}, problems: Problem[] = [];
  for (const p of now) {
    if (!p.unknown || st.since[p.key] !== undefined || st.unsure?.[p.key] !== undefined) problems.push(p);
    else unsure[p.key] = 1;
  }
  return { problems, unsure };
}

/** Which messages to send now, given what is wrong and what was already said. Pure, so every case is tested without a clock or a mail host. */
export function decide(now: Problem[], st: State, at: number, remindMs = REMIND_MS) {
  const send: { subject: string; text: string }[] = [], keys = new Set(now.map((p) => p.key)), next: State = { since: { ...st.since }, lastSent: { ...st.lastSent } };
  for (const p of now) {
    if (next.since[p.key] === undefined) { next.since[p.key] = at; next.lastSent[p.key] = at; send.push({ subject: `RoleMatch: ${p.text.split(".")[0]}`, text: p.text }); }
    else if (at - (next.lastSent[p.key] ?? 0) >= remindMs) { next.lastSent[p.key] = at; send.push({ subject: `RoleMatch: still: ${p.text.split(".")[0]}`, text: `${p.text}\nOngoing for ${Math.round((at - next.since[p.key]) / 60000)} minutes.` }); }
  }
  for (const key of Object.keys(next.since)) if (!keys.has(key)) { send.push({ subject: `RoleMatch: back to normal (${key})`, text: `Cleared after ${Math.max(1, Math.round((at - next.since[key]) / 60000))} minutes.` }); delete next.since[key]; delete next.lastSent[key]; }
  return { send, next };
}

// The same problems, in the owner's console (docs/database/18_CONSOLE_V0.md): a new problem is raised, one that lasts is marked as still seen, one that
// has gone is marked back to normal. Pure, so the folding is tested without a database; written best-effort, because the database may be the problem.
const MEANING: Record<string, { meaning: string; action: string }> = {
  outside: { meaning: "People cannot reach RoleMatch from the internet.", action: "Check the PC is on, and that the tunnel (rm-tunnel) and the API (rm-api) are running." },
  inside: { meaning: "The service is not answering its own health check.", action: "Check rm-api on the PC (docker logs rm-api)." },
};
export function consoleChanges(now: Problem[], st: State) {
  const keys = new Set(now.map((p) => p.key));
  return { started: now.filter((p) => st.since[p.key] === undefined), ongoing: now.filter((p) => st.since[p.key] !== undefined), cleared: Object.keys(st.since).filter((k) => !keys.has(k)) };
}
const TITLE: Record<string, string> = {
  outside: "RoleMatch cannot be reached from the internet", inside: "The service is not answering",
  "health:readiness": "Live is not ready", "health:database": "The database is slow or not answering", "health:queue": "CVs are waiting longer than they should",
  "health:processing": "CVs are failing to read", "health:requests": "Pages are slow or failing", "health:mail": "E-mail is not going out",
  "health:resources": "The server is short of memory or slow", "health:model": "The model is behind", trends: "Trends cannot be read",
};
export const consoleEvent = (p: Problem) => ({ fingerprint: `monitor:${p.key}`, severity: p.severity ?? "today", source: "monitor", title: (TITLE[p.key] ?? p.text.split(". ")[0]).slice(0, 200),
  meaning: p.meaning ?? MEANING[p.key]?.meaning ?? p.text, action: p.action ?? MEANING[p.key]?.action ?? "Open Today in the console for the details." });
async function toConsole(now: Problem[], st: State) {
  const c = consoleChanges(now, st);
  const writes = [...c.started.map((p) => raise(consoleEvent(p))), ...c.ongoing.map((p) => seen(consoleEvent(p))), ...c.cleared.map((k) => clearEvent(`monitor:${k}`)), clearMonitorExcept(now.map((p) => `monitor:${p.key}`))];
  for (const r of await Promise.allSettled(writes)) if (r.status === "rejected") { console.log(JSON.stringify({ event: "monitor.console_write_failed", error: String(r.reason?.message ?? r.reason).slice(0, 120) })); break; }
}

const load = (): State => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { since: {}, lastSent: {} }; } };
const mail = (subject: string, text: string) => notifyOwner(subject, text);

/** The platform's own upkeep, beside the watching (docs/architecture/PLAN_CONSOLE_OPERATIONS.md): each portal's daily totals counted again for yesterday
 *  and today every 5 minutes, and the day's exchange rate asked for once an hour (src/fx.ts). A failure is logged and tried again next time. */
let lastTotals = 0, lastRate = 0, lastUnusual = 0;
async function upkeep(now = Date.now()) {
  if (now - lastTotals >= 5 * 60_000) {
    lastTotals = now;
    await platformSql`select refresh_portal_daily(sast_day() - 1) as n`.then(([r]: any[]) => console.log(JSON.stringify({ event: "monitor.totals", rows: r?.n })))
      .catch((e: any) => console.log(JSON.stringify({ event: "monitor.totals_failed", error: String(e?.message ?? e).slice(0, 160) })));
  }
  // Unusual activity (src/unusual.ts), read from the totals just refreshed: a finding is raised once and told to the owner, seen while it lasts, and
  // resolved by itself when it no longer holds, so it lands in the console's resolved history with how long it lasted.
  if (now - lastUnusual >= 5 * 60_000) {
    lastUnusual = now;
    await unusualNow().then(async (found) => {
      const open = new Set((await platformSql`select fingerprint from owner_events where fingerprint like 'unusual:%' and cleared_at is null`).map((r: any) => r.fingerprint as string));
      for (const f of found) {
        const e = { fingerprint: f.fingerprint, severity: "today" as const, source: "monitor", title: f.title, meaning: f.meaning, action: f.action };
        if (open.has(f.fingerprint)) await seen(e); else { await raise(e); await notifyOwner(`RoleMatch: ${f.title}`, `${f.meaning}\n\n${f.action}`).catch(() => {}); }
      }
      const now_ = new Set(found.map((f) => f.fingerprint));
      for (const fp of open) if (!now_.has(fp)) await clearEvent(fp);
    }).catch((e: any) => console.log(JSON.stringify({ event: "monitor.unusual_failed", error: String(e?.message ?? e).slice(0, 160) })));
  }
  // Original files of what the owner deleted in the console (migration 050): removed from the vault and from RoleMatch's own copy, then crossed off.
  // A failure is kept with its reason and tried again next minute; the console shows what is still waiting.
  await platformSql`select path from file_removals order by requested_at limit 50`.then(async (rows: any[]) => {
    for (const { path } of rows) {
      try { await deleteObjects([path], { strict: true }); OriginalsCopy.fromEnv(config.dataDir).remove(path); await platformSql`delete from file_removals where path = ${path}`; }
      catch (e: any) { await platformSql`update file_removals set tries = tries + 1, last_error = ${String(e?.message ?? e).slice(0, 200)} where path = ${path}`.catch(() => {}); }
    }
    if (rows.length) console.log(JSON.stringify({ event: "monitor.files_removed", asked: rows.length }));
  }).catch((e: any) => console.log(JSON.stringify({ event: "monitor.file_removals_failed", error: String(e?.message ?? e).slice(0, 160) })));
  if (now - lastRate >= 60 * 60_000) {
    lastRate = now;
    await refreshRate().then((what) => console.log(JSON.stringify({ event: "monitor.rate", what }))).catch((e: any) => console.log(JSON.stringify({ event: "monitor.rate_failed", error: String(e?.message ?? e).slice(0, 160) })));
  }
}

if (process.argv[1]?.endsWith("monitor.js") || process.argv[1]?.endsWith("monitor.ts")) {
  console.log(JSON.stringify({ event: "monitor.started", everySec: EVERY_MS / 1000, alertsTo: TO ? "configured" : "not configured" }));
  for (;;) {
    const before = load(), { problems, unsure } = confirm(await problemsNow(), before);
    const { send, next } = decide(problems, before, Date.now());
    next.unsure = unsure;
    await toConsole(problems, before);
    for (const m of send) await mail(m.subject, m.text).catch((e) => console.log(JSON.stringify({ event: "monitor.send_failed", subject: m.subject, error: String(e?.message ?? e).slice(0, 120) })));
    try { writeFileSync(STATE, JSON.stringify(next)); } catch { /* a read-only disk loses only the memory of what was already said */ }
    try { writeFileSync(ALIVE, String(Date.now())); } catch { /* the container's health check then says so */ }   // the heartbeat Docker's health check reads (src/scripts/healthcheck.ts)
    await upkeep();
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
