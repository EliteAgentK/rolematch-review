import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { expect, test } from "vitest";
import { EnvValueError, fileModeIsPrivate, serializeValue, updateEnvFile, updateEnvText } from "../src/envFile";

// Password storage for the mail login. Every value is serialised for Node's real .env parser and proven by parsing it back; what cannot be stored is refused, not mangled.
const dir = () => mkdtempSync(join(tmpdir(), "rm-env-"));
const roundTrip = (v: string) => parseEnv(`K=${serializeValue(v)}\n`).K;

test("awkward values read back exactly: both quote types, backslashes (including a literal backslash-n), dollar signs, hashes, spaces, equals signs, unicode", () => {
  const cases = ["plain", "has space", "  leading and trailing  ", "it's", 'say "hi"', "back`tick", "C:\\path\\new\\n", "line\\nbreak-looking", "\\\\double", "$HOME ${PATH} $(whoami)", "a#b", " # not a comment", "k=v=w", "pässwörd-✓-日本語", "'\"x", "a'b\"c", "`'", "`\"", "'", '"', "`", "\\", "#", "$", " ", "x".repeat(500)];
  for (const v of cases) expect(roundTrip(v), JSON.stringify(v)).toBe(v);
});

test("what the file format cannot hold is refused with a clear message that never contains the value", () => {
  for (const v of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "bell\u0007"]) { const e = (() => { try { serializeValue(v); } catch (x) { return x as Error; } })(); expect(e).toBeInstanceOf(EnvValueError); expect(e!.message).toMatch(/control character/); expect(e!.message).not.toContain(v); }
  const all = (() => { try { serializeValue("a'b\"c`d"); } catch (x) { return x as Error; } })();   // all three quote characters at once: no way to quote it for this parser
  expect(all).toBeInstanceOf(EnvValueError); expect(all!.message).toMatch(/cannot be stored/); expect(all!.message).not.toContain("a'b");
});

test("property: random printable values either read back exactly or are refused (and refusal happens only for all-three-quotes)", () => {
  let seed = 20261029; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const alphabet = ` !"#$%&'()*+,-./0123456789:;<=>?@ABCXYZ[\\]^_\`abcxyz{|}~`;
  let refused = 0;
  for (let i = 0; i < 2000; i++) {
    const v = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
    try { expect(roundTrip(v), JSON.stringify(v)).toBe(v); } catch (e) { if (!(e instanceof EnvValueError)) throw e; refused++; expect(v.includes("'") && v.includes('"') && v.includes("`"), JSON.stringify(v)).toBe(true); }
  }
  expect(refused).toBeLessThan(2000);
});

test("updating keeps unrelated lines byte for byte (comments, blank lines, a multi-line value), replaces in place, removes duplicates, appends missing, and the result parses to what was asked", () => {
  const before = ["# database", "DATABASE_URL=postgres://u:p@h/db", "", "MAIL_SMTP_HOST=old.example", "PRIVATE_KEY=\"-----BEGIN\nMAIL_SMTP_PASS=this is inside a quoted value\n-----END\"", "MAIL_SMTP_PASS=oldsecret", "OTHER='x y'", "MAIL_SMTP_PASS=duplicate-oldsecret", ""].join("\n");
  const after = updateEnvText(before, { MAIL_SMTP_HOST: "mail.example", MAIL_SMTP_PASS: "new #pass' w\"ord\\n$", MAIL_ALLOWED_RECIPIENTS: "a@example.test" });
  const p = parseEnv(after);
  expect(p.MAIL_SMTP_HOST).toBe("mail.example"); expect(p.MAIL_SMTP_PASS).toBe("new #pass' w\"ord\\n$"); expect(p.MAIL_ALLOWED_RECIPIENTS).toBe("a@example.test");
  expect(p.DATABASE_URL).toBe("postgres://u:p@h/db"); expect(p.OTHER).toBe("x y"); expect(p.PRIVATE_KEY).toContain("MAIL_SMTP_PASS=this is inside a quoted value");
  expect(after.split("\n").filter((l) => l.startsWith("MAIL_SMTP_PASS=") && !l.includes("inside a quoted value")).length).toBe(1);   // the other line that starts the same way is INSIDE PRIVATE_KEY's quoted value and must be kept expect(after.match(/^MAIL_SMTP_HOST=/gm)!.length).toBe(1);
  expect(after).toContain("# database\nDATABASE_URL=postgres://u:p@h/db\n\nMAIL_SMTP_HOST=");   // order and comments preserved
  expect(updateEnvText(after, {})).toBe(after);                                                    // idempotent
  expect(parseEnv(updateEnvText(after, { MAIL_SMTP_PASS: null })).MAIL_SMTP_PASS).toBeUndefined();   // removal
});

test("writing to a file is atomic and private: mode 0600 for the final file, no temporary file left, nothing printed, and a refusal leaves the file untouched", () => {
  const d = dir(), f = join(d, ".env"); writeFileSync(f, "KEEP=1\nMAIL_SMTP_PASS=old\n", { mode: 0o644 }); chmodSync(f, 0o644);
  updateEnvFile(f, { MAIL_SMTP_PASS: "S3cret #'\\$ x" });
  expect(parseEnv(readFileSync(f, "utf8")).MAIL_SMTP_PASS).toBe("S3cret #'\\$ x"); expect(parseEnv(readFileSync(f, "utf8")).KEEP).toBe("1");
  expect(fileModeIsPrivate(f)).toBe(true); expect(statSync(f).mode & 0o777).toBe(0o600);
  expect(readdirSync(d)).toEqual([".env"]);                                                          // no temp file
  const snapshot = readFileSync(f, "utf8");
  expect(() => updateEnvFile(f, { MAIL_SMTP_PASS: "bad\nvalue" })).toThrow(EnvValueError); expect(readFileSync(f, "utf8")).toBe(snapshot); expect(readdirSync(d)).toEqual([".env"]);
  const g = join(d, "new.env"); updateEnvFile(g, { MAIL_SMTP_PASS: "x" }); expect(statSync(g).mode & 0o777).toBe(0o600);   // a file that did not exist is created private
  expect(existsSync(join(d, ".env.tmp"))).toBe(false);
});

test("a managed key whose value spans lines is refused rather than guessed at", () => {
  expect(() => updateEnvText("MAIL_SMTP_PASS='line one\nline two'\n", { MAIL_SMTP_PASS: "x" })).toThrow(/spans several lines/);
});

// The command line tool: it never prints a secret, refuses a non-terminal for the password, enforces the safe sequence, and edits only what it manages.
const cli = (file: string, ...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/mailConfig.ts", ...args], { env: { ...process.env, ROLEMATCH_ENV_FILE: file }, encoding: "utf8", input: "" });
test("mail:config never reveals the password, refuses to take it from a pipe, and will not enable sending without a login and approved recipients", () => {
  const d = dir(), f = join(d, ".env"); const secret = "Pa55 w0rd#'\\$unique-9137";
  writeFileSync(f, "DATABASE_URL=keep\n"); updateEnvFile(f, { MAIL_SMTP_HOST: "mail.example.test", MAIL_SMTP_USER: "u@example.test", MAIL_SMTP_PASS: secret });
  const piped = cli(f, "credentials"); expect(piped.status).not.toBe(0); expect(piped.stdout + piped.stderr).toMatch(/interactive terminal/); expect(piped.stdout + piped.stderr).not.toContain(secret);
  const noList = cli(f, "enable"); expect(noList.status).not.toBe(0); expect(noList.stderr).toMatch(/approved recipients first/);
  expect(cli(f, "allow", "not-an-address").status).not.toBe(0);
  const allow = cli(f, "allow", "a@example.test,b@example.test"); expect(allow.status).toBe(0);
  expect(cli(f, "mode", "live").status).not.toBe(0);                                                  // live needs the explicit flag
  const en = cli(f, "enable"); expect(en.status).toBe(0);
  const st = cli(f, "status"); expect(st.status).toBe(0); expect(st.stdout).toMatch(/password: set/); expect(st.stdout).toMatch(/restricted to the approved list/); expect(st.stdout).toMatch(/approved recipients: 2/);
  for (const out of [piped, noList, allow, en, st]) { expect(out.stdout + out.stderr).not.toContain(secret); expect(out.stdout + out.stderr).not.toContain("Pa55"); }
  const p = parseEnv(readFileSync(f, "utf8")); expect(p.MAIL_TRANSPORT).toBe("smtp"); expect(p.MAIL_SMTP_PASS).toBe(secret); expect(p.DATABASE_URL).toBe("keep"); expect(p.MAIL_SEND_MODE).toBe("allowlist");
  expect(cli(f, "disable").status).toBe(0); const q = parseEnv(readFileSync(f, "utf8")); expect(q.MAIL_SEND_MODE).toBe("off"); expect(q.MAIL_TRANSPORT).toBe("");
});
