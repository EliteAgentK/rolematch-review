// The owner's actions in the console (migration 050, src/console/actions.ts; owner, 12 Nov 2026: "full autonomy ... if I want to delete users, I should be
// able to"). Against a real database: two companies, each with a portal holding a CV, a job, a match, a shortlist, AI use and a support request. Deleting
// one must take every row of it and none of the other's; AI use stays for the bill; support access shows a portal's log only while open, and says so in
// that portal's own log.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, db: postgres.Sql, S: string;
const RUN = Date.now().toString(36), A = `actions-a-${RUN}@example.test`, B = `actions-b-${RUN}@example.test`;   // each run its own accounts: a deleted company's sign-in accounts are removed by the console, not here
let pa: any, pb: any;

const asConsole = async (sql: string, args: any[] = []) => (await db.begin(async (q) => { await q.unsafe("set local role rolematch_console"); return q.unsafe(sql, args); }));
async function fill(p: any, tag: string) {
  const doc = (kind: string) => db.unsafe(`insert into "${S}".documents (org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage) values ($1, $2, $3, $4, 'application/pdf', 10, $5, $6, 'published', 'published') returning id`,
    [p.org_id, p.id, kind, `${tag}-${kind}.pdf`, `${tag}${kind}`.padEnd(64, "0"), `${p.org_id}/${tag}-${kind}.pdf`]).then((r: any) => r[0].id);
  const [dc, dj] = [await doc("cv"), await doc("jd")];
  const [c] = await db.unsafe(`insert into "${S}".candidates (org_id, portal_id, document_id, data, extracted) values ($1, $2, $3, '{"name":"x"}', '{}') returning id`, [p.org_id, p.id, dc]);
  const [j] = await db.unsafe(`insert into "${S}".jobs (org_id, portal_id, document_id, data, extracted) values ($1, $2, $3, '{"title":"y"}', '{}') returning id`, [p.org_id, p.id, dj]);
  await db.unsafe(`insert into "${S}".matches (org_id, portal_id, candidate_id, job_id, candidate_version, job_version, engine_version, result) values ($1, $2, $3, $4, 1, 1, 'e', '{}')`, [p.org_id, p.id, c.id, j.id]);
  await db.unsafe(`insert into "${S}".applications (org_id, portal_id, candidate_id, job_id, status) values ($1, $2, $3, $4, 'shortlisted')`, [p.org_id, p.id, c.id, j.id]);
  await db.unsafe(`insert into "${S}".audit_events (org_id, portal_id, action, entity_type, entity_id, detail) values ($1, $2, 'candidate.created', 'candidate', $3, '{"text":"never shown"}')`, [p.org_id, p.id, c.id]);
  await db.unsafe(`insert into "${S}".ai_usage (org_id, portal_id, purpose, provider, model, cost_micro_usd, outcome) values ($1, $2, 'matching', 'anthropic', 'm', 1500000, 'answered')`, [p.org_id, p.id]);
}
const countFor = async (portal: string) => Number((await db.unsafe(`select (select count(*) from "${S}".documents where portal_id = $1) + (select count(*) from "${S}".candidates where portal_id = $1) + (select count(*) from "${S}".jobs where portal_id = $1)
  + (select count(*) from "${S}".matches where portal_id = $1) + (select count(*) from "${S}".applications where portal_id = $1) + (select count(*) from "${S}".portal_members where portal_id = $1) as n`, [portal]))[0].n);

beforeAll(async () => {
  tdb = await setupTestDb(); S = tdb.schema;
  await tdb.createUser("Actions Company A", A, "Admin A", "a long test password one");
  await tdb.createUser("Actions Company B", B, "Admin B", "a long test password two");
  db = postgres(process.env.DATABASE_URL!, { max: 2, connection: { search_path: `${S},public,extensions` }, onnotice: () => {} });
  const portal = async (email: string) => (await db.unsafe(`select p.id, p.org_id from "${S}".portals p join "${S}".portal_members pm on pm.portal_id = p.id join auth.users u on u.id = pm.user_id where u.email = $1`, [email]))[0];
  [pa, pb] = [await portal(A), await portal(B)];
  await fill(pa, "a"); await fill(pb, "b");
}, 120_000);
afterAll(async () => { await db?.end(); await tdb?.teardown(); });

test("support access: the log is refused until opened with a reason, then shows the portal's documents and actions (never a CV's text), and the company sees it was opened", async () => {
  await expect(asConsole(`select "${S}".console_support_log($1)`, [pa.id])).rejects.toThrow(/not open/);
  await asConsole(`select "${S}".console_open_support($1, $2)`, [pa.id, "they asked where a CV went"]);
  const [{ l }] = await asConsole(`select "${S}".console_support_log($1) as l`, [pa.id]);
  expect(l.documents.map((d: any) => d.name).sort()).toEqual(["a-cv.pdf", "a-jd.pdf"]);
  expect(JSON.stringify(l.events)).not.toContain("never shown");
  expect(l.events.some((e: any) => e.action === "support.access_opened" && e.detail.reason === "they asked where a CV went")).toBe(true);
  // The other company's portal stays closed.
  await expect(asConsole(`select "${S}".console_support_log($1)`, [pb.id])).rejects.toThrow(/not open/);
});

test("deleting a portal takes every row of it and none of the other company's; its AI use stays for the bill; its files wait for the monitor; the deletion is recorded", async () => {
  expect(await countFor(pa.id)).toBeGreaterThan(0);
  // A CV a recruiter deleted a moment ago: its file waits for the queue's removal job, which goes with the portal's queue (review 16 Nov 2026, D-M4).
  await db.unsafe(`insert into "${S}".queue (org_id, portal_id, type, payload, status) values ($1, $2, 'delete-object', $3, 'queued')`, [pa.org_id, pa.id, { path: `${pa.org_id}/deleted-a-moment-ago.pdf` } as any]);
  const before = await countFor(pb.id);
  // Which of the console's two accounts acted is stamped on the record (migration 052), from the same transaction.
  const [{ r }] = await db.begin(async (q) => { await q.unsafe("set local role rolematch_console"); await q.unsafe(`select set_config('rolematch.console_by', 'dad@example.test', true)`);
    return q.unsafe(`select "${S}".console_delete_portal($1, 'a test company') as r`, [pa.id]); }) as any;
  expect(await countFor(pa.id)).toBe(0);
  expect(await countFor(pb.id)).toBe(before);
  expect((await db.unsafe(`select count(*)::int as n from "${S}".portals where id = $1`, [pa.id]))[0].n).toBe(0);
  expect((await db.unsafe(`select count(*)::int as n, sum(cost_micro_usd)::int as m from "${S}".ai_usage where org_id = $1`, [pa.org_id]))[0]).toEqual({ n: 1, m: 1500000 });
  expect(r.files.sort()).toEqual([`${pa.org_id}/a-cv.pdf`, `${pa.org_id}/a-jd.pdf`]);
  expect((await db.unsafe(`select path from "${S}".file_removals order by path`)).map((r: any) => r.path)).toEqual([`${pa.org_id}/a-cv.pdf`, `${pa.org_id}/a-jd.pdf`, `${pa.org_id}/deleted-a-moment-ago.pdf`].sort());
  const [act] = await asConsole(`select action, target_name, detail, by_email from "${S}".console_actions where target_id = $1 and action = 'portal.deleted'`, [pa.id]);
  expect(act.by_email).toBe("dad@example.test");
  expect(act.action).toBe("portal.deleted"); expect(act.detail.why).toBe("a test company"); expect(act.detail.aiKeptForTheBill.aiMicroUsdAll).toBe(1500000);
});

test("deleting a company removes its portals, people and settings, returns its accounts for sign-in to remove, and leaves the other company untouched", async () => {
  const before = await countFor(pb.id);
  const [{ r }] = await asConsole(`select "${S}".console_delete_company($1, 'closing a test') as r`, [pa.org_id]);
  expect(r.people).toHaveLength(1);
  expect((await db.unsafe(`select count(*)::int as n from "${S}".orgs where id = $1`, [pa.org_id]))[0].n).toBe(0);
  expect((await db.unsafe(`select count(*)::int as n from "${S}".members where org_id = $1`, [pa.org_id]))[0].n).toBe(0);
  expect(await countFor(pb.id)).toBe(before);
  expect((await db.unsafe(`select count(*)::int as n from "${S}".orgs where id = $1`, [pb.org_id]))[0].n).toBe(1);
});

test("a company's allowance is set from the console with the change recorded, and nothing else may change it", async () => {
  await asConsole(`select "${S}".console_set_allowance($1, 12.5)`, [pb.org_id]);
  expect(Number((await db.unsafe(`select ai_monthly_cap_usd from "${S}".orgs where id = $1`, [pb.org_id]))[0].ai_monthly_cap_usd)).toBe(12.5);
  expect((await db.unsafe(`select detail from "${S}".audit_events where org_id = $1 and action = 'ai_allowance.set'`, [pb.org_id]))[0].detail).toMatchObject({ before: null, after: 12.5 });
  await expect(asConsole(`select "${S}".console_set_allowance($1, -1)`, [pb.org_id])).rejects.toThrow(/out of range/);
  await expect(asConsole(`update "${S}".orgs set ai_monthly_cap_usd = 999 where id = $1`, [pb.org_id])).rejects.toThrow(/permission denied/);
});

test("the console's role may record and read its actions, but never change or remove one", async () => {
  await expect(asConsole(`update "${S}".console_actions set target_name = 'changed'`)).rejects.toThrow(/permission denied/);
  await expect(asConsole(`delete from "${S}".console_actions`)).rejects.toThrow(/permission denied/);
});
