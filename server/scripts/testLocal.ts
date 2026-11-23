// npm run test:local [-- vitest arguments] : runs the tests against the local Supabase stack on this machine instead of the hosted dev project, so
// they are fast and do not depend on a provider being up (docs/architecture/RESILIENCE.md, step 2). Needs Colima and `supabase start` (server/README.md).
// The addresses come from `supabase status`; anything that is not on this machine is refused, so this can never point the tests at a real project.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
let status: Record<string, string>;
try {
  status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch {
  console.error("The local Supabase stack is not running. Start it with:\n  colima start\n  supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor");
  process.exit(1);
}
const api = status.API_URL, db = status.DB_URL, service = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
const local = (u?: string) => !!u && /^(?:https?|postgres(?:ql)?):\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(u);
if (!local(api) || !local(db) || !service) { console.error("Refusing: the stack's addresses are not all on this machine."); process.exit(1); }

const env = { ...process.env, SUPABASE_URL: api, DATABASE_URL: db, SUPABASE_SERVICE_ROLE_KEY: service, ANTHROPIC_API_KEY: "" };
// The local database is migrated by RoleMatch's own runner, exactly as production is (`npm run migrate`), never by the Supabase tool.
const migrated = spawnSync("node", ["--import", "tsx", "src/scripts/migrate.ts"], { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: "inherit" });
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
// Every run signs up from this machine, so the local database's rate-limit counts would carry over between runs until sign-ups are refused.
// Tests start from a clean slate (this is the local database only; the address check above guarantees it).
spawnSync("docker", ["exec", "supabase_db_rolematch", "psql", "-U", "postgres", "-q", "-c", "delete from public.rate_limits", "postgres"], { stdio: "ignore" });
// Every run keeps its failures' full text: a failure that happens once under load cannot be understood afterwards from a list of test names (R83). The folder is git-ignored.
const runs = fileURLToPath(new URL("../data/test-runs/", import.meta.url)); mkdirSync(runs, { recursive: true });
const report = `${runs}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const r = spawnSync("npx", ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, ...process.argv.slice(2)], { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: "inherit" });
process.exit(r.status ?? 1);
