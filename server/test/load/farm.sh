#!/usr/bin/env bash
# Several API servers on the Mac against the disposable database in the VM, for testing that the service scales out and for crowds too big for the VM's port forward (register R111). The tunnel here is its own connection, separate from the one that carries Docker control. Disposable stack only.
#   server/test/load/farm.sh up <servers> <connections each> [extra env KEY=VALUE ...] | down | ports
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; RUN="$HOME/.rolematch/load/farm"; ENVF="$HOME/.rolematch/rehearsal.env"; mkdir -p "$RUN"
stop() { for f in "$RUN"/*.pid; do [ -e "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done; }
case "${1:-}" in
up)
  N="$2"; POOL="$3"; shift 3; stop
  grep -Eq '^DATABASE_URL=.*@(127\.0\.0\.1|localhost)' "$ENVF" || { echo "Refusing: not the disposable stack."; exit 2; }
  ssh -F "$HOME/.colima/_lima/colima/ssh.config" -S none -o ControlMaster=no -o Compression=no -c aes128-gcm@openssh.com -o ServerAliveInterval=20 -N -L 127.0.0.1:54399:127.0.0.1:54322 lima-colima > "$RUN/tunnel.log" 2>&1 & echo $! > "$RUN/tunnel.pid"
  sleep 1.5
  DB="$(grep '^DATABASE_URL=' "$ENVF" | cut -d= -f2- | sed -E 's/:[0-9]+\//:54399\//')"
  # A clean copy of what is committed: no development settings file can reach it, and edits in the working tree cannot change a test while it runs.
  rm -rf "$RUN/code"; mkdir -p "$RUN/code"; git -C "$ROOT" archive HEAD server supabase | tar -x -C "$RUN/code"; ln -s "$ROOT/server/node_modules" "$RUN/code/server/node_modules"
  cd "$RUN/code/server"
  for i in $(seq 1 "$N"); do
    PORT=$((18800 + i))
    env "$@" PORT=$PORT ROLE=api NODE_ENV=production COOKIE_SECURE=true TRUST_PROXY=true DATABASE_URL="$DB" SUPABASE_URL=http://127.0.0.1:54321 DB_POOL_SIZE="$POOL" RATE_LOG=off node --env-file="$ENVF" --import tsx src/index.ts > "$RUN/api-$i.log" 2>&1 & echo $! > "$RUN/api-$i.pid"
  done
  for i in $(seq 1 "$N"); do for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:$((18800 + i))/api/ready" >/dev/null && break; sleep 1; done; curl -s -m 2 -o /dev/null -w "server $i %{http_code}\n" "http://127.0.0.1:$((18800 + i))/api/ready"; done
  ;;
down) stop; echo stopped ;;
*) echo "up <servers> <connections> [KEY=VALUE ...] | down"; exit 2 ;;
esac
