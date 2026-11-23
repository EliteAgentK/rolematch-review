import { afterAll, beforeAll, expect, test } from "vitest";
import { FakeSmtp } from "./fakeSmtp";
import { makeWorld, sleep, type World } from "./portalKit";

// A forgotten password, through the real routes and a simulated mail host. Nothing here says whether an address has an account; the code works once, inside its lifetime; old sessions end.
const SMTP = 8981; let w: World, smtp: FakeSmtp; const NEW = "a-brand-new-password-1";
const call = (path: string, body: unknown, ip = "10.91.0.1") => fetch(w.base + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const codeFor = async (to: string, after: number) => {
  for (let i = 0; i < 80; i++) { const m = smtp.messages.filter((x) => x.to.includes(to)).filter((x) => x.at >= after).at(-1); const c = m && /(\d{6,10}) is your RoleMatch password reset code/.exec(m.headers.subject ?? ""); if (c) return c[1]; await sleep(100); }
  throw new Error("no code arrived");
};
beforeAll(async () => {
  smtp = new FakeSmtp(SMTP); await smtp.start();
  w = await makeWorld(8982, 2, { SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true", MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: "live", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: String(SMTP), MAIL_SMTP_SECURITY: "none", RESEND_COOLDOWN_SECONDS: "0", PUBLIC_APP_URL: "https://live.rolematch.invalid" });
}, 300000);
afterAll(async () => { await w?.stop(); await smtp?.stop(); }, 120000);

test("asking gives the same answer for a real and an unknown address, and only a real one gets mail", async () => {
  const before = Date.now(), real = await call("/api/auth/forgot", { email: w.users[1].email }, "10.91.0.2"), unknown = await call("/api/auth/forgot", { email: `nobody-${w.run}@example.test` }, "10.91.0.3");
  expect([real.status, unknown.status]).toEqual([202, 202]);
  expect(await real.json()).toEqual(await unknown.json());
  await codeFor(w.users[1].email, before);
  expect(smtp.messages.some((m) => m.to.includes(`nobody-${w.run}@example.test`))).toBe(false);
}, 60000);

test("a wrong code changes nothing; the right code changes the password once, ends old sessions, and the old password stops working", async () => {
  const u = w.users[0], before = Date.now();
  expect((await u.get("/api/auth/me")).status).toBe(200);
  expect((await call("/api/auth/forgot", { email: u.email }, "10.91.0.4")).status).toBe(202);
  const code = await codeFor(u.email, before);
  expect((await call("/api/auth/reset", { email: u.email, code: "000000", password: NEW }, "10.91.0.5")).status).toBe(401);
  expect((await call("/api/auth/reset", { email: u.email, code, password: "short" }, "10.91.0.5")).status).toBe(400);
  const together = await Promise.all([1, 2, 3].map(() => call("/api/auth/reset", { email: u.email, code, password: NEW }, "10.91.0.6")));
  expect(together.map((r) => r.status).sort()).toEqual([200, 401, 401]);
  expect((await u.get("/api/auth/me")).status).toBe(401);
  expect((await call("/api/auth/login", { email: u.email, password: NEW }, "10.91.0.7")).status).toBe(200);
  const old = await call("/api/auth/login", { email: u.email, password: "a-long-enough-password-1" }, "10.91.0.8");
  expect(old.status).toBe(401);
}, 90000);

test("a reset grants nothing by itself: no session cookie comes back, and the code never reaches a log or the audit trail", async () => {
  const u = w.users[1], before = Date.now();
  await sleep(1100);
  expect((await call("/api/auth/forgot", { email: u.email }, "10.91.0.9")).status).toBe(202);
  const code = await codeFor(u.email, before + 1000);
  const r = await call("/api/auth/reset", { email: u.email, code, password: NEW }, "10.91.0.10");
  expect(r.headers.getSetCookie()).toEqual([]);
  const trail = JSON.stringify(await w.admin.unsafe(`select detail from "${w.tdb.schema}".audit_events where action = 'auth.password_reset'`));
  expect(trail).not.toContain(code);
}, 60000);

// Independent security review, 23 Nov 2026: the count of wrong codes was read before a guess and written after it, so guesses sent together all passed
// the check before any was counted (some 64 a server instead of 5), enough over a day to find a 6-digit code and take the account. Each guess is now
// counted before it is checked.
test("twenty wrong codes sent at once from twenty addresses: five are checked, the rest refused, and the right code then waits out the lock too", async () => {
  const u = w.users[1], before = Date.now();
  expect((await call("/api/auth/forgot", { email: u.email }, "10.92.0.1")).status).toBe(202);
  const code = await codeFor(u.email, before), wrong = (i: number) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0");
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => call("/api/auth/reset", { email: u.email, code: wrong(i), password: NEW }, `10.93.0.${i + 1}`)));
  const statuses = burst.map((r) => r.status);
  expect(statuses.filter((s) => s === 401)).toHaveLength(5);
  expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  expect((await call("/api/auth/reset", { email: u.email, code, password: NEW }, "10.93.1.1")).status).toBe(429);
}, 90000);

test("twenty wrong passwords sent at once for one account: five are checked; a right password signs in without using up an attempt", async () => {
  const u = w.users[1];   // no wrong sign-in yet (users[0] has one, from the test above)
  const right = await call("/api/auth/login", { email: u.email, password: NEW }, "10.94.0.1");   // set by the third test; the burst above changed nothing
  expect(right.status).toBe(200);
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => call("/api/auth/login", { email: u.email, password: `wrong-password-${i}` }, `10.95.0.${i + 1}`)));
  const statuses = burst.map((r) => r.status);
  expect(statuses.filter((s) => s === 401)).toHaveLength(5);   // the right sign-in above took nothing from the five
  expect(statuses.filter((s) => s === 429)).toHaveLength(15);
}, 90000);

// Independent security review, 23 Nov 2026: after an hour idle the browser holds only the refresh cookie, and signing out then only cleared the cookies,
// so a copy of that refresh token kept the session alive until its eight hours were up. Signing out now ends the session on the server.
test("signing out with only the refresh cookie (an hour idle) ends the session: a copy of that cookie no longer works", async () => {
  const signIn = await call("/api/auth/login", { email: w.users[0].email, password: NEW }, "10.96.0.1");   // users[1] is locked by the burst above
  expect(signIn.status).toBe(200);
  const refresh = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("th_refresh="))!;
  expect(refresh).toBeTruthy();
  const out = await fetch(w.base + "/api/auth/logout", { method: "POST", headers: { origin: "http://localhost:5173", cookie: refresh, "x-forwarded-for": "10.96.0.2" } });
  expect(out.status).toBeLessThan(300);
  const again = await fetch(w.base + "/api/auth/me", { headers: { cookie: refresh, "x-forwarded-for": "10.96.0.3" } });
  expect(again.status).toBe(401);
}, 60000);
