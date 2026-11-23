// The one-off repair of stored years of experience (src/scripts/repairExperience.ts; code review, 16 Nov 2026, C-H1): candidates read before reader
// 2.16.0 hold a figure a month short per role. The repair recounts it from the record's own work history at the day the CV was uploaded, shows what it
// would change before it writes anything, writes each change with a new version and an audit line by RoleMatch, and changes nothing on a second run.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, db: postgres.Sql, repair: typeof import("../src/scripts/repairExperience");
const ORG = crypto.randomUUID(), PORTAL = crypto.randomUUID(), SHORT = crypto.randomUUID(), RIGHT = crypto.randomUUID(), CURRENT = crypto.randomUUID();
const role = (startDate: string, endDate: string) => ({ company: "Fictional Co", position: "Analyst", startDate, endDate, responsibilities: [] });
beforeAll(async () => {
  tdb = await setupTestDb();
  Object.assign(process.env, { DB_SCHEMA: tdb.schema });
  vi.resetModules();
  repair = await import("../src/scripts/repairExperience");
  db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: tdb.schema }, onnotice: () => {} });
  await db`insert into orgs (id, name) values (${ORG}, 'Repair test org')`;
  await db`insert into portals (id, org_id, name) values (${PORTAL}, ${ORG}, 'Repair test portal')`;
  const person = async (id: string, uploaded: string, experience: string, work: object[]) => {
    const doc = crypto.randomUUID();
    await db`insert into documents (id, org_id, portal_id, kind, original_name, mime, size, storage_path, status, stage, sha256, created_at)
      values (${doc}, ${ORG}, ${PORTAL}, 'cv', 'cv.docx', 'application/octet-stream', 1, ${`${ORG}/${doc}`}, 'published', 'ready', ${doc}, ${uploaded})`;
    await db`insert into candidates (id, org_id, portal_id, document_id, data, extracted) values (${id}, ${ORG}, ${PORTAL}, ${doc}, ${db.json({ name: "Fictional Person", experience, workHistory: work } as any)}, ${db.json({})})`;
  };
  await person(SHORT, "2025-03-01", "4", [role("2020-01", "2024-12")]);           // five full years, stored a month short as 4
  await person(RIGHT, "2025-03-01", "3", [role("2021-01", "2023-12")]);           // three full years, already right
  await person(CURRENT, "2023-01-15", "2", [role("2020-01", "Present")]);         // "Present" means the month it was uploaded: 3 years 1 month
}, 120_000);
afterAll(async () => { await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }); await tdb?.teardown(); });

const experienceOf = async (id: string) => (await db`select data->>'experience' as e, version from candidates where id = ${id}`)[0];

test("first it only shows what would change, and writes nothing", async () => {
  const shown = await repair.repairExperience({ apply: false });
  expect(shown).toMatchObject({ candidates: 3, changed: 2, applied: false, shifts: { "4 -> 5": 1, "2 -> 3": 1 } });
  expect((await experienceOf(SHORT)).e).toBe("4");
});

test("then it writes each change with a new version and an audit line by RoleMatch, and a second run changes nothing", async () => {
  expect(await repair.repairExperience({ apply: true })).toMatchObject({ changed: 2, applied: true });
  expect(await experienceOf(SHORT)).toEqual({ e: "5", version: 2 });
  expect(await experienceOf(CURRENT)).toEqual({ e: "3", version: 2 });
  expect(await experienceOf(RIGHT)).toEqual({ e: "3", version: 1 });   // untouched
  const lines = await db`select entity_id, actor_id, detail from audit_events where action = 'candidate.experience_recounted' order by entity_id`;
  expect(lines).toHaveLength(2);
  expect(lines.every((l) => l.actor_id === null)).toBe(true);
  expect(lines.find((l) => l.entity_id === SHORT)!.detail).toMatchObject({ from: "4", to: "5" });
  expect(await repair.repairExperience({ apply: true })).toMatchObject({ changed: 0 });
});
