#!/usr/bin/env bash
# Watches the machine during a load test on the isolated stack, and stops the isolated containers if the Mac or the live service suffers. Stopping them ends the test: the crowd sees a dead service and exits.
#   server/test/load/guard.sh <out.csv> [live ready URL]
# Limits were set before any test: swap grows by more than 3 GB, free disk under 40 GB, or the live service takes over 3 s to answer, or fails, three checks running.
set -u
OUT="$1"; LIVE="${2:-https://hotel-changing-desperate-outstanding.trycloudflare.com/api/ready}"; SWAP0=""; SLOW=0
gb() { sysctl -n vm.swapusage | sed -E 's/.*used = ([0-9.]+)M.*/\1/' | awk '{print $1/1024}'; }
echo "time,swap_gb,free_pages_mb,disk_free_gb,live_ms,live_code,iso_api_cpu,iso_api_mem,iso_worker_cpu,iso_worker_mem,db_cpu,db_mem,auth_cpu,db_conns,runner" > "$OUT"
while :; do
  SWAP="$(gb)"; [ -n "$SWAP0" ] || SWAP0="$SWAP"
  FREE=$(vm_stat | awk '/Pages free/{f=$3} /Pages inactive/{i=$3} END{gsub(/\./,"",f);gsub(/\./,"",i);print int((f+i)*16384/1048576)}')
  DISK=$(df -g "$HOME" | tail -1 | awk '{print $4}')
  LINE=$(curl -s -o /dev/null -m 6 -w '%{time_total} %{http_code}' "$LIVE" || echo "6 000"); MS=$(echo "$LINE" | awk '{print int($1*1000)}'); CODE=$(echo "$LINE" | awk '{print $2}')
  STATS=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' rm-api iso-worker supabase_db_rolematch supabase_auth_rolematch 2>/dev/null | sed -E 's# / [^ ]+( / [^ ]+)?$##')
  v() { echo "$STATS" | awk -v n="$1" -v f="$2" '$1==n{print $f}'; }
  CONNS=$(docker exec supabase_db_rolematch psql -U postgres -tAc "select count(*) from pg_stat_activity where datname='postgres'" 2>/dev/null)
  RUNNER=$(ls "$HOME/RoleMatchResearch/queue/running" 2>/dev/null | wc -l | tr -d ' ')
  echo "$(date +%H:%M:%S),$SWAP,$FREE,$DISK,$MS,$CODE,$(v rm-api 2),$(v rm-api 3),$(v iso-worker 2),$(v iso-worker 3),$(v supabase_db_rolematch 2),$(v supabase_db_rolematch 3),$(v supabase_auth_rolematch 2),$CONNS,$RUNNER" >> "$OUT"
  if [ "$MS" -gt 3000 ] || [ "$CODE" != "200" ]; then SLOW=$((SLOW + 1)); else SLOW=0; fi
  REASON=""
  awk -v a="$SWAP" -v b="$SWAP0" 'BEGIN{exit !(a-b>3)}' && REASON="swap grew by more than 3 GB"
  [ "$DISK" -lt 40 ] && REASON="under 40 GB of disk free"
  [ "$SLOW" -ge 3 ] && REASON="the live service slowed or failed three checks running"
  if [ -n "$REASON" ]; then echo "GUARD STOPPED THE TEST: $REASON" | tee -a "$OUT.stopped"; docker stop --time 5 iso-api iso-worker >/dev/null 2>&1; [ -n "${GUARD_ALSO:-}" ] && eval "$GUARD_ALSO"; exit 3; fi
  sleep 10
done
