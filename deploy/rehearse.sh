#!/usr/bin/env bash
# Its own port, 18795, outside the range the tests use: a development server may hold 8787. Runs the live containers on this machine, with the same limits and restart rule (deploy/limits.sh), against the disposable local Supabase and a simulated mail host, so the whole journey can be proven before a server exists.
# Never touches a hosted project or real mail: the addresses are fixed to this machine. Needs Colima, `supabase start`, and an image: docker build -t rolematch:rehearsal .
#   deploy/rehearse.sh up | check | backup | restore <stamp path> | down; the recovery drill is deploy/recoveryDrill.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ENVFILE="$HOME/.rolematch/rehearsal.env"; IMG=rolematch:rehearsal; VOL=rolematch-rehearsal-data
. "$ROOT/deploy/limits.sh"
LOCK=(--network host --env-file "$ENVFILE" --restart "$RESTART_RULE" --security-opt no-new-privileges:true --cap-drop ALL --read-only --tmpfs /tmp:size=1g -v "$VOL:/data")
sink_pid() { cat "$HOME/.rolematch/mailsink.pid" 2>/dev/null || true; }
claude_pid() { cat "$HOME/.rolematch/fakeclaude.pid" 2>/dev/null || true; }
# On the Mac the containers run in Colima's VM and reach this machine as host.lima.internal, through small bridges. On Linux (the PC) they share this machine's network and need none.
ON_LINUX=""; [ "$(uname -s)" = Linux ] && ON_LINUX=1
# The rehearsal's own stand-in for Claude, on a port of its own: on 11 Nov 2026 a stand-in another session had left running on the old shared port
# answered instead, with yesterday's code, and two checks failed for a reason that was not the release. A port already taken stops the rehearsal.
CLAUDE_PORT="${REHEARSAL_CLAUDE_PORT:-18941}"
# Inside Colima the bridge listens on a port of its own: Colima copies every port opened inside it onto the Mac, so a bridge on the stand-in's own
# number took that port first after a restart and the stand-in could not start (11 Nov 2026). On Linux there is no bridge.
BRIDGE_PORT=$((CLAUDE_PORT + 1)); AI_PORT=$([ -n "$ON_LINUX" ] && echo "$CLAUDE_PORT" || echo "$BRIDGE_PORT")

[ "${1:-}" = up ] || "$ROOT/deploy/preflight.sh" rehearsal || exit 3
case "${1:-}" in
up)
  install -d -m 700 "$HOME/.rolematch"
  ( cd "$ROOT" && supabase status -o env ) > /tmp/rm-stack.env
  . /tmp/rm-stack.env; rm -f /tmp/rm-stack.env
  case "$API_URL$DB_URL" in *supabase.co*|*pooler*) echo "Not a local stack."; exit 1;; esac
  ( umask 077; cat > "$ENVFILE" <<EOF
SUPABASE_URL=$API_URL
DATABASE_URL=$DB_URL
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY:-$SECRET_KEY}
PUBLIC_APP_URL=https://live.rolematch.invalid
ALLOWED_ORIGINS=http://localhost:18795
PORT=18795
# Its own database area: no other server on this machine (a developer's, another session's) can take its queued work (11 Nov 2026: a local
# server left running from the day before failed the rehearsal's match checks with its own old code).
DB_SCHEMA=rehearsal
ROLEMATCH_ENVIRONMENT=rehearsal
SIGNUP_MODE=${SIGNUP_MODE:-invite}
SIGNUP_ALLOWED_EMAILS=tests+*@rolematch.invalid
SIGNUP_REQUIRE_CODE=true
MAIL_TRANSPORT=smtp
MAIL_SEND_MODE=${MAIL_SEND_MODE:-allowlist}
MAIL_ALLOWED_RECIPIENTS=tests+*@rolematch.invalid
MAIL_FROM=RoleMatch <info@rolematch.invalid>
MAIL_SMTP_HOST=127.0.0.1
MAIL_SMTP_PORT=2525
MAIL_SMTP_SECURITY=none
LOCAL_ENCRYPTION_KEY=$(openssl rand -base64 32)
OPS_TOKEN=$(openssl rand -hex 32)
BACKUP_KEY=$(openssl rand -hex 32)
# A rehearsal never spends on the AI, but it runs live's path: CVs and job descriptions are read by the AI, and matches are checked by it, as on live
# (11 Nov 2026: the rehearsal had read CVs by the old parser, so a fault in the AI's reading could reach live unseen). Every question goes to a stand-in
# on this machine (server/test/live/fakeClaude.ts): the key below is not a real one, and the AI worker is the only container that holds it.
AI_READING=on
AI_MATCHING=on
AI_KEY_IN_AI_WORKER=1
CANDIDATE_PIPELINE=all
REVIEW_ALL_SCANS=true
EOF
  )
  # Each stand-in's own process number is kept (not a wrapper's), so "down" stops exactly it (11 Nov 2026: stand-ins from earlier runs had survived for days).
  ( cd "$ROOT/server" || exit 1; nohup node --import tsx test/live/mailSink.ts 2525 2526 > /tmp/rm-mailsink.log 2>&1 & echo $! > "$HOME/.rolematch/mailsink.pid" )
  if (exec 3<>/dev/tcp/127.0.0.1/2525) 2>/dev/null; then echo "Port 2525 (the mail stand-in's) is already taken: stop what holds it."; exit 1; fi
  if (exec 3<>/dev/tcp/127.0.0.1/$CLAUDE_PORT) 2>/dev/null; then echo "Port $CLAUDE_PORT is already taken: stop what holds it or set REHEARSAL_CLAUDE_PORT."; exit 1; fi
  ( cd "$ROOT/server" || exit 1; nohup node --import tsx test/live/fakeClaude.ts $CLAUDE_PORT > /tmp/rm-fakeclaude.log 2>&1 & echo $! > "$HOME/.rolematch/fakeclaude.pid" )
  docker rm -f iso-mail-bridge iso-claude-bridge iso-api iso-worker iso-ai-worker >/dev/null 2>&1 || true
  # The containers may only reach a mail host on 127.0.0.1 without encryption; this carries that port to the sink on the Mac.
  [ -n "$ON_LINUX" ] || docker run -d --name iso-mail-bridge --network host --no-healthcheck --entrypoint node "$IMG" -e "const n=require('net');n.createServer(c=>{const u=n.connect(2525,'host.lima.internal');c.pipe(u);u.pipe(c);c.on('error',()=>u.destroy());u.on('error',()=>c.destroy())}).listen(2525,'127.0.0.1')" >/dev/null
  [ -n "$ON_LINUX" ] || docker run -d --name iso-claude-bridge --network host --no-healthcheck --entrypoint node "$IMG" -e "const n=require('net');n.createServer(c=>{const u=n.connect($CLAUDE_PORT,'host.lima.internal');c.pipe(u);u.pipe(c);c.on('error',()=>u.destroy());u.on('error',()=>c.destroy())}).listen($BRIDGE_PORT,'127.0.0.1')" >/dev/null
  docker run --rm --network host --env-file "$ENVFILE" "$IMG" node src/scripts/migrate.js
  docker exec supabase_db_rolematch psql -U postgres -c "truncate rehearsal.rate_limits" >/dev/null   # earlier rehearsals on this one address must not count against this one
  docker run -d --name iso-api "${LOCK[@]}" -e ROLE=api -e DB_POOL_SIZE="$DB_POOL_API" -m "$API_MEMORY" "$IMG" >/dev/null
  docker run -d --name iso-ai-worker "${LOCK[@]}" -e WORKER_HEALTH_PORT=18797 -e WORKER_JOBS=model -e WORKER_CONCURRENCY=4 -e AI_KEY_IN_AI_WORKER=0 -e ANTHROPIC_API_KEY=sk-ant-test-not-a-real-key -e ANTHROPIC_BASE_URL=http://127.0.0.1:$AI_PORT -m "$WORKER_MEMORY" "$IMG" node src/worker.js >/dev/null
  docker run -d --name iso-worker "${LOCK[@]}" -e WORKER_HEALTH_PORT=18796 -e WORKER_JOBS=documents -e WORKER_CONCURRENCY=1 -e PER_ORG_CONCURRENCY=1 -e DB_POOL_SIZE="$DB_POOL_WORKER" -m "$WORKER_MEMORY" "$IMG" node src/worker.js >/dev/null
  for _ in $(seq 1 60); do curl -sf http://localhost:18795/api/ready >/dev/null && break; sleep 2; done
  curl -s http://localhost:18795/api/ready; echo; curl -s http://localhost:18795/api/health/mail; echo
  ;;
check)
  shift
  cd "$ROOT"
  E2E_OPS_TOKEN="$(grep '^OPS_TOKEN=' "$ENVFILE" | cut -d= -f2-)" E2E_EXPECT_COMMIT=${E2E_EXPECT_COMMIT:-rehearsal} E2E_BASE=http://localhost:18795 E2E_MAILBOX=${E2E_MAILBOX:-tests@rolematch.invalid} E2E_INBOX_URL=http://127.0.0.1:2526 E2E_LINK_ORIGIN=https://live.rolematch.invalid \
  E2E_STANDIN_AI=1 E2E_CREATE_USER="docker run --rm --network host --env-file $ENVFILE $IMG node src/scripts/createUser.js" npx playwright test -c playwright.hosted.config.ts "$@"
  ;;
backup)
  ROLEMATCH_ENV="$ENVFILE" ROLEMATCH_BACKUPS="$HOME/.rolematch/backups" RELEASE=rehearsal ROLEMATCH_DATA_VOLUME="$VOL" ROLEMATCH_DOCKER_NET=host "$ROOT/deploy/backup.sh"
  ;;
restore)
  ROLEMATCH_ENV="$ENVFILE" RELEASE=rehearsal ROLEMATCH_DATA_VOLUME="$VOL" ROLEMATCH_DOCKER_NET=host "$ROOT/deploy/restore.sh" "$2"
  ;;
down)
  docker rm -f iso-mail-bridge iso-claude-bridge iso-api iso-worker iso-ai-worker >/dev/null 2>&1 || true
  [ -n "$(sink_pid)" ] && kill "$(sink_pid)" 2>/dev/null || true
  [ -n "$(claude_pid)" ] && kill "$(claude_pid)" 2>/dev/null || true
  ;;
*) echo "up | check | backup | restore <file> | down"; exit 2;;
esac
