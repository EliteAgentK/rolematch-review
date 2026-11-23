# RoleMatch server

TypeScript on [Node.js](https://nodejs.org) 24 LTS (run with `tsx`). One process serves the API (`/api/*`) and the built frontend.

## Run

Needs Docker and the local stack (below, "Testing against a local database"): the Supabase command-line tool runs PostgreSQL, the sign-in service and storage on your own machine. Live uses no Supabase hosting: for now it runs its own PostgreSQL, the same open-source sign-in service and an encrypted file vault on one PC (`docs/ops/LIVE_ON_PC.md`), until production moves to a cloud server in South Africa (`docs/architecture/PLAN_AZURE_PRODUCTION.md`). The schema is applied by `npm run migrate`, here and on live.

```bash
cd server
npm install
cp .env.example .env          # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL from `supabase status` (live gives the same names its own services)
npm run migrate               # applies any new migrations
npm run create-user "My Organisation" you@example.com "Your Name" "a-long-password-12+"
npm run start                 # http://localhost:8787  (build the frontend first: from the repo root, npm run build)
```

The maintenance scripts (`migrate`, `create-user`, setting an AI allowance, restoring originals) first say which database they are about to change. They refuse live (`ROLEMATCH_ENVIRONMENT=live`), and any database not on this machine whose settings do not say it is a rehearsal, a test or development, unless run with `--target-confirmed` (`src/scripts/target.ts`). The release and recovery scripts in `deploy/` pass it.

Keep the secret key and database password out of git and out of chat. `server/.env` is git-ignored.

Frontend development with hot reload: `npx vite` in the repo root (port 5173, proxies `/api` to 8787).

## Why many people can use it at once

Nothing in a request waits on a slow task. Uploading returns immediately (`202`); a durable queue (a Postgres table claimed with `FOR UPDATE SKIP LOCKED`, survives restarts) runs the pipeline in the background with a worker limit, a per-organisation limit, a cap on simultaneous AI calls, retries with backoff, and idempotent handlers. `npm run test:local` runs against the local stack in a throwaway schema with temporary users, and cleans up after itself. It includes a test that uploads 12 documents against an AI that takes 2 s per call: they finish in about 11 s (serial needs 24 s or more) while other requests stay responsive. The 11 s is mostly network time to a database in another region; running the server next to the database removes most of it.

Reading documents can run in processes of its own (since 2026-10-27), so heavy OCR never slows the website and each side can be scaled separately:

- `npm start` (default `ROLE=all`): one process serves the website and reads documents, as before.
- `ROLE=api npm start`: serves the website only and just adds jobs to the queue; start as many as needed behind a load balancer.
- `npm run worker`: reads documents only; start as many as needed. Health check on `WORKER_HEALTH_PORT` (8790): `GET /health` returns the queue figures.

Several workers share the queue safely: each job is claimed by exactly one, a running job checks in every 30 s, and a job silent for 2 minutes (its worker stopped) goes back in the queue. Proven by `server/test/several-servers.test.ts`: a document uploaded to a website-only server waits until a worker is started, then is read and published.

## Pipeline

received -> file checks (real type from file bytes) -> reading -> extracting -> validating -> published. A candidate or job appears on the board only when published. Every extracted fact must quote text that really exists in the document; unsupported facts are dropped and reported. Failures go to an exception state with a reason, never to the board.

## Matching

`src/match.ts`: each job requirement is checked against the candidate's evidence with whole-word skill matching. States are verified / partial / not demonstrated / contradicted / not applicable. Missing evidence earns no credit but is never treated as a failure: the result shows the documented alignment and the ceiling if open items were confirmed. Ratings are never used. Confidence reflects extraction quality and evidence coverage. Each run is stored as an immutable snapshot with the engine version.

## More documentation

How the platform works end to end is in `docs/product/OPERATING_MODEL.md`; the reader's contract is in `docs/parser/EXTRACTION_CONTRACT.md`; the security audit is in `docs/security/SECURITY_AUDIT.md`. Start at `docs/README.md`.

## Developer tools (npm scripts)

| Script | What it does |
|---|---|
| `npm run typecheck` | Type-checks the whole server. |
| `npm test` | Runs every test against the database and storage already set in the environment; refused unless both are on this machine (`server/.env` points at live). Use `npm run test:local`. |
| `npm run test:local` | Runs every test against the local stack on this machine. Setup below. |
| `npm run rehearse:outage` | Rehearses a real database outage on the local stack: a live copy, the main database switched off and on, RoleMatch staying readable with saving paused, and returning to normal by itself. Prints the timings. |
| `npm run copy:refresh` / `npm run copy:watch` | Takes a copy of the main database into the local copy database, once or every `COPY_REFRESH_MINUTES` (5). With `READ_FALLBACK_DATABASE_URL` pointing at it, RoleMatch reads it only while the main database is unreachable. Needs Colima. The copy's address for `READ_FALLBACK_DATABASE_URL` is `postgresql://postgres:postgres@127.0.0.1:54401/postgres` (a local container's default password, not a secret). |
| `npm run stress` | Generates CVs in many layouts and measures how well each format is read (`stress:show`, `stress:items`, `stress:headings`, `stress:rotate`, `stress:quality` dig into one question). |
| `npm run golden:update` | Re-freezes the expected reader outputs, only after a deliberate `PARSER_VERSION` bump. |
| `npm run sample:matrix` | Scores every sample CV against every sample job, offline. |
| `npm run sample:parse-cvs`, `sample:parse-jobs` | Read the sample documents with the built-in parser only, for quick iteration. |
| `npm run sample:dry-run` | Uploads the sample documents through a running server and prints what was extracted. |
| `npm run migrate`, `schema:check` | Apply the database migrations, and prove the live database matches the code. |

## Testing against a local database

The tests run against a local stack: the same parts as live (PostgreSQL, the sign-in service, storage) on this machine, so they are fast and depend on
no provider. Everything used is free and permissively licensed: Colima (MIT) runs the
containers, the Docker command-line tools (Apache-2.0, not Docker Desktop), and the Supabase CLI (MIT).

```bash
brew install colima docker supabase
colima start --cpu 4 --memory 4 --disk 30 --vm-type vz
supabase gen signing-key --algorithm ES256 > ../supabase/signing_keys.json   # then wrap the key in [ ] (the file must be a list); never commit it
cd .. && supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
cd server && npm run test:local
```

`supabase/config.toml` makes the local stack behave like live where it matters: tokens signed with an ES256 key (so sign-in is
checked locally exactly as in production), e-mail confirmation required, and migrations applied only by RoleMatch's own runner (`test:local` runs it
first), never by the Supabase tool. `test:local` refuses to run unless every address is on this machine. Stop everything afterwards to free memory:
`supabase stop && colima stop`. First-time downloads: the four tools (about 115 MB), Colima's Linux image (332 MB) and five Supabase images (about 3.5 GB on disk).

## Known gaps

No malware scanner; OCR (local Tesseract) has only been measured on invented documents and reads scans and photos unreliably; workflow status is per job, with its production gaps in `docs/architecture/PLAN_STATUS_PER_APPLICATION.md`; one machine, no high availability (above).

## How a match is scored

The AI alone scores a candidate against a job (`src/aiMatch.ts`; `docs/architecture/ADR-006-ai-only-matching.md`: no formula). The rules in `src/ruleset.ts` and `src/match.ts` give it facts only: where the candidate is, dated years of experience, the versions of the records. Code then checks every answer: cited evidence must exist in the document, and a score its own evidence does not support is refused. A pair is matched once; the first finished match is kept as recorded and never run or charged again (`src/recorded.ts`).

## Sign-up and verification
`/signup` collects name, organisation, email and a password of 12+ characters, then e-mails a code (the sign-in service makes it; RoleMatch sends its own branded e-mail through its own mail server, `server/src/email.ts`). Nothing is created in RoleMatch until the code is confirmed; confirming creates a new, separate organisation with that person as administrator. Wrong or reused codes fail, resending is limited to once a minute, repeated attempts are rate limited per address and per email, a hidden form field catches bots, and signing up with an address that already has an account looks identical and creates nothing. `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, so rate limits cannot be dodged by faking an address.

## Keeping the database in step
Schema changes are numbered migrations (`npm run migrate`); the server checks on startup that the live database matches the code, `/api/health` reports it, and `npm run schema:check` proves it. Details in `supabase/README.md`.
