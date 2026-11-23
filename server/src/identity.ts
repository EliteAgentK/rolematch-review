// Who someone is, behind one interface (docs/database/20_IDENTITY_V1.md): accounts, passwords, codes, sessions and access tokens. Today it is Supabase Auth;
// our own implementation is built beside it and passes the same contract tests before IDENTITY=own replaces it. Nothing outside this file reaches the
// provider's sign-in or its tables directly, so the switch is one setting, and so is the way back.
import { config } from "./config";
import { platformSql as sql, type Q } from "./db";
import { ownIdentity } from "./ownIdentity";
import * as supabase from "./supabase";
import { signerKeyFrom } from "./tokenSigner";

export type { AuthTokens } from "./supabase";

export interface Identity {
  adminCreateUser: typeof supabase.adminCreateUser;
  adminDeleteUser: typeof supabase.adminDeleteUser;
  adminSetBlocked: typeof supabase.adminSetBlocked;
  createSignupCode: typeof supabase.createSignupCode;
  createFreshCode: typeof supabase.createFreshCode;
  verifySignupCode: typeof supabase.verifySignupCode;
  createRecoveryCode: typeof supabase.createRecoveryCode;
  verifyRecoveryCode: typeof supabase.verifyRecoveryCode;
  setUserPassword: typeof supabase.setUserPassword;
  passwordLogin: typeof supabase.passwordLogin;
  refreshSession: typeof supabase.refreshSession;
  sessionsOf: typeof supabase.sessionsOf;
  endSessions: typeof supabase.endSessions;
  verifyAccessToken: typeof supabase.verifyAccessToken;
  signOut: typeof supabase.signOut;
  signOutOnly: typeof supabase.signOutOnly;
  passkeySignInOptions: typeof supabase.passkeySignInOptions;
  passkeySignInVerify: typeof supabase.passkeySignInVerify;
  passkeyEnrolOptions: typeof supabase.passkeyEnrolOptions;
  passkeyEnrolVerify: typeof supabase.passkeyEnrolVerify;
  passkeyList: typeof supabase.passkeyList;
  passkeyRename: typeof supabase.passkeyRename;
  passkeyDelete: typeof supabase.passkeyDelete;
  /** When the account was created, exactly as the database holds it (to the microsecond, for comparison in SQL), or null if there is none. */
  accountCreatedAt(userId: string): Promise<string | null>;
  /** Whether an address belongs to a confirmed account. `q` lets a caller ask inside its own transaction. */
  isConfirmed(email: string, q?: Q): Promise<boolean>;
  /** The name given at sign-up by an address that has signed up and not confirmed yet, or null; "" when no name was given. */
  pendingSignupName(email: string): Promise<string | null>;
  /** The name of a confirmed account at this address, or null if there is none; "" when it has no name. */
  confirmedName(email: string): Promise<string | null>;
}

const supabaseIdentity: Identity = {
  adminCreateUser: supabase.adminCreateUser, adminDeleteUser: supabase.adminDeleteUser, adminSetBlocked: supabase.adminSetBlocked,
  createSignupCode: supabase.createSignupCode, createFreshCode: supabase.createFreshCode, verifySignupCode: supabase.verifySignupCode,
  createRecoveryCode: supabase.createRecoveryCode, verifyRecoveryCode: supabase.verifyRecoveryCode, setUserPassword: supabase.setUserPassword,
  passwordLogin: supabase.passwordLogin, refreshSession: supabase.refreshSession, sessionsOf: supabase.sessionsOf, endSessions: supabase.endSessions,
  verifyAccessToken: supabase.verifyAccessToken, signOut: supabase.signOut, signOutOnly: supabase.signOutOnly,
  passkeySignInOptions: supabase.passkeySignInOptions, passkeySignInVerify: supabase.passkeySignInVerify, passkeyEnrolOptions: supabase.passkeyEnrolOptions,
  passkeyEnrolVerify: supabase.passkeyEnrolVerify, passkeyList: supabase.passkeyList, passkeyRename: supabase.passkeyRename, passkeyDelete: supabase.passkeyDelete,
  async accountCreatedAt(userId) { const [u] = await sql`select created_at::text as at from auth.users where id = ${userId}`; return u ? (u.at as string) : null; },
  async isConfirmed(email, q = sql) { return (await q`select 1 from auth.users where lower(email) = ${email} and email_confirmed_at is not null`).length > 0; },
  async pendingSignupName(email) { const [u] = await sql`select raw_user_meta_data->>'name' as name from auth.users where lower(email) = ${email} and email_confirmed_at is null`; return u ? (u.name ?? "") : null; },
  async confirmedName(email) { const [u] = await sql`select raw_user_meta_data->>'name' as name from auth.users where lower(email) = ${email} and email_confirmed_at is not null`; return u ? (u.name ?? "") : null; },
};

/** Ours (src/ownIdentity.ts), from the host's root-only settings: IDENTITY_SIGNING_KEY (a P-256 private JWK with a kid) and IDENTITY_CODE_KEY (32 bytes, base64).
 *  Tokens name this application as their issuer, so Supabase's are refused once the switch is made. */
function own(): Identity {
  const signing = process.env.IDENTITY_SIGNING_KEY ?? "", codeKey = Buffer.from(process.env.IDENTITY_CODE_KEY ?? "", "base64");
  if (!signing || codeKey.length < 32) throw new Error("IDENTITY=own needs IDENTITY_SIGNING_KEY and IDENTITY_CODE_KEY (docs/database/20_IDENTITY_V1.md)");
  return ownIdentity({ signer: signerKeyFrom(signing), issuer: `${config.appUrl}/identity`, codeKey });
}
function chosen(): Identity {
  const which = (process.env.IDENTITY ?? "supabase").trim();
  if (which === "supabase") return supabaseIdentity;
  if (which === "own") return own();
  throw new Error(`IDENTITY=${which}: "supabase" or "own" (docs/database/20_IDENTITY_V1.md)`);
}
export const identity: Identity = chosen();
