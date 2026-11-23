import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { adminDeleteUser } from "../src/supabase";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

// ---------------------------------------------------------------- the limiter itself (memory tiers)
describe("the limiter", () => {
  let rl: typeof import("../src/ratelimit");
  beforeAll(async () => { process.env.RATE_MAX_KEYS = "500"; rl = await import("../src/ratelimit"); });
  afterAll(() => vi.useRealTimers());

  test("allows exactly the limit, then says no with a retry time; other keys are unaffected", async () => {
    const key = "u-" + crypto.randomUUID();
    for (let i = 0; i < 40; i++) expect((await rl.consume("upload", key)).allowed).toBe(true);
    const over = await rl.consume("upload", key);
    expect(over.allowed).toBe(false); expect(over.retryAfterSec).toBeGreaterThan(0); expect(over.retryAfterSec).toBeLessThanOrEqual(60);
    expect((await rl.consume("upload", "someone-else")).allowed).toBe(true);
  });

  test("a burst at the end of one window does not get a fresh allowance at the start of the next", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const key = "edge-" + crypto.randomUUID();
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
    vi.setSystemTime(windowStart - 1000);                              // one second before the minute turns
    for (let i = 0; i < 40; i++) await rl.consume("upload", key);
    vi.setSystemTime(windowStart + 1000);                              // one second into the next minute
    let extra = 0; for (let i = 0; i < 10; i++) if ((await rl.consume("upload", key)).allowed) extra++;
    expect(extra).toBeLessThanOrEqual(1);                              // a plain per-minute counter would allow all 10 (and 40) here
    vi.setSystemTime(windowStart + 61_000);                            // two minutes on: forgotten
    expect((await rl.consume("upload", key)).allowed).toBe(true);
    vi.useRealTimers();
  });

  test("worst case: traffic bunched at both edges of a minute never gets more than about twice the limit through in one trailing minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const key = "worst-" + crypto.randomUUID(), edge = Math.floor(Date.now() / 60_000) * 60_000 + 120_000;
    let allowed = 0;
    vi.setSystemTime(edge - 100); for (let i = 0; i < 100; i++) if ((await rl.consume("upload", key)).allowed) allowed++;   // right before the edge
    vi.setSystemTime(edge + 30_000); for (let i = 0; i < 100; i++) if ((await rl.consume("upload", key)).allowed) allowed++; // half a minute later
    vi.useRealTimers();
    expect(allowed).toBeGreaterThanOrEqual(40); expect(allowed).toBeLessThanOrEqual(80);   // limit 40: documented bound is 2x, only in this adversarial pattern
  });

  test("flooding it with made-up keys cannot make it grow without bound", async () => {
    for (let i = 0; i < 3000; i++) await rl.consume("static", `10.0.${i >> 8}.${i & 255}-${i}`);
    const stats = rl.memoryStats();
    expect(stats.keys).toBeLessThanOrEqual(500);
    expect(stats.evictions).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- the running server
const PORT_A = 8794, PORT_B = 8793;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, A: Proc, B: Proc, admin: postgres.Sql;
const base = (p: number) => `http://localhost:${p}`;
const OVERRIDES = JSON.stringify({ login_pair: 2, login_email: 3, login_ip: 6, signup_email: 2, signup_ip: 4, resend_email: 2, verify_email: 3, user: 40, upload: 3, match: 2, static: 12 });

async function boot(port: number, trust: boolean) {
  const p = spawnProc(["tsx", "src/index.ts"], { env: { ...tdb.env, PORT: String(port), TRUST_PROXY: String(trust), RATE_OVERRIDES: OVERRIDES, SIGNUP_REQUIRE_CODE: "false" }, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base(port) + "/api/health")).ok) break; } catch {} await sleep(100); }
  return p;
}
const post = (port: number, path: string, body: unknown, ip: string, cookie = "") => fetch(base(port) + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
/** The ordinary (memory) limits count per calendar minute, blended with the previous one. To assert an exact number, start a test early in a minute so it cannot straddle the edge. */
async function earlyInMinute(secondsNeeded: number) {
  const left = 60 - (Date.now() % 60_000) / 1000;
  if (left < secondsNeeded) await sleep((left + 0.2) * 1000);
}
const login = (port: number, email: string, ip: string) => post(port, "/api/auth/login", { email, password: "definitely-wrong-password" }, ip);

beforeAll(async () => {
  tdb = await setupTestDb({});
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  [A, B] = [await boot(PORT_A, true), await boot(PORT_B, false)];
}, 180000);
afterAll(async () => {
  A?.kill(); B?.kill(); await admin?.end(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'rl-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

describe("sign-in is hard to guess at", () => {
  test("one address trying one account is stopped after a couple of wrong passwords, with a retry time", async () => {
    const email = `rl-${run}-pair@example.test`;
    expect((await login(PORT_B, email, "9.9.9.9")).status).toBe(401);
    expect((await login(PORT_B, email, "9.9.9.9")).status).toBe(401);
    const blocked = await login(PORT_B, email, "9.9.9.9");
    expect(blocked.status).toBe(429);
    const wait = Number(blocked.headers.get("retry-after"));   // the real time left, not a fixed 900
    expect(wait).toBeGreaterThan(14 * 60); expect(wait).toBeLessThanOrEqual(15 * 60);
    expect(((await blocked.json()) as any).error.message).toBe("Too many failed sign-in attempts. Try again in 15 minutes.");
  });

  test("a faked X-Forwarded-For does not help when the server does not trust proxies", async () => {
    const email = `rl-${run}-spoof@example.test`;
    expect((await login(PORT_B, email, "1.1.1.1")).status).toBe(401);
    expect((await login(PORT_B, email, "2.2.2.2")).status).toBe(401);   // a different claimed address, same real one
    expect((await login(PORT_B, email, "3.3.3.3")).status).toBe(429);
  });

  test("guessing one account from many addresses is stopped too (spread-out attack)", async () => {
    const email = `rl-${run}-spread@example.test`;
    for (const ip of ["20.0.0.1", "20.0.0.2", "20.0.0.3"]) expect((await login(PORT_A, email, ip)).status).toBe(401); // each address is new, so the per-address limit never triggers
    expect((await login(PORT_A, email, "20.0.0.4")).status).toBe(429);   // but the account itself is now protected
    expect((await login(PORT_A, `rl-${run}-other@example.test`, "20.0.0.4")).status).toBe(401); // other accounts are not affected
  });

  test("one address trying many accounts is stopped (credential stuffing)", async () => {
    let blockedAt = 0;
    for (let i = 1; i <= 10; i++) { const r = await login(PORT_A, `rl-${run}-stuff${i}@example.test`, "30.0.0.1"); if (r.status === 429) { blockedAt = i; break; } }
    expect(blockedAt).toBe(7);                                                  // six failures allowed, the seventh is refused
  });

  test("the limits hold across servers: failures on one count on the other", async () => {
    const email = `rl-${run}-shared@example.test`;
    expect((await login(PORT_A, email, "40.0.0.1")).status).toBe(401);
    expect((await login(PORT_A, email, "40.0.0.2")).status).toBe(401);
    expect((await login(PORT_B, email, "irrelevant")).status).toBe(401);       // third failure, on the other server
    expect((await login(PORT_A, email, "40.0.0.3")).status).toBe(429);          // the first server already knows
  });

  test("no e-mail address or IP is stored in clear in the shared counters", async () => {
    const rows = await admin.unsafe(`select key from "${tdb.schema}".rate_limits`);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.key).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("sign-up cannot be used to flood someone's inbox", () => {
  test("the same address can be tried only a couple of times", async () => {
    const good = { name: "Rate Tester", orgName: `Rate Org ${run}`, email: `rl-${run}-su@example.test`, password: "a-long-enough-password-1" };
    expect((await post(PORT_A, "/api/auth/signup", good, "50.0.0.1")).status).toBe(200);   // created (test mode)
    expect((await post(PORT_A, "/api/auth/signup", good, "50.0.0.2")).status).toBe(409);   // already exists
    const third = await post(PORT_A, "/api/auth/signup", good, "50.0.0.3");
    expect(third.status).toBe(429); expect(third.headers.get("retry-after")).toBeTruthy();
  });
  test("resending a code is capped per address", async () => {
    const email = `rl-${run}-resend@example.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) { statuses.push((await post(PORT_A, "/api/auth/resend", { email }, `60.0.0.${i}`)).status); await sleep(30); }
    expect(statuses).toContain(429);
  });
  test("wrong codes are limited per address", async () => {
    const email = `rl-${run}-code@example.test`;
    const s: number[] = [];
    for (let i = 0; i < 5; i++) s.push((await post(PORT_A, "/api/auth/verify", { email, code: "00000000" }, `70.0.0.${i}`)).status);
    expect(s.slice(0, 3)).toEqual([401, 401, 401]);
    // after the limit the person is told so, with the real wait, instead of "incorrect" (which invites another guess); the code is not checked
    const fourth = await post(PORT_A, "/api/auth/verify", { email, code: "00000000" }, "70.0.0.9");
    expect(s[3]).toBe(429); expect(fourth.status).toBe(429);
    const wait = Number(fourth.headers.get("retry-after")); expect(wait).toBeGreaterThan(0); expect(wait).toBeLessThanOrEqual(15 * 60);
    expect(((await fourth.json()) as any).error.message).toMatch(/^Too many incorrect codes\. Try again in (about a minute|\d+ minutes)\.$/);
  });
  test("opening invalid invitation links is limited per sender: five failures in 15 minutes, then refused with the real wait (no override: the owner's rule)", async () => {
    const s: number[] = [];
    for (let i = 0; i < 6; i++) s.push((await post(PORT_A, "/api/auth/invitation", { token: `not-a-real-token-${run}-${i}` }, "80.0.0.1")).status);
    expect(s).toEqual([404, 404, 404, 404, 404, 429]);
    expect((await post(PORT_A, "/api/auth/invitation", { token: `not-a-real-token-${run}-x` }, "80.0.0.2")).status).toBe(404);   // another sender is unaffected
  });
});

describe("signed-in use", () => {
  async function user(tag: string) {
    const res = await post(PORT_A, "/api/auth/signup", { name: `U ${tag}`, orgName: `Rate ${tag} ${run}`, email: `rl-${run}-${tag}@example.test`, password: "a-long-enough-password-1" }, `80.0.${tag.length}.${Math.floor(Math.random() * 200)}`);
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  }
  const upload = (cookie: string) => { const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([new Uint8Array(40)], "x.bin")); return fetch(base(PORT_A) + "/api/documents", { method: "POST", headers: { cookie, origin: "http://localhost:5173" }, body: f }); };

  test("one user hammering uploads is slowed down without affecting another user", async () => {
    const [u1, u2] = [await user("u1"), await user("u2")];
    await earlyInMinute(15);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await upload(u1)).status);
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);               // the limit here is 3 a minute: these are let through (the junk file itself is then rejected on its merits)
    expect(codes.slice(3)).toEqual([429, 429, 429, 429, 429]);                  // and every attempt after that is refused
    const other = await upload(u2);
    expect(other.status).not.toBe(429);                                         // a different user is untouched
    const refused = await upload(u1);
    expect(refused.status).toBe(429); expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("matching is limited per user", async () => {
    const u = await user("m1");
    await earlyInMinute(10);
    const hit = () => fetch(base(PORT_A) + "/api/matches", { method: "POST", headers: { cookie: u, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ candidateId: crypto.randomUUID(), jobId: crypto.randomUUID() }) });
    const codes = [(await hit()).status, (await hit()).status, (await hit()).status];
    expect(codes[0]).not.toBe(429); expect(codes[1]).not.toBe(429);             // the limit here is 2 a minute
    expect(codes[2]).toBe(429);
  });

  test("a made-up session cookie buys nothing: the address is refused after a few failed checks, and the sign-in service is not asked once per request (code review, 16 Nov 2026, A-M10)", async () => {
    const real = await user("real-beside-forged");
    await earlyInMinute(20);
    const codes: number[] = [];
    for (let i = 0; i < 100; i++) codes.push((await fetch(base(PORT_A) + "/api/usage", { headers: { cookie: `th_refresh=forged-${i}; th_access=x.y.z`, "x-forwarded-for": "70.1.1.1" } })).status);
    const checked = codes.filter((c) => c === 401).length;   // each of these was a session checked, which can mean a call to the sign-in service
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBeLessThanOrEqual(30);                 // 30 failed checks a minute per address
    expect(codes.slice(-10)).toEqual(Array(10).fill(429));   // after that, refused before any check
    expect((await fetch(base(PORT_A) + "/api/usage", { headers: { cookie: real, "x-forwarded-for": "70.1.1.2" } })).status).toBe(200);   // a real session elsewhere is untouched
  });

  test("an ordinary user's total request rate is capped", async () => {
    const u = await user("burst");
    await earlyInMinute(40);
    let first429 = 0;
    for (let i = 1; i <= 60; i++) { const r = await fetch(base(PORT_A) + "/api/usage", { headers: { cookie: u } }); if (r.status === 429) { first429 = i; break; } }
    expect(first429).toBe(41);                                                  // the limit here is 40 a minute: the 41st request is the first refused
  });
});

describe("the app's own files and headers", () => {
  test("loading the app page over and over is limited per address; every refusal says when to retry", async () => {
    let refused: Response | null = null;
    for (let i = 0; i < 40; i++) { const r = await fetch(base(PORT_B) + "/", { headers: {} }); if (r.status === 429) { refused = r; break; } }
    expect(refused).not.toBeNull(); expect(Number(refused!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  // Behind the tunnel every visitor reaches the server over the one connection the tunnel holds. The app's files were counted by that connection,
  // so everyone together shared one visitor's allowance (raised 17 Nov 2026, fixed 20 Nov): they are counted by the visitor, as the API is.
  test("behind the proxy, one visitor using up the files allowance leaves another visitor's untouched", async () => {
    await earlyInMinute(10);
    const page = (who: string) => fetch(base(PORT_A) + "/", { headers: { "x-forwarded-for": who } }).then((r) => r.status);
    const first = `92.0.0.${Math.floor(Math.random() * 250)}`, second = `93.0.0.${Math.floor(Math.random() * 250)}`;
    const statuses: number[] = []; for (let i = 0; i < 13; i++) statuses.push(await page(first));
    expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true);   // the limit here is 12 a minute
    expect(statuses[12]).toBe(429);
    expect(await page(second)).toBe(200);                                // the same connection, another visitor: still served
  });
  test("security headers are on the app page and on API answers", async () => {
    for (const port of [PORT_A]) {
      for (const path of ["/api/health", "/some-page"]) {
        const r = await fetch(base(port) + path, { headers: { "x-forwarded-for": `90.0.0.${Math.floor(Math.random() * 250)}` } });
        expect(r.headers.get("x-content-type-options")).toBe("nosniff");
        expect(r.headers.get("x-frame-options")).toBe("DENY");
        expect(r.headers.get("referrer-policy")).toBe("no-referrer");
        const csp = r.headers.get("content-security-policy") ?? "";
        expect(csp).toContain("default-src 'self'"); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).toContain("object-src 'none'"); expect(csp).not.toContain("'unsafe-eval'");
        expect(r.headers.get("permissions-policy")).toContain("camera=()");
      }
    }
  });
  test("the server does not announce what it is built with", async () => {
    const r = await fetch(base(PORT_A) + "/api/health", { headers: { "x-forwarded-for": "91.0.0.1" } });
    expect(r.headers.get("server")).toBeNull(); expect(r.headers.get("x-powered-by")).toBeNull();
  });
});

// ---------------------------------------------------------------- exact log used by the shared (security) limits
describe("the owner's rule: 5 attempts per 15 minutes for anything that guesses a secret", () => {
  test("sign-in per account, e-mailed codes per address and invitation links per sender all use exactly 5 in 15 minutes, shared across servers", async () => {
    const { limitOf } = await import("../src/ratelimit");
    for (const tier of ["login_pair", "login_email", "verify_email", "invite_lookup_ip", "invite_accept_user", "ops_token_ip"] as const) expect(limitOf(tier), tier).toEqual({ limit: 5, windowMs: 15 * 60_000, shared: true });
    // never looser than the rule where it already was stricter
    expect(limitOf("resend_email").limit).toBeLessThanOrEqual(5); expect(limitOf("signup_email").limit).toBeLessThanOrEqual(5);
  });
  test("the wait a refused person is told comes from the real time left", async () => {
    const { waitText } = await import("../src/ratelimit");
    expect(waitText(40)).toBe("about a minute"); expect(waitText(899)).toBe("15 minutes"); expect(waitText(61 * 3)).toBe("4 minutes");
  });
});

describe("the exact sliding log", () => {
  const MIN = 60_000, ev = (at: number, count = 1) => ({ at, count });
  let slidingLog: typeof import("../src/ratelimit").slidingLog;
  beforeAll(async () => { slidingLog = (await import("../src/ratelimit")).slidingLog; });

  test("allows exactly the limit inside the window and refuses the next", () => {
    const now = 1_000_000, five = [1, 2, 3, 4, 5].map((i) => ev(now - i * 1000));
    expect(slidingLog(five.slice(0, 4), now, 15 * MIN, 5).allowed).toBe(true);
    expect(slidingLog(five, now, 15 * MIN, 5).allowed).toBe(false);
  });
  test("has no boundary effect: attempts bunched around any minute edge still count in full", () => {
    // five attempts spread over the last fourteen minutes, none near a 'window start': a bucket counter could forget some of them
    const now = 100 * MIN + 1, spread = [14, 11, 9, 5, 1].map((m) => ev(now - m * MIN + 10));
    expect(slidingLog(spread, now, 15 * MIN, 5).allowed).toBe(false);
  });
  test("tells the caller when the oldest relevant attempt leaves the window", () => {
    const now = 50 * MIN, v = slidingLog([ev(now - 14 * MIN), ev(now - 3 * MIN), ev(now - 2 * MIN)], now, 15 * MIN, 3);
    expect(v.allowed).toBe(false); expect(v.retryAfterSec).toBe(60);          // the 14-minute-old attempt leaves in one minute
  });
  test("forgets attempts older than the window, and counts several attempts stored at the same millisecond", () => {
    const now = 20 * MIN;
    expect(slidingLog([ev(now - 16 * MIN, 5)], now, 15 * MIN, 5).allowed).toBe(true);
    expect(slidingLog([ev(now - 1000, 5)], now, 15 * MIN, 5).allowed).toBe(false);
  });
});
