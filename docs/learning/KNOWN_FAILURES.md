# Known failures (expected-fail tests) and what they mean for release

`server/test/known-failures.test.ts` holds each as a `test.fails(...)` that states the CORRECT behaviour. Today each one fails, which vitest reports as a pass. **A known failure is unresolved behaviour, not a passing test.** When a rule is fixed the test starts "unexpectedly passing" and must be converted to an ordinary test, so a fix cannot go unnoticed. The count (10 on 2026-10-28) must only change through that route.

The release impact column is Claude's assessment from the register entries; the owner decides what blocks a release.

| Test | Error register | What is wrong | Release impact (assessment) |
|---|---|---|---|
| R1 | R1 | "I have no experience with Kubernetes yet" earns credit | **Blocks** any use of live matching scores for decisions: a candidate's own denial counts as support. Safe for prototype demos only with this stated. |
| R2 | R2 | "I would love to learn X" in an objective earns credit | **Blocks** as R1: ambition counted as evidence. |
| R15 | R15 | The bullet layout of an advert changes the score for the same requirements | **Blocks** consistent scoring across organisations and adverts. Addressed by the offline Formula A (inactive), not by the live engine. |
| R16 | R16 | Ranking compares rounded percentages; ties fall to record id | Medium: unfair ordering between near-equal candidates; must be fixed or disclosed before ranked shortlists are shown to customers. |
| R17 | R17 | Equal evidence ranks by how well the document was read | Medium: scan quality influences ranking; disclose or fix. |
| R18 | R18 | An honest "not completed" ranks below silence | **Blocks** fairness claims: penalises honesty. |
| R19 | R19 | An unreadable line is assessed as absent | **Blocks** "absence is not proof" claim for scanned and photographed CVs. |
| R20 | R20 | An evidenced OR alternative in a years requirement earns half credit | Medium: under-credits some candidates. |
| R22 | R22 | The one-letter skill "R" is dropped | Low for the prototype, real for statistics roles; fix is small. |
| R23 | R23 | Dictionary replaces printed skill terms inconsistently (TCP/IP, UI/UX) | Low to medium: source wording is altered; needs the owner's normalisation policy (pending decision). |

**Overall:** the prototype can be demonstrated with these stated. None of the matching-score items (R1, R2, R15, R18, R19) is safe to present as a basis for decisions, and the claims register should not list "evidence-based" or "fair" as proven while they stand.


## Failing gate (not an expected-failure test): upload responsiveness at a pool of 3 connections
`e2e.test.ts` "CONCURRENCY: 12 uploads at once" (bound: slowest unrelated request under 4 s) **fails 4 of 5 runs** since the portal and reservation work, and is left unchanged and red. It passed 3 of 3 at the baseline commit. With a pool of 10 connections the same workload passes with a wide margin and the current build is faster than baseline (`concurrency-realistic-pool.test.ts`, added beside it). Cause supported but not proven; residual unexplained; see `docs/learning/investigations/INV-001-upload-latency.md` and R29. **Release impact:** affects how quickly ordinary requests are answered while a dozen files are being read **only when the database connection pool is very small**; it does not affect correctness. Decision needed from the owner: which pool size the gate should reflect.
