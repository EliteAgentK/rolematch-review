# The real CVs, reader against reader, on this machine. Prints counts and opaque IDs only: no name, no line of any document.
# Scored only where a person checked the answer (name, email, phone). The rest is what changed and an independent check on dates, never a claim of accuracy.
import json,sys,collections
R='data/real-cvs/candidate'
a=json.load(open(f'{R}/{sys.argv[1]}.json')); b=json.load(open(f'{R}/{sys.argv[2]}.json'))
A={r['id']:r for r in a['rows']}; B={r['id']:r for r in b['rows']}
labels=json.load(open('data/real-cvs/labels.json'))
norm=lambda s:''.join(str(s or '').lower().split()); dig=lambda s:''.join(c for c in str(s or '') if c.isdigit())
def score(rows,field):
    t=collections.Counter()
    for i,l in labels.items():
        r=rows.get(i)
        if not r or not r.get('ok'): t['unread']+=1; continue
        got=(r.get('record') or {}).get(field,''); want=l.get(field,''); f=dig if field=='phone' else norm
        if l.get(field+'Unsure'): t['unsure']+=1
        elif l.get(field+'Absent'): t['right' if not got else 'wrong']+=1
        elif not got: t['missing']+=1
        else: t['right' if f(got)==f(want) else 'wrong']+=1
    return dict(t)
print(f"before {a['commit'][:8]}  after {b['commit'][:8]}  documents {len(A)} / {len(B)}, all development: every one has informed earlier work; there is no unseen real set")
print('SCORED against a person\'s answers (21 documents):')
for f in ('name','email','phone'): print(f"  {f:6} before {score(A,f)}  after {score(B,f)}")
print('NOT SCORED, counts only:')
def tot(rows,k): return sum(len((r.get('record') or {}).get(k) or []) for r in rows.values())
for k in ('workHistory','skills','education','certifications','languages'): print(f"  {k:15} before {tot(A,k):5}  after {tot(B,k):5}")
def dr(rows):
    ok=sum(1 for r in rows.values() if r.get('rolesOk')); ranges=sum(r.get('dateRanges') or 0 for r in rows.values()); roles=tot(rows,'workHistory'); return ok,ranges,roles
print('  independent date check: documents with roles for at least half their date ranges; ranges; roles:',dr(A),'->',dr(B))
rv=lambda rows:collections.Counter((r.get('review') or {}).get('state') if isinstance(r.get('review'),dict) else r.get('review') for r in rows.values())
print('  review burden',dict(rv(A)),'->',dict(rv(B)))
print('  no role has a start date:',sum(1 for r in A.values() if (r.get('record') or {}).get('workHistory') and all(not w.get('startDate') for w in r['record']['workHistory'])),'->',sum(1 for r in B.values() if (r.get('record') or {}).get('workHistory') and all(not w.get('startDate') for w in r['record']['workHistory'])))
print('  blank employer on a role:',sum(1 for r in A.values() for w in (r.get('record') or {}).get('workHistory') or [] if not w.get('company')),'->',sum(1 for r in B.values() for w in (r.get('record') or {}).get('workHistory') or [] if not w.get('company')))
print('DOCUMENT BY DOCUMENT, what changed (roles, skills, education, certificates, languages):')
same=0
for i in sorted(A):
    ra,rb=(A[i].get('record') or {}),(B.get(i,{}).get('record') or {})
    d=[]
    for k,s in (('workHistory','roles'),('skills','skills'),('education','edu'),('certifications','certs'),('languages','langs')):
        x,y=len(ra.get(k) or []),len(rb.get(k) or [])
        if x!=y: d.append(f'{s} {x}->{y}')
    wa=[(w.get('position'),w.get('company')) for w in ra.get('workHistory') or []]; wb=[(w.get('position'),w.get('company')) for w in rb.get('workHistory') or []]
    if wa!=wb and len(wa)==len(wb): d.append('role text changed')
    for k in ('name','email','phone','location'):
        if ra.get(k)!=rb.get(k): d.append(k+' changed')
    if d: print(' ',i,(A[i].get('dateRanges'),'ranges'),'; '.join(d))
    else: same+=1
print('  unchanged:',same)
