"""Write trains-data.js — the timetable the Trains page compares — from the two parsed sources.

Usage (from the repository root):
    python3 -I docs/timetable-dec26/tooling/build.py <now.json> <dec.json> trains-data.js

<now.json> is assemble.py's output (the CURRENT public timetable, from Chiltern's printed PDFs).
<dec.json> is assemble.py's output from Chiltern's DECEMBER 2026 public timetable PDFs (v24.80) —
    or, as a fallback, simplifier.py's output (the roster office's December 2026 Marylebone
    simplifier spreadsheets, which carry no stops and whose weekday plan was a draft).
README.md beside this file gives the whole pipeline.

── BOTH SIDES FROM THE PUBLIC BOOKS (v24.80) ───────────────────────────────────────────────────

Until Chiltern published its December books, December came from the simplifier: a WORKING document,
compared against a PUBLIC one. That was not like-for-like — measured when the books arrived, every
Amersham-line arrival into Marylebone was 3 minutes later in the public book than in the simplifier,
and the published weekday evening peak was reshuffled from the draft. Read from the books, both sides
are the timetable a passenger sees, and every December train carries its stops.

── WHAT IS PUBLISHED, AND WHAT IS DELIBERATELY LEFT BEHIND ─────────────────────────────────────

The output is served from both origins to anyone, like roster-member-data.js. So it carries only
what Chiltern publishes to passengers: a time at Marylebone, the other end of the journey, for
Aylesbury the route, every stop, and the order the books list the stations in. The simplifier also holds train lengths, platforms, unit diagrams, joins and
empty-stock moves. None of that is a passenger fact, and none of it leaves this script.

── THE AYLESBURY ROUTE ─────────────────────────────────────────────────────────────────────────

Aylesbury is the one destination reached two ways, and the two take very different times, so a
train that changes route has changed even if its departure time has not. December's route is read
from the headcode, which encodes it: leaving London 2A runs via High Wycombe and 2B/1B via
Amersham; arriving, 2H/1H came via High Wycombe and 2C/1C via Amersham — but only when December comes
from the simplifier. Read from the PDFs (both timetables since v24.80), a train in the main-line book,
or carrying the "H" note, is via High Wycombe.
"""
import sys, json, collections

now_path, dec_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
_now = json.load(open(now_path))
NOW = _now['trains'] if isinstance(_now, dict) else _now          # a pre-v24.76 now.json is a bare list
ORDER = _now.get('order', {}) if isinstance(_now, dict) else {}
DEC = json.load(open(dec_path))
DEC_BOOKS = isinstance(DEC, dict) and 'trains' in DEC              # the public books, not the simplifier

# Names for every stop, read from the current timetable's own rows (`names` from assemble.py); these
# fixed ones win, so a capitalisation the printed book uses ("Stratford-Upon-Avon") is not copied.
STATIONS = {
    'AVP': 'Aylesbury Vale Parkway', 'AYS': 'Aylesbury', 'BAN': 'Banbury', 'BIT': 'Bicester Village',
    'BMO': 'Birmingham Moor Street', 'BSW': 'Birmingham Snow Hill', 'GER': 'Gerrards Cross',
    'HWY': 'High Wycombe', 'KGS': 'Kings Sutton', 'LMS': 'Leamington Spa', 'OXF': 'Oxford',
    'PRR': 'Princes Risborough', 'SAV': 'Stratford-upon-Avon', 'SBJ': 'Stourbridge Junction',
    'WRU': 'West Ruislip',
}
for r in [*NOW, *(DEC['trains'] if DEC_BOOKS else [])]:
    for crs, name in r.get('names', {}).items():
        STATIONS.setdefault(crs, name.replace('-On-The-', '-on-the-').replace('-Upon-', '-upon-'))
# The stations in the order the two books print them. Main-line book first (Wembley Stadium …
# Stourbridge Junction, the Aylesbury-via-Wycombe branch after Princes Risborough), then the Amersham
# book (Harrow-on-the-Hill … Aylesbury Vale Parkway). A station in both — Aylesbury — takes its
# Amersham-book place, so every column of the basic hour reads DOWNWARDS in travel order: the
# via-Wycombe train's dots run Princes Risborough, Monks Risborough, Little Kimble, then Aylesbury
# further down, never back up the page. Only named stations: a row no kept train calls at is dropped.
def _merged(book):
    """One book's rows, today's order first; a row only December's book prints goes after the row
    that precedes it there."""
    order = [c for c in ORDER.get(book, []) if c != 'MYB']
    later = [c for c in (DEC.get('order', {}).get(book, []) if DEC_BOOKS else []) if c != 'MYB']
    for i, c in enumerate(later):
        if c in order: continue
        before = next((p for p in reversed(later[:i]) if p in order), None)
        order.insert(order.index(before) + 1 if before else 0, c)
    return order
_main = _merged('main')
_met = _merged('met')
STATION_ORDER = [c for c in [*[c for c in _main if c not in _met], *_met] if c in STATIONS]
DAY_NOTES = ('MFO', 'MFX', 'WO')
ROUTED = {'AYS'}                       # the stations whose route is part of the train's identity


def hhmm(minutes):
    return f'{minutes // 60 % 24:02d}:{minutes % 60:02d}'


def service_order(t):
    """Minutes from 03:00, so a 00:15 departure sorts after 23:45 — the railway's day, not midnight's."""
    h, m = int(t[:2]), int(t[3:])
    return (h * 60 + m - 180) % 1440


def dec_via(hc, kind, crs):
    if crs not in ROUTED:
        return ''
    if kind == 'dep':
        return 'H' if hc.startswith('2A') else 'A'
    return 'H' if hc[1:2] == 'H' else 'A'


def book_rows(trains, day):
    """The rows for one day from a public book (assemble.py output) — today's, and December's since
    v24.80. Every stop but Marylebone, the far end included, as CRS+HHMM: the time a passenger
    reaches it leaving London, or must be on the train coming back."""
    rows = {'dep': set(), 'arr': set()}
    for r in trains:
        if r['day'] != day:
            continue
        crs = r['dest'] if r['kind'] == 'dep' else r['org']
        if crs not in STATIONS:
            unknown[crs] += 1
            continue
        via = ('H' if ('H' in r['notes'] or r['src'] == 'main') else 'A') if crs in ROUTED else ''
        days = next((n for n in r['notes'] if n in DAY_NOTES), '')
        stops = ' '.join(f'{c}{t}' for c, t in r.get('stops', []))
        rows[r['kind']].add((f"{r['t'][:2]}:{r['t'][2:]}", crs, via, days, stops))
    return rows


def simplifier_rows(day):
    """December from the roster office's simplifier — the fallback before the public books. It holds
    no stops: '' means NOT KNOWN, and the page says it is waiting rather than guess."""
    rows = {'dep': set(), 'arr': set()}
    for kind, key, tkey in (('dep', 'deps', 'dep'), ('arr', 'arrs', 'arr')):
        for r in DEC[day][key]:
            if r['ecs']:
                continue                               # empty stock — no passengers
            crs = (r['dest'] if kind == 'dep' else r['org']).split()[0]    # 'OXF RP' → 'OXF': a joined pair is one train
            if crs not in STATIONS:
                unknown[crs] += 1
                continue
            rows[kind].add((hhmm(r[tkey]), crs, dec_via(r['hc'], kind, crs), '', ''))
    return rows


out = {'now': {}, 'dec': {}}
unknown = collections.Counter()
by_service = lambda x: (service_order(x[0]), x[1])
for day in ('SX', 'SO', 'SU'):
    now = book_rows(NOW, day)
    dec = book_rows(DEC['trains'], day) if DEC_BOOKS else simplifier_rows(day)
    out['now'][day] = {k: sorted(v, key=by_service) for k, v in now.items()}
    out['dec'][day] = {k: sorted(v, key=by_service) for k, v in dec.items()}

if unknown:
    sys.exit(f'Unnamed stations — add them to STATIONS: {dict(unknown)}')


def table(rows):
    # Six rows a line: a timetable is long, and one row a line put this file over the repo's
    # module-size ratchet with nothing in it but data.
    cells = [f"['{t}', '{c}', '{v}', '{d}', '{p}']" for t, c, v, d, p in rows]
    lines = [', '.join(cells[i:i + 3]) for i in range(0, len(cells), 3)]
    return '[\n' + ''.join(f'                {ln},\n' for ln in lines) + '            ]'


js = ["""// @ts-check
/**
 * trains-data.js — GENERATED by docs/timetable-dec26/tooling/build.py. Do not edit by hand.
 *
 * The two timetables the Trains page compares, as Marylebone sees them: every passenger train
 * leaving (`dep`, keyed by where it is going) and arriving (`arr`, keyed by where it came from).
 * Each row is `[time, station code, route, days, stops]`:
 *   - route — Aylesbury only: 'H' via High Wycombe, 'A' via Amersham; '' everywhere else
 *   - days  — a weekday exception: 'MFO' Mondays and Fridays only, 'MFX' not Mondays and
 *             Fridays, 'WO' Wednesdays only; '' runs every day of its kind
 *   - stops — every stop after Marylebone (leaving) or before it (arriving), the far end included,
 *             as space-separated CRS+HHMM
 *             ('HWY1105 BCS1131'): the time a passenger reaches it leaving London, or must be on
 *             the train coming back. '' means NOT KNOWN — never "no stops". Since v24.80 both
 *             sides come from Chiltern's public books and every row carries its stops; a row
 *             built from the roster office's simplifier (the fallback) has none.
 *
 * PUBLIC, like every file in this repository: it holds only what Chiltern prints for passengers.
 * The simplifier's lengths, platforms, diagrams and empty-stock moves are dropped by the
 * generator and must never be added here. Provenance and the regeneration steps: the README
 * beside the generator.
 */

/** When the December 2026 timetable starts (a Sunday). */
export const CHANGE_DATE = '2026-12-13';

/**
 * The last day of the changes Chiltern says it will still make once the timetable has started:
 * "Further changes will be made to the timetable between 13 December 2026 and 10 January 2027,
 * including significant changes over the Christmas and New Year period" (Chiltern's timetable page,
 * checked 20 Oct 2026). The books themselves say nothing about Christmas, so until this day the page
 * says Christmas and New Year are not on it.
 */
export const FURTHER_CHANGES_UNTIL = '2027-01-10';

/** Where each side of the comparison came from. The page's ? panel says the same in words. */
export const SOURCES = Object.freeze({
    now: 'Chiltern Railways public timetables, valid until 12 December 2026',
    dec: '""" + ("Chiltern Railways public timetables, valid from 13 December 2026 until 15 May 2027" if DEC_BOOKS else "Chiltern Railways December 2026 Marylebone timetable plan — weekend plans final, the weekday plan still a draft") + """',
});

/** @type {Readonly<Record<string, string>>} */
export const STATIONS = Object.freeze({
"""]
js += [f"    {c}: '{n}',\n" for c, n in sorted(STATIONS.items())]
js += ["""});

/**
 * Every station in the order Chiltern's own books print them: the main-line book's rows, then the
 * Amersham book's, a station in both (Aylesbury) taking its Amersham-book place. The basic hour's
 * rows follow this, so each column reads downwards in travel order (trains-stations.js, orderStations).
 */
export const STATION_ORDER = Object.freeze([
"""]
js += [f"    {', '.join(repr(c) for c in STATION_ORDER[k:k + 12])},\n" for k in range(0, len(STATION_ORDER), 12)]
js += ["""]);

/** @typedef {[string, string, string, string, string]} TrainRow */
/** @typedef {{ dep: TrainRow[], arr: TrainRow[] }} DayTimetable */
/** @typedef {{ SX: DayTimetable, SO: DayTimetable, SU: DayTimetable }} Timetable */

/** @type {{ now: Timetable, dec: Timetable }} */
export const TIMETABLES = {
"""]
for side in ('now', 'dec'):
    js.append(f'    {side}: {{\n')
    for day in ('SX', 'SO', 'SU'):
        js.append(f'        {day}: {{\n')
        for kind in ('dep', 'arr'):
            js.append(f'            {kind}: {table(out[side][day][kind])},\n')
        js.append('        },\n')
    js.append('    },\n')
js.append('};\n')
open(out_path, 'w').write(''.join(js))

for side in ('now', 'dec'):
    print(side, {d: {k: len(v) for k, v in out[side][d].items()} for d in out[side]})
