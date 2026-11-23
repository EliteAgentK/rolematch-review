// RoleMatch's numbers for Prometheus (docs/ops/TRENDS_AND_LOAD.md), in its text format, at /api/ops/metrics behind the operator token.
// Built from the health report (src/opsHealth.ts: one measurement every 10 seconds at most, however often it is asked) and the request totals kept beside
// it, so scraping adds no work for the database. Counts, ages, durations and states only, across the platform: no organisation, person, document,
// address or token, so nothing Prometheus keeps is personal data. A check that could not be measured gives its state and no numbers: Prometheus then
// shows a gap, never a zero that looks healthy.
import { opsHealth, totals, DURATION_BUCKETS, type Readiness, type State } from "./opsHealth";

const STATE_NUMBER: Record<State, number> = { healthy: 0, degraded: 1, unknown: 2, unavailable: 3 };
/** One line: its labels, its number, and for a histogram's lines the part of the name after the family's (_bucket, _sum, _count). */
type Sample = [labels: Record<string, string>, value: number, suffix?: string];
interface Family { name: string; help: string; type: "gauge" | "counter" | "histogram"; samples: Sample[] }

const label = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (l: Record<string, string>) => { const k = Object.keys(l); return k.length ? `{${k.map((x) => `${x}="${label(l[x])}"`).join(",")}}` : ""; };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The text Prometheus reads (its exposition format, version 0.0.4). */
function render(families: Family[]): string {
  const out: string[] = [];
  for (const f of families) {
    if (!f.samples.length) continue;
    out.push(`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`);
    for (const [l, v, suffix = ""] of f.samples) out.push(`${f.name}${suffix}${labels(l)} ${v}`);
  }
  return out.join("\n") + "\n";
}

export async function metricsText(readiness: Readiness): Promise<string> {
  const h = await opsHealth(readiness), c = h.checks as Record<string, any>;
  const gauge = (name: string, help: string, samples: [Record<string, string>, unknown][]): Family =>
    ({ name, help, type: "gauge", samples: samples.flatMap(([l, v]) => { const n = num(v); return n === null ? [] : [[l, n] as Sample]; }) });
  const measured = (check: string) => c[check] && c[check].state !== "unknown";
  const q = measured("queue") ? c.queue : {}, ai = measured("ai") ? c.ai : {}, mail = measured("mail") ? c.mail : {}, pr = measured("processing") ? c.processing : {};
  const families: Family[] = [
    { name: "rolematch_build_info", help: "The release this server runs (always 1).", type: "gauge", samples: [[{ commit: h.release.commit.slice(0, 12) }, 1]] },
    gauge("rolematch_check_state", "Each health check: 0 healthy, 1 degraded, 2 unknown (could not be measured), 3 unavailable.", Object.entries(c).map(([check, v]) => [{ check }, STATE_NUMBER[v.state as State]])),
    gauge("rolematch_database_answer_seconds", "How long the database took to answer a trivial query.", [[{}, num(c.database?.ms) === null ? null : c.database.ms / 1000]]),
    gauge("rolematch_queue_jobs", "Document jobs in the queue, by state.", [[{ state: "queued" }, q.queued], [{ state: "running" }, q.running], [{ state: "stopped_reporting" }, q.stuckRunning]]),
    gauge("rolematch_queue_oldest_wait_seconds", "How long the oldest waiting job has waited.", [[{}, q.oldestQueuedSec]]),
    gauge("rolematch_queue_organisations_behind", "Organisations whose oldest waiting job is past the alert threshold.", [[{}, q.organisationsBehind]]),
    gauge("rolematch_documents_window", "Documents in the health report's window, by outcome.", [[{ outcome: "published" }, pr.completed], [{ outcome: "failed_unexplained" }, pr.failed]]),
    gauge("rolematch_mail_messages", "E-mail not yet delivered, by state.", [[{ state: "waiting" }, mail.pending], [{ state: "given_up" }, mail.dead]]),
    gauge("rolematch_mail_oldest_undelivered_seconds", "How long the oldest undelivered e-mail has waited.", [[{}, mail.oldestUndeliveredSec]]),
    gauge("rolematch_ai_jobs", "Work waiting for the AI, by state.", [[{ state: "queued" }, ai.queued], [{ state: "running" }, ai.running]]),
    gauge("rolematch_ai_oldest_wait_seconds", "How long the oldest work waiting for the AI has waited.", [[{}, ai.oldestQueuedSec]]),
    gauge("rolematch_ai_calls_last_15m", "AI calls in the last 15 minutes, by outcome.", [[{ outcome: "answered" }, ai.answeredLast15Min], [{ outcome: "failed" }, ai.failedLast15Min], [{ outcome: "refused" }, ai.refusedLast15Min]]),
    gauge("rolematch_ai_spent_month_usd", "The platform's AI spend this month (Johannesburg months), in dollars.", [[{}, ai.spentThisMonthUsd]]),
    gauge("rolematch_ai_monthly_cap_usd", "The platform's monthly AI safety cap, in dollars.", [[{}, ai.monthlyCapUsd]]),
    gauge("rolematch_event_loop_delay_p99_seconds", "This server's event-loop delay, slowest 1%: pressure on the process itself.", [[{}, num(c.resources?.eventLoopP99Ms) === null ? null : c.resources.eventLoopP99Ms / 1000]]),
    gauge("rolematch_resident_memory_bytes", "This server's memory in use.", [[{}, num(c.resources?.rssMb) === null ? null : c.resources.rssMb * 1048576]]),
    { name: "rolematch_http_responses_total", help: "Answered requests since this server started, by status class (health checks and metrics excluded).", type: "counter", samples: Object.entries(totals.byClass).map(([cls, v]) => [{ class: cls }, v] as Sample) },
    { name: "rolematch_http_request_duration_seconds", help: "How long answered requests took (health checks and metrics excluded).", type: "histogram",
      samples: [...DURATION_BUCKETS.map((le, i) => [{ le: String(le) }, totals.buckets[i], "_bucket"] as Sample), [{ le: "+Inf" }, totals.count, "_bucket"], [{}, Math.round(totals.sumSec * 1000) / 1000, "_sum"], [{}, totals.count, "_count"]] },
  ];
  return render(families);
}
