#!/usr/bin/env bash
# One training run on the Mac (owner, 6 Nov 2026: the Mac is for fine-tuning; live reads on the PC meanwhile).
#   ml/train.sh <run-name> [config]      writes adapters to ~/rolematch-ml/adapters/<run-name>
# 1. Quit Ollama, so training has the whole Mac. Live's model worker sees the Mac stop answering and moves CV reading to the PC's own model
#    within about 30 s, telling the owner. 2. Train. 3. Reopen Ollama; live moves back by itself and says so.
# Ollama is reopened whatever happens, even if training fails or is stopped.
set -euo pipefail
RUN="${1:?run name}"; CONFIG="${2:-$(dirname "$0")/lora.yaml}"; ML="$HOME/rolematch-ml"; OUT="$ML/adapters/$RUN"
[ -e "$OUT" ] && { echo "$OUT already exists: a run name is used once"; exit 1; }
mkdir -p "$OUT"; cp "$CONFIG" "$OUT/config.yaml"
# Every example must fit whole, or training quietly cuts it and can go to nan (R159). Checked before live loses the Mac.
"$ML/.venv/bin/python" -I "$(dirname "$0")/checkData.py" "$OUT/config.yaml" || { rm -rf "$OUT"; exit 1; }
reopen() { open -a Ollama; for _ in $(seq 1 60); do curl -fsS -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && return; sleep 2; done; echo "Ollama did not come back"; }
trap reopen EXIT
# The app answers a polite quit with "User cancelled" (6 Nov), so it is stopped directly: the app first, so it cannot restart its server, then the server.
pkill -TERM -f "Ollama.app/Contents/MacOS/Ollama" 2>/dev/null || true; sleep 2; pkill -TERM -f "Ollama.app/Contents/Resources/ollama serve" 2>/dev/null || true
for _ in $(seq 1 30); do lsof -nP -iTCP:11434 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
lsof -nP -iTCP:11434 -sTCP:LISTEN >/dev/null 2>&1 && { echo "the Ollama app is still serving on 11434: not training beside live"; exit 1; }
echo "$(date '+%F %T') training $RUN started" | tee -a "$OUT/train.log"
"$ML/.venv/bin/python" -m mlx_lm lora --config "$OUT/config.yaml" --adapter-path "$OUT" 2>&1 | tee -a "$OUT/train.log"
echo "$(date '+%F %T') training $RUN finished" | tee -a "$OUT/train.log"
