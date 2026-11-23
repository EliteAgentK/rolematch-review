#!/usr/bin/env bash
# A full copy of the database and sign-in pair's PostgreSQL (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, backups), taken while it runs:
#   deploy/db/stack/backup.sh <stack.env> <backup folder>
# The copy (pg_basebackup, tar, compressed) plus the WAL archived every 60 s (ARCHIVE_DIR) is enough to bring the database back to any minute since. Each
# copy is written root-only, then an encrypted twin (*.enc, BACKUP_KEY from live's settings, the same key as the copy's, AES-256) is made for leaving the PC. Copies and archived WAL
# older than KEEP_DAYS (14) are removed, never the newest copy. Prints one line; a failure exits non-zero and leaves the earlier copies untouched.
set -euo pipefail
ENVF="${1:?the settings file of the stack}"; OUT="${2:?the backup folder}"; set -a; . "$ENVF"; set +a
APPENV="${STACK_APP_ENV:-/etc/rolematch/live.env}"; KEEP="${KEEP_DAYS:-14}"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_KEY="$(grep '^BACKUP_KEY=' "$APPENV" | cut -d= -f2-)"; [ -n "$BACKUP_KEY" ] || { echo "no BACKUP_KEY in $APPENV" >&2; exit 2; }
umask 077; mkdir -p "$OUT/$STAMP.part"
# The base copy, through the container's own socket as the superuser; WAL is not included in it (-X none): the archive has it, minute by minute.
docker exec -u postgres "${NAME:?}-pg" sh -c "rm -rf /tmp/base && pg_basebackup -h /var/run/postgresql -U supabase_admin -D /tmp/base -Ft -z -X none -c fast -l rolematch-$STAMP"
docker cp "$NAME-pg:/tmp/base/." "$OUT/$STAMP.part/" >/dev/null && docker exec -u postgres "$NAME-pg" rm -rf /tmp/base
[ -s "$OUT/$STAMP.part/base.tar.gz" ] || { echo "the base copy is empty" >&2; exit 1; }
mv "$OUT/$STAMP.part" "$OUT/$STAMP"
tar -C "$OUT" -cf - "$STAMP" | BACKUP_KEY="$BACKUP_KEY" openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_KEY -out "$OUT/$STAMP.tar.enc"
# The newest copy is always kept, whatever its age; WAL older than the oldest kept copy is not needed for it and goes too.
ls -1d "$OUT"/2*Z 2>/dev/null | sort | sed '$d' | while read -r d; do [ -n "$(find "$d" -maxdepth 0 -mtime +"$KEEP")" ] && rm -rf "${d:?}" "${d:?}.tar.enc"; done
case "$ARCHIVE_DIR" in /*) find "$ARCHIVE_DIR" -type f -mtime +"$KEEP" -delete;; esac
echo "base copy $STAMP: $(du -sh "$OUT/$STAMP" | cut -f1) ($(du -sh "$OUT/$STAMP.tar.enc" | cut -f1) encrypted); WAL archived: $(ls "$ARCHIVE_DIR" 2>/dev/null | wc -l | tr -d ' ') files"
