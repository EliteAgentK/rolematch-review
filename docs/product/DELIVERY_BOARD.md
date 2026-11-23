# Prototype delivery board (started 2026-10-28; planning target about 22 November 2026, to be confirmed)

One board for the prototype. It reuses `docs/architecture/PRODUCTION_READINESS.md`, `docs/assessment/` and `docs/product/CLAIMS_REGISTER.md`; it does not replace them. A prototype is not production approval, and nothing here is production-ready.

**State column** means: *verified* (read in code **and** exercised by a test run in this session), *read-only* (found in code, not exercised here), *partial*, *missing*, *deferred*.
**Priority:** PB = prototype blocker, PR = production requirement, R = research.

## Verified starting state (2026-10-28)

* Branch `rolematch/formula-a-offline`, HEAD `251b47f`, one untracked directory (`server/test/factory/content/`). Parser 2.9.0; E2/E3 off; EA1 failed and unpromoted; annotation v0.2 is AI-assisted, not independently verified.
* Formula A and B exist only offline (`server/src/assessment/`), inactive. The live matcher is `match.ts`/`scoring.ts` (rules 2.2.0).
* No local-model call is reachable from an application request. The agents in `server/src/ai/` run only from harnesses.

## Capabilities

| Capability | State | Smallest missing change | Pri | Depends on | Acceptance test | Effort / uncertainty | Evidence | Approval boundary |
|---|---|---|---|---|---|---|---|---|
| Sign-in, org-scoped access, RLS | read-only (existing tests passed in this session: tenant-separation, isolation) | none for prototype; session-expiry-during-batch test | PB | – | isolation suite | S / low | `test/isolation.test.ts`, `tenant-separation.test.ts` | none |
| Single upload → queue → record | verified | – | PB | – | `documents.test.ts` | – | passing | none |
| Durable queue, per-org fairness, heartbeat recovery | read-only (`queue.ts`; `several-servers.test.ts` passed) | worker-restart test mid-batch | PB | – | kill worker, batch completes | S / low | – | none |
| **Batch entity, real counts, partial success, duplicates, refusals** | **verified (this milestone)** | – | PB | migration 016 | `test/batches.test.ts` | done | commit of this milestone | live DB migration is not applied (see below) |
| **Batch cancel / bounded retry / admission limits** | **verified (this milestone)** | – | PB | as above | `batches.test.ts` | done | – | – |
| Browser multi-file / folder upload + batch panel | **built, partly verified**: sender logic unit-tested (5 tests); typecheck and build pass; server-side flow measured at 25 files; **not yet driven in a real browser** | Playwright run: choose a folder, refresh mid-way, counts match server | PB | M1 | Playwright: 20 files, refresh mid-way | S–M / medium | `src/utils/batchUpload.ts`, `BatchPanel.tsx`, `test/batch-capacity.test.ts` | none |
| Worker-restart and session-expiry across a batch | missing | kill/restart test; expiry mid-batch | PB | UI | scripted | S–M / medium | – | none |
| Capacity measurement for batches | missing | measured run at 25/50/100 files on this M5 16 GB | PB | UI | recorded timings, no claims beyond them | S / medium | – | none |
| Upload rate limit 40/min per user vs batch of 100 | partial (client must back off) | client honours `retry-after`; decide whether batch uploads get their own limit | PB | UI | 100-file batch completes without refusals | S / low | – | scoring-neutral; owner may want a different limit |
| Panels from canonical records | read-only | audit panel vs record schema for source references and explicit unknown states | PB | – | panel test per field class | M / medium | – | none |
| Stale assessments after material correction | missing | mark matches stale on edit of a locked-in field class | PB | panels | edit → match shows stale | M / medium | – | none |
| Evidence-linked matching page (first view + accordions + audit export) | missing (current page shows rules 2.2.0 output) | redesign focused page over *current* live results | PB | – | accessibility + content checks | M–L / medium | – | formula activation stays the owner's decision |
| Star display | proposed only | rounding policy and which figure the stars represent | PB | **owner decision** | boundary table | S / low | – | owner |
| Experimental local-model assessment behind a flag | missing | request → local model → validated, source-linked output → panel, with fallback to rules | PB (experimental label) | evidence contract (exists) | request test + fallback test + labelled output | M / high | EA1 contract in `server/src/assessment/evidence/` | none beyond local; not promotion |
| Annotation page end-to-end verification (click, reload, export) | partial (store round-trip only) | owner clicks through; I cannot drive claude.ai | R | owner | saved review read back | S | – | owner |
| Malware scanning | deferred (owner decision) | – | PR | – | – | – | `scan_result` says "NOT performed" | – |
| Own PostgreSQL, backups, PITR | deferred (owner decision) | – | PR | – | – | – | – | – |
| South African legal review, retention policy | missing | specialist review | PR | – | – | external | – | owner |
| Training / fine-tuning | deferred: no independently verified labels, no approved compute budget | – | R | fresh labelled set | – | – | EA1 record | budget approval |

## What changed on this board today

* Milestone 1 (backend half of batch uploads): migration `016_upload_batches.sql`, `server/src/batches.ts`, routes `POST /api/batches`, `GET /api/batches/:id`, `POST /api/batches/:id/cancel`, `POST /api/batches/:id/retry`, and `?batch=<id>&name=<file>` on `POST /api/documents`. Config: `MAX_BATCH_FILES` (500, owner's cap), `MAX_BATCH_MB` (1024), `MAX_MANUAL_RETRIES` (3).
* `LIMIT_DOCS_PER_DAY` default raised 300 → 1000 (an organisation's daily allowance would otherwise refuse a 500-file batch). Per-organisation Settings can still lower it; the platform ceiling is 5000. This is a fair-use allowance, not a scoring policy.
* **The migration has NOT been applied to the live dev Supabase project.** Tests apply it to their own throw-away schema. Apply with `npm run migrate` in `server/` when you agree.

## Semantics chosen (please challenge)

* A batch is **declared first** (file count and total bytes) and admitted or refused as a whole: file-count and size limits, then the organisation's daily upload and storage allowances.
* **Counts are derived**, never stored: waiting, processing, completed, needs review, failed, cancelled, plus stored duplicates and refusals. `complete` means nothing is waiting or in progress; it does **not** mean everything succeeded.
* **Duplicates** (same bytes already in the organisation): answered, counted, not processed again. A previously *failed* identical file is re-queued and moved into the new batch (existing behaviour, kept).
* **Cancel** stops only what has not started. A file already being read finishes and its record is kept. Published records are never touched. After cancelling, the batch accepts no more files.
* **Retry** re-queues only `PROCESSING_FAILED` files (transient or operator-level failures), at most `MAX_MANUAL_RETRIES` times each. Content failures (for example no name found) are not retried blindly; re-uploading a corrected file is the route.
* A refused file never becomes a document; its name, code and message are kept on the batch (first 100) so a refresh still shows it.

## Known limits of this milestone

* Backend only: the browser still uploads one file at a time.
* During a database outage (read-only mode) uploads are held by the older held-upload mechanism, which does not carry batch membership.
* Cancel and the count of a file that is being read at that moment can briefly disagree (the file finishes and becomes completed).
* Admission is checked at declaration and per file; two simultaneous uploads into the last slot of a batch could both pass the "full" check.
* The 40-per-minute per-user upload rate limit still applies to batch uploads; the client must honour `retry-after`.

## Update 2026-10-28 (evening): browser batch upload, locks, first 500-file measurement

**Measured (server path with the browser's own sender, invented CVs, Apple M5 16 GB, dev Supabase over the internet, 4 workers / 2 per organisation, one run each):**

| Files | Result | Time | Per file | Peak waiting+reading |
|---|---|---|---|---|
| 25 | 25 records, 0 failed | 52 s | 2.1 s | 7 |
| 500 | 500 records, 0 failed, 0 duplicates, one record per file | 14.9 min (893.9 s) | 1.8 s | 8 |

This shows one organisation can push 500 simple invented Word CVs through unattended with the window of 8. It is **not** a capacity claim: one tenant, one user, one format (docx), no OCR/scans/photos, no other load, single run. The 500-file run used the server code before the upload-lock change (the lock adds one indexed query per upload; not re-measured).

**Upload-mode locks (server-side, derived, no flag to leak):** a person with a candidate batch in progress cannot start another or upload a single CV from any tab/device (409 `LOCK-001` with the batch id and the agreed message); job descriptions are a separate lock; colleagues and other organisations are unaffected. Released by completion, cancellation (once running files finish), or an abandoned transfer after `BATCH_TRANSFER_LEASE_SEC` (300 s); never by sign-out or closing the page while admitted work continues; review flags do not hold it. Double clicks / two tabs: exactly one batch admitted (tested with 6 simultaneous requests). Single upload vs batch admission serialised by a per-person advisory lock (tested over 3 rounds; a random race, so this is evidence, not proof).

**Not built from the new consolidated brief (needs decisions or is separate work):** portals as a layer under organisations (today a user belongs to exactly one organisation), invitation-only membership, member administration, live updates and presence (no WebSocket/SSE exists; the batch panel and board poll), shared activity feed distinct from the audit log, per-user/portal/organisation capacity tiers, ETA display, completion dialog and downloadable batch report, edit-vs-late-worker protection, membership-revocation tests, the 200-user benchmark.

**Known gaps in what was built:** not exercised in a real browser (unit tests of the sender and a typecheck/build only); animation not seen on screen; migration 016 not applied live; a rare race can leave one orphaned private storage object when a single upload loses the lock race; the "different user, same organisation" lock case is untested because there is no way to add a second member to an organisation yet; the full backend suite was restarted and had not finished when this was written.

## Added 2026-10-28: platform-wide error handling and verified learning (owner direction)

Extends the existing error register (`docs/learning/ERROR_REGISTER.md`, table `error_register`) and experiment ledger; no competing system. Required: a coverage matrix (component → failure types → user experience → recorded evidence → regression coverage → recovery behaviour) with gaps stated; structured occurrences with correlation ID, stage, scope, severity and versions; grouping of repeats with counts; the nine-step defect lifecycle; protection of the logging path itself (bounds, dedup, retention, access, failure monitoring, fail-safe for security-critical audit writes); LLM provenance and evidence-support checks; no automatic retraining or promotion. **State: proposed only. Not started.** The batch work this session records failures per file (`failures`, `refusals`, audit `batch.*`, `document.exception`) but does not yet group repeats, record component versions per occurrence, or cover the other components in the matrix.


## Update 2026-10-29: portals, shared capacity, rate limits, page limit
Verified in isolated schemas: portals and invitations (7 tests), shared 500-slot capacity (10), rate limits for portal work (7), batches with real processing and a mid-batch restart (7), seven-page limit (5), tenant and route isolation, migration 019 on pre-existing data (4), estimator and occurrence recording (6), startup never migrates the shared project (1). Browser-checked with two recruiters in one portal: capacity bar, both zones blocked at 500 of 500, slots held until the whole batch closed (not per document), release then convergence, e-mail and SAST attribution, per-person acknowledgement, colleague notice, no per-file pop-ups. **Pending approvals:** applying migrations 018, 019 (changes data: see `docs/architecture/PORTALS_AND_CAPACITY.md` section 4) and 020 to the shared project, with the matching code. **Pending decisions:** who may create portals; how to count pages for Word files that record none (a renderer needs a download, or a policy of allow-and-flag); which pool size the responsiveness gate should reflect. **Not built:** members and invitations screen, live push updates and presence, shared activity feed, completion-dialog "retry" across a reservation refusal in the UI, the 200-user benchmark, per-tenant rate overrides.

## Update 2026-10-29 (evening): repository, slice A, checkpoint state
* **Remote:** private repository `https://github.com/EliteAgentK/rolematch` (the existing private `talenthub` repository, renamed at the owner's request; remote `personal`). Only the development branch `rolematch/formula-a-offline` is pushed, with upstream tracking; `master` there is unchanged and nothing is merged or release-ready. Before the push the working tree and all 147 commits were scanned: no keys, tokens, `.env`, dumps, logs, model weights or `server/data`; the only credential-shaped strings are the throw-away local `postgres:postgres` test URLs. Sample CVs in `sample-documents/` are the fictional documents described in their commit.
* **Latest integrated result:** a7d800b full suite 660 passed, 10 expected failures, 2 failures (migrations 018-020 unapplied; pool-of-3 responsiveness gate). Since then targeted runs only: portals, migration-019, isolation (13 passed) and the four tests below. No full run on the newest commit.
* **Slice A (portal-creation delegation), local, migration 021 (not applied to shared dev):** administrators create portals; an administrator can delegate or withdraw the right per member (`PUT /api/members/:id/portal-creation`); the right is read from the database on every creation, so withdrawal is immediate; audited with both e-mails. `test/portal-creation.test.ts` (4 passed).
* **Migrations 018-021 are all unapproved for shared dev.** Missing from the review: a taken backup, a post-application check list, a rollback rehearsal.
* **Not yet built from the collaboration brief:** invitation e-mails and outbox, acceptance flow screens, portal chooser and oversight role, leave/last-administrator rules, per-account upload ownership across portals, live capacity events, idempotency scoping, contract versioning, readiness endpoint, Word page rendering (LibreOffice not installed; Word files without a recorded page count stay blocked).

## Update 2026-10-29 (night): owned mail, default-deny sending, verification hardening
* **Full suite on 8b70451** (owned mail, run alone, 75 min): 705 tests, 688 passed, 10 expected failures, 6 failed, 1 skipped. Failures: schema check (migrations 018-022 unapplied, expected); migrate-startup and tenant-separation (my defects: a deployment check ran on every config read; `mail_attempts` lacked a tenant row rule); portals x2 (a deliberately changed wrong-account answer, test updated; the second was a knock-on); batches restart (test restart did not wait for a draining server). The pool-of-3 responsiveness gate PASSED in this run (one pass; earlier runs mostly failed: not resolved).
* **Fixes and new work: 773d161, 1826af5, 88275e3, 667ce4c.** Targeted run of 15 files on 88275e3: 78 passed, 3 failed (two test defects, one local-Auth setup); after the test-only fixes, those 3 files passed on 667ce4c (10 tests). Code is identical between 88275e3 and 667ce4c.
* **Built:** SMTP transport (nodemailer) with separate pools; default-deny sending (`MAIL_SEND_MODE`, shared allowlist for every message type); config that never loads MAIL_* in an isolated run; non-secret `/api/health/mail` and a browser-test refusal unless sending is off/restricted; `npm run mail:config` (hidden prompt, parser-verified, atomic, private, no duplicates); 15-minute codes bound to each issued code, 60-second resend wait, newer code never extends an older one; all-or-nothing onboarding with sign-in recovery; bounded uncertain-send handling; honest sign-up UI.
* **Not done / pending you:** host permission and hourly limits (60/h is provisional); aligning Supabase OTP expiration to 900 s (approval; `docs/ops/AUTH_CODE_EXPIRY.md`); mailbox password via `npm run mail:config -- credentials`; approved test recipients; real sends; inbox-arrival measurement; bounce reading; the database round-trip overhead per send (about 1.5 s) to reduce.

## Update 2026-10-30: trial closed; disappearing candidates (R35); people and access; R22
* **Mail trial (isolated schema `trial_mail`, sending restricted to the owner's two approved addresses).**
  - Recorded by the system: verification code accepted by the host in 1287 ms; organisation welcome accepted in 1975 ms (single samples).
  - Confirmed by the owner, separately: the code arrived quickly and worked, and "The flows I tried worked".
  - Not exercised with real mail: the invitation, its acceptance from the second approved address, and the member welcome. Not stated by the owner: Inbox or Spam placement.
  - The main server's sending stays off. Details: `docs/ops/MAIL_RESPONSIVENESS.md`.
* **R35, fixed (64c6fd8).** The candidates had not disappeared from the database: the trial API was stuck read-only on a copy without its schema, and the board showed the failure as "0 candidates".
  - The server now switches only to a copy that holds its schema, and checks the main database before allowing saving again.
  - The board says when it could not load.
  - History says "Added, reviewed" and links each record with Open.
* **People and access (98fa4cd, migration 023 not applied to shared dev).**
  - Viewer is view-only on the server.
  - Role changes, leaving a portal or the organisation, and removal, with last-administrator safeguards under row locks.
  - An organisation administrator's recovery route for a portal.
  - Settings, People (the organisation and everyone in it), and Team with names.
  - Portal chooser at sign-in.
  - Rules and open items: `docs/product/COLLABORATION.md`.
* **R22, fixed (1f9224f).** The skills R and C are kept in skills lists: 0/10 before, 10/10 after on the same invented inputs; the parser corpora are unchanged. **R36 recorded, not fixed:** clinical skills are missed when a CV has no skills section; a pre-registered experiment is proposed.
* **Staged batch, real browser upload (local check server, invented files).** Two files were added one at a time and sent only on Upload.
  - The batch card left the board when finished, and the candidate record stayed.
  - The Word sample was held because its page count cannot be verified, which is the rule as designed.

## Update 2026-11-02: match details, View Original CV, sign-in limits, R37, R38, runner checks
* **Match details (23fd71c).** Presentation only: scores, states, order and formula unchanged.
  - The default view shows the candidate and role, star alignment, one sentence, key findings in one table, warnings that matter, and View CV, View job and Expand assessment.
  - The server writes the sentence, a short reason per requirement and coded notices, all from the structured assessment (`server/src/overview.ts`).
  - "About 0 years" now reads "Relevant experience could not be established from the CV".
  - Stars are the percentage ÷ 20, to the nearest half, always shown with the percentage. They are never stored, and they never rank anything.
  - The "Request information" button was removed: it said "Not connected yet". The match dialogs are wider: `min(1040px, 94vw)`.
  - Tests: `match-overview.test.ts` (5) and `alignmentStars.test.ts` (32).
  - Checked in the browser on invented records: summary, short reasons, the "could not be established" wording and the draft warning all show.
* **R37, fixed (23fd71c).** The shortlist listed results in fetch order (a 6% job above 88%). It now uses the server's own `compareRank`.
* **View Original CV opens in the browser (b123154).**
  - Word becomes a read-only page. PDF, images and text are sent inline. Other office formats show the text that was read.
  - Checked in the browser: a Word CV opens as a page.
  - **Not checked:** a PDF displaying in Chrome. The app's built-in browser pane has no PDF viewer. The response is correct (`inline`, `application/pdf`), but whether Chrome shows it under the API's content policy is unconfirmed.
* **Sign-in limits (aa5cb38), owner rule "5 attempts per 15 minutes".**
  - 5 failures in 15 minutes per account for passwords, per address for e-mailed codes, and per sender for invitation links (new).
  - The real wait is shown to the person and sent in `retry-after`.
  - Shared office addresses keep their higher per-address limit.
  - Known trade-off: anyone who knows an address can lock its sign-in for 15 minutes. Details: `docs/product/RATE_LIMITS.md`.
  - `ratelimit.test.ts`: all pass against the dev database.
* **R38, fixed (test harness).** A second `vitest run` killed the first run's servers and dropped its schemas. This explains the 2026-10-30 `capacity-property` failures. `mail-allowlist` failed for a different reason: database connection slots ran out under load, and it passes alone.
* **Research runner (branch `research/llm-weekend`, 3e72112).** The owner's seven persistence checks were run on a throwaway home: `research/runner/PERSISTENCE_CHECKS.md`.
  - Shown: 1, 2, 3, 5, 6.
  - Check 4: the runner's deadline is shown; the supervisor is not built.
  - Check 7: the cap refusal is shown.
  - One logging defect fixed: crash recovery now logs when SIGTERM alone ended a job's leftovers.
  - The real research home is still stopped. The weekend window ended Mon 2 Nov 07:00 without the programme running.
* **Cleaned up:** the check schema `ui_check_41b475e5`, its stored files and its invented sign-in account.

## Update 2026-11-02: no CV page limit
Owner rule: there is no page limit for CVs. The seven-page hold, the hold for CVs whose pages cannot be counted, the organisation page setting (for CVs) and the 30-page OCR cap (for CVs) are removed, so every CV is read in full. The organisation's page setting now applies to job descriptions only and is labelled so in Settings. File size (50 MB upload, 15 MB after optimising) and the per-page reading time budget still bound the work. The old codes PAGE_LIMIT and PAGES_UNVERIFIED are no longer produced; they stay only so batches recorded earlier still report correctly. **Trade-off:** OCR runs one page at a time per machine, so a very long scanned CV delays other scans on that machine; not yet measured at load.

## Update 2026-11-03: safety checks, monitoring, passkeys
**Remotely verified:** CI on the private `EliteAgentK/rolematch`. Secret scan, licence policy, dependency audit, website and server jobs on a disposable local Supabase. A failing test, a fake secret with the hook skipped, and a broken scanner each fail it; corrected code passes (`docs/security/SAFETY_CHECKS.md`). **Not enforced:** GitHub Free refuses branch protection on a private repository (HTTP 403), so a failed check does not block a merge.
**Locally implemented, not deployed:** monitoring (`docs/ops/MONITORING.md`): an authenticated health summary and Gatus, proven in a controlled trial with a test receiver. No real alert has been sent. It needs an independent host and an approved channel. Passkeys (`docs/security/PASSKEYS.md`): enrol, sign in, remove, against the real sign-in service and in real Chrome with a virtual authenticator. Off by default, not on the hosted project, not tried on a real device.
**Applied:** migrations 018–023 to the development project, with approval, after a full backup; row counts identical.
**Defects found:** R40 (website audit never ran), R41 (correct password reported as incorrect; open), R42 (OCR misses a large name heading; open), R43 (sign-up codes not claimed atomically, fixed; test harness and platform differences).
