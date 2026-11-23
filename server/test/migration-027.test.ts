import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MIGRATIONS_DIR } from "../src/scripts/migrate";
import { adminCreateUser, adminDeleteUser } from "../src/supabase";

// Migration 027 changes existing data: a person, a portal member and an invitation holding the old role all become hiring managers, nobody else changes and no account gains access.
const schema = `mig027_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
let sql: postgres.Sql, owner: postgres.Sql, ids: string[] = [];
const apply = (file: string) => sql.unsafe(readFileSync(MIGRATIONS_DIR + file, "utf8"));

beforeAll(async () => {
  owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await owner.unsafe(`create schema "${schema}"`);
  sql = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: `${schema},public,extensions` }, onnotice: () => {} });
  await sql`create table schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql") && x < "027").sort()) await apply(f);
  const org = crypto.randomUUID(), portal = crypto.randomUUID(), tag = crypto.randomUUID().slice(0, 8);
  for (const n of ["a", "r", "v"]) ids.push(await adminCreateUser(`mig027-${n}-${tag}@example.test`, "a-long-enough-password-1", n));
  await sql`insert into orgs (id, name) values (${org}, 'Org')`;
  await sql`insert into portals (id, org_id, name) values (${portal}, ${org}, 'Main')`;
  const roles = ["admin", "recruiter", "viewer"];
  for (const [i, id] of ids.entries()) {
    await sql`insert into members (user_id, org_id, name, role, email) values (${id}, ${org}, ${roles[i]}, ${roles[i]}, ${roles[i] + "@x.test"})`;
    await sql`insert into portal_members (portal_id, org_id, user_id, role) values (${portal}, ${org}, ${id}, ${roles[i]})`;
  }
  await sql`insert into portal_invitations (id, org_id, portal_id, email, role, token_hash, invited_by, invited_by_email, expires_at) values (${crypto.randomUUID()}, ${org}, ${portal}, 'waiting@x.test', 'viewer', 'hash', ${ids[0]}, 'admin@x.test', now() + interval '1 day')`;
  await apply("027_hiring_manager_and_presence.sql");
}, 300000);
afterAll(async () => { await sql?.end(); await owner?.unsafe(`drop schema "${schema}" cascade`); await owner?.end(); for (const id of ids) await adminDeleteUser(id).catch(() => {}); }, 60000);

test("the old role becomes hiring manager everywhere, and nobody else changes", async () => {
  expect((await sql`select email, role from members order by name`).map((r: any) => [r.email, r.role])).toEqual([["admin@x.test", "admin"], ["recruiter@x.test", "recruiter"], ["viewer@x.test", "hiring_manager"]]);
  expect((await sql`select role from portal_members order by role`).map((r: any) => r.role)).toEqual(["admin", "hiring_manager", "recruiter"]);
  expect((await sql`select role from portal_invitations`).map((r: any) => r.role)).toEqual(["hiring_manager"]);
}, 30000);

test("the database refuses the old role from now on", async () => {
  await expect(sql`update members set role = 'viewer' where role = 'recruiter'`).rejects.toThrow(/check/);
  await expect(sql`update portal_members set role = 'viewer' where role = 'recruiter'`).rejects.toThrow(/check/);
  await expect(sql`update portal_invitations set role = 'viewer'`).rejects.toThrow(/check/);
}, 30000);

test("nobody has a last-seen time until they are actually seen", async () => {
  expect((await sql`select count(*)::int n from portal_members where last_seen_at is not null`)[0].n).toBe(0);
}, 30000);
