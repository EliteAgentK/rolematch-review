#!/usr/bin/env python3
# What each operation of a crowd did across all shards: how many, how fast (worst shard's percentile, so nothing is flattered), and every answer other than success, by cause. Takes the file prefix.
import json,sys,glob,collections
ops=collections.defaultdict(lambda:{'n':0,'p50':0,'p95':0,'p99':0,'worst':0,'tenant':0,'status':collections.Counter()})
times=[]
for f in glob.glob(sys.argv[1]+'*.jsonl'):
    for l in open(f):
        r=json.loads(l)
        if r['label'] not in sys.argv[2:] and len(sys.argv)>2: continue
        for op,o in r['ops'].items():
            a=ops[op]; a['n']+=o['n']
            for p in ('p50','p95','p99'): a[p]=max(a[p],o[p])
            a['worst']=max(a['worst'],o['max']); a['tenant']=max(a['tenant'],o.get('worstTenantP95',0))
            for s,v in o['status'].items(): a['status'][s]+=v
print(f"{'operation':26}{'count':>9}{'ok':>9}{'p50':>7}{'p95':>7}{'p99':>7}{'worst tenant p95':>18}  other answers")
tot=collections.Counter()
for op in sorted(ops,key=lambda k:-ops[k]['n']):
    a=ops[op]; good=sum(v for s,v in a['status'].items() if s.split(':')[0].isdigit() and 200<=int(s.split(':')[0])<400 or (op.endswith('refused') and s.startswith('403')))
    other={s:v for s,v in a['status'].items() if not (s.split(':')[0].isdigit() and 200<=int(s.split(':')[0])<400) and not (op.endswith('refused') and s.startswith('403'))}
    for s,v in other.items(): tot[s]+=v
    print(f"{op:26}{a['n']:9}{good:9}{a['p50']:7}{a['p95']:7}{a['p99']:7}{a['tenant']:18}  "+' '.join(f"{k}={v}" for k,v in sorted(other.items(),key=lambda x:-x[1])[:6]))
print('all other answers:',dict(tot.most_common(20)))

# What happened to every request, kept apart. A refusal is not a success: useful work is reported beside it.
CATS=[('served','the work was done'),('expected','a correct answer about the request: not found, two people editing, a hiring manager refused'),('limit','a Settings limit doing its job'),('throttled','a rate limit: told to slow down'),('capacity','refused for capacity: busy, or the portal slots are in use'),('timeout','no answer in time'),('connection','the connection failed'),('signedout','the session was refused'),('server','a server error')]
def cat(op,s):
    head=s.split(':')[0]
    if s=='timeout': return 'timeout'
    if s in('conn-error','error'): return 'connection'
    if not head.isdigit(): return 'connection'
    n=int(head)
    if 200<=n<400: return 'served'
    if n>=500 and 'SVC-BUSY' not in s and 'SVC-READONLY' not in s: return 'server'
    if 'SVC-BUSY' in s or 'CAPACITY' in s: return 'capacity'
    if 'QUOTA' in s or 'FILE-' in s: return 'limit'
    if 'RATE' in s or n==429: return 'throttled'
    if op.endswith('refused') and n==403: return 'expected'
    if n==401: return 'signedout'
    if n in(403,404,409): return 'expected'
    return 'server'
tally=collections.Counter(); detail=collections.defaultdict(collections.Counter)
for op,a in ops.items():
    if op.startswith('batch.finished'): continue
    for st,v in a['status'].items():
        c=cat(op,st); tally[c]+=v
        if c not in('served',): detail[c][st]+=v
total=sum(tally.values())
print(); print(f"{total} requests")
for c,why in CATS: print(f"  {c:11}{tally[c]:9}  {100*tally[c]/max(1,total):6.2f}%  {why}"+('  '+', '.join(f'{k}={v}' for k,v in detail[c].most_common(4)) if detail[c] else ''))
print('Useful work:', ', '.join(f"{n}: {ops[n]['status'].get('200',0)+sum(v for k,v in ops[n]['status'].items() if k in('201','202'))}" for n in ['batch.upload','match','match.candidate-to-jobs','match.job-to-candidates','edit.status','edit.notes','open.candidate'] if n in ops))
for n in sorted(ops):
    if n.startswith('batch.finished'): a=ops[n]; print(f"  {n}: {a['n']} finished, slowest-shard median {a['p50']/1000:.0f} s, p95 {a['p95']/1000:.0f} s")
