# ADR-003: Running RoleMatch on our own servers (proposed)

Status: **proposed, awaiting the owner's and CIO's decision** (2026-10-23). The full plan for them, with costs, is a shared page (private link held by the owner). This record keeps the engineering substance with the code.

## Context

Production must not depend on Supabase being up (owner direction, 2026-10-23). The dev project is on Supabase's free plan: no backups, a small shared machine, paused after a week idle, community support only, and in Ireland (Supabase offers no African region). Already done at no cost: sign-in checked on our own server, and tests on a local database (`RESILIENCE.md`, steps 1 and 2).

## Proposal

PostgreSQL on two South African servers in two cities (main in Johannesburg, standby in Cape Town) at two different providers, with automatic switch-over by Patroni and a third small referee server (etcd, three-way vote) so the two can never both act as main. Asynchronous streaming replication between the cities. pgBackRest backups, encrypted with RoleMatch's key, to a third provider, with continuous log archiving (restore to any minute). Sign-in (Supabase Auth / GoTrue) and file storage (Supabase Storage) run on our own app server, so the code barely changes. Prometheus and Alertmanager for monitoring; Uptime Kuma for outside checks and a status page hosted elsewhere. The app connects with multi-host connection strings that pick whichever server is main (no load balancer needed). Disks and connections are encrypted, and databases are reachable only from our own servers.

All software is free and permissively licensed (PostgreSQL Licence, MIT, Apache-2.0, ISC). Deliberately avoided: MinIO, Garage and Grafana (AGPL), and Docker Desktop (paid for larger companies).

## Targets, to be measured in rehearsal before anyone is promised them

| Failure | Back in | Data that could be lost |
|---|---|---|
| One database server | < 1 min, automatic | none, or the last few seconds |
| A data centre or city | < 1 min, automatic | the last few seconds (asynchronous copy) |
| Both database servers | target < 4 h, from backup | up to about 1 min |
| App server | target < 30 min | none |

## Cost (planning estimates, ex VAT, R17 per US$, gathered 2026-10-23; to be replaced by quotes)

| Option | Per month |
|---|---|
| Our own servers, two cities (recommended) | R1,430 to R3,300 (with providers managing the operating system: about R3,000 to R6,500) |
| Managed PostgreSQL with standby, AWS Cape Town (fallback) | R3,300 to R4,100 |
| Managed PostgreSQL with standby, Azure Johannesburg | R4,500 to R7,000 |
| Supabase Pro / Team (still Ireland, still a single dependency) | R425+ / R10,200+ |

Line items for the recommended option: two database servers (4 vCPU, 8 GB) R400 to R900 each; referee R90 to R200; app server R300 to R700; backup storage R150 to R400; monitoring and status R90 to R200. Software licences: R0. Sources and caveats are on the shared page. Several figures came from comparison sites; the AWS standby figure is inferred as double the single-server price.

## Path

1. **Now (R0):** a live copy of the database we control, plus read-only mode during a Supabase outage (`RESILIENCE.md` step 3), rehearsed on the development Mac.
2. **Test servers in SA** (about R400 to R1,000 a month, for one to two months): build everything and rehearse switch-over, restore and deliberate server loss; measure the targets.
3. **Production:** two providers, two cities; move from Supabase and run both side by side briefly.
4. **Retire Supabase** for production.

## Consequences and risks

* The largest risk is people: someone must be reachable when an alert fires. A second person on call is required before production. Routine care is estimated at a few hours a month (updates, backup checks, a monthly restore rehearsal).
* Never write our own sign-in. Run the proven open-source server.
* POPIA: each hosting provider processes data on our behalf and needs a written agreement covering security and confidentiality. Keeping data in South Africa avoids cross-border transfer questions.
* There is no live client data yet, which makes this the cheapest moment to move.

## Decisions requested

Direction (own servers or managed first); budget; the second on-call person and the response time we can honestly offer; which providers to ask for quotes; whether the recovery targets are acceptable once proven.
