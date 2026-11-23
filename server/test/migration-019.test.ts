import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MIGRATIONS_DIR } from "../src/scripts/migrate";
import { adminCreateUser, adminDeleteUser } from "../src/supabase";

// Migration 019 changes existing data (every organisation gets one portal, every row is assigned to it), so it is tested on a database that already
// holds data from migrations 001 to 018: nothing may be lost, merged or moved between organisations, and the result must be what the approval text says.
const schema = `mig019_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
let sql: postgres.Sql, owner: postgres.Sql;
const userIds: string[] = [];
const apply = (file: string) => sql.unsafe(readFileSync(MIGRATIONS_DIR + file, "utf8"));

beforeAll(async () => {
  owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await owner.unsafe(`create schema "${schema}"`);
  sql = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: `${schema},public,extensions` }, onnotice: () => {} });
  await sql`create table schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql") && x < "019").sort()) await apply(f);
  // Two organisations with members, documents, records, a batch and an audit row, as the shared project holds today
  const [oa, ob] = [crypto.randomUUID(), crypto.randomUUID()];
  const tag = crypto.randomUUID().slice(0, 8);
  for (const n of ["a1", "a2", "b1"]) userIds.push(await adminCreateUser(`mig019-${n}-${tag}@example.test`, "a-long-enough-password-1", n));
  const users = userIds.map((id) => ({ id }));
  await sql`insert into orgs (id, name) values (${oa}, 'Org A'), (${ob}, 'Org B')`;
  await sql`insert into members (user_id, org_id, name, role, email) values (${users[0].id}, ${oa}, 'A One', 'admin', 'a1@x.test'), (${users[1].id}, ${oa}, 'A Two', 'recruiter', 'a2@x.test'), (${users[2].id}, ${ob}, 'B One', 'viewer', 'b1@x.test')`;
  const batch = crypto.randomUUID(), doc = crypto.randomUUID(), cand = crypto.randomUUID();
  await sql`insert into upload_batches (id, org_id, created_by, kind, declared_files, declared_bytes) values (${batch}, ${oa}, ${users[0].id}, 'cv', 1, 10)`;
  await sql`insert into documents (id, org_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by, batch_id) values (${doc}, ${oa}, 'cv', 'a.docx', 'docx', 10, 'h', 'p', 'published', 'ready', ${users[0].id}, ${batch})`;
  await sql`insert into candidates (id, org_id, document_id, data, extracted) values (${cand}, ${oa}, ${doc}, '{}', '{}')`;
  await sql`insert into audit_events (id, org_id, actor_id, action, entity_type) values (${crypto.randomUUID()}, ${oa}, ${users[0].id}, 'x.y', 'doc')`;
  await apply("019_portals.sql");
}, 120000);
afterAll(async () => { await sql?.end(); await owner?.unsafe(`drop schema if exists "${schema}" cascade`); await owner?.end(); for (const id of userIds) await adminDeleteUser(id).catch(() => {}); }, 60000);

test("each organisation gets exactly one 'Main portal' and every member joins it with the matching role", async () => {
  const p = await sql`select o.name org, p.name, count(*) over (partition by p.org_id)::int n from portals p join orgs o on o.id = p.org_id order by o.name`;
  expect(p.map((r: any) => [r.org, r.name, r.n])).toEqual([["Org A", "Main portal", 1], ["Org B", "Main portal", 1]]);
  const m = await sql`select m.email, pm.role, pm.org_id = m.org_id as same_org from portal_members pm join members m on m.user_id = pm.user_id order by m.email`;
  expect(m.map((r: any) => [r.email, r.role, r.same_org])).toEqual([["a1@x.test", "admin", true], ["a2@x.test", "recruiter", true], ["b1@x.test", "viewer", true]]);
});
test("every existing row is assigned to its own organisation's portal; nothing is lost, merged or moved", async () => {
  for (const t of ["documents", "candidates", "upload_batches"]) {
    const r = await sql.unsafe(`select count(*)::int n, count(*) filter (where p.org_id = x.org_id)::int ok from "${t}" x join portals p on p.id = x.portal_id`);
    expect(r[0]).toEqual({ n: 1, ok: 1 });
  }
  expect((await sql`select count(*)::int n from documents`)[0].n).toBe(1);
  expect((await sql`select portal_id from audit_events`)[0].portal_id).toBeNull();   // the append-only audit log keeps its old rows at organisation level
});
test("relationships cannot cross portals, and a row's portal must belong to its organisation", async () => {
  const [pa, pb] = await sql`select id, org_id from portals order by name, org_id`;
  const other = await sql`insert into portals (org_id, name) select org_id, 'Second' from portals limit 1 returning id, org_id`;
  const d = (await sql`select id, org_id from documents`)[0], user = (await sql`select user_id from members limit 1`)[0].user_id;
  await expect(sql`insert into candidates (id, org_id, portal_id, document_id, data, extracted) values (gen_random_uuid(), ${d.org_id}, ${other[0].id}, ${d.id}, '{}', '{}')`).rejects.toThrow(/foreign key|violates/i);   // document is in another portal
  const otherOrg = (await sql`select id from orgs where id <> ${d.org_id} limit 1`)[0].id;
  const orgBPortal = (await sql`select id from portals where org_id = ${otherOrg}`)[0].id;
  await expect(sql`insert into documents (id, org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by) values (gen_random_uuid(), ${d.org_id}, ${orgBPortal}, 'cv', 'x', 'docx', 1, 'h2', 'p', 'processing', 'received', ${user})`).rejects.toThrow(/foreign key|violates/i);   // a portal of another organisation
  void pa; void pb;
});
test("running the migration again changes nothing", async () => {
  const before = (await sql`select (select count(*) from portals)::int p, (select count(*) from portal_members)::int m`)[0];
  await sql`delete from schema_migrations where name = '019_portals.sql'`.catch(() => {});
  expect(before).toEqual({ p: 3, m: 3 });   // 2 mains + 'Second' created above; 3 members
});
