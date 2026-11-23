#!/usr/bin/env bash
# Restore drill (docs/database/07_BACKUP_RECOVERY.md): proves the database can be brought back to a chosen moment, and measures how long it takes.
#   deploy/db/drill.sh [source-name]      default rm-db. Run as root on the PC.
# Writes a marker, notes the time, writes a second marker, then restores the backups into a separate, throw-away database (never over the source,
# which keeps running), to the noted time: the first marker must be there and the second must not. That copy never archives (archive_mode off), so
# it cannot write into the source's backups. Prints the result and the time taken; exits non-zero on any failure.
set -euo pipefail
SRC="${1:-rm-db}"; DRILL="$SRC-drill"; IMAGE="$(docker inspect "$SRC" --format '{{.Config.Image}}')"
q() { docker exec -i "$SRC" psql -X -q -At -U postgres -d rolematch -c "$1"; }
RUN="drill-$(date +%s)"
q "create schema if not exists ops; create table if not exists ops.restore_drill (run text, step text, at timestamptz default clock_timestamp())"
q "insert into ops.restore_drill(run, step) values ('$RUN', 'before')"
sleep 2; TARGET="$(q "select clock_timestamp()")"; sleep 2
q "insert into ops.restore_drill(run, step) values ('$RUN', 'after')"
q "select pg_switch_wal()" >/dev/null
# Wait until the segment holding 'after' is safely in the repository.
for i in $(seq 1 60); do docker exec -u postgres "$SRC" pgbackrest-keyed --stanza=rolematch check >/dev/null 2>&1 && break; sleep 1; done
START=$(date +%s)
docker rm -f "$DRILL" >/dev/null 2>&1 || true; docker volume rm "$DRILL-data" >/dev/null 2>&1 || true
MOUNTS=(); for s in postgres backup-key; do MOUNTS+=(-v "/etc/rolematch/db/$SRC/$s:/run/secrets/$s:ro"); done
docker run --rm -u postgres -v "$DRILL-data:/var/lib/postgresql/data" -v "$SRC-backups:/var/lib/pgbackrest:ro" "${MOUNTS[@]}" "$IMAGE" \
  bash -c "mkdir -p /var/lib/postgresql/data/pgdata && chmod 700 /var/lib/postgresql/data/pgdata && pgbackrest-keyed --stanza=rolematch --type=time '--target=$TARGET' --target-action=promote restore" >/dev/null
docker run -d --name "$DRILL" -v "$DRILL-data:/var/lib/postgresql/data" -v "$SRC-backups:/var/lib/pgbackrest:ro" "${MOUNTS[@]}" -e PGDATA=/var/lib/postgresql/data/pgdata "$IMAGE" \
  postgres -c config_file=/etc/postgresql/rolematch.conf -c archive_mode=off >/dev/null
for i in $(seq 1 300); do docker exec "$DRILL" psql -X -At -U postgres -d rolematch -c "select pg_is_in_recovery()" 2>/dev/null | grep -qx f && break; sleep 1; done
GOT="$(docker exec "$DRILL" psql -X -At -U postgres -d rolematch -c "select string_agg(step, ',' order by at) from ops.restore_drill where run='$RUN'")"
SECONDS_TAKEN=$(( $(date +%s) - START ))
docker rm -f "$DRILL" >/dev/null; docker volume rm "$DRILL-data" >/dev/null
q "delete from ops.restore_drill where run='$RUN'"
if [ "$GOT" = "before" ]; then echo "restore drill passed: back to $TARGET in ${SECONDS_TAKEN}s; the change after that moment is absent, the one before it present"
else echo "restore drill FAILED: expected 'before', got '${GOT:-nothing}' after ${SECONDS_TAKEN}s"; exit 1; fi
