# Monitoring and alerts

How RoleMatch is watched, what each alert means and what to do about it. Set up 2026-11-03; live on the PC since 6 Nov 2026.

**Trends over time** (Prometheus, the Console's Trends page and slow-change warnings) and **load testing** (k6): `TRENDS_AND_LOAD.md`.

## Design
| Part | What | Why |
|---|---|---|
| The monitor | RoleMatch's own, `server/src/scripts/monitor.ts`, running as `rm-monitor` beside live on the PC | Replaced the first design (Gatus, trialled 3 Nov 2026 and never deployed, removed 23 Nov 2026): alerts go by RoleMatch's own mail host and into the owner's Console, which Gatus could not do |
| What it reads, every minute | the public address's `/api/ready`, and `/api/ops/health` (service token); and, where Prometheus runs, its firing trend warnings (`TRENDS_AND_LOAD.md`) | Built from what the server already records: the queue, the outbox, failure records, timings |
| Where alerts go | One e-mail to `OPS_ALERT_TO` (`server/src/opsNotify.ts`), sent directly, not through the outbox, because an alert matters most when the database is what is down; and an alert in the Console (Alerts) | The owner's own address and screen; never a third-party push service (owner, 5 Nov 2026) |
| The daily check | `deploy/pc/daily-check.sh` at 06:00, one e-mail listing everything as CURRENT or ATTENTION | Things that change slowly: updates waiting, backups and their copies, the restore drill |

**Monitor overhead:** every check shares one summary, cached for 10 seconds, so the database sees at most one measurement per 10 seconds however often it's polled. Measured: about 2 ms for a cached answer. The query is one grouped statement over the queue; it doesn't poll per organisation.

## `/api/ops/health`
- **Access:** `Authorization: Bearer <OPS_TOKEN>`, at least 32 characters. Anything else gets "not found", the same as a route that doesn't exist. Wrong tokens count toward the 5-per-15-minutes rule per address, and the limiter gets at most half a second, so the endpoint still answers when the database is down.
- **Generate a token:** `openssl rand -hex 32`. Keep it in the environment only, on the server and the monitor.
- **States:**
  - `healthy`: measured and fine.
  - `degraded`: measured, and getting worse or partly affected.
  - `unavailable`: measured, and not working.
  - `unknown`: **could not be measured**. This is never healthy, and it ranks above degraded.
- **Privacy:** counts, ages and states only. Organisation ids appear only for organisations that are behind, only here, behind the token: restricted operational metadata. Alerts carry the check's name and state change, nothing from a response.

## Checks, thresholds and what to do
All thresholds are configuration (`OPS_*` in `server/src/config.ts`), so they can be tuned from real use. The defaults below are starting values, **not measured from real traffic**.

| Check | Measures | Degraded | Unavailable | Window and sample | First steps |
|---|---|---|---|---|---|
| **Service reachable** | `/api/health` answers | | no answer, or slower than 5 s | each check | Is the process running? Check the host and its logs. Restart. If it restarts repeatedly, check the last deployment |
| **Ready for requests** | not shutting down, schema matches, not read-only | | not ready | each check | `/api/ready` gives the reason. `schema`: run the pending migrations. `read-only`: see Database. `draining`: a restart in progress; it should clear by itself |
| **Database** | a query answers | | no answer in 3 s | each check | Check the provider's status page (see the outage log in `PRODUCTION_READINESS.md`). Read-only mode serves the copy meanwhile. **The copy must be refreshed and migrated, see below** |
| **Reading queue** | oldest waiting document, per organisation; jobs that stopped reporting | 15 min; or some organisations behind; or a job silent for 5 min | 60 min, every organisation with work behind | live | Are readers running (`ROLE=api` needs `npm run worker`)? If one organisation only, it's probably a big batch; check its progress before acting |
| **Document failures** | unexplained failures against completed documents | 20%, or 5+ failures when too few documents for a rate | 50% | 60 min, at least 20 documents | `/api/errors` groups them by defect. Look at what changed. Expected refusals (wrong file type and so on) don't count |
| **Requests** | server errors and slowest 5% (this server only) | 5% errors, or 2 s | 25% errors, or 10 s | 15 min, at least 50 requests | Logs carry the request id. Check the database and the event loop |
| **E-mail** | oldest undelivered message; messages given up on | 15 min, or any given up | 60 min | live | Mail host status and limits (`docs/ops/MAIL_SETUP.md`). This alert must not travel by RoleMatch e-mail |
| **Server resources** | memory and event-loop delay (this server only) | 1.5 GB, or 500 ms | 3 GB, or 2 s | live | Restart if memory keeps climbing, and record it as a defect. The PC's disk and memory over time: Trends in the Console (`TRENDS_AND_LOAD.md`) |

**Alert behaviour** (`server/src/scripts/monitor.ts`, tested in `server/test/monitor.test.ts`):
- A problem is told once, by e-mail and in the Console, the minute it is found.
- A check that could not be measured ("unknown") is told only if the next minute cannot measure it either (R162: one slow answer once caused two alerts and two all-clears for nothing). Anything actually wrong is told at once.
- While it lasts, a reminder each hour; when it clears, one "back to normal" with how long it lasted.
- A release stops the monitor first and starts it once the API is ready, so a release's own restart is not reported as an outage (R164).
- **Not set up:** maintenance windows, and escalation to a second person, which needs that person's consent.

## What is still missing
1. **An independent place to run.** The monitor runs on the same PC as live, so it cannot report the PC itself failing (power, Windows, the home connection). The Windows watchdog (`deploy/dell/`) restarts Linux when it stops; nothing outside the house watches the PC.
2. **The real alert channel's reach.** Alerts arrive by e-mail. Attempted and accepted are known; whether a person read it is not.
3. **Customer-facing status page.** It would need separate hosting and must not show organisation details.
4. **Per-organisation request figures** aren't measured.
5. **Thresholds** are starting values, unproven against real traffic. The load test (`TRENDS_AND_LOAD.md`) is the first measurement of them under a crowd.
