// Sign-in tokens checked on our own server (src/tokens.ts): the right person gets in, forged or misused tokens never do, and an outage of the sign-in
// service signs nobody out. Keys are generated here; nothing is sent anywhere.
import { expect, test } from "vitest";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { checkToken, forgetSession, isSignedOut, KeySet } from "../src/tokens";

const ISSUER = "https://example.test/auth/v1";
const pair = () => { const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }); return { privateKey, jwk: { ...publicKey.export({ format: "jwk" }), alg: "ES256", use: "sig", kid: "k1" } }; };
const { privateKey, jwk } = pair();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const goodClaims = { sub: "user-1", email: "pat@example.test", user_metadata: { name: "Pat" }, session_id: "s-1", aud: "authenticated", role: "authenticated", iss: ISSUER, exp: now + 3600 };
function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = privateKey) {
  const h = b64({ alg: "ES256", kid: "k1", typ: "JWT", ...header }), p = b64({ ...goodClaims, ...claims });
  return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
const serving = (keys: unknown[]) => { const calls = { n: 0 }; return { calls, fetcher: async () => { calls.n++; return { ok: true, json: async () => ({ keys }) }; } }; };

test("a genuine token is accepted and names the person", async () => {
  const r = await checkToken(token(), new KeySet("x", serving([jwk]).fetcher), { issuer: ISSUER });
  expect(r).toMatchObject({ ok: true, user: { id: "user-1", email: "pat@example.test", name: "Pat", sessionId: "s-1" } });
});

test("forged, expired, foreign and misused tokens are refused, with no second chance from the sign-in service", async () => {
  const keys = new KeySet("x", serving([jwk]).fetcher);
  const refused = async (t: string) => { const r = await checkToken(t, keys, { issuer: ISSUER }); expect(r.ok).toBe(false); return r as { ok: false; fallback: boolean; reason: string }; };
  expect((await refused(token({}, {}, pair().privateKey))).reason).toMatch(/signature/);     // signed by someone else's key
  const t = token(); const [h, , s] = t.split("."); expect((await refused(`${h}.${b64({ ...goodClaims, sub: "admin" })}.${s}`)).reason).toMatch(/signature/); // claims altered
  expect((await refused(token({ exp: now - 120 }))).reason).toMatch(/expired/);
  expect((await refused(token({ iss: "https://evil.test/auth/v1" }))).reason).toMatch(/issued/);
  expect((await refused(token({ role: "service_role" }))).reason).toMatch(/signed-in person/);  // a service key is not a person's sign-in
  expect((await refused(token({ aud: "other" }))).reason).toMatch(/signed-in person/);
  expect((await refused(`${b64({ alg: "none", kid: "k1" })}.${b64(goodClaims)}.`)).reason).toMatch(/not accepted/);
  expect((await refused("not.a-token")).fallback).toBe(false);
  for (const r of [await refused(token({ exp: now - 120 })), await refused(token({}, {}, pair().privateKey))]) expect(r.fallback).toBe(false);
});

test("an RSA key cannot be used to pass off an ES256 token, and a shared-secret token is left to the sign-in service", async () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
  const r = await checkToken(token(), new KeySet("x", serving([{ ...rsa, alg: "RS256", kid: "k1" }]).fetcher), { issuer: ISSUER });
  expect(r.ok).toBe(false);
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(goodClaims), hs = `${h}.${p}.${createHmac("sha256", "secret").update(`${h}.${p}`).digest("base64url")}`;
  expect(await checkToken(hs, new KeySet("x", serving([jwk]).fetcher), { issuer: ISSUER })).toMatchObject({ ok: false, fallback: true });
});

test("when the sign-in service is down, people already signed in stay signed in", async () => {
  let up = true, clock = Date.now();
  const fetcher = async () => { if (!up) throw new Error("unreachable"); return { ok: true, json: async () => ({ keys: [jwk] }) }; };
  const keys = new KeySet("x", fetcher, () => clock);
  expect((await checkToken(token(), keys, { issuer: ISSUER })).ok).toBe(true);
  up = false; clock += 60 * 60_000; // an hour later the keys are stale and the service is down
  expect((await checkToken(token(), keys, { issuer: ISSUER })).ok).toBe(true);
});

test("the key list is fetched once, not once per request, and an unknown key cannot make us hammer the service", async () => {
  const { calls, fetcher } = serving([jwk]);
  const keys = new KeySet("x", fetcher);
  for (let i = 0; i < 20; i++) await checkToken(token(), keys, { issuer: ISSUER });
  for (let i = 0; i < 20; i++) expect(await checkToken(token({}, { kid: "unknown" }), keys, { issuer: ISSUER })).toMatchObject({ ok: false, fallback: true });
  expect(calls.n).toBe(1);
});

test("a rotated key is picked up, and a key withdrawn from the list stops working", async () => {
  let served = [jwk]; let clock = Date.now();
  const keys = new KeySet("x", async () => ({ ok: true, json: async () => ({ keys: served }) }), () => clock);
  expect((await checkToken(token(), keys, { issuer: ISSUER })).ok).toBe(true);
  const next = pair(); served = [{ ...next.jwk, kid: "k2" }]; clock += 31_000;
  expect((await checkToken(token({}, { kid: "k2" }, next.privateKey), keys, { issuer: ISSUER })).ok).toBe(true);
  clock += 11 * 60_000; // past the keys' maximum age: the list is re-read and the withdrawn k1 is gone
  expect((await checkToken(token(), keys, { issuer: ISSUER })).ok).toBe(false);
});

test("a session signed out through RoleMatch is remembered until its token would expire", () => {
  expect(isSignedOut("s-9")).toBe(false);
  forgetSession("s-9", now + 3600);
  expect(isSignedOut("s-9")).toBe(true);
  forgetSession("", now + 3600); expect(isSignedOut("")).toBe(false);
});
