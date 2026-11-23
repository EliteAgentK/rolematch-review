# Platform-wide failure coverage matrix (read-only inspection, 2026-10-28)

Built by reading the code and tests, not by running failures. "Occurrence" means a row in `error_occurrences` (migration 018, `server/src/occurrences.ts`), grouped in `defect_groups`. **Only uploads, batches and document processing write occurrences today; this is not platform-wide coverage.** Migration 018 is applied to test schemas only; it is **not** applied to the live dev project.

Legend: ✔ present and tested · ◐ partial · ✘ absent.

| Component | Failure types | User experience | Recorded evidence | Regression coverage | Recovery behaviour | Gap / next |
|---|---|---|---|---|---|---|
| Authentication, session | wrong password, unconfirmed, expiry (AUTH-001/003/005), rate limit | Clear message; session-ended notice and re-login in place ✔ | Login failures feed the rate limiter ◐; success audited; **no occurrence** ✘ | signup, session-length, ratelimit tests ✔ (session-length time budget was too tight; fixed) | Sign in again ✔ | Record repeated login failures as occurrences (security signal). |
| Invitations, portals | misuse, forwarded link, revocation | — | — | — | — | **Not built** (decision pending). |
| Authorisation / tenant isolation | cross-org access (404), role denial (PERM-001/002/003) | Plain refusal ✔ | RLS in the database ✔; denied attempts **not** recorded ✘ | `isolation.test.ts` enumerates every route ✔; `tenant-separation` ✔ | n/a | Record denied cross-org attempts as security occurrences; alert on repeats. |
| Upload admission (single) | type, size, empty, quota, rate, lock | Specific message ✔ | **No occurrence** for single-file refusals ✘ | documents, formats, hostile-input tests ✔ | Retry / replace ✔ | Wire single uploads into occurrences. |
| Upload admission (batch) | the above plus batch limits, lock, full, cancelled | Per-file reason in panel and report ✔ | Occurrence per refusal ✔ (kind expected_validation) | `batches.test.ts` ✔ | Re-add files; idempotent ✔ | – |
| Batch processing, queue, workers | worker crash, retries exhausted, stall | Counts, ETA range or "taking longer than usual", reference ✔ | Occurrence per failed attempt, final failure = suspected defect, grouped ✔ | batches, several-servers, scale tests ✔; crash mid-batch **not tested** ✘ | Stale-job sweep, bounded retries, manual retry ≤3 ✔ | Test worker restart mid-batch. |
| Storage (originals) | upload or download failure, missing object | Generic "could not process"; retries ✔ | UNEXPECTED_ERROR occurrence at stage ✔ | originals-and-journal ✔ | Local copy fallback ✔ | Separate "storage" component label; alert on rate. |
| OCR | unreadable photo/scan, engine fallback, slow | Specific reason and hint ✔ | Rejections recorded as expected_validation ✔; **engine fallback and timing not recorded** ✘ | ocr, photos, tiff, ocr-choice tests ✔ | Replace with clearer copy ✔ | Record which engine ran and its confidence; R9, R13 open. |
| Extraction (parser) | wrong field, missing identity, dropped skill | Review flags, `needs_review` ✔ | Recruiter corrections → `error_register` (human-reported) ✔; **no automatic occurrence** ✘ | parser, golden, messy, pack300 ✔; R22, R23 known failures | Edit with reason ✔ | Link parser versions to correction rates. |
| JSON / schema validation | record fails schema | Record held, `schemaStatus` ✔ | console log only ◐ | schema.test ✔ | – | Occurrence on validation failure. |
| Matching (rules 2.2.0) | wrong credit, ordering | Explanation and evidence trail ✔ | Corrections only; **no occurrences** ✘ | scoring, match, points ✔; **R1, R2, R15–R20 known failures (see KNOWN_FAILURES.md)** | Human review | Fix or disclose; Formula A offline. |
| LLM inference | timeout, invalid output, unsupported claim | **Not in live path** | Offline validator fails closed; EA1 provenance recorded in experiments ✔ (offline) | `evidence/contract.test.ts` 102 ✔ | Abstain → unresolved ✔ (offline) | Build occurrence + provenance when a model is wired in behind a flag. |
| Collaboration, live updates | conflicting edits, stale events | Optimistic concurrency (version) on records ✔ | audit of edits ✔ | integrity, e2e ✔ | Conflict message ✔ | Live updates and presence **not built**; late worker output vs edits **untested** ✘. |
| Database operations | outage, read-only mode | Banner, held uploads ✔ | console JSON ◐ | several-servers, rehearseOutage script ◐ | Copy + journal ✔ | Occurrence for outage start/end. |
| Audit and error logging itself | write failure, unbounded growth | – | Audit appended in the same transaction as the change (fails with it) ✔; occurrence failures are logged and **not monitored** ✘; pruning is probabilistic, 5000/org | occurrences: eta.test covers classification and sanitising ✔ | Recording never throws ✔ | Alert on `occurrence.record_failed`; deterministic retention job; admin UI for groups. |

## Sequence for the rest (by consequence, not convenience)
1. Denied cross-organisation attempts and repeated login failures as security occurrences (isolation signal).
2. Single-file upload refusals and extraction validation failures.
3. Worker restart mid-batch and edit-versus-late-worker tests (data integrity).
4. OCR engine and timing; matching and corrections linked to versions.
5. Monitoring of the logging path; retention job; administrator view.
6. LLM provenance when a model is first wired into the application.

## Reading this honestly
An empty `error_occurrences` table proves nothing: most components do not write to it yet. A drop in occurrences means improvement only when workload and detection coverage are comparable.


## Update 2026-10-29 (after portals, shared capacity, rate limits and the page limit)
Occurrences are now written by: uploads and batch refusals (portal scoped), document processing (each attempt, final failure, blocked and rejected documents). Still **not** covered (gaps stated, not hidden):
| Component | Now covered | Still missing |
|---|---|---|
| Authorisation / isolation | portal and organisation isolation tested at database, API and storage-route level (`tenant-separation`, `isolation`, `portals`); denied access returns 404 without confirming existence | denied cross-portal attempts are **not** recorded as security occurrences (would need bounded, deduplicated recording) |
| Invitations | single use, expiry, revocation, e-mail binding, hashed tokens, wrong account refused, audit without the address (`portals.test.ts`) | no administrator screen yet; invitation e-mails are not sent (the link is returned once to the inviter); account creation for an invited person relies on the existing sign-up code step only when `SIGNUP_REQUIRE_CODE` is on (tested in test mode) |
| Rate limits | 14 new tiers with metrics (`RATE_LIMITS.md`) | limit hits are counted, not recorded as occurrences; no edge/proxy limit; per-tenant lower rate limits pending |
| Capacity | reservations, release, counter drift check (`capacity.test.ts`) | no alert wired to `capacity.counter_drift`; no portal-specific slot override |
| Error recording | recorder failures counted and visible; a regression it hid is now caught (R28) | no deterministic retention job (pruning is probabilistic, 5,000 per organisation); no administrator screen |
| Page limit | **Removed for CVs 2026-11-02 (owner rule):** 8-, 13-, 24- and 30-page CVs read in full and published, last page present in the text; Word CVs with or without a recorded count read; job descriptions still meet the organisation limit (`pagelimit.test.ts`, `documents.test.ts`) | a very long scanned CV ties up the OCR reader on that machine for minutes (OCR runs one at a time); not measured at load |
| Collaboration | colleague completion notice, per-person acknowledgement | **no live push updates or presence**; edit-versus-late-worker-result has only the SQL guard (not exercised by a test); concurrent edit conflicts rely on the existing record versions |
