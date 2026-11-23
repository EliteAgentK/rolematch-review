#!/usr/bin/env bash
# The application login's rights, after migrations (see grant.sql).  deploy/db/stack/grant.sh <stack.env>
set -euo pipefail
ENVF="${1:?the settings file of the stack}"; set -a; . "$ENVF"; set +a; HERE="$(cd "$(dirname "$0")" && pwd)"
docker exec -i "${NAME:?}-pg" psql -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres < "$HERE/grant.sql" && echo "$NAME-pg: rm_app's rights set"
