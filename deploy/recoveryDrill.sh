#!/usr/bin/env bash
# Proves a backup can be restored: backs up the rehearsal stack, wipes its records, accounts and files, restores, and checks that the same person signs in and finds the same record and a byte-identical original.
# Only on the disposable local stack: it refuses any other database. Needs deploy/rehearse.sh up.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ENVF="$HOME/.rolematch/rehearsal.env"; BASE=http://localhost:18795; IMG=rolematch:rehearsal
get() { grep "^$1=" "$ENVF" | cut -d= -f2-; }
DB="$(get DATABASE_URL)"; API="$(get SUPABASE_URL)"; KEY="$(get SUPABASE_SERVICE_ROLE_KEY)"
case "$DB$API" in *supabase.co*|*pooler*) echo "Refusing: not the local stack."; exit 1;; esac
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing: not the local stack."; exit 1;; esac
psql_() { docker run --rm --network host postgres:17-alpine psql "$DB" -v ON_ERROR_STOP=1 -tA -F ' | ' -c "$1"; }
COUNTS="select (select count(*) from orgs),(select count(*) from portals),(select count(*) from candidates),(select count(*) from jobs),(select count(*) from documents),(select count(*) from matches),(select count(*) from portal_members),(select count(*) from audit_events),(select count(*) from auth.users)"
JAR="$(mktemp)"; WHO="tests+drill$(date +%s)@rolematch.invalid"; PW="drill-$(openssl rand -hex 8)-A1!"
docker run --rm --network host --env-file "$ENVF" "$IMG" node src/scripts/createUser.js "Drill Org $(date +%s)" "$WHO" "Drill Person" "$PW" >/dev/null
login() { curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H "origin: $BASE" -H 'content-type: application/json' -d "{\"email\":\"$WHO\",\"password\":\"$PW\"}" "$BASE/api/auth/login"; }
[ "$(login)" = 200 ] || { echo "Could not sign in before the backup"; exit 1; }
DOC="$(curl -s -b "$JAR" -H "origin: $BASE" -F kind=cv -F "file=@$ROOT/server/test/fixtures/journey/CV0501.docx" "$BASE/api/documents" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
for _ in $(seq 1 60); do REC="$(curl -s -b "$JAR" -H "origin: $BASE" "$BASE/api/documents/$DOC" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("recordId") or "")')"; [ -n "$REC" ] && break; sleep 2; done
[ -n "$REC" ] || { echo "The document did not publish"; exit 1; }
HASH_BEFORE="$(curl -s -b "$JAR" -H "origin: $BASE" "$BASE/api/documents/$DOC/original" | shasum -a 256 | cut -d' ' -f1)"
NAME_BEFORE="$(curl -s -b "$JAR" -H "origin: $BASE" "$BASE/api/candidates/$REC" | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')"
BEFORE="$(psql_ "$COUNTS")"; echo "before:   $BEFORE"
"$ROOT/deploy/rehearse.sh" backup | tail -2
STAMP="$(ls -t "$HOME"/.rolematch/backups/*.records.dump.enc | head -1 | sed 's/\.records\.dump\.enc$//')"
ls -l "$STAMP".*.enc | awk '{print "  dump bytes:", $5}'
PATHS="$(psql_ "select storage_path from documents")"
docker stop iso-api iso-worker >/dev/null
for p in $PATHS; do curl -s -o /dev/null -X DELETE -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$API/storage/v1/object/originals/$p"; done
TABLES="$(psql_ "select string_agg(format('%I', tablename), ',') from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'")"
psql_ "set session_replication_role = replica; truncate $TABLES cascade; delete from auth.identities; delete from auth.users;" >/dev/null
echo "wiped:    $(psql_ "$COUNTS")"
T0=$(date +%s); "$ROOT/deploy/rehearse.sh" restore "$STAMP" | tail -2; T1=$(date +%s)
docker start iso-api iso-worker >/dev/null
for _ in $(seq 1 60); do curl -sf "$BASE/api/ready" >/dev/null && break; sleep 2; done
AFTER="$(psql_ "$COUNTS")"; echo "restored: $AFTER  ($((T1 - T0)) s)"
fail=0; [ "$BEFORE" = "$AFTER" ] || { echo "FAIL: counts differ"; fail=1; }
[ "$(login)" = 200 ] && echo "PASS the same person signs in with the same password" || { echo "FAIL sign-in"; fail=1; }
NAME_AFTER="$(curl -s -b "$JAR" -H "origin: $BASE" "$BASE/api/candidates/$REC" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("name"))')"
[ "$NAME_BEFORE" = "$NAME_AFTER" ] && echo "PASS the same record is there" || { echo "FAIL record"; fail=1; }
HASH_AFTER="$(curl -s -b "$JAR" -H "origin: $BASE" "$BASE/api/documents/$DOC/original" | shasum -a 256 | cut -d' ' -f1)"
[ "$HASH_BEFORE" = "$HASH_AFTER" ] && echo "PASS the original is byte-identical" || { echo "FAIL original"; fail=1; }
rm -f "$JAR"; [ "$fail" = 0 ] && echo "Recovery drill passed." || { echo "Recovery drill FAILED."; exit 1; }
