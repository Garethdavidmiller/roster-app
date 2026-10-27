# THE FEWEST CELL CHANGES THAT MAKE A 26-LINE DESIGN MEET THE RULES (26 Oct 2026, owner: "How would you improve this
# roster to meet the rules. Deep think it" — of Little and Often, the 26-week Word roster).
#
# An exact CP-SAT model, ported from the 24-line one (../../../links-24/tooling/exact/model.py, which found Just Enough
# and All Clear) and brought to the 26-line rules (../../RULES.md):
#   hard     12 hours' rest, 13 days in a row (a cover week as four duties at the worst place), the contract exactly
#            (44,100 Monday-to-Saturday minutes) and the 219-day ceiling (at most 89 Monday-to-Saturday duties);
#   December the nine staffing rules, read exactly as report-data.mjs's sheetRules reads them for a proposal;
#   flexible fourteen on a Saturday and every weekday closer at 15:45 (flex=True); the cover weeks stay where the
#            design has them, so the cover-spread rule is whatever the design already scores.
# Fatigue is counted per factor exactly as links-fatigue.js counts it at the worst cover placement, plus the 55-hour row
# at its worst (h55Worst in report-data.mjs). check_model.py holds the encoding to the JS judge (judge.mjs) both ways.
#
# A cell is CHANGED when it differs from the base design; a base time no longer allowed on its day (a 9h05 Sunday) is a
# change whatever the solver picks. The shift times a repair may use are common.universe(): the design's own, today's,
# the plan's office pairs and 15:45 closer, and the shortlisted designs'.
import sys, json, time
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from common import *
from ortools.sat.python import cp_model

DECEMBER = {'open', 'close', 'at22', 'sunday', 'office', 'floorhand', 'sunlen', 'times'}
HARD = {'contract', 'ceiling', 'rest', 'run'}
ALLPARTS = DECEMBER | HARD
FACTORS = ['FF8b', 'FF11', 'FF15', 'MRSF12', 'MRSF55', 'MRSF8h', 'FF17', 'FF19', 'H55W']

def build(base, parts=ALLPARTS, flex=False, fmax=None, cmax=None, fix=None, forbid=(), uni=None, tmax=18, keep=None):
    SP = spare_lines(base); UNI = uni or universe(base)
    def dom(d):
        c = cls(d); return [s for s in UNI if st(s) >= OPEN[c] and en(s) <= CLOSE[c] and (c != 'sun' or 'sunlen' not in parts or 480 <= dur(s) <= 540)]
    m = cp_model.CpModel()
    LINESK = [str(k) for k in range(1, LINES + 1)]
    WORK = [k for k in LINESK if int(k) not in SP]
    VALS = {d: dom(d) + ['RD'] for d in DAYS}
    x = {}
    for k in WORK:
        for d in DAYS:
            for v in VALS[d]: x[k, d, v] = m.NewBoolVar(f'x{k}{d}{v}')
            m.AddExactlyOne(x[k, d, v] for v in VALS[d])
    POS = [(k, d) for k in LINESK for d in DAYS]; N = len(POS)
    spare = lambda i: int(POS[i][0]) in SP
    def lin(i, f):
        k, d = POS[i]; return sum(x[k, d, v] for v in VALS[d] if v != 'RD' and f(v))
    def R(i): k, d = POS[i]; return x[k, d, 'RD']
    W = lambda i: 1 if spare(i) else 1 - R(i)
    E = lambda i: 0 if spare(i) else lin(i, EARLY)
    H8 = lambda i: lin(i, lambda v: dur(v) >= 480)
    D = lambda i: 0 if spare(i) else sum(dur(v) * x[POS[i][0], POS[i][1], v] for v in VALS[POS[i][1]] if v != 'RD')
    cnt = lambda d, f: sum(x[k, d, v] for k in WORK for v in VALS[d] if v != 'RD' and f(v))
    cntv = lambda d, v: sum(x[k, d, v] for k in WORK) if v in VALS[d] else 0
    # ── the December rules (report-data.mjs currentRules / sheetRules) ─────────────────────────────────────────────
    for d in DAYS:
        c = cls(d)
        if 'open' in parts: m.Add(cnt(d, lambda v: st(v) <= OPEN[c] < en(v)) >= 4)
        if 'close' in parts: m.Add(cnt(d, lambda v: st(v) < CLOSE[c] <= en(v)) >= 3)
        if 'at22' in parts: m.Add(cnt(d, lambda v: st(v) <= 1320 < en(v)) >= 5)
    if 'sunday' in parts: m.Add(cnt('sun', lambda v: True) >= 10)
    if flex: m.Add(cnt('sat', lambda v: True) >= 14)
    for d in WD:
        if 'office' in parts: m.Add(cntv(d, '06:20-14:20') >= 2); m.Add(cntv(d, '14:00-22:30') >= 2)
        if flex:
            for v in dom(d):
                if en(v) == 1435 and v != '15:45-23:55': m.Add(cntv(d, v) == 0)
    if flex: m.Add(sum(cnt(d, lambda v: en(v) == 1435) for d in WD) >= 1)
    if 'office' in parts: m.Add(cntv('sat', '06:20-14:50') >= 2); m.Add(cntv('sat', '14:30-22:00') >= 2)
    # Sunday's pairs, selected exactly as rosteredPairs does: the 07:15 early with the LATEST end among those rostered
    # twice, the 22:30 late with the EARLIEST start among those rostered twice
    SE = sorted([v for v in dom('sun') if st(v) == 435], key=lambda v: -en(v))
    SL = sorted([v for v in dom('sun') if en(v) == 1350], key=lambda v: st(v))
    g = {}
    for v in SE + SL:
        g[v] = m.NewBoolVar('g' + v); m.Add(cntv('sun', v) >= 2).OnlyEnforceIf(g[v]); m.Add(cntv('sun', v) <= 1).OnlyEnforceIf(g[v].Not())
    def selectors(L):
        sel = {}
        for i, v in enumerate(L):
            s = m.NewBoolVar('sel' + v); sel[v] = s
            m.AddBoolAnd([g[v]] + [g[u].Not() for u in L[:i]]).OnlyEnforceIf(s)
            m.AddBoolOr([g[v].Not()] + [g[u] for u in L[:i]]).OnlyEnforceIf(s.Not())
        if 'office' in parts or 'floorhand' in parts: m.AddExactlyOne(sel.values())
        return sel
    selE = selectors(SE); selL = selectors(SL)
    m._selE, m._selL = selE, selL   # Sunday's office pair, for fit_terms()
    used = {}
    for d in DAYS:
        for v in dom(d):
            u = m.NewBoolVar(f'u{d}{v}'); used[d, v] = u
            m.Add(cntv(d, v) >= 1).OnlyEnforceIf(u); m.Add(cntv(d, v) == 0).OnlyEnforceIf(u.Not())
    # the floor (at least two at every moment, the office out, its helpers back in) and the handovers, per day and,
    # on a Sunday, per possible office pair
    for d in (DAYS if 'floorhand' in parts else []):
        c = cls(d)
        m.Add(cnt(d, lambda v: en(v) == CLOSE[c]) >= 1)
        combos = [((PAIRS_FIXED[c][0], PAIRS_FIXED[c][1]), [])] if c != 'sun' else [((e, l), [selE[e], selL[l]]) for e in SE for l in SL]
        for (pe, pl), enf in combos:
            if c == 'sun' and en(pe) - max(st(pl), 900) < 30:   # the Sunday office handover: 30 minutes from 15:00
                m.AddBoolOr([v.Not() for v in enf]); continue
            hp = []
            for t in (pe, pl):
                if st(t) == OPEN[c]:
                    e2 = min(en(t), 540 if c == 'sun' else 480)
                    if e2 > st(t): hp.append((st(t), e2))
                elif c != 'sun' and en(t) > 1170: hp.append((max(st(t), 1170), en(t)))
                elif c == 'sun':
                    if st(t) < 900: hp += [(st(t), 900), (st(t), 900)]
                    hp.append((max(st(t), 1080), en(t)))
            ticks = sorted({OPEN[c]} | {t for v in dom(d) for t in (st(v), en(v)) if OPEN[c] <= t < CLOSE[c]} | {t for h in hp for t in h if OPEN[c] <= t < CLOSE[c]})
            for tk in ticks:
                cov = cnt(d, lambda v: st(v) <= tk < en(v)) - 2 * (st(pe) <= tk < en(pe)) - 2 * (st(pl) <= tk < en(pl)) + sum(1 for h in hp if h[0] <= tk < h[1])
                ct = m.Add(cov >= 2)
                if enf: ct.OnlyEnforceIf(enf)
            for cv in [v for v in dom(d) if en(v) == CLOSE[c]]:
                Q = lambda v: st(v) < st(cv) and en(v) >= st(cv) + 15
                ct = m.Add(cnt(d, Q) - 2 * Q(pe) - 2 * Q(pl) >= 1); ct.OnlyEnforceIf([used[d, cv]] + enf)
                if c == 'sun':
                    for t in [v for v in dom(d) if st(v) == OPEN['sun'] and en(v) < st(cv) + 15]:
                        ct = m.Add(cntv(d, t) <= (2 if t == pe else 0)); ct.OnlyEnforceIf([used[d, cv]] + enf)
    # no more shift times than today's 18, across the working lines and every day
    tu = {}
    for v in UNI:
        tu[v] = m.NewBoolVar('t' + v)
        for k in WORK:
            for d in DAYS:
                if (k, d, v) in x: m.AddImplication(x[k, d, v], tu[v])
    if 'times' in parts: m.Add(sum(tu.values()) <= tmax)
    # ── hard ───────────────────────────────────────────────────────────────────────────────────────────────────────
    if 'contract' in parts: m.Add(sum(D(i) for i in range(N) if POS[i][1] != 'sun') == CONTRACT)
    if 'ceiling' in parts: m.Add(sum(W(i) for i in range(N) if POS[i][1] != 'sun' and not spare(i)) <= MAX_DUTIES)
    def adj_pairs():
        for i in range(N):
            j = (i + 1) % N
            if not spare(i) and not spare(j): yield i, j
    for i, j in adj_pairs():
        (k1, d1), (k2, d2) = POS[i], POS[j]
        for v in dom(d1):
            bad = [w for w in dom(d2) if (1440 - en(v)) + st(w) < 720]
            if bad and 'rest' in parts: m.Add(x[k1, d1, v] + sum(x[k2, d2, w] for w in bad) <= 1)
    before = [i for i in range(N) if not spare(i) and spare((i + 1) % N)]   # the Saturday before a cover week
    after = [i for i in range(N) if not spare(i) and spare((i - 1) % N)]    # the Sunday after one
    def pure_windows(L):
        for i in range(N):
            idx = [(i + t) % N for t in range(L)]
            if not any(spare(q) for q in idx): yield idx
    if 'run' in parts:
        for idx in pure_windows(14): m.Add(sum(W(q) for q in idx) <= 13)
        for b in before: m.Add(sum(W((b - t) % N) for t in range(10)) <= 9)
        for a in after: m.Add(sum(W((a + t) % N) for t in range(10)) <= 9)
    # ── the fatigue factors, at the worst cover placement (links-fatigue.js assessFatigue) ────────────────────────
    z = {f: m.NewBoolVar(f) for f in FACTORS}
    for idx in pure_windows(5): m.Add(sum(E(q) for q in idx) - 4 <= z['FF15'])
    for b in before: m.Add(E(b) <= z['FF15'])
    for idx in pure_windows(8): m.Add(sum(H8(q) for q in idx) - 7 <= z['MRSF8h'])
    for b in before: m.Add(sum(H8((b - t) % N) for t in range(4)) - 3 <= z['MRSF8h'])
    for a in after: m.Add(sum(H8((a + t) % N) for t in range(4)) - 3 <= z['MRSF8h'])
    for idx in pure_windows(13): m.Add(sum(W(q) for q in idx) - 12 <= z['MRSF12'])
    for b in before: m.Add(sum(W((b - t) % N) for t in range(9)) - 8 <= z['MRSF12'])
    for a in after: m.Add(sum(W((a + t) % N) for t in range(9)) - 8 <= z['MRSF12'])
    for i in range(N):
        win = [(i + t) % N for t in range(7)]
        m.Add(sum(D(q) for q in win) - 3300 <= 3000 * z['MRSF55'])
        # THE 55-HOUR ROW AT ITS WORST: each cover week filled with four 8-hour duties as one block starting Sun, Mon,
        # Tue or Wed (cover-placement.mjs BLOCK_PLACEMENTS); a window touches at most one cover week here
        # (h55Worst's `hi`, so a week with no cover day in it counts here as well as in MRSF55 — the check found that)
        sp = [q for q in win if spare(q)]
        worst = 0
        if sp:
            line = POS[sp[0]][0]; first = LINESK.index(line) * 7
            worst = max(sum(1 for q in win if spare(q) and s0 <= q - first < s0 + 4) for s0 in range(4))
        m.Add(sum(D(q) for q in win) + 480 * worst - 3300 <= 3000 * z['H55W'])
    for i in range(N):
        a, b, c1, c2 = (i - 1) % N, i, (i + 1) % N, (i + 2) % N
        if spare(a) or spare(b): continue
        q = m.NewBoolVar(f'q{i}')
        if spare(c1) or spare(c2): m.Add(q == 0)
        else: m.Add(q <= R(c1)); m.Add(q <= R(c2))
        m.Add(E(a) + E(b) - E(c1) - q - 1 <= z['FF8b'])
    comp = []
    for k in LINESK:
        if int(k) in SP: comp += [('S', None)] * 4
        else: comp += [('C', (k, d)) for d in DAYS]
    M = len(comp)
    sh = lambda t: 1 if comp[t][0] == 'S' else 1 - x[comp[t][1][0], comp[t][1][1], 'RD']
    brk = []
    for t in range(M):
        u = (t + 1) % M
        if comp[t][0] == 'S' or comp[u][0] == 'S': brk.append(0); continue
        bb = m.NewBoolVar(f'b{t}'); m.Add(bb <= x[comp[t][1][0], comp[t][1][1], 'RD']); m.Add(bb <= x[comp[u][1][0], comp[u][1][1], 'RD']); brk.append(bb)
    for i in range(M):
        for L in range(14, 28):
            idx = [(i + t) % M for t in range(L)]
            m.Add(sum(sh(t) for t in idx) - 13 <= L * z['FF11'] + L * sum(brk[t] for t in idx[:-1]))
    bw = []; fw = []
    for i, j in adj_pairs():
        (k1, d1), (k2, d2) = POS[i], POS[j]
        b = m.NewBoolVar(f'bw{i}'); f = m.NewBoolVar(f'fw{i}'); bw.append(b); fw.append(f)
        m.Add(f <= 1 - x[k1, d1, 'RD'])
        for v in dom(d1):
            jump = [w for w in dom(d2) if abs(st(w) - st(v)) > 120]
            if jump: m.Add(x[k1, d1, v] + sum(x[k2, d2, w] for w in jump) <= 1 + z['FF19'])
            earlier = [w for w in dom(d2) if st(w) < st(v)]
            if earlier: m.Add(b >= x[k1, d1, v] + sum(x[k2, d2, w] for w in earlier) - 1)
            m.Add(f <= 1 - x[k1, d1, v] + sum(x[k2, d2, w] for w in dom(d2) if st(w) > st(v)))
    m.Add(sum(bw) - sum(fw) <= 400 * z['FF17'])
    # ── objectives ─────────────────────────────────────────────────────────────────────────────────────────────────
    changes = sum((1 - x[k, d, base[k][d]]) if (k, d, base[k][d]) in x else 1 for k in WORK for d in DAYS)
    factors = sum(z.values())
    if fmax is not None: m.Add(factors <= fmax)
    if cmax is not None: m.Add(changes <= cmax)
    for f in forbid: m.Add(z[f] == 0)
    if fix:
        for (k, d), v in fix.items(): m.Add(x[k, d, v] == 1)
    if keep:   # cells that may not change (k, d)
        for (k, d) in keep:
            if (k, d, base[k][d]) in x: m.Add(x[k, d, base[k][d]] == 1)
    return m, x, z, changes, factors, WORK

def quality_terms(m, x, base, WORK):
    """What makes a repair good to work, as solver expressions: full weekends off, the longest wait between them, single
    rest days, the heaviest Monday-to-Saturday week, weeks on one turn and the size of the changes (tiebreak.py, quality.py)."""
    SP = spare_lines(base); LK = [str(k) for k in range(1, LINES + 1)]
    R = lambda k, d: x[k, d, 'RD'] if int(k) not in SP else 0
    VALS = {}
    for (k, d, v) in x: VALS.setdefault((k, d), []).append(v)
    # full weekends: Saturday of line k and Sunday of the line after both rest days (a cover day is not one)
    wk = []
    for i, k in enumerate(LK):
        k2 = LK[(i + 1) % LINES]
        if int(k) in SP or int(k2) in SP: wk.append(0); continue
        w = m.NewBoolVar(f'wk{k}'); m.Add(w <= R(k, 'sat')); m.Add(w <= R(k2, 'sun')); m.Add(w >= R(k, 'sat') + R(k2, 'sun') - 1); wk.append(w)
    # single rest days, round the whole wheel (feel() in report-data.mjs)
    seq = [(k, d) for k in LK for d in DAYS]; N = len(seq); iso = []
    for i, (k, d) in enumerate(seq):
        if int(k) in SP: continue
        (kp, dp), (kn, dn) = seq[(i - 1) % N], seq[(i + 1) % N]
        v = m.NewBoolVar(f'iso{i}'); m.Add(v >= R(k, d) - R(kp, dp) - R(kn, dn)); iso.append(v)
    # the heaviest Monday-to-Saturday week
    H = m.NewIntVar(0, 7 * 600, 'H')
    for k in WORK: m.Add(H >= sum(dur(v) * x[k, d, v] for d in DAYS if d != 'sun' for v in VALS[k, d] if v != 'RD'))
    # weeks on one turn
    EFAM = lambda v: st(v) < 660
    one = []
    for k in WORK:
        ys = {}
        for v in VALS[k, 'mon']:
            if v == 'RD': continue
            y = m.NewBoolVar(f'y{k}{v}'); ys[v] = y
            for d in WD:
                m.Add(sum(x[k, d, u] for u in VALS[k, d] if u not in ('RD', v)) <= 1 - y)
            for d in DAYS:
                m.Add(sum(x[k, d, u] for u in VALS[k, d] if u != 'RD' and EFAM(u) != EFAM(v)) <= 1 - y)
        o = m.NewBoolVar(f'one{k}'); m.Add(o <= sum(ys.values())); m.Add(sum(ys.values()) <= 1); one.append(o)
    # the size of the changes
    def cost(k, d, v):
        b = base[k][d]
        if v == b: return 0
        if b == 'RD': return dur(v)
        if v == 'RD': return dur(b)
        return abs(st(v) - st(b)) + abs(en(v) - en(b))
    size = sum(cost(k, d, v) * var for (k, d, v), var in x.items())
    gapv = m.NewIntVar(1, LINES + 1, 'gap')   # LINES + 1: no full weekend anywhere
    # the longest wait between full weekends is at most gapv: every gapv consecutive line boundaries hold a weekend
    for g in range(1, LINES + 1):
        ok = m.NewBoolVar(f'gap{g}'); m.Add(gapv <= g).OnlyEnforceIf(ok); m.Add(gapv > g).OnlyEnforceIf(ok.Not())
        for i in range(LINES):
            m.Add(sum(wk[(i + t) % LINES] for t in range(g)) >= 1).OnlyEnforceIf(ok)
    return {'wk': sum(wk), 'gap': gapv, 'iso': sum(iso), 'heavy': H, 'one': sum(one), 'size': size}

# THE FIT TO THE TRAINS, as a linear stand-in the solver can hold (26 Oct 2026). The sheets' measure
# (report-data.mjs dayFit on officeSplit's floor cover) is the squared distance between each hour's share of the trains
# and its share of the floor cover, x10^4 — not linear, because the cover's share divides by its own total. This is the
# same comparison in absolute terms: for each hour, |trains_h x cover - all trains x cover_h|, summed, with the office
# taken out exactly as officeSplit takes it (its pairs, less the helpers on the floor at the quiet ends; on a Sunday the
# pair the design rosters). Weekday = the five weekdays' cover summed (the sheets fit the average weekday). Each class is
# scaled by its trains and a reference cover so the three weigh alike, as the league's (weekday + Sat + Sun) / 3 does.
# A stand-in, not the measure: every grid it helps choose is re-judged by the sheets' own code.
DEMAND = {'wk': {6: 53, 7: 107, 8: 127, 9: 122, 10: 95, 11: 85, 12: 75, 13: 84, 14: 79, 15: 87, 16: 105, 17: 140, 18: 138, 19: 107, 20: 90, 21: 73, 22: 75, 23: 55},
          'sat': {6: 24, 7: 58, 8: 75, 9: 81, 10: 92, 11: 88, 12: 77, 13: 64, 14: 68, 15: 72, 16: 84, 17: 82, 18: 67, 19: 64, 20: 79, 21: 78, 22: 62, 23: 36},
          'sun': {7: 15, 8: 45, 9: 65, 10: 71, 11: 74, 12: 71, 13: 61, 14: 55, 15: 64, 16: 69, 17: 78, 18: 73, 19: 75, 20: 52, 21: 71, 22: 65, 23: 26}}   # links-demand.js DEC_2026_MOVEMENTS, carriages per hour inside the staffed window
def mm(a, b, h):
    """Minutes of [a, b) inside hour h (a day's end clipped at midnight, as minuteCover clips it)."""
    return max(0, min(b, 1440, (h + 1) * 60) - max(a, h * 60))
def office_minutes(c, h, sel=None):
    """The office's minutes in hour h, less its helpers on the floor (officeSplit / officeHelpers, plan model)."""
    if c == 'wk':
        return 2 * mm(380, 860, h) + 2 * mm(840, 1350, h) - mm(380, 480, h) - mm(1170, 1350, h)
    if c == 'sat':
        return 2 * mm(380, 890, h) + 2 * mm(870, 1320, h) - mm(380, 480, h) - mm(1170, 1320, h)
    selE, selL = sel
    out = 0
    for e, var in selE.items():
        out += var * (2 * mm(st(e), en(e), h) - mm(st(e), min(en(e), 540), h))
    for l, var in selL.items():
        k = 2 * mm(st(l), en(l), h) - mm(max(st(l), 1080), en(l), h) - (2 * mm(st(l), 900, h) if st(l) < 900 else 0)
        out += var * k
    return out
def fit_terms(m, x, WORK, ref=None):
    """Per class, sum over the hours of |trains_h * C - trains * cover_h|, and a weighted total ('fit') to minimise."""
    days = {'wk': WD, 'sat': ['sat'], 'sun': ['sun']}
    out = {}
    for c, ds in days.items():
        q = DEMAND[c]; Q = sum(q.values())
        cov = {h: sum(var * mm(st(v), en(v), h) for (k, d, v), var in x.items() if d in ds and v != 'RD')
                  - sum(office_minutes(c, h, (m._selE, m._selL) if c == 'sun' else None) for _ in ds) for h in q}
        C = sum(cov.values())
        dev = []
        for h in q:
            e = m.NewIntVar(0, 10 ** 9, f'fit{c}{h}'); m.Add(e >= q[h] * C - Q * cov[h]); m.Add(e >= Q * cov[h] - q[h] * C); dev.append(e)
        out[c] = sum(dev); out[c + '_C'] = C
        out[c + '_scale'] = Q * ((ref or {}).get(c) or (40000 if c == 'wk' else 6000 if c == 'sat' else 4500))
    out['fit'] = sum(out[c] * int(round(10 ** 10 / out[c + '_scale'])) for c in days)
    return out

def grid_cover(p, c):
    """A fixed grid's hourly floor cover for class c, and its total — the numbers fit_terms() builds as solver terms."""
    from collections import Counter
    days = {'wk': WD, 'sat': ['sat'], 'sun': ['sun']}[c]; q = DEMAND[c]
    sel = None
    if c == 'sun':
        cnt = Counter(p[k]['sun'] for k in p if p[k]['sun'] not in ('RD', 'SPARE'))
        e = sorted([t for t in cnt if st(t) == 435 and cnt[t] >= 2], key=lambda t: -en(t))
        l = sorted([t for t in cnt if en(t) == 1350 and cnt[t] >= 2], key=lambda t: st(t))
        sel = ({e[0]: 1} if e else {}, {l[0]: 1} if l else {})
    cov = {h: sum(mm(st(v), en(v), h) for k in p for d in days for v in [p[k][d]] if v not in ('RD', 'SPARE')) - len(days) * office_minutes(c, h, sel) for h in q}
    return cov, sum(cov.values())
def fit_reference(p):
    """The per-class cover totals of a reference grid (fit_terms' scales), that grid's weighted fit, and its per-class
    deviation (fit_terms' out[c] for that grid) — so a hold can say "each of weekday, Saturday and Sunday no worse"."""
    ref, dev = {}, {}
    for c in ('wk', 'sat', 'sun'):
        q = DEMAND[c]; Q = sum(q.values()); cov, C = grid_cover(p, c)
        ref[c] = C; dev[c] = sum(abs(q[h] * C - Q * cov[h]) for h in q)
    return ref, sum(dev[c] * int(round(10 ** 10 / (sum(DEMAND[c].values()) * ref[c]))) for c in ref), dev

def extract(solver, x, WORK, base):
    p = {k: (dict(base[k]) if k in WORK else {d: 'SPARE' for d in DAYS}) for k in base}
    for (k, d, v), var in x.items():
        if solver.Value(var): p[k][d] = v
    return p
