#!/usr/bin/env bash
# Refuses to do anything if an environment could touch another: register R108 and the owner's direction of 2026-11-05. Each environment names itself, and everything it could reach is compared with live before any change.
#   deploy/preflight.sh rehearsal|bench|live
# Environment files can be pointed elsewhere for the test of this script: ROLEMATCH_REHEARSAL_ENV, ROLEMATCH_LIVE_ENV. The names it compares are read from the scripts themselves, so this cannot drift from what they run.
set -uo pipefail
WANT="${1:?Which environment: rehearsal, bench or live?}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REHEARSAL="${ROLEMATCH_REHEARSAL_ENV:-$HOME/.rolematch/rehearsal.env}"; LIVE="${ROLEMATCH_LIVE_ENV:-$HOME/.rolematch/mac.env}"
REHEARSE_SCRIPT="${ROLEMATCH_REHEARSE_SCRIPT:-$ROOT/deploy/rehearse.sh}"; LIVE_SCRIPT="${ROLEMATCH_LIVE_SCRIPT:-$ROOT/deploy/mac/run.sh}"
fail() { echo "PREFLIGHT REFUSED ($WANT): $1" >&2; exit 3; }
value() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- ; }
hostOf() { printf '%s' "$1" | sed -E 's#^[a-z+]+://##; s#^[^@/]*@##; s#[:/?].*$##'; }
isLocal() { case "$1" in 127.0.0.1|localhost|::1|host.lima.internal|"") return 0;; *) return 1;; esac; }

if [ "$WANT" = live ]; then
  [ -f "$LIVE" ] || fail "no live settings"
  [ "$(value "$LIVE" ROLEMATCH_ENVIRONMENT)" = live ] || fail "the live settings do not say ROLEMATCH_ENVIRONMENT=live"
  # A database on this machine is live's only when its settings say the PC is its home (DATABASE_HOME=pc, docs/architecture/DESIGN_JOHANNESBURG_MOVE.md C4),
  # and never with the local stack's well-known password: a rehearsal database can still never be taken for live's.
  if isLocal "$(hostOf "$(value "$LIVE" DATABASE_URL)")"; then
    [ "$(value "$LIVE" DATABASE_HOME)" = pc ] || fail "live settings point at a database on this machine"
    case "$(value "$LIVE" DATABASE_URL)" in *://postgres:postgres@*|*://*:postgres@*) fail "live's database on this machine uses the local stack's default password";; esac
    echo "preflight: live settings name themselves and point at the PC's own database"; exit 0
  fi
  echo "preflight: live settings name themselves and point at a hosted database"; exit 0
fi
[ -f "$REHEARSAL" ] || fail "no settings for it"
[ "$(value "$REHEARSAL" ROLEMATCH_ENVIRONMENT)" = rehearsal ] || fail "its settings do not say ROLEMATCH_ENVIRONMENT=rehearsal"
db="$(value "$REHEARSAL" DATABASE_URL)"; sb="$(value "$REHEARSAL" SUPABASE_URL)"
isLocal "$(hostOf "$db")" || fail "its database is not on this machine"
isLocal "$(hostOf "$sb")" || fail "its Supabase is not on this machine"
case "$(value "$REHEARSAL" MAIL_SMTP_HOST)" in 127.0.0.1|localhost|"") ;; *) fail "its mail does not stay on this machine";; esac
if [ -f "$LIVE" ]; then
  for k in DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY LOCAL_ENCRYPTION_KEY OPS_TOKEN BACKUP_KEY MAIL_SMTP_PASS; do a="$(value "$REHEARSAL" "$k")"; b="$(value "$LIVE" "$k")"; [ -n "$a" ] && [ "$a" = "$b" ] && fail "it shares $k with live"; done
  [ "$(value "$REHEARSAL" PORT)" = "$(value "$LIVE" PORT)" ] && fail "it would listen on live's port"
fi
# Container names, written outright (--name rm-api) or with the run script's prefix (--name "${P}-api", rm- unless told otherwise).
names() { grep -oE -- '--name "?(\$\{P\}-)?[A-Za-z0-9_-]+' "$1" | awk '{print $2}' | sed -E 's/^"?\$\{P\}-/rm-/; s/^"//' | sort -u; }
# A volume named outright (-v name:/data, VOL=name), as a default (${ROLEMATCH_DATA_VOLUME:-name}), or set for a host (ROLEMATCH_DATA_VOLUME=name): a name written any of these
# ways is still that volume. Live's volumes are those of its run script and of the PC's nightly backup, so neither machine's live data can be a rehearsal's (register R152).
vols() { grep -hoE -- '-v "?\$?[A-Za-z0-9_-]+:/data|VOL=[A-Za-z0-9_-]+|-v [A-Za-z0-9_-]+:/data|\$\{[A-Z_]+:-[A-Za-z0-9_-]+\}:/data|ROLEMATCH_DATA_VOLUME=[A-Za-z0-9_-]+' "$@" 2>/dev/null | sed -E 's/^-v "?//; s/^VOL=//; s/^ROLEMATCH_DATA_VOLUME=//; s/^\$\{[A-Z_]+:-([A-Za-z0-9_-]+)\}/\1/; s/:\/data$//' | grep -v '^\$' | sort -u; }
LIVE_VOLUME_FILES=("$LIVE_SCRIPT" "${ROLEMATCH_PC_LIVE_SCRIPT:-$ROOT/deploy/pc/backup-nightly.sh}")
[ -f "$LIVE_SCRIPT" ] && { overlap="$(comm -12 <(names "$REHEARSE_SCRIPT") <(names "$LIVE_SCRIPT"))"; [ -n "$overlap" ] && fail "it would use live's containers: $overlap"; overlap="$(comm -12 <(vols "$REHEARSE_SCRIPT") <(vols "${LIVE_VOLUME_FILES[@]}"))"; [ -n "$overlap" ] && fail "it would use live's data volume: $overlap"; }
grep -qE '\brm-(api|worker|tunnel)\b' "$REHEARSE_SCRIPT" && fail "its script names a live container"
echo "preflight: $WANT shares nothing with live"
