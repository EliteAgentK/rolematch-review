#!/usr/bin/env python3
# Merges the windows of a shared crowd: requests are summed across shards; percentiles are the worst shard's, so nothing is flattered.
import json,sys,glob,collections
files=glob.glob(sys.argv[1]+'*.jsonl')
win=collections.defaultdict(lambda:{'users':0,'req':0,'ok':0,'busy':0,'lim':0,'fail':0,'ops':{},'step':None})
for f in files:
    for l in open(f):
        r=json.loads(l)
        if r['label']!='window': continue
        k=r['at'][11:18]+'0'
        w=win[k]; w['users']+=r['active']; w['step']=r.get('step')
        for op,o in r['ops'].items():
            w['req']+=o['n']
            for s,v in o['status'].items():
                if s=='503': w['busy']+=v
                elif s=='429': w['lim']+=v
                elif s.isdigit() and int(s)<400: w['ok']+=v
                else: w['fail']+=v
            a=w['ops'].setdefault(op,{'n':0,'p50':0,'p95':0,'p99':0}); a['n']+=o['n']
            for p in ('p50','p95','p99'): a[p]=max(a[p],o[p])
for k in sorted(win):
    w=win[k]; c=w['ops'].get('poll.capacity',{}); b=w['ops'].get('board.candidates',{}); m=w['ops'].get('match',{})
    print(k,'users',w['users'],'req/s',round(w['req']/30),'ok/s',round(w['ok']/30),'busy/s',round(w['busy']/30),'429/s',round(w['lim']/30),'fail/s',round(w['fail']/30),'cap p50/95',c.get('p50'),c.get('p95'),'board p95',b.get('p95'),'match p95',m.get('p95'))
