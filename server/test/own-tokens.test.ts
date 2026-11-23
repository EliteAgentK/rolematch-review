// Our own access tokens and passwords (docs/database/20_IDENTITY_V1.md, slice 2): the token checker live uses today accepts our tokens with our public key,
// and refuses them changed, expired, from another issuer or signed by another key; the public key carries no secret; passwords are argon2id.
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../src/passwords";
import { ownKeySet, signAccessToken, signerKeyFrom } from "../src/tokenSigner";
import { checkToken } from "../src/tokens";

const newKey = (kid = "own-1") => JSON.stringify({ ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }), kid });
const ISS = "https://app.rolematch.co.za/identity", PERSON = { sub: "6f1c2a9e-0b4d-4c7e-9a51-3d2e8f7b6a10", email: "thandi@mail.example", name: "Thandi Mokoena", sessionId: "s-1", signedInAt: 1_800_000_000, ttlSeconds: 900 };

test("the checker live uses accepts our token, with who, which session and when they signed in", async () => {
  const k = signerKeyFrom(newKey()), now = 1_800_000_100_000;
  const r = await checkToken(signAccessToken(k, ISS, { ...PERSON, now }), ownKeySet(k), { issuer: ISS, now });
  expect(r).toEqual({ ok: true, user: { id: PERSON.sub, email: PERSON.email, name: PERSON.name, sessionId: "s-1", exp: 1_800_000_100 + 900, signedInAt: 1_800_000_000 } });
});

test("a changed, expired, foreign or wrongly signed token is refused", async () => {
  const k = signerKeyFrom(newKey()), other = signerKeyFrom(newKey()), now = 1_800_000_100_000, t = signAccessToken(k, ISS, { ...PERSON, now });
  const [h, c, s] = t.split("."), claims = JSON.parse(Buffer.from(c, "base64url").toString());
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: "someone-else" })).toString("base64url")}.${s}`;
  expect((await checkToken(forged, ownKeySet(k), { issuer: ISS, now })).ok).toBe(false);
  expect((await checkToken(t, ownKeySet(k), { issuer: ISS, now: now + 901_000 + 31_000 })).ok).toBe(false);
  expect((await checkToken(t, ownKeySet(k), { issuer: "https://elsewhere.example/auth/v1", now })).ok).toBe(false);
  expect((await checkToken(t, ownKeySet(other), { issuer: ISS, now })).ok).toBe(false);   // same kid, another key
});

test("the public key holds no private part, and a key that is not P-256 with a kid is refused", () => {
  const k = signerKeyFrom(newKey());
  expect(k.publicJwk).not.toHaveProperty("d");
  expect(k.publicJwk).toMatchObject({ kty: "EC", crv: "P-256", kid: "own-1", alg: "ES256", use: "sig" });
  expect(() => signerKeyFrom("not json")).toThrow(/JWK/);
  expect(() => signerKeyFrom(JSON.stringify({ ...JSON.parse(newKey()), kid: undefined }))).toThrow(/kid/);
  expect(() => signerKeyFrom(JSON.stringify({ ...generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" }), kid: "r" }))).toThrow(/P-256/);
});

test("passwords are argon2id: the right one passes, a wrong one does not, and two hashes of one password differ", async () => {
  const a = await hashPassword("a long sign-in passphrase"), b = await hashPassword("a long sign-in passphrase");
  expect(a).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  expect(a).not.toBe(b);
  expect(await verifyPassword("a long sign-in passphrase", a)).toBe(true);
  expect(await verifyPassword("a long sign-in passphrasE", a)).toBe(false);
  expect(await verifyPassword("anything", "$2a$10$notargon")).toBe(false);
});
