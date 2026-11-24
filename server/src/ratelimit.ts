// Rate limiting: one place that decides how often anyone may do anything.
//
// Two stores sit behind one interface:
//   - memory (per server process): fast, for ordinary request rates;
//   - shared (the database): for the limits that must hold even if an attacker spreads attempts over several servers or restarts one
//     (sign-in, sign-up, e-mail sending, code checks).
// Memory limits use a sliding-window counter (the current window plus the previous one, weighted): cheap, and a burst at a window
// boundary cannot double the allowance, but in the worst case (all traffic bunched at the edges) it can let through up to about twice the
// limit in one trailing window. Shared limits guard against guessing and e-mail flooding, so they are exact: one row per attempt.
// Memory is bounded: expired entries are swept and there is a hard cap, so flooding the service with made-up
// addresses cannot exhaust it. If the shared store is unreachable, it falls back to memory rather than letting everything through.
import { createHash } from "node:crypto";
import { config } from "./config";
import { platformSql as sql } from "./db";   // platform-wide tables: never one organisation's (db.ts)

export interface Verdict { allowed: boolean; retryAfterSec: number; remaining: number }
interface Rule { limit: number; windowMs: number; shared: boolean; /** Limits that protect others from one tenant grow with that tenant: this many per person in it, when that comes to more than the limit itself. */ perMember?: number }

const MIN = 60_000;
/** Owner rule (2026-11-02): anything that guesses a secret (a password, an e-mailed code, an invitation link) gets at most 5 failed attempts in any 15 minutes
 * for the thing being guessed. Exact (a sliding log in the database), so it holds across servers and restarts. One sender address keeps a higher allowance
 * (login_ip, verify_ip) because a whole office can share one public address; it still stops one machine trying many accounts. */
export const AUTH_ATTEMPTS = { limit: 5, windowMs: 15 * MIN } as const;
const defaults = {
  // ordinary request rates (memory)
  ip: { limit: config.rateIpPerMin, windowMs: MIN, shared: false },
  // A request carrying a session is limited per person and per tenant below. An office, or a whole company behind one gateway, shares one public address, so its address may not be what stops it. This one only stops a flood of forged sessions, before each must be checked.
  ip_signed_in: { limit: config.rateIpSignedInPerMin, windowMs: MIN, shared: false },
  // Sessions claimed by a cookie that failed the check, per address. Past this, a request from the address that claims a session is refused before its
  // session is checked, so made-up cookies cannot make this server call the sign-in service once per request (code review, 16 Nov 2026, A-M10). A real
  // browser fails at most a few times (an ended session, then the sign-in page); an office behind one address still has room for many such at once.
  session_failed_ip: { limit: 30, windowMs: MIN, shared: false },
  static: { limit: 600, windowMs: MIN, shared: false },
  user: { limit: config.rateUserPerMin, windowMs: MIN, shared: false },
  upload: { limit: 40, windowMs: MIN, shared: false },
  match: { limit: 120, windowMs: MIN, shared: false },
  settings: { limit: 20, windowMs: MIN, shared: false },
  // Portal work (src/index.ts). Complementary scopes, never IP alone: recruiters in one office share a public address. The one-person limits stop a runaway
  // client, the portal and organisation limits stop one tenant using the shared service up, and none of them touches the 500-slot allowance (that is reserved,
  // atomically, in src/batches.ts). The consequential, low-frequency ones are SHARED (the database), so they hold across servers; the high-frequency ones are
  // per server (a database call per status poll would cost more than it protects) and are backed by the proxy limit a deployment should add in front.
  // Initial thresholds come from measured use (docs/product/RATE_LIMITS.md): a 500-file batch from one person moves about 35 files a minute here, so file transfers
  // INTO an admitted batch have a ceiling far above that, while asking for a reservation is rare and tightly limited.
  api_portal: { limit: 3000, windowMs: MIN, shared: false, perMember: 30 },        // all authenticated traffic from one portal
  api_org: { limit: 6000, windowMs: MIN, shared: false, perMember: 30 },           // all authenticated traffic from one organisation
  reserve_user: { limit: 20, windowMs: 10 * MIN, shared: true },    // asking for a batch reservation
  reserve_portal: { limit: 80, windowMs: 10 * MIN, shared: true },
  reserve_org: { limit: 300, windowMs: 60 * MIN, shared: true },
  upload_portal: { limit: 300, windowMs: MIN, shared: false, perMember: 2 },      // single uploads (each also reserves a slot) from one portal
  upload_file_user: { limit: 240, windowMs: MIN, shared: false },   // file transfers into an already-admitted batch
  upload_file_portal: { limit: 900, windowMs: MIN, shared: false },
  upload_bytes_user: { limit: 400 * 1024 * 1024, windowMs: MIN, shared: false },     // bytes sent
  upload_bytes_portal: { limit: 1536 * 1024 * 1024, windowMs: MIN, shared: false },
  status_user: { limit: 300, windowMs: MIN, shared: false },        // progress, capacity and batch-list polling
  status_portal: { limit: 1500, windowMs: MIN, shared: false, perMember: 12 },
  batch_action_user: { limit: 30, windowMs: 10 * MIN, shared: true },   // cancel, retry, dismiss
  export_user: { limit: 30, windowMs: 10 * MIN, shared: true },     // batch reports
  invite_user: { limit: 30, windowMs: 60 * MIN, shared: true },     // each invitation can send an e-mail
  invite_portal: { limit: 100, windowMs: 60 * MIN, shared: true },
  invite_org: { limit: 300, windowMs: 24 * 60 * MIN, shared: true },
  member_user: { limit: 60, windowMs: 60 * MIN, shared: true },     // removing, revoking, resending
  match_portal: { limit: 600, windowMs: MIN, shared: false, perMember: 6 },       // matching has its own limits and never touches upload slots
  match_org: { limit: 1500, windowMs: MIN, shared: false, perMember: 6 },
  // sign-in: failures are counted three ways, so guessing one account from many addresses, or many accounts from one address, both hit a wall
  login_pair: { ...AUTH_ATTEMPTS, shared: true },                 // one address trying one account
  login_email: { ...AUTH_ATTEMPTS, shared: true },                // any addresses trying one account (was 10 until 2026-11-02)
  login_ip: { limit: 30, windowMs: 15 * MIN, shared: true },      // one address trying any accounts: wrong passwords only, so an office signs in at once (guess sender)
  // sign-up and e-mail: these cost real e-mails and must not be usable to flood someone's inbox
  signup_ip: { limit: 5, windowMs: 60 * MIN, shared: true },
  signup_email: { limit: 3, windowMs: 30 * MIN, shared: true },
  resend_email: { limit: 3, windowMs: 15 * MIN, shared: true },
  reset_email: { limit: 3, windowMs: 15 * MIN, shared: true },    // asking for a password reset code: the same cost in real e-mail as a resend
  reset_ip: { limit: 10, windowMs: 60 * MIN, shared: true },
  // checking an e-mailed code: failures only
  verify_email: { ...AUTH_ATTEMPTS, shared: true },               // wrong codes for one address (was 8 until 2026-11-02)
  verify_ip: { limit: 30, windowMs: 15 * MIN, shared: true },     // wrong codes only, per sender (guess sender)
  // opening an invitation link that is unknown, used, revoked or expired: failures only, per sender (a valid link is never counted)
  invite_lookup_ip: { ...AUTH_ATTEMPTS, shared: true },
  // accepting an invitation while signed in: failures per person, never per address (an office shares one address, and one colleague's expired links
  // must not stop another accepting a valid one)
  invite_accept_user: { ...AUTH_ATTEMPTS, shared: true },
  ops_token_ip: { ...AUTH_ATTEMPTS, shared: true },   // the monitor's service token
  console_signin: { ...AUTH_ATTEMPTS, shared: true }, // the owner's console: one account, so wrong passwords are counted for it, from any address
  passkey_options_ip: { limit: 60, windowMs: MIN, shared: false },   // asking for a challenge: costs the provider a row, guesses nothing
  passkey_fail_ip: { limit: 30, windowMs: 15 * MIN, shared: true },   // rejected passkey sign-ins per address; an office shares one, and a cancelled prompt never reaches here
} satisfies Record<string, Rule>;
export type Tier = keyof typeof defaults;

/** For tests and tuning only: RATE_OVERRIDES='{"login_email":3}' lowers (or raises) a limit without touching code. */
const overrides: Partial<Record<Tier, number>> = (() => { try { return JSON.parse(process.env.RATE_OVERRIDES ?? "{}"); } catch { return {}; } })();
// In production an override may lower a limit, never raise one that guards a secret: at most 5 tries in 15 minutes for anything that guesses one (owner's
// rule). The server refuses to start rather than run with it raised (independent security review, 23 Nov 2026).
for (const [tier, n] of Object.entries(overrides) as [Tier, number][]) {
  const base: Rule | undefined = defaults[tier];
  if (config.cookieSecure && base && base.limit === AUTH_ATTEMPTS.limit && base.windowMs === AUTH_ATTEMPTS.windowMs && Number(n) > AUTH_ATTEMPTS.limit)
    throw new Error(`RATE_OVERRIDES must not raise ${tier} above ${AUTH_ATTEMPTS.limit} in production (COOKIE_SECURE=true): it guards a secret.`);
}
/** RATE_PER_MEMBER='{"api_portal":40}': how much each person adds to a tenant's limits. */
const perMemberOverrides: Partial<Record<Tier, number>> = (() => { try { return JSON.parse(process.env.RATE_PER_MEMBER ?? "{}"); } catch { return {}; } })();
const rule = (tier: Tier, people = 0): Rule => {
  const base: Rule = defaults[tier], limit = overrides[tier] ?? base.limit, each = perMemberOverrides[tier] ?? base.perMember ?? 0;
  return { ...base, limit: Math.max(limit, each * people) };
};

// ---------------------------------------------------------------- memory store
interface Entry { start: number; count: number; prev: number }
export const MAX_KEYS = Number(process.env.RATE_MAX_KEYS ?? 100_000);
const mem = new Map<string, Entry>();
export const memoryStats = () => ({ keys: mem.size, evictions });
let evictions = 0;

function roll(e: Entry, windowMs: number, now: number) {
  const start = Math.floor(now / windowMs) * windowMs;
  if (start === e.start) return;
  e.prev = start - e.start === windowMs ? e.count : 0; // only the immediately previous window still counts
  e.count = 0; e.start = start;
}
const weighted = (e: Entry, windowMs: number, now: number) => e.prev * (1 - (now - e.start) / windowMs) + e.count;

function memTake(key: string, r: Rule, hit: boolean, cost = 1, now = Date.now()): Verdict {
  let e = mem.get(key);
  if (!e) {
    if (mem.size >= MAX_KEYS) { // flooded with new keys: drop the oldest tenth rather than grow without bound
      let n = Math.ceil(MAX_KEYS / 10);
      for (const k of mem.keys()) { mem.delete(k); evictions++; if (--n <= 0) break; }
    }
    e = { start: Math.floor(now / r.windowMs) * r.windowMs, count: 0, prev: 0 };
    mem.set(key, e);
  }
  roll(e, r.windowMs, now);
  const used = weighted(e, r.windowMs, now);
  const allowed = used + (cost - 1) < r.limit;   // a request that would carry the total past the limit is refused whole
  if (hit && allowed) e.count += cost;
  const remaining = Math.max(0, Math.floor(r.limit - (used + (hit && allowed ? cost : 0))));
  // time until the weighted count falls below the limit again (at worst, the end of the window)
  const retry = allowed ? 0 : Math.max(1, Math.ceil(((e.start + r.windowMs) - now) / 1000));
  return { allowed, retryAfterSec: retry, remaining };
}

// ---------------------------------------------------------------- shared store
const hashKey = (tier: string, key: string) => createHash("sha256").update(`${tier}:${key}`).digest("hex").slice(0, 40);
let warned = false;

/**
 * Exact sliding log, used for the shared (security) limits: one stored row per attempt, a limit of "N in the last W" means exactly that,
 * with no boundary effects. `events` are the attempts still inside the window. Pure, so the arithmetic is tested without a database.
 * An attempt is allowed while fewer than `limit` earlier attempts are inside the window; when refused, `retryAfterSec` is when the
 * oldest attempts that matter leave the window.
 */
export function slidingLog(events: { at: number; count: number }[], now: number, windowMs: number, limit: number): Verdict {
  const live = events.filter((e) => e.at > now - windowMs).sort((a, b) => a.at - b.at);
  let total = live.reduce((n, e) => n + e.count, 0);
  if (total < limit) return { allowed: true, retryAfterSec: 0, remaining: limit - total };
  let retryAt = now + windowMs;
  for (const e of live) { total -= e.count; if (total < limit) { retryAt = e.at + windowMs; break; } }
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((retryAt - now) / 1000)), remaining: 0 };
}

async function sharedTake(tier: Tier, key: string, r: Rule, hit: boolean, now = Date.now()): Promise<Verdict> {
  const k = hashKey(tier, key);
  // One database call: it takes a per-key lock, so two simultaneous attempts (even on different servers) cannot both squeeze under the limit.
  const rows = await sql`select rate_limit_take(${k}, ${now}, ${r.windowMs}, ${r.limit}, ${hit}) as events`;
  const events = (rows[0].events as [number | string, number][]).map(([at, count]) => ({ at: Number(at), count }));
  const verdict = slidingLog(events, now, r.windowMs, r.limit);
  return hit && verdict.allowed ? { ...verdict, remaining: Math.max(0, verdict.remaining - 1) } : verdict;
}

async function run(tier: Tier, key: string, hit: boolean, cost = 1, people = 0, at = Date.now()): Promise<Verdict> {
  const r = rule(tier, people);
  if (r.shared) {
    try { return await sharedTake(tier, key, r, hit, at); }
    catch (e) { if (!warned) { warned = true; console.error(JSON.stringify({ level: "warn", event: "ratelimit.shared_unavailable", error: String((e as Error)?.message ?? e) })); } }
  }
  return memTake(`${tier}:${key}`, r, hit, cost, at);
}

/** Counts one use (or `cost` units, for per-server tiers such as bytes) of `tier` for `key` and says whether it is allowed. Metrics are kept per tier. */
export async function consume(tier: Tier, key: string, cost = 1, people = 0): Promise<Verdict> {
  const v = await run(tier, key, true, cost, people);
  const m = (metrics[tier] ??= { allowed: 0, limited: 0, lastLimitedAt: 0, distinctKeysLimited: 0 });
  if (v.allowed) m.allowed++;
  else { m.limited++; m.lastLimitedAt = Date.now(); if (!limitedKeys.has(tier + key)) { if (limitedKeys.size < 5000) limitedKeys.add(tier + key); m.distinctKeysLimited++; } }
  return v;
}
// Metrics: counts only (no keys, no addresses, no content), bounded by the number of tiers. A tier that limits many different accounts, or the same one
// over and over, is the pattern to look at; the figures are per server process and are served to the platform operator at /api/health/details.
const metrics: Record<string, { allowed: number; limited: number; lastLimitedAt: number; distinctKeysLimited: number }> = {};
const limitedKeys = new Set<string>();
export const rateMetrics = () => Object.fromEntries(Object.entries(metrics).map(([t, m]) => [t, { ...m, lastLimitedAt: m.lastLimitedAt ? new Date(m.lastLimitedAt).toISOString() : null }]));
/** At most `max` of something running at once for `key` (per server): used for matching, so a flood of matches cannot starve everything else. Returns a release function, or null when full. */
const running = new Map<string, number>();
export function acquireSlot(key: string, max: number): (() => void) | null {
  const n = running.get(key) ?? 0;
  if (n >= max) return null;
  running.set(key, n + 1);
  let done = false;
  return () => { if (done) return; done = true; const m = (running.get(key) ?? 1) - 1; if (m <= 0) running.delete(key); else running.set(key, m); };
}
/** For failure-counting tiers: is this key already over its limit? Does not count. */
export const isBlocked = async (tier: Tier, key: string) => !(await run(tier, key, false)).allowed;
/** For failure-counting tiers: 0 if allowed, otherwise the seconds until the next attempt is allowed. Does not count. */
export const blockedFor = async (tier: Tier, key: string) => { const v = await run(tier, key, false); return v.allowed ? 0 : v.retryAfterSec; };
/** The limit and window a tier uses now (after any override): for tests and the documentation. */
export const limitOf = (tier: Tier, people = 0) => { const r = rule(tier, people); return { limit: r.limit, windowMs: r.windowMs, shared: r.shared }; };
/** "Try again in 12 minutes": what a refused person is told, from the real time left. */
export const waitText = (sec: number) => sec < 90 ? "about a minute" : `${Math.ceil(sec / 60)} minutes`;
/** For failure-counting tiers: record one failure. Not for guesses at a secret (a password, an emailed code): those are counted before they are checked, by guess(),
 *  which records a sender's failures itself (wrong()). */
export const recordFailure = async (tier: Tier, key: string) => { await run(tier, key, true); };
/** A guess at a secret a person could find by trying (a password, an emailed code), under each of `keys`: `wait` is 0 when it may be checked, otherwise
 *  the seconds until it may. The guess is counted BEFORE it is checked, under each key's per-key lock, so however many arrive together no more than the
 *  limit are ever checked (independent security review, 23 Nov 2026: checking the count first and recording a failure after let a burst of simultaneous
 *  guesses all pass before any was counted, some 64 a server instead of 5). A wrong guess stays counted; `right()` takes back a right one, so people who
 *  sign in correctly never use up their attempts. A refused guess counts nothing.
 *  `sender` (the address the guess comes from) is checked first but counted only when the caller says the guess was wrong (`wrong()`): an office of any
 *  size behind one address may sign in all at the same moment (owner, 23 Nov 2026: "it shouldn't be a cap"; the first load test refused 10 of 50 who did),
 *  and the address is still stopped after its limit of wrong answers. A burst of wrong ones can pass that limit by at most the requests one server has in
 *  hand at once; the secret itself (`keys`) cannot be passed at all. */
export interface Guess { wait: number; right(): Promise<void>; wrong(): Promise<void> }
export async function guess(keys: readonly (readonly [Tier, string])[], sender?: readonly [Tier, string]): Promise<Guess> {
  const held = sender ? await blockedFor(sender[0], sender[1]) : 0;
  if (held) return { wait: held, right: async () => {}, wrong: async () => {} };
  const taken: { tier: Tier; key: string; at: number }[] = [];
  let wait = 0;
  for (const [tier, key] of keys) {
    const at = Date.now(), v = await run(tier, key, true, 1, 0, at);
    if (v.allowed) taken.push({ tier, key, at }); else wait = Math.max(wait, v.retryAfterSec);
  }
  const takeBack = async () => { for (const t of taken.splice(0)) await uncount(t.tier, t.key, t.at); };
  if (wait) { await takeBack(); return { wait, right: async () => {}, wrong: async () => {} }; }
  return { wait: 0, right: takeBack, wrong: async () => { if (sender) await recordFailure(sender[0], sender[1]); } };
}
/** Takes back one counted use of `tier` for `key`, the one counted at `at`. */
async function uncount(tier: Tier, key: string, at: number) {
  const r = rule(tier, 0);
  if (r.shared) {
    try {
      const k = hashKey(tier, key);
      await sql`update rate_limits set count = count - 1 where key = ${k} and window_start = ${at} and count > 0`;
      await sql`delete from rate_limits where key = ${k} and window_start = ${at} and count <= 0`;
      return;
    } catch { /* counted in memory instead (run's fallback): taken back there */ }
  }
  const e = mem.get(`${tier}:${key}`);
  if (e && e.count > 0 && at >= e.start) e.count--;
}
/** An exact "at most once every N ms" gate (a sliding window is too loose for this). Checks and starts the cooldown in one call. */
const lastAt = new Map<string, number>();
export async function cooldown(key: string, ms: number): Promise<Verdict> {
  const now = Date.now(), k = hashKey("cooldown", key);
  try {
    const recent = (await sql`select max(window_start) as at from rate_limits where key = ${k} and window_start > ${now - ms}`)[0]?.at;
    if (recent != null) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((Number(recent) + ms - now) / 1000)), remaining: 0 };
    await sql`insert into rate_limits (key, window_start, count) values (${k}, ${now}, 1) on conflict do nothing`;
    return { allowed: true, retryAfterSec: 0, remaining: 0 };
  } catch {
    const last = lastAt.get(k) ?? 0;
    if (now - last < ms) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((last + ms - now) / 1000)), remaining: 0 };
    lastAt.set(k, now);
    if (lastAt.size > MAX_KEYS) lastAt.clear();
    return { allowed: true, retryAfterSec: 0, remaining: 0 };
  }
}
/** Forget a key's failures (after a successful sign-in on that exact pair). */
export async function clear(tier: Tier, key: string) {
  mem.delete(`${tier}:${key}`);
  try { await sql`delete from rate_limits where key = ${hashKey(tier, key)}`; } catch { /* the memory copy is already gone */ }
}

// ---------------------------------------------------------------- housekeeping
let sweeper: ReturnType<typeof setInterval> | null = null;
export function startRateLimitSweeper() {
  if (sweeper) return;
  let rounds = 0;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of mem) if (now - e.start > 2 * 60 * MIN) mem.delete(k); // anything idle for two hours is gone for every tier
    if (++rounds % 10 === 0) sql`delete from rate_limits where window_start < ${now - 2 * 60 * MIN}`.catch(() => {});
  }, MIN);
  sweeper.unref();
}
