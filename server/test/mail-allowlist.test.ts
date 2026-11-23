import { spawn } from "node:child_process";
import { afterAll, expect, test } from "vitest";
import postgres from "postgres";
import { assertSafeToTest } from "../../e2e/mailSafety";
import { adminDeleteUser } from "../src/supabase";
import { FakeSmtp } from "./fakeSmtp";
import { setupTestDb } from "./helpers";
import { makeWorld, sleep, type World } from "./portalKit";

// Default-deny sending. Real mail needs an explicit transport AND a mode: "off" sends nothing, "allowlist" (the default) sends only to the approved recipients for EVERY kind of
// message, "live" is the deliberate exception. Simulated mail host only; nothing here sends a real message.
const NO_RATE = JSON.stringify({ invite_user: 100000, invite_portal: 100000, invite_org: 100000, member_user: 100000 });
const worlds: World[] = []; const hosts: FakeSmtp[] = []; const cleanup: (() => Promise<void>)[] = [];
afterAll(async () => { for (const w of worlds) await w.stop().catch(() => {}); for (const h of hosts) await h.stop().catch(() => {}); for (const c of cleanup) await c().catch(() => {}); }, 180000);
const waitFor = async (f: () => Promise<boolean> | boolean, ms = 25000) => { for (let i = 0; i < ms / 250; i++) { try { if (await f()) return true; } catch { /* retry */ } await sleep(250); } return false; };
const rand = () => Math.random().toString(16).slice(2, 8);
const mail = (port: number, extra: Record<string, string>) => ({ MAIL_TRANSPORT: "smtp", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: String(port), MAIL_SMTP_SECURITY: "none", PUBLIC_APP_URL: "https://app.rolematch.example", OUTBOX_POLL_MS: "300", RATE_OVERRIDES: NO_RATE, ...extra });
const members = async (w: World) => (await w.users[0].get("/api/portal/members")).body;

test("an invitation is sent only to approved recipients; anyone else is blocked before any attempt, and the status shows the mode without any address or credential", async () => {
  const smtp = new FakeSmtp(8921); await smtp.start(); hosts.push(smtp);
  const okAddr = `al-ok-${rand()}@example.test`, noAddr = `al-no-${rand()}@example.test`;
  const w = await makeWorld(8922, 1, { SIGNUP_REQUIRE_CODE: "false", ...mail(8921, { MAIL_ALLOWED_RECIPIENTS: okAddr }) }); worlds.push(w);
  const status = await (await fetch(w.base + "/api/health/mail")).json() as any; expect(status).toEqual({ sending: "restricted", transport: "smtp" }); expect(JSON.stringify(status)).not.toContain(okAddr);
  expect(await assertSafeToTest(w.base)).toMatchObject({ sending: "restricted" });                      // the browser-test harness accepts a restricted server
  await w.users[0].post("/api/portal/invitations", { emails: [okAddr, noAddr], role: "recruiter" });
  expect(await waitFor(async () => { const v = (await members(w)).invitations; return v.find((i: any) => i.email === okAddr)?.emailState === "accepted" && v.find((i: any) => i.email === noAddr)?.emailState === "failed"; })).toBe(true);
  expect(smtp.messages.map((m) => m.to[0])).toEqual([okAddr]);
  expect(smtp.messages[0].text).not.toContain("LOCAL TEST LINK");                                        // a real https address: not labelled local
  const rows = await w.admin.unsafe(`select outcome, error_class from "${w.tdb.schema}".mail_attempts where outcome = 'blocked' and template = 'invitation'`); expect(rows.length).toBe(1);
  expect(JSON.stringify(await w.admin.unsafe(`select last_error from "${w.tdb.schema}".outbox`))).not.toContain(noAddr);
  // the welcome e-mail goes through the same boundary: queued for a member who is not on the list, it is blocked and nothing reaches the host
  // (the world's administrator signed up, so a welcome was queued for an address that is not on the list)
  expect(await waitFor(async () => (await w.admin.unsafe(`select 1 from "${w.tdb.schema}".mail_attempts where template = 'welcome' and outcome = 'blocked'`)).length === 1)).toBe(true);
  expect(smtp.messages.map((x) => x.to[0])).toEqual([okAddr]);
}, 300000);

test("DEFAULT DENY: a configured transport with an empty approved list sends nothing of any kind", async () => {
  const smtp = new FakeSmtp(8923); await smtp.start(); hosts.push(smtp);
  const w = await makeWorld(8924, 1, { SIGNUP_REQUIRE_CODE: "false", ...mail(8923, {}) }); worlds.push(w);   // no MAIL_SEND_MODE and no list: the defaults
  expect(((await (await fetch(w.base + "/api/health/mail")).json()) as any).sending).toBe("restricted");
  const made = (await w.users[0].post("/api/portal/invitations", { emails: [`dd-${rand()}@example.test`], role: "hiring_manager" })).body[0];
  expect(await waitFor(async () => (await members(w)).invitations.find((i: any) => i.id === made.id)?.emailState === "failed")).toBe(true);
  expect(smtp.messages.length).toBe(0); expect(smtp.connections).toBe(0);                                  // not even a connection was opened
}, 300000);

test("MAIL_SEND_MODE=off sends nothing even with a full configuration, and the harness refuses nothing there (off is safe) while invitations wait", async () => {
  const smtp = new FakeSmtp(8925); await smtp.start(); hosts.push(smtp);
  const a = `off-${rand()}@example.test`;
  const w = await makeWorld(8926, 1, { SIGNUP_REQUIRE_CODE: "false", ...mail(8925, { MAIL_SEND_MODE: "off", MAIL_ALLOWED_RECIPIENTS: a }) }); worlds.push(w);
  expect(await (await fetch(w.base + "/api/health/mail")).json()).toEqual({ sending: "off", transport: "smtp" }); expect(await assertSafeToTest(w.base)).toMatchObject({ sending: "off" });
  const made = (await w.users[0].post("/api/portal/invitations", { emails: [a], role: "hiring_manager" })).body[0]; await sleep(3000);
  expect((await members(w)).invitations.find((i: any) => i.id === made.id).emailState).toBe("queued"); expect(smtp.messages.length).toBe(0); expect(smtp.connections).toBe(0);
}, 300000);

test("live mode needs a real application address: with a local one it sends nothing; with a real one it sends to anyone; and the harness REFUSES a live server", async () => {
  const smtp = new FakeSmtp(8927); await smtp.start(); hosts.push(smtp);
  const w1 = await makeWorld(8928, 1, { SIGNUP_REQUIRE_CODE: "false", ...mail(8927, { MAIL_SEND_MODE: "live", PUBLIC_APP_URL: "http://localhost:5173" }) }); worlds.push(w1);
  const a = (await w1.users[0].post("/api/portal/invitations", { emails: [`lv-${rand()}@example.test`], role: "hiring_manager" })).body[0];
  expect(await waitFor(async () => (await members(w1)).invitations.find((i: any) => i.id === a.id)?.emailState === "failed")).toBe(true); expect(smtp.messages.length).toBe(0);
  expect(JSON.stringify(await w1.admin.unsafe(`select last_error from "${w1.tdb.schema}".outbox`))).toContain("local-only");
  await assertSafeToTest(w1.base).then(() => { throw new Error("should have refused"); }, (e) => expect(String(e.message)).toMatch(/LIVE/));
  const w2 = await makeWorld(8929, 1, { SIGNUP_REQUIRE_CODE: "false", ...mail(8927, { MAIL_SEND_MODE: "live" }) }); worlds.push(w2);
  const anyone = `lv-${rand()}@example.test`; await w2.users[0].post("/api/portal/invitations", { emails: [anyone], role: "hiring_manager" });
  expect(await waitFor(() => smtp.messages.some((m) => m.to[0] === anyone))).toBe(true);
}, 400000);

test("the browser-test harness refuses a server whose status is missing, malformed, unreachable or live, and never needs a credential", async () => {
  const mk = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  await expect(assertSafeToTest("http://x", mk(404, {}))).rejects.toThrow(/older server/);
  await expect(assertSafeToTest("http://x", mk(200, { nope: 1 }))).rejects.toThrow(/not understood/);
  await expect(assertSafeToTest("http://x", mk(200, { sending: "live", transport: "smtp" }))).rejects.toThrow(/LIVE/);
  await expect(assertSafeToTest("http://x", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).rejects.toThrow(/could not be read/);
  await expect(assertSafeToTest("http://x", mk(200, { sending: "off", transport: "none" }))).resolves.toMatchObject({ sending: "off" });
});

test("VERIFICATION CODES obey the same list: an unapproved address is told this server mails approved recipients only and nothing is sent; an approved one gets its code and can verify", async () => {
  const smtp = new FakeSmtp(8931); await smtp.start(); hosts.push(smtp);
  const okAddr = `vc-ok-${rand()}@example.test`, noAddr = `vc-no-${rand()}@example.test`;
  const tdb = await setupTestDb({ PORT: "8932", TRUST_PROXY: "true", SIGNUP_DEV_CODE: "false", ...mail(8931, { MAIL_ALLOWED_RECIPIENTS: okAddr }), RATE_OVERRIDES: JSON.stringify({ signup_ip: 500 }) });
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: tdb.env, stdio: "ignore" });
  cleanup.push(async () => { child.kill("SIGKILL"); await tdb.teardown(); const a = postgres(process.env.DATABASE_URL!, { max: 1 }); try { for (const u of await a.unsafe(`select id from auth.users where email in ('${okAddr}', '${noAddr}')`)) await adminDeleteUser(u.id); } finally { await a.end(); } });
  for (let i = 0; i < 300; i++) { try { if ((await fetch("http://localhost:8932/api/health")).ok) break; } catch { /* starting */ } await sleep(250); }
  const post = (path: string, body: unknown) => fetch("http://localhost:8932" + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.3.3.3" }, body: JSON.stringify(body) });
  const blocked = await post("/api/auth/signup", { name: "No List", orgName: "No List Org", email: noAddr, password: "a-long-enough-password-1" });
  expect(blocked.status).toBe(503); expect(((await blocked.json()) as any).error.code).toBe("MAIL-002"); expect(smtp.messages.length).toBe(0);
  const ok = await post("/api/auth/signup", { name: "On List", orgName: "On List Org", email: okAddr, password: "a-long-enough-password-1" });
  expect(ok.status).toBe(202); expect(smtp.messages.length).toBe(1); expect(smtp.messages[0].to).toEqual([okAddr]);
  const code = smtp.messages[0].text.match(/\b(\d{6,10})\b/)![1];
  expect((await post("/api/auth/verify", { email: okAddr, code })).status).toBe(200);
}, 300000);
