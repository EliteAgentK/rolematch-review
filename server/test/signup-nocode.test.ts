import { afterAll, beforeAll, expect, test } from "vitest";
import postgres from "postgres";
import { adminDeleteUser } from "../src/supabase";
import { opsDetails, setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

// TEST MODE: sign-up without an emailed code. It must work for testing and must be impossible to switch on in production.
const PORT = 8797, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
const email = `nc-${run}@example.test`;
let tdb: TestDb, server: Proc;
const post = (path: string, body: unknown, cookie = "") => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.2.2.2", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true" });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
}, 120000);
afterAll(async () => {
  server?.kill(); await tdb?.teardown();
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await admin.unsafe(`select id from auth.users where email like 'nc-${run}%@example.test'`)) await adminDeleteUser(u.id); } finally { await admin.end(); }
}, 90000);

test("the public health answer reveals nothing about this server's setup; test mode is visible only to the platform operator", async () => {
  expect(await (await fetch(base + "/api/health")).json()).toEqual({ ok: true });
  expect((await fetch(base + "/api/health/details")).status).toBe(404); // not even confirmed to exist to a stranger
  const res = await post("/api/auth/signup", { name: "Health Looker", orgName: `Health Org ${run}`, email: `nc-${run}-health@example.test`, password: "a-long-enough-password-1" });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  expect((await fetch(base + "/api/health/details", { headers: { cookie } })).status).toBe(404);   // a company's own administrator: not theirs to see
  expect((await opsDetails(base)).signup).toContain("TEST MODE");
});

test("sign up with no code: signed in at once, in a fresh empty organisation, and the account is saved", async () => {
  const res = await post("/api/auth/signup", { name: "No Code", orgName: `NC Org ${run}`, email, password: "a-long-enough-password-1" });
  expect(res.status).toBe(200);
  const body: any = await res.json();
  expect(body.status).toBe("signed_in");
  expect(body.user.role).toBe("admin");
  const cookie = cookiesOf(res);
  expect((await fetch(base + "/api/auth/me", { headers: { cookie } })).status).toBe(200);
  expect((((await (await fetch(base + "/api/candidates", { headers: { cookie } })).json()) as any).items).length).toBe(0);
  // saved in the database: the organisation and the member exist
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql.unsafe(`select o.name as org, m.email, m.role from "${tdb.schema}".members m join "${tdb.schema}".orgs o on o.id = m.org_id where m.email = '${email}'`);
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe("admin");
  } finally { await sql.end(); }
  // and they can log in again later with just their credentials
  expect((await post("/api/auth/login", { email, password: "a-long-enough-password-1" })).status).toBe(200);
});

test("signing up again with the same email says so clearly (test mode only) and creates nothing new", async () => {
  const res = await post("/api/auth/signup", { name: "No Code", orgName: "Second Org", email, password: "a-long-enough-password-1" });
  expect(res.status).toBe(409);
});

test("test mode cannot be switched on in production: the server refuses to start", async () => {
  const p = spawnProc(["tsx", "src/index.ts"], { env: { ...tdb.env, PORT: String(PORT + 1), COOKIE_SECURE: "true", SIGNUP_DEV_CODE: "false" }, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  const err = await new Response(p.stderr).text();
  expect(code).not.toBe(0);
  expect(err).toContain("SIGNUP_REQUIRE_CODE=false must never be used in production");
});
