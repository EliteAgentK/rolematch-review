import json,sys
rows=[json.loads(l) for l in open(sys.argv[1])]
for r in rows:
    if r['label'] not in ('step-end',): continue
    print(f"step {r['step']} active {r['active']} req {r['requests']} err {r['errorRate']*100:.1f}%")
    # step-end summarises the last window only
agg={}
for r in rows:
    s=r.get('step')
    if s is None: continue
    for op,o in r['ops'].items():
        a=agg.setdefault((s,op),{'n':0,'p50':0,'p95':0,'p99':0,'max':0,'status':{},'worst':0,'best':1e9})
        a['n']+=o['n']; a['p50']=max(a['p50'],o['p50']); a['p95']=max(a['p95'],o['p95']); a['p99']=max(a['p99'],o['p99']); a['max']=max(a['max'],o['max']); a['worst']=max(a['worst'],o['worstTenantP95'])
        for k,v in o['status'].items(): a['status'][k]=a['status'].get(k,0)+v
steps=sorted({k[0] for k in agg})
for s in steps:
    print(f"--- {s} users (worst 30 s window)")
    for (st,op),a in sorted(agg.items()):
        if st!=s: continue
        bad={k:v for k,v in a['status'].items() if not(k.isdigit() and 200<=int(k)<400)}
        print(f"  {op:18} n {a['n']:6} p50 {a['p50']:6} p95 {a['p95']:6} p99 {a['p99']:6} max {a['max']:6} worstTenantP95 {a['worst']:6} {bad if bad else ''}")
