"""REST-DAY LAYOUTS WITH A LEAVE FIGURE AS A RULE (4 Nov 2026, owner, of Quarter Past: "keep the 14 days off to buy 30
days annual leave (sundays can be made not available) but meet all the other fatigue rules, maximise weekends off, double
day rest days and weeks on one time"). exact-rota.py, asked for a 30-day stretch on Quarter Past's times, found nothing in
twenty minutes. Split in two, it goes quickly: this lays the REST DAYS alone (which days each week works, and whether it
is an early or a late week), and exact-rota.py's SKELETON= and FAMILY=1 then lay a table's times onto them. What 14
days' leave buys depends on the rest days only, so it is settled here, before any time is chosen.

The rules: exact-skeletons.py's (every day's headcount and early count, which the December rules fix for every 26-line
table; 4 or 5 duties a week, MIN_DUTIES=3 allowing 3; a rest day at every change between early and late weeks; no single
rest day straight after an early; at most two early Saturdays before a cover week; no run over RUN in the fixed duties;
the cover-week neighbours; WEEKENDS full weekends at most GAP weeks apart), exact-rota.py's FF11 (fixed and worst) and
BLOCK, and leave.mjs's count, as exact-rota.py states it: somewhere 14 days' leave buys LV_BEST days off in a row, from
every first day at least LV_WORST, and four full weeks from some Sunday cost at most LV_FOUR. Two rules for what came
next, both off unless asked for:
  FRIOFF=1  the Friday before every cover week off. A worked Friday and Saturday, then a cover week worked Sunday to
            Thursday, is how a design reaches 55 hours in seven days (report-data.mjs h55Worst, every proposal's "up to 1");
  NINE=1    an early week that works Sunday with Monday off, and the Saturday before it off, for the Sunday
            09:00-18:00: a Monday 07:15 after it leaves 13h 15m of rest.

THE SEARCH CLIMBS; IT DOES NOT PROVE. From nothing, CP-SAT rarely finds a layout; from a valid one (HINT=) it climbs: by
default to the fewest single rest days, then the fewest changes between early and late weeks; with OBJ=cheap, to the
cheapest SPAN-day stretch first. With LV_BEST=30 and 7 weekends every run stopped at 5 single rest days and none found
4, and none proved 4 impossible either (bound 0). Like exact-rota.py it runs in parallel, so two runs need not return the
same layout: the grid a design is built on is the record, and FIX= checks a grid against this model.

Writes each layout as a pseudo-rota (early cells 06:20-14:20, late 14:00-22:30; Sunday 07:15-15:45 and 14:30-22:30).
  python3 leave-layouts.py <outdir> <count> [seconds each]
  env: LV_BEST=30 LV_WORST=14 LV_FOUR=28 SPAN=30 ISO=4 RUN=5 GAP=5 WEEKENDS=7 BLOCK=5 MIN_DUTIES=4 FF11_FIXED=13
       FF11_WORST=13 DIFF=12 FRIOFF= NINE= HINT=<rota.json> FIX=<rota.json> OBJ=cheap WORKERS=4 SEED=0
  Quarter Past Relaid's layout (README.md -> "Quarter Past Relaid"), each step from the one before (HINT=):
    OBJ=cheap LV_BEST=0 HINT=even-step.json   (the cheapest 30 days, 4 single rest days: 15)
    ISO=6 OBJ=cheap LV_BEST=0                                       (6 single rest days: 30 days cost 13)
    ISO=6 LV_BEST=30                                                (30 days for 14, the fewest single rest days: 5)
    FRIOFF=1 ISO=5 LV_BEST=30, then the same with LV_WORST=19 LV_FOUR=14   (today's worst stretch and four weeks)"""
import sys, json, os
from ortools.sat.python import cp_model
OUT, COUNT = sys.argv[1], int(sys.argv[2]); LIMIT = float(sys.argv[3]) if len(sys.argv) > 3 else 300
env = lambda k, d: int(os.environ.get(k, d))
ISO, RUN, GAP, BLOCK, DIFF = env('ISO', 4), env('RUN', 5), env('GAP', 5), env('BLOCK', 5), env('DIFF', 12)
L, COVER = 26, {1, 6, 11, 16, 21}; WORK = [k for k in range(1, L + 1) if k not in COVER]
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
ON = {'sun': 10, 'mon': 15, 'tue': 15, 'wed': 15, 'thu': 15, 'fri': 15, 'sat': 14}
EARLY = {'sun': 5, 'mon': 7, 'tue': 7, 'wed': 7, 'thu': 7, 'fri': 7, 'sat': 7}
seq = [(k, d) for k in range(1, L + 1) for d in DAYS]; n = len(seq); work = lambda i: seq[i % n][0] in WORK
M = cp_model.CpModel()
on = {(k, d): M.NewBoolVar(f'on_{k}_{d}') for k in WORK for d in DAYS}
f = {k: M.NewBoolVar(f'f_{k}') for k in WORK}
y = {(k, d): M.NewBoolVar(f'y_{k}_{d}') for k in WORK for d in DAYS}
for (k, d), v in y.items(): M.AddMultiplicationEquality(v, [on[(k, d)], f[k]])
cell = lambda k, d: on[(k, d)] if k in WORK else 1
for d in DAYS:
    M.Add(sum(on[(k, d)] for k in WORK) == ON[d]); M.Add(sum(y[(k, d)] for k in WORK) == EARLY[d])
for k in WORK: M.AddLinearConstraint(sum(on[(k, d)] for d in DAYS), env('MIN_DUTIES', 4), 5)
s = {}
for i in range(n):
    if not work(i): continue
    k, d = seq[i]; p, q = seq[(i - 1) % n], seq[(i + 1) % n]
    s[i] = M.NewBoolVar(f's_{i}'); M.Add(s[i] >= (1 - on[(k, d)]) + cell(*p) + cell(*q) - 2)
    if p[0] in WORK and p[1] != 'sun': M.Add(s[i] + y[p] <= 1)          # no single rest day straight after an early
M.Add(sum(s.values()) <= ISO)
ONi = lambda i: on[seq[i % n]] if work(i) else None
for i in range(n): M.Add(sum(w for w in (ONi(i + j) for j in range(RUN + 1)) if w is not None) <= RUN)
for c in COVER:
    prev, nxt = (L if c == 1 else c - 1), (1 if c == L else c + 1)
    if prev in WORK: M.Add(on[(prev, 'thu')] + on[(prev, 'fri')] + on[(prev, 'sat')] <= 2)
    if nxt in WORK: M.Add(on[(nxt, 'sun')] + on[(nxt, 'mon')] + on[(nxt, 'tue')] <= 2)
M.Add(sum(y[((L if c == 1 else c - 1), 'sat')] for c in COVER if (L if c == 1 else c - 1) in WORK) <= 2)
if os.environ.get('NINE'):   # an early week working Sunday with Monday off, for the Sunday 09:00-18:00: a Monday 07:15 after it leaves 13h15 rest
    nb = {k: M.NewBoolVar(f'nine_{k}') for k in WORK}
    for k, v in nb.items():
        M.AddImplication(v, f[k]); M.AddImplication(v, on[(k, 'sun')]); M.AddImplication(v, on[(k, 'mon')].Not())
        pk = L if k == 1 else k - 1   # and the Saturday before it is not an early 06:20 (FF19) nor a late (rest): off, or a cover week
        if pk in WORK: M.AddImplication(v, on[(pk, 'sat')].Not())
    M.AddBoolOr(list(nb.values()))
if os.environ.get('FRIOFF'):   # the Friday before every cover week off: a cover week worked Sunday to Thursday can then never make 55 hours
    for c in COVER:
        prev = L if c == 1 else c - 1
        if prev in WORK: M.Add(on[(prev, 'fri')] == 0)
w = {}
for k in range(1, L + 1):
    nk = k % L + 1
    if k in WORK and nk in WORK:
        w[k] = M.NewBoolVar(f'w_{k}'); M.Add(w[k] <= 1 - on[(k, 'sat')]); M.Add(w[k] <= 1 - on[(nk, 'sun')]); M.Add(w[k] >= 1 - on[(k, 'sat')] - on[(nk, 'sun')])
M.Add(sum(w.values()) >= env('WEEKENDS', 7))
for k in range(1, L + 1): M.Add(sum(w[j] for j in [(k + t - 1) % L + 1 for t in range(GAP)] if j in w) >= 1)
for k in WORK:
    nk = k % L + 1
    if nk in WORK:
        z = M.NewBoolVar(f'z_{k}'); M.Add(z >= f[k] - f[nk]); M.Add(z >= f[nk] - f[k])
        M.Add(on[(k, 'sat')] + on[(nk, 'sun')] <= 2 - z)
for a in range(len(WORK)):
    blk = [WORK[(a + j) % len(WORK)] for j in range(BLOCK + 1)]
    M.AddLinearConstraint(sum(f[k] for k in blk), 1, BLOCK)
# FF11, as exact-rota.py counts it
brk = {}
for i in range(n):
    a, b = i, (i + 1) % n
    if work(a) or work(b):
        v = M.NewBoolVar(f'brk_{i}'); brk[i] = v
        if work(a): M.Add(v <= 1 - on[seq[a]])
        if work(b): M.Add(v <= 1 - on[seq[b]])
fixedBrk = lambda i: brk[i] if i in brk else 1
worstBrk = lambda i: brk[i] if (work(i) and work((i + 1) % n)) else 0
F11F, F11W = env('FF11_FIXED', 13), env('FF11_WORST', 13)
for i in range(n):
    for ln in range(F11F + 1, 22):
        idx = [(i + j) % n for j in range(ln)]
        M.Add(sum(on[seq[j]] for j in idx if work(j)) <= F11F + 30 * sum(fixedBrk(j) for j in idx[:-1]))
for c0 in [(c - 1) * 7 for c in sorted(COVER)]:
    for a in range(0, 15):
        for b in range(0, 15):
            idx = [(c0 - a + j) % n for j in range(a + 7 + b)]
            M.Add(sum(on[seq[j]] for j in idx if work(j)) + 4 <= F11W + 30 * sum(worstBrk(j) for j in idx[:-1]))
# leave.mjs, as exact-rota.py counts it
def cost(s0, ln):
    terms, cov = [], {}
    for j in range(ln):
        i = (s0 + j) % n; k, d = seq[i]
        if d == 'sun': continue
        if k in WORK: terms.append(on[(k, d)])
        else: key = (k, (s0 + j) // n); cov[key] = cov.get(key, 0) + 1
    return sum(terms) + sum(min(4, v) for v in cov.values())
LVW, LVB, LV4 = env('LV_WORST', 14), env('LV_BEST', 30), env('LV_FOUR', 28)
for s0 in range(n): M.Add(cost(s0, LVW) <= 14)
if LVB:
    bb = [M.NewBoolVar(f'lvb_{s0}') for s0 in range(n)]
    for s0 in range(n): M.Add(cost(s0, LVB) <= 14).OnlyEnforceIf(bb[s0])
    M.AddBoolOr(bb)
SPAN = env('SPAN', 30)
cheap = M.NewIntVar(0, 200, 'cheap')   # the least leave any SPAN days in a row cost: 14 or less is a best stretch of SPAN
M.AddMinEquality(cheap, [cost(s0, SPAN) for s0 in range(n)])
b4 = [M.NewBoolVar(f'lv4_{s0}') for s0 in range(0, n, 7)]
for j, s0 in enumerate(range(0, n, 7)): M.Add(cost(s0, 28) <= LV4).OnlyEnforceIf(b4[j])
M.AddBoolOr(b4)
zs = []
for k in WORK:
    nk = k % L + 1
    if nk in WORK: zz = M.NewBoolVar(f'zz_{k}'); M.Add(zz >= f[k] - f[nk]); M.Add(zz >= f[nk] - f[k]); zs.append(zz)
if os.environ.get('FIX'):   # check a rota's layout against this model
    F = json.load(open(os.environ['FIX'])); F = F.get('patterns', F)
    for k in WORK:
        for d in DAYS: M.Add(on[(k, d)] == (0 if F[str(k)][d] in ('RD', 'OFF') else 1))
        fam = {int(F[str(k)][d][:2]) * 60 + int(F[str(k)][d][3:5]) < 660 for d in DAYS if F[str(k)][d] not in ('RD', 'OFF', 'SPARE')}
        if len(fam) == 1: M.Add(f[k] == (1 if fam.pop() else 0))
if os.environ.get('HINT'):
    F = json.load(open(os.environ['HINT'])); F = F.get('patterns', F)
    for k in WORK:
        for d in DAYS: M.AddHint(on[(k, d)], 0 if F[str(k)][d] in ('RD', 'OFF') else 1)
        fam = {int(F[str(k)][d][:2]) * 60 + int(F[str(k)][d][3:5]) < 660 for d in DAYS if F[str(k)][d] not in ('RD', 'OFF', 'SPARE')}
        if len(fam) == 1: M.AddHint(f[k], 1 if fam.pop() else 0)
if os.environ.get('OBJ') == 'cheap': M.Minimize(cheap * 10000 + sum(s.values()) * 100 + sum(zs))
else: M.Minimize(sum(s.values()) * 100 + sum(zs))
os.makedirs(OUT, exist_ok=True)
for t in range(1, COUNT + 1):
    S = cp_model.CpSolver(); S.parameters.num_workers = env('WORKERS', 4); S.parameters.max_time_in_seconds = LIMIT; S.parameters.random_seed = env('SEED', 0)
    r = S.Solve(M)
    print(f'layout {t}: {S.StatusName(r)} in {S.WallTime():.0f}s', end='')
    if r not in (cp_model.OPTIMAL, cp_model.FEASIBLE): print(); break
    sing = sum(S.Value(v) for v in s.values()); ch = sum(S.Value(v) for v in zs)
    print(f' · single rest days {sing} · family changes {ch} · weekends {sum(S.Value(v) for v in w.values())} · cheapest {SPAN}-day stretch costs {S.Value(cheap)} days of leave · bound {S.BestObjectiveBound()}', flush=True)
    P = {}
    for k in range(1, L + 1):
        if k in COVER: P[str(k)] = {d: 'SPARE' for d in DAYS}; continue
        P[str(k)] = {d: (('06:20-14:20' if S.Value(f[k]) else '14:00-22:30') if S.Value(on[(k, d)]) else 'RD') for d in DAYS}
        if S.Value(f[k]) and S.Value(on[(k, 'sun')]): P[str(k)]['sun'] = '07:15-15:45'
        if not S.Value(f[k]) and S.Value(on[(k, 'sun')]): P[str(k)]['sun'] = '14:30-22:30'
    json.dump({'patterns': P}, open(f'{OUT}/skel-{t}.json', 'w'), indent=1)
    ones = [v for v in on.values() if S.Value(v)]; zeros = [v for v in on.values() if not S.Value(v)]
    M.Add(sum(1 - v for v in ones) + sum(zeros) >= DIFF)
