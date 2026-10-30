"""A WHOLE ROTA FROM AN EXACT MODEL (27 Oct 2026, owner: "closing time can't be improved any further? try every
possibility if you haven't already"). space-polish.mjs improves a rota by small swaps, so it can only find what is near
where it starts; this states the whole problem — which line works which duty on which day — to Google's CP-SAT solver
(pip install ortools) and searches all of it at once. That day it gave Closing Time a 17th week on one shift time and
a week-to-week step of 1h 11m, where it had 16 and 1h 20m, with every other figure held — four polishes from Closing
Time's own weeks had stopped at 16 and 1h 17m (README.md -> "Closing Time, improved").

START FROM A ROTA THAT MEETS EVERY RULE, AND LET THE OBJECTIVE CLIMB. Asked to REQUIRE 17 one-turn weeks (ONE_MIN=17)
from a rota with 16, the solver found nothing in ten minutes on every variant tried; asked to MAXIMISE them (OBJ=one)
from the same rota, it found 17 inside ten on every variant. A floor the HINT does not meet leaves the solver to build
its first rota alone, which is the hard part. The same holds for every figure: OBJ=heavy, four, best and rest climb.

The rules, each counted the way the app's own module counts it, so a rota the sheets accept is a rota this accepts —
checked with FIX= on Closing Time (77a235bc and 78e18900, and 57429cc4 with its Sunday made 08:30) and Short Run, each
feasible with its own figures:
  the day's duties exactly (the table), 4 or 5 duties a week, no week mixing earlies and lates, the rest between duties
  (REST, minutes) and FF19 (no start more than two hours from the day before's in a working block), FF8b and FF15 in
  both views (a cover day read as rest, and as a worked day with no time), no run over 5 on the fixed duties or 6 with a
  cover week placed badly, FF11 (FF11_FIXED / FF11_WORST), FF17 (backward minus forward at most FF17), the most hours in
  any seven days (H7, minutes), the heaviest and lightest Monday-to-Saturday week (HEAVY, LIGHT), 7 full weekends at most
  GAP weeks apart, at most ISO single rest days, the three leave figures (leave.mjs: LV_WORST, LV_BEST, LV_FOUR), the
  week-to-week step (scoreOrder's gentleMean, at most STEP minutes), and blocks of early or late weeks at most BLOCK —
  a stricter stand-in for scoreOrder's longest block, which a family change always ends.
Not modelled, so checked afterwards by the sheets: the 55-hour worst case with cover weeks placed every way, and the
rules a duty table settles on its own (the December rules, FF2, the late finishes).
A RELAXATION run with fewer rules gives an upper bound; a run that returns a rota gives a candidate, and every rota
it writes still goes through the sheets (factors-like.mjs, report-data.mjs) before anything is claimed for it.
CP-SAT runs in parallel, so two runs of one command need not return the same rota — and its interleaved "deterministic"
mode did not either (two runs with the same seed and budget differed, 27 Oct 2026) — so a design it finds is committed as
its grid, and FIX= checks that grid against the model.
  python3 exact-rota.py <table.json> <out.json> [seconds]
  env: OBJ=one|step|both|chg|heavy|four|best|rest  ONE_MIN= STEP= LIGHT= MAXCHG= (at most n early/late switches the step can see)
       HINT=<rota.json> (start from it)  FIX=<rota.json> (check a rota against the model)  WORKERS=4  LOG=1
  e.g. HINT=closing-time.json ONE_MIN=17 LIGHT=1620 OBJ=step WORKERS=2 python3 exact-rota.py results/closing-time-table.json /tmp/ct.json 1200"""
import sys, json, os
from ortools.sat.python import cp_model
TABLE, OUT = sys.argv[1], sys.argv[2]; LIMIT = float(sys.argv[3]) if len(sys.argv) > 3 else 600
env = lambda k, d: int(os.environ.get(k, d))
REST, HEAVY, H7, GAP, ISO, BLOCK = env('REST', 875), env('HEAVY', 2490), env('H7', 3090), env('GAP', 5), env('ISO', 4), env('BLOCK', 5)
L, COVER = 26, {1, 6, 11, 16, 21}; WORK = [k for k in range(1, L + 1) if k not in COVER]
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; WKD = ['mon', 'tue', 'wed', 'thu', 'fri']
cls = lambda d: 'sun' if d == 'sun' else 'sat' if d == 'sat' else 'weekday'
slots = json.load(open(TABLE))['slots']
mm = lambda s: int(s[:2]) * 60 + int(s[3:5]); st = lambda t: mm(t[:5]); en = lambda t: mm(t[6:]); mins = lambda t: en(t) - st(t)
TYPES = {d: [s['time'] for s in slots if s[cls(d)] > 0] for d in DAYS}
CNT = {d: {s['time']: s[cls(d)] for s in slots if s[cls(d)] > 0} for d in DAYS}
early = lambda t: st(t) < 11 * 60; e620 = lambda t: 300 <= st(t) < 420
seq = [(k, d) for k in range(1, L + 1) for d in DAYS]; n = len(seq); work = lambda i: seq[i % n][0] in WORK
M = cp_model.CpModel()
x = {(k, d, t): M.NewBoolVar(f'x_{k}_{d}_{t}') for k in WORK for d in DAYS for t in TYPES[d]}
on = {(k, d): sum(x[(k, d, t)] for t in TYPES[d]) for k in WORK for d in DAYS}
E = {(k, d): sum(x[(k, d, t)] for t in TYPES[d] if e620(t)) for k in WORK for d in DAYS}
for k in WORK:
    for d in DAYS: M.AddAtMostOne([x[(k, d, t)] for t in TYPES[d]])
    M.AddLinearConstraint(sum(on[(k, d)] for d in DAYS), 4, 5)
    M.Add(sum(x[(k, d, t)] * mins(t) for d in DAYS if d != 'sun' for t in TYPES[d]) <= HEAVY)
    if os.environ.get('LIGHT'): M.Add(sum(x[(k, d, t)] * mins(t) for d in DAYS if d != 'sun' for t in TYPES[d]) >= env('LIGHT', 0))
for d in DAYS:
    for t in TYPES[d]: M.Add(sum(x[(k, d, t)] for k in WORK) == CNT[d][t])
f = {k: M.NewBoolVar(f'f_{k}') for k in WORK}
for (k, d, t), v in x.items(): M.AddImplication(v, f[k] if early(t) else f[k].Not())
for i in range(n):
    (k, d), (k2, d2) = seq[i], seq[(i + 1) % n]
    if k not in WORK or k2 not in WORK: continue
    for t in TYPES[d]:
        for t2 in TYPES[d2]:
            if 1440 - en(t) + st(t2) < REST or abs(st(t2) - st(t)) > 120: M.AddBoolOr([x[(k, d, t)].Not(), x[(k2, d2, t2)].Not()])
ON = lambda i: on[seq[i % n]] if work(i) else None
for i in range(n):
    M.Add(sum(w for w in (ON(i + j) for j in range(6)) if w is not None) <= 5)
    win = [seq[(i + j) % n] for j in range(5)]
    if all(c[0] in WORK for c in win): M.Add(sum(E[c] for c in win) <= 4)
for c in COVER:
    prev, nxt = (L if c == 1 else c - 1), (1 if c == L else c + 1)
    if prev in WORK: M.Add(on[(prev, 'thu')] + on[(prev, 'fri')] + on[(prev, 'sat')] <= 2); M.Add(E[(prev, 'sat')] == 0)
    if nxt in WORK: M.Add(on[(nxt, 'sun')] + on[(nxt, 'mon')] + on[(nxt, 'tue')] <= 2)
for i in range(n):
    a, b, c1, c2 = (i - 1) % n, i, (i + 1) % n, (i + 2) % n
    if not (work(a) and work(b)): continue
    ea, eb = E[seq[a]], E[seq[b]]; ec = E[seq[c1]] if work(c1) else 0
    for c in (c1, c2): M.Add((ON(c) if work(c) else 1) <= 2 - ea - eb + ec)
for i in range(n):
    win = [seq[(i + j) % n] for j in range(7)]
    M.Add(sum(x[(k, d, t)] * mins(t) for (k, d) in win if k in WORK for t in TYPES[d]) <= H7)
s = {}
for i in range(n):
    if not work(i): continue
    p, q = (i - 1) % n, (i + 1) % n
    s[i] = M.NewBoolVar(f's_{i}')
    M.Add(s[i] >= (1 - on[seq[i]]) + (ON(p) if work(p) else 1) + (ON(q) if work(q) else 1) - 2)
M.Add(sum(s.values()) <= ISO)
w = {}
for k in range(1, L + 1):
    nk = k % L + 1
    if k in WORK and nk in WORK:
        w[k] = M.NewBoolVar(f'w_{k}'); M.Add(w[k] <= 1 - on[(k, 'sat')]); M.Add(w[k] <= 1 - on[(nk, 'sun')]); M.Add(w[k] >= 1 - on[(k, 'sat')] - on[(nk, 'sun')])
M.Add(sum(w.values()) >= 7)
for k in range(1, L + 1): M.Add(sum(w[j] for j in [(k + t - 1) % L + 1 for t in range(GAP)] if j in w) >= 1)
for a in range(len(WORK)):
    blk = [WORK[(a + j) % len(WORK)] for j in range(BLOCK + 1)]
    M.AddLinearConstraint(sum(f[k] for k in blk), 1, BLOCK)
z = []   # the early/late switches between two working weeks — the ones the step can see
for a in range(1, L + 1):
    b = a % L + 1
    if a in WORK and b in WORK: zz = M.NewBoolVar(f'z_{a}'); M.Add(zz >= f[a] - f[b]); M.Add(zz >= f[b] - f[a]); z.append(zz)
if os.environ.get('MAXCHG') is not None: M.Add(sum(z) <= int(os.environ['MAXCHG']))
# ---- the rules the first model left out (27 Oct 2026), each as the app's own module counts it ----
o = {(k, d): M.NewBoolVar(f'o_{k}_{d}') for k in WORK for d in DAYS}
for k in WORK:
    for d in DAYS: M.Add(o[(k, d)] == on[(k, d)])
Sv = {(k, d): sum(x[(k, d, t)] * st(t) for t in TYPES[d]) for k in WORK for d in DAYS}
# FF17 (rotationDirection): consecutive worked duties with times; backward when the next starts earlier
bw, fw = [], []
for i in range(n):
    (k, d), (k2, d2) = seq[i], seq[(i + 1) % n]
    if k not in WORK or k2 not in WORK: continue
    b, fv = M.NewBoolVar(f'bw_{i}'), M.NewBoolVar(f'fw_{i}')
    M.Add(Sv[(k2, d2)] >= Sv[(k, d)]).OnlyEnforceIf([o[(k, d)], o[(k2, d2)], b.Not()])
    M.AddImplication(fv, o[(k, d)]); M.AddImplication(fv, o[(k2, d2)]); M.Add(Sv[(k2, d2)] >= Sv[(k, d)] + 1).OnlyEnforceIf(fv)
    bw.append(b); fw.append(fv)
M.Add(sum(bw) - sum(fw) <= env('FF17', 0))
# FF11 (longestRunBetween48hBreaks): shifts between two rest days in a row. Fixed view: a cover day is a rest day.
# Worst view: a cover week is four shifts and no break.
rest = lambda i: (1 - o[seq[i % n]]) if work(i) else None   # None = a cover day
brk = {}
for i in range(n):
    a, b = i, (i + 1) % n
    if work(a) or work(b):
        v = M.NewBoolVar(f'brk_{i}'); brk[i] = v
        if work(a): M.Add(v <= 1 - o[seq[a]])
        if work(b): M.Add(v <= 1 - o[seq[b]])
fixedBrk = lambda i: brk[i] if i in brk else 1          # two cover days in a row: always a break when read as rest
worstBrk = lambda i: brk[i] if (work(i) and work((i + 1) % n)) else 0   # a cover day is not rest in the worst view
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
# LEAVE (leave.mjs): from every first day, 14 days' leave buys at least LV_WORST days off in a row; somewhere it buys
# LV_BEST; and four full weeks from some Sunday cost at most LV_FOUR. Mon-Sat working days cost one, rest days and Sundays
# none, a cover week at most four (its first four Mon-Sat days in the stretch).
def cost(s0, ln):
    terms, const, cov = [], 0, {}
    for j in range(ln):
        i = (s0 + j) % n; k, d = seq[i]
        if d == 'sun': continue
        if k in WORK: terms.append(o[(k, d)])
        else:
            key = (k, (s0 + j) // n); cov[key] = cov.get(key, 0) + 1
    const = sum(min(4, v) for v in cov.values())
    return sum(terms) + const
LVW, LVB, LV4 = env('LV_WORST', 20), env('LV_BEST', 28), env('LV_FOUR', 15)
for s0 in range(n): M.Add(cost(s0, LVW) <= 14)
bb = [M.NewBoolVar(f'lvb_{s0}') for s0 in range(n)]
for s0 in range(n): M.Add(cost(s0, LVB) <= 14).OnlyEnforceIf(bb[s0])
M.AddBoolOr(bb)
b4 = [M.NewBoolVar(f'lv4_{s0}') for s0 in range(0, n, 7)]
for j, s0 in enumerate(range(0, n, 7)): M.Add(cost(s0, 28) <= LV4).OnlyEnforceIf(b4[j])
M.AddBoolOr(b4)
# THE STEP (scoreOrder.gentleMean): the mean, over neighbouring working lines, of how far the average start moves.
# 20 x a line's average start is exact for a 4- or 5-duty week: 5 x total for four, 4 x total for five.
Aavg, D = {}, []
for k in WORK:
    T = sum(Sv[(k, d)] for d in DAYS); five = M.NewBoolVar(f'five_{k}')
    M.Add(sum(o[(k, d)] for d in DAYS) == 5).OnlyEnforceIf(five); M.Add(sum(o[(k, d)] for d in DAYS) == 4).OnlyEnforceIf(five.Not())
    A = M.NewIntVar(0, 20 * 1440, f'A_{k}'); M.Add(A == 4 * T).OnlyEnforceIf(five); M.Add(A == 5 * T).OnlyEnforceIf(five.Not()); Aavg[k] = A
pairs = [(a, a % L + 1) for a in range(1, L + 1) if a in WORK and (a % L + 1) in WORK]
for a, b in pairs:
    dv = M.NewIntVar(0, 20 * 1440, f'D_{a}'); M.AddAbsEquality(dv, Aavg[b] - Aavg[a]); D.append(dv)
stepSum = sum(D)   # 20 x the sum of |moves|; gentleMean = round(stepSum / 20 / len(pairs))
if os.environ.get('STEP'): M.Add(stepSum * 2 <= (2 * env('STEP', 80) + 1) * 20 * len(pairs) - 1)
u = {(k, t): M.NewBoolVar(f'u_{k}_{t}') for k in WORK for t in TYPES['mon']}
for k in WORK:
    M.AddAtMostOne([u[(k, t)] for t in TYPES['mon']])
    for t in TYPES['mon']:
        for d in WKD:
            for t2 in TYPES[d]:
                if t2 != t: M.AddBoolOr([x[(k, d, t2)].Not(), u[(k, t)].Not()])
one = sum(u.values())
if os.environ.get('ONE_MIN'): M.Add(one >= int(os.environ['ONE_MIN']))
def rota(fn):
    F = json.load(open(fn)); return F.get('patterns', F)
if os.environ.get('FIX'):
    F = rota(os.environ['FIX'])
    for (k, d, t), v in x.items(): M.Add(v == (1 if F[str(k)][d] == t else 0))
if os.environ.get('HINT'):
    F = rota(os.environ['HINT'])
    for (k, d, t), v in x.items(): M.AddHint(v, 1 if F[str(k)][d] == t else 0)
# CLIMBING OBJECTIVES (27 Oct 2026): a figure asked for as a floor the starting rota does not meet leaves the solver to
# find a first rota on its own, which it rarely does in minutes; asked for as an objective from a valid rota, it climbs.
heavyMax = M.NewIntVar(0, 7 * 1440, 'heavyMax')
M.AddMaxEquality(heavyMax, [sum(x[(k, d, t)] * mins(t) for d in DAYS if d != 'sun' for t in TYPES[d]) for k in WORK])
four = M.NewIntVar(0, 200, 'four')
M.AddMinEquality(four, [cost(s0, 28) for s0 in range(0, n, 7)])
best29 = M.NewIntVar(0, 200, 'best29')   # the least leave any 29 days in a row cost: 14 or less is a best stretch of 29
M.AddMinEquality(best29, [cost(s0, 29) for s0 in range(n)])
R2 = env('REST_TO', 900); tight = []   # duties back to back with less rest than REST_TO
for i in range(n):
    (k, d), (k2, d2) = seq[i], seq[(i + 1) % n]
    if k not in WORK or k2 not in WORK: continue
    for t in TYPES[d]:
        for t2 in TYPES[d2]:
            r = 1440 - en(t) + st(t2)
            if REST <= r < R2 and abs(st(t2) - st(t)) <= 120:
                b = M.NewBoolVar(f'tight_{i}_{t}_{t2}'); M.Add(b >= x[(k, d, t)] + x[(k2, d2, t2)] - 1); tight.append(b)
OBJ = os.environ.get('OBJ', 'one')
if OBJ == 'one': M.Maximize(one)
elif OBJ == 'step': M.Minimize(stepSum)
elif OBJ == 'chg': M.Minimize(sum(z))   # the fewest visible switches, so a one-switch layout can be climbed to
elif OBJ == 'heavy': M.Minimize(heavyMax)   # the heaviest Monday-to-Saturday week
elif OBJ == 'four': M.Minimize(four)        # the leave four full weeks from a Sunday cost
elif OBJ == 'best': M.Minimize(best29)      # the leave the cheapest 29 days cost (14 is a best stretch of 29)
elif OBJ == 'rest': M.Minimize(sum(tight))  # the rests under REST_TO (default 15h)
else: M.Maximize(one * 100000 - stepSum)   # 'both': the most one-turn weeks, then the smallest step
S = cp_model.CpSolver(); S.parameters.num_workers = env('WORKERS', 4)
S.parameters.max_time_in_seconds = LIMIT
if os.environ.get('LOG'): S.parameters.log_search_progress = True
r = S.Solve(M)
print('heavy', S.Value(heavyMax) if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'four', S.Value(four) if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'best29cost', S.Value(best29) if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'tight', S.Value(sum(tight)) if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None)
print('step', round(S.Value(stepSum) / 20 / len(pairs), 2) if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'FF17 b-f', (S.Value(sum(bw)) - S.Value(sum(fw))) if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None)
print('status', S.StatusName(r), 'one-turn', S.ObjectiveValue() if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'bound', S.BestObjectiveBound(), 'time', round(S.WallTime(), 1), flush=True)
if r in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    P = {}
    for k in range(1, L + 1):
        if k in COVER: P[str(k)] = {d: 'SPARE' for d in DAYS}; continue
        P[str(k)] = {d: next((t for t in TYPES[d] if S.Value(x[(k, d, t)])), 'RD') for d in DAYS}
    json.dump({'patterns': P}, open(OUT, 'w'), indent=1); print('wrote', OUT)
