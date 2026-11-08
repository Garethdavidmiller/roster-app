# THE SHORTLIST'S PRESENTATIONS (8 Nov 2026, owner: "Write proposals for the shortlist, audit them against existing proposals,
# then aesthetic polish and aesthetic consistency check"). The shortlist drawn that day — Balanced V6, Level Crossing and
# Middle Ground, A to Z (fresh.mjs: SHORTLIST), for the design target of closing weeks kept apart — had no presentations, so
# the zip carried none. These are its six: a colleague deck and a managers' deck for each.
#
# HOW. Each is Common Ground's FINISHED deck (built by common-ground-decks.py on 5 Nov 2026, polished, marked, reviewed and
# shipped), rewritten for the design: the layout, the slide order, the wording that holds of every 26-line design, and the
# checks behind it come with it. All three new designs share most of what Common Ground's decks say about the 26-line link —
# the 35-hour week, 218.6 days a year, 15 · 14 · 10 on duty, 42 finishes a year at 23:00 or later and 94 at 22:00 or later,
# 28 Saturdays and 20 Sundays a year, five cover weeks, today's leave — and each of those is CHECKED equal before Common
# Ground's sentence is kept. What differs is rewritten from the grids and deck-check.mjs --print: Middle Ground is Common
# Ground's own duties and rest days laid in new weeks, so little moves beyond the weeks; Level Crossing is Crossover's duties
# on Short Openers' rest days; Balanced V6 is Balanced V5's weeks with a 15-minute handover, and most of its figures differ.
#
# WHAT THE OWNER ASKED THE DECKS TO SHOW. The design target (8 Nov 2026): "no consecutive closing weeks, with changes between
# early and late duties placed around useful rest breaks … Weeks on one time is still Important". So the short version, the
# rest slide and the managers' "Why" slide say the closing weeks are never side by side, cover weeks aside. An outside
# review the owner passed on the same day, "only use this as advice", is followed where it is about presenting: the rules are
# shown as gates (met or not), fatigue warnings separately from everything else, each design's main cost beside its gain, and
# no league position or lead anywhere — the decks, like the pack, recommend nothing (owner, 5 Nov 2026).
#
# THE GUARDS. Every sentence kept from Common Ground's deck has the figures it quotes checked equal; every claim written here
# is checked against the grids before it is written; Common Ground's text that is not true of the design is refused at the
# end (CG_ONLY), as is a sentence naming another design with an ordinary space (the rename turns "Common Ground" into the
# design's name, so a deliberate mention is written with a no-break space). Then deck-marks.py's marking, so every green or
# amber figure carries its ✓ or ▲.
#
# Run from anywhere; a name builds that design's pair only:
#   python3 docs/links-26/tooling/shortlist-decks.py ["Balanced V6"] && node docs/links-26/tooling/deck-check.mjs
# then export the PDFs beside them (LibreOffice):
#   soffice --headless --convert-to pdf --outdir docs/links-26/presentations docs/links-26/presentations/<Name>-for-*.pptx
# Slide 10's picture is rota-strip.mjs's, which launches Chromium through Playwright.
import html, importlib.util, json, os, re, shutil, struct, subprocess, sys, tempfile, zipfile
import openpyxl

TOOL = os.path.dirname(os.path.abspath(__file__))
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(TOOL, name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
snd, dp, dm = load('second-nature-decks'), load('deck-polish'), load('deck-marks')
Slide, notes, escape, runs_of, spans = snd.Slide, snd.notes, snd.escape, snd.runs_of, snd.spans
GREEN, NAVY, AMBER = snd.GREEN, snd.NAVY, snd.AMBER
put, set_shape, shape_of = dp.put, dp.set_shape, dp.shape_of
DAYS, WK, _len, _timed, WORDS, H, first, upto = dp.DAYS, dp.DAYS[1:6], dp._len, dp._timed, dp.WORDS, dp.H, dp.first, dp.upto
NUMW = WORDS + 'eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen'.split()

OUT = os.path.join(TOOL, '..', 'presentations')
BASE = 'Common Ground'                       # the finished decks every new one starts from
SHORT = dp.SHORTLIST
if BASE in SHORT: raise SystemExit(f'shortlist-decks: written for a shortlist without {BASE}, whose decks are the source; it is {SHORT}')
if len(SHORT) != 3: raise SystemExit(f'shortlist-decks: the decks speak of "all three" and "the other two"; the shortlist is {SHORT}')
FIG, T = dp.FIG, dp.T
B = FIG[BASE]
(BCODE, BFP) = dp.IDS[BASE]
NB = lambda n: n.replace(' ', '\u00a0')      # a deliberate mention of a design: the rename leaves it alone
andl = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]
hm = lambda m: f'{m // 60}h {m % 60:02d}m'
dash = lambda t: t.replace('-', '–')
joined = lambda t: re.sub(r'(\d\d:\d\d–)(?=\d)', '\\1\u2060', t)   # deck-polish's word joiner: a time never splits at its dash
early = lambda s: int(s[:2]) < 11
mins_of = lambda hhmm: int(hhmm[:2]) * 60 + int(hhmm[3:])

def find_grid(name):
    code = dp.IDS[name][0]
    for d in ('proposals', '30-days-off', '30-days-off/balanced'):
        f = os.path.join('..', d, f'{name.replace(" ", "-")}-{code}.json')
        if os.path.exists(os.path.join(TOOL, f)): return f
    raise SystemExit(f'shortlist-decks: no grid for {name}')
grid = lambda f: (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, f), encoding='utf-8')))
TP, PB = dp.TODAY_P, grid(find_grid(BASE))
times = lambda p, days=DAYS: {p[k][d] for k in p for d in days if _timed(p[k][d])}
per_day = lambda p, t, days: {sum(1 for k in p if p[k][d] == t) for d in days}
days_of = lambda p, t: {d for k in p for d in DAYS if p[k][d] == t}
singles = lambda p: dp.rest_lens(p).count(1)
year = lambda n, p: round(n * 52 / len(p))
cover_days = lambda p: round(4 * sum(all(p[k][d] == 'SPARE' for d in DAYS) for k in p) * 52 / len(p))
closers = lambda p, days: sorted({p[k][d] for k in p for d in days if _timed(p[k][d]) and p[k][d][6:] in ('23:55', '23:25')})
long_breaks = lambda p: year(sum(1 for n in dp.rest_lens(p) if n > 2), p)
six_days = lambda p: sum(1 for k in p if sum(1 for d in DAYS if _timed(p[k][d])) >= 6)
opens = lambda p, days: [sum(1 for k in p if _timed(p[k][d]) and p[k][d][:5] == '06:20') for d in days]
tn = lambda f: tuple(int(v) for v in re.fullmatch(r'(\d+) \((\d+) you know\)', f['times']).groups()) if 'you know' in f['times'] else (int(f['times']), None)
TT = times(TP)
TODAY_CLOSER = {'Weekdays': closers(TP, WK), 'Saturday': closers(TP, ['sat']), 'Sunday': closers(TP, ['sun'])}
if any(len(v) != 1 for v in TODAY_CLOSER.values()): raise SystemExit(f'today has one closer a day, by kind of day: {TODAY_CLOSER}')
LATER = {15: '15 minutes', 30: '30 minutes', 45: '45 minutes', 60: 'an hour'}

# THE CLOSING WEEKS, AS THE SHORTLIST SHEET READS THEM (shortlist-sheet.mjs): a week whose most common Monday-to-Friday duty
# finishes at the 23:55 close; two are side by side when next to each other in the rotation, lapping it; a cover week is
# neither. The second reading, three or more weekday closes, must agree
def main_duty(row):
    c = {}
    for d in WK:
        if _timed(row[d]): c[row[d]] = c.get(row[d], 0) + 1
    return max(c.items(), key=lambda kv: (kv[1], -WK.index(next(d for d in WK if row[d] == kv[0]))))[0] if c else ''
def side_by_side(p, test):
    ks = sorted(p, key=int)
    return any(test(main_duty(p[k])) and test(main_duty(p[ks[(i + 1) % len(ks)]])) for i, k in enumerate(ks))
closing = lambda t: t.endswith('-23:55')
opening = lambda t: t.startswith('06:20')
closes3 = lambda row: sum(1 for d in WK if str(row[d]).endswith('-23:55')) >= 3
side3 = lambda p: (lambda ks: any(closes3(p[k]) and closes3(p[ks[(i + 1) % len(ks)]]) for i, k in enumerate(ks)))(sorted(p, key=int))

def check(what, ok):
    if not ok: raise SystemExit(f'shortlist-decks ({NAME}): the slides say {what}, and the rota does not')
def same(what, *keys):
    """A sentence or row kept as Common Ground's deck has it: the figures it quotes must be this design's too."""
    bad = [f'{k} {B[k]!r} against {F[k]!r}' for k in keys if B[k] != F[k]]
    if bad: raise SystemExit(f'shortlist-decks ({NAME}): "{what}" is kept from {BASE}’s deck and its figures differ: {", ".join(bad)}')
def cell(s, i, old, new, color):
    """A table cell by its shape index, refused unless it holds `old`."""
    if runs_of(s.x[slice(*spans(s.x)[i])]) != [escape(old)]: raise SystemExit(f'{s.path} shape {i}: expected {old!r}, found {runs_of(s.x[slice(*spans(s.x)[i])])}')
    set_shape(s, i, new, color)
def note_text(d, n):
    x = open(f'{d}/ppt/notesSlides/notesSlide{n}.xml', encoding='utf-8').read()
    return html.unescape(sorted(runs_of(x), key=len)[-1])
def swap_in(d, n, old, new):
    p = f'{d}/ppt/notesSlides/notesSlide{n}.xml'; x = open(p, encoding='utf-8').read()
    if x.count(escape(old)) != 1: raise SystemExit(f'{p}: {old[:70]!r} found {x.count(escape(old))} times, not once')
    open(p, 'w', encoding='utf-8').write(x.replace(escape(old), escape(new)))
def unmark(d):
    """Common Ground's figures carry deck-marks.py's ✓ and ▲; they come off here so the cells read as the figures they are,
    and go back on at the end, judged afresh from each cell's colour."""
    for f in os.listdir(f'{d}/ppt/slides'):
        if not f.endswith('.xml'): continue
        p = f'{d}/ppt/slides/{f}'; x = open(p, encoding='utf-8').read()
        y = re.sub(r'<a:t>[✓▲]\u00a0', '<a:t>', x)
        if y != x: open(p, 'w', encoding='utf-8').write(y)
def mixed_of(p):
    """Weeks mixing earlies and lates, read as deck-polish.py's grid_facts and rota-strip.mjs read them: every day of the week."""
    kinds = [{early(p[k][d]) for d in DAYS if _timed(p[k][d])} for k in p if not all(p[k][d] == 'SPARE' for d in DAYS)]
    return sum(1 for f in kinds if len(f) == 2)
def switches(p):
    """Changes between an early and a late from one worked day to the next, round the rotation, a year per person."""
    w = [p[k][d] for k in sorted(p, key=int) for d in DAYS if _timed(p[k][d])]
    return sum(1 for a, b in zip(w, w[1:] + w[:1]) if early(a) != early(b)) * 52 / len(p)
tone = lambda new, today, lower_is_better=True: (GREEN if (new < today) == lower_is_better and new != today else AMBER if new != today else NAVY)

# ── the pay slide's sums: common-ground-decks.py's formula, unchanged ────────────────────────────────────────────────────
PAY = dp.PAY
def pay(p, f, name):
    sat_t, sat_p, sun_t, sun_p = dp.day_hours(TP, 'sat'), dp.day_hours(p, 'sat'), dp.day_hours(TP, 'sun'), dp.day_hours(p, 'sun')
    prem_sat, prem_sun = (PAY['sat'] - 1) * (sat_p - sat_t), PAY['sun'] * (sun_p - sun_t)
    pounds = round(-(prem_sat + prem_sun) * PAY['rate'] / 50) * 50
    ps, pu = round(prem_sat, 1), round(-prem_sun, 1)
    check(f'the Saturdays add less than the Sundays take away on {name}', prem_sat > 0 and prem_sun < -prem_sat and pounds >= 50)
    ot = lambda g: int(g['swapShortMins']) / 60 * PAY['ot']
    pot = lambda g: round(ot(g) * PAY['rate'] / 10) * 10
    mean = lambda g: (lambda m: f'a late is on average {m} minutes {"longer" if g["swap"].endswith("longer") else "shorter"} than an early on the same day')(int(g['swap'].split()[0]))
    longer = f['swap'].endswith('longer')
    swaps = (f'Swaps are left out of the £{pounds}. Today {mean(T)}, Monday to Saturday, so swapping an early for a late usually adds time, paid as overtime at time and a quarter. '
             f'The swaps that add most are the shortest earlies, the ones that finish at 13:35 or 13:45, which are the only earlies to finish before 14:00 (slide 13): about {T["shortYear"]} a year each today. Swapping every one of them for that day’s longest late adds about {T["swapShort"]} a year, roughly £{pot(T)} gross. '
             f'On {name} {mean(f)}' + ((', and there are about ' if longer else ', but there are still about ') + f'{f["shortYear"]} of those short earlies a year each, so the same swaps add about {f["swapShort"]}, roughly £{pot(f)}.' if int(f['shortYear']) else ', and there are none of those short earlies, so those particular swaps add nothing.')
             + ' Other swaps may still add paid time wherever the late is the longer duty. Each figure is the most those particular swaps could make: it needs a partner for every swap, and assumes the extra time is paid as overtime at time and a quarter (“Overtime 1.25” on a payslip).')
    text = (f'Basic pay follows the 35-hour week, which does not change. What moves is the premium and overtime pay. Every figure here is for 52 weeks, which is exactly two turns of the 26, so on this link they are everyone’s, whichever line you start on; today’s, on 20 weeks, are averages. '
            f'Saturdays in the contract are paid at time and a quarter, and each person is rostered about {f["sat"]} a year instead of {T["sat"]} — about {round(sat_p - sat_t)} more Saturday hours, worth {ps:.1f} hours’ pay. '
            f'Sundays stay overtime, paid at time and a half: {f["sundayPeople"]} a week shared among {f["people"]} people instead of {T["sundayPeople"]} among {T["people"]}, so about {f["sun"]} each a year against {T["sun"]}, and a little shorter — about {round(sun_p)} Sunday hours a year each against {round(sun_t)}, worth {pu:.1f} hours’ pay less. '
            f'Together, someone who works their full share of Sundays gets {pu - ps:.1f} hours’ pay less a year: roughly £{pounds} gross, before tax, at the CEA rate of £{PAY["rate"]:.2f}. That estimate assumes the rate, a full share of the Sunday overtime and the fixed duties only — anything later given in a cover week is left out. '
            f'Someone who works no Sunday overtime is {ps:.1f} hours’ pay better off. How much Sunday overtime each person works is up to them, as now. ' + swaps + ' None of this is a payslip; the Pay Calculator in the app does that.')
    return pounds, text

# ── the design ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def setup(name):
    global NAME, CODE, FP, GRIDF, P, F, PEERS, O, OP, NEW, KNOWN, CL, CUT
    NAME = name
    if NAME not in SHORT: raise SystemExit(f'shortlist-decks: {NAME} is not on the shortlist {SHORT}')
    CODE, FP = dp.IDS[NAME]; GRIDF = find_grid(NAME); P = grid(GRIDF); F = FIG[NAME]
    PEERS = [n for n in SHORT if n != NAME]; O = {n: FIG[n] for n in PEERS}; OP = {n: grid(find_grid(n)) for n in PEERS}
    NEW, KNOWN = sorted(times(P) - TT), sorted(times(P) & TT)
    check(f'{F["times"]} shift times', tn(F) == (len(times(P)), len(KNOWN)))
    CL = {'Weekdays': closers(P, WK), 'Saturday': closers(P, ['sat']), 'Sunday': closers(P, ['sun'])}
    CUT = {k: sorted({_len(TODAY_CLOSER[k][0]) - _len(c) for c in v}) for k, v in CL.items()}
    check('every closing shift shorter than today’s', all(c > 0 for v in CUT.values() for c in v))
    # what every design here shares with Common Ground, checked once: the sentences that quote them are kept
    same('the contract, the days, the staffing, the late finishes, the Saturdays and Sundays, the leave',
         'hours', 'daysWeek', 'daysYear', 'daily', 'dailyWk', 'dailyWeekend', 'close', 'floor', 'floorMin', 'late23', 'late22', 'sat', 'sun',
         'sundayPeople', 'people', 'cover', 'met', 'leaveBest', 'leaveFour', 'avg', 'earlyYear', 'lateYear', 'closerWk', 'closerSun')
    check('no two closing weeks side by side, cover weeks aside, on both readings', not side_by_side(P, closing) and not side3(P))
    check('the other two shortlisted designs keep their closing weeks apart too', all(not side_by_side(g, closing) for g in OP.values()))

def lo_hi_cut():
    allc = sorted({c for v in CUT.values() for c in v}); return allc[0], allc[-1]
def cut_words():
    """"the weekday closer by 30 minutes, the Saturday closers by 15 or 30 minutes and the Sunday closer by 45 minutes" """
    parts = []
    for k, label in (('Weekdays', 'weekday'), ('Saturday', 'Saturday'), ('Sunday', 'Sunday')):
        cs = CUT[k]; many = len(CL[k]) > 1
        parts.append(f'the {label} closer{"s" if many else ""} by ' + ' or '.join(LATER[c].replace(' minutes', '') if j < len(cs) - 1 else LATER[c] for j, c in enumerate(cs)))
    return andl(parts)
def longest_sentence(today_clause=True):
    m = max(_len(t) for t in times(P))
    if m == 510: return 'No shift on any day is longer than 8h 30m, Sunday included' + (f', where today the Saturday closer is {T["closerSat"]}.' if today_clause else '.')
    (lt,) = [t for t in times(P) if _len(t) == m]
    check(f'the one longest shift a Sunday {dash(lt)}, of {hm(m)}', m == 540 and days_of(P, lt) == {'sun'})
    return f'No shift is longer than 9 hours: the longest is the Sunday {dash(lt)}' + (f', where today the Saturday closer is {T["closerSat"]}.' if today_clause else '.')
def leave_rel():
    avg = 'the same' if F['leaveAvg'] == T['leaveAvg'] else 'about the same' if abs(float(F['leaveAvg']) - float(T['leaveAvg'])) < 0.15 else None
    worst = {0: 'the same', 1: 'a day better'}.get(int(F['leaveWorst']) - int(T['leaveWorst']))
    check('the leave’s average and worst stretch as the slides say them', avg and worst)
    if avg == worst == 'the same': return 'the average and the worst are the same'
    return f'the average is {avg} and the worst {worst}'
def opens_sentence():
    wk, sat = sorted(set(opens(P, WK))), opens(P, ['sat'])[0]; t_wk, t_sat = sorted(set(opens(TP, WK))), opens(TP, ['sat'])[0]
    check('today four at 06:20 Monday to Saturday', t_wk == [4] and t_sat == 4)
    check('one figure for the weekday 06:20 starts', len(wk) == 1)
    if wk[0] == sat == 4: return f'four start at 06:20 Monday to Saturday, as today, but shared among 26 people instead of 20, so about {F["open0620"]} a year each, against {T["open0620"]}'
    return (f'{WORDS[wk[0]]} start at 06:20 on weekdays and {WORDS[sat]} on a Saturday, where today four do, but shared among 26 people instead of 20, '
            f'so about {F["open0620"]} a year each, against {T["open0620"]}')

# ── what each design is, adds and costs ─────────────────────────────────────────────────────────────────────────────────
# Each design's two lines on the managers' "Why" slide and the three gains and three costs in its notes are the shortlist
# sheet's card for it (shortlist-sheet.mjs: each card's edge and cost, against both of the others), said in the same shape for
# all three: the outside review the owner passed on (8 Nov 2026, as advice) asked for each design's main compromise beside its
# gain, and the owner asked that no design be seen to be favoured. Every figure is read from the grids and deck-check.mjs, and
# every comparison is checked against both of the others before it is written.
def long_ms(p): return round(dp.per_year(p, lambda s_, d_: d_ != 'sun' and _len(s_) > 510))
def closing_run(p):
    """The most closing weeks in a row, lapping the rotation."""
    c = [closing(main_duty(p[k])) for k in sorted(p, key=int)]; best = run = 0
    for x in c + c: run = run + 1 if x else 0; best = max(best, run)
    return min(best, len(c))
ffw = lambda f: upto(f['ff']) if 'up to' in f['ff'] else first(f['ff'])
def story():
    g = lambda n: OP[n]
    MGn, LCn, BVn = (NB(n) for n in ('Middle Ground', 'Level Crossing', 'Balanced V6'))
    fig = lambda n: FIG[n]
    if NAME == 'Balanced V6':
        V5 = grid(find_grid('Balanced V5'))
        diff = [(k, d) for k in P for d in DAYS if P[k][d] != V5[k][d]]
        check('Balanced V5’s weeks with its three weekday 08:00–16:30s at 07:30–16:00, nothing else changed',
              all(V5[k][d] == '08:00-16:30' and P[k][d] == '07:30-16:00' for k, d in diff) and {d: sum(1 for _, x in diff if x == d) for d in WK} == {d: 3 for d in WK}
              and per_day(P, '15:45-23:55', WK) == {3})
        L, M = O['Level Crossing'], O['Middle Ground']
        check('the shortest runs of earlies or of lates of the three, the other two level', int(F['block']) < min(int(o['block']) for o in O.values()) and int(F['blockUpTo']) < min(int(o['blockUpTo']) for o in O.values())
              and L['block'] == M['block'] and L['blockUpTo'] == M['blockUpTo'])
        check('as many finishes before 14:00 as Level Crossing, more than Middle Ground, today’s 13:35, 13:45 and 14:20 every weekday, and a 13:35 neither of the others has',
              dp.early_off(P) == dp.early_off(g('Level Crossing')) > dp.early_off(g('Middle Ground')) and all(per_day(P, t, WK) == {n} for t, n in (('06:20-13:35', 1), ('06:20-13:45', 1), ('06:20-14:20', 2)))
              and not any(t.endswith('13:35') for n in PEERS for t in times(g(n))))
        check('five at the Saturday open, the other two four', opens(P, ['sat']) == [5] and all(opens(g(n), ['sat']) == [4] for n in PEERS))
        mixed = dp.grid_facts(GRIDF)['mixed']
        check('fewer weeks on one shift time, weeks mixing earlies and lates, the biggest change of start, the most single rest days, more six-day weeks, fewer weekends off, the most warnings and days in a row if a cover week falls badly',
              first(F['oneTurn']) < min(first(o['oneTurn']) for o in O.values()) and L['oneTurn'] == M['oneTurn'] and mixed == 3
              and all(dp.grid_facts(find_grid(n))['mixed'] == 0 for n in PEERS) and H(F['step']) > max(H(o['step']) for o in O.values())
              and year(singles(P), P) > max(year(singles(g(n)), g(n)) for n in PEERS) and six_days(P) == 3 and all(six_days(g(n)) == 0 for n in PEERS)
              and int(F['weekendsYear']) < min(int(o['weekendsYear']) for o in O.values()) and L['weekendsYear'] == M['weekendsYear']
              and ffw(F) > max(ffw(o) for o in O.values()) and upto(F['run']) > max(upto(o['run']) for o in O.values()))
        return dict(
            what=f'{NAME} is {NB("Balanced V5")}’s weeks with its three weekday 08:00–16:30s at 07:30–16:00, so that they overlap the three 15:45 closers for 15 minutes, a handover',
            adds='This one adds: the shortest runs of earlies or of lates, at most 3 weeks',
            costs=f'This one costs: {F["oneTurn"]} weeks on one shift time, and {year(singles(P), P)} single rest days a year',
            add_notes=[f'the shortest runs of earlies or of lates — at most {NUMW[int(F["block"])]} weeks of either in a row, {NUMW[int(F["blockUpTo"])]} with cover weeks beside them, where the other two have {NUMW[int(L["block"])]} and {NUMW[int(L["blockUpTo"])]}',
                       f'as many finishes before 14:00 as {LCn}, about {dp.early_off(P)} a year each, where {MGn} has {dp.early_off(g("Middle Ground"))}, among them today’s 13:35, which neither of the others keeps',
                       'five at the Saturday open, where the other two have four'],
            cost_notes=[f'{F["oneTurn"]} weeks on one shift time, where the other two have {first(L["oneTurn"])}, and three weeks mixing earlies and lates, where they have none, so the start moves {F["step"]} from one week to the next on average ({LCn} {L["step"]}, {MGn} {M["step"]}; today {T["step"]})',
                        f'{NUMW[singles(P)]} single rest days in 26 weeks, about {year(singles(P), P)} a year each ({LCn} about {year(singles(g("Level Crossing")), g("Level Crossing"))}, {MGn} about {year(singles(g("Middle Ground")), g("Middle Ground"))}; today {year(singles(TP), TP)}), three six-day weeks where they have none, and {F["weekendsYear"]} full weekends off a year where they have {L["weekendsYear"]}',
                        f'if a cover week falls badly, up to {NUMW[ffw(F)]} fatigue warnings and {NUMW[upto(F["run"])]} days in a row ({LCn} none and {NUMW[upto(L["run"])]}, {MGn} {NUMW[ffw(M)]} and {NUMW[upto(M["run"])]})'],
            worry_bar='Expect late finishes and single rest days first — the colleague presentation answers both.')
    if NAME == 'Level Crossing':
        CO = grid(find_grid('Crossover'))
        check('Crossover’s duties and rest days, laid in new weeks; Crossover has four closing weeks in a row', all(sorted(P[k][d] for k in P) == sorted(CO[k][d] for k in CO) for d in DAYS)
              and all((P[k][d] == 'RD') == (CO[k][d] == 'RD') and (P[k][d] == 'SPARE') == (CO[k][d] == 'SPARE') for k in P for d in DAYS) and closing_run(CO) == 4 and closing_run(P) == 1)
        B6, M = O['Balanced V6'], O['Middle Ground']
        check('no fatigue warning in any cover-week placement tested, where the other two show one or more, and the fewest days in a row if a cover week falls badly',
              F['ff'] == '0' and not F['h55'] and all(ffw(o) > 0 for o in O.values()) and upto(F['run']) < min(upto(o['run']) for o in O.values()))
        check('the gentlest change of start of the three', H(F['step']) < min(H(o['step']) for o in O.values()))
        check('two 06:20–13:45s every weekday and five at the weekday open, the other two one and four', per_day(P, '06:20-13:45', WK) == {2} and opens(P, WK) == [5] * 5
              and all(per_day(g(n), '06:20-13:45', WK) == {1} and opens(g(n), WK) == [4] * 5 for n in PEERS))
        check('the most 06:20 starts of the three and the weakest Saturday fit, and long shifts Monday to Saturday where Middle Ground has none',
              int(F['open0620']) > max(int(o['open0620']) for o in O.values()) and float(F['fitSat']) > max(float(o['fitSat']) for o in O.values()) and long_ms(P) > 0 and long_ms(g('Middle Ground')) == 0)
        return dict(
            what=f'{NAME} is Crossover’s duties and rest days, laid in new weeks so that no two closing weeks come together, where Crossover has four in a row',
            adds='This one adds: no fatigue warning in any cover-week placement tested',
            costs=f'This one costs: the most 06:20 starts, {F["open0620"]} a year, and the weakest Saturday fit',
            add_notes=[f'no fatigue warning in any cover-week placement tested, and never more than {NUMW[upto(F["run"])]} days in a row however a cover week falls ({MGn} up to {NUMW[ffw(M)]} warning and {NUMW[upto(M["run"])]} days, {BVn} up to {NUMW[ffw(B6)]} and {NUMW[upto(B6["run"])]})',
                       f'the gentlest change of start from one week to the next, {F["step"]} on average ({MGn} {M["step"]}, {BVn} {B6["step"]}; today {T["step"]})',
                       'two 06:20–13:45s every weekday and five at the weekday open, where the other two have one and four'],
            cost_notes=[f'the most starts at 06:20, about {F["open0620"]} a year each ({MGn} {M["open0620"]}, {BVn} {B6["open0620"]}; today {T["open0620"]})',
                        f'the weakest Saturday fit to the trains, {F["fitSat"]} ({MGn} {M["fitSat"]}, {BVn} {B6["fitSat"]})',
                        f'about {long_ms(P)} shifts a year each over 8h 30m Monday to Saturday, where {MGn} has none, and a 9-hour Sunday 09:00–18:00'],
            worry_bar='Expect late finishes and long breaks first — the colleague presentation answers both.')
    if NAME == 'Middle Ground':
        check(f'{BASE}’s duties and rest days, laid in new weeks; {BASE} has four closing weeks in a row', all(sorted(P[k][d] for k in P) == sorted(PB[k][d] for k in PB) for d in DAYS)
              and all((P[k][d] == 'RD') == (PB[k][d] == 'RD') and (P[k][d] == 'SPARE') == (PB[k][d] == 'SPARE') for k in P for d in DAYS) and closing_run(PB) == 4 and closing_run(P) == 1)
        check('no two 06:20 weeks side by side either, alone of the three', not side_by_side(P, opening) and all(side_by_side(g(n), opening) for n in PEERS))
        L, B6 = O['Level Crossing'], O['Balanced V6']
        check('nothing over 8h 30m on any day and every closer 8h 10m, where the other two have a 9-hour Sunday and longer Saturday closers',
              max(_len(t) for t in times(P)) == 510 and F['closers'] == '8h 10m · 8h 10m · 8h 10m' and all(max(_len(t) for t in times(g(n))) == 540 and days_of(g(n), '09:00-18:00') == {'sun'} for n in PEERS)
              and all(min(H(v) for v in o['closerSat'].split('–')) > H(F['closerSat']) for o in O.values()))
        check('the closest Saturday and Sunday fit of the three', all(float(o['fitSat']) > float(F['fitSat']) and float(o['fitSun']) > float(F['fitSun']) for o in O.values()))
        check('the longest rest between shifts and the fewest 06:20 starts of the three', all(H(o['rest']) < H(F['rest']) and int(o['open0620']) > int(F['open0620']) for o in O.values()) and L['rest'] == B6['rest'])
        check('the fewest finishes before 14:00, the other two level; four at the open every day, the minimum, where the others have five on one kind of day',
              dp.early_off(P) < dp.early_off(g('Level Crossing')) == dp.early_off(g('Balanced V6')) and F['open'] == '4 · 4 · 4' and L['open'] == '5 · 4 · 4' and B6['open'] == '4 · 5 · 4')
        check('one fatigue warning if a cover week falls badly, the 55-hour week, where Level Crossing has none', F['ff'] == '0 (up to 1)' and F['h55'] and L['ff'] == '0')
        return dict(
            what=f'{NAME} is {NB(BASE)}’s duties and rest days, laid in new weeks so that no two closing weeks come together, where {NB(BASE)} has four in a row, and no two weeks of 06:20 starts either',
            adds='This one adds: nothing over 8h 30m on any day, and no two 06:20 weeks in a row',
            costs=f'This one costs: the fewest finishes before 14:00, {dp.early_off(P)} a year, and four at the open',
            add_notes=[f'no shift over 8h 30m on any day and every closer {F["closerWk"]}, where both have a 9-hour Sunday, the 09:00–18:00, and Saturday closers of {L["closerSat"]} ({LCn}) and {B6["closerSat"]} ({BVn})',
                       f'the closest Saturday and Sunday fit to the trains, {F["fitSat"]} and {F["fitSun"]} ({LCn} {L["fitSat"]} and {L["fitSun"]}, {BVn} {B6["fitSat"]} and {B6["fitSun"]})',
                       f'the longest rest between shifts, {F["rest"]} (both {L["rest"]}), the fewest starts at 06:20, about {F["open0620"]} a year each ({LCn} {L["open0620"]}, {BVn} {B6["open0620"]}), and no two weeks of 06:20 starts side by side either, alone of the three'],
            cost_notes=[f'the fewest finishes before 14:00, about {dp.early_off(P)} a year each (both {dp.early_off(g("Level Crossing"))}; today {dp.early_off(TP)})',
                        f'four at the open every day, the minimum, where {LCn} has five on weekdays and {BVn} five on a Saturday',
                        f'one fatigue warning if a cover week falls badly: seven days of up to {F["h55"]} with 8-hour duties, over the 55-hour guideline, where {LCn} has none'],
            worry_bar='Expect late finishes and single rest days first — the colleague presentation answers both.')
    raise SystemExit(f'shortlist-decks: no story for {NAME}')

# ── the colleague deck ─────────────────────────────────────────────────────────────────────────────────────────────────────
def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    st = story()
    n_times, n_known = tn(F)
    sg, sg_t = singles(P), singles(TP); sg_y, sg_y_t = year(sg, P), year(sg_t, TP)
    rl, rl_t = dp.rest_lens(P), dp.rest_lens(TP)
    lo, hi = lo_hi_cut()
    run1, runup, trun1, trunup = first(F['run']), upto(F['run']), first(T['run']), upto(T['run'])
    gap = int(F['weekendGap'])
    mixed = dp.grid_facts(GRIDF)['mixed']
    one_a, one_b = F['oneTurn'].split(' of ')
    eo, eo_t = dp.early_off(P), dp.early_off(TP)
    lb, lb_t = long_breaks(P), long_breaks(TP)
    six, six_t = six_days(P), six_days(TP)
    check('today: four single rest days in 20, one six-day week, 13 long breaks a year', sg_t == 4 and six_t == 1 and lb_t == 13)
    check('five days in a row at most, cover weeks aside; today seven, nine at worst', run1 == 5 and (trun1, trunup) == (7, 9))
    check('more full weekends off a year than today', int(F['weekendsYear']) > int(T['weekendsYear']))

    # SLIDE 2: THE SHORT VERSION. The tiles keep their five subjects; the bar says the design target — closing weeks never
    # side by side, cover weeks aside — since the days in a row are a tile of their own
    s = S(2)
    put(s, f'up to {upto(B["run"])} · today {trun1}–{trunup}', f'up to {runup} · today {trun1}–{trunup}')
    put(s, B['weekendsYear'], F['weekendsYear'])
    lo_b, hi_b = 30, 60
    put(s, f'{lo_b} min', f'{lo} min')
    put(s, 'up to 1 hour', 'up to 1 hour' if hi == 60 else f'up to {hi} min')
    put(s, 'Same hours, shorter closers, 30 days off for 14\u00a0days’ leave as now, and never more than five days in a row, cover weeks aside.',
        'Same hours, shorter closers, 30 days off for 14\u00a0days’ leave as now, and never two closing weeks in a row, cover weeks aside.')
    s.save()
    times_line = {'Middle Ground': f'{NUMW[n_known].capitalize()} of the {NUMW[n_times]} shift times are ones people already work, today’s 13:45 and 14:20 finishes among them, and nobody finishes at 13:35.',
                  'Level Crossing': f'{NUMW[n_known].capitalize()} of the {NUMW[n_times]} shift times are ones people already work, among them two 13:45 finishes every weekday; nobody finishes at 13:35.',
                  'Balanced V6': f'{NUMW[n_known].capitalize()} of the {NUMW[n_times]} shift times are ones people already work, today’s 13:35, 13:45 and 14:20 finishes among them.'}[NAME]
    if NAME == 'Balanced V6': check('today’s 13:35, 13:45 and 14:20 every weekday', all(per_day(P, t, WK) == {n} for t, n in (('06:20-13:35', 1), ('06:20-13:45', 1), ('06:20-14:20', 2))))
    else: check('no 13:35 finish', not any(t.endswith('13:35') for t in times(P)))
    if NAME == 'Middle Ground': check('today’s 13:45 and 14:20 every weekday', all(min(per_day(P, t, WK)) >= 1 for t in ('06:20-13:45', '06:20-14:20')))
    weeks_line = (f'Every working week is all earlies or all lates, and {one_a} of the {one_b} working weeks keep one shift time Monday to Friday.' if mixed == 0 else
                  f'{NUMW[mixed].capitalize()} of the {one_b} working weeks mix earlies and lates, and {one_a} keep one shift time Monday to Friday; in return, no run of earlies or of lates is longer than {NUMW[int(F["block"])]} weeks, cover weeks aside.')
    cost_line = {'Middle Ground': f'more single rest days — {NUMW[sg]} in every 26 weeks, where today has {NUMW[sg_t]} in 20, so about {sg_y} a year each against {sg_y_t}.',
                 'Balanced V6': f'more single rest days — {NUMW[sg]} in every 26 weeks, where today has {NUMW[sg_t]} in 20, so about {sg_y} a year each against {sg_y_t} — and {NUMW[six]} six-day weeks, where today has {NUMW[six_t]}.',
                 'Level Crossing': f'fewer long breaks — {NUMW[rl.count(3)]} break of three days in 26 weeks, about {lb} a year each, where today has about {lb_t} of three or four days.'}[NAME]
    if NAME == 'Level Crossing': check('one three-day break and nothing longer; single rest days as today', rl.count(3) == 1 and max(rl) == 3 and sg_y == sg_y_t)
    if NAME == 'Middle Ground': check('more single rest days than today', sg_y > sg_y_t)
    if NAME == 'Balanced V6': check('more single rest days and more six-day weeks than today', sg_y > sg_y_t and six > six_t)
    notes(d, 2, 'This is the whole proposal on one slide.',
          'This is the whole proposal on one slide. Same 35-hour week as now. Leave goes as far as it does today: at its best, '
          f'14 days’ leave buys {F["leaveBest"]} days off in a row, and four full weeks off in a row, Sunday to Saturday, take {F["leaveFour"]} days’ leave, as now; {leave_rel()}. '
          'A week of closing shifts is never followed by another: the closing weeks are spread through the 26, cover weeks aside'
          + (', and so are the weeks of 06:20 starts.' if NAME == 'Middle Ground' else '.') + ' '
          f'Never more than five days in a row outside the cover weeks — {NUMW[runup]} at most when a cover week falls badly and its Sunday is worked as overtime, where today it is seven and can reach nine. '
          f'{NUMW[int(F["weekendsShort"].split()[0])].capitalize()} full weekends off in every 26 weeks, against four in 20 today, and never more than {NUMW[gap]} weeks apart — though each person works about two more Saturdays a year. '
          f'{weeks_line} {times_line} {longest_sentence()} '
          f'And every closing shift is shorter: {cut_words()}. '
          f'Say the cost here too, before anyone asks: {cost_line} '
          'A cover week is one of the five weeks in 26 with no set shifts: its four duties are placed later to cover leave and sickness. When a slide says “cover weeks aside”, it means the other 21 weeks, whose shifts are set.')
    check('two more Saturdays a year; five cover weeks in 26', int(F['sat']) - int(T['sat']) == 2 and F['cover'].startswith('5 of 26') and T['weekendsShort'] == '4 in 20')

    # SLIDE 4: the weeks' range is this design's; the days and the average shift are every design's here (setup)
    s = S(4)
    week = lambda f: f'No. The same 35-hour week on average; weeks run {f["light"]}–{f["heavy"]} Monday\u00a0to\u00a0Saturday (today {T["light"]}–{T["heavy"]}), and two more days a year are Saturdays.'
    put(s, week(B), week(F)); s.save()

    # SLIDE 5: the swap and short-early rows, the £, and the notes' sums (proved on Common Ground's own notes first)
    pb, text_b = pay(PB, B, BASE)
    if note_text(d, 5) != text_b: raise SystemExit(f'shortlist-decks: {BASE}’s notes 5 are no longer the sums this file rebuilds')
    pounds, text_f = pay(P, F, NAME)
    check(f'the short earlies are the only earlies finishing before 14:00 ({F["shortYear"]} a year)', int(F['shortYear']) == dp.early_off(P))
    swap_min = lambda f: int(f['swap'].split()[0]) * (1 if f['swap'].endswith('longer') else -1)
    check('a swap for a late earns less overtime than today', swap_min(F) < swap_min(T) and int(F['shortYear']) < int(T['shortYear']))
    s = S(5)
    cell(s, 19, B['swap'], F['swap'], AMBER); cell(s, 23, B['shortYear'], F['shortYear'], AMBER)
    bar = lambda p: f'No. Basic pay stays the same. Premium and overtime pay come to about £{p} a year less, gross, if you work your share of Sundays. That assumes no swap overtime.'
    put(s, bar(pb), bar(pounds)); s.save()
    notes(d, 5, 'Basic pay follows the 35-hour week', text_f)

    # SLIDE 6: the closers, the averages, the longest shift
    s = S(6)
    check('weekday closers start 15:45 and Sunday closers 15:15, as on Common Ground', CL['Weekdays'] == ['15:45-23:55'] and CL['Sunday'] == ['15:15-23:25'])
    sat_start = andl(sorted({c[:5] for c in CL['Saturday']}))
    put(s, 'Saturday closer — starts 15:45, not 14:45',
        (f'Saturday closers — {" or ".join(sorted({c[:5] for c in CL["Saturday"]}))}, not {TODAY_CLOSER["Saturday"][0][:5]}' if len(CL['Saturday']) > 1
         else f'Saturday closer — starts {sat_start}, not {TODAY_CLOSER["Saturday"][0][:5]}'))
    cell(s, 11, B['closerSat'], F['closerSat'], GREEN)
    if '–' in F['closerSat']: s.sub(11, 'sz="1800"', 'sz="1600"')   # "✓ 8h 40m–8h 55m" is 2.08in at 18pt bold in a 2.2in cell with no inset; 1.85in at 16pt
    for i, k in ((19, 'avgEarly'), (23, 'avgLate')):
        cell(s, i, B[k], F[k], tone(H(F[k]), H(T[k])))
    check('earlies longer than today, lates shorter (the subtitle)', H(F['avgEarly']) > H(T['avgEarly']) and H(F['avgLate']) < H(T['avgLate']))
    mx = max(_len(t) for t in times(P))
    put(s, 'Every closing shift is 30 to 60 minutes shorter, and nothing on any day runs over 8h\u00a030m.',
        f'Every closing shift is {lo} to {hi} minutes shorter, and nothing on any day runs over 8h\u00a030m.' if mx == 510 else
        f'Every closing shift is {lo} to {hi} minutes shorter, and nothing runs over 9\u00a0hours.')
    s.save()
    wk_e = {(sum(1 for k in P if _timed(P[k][dd]) and early(P[k][dd])), sum(1 for k in P if _timed(P[k][dd]) and early(P[k][dd]) and _len(P[k][dd]) == 510)) for dd in WK}
    wk_e_t = {(sum(1 for k in TP if _timed(TP[k][dd]) and early(TP[k][dd])), sum(1 for k in TP if _timed(TP[k][dd]) and early(TP[k][dd]) and _len(TP[k][dd]) == 510)) for dd in WK}
    check('three of the seven weekday earlies 8h 30m, every weekday; today two of six', wk_e == {(7, 3)} and wk_e_t == {(6, 2)})
    sat_cl = '; '.join(f'Saturday {c[:5]} to 23:55' for c in CL['Saturday'])
    sat_desc = (f'Saturday {andl([c[:5] for c in CL["Saturday"]])} to 23:55 instead of {TODAY_CLOSER["Saturday"][0][:5]} ({" or ".join(hm(_len(c)) for c in CL["Saturday"])}, not {T["closerSat"]})')
    long_ms = round(dp.per_year(P, lambda s_, d_: d_ != 'sun' and _len(s_) > 510))
    over = sorted({(P[k][dd]) for k in P for dd in DAYS[1:] if _timed(P[k][dd]) and _len(P[k][dd]) > 510})
    longs = ('Nothing on any day runs over 8h 30m, Sunday included. ' if mx == 510 else
             f'Nothing runs over 9 hours: the one 9-hour shift is the Sunday 09:00–18:00, and about {long_ms} duties a year each run over 8h 30m Monday to Saturday — the Saturday {andl([dash(t) for t in over])}, '
             f'where today the Saturday closer alone is {T["closerSat"]}. ')
    if mx != 510: check('the Monday-to-Saturday duties over 8h 30m are all Saturday ones', all(days_of(P, t) == {'sat'} for t in over) and long_ms > 0)
    notes(d, 6, 'Lead with the closers:',
          'Lead with the closers: they are the shifts people dislike most, and every one of them is shorter. '
          f'Weekday 15:45 to 23:55 instead of 15:15 (8h 10m, not 8h 40m); {sat_desc}; Sunday 15:15 to 23:25 instead of 14:30 (8h 10m, not 8h 55m). '
          + longs +
          'But the time the closers lose goes onto the other shifts, so more of them run to the full 8h 30m than today — three of the seven weekday earlies, where today two of six do. '
          'Be upfront about the two minutes on the average: the 26-week link may have no more than 219 contracted days a year, so the same 35 hours go into slightly fewer, slightly longer shifts. '
          f'On average, Monday to Saturday, the average early is {F["avgEarly"]} against {T["avgEarly"]} today, and the average late {F["avgLate"]} against {T["avgLate"]}, so the average shift hardly moves. The average late includes the closers; the shortlist sheet’s weekday lates leave them out. '
          f'Cover weeks aside, each person works about {F["earlyYear"]} earlies and {F["lateYear"]} lates a year, Monday to Saturday, against about {T["earlyYear"]} of each today; '
          f'the cover weeks add about {cover_days(P)} days a year to that, against about {cover_days(TP)} today, so the total stays just under today’s.')
    check('today’s earlies and lates the same number a year', T['earlyYear'] == T['lateYear'])

    # SLIDE 7: the 06:20 starts and the shortest rest are this design's
    s = S(7)
    cell(s, 15, B['open0620'], F['open0620'], NAVY)   # fewer very early starts and fewer early finishes: neither a plain gain nor a cost
    cell(s, 19, B['rest'], F['rest'], GREEN)
    s.save()
    late_wk = sorted({P[k][dd] for k in P for dd in WK if _timed(P[k][dd]) and mins_of(P[k][dd][6:]) >= 22 * 60 and not closing(P[k][dd])})
    if late_wk == ['14:00-22:30']:
        check('the weekday 14:00–22:30s: the office pair and two lates finishing with it', per_day(P, '14:00-22:30', WK) == {4})
        why22 = 'and two weekday lates finish at 22:30 with the ticket office, on the office’s own 14:00–22:30'
    else:
        check('on weekdays two 13:30–22:00s and the office pair’s 14:00–22:30', late_wk == ['13:30-22:00', '14:00-22:30'] and per_day(P, '13:30-22:00', WK) == {2} and per_day(P, '14:00-22:30', WK) == {2})
        why22 = 'and on weekdays two lates finish at 22:00, besides the ticket office’s pair at 22:30'
    notes(d, 7, 'Be straight about this one.',
          'Be straight about this one. About three more a year each finish at 23:00 or later, and all of that comes from the December rules: three on duty to the close every day, where today has two Monday to Saturday. '
          f'With {NAME} the only people who finish after 23:00 are those three closers, so no link that meets the rules on 26 weeks can have fewer. '
          f'Finishes at 22:00 or later go up more, from {T["late22"]} to {F["late22"]} a year: the rules also want five still on duty after 22:00, {why22}. '
          f'Fewer 06:20 starts each: {opens_sentence()}. '
          f'And outside the cover weeks the shortest gap between two shifts is {F["rest"]}, so nobody finishes late and starts early the next morning. '
          'The yearly figures leave the cover weeks aside, as their duties are not known yet. They are worked out over 52 weeks, which is exactly two turns of the link, so they are everyone’s.')
    check('only the three closers finish after 23:00', all(closing(P[k][dd]) for k in P for dd in DAYS[1:] if _timed(P[k][dd]) and mins_of(P[k][dd][6:]) > 23 * 60))

    # SLIDE 8: the times
    s = S(8)
    put(s, f'{tn(B)[0]} shift times in all — {tn(B)[1]} of them you already work', f'{n_times} shift times in all — {n_known} of them you already work')
    put(s, f'You work these today ({tn(B)[1]})', f'You work these today ({n_known})')
    put(s, f'New times ({tn(B)[0] - tn(B)[1]})', f'New times ({len(NEW)})')
    ts = [dash(t) for t in sorted(KNOWN)]; half = -(-len(ts) // 2)
    cols = [i for i, (a, b) in enumerate(spans(s.x)) if len(runs_of(s.x[a:b])) >= 3 and all(re.fullmatch(r'\d\d:\d\d–\d\d:\d\d', r) for r in runs_of(s.x[a:b]))]
    if len(cols) != 2: raise SystemExit(f'slide 8: the two columns of known times not found ({cols})')
    for i, part in zip(cols, (ts[:half], ts[half:])):
        first_t = runs_of(s.x[slice(*spans(s.x)[i])])[0]
        s.paras(i, first_t, [(0, t) for t in part])
    lines = {'Middle Ground': ['Closers start later: 30 minutes on weekdays, an hour on Saturdays, 45 minutes on Sundays',
                               'A new early, 07:00–15:30, on weekdays and Saturdays',
                               'Weekends: the ticket-office late, 14:30–22:30',
                               'On Sundays: 07:15–15:30 and 09:00–17:30'],
             'Level Crossing': ['Closers start later: 30 minutes on weekdays and Saturdays, 45 minutes on Sundays',
                                'Weekdays: two 07:30–16:00s, a 15-minute handover to the closers',
                                'Weekends: the ticket-office late, 14:30–22:30; on Saturdays a 06:20–14:45',
                                'On Sundays: 09:00–18:00, 9 hours'],
             'Balanced V6': ['Closers start later: 30 minutes on weekdays, 15 or 30 on Saturdays, 45 on Sundays',
                             'Weekdays: three 07:30–16:00s handing over to the closers, and a 12:00–20:30',
                             'Weekends: the ticket-office late, 14:30–22:30; on Saturdays a 06:20–15:00',
                             'On Sundays: 09:00–18:00, 9 hours']}[NAME]
    named = {t for ln in lines for t in re.findall(r'\d\d:\d\d–\d\d:\d\d', ln)}
    cls = {t for t in NEW if t[6:] in ('23:55', '23:25')}
    check(f'slide 8’s lines name every new time but the closers, and nothing else ({sorted(named)})', named <= {dash(t) for t in NEW} and {dash(t) for t in set(NEW) - cls} <= named)
    later = {k: sorted({mins_of(c[:5]) - mins_of(TODAY_CLOSER[k][0][:5]) for c in CL[k]}) for k in CL}
    check('the closers’ later starts as slide 8 says them', {'Middle Ground': later == {'Weekdays': [30], 'Saturday': [60], 'Sunday': [45]},
          'Level Crossing': later == {'Weekdays': [30], 'Saturday': [30], 'Sunday': [45]}, 'Balanced V6': later == {'Weekdays': [30], 'Saturday': [15, 30], 'Sunday': [45]}}[NAME])
    if NAME == 'Level Crossing': check('two weekday 07:30–16:00s; the 06:20–14:45 a Saturday time', per_day(P, '07:30-16:00', WK) == {2} and days_of(P, '06:20-14:45') == {'sat'})
    if NAME == 'Balanced V6': check('the 12:00–20:30 a weekday time; the 06:20–15:00 a Saturday one', days_of(P, '12:00-20:30') == set(WK) and days_of(P, '06:20-15:00') == {'sat'})
    check('the office late 14:30–22:30 a pair on Saturdays and Sundays only, and 09:00 a Sunday time',
          days_of(P, '14:30-22:30') == {'sat', 'sun'} and per_day(P, '14:30-22:30', ('sat', 'sun')) == {2} and all(days_of(P, t) == {'sun'} for t in times(P) if t[:5] == '09:00'))
    i10 = next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:1] == ['Closers start later: 30 minutes on weekdays, an hour on Saturdays, 45 minutes on Sundays'])
    s.runs(i10, runs_of(s.x[slice(*spans(s.x)[i10])]), [joined(ln) for ln in lines])
    put(s, f'Fewer shift times than today ({tn(B)[0]}, not 18) — and today’s 13:45 and 14:20 finishes stay.',
        {'Middle Ground': f'Fewer shift times than today ({n_times}, not {len(TT)}) — and today’s 13:45 and 14:20 finishes stay.',
         'Level Crossing': f'Fewer shift times than today ({n_times}, not {len(TT)}) — and two 13:45 finishes every weekday.',
         'Balanced V6': f'Fewer shift times than today ({n_times}, not {len(TT)}) — and today’s 13:35, 13:45 and 14:20 stay.'}[NAME])
    s.save()
    KIND = lambda dd: 'Sunday' if dd == 'sun' else 'Saturday' if dd == 'sat' else 'Weekdays'
    def what_is(day, t):
        if t[6:] in ('23:55', '23:25'):
            return f'closer, starts {LATER[mins_of(t[:5]) - mins_of(TODAY_CLOSER[day][0][:5])].replace(" minutes", " min").replace("an hour", "1 hour")} later'
        if day in ('Saturday', 'Sunday') and t == '14:30-22:30': return 'ticket-office late'
        if day == 'Sunday' and t[:5] == '07:15':
            (op,) = sorted(u for u in TT if u[:5] == '07:15' and 'sun' in days_of(TP, u))
            return f'the opener, {_len(op) - _len(t)} min shorter'
        if t == '07:30-16:00': return 'handover early, 8h 30m'
        m = _len(t); dur = f'{m // 60} hours' if m % 60 == 0 else hm(m)
        return f'new {"early" if early(t) else "late"}, {dur}'
    groups = {'Weekdays': set(), 'Saturday': set(), 'Sunday': set()}
    for t in NEW:
        for dd in days_of(P, t): groups[KIND(dd)].add(t)
    ref = '; '.join(f'{day}, ' + ', '.join(f'{dash(t)} ({what_is(day, t)})' for t in sorted(ts_)) for day, ts_ in groups.items() if ts_)
    peers_times = ', '.join(f'{NB(n)} {tn(O[n])[1]} of {tn(O[n])[0]}' for n in PEERS)
    intro = {'Middle Ground': f'{NAME} keeps what you know today — the 13:45 and 14:20 finishes and today’s leave — on new weeks, the closing weeks and the 06:20 weeks spread apart. '
                              'Today’s 06:20–13:45 stays on every weekday, and today’s 06:20–14:20 too; nobody finishes at 13:35. '
                              'Three of the new times are shorter versions of today’s lates: the weekday and Saturday closers start at 15:45 and the Sunday closer at 15:15, and the Sunday office late finishes at 22:30, not 23:25. '
                              'On a Saturday the same office late finishes half an hour later than today’s 14:30–22:00: the office shuts at 22:10 and needs 20 minutes to cash up. '
                              'The 07:00–15:30 is a new early, 8h 30m, on weekdays and on a Saturday. '
                              'On Sundays the opener is 07:15–15:30, today’s 07:15–15:45 fifteen minutes shorter, and 09:00–17:30 is new, 8h 30m. Nothing on any day is over 8h 30m. ',
             'Level Crossing': f'{NAME} keeps today’s 13:45 twice every weekday, and today’s leave, on new weeks with the closing weeks spread apart. '
                               'Two of the weekday earlies start at 07:30 and finish at 16:00, a quarter of an hour after the three closers come on at 15:45, so nobody leaves as the closers arrive. '
                               'The weekday closers start at 15:45 and the Sunday closers at 15:15; on a Saturday the closers are today’s weekday 15:15–23:55, 8h 40m. '
                               'The Saturday and Sunday office late finishes at 22:30: the office shuts at 22:10 and needs 20 minutes to cash up. '
                               'The 06:20–14:45 is a new Saturday early, and the Sunday’s 09:00–18:00 is new, 9 hours, the longest shift on the link. ',
             'Balanced V6': f'{NAME} keeps today’s 13:35, 13:45 and 14:20 finishes every weekday, and today’s leave, on new weeks with the closing weeks spread apart. '
                            'Three of the weekday earlies start at 07:30 and finish at 16:00, a quarter of an hour after the three closers come on at 15:45, so nobody leaves as the closers arrive; a 12:00–20:30 is a new weekday late. '
                            'The weekday closers start at 15:45 and the Sunday closers at 15:15; on a Saturday two closers start at 15:00, 8h 55m, and one at 15:15, today’s weekday closer. '
                            'The Saturday and Sunday office late finishes at 22:30: the office shuts at 22:10 and needs 20 minutes to cash up. '
                            'The 06:20–15:00 is a new Saturday early, 8h 40m, and the Sunday’s 09:00–18:00 is new, 9 hours, the longest shift on the link. '}[NAME]
    notes(d, 8, f'{BASE} starts from what you know today',
          intro + f'{NUMW[n_known].capitalize()} of its {NUMW[n_times]} times are worked today ({peers_times}), and it uses fewer different times overall than today’s eighteen. '
          f'{dp.moved_sentence(P)} The full list is on the slide. For reference, every new time: {ref}.')
    if NAME in ('Level Crossing', 'Balanced V6'):
        check('a Saturday 15:15–23:55, today’s weekday closer', '15:15-23:55' in KNOWN and 'sat' in days_of(P, '15:15-23:55') and days_of(TP, '15:15-23:55') <= set(WK))
        check('weekday closers 15:45, Sunday 15:15', CL['Weekdays'] == ['15:45-23:55'] and CL['Sunday'] == ['15:15-23:25'])
    if NAME == 'Balanced V6': check('two Saturday 15:00–23:55s and one 15:15–23:55', per_day(P, '15:00-23:55', ('sat',)) == {2} and per_day(P, '15:15-23:55', ('sat',)) == {1})
    if NAME == 'Level Crossing': check('three Saturday 15:15–23:55s', per_day(P, '15:15-23:55', ('sat',)) == {3})

    # SLIDE 9: rest and weekends
    share, share_t = sum(1 for n in rl if n >= 2) / len(rl), sum(1 for n in rl_t if n >= 2) / len(rl_t)
    check(f'{F["breaks"]} rest-day breaks of two days or more', F['breaks'] == f'{sum(1 for n in rl if n >= 2)} of {len(rl)}')
    one_share, one_share_t = first(F['oneTurn']) / int(one_b), first(T['oneTurn']) / int(T['oneTurn'].split(' of ')[1])
    s = S(9)
    cell(s, 7, B['weekendsYear'], F['weekendsYear'], GREEN)
    cell(s, 11, B['run'], F['run'], GREEN if runup <= trunup else NAVY)   # five, cover weeks aside, against seven; a worse worst case is not a plain gain
    cell(s, 15, B['breaks'], F['breaks'], GREEN if share > share_t + 0.05 else AMBER if share < share_t - 0.05 else NAVY)
    cell(s, 19, B['rest'], F['rest'], GREEN)
    cell(s, 23, B['oneTurn'], F['oneTurn'], GREEN if one_share > one_share_t else AMBER)
    put(s, f'{B["weekendsYear"]} full weekends off a year, at most five weeks apart, and never more than five\u00a0days\u00a0in\u00a0a\u00a0row, cover weeks aside.',
        f'{F["weekendsYear"]} full weekends off a year, at most {NUMW[gap]} weeks apart, and never more than five\u00a0days\u00a0in\u00a0a\u00a0row, cover weeks aside.')
    s.save()
    two, three_up = rl.count(2), sum(1 for n in rl if n > 2)
    longer = sorted(n for n in rl if n > 2)
    breaks_line = ((f'Rest days mostly come in pairs: ' if two > len(rl) / 2 else f'Fewer rest days come in pairs than today: ') + f'{two} of the {len(rl)} rest-day breaks are two days, '
                   + (f'{NUMW[three_up]} {"is" if three_up == 1 else "are"} {" or ".join(sorted({NUMW[n] for n in longer}, key=NUMW.index))} days' if three_up else 'none longer')
                   + f' and the other {NUMW[sg]} single days; today {T["breaks"]} are two days or more, {NUMW[sum(1 for n in rl_t if n > 2)]} of them three or four days, about one every {NUMW[round(len(TP) / sum(1 for n in rl_t if n > 2))]} weeks each. '
                   + (f'Single rest days go up from {NUMW[sg_t]} to {NUMW[sg]}, about {sg_y} a year each against {sg_y_t}.' if sg_y > sg_y_t else
                      f'Single rest days are {NUMW[sg]} in 26 weeks, about {sg_y} a year each, as today.'))
    mix_line = (f'Every working week is all earlies or all lates — today seven weeks in 16 mix the two — and {one_a} of the {one_b} keep one shift time Monday to Friday; today 7 weeks in 16 do both.' if mixed == 0 else
                f'{NUMW[mixed].capitalize()} of the {one_b} working weeks mix earlies and lates — today seven weeks in 16 do — and {one_a} of the {one_b} keep one shift time Monday to Friday, as 7 weeks in 16 do today.')
    check('today: seven of 16 working weeks mixed, seven on one shift time; and this design’s mixed weeks as the strip draws them', T['oneTurn'] == '7 of 16' and mixed_of(TP) == 7 and mixed_of(P) == mixed)
    six_line = 'There are no six-day weeks (today there is one).' if six == 0 else f'There are {NUMW[six]} six-day weeks (today there is one).'
    notes(d, 9, 'A full weekend is Saturday',
          f'A full weekend is Saturday and the following Sunday both off. Today that is 4 weekends in a 20-week cycle; {NAME} gives {F["weekendsShort"]}, and they are never more than {NUMW[gap]} weeks apart, against seven today. '
          + ('Five is as close as they can be: a cover week’s days are placed later, so a full weekend is not counted in a cover week or the week before one, which leaves 16 of the 26 weeks able to begin one. ' if gap == 5 else '')
          + f'Outside the cover weeks nobody works more than five days in a row — today it is seven — and {NUMW[runup]} is the most a badly placed cover week can make it, with its Sunday worked as overtime'
          + (', where today it is nine. ' if runup > trunup else '. ')
          + f'{mix_line} A week of closing shifts is never followed by another, cover weeks aside, as today'
          + ('; nor is a week of 06:20 starts. ' if NAME == 'Middle Ground' else '. ')
          + f'{breaks_line} {six_line}')
    check('today has no closing weeks side by side', not side_by_side(TP, closing))
    return st

def colleagues_rest(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    n_times, n_known = tn(F)
    sg, sg_t = singles(P), singles(TP); sg_y, sg_y_t = year(sg, P), year(sg_t, TP)
    rl = dp.rest_lens(P)
    runup, trunup = upto(F['run']), upto(T['run'])
    gap = int(F['weekendGap'])
    mixed = dp.grid_facts(GRIDF)['mixed']
    eo, eo_t = dp.early_off(P), dp.early_off(TP)
    lb, lb_t = long_breaks(P), long_breaks(TP)
    six = six_days(P)

    # SLIDE 10: the picture is this design's 26 weeks; the bar and the notes quote its blocks and weekends
    strip(d)
    s = S(10)
    put(s, f'Blocks of earlies or lates up to {B["block"]} weeks, {B["blockUpTo"]} if the cover weeks go the same way; a full weekend off comes round at least every five weeks.',
        f'Blocks of earlies or lates up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks go the same way; a full weekend off comes round at least every {NUMW[gap]} weeks.')
    s.save()
    per_kind = lambda p, days: {(sum(1 for k in p if _timed(p[k][dd]) and early(p[k][dd])), sum(1 for k in p if _timed(p[k][dd]) and not early(p[k][dd]))) for dd in days}
    check('a weekday 7 earlies and 8 lates, a Saturday 7 and 7, a Sunday 5 and 5', [per_kind(P, WK), per_kind(P, ('sat',)), per_kind(P, ('sun',))] == [{(7, 8)}, {(7, 7)}, {(5, 5)}])
    check('Sundays still finish at 23:25', {P[k]['sun'][6:] for k in P if _timed(P[k]['sun'])} >= {'23:25'} and max(mins_of(P[k]['sun'][6:]) for k in P if _timed(P[k]['sun'])) == mins_of('23:25'))
    notes(d, 10, 'Read the strip left to right;',
          'Read the strip left to right; week 27 is week 1 again. A cover week has no set shifts of its own — its four duties are placed later to cover leave and sickness, which is why it is drawn empty. '
          'Earlies here means a start before 11:00. A weekday has 7 earlies and 8 lates; a Saturday 7 and 7; a Sunday 5 and 5. '
          + (f'{NUMW[mixed].capitalize()} weeks mix the two, and are drawn split. ' if mixed else '')
          + f'Sundays stay overtime, {F["sun"]} a year each (today {T["sun"]}), and still finish at 23:25. Who starts on which week is decided after the link is chosen. '
          f'A block is weeks in a row all on earlies or all on lates. Cover weeks aside, the longest is {F["block"]} weeks (today {T["block"]}); because a cover week’s duties are placed later, '
          f'a block can run to {F["blockUpTo"]} if the cover weeks beside it are given the same kind (today {T["blockUpTo"]}). Fewer switches between earlies and lates than today, but someone who prefers one kind waits longer for it to come round. '
          'The strip does not mark the closing weeks: none of them comes straight after another, cover weeks aside' + (', and nor does a week of 06:20 starts.' if NAME == 'Middle Ground' else '.'))
    check('blocks longer than today’s, and fewer switches between earlies and lates a year than today', int(F['block']) > int(T['block']) and switches(P) < switches(TP))

    # SLIDE 11: the leave, as today
    s = S(11)
    cell(s, 11, B['leaveAvg'], F['leaveAvg'], NAVY)   # "about the same" (the notes)
    w = int(F['leaveWorst']) - int(T['leaveWorst'])
    cell(s, 15, B['leaveWorst'], F['leaveWorst'], GREEN if w > 0 else NAVY)
    rel = leave_rel()
    tail = {'the average is the same and the worst a day better': 'Average the same, worst a day better.',
            'the average and the worst are the same': 'Average and worst the same.',
            'the average is about the same and the worst the same': 'Average about the same, worst the same.'}[rel]
    put(s, f'As today: 14 days’ leave buys up to {B["leaveBest"]} days off, and four full weeks off in a row, Sunday to Saturday, take {B["leaveFour"]} days’ leave. Average the same, worst a day better.',
        f'As today: 14 days’ leave buys up to {F["leaveBest"]} days off, and four full weeks off in a row, Sunday to Saturday, take {F["leaveFour"]} days’ leave. {tail}')
    s.save()
    check('the other two on the shortlist keep today’s leave too', all(o['leaveBest'] == T['leaveBest'] and o['leaveFour'] == T['leaveFour'] for o in O.values()))
    avg_w = {'the same': 'the same', 'about the same': 'about the same'}
    notes(d, 11, 'Leave is only needed on working days',
          'Leave is only needed on working days Monday to Saturday; rest days and Sundays cost nothing. '
          f'Today there is one stretch of the roster where 14 days buys 30 days off, and {NAME} has such a stretch too, so its best is {F["leaveBest"]} as well. '
          f'On average it is {"the same" if F["leaveAvg"] == T["leaveAvg"] else "about the same"}, {F["leaveAvg"]} days, and at its worst it is {"a day better than today" if w == 1 else "the same as today"}. '
          f'Four full weeks off (Sunday to Saturday) take {F["leaveFour"]} days of leave at best, as today. '
          f'Say this plainly, as people plan a year around it. {andl([NB(n) for n in PEERS])}, the other two on the shortlist, keep today’s leave too, so it is not a difference between the three. '
          'The trade-offs are on slide 13. The averages depend on where you count a booking as starting, so quote those as “about the same”.')

    # SLIDE 12: the fatigue warnings, cover weeks aside, and what a badly placed cover week can add
    s = S(12)
    check('the subtitle: more on duty every day, more at 22:00 every day, more at the close on most days',
          all(a > b for a, b in zip([int(x) for x in F['at22'].split(' · ')], [int(x) for x in T['at22'].split(' · ')])))
    cell(s, 19, B['ff'], F['ff'], GREEN)
    s.save()
    check('no avoidable fatigue warning, cover weeks aside', first(F['ff']) == 0)
    import json as _j
    pres = _j.loads(subprocess.check_output(['node', '-e', "import('./report-data.mjs').then(m => { const fs = require('fs'); const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); "
                                             "const A = m.assess(j.patterns ?? j, 26); process.stdout.write(JSON.stringify(A.fatigue.results.filter(r => r.status === 'present').map(r => r.code + ' ' + r.title))); })",
                                             os.path.join(TOOL, GRIDF)], cwd=TOOL, text=True))
    head = ('The Office of Rail and Road and the rail industry publish lists of rota patterns that tend to tire people. '
            f'Today’s link shows four of them, cover weeks aside (up to five where a cover week falls badly); {NAME} shows none. '
            'Two more — early starts and a weekly rotation — come with every weekly link at a 06:20 station, so they are listed on the sheet for information but not counted against any design. ')
    if F['ff'] == '0 (up to 1)':
        check('the one possible warning is the 55-hour week', pres == [] and F['h55'])
        tail12 = (f'The “up to 1” beside the fatigue warnings is more than 55 hours in seven days. If a cover week’s four duties come straight after a busy week, and its Sunday is worked as overtime too, '
                  f'those seven days can come to {F["h55"]} with 8-hour duties, and more with longer ones, which the rail industry’s guidance flags. Where the four fall, and whether the Sunday is worked, is for the roster office.')
    elif F['ff'] == '0':
        check('no warning in any cover-week placement tested', pres == [] and not F['h55'])
        tail12 = 'None appears however the cover weeks fall, in every placement tested, so the figure has nothing beside it in brackets: even the busiest seven days stay under 55 hours.'
    else:
        check('the worst case is three run-length warnings — more than 13 shifts without a two-day break, more than four earlies in a row, more than seven 8-hour shifts in a row — and the 55-hour week',
              F['ff'] == '0 (up to 4)' and F['h55'] and sorted(pres) == ['FF11 More than 13 consecutive shifts without a 48h break', 'FF15 More than 4 consecutive early shifts in a rotating pattern', 'MRSF More than 7 consecutive 8h shifts'])
        tail12 = ('The “up to 4” beside the fatigue warnings is what a badly placed cover week can add, if its four duties come straight after a busy run and its Sunday is worked as overtime too: '
                  'more than 13 shifts without a two-day break, more than four earlies in a row, more than seven shifts of 8 hours or more in a row, '
                  f'and more than 55 hours in seven days — {F["h55"]} with 8-hour duties, and more with longer ones. Where the four fall, and whether the Sunday is worked, is for the roster office, which can avoid all four.')
    notes(d, 12, 'The Office of Rail and Road', head + tail12)

    # SLIDE 13: the trade-offs, against today
    s = S(13)
    if NAME == 'Middle Ground':
        same('slide 13: the runs, the Saturdays, the late finishes', 'block', 'blockUpTo')
        check('Common Ground’s times, rest days, early finishes and long breaks', NEW == sorted(times(PB) - TT) and dp.rest_lens(P) == dp.rest_lens(PB) and eo == dp.early_off(PB))
    else:
        cards = {'Level Crossing': [('Six new shift times to learn', 'Six new shift times to learn',
                                     'Three shorter versions of today’s lates, a new 07:00 early and two Sunday earlies.',
                                     'Two later closers, a 07:30 handover and three weekend times.'),
                                    ('More single rest days', 'Fewer long breaks',
                                     f'Six in 26 weeks, about 12 a year each (today about 10).',
                                     f'{NUMW[rl.count(3)].capitalize()} break of 3 days in 26 weeks, about {lb} a year each (today {lb_t}).'),
                                    ('Fewer early finishes and long breaks', 'Fewer early finishes',
                                     f'12 a year each finish before 14:00 (today 26); 4 breaks a year of 3 days or more (today 13).',
                                     f'{eo} a year each finish before 14:00, where today {eo_t} do.')],
                 'Balanced V6': [('Six new shift times to learn', 'Eight new shift times to learn',
                                  'Three shorter versions of today’s lates, a new 07:00 early and two Sunday earlies.',
                                  'Three later closers, a 07:30 handover, a 12:00 late and three weekend times.'),
                                 ('Earlies or lates in longer runs', 'Six-day weeks',
                                  'Up to 5 weeks of one kind, 7 if the cover weeks go the same way (today 2, up to 3).',
                                  f'{NUMW[six].capitalize()} in 26 weeks (today one); up to {runup} days in a row if a cover week falls badly (today {trunup}).'),
                                 ('More single rest days', 'More single rest days',
                                  f'Six in 26 weeks, about 12 a year each (today about 10).',
                                  f'{NUMW[sg].capitalize()} in 26 weeks, about {sg_y} a year each (today about {sg_y_t}).'),
                                 ('Fewer early finishes and long breaks', 'Fewer early finishes and long breaks',
                                  f'12 a year each finish before 14:00 (today 26); 4 breaks a year of 3 days or more (today 13).',
                                  f'{eo} a year each finish before 14:00 (today {eo_t}); {lb} breaks a year of 3 days or more (today {lb_t}).')]}[NAME]
        for old_t, new_t, old_d, new_d in cards:
            put(s, old_t, new_t); put(s, old_d, new_d)
        weekend = sorted(t for t in NEW if days_of(P, t) <= {'sat', 'sun'} and t[6:] not in ('23:55', '23:25'))   # the closers are counted as closers
        check('the new times as the card counts them: the later closers, a weekday 07:30 handover, a weekday 12:00 late, and three weekend times',
              len(weekend) == 3 and days_of(P, '07:30-16:00') == set(WK) and all(c[:5] > TODAY_CLOSER[k][0][:5] for k, cs in CL.items() for c in cs)
              and len(cls_new := [t for t in NEW if t[6:] in ('23:55', '23:25')]) == {'Level Crossing': 2, 'Balanced V6': 3}[NAME]
              and len(NEW) == len(cls_new) + 1 + (NAME == 'Balanced V6') + 3 and (NAME != 'Balanced V6' or days_of(P, '12:00-20:30') == set(WK)))
        if NAME == 'Level Crossing':
            check('six new times: two closers, the handover, a Saturday early, the office late and the Sunday 09:00',
                  len(NEW) == 6 and {t for t in NEW if t[6:] in ('23:55', '23:25')} == {'15:45-23:55', '15:15-23:25'} and set(NEW) - {'15:45-23:55', '15:15-23:25'} == {'07:30-16:00', '06:20-14:45', '14:30-22:30', '09:00-18:00'})
            same('slide 13: the runs', 'block', 'blockUpTo')
            check('fewer long breaks and fewer early finishes than today; single rest days as today', lb < lb_t and eo < eo_t and sg_y == sg_y_t)
        else:
            check('eight new times: three closers, the handover, a weekday late, a Saturday early, the office late and the Sunday 09:00',
                  len(NEW) == 8 and {t for t in NEW if t[6:] in ('23:55', '23:25')} == {'15:45-23:55', '15:00-23:55', '15:15-23:25'}
                  and set(NEW) - {'15:45-23:55', '15:00-23:55', '15:15-23:25'} == {'07:30-16:00', '12:00-20:30', '06:20-15:00', '14:30-22:30', '09:00-18:00'})
            check('more six-day weeks and single rest days than today, fewer early finishes and long breaks', six > 1 and sg_y > sg_y_t and eo < eo_t and lb < lb_t and runup > trunup)
    s.save()
    check('two more Saturdays and the late finishes, as on the cards', int(F['sat']) - int(T['sat']) == 2)
    if NAME == 'Balanced V6':
        swap_in(d, 13, 'and slide 7 has the late finishes in full.',
                f'and slide 7 has the late finishes in full. Not on the slide, but say it if asked: runs of earlies or of lates up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks go the same way (today {T["block"]}, up to {T["blockUpTo"]}).')
        check('runs longer than today’s', int(F['block']) > int(T['block']))

    # SLIDE 14: the table's rows are deck-check.mjs's; the costs line is this design's
    p14 = f'{d}/ppt/slides/slide14.xml'
    for label, k in (('Average shift · longest shift', 'avgLongest'), ('Closing shift: weekday · Saturday · Sunday', 'closers'), ('Full weekends off, about a year', 'weekendsYear'),
                     ('Most days worked in a row', 'run'), ('Shortest rest between shifts', 'rest'), ('Different shift times', 'times'),
                     ('Avoidable fatigue warnings, cover weeks aside', 'ff')):
        if B[k] != F[k]: dp.replace_run(p14, B[k], F[k], after=label)
    if '–' in F['closerSat']:
        # "8h 10m · 8h 40m–8h 55m · 8h 10m" is 2.5in in bold 12pt and its cell 2.4in, so its row takes two lines; the eleven
        # rows go from 0.27in to 0.25in so the table still ends 0.2in above the bar
        x14 = open(p14, encoding='utf-8').read()
        if x14.count('<a:tr h="246888">') != 11: raise SystemExit('slide 14: the table no longer has eleven rows of 0.27in')
        open(p14, 'w', encoding='utf-8').write(x14.replace('<a:tr h="246888">', '<a:tr h="228600">'))
    s = S(14)
    put(s, 'The costs: more late finishes, longer runs of earlies or lates and more single rest days.',
        {'Middle Ground': 'The costs: more late finishes, longer runs of earlies or lates and more single rest days.',
         'Level Crossing': 'The costs: more late finishes, longer runs of earlies or lates and fewer long breaks.',
         'Balanced V6': 'The costs: more late finishes, more single rest days and three six-day weeks.'}[NAME])
    s.save()
    if NAME == 'Balanced V6': check('three six-day weeks', six == 3)

def strip(d):
    """Slide 10's picture, drawn by rota-strip.mjs from this design's grid, in Common Ground's place and at its size."""
    png = os.path.join(tempfile.mkdtemp(), 'strip.png')
    subprocess.check_call(['node', os.path.join(TOOL, 'rota-strip.mjs'), os.path.join(TOOL, GRIDF), png], stdout=subprocess.DEVNULL)
    media = f'{d}/ppt/media/rota-strip.png'
    size = lambda f: struct.unpack('>II', open(f, 'rb').read(24)[16:24])
    if size(png) != size(media): raise SystemExit(f'slide 10: the strip is {size(png)}, {BASE}’s {size(media)}; the picture’s frame is sized for the old one')
    shutil.copy(png, media); shutil.rmtree(os.path.dirname(png))

def why_notes(st, lo, hi):
    """Slide 7's notes: what the design is, what all three share, its three gains and three costs against the other two (the
    shortlist sheet's card), its new times, its closers, and the costs all three share."""
    n_times, _ = tn(F)
    newp = lambda n: (len(times(OP[n]) - TT), len(times(OP[n])))
    check('the costs all three share, as the bar says them', all(FIG[n]['late23'] == F['late23'] and FIG[n]['sat'] == F['sat'] for n in SHORT))
    check('three gains and three costs, as each of the three decks has', len(st['add_notes']) == len(st['cost_notes']) == 3)
    return (f'{st["what"]}. It is one of three shortlisted designs, with {andl([NB(n) for n in PEERS])}; all three meet the nine December rules, keep today’s leave '
            'and never put two closing weeks side by side, cover weeks aside. '
            f'What it adds, against the other two: {"; ".join(st["add_notes"])}. '
            f'What it costs, against them: {"; ".join(st["cost_notes"])}. '
            f'{NUMW[len(NEW)].capitalize()} of its {NUMW[n_times]} shift times are new ({", ".join(f"{NB(n)} {NUMW[newp(n)[0]]} of {NUMW[newp(n)[1]]}" for n in PEERS)}). '
            f'Every closing shift is {lo} to {hi} minutes shorter than today’s. '
            f'The costs all three share are in the bar: {F["late23"]} finishes a year at 23:00 or later against {T["late23"]}, and {F["sat"]} Saturdays against {T["sat"]}.')

def notice_notes(pounds):
    """Slide 8's notes: the figures behind the six cards, then what is worth having to hand that the slide leaves out."""
    sg, sg_t = singles(P), singles(TP); sg_y, sg_y_t = year(sg, P), year(sg_t, TP)
    rl, rl_t = dp.rest_lens(P), dp.rest_lens(TP)
    lb, lb_t = long_breaks(P), long_breaks(TP)
    lo, hi = lo_hi_cut()
    n_times, _ = tn(F)
    mixed = mixed_of(P); six, six_t = six_days(P), six_days(TP)
    peers_sg = ', '.join(f'{NB(n)} about {year(singles(OP[n]), OP[n])}' for n in PEERS)
    late_wk = sorted({P[k][dd] for k in P for dd in WK if _timed(P[k][dd]) and mins_of(P[k][dd][6:]) >= 22 * 60 and not closing(P[k][dd])})
    if late_wk == ['14:00-22:30']:
        check('seven still on duty at 22:00 on a weekday: three closers, the office pair and two floor lates', per_day(P, '14:00-22:30', WK) == {4} and F['at22'].startswith('7 ·'))
        at22 = 'the rules want five still on duty at 22:00, and two floor lates finish at 22:30 with the ticket office every weekday, which makes seven'
    else:
        check('five still on duty at 22:00 on a weekday — the three closers and the office pair — and two lates finishing at 22:00',
              late_wk == ['13:30-22:00', '14:00-22:30'] and per_day(P, '14:00-22:30', WK) == {2} and per_day(P, '13:30-22:00', WK) == {2} and F['at22'].startswith('5 ·'))
        at22 = 'the rules want five still on duty at 22:00, which the three closers and the ticket office’s pair make every weekday, and two weekday lates finish at 22:00 besides'
    check('finishes at 22:00 or later and at 23:00 or later as the slide and the notes say them', F['late22'] == '94' and T['late22'] == '78' and int(F['late23']) - int(T['late23']) == 3)
    leave_avg = (f'on average 14 days goes as far as today, {F["leaveAvg"]} days off' if F['leaveAvg'] == T['leaveAvg']
                 else f'on average 14 days goes about as far as today, {F["leaveAvg"]} days off against {T["leaveAvg"]}')
    longs, longs_t = sorted(n for n in rl if n > 2), sum(1 for n in rl_t if n > 2)
    check('today: five rest-day breaks of three or four days', longs_t == 5 and set(n for n in rl_t if n > 2) == {3, 4})
    if NAME == 'Level Crossing':
        check('one three-day break, nothing longer; single rest days as today', longs == [3] and sg_y == sg_y_t)
        price = (f'The price is in the long breaks: one rest-day break of three days in 26 weeks, about {lb} a year each, where today has about {lb_t} of three or four days; '
                 f'single rest days stay at about {sg_y} a year each, as today ({peers_sg}).')
        runs = f'Blocks of earlies or lates run up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks beside them go the same way (today {T["block"]}, up to {T["blockUpTo"]}).'
    else:
        check('more single rest days than today', sg_y > sg_y_t)
        price = (f'The price is in the rest days: {NUMW[sg]} single rest days in 26 weeks, about {sg_y} a year each against {sg_y_t} today ({peers_sg})'
                 + (f', and {NUMW[six]} six-day weeks, where today has {NUMW[six_t]}.' if six > six_t else '.'))
        runs = (f'Blocks of earlies or lates run up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks beside them go the same way (today {T["block"]}, up to {T["blockUpTo"]}), '
                f'and {NUMW[len(longs)]} rest-day breaks are {" or ".join(sorted({NUMW[n] for n in longs}, key=NUMW.index))} days, where today five are three or four days.')
    swap_min = lambda f: int(f['swap'].split()[0]) * (1 if f['swap'].endswith('longer') else -1)
    check('a swap for a late adds less time than today, and there are fewer short earlies to swap', swap_min(F) < swap_min(T) and int(F['shortYear']) < int(T['shortYear']))
    check('the CEA rate as the notes say it', abs(PAY['rate'] - 21.49) < 1e-9)
    if mixed == 0:
        one = f'one shift time Monday to Friday, all earlies or all lates, in {F["oneTurn"]} weeks (today {T["oneTurn"]})'
    else:
        one = f'one shift time Monday to Friday in {F["oneTurn"]} weeks (today {T["oneTurn"]}), and {NUMW[mixed]} weeks mixing earlies and lates (today seven in 16)'
    third = (f'every closing shift {lo} to {hi} minutes shorter' if NAME == 'Middle Ground' else 'no shift over 9 hours')
    check('at least three on the floor at all times, against two today', F['floorMin'] == '3' and T['floorMin'] == '2')
    return ('Figures are per person, a year, with cover weeks aside, as on the slide. '
            f'Days at work are {F["daysYear"]} a year, Monday to Saturday, just under today’s 219; Sunday is overtime. '
            'Finishes at 23:00 or later rise by about three a year each, all from the December staffing: three to the close every day, where today has two Monday to Saturday, so no link meeting the rules could have fewer. '
            f'Finishes at 22:00 or later rise from about {T["late22"]} to {F["late22"]}: {at22}. '
            'Leave is only needed for working days, Monday to Saturday. Today one stretch lets 14 days’ leave buy 30 days off; this link has such a stretch too, '
            f'and four whole weeks off take {F["leaveFour"]} days, as today; {leave_avg}. '
            f'{price} {runs} '
            'The two extra Saturdays come from aiming for fourteen on a Saturday. '
            f'The pay figure is gross premium and overtime pay at the CEA rate of £{PAY["rate"]:.2f}, for someone working their full share of Sundays and no swap overtime; basic pay does not change. '
            f'On average, swapping an early for a late pays less on this link: on the same day a late is {F["swap"].replace(" min ", " minutes ")} than an early, against {T["swap"].replace(" min ", " minutes ")} today, '
            f'and the shortest earlies, the 13:35 and 13:45 finishes that add most when swapped, fall from about {T["shortYear"]} a year each to {F["shortYear"]}. Other swaps may still add paid time. '
            f'{longest_sentence()} '
            f'Not on the slide, but worth having to hand: {one}, {third}, the shortest rest between shifts {F["rest"]} (today {T["rest"]}), '
            f'at least {F["floorMin"]} on the floor at all times (today {T["floorMin"]}), {len(NEW)} of the {n_times} shift times new to learn, and {F["late23"]} finishes a year at 23:00 or later (today {T["late23"]}). '
            'The full comparison is on the proposal sheet.')

# ── the managers' deck ─────────────────────────────────────────────────────────────────────────────────────────────────────
def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    st = story()
    sg, sg_t = singles(P), singles(TP); sg_y, sg_y_t = year(sg, P), year(sg_t, TP)
    nums = lambda v: [int(x) for x in v.split(' · ')]
    # SLIDE 1: the notes name the other two shortlisted designs, as deck-polish.py wrote Common Ground's
    swap_in(d, 1, f' {BASE} is one of three shortlisted designs, with {NB("Even Step")} and {NB("Short Run")}, and this deck sets out {BASE} on its own terms.',
            f' {NAME} is one of three shortlisted designs, with {andl([NB(n) for n in PEERS])}, and this deck sets out {NAME} on its own terms.')
    # SLIDE 2: every December rule and today's leave — all three's, so Common Ground's bar holds (checked in setup)
    shape_of(S(2), 'Every December staffing rule met — and 30 days off for 14 days’ leave, as now.')
    check('30 days off for 14 days’ leave, as now', F['leaveBest'] == T['leaveBest'] and F['leaveFour'] == T['leaveFour'])
    # SLIDE 3: the open and 22:00 are this design's; the notes say it meets the three aims as well, which is checked here
    covers = [int(k) for k in sorted(P, key=int) if all(P[k][dd] == 'SPARE' for dd in DAYS)]
    check('the three aims: fourteen on a Saturday, five cover weeks spaced as evenly as 26 weeks allow, weekday closers from 15:45',
          F['daily'].split(' · ')[1] == '14' and len(covers) == 5 and sorted({(b - a) % 26 for a, b in zip(covers, covers[1:] + covers[:1])}) == [5, 6]
          and all(mins_of(c[:5]) >= mins_of('15:45') for c in closers(P, WK)))
    s = S(3)
    check('at least as many at the open as today every day, more on some', all(a >= b for a, b in zip(nums(F['open']), nums(T['open']))) and nums(F['open']) != nums(T['open']))
    check('more at 22:00 than today every day', all(a > b for a, b in zip(nums(F['at22']), nums(T['at22']))))
    cell(s, 11, B['open'], F['open'], GREEN); cell(s, 15, B['at22'], F['at22'], GREEN); s.save()
    o_wk, o_sat, o_sun = nums(F['open'])
    open_line = ({(4, 4, 4): f'Four at the open is the minimum too, and {NAME} rosters four every day, Sunday included.',
                  (5, 4, 4): f'Four at the open is the minimum too; {NAME} rosters five on weekdays and four on Saturdays and Sundays.',
                  (4, 5, 4): f'Four at the open is the minimum too; {NAME} rosters four on weekdays and Sundays and five on a Saturday.'})[(o_wk, o_sat, o_sun)]
    swap_in(d, 3, f'Four at the open is the minimum too, and {BASE} rosters four every day, Sunday included.', open_line)
    # SLIDE 4: the fit
    c = f'{d}/ppt/charts/chart1.xml'; x = open(c, encoding='utf-8').read()
    cv = lambda v: f'<c:v>{float(v):g}</c:v>'
    for k in ('fitWk', 'fitSat', 'fitSun'):
        if x.count(cv(B[k])) != 1: raise SystemExit(f'chart: {cv(B[k])} found {x.count(cv(B[k]))} times')
        x = x.replace(cv(B[k]), cv(F[k]))
    open(c, 'w', encoding='utf-8').write(x)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'; wb = openpyxl.load_workbook(xp); ws = wb.active; col = None
    for row in ws.iter_rows():
        for c_ in row:
            if c_.value == BASE: col = c_.column
    if col is None: raise SystemExit('chart workbook: no design column')
    for r, k in ((2, 'fitWk'), (3, 'fitSat'), (4, 'fitSun')):
        if abs(float(ws.cell(row=r, column=col).value) - float(B[k])) > 1e-9: raise SystemExit(f'chart workbook: row {r} is not {BASE}’s {B[k]}')
        ws.cell(row=r, column=col).value = float(F[k])
    wb.save(xp)
    def place(key):
        v, rest = float(F[key]), [(n, float(O[n][key])) for n in PEERS]
        where = ('the closest' if all(v < x_ for _, x_ in rest) else 'the weakest' if all(v > x_ for _, x_ in rest)
                 else 'level with ' + ' and '.join(f'{NB(n)}’s' for n, x_ in rest if x_ == v) if any(x_ == v for _, x_ in rest)
                 else 'between the other two')
        return f'{where} ({", ".join(f"{NB(n)} {x_:.1f}" for n, x_ in rest)})'
    check('the staffing follows the trains more closely every day, far more at weekends', float(F['fitWk']) < float(T['fitWk']) and all(float(F[k]) < 0.5 * float(T[k]) for k in ('fitSat', 'fitSun')))
    head4 = note_text(d, 4).split(f' {BASE} scores')[0]
    if not head4.endswith('the rules on the previous slide are the requirement.'): raise SystemExit('managers’ notes 4 no longer open as this file expects')
    extra4 = ''
    if NAME == 'Middle Ground':
        same('the weekday fit and today’s 11:00–19:30', 'fitWk')
        extra4 = ' Part of the weekday gap is today’s 11:00–19:30, kept on weekdays where an 11:30–20:00 would score 31.9.'
        check('Common Ground’s duties, so its 11:00–19:30 sentence holds', all(sorted(P[k][dd] for k in P) == sorted(PB[k][dd] for k in PB) for dd in WK))
    notes(d, 4, 'The score compares', head4 + f' {NAME} scores {F["fitWk"]} on weekdays, {F["fitSat"]} on a Saturday and {F["fitSun"]} on a Sunday, against today’s {T["fitWk"]}, {T["fitSat"]} and {T["fitSun"]}; lower is closer. '
          f'Among the three shortlisted links, its weekday fit is {place("fitWk")}, its Saturday fit {place("fitSat")} and its Sunday fit {place("fitSun")}.' + extra4)
    # SLIDE 5: the weeks' range and the Sunday's hours
    swap_in(d, 5, f'from {B["light"]} to {B["heavy"]} Monday to Saturday (today', f'from {F["light"]} to {F["heavy"]} Monday to Saturday (today')
    swap_in(d, 5, f'{B["sunHours"]} of overtime each Sunday against {T["sunHours"]}', f'{F["sunHours"]} of overtime each Sunday against {T["sunHours"]}')
    # SLIDE 6: fatigue
    s = S(6)
    runup, trunup = upto(F['run']), upto(T['run'])
    cell(s, 7, B['ff'], F['ff'], GREEN)
    cell(s, 11, B['run'], F['run'], GREEN if runup <= trunup else NAVY)
    cell(s, 15, B['rest'], F['rest'], GREEN)
    lab = shape_of(s, 'Longest shift, any day'); cell(s, lab + 2, B['longest'], F['longest'], GREEN)
    s.save()
    check('the longest shift shorter than today’s, and rest and days in a row within the limits', H(F['longest']) < H(T['longest']) and runup <= 13 and H(F['rest']) >= 12 * 60)
    old6 = (f'The one possible warning, the “up to 1”, is the guideline of no more than 55 hours in any seven days: if a cover week’s four duties come straight after a heavy week and its Sunday is worked as overtime too, '
            f'seven days can reach {B["h55"]} with 8-hour duties. The roster office can avoid that when it places the duties.')
    if F['ff'] == '0 (up to 1)': new6 = old6.replace(B['h55'], F['h55'])
    elif F['ff'] == '0': new6 = 'No warning appears in any placement of the cover weeks tested: even the busiest seven days stay under 55 hours, so the figure has nothing beside it in brackets.'
    else: new6 = ('The “up to 4” is what a badly placed cover week can add, if its four duties come straight after a busy run and its Sunday is worked as overtime too: more than 13 shifts without a two-day break, '
                  f'more than four earlies in a row, more than seven shifts of 8 hours or more in a row, and more than 55 hours in seven days, {F["h55"]} with 8-hour duties; and up to {runup} days in a row, under the limit of 13. '
                  'The roster office can avoid all four when it places the duties.')
    swap_in(d, 6, old6, new6)
    # SLIDE 7: WHY THIS ONE. Four lines all three share, each checked of all three; what this one adds, and what it costs, each
    # against the other two (story())
    s = S(7)
    lo, hi = lo_hi_cut()
    ALL3 = [FIG[n] for n in SHORT]
    check('all three: all 9 December rules and no avoidable fatigue warning, cover weeks aside', all(f['met'] == '9' and first(f['ff']) == 0 for f in ALL3))
    check('all three: today’s leave', all(f['leaveBest'] == T['leaveBest'] and f['leaveFour'] == T['leaveFour'] for f in ALL3))
    check('all three: no shift over 9 hours, and every closing shift shorter', all(H(f['longest']) <= 540 and all(max(H(v) for v in f[k].split('–')) < H(T[k]) for k in ('closerWk', 'closerSat', 'closerSun')) for f in ALL3))
    check('all three: more late finishes and two more Saturdays a year', all(int(f['late23']) > int(T['late23']) and int(f['sat']) - int(T['sat']) == 2 for f in ALL3))
    check('all three: no two closing weeks side by side, cover weeks aside', all(not side_by_side(grid(find_grid(n)), closing) and not side3(grid(find_grid(n))) for n in SHORT))
    check('the two lines of this design’s own fit on one line, as Common Ground’s longest, 82 characters, does', all(len(t) <= 82 for t in (st['adds'], st['costs'])))
    for old, new in ((f'All three: {B["weekendsYear"]} full weekends off a year each (today {T["weekendsYear"]}), at most 5 weeks apart', 'All three: no two closing weeks in a row, cover weeks aside'),
                     ('All three: no shift over 9 hours, and every closing shift shorter', 'All three: today’s leave — 30 days off for 14 days’ leave, four weeks off for 14'),
                     (f'All three: fewer shift times than today’s {T["times"]} — here {tn(B)[0]}, {tn(B)[1]} worked today', 'All three: no shift over 9 hours, and every closing shift shorter'),
                     ('This one adds: today’s leave, 30 days off for 14, and nothing over 8h 30m, any day', st['adds']),
                     ('This one costs: 12 single rest days a year, where today has 10 and the other two 8', st['costs'])):
        put(s, old, new)
    shape_of(s, 'All three: all 9 December rules; no avoidable fatigue warning, cover weeks aside')
    shape_of(s, 'What all three cost: more late finishes and two more Saturdays a year.')
    s.save()
    notes(d, 7, f'{BASE} (4 November 2026)', why_notes(st, lo, hi))
    # SLIDE 8: what colleagues will notice
    s = S(8)
    pb, _ = pay(PB, B, BASE); pounds, _ = pay(P, F, NAME)
    lo, hi = lo_hi_cut()
    lb, lb_t = long_breaks(P), long_breaks(TP)
    welcome = ['More weekends off', f'{F["weekendsYear"]} full weekends a year, not {T["weekendsYear"]}', 'Fewer days in a row', f'{first(F["run"])} at most, not {first(T["run"])}']
    welcome += (['Nothing over 8h 30m, any day', f'today’s longest is {T["longest"]}'] if NAME == 'Middle Ground' else ['Shorter closing shifts', f'every one {lo} to {hi} minutes shorter'])
    s.runs(5, ['More weekends off', f'{B["weekendsYear"]} full weekends a year, not {T["weekendsYear"]}', 'Fewer days in a row', f'{first(B["run"])} at most, not {first(T["run"])}', 'Nothing over 8h 30m, any day', f'today’s longest is {T["longest"]}'], welcome)
    second = (['More single rest days', f'about {sg_y} a year, not {sg_y_t}'] if NAME != 'Level Crossing' else ['Fewer long breaks', f'about {lb} a year of 3 days or more, not {lb_t}'])
    s.runs(9, ['More late finishes', f'{B["late22"]} a year at 22:00 or later, not {T["late22"]}', 'More single rest days', f'about {year(singles(PB), PB)} a year, not {sg_y_t}', 'Less premium and overtime pay', f'about £{pb} a year, gross, for a full share of Sundays, swaps aside'],
           ['More late finishes', f'{F["late22"]} a year at 22:00 or later, not {T["late22"]}'] + second + ['Less premium and overtime pay', f'about £{pounds} a year, gross, for a full share of Sundays, swaps aside'])
    put(s, 'Expect late finishes and single rest days first — the colleague presentation answers both.', st['worry_bar'])
    s.save()
    notes(d, 8, 'Figures are per person, a year', notice_notes(pounds))

# ── building one deck ───────────────────────────────────────────────────────────────────────────────────────────────────
# Common Ground's text that must not survive into a design it is not true of, each with the designs it IS true of. Matched with
# no-break spaces and word joiners read as plain spaces, so "8h\u00a030m" cannot slip past "8h 30m". The figures every design
# here shares with Common Ground are deliberately absent.
CG_ONLY = [(re.compile(p_), ok) for p_, ok in (
    (r'[Nn]othing (on any day )?(runs )?over 8h 30m|[Nn]o shift (on any day )?(is )?(longer than|over) 8h 30m|8h 30m, any day', {'Middle Ground'}),
    (r'07:00–\u2060?15:30|09:00–\u2060?17:30|07:15–\u2060?15:30|a new 07:00 early|an hour on Saturdays|Saturday closer by an hour', {'Middle Ground'}),
    (r'starts 15:45, not 14:45|today’s 13:45 and 14:20 finishes', {'Middle Ground'}),
    (r'Earlies or lates in longer runs|Up to 5 weeks of one kind', {'Middle Ground', 'Level Crossing'}),
    (r'More single rest days|Six in 26 weeks, about 12', {'Middle Ground', 'Balanced V6'}),
    (r'nobody finishes at 13:35', {'Middle Ground', 'Level Crossing'}),
    (r'^4 · 4 · 4$|four every day, Sunday included', {'Middle Ground'}),
    (r'^20 of 26$', {'Middle Ground'}),
    (r'19 of 21|1h 12m|the other two 8|where they need 15|buy 28|4 November 2026|keeps today’s leave\b(?! too)', set()),
)]
plain = lambda t: t.replace('\u00a0', ' ').replace('\u2060', '')
# every design the tooling knows by a name of two words: a mention with an ordinary space, before the rename, is either this
# design (NAME) or Common Ground's own text (BASE, renamed), so any other is a sentence of Common Ground's deck left in place
OTHERS = sorted({n for n in list(dp.IDS) + list(FIG) + ['Fair Share', 'Grand Tour', 'Closing Time', 'Short Openers', 'Open Return', 'Second Look', 'Home Grown'] if ' ' in n})

def rename(d):
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith(('.xml', '.rels')): continue
            p_ = os.path.join(root, f); x = open(p_, encoding='utf-8').read()
            y = x.replace(BASE, NAME).replace(BCODE, CODE).replace(BFP, FP)
            if y != x: open(p_, 'w', encoding='utf-8').write(y)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'
    if os.path.exists(xp):
        wb = openpyxl.load_workbook(xp); ws = wb.active; hit = False
        for row in ws.iter_rows():
            for c_ in row:
                if c_.value == BASE: c_.value = NAME; hit = True
        if not hit: raise SystemExit('chart workbook: no design column to rename')
        wb.save(xp)

def build(who):
    src, out = os.path.join(OUT, f'{BASE.replace(" ", "-")}-for-{who}.pptx'), os.path.join(OUT, f'{NAME.replace(" ", "-")}-for-{who}.pptx')
    d = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(d)
    try:
        texts = lambda: [(f, html.unescape(t[0] or t[1])) for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml')
                         for t in re.findall(r'<a:t>([^<]*)</a:t>|<c:v>([^<]*)</c:v>', open(os.path.join(r, f), encoding='utf-8').read())]
        named = lambda: {(f, x) for f, t in texts() for x in re.split(r'(?<=[.;?!])\s+', t) if BASE in x}   # by sentence
        before = named()
        unmark(d)
        if who == 'colleagues': colleagues(d); colleagues_rest(d)
        else: managers(d)
        # THE COVER'S CODE LINE TO THE RIGHT MARGIN: it stopped 0.2in short of it (8.8in from the 0.5in margin), so the managers'
        # line, 8.79in long with Common Ground's code, put "detail" on a line of its own with Level Crossing's longer one
        s1 = Slide(f'{d}/ppt/slides/slide1.xml')
        i1 = [i for i, (a, b) in enumerate(spans(s1.x)) if any(' · 26 weeks · code ' in r for r in runs_of(s1.x[a:b]))]
        if len(i1) != 1 or s1.box(i1[0])[0::2] != (457200, 8046720): raise SystemExit(f'{src}: the cover’s code line is not where this file expects it')
        s1.geo(i1[0], cx=8229600); s1.save()
        # the rename turns every "Common Ground" into this design's name: right for Common Ground's own runs (footers, titles,
        # headers and the sentences kept, whose figures same() has checked), wrong for a sentence written here ABOUT it
        mine = sorted(named() - before)
        if mine: raise SystemExit(f'{out}: text written here names {BASE} with an ordinary space, which the rename would turn into {NAME} —\n  ' + '\n  '.join(f'{f}: {t[:90]!r}' for f, t in mine))
        others = [n for n in OTHERS if n not in (NAME, BASE)]
        stray = [f'{f}: {t[:90]!r}' for f, t in texts() if any(n in t for n in others)]
        if stray: raise SystemExit(f'{out}: another design named with an ordinary space before the rename —\n  ' + '\n  '.join(stray))
        rename(d)
        left = [f'{f}: {t[:90]!r}' for f, t in texts() for rx, ok in CG_ONLY if NAME not in ok and rx.search(plain(t))]
        left += [f'{f}: {t[:90]!r}' for f, t in texts() if re.search(r'Even.Step|Short.Run|In.Step|CG-26|ES-26|SR-26|IS-26|03af96b2', t)
                 or (NAME != 'Middle Ground' and 'Common' in t and 'Ground' in t)]
        chart = f'{d}/ppt/charts/chart1.xml'
        if os.path.exists(chart):
            cx = open(chart, encoding='utf-8').read()
            left += [f'chart1.xml: {B[k]}' for k in ('fitWk', 'fitSat', 'fitSun') if B[k] != F[k] and f'<c:v>{float(B[k]):g}</c:v>' in cx]
        if left: raise SystemExit(f'{out}: text that is not {NAME}’s —\n  ' + '\n  '.join(sorted(set(left))))
        # NO RECOMMENDATION, NO UNION REP, NO "FIXED ROTA", UK ENGLISH AND THE JANUARY LINK, in slides and notes alike (deck-polish.py's
        # own guards, as Common Ground's decks passed them)
        xmls = [os.path.join(r, f) for r, _, fs in os.walk(d) for f in fs if f.endswith(('.xml', '.rels'))]
        for word, why in (('recommend', 'the shortlist is presented evenly'), ('union rep', 'S. Silva, the RMT rep, leads it'), ('fixed rota', 'the decks say “cover weeks aside”')):
            said = [os.path.relpath(f, d) for f in xmls if word in open(f, encoding='utf-8').read().lower()]
            if said: raise SystemExit(f'{out}: says "{word}" ({", ".join(sorted(said))}); {why}')
        for rx, why in ((dp.US_LANG, 'text tagged as US English'), (dp.OLD_LINK, f'the December 2026 link, which starts on {dp.LINK_STARTS}')):
            said = [os.path.relpath(f, d) for f in xmls if rx.search(open(f, encoding='utf-8').read())]
            if said: raise SystemExit(f'{out}: {why} ({", ".join(sorted(said))})')
        # THE MARKS, judged afresh from each figure's colour (deck-marks.py)
        for f in os.listdir(f'{d}/ppt/slides'):
            if f.endswith('.xml'):
                p_ = f'{d}/ppt/slides/{f}'; y, _ = dm.mark(open(p_, encoding='utf-8').read()); open(p_, 'w', encoding='utf-8').write(y)
        names = zipfile.ZipFile(src).namelist()
        extra = sorted(os.path.relpath(os.path.join(r, f), d) for r, _, fs in os.walk(d) for f in fs if os.path.relpath(os.path.join(r, f), d) not in names)
        if extra: raise SystemExit(f'{out}: parts {BASE}’s deck does not have: {extra}')
        tmp = out + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for n in names: z.write(os.path.join(d, n), n)   # the source's own part order, [Content_Types].xml first
        os.replace(tmp, out)
    finally:
        shutil.rmtree(d, ignore_errors=True)   # a refused build leaves nothing behind
    return out

if __name__ == '__main__':
    names = sys.argv[1:] or list(SHORT)
    bad = [n for n in names if n not in SHORT]
    if bad: raise SystemExit(f'shortlist-decks: {bad} not on the shortlist {SHORT}')
    for n in names:
        setup(n)
        for who in ('colleagues', 'managers'): print('wrote', os.path.relpath(build(who)))
