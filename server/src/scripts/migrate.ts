// Applies supabase/migrations/*.sql in order and records what has run. Safe to run repeatedly.
// Usage: npm run migrate        (uses DB_SCHEMA if set, e.g. for tests)
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../config";
import { sql } from "../db";
import { guardTarget } from "./target";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const dir = MIGRATIONS_DIR;
export async function migrate(log = true) {
  if (config.dbSchema !== "public") await sql.unsafe(`create schema if not exists "${config.dbSchema}"`);
  await sql.unsafe(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await sql`select name from schema_migrations`).map((r: any) => r.name));
  // The first migration was run by hand in the Supabase SQL editor before this tracker existed.
  if (!applied.size && (await sql`select to_regclass('orgs') as t`)[0].t) { await sql`insert into schema_migrations (name) values ('001_init.sql')`; applied.add("001_init.sql"); }
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await sql.begin(async (q) => { await q.unsafe(readFileSync(dir + file, "utf8")); await q`insert into schema_migrations (name) values (${file})`; });
    if (log) console.log("applied", file);
  }
  if (log) console.log("database is up to date");
}
// Run by hand, it says which database it is about to change and refuses live or one elsewhere unless told on purpose (target.ts; code review, 16 Nov 2026, D-M5).
if (import.meta.main) { guardTarget("migrate"); await migrate(); await sql.end(); }
