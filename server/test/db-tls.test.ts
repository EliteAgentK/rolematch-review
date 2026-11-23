import { readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, expect, test } from "vitest";
import { config } from "../src/config";
import { dbTls } from "../src/dbTls";

// Register R104: the service talked to its database across the internet in plain text. These prove what the client actually sends and what it refuses, against servers on this machine that behave like a good, a downgrading and an impostor database.
const SSL_REQUEST = "0000000804d2162f";
const servers: net.Server[] = [];
afterAll(() => { for (const s of servers) s.close(); });
const fake = async (answer: (c: net.Socket) => void) => { const seen: string[] = []; const s = net.createServer((c) => { c.once("data", (d) => { seen.push(d.subarray(0, 8).toString("hex")); answer(c); }); c.on("error", () => {}); }); servers.push(s); await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r())); return { port: (s.address() as net.AddressInfo).port, seen }; };
const attempt = async (port: number) => { const sql = postgres(`postgres://u:p@127.0.0.1:${port}/d`, { max: 1, connect_timeout: 3, onnotice: () => {}, ...dbTls("postgres://u:p@db.example.supabase.co:5432/d") }); try { await sql`select 1`; return "connected"; } catch (e: any) { return String(e.code ?? e.message); } finally { await sql.end({ timeout: 1 }).catch(() => {}); } };

test("an address on another machine must be encrypted and checked; only this machine may be plain", () => {
  for (const url of ["postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres", "postgres://u:p@db.abc.supabase.co:5432/postgres", "postgres://u:p@10.0.0.5:5432/d", "postgres://u:p@192.168.1.100:5432/d", "postgres://u:p@db.rolematch.co.za/d", "postgres://u:p@1.2.3.4/d"]) {
    const { ssl } = dbTls(url);
    expect(ssl, url).toMatchObject({ rejectUnauthorized: true, minVersion: "TLSv1.2" });
    expect((ssl as any).ca[0]).toContain("BEGIN CERTIFICATE");
  }
  for (const url of ["postgres://u:p@localhost:5432/d", "postgres://u:p@127.0.0.1:54322/d", "postgres://u:p@[::1]:5432/d", "postgres://u:p@host.docker.internal:5432/d", "postgres://u:p@db:5432/d"]) expect(dbTls(url).ssl, url).toBe(false);
});

test("the client's first act is to ask for encryption, and a server that refuses is not used: no falling back to plain text", async () => {
  const s = await fake((c) => c.write("N"));
  const result = await attempt(s.port);
  expect(s.seen[0]).toBe(SSL_REQUEST);
  expect(result).not.toBe("connected");
}, 20000);

test("a server that says yes but cannot prove who it is is refused", async () => {
  const s = await fake((c) => { c.write("S"); c.once("data", () => c.destroy()); });
  expect(await attempt(s.port)).not.toBe("connected");
}, 20000);

test("the certificate used by the backup tools is the one the service trusts", () => {
  const dir = join(import.meta.dirname, "../..");
  const pem = readFileSync(join(dir, "deploy/certs/supabase-root-2021.pem"), "utf8").trim();
  expect(readFileSync(join(dir, "server/src/dbTls.ts"), "utf8")).toContain(pem);
});

test("no code that ships or runs against a real database opens a client without these options", () => {
  const root = join(import.meta.dirname, "..");
  for (const folder of ["src", "src/scripts", "scripts"]) for (const f of readdirSync(join(root, folder)).filter((x) => x.endsWith(".ts"))) {
    for (const call of readFileSync(join(root, folder, f), "utf8").matchAll(/\bpostgres\((?!\??:?ql\))([^)]*)/g)) expect(call[1], `${folder}/${f}`).toContain("dbTls(");
  }
});

test("the real database accepts a checked, encrypted connection", async () => {
  const url = config.databaseUrl;
  const sql = postgres(url, { ...dbTls(url), max: 1, connect_timeout: 15, onnotice: () => {} });
  try { expect((await sql`select 1 as ok`)[0].ok).toBe(1); } finally { await sql.end({ timeout: 2 }); }
}, 30000);
