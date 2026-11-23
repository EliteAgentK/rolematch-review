import { afterAll, beforeAll, expect, test } from "vitest";
import postgres from "postgres";
import { adminDeleteUser } from "../src/supabase";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

// Sign-up with an e-mailed code, tested against real Supabase. A development switch prints the code to the server's
// console instead of e-mailing it, so the whole flow can run without a mailbox.
const PORT = 8794, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
const addr = (n: string) => `su-${run}-${n}@example.test`;
let tdb: TestDb, server: Proc, log = "";

async function pipeToLog(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(), dec = new TextDecoder();
  for (;;) { const { done, value } = await reader.read(); if (done) return; log += dec.decode(value); }
}
const codeFor = async (email: string) => {
  for (let i = 0; i < 60; i++) { const m = log.match(new RegExp(`sign-up code for ${email.replace(/[.+]/g, "\\$&")}: (\\d+)`)); if (m) return m[1]; await sleep(100); }
  return null;
};
let visitor = "10.0.0.1";
const post = (path: string, body: unknown, cookie = "") => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": visitor, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
const good = (n: string, extra: Record<string, unknown> = {}) => ({ name: "Test Person", orgName: `Org ${n} ${run}`, email: addr(n), password: "a-long-enough-password-1", ...extra });

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_DEV_CODE: "true", TRUST_PROXY: "true" }); // tests pretend to be different visitors via X-Forwarded-For
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "pipe", stderr: "pipe" });
  void pipeToLog(server.stdout as ReadableStream<Uint8Array>); void pipeToLog(server.stderr as ReadableStream<Uint8Array>);
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
}, 120000);

afterAll(async () => {
  server?.kill();
  await tdb?.teardown();
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 }); // also remove sign-ups that were never confirmed
  try { for (const u of await admin.unsafe(`select id from auth.users where email like 'su-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await admin.end(); }
}, 90000);

test("bad details are refused with a clear reason before anything is sent", async () => {
  expect((await post("/api/auth/signup", good("weak", { password: "short" }))).status).toBe(400);
  expect((await post("/api/auth/signup", good("mail", { email: "not-an-email" }))).status).toBe(400);
  expect((await post("/api/auth/signup", good("name", { name: "A" }))).status).toBe(400);
  expect((await post("/api/auth/signup", good("org", { orgName: "" }))).status).toBe(400);
  expect(log).not.toContain("sign-up code for");
});

test("the hidden 'website' field catches bots: it looks like success but nothing is created", async () => {
  const res = await post("/api/auth/signup", good("bot", { website: "http://spam.example" }));
  expect(res.status).toBe(202);
  await sleep(1500);
  expect(log).not.toContain(addr("bot"));
});

test("full flow: sign up, cannot log in before confirming, wrong code fails, right code creates the organisation and signs in", async () => {
  const email = addr("happy");
  expect((await post("/api/auth/signup", good("happy"))).status).toBe(202);
  const code = await codeFor(email);
  expect(code).toMatch(/^\d{6,10}$/);

  // nothing exists yet: logging in is refused with a specific message, and no data is reachable
  const early = await post("/api/auth/login", { email, password: "a-long-enough-password-1" });
  expect(early.status).toBe(403);
  expect(((await early.json()) as any).error.code).toBe("AUTH-003");

  expect((await post("/api/auth/verify", { email, code: "000000" })).status).toBe(401);
  const ok = await post("/api/auth/verify", { email, code });
  expect(ok.status).toBe(200);
  const cookie = cookiesOf(ok);
  const user = ((await ok.json()) as any).user;
  expect(user.role).toBe("admin");
  expect(user.email).toBe(email);

  const me = await fetch(base + "/api/auth/me", { headers: { cookie } });
  expect(me.status).toBe(200);
  expect((((await (await fetch(base + "/api/candidates", { headers: { cookie } })).json()) as any).items).length).toBe(0);

  // a code works once only
  expect((await post("/api/auth/verify", { email, code })).status).toBe(401);
  // and the new user can now log in normally
  expect((await post("/api/auth/login", { email, password: "a-long-enough-password-1" })).status).toBe(200);
});

test("two people who choose the same organisation name get separate, isolated organisations", async () => {
  const a = good("iso-a", { orgName: `Shared Name ${run}` }), b = good("iso-b", { orgName: `Shared Name ${run}` });
  await post("/api/auth/signup", a); await post("/api/auth/signup", b);
  const ra = await post("/api/auth/verify", { email: a.email, code: await codeFor(a.email) });
  const rb = await post("/api/auth/verify", { email: b.email, code: await codeFor(b.email) });
  expect(ra.status).toBe(200); expect(rb.status).toBe(200);
  expect(((await ra.json()) as any).user.orgId).not.toBe(((await rb.json()) as any).user.orgId);
});

test("codes can be resent, but not in quick succession; repeated sign-ups are rate limited", async () => {
  const email = addr("resend");
  await post("/api/auth/signup", good("resend"));
  expect((await post("/api/auth/resend", { email })).status).toBe(429); // too soon after the first
  const email2 = addr("spam");
  let last = 0;
  for (let i = 0; i < 7; i++) last = (await post("/api/auth/signup", good("spam", { email: email2 }))).status;
  expect(last).toBe(429);
});

// Owner, 8 Nov 2026: an address that already has an account is told so (it used to get the same answer as a new one, and waited for a code that never came).
test("signing up with an address that already has an account is told so and creates nothing", async () => {
  visitor = "10.0.0.2"; // a different visitor, so the previous tests' attempts do not count against this one
  const email = addr("happy");
  const res = await post("/api/auth/signup", good("happy", { orgName: "Hijack Attempt" }));
  expect(res.status).toBe(409);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { expect((await sql.unsafe(`select count(*)::int c from "${tdb.schema}".orgs where name = 'Hijack Attempt'`))[0].c).toBe(0); } finally { await sql.end(); }
  expect(email).toContain(run);
});

test("the caller's address cannot be faked unless the server is told it sits behind a trusted proxy", async () => {
  // A second server WITHOUT TRUST_PROXY: changing X-Forwarded-For must not give a fresh allowance.
  const env2 = { ...tdb.env, PORT: String(PORT + 1), TRUST_PROXY: "false" };
  const s2 = spawnProc(["tsx", "src/index.ts"], { env: env2, stdout: "ignore", stderr: "ignore" });
  try {
    const b2 = `http://localhost:${PORT + 1}`;
    for (let i = 0; i < 300; i++) { try { if ((await fetch(b2 + "/api/health")).ok) break; } catch {} await sleep(100); }
    let blocked = 0;
    for (let i = 0; i < 14; i++) {
      const r = await fetch(b2 + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `203.0.113.${i}` }, body: JSON.stringify(good(`fake${i}`)) });
      if (r.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0); // the spoofed addresses were all treated as the same real one
  } finally { s2.kill(); }
});
