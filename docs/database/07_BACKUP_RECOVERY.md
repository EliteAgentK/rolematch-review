# Backup and recovery

Current evidence: deploy/pc/backup-nightly.sh (01:30 SAST, 14 days), deploy/mac/collectBackups.sh (03:00 collection); no restore proof established. Proposed: pgBackRest, whose [official guide](https://pgbackrest.org/user-guide.html) documents physical backup and WAL restore (reviewed 2026-11-06). Prefer its local repository and explicit restore workflow; WAL-G is viable if object storage becomes the chosen target. Verify exact pinned build and licensing before implementation.

Enable archive_mode with pgBackRest archive-push, monitor archive lag and disk, and tune archive_timeout on rehearsal. Daily differential, weekly full, continuous WAL, retain at least two usable full chains and validate coverage of the 14-day window before expiration. No independent age-based deletion of needed WAL. Keep encrypted, checksum-verified copies on PC and Mac; Mac initiates restricted SSH pull. Nightly copying alone can lose a day if the PC dies: design frequent WAL, vault and deletion-ledger replication with lag alarms before claiming minutes of RPO. Keep recovery keys separate and recoverable.

| Failure | Response |
|---|---|
| API or worker crash | Restart pinned image; recover leases; verify no duplicate publication |
| Database corruption or bad migration | Freeze writes, preserve evidence, restore to isolated target before error, replay permitted changes and tombstones, verify before routing |
| Lost vault file | Quarantine affected record, restore matching version by checksum, rerun only missing work |
| Lost PC or disk | Restore from Mac to compatible replacement; no failover exists |
| Lost Mac | Stop training, retain PC backup, re-establish encrypted independent copy and verify |
| Archive stalled or disk full | Alert, throttle or freeze admissions; protect WAL; never delete WAL manually to free space |
| Leaked key | Revoke, rotate, investigate access, rewrap and verify backup decryptability |
| Lost site, power or ISP | Report outage independently if available; PC and Mac together cannot survive site loss |

Proposed gates: DB and vault recovery point within 15 minutes for independent copy; restore in 2 hours on available hardware (replacement acquisition excluded and reported separately). Measure time from last consistent recoverable commit and from incident declaration to verified service. Drill monthly and before cutover: restore latest, point-in-time before deletion, missing-object and total-machine-loss scenarios; verify identities, RLS, counts, sampled hashes and tombstones before exposing routes. Record actual loss and elapsed time, never report a backup as a successful restore.
