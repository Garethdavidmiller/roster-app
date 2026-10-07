"""Turn parsed columns into trains: link 'e'/'f' continuations, keep Marylebone departures (out)
and arrivals (ret). Usage: assemble.py <met-cols.json> <main-cols.json> <out.json>"""
import sys, json, re, collections
TIME = re.compile(r'^(\d{2})(\d{2})([a-z]?)$')
def timed(c): return TIME.match(c['text'])
def mins(t): m = TIME.match(t); return int(m.group(1)) * 60 + int(m.group(2))
def build(cols, src):
    out = []
    used = set()
    for i, c in enumerate(cols):
        cells = c['cells']
        if not cells: continue
        if cells[0]['text'] == 'f': continue                      # a continuation; reached from its 'e' column
        stops = [dict(crs=x['crs'], name=x['name'], ad=x['ad'], t=x['text']) for x in cells if timed(x)]
        if any(x['text'] == 'e' for x in cells):
            last = stops[-1]
            # the continuation: a LATER column of the same direction and day whose first cell is 'f'
            # and which carries the identical time at the same station
            for j in range(i + 1, len(cols)):
                d = cols[j]
                if d['dir'] != c['dir'] or d['day'] != c['day'] or not d['cells'] or d['cells'][0]['text'] != 'f': continue
                if any(x['crs'] == last['crs'] and x['text'] == last['t'] for x in d['cells']):
                    k = next(n for n, x in enumerate(d['cells']) if x['crs'] == last['crs'] and x['text'] == last['t'])
                    stops += [dict(crs=x['crs'], name=x['name'], ad=x['ad'], t=x['text']) for x in d['cells'][k + 1:] if timed(x)]
                    used.add(j); c = dict(c, notes=c['notes'] + d['notes'])
                    break
            else:
                print('WARN unlinked continuation', src, c['page'], c['col'], [s['crs'] + s['t'] for s in stops][:4])
        if not stops: continue
        out.append(dict(src=src, page=c['page'], col=c['col'], dir=c['dir'], day=c['day'], op=c['op'], notes=c['notes'], stops=stops))
    return out
def timed_stops(stops, keep):
    """[[crs, 'HHMM'], …] with one entry per stop. A stop printed twice (arrival and departure) keeps
    its ARRIVAL leaving London ('first' — when a passenger gets there) and its DEPARTURE coming back
    ('last' — when a passenger must be on it)."""
    out = []
    for x in stops:
        if out and out[-1][0] == x['crs']:
            if keep == 'last': out[-1][1] = x['t'][:4]
            continue
        out.append([x['crs'], x['t'][:4]])
    return out
T = build(json.load(open(sys.argv[1])), 'met') + build(json.load(open(sys.argv[2])), 'main')
res = []
for t in T:
    if t['op'] != 'CH': continue                                   # bus replacements are not trains
    s = t['stops']
    names = {x['crs']: x['name'] for x in s}
    if t['dir'] == 'out':
        if s[0]['crs'] != 'MYB': continue
        res.append(dict(kind='dep', day=t['day'], t=s[0]['t'][:4], dest=s[-1]['crs'], destName=s[-1]['name'], via_h=('H' in t['notes']) or t['src']=='main',
                        calls=[x['crs'] for x in s[1:]], stops=timed_stops(s[1:], 'first'), names=names, notes=t['notes'], src=t['src']))
    else:
        if s[-1]['crs'] != 'MYB': continue
        res.append(dict(kind='arr', day=t['day'], t=s[-1]['t'][:4], org=s[0]['crs'], orgName=s[0]['name'],
                        calls=[x['crs'] for x in s[:-1]], stops=timed_stops(s[:-1], 'last'), names=names, notes=t['notes'], src=t['src']))
# the same train can appear in both PDFs (Aylesbury via High Wycombe): keep one, prefer the main-line copy
def dedupe_calls(calls):
    out = []
    for c in calls:
        if not out or out[-1] != c: out.append(c)
    return out
for r in res: r['calls'] = dedupe_calls(r['calls'])
DAYNOTE = {'MFO', 'MFX', 'WO'}
seen = {}
for r in res:
    key = (r['kind'], r['day'], r['t'], r.get('dest') or r.get('org'))
    if key in seen:
        a = seen[key]
        notes = sorted(set(a['notes']) | set(r['notes']))
        if 'MFO' in notes and 'MFX' in notes:      # the two weekday variants together run every weekday
            notes = [n for n in notes if n not in ('MFO', 'MFX')]
        keep = r if r['src'] == 'main' else a
        seen[key] = dict(keep, notes=notes, via_h=a.get('via_h') or r.get('via_h'))
        continue
    seen[key] = r
R = sorted(seen.values(), key=lambda r: (r['kind'], r['day'], (mins(r['t']) - 180) % 1440))
json.dump(R, open(sys.argv[3], 'w'), indent=1)
print('dupes removed:', len(res) - len(R))
print(collections.Counter((r['kind'], r['day']) for r in R))
for day in ('SX', 'SO', 'SU'):
    print(day, 'departures by destination:', dict(collections.Counter(r['dest'] for r in R if r['kind'] == 'dep' and r['day'] == day).most_common()))
