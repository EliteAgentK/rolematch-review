# Design principles

Binding sources: [engineering handoff](../../CLAUDE.md), [owner brief](../architecture/DATABASE_BRIEF.md), [ADR-004](../architecture/ADR-004-own-data-platform.md). ADR-003 is historical for paid hosting and HA. Current development uses the PC and Mac at zero new spend. Purchased hardware is a separate future owner decision.

Preserve product rules 1–11: visible processing before publication, private originals, evidence-complete extraction, controlled edits and original evidence, recruiter notes and status, explicit matching, distinct evidence states, explainable confidence, actionable match details, human decision ownership and versioned policy. Database changes must preserve those contracts.

| Supabase lesson | Decision | Cost and risk |
|---|---|---|
| Standard Postgres and private file metadata | Keep SQL, constraints, RLS and metadata/bytes split | Operate backups and reconcile SQL/file failures ourselves |
| GoTrue password and session lifecycle | Reproduce observable contracts using proven libraries | Identity becomes RoleMatch's highest risk responsibility |
| Studio and advisors | Copy scoped views and actionable checks | Views and reveals require separate privilege tests |
| PostgREST, generic Studio, pooler, bundled services | Retire with provider | Fewer services, but every dependency must be inventoried |
| Rotating refresh and WAL recovery | Adopt with explicit concurrency and restore tests | Replay handling and retention require operational discipline |

Clever features should remove work. A single redacted event envelope avoids separate alert systems but needs audience checks. An immutable vault manifest makes recovery verifiable but costs disk and reconciliation. Transaction scoped tenant context reduces accidental leakage but remains dependent on trusted membership resolution. Prefer one runtime path and the same release images everywhere.
