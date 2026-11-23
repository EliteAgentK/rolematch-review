import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// Whatever starts a server or a script, an isolated run never takes MAIL_* from .env. The check runs the real config module in a fresh process with a throw-away env file that
// holds a fake mailbox login, and the child's isolation flags are set or removed explicitly (a test process itself carries VITEST, which would hide a gap).
const dir = mkdtempSync(join(tmpdir(), "rm-iso-")), file = join(dir, ".env");
writeFileSync(file, "MAIL_TRANSPORT=smtp\nMAIL_SMTP_HOST=fake.example\nMAIL_SMTP_USER=u@example.test\nMAIL_SMTP_PASS=not-a-real-password\nMAIL_SEND_MODE=live\nOTHER_SETTING=kept\n");
const probe = (set: Record<string, string>) => {
  const env: Record<string, string | undefined> = { ...process.env, ROLEMATCH_ENV_FILE: file }; for (const k of ["VITEST", "NODE_ENV", "DB_SCHEMA", "MAIL_TRANSPORT", "MAIL_SMTP_PASS", "MAIL_SMTP_HOST", "MAIL_SEND_MODE", "OTHER_SETTING"]) delete env[k]; Object.assign(env, set);
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", "const m = await import('./src/config.ts'); console.log(JSON.stringify({ t: m.config.mail.transport, h: m.config.mail.smtpHost, p: m.config.mail.smtpPass, m: m.config.mail.sendMode, o: process.env.OTHER_SETTING ?? null }))"], { encoding: "utf8", env: env as NodeJS.ProcessEnv });
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
};

test("a normal (non-isolated) start does read the mail settings from the file: the loader is working, so the next checks mean something", () => {
  expect(probe({})).toMatchObject({ t: "smtp", h: "fake.example", p: "not-a-real-password", m: "live", o: "kept" });
});
test("every isolation signal blocks MAIL_* from the file (a test schema, VITEST, NODE_ENV=test), while other settings still load", () => {
  for (const set of [{ DB_SCHEMA: "test_abc123" }, { VITEST: "true" }, { NODE_ENV: "test" }]) expect(probe(set), JSON.stringify(set)).toMatchObject({ t: "none", h: "", p: "", m: "allowlist", o: "kept" });
});
test("the shared project's schema is not isolated, and an explicit environment value always wins over the file", () => {
  expect(probe({ DB_SCHEMA: "public" }).t).toBe("smtp");
  expect(probe({ MAIL_TRANSPORT: "preview" }).t).toBe("preview");
});
