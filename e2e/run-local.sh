#!/usr/bin/env bash
# The browser tests, start to finish, on this machine only: builds the website (the server serves dist/, so without this the tests run against an old
# build), starts the stand-in AI on 18901 and the server on 8787 against the LOCAL Supabase stack (nothing from server/.env, which points elsewhere),
# runs the board suite and the every-browser suite, and stops both by their own process ids.
#   bash e2e/run-local.sh              both suites
#   bash e2e/run-local.sh board        the board suite only (playwright.config.ts)
#   bash e2e/run-local.sh browsers     every engine, size and mode (playwright.browsers.config.ts)
# Logs: .e2e-run/. Needs: `supabase start` done, ports 8787 and 18901 free.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; WHICH="${1:-all}"
LOGS="$ROOT/.e2e-run"; mkdir -p "$LOGS"   # not under test-results/: Playwright empties that folder when it starts
S=$(cd "$ROOT" && supabase status -o json 2>/dev/null | sed -n '/^{/,$p')
get() { echo "$S" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1') or '')" 2>/dev/null; }
API=$(get API_URL); DB=$(get DB_URL); KEY=$(get SERVICE_ROLE_KEY); [ -n "$KEY" ] || KEY=$(get SECRET_KEY)
local_url() { [[ "$1" =~ ^[a-z]+://([^@/]*@)?(127\.0\.0\.1|localhost)(:|/|$) ]]; }
local_url "$API" && local_url "$DB" || { echo "refusing: the Supabase stack is not running on this machine (supabase start)"; exit 1; }
for p in 8787 18901; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p is in use: stop what holds it first"; exit 1; }; done

echo "building the website"; (cd "$ROOT" && npm run build > "$LOGS/build.log" 2>&1) || { echo "build failed"; tail -20 "$LOGS/build.log"; exit 1; }
EMPTY=$(mktemp)
cd "$ROOT/server"
ROLEMATCH_ENV_FILE="$EMPTY" DATABASE_URL="$DB" node --import tsx test/live/fakeClaude.ts 18901 > "$LOGS/standin.log" 2>&1 & FAKE=$!
# Every test browser comes from one address here, and each test opens a fresh browser that fetches the site's files again: the per-address limit on
# the site's own files (600 a minute, server/src/ratelimit.ts) refused scripts and fonts mid-run on 17 Nov 2026, so it is raised for this run only.
ROLEMATCH_ENV_FILE="$EMPTY" SUPABASE_URL="$API" DATABASE_URL="$DB" SUPABASE_SERVICE_ROLE_KEY="$KEY" ANTHROPIC_API_KEY="sk-ant-test-not-a-real-key" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:18901" PORT=8787 SIGNUP_REQUIRE_CODE=false RATE_OVERRIDES='{"static":100000}' \
  node --import tsx src/index.ts > "$LOGS/server.log" 2>&1 & SRV=$!
trap 'kill $SRV $FAKE 2>/dev/null; rm -f "$EMPTY"' EXIT
for i in $(seq 1 30); do grep -q "stand-in Claude" "$LOGS/standin.log" && break; sleep 1; done
grep -q "stand-in Claude" "$LOGS/standin.log" || { echo "the stand-in AI did not start"; tail -5 "$LOGS/standin.log"; exit 1; }
for i in $(seq 1 120); do curl -fs http://localhost:8787/api/ready >/dev/null 2>&1 && break; sleep 1; done
curl -fs http://localhost:8787/api/ready >/dev/null || { echo "the server did not start"; tail -20 "$LOGS/server.log"; exit 1; }

cd "$ROOT"; failed=0
if [ "$WHICH" = all ] || [ "$WHICH" = board ]; then
  npx playwright test e2e/board.spec.ts e2e/change-reason.spec.ts e2e/curation.spec.ts e2e/editing.spec.ts e2e/session.spec.ts e2e/settings.spec.ts 2>&1 | tee "$LOGS/board.log" | tail -30
  [ "${PIPESTATUS[0]}" = 0 ] || failed=1
fi
if [ "$WHICH" = all ] || [ "$WHICH" = browsers ]; then
  npx playwright test -c playwright.browsers.config.ts 2>&1 | tee "$LOGS/browsers.log" | tail -30
  [ "${PIPESTATUS[0]}" = 0 ] || failed=1
fi
[ "$failed" = 0 ] && echo "BROWSER TESTS PASSED" || echo "BROWSER TESTS FAILED"
exit $failed
