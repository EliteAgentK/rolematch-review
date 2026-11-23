# Refuses a training set that the trainer would quietly cut (R159). mlx_lm cuts every example at max_seq_length: an example whose prompt
# alone is that long keeps no answer tokens, its loss is 0/0 and training goes to nan; one whose answer is cut teaches unfinished JSON.
#   .venv/bin/python -I checkData.py <config.yaml>         prints the lengths; exits 1 if any example does not fit whole
import json, re, sys
from pathlib import Path
from huggingface_hub import snapshot_download
from transformers import AutoTokenizer

cfg = Path(sys.argv[1]).read_text()
val = lambda k: re.search(rf"^{k}:\s*(\S+)", cfg, re.M).group(1)
limit, data, model = int(val("max_seq_length")), Path(val("data")), val("model")
tok = AutoTokenizer.from_pretrained(snapshot_download(model))
count = lambda m, **k: len(tok(tok.apply_chat_template(m, tokenize=False, **k), add_special_tokens=False)["input_ids"])
bad = 0
for split in ("train", "valid"):
    lengths = []
    for n, line in enumerate(open(data / f"{split}.jsonl"), 1):
        m = json.loads(line)["messages"]
        full = count(m)
        lengths.append(full)
        if full > limit:
            bad += 1
            print(f"{split} line {n}: {full} tokens (prompt {count(m[:-1], add_generation_prompt=True)}) is over the limit of {limit}")
    lengths.sort()
    print(f"{split}: {len(lengths)} examples, median {lengths[len(lengths) // 2]} tokens, longest {lengths[-1]}, limit {limit}")
if bad:
    sys.exit(f"{bad} examples would be cut: raise max_seq_length or rebuild the set; not training")
