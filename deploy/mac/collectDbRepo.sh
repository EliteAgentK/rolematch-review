#!/usr/bin/env bash
# Every 5 minutes the Mac copies the changes in RoleMatch's own database backup store (pgBackRest's repository, encrypted on the PC with a key the Mac does
# not hold) into ~/RoleMatchBackups/db-repo, over the existing key-only connection, and marks on the PC that it did, which the PC's daily check reads.
# With WAL closed at least every 60 s on the PC, a lost PC loses at most about 6 minutes of changes (docs/database/07, the review's §3.3).
set -euo pipefail
. "$(dirname "$0")/pc.conf"; KEY="$HOME/.ssh/rolematch_dell"; DEST="$HOME/RoleMatchBackups/db-repo"
umask 077; mkdir -p "$DEST"
rsync -a --delete -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20" --rsync-path="wsl -d RoleMatch -u root -- rsync" \
  "$PC:/var/lib/docker/volumes/rm-db-backups/_data/" "$DEST/"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$PC" "wsl -d RoleMatch -u root -- touch /srv/rolematch/backups/.db-repo-collected-by-mac"
