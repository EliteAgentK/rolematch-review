// A sign-in lasts 8 hours from signing in, for everyone: the platform's rule, not an organisation's setting (owner, 16 Nov 2026).
// Here the test server shortens it to 18 seconds so the end can be watched. (It was 5.4 s, and failed when the requests before the end took longer than that: the
// test's own time budget, not the product, was too tight for the network.)
import { afterAll, beforeAll, expect, test } from "vitest";
import { signedInAtOf } from "../src/tokens";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const PORT = 8807, base = `http://localhost:${PORT}`, HOURS = 0.005;   // 18 seconds: every request crosses the internet to the database (0.3 to 3 s under load), so 5 s was not enough for the few requests the test makes before the end
let tdb: TestDb, server: Proc;
const run = crypto.randomUUID().slice(0, 8), EMAIL = `session-${run}@example.test`, PASSWORD = "session-length-password";

class Browser {
  jar = new Map<string, string>();
  async req(path: string, init: RequestInit = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173" } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    return res;
  }
  json = (path: string, body: unknown, method = "POST") => this.req(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SESSION_HOURS: String(HOURS) });
  await tdb.createUser("Session length", EMAIL, "Session Tester", PASSWORD);
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
}, 120000);
afterAll(async () => { server?.kill(); await tdb?.teardown(); }, 60000);

test("the sign-in time comes from the signed token and survives a refresh (amr), not from when the token was issued (iat)", () => {
  expect(signedInAtOf({ iat: 2000, amr: [{ method: "password", timestamp: 1000 }] })).toBe(1000);
  expect(signedInAtOf({ iat: 2000 })).toBe(2000);   // a token without amr: the issue time, never "no limit"
});

test("a session ends at its full length: the website is told why, every copy of the cookies stops working, and signing in again starts afresh", async () => {
  const me = new Browser();
  const login: any = await (await me.json("/api/auth/login", { email: EMAIL, password: PASSWORD })).json();
  const ends = Date.parse(login.session.endsAt);
  expect(ends - Date.now()).toBeGreaterThan(2000);
  expect(ends - Date.now()).toBeLessThanOrEqual(HOURS * 3_600_000);
  expect(login.session.warnMinutes).toBe(5);
  const copy = new Browser(); copy.jar = new Map(me.jar);
  expect((await me.req("/api/candidates")).status).toBe(200);
  const seen: any = await (await me.req("/api/auth/me")).json();
  expect(seen.session.endsAt).toBe(login.session.endsAt);   // the same end on every request, not pushed back by activity

  await sleep(Math.max(0, ends - Date.now()) + 300);
  const ended = await me.req("/api/candidates");
  expect(ended.status).toBe(401);
  expect(((await ended.json()) as any).error.code).toBe("AUTH-005");
  expect(me.jar.size).toBe(0);   // cookies cleared
  expect((await copy.req("/api/candidates")).status).toBe(401);   // signed out everywhere, not only in this browser

  const again: any = await (await me.json("/api/auth/login", { email: EMAIL, password: PASSWORD })).json();
  expect(Date.parse(again.session.endsAt)).toBeGreaterThan(ends);
  expect((await me.req("/api/candidates")).status).toBe(200);
}, 60000);

// One device at a time (owner, 16 Nov 2026): "you should only be allowed to be signed in on one device at a time." Signing in on a second device
// ends the first, on every server, and the first cannot get back in by refreshing; it is written to the person's activity.
test("signing in on a second device signs the first one out, refreshing cannot bring it back, and the new one carries on", async () => {
  const laptop = new Browser(), phone = new Browser();
  expect((await laptop.json("/api/auth/login", { email: EMAIL, password: PASSWORD })).status).toBe(200);
  expect((await laptop.req("/api/candidates")).status).toBe(200);
  expect((await phone.json("/api/auth/login", { email: EMAIL, password: PASSWORD })).status).toBe(200);
  expect((await laptop.req("/api/candidates")).status).toBe(401);
  laptop.jar.delete("th_access");                                   // only the refresh cookie left: asking for fresh tokens must not work either
  expect((await laptop.req("/api/candidates")).status).toBe(401);
  expect((await phone.req("/api/candidates")).status).toBe(200);
  const admin = (await import("postgres")).default(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [line] = await admin.unsafe(`select detail from "${tdb.schema}".audit_events where action = 'auth.other_sessions_ended' order by created_at desc limit 1`);
  await admin.end();
  expect(line?.detail?.count).toBeGreaterThanOrEqual(1);
}, 60000);

test("no organisation can change how long a sign-in lasts: it is the platform's rule, and Settings no longer offers it", async () => {
  const me = new Browser();
  const login: any = await (await me.json("/api/auth/login", { email: EMAIL, password: PASSWORD })).json();
  const current: any = await (await me.req("/api/settings")).json();
  expect(current.settings.access).toBeUndefined();
  expect(current.ceilings.sessionHours).toBeUndefined();
  const tried = await me.json("/api/settings", { version: current.version, access: { sessionHours: 12, warnMinutes: 30 } }, "PUT");
  expect(tried.status).toBe(200);
  expect(((await tried.json()) as any).settings.access).toBeUndefined();   // nothing to change: the attempt is dropped
  const now: any = await (await me.req("/api/auth/me")).json();
  expect(now.session).toEqual(login.session);   // the same end and the same 5-minute warning
});

test("the platform's length is 8 hours: a working day", async () => {
  const { config } = await import("../src/config");
  expect(process.env.SESSION_HOURS ?? "").toBe("");
  expect(config.sessionHours).toBe(8);
});
