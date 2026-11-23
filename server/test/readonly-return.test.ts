// R35 regression: a short outage of the main database must never leave the server read-only for good.
// Reproduction (2026-10-30, mail trial, schema trial_mail): the main database dropped out for a few checks; the server switched to the read-only copy,
// which has no trial_mail schema, so every signed-in read failed (500) and the board showed no candidates. When the main database came back, the
// check that allows saving again inspected the COPY's structure, which could never pass, so the server stayed read-only until restarted.
// Here the main database is reached through a local relay the test can cut, and the copy is the configured one (it does not hold the test's schema).
import net from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import postgres from "postgres";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

const PORT = 8813, RELAY = 8814, base = `http://localhost:${PORT}`;
const COPY = process.env.READ_FALLBACK_DATABASE_URL ?? "";
let tdb: TestDb, server: Proc, relay: net.Server, cut = false, log = "";
const open = new Set<net.Socket>();
let copyUp = false;

const sameDatabase = (a: string, b: string) => { const x = new URL(a), y = new URL(b); return x.hostname === y.hostname && (x.port || "5432") === (y.port || "5432") && x.pathname === y.pathname; };

beforeAll(async () => {
  // On the PC the copy was once set to the main database itself, which holds the test's schema, so the server rightly switched to it and the test failed for a reason it never names.
  if (COPY && sameDatabase(COPY, process.env.DATABASE_URL!)) throw new Error("READ_FALLBACK_DATABASE_URL names the main database itself; the read-only copy must be a separate database");
  if (COPY) { const c = postgres(COPY, { max: 1, connect_timeout: 3 }); try { await c`select 1`; copyUp = true; } catch { /* no copy on this machine */ } finally { await c.end(); } }
  if (!copyUp) return;
  const main = new URL(process.env.DATABASE_URL!);
  // The relay forwards to the real main database until it is cut; while cut it drops every connection and refuses new ones.
  relay = net.createServer((client) => {
    if (cut) { client.destroy(); return; }
    const up = net.connect(Number(main.port || 5432), main.hostname);
    open.add(client); open.add(up);
    const done = () => { client.destroy(); up.destroy(); open.delete(client); open.delete(up); };
    client.pipe(up).pipe(client); client.on("error", done); up.on("error", done); client.on("close", done); up.on("close", done);
  });
  await new Promise<void>((r) => relay.listen(RELAY, "127.0.0.1", r));
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false" });
  const viaRelay = new URL(process.env.DATABASE_URL!); viaRelay.hostname = "127.0.0.1"; viaRelay.port = String(RELAY);
  server = spawnProc(["tsx", "src/index.ts"], { env: { ...tdb.env, DATABASE_URL: viaRelay.toString(), READ_FALLBACK_DATABASE_URL: COPY, DB_CHECK_MS: "400", DB_SWITCH_AFTER: "2", DB_CHECK_TIMEOUT_MS: "1500" }, stdout: "ignore", stderr: "pipe" });
  void (async () => { const d = new TextDecoder(); for await (const c of server.stderr as any) log += d.decode(c); })();
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
}, 180000);

afterAll(async () => { server?.kill(); open.forEach((s) => s.destroy()); relay?.close(); await tdb?.teardown(); });

const ready = async () => (await (await fetch(base + "/api/ready")).json()) as { ready: boolean; reason?: string };

test.skipIf(!COPY)("a copy without this schema is not switched to, and the server is back to normal by itself once the main database answers", async (ctx) => {
  if (!copyUp) ctx.skip();
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ name: "Relay Test", orgName: `Relay Org ${crypto.randomUUID().slice(0, 6)}`, email: `relay-${crypto.randomUUID().slice(0, 8)}@example.test`, password: "a-long-enough-password-1" }) });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  expect((await fetch(base + "/api/candidates", { headers: { cookie } })).status).toBe(200);
  expect((await ready()).ready).toBe(true);

  cut = true; open.forEach((s) => s.destroy());
  await sleep(3000);   // several failed checks: enough to switch, were the copy usable
  expect(await ready()).not.toMatchObject({ reason: "read-only" });
  expect(log).toContain("db.copy_unusable");

  cut = false;
  let back = false;
  for (let i = 0; i < 40 && !back; i++) { await sleep(500); back = (await ready()).ready && (await fetch(base + "/api/candidates", { headers: { cookie } })).status === 200; }
  expect(back).toBe(true);
}, 120000);
