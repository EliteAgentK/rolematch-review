# Delivery plan

Basis: ADR-004 and the evidence in 02–16. Effort is engineering days, excluding owner decisions and hardware acquisition; estimates unverified.

| Phase | Work and dependencies | Effort | Acceptance | Rollback |
|---|---|---:|---|---|
| 0 Baseline | Pin current image, inventory schema, sessions, roles, query traces and storage | 1–2 | Reproducible contract baseline | No runtime changes |
| 0b Cloudflare | Owner creates the account and moves rolematch.co.za; named tunnel, TLS, WAF, rate rule, no caching of /api, CF-Connecting-IP trusted only through the tunnel (ADR-004 phase 1; restored by the [review](17_REVIEW_AND_IMPROVEMENTS.md) §3.4) | ½ + owner | Outside checks; origin unreachable directly | Point the tunnel back at the quick address |
| 1 Database | Reproduce migrations on local PG17; role/RLS hardening and durable reservations | 3–5 | Privilege matrix and isolation suite | Discard rehearsal target |
| 2 Identity and vault | Implement adapters and importer, rehearse password preservation and crash boundaries | 5–9 | Parity and recovery suite | Keep legacy routing |
| 3 Recovery and console | Backup verification, console owner gate, audit, push and alerts | 5–8 | Restore and device proof | Feature off; retain audit |
| 4 Performance and integration | Instrument queues, run capped loads, version contracts and webhook tests | 3–6 | Workload and security gates pass | Keep prior release |
| 5 Cutover | Rehearse freeze, rollback, then separately authorised activation | 2–4 plus observation | Data reconciliation and smoke | Follow 12 |
| 6 Retirement | Observe 14 days; retire Supabase and prove one runtime path | 1–2 | Secrets revoked; clean dependency/CI scan | Delay retirement if gates fail |

Owner decisions: approve independent recovery targets before promises; choose post-write forward recovery unless reverse sync is demonstrated; reconcile Cloudflare transit with residency expectations; approve retention/reveal policy; keep public integrations scoped and gated; buy production hardware only once measured workload sets requirements. Risks in order: loss during rollback, tenant leak, unsupported identity export, PC failure, capacity under mixed workload. Proceed first with isolated rehearsal; no live changes authorised by this bible.
