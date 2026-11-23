# Two readings of the same CVs, compared value by value (plan: docs/architecture/PLAN_CV_READING_CLAUDE_ONLY.md, "the same CV read twice gives the same
# record": at least 95% of values the same). A value is a single field (name, e-mail, phone, where the person lives, headline, department) or one item of
# a list (a job as title, employer, start and end; a qualification; a certificate; a skill; a language). A value agrees when both readings hold it.
# Counts and opaque IDs only; no value is printed.
#   python3 test/collection/agreement.py <run> <run-b>
import json, re, sys
R = "data/real-cvs/candidate"
norm = lambda s: re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()
def values(rec):
    v = {f: {norm(rec.get(f))} - {""} for f in ("name", "email", "phone", "location", "role", "group")}
    v["jobs"] = {"|".join(norm(w.get(k)) for k in ("position", "company", "startDate", "endDate")) for w in rec.get("workHistory", [])}
    v["job titles"] = {norm(w.get("position")) + "|" + norm(w.get("startDate"))[-4:] for w in rec.get("workHistory", [])}
    v["education"] = {norm(e.get("degree")) for e in rec.get("education", []) if e.get("type") != "certificate"}
    v["certificates"] = {norm(e.get("degree")) for e in rec.get("education", []) if e.get("type") == "certificate"} | {norm(c) for c in rec.get("certifications", [])}
    v["skills"] = {norm(s) for s in rec.get("skills", [])}
    v["languages"] = {norm(s) for s in rec.get("languages", [])}
    v["worth noting"] = {norm(s) for s in rec.get("worthNoting", [])}
    v["projects"] = {norm(s) for s in rec.get("projects", [])}
    v["summary (CV's own)"] = {norm(rec.get("summary"))} - {""}
    return v
a = {r["id"]: r["record"] for r in json.load(open(f"{R}/{sys.argv[1]}.json"))["rows"]}
b = {r["id"]: r["record"] for r in json.load(open(f"{R}/{sys.argv[2]}.json"))["rows"]}
both = sorted(set(a) & set(b)); same = {}; either = {}; identical = {}
for i in both:
    va, vb = values(a[i]), values(b[i])
    for f in va:
        same[f] = same.get(f, 0) + len(va[f] & vb[f]); either[f] = either.get(f, 0) + len(va[f] | vb[f]); identical[f] = identical.get(f, 0) + (va[f] == vb[f])
print(f"{len(both)} documents read twice ({sys.argv[1]} and {sys.argv[2]}).")
print(f"{'field':22} {'values the same':>18} {'documents identical':>22}")
skip = {"job titles"}
for f in same:
    print(f"{f:22} {same[f]:>6} of {either[f]:<6} {100 * same[f] / max(1, either[f]):5.1f}%   {identical[f]:>3} of {len(both)}  {100 * identical[f] / len(both):5.1f}%")
ts, te = sum(v for f, v in same.items() if f not in skip), sum(v for f, v in either.items() if f not in skip)
print(f"\nALL VALUES              {ts} of {te}   {100 * ts / max(1, te):.1f}% the same in both readings")
worst = sorted(both, key=lambda i: sum(len(values(a[i])[f] ^ values(b[i])[f]) for f in values(a[i]) if f not in skip), reverse=True)[:5]
print("Most different documents:", ", ".join(f"{i[-6:]} ({sum(len(values(a[i])[f] ^ values(b[i])[f]) for f in values(a[i]) if f not in skip)} values)" for i in worst))
