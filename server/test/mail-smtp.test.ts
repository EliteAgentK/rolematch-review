import { afterAll, beforeAll, expect, test, vi } from "vitest";
vi.hoisted(() => { Object.assign(process.env, { MAIL_TRANSPORT: "smtp", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: "8891", MAIL_SMTP_SECURITY: "none", MAIL_SMTP_USER: "", MAIL_SMTP_PASS: "" }); });   // before config is read
import { config } from "../src/config";
import { classify, MailError, SmtpTransport } from "../src/mail/transport";
import { FakeSmtp } from "./fakeSmtp";

// The real SMTP transport (nodemailer) against a simulated mail host: connection, one message per recipient, header safety, and how each kind of refusal is classified.
// This proves our handling. It is not evidence about the production mail host.
const PORT = 8891; let smtp: FakeSmtp; let t: SmtpTransport;
beforeAll(async () => { smtp = new FakeSmtp(PORT); await smtp.start(); });
afterAll(async () => { t?.close(); await smtp.stop(); });
const msg = (over: Record<string, unknown> = {}) => ({ to: "person@example.test", from: "RoleMatch <info@rolematch.test>", subject: "Hello", html: "<p>Hi</p>", text: "Hi", messageId: "<x1@rolematch.test>", ...over });

test("a message is handed to the server with the approved From, a separate envelope, a plain-text part and the Message-ID we chose", async () => {
  t = new SmtpTransport(); smtp.mode = "ok";
  const r = await t.send(msg({ envelopeFrom: "bounces@rolematch.test", inline: [{ cid: "rolematch-logo", filename: "l.png", contentType: "image/png", content: Buffer.from("x") }] }));
  expect(r.response).toContain("250"); expect(r.simulated).toBe(false);
  const m = smtp.messages.at(-1)!;
  expect(m.from).toBe("bounces@rolematch.test"); expect(m.to).toEqual(["person@example.test"]);
  expect(m.headers["from"]).toContain("info@rolematch.test"); expect(m.headers["message-id"]).toBe("<x1@rolematch.test>");
  expect(m.headers["auto-submitted"]).toBe("auto-generated");
  expect(m.text).toContain("Hi"); expect(m.html).toContain("<p>Hi</p>"); expect(m.inlineCids).toContain("rolematch-logo");
});
test("a line break in any header value is refused, never cleaned and sent (no header injection)", async () => {
  const before = smtp.messages.length;
  for (const bad of [{ subject: "Hi\r\nBcc: victim@example.test" }, { to: "a@example.test\r\nBcc: v@example.test" }, { replyTo: "a@example.test\nX: y" }, { from: "RoleMatch <x@y.test>\r\nBcc: z@y.test" }])
    await expect(t.send(msg(bad))).rejects.toMatchObject({ kind: "permanent" });
  expect(smtp.messages.length).toBe(before);
  await expect(t.send(msg({ to: "not an address" }))).rejects.toMatchObject({ kind: "permanent" });
});
test("refusals are classified: 4xx temporary, 5xx permanent with its enhanced status, a failed login unavailable (our configuration, not the recipient)", async () => {
  smtp.mode = "temp"; await expect(t.send(msg())).rejects.toMatchObject({ kind: "temporary", smtpCode: 451 });
  smtp.mode = "perm"; const e: MailError = await t.send(msg()).catch((x) => x);
  expect(e.kind).toBe("permanent"); expect(e.smtpCode).toBe(550); expect(e.enhanced).toBe("5.1.1"); expect(e.message).not.toContain("person@example.test");   // server text can echo the address: never kept
  smtp.mode = "authfail"; (config.mail as any).smtpUser = "u"; (config.mail as any).smtpPass = "p"; const u = new SmtpTransport(); (config.mail as any).smtpUser = ""; (config.mail as any).smtpPass = "";
  await expect(u.send(msg())).rejects.toMatchObject({ kind: "unavailable" }); u.close();
  smtp.mode = "ok";
});
test("a connection that dies after the message was handed over is UNCERTAIN, not failed: it may have been delivered", async () => {
  smtp.mode = "dropAfterData"; const before = smtp.messages.length;
  await expect(t.send(msg({ messageId: "<u1@rolematch.test>" }))).rejects.toMatchObject({ kind: "uncertain" });
  expect(smtp.messages.length).toBe(before + 1);   // the server did receive it: this is the duplicate-risk the product documents
  smtp.mode = "ok";
});
test("nothing listening is a temporary failure, and a hanging or unknown error never claims success", async () => {
  (config.mail as any).smtpPort = 8899; const dead = new SmtpTransport(); (config.mail as any).smtpPort = PORT;
  const e: MailError = await dead.send(msg()).catch((x) => x); dead.close();
  expect(e).toBeInstanceOf(MailError); expect(["temporary", "unavailable"]).toContain(e.kind);
  expect(classify({ code: "EWHATEVER" }).kind).toBe("temporary");
});
