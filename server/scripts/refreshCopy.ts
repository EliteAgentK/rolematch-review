// npm run copy:refresh        : take a fresh copy of the main database's data into the local copy database, once
// npm run copy:watch          : the same every COPY_REFRESH_MINUTES (default 5), until stopped
//
// The hosted dev project cannot feed a live copy from here (Supabase's free plan allows replication connections only over IPv6; see
// docs/architecture/RESILIENCE.md, step 3), so the copy is refreshed every few minutes instead. RoleMatch reads it only while the main database is
// unreachable (READ_FALLBACK_DATABASE_URL), and the website then says how old the copy is, so a copy is never presented as live.
//
// Safe by construction: the main database is only read. The dump is taken first; if it fails (the main database is down) the copy is left exactly
// as it was. The restore is one transaction, so the copy is never half old and half new. Runs on this machine only, in the container
// "rolematch_devcopy" (port 54401), from the database image the local stack already downloaded; it needs Colima running.
import { dbTls } from "../src/dbTls";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "../src/config";
import { OriginalsCopy } from "../src/originalsCopy";
import { getObject } from "../src/supabase";

const CONTAINER = "rolematch_devcopy", VOLUME = "rolematch_devcopy_data", PORT = 54401;
export const COPY_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
const IMAGE = process.env.COPY_IMAGE ?? "public.ecr.aws/supabase/postgres:17.11.0.004";
const docker = (args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}) =>
  execFileSync("docker", args, { encoding: "utf8", input: opts.input, env: opts.env ?? process.env, maxBuffer: 256 << 20, stdio: ["pipe", "pipe", "pipe"] }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY_TABLES = ["orgs", "members", "candidates", "jobs", "documents", "matches", "audit_events"];

async function ensureCopyDatabase() {
  try { docker(["info", "--format", "{{.ServerVersion}}"]); } catch { throw new Error("Docker is not reachable. Start the Linux machine with: colima start"); }
  const state = (() => { try { return docker(["inspect", "--format", "{{.State.Status}}", CONTAINER]); } catch { return "missing"; } })();
  if (state === "missing") docker(["run", "-d", "--name", CONTAINER, "--restart", "unless-stopped", "-p", `127.0.0.1:${PORT}:5432`, "-v", `${VOLUME}:/var/lib/postgresql/data`, "-e", "POSTGRES_PASSWORD=postgres", IMAGE]);
  else if (state !== "running") docker(["start", CONTAINER]);
  for (let i = 0; i < 60; i++) { try { docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-h", "localhost"]); return; } catch { await sleep(2000); } }
  throw new Error("the copy database did not start");
}

/** Brings the copy of original files in line with the documents in the copy: new originals are fetched (four at a time) and encrypted; files whose
 * document is gone are removed, so a deletion reaches this copy at the next refresh. Without LOCAL_ENCRYPTION_KEY no originals are kept. */
async function syncOriginals(paths: string[]) {
  const store = OriginalsCopy.fromEnv(config.dataDir);
  if (!store.enabled) return null;
  const removed = store.prune(paths), todo = store.missing(paths);
  let copied = 0, failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (p) => { try { store.write(p, await getObject(p)); copied++; } catch { failed++; } }));
  }
  return { copied, removed, failed, total: paths.length - failed };
}

/** The dump, made fit for the copy. The sign-in service's user table (auth.users) is not copied: it holds password hashes, and a read-only copy has
 * no use for them. So the links from RoleMatch's tables to it are left out: in a dump they are "ALTER TABLE ONLY ..." followed by a line
 * "ADD CONSTRAINT ... REFERENCES auth.xxx". The schema itself already exists in the copy. */
export function forCopy(sql: string): string {
  const lines = sql.split("\n"), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "CREATE SCHEMA public;") continue;
    if (lines[i].startsWith("ALTER TABLE ONLY ") && /^\s+ADD CONSTRAINT .* REFERENCES auth\./.test(lines[i + 1] ?? "")) { i++; continue; }
    out.push(lines[i]);
  }
  return out.join("\n");
}

export async function refreshCopy(): Promise<{ at: string; seconds: number; counts: Record<string, [number, number]>; originals?: { copied: number; removed: number; failed: number; total: number } }> {
  const started = Date.now();
  await ensureCopyDatabase();
  // 1. Dump the main database's public schema (definitions and rows). The address is passed through the environment, never on a command line.
  const env = { ...process.env, SRC_URL: config.databaseUrl };
  docker(["exec", "-e", "SRC_URL", CONTAINER, "sh", "-c", 'pg_dump "$SRC_URL" --schema=public --no-owner --no-privileges --format=custom --file=/tmp/next.dump'], { env });
  // 2. Restore it in one transaction. Extensions the tables rely on are created first, in the same schema the main database uses.
  //    One transaction: drop the old copy's tables, recreate them from the dump, commit. A reader sees the old copy or the new one, never a mix.
  const dumpSql = docker(["exec", CONTAINER, "pg_restore", "--no-owner", "--no-privileges", "-f", "-", "/tmp/next.dump"]);
  const prelude = `drop schema if exists public cascade; create schema public; create extension if not exists pg_trgm schema public;
create extension if not exists pgcrypto schema extensions; create extension if not exists "uuid-ossp" schema extensions;\n`;
  docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-q", "-1", "-v", "ON_ERROR_STOP=1", "postgres"], { input: prelude + forCopy(dumpSql) });
  docker(["exec", CONTAINER, "rm", "-f", "/tmp/next.dump"]);
  // 3. Record when the copy was taken (in its own schema, which a restore never touches), and check it against the main database.
  const at = new Date(started).toISOString();
  const main = postgres(config.databaseUrl, { ...dbTls(config.databaseUrl), max: 1, onnotice: () => {} }), copy = postgres(COPY_URL, { ...dbTls(COPY_URL), max: 1, onnotice: () => {} });
  try {
    await copy.unsafe(`create schema if not exists rolematch_copy; create table if not exists rolematch_copy.meta (id int primary key, refreshed_at timestamptz not null, seconds numeric not null)`);
    await copy`insert into rolematch_copy.meta (id, refreshed_at, seconds) values (1, ${at}, ${(Date.now() - started) / 1000}) on conflict (id) do update set refreshed_at = excluded.refreshed_at, seconds = excluded.seconds`;
    const counts: Record<string, [number, number]> = {};
    for (const t of KEY_TABLES) {
      const [a] = await main.unsafe(`select count(*)::int as n from public.${t}`), [b] = await copy.unsafe(`select count(*)::int as n from public.${t}`);
      counts[t] = [a.n, b.n];
    }
    const originals = await syncOriginals((await copy`select storage_path from documents where storage_path is not null`).map((r: any) => r.storage_path as string));
    return { at, seconds: (Date.now() - started) / 1000, counts, ...(originals ? { originals } : {}) };
  } finally { await main.end({ timeout: 2 }); await copy.end({ timeout: 2 }); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const every = process.argv.includes("--watch") ? Number(process.env.COPY_REFRESH_MINUTES ?? 5) : 0;
  const once = async () => {
    try {
      const r = await refreshCopy();
      const drift = Object.entries(r.counts).filter(([, [a, b]]) => a !== b);
      // rows written between the dump and the count are expected while people work; the next refresh catches them up
      console.log(JSON.stringify({ level: "info", event: "copy.refreshed", at: r.at, seconds: Number(r.seconds.toFixed(1)), rows: Object.fromEntries(Object.entries(r.counts).map(([t, [, b]]) => [t, b])), ...(r.originals ? { originals: r.originals } : {}), ...(drift.length ? { changedDuringCopy: drift.map(([t]) => t) } : {}) }));
      return true;
    } catch (e) {
      console.error(JSON.stringify({ level: "warn", event: "copy.refresh_failed", reason: String((e as Error).message).split("\n")[0].slice(0, 200), note: "the previous copy is unchanged" }));
      return false;
    }
  };
  const good = await once();
  if (!every) process.exit(good ? 0 : 1);
  setInterval(() => void once(), every * 60_000);
}
