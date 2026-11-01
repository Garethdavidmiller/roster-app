# HOLDS model.py TO THE SHEETS' OWN CODE. For each test grid the model is pinned to that grid and asked, one rule at a
# time, whether the grid passes — and, with no rules on, for the fewest fatigue factors it will admit. Every answer must
# equal judge.mjs's (the JS that prints the sheets), both ways round: a model stricter than the judge would make a
# "fewest changes" claim too high, a looser one would let through a grid the sheet rejects.
#   python check_model.py <base.json> <solution.json> [grids per source]
# Test grids: random edits of the base (mostly failing) and of a solution that meets every rule (mostly passing).
import os, sys, json, random, subprocess, tempfile
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import *

PARTS = ['open', 'close', 'at22', 'sunday', 'times', 'sunlen', 'contract', 'ceiling', 'rest', 'run']

def feasible(base, grid, parts, flex=False, minimise_factors=False):
    m, x, z, ch, fa, W = build(base, parts=set(parts), flex=flex)
    for k in W:
        for d in DAYS:
            if (k, d, grid[k][d]) not in x: return False, None   # a value the rule forbids outright (a 9h05 Sunday)
            m.Add(x[k, d, grid[k][d]] == 1)
    if minimise_factors: m.Minimize(fa)
    s = cp_model.CpSolver(); s.parameters.num_workers = 1; s.parameters.max_time_in_seconds = 120
    r = s.Solve(m); ok = r in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    return ok, ({f: s.Value(v) for f, v in z.items()} if ok and minimise_factors else None)

def check(args):
    base, grid, J = args; bad = []
    ok, zf = feasible(base, grid, [], minimise_factors=True)
    for f in FACTORS:
        if bool(zf[f]) != J['factors'][f]: bad.append(f'factor {f}: model {zf[f]} judge {J["factors"][f]}')
    expect = {'open': J['rules']['open'], 'close': J['rules']['close'], 'at22': J['rules']['at22'], 'sunday': J['rules']['sunday'],
              'times': J['rules']['times'], 'sunlen': J['rules']['sunlen'], 'contract': J['hard']['monsat'] == CONTRACT,
              'ceiling': J['hard']['duties'] <= MAX_DUTIES, 'rest': J['hard']['turnarounds'] == 0, 'run': J['hard']['run'] <= 13}
    seen = {}
    for part, exp in expect.items():
        got = feasible(base, grid, [part])[0]; seen[part] = exp
        if got != exp: bad.append(f'{part}: model {got} judge {exp}')
    exp = J['rules']['office']; got = feasible(base, grid, ['office'])[0]; seen['office'] = exp
    if got != exp: bad.append(f'office: model {got} judge {exp}')
    exp = bool(J['rules']['office'] and J['rules']['floor'] and J['rules']['handover']); got = feasible(base, grid, ['office', 'floorhand'])[0]; seen['floorhand'] = exp
    if got != exp: bad.append(f'floorhand: model {got} judge {exp} (floor {J["rules"]["floor"]} handover {J["rules"]["handover"]})')
    exp = bool(J['flex']['saturday'] and J['flex']['closer']); got = feasible(base, grid, [], flex=True)[0]; seen['flex'] = exp
    if got != exp: bad.append(f'flex: model {got} judge {exp}')
    return bad, seen, {f: J['factors'][f] for f in FACTORS}

def edits(src, base, n, rnd, lo, hi):
    SP = spare_lines(base); W = [k for k in base if int(k) not in SP]; U = universe(base)
    def dom(d):
        c = cls(d); return [s for s in U if st(s) >= OPEN[c] and en(s) <= CLOSE[c]] + ['RD']
    out = []
    for _ in range(n):
        g = json.loads(json.dumps(src))
        for _ in range(rnd.randint(lo, hi)):
            k = rnd.choice(W); d = rnd.choice(DAYS); g[k][d] = rnd.choice(dom(d))
        out.append(g)
    return out

def targeted(sol, base, rnd):
    """Grids that push the rules random edits rarely reach: Sunday short, runs of 12 to 16 days, backward weeks."""
    SP = spare_lines(base); W = [k for k in base if int(k) not in SP]; out = []
    g = json.loads(json.dumps(sol)); sun = [k for k in W if g[k]['sun'] != 'RD']
    for k in sun[:max(1, len(sun) - 9)]: g[k]['sun'] = 'RD'
    out.append(g)                                                     # nine on a Sunday
    seq = [(k, d) for k in [str(i) for i in range(1, LINES + 1)] for d in DAYS]
    for L in (12, 13, 14, 15, 16):                                    # a run of L worked days, by filling rest days
        for _ in range(2):
            g = json.loads(json.dumps(sol)); i0 = rnd.randrange(len(seq)); idx = [seq[(i0 + t) % len(seq)] for t in range(L)]
            if any(int(k) in SP for k, d in idx): continue
            for k, d in idx:
                if g[k][d] == 'RD': g[k][d] = '08:00-16:30' if d != 'sun' else '08:30-16:30'
            out.append(g)
    for n in (2, 4, 8):                                               # weeks that step backwards through the week
        g = json.loads(json.dumps(sol))
        for k in rnd.sample(W, n):
            for d, v in zip(WD, ['14:00-22:30', '12:00-20:00', '11:00-19:30', '08:00-16:30', '06:20-14:20']): g[k][d] = v
        out.append(g)
    return out

if __name__ == '__main__':
    base = load(sys.argv[1]); sol = load(sys.argv[2]); n = int(sys.argv[3]) if len(sys.argv) > 3 else 16
    rnd = random.Random(26)
    grids = [base, sol] + edits(base, base, n, rnd, 1, 8) + edits(sol, base, n, rnd, 1, 3) + edits(sol, base, n // 2, rnd, 4, 10) + targeted(sol, base, rnd)
    for extra in sys.argv[4:]:                                        # further solutions: themselves, and edits of them
        e = load(extra); grids += [e] + edits(e, base, n // 2, rnd, 1, 3) + targeted(e, base, rnd)
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f: json.dump(grids, f)
    J = json.loads(subprocess.check_output(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'judge.mjs'), f.name]))
    os.unlink(f.name)
    with Pool(4) as pool: res = pool.map(check, [(base, g, j) for g, j in zip(grids, J)])
    nbad = 0; both = {}
    for i, (bad, seen, fac) in enumerate(res):
        for b in bad: print(f'grid {i}: {b}'); nbad += 1
        for k, v in list(seen.items()) + list(fac.items()): both.setdefault(k, set()).add(v)
    print(f'{len(grids)} grids, {nbad} mismatches')
    print('seen both ways:', sorted(k for k, v in both.items() if len(v) == 2), '· only one way:', {k: sorted(v) for k, v in both.items() if len(v) < 2})
