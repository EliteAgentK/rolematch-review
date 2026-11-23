import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterAll, expect, test, vi } from "vitest";
import { sleep } from "./helpers";

// Verification codes: Supabase Auth is the authority for generating, expiring and consuming them; RoleMatch only passes them through. Two kinds of evidence, kept apart:
//  1. SIMULATED provider: a stand-in that answers like Auth does for an expired / invalid / valid code, proving how OUR code reacts to each answer.
//  2. REAL provider software, isolated: a throw-away local Auth (GoTrue) container with a 4-second code lifetime, proving that expiry and single use are actually enforced by the
//     provider we depend on, in the version we run locally. Neither touches the shared Supabase project or its settings.
// What is NOT shown by either: the OTP lifetime configured on the SHARED project (it cannot be read without a management token); the owner reads it in the Supabase dashboard
// (Authentication > Sign In / Providers > Email > OTP expiration) and keeps OTP_EXPIRY_MINUTES equal to it.
const load = async (url: string, key: string) => { Object.assign(process.env, { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key }); vi.resetModules(); return await import("../src/supabase"); };
const restore = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
const AUTH_DB_PW = randomBytes(18).toString("hex");   // the throw-away Auth database's password: new on every run, so no credential is written into the code
afterAll(() => { process.env.SUPABASE_URL = restore.url; process.env.SUPABASE_SERVICE_ROLE_KEY = restore.key; });

let fake: Server;
test("SIMULATED provider: an expired code, a wrong code and a valid code are each handled correctly (only the valid one signs anyone in)", async () => {
  fake = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const { token } = JSON.parse(b || "{}");
      if (token === "111111") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, user: { id: "u1", email: "x@example.test", user_metadata: { org_name: "Org" } } }));
      const expired = token === "222222";
      res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ code: 403, error_code: expired ? "otp_expired" : "otp_invalid", msg: expired ? "Email link is invalid or has expired" : "Token has expired or is invalid" }));
    });
  }).listen(8941);
  const { verifySignupCode } = await load("http://127.0.0.1:8941", "k");
  expect((await verifySignupCode("x@example.test", "111111"))?.userId).toBe("u1");
  expect(await verifySignupCode("x@example.test", "222222")).toBeNull();        // expired: no tokens, no session
  expect(await verifySignupCode("x@example.test", "333333")).toBeNull();        // wrong
  await new Promise<void>((r) => fake.close(() => r()));
});

// ---- REAL provider software, isolated, short expiry (needs Docker and the locally present images; otherwise reported as skipped, never as passed) ----
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8" });
const haveDocker = docker("info").status === 0 && /gotrue:v/.test(docker("images", "--format", "{{.Repository}}:{{.Tag}}").stdout) && /supabase\/postgres:/.test(docker("images", "--format", "{{.Repository}}:{{.Tag}}").stdout);
const NET = "rm_exp_net", DB = "rm_exp_db", AUTH = "rm_exp_auth", SECRET = "rm-local-expiry-test-secret-not-used-anywhere-else-0123456789", PORT = 54392, EXPIRY = 4;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (() => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role: "service_role", iss: "rm-local", exp: 4102444800 }); return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; })();
let gateway: Server | undefined;
const teardown = () => { gateway?.close(); gateway = undefined; docker("rm", "-f", AUTH); docker("rm", "-f", DB); docker("network", "rm", NET); };

test.skipIf(!haveDocker)("REAL local Auth with a 4-second code lifetime: a code works once inside its lifetime, is refused when used again, and is refused after it expires", async () => {
  teardown();
  try {
    expect(docker("network", "create", NET).status).toBe(0);
    const imgs = docker("images", "--format", "{{.Repository}}:{{.Tag}}").stdout.split("\n");
    const pg = imgs.find((i) => /supabase\/postgres:/.test(i))!, gt = imgs.find((i) => /supabase\/gotrue:v/.test(i))!;
    expect(docker("run", "-d", "--name", DB, "--network", NET, "-e", `POSTGRES_PASSWORD=${AUTH_DB_PW}`, pg).status).toBe(0);
    for (let i = 0; i < 90; i++) { if (docker("exec", DB, "pg_isready", "-U", "postgres", "-h", "127.0.0.1").status === 0) break; await sleep(1000); }
    // The image's init scripts create the auth schema and the supabase_auth_admin role; give that role a known password for THIS throw-away database (retried until the role exists).
    let pwSet = false; for (let i = 0; i < 60 && !pwSet; i++) { pwSet = docker("exec", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-c", `alter role supabase_auth_admin with login password '${AUTH_DB_PW}'`).status === 0 || docker("exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-c", `alter role supabase_auth_admin with login password '${AUTH_DB_PW}'`).status === 0; if (!pwSet) await sleep(1000); }
    expect(pwSet, "could not set the throw-away auth role's password").toBe(true);
    const env = ["GOTRUE_API_HOST=0.0.0.0", "GOTRUE_API_PORT=9999", `API_EXTERNAL_URL=http://localhost:${PORT}`, "GOTRUE_SITE_URL=http://localhost", `GOTRUE_JWT_SECRET=${SECRET}`, "GOTRUE_JWT_EXP=3600", "GOTRUE_DB_DRIVER=postgres",
      `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${AUTH_DB_PW}@${DB}:5432/postgres`, "GOTRUE_DISABLE_SIGNUP=false", "GOTRUE_MAILER_AUTOCONFIRM=false", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true", "GOTRUE_MAILER_OTP_LENGTH=6", `GOTRUE_MAILER_OTP_EXP=${EXPIRY}`, "GOTRUE_SMTP_HOST=127.0.0.1", "GOTRUE_SMTP_PORT=1", "GOTRUE_LOG_LEVEL=error"];
    expect(docker("run", "-d", "--name", AUTH, "--network", NET, "-p", `127.0.0.1:${PORT}:9999`, ...env.flatMap((e) => ["-e", e]), gt).status).toBe(0);
    let up = false; for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { /* starting */ } if (!up) await sleep(1000); }
    expect(up, docker("logs", AUTH).stdout + docker("logs", AUTH).stderr).toBe(true);
    // the configured lifetime, read back from the container we configured (not assumed)
    expect(docker("inspect", AUTH, "--format", "{{range .Config.Env}}{{println .}}{{end}}").stdout).toContain(`GOTRUE_MAILER_OTP_EXP=${EXPIRY}`);
    // A standalone Auth server answers at its root; the hosted project puts it behind /auth/v1 (Supabase's gateway). A small pass-through does that mapping, nothing else.
    gateway = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const r = await fetch(`http://127.0.0.1:${PORT}${(req.url ?? "").replace(/^\/auth\/v1/, "")}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "content-length"].includes(k)) as [string, string][]), body: chunks.length ? Buffer.concat(chunks) : undefined });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }).end(Buffer.from(await r.arrayBuffer()));
    }).listen(PORT + 1);
    const { createSignupCode, verifySignupCode } = await load(`http://127.0.0.1:${PORT + 1}`, jwt);
    const make = async (n: string) => { const email = `exp-${n}-${Math.random().toString(16).slice(2, 8)}@example.test`; return { email, code: await createSignupCode(email, "a-long-enough-password-1", { name: "Exp" }) }; };
    const a = await make("a"), b = await make("b");
    expect(a.code).toMatch(/^\d{6}$/);
    expect((await verifySignupCode(a.email, a.code!))?.email).toBe(a.email);        // inside its lifetime: works
    expect(await verifySignupCode(a.email, a.code!)).toBeNull();                    // used once: refused
    await sleep((EXPIRY + 2) * 1000);
    expect(await verifySignupCode(b.email, b.code!)).toBeNull();                    // after its lifetime: refused (a valid code, never used)
    const c = await make("c"); expect((await verifySignupCode(c.email, c.code!))?.email).toBe(c.email);   // control: a fresh code still works, so the refusals were about the code, not the setup
  } finally { teardown(); }
}, 240000);
