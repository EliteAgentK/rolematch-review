# Plan: database, sign-in and files from Supabase (Ireland) to the PC

> **Superseded in part, 6 November 2026.** The owner wants our own infrastructure, not self-hosted Supabase: our own PostgreSQL, sign-in and private file store. The target and steps below that install Supabase's self-hosted release no longer apply. The rehearsal, cutover and way-back steps still describe the shape of the move. Everything to consider is in `docs/architecture/DATABASE_BRIEF.md`.

Owner, 6 November 2026: everything runs on the PC; the Mac runs only the model. Today the PC runs the application; the database, sign-in and private files are still Supabase's hosted project `rolematch-live` in Ireland. This plan moves them without losing an account, a password, a record or a file, and keeps a way back.

## What the application uses from Supabase

| Service | How the backend reaches it | Holds |
|---|---|---|
| PostgreSQL | directly (`DATABASE_URL`) | every table: organisations, portals, candidates, jobs, documents, queue, audit, matches |
| Auth (GoTrue) | HTTP `/auth/v1/*`: sign-in, tokens, verify, logout, admin users, passkeys | the `auth` schema: accounts and password hashes |
| Storage | HTTP `/storage/v1/*`: upload, signed links, the private bucket | original CVs and job descriptions |

Supabase's own self-hosted release runs the same three services with the same interfaces, so the application code does not change: only its addresses and keys do.

## Target

```
internet ─► Cloudflare tunnel (rolematch.co.za once on Cloudflare) ─► PC
PC (WSL 2, Docker)
  live:      rm-api · rm-worker · rm-model-worker · rm-monitor · rm-tunnel
  data:      Supabase self-hosted, pinned versions: postgres · gotrue (auth) · storage · kong
             bound to 127.0.0.1 only: nothing of it is reachable from the home network or the internet
  backups:   nightly encrypted dump of the database and the files, kept 14 days on the PC
             and copied off the PC (destination: the owner's choice, see Decisions)
  tests:     a separate throwaway Supabase and the rehearsal, never sharing a key or a port with live
Mac:         the model only (Ollama), reached by the PC through the Mac's private link
Supabase (Ireland): kept untouched for 14 days after the move as the way back, then retired
```

## Steps

1. **Install self-hosted Supabase on the PC**, pinned to the versions the hosted project runs, with fresh secrets (database password, JWT signing keys, service keys) kept root-only like `/etc/rolematch/live.env`. Ports bound to 127.0.0.1.
2. **Rehearse the move on a copy.** Dump the live database (all schemas, including `auth` and `storage`), restore it into the PC's new database, copy every file from the bucket, point the isolated rehearsal stack at it, and prove: test accounts sign in with their existing passwords, records and originals open, the browser journeys pass, row counts and file counts match the source exactly.
3. **The cutover**, at a quiet time, announced to the owner first:
   1. take a backup; stop the workers, then the API (live shows its maintenance state; uploads wait);
   2. final dump and restore; final file copy; counts compared table by table and file by file;
   3. switch live's settings to the PC's services; start; verify from outside (sign-in rule, data needs sign-in, an original opens, health healthy).
   Expected interruption: under 15 minutes.
4. **After the move:** everyone signs in once more (sessions were signed by the hosted project's keys); passwords are unchanged. Nightly backups start that night, and a restore drill runs within the week.

## The way back

At any point up to 14 days: point live's settings at the hosted project again and restart (5 minutes). Anything created on the PC after the move is copied back first; the plan keeps the dump-and-copy scripts for both directions.

## Decisions for the owner

* **Where the off-PC backup copy lives.** One disk must never be the only copy. Options: an external drive on the PC, the Mac's disk (it then holds encrypted backups as well as the model), or both.
* **When the cutover runs.** A quiet hour; the owner's own test accounts will need to sign in again afterwards.

## What does not change

Sign-in screens, passwords, passkeys, e-mail (still the existing mail host), every record and file, every permission and the isolation between organisations, and the application code.
