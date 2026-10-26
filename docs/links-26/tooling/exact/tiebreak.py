# AMONG THE REPAIRS WITH THE FEWEST CHANGES, THE ONE THAT IS BEST TO WORK — decided stage by stage, each stage's best
# value held while the next is optimised (the order the 24-line Just Enough and All Clear were chosen in, brought to what
# the 26-line sheets and the weighted league measure):
#   wk     the most full weekends off (Saturday of a line and Sunday of the next both rest days)
#   gap    the shortest longest wait between full weekends, in weeks
#   iso    the fewest single rest days (a rest day with a duty or a cover day on both sides)
#   heavy  the lightest heaviest week, Monday to Saturday
#   one    the most working weeks on one turn (one clock time Monday to Friday, earlies or lates all week)
#   size   the smallest changes: how far each changed start and finish moves, a rest day <-> duty counted as the duty
#   changes the fewest changed cells (under <max changes>)
#   fit    the closest fit to the trains (fit_terms' stand-in; needs --hold-fit)
#   python tiebreak.py <base.json> <start.json> <out.json> <max changes> [--flex] [--fmax 0] [--stages wk,gap,iso,heavy,one,size] [--time 300]
#                      [--min-wk N] [--max-gap N] [--max-iso N] [--max-heavy MINUTES] [--min-one N] [--min-e14 N]
#                      [--hold-fit <grid.json> [--hold-fit-each]] [--max-late N] [--max-six N] [--min-rest MINUTES] [--max-new N]
# The floors hold a design's existing figures while one is improved (Fair Enough's polish, 26 Oct 2026: more weeks on one
# turn, with its weekends, rest days and heaviest week held where they were). --min-e14 holds the early finishes: earlies
# (starting before 11:00) that finish before 14:00, Monday to Saturday, counted in the rotation as the sheets count them.
# --hold-fit-each holds weekday, Saturday and Sunday separately: a better weekend fit can otherwise pay for a worse weekday.
# The rest hold what a short early is paid for with (inside the 35 hours, a short shift is bought with a long one):
# --max-late duties finishing at 23:00 or later, any day; --max-six lines with six duties or more, Sunday included;
# --min-rest the shortest rest between two duties; --max-new shift times that are not in today's link. Each is counted in
# the rotation as the sheets count it (plain.mjs personal(), report-data.mjs assess()).
# Every value printed is the best found in the time given; a stage says PROVEN only when the solver closed its bound.
import sys, json, time, argparse
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from model import *
ap = argparse.ArgumentParser()
ap.add_argument('base'); ap.add_argument('start'); ap.add_argument('out'); ap.add_argument('cmax', type=int)
ap.add_argument('--flex', action='store_true'); ap.add_argument('--fmax', type=int, default=0)
ap.add_argument('--stages', default='wk,gap,iso,heavy,one,size'); ap.add_argument('--time', type=float, default=300)
for f in ('min-wk', 'max-gap', 'max-iso', 'max-heavy', 'min-one'): ap.add_argument('--' + f, type=int)
ap.add_argument('--workers', type=int, default=4)
# --hold-fit <grid.json>: follow the trains no worse than that grid does (fit_terms' stand-in, in total over weekday,
# Saturday and Sunday, as the league averages them); also enables the 'fit' stage
ap.add_argument('--hold-fit'); ap.add_argument('--hold-fit-each', action='store_true'); ap.add_argument('--min-e14', type=int)
for f in ('max-late', 'max-six', 'min-rest', 'max-new'): ap.add_argument('--' + f, type=int)
a = ap.parse_args()
base = load(a.base); start = load(a.start)
m, x, z, changes, factors, WORK = build(base, flex=a.flex, fmax=a.fmax, cmax=a.cmax)
Q = quality_terms(m, x, base, WORK)
if a.min_wk is not None: m.Add(Q['wk'] >= a.min_wk)
if a.max_gap is not None: m.Add(Q['gap'] <= a.max_gap)
if a.max_iso is not None: m.Add(Q['iso'] <= a.max_iso)
if a.max_heavy is not None: m.Add(Q['heavy'] <= a.max_heavy)
if a.min_one is not None: m.Add(Q['one'] >= a.min_one)
if a.min_e14 is not None:
    m.Add(sum(var for (k, d, v), var in x.items() if d != 'sun' and v != 'RD' and st(v) < 660 and en(v) < 840) >= a.min_e14)
timed = lambda v: v != 'RD'
if a.max_late is not None:
    m.Add(sum(var for (k, d, v), var in x.items() if timed(v) and en(v) >= 23 * 60) <= a.max_late)
if a.max_six is not None:
    six = []
    for k in WORK:
        b = m.NewBoolVar(f'six{k}'); m.Add(2 * b >= sum(1 - x[k, d, 'RD'] for d in DAYS) - 5); six.append(b)
    m.Add(sum(six) <= a.max_six)
if a.min_rest is not None:
    # the 12-hour rule's own form (model.py), at a longer threshold: no pair of consecutive duties closer than this.
    # Consecutive runs line by line, Sunday to Saturday, then on to the next line's Sunday; cover weeks hold no duty.
    V = {}
    for (k, d, v) in x: V.setdefault((k, d), []).append(v)
    seq = [(str(k), d) for k in range(1, LINES + 1) for d in DAYS]
    for i, p1 in enumerate(seq):
        p2 = seq[(i + 1) % len(seq)]
        if p1 not in V or p2 not in V: continue
        for v in filter(timed, V[p1]):
            bad = [w for w in V[p2] if timed(w) and (1440 - en(v)) + st(w) < a.min_rest]
            if bad: m.Add(x[p1 + (v,)] + sum(x[p2 + (w,)] for w in bad) <= 1)
if a.max_new is not None:
    new = {}
    for (k, d, v), var in x.items():
        if timed(v) and v not in TODAY:
            if v not in new: new[v] = m.NewBoolVar('new' + v)
            m.AddImplication(var, new[v])
    m.Add(sum(new.values()) <= a.max_new)
if a.hold_fit:
    REF, FITMAX, DEV = fit_reference(load(a.hold_fit)); FT = fit_terms(m, x, WORK, REF); m.Add(FT['fit'] <= FITMAX); Q['fit'] = FT['fit']
    # each class's deviation per unit of cover no worse than the grid's: FT[c] / C <= DEV[c] / REF[c], cross-multiplied
    if a.hold_fit_each:
        for c in DEV: m.Add(FT[c] * REF[c] <= DEV[c] * FT[c + '_C'])
OBJ = {'fit': (Q.get('fit'), 'min'), 'wk': (Q['wk'], 'max'), 'gap': (Q['gap'], 'min'), 'iso': (Q['iso'], 'min'), 'heavy': (Q['heavy'], 'min'), 'one': (Q['one'], 'max'), 'size': (Q['size'], 'min'), 'changes': (changes, 'min')}
hint = start
for name in a.stages.split(','):
    expr, sense = OBJ[name]
    m.ClearHints()
    for (k, d, v), var in x.items(): m.AddHint(var, 1 if hint[k][d] == v else 0)
    (m.Maximize if sense == 'max' else m.Minimize)(expr)
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = a.time; s.parameters.num_workers = a.workers
    t0 = time.time(); r = s.Solve(m)
    if r not in (cp_model.OPTIMAL, cp_model.FEASIBLE): print(json.dumps({'stage': name, 'status': s.StatusName(r)})); break
    val = int(round(s.ObjectiveValue()))
    hint = extract(s, x, WORK, base)
    print(json.dumps({'stage': name, 'value': val, 'bound': s.BestObjectiveBound(), 'proven': r == cp_model.OPTIMAL, 'time': round(time.time() - t0),
                      'changes': int(s.Value(changes)), 'factors': [f for f, v in z.items() if s.Value(v)]}), flush=True)
    m.Add(expr >= val) if sense == 'max' else m.Add(expr <= val)
json.dump({'patterns': hint}, open(a.out, 'w'), indent=1)
