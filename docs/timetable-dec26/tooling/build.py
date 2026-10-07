"""Write trains-data.js — the timetable the Trains page compares — from the two parsed sources.

Usage (from the repository root):
    python3 -I docs/timetable-dec26/tooling/build.py <now.json> <dec.json> trains-data.js

<now.json> is assemble.py's output (the CURRENT public timetable, from Chiltern's printed PDFs).
<dec.json> is simplifier.py's output (the DECEMBER 2026 Marylebone simplifier spreadsheets).
README.md beside this file gives the whole pipeline.

── WHAT IS PUBLISHED, AND WHAT IS DELIBERATELY LEFT BEHIND ─────────────────────────────────────

The output is served from both origins to anyone, like roster-member-data.js. So it carries only
what Chiltern publishes to passengers: a time at Marylebone, the other end of the journey, and for
Aylesbury the route. The simplifier also holds train lengths, platforms, unit diagrams, joins and
empty-stock moves. None of that is a passenger fact, and none of it leaves this script.

── THE AYLESBURY ROUTE ─────────────────────────────────────────────────────────────────────────

Aylesbury is the one destination reached two ways, and the two take very different times, so a
train that changes route has changed even if its departure time has not. December's route is read
from the headcode, which encodes it: leaving London 2A runs via High Wycombe and 2B/1B via
Amersham; arriving, 2H/1H came via High Wycombe and 2C/1C via Amersham. The current timetable's is
read from the PDFs: a train in the main-line book, or carrying the "H" note, is via High Wycombe.
"""
import sys, json, collections

now_path, dec_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
NOW = json.load(open(now_path))
DEC = json.load(open(dec_path))

# Names for every stop, read from the current timetable's own rows (`names` from assemble.py); these
# fixed ones win, so a capitalisation the printed book uses ("Stratford-Upon-Avon") is not copied.
STATIONS = {
    'AVP': 'Aylesbury Vale Parkway', 'AYS': 'Aylesbury', 'BAN': 'Banbury', 'BIT': 'Bicester Village',
    'BMO': 'Birmingham Moor Street', 'BSW': 'Birmingham Snow Hill', 'GER': 'Gerrards Cross',
    'HWY': 'High Wycombe', 'KGS': 'Kings Sutton', 'LMS': 'Leamington Spa', 'OXF': 'Oxford',
    'PRR': 'Princes Risborough', 'SAV': 'Stratford-upon-Avon', 'SBJ': 'Stourbridge Junction',
    'WRU': 'West Ruislip',
}
for r in NOW:
    for crs, name in r.get('names', {}).items():
        STATIONS.setdefault(crs, name.replace('-On-The-', '-on-the-').replace('-Upon-', '-upon-'))
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


out = {'now': {}, 'dec': {}}
unknown = collections.Counter()
for day in ('SX', 'SO', 'SU'):
    # ── Current: from the printed timetable ──
    rows = {'dep': [], 'arr': []}
    for r in NOW:
        if r['day'] != day:
            continue
        crs = r['dest'] if r['kind'] == 'dep' else r['org']
        if crs not in STATIONS:
            unknown[crs] += 1
            continue
        via = ('H' if ('H' in r['notes'] or r['src'] == 'main') else 'A') if crs in ROUTED else ''
        days = next((n for n in r['notes'] if n in DAY_NOTES), '')
        # Every stop but Marylebone, the far end included, as CRS+HHMM — the time a passenger reaches it
        # leaving London, or must be on the train coming back. '' means "not known", never "none".
        stops = ' '.join(f'{c}{t}' for c, t in r.get('stops', []))
        rows[r['kind']].append((f"{r['t'][:2]}:{r['t'][2:]}", crs, via, days, stops))
    out['now'][day] = rows

    # ── December: from the simplifier ──
    rows = {'dep': set(), 'arr': set()}
    for kind, key, tkey in (('dep', 'deps', 'dep'), ('arr', 'arrs', 'arr')):
        for r in DEC[day][key]:
            if r['ecs']:
                continue                               # empty stock — no passengers
            crs = (r['dest'] if kind == 'dep' else r['org']).split()[0]    # 'OXF RP' → 'OXF': a joined pair is one train
            if crs not in STATIONS:
                unknown[crs] += 1
                continue
            # The simplifier holds no stops: '' until Chiltern's December books are read (README).
            rows[kind].add((hhmm(r[tkey]), crs, dec_via(r['hc'], kind, crs), '', ''))
    out['dec'][day] = {k: sorted(v, key=lambda x: (service_order(x[0]), x[1])) for k, v in rows.items()}
    out['now'][day] = {k: sorted(set(v), key=lambda x: (service_order(x[0]), x[1])) for k, v in out['now'][day].items()}

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
 *   - days  — the current timetable's weekday exceptions: 'MFO' Mondays and Fridays only,
 *             'MFX' not Mondays and Fridays, 'WO' Wednesdays only; '' runs every day of its kind
 *   - stops — every stop after Marylebone (leaving) or before it (arriving), the far end included,
 *             as space-separated CRS+HHMM
 *             ('HWY1105 BCS1131'): the time a passenger reaches it leaving London, or must be on
 *             the train coming back. '' means NOT KNOWN — December's stops are not in the
 *             simplifier and arrive with Chiltern's published December books.
 *
 * PUBLIC, like every file in this repository: it holds only what Chiltern prints for passengers.
 * The simplifier's lengths, platforms, diagrams and empty-stock moves are dropped by the
 * generator and must never be added here. Provenance and the regeneration steps: the README
 * beside the generator.
 */

/** When the December 2026 timetable starts (a Sunday). */
export const CHANGE_DATE = '2026-12-13';

/** Where each side of the comparison came from — shown on the page, so a reader can judge it. */
export const SOURCES = Object.freeze({
    now: 'Chiltern Railways public timetables, valid until 11 December 2026',
    dec: 'Chiltern Railways December 2026 Marylebone timetable plan — weekend plans final, the weekday plan still a draft',
});

/** @type {Readonly<Record<string, string>>} */
export const STATIONS = Object.freeze({
"""]
js += [f"    {c}: '{n}',\n" for c, n in sorted(STATIONS.items())]
js += ["""});

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
