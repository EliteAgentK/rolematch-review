# Roles and security

Baseline: migrations 012, 014, 019, 030; server/src/db.ts. PostgreSQL 17 row security reference checked 6 November 2026: https://www.postgresql.org/docs/17/ddl-rowsecurity.html.

| Role | Grant | Boundary |
|---|---|---|
| rm_app LOGIN NOINHERIT | SET ROLE tenant; explicit identity/claim function grants | No ownership, BYPASSRLS, superuser or migration credentials |
| rolematch_tenant NOLOGIN | Explicit scoped CRUD, audit insert/read only | RLS USING and WITH CHECK on org and portal; missing scope denies |
| rm_migrate | DDL through dedicated deployment principal | Offline use only; separate non-login object owner |
| rm_backup | Physical backup agent under database OS account or dedicated backup transport | Restore only in isolated target; no app credential |
| rm_console_read | SELECT allowlisted masked projections | No secret columns, raw file access, generic SQL or DML |
| rm_break_glass | Root-controlled recovery procedure | Local named operator, explicit audit, no general console bypass |
| rm_dispatch | Claim IDs and leases through narrow routines | Re-enter tenant scope for payload and writes |

Use transaction-local SET ROLE and parameterised set_config for both scopes on the same checked-out client. Resolve membership before setting scope. Reject stale portal grants. Keep composite foreign keys as a second barrier. Test FORCE RLS selectively after assigning explicit internal policies so workers remain functional. Harden any privileged routine with fixed search_path, schema qualification and explicit EXECUTE grants. Prevent direct use of the audit scrub switch by runtime roles.

| STRIDE | Attack surface | Control and proof |
|---|---|---|
| Spoofing | Forged Access identity, JWT, SSH key | Verify assertion signature, issuer, audience, expiry and owner identity; test direct/spoofed ingress |
| Tampering | Wrong portal ID, edited token, swapped vault bytes | Scoped constraints, authenticated encryption, scoped grants; corrupt a fixture |
| Repudiation | Hidden console or CLI writes | Named principals, append-only audit, redaction exception through audited procedure |
| Information disclosure | Leaked CV, log, cache or backup | Masking, no-store, encrypted backups, scoped reveal; cross-tenant and header tests |
| Denial of service | Guessing, upload flood, exhausted pool | Durable rate budget, queue backpressure, per-tenant limits and resource caps |
| Elevation | Runtime table owner, generic console SQL, forged role | Separated credentials, allowlisted actions and negative grants tests |

Cloudflare proposal from ADR-004 §§3,8. Verify in the dashboard for **each** of DNS/tunnel hostname availability, TLS options, WAF managed rules, custom rule count, rate-rule count and fields, bot features, cache rule quota, Access seats/log retention, upload limit and timeout. Preserve MX/TXT/DNSSEC during zone migration. Use named tunnel, edge HTTPS and validated origin TLS where configured (Full strict when origin HTTPS is used); loopback-only clear HTTP requires explicit local threat acceptance. Route only exact hosts. Bypass caching on /api, authenticated pages, SSE and original files. Target the available edge rate rule at secret-guessing routes where plan supports it; server remains authoritative across all such routes. Validate Cloudflare assertion at console origin using the [Access JWT documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) (checked 6 November 2026). Trust CF-Connecting-IP only on authenticated tunnel ingress. Use owner-only Access policy, no bypass rule.

Root-owned secret files and narrow read-only mounts; separate JWT, code HMAC, vault, backup, webhook, tunnel and VAPID keys. Keep key IDs and encrypted recovery copies separately from data. Rotate by introducing new key, validating dual-read/one-write, then retiring after the last dependent token or backup expires. Compromise triggers immediate revoke and reissue. Verify Cloudflare cross-border processing implications before migrating document traffic.
