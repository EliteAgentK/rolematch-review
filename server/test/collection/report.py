# Coverage of the whole collection by stable document ID, and accuracy by field and format where checked answers exist. Counts only.
import json,glob,collections,os,re,sys
man=[json.loads(l) for l in open('data/collection/manifest.jsonl')]
out={}
for f in glob.glob('data/collection/c1/outcomes-*.jsonl')+glob.glob('data/collection/real-c1/outcomes-*.jsonl'):
    for l in open(f):
        r=json.loads(l); out[r['id']]=r
uniq=[m for m in man if not m.get('duplicateOf')]
print('manifest files',len(man),'duplicates',len(man)-len(uniq),'unique',len(uniq),'with an outcome',sum(1 for m in uniq if m['id'] in out),'no outcome',[m['id'] for m in uniq if m['id'] not in out][:6])
c=collections.Counter((m['kind'],out.get(m['id'],{}).get('outcome','NONE')) for m in uniq); print(sorted(c.items()))
print('refused codes',collections.Counter((out[m['id']].get('code'),m['kind'],m['format']) for m in uniq if out.get(m['id'],{}).get('outcome') in('refused','failed')).most_common(16))
t=collections.defaultdict(lambda:collections.Counter())
for m in uniq:
    r=out.get(m['id'])
    if r: t[(m['collection'],m['kind'],m['format'])][r['outcome']]+=1
for k,v in sorted(t.items()): print(' ',k[0][:24].ljust(24),k[1],k[2].ljust(6),dict(v))
ms=[r['ms'] for r in out.values() if r.get('ms')]; print('median ms',sorted(ms)[len(ms)//2],'p95',sorted(ms)[int(len(ms)*.95)],'max',max(ms))
# accuracy where keys exist: corpus500, visual60, longform300, by format
roots={'corpus500':'~/Downloads/Reference/Expected_CVs','visual60':'~/Downloads/RoleMatch_60_Visual_Variety_CVs 3/Reference/Expected_CVs','longform300':'~/Downloads/RoleMatch_300_Long_Form_CVs 2/Reference/Expected_CVs','longcvs':'~/Downloads/RoleMatch_Long_CVs/Reference/Expected_CVs'}
norm=lambda s:' '.join(re.sub(r'[^a-z0-9 ]',' ',str(s or '').lower()).split())
dig=lambda s:''.join(c for c in str(s or '') if c.isdigit())
A=collections.defaultdict(lambda:collections.Counter())
for r in out.values():
    if r['kind']!='cv' or r['collection'] not in roots: continue
    p=os.path.expanduser(f"{roots[r['collection']]}/{r['stem']}.json")
    if not os.path.exists(p): continue
    e=json.load(open(p)); rec=r.get('record') or {}; k=(r['collection'],r['format'])
    A[k]['docs']+=1
    if r['outcome'] in('refused','failed'): A[k]['notread']+=1
    A[k]['name']+=norm(rec.get('name'))==norm(e.get('name')); A[k]['email']+=norm(rec.get('email'))==norm(e.get('email')); A[k]['phone']+=dig(rec.get('phone'))==dig(e.get('phone'))
    want=e.get('work_history') or []; got=rec.get('workHistory') or []; A[k]['rolesWant']+=len(want)
    for w in want:
        t=norm(w.get('title') or w.get('position')); c=norm(w.get('employer') or w.get('company'))
        A[k]['rolesFound']+=any(t and t==norm(g.get('position')) and c and c==norm(g.get('company')) for g in got)
    A[k]['rolesExtra']+=max(0,len(got)-len(want)); sk=[norm(s) for s in rec.get('skills') or []]; ws=[norm(x if isinstance(x,str) else x.get('name')) for x in e.get('skills') or []]
    A[k]['skillsWant']+=len(ws); A[k]['skillsFound']+=sum(x in sk for x in ws); A[k]['review']+=r['outcome']=='review'
print('collection format docs notread name email phone roles skills extraRoles review')
pc=lambda a,b:f"{100*a/max(1,b):5.1f}"
for k,v in sorted(A.items()): print(' ',k[0][:12].ljust(12),k[1].ljust(6),str(v['docs']).rjust(4),str(v['notread']).rjust(3),pc(v['name'],v['docs']),pc(v['email'],v['docs']),pc(v['phone'],v['docs']),pc(v['rolesFound'],v['rolesWant']),pc(v['skillsFound'],v['skillsWant']),str(v['rolesExtra']).rjust(4),pc(v['review'],v['docs']))
