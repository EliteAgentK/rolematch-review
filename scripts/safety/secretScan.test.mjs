// node --test scripts/safety : proves the secret scan still catches what it must, ignores what it should, and never reports a failed run as clean.
// Every secret-shaped value is generated at run time, so nothing here is a real secret and nothing secret-shaped is committed.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "./secretScan.mjs";

const work = mkdtempSync(join(tmpdir(), "secret scan fixtures "));   // a path with spaces on purpose
after(() => rmSync(work, { recursive: true, force: true }));
const pick = (alphabet, n) => Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join("");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", UPPER32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const folder = (name, files) => { const d = join(work, name); mkdirSync(d, { recursive: true }); for (const [f, body] of Object.entries(files)) writeFileSync(join(d, f), body); return d; };

// Each positive is one file holding one generated secret; the scan must report every one of these files.
const positives = {
  "github-token.ts": `const token = "ghp_${pick(ALNUM, 36)}";\n`,
  "aws-key.env": `AWS_ACCESS_KEY_ID=AKIA${pick(UPPER32, 16)}\n`,
  "slack-token.json": `{ "slack": "xoxb-${pick("0123456789", 12)}-${pick("0123456789", 12)}-${pick(ALNUM, 24)}" }\n`,
  "stripe-key.ts": `export const stripe = "sk_live_${pick(ALNUM, 32)}";\n`,
  "service-role-jwt.ts": `const key = "${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ iss: "supabase", role: "service_role", iat: 1700000000, exp: 2000000000 })}.${randomBytes(32).toString("base64url")}";\n`,
  "generic-api-key.ts": `const config = { api_key: "${pick(ALNUM, 40)}" };\n`,
  "private-key.pem": generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }),
  "rolematch-smtp.ts": `const mail = { MAIL_SMTP_PASS: "${pick(ALNUM, 32)}" };\n`,
  "rolematch-env-file.env": `SUPABASE_SERVICE_ROLE_KEY=${pick(ALNUM, 48)}\n`,
};
// Placeholders and ordinary test data, including the shapes behind the 11 false positives of the first draft rule (docs/security/SAFETY_CHECKS.md).
const negatives = {
  "placeholders.ts": `const a = { api_key: "your-api-key-here", password: "changeme", token: "xxxxxxxxxxxxxxxxxxxxxxxx" };\nSUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>\n`,
  "env-references.ts": `const e = { MAIL_SMTP_PASS: env.MAIL_SMTP_PASS, DATABASE_URL: tdb.url(), KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };\nprocess.env.SUPABASE_SERVICE_ROLE_KEY = restore.key;\n`,
  "test-data.ts": `autoMigrate({ DATABASE_URL: "postgres://x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x" });\nconst f = ["DATABASE_URL=postgres://u:p@h/db", "MAIL_SMTP_PASS=oldsecret"];\nconst who = "pieter.naidoo@example.test";\n`,
};

test("every generated secret is found: structured tokens, a JWT, a generic key, a multi-line private key and RoleMatch's own variables", () => {
  const r = scan({ kind: "dir", path: folder("positive", positives) });
  assert.equal(r.status, "found");
  const hit = new Set(r.findings.map((f) => f.file.split("/").pop()));
  for (const f of Object.keys(positives)) assert.ok(hit.has(f), `${f} was not detected; detection has weakened`);
});

test("placeholders, references to where a value comes from, and ordinary test data are not reported", () => {
  const r = scan({ kind: "dir", path: folder("negative", negatives) });
  assert.equal(r.status, "clean", JSON.stringify(r.findings.map((f) => [f.rule, f.file.split("/").pop(), f.line])));
});

test("a scan that did not complete is never clean: scanner missing, crashed, silent, or contradicting itself", () => {
  const dir = folder("plain", { "a.txt": "nothing here\n" });
  const fake = (name, script) => { const p = join(work, name); writeFileSync(p, `#!/bin/sh\n${script}\n`); chmodSync(p, 0o755); return p; };
  const reportArg = `while [ "$1" != "--report-path" ]; do shift; done; R="$2"`;
  const cases = {
    "gitleaks is not installed": join(work, "no-such-gitleaks"),
    "gitleaks failed (exit 1)": fake("crashes", "echo 'config error' >&2; exit 1"),
    "did not write a readable report": fake("silent", "exit 0"),
    "not a list of findings": fake("odd-report", `${reportArg}; echo '{"ok":true}' > "$R"; exit 0`),
    "does not match its report": fake("contradicts", `${reportArg}; echo '[]' > "$R"; exit 3`),
  };
  for (const [why, bin] of Object.entries(cases)) {
    const r = scan({ kind: "dir", path: dir }, { gitleaks: bin });
    assert.equal(r.status, "incomplete", why); assert.match(r.reason, new RegExp(why.replace(/[()]/g, "\\$&")));
  }
  assert.equal(scan({ kind: "dir", path: dir }).status, "clean");   // and the real scanner on a harmless folder is clean
});
