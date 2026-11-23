#!/usr/bin/env bash
# Runs the load test from the Mac against the load target on the PC (docs/ops/TRENDS_AND_LOAD.md). Start the target first, on the PC:
#   deploy/pc/load-target.sh up <commit>
# then here:
#   load/run.sh            steps: 10, 25, 50, then 100 recruiters at once, 3 minutes each, stopping at the first step that misses the pass marks
#   load/run.sh smoke      one recruiter, once: does it work at all
#   load/run.sh spike      a rush of 100 in 30 seconds          (SPIKE=200 load/run.sh spike for more)
#   load/run.sh steady     30 new journeys a minute for 5 minutes (RATE=60 load/run.sh steady for more)
# The PC is reached over the existing key-only connection (deploy/mac/pc.conf); the target's port is carried through it, so nothing new is opened on either
# machine. The accounts are copied for the run only, into a private temporary folder removed at the end. Results: load/results/<date>_<shape>.json
# (git-ignored), and a table at the end.
set -euo pipefail
cd "$(dirname "$0")"
. ../deploy/mac/pc.conf; KEY="$HOME/.ssh/rolematch_dell"; PORT=18799; SHAPE="${1:-steps}"
command -v k6 >/dev/null || { echo "k6 is not installed: brew install k6" >&2; exit 1; }
on_pc() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$PC" "wsl -d RoleMatch -u root -- bash -c \"echo $(printf '%s' "$1" | base64 | tr -d '\n') | base64 -d | bash\""; }
on_pc 'docker inspect rml-api >/dev/null 2>&1' || { echo "No load target on the PC. Start one there: deploy/pc/load-target.sh up <commit>" >&2; exit 1; }

umask 077; TMP=$(mktemp -d); TUNNEL=""
trap '[ -n "$TUNNEL" ] && kill "$TUNNEL" 2>/dev/null; rm -rf "$TMP"' EXIT
on_pc 'cat /srv/rolematch/load/accounts.json' > "$TMP/accounts.json"
ssh -i "$KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L "$PORT:127.0.0.1:$PORT" "$PC" & TUNNEL=$!
for _ in $(seq 1 20); do curl -fsS -m 2 "http://127.0.0.1:$PORT/api/ready" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 2 "http://127.0.0.1:$PORT/api/ready" >/dev/null || { echo "The load target does not answer through the connection." >&2; exit 1; }

mkdir -p results; STAMP=$(date +%Y-%m-%d_%H%M); RAN=()
one() { local shape="$1" label="$2"; shift 2
  RAN+=("$label")
  k6 run --quiet -e PROFILE="$shape" -e ACCOUNTS="$TMP/accounts.json" -e BASE="http://127.0.0.1:$PORT" "$@" --summary-export "results/${STAMP}_${label}.json" journey.js; }
case "$SHAPE" in
  steps) for n in 10 25 50 100; do
           if ! one hold "steps-$n" -e VUS="$n"; then echo "Stopped at $n recruiters at once: the pass marks were missed (or the watchdog stopped the target to protect live)."; break; fi
         done ;;
  smoke|spike|steady|hold) one "$SHAPE" "$SHAPE" || true ;;
  *) echo "unknown shape $SHAPE: steps, smoke, spike, steady or hold" >&2; exit 1 ;;
esac

# The table: one line for each run, in plain words.
python3 - "$STAMP" "${RAN[@]}" <<'PY'
import json, sys
stamp, runs = sys.argv[1], sys.argv[2:]
print(f"\n{'run':<12}{'people':>8}{'requests':>10}{'failed':>9}{'page, typical':>15}{'slowest 5%':>12}{'CV read (95%)':>15}{'CVs read':>10}  pass")
for r in runs:
    try: m = json.load(open(f"results/{stamp}_{r}.json"))["metrics"]
    except FileNotFoundError: continue
    d, f, c = m.get("http_req_duration{kind:page}", {}), m.get("http_req_failed", {}), m.get("cv_read_seconds", {})
    ok, passed = m.get("cv_read_ok", {}), all(not v for x in m.values() for v in x.get("thresholds", {}).values())
    cv = f"{c['p(95)']:.0f} s" if c else "-"
    read = f"{ok.get('passes', 0)}/{ok.get('passes', 0) + ok.get('fails', 0)}" if ok else "-"
    ms = lambda k: f"{d[k]:.0f}ms" if k in d else "-"   # smoke has no page timings of its own: a dash, not a zero
    print(f"{r:<12}{m.get('vus_max', {}).get('value', 0):>8}{m.get('http_reqs', {}).get('count', 0):>10}{f.get('value', 0) * 100:>8.1f}%{ms('med'):>15}{ms('p(95)'):>12}{cv:>15}{read:>10}  {'yes' if passed else 'NO'}")
print("\nPass marks: under 1% failed; pages' slowest 5% under 2 s (the live health report's own limit), sign-in under 5 s, uploads under 10 s. Full results: load/results/")
PY
