// Our own sign-in (docs/database/20_IDENTITY_V1.md, slice 2), the same interface as Supabase's (src/identity.ts), on our own tables (036_own_identity.sql).
// Off until IDENTITY=own. Each function keeps the meaning auth.ts relies on from the Supabase one it replaces; where ours is stricter, it says so.
//   Passwords: argon2id (src/passwords.ts). Codes: 6 digits, kept as an HMAC under IDENTITY_CODE_KEY, one live code per account and purpose, used once,
//   OTP_EXPIRY_MINUTES long; the attempt limits stay in auth.ts, as today. Access tokens: ES256, 15 minutes (Supabase's: 1 hour), checked by tokens.ts.
//   Sessions: a refresh token that changes at every use, stored as a hash; the one before it is remembered, so a copied token used after the real one ends
//   the session (stricter than today), unless it comes within REUSE_GRACE_SECONDS, from the same page load, when it gets the same replacement. A session ends after 7 days unused and 30 days whatever happens.
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { platformSql as sql, type Q } from "./db";
import type { Identity } from "./identity";
import { hashPassword, verifyPassword } from "./passwords";
import { shareSignOut, signedOutAnywhere } from "./signedOut";
import type { AuthTokens, PasskeyAnswer } from "./supabase";
import { ownKeySet, signAccessToken, type SignerKey } from "./tokenSigner";
import { checkToken, isSignedOut } from "./tokens";

const ACCESS_SECONDS = 15 * 60, IDLE_DAYS = 7, ABSOLUTE_DAYS = 30;
/** How long after a refresh token is replaced it still leads to its replacement rather than ending the session: long enough for the other requests of one
 * page load, as Supabase's own reuse interval (10 seconds by default). */
const REUSE_GRACE_SECONDS = 10;
// How long finished rows are kept (data-classes.json): an ended session for 90 days, so a reused token or a sign-out can be looked into for a quarter
// (one never signed out counts as ended at its 30-day limit); a code for 2 days after it was issued, as signup_challenges and password_resets.
const ENDED_KEPT_DAYS = 90, CODES_KEPT_DAYS = 2;
type Account = { id: string; email: string; meta: Record<string, any>; confirmed_at: Date | null; password_hash: string | null };
const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const noPasskeys = async (): Promise<PasskeyAnswer<any>> => ({ ok: false, status: 501, code: "passkeys_not_available" });
// Checking a password for an address with no account costs the same as for one with an account, so the time taken does not tell which addresses exist.
let decoy: Promise<string> | null = null;

export function ownIdentity(o: { signer: SignerKey; issuer: string; codeKey: Buffer; db?: typeof sql }): Identity {
  if (o.codeKey.length < 32) throw new Error("IDENTITY_CODE_KEY must be at least 32 bytes, base64-encoded (openssl rand -base64 32)");
  const db = o.db ?? sql, keys = ownKeySet(o.signer);
  const digest = (accountId: string, purpose: string, code: string) => createHmac("sha256", o.codeKey).update(`${purpose}|${accountId}|${code}`).digest("hex");
  const verified = new Map<string, { id: string; email: string; name: string; until: number; sessionId: string; exp: number; signedInAt: number }>();
  const nameOf = (a: Account) => String(a.meta?.name ?? "");
  /** The refresh token that replaces `presented`: derived from it under the server's key, so the same old token always leads to the same new one, and
   * nobody without the key can work it out. A first token (at sign-in) is random. */
  const nextToken = (sessionId: string, presented: string) => createHmac("sha256", o.codeKey).update(`refresh|${sessionId}|${presented}`).digest("base64url");

  const account = async (email: string, q: Q = db) => ((await q`select id, email, meta, confirmed_at, password_hash from identity_accounts where email = ${norm(email)}`)[0] as Account | undefined) ?? null;
  const tokensFor = (a: Account, sessionId: string, signedInAt: number, refresh: string): AuthTokens => ({
    accessToken: signAccessToken(o.signer, o.issuer, { sub: a.id, email: a.email, name: nameOf(a), sessionId, signedInAt, ttlSeconds: ACCESS_SECONDS }),
    refreshToken: refresh, expiresIn: ACCESS_SECONDS, userId: a.id, email: a.email, name: nameOf(a), meta: a.meta ?? {} });
  async function startSession(a: Account, q: Q = db) {
    const id = randomUUID(), refresh = randomBytes(32).toString("base64url");
    await q`delete from identity_sessions where coalesce(ended_at, ends_at) < now() - (${ENDED_KEPT_DAYS} * interval '1 day')`;
    const [s] = await q`insert into identity_sessions (id, account_id, refresh_hash, ends_at) values (${id}, ${a.id}, ${sha(refresh)}, now() + (${ABSOLUTE_DAYS} * interval '1 day'))
      returning extract(epoch from signed_in_at)::bigint as at`;
    return tokensFor(a, id, Number(s.at), refresh);
  }
  async function endOpen(where: { accountId?: string; ids?: string[] }, why: string, q: Q = db) {
    const rows = where.ids
      ? await q`update identity_sessions set ended_at = now(), ended_why = ${why} where id = any(${where.ids}::uuid[]) and ended_at is null returning id`
      : await q`update identity_sessions set ended_at = now(), ended_why = ${why} where account_id = ${where.accountId!} and ended_at is null returning id`;
    // Access tokens already given out stop working on every server at once, not when they run out.
    const until = Math.floor(Date.now() / 1000) + ACCESS_SECONDS + 60;
    for (const r of rows) await shareSignOut(r.id as string, until);
  }
  async function newCode(a: Account, purpose: "signup" | "recovery", q: Q) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await q`delete from identity_codes where issued_at < now() - (${CODES_KEPT_DAYS} * interval '1 day')`;
    await q`update identity_codes set superseded_at = now() where account_id = ${a.id} and purpose = ${purpose} and used_at is null and superseded_at is null`;
    await q`insert into identity_codes (account_id, purpose, digest) values (${a.id}, ${purpose}, ${digest(a.id, purpose, code)})`;
    return code;
  }
  /** The account whose live, unexpired code this is, with the code now used; null otherwise. */
  async function useCode(email: string, purpose: "signup" | "recovery", code: string, q: Q) {
    const a = await account(email, q);
    if (!a || !/^\d{6}$/.test(String(code ?? "").trim())) return null;
    const want = Buffer.from(digest(a.id, purpose, String(code).trim()), "hex");
    const live = await q`select id, digest from identity_codes where account_id = ${a.id} and purpose = ${purpose} and used_at is null and superseded_at is null
      and issued_at > now() - (${config.otpExpiryMinutes} * interval '1 minute') for update`;
    const hit = live.find((c: any) => timingSafeEqual(Buffer.from(c.digest, "hex"), want));
    if (!hit) return null;
    await q`update identity_codes set used_at = now() where id = ${hit.id}`;
    return a;
  }
  const locked = <T>(email: string, work: (q: Q) => Promise<T>) => db.begin(async (q) => { await q`select pg_advisory_xact_lock(hashtext(${"identity:" + norm(email)}))`; return work(q); }) as Promise<T>;

  return {
    async adminCreateUser(email, password, name, extra = {}) {
      const id = randomUUID(), hash = await hashPassword(password);
      try { await db`insert into identity_accounts (id, email, password_hash, password_set_at, confirmed_at, meta) values (${id}, ${norm(email)}, ${hash}, now(), now(), ${db.json({ name, ...extra } as any)})`; }
      catch (e: any) { throw new Error(`Could not create user: ${e?.code === "23505" ? "a user with this email address has already been registered" : "database error"}`); }
      return id;
    },
    // Blocking sign-in from the owner's console is not part of our own sign-in yet: it says so rather than seeming to work (docs/database/20_IDENTITY_V1.md).
    async adminSetBlocked() { throw new Error("Blocking sign-in is not available with our own sign-in yet."); },
    async adminDeleteUser(id) {
      await endOpen({ accountId: id }, "account deleted");
      const r = await db`delete from identity_accounts where id = ${id} returning id`;
      if (!r.length) throw new Error("Could not delete user (404)");
    },
    createSignupCode: (email, password, data) => hashPassword(password).then((hash) => locked(email, async (q) => {
      const a = await account(email, q);
      if (a?.confirmed_at) return null;
      const row = a
        ? (await q`update identity_accounts set password_hash = ${hash}, password_set_at = now(), meta = ${q.json(data as any)} where id = ${a.id} returning id, email, meta, confirmed_at, password_hash`)[0]
        : (await q`insert into identity_accounts (id, email, password_hash, password_set_at, meta) values (${randomUUID()}, ${norm(email)}, ${hash}, now(), ${q.json(data as any)}) returning id, email, meta, confirmed_at, password_hash`)[0];
      return newCode(row as Account, "signup", q);
    })),
    createFreshCode: (email) => locked(email, async (q) => { const a = await account(email, q); return a && !a.confirmed_at ? newCode(a, "signup", q) : null; }),
    verifySignupCode: (email, token) => locked(email, async (q) => {
      const a = await useCode(email, "signup", token, q);
      if (!a) return null;
      if (!a.confirmed_at) await q`update identity_accounts set confirmed_at = now() where id = ${a.id}`;
      return { ...(await startSession(a, q)), meta: a.meta ?? {} };
    }),
    createRecoveryCode: (email) => locked(email, async (q) => { const a = await account(email, q); return a?.confirmed_at ? newCode(a, "recovery", q) : null; }),
    verifyRecoveryCode: (email, token) => locked(email, async (q) => {
      const a = await useCode(email, "recovery", token, q);
      return a?.confirmed_at ? startSession(a, q) : null;
    }),
    async setUserPassword(userId, password) {
      const r = await db`update identity_accounts set password_hash = ${await hashPassword(password)}, password_set_at = now() where id = ${userId} returning id`;
      if (!r.length) return false;
      await endOpen({ accountId: userId }, "password changed");   // as Supabase: a new password ends the sessions the old one opened
      return true;
    },
    async passwordLogin(email, password) {
      const a = await account(email);
      if (!a?.password_hash) { await verifyPassword(password, await (decoy ??= hashPassword(randomBytes(16).toString("hex")))); return null; }
      if (!(await verifyPassword(password, a.password_hash))) return null;
      if (!a.confirmed_at) return "unconfirmed";
      return startSession(a);
    },
    async refreshSession(refreshToken) {
      const presented = String(refreshToken ?? ""), h = sha(presented);
      return db.begin(async (q) => {
        const [s] = await q`select s.id, s.ends_at, s.refreshed_at, s.ended_at, extract(epoch from s.signed_in_at)::bigint as at, a.id as account_id, a.email, a.meta, a.confirmed_at, a.password_hash,
          s.ends_at < now() or s.refreshed_at < now() - (${IDLE_DAYS} * interval '1 day') as expired
          from identity_sessions s join identity_accounts a on a.id = s.account_id where s.refresh_hash = ${h} for update of s`;
        if (!s) {
          const [old] = await q`select s.id, s.refresh_hash, extract(epoch from s.signed_in_at)::bigint as at, s.refreshed_at > now() - (${REUSE_GRACE_SECONDS} * interval '1 second') as just_now,
            a.id as account_id, a.email, a.meta, a.confirmed_at, a.password_hash
            from identity_sessions s join identity_accounts a on a.id = s.account_id where s.previous_hash = ${h} and s.ended_at is null for update of s`;
          // The token before the current one, presented again within seconds of being replaced: another request of the same page load, sent before the
          // new cookie arrived. It is given the same new token rather than taken for a copy (code review, 16 Nov 2026, A-M11: a page that sent several
          // requests at once when the access token ran out had its whole session ended as "reused"). The new token is derived from the old one under the
          // server's key, so it can be given again without being stored as itself.
          if (old?.just_now) {
            const next = nextToken(old.id as string, presented);
            if (sha(next) === old.refresh_hash) return tokensFor({ id: old.account_id, email: old.email, meta: old.meta, confirmed_at: old.confirmed_at, password_hash: old.password_hash }, old.id as string, Number(old.at), next);
          }
          // Later than that: someone holds a copy. The whole session ends.
          if (old) await endOpen({ ids: [old.id as string] }, "reused token", q);
          return null;
        }
        if (s.ended_at) return null;
        if (s.expired) { await endOpen({ ids: [s.id as string] }, "expired", q); return null; }
        const next = nextToken(s.id as string, presented);
        await q`update identity_sessions set previous_hash = refresh_hash, refresh_hash = ${sha(next)}, refreshed_at = now() where id = ${s.id}`;
        return tokensFor({ id: s.account_id, email: s.email, meta: s.meta, confirmed_at: s.confirmed_at, password_hash: s.password_hash }, s.id as string, Number(s.at), next);
      });
    },
    sessionsOf: async (email) => ((await db`select s.id from identity_sessions s join identity_accounts a on a.id = s.account_id where a.email = ${norm(email)} and s.ended_at is null`) as { id: string }[]).map((r) => r.id),
    endSessions: (ids) => endOpen({ ids }, "ended by request"),
    async verifyAccessToken(token) {
      const hit = verified.get(token);
      if (hit && hit.until > Date.now() && !isSignedOut(hit.sessionId)) return hit;
      verified.delete(token);
      const local = await checkToken(token, keys, { issuer: o.issuer });
      if (!local.ok || (await signedOutAnywhere(local.user.sessionId, local.user.exp))) return null;
      const v = { ...local.user, until: Math.min(Date.now() + config.tokenRecheckMs, local.user.exp * 1000) };
      verified.set(token, v);
      if (verified.size > 2000) for (const [k, x] of verified) if (x.until < Date.now()) verified.delete(k);
      return v;
    },
    async signOut(token) {   // as Supabase's default: every session of this person
      verified.delete(token);
      const local = await checkToken(token, keys, { issuer: o.issuer });
      if (local.ok) await endOpen({ accountId: local.user.id }, "signed out");
    },
    async signOutOnly(token) {
      verified.delete(token);
      const local = await checkToken(token, keys, { issuer: o.issuer });
      if (local.ok && local.user.sessionId) await endOpen({ ids: [local.user.sessionId] }, "signed out");
    },
    passkeySignInOptions: noPasskeys, passkeySignInVerify: noPasskeys, passkeyEnrolOptions: noPasskeys, passkeyEnrolVerify: noPasskeys,
    passkeyList: noPasskeys, passkeyRename: noPasskeys, passkeyDelete: noPasskeys,
    async accountCreatedAt(userId) { const [a] = await db`select created_at::text as at from identity_accounts where id = ${userId}`; return a ? (a.at as string) : null; },
    async isConfirmed(email, q = db) { return (await q`select 1 from identity_accounts where email = ${norm(email)} and confirmed_at is not null`).length > 0; },
    async pendingSignupName(email) { const [a] = await db`select meta->>'name' as name from identity_accounts where email = ${norm(email)} and confirmed_at is null`; return a ? (a.name ?? "") : null; },
    async confirmedName(email) { const [a] = await db`select meta->>'name' as name from identity_accounts where email = ${norm(email)} and confirmed_at is not null`; return a ? (a.name ?? "") : null; },
  };
}
