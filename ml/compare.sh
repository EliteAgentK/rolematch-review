#!/usr/bin/env bash
# Step 1 of the fine-tuning plan: the candidate base models on the 30 real CVs, same prompt, context and settings, each asked afresh, on a Mac doing nothing else.
#   ml/compare.sh <tag> <model> [<model> ...]      runs are written as data/real-cvs/candidate/<tag>-<model-slug>.json
# The Ollama app is quit (live moves to the PC's model by itself) and a private Ollama on 127.0.0.1:11435 with live's settings serves the comparison;
# the app is reopened afterwards whatever happens.
set -euo pipefail
TAG="${1:?tag}"; shift; cd "$(dirname "$0")/../server"
reopen() { [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null; open -a Ollama; }
trap reopen EXIT
# The first attempt (6 Nov) measured the wrong machine: an old forwarding link held 11435 and sent every question to the PC, while the app kept
# serving live on the Mac. So: the app must really be gone, the port must be free, and the server answering must be the one started here.
# The app answers a polite quit with "User cancelled" (6 Nov), so it is stopped directly: the app first, so it cannot restart its server, then the server.
pkill -TERM -f "Ollama.app/Contents/MacOS/Ollama" 2>/dev/null || true; sleep 2; pkill -TERM -f "Ollama.app/Contents/Resources/ollama serve" 2>/dev/null || true
for _ in $(seq 1 30); do lsof -nP -iTCP:11434 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
lsof -nP -iTCP:11434 -sTCP:LISTEN >/dev/null 2>&1 && { echo "the Ollama app is still serving on 11434: not comparing beside live"; exit 1; }
lsof -nP -iTCP:11435 -sTCP:LISTEN >/dev/null 2>&1 && { echo "something already listens on 11435: $(lsof -nP -iTCP:11435 -sTCP:LISTEN | tail -1)"; exit 1; }
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_NUM_PARALLEL=1 OLLAMA_KEEP_ALIVE=24h ollama serve >/tmp/ollama-compare.log 2>&1 &
SERVER=$!
for _ in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:11435/api/version >/dev/null 2>&1 && break; sleep 1; done
[ "$(lsof -nP -t -iTCP:11435 -sTCP:LISTEN | head -1)" = "$SERVER" ] || { echo "the server on 11435 is not the one started here"; exit 1; }
for M in "$@"; do
  SLUG=$(echo "$M" | tr ':/.' '---'); DIR="data/real-cvs/answers-$TAG-$SLUG"; mkdir -p "$DIR"
  echo "$(date '+%F %T') $M"
  ROLEMATCH_MODEL_URL=http://127.0.0.1:11435 READER_MODEL="$M" ANSWERS_DIR="$DIR" node --import tsx test/collection/hybridEval.ts "$TAG-$SLUG"
done
echo "$(date '+%F %T') done"
