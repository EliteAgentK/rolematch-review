#!/usr/bin/env bash
# What the owner's console needs from the PC itself, written every minute by root's cron (docs/database/18_CONSOLE_V0.md): disk, backups, the Mac's copies,
# the last restore drill and the containers that keep live up. The same measurements as the daily check, without the e-mail.
# States, ages and counts only: no document, person or secret. The console reads the file through a read-only mount; a file over 2 minutes old turns its dot grey.
#   /srv/rolematch/deploy/pc/host-status.sh            writes /srv/rolematch/status/host.json
set -uo pipefail
DIR=/srv/rolematch/status; BACKUPS=/srv/rolematch/backups; mkdir -p "$DIR"; chmod 755 "$DIR"
now=$(date +%s)
age() { [ -e "$1" ] && echo $(( (now - $(stat -c %Y "$1")) )) || echo null; }   # seconds, or null when the file is missing
up() { curl -fsS -m 4 "$1" >/dev/null 2>&1 && echo true || echo false; }
running() { docker ps --format '{{.Names}}' | grep -qx "$1" && echo true || echo false; }
NEWEST=$(ls -t "$BACKUPS"/*.records.dump.enc 2>/dev/null | head -1)
DBI=null
[ "$(running rm-db)" = true ] && DBI=$(docker exec -u postgres rm-db pgbackrest-keyed --stanza=rolematch info --output=json 2>/dev/null \
  | python3 -c 'import json,sys,time; d=json.load(sys.stdin)[0]; b=d["backup"][-1] if d["backup"] else None; a=d.get("archive") or [{}]
print(json.dumps({"ok": d["status"]["code"] == 0, "lastBackupSec": int(time.time()-b["timestamp"]["stop"]) if b else None, "lastBackupType": b["type"] if b else None, "walMax": (a[-1].get("max") is not None)}))' 2>/dev/null || echo null)
DRILL=$(python3 - "$BACKUPS/.db-drill-last" <<'EOF'
import json, os, re, sys, time
p = sys.argv[1]
if not os.path.exists(p): print("null"); sys.exit()
t = open(p, errors="replace").read(); m = re.search(r"restore drill passed: .* in (\d+)s", t)
print(json.dumps({"passed": bool(m), "seconds": int(m.group(1)) if m else None, "ageSec": int(time.time() - os.path.getmtime(p))}))
EOF
)
# Live's own database on the PC since the move (12 Nov 2026; docs/architecture/DESIGN_JOHANNESBURG_MOVE.md): its newest base copy, whether its change log is
# being archived, and the last Monday restore drill (deploy/db/stack/drill.sh, one line in its log).
LIVEDB=null
if [ "$(running rmn-pg)" = true ]; then
  BASE=$(ls -1d /srv/rolematch/next/backups/2*Z 2>/dev/null | sort | tail -1)
  ARCH=$(docker exec rmn-pg psql -U supabase_admin -d postgres -Atc "select coalesce(failed_count,0) = 0 or coalesce(last_failed_time < now() - interval '1 day', true) from pg_stat_archiver" 2>/dev/null)
  LDRILL=$(tail -1 /var/log/rolematch-next-drill.log 2>/dev/null)
  LIVEDB="{\"running\": true, \"baseCopySec\": $( [ -n "$BASE" ] && age "$BASE" || echo null ), \"archiving\": $( [ "$ARCH" = t ] && echo true || echo false ), \"drill\": $( [ -n "$LDRILL" ] && echo "{\"passed\": $(case "$LDRILL" in "drill passed"*) echo true;; *) echo false;; esac), \"ageSec\": $(age /var/log/rolematch-next-drill.log)}" || echo null )}"
fi
cat > "$DIR/host.json.tmp" <<EOF
{"at": $now,
 "diskUsedPct": $(df --output=pcent / | tail -1 | tr -dc 0-9),
 "liveBackupSec": $( [ -n "$NEWEST" ] && age "$NEWEST" || echo null ),
 "liveBackupCollectedByMacSec": $(age "$BACKUPS/.collected-by-mac"),
 "liveDatabase": $LIVEDB,
 "ownDatabase": {"running": $(running rm-db), "backups": ${DBI:-null}, "macCopySec": $(age "$BACKUPS/.db-repo-collected-by-mac"), "drill": ${DRILL:-null}},
 "containers": {"api": $(running rm-api), "worker": $(running rm-worker), "aiWorker": $(running rm-ai-worker), "monitor": $(running rm-monitor), "tunnel": $(running rm-tunnel-named)},
 "clockInSync": $(timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes && echo true || echo false)}
EOF
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$DIR/host.json.tmp" && chmod 644 "$DIR/host.json.tmp" && mv -f "$DIR/host.json.tmp" "$DIR/host.json"
