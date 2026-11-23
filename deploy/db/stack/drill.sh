#!/usr/bin/env bash
# The restore drill (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, step 8): bring the newest base copy plus the archived WAL back up in a scratch
# container that nothing uses, replay it to the end of the archive, and compare every table's row count with the running database. Read only on the
# running side; the scratch container and its folder are removed afterwards. Prints one line; exits non-zero when anything differs.
#   deploy/db/stack/drill.sh <stack.env> <backup folder>
set -euo pipefail
ENVF="${1:?the settings file of the stack}"; OUT="${2:?the backup folder}"; set -a; . "$ENVF"; set +a
LATEST="$(ls -1d "$OUT"/2*Z 2>/dev/null | sort | tail -1)"; [ -n "$LATEST" ] || { echo "no base copy in $OUT" >&2; exit 2; }
IMG=public.ecr.aws/supabase/postgres:17.11.0.011; SCRATCH="${NAME:?}-drill"; WORK="$(mktemp -d /srv/rolematch/next/drill.XXXXXX)"; trap 'docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; rm -rf "${WORK:?}"' EXIT
COUNTS="select string_agg(n.nspname || '.' || c.relname || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text, ' ' order by n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relpersistence = 'p' and n.nspname in ('public', 'auth')"
# The running database is counted, and at that moment its current WAL segment is closed and archived, so the restore reaches exactly that point.
running="$(docker exec "$NAME-pg" psql -U supabase_admin -d postgres -Atc "$COUNTS")"
seg="$(docker exec "$NAME-pg" psql -U supabase_admin -d postgres -Atc "select pg_walfile_name(pg_switch_wal())")"
for _ in $(seq 1 30); do [ "$(docker exec "$NAME-pg" psql -U supabase_admin -d postgres -Atc "select coalesce(last_archived_wal, '') >= '$seg' from pg_stat_archiver")" = t ] && break; sleep 1; done
mkdir -p "$WORK/data" && tar -xzf "$LATEST/base.tar.gz" -C "$WORK/data" && chmod 700 "$WORK/data"
PGUID=$(docker run --rm --entrypoint id "$IMG" -u postgres); chown -R "$PGUID" "$WORK/data"
# Replay every archived segment, then open (the archive is mounted read only: the drill never changes it).
touch "$WORK/data/recovery.signal"; chown "$PGUID" "$WORK/data/recovery.signal"
docker run -d --name "$SCRATCH" --network none -v "$WORK/data:/var/lib/postgresql/data" -v "$ARCHIVE_DIR:/archive:ro" "$IMG" \
  postgres -D /etc/postgresql -c "restore_command=cp /archive/%f %p" -c recovery_target_action=promote -c archive_mode=off >/dev/null
for _ in $(seq 1 90); do docker exec "$SCRATCH" psql -h localhost -U supabase_admin -d postgres -Atc "select not pg_is_in_recovery()" 2>/dev/null | grep -q t && break; sleep 2; done
docker exec "$SCRATCH" psql -h localhost -U supabase_admin -d postgres -Atc "select not pg_is_in_recovery()" | grep -q t || { echo "the restored copy did not finish recovering" >&2; docker logs --tail 15 "$SCRATCH" >&2; exit 1; }
restored="$(docker exec "$SCRATCH" psql -h localhost -U supabase_admin -d postgres -Atc "$COUNTS")"
# Counted at the archived point on both sides, every table must match; a difference is a fault, said by table.
diffs="$(diff <(tr ' ' '\n' <<<"$restored") <(tr ' ' '\n' <<<"$running") | grep -c '^[<>]' || true)"
tables="$(tr ' ' '\n' <<<"$restored" | grep -c .)"
if [ "$diffs" = 0 ]; then echo "drill passed: $(basename "$LATEST") + WAL restored, $tables tables, every count equal to the running database (unlogged tables, such as rate_limits, start empty after a restore by design and are not compared)"; exit 0; fi
echo "drill: $(basename "$LATEST") + WAL restored, $tables tables; these differ from the running database (work since the last archived minute, or a fault):"
diff <(tr ' ' '\n' <<<"$restored") <(tr ' ' '\n' <<<"$running") | grep '^[<>]' | head -10; exit 1
