import { createHmac } from "node:crypto";
import { ensureMainPortal, lookupInvitation, PortalError, redeem, type PortalRole } from "./portals";
import { audit, newId, platformSql as sql, type Q } from "./db";   // platform-wide tables: never one organisation's (db.ts)
import { confirmations, signInStateKnown } from "./signedOut";
import { batched } from "./lookups";
import { blockedFor, clear, consume, guess, recordFailure, cooldown, waitText, type Guess } from "./ratelimit";
import { config } from "./config";
import { signedInAtOf } from "./tokens";
import { onList } from "./mail";
import { identity, type AuthTokens } from "./identity";
const { adminCreateUser, createFreshCode, createRecoveryCode, createSignupCode, endSessions, passwordLogin, sessionsOf, setUserPassword, verifyRecoveryCode, refreshSession, signOut, signOutOnly, verifyAccessToken, verifySignupCode, accountCreatedAt, isConfirmed, pendingSignupName, confirmedName } = identity;
import { sendVerificationEmail } from "./email";
import { MailError } from "./mail/transport";
import { MailDeferred } from "./mail";

export interface Session { userId: string; orgId: string; email: string; name: string; role: string; portalId?: string; portalRole?: string; portalName?: string }

const ACCESS = "th_access";
const REFRESH = "th_refresh";
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.cookieSecure ? "; Secure" : ""}`;
/** Says only that the request claims to be signed in; the session itself is checked later. */
export const carriesSession = (req: Request) => { const c = req.headers.get("cookie"); return !!c && (c.includes(`${ACCESS}=`) || c.includes(`${REFRESH}=`)); };
const readCookie = (req: Request, name: string) => req.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

/** Creates the sign-in at Supabase Auth, then links it to an organisation. */
export async function createUser(orgName: string, email: string, name: string, password: string, role = "recruiter") {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  let org = (await sql`select id from orgs where name = ${orgName}`)[0];
  if (!org) { org = { id: newId() }; await sql`insert into orgs (id, name) values (${org.id}, ${orgName})`; }
  const userId = await adminCreateUser(email.toLowerCase(), password, name);
  await sql`insert into members (user_id, org_id, name, role, email) values (${userId}, ${org.id}, ${name}, ${role}, ${email.toLowerCase()})`;
  await ensureMainPortal(org.id, userId, role === "admin" ? "admin" : role === "hiring_manager" ? "hiring_manager" : "recruiter");
  await audit(sql, org.id, userId, "user.created", "user", userId, { role });
  return { userId, orgId: org.id as string };
}

// ---------------------------------------------------------------- self-service sign-up with an e-mailed code
export class SignupError extends Error { constructor(public status: number, public code: string, message: string, public retryAfterSec?: number) { super(message); } }
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ---- verification challenges. Supabase Auth decides whether a code is correct and enforces single use. RoleMatch binds each ISSUED code to its own record (a keyed hash, never the code):
// its issue time (so a newer code can never extend an older one), its replacement (an older code is refused the moment a newer one exists) and its consumption.
const challengeHash = (email: string, code: string) => createHmac("sha256", config.linkSecret).update(`signup:${email}:${code}`).digest("hex");
async function recordChallenge(email: string, code: string) {
  await sql.begin(async (tx: any) => {
    await tx`update signup_challenges set superseded_at = now() where email = ${email} and superseded_at is null and consumed_at is null`;
    await tx`insert into signup_challenges (id, email, code_hash) values (${newId()}, ${email}, ${challengeHash(email, code)})
             on conflict (email, code_hash) do update set issued_at = now(), superseded_at = null, consumed_at = null`;
    await tx`delete from signup_challenges where issued_at < now() - interval '2 days'`;
  });
}

/** Step 1: validate, then e-mail a 6-digit code. Nothing is created in RoleMatch until the code is confirmed. */
export async function startSignup(input: { orgName?: string; name?: string; email?: string; password?: string; website?: string; inviteToken?: string }, ip: string): Promise<{ cookies: string[]; window: SessionWindow; session: Session } | void> {
  if (input.website) return; // honeypot field: real people never fill it in, so pretend success
  // An invited person joins the invited portal's organisation: the address comes from the invitation (not from the form), and no organisation is created.
  if (input.inviteToken) { const wait = await blockedFor("invite_lookup_ip", ip); if (wait) throw new SignupError(429, "RATE-001", `Too many invalid invitation links. Try again in ${waitText(wait)}.`, wait); }
  const inv = input.inviteToken ? await lookupInvitation(String(input.inviteToken)) : null;
  if (input.inviteToken && !inv) { await recordFailure("invite_lookup_ip", ip); throw new SignupError(404, "RES-001", "This invitation is not valid. Ask for a new one."); }
  if (!inv && config.signupMode === "invite" && !onList(config.signupAllowedEmails, String(input.email ?? ""))) throw new SignupError(403, "PERM-003", "RoleMatch is open by invitation only at the moment. Ask your organisation's administrator for an invitation.");
  const orgName = inv ? inv.orgName : String(input.orgName ?? "").trim(), name = String(input.name ?? "").trim(), email = inv ? inv.email : String(input.email ?? "").trim().toLowerCase(), password = String(input.password ?? "");
  if (name.length < 2 || name.length > 80) throw new SignupError(400, "VAL-001", "Please enter your full name.");
  if (orgName.length < 2 || orgName.length > 80) throw new SignupError(400, "VAL-001", "Please enter your organisation's name.");
  if (!EMAIL.test(email) || email.length > 160) throw new SignupError(400, "VAL-001", "Please enter a valid email address.");
  if (password.length < 12) throw new SignupError(400, "VAL-001", "Your password must be at least 12 characters.");
  if (password.length > 128) throw new SignupError(400, "VAL-001", "Your password is too long.");
  // R109: a valid invitation is its own limit: it is single use, bound to this address, and someone chose to send it. A whole office accepting from one public address is the normal case, not an attack.
  const [byIp, byEmail] = [inv ? { allowed: true } : await consume("signup_ip", ip), await consume("signup_email", email)];
  if (!byIp.allowed || !byEmail.allowed) throw new SignupError(429, "RATE-001", "Too many sign-up attempts. Please try again later.");
  if (!config.signupRequireCode) { // TEST MODE: no code; the account is confirmed at once and the person is signed in
    let userId: string;
    try { userId = await adminCreateUser(email, password, name, inv ? { invite_id: inv.id } : { org_name: orgName }); }   // what the sign-up was for is recorded, so an unfinished onboarding can be completed at sign-in
    catch { throw new SignupError(409, "CONF-001", "That email is already registered. Please log in instead."); }
    const session = inv ? await joinInvited(userId, email, name, inv) : await createOrgAndAdmin(userId, email, name, orgName);
    const attempt = await passwordLogin(email, password);
    if (!session || !attempt || attempt === "unconfirmed") throw new SignupError(500, "CORE-500", "Your account was created but signing in failed. Please log in.");
    await audit(sql, session.orgId, session.userId, "auth.login", "user", session.userId, { ip, via: "signup (test mode)" });
    return { ...(await signedIn(attempt, session)), session };
  }
  const code = await createSignupCode(email, password, inv ? { name, invite_id: inv.id } : { name, org_name: orgName });
  // null: the address already has a confirmed account. Owner, 8 Nov 2026: say so plainly ("then it should say account already exists"), rather than a
  // "check your email" for a code that never comes. The cost, accepted by the owner: the form tells whether an address is registered; the per-address
  // and per-network sign-up limits above keep that slow. Still nothing is sent.
  if (!code) throw new SignupError(409, "CONF-001", "An account with this email address already exists. Sign in instead, or use “Forgot password” if you cannot remember it.");
  await recordChallenge(email, code); await cooldown(email, config.resendCooldownSeconds * 1000); await sendCode(email, name, code); // sending starts the resend cooldown
}

/** The welcome e-mail is queued in the same transaction that sets the person up, so it exists exactly when the account does: once per person (the dedupe key), never for a
 * rolled-back setup, and never sent late (it expires after a day). The outbox delivers it; nobody has to trigger it. */
const queueWelcome = (tx: any, userId: string, orgId: string, portalId: string, payload: { variant: "admin" | "member" | "hiring_manager"; invitationId?: string; role?: string }) =>   // no address in the queue: names are read at send time
  tx`insert into outbox (id, org_id, portal_id, kind, class, priority, aggregate_id, version, dedupe_key, payload, expires_at)
     values (${newId()}, ${orgId}, ${portalId}, 'welcome.email', 'notification', 2, ${userId}, 1, ${`welcome.email:${userId}`}, ${tx.json(payload)}, now() + interval '1 day')
     on conflict (dedupe_key) do nothing`;

/** Adds a verified new account to the invited organisation and portal. All or nothing: the membership, the single-use redemption of the invitation and the portal membership are one
 * transaction, so a failure part-way leaves nothing behind and the same step can simply be run again (it is also safe to run twice at once: it is serialised per person). */
async function joinInvited(userId: string, email: string, name: string, inv: { id: string; orgId: string; portalId: string; role: PortalRole; email: string }): Promise<Session | null> {
  await sql.begin(async (tx: any) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"onboard:" + userId}, 0))`;
    if ((await tx`select 1 from members where user_id = ${userId}`).length) return;   // already onboarded (an earlier run or a concurrent one finished)
    await tx`insert into members (user_id, org_id, name, role, email) values (${userId}, ${inv.orgId}, ${name.slice(0, 80)}, ${inv.role === "hiring_manager" ? "hiring_manager" : "recruiter"}, ${email})`;
    await redeem(inv, userId, email, tx);   // refuses (and rolls the membership back) if the invitation is no longer valid or its inviter lost authority
    await queueWelcome(tx, userId, inv.orgId, inv.portalId, { variant: inv.role === "hiring_manager" ? "hiring_manager" : "member", invitationId: inv.id, role: inv.role });
  });
  members.delete(userId);
  return memberFor(userId);
}

/** Creates a new organisation with this person as its administrator. All or nothing and safe to run twice at once: exactly one organisation and one membership result. */
async function createOrgAndAdmin(userId: string, email: string, name: string, orgName: string): Promise<Session | null> {
  await sql.begin(async (tx: any) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"onboard:" + userId}, 0))`;
    if ((await tx`select 1 from members where user_id = ${userId}`).length) return;
    const orgId = newId();
    await tx`insert into orgs (id, name) values (${orgId}, ${orgName.slice(0, 80)})`;
    await tx`insert into members (user_id, org_id, name, role, email) values (${userId}, ${orgId}, ${name.slice(0, 80)}, 'admin', ${email})`;
    const portalId = await ensureMainPortal(orgId, userId, "admin", tx);
    await audit(tx as Q, orgId, userId, "user.signed_up", "user", userId, {});
    await queueWelcome(tx, userId, orgId, portalId, { variant: "admin" });
  });
  members.delete(userId);
  return memberFor(userId);
}

/** A confirmed person whose onboarding did not finish (the mail code worked, but creating the organisation or joining the invited portal failed). Signing in with the password finishes it:
 * the same all-or-nothing step, driven by what the sign-up recorded. Returns null when there is nothing safe to finish (no recorded sign-up, or the invitation can no longer be used). */
async function completeOnboarding(t: AuthTokens): Promise<Session | null> {
  const meta = t.meta ?? {}, email = t.email.toLowerCase(), name = String(meta.name ?? t.name ?? "").slice(0, 80) || email;
  // The provider's own verify endpoint answers without any key, so an address can be confirmed there directly, outside our 15-minute lifetime and our attempt limits. Only a
  // confirmation that went through finishSignup (a code of ours, consumed after this account was created) may finish onboarding; anything else gets no organisation or portal.
  const createdAt = await accountCreatedAt(t.userId);
  const viaUs = createdAt !== null && (await sql`select 1 from signup_challenges c where c.email = ${email} and c.consumed_at is not null
                           and c.consumed_at >= ${createdAt}::timestamptz limit 1`).length > 0;
  if (!viaUs) { console.error(JSON.stringify({ component: "login.onboarding", refused: "address confirmed outside RoleMatch; no onboarding" })); return null; }
  // Someone who left an organisation, or was removed from one, keeps their sign-in identity but is never set up again from their old sign-up details:
  // leaving one client must not create (or grant) another. Joining again needs a new invitation (below) to the same organisation.
  const departed = (await sql`select 1 from members where user_id = ${t.userId} and left_at is not null`).length > 0;
  if (departed) { console.error(JSON.stringify({ component: "login.onboarding", refused: "left or removed from an organisation; not set up again" })); return null; }
  if (meta.invite_id) {   // an invitation-bound identity never creates an organisation: it joins through the invitation it was made for, or a newer valid one for the same address
    const inv = (await sql`select id, org_id, portal_id, email, role from portal_invitations where email = ${email} and accepted_at is null and revoked_at is null and expires_at > now()
                           order by (id::text = ${String(meta.invite_id)}) desc, created_at desc limit 1`)[0];
    if (!inv) return null;
    try { return await joinInvited(t.userId, email, name, { id: inv.id, orgId: inv.org_id, portalId: inv.portal_id, role: inv.role, email: inv.email }); }
    catch (e) { if (e instanceof PortalError) return null; throw e; }
  }
  if (meta.org_name) return createOrgAndAdmin(t.userId, email, name, String(meta.org_name));
  return null;
}

/** Step 2: confirm the code. Only now are the organisation and the first administrator created. */
export async function finishSignup(email: string, code: string, ip: string): Promise<{ cookies: string[]; window: SessionWindow; session: Session } | null> {
  email = String(email ?? "").trim().toLowerCase(); code = String(code ?? "").trim();
  // too many wrong codes for this address or from this sender: say so, with the real wait, rather than "incorrect" (which invites another guess)
  const g = await guess([["verify_email", email]], ["verify_ip", ip]);   // the address's code counted now, taken back only if it proves right; the sender only if wrong
  if (g.wait) throw new SignupError(429, "RATE-001", `Too many incorrect codes. Try again in ${waitText(g.wait)}.`, g.wait);
  if (!/^\d{6,10}$/.test(code)) { await g.wrong(); return null; }
  // The 15-minute lifetime is ours to enforce, and it is judged on THIS code's own issue time (not on the latest code for the address), BEFORE the provider is asked: once the provider
  // accepts a code the account is confirmed, so refusing afterwards would leave a confirmed person with no organisation. A code we did not issue, one that has been replaced by a
  // newer code, or one already used is refused here without asking the provider.
  // Single use is enforced here as well as at the provider. The code is claimed in one step, per address, BEFORE the provider is asked, so of any number of simultaneous requests one reaches it
  // (register R43: check, ask, then mark let them all through, leaving the result to the provider's timing). A claim is released if the provider does not accept the code, so a failed call never spends it.
  const claim = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"signup:" + email}))`;
    const ch = (await tx`select id, superseded_at, consumed_at, issued_at < now() - (${config.otpExpiryMinutes} * interval '1 minute') as expired from signup_challenges where email = ${email} and code_hash = ${challengeHash(email, code)}`)[0];
    if (!ch || ch.superseded_at || ch.expired) return { outcome: "refused" as const };
    // The right code, already used: someone replaying it learns nothing and is not guessing, so it is refused the same way but is not a failed attempt.
    if (ch.consumed_at) return { outcome: "spent" as const };
    // A code for an address that is already confirmed cannot confirm it again, whichever code won (a resend racing a verify can leave a second live code).
    if (await isConfirmed(email, tx)) return { outcome: "spent" as const };
    await tx`update signup_challenges set consumed_at = now() where id = ${ch.id}`;
    return { outcome: "claimed" as const, id: ch.id as string };
  });
  if (claim.outcome === "spent") { await g.right(); return null; }   // the right code again: not a guess
  if (claim.outcome === "refused") { await g.wrong(); return null; }
  const release = () => sql`update signup_challenges set consumed_at = null where id = ${claim.id}`;
  const tokens = await verifySignupCode(email, code).catch(async (e) => { await release(); await g.right(); throw e; });   // the provider failed: not a wrong guess
  if (!tokens) { await release(); await g.wrong(); return null; }
  await g.right();
  await clear("verify_email", email);
  // The address is now confirmed at the provider and the code is spent. Creating the organisation / joining the portal is all-or-nothing; if it fails, nothing is half-done and the person
  // is told to sign in, which finishes the same step (completeOnboarding) without a second code.
  const orgName = String(tokens.meta.org_name ?? "").slice(0, 80) || `${tokens.name || email}'s organisation`;
  const name = String(tokens.meta.name ?? tokens.name ?? "").slice(0, 80) || email;
  const retry = () => new SignupError(503, "ONB-001", "Your e-mail address is confirmed, but we could not finish setting up your account just now. Sign in with your e-mail and password in a minute to finish; nothing you entered is lost and you do not need another code.");
  let session: Session | null;
  try {
    if (tokens.meta.invite_id) {
      // The code proves control of the invited address; the invitation must still be pending and must be for exactly this address.
      const inv = (await sql`select id, org_id, portal_id, email, role from portal_invitations where id = ${String(tokens.meta.invite_id)} and accepted_at is null and revoked_at is null and expires_at > now() and email = ${email}`)[0];
      if (!inv) throw new SignupError(409, "INVITE-INVALIDATED", "Your e-mail address is confirmed, but this invitation can no longer be used. Ask for a new invitation, then sign in with your e-mail and password.");
      session = await joinInvited(tokens.userId, email, name, { id: inv.id, orgId: inv.org_id, portalId: inv.portal_id, role: inv.role, email: inv.email });
    } else session = await createOrgAndAdmin(tokens.userId, email, name, orgName);
  } catch (e) {
    if (e instanceof SignupError) throw e;
    if (e instanceof PortalError) throw new SignupError(409, e.code, e.message);
    console.error(JSON.stringify({ component: "signup.onboarding", error: String((e as any)?.message ?? e).slice(0, 160) }));   // no address, no code
    throw retry();
  }
  if (!session) return null;
  await audit(sql, session.orgId, session.userId, "auth.login", "user", session.userId, { ip, via: "signup" });
  return { ...(await signedIn(tokens, session)), session };
}

async function sendCode(email: string, name: string, code: string) {
  try { await sendVerificationEmail(email, name, code); }
  catch (e) {
    // Uncertain (timed out or the connection broke): the code may well be on its way. The answer is the same as for a send that worked, because the sign-up page never claims delivery,
    // and no automatic retry is made (a second message would not help and could confuse); a new code is available after the resend wait.
    if (e instanceof MailError && e.kind === "uncertain") return;
    if (e instanceof MailError && e.kind === "unavailable") throw new SignupError(503, "MAIL-001", "E-mail is not available right now, so we cannot send your code. Please try again later.");
    if (e instanceof MailError && e.policy) throw new SignupError(503, "MAIL-002", "This server may send e-mail only to approved test recipients, and this address is not one of them.");
    if (e instanceof MailError || e instanceof MailDeferred) throw new SignupError(503, "INT-001", "We couldn't send the verification email. Please try again shortly.");
    throw e;
  }
}

/** Sends the code again, at most once a minute per address. */
export async function resendSignup(email: string, ip: string): Promise<void> {
  email = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new SignupError(400, "VAL-001", "Please enter a valid email address.");
  if (!(await cooldown(email, config.resendCooldownSeconds * 1000)).allowed) throw new SignupError(429, "RATE-001", "Please wait a minute before asking for another code.");
  const [perEmail, perIp] = [await consume("resend_email", email), await consume("signup_ip", ip)]; // a code costs a real e-mail: capped per address and per sender
  if (!perEmail.allowed || !perIp.allowed) throw new SignupError(429, "RATE-001", "Too many requests. Please try again later.");
  // Only for people who started a sign-up and have not confirmed yet; for anyone else, do nothing and say nothing.
  const pendingName = await pendingSignupName(email);
  if (pendingName !== null) {
    const code = await createFreshCode(email);
    if (code) { await recordChallenge(email, code); await sendCode(email, pendingName, code); }
  }
}

/** Forgotten password, step 1. The answer never shows whether an address has an account: nothing differs, and the message goes out after the answer, so the timing does not differ either.
 * A code costs a real e-mail, so asking is capped per address and per sender whether or not the address exists. */
export async function startPasswordReset(email: string, ip: string): Promise<void> {
  email = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 160) throw new SignupError(400, "VAL-001", "Please enter a valid email address.");
  if (!(await cooldown(`reset:${email}`, config.resendCooldownSeconds * 1000)).allowed) throw new SignupError(429, "RATE-001", "Please wait a minute before asking for another code.");
  const [perEmail, perIp] = [await consume("reset_email", email), await consume("reset_ip", ip)];
  if (!perEmail.allowed || !perIp.allowed) throw new SignupError(429, "RATE-001", "Too many requests. Please try again later.");
  void (async () => {
    const name = await confirmedName(email);
    if (name === null) return;
    const code = await createRecoveryCode(email);
    if (!code) return;
    await sql.begin(async (tx: any) => {
      await tx`update password_resets set superseded_at = now() where email = ${email} and superseded_at is null and consumed_at is null`;
      await tx`insert into password_resets (id, email, code_hash) values (${newId()}, ${email}, ${challengeHash(email, code)}) on conflict (email, code_hash) do update set issued_at = now(), superseded_at = null, consumed_at = null`;
      await tx`delete from password_resets where issued_at < now() - interval '2 days'`;
    });
    await sendVerificationEmail(email, name, code, "reset");
  })().catch((e) => console.error(JSON.stringify({ level: "warn", event: "reset.not_sent", error: e instanceof Error ? e.name : "unknown" })));   // never the address or the code
}

/** Forgotten password, step 2. Wrong codes count against the same limits as sign-up codes. The code is claimed in one step before the provider is asked, so it works once however many requests arrive together.
 * On success every session the person has ends, and they sign in with the new password; the reset itself never signs anyone in. */
export async function finishPasswordReset(email: string, code: string, password: string, ip: string): Promise<boolean> {
  email = String(email ?? "").trim().toLowerCase(); code = String(code ?? "").trim(); password = String(password ?? "");
  if (password.length < 12) throw new SignupError(400, "VAL-001", "Your password must be at least 12 characters.");
  if (password.length > 128) throw new SignupError(400, "VAL-001", "Your password is too long.");
  const g = await guess([["verify_email", email]], ["verify_ip", ip]);   // the address's code counted now, taken back only if it proves right; the sender only if wrong
  if (g.wait) throw new SignupError(429, "RATE-001", `Too many incorrect codes. Try again in ${waitText(g.wait)}.`, g.wait);
  if (!/^\d{6,10}$/.test(code)) { await g.wrong(); return false; }
  const claim = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"reset:" + email}))`;
    const ch = (await tx`select id, superseded_at, consumed_at, issued_at < now() - (${config.otpExpiryMinutes} * interval '1 minute') as expired from password_resets where email = ${email} and code_hash = ${challengeHash(email, code)}`)[0];
    if (!ch || ch.superseded_at || ch.expired) return { outcome: "refused" as const };
    if (ch.consumed_at) return { outcome: "spent" as const };
    await tx`update password_resets set consumed_at = now() where id = ${ch.id}`;
    return { outcome: "claimed" as const, id: ch.id as string };
  });
  if (claim.outcome === "spent") { await g.right(); return false; }   // the right code again: not a guess
  if (claim.outcome === "refused") { await g.wrong(); return false; }
  const existing = await sessionsOf(email);
  const tokens = await verifyRecoveryCode(email, code).catch(() => null);
  if (!tokens) { await sql`update password_resets set consumed_at = null where id = ${claim.id}`; await g.wrong(); return false; }
  await g.right();
  if (!(await setUserPassword(tokens.userId, password))) { await signOutOnly(tokens.accessToken); throw new SignupError(400, "VAL-001", "That password cannot be used. Ask for a new code and choose another."); }
  await endSessions(existing);
  await signOut(tokens.accessToken);
  await clear("verify_email", email);
  const member = (await sql`select org_id from members where user_id = ${tokens.userId} and left_at is null`)[0];
  if (member) await audit(sql, member.org_id, tokens.userId, "auth.password_reset", "user", tokens.userId, { ip });
  return true;
}

// Failed sign-ins are counted three ways, on top of the sign-in service's own limits, without revealing which e-mails exist:
//   one address on one account, any addresses on one account (a spread-out guesser), one address on any accounts (credential stuffing).
// The first two are counted before the password is checked; the third, the sender, only when it proves wrong (ratelimit.ts guess), so a whole office can
// sign in at the same moment.
/** A sign-in's password as a guess (ratelimit.ts guess): `wait` is 0 when it may be tried. The caller takes it back with right() when the password
 *  proves right, and when the attempt failed for any reason other than a wrong password; it calls wrong() when the password is wrong. */
export const loginGuess = (ip: string, email: string): Promise<Guess> => guess([["login_pair", `${ip}|${email.toLowerCase()}`], ["login_email", email.toLowerCase()]], ["login_ip", ip]);

// ---------------------------------------------------------------- how long a sign-in lasts
// Eight hours from signing in, for everyone: a working day (owner, 16 Nov 2026). It is the platform's rule, not an organisation's setting (a test
// server may shorten it with SESSION_HOURS to watch a session end). The time is in the signed token, so refreshing does not extend it. Every server
// enforces it on every request, so it holds behind a load balancer; the refresh cookie also expires then, so the browser forgets it too. People
// are warned WARN_MINUTES before the end, so they can save what they are typing.
const WARN_MINUTES = 5;
export interface SessionWindow { endsAt: string; warnMinutes: number }
function windowFor(signedInAtMs: number): { endsAtMs: number; window: SessionWindow } {
  const endsAtMs = signedInAtMs + config.sessionHours * 3_600_000;
  return { endsAtMs, window: { endsAt: new Date(endsAtMs).toISOString(), warnMinutes: WARN_MINUTES } };
}
const cookiesFor = (t: AuthTokens, endsAtMs: number) =>
  [cookie(ACCESS, t.accessToken, t.expiresIn), cookie(REFRESH, t.refreshToken, Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000)))];
/** Cookies and session window for a sign-in that has just happened, counted from the time the sign-in service wrote into the token (the same
 * time every later request reads), not this server's clock. The tokens have just come from the sign-in service, so reading them is safe. */
async function signedIn(t: AuthTokens, session: Session) {
  let claims: { session_id?: string } = {};
  try { claims = JSON.parse(Buffer.from(t.accessToken.split(".")[1], "base64url").toString()); } catch { /* falls back to now */ }
  const { endsAtMs, window } = windowFor((signedInAtOf(claims) || Date.now() / 1000) * 1000);
  await endOtherSignIns(session, claims.session_id ?? "");
  return { cookies: cookiesFor(t, endsAtMs), window };
}
/** One device at a time (owner, 16 Nov 2026): a new sign-in ends every other sign-in of the person, on every server, through the shared sign-out
 *  list, which also refuses the other device's refreshed tokens (they keep the same session). Written to the person's activity. */
async function endOtherSignIns(session: Session, current: string) {
  if (!current) return;   // the new sign-in's own session is unknown: never risk ending it
  const others = (await sessionsOf(session.email.toLowerCase())).filter((id) => id !== current);
  if (!others.length) return;
  await endSessions(others);
  await audit(sql, session.orgId, session.userId, "auth.other_sessions_ended", "user", session.userId, { count: others.length }, null as any);
}
/** Whether this person may create a portal now: an administrator, or a member the administrator delegated it to. Always read fresh, never from the cached session. */
export async function mayCreatePortals(userId: string, orgId: string): Promise<boolean> {
  const m = (await sql`select role, can_create_portals from members where user_id = ${userId} and org_id = ${orgId} and left_at is null`)[0];
  return !!m && (m.role === "admin" || m.can_create_portals === true);
}
/** Read fresh: used for rights that must not outlive a demotion by a cache window. */
export async function isAdminNow(userId: string, orgId: string) { return (await sql`select 1 from members where user_id = ${userId} and org_id = ${orgId} and role = 'admin' and left_at is null`).length > 0; }
export const forgetMember = (userId: string) => { members.delete(userId); };
/** An administrator delegates (or withdraws) portal creation for one member of the same organisation. Administrators need no delegation. */
export async function setPortalCreation(orgId: string, actor: { userId: string; email: string }, targetUserId: string, allowed: boolean) {
  const t = (await sql`select role, email from members where user_id = ${targetUserId} and org_id = ${orgId} and left_at is null`)[0];
  if (!t) return { status: 404 as const };
  if (t.role === "admin") return { status: 409 as const };
  await sql`update members set can_create_portals = ${allowed} where user_id = ${targetUserId} and org_id = ${orgId}`;
  await audit(sql, orgId, actor.userId, allowed ? "member.portal_creation_delegated" : "member.portal_creation_withdrawn", "user", targetUserId, { actorEmail: actor.email, targetEmail: t.email });
  forgetMember(targetUserId);
  return { status: 200 as const, canCreatePortals: allowed };
}
const CLEARED = [cookie(ACCESS, "", 0), cookie(REFRESH, "", 0)];

// Organisation membership is cached for a few seconds. Removing someone takes effect within that window. While membership cannot be read (or only from a
// copy older than a removal would show), what was last read from the main database stands for the sign-in grace (signedOut.ts), and no longer: a copy
// is never read for it, so it can never give a removed person their access back.
const members = new Map<string, { session: Session | null; until: number }>(), confirmedMembers = confirmations();
const loadMember = batched<string, any>(async (ids) => new Map((await sql`select m.user_id, m.org_id, m.name, m.role, m.email from members m where m.user_id = any(${sql.array(ids)}::uuid[]) and m.left_at is null`).map((m: any) => [m.user_id, m])), null);
async function memberFor(userId: string): Promise<Session | null> {
  const hit = members.get(userId);
  if (hit && hit.until > Date.now()) return hit.session;
  const lastKnown = () => { confirmedMembers.orRefuse(userId, "membership could not be read"); return hit?.session ?? null; };
  if (!signInStateKnown()) return lastKnown();
  let m: any;
  try { m = await loadMember(userId); } catch { return lastKnown(); }
  const session = m ? { userId: m.user_id, orgId: m.org_id, email: m.email ?? "", name: m.name, role: m.role } : null;
  members.set(userId, { session, until: Date.now() + 10_000 });
  confirmedMembers.confirm(userId);
  return session;
}

export async function login(email: string, password: string, ip: string): Promise<{ cookies: string[]; window: SessionWindow; session: Session } | null> {
  const attempt = await passwordLogin(email.toLowerCase(), password);
  if (attempt === "unconfirmed") throw new SignupError(403, "AUTH-003", "Please confirm your email address first. Use the code we sent when you signed up.");
  const tokens = attempt;
  let session = tokens ? await memberFor(tokens.userId) : null;
  if (tokens && !session) session = await completeOnboarding(tokens).catch((e) => { console.error(JSON.stringify({ component: "login.onboarding", error: String(e?.message ?? e).slice(0, 160) })); return null; });
  if (!tokens || !session) return null;   // counted already (loginGuess); a valid user without an organisation is also refused, and counted
  await clear("login_pair", `${ip}|${email.toLowerCase()}`);
  await audit(sql, session.orgId, session.userId, "auth.login", "user", session.userId, { ip });
  return { ...(await signedIn(tokens, session)), session };
}

/** A passkey sign-in proves who someone is; the same membership check as a password decides whether they get in. It never creates an organisation or accepts an invitation, and someone with no
 * current membership is told so plainly: they have proved who they are, so this reveals nothing to a stranger. */
export async function passkeyLogin(tokens: AuthTokens, ip: string): Promise<{ cookies: string[]; window: SessionWindow; session: Session } | null> {
  const session = await memberFor(tokens.userId);
  if (!session) { await signOutOnly(tokens.accessToken); return null; }
  await audit(sql, session.orgId, session.userId, "auth.login", "user", session.userId, { ip, via: "passkey" });
  return { ...(await signedIn(tokens, session)), session };
}
/** The access token to act for this person at the sign-in service (the cookie, or the one just refreshed), and when they last proved who they are. */
export function accountToken(req: Request, setCookies: string[]): string | null {
  const fresh = setCookies.find((c) => c.startsWith(`${ACCESS}=`));
  return fresh ? fresh.slice(ACCESS.length + 1).split(";")[0] : readCookie(req, ACCESS) ?? null;
}
export const signedInAt = (accessToken: string): number => { try { return signedInAtOf(JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString())); } catch { return 0; } };
/** Asks for the password again when a sign-in is no longer recent. Counted exactly like a sign-in, and the old session ends. */
export async function reauthenticate(req: Request, session: Session, password: string, ip: string): Promise<{ cookies: string[]; window: SessionWindow } | null> {
  const attempt = await passwordLogin(session.email.toLowerCase(), password);
  if (!attempt || attempt === "unconfirmed" || attempt.userId !== session.userId) return null;   // counted already (loginGuess)
  const old = readCookie(req, ACCESS);
  if (old) await signOutOnly(old);
  await audit(sql, session.orgId, session.userId, "auth.reauthenticated", "user", session.userId, { ip });
  return signedIn(attempt, session);
}

/** Returns the session, and fresh cookies when the short-lived access token had to be refreshed; or that the session has run its full length,
 * in which case it is signed out everywhere and the cookies are cleared. */
export type Found = { ended: false; session: Session; setCookies: string[]; window: SessionWindow } | { ended: true; setCookies: string[]; hours: number };
export async function sessionFrom(req: Request): Promise<Found | null> {
  let access = readCookie(req, ACCESS);
  let fresh: AuthTokens | null = null;
  let user = access ? await verifyAccessToken(access) : null;
  if (!user) {
    const refresh = readCookie(req, REFRESH);
    fresh = refresh ? await refreshSession(refresh) : null;
    if (!fresh) return null;
    access = fresh.accessToken;
    user = await verifyAccessToken(access);
  }
  if (!user) return null;
  const session = await memberFor(user.id);
  if (!session) return null;
  const { endsAtMs, window } = windowFor(user.signedInAt * 1000);
  if (Date.now() >= endsAtMs) {
    if (access) await signOut(access);   // ends it at the sign-in service and on every server, not only in this browser
    return { ended: true, setCookies: CLEARED, hours: config.sessionHours };
  }
  return { ended: false, session, setCookies: fresh ? cookiesFor(fresh, endsAtMs) : [], window };
}

/** Ends the session on the server, not only in this browser. After an hour idle the browser holds only the refresh cookie: it is used once to reach the
 *  session so that it can be ended (independent security review, 23 Nov 2026: signing out then only cleared the cookies, and a copied refresh token
 *  kept working until the session's eight hours were up). */
export async function logout(req: Request): Promise<string[]> {
  let access = readCookie(req, ACCESS);
  if (!access) { const refresh = readCookie(req, REFRESH); access = refresh ? (await refreshSession(refresh).catch(() => null))?.accessToken : undefined; }
  if (access) await signOut(access);
  return CLEARED;
}

// Simple per-key token bucket so one user or address cannot monopolise the server.
