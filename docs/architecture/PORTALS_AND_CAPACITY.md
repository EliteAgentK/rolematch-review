# Portals, shared upload capacity and the batch lifecycle (as built, 2026-10-29)

Status words: **verified** = exercised by a passing test in an isolated database schema; **browser-checked** = also seen working in the browser; **pending** = not built or not verified. Nothing here is applied to the shared development project: migrations 018 to 020 are pending approval, and starting a server no longer applies migrations (`AUTO_MIGRATE`, tested in `migrate-startup.test.ts`).

## 1. Ownership
```
Organisation ──< Portal ──< portal_members (a person, a role) 
                   │
                   └── owns: documents, candidates, jobs, matches, batches, reservations, failure records, errors, queue jobs
```
* **Organisation-owned:** its settings, its list of portals, its people. Organisation membership grants **no** portal.
* **Portal-owned:** every recruitment resource above. Enforced three ways: the application checks `portal_members` on every request (the `x-portal-id` header is only a request); the database row rules need both `app.org_id` and `app.portal_id` (verified by `tenant-separation`, including a sibling portal in the same organisation and another organisation's portal named by mistake); composite foreign keys stop a row pointing across portals (verified by `migration-019.test.ts`).
* **User-private:** the browser's chosen portal and tabs (local). **Platform-owned:** reference data, the rules, the migrations.
* Existing data: migration 019 puts every current organisation into one "Main portal" with all its members (admin→admin, recruiter→recruiter, viewer→viewer) and assigns every row to it; nothing is deleted or moved between organisations (tested on pre-existing data). Rollback: `MIGRATION_019_020_ROLLBACK.md`.
* **Open decision (owner):** who may create portals. Today: an organisation administrator, for their own organisation. Who may create organisations: unchanged (self-service sign-up).

## 2. Capacity contract
* One allowance per portal: **500 document slots** (`PORTAL_SLOTS`), shared by every member, every document type (CVs and jobs), single uploads and batches. A single upload is a batch of one.
* **Reserve before accepting:** a batch's slots are taken all at once (all-or-nothing). Without a request key this is one statement: "add n to the portal's count if it still fits, and only then create the batch". With a key (the browser's submissions) a repeat returns the first reservation. Verified: 5×100 concurrent, 10×30 concurrent (shared across CVs and jobs), one person taking 500, six requests of 150 racing (exactly 3 admitted, 4 rounds), repeated key.
* **Held until the batch closes.** A document finishing, or its panel appearing, releases nothing (browser-checked: 500 of 500 stayed reserved while documents completed; released only when the whole batch closed).
* **Closing** requires: no admitted document is still being processed (so no late result can arrive), and every file is accounted for, or the batch was cancelled, or its transfer was abandoned (no file arrived within `BATCH_TRANSFER_LEASE_SEC`, 300 s; or its owner was removed). Human review never holds a batch open. The release is one statement that acts only on a batch still held, so it happens **exactly once** however many events, retries, restarts or servers ask (verified: 8 concurrent cancels, one release, one history entry; a background reconciler every 30 s closes anything whose event was missed, and also reports any difference between the counter and the held batches).
* **Terminal outcomes per file:** added; added with review flags; held for review (blocked before reading, e.g. page limit); failed; duplicate (already in the portal); refused at upload; left out before sending (by the browser); cancelled. The report reconciles to the files chosen (verified).
* **Retries:** automatic queue retries stay inside the reservation. A manual retry inside an open batch stays inside it; **after closure it needs a new reservation linked to the original** (`parent_batch_id`), refused with `CAPACITY-001` if the portal is full (verified). Manual retries are bounded (3 per file).
* **Cancel:** queued files stop at once; files being read finish and are kept; the reservation stays until they do (verified for both).
* **Not a concurrency limit.** Slots cap admitted work. How many documents are read at once is bounded separately (`WORKER_CONCURRENCY`, `PER_ORG_CONCURRENCY`; fairness between organisations is in the queue's claim). **Matching uses no slots** and is not blocked by a full allowance (verified); it has its own limits.
* **What the display promises:** the capacity bar shows the server's figures, refreshed every 15 s while the page is visible and nothing is moving, every 5 s while a batch is open (experiment X4, answers shared per portal for up to 5 s), backs off after errors or limits, and says "may be out of date" after 20 s without a refresh. The server decides every admission regardless. Not claimed: instantaneous agreement between browsers (there is no push channel yet; **live updates and presence are pending**).

## 3. Technology responsibilities (as built; challenged where evidence supports it)
| Layer | Owns | Not its job |
|---|---|---|
| TypeScript / Node | UI and API, authorisation (membership checks), orchestration, runtime validation, the deterministic scoring, queue handlers, rate limits, timing | durable truth |
| PostgreSQL (SQL) | ownership and memberships, row rules, composite integrity, the reservation counter and its atomic admission and release, batch and document states, audit entries | policy decisions and scoring |
| Configuration | slots, limits within platform ceilings, page limit, concurrency, retries, rate-limit thresholds (`config.ts`, `RATE_OVERRIDES`, organisation limits) | being edited without validation; weights and rubrics stay approved and versioned |
| Python | nothing in the application path; reserved for justified model training, evaluation or a specialist OCR worker | application policy or scoring authority |
No component was rewritten for language preference.

## 4. Migration review (018, 019, 020; none applied to the shared project)
| | What it changes | Data touched | Destructive? | Running application (old code) | Tested | Rollback |
|---|---|---|---|---|---|---|
| 018 | batch report fields; `error_occurrences`, `defect_groups` | none existing | no | old code ignores them | every test schema | drop the added objects |
| 019 | portals, memberships, invitations; `portal_id` on 10 tables; composite keys; row rules replaced by portal rules | **backfills every existing row into one Main portal per organisation** | no (nothing deleted or merged); makes `portal_id` NOT NULL | **old code breaks**: it inserts without a portal. Apply together with the new code | `migration-019.test.ts` on pre-existing data (2 organisations, mapping, no loss, cross-portal/cross-organisation foreign keys refused, rerun safe) | `MIGRATION_019_020_ROLLBACK.md` (merges portals into one view if a second portal has been used) |
| 020 | reservation columns, `portal_capacity`, acknowledgements | backfills existing batches as released | no | old code ignores | every test schema | drop the added objects |
| 021 | `members.can_create_portals` (default false) | none existing | no | old code ignores it | `portal-creation.test.ts` | drop the column |
| 022 | `outbox` table; invitation e-mail columns | none existing (existing invitations are marked `not_sent`) | no | old code ignores them | `invitation-email.test.ts` | drop the table and columns |
**There is no backup or point-in-time recovery on the development project** (`PRODUCTION_READINESS.md`). 019 changes data: it needs your explicit approval and a matching code deployment. A server restart will not apply it.
