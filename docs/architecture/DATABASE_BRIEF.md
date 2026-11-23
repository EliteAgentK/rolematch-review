# Database brief: everything to consider before planning RoleMatch's own data infrastructure

The proposed design is `ADR-004-own-data-platform.md`; the prompt for the full bible is `CODEX_DATABASE_BIBLE_PROMPT.md`.

Written 6 November 2026 for whoever plans the infrastructure and the product bible (Codex included). It states what exists, what the owner requires, and what is still open. Facts are taken from the code and migrations at commit `0d76c44` (branch `rolematch/formula-a-offline`); anything not yet measured or checked is marked **unverified**. Read with `ADR-003-self-hosting.md`, `RESILIENCE.md`, `PORTALS_AND_CAPACITY.md`, `../ops/DATABASE_TO_PC_PLAN.md` and `../ops/LIVE_ON_PC.md`.

## 1. The owner's direction (binding)

1. **Our own infrastructure, no paid services to scale.** Not Supabase, not self-hosted Supabase: our own database, our own sign-in, our own private file store. "It doesn't have to be complicated, but it needs to be very, very clever." (6 Nov)
2. **Everything runs on the PC; the Mac holds only the documents and the model** (6 Nov). The off-PC backup copy lives on the Mac's disk.
3. **Zero spend.** No paid services, compute, APIs or purchases. Software must be free and permissively licensed (PostgreSQL Licence, MIT, Apache-2.0, BSD, ISC). Avoid AGPL (MinIO, Garage and Grafana were rejected on that ground in ADR-003).
4. **Data stays under our control, in South Africa** (23 Oct 2026 direction, "own infrastructure").
5. **Judge every change for tenant isolation and about 1,000 simultaneous users**, across the whole system. Load tests of 5,000 and 30,000 users were asked for (5 Nov).
6. **One path.** Nothing old runs beside what live runs; tests run live's path. When Supabase is retired, its code is removed, not disabled (`remove-unused-completely`).
7. **Configuration over code** wherever it gives consistency; configuration changes are versioned and audited (CLAUDE.md rule 11).
8. **Never call it secure or production-ready because it is deployed.** Claims need proof (`docs/product/CLAIMS_REGISTER.md`).
9. **Plan with architecture and workflow diagrams before implementing.** No patching.

**Conflict to resolve.** ADR-003 (23 Oct, still marked proposed) recommends two rented South African servers in two cities, at about R1,430 to R3,300 a month. The 6 Nov direction is zero spend with everything on one PC. The plan must say which one applies now and when the other one starts.

## 2. Where things run today

| Piece | Where | Notes |
|---|---|---|
| API, worker, model worker, monitor, tunnel | the PC: Dell Precision 5820, i9-10920X, 16 GB RAM; WSL 2 (Ubuntu 24.04) limited to 10 GB and 20 processors; Docker | live since 6 Nov; reached through a Cloudflare quick tunnel; the domain `rolematch.co.za` is owned but not yet connected |
| PostgreSQL, sign-in, file storage | Supabase's hosted project `rolematch-live`, in Ireland, on the free plan | Postgres 17.11, GoTrue v2.197.0, Storage 1.89.11 |
| The model | the Mac (Ollama, qwen3:4b-instruct-2507), reached by the PC through a private SSH link on 127.0.0.1:11500 | |
| Backups | nightly at 01:30 on the PC (encrypted dumps of the records and the accounts, plus the encrypted vault of originals), kept 14 days; the Mac collects a copy at 03:00 into `~/RoleMatchBackups` | dumps only: no point-in-time recovery, and **no restore drill has been run against the PC yet** |

**Size today:** about 14 MB of data, 3 accounts and 5 stored files (6 Nov). Planning has to be for growth, not for today's size.

**Limits today:** the free plan's session pooler allows 15 connections, split as API 9, worker 3, model worker 2 (`deploy/limits.sh`). The PC's disk size and free space are **unverified**; the daily check reports how full the disk is.

## 3. What the database holds

There are 34 migrations, `supabase/migrations/001`–`034`, applied by `npm run migrate`. Each is recorded in `schema_migrations`. `server/src/schema.ts` and `src/scripts/schemaCheck.ts` check that the live schema matches the code. Each test uses its own schema (`DB_SCHEMA`), so the design must keep schema-scoped migrations working.

| Group | Tables |
|---|---|
| Tenancy | `orgs`, `members`, `portals`, `portal_members`, `portal_invitations`, `portal_capacity`, `quota_holds`, `org_settings`, `org_settings_history` |
| Recruitment records | `documents`, `candidates`, `jobs`, `matches`, `upload_batches`, `batch_acknowledgements`, `upload_history_removed` |
| Processing | `queue` (durable jobs: leases, retries, `for update skip locked`), `outbox` + `mail_attempts` + `mail_suppressions` (at-least-once mail delivery) |
| Trust | `audit_events` (append-only, enforced by the `audit_no_update` trigger, plus an audit gate in 030), `error_register`, `error_occurrences`, `defect_groups` |
| Sign-in support (ours) | `signup_challenges`, `password_resets` (code hashes only), `signed_out_sessions` (revoked session hashes), `rate_limits` (shared counters; the function in 011 uses advisory locks) |
| Model and learning | `model_reviews`, `model_proposals`, learning records (034) |

**Database features in use:**
- `pg_trgm` for search (004);
- `jsonb` for extracted records and evidence;
- transaction-scoped advisory locks for rate limits and quota (011, 028, 030);
- `for update skip locked` for the queue and the outbox;
- row level security on every table.

## 4. Exactly what Supabase provides today, and what replaces it

Every Supabase call goes through one file, `server/src/supabase.ts` (233 lines). Replacing that file is the main seam; the rest of the code should not change.

| Supabase piece | Used for (functions in `supabase.ts`) | Must be replaced by |
|---|---|---|
| **Auth (GoTrue)**: `/auth/v1/token`, `/verify`, `/logout`, `/user`, `/settings`, `/admin/users`, `/admin/generate_link`, `/passkeys`, `/.well-known/jwks.json` | `passwordLogin`, `refreshSession`, `adminCreateUser`, `adminDeleteUser`, `createSignupCode`, `createFreshCode`, `verifySignupCode`, `createRecoveryCode`, `verifyRecoveryCode`, `setUserPassword`, `passkeySignInVerify`, `verifyAccessToken`, `signOut`, `signOutOnly`, `endSessions` | our own accounts table, password hashing, sessions and refresh, sign-up and recovery codes, and passkeys (WebAuthn) |
| **Tokens**: ES256 access tokens checked against the JWKS (`tokens.ts`); HS256 refused | the API checks every request | our own signing keys, with rotation; revocation stays in `signed_out_sessions` |
| **Storage**: `/storage/v1/object/`, `/object/sign/`, `/bucket/`; private bucket `originals` | `putObject`, `getObject`, `deleteObjects`, `signedUrl` | a private folder (`fileStore(root)` and `STORE_DIR` already exist), encrypted at rest (`localVault.ts`: AES-256-GCM), with short-lived links signed by the API |
| **The `auth` and `storage` schemas** | `members.user_id references auth.users(id) on delete cascade` (001); `insert into storage.buckets` (001) | a migration that moves both references onto our own tables |
| **PostgREST roles** `anon`, `authenticated`, `service_role` | 012 revokes their rights as a precaution | nothing to replace; the precaution can go once no PostgREST is running |

**What already works without Supabase:**
- **Mail.** Codes are created by Supabase but sent through RoleMatch's own mail host (`server/src/mail/`).
- **Tenant separation.** The `rolematch_tenant` role and the `app.org_id` setting are plain PostgreSQL (014).
- **Our share of the sign-in rules.** Rate limits, password-reset hashes and session revocation are already our own tables.

**What has to be built:**
- **Accounts, passwords, sessions and passkeys.** Passkeys must keep their current rules: user verification required, a recent sign-in needed to add or remove one, and a passkey only proves identity (`passkeys.ts`, `docs/security/PASSKEYS.md`).
- **Moving existing passwords.** GoTrue stores bcrypt hashes (**unverified on our dump**). The plan should accept the existing hashes and upgrade each one to a stronger algorithm at the person's next sign-in, so nobody has to reset a password.
- **Ending existing sign-ins.** Sessions signed by the hosted project's keys stop working, so everyone signs in once more after the move.

## 5. Tenant isolation (do not weaken)

- **Two connections with different rights.** The server connects as the owner. For work on behalf of one organisation it switches to `rolematch_tenant` (which cannot bypass RLS) and sets `app.org_id`. With no organisation named, the policies show nothing (`db.ts` `forOrg`, migration 014).
- **Platform-wide tables stay with the owner connection:** queue claiming, sign-in, rate limits and migrations.
- **Portals sit inside organisations,** with their own capacity and quota (019–021, 028). See `PORTALS_AND_CAPACITY.md`.
- **Any pooler or proxy must keep both settings intact.** The role switch and `app.org_id` are set per transaction, so a pooler in transaction mode must not let one request's setting reach the next request.

## 6. Reliability and recovery

**Required:**
- Continuous WAL archiving and point-in-time recovery to the Mac, for example pgBackRest (MIT).
- Encrypted backups, with the key kept off the backup disk.
- Restore drills on a schedule, with the recovery time measured.
- The originals vault backed up together with the database, so a restored database never points at files that are missing.

**Targets to set and then prove:**
- **RPO:** how much data may be lost.
- **RTO:** how long until live is back.

ADR-003's targets assumed two servers. With a single PC, the honest figures are minutes of data lost and hours to recover if the PC dies. The plan must state that until a second machine exists.

**Already built and worth keeping:**
- Read-only mode when the main database is unreachable (`READ_FALLBACK_DATABASE_URL`, `RESILIENCE.md`).
- An audit journal for entries made while the audit log can't be written.
- The originals copy (`originalsCopy.ts`).
- The outbox for mail.
- Bounded queue retries.

**What a single PC cannot protect against:** power cuts (there is no UPS yet), the home internet going down, Windows updates restarting the machine, and disk failure. Plan for each of them, or say plainly that it isn't covered.

**Growth path without paid services:** a streaming replica on a second machine the owner controls (the father's PC is a possibility), then automatic switch-over (Patroni with etcd, or a documented manual promotion). The application already accepts a multi-host connection string. All of this is **unverified** on our setup.

## 7. Performance and capacity

- **Target:** about 1,000 simultaneous users, with tests at 5,000 and 30,000 users (owner, 5 Nov).
- **Connections:** without the 15-connection cap, choose pool sizes per process from measurement. Each process holds its own pool (`DB_POOL_SIZE`). `MAX_IN_FLIGHT` sheds load beyond about 8 requests per connection (register R113).
- **Memory:** the PC has 16 GB; WSL is limited to 10 GB, with live's containers taking about 4.3 GB of that. PostgreSQL's memory (shared_buffers, work_mem) must fit what is left beside OCR and the workers.
- **Indexes:** they already exist for the queue, the outbox, search (trigram) and per-organisation listings (003, 007, 032). Check them against real query plans under load.
- **The real bottleneck is likely the model on the Mac, not the database.** Measure that before tuning the database.

## 8. Security

- **Network:** PostgreSQL listens on 127.0.0.1 inside WSL only, so nothing reaches it from the home network or the internet. The daily check (`deploy/pc/daily-check.sh`) already fails on anything listening beyond the PC.
- **Least-privilege roles:**
  - an application role that is not a superuser;
  - a migration role;
  - `rolematch_tenant`;
  - a backup role;
  - a read-only role for reporting.
- **Passwords:** a strong hash with a per-user salt. Never log codes, passwords or invitation tokens.
- **Guessing limits:** at most 5 attempts per 15 minutes for anything that guesses a secret (`AUTH_ATTEMPTS`).
- **Secrets:** root-only files (`/etc/rolematch/live.env`); never in Git, images, traces or logs. Signing keys must be rotatable without downtime.
- **Encryption:** in transit (TLS even on the loopback, or a documented reason not to), at rest for files (already) and for backups (already). Whole-disk encryption on the PC is an **owner decision**.
- **Updates:** the daily update check already covers the operating system, Docker, Node, the tunnel and Ollama. PostgreSQL and every new component must be added to it.
- **Hard prohibitions:** do not disable RLS, weaken assertions or relax permissions to make a deployment pass. Do not build an endpoint that lets an unauthenticated caller send arbitrary e-mail.

## 9. Privacy (POPIA) and data lifecycle

- **Real CVs** are personal information. Keep them out of Git, ordinary logs and unrestricted reports.
- **Permanent deletion removes everything that holds the person** (`deletion.ts`): the record, matches, the stored original, extracted text and personal detail in past edit history. Only a plain audit line remains. **Backups also hold deleted people until they expire.** Decide and document how long that is (14 days today) and whether a restore re-applies deletions made after the backup.
- **Retention rules** per data type are still to be written (CLAUDE.md, target boundary).
- **Cross-tenant use of data** for model training needs separate permission. The design must make one organisation's records unreachable from another's training set.
- **Audit:** who changed what, from what and to what; append-only; kept as long as the records it describes.

## 10. Operations

- **Monitoring:** `rm-monitor` checks `/api/ready` from outside and `/api/ops/health` from inside, and e-mails the owner (`opsNotify.ts`). Add database checks: connections, replication and archive lag, disk, the age of the last backup, the result of the last restore drill, and long-running queries.
- **Migrations:** forward-only and numbered, each with a written rollback note when it can't be undone (see `MIGRATION_019_020_ROLLBACK.md`), applied in a release only after a backup.
- **Releases:** the full test suite, browser journeys, a backup and a rollback path, as for every live change.

## 11. Testing requirements

- **The suite runs against the same kind of database live runs** (one path). Today some tests run against a local Supabase test stack on the PC. That stack must be replaced by the new stack, not kept beside it.
- **Contract tests for the replacement:** every function now in `supabase.ts` gets tests that pass against both the old and the new implementation before the switch. After that, the old one is removed.
- **Isolation tests:** one organisation can never read or change another's rows, through any role.
- **Recovery drills:** restore to a chosen minute, a lost disk, a killed process during a write, a full disk.
- **Load tests:** at 1,000, 5,000 and 30,000 users, run against the rehearsal and never against live.

## 12. The move (outline; the detailed plan comes after design)

1. Build and test the new stack on the PC beside live, with nothing exposed.
2. Rehearse: restore a dump of the hosted project (all schemas, including `auth` and `storage`) and a copy of every file. Show that row and file counts match, existing passwords sign in, and the journeys pass.
3. Cutover: back up; stop the workers and then the API; take the final dump and copy; compare the counts; switch the settings; verify from outside. Expected pause: about 15 minutes. **The owner approves the time.**
4. Way back: keep the hosted project untouched for 14 days. Anything created after the move has to be copied back before switching back.
5. After that: remove the Supabase code and settings completely, with evidence, and update every document that names Supabase (CLAUDE.md, `server/README.md`, these docs).

## 13. Open decisions for the owner

1. One PC now, with a second machine later? Or ADR-003's two rented servers? (This conflicts with the zero-spend direction; see section 1.)
2. RPO and RTO targets that the owner accepts for a single PC.
3. How long backups are kept (and therefore how long deleted people stay in backups).
4. Whole-disk encryption on the PC, a UPS, and BIOS power-on after a power cut.
5. When the cutover runs.

## 14. Non-goals

- No paid managed database.
- No AGPL components.
- No second copy of the system left running "just in case" after the move (one path).
- No foundation-model work here: this brief covers data infrastructure only.
