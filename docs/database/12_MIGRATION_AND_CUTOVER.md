# Migration and cutover

Basis: ADR-004, docs/ops/DATABASE_TO_PC_PLAN.md (superseded where noted), migrations 001–034. Times below are rehearsal checkpoints, not promises. Rehearse twice from synthetic or explicitly authorised private copies, once with rollback. Import stable UUIDs, memberships, supported password hashes and private files; verify mapping, row counts, constraints, object counts/hashes, tombstones and environment isolation. Do not copy live tokens into test. Keep export and credentials encrypted, out of Git and logs.

| Relative minute | Action and stop condition |
|---|---|
| T−60 | Verify backup and tested rollback, disk headroom, pinned image, baseline health and operator readiness |
| T−15 | Notify users; stop admissions and drain jobs/outbox; pause deletes and writes through all entrances |
| T+0 | Record freeze watermark; final export and vault delta; keep legacy frozen |
| T+5 | Import delta, validate row/identity counts and hashes; do not route until done |
| T+15 | Run isolated canary with designated synthetic account, password, portal denial and file integrity checks |
| T+20 | Switch routes while writes remain closed; low-volume health and sign-in checks |
| T+25 | Decide go/no-go; open writes only when gates pass and rollback policy is accepted |
| T+30 onward | Observe errors, queue and mail; compare accepted writes and record release evidence |

Before first new write, revert routes to frozen legacy if canary fails. After first write, a frozen Supabase snapshot is not safe rollback. Keep it isolated for 14 days; rehearse reverse delta for identities, writes, deletions, files and outbox effects or explicitly choose forward recovery from the new platform after writes open. No blind failback, dual delivery or resurrection of deleted records. At day 14, confirm stable recovery, retire legacy credentials and adapters, remove old settings from runtime/CI, and expire retained personal data under policy. User notice: “RoleMatch is moving to a new sign-in system. Please sign in once more using your existing password.” Explain passkey re-enrolment only if necessary.
