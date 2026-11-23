# python3 e2e/visual-diff.py [--summary] <labelA> <labelB> [state ...]
# Compares two element dumps written by e2e/visual.spec.ts (VISUAL_DUMP=<label>), so a pixel difference can be traced to the element and the
# CSS property that caused it. Visible elements with text, and images, inputs, buttons and icons, are aligned in document order by tag and text
# (difflib), so an element present in only one build does not derail the rest. --summary counts the most common differences over all states.
import difflib, json, os, sys, collections

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "visual-data", "dump")
LEAF = {"img", "svg", "input", "textarea", "select", "button", "hr", "canvas", "option"}
args = sys.argv[1:]; summary = "--summary" in args; by_box = "--boxes" in args; args = [a for a in args if not a.startswith("--")]
A_, B_, only = args[0], args[1], args[2:]

def load(label, f):
    # --boxes: every visible element, paired with the one of the same tag in exactly the same place (finds containers whose look changed)
    return [e for e in json.load(open(os.path.join(D, label, f))) if (by_box or e["text"] or e["tag"] in LEAF) and e.get("vis", True)]

def pairs(pa, pb):
    """(a, b) pairs, with None for an element present on one side only."""
    if by_box:
        at = collections.defaultdict(list)
        for e in pb: at[(e["tag"], tuple(round(v) for v in e["box"]))].append(e)
        for e in pa:
            m = at.get((e["tag"], tuple(round(v) for v in e["box"])))
            if m: yield e, m.pop(0)
        return
    sm = difflib.SequenceMatcher(None, [f'{e["tag"]}|{e["text"]}' for e in pa], [f'{e["tag"]}|{e["text"]}' for e in pb], autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            yield from zip(pa[i1:i2], pb[j1:j2])
        else:
            yield from ((e, None) for e in pa[i1:i2]); yield from ((None, e) for e in pb[j1:j2])

def diffs(a, b):
    out = []
    if any(abs(x - y) > 0.01 for x, y in zip(a["box"], b["box"])): out.append(("box", ",".join(map(str, a["box"])), ",".join(map(str, b["box"]))))
    for p in a["style"].keys() | b["style"].keys():
        if a["style"].get(p) != b["style"].get(p): out.append((p, str(a["style"].get(p)), str(b["style"].get(p))))
    return out

files = [f"{s}.json" for s in only] if only else sorted(os.listdir(os.path.join(D, A_)))
agg, example = collections.Counter(), {}
differing = 0
for f in files:
    if not os.path.exists(os.path.join(D, B_, f)): print(f"{f}: no dump in {B_}"); continue
    lines = []
    for a, b in pairs(load(A_, f), load(B_, f)):
        if a is None or b is None:
            e = a or b; side = f"only in {A_}" if a else f"only in {B_}"
            lines.append(f"  {side}: <{e['tag']}> \"{e['text'][:50]}\" at {','.join(map(str, e['box']))}"); agg[(side, e["tag"])] += 1; continue
        d = diffs(a, b)
        if d:
            lines.append(f"  <{a['tag']}> \"{a['text'][:40]}\" {'>'.join(a['path'].split('>')[-3:])}\n" + "\n".join(f"      {p}: {x} -> {y}" for p, x, y in d))
            for p, x, y in d:
                if p != "box": agg[(p, x[:60], y[:60])] += 1; example.setdefault((p, x[:60], y[:60]), (f, a["tag"], a["text"][:30], a["path"].split(">")[-2:]))
    if lines:
        differing += 1
        if not summary: print(f"== {f[:-5]} ({len(lines)} differences)"); print("\n".join(lines[: int(os.environ.get("LIMIT", 30))]))
if summary:
    for k, c in agg.most_common(int(os.environ.get("TOP", 50))): print(c, k, example.get(k, ""))
print(f"{differing} of {len(files)} states differ")
