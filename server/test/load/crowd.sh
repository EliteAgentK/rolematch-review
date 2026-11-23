#!/usr/bin/env bash
# Runs the crowd in a container beside the disposable service, so it does not cross the Mac's port forward (register R111). Bias: it shares the VM's CPUs with what it is measuring, limited to 1.
#   server/test/load/crowd.sh <name> <loadgen arguments...>
set -euo pipefail
NAME="$1"; shift; L="$HOME/.rolematch/load"; ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; mkdir -p "$L/results"
docker rm -f iso-crowd >/dev/null 2>&1 || true
bash "$ROOT/server/test/load/guard.sh" "$L/results/$NAME-guard.csv" > /dev/null 2>&1 & GUARD=$!
docker run --name iso-crowd --network host --cpus 1 -m 1g -v "$ROOT/server/test/load/loadgen.mjs:/loadgen.mjs:ro" -v "$L:/load" -v "$ROOT/server/test/fixtures/journey/CV0519.pdf:/CV.pdf:ro" --entrypoint node rolematch:rehearsal /loadgen.mjs --i-know-this-is-disposable --base http://127.0.0.1:18795 --origin http://localhost:18795 --accounts /load/accounts.json --out "/load/results/$NAME.jsonl" "$@" > "$L/results/$NAME.log" 2>&1 || true
kill $GUARD 2>/dev/null || true; docker rm -f iso-crowd >/dev/null 2>&1 || true
grep -E "step |Done|Separation|stopping|stopped|FAILURE" "$L/results/$NAME.log" | cut -c1-110 | tail -9
