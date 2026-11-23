# Prompt for an independent code review (paste into Codex)

You are an independent senior reviewer of a recruitment-matching product called RoleMatch (repository root: this checkout, branch `rolematch/formula-a-offline`). Review critically and report evidence, not reassurance. Do not modify files, push, deploy, or contact external services. Do not read or use any real CVs; fixtures here are invented. If you cannot verify something, say so rather than assuming.

Read first: `CLAUDE.md`, `docs/product/DELIVERY_BOARD.md`, `docs/assessment/DECISIONS.md`, `docs/assessment/experiments.json`, `docs/ml/EVIDENCE_ASSESSMENT_EXPERIMENT.md`.

## Context

RoleMatch is a React/Vite frontend (`src/`) and a TypeScript backend on Node 24 (`server/`) with a Supabase (PostgreSQL + private storage) dev project, a durable job queue, and rules-based extraction. Hard constraints from the owner: no external AI API or key; local, permissively licensed models only; no real documents; the platform recommends, humans decide; formula weights, ordering and thresholds are not to be tuned to improve results; nothing is pushed, deployed or activated without approval. Production readiness is explicitly **not** claimed.

## What was done across the recent work (commits `98edc74`..`251b47f`, plus uncommitted changes in the working tree)

1. **Formula A / Formula B (offline, inactive)** in `server/src/assessment/`: exact rational arithmetic, a criteria normal form (AND of OR of AND), per-leaf documented/upper-bound values, three candidate ordering policies (none chosen), a disabled Formula B, release gates, a decision register. Tests under `server/test/assessment/`.
2. **Visual Variety 60 batch (stage 2)**: inventory, frozen baseline, protected split, scorer and comparator (versions 2.0.0; earlier 1.0.0/1.1.0 were found defective and superseded), experiments E1 (accepted within scope), E2 (failed the pre-registered photo false-positive gate; isolated behind `PARSER_EXPERIMENTS`), E3 (rejected). Register: `docs/assessment/experiments.json`.
3. **Local-model layer audit and experiment EA1** (`docs/ml/`, `server/src/assessment/evidence/`): a requirement-to-evidence assessment contract, a fail-closed validator, a rules baseline, and a local-model assessor (Ollama, loopback-only). EA1 **failed** its pre-registered agreement gate and is unpromoted. Annotation v0.2 is an **AI-assisted** review supplied by the owner, not human-verified. A review page was published as a private claude.ai artifact.
4. **Today's milestone: upload batches (backend)**. New files: `supabase/migrations/016_upload_batches.sql`, `server/src/batches.ts`, `server/test/batches.test.ts`; edited: `server/src/index.ts` (routes, `storeUpload`), `server/src/config.ts`, `server/test/isolation.test.ts`; docs `docs/product/DELIVERY_BOARD.md`. Run `git status` and `git diff` to see exactly what is uncommitted.

## Review tasks (in priority order)

### A. The batch-upload milestone (most important)
Read `server/src/batches.ts`, the batch routes and the `POST /api/documents` wrapper in `server/src/index.ts`, migration 016, and `server/test/batches.test.ts`.

1. **Tenant isolation.** Can any batch route, or an upload with `?batch=<id>`, read, change, cancel, retry or add to another organisation's batch or documents? Check every query includes `org_id`, and that the RLS policy in 016 matches migration 014/015 patterns. Is `isUuid` applied before any query?
2. **Correctness under concurrency.** Races between: cancel and a worker claiming a job; two simultaneous uploads into the last slot of a batch (the "full" check in `openBatchFor` is not atomic); retry racing a running job; duplicate detection racing a retry that moves a document into a new batch (`coalesce(batch_id)` in `storeUpload`). Which can produce wrong counts, double processing, or a duplicate record? Does `processDocument` tolerate a document set to `exception` while it is running (its `setStage` writes `status='processing'` again)?
3. **Counts.** `batchView` derives counts from document states and a lateral join to `candidates`/`jobs`. Is `UNION ALL ... LIMIT 1` inside the lateral correct? Can a document be counted in zero or two categories? Is `complete` ever true while work remains, or false forever? Is "needs review" derived from the right field (`data->>'reviewState'`)?
4. **Refusal and duplicate bookkeeping.** In the `POST /api/documents` wrapper, the response is cloned and parsed to decide what to record. Is anything wrongly counted (for example a 429, a 503, a 413 raised before the body is read, or a throw inside the upload that becomes a 500 and is then counted as a refusal)? The file name comes from the client's `?name=` query parameter: is that a log/stored-data injection risk, and is it truncated and escaped sensibly? Is the 100-entry cap enforced without races?
5. **Admission and limits.** Review `createBatch` (file count, total bytes, daily and storage allowances). Is the declared total trusted too much (a client can declare small and send large; are per-file limits still enforced)? Can a client create unlimited open batches (is there a bound)? Does the existing rate limiter (`upload`: 40/min/user) make a 100-file batch impossible without client back-off?
6. **Retry semantics.** Only `PROCESSING_FAILED` is retried, bounded by `manual_retries`. Is that the right set? Is a retry idempotent with respect to records (can it publish a second candidate for one document)? Check `processDocument`'s idempotency and the publication transaction.
7. **Cancel semantics.** Are queue rows set to `cancelled` safe for `queueStats`, `usageOf`, the sweeper (`requeueSilent`) and any code that assumes queue status values? Is a cancelled document correctly dismissible and re-uploadable?
8. **Migration safety.** Is 016 additive, re-runnable, and safe on a live table (`add column ... references`, partial index)? Note: it has **not** been applied to the live dev project.
9. **Tests.** Do `batches.test.ts` and the added isolation checks genuinely test the claims, or only the happy path? Which behaviours above are untested? Do two of the tests seed rows directly via SQL in a way that hides a real defect? Note the deliberate non-test of worker restart and session expiry during a batch.

### A2. Added after the first review prompt (commit `cebd673`)
Read `activeBatchId`, `withUploadLock`, `assertNoActiveBatch`, `LockError`, `batchView` (`abandoned`/`complete`/`active`) in `server/src/batches.ts`; the single-upload path (`uploadOne`, `storeUpload`/`insertDoc`) in `server/src/index.ts`; `src/utils/batchUpload.ts`; `src/components/BatchPanel.tsx`, `DropZone.tsx`; the lock tests at the end of `server/test/batches.test.ts`; `server/test/batch-capacity.test.ts`.

14. **Lock correctness.** Is the lock genuinely race-free? `pg_advisory_xact_lock` is taken inside `sql.begin` through the tenant-scoped `beginAsTenant`: confirm the lock key, transaction scope and pool behaviour (does `hashtextextended` collide across users? does the xact lock survive until the insert commits?). The single-file path checks before reading the form and again in the insert transaction; the object is written to storage between them. Can a refused single upload leave an orphaned private object, and is that acceptable?
15. **Derived-lock edge cases.** `activeBatchId` (SQL) and `batchView.complete` (JS) must define "active" identically. Find inputs where they disagree (cancelled batch with running files, duplicates and refusals counted as accounted, lease boundary, clock skew between app and database `now()`).
16. **Abandonment lease.** `last_activity_at` is refreshed in `openBatchFor` per file. Can a slow client (large files over a poor link) be treated as abandoned mid-transfer and then continue sending into a batch whose lock was released?
17. **Permissions.** Batches are visible organisation-wide but only the creator or an `admin` can cancel/retry/close, and only the creator can add files. Are all routes consistent? Is there any route that leaks another member's file names (`refusals`, `failures`)?
18. **Front end.** `sendBatch` (window, lanes, busy waits, abort, 409) and the Dashboard wiring: stale closures, state updated after unmount, double submission, the polling loop (does it stop while hidden and resume?), unbounded growth of `batches` state, folder-drop traversal (`filesOf`) on large folders and browsers without `webkitGetAsEntry`.
19. **Capacity claim.** `docs/product/DELIVERY_BOARD.md` reports a single 500-file run (14.9 min, 1.8 s/file). Is the wording an honest scope of what was measured? What would invalidate it?
20. **Not built (do not review as missing defects):** portals, invitations, live updates/presence, ETA, completion dialog, 200-user benchmark. See the board.

### B. Honesty and process (second)
10. Compare `docs/product/DELIVERY_BOARD.md` against the code. Are any "verified" claims actually only read from code? Any claim stronger than the evidence?
11. Confirm EA1 is not wired into any application path and that E2/E3 are off by default (`server/src/version.ts`, `server/src/rules.ts`). Confirm the AI-assisted annotation v0.2 is labelled as such everywhere it is described.
12. Check that no secrets, original documents, `server/data/` or generated output are committed (`git ls-files`).

### C. Anything else material
13. Security or data-integrity defects you notice in files you touch while reviewing, even outside the milestone. Separate confirmed defects from suspicions.

## Method

Where possible, **reproduce** rather than infer: run `cd server && npx tsc --noEmit -p .` and `npx vitest run test/batches.test.ts test/isolation.test.ts` (these use a throw-away schema in the Supabase dev project through `server/.env`; if you lack credentials, say so and review statically). Prefer writing a failing test idea over a vague concern.

## Output format

1. **Verdict** in two or three sentences: is the milestone sound enough to build the browser half on top of?
2. **Findings table**: ID, severity (critical/high/medium/low), confirmed or suspected, file:line, what goes wrong with a concrete input or interleaving, suggested fix.
3. **Claims not supported by evidence** (list).
4. **Missing tests** (list, ordered by risk).
5. **Things done well that should be kept** (brief).
6. **Questions for the owner** that you could not resolve from the repository.

Do not pad. Do not restate the summary above. If you find nothing in a category, say "none found" and what you checked.
