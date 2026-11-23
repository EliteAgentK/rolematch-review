// npm run rehearse:outage : a real outage, rehearsed on this machine (docs/architecture/RESILIENCE.md, step 3).
//
//   1. a live copy: a second PostgreSQL ("rolematch_copy") subscribes to every change in the main local database (logical replication)
//   2. RoleMatch runs against the main database, with the copy configured as its read-only fallback
//   3. a recruiter signs up, uploads a CV and it is published; the candidate must reach the copy within seconds
//   4. the main database is switched off: RoleMatch must switch to the copy, keep showing everything, and refuse saves with "saving is paused"
//   5. the main database is switched back on: RoleMatch must return to normal by itself, and saving must work again
//
// Needs Colima and the local Supabase stack (server/README.md). Uses only invented data and only addresses on this machine. It reuses the database
// image the stack already downloaded, so it fetches nothing. Exits non-zero if any step fails.
import { dbTls } from "../src/dbTls";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sampleCv } from "../test/fixtures";
import { OriginalsCopy } from "../src/originalsCopy";

const root = fileURLToPath(new URL("../..", import.meta.url)), serverDir = fileURLToPath(new URL("..", import.meta.url));
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`\n== ${s}`);
const ok = (s: string) => console.log(`   ok  ${s}`);
// A failed step must still put everything back (restart the main database, remove the copy): `cleanUp` is set once those exist.
let cleanUp: (code: number) => Promise<never> = async (code) => process.exit(code);
const failNow = (s: string): never => { console.error(`   FAILED  ${s}`); void cleanUp(1); throw new Error(s); };

const status = JSON.parse(sh("supabase", ["status", "-o", "json"]));
const MAIN = status.DB_URL as string, API = status.API_URL as string, SERVICE = (status.SERVICE_ROLE_KEY ?? status.SECRET_KEY) as string;
const COPY = "postgresql://postgres:postgres@127.0.0.1:54400/postgres";
for (const u of [MAIN, API, COPY]) if (!/(127\.0\.0\.1|localhost)/.test(u)) failNow(`refusing a non-local address: ${u}`);
const IMAGE = sh("docker", ["inspect", "--format", "{{.Config.Image}}", "supabase_db_rolematch"]);
const PORT = 8799, base = `http://localhost:${PORT}`;

step("1. a live copy of the main database");
try { sh("docker", ["rm", "-f", "rolematch_copy"]); } catch { /* none yet */ }
sh("docker", ["run", "-d", "--name", "rolematch_copy", "--network", "supabase_network_rolematch", "-p", "127.0.0.1:54400:5432", "-e", "POSTGRES_PASSWORD=postgres", IMAGE]);
for (let i = 0; i < 60; i++) { try { sh("docker", ["exec", "rolematch_copy", "pg_isready", "-U", "postgres", "-h", "localhost"]); break; } catch { await sleep(2000); } }
const env = { ...process.env, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: SERVICE, ANTHROPIC_API_KEY: "" };
execFileSync("node", ["--import", "tsx", "src/scripts/migrate.ts"], { cwd: serverDir, env: { ...env, DATABASE_URL: MAIN }, stdio: "pipe" });
// The copy needs the same tables, because logical replication copies rows, not table definitions: they are taken from the main database itself.
// ...including the extensions those tables use (search uses pg_trgm), installed in the same schema
const extensions = execFileSync("docker", ["exec", "supabase_db_rolematch", "psql", "-U", "postgres", "-tA", "-c", "select extname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public'", "postgres"], { encoding: "utf8" }).split("\n").filter(Boolean);
for (const x of extensions) execFileSync("docker", ["exec", "rolematch_copy", "psql", "-U", "postgres", "-q", "-c", `create extension if not exists "${x}" schema public`, "postgres"], { stdio: "pipe" });
const tables = execFileSync("docker", ["exec", "supabase_db_rolematch", "pg_dump", "-U", "postgres", "--schema-only", "--schema=public", "--no-owner", "--no-privileges", "postgres"], { encoding: "utf8", maxBuffer: 64 << 20 });
execFileSync("docker", ["exec", "-i", "rolematch_copy", "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "postgres"], { input: tables.replace(/^CREATE SCHEMA public;$/m, ""), stdio: ["pipe", "ignore", "pipe"] });
const main = postgres(MAIN, { ...dbTls(MAIN), max: 2, onnotice: () => {} }), copy = postgres(COPY, { ...dbTls(COPY), max: 2, onnotice: () => {} });
await main.unsafe(`delete from public.rate_limits`); // earlier runs from this machine must not use up this run's sign-up allowance (local database only)
// A slot left by an earlier, interrupted run would make the main database keep its change log for ever (disk slowly fills): clear it first.
await main.unsafe(`select pg_drop_replication_slot(slot_name) from pg_replication_slots where slot_name = 'rolematch_copy' and not active`);
await main.unsafe(`drop publication if exists rolematch_copy`);
await main.unsafe(`create publication rolematch_copy for tables in schema public`);
await copy.unsafe(`create subscription rolematch_copy connection 'host=supabase_db_rolematch port=5432 user=postgres password=postgres dbname=postgres' publication rolematch_copy with (copy_data = true)`);
ok("the copy subscribes to every table in the main database's public schema");

step("2. RoleMatch runs on the main database, with the copy as its read-only fallback");
const dataDir = mkdtempSync(join(tmpdir(), "rolematch-rehearsal-")); // held uploads, copied originals and the journal land here
const localKey = randomBytes(32); // encrypts them, for this rehearsal only
const server = spawn("node", ["--import", "tsx", "src/index.ts"], { cwd: serverDir, env: { ...env, PORT: String(PORT), DATABASE_URL: MAIN, READ_FALLBACK_DATABASE_URL: COPY, DB_CHECK_MS: "1000", DATA_DIR: dataDir, LOCAL_ENCRYPTION_KEY: localKey.toString("base64"), SIGNUP_REQUIRE_CODE: "false", COOKIE_SECURE: "false", RESEND_API_KEY: "" }, stdio: ["ignore", "ignore", "pipe"] });
let serverLog = ""; server.stderr.on("data", (d) => { serverLog += String(d); });
const jar = new Map<string, string>();
const req = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "http://localhost:5173" } });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return res;
};
const health = async () => { try { const r = await fetch(base + "/api/health"); return r.ok ? (r.headers.get("x-rolematch-mode") ?? "normal") : "down"; } catch { return "down"; } };
for (let i = 0; i < 100 && (await health()) === "down"; i++) await sleep(200);
const finish = async (code: number) => {
  server.kill(); rmSync(dataDir, { recursive: true, force: true }); try { sh("docker", ["start", "supabase_db_rolematch"]); } catch { /* already running */ }
  // the stack's sign-in and storage services reconnect to the restarted database: wait until sign-in answers again before handing the stack back
  // Sign-in and storage keep pooled connections to the database they lost, so "healthy" is not enough: wait for three rounds of real answers.
  const auth = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };
  for (let i = 0, good = 0; i < 90 && good < 3; i++) {
    try {
      const dbOk = sh("docker", ["inspect", "--format", "{{.State.Health.Status}}", "supabase_db_rolematch"]) === "healthy";
      // real requests that touch the database, not health checks: a service can report healthy while its pooled connections are still dead
      const ok = dbOk && (await fetch(`${API}/auth/v1/admin/users?per_page=1`, { headers: auth })).ok && (await fetch(`${API}/storage/v1/bucket`, { headers: auth })).ok
        && (await fetch(`${API}/auth/v1/.well-known/jwks.json`)).ok;
      good = ok ? good + 1 : 0;
    } catch { good = 0; }
    await sleep(1000);
  } await main.end({ timeout: 2 }).catch(() => {}); await copy.unsafe(`drop subscription if exists rolematch_copy`).catch(() => {}); await copy.end({ timeout: 2 }).catch(() => {});
  try { sh("docker", ["exec", "supabase_db_rolematch", "psql", "-U", "postgres", "-qtAc", "select pg_drop_replication_slot(slot_name) from pg_replication_slots where slot_name = 'rolematch_copy' and not active", "postgres"]); } catch { /* none left */ } try { sh("docker", ["rm", "-f", "rolematch_copy"]); } catch { /* gone */ } process.exit(code); };
cleanUp = finish as (code: number) => Promise<never>;
process.on("uncaughtException", (e) => { if (!String(e?.message).length) console.error(e); void finish(1); });
if ((await health()) !== "normal") failNow("RoleMatch did not start");
ok("RoleMatch is up, mode normal");

step("3. a recruiter saves real work, and it reaches the copy");
const run = crypto.randomUUID().slice(0, 8);
const signup = await req("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Rehearsal Recruiter", orgName: `Rehearsal ${run}`, email: `rehearsal-${run}@example.test`, password: "rehearsal-password-long" }) });
if (signup.status >= 300) failNow(`sign-up returned ${signup.status}: ${(await signup.text()).slice(0, 200)}`);
const form = new FormData(); form.append("kind", "cv"); form.append("file", new File([await sampleCv("Thandeka Rehearsal")], "cv.docx"));
const doc: any = await (await req("/api/documents", { method: "POST", body: form })).json();
let published: any;
for (let i = 0; i < 60; i++) { published = await (await req(`/api/documents/${doc.id}`)).json(); if (published.status !== "processing") break; await sleep(500); }
if (published?.status !== "published") failNow(`the CV did not publish (${published?.status})`);
const candidateId = published.recordId as string;
ok(`CV uploaded and published as candidate ${candidateId.slice(0, 8)}`);
const t0 = Date.now(); let copied = false;
for (let i = 0; i < 50 && !copied; i++) { copied = (await copy`select 1 from candidates where id = ${candidateId}`).length > 0; if (!copied) await sleep(200); }
if (!copied) failNow("the candidate did not reach the copy within 10 s");
ok(`the candidate reached the copy in ${Date.now() - t0} ms`);
// What a copy refresh does for originals (scripts/refreshCopy.ts): keep RoleMatch's own encrypted copy of the file.
const original = Buffer.from(await (await req(`/api/documents/${doc.id}/original`)).arrayBuffer());
const [{ storage_path: storagePath }] = await main`select storage_path from documents where id = ${doc.id}`;
new OriginalsCopy(join(dataDir, "originals-copy"), localKey).write(storagePath, original);
ok("RoleMatch's own encrypted copy of the original CV is in place");

step("4. the main database is switched off");
sh("docker", ["stop", "supabase_db_rolematch"]);
const off = Date.now(); let mode = "";
for (let i = 0; i < 60 && mode !== "read-only"; i++) { await sleep(500); mode = await health(); }
if (mode !== "read-only") failNow(`RoleMatch did not switch to the copy (mode ${mode})`);
ok(`RoleMatch switched to the copy ${((Date.now() - off) / 1000).toFixed(1)} s after the main database went down`);
const list = await req("/api/candidates");
const items = list.ok ? ((await list.json()) as any).items : [];
if (!list.ok || !items.some((c: any) => c.id === candidateId)) failNow(`the candidate list was not served from the copy (${list.status})`);
if (list.headers.get("x-rolematch-mode") !== "read-only") failNow("the response did not say read-only, so the website would show no notice");
ok("the recruiter is still signed in and still sees the candidate, with the read-only notice");
const rec: any = await (await req(`/api/candidates/${candidateId}`)).json();
const save = await req(`/api/candidates/${candidateId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "reviewed", version: rec.version }) });
const saveBody: any = await save.json().catch(() => ({}));
if (save.status !== 503 || saveBody?.error?.code !== "SVC-READONLY") failNow(`a save during the outage returned ${save.status} ${saveBody?.error?.code ?? ""}, not 503 SVC-READONLY`);
ok(`a save is refused clearly: "${String(saveBody.error.message).slice(0, 60)}..."`);
const heldForm = new FormData(); heldForm.append("kind", "cv"); heldForm.append("file", new File([await sampleCv("Sipho Heldupload")], "held-cv.docx"));
const heldRes = await req("/api/documents", { method: "POST", body: heldForm });
const heldDoc: any = await heldRes.json();
if (heldRes.status !== 202 || heldDoc.stage !== "held") failNow(`an upload during the outage returned ${heldRes.status} ${heldDoc?.stage ?? heldDoc?.error?.code}, not 202 held`);
const waitingList: any[] = await (await req("/api/documents")).json();
if (!waitingList.some((d) => d.id === heldDoc.id && d.stage === "held")) failNow("the held upload is not shown as waiting");
ok("a CV uploaded during the outage is accepted, held encrypted, and shown as waiting");
const viewedAt = Date.now();
const view = await req(`/api/documents/${doc.id}/original`);
const viewed = Buffer.from(await view.arrayBuffer());
if (view.status !== 200 || !viewed.equals(original)) failNow(`the original CV could not be viewed during the outage (${view.status} ${view.status !== 200 ? viewed.toString("utf8").slice(0, 200) : "content differs"})`);
ok("the original CV can still be viewed, from RoleMatch's own copy, with the view journaled first");

step("5. the main database comes back");
sh("docker", ["start", "supabase_db_rolematch"]);
const on = Date.now(); mode = "";
for (let i = 0; i < 120 && mode !== "normal"; i++) { await sleep(500); mode = await health(); }
if (mode !== "normal") failNow("RoleMatch did not return to normal");
ok(`RoleMatch returned to normal ${((Date.now() - on) / 1000).toFixed(1)} s after the main database came back`);
let saved = 0;
for (let i = 0; i < 20 && !saved; i++) {
  const fresh: any = await (await req(`/api/candidates/${candidateId}`)).json();
  const r = await req(`/api/candidates/${candidateId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "reviewed", version: fresh.version }) });
  if (r.ok) saved = r.status; else await sleep(1000);
}
if (!saved) failNow("saving did not work again after the main database returned");
ok("saving works again");
let replayed: any;
for (let i = 0; i < 90; i++) { replayed = await (await req(`/api/documents/${heldDoc.id}`)).json(); if (replayed.stage !== "held" && replayed.status !== "processing") break; await sleep(1000); }
if (replayed?.status !== "published") failNow(`the held CV was not processed after recovery (${replayed?.status} ${replayed?.stage})`);
ok("the held CV went through by itself after recovery and was published, under the same id its waiting card showed");
let journaled: any[] = [];
for (let i = 0; i < 30 && !journaled.length; i++) { journaled = await main`select created_at, detail from audit_events where entity_id = ${doc.id} and action = 'document.original_viewed' and detail->>'journaled' = 'true'`; if (!journaled.length) await sleep(1000); }
if (!journaled.length) failNow("the view made during the outage never reached the audit log");
const lag = Math.abs(new Date(journaled[0].created_at).getTime() - viewedAt);
if (lag > 5000) failNow(`the journaled view was recorded at the wrong time (${lag} ms off)`);
ok("the view made during the outage is in the audit log, with the time it happened");

console.log("\nRehearsal passed. Nothing was lost; the recruiter was never signed out.");
if (/db\.read_only/.test(serverLog) && /db\.read_write/.test(serverLog)) ok("the server logged both switches for the incident record");
await finish(0);
