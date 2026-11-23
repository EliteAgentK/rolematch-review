# File vault

Basis: ADR-004; migrations 001–034 (see [schema](03_SCHEMA.md)); existing storage adapter. Proposed, unverified. Use a private volume, immutable random object IDs under org/portal/document/version namespaces; names and MIME metadata live in authorised rows, never in filesystem paths. Reject traversal, symlinks and unsupported formats; bound bytes, decompression, pages processed concurrently and reader resources. No direct web-server mount.

Encrypt volume and backups; evaluate per-object envelope encryption with an established authenticated encryption library, unique nonces and key versions. Store keys outside the volume and database; rehearse rotation and recovery. Record size and SHA-256 of the original; verify on ingestion, restore and periodic sampled reads; authenticate ciphertext before serving. A checksum is not access control.

Upload to temporary storage → verify and fsync → atomically rename on the same filesystem → commit ready metadata and queue event in one SQL transaction. SQL and disk are separate failure domains. An idempotent reconciler removes abandoned staging after a grace period, reports missing committed objects, and never serves a pending object. Retain state and checksums for retry; never overwrite the previous version.

View-original checks current membership, portal and object version, then issues a short-lived purpose-bound signed reference (proposed 60 seconds); redemption repeats authorisation, rejects deleted versions and uses private/no-store responses. Support PDF ranges with renewed authorisation; no tokens in logs, URLs in referrers or notifications. Exported S3 adapters must meet equivalent revocation semantics via the API gateway.

Deletion tombstones first, revokes reads and cancels related jobs, then purges files, derivatives and indexes with retry and verification. Preserve minimal deletion markers until every restorable copy expires. Restores replay deletion markers before exposure. Pair file snapshots and checksums with the database recovery manifest; quarantine inconsistencies and restore only matching generations.
