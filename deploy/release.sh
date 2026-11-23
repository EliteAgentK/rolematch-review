#!/usr/bin/env bash
# Puts one exact commit on the live server: docs/ops/LIVE_ENVIRONMENT.md. A person runs it, from any machine holding the deploy key; the running service does not need that machine afterwards.
# The image is built on the server from that commit, so it is made for the server's own processor. It refuses a commit whose CI did not pass and never migrates: the server refuses to start out of step
# with its database, and the previous release is put back if the new one does not become healthy.
#   deploy/release.sh <full commit>           LIVE_HOST=ubuntu@<address> LIVE_DOMAIN=app.rolematch.co.za
#   ROLLBACK=1 deploy/release.sh <commit>     put an earlier release back without the CI check or a new build
set -euo pipefail
COMMIT="${1:?give the full 40-character commit}"; HOST="${LIVE_HOST:?set LIVE_HOST}"; DOMAIN="${LIVE_DOMAIN:-app.rolematch.co.za}"
KEY="${LIVE_KEY:-$HOME/.ssh/rolematch_staging}"; REPO="${LIVE_REPO:-EliteAgentK/rolematch}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "Give the full 40-character commit."; exit 1; }
git cat-file -e "$COMMIT^{commit}"
ssh_() { ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" "$@"; }

if [ -z "${ROLLBACK:-}" ]; then
  if [ -z "${SKIP_CI_CHECK:-}" ]; then
    passed="$(gh api "repos/$REPO/commits/$COMMIT/check-runs?per_page=100" --jq '[.check_runs[] | select(.name | test("^(Safety checks|Website|Server)")) | select(.conclusion == "success")] | length')"
    [ "$passed" = "3" ] || { echo "CI has not fully passed on $COMMIT ($passed of 3 jobs)."; exit 1; }
  fi
  echo "Building $COMMIT on the server"
  git archive --format=tar "$COMMIT" | ssh_ "rm -rf /opt/rolematch/source && mkdir -p /opt/rolematch/source && tar -x -C /opt/rolematch/source"
  ssh_ "cd /opt/rolematch/source && docker build -q --build-arg ROLEMATCH_COMMIT=$COMMIT -t rolematch:$COMMIT . && cp deploy/compose.yml deploy/Caddyfile deploy/backup.sh deploy/restore.sh /opt/rolematch/"
fi

ssh_ "COMMIT=$COMMIT DOMAIN=$DOMAIN bash -s" <<'REMOTE'
set -u
cd /opt/rolematch
previous=$(cat release 2>/dev/null || true)
up() { RELEASE=$1 LIVE_DOMAIN=$DOMAIN docker compose up -d --wait --wait-timeout 180; }
if up "$COMMIT" && curl -sf --retry 10 --retry-delay 3 --retry-all-errors "https://$DOMAIN/api/ready" > /dev/null; then
  [ "$previous" != "$COMMIT" ] && [ -n "$previous" ] && echo "$previous" > release.previous
  echo "$COMMIT" > release; echo "Live on $COMMIT"; exit 0
fi
docker compose logs --tail 40 api worker || true
if [ -n "$previous" ] && [ "$previous" != "$COMMIT" ]; then up "$previous"; echo "Failed: put $previous back."; else echo "Failed: there is no previous release to put back."; fi
exit 1
REMOTE
