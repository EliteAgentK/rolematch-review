#!/usr/bin/env bash
# Each night at 03:00 the Mac collects the PC's newest encrypted backups (records and accounts dumps, and the encrypted vault of originals) over the existing
# key-only connection, keeps 14 nights in ~/RoleMatchBackups, and marks on the PC that it did, which the PC's daily check looks for. The Mac opens the
# connection, so nothing new is opened on the Mac. Owner, 6 Nov 2026: the off-PC copy lives on the Mac's disk.
set -euo pipefail
. "$(dirname "$0")/pc.conf"; KEY="$HOME/.ssh/rolematch_dell"; DEST="$HOME/RoleMatchBackups"; STAMP="$(date +%Y%m%dT%H%M)"
umask 077; mkdir -p "$DEST/dumps" "$DEST/vault"
# Commands for the PC's Linux go base64-encoded: Windows' command line would otherwise split them at pipes and quotes.
on_pc() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$PC" "wsl -d RoleMatch -u root -- bash -c \"echo $(printf '%s' "$1" | base64 | tr -d '\n') | base64 -d | bash\""; }
# The dumps of the last two nights (anything already here is simply rewritten), then the vault as it stands.
on_pc 'cd /srv/rolematch/backups && find . -maxdepth 1 -type f -name "*.enc" -mtime -2 -print0 | tar --null -T - -cf -' | tar -x -C "$DEST/dumps"
on_pc 'cd /var/lib/docker/volumes/rolematch-pc-data/_data && tar -cf - originals-copy' | tar -x -C "$DEST/vault"
COUNT=$(find "$DEST/dumps" -type f -name "*.enc" -mtime -2 | wc -l | tr -d ' ')
[ "$COUNT" -ge 2 ] || { echo "$STAMP: fewer than 2 recent dumps arrived ($COUNT)"; exit 1; }
find "$DEST/dumps" -type f -name "*.enc" -mtime +14 -delete
on_pc 'touch /srv/rolematch/backups/.collected-by-mac'
echo "$STAMP: collected $COUNT recent dumps and the vault; $(du -sh "$DEST" | cut -f1) kept on the Mac"
