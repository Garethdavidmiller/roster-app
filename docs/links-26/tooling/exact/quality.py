# WHAT IT COSTS TO BE GOOD TO WORK AS WELL AS COMPLIANT: the fewest changed cells that meet the rules (model.py) AND
# reach the floors given — so "meets every rule" and "no worse than today's link to work" can be priced separately.
#   python quality.py <base.json> <out.json> [--flex] [--fmax 0] [--min-wk N] [--max-gap N] [--max-iso N]
#                     [--max-heavy MINUTES] [--min-one N] [--time S] [--hint grid.json]
# The measures are model.quality_terms(): full weekends off in the rotation, the longest wait between them in weeks,
# single rest days, the heaviest Monday-to-Saturday week and working weeks on one turn.
import sys, json, time, argparse
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from model import *
ap = argparse.ArgumentParser()
ap.add_argument('base'); ap.add_argument('out')
ap.add_argument('--flex', action='store_true'); ap.add_argument('--fmax', type=int, default=0)
for f in ('min-wk', 'max-gap', 'max-iso', 'max-heavy', 'min-one'): ap.add_argument('--' + f, type=int)
ap.add_argument('--time', type=float, default=600); ap.add_argument('--hint'); ap.add_argument('--workers', type=int, default=4)
a = ap.parse_args()
base = load(a.base)
m, x, z, changes, factors, WORK = build(base, flex=a.flex, fmax=a.fmax)
Q = quality_terms(m, x, base, WORK)
if a.min_wk is not None: m.Add(Q['wk'] >= a.min_wk)
if a.max_gap is not None: m.Add(Q['gap'] <= a.max_gap)
if a.max_iso is not None: m.Add(Q['iso'] <= a.max_iso)
if a.max_heavy is not None: m.Add(Q['heavy'] <= a.max_heavy)
if a.min_one is not None: m.Add(Q['one'] >= a.min_one)
m.Minimize(changes)
if a.hint:
    h = load(a.hint)
    for (k, d, v), var in x.items(): m.AddHint(var, 1 if h[k][d] == v else 0)
s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = a.time; s.parameters.num_workers = a.workers
t0 = time.time(); r = s.Solve(m)
res = {'status': s.StatusName(r), 'time': round(time.time() - t0), 'bound': s.BestObjectiveBound(), 'floors': {k: v for k, v in vars(a).items() if k.startswith(('min_', 'max_')) and v is not None}}
if r in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    res.update({'changes': int(s.Value(changes)), 'factors': [f for f, v in z.items() if s.Value(v)], 'wk': s.Value(Q['wk']), 'gap': s.Value(Q['gap']),
                'iso': s.Value(Q['iso']), 'heavy': s.Value(Q['heavy']), 'one': s.Value(Q['one'])})
    json.dump({'patterns': extract(s, x, WORK, base)}, open(a.out, 'w'), indent=1)
print(json.dumps(res))
