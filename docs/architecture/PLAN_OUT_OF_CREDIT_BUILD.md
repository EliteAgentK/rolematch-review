# Build plan: out of usage credits, and no parser standing in for the AI

Written 10 November 2026 from the code at commit e46be05. Planned only: nothing here is built. The diagrams are in `PLAN_OUT_OF_CREDIT.md` (A: credit and lock, B: what a recruiter can still do, C: a CV in progress, D: where in the code).

## The rule (owner, 9 November 2026)

When the AI credit is used up, nobody can start new AI work: new uploads, read-agains and new matches answer **"Out of usage credits. Your administrator has been told."** Sign-in, viewing, notes, statuses, edits, shortlists and saved match scores keep working. The owner is warned at **R100 left** and again when the credit runs out. The parser never stands in for the AI.

## What the code does today (checked)

| Situation | Today | Where |
|---|---|---|
| Anthropic refuses for credit | the call returns "the AI's credit is used up"; nothing else changes | `ai/claude.ts:112` |
| Monthly safety cap ($25) reached | calls are refused with "budget is used up" | `ai/claude.ts:87` |
| A CV when the AI queue is full | the parser's reading is published | `aiRead.ts:27` |
| A CV the AI fails on twice, or out of credit | the parser's reading is published after the queue's attempts | `aiRead.ts:113` (`model-read:failed`) |
| Upload while out of credit | accepted; then as above | `index.ts:642`, `batches.ts` |
| Match while out of credit | saved as Scoring, queued, ends "Out of usage credits, so this match has no score" | `index.ts:827` `runMatch`, `aiMatch.ts:257` |
| Warning before credit runs out | none | |
| Credit balance | unknown to the platform (Anthropic has no balance API) | |

## Choices made in this plan (yours to change)

1. **The rand figure** comes from a rand-per-dollar rate the owner enters in the console with each top-up. No rate is assumed in code.
2. **The $25 monthly safety cap counts as out of credit:** same lock and message. It lifts by itself when the month turns or the cap is raised.
3. **Job "Read again" stays allowed:** it uses no AI (`jobReadAgain.ts`).
4. **Matches already queued** when credit runs out end as today, "Out of usage credits, so this match has no score"; the recruiter presses Match again after a top-up. CVs already uploaded wait instead (below), because the recruiter has nothing to press.
5. **A CV waiting for credit has no time limit.** It can be deleted, which frees its upload slot.
6. **Platform level only** (one shared Anthropic credit). Per-company allowances and the usage display stay on hold, but the lock records a scope so a company-level lock fits later without rework.

## Steps, in the order they will be built

Each step lands with its tests before the next starts.

### 1. Database: migration `044_ai_credit.sql`
- Table `ai_credit`, one row only (same pattern as `console_owner`): `balance_usd`, `balance_set_at`, `zar_per_usd`, `warn_zar` (default 100), `locked_at`, `lock_reason` (`credit_used_up`, `balance_used_up`, `monthly_cap`), `lock_scope` (`platform` now), `unlocked_at`, `set_by`.
- Row security on (the tenant test requires it). No grant to `rolematch_tenant`: the server reads it as the owner role (`platformSql`), like `ai_usage` totals.
- Console functions, security definer, granted to `rolematch_console` only: `console_ai_credit()` (balance, spent since set, left, rate, lock) and `console_set_ai_credit(balance_usd, zar_per_usd)` (also clears the lock and records who and when). Nothing else of the database opens to the console.
- Additive only: old code ignores the table, so a rollback needs no reverse migration.

### 2. Server: new `server/src/ai/credit.ts`
- `creditState()`: locked or not, reason, dollars left (balance minus metered cost since the balance was set), rand left, low or not. Read at most every 15 seconds per process, like `spentRecently`, so a busy server does not ask the database on every call.
- `lockCredit(reason)`: sets `locked_at` once (a second lock does nothing) and clears the cache at once in this process.
- `unlockCredit(by)`: used by the probe and by the console top-up.
- `OUT_OF_CREDIT` message text, `CreditLocked` error.

### 3. `ai/claude.ts`: no call while locked
- Before anything is sent: locked means refuse with a new reason `out_of_credit`. Nothing is metered, so there is no cost.
- Anthropic's "credit balance" error, the monthly cap, or dollars left reaching 0 after a call → `lockCredit(...)` and refuse `out_of_credit`.
- `ModelRefusal["why"]` gains `"out_of_credit"` (`ai/answer.ts`).

### 4. `queue.ts`: wait without using an attempt
- New `Postpone` error with a delay. `runOne` catching it sets the job back to queued with `run_after = now() + delay` and gives the attempt back (`attempts - 1`). It is not a failure, so no `:failed` handler runs and nothing is recorded as an error.

### 5. Reading: no parser fallback (`aiRead.ts`, `pipeline.ts`)
- AI queue full in `sendToAi`: instead of publishing the parser's reading, the document reader postpones 60 seconds (stage `audit_waiting`, card "Waiting for the AI").
- `model-read` refused `out_of_credit`: postpone 10 minutes, stage `audit_waiting`, card "Waiting for usage credits". The credit is checked when it comes round, so a top-up restarts it by itself.
- `model-read:failed` (Claude failed on every attempt): the document becomes an exception with code `AI_NOT_READ`, "The AI could not read this CV. Retry to ask again." Its parser draft stays on the row, never published. `retryBatch` (`batches.ts:220`) accepts `AI_NOT_READ` as well as `PROCESSING_FAILED`.
- `model-read-again` refused `out_of_credit`: postpone; the card stays locked as "being read again".
- Kept: where no AI is set up at all (`aiConfigured()` false: tests and development), the parser's reading is published and labelled, as today.

### 6. API: refuse new AI work up front (`index.ts`, `batches.ts`)
New answer: **402, code `CREDIT-001`**, "Out of usage credits. Your administrator has been told." Checked:
- `POST /api/batches` (new batch) and `POST /api/batches/:id/retry`.
- `POST /api/documents`: after the duplicate check, so the same file already uploaded still returns the existing document; refused for a new file and for re-sending a failed one.
- `POST /api/candidates/:id/read-again`.
- `POST /api/matches`: the saved score for this CV and job (`aiStartOf`'s lookup) is returned as now; with no saved score, 402 and nothing saved.
- `POST /api/matches/bulk`: saved scores returned, the rest come back marked "Out of usage credits" and are not saved or queued.
- `employment-review` re-scoring: pairs with no saved score are skipped while locked.
- `GET /api/capacity` gains `credit: { locked, message }`, so the board learns of a lock within its usual 5 to 15 seconds.

### 7. AI worker: the 10-minute test call (`worker.ts`, AI lane only)
- While locked with reason `credit_used_up`, every 10 minutes one tiny Haiku question (a few tokens, fractions of a cent, metered as platform use). An answer unlocks, so a top-up in the Anthropic console restarts everything without anyone pressing anything.
- Only the AI worker holds the key, so only it runs the probe.

### 8. Alerts (`opsHealth.ts`, `scripts/monitor.ts`)
- `judgeAi` gains the credit: rand left at or below `warn_zar` → degraded "AI credit is low: R… left (estimate)"; locked → unavailable "Out of usage credits since …". The notes that say "the parser and the rules carry on" are reworded, since they no longer will.
- The monitor already e-mails the owner and raises a console alert on any change of a health check, reminds hourly, and says when it clears. Only a title is added (`health:ai`: "AI credit low or used up").

### 9. Owner console (`console/`)
- Today page: a credit line with dollars left, rand left, "estimate" (evaluation runs from the Mac use the same key and are not metered on live), and the lock state.
- A small form, "Credit topped up": new balance in dollars and the rand rate. It goes through `console_set_ai_credit`, so the console still writes nothing else, and it clears the lock.

### 10. Screens (`src/`)
- `Dashboard.tsx` `refusalText`: `CREDIT-001` → "Out of usage credits" with the message, on upload, retry, read again and match.
- A banner while `capacity.credit.locked`, built like `ReadOnlyNotice`: "Out of usage credits. You can still view everything, including saved matches. Your administrator has been told."
- `DocumentProcessingCard.tsx`: `audit_waiting` shows "Waiting for the AI" or "Waiting for usage credits", with the waiting reason from the document; `AI_NOT_READ` shows "Not read by the AI" and Retry.
- Match screens: a pair with a saved score still opens; others show the message.

## Tests (written first, each failing before its change)
- `credit.test.ts`: balance and spend arithmetic, the 15-second cache, lock once, unlock, the cap lifting at month end.
- `claude` guard: no request leaves while locked; a credit error locks; nothing is metered when refused.
- `queue` postpone: the job is back with a later `run_after`, its attempt returned, no `:failed` handler.
- Reading: queue full waits; out of credit waits then reads after unlock; two failures → `AI_NOT_READ`; never a parser publish while AI is set up; parser-only where no AI is set up (existing tests stay green).
- API: each refused route answers 402 `CREDIT-001`; viewing, notes, statuses, edits and saved matches still answer 200; a duplicate upload still returns its document; bulk returns saved scores and marks the rest.
- Tenancy: `tenant-separation` stays green with the new table (row security on, nothing granted to tenants).
- Console: the two functions only; the console role still cannot read any company's rows.
- Health: `judgeAi` low and locked cases.
- Screens: the build, then the board in the browser with a locked test stack (banner, refusal message, card states).

## Release
1. Full server suite on the PC through the guarded test kit; frontend build; journeys.
2. Backup of live, then migration 044 applied to Supabase (additive).
3. Image built on the PC from the commit, `run.sh`, deploy log.
4. Low-volume checks on live: ready; the console shows the credit line ("balance not entered" until the owner enters it); no banner; one match with a saved score still opens. **The lock itself is proven on the isolated test stack, never by locking live.**
5. The owner enters the current balance and rate in the console.

**Rollback:** `run.sh` with the previous image (3db9bba). The new table is ignored by the old code.

## Not in this plan (on hold by the owner)
Per-company allowances, packages and the usage bar, billing, statements.
