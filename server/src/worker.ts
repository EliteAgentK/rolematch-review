// A reading worker (npm run worker): takes jobs from the shared queue (reading documents, deleting) and serves no website. Run as many as the
// reading load needs, beside API servers started with ROLE=api; the queue hands each job to exactly one worker and keeps organisations fair
// (src/queue.ts). It answers only a health check, for whatever keeps it running: GET /health on WORKER_HEALTH_PORT.
import { reconcileReservations } from "./batches";
import { assertServingSettings, config } from "./config";
assertServingSettings();
import { whenDatabaseAnswers, setReturnCheck, startUp, watchPrimary } from "./db";
import { registerDeletion } from "./deletion";
import { serve } from "./httpAdapter";
import { forgetOldMinutes } from "./ai/rateLimit";
import { registerAiMatching } from "./aiMatch";
import { registerJobReading } from "./aiJobRead";
import { registerPipeline } from "./pipeline";
import { startDepartmentSweep } from "./aiRead";
import { startOutbox, stopOutbox } from "./outbox";
import { drain, queueStats, startWorkers } from "./queue";
import { schemaStatus } from "./schema";

// The worker writes records, so it refuses a database that does not match this code, as the API does (it never applies migrations itself).
const strictSchema = config.cookieSecure || process.env.REQUIRE_SCHEMA_SYNC === "true";
const inStep = async () => { const s = await schemaStatus(); if (!s.inSync) console.error("Supabase is NOT in step with the code:\n - " + s.problems.join("\n - ")); return s.inSync; };
if ((await startUp()) === "main" && !(await whenDatabaseAnswers("the schema check", inStep)) && strictSchema) { console.error("Refusing to start: apply the migrations (npm run migrate)."); process.exit(1); }
setReturnCheck(async () => { try { return (await inStep()) || !strictSchema; } catch { return false; } });
registerPipeline();
registerDeletion();
registerAiMatching(); registerJobReading();
await startWorkers();
if (config.workerJobs !== "documents") startDepartmentSweep();   // records read before departments existed are placed by the process that reads with the AI
if (config.workerJobs !== "model") startOutbox();   // an AI worker does nothing else
else setInterval(() => void forgetOldMinutes(), 3_600_000).unref?.();   // the AI's per-minute counts are of no use after a day
watchPrimary();

const health = await serve({
  port: config.workerHealthPort,
  maxBodyBytes: 0,
  async fetch(req) {
    if (new URL(req.url).pathname !== "/health") return new Response("Not found", { status: 404 });
    try { return Response.json({ ok: true, role: "worker", queue: await queueStats() }); }
    catch { return Response.json({ ok: false, role: "worker" }, { status: 503 }); }
  },
});
// The deploy allows 30 seconds (deploy/mac/run.sh): the jobs in hand get 25 of them to finish, and any still unfinished are handed back (queue.ts drain).
const stop = () => { void stopOutbox(); void drain(Number(process.env.WORKER_DRAIN_MS ?? 25_000)).finally(() => { void health.stop?.(); process.exit(0); }); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
console.log(`RoleMatch reading worker started (health on http://localhost:${health.port}/health; ${config.workerConcurrency} documents at a time, ${config.perOrgConcurrency} per organisation)`);

setInterval(() => void reconcileReservations().catch(() => {}), Number(process.env.RECONCILE_MS ?? 30_000)).unref?.();   // see index.ts
