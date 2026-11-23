// The owner's console sign-in (docs/database/18_CONSOLE_V0.md). At most two accounts (owner, 12 Nov 2026: "It should always just be me and my dad"; migration
// 052), set at the PC's terminal (scripts/consolePassword.ts); this module never creates one. Two steps: the password, then a code e-mailed to that account's
// own address (slice 2). Five wrong passwords or codes in 15 minutes lock that account, from any address (AUTH_ATTEMPTS); the lock is checked before the
// password, so the right password is refused while it lasts, and the owner is told. Each account's sessions, codes and lock are its own.
// Passwords are hashed in src/passwords.ts, shared with our own sign-in.
// A session is a random id in a cookie; the database keeps only its hash. It ends after 15 minutes unused, after 8 hours whatever happens, at sign-out,
// and when the password is set again (docs/database/17, section 2).
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { recipientAllowed } from "../mail";
import { isMailbox, transport } from "../mail/transport";
import { hashPassword, verifyPassword } from "../passwords";
import { sql } from "../db";
import { notifyOwner } from "../opsNotify";
import { AUTH_ATTEMPTS, blockedFor, clear, cooldown, guess, isBlocked } from "../ratelimit";
import { asConsole, raise } from "./store";

export { hashPassword };

export const IDLE_MS = 15 * 60_000;
const ABSOLUTE_MS = 8 * 3600_000;
/** What a password must be. Length is what protects it; no other rule is imposed. */
export function passwordProblem(password: string, email: string) {
  if (password.length < 12) return "at least 12 characters";
  if (password.length > 256) return "at most 256 characters";
  if (password.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "not containing your e-mail name";
  return null;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
/** The token every form carries. Worked out from the session id, which only the owner's cookie holds, so it is stored nowhere. */
export const formToken = (sid: string) => hash(`console-form:${sid}`);
export const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startSession(client: string, ownerEmail: string | null = null) {
  const sid = randomBytes(32).toString("base64url");
  await asConsole((q) => q`insert into console_sessions (id_hash, ends_at, client, owner_email) values (${hash(sid)}, now() + (${ABSOLUTE_MS / 1000} * interval '1 second'), ${client.slice(0, 120)}, ${ownerEmail})`);
  return sid;
}
/** The session behind a cookie, if it is still open; using it counts as activity, unless the page reloaded itself (byPerson false). One found past
 *  either limit is closed there and then, so the record says it ended rather than looking open. */
export async function sessionFor(sid: string | undefined, byPerson = true) {
  if (!sid || sid.length > 64) return null;
  const [r] = await asConsole((q) => byPerson
    ? q`update console_sessions set last_used_at = now()
        where id_hash = ${hash(sid)} and ended_at is null and ends_at > now() and last_used_at > now() - (${IDLE_MS / 1000} * interval '1 second') returning started_at, ends_at, owner_email`
    : q`select started_at, ends_at, owner_email from console_sessions
        where id_hash = ${hash(sid)} and ended_at is null and ends_at > now() and last_used_at > now() - (${IDLE_MS / 1000} * interval '1 second')`);
  if (!r) await endSession(sid);
  return (r ?? null) as { started_at: Date; ends_at: Date; owner_email: string | null } | null;
}
export const endSession = (sid: string) => asConsole((q) => q`update console_sessions set ended_at = now() where id_hash = ${hash(sid)} and ended_at is null`);

/** Each account's lock is its own; an address that is not an account has one too, so trying unknown addresses never tells which are real. */
const lockKey = (email: string) => `owner:${email.trim().toLowerCase().slice(0, 200)}`;
// A hash to check a password against when the e-mail is not an account's, so the time taken never tells whether the e-mail was right.
const NO_ONE = hashPassword(randomBytes(24).toString("base64url"));
export type SignIn = { ok: true; email: string } | { ok: false; reason: "wrong" | "locked" | "not set"; waitSec?: number };
export async function signIn(email: string, password: string): Promise<SignIn> {
  const e = email.trim().toLowerCase();
  const g = await guess([["console_signin", lockKey(e)]]);   // counted now, before the password is checked (ratelimit.ts guess)
  if (g.wait) return { ok: false, reason: "locked", waitSec: g.wait };
  const owners = await asConsole((q) => q`select email, password_hash from console_owner`);
  if (!owners.length) { await g.right(); return { ok: false, reason: "not set" }; }
  const owner = owners.find((o: any) => o.email === e);
  // The password is always checked, so the time taken does not tell whether the e-mail was right.
  const passwordRight = await verifyPassword(password, owner?.password_hash ?? (await NO_ONE));
  // The count of wrong tries is cleared only when the code is right too (checkCode): clearing it here would let someone holding the password guess codes forever.
  if (passwordRight && owner) { await g.right(); return { ok: true, email: owner.email }; }
  await failed(e);
  return { ok: false, reason: "wrong" };
}

/** A wrong password or a wrong code, already counted (guess): the fifth in 15 minutes locks sign-in and tells the owner. */
async function failed(email: string) {
  if (!(await isBlocked("console_signin", lockKey(email)))) return;
  // Told once per lock period (AUTH_ATTEMPTS' 15 minutes) for each account, and once for every address that is no account taken together. Every made-up
  // address has a lock of its own, and each used to raise an urgent alert and e-mail the owner, so anyone could make the console send mail without end
  // and use up the mail host's allowance that customers' sign-in codes rely on; and the alert said the console was locked when no account was (code
  // review, 16 Nov 2026, D-M1).
  const account = (await asConsole((q) => q`select 1 from console_owner where email = ${email}`).catch(() => [])).length > 0;
  if (!(await cooldown(`console-lock-told:${account ? email : "no account"}`, AUTH_ATTEMPTS.windowMs).catch(() => ({ allowed: true }))).allowed) return;
  if (account) {
    const title = "The console locked itself after 5 wrong passwords or codes";
    await raise({ fingerprint: "console:locked", severity: "urgent", source: "console", title, meaning: "Someone got the console's password or its e-mailed code wrong 5 times in 15 minutes. Sign-in to that account is refused for 15 minutes, even with the right password.", action: "If it was not you, keep it locked: set a new password at the PC's terminal (deploy/pc/console-password.sh), which also signs out every session." }).catch(() => {});
    await notifyOwner(`RoleMatch: ${title}`, "Sign-in to one of the owner's console accounts is refused for 15 minutes. If it was not you, set a new password at the PC's terminal.", "the RoleMatch console").catch(() => {});
    return;
  }
  const title = "Wrong passwords or codes were tried at the console for an address that is not a console account";
  await raise({ fingerprint: "console:guessing", severity: "today", source: "console", title, meaning: "Someone got a password or a code wrong 5 times in 15 minutes for an address that is not a console account. No account is locked: the console's own accounts can still sign in. More attempts like this in the next 15 minutes are not reported again.", action: "Nothing to do unless it keeps happening. If it does, look at who reaches the console's address." }).catch(() => {});
  await notifyOwner(`RoleMatch: ${title}`, "No console account is locked; the console's own accounts can still sign in. More attempts like this in the next 15 minutes are not reported again.", "the RoleMatch console").catch(() => {});
}

// The second step (slice 2): after the right password, a code e-mailed to that account's own address, entered in the same browser. The address is the
// one in console_owner, never one from the form, and a code is only sent after the right password, so nobody else can make the console send mail.
export const CODE_MS = 10 * 60_000;
const RESEND_MS = 60_000, CODES_KEPT_DAYS = 1;
const codeHash = (pending: string, code: string) => hash(`console-code:${pending}:${code}`);
export type Challenge = { ok: true; pending: string } | { ok: false; reason: "wait" | "not sent" };
/** E-mails a fresh code and returns the pending token for the browser's cookie. A newer code replaces the older; while one sent less than a minute ago is still unused, no other is sent. */
export async function sendCode(account: string): Promise<Challenge> {
  const [row] = await asConsole((q) => q`select email from console_owner where email = ${account.trim().toLowerCase()}`);
  if (!row) return { ok: false, reason: "not sent" };
  const email: string = row.email;
  const recent = await asConsole((q) => q`select 1 from console_codes where used_at is null and owner_email = ${email} and issued_at > now() - (${RESEND_MS / 1000} * interval '1 second')`);
  if (recent.length) return { ok: false, reason: "wait" };
  const pending = randomBytes(32).toString("base64url"), code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await asConsole(async (q) => {
    await q`delete from console_codes where issued_at < now() - (${CODES_KEPT_DAYS} * interval '1 day')`;
    await q`update console_codes set used_at = now() where used_at is null and (owner_email = ${email} or owner_email is null)`;
    await q`insert into console_codes (pending_hash, code_hash, owner_email) values (${hash(pending)}, ${codeHash(pending, code)}, ${email})`;
  });
  const t = transport("authentication");
  if (!t || !isMailbox(email) || !recipientAllowed(email)) { console.log(JSON.stringify({ event: "console.code_not_sent", reason: !t ? "no mail transport" : "address not allowed" })); return { ok: false, reason: "not sent" }; }
  const text = `Your RoleMatch console sign-in code is ${code}\n\nIt works once, for 10 minutes, in the browser where you entered your password. If you did not just sign in, someone has your console password: set a new one at the PC's terminal.`;
  await t.send({ to: email, from: config.mail.from, subject: "RoleMatch console sign-in code", text, html: `<p>Your RoleMatch console sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It works once, for 10 minutes, in the browser where you entered your password. If you did not just sign in, someone has your console password: set a new one at the PC's terminal.</p>`, messageId: `<${randomUUID()}@rolematch.console>` });
  console.log(JSON.stringify({ event: "console.code_sent" }));
  return { ok: true, pending };
}
export type CodeCheck = { ok: true; email: string | null } | { ok: false; reason: "wrong" | "locked"; waitSec?: number };
/** The code for this browser's pending token: right, unused and within 10 minutes uses it up; anything else counts towards that account's lock. */
export async function checkCode(pending: string | undefined, code: string): Promise<CodeCheck> {
  const [mine] = pending && pending.length <= 64 ? await asConsole((q) => q`select owner_email from console_codes where pending_hash = ${hash(pending)}`) : [];
  const key = mine?.owner_email ?? "unknown";
  const g = await guess([["console_signin", lockKey(key)]]);   // counted now, before the code is checked
  if (g.wait) return { ok: false, reason: "locked", waitSec: g.wait };
  const c = String(code ?? "").replace(/\s/g, "");
  const [row] = pending && pending.length <= 64 && /^\d{6}$/.test(c)
    ? await asConsole((q) => q`select code_hash, owner_email from console_codes where pending_hash = ${hash(pending)} and used_at is null and issued_at > now() - (${CODE_MS / 1000} * interval '1 second')`)
    : [];
  if (row && sameToken(row.code_hash, codeHash(pending!, c))) {
    const used = await asConsole((q) => q`update console_codes set used_at = now() where pending_hash = ${hash(pending!)} and used_at is null returning 1`);
    if (used.length) { await clear("console_signin", lockKey(key)); return { ok: true, email: row.owner_email ?? null }; }
  }
  await failed(key);
  return { ok: false, reason: (await blockedFor("console_signin", lockKey(key))) ? "locked" : "wrong" };
}

/** The console's accounts, in order: never more than two. */
export const owners = () => sql`select slot, email, set_at from console_owner order by slot` as unknown as Promise<{ slot: number; email: string; set_at: Date }[]>;
/** Sets an account's password, or adds the account if there is room (two at most), and ends that account's sessions. Only the terminal script calls
 *  this, as the tables' owner. Returns whether the account was new. */
export async function setOwner(email: string, password: string, setBy: string) {
  const e = email.trim().toLowerCase(), problem = passwordProblem(password, e);
  if (problem) throw new Error(`The password must be ${problem}.`);
  const phc = await hashPassword(password);
  const added = await sql.begin(async (q) => {
    const rows = await q`select slot, email from console_owner order by slot for update`;
    const mine = rows.find((r: any) => r.email === e);
    if (mine) await q`update console_owner set password_hash = ${phc}, set_at = now(), set_by = ${setBy} where slot = ${mine.slot}`;
    else {
      const free = [1, 2].find((n) => !rows.some((r: any) => r.slot === n));
      if (!free) throw new Error(`The console already has its two accounts (${rows.map((r: any) => r.email).join(" and ")}). Remove one first: console-password.sh --remove <e-mail>`);
      await q`insert into console_owner (slot, email, password_hash, set_by) values (${free}, ${e}, ${phc}, ${setBy})`;
    }
    await q`update console_sessions set ended_at = now() where ended_at is null and (owner_email = ${e} or owner_email is null)`;
    return !mine;
  });
  await clear("console_signin", lockKey(e));
  return added;
}
/** Removes an account and ends its sessions. Only the terminal script calls this. */
export async function removeOwner(email: string) {
  const e = email.trim().toLowerCase();
  return sql.begin(async (q) => {
    const gone = await q`delete from console_owner where email = ${e} returning slot`;
    await q`update console_sessions set ended_at = now() where ended_at is null and owner_email = ${e}`;
    return gone.length > 0;
  });
}
