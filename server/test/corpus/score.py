# The live workflow corpus as the isolated platform published it: every source ID to its outcome, fields scored against the Private QA answer key, and where the time went, from the database's own timestamps.
#   python3 -I test/corpus/score.py data/corpus-live/run-<commit>.json
# Wrong, missing and extra are counted apart. The answer key is fictional and qualitative; it gives three roles per CV, so a fourth role read is counted as extra only when it is not one of them.
import csv, json, re, statistics, subprocess, sys, collections

run = json.load(open(sys.argv[1])); inv = {i['id']: i for i in json.load(open('data/corpus-live/inventory.json'))['items'] if i.get('id')}
key = {r['CV ID']: r for r in csv.DictReader(open([p for p in json.load(open('data/corpus-live/inventory.json'))['answerKey'] if p.endswith('CV ground truth.csv')][0]))}
words = lambda s: set(re.sub(r'[^a-z0-9 ]', ' ', str(s or '').lower()).split()) - {'the', 'of', 'and', 'a', 'pty', 'ltd'}
near = lambda a, b, t=0.6: bool(words(a) and words(b)) and len(words(a) & words(b)) / min(len(words(a)), len(words(b))) >= t
yr = lambda s: (re.search(r'(19|20)\d\d', str(s or '')) or [''])[0]
mon = lambda s: (re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', str(s or '').lower()) or [''])[0]
present = lambda s: bool(re.search(r'present|current|now|date', str(s or ''), re.I))
pct = lambda a, b: f'{100 * a / b:5.1f}%' if b else '    -'
q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(len(xs) * p))] if xs else None

# 1. Outcomes by source ID
outcomes = collections.Counter(); per = {}
for o in run['outcomes']:
    if o.get('as') == 'separate page photos':
        print(f"Page-photo sequence {o['id']}: {len(o['docs'])} pages sent one by one -> " + ', '.join(f"{d.get('status')}{'/' + str(d.get('code')) if d.get('code') else ''}" for d in o['docs']) + f"; records made: {len({d.get('recordId') for d in o['docs'] if d.get('recordId')})}")
        continue
    d = (o.get('docs') or [{}])[0]
    state = 'refused ' + str(o['refused'].get('code')) if o.get('refused') else d.get('status', 'waiting') + (' ' + str(d.get('code')) if d.get('code') else '')
    rec = d.get('record') or {}
    if d.get('status') == 'published' and rec.get('reviewState') == 'needs_review': state = 'published, needs review'
    outcomes[(o['kind'], state)] += 1; per[o['id']] = (o, d, rec)
print('\nOutcomes by source ID:', len(per), 'of', len(inv))
for (k, s), n in sorted(outcomes.items()): print(f'  {k:3} {s:40} {n}')
missing_ids = sorted(set(inv) - set(per))
if missing_ids: print('  not attempted:', ' '.join(missing_ids))

# 2. CV fields against the key, by format
T = collections.defaultdict(collections.Counter)
for cid, k in key.items():
    if cid not in per: continue
    o, d, rec = per[cid]; f = o['format']; t = T[f]; t['docs'] += 1
    if d.get('status') != 'published': t['unpublished'] += 1; continue
    t['name ok' if (rec.get('name') or '').lower() == k['Candidate'].lower() else ('name missing' if not rec.get('name') else 'name wrong')] += 1
    t['location ok' if near(rec.get('location'), k['Location'], 0.5) else ('location missing' if not rec.get('location') else 'location wrong')] += 1
    W = rec.get('workHistory') or []; used = set()
    for slot, (ti, em, st, en) in enumerate([(k['Current role'], k['Current employer'], k['Current start'], 'present'), (k['Prior role'], k['Prior employer'], k['Prior start'], k['Prior end']), (k['Earlier role'], k['Earlier employer'], k['Earlier start'], k['Earlier end'])]):
        t['roles key'] += 1
        hit = next((n for n, w in enumerate(W) if n not in used and yr(w.get('startDate')) == yr(st) and (near(w.get('position'), ti) or near(w.get('company'), em))), None)
        if hit is None: t['role missing'] += 1; continue
        used.add(hit); w = W[hit]
        ok_t, ok_e = near(w.get('position'), ti), near(w.get('company'), em)
        ok_s = yr(w.get('startDate')) == yr(st) and (not mon(st) or mon(w.get('startDate')) == mon(st))
        ok_n = (en == 'present' and present(w.get('endDate'))) or (yr(w.get('endDate')) == yr(en) and (not mon(en) or mon(w.get('endDate')) == mon(en)))
        t['title wrong'] += not ok_t; t['employer wrong'] += not ok_e; t['start wrong'] += not ok_s; t['end wrong'] += not ok_n
        if ok_t and ok_e and ok_s and ok_n: t['role fully right'] += 1
        if w.get('status') and w['status'] != 'supported': t['right role marked uncertain' if ok_t and ok_e and ok_s else 'wrong role marked uncertain'] += 1
    extra = [w for n, w in enumerate(W) if n not in used]; t['roles extra'] += len(extra); t['extra marked uncertain'] += sum(1 for w in extra if w.get('status') and w['status'] != 'supported')
    ks = [s.strip() for s in k['Skills'].split(';') if s.strip()]; rs = [str(s) for s in rec.get('skills') or []]
    t['skills key'] += len(ks); t['skills found'] += sum(any(near(r, s) for r in rs) for s in ks)
    t['employment ' + str(((rec.get('reading') or {}).get('employment') or {}).get('state'))] += 1
    t['needs review'] += rec.get('reviewState') == 'needs_review'
print('\nCV fields against the answer key, by format')
for f, t in sorted(T.items()):
    pub = t['docs'] - t['unpublished']
    print(f"  {f:16} docs {t['docs']:3} published {pub:3} | name {pct(t['name ok'], pub)} wrong {t['name wrong']} miss {t['name missing']} | location {pct(t['location ok'], pub)} wrong {t['location wrong']} | roles fully right {pct(t['role fully right'], t['roles key'])} missing {t['role missing']} extra {t['roles extra']} (of which uncertain {t['extra marked uncertain']}) | title wrong {t['title wrong']} employer wrong {t['employer wrong']} start wrong {t['start wrong']} end wrong {t['end wrong']} | skills {pct(t['skills found'], t['skills key'])} | review {t['needs review']} | " + ' '.join(f'{k} {v}' for k, v in t.items() if k.startswith('employment')))

# 3. Where the time went: the database's own timestamps for each document
ids = [d['doc'] for o in run['outcomes'] for d in (o.get('docs') or []) if d.get('doc')]
sql = f"""select d.id, d.kind, extract(epoch from d.created_at), (select extract(epoch from min(q.locked_at)) from queue q where q.payload->>'documentId' = d.id::text and q.type = 'process-document'), (select extract(epoch from min(q.created_at)) from queue q where q.payload->>'documentId' = d.id::text and q.type = 'model-read'), (select extract(epoch from min(q.locked_at)) from queue q where q.payload->>'documentId' = d.id::text and q.type = 'model-read'), (select extract(epoch from min(a.created_at)) from audit_events a where a.entity_id = d.record_id and a.action in ('candidate.published', 'job.published')), coalesce((c.data->'reading'->'trace'->>'ms')::float, 0), coalesce((c.data->'audit'->>'ms')::float, (j.data->'audit'->>'ms')::float, 0), coalesce((c.data->'reading'->'trace'->>'calls')::int, 0) from documents d left join candidates c on c.id = d.record_id left join jobs j on j.id = d.record_id where d.id in ({','.join("'" + i + "'" for i in ids)})"""
rows = subprocess.run(['docker', 'exec', 'supabase_db_rolematch', 'psql', '-U', 'postgres', '-At', '-F', '\t', '-c', sql], capture_output=True, text=True).stdout.strip().split('\n') if ids else []
fmt_of = {d['doc']: (o['kind'], o['format'], o.get('pages')) for o in run['outcomes'] for d in (o.get('docs') or []) if d.get('doc')}
S = collections.defaultdict(lambda: collections.defaultdict(list))
for r in filter(None, rows):
    i, kind, up, readStart, readEnd, modelStart, pub, modelMs, auditMs, calls = (r.split('\t') + [''] * 10)[:10]
    f = fmt_of.get(i, (kind, '?', None))[1]; fl = lambda x: float(x) if x else None
    up, readStart, readEnd, modelStart, pub = map(fl, (up, readStart, readEnd, modelStart, pub))
    s = S[(kind, f)]
    if up and readStart: s['queue wait'].append(readStart - up)
    if readStart and readEnd: s['reading and OCR'].append(readEnd - readStart)
    if readEnd and modelStart: s['waiting for the model'].append(modelStart - readEnd)
    if modelMs and float(modelMs): s['model reading'].append(float(modelMs) / 1000)
    if auditMs and float(auditMs): s['model audit'].append(float(auditMs) / 1000)
    if up and pub: s['upload to usable panel'].append(pub - up)
    if calls and int(calls): s['model calls'].append(int(calls))
print('\nSeconds, median and p95, by kind and format (n)')
for (kind, f), s in sorted(S.items()):
    print(f'  {kind:3} {f:16} ' + ' | '.join(f"{k} {statistics.median(v):.0f}/{q(v, .95):.0f} (n {len(v)})" for k, v in s.items()))
done = [p for o in run['outcomes'] for p in [(o.get('docs') or [{}])[0].get('done')] if p]
if done: print(f"\nThroughput: {len(done)} documents published or refused in {(max(done) - run['started']) / 3600:.1f} h, {len(done) / max(1e-9, (max(done) - run['started']) / 3600):.1f} an hour")
pr = [p['ms'] for p in run['probes']]
if pr: print(f"Ordinary reads while the corpus was processing: median {statistics.median(pr):.0f} ms, p95 {q(pr, .95)} ms, slowest {max(pr)} ms (n {len(pr)})")
