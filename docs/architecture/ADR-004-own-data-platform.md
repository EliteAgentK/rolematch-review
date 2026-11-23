# ADR-004: Our own data platform on the PC, Cloudflare in front, and the owner's console

Status: **proposed, for the owner's approval** (6 November 2026). Nothing here is built yet. This plan replaces the self-hosted Supabase route in `../ops/DATABASE_TO_PC_PLAN.md`; ADR-003's two rented servers become the later growth step. Every constraint the design must respect is listed in `DATABASE_BRIEF.md`. The full database bible (specifics, diagrams, wire maps) is to be written from `CODEX_DATABASE_BIBLE_PROMPT.md`.

## 1. Decision

RoleMatch runs its own data platform on the PC:
- standard PostgreSQL 17;
- our own sign-in, file vault and backup stream, built into the existing API;
- **the RoleMatch Console**: an owner-only, RoleMatch-branded place to see and run the whole database from phone and laptop, with live notifications.

**Cloudflare (free plan) sits in front as the security layer,** on the owned domain `rolematch.co.za`. Nothing at home is opened to the internet: the PC dials out through a Cloudflare Tunnel.

**What we write ourselves:** the flows (accounts, sessions, codes, file links, backups, the console).

**What we never write ourselves:** the database engine, encryption, password hashing or WebAuthn checks. Those come from proven, permissively licensed software. Owning everything does not mean hand-writing the parts where one mistake leaks every account.

## 2. What studying Supabase taught us

Sources: Supabase's self-hosting compose file (commit `06d43f6`, 6 Nov 2026, at `/srv/supabase-src/docker` on the PC), and Supabase's architecture, backups and Auth documentation.

Supabase is **one PostgreSQL with eleven services around it**:

| Supabase service | What it does | Our decision |
|---|---|---|
| Postgres 17.6 | the only source of truth | **Keep the idea:** standard PostgreSQL 17; everything else is stateless around it |
| GoTrue (auth v2.197.0) | accounts, tokens, refresh, codes, passkeys | **Rebuild inside our API.** We already send our own codes and keep our own limits and revocations; we use 15 of its functions and none of its social logins, SMS or OAuth |
| Storage API v1.89.12 | file metadata in Postgres, bytes on disk or S3 | **Copy the pattern:** metadata in the database, bytes encrypted on disk, links signed by the API |
| Envoy gateway | routes requests to services | **Done by Cloudflare plus our API** |
| PostgREST v14.18 | tables exposed as a public REST API | **Drop.** Never used, locked down in migration 012; dropping it closes a whole way in |
| Studio + postgres-meta | the dashboard | **Replace with the RoleMatch Console** (section 6), built for us rather than for every database |
| Realtime, Functions, imgproxy, Supavisor, logs | live updates, functions, images, pooling, logging | **Drop.** Unused; about 5 processes need no pooler |

**Worth copying exactly:**
1. **Short tokens with rotating refresh.** Short asymmetric access tokens (GoTrue's default is 1 hour). Refresh tokens rotate on every use; reusing an old one revokes its whole family, with a short grace window for two tabs refreshing together.
2. **Trust only the proxy's address header.** Rate limits use the client address only from a trusted proxy header; GoTrue warns that `x-forwarded-for` can be spoofed. Behind Cloudflare, that header is `CF-Connecting-IP`, trusted only on traffic that came through our tunnel.
3. **Point-in-time recovery** from a daily physical snapshot plus WAL archived about every 2 minutes, so at worst about 2 minutes of data are lost. Supabase uses WAL-G and charges about $100 a month for it; pgBackRest (MIT) or WAL-G (Apache-2.0) gives the same for free.
4. **File metadata in the database,** so a restore of the database and a restore of the files can be checked against each other.
5. **From Studio:** the ideas worth taking are a table browser, a log explorer, a schema picture and "advisors" (automatic checks that flag, for example, a table without row security). These come in the owner's form: simple, informative, read-first.

## 3. Architecture

```
       visitors (browser)                         the owner (phone + laptop)
              │ HTTPS                                      │ HTTPS
              ▼                                            ▼
 ┌──────────────────────────── Cloudflare (free) ───────────────────────────────┐
 │ app: rolematch.co.za                   console: console.rolematch.co.za      │
 │ TLS · DDoS · free managed WAF rules    Access: only the owner's e-mail gets  │
 │ custom rules · 1 sign-in rate rule     past this wall, before our own login  │
 │ bot protection · no caching of /api    (free Zero Trust; limits to confirm)  │
 └──────────────────────────────┬───────────────────────────────────────────────┘
                                │ Cloudflare Tunnel (PC dials out; no open ports at home)
 ┌──────────────────────────────▼───────── the PC (WSL 2, Docker) ──────────────┐
 │ rm-tunnel ─► rm-api (127.0.0.1)            rm-console (127.0.0.1)            │
 │   sign-in, sessions, codes, passkeys         owner sign-in (one account)     │
 │   signed file links, everything else        views, alerts, push, audit       │
 │ rm-worker · rm-model-worker · rm-monitor ── events ──► rm-console            │
 │        │ roles: app · tenant (RLS) · migrate · backup · console (read)       │
 │        ▼                                                                     │
 │ rm-db: PostgreSQL 17, 127.0.0.1 only ── records · accounts · audit           │
 │ file vault: AES-256-GCM on disk, hashed names ── original CVs                │
 │ rm-backup: pgBackRest ── WAL every ~2 min + nightly full ─┐                  │
 └───────────────────────────────────────────────────────────┼──────────────────┘
                                                             │ encrypted, collected by the Mac
 ┌──────────────────────────── the Mac ──────────────────────▼──────────────────┐
 │ Ollama (the model) · ~/RoleMatchBackups (WAL + full backups + vault)         │
 └──────────────────────────────────────────────────────────────────────────────┘
```

## 4. Our own sign-in for RoleMatch's users

```
SIGN IN    Cloudflare rate rule ─► API: 5 attempts / 15 min per address and per account (AUTH_ATTEMPTS)
           ─► verify the hash (argon2id; an imported bcrypt hash is accepted once, then upgraded)
           ─► membership check exactly as today (auth.ts) ─► audit "auth.login"
           ─► access token (ES256, ~1 h, our key) + refresh token (random, stored only as a hash, family id)
           ─► httpOnly, Secure, SameSite cookies (as today)
REFRESH    unused ─► rotate within the family │ reused outside the grace window ─► revoke the family, audit, alert the owner
CODES      sign-up and reset: random, stored as a hash, single use, expiry, attempt limit ─► outbox ─► our mail host
PASSKEYS   @simplewebauthn/server: origin, relying party, signature, counter; user verification REQUIRED (as today)
SIGN OUT   revoke the family; signed_out_sessions (as today)
KEYS       two keys at our own JWKS; rotate by adding the next key, then retire the old one after the longest token life
```

**Proven pieces (versions pinned at build time):**
- **Password hashing:** `argon2` (argon2id), plus `bcryptjs` (MIT) for checking imported hashes. **Unverified:** that GoTrue's hashes on our dump are bcrypt; this is checked on the first dump.
- **Passkeys:** `@simplewebauthn/server` (MIT).
- **Token signing:** Node's built-in `crypto`.

**New tables:** `accounts`, `refresh_tokens`, `auth_codes`, `passkey_credentials`, `passkey_challenges`. Signing keys live in root-only files, never in the database.

**This is the riskiest part.** Its gate includes a written threat model, a security review of the diff, and tests modelled on GoTrue's behaviour: rotation, reuse detection, expiry, enumeration-safe answers and timing.

## 5. Our own file vault

**Upload:** API checks the person and portal ─► bytes encrypted (`localVault.ts`) ─► written atomically to `/data/vault/<org>/<hash>` ─► metadata row (path, size, sha256, type) in the same transaction.

**View Original CV:** access check ─► HMAC-signed link, 60 s, one document ─► streamed decrypted with `Cache-Control: no-store`, so Cloudflare never caches it.

**Integrity:** each night, every row must have its file and every file its row. Mismatches go to the error register and alert the owner.

**Already there:** `fileStore(root)` and `STORE_DIR`, `localVault.ts`, `originalsCopy.ts`. The vault becomes the primary store instead of a copy.

## 6. The RoleMatch Console (owner only, phone and laptop, beautifully simple)

### Who gets in

- **Exactly one console account: the owner's.** One e-mail, one password, plus a passkey. The console refuses to create a second account; this is enforced in the database by a single-row table with a check constraint, not only in code.
- **Two walls:** Cloudflare Access lets only the owner's e-mail reach the page at all, then the console's own sign-in follows.
- **Lost password:** a break-glass reset runs only as root on the PC (`deploy/pc/console-reset.sh`), is audited, and alerts the owner.
- **Claude, while working,** uses the PC's command line through SSH with the read-only or migrate role. It never has a console login. Every Claude session on the database is audited like the owner's.

### What it shows (simple first page, depth one tap away)

| Page | What it answers |
|---|---|
| **Today** (home) | Is everything well? One sentence and a colour: live up, model up, last backup age, Mac copy age, queue, errors in 24 h, new sign-ups, disk. Each line taps through |
| **Alerts** | The live feed: errors, monitor alerts, security events (refresh-token theft, rate limits hit, Access denials), new users, failed jobs, backup or restore problems. Read, acknowledge, mute for a while |
| **Organisations** | Each organisation, its portals, members, capacity and usage, and activity over time |
| **People** | RoleMatch's users (not candidates): sign-ups, last sign-in, sessions, locked accounts; end a session; resend an invitation |
| **Records** | Candidates, jobs, documents and matches per organisation, **personal details masked by default**; revealing one asks for a reason and is audited (POPIA) |
| **Processing** | Queue, model jobs, outbox and mail attempts: what is waiting, running, failed and retrying, and how long each step takes |
| **Audit** | Who did what, when, from what to what; filter, and export with the export itself audited |
| **Health and security** | The database's own checks, in the style of Supabase's advisors: tables without row security, missing indexes, slow queries, connections, size growth, listening ports, update status from the daily check |
| **Backups** | Every full backup and the WAL timeline; the last restore drill and its measured time; **"restore a copy to a minute"** into a separate rehearsal database (never over live) |
| **Schema** | A live picture of the tables and how they link, migrations applied, and drift between code and database |
| **Ask** (later) | Read-only questions answered by saved, reviewed queries, under the read role with a statement timeout. No free-form writing to live data |

**Changes go through the API's own rules.** The console never edits live rows directly. Every write is an API action with the same permissions, edit policy and audit as the app (CLAUDE.md rule 4), so the console cannot become a back door.

### Notifications, live to the owner

- **Event sources:**
  - the error register;
  - the monitor;
  - security events from sign-in;
  - the daily check;
  - backups and restore drills;
  - new sign-ups;
  - failed jobs.
- **Pipeline:** an `owner_events` table, filled by the outbox pattern (written in the same transaction as the event) ─► console.
- **Channels:**
  - **Live in the console:** server-sent events.
  - **Phone push:** Web Push from the installed console (a PWA, "Add to Home Screen" on iPhone). Notifications travel through Apple's and Google's push services, which every web push does; they are free, and no third-party push service is involved. **The text pushed never contains personal data,** only "3 new errors" plus a link.
  - **E-mail:** the existing owner mail (`opsNotify.ts`) for anything urgent, and when push is not acknowledged.
- **Rules:**
  - severity levels (urgent, today, info);
  - duplicates folded into one alert with a count;
  - an hourly reminder while something urgent is open (as the monitor does now);
  - quiet hours, except for urgent alerts;
  - "back to normal" messages.

### Design

- The RoleMatch identity: the existing palette, buttons and motion (`button-design-system`, `src/theme/motion.css`).
- One column on the phone, two on the laptop.
- Large type and plain words, no database jargon on the first screen.
- Light and dark themes.
- Accessible: keyboard use, screen readers, contrast.
- Wire maps for each page are part of the database bible.

## 7. Phases and gates (live keeps running throughout)

| Phase | Work | Gate | Estimate |
|---|---|---|---|
| 0 | Fix the 4 failures in the current release candidate and release it | full suite green; checks from outside pass | hours |
| 1 | **Cloudflare in front.** The owner moves `rolematch.co.za`'s name servers to Cloudflare; a named tunnel replaces the quick tunnel; TLS, WAF, rate rule, bot protection, no caching of `/api`; `CF-Connecting-IP` trusted only through the tunnel | outside checks pass; the PC cannot be reached directly | ½ day + the owner's DNS step |
| 2 | **PostgreSQL 17 on the PC** with five roles, all 34 migrations, and pgBackRest (WAL to the PC, collected by the Mac); the test suite moves to it (one path) | suite green; restore to a chosen minute measured (RPO and RTO written down) | ½–1 day |
| 3 | **File vault as the primary store,** with signed links | contract tests: old and new behave the same | ½ day |
| 4 | **Our own sign-in** | contract tests; threat model; security review; browser journeys | ~2 days |
| 5 | **The Console:** Today, Alerts, push and e-mail first, then the other pages; Access in front | owner-only proven (a second account is refused, Access denies others); phone and laptop journeys; nothing personal in push text | 2–3 days |
| 6 | **Rehearsal:** hosted dump (including `auth` and `storage`) ─► PC; accounts mapped with hashes unchanged; files copied; load test at 1,000 users | counts equal; existing passwords work; journeys pass | ½ day |
| 7 | **Cutover** at the owner's chosen time (about 15 minutes); hosted project kept 14 days as the way back | outside checks; the owner signs in | 15 min |
| 8 | **Remove Supabase completely:** code, settings, the test stack, `/srv/sb-rehearsal`, and docs that name it | no reference left; suite green | ½ day |

**Total:** about 7–10 working days. Live stays untouched until phase 7.

## 8. Cloudflare free plan: what it gives, what to watch

**Gives:**
- TLS;
- DDoS protection;
- the Free Managed Ruleset (a subset of the full managed rules);
- custom rules;
- one rate-limiting rule;
- bot protection;
- a stable address on our own domain;
- Access for the console and for SSH.

**Unverified** until checked in the dashboard: the free custom-rule count (sources disagree), the Zero Trust free-user limit, and the upload body limit (100 MB on the free plan in past years).

**Watch:**
1. **Cloudflare decrypts traffic at its edge,** so CV uploads pass through it. Nothing under `/api` may be cached. It becomes a processor of personal information outside South Africa, which the privacy notice must say (POPIA).
2. **If Cloudflare is down, live is unreachable.** Today's quick tunnel already depends on it; a named tunnel is steadier.
3. **The API's own limits stay the authority;** the Cloudflare rule is a first wall.

## 9. Development now, a purchased server for production

**The owner, 6 Nov:** the single PC is acceptable because it is for development, and a server will be purchased before production.

What the single PC means meanwhile:
- A power cut, a home-internet outage, a Windows restart or a disk failure takes live down.
- Backups on the Mac limit the data lost to minutes; getting back up takes hours.
- Nobody calls it highly available.

**Everything is built so the move to the server is a copy, not a rebuild:** the same containers, settings in files, and no paths tied to the PC (section 10).

**Machines during development (measured 6 Nov):**

| Machine | What it has | Its work |
|---|---|---|
| PC | i9-10920X; WSL limited to 10 GB of 16 GB (about 8.4 GB free beside live); Quadro P400 with 2 GB, too small for model work | live, database development, testing |
| Mac | Apple M5, 16 GB | the live model (about 4 GB, 41–42 tokens/s) and fine-tuning |

**Training and the live model clash on the Mac.** Fine-tuning needs roughly another 6–9 GB and the same graphics chip, so training and live reading cannot both run at full speed. Training therefore runs in a scheduled quiet window. Live uploads wait in the queue during it, and the owner is alerted when training starts and when it ends.

A 16 GB NVIDIA card in the PC, or the production server, removes the clash.

## 10. Built to be integrated elsewhere (owner, 6 Nov: "every component")

Every component must be easy to lift out, replace, or connect to another system. That means:

1. **One documented interface per component**, with nothing reaching past it:
   - **Database:** the standard PostgreSQL protocol, and migrations as plain numbered SQL.
   - **Sign-in:** tokens and a key list (JWKS) that follow the open standards (JWT, ES256, OIDC-style discovery), so another system can trust a RoleMatch sign-in without our code.
   - **File vault:** a small store interface (`put`, `get`, `remove`, `signedLink`), so an S3-compatible store or another disk can replace it by adding one adapter.
   - **The API:** versioned, and described in an OpenAPI document.
2. **Settings only in files,** never in code or tied to a machine: addresses, ports, paths and limits all come from configuration. The same image runs on the PC, the purchased server, or a customer's own cloud.
3. **Containers with health checks and clear start and stop behaviour,** each able to run alone against its interface.
4. **Integration with other systems** (applicant tracking systems, HR systems, job boards):
   - **Inbound:** per-organisation API keys, limited to what they allow, rate-limited, audited, and revocable.
   - **Outbound:** signed webhooks (an HMAC header, retries through the outbox, and a delivery log).
   - **Data in and out:** import and export in documented JSON and CSV.
   - Tenant isolation and the edit policy apply exactly as in the app.
5. **Events in one documented format:** the same event shapes feed the console, the alerts and the outbound webhooks.
6. **Versioning and deprecation rules** for the API, events and exports, so an integration never breaks without notice.

This is a requirement on every phase in section 7, not a phase of its own: each gate also checks that the component's interface is documented and that a contract test proves it.

## 11. Decisions for the owner

1. Approve the plan and the phase order: Cloudflare first, because it protects what is live today.
2. Create a free Cloudflare account and move `rolematch.co.za`'s name servers to it (an owner step).
3. The single console e-mail address.
4. Accept that everyone signs in once more after the cutover.
5. The cutover time.
