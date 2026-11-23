# Real CVs against their PROVISIONAL answer keys, with denominators. Counts and opaque IDs only.
# Provenance: keys written 5 Nov by Claude from operating-system text, and rendered pages where text was missing; not independent ground truth. Owner-checked name, email and phone (data/real-cvs/labels.json) are authoritative and used where present. All 30 documents are development material.
# A key role is DETECTED when a read role has the same start year (where the key gives one) and its title or employer. Each read role can answer one key role; what is left over is EXTRA. FULL means title, employer and start year all right on one record.
import json,re,sys,collections
import os
R=os.environ.get('RUNS','data/real-cvs/candidate'); keys={};labels=json.load(open('data/real-cvs/labels.json')) if 'KEYS' not in os.environ else {}
for l in open(os.environ.get('KEYS','data/real-cvs/keys/keys.jsonl')):
    k=json.loads(l)
    if 'ONLY' in os.environ and os.environ['ONLY'] not in (k.get('family',''),k.get('split','')): continue
    keys[k['id']]=k
words=lambda s:[w for w in re.sub(r"[^a-z0-9#+. ]"," ",str(s or '').lower().replace('ﬀ','ff')).split() if w not in('the','of','in','and','a','ltd','pty','sa','group','company','limited')]
if 'SAME_AS' in os.environ:   # only the documents a partial run has reached
    have={r['id'] for r in json.load(open(f"{R}/{os.environ['SAME_AS']}.json"))['rows']}; keys={i:k for i,k in keys.items() if i in have}
def near(a,b,t=0.6):
    A,B=set(words(a)),set(words(b))
    return bool(A and B) and len(A&B)/min(len(A),len(B))>=t
yr=lambda s:(re.search(r'(19|20)\d\d',str(s or '')) or [None])[0]
present=lambda s:bool(re.search(r'present|current|now|date',str(s or ''),re.I))
dig=lambda s:''.join(c for c in str(s or '') if c.isdigit())[-9:]
def score(run):
    x=json.load(open(f'{R}/{run}.json')); rows={r['id']:r for r in x['rows']}
    T=collections.defaultdict(collections.Counter); per={}
    for i,k in keys.items():
        r=rows.get(i,{}).get('record') or {}; l=labels.get(i,{})
        for f in ('name','email','phone','location'):
            want=l.get(f) if l.get(f) else k.get(f,'')
            if f!='location' and l.get(f+'Absent'): want=''
            got=r.get(f) or ''
            same=(dig(got)==dig(want)) if f=='phone' else near(got,want,0.99 if f=='email' else 0.67)
            T[f]['correct' if (same if want else not got) else ('missing' if not got else 'wrong')]+=1
        P=list(r.get('workHistory') or []); used=set(); t=T['roles']; d=dict(key=len(k['roles']),det=0,full=0)
        def find(role):
            title,emp,start=role[0],role[1],role[2]; best=None
            for n,p in enumerate(P):
                if n in used: continue
                y=yr(p.get('startDate')); okY=(not start) or y==start
                tt,ee=near(p.get('position'),title),(near(p.get('company'),emp) if emp else False)
                swap=near(p.get('company'),title) or (emp and near(p.get('position'),emp))
                s=(3 if tt and (ee or not emp) and okY else 2 if okY and (tt or ee) else 1 if okY and swap and start else 0)
                if s and (best is None or s>best[0]): best=(s,n)
            return best
        for role in k['roles']:
            t['key']+=1; b=find(role)
            if b is None: t['missing']+=1; continue
            used.add(b[1]); p=P[b[1]]; d['det']+=1; t['detected']+=1
            tt=near(p.get('position'),role[0]); ee=near(p.get('company'),role[1]) if role[1] else True; st=yr(p.get('startDate'))==role[2] if role[2] else True
            en=(present(p.get('endDate')) if role[3]=='present' else yr(p.get('endDate'))==role[3]) if role[3] else True
            t['title']+=tt; t['employer']+=ee; t['start']+=st; t['end']+=en
            if tt and ee and st: t['full']+=1; d['full']+=1
            if tt and ee and st and en: t['fullEnd']+=1
        for role in k.get('optionalRoles',[]):
            b=find(role)
            if b: used.add(b[1])
        d['extra']=len(P)-len(used); t['extra']+=d['extra']; t['read']+=len(P); d['read']=len(P)
        # Education against the key's education, certificates against its certificates (the key and the panel keep them apart; reader-0.9.0 lists certificates
        # in the education array with type 'certificate', which counted them as education reads). Certificates are still scored, below, with the certifications.
        E=[p for p in (r.get('education') or []) if p.get('type')!='certificate']; C=[p for p in (r.get('education') or []) if p.get('type')=='certificate']; u=set(); e=T['education']; e['key']+=len(k['education']); e['read']+=len(E)
        for q in k['education']:
            hit=next((n for n,p in enumerate(E) if n not in u and (near(p.get('degree'),q[0]) or (q[1] and near(p.get('institution') or p.get('degree'),q[1]) and (not q[2] or yr(p.get('year'))==q[2])))),None)
            if hit is not None: u.add(hit); e['hit']+=1
        d['eduRead']=len(E); d['eduHit']=len(u); d['eduKey']=len(k['education'])
        for f,key in (('skills','skills'),('certifications','certs'),('languages','languages')):
            G=[str(s if not isinstance(s,dict) else s.get('name','')) for s in (r.get(f) or [])]
            if f=='certifications': G+=[str(p.get('degree')) for p in E+C]
            T[f]['key']+=len(k.get(key,[])); T[f]['hit']+=sum(any(near(g,s,0.6) for g in G) for s in k.get(key,[]))
            own=[str(s if not isinstance(s,dict) else s.get('name','')) for s in (r.get(f) or [])]
            T[f]['read']+=len(own); T[f]['inKey']+=sum(any(near(g,s,0.6) for s in k.get(key,[])) for g in own)
        ag=(r.get('submission') or {}).get('agency') or {}; want=k.get('agency')
        T['agency']['key']+=1 if want else 0; T['agency']['hit']+=1 if want and near(ag.get('name'),want,0.5) else 0; T['agency']['wrong']+=1 if want and ag.get('name') and not near(ag.get('name'),want,0.5) else 0; T['agency']['false']+=1 if not want and ag.get('name') else 0
        per[i]=d
    return T,per
pc=lambda a,b:f"{100*a/b:5.1f}%" if b else '    -'
runs=sys.argv[1:]; out=[score(r) for r in runs]
print(('PROVISIONAL keys, 30 development documents.' if 'KEYS' not in os.environ else f'Generator keys, {len(keys)} fictional people.'),'Runs:',runs)
for f in ('name','email','phone','location'):
    print(f"{f:10}"+''.join(f"  {pc(o[0][f]['correct'],len(keys))} ok {o[0][f]['wrong']:2} wrong {o[0][f]['missing']:2} miss" for o in out))
for label,fn in (('roles in key',lambda t:str(t['key'])),('roles read',lambda t:str(t['read'])),('detected',lambda t:f"{pc(t['detected'],t['key'])} {t['detected']}"),('title right',lambda t:f"{pc(t['title'],t['key'])} {t['title']}"),('employer right',lambda t:f"{pc(t['employer'],t['key'])} {t['employer']}"),('start yr right',lambda t:f"{pc(t['start'],t['key'])} {t['start']}"),('end right',lambda t:f"{pc(t['end'],t['key'])} {t['end']}"),('FULL record',lambda t:f"{pc(t['full'],t['key'])} {t['full']}"),('full plus end',lambda t:f"{pc(t['fullEnd'],t['key'])} {t['fullEnd']}"),('missing',lambda t:str(t['missing'])),('extra or dup',lambda t:str(t['extra'])),('precision',lambda t:pc(t['full'],t['read']))):
    print(f"{label:16}"+''.join(f"{fn(o[0]['roles']):>16}" for o in out))
for label,fn in (('edu in key',lambda t:str(t['key'])),('edu read',lambda t:str(t['read'])),('edu recall',lambda t:pc(t['hit'],t['key'])),('edu precision',lambda t:pc(t['hit'],t['read']))):
    print(f"{label:16}"+''.join(f"{fn(o[0]['education']):>16}" for o in out))
for f in ('skills','certifications','languages'):
    print(f"{f+' recall':16}"+''.join(f"{pc(o[0][f]['hit'],o[0][f]['key']):>16}" for o in out))
    print(f"{f+' prec':16}"+''.join(f"{pc(o[0][f]['inKey'],o[0][f]['read']):>16}" for o in out))
print(f"{'agency name':16}"+''.join(f"{str(o[0]['agency']['hit'])+'/'+str(o[0]['agency']['key'])+' f'+str(o[0]['agency']['false'])+' w'+str(o[0]['agency']['wrong']):>16}" for o in out))
if len(out)==2:
    print('\ndoc     key | detected full extra  ->  detected full extra | edu read/hit of key (second run)')
    for i in sorted(keys):
        a,b=out[0][1][i],out[1][1][i]
        f='' if (a['full'],a['extra'],a['det'])==(b['full'],b['extra'],b['det']) else (' WORSE' if b['full']<a['full'] or b['det']<a['det'] else ' BETTER')
        print(f"  {i[3:]} {a['key']:3} | {a['det']:2} {a['full']:2} {a['extra']:2} -> {b['det']:2} {b['full']:2} {b['extra']:2}{f:7} {b['eduRead']:3}/{b['eduHit']} of {b['eduKey']}")
