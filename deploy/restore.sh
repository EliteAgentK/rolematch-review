#!/usr/bin/env bash
# Puts a backup back into a Supabase project whose structure is already in place and which holds no data: an empty project with the migrations applied. A person runs it, with the service stopped.
#   deploy/restore.sh /var/backups/rolematch/<stamp>
# Restores accounts, organisations, portals, records, matches, history, and then the originals from the vault. Jobs in progress at the backup are not restored: their documents show as they stood and can be retried.
set -euo pipefail
STAMP="${1:?give the backup, its path without .accounts.dump.enc}"; ENV="${ROLEMATCH_ENV:-/etc/rolematch/live.env}"
BACKUP_KEY="$(grep '^BACKUP_KEY=' "$ENV" | cut -d= -f2-)"; RELEASE="${RELEASE:-$(cat /opt/rolematch/release)}"; DATA="${ROLEMATCH_DATA_VOLUME:-rolematch_rolematch-data}"; NET="${ROLEMATCH_DOCKER_NET:-bridge}"
# Triggers stay off while the rows go back, as the rows were already checked when first written. Supabase allows this setting by SET, not at connection.
TLS=(); grep -Eq '^DATABASE_URL=.*@(localhost|127\.|host\.docker)' "$ENV" || TLS=(-v "$(cd "$(dirname "$0")" && pwd)/certs/supabase-root-2021.pem:/ca.pem:ro" -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.pem)   # register R104
put() { BACKUP_KEY="$BACKUP_KEY" openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_KEY -in "$1" | docker run --rm -i --network "$NET" --env-file "$ENV" ${TLS[@]+"${TLS[@]}"} postgres:17-alpine sh -c '{ echo "set session_replication_role = replica;"; pg_restore --data-only --no-owner -f -; } | psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL"'; }
put "$STAMP.accounts.dump.enc"
put "$STAMP.records.dump.enc"
docker run --rm --network "$NET" --env-file "$ENV" -v "$DATA:/data" "rolematch:$RELEASE" node src/scripts/backupOriginals.js restore --target-confirmed
echo "Restored. Start the service, sign in, and open a record and its original to confirm."
