#!/usr/bin/env bash
# The daily check of everything live depends on, run by root's cron on the PC at 06:00 (owner, 6 Nov 2026: "we can't be falling behind at any point").
# Each line is CURRENT, ATTENTION or UNKNOWN; the report is e-mailed to the owner every day through RoleMatch's own mail host, with the count needing attention in the subject.
# It reads versions and states only: no document, person or secret leaves the machine.
set -uo pipefail
MAIL=yes; [ "${1:-}" = "--no-mail" ] && MAIL=no   # read before anything else: a later `set --` replaces the arguments
ENV=/etc/rolematch/live.env; BACKUPS=/srv/rolematch/backups; OUT=(); NEED=0
ok()   { OUT+=("CURRENT    $1"); }
bad()  { OUT+=("ATTENTION  $1"); NEED=$((NEED + 1)); }
unk()  { OUT+=("UNKNOWN    $1"); NEED=$((NEED + 1)); }
latest_gh() { curl -fsSL -m 20 "https://api.github.com/repos/$1/releases/latest" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))' 2>/dev/null; }
ver_lt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]; }
RUNNING_IMAGE="$(docker inspect rm-api --format '{{.Config.Image}}' 2>/dev/null)"

# --- software on the PC
apt-get update -qq >/dev/null 2>&1
SEC=$(apt list --upgradable 2>/dev/null | grep -c -- "-security")
[ "$SEC" -eq 0 ] && ok "PC Linux: no security updates waiting" || bad "PC Linux: $SEC security updates waiting (installed automatically each night; check the log if this persists)"
[ -f /var/run/reboot-required ] && bad "PC Linux: a restart is needed to finish updates (restart WSL at a quiet time)" || ok "PC Linux: no restart needed"
DOCKER_NOW=$(docker version --format '{{.Server.Version}}' 2>/dev/null); DOCKER_NEW=$(apt list --upgradable 2>/dev/null | grep -c '^docker-ce/')
[ "$DOCKER_NEW" -eq 0 ] && ok "Docker $DOCKER_NOW is the latest" || bad "Docker $DOCKER_NOW: a newer version is available"
NODE_NOW=$(node --version | tr -d v); NODE_NEW=$(curl -fsSL -m 20 https://nodejs.org/dist/index.json | python3 -c 'import json,sys; print([r["version"] for r in json.load(sys.stdin) if r["version"].startswith("v24.")][0].lstrip("v"))' 2>/dev/null)
[ -z "$NODE_NEW" ] && unk "Node: could not read the latest 24.x" || { ver_lt "$NODE_NOW" "$NODE_NEW" && bad "Node $NODE_NOW on the PC: $NODE_NEW is out" || ok "Node $NODE_NOW is the latest 24.x"; }
SB_NOW=$(supabase --version 2>/dev/null); SB_NEW=$(latest_gh supabase/cli)
[ -z "$SB_NEW" ] && unk "Supabase tools: could not read the latest" || { ver_lt "$SB_NOW" "$SB_NEW" && bad "Supabase tools $SB_NOW: $SB_NEW is out" || ok "Supabase tools $SB_NOW are the latest"; }
CF_NOW=$(docker inspect rm-tunnel-named --format '{{.Config.Image}}' 2>/dev/null | cut -d: -f2); CF_NEW=$(latest_gh cloudflare/cloudflared)
[ -z "$CF_NEW" ] && unk "Tunnel: could not read the latest cloudflared" || { ver_lt "$CF_NOW" "$CF_NEW" && bad "Tunnel cloudflared $CF_NOW: $CF_NEW is out" || ok "Tunnel cloudflared $CF_NOW is the latest"; }
# Claude: the AI worker runs, and it alone holds the key (the AI's own health, spend and failures are in the monitor's health report).
if [ -r /etc/rolematch/ai.env ]; then [ "$(docker inspect rm-ai-worker --format '{{.State.Running}}' 2>/dev/null)" = true ] && ok "The AI worker runs (Claude reads CVs and checks matches)" || bad "The AI worker is not running: CVs are read by the parser alone and matches keep the rules' result"; else unk "No AI key on the PC: the AI is off"; fi

# --- the application
SHA=$(echo "$RUNNING_IMAGE" | cut -d: -f2); CODE=$(ls -d /srv/build/"${SHA:0:7}"* 2>/dev/null | head -1)
if [ -d "$CODE/server" ]; then
  V=$(cd "$CODE/server" && npm audit --omit=dev --json 2>/dev/null | python3 -c 'import json,sys; m=json.load(sys.stdin).get("metadata",{}).get("vulnerabilities",{}); print(m.get("high",0)+m.get("critical",0), m.get("moderate",0))' 2>/dev/null)
  [ -z "$V" ] && unk "Live's packages: the vulnerability audit did not complete" || { set -- $V; [ "$1" -eq 0 ] && ok "Live's packages: no high or critical vulnerabilities ($2 moderate)" || bad "Live's packages: $1 high or critical vulnerabilities"; }
else unk "Live's packages: the release's code is not at $CODE"; fi
# In step means no change waiting and nothing missing. The check's other findings are about the one-off container it runs in (it has no file vault
# mounted, so it always says the vault cannot be written): judged on those, this line said "not in step: the check did not run" (owner's daily e-mail, 23 Nov 2026).
SC=$(docker run --rm --network host --env-file "$ENV" "$RUNNING_IMAGE" node src/scripts/schemaCheck.js 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); p=d["pendingMigrations"]+d["missing"]; print("yes" if not p else ",".join(p)[:200])' 2>/dev/null)
[ "$SC" = yes ] && ok "Live's database is in step with the code" || bad "Live's database is not in step: ${SC:-the check did not run}"

# --- safety
NEWEST=$(ls -t "$BACKUPS"/*.records.dump.enc 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then bad "No backup found on the PC"; else AGE=$(( ($(date +%s) - $(stat -c %Y "$NEWEST")) / 3600 )); [ "$AGE" -lt 26 ] && ok "Last backup $AGE h ago" || bad "Last backup $AGE h ago (should be under 26 h)"; fi
if [ -f "$BACKUPS/.collected-by-mac" ]; then CAGE=$(( ($(date +%s) - $(stat -c %Y "$BACKUPS/.collected-by-mac")) / 3600 )); [ "$CAGE" -lt 26 ] && ok "The Mac collected its copy $CAGE h ago" || bad "The Mac last collected its copy $CAGE h ago"; else bad "The Mac has not collected a backup copy yet"; fi
# Live's database on the PC since the move (12 Nov 2026; docs/architecture/DESIGN_JOHANNESBURG_MOVE.md): healthy, its nightly base copy fresh, its change log
# archived minute by minute without failures, and the last Monday restore drill passed.
if docker ps --format '{{.Names}}' | grep -qx rmn-pg; then
  [ "$(docker inspect -f '{{.State.Health.Status}}' rmn-pg)" = healthy ] && ok "Live's database is healthy" || bad "Live's database (rmn-pg) is not healthy"
  BASE=$(ls -1d /srv/rolematch/next/backups/2*Z 2>/dev/null | sort | tail -1)
  if [ -z "$BASE" ]; then bad "Live's database: no base copy found"; else BAGE=$(( ($(date +%s) - $(stat -c %Y "$BASE")) / 3600 )); [ "$BAGE" -lt 26 ] && ok "Live's database: base copy $BAGE h ago" || bad "Live's database: the last base copy is $BAGE h old"; fi
  ARCH=$(docker exec rmn-pg psql -U supabase_admin -d postgres -Atc "select coalesce(failed_count,0) || ' ' || coalesce(extract(epoch from now() - last_failed_time)::int, -1) from pg_stat_archiver" 2>/dev/null)
  set -- $ARCH; { [ "${1:-x}" = 0 ] || [ "${2:-0}" -gt 86400 ]; } && ok "Live's database: change log archived every minute, no recent failure" || bad "Live's database: archiving the change log failed in the last day ($ARCH)"
  grep -q "drill passed" <(tail -1 /var/log/rolematch-next-drill.log 2>/dev/null) && ok "Live's database: last restore drill passed" || bad "Live's database: the last restore drill did not pass, or has not run (/var/log/rolematch-next-drill.log)"
else bad "Live's database (rmn-pg) is not running"; fi
# The earlier own database (ADR-004 phase 2), paused and to be removed a week after the move: watched until then.
if docker ps --format '{{.Names}}' | grep -qx rm-db; then
  DBI=$(docker exec -u postgres rm-db pgbackrest-keyed --stanza=rolematch info --output=json 2>/dev/null | python3 -c 'import json,sys,time; d=json.load(sys.stdin)[0]; b=d["backup"][-1] if d["backup"] else None; print(d["status"]["code"], int((time.time()-b["timestamp"]["stop"])/3600) if b else -1)' 2>/dev/null)
  set -- $DBI; [ "${1:-9}" = 0 ] && [ "${2:--1}" -ge 0 ] && [ "$2" -lt 26 ] && ok "Paused rm-db: backups healthy, last $2 h ago" || bad "Paused rm-db: backups not healthy (${DBI:-no answer})"
  if [ -f "$BACKUPS/.db-repo-collected-by-mac" ]; then M=$(( ($(date +%s) - $(stat -c %Y "$BACKUPS/.db-repo-collected-by-mac")) / 60 )); [ "$M" -le 15 ] && ok "Paused rm-db: the Mac's copy is $M min old" || bad "Paused rm-db: the Mac's copy is $M min old (should be under 15)"; else bad "Paused rm-db: the Mac has not copied its backups yet"; fi
  grep -q "restore drill passed" "$BACKUPS/.db-drill-last" 2>/dev/null && ok "Paused rm-db: last restore drill passed ($(grep -o 'in [0-9]*s' "$BACKUPS/.db-drill-last"))" || bad "Paused rm-db: the last restore drill did not pass, or has not run"
else unk "Paused rm-db: rm-db is not running"; fi
timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes && ok "Clock in sync" || bad "Clock not in sync"
FREE=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "$FREE" -lt 80 ] && ok "Disk $FREE% used" || bad "Disk $FREE% used"

# --- exposure: what listens beyond this machine (Windows' firewall is the outer wall; this is the inner one)
# Not exposure: WSL's own DNS proxy (10.255.255.254, reachable only inside WSL), and a port the DOCKER-USER rule drops for anything but this machine
# (the local test stack, deploy/pc/rolematch-test-ports.service, until the own-database work retires it). Anything else bound beyond loopback is reported.
blocked() { iptables -S DOCKER-USER 2>/dev/null | grep -q -- "--ctorigdstport $1 .*-j DROP"; }
WIDE=""; for a in $(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1|10\.255\.255\.254:)' | sort -u); do blocked "${a##*:}" || WIDE="$WIDE $a"; done
[ -z "$WIDE" ] && ok "Nothing reachable beyond the PC itself (test stack ports blocked by rule)" || bad "Listening beyond the PC itself:$WIDE"
PUB=$(grep '^PUBLIC_APP_URL=' "$ENV" | cut -d= -f2-)
H=$(curl -sI -m 20 "$PUB/" 2>/dev/null | tr -d '\r' | grep -ciE '^(strict-transport-security|content-security-policy|x-frame-options|x-content-type-options):')
[ "$H" -eq 4 ] && ok "Live's security headers are in place" || bad "Live's security headers: $H of 4 present"
[ "$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$PUB/.env")" = 404 ] && ok "Hidden files are not served" || bad "Hidden-file addresses do not answer 404"

# --- health
# The release is read from the server itself: from outside, the ready answer no longer names it (security check, 9 Nov 2026).
REL=$(curl -fsS -m 10 "http://127.0.0.1:$(grep '^PORT=' "$ENV" | cut -d= -f2)/api/ready" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit","")[:7])' 2>/dev/null)
R=$(curl -fsS -m 20 "$PUB/api/ready" 2>/dev/null); echo "$R" | grep -q '"ready":true' && ok "Live answers from outside (release $REL)" || bad "Live does not answer from outside"
docker ps --format '{{.Names}}' | grep -qx rm-monitor && ok "The monitor is running" || bad "The monitor is not running"

REPORT=$(printf '%s\n' "${OUT[@]}")
SUBJECT=$([ "$NEED" -eq 0 ] && echo "RoleMatch daily check: all current" || echo "RoleMatch daily check: $NEED need attention")
echo "$SUBJECT"; echo "$REPORT"
[ "$MAIL" = no ] || printf '%s\n' "$REPORT" | docker run --rm -i --network host --env-file "$ENV" "$RUNNING_IMAGE" node src/scripts/notify.js "$SUBJECT"
