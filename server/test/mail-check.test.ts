// `npm run mail:config -- check` against a local TLS mail host with its own certificate. Proves the check sends no message (no MAIL, RCPT or DATA), keeps certificate checking on
// (an untrusted certificate stops it before the password is offered), reports a refused login, and never prints the password. It says nothing about the real host.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PASSWORD = `pw-${Math.random().toString(36).slice(2)}"$#\\x`;
const dir = mkdtempSync(join(tmpdir(), "mailcheck-"));
const commands: string[] = [];
let srv: Server, port = 0;

beforeAll(async () => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  srv = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (s) => {
    const w = (l: string) => s.write(l + "\r\n"); let buf = "";
    s.on("error", () => {}); w("220 local.test ESMTP");
    s.on("data", (c) => {
      buf += c.toString("latin1");
      for (let i; (i = buf.indexOf("\r\n")) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2); const verb = line.split(" ")[0].toUpperCase(); commands.push(verb);
        if (verb === "EHLO") { w("250-local.test"); w("250 AUTH PLAIN"); }
        else if (verb === "AUTH") { const pass = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8").split("\u0000")[2]; w(pass === PASSWORD ? "235 2.7.0 ok" : "535 5.7.8 bad"); }
        else if (verb === "QUIT") { w("221 bye"); s.end(); }
        else w("250 ok");
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => { port = (srv.address() as any).port; r(); }));
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

function run(pass: string, trustCert: boolean) {
  const file = join(dir, `env-${Math.random()}`);
  writeFileSync(file, `MAIL_SMTP_HOST=localhost\nMAIL_SMTP_PORT=${port}\nMAIL_SMTP_SECURITY=implicit\nMAIL_SMTP_USER=info@local.test\nMAIL_SMTP_PASS='${pass}'\n`, { mode: 0o600 });
  const env = { ...process.env, ROLEMATCH_ENV_FILE: file, NODE_EXTRA_CA_CERTS: trustCert ? join(dir, "cert.pem") : "" };
  return new Promise<{ code: number | null; out: string }>((res) => {
    const p = spawn("npx", ["tsx", "scripts/mailConfig.ts", "check"], { env, cwd: join(__dirname, "..") }); let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ code, out }));
  });
}

describe("mail:config check (no message is sent)", () => {
  it("verifies the certificate and logs in, then quits without MAIL, RCPT or DATA", async () => {
    commands.length = 0;
    const r = await run(PASSWORD, true);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/login was accepted/);
    expect(r.out).toMatch(/No message was sent/);
    expect(commands).toContain("AUTH");
    expect(commands.filter((c) => ["MAIL", "RCPT", "DATA"].includes(c))).toEqual([]);
    expect(r.out).not.toContain(PASSWORD);
  }, 60_000);

  it("reports a refused login without printing the password or the server's text", async () => {
    commands.length = 0;
    const r = await run("wrong-" + PASSWORD, true);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/refused the login.*\[EAUTH \(SMTP 535\)\]/s);
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toMatch(/5\.7\.8 bad/);
    expect(commands.filter((c) => ["MAIL", "RCPT", "DATA"].includes(c))).toEqual([]);
  }, 60_000);

  it("stops at an untrusted certificate before the password is offered", async () => {
    commands.length = 0;
    const r = await run(PASSWORD, false);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/certificate or host name did not verify/);
    expect(commands).not.toContain("AUTH");
    expect(r.out).not.toContain(PASSWORD);
  }, 60_000);
});
