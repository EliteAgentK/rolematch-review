# The headline role on each candidate card against PROVISIONAL labels (data/real-cvs/keys/headlines.json): right when its words match an acceptable reading.
#   python3 -I test/collection/scoreHeadline.py <run> [<run> ...]
import json,re,sys
L=json.load(open('data/real-cvs/keys/headlines.json'))['labels']
words=lambda s:[w for w in re.sub(r"[^a-z0-9#+. ]"," ",str(s or '').lower()).split() if w not in('the','of','and','a','|','/')]
def same(a,b):
    A,B=set(words(a)),set(words(b))
    return bool(A and B) and len(A&B)/len(A|B)>=0.75
for run in sys.argv[1:]:
    R={q['id']:q['record'] for q in json.load(open(f'data/real-cvs/candidate/{run}.json'))['rows']}
    ok=[i for i in L if i in R and any(same(R[i].get('role'),x) for x in L[i])]; empty=[i for i in L if i in R and not str(R[i].get('role') or '').strip()]
    print(f"{run:12} headline right {len(ok)}/{len([i for i in L if i in R])}  empty {len(empty)}  wrong {len([i for i in L if i in R])-len(ok)-len(empty)}: {' '.join(i for i in L if i in R and i not in ok and i not in empty)}")
