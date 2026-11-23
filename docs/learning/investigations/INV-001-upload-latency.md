# INV-001: upload latency after portal reservations (linked: R24, R27, R29)

This record follows the standard for significant defects: symptom, suspected cause with evidence, a testable hypothesis, the smallest change, before and after, regression checks, decision and what stays uncertain. It states what was **ruled out** as well as what changed. Nothing here is a proven root cause unless it says so.

## 1. Symptom and reproducible case
"12 uploads at once" (`test/e2e.test.ts` CONCURRENCY; `test/perf/upload-latency.perf.ts` for measurement) took about 20 s at commit 251b47f and 27 to 35 s after the portal and reservation work; the bound on the slowest unrelated request (4 s) failed in 2 of 3 runs. A single `(first)` measurement is not trusted: the first repetition after a server start is slower for baseline and current alike.

## 2. What was ruled out, and how (instrumented build, 12 uploads, 5 repetitions)
| Candidate cause | Evidence | Verdict |
|---|---|---|
| Event-loop pressure in the server | event-loop delay p99 12 ms, max 16 to 50 ms in every repetition | **ruled out** |
| Lock waiting in admission | the single-statement reservation (`upload.reserve`) holds no lock; its time tracks the connection wait, not a lock | **ruled out** for the current build; it **was** the cost of the earlier lock design (R24, R27) |
| File transfer and storage | `upload.storage_put` p50 0.29 to 0.41 s, form parse 0 to 2 ms | **ruled out** as the main cost |
| Parser/OCR/model work | `process.reading_to_published` p50 1.8 to 3.3 s; no OCR or model in these files; it does not change between versions | **not the regression** (cost is the same in both) |
| Machine contention / harness overhead | load average 1.0 to 2.2 across runs; DB round trip 185 to 225 ms; interleaving baseline and current cancels slow drift | **bounded, not eliminated**: rep 0 and one load spike (2.2) are visibly slower |
| **Waiting for a database connection** | `db.pool_wait` p50 390 to 712 ms, **p95 2.0 to 3.0 s**, against `db.exec` (the work itself) p50 about 200 ms (one round trip); about 14 connection acquisitions per document through a pool of 3 | **supported** (see 3) |

## 3. Hypothesis and test
**H1 (supported, not yet proven as the only cause):** wall time scales with the number of database statements per document, because the test server has a 3-connection pool and every statement queues for a connection. The reservation and release added about 2 of roughly 14 acquisitions per document, which predicts about +14%; the measured warm difference was +12 to +15% (baseline median 13.8 s, current 15.2 to 16.2 s).
**Smallest targeted change:** `usageOf` ran three separate queries per upload (one pool turn each); they are now one statement. Prediction: about 2 fewer acquisitions per document (167 to about 143 per 12 documents) and wall time back inside the baseline spread. The reservation logic was **not** changed for this.

## 4. Results (equivalent workload, interleaved with the baseline, same machine and database; warm = repetitions after the first)
Database round trip 185 to 209 ms throughout; load average 1.0 to 2.3. Spread is shown, not only the best run.

| Condition | Version | Warm wall time to publish all 12 (s) | Upload request, median (s) | Slowest unrelated request (s) |
|---|---|---|---|---|
| Pool of 3 (the suite's usual) | baseline 251b47f | 13.5, 13.8, 14.0, 17.3 (n=8 over two rounds: median 14.9) | 4.4 to 5.6 | 1.7 to 3.3 |
| Pool of 3 | current, before the change | 14.8 to 16.2 (n=6, medians 15.2 and 16.2) | 5.8 to 5.9 | 1.9 to 3.4 |
| Pool of 3 | current, after merging the usage queries | 13.4 to 18.7 (n=8, median 16.2) | 3.5 to 3.9 (about 25% lower than baseline) | 1.9 to 4.5 |
| **Pool of 10** | baseline | 8.6, 9.3, 9.5, 10.5 | 1.7 to 2.3 | 1.6 to 2.1 |
| **Pool of 10** | current, after the change | **7.1, 7.4, 8.3, 9.2** | **1.5 to 1.7** | 1.6 to 2.3 |

Connection acquisitions per document (from `db.pool_wait.n`): about 14 before the change, **11.4 to 12.3 after** (prediction was about 12). With a pool of 10, `db.pool_wait` p50 is 0 and p95 22 to 205 ms: the waiting disappears. With a pool of 3 it was p50 390 to 712 ms and p95 2.0 to 3.0 s.

The original gate, `e2e.test.ts` CONCURRENCY (pool of 3, bound 4 s), after the change: **failed 4 of 5 runs** (4.2, 4.4, 5.5 and 7.6 s; one pass at 3.8 s). Before the change it passed 1 of 3. At baseline it passed 3 of 3 (2.3 to 3.2 s). The new test with a pool of 10 (`concurrency-realistic-pool.test.ts`) **passes** both repetitions.

## 5. Decision and remaining uncertainty
* **Accepted:** merging `usageOf` into one statement. It removes about 2 of 14 connection turns per document and made the upload request itself faster than the baseline's. It changes no limit or policy. Regression checks: `documents`, `capacity`, `batches` tests pass.
* **Supported, not proven:** the slowdown seen at a pool of 3 is connection contention. Evidence: pool wait dominates the stage times at 3 connections and vanishes at 10; the effect size matches the statement count. What is **not** explained: at a pool of 3 the current build still shows a wider spread than the baseline and fails the unchanged gate in most runs, although it uses fewer connection turns per document than it did before. That residual is unexplained.
* **Ruled out:** event-loop pressure, lock waiting in the present design, file transfer and storage, and the parser. Do not re-test these without new evidence.
* **Gate:** unchanged and **failing** at a pool of 3. It is retained as a failed gate; a second gate at a realistic pool is added next to it, not instead of it. Whether the suite's 3-connection pool is the right condition to gate on is the owner's decision.
* **Next hypothesis (H3, untested):** giving background work its own small connection pool, so ordinary requests never queue behind worker statements, would bring the pool-of-3 case back inside the bound. It also matches the requirement not to let background processing starve interactive work. Not implemented: it changes the database layer and needs its own measurement.
* **Not measured:** a production-sized deployment, a different database latency, OCR or model workloads. Nothing here is a capacity claim.

## 6. Detection gaps found along the way (also recorded in the error register)
* The responsiveness gate had about 0.6 s of headroom at baseline (cold start alone reached 3.4 s): it will fail on noise and on small real regressions alike. Now measured, with the spread, by the harness.
* The failure recorder swallowed an error silently after migration 019 changed a key it relied on (R28): detected only because a test asserted on its output. It now counts its own failures (`/api/health/details` `errorRecording`) and the tests assert that count is zero.


## Corrections after review (2026-10-29)
* **Causation.** "Connection contention" is **supported, not proven**. What the instrumentation separates: `db.pool_wait` (time to get a connection), `db.exec` (time holding it: one round trip, about 200 ms, plus the role switch), the upload stages, queue wait and processing. What it cannot separate: network latency from database execution inside `db.exec`, or whether a slow request is slow because of waiting or because of work on another request. The only causal evidence is the pool-size change (3 to 10) removing the wait and the slowdown together, in a single environment and on one workload; that fits contention but is an association, and it does not explain the residual at a pool of 3.
* **Supported deployment configuration.** The default pool is **8 connections per server process** (`DB_POOL_SIZE`), not 3. The 3-connection pool is the test suite's own choice (so many test servers can share one small database). The original pool-of-3 gate is kept, visible and **red**; the pool-of-10 test is *additional* evidence about a realistic pool and replaces nothing. Resource implication of a pool of 10 or more: up to that many database connections per server process and per worker process, which counts against the database's connection limit (the shared development project's limit is small and was the reason for the small test pool). Capacity planning for production connections has not been done.
* **The polling test.** An earlier note said the repeated identical failure "showed the failure was in the test". That was too strong: a repeat only shows the failure was deterministic for that pacing. The actual reason: the test sent 340 requests over about 50 seconds and expected a limit of 300 a minute to trip, but the limiter is a weighted sliding window over minute-aligned windows, and a stream spread across a boundary peaks near 270 on that estimate, so it was never excessive by this limit's own arithmetic. The corrected test sends a real burst (700 requests, 100 at a time) and passed 3 of 3 runs; a **negative control** (40 requests at the page's own pace) shows ordinary polling is never limited. The assertion was not weakened: it still requires at least one 429 for a genuinely excessive burst.
