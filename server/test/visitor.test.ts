import { afterEach, expect, test, vi } from "vitest";

// Registers R105 and R106: a visitor cannot choose their own address, and Supabase's per-address sign-in limits count each visitor rather than this one server.
const headers = (h: Record<string, string>) => new Headers(h);
const FAKE_DB = "postgres://" + "u:p@localhost:5432/d";
const FAKE_SECRET_KEY = "sb_" + "secret_not_a_real_key";   // only its prefix matters here
const load = async (env: Record<string, string>) => { vi.resetModules(); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); return import("../src/visitor"); };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("behind Cloudflare, a forged x-forwarded-for changes nothing", async () => {
  const { visitorAddress } = await load({ TRUST_PROXY: "true", CLIENT_IP_HEADER: "cf-connecting-ip" });
  const real = "41.1.2.3";
  // what Cloudflare passes on when a visitor sends their own x-forwarded-for: theirs first, the real one added after it
  expect(visitorAddress(headers({ "x-forwarded-for": `9.9.9.9, ${real}`, "cf-connecting-ip": real }), "127.0.0.1")).toBe(real);
  for (let i = 0; i < 5; i++) expect(visitorAddress(headers({ "x-forwarded-for": `9.9.9.${i}, ${real}`, "cf-connecting-ip": real }), "127.0.0.1")).toBe(real);
  // the named header missing means the request did not come through the proxy: the connection's own address, never the forgeable one
  expect(visitorAddress(headers({ "x-forwarded-for": "9.9.9.9" }), "10.0.0.7")).toBe("10.0.0.7");
});

test("without a named header the existing rules hold", async () => {
  expect((await load({ TRUST_PROXY: "true", CLIENT_IP_HEADER: "" })).visitorAddress(headers({ "x-forwarded-for": "41.1.2.3" }), "10.0.0.7")).toBe("41.1.2.3");
  expect((await load({ TRUST_PROXY: "false", CLIENT_IP_HEADER: "" })).visitorAddress(headers({ "x-forwarded-for": "9.9.9.9" }), "10.0.0.7")).toBe("10.0.0.7");
});

test("sign-in, code checks and session refresh tell Supabase the visitor, with a secret key only", async () => {
  const seen: Record<string, string | null> = {};
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { seen[new URL(url).pathname + new URL(url).search] = new Headers(init.headers).get("sb-forwarded-for"); return new Response(JSON.stringify({ error_code: "x" }), { status: 400, headers: { "content-type": "application/json" } }); });
  await load({ SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET_KEY, SUPABASE_URL: "https://x.supabase.co", DATABASE_URL: FAKE_DB });
  const v = await import("../src/visitor"), s = await import("../src/supabase");
  await v.asVisitor("41.1.2.3", async () => {
    await s.passwordLogin("a@example.test", "x"); await s.refreshSession("r");
    await s.verifySignupCode("a@example.test", "1").catch(() => {}); await s.verifyRecoveryCode("a@example.test", "1").catch(() => {});
  });
  expect(seen["/auth/v1/token?grant_type=password"]).toBe("41.1.2.3");
  expect(seen["/auth/v1/token?grant_type=refresh_token"]).toBe("41.1.2.3");
  expect(seen["/auth/v1/verify"]).toBe("41.1.2.3");
  await s.passwordLogin("a@example.test", "x");   // outside a request there is no visitor to name
  expect(seen["/auth/v1/token?grant_type=password"]).toBeNull();
});

test("nothing is forwarded for a key Supabase would not accept it with, or an address that is not a visitor's", async () => {
  const v = await load({});
  expect(v.asVisitor("41.1.2.3", () => v.forwardVisitor("eyJhbGciOi.legacy"))).toEqual({});
  for (const ip of ["127.0.0.1", "::1", "not an address", ""]) expect(v.asVisitor(ip, () => v.forwardVisitor("sb_secret_x")), ip).toEqual({});
  expect(v.asVisitor("41.1.2.3", () => v.forwardVisitor("sb_secret_x"))).toEqual({ "sb-forwarded-for": "41.1.2.3" });
});
