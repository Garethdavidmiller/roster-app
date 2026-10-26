# The fewest changed cells that meet the rules (model.py), and the proof of how few is possible.
#   python fewest.py <base.json> <out.json> [--flex] [--fmax N] [--time S] [--hint grid.json] [--cmax N] [--lexf]
# --flex     also the flexible rules: fourteen on a Saturday, every weekday closer at 15:45
# --fmax N   at most N fatigue factors (worst case, the 55-hour row at its worst included); default 0
# --lexf     minimise the factors first, then the changes (otherwise the factors are capped by --fmax)
# Prints the status, the changes and the solver's lower bound: OPTIMAL means no grid with fewer changes meets the rules.
import sys, json, time, argparse
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from model import *
ap = argparse.ArgumentParser()
ap.add_argument('base'); ap.add_argument('out')
ap.add_argument('--flex', action='store_true'); ap.add_argument('--fmax', type=int, default=0)
ap.add_argument('--time', type=float, default=600); ap.add_argument('--hint'); ap.add_argument('--cmax', type=int)
ap.add_argument('--lexf', action='store_true'); ap.add_argument('--workers', type=int, default=4)
a = ap.parse_args()
base = load(a.base)
m, x, z, changes, factors, WORK = build(base, flex=a.flex, fmax=None if a.lexf else a.fmax, cmax=a.cmax)
m.Minimize(1000 * factors + changes if a.lexf else changes)
if a.hint:
    h = load(a.hint)
    for (k, d, v), var in x.items(): m.AddHint(var, 1 if h[k][d] == v else 0)
s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = a.time; s.parameters.num_workers = a.workers
t0 = time.time(); r = s.Solve(m)
res = {'status': s.StatusName(r), 'time': round(time.time() - t0), 'bound': s.BestObjectiveBound(), 'flex': a.flex}
if r in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    p = extract(s, x, WORK, base)
    res.update({'changes': int(s.Value(changes)), 'factors': [f for f, v in z.items() if s.Value(v)]})
    json.dump({'patterns': p}, open(a.out, 'w'), indent=1)
print(json.dumps(res))
