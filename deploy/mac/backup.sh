#!/usr/bin/env bash
# The nightly backup of the live service on the Mac bridge: records and accounts as encrypted dumps, originals into the encrypted vault, using whichever release is running. Register R97, R98, R104.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" ROLEMATCH_ENV="$HOME/.rolematch/mac.env" ROLEMATCH_BACKUPS="$HOME/.rolematch/backups" ROLEMATCH_DATA_VOLUME=rolematch-mac-data
RELEASE="$(docker inspect rm-api --format '{{.Config.Image}}' | cut -d: -f2)"; export RELEASE
exec "$ROOT/backup.sh"
