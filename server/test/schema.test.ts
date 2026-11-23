import { afterAll, beforeAll, expect, test } from "vitest";
import postgres from "postgres";
import { setupTestDb, type TestDb, spawnProc } from "./helpers";

let tdb: TestDb;
beforeAll(async () => { tdb = await setupTestDb(); }, 120000);
afterAll(async () => { await tdb?.teardown(); }, 60000);

async function check(env: Record<string, string>) {
  const p = spawnProc(["tsx", "src/scripts/schemaCheck.ts"], { env, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  return { code, status: JSON.parse(out.slice(out.indexOf("{"))) };
}

test("the live Supabase project is in step with the code", async () => {
  const r = await check({ ...process.env, DB_SCHEMA: "public" } as Record<string, string>);
  expect(r.status.problems, r.status.problems.join("\n")).toEqual([]);
  expect(r.code).toBe(0);
  expect(r.status.bucket).toBe("ok"); // private
  expect(r.status.auth.autoConfirm).toBe(false); // sign-ups must be verified by e-mail
});

test("a database built from the migration files alone matches what the code expects", async () => {
  const r = await check(tdb.env);
  expect(r.status.problems, r.status.problems.join("\n")).toEqual([]);
  expect(r.status.rlsOff).toEqual([]);
  expect(r.status.auditProtected).toBe(true);
});

test("drift is detected: a missing column, disabled row security, or an unapplied migration is reported", async () => {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await admin.unsafe(`alter table "${tdb.schema}".jobs drop column version`);
    await admin.unsafe(`alter table "${tdb.schema}".matches disable row level security`);
    await admin.unsafe(`delete from "${tdb.schema}".schema_migrations where name = '002_server_support.sql'`);
  } finally { await admin.end(); }
  const r = await check(tdb.env);
  expect(r.code).toBe(1);
  expect(r.status.inSync).toBe(false);
  expect(r.status.missing).toContain("jobs.version");
  expect(r.status.rlsOff).toContain("matches");
  expect(r.status.pendingMigrations).toContain("002_server_support.sql");
});
