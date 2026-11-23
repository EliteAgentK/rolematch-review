// Our own access tokens (docs/database/20_IDENTITY_V1.md): ES256, shaped like the sign-in tokens RoleMatch checks today, so the same checker (tokens.ts)
// accepts them with our public key in place of Supabase's key list. The private key is IDENTITY_SIGNING_KEY (a P-256 private JWK with its "kid"), held in
// the host's root-only settings file; it never reaches the database, a log or a token. Only Node's own crypto is used.
import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { KeySet } from "./tokens";

export interface SignerKey { kid: string; privateKey: KeyObject; publicJwk: Record<string, unknown> }

export function signerKeyFrom(jwkText: string): SignerKey {
  let jwk: any;
  try { jwk = JSON.parse(jwkText); } catch { throw new Error("IDENTITY_SIGNING_KEY must be a P-256 private key as JWK JSON"); }
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || typeof jwk?.d !== "string" || typeof jwk?.kid !== "string" || !jwk.kid) throw new Error("IDENTITY_SIGNING_KEY must be a P-256 private key as JWK JSON, with a kid");
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" }), { d: _secret, ...pub } = createPublicKey(privateKey).export({ format: "jwk" }) as any;
  return { kid: jwk.kid, privateKey, publicJwk: { ...pub, kid: jwk.kid, alg: "ES256", use: "sig" } };
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** One access token for one session. `signedInAt` (seconds) is kept across refreshes, so a session's length counts from the real sign-in. */
export function signAccessToken(k: SignerKey, issuer: string, c: { sub: string; email: string; name: string; sessionId: string; signedInAt: number; ttlSeconds: number; now?: number }) {
  const iat = Math.floor((c.now ?? Date.now()) / 1000);
  const claims = { iss: issuer, aud: "authenticated", role: "authenticated", sub: c.sub, email: c.email, session_id: c.sessionId, iat, exp: iat + c.ttlSeconds,
    amr: [{ method: "password", timestamp: c.signedInAt }], user_metadata: { name: c.name } };
  const head = `${b64url({ alg: "ES256", typ: "JWT", kid: k.kid })}.${b64url(claims)}`;
  return `${head}.${sign("sha256", Buffer.from(head), { key: k.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

/** The checker's key list, holding only our public key: nothing is fetched. */
export const ownKeySet = (k: SignerKey) => new KeySet("own", async () => ({ ok: true, json: async () => ({ keys: [k.publicJwk] }) }));
