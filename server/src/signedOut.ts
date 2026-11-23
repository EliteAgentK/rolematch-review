// Sign-outs shared by every API server through the database (013_signed_out_sessions.sql), whichever sign-in service issued the token (src/identity.ts).
// Each server also remembers its own (tokens.ts), so the common case needs no query. A token is re-checked against the shared list at most every
// tokenRecheckMs. When the shared list cannot be read, or only from a copy too old to show recent sign-outs, a session this server confirmed within the last
// SIGN_IN_GRACE_MS (5 minutes) is still let through, so a passing slowdown of the database refuses nobody; past that, whether the session is still good is
// not known, and nothing is let through on it: the request is answered "cannot confirm your sign-in, try again", and the person stays signed in. A sign-out
// or a removal therefore takes effect everywhere within those 5 minutes at most, even while the database cannot be read. Until 20 Nov 2026 such a session
// was let through on this server's own list for as long as the outage lasted, so a session signed out on another server, or a member removed after the copy
// was taken, could still read records (independent audit, 20 Nov 2026).
import { createHash } from "node:crypto";
import { dbMode, platformSql as sql } from "./db";
import { batched } from "./lookups";
import { forgetSession, isSignedOut } from "./tokens";

const sessionHash = (sessionId: string) => createHash("sha256").update(sessionId).digest("hex");
const signedOutRecorded = batched<string, boolean>(async (hashes) => new Map((await sql`select session_hash from signed_out_sessions where session_hash = any(${sql.array(hashes)}) and expires_at > ${Math.floor(Date.now() / 1000)}`).map((r: any) => [r.session_hash as string, true])), false);
/** Whether a sign-in can be confirmed is not known (the shared list or membership could not be read, or only from an old copy, for longer than the grace
 *  below): answered 503, never 401, so the person stays signed in. */
export class SignInUnconfirmed extends Error {}
/** A copy taken longer ago than this cannot say who has been signed out or removed since; a live replica (no copy time) is current. */
const COPY_TRUSTED_MS = Number(process.env.SIGN_IN_COPY_TRUSTED_MS ?? 120_000);
export function signInStateKnown() { return !dbMode.readOnly || !dbMode.copyAt || Date.now() - Date.parse(dbMode.copyAt) <= COPY_TRUSTED_MS; }
const GRACE_MS = Number(process.env.SIGN_IN_GRACE_MS ?? 300_000);
/** When each thing (a session, a member) was last confirmed from the main database or a current copy, so a short outage can be ridden out on that, and no
 *  longer. Kept small: anything confirmed longer ago than the grace is no use and is dropped. */
export function confirmations() {
  const at = new Map<string, number>();
  return {
    confirm(key: string) { at.set(key, Date.now()); if (at.size > 20_000) for (const [k, t] of at) if (Date.now() - t > GRACE_MS) at.delete(k); },
    /** Lets the caller go on with what it last confirmed, if that was within the grace; otherwise says the state is not known. */
    orRefuse(key: string, why: string) { const t = at.get(key); if (t === undefined || Date.now() - t > GRACE_MS) throw new SignInUnconfirmed(why); },
  };
}
const sessions = confirmations();
export async function signedOutAnywhere(sessionId: string, exp: number): Promise<boolean> {
  if (!sessionId) return false;
  if (isSignedOut(sessionId)) return true;
  if (!signInStateKnown()) { sessions.orRefuse(sessionId, "the copy in use is older than the sign-outs it would need to show"); return false; }
  let recorded: boolean;
  try { recorded = await signedOutRecorded(sessionHash(sessionId)); }
  catch { sessions.orRefuse(sessionId, "the shared sign-out list could not be read"); return false; }
  if (recorded) forgetSession(sessionId, exp); else sessions.confirm(sessionId);
  return recorded;
}
export async function shareSignOut(sessionId: string, exp: number) {
  forgetSession(sessionId, exp);
  try {
    await sql`insert into signed_out_sessions (session_hash, expires_at) values (${sessionHash(sessionId)}, ${exp}) on conflict (session_hash) do nothing`;
    await sql`delete from signed_out_sessions where expires_at < ${Math.floor(Date.now() / 1000) - 60}`;   // tidy: expired tokens need no record
  } catch (e) { console.error(JSON.stringify({ level: "warn", event: "signout.not_shared", error: String((e as Error)?.message ?? e) })); }
}
