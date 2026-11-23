// Runs on the PC: the disposable database and several API servers, all children of this one process, so ending the session (Windows closes what an SSH session started) or the memory guard ends everything. Nothing here reaches the live service.
//   node pcServe.mjs <servers> <connections each> <workers> [KEY=VALUE ...]
import { spawn, spawnSync } from "node:child_process";
import { freemem } from "node:os";
import { join } from "node:path";

const [servers, pool, workers, ...extra] = process.argv.slice(2), TOOLS = join(process.env.USERPROFILE, "tools"), CODE = join(TOOLS, "bench", "server");
const NODE = process.execPath, PG = join(TOOLS, "pgsql", "bin", "postgres.exe"), children = [];
const MIN_FREE_MB = 400;
const stopAll = (why) => { console.log(`stopping: ${why}`); for (const c of children) { try { c.kill(); } catch { /* already gone */ } } setTimeout(() => process.exit(0), 1500); };
const run = (name, cmd, args, env, cwd) => {
  const c = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", (d) => { const s = String(d).trim(); if (/FATAL|PANIC|Error:|error:|"error"/.test(s)) console.log(`${name}: ${s.slice(0, 300)}`); });
  c.on("exit", (code) => console.log(`${name} ended (${code})`));
  children.push(c);
};
run("database", PG, ["-D", join(TOOLS, "pgdata")], {}, TOOLS);
// After a hard stop the database replays its log first, which takes longer the more was written; nothing may connect before it is ready.
const ISREADY = join(TOOLS, "pgsql", "bin", "pg_isready.exe");
for (let i = 0; i < 180; i++) { if (spawnSync(ISREADY, ["-q", "-h", "127.0.0.1", "-p", "15432"]).status === 0) break; await new Promise((r) => setTimeout(r, 1000)); }
const env = Object.fromEntries(extra.map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
const common = { NODE_ENV: "production", COOKIE_SECURE: "true", TRUST_PROXY: "true", RATE_LOG: "off", SUPABASE_URL: "http://127.0.0.1:54321", ...env };
for (let i = 1; i <= Number(servers); i++) run(`api${i}`, NODE, ["--max-old-space-size=450", "--env-file=../bench.env", "--import", "tsx", "src/index.ts"], { ...common, ROLE: "api", PORT: String(18800 + i), DB_POOL_SIZE: pool }, CODE);
for (let i = 1; i <= Number(workers); i++) run(`worker${i}`, NODE, ["--max-old-space-size=700", "--env-file=../bench.env", "--import", "tsx", "src/worker.ts"], { ...common, WORKER_JOBS: "documents", WORKER_HEALTH_PORT: String(18950 + i), DB_POOL_SIZE: "6" }, CODE);
// The model's own worker: the chef in the back, reading after the rules. It reaches the Mac's model through this session's link, which counts as this machine.
if (env.AI_READING === "on" || env.AI_MATCHING === "on") run("ai-worker", NODE, ["--max-old-space-size=500", "--env-file=../bench.env", "--import", "tsx", "src/worker.ts"], { ...common, WORKER_JOBS: "model", WORKER_HEALTH_PORT: "18990", DB_POOL_SIZE: "3", WORKER_CONCURRENCY: "2" }, CODE);
console.log("started");
setInterval(() => { const mb = freemem() / 1048576; if (mb < MIN_FREE_MB) stopAll(`only ${Math.round(mb)} MB of memory free`); }, 5000);
process.on("SIGTERM", () => stopAll("asked"));
