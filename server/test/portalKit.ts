// Shared set-up for the portal and capacity tests: one throw-away schema, one server, one organisation with a portal, and as many signed-in recruiters as asked.
import { Document, Packer, Paragraph } from "docx";
import postgres from "postgres";
import { adminDeleteUser } from "../src/supabase";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";

export class Browser {
  jar = new Map<string, string>();
  portal: string | null = null;
  constructor(public base: string, public email = "") {}
  async req(path: string, init: RequestInit = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + path, { ...init, headers: { ...(init.headers ?? {}), cookie, origin: "http://localhost:5173", ...(this.portal ? { "x-portal-id": this.portal } : {}) } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    return res;
  }
  async post(path: string, body: unknown = {}) { const r = await this.req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; }
  async get(path: string) { const r = await this.req(path); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; }
  async del(path: string) { const r = await this.req(path, { method: "DELETE" }); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; }
  async upload(file: File, o: { batch?: string; kind?: "cv" | "jd" } = {}) {
    const f = new FormData(); f.append("kind", o.kind ?? "cv"); f.append("file", file);
    const r = await this.req("/api/documents" + (o.batch ? `?batch=${o.batch}&name=${encodeURIComponent(file.name)}` : ""), { method: "POST", body: f });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  }
}

export interface World { tdb: TestDb; server: Proc; base: string; port: number; admin: postgres.Sql; users: Browser[]; org: string; run: string; restart: () => Promise<void>; stop: () => Promise<void>; env: Record<string, string> }
const PASSWORD = "a-long-enough-password-1";

export async function makeWorld(port: number, members: number, extraEnv: Record<string, string> = {}): Promise<World> {
  const run = crypto.randomUUID().slice(0, 8), base = `http://localhost:${port}`, org = `Kit Org ${run}`;
  const tdb = await setupTestDb({ PORT: String(port), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true", PER_ORG_CONCURRENCY: "4", WORKER_CONCURRENCY: "4", ...extraEnv });
  const admin = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  const boot = async () => { const s = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: process.env.KIT_LOG ? "inherit" : "ignore", stderr: process.env.KIT_LOG ? "inherit" : "ignore" }); for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); } return s; };
  const w = { tdb, server: await boot(), base, port, admin, users: [] as Browser[], org, run, env: tdb.env } as World;
  const first = new Browser(base, `kit1-${run}@example.test`);
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.9.0.1" }, body: JSON.stringify({ name: "Kit One", orgName: org, email: first.email, password: PASSWORD }) });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) first.jar.set(kv.slice(0, i), v); }
  w.users.push(first);
  // the other recruiters join the same organisation (and its first portal) the way the sign-in script adds people
  for (let n = 2; n <= members; n++) {
    const email = `kit${n}-${run}@example.test`;
    await tdb.createUser(org, email, `Kit ${n}`, PASSWORD);
    const b = new Browser(base, email);
    const r = await b.req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${n}.1` }, body: JSON.stringify({ email, password: PASSWORD }) });
    if (r.status !== 200) throw new Error(`login ${email} -> ${r.status}`);
    w.users.push(b);
  }
  w.restart = async () => { w.server.kill(); await w.server.exited; await sleep(500); w.server = await boot(); };   // a stopping server drains first and still answers /api/health: wait until it has really gone
  w.stop = async () => {
    // Wait for the server to have really gone (it drains first, as restart notes): dropping the schema while it still holds connections failed on the PC,
    // and a swallowed teardown error then surfaced as a misleading "Could not delete user (500)". A teardown failure is now reported as itself.
    w.server?.kill(); await w.server?.exited; await admin.end().catch(() => {}); await tdb.teardown();
    const a = postgres(process.env.DATABASE_URL!, { max: 1 });
    try { for (const u of await a.unsafe(`select id from auth.users where email like 'kit%-${run}@example.test' or email like 'inv%-${run}@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
  };
  return w;
}

const lines = (name: string, n: number, extra: string[] = []) => [name, `${name.toLowerCase().replace(/\W/g, ".")}.${n}@example.test`, "Senior Accountant", "Summary", "Accountant with ten years of experience in financial reporting, budgeting and month-end close for mid-size companies.",
  "Experience", `Senior Accountant, Northwind Traders ${n}, 2016 - 2024`, "Prepared monthly financial statements and managed the budgeting cycle for three business units.", "Skills", "Excel, Financial Reporting, Budgeting, Payroll", "Education", "BCom Accounting, University of Cape Town, 2015", ...extra];
const FIRST = ["Thandi", "Pieter", "Aisha", "Lungile", "Maria", "Sipho", "Neha", "Jacques", "Fatima", "Bongani"], LAST = ["Mokoena", "Naidoo", "Jacobs", "Dlamini", "Pretorius", "Khumalo", "Govender", "Botha", "Sithole", "Maseko"];
export const personName = (i: number) => `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}${i >= 100 ? " " + String.fromCharCode(65 + Math.floor(i / 100)) : ""}`;
export async function cvFile(n: number, fileName = `cv-${n}.docx`) {
  return new File([new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: lines(personName(n), n).map((l) => new Paragraph(l)) }] })))], fileName);
}
export { sleep };
