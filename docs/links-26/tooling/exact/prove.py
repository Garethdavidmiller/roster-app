# CLOSING THE GAP: is there a repair with fewer changes than the best one found? (owner, 26 Oct 2026: "run the solver
# longer to try to prove 45 is the true minimum"). The same model and objective as fewest.py, started from the best grid
# found (a hint, so the search begins with its value as the incumbent), with the solver's workers given to RAISING THE
# LOWER BOUND — core-guided search, which raises a "fewest changes" bound one unsatisfiable set of kept cells at a time,
# and the LP-heavy and bound-search workers — rather than to looking for new grids.
#   python prove.py <base.json> <best.json> <out.json> [--flex] [--fmax 0] [--time S] [--subsolvers a,b,c,d] [--log FILE]
# Prints the status, the best value and the bound every few minutes and at the end: OPTIMAL means no repair with fewer
# changes exists; a FEASIBLE end means the bound printed is the fewest the solver could rule out.
import sys, json, time, argparse
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from model import *
ap = argparse.ArgumentParser()
ap.add_argument('base'); ap.add_argument('best'); ap.add_argument('out')
ap.add_argument('--flex', action='store_true'); ap.add_argument('--fmax', type=int, default=0)
ap.add_argument('--time', type=float, default=3600); ap.add_argument('--workers', type=int, default=4)
ap.add_argument('--subsolvers', default='core,max_lp,objective_lb_search,default_lp'); ap.add_argument('--log')
a = ap.parse_args()
base = load(a.base); best = load(a.best)
m, x, z, changes, factors, WORK = build(base, flex=a.flex, fmax=a.fmax)
m.Minimize(changes)
for (k, d, v), var in x.items(): m.AddHint(var, 1 if best[k][d] == v else 0)
s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = a.time; s.parameters.num_workers = a.workers
if a.subsolvers: s.parameters.subsolvers.extend(a.subsolvers.split(','))
if a.log:
    s.parameters.log_search_progress = True; s.parameters.log_to_stdout = False
    f = open(a.log, 'w'); s.log_callback = lambda line: (f.write(line + '\n'), f.flush())
class Progress(cp_model.CpSolverSolutionCallback):
    def __init__(self): super().__init__(); self.t0 = time.time()
    def on_solution_callback(self):
        print(json.dumps({'at': round(time.time() - self.t0), 'found': int(self.ObjectiveValue()), 'bound': self.BestObjectiveBound()}), flush=True)
t0 = time.time(); r = s.Solve(m, Progress())
res = {'status': s.StatusName(r), 'time': round(time.time() - t0), 'best': s.ObjectiveValue() if r in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None, 'bound': s.BestObjectiveBound()}
if r in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    json.dump({'patterns': extract(s, x, WORK, base)}, open(a.out, 'w'), indent=1)
print(json.dumps(res), flush=True)
