# Checks model.py's ENCODING against evaluator.py (itself checked against the sheets' code by check_evaluator.py).
# For each test grid the model is pinned to that grid, then asked, one part at a time, whether the grid passes — and,
# with no rules on, for the fewest factors it will admit. Every answer must equal the evaluator's, both ways round.
#   python3 check_model.py <solution.json>      a grid that meets every rule, so the "passes" answers get exercised
# Three batches: random edits of the solution, of Fifteen Turns and of Gates Mended (60 grids); edits that push the
# number of shift times past 18 (20); and rest days filled in until runs pass 13, including runs into and out of a
# cover week (144). Measured 28 Sep 2026: 0 mismatches, every part seen both passing and failing.
import os, sys, json, random, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from evaluator import judge
from model import build
from ortools.sat.python import cp_model

def solve(g, parts, minimize_factors):
    fix = {(k, d): g[k][d] for k in g if int(k) not in SPARE_LINES for d in DAYS}
    m, x, z, ch, fa, W = build(fix=fix, parts=parts)
    if minimize_factors: m.Minimize(fa)
    s = cp_model.CpSolver(); s.parameters.num_workers = 4; s.parameters.max_time_in_seconds = 60
    return s.Solve(m), s, z

def feasible(r): return r in (cp_model.OPTIMAL, cp_model.FEASIBLE)
bad = 0; seen = {}
def compare(g):
    global bad
    J = judge(g)
    r, s, z = solve(g, set(), True); assert r == cp_model.OPTIMAL
    for f, v in z.items():
        if s.Value(v) != J['factors'][f]: bad += 1; print('factor', f, s.Value(v), J['factors'][f])
    expect = {'open': J['rules']['open'], 'close': J['rules']['close'], 'at22': J['rules']['at22'], 'heads': J['rules']['heads'],
              'office': J['rules']['office'], 'closer': J['rules']['closer'], 'times': J['rules']['times'],
              'contract': J['monsat'] == 42000, 'rest': J['turn'] == 0, 'run': J['run'] <= 13}
    for part, exp in expect.items():
        got = feasible(solve(g, {part}, False)[0]); seen.setdefault(part, set()).add(exp)
        if got != exp: bad += 1; print('part', part, got, exp)
    exp = bool(J['rules']['office'] and J['rules']['floor'] and J['rules']['handover'])
    got = feasible(solve(g, {'office', 'floorhand'}, False)[0]); seen.setdefault('floorhand', set()).add(exp)
    if got != exp: bad += 1; print('floorhand', got, exp)

S0 = load(sys.argv[1]); random.seed(1)
WORKL = [str(i) for i in range(1, 25) if i not in SPARE_LINES]
def in_domain(g): return all(g[k][d] in domain(d) + ['RD'] for k in WORKL for d in DAYS)
for t in range(60):   # random edits
    g = copy.deepcopy(random.choice([S0, FT, GM]))
    for _ in range(random.randint(0, 6)):
        k = random.choice(WORKL); d = random.choice(DAYS); r = random.random()
        if r < 0.25: g[k][d] = 'RD'
        elif r < 0.5: k2 = random.choice(WORKL); g[k][d], g[k2][d] = g[k2][d], g[k][d]
        else: g[k][d] = random.choice(domain(d))
    if in_domain(g): compare(g)
for t in range(20):   # too many shift times
    g = copy.deepcopy(S0)
    for v in random.sample(U, random.randint(8, 20)):
        d = random.choice([d for d in DAYS if v in domain(d)]); g[random.choice(WORKL)][d] = v
    compare(g)
for lines in (['1','2','3'], ['4','5'], ['5'], ['7','8'], ['7'], ['9','10'], ['13','14'], ['22','23'], ['23']):   # long runs
    for cut in range(8):
        cells = [(k, d) for k in lines for d in DAYS]
        for part in (cells[cut:], cells[:len(cells) - cut]):
            g = copy.deepcopy(S0)
            for k, d in part:
                if g[k][d] == 'RD': g[k][d] = '13:00-21:30' if d != 'sun' else '14:00-22:30'
            compare(g)
print('mismatches', bad, 'outcomes seen per part', {k: sorted(v) for k, v in seen.items()})
