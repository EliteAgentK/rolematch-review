# RoleMatch

RoleMatch is a multi-tenant recruitment platform. Recruiters upload CVs and job descriptions, the platform reads each one into a structured record tied to the lines it came from, and a recruiter can ask how well a candidate fits a job. It **recommends for human review**: it never rejects, shortlists, interviews or hires anyone by itself.

![RoleMatch logo](public/logo-light.png)

## Where things stand (23 November 2026)

**In development, live for testing, not yet a production system.** It runs at https://app.rolematch.co.za.

**What a recruiter can do today**
- Sign up (an e-mailed code confirms the address), sign in with a password or a passkey, reset a forgotten password. Sessions last 8 hours.
- Work in a company's portals (departments), with three roles: administrator, recruiter and hiring manager (who sees only candidates on a shortlist). Administrators invite people by e-mail.
- Upload CVs and job descriptions one at a time or in batches (PDF, Word .docx and .doc, OpenDocument, Rich Text, plain text, and scans or photos as JPEG, PNG, TIFF, BMP or GIF). Each waits in a visible processing list and reaches the board only when fully read. The original stays private and opens from the candidate's panel as **View Original CV**.
- Read each candidate's and job's panel: every value comes from the document, with where it was found. Duplicates are flagged. Corrections are allowed only as far as the company's edit policy (Settings) permits; each one is audited with who, from what, to what.
- Keep a note on each candidate and a workflow status **per job** (by default Not yet reviewed, Shortlisted, Interviewed, Hired and Not suitable; Reviewed, Awaiting interview, Interviewing and Archived can be switched on in Settings), and see each job's shortlist.
- Match one candidate against one job only by pressing **Match**. The first finished match of a pair is kept as recorded; it is never re-run or charged again.
- See the company's Overview and the history of what was done.

**How documents are read and matched**
- Every file is turned into text on our own server: native text where the file has it, OCR (Tesseract, run locally) for scanned pages and photos.
- The AI (Anthropic's API, called with RoleMatch's key) reads that text into the record and judges a match. There is no scoring formula: the score is the AI's ([`docs/architecture/ADR-006-ai-only-matching.md`](docs/architecture/ADR-006-ai-only-matching.md)). Rules supply only facts, such as where the candidate is and dated years of experience.
- Code checks every answer: values must be found in the document, cited evidence must exist, and a score its own evidence does not support is refused. That proves an answer is grounded, not that the judgement is right: the percentage is the AI's judgement within those checks, not a measured probability.
- Each AI call is billed to one portal, against a monthly allowance per company and a platform cap, reserved before the call ([`docs/architecture/ADR-005-claude-in-the-platform.md`](docs/architecture/ADR-005-claude-in-the-platform.md)). The text sent is processed by Anthropic outside South Africa.
- With the AI switched off, a rule-based reader stands in and the record says so; matches then have no score.

**Companies kept apart.** A company's requests run in the database under a role that sees only that company's rows (row-level security), and tests try every route across two companies. Platform-wide work (the queue, sign-in, rate limits) runs under one login that can see every company; narrowing it is planned, not done.

**Where it runs, for now.** While RoleMatch is in development, everything runs on one PC (Docker under WSL 2): its own PostgreSQL, the open-source sign-in service it was built on, an encrypted file vault, and a Cloudflare tunnel to the internet ([`docs/ops/LIVE_ON_PC.md`](docs/ops/LIVE_ON_PC.md)). No Supabase hosting is used. One machine is not high availability: a power or network cut there takes the service down. Production moves to a cloud server in South Africa when the first corporate customer signs ([`docs/architecture/PLAN_AZURE_PRODUCTION.md`](docs/architecture/PLAN_AZURE_PRODUCTION.md)); the code is built to move (standard PostgreSQL, settings per machine, the vault behind one interface).

**How it is looked after**
- Backups: encrypted dumps and the file vault every night (14 kept), copied off the PC to a second machine; the database's change log archived every minute; a restore drill every Monday.
- Watching: every minute a monitor checks the public address and the service's health and tells the owner by e-mail and in the owner's console; a daily check e-mails everything else at 06:00. Prometheus keeps 90 days of numbers (speed, errors, queues, disk, memory) shown as Trends in the console, with warnings for slow drift. See [`docs/ops/MONITORING.md`](docs/ops/MONITORING.md) and [`docs/ops/TRENDS_AND_LOAD.md`](docs/ops/TRENDS_AND_LOAD.md).
- The owner's console (platform figures, alerts, portals, people; never what is inside a company's records) is reachable from the internet behind its own password and an e-mailed code.
- Releases are built on the PC from a commit, take a backup first, then apply migrations; each is logged with the way back.

**Testing.** About 1,350 server tests against a local database, and 158 browser tests (Playwright) across engines, sizes and light and dark modes, all run on the developer's machine before each release. A load test (k6) ran 10, 25, 50 and then 100 recruiters at once against a copy on the PC (AI off): with 100, pages answered in about 40 ms (slowest 5% about 0.1 s), every CV was read in about 3 s, nothing failed once a connection fault the test found was fixed, and the PC's processors were at most 13% busy ([`docs/ops/TRENDS_AND_LOAD.md`](docs/ops/TRENDS_AND_LOAD.md)). GitHub Actions does not run at present: the GitHub account's billing must be fixed first.

## Repository map

| Path | What is in it |
|---|---|
| [`src/`](src) | The website (React, Vite, Chakra UI). Holds no secrets and no data of its own; everything comes from `/api`. |
| [`server/`](server) | The backend (Node.js 24, TypeScript): sign-in, the file vault, the queue, reading, matching, audit, the owner's console and the monitor. See [`server/README.md`](server/README.md). |
| [`supabase/`](supabase) | The database schema ([`migrations/`](supabase/migrations), applied in order with `npm run migrate`) and the local stack's settings. The name is the tool's that runs the local stack; see [`supabase/README.md`](supabase/README.md). |
| [`deploy/`](deploy) | Everything that runs live: release, backup, restore, daily check, Prometheus, the load target. |
| [`load/`](load) | The load test (k6): one recruiter's journey under several crowd shapes. |
| [`docs/`](docs) | Everything written down: product, architecture, operations, parser, research, security. Start at [`docs/README.md`](docs/README.md). |
| [`e2e/`](e2e) | Browser tests (Playwright). |
| [`sample-documents/`](sample-documents) | Invented CVs and job descriptions for tests and demos. Real CVs never go in the repository. |
| [`scripts/`](scripts) | Build and safety tools (brand assets, secret scan, licence check, leftovers check). |
| [`public/`](public), [`design/`](design) | Static assets and brand files. |
| [`CLAUDE.md`](CLAUDE.md) | Engineering handoff: how to work in this repository and the non-negotiable product behaviour. |

## Run it locally

Needs [Node.js](https://nodejs.org) 24 LTS, Docker (Colima on a Mac) and the Supabase command-line tool, which runs PostgreSQL, the sign-in service and storage on your machine. The one-time setup (signing key, which services to start) is in [`server/README.md`](server/README.md), "Testing against a local database".

```bash
supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
cd server && npm install            # then create server/.env from .env.example, with the addresses `supabase status` prints
npm run migrate                     # apply the database schema
npm run create-user "My Organisation" you@example.com "Your Name" "a-long-password"
cd .. && npm install && npm run build
cd server && npm run start          # open http://localhost:8787
```

For website work: `npm run dev` (with the server running), then open <http://localhost:5173>.

## Checks before every change

```bash
npm run typecheck && npm run build             # website
cd server && npm run typecheck && npm run test:local   # server, against the local stack
cd .. && npm run check:leftovers               # no unused files, exports, packages or styles
bash e2e/run-local.sh                          # browser tests
```

`npm test` in `server/` refuses to run unless the database is on your machine. Do not commit secrets, original CVs, `server/data/`, private planning documents or generated output; the `.gitignore` already excludes them, and `npm run setup:hooks` adds a secret scan before every commit.
