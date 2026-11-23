// Keeps the code and the live Supabase project in step. Used at startup, by /api/health, by `npm run schema:check` and by tests.
import { accessSync, constants, readdirSync } from "node:fs";
import { MIGRATIONS_DIR } from "./scripts/migrate";
import { config } from "./config";
import { mainSql as sql } from "./db";   // always the main database, as the platform: this checks ITS structure, also while reads come from the copy (R35)

/** The columns the code relies on. If the live database lacks any of them, the server must not run. */
const EXPECTED: Record<string, string[]> = {
  orgs: ["id", "name", "created_at"],
  members: ["user_id", "org_id", "name", "role", "created_at", "email", "can_create_portals", "left_at"],
  documents: ["id", "org_id", "kind", "original_name", "mime", "size", "sha256", "storage_path", "status", "stage", "scan_result", "error_code", "error_message", "record_id", "source_text", "dismissed_at", "original_size", "optimised", "created_by", "created_at", "updated_at"],
  candidates: ["id", "org_id", "document_id", "data", "extracted", "version", "created_at", "updated_at", "search"],
  jobs: ["id", "org_id", "document_id", "data", "extracted", "version", "created_at", "updated_at", "search"],
  matches: ["id", "org_id", "candidate_id", "job_id", "candidate_version", "job_version", "engine_version", "result", "created_by", "created_at"],
  audit_events: ["id", "org_id", "actor_id", "action", "entity_type", "entity_id", "detail", "correlation_id", "created_at"],
  org_settings: ["org_id", "version", "settings", "updated_by", "updated_at"],
  org_settings_history: ["id", "org_id", "version", "settings", "change", "changed_by", "created_at"],
  rate_limits: ["key", "window_start", "count"],
  queue: ["id", "org_id", "type", "payload", "status", "attempts", "max_attempts", "run_after", "last_error", "created_at", "locked_at"],
  error_register: ["id", "org_id", "record_kind", "record_id", "document_id", "field_path", "from_value", "to_value", "change_kind", "category", "status", "parser_version", "created_by", "created_at", "scope", "permitted_use", "component", "component_version", "evidence_ref", "label_provenance", "experiment", "regression_case", "decision", "dedupe_key"],
  outbox: ["id", "org_id", "portal_id", "kind", "aggregate_id", "version", "dedupe_key", "payload", "status", "attempts", "max_attempts", "run_after", "locked_at", "last_error", "created_at", "done_at"],
  model_reviews: ["id", "org_id", "portal_id", "kind", "subject_id", "input_hash", "status", "model", "model_digest", "prompt_version", "result", "reason", "ms", "created_at", "finished_at"],
  password_resets: ["id", "email", "code_hash", "issued_at", "superseded_at", "consumed_at"],
  portal_members: ["portal_id", "org_id", "user_id", "role", "created_at", "last_seen_at"],
  upload_history_removed: ["id", "org_id", "portal_id", "kind", "uploaded_by", "uploaded_at", "via_batch", "deleted_by", "deleted_at"],
  schema_migrations: ["name", "applied_at"],
};

export interface SchemaStatus {
  inSync: boolean;
  pendingMigrations: string[];
  missing: string[];     // "table" or "table.column"
  rlsOff: string[];      // tables without row level security
  auditProtected: boolean;
  bucket: "ok" | "missing" | "public" | "unchecked";
  auth: { signupsEnabled: boolean | null; autoConfirm: boolean | null };
  problems: string[];
}

export async function schemaStatus(): Promise<SchemaStatus> {
  const problems: string[] = [];
  const cols = (await sql`select table_name, column_name from information_schema.columns where table_schema = current_schema()`) as { table_name: string; column_name: string }[];
  const have = new Map<string, Set<string>>();
  for (const c of cols) { if (!have.has(c.table_name)) have.set(c.table_name, new Set()); have.get(c.table_name)!.add(c.column_name); }
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(EXPECTED)) {
    if (!have.has(table)) { missing.push(table); continue; }
    for (const c of columns) if (!have.get(table)!.has(c)) missing.push(`${table}.${c}`);
  }
  if (missing.length) problems.push(`The database is missing: ${missing.join(", ")}`);

  const rls = (await sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = current_schema() and c.relkind = 'r'`) as { relname: string; relrowsecurity: boolean }[];
  const rlsOff = rls.filter((r) => r.relname !== "schema_migrations" && !r.relrowsecurity).map((r) => r.relname);
  if (rlsOff.length) problems.push(`Row level security is OFF for: ${rlsOff.join(", ")}`);

  const trig = (await sql`select count(*)::int c from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = current_schema() and c.relname = 'audit_events' and t.tgname = 'audit_no_update'`)[0].c;
  if (!trig) problems.push("The audit log is not protected from edits (trigger audit_no_update is missing)");

  let applied = new Set<string>();
  if (have.has("schema_migrations")) applied = new Set((await sql`select name from schema_migrations`).map((r: any) => r.name));
  const pendingMigrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort().filter((f) => !applied.has(f));
  if (pendingMigrations.length) problems.push(`Migrations not yet applied: ${pendingMigrations.join(", ")}`);

  let bucket: SchemaStatus["bucket"] = "unchecked";
  // Originals in our own encrypted vault (STORE_DIR, C3): the vault's folder is checked, not a Supabase bucket that is no longer used.
  if (process.env.STORE_DIR) {
    try { accessSync(process.env.STORE_DIR, constants.R_OK | constants.W_OK); bucket = "ok"; }
    catch { bucket = "missing"; problems.push("The file vault's folder (STORE_DIR) cannot be read and written"); }
  } else try {
    const res = await fetch(`${config.supabaseUrl}/storage/v1/bucket/${config.bucket}`, { headers: { apikey: config.supabaseKey, authorization: `Bearer ${config.supabaseKey}` } });
    if (res.status === 404 || res.status === 400) { bucket = "missing"; problems.push(`The private storage bucket "${config.bucket}" does not exist`); }
    else if (res.ok) { bucket = ((await res.json()) as any).public ? "public" : "ok"; if (bucket === "public") problems.push(`The storage bucket "${config.bucket}" is PUBLIC: candidate CVs would be exposed`); }
  } catch { /* storage unreachable: reported as unchecked */ }

  // Settings that only the Supabase dashboard controls, checked through the public settings endpoint
  const auth: SchemaStatus["auth"] = { signupsEnabled: null, autoConfirm: null };
  try {
    const s: any = await (await fetch(`${config.authUrl}/settings`, { headers: { apikey: config.supabaseKey } })).json();
    auth.signupsEnabled = !s.disable_signup;
    auth.autoConfirm = !!s.mailer_autoconfirm;
    if (auth.autoConfirm && config.cookieSecure) problems.push("Supabase has email auto-confirm ON: anyone could sign up without verifying their email");
  } catch { /* leave unknown */ }

  return { inSync: problems.length === 0, pendingMigrations, missing, rlsOff, auditProtected: !!trig, bucket, auth, problems };
}
