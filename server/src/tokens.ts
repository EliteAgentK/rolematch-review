// Checks a sign-in token on THIS server with the sign-in service's public key, so a person who is signed in stays signed in while that service is
// unreachable. Only Node's own crypto is used (no extra package). The public keys are fetched from the service's published key list, kept in memory,
// and kept on when a refresh fails: an outage of the sign-in service therefore never signs anyone out before their token runs out.
//
// What this does NOT do: it cannot see a sign-out or password change made elsewhere until the token expires (Supabase's default is one hour). That is
// why sign-outs through RoleMatch are remembered here (`forgetSession`), and why membership of an organisation is still checked in our own database on
// every request, so removing a person from an organisation takes effect at once.
import { createPublicKey, verify, type KeyObject } from "node:crypto";

interface TokenUser { id: string; email: string; name: string; sessionId: string; exp: number; signedInAt: number }
/** When the person signed in (seconds): the sign-in service records it in the signed token ("amr") and keeps it when the token is refreshed,
 * so a session's length is counted from the real sign-in. Checked against the dev project on 2026-10-27: iat moved on refresh, amr did not. */
export const signedInAtOf = (claims: any): number => {
  const times = Array.isArray(claims?.amr) ? claims.amr.map((a: any) => Number(a?.timestamp)).filter((t: number) => Number.isFinite(t) && t > 0) : [];
  return times.length ? Math.min(...times) : Number(claims?.iat) || 0;
};
/** `fallback` means "this server cannot decide, ask the sign-in service" (an old shared-secret token, or a key not seen yet). */
export type TokenCheck = { ok: true; user: TokenUser } | { ok: false; reason: string; fallback: boolean };

const ALGS: Record<string, { kty: string; curve?: string; dsaEncoding?: "ieee-p1363" }> = {
  ES256: { kty: "ec", curve: "prime256v1", dsaEncoding: "ieee-p1363" },
  RS256: { kty: "rsa" },
};
const SKEW_S = 30;            // clocks may differ a little between this server and the sign-in service
const KEYS_MAX_AGE = 10 * 60_000;
const REFRESH_EVERY = 30_000; // never ask for the key list more than once per 30 s, however many unknown tokens arrive

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** The sign-in service's public keys, by key id. */
export class KeySet {
  private keys = new Map<string, { key: KeyObject; alg: string }>();
  private fetchedAt = 0;
  private triedAt = -Infinity;
  constructor(private url: string, private fetcher: Fetcher = fetch, private now: () => number = Date.now) {}

  async get(kid: string): Promise<{ key: KeyObject; alg: string } | undefined> {
    const known = this.keys.get(kid);
    if (known && this.now() - this.fetchedAt < KEYS_MAX_AGE) return known;
    if (this.now() - this.triedAt >= REFRESH_EVERY) await this.refresh();
    return this.keys.get(kid); // when the refresh failed, the keys we already had still count
  }

  async refresh(): Promise<boolean> {
    this.triedAt = this.now();
    try {
      const res = await this.fetcher(this.url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const next = new Map<string, { key: KeyObject; alg: string }>();
      for (const jwk of (await res.json())?.keys ?? []) {
        if (typeof jwk?.kid !== "string" || !ALGS[jwk.alg] || (jwk.use && jwk.use !== "sig")) continue;
        try { next.set(jwk.kid, { key: createPublicKey({ key: jwk, format: "jwk" }), alg: jwk.alg }); } catch { /* a malformed key is skipped */ }
      }
      if (!next.size) return false;
      this.keys = next; this.fetchedAt = this.now();
      return true;
    } catch { return false; }
  }
}

const part = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export async function checkToken(token: string, keys: KeySet, opts: { issuer: string; now?: number }): Promise<TokenCheck> {
  const no = (reason: string, fallback = false): TokenCheck => ({ ok: false, reason, fallback });
  const pieces = token.split(".");
  if (pieces.length !== 3) return no("not a token");
  let header: any, claims: any;
  try { header = part(pieces[0]); claims = part(pieces[1]); } catch { return no("unreadable token"); }
  if (header?.alg === "HS256") return no("shared-secret token: only the sign-in service can check it", true);
  const want = ALGS[header?.alg];
  if (!want) return no(`algorithm not accepted: ${String(header?.alg)}`); // "none" and anything unexpected end here
  const found = typeof header.kid === "string" ? await keys.get(header.kid) : undefined;
  if (!found) return no("signed with a key this server does not have", true);
  if (found.alg !== header.alg || found.key.asymmetricKeyType !== want.kty || (want.curve && found.key.asymmetricKeyDetails?.namedCurve !== want.curve)) return no("key does not match the algorithm");
  const signed = Buffer.from(`${pieces[0]}.${pieces[1]}`), signature = Buffer.from(pieces[2], "base64url");
  let good = false;
  try { good = verify("sha256", signed, want.dsaEncoding ? { key: found.key, dsaEncoding: want.dsaEncoding } : found.key, signature); } catch { good = false; }
  if (!good) return no("signature does not match");
  const now = (opts.now ?? Date.now()) / 1000;
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S <= now) return no("expired");
  if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > now) return no("not valid yet");
  if (claims.iss !== opts.issuer) return no("issued by someone else");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes("authenticated") || claims.role !== "authenticated") return no("not a signed-in person's token"); // service and public keys are refused
  if (typeof claims.sub !== "string" || !claims.sub) return no("no person in the token");
  return { ok: true, user: { id: claims.sub, email: String(claims.email ?? ""), name: String(claims.user_metadata?.name ?? ""), sessionId: String(claims.session_id ?? ""), exp: claims.exp, signedInAt: signedInAtOf(claims) } };
}

/** Sessions signed out through RoleMatch, remembered until their tokens would have expired anyway. This is each server's own quick list; the list
 * shared by every server is in the database (signedOutAnywhere and shareSignOut in supabase.ts). */
const signedOut = new Map<string, number>();
export function forgetSession(sessionId: string, exp: number) {
  if (!sessionId) return;
  signedOut.set(sessionId, exp);
  const now = Date.now() / 1000;
  if (signedOut.size > 5000) for (const [s, e] of signedOut) if (e + SKEW_S < now) signedOut.delete(s);
}
export const isSignedOut = (sessionId: string) => !!sessionId && signedOut.has(sessionId);
