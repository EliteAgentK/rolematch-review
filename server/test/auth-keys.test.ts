import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeAuthKeys, writeAuthKeys } from "../src/scripts/authKeys";

// The copy's sign-in keys (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, C8): ES256 as Supabase's are, the service token signed by them, files private.
const parts = (t: string) => t.split(".");
const claims = (t: string) => JSON.parse(Buffer.from(parts(t)[1], "base64url").toString());

test("one P-256 signing key, and service tokens it verifies, naming the issuer", () => {
  const k = makeAuthKeys("http://127.0.0.1:9998", 1_800_000_000);
  const [jwk] = JSON.parse(k.jwtKeys);
  expect([jwk.kty, jwk.crv, jwk.alg, typeof jwk.d, jwk.key_ops]).toEqual(["EC", "P-256", "ES256", "string", ["sign", "verify"]]);
  const pub = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  for (const [token, role] of [[k.serviceRole, "service_role"], [k.anon, "anon"]] as const) {
    const [h, c, s] = parts(token);
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toMatchObject({ alg: "ES256", kid: jwk.kid });
    expect(claims(token)).toMatchObject({ iss: "http://127.0.0.1:9998", role });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  }
  expect(k.jwtSecret.length).toBeGreaterThanOrEqual(64);
  expect(() => makeAuthKeys("not an address")).toThrow(/issuer/);
});

test("the files are readable by their owner only, and never replaced", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rm-keys-")), "next");
  writeAuthKeys(dir, "http://127.0.0.1:9998");
  for (const f of ["jwt_keys.json", "jwt_secret", "service_role.jwt", "anon.jwt"]) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  const before = readFileSync(join(dir, "jwt_keys.json"), "utf8");
  expect(() => writeAuthKeys(dir, "http://127.0.0.1:9998")).toThrow(/never replaced/);
  expect(readFileSync(join(dir, "jwt_keys.json"), "utf8")).toBe(before);
});
