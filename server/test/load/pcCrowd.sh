#!/usr/bin/env bash
# Runs a crowd from the PC against the API servers on the Mac, in several processes, and brings the results back. Refuses anything but the disposable servers. Results and the machine's guard log go to ~/.rolematch/load/results.
#   server/test/load/pcCrowd.sh <name> <processes> <per-server targets count> <loadgen arguments...>
set -uo pipefail
NAME="$1"; P="$2"; S="$3"; shift 3; KEY="$HOME/.ssh/rolematch_dell"; PC=rolematch@192.168.1.100; L="$HOME/.rolematch/load"; ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HOST="${CROWD_HOST:-192.168.1.102}"   # CROWD_HOST=127.0.0.1 when the servers are on the PC too (pcBench.sh): the Mac and the live service are then not involved, and the PC guards its own memory
TARGETS=$(for i in $(seq 1 "$S"); do printf 'http://%s:%s,' "$HOST" $((18800 + i)); done | sed 's/,$//')
scp -i "$KEY" -o BatchMode=yes -q "$ROOT/server/test/load/loadgen.mjs" "$PC:tools/loadgen.mjs"
GUARD=""; [ "$HOST" = 127.0.0.1 ] || { GUARD_ALSO="$ROOT/server/test/load/farm.sh down" bash "$ROOT/server/test/load/guard.sh" "$L/results/$NAME-guard.csv" > /dev/null 2>&1 & GUARD=$!; }
pids=()
for i in $(seq 0 $((P - 1))); do
  ssh -i "$KEY" -o BatchMode=yes "$PC" "cd tools && node-v24.11.1-win-x64\\node.exe --max-old-space-size=900 loadgen.mjs --i-know-this-is-disposable --base http://$HOST:18801 --targets $TARGETS --origin http://localhost:18795 --accounts ${CROWD_ACCOUNTS:-accounts-5k.json} --sessions sessions-5k.json --shard $i/$P --out $NAME-$i.jsonl $*" > "$L/results/$NAME-$i.log" 2>&1 &
  pids+=($!)
done
wait "${pids[@]}"
[ -z "$GUARD" ] || kill $GUARD 2>/dev/null
for i in $(seq 0 $((P - 1))); do scp -i "$KEY" -o BatchMode=yes -q "$PC:tools/$NAME-$i.jsonl" "$L/results/$NAME-$i.jsonl"; done
grep -hE "Separation|FAILURE" "$L"/results/"$NAME"-[0-9]*.log | sort | uniq -c | sort -rn | head -8 | cut -c1-100
python3 -I "$ROOT/server/test/load/view2.py" "$L/results/$NAME-"
