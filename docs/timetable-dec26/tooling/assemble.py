"""Turn parsed columns into trains: link 'e'/'f' continuations, keep Marylebone departures (out)
and arrivals (ret), plus each book's station order. Usage: assemble.py <met-cols.json> <main-cols.json> <out.json>"""
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
        fac = list(c.get('fac', []))
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
                    used.add(j); c = dict(c, notes=c['notes'] + d['notes']); fac += d.get('fac', [])
                    break
            else:
                print('WARN unlinked continuation', src, c['page'], c['col'], [s['crs'] + s['t'] for s in stops][:4])
        if not stops: continue
        out.append(dict(src=src, page=c['page'], col=c['col'], dir=c['dir'], day=c['day'], op=c['op'], fac=fac, notes=c['notes'], stops=stops))
    return out
# The letter after a printed time, from each book's key. 'a'/'d' only say which of a pair it is.
# 'u' and 's' are stops a passenger cannot use one way: a train leaving London that only PICKS UP at
# a station cannot set anyone from London down there, and one coming in that only SETS DOWN cannot
# take anyone to London — so the page must not count either as calling there (v24.83: until then the
# letter was sliced off and nine such stops read as ordinary ones). 'c' is "Arrives 8 minutes
# earlier" in both issues' keys. Any other letter stops the build: a new note must be read, not
# silently dropped.
LETTERS = {'', 'a', 'd', 'u', 's', 'c'}
C_EARLIER_MIN = 8
def letter(x):
    l = TIME.match(x['t']).group(3)
    if l not in LETTERS: sys.exit(f"unknown time letter {x['t']!r} at {x['crs']}: read the book's key, then teach assemble.py")
    return l
def usable(stops, kind):
    """The stops a passenger on this journey can use: leaving London, not a pick-up-only stop;
    coming in, not a set-down-only one."""
    barred = 'u' if kind == 'dep' else 's'
    return [x for x in stops if letter(x) != barred]
def hhmm(t, less=0):
    m = (int(t[:2]) * 60 + int(t[2:4]) - less) % 1440
    return f'{m // 60:02d}{m % 60:02d}'
def timed_stops(stops, keep):
    """[[crs, 'HHMM'], …] with one entry per stop. A stop printed twice (arrival and departure) keeps
    its ARRIVAL leaving London ('first' — when a passenger gets there) and its DEPARTURE coming back
    ('last' — when a passenger must be on it). A single time marked 'c' is a departure whose train
    arrives C_EARLIER_MIN sooner — the arrival is what 'first' wants."""
    out = []
    for x in stops:
        if out and out[-1][0] == x['crs']:
            if keep == 'last': out[-1][1] = x['t'][:4]
            continue
        out.append([x['crs'], hhmm(x['t'], C_EARLIER_MIN) if keep == 'first' and letter(x) == 'c' else x['t'][:4]])
    return out
def row_order(cols):
    """The book's station rows, outward direction, in printed order: the longest block's rows first,
    then any station another block adds, placed after the nearest station that precedes it there.
    A station printed twice (arrival and departure) appears once."""
    order = []
    for rows in sorted((c.get('rows', []) for c in cols if c['dir'] == 'out'), key=len, reverse=True):
        for i, crs in enumerate(rows):
            if crs in order: continue
            before = next((c for c in reversed(rows[:i]) if c in order), None)
            order.insert(order.index(before) + 1 if before else len(order), crs)
    return order
MET, MAIN = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
T = build(MET, 'met') + build(MAIN, 'main')
res = []
for t in T:
    # A bus is marked '&' under Facilities, and the books still print CH as its operator — so the
    # operator alone would publish a bus leg from Marylebone as a train.
    if t['op'] != 'CH' or '&' in t['fac']: continue
    s = t['stops']
    names = {x['crs']: x['name'] for x in s}
    if t['dir'] == 'out':
        if s[0]['crs'] != 'MYB': continue
        on = usable(s[1:], 'dep')
        res.append(dict(kind='dep', day=t['day'], t=s[0]['t'][:4], dest=s[-1]['crs'], destName=s[-1]['name'], via_h=('H' in t['notes']) or t['src']=='main',
                        calls=[x['crs'] for x in on], stops=timed_stops(on, 'first'), names=names, notes=t['notes'], src=t['src']))
    else:
        if s[-1]['crs'] != 'MYB': continue
        on = usable(s[:-1], 'arr')
        res.append(dict(kind='arr', day=t['day'], t=s[-1]['t'][:4], org=s[0]['crs'], orgName=s[0]['name'],
                        calls=[x['crs'] for x in on], stops=timed_stops(on, 'last'), names=names, notes=t['notes'], src=t['src']))
# the same train can appear in both PDFs (Aylesbury via High Wycombe): keep one, prefer the main-line copy
def dedupe_calls(calls):
    out = []
    for c in calls:
        if not out or out[-1] != c: out.append(c)
    return out
for r in res: r['calls'] = dedupe_calls(r['calls'])
DAYNOTE = {'MFO', 'MFX', 'WO'}
def variant(r): return next((n for n in r['notes'] if n in DAYNOTE), '')
# 1. The same train printed in both books (an Aylesbury train via High Wycombe): one row, the
#    main-line copy. Keyed by its day variant too, so two variants are never mistaken for it.
seen = {}
for r in res:
    key = (r['kind'], r['day'], r['t'], r.get('dest') or r.get('org'), variant(r))
    if key in seen:
        a = seen[key]
        keep = r if r['src'] == 'main' else a
        seen[key] = dict(keep, notes=sorted(set(a['notes']) | set(r['notes'])), via_h=a.get('via_h') or r.get('via_h'))
        continue
    seen[key] = r
# 2. A Mondays-and-Fridays and a not-Mondays-and-Fridays copy at one time and end together run every
#    weekday — ONE train, but only when they stop alike. Until v24.83 they were merged whatever their
#    stops, and one copy's were kept: the 17:45 to Oxford calls at High Wycombe on Mondays and Fridays
#    and at Beaconsfield on the other days, and the page sent it to Beaconsfield every weekday. Copies
#    that stop differently stay two rows, each with its days.
merged = {}
for (kind, day, t, end, v), r in list(seen.items()):
    if v != 'MFO': continue
    other = seen.get((kind, day, t, end, 'MFX'))
    if other is None or other['stops'] != r['stops']: continue
    merged[(kind, day, t, end, '')] = dict(r, notes=[n for n in sorted(set(r['notes']) | set(other['notes'])) if n not in ('MFO', 'MFX')],
                                           via_h=r.get('via_h') or other.get('via_h'))
    del seen[(kind, day, t, end, 'MFO')], seen[(kind, day, t, end, 'MFX')]
for k, r in merged.items():
    if k in seen: sys.exit(f'a merged weekday pair collides with an every-weekday train: {k}')
    seen[k] = r
for (kind, day, t, end, v) in seen:
    if v and (kind, day, t, end, '') in seen:
        print('WARN a day-variant and an every-day train at one time and end:', kind, day, t, end, v)
R = sorted(seen.values(), key=lambda r: (r['kind'], r['day'], (mins(r['t']) - 180) % 1440))
json.dump({'trains': R, 'order': {'met': row_order(MET), 'main': row_order(MAIN)}}, open(sys.argv[3], 'w'), indent=1)
print('dupes removed:', len(res) - len(R))
print(collections.Counter((r['kind'], r['day']) for r in R))
for day in ('SX', 'SO', 'SU'):
    print(day, 'departures by destination:', dict(collections.Counter(r['dest'] for r in R if r['kind'] == 'dep' and r['day'] == day).most_common()))
