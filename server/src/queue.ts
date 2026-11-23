import { record } from "./timing";
import { currentPortal, forPortal, newId, platformSql as sql } from "./db";   // platform-wide tables: never one organisation's (db.ts)
import { config } from "./config";

type Handler = (payload: any, job: { id: string; orgId: string; portalId: string; attempts: number }) => Promise<void>;
const handlers = new Map<string, Handler>();
let running = 0;
let ticking = false;
let working = false;   // only a process that called startWorkers reads documents; a website-only server (ROLE=api) just adds jobs
// A running job checks in every HEARTBEAT; one silent for STALE belonged to a worker that stopped, and goes back in the queue.
// Short enough that a crash is recovered within minutes; long enough that a worker starting up never takes jobs a live worker holds.
const HEARTBEAT_MS = Number(process.env.QUEUE_HEARTBEAT_MS ?? 30_000), STALE = `${Number(process.env.QUEUE_STALE_SECONDS ?? 120)} seconds`;   // configurable so a restart test need not wait two minutes
let timer: ReturnType<typeof setInterval> | undefined;
let sweeper: ReturnType<typeof setInterval> | undefined;

export function registerHandler(type: string, handler: Handler) { handlers.set(type, handler); }

/** Queues work for the portal currently in scope (a job always belongs to one portal, and runs only inside it). */
export async function enqueue(orgId: string, type: string, payload: unknown, maxAttempts = 3) {
  const id = await enqueueIn(sql, orgId, type, payload, maxAttempts);
  void tick(); // start work straight away instead of waiting for the next poll
  return id;
}
/** The same, inside the caller's transaction: the work is queued if and only if the caller's own change is saved with it. Call kick() once it commits.
 *  (10 Nov 2026: a document marked "being read by the AI" and its reading queued a moment later; a restart between the two left the document waiting
 *  for a reading that was never asked for.) */
export async function enqueueIn(q: any, orgId: string, type: string, payload: unknown, maxAttempts = 3) {
  const id = newId(), portalId = currentPortal();
  if (!portalId) throw new Error("enqueue needs a portal in scope: queued work always belongs to one portal");
  await q`insert into queue (id, org_id, portal_id, type, payload, max_attempts) values (${id}, ${orgId}, ${portalId}, ${type}, ${sql.json(payload as any)}, ${maxAttempts})`;
  return id;
}
export const kick = () => void tick();

/** Atomically claim the oldest ready job whose organisation is below its concurrency ceiling. Safe with several workers.
 *  Claims of one lane take turns (a lock held for the claim alone): counted at the same moment, forty claims would each see an organisation below its share
 *  and all take a slot, which the 1,000-portal load test showed (24 running against a share of 20). */
export async function claim() {
  // Who is busy is counted once per claim, from the few jobs running or taken in the last minute, never once for every waiting job: with 2,000 waiting the
  // per-job counts took 1.3 s a claim on the PC (median; 5.7 s at the 95th percentile), and claims of a lane take turns.
  const rows = await sql.begin(async (q) => { await q`select pg_advisory_xact_lock(hashtext(${"rolematch-queue-claim-" + config.workerJobs}))`; return q`
    with lane as (select (${config.workerJobs} = 'all') as every, (${config.workerJobs} = 'model') as model),
    busy as (
      select r.org_id, r.portal_id, (r.type like 'model-%') as ai, count(*) filter (where r.status = 'running') as running, count(*) filter (where r.locked_at > now() - interval '1 minute') as lately
      from queue r, lane where (r.status = 'running' or r.locked_at > now() - interval '1 minute') and (lane.every or lane.model = (r.type like 'model-%'))
      group by 1, 2, 3),
    org as (select org_id, ai, sum(running) as running, sum(lately) as lately from busy group by 1, 2),
    next as (
      select q.id from queue q cross join lane
      left join org o on o.org_id = q.org_id and o.ai = (q.type like 'model-%')
      left join busy p on p.org_id = q.org_id and p.portal_id = q.portal_id and p.ai = (q.type like 'model-%')
      where q.status = 'queued' and q.run_after <= now() and (lane.every or lane.model = (q.type like 'model-%'))
        and coalesce(o.running, 0) < (case when q.type like 'model-%' then ${config.ai.perOrgConcurrency}::int else ${config.perOrgConcurrency}::int end)
      -- Fair between organisations, then between an organisation's portals: whoever has the fewest jobs of this class running goes first, and of those whoever was
      -- served least in the last minute (without it the oldest job won every tie: an organisation that queued 1,000 jobs first had every other turn, register R169);
      -- then a CV waiting for the AI's reading, since a person is waiting for it; oldest first within that.
      order by coalesce(o.running, 0), coalesce(o.lately, 0), coalesce(p.running, 0), coalesce(p.lately, 0), (q.type = 'model-read') desc, q.created_at limit 1
      for update of q skip locked)
    update queue set status = 'running', attempts = attempts + 1, locked_at = now()
    from next where queue.id = next.id
    returning queue.id, queue.created_at, queue.org_id, queue.portal_id, queue.type, queue.payload, queue.attempts, queue.max_attempts`; });
  return rows[0] as { id: string; created_at: Date; org_id: string; portal_id: string; type: string; payload: any; attempts: number; max_attempts: number } | undefined;
}

// The jobs this process holds, each with the attempt it claimed. Every claim counts an attempt, so the number is also whose the job is: once the sweeper
// has given a silent job to another worker, its attempt has moved on, and a heartbeat or an outcome from the worker that went silent changes nothing
// (independent audit, 20 Nov 2026: a worker paused past the sweep and then resumed could finish, fail or keep alive a job another worker held).
const held = new Map<string, number>();
async function runOne(row: NonNullable<Awaited<ReturnType<typeof claim>>>) {
  record("queue.wait", Date.now() - new Date(row.created_at).getTime());   // from being queued to a worker taking it
  const handler = handlers.get(row.type), mine = () => sql`id = ${row.id} and status = 'running' and attempts = ${row.attempts}`;
  held.set(row.id, row.attempts);
  const alive = setInterval(() => void sql`update queue set locked_at = now() where ${mine()}`.catch(() => {}), HEARTBEAT_MS);
  try {
    if (!handler) throw new Error(`No handler for ${row.type}`);
    await forPortal(row.org_id, row.portal_id, () => handler(row.payload, { id: row.id, orgId: row.org_id, portalId: row.portal_id, attempts: row.attempts }));   // the job's own portal only
    await sql`update queue set status = 'done' where ${mine()}`;
  } catch (err: any) {
    const exhausted = row.attempts >= row.max_attempts;
    const backoffMs = Math.min(60_000, 2_000 * 2 ** row.attempts);
    const ours = await sql`update queue set status = ${exhausted ? "failed" : "queued"}, run_after = now() + (${backoffMs} * interval '1 millisecond'),
              last_error = ${String(err?.message ?? err).slice(0, 500)} where ${mine()} returning id`;
    if (exhausted && ours.length) await forPortal(row.org_id, row.portal_id, async () => handlers.get(`${row.type}:failed`)?.(row.payload, { id: row.id, orgId: row.org_id, portalId: row.portal_id, attempts: row.attempts })).catch(() => {});
  } finally { clearInterval(alive); held.delete(row.id); }
}

export async function tick() {
  if (ticking || !working) return;
  ticking = true;
  try {
    // Claim one job at a time and stop at the first empty answer. Claims of a lane take turns anyway (claim()'s lock), so asking for every free slot at
    // once was no faster: with the queue empty the AI worker sent 40 claims a second through its 2 connections, kept both busy for ever and its own
    // health check waited behind them (9 Nov 2026: "unhealthy", 4.9 s to answer).
    while (working && config.workerConcurrency - running > 0) {
      const row = await claim().catch(() => undefined);
      if (!row) break;
      running++;
      runOne(row).catch((e) => console.error(JSON.stringify({ queueError: String(e?.message ?? e) }))).finally(() => { running--; void tick(); });
    }
  } catch (e: any) {
    console.error(JSON.stringify({ queueClaimError: String(e?.message ?? e) }));
  } finally { ticking = false; }
}

export async function startWorkers() {
  // After a crash, jobs are left marked running with no one checking in; handlers are idempotent so retrying is safe.
  // Several workers may be running, so only jobs that have gone silent are taken back, never every running job.
  // During an outage (read-only from the copy) this cannot be saved; the sweeper picks such jobs up once the main database is back.
  working = true;
  // A job whose worker died counts that attempt. One that keeps killing its worker (a document that exhausts memory, say) stops at its limit and is reported as failed; otherwise it would take the worker down for ever.
  const requeueSilent = async () => {
    try {
      await sql`update queue set status = 'queued' where status = 'running' and locked_at < now() - ${STALE}::interval and attempts < max_attempts`;
      const spent = await sql`update queue set status = 'failed', last_error = 'its worker stopped on every attempt' where status = 'running' and locked_at < now() - ${STALE}::interval and attempts >= max_attempts returning id, org_id, portal_id, type, payload, attempts`;
      for (const r of spent as any[]) await forPortal(r.org_id, r.portal_id, async () => handlers.get(`${r.type}:failed`)?.(r.payload, { id: r.id, orgId: r.org_id, portalId: r.portal_id, attempts: r.attempts })).catch((e) => console.error(JSON.stringify({ queueError: String(e?.message ?? e) })));
    } catch { /* the sweeper runs again shortly */ }
  };
  await requeueSilent();
  timer = setInterval(() => void tick(), 1000);
  sweeper = setInterval(() => void requeueSilent(), HEARTBEAT_MS);
  void tick();
}
export function stopWorkers() { working = false; if (timer) clearInterval(timer); if (sweeper) clearInterval(sweeper); }
/** On shutdown: takes no more work, lets the jobs in hand finish for up to `ms`, and hands back any still unfinished, without counting the attempt this
 *  process could not complete, so another worker takes them up at once instead of after the sweeper's two minutes (independent audit, 20 Nov 2026: the
 *  worker used to exit a tenth of a second after being asked to stop, at every release, and each job it held waited out the sweep and lost an attempt). */
export async function drain(ms: number) {
  stopWorkers();
  const until = Date.now() + ms;
  while (held.size && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  for (const [id, attempts] of held) await sql`update queue set status = 'queued', attempts = attempts - 1, run_after = now() where id = ${id} and status = 'running' and attempts = ${attempts}`.catch(() => {});
}
let restarting = false;
/** Takes no more work and ends the process once every job it holds has finished, so whatever keeps it running starts a fresh one. For work that could not be
 *  stopped from inside (a reading stuck past its time limit): the other jobs finish first, so none of them loses an attempt (code review, 16 Nov 2026, B-M3). */
export function restartWhenIdle(why: string) {
  if (restarting) return;
  restarting = true; stopWorkers();
  console.error(JSON.stringify({ level: "warn", event: "worker.restart_when_idle", why, running }));
  const check = setInterval(() => { if (running > 0) return; clearInterval(check); process.exit(1); }, 1000);
}
export async function queueStats() {
  const r = (await sql`select status, count(*)::int as c from queue where status in ('queued','failed') group by status`) as { status: string; c: number }[];
  return { running, queued: r.find((x) => x.status === "queued")?.c ?? 0, failed: r.find((x) => x.status === "failed")?.c ?? 0 };
}
