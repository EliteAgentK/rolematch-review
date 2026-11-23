# Keeping the database in step with the code

The folder is named after the tool that runs the local stack for development and tests (the Supabase command-line tool; setup in `server/README.md`). Live uses no Supabase hosting: for now it runs its own PostgreSQL and sign-in service on one PC (`docs/ops/LIVE_ON_PC.md`). The same migrations build both.

## The rule
**Every change to the database is a new numbered file in `supabase/migrations/`, applied with `npm run migrate`** (from `server/`; on live, by `deploy/pc/release.sh`, after a backup).
Never change tables, columns, indexes or policies by hand: the next person would not know, and the code and the database would drift apart.
Never edit a migration that has already been applied: add a new one.

## What keeps it honest
- **On startup** the server compares the database with what the code expects (tables, columns, row-level security on every table, the audit-log protection, and that sign-ups need email confirmation).
  In development, pending migrations are applied automatically. In production (`COOKIE_SECURE=true`) the server refuses to start until they are applied deliberately.
- **`/api/ready`** answers "not ready" while the schema is out of step, so live is never served from a database that does not match.
- **`npm run schema:check`** prints the full comparison and exits 1 on any drift; the daily check on the PC runs it every morning.
- **`npm run test:local`** builds each test's database from the migration files alone and checks it matches the code, and checks that deliberate drift is detected.
- If code needs a new column, add it to `EXPECTED` in `server/src/schema.ts` in the same change as its migration.

## The local stack's settings
`supabase/config.toml` makes the local stack behave like live where it matters: e-mail confirmation required, tokens signed with an ES256 key (`signing_keys.json`, made on each machine, never committed), and raised sign-in limits because a whole test suite signs up from one address.
