#!/usr/bin/env bash
# Starts RoleMatch's own PostgreSQL on the PC (ADR-004 phase 2), beside live and without touching it. Run as root inside WSL:
#   deploy/db/run-db.sh <name> <host-port>        e.g. rm-db 5433   (a rehearsal or drill uses another name and port)
# Secrets are made once, root-only, in /etc/rolematch/db/<name>/, and never printed. The port is published on 127.0.0.1 only.
# After the first start it creates the backup stanza and takes the first full backup, so recovery works from minute one.
set -euo pipefail
NAME="${1:?name}"; PORT="${2:?host port}"; HERE="$(cd "$(dirname "$0")" && pwd)"
SECRETS="/etc/rolematch/db/$NAME"; IMAGE="rolematch-db:$(sha256sum "$HERE"/{Dockerfile,rolematch.conf,pgbackrest.conf,00-roles.sh,app-role.sql,pgbackrest-keyed} | sha256sum | cut -c1-12)"
umask 077; mkdir -p "$SECRETS"
for s in postgres rm_migrate rm_app rm_readonly backup-key; do [ -s "$SECRETS/$s" ] || openssl rand -base64 33 | tr -d '\n/+=' > "$SECRETS/$s"; done
# The container's postgres user (uid 999) must read the files it is given. Each file is mounted on its own, so the folder itself stays root-only on the host
# (mounting the folder would need it opened to uid 999, which on the PC is not a user but the systemd-journal group's number).
chown 999 "$SECRETS"/*; chgrp root "$SECRETS"/*; chmod 400 "$SECRETS"/*
MOUNTS=(); for s in postgres rm_migrate rm_app rm_readonly backup-key; do MOUNTS+=(-v "$SECRETS/$s:/run/secrets/$s:ro"); done
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -q -t "$IMAGE" "$HERE" >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped --memory 2g --shm-size 256m \
  -p "127.0.0.1:$PORT:5432" \
  -v "$NAME-data:/var/lib/postgresql/data" -v "$NAME-backups:/var/lib/pgbackrest" "${MOUNTS[@]}" \
  -e POSTGRES_DB=rolematch -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres -e PGDATA=/var/lib/postgresql/data/pgdata \
  --label org.rolematch.role=database "$IMAGE" >/dev/null
# TCP, not the socket: during first-time setup a temporary server answers on the socket only.
for i in $(seq 1 120); do docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres -d rolematch 2>/dev/null && break; sleep 1; done
docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres -d rolematch || { echo "$NAME did not become ready"; docker logs --tail 30 "$NAME"; exit 1; }
pb() { docker exec -u postgres "$NAME" pgbackrest-keyed --stanza=rolematch "$@"; }
pb stanza-create >/dev/null 2>&1 || true
pb check >/dev/null
pb info --output=json | grep -q '"label"' || pb --type=full backup >/dev/null
echo "$NAME ready on 127.0.0.1:$PORT ($IMAGE); backups: $(pb info --output=json | grep -o '"label":"[^"]*"' | wc -l) in the repository"
