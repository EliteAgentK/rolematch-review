// Gives each test file its own throwaway schema in the real Supabase project, plus cleanup afterwards.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { PID_FILE, SCHEMA_FILE } from "./globalSetup";
import { FAKE_CLAUDE_KEY, FAKE_CLAUDE_URL } from "./fakeJobClaude";
import { Readable } from "node:stream";
import { setTimeout as sleepFor } from "node:timers/promises";
import postgres from "postgres";
import { serve } from "../src/httpAdapter";
import { adminDeleteUser, deleteObjects } from "../src/supabase";

export const sleep = (ms: number) => sleepFor(ms);

type Stdio = "pipe" | "ignore" | "inherit";
export interface Proc { kill: () => void; /** As a machine failure would: no draining, no goodbye. */ crash: () => void; exited: Promise<number>; stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> }
// Every child this process starts is remembered (in memory, and in PID_FILE for a run that is stopped hard), so none can outlive its test run:
// a normal end or Ctrl-C kills them here; a run killed outright leaves the file for the next run's globalSetup to clean up. It used to be only
// each file's afterAll, which never runs when the run is stopped, so servers stayed on their ports and the next run signed in to the wrong one.
const live = new Set<ChildProcess>();
const stop = (c: ChildProcess) => { try { if (c.pid) process.kill(-c.pid, "SIGTERM"); } catch { try { c.kill(); } catch { /* already gone */ } } };
for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) process.once(sig, () => { live.forEach(stop); if (sig !== "exit") process.exit(1); });
// A test file's servers are gone before the next file starts. Many files share fixed ports, and a server still shutting down answered the next file's first request and then hung up
// ("other side closed"; first seen in CI, register R43). Registered only under the test runner: scripts use these helpers too.
if (process.env.VITEST) {
  const { afterAll } = await import("vitest");
  afterAll(async () => {
    live.forEach(stop);
    const deadline = Date.now() + 15_000;
    while (live.size && Date.now() < deadline) await sleep(50);
    for (const c of live) { try { if (c.pid) process.kill(-c.pid, "SIGKILL"); } catch { /* gone */ } }
  }, 20_000);
}

/** Starts a child process. A leading "tsx" means "run this TypeScript file with the project's own runner". */
export function spawnProc(cmd: string[], o: { env?: Record<string, string>; stdout?: Stdio; stderr?: Stdio } = {}): Proc {
  const [exe, ...args] = cmd[0] === "tsx" ? [process.execPath, "--import", "tsx", ...cmd.slice(1)] : cmd;
  const child = spawn(exe, args, { env: o.env, stdio: ["ignore", o.stdout ?? "pipe", o.stderr ?? "pipe"], detached: true });   // its own process group, so it can be stopped as one
  live.add(child);
  try { if (child.pid) appendFileSync(PID_FILE, `${child.pid} ${process.pid}\n`); } catch { /* the file is a safety net, not a requirement */ }
  const exited = new Promise<number>((done) => child.on("close", (code) => { live.delete(child); done(code ?? 0); }));
  const web = (s: Readable | null) => (s ? (Readable.toWeb(s) as ReadableStream<Uint8Array>) : new ReadableStream<Uint8Array>({ start: (c) => c.close() }));
  return { kill: () => stop(child), crash: () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, exited, stdout: web(child.stdout), stderr: web(child.stderr) };
}

/** A small local stand-in server (for fake AI or email services). */
export function fakeServe(o: { port: number; fetch: (req: Request) => Response | Promise<Response> }) {
  const ready = serve({ port: o.port, fetch: (req) => o.fetch(req) });
  return { ready, stop: async (_force?: boolean) => (await ready).stop() };
}

export interface TestDb { schema: string; env: Record<string, string>; createUser: (org: string, email: string, name: string, password: string) => Promise<void>; teardown: () => Promise<void> }

/** The platform operator's token in every test server: the health details are the operator's alone, never a company administrator's (code review,
 *  16 Nov 2026, A-M3). */
export const TEST_OPS_TOKEN = "test-operator-token-not-a-real-one-0123456789";
export const opsHeaders = { authorization: `Bearer ${TEST_OPS_TOKEN}` };
/** The operator's health details of a test server; reset=true starts its stage timings from zero. */
export const opsDetails = async (base: string, reset = false): Promise<any> => (await fetch(`${base}/api/health/details${reset ? "?reset=1" : ""}`, { method: reset ? "POST" : "GET", headers: opsHeaders })).json();

export async function setupTestDb(extraEnv: Record<string, string> = {}): Promise<TestDb> {
  const schema = `test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try { appendFileSync(SCHEMA_FILE, `${schema} ${process.pid}\n`); } catch { /* the record is a safety net */ }   // recorded BEFORE it exists, so a run stopped at any point is cleaned up by the next
  // Small pools: the database allows only a limited number of simultaneous connections and every test server holds some.
  // The developer's own .env must never change what a test does, so these switches are pinned unless a test sets them itself.
  // Mail is pinned OFF the same way: a real mailbox login in .env must never be inherited by a test server; a test that needs mail sets it itself, against test/fakeSmtp.ts.
  const env = { ...process.env, DB_SCHEMA: schema, DB_POOL_SIZE: "3", SIGNUP_REQUIRE_CODE: "true", SIGNUP_DEV_CODE: "false", TRUST_PROXY: "false", COOKIE_SECURE: "false", MAIL_TRANSPORT: "", MAIL_SMTP_HOST: "", MAIL_SMTP_USER: "", MAIL_SMTP_PASS: "", MAIL_BOUNCE_ADDRESS: "", MAIL_LOCAL_TEST_RECIPIENTS: "", PUBLIC_APP_URL: "http://localhost:5173", CV_PAGE_UNVERIFIED: "allow_unverified", RECONCILE_MS: "3000",
    // the stand-in Claude (test/fakeJobClaude.ts) reads jobs; CV reading and matching by the AI stay off unless a test turns them on itself
    ANTHROPIC_API_KEY: FAKE_CLAUDE_KEY, ANTHROPIC_BASE_URL: FAKE_CLAUDE_URL, AI_READING: "off", AI_MATCHING: "off", AI_MONTHLY_CAP_USD: "25", OPS_TOKEN: TEST_OPS_TOKEN, ...extraEnv } as Record<string, string>;
  const run = async (args: string[]) => {
    const p = spawnProc(["tsx", ...args], { env, stdout: "pipe", stderr: "pipe" });
    const code = await p.exited;
    if (code !== 0) throw new Error(`${args.join(" ")} failed: ${(await new Response(p.stderr).text()).slice(0, 300)}`);
  };
  await run(["src/scripts/migrate.ts"]);
  return {
    schema, env,
    createUser: (org, email, name, password) => run(["src/scripts/createUser.ts", org, email, name, password, "--join-existing"]),   // kits put several people in one organisation
    teardown: async () => {
      const admin = postgres(process.env.DATABASE_URL!, { max: 2 });
      try {
        const users = await admin.unsafe(`select user_id from "${schema}".members`);
        const paths = await admin.unsafe(`select storage_path from "${schema}".documents`);
        await deleteObjects(paths.map((p: any) => p.storage_path));
        // Drop the schema first: users who uploaded documents cannot be deleted while those documents still reference them.
        await admin.unsafe(`drop schema "${schema}" cascade`);
        try { if (existsSync(SCHEMA_FILE)) writeFileSync(SCHEMA_FILE, readFileSync(SCHEMA_FILE, "utf8").split("\n").filter((l) => l.trim() && l.trim().split(/\s+/)[0] !== schema).join("\n") + "\n"); } catch { /* ignore */ }
        for (const u of users) await adminDeleteUser(u.user_id);
      } finally { await admin.end(); }
    },
  };
}
