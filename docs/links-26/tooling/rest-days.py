"""THE REST DAYS ALONE (7 Nov 2026, owner, of Balanced V8 and V9: "Exhaust the possibilities"). exact-rota.py's rules for
which days of the 26 weeks are worked, with the duty times dropped: a smaller model, for asking what the rest days alone
allow on Balanced V7's table (the duties of Balanced V5 to V9). Every rule here is one exact-rota.py holds, copied from it
where it can be, so whatever this proves impossible is impossible there too; what it finds possible may still fail there.

KEPT: each day's headcount and its early/late split (Balanced V7's table, CNT below), 4 or 5 duties a week, no switch
between an early and a late on two worked days in a row (FF19 and the rest rule forbid every one in that table, Saturday
to Sunday included), no 6 days in 6, the cover weeks' neighbours (Thu+Fri+Sat <= 2 before, Sun+Mon+Tue <= 2 after), 7
full weekends at most GAP weeks apart, BLOCK, FF11 in both views, and the three leave figures (LV_WORST, LV_BEST, LV_FOUR).
MIXED=n works as exact-rota.py's: each worked day early or late, at most n weeks mixing them, runs held to BF and BW.
DROPPED: the 06:20 rules, the rest and hours rules beyond the switch, the 55-hour worst case (H55), FF17, one-turn weeks
and the step.

  python3 rest-days.py [ISO=6] [MIXED=n BF=3 BW=4] [LV_FOUR=13 LV_BEST=30 LV_WORST=20] [OBJ=iso|none] [FIX=grid.json]
                       [PAIRED=1] [PATTERN=1] [DIST_FROM=grid.json DIST_MIN=n] [SECS=600] [WORKERS=4] [OUT=grid.json]
  ISO caps the single rest days; OBJ=iso (the default) minimises them, OBJ=none asks only whether ISO is possible. PAIRED=1
  adds what the model implies anyway (7 rest Saturdays and 7 weekends needed, so every rest Saturday is a weekend's), and
  PATTERN=1 chooses each week as one rest-day pattern, both to help the solver's bounds. FIX= checks a grid; OUT= writes
  one, every early 07:30-16:00 and every late 14:00-22:30 (the times mean nothing: SKELETON= in exact-rota.py reads only
  its rest days). It accepts Balanced V8, and V9 with MIXED=3 BF=3 BW=4, each with its own 6 single rest days; it
  refuses V7 (four weeks off for 14), V8 under V9's run limits (MIXED=0 BF=3 BW=4) and V9 with one mixed week (MIXED=1).

WHAT IT FOUND (7 Nov 2026, README.md -> "Balanced V8 and V9 searched again"). Fewest single rest days with V8's floors:
6, in two 15-minute runs (the plain model, and with PAIRED and PATTERN), with the solver's lower bound never off 0, and a
one-minute run asking for 5 decided nothing: 5 is neither found nor ruled out. Without the leave rules it finds 4. V9's
runs (BF=3 BW=4) with no week mixing earlies and lates, and with at most one, at most 6 single rest days: both possible
here. On the first, exact-rota.py lays the duties only without H55, and then with a 56h 30m week if a cover week falls
badly; on the second, not even without H55."""
import sys, json, os
from ortools.sat.python import cp_model
A = dict(a.split('=', 1) for a in sys.argv[1:])
env = lambda k, d: int(A.get(k, os.environ.get(k, d)))
L, COVER = 26, {1, 6, 11, 16, 21}; WORK = [k for k in range(1, L + 1) if k not in COVER]
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
CNT = {'weekday': (7, 8), 'sat': (7, 7), 'sun': (5, 5)}          # (early, late) duties a day, Balanced V7's table
cls = lambda d: 'sun' if d == 'sun' else 'sat' if d == 'sat' else 'weekday'
seq = [(k, d) for k in range(1, L + 1) for d in DAYS]; n = len(seq); work = lambda i: seq[i % n][0] in WORK
M = cp_model.CpModel()
on = {(k, d): M.NewBoolVar(f'on_{k}_{d}') for k in WORK for d in DAYS}
f = {k: M.NewBoolVar(f'f_{k}') for k in WORK}                    # 1 = an early week
MIXEDN = A.get('MIXED')
ek = {}
if MIXEDN is None:   # every week all earlies or all lates, as exact-rota.py without MIXED
    xe = {}
    for k in WORK:
        M.AddLinearConstraint(sum(on[(k, d)] for d in DAYS), 4, 5)
        for d in DAYS:
            v = M.NewBoolVar(f'xe_{k}_{d}'); xe[(k, d)] = v
            M.Add(v <= on[(k, d)]); M.Add(v <= f[k]); M.Add(v >= on[(k, d)] + f[k] - 1)
    for d in DAYS:
        e, l = CNT[cls(d)]
        M.Add(sum(on[(k, d)] for k in WORK) == e + l); M.Add(sum(xe[(k, d)] for k in WORK) == e)
    # no early/late switch between a Saturday and the next Sunday, both worked (the only consecutive pair across weeks)
    for k in WORK:
        nk = k % L + 1
        if nk in WORK:
            b = M.NewBoolVar(f'both_{k}'); M.Add(b >= on[(k, 'sat')] + on[(nk, 'sun')] - 1)
            M.Add(f[k] == f[nk]).OnlyEnforceIf(b)

else:
    # MIXED=n, as exact-rota.py's MIXED (6 Nov 2026): each worked day is early or late, the day's early count fixed; no
    # switch between two worked days in a row (FF19 and the rest rule forbid every one in this table, Saturday to Sunday
    # included); a week mixing the two counts against n; runs of all-early or all-late weeks held to BF on the fixed
    # duties (a cover week ends a run) and to BW with the cover weeks beside them going the same way. f[] is left free
    for k in WORK:
        M.AddLinearConstraint(sum(on[(k, d)] for d in DAYS), 4, 5)
        for d in DAYS:
            v = M.NewBoolVar(f'ek_{k}_{d}'); ek[(k, d)] = v; M.Add(v <= on[(k, d)])
    for d in DAYS:
        e, l = CNT[cls(d)]
        M.Add(sum(on[(k, d)] for k in WORK) == e + l); M.Add(sum(ek[(k, d)] for k in WORK) == e)
    for i in range(n):
        (k, d), (k2, d2) = seq[i], seq[(i + 1) % n]
        if k in WORK and k2 in WORK:
            b = M.NewBoolVar(f'adj_{i}'); M.Add(b >= on[(k, d)] + on[(k2, d2)] - 1)
            M.Add(ek[(k, d)] == ek[(k2, d2)]).OnlyEnforceIf(b)
    mx, aE, aL = {}, {}, {}
    for k in WORK:
        ef, lf = M.NewBoolVar(f'ef_{k}'), M.NewBoolVar(f'lf_{k}')
        M.AddMaxEquality(ef, [ek[(k, d)] for d in DAYS])
        lt = []
        for d in DAYS:
            v = M.NewBoolVar(f'lt_{k}_{d}'); M.Add(v == on[(k, d)] - ek[(k, d)]); lt.append(v)
        M.AddMaxEquality(lf, lt)
        mx[k], aE[k], aL[k] = M.NewBoolVar(f'mx_{k}'), M.NewBoolVar(f'aE_{k}'), M.NewBoolVar(f'aL_{k}')
        M.Add(mx[k] >= ef + lf - 1); M.Add(mx[k] <= ef); M.Add(mx[k] <= lf)
        M.Add(aE[k] >= ef - lf); M.Add(aE[k] <= ef); M.Add(aE[k] <= 1 - lf)
        M.Add(aL[k] >= lf - ef); M.Add(aL[k] <= lf); M.Add(aL[k] <= 1 - ef)
    M.Add(sum(mx.values()) <= int(MIXEDN))
    BF, BW = env('BF', 3), env('BW', 5)
    for s0 in range(1, L + 1):
        win = [((s0 - 1 + j) % L) + 1 for j in range(BF + 1)]
        if all(c in WORK for c in win): M.Add(sum(aE[c] for c in win) <= BF); M.Add(sum(aL[c] for c in win) <= BF)
        win = [((s0 - 1 + j) % L) + 1 for j in range(BW + 1)]
        M.Add(sum((aE[c] if c in WORK else 1) for c in win) <= BW); M.Add(sum((aL[c] if c in WORK else 1) for c in win) <= BW)
ON = lambda i: on[seq[i % n]] if work(i) else None
# PATTERN=1: each week chooses one rest-day pattern (2 or 3 rest days) and a kind, so the single rest days inside a week
# are a fixed price on its pattern, which gives the solver a lower bound to work with. With every rest Saturday a weekend's
# (PAIRED, implied), a single is a weekday rest between two worked days of its week, or a rest Sunday after a worked
# Saturday (or a cover week) with the Monday worked: exactly the count below.
isoP = None
if A.get('PATTERN') == '1':
    from itertools import combinations
    PATS = [frozenset(r) for m in (2, 3) for r in combinations(range(7), m)]   # rest days, 0 = Sunday
    def inner(R):   # weekday rests (Mon..Fri) with both neighbours worked, inside the week
        return sum(1 for d in range(1, 6) if d in R and (d - 1) not in R and (d + 1) not in R)
    y = {}
    for k in WORK:
        for j, R in enumerate(PATS):
            for fam in (0, 1):
                y[(k, j, fam)] = M.NewBoolVar(f'y_{k}_{j}_{fam}')
        M.AddExactlyOne([y[(k, j, fam)] for j in range(len(PATS)) for fam in (0, 1)])
        for di, d in enumerate(DAYS):
            M.Add(on[(k, d)] == sum(v for (kk, j, fam), v in y.items() if kk == k and di not in PATS[j]))
        M.Add(f[k] == sum(v for (kk, j, fam), v in y.items() if kk == k and fam == 1))
    sunNoMon = {k: sum(v for (kk, j, fam), v in y.items() if kk == k and 0 in PATS[j] and 1 not in PATS[j]) for k in WORK}
    satR = {k: sum(v for (kk, j, fam), v in y.items() if kk == k and 6 in PATS[j]) for k in WORK}
    zs = []
    for k in WORK:
        pk = L if k == 1 else k - 1
        z = M.NewIntVar(0, 1, f'zsun_{k}')
        M.Add(z >= sunNoMon[k] - (satR[pk] if pk in WORK else 0)); zs.append(z)
    isoP = sum(v * inner(PATS[j]) for (k, j, fam), v in y.items()) + sum(zs)
    M.Add(isoP <= env('ISO', 21))
for i in range(n):
    M.Add(sum(w for w in (ON(i + j) for j in range(6)) if w is not None) <= 5)
for c in COVER:
    prev, nxt = (L if c == 1 else c - 1), (1 if c == L else c + 1)
    if prev in WORK: M.Add(on[(prev, 'thu')] + on[(prev, 'fri')] + on[(prev, 'sat')] <= 2)
    if nxt in WORK: M.Add(on[(nxt, 'sun')] + on[(nxt, 'mon')] + on[(nxt, 'tue')] <= 2)
s = {}
for i in range(n):
    if not work(i): continue
    p, q = (i - 1) % n, (i + 1) % n
    s[i] = M.NewBoolVar(f's_{i}')
    M.Add(s[i] >= (1 - on[seq[i]]) + (ON(p) if work(p) else 1) + (ON(q) if work(q) else 1) - 2)
ISO = env('ISO', 21)
M.Add(sum(s.values()) <= ISO)
w = {}
for k in range(1, L + 1):
    nk = k % L + 1
    if k in WORK and nk in WORK:
        w[k] = M.NewBoolVar(f'w_{k}'); M.Add(w[k] <= 1 - on[(k, 'sat')]); M.Add(w[k] <= 1 - on[(nk, 'sun')]); M.Add(w[k] >= 1 - on[(k, 'sat')] - on[(nk, 'sun')])
M.Add(sum(w.values()) >= 7)
GAP, BLOCK = env('GAP', 5), env('BLOCK', 5)
for k in range(1, L + 1): M.Add(sum(w[j] for j in [(k + t - 1) % L + 1 for t in range(GAP)] if j in w) >= 1)
for a in range(len(WORK)):
    blk = [WORK[(a + j) % len(WORK)] for j in range(BLOCK + 1)]
    M.AddLinearConstraint(sum(f[k] for k in blk), 1, BLOCK)
# FF11 in both views, as exact-rota.py
o = on
brk = {}
for i in range(n):
    a, b = i, (i + 1) % n
    if work(a) or work(b):
        v = M.NewBoolVar(f'brk_{i}'); brk[i] = v
        if work(a): M.Add(v <= 1 - o[seq[a]])
        if work(b): M.Add(v <= 1 - o[seq[b]])
fixedBrk = lambda i: brk[i] if i in brk else 1
worstBrk = lambda i: brk[i] if (work(i) and work((i + 1) % n)) else 0
F11F, F11W = env('FF11_FIXED', 9), env('FF11_WORST', 11)
for i in range(n):
    for ln in range(F11F + 1, 22):
        idx = [(i + j) % n for j in range(ln)]
        M.Add(sum(o[seq[j]] for j in idx if work(j)) <= F11F + 30 * sum(fixedBrk(j) for j in idx[:-1]))
coverStarts = [(c - 1) * 7 for c in sorted(COVER)]
for c0 in coverStarts:
    for a in range(0, 15):
        for b in range(0, 15):
            idx = [(c0 - a + j) % n for j in range(a + 7 + b)]
            M.Add(sum(o[seq[j]] for j in idx if work(j)) + 4 <= F11W + 30 * sum(worstBrk(j) for j in idx[:-1]))
# LEAVE, as exact-rota.py
def cost(s0, ln):
    terms, cov = [], {}
    for j in range(ln):
        i = (s0 + j) % n; k, d = seq[i]
        if d == 'sun': continue
        if k in WORK: terms.append(o[(k, d)])
        else:
            key = (k, (s0 + j) // n); cov[key] = cov.get(key, 0) + 1
    return sum(terms) + sum(min(4, v) for v in cov.values())
LVW, LVB, LV4 = env('LV_WORST', 20), env('LV_BEST', 30), env('LV_FOUR', 13)
for s0 in range(n): M.Add(cost(s0, LVW) <= 14)
bb = [M.NewBoolVar(f'lvb_{s0}') for s0 in range(n)]
for s0 in range(n): M.Add(cost(s0, LVB) <= 14).OnlyEnforceIf(bb[s0])
M.AddBoolOr(bb)
b4 = [M.NewBoolVar(f'lv4_{s0}') for s0 in range(0, n, 7)]
for j, s0 in enumerate(range(0, n, 7)): M.Add(cost(s0, 28) <= LV4).OnlyEnforceIf(b4[j])
M.AddBoolOr(b4)
if A.get('FIX'):
    g = json.load(open(A['FIX'])); g = g.get('patterns', g)
    for k in WORK:
        for d in DAYS: M.Add(on[(k, d)] == (1 if g[str(k)][d][:1].isdigit() else 0))
        tm = [g[str(k)][d] for d in DAYS if g[str(k)][d][:1].isdigit()]
        if tm and MIXEDN is None: M.Add(f[k] == (1 if int(tm[0][:2]) * 60 + int(tm[0][3:5]) < 660 else 0))
        if MIXEDN is not None:
            for d in DAYS:
                t = g[str(k)][d]
                if t[:1].isdigit(): M.Add(ek[(k, d)] == (1 if int(t[:2]) * 60 + int(t[3:5]) < 660 else 0))
iso = sum(s.values())
# the decision version proves faster than the minimum: OBJ=none asks only whether ISO single rest days or fewer can be had
# (7 Nov 2026: minimising, the bound never left 0). PAIRED=1 adds what the model already implies, for the solver's sake:
# there are 7 rest Saturdays and 7 weekends are needed, so every rest Saturday is a weekend's
if A.get('PAIRED') == '1':
    for k in WORK:
        if k in w: M.Add(w[k] == 1 - on[(k, 'sat')])
        else: M.Add(on[(k, 'sat')] == 1)
if A.get('OBJ', 'iso') == 'iso': M.Minimize(iso if isoP is None else isoP)
# DIST_FROM=<grid> DIST_MIN=n: a skeleton at least n day-cells from that grid's (worked against rested), for searching far
# from a design's own weeks; AVOID=<a,b,...> keeps each listed skeleton at least DIST_MIN cells away too
def cellsOf(path):
    g = json.load(open(path)); g = g.get('patterns', g)
    return {(k, d): (1 if g[str(k)][d][:1].isdigit() else 0) for k in WORK for d in DAYS}
far = [A['DIST_FROM']] if A.get('DIST_FROM') else []
far += [x for x in A.get('AVOID', '').split(',') if x]
for path in far:
    c = cellsOf(path)
    M.Add(sum((1 - on[key]) if c[key] else on[key] for key in c) >= env('DIST_MIN', 1))
S = cp_model.CpSolver(); S.parameters.num_workers = env('WORKERS', 4); S.parameters.max_time_in_seconds = env('SECS', 600)
if A.get('CORE') == '1': S.parameters.optimize_with_core = True
if A.get('LIN'): S.parameters.linearization_level = int(A['LIN'])
if A.get('SEED'): S.parameters.random_seed = int(A['SEED'])
r = S.Solve(M)
def trueIso():
    val = lambda i: (S.Value(on[seq[i % n]]) if work(i) else 1)
    return sum(1 for i in range(n) if work(i) and val(i) == 0 and val(i - 1) == 1 and val(i + 1) == 1)
print('status', S.StatusName(r), 'iso', trueIso() if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'isoP', (S.Value(isoP) if isoP is not None and r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None), 'bound', S.BestObjectiveBound(), 'time', round(S.WallTime(), 1))
if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) and A.get('OUT'):
    kind = (lambda k, d: S.Value(f[k])) if MIXEDN is None else (lambda k, d: S.Value(ek[(k, d)]))
    out = {str(k): {d: ('SPARE' if k in COVER else (('07:30-16:00' if kind(k, d) else '14:00-22:30') if S.Value(on[(k, d)]) else 'RD')) for d in DAYS} for k in range(1, L + 1)}
    json.dump({'patterns': out}, open(A['OUT'], 'w'), indent=1)
