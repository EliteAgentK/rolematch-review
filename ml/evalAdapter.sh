#!/usr/bin/env bash
# Step 3 of the fine-tuning plan (docs/learning/FINE_TUNE_PLAN_2026-11-06.md): a trained adapter against the base, on the 30 protected real CVs.
#   ml/evalAdapter.sh <run>            e.g. ml/evalAdapter.sh lora2      (adapter in ~/rolematch-ml/adapters/<run>)
# Both models go through the same path, so the path cannot be mistaken for the training: MLX weights are dequantised, imported into Ollama and
# quantised to int4. rm-base-mlx is the base with no adapter, rm-<run> the base with it; the template and settings are copied from the model live
# runs, so only the weights differ. Then ml/compare.sh measures both on a Mac doing nothing else.
# Not live's format: live serves GGUF q4_K_M, which Ollama 0.40 cannot make from safetensors (it offers int4, int8, nvfp4, mxfp4, mxfp8), and
# llama.cpp's converter is outside code not yet allowed here (6 Nov). So this answers "does the training help"; a winner still needs a q4_K_M build.
set -euo pipefail
RUN="${1:?run name}"; ML="$HOME/rolematch-ml"; PY="$ML/.venv/bin/python"; HERE="$(cd "$(dirname "$0")" && pwd)"
BASE=$(awk '/^model:/ {print $2}' "$HERE/lora.yaml"); LIVE=qwen3:4b-instruct-2507-q4_K_M
[ -f "$ML/adapters/$RUN/adapters.safetensors" ] || { echo "no adapter at $ML/adapters/$RUN"; exit 1; }
mkdir -p "$ML/fused"
[ -f "$ML/fused/base/config.json" ] || "$PY" -m mlx_lm convert --hf-path "$BASE" --mlx-path "$ML/fused/base" -d
[ -f "$ML/fused/$RUN/config.json" ] || "$PY" -m mlx_lm fuse --model "$BASE" --adapter-path "$ML/adapters/$RUN" --save-path "$ML/fused/$RUN" --dequantize
for M in base "$RUN"; do
  NAME="rm-$M"; [ "$M" = base ] && NAME=rm-base-mlx
  ollama list | awk '{print $1}' | grep -qx "$NAME:latest" && continue
  { echo "FROM $ML/fused/$M"; ollama show --modelfile "$LIVE" | sed '/^FROM /d;/^# /d'; } > "$ML/fused/$M.Modelfile"
  ollama create "$NAME" -f "$ML/fused/$M.Modelfile" --quantize int4
done
exec "$HERE/compare.sh" "adapter-$RUN" rm-base-mlx "rm-$RUN"
