# Integration contracts

Basis: ADR-004 §10 and existing adapters in server/src. Proposed interfaces; tests listed are required proof. Configuration carries endpoints, capabilities, limits and versions; secrets injected separately. No hardcoded machine addresses.

| Component | Protocol and consumer | Move or replace | Contract proof |
|---|---|---|---|
| Database | PostgreSQL 17 wire protocol, internal roles only | Restore to compatible instance; update private DSN | Same migrations, RLS and transaction tests |
| Identity | HTTPS API, signed JWT, JWKS and discovery metadata for approved consumers | Move issuer with DNS and keys; rotate with overlap | Issuer/audience, refresh, revocation and known password |
| Vault | Internal put/read/delete adapter, S3-compatible alternative | Copy verified manifest and change adapter config | Integrity, scope, deletion and range behaviour |
| API | Versioned HTTPS OpenAPI for authorised clients | Change base URL and verify compatibility | Schema and status-code fixtures |
| Queue | Internal claim/lease/ack contract backed by SQL | Preserve job IDs and drain or recover leases | Crash/retry cannot duplicate publication |
| Events | Versioned envelope, outbox and signed HTTPS callbacks | Replay from watermark with stable event IDs | Duplicate, reorder, timeout and signature checks |
| Console | Same authenticated API, owner host protected by Access | Update host and Access audience | Mask/reveal audit and phone/laptop journey |
| Backups | Encrypted pgBackRest repository plus vault manifests via restricted SSH | Transfer keys separately and restore in isolation | Measure consistent restore |
| Model | Private authenticated bounded inference requests; versioned input/output | Update private endpoint; preserve versions and backpressure | Timeouts, schema, isolation, no data in logs |

ATS, HR and job boards use organisation-issued, hashed API credentials with portal scope and explicit read/write grants, expiry, rotation/revocation, per-key and tenant quotas, and audited operations. Never grant underlying SQL credentials. Import JSON/CSV with explicit schema version, UTF-8 headers, stable external IDs, dry-run validation and per-record results; export paginated scoped data, prevent spreadsheet formula execution, exclude unapproved personal fields.

Shared event envelope: event_id, type, version, occurred_at, opaque scope, subject_id and safe validated payload; channel projections strip data by recipient permission. Outbound HTTPS signature covers raw body and timestamp using per-endpoint secret; bound replay window, dedupe IDs, enforce endpoint allow rules and block private destinations/redirect bypasses. Retry bounded with backoff, show undelivered state; consumers handle ordering by object version. Additive compatible changes in version; breaking changes require new version, published migration guide and overlap window approved before sunset.
