// Our own sign-in against a real database (docs/database/20_IDENTITY_V1.md, slice 2): each function means what auth.ts relies on from Supabase's,
// and the stricter session rules hold (rotation, a copied refresh token ends the session, sign-outs reach every server). Everything invented.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Identity } from "../src/identity";
import { setupTestDb, type TestDb } from "./helpers";

let tdb: TestDb, id: Identity, db: postgres.Sql;
const key = JSON.stringify({ ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }), kid: "own-test" });
const PW = "a long sign-in passphrase", ISS = "https://app.example.test/identity";

beforeAll(async () => {
  tdb = await setupTestDb();
  Object.assign(process.env, { DB_SCHEMA: tdb.schema, DB_POOL_SIZE: "3" }); vi.resetModules();
  const { ownIdentity } = await import("../src/ownIdentity"), { signerKeyFrom } = await import("../src/tokenSigner");
  id = ownIdentity({ signer: signerKeyFrom(key), issuer: ISS, codeKey: randomBytes(32) });
  db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: tdb.schema }, onnotice: () => {} });
}, 120_000);
afterAll(async () => { await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }); await tdb?.teardown(); });

test("an invited person's account is made confirmed and can sign in; a wrong password or unknown address cannot; nothing is stored as itself", async () => {
  const uid = await id.adminCreateUser("Ann@Example.test ", PW, "Ann Dlamini", { org: "x" });
  await expect(id.adminCreateUser("ann@example.test", PW, "Again")).rejects.toThrow(/already been registered/);
  const t = await id.passwordLogin("ann@example.test", PW);
  expect(t).toMatchObject({ userId: uid, email: "ann@example.test", name: "Ann Dlamini", expiresIn: 900, meta: { name: "Ann Dlamini", org: "x" } });
  expect(await id.passwordLogin("ann@example.test", "wrong password here")).toBeNull();
  expect(await id.passwordLogin("nobody@example.test", PW)).toBeNull();
  const [a] = await db`select password_hash from identity_accounts where id = ${uid}`, [s] = await db`select refresh_hash from identity_sessions where account_id = ${uid}`;
  expect(a.password_hash).toMatch(/^\$argon2id\$/);
  expect(s.refresh_hash).not.toBe((t as any).refreshToken);
  const v = await id.verifyAccessToken((t as any).accessToken);
  expect(v).toMatchObject({ id: uid, email: "ann@example.test", name: "Ann Dlamini" });
  expect(await id.accountCreatedAt(uid)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+/);
  expect(await id.isConfirmed("ann@example.test")).toBe(true);
  expect(await id.confirmedName("ann@example.test")).toBe("Ann Dlamini");
});

test("sign-up: an unconfirmed account says so at sign-in; a new code replaces the old; the right code confirms once and signs in", async () => {
  const c1 = await id.createSignupCode("ben@example.test", PW, { name: "Ben Khumalo", org: "Acme" });
  expect(c1).toMatch(/^\d{6}$/);
  expect(await id.passwordLogin("ben@example.test", PW)).toBe("unconfirmed");
  expect(await id.pendingSignupName("ben@example.test")).toBe("Ben Khumalo");
  const c2 = await id.createFreshCode("ben@example.test");
  expect(await id.verifySignupCode("ben@example.test", c1!)).toBeNull();   // superseded
  expect(await id.verifySignupCode("ben@example.test", "000000" === c2 ? "111111" : "000000")).toBeNull();
  const t = await id.verifySignupCode("ben@example.test", c2!);
  expect(t).toMatchObject({ email: "ben@example.test", meta: { name: "Ben Khumalo", org: "Acme" } });
  expect(await id.verifySignupCode("ben@example.test", c2!)).toBeNull();   // used once
  expect(await id.isConfirmed("ben@example.test")).toBe(true);
  expect(await id.createSignupCode("ben@example.test", PW, {})).toBeNull();   // a confirmed address cannot sign up again
  expect(await id.createFreshCode("ben@example.test")).toBeNull();
});

test("a code that has run out is refused", async () => {
  const c = await id.createSignupCode("cara@example.test", PW, { name: "Cara" });
  await db`update identity_codes set issued_at = now() - interval '16 minutes' where account_id = (select id from identity_accounts where email = 'cara@example.test')`;
  expect(await id.verifySignupCode("cara@example.test", c!)).toBeNull();
});

test("a refresh token works once: it is replaced, and the old one presented again ends the whole session on every server", async () => {
  await id.adminCreateUser("dee@example.test", PW, "Dee");
  const t = (await id.passwordLogin("dee@example.test", PW)) as any;
  const next = await id.refreshSession(t.refreshToken);
  expect(next?.refreshToken).toBeTruthy();
  expect(next!.refreshToken).not.toBe(t.refreshToken);
  // past the few seconds in which the same page's other requests may still carry it (the next test)
  await db`update identity_sessions set refreshed_at = refreshed_at - interval '11 seconds' where account_id = (select id from identity_accounts where email = 'dee@example.test')`;
  expect(await id.refreshSession(t.refreshToken)).toBeNull();          // a copy of the old token
  expect(await id.refreshSession(next!.refreshToken)).toBeNull();      // so the real one stops too
  expect(await id.verifyAccessToken(next!.accessToken)).toBeNull();    // and its access token, at once
  const [s] = await db`select ended_why from identity_sessions where account_id = (select id from identity_accounts where email = 'dee@example.test')`;
  expect(s.ended_why).toBe("reused token");
});

test("two requests refreshing with the same token at the same moment both carry on, with one new token, and the session stays (code review, 16 Nov 2026, A-M11)", async () => {
  await id.adminCreateUser("dua@example.test", PW, "Dua");
  const t = (await id.passwordLogin("dua@example.test", PW)) as any;
  // The board's next page load after the access token runs out sends several requests at once, each with the same refresh cookie.
  const answers = await Promise.all([1, 2, 3].map(() => id.refreshSession(t.refreshToken)));
  expect(answers.every((a) => a?.refreshToken)).toBe(true);
  expect(new Set(answers.map((a) => a!.refreshToken)).size).toBe(1);   // the same new token, whichever answer the browser keeps
  expect(answers[0]!.refreshToken).not.toBe(t.refreshToken);
  const later = await id.refreshSession(answers[0]!.refreshToken);
  expect(later?.refreshToken).toBeTruthy();                            // the session carries on
  const [s] = await db`select ended_at from identity_sessions where account_id = (select id from identity_accounts where email = 'dua@example.test')`;
  expect(s.ended_at).toBeNull();
});

test("a session ends after 7 days unused and after 30 days whatever happens", async () => {
  await id.adminCreateUser("eli@example.test", PW, "Eli");
  const a = (await id.passwordLogin("eli@example.test", PW)) as any, b = (await id.passwordLogin("eli@example.test", PW)) as any;
  await db`update identity_sessions set refreshed_at = now() - interval '8 days' where refresh_hash = encode(sha256(${a.refreshToken}::bytea), 'hex')`;
  await db`update identity_sessions set ends_at = now() - interval '1 second' where refresh_hash = encode(sha256(${b.refreshToken}::bytea), 'hex')`;
  expect(await id.refreshSession(a.refreshToken)).toBeNull();
  expect(await id.refreshSession(b.refreshToken)).toBeNull();
  expect((await db`select ended_why from identity_sessions where account_id = (select id from identity_accounts where email = 'eli@example.test')`).map((r) => r.ended_why)).toEqual(["expired", "expired"]);
});

test("sign out ends every session of the person; sign out only ends this one", async () => {
  await id.adminCreateUser("fay@example.test", PW, "Fay");
  const [a, b, c] = [await id.passwordLogin("fay@example.test", PW), await id.passwordLogin("fay@example.test", PW), await id.passwordLogin("fay@example.test", PW)] as any[];
  await id.signOutOnly(a.accessToken);
  expect(await id.verifyAccessToken(a.accessToken)).toBeNull();
  expect(await id.verifyAccessToken(b.accessToken)).not.toBeNull();
  expect(await id.sessionsOf("fay@example.test")).toHaveLength(2);
  await id.signOut(b.accessToken);
  expect(await id.verifyAccessToken(c.accessToken)).toBeNull();
  expect(await id.sessionsOf("fay@example.test")).toHaveLength(0);
  expect(await id.refreshSession(c.refreshToken)).toBeNull();
});

test("a password reset: the recovery code signs in once, the new password ends the old sessions, and the old password no longer works", async () => {
  const uid = await id.adminCreateUser("gus@example.test", PW, "Gus");
  const old = (await id.passwordLogin("gus@example.test", PW)) as any;
  expect(await id.createRecoveryCode("nobody@example.test")).toBeNull();
  const code = await id.createRecoveryCode("gus@example.test");
  const r = await id.verifyRecoveryCode("gus@example.test", code!);
  expect(r?.userId).toBe(uid);
  expect(await id.verifyRecoveryCode("gus@example.test", code!)).toBeNull();
  expect(await id.setUserPassword(uid, "another long passphrase")).toBe(true);
  expect(await id.verifyAccessToken(old.accessToken)).toBeNull();
  expect(await id.passwordLogin("gus@example.test", PW)).toBeNull();
  expect(await id.passwordLogin("gus@example.test", "another long passphrase")).toMatchObject({ userId: uid });
  expect(await id.setUserPassword("00000000-0000-4000-8000-000000000000", "x long password")).toBe(false);
});

test("a deleted account's sessions stop at once, and its codes and sessions go with it", async () => {
  const uid = await id.adminCreateUser("hal@example.test", PW, "Hal");
  const t = (await id.passwordLogin("hal@example.test", PW)) as any;
  await id.adminDeleteUser(uid);
  expect(await id.verifyAccessToken(t.accessToken)).toBeNull();
  expect((await db`select count(*)::int as n from identity_sessions where account_id = ${uid}`)[0].n).toBe(0);
  await expect(id.adminDeleteUser(uid)).rejects.toThrow(/404/);
});

test("finished rows go after their retention: an ended session after 90 days, a never-ended one 90 days after its limit, a code after 2 days", async () => {
  await id.adminCreateUser("ivy@example.test", PW, "Ivy");
  const [old, recent, lapsed] = [await id.passwordLogin("ivy@example.test", PW), await id.passwordLogin("ivy@example.test", PW), await id.passwordLogin("ivy@example.test", PW)] as any[];
  const at = (t: any) => db`select id from identity_sessions where refresh_hash = encode(sha256(${t.refreshToken}::bytea), 'hex')`;
  await db`update identity_sessions set ended_at = now() - interval '91 days', ended_why = 'signed out' where refresh_hash = encode(sha256(${old.refreshToken}::bytea), 'hex')`;
  await db`update identity_sessions set ended_at = now() - interval '89 days', ended_why = 'signed out' where refresh_hash = encode(sha256(${recent.refreshToken}::bytea), 'hex')`;
  await db`update identity_sessions set ends_at = now() - interval '91 days' where refresh_hash = encode(sha256(${lapsed.refreshToken}::bytea), 'hex')`;
  await id.createRecoveryCode("ivy@example.test");
  await db`update identity_codes set issued_at = now() - interval '3 days' where account_id = (select id from identity_accounts where email = 'ivy@example.test')`;
  const kept = await id.createRecoveryCode("ivy@example.test");
  await id.passwordLogin("ivy@example.test", PW);
  expect((await at(old)).length).toBe(0);
  expect((await at(lapsed)).length).toBe(0);
  expect((await at(recent)).length).toBe(1);
  expect((await db`select count(*)::int as n from identity_codes where account_id = (select id from identity_accounts where email = 'ivy@example.test')`)[0].n).toBe(1);
  expect(await id.verifyRecoveryCode("ivy@example.test", kept!)).not.toBeNull();
});

test("passkeys are not offered by our own sign-in yet, and say so", async () => {
  expect(await id.passkeySignInOptions()).toEqual({ ok: false, status: 501, code: "passkeys_not_available" });
});
