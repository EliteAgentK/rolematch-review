#!/usr/bin/env bash
# Starts the named tunnel for app.rolematch.co.za on the PC (docs/ops/NAMED_TUNNEL_PLAN.md), as root:
#   /srv/rolematch/deploy/pc/tunnel.sh
# Needs /etc/rolematch/tunnel.json, made on the PC by `cloudflared tunnel create` (plan, step 3). Fills deploy/pc/cloudflared.yml with the tunnel's
# id and the API's port from the live settings, installs it, and (re)starts the container. The quick tunnel (rm-tunnel) is left alone until the
# new address is proven, so live always has an address; its metrics take 20241, this one 20242.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ENVFILE="${ROLEMATCH_ENV:-/etc/rolematch/live.env}"; SECRET=/etc/rolematch/tunnel.json
NAME="${TUNNEL_CONTAINER:-rm-tunnel-named}"; NAME_B="${TUNNEL_CONTAINER_B:-rm-tunnel-b}"; IMAGE="cloudflare/cloudflared:${CLOUDFLARED_VERSION:-2026.10.7}"
[ -f "$SECRET" ] || { echo "No tunnel secret at $SECRET: run 'cloudflared tunnel create rolematch-pc' first (plan, step 3)."; exit 1; }
chown 65532:65532 "$SECRET"; chmod 600 "$SECRET"   # cloudflared's image runs as nonroot (65532); only it (and root) may read the secret
ID=$(sed -n 's/.*"TunnelID" *: *"\([0-9a-f-]\{36\}\)".*/\1/p' "$SECRET"); PORT=$(grep '^PORT=' "$ENVFILE" | cut -d= -f2)
[ -n "$ID" ] && [ -n "$PORT" ] || { echo "Could not read the tunnel id or the API's PORT."; exit 1; }
sed -e "s/__TUNNEL_ID__/$ID/" -e "s/__API_PORT__/$PORT/" "$HERE/cloudflared.yml" > /etc/rolematch/cloudflared.yml.new
mv /etc/rolematch/cloudflared.yml.new /etc/rolematch/cloudflared.yml
docker run --rm -v /etc/rolematch/cloudflared.yml:/etc/cloudflared/config.yml:ro "$IMAGE" tunnel --config /etc/cloudflared/config.yml ingress validate
# Two connections to the same tunnel (11 Nov 2026), so a restart of either never drops live: the second ($NAME_B, metrics 20243) is started first with
# the new routes, and only once it is connected is the first replaced. Both stay running; Cloudflare uses whichever answers.
sed 's/^metrics: 127.0.0.1:20242/metrics: 127.0.0.1:20243/' /etc/rolematch/cloudflared.yml > /etc/rolematch/cloudflared-b.yml; chmod --reference=/etc/rolematch/cloudflared.yml /etc/rolematch/cloudflared-b.yml
start() { docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" --restart unless-stopped --network host --memory 128m --read-only \
    -v "$2":/etc/cloudflared/config.yml:ro -v "$SECRET":/etc/cloudflared/tunnel.json:ro "$IMAGE" tunnel --config /etc/cloudflared/config.yml run >/dev/null
  for _ in $(seq 1 20); do curl -fsS --max-time 3 "http://127.0.0.1:$3/ready" >/dev/null 2>&1 && return 0; sleep 3; done
  echo "$1 did not connect within a minute:"; docker logs --tail 20 "$1"; return 1; }
start "$NAME_B" /etc/rolematch/cloudflared-b.yml 20243 && start "$NAME" /etc/rolematch/cloudflared.yml 20242 && echo "Tunnel $ID connected twice"
