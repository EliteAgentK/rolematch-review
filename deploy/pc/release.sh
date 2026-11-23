#!/usr/bin/env bash
# Releases a built source tree to live on the PC. Run as root inside the RoleMatch WSL:
#   deploy/pc/release.sh <full commit> "<what this release holds, for deploys.log>"
# Expects /srv/build/<7-character commit>.tar (the source tree), made after the full test suite passed on /srv/test/<commit> (deploy/pc/test-suite.sh).
# Steps: build the image, take a backup (the release STOPS if the backup fails: on 9 Nov 2026 a backup that broke off part-way was ignored and the release
# went on), apply migrations, swap the deploy scripts and cron, start the containers, retire the quick tunnel if it is still there, record the release.
# Rollback: deploy/mac/run.sh with the previous image (printed first) and /srv/rolematch/deploy.prev. Migrations are additive.
set -euo pipefail
FULL="${1:?the full commit}"; WHAT="${2:?what this release holds}"; C="${FULL:0:7}"; PREV=$(docker inspect rm-api --format '{{.Config.Image}}')
echo "previous image: $PREV"
rm -rf "/srv/build/$C" && mkdir -p "/srv/build/$C" && tar -xf "/srv/build/$C.tar" -C "/srv/build/$C"
cd "/srv/build/$C" && docker build -q --build-arg ROLEMATCH_COMMIT="$FULL" --label org.opencontainers.image.revision="$FULL" -t "rolematch:$C" . >/dev/null && echo "built rolematch:$C"
# The backup must finish: its own checks (both dumps written, records larger than accounts) decide, and any failure stops the release here.
if ! out=$(/srv/rolematch/deploy/pc/backup-nightly.sh 2>&1); then echo "BACKUP FAILED: release stopped, nothing changed on live"; echo "$out" | tail -5; exit 1; fi
echo "backup taken: $(echo "$out" | tail -1)"
# Migrations change the database's shape, so on the PC's own database they run as its owner role: migrate.env (root only) holds DATABASE_URL for that
# role, and being read after live.env it replaces the application's address for this one step; the application never holds it (docs/architecture/
# DESIGN_JOHANNESBURG_MOVE.md C5). Without that file, as before.
MIG=(); [ -r /etc/rolematch/migrate.env ] && MIG=(--env-file /etc/rolematch/migrate.env)
docker run --rm --network host --env-file /etc/rolematch/live.env ${MIG[@]+"${MIG[@]}"} "rolematch:$C" node src/scripts/migrate.js --target-confirmed
rm -rf /srv/rolematch/deploy.prev && mv /srv/rolematch/deploy /srv/rolematch/deploy.prev && cp -a "/srv/build/$C/deploy" /srv/rolematch/deploy && cp /srv/rolematch/deploy/pc/cron.rolematch /etc/cron.d/rolematch && echo "deploy scripts and cron updated"
cd /srv/rolematch
WORKER_CONCURRENCY=3 PER_ORG_CONCURRENCY=3 ROLEMATCH_ENV=/etc/rolematch/live.env ROLEMATCH_DATA_VOLUME=rolematch-pc-data bash deploy/mac/run.sh "rolematch:$C" 2>&1 | tail -1
# Trends (docs/ops/TRENDS_AND_LOAD.md): Prometheus and node-exporter from this release's deploy/prometheus, checked before they replace the running ones.
# Live is already running at this point, so a failure here is reported, never silently (on 23 Nov 2026 a failure printed nothing), and the release goes on.
if trends=$(bash deploy/pc/prometheus.sh 2>&1); then echo "${trends##*$'\n'}"; else echo "TRENDS NOT UPDATED (live is running): $(grep -v '^$' <<<"$trends" | tail -2 | tr '\n' ' ')"; fi
# The copy beside live (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md), once it exists: the same image, its own database, names and ports, so the two never differ.
if [ -r /etc/rolematch/next.env ]; then
  NMIG=(); [ -r /etc/rolematch/next-migrate.env ] && NMIG=(--env-file /etc/rolematch/next-migrate.env)
  docker run --rm --network host --env-file /etc/rolematch/next.env ${NMIG[@]+"${NMIG[@]}"} "rolematch:$C" node src/scripts/migrate.js --target-confirmed && echo "copy migrated"
  (. /etc/rolematch/next.limits 2>/dev/null || true; RM_PREFIX=rmn RM_MONITOR=off RM_WORKER_HEALTH_PORT=8793 RM_AI_HEALTH_PORT=18798 RM_CONSOLE_PORT=18791 WORKER_CONCURRENCY="${NEXT_WORKER_CONCURRENCY:-6}" PER_ORG_CONCURRENCY="${NEXT_PER_ORG_CONCURRENCY:-3}" \
    ROLEMATCH_ENV=/etc/rolematch/next.env ROLEMATCH_DATA_VOLUME=rolematch-next-data ROLEMATCH_STATUS_DIR=/srv/rolematch/status bash deploy/mac/run.sh "rolematch:$C" 2>&1 | tail -1 | sed 's/^/copy: /') || echo "copy: NOT READY (live is not affected)"
fi
# The quick tunnel reached live outside the rolematch.co.za zone (security check #3, 9 Nov 2026); the named tunnel is the only door.
if docker inspect rm-tunnel >/dev/null 2>&1; then docker stop rm-tunnel >/dev/null && docker rm rm-tunnel >/dev/null && echo "quick tunnel retired"; fi
echo "$(date -u +%FT%TZ) deploy $FULL on rolematch-pc; $WHAT; rollback: run.sh with $PREV and deploy.prev" >> /srv/rolematch/deploys.log
docker ps --format '{{.Names}} {{.Status}}' | grep -E '^rm-' | sort
