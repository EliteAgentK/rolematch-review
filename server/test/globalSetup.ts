// Before a run starts, and after it ends, stop any test server a previous run left behind (one that was stopped hard, so its own cleanup never ran).
// Only processes that are still running RoleMatch's server or worker code are stopped; a recycled process id is never touched.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { FAKE_CLAUDE_KEY, FAKE_CLAUDE_URL, startFakeJobClaude } from "./fakeJobClaude";

export const PID_FILE = join(tmpdir(), "rolematch-test-pids.txt");
/** Schemas this machine's test runs created and have not yet removed: the record that lets a later run clean up what a stopped run left, and ONLY that. */
export const SCHEMA_FILE = join(tmpdir(), "rolematch-test-schemas.txt");

// Each line is "<what> <owner>": a server's process id or a schema name, and the process id of the test process that made it. A sweep removes only
// what belongs to a run that has ENDED. It used to remove everything in the files, so starting a second test run (or the end of one) killed the
// servers and dropped the schemas of a run still in progress (R38). A line without an owner comes from an older run and counts as left behind.
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
/** Splits a record into what a sweep may remove (its run has ended) and what it must keep (its run is still going). Pure, for the test. */
export function leftBehind(text: string, isAlive: (pid: number) => boolean = alive): { remove: string[]; keep: string[] } {
  const remove: string[] = [], keep: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [what, owner] = line.split(/\s+/);
    if (owner && Number(owner) && isAlive(Number(owner))) keep.push(line); else remove.push(what);
  }
  return { remove, keep };
}
const rewrite = (file: string, keep: string[]) => { if (keep.length) writeFileSync(file, keep.join("\n") + "\n"); else rmSync(file, { force: true }); };

async function sweep() {
  if (!existsSync(PID_FILE)) return;
  const { remove, keep } = leftBehind(readFileSync(PID_FILE, "utf8"));
  const stopping: number[] = [];
  for (const pid of remove.map(Number).filter(Boolean)) {
    try {
      const cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
      if (/src\/(index|worker)\.ts/.test(cmd)) { try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); } stopping.push(pid); }
    } catch { /* not running */ }
  }
  // Wait until they have really gone: a server still shutting down keeps its fixed port, so the next run's first request reached it and its schema was gone already (R43).
  const deadline = Date.now() + 15_000;
  while (stopping.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  for (const pid of stopping.filter(alive)) { try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } }
  rewrite(PID_FILE, keep);
}
/** Drops schemas (and the sign-in users and stored files in them) that an earlier run on this machine recorded and never removed. Anything not in the record is left alone. */
async function sweepSchemas() {
  if (!existsSync(SCHEMA_FILE)) return;
  const { remove, keep } = leftBehind(readFileSync(SCHEMA_FILE, "utf8"));
  const names = [...new Set(remove.filter((x) => /^test_[0-9a-f]{12}$/.test(x)))];
  if (!names.length) { rewrite(SCHEMA_FILE, keep); return; }
  try {
    const { default: postgres } = await import("postgres");
    const { adminDeleteUser, deleteObjects } = await import("../src/supabase");
    const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
    try {
      for (const n of names) {
        const has = async (t: string) => (await sql.unsafe(`select to_regclass('"${n}".${t}') is not null as x`))[0].x;
        const users = (await has("members")) ? await sql.unsafe(`select user_id from "${n}".members`) : [];
        const paths = (await has("documents")) ? await sql.unsafe(`select storage_path from "${n}".documents`) : [];
        await deleteObjects(paths.map((p: any) => p.storage_path).filter((p: string) => p && p !== "x" && !p.startsWith("missing/")));
        await sql.unsafe(`drop schema if exists "${n}" cascade`);
        for (const u of users) await adminDeleteUser(u.user_id).catch(() => {});
      }
    } finally { await sql.end(); }
    rewrite(SCHEMA_FILE, keep);
  } catch (e) { console.error("could not clean up earlier test schemas:", String((e as Error)?.message ?? e).slice(0, 160)); }
}
/** The database and storage the test servers will use: the environment first, then the settings file, as src/config.ts reads them. */
export function testTargets(env: NodeJS.ProcessEnv = process.env, file = env.ROLEMATCH_ENV_FILE ?? fileURLToPath(new URL("../.env", import.meta.url))): { database: string; supabase: string } {
  let parsed: Record<string, string> = {};
  try { parsed = parseEnv(readFileSync(file, "utf8")) as Record<string, string>; } catch { /* no settings file */ }
  return { database: env.DATABASE_URL ?? parsed.DATABASE_URL ?? "", supabase: env.SUPABASE_URL ?? parsed.SUPABASE_URL ?? "" };
}
export const onThisMachine = (u: string) => /^(?:https?|postgres(?:ql)?):\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(u);

export default async function setup() {
  // Tests make and drop schemas, sign-in users and stored files. They run against this machine's own stack only: server/.env points at live (10 Nov 2026),
  // and a plain `npm test` used to take it, so a test run could have written to the live database. Refused before anything is touched.
  const t = testTargets();
  if (!onThisMachine(t.database) || !onThisMachine(t.supabase)) {
    const why = "Refusing to run the tests: the database or storage is not on this machine (server/.env points at live). Run `npm run test:local` with the local Supabase stack started (server/README.md).";
    console.error(`\n${why}\n`);   // vitest 5 cannot print an error thrown here (it fails on its own stack trace), so the reason is written out first
    throw new Error(why);
  }
  await sweep(); await sweepSchemas();
  // Jobs are read by Claude alone: every test server gets the stand-in (test/fakeJobClaude.ts), never the real service, whatever a developer's .env holds.
  const claude = await startFakeJobClaude();
  Object.assign(process.env, { ANTHROPIC_API_KEY: FAKE_CLAUDE_KEY, ANTHROPIC_BASE_URL: FAKE_CLAUDE_URL });
  return async () => { await sweep(); await new Promise((r) => claude.close(r)); };
}
