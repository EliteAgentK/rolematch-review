import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

// The settings the move to the PC needs (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, C1, C2, C6 and the visitor header). Each one, unset, must leave
// live exactly as it was; set, it must take over everywhere it is meant to.
const FAKE_DB = "postgres://" + "u:p@localhost:5432/d";
const KEY = "not-a-real-service-key";
const load = async <T>(module: string, env: Record<string, string>): Promise<T> => {
  vi.resetModules();
  vi.stubEnv("ROLEMATCH_ENV_FILE", "/dev/null"); vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL || FAKE_DB);
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import(module) as Promise<T>;
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("C1: sign-in is reached at Supabase's address unless AUTH_URL says otherwise, and the issuer follows it", async () => {
  const before = await load<any>("../src/config", { AUTH_URL: "" });
  expect(before.config.authUrl).toBe("https://example.supabase.co/auth/v1");
  const after = await load<any>("../src/config", { AUTH_URL: "http://127.0.0.1:9998/" });
  expect(after.config.authUrl).toBe("http://127.0.0.1:9998");
  // nothing in the client builds a sign-in address of its own any more: every one comes from config.authUrl
  const client = readFileSync(new URL("../src/supabase.ts", import.meta.url), "utf8");
  expect(client).not.toMatch(/`[^`]*\/auth\/v1/);   // no address built with the Supabase path (a comment may name it)
  expect(client).toMatch(/const issuer = authBase;/);
});

test("C1: a sign-in goes to AUTH_URL", async () => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { seen.push(String(url)); return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }); });
  const { passwordLogin: signIn } = await load<any>("../src/supabase", { AUTH_URL: "http://127.0.0.1:9998" });
  await signIn("someone@example.test", "a password").catch(() => null);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((u) => u.startsWith("http://127.0.0.1:9998/"))).toBe(true);
});

test("C2: without LINK_SECRET every hash is exactly what it was (the service key); with it, the new secret is used", async () => {
  const old = (msg: string) => createHmac("sha256", KEY).update(msg).digest("base64url");
  const same = await load<any>("../src/portals", { LINK_SECRET: "" });
  expect(same.inviteLinkToken("inv-1", 2)).toBe(old("invitation:inv-1:2"));   // an invitation sent before the change still works
  const mail = await load<any>("../src/mail/index", { LINK_SECRET: "" });
  expect(mail.recipientHash(" A@B.test ")).toBe(createHmac("sha256", KEY).update("a@b.test").digest("hex"));
  // the move sets LINK_SECRET to the old key's value: links, codes and stored hashes all carry over
  const carried = await load<any>("../src/portals", { LINK_SECRET: KEY, SUPABASE_SERVICE_ROLE_KEY: "a-brand-new-key" });
  expect(carried.inviteLinkToken("inv-1", 2)).toBe(old("invitation:inv-1:2"));
  const changed = await load<any>("../src/portals", { LINK_SECRET: "another-secret" });
  expect(changed.inviteLinkToken("inv-1", 2)).not.toBe(old("invitation:inv-1:2"));
  // and nothing still hashes with the service key directly
  for (const f of ["../src/auth.ts", "../src/portals.ts", "../src/mail/index.ts"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/createHmac\("sha256", config\.supabaseKey\)/);
});

test("the visitor's address goes to a self-run sign-in service in the header it trusts, never for this machine itself", async () => {
  const { asVisitor, forwardVisitor } = await load<any>("../src/visitor", {});
  expect(asVisitor("41.1.2.3", () => forwardVisitor("eyJ.a.jwt", "x-forwarded-for"))).toEqual({ "x-forwarded-for": "41.1.2.3" });
  expect(asVisitor("127.0.0.1", () => forwardVisitor("eyJ.a.jwt", "x-forwarded-for"))).toEqual({});
  // no header named: Supabase's rule as before (a secret key only)
  expect(asVisitor("41.1.2.3", () => forwardVisitor("eyJ.a.jwt", ""))).toEqual({});
  expect(asVisitor("41.1.2.3", () => forwardVisitor("sb_" + "secret_x", ""))).toEqual({ "sb-forwarded-for": "41.1.2.3" });
});

test("C6: the console says where the database is when told, and works it out otherwise", async () => {
  const { whereIs } = await load<any>("../src/console/database", {});
  expect(whereIs("postgres://x@aws-0-eu-west-1.pooler.supabase.com:5432/p", "")).toBe("Supabase (hosted in Ireland)");
  expect(whereIs("postgres://x@127.0.0.1:5434/p", "Johannesburg, on the PC")).toBe("Johannesburg, on the PC");
});

test("C3: with the file vault, the startup check looks at the vault's folder, not a Supabase bucket", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rm-vault-"));
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { calls.push(String(url)); return new Response("{}", { status: 200 }); });
  const { schemaStatus } = await load<any>("../src/schema", { STORE_DIR: dir });
  const s = await schemaStatus();
  expect(s.bucket).toBe("ok");
  expect(calls.some((u) => u.includes("/storage/v1/"))).toBe(false);
  const missing = await load<any>("../src/schema", { STORE_DIR: join(dir, "not-there") });
  const m = await missing.schemaStatus();
  expect(m.bucket).toBe("missing");
  expect(m.problems.join(" ")).toMatch(/file vault/);
});
