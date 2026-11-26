"""Turn parsed columns into trains: link 'e'/'f' continuations, keep Marylebone departures (out)
and arrivals (ret), plus each book's station order. Usage: assemble.py <met-cols.json> <main-cols.json> <out.json>"""
import sys, json, re, collections
TIME = re.compile(r'^(\d{2})(\d{2})([a-z]?)$')
def timed(c): return TIME.match(c['text'])
def mins(t): m = TIME.match(t); return int(m.group(1)) * 60 + int(m.group(2))
def checked(x, src, col):
    """One printed time, as a stop — refused by name unless it is a time with a letter from the key (external
    review of v26.79): four digits were all the pattern asked, so '0861' was taken as a departure, and the
    Marylebone end, sliced to four characters later, published '0800z' as an ordinary 0800."""
    m = TIME.match(x['text'])
    if int(m.group(1)) > 23 or int(m.group(2)) > 59: stop(f"{x['text']!r} at {x['crs']} is not a time", src, col)
    if m.group(3) not in LETTERS: stop(f"unknown time letter {x['text']!r} at {x['crs']}: read the book's key", src, col)
    return dict(crs=x['crs'], name=x['name'], ad=x['ad'], t=x['text'])
def build(cols, src):
    out = []
    used = set()
    for i, c in enumerate(cols):
        cells = c['cells']
        if not cells: continue
        if cells[0]['text'] == 'f': continue                      # a continuation; reached from its 'e' column
        if i in used: continue                                    # already joined to the column it continues
        fac = list(c.get('fac', []))
        stops = [checked(x, src, c) for x in cells if timed(x)]
        if any(x['text'] == 'e' for x in cells):
            if not stops: stop(f'a train continued on another page with no time before it', src, c)
            last = stops[-1]
            # the continuation: a LATER column of the same direction and day whose first cell is 'f'
            # and which carries the identical time at the same station. EXACTLY ONE, AND NOT ALREADY
            # JOINED (external review of v26.67): the first match was taken, so two trains could both be
            # given one continuation's destination, and a train with none was published shortened after a
            # WARN nobody had to read. Either is a question for the book, so the build stops and names it.
            cands = [j for j in range(i + 1, len(cols))
                     if cols[j]['dir'] == c['dir'] and cols[j]['day'] == c['day'] and cols[j]['cells']
                     and cols[j]['cells'][0]['text'] == 'f'
                     and any(x['crs'] == last['crs'] and x['text'] == last['t'] for x in cols[j]['cells'])]
            if not cands: stop(f"no continuation carries its {last['crs']} {last['t']}", src, c)
            if len(cands) > 1: stop(f"{len(cands)} continuations carry its {last['crs']} {last['t']} (page/column " + ', '.join(f"{cols[j]['page']}/{cols[j]['col']}" for j in cands) + ')', src, c)
            j = cands[0]
            if j in used: stop(f"its continuation (page/column {cols[j]['page']}/{cols[j]['col']}) is already joined to another train", src, c)
            d = cols[j]
            # A CONTINUATION THAT IS CONTINUED AGAIN is a train over three pages, which this joins only one break of
            # (review of v26.69): its third column was then reported as reached by nothing, naming the wrong column.
            if any(x['text'] == 'e' for x in d['cells']):
                stop(f"its continuation (page/column {d['page']}/{d['col']}) is continued again — a train over three pages, which assemble.py does not join", src, c)
            k = next(n for n, x in enumerate(d['cells']) if x['crs'] == last['crs'] and x['text'] == last['t'])
            onward = [checked(x, src, d) for x in d['cells'][k + 1:] if timed(x)]
            # …AND IT MUST TAKE THE TRAIN SOMEWHERE (external review of v26.69): a continuation printing only the
            # joining station published a train the book continues as terminating there. A second time at that
            # same station (its departure under its arrival) goes nowhere either.
            if not any(x['crs'] != last['crs'] for x in onward):
                stop(f"its continuation (page/column {d['page']}/{d['col']}) adds no station after {last['crs']} {last['t']}", src, c)
            stops += onward
            used.add(j); c = dict(c, notes=c['notes'] + d['notes']); fac += d.get('fac', [])
        if not stops: continue
        out.append(dict(src=src, page=c['page'], col=c['col'], dir=c['dir'], day=c['day'], op=c['op'], fac=fac, notes=c['notes'], stops=stops))
    # …and a continuation no train reached is a train's END left behind: its stops would be lost.
    for j, d in enumerate(cols):
        if d['cells'] and d['cells'][0]['text'] == 'f' and j not in used:
            stop('a continuation no train on an earlier page reaches', src, d)
    return out
def stop(why, src, col):
    """End the build on a question only the printed book can answer, naming where to look."""
    sys.exit(f"assemble.py: {why} — {src} book, page {col['page']}, column {col['col']}, {col['dir']} {col['day']}. "
             "Check the book, then teach assemble.py.")
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
    return [x for x in stops if letter(x) != BARRED[kind]]
BARRED = {'dep': 'u', 'arr': 's'}
def barred_at(stops, kind):
    """The stations this copy prints with the letter that bars a passenger this way — kept, so a union with the
    other book's copy can see that one book says a passenger cannot use a call the other prints plain."""
    return sorted({x['crs'] for x in stops if letter(x) == BARRED[kind]})
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
    then any station another block adds, placed after the nearest station that precedes it there —
    or, with none before it there, first, as build.py's _merged places one (they disagreed: this put
    it last). A station printed twice (arrival and departure) appears once."""
    order = []
    for rows in sorted((c.get('rows', []) for c in cols if c['dir'] == 'out'), key=len, reverse=True):
        for i, crs in enumerate(rows):
            if crs in order: continue
            before = next((c for c in reversed(rows[:i]) if c in order), None)
            order.insert(order.index(before) + 1 if before else 0, crs)
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
        res.append(dict(kind='dep', barred=barred_at(s[1:], 'dep'), day=t['day'], t=s[0]['t'][:4], dest=s[-1]['crs'], destName=s[-1]['name'], via_h=('H' in t['notes']) or t['src']=='main',
                        calls=[x['crs'] for x in on], stops=timed_stops(on, 'first'), names=names, notes=t['notes'], src=t['src'],
                        at=f"{t['src']} book, page {t['page']}, column {t['col']}"))
    else:
        if s[-1]['crs'] != 'MYB': continue
        on = usable(s[:-1], 'arr')
        res.append(dict(kind='arr', barred=barred_at(s[:-1], 'arr'), day=t['day'], t=s[-1]['t'][:4], org=s[0]['crs'], orgName=s[0]['name'],
                        calls=[x['crs'] for x in on], stops=timed_stops(on, 'last'), names=names, notes=t['notes'], src=t['src'],
                        at=f"{t['src']} book, page {t['page']}, column {t['col']}"))
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
#    ONLY WHEN THE TWO COPIES AGREE (external review of v26.79): the key holds no stops, and it matched within
#    one book as well as across the two, so a second column at the same time to the same end — a different
#    train — was dropped and the build ended as though nothing had happened. One book prints one train once,
#    so two of its columns must be identical to be one train; across the books, each prints only its own
#    stations, so the times must agree at every station both print. Anything else stops, naming both columns.
def disagree(a, r):
    if a['src'] == r['src']: return a['stops'] != r['stops'] or a['calls'] != r['calls']
    at_a = dict((c, t) for c, t in a['stops'])
    return any(c in at_a and at_a[c] != t for c, t in r['stops'])
# 1a. Across the books, the main-line copy alone could drop a call (external review of v26.87): each book prints
#     only its own stations, so a station the Met book prints and the main-line book does not was lost, and the
#     build ended cleanly. The two agree at every station both print (above), so the train calls at every station
#     either prints: the row takes the UNION, in time order. A union whose order is not each copy's own printed
#     order, or two stations at one minute (an order the times cannot settle), stops the build, naming both.
# 1b. Two ROUTES are not two printings (external review of v26.92). London to Aylesbury runs either by the Met line
#     (Harrow, Amersham, Great Missenden) or by the main line (Gerrards Cross, High Wycombe, Princes Risborough), and the
#     two meet only at the ends. The union above trusts times alone, so an 08:00 via Amersham in one book and an 08:00 via
#     High Wycombe in the other, both at Aylesbury at 09:00, became one train calling at High Wycombe and then Amersham.
#     A copy calling on one route only, beside a copy calling on the other only, stops the build, naming both. One book
#     merely leaving out a call is not that, and still unites.
VIA_AMERSHAM = {'HOH', 'RIC', 'CLW', 'CFO', 'AMR', 'GMN', 'WND', 'SKM'}
VIA_WYCOMBE  = {'WCX', 'SUD', 'SDH', 'NLT', 'SRU', 'WRU', 'DNM', 'DGC', 'GER', 'SRG', 'BCF', 'HWY', 'SDR', 'PRR', 'MRS', 'LTK'}
def routes(copy):
    calls = set(dict(copy['stops'])) | set(copy['calls']) | set(copy['barred'])
    return {name for name, line in (('Amersham', VIA_AMERSHAM), ('High Wycombe', VIA_WYCOMBE)) if calls & line}
def union_of(keep, other):
    both = routes(keep) | routes(other)
    if len(both) > 1:
        sys.exit(f"assemble.py: the two books' copies of the {keep['t']} {keep['kind']} {keep['day']} go by different routes "
                 f"(via Amersham and via High Wycombe) — {other['at']}, and {keep['at']}. Two trains, not one: check the book, "
                 f"then teach assemble.py.")
    base = mins(keep['t'])
    def rel(t): return (mins(t) - base) % 1440
    times = dict(keep['stops'])
    for c, t in other['stops']: times.setdefault(c, t)
    order = sorted(times, key=lambda c: rel(times[c]))
    def kept_order(copy): return [c for c in order if c in dict(copy['stops'])] == [c for c, _ in copy['stops']]
    clash = len({rel(t) for t in times.values()}) < len(times)
    # A station one book bars a passenger from (pick-up or set-down only) is not a call the other book's plain
    # time can add: the two copies disagree about whether a passenger may use it, and only the book can say.
    barred = set(dict(other['stops'])) & set(keep['barred']) or set(dict(keep['stops'])) & set(other['barred'])
    if clash or barred or not kept_order(keep) or not kept_order(other) or set(keep['calls']) != set(dict(keep['stops'])) \
            or set(other['calls']) != set(dict(other['stops'])):
        sys.exit(f"assemble.py: the two books' copies of the {keep['t']} {keep['kind']} {keep['day']} cannot be put in one order "
                 f"of calls — {other['at']}, and {keep['at']}. Check the book, then teach assemble.py.")
    return dict(stops=[[c, times[c]] for c in order], calls=order, names={**other['names'], **keep['names']},
                barred=sorted(set(keep['barred']) | set(other['barred'])))
seen = {}
for r in res:
    key = (r['kind'], r['day'], r['t'], r.get('dest') or r.get('org'), variant(r))
    if key in seen:
        a = seen[key]
        # A copy is judged against its OWN book's copy as printed, never against a union already made: after a
        # union the row holds the other book's calls too, so an identical second printing would read as different.
        raw = a['raw']
        same = raw.get(r['src'])
        if disagree(same or a, r):
            sys.exit(f"assemble.py: two trains at {r['t']} to the same end stop differently — {(same or a)['at']}, and {r['at']}, "
                     f"{r['kind']} {r['day']}. Check the book, then teach assemble.py.")
        notes, via_h = sorted(set(a['notes']) | set(r['notes'])), a.get('via_h') or r.get('via_h')
        if same:
            seen[key] = dict(a, notes=notes, via_h=via_h)
            continue
        keep, other = (r, a) if r['src'] == 'main' else (a, r)
        seen[key] = dict(keep, notes=notes, via_h=via_h, raw={**raw, r['src']: r})
        seen[key].update(union_of(keep, other))
        continue
    r['raw'] = {r['src']: r}
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
R = [{k: v for k, v in r.items() if k not in ('at', 'raw', 'barred')} for r in sorted(seen.values(), key=lambda r: (r['kind'], r['day'], (mins(r['t']) - 180) % 1440))]
json.dump({'trains': R, 'order': {'met': row_order(MET), 'main': row_order(MAIN)}}, open(sys.argv[3], 'w'), indent=1)
print('dupes removed:', len(res) - len(R))
print(collections.Counter((r['kind'], r['day']) for r in R))
for day in ('SX', 'SO', 'SU'):
    print(day, 'departures by destination:', dict(collections.Counter(r['dest'] for r in R if r['kind'] == 'dep' and r['day'] == day).most_common()))
