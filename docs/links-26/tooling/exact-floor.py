"""EXACT floor on single rest days for the 26-line rest-day layout (3 Oct 2026; needs `pip install pulp`, which brings CBC). Shift times set aside; the structural rules only,
which is the easier problem: a layout that cannot reach N single rest days under these cannot reach it with the family and
fatigue rules added. Column counts are the table's (15 on a weekday, 14 Saturday, 10 Sunday), rows 4 or 5 duties, 7 full
weekends never more than GAP apart, no run over 6 with a cover week's four duties placed as badly as they can be (so no
more than 2 worked days into or out of a cover week), and the fixed run capped at FIXED_RUN.  [FOUR=14] [LIMIT=600] python3 exact-floor.py [GAP] [FIXED_RUN] [fam]   (`fam` adds the family rules: pure weeks, early counts, a rest day at every change, FF8b singles, the cover-week Saturday)
"""
import sys, pulp
GAP = int(sys.argv[1]) if len(sys.argv) > 1 else 5; FIXED_RUN = int(sys.argv[2]) if len(sys.argv) > 2 else 6
FAM = len(sys.argv) > 3 and sys.argv[3] == "fam"   # add the family rules: every line all-early or all-late, early counts, joins, FF8b singles, the cover-week Saturday
L, COVER = 26, {1, 6, 11, 16, 21}; WORK = [k for k in range(1, L + 1) if k not in COVER]
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; ON = {'sun': 10, 'mon': 15, 'tue': 15, 'wed': 15, 'thu': 15, 'fri': 15, 'sat': 14}
m = pulp.LpProblem('singles', pulp.LpMinimize)
on = {(k, d): pulp.LpVariable(f'on_{k}_{d}', cat='Binary') for k in WORK for d in DAYS}
cell = lambda k, d: on[(k, d)] if k in WORK else 1          # a cover week is worked, for runs and singles alike
for d in DAYS: m += pulp.lpSum(on[(k, d)] for k in WORK) == ON[d]
for k in WORK: m += pulp.lpSum(on[(k, d)] for d in DAYS) >= 4; m += pulp.lpSum(on[(k, d)] for d in DAYS) <= 5
seq = [(k, d) for k in range(1, L + 1) for d in DAYS]; n = len(seq)
# singles: a rest day with a worked day either side (a cover week counts as worked)
s = {i: pulp.LpVariable(f's_{i}', cat='Binary') for i in range(n) if seq[i][0] in WORK}
for i, v in s.items():
    k, d = seq[i]; p, q = seq[(i - 1) % n], seq[(i + 1) % n]
    m += v >= (1 - on[(k, d)]) + cell(*p) + cell(*q) - 2
# runs: in any FIXED_RUN+1 consecutive cells with no cover cell, at most FIXED_RUN worked; across a cover week, at most 2 into it and 2 out of it
for i in range(n):
    win = [seq[(i + j) % n] for j in range(FIXED_RUN + 1)]
    if all(k in WORK for k, _ in win): m += pulp.lpSum(on[c] for c in win) <= FIXED_RUN
for c in COVER:
    prev, nxt = (L if c == 1 else c - 1), (1 if c == L else c + 1)
    if prev in WORK: m += on[(prev, 'thu')] + on[(prev, 'fri')] + on[(prev, 'sat')] <= 2          # 4 + 3 would be 7
    if nxt in WORK: m += on[(nxt, 'sun')] + on[(nxt, 'mon')] + on[(nxt, 'tue')] <= 2
    # and a cover week's four duties beside a run of 2 make 6, which is the limit; the two above keep it there
# weekends: w_k = Saturday of k off AND Sunday of k+1 off; exactly 7; every window of GAP consecutive k holds one
w = {}
for k in range(1, L + 1):
    nk = k % L + 1
    if k in WORK and nk in WORK:
        w[k] = pulp.LpVariable(f'w_{k}', cat='Binary'); m += w[k] <= 1 - on[(k, 'sat')]; m += w[k] <= 1 - on[(nk, 'sun')]; m += w[k] >= 1 - on[(k, 'sat')] - on[(nk, 'sun')]
m += pulp.lpSum(w.values()) == 7
for k in range(1, L + 1): m += pulp.lpSum(w[j] for j in [(k + t - 1) % L + 1 for t in range(GAP)] if j in w) >= 1
if FAM:
    EARLY = {'sun': 5, 'mon': 7, 'tue': 7, 'wed': 7, 'thu': 7, 'fri': 7, 'sat': 7}
    f = {k: pulp.LpVariable(f'f_{k}', cat='Binary') for k in WORK}                      # 1 = an early line
    y = {(k, d): pulp.LpVariable(f'y_{k}_{d}', cat='Binary') for k in WORK for d in DAYS}   # worked AND early
    for (k, d), v in y.items(): m += v <= on[(k, d)]; m += v <= f[k]; m += v >= on[(k, d)] + f[k] - 1
    for d in DAYS: m += pulp.lpSum(y[(k, d)] for k in WORK) == EARLY[d]
    for k in WORK:                                                                        # a rest day at every change of family
        nk = k % L + 1
        if nk in WORK:
            z = pulp.LpVariable(f'z_{k}', cat='Binary'); m += z >= f[k] - f[nk]; m += z >= f[nk] - f[k]
            m += on[(k, 'sat')] + on[(nk, 'sun')] <= 2 - z
    for i, v in s.items():                                                                # FF8b: no single rest day after an early weekday or Saturday
        pk, pd = seq[(i - 1) % n]
        if pk in WORK and pd != 'sun': m += v + y[(pk, pd)] <= 1
    m += pulp.lpSum(y[((L if c == 1 else c - 1), 'sat')] for c in COVER if (L if c == 1 else c - 1) in WORK) <= 2   # two 08:00s a Saturday
FOUR = int(__import__('os').environ.get('FOUR', '0'))   # FOUR=14: somewhere in the wheel, four full weeks off (28 days from a Sunday) for at most 14 days' leave
if FOUR:
    b = {}
    for k in range(1, L + 1):
        wks = [(k + t - 1) % L + 1 for t in range(4)]
        c = pulp.lpSum((on[(j, d)] if j in WORK else 0) for j in wks for d in DAYS if d != 'sun') + 4 * sum(1 for j in wks if j in COVER)
        b[k] = pulp.LpVariable(f'b_{k}', cat='Binary'); m += c <= FOUR + 24 * (1 - b[k])
    m += pulp.lpSum(b.values()) >= 1
m += pulp.lpSum(s.values())
LIMIT = int(__import__('os').environ.get('LIMIT', '600')); t0 = __import__('time').time()
m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=LIMIT)); took = __import__('time').time() - t0
# CBC can report "Optimal" for the best layout it had when the clock ran out: say which it was
proof = 'proven' if took < LIMIT - 5 else f'the fewest found in {LIMIT}s — NOT proven'
print(f'{"FOUR WEEKS ≤ " + str(FOUR) + " days · " if FOUR else ""}GAP {GAP} · fixed run ≤{FIXED_RUN}{" · pure weeks + family rules" if FAM else ""}: {pulp.LpStatus[m.status]} — minimum single rest days = {int(round(pulp.value(m.objective)))} ({proof})')
