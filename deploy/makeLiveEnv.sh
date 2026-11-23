#!/usr/bin/env bash
# Makes the live settings file on this machine, in a private folder, and prints no value. It generates the new secrets and takes the mail login from server/.env.
# The owner then fills in the three Supabase values by hand (in an editor, never in chat). Run once; it refuses to overwrite.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="$HOME/.rolematch/live.env"
[ -e "$out" ] && { echo "$out already exists; nothing changed."; exit 0; }
install -d -m 700 "$HOME/.rolematch"
( umask 077; cp "$here/live.env.example" "$out" )
setv() { python3 - "$out" "$1" "$2" <<'PY'
import sys
path, key, value = sys.argv[1:]
lines = open(path).read().split("\n")
open(path, "w").write("\n".join(f"{key}={value}" if l.startswith(key + "=") else l for l in lines))
PY
}
setv LOCAL_ENCRYPTION_KEY "$(openssl rand -base64 32)"
setv OPS_TOKEN "$(openssl rand -hex 32)"
setv BACKUP_KEY "$(openssl rand -hex 32)"
for k in MAIL_SMTP_HOST MAIL_SMTP_USER MAIL_SMTP_PASS; do
  v="$(python3 - "$here/../server/.env" "$k" <<'PY'
import re, sys
for l in open(sys.argv[1]):
    if l.startswith(sys.argv[2] + "="):
        print(re.sub(r"^['\"]|['\"]$", "", l.split("=", 1)[1].strip()))
PY
)"
  [ -n "$v" ] && setv "$k" "$v"
done
echo "Made $out (private to you). Open it and fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL."
