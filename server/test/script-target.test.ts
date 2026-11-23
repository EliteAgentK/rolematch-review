// The maintenance scripts say which database they are about to change, and refuse live, or a database not on this machine, unless told on purpose
// (code review, 16 Nov 2026, D-M5: they wrote to whatever server/.env named, and that file points at a hosted database). The refused runs below never
// reach a database: the addresses do not exist, and the refusal must come first.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { targetOf } from "../src/scripts/target";

const SERVER = fileURLToPath(new URL("..", import.meta.url));
/** A made-up address, put together here so no connection string with a password is written out in the code. */
const address = (user: string, password: string, hostAndDb: string) => { const u = new URL(`postgresql://${hostAndDb}`); u.username = user; u.password = password; return u.toString(); };
const MADE_UP = ["a", "made", "up", "word"].join("-"), REMOTE = address("someone", MADE_UP, "db.example.invalid:5432/postgres");
function run(script: string, args: string[], env: Record<string, string>) {
  const r = spawnSync("node", ["--import", "tsx", `src/scripts/${script}`, ...args], { cwd: SERVER, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, ROLEMATCH_ENV_FILE: "/nonexistent", ROLEMATCH_ENVIRONMENT: "", ROLEMATCH_TARGET_CONFIRMED: "", DB_SCHEMA: "", LOCAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), ...env } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test("what an address and an environment say: this machine is safe unless it says live; anywhere else needs saying so", () => {
  expect(targetOf("postgresql://postgres:pw@127.0.0.1:54322/postgres").refuse).toBe(false);
  expect(targetOf("postgresql://postgres:pw@localhost:5432/postgres", "rehearsal").refuse).toBe(false);
  expect(targetOf("postgresql://app:pw@127.0.0.1:5433/rolematch", "live").refuse).toBe(true);
  expect(targetOf("postgresql://app:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres").refuse).toBe(true);
  expect(targetOf("postgresql://app:pw@db.example.test:5432/x", "rehearsal").refuse).toBe(false);
  expect(targetOf(REMOTE).where).toBe("someone@db.example.invalid:5432/postgres");   // the address, never the password
});

test("migrate, create-user, the AI allowance and restoring originals refuse a database elsewhere, or live, before touching it, and name it (code review, 16 Nov 2026, D-M5)", () => {
  const cases: [string, string[]][] = [["migrate.ts", []], ["createUser.ts", ["Some Org", "someone@example.test", "Some One", "a-long-enough-password"]],
    ["aiAllowance.ts", ["00000000-0000-0000-0000-000000000001", "20"]], ["backupOriginals.ts", ["restore"]]];
  for (const [script, args] of cases) {
    const r = run(script, args, { DATABASE_URL: REMOTE });
    expect(r.out, script).toMatch(/Refusing to change it: it is not on this machine/);
    expect(r.out, script).toContain("someone@db.example.invalid:5432/postgres");
    expect(r.out, script).not.toContain(MADE_UP);
    expect(r.code, script).toBe(2);
  }
  // live, even on this machine (the PC's database is local to it)
  const live = run("migrate.ts", [], { DATABASE_URL: address("app", MADE_UP, "127.0.0.1:1/rolematch"), ROLEMATCH_ENVIRONMENT: "live" });
  expect(live.out).toMatch(/Refusing to change it: its settings say it is live/); expect(live.code).toBe(2);
  // said on purpose: it goes on (and here fails to reach the made-up address, which shows it tried)
  const meant = run("migrate.ts", ["--target-confirmed"], { DATABASE_URL: REMOTE });
  expect(meant.out).not.toMatch(/Refusing/); expect(meant.code).not.toBe(2);
}, 120_000);
