# THE CLOCKFACE AND SHORT WORKING PRESENTATIONS (8 Nov 2026). The owner named the re-lays of Even Step and Short Run "Clockface,
# Short Working", asked for "the presentations for non shortlisted designs where they exist, to match the updated designs", and
# said "For now leave the shortlist until I see Balanced v10". So each new design has a colleague and a managers' deck, set BESIDE
# the shortlist (Balanced V6, Level Crossing, Middle Ground), not on it, as Balanced V10's are (shortlist-decks.py, BESIDE).
#
# WHY FROM THE PARENT'S DECKS. Each design is its parent's duties, rest days, cover weeks and early and late weeks, every one; only
# which week works which shift time moved (README.md -> "Clockface and Short Working"). setup() checks all four on the grids, that
# the figures deck-check.mjs reads (deck-check.mjs --print) differ from the parent's in DIFFERS alone, and that the grid facts the
# decks quote (weeks mixing earlies and lates, switches, single rest days, six-day weeks, long breaks, cover weeks) are the
# parent's. So every sentence of the parent's FINISHED decks stays true of the new design but three kinds, each rewritten here:
#   · the figures in DIFFERS — the 55-hour week a cover week can make, the change of start week to week and, for Short Working,
#     its 19 weeks of 21 on one shift time;
#   · the closing weeks, which no longer come together (the colleague bar, the short-version, rest and strip notes, the managers'
#     "Why" slide);
#   · every sentence that sets the design among the shortlist of 4 Nov 2026 (Common Ground, Even Step, Short Run): the managers'
#     cover, slide 1 and 4 notes, slide 2's bar for Short Working, the whole "Why" slide and the colleague leave notes, now said
#     beside the three of 8 Nov 2026, by the 5% rule the shortlist's decks use (shortlist-decks.py: clear_best).
# Everything else is the parent's deck, part for part. Even Step's and Short Run's own decks are not touched: they set out those
# designs as they were shortlisted on 4 Nov 2026, and the zip carries the current shortlist's decks only. Even Step was discarded on
# 9 Nov 2026 (fresh.mjs BASES): its pair moved to deck-template/, where Clockface's still start, and Clockface's notes no longer
# name it (setup: A PARENT OUT OF THE PACK).
#
# THE GUARDS. Every edit refuses unless the text it replaces is there exactly once. Before the rename, text written here must not
# name the parent or any other design with an ordinary space (a deliberate mention is written with a no-break space, as every deck
# builder does, so the rename leaves it alone). After it: no design of the old shortlist named anywhere, the parent only in the
# managers' "Why" notes, which set the design beside it; none of the parent's own figures in DIFFERS outside those notes; none of
# the old shortlist's phrases; and the decks' standing guards — no recommendation, no union rep, no "fixed rota", the contact in
# full, UK English, the January link (deck-polish.py). deck-check.mjs then checks both decks' figures against deck-check --print.
#
# Run from anywhere; a name builds that design's pair only:
#   python3 docs/links-26/tooling/relay-decks.py [Clockface|"Short Working"]
#   soffice --headless --convert-to pdf --outdir docs/links-26/presentations docs/links-26/presentations/<Name>-for-*.pptx
#   node docs/links-26/tooling/deck-check.mjs
# Slide 10's picture is rota-strip.mjs's, which launches Chromium through Playwright.
import html, importlib.util, os, re, shutil, struct, subprocess, sys, tempfile, zipfile
import openpyxl

TOOL = os.path.dirname(os.path.abspath(__file__))
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(TOOL, name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
sd = load('shortlist-decks')                  # the shortlist's builder: its readings of the grids, and its guards' lists
dp, dm, snd = sd.dp, sd.dm, sd.snd
Slide, notes, escape, runs_of, spans = snd.Slide, snd.notes, snd.escape, snd.runs_of, snd.spans
GREEN = snd.GREEN
put, shape_of = dp.put, dp.shape_of
grid, find_grid, times, TT, singles, year, long_breaks = sd.grid, sd.find_grid, sd.times, sd.TT, sd.singles, sd.year, sd.long_breaks
closing, closing_run, side_by_side, side3, sandwiches = sd.closing, sd.closing_run, sd.side_by_side, sd.side3, sd.sandwiches
clear_best, clear_worst, NB, andl, hm, NUMW, WORDS = sd.clear_best, sd.clear_worst, sd.NB, sd.andl, sd.hm, sd.NUMW, sd.WORDS
early, H, first, tn, unmark, note_text, swap_in, plain = sd.early, sd.H, sd.first, sd.tn, sd.unmark, sd.note_text, sd.swap_in, sd.plain
DAYS, WK, _len, _timed = dp.DAYS, dp.DAYS[1:6], dp._len, dp._timed
FIG, T, TP = dp.FIG, dp.T, dp.TODAY_P
OUT = os.path.join(TOOL, '..', 'presentations')

SHORT = list(dp.SHORTLIST)
if len(SHORT) != 3: raise SystemExit(f'relay-decks: the decks speak of "all three"; the shortlist is {SHORT}')
RELAYS = {'Clockface': 'Even Step', 'Short Working': 'Short Run'}   # each design, and the design whose weeks it lays again
DIFFERS = {'Clockface': {'h55', 'step'}, 'Short Working': {'h55', 'oneTurn', 'step'}}   # deck-check's figures that moved
OLD_SHORTLIST = ('Common Ground', 'Even Step', 'Short Run')          # the shortlist of 4 Nov 2026, which the parents' decks name
# the old shortlist's phrases, which no deck beside the three of 8 Nov 2026 may keep
STALE = re.compile(r'[Oo]ne of three shortlisted|fit of the three shortlisted|also on the shortlist|shortlist sheet|\bAll three:'
                   r'|the other two|Among the three|as on (Even|Short) |In.Step|Closing.Time|Second.Nature|Second.Edition')
NEW_EARLY = lambda p: sorted({p[k][d] for k in p for d in DAYS[1:] if _timed(p[k][d]) and early(p[k][d]) and p[k][d] not in TT})
CUT = lambda p: sorted({_len(sd.TODAY_CLOSER[k][0]) - _len(c) for k, days in (('Weekdays', WK), ('Saturday', ['sat']), ('Sunday', ['sun'])) for c in sd.closers(p, days)})

def check(what, ok):
    if not ok: raise SystemExit(f'relay-decks ({NAME}): the slides say {what}, and the rota does not')

def setup(name):
    global NAME, PARENT, CODE, FP, PCODE, PFP, GRIDF, P, Q, F, PF, O, OP, MOVED
    NAME, PARENT = name, RELAYS[name]
    if NAME in SHORT or PARENT in SHORT: raise SystemExit(f'relay-decks: {NAME} or {PARENT} is on the shortlist now; these decks set {NAME} beside it')
    (CODE, FP), (PCODE, PFP) = dp.IDS[NAME], dp.IDS[PARENT]
    GRIDF = find_grid(NAME); P, Q = grid(GRIDF), grid(find_grid(PARENT))
    F, PF = FIG[NAME], FIG[PARENT]
    O = {n: FIG[n] for n in SHORT}; OP = {n: grid(find_grid(n)) for n in SHORT}
    # WHAT IT KEEPS OF ITS PARENT, cell for cell: the sentences kept from the parent's decks lean on all four
    check(f'{PARENT}’s duties, day by day, every one', all(sorted(P[k][d] for k in P) == sorted(Q[k][d] for k in Q) for d in DAYS))
    check(f'{PARENT}’s rest days and cover weeks, cell for cell', all((P[k][d] == 'RD') == (Q[k][d] == 'RD') and (P[k][d] == 'SPARE') == (Q[k][d] == 'SPARE') for k in P for d in DAYS))
    check(f'{PARENT}’s early and late weeks, cell for cell', all(early(P[k][d]) == early(Q[k][d]) for k in P for d in DAYS if _timed(P[k][d])))
    MOVED = sorted({int(k) for k in P for d in DAYS if P[k][d] != Q[k][d]})
    moved = set(F) ^ set(PF) | {k for k in set(F) & set(PF) if F[k] != PF[k]}
    check(f'deck-check’s figures as {PARENT}’s, but for {sorted(DIFFERS[NAME])}: they differ in {sorted(moved)}', moved == DIFFERS[NAME])
    gf, gq = dp.grid_facts(GRIDF), dp.grid_facts(find_grid(PARENT))
    check(f'{PARENT}’s weeks mixing earlies and lates, weekends and switches', all(gf[k] == gq[k] for k in ('mixed', 'weekends', 'back_to_back', 'switches_across_cover')))
    check(f'{PARENT}’s single rest days, six-day weeks, long breaks and switches between earlies and lates',
          (singles(P), sd.six_days(P), long_breaks(P), sd.switches(P), sd.mixed_of(P)) == (singles(Q), sd.six_days(Q), long_breaks(Q), sd.switches(Q), sd.mixed_of(Q)))
    # WHAT MOVED: the closing weeks, apart on both readings, and nothing either side of a cover week; today's are apart too
    check(f'no two closing weeks side by side, cover weeks aside, on both readings, where {PARENT} has {closing_run(Q)} in a row',
          closing_run(Q) >= 2 and closing_run(P) == 1 and not side_by_side(P, closing) and not side3(P) and not sandwiches(P))
    check('today has no closing weeks side by side', not side_by_side(TP, closing))
    check('the three shortlisted designs keep their closing weeks apart too', all(not side_by_side(g, closing) for g in OP.values()))

# ── what it adds and costs, beside the three ─────────────────────────────────────────────────────────────────────────────
# As shortlist-decks.py says Balanced V10's: every gain and cost against ALL THREE, and only where it is wider than 5% against
# each of them (clear_best); at least one and no more than three of each, as the card has room for. The slide's two lines are
# the first of each. Every figure is read from the grids and deck-check.mjs.
def story():
    B6, L, M = (NB(n) for n in SHORT)
    g, fg = (lambda n: OP[n]), (lambda n: FIG[n])
    sg_y, sg_t = year(singles(P), P), year(singles(TP), TP)
    sg3 = {n: year(singles(g(n)), g(n)) for n in SHORT}
    lb, lb_t, lb3 = long_breaks(P), long_breaks(TP), {n: long_breaks(g(n)) for n in SHORT}
    eo, eo_t, eo3 = dp.early_off(P), dp.early_off(TP), {n: dp.early_off(g(n)) for n in SHORT}
    new3 = {n: len(times(g(n)) - TT) for n in SHORT}
    each = lambda d, fmt=str: f'{B6} {fmt(d[SHORT[0]])}, {L} {fmt(d[SHORT[1]])}, {M} {fmt(d[SHORT[2]])}'
    # the leave and the breaks: both designs' rest days are their parents', spread more evenly than any of the three
    check('four weeks off for 15 days’ leave and 28 days off at best, where all three keep today’s 14 and 30',
          all(o['leaveFour'] == T['leaveFour'] and o['leaveBest'] == T['leaveBest'] for o in O.values())
          and clear_worst(int(F['leaveFour']), [int(o['leaveFour']) for o in O.values()]) and clear_worst(int(F['leaveBest']), [int(o['leaveBest']) for o in O.values()], high=True))
    check('the fewest single rest days, and no rest-day break of three days or more, where each of the three has some',
          clear_best(sg_y, list(sg3.values())) and lb == 0 and all(v > 0 for v in lb3.values()))
    leave = (f'four full weeks off, Sunday to Saturday, for {F["leaveFour"]} days’ leave, where all three take {T["leaveFour"]}, as today, '
             f'and {F["leaveBest"]} days off at best for 14 days’ leave, where all three have {T["leaveBest"]}')
    singles_note = f'the fewest single rest days, about {sg_y} a year each ({each(sg3, lambda v: f"about {v}")}; today {sg_t})'
    breaks = f'no rest-day break of three days or more, where {B6} has about {lb3[SHORT[0]]} a year each, {L} about {lb3[SHORT[1]]} and {M} about {lb3[SHORT[2]]} (today {lb_t})'
    if NAME == 'Clockface':
        ne3 = {n: len(NEW_EARLY(g(n))) for n in SHORT}
        check('every early Monday to Saturday a time worked today, where each of the three has new ones', not NEW_EARLY(P) and all(v > 0 for v in ne3.values()))
        check('the fewest new shift times to learn, clearly', clear_best(len(times(P) - TT), list(new3.values())))
        check('the fewest finishes before 14:00, clearly', clear_worst(eo, list(eo3.values()), high=True))
        st = dict(
            adds='This one adds, against all three: every early one of today’s times, Mon–Sat',
            costs='This one costs, against all three: four weeks off for 15 days’ leave, not 14',
            add_notes=[f'every early Monday to Saturday a time worked today, where {B6} has {NUMW[ne3[SHORT[0]]]} new ones, {L} {NUMW[ne3[SHORT[1]]]} and {M} {NUMW[ne3[SHORT[2]]]}',
                       f'the fewest new shift times to learn, {NUMW[len(times(P) - TT)]} ({each(new3, lambda v: NUMW[v])})',
                       singles_note],
            cost_notes=[leave, f'the fewest finishes before 14:00, about {eo} a year each ({each(eo3)}; today {eo_t})', breaks])
    else:
        lw, lw3, lw_t = dp.weekday_late_avg(P), {n: dp.weekday_late_avg(g(n)) for n in SHORT}, dp.weekday_late_avg(TP)
        lwe, lwe3 = dp.long_wk_earlies(P), {n: dp.long_wk_earlies(g(n)) for n in SHORT}
        long_e = sorted({P[k][d] for k in P for d in WK if _timed(P[k][d]) and early(P[k][d]) and _len(P[k][d]) > 510})
        check('the closest weekday fit, clearly', clear_best(float(F['fitWk']), [float(o['fitWk']) for o in O.values()]))
        check('the shortest weekday lates, closers aside, clearly, where all three have today’s', clear_best(lw, list(lw3.values())) and set(lw3.values()) == {lw_t})
        check('the most weeks on one shift time and the gentlest change of start, clearly',
              clear_best(first(F['oneTurn']), [first(o['oneTurn']) for o in O.values()], high=True) and clear_best(H(F['step']), [H(o['step']) for o in O.values()]))
        check('one new weekday early over 8h 30m, the 9-hour 07:00–16:00, about 20 a year each, where none of the three has a weekday early over 8h 30m',
              long_e == ['07:00-16:00'] and _len(long_e[0]) == 540 and lwe == 20 and set(lwe3.values()) == {0})
        check('no finish before 14:00, where each of the three has some', eo == 0 and all(v > 0 for v in eo3.values()))
        st = dict(
            adds='This one adds, against all three: a closer weekday fit and shorter weekday lates',
            costs='This one costs, against all three: 9-hour weekday earlies, 20 a year each',
            add_notes=[f'the closest weekday fit to the trains, {F["fitWk"]} ({each(O, lambda o: o["fitWk"])}; today {T["fitWk"]})',
                       f'the shortest weekday lates, {hm(lw)} on average, closers aside, where all three have {hm(lw_t)}, as today',
                       f'steadier weeks: {F["oneTurn"]} on one shift time ({each(O, lambda o: first(o["oneTurn"]))}), the start moving {F["step"]} from one week to the next on average '
                       f'({each(O, lambda o: o["step"])}; today {T["step"]}), and {singles_note}'],
            cost_notes=[f'a new weekday early, {sd.dash(long_e[0])}, of 9 hours, about {lwe} a year each, where none of the three has a weekday early over 8h 30m', leave,
                        f'no finish before 14:00 and no rest-day break of three days or more, where {B6} has about {eo3[SHORT[0]]} and {lb3[SHORT[0]]} a year each, '
                        f'{L} {eo3[SHORT[1]]} and {lb3[SHORT[1]]}, and {M} {eo3[SHORT[2]]} and {lb3[SHORT[2]]} (today {eo_t} and {lb_t})'])
    check('a gain and a cost at least, and no more than three of each, as the card has room for', all(1 <= len(st[k]) <= 3 for k in ('add_notes', 'cost_notes')))
    check('the two lines of this design’s own fit on one line, as Common Ground’s longest, 82 characters, does', all(len(st[k]) <= 82 for k in ('adds', 'costs')))
    # BESIDE ITS PARENT: what laying the weeks again changed, both ways, and nothing else (setup: DIFFERS)
    pn = NB(PARENT)
    more = (f'it has one more week on one shift time, {F["oneTurn"]}, not {first(PF["oneTurn"])}, and the start moves further from one week to the next, {F["step"]} on average, not {PF["step"]}'
            if 'oneTurn' in DIFFERS[NAME] else f'keeping the closing weeks apart costs a little: the start moves {F["step"]} from one week to the next on average, not {PF["step"]}')
    check(f'the change of start week to week larger than {PARENT}’s; for Short Working, a week more on one shift time',
          H(F['step']) > H(PF['step']) and ('oneTurn' not in DIFFERS[NAME] or first(F['oneTurn']) == first(PF['oneTurn']) + 1))
    check(f'a badly placed cover week makes a lighter seven days than on {PARENT}', H(F['h55']) < H(PF['h55']))
    # A PARENT OUT OF THE PACK (9 Nov 2026): Even Step, discarded that day, is a base (fresh.mjs BASES), where these decks start
    # but which the pack no longer holds, so the notes do not name it: Clockface's say what it is in the shared sentences, and
    # the first sentence and the two set beside the parent go. Short Working's parent, Short Run, is in the pack, and stays named
    if PARENT in dp.BASE_GRIDS: st['what'] = st['beside'] = None
    else:
        st['what'] = (f'{NAME} has the duties, rest days and early and late weeks of {pn}, another design in the pack; only which week works which shift time moved, '
                      f'on {len(MOVED)} of the 26 lines, so that no two closing weeks come together, where {pn} has {NUMW[closing_run(Q)]} in a row')
        st['beside'] = (f'Against {pn}, {more}. Every other figure is {pn}’s but one: a badly placed cover week can make seven days of {F["h55"]} with 8-hour duties, not {PF["h55"]}.')
    return st

def why_notes(st):
    lo, hi = CUT(P)[0], CUT(P)[-1]
    check('every closing shift shorter than today’s', lo > 0)
    check('the costs it shares with all three, as the bar says them', all(FIG[n]['late23'] == F['late23'] and FIG[n]['sat'] == F['sat'] for n in SHORT))
    check('like all three, all 9 December rules and no two closing weeks side by side', F['met'] == '9' and all(o['met'] == '9' for o in O.values()))
    return ((f'{st["what"]}. It is' if st['what'] else f'{NAME} is') + f' not on the shortlist: it was drawn after it, and is set here beside the three shortlisted designs, {andl([NB(n) for n in SHORT])}. '
            'Like them it meets the nine December rules and never puts two closing weeks side by side, cover weeks aside. '
            f'What it adds, against all three: {"; ".join(st["add_notes"])}. '
            f'What it costs, against all three: {"; ".join(st["cost_notes"])}. '
            + (f'{st["beside"]} ' if st['beside'] else '') +
            f''
            f'Every closing shift is {lo} to {hi} minutes shorter than today’s. '
            f'The costs it shares with all three are in the bar: {F["late23"]} finishes a year at 23:00 or later against {T["late23"]}, and {F["sat"]} Saturdays against {T["sat"]}.')

# ── the colleague deck ─────────────────────────────────────────────────────────────────────────────────────────────────────
CLOSING_WEEK = ('A closing week — one spent mostly on the 23:55 close, Monday to Friday — is never followed by another: the closing weeks are spread '
                'through the 26, cover weeks aside, as today. ')
def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    one, pone = first(F['oneTurn']), first(PF['oneTurn'])
    # SLIDE 2: THE SHORT VERSION. The tiles keep their five subjects; the bar says the design target, closing weeks never side by
    # side, in place of the parent's own phrase (Even Step's days in a row, which its tile still says; Short Run's weekends apart)
    s = S(2)
    bar = {'Clockface': ('Same hours, shorter closers, nothing over 8h 30m Monday to Saturday, and never more than five days in a row, cover weeks aside.',
                         'Same hours, shorter closers, nothing over 8h 30m Monday to Saturday, and never two closing weeks in a row, cover weeks aside.'),
           'Short Working': ('Same hours, shorter closers, weekends off never more than five weeks apart, and never more than five days in a row, cover weeks aside.',
                             'Same hours, shorter closers, never two closing weeks in a row, and never more than five days in a row, cover weeks aside.')}[NAME]
    put(s, *bar); s.save()
    swap_in(d, 2, f'Every working week is all earlies or all lates, and {pone} of the 21 working weeks keep one shift time Monday to Friday. ',
            f'Every working week is all earlies or all lates, and {one} of the 21 working weeks keep one shift time Monday to Friday. ' + CLOSING_WEEK)
    # SLIDE 6: the shortlist sheet's weekday lates are the three's, not this design's
    swap_in(d, 6, 'The average late includes the closers; the shortlist sheet’s weekday lates leave them out.', 'The average late includes the closers.')
    # SLIDE 8: its times are its parent's, which were chosen that way; its weeks are new
    old8 = {'Clockface': 'Even Step was built keeping the times people already work wherever that cost little, and keeping every early Monday to Saturday one of them.',
            'Short Working': 'Short Run was built keeping the times people already work wherever that cost little.'}[NAME]
    swap_in(d, 8, old8, old8.replace(PARENT, NAME)[:-1] + ', on weeks laid so that no two closing weeks come together.')
    # SLIDE 9: the weeks on one shift time, and the closing weeks
    if one != pone: s = S(9); put(s, PF['oneTurn'], F['oneTurn'], GREEN); s.save()
    swap_in(d, 9, f'and {pone} of the 21 keep one shift time Monday to Friday; today 7 weeks in 16 do both. ',
            f'and {one} of the 21 keep one shift time Monday to Friday; today 7 weeks in 16 do both. A week of closing shifts is never followed by another, cover weeks aside, as today. ')
    # SLIDE 10: the picture is this design's 26 weeks; the notes say what the strip does not mark, and the change of start
    strip(d)
    tail10 = 'Fewer switches between earlies and lates, but someone who prefers one kind waits longer for it to come round.'
    check('fewer switches between earlies and lates than today', sd.switches(P) < sd.switches(TP))
    swap_in(d, 10, tail10, tail10 + ' The strip does not mark the closing weeks: none of them comes straight after another, cover weeks aside. '
            f'On average the start moves {F["step"]} from one week to the next, against {T["step"]} today.')
    # SLIDE 11: the four weeks off, against the three, not the old shortlist
    other = {'Clockface': 'Short Run', 'Short Working': 'Even Step'}[NAME]
    check('the three shortlisted links keep four weeks off for 14 days, and each has more single rest days than this one',
          all(o['leaveFour'] == T['leaveFour'] for o in O.values()) and all(year(singles(g), g) > year(singles(P), P) for g in OP.values()))
    swap_in(d, 11, f'{PARENT} is worse than today here, as {other} is; Common Ground, also on the shortlist, keeps the 14, for more single rest days.',
            f'{NAME} is worse than today here; the three shortlisted links keep the 14, and each has more single rest days than {NAME}.')
    # SLIDE 12: the 55-hour week a badly placed cover week can make
    swap_in(d, 12, f'those seven days can come to {PF["h55"]} with 8-hour duties', f'those seven days can come to {F["h55"]} with 8-hour duties')
    # SLIDE 13: its downsides are on its proposal sheet; the shortlist sheet is the three's
    swap_in(d, 13, 'Every one is on the proposal sheet or the shortlist sheet as well, and slide 7 has the late finishes in full.',
            'Every one is on the proposal sheet as well, and slide 7 has the late finishes in full.')

def strip(d):
    """Slide 10's picture, drawn by rota-strip.mjs from this design's grid, in the parent's place and at its size. It draws the
    rest days, the cover weeks, the full weekends and which weeks are earlies or lates — all four the parent's (setup) — and
    no shift times, so it comes out the parent's picture, pixel for pixel; it is drawn from this grid all the same, so that a
    grid which ever moved one of the four could not keep the parent's picture."""
    png = os.path.join(tempfile.mkdtemp(), 'strip.png')
    subprocess.check_call(['node', os.path.join(TOOL, 'rota-strip.mjs'), os.path.join(TOOL, GRIDF), png], stdout=subprocess.DEVNULL)
    media = f'{d}/ppt/media/rota-strip.png'
    size = lambda f: struct.unpack('>II', open(f, 'rb').read(24)[16:24])
    if size(png) != size(media): raise SystemExit(f'slide 10: the strip is {size(png)}, {PARENT}’s {size(media)}; the picture’s frame is sized for the old one')
    shutil.copy(png, media); shutil.rmtree(os.path.dirname(png))

# ── the managers' deck ─────────────────────────────────────────────────────────────────────────────────────────────────────
def put_prefix(s, prefix, new):
    """The one shape whose text begins `prefix` (the "Why" slide's two lines of this design's own), refused unless there is one."""
    hits = [(i, html.unescape(runs_of(s.x[a:b])[0])) for i, (a, b) in enumerate(spans(s.x)) if len(runs_of(s.x[a:b])) == 1 and html.unescape(runs_of(s.x[a:b])[0]).startswith(prefix)]
    if len(hits) != 1: raise SystemExit(f'{s.path}: {len(hits)} shapes begin {prefix!r}, not one')
    s.text(hits[0][0], hits[0][1], new)

def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    st = story()
    other = {'Clockface': ('Common Ground', 'Short Run'), 'Short Working': ('Common Ground', 'Even Step')}[NAME]
    pn = NB(PARENT)
    # SLIDE 1: the cover and the notes say it is beside the shortlist, as Balanced V10's do
    s = S(1); put(s, 'One of three shortlisted new CEA links, in ten minutes', 'A new CEA link drawn after the shortlist, in ten minutes')
    # THE COVER'S CODE LINE TO THE RIGHT MARGIN, as shortlist-decks.py set it: Short Working's code is a letter longer than Short Run's
    i1 = [i for i, (a, b) in enumerate(spans(s.x)) if any(' · 26 weeks · code ' in r for r in runs_of(s.x[a:b]))]
    if len(i1) != 1 or s.box(i1[0])[0::2] != (457200, 8046720): raise SystemExit(f'{NAME}: the cover’s code line is not where this file expects it')
    s.geo(i1[0], cx=8229600); s.save()
    swap_in(d, 1, f' {pn} is one of three shortlisted designs, with {other[0]} and {other[1]}, and this deck sets out {pn} on its own terms.',
            f' {NAME} is not on the shortlist: it was drawn after it, and is set beside the three shortlisted designs, {andl([NB(n) for n in SHORT])}. This deck sets out {NAME} on its own terms.')
    dp.named_in_full(d, 'managers')
    # SLIDE 2: Short Run's bar named it the closest weekday fit of the old three; Even Step's, nothing over 8h 30m, holds. The new
    # bar is no longer than Short Run's, which fitted one line: "…than any of the three shortlisted" left its last word alone on a second
    s = S(2)
    if NAME == 'Short Working':
        check('a closer weekday fit than any of the three shortlisted, clearly', clear_best(float(F['fitWk']), [float(o['fitWk']) for o in O.values()]))
        put(s, 'Every December staffing rule met — and the closest weekday fit of the three shortlisted.', 'Every December staffing rule met — and a closer weekday fit than any shortlisted link.')
        s.save()
    else:
        check('no shift over 8h 30m, Monday to Saturday', max(_len(P[k][dd]) for k in P for dd in DAYS[1:] if _timed(P[k][dd])) <= 510)
        shape_of(s, 'Every December staffing rule met — and no shift over 8h 30m, Monday to Saturday.')
    # SLIDE 3: its notes say it meets the three aims as well, which the weeks it keeps decide
    covers = [int(k) for k in sorted(P, key=int) if all(P[k][dd] == 'SPARE' for dd in DAYS)]
    check('the three aims: fourteen on a Saturday, five cover weeks spaced as evenly as 26 weeks allow, weekday closers from 15:45',
          F['daily'].split(' · ')[1] == '14' and len(covers) == 5 and sorted({(b - a) % 26 for a, b in zip(covers, covers[1:] + covers[:1])}) == [5, 6]
          and all(sd.mins_of(c[:5]) >= sd.mins_of('15:45') for c in sd.closers(P, WK)))
    # SLIDE 4: the fit, beside the three (the chart's figures are the parent's, which setup() found equal)
    def place(key):
        v, rest = float(F[key]), [(n, float(O[n][key])) for n in SHORT]
        where = ('the closest' if all(v < x for _, x in rest) else 'the weakest' if all(v > x for _, x in rest)
                 else 'level with ' + ' and '.join(f'{NB(n)}’s' for n, x in rest if x == v) if any(x == v for _, x in rest) else 'between them')
        return f'{where} ({", ".join(f"{NB(n)} {x:.1f}" for n, x in rest)})'
    check('the staffing follows the trains more closely every day, far more at weekends', float(F['fitWk']) < float(T['fitWk']) and all(float(F[k]) < 0.5 * float(T[k]) for k in ('fitSat', 'fitSun')))
    head4 = note_text(d, 4).split(f' {pn} scores')[0]
    if not head4.endswith('the rules on the previous slide are the requirement.'): raise SystemExit('managers’ notes 4 no longer open as this file expects')
    notes(d, 4, 'The score compares', head4 + f' {NAME} scores {F["fitWk"]} on weekdays, {F["fitSat"]} on a Saturday and {F["fitSun"]} on a Sunday, against today’s {T["fitWk"]}, {T["fitSat"]} and {T["fitSun"]}; lower is closer. '
          f'Beside the three shortlisted links, its weekday fit is {place("fitWk")}, its Saturday fit {place("fitSat")} and its Sunday fit {place("fitSun")}.')
    # SLIDE 6: the 55-hour week a badly placed cover week can make
    swap_in(d, 6, f'seven days can reach {PF["h55"]} with 8-hour duties', f'seven days can reach {F["h55"]} with 8-hour duties')
    # SLIDE 7: WHY THIS ONE, beside the three: four lines it shares with all three, each checked of all three and of this design;
    # what it adds and what it costs, each against all three (story())
    ALL = [F] + list(O.values()); GR = [P] + list(OP.values())
    check('as all three: all 9 December rules and no avoidable fatigue warning, cover weeks aside', all(f['met'] == '9' and first(f['ff']) == 0 for f in ALL))
    check('as all three: no two closing weeks in a row, cover weeks aside', all(not side_by_side(g, closing) and not side3(g) for g in GR))
    check('as all three: no shift over 9 hours, and every closing shift shorter', all(H(f['longest']) <= 540 and all(max(H(v) for v in f[k].split('–')) < H(T[k]) for k in ('closerWk', 'closerSat', 'closerSun')) for f in ALL))
    check('as all three: fewer shift times than today’s', all(tn(f)[0] < int(T['times']) for f in ALL))
    check('as all three: more late finishes and two more Saturdays a year', all(int(f['late23']) > int(T['late23']) and int(f['sat']) - int(T['sat']) == 2 for f in ALL))
    s = S(7)
    for old, new in (('What all three shortlisted links give, what this one adds, and what it costs', 'What it shares with the three shortlisted links, what it adds, and what it costs'),
                     ('All three: all 9 December rules; no avoidable fatigue warning, cover weeks aside', 'As all three: all 9 December rules; no avoidable fatigue warning, cover weeks aside'),
                     (f'All three: {PF["weekendsYear"]} full weekends off a year each (today {T["weekendsYear"]}), at most 5 weeks apart', 'As all three: no two closing weeks in a row, cover weeks aside'),
                     ('All three: no shift over 9 hours, and every closing shift shorter', 'As all three: no shift over 9 hours, and every closing shift shorter'),
                     (f'All three: fewer shift times than today’s {T["times"]} — here {tn(F)[0]}, {tn(F)[1]} worked today', f'As all three: fewer shift times than today’s {T["times"]} — here {tn(F)[0]}, {tn(F)[1]} worked today'),
                     ('What all three cost: more late finishes and two more Saturdays a year.', 'What it costs, as all three do: more late finishes and two more Saturdays a year.')):
        put(s, old, new)
    put_prefix(s, 'This one adds:', st['adds']); put_prefix(s, 'This one costs:', st['costs'])
    s.save()
    notes(d, 7, f'{pn} is one of three shortlisted designs', why_notes(st))
    # SLIDE 8: the weeks on one shift time, in the notes
    if 'oneTurn' in DIFFERS[NAME]: swap_in(d, 8, f'in {PF["oneTurn"]} weeks (today 7 of 16)', f'in {F["oneTurn"]} weeks (today 7 of 16)')

# ── building one deck ───────────────────────────────────────────────────────────────────────────────────────────────────
def rename(d):
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith(('.xml', '.rels')): continue
            p_ = os.path.join(root, f); x = open(p_, encoding='utf-8').read()
            y = x.replace(PARENT, NAME).replace(PCODE, CODE).replace(PFP, FP)
            if y != x: open(p_, 'w', encoding='utf-8').write(y)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'   # the managers' chart workbook
    if os.path.exists(xp):
        wb = openpyxl.load_workbook(xp); ws = wb.active; hit = False
        for row in ws.iter_rows():
            for c_ in row:
                if c_.value == PARENT: c_.value = NAME; hit = True
        if not hit: raise SystemExit('chart workbook: no design column to rename')
        wb.save(xp)

def build(who):
    pf = f'{PARENT.replace(" ", "-")}-for-{who}.pptx'   # a base's finished deck is in deck-template/ since 9 Nov 2026 (fresh.mjs BASES)
    src = os.path.join(OUT if os.path.exists(os.path.join(OUT, pf)) else dp.BASE_DECKS, pf)
    out = os.path.join(OUT, f'{NAME.replace(" ", "-")}-for-{who}.pptx')
    d = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(d)
    try:
        texts = lambda: [(os.path.relpath(os.path.join(r, f), d), html.unescape(t[0] or t[1])) for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml')
                         for t in re.findall(r'<a:t>([^<]*)</a:t>|<c:v>([^<]*)</c:v>', open(os.path.join(r, f), encoding='utf-8').read())]
        named = lambda: {(f, x) for f, t in texts() for x in re.split(r'(?<=[.;?!])\s+', t) if PARENT in x}   # by sentence
        before = named()
        unmark(d)
        if who == 'colleagues': colleagues(d)
        else: managers(d)
        # the rename turns every ordinary-space mention of the parent into this design's name: right for the parent's own runs,
        # whose figures setup() has checked, wrong for a sentence written here ABOUT the parent
        mine = sorted(named() - before)
        if mine: raise SystemExit(f'{out}: text written here names {PARENT} with an ordinary space, which the rename would turn into {NAME} —\n  ' + '\n  '.join(f'{f}: {t[:90]!r}' for f, t in mine))
        stray = [f'{f}: {t[:90]!r}' for f, t in texts() if any(n in t for n in sd.OTHERS if n not in (NAME, PARENT))]
        if stray: raise SystemExit(f'{out}: another design named with an ordinary space before the rename —\n  ' + '\n  '.join(stray))
        rename(d)
        # AFTER THE RENAME: the parent only where the managers' "Why" notes set the design beside it; no other design of the old
        # shortlist, and none of the old shortlist's phrases, anywhere; none of the parent's own moved figures outside those notes
        why = 'ppt/notesSlides/notesSlide7.xml' if who == 'managers' else None
        whole = {os.path.relpath(os.path.join(r, f), d): ' '.join(plain(html.unescape(re.sub(r'<[^>]+>', ' ', open(os.path.join(r, f), encoding='utf-8').read()))).split())
                 for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml')}   # each part's text read across its runs, so a name split over two runs is seen
        kept = PARENT not in dp.BASE_GRIDS   # a parent still in the pack may be named in the "Why" notes; a base nowhere (9 Nov 2026)
        left = [f'{f}: {n}' for f, x in whole.items() for n in OLD_SHORTLIST if n in (x.replace(PARENT, '') if f == why and kept else x)]
        left += [f'{f}: {m.group(0)!r}' for f, x in whole.items() for m in STALE.finditer(x)]
        left += [f'{f}: {c}' for f, x in whole.items() for c in (PCODE, PFP) if c in x]
        # no design out of the pack for good, anywhere, however its spaces are written (9 Nov 2026; deck-polish.py RETIRED)
        left += [f'{f}: names {n}, out of the pack for good' for f, x in whole.items() for n in dp.RETIRED if n in x]
        if why and kept and NB(PARENT) not in open(os.path.join(d, why), encoding='utf-8').read(): left.append(f'{why}: does not set {NAME} beside {PARENT}')
        for k in DIFFERS[NAME]:
            pat = re.compile(rf'\b{first(PF[k])} of (the )?21\b') if k == 'oneTurn' else re.compile(re.escape(PF[k]))
            left += [f'{f}: {PARENT}’s {k} {m.group(0)!r}' for f, x in whole.items() if f != why for m in pat.finditer(x)]
        if left: raise SystemExit(f'{out}: text that is not {NAME}’s —\n  ' + '\n  '.join(sorted(set(left))))
        # NO RECOMMENDATION, NO UNION REP, NO "FIXED ROTA", THE CONTACT IN FULL, UK ENGLISH AND THE JANUARY LINK, slides and notes
        # alike: shortlist-decks.py's guards, which the parents' decks pass
        xmls = [os.path.join(r, f) for r, _, fs in os.walk(d) for f in fs if f.endswith(('.xml', '.rels'))]
        for word, why_not in (('recommend', 'the shortlist is presented evenly'), ('union rep', f'{dp.CONTACT}, {dp.CONTACT_ROLE}, leads it'), ('fixed rota', 'the decks say “cover weeks aside”')):
            said = [os.path.relpath(f, d) for f in xmls if word in open(f, encoding='utf-8').read().lower()]
            if said: raise SystemExit(f'{out}: says "{word}" ({", ".join(sorted(said))}); {why_not}')
        if sd.ROSTERED != dp.CONTACT:
            said = [os.path.relpath(f, d) for f in xmls if sd.ROSTERED in plain(html.unescape(open(f, encoding='utf-8').read()))]
            if said: raise SystemExit(f'{out}: names {sd.ROSTERED} ({", ".join(sorted(said))}); the decks name her {dp.CONTACT}')
        for rx, why_not in ((dp.US_LANG, 'text tagged as US English'), (dp.OLD_LINK, f'the December 2026 link, which starts {dp.LINK_ON}')):
            said = [os.path.relpath(f, d) for f in xmls if rx.search(open(f, encoding='utf-8').read())]
            if said: raise SystemExit(f'{out}: {why_not} ({", ".join(sorted(said))})')
        dp.link_month(d, who)
        if who == 'colleagues': dp.named_in_full(d, 'colleagues')
        # THE MARKS, judged afresh from each figure's colour (deck-marks.py)
        for f in os.listdir(f'{d}/ppt/slides'):
            if f.endswith('.xml'):
                p_ = f'{d}/ppt/slides/{f}'; y, _ = dm.mark(open(p_, encoding='utf-8').read()); open(p_, 'w', encoding='utf-8').write(y)
        names = zipfile.ZipFile(src).namelist()
        extra = sorted(os.path.relpath(os.path.join(r, f), d) for r, _, fs in os.walk(d) for f in fs if os.path.relpath(os.path.join(r, f), d) not in names)
        if extra: raise SystemExit(f'{out}: parts {PARENT}’s deck does not have: {extra}')
        tmp = out + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for n in names: z.write(os.path.join(d, n), n)   # the source's own part order, [Content_Types].xml first
        os.replace(tmp, out)
    finally:
        shutil.rmtree(d, ignore_errors=True)   # a refused build leaves nothing behind
    return out

if __name__ == '__main__':
    names = sys.argv[1:] or list(RELAYS)
    bad = [n for n in names if n not in RELAYS]
    if bad: raise SystemExit(f'relay-decks: {bad} is not one of {list(RELAYS)}')
    for n in names:
        setup(n)
        for who in ('colleagues', 'managers'): print('wrote', os.path.relpath(build(who)))
