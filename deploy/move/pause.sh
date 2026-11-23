#!/usr/bin/env bash
# The page that answers in the API's place while saving is paused for the switch (deploy/move/switch.sh): every request gets 503 with Retry-After,
# the API's own error shape for /api/, and a short page that refreshes itself for anything else. Nothing is read or stored.
#   PAUSE_PORT=<the API's port> deploy/move/pause.sh <container name> <image>
set -euo pipefail
NAME="${1:?container name}"; IMAGE="${2:?image}"; PORT="${PAUSE_PORT:?the port to answer on}"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network host --read-only --security-opt no-new-privileges:true --cap-drop ALL -e PAUSE_PORT="$PORT" "$IMAGE" node -e '
const msg = "RoleMatch is moving to its new home. Nothing has been lost. Saving is back in a few minutes.";
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>RoleMatch</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f8fb;color:#16202c}main{max-width:30rem;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#4a5866}@media (prefers-color-scheme:dark){body{background:#0e141b;color:#e6edf3}p{color:#9fb0c0}}</style></head><body><main><h1>Back in a few minutes</h1><p>${msg} This page refreshes itself.</p></main></body></html>`;
require("http").createServer((q, s) => {
  const api = q.url.startsWith("/api/");
  s.writeHead(503, { "content-type": api ? "application/json" : "text/html; charset=utf-8", "retry-after": "60", "cache-control": "no-store" });
  s.end(api ? JSON.stringify({ error: { code: "SVC-MOVING", message: msg } }) : page);
}).listen(Number(process.env.PAUSE_PORT), "127.0.0.1");' >/dev/null
for _ in $(seq 1 20); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null)" = 503 ] && exit 0; sleep 0.5; done
echo "the pause page did not answer on $PORT" >&2; exit 1
