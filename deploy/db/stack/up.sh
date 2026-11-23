#!/usr/bin/env bash
# The database and sign-in pair for live's own home (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, C8): PostgreSQL 17.11 in Supabase's own image and Supabase
# Auth 2.197.0, the versions live runs, each on 127.0.0.1 only, with this pair's own secrets. Safe to run again: what exists is kept.
#   deploy/db/stack/up.sh <stack.env>       then: migrations as postgres (MIGRATE_DATABASE_URL), then deploy/db/stack/grant.sh <stack.env>
# stack.env (root only) names: NAME (rmn for the copy; rmx for the Mac's rehearsal), PG_PORT, AUTH_PORT, PG_VOLUME, ARCHIVE_DIR, KEYS_DIR (made by
# src/scripts/authKeys.js), POSTGRES_PASSWORD, AUTH_DB_PASSWORD, APP_DB_PASSWORD, SITE_URL, AUTH_URL, and optionally OTP_LENGTH, PASSKEYS, RP_ID, RP_ORIGINS.
set -euo pipefail
ENVF="${1:?the settings file of the stack}"; set -a; . "$ENVF"; set +a
for v in NAME PG_PORT AUTH_PORT PG_VOLUME ARCHIVE_DIR KEYS_DIR POSTGRES_PASSWORD AUTH_DB_PASSWORD APP_DB_PASSWORD SITE_URL AUTH_URL; do [ -n "${!v:-}" ] || { echo "missing $v in $ENVF" >&2; exit 2; }; done
case "$NAME" in rm|rmn|rmx) ;; *) echo "NAME must be rm, rmn or rmx" >&2; exit 2;; esac
for p in POSTGRES_PASSWORD AUTH_DB_PASSWORD APP_DB_PASSWORD; do [ "$(printf %s "${!p}" | wc -c)" -ge 24 ] || { echo "$p must be at least 24 characters" >&2; exit 2; }; done
for f in jwt_keys.json jwt_secret service_role.jwt; do [ -r "$KEYS_DIR/$f" ] || { echo "no $KEYS_DIR/$f: run src/scripts/authKeys.js first" >&2; exit 2; }; done
PG_IMAGE=public.ecr.aws/supabase/postgres:17.11.0.011; AUTH_IMAGE=public.ecr.aws/supabase/gotrue:v2.197.0; NET="$NAME-db-net"; HERE="$(cd "$(dirname "$0")" && pwd)"
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
# The WAL archive: every finished segment is copied here (and archive_timeout ends one at least every 60 s), so at most a minute of work is ever at risk.
# A folder (a path) is made and given to the database's own user; a Docker volume (a bare name) is made by Docker and handed over the same way.
PGUID=$(docker run --rm --entrypoint id "$PG_IMAGE" -u postgres)
case "$ARCHIVE_DIR" in
  /*) mkdir -p "$ARCHIVE_DIR"; chown "$PGUID" "$ARCHIVE_DIR"; chmod 700 "$ARCHIVE_DIR";;
  *) docker volume create "$ARCHIVE_DIR" >/dev/null; docker run --rm -v "$ARCHIVE_DIR:/archive" --entrypoint sh "$PG_IMAGE" -c "chown $PGUID /archive && chmod 700 /archive";;
esac
if ! docker inspect "$NAME-pg" >/dev/null 2>&1; then
  docker run -d --name "$NAME-pg" --network "$NET" --restart unless-stopped -p "127.0.0.1:$PG_PORT:5432" -e POSTGRES_PASSWORD --shm-size 256m \
    -v "$PG_VOLUME:/var/lib/postgresql/data" -v "$ARCHIVE_DIR:/archive" \
    --health-cmd "pg_isready -h localhost -U supabase_admin" --health-interval 10s --health-retries 6 --health-start-period 60s \
    "$PG_IMAGE" postgres -D /etc/postgresql -c max_connections=100 -c wal_level=replica -c archive_mode=on -c archive_timeout=60 \
      -c "archive_command=test ! -f /archive/%f && cp %p /archive/%f" >/dev/null
fi
for _ in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME-pg")" = healthy ] && break; sleep 2; done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME-pg")" = healthy ] || { echo "$NAME-pg did not become healthy" >&2; docker logs --tail 20 "$NAME-pg" >&2; exit 1; }
# Passwords and the application's login, as the image's superuser over its own socket; the values go in on standard input, never on a command line.
docker exec -i "$NAME-pg" psql -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres -v pg_pw="$POSTGRES_PASSWORD" -v auth_pw="$AUTH_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" < "$HERE/bootstrap.sql"
# Base copies (backup.sh) need a replication connection; the image allows none over its own socket. One line allows it for the superuser over that
# socket alone, which exists only inside the container. Applied on every run, because the line lives in the container, not in the data.
docker exec "$NAME-pg" sh -c 'f=$(psql -h localhost -U supabase_admin -d postgres -Atc "show hba_file"); grep -q "^local replication supabase_admin trust" "$f" || { sed -i "1i local replication supabase_admin trust" "$f"; psql -h localhost -U supabase_admin -d postgres -qAtc "select pg_reload_conf()" >/dev/null; }'
echo "$NAME-pg ready on 127.0.0.1:$PG_PORT"
# Sign-in: its settings file is written here, root only, and handed to the container; GoTrue builds and upgrades its own tables at start.
AUTHENV="$KEYS_DIR/auth.env"; umask 077
cat > "$AUTHENV" <<AUTH
GOTRUE_API_HOST=0.0.0.0
GOTRUE_API_PORT=9999
API_EXTERNAL_URL=$AUTH_URL
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:$AUTH_DB_PASSWORD@$NAME-pg:5432/postgres
GOTRUE_SITE_URL=$SITE_URL
GOTRUE_URI_ALLOW_LIST=$SITE_URL
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_EXTERNAL_PHONE_ENABLED=false
GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_MAILER_OTP_LENGTH=${OTP_LENGTH:-6}
GOTRUE_MAILER_OTP_EXP=3600
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_ISSUER=$AUTH_URL
GOTRUE_JWT_SECRET=$(cat "$KEYS_DIR/jwt_secret")
GOTRUE_JWT_KEYS=$(cat "$KEYS_DIR/jwt_keys.json")
GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL=10
GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For
GOTRUE_PASSKEY_ENABLED=${PASSKEYS:-false}
GOTRUE_WEBAUTHN_RP_DISPLAY_NAME=RoleMatch
GOTRUE_WEBAUTHN_RP_ID=${RP_ID:-localhost}
GOTRUE_WEBAUTHN_RP_ORIGINS=${RP_ORIGINS:-$SITE_URL}
GOTRUE_LOG_LEVEL=info
AUTH
if ! docker inspect "$NAME-auth" >/dev/null 2>&1; then
  docker run -d --name "$NAME-auth" --network "$NET" --restart unless-stopped -p "127.0.0.1:$AUTH_PORT:9999" --env-file "$AUTHENV" \
    --read-only --security-opt no-new-privileges:true --cap-drop ALL "$AUTH_IMAGE" gotrue >/dev/null
fi
for _ in $(seq 1 60); do curl -fsS --max-time 2 "http://127.0.0.1:$AUTH_PORT/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS --max-time 3 "http://127.0.0.1:$AUTH_PORT/health" >/dev/null || { echo "$NAME-auth did not answer" >&2; docker logs --tail 20 "$NAME-auth" >&2; exit 1; }
echo "$NAME-auth ready on 127.0.0.1:$AUTH_PORT ($(curl -fsS "http://127.0.0.1:$AUTH_PORT/health" | sed -E 's/.*"version":"([^"]+)".*/\1/'))"
