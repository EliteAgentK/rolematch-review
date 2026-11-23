# Testing

Basis: PRODUCTION_READINESS.md, RELIABILITY_SAFEGUARDS.md, migration corpus and existing isolated local test route. Pin image versions and fixture hashes. No test uses live credentials, real mail or live data; refuse unsafe hosts and storage paths before setup or teardown.

| Gate | Required proof |
|---|---|
| Shared legacy/new contracts | Same synthetic users, portal memberships, uploads, panel JSON, both match directions, reports, invites, audit, deletion and retry outcomes; explicitly document intentional session invalidation |
| Database isolation | Direct SQL under actual runtime roles, org/portal permutation, no context, forged IDs, reused pooled connections, background worker, API key, object and webhook checks |
| Identity | Existing bcrypt vectors on an authorised synthetic equivalent; wrong, expired and replayed secrets, concurrent verification, fifth/sixth attempts, refresh theft, session revocation, WebAuthn origin and counter behaviour |
| Vault and queues | Corrupt object, crash at each commit boundary, partial uploads, idempotency conflicts, job lease expiry, restart and cancellation |
| Owner security | Forged/expired Access JWT, wrong audience, owner singleton, unaudited reveal denied, logs/push contain no PII, CLI access separate |
| Recovery | Restore to disposable stack, verify RLS, tombstones, keys, row counts, file hashes and measured RPO/RTO |
| Playwright | Phone and laptop sign-in, invitation, upload progress, history, portal switch, original evidence, deletion, both matching directions; Console masked/reveal and outage states |
| Devices | Virtual authenticator in CI; physical iPhone and Android installation/push and real passkey rehearsal separately |

Run shared contracts on both isolated legacy Supabase and proposed PostgreSQL 17 plus local identity/vault during transition. Capture exact commit, fixtures, configuration, counts and timings. Change CI default only after parity; remove legacy credentials, stack fixtures, mocks and adapter tests at retirement. Run low-volume, non-destructive post-release health checks separately. Reproduce intermittent failures before calling them closed.
