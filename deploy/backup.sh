#!/usr/bin/env bash
# The nightly backup, run by root's cron on the server (Supabase Free's backups cannot be downloaded). Records and accounts as an encrypted dump, seven nights kept; originals in the encrypted vault on the data volume.
# It lives on this server, so it covers a mistake or a lost Supabase project, not the loss of this server unless a copy is taken off it. Losing a day's work is the worst case. Restore: deploy/restore.sh.
set -euo pipefail
ENV="${ROLEMATCH_ENV:-/etc/rolematch/live.env}"; OUT="${ROLEMATCH_BACKUPS:-/var/backups/rolematch}"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_KEY="$(grep '^BACKUP_KEY=' "$ENV" | cut -d= -f2-)"; [ -n "$BACKUP_KEY" ] || { echo "BACKUP_KEY is not set"; exit 1; }
RELEASE="${RELEASE:-$(cat /opt/rolematch/release)}"; DATA="${ROLEMATCH_DATA_VOLUME:-rolematch_rolematch-data}"; NET="${ROLEMATCH_DOCKER_NET:-bridge}"
umask 077; mkdir -p "$OUT"
# Where the database is on this machine (the PC's own, since the move to Johannesburg), the dumps run as its owner role: the application's login may not
# read sign-in's tables, and should not. ROLEMATCH_BACKUP_DB_ENV (root only) holds that role's DATABASE_URL, read after the settings for the dumps alone.
# A database on this machine is reached over the host's network; a bridge network would reach the container itself.
DBENV=(--env-file "$ENV"); [ -n "${ROLEMATCH_BACKUP_DB_ENV:-}" ] && [ -r "$ROLEMATCH_BACKUP_DB_ENV" ] && DBENV+=(--env-file "$ROLEMATCH_BACKUP_DB_ENV")
grep -Eq '^DATABASE_URL=.*@(localhost|127\.)' "$ENV" && NET=host
# Two dumps, because pg_dump ignores --schema once --table is given: one command with both would save the accounts and none of the records (register R97).
TLS=(); grep -Eq '^DATABASE_URL=.*@(localhost|127\.|host\.docker)' "${ROLEMATCH_BACKUP_DB_ENV:-$ENV}" "$ENV" || TLS=(-v "$(cd "$(dirname "$0")" && pwd)/certs/supabase-root-2021.pem:/ca.pem:ro" -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.pem)   # register R104
dump() { docker run --rm --network "$NET" "${DBENV[@]}" ${TLS[@]+"${TLS[@]}"} postgres:17-alpine sh -c "pg_dump \"\$DATABASE_URL\" --data-only --format=custom $1" | BACKUP_KEY="$BACKUP_KEY" openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_KEY -out "$2"; }
dump "--table=auth.users --table=auth.identities" "$OUT/$STAMP.accounts.dump.enc"
dump "--schema=public --exclude-table=public.schema_migrations --exclude-table=public.rate_limits --exclude-table=public.signed_out_sessions --exclude-table=public.queue" "$OUT/$STAMP.records.dump.enc"
[ "$(wc -c < "$OUT/$STAMP.records.dump.enc")" -gt "$(wc -c < "$OUT/$STAMP.accounts.dump.enc")" ] || { echo "The records dump is not larger than the accounts dump: something is missing."; exit 1; }
docker run --rm --network "$NET" --env-file "$ENV" -v "$DATA:/data" "rolematch:$RELEASE" node src/scripts/backupOriginals.js
find "$OUT" -type f -mtime +"${ROLEMATCH_KEEP_DAYS:-7}" -delete   # nights kept: 7 unless set (the PC keeps 14, owner 6 Nov 2026)
echo "Backed up $STAMP: $(du -sh "$OUT" | cut -f1) of dumps kept."
