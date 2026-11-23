import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { setupTestDb, type TestDb } from "./helpers";

// The bible's schema chapter is written from a database the migrations built; this fails when the two disagree (docs/database/17, §3.1).
// To accept a schema change: UPDATE_SCHEMA_BIBLE=1 npx vitest run test/schema-bible.test.ts, then review and commit the file.
const FILE = fileURLToPath(new URL("../../docs/database/03_SCHEMA.generated.md", import.meta.url));
let tdb: TestDb, bible: typeof import("../src/scripts/schemaBible");
beforeAll(async () => { tdb = await setupTestDb({}); Object.assign(process.env, { DB_SCHEMA: tdb.schema }); bible = await import("../src/scripts/schemaBible"); }, 180000);
afterAll(async () => { await bible?.end(); await tdb?.teardown(); });

test("the schema chapter matches what the migrations build, and every table has its purpose, personal information and retention written down", async () => {
  const now = await bible.chapter();
  if (process.env.UPDATE_SCHEMA_BIBLE === "1") writeFileSync(FILE, now);
  expect(now).toBe(readFileSync(FILE, "utf8"));
}, 120000);
