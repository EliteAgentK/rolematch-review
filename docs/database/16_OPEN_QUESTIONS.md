# Open questions

These are decision and proof gaps, not completed work.

| Open item | Evidence | Recommendation |
|---|---|---|
| Export and password compatibility | ADR-004 requires continuity; provider paths not exercised | Prove supported hash export and verification in rehearsal before scheduling cutover |
| Passkey portability | docs/security/PASSKEYS.md; relying party constraints | Preserve origin where possible, prove migration or plan re-enrolment |
| Cloudflare allowances and data transit | ADR-004; Access terminates at edge | Verify each free-plan control in dashboard and decide acceptable transit/residency before live |
| Offsite restore objective | Nightly PC/Mac scripts | Prove frequent consistent copy; accept site-loss limitation explicitly |
| Vault atomicity and deletion | Independent SQL and file writes | Use journal/reconciliation and restore tombstones |
| 14-day rollback | ADR-004 retention proposal | Approve forward recovery or rehearse complete reverse delta |
| Actual memory and concurrent workload | Brief and ADR figures differ in scope | Profile before promising throughput or purchasing |
| Tenant-policy gaps | Existing migrations and service-role paths | Inventory effective grants on isolated restored database |
| Console owner recovery, retention, audit | Brief requires singleton and masked reveal | Approve procedures and test lockout/recovery without secondary account |
| Model scheduling, data and capacity | ADR-004 §9 | Agree window and measure backlog, accuracy, memory and degraded behaviour |
| Push on devices, network outages | Existing notification docs; planned PWA | Test real phone devices; measure independent watcher limitation |
| External integrations and payload policy | ADR-004 §10 | Start with synthetic reference consumer; approve scope and retention before real data |
| Production hardware and mail limits | Single development PC; host quotas unverified | Measure then size; verify limits in writing |
