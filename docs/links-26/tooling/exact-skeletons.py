"""exact-floor.py's model (structural + family rules, fixed run ≤ RUN, GAP 5; needs `pip install pulp`) turned into a generator: each solve must hit
SINGLES single rest days, ties broken by fewest family changes round the wheel, and after each solution a no-good cut
forces the next layout to differ in at least DIFF cells. Writes skeleton JSON that skeleton-start.mjs accepts.
  [FOUR=14] python3 exact-skeletons.py RUN SINGLES COUNT DIFF outdir   (Short Run: 5 4 6 10 — its skeleton was the second, results/skeleton-run5.json)"""
import sys, json, pulp
RUN, SINGLES, COUNT, DIFF, OUTDIR = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
GAP = 5
L, COVER = 26, {1, 6, 11, 16, 21}; WORK = [k for k in range(1, L + 1) if k not in COVER]
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; ON = {'sun': 10, 'mon': 15, 'tue': 15, 'wed': 15, 'thu': 15, 'fri': 15, 'sat': 14}
EARLY = {'sun': 5, 'mon': 7, 'tue': 7, 'wed': 7, 'thu': 7, 'fri': 7, 'sat': 7}
m = pulp.LpProblem('gen', pulp.LpMinimize)
on = {(k, d): pulp.LpVariable(f'on_{k}_{d}', cat='Binary') for k in WORK for d in DAYS}
cell = lambda k, d: on[(k, d)] if k in WORK else 1
for d in DAYS: m += pulp.lpSum(on[(k, d)] for k in WORK) == ON[d]
for k in WORK: m += pulp.lpSum(on[(k, d)] for d in DAYS) >= 4; m += pulp.lpSum(on[(k, d)] for d in DAYS) <= 5
seq = [(k, d) for k in range(1, L + 1) for d in DAYS]; n = len(seq)
s = {i: pulp.LpVariable(f's_{i}', cat='Binary') for i in range(n) if seq[i][0] in WORK}
for i, v in s.items():
    k, d = seq[i]; p, q = seq[(i - 1) % n], seq[(i + 1) % n]
    m += v >= (1 - on[(k, d)]) + cell(*p) + cell(*q) - 2
for i in range(n):
    win = [seq[(i + j) % n] for j in range(RUN + 1)]
    if all(k in WORK for k, _ in win): m += pulp.lpSum(on[c] for c in win) <= RUN
for c in COVER:
    prev, nxt = (L if c == 1 else c - 1), (1 if c == L else c + 1)
    if prev in WORK: m += on[(prev, 'thu')] + on[(prev, 'fri')] + on[(prev, 'sat')] <= 2
    if nxt in WORK: m += on[(nxt, 'sun')] + on[(nxt, 'mon')] + on[(nxt, 'tue')] <= 2
w = {}
for k in range(1, L + 1):
    nk = k % L + 1
    if k in WORK and nk in WORK:
        w[k] = pulp.LpVariable(f'w_{k}', cat='Binary'); m += w[k] <= 1 - on[(k, 'sat')]; m += w[k] <= 1 - on[(nk, 'sun')]; m += w[k] >= 1 - on[(k, 'sat')] - on[(nk, 'sun')]
m += pulp.lpSum(w.values()) == 7
for k in range(1, L + 1): m += pulp.lpSum(w[j] for j in [(k + t - 1) % L + 1 for t in range(GAP)] if j in w) >= 1
f = {k: pulp.LpVariable(f'f_{k}', cat='Binary') for k in WORK}
y = {(k, d): pulp.LpVariable(f'y_{k}_{d}', cat='Binary') for k in WORK for d in DAYS}
for (k, d), v in y.items(): m += v <= on[(k, d)]; m += v <= f[k]; m += v >= on[(k, d)] + f[k] - 1
for d in DAYS: m += pulp.lpSum(y[(k, d)] for k in WORK) == EARLY[d]
zs = []
for k in WORK:
    nk = k % L + 1
    if nk in WORK:
        z = pulp.LpVariable(f'z_{k}', cat='Binary'); m += z >= f[k] - f[nk]; m += z >= f[nk] - f[k]
        m += on[(k, 'sat')] + on[(nk, 'sun')] <= 2 - z; zs.append(z)
for i, v in s.items():
    pk, pd = seq[(i - 1) % n]
    if pk in WORK and pd != 'sun': m += v + y[(pk, pd)] <= 1
m += pulp.lpSum(y[((L if c == 1 else c - 1), 'sat')] for c in COVER if (L if c == 1 else c - 1) in WORK) <= 2
m += pulp.lpSum(s.values()) <= SINGLES
FOUR = int(__import__('os').environ.get('FOUR', '0'))   # FOUR=14: four full weeks off (28 days from a Sunday) for at most 14 days' leave,
if FOUR:                                                   # somewhere in the wheel (the 14-day-leave search, 3 Oct 2026)
    b = {}
    for k in range(1, L + 1):
        wks = [(k + t - 1) % L + 1 for t in range(4)]
        c = pulp.lpSum((on[(j, d)] if j in WORK else 0) for j in wks for d in DAYS if d != 'sun') + 4 * sum(1 for j in wks if j in COVER)
        b[k] = pulp.LpVariable(f'b_{k}', cat='Binary'); m += c <= FOUR + 24 * (1 - b[k])
    m += pulp.lpSum(b.values()) >= 1
m += pulp.lpSum(s.values()) + 0.01 * pulp.lpSum(zs)   # the floor objective solves in minutes; minimising family changes alone timed out
for t in range(1, COUNT + 1):
    t0 = __import__('time').time(); m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=1500)); took = __import__('time').time() - t0
    st = pulp.LpStatus[m.status] + ('' if took < 1495 else ' (time limit — a layout found, not proven fewest)')
    if st != 'Optimal': print(f'solution {t}: {st} — stopping'); break
    singles = sum(int(round(v.value())) for v in s.values())
    if singles > SINGLES: print(f'solution {t}: {singles} single rest days — stopping'); break
    O = {str(k): {d: int(round(on[(k, d)].value())) for d in DAYS} for k in WORK}
    F = {str(k): ('E' if round(f[k].value()) == 1 else 'L') for k in WORK}
    json.dump({'on': O, 'fam': F, 'm': {'source': 'floor-dump', 'run': RUN, 'singles': SINGLES, 'chg': int(round(pulp.value(m.objective)))}}, open(f'{OUTDIR}/skel-{t}.json', 'w'))
    print(f'solution {t}: family changes {int(round(pulp.value(m.objective)))} → skel-{t}.json', flush=True)
    ones = [v for v in on.values() if round(v.value()) == 1]; zeros = [v for v in on.values() if round(v.value()) == 0]
    m += pulp.lpSum(1 - v for v in ones) + pulp.lpSum(zeros) >= DIFF
print('DUMP-DONE')
