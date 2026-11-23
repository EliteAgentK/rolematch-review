// Operational health, for the monitor (docs/ops/MONITORING.md). One summary a separate program can judge, built from what the server already records.
// Rules: a measurement that could not be taken is "unknown", never "healthy". A rate is only given above a minimum sample, so one failure in two documents is not "50% failing".
// One organisation's backlog cannot mark the platform unavailable. Counts, ages and states only: no names, addresses, file names, document text or tokens.
// Organisation ids appear only for organisations that are behind, and only here, behind the service token: restricted operational metadata.
import { createHash, timingSafeEqual } from "node:crypto";
import { aiConfigured, capUsd } from "./ai/claude";
import { config } from "./config";
import { sql } from "./db";
import { mailStatus } from "./mail";
import { sastMonthStart } from "./sast";
import { outboxStats } from "./outbox";
import { timingStats } from "./timing";
import { PARSER_VERSION, CANDIDATE_PIPELINE_VERSION } from "./version";

export type State = "healthy" | "degraded" | "unavailable" | "unknown";
export interface Check { state: State; note: string; [measure: string]: unknown }
export interface Thresholds {
  queueDegradedSec: number; queueUnavailableSec: number; stuckRunningSec: number;
  windowMinutes: number; failureMinSample: number; failureDegradedRate: number; failureUnavailableRate: number; failureDegradedCount: number;
  requestWindowMinutes: number; requestMinSample: number; errorDegradedRate: number; errorUnavailableRate: number; latencyDegradedMs: number; latencyUnavailableMs: number;
  modelWaitDegradedSec: number; modelWaitUnavailableSec: number;
  mailDegradedSec: number; mailUnavailableSec: number; loopDegradedMs: number; loopUnavailableMs: number; rssDegradedMb: number; rssUnavailableMb: number;
}
const by = (v: number, degraded: number, unavailable: number): State => (v >= unavailable ? "unavailable" : v >= degraded ? "degraded" : "healthy");

// ---------------------------------------------------------------- the judgements: pure, so every threshold and edge is tested without a server
export function judgeQueue(m: { queued: number; running: number; stuckRunning: number; orgs: { org: string; queued: number; oldestSec: number }[] }, t: Thresholds): Check {
  const behind = m.orgs.filter((o) => o.oldestSec >= t.queueDegradedSec);
  const oldestQueuedSec = m.orgs.reduce((a, o) => Math.max(a, o.oldestSec), 0);
  const base = { queued: m.queued, running: m.running, stuckRunning: m.stuckRunning, oldestQueuedSec, organisationsWithWork: m.orgs.length, organisationsBehind: behind.length };
  if (m.stuckRunning > 0) return { state: "degraded", note: "a job has stopped reporting progress; the queue's sweeper should retry it", scope: "platform", ...base };
  if (!behind.length) return { state: "healthy", note: m.queued ? "work is moving" : "nothing waiting", scope: "platform", ...base };
  // Every organisation with work is behind: the readers are not keeping up, or none is running. Only some: those organisations are affected, not the platform.
  const everyone = behind.length === m.orgs.length;
  const worst = by(oldestQueuedSec, t.queueDegradedSec, t.queueUnavailableSec);
  return { state: everyone ? worst : "degraded", note: everyone ? "all waiting work is behind" : "some organisations are behind; others are moving", scope: everyone ? "platform" : "some_organisations", behind: behind.slice(0, 5).map((o) => ({ org: o.org, queued: o.queued, oldestSec: o.oldestSec })), ...base };
}
export function judgeProcessing(m: { completed: number; failed: number }, t: Thresholds): Check {
  const total = m.completed + m.failed, base = { windowMinutes: t.windowMinutes, completed: m.completed, failed: m.failed };
  if (total < t.failureMinSample) {
    // Too few for a percentage to mean anything, but a run of failures with almost nothing succeeding still deserves a look.
    return m.failed >= t.failureDegradedCount
      ? { state: "degraded", note: `${m.failed} unexplained failures in the window; too few documents for a rate`, failureRate: null, ...base }
      : { state: "healthy", note: "too few documents in the window for a rate", failureRate: null, ...base };
  }
  const failureRate = Math.round((m.failed / total) * 1000) / 1000;
  return { state: by(failureRate, t.failureDegradedRate, t.failureUnavailableRate), note: "share of documents that failed unexplained", failureRate, ...base };
}
export function judgeRequests(m: { requests: number; errors: number; p95Ms: number | null }, t: Thresholds): Check {
  const base = { scope: "this_server", windowMinutes: t.requestWindowMinutes, requests: m.requests, serverErrors: m.errors, p95Ms: m.p95Ms };
  if (m.requests < t.requestMinSample) return { state: "healthy", note: "too few requests in the window for a rate", errorRate: null, ...base };
  const errorRate = Math.round((m.errors / m.requests) * 1000) / 1000;
  const a = by(errorRate, t.errorDegradedRate, t.errorUnavailableRate), b = m.p95Ms === null ? "healthy" : by(m.p95Ms, t.latencyDegradedMs, t.latencyUnavailableMs);
  return { state: worstOf([a, b]), note: "server errors and slow answers", errorRate, ...base };
}
export function judgeMail(m: { sending: boolean; pending: number; dead: number; oldestUndeliveredSec: number }, t: Thresholds): Check {
  if (!m.sending) return { state: m.pending || m.dead ? "degraded" : "healthy", note: "sending is switched off here", sending: false, pending: m.pending, dead: m.dead, oldestUndeliveredSec: m.oldestUndeliveredSec };
  const age = by(m.oldestUndeliveredSec, t.mailDegradedSec, t.mailUnavailableSec);
  return { state: m.dead && age === "healthy" ? "degraded" : age, note: m.dead ? "some messages gave up and need a person" : "e-mail waiting to go out", sending: true, pending: m.pending, dead: m.dead, oldestUndeliveredSec: m.oldestUndeliveredSec };
}
const RANK: Record<State, number> = { healthy: 0, degraded: 1, unknown: 2, unavailable: 3 };
/** The worst state wins, and unknown outranks degraded: not being able to tell is more urgent than knowing something is slow, and it is never healthy. */
/** Claude as the service uses it (aiRead.ts, aiMatch.ts): what waits for it, how its last quarter of an hour went, and the month's spend against the platform's
 *  safety cap. A CV never waits on the AI for long (the parser's reading is published instead), so a backlog is the service being slow, not stuck. Calls that
 *  keep failing with none answered is what an exhausted Anthropic credit or a revoked key looks like: worth an alert, though nothing stops working. */
export function judgeAi(m: { reading: boolean; matching: boolean; configured: boolean; queued: number; running: number; oldestQueuedSec: number; answered15m: number; failed15m: number; refused15m: number; spentMonthUsd: number; capUsd: number }, t: Pick<Thresholds, "modelWaitDegradedSec" | "modelWaitUnavailableSec">): Check {
  const base = { scope: "platform", reading: m.reading ? "on" : "off", matching: m.matching ? "on" : "off", queued: m.queued, running: m.running, oldestQueuedSec: m.oldestQueuedSec, answeredLast15Min: m.answered15m, failedLast15Min: m.failed15m, refusedLast15Min: m.refused15m, spentThisMonthUsd: Math.round(m.spentMonthUsd * 100) / 100, monthlyCapUsd: m.capUsd };
  if (!m.reading && !m.matching) return { state: "healthy", note: "the AI is switched off; the parser and the rules work alone", ...base };
  if (!m.configured) return { state: "degraded", note: "the AI is switched on but has no key, so the parser and the rules work alone", ...base };
  if (m.failed15m >= 5 && m.answered15m === 0) return { state: "degraded", note: "the AI's calls are failing (check the AI account's credit and key); the parser and the rules carry on", ...base };
  if (m.spentMonthUsd >= m.capUsd) return { state: "degraded", note: "the platform's monthly AI cap is reached; the parser and the rules carry on until it is raised or the month ends", ...base };
  const state = by(m.oldestQueuedSec, t.modelWaitDegradedSec, t.modelWaitUnavailableSec);
  return { state, note: state !== "healthy" ? "work is waiting a long time for the AI" : m.spentMonthUsd >= m.capUsd * 0.8 ? "over 80% of the monthly AI cap is used" : m.queued ? "working" : "nothing waiting", ...base };
}
export function worstOf(states: State[]): State { return states.reduce((a, s) => (RANK[s] > RANK[a] ? s : a), "healthy" as State); }

// ---------------------------------------------------------------- request counters: a minute-by-minute ring, bounded however busy the server is
const SAMPLES_PER_MINUTE = 200;
type Bucket = { minute: number; requests: number; errors: number; ms: number[] };
const buckets = new Map<number, Bucket>();
// The same requests counted since this server started, for Prometheus (src/metrics.ts), which works out rates and slowest answers over any period from
// running totals: answers by status class, and how many took at most each bucket's seconds.
export const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] as const;
export const totals = { byClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 } as Record<string, number>, buckets: DURATION_BUCKETS.map(() => 0), count: 0, sumSec: 0 };
const WATCHING = new Set(["/api/health", "/api/ready", "/api/ops/health", "/api/ops/metrics"]);
/** Called for every answered request except health checks and the metrics themselves, so the watchers' own polling never dilutes the figures. */
export function noteRequest(path: string, status: number, ms: number, now = Date.now()) {
  if (WATCHING.has(path)) return;
  const cls = `${Math.min(Math.max(Math.floor(status / 100), 2), 5)}xx`, sec = ms / 1000;
  totals.byClass[cls]++; totals.count++; totals.sumSec += sec;
  DURATION_BUCKETS.forEach((le, i) => { if (sec <= le) totals.buckets[i]++; });
  const minute = Math.floor(now / 60_000);
  let b = buckets.get(minute);
  if (!b) { b = { minute, requests: 0, errors: 0, ms: [] }; buckets.set(minute, b); for (const k of buckets.keys()) if (k < minute - 60) buckets.delete(k); }
  b.requests++; if (status >= 500) b.errors++;
  if (b.ms.length < SAMPLES_PER_MINUTE) b.ms.push(ms); else b.ms[Math.floor(Math.random() * b.requests) % SAMPLES_PER_MINUTE] = ms;
}
export function requestFigures(windowMinutes: number, now = Date.now()) {
  const from = Math.floor(now / 60_000) - windowMinutes + 1; let requests = 0, errors = 0; const ms: number[] = [];
  for (const b of buckets.values()) if (b.minute >= from) { requests += b.requests; errors += b.errors; ms.push(...b.ms); }
  ms.sort((x, y) => x - y);
  return { requests, errors, p95Ms: ms.length ? Math.round(ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))]) : null };
}

// ---------------------------------------------------------------- measuring
const MEASURE_LIMIT_MS = 3000;
/** Runs one measurement with a time limit. If it cannot finish, the check says unknown and why, and the others still report. */
async function measured(what: string, f: () => Promise<Check> | Check): Promise<Check> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(f), new Promise<Check>((_, no) => { timer = setTimeout(() => no(new Error("timeout")), MEASURE_LIMIT_MS); })]); }
  catch (e) { return { state: "unknown", note: `${what} could not be measured (${(e as Error)?.message === "timeout" ? "no answer in time" : "the query failed"})` }; }
  finally { clearTimeout(timer); }
}
export interface Readiness { draining: boolean; schemaInSync: boolean; readOnly: boolean }
async function measureHealth(readiness: Readiness, t: Thresholds = config.opsThresholds) {
  const [database, queue, processing, mail, aiPath] = await Promise.all([
    measured("the database", async () => { const s = performance.now(); await sql`select 1`; return { state: "healthy", note: "answering", ms: Math.round(performance.now() - s) } as Check; }),
    measured("the queue", async () => {
      const orgs = (await sql`select org_id::text as org, count(*)::int as queued, extract(epoch from now() - min(created_at))::int as "oldestSec" from queue where status = 'queued' and run_after <= now() group by org_id`) as unknown as { org: string; queued: number; oldestSec: number }[];
      const [r] = await sql`select count(*)::int as running, count(*) filter (where locked_at < now() - (${t.stuckRunningSec} * interval '1 second'))::int as stuck from queue where status = 'running'`;
      return judgeQueue({ queued: orgs.reduce((a, o) => a + o.queued, 0), running: r.running, stuckRunning: r.stuck, orgs }, t);
    }),
    measured("document processing", async () => {
      const [r] = await sql`select (select count(*)::int from documents where status = 'published' and updated_at > now() - (${t.windowMinutes} * interval '1 minute')) as completed,
                                   (select count(*)::int from error_occurrences where kind in ('suspected_defect', 'confirmed_defect') and occurred_at > now() - (${t.windowMinutes} * interval '1 minute')) as failed`;
      return judgeProcessing({ completed: r.completed, failed: r.failed }, t);
    }),
    measured("e-mail", async () => { const o = await outboxStats(); return judgeMail({ sending: !!mailStatus().sending, pending: o.pending + o.sending, dead: o.dead, oldestUndeliveredSec: o.oldestUndeliveredSec }, t); }),
    measured("the AI", async () => {
      const [q] = await sql`select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'running')::int as running, coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::int, 0) as "oldestQueuedSec" from queue where type like 'model-%' and status in ('queued', 'running')`;
      // Counts and money only, across the platform: no document's text or values.
      const [u] = await sql`select count(*) filter (where outcome = 'answered' and at > now() - interval '15 minutes')::int as answered, count(*) filter (where outcome = 'failed' and at > now() - interval '15 minutes')::int as failed,
          count(*) filter (where outcome = 'refused' and at > now() - interval '15 minutes')::int as refused, coalesce(sum(cost_micro_usd) filter (where at >= ${sastMonthStart()}), 0)::bigint as spent from ai_usage where at >= least(${sastMonthStart()}, now() - interval '15 minutes')`;
      return judgeAi({ reading: config.ai.reading, matching: config.ai.matching, configured: aiConfigured(), queued: q.queued, running: q.running, oldestQueuedSec: q.oldestQueuedSec, answered15m: u.answered, failed15m: u.failed, refused15m: u.refused, spentMonthUsd: Number(u.spent) / 1e6, capUsd: capUsd() }, t);
    }),
  ]);
  const ready: Check = readiness.draining ? { state: "degraded", note: "this server is shutting down" }
    : !readiness.schemaInSync ? { state: "unavailable", note: "the database schema does not match this version" }
    : readiness.readOnly ? { state: "degraded", note: "saving is paused: the main database cannot be reached, reading from the copy" }
    : { state: "healthy", note: "ready" };
  const requests = judgeRequests(requestFigures(t.requestWindowMinutes), t);
  const el = timingStats().eventLoopMs, rssMb = Math.round(process.memoryUsage().rss / 1048576);
  const resources: Check = { state: worstOf([by(el.p99, t.loopDegradedMs, t.loopUnavailableMs), by(rssMb, t.rssDegradedMb, t.rssUnavailableMb)]), note: "this server's memory and responsiveness", scope: "this_server", eventLoopP99Ms: el.p99, rssMb };
  const checks = { readiness: ready, database, queue, processing, requests, mail, resources, ai: aiPath };
  return { state: worstOf(Object.values(checks).map((c) => c.state)), measuredAt: new Date().toISOString(), release: { commit: process.env.ROLEMATCH_COMMIT ?? "unknown", parser: PARSER_VERSION, candidatePipeline: CANDIDATE_PIPELINE_VERSION }, checks };
}

// One answer every few seconds at most, however often it is asked, and simultaneous askers share one measurement: monitoring must not become load.
const CACHE_MS = 10_000;
let cached: { at: number; value: Awaited<ReturnType<typeof measureHealth>> } | null = null, running: Promise<Awaited<ReturnType<typeof measureHealth>>> | null = null;
export async function opsHealth(readiness: Readiness) {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  running ??= measureHealth(readiness).then((value) => { cached = { at: Date.now(), value }; return value; }).finally(() => { running = null; });
  return running;
}

// ---------------------------------------------------------------- the service token
const digest = (s: string) => createHash("sha256").update(s).digest();
/** True only for the configured token. Compared in constant time; a token shorter than 32 characters is treated as not configured. */
export function validOpsToken(header: string | null, configured = config.opsToken): boolean {
  if (configured.length < 32 || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(configured));
}
