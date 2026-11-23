#!/usr/bin/env bash
# Installs the Mac's RoleMatch background jobs. Their scripts are copied to ~/rolematch-ops/bin first: macOS does not let a background job read files
# inside ~/Documents ("Operation not permitted", found 6 Nov 2026), so a job pointing into this repository never runs. Rerun after changing a script.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; BIN="$HOME/rolematch-ops/bin"; AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$BIN" "$HOME/RoleMatchBackups"
for s in collectBackups.sh collectDbRepo.sh; do install -m 700 "$HERE/$s" "$BIN/$s"; done
install -m 600 "$HERE/pc.conf" "$BIN/pc.conf"; . "$HERE/pc.conf"; [ -n "${PC:-}" ] || { echo "no PC= in pc.conf" >&2; exit 2; }
for p in com.rolematch.backup-collect com.rolematch.db-repo-collect; do
  sed "s#/Users/modizy/Documents/ChatGPT/Talent Hub/deploy/mac/#$BIN/#" "$HERE/$p.plist" > "$AGENTS/$p.plist"
  launchctl unload "$AGENTS/$p.plist" 2>/dev/null || true
  launchctl load "$AGENTS/$p.plist"
done
# The keep-alive that holds the PC's Linux open, with the same address
sed "s#__PC__#$PC#" "$HERE/com.rolematch.pc-keepalive.plist" > "$AGENTS/com.rolematch.pc-keepalive.plist"
launchctl unload "$AGENTS/com.rolematch.pc-keepalive.plist" 2>/dev/null || true
launchctl load "$AGENTS/com.rolematch.pc-keepalive.plist"
echo "installed: $(launchctl list | grep -cE 'com.rolematch.(backup|db-repo)-collect') jobs, scripts in $BIN"
