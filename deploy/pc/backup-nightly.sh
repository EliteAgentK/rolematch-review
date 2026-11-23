#!/usr/bin/env bash
# The nightly backup of live on the PC (WSL, root's cron): records and accounts as encrypted dumps, originals into the encrypted vault, 14 nights kept,
# using whichever release is running. The Mac collects a copy each night (deploy/mac/collectBackups.sh), so the PC's disk is never the only one.
# Since the move to the PC's own database, the dumps run as its owner role (migrate.env, root only; absent before the move, when nothing changes).
set -euo pipefail
export ROLEMATCH_ENV=/etc/rolematch/live.env ROLEMATCH_BACKUPS=/srv/rolematch/backups ROLEMATCH_DATA_VOLUME=rolematch-pc-data ROLEMATCH_DOCKER_NET=bridge ROLEMATCH_KEEP_DAYS=14 ROLEMATCH_BACKUP_DB_ENV=/etc/rolematch/migrate.env
RELEASE="$(docker inspect rm-api --format '{{.Config.Image}}' | cut -d: -f2)"; export RELEASE
exec "$(dirname "$0")/../backup.sh"
