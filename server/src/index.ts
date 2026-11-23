import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { serve } from "./httpAdapter";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { carriesSession, accountToken, finishSignup, isAdminNow, login, mayCreatePortals, passkeyLogin, reauthenticate, setPortalCreation, signedInAt, loginGuess, logout, resendSignup, sessionFrom, SignupError, startSignup, type Session, finishPasswordReset, startPasswordReset } from "./auth";
import { assertionUserVerified, attestationUserVerified, recentEnough, requireVerification } from "./passkeys";
import { record, stage, timingStats } from "./timing";
import { acquireSlot, blockedFor, consume, rateMetrics, recordFailure, startRateLimitSweeper, waitText, type Tier, type Verdict } from "./ratelimit";
import { API_CONTRACT, assertServingSettings, config, MIN_CLIENT_CONTRACT } from "./config";
assertServingSettings();
import { whenDatabaseAnswers, audit, dbMode, forOrg, forPortal, iso, isReadOnlyRefusal, newId, onReadWrite, platformSql, setReturnCheck, sql, startUp, watchPrimary } from "./db";
import { recordedFirst } from "./recorded";
import { sastMonth, sastMonthBounds } from "./sast";
import { HeldUploads, type HeldMeta } from "./heldUploads";
import { viewResponse } from "./viewer";
import { OriginalsCopy } from "./originalsCopy";
import { AuditJournal } from "./auditJournal";
import { assess } from "./match";
import { compareRank } from "./scoring";
import { contentTypeOf, describeFormats, nameDisagrees, publicFormats, sniff, unsupportedHint } from "./formats";
import { registerPipeline } from "./pipeline";
import { aiStartOf, aiStatusOf, cancelAiMatches, registerAiMatching, aiQueueFull, requestAiMatch } from "./aiMatch";
import { registerJobReading } from "./aiJobRead";
import { orgOverview } from "./orgOverview";
import { aiConfigured } from "./ai/claude";
import { startDepartmentSweep } from "./aiRead";
import { startDocumentWatch } from "./documentWatch";
import { withWorthNotingOnly } from "./worthNoting";
import { attentionRecords, isAttentionRule } from "./attention";
import { deleteRecord, registerDeletion } from "./deletion";
import { employmentEvidence, reviewEmployment, ReviewError } from "./employmentReview";
import { drain, enqueue, enqueueIn, kick, queueStats, startWorkers } from "./queue";
import { driftReport, reconcileReservations, acknowledgeBatch, batchReport, BatchError, batchView, capacityOf, finishBatch, cancelBatch, closeBatch, createBatch, noteDuplicate, noteRefusal, openBatches, openBatchFor, retryBatch } from "./batches";
import { ALWAYS_EDITABLE, CONFIGURABLE, NEVER_EDITABLE, PolicyError } from "./editPolicy";
import { CHANGE_KINDS, ConflictError, getRecord, isUuid, type ListOptions, markReviewed, ReasonRequiredError, searchRecords, updateRecord } from "./store";
import { LimitError, limitsOf, takeMatch, takeUpload, usageOf } from "./limits";
import { HIRING_MANAGER, mayEnter, VISIBLE_STATUSES, visibleToHiringManager } from "./hiringManager";
import { ApplicationError, listApplications, setApplication, shortlistOf } from "./applications";
import { forgetPortal, portalCached } from "./portalCache";
import { asVisitor, visitorAddress } from "./visitor";
import { SignInUnconfirmed } from "./signedOut";
import { activityHistory, HistoryError, invitationHistory, uploadHistory } from "./history";
import { defaultSettings, getSettings, PLATFORM_CEILINGS, saveSettings, SettingsError, settingsHistory } from "./settings";
import { deleteObjects, getObject, StoreBusy, putObject } from "./supabase";
import { identity } from "./identity";
const { passkeyDelete, passkeyEnrolOptions, passkeyEnrolVerify, passkeyList, passkeyRename, passkeySignInOptions, passkeySignInVerify } = identity;
import { schemaStatus } from "./schema";
import { withoutModelNames } from "./noModelNames";
import { shownReplacer } from "./shown";
import { defectOverview, recordingFailures, recordOccurrence, setDefectStatus } from "./occurrences";
import { noteRequest, opsHealth, validOpsToken } from "./opsHealth";
import { metricsText } from "./metrics";
import { migrate } from "./scripts/migrate";
import { mailMetrics, mailStatus } from "./mail";
import { outboxStats, startOutbox, stopOutbox } from "./outbox";
import { acceptInvitation, createPortal, invite, listMembers, lookupInvitation, notePresence, PortalError, portalsOf, removeMember, resendInvitation, resolvePortal, revokeInvitation } from "./portals";
import { appointPortalAdmin, leaveOrganisation, leavePortal, organisationPeople, setMemberRole } from "./team";
import type { Candidate, Job } from "./types";

// The database must match what this code expects before anything is written to it. If the main database cannot be reached at start and a copy is
// configured, RoleMatch starts read-only from the copy, and the same check runs before saving is allowed again (setReturnCheck below).
const strictSchema = config.cookieSecure || process.env.REQUIRE_SCHEMA_SYNC === "true";
async function checkSchema(): Promise<boolean> {
  schema = await schemaStatus();
  if (!schema.inSync && schema.pendingMigrations.length && config.autoMigrate) {
    console.log(`Applying pending migrations: ${schema.pendingMigrations.join(", ")}`);
    await migrate(false);
    schema = await schemaStatus();
  }
  if (!schema.inSync && schema.pendingMigrations.length && !config.autoMigrate) console.error(`Pending migrations were NOT applied (applying schema changes needs an explicit step: npm run migrate): ${schema.pendingMigrations.join(", ")}`);
  if (!schema.inSync) console.error("Supabase is NOT in step with the code:\n - " + schema.problems.join("\n - "));
  return schema.inSync;
}
let schema = { inSync: true, pendingMigrations: [] as string[], problems: [] as string[] } as Awaited<ReturnType<typeof schemaStatus>>;
const startedOn = await startUp();
if (startedOn === "main" && !(await whenDatabaseAnswers("the schema check", checkSchema))) {
  if (strictSchema) { console.error("Refusing to start. Apply the migrations (npm run migrate) and fix the items above."); process.exit(1); }
  console.error("Continuing because this is a development run, but fix this before relying on the data.");
}
if (startedOn === "copy") console.error("Started read-only from the copy: the database structure will be checked when the main database is back, before saving resumes.");
setReturnCheck(async () => {
  try { if (await checkSchema()) return true; } catch { return false; }
  if (strictSchema) { console.error("The main database is back but does not match the code: staying read-only until it is fixed."); return false; }
  return true; // a development run continues, as at start
});
if (!config.signupRequireCode) console.warn("TEST MODE: sign-up does not require an email code. Never use this in production.");
if (mailStatus().state === "unavailable") {
  console.error(`E-mail is unavailable (${mailStatus().reason}). Sign-up codes cannot be sent${config.signupRequireCode && !config.signupDevCode ? ": people cannot verify new sign-ups" : ""}; invitations are saved and wait.`);
  if (config.cookieSecure) { console.error("Refusing to start in production without a configured mail transport."); process.exit(1); }
}
if (mailStatus().appUrlLocalOnly) console.warn(`Invitation links point to ${config.appUrl}, which is local-only: they work only on this computer.`);
console.log(`Mail: ${mailStatus().sending === "off" ? "OFF" : mailStatus().sending === "restricted" ? `RESTRICTED to ${config.mail.allowedRecipients.length} approved recipient(s)` : "LIVE (any recipient)"}${mailStatus().transport === "preview" ? " (preview: nothing is sent)" : ""}`);
registerPipeline();
registerDeletion();
registerAiMatching(); registerJobReading();
if (config.role === "all") { await startWorkers(); startOutbox(); startDepartmentSweep(); }   // ROLE=api: separate worker processes read the documents (src/worker.ts)
// A document left "being read" with no work behind it is sent on again, or stopped with Retry (src/documentWatch.ts). Any number of servers may run it.
startDocumentWatch();
// The safety net for reservations: closes any batch that can close but whose closing event was missed (a crashed worker, an abandoned transfer). Idempotent; any number of servers may run it.
setInterval(() => void reconcileReservations().catch((e) => console.error(JSON.stringify({ level: "error", event: "reservations.reconcile_failed", reason: String(e?.message ?? e).slice(0, 120) }))), Number(process.env.RECONCILE_MS ?? 30_000)).unref?.();

// Every reply leaves out which AI RoleMatch uses (noModelNames.ts) and shows people and jobs by one rule (shown.ts).
// Every JSON reply is written by replyText, including the board's cached pages (owner, 11 Nov 2026: the board's cards still showed a name in capitals: their
// cached pages were written without this step). A test fails any JSON reply written another way (reply-text.test.ts).
const replyText = (data: unknown) => {
  const shown = shownReplacer();
  return JSON.stringify(data, function (this: unknown, key: string, value: unknown) { const v = withoutModelNames(key, value); return v === undefined ? undefined : shown.call(this, key, v); });
};
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(replyText(data), { status, headers: { "content-type": "application/json", ...headers } });
const fail = (status: number, code: string, message: string, requestId: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message, requestId, ...extra } }, status, headers);
const withCookies = (res: Response, cookies: string[]) => { for (const c of cookies) res.headers.append("set-cookie", c); return res; };

/** A 429 that always says when to try again. A little random time is added so many browsers told "wait 30 s" do not all return in the same second. */
function tooMany(requestId: string, v: Verdict, message = "Too many requests. Please slow down.") {
  return fail(429, "RATE-001", message, requestId, { "retry-after": String(Math.max(1, v.retryAfterSec) + Math.floor(Math.random() * 4)) });
}
// What a temporary rate limit says, per kind of request. It never says or implies the portal's upload allowance is used up (that is CAPACITY-001, a different
// thing with a different cause), and it tells the person that nothing they already submitted has changed.
const LIMIT_TEXT: Partial<Record<Tier, string>> = {
  reserve_user: "You are asking to reserve upload slots more often than is allowed", reserve_portal: "This portal is asking to reserve upload slots very often", reserve_org: "Your organisation is asking to reserve upload slots very often",
  upload_file_user: "Files are being sent faster than allowed", upload_file_portal: "This portal is sending files faster than allowed", upload_bytes_user: "Too much data is being sent from your account at once", upload_bytes_portal: "Too much data is being sent from this portal at once",
  status_user: "Progress is being checked more often than needed", status_portal: "This portal is checking progress very often",
  batch_action_user: "Batch actions are being repeated too quickly", export_user: "Reports are being requested too quickly",
  invite_user: "Invitations are being sent too quickly", invite_portal: "This portal is sending invitations too quickly", invite_org: "Your organisation has sent many invitations today",
  member_user: "Member changes are being made too quickly", match_portal: "This portal is requesting many matches at once", match_org: "Your organisation is requesting many matches at once",
  api_portal: "This portal is making a very high number of requests", api_org: "Your organisation is making a very high number of requests",
};
/** How many people a portal and its organisation hold, for limits that grow with the tenant. Read rarely: this is a size, not a permission. */
const peopleIn = (portalId: string, orgId: string) => portalCached(`size:${portalId}`, "people", 60_000, async () => {
  const [r] = await platformSql`select (select count(*)::int from portal_members where portal_id = ${portalId}) as portal, (select count(*)::int from members where org_id = ${orgId} and left_at is null) as org`;
  return { portal: r.portal as number, org: r.org as number };
});
/** Counts the request against each limit in turn. The first that is full answers 429 with a reason and a retry time; nothing is reserved, stored or changed by a refused request. */
async function gate(requestId: string, checks: [Tier, string, number?, number?][]): Promise<Response | null> {
  for (const [tier, key, cost, people] of checks) {
    const v = await consume(tier, key, cost ?? 1, people ?? 0);
    if (!v.allowed) return tooMany(requestId, v, `${LIMIT_TEXT[tier] ?? "Too many requests"}. This is a temporary limit, not a lack of upload capacity. Wait about ${Math.max(1, v.retryAfterSec)} seconds and try again; nothing you have already submitted is affected.`);
  }
  return null;
}
startRateLimitSweeper();
// Sent with every response. The content policy lets the app load only its own files, talk only to itself, and never be
// framed by another site: so even if some text were ever injected into a page, it could not load or send anything elsewhere.
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  "img-src 'self' data: blob:", "connect-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": CSP,
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-origin",
  ...(config.cookieSecure ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
};
const SECURITY_HEADERS = { ...BASE_HEADERS, "cache-control": "no-store" };

const withUrl = <T extends { documentId?: string }>(r: T): T => (r.documentId ? { ...r, originalDocumentUrl: `/api/documents/${r.documentId}/original` } : r);
/** A job as the browser sees it. It carries no notices judging the job (owner, 10 Nov 2026: "who are you to tell a company ... what is excessive"). */
const jobView = (j: Job) => withUrl(j);
const recordView = (kind: "candidate" | "job", r: any) => (kind === "job" ? jobView(r) : withUrl(withWorthNotingOnly(r)));

function documentView(d: any) {
  return { id: d.id, kind: d.kind, fileName: d.original_name, status: d.status, stage: d.stage, scanResult: d.scan_result,
    errorCode: d.error_code, errorMessage: d.error_message, recordId: d.record_id, batchId: d.batch_id ?? null, createdAt: iso(d.created_at), updatedAt: iso(d.updated_at) };
}

/** Stores one upload: the original privately, the document row and its audit entry, and the processing job. Used for a live upload and for a
 * held one replayed after an outage (marked held in the audit entry, with the time it was received). */
type UploadIn = { orgId: string; userId: string; kind: "cv" | "jd"; fileName: string; bytes: Uint8Array; type: NonNullable<ReturnType<typeof sniff>>; size: number; sha256: string; requestId: string; portalId: string; userEmail?: string; batchId?: string | null; held?: { id: string; heldAt: string } };
async function storeUpload(u: UploadIn): Promise<Response> {
  const existing = (await stage("upload.existing", async () => sql`select * from documents where org_id = ${u.orgId} and kind = ${u.kind} and sha256 = ${u.sha256}`))[0];
  if (existing && existing.status !== "exception") return json({ ...documentView(existing), duplicate: true }, 200); // idempotent: same file, same result: no slot is used

  // A single upload is a batch of one: its slot is reserved (atomically, against the portal's shared allowance) BEFORE the file is accepted. It is released when
  // that one-document batch closes, which happens as soon as the document reaches an end state.
  const implicit = !u.batchId;
  const bid: string = u.batchId ?? (await stage("upload.reserve", () => createBatch({ userId: u.userId, email: u.userEmail ?? "", isAdmin: false, portalId: u.portalId, orgId: u.orgId }, { kind: u.kind, files: 1, bytes: u.size, checkedQuota: true }))).id;
  const abandon = async (code: string, message: string) => { if (implicit) { await noteRefusal(u.orgId, bid, { fileName: u.fileName, code, message, reference: u.requestId }); await finishBatch(bid); } };
  try {
    // A file that was rejected earlier (for example before a parser fix) is tried again instead of being stuck behind its old failure.
    if (existing?.status === "exception") {
      await sql`update documents set status = 'processing', stage = 'received', error_code = null, error_message = null, dismissed_at = null, batch_id = ${bid}, updated_at = now() where id = ${existing.id} and org_id = ${u.orgId}`;
      await audit(sql, u.orgId, u.userId, "document.retried", "document", existing.id, { actorEmail: u.userEmail }, u.requestId);
      await enqueue(u.orgId, "process-document", { documentId: existing.id });
      const again = (await sql`select * from documents where id = ${existing.id} and org_id = ${u.orgId}`)[0];
      return json({ ...documentView(again), retried: true }, 202);
    }
    const id = u.held?.id ?? newId(); // a held upload keeps the id its waiting card already shows
    const storagePath = `${u.orgId}/${id}`; // random name inside the PRIVATE bucket; never a public URL
    await stage("upload.storage_put", () => putObject(storagePath, u.bytes, contentTypeOf(u.type)));
    const inserted = (await stage("upload.insert", async () => sql`
      with ins as (
        insert into documents (id, org_id, kind, original_name, mime, size, sha256, storage_path, status, stage, created_by, batch_id, uploaded_by_email)
        values (${id}, ${u.orgId}, ${u.kind}, ${u.fileName}, ${u.type}, ${u.size}, ${u.sha256}, ${storagePath}, 'processing', 'received', ${u.userId}, ${bid}, ${u.userEmail ?? ""})
        on conflict (portal_id, kind, sha256) do nothing returning *),
      aud as (
        insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail, correlation_id)
        select ${newId()}, ${u.orgId}, ${u.userId}, 'document.uploaded', 'document', ins.id, ${sql.json({ kind: u.kind, size: u.size, sha256: u.sha256, batchId: bid, actorEmail: u.userEmail ?? "", ...(u.held ? { held: true, heldAt: u.held.heldAt } : {}) })}, ${u.requestId} from ins)
      select * from ins`))[0];
    if (!inserted) { // lost a race with an identical simultaneous upload
      const again = (await sql`select * from documents where org_id = ${u.orgId} and kind = ${u.kind} and sha256 = ${u.sha256}`)[0];
      void deleteObjects([storagePath]).catch(() => {});   // the file we just stored is the loser's copy; nothing refers to it
      if (implicit) { await noteDuplicate(u.orgId, bid, u.fileName); await finishBatch(bid); }
      return json({ ...documentView(again), duplicate: true }, 200);
    }
    await stage("upload.enqueue", () => enqueue(u.orgId, "process-document", { documentId: id }));
    return json(documentView(inserted), 202);
  } catch (e) { await abandon("UPLOAD_FAILED", "The upload could not be stored."); throw e; }
}

// Uploads held during an outage (src/heldUploads.ts): shown as waiting, replayed through storeUpload when the main database is back.
const held = HeldUploads.fromEnv(config.dataDir);
const heldView = (h: HeldMeta) => ({ id: h.id, kind: h.kind, fileName: h.fileName, status: "processing", stage: "held", scanResult: null, errorCode: null, errorMessage: null, recordId: null, createdAt: h.heldAt, updatedAt: h.heldAt, held: true });
const originals = OriginalsCopy.fromEnv(config.dataDir);
const journal = AuditJournal.fromEnv(config.dataDir);
/** Moves journaled audit entries into the audit log with their original time; the entry id is the row id, so a repeat adds nothing. */
async function replayJournal() {
  if (dbMode.readOnly || !journal.enabled) return;
  for (const e of journal.all()) {
    if (dbMode.readOnly) break;
    try {
      await sql`insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail, correlation_id, created_at)
                values (${e.id}, ${e.orgId}, ${e.actorId}, ${e.action}, ${e.entityType}, ${e.entityId}, ${sql.json(e.detail as any)}, ${e.correlationId}, ${e.createdAt})
                on conflict (id) do nothing`;
      journal.done(e.id);
    } catch (err) { console.error(JSON.stringify({ level: "warn", event: "journal.replay_failed", reason: String((err as Error)?.message ?? err).slice(0, 200), note: "kept; tried again later" })); }
  }
}
let replaying = false;
async function replayHeld() {
  if (replaying || dbMode.readOnly || !held.enabled) return;
  replaying = true;
  try {
    for (const h of held.all()) {
      if (dbMode.readOnly) break;
      try {
        const org = (await sql`select id from orgs where id = ${h.orgId}`)[0];
        if (!org) { held.release(h.id); console.error(JSON.stringify({ level: "warn", event: "held.dropped", reason: "organisation no longer exists" })); continue; }
        const portalId = h.portalId ?? (await sql`select id from portals where org_id = ${h.orgId} order by created_at limit 1`)[0]?.id;
        if (!portalId) { held.release(h.id); continue; }
        const holder = (await sql`select email from members where user_id = ${h.userId}`)[0]?.email ?? "";
        const res = await forPortal(h.orgId, portalId, () => storeUpload({ orgId: h.orgId, portalId, userEmail: holder, userId: h.userId, kind: h.kind, fileName: h.fileName, bytes: held.bytes(h.id), type: h.type as UploadIn["type"], size: h.size, sha256: h.sha256, requestId: h.requestId, held: { id: h.id, heldAt: h.heldAt } }));
        if (res.status < 500) { held.release(h.id); console.log(JSON.stringify({ level: "info", event: "held.replayed", status: res.status })); }
      } catch (e) { console.error(JSON.stringify({ level: "warn", event: "held.replay_failed", reason: String((e as Error)?.message ?? e).slice(0, 200), note: "kept; tried again later" })); }
    }
  } finally { replaying = false; }
}

async function handleApi(req: Request, url: URL, requestId: string, socketIp: string): Promise<Response> {
  const ip = visitorAddress(req.headers, socketIp);
  const path = url.pathname;
  const method = req.method;

  // CSRF defence: browsers always send Origin on cross-site writes. It must be one of ours.
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && !config.allowedOrigins.includes(origin) && origin !== url.origin) return fail(403, "ORIGIN", "Request origin not allowed.", requestId);
    if (req.headers.get("sec-fetch-site") === "cross-site") return fail(403, "ORIGIN", "Request origin not allowed.", requestId);   // a browser says so itself, even when it sends no Origin
  }
  // A cookie only CLAIMS a session. An address whose claimed sessions keep failing the check is refused before any more are checked, because checking one
  // can mean a call to the sign-in service: a made-up cookie used to buy the signed-in address allowance and one outbound call per request (code review,
  // 16 Nov 2026, A-M10). Failed checks are counted where the session is checked, below.
  const claimsSession = carriesSession(req);
  if (claimsSession) { const wait = await blockedFor("session_failed_ip", ip); if (wait) return tooMany(requestId, { allowed: false, retryAfterSec: wait, remaining: 0 }); }
  const ipVerdict = await consume(claimsSession ? "ip_signed_in" : "ip", ip);
  if (!ipVerdict.allowed) return tooMany(requestId, ipVerdict);

  // Liveness (the process is up) and readiness (it should be sent requests) are different: a draining or out-of-step server is alive but not ready.
  if (path === "/api/ready") return draining || !schema.inSync || dbMode.readOnly ? json({ ready: false, reason: draining ? "draining" : dbMode.readOnly ? "read-only" : "schema" }, 503) : json({ ready: true, ...(req.headers.has("cf-connecting-ip") || req.headers.has("cf-ray") ? {} : { commit: process.env.ROLEMATCH_COMMIT ?? "" }), environment: process.env.ROLEMATCH_ENVIRONMENT ?? "" });
  // An old browser tab must not talk to a newer server as if nothing changed: a client states the contract it was built for, and is told to reload when it is too old.
  const clientContract = Number(req.headers.get("x-client-contract") ?? NaN);
  if (Number.isFinite(clientContract) && clientContract < MIN_CLIENT_CONTRACT) return fail(426, "CLIENT-OUTDATED", "RoleMatch has been updated. Reload this page to continue; nothing you saved is lost.", requestId);
  // Non-secret safety status for harnesses (browser tests) that must not run against a server able to mail real people: only the sending mode, never a credential or an address.
  if (path === "/api/health/mail") { const m = mailStatus(); return json({ sending: m.sending, transport: m.transport }); }
  // The monitor's summary (src/opsHealth.ts). A wrong token is a guess at a secret (5 per 15 minutes per address), and anyone refused is told the same thing: not found.
  // The limiter is given half a second at most: when the database is down this is exactly the answer that must still arrive.
  const operator = async () => {
    const given = req.headers.get("authorization");
    const refused = given ? await Promise.race([blockedFor("ops_token_ip", ip).catch(() => 0), new Promise<number>((r) => setTimeout(() => r(0), 500))]) : 0;
    if (!refused && validOpsToken(given)) return true;
    if (given && !refused) void recordFailure("ops_token_ip", ip).catch(() => {});
    return false;
  };
  const readiness = () => ({ draining, schemaInSync: schema.inSync, readOnly: dbMode.readOnly });
  if (path === "/api/ops/health" && method === "GET") return (await operator()) ? json(await opsHealth(readiness())) : fail(404, "RES-001", "Not found.", requestId);
  // The same figures for Prometheus (src/metrics.ts, docs/ops/TRENDS_AND_LOAD.md), by the same token, read from the same cached measurement.
  if (path === "/api/ops/metrics" && method === "GET") return (await operator()) ? new Response(await metricsText(readiness()), { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" } }) : fail(404, "RES-001", "Not found.", requestId);
  if (path === "/api/health") return json({ ok: true }); // reveals nothing; while saving is paused, every response (this one too) carries x-rolematch-mode
  // The platform's own figures (every company's queue, mail and rate limits), so the platform operator's alone, by the same token as /api/ops/health: a
  // company's administrator is not the operator (code review, 16 Nov 2026, A-M3: anyone who signed up could read them, and wipe the timings with a link).
  // Not even confirmed to exist to anyone else. The timings are started from zero only by a POST.
  if (path === "/api/health/details") {
    if (!(await operator())) return fail(404, "RES-001", "Not found.", requestId);
    return json({ timing: timingStats(method === "POST" && url.searchParams.get("reset") === "1"), rateLimits: rateMetrics(), errorRecording: recordingFailures, capacityCounter: driftReport, outbox: await outboxStats(), ok: true, ai: { reading: config.ai.reading && aiConfigured() ? "the AI alone" : "the parser alone", matching: config.ai.matching && aiConfigured() ? "the AI alone" : "off: matches have no score" }, queue: await queueStats(), schema: schema.inSync ? "in sync" : "OUT OF SYNC", mail: { ...mailStatus(), ...(await mailMetrics()) }, signup: config.signupRequireCode ? "email code required" : "TEST MODE: no code" });
  }

  const signupGuard = async (run: () => Promise<Response>) => {
    try { return await run(); }
    catch (e) { if (e instanceof SignupError) return fail(e.status, e.code, e.message, requestId, e.status === 429 ? { "retry-after": String(e.retryAfterSec ?? 60) } : {}); throw e; }
  };
  // A sign-in is always written to the audit log; while saving is paused that cannot happen, so new sign-ins wait. People already signed in carry on.
  if (dbMode.readOnly && method === "POST" && /^\/api\/auth\/(login|signup|verify|resend)$/.test(path))
    return fail(503, "SVC-READONLY-SIGNIN", "Signing in is paused because the main database cannot be reached. If you are already signed in, you can keep working. Try again shortly.", requestId, { "retry-after": "30" });
  if (path === "/api/auth/login" && method === "POST") return signupGuard(async () => {
    const body = (await req.json().catch(() => ({}))) as any;
    const email = String(body.email ?? ""), password = String(body.password ?? "");
    const g = await loginGuess(ip, email);
    if (g.wait) return fail(429, "RATE-001", `Too many failed sign-in attempts. Try again in ${waitText(g.wait)}.`, requestId, { "retry-after": String(g.wait) });
    const result = await login(email, password, ip).catch(async (e) => { await g.right(); throw e; });   // unconfirmed, or the service failed: not a wrong password
    if (!result) return fail(401, "AUTH-001", "Email or password is incorrect.", requestId);
    await g.right();
    return withCookies(json({ user: result.session, session: result.window }), result.cookies);
  });
  // Self-service sign-up: details first, then a 6-digit code sent by e-mail. An address that already has an account is told so (409; owner, 8 Nov 2026).
  if (path === "/api/auth/signup" && method === "POST") return signupGuard(async () => {
    const result = await startSignup((await req.json().catch(() => ({}))) as any, ip);
    if (result) return withCookies(json({ status: "signed_in", user: result.session, session: result.window }), result.cookies); // test mode only
    return json({ status: "code_sent" }, 202);
  });
  if (path === "/api/auth/verify" && method === "POST") return signupGuard(async () => {
    const body = (await req.json().catch(() => ({}))) as any;
    const result = await finishSignup(body.email, body.code, ip);
    if (!result) return fail(401, "AUTH-004", "That code is incorrect or has expired.", requestId);
    return withCookies(json({ user: result.session, session: result.window }), result.cookies);
  });
  // What an invitation link is for (before sign-up): the same answer for an unknown, used, revoked or expired link, so a link cannot be probed.
  if (path === "/api/auth/invitation" && method === "POST") return signupGuard(async () => {
    const wait = await blockedFor("invite_lookup_ip", ip);
    if (wait) return fail(429, "RATE-001", `Too many invalid invitation links. Try again in ${waitText(wait)}.`, requestId, { "retry-after": String(wait) });
    const inv = await lookupInvitation(String(((await req.json().catch(() => ({}))) as any).token ?? ""));
    if (!inv) await recordFailure("invite_lookup_ip", ip);
    return inv ? json({ portalName: inv.portalName, orgName: inv.orgName, email: inv.email, inviterEmail: inv.inviterEmail, role: inv.role, expiresAt: inv.expiresAt }) : fail(404, "RES-001", "This invitation is not valid. Ask for a new one.", requestId);
  });
  if (path === "/api/auth/resend" && method === "POST") return signupGuard(async () => {
    await resendSignup(((await req.json().catch(() => ({}))) as any).email, ip);
    return json({ status: "code_sent" }, 202);
  });
  // A forgotten password: the same answer whether or not the address has an account.
  if (path === "/api/auth/forgot" && method === "POST") return signupGuard(async () => {
    await startPasswordReset(((await req.json().catch(() => ({}))) as any).email, ip);
    return json({ status: "code_sent" }, 202);
  });
  if (path === "/api/auth/reset" && method === "POST") return signupGuard(async () => {
    const body = (await req.json().catch(() => ({}))) as any;
    if (!(await finishPasswordReset(body.email, body.code, body.password, ip))) return fail(401, "AUTH-004", "That code is incorrect or has expired.", requestId);
    return json({ status: "password_changed" });
  });
  if (path === "/api/auth/logout" && method === "POST") return withCookies(json({ ok: true }), await logout(req));
  // Which ways of signing in this environment offers, so the page never shows a button that cannot work.
  if (path === "/api/auth/methods" && method === "GET") return json({ passkey: config.passkeysEnabled });
  if (config.passkeysEnabled && path === "/api/auth/passkey/options" && method === "POST") {
    const v = await consume("passkey_options_ip", ip); if (!v.allowed) return tooMany(requestId, v);
    const r = await passkeySignInOptions();
    return r.ok ? json(requireVerification(r.value)) : fail(503, "AUTH-PASSKEY-UNAVAILABLE", "Passkey sign-in is not available just now. Use your password.", requestId);
  }
  if (config.passkeysEnabled && path === "/api/auth/passkey/verify" && method === "POST") {
    const wait = await blockedFor("passkey_fail_ip", ip);
    if (wait) return fail(429, "RATE-001", `Too many passkey attempts failed from here. Try again in ${waitText(wait)}, or use your password.`, requestId, { "retry-after": String(wait) });
    const refused = async (status = 401, code = "AUTH-PASSKEY", message = "That passkey could not be verified. Try again, or use your password.") => { await recordFailure("passkey_fail_ip", ip).catch(() => {}); return fail(status, code, message, requestId); };
    const body = (await req.json().catch(() => ({}))) as any;
    let verified: boolean; try { verified = assertionUserVerified(body.credential); } catch { return refused(); }
    if (!verified) return refused(401, "AUTH-PASSKEY-VERIFICATION", "This passkey did not confirm it was you (a fingerprint, face or device PIN is needed). Use a device that can, or use your password.");
    const r = await passkeySignInVerify(String(body.challengeId ?? ""), body.credential);
    if (!r.ok) return refused();
    const done = await passkeyLogin(r.value, ip);
    if (!done) return fail(403, "AUTH-NO-ORGANISATION", "This account is not part of an organisation here. Ask your administrator for an invitation.", requestId);
    return withCookies(json({ user: done.session, session: done.window }), done.cookies);
  }

  const found = await sessionFrom(req);
  if (!found) { if (claimsSession) await recordFailure("session_failed_ip", ip); return fail(401, "AUTH-002", "Please sign in.", requestId); }
  // A session that has run its full length (8 hours from signing in): the website asks the person to log in again where they are, keeping their work
  if (found.ended) return withCookies(fail(401, "AUTH-005", `Your session ended ${found.hours} hours after you signed in. Log in again to carry on; nothing you saved is lost.`, requestId), found.setCookies);
  const session = found.session;
  const userVerdict = await consume("user", session.userId);
  if (!userVerdict.allowed) return tooMany(requestId, userVerdict);
  const who = { userId: session.userId, email: session.email };
  // Routes about portals themselves need no chosen portal: the list of the person's portals, creating one, and redeeming an invitation.
  if (path === "/api/auth/me") return withCookies(json({ user: session, session: found.window, portals: await portalsOf(session.userId, session.orgId) }), found.setCookies);
  if (path === "/api/portals" && method === "GET") return withCookies(json(await portalsOf(session.userId, session.orgId)), found.setCookies);
  // A person's own passkeys. Adding or removing one needs a recent sign-in; a lapsed one is answered with AUTH-RECENT and the page asks for the password (reauthenticate).
  if (config.passkeysEnabled && path.startsWith("/api/auth/passkeys")) {
    const token = accountToken(req, found.setCookies);
    if (!token) return fail(401, "AUTH-002", "Please sign in.", requestId);
    const answer = (res: Response) => withCookies(res, found.setCookies);
    const unavailable = () => answer(fail(503, "AUTH-PASSKEY-UNAVAILABLE", "Passkeys are not available just now. Try again shortly.", requestId));
    const needsRecent = () => answer(fail(403, "AUTH-RECENT", "For your security, confirm your password first.", requestId));
    const recent = recentEnough(signedInAt(token));
    if (path === "/api/auth/passkeys" && method === "GET") {
      const r = await passkeyList(token);
      return r.ok ? answer(json({ passkeys: r.value.map((p) => ({ id: p.id, label: p.friendly_name ?? "Passkey", createdAt: p.created_at, lastUsedAt: p.last_used_at ?? null })), recent })) : unavailable();
    }
    if (path === "/api/auth/passkeys/options" && method === "POST") {
      if (!recent) return needsRecent();
      const r = await passkeyEnrolOptions(token);
      if (r.ok) return answer(json(requireVerification(r.value)));
      return r.code === "too_many_passkeys" ? answer(fail(409, "AUTH-PASSKEY-LIMIT", "You have reached the maximum number of passkeys. Remove one first.", requestId)) : unavailable();
    }
    if (path === "/api/auth/passkeys/verify" && method === "POST") {
      if (!recent) return needsRecent();
      const body = (await req.json().catch(() => ({}))) as any;
      let verified: boolean; try { verified = attestationUserVerified(body.credential); } catch { return answer(fail(400, "VAL-001", "The passkey response is incomplete.", requestId)); }
      if (!verified) return answer(fail(400, "AUTH-PASSKEY-VERIFICATION", "This passkey did not confirm it was you (a fingerprint, face or device PIN is needed), so it was not added.", requestId));
      const r = await passkeyEnrolVerify(token, String(body.challengeId ?? ""), body.credential);
      if (!r.ok) return answer(r.code === "webauthn_credential_exists" ? fail(409, "AUTH-PASSKEY-EXISTS", "This passkey is already on your account.", requestId) : fail(400, "AUTH-PASSKEY", "That passkey could not be added. Try again.", requestId));
      await audit(sql, session.orgId, session.userId, "passkey.added", "user", session.userId, { passkey: r.value.id });
      return answer(json({ id: r.value.id, label: r.value.friendly_name ?? "Passkey", createdAt: r.value.created_at }, 201));
    }
    const one = path.match(/^\/api\/auth\/passkeys\/([0-9a-f-]{36})$/);
    if (one && method === "DELETE") {
      if (!recent) return needsRecent();
      const r = await passkeyDelete(token, one[1]);
      if (!r.ok) return answer(fail(r.status === 404 ? 404 : 400, "AUTH-PASSKEY", "That passkey could not be removed.", requestId));
      await audit(sql, session.orgId, session.userId, "passkey.removed", "user", session.userId, { passkey: one[1] });
      return answer(json({ ok: true }));
    }
    if (one && method === "PATCH") {
      const label = String(((await req.json().catch(() => ({}))) as any).label ?? "").trim().slice(0, 60);
      if (!label) return answer(fail(400, "VAL-001", "Give the passkey a name.", requestId));
      const r = await passkeyRename(token, one[1], label);
      return r.ok ? answer(json({ ok: true })) : answer(fail(400, "AUTH-PASSKEY", "That passkey could not be renamed.", requestId));
    }
    return answer(fail(404, "RES-001", "Not found.", requestId));
  }
  if (path === "/api/auth/reauthenticate" && method === "POST") {
    const g = await loginGuess(ip, session.email);
    if (g.wait) return fail(429, "RATE-001", `Too many failed sign-in attempts. Try again in ${waitText(g.wait)}.`, requestId, { "retry-after": String(g.wait) });
    const done = await reauthenticate(req, session, String(((await req.json().catch(() => ({}))) as any).password ?? ""), ip).catch(async (e) => { await g.right(); throw e; });
    if (!done) return fail(401, "AUTH-001", "That password is not correct.", requestId);
    await g.right();
    return withCookies(json({ session: done.window }), done.cookies);
  }
  const dm = path.match(/^\/api\/members\/([\w-]+)\/portal-creation$/);
  if (dm && method === "PUT") {
    if (!(await isAdminNow(session.userId, session.orgId))) return withCookies(fail(403, "PERM-001", "Only an organisation administrator can delegate portal creation.", requestId), found.setCookies);
    if (!isUuid(dm[1])) return withCookies(fail(404, "RES-001", "Member not found.", requestId), found.setCookies);
    const r = await setPortalCreation(session.orgId, who, dm[1], ((await req.json().catch(() => ({}))) as any).allowed === true);
    if (r.status === 404) return withCookies(fail(404, "RES-001", "Member not found.", requestId), found.setCookies);
    if (r.status === 409) return withCookies(fail(409, "CONF-001", "Administrators can always create portals; there is nothing to delegate.", requestId), found.setCookies);
    return withCookies(json({ canCreatePortals: r.canCreatePortals }), found.setCookies);
  }
  if (path === "/api/portals" && method === "POST") {
    // An organisation administrator, or a member an administrator explicitly delegated it to (read fresh, so a withdrawal is immediate); own organisation only.
    if (!(await mayCreatePortals(session.userId, session.orgId))) return withCookies(fail(403, "PERM-001", "Only an organisation administrator, or someone they have given this permission, can create a portal.", requestId), found.setCookies);
    try { return withCookies(json(await createPortal(session.orgId, who, ((await req.json().catch(() => ({}))) as any).name), 201), found.setCookies); }
    catch (e) { if (e instanceof PortalError) return withCookies(fail(e.status, e.code, e.message, requestId), found.setCookies); throw e; }
  }
  // The organisation and its people (src/team.ts): need no chosen portal. Leaving the organisation also signs this browser out.
  const orgRoute = async (run: () => Promise<unknown>, after?: (r: Response) => Promise<Response>) => {
    try { const r = json(await run()); return after ? await after(r) : withCookies(r, found.setCookies); }   // after leaving, only the cleared cookies (never a refreshed session)
    catch (e) { if (e instanceof PortalError) return withCookies(fail(e.status, e.code, e.message, requestId), found.setCookies); throw e; }
  };
  const body = async () => ((await req.json().catch(() => ({}))) as any) ?? {};
  if (path === "/api/org/people" && method === "GET") return orgRoute(() => organisationPeople(session.orgId, who));
  if (path === "/api/org/leave" && method === "POST") return orgRoute(() => leaveOrganisation(session.orgId, who, session.userId), async (r) => withCookies(r, await logout(req)));
  let om: RegExpMatchArray | null;
  if ((om = path.match(/^\/api\/org\/members\/([\w-]+)$/)) && method === "DELETE") { const id = om[1]; return orgRoute(() => leaveOrganisation(session.orgId, who, id)); }
  if ((om = path.match(/^\/api\/org\/portals\/([\w-]+)\/admins$/)) && method === "POST") { const pid = om[1]; return orgRoute(async () => appointPortalAdmin(session.orgId, who, pid, String((await body()).userId ?? ""))); }
  if (path === "/api/invitations/accept" && method === "POST") {
    const wait = await blockedFor("invite_accept_user", session.userId);
    if (wait) return withCookies(fail(429, "RATE-001", `Too many invalid invitation links. Try again in ${waitText(wait)}.`, requestId, { "retry-after": String(wait) }), found.setCookies);
    try { return withCookies(json(await acceptInvitation(session, String(((await req.json().catch(() => ({}))) as any).token ?? ""))), found.setCookies); }
    catch (e) {
      if (e instanceof PortalError) { if (e.status === 404) await recordFailure("invite_accept_user", session.userId); return withCookies(fail(e.status, e.code, e.message, requestId), found.setCookies); }
      throw e;
    }
  }
  // Everything else happens inside ONE portal the person is a member of. The browser may ask for a portal (x-portal-id); it is checked against portal_members
  // here on every request, and the database enforces it again (forPortal). A portal the person may not use looks exactly like one that does not exist.
  const portal = await resolvePortal(session.userId, session.orgId, req.headers.get("x-portal-id"));
  if (portal === "denied") return withCookies(fail(404, "RES-001", "Portal not found.", requestId), found.setCookies);
  if (!portal) return withCookies(fail(403, "PORTAL-001", "You are not a member of any portal yet. Ask an administrator to invite you to one.", requestId), found.setCookies);
  const people = await peopleIn(portal.id, session.orgId);
  { const limited = await gate(requestId, [["api_portal", portal.id, 1, people.portal], ["api_org", session.orgId, 1, people.org]]); if (limited) return withCookies(limited, found.setCookies); }
  const scoped: Session = { ...session, portalId: portal.id, portalRole: portal.role, portalName: portal.name };
  // Matching has its own bounded concurrency, separate from document reading and from upload slots: a flood of matches cannot starve anything else.
  const isMatch = req.method === "POST" && (path === "/api/matches" || path === "/api/matches/bulk");
  const slot = isMatch ? acquireSlot("match:" + portal.id, config.matchConcurrency) : null;
  if (isMatch && !slot) return withCookies(fail(429, "RATE-001", "This portal is already running as many matches as allowed at once. Try again in a few seconds; this does not affect upload capacity.", requestId, { "retry-after": String(2 + Math.floor(Math.random() * 3)) }), found.setCookies);
  let res: Response;
  try { res = await forPortal(session.orgId, portal.id, () => handleAuthed(req, url, requestId, scoped)); }
  catch (e: any) {   // anything unexpected also goes in the platform's own register, so it is counted and seen, not only logged
    if (!(e instanceof BatchError) && !(e instanceof LimitError) && !(e instanceof StoreBusy) && !isReadOnlyRefusal(e)) void forPortal(session.orgId, portal.id, () => recordOccurrence({ orgId: session.orgId, correlationId: requestId, component: "api", stage: path.replace(/[0-9a-f-]{36}/g, ":id").slice(0, 80), code: "CORE-500", userId: session.userId, detail: { message: String(e?.message ?? e).slice(0, 200) } } as any)).catch(() => {});
    throw e;
  } finally { slot?.(); }
  if (req.method !== "GET" && req.method !== "HEAD") forgetPortal(portal.id);   // this person's change shows at once; other servers catch up within the cache time   // the database shows this portal's rows only
  return withCookies(res, found.setCookies);
}

async function handleAuthed(req: Request, url: URL, requestId: string, s: Session): Promise<Response> {
  const path = url.pathname, method = req.method;
  let m: RegExpMatchArray | null;
  const hr = s.portalRole === HIRING_MANAGER;
  if (hr && !mayEnter(method, path)) return fail(403, "PERM-READ-ONLY", "A hiring manager sees shortlisted candidates and changes nothing in this portal. Ask a portal administrator if you need more.", requestId);
  notePresence(s.orgId, s.portalId!, s.userId);

  const listOptions = () => ({ limit: Number(url.searchParams.get("limit") ?? 25), cursor: url.searchParams.get("cursor") ?? undefined, q: url.searchParams.get("q") ?? undefined, status: url.searchParams.get("status") ?? undefined, review: url.searchParams.get("review") ?? undefined });
  // A board page is the heaviest answer the service gives, and a crowd arriving at once all ask for the same one. It is shared within the portal, and kept as text because writing out a hundred records is most of its cost.
  // A search or a chosen filter is asked for on purpose, so it is always read. A hiring manager's page has its own entry: the status is in the name. Everyone else in the portal sees the same records.
  const boardList = async <T extends { id: string }>(kind: "candidate" | "job", view: (r: T) => unknown, o: ListOptions, shared: boolean) => {
    const read = async () => { const p = await searchRecords<T>(kind, s.orgId, o); return replyText({ ...p, items: p.items.map(view) }); };
    const text = shared && !o.q && !o.review ? await portalCached(s.portalId!, `board:${kind}:${o.status ?? ""}:${o.statusIn ? "hm" : ""}:${o.limit}:${o.cursor ?? ""}`, config.boardCacheMs, read, { fresh: url.searchParams.has("fresh"), sizeOf: (t) => t.length }) : await read();
    return new Response(text, { headers: { "content-type": "application/json" } });
  };
  if (path === "/api/candidates" && method === "GET") { const o = listOptions(); return boardList<Candidate>("candidate", (r) => withUrl(withWorthNotingOnly(r)), hr ? { ...o, status: undefined, statusIn: VISIBLE_STATUSES } : o, hr || !o.status); }
  if (path === "/api/jobs" && method === "GET") { const o = listOptions(); return boardList<Job>("job", jobView, o, !o.status); }
  if (path === "/api/usage" && method === "GET") return json({ usage: await usageOf(s.orgId), limits: await limitsOf(s.orgId) });

  // ---------- settings: any member can read them; only an administrator can change them ----------
  if (path === "/api/settings" && method === "GET") {
    const [stored, org] = await Promise.all([getSettings(s.orgId, true), sql`select name from orgs where id = ${s.orgId}`]);
    return json({ ...stored, orgName: org[0]?.name ?? "", defaults: defaultSettings(), ceilings: PLATFORM_CEILINGS, formats: publicFormats(), editPolicy: { configurable: CONFIGURABLE, always: ALWAYS_EDITABLE, never: NEVER_EDITABLE }, canEdit: s.role === "admin" });
  }
  if (path === "/api/settings" && method === "PUT") {
    if (s.role !== "admin") return fail(403, "PERM-001", "Only an administrator can change settings.", requestId);
    const settingsVerdict = await consume("settings", s.userId);
    if (!settingsVerdict.allowed) return tooMany(requestId, settingsVerdict);
    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object" || typeof body.version !== "number") return fail(400, "VAL-001", "Send the settings version you are changing, and the sections to change.", requestId);
    const { version, ...patch } = body;
    try {
      const saved = await saveSettings(s.orgId, s.userId, patch, version, requestId);
      return json({ ...saved, defaults: defaultSettings(), ceilings: PLATFORM_CEILINGS, canEdit: true });
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.status, e.code, e.message, requestId);
      throw e;
    }
  }
  if (path === "/api/settings/history" && method === "GET") return json(await settingsHistory(s.orgId));
  if ((path === "/api/history/uploads" || path === "/api/history/invitations" || path === "/api/history/activity") && method === "GET") {
    const scope = url.searchParams.get("scope") === "org" ? "org" : "portal";
    try { return json(path.endsWith("uploads") ? await uploadHistory(s, scope) : path.endsWith("activity") ? await activityHistory(s, scope) : await invitationHistory(s, scope)); }
    catch (e) { if (e instanceof HistoryError) return fail(e.status, e.code, e.message, requestId); throw e; }
  }

  if ((m = path.match(/^\/api\/(candidates|jobs)\/([\w-]+)\/review$/)) && method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    try {
      const rec = await markReviewed<any>(m[1] === "candidates" ? "candidate" : "job", s.orgId, s.userId, m[2], typeof body?.version === "number" ? body.version : undefined, requestId);
      return rec ? json(withUrl(rec)) : fail(404, "RES-001", "Record not found.", requestId);
    } catch (e) {
      if (e instanceof ConflictError) return fail(409, "CONF-001", e.message, requestId);
      throw e;
    }
  }
  if ((m = path.match(/^\/api\/candidates\/([\w-]+)\/employment$/)) && method === "GET") {
    const current = await getRecord<Candidate>("candidate", s.orgId, m[1]);
    if (!current || (hr && !visibleToHiringManager(current.status))) return fail(404, "RES-001", "Record not found.", requestId);
    return json(await employmentEvidence(s.orgId, m[1]));
  }
  if ((m = path.match(/^\/api\/candidates\/([\w-]+)\/employment-review$/)) && method === "POST") {
    try {
      const candidate = await reviewEmployment(s.orgId, s.userId, m[1], await req.json().catch(() => null), requestId);
      // Every job this person was last matched against is run again; the earlier results stay in the history.
      const jobs = await sql`select distinct job_id from matches where org_id = ${s.orgId} and candidate_id = ${candidate.id} limit ${config.matching.recalculateAtMost}`;
      for (const { job_id } of jobs) { const job = await getRecord<Job>("job", s.orgId, job_id); if (job) await runMatch(s, candidate, job, requestId); }
      return json({ candidate: withUrl(candidate), recalculated: jobs.length });
    } catch (e) {
      if (e instanceof ReviewError) return fail(e.status, e.code, e.message, requestId);
      if (e instanceof ConflictError) return fail(409, "CONF-001", e.message, requestId);
      throw e;
    }
  }
  if ((m = path.match(/^\/api\/candidates\/([\w-]+)\/read-again$/)) && method === "POST") {
    const current = await getRecord<Candidate>("candidate", s.orgId, m[1]);
    if (!current?.documentId) return fail(404, "RES-001", "Record not found.", requestId);
    if (!config.ai.reading || !aiConfigured()) return fail(409, "CONF-001", "The AI reader is not switched on here, so the document cannot be read again.", requestId);
    // Marked as being read again until the new reading is saved or the reading fails (aiRead.ts): the board locks the card and pauses uploads meanwhile
    // (owner, 9 Nov 2026). On the record, so a refresh or a colleague's board shows it too.
    return json(await queueReadAgain(s, "candidate", current.id, { parserVersion: (current.extraction as any)?.parserVersion ?? null }, requestId), 202);
  }
  // A job read again from its original by Claude (aiJobFields.ts), in the AI worker: marked as being read again until the new reading is saved; a recruiter's own
  // corrections stand. The board shows the job locked meanwhile, as it does a CV.
  if ((m = path.match(/^\/api\/jobs\/([\w-]+)\/read-again$/)) && method === "POST") {
    if (!isUuid(m[1])) return fail(404, "RES-001", "Job not found.", requestId);
    const current = await getRecord<Job>("job", s.orgId, m[1]);
    if (!current?.documentId) return fail(404, "RES-001", "Job not found.", requestId);
    if (!aiConfigured()) return fail(409, "CONF-001", "Job descriptions are read by the AI, which is not set up here, so the job cannot be read again.", requestId);
    return json(await queueReadAgain(s, "job", current.id, { readerVersion: (current as any).aiReading?.version ?? null }, requestId), 202);
  }
  // A status for one candidate and one job (applications.ts). A hiring manager reads only the stages they may see, and changes nothing (hiringManager.ts).
  // The Overview page's figures (orgOverview.ts; docs/architecture/PLAN_OVERVIEW.md): this organisation's own, from a 20-second cache per portal (any change
  // made in the portal clears it at once, below; work finished in the background shows within 20 s), so pages checking every 15 s cost one read per portal. A hiring manager sees only shortlisted people, so the whole
  // organisation's figures are not theirs to see; the page offers them the demo.
  if (path === "/api/overview" && method === "GET") {
    if (hr) return fail(403, "PERM-001", "The Overview's figures are for recruiters and administrators.", requestId);
    const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
    return json(await portalCached(s.portalId!, `overview:${days}`, 20_000, () => orgOverview(s, days)));
  }
  // The records behind one Needs attention item (attention.ts), so the Matching Board shows exactly what the Overview counted. Same sight as the Overview.
  if ((m = path.match(/^\/api\/attention\/([\w-]+)$/)) && method === "GET") {
    if (hr) return fail(403, "PERM-001", "The Overview's figures are for recruiters and administrators.", requestId);
    if (!isAttentionRule(m[1])) return fail(404, "RES-001", "There is no such list.", requestId);
    return json(await attentionRecords(s, m[1]));
  }
  if (path === "/api/applications" && method === "GET") return json(await listApplications(hr ? VISIBLE_STATUSES : undefined));
  if (path === "/api/applications" && method === "PUT") {
    const body = (await req.json().catch(() => null)) as any;
    if (!body || !isUuid(String(body.candidateId)) || !isUuid(String(body.jobId)) || !(body.status === null || typeof body.status === "string")) return fail(400, "VAL-001", "Give a candidateId, a jobId and a status (or null to clear it).", requestId);
    try {
      const application = await setApplication(s.orgId, s.userId, body.candidateId, body.jobId, body.status, requestId);
      const candidate = await getRecord<Candidate>("candidate", s.orgId, body.candidateId);
      return json({ application, candidate: candidate ? withUrl(candidate) : null });
    } catch (e) { if (e instanceof ApplicationError) return fail(e.status, e.code, e.message, requestId); throw e; }
  }
  if ((m = path.match(/^\/api\/jobs\/([\w-]+)\/shortlist$/)) && method === "GET") {
    if (!isUuid(m[1])) return fail(404, "RES-001", "Job not found.", requestId);
    const found = await shortlistOf(s.orgId, m[1], hr ? VISIBLE_STATUSES : undefined);
    if (!found) return fail(404, "RES-001", "Job not found.", requestId);
    return json(found.rows.map((r) => ({ candidate: withUrl(r.candidate), job: jobView(found.job), status: r.status, matchResult: r.matchResult })));
  }
  if ((m = path.match(/^\/api\/(candidates|jobs)\/([\w-]+)$/))) {
    const kind = m[1] === "candidates" ? "candidate" : "job";
    if (method === "GET") {
      const rec = await getRecord<any>(kind, s.orgId, m[2]);
      return rec && (!hr || kind === "job" || visibleToHiringManager(rec.status)) ? json(recordView(kind, rec)) : fail(404, "RES-001", "Record not found.", requestId);
    }
    if (method === "DELETE") {
      const ok = await deleteRecord(kind, s.orgId, s.userId, m[2], requestId);
      return ok ? json({ ok: true }) : fail(404, "RES-001", "Record not found.", requestId);
    }
    if (method === "PUT") {
      const body = (await req.json().catch(() => null)) as any;
      if (!body || typeof body !== "object") return fail(400, "VAL-001", "Invalid request body.", requestId);
      if (kind === "candidate" && typeof body.status === "string") {
        // The status must be one this organisation uses. A candidate may keep a status that was switched off later, but cannot be moved to one.
        const [{ settings }, current] = await Promise.all([getSettings(s.orgId), getRecord<any>("candidate", s.orgId, m[2])]);
        const allowed = new Set(settings.statuses.filter((x) => x.active).map((x) => x.key));
        if (current && body.status !== current.status && !allowed.has(body.status)) return fail(400, "VAL-002", `"${body.status}" is not a status your organisation uses.`, requestId);
      }
      try {
        const rec = await updateRecord<any>(kind, s.orgId, s.userId, m[2], body, typeof body.version === "number" ? body.version : undefined, requestId, body.changeKind);
        return rec ? json(recordView(kind, rec)) : fail(404, "RES-001", "Record not found.", requestId);
      } catch (e) {
        if (e instanceof ConflictError) return fail(409, "CONF-001", e.message, requestId);
        if (e instanceof PolicyError) return fail(403, "PERM-002", e.message, requestId, {}, { fields: e.fields });
        if (e instanceof ReasonRequiredError) return fail(400, "VAL-005", e.message, requestId, {}, { fields: e.fields, changeKinds: CHANGE_KINDS });
        throw e;
      }
    }
  }

  // ---------- portal members and invitations: any member can see who is in the portal; only a portal or organisation administrator manages them ----------
  const canManage = s.portalRole === "admin" || s.role === "admin";
  const portalRoute = async (run: () => Promise<unknown>, status = 200) => { try { return json(await run(), status); } catch (e) { if (e instanceof PortalError) return fail(e.status, e.code, e.message, requestId); throw e; } };
  if (path === "/api/portal/members" && method === "GET") { const r = await listMembers(s.orgId, s.portalId!); return json({ portal: { id: s.portalId, name: s.portalName, role: s.portalRole }, members: r.members, invitations: r.invitations, canManage, mail: canManage ? (({ state, reason, appUrlLocalOnly }) => ({ state, reason, appUrlLocalOnly }))(mailStatus()) : undefined }); }
  if (path === "/api/portal/invitations" && method === "POST") { const limited = await gate(requestId, [["invite_user", s.userId], ["invite_portal", s.portalId!], ["invite_org", s.orgId]]); if (limited) return limited; if (!canManage) return fail(403, "PERM-001", "Only a portal administrator can invite people.", requestId); const b = (await req.json().catch(() => ({}))) as any; return portalRoute(() => invite(s.orgId, s.portalId!, { userId: s.userId, email: s.email }, b.emails, b.role), 201); }
  if ((m = path.match(/^\/api\/portal\/invitations\/([\w-]+)\/revoke$/)) && method === "POST") { const limited = await gate(requestId, [["member_user", s.userId]]); if (limited) return limited; if (!canManage) return fail(403, "PERM-001", "Only a portal administrator can revoke an invitation.", requestId); return portalRoute(() => revokeInvitation(s.orgId, s.portalId!, { userId: s.userId, email: s.email }, m![1])); }
  if ((m = path.match(/^\/api\/portal\/invitations\/([\w-]+)\/resend$/)) && method === "POST") { const limited = await gate(requestId, [["invite_user", s.userId], ["member_user", s.userId]]); if (limited) return limited; if (!canManage) return fail(403, "PERM-001", "Only a portal administrator can resend an invitation.", requestId); return portalRoute(() => resendInvitation(s.orgId, s.portalId!, { userId: s.userId, email: s.email }, m![1])); }
  if ((m = path.match(/^\/api\/portal\/members\/([\w-]+)$/)) && method === "PATCH") { const id = m[1]; if (!canManage) return fail(403, "PERM-001", "Only a portal administrator can change roles.", requestId); return portalRoute(async () => setMemberRole(s.orgId, s.portalId!, { userId: s.userId, email: s.email }, id, ((await req.json().catch(() => ({}))) as any)?.role)); }
  if (path === "/api/portal/leave" && method === "POST") return portalRoute(() => leavePortal(s));
  if ((m = path.match(/^\/api\/portal\/members\/([\w-]+)$/)) && method === "DELETE") { const limited = await gate(requestId, [["member_user", s.userId]]); if (limited) return limited; if (!canManage) return fail(403, "PERM-001", "Only a portal administrator can remove a member.", requestId); return portalRoute(() => removeMember(s.orgId, s.portalId!, { userId: s.userId, email: s.email }, m![1])); }

  const actor = { userId: s.userId, email: s.email, isAdmin: s.role === "admin" || s.portalRole === "admin", portalId: s.portalId! };
  // Upload batches (src/batches.ts): the browser declares a batch, sends its files one by one into it, and reads real counts back.
  const statusGate = async () => gate(requestId, [["status_user", s.userId], ["status_portal", s.portalId!, 1, (await peopleIn(s.portalId!, s.orgId)).portal]]);
  if (path === "/api/batches" && method === "POST") {
    const limited = await gate(requestId, [["reserve_user", s.userId], ["reserve_portal", s.portalId!], ["reserve_org", s.orgId]]); if (limited) return limited;
    const body = (await req.json().catch(() => ({}))) as any;
    const b = await createBatch({ ...actor, orgId: s.orgId }, body);
    return json(await batchView(s.orgId, b.id, s.userId), 201);
  }
  if (path === "/api/batches" && method === "GET") { const limited = await statusGate(); if (limited) return limited; }
  if (path === "/api/batches" && method === "GET") return json(hr ? [] : await openBatches(s.orgId, s.userId));
  if (path === "/api/capacity" && method === "GET") { const limited = await statusGate(); if (limited) return limited; }
  if (path === "/api/capacity" && method === "GET") return json(await portalCached(s.portalId!, "capacity", 5000, () => capacityOf(s.portalId!)));
  if (/^\/api\/batches\/[\w-]+\/report$/.test(path) && method === "GET") { const limited = await gate(requestId, [["export_user", s.userId]]); if (limited) return limited; }
  if ((m = path.match(/^\/api\/batches\/([\w-]+)\/report$/)) && method === "GET") return json(await batchReport(s.orgId, m[1]));
  if ((m = path.match(/^\/api\/batches\/([\w-]+)\/ack$/)) && method === "POST") return json(await acknowledgeBatch(s.orgId, s.userId, m[1]));
  // Failure records (src/occurrences.ts): administrators only. They hold ids and sanitised messages, never document text.
  if (path === "/api/errors" && method === "GET") { if (s.role !== "admin") return fail(403, "PERM-001", "Only an administrator can see failure records.", requestId); return json(await defectOverview(s.orgId)); }
  if ((m = path.match(/^\/api\/errors\/([\w-]+)\/status$/)) && method === "POST") {
    if (s.role !== "admin") return fail(403, "PERM-001", "Only an administrator can change a defect's status.", requestId);
    const b = (await req.json().catch(() => ({}))) as any;
    try { return (await setDefectStatus(s.orgId, s.userId, m[1], b.status, b.registerRef)) ? json({ ok: true }) : fail(404, "RES-001", "No such defect group.", requestId); }
    catch (e: any) { if (e?.code === "VAL-001") return fail(400, "VAL-001", e.message, requestId); throw e; }
  }
  if (/^\/api\/batches\/[\w-]+\/(close|cancel|retry|ack)$/.test(path) && method === "POST") { const limited = await gate(requestId, [["batch_action_user", s.userId]]); if (limited) return limited; }
  if (/^\/api\/batches\/[\w-]+$/.test(path) && method === "GET") { const limited = await statusGate(); if (limited) return limited; }
  if ((m = path.match(/^\/api\/batches\/([\w-]+)\/close$/)) && method === "POST") return json(await closeBatch(s.orgId, actor, m[1], requestId));
  if ((m = path.match(/^\/api\/batches\/([\w-]+)$/)) && method === "GET") return json(await batchView(s.orgId, m[1], s.userId));
  if ((m = path.match(/^\/api\/batches\/([\w-]+)\/cancel$/)) && method === "POST") return json(await cancelBatch(s.orgId, actor, m[1], requestId));
  if ((m = path.match(/^\/api\/batches\/([\w-]+)\/retry$/)) && method === "POST") return json(await retryBatch(s.orgId, actor, m[1], requestId));

  if (path === "/api/documents" && method === "POST") {
    const batchId = url.searchParams.get("batch");
    if (batchId) await openBatchFor(s.orgId, s.userId, batchId, null);   // refuses a batch that is not this portal's, is not the person's own, is cancelled, closed or full
    const tReq = performance.now();
    const res = await uploadOne(batchId);
    record("upload.request_total", performance.now() - tReq);
    if (batchId) {
      // What happened to this file is recorded on the batch, so a refresh shows it. A busy signal (429/503) is not a refusal: the browser tries again.
      const body = (await res.clone().json().catch(() => null)) as any;
      if (res.ok && body?.duplicate) await noteDuplicate(s.orgId, batchId, url.searchParams.get("name") ?? "");
      else if (!res.ok && res.status !== 429 && res.status !== 503) await noteRefusal(s.orgId, batchId, { fileName: url.searchParams.get("name") ?? "(unnamed file)", code: body?.error?.code ?? "UNKNOWN", message: body?.error?.message ?? "The file was refused.", reference: body?.error?.requestId });
      if (!res.ok && res.status !== 429 && res.status !== 503) void recordOccurrence({ orgId: s.orgId, correlationId: body?.error?.requestId ?? requestId, component: "upload", stage: "admission", code: body?.error?.code ?? "UNKNOWN", batchId, userId: s.userId, message: body?.error?.message });
    }
    return res;
  }
  async function uploadOne(batchId: string | null): Promise<Response> {
    const declared = Number(req.headers.get("content-length") ?? 0);
    // A file sent INTO an admitted batch has already been counted and reserved, so it has a high ceiling (a 500-file batch is legitimate, not 500 abusive requests); a
    // single upload also asks for a reservation, so it keeps the tighter per-person limit. Both are counted in bytes as well as in requests.
    const limited = await gate(requestId, [...(batchId ? [["upload_file_user", s.userId], ["upload_file_portal", s.portalId!]] : [["upload", s.userId], ["upload_portal", s.portalId!, 1, (await peopleIn(s.portalId!, s.orgId)).portal]]) as [Tier, string, number?, number?][], ["upload_bytes_user", s.userId, Math.max(1, declared)], ["upload_bytes_portal", s.portalId!, Math.max(1, declared)]]);
    if (limited) return limited;
    const lim = await stage("upload.limits", () => limitsOf(s.orgId));
    const maxBytes = Math.min(config.maxFileBytes, lim.maxFileMb * 1024 * 1024); // the organisation's limit, never above the platform's
    if (declared > maxBytes + 1_000_000) return fail(413, "FILE-002", `File is larger than ${lim.maxFileMb} MB.`, requestId);
    const form = await stage("upload.form_parse", async () => req.formData().catch(() => null));
    const file = form?.get("file");
    const kind = form?.get("kind");
    if (!(file instanceof File) || (kind !== "cv" && kind !== "jd")) return fail(400, "VAL-001", "Send a file and kind ('cv' or 'jd').", requestId);
    if (file.size === 0) return fail(400, "FILE-001", "The file is empty.", requestId);
    if (file.size > maxBytes) return fail(413, "FILE-002", `File is larger than ${lim.maxFileMb} MB.`, requestId);
    const room = await stage("upload.quota", () => takeUpload(s.orgId, file.size));
    try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type) return fail(415, "FILE-001", unsupportedHint(bytes) ?? `Only genuine ${describeFormats()} files are accepted.`, requestId);
    const disagrees = nameDisagrees(file.name, type);
    if (disagrees) return fail(415, "FILE-001", disagrees, requestId);

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (dbMode.readOnly) {
      // Saving is paused: an upload already known is answered from the copy; a new one is held, encrypted, until the main database is back.
      const known = (await sql`select * from documents where org_id = ${s.orgId} and kind = ${kind} and sha256 = ${sha256}`)[0];
      if (known && known.status !== "exception") return json({ ...documentView(known), duplicate: true }, 200);
      const r = held.hold({ id: newId(), orgId: s.orgId, portalId: s.portalId, userId: s.userId, kind, fileName: file.name.slice(0, 200), type, size: file.size, sha256, requestId }, bytes);
      if ("full" in r) return fail(503, "SVC-READONLY", `Saving is paused because the main database cannot be reached, and this upload cannot be held (${r.full}). Try again shortly.`, requestId, { "retry-after": "30" });
      return json({ ...heldView(r.meta), duplicate: r.duplicate }, r.duplicate ? 200 : 202);
    }
    return await storeUpload({ orgId: s.orgId, portalId: s.portalId!, userEmail: s.email, userId: s.userId, kind, fileName: file.name.slice(0, 200), bytes, type, size: file.size, sha256, requestId, batchId });
    } finally { await room.release(); }   // the document's own record now counts, or there is none to count
  }

  if (path === "/api/documents" && method === "GET") {
    if (hr) return json([]);
    const rows = await portalCached(s.portalId!, "documents", 5000, () => sql`select id, kind, original_name, status, stage, scan_result, error_code, error_message, record_id, batch_id, created_at, updated_at from documents where org_id = ${s.orgId} and status != 'published' and dismissed_at is null order by created_at desc limit 100`);
    const inDb = new Set(rows.map((r: any) => r.id)), waiting = held.list(s.orgId).filter((h) => !inDb.has(h.id)).reverse().map(heldView);
    return json([...waiting, ...rows.map(documentView)]);
  }
  if ((m = path.match(/^\/api\/documents\/([\w-]+)\/dismiss$/)) && method === "POST") {
    if (!isUuid(m[1])) return fail(404, "RES-001", "Document not found.", requestId);
    // Only a finished failure can be cleared; something still processing, or already published, is left alone.
    const rows = await sql`update documents set dismissed_at = now(), updated_at = now() where id = ${m[1]} and org_id = ${s.orgId} and status = 'exception' and dismissed_at is null returning id`;
    if (rows.length) await audit(sql, s.orgId, s.userId, "document.dismissed", "document", m[1], {}, requestId);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/documents\/([\w-]+)$/)) && method === "GET") {
    if (!isUuid(m[1])) return fail(404, "RES-001", "Document not found.", requestId);
    const d = (await sql`select * from documents where org_id = ${s.orgId} and id = ${m[1]}`)[0];
    if (d) return json(documentView(d));
    const h = held.get(s.orgId, m[1]);
    return h ? json(heldView(h)) : fail(404, "RES-001", "Document not found.", requestId);
  }
  if ((m = path.match(/^\/api\/documents\/([\w-]+)\/original$/)) && method === "GET") {
    if (!isUuid(m[1])) return fail(404, "RES-001", "Document not found.", requestId);
    const d = (await sql`select * from documents where org_id = ${s.orgId} and id = ${m[1]}`)[0];
    if (!d) return fail(404, "RES-001", "Document not found.", requestId);
    if (hr && d.kind !== "jd" && !(await sql`select 1 from candidates where org_id = ${s.orgId} and id = ${d.record_id} and data ->> 'status' = any(${sql.array([...VISIBLE_STATUSES])}::text[])`).length) return fail(404, "RES-001", "Document not found.", requestId);
    // Every view is recorded before the file is sent. During an outage the record goes to the journal first (written to disk), and the file
    // comes from RoleMatch's own copy; if either is unavailable the view is refused rather than made unrecorded.
    let bytes: Uint8Array | null = null;
    if (dbMode.readOnly) {
      bytes = originals.read(d.storage_path);
      if (!bytes || !journal.enabled) return fail(503, "SVC-READONLY", "The original cannot be shown while the main database is unreachable. Try again shortly.", requestId, { "retry-after": "30" });
      try { journal.append({ orgId: s.orgId, actorId: s.userId, action: "document.original_viewed", entityType: "document", entityId: d.id, detail: { journaled: true, servedFrom: "copy" }, correlationId: requestId }); }
      catch { return fail(503, "SVC-READONLY", "The original cannot be shown right now because the view could not be recorded. Try again shortly.", requestId); }
    } else {
      await audit(sql, s.orgId, s.userId, "document.original_viewed", "document", d.id, {}, requestId);
      try { bytes = await getObject(d.storage_path); }
      catch (e) { bytes = originals.read(d.storage_path); if (!bytes) throw e; } // file storage down but the database up: RoleMatch's own copy
    }
    // Opened in the browser, never downloaded (owner, 2026-10-30): formats a browser cannot show become a read-only page (viewer.ts). The exact original
    // bytes stay retrievable with ?as=original (audit, export, the pipeline's own check); no button in the panels uses it.
    if (url.searchParams.get("as") === "original") {
      const safeName = d.original_name.replace(/[^\w.\- ]/g, "_");
      return new Response(bytes as unknown as BodyInit, { headers: { "content-type": contentTypeOf(d.mime), "content-disposition": `inline; filename="${safeName}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
    }
    return viewResponse(bytes!, d.mime, d.original_name);
  }

  if ((path === "/api/matches" || path === "/api/matches/bulk") && method === "POST") {
    const matchVerdict = await consume("match", s.userId);
    if (!matchVerdict.allowed) return tooMany(requestId, matchVerdict, "Too many matches in a short time. Please wait a moment. This does not affect upload capacity.");
    const size = await peopleIn(s.portalId!, s.orgId), limited = await gate(requestId, [["match_portal", s.portalId!, 1, size.portal], ["match_org", s.orgId, 1, size.org]]); if (limited) return limited;
  }
  // The latest saved result for one candidate and one job. Reading only: nothing is calculated, so this is not the Match action.
  if (path === "/api/matches" && method === "GET") {
    const candidateId = url.searchParams.get("candidateId") ?? "", jobId = url.searchParams.get("jobId") ?? "";
    if (!isUuid(candidateId) || !isUuid(jobId)) return fail(400, "VAL-001", "A valid candidateId and jobId are required.", requestId);
    const candidate = await getRecord<Candidate>("candidate", s.orgId, candidateId);
    if (!candidate || (hr && !visibleToHiringManager(candidate.status))) return fail(404, "RES-001", "Candidate not found.", requestId);
    const row = (await recordedMatch(s.orgId, candidateId, jobId)) ?? (await sql`select id, result, created_at from matches where org_id = ${s.orgId} and candidate_id = ${candidateId} and job_id = ${jobId} order by created_at desc limit 1`)[0];
    return row ? json({ ...row.result, id: row.id, savedAt: iso(row.created_at) }) : fail(404, "RES-001", "No match has been run for this candidate and job yet.", requestId);
  }
  // The month's AI use as the bill will read it (owner, 8 Nov 2026: "being able to bill per portal is the key"). A portal administrator sees their portal's
  // lines; an organisation administrator sees every portal of the organisation. The database's own row rules hold each to its organisation's billing account.
  if (path === "/api/ai-usage" && method === "GET") {
    if (s.portalRole !== "admin" && s.role !== "admin") return fail(403, "PERM-001", "An administrator can see the AI use.", requestId);
    // The bill's month is Johannesburg's, from its first moment to the next month's (code review, 16 Nov 2026, C-M5).
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get("month") ?? "") ? url.searchParams.get("month")! : sastMonth(), bounds = sastMonthBounds(month);
    const read = () => sql`select u.portal_id, p.name as portal, u.purpose, count(*) filter (where u.outcome = 'answered')::int as answered, count(*)::int as calls,
        coalesce(sum(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens), 0)::bigint as input_tokens, coalesce(sum(u.output_tokens), 0)::bigint as output_tokens, coalesce(sum(u.cost_micro_usd), 0)::bigint as micro_usd
      from ai_usage u left join portals p on p.id = u.portal_id where u.at >= ${bounds.from} and u.at < ${bounds.to} group by 1, 2, 3 order by 2, 3`;
    const rows = (s.role === "admin" ? await forOrg(s.orgId, read) : await read()) as any[];
    const [account] = await sql`select id, opened_at from billing_accounts where org_id = ${s.orgId}`;
    const usd = (m: unknown) => Number(m) / 1e6;   // exact, as metered: a CV's reading costs a fraction of a cent
    return json({ month, account: account ? { id: account.id, openedAt: iso(account.opened_at) } : null, scope: s.role === "admin" ? "organisation" : "portal",
      lines: rows.map((r) => ({ portalId: r.portal_id, portal: r.portal, purpose: r.purpose, calls: r.calls, answered: r.answered, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costUsd: usd(r.micro_usd) })),
      totalUsd: usd(rows.reduce((a, r) => a + Number(r.micro_usd), 0)) });
  }
  // Where the AI's checks stand for saved matches, in the signed-in person's own portal: a list asks for all its rows at once, rather than one request each.
  if (path === "/api/matches/ai-status" && method === "POST") {
    const ids = ((await req.json().catch(() => ({}))) as any).ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((x) => typeof x === "string" && isUuid(x))) return fail(400, "VAL-001", "Give between 1 and 100 match ids.", requestId);
    return json(await aiStatusOf(ids));
  }
  // Cancel, from the matching window: the given matches stop waiting, and what the AI has not been handed yet is withdrawn (nothing is spent on it).
  if (path === "/api/matches/cancel" && method === "POST") {
    const ids = ((await req.json().catch(() => ({}))) as any).ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((x) => typeof x === "string" && isUuid(x))) return fail(400, "VAL-001", "Give between 1 and 100 match ids.", requestId);
    const r = await cancelAiMatches(ids);
    if (r.cancelled) await audit(sql, s.orgId, s.userId, "match.ai_cancelled", "portal", s.portalId!, { matches: ids.length, notSent: r.notSent, started: r.started }, requestId);
    return json(r);
  }
  if (path === "/api/matches" && method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    const candidate = await getRecord<Candidate>("candidate", s.orgId, String(body.candidateId));
    const job = await getRecord<Job>("job", s.orgId, String(body.jobId));
    if (!candidate || !job) return fail(404, "RES-001", "Candidate or job not found.", requestId);
    const room = await takeMatch(s.orgId, 1);
    try { return json(await runMatch(s, candidate, job, requestId)); } finally { await room.release(); }
  }
  if (path === "/api/matches/bulk" && method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    const LIMIT = 50; // bounded: no unbounded candidate x job cross products
    if (body.candidateId) {
      const candidate = await getRecord<Candidate>("candidate", s.orgId, String(body.candidateId));
      if (!candidate) return fail(404, "RES-001", "Candidate not found.", requestId);
      const jobs = (await searchRecords<Job>("job", s.orgId, { limit: LIMIT })).items;
      const room = await takeMatch(s.orgId, jobs.length);
      const rows = await Promise.all(jobs.map(async (job) => ({ candidate: withUrl(candidate), job: withUrl(job), matchResult: await runMatch(s, candidate, job, requestId) }))).finally(() => room.release());
      const ranked = rows.sort((a, b) => compareRank({ ...a.matchResult, id: a.job.id }, { ...b.matchResult, id: b.job.id }));   // a fixed, total order: ties are never broken by chance
      return json(ranked);
    }
    if (body.jobId) {
      const job = await getRecord<Job>("job", s.orgId, String(body.jobId));
      if (!job) return fail(404, "RES-001", "Job not found.", requestId);
      const candidates = (await searchRecords<Candidate>("candidate", s.orgId, { limit: LIMIT })).items;
      const room = await takeMatch(s.orgId, candidates.length);
      const rows = await Promise.all(candidates.map(async (candidate) => ({ candidate: withUrl(candidate), job: withUrl(job), matchResult: await runMatch(s, candidate, job, requestId) }))).finally(() => room.release());
      const ranked = rows.sort((a, b) => compareRank({ ...a.matchResult, id: a.candidate.id }, { ...b.matchResult, id: b.candidate.id }));
      return json(ranked);
    }
    return fail(400, "VAL-001", "Provide candidateId or jobId.", requestId);
  }

  // A record's history: a candidate's, a job's or a document's, never a person's. People's own events (signing in, with the address it came from, joining
  // and leaving) stay on the audit log for security, and are not for colleagues to read (code review, 16 Nov 2026, A-M4: any recruiter could list a
  // colleague's sign-ins and addresses by their user id). An address is never part of the answer.
  if (path === "/api/audit" && method === "GET") {
    const id = url.searchParams.get("entityId");
    if (!id || !isUuid(id)) return fail(400, "VAL-001", "A valid entityId is required.", requestId);
    const rows = await sql`select a.id, a.action, a.entity_type, a.entity_id, a.detail - 'ip' as detail, a.created_at, mem.name as actor
      from audit_events a left join members mem on mem.user_id = a.actor_id
      where a.org_id = ${s.orgId} and a.entity_id = ${id} and a.entity_type in ('candidate', 'job', 'document') order by a.created_at desc limit 200`;
    return json(rows.map((r: any) => ({ ...r, created_at: iso(r.created_at) })));
  }

  return fail(404, "RES-001", "Not found.", requestId);
}

/** A CV or a job read again by the AI: one reading at a time per record (code review, 16 Nov 2026, A-M6). The record is locked while it is checked, so a
 *  double-click or two colleagues queue one reading, paid for once; the "being read again" mark, the queued reading and the audit line are saved together, so
 *  a failure between them can never leave a record marked with no reading behind it. */
async function queueReadAgain(s: Session, kind: "candidate" | "job", id: string, detail: Record<string, unknown>, requestId: string) {
  const table = kind === "candidate" ? "candidates" : "jobs", type = kind === "candidate" ? "model-read-again" : "model-job-read-again", key = `${kind}Id`;
  const queued = await sql.begin(async (q) => {
    await q`select 1 from ${q(table)} where id = ${id} and org_id = ${s.orgId} for update`;
    const [waiting] = await q`select 1 from queue where type = ${type} and payload->>${key} = ${id} and status in ('queued', 'running') limit 1`;
    if (waiting) return false;
    // A job's earlier failure to be read again is cleared with the new request.
    await q`update ${q(table)} set data = jsonb_set(data, '{rereading}', ${q.json({ since: new Date().toISOString() })}) - 'rereadFailed' where id = ${id} and org_id = ${s.orgId}`;
    await enqueueIn(q, s.orgId, type, { [key]: id, orgId: s.orgId, actorId: s.userId, correlationId: requestId }, 2);
    await audit(q, s.orgId, s.userId, `${kind}.read_again_requested`, kind, id, detail, requestId);
    return true;
  });
  if (queued) kick();
  return queued ? { queued: true } : { queued: true, already: true };
}

/** Runs the engine and stores an immutable snapshot so the result can be reproduced and audited. Where the AI checks matches, the rules' result is saved
 *  "pending" and Claude's check is queued (aiMatch.ts); a pair already checked at these versions gets its saved answer at once, at no cost. */
/** The pair's recorded match: its first finished one (scored by the AI), else the one still being scored. Owner, 10 Nov 2026: "once someone is matched,
 *  that should always be the recorded scores and reasons, nothing should ever change". */
async function recordedMatch(orgId: string, candidateId: string, jobId: string, q: typeof sql | TransactionSql = sql) {
  return (await q`select m.id, m.result, m.created_at from matches m where m.org_id = ${orgId} and m.candidate_id = ${candidateId} and m.job_id = ${jobId} and m.result->'ai'->>'state' in ('checked', 'pending')
    order by ${recordedFirst()} limit 1`)[0] as { id: string; result: any; created_at: Date } | undefined;
}
const asRecorded = (kept: NonNullable<Awaited<ReturnType<typeof recordedMatch>>>) => ({ ...kept.result, id: kept.id, savedAt: iso(kept.created_at), recorded: true });
async function runMatch(s: Session, candidate: Candidate, job: Job, requestId: string) {
  // A pair already matched is shown as it was recorded: nothing is run, recorded or charged again, whether asked one to one or in a shortlist.
  const kept = await recordedMatch(s.orgId, candidate.id, job.id);
  if (kept) return asRecorded(kept);
  const text = candidate.documentId ? ((await sql`select source_text from documents where id = ${candidate.documentId} and org_id = ${s.orgId}`)[0]?.source_text ?? "") : "";
  // The rules engine gives only facts here (place, dated years, versions); the score is the AI's alone (aiMatch.ts).
  const { result, ask } = await aiStartOf(candidate, job, assess(candidate, job, text));
  const id = newId(), full = ask ? await aiQueueFull() : false;
  // One match per pair, however many clicks arrive together (a double-click, two tabs, two recruiters): the pair is locked while it is looked up again and
  // saved, so the second request finds the first one's match and returns it, and the AI is asked, and paid, once (code review, 16 Nov 2026, C-M2).
  const first = await sql.begin(async (q) => {
    await q`select pg_advisory_xact_lock(hashtextextended(${`match:${candidate.id}:${job.id}`}, 0))`;
    const already = await recordedMatch(s.orgId, candidate.id, job.id, q);
    if (already) return already;
    await q`insert into matches (id, org_id, candidate_id, job_id, candidate_version, job_version, engine_version, result, created_by)
      values (${id}, ${s.orgId}, ${candidate.id}, ${job.id}, ${result.candidateVersion}, ${result.jobVersion}, ${result.engineVersion}, ${q.json(result as any)}, ${s.userId})`;
    await audit(q, s.orgId, s.userId, "match.run", "candidate", candidate.id, { matchId: id, jobId: job.id, score: result.score, confidence: result.confidence, ai: result.ai?.state }, requestId);
    if (ask) await requestAiMatch(q, s.orgId, id, ask, full);   // saved with the match, or neither is (aiMatch.ts)
    return null;
  });
  if (first) return asRecorded(first);
  if (ask) kick();
  return { ...result, id };
}

// ---------- static frontend (the built app), so one process serves everything ----------
const DIST = fileURLToPath(new URL("../../dist", import.meta.url));
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".wasm": "application/wasm" };
function serveStatic(path: string): Response {
  const clean = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, clean);
  // A path that names a file (it has an extension) or a hidden one (a part starting with a dot), and that is not one of the built files, is not found: answering it with
  // the page made a scanner report "/.env answers 200" although nothing was served (security audit, 6 Nov 2026). The app's own pages have neither.
  const looksLikeAFile = !!extname(clean) || clean.split(/[/\\]/).some((p) => p.startsWith("."));
  if (looksLikeAFile && (!file.startsWith(DIST) || !existsSync(file))) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  if (!file.startsWith(DIST) || !existsSync(file) || !extname(file)) file = join(DIST, "index.html");
  if (!existsSync(file)) return new Response("Frontend not built. Run the build first.", { status: 404 });
  // The page itself (index.html) must always be re-checked, or a browser keeps showing an old version of the app after an update.
  // Files in /assets have a content hash in their name, so they can be cached for a year without ever going stale.
  // Images, fonts and animations outside /assets (the logos, the default avatar, the animations) change rarely: kept a week, and checked again in the
  // background after a day (owner, 11 Nov 2026, PageSpeed: they were fetched again on every visit).
  const hashed = /^\/assets\//.test(path) && file !== join(DIST, "index.html");
  const media = !hashed && file !== join(DIST, "index.html") && /\.(png|jpe?g|webp|svg|ico|gif|woff2?|json|lottie)$/i.test(file);
  const cache = hashed ? "public, max-age=31536000, immutable" : media ? "public, max-age=604800, stale-while-revalidate=86400" : "no-cache";
  return new Response(new Uint8Array(readFileSync(file)), { headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": cache } });
}

/** Shutdown: stop taking new work, let what is running finish for a bounded time, then leave. A job cut short is picked up again by the queue's lease sweeper and
 * its handler is idempotent (a publication is guarded), so a restart never publishes twice. Readiness fails at once so traffic moves away first. */
let draining = false;
export const isDraining = () => draining;
async function shutDown() {
  if (draining) return; draining = true;
  const until = Date.now() + config.shutdownGraceMs;
  await new Promise((r) => setTimeout(r, config.shutdownMinDrainMs));   // let a load balancer see "not ready" before connections are cut
  await stopOutbox();
  await drain(Math.max(0, until - Date.now()));   // the jobs in hand finish, or are handed back for another worker (queue.ts)
  await server.stop?.(); process.exit(0);
}
process.on("SIGTERM", () => void shutDown()); process.on("SIGINT", () => void shutDown());

export const server = await serve({
  port: config.port,
  // Only a document upload may be large; every other request body (sign-in, settings, edits) is tiny, so a huge one is refused before it is read.
  maxBodyBytes: (_method, path) => (path === "/api/documents" ? config.maxFileBytes + 2_000_000 : 1_000_000),
  async fetch(req, ip) {
    const started = performance.now();
    const res = await respond(req, ip);
    noteRequest(new URL(req.url).pathname, res.status, performance.now() - started);
    return res;
  },
});
let inHand = 0;
/** Whether the visitor reached Cloudflare over plain http, as Cloudflare's own headers say. No header (a check from this machine) is not plain http. */
const overPlainHttp = (h: Headers) => (h.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase() === "http" || /"scheme"\s*:\s*"http"/i.test(h.get("cf-visitor") ?? "");
const NEVER_REFUSED = /^\/api\/(?:ready|health|ops\/health|ops\/metrics)/;   // the watchers: a busy server must still say how it is (Trends, 23 Nov 2026)
async function respond(req: Request, ip: string): Promise<Response> {
    const url = new URL(req.url);
    const requestId = newId();
    // HTTPS only (security check, 9 Nov 2026: the site and sign-in answered over plain http, so a password could travel unencrypted as far as Cloudflare).
    // Cloudflare says how the visitor reached it; a page asked for over http is sent to https, and anything else over http is refused before it is read.
    // The server's own checks on this machine come with no such header and are untouched.
    if (config.cookieSecure && overPlainHttp(req.headers)) {
      const to = `https://${req.headers.get("host") ?? new URL(config.appUrl).host}${url.pathname}${url.search}`;
      return req.method === "GET" || req.method === "HEAD" ? new Response(null, { status: 308, headers: { location: to, "strict-transport-security": "max-age=31536000; includeSubDomains" } }) : fail(400, "HTTPS-ONLY", "RoleMatch is served over https only. Use the https address.", requestId);
    }
    // Who is asking: behind the tunnel every visitor arrives over the tunnel's one connection, so `ip` alone would make them all one visitor.
    const visitor = visitorAddress(req.headers, ip);
    try {
      let res: Response;
      if (url.pathname.startsWith("/api/")) {
        // Experiment X6: beyond what can be finished, say so at once. Otherwise everything times out, and the backlog outlives the people who asked (register R113).
        if (inHand >= config.maxInFlight && !NEVER_REFUSED.test(url.pathname)) res = fail(503, "SVC-BUSY", "RoleMatch is very busy right now. Please try again in a few seconds.", requestId, { "retry-after": "5" });
        else { inHand++; try { res = await asVisitor(visitor, () => handleApi(req, url, requestId, ip)); } finally { inHand--; } }
      } else {
        const v = await consume("static", visitor); // the app's own files are cheap, but not free: one visitor cannot hammer them
        res = v.allowed ? serveStatic(url.pathname) : new Response("Too many requests", { status: 429, headers: { "retry-after": String(v.retryAfterSec) } });
      }
      for (const [k, v] of Object.entries(url.pathname.startsWith("/api/") ? SECURITY_HEADERS : BASE_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
      res.headers.set("x-request-id", requestId); res.headers.set("x-rolematch-contract", String(API_CONTRACT));
      if (dbMode.readOnly) { res.headers.set("x-rolematch-mode", "read-only"); if (dbMode.copyAt) res.headers.set("x-rolematch-copy-at", dbMode.copyAt); } // the website shows a notice, with the copy's age
      return res;
    } catch (e: any) {
      if (e instanceof BatchError) return fail(e.status, e.code, e.message, requestId, {}, e.extra);
      if (e instanceof LimitError) return fail(429, e.code, e.message, requestId, { "retry-after": "60" });
      if (e instanceof SignInUnconfirmed) return fail(503, "AUTH-UNCONFIRMED", "RoleMatch cannot confirm your sign-in just now. You are still signed in; try again in a moment.", requestId, { "retry-after": "15" });
      if (e instanceof StoreBusy) { console.error(JSON.stringify({ level: "warn", event: "store.busy", requestId, error: e.message })); return fail(503, "SVC-BUSY", "The file store is very busy just now. Nothing was lost: this file will be sent again shortly.", requestId, { "retry-after": "10" }); }
      if (isReadOnlyRefusal(e)) return fail(503, "SVC-READONLY", "Saving is paused because the main database cannot be reached. You can still view everything; nothing has been lost. Try again shortly.", requestId, { "retry-after": "30" });
      console.error(JSON.stringify({ requestId, path: url.pathname, error: String(e?.message ?? e) })); // no personal data in logs
      return fail(500, "CORE-500", "Something went wrong. Quote the request ID to support.", requestId);
    }
}
watchPrimary();
// held uploads go through as soon as saving resumes, and are also retried every minute (covers a restart with uploads still held)
onReadWrite(() => { void replayJournal(); void replayHeld(); });
setInterval(() => { void replayJournal(); void replayHeld(); }, 60_000).unref();
void replayJournal(); void replayHeld();
console.log(`RoleMatch server listening on http://localhost:${server.port}  (database schema "${config.dbSchema}"; AI: ${config.ai.reading && aiConfigured() ? "Claude reads CVs" : "parser alone"}, ${config.ai.matching && aiConfigured() ? "Claude scores matches" : "matching off, no scores"}; ${config.role === "all" ? "reads documents itself" : "documents are read by separate workers"})`);
