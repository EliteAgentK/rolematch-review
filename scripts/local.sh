#!/usr/bin/env bash
# Runs RoleMatch on your own computer with one command: npm run local
# Needs only Node.js 24 and Docker. It starts the local stack (PostgreSQL, the sign-in service and storage, through the Supabase command-line tool,
# fetched by npx at a fixed version), applies the schema, builds the website and starts the server on http://localhost:8787, where you sign up.
# Its settings are its own (server/data/local.env, git-ignored, made on the first run): server/.env is never read, so this can never reach another database.
# The AI is off: documents are read by the rule-based reader, and the record says so. Stop the stack afterwards with: npx supabase@2.121.0 stop
set -euo pipefail
cd "$(dirname "$0")/.."
STACK=(npx --yes supabase@2.121.0)
SETTINGS=server/data/local.env

command -v node >/dev/null || { echo "RoleMatch needs Node.js 24 first: https://nodejs.org" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || { echo "RoleMatch needs Node.js 24 or later (this is $(node -v))." >&2; exit 1; }
command -v docker >/dev/null || { echo "RoleMatch needs Docker first (Docker Desktop, or Colima on a Mac)." >&2; exit 1; }
if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null; then colima start --cpu 4 --memory 4 --disk 30; else echo "Docker is installed but not running: start it, then run this again." >&2; exit 1; fi
fi

# Sign-in tokens are signed with a key of this machine's own, as on live (supabase/config.toml); made once, never committed.
if [ ! -s supabase/signing_keys.json ]; then
  (umask 077; echo '[]' > supabase/signing_keys.json)
  "${STACK[@]}" gen signing-key --algorithm ES256 --append >/dev/null
fi
echo "Starting the local stack (the first time downloads about 3.5 GB)..."
"${STACK[@]}" start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null

[ -d node_modules ] || npm install --no-audit --no-fund
[ -d server/node_modules ] || (cd server && npm install --no-audit --no-fund)

if [ ! -s "$SETTINGS" ]; then
  mkdir -p server/data
  # Sign-up needs no e-mailed code here, and no mail is sent: this machine only (the server refuses both settings on live).
  "${STACK[@]}" status -o json 2>/dev/null | node -e '
    const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const local = (u) => /^(?:https?|postgres(?:ql)?):\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(u ?? "");
    const key = s.SERVICE_ROLE_KEY ?? s.SECRET_KEY;
    if (!local(s.API_URL) || !local(s.DB_URL) || !key) { console.error("Refusing: the local stack is not all on this machine."); process.exit(1); }
    process.stdout.write([`SUPABASE_URL=${s.API_URL}`, `SUPABASE_SERVICE_ROLE_KEY=${key}`, `DATABASE_URL=${s.DB_URL}`, "PUBLIC_APP_URL=http://localhost:8787",
      "ALLOWED_ORIGINS=http://localhost:8787,http://localhost:5173", "SIGNUP_REQUIRE_CODE=false", ""].join("\n"));
  ' > "$SETTINGS.new"
  chmod 600 "$SETTINGS.new" && mv "$SETTINGS.new" "$SETTINGS"
fi
export ROLEMATCH_ENV_FILE="$PWD/$SETTINGS"

(cd server && npm run --silent migrate)
npm run --silent build >/dev/null
echo
echo "RoleMatch is starting on http://localhost:8787 : open it and sign up (no code is needed on this machine). Ctrl+C stops it."
cd server && exec npm run --silent start
