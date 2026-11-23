// Thin client for Supabase Auth and Storage. The service key never leaves this server.
import { config } from "./config";
import { fileVault, keysFrom } from "./fileVault";
import { platformSql as sql } from "./db";
import { shareSignOut, signedOutAnywhere } from "./signedOut";
import { checkToken, isSignedOut, KeySet, signedInAtOf } from "./tokens";
import { forwardVisitor } from "./visitor";

const base = config.supabaseUrl;
const authBase = config.authUrl;   // every /auth/v1 call below goes here (C1)
const key = config.supabaseKey;
const serviceHeaders = { apikey: key, authorization: `Bearer ${key}` };

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: body as any };
}

// ---------------------------------------------------------------- Auth
export interface AuthTokens { accessToken: string; refreshToken: string; expiresIn: number; userId: string; email: string; name: string; meta: Record<string, any> }

const tokensFrom = (b: any): AuthTokens => ({ accessToken: b.access_token, refreshToken: b.refresh_token, expiresIn: b.expires_in, userId: b.user.id, email: b.user.email, name: b.user.user_metadata?.name ?? "", meta: b.user.user_metadata ?? {} });

export async function adminCreateUser(email: string, password: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await json(await fetch(`${authBase}/admin/users`, { method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, ...extra } }) }));
  if (!r.ok) throw new Error(`Could not create user: ${r.body.msg ?? r.body.message ?? r.status}`);
  return r.body.id;
}
/** Refuses (or allows again) a person's sign-in, for the owner's console (docs/architecture/PLAN_CONSOLE_OPERATIONS.md): a ban until 100 years from now, or none. */
export async function adminSetBlocked(id: string, blocked: boolean) {
  const res = await fetch(`${authBase}/admin/users/${id}`, { method: "PUT", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ ban_duration: blocked ? "876000h" : "none" }) });
  if (!res.ok) throw new Error(`Could not ${blocked ? "block" : "allow"} sign-in (${res.status})`);
}
export async function adminDeleteUser(id: string) {
  const res = await fetch(`${authBase}/admin/users/${id}`, { method: "DELETE", headers: serviceHeaders });
  if (!res.ok) throw new Error(`Could not delete user (${res.status})`);
}
// ---- sign-up with an e-mailed 6-digit code ----
/**
 * Creates the unconfirmed user and returns the code WITHOUT Supabase sending any e-mail (we send our own branded message).
 * Returns null when the address already belongs to a confirmed account.
 */
export async function createSignupCode(email: string, password: string, data: Record<string, unknown>): Promise<string | null> {
  const r = await json(await fetch(`${authBase}/admin/generate_link`, { method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ type: "signup", email, password, data }) }));
  return r.ok ? (r.body.email_otp ?? r.body.properties?.email_otp ?? null) : null;
}
/**
 * A fresh code for a person who has not confirmed yet. It cancels the previous code and keeps their password and sign-up details.
 * The caller must first check that the account exists and is unconfirmed.
 */
export async function createFreshCode(email: string): Promise<string | null> {
  const r = await json(await fetch(`${authBase}/admin/generate_link`, { method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ type: "signup", email }) }));
  return r.ok ? (r.body.email_otp ?? r.body.properties?.email_otp ?? null) : null;
}
/** Confirms a sign-up code and signs the person in. */
export async function verifySignupCode(email: string, token: string): Promise<(AuthTokens & { meta: Record<string, any> }) | null> {
  const r = await json(await fetch(`${authBase}/verify`, { method: "POST", headers: { apikey: key, "content-type": "application/json", ...forwardVisitor(key) }, body: JSON.stringify({ type: "signup", email, token }) }));
  return r.ok && r.body.access_token ? { ...tokensFrom(r.body), meta: r.body.user?.user_metadata ?? {} } : null;
}

// ---- a forgotten password: the same kind of code, for a confirmed account
export async function createRecoveryCode(email: string): Promise<string | null> {
  const r = await json(await fetch(`${authBase}/admin/generate_link`, { method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ type: "recovery", email }) }));
  return r.ok ? (r.body.email_otp ?? r.body.properties?.email_otp ?? null) : null;
}
export async function verifyRecoveryCode(email: string, token: string): Promise<AuthTokens | null> {
  const r = await json(await fetch(`${authBase}/verify`, { method: "POST", headers: { apikey: key, "content-type": "application/json", ...forwardVisitor(key) }, body: JSON.stringify({ type: "recovery", email, token }) }));
  return r.ok && r.body.access_token ? tokensFrom(r.body) : null;
}
export async function setUserPassword(userId: string, password: string): Promise<boolean> {
  const r = await fetch(`${authBase}/admin/users/${userId}`, { method: "PUT", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ password }) });
  return r.ok;
}

export async function passwordLogin(email: string, password: string): Promise<AuthTokens | "unconfirmed" | null> {
  const r = await json(await fetch(`${authBase}/token?grant_type=password`, { method: "POST", headers: { apikey: key, "content-type": "application/json", ...forwardVisitor(key) }, body: JSON.stringify({ email, password }) }));
  if (r.ok) return tokensFrom(r.body);
  return r.body?.error_code === "email_not_confirmed" ? "unconfirmed" : null;
}
// ---- passkeys: the provider holds the credentials and runs the WebAuthn checks (passkeys.ts says what RoleMatch adds)
const providerError = (r: { status: number; body: any }) => ({ status: r.status, code: String(r.body?.error_code ?? r.body?.code ?? "unknown") });
export type PasskeyAnswer<T> = { ok: true; value: T } | { ok: false; status: number; code: string };
async function passkeyCall<T>(path: string, method: string, accessToken: string | null, body?: unknown): Promise<PasskeyAnswer<T>> {
  const r = await json(await fetch(`${authBase}/passkeys${path}`, { method, headers: { apikey: key, "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(AUTH_TIMEOUT) }));
  return r.ok ? { ok: true, value: r.body as T } : { ok: false, ...providerError(r) };
}
export const passkeySignInOptions = () => passkeyCall<any>("/authentication/options", "POST", null, {});
export async function passkeySignInVerify(challengeId: string, credential: unknown): Promise<PasskeyAnswer<AuthTokens>> {
  const r = await passkeyCall<any>("/authentication/verify", "POST", null, { challenge_id: challengeId, credential });
  return r.ok ? { ok: true, value: tokensFrom(r.value) } : r;
}
export const passkeyEnrolOptions = (accessToken: string) => passkeyCall<any>("/registration/options", "POST", accessToken, {});
export const passkeyEnrolVerify = (accessToken: string, challengeId: string, credential: unknown) => passkeyCall<{ id: string; friendly_name?: string; created_at: string }>("/registration/verify", "POST", accessToken, { challenge_id: challengeId, credential });
export const passkeyList = (accessToken: string) => passkeyCall<{ id: string; friendly_name?: string; created_at: string; last_used_at?: string }[]>("", "GET", accessToken);
export const passkeyRename = (accessToken: string, id: string, friendlyName: string) => passkeyCall<unknown>(`/${encodeURIComponent(id)}`, "PATCH", accessToken, { friendly_name: friendlyName });
export const passkeyDelete = (accessToken: string, id: string) => passkeyCall<unknown>(`/${encodeURIComponent(id)}`, "DELETE", accessToken);

export async function refreshSession(refreshToken: string): Promise<AuthTokens | null> {
  try {
    const r = await json(await fetch(`${authBase}/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: key, "content-type": "application/json", ...forwardVisitor(key) }, body: JSON.stringify({ refresh_token: refreshToken }), signal: AbortSignal.timeout(AUTH_TIMEOUT) }));
    return r.ok ? tokensFrom(r.body) : null;
  } catch { return null; } // the sign-in service is unreachable: the person signs in again once it is back
}

// A sign-in token is checked HERE with the sign-in service's public key, so people stay signed in while that service is down (src/tokens.ts).
// Only when this server cannot decide (an old shared-secret token, a key not seen yet) is the service asked, as before.
const AUTH_TIMEOUT = 5000;
const signingKeys = new KeySet(`${authBase}/.well-known/jwks.json`);
const issuer = authBase;
const verified = new Map<string, { id: string; email: string; name: string; until: number; sessionId: string; exp: number; signedInAt: number }>();

/** The sessions a person has now. Read before their password changes: the provider deletes its session rows at that moment, while tokens it already issued stay valid until they expire. */
export const sessionsOf = async (email: string) => ((await sql`select s.id from auth.sessions s join auth.users u on u.id = s.user_id where lower(u.email) = ${email}`) as { id: string }[]).map((r) => r.id);
/** Ends these sessions at once on every server, so someone who had the old password does not stay signed in. An access token lives at most a day. */
export async function endSessions(ids: string[]) {
  const until = Math.floor(Date.now() / 1000) + 86_400;
  for (const id of ids) await shareSignOut(id, until);
}

export async function verifyAccessToken(token: string) {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now() && !isSignedOut(hit.sessionId)) return hit;
  verified.delete(token);
  const local = await checkToken(token, signingKeys, { issuer });
  let v: { id: string; email: string; name: string; until: number; sessionId: string; exp: number; signedInAt: number };
  if (local.ok) {
    if (await signedOutAnywhere(local.user.sessionId, local.user.exp)) return null;
    v = { ...local.user, until: Math.min(Date.now() + config.tokenRecheckMs, local.user.exp * 1000) };
  } else if (local.fallback) {
    try {
      const r = await json(await fetch(`${authBase}/user`, { headers: { apikey: key, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(AUTH_TIMEOUT) }));
      if (!r.ok) return null;
      // The sign-in service has just confirmed the token is genuine, so its own record of the sign-in time can be read from it
      let claims: any = {}; try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch { /* none */ }
      v = { id: r.body.id as string, email: r.body.email as string, name: (r.body.user_metadata?.name ?? "") as string, until: Date.now() + config.tokenRecheckMs, sessionId: "", exp: 0, signedInAt: signedInAtOf(claims) };
    } catch { return null; }
  } else return null;
  verified.set(token, v);
  if (verified.size > 2000) for (const [k, x] of verified) if (x.until < Date.now()) verified.delete(k);
  return v;
}
export async function signOut(token: string) {
  const hit = verified.get(token);
  verified.delete(token);
  const local = await checkToken(token, signingKeys, { issuer });
  if (local.ok) await shareSignOut(local.user.sessionId, local.user.exp);
  else if (hit?.sessionId) await shareSignOut(hit.sessionId, hit.exp);
  await fetch(`${authBase}/logout`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(AUTH_TIMEOUT) }).catch(() => {});
}
/** Ends just this one session (the provider's default sign-out ends all of a person's sessions, which would include the one just created). */
export async function signOutOnly(token: string) {
  const local = await checkToken(token, signingKeys, { issuer });
  verified.delete(token);
  if (local.ok) await shareSignOut(local.user.sessionId, local.user.exp);
  await fetch(`${authBase}/logout?scope=local`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(AUTH_TIMEOUT) }).catch(() => {});
}

// ---------------------------------------------------------------- Storage (private bucket)
const objectUrl = (path: string) => `${base}/storage/v1/object/${config.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;

/** The file store could not take this just now. Nothing was stored; the person's browser waits and tries again. */
export class StoreBusy extends Error {}
const STORE_AT_ONCE = Number(process.env.STORE_CONCURRENCY ?? 16), STORE_RETRY_MS = Number(process.env.STORE_RETRY_MS ?? 400);
let storing = 0; const waitingToStore: (() => void)[] = [];
/** A crowd of uploads must not become a crowd at the file store: each server sends a bounded number at once. The line behind them is short too, because a request waiting here is holding one of the server's hands: past it the answer is "busy" at once, and the browser's sender waits. */
async function storeTurn<T>(work: () => Promise<T>): Promise<T> {
  if (storing >= STORE_AT_ONCE) {
    if (waitingToStore.length >= Number(process.env.STORE_QUEUE ?? STORE_AT_ONCE)) throw new StoreBusy("the line at the file store is full");
    await new Promise<void>((go) => waitingToStore.push(go));
  }
  storing++;
  try { return await work(); } finally { storing--; waitingToStore.shift()?.(); }
}
/** Our own file vault on this machine (src/fileVault.ts, docs/database/19_VAULT_V1.md) when STORE_DIR is set: encrypted, bound to each path, written whole.
 *  Without VAULT_KEYS it refuses to start, so originals are never written plain. */
const localStore = process.env.STORE_DIR ? fileVault(process.env.STORE_DIR, keysFrom(process.env.VAULT_KEYS ?? "")) : null;
export async function putObject(path: string, bytes: Uint8Array, contentType: string) {
  if (localStore) return localStore.put(path, bytes);
  return storeTurn(async () => {
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, STORE_RETRY_MS * attempt * (1 + Math.random())));
      const res = await fetch(objectUrl(path), { method: "POST", headers: { ...serviceHeaders, "content-type": contentType, "x-upsert": "true" }, body: bytes as unknown as BodyInit }).catch((e) => { last = String(e?.cause?.code ?? e?.message ?? e); return null; });
      if (res?.ok) return;
      if (res && res.status < 500 && res.status !== 429) throw new Error(`Storage upload failed (${res.status})`);
      if (res) last = String(res.status);
    }
    throw new StoreBusy(`the file store is busy (${last})`);
  });
}
export async function getObject(path: string): Promise<Uint8Array> {
  if (localStore) return localStore.get(path);
  const res = await fetch(objectUrl(path), { headers: serviceHeaders });
  if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
/** With strict, a failed deletion throws, so the queue retries it instead of silently leaving a private file behind. */
export async function deleteObjects(paths: string[], opts: { strict?: boolean } = {}) {
  if (!paths.length) return;
  if (localStore) return localStore.remove(paths);
  const res = await fetch(`${base}/storage/v1/object/${config.bucket}`, { method: "DELETE", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  if (opts.strict && !res.ok) throw new Error(`storage delete failed (${res.status})`);
}
/** A short-lived link to one object, for future direct downloads. The API currently streams files itself so every view is audited. */
export async function signedUrl(path: string, seconds = 60): Promise<string> {
  const r = await json(await fetch(`${base}/storage/v1/object/sign/${config.bucket}/${path}`, { method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: seconds }) }));
  if (!r.ok) throw new Error("Could not sign URL");
  return `${base}/storage/v1${r.body.signedURL}`;
}
