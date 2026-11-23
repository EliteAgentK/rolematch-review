#!/usr/bin/env bash
# The full test suite on the PC without starving live, which runs on the same machine (R166: on 8 Nov a full run made live's health report miss its
# answers for over two minutes, and the owner was alerted). Run as root:
#   deploy/pc/test-suite.sh /srv/test/<commit>            writes /srv/test/<commit>/suite.log, last line "exit <code>"
# The suite runs at the lowest CPU and disk priority with a capped number of workers. A watchdog asks live's health report every 15 seconds; if any check
# comes back "unknown" or the answer takes more than 5 seconds twice in a row, the suite is stopped at once, before the monitor's two-minute rule would
# alert anyone, and the log says why. A stopped suite is a result of its own ("exit stopped"), never a pass.
set -uo pipefail
DIR="${1:?test folder, e.g. /srv/test/<commit>}"; LOG="$DIR/suite.log"; ENVFILE="${ROLEMATCH_ENV:-/etc/rolematch/live.env}"
WORKERS="${TEST_WORKERS:-6}"; PORT=$(grep '^PORT=' "$ENVFILE" | cut -d= -f2); TOKEN=$(grep '^OPS_TOKEN=' "$ENVFILE" | cut -d= -f2)
cd "$DIR/server"
nice -n 19 ionice -c3 node_modules/.bin/vitest run --maxWorkers="$WORKERS" > "$LOG" 2>&1 &
SUITE=$!; slow=0
while kill -0 "$SUITE" 2>/dev/null; do
  sleep 15
  # the token goes in on standard input, never on curl's command line, where anyone on the machine could read it (independent security review, 23 Nov 2026)
  out=$(curl -s -m 10 -w '\n%{time_total}' -H @- "http://127.0.0.1:$PORT/api/ops/health" <<<"authorization: Bearer $TOKEN") || out=$'\n10'
  secs=${out##*$'\n'}; body=${out%$'\n'*}
  if grep -q '"state":"unknown"' <<<"$body" || awk -v s="$secs" 'BEGIN{exit !(s>5)}'; then slow=$((slow + 1)); else slow=0; fi
  if [ "$slow" -ge 2 ]; then
    pkill -TERM -P "$SUITE" 2>/dev/null; kill -TERM "$SUITE" 2>/dev/null; sleep 3; pkill -KILL -f "$DIR/server/node_modules" 2>/dev/null
    echo "STOPPED: live's health report was slow or incomplete twice in a row (last answer ${secs}s) while the suite ran" >> "$LOG"; echo "exit stopped" >> "$LOG"; exit 2
  fi
done
wait "$SUITE"; code=$?; echo "exit $code" >> "$LOG"; exit "$code"
