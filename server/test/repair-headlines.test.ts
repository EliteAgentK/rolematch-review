// The one-off repair of people's headline stages (supabase/migrations/053_repair_headline_stages.sql; production review, 12 Nov 2026). Against a real
// database: someone left "shortlisted" by a deleted job goes back to New; someone whose headline lags their job catches up; someone whose stage was set
// before statuses were per job, and never placed on a job, is left exactly as they are; each change is audited by RoleMatch; a second run changes nothing.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, type TestDb } from "./helpers";

const REPAIR = readFileSync(new URL("../../supabase/migrations/053_repair_headline_stages.sql", import.meta.url), "utf8");
let tdb: TestDb, db: postgres.Sql, S: string, p: any;
const EMAIL = `repair-${Date.now().toString(36)}@example.test`;

async function person(tag: string, headline: string) {
  const [d] = await db.unsafe(`insert into "${S}".documents (org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage) values ($1, $2, 'cv', $3, 'application/pdf', 10, $4, $5, 'published', 'ready') returning id`,
    [p.org_id, p.id, `${tag}.pdf`, tag.padEnd(64, "0"), `${p.org_id}/${tag}.pdf`]);
  const [c] = await db.unsafe(`insert into "${S}".candidates (org_id, portal_id, document_id, data, extracted) values ($1, $2, $3, $4, '{}') returning id`, [p.org_id, p.id, d.id, { name: tag, status: headline } as any]);
  return c.id as string;
}
async function job(tag: string) {
  const [d] = await db.unsafe(`insert into "${S}".documents (org_id, portal_id, kind, original_name, mime, size, sha256, storage_path, status, stage) values ($1, $2, 'jd', $3, 'application/pdf', 10, $4, $5, 'published', 'ready') returning id`,
    [p.org_id, p.id, `${tag}.pdf`, `j${tag}`.padEnd(64, "0"), `${p.org_id}/${tag}.pdf`]);
  const [j] = await db.unsafe(`insert into "${S}".jobs (org_id, portal_id, document_id, data, extracted) values ($1, $2, $3, $4, '{}') returning id`, [p.org_id, p.id, d.id, { title: tag } as any]);
  return j.id as string;
}
const headline = async (id: string) => (await db.unsafe(`select data->>'status' as s from "${S}".candidates where id = $1`, [id]))[0].s;
const repairs = async () => db.unsafe(`select entity_id, detail from "${S}".audit_events where action = 'candidate.stage_repaired' and actor_id is null order by created_at`);

beforeAll(async () => {
  tdb = await setupTestDb(); S = tdb.schema;
  await tdb.createUser("Repair Company", EMAIL, "Admin", "a long test password for the repair");
  db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: `${S},public,extensions` }, onnotice: () => {} });
  [p] = await db.unsafe(`select p.id, p.org_id from "${S}".portals p join "${S}".portal_members pm on pm.portal_id = p.id join auth.users u on u.id = pm.user_id where u.email = $1`, [EMAIL]);
}, 120_000);
afterAll(async () => { await db?.end(); await tdb?.teardown(); });

test("the repair fixes exactly the people it should, audits each change, keeps unplaced old stages, and changes nothing on a second run", async () => {
  const orphan = await person("orphan", "shortlisted");          // shortlisted only for a job that was deleted: no rows left
  await db.unsafe(`insert into "${S}".audit_events (id, org_id, action, entity_type, entity_id, detail) values (gen_random_uuid(), $1, 'application.status_changed', 'candidate', $2, '{"to":"shortlisted"}')`, [p.org_id, orphan]);
  const lagging = await person("lagging", "shortlisted");        // interviewed for a job, headline still says shortlisted
  await db.unsafe(`insert into "${S}".applications (org_id, portal_id, candidate_id, job_id, status) values ($1, $2, $3, $4, 'interviewed')`, [p.org_id, p.id, lagging, await job("Accountant")]);
  const legacy = await person("legacy", "interviewed");          // set before 9 Nov 2026, never placed on a job: the owner decides (P5)
  const right = await person("right", "shortlisted");            // already in step: untouched
  await db.unsafe(`insert into "${S}".applications (org_id, portal_id, candidate_id, job_id, status) values ($1, $2, $3, $4, 'shortlisted')`, [p.org_id, p.id, right, await job("Bookkeeper")]);

  await db.unsafe(REPAIR);
  expect([await headline(orphan), await headline(lagging), await headline(legacy), await headline(right)]).toEqual(["new", "interviewed", "interviewed", "shortlisted"]);
  const lines = await repairs();
  expect(lines.map((l: any) => [l.entity_id, l.detail.from, l.detail.to]).sort()).toEqual([[orphan, "shortlisted", "new"], [lagging, "shortlisted", "interviewed"]].sort());

  await db.unsafe(REPAIR);   // a second run: nothing more to do
  expect(await repairs()).toHaveLength(2);
}, 120_000);
