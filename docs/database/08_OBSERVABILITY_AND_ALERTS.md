# Observability and alerts

Basis: docs/ops/MONITORING.md, docs/architecture/NOTIFICATIONS.md, migration 018 and existing readiness/outbox. Proposed owner-only events with coarse counts and allowlisted identifiers. No CV text, names, addresses, secrets or raw exceptions.

| Event | Severity | Owner wording | Channels |
|---|---|---|---|
| API unavailable or readiness failed | Critical | RoleMatch is unavailable / cannot accept work | Feed, push, email |
| Tenant boundary probe fails or owner security event | Critical | An access check failed. Investigate now. | Feed, push, email |
| Backup stale, restore drill fails, WAL backlog | Critical | Recovery may be behind. Check Backups. | Feed, push, email |
| Disk approaching configured limit | Warning; critical at write risk | Storage is nearing its limit. | Feed; push/email at critical |
| Queue age, model unavailable, unusual error rate | Warning | Processing is delayed. Check Processing. | Feed; push after sustained breach |
| Mail delivery failures or aged outbox | Warning | Some messages are delayed. | Feed; push after sustained breach |
| Signup, organisation created, membership changed | Info | New account activity. Open Console to review. | Feed; optional digest |
| Configuration change, restore or deployment completed | Info | A system change was recorded. | Feed |
| Condition clears | Recovery | Back to normal: {component}. | Same channels previously alerted |

Proposed owner_events: immutable occurrence ID, safe type/version, severity, component, correlation ID, optional opaque scope, timestamp and validated safe payload. Incident projection tracks fingerprint, first/last seen, count, state and acknowledgement; outbox tracks delivery independently. Deduplicate by condition/scope; acknowledge does not resolve; confirm recovery over multiple checks. Initial defaults: reminder after 30 minutes for unacknowledged critical events; 22:00–07:00 SAST quiet hours suppress warnings, never critical; log notification failures without recursive alerts.

Advisors: TLS expiry, RLS coverage and privileged role drift, tenant isolation synthetic probes, backup age/restore age, queue lag and oldest work, disk, WAL, slow queries, DB pool saturation, worker/model heartbeat, mail/outbox lag and clock drift. Run on bounded intervals with cheap probes; external outage visibility is unavailable if monitor shares PC/ISP failure. Deep links point to authenticated console, no sensitive data in push payload.
