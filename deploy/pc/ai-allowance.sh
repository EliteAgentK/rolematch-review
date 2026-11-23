#!/usr/bin/env bash
# Each company's monthly AI allowance (supabase/migrations/047_org_ai_allowance.sql), as the database's owner (migrate.env): the application cannot change it.
#   sudo /srv/rolematch/deploy/pc/ai-allowance.sh                       every company: this month's AI spend and its allowance
#   sudo /srv/rolematch/deploy/pc/ai-allowance.sh <company id> <dollars>  sets one (0 stops its AI; "default" returns it to the platform's figure)
set -euo pipefail
IMAGE="$(docker inspect rm-api --format '{{.Config.Image}}')"
MIG=(); [ -r /etc/rolematch/migrate.env ] && MIG=(--env-file /etc/rolematch/migrate.env)
exec docker run --rm --network host --env-file /etc/rolematch/live.env ${MIG[@]+"${MIG[@]}"} "$IMAGE" node src/scripts/aiAllowance.js --target-confirmed "$@"
