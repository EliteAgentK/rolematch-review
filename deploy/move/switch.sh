#!/usr/bin/env bash
# The switch: live moves from Supabase (Ireland) onto the PC's own database and sign-in (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, section 6).
# Run as root inside the RoleMatch WSL, from a release tree of the image that is running:
#   deploy/move/switch.sh rehearse   everything but the switch itself, while live keeps running on Supabase: the settings live will have are written and
#                                    checked, live is copied into the PC's database again, and an API started on those settings (on a spare port, with
#                                    mail held back) must answer. Live is not touched.
#   deploy/move/switch.sh go         the switch: saving paused (a "back in a few minutes" page answers instead), the queues drained, the final copy and
#                                    its proof, then live's containers restart on the PC's settings, with the same names and ports. Any failure before the
#                                    restart goes back by itself; Supabase is only ever read.
#   deploy/move/switch.sh back       the way back: live's containers restart on the settings they had before (live.env.before-move). Work saved on the
#                                    PC since the switch is not on Supabase: copy it back with deploy/move/copy.sh first if any was saved.
# The settings file live will have is live's own, with only what says where the data is taken from the copy's (next.env): the database and sign-in
# addresses, the vault and its key. Everything else (the public address, mail, AI, sign-up rules, limits) stays as live has it.
set -euo pipefail
MODE="${1:?rehearse, go or back}"; HERE="$(cd "$(dirname "$0")/../.." && pwd)"; E=/etc/rolematch
LIVE="$E/live.env"; NEXT="$E/next.env"; STACK="$E/next/stack.env"; NEXTMIG="$E/next-migrate.env"; BEFORE="$E/live.env.before-move"; PCENV="$E/live.env.pc"
IMAGE="$(docker inspect rm-api --format '{{.Config.Image}}' 2>/dev/null || true)"; DATA=rolematch-pc-data; PAUSE=rm-pause
say() { echo "$(date +%H:%M:%S) $*"; }
val() { { grep "^$1=" "$2" || true; } | tail -1 | cut -d= -f2-; }
# live's containers, exactly as a release starts them (deploy/pc/release.sh)
start_live() { (cd /srv/rolematch && WORKER_CONCURRENCY=3 PER_ORG_CONCURRENCY=3 ROLEMATCH_ENV="$LIVE" ROLEMATCH_DATA_VOLUME="$DATA" bash deploy/mac/run.sh "$1" 2>&1 | tail -1); }

if [ "$MODE" = back ]; then
  [ -r "$BEFORE" ] || { echo "no $BEFORE: nothing to go back to" >&2; exit 2; }
  say "going back: live's containers restart on the settings they had before the move"
  docker rm -f "$PAUSE" >/dev/null 2>&1 || true
  cp -p "$BEFORE" "$LIVE"; rm -f "$E/migrate.env"
  start_live "${IMAGE:?no running image}"
  echo "$(date -u +%FT%TZ) move: went back to Supabase on $IMAGE" >> /srv/rolematch/deploys.log; exit 0
fi
case "$MODE" in rehearse|go) ;; *) echo "rehearse, go or back" >&2; exit 2;; esac

# 1. Before anything: the copy and its pair exist and answer, and live has not been moved already.
for f in "$LIVE" "$NEXT" "$STACK" "$NEXTMIG"; do [ -r "$f" ] || { echo "missing $f" >&2; exit 2; }; done
[ -z "$(val AUTH_URL "$LIVE")" ] || { echo "live already runs on the PC's own sign-in (AUTH_URL is set in live.env)" >&2; exit 2; }
[ "$(docker inspect -f '{{.State.Health.Status}}' rmn-pg)" = healthy ] || { echo "rmn-pg is not healthy" >&2; exit 2; }
curl -fsS --max-time 3 "http://127.0.0.1:$(val AUTH_PORT "$STACK")/health" >/dev/null || { echo "rmn-auth does not answer" >&2; exit 2; }
# Links and codes already sent (invitations, resets) were signed with live's service key; the PC must sign and check with the same secret.
[ "$(val LINK_SECRET "$NEXT")" = "$(val SUPABASE_SERVICE_ROLE_KEY "$LIVE")" ] || { echo "LINK_SECRET in next.env is not live's service key: links already sent would stop working" >&2; exit 2; }
[ "$(val BACKUP_KEY "$NEXT")" = "$(val BACKUP_KEY "$LIVE")" ] || { echo "the backup keys differ" >&2; exit 2; }

# 2. The settings live will have, written beside live's (root only) and checked by the same preflight a release runs.
umask 077
{ while IFS= read -r line; do
    k="${line%%=*}"
    case "$k" in DATABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY) echo "$k=$(val "$k" "$NEXT")";; ROLEMATCH_DATA_VOLUME) ;; *) echo "$line";; esac
  done < "$LIVE"
  echo "# Since the move to the PC's own database ($(date -u +%F)): where the data is, from next.env"
  for k in AUTH_URL AUTH_FORWARD_HEADER LINK_SECRET DATABASE_HOME DATABASE_LOCATION STORE_DIR VAULT_KEYS; do
    v="$(val "$k" "$NEXT")"; [ -n "$v" ] || { echo "next.env has no $k" >&2; exit 2; }; echo "$k=$v"; done
  echo "ROLEMATCH_DATA_VOLUME=$DATA"; } > "$PCENV.part"
mv "$PCENV.part" "$PCENV"
ROLEMATCH_LIVE_ENV="$PCENV" "$HERE/deploy/preflight.sh" live >/dev/null
say "settings: $PCENV written and passes the release preflight ($(grep -c '=' "$PCENV") values; only where the data is differs from live's)"

copy() { MOVE_NET=host ROLEMATCH_IMAGE="$IMAGE" bash "$HERE/deploy/move/copy.sh" "$1" "$STACK" "$PCENV" 2>&1 | grep -v -E '^pg_dump: (warning|detail|hint)'; }

if [ "$MODE" = rehearse ]; then
  say "copying live into the PC's database (live keeps running)"
  copy "$LIVE" | tail -6
  # An API on live's future settings, on a spare port, mail held back: it must start and say it is ready, against the PC's database.
  docker rm -f rmt-api >/dev/null 2>&1 || true
  docker run -d --name rmt-api --network host --env-file "$PCENV" -e PORT=18796 -e ROLE=api -e MAIL_SEND_MODE=allowlist -e DB_POOL_SIZE=2 \
    --read-only --tmpfs /tmp:size=64m --security-opt no-new-privileges:true --cap-drop ALL -v "$DATA:/data" "$IMAGE" node src/index.js >/dev/null
  ok=no; for _ in $(seq 1 30); do curl -fsS --max-time 3 http://127.0.0.1:18796/api/ready >/dev/null 2>&1 && { ok=yes; break; }; sleep 2; done
  docker logs rmt-api 2>&1 | grep -m1 'listening' | sed 's/^/  /' || true
  docker rm -f rmt-api >/dev/null
  [ "$ok" = yes ] || { echo "REHEARSAL FAILED: an API on the new settings did not become ready" >&2; exit 1; }
  # The page that answers while saving is paused.
  docker rm -f rmt-pause >/dev/null 2>&1 || true
  PAUSE_PORT=18796 bash "$HERE/deploy/move/pause.sh" rmt-pause "$IMAGE"
  a="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18796/api/me)"; p="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18796/)"
  docker rm -f rmt-pause >/dev/null
  [ "$a$p" = 503503 ] || { echo "REHEARSAL FAILED: the pause page answered $a and $p, not 503" >&2; exit 1; }
  say "REHEARSAL PASSED: settings, copy and proof, an API ready on them, the pause page; live untouched"; exit 0
fi

# ---- go ----
[ -r "$BEFORE" ] || cp -p "$LIVE" "$BEFORE"
say "the way back is kept: $BEFORE"
# 3. Saving paused: the copy's own apps stop (they would write into the database being refilled), then live's API and workers, gracefully, and the
# pause page takes the API's address. Supabase's sign-in is reached only through our API, so nothing is saved anywhere from here.
for c in rmn-console rmn-ai-worker rmn-worker rmn-api; do docker stop --time 30 "$c" >/dev/null 2>&1 || true; done
docker stop --time 10 rm-monitor >/dev/null 2>&1 || true
docker stop --time 60 rm-api rm-worker rm-ai-worker rm-console >/dev/null 2>&1 || true
PAUSE_PORT="$(val PORT "$LIVE")" bash "$HERE/deploy/move/pause.sh" "$PAUSE" "$IMAGE"
say "saving paused: the pause page answers on app.rolematch.co.za"
abort() { say "STOPPED: $1. Going back to Supabase, as before"; docker rm -f "$PAUSE" >/dev/null 2>&1 || true; cp -p "$BEFORE" "$LIVE"; rm -f "$E/migrate.env"; start_live "$IMAGE"
  docker start rmn-api rmn-worker rmn-ai-worker rmn-console >/dev/null 2>&1 || true; exit 1; }
# 4. Queues drained: any job a worker had in hand is counted (it was copied as it is and the stuck-job watchdog retakes it).
inhand="$(docker run --rm --network host --env-file "$LIVE" -v "$HERE/deploy/certs/supabase-root-2021.pem:/ca.pem:ro" -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.pem \
  -e Q="select count(*) from queue where status = 'running'" postgres:17-alpine sh -c 'psql "$DATABASE_URL" -Atc "$Q"' 2>/dev/null || echo "?")"
say "queues: $inhand job(s) were in hand when the workers stopped"
# 5. The final copy and its proof. Any difference stops the switch here and live goes back to Supabase.
say "final copy"
out="$(copy "$LIVE")" || { echo "$out" | tail -8; abort "the copy or its proof failed"; }
echo "$out" | tail -6
# 6. Live's containers restart on the PC's settings: same names, same ports, the same image. Migrations as the database's owner, as releases will.
cp -p "$PCENV" "$LIVE"; cp -p "$NEXTMIG" "$E/migrate.env"
docker run --rm --network host --env-file "$LIVE" --env-file "$E/migrate.env" "$IMAGE" node src/scripts/migrate.js --target-confirmed | tail -1 || abort "the migrations check failed"
docker rm -f "$PAUSE" >/dev/null
r="$(start_live "$IMAGE")"; echo "$r"
case "$r" in Ready*) ;; *) abort "live did not become ready on the PC's settings";; esac
# 7. The copy's own apps are retired (their database is now live's); its settings are kept, renamed, so a release no longer starts them.
for c in rmn-console rmn-ai-worker rmn-worker rmn-api; do docker rm -f "$c" >/dev/null 2>&1 || true; done
mv "$NEXT" "$NEXT.before-switch"
echo "$(date -u +%FT%TZ) move: live switched to the PC's own database and sign-in on $IMAGE; way back: deploy/move/switch.sh back" >> /srv/rolematch/deploys.log
say "SWITCHED: live runs on the PC's own database and sign-in. Saving has resumed."
