// Several API servers behind one address must behave as one: nothing a person does may depend on which server answers.
// Two servers share one database here, as they would behind a load balancer.
import { afterAll, beforeAll, expect, test } from "vitest";
import { sampleCv } from "./fixtures";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

const PORTS = [8801, 8802], API_ONLY = 8803, WORKER_HEALTH = 8804, RECHECK_MS = 800;
let tdb: TestDb;
const servers: Proc[] = [];
const run = crypto.randomUUID().slice(0, 8);
const EMAIL = `several-${run}@example.test`, PASSWORD = "several-servers-password";

/** A browser: keeps its cookies, and can be pointed at either server. */
class Browser {
  jar = new Map<string, string>();
  async req(port: number, path: string, init: RequestInit = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://localhost:${port}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173" } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    return res;
  }
}

const up = async (url: string) => { for (let i = 0; i < 300; i++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(100); } throw new Error(`${url} did not start`); };
const signIn = async (port: number) => {
  const b = new Browser();
  expect((await b.req(port, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).status).toBe(200);
  return b;
};

beforeAll(async () => {
  tdb = await setupTestDb({ TOKEN_RECHECK_MS: String(RECHECK_MS) });
  await tdb.createUser("Several servers", EMAIL, "Several Servers", PASSWORD);
  for (const port of PORTS) servers.push(spawnProc(["tsx", "src/index.ts"], { env: { ...tdb.env, PORT: String(port) }, stdout: "ignore", stderr: "ignore" }));
  servers.push(spawnProc(["tsx", "src/index.ts"], { env: { ...tdb.env, PORT: String(API_ONLY), ROLE: "api" }, stdout: "ignore", stderr: "ignore" }));
  for (const port of [...PORTS, API_ONLY]) await up(`http://localhost:${port}/api/health`);
}, 120000);
afterAll(async () => { for (const s of servers) s.kill(); await tdb?.teardown(); }, 60000);

test("signing out on one server ends the session on the other servers too", async () => {
  const me = await signIn(PORTS[0]);
  const stolen = new Browser(); stolen.jar = new Map(me.jar);   // a copy of the sign-in cookies, kept after signing out
  expect((await stolen.req(PORTS[1], "/api/candidates")).status).toBe(200);   // the other server accepts the session, and remembers it was fine
  expect((await me.req(PORTS[0], "/api/auth/logout", { method: "POST" })).status).toBeLessThan(300);
  await sleep(RECHECK_MS + 200);   // the other server re-checks a token at most this often
  expect((await stolen.req(PORTS[1], "/api/candidates")).status).toBe(401);
  expect((await stolen.req(PORTS[0], "/api/candidates")).status).toBe(401);
}, 60000);

test("a website-only server (ROLE=api) leaves reading to separate workers, and a worker started later reads what was waiting", async () => {
  // the two all-in-one servers above would read it themselves: stop them, so only the website-only server and the worker below remain
  // and wait until they have exited: a server still shutting down can claim the next job (seen on a disposable local stack, 2026-11-02)
  const stopping = servers.splice(0, PORTS.length); for (const s of stopping) s.kill(); await Promise.all(stopping.map((s) => s.exited));
  const me = await signIn(API_ONLY);
  const form = new FormData(); form.append("kind", "cv"); form.append("file", new File([await sampleCv("Worker Split Example")], "worker-split.docx"));
  const doc: any = await (await me.req(API_ONLY, "/api/documents", { method: "POST", body: form })).json();
  expect(doc.id).toBeTruthy();
  await sleep(4000);
  expect(((await (await me.req(API_ONLY, `/api/documents/${doc.id}`)).json()) as any).status).toBe("processing");   // nobody is reading it yet
  servers.push(spawnProc(["tsx", "src/worker.ts"], { env: { ...tdb.env, WORKER_HEALTH_PORT: String(WORKER_HEALTH) }, stdout: "ignore", stderr: "ignore" }));
  await up(`http://localhost:${WORKER_HEALTH}/health`);
  let status = "processing";
  for (let i = 0; i < 300 && status === "processing"; i++) { await sleep(200); status = ((await (await me.req(API_ONLY, `/api/documents/${doc.id}`)).json()) as any).status; }
  expect(status).toBe("published");
}, 120000);
