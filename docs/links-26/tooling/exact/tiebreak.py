# AMONG THE REPAIRS WITH THE FEWEST CHANGES, THE ONE THAT IS BEST TO WORK — decided stage by stage, each stage's best
# value held while the next is optimised (the order the 24-line Just Enough and All Clear were chosen in, brought to what
# the 26-line sheets and the weighted league measure):
#   wk     the most full weekends off (Saturday of a line and Sunday of the next both rest days)
#   gap    the shortest longest wait between full weekends, in weeks
#   iso    the fewest single rest days (a rest day with a duty or a cover day on both sides)
#   heavy  the lightest heaviest week, Monday to Saturday
#   one    the most working weeks on one turn (one clock time Monday to Friday, earlies or lates all week)
#   size   the smallest changes: how far each changed start and finish moves, a rest day <-> duty counted as the duty
#   python tiebreak.py <base.json> <start.json> <out.json> <max changes> [--flex] [--fmax 0] [--stages wk,gap,iso,heavy,one,size] [--time 300]
# Every value printed is the best found in the time given; a stage says PROVEN only when the solver closed its bound.
import sys, json, time, argparse
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from model import *
ap = argparse.ArgumentParser()
ap.add_argument('base'); ap.add_argument('start'); ap.add_argument('out'); ap.add_argument('cmax', type=int)
ap.add_argument('--flex', action='store_true'); ap.add_argument('--fmax', type=int, default=0)
ap.add_argument('--stages', default='wk,gap,iso,heavy,one,size'); ap.add_argument('--time', type=float, default=300)
a = ap.parse_args()
base = load(a.base); start = load(a.start)
m, x, z, changes, factors, WORK = build(base, flex=a.flex, fmax=a.fmax, cmax=a.cmax)
Q = quality_terms(m, x, base, WORK)
OBJ = {'wk': (Q['wk'], 'max'), 'gap': (Q['gap'], 'min'), 'iso': (Q['iso'], 'min'), 'heavy': (Q['heavy'], 'min'), 'one': (Q['one'], 'max'), 'size': (Q['size'], 'min')}
hint = start
for name in a.stages.split(','):
    expr, sense = OBJ[name]
    m.ClearHints()
    for (k, d, v), var in x.items(): m.AddHint(var, 1 if hint[k][d] == v else 0)
    (m.Maximize if sense == 'max' else m.Minimize)(expr)
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = a.time; s.parameters.num_workers = 4
    t0 = time.time(); r = s.Solve(m)
    if r not in (cp_model.OPTIMAL, cp_model.FEASIBLE): print(json.dumps({'stage': name, 'status': s.StatusName(r)})); break
    val = int(round(s.ObjectiveValue()))
    hint = extract(s, x, WORK, base)
    print(json.dumps({'stage': name, 'value': val, 'bound': s.BestObjectiveBound(), 'proven': r == cp_model.OPTIMAL, 'time': round(time.time() - t0),
                      'changes': int(s.Value(changes)), 'factors': [f for f, v in z.items() if s.Value(v)]}), flush=True)
    m.Add(expr >= val) if sense == 'max' else m.Add(expr <= val)
json.dump({'patterns': hint}, open(a.out, 'w'), indent=1)
