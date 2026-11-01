# Shared definitions for the 26-line exact repair solver (model.py). Adapted from ../../../links-24/tooling/exact, whose
# model was checked against the sheets' own code (its check_model.py); this one is checked the same way, against the
# JS judge itself (judge.mjs, check_model.py). Paths are relative to this folder.
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLING = os.path.join(HERE, '..')
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
WD = ['mon', 'tue', 'wed', 'thu', 'fri']
LINES = 26
CONTRACT = 21 * 35 * 60          # 44,100 Monday-to-Saturday minutes over the 21 working lines (link.mjs)
MAX_DUTIES = 89                  # the 219-day ceiling: (Mon-Sat duties + 4 x 5 cover weeks) / 26 x 365 / 7 <= 219
def mins(t): h, m = t.split(':'); return int(h) * 60 + int(m)
def st(s): return mins(s.split('-')[0])
def en(s):
    a, b = s.split('-'); a, b = mins(a), mins(b); return b if b > a else b + 1440
def dur(s): return en(s) - st(s)
def load(f):
    j = json.load(open(f)); return j.get('patterns', j)
def times_of(p): return {p[k][d] for k in p for d in DAYS if p[k][d] not in ('RD', 'SPARE', 'OFF')}
def spare_lines(p): return {int(k) for k in p if all(p[k][d] == 'SPARE' for d in DAYS)}
OPEN = {'wk': 380, 'sat': 380, 'sun': 435}; CLOSE = {'wk': 1435, 'sat': 1435, 'sun': 1405}
def cls(d): return 'sun' if d == 'sun' else 'sat' if d == 'sat' else 'wk'
EARLY = lambda v: 300 <= st(v) < 420           # links-fatigue.js isEarlyStart: 05:00-07:00
# the plan's ticket office (report-data.mjs OFFICE.plan): Mon-Fri and Saturday are fixed pairs; Sunday is any two
# identical 07:15 earlies and two identical lates to 22:30 (rosteredPairs)
PAIRS_FIXED = {'wk': ('06:20-14:20', '14:00-22:30'), 'sat': ('06:20-14:50', '14:30-22:00')}
TODAY = ['06:20-13:35', '06:20-13:45', '06:20-14:00', '06:20-14:20', '06:20-14:50', '07:15-15:45', '08:00-16:30',
         '08:30-16:30', '11:00-19:30', '12:00-20:00', '13:00-21:00', '13:30-21:00', '13:30-22:00', '14:00-22:30',
         '14:30-22:00', '14:30-23:25', '14:45-23:55', '15:15-23:55']
PLAN = ['15:45-23:55', '07:15-15:30', '13:30-22:30', '06:20-14:20', '14:00-22:30', '06:20-14:50', '14:30-22:00']
SHORTLIST = ['Short-Run-SR-26-F1', 'Second-Edition-SE-26-F1', 'Even-Keel-EK-26-H1', 'Long-Break-LB-26-F1']
def universe(base):
    """The shift times a repair may use: the design's own, today's, the plan's office and closer, and the shortlist's."""
    u = times_of(base) | set(TODAY) | set(PLAN)
    for f in SHORTLIST: u |= times_of(load(os.path.join(TOOLING, '..', 'proposals', f + '.json')))
    return sorted(u, key=lambda s: (st(s), en(s)))
