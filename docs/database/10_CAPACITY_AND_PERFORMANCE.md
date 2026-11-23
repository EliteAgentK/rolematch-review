# Capacity and performance

Basis: ADR-004, deploy/limits.sh, PORTALS_AND_CAPACITY.md; current pools reported as 9/3/2, verify effective settings. 16 GB Dell, 10 GB WSL cap, Mac model separate. Earlier ADR free-memory estimate and container subtotal use different scopes and are not interchangeable. Proposed WSL envelope: 2 GB Postgres including connections/cache allowance, 2 GB API/edge/queue, 3 GB bounded OCR, 1 GB backups/other services, 2 GB WSL/cache/headroom. Reserve remaining physical memory for Windows; measure peak RSS, swap, I/O and actual container limits. Reject admission before OOM.

Start with existing pools, sum across replicas and reserve administrative connections. Measure acquire time, transaction duration, lock wait and CPU separately; increase connections only if profiling supports it. Cap OCR/model concurrency independently. Prioritise interactive reads and fair scheduling between organisations; 500 reservations per portal is not processing concurrency. Use logged durable capacity records; an UNLOGGED counter cannot be the authority after crash.

Query/index candidates to prove on rehearsal with EXPLAIN (ANALYZE, BUFFERS): tenant portal board/filter and history on (org_id, portal_id, created_at DESC, id); queue claim on runnable status plus next-attempt time and stable ID, with tenant-aware scheduling; outbox due events on pending status and availability; evidence and match invalidation by document and version; sessions by digest/family and expiry. Map to existing indexes in 03 before adding, inspect selectivity and cost of writes.

| Concurrent virtual users | Rehearsal purpose |
|---|---|
| 1,000 | Mixed sign-in, board, upload, extraction, matching and reconnect with realistic think time |
| 5,000 | Ramp to find saturation, including unequal tenants and one full portal |
| 30,000 | Determine safe admission and recovery; distribute generators, never assume Dell can host the workload |

Use synthetic PDFs, Word, scans and photos; disclose workload mix, offered/accepted/completed rates, useful work versus throttles, queue age, p50/p95/p99, fairness, OCR/match accuracy slices, cross-tenant leaks and recovery time. Include warm/cold runs, model-on/off and sustained soak. Never load live. Proposed initial interactive p95 under 2 s at agreed workload, zero cross-tenant access, bounded backlog that drains after burst; no performance claim without evidence. Move worker first to second machine through authenticated private connection, then evaluate database standby independently; no exposed PostgreSQL port.
