# Verification record for commit a7d800b (2026-10-29)

**Full suite (`cd server && npx vitest run`, clean working tree, started 11:32):** 80 files: 77 passed, 2 failed, 1 skipped. 673 tests: **660 passed, 2 failed, 10 expected failures (kept), 1 skipped.**

| Result | Test | What it is |
|---|---|---|
| 10 expected failures | `known-failures.test.ts` R1, R2, R15–R20, R22, R23 | unresolved matching and parser defects; see `KNOWN_FAILURES.md` (several block use of live match scores for decisions) |
| **pending migration** | `schema.test.ts` "live Supabase project is in step with the code" | fails **because migrations 018, 019 and 020 are not applied to the shared development project**. It will pass once they are applied and verified; it is the check that stops the new code being used on the old schema |
| **unresolved performance failure** | `e2e.test.ts` CONCURRENCY at a pool of 3, bound 4 s | red; see INV-001 and R29. Unchanged and visible |
| 1 skipped | a pre-existing skip | not examined in this work |

**Added after a7d800b and run individually (not part of that full run):** `occurrences.test.ts` (1, passed; also shown to fail when the old key is restored), `capacity-property.test.ts` (3 seeds, passed), the polling negative control and the rest of `ratelimit-portal.test.ts` (8, passed). A full suite on the commit that contains them has not been run.

**Browser checks and the environment each used** (all against isolated schemas on the shared development database, never the shared project's own tables):
* `bv_check` (migrated through **020**, current code): two recruiters in one portal: capacity bar, both zones blocked at 500 of 500, slots held until the whole batch closed, release and convergence, e-mail and SAST attribution, per-person acknowledgement, colleague notice, no per-file pop-ups.
* `ui_check`, `verify_run`, `browser_check` (migrated only through **017/018**, earlier code): batch panel, refresh recovery, cancel, retry, completion summary, single-or-batch choice, animated upload card. These predate portals and shared capacity.
* **Not browser-checked:** the portal switcher, invitation acceptance (API-tested only), the page-limit messages other than the "page count could not be verified" case.

**The shared development project is NOT ready for the new functionality.** It is at migration 017. The new code requires 018 to 020; 019 changes data (see `PORTALS_AND_CAPACITY.md` section 4) and needs explicit approval. Do not start the new code against it.
