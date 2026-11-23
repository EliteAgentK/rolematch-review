// A test run refuses any database or storage that is not on this machine (test/globalSetup.ts). server/.env points at live since 10 Nov 2026, and a plain
// `npm test` used to take it. Invented addresses; no settings file is read except the one each case writes.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { onThisMachine, testTargets } from "./globalSetup";

test("only this machine's database and storage count as safe for tests", () => {
  for (const u of ["postgresql://127.0.0.1:54322/postgres", "postgres://localhost:5432/x", "http://127.0.0.1:54321", "http://[::1]:54321"]) expect(onThisMachine(u), u).toBe(true);
  for (const u of ["postgresql://aws-0-eu-west-1.pooler.supabase.com:5432/postgres", "https://abc.supabase.co", "postgres://127.0.0.1.evil.example:5432/x",
    "postgres://user@localhost.example/x", "", "postgres://x"]) expect(onThisMachine(u), u).toBe(false);
});

test("the settings file is read the way the server reads it: the environment wins, the file fills the rest", () => {
  // Addresses without any login in them, held in constants (the secret scan stops a database address written beside its setting's name).
  const remote = "postgresql://aws-0-eu-west-1.pooler.supabase.com:5432/postgres", remoteStore = "https://abc.supabase.co";
  const local = "postgres://127.0.0.1:54322/postgres", localStore = "http://127.0.0.1:54321";
  const file = join(mkdtempSync(join(tmpdir(), "rm-targets-")), ".env");
  writeFileSync(file, `DATABASE_URL=${remote}\nSUPABASE_URL=${remoteStore}\n`);
  expect(testTargets({}, file)).toEqual({ database: remote, supabase: remoteStore });   // refused
  expect(testTargets({ DATABASE_URL: local, SUPABASE_URL: localStore }, file)).toEqual({ database: local, supabase: localStore });
  expect(testTargets({}, join(tmpdir(), "no-such-settings-file"))).toEqual({ database: "", supabase: "" });   // nothing set: refused, never assumed
});
