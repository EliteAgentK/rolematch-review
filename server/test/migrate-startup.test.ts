import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";

// Restarting a server must never apply a schema change by itself on the shared project: only an isolated schema (a test's own) migrates at start,
// unless AUTO_MIGRATE=true is set deliberately. Read through the real config module, with the environment each case describes.
const autoMigrate = (env: Record<string, string>) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./src/config').then(m => console.log(m.config.autoMigrate))"], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, encoding: "utf8", cwd: process.cwd() });
  if (r.status !== 0) throw new Error(r.stderr.slice(0, 300));
  return r.stdout.trim().split("\n").pop();
};
test("the shared project is not migrated by a restart; an isolated schema is; an explicit setting wins", () => {
  expect(autoMigrate({ DATABASE_URL: "postgres://x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x" })).toBe("false");                       // public schema, no setting
  expect(autoMigrate({ DATABASE_URL: "postgres://x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x", DB_SCHEMA: "test_abc" })).toBe("true");   // a test's own schema
  expect(autoMigrate({ DATABASE_URL: "postgres://x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x", AUTO_MIGRATE: "true" })).toBe("true");
  expect(autoMigrate({ DATABASE_URL: "postgres://x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x", DB_SCHEMA: "test_abc", COOKIE_SECURE: "true", SIGNUP_DEV_CODE: "false", SIGNUP_REQUIRE_CODE: "true" })).toBe("false");   // anything served securely
});
