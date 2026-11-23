#!/usr/bin/env bash
# The owner adds a console account, or sets an account's password again, here at the PC's terminal, as root. Typed twice, never shown, never stored.
# The console has two accounts at most (migration 052).
#   sudo /srv/rolematch/deploy/pc/console-password.sh                      add an account, or set its password again
#   sudo /srv/rolematch/deploy/pc/console-password.sh --remove <e-mail>    remove an account
# Also the break-glass reset for a forgotten password: it replaces the one account, signs out every session and e-mails the owner (docs/database/18_CONSOLE_V0.md).
set -euo pipefail
docker ps --format '{{.Names}}' | grep -qx rm-console || { echo "The console (rm-console) is not running; start it with deploy/mac/run.sh first."; exit 1; }
exec docker exec -it rm-console node src/scripts/consolePassword.js "$@"
