import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { FakeSmtp } from "./fakeSmtp";
import { makeWorld, sleep, type World } from "./portalKit";
import { opsDetails, setupTestDb } from "./helpers";

// How the product behaves when mail is unavailable, in preview, local-only, and when the hourly allowance runs short. Simulated mail host only: nothing here proves real delivery.
const NO_RATE = JSON.stringify({ invite_user: 100000, invite_portal: 100000, invite_org: 100000, member_user: 100000 });
const worlds: World[] = []; const hosts: FakeSmtp[] = [];
afterAll(async () => { for (const w of worlds) await w.stop().catch(() => {}); for (const h of hosts) await h.stop().catch(() => {}); }, 120000);
const waitFor = async (f: () => Promise<boolean> | boolean, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { try { if (await f()) return true; } catch { /* retry */ } await sleep(250); } return false; };
const invs = async (w: World) => (await w.users[0].get("/api/portal/members")).body;

test("mail unavailable: invitations are saved and wait, nothing is attempted or reported sent, and the state is visible", async () => {
  const w = await makeWorld(8901, 1, { RATE_OVERRIDES: NO_RATE, SIGNUP_REQUIRE_CODE: "false", OUTBOX_POLL_MS: "300", PUBLIC_APP_URL: "https://app.rolematch.example" }); worlds.push(w);
  const made = (await w.users[0].post("/api/portal/invitations", { emails: [`mu-${w.run}@example.test`], role: "recruiter" })).body[0];
  expect(made.status).toBe("invited"); await sleep(3000);
  const view = await invs(w); const inv = view.invitations.find((i: any) => i.id === made.id);
  expect(inv.emailState).toBe("queued"); expect(view.mail.state).toBe("unavailable");
  const o = (await w.admin.unsafe(`select status, attempts from "${w.tdb.schema}".outbox where aggregate_id = '${made.id}'`))[0];
  expect(o).toMatchObject({ status: "pending", attempts: 0 });                                              // no attempt was spent
  expect((await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".mail_attempts`))[0].c).toBe(0);
  const h = (await opsDetails(w.base)); expect(h.mail.state).toBe("unavailable"); expect(JSON.stringify(h)).not.toMatch(/MAIL_SMTP_PASS|password/i);
}, 300000);

test("preview transport: the invitation says 'previewed' (nothing was sent), never 'accepted', and uses no sending allowance", async () => {
  const w = await makeWorld(8902, 1, { RATE_OVERRIDES: NO_RATE, SIGNUP_REQUIRE_CODE: "false", MAIL_TRANSPORT: "preview", OUTBOX_POLL_MS: "300", PUBLIC_APP_URL: "https://app.rolematch.example" }); worlds.push(w);
  const made = (await w.users[0].post("/api/portal/invitations", { emails: [`mp-${w.run}@example.test`], role: "hiring_manager" })).body[0];
  expect(await waitFor(async () => (await invs(w)).invitations.find((i: any) => i.id === made.id)?.emailState === "previewed")).toBe(true);
  expect((await invs(w)).mail.state).toBe("preview");
  const a = await w.admin.unsafe(`select simulated, outcome from "${w.tdb.schema}".mail_attempts where template = 'invitation'`); expect(a.length).toBe(1); expect(a[0].simulated).toBe(true);
}, 300000);

test("the hourly allowance is shared with reserved headroom: invitations stop first, authentication keeps going, and a deferral spends no attempt", async () => {
  const smtp = new FakeSmtp(8905); await smtp.start(); hosts.push(smtp);
  const tdb = await setupTestDb({ MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: "live", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: "8905", MAIL_SMTP_SECURITY: "none", MAIL_MAX_PER_HOUR: "5", MAIL_RESERVED_AUTH_PER_HOUR: "2" });
  try {
    const out: string = await new Promise((res, rej) => { const c = spawn(process.execPath, ["--import", "tsx", "test/probes/mailQuotaProbe.ts"], { env: tdb.env }); let b = ""; c.stdout.on("data", (d) => (b += d)); c.on("close", () => res(b.trim().split("\n").pop()!)); c.on("error", rej); });
    expect(JSON.parse(out)).toEqual(["invitation:accepted", "invitation:accepted", "invitation:accepted", "invitation:deferred", "authentication:accepted", "authentication:accepted", "authentication:deferred", "authentication:deferred"]);
    expect(smtp.messages.length).toBe(5);
  } finally { await tdb.teardown(); }
}, 300000);

test("mail unavailable at sign-up: the person is told e-mail is unavailable (a distinct code), no code is claimed sent, and nothing is stored", async () => {
  const tdb = await setupTestDb({ PORT: "8906", TRUST_PROXY: "true", SIGNUP_DEV_CODE: "false" });   // no MAIL_TRANSPORT
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: tdb.env, stdio: "ignore" });
  const email = `mu-${Math.random().toString(16).slice(2, 10)}@example.test`;
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch("http://localhost:8906/api/health")).ok) break; } catch { /* starting */ } await sleep(250); }
    const r = await fetch("http://localhost:8906/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.2.2.2" }, body: JSON.stringify({ name: "No Mail", orgName: "No Mail Org", email, password: "a-long-enough-password-1" }) });
    expect(r.status).toBe(503); expect(((await r.json()) as any).error.code).toBe("MAIL-001");
  } finally {
    child.kill("SIGKILL"); await tdb.teardown();
    const { adminDeleteUser } = await import("../src/supabase"); const postgres = (await import("postgres")).default; const a = postgres(process.env.DATABASE_URL!, { max: 1 });
    try { for (const u of await a.unsafe(`select id from auth.users where email = '${email}'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
  }
}, 200000);
