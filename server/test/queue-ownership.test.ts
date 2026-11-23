// Independent audit, 20 Nov 2026. A queued job is its claimer's only while it holds the attempt it claimed: a worker that went silent, had its job taken
// back by the sweeper and given to another worker, and then resumed, could still finish, fail or keep alive the other worker's job. And a worker asked to
// stop (every release) exited a tenth of a second later, leaving each job it held to wait out the sweep and lose an attempt. On a throw-away schema of the
// real database, with the real queue; no document and no AI.
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import postgres from "postgres";
import { setupTestDb, sleep, type TestDb } from "./helpers";

let tdb: TestDb, db: postgres.Sql, queue: typeof import("../src/queue");
const org = crypto.randomUUID(), portal = crypto.randomUUID();
const gates = new Map<string, () => void>(), started = new Set<string>();
beforeAll(async () => {
  tdb = await setupTestDb();
  Object.assign(process.env, { DB_SCHEMA: tdb.schema, WORKER_JOBS: "all", QUEUE_HEARTBEAT_MS: "200", QUEUE_STALE_SECONDS: "3600" });
  vi.resetModules();
  queue = await import("../src/queue");
  db = postgres(process.env.DATABASE_URL!, { max: 2, connection: { search_path: tdb.schema }, onnotice: () => {} });
  await db`insert into orgs (id, name) values (${org}, 'Queue test org')`;
  await db`insert into portals (id, org_id, name) values (${portal}, ${org}, 'Queue test portal')`;
  // A job that runs until the test lets it finish.
  queue.registerHandler("test-held", async (p: { key: string }) => { started.add(p.key); await new Promise<void>((done) => gates.set(p.key, done)); });
  await queue.startWorkers();
}, 120_000);
afterAll(async () => { queue?.stopWorkers(); await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }); await tdb?.teardown(); });

const add = async (key: string) => { const id = crypto.randomUUID(); await db`insert into queue (id, org_id, portal_id, type, payload) values (${id}, ${org}, ${portal}, 'test-held', ${db.json({ key })})`; return id; };
const row = async (id: string) => (await db`select status, attempts, locked_at from queue where id = ${id}`)[0] as { status: string; attempts: number; locked_at: Date };
const until = async (ok: () => boolean | Promise<boolean>) => { for (let i = 0; i < 200 && !(await ok()); i++) await sleep(50); };

test("a job taken back and given to another worker is that worker's: the first worker, resuming, can neither finish it nor keep it alive", async () => {
  const id = await add("fenced");
  await until(() => started.has("fenced"));
  expect(await row(id)).toMatchObject({ status: "running", attempts: 1 });
  // What the sweeper and another worker's claim do while this worker is silent: the job goes back, and is claimed again, which counts the next attempt.
  await db`update queue set status = 'running', attempts = attempts + 1, locked_at = now() - interval '30 minutes' where id = ${id}`;   // older than any heartbeat, younger than the sweep (an hour here)
  await sleep(600);                                                            // the first worker's heartbeats in that time change nothing
  expect((await row(id)).locked_at.getTime()).toBeLessThan(Date.now() - 15 * 60_000);
  gates.get("fenced")!();                                                      // the first worker resumes and finishes
  await sleep(500);
  expect(await row(id)).toMatchObject({ status: "running", attempts: 2 });    // still the second worker's, not marked done by the first
  await db`update queue set status = 'done' where id = ${id}`;                // the second worker finishes it, so it no longer counts against the organisation's share
});

test("asked to stop, a worker finishes what it can in the time it has and hands the rest back without spending their attempt", async () => {
  const quick = await add("quick"), stuck = await add("stuck");
  await until(() => started.has("quick") && started.has("stuck"));
  const stopping = queue.drain(1500);
  await sleep(200); gates.get("quick")!();                                     // this one finishes while the worker drains
  await stopping;
  expect((await row(quick)).status).toBe("done");
  expect(await row(stuck)).toMatchObject({ status: "queued", attempts: 0 });  // handed back at once, its attempt not spent
  gates.get("stuck")!();
  await sleep(300);
  expect(await row(stuck)).toMatchObject({ status: "queued", attempts: 0 });  // and the stopped worker's late finish does not touch it
});
