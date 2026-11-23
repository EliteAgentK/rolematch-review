// The owner's console, first slice (docs/database/18_CONSOLE_V0.md), against a real database and the real console server.
// The database keeps one account and keeps the console out of everyone's data; sign-in locks after 5 wrong passwords even for the right one;
// sessions end when unused, at their limit and at sign-out; a change needs this console's origin and the session's form token; alerts fold and clear.
import { createHash } from "node:crypto";
import { request } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { hashPassword } from "../src/console/auth";
import { fakeServe, setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

const PORT = 8761, API = 8762, PROM = 8763, base = `http://127.0.0.1:${PORT}`, ORIGIN = base;
const EMAIL = "owner@example.test", PASSWORD = "a long console passphrase", SECOND = "father@example.test", PASSWORD2 = "another long console passphrase", ALERTS = "alerts@example.test";
let tdb: TestDb, server: Proc, db: postgres.Sql, api: ReturnType<typeof fakeServe>, prom: ReturnType<typeof fakeServe>;
const dir = mkdtempSync(join(tmpdir(), "console-")), HOST = join(dir, "host.json");
const hostFile = (over: Record<string, unknown> = {}) => writeFileSync(HOST, JSON.stringify({ at: Math.round(Date.now() / 1000), diskUsedPct: 41, liveBackupSec: 3600, liveBackupCollectedByMacSec: 1800,
  ownDatabase: { running: true, backups: { ok: true, lastBackupSec: 7200, lastBackupType: "diff", walMax: true }, macCopySec: 120, drill: { passed: true, seconds: 14, ageSec: 86400 } },
  containers: { api: true, worker: true, aiWorker: true, monitor: true, tunnel: true }, clockInSync: true, ...over }));

/** The code in the newest e-mail the console wrote (MAIL_TRANSPORT=preview writes each message to a file and sends nothing). */
const MAIL = join(dir, "emails"), mails = () => { try { return readdirSync(MAIL).map((f) => join(MAIL, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs); } catch { return []; } };
const lastCode = () => />(\d{6})</.exec(readFileSync(mails().at(-1)!, "utf8"))?.[1] ?? "";

class Browser {
  cookies = new Map<string, string>();
  get jar() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  get sid() { return this.cookies.get("rmc") ?? ""; }
  /** Each browser comes from its own address, as Cloudflare's tunnel reports it, so the per-address limits count each one apart. */
  ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}-${crypto.randomUUID().slice(0, 8)}`;
  async go(path: string, init: RequestInit & { origin?: string | null } = {}) {
    const h: Record<string, string> = { "cf-connecting-ip": this.ip, ...(init.headers as any) };
    if (this.jar) h.cookie = this.jar;
    if (init.method === "POST" && init.origin !== null) h.origin = init.origin ?? ORIGIN;
    const r = await fetch(base + path, { ...init, headers: h, redirect: "manual" });
    for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(";")[0].split("="); v ? this.cookies.set(k, v) : this.cookies.delete(k); }
    return r;
  }
  post = (path: string, fields: Record<string, string>, origin?: string | null) =>
    this.go(path, { method: "POST", origin, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  /** Both steps: the password, then the e-mailed code. */
  async signIn(email = EMAIL, password = PASSWORD) {
    const r = await this.post("/login", { email, password });
    return r.status === 303 && r.headers.get("location") === "/login/code" ? this.post("/login/code", { code: lastCode() }) : r;
  }
  token = async () => /name="t" value="([0-9a-f]{64})"/.exec(await (await this.go("/")).text())?.[1] ?? "";
}

beforeAll(async () => {
  hostFile();
  api = fakeServe({ port: API, fetch: () => Response.json({ state: "healthy", measuredAt: new Date().toISOString(), checks: { readiness: { state: "healthy", note: "ready" }, queue: { state: "healthy", note: "nothing waiting", queued: 0, oldestQueuedSec: 0 } } }) });
  await api.ready;
  // A stand-in for Prometheus on the PC (docs/ops/TRENDS_AND_LOAD.md): one trend warning firing; every series 1.5 with one moment missing in the middle;
  // the processors' query refused, so that one chart cannot be shown and the others still are.
  prom = fakeServe({ port: PROM, fetch: (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/api/v1/alerts") return Response.json({ status: "success", data: { alerts: [
      { state: "firing", activeAt: new Date().toISOString(), labels: { alertname: "DiskFilling", severity: "today" }, annotations: { title: "Disk filling soon", meaning: "Full within 14 days at this rate.", action: "Clear old backups." } },
      { state: "pending", labels: { alertname: "ErrorsRising", severity: "today" }, annotations: { title: "Errors rising soon" } }] } });
    if (u.searchParams.get("query")?.includes("node_cpu")) return Response.json({ status: "error", error: "query refused" }, { status: 400 });
    const start = Number(u.searchParams.get("start")), end = Number(u.searchParams.get("end")), step = Number(u.searchParams.get("step")), values: [number, string][] = [];
    for (let t = start, i = 0; t <= end; t += step, i++) values.push([t, i === Math.floor((end - start) / step / 2) ? "NaN" : "1.5"]);
    return Response.json({ status: "success", data: { resultType: "matrix", result: [{ metric: {}, values }] } });
  } });
  await prom.ready;
  tdb = await setupTestDb();
  db = postgres(process.env.DATABASE_URL!, { max: 2, connection: { search_path: tdb.schema }, onnotice: () => {} });
  server = spawnProc(["tsx", "src/console/server.ts"], { env: { ...tdb.env, CONSOLE_PORT: String(PORT), PORT: String(API), DB_POOL_SIZE: "2" /* as live (deploy/limits.sh DB_POOL_CONSOLE) */, OPS_TOKEN: "t".repeat(40), CONSOLE_HOST_STATUS: HOST, DATA_DIR: dir, MAIL_TRANSPORT: "preview", MAIL_SEND_MODE: "allowlist", MAIL_ALLOWED_RECIPIENTS: `${EMAIL},${SECOND},${ALERTS}`, OPS_ALERT_TO: ALERTS, PROMETHEUS_URL: `http://127.0.0.1:${PROM}` }, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/healthz")).ok) break; } catch {} await sleep(100); }
}, 120_000);
afterAll(async () => { server?.kill(); await server?.exited; await db?.end(); await api?.stop(); await prom?.stop(); await tdb?.teardown(); });

test("the database holds two owner accounts at most, each e-mail once, and the console role cannot read anyone's data", async () => {
  // Owner, 12 Nov 2026: "It should always just be me and my dad" (migration 052).
  await db`insert into console_owner (slot, email, password_hash, set_by) values (1, ${EMAIL}, ${await hashPassword(PASSWORD)}, 'test')`;
  await db`insert into console_owner (slot, email, password_hash, set_by) values (2, ${SECOND}, ${await hashPassword(PASSWORD2)}, 'test')`;
  await expect(db`insert into console_owner (slot, email, password_hash, set_by) values (3, 'c@example.test', '$argon2id$x', 'test')`).rejects.toThrow(/check/);
  await expect(db`insert into console_owner (slot, email, password_hash, set_by) values (2, 'c@example.test', '$argon2id$x', 'test')`).rejects.toThrow(/duplicate key/);
  await expect(db.begin(async (q) => { await q`delete from console_owner where slot = 2`; await q`insert into console_owner (slot, email, password_hash, set_by) values (2, ${EMAIL}, '$argon2id$x', 'test')`; })).rejects.toThrow(/duplicate key/);
  await expect(db.begin(async (q) => { await q`set local role rolematch_console`; return q`select count(*) from candidates`; })).rejects.toThrow(/permission denied/);
  await expect(db.begin(async (q) => { await q`set local role rolematch_console`; return q`select count(*) from documents`; })).rejects.toThrow(/permission denied/);
  const [{ o }] = await db.begin(async (q) => { await q`set local role rolematch_console`; return q`select console_overview() as o`; });
  for (const [k, v] of Object.entries(o)) if (k !== "at") expect(typeof v, k).toBe("number");
  // The tenant role sees none of the console's rows, even with an organisation named.
  const seen = await db.begin(async (q) => { await q`select set_config('role', 'rolematch_tenant', true), set_config('app.org_id', ${crypto.randomUUID()}, true)`; return q`select count(*)::int as n from console_owner`; }).catch((e) => e);
  expect(seen instanceof Error ? /permission denied/.test(seen.message) : seen[0].n === 0).toBe(true);
});

test("a change from another site is refused, signed in or not", async () => {
  const b = new Browser();
  expect((await b.post("/login", { email: EMAIL, password: PASSWORD }, "https://evil.example")).status).toBe(403);
  expect((await b.post("/login", { email: EMAIL, password: PASSWORD }, null)).status).toBe(403);
  expect((await b.post("/login", { email: EMAIL, password: PASSWORD }, "null")).status).toBe(403);   // what a browser sends when it hides the origin
  expect(b.jar).toBe("");
});

test("flooding is refused at the door: a visitor with no session or a made-up one is sent to sign-in, and one address gets 10 sign-in forms and 240 requests a minute", async () => {
  // Owner, 12 Nov 2026: "no entries, no flooding, rate limits necessary".
  // The limits count each calendar minute (server.ts tooFast), so the counting below starts early in one: begun late, a busy machine could carry it
  // into the next minute, where the count rightly starts again and too few are refused (seen in a full run, 23 Nov 2026).
  const intoMinute = Date.now() % 60_000; if (intoMinute > 15_000) await sleep(60_000 - intoMinute + 200);
  const v = new Browser();
  for (const path of ["/", "/portals", "/people", "/ai"]) { const r = await v.go(path); expect(r.status).toBe(303); expect(r.headers.get("location")).toBe("/login"); }
  v.cookies.set("rmc", "not-a-session"); expect((await v.go("/portals")).headers.get("location")).toBe("/login");
  expect((await v.post("/logout", {})).status).toBe(401);
  const s = new Browser();
  // Forms from another site are refused (403) without touching the database, but still count: the limit comes first.
  for (let i = 0; i < 10; i++) expect((await s.post("/login", { email: EMAIL, password: "x" }, "https://evil.example")).status).toBe(403);
  const r = await s.post("/login", { email: EMAIL, password: PASSWORD });
  expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("60"); expect(await r.text()).toContain("Too many requests from this address");
  const f = new Browser(); let refused = 0;
  for (let i = 0; i < 260; i++) if ((await f.go("/login")).status === 429) refused++;
  expect(refused).toBeGreaterThanOrEqual(19);
  expect((await new Browser().go("/login")).status).toBe(200);   // another address is not held back
  expect((await fetch(base + "/healthz", { headers: { "cf-connecting-ip": f.ip } })).status).toBe(200);   // the health check is never limited
});

test("the second account signs in with its own password and its own code; the first's password does not open it", async () => {
  const b = new Browser();
  expect((await b.post("/login", { email: SECOND, password: PASSWORD })).status).toBe(401);
  await db`delete from rate_limits`;
  const r = await b.post("/login", { email: SECOND, password: PASSWORD2 });
  expect(r.headers.get("location")).toBe("/login/code");
  expect((await b.post("/login/code", { code: lastCode() })).status).toBe(303);
  const [s] = await db`select owner_email from console_sessions where ended_at is null order by started_at desc limit 1`;
  expect(s.owner_email).toBe(SECOND);
  await db`update console_sessions set ended_at = now() where owner_email = ${SECOND}`;
  // An address that is no account is refused the same way as a wrong password.
  expect((await new Browser().post("/login", { email: "nobody@example.test", password: PASSWORD })).status).toBe(401);
  await db`delete from rate_limits`;
});

test("five wrong passwords lock that account, even with the right password, and the owner is told; the other account can still sign in", async () => {
  const b = new Browser();
  for (let i = 0; i < 5; i++) expect((await b.post("/login", { email: EMAIL, password: `wrong password ${i}` })).status).toBe(401);
  const r = await b.post("/login", { email: EMAIL, password: PASSWORD });
  expect(r.status).toBe(429);
  expect(await r.text()).toMatch(/paused for about \d+ minutes/);
  expect(b.jar).toBe("");
  const [e] = await db`select severity, times from owner_events where fingerprint = 'console:locked' and cleared_at is null`;
  expect(e.severity).toBe("urgent");
  expect((await new Browser().post("/login", { email: SECOND, password: PASSWORD2 })).headers.get("location")).toBe("/login/code");
  await db`delete from rate_limits`;   // the lock's 15 minutes, passed
});

test("signing in gives a session the database knows only by its hash; Today shows health with no personal data", async () => {
  const b = new Browser();
  expect((await b.go("/")).headers.get("location")).toBe("/login");
  const r = await b.signIn(EMAIL.toUpperCase());
  expect(r.status).toBe(303);
  const sid = b.sid;
  expect(sid.length).toBeGreaterThan(40);
  const rows = await db`select id_hash from console_sessions where ended_at is null`;
  expect(rows.length).toBe(1);
  expect(JSON.stringify(rows)).not.toContain(sid);
  const today = await b.go("/");
  expect(today.status).toBe(200);
  // same-origin, not no-referrer: a real browser sends "Origin: null" on a form under no-referrer, and the console then refused the owner's every sign-in (R163).
  for (const [h, v] of [["cache-control", "no-store, no-transform"], ["x-frame-options", "DENY"], ["referrer-policy", "same-origin"]]) expect(today.headers.get(h)).toBe(v);
  expect(today.headers.get("content-security-policy")).toMatch(/default-src 'none'.*frame-ancestors 'none'/);
  const html = await today.text();
  expect(html).toContain("Live health");
  expect(html).toMatch(/Own database backups/);
  expect(html).toContain("on the Mac");
  expect(html).not.toContain(EMAIL);
  expect(html).not.toMatch(/<script/i);
});

test("a source that cannot be read says unknown and why, and an old one is not trusted", async () => {
  const b = new Browser();
  await b.signIn();
  hostFile({ at: Math.round(Date.now() / 1000) - 600 });
  let html = await (await b.go("/")).text();
  expect(html).toMatch(/Some of it cannot be seen|need/);
  expect(html).toMatch(/the PC&#39;s status is 10 min ago/);
  hostFile();
});

test("a session ends after 15 minutes unused, at its 8-hour limit, and at sign-out, and the record says so", async () => {
  const b = new Browser(), mine: string[] = [];
  const signIn = async () => { await b.signIn(); const h = createHash("sha256").update(b.sid).digest("hex"); mine.push(h); return h; };
  let h = await signIn();
  expect((await b.go("/")).status).toBe(200);
  await db`update console_sessions set last_used_at = now() - interval '16 minutes' where id_hash = ${h}`;
  expect((await b.go("/")).headers.get("location")).toBe("/login");
  h = await signIn();
  await db`update console_sessions set ends_at = now() - interval '1 second' where id_hash = ${h}`;
  expect((await b.go("/")).headers.get("location")).toBe("/login");
  await signIn();
  const t = await b.token();
  expect((await b.post("/logout", { t })).headers.get("location")).toBe("/login?ended");
  const rows = await db`select ended_at from console_sessions where id_hash in ${db(mine)}`;
  expect(rows.length).toBe(3);
  expect(rows.every((r) => r.ended_at !== null)).toBe(true);
});

test("a page reloading itself does not keep the session alive: left open and unused, it still ends after 15 minutes (code review, 16 Nov 2026, D-M2)", async () => {
  await db`delete from rate_limits`;
  const b = new Browser();
  await b.signIn();
  const h = createHash("sha256").update(b.sid).digest("hex");
  // What a browser sends when the page's own refresh reloads it (no person did anything), and when the person opens a page. Sent with node:http, since
  // fetch replaces any Sec-Fetch-Mode it is given with its own ("cors").
  const itself = { "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin", "sec-fetch-dest": "document" }, person = { ...itself, "sec-fetch-user": "?1" };
  const load = (path: string, headers: Record<string, string>) => new Promise<{ status: number; location: string | null }>((ok, no) => {
    const r = request(base + path, { headers: { ...headers, "cf-connecting-ip": b.ip, cookie: b.jar } }, (res) => { res.resume(); ok({ status: res.statusCode ?? 0, location: (res.headers.location as string) ?? null }); });
    r.on("error", no); r.end();
  });
  await db`update console_sessions set last_used_at = now() - interval '14 minutes' where id_hash = ${h}`;
  for (const path of ["/", "/portals"]) expect((await load(path, itself)).status).toBe(200);   // still signed in: 14 minutes is within the limit
  const [s] = await db`select extract(epoch from now() - last_used_at)::int as idle from console_sessions where id_hash = ${h}`;
  expect(s.idle).toBeGreaterThanOrEqual(14 * 60 - 5);   // the reloads did not count as use
  await db`update console_sessions set last_used_at = now() - interval '16 minutes' where id_hash = ${h}`;
  expect((await load("/", itself)).location).toBe("/login");
  // what the person does still counts
  await b.signIn();
  const h2 = createHash("sha256").update(b.sid).digest("hex");
  await db`update console_sessions set last_used_at = now() - interval '14 minutes' where id_hash = ${h2}`;
  expect((await load("/people", person)).status).toBe(200);
  expect((await db`select extract(epoch from now() - last_used_at)::int as idle from console_sessions where id_hash = ${h2}`)[0].idle).toBeLessThan(60);
  await db`update console_sessions set ended_at = now() where id_hash = ${h2}`;
});

test("alerts fold repeats into one, need the form token to change, and clear back to normal", async () => {
  await db`insert into owner_events (fingerprint, severity, source, title) values ('test:queue', 'today', 'monitor', 'CVs are waiting longer than they should')`;
  await db`insert into owner_events (fingerprint, severity, source, title) values ('test:queue', 'today', 'monitor', 'CVs are waiting longer than they should')
    on conflict (fingerprint) where cleared_at is null do update set times = owner_events.times + 1`;
  const [e] = await db`select id, times from owner_events where fingerprint = 'test:queue'`;
  expect(e.times).toBe(2);
  const b = new Browser();
  await b.signIn();
  expect(await (await b.go("/alerts")).text()).toMatch(/CVs are waiting longer than they should <b>×2<\/b>/);
  expect((await b.post(`/alerts/${e.id}/ack`, { t: "0".repeat(64) })).status).toBe(403);
  expect((await b.post(`/alerts/${e.id}/ack`, { t: await b.token() }, "https://evil.example")).status).toBe(403);
  expect((await b.post(`/alerts/${e.id}/ack`, { t: await b.token() })).status).toBe(303);
  expect((await db`select acknowledged_at from owner_events where id = ${e.id}`)[0].acknowledged_at).not.toBeNull();
  await b.post(`/alerts/${e.id}/mute`, { t: await b.token(), minutes: "60" });
  expect((await db`select muted_until > now() + interval '59 minutes' as m from owner_events where id = ${e.id}`)[0].m).toBe(true);
  await db`update owner_events set cleared_at = now() where id = ${e.id}`;
  expect(await (await b.go(`/alerts/${e.id}`)).text()).toContain("back to normal");
});

test("the right password alone gives no session: the code e-mailed to the owner's own address does, once, in the same browser", async () => {
  await db`delete from rate_limits`;
  const b = new Browser(), before = mails().length;
  const r = await b.post("/login", { email: EMAIL, password: PASSWORD });
  expect(r.headers.get("location")).toBe("/login/code");
  expect(b.sid).toBe("");
  expect((await b.go("/")).headers.get("location")).toBe("/login");
  expect(mails().length).toBe(before + 1);
  const mail = readFileSync(mails().at(-1)!, "utf8"), code = lastCode();
  expect(code).toMatch(/^\d{6}$/);
  // Stored only as hashes: neither the code nor the browser's pending token is in the table.
  const rows = await db`select pending_hash, code_hash from console_codes where used_at is null and owner_email = ${EMAIL}`;   // each account its own codes
  expect(rows.length).toBe(1);
  expect(JSON.stringify(rows)).not.toContain(code);
  expect(JSON.stringify(rows)).not.toContain(b.cookies.get("rmp")!);
  // Another browser with its own pending token cannot use this code.
  const other = new Browser(); other.cookies.set("rmp", "x".repeat(43));
  expect((await other.post("/login/code", { code })).status).toBe(401);
  // A second sign-in within the minute while this code is unused sends no other mail.
  expect((await new Browser().post("/login", { email: EMAIL, password: PASSWORD })).status).toBe(429);
  expect(mails().length).toBe(before + 1);
  expect(mail).not.toContain("x".repeat(43));
  const ok = await b.post("/login/code", { code });
  expect(ok.headers.get("location")).toBe("/");
  expect(b.sid.length).toBeGreaterThan(40);
  expect(b.cookies.has("rmp")).toBe(false);
  expect((await b.go("/")).status).toBe(200);
  // Used once.
  const again = new Browser(); again.cookies.set("rmp", "y".repeat(43));
  expect((await again.post("/login/code", { code })).status).toBe(401);
  await db`delete from rate_limits`;
});

test("an old code is refused, and wrong codes lock sign-in like wrong passwords", async () => {
  await db`delete from rate_limits`;
  await db`update console_codes set used_at = now() where used_at is null`;   // the previous test's code, still waiting
  const b = new Browser();
  await b.post("/login", { email: EMAIL, password: PASSWORD });
  const code = lastCode();
  await db`update console_codes set issued_at = now() - interval '11 minutes' where used_at is null`;
  expect((await b.post("/login/code", { code })).status).toBe(401);
  await b.post("/login", { email: EMAIL, password: PASSWORD });
  const fresh = lastCode(), wrong = fresh === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) expect((await b.post("/login/code", { code: wrong })).status).toBe(i < 3 ? 401 : 429);   // the old code was the first failure, so the fourth wrong one locks
  expect((await b.post("/login/code", { code: fresh })).status).toBe(429);   // the right code is refused while locked
  expect((await db`select count(*)::int as n from owner_events where fingerprint = 'console:locked' and cleared_at is null`)[0].n).toBe(1);
  expect(b.sid).toBe("");
  await db`delete from rate_limits`;
});

test("made-up addresses cannot make the console send alert after alert: at most one per lock period for them, and the alert says no account is locked (code review, 16 Nov 2026, D-M1)", async () => {
  await db`delete from rate_limits`;
  await db`update owner_events set cleared_at = now() where cleared_at is null and fingerprint like 'console:%'`;
  const alerts = () => mails().filter((f) => readFileSync(f, "utf8").includes("by the RoleMatch console")).length, before = alerts();
  // Five wrong passwords for each of four addresses that are no account, each from its own address, and five codes with no password step behind them.
  for (let n = 0; n < 4; n++) { const b = new Browser(); for (let i = 0; i < 5; i++) expect((await b.post("/login", { email: `nobody${n}@example.test`, password: "wrong password here" })).status).toBe(401); }
  const c = new Browser(); for (let i = 0; i < 5; i++) await c.post("/login/code", { code: "123456" });
  expect(alerts() - before).toBe(1);   // one e-mail for all of them in the lock period, not one per address
  const [e] = await db`select severity, title, meaning, times from owner_events where fingerprint = 'console:guessing' and cleared_at is null`;
  expect(e.times).toBe(1);
  expect(`${e.title} ${e.meaning}`).toMatch(/not a console account/); expect(e.meaning).not.toMatch(/even with the right password/);
  // A real account locking is still told at once, whatever was sent about made-up ones.
  const b = new Browser(); for (let i = 0; i < 5; i++) await b.post("/login", { email: EMAIL, password: `wrong password ${i}` });
  expect(alerts() - before).toBe(2);
  expect((await db`select count(*)::int as n from owner_events where fingerprint = 'console:locked' and cleared_at is null`)[0].n).toBe(1);
  await db`delete from rate_limits`;
});

test("the Database page shows the database's health in plain words, says whose database it is, and holds no script or personal data", async () => {
  await db`delete from rate_limits`;
  await db`update console_codes set used_at = now() where used_at is null`;   // the previous test's code, still waiting: a new one would rightly be refused within the minute
  const b = new Browser();
  await b.signIn();
  const r = await b.go("/database");
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store, no-transform");
  const html = await r.text();
  for (const s of ["Database", "Connections in use", "Largest tables", "Changes applied"]) expect(html).toContain(s);
  expect(html).toMatch(/Live(?:&#39;|')s data is on: <b>[^<]+<\/b>/);   // the page's own words, its apostrophe as written
  expect(html).toMatch(/aria-current="page" title="Database"><i aria-hidden="true"><svg[\s\S]*?<\/i><span>Database<\/span>/);   // the rail marks where you are
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toContain(EMAIL);
  expect((await new Browser().go("/database")).headers.get("location")).toBe("/login");
});

test("every page of the console opens signed in, in one look, with no script; only People and Portals name people, and nothing anywhere shows a password or a code", async () => {
  // Owner, 11 Nov 2026: "everything about my platform must be within this console" ... "it must look really nice" (docs/database/22_CONSOLE_LOOK.md).
  await db`delete from rate_limits`;
  await db`update console_codes set used_at = now() where used_at is null`;
  const b = new Browser();
  await b.signIn();
  const pages: Record<string, string[]> = { "/": ["Your platform, at a glance", "Live health", "Activity"], "/organisations": ["Every organisation"], "/activity": ["CVs read", "Matches", "AI spend"],
    "/people": ["Every account", "Accounts"], "/ai": ["By purpose", "By organisation", "By model"], "/schema": ["Guarded by row security", "candidates"], "/backups": ["Copies"], "/alerts": ["Alerts"], "/portals": ["Every portal", "Who runs each portal"], "/trends": ["How fast pages answer", "Warnings", "Disk filling soon"] };
  for (const [path, words] of Object.entries(pages)) {
    const r = await b.go(path); expect(r.status, path).toBe(200);
    const html = await r.text();
    for (const w of words) expect(html, `${path}: ${w}`).toContain(w);
    expect(html, path).not.toMatch(/<script/i);
    if (path !== "/schema") expect(html, path).not.toMatch(/password_hash|encrypted_password|code_hash/i);   // the Schema page names those columns; no page shows what is in them
    expect(html, path).not.toMatch(/\$argon2|\$2[aby]\$/);   // never a password hash itself
    if (path !== "/people" && path !== "/portals") expect(html, path).not.toContain(EMAIL);   // People names everyone; Portals names each portal's administrators
    expect(html, path).toMatch(/\/console\.css\?v=[0-9a-f]{10}/);   // the stylesheet by its fingerprint, so a release's look arrives at once
  }
  for (const path of Object.keys(pages)) expect((await new Browser().go(path)).headers.get("location"), path).toBe("/login");
});

test("past 1,000 accounts the owner can still open and act on anyone, and page through everyone, most recently active first (code review, 16 Nov 2026, D-M3)", async () => {
  await db`delete from rate_limits`;
  // 1,100 accounts in one company, made here without sign-in accounts: the link to the sign-in service's users is set aside in this throw-away schema only.
  await db.unsafe(`alter table members drop constraint if exists members_user_id_fkey`);
  const [org] = await db`insert into orgs (name) values ('Paging Company') returning id`;
  await db`insert into members (user_id, org_id, name, role, created_at) select gen_random_uuid(), ${org.id}, 'Paged Person ' || lpad(i::text, 4, '0'), 'recruiter', now() - i * interval '1 minute' from generate_series(1, 1100) i`;
  try {
    const all = (await db`select user_id from members where org_id = ${org.id}`).map((r: any) => r.user_id as string);
    const b = new Browser();
    await b.signIn();
    await sleep(9500);   // the People summary the test before read is kept for 9 seconds (trip.ts)
    // Every one of them can be opened, including whoever the old list of 1,000 left out.
    const listed = new Set<string>();
    for (let page = 1; page <= 4; page++) {
      const html = await (await b.go(`/people?page=${page}`)).text();
      for (const m of html.matchAll(/href="\/people\/([0-9a-f-]{36})"/g)) listed.add(m[1]);
    }
    expect(all.every((id) => listed.has(id))).toBe(true);
    const last = all.at(-1)!, first = await (await b.go(`/people?page=1`)).text();
    expect(first).toMatch(/Paged Person 0001/);                      // the newest first (none has been active, so by when they joined)
    expect(first).not.toMatch(/Paged Person 1100/);
    expect(first).toMatch(/href="\/people\?page=2"/);                 // and a way on to the rest
    expect((await b.go(`/people/${last}`)).status).toBe(200);
    const t = await b.token();
    const out = await b.post(`/people/${last}/signout`, { t });
    expect(out.status).toBe(303); expect(out.headers.get("location")).toMatch(new RegExp(`^/people/${last}\\?done=signout`));
  } finally {
    await db`delete from members where org_id = ${org.id}`; await db`delete from orgs where id = ${org.id}`;
    await db.unsafe(`alter table members add constraint members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade`);
  }
}, 120_000);

test("Trends: firing warnings only, each chart a line broken where a number is missing (never drawn as zero), one refused chart unknown while the rest show", async () => {
  await db`delete from rate_limits`;
  await db`update console_codes set used_at = now() where used_at is null`;
  const b = new Browser();
  await b.signIn();
  for (const r of ["24h", "7d", "30d", "90d"]) {
    const res = await b.go(`/trends?r=${r}`); expect(res.status, r).toBe(200);
    const html = await res.text();
    expect(html, r).toContain("Disk filling soon");
    expect(html, r).not.toContain("Errors rising soon");   // pending: not yet for long enough to count
    expect(html, r).toContain(`href="?r=${r}" aria-current="true"`);
    const speed = /aria-label="How fast pages answer"[\s\S]*?<\/section>/.exec(html)![0];
    expect(speed.match(/<polyline /g)?.length, r).toBe(2);   // one line before the missing moment, one after
    expect(speed).toContain("1.5 s");
    expect(html, r).toMatch(/aria-label="The PC(?:&#39;|')s processors"[\s\S]*?Cannot be shown just now: query refused/);
    expect(html, r).not.toMatch(/<script/i);
  }
  expect((await b.go("/trends?r=forever")).status).toBe(200);   // an unknown period is the default one
});
