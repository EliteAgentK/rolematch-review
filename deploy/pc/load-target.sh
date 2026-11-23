#!/usr/bin/env bash
# The load target (docs/ops/TRENDS_AND_LOAD.md): the same image as live, on the same PC, so a load test measures the PC's real capacity, but pointed at the
# PC's throw-away test database, with the AI off and e-mail off. Live's data, accounts and AI credit are never touched. Run as root inside the RoleMatch WSL:
#   deploy/pc/load-target.sh up <commit> [companies] [recruiters each]   default 8 companies of 10 recruiters
#   deploy/pc/load-target.sh down                                         removes the target and everything the test made
# While the target is up, a watchdog asks live's health every 15 seconds; if it is slow or incomplete twice in a row (as deploy/pc/test-suite.sh, R166),
# the target is stopped at once, k6 sees it fail and stops, and live goes on undisturbed.
set -euo pipefail
DIR=/srv/rolematch/load; ENV="$DIR/load.env"; PORT=18799; WHP=8794; LIVE_ENV=/etc/rolematch/live.env
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
. "$HERE/deploy/limits.sh"
run_once() { docker run --rm --network host --env-file "$ENV" -v rml-data:/data "$(cat "$DIR/image")" "$@" </dev/null; }

case "${1:-}" in
up)
  C="${2:?the release to load-test, e.g. 2544171}"; COMPANIES="${3:-8}"; EACH="${4:-10}"; IMAGE="rolematch:${C:0:7}"
  docker image inspect "$IMAGE" >/dev/null
  if docker inspect rml-api >/dev/null 2>&1; then echo "a load target is already up: deploy/pc/load-target.sh down first" >&2; exit 1; fi
  curl -fsS -m 3 http://127.0.0.1:54321/auth/v1/health >/dev/null || { echo "the PC's test database is not running (supabase_*_rolematch)" >&2; exit 1; }
  # The test stack's service key, from the newest test run's settings on this PC: never live's.
  SRC=$(ls -t /srv/test/*/server/.env 2>/dev/null | head -1); [ -n "$SRC" ] || { echo "no test run's settings in /srv/test" >&2; exit 1; }
  mkdir -p "$DIR"; chmod 700 "$DIR"; umask 077; echo "$IMAGE" > "$DIR/image"
  {
    echo "ROLEMATCH_ENVIRONMENT=test"; echo "PORT=$PORT"; echo "DB_SCHEMA=load_$(date +%Y%m%d%H%M)"
    echo "SUPABASE_URL=http://127.0.0.1:54321"; grep '^SUPABASE_SERVICE_ROLE_KEY=' "$SRC"
    echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    echo "LOCAL_ENCRYPTION_KEY=$(openssl rand -base64 32)"; echo "OPS_TOKEN=$(openssl rand -hex 32)"
    # Reached over plain http through the Mac's own connection, so cookies cannot be Secure; NODE_ENV=production would refuse that (config.ts).
    # NODE_ENV changes nothing else for these containers (a worker restarts itself after a stuck reading either way: pipeline.ts, role other than all).
    echo "PUBLIC_APP_URL=http://127.0.0.1:$PORT"; echo "ALLOWED_ORIGINS=http://127.0.0.1:$PORT"; echo "NODE_ENV=development"; echo "COOKIE_SECURE=false"; echo "TRUST_PROXY=false"
    echo "MAIL_TRANSPORT="; echo "MAIL_SEND_MODE=off"; echo "AI_READING=off"; echo "AI_MATCHING=off"; echo "ANTHROPIC_API_KEY="; echo "SIGNUP_REQUIRE_CODE=true"
  } > "$ENV"
  # The PC's live port must never be the target's.
  [ "$(grep '^PORT=' "$LIVE_ENV" | cut -d= -f2)" != "$PORT" ] || { echo "refused: live listens on $PORT" >&2; exit 3; }
  # Each step on its own line, so set -e stops the script at the first that fails (a step joined by && would let it carry on).
  run_once node src/scripts/migrate.js >/dev/null
  echo "load schema made"
  run_once node src/scripts/loadTarget.js seed "$COMPANIES" "$EACH" > "$DIR/accounts.json"
  echo "$COMPANIES companies of $EACH recruiters made (accounts in $DIR/accounts.json, root only)"
  # Live's own limits (deploy/limits.sh), so the result is what live would do.
  LOCK=(--network host --env-file "$ENV" --restart no --security-opt no-new-privileges:true --cap-drop ALL --read-only --tmpfs /tmp:size=1g -v rml-data:/data)
  docker run -d --name rml-api "${LOCK[@]}" --memory "$API_MEMORY" -e ROLE=api -e DB_POOL_SIZE="$DB_POOL_API" "$IMAGE" node src/index.js >/dev/null
  docker run -d --name rml-worker "${LOCK[@]}" --memory "$WORKER_MEMORY" -e WORKER_JOBS=documents -e WORKER_HEALTH_PORT="$WHP" -e WORKER_CONCURRENCY=3 -e PER_ORG_CONCURRENCY=3 -e DB_POOL_SIZE="$DB_POOL_WORKER" "$IMAGE" node src/worker.js >/dev/null
  for _ in $(seq 1 40); do curl -fsS -m 3 "http://127.0.0.1:$PORT/api/ready" >/dev/null 2>&1 && break; sleep 3; done
  curl -fsS -m 3 "http://127.0.0.1:$PORT/api/ready" >/dev/null || { echo "LOAD TARGET NOT READY (docker logs rml-api)"; exit 1; }
  # The watchdog: live first, always.
  nohup bash "$HERE/deploy/pc/load-target.sh" watch >> "$DIR/watchdog.log" 2>&1 &
  echo $! > "$DIR/watchdog.pid"
  echo "load target ready on 127.0.0.1:$PORT ($IMAGE); watchdog on live's health running"
  ;;
watch)
  LP=$(grep '^PORT=' "$LIVE_ENV" | cut -d= -f2); TOKEN=$(grep '^OPS_TOKEN=' "$LIVE_ENV" | cut -d= -f2); slow=0
  while docker inspect rml-api >/dev/null 2>&1; do
    sleep 15
    # the token goes in on standard input, never on curl's command line
    out=$(curl -s -m 10 -w '\n%{time_total}' -H @- "http://127.0.0.1:$LP/api/ops/health" <<<"authorization: Bearer $TOKEN") || out=$'\n10'
    secs=${out##*$'\n'}; body=${out%$'\n'*}
    if grep -q '"state":"unknown"' <<<"$body" || awk -v s="$secs" 'BEGIN{exit !(s>5)}'; then slow=$((slow + 1)); else slow=0; fi
    if [ "$slow" -ge 2 ]; then docker stop -t 2 rml-api rml-worker >/dev/null 2>&1; echo "$(date -u +%FT%TZ) STOPPED the load target: live's health was slow or incomplete twice in a row (last ${secs}s)"; exit 2; fi
  done
  ;;
down)
  [ -f "$DIR/watchdog.pid" ] && kill "$(cat "$DIR/watchdog.pid")" 2>/dev/null || true
  docker rm -f rml-api rml-worker >/dev/null 2>&1 || true
  # A target that never finished starting may have no schema to clear: said, and the rest is still removed.
  if [ -f "$ENV" ] && [ -f "$DIR/image" ]; then run_once node src/scripts/loadTarget.js clear 2>&1 | tail -1 || echo "nothing of the test's to clear in the database"; fi
  docker volume rm rml-data >/dev/null 2>&1 || true
  rm -f "$ENV" "$DIR/accounts.json" "$DIR/image" "$DIR/watchdog.pid"
  echo "load target removed"
  ;;
*) echo "usage: $0 up <commit> [companies] [recruiters each] | down" >&2; exit 1;;
esac
