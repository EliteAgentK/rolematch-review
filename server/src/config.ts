import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Read server/.env when it exists, with the file's own parser (util.parseEnv). Variables already set in the environment (tests, hosting) always win.
// An ISOLATED run (a test schema, VITEST, NODE_ENV=test) never takes any MAIL_* setting from the file: a real mailbox login in .env must not be reachable from a test,
// whichever way the test or its server was started. A test that needs mail sets MAIL_* itself, against a simulated host.
const isolatedRun = () => (!!process.env.DB_SCHEMA && process.env.DB_SCHEMA !== "public") || !!process.env.VITEST || process.env.NODE_ENV === "test";
try {
  const parsed = parseEnv(readFileSync(process.env.ROLEMATCH_ENV_FILE ?? fileURLToPath(new URL("../.env", import.meta.url)), "utf8"));
  for (const [k, v] of Object.entries(parsed)) { if (k in process.env || (isolatedRun() && k.startsWith("MAIL_"))) continue; process.env[k] = v; }
} catch { /* no .env file: use the real environment */ }

const num = (name: string, fallback: number) => {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const required = (name: string) => process.env[name] ?? "";

export const config = {
  port: num("PORT", 8787),
  databaseUrl: required("DATABASE_URL"),
  // Tests run in their own schema so they never touch real data.
  dbSchema: process.env.DB_SCHEMA ?? "public",
  dbPoolSize: num("DB_POOL_SIZE", 8),
  boardCacheMs: num("BOARD_CACHE_MS", 5000),   // how long a portal's board page is shared; someone who has seen a change asks with fresh=1 and is never served an older page
  maxInFlight: num("MAX_IN_FLIGHT", num("DB_POOL_SIZE", 8) * 8),   // requests one server will have in hand; beyond this it says busy at once (register R113). A request makes several trips, and each queues behind all the others in hand, so this follows the connections
  // A read-only copy of the database (docs/architecture/RESILIENCE.md, step 3). When the main database is unreachable, reads go here and saving pauses.
  readFallbackUrl: process.env.READ_FALLBACK_DATABASE_URL ?? "",
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY"), // server-side only; never sent to the browser
  // Where the sign-in service answers (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, C1). Supabase serves it under /auth/v1; the sign-in service run
  // on its own (the PC, a paid host) answers at its own address. Every sign-in call, the public keys and the issuer a token must name follow this one value.
  authUrl: (process.env.AUTH_URL || `${required("SUPABASE_URL").replace(/\/$/, "")}/auth/v1`).replace(/\/$/, ""),
  // The header a self-run sign-in service reads the visitor's address from (its GOTRUE_RATE_LIMIT_HEADER), so its limits count each visitor, not this server.
  authForwardHeader: (process.env.AUTH_FORWARD_HEADER ?? "").trim().toLowerCase(),
  // The secret behind invitation links, the hashes of sign-up and reset codes, and the hashes of mail recipients (C2). It defaults to the service key,
  // which it was until 11 Nov 2026, so nothing already sent changes; set on its own, the service key can then change without breaking any of them.
  linkSecret: process.env.LINK_SECRET || required("SUPABASE_SERVICE_ROLE_KEY"),
  // Where the database is, as the console says it (C6). Without it the console works it out from the address.
  databaseLocation: (process.env.DATABASE_LOCATION ?? "").trim(),
  bucket: "originals",
  dataDir: process.env.DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url)),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim()),
  // How many documents are processed at the same time, in total and per organisation.
  // What this process does. "all" (the default, one machine): answers the website and reads documents. "api": answers the website only;
  // documents are read by separate worker processes (npm run worker), so heavy reading never slows anyone's page and each side scales on its own.
  role: ((r) => { if (r !== "all" && r !== "api") throw new Error(`ROLE must be "all" or "api" (a reading worker is started with npm run worker), not "${r}"`); return r; })(process.env.ROLE ?? "all") as "all" | "api",
  workerHealthPort: num("WORKER_HEALTH_PORT", 8790),
  workerConcurrency: num("WORKER_CONCURRENCY", 4),
  // Which queued work this worker takes: all, documents (everything except AI work) or model (only AI work), so a document's parsing and OCR never wait behind Claude, nor Claude behind OCR.
  /** Claude in RoleMatch (owner, 8 Nov 2026: "no more Ollama"): Haiku reads every CV with the parser before it reaches a panel; Sonnet checks every match after the
   *  rules have answered. Each is switched on by its own setting and needs ANTHROPIC_API_KEY; off, or with no key, the parser and the rules work alone as before. */
  /** After a person settles a record's work history, how many of its jobs are matched again at once. */
  matching: { recalculateAtMost: 25 },
  ai: {
    reading: process.env.AI_READING === "on",
    matching: process.env.AI_MATCHING === "on",
    /** How long one question to Claude may take before it counts as failed. Not a cut-off for slow CVs (owner, 9 Nov 2026): a CV waits until the AI has read it,
     *  and only a failed reading, after its retry, publishes the parser's reading, which says so. Measured on real CVs: 27 to 40 s for most. */
    readSeconds: num("AI_READ_SECONDS", 300),
    /** AI work running at once for one organisation on one AI worker. The queue already takes turns between organisations and portals, so this only stops one from holding every slot. */
    perOrgConcurrency: num("AI_PER_ORG_CONCURRENCY", 20),
    /** Bounds that keep a flood from growing without limit: past them a CV keeps the parser's reading and a match has no score, and each says the AI was busy. */
    maxQueued: num("AI_MAX_QUEUED", 5000), maxQueuedPerPortal: num("AI_MAX_QUEUED_PER_PORTAL", 500),
  },
  workerJobs: ((j) => { if (j !== "all" && j !== "documents" && j !== "model") throw new Error(`WORKER_JOBS must be all, documents or model, not "${j}"`); return j; })(process.env.WORKER_JOBS ?? "all"),
  // How long a checked sign-in token is trusted before it is checked again, including against sign-outs made on other servers.
  tokenRecheckMs: num("TOKEN_RECHECK_MS", 30_000),
  perOrgConcurrency: num("PER_ORG_CONCURRENCY", 2),
  // The biggest file we will accept for upload. Anything above processFileBytes is optimised (made smaller) first; if it is still too big it is refused.
  maxFileBytes: num("MAX_FILE_MB", 50) * 1024 * 1024,
  // What one document may cost, whatever its page count. Past the time limit it is reported as not read rather than holding the reader; a Word or OpenDocument file is a zip, and one that unpacks past the size limit is refused unopened.
  reviewAllScans: process.env.REVIEW_ALL_SCANS === "true",
  processMaxSeconds: num("PROCESS_MAX_SECONDS", 1800),
  maxExpandedBytes: num("MAX_EXPANDED_MB", 200) * 1024 * 1024,
  processFileBytes: num("PROCESS_FILE_MB", 15) * 1024 * 1024,
  // Every document is offered to the optimiser. It replaces the stored file only when that is smaller and still reads the same; measured on invented files, those needing nothing cost under a second and 5 to 7 MB files fell by 93 to 95%.
  optimiseAboveBytes: num("OPTIMISE_ABOVE_MB", 0) * 1024 * 1024,
  maxPages: num("MAX_PAGES", 12), // a JOB DESCRIPTION PDF with more pages than this is refused with a clear reason; a CV has no page limit (owner rule, 2026-11-02)
  sessionHours: num("SESSION_HOURS", 8),   // how long every sign-in lasts from signing in: a working day, for everyone (owner, 16 Nov 2026); tests shorten it
  rateUserPerMin: num("RATE_USER_PER_MIN", 600),
  rateIpPerMin: num("RATE_IP_PER_MIN", 1500),
  rateIpSignedInPerMin: num("RATE_IP_SIGNED_IN_PER_MIN", 60_000),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  // Fair-use limits, the same for every organisation (not plans or billing).
  limitDocsPerDay: num("LIMIT_DOCS_PER_DAY", 1000),
  limitStorageMb: num("LIMIT_STORAGE_MB", 2048),
  limitInProgress: num("LIMIT_IN_PROGRESS", 100),
  limitMatchesPerHour: num("LIMIT_MATCHES_PER_HOUR", 3000),
  // One drop of many files (src/batches.ts). A batch is admitted or refused as a whole, before any file is sent.
  maxBatchFiles: num("MAX_BATCH_FILES", 500),
  maxBatchBytes: num("MAX_BATCH_MB", 1024) * 1024 * 1024,
  // A batch whose files stopped arriving (the page closed mid-transfer) frees its owner's upload lock after this long. Files already waiting or being read keep it held.
  batchTransferLeaseSec: num("BATCH_TRANSFER_LEASE_SEC", 300),
  // Document slots a portal can have reserved at once, shared by everyone in it and by every kind of document (migration 020). Not a concurrency limit.
  portalSlots: num("PORTAL_SLOTS", 500),
  // Optional passkey sign-in (docs/security/PASSKEYS.md). Off unless the sign-in service has it switched on for this environment, with this site as its relying party.
  passkeysEnabled: process.env.PASSKEYS_ENABLED === "true",
  // How recently someone must have proved who they are to add or remove a passkey.
  passkeyRecentMinutes: num("PASSKEY_RECENT_MINUTES", 15),
  // The monitor's service token for /api/ops/health (docs/ops/MONITORING.md). Empty or shorter than 32 characters: the endpoint does not exist.
  opsToken: process.env.OPS_TOKEN ?? "",
  // When a measurement counts as degraded or unavailable, and over which window. Configuration, so they can be tuned from real use without a code change.
  opsThresholds: {
    queueDegradedSec: num("OPS_QUEUE_DEGRADED_SEC", 900), queueUnavailableSec: num("OPS_QUEUE_UNAVAILABLE_SEC", 3600), stuckRunningSec: num("OPS_STUCK_RUNNING_SEC", 300),
    windowMinutes: num("OPS_WINDOW_MINUTES", 60), failureMinSample: num("OPS_FAILURE_MIN_SAMPLE", 20), failureDegradedRate: num("OPS_FAILURE_DEGRADED_RATE", 0.2), failureUnavailableRate: num("OPS_FAILURE_UNAVAILABLE_RATE", 0.5), failureDegradedCount: num("OPS_FAILURE_DEGRADED_COUNT", 5),
    requestWindowMinutes: num("OPS_REQUEST_WINDOW_MINUTES", 15), requestMinSample: num("OPS_REQUEST_MIN_SAMPLE", 50), errorDegradedRate: num("OPS_ERROR_DEGRADED_RATE", 0.05), errorUnavailableRate: num("OPS_ERROR_UNAVAILABLE_RATE", 0.25), latencyDegradedMs: num("OPS_LATENCY_DEGRADED_MS", 2000), latencyUnavailableMs: num("OPS_LATENCY_UNAVAILABLE_MS", 10000),
    // The model reads every CV before it reaches a panel (MODEL_AUDIT=required), so a CV waiting on it this long is a service problem, not shadow work.
    modelWaitDegradedSec: num("OPS_MODEL_WAIT_DEGRADED_SEC", 900), modelWaitUnavailableSec: num("OPS_MODEL_WAIT_UNAVAILABLE_SEC", 3600),
    mailDegradedSec: num("OPS_MAIL_DEGRADED_SEC", 900), mailUnavailableSec: num("OPS_MAIL_UNAVAILABLE_SEC", 3600), loopDegradedMs: num("OPS_LOOP_DEGRADED_MS", 500), loopUnavailableMs: num("OPS_LOOP_UNAVAILABLE_MS", 2000), rssDegradedMb: num("OPS_RSS_DEGRADED_MB", 1536), rssUnavailableMb: num("OPS_RSS_UNAVAILABLE_MB", 3072),
  },
  // Matches running at once for one portal on one server (a match is quick and deterministic; this bounds a flood, not normal use).
  matchConcurrency: num("MATCH_CONCURRENCY", 6),
  maxManualRetries: num("MAX_MANUAL_RETRIES", 3),
  appUrl: (process.env.PUBLIC_APP_URL ?? (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",")[0]).trim().replace(/\/$/, ""),   // where invitation links point
  shutdownGraceMs: Number(process.env.SHUTDOWN_GRACE_MS ?? 25_000),
  shutdownMinDrainMs: Number(process.env.SHUTDOWN_MIN_DRAIN_MS ?? 2_000),
  outboxBackoffSec: Number(process.env.OUTBOX_BACKOFF_SEC ?? 15),
  outboxLeaseSec: Number(process.env.OUTBOX_LEASE_SEC ?? 120),
  // Outgoing mail: RoleMatch owns the policy and the queue; the only outside piece is an SMTP submission service (today the existing mail hosting).
  // MAIL_TRANSPORT: "smtp" (real), "preview" (writes files, development only, never reported as sent), or unset = mail unavailable.
  // Secrets (MAIL_SMTP_PASS) belong in the server's environment or the host's secret store: never in settings, source, the browser or logs.
  mail: {
    transport: (["smtp", "preview"].includes(process.env.MAIL_TRANSPORT ?? "") ? process.env.MAIL_TRANSPORT : "none") as "smtp" | "preview" | "none",
    from: process.env.MAIL_FROM ?? "RoleMatch <info@rolematch.co.za>",           // the approved sender identity
    replyTo: process.env.MAIL_REPLY_TO ?? "",
    bounceAddress: process.env.MAIL_BOUNCE_ADDRESS ?? "",                           // envelope sender (where bounces return); empty = the From address
    smtpHost: process.env.MAIL_SMTP_HOST ?? "",
    smtpPort: num("MAIL_SMTP_PORT", 465),
    smtpSecurity: (["implicit", "starttls", "none"].includes(process.env.MAIL_SMTP_SECURITY ?? "") ? process.env.MAIL_SMTP_SECURITY : "implicit") as "implicit" | "starttls" | "none",   // "none" only for a loopback test server
    smtpUser: process.env.MAIL_SMTP_USER ?? "",
    smtpPass: process.env.MAIL_SMTP_PASS ?? "",
    // Separate connection pools: a burst of invitations can never hold the connections a verification code needs. Total connections to the host = authConcurrency + bulkConcurrency.
    authConcurrency: num("MAIL_AUTH_CONCURRENCY", 2),
    bulkConcurrency: num("MAIL_BULK_CONCURRENCY", 1),
    authTimeoutMs: num("MAIL_AUTH_TIMEOUT_MS", 12_000),                              // a person is waiting: after this the outcome is reported as uncertain, never as sent
    // Platform ceiling on messages per rolling hour, shared by every class. Deliberately small until the host's real limit is known in writing.
    maxPerHour: num("MAIL_MAX_PER_HOUR", 60),
    reservedForAuthPerHour: num("MAIL_RESERVED_AUTH_PER_HOUR", 15),                // authentication mail can use this much more than bulk classes can
    // DEFAULT DENY. "off": nothing leaves, even with a transport configured. "allowlist" (the default once a transport is set): real mail goes ONLY to MAIL_ALLOWED_RECIPIENTS, for
    // every kind of message; an empty list sends nothing. "live": any recipient, which must be chosen deliberately (and is refused while links are local-only).
    sendMode: (["off", "allowlist", "live"].includes(process.env.MAIL_SEND_MODE ?? "") ? process.env.MAIL_SEND_MODE : "allowlist") as "off" | "allowlist" | "live",
    allowedRecipients: (process.env.MAIL_ALLOWED_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    suppressionDays: num("MAIL_SUPPRESSION_DAYS", 7),
    attemptLeaseSec: num("MAIL_ATTEMPT_LEASE_SEC", 120),
  },
  // How long a verification code stays valid: 15 minutes. RoleMatch enforces this itself (src/auth.ts finishSignup rejects a code issued longer ago than this, before Supabase is asked), so
  // it holds whatever the Supabase project is set to. Set the project's own OTP expiration (Authentication > Providers > Email) to the same 900 seconds so both agree; the provider can
  // only ever be the same or looser than this, never stricter than what the person is told. The e-mail text states this number.
  otpExpiryMinutes: num("OTP_EXPIRY_MINUTES", 15),
  // Minimum wait before another code can be requested for the same address: a resend is always offered, but a new code is issued only after this long (60 seconds).
  resendCooldownSeconds: num("RESEND_COOLDOWN_SECONDS", 60),
  // Only believe the X-Forwarded-For header when the server really sits behind a proxy you control; otherwise anyone could fake their address.
  trustProxy: process.env.TRUST_PROXY === "true",
  clientIpHeader: (process.env.CLIENT_IP_HEADER ?? "").trim().toLowerCase(),   // a header the proxy always overwrites; see visitor.ts
  // Apply new migrations automatically when the server starts. On by default in development, off in production
  // (production changes must be applied deliberately, before the new code goes live).
  // Pending migrations are applied at start ONLY in an isolated schema (a test's own, DB_SCHEMA other than "public"), or when AUTO_MIGRATE=true is set on purpose.
  // The shared development project and anything live use the explicit step `npm run migrate`: restarting a server must never be an approval of a schema change.
  autoMigrate: process.env.AUTO_MIGRATE ? process.env.AUTO_MIGRATE === "true" : (process.env.DB_SCHEMA ?? "public") !== "public" && process.env.COOKIE_SECURE !== "true",
  // DEVELOPMENT ONLY: create sign-up codes without sending e-mail and print them to the server console.
  // Refused at startup when COOKIE_SECURE=true (production).
  signupDevCode: process.env.SIGNUP_DEV_CODE === "true",
  // TEST MODE: sign up without an emailed code (the account is created confirmed and signed in straight away).
  // Refused at startup when COOKIE_SECURE=true (production). The real code flow stays built and tested.
  signupRequireCode: process.env.SIGNUP_REQUIRE_CODE !== "false",
  // "invite": only someone holding a valid invitation can create an account. "open": anyone can start a new organisation. Anything served over HTTPS is closed unless opened on purpose.
  // Who may start a new organisation. open is the product's intended public registration. invite is for a restricted environment such as staging: only an invitation, or an address on the list.
  signupMode: process.env.SIGNUP_MODE ?? "open",
  signupAllowedEmails: (process.env.SIGNUP_ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  extractionSchemaVersion: "extract-1.0.0",
  // Stamped on every record as meta.parserVersion. Any change to what the reader produces for the same document must bump it (see docs/parser/EXTRACTION_CONTRACT.md).
} as const;

// A production run must never send session cookies without the Secure flag: refuse to start rather than quietly run unprotected.
if (process.env.NODE_ENV === "production" && !config.cookieSecure) throw new Error("NODE_ENV=production requires COOKIE_SECURE=true (serve over HTTPS).");
// Each organisation's queries set the role and organisation on their connection (db.ts forOrg). A transaction-mode pooler hands every statement
// to whichever connection is free, so those settings could land on someone else's statement: only session mode (Supabase port 5432) is safe.
if (config.databaseUrl && new URL(config.databaseUrl).port === "6543") throw new Error("DATABASE_URL uses Supabase's transaction-mode pooler (port 6543). Use the session-mode address (port 5432): organisation separation depends on it.");
if (config.signupMode !== "invite" && config.signupMode !== "open") throw new Error('SIGNUP_MODE must be "invite" or "open".');
if (config.signupDevCode && config.cookieSecure) throw new Error("SIGNUP_DEV_CODE must never be enabled in production (COOKIE_SECURE=true).");
if (!config.signupRequireCode && config.cookieSecure) throw new Error("SIGNUP_REQUIRE_CODE=false must never be used in production (COOKIE_SECURE=true).");

/** Version of the browser/API/worker contract. The browser sends the one it was built for; MIN_CLIENT_CONTRACT is the oldest this server still understands. Raise it only with a breaking change. */
export const API_CONTRACT = 1;
export const MIN_CLIENT_CONTRACT = 1;

/** Where invitation links point. Local-only unless it is a real address: a link to localhost works only on the computer running it. */
export const appUrlIsLocal = () => { try { const h = new URL(config.appUrl).hostname; return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost") || h.endsWith(".test"); } catch { return true; } };

/** Checks made when a SERVER or WORKER starts (not when any script reads the configuration, e.g. a migration run): settings that would make it unsafe to serve people. */
export function assertServingSettings() {
  if (config.cookieSecure) { try { if (new URL(config.appUrl).protocol !== "https:" || appUrlIsLocal()) throw new Error(); } catch { throw new Error("PUBLIC_APP_URL must be the real https address of the application when COOKIE_SECURE=true (links in e-mails are built only from this setting)."); } }
  if (config.mail.transport === "preview" && config.cookieSecure) throw new Error("MAIL_TRANSPORT=preview must never be used in production (it does not send anything).");
  if (config.mail.smtpSecurity === "none" && config.mail.transport === "smtp" && !["localhost", "127.0.0.1"].includes(config.mail.smtpHost)) throw new Error("MAIL_SMTP_SECURITY=none is only allowed for a server on this computer.");
}
