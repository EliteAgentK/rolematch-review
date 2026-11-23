import { AsyncLocalStorage } from "node:async_hooks";
import postgres, { type ReservedSql, type Sql, type TransactionSql } from "postgres";
import { config } from "./config";
import { dbTls } from "./dbTls";
import { record } from "./timing";

if (!config.databaseUrl) throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.");

const searchPath = config.dbSchema !== "public" ? { search_path: config.dbSchema } : {};
const primary = postgres(config.databaseUrl, { ...dbTls(config.databaseUrl), max: config.dbPoolSize, idle_timeout: 30, connect_timeout: 10, connection: searchPath, onnotice: () => {} });
// The copy is opened read-only: any attempt to save on it is refused by PostgreSQL itself (error 25006), which the API reports as "saving is paused".
const copy = config.readFallbackUrl
  ? postgres(config.readFallbackUrl, { ...dbTls(config.readFallbackUrl), max: config.dbPoolSize, idle_timeout: 30, connect_timeout: 5, connection: { ...searchPath, default_transaction_read_only: true }, onnotice: () => {} })
  : null;

/** Whether reads are being served from the copy because the main database is unreachable. */
export const dbMode = { readOnly: false, since: 0, copyAt: "" as string };
/** When the copy was taken, if it is refreshed periodically (scripts/refreshCopy.ts records it); "" for a live copy, which has no such record. */
async function readCopyAge() {
  if (!copy) return;
  try { const [r] = await copy`select refreshed_at from rolematch_copy.meta where id = 1`; dbMode.copyAt = r ? new Date(r.refreshed_at).toISOString() : ""; }
  catch { dbMode.copyAt = ""; }
}
// The database keeps organisations apart too (migration 014). Work for one organisation runs inside forOrg: every query in it, however deep in the
// code and however it was started, runs as rolematch_tenant with app.org_id set, so PostgreSQL shows and accepts only that organisation's rows
// even if a query forgot its "where org_id". Outside forOrg the server works as the owner: sign-in, rate limits, claiming queue jobs, migrations.
// Portals (migration 019): inside a portal's work the database also sees app.portal_id, and every portal table's row rule needs it to match the row's portal.
// The server sets it only from a verified membership (index.ts) or from the portal recorded on a queue job, never from anything the browser claims.
type Scope = { org: string | null; portal: string | null };
const orgScope = new AsyncLocalStorage<Scope>();
/** Runs fn as one organisation, with no portal: only organisation-level rows (settings, the portal list) are visible. */
export const forOrg = <T>(orgId: string, fn: () => T): T => orgScope.run({ org: orgId, portal: null }, fn);
/** Runs fn as one portal of one organisation: the database refuses every other portal's and organisation's rows. */
export const forPortal = <T>(orgId: string, portalId: string, fn: () => T): T => orgScope.run({ org: orgId, portal: portalId }, fn);
/** Runs fn as the platform itself, across organisations (claiming jobs, replaying held work). Use only for work that is not one organisation's. */
export const asSystem = <T>(fn: () => T): T => orgScope.run({ org: null, portal: null }, fn);
/** The organisation the current work is for, or null for platform work. */
export const currentOrg = () => orgScope.getStore()?.org ?? null;
/** The portal the current work is for, or null. */
export const currentPortal = () => orgScope.getStore()?.portal ?? null;

// Each query borrows one connection, names the role and organisation, runs, and puts both back, all sent at once (one round trip, measured
// 204 ms against 194 ms for a bare query to the dev database). This needs a session-mode connection (Supabase port 5432), never transaction mode.
// If naming the role fails, the query's answer is thrown away and the error raised; the connection is put back only once the reset has run.
const ENTER = (r: ReservedSql, orgId: string, portalId: string | null) => r`select set_config('role', 'rolematch_tenant', false), set_config('app.org_id', ${orgId}, false), set_config('app.portal_id', ${portalId ?? ''}, false)`;
const LEAVE = (r: ReservedSql) => r`select set_config('role', 'none', false), set_config('app.org_id', '', false), set_config('app.portal_id', '', false)`;
async function asTenant<T>(target: Sql, orgId: string, portalId: string | null, run: (r: ReservedSql) => Promise<T>): Promise<T> {
  const tw = performance.now();
  const r = await target.reserve();
  record("db.pool_wait", performance.now() - tw);   // time spent waiting for a free connection
  const tx = performance.now();
  const [entered, result, left] = await Promise.allSettled([ENTER(r, orgId, portalId), run(r), LEAVE(r)]);
  if (left.status === "rejected") await LEAVE(r).catch((e) => console.error(JSON.stringify({ level: "error", event: "db.tenant_reset_failed", reason: String(e?.message ?? e).slice(0, 200), note: "this connection now sees no rows until it is replaced" })));
  r.release();
  record("db.exec", performance.now() - tx);   // from the connection being ours until it is put back (includes the role switch and reset)
  if (entered.status === "rejected") throw entered.reason;
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
/** A transaction for one organisation: the role and organisation last until it ends. */
async function beginAsTenant<T>(target: Sql, orgId: string, portalId: string | null, fn: (q: TransactionSql) => Promise<T>): Promise<T> {
  const r = await target.reserve();
  try {
    await Promise.all([r`begin`, r`select set_config('role', 'rolematch_tenant', true), set_config('app.org_id', ${orgId}, true), set_config('app.portal_id', ${portalId ?? ''}, true)`]);
    try { const out = await fn(r as unknown as TransactionSql); await r`commit`; return out; }
    catch (e) { await r`rollback`.catch(() => {}); throw e; }
  } finally { r.release(); }
}

/** Every database call goes through this, so the switch to the copy and back, and the organisation, are in one place. */
export const sql: Sql = new Proxy(primary, {
  apply: (_t, self, args) => {
    const target = dbMode.readOnly && copy ? copy : primary;
    const query = Reflect.apply(target, self, args);
    const orgId = currentOrg(), portalId = currentPortal();
    // A tagged query for one organisation: still a real query object, so it can be placed inside another as a fragment, but running it goes through asTenant.
    if (orgId && Array.isArray(args[0]?.raw)) {
      const run = () => asTenant(target, orgId, portalId, (r) => (r as any)(...args));
      Object.assign(query, { then: (a: any, b: any) => run().then(a, b), catch: (b: any) => run().catch(b), finally: (f: any) => run().finally(f) });
    }
    return query;
  },
  get: (_t, prop) => {
    const target = dbMode.readOnly && copy ? copy : primary;
    const orgId = currentOrg(), portalId = currentPortal();
    if (orgId && prop === "unsafe") return (text: string, params?: any[], opts?: any) => asTenant(target, orgId, portalId, (r) => r.unsafe(text, params, opts) as any);
    if (orgId && prop === "begin") return (fn: (q: TransactionSql) => Promise<unknown>) => beginAsTenant(target, orgId, portalId, fn);
    const v = (target as any)[prop]; return typeof v === "function" ? v.bind(target) : v;
  },
}) as Sql;

/** The same connection, always as the platform: for modules whose tables belong to no one organisation (sign-in, rate limits, sign-outs, the queue,
 * the schema check). Whether a query runs as the platform is decided when it is written, so it holds even when called during one organisation's work. */
export const platformSql: Sql = new Proxy(primary, {
  apply: (_t, self, args) => asSystem(() => Reflect.apply(sql, self, args)),
  get: (_t, prop) => asSystem(() => (sql as any)[prop]),
}) as Sql;

/** The main database itself, as the platform, whichever mode the server is in. For checks that are ABOUT the main database (its structure, before
 * saving is allowed again): routed through `sql`, they would read the copy while read-only and could never pass when the copy differs (R35). */
export const mainSql: Sql = primary;

/** True for PostgreSQL's "cannot save in a read-only transaction", raised by the copy. */
export const isReadOnlyRefusal = (e: unknown) => (e as { code?: string })?.code === "25006";

// Health watch: the main database is checked every few seconds. Two failures in a row switch reads to the copy; two successes switch back.
// Without a copy configured nothing changes: the server behaves exactly as before.
const CHECK_EVERY = Number(process.env.DB_CHECK_MS ?? 5000);
// The check has its own single connection: if it shared the server's pool it would queue behind busy work, time out, and be mistaken for an outage.
const probe = config.readFallbackUrl ? postgres(config.databaseUrl, { ...dbTls(config.databaseUrl), max: 1, idle_timeout: 120, connect_timeout: 8, connection: searchPath, onnotice: () => {} }) : null;
const SWITCH_AFTER = Number(process.env.DB_SWITCH_AFTER ?? 3), CHECK_TIMEOUT = Number(process.env.DB_CHECK_TIMEOUT_MS ?? 5000);
let fails = 0, oks = 0, checking = false, lastReason = "", watching: ReturnType<typeof setInterval> | undefined;
const within = async (q: () => Promise<unknown>, ms: number) => { let t: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([q(), new Promise((_, no) => { t = setTimeout(() => no(new Error(`no answer within ${ms} ms`)), ms); })]); } finally { clearTimeout(t); } };
/** Why a check failed, without addresses or credentials: an error code or a short message. */
/** Whether the copy can stand in: it answers AND holds this server's schema (a test or trial runs in its own schema, which the copy does not have;
 * switching to it would fail every read and, before R35, never switch back). */
let copyUnusableNoted = false;
async function copyServes(): Promise<boolean> {
  if (!copy) return false;
  try {
    let has = false;
    await within(async () => { has = !!(await copy`select to_regclass('documents') is not null as ok`)[0]?.ok; }, CHECK_TIMEOUT);
    if (!has && !copyUnusableNoted) { copyUnusableNoted = true; console.error(JSON.stringify({ level: "error", event: "db.copy_unusable", reason: `the copy does not hold schema "${config.dbSchema}"; not switching to it`, cause: lastReason })); }
    if (has) copyUnusableNoted = false;
    return has;
  } catch { return false; }
}
const reasonOf = (e: unknown) => { const x = e as { code?: string; message?: string }; return (x?.code ? `${x.code}: ` : "") + String(x?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "[address]").slice(0, 120); };
async function checkPrimary(): Promise<boolean> {
  if (checking || !probe) return !dbMode.readOnly;
  checking = true;
  let up = false;
  try { await within(() => probe`select 1`.execute(), CHECK_TIMEOUT); up = true; } catch (e) { lastReason = reasonOf(e); } finally { checking = false; }
  if (up) { fails = 0; oks++; copyUnusableNoted = false; } else { oks = 0; fails++; }
  if (dbMode.readOnly) await readCopyAge();
  if (!dbMode.readOnly && fails >= SWITCH_AFTER && copy) {
    // only switch to a copy that answers: with both down, switching would make things worse, so stay and say so (once per outage)
    const copyUp = await copyServes();
    if (copyUp) { await readCopyAge(); dbMode.readOnly = true; dbMode.since = Date.now(); console.error(JSON.stringify({ level: "warn", event: "db.read_only", reason: "main database unreachable; reading from the copy", cause: lastReason })); }
    else if (fails === SWITCH_AFTER && !copyUnusableNoted) console.error(JSON.stringify({ level: "error", event: "db.both_unreachable", reason: "main database and copy both unreachable; not switching", cause: lastReason }));
  }
  if (dbMode.readOnly && oks >= 2 && (await returnCheck())) { dbMode.readOnly = false; dbMode.since = Date.now(); for (const fn of readWriteListeners) fn(); console.error(JSON.stringify({ level: "info", event: "db.read_write", reason: "main database reachable again" })); }
  return up;
}
const readWriteListeners: (() => void)[] = [];
/** Called each time saving resumes (held uploads are replayed then). */
export const onReadWrite = (fn: () => void) => { readWriteListeners.push(fn); };

/** Asked before saving is allowed again (index.ts checks the database structure first, so nothing is written into a database that does not match). */
let returnCheck: () => Promise<boolean> = async () => true;
export const setReturnCheck = (fn: () => Promise<boolean>) => { returnCheck = fn; };

/** A failure that passes by itself: the pooler has no free connection (EMAXCONNSESSION, "too many clients"), or the database cannot be reached, is
 *  restarting or dropped the connection. Not a fault in the query or the data. */
const passingDbFailure = (e: unknown) => {
  const x = e as { code?: string; message?: string }, code = String(x?.code ?? ""), msg = String(x?.message ?? "");
  return /max clients|too many (clients|connections)|remaining connection slots/i.test(msg) || /^(08|53|57P0)/.test(code) || /^(ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|CONNECTION_)/.test(code);
};
/** Runs a start-up step that needs the database, asking again while the failure is one that passes by itself, more slowly each time (2 s, 4 s ... 30 s).
 *  Crashing would only start the process again, take more connections and make it worse: on 11 Nov 2026 the PC slept, Supabase's pooler kept the
 *  sleeping processes' 15 connections, and every restart failed at once until someone cleared them. Any other failure is thrown as before. */
export async function whenDatabaseAnswers<T>(what: string, step: () => Promise<T>): Promise<T> {
  for (let wait = 2000, tries = 1; ; tries++) {
    try { const out = await step(); if (tries > 1) console.error(JSON.stringify({ level: "info", event: "db.answering", what, tries })); return out; }
    catch (e) {
      if (!passingDbFailure(e)) throw e;
      console.error(JSON.stringify({ level: "warn", event: "db.waiting", what, tries, nextInSeconds: wait / 1000, reason: reasonOf(e) }));
      await new Promise((ok) => setTimeout(ok, wait)); wait = Math.min(30_000, wait * 2);
    }
  }
}

/** At start: if a copy is configured and the main database cannot be reached, start read-only from the copy instead of not starting at all. */
export async function startUp(): Promise<"main" | "copy"> {
  if (!copy) return "main";
  if ((await checkPrimary()) || (await checkPrimary())) return "main";
  if (!(await copyServes())) { if (!copyUnusableNoted) console.error(JSON.stringify({ level: "error", event: "db.both_unreachable", reason: "main database and copy both unreachable at start", cause: lastReason })); return "main"; }
  await readCopyAge(); dbMode.readOnly = true; dbMode.since = Date.now();
  console.error(JSON.stringify({ level: "warn", event: "db.read_only", reason: "main database unreachable at start; reading from the copy" }));
  return "copy";
}
export function watchPrimary() { if (copy && !watching) { watching = setInterval(() => void checkPrimary(), CHECK_EVERY); watching.unref?.(); } }
export type Q = Sql | TransactionSql;
export const newId = () => crypto.randomUUID();
export const iso = (d: Date | string) => new Date(d).toISOString();

/** Append-only audit entry. Pass a transaction as `q` to make it part of the same atomic change. */
export async function audit(q: Q, orgId: string, actorId: string | null, action: string, entityType: string, entityId: string | null, detail: unknown = {}, correlationId?: string) {
  await q`insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail, correlation_id)
          values (${newId()}, ${orgId}, ${actorId}, ${action}, ${entityType}, ${entityId}, ${q.json(detail as any)}, ${correlationId ?? null})`;
}
