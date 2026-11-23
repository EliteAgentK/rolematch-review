// npm run mail:trial -- start | report | welcome <approved address> | teardown
// A controlled real-mail trial, separate from everything else: its own database schema (all migrations applied there, never to "public"), its own API port (8790) and page port (5174),
// and real SMTP only for this process. server/.env keeps mail OFF; the trial passes the mailbox login to its own server process only, and refuses unless the approved-recipient list is
// set and the mode is "allowlist". Nothing here prints a password, a code, a link or an address.
import { dbTls } from "../src/dbTls";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import postgres from "postgres";

const SERVER = fileURLToPath(new URL("..", import.meta.url)), ROOT = fileURLToPath(new URL("../..", import.meta.url));
const env = parseEnv(readFileSync(process.env.ROLEMATCH_ENV_FILE ?? `${SERVER}/.env`, "utf8"));
const SCHEMA = process.env.MAIL_TRIAL_SCHEMA ?? "trial_mail", API = 8790, PAGE = 5174;
const die = (m: string): never => { console.error(m); process.exit(1); };
if (!/^trial_[a-z0-9_]+$/.test(SCHEMA)) die("The trial schema must be named trial_<something>.");

async function start() {
  const recipients = (env.MAIL_ALLOWED_RECIPIENTS ?? "").split(",").filter(Boolean);
  if (!env.MAIL_SMTP_HOST || !env.MAIL_SMTP_USER || !env.MAIL_SMTP_PASS) die("Set the login first: npm run mail:config -- credentials");
  if (!recipients.length) die("No approved recipients: npm run mail:config -- allow <address>. Nothing can be sent without the list.");
  if ((env.MAIL_SEND_MODE ?? "allowlist") !== "allowlist") die("The trial runs only in allowlist mode.");
  const serverEnv = { ...process.env, DB_SCHEMA: SCHEMA, PORT: String(API), PUBLIC_APP_URL: `http://localhost:${PAGE}`, ALLOWED_ORIGINS: `http://localhost:${PAGE},http://127.0.0.1:${PAGE}`, COOKIE_SECURE: "false", TRUST_PROXY: "false", SIGNUP_REQUIRE_CODE: "true", SIGNUP_DEV_CODE: "false",
    MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: "allowlist", MAIL_ALLOWED_RECIPIENTS: recipients.join(","), MAIL_SMTP_HOST: env.MAIL_SMTP_HOST, MAIL_SMTP_PORT: env.MAIL_SMTP_PORT ?? "465",
    MAIL_SMTP_SECURITY: env.MAIL_SMTP_SECURITY ?? "implicit", MAIL_SMTP_USER: env.MAIL_SMTP_USER, MAIL_SMTP_PASS: env.MAIL_SMTP_PASS };
  console.log(`Trial: schema ${SCHEMA}, API http://localhost:${API}, page http://localhost:${PAGE}. Real mail only to the ${recipients.length} approved address(es). Ctrl-C stops both.`);
  const api = spawn("npx", ["tsx", "src/index.ts"], { cwd: SERVER, env: serverEnv, stdio: ["ignore", "inherit", "inherit"] });
  const page = spawn("npx", ["vite", "--port", String(PAGE), "--strictPort"], { cwd: ROOT, env: { ...process.env, API_TARGET: `http://localhost:${API}` }, stdio: ["ignore", "inherit", "inherit"] });
  const stop = () => { api.kill("SIGTERM"); page.kill("SIGTERM"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  api.on("exit", (c) => { console.log(`API stopped (${c})`); page.kill("SIGTERM"); }); page.on("exit", () => api.kill("SIGTERM"));
}

/** What the trial sent, without addresses or content: class, outcome, the mail server's acceptance time, and the recipient's domain. */
async function report() {
  const sql = postgres(env.DATABASE_URL!, { ...dbTls(env.DATABASE_URL!), max: 1 });
  try {
    const rows = await sql.unsafe(`select class, template, outcome, recipient_domain, smtp_code, error_class, started_at, finished_at, round(extract(epoch from finished_at - started_at) * 1000)::int as smtp_ms
      from "${SCHEMA}".mail_attempts order by started_at`);
    if (!rows.length) console.log("No send attempts recorded in this trial yet.");
    for (const r of rows) console.log([new Date(r.started_at).toISOString(), r.class, r.template, r.outcome, r.recipient_domain, r.smtp_ms != null ? `${r.smtp_ms} ms` : "-", r.smtp_code ?? "", r.error_class ?? ""].join("  "));
  } finally { await sql.end(); }
}

/** Queues the welcome for a member who was set up before the welcome e-mail existed, exactly as onboarding queues it now (same kind, same once-per-person key), so the trial
 * server's outbox delivers it through the normal path. Only for an address on the approved list; a second run queues nothing. */
async function welcome(address: string | undefined) {
  const to = String(address ?? "").trim().toLowerCase(), approved = (env.MAIL_ALLOWED_RECIPIENTS ?? "").split(",").filter(Boolean);
  if (!approved.includes(to)) die("Give one address from the approved list.");
  const sql = postgres(env.DATABASE_URL!, { ...dbTls(env.DATABASE_URL!), max: 1 });
  try {
    const m = (await sql.unsafe(`select m.user_id, m.org_id, m.role, p.id as portal_id from "${SCHEMA}".members m join "${SCHEMA}".portals p on p.org_id = m.org_id where lower(m.email) = $1 order by p.created_at limit 1`, [to]))[0];
    if (!m) die("That address has no member in the trial.");
    const r = await sql.unsafe(`insert into "${SCHEMA}".outbox (id, org_id, portal_id, kind, class, priority, aggregate_id, version, dedupe_key, payload, expires_at)
      values (gen_random_uuid(), $1, $2, 'welcome.email', 'notification', 2, $3, 1, $4, $5::jsonb, now() + interval '1 day') on conflict (dedupe_key) do nothing returning id`,
      [m.org_id, m.portal_id, m.user_id, `welcome.email:${m.user_id}`, JSON.stringify({ variant: m.role === "admin" ? "admin" : m.role === "viewer" ? "viewer" : "member" })]);
    console.log(r.length ? "Welcome queued; the running trial server sends it within a few seconds." : "A welcome was already queued for this member; nothing new was queued.");
  } finally { await sql.end(); }
}

/** Removes the trial schema and the sign-ins made in it (only accounts that are members of this schema's organisations). */
async function teardown() {
  const sql = postgres(env.DATABASE_URL!, { ...dbTls(env.DATABASE_URL!), max: 1 });
  try {
    const users = await sql.unsafe(`select user_id from "${SCHEMA}".members`).catch(() => [] as any[]);
    await sql.unsafe(`drop schema if exists "${SCHEMA}" cascade`);
    const { adminDeleteUser } = await import("../src/supabase");
    for (const u of users) await adminDeleteUser(u.user_id);
    console.log(`Removed schema ${SCHEMA} and ${users.length} trial account(s).`);
  } finally { await sql.end(); }
}

switch (process.argv[2]) {
  case "start": await start(); break;
  case "report": await report(); break;
  case "welcome": await welcome(process.argv[3]); break;
  case "teardown": await teardown(); break;
  default: die("Usage: npm run mail:trial -- start | report | welcome <approved address> | teardown");
}
