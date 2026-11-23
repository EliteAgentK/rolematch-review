# RoleMatch Database Bible

Planning baseline: 6 November 2026. The checkout and numbered migrations describe intended/current code, not a verified live catalog. ADR-004 is proposed. All new settings, routes, schemas, timings and gates below are proposals unless labelled as existing.

Read [principles](01_PRINCIPLES.md), [architecture](02_ARCHITECTURE.md), [schema](03_SCHEMA.md) (real columns: [generated schema](03_SCHEMA.generated.md)), [security](04_ROLES_AND_SECURITY.md), [identity](05_IDENTITY.md) and [vault](06_FILE_VAULT.md) to understand the design. Then read [recovery](07_BACKUP_RECOVERY.md), [alerts](08_OBSERVABILITY_AND_ALERTS.md), [console](09_CONSOLE.md), [capacity](10_CAPACITY_AND_PERFORMANCE.md) and [testing](11_TESTING.md). Use [cutover](12_MIGRATION_AND_CUTOVER.md), [plan](13_PLAN.md), [interfaces](14_INTEGRATION.md), [machines](15_MACHINES_AND_SCHEDULING.md) and [open questions](16_OPEN_QUESTIONS.md) to review implementation decisions. **Read [the review](17_REVIEW_AND_IMPROVEMENTS.md) last: it records what was accepted and corrected, adds the console wire maps, and wins where it disagrees with an earlier document.**

| Term | Meaning |
|---|---|
| Organisation / portal | Customer boundary / narrower workspace inside it |
| RLS | PostgreSQL rules that decide which rows a database role can see or change |
| WAL / PITR | The database change log / restoring to a chosen point using that log |
| RPO / RTO | Maximum acceptable loss of recent work / time to restore service |
| Outbox | A durable record of a message to deliver after the business change commits |
| Vault | Private encrypted document bytes, indexed by database metadata |
| Access | Cloudflare's outer owner gate, separate from RoleMatch sign-in |
| Rehearsal | A disposable deployment with its own database, files, keys and mail sink |
| Fencing | Making sure only one system can accept writes |
