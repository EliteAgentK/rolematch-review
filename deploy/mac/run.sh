#!/usr/bin/env bash
# Starts the live service's API and reading worker on the Mac bridge from one image, with the limits it has always run under. The tunnel container is left alone, so the public address does not change.
#   Called by deploy/mac/release.sh, which records what ran and checks it. By hand: deploy/mac/run.sh <commit or image id>
# The same script runs live on any host. ROLEMATCH_ENV: the settings file; ROLEMATCH_DATA_VOLUME: the private data volume; ROLEMATCH_AI_ENV: the file holding the Anthropic key (default /etc/rolematch/ai.env), read by the AI worker alone.
# Memory, restart rule and database pool sizes: deploy/limits.sh, which the rehearsal reads too.
# Beside live (the copy on the PC, docs/architecture/DESIGN_JOHANNESBURG_MOVE.md C7): RM_PREFIX names the containers (rm unless told), and RM_WORKER_HEALTH_PORT,
# RM_AI_HEALTH_PORT and RM_CONSOLE_PORT their ports; RM_MONITOR=off starts no monitor. A prefix other than rm may not use live's port or live's data volume.
set -euo pipefail
COMMIT="${1:?Which image: rolematch:<commit> or its sha256 id?}"; ENVFILE="${ROLEMATCH_ENV:-$HOME/.rolematch/mac.env}"
case "$COMMIT" in rolematch:*|sha256:*) IMAGE="$COMMIT";; *) IMAGE="rolematch:$COMMIT";; esac
ROLEMATCH_LIVE_ENV="$ENVFILE" "$(dirname "$0")/../preflight.sh" live
. "$(dirname "$0")/../limits.sh"
P="${RM_PREFIX:-rm}"; WHP="${RM_WORKER_HEALTH_PORT:-8790}"; AHP="${RM_AI_HEALTH_PORT:-18797}"; CPORT="${RM_CONSOLE_PORT:-18790}"
case "$P" in rm|rmn) ;; *) echo "RM_PREFIX must be rm or rmn, not $P" >&2; exit 2;; esac
if [ "$P" != rm ]; then
  LIVE_ENV_FILE="${ROLEMATCH_LIVE_ENV_FILE:-/etc/rolematch/live.env}"; myport=$(grep '^PORT=' "$ENVFILE" | cut -d= -f2)
  [ -f "$LIVE_ENV_FILE" ] && [ "$myport" = "$(grep '^PORT=' "$LIVE_ENV_FILE" | cut -d= -f2)" ] && { echo "refused: $P would listen on live's port $myport" >&2; exit 3; }
  case "${ROLEMATCH_DATA_VOLUME:-}" in ""|rolematch-pc-data|rolematch-mac-data) echo "refused: $P needs its own data volume" >&2; exit 3;; esac
  for p in "$WHP" "$AHP" "$CPORT"; do case "$p" in 8790|18797|18790) echo "refused: $P would use live's port $p" >&2; exit 3;; esac; done
fi
docker image inspect "$IMAGE" >/dev/null
# Each container's Docker health check asks its own service (R161, src/scripts/healthcheck.ts); the image's default asks only the API.
HC=(--health-interval 30s --health-timeout 6s --health-retries 3 --health-start-period 90s)
LOCK=(--network host --env-file "$ENVFILE" --restart "$RESTART_RULE" --security-opt no-new-privileges:true --cap-drop ALL --read-only --tmpfs /tmp:size=1g -v "${ROLEMATCH_DATA_VOLUME:-rolematch-mac-data}:/data")
# The monitor goes first, alone, so it never sees this release's own restart and calls it an outage (R164); it starts again after the API is ready, below.
docker stop --time 10 "${P}-monitor" >/dev/null 2>&1 || true
docker stop --time 30 "${P}-console" "${P}-ai-worker" "${P}-worker" "${P}-api" >/dev/null 2>&1 || true
docker rm -f "${P}-console" "${P}-monitor" "${P}-ai-worker" "${P}-worker" "${P}-api" >/dev/null 2>&1 || true
# The local model's containers are gone for good (owner, 8 Nov 2026: "no more Ollama"); any left from an earlier release are removed.
[ "$P" = rm ] && { docker rm -f rm-model-worker rm-model-bridge rm-model-pc >/dev/null 2>&1 || true; }
# Claude (src/aiRead.ts, src/aiMatch.ts): only the AI worker holds the key. The API and the document worker are told one exists, so they queue work for it.
AI_ENV="${ROLEMATCH_AI_ENV:-/etc/rolematch/ai.env}"; if [ -r "$AI_ENV" ] && grep -q '^ANTHROPIC_API_KEY=sk-ant-' "$AI_ENV"; then AI_HERE=(-e AI_KEY_IN_AI_WORKER=1); else AI_HERE=(); fi
docker run -d --name "${P}-api" "${LOCK[@]}" ${AI_HERE[@]+"${AI_HERE[@]}"} --memory "$API_MEMORY" -e ROLE=api -e DB_POOL_SIZE="$DB_POOL_API" "$IMAGE" node src/index.js >/dev/null
docker run -d --name "${P}-worker" "${LOCK[@]}" ${AI_HERE[@]+"${AI_HERE[@]}"} --memory "$WORKER_MEMORY" -e WORKER_JOBS=documents -e WORKER_HEALTH_PORT="$WHP" --health-cmd "node src/scripts/healthcheck.js http://127.0.0.1:$WHP/health" "${HC[@]}" -e WORKER_CONCURRENCY="${WORKER_CONCURRENCY:-1}" -e PER_ORG_CONCURRENCY="${PER_ORG_CONCURRENCY:-1}" -e DB_POOL_SIZE="$DB_POOL_WORKER" "$IMAGE" node src/worker.js >/dev/null
# The AI's own worker: Claude's reading of each CV and its check of each match, many at once (it waits on the network, not the processors), fair between
# organisations and portals through the queue, and under one shared per-minute limit. Its key file is given to this container alone.
if [ -n "${AI_HERE[*]:-}" ]; then
  docker run -d --name "${P}-ai-worker" "${LOCK[@]}" --env-file "$AI_ENV" --memory "$AI_WORKER_MEMORY" -e WORKER_JOBS=model -e WORKER_CONCURRENCY="${AI_WORKER_CONCURRENCY:-40}" -e AI_PER_ORG_CONCURRENCY="${AI_PER_ORG_CONCURRENCY:-20}" -e WORKER_HEALTH_PORT="$AHP" --health-cmd "node src/scripts/healthcheck.js http://127.0.0.1:$AHP/health" "${HC[@]}" -e DB_POOL_SIZE="$DB_POOL_AI" "$IMAGE" node src/worker.js >/dev/null
fi
# The owner's console (src/console/server.ts, docs/database/18_CONSOLE_V0.md) on 127.0.0.1:18790 only (the worker's health check has 8790), where the PC writes its status each minute
# (deploy/pc/host-status.sh). It needs no private data volume, so it gets none; the status folder is mounted read-only. Only where that folder exists.
STATUS_DIR="${ROLEMATCH_STATUS_DIR:-/srv/rolematch/status}"
if [ -d "$STATUS_DIR" ]; then
  docker run -d --name "${P}-console" --network host --env-file "$ENVFILE" --restart "$RESTART_RULE" --security-opt no-new-privileges:true --cap-drop ALL --read-only --tmpfs /tmp:size=16m \
    --memory "$CONSOLE_MEMORY" -e DB_POOL_SIZE="$DB_POOL_CONSOLE" -e CONSOLE_PORT="$CPORT" --health-cmd "node src/scripts/healthcheck.js http://127.0.0.1:$CPORT/healthz" "${HC[@]}" -v "$STATUS_DIR:/status:ro" "$IMAGE" node src/console/server.js >/dev/null
fi
READY=no
for _ in $(seq 1 40); do curl -fsS --max-time 3 "http://127.0.0.1:$(grep '^PORT=' "$ENVFILE" | cut -d= -f2)/api/ready" >/dev/null 2>&1 && { READY=yes; break; }; sleep 3; done
# The monitor beside live (src/scripts/monitor.ts): the public address and the health report every minute; alerts to OPS_ALERT_TO through our own mail host.
# Started once the API is ready, so a release's own restart is not e-mailed to the owner as an outage (R164); started even when it is not ready, so a failed release is.
[ "${RM_MONITOR:-on}" = off ] || docker run -d --name "${P}-monitor" "${LOCK[@]}" --memory "$MONITOR_MEMORY" -e DB_POOL_SIZE=1 --health-cmd "node src/scripts/healthcheck.js file:/tmp/monitor-alive 180" "${HC[@]}" "$IMAGE" node src/scripts/monitor.js >/dev/null
[ "$READY" = yes ] && { echo "Ready on $COMMIT"; exit 0; }
echo "NOT READY on $COMMIT"; exit 1
