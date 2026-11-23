#!/usr/bin/env bash
# Trends on the PC (docs/ops/TRENDS_AND_LOAD.md): Prometheus, which reads RoleMatch's numbers and the PC's every 15 seconds and keeps them 90 days, and
# node-exporter, which gives it the PC's disk, memory and processors. Both listen on 127.0.0.1 only. Run as root inside the RoleMatch WSL, by
# deploy/pc/release.sh after each release (and by hand the first time):   deploy/pc/prometheus.sh
# The configuration and the trend rules come from deploy/prometheus/ in this release, are checked by promtool, and only then replace the running ones.
# The kept numbers live in the volume rm-prometheus-data and survive every restart. Undo: docker rm -f rm-prometheus rm-node-exporter.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"; ENVFILE="${ROLEMATCH_ENV:-/etc/rolematch/live.env}"; DIR=/srv/rolematch/prometheus
PROMETHEUS=prom/prometheus:v3.16.0; NODE_EXPORTER=prom/node-exporter:v1.12.1   # pinned; changed only on purpose
PORT=$(grep '^PORT=' "$ENVFILE" | cut -d= -f2); [ -n "$PORT" ] || { echo "no PORT in $ENVFILE" >&2; exit 1; }
grep -q '^OPS_TOKEN=.\{32,\}' "$ENVFILE" || { echo "no OPS_TOKEN of 32 characters or more in $ENVFILE" >&2; exit 1; }

# The new configuration is written beside the old and checked before it is used.
NEW="$DIR.new"; rm -rf "$NEW"; mkdir -p "$NEW"
sed "s/__API_PORT__/$PORT/" "$HERE/deploy/prometheus/prometheus.yml" > "$NEW/prometheus.yml"
cp "$HERE/deploy/prometheus/rules.yml" "$NEW/rules.yml"
# The token: read by Prometheus's own user (65534) alone, never on a command line or in a log.
( umask 077; grep '^OPS_TOKEN=' "$ENVFILE" | cut -d= -f2- | tr -d '\n' > "$NEW/ops-token" )
chown 65534:65534 "$NEW/ops-token"; chmod 0400 "$NEW/ops-token"; chmod 0755 "$NEW"; chmod 0644 "$NEW/prometheus.yml" "$NEW/rules.yml"
docker run --rm -v "$NEW:/etc/prometheus:ro" --entrypoint promtool "$PROMETHEUS" check config /etc/prometheus/prometheus.yml >/dev/null \
  || { echo "the trend configuration or rules are not valid: nothing changed" >&2; rm -rf "$NEW"; exit 1; }
rm -rf "$DIR.prev"; if [ -d "$DIR" ]; then mv "$DIR" "$DIR.prev"; fi; mv "$NEW" "$DIR"

LOCK=(--restart unless-stopped --network host --read-only --cap-drop ALL --security-opt no-new-privileges:true)
docker rm -f rm-node-exporter rm-prometheus >/dev/null 2>&1 || true
# The PC's disk, read-only. Plain ro, not node-exporter's usual ro,rslave: WSL's root is not a shared mount, and Docker refuses rslave there (23 Nov 2026).
docker run -d --name rm-node-exporter "${LOCK[@]}" --pid host --memory 64m -v /:/host:ro "$NODE_EXPORTER" \
  --path.rootfs=/host --web.listen-address=127.0.0.1:9100 >/dev/null
docker run -d --name rm-prometheus "${LOCK[@]}" --user 65534:65534 --memory 768m --tmpfs /tmp:size=16m \
  -v "$DIR:/etc/prometheus:ro" -v rm-prometheus-data:/prometheus "$PROMETHEUS" \
  --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus --storage.tsdb.retention.time=90d --storage.tsdb.retention.size=5GB \
  --web.listen-address=127.0.0.1:9090 >/dev/null

# Ready, and both targets read at least once: anything less is reported, never called done.
for _ in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:9090/-/ready >/dev/null 2>&1 && break; sleep 2; done
curl -fsS -m 2 http://127.0.0.1:9090/-/ready >/dev/null || { echo "TRENDS NOT READY: Prometheus does not answer (docker logs rm-prometheus)"; exit 1; }
for _ in $(seq 1 15); do
  # Counted, not grepped: before the first reading there is nothing to match, and under pipefail a grep that finds nothing would end the script unseen.
  up=$(curl -fsS -m 3 'http://127.0.0.1:9090/api/v1/query?query=up' 2>/dev/null | python3 -c 'import json,sys; print(sum(r["value"][1] == "1" for r in json.load(sys.stdin)["data"]["result"]))' 2>/dev/null || echo 0)
  [ "$up" -ge 2 ] && { echo "trends ready: Prometheus reads RoleMatch and the PC"; exit 0; }
  sleep 4
done
echo "TRENDS INCOMPLETE: Prometheus runs but reads $up of 2 targets (http://127.0.0.1:9090/api/v1/targets)"; exit 1
