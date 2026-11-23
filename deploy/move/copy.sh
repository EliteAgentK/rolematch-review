#!/usr/bin/env bash
# Copies everything live holds into its new home, and proves the two are the same (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, section 6). Reads the
# source only. Used for the rehearsal on the Mac, for each refresh of the copy on the PC, and at the switch.
#   ROLEMATCH_IMAGE=rolematch:<commit> deploy/move/copy.sh <source app settings> <target stack settings> <target app settings>
# 1. The target's shape must already be the source's: the same migrations applied (its own migrations made it; a dump never does).
# 2. Records and sign-in (accounts, identities, sessions, refresh tokens, sign-in methods), as data only, in one transaction: all of it or none.
# 3. Proof: every table's row count and a checksum of its rows (as JSON, in order, in UTC), on both sides; any difference fails the copy.
# 4. Every original into the target's encrypted vault, each read back and checked against the bytes that were copied.
# Settings: MOVE_NET (the Docker network that reaches the source; host on the PC), SOURCE_DATABASE_URL and SOURCE_SUPABASE_URL (to reach the source another
# way than its settings say), SOURCE_SCHEMA (the Mac's rehearsal only: its records are in schema "rehearsal" and go into the target's public schema).
set -euo pipefail
SRC="${1:?source app settings}"; STACK="${2:?target stack settings}"; DST="${3:?target app settings}"; IMG="${ROLEMATCH_IMAGE:?rolematch:<commit>}"
HERE="$(cd "$(dirname "$0")" && pwd)"; NET="${MOVE_NET:-host}"; NAME="$(grep '^NAME=' "$STACK" | cut -d= -f2)"; T="$NAME-pg"; SCH="${SOURCE_SCHEMA:-public}"
case "$SCH" in public) ;; rehearsal) [ "$NAME" = rmx ] || { echo "SOURCE_SCHEMA is for the Mac's rehearsal pair (rmx) only" >&2; exit 2; };; *) echo "SOURCE_SCHEMA must be public or rehearsal" >&2; exit 2;; esac
docker inspect "$T" >/dev/null 2>&1 || { echo "no target database $T" >&2; exit 2; }
SRC_URL="${SOURCE_DATABASE_URL:-$(grep '^DATABASE_URL=' "$SRC" | cut -d= -f2-)}"; [ -n "$SRC_URL" ] || { echo "no source DATABASE_URL" >&2; exit 2; }
WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "${WORK:?}"' EXIT; umask 077
printf 'DATABASE_URL=%s\nSCH=%s\n' "$SRC_URL" "$SCH" > "$WORK/src.env"
TLS=(); case "$SRC_URL" in *@localhost*|*@127.*|*@host.docker*|*@supabase_db_*) ;; *) TLS=(-v "$HERE/../certs/supabase-root-2021.pem:/ca.pem:ro" -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.pem);; esac
# Inside the source's container, $DATABASE_URL and $SCH come from its settings file, so no address or password is ever on a command line.
src() { docker run --rm -i --network "$NET" --env-file "$WORK/src.env" -e PGTZ=UTC ${TLS[@]+"${TLS[@]}"} postgres:17-alpine sh -c "$1"; }
dst() { docker exec -i -e PGTZ=UTC "$T" psql -v ON_ERROR_STOP=1 -q -At -U supabase_admin -d postgres "$@"; }

# 1. The same shape.
src 'psql "$DATABASE_URL" -At -c "select name from $SCH.schema_migrations order by 1"' > "$WORK/src.mig"
dst -c "select name from public.schema_migrations order by 1" > "$WORK/dst.mig"
cmp -s "$WORK/src.mig" "$WORK/dst.mig" || { echo "REFUSED: the target's migrations differ from the source's (migrate the target first):"; diff "$WORK/src.mig" "$WORK/dst.mig" | head; exit 3; }
echo "shape: the same $(wc -l < "$WORK/src.mig" | tr -d ' ') migrations on both sides"

# 2 and 3. The data, then the proof. The target is emptied and filled in one transaction (replica mode: links and triggers are the source's, already
# checked there). The proof is a count and a checksum per table, the same query on both sides (the source's schema named as the target's), taken on the
# source just before and just after the copy: if the source changed meanwhile (live keeps working while a copy is refreshed), the copy is taken again,
# up to five times. At the switch saving is paused, so the first attempt is the last.
TABLES="select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by 1) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth') and c.relname <> 'schema_migrations'"
EMPTY="$(dst -c "$TABLES")"
RENAME=(cat); [ "$SCH" = public ] || RENAME=(sed -E "s/^COPY $SCH\\./COPY public./; s/setval\\('$SCH\\./setval('public./")
sums() { echo "select format('select %L || ''|'' || count(*) || ''|'' || md5(coalesce(string_agg(to_jsonb(t)::text, '''' order by to_jsonb(t)::text), '''')) from %I.%I t;', (case when n.nspname = '$1' then 'public' else n.nspname end) || '.' || c.relname, n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('$1','auth') and c.relname <> 'schema_migrations' order by n.nspname, c.relname"; }
srcsums() { sums "$SCH" | src 'psql "$DATABASE_URL" -At -f - | psql "$DATABASE_URL" -At' | sort; }
for attempt in 1 2 3 4 5; do
  srcsums > "$WORK/src.before"
  { echo "set session_replication_role = replica; truncate $EMPTY cascade;"
    src 'pg_dump "$DATABASE_URL" --data-only --no-owner --no-privileges --schema="$SCH" --schema=auth --exclude-table="$SCH.schema_migrations" --exclude-table=auth.schema_migrations' | "${RENAME[@]}"
    echo "set session_replication_role = origin;"; } | dst -1 >/dev/null
  srcsums > "$WORK/src.sum"
  dst -c "$(sums public)" | dst | sort > "$WORK/dst.sum"
  if cmp -s "$WORK/src.before" "$WORK/src.sum"; then break; fi
  echo "the source changed while it was being copied (attempt $attempt): taking the copy again"; [ "$attempt" = 5 ] && { echo "FAILED: the source kept changing; copy again when it is quieter, or with saving paused"; exit 5; }
done
echo "data: copied in one transaction"
if ! cmp -s "$WORK/src.sum" "$WORK/dst.sum"; then echo "FAILED: these tables differ (table|rows|checksum, source then target):"; diff "$WORK/src.sum" "$WORK/dst.sum" | head -20; exit 4; fi
echo "proof: $(wc -l < "$WORK/src.sum" | tr -d ' ') tables, $(awk -F'|' '{s+=$2} END {print s}' "$WORK/src.sum") rows, every count and checksum equal"

# 4. The originals, into the target's vault (in its data volume), each read back and checked. The list comes from the same schema that was copied.
VOL="$(grep '^ROLEMATCH_DATA_VOLUME=' "$DST" | cut -d= -f2)"; VOL="${VOL:-${TARGET_DATA_VOLUME:?the target data volume}}"
STORE="$(grep '^STORE_DIR=' "$DST" | cut -d= -f2)"; grep '^VAULT_KEYS=' "$DST" > "$WORK/vault.env" || { echo "no VAULT_KEYS in the target settings" >&2; exit 2; }
printf 'VAULT_DIR=%s\n' "${STORE:?STORE_DIR in the target settings}" >> "$WORK/vault.env"
grep -v -E '^(STORE_DIR|DB_SCHEMA|DATABASE_URL|SUPABASE_URL)=' "$SRC" > "$WORK/src-app.env"
printf 'DB_SCHEMA=%s\nDATABASE_URL=%s\nSUPABASE_URL=%s\n' "$SCH" "$SRC_URL" "${SOURCE_SUPABASE_URL:-$(grep '^SUPABASE_URL=' "$SRC" | cut -d= -f2-)}" >> "$WORK/src-app.env"
docker run --rm --network "$NET" --env-file "$WORK/src-app.env" --env-file "$WORK/vault.env" -v "$VOL:/data" "$IMG" node src/scripts/copyIntoVault.js | tail -1
echo "files: every original copied into the vault and read back"
