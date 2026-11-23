import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// A scan that nothing can get past tells nobody anything, and a scan loosened to let a commit through is worse: these prove what it still stops. The values are made up when the test runs, so none is ever in the repository.
const ROOT = join(import.meta.dirname, "..", ".."), rand = (n: number) => Array.from({ length: n }, () => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 56)]).join("");
const scan = (name: string, content: string) => { const dir = mkdtempSync(join(tmpdir(), "scan-")); writeFileSync(join(dir, name), content); const r = spawnSync("gitleaks", ["detect", "--no-git", "--no-banner", "--redact", "--source", dir, "--config", join(ROOT, ".gitleaks.toml"), "--report-format", "json", "--report-path", "/dev/stdout"], { encoding: "utf8" }); return { code: r.status, out: r.stdout }; };
const present = spawnSync("gitleaks", ["version"]).status === 0;

test.runIf(present).each([
  ["a database address with a real password", () => `const url = "postgres://rolematch_app:${rand(24)}@aws-0-eu-west-1.pooler.example.com:5432/postgres";`],
  ["a service key written as a value", () => `SUPABASE_SERVICE_ROLE_KEY=${rand(48)}`],
  ["a mail password", () => `MAIL_SMTP_PASS="${rand(30)}"`],
  ["a signed token", () => `const token = "eyJ${rand(30)}.eyJ${rand(60)}.${rand(43)}";`],
  ["a private key", () => `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${rand(60)}\n${rand(64)}\n-----END RSA PRIVATE KEY-----`],
  ["an outside AI key", () => `ANTHROPIC_API_KEY=sk-ant-api03-${rand(80)}`],
])("%s is stopped", (_what, make) => { const r = scan("leak.ts", make()); expect(r.code).toBe(1); expect(r.out).toContain("RuleID"); });
test.runIf(present)("the exceptions are narrow: a real-looking address on a real host is stopped even written the same way", () => {
  expect(scan("a.ts", `DATABASE_URL: "postgres://app:${rand(24)}@db.example.com:5432/postgres"`).code).toBe(1);
  expect(scan("b.ts", `DATABASE_URL: "postgres://app:${rand(24)}@db.supabase.co.test.evil.com/postgres"`).code).toBe(1);
  expect(scan("c.ts", `SUPABASE_SERVICE_ROLE_KEY: "${rand(48)}"`).code).toBe(1);
});
test.runIf(present).each([
  ["a reference to a value, not a value", "const a = { DATABASE_URL: LIVE.DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY: LIVE.SUPABASE_SERVICE_ROLE_KEY };"],
  ["an invented address on a reserved host name", 'const a = { DATABASE_URL: "postgres://u:p@db.example-pooler.test:5432/postgres" };'],
  ["reading from the environment", "const url = process.env.DATABASE_URL;"],
  ["the local stack's published default", "postgres://postgres:postgres@127.0.0.1:54322/postgres"],
  ["a short test placeholder", 'const u = "postgres://u:p@h/db";'],
])("%s is not reported", (_what, content) => { expect(scan("fine.ts", content).code).toBe(0); });
