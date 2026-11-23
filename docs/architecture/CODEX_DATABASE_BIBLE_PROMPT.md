# Prompt for Codex: write the RoleMatch Database Bible and its plan

Copy everything below the line into Codex, opened at the root of this repository.

---

You are planning, not building. Write the **RoleMatch Database Bible**: the complete, buildable specification and plan for RoleMatch's own data platform and the owner's database console. Write nothing outside `docs/database/`; change no code, settings or migrations; touch no running service. Claude (the other engineer on this project) will review your plan and improve it, so mark every assumption and every question openly. Never present a guess as a fact.

## Read first, in this order

1. `CLAUDE.md`: product rules (non-negotiable behaviour 1–11, the target service boundary, how to work here).
2. `docs/architecture/DATABASE_BRIEF.md`: every constraint, what exists, what is open.
3. `docs/architecture/ADR-004-own-data-platform.md`: the proposed design (own PostgreSQL 17 on the PC, our own sign-in and file vault, Cloudflare in front, the owner-only RoleMatch Console, phases).
4. `docs/architecture/ADR-003-self-hosting.md`, `RESILIENCE.md`, `PORTALS_AND_CAPACITY.md`, `RELIABILITY_SAFEGUARDS.md`, `NOTIFICATIONS.md`, `PRODUCTION_READINESS.md`, `ARCHITECTURE.md`.
5. `docs/ops/LIVE_ON_PC.md`, `docs/ops/DATABASE_TO_PC_PLAN.md` (partly superseded), `docs/ops/MONITORING.md`, `docs/security/PASSKEYS.md`.
6. All 34 files in `supabase/migrations/`, the source of truth for today's schema.
7. In `server/src/`:
   - `supabase.ts` (every Supabase call; the seam to replace), `auth.ts`, `tokens.ts`, `passkeys.ts`;
   - `db.ts` (tenant switching with `rolematch_tenant` and `app.org_id`), `queue.ts`, `outbox.ts`, `ratelimit.ts`, `deletion.ts`;
   - `localVault.ts`, `originalsCopy.ts`, `opsHealth.ts`, `opsNotify.ts`, `scripts/monitor.ts`, `schema.ts`, `editPolicy.ts`, `config.ts`.
8. `deploy/` (`limits.sh`, `mac/run.sh`, `pc/backup-nightly.sh`, `pc/daily-check.sh`, `mac/collectBackups.sh`) and the visual identity in `src/theme/` and `src/components/`.

## What the owner wants, in their words

- "Our very own fully functional live database." Our own infrastructure, no paid services to scale: "it doesn't have to be complicated, but it needs to be very, very clever."
- "Study the current Supabase architecture related to our system and in general, and use it to spark ideas." Then Cloudflare goes in front as the security layer.
- "It must be very easy for me to navigate through my database, but very informative." It must carry the RoleMatch identity.
- "There can only be one email and password, only one. I'm the only one allowed in there," plus Claude while working. Per ADR-004, Claude works through the PC's command line, never a console account.
- "I should be able to access the database from both phone and laptop. It needs to have notifications live to me: errors, alerts, the works, users, etc. But it needs to be beautifully simple."
- "A full database bible and planning, from specifics to diagrams and wire maps. Don't leave anything out. I need this built perfectly."
- "RoleMatch needs to be easy to integrate elsewhere, every component."
- The single PC is acceptable "for development". A server will be purchased before production, so the design must move to that server as a copy, not a rebuild.
- The system must be tested, the database developed and the model fine-tuned, "all at optimal". The PC (WSL 10 GB, no usable GPU) does live, database development and testing. The Mac (Apple M5, 16 GB) does the live model and fine-tuning, which clash, so training runs in a scheduled window (ADR-004 section 9).

## Hard constraints (from the owner and the project; do not relax any)

- **Cost and licences:** zero spend. Only free, permissively licensed software (PostgreSQL, MIT, Apache-2.0, BSD, ISC); no AGPL. Cloudflare's free plan only.
- **Where things run:** everything on the PC (Dell Precision 5820, 16 GB RAM, WSL 2 limited to 10 GB, Docker). The Mac holds only the model and the backup copy. Nothing listens beyond 127.0.0.1 except SSH from the home network.
- **Tenant isolation stays enforced by the database** (row level security, `rolematch_tenant`, `app.org_id`), not only by code. Never disable RLS or relax permissions to make something work.
- **Sign-in security:**
  - use proven libraries for hashing, signing and WebAuthn; write no cryptography;
  - at most 5 attempts per 15 minutes for anything that guesses a secret;
  - never log codes, passwords or tokens;
  - existing users keep their passwords through the move.
- **The console:**
  - exactly one owner account, enforced by the database;
  - Cloudflare Access in front;
  - every change goes through the API's rules and audit (no back door);
  - personal details masked by default, with a reason recorded on reveal (POPIA);
  - push notifications contain no personal data.
- **Privacy:** real CVs and personal data never go into Git, ordinary logs, reports or external services. Retention, permanent deletion and backups must be consistent with each other.
- **One path:** tests run on the same kind of database that live runs. When Supabase is retired, its code and settings are removed completely.
- **No promises without proof:** nothing is called secure, highly available or production-ready without proof. A single PC is a single point of failure; say so.
- **Live's limits:** live is never used for tests or load. Production checks are low volume and non-destructive.
- **Every component can be integrated or replaced** (ADR-004 section 10):
  - one documented interface per component, using open standards where one exists (PostgreSQL protocol, JWT, JWKS and OIDC-style discovery, OpenAPI, an S3-compatible store adapter, signed webhooks);
  - settings only in files, nothing tied to a machine;
  - the same images run on the PC, the purchased server or a customer's cloud.

## Deliverables (in `docs/database/`, Markdown, with Mermaid for diagrams)

1. `00_INDEX.md`: map of the bible, reading order, glossary in plain English.
2. `01_PRINCIPLES.md`: the design rules and the reason for each, with what was learned from Supabase (keep, copy, drop) and the "clever" ideas, each with its cost and risk.
3. `02_ARCHITECTURE.md`:
   - a context diagram, a container diagram (PC, Mac, Cloudflare), the network and port map, and the trust boundaries;
   - the data flow for each of: upload, extraction, match, view original, delete, sign-in, refresh, reset, passkey, console view, alert.
4. `03_SCHEMA.md`:
   - every table (today's 34 migrations plus the new ones);
   - for each table: columns, types, keys, indexes, constraints, row-security policy, owner role, retention, personal-data class;
   - a full ER diagram, plus one per area;
   - a migration plan from `auth.users` and `storage.objects` to our tables.
5. `04_ROLES_AND_SECURITY.md`:
   - a role and privilege matrix (app, tenant, migrate, backup, console read, break-glass);
   - a threat model (STRIDE) for the database, sign-in, the file vault, the console and Cloudflare;
   - the Cloudflare configuration (DNS, named tunnel, TLS mode, WAF and custom rules, the rate rule, bots, caching, Access policies), with each free-plan limit marked "verify in the dashboard";
   - key and secret management, including rotation.
6. `05_IDENTITY.md`: our own sign-in for app users and the console's single owner:
   - sequence diagrams for every flow;
   - token lifetimes, rotation and reuse detection;
   - the code rules, passkey rules and recovery paths, including the break-glass reset for the console.
7. `06_FILE_VAULT.md`: layout, encryption, signed links, integrity checks, deletion, backup.
8. `07_BACKUP_RECOVERY.md`:
   - pgBackRest (or WAL-G, with the choice argued) settings and schedules;
   - the Mac collection;
   - RPO and RTO targets to measure, the restore drills, a runbook for every failure, and what a single PC cannot survive.
9. `08_OBSERVABILITY_AND_ALERTS.md`:
   - every event that reaches the owner, with its severity, wording and channel (console live feed, Web Push from the installed PWA, e-mail);
   - folding of duplicates, reminders, quiet hours, "back to normal" messages;
   - the `owner_events` design, and the health checks ("advisors").
10. `09_CONSOLE.md`, the RoleMatch Console:
    - an information architecture and navigation map;
    - **a wire map for every page on phone and on laptop**: Today, Alerts, Organisations, People, Records, Processing, Audit, Health and security, Backups, Schema, Ask;
    - the states of each page: empty, loading, error, masked, revealed;
    - the copy in plain words;
    - the RoleMatch visual identity (palette, buttons, motion from `src/theme/`), light and dark, and accessibility;
    - the PWA install and push permission flow on iPhone and Android.
11. `10_CAPACITY_AND_PERFORMANCE.md`:
    - a memory budget on the 16 GB PC;
    - pool sizes and how to measure them;
    - indexes against the real queries;
    - the load-test plan for 1,000, 5,000 and 30,000 users (on a rehearsal copy, never live);
    - growth to a second machine.
12. `11_TESTING.md`: contract tests that old and new must both pass, isolation tests, security tests, recovery drills, browser journeys (phone and laptop), and how the suite moves off Supabase.
13. `12_MIGRATION_AND_CUTOVER.md`: rehearsal, cutover minute by minute, the 14-day way back, the removal of Supabase, and the communication to users ("sign in once more").
14. `13_PLAN.md`: phases, tasks, dependencies, effort, acceptance gates and rollback for each, risks, and the owner's decisions with a recommendation for each.
15. `14_INTEGRATION.md`: for every component (database, sign-in, file vault, API, queue, events, console, backups, model link):
    - its interface and protocol;
    - how another system connects to it;
    - how to replace it or move it to the purchased server;
    - the contract test that proves the interface.

    It also covers integrations with outside systems (applicant tracking, HR, job boards):
    - per-organisation API keys with scopes, limits, audit and revocation;
    - signed outbound webhooks through the outbox;
    - JSON and CSV import and export formats;
    - one event schema shared by the console, the alerts and the webhooks;
    - versioning and deprecation rules.
16. `15_MACHINES_AND_SCHEDULING.md`: what runs where during development (PC and Mac, measured figures), the fine-tuning window and how live uploads wait during it, and the move to the purchased production server.
17. `16_OPEN_QUESTIONS.md`: everything you could not settle from the repository, each with the evidence you found and your recommendation.

## How to work

- **Ground every statement** in a file and line, a migration, or a cited source with its date. Mark anything unchecked **unverified**.
- **Where you disagree with ADR-004 or the brief,** say so and argue the alternative. Do not silently change the design.
- **Prefer the simplest design that meets the constraints;** cleverness must make the system safer, faster or simpler to run, never decorative.
- **Write for a reader who is learning:** plain English first, technical detail after.
- **Finish with a short summary:** where the plan stands, how good it looks, the biggest risks, and the next step.
