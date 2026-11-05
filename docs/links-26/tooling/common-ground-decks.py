# THE COMMON GROUND PRESENTATIONS, OUTSIDE THE PACK (5 Nov 2026). The owner asked "Then create presentations for common
# ground" and, offered where to keep them, chose OUTSIDE the pack: the pack ships the shortlist's decks only (owner, 3 Oct
# 2026), and pack.py refuses any other design's deck in presentations/. So these two are written to
# ../presentations-outside-the-pack/, and the pack, the shortlist and the shortlist's six decks are unchanged.
#
# Common Ground (CG-26-T8) is today's link taken to 26 weeks, on the owner's brief of 4 Nov 2026: today's 13:45 and 14:20
# kept as the openers' finishes, closers from 15:45, an even Sunday, and 14 days' leave buying 30 days off,
# on Grand Tour's weeks. Most of what the decks quote is Even Step's figure exactly — the hours and days, the run, the
# weekends, the closers, the late finishes, the staffing but the open, the Saturdays and Sundays, the blocks — so its decks
# are Even Step's FINISHED decks (built and polished), with what differs rewritten:
#   · the leave: at best 30 days off for 14 days' leave, and four weeks off for 14, as today, where Even Step buys 28 and
#     needs 15. It is the reason the design exists, so it leads the short version and the managers' "Why" slide;
#   · the rest days: six single rest days in 26 weeks (Even Step four), said wherever Even Step's decks named the leave as
#     its cost;
#   · the shift times: 14, 7 worked today and 7 new, among them a 9-hour Saturday late (13:30–22:30), so "nothing over
#     8h 30m Monday to Saturday" is Monday to Friday here;
#   · four at the open, the minimum (Even Step five), so 48 starts at 06:20 a year each; the heaviest week (42h 30m); the
#     fit (32.7 · 11.2 · 28.2); the pay (about £350 a year less premium and overtime pay); the swaps; the 55-hour week;
#   · the managers' "Why" slide speaks from outside the shortlist, as deck-polish.py's OFF_SHORTLIST wording did for In
#     Step before it joined: what it shares with the three shortlisted links, what it adds and what it costs.
# Every figure is read from deck-check.mjs --print (the sheets' counts) or computed from the grids here. Where a sentence is
# Even Step's with a figure changed, Even Step's sentence is rebuilt from its own figures and must be found where it was,
# so a rebuilt Even Step deck that no longer says what this file expects stops the build rather than carrying a stale
# sentence across. A sentence left as Even Step wrote it has the figures it quotes checked equal for the two designs.
# deck-check.mjs reads the finished decks' tables back, as it does the shortlist's.
#
# Run AFTER Even Step's decks are built and polished (README → "Rebuild after any change to the rota"), from anywhere:
#   python3 docs/links-26/tooling/common-ground-decks.py && node docs/links-26/tooling/deck-check.mjs
# then export the PDFs beside them (LibreOffice):
#   soffice --headless --convert-to pdf --outdir docs/links-26/presentations-outside-the-pack \
#     docs/links-26/presentations-outside-the-pack/Common-Ground-for-*.pptx
# Slide 10's picture is rota-strip.mjs's, which launches Chromium through Playwright.
import html, importlib.util, json, os, re, shutil, struct, subprocess, tempfile, zipfile
import openpyxl

TOOL = os.path.dirname(os.path.abspath(__file__))
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(TOOL, name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
snd, dp = load('second-nature-decks'), load('deck-polish')   # the Slide helpers; the polish's figures and grid helpers
Slide, notes, escape, runs_of, spans = snd.Slide, snd.notes, snd.escape, snd.runs_of, snd.spans
GREEN, NAVY, AMBER = snd.GREEN, snd.NAVY, snd.AMBER
put, set_shape, shape_of = dp.put, dp.set_shape, dp.shape_of
DAYS, WK, _len, _timed, WORDS = dp.DAYS, dp.DAYS[1:6], dp._len, dp._timed, dp.WORDS

SRC = os.path.join(TOOL, '..', 'presentations')                      # Even Step's finished decks
OUT = os.path.join(TOOL, '..', 'presentations-outside-the-pack')
NAME, BASE = 'Common Ground', 'Even Step'
(CODE, FP), (BCODE, BFP) = dp.IDS[NAME], dp.IDS[BASE]
SHORT = dp.SHORTLIST
if NAME in SHORT or BASE not in SHORT:
    raise SystemExit(f'common-ground-decks: written for {NAME} outside the shortlist, built on {BASE} inside it; the shortlist is {SHORT}')
FIG, T = dp.FIG, dp.T
F, E = FIG[NAME], FIG[BASE]
OTHERS = {n: FIG[n] for n in SHORT}                                   # the three shortlisted links
grid = lambda f: (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, f), encoding='utf-8')))
GRID = 'common-ground.json'
P, PE, TP = grid(GRID), grid(dp.DESIGNS[BASE]), dp.TODAY_P
# the deliberate mentions of a shortlisted design, with a no-break space: the rename at the end turns only BASE written
# with an ordinary space into NAME, so these survive it, and a sentence of Even Step's left by mistake does not
NB = lambda n: n.replace(' ', '\u00a0')
ES_, IS_, SR_ = NB('Even Step'), NB('In Step'), NB('Short Run')

# ── what the grids say, computed once ───────────────────────────────────────────────────────────────────────────────────
hm = lambda m: f'{m // 60}h {m % 60:02d}m'
H = dp.H
early = lambda s: int(s[:2]) < 11
times = lambda p, days=DAYS: {p[k][d] for k in p for d in days if _timed(p[k][d])}
per_day = lambda p, t, days: {sum(1 for k in p if p[k][d] == t) for d in days}            # how many work t, day by day
days_of = lambda p, t: {d for k in p for d in DAYS if p[k][d] == t}
a_year = lambda p, test: dp.per_year(p, test)
TODAY_T = times(TP)
NEW = sorted(times(P) - TODAY_T); KNOWN = sorted(times(P) & TODAY_T)
singles = lambda p: dp.rest_lens(p).count(1)
cover_days = lambda p: round(4 * sum(all(p[k][d] == 'SPARE' for d in DAYS) for k in p) * 52 / len(p))
ms_max = lambda p, days: max(_len(p[k][d]) for k in p for d in days if _timed(p[k][d]))
closer_start = lambda p, days, end: sorted({p[k][d][:5] for k in p for d in days if _timed(p[k][d]) and p[k][d][6:] == end})
mins_of = lambda hhmm: int(hhmm[:2]) * 60 + int(hhmm[3:])
LONG = sorted(t for t in times(P) if _len(t) > 510)                                       # the one shift over 8h 30m
SAT_LONG = LONG[0] if len(LONG) == 1 else None
dash = lambda t: t.replace('-', '–')
familiar_ms = lambda p: round(100 * len(times(p, DAYS[1:]) & TODAY_T) / len(times(p, DAYS[1:])))   # README: "Familiar shift times, Monday to Saturday"
long_ms = lambda p: round(dp.per_year(p, lambda s_, d_: d_ != 'sun' and _len(s_) > 510))          # duties over 8h 30m, Monday to Saturday, each a year
joined = lambda t: re.sub(r'(\d\d:\d\d–)(?=\d)', '\\1\u2060', t)                          # deck-polish's word joiner
tn = lambda f: tuple(int(v) for v in re.fullmatch(r'(\d+) \((\d+) you know\)', f['times']).groups())   # '13 (8 you know)' → (13, 8)
def cell(s, i, old, new, color):
    """A table cell by its shape index, refused unless it holds `old`."""
    if runs_of(s.x[slice(*spans(s.x)[i])]) != [escape(old)]: raise SystemExit(f'{s.path} shape {i}: expected {old!r}')
    set_shape(s, i, new, color)

def same(what, *keys):
    """A sentence or row left as Even Step wrote it: the figures it quotes must be Common Ground's too."""
    bad = [f'{k} {E[k]!r} against {F[k]!r}' for k in keys if E[k] != F[k]]
    if bad: raise SystemExit(f'common-ground-decks: "{what}" is kept from {BASE}’s deck and its figures differ: {", ".join(bad)}')
def check(what, ok):
    if not ok: raise SystemExit(f'common-ground-decks: the slides say {what}, and the rota does not')

def note_text(d, n):
    x = open(f'{d}/ppt/notesSlides/notesSlide{n}.xml', encoding='utf-8').read()
    return html.unescape(sorted(runs_of(x), key=len)[-1])
def swap_in(d, n, old, new):
    """Replace one sentence of a slide's notes, found exactly once — Even Step's, rebuilt from its own figures."""
    p = f'{d}/ppt/notesSlides/notesSlide{n}.xml'; x = open(p, encoding='utf-8').read()
    if x.count(escape(old)) != 1: raise SystemExit(f'{p}: {old[:70]!r} found {x.count(escape(old))} times, not once')
    open(p, 'w', encoding='utf-8').write(x.replace(escape(old), escape(new)))

# ── the pay slide's sums, as deck-polish.py writes them (checked against Even Step's own notes before they are used) ──
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

# ── the new shift times, each named for what it is ─────────────────────────────────────────────────────────────────────
KIND = lambda d: 'Sunday' if d == 'sun' else 'Saturday' if d == 'sat' else 'Weekdays'
def new_by_day():
    """{'Weekdays': [...], 'Saturday': [...], 'Sunday': [...]}: the new times worked on each kind of day, by start."""
    out = {'Weekdays': set(), 'Saturday': set(), 'Sunday': set()}
    for t in NEW:
        for d in days_of(P, t): out[KIND(d)].add(t)
    return {k: sorted(v) for k, v in out.items()}
TODAY_CLOSER = {'Weekdays': closer_start(TP, WK, '23:55'), 'Saturday': closer_start(TP, ('sat',), '23:55'), 'Sunday': closer_start(TP, ('sun',), '23:25')}
LATER = {30: '30 min', 45: '45 min', 60: '1 hour'}
def what_is(day, t):
    """A new time's note for the notes' reference list, in the words deck-polish.py gives Even Step's."""
    if t[6:] in ('23:55', '23:25'):
        (was,) = TODAY_CLOSER[day]; return f'closer, starts {LATER[mins_of(t[:5]) - mins_of(was)]} later'
    if day == 'Sunday' and t == '14:30-22:30': return 'ticket-office late'
    if day == 'Sunday' and t[:5] == '07:15':
        (op,) = sorted(u for u in TODAY_T if u[:5] == '07:15' and 'sun' in days_of(TP, u))
        return f'the opener, {_len(op) - _len(t)} min shorter'
    m = _len(t); dur = f'{m // 60} hours' if m % 60 == 0 else hm(m)
    return f'new {"early" if early(t) else "late"}, {dur}'

# ── the colleague deck ─────────────────────────────────────────────────────────────────────────────────────────────────
def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    one_turn_a, one_turn_b = F['oneTurn'].split(' of ')
    (n_times, n_known), (e_times, e_known) = tn(F), tn(E)
    check(f'{n_times} shift times, {n_known} worked today', (n_times, n_known) == (len(times(P)), len(KNOWN)))
    sg, sg_t = singles(P), singles(TP)
    sg_y, sg_y_t = round(sg * 52 / len(P)), round(sg_t * 52 / len(TP))
    lv_same = F['leaveBest'] == T['leaveBest'] and F['leaveFour'] == T['leaveFour'] and F['leaveAvg'] == T['leaveAvg'] and int(F['leaveWorst']) == int(T['leaveWorst']) + 1
    check('the leave goes as far as today’s: the same best, four weeks and average, the worst a day better', lv_same)
    check('the three shortlisted links all buy 28 at best and need 15 for four weeks off', all(o['leaveBest'] == '28' and o['leaveFour'] == '15' for o in OTHERS.values()))
    check('more single rest days than today', sg > sg_t and sg_y > sg_y_t and all(singles(grid(dp.DESIGNS[n])) < sg for n in SHORT))
    check('nothing over 8h 30m Monday to Friday; the one longer shift is a 9-hour Saturday late, not worked today',
          ms_max(P, WK) == 510 and SAT_LONG and _len(SAT_LONG) == 540 and days_of(P, SAT_LONG) == {'sat'} and not early(SAT_LONG) and SAT_LONG not in TODAY_T)
    check('today’s 13:45 and 14:20 finishes stay, and nothing finishes at 13:35',
          {'06:20-13:45', '06:20-14:20'} <= set(KNOWN) and not any(t.endswith('13:35') for t in times(P)))
    check('every working week all earlies or all lates', dp.grid_facts(GRID)['mixed'] == 0)
    # SLIDE 2: THE LEAVE TAKES THE SHIFT-TIMES TILE. The short version is five things to remember; for this design the one
    # that matters is that leave goes as far as it does today. Its 7 of 14 shift times worked today (Even Step 8 of 13) are
    # on slide 8, and "nothing over 8h 30m Monday to Saturday" in the bar is not true of the Saturday late
    s = S(2)
    put(s, f'{e_known} of {e_times}', F['leaveBest'])
    s.runs(16, ['shift times you', 'already work'], ['days off for', '14 days’ leave'])
    put(s, f'{e_times - e_known} new ones', 'at best · as today')
    put(s, 'Same hours, shorter closers, nothing over 8h\u00a030m Monday to Saturday, and never more than five days in a row, cover weeks aside.',
        'Same hours, shorter closers, 30 days off for 14\u00a0days’ leave as now, and never more than five days in a row, cover weeks aside.')
    s.save()
    same('slide 2: 35h, five days in a row (up to seven), 14 weekends a year, closers 30 min to 1 hour shorter', 'hours', 'run', 'weekendsYear', 'weekendsShort', 'closers')
    check('the weekday closer 30 minutes later, the Saturday’s an hour and the Sunday’s 45 minutes',
          [mins_of(closer_start(P, WK, '23:55')[0]) - mins_of(TODAY_CLOSER['Weekdays'][0]), mins_of(closer_start(P, ('sat',), '23:55')[0]) - mins_of(TODAY_CLOSER['Saturday'][0]),
           mins_of(closer_start(P, ('sun',), '23:25')[0]) - mins_of(TODAY_CLOSER['Sunday'][0])] == [30, 60, 45])
    notes(d, 2, 'This is the whole pitch on one slide.',
          'This is the whole pitch on one slide. Same 35-hour week as now. Leave goes as far as it does today: at its best, '
          f'14 days’ leave buys {F["leaveBest"]} days off in a row, and four full weeks off in a row, Sunday to Saturday, take {F["leaveFour"]} days’ leave, as now; the average is the same and the worst a day better. '
          'Never more than five days in a row outside the cover weeks — seven at most when a cover week falls badly and its Sunday is worked as overtime, where today it is seven and can reach nine. '
          'Seven full weekends off in every 26 weeks, against four in 20 today, and never more than five weeks apart — though each person works about two more Saturdays a year. '
          f'Every working week is all earlies or all lates, and {one_turn_a} of the {one_turn_b} working weeks keep one shift time Monday to Friday. '
          f'{WORDS[n_known].capitalize()} of the fourteen shift times are ones people already work, today’s 13:45 and 14:20 finishes among them, and nobody finishes at 13:35. '
          f'Nothing Monday to Friday is longer than 8h 30m; the longest shift is a 9-hour Saturday late, {dash(SAT_LONG)}, where today the Saturday closer is {T["closerSat"]}. '
          'And every closing shift is shorter: the weekday closer by 30 minutes, the Saturday closer by an hour and the Sunday closer by 45 minutes. '
          f'Say the cost here too, before anyone asks: more single rest days — {WORDS[sg]} in every 26 weeks, where today has {WORDS[sg_t]} in 20, so about {sg_y} a year each against {sg_y_t}. '
          'A cover week is one of the five weeks in 26 with no set shifts: its four duties are placed later to cover leave and sickness. When a slide says “cover weeks aside”, it means the other 21 weeks, whose shifts are set.')
    check('fourteen shift times', n_times == 14)
    check('seven full weekends in 26 against four in 20, at most five weeks apart, two more Saturdays a year',
          F['weekendsShort'] == '7 in 26' and T['weekendsShort'] == '4 in 20' and F['weekendGap'] == '5' and int(F['sat']) - int(T['sat']) == 2)
    check('five days in a row, seven at worst; today seven, nine at worst', F['run'] == '5 (up to 7)' and T['run'] == '7 (up to 9)')
    check('five cover weeks in 26', F['cover'].startswith('5 of 26'))

    # SLIDE 4: the weeks' range is this design's; the days are Even Step's figures exactly
    s = S(4)
    week = lambda f: f'No. The same 35-hour week on average; weeks run {f["light"]}–{f["heavy"]} Monday\u00a0to\u00a0Saturday (today {T["light"]}–{T["heavy"]}), and {WORDS[int(f["sat"]) - int(T["sat"])]} more days a year are Saturdays.'
    put(s, week(E), week(F)); s.save()
    same('slide 4’s notes: 218.6 days a year, the average shift two minutes longer', 'daysYear', 'avg')

    # SLIDE 5: the swap and short-early rows, the £, and the notes' sums (the polish's formula, proved on Even Step's first)
    pe, text_e = pay(PE, E, BASE)
    if note_text(d, 5) != text_e: raise SystemExit(f'common-ground-decks: {BASE}’s notes 5 are no longer the sums this file rebuilds; rebuild them from deck-polish.py')
    pounds, text_f = pay(P, F, NAME)
    check(f'the short earlies are the only earlies finishing before 14:00 ({F["shortYear"]} a year)', int(F['shortYear']) == dp.early_off(P))
    swap_min = lambda f: int(f['swap'].split()[0]) * (1 if f['swap'].endswith('longer') else -1)
    check('a swap for a late earns less overtime than today', swap_min(F) < swap_min(T) and int(F['shortYear']) < int(T['shortYear']) and int(F['swapShortMins']) < int(T['swapShortMins']))
    s = S(5)
    cell(s, 19, E['swap'], F['swap'], AMBER); cell(s, 23, E['shortYear'], F['shortYear'], AMBER)   # both still less than today's, as the subtitle says
    bar = lambda p: f'No: basic pay stays the same. Premium and overtime pay come to about £{p} a year less, gross, if you work your share of Sundays. That assumes no swap overtime.'
    put(s, bar(pe), bar(pounds)); s.save()
    notes(d, 5, 'Basic pay follows the 35-hour week', text_f)
    same('slide 5’s Saturday and Sunday rows', 'sat', 'sun', 'sundayPeople', 'people')

    # SLIDE 6: the averages are this design's; the bar and the notes say Monday to FRIDAY, for the Saturday late
    s = S(6)
    for i, k in ((19, 'avgEarly'), (23, 'avgLate')):
        tone = GREEN if H(F[k]) < H(T[k]) else AMBER if H(F[k]) > H(T[k]) else NAVY
        tone_e = GREEN if H(E[k]) < H(T[k]) else AMBER if H(E[k]) > H(T[k]) else NAVY
        check(f'{k} on the same side of today as {BASE}’s (the subtitle: earlies longer, lates shorter)', tone == tone_e)
        cell(s, i, E[k], F[k], tone)
    put(s, 'Every closing shift is 30 to 60 minutes shorter; nothing Monday to Saturday runs over 8h\u00a030m, and nothing at all over 9 hours.',
        'Every closing shift is 30 to 60 minutes shorter; nothing Monday to Friday runs over 8h\u00a030m, and nothing at all over 9 hours.')
    s.save()
    same('slide 6’s closers and average shift', 'closerWk', 'closerSat', 'closerSun', 'avg', 'longest')
    check('nothing at all over 9 hours', ms_max(P, DAYS) == 540)
    wk_earlies = {(sum(1 for k in P if _timed(P[k][d]) and early(P[k][d])), sum(1 for k in P if _timed(P[k][d]) and early(P[k][d]) and _len(P[k][d]) == 510)) for d in WK}
    wk_earlies_t = {(sum(1 for k in TP if _timed(TP[k][d]) and early(TP[k][d])), sum(1 for k in TP if _timed(TP[k][d]) and early(TP[k][d]) and _len(TP[k][d]) == 510)) for d in WK}
    check('three of the seven weekday earlies 8h 30m, every weekday; today two of six', wk_earlies == {(7, 3)} and wk_earlies_t == {(6, 2)})
    check('no early over 8h 30m on any day', max(_len(t) for t in times(P) if early(t)) <= 510)
    sat_long_year = round(a_year(P, lambda s_, d_: s_ == SAT_LONG))
    check('the 9-hour Saturday late is today’s 13:30–22:00 half an hour longer, two every Saturday, about four a year each',
          '13:30-22:00' in TODAY_T and SAT_LONG == '13:30-22:30' and per_day(P, SAT_LONG, ('sat',)) == {2} and sat_long_year == 4)
    head6 = note_text(d, 6).split(' Nothing Monday to Saturday runs over 8h 30m:')[0]
    if not head6.startswith('Lead with the closers:') or 'Sunday 15:15 to 23:25 instead of 14:30 (8h 10m, not 8h 55m).' not in head6:
        raise SystemExit(f'common-ground-decks: {BASE}’s notes 6 no longer open with the closers as this file keeps them')
    notes(d, 6, 'Lead with the closers:', head6 + ' Nothing Monday to Friday runs over 8h 30m, and no early on any day does. '
          'But the time the closers lose goes onto the other shifts, so more of them run to the full 8h 30m than today — three of the seven weekday earlies, where today two of six do. '
          f'The one shift over 8h 30m is the Saturday late {dash(SAT_LONG)}, 9 hours, today’s 13:30–22:00 half an hour longer: two on every Saturday, about {WORDS[sat_long_year]} a year each. '
          'Be upfront about the two minutes on the average: the 26-week link may have no more than 219 contracted days a year, so the same 35 hours go into slightly fewer, slightly longer shifts. Nothing runs over 9 hours. '
          f'On average, Monday to Saturday, the average early is {F["avgEarly"]} against {T["avgEarly"]} today, and the average late {F["avgLate"]} against {T["avgLate"]}, so the average shift hardly moves. The average late includes the closers. '
          f'Cover weeks aside, each person works about {F["earlyYear"]} earlies and {F["lateYear"]} lates a year, Monday to Saturday, against about {T["earlyYear"]} of each today; '
          f'the cover weeks add about {cover_days(P)} days a year to that, against about {cover_days(TP)} today, so the total stays just under today’s.')
    check('today’s earlies and lates the same number a year', T['earlyYear'] == T['lateYear'])

    # SLIDE 7: the 06:20 starts are this design's — four at the open every day but Sunday, as today, shared by 26
    s = S(7)
    cell(s, 15, E['open0620'], F['open0620'], NAVY); s.save()   # fewer very early starts, and fewer early finishes: neither a plain gain nor a cost
    same('slide 7’s subtitle, rows and bar: the late finishes and the shortest gap', 'late23', 'late22', 'rest', 'close', 'at22')
    opens = lambda p: {sum(1 for k in p if _timed(p[k][d]) and p[k][d][:5] == '06:20') for d in DAYS[1:]}
    check('four start at 06:20 every day but Sunday, as today', opens(P) == {4} and opens(TP) == {4} and not any(_timed(P[k]['sun']) and P[k]['sun'][:5] == '06:20' for k in P))
    check('the weekday 14:00–22:30s: the office pair and two lates finishing with it', per_day(P, '14:00-22:30', WK) == {4} and per_day(P, '14:30-22:30', WK) == {0})
    swap_in(d, 7, 'Early 06:20 starts hardly change.',
            f'Fewer 06:20 starts each: four start at 06:20 Monday to Saturday, as today, but shared among 26 people instead of 20, so about {F["open0620"]} a year each, against {T["open0620"]}.')

    # SLIDE 8: the times
    groups = new_by_day()
    s = S(8)
    put(s, f'{e_times} shift times in all — {e_known} of them you already work', f'{n_times} shift times in all — {n_known} of them you already work')
    put(s, f'You work these today ({e_known})', f'You work these today ({n_known})')
    put(s, f'New times ({e_times - e_known})', f'New times ({len(NEW)})')
    ts = [dash(t) for t in sorted(KNOWN)]; half = -(-len(ts) // 2)
    cols = [i for i, (a, b) in enumerate(spans(s.x)) if len(runs_of(s.x[a:b])) >= 3 and all(re.fullmatch(r'\d\d:\d\d–\d\d:\d\d', r) for r in runs_of(s.x[a:b]))]
    if len(cols) != 2: raise SystemExit(f'slide 8: the two columns of known times not found ({cols})')
    for i, part in zip(cols, (ts[:half], ts[half:])):
        first = runs_of(s.x[slice(*spans(s.x)[i])])[0]
        s.paras(i, first, [(0, t) for t in part])
    lines = ['Closers start later: 30 minutes on weekdays, an hour on Saturdays, 45 minutes on Sundays',
             'A new early, 07:00–15:30, and a 9-hour Saturday late, 13:30–22:30',
             'On Sundays: 07:15–15:30, 09:00–17:30 and the ticket-office late, 14:30–22:30']
    named = {t for ln in lines for t in re.findall(r'\d\d:\d\d–\d\d:\d\d', ln)}
    closers = {t for t in NEW if t[6:] in ('23:55', '23:25')}
    check(f'slide 8’s lines name every new time but the closers, and nothing else ({sorted(named)})', named <= {dash(t) for t in NEW} and {dash(t) for t in set(NEW) - closers} <= named)
    check('07:00–15:30 a new early on weekdays and Saturdays; 13:30–22:30 on Saturdays only; 07:15–15:30 and 09:00–17:30 on Sundays only',
          days_of(P, '07:00-15:30') == set(WK) | {'sat'} and days_of(P, '13:30-22:30') == {'sat'}
          and days_of(P, '07:15-15:30') == {'sun'} and days_of(P, '09:00-17:30') == {'sun'} and days_of(P, '14:30-22:30') == {'sun'} and per_day(P, '14:30-22:30', ('sun',)) == {2})
    i10 = next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:1] == ['Closers start later: 30 minutes on weekdays, an hour on Saturdays, 45 minutes on Sundays'])
    s.runs(i10, runs_of(s.x[slice(*spans(s.x)[i10])]), [joined(ln) for ln in lines])
    put(s, f'Fewer shift times than today ({e_times}, not 18) — and no early Monday to Saturday is new.', f'Fewer shift times than today ({n_times}, not {len(TODAY_T)}) — and today’s 13:45 and 14:20 finishes stay.')
    s.save()
    ref = '; '.join(f'{day}, ' + ', '.join(f'{dash(t)} ({what_is(day, t)})' for t in ts_) for day, ts_ in groups.items() if ts_)
    check('the Sunday office late a pair, the 13:30–22:30 today’s 13:30–22:00 half an hour longer', SAT_LONG[:5] == '13:30' and _len(SAT_LONG) - _len('13:30-22:00') == 30)
    ts_e, ts_i, ts_s = (tn(FIG[n]) for n in ('Even Step', 'In Step', 'Short Run'))
    check('In Step and Short Run keep the same number of today’s times, and every shortlisted link more than this one', ts_i == ts_s and all(k > n_known for _, k in (ts_e, ts_i)))
    notes(d, 8, f'{BASE} was built', f'{NAME} was built from today’s link. '
          f'{WORDS[n_known].capitalize()} of its fourteen times are worked today, and it uses fewer different times overall than today’s eighteen, '
          f'though the shortlisted links keep a few more of today’s ({ES_} {ts_e[1]} of {ts_e[0]}, {IS_} and {SR_} {ts_i[1]} of {ts_i[0]}). '
          'Today’s 06:20–13:45 stays on every weekday, and today’s 06:20–14:20 too; nobody finishes at 13:35. '
          'Three of the new times are shorter versions of today’s lates: the weekday and Saturday closers start at 15:45 and the Sunday closer at 15:15, and the Sunday office late finishes at 22:30, not 23:25. '
          'The 07:00–15:30 is a new early, 8h 30m, on weekdays and on a Saturday. The Saturday’s 13:30–22:30 is today’s weekday 13:30–22:00, half an hour longer: 9 hours. '
          'On Sundays the opener is 07:15–15:30, today’s 07:15–15:45 fifteen minutes shorter, and 09:00–17:30 is new, 8h 30m. '
          f'{dp.moved_sentence(P)} The full list is on the slide. For reference, every new time: {ref}.')
    check('today’s 06:20–13:45 and 06:20–14:20 on every weekday', all(n >= 1 for n in per_day(P, '06:20-13:45', WK) | per_day(P, '06:20-14:20', WK)))
    check('the Sunday opener today’s 07:15–15:45, 15 minutes shorter', '07:15-15:45' in TODAY_T and _len('07:15-15:45') - _len('07:15-15:30') == 15)
    check('three new times are shorter versions of today’s lates', len(closers | {'14:30-22:30'}) == 3 and _len('14:30-22:30') < _len('14:30-23:25') and '14:30-23:25' in TODAY_T)

    # SLIDE 9: the breaks and the one-turn weeks are this design's; the breaks' share is today's, so not coloured green
    rl, rl_t = dp.rest_lens(P), dp.rest_lens(TP)
    share, share_t = sum(1 for n in rl if n >= 2) / len(rl), sum(1 for n in rl_t if n >= 2) / len(rl_t)
    check(f'{F["breaks"]} rest-day breaks of two days or more', F['breaks'] == f'{sum(1 for n in rl if n >= 2)} of {len(rl)}')
    s = S(9)
    for i, k, tone in ((15, 'breaks', GREEN if share > share_t + 0.05 else AMBER if share < share_t - 0.05 else NAVY), (23, 'oneTurn', GREEN)):
        cell(s, i, E[k], F[k], tone)
    s.save()
    same('slide 9’s weekends, run and bar', 'weekendsYear', 'run', 'rest', 'weekendGap', 'weekendsShort')
    ne_a, ne_b = E['oneTurn'].split(' of ')
    swap_in(d, 9, f'and {ne_a} of the {ne_b} keep one shift time Monday to Friday', f'and {one_turn_a} of the {one_turn_b} keep one shift time Monday to Friday')
    rl_e = dp.rest_lens(PE)
    old_breaks = (f'Rest days mostly come in pairs: {rl_e.count(2)} of the {len(rl_e)} rest-day breaks are two days and the other {WORDS[rl_e.count(1)]} single days, none longer; '
                  f'today {T["breaks"]} are two days or more, {WORDS[sum(1 for n in rl_t if n > 2)]} of them three or four days (about {round(sum(1 for n in rl_t if n > 2) * 52 / len(TP))} a year each). '
                  f'Single rest days stay at {WORDS[rl_e.count(1)]}, as today, so fewer a year each: about {round(rl_e.count(1) * 52 / len(PE))}, against {sg_y_t}.')
    check('two days, three days and single days, nothing longer', set(rl) == {1, 2, 3} and rl.count(3) == 2)
    swap_in(d, 9, old_breaks,
            f'Rest days mostly come in pairs: {rl.count(2)} of the {len(rl)} rest-day breaks are two days, {WORDS[rl.count(3)]} are three days and the other {WORDS[sg]} single days; '
            f'today {T["breaks"]} are two days or more, {WORDS[sum(1 for n in rl_t if n > 2)]} of them three or four days (about {round(sum(1 for n in rl_t if n > 2) * 52 / len(TP))} a year each). '
            f'Single rest days go up from {WORDS[sg_t]} to {WORDS[sg]}, about {sg_y} a year each against {sg_y_t}. Every layout found that keeps 30 days off for 14 days’ leave has more than {WORDS[singles(PE)]}.')
    check('no six-day weeks (today one)', not any(sum(1 for dd in DAYS if _timed(P[k][dd])) >= 6 for k in P) and sum(1 for k in TP if sum(1 for dd in DAYS if _timed(TP[k][dd])) >= 6) == 1)

    # SLIDE 10: the picture is this design's 26 weeks; the bar and the notes quote figures it shares with Even Step
    strip(d)
    same('slide 10’s bar and notes: the blocks, the weekends’ spacing, the Sundays', 'block', 'blockUpTo', 'weekendGap', 'sun')
    per_kind = lambda p, days: {(sum(1 for k in p if _timed(p[k][dd]) and early(p[k][dd])), sum(1 for k in p if _timed(p[k][dd]) and not early(p[k][dd]))) for dd in days}
    check('a weekday 7 earlies and 8 lates, a Saturday 7 and 7, a Sunday 5 and 5', [per_kind(P, WK), per_kind(P, ('sat',)), per_kind(P, ('sun',))] == [{(7, 8)}, {(7, 7)}, {(5, 5)}])

    # SLIDE 11: the leave, as today
    s = S(11)
    for i, k in ((7, 'leaveBest'), (19, 'leaveFour')):
        cell(s, i, E[k], F[k], NAVY)   # today's figures again: not a gain against today, as Even Step's were a cost
    put(s, f'Best stretch {E["leaveBest"]} days, not {T["leaveBest"]}; four full weeks off in a row, Sunday to Saturday, costs {E["leaveFour"]}\u00a0days’ leave, not {T["leaveFour"]}. Average the same, worst a day better.',
        f'As today: 14 days’ leave buys up to {F["leaveBest"]} days off, and four full weeks off in a row, Sunday to Saturday, take {F["leaveFour"]}\u00a0days’ leave. Average the same, worst a day better.')
    s.save()
    notes(d, 11, 'Leave is only needed on working days', 'Leave is only needed on working days Monday to Saturday; rest days and Sundays cost nothing. '
          f'Today there is one stretch of the roster where 14 days buys 30 days off, and {NAME} has such a stretch too, so its best is {F["leaveBest"]} as well. '
          f'On average it is the same, {F["leaveAvg"]} days, and at its worst it is a day better than today. Four full weeks off (Sunday to Saturday) take {F["leaveFour"]} days of leave at best, as today. '
          'Say this plainly, as it is what the design is for: each of the three shortlisted links needs 15 days for four weeks off and buys 28 at best, and people plan a year around it. '
          'What it costs is on slide 13: more single rest days. The averages depend on where you count a booking as starting, so quote those as “about the same”.')

    # SLIDE 12: four at the open, as today, but on a Sunday; more at 22:00 every day and at the close on six days
    nums = lambda v: [int(n) for n in v.split(' · ')]
    more = lambda key: [a > b for a, b in zip(nums(F[key]), nums(T[key]))]
    check('more at 22:00 every day and at the close on weekdays and Saturdays, at the open only on Sunday', more('at22') == [True] * 3 and more('close') == [True, True, False] and more('open') == [False, False, True])
    s = S(12)
    put(s, 'More people rostered every day, and more at the open and the close on most days', 'More people rostered every day, more at 22:00, and more at the close on most days')
    s.save()
    same('slide 12’s rows and bar', 'dailyWk', 'dailyWeekend', 'floorMin', 'ff')
    dp.explain_h55(NAME, F)
    swap_in(d, 12, f'those seven days can come to {E["h55"]} hours', f'those seven days can come to {F["h55"]} hours')

    # SLIDE 13: the trade-offs — the leave card becomes the single rest days, the new times are this design's
    s = S(13)
    shorter = {t for t in NEW if not early(t) and any((u[:5] == t[:5] or u[6:] == t[6:]) and _len(u) > _len(t) for u in TODAY_T)}
    sunday_earlies = {t for t in NEW if early(t) and days_of(P, t) == {'sun'}}
    check('the new times are three shorter lates, a 07:00 early, a 9-hour Saturday late and two Sunday earlies',
          len(shorter) == 3 and sorted(set(NEW) - shorter - sunday_earlies) == ['07:00-15:30', SAT_LONG] and len(sunday_earlies) == 2)
    put(s, f'{WORDS[e_times - e_known].capitalize()} new shift times to learn', f'{WORDS[len(NEW)].capitalize()} new shift times to learn')
    put(s, 'Three shorter versions of today’s lates, a new 8h\u00a015m late and the 9-hour Sunday early.', 'Three shorter lates, a new 07:00 early, a 9-hour Saturday late and two Sunday earlies.')
    put(s, f'Four weeks off: {E["leaveFour"]} days’ leave, not {T["leaveFour"]}', 'More single rest days')
    put(s, 'The least leave for four complete weeks off in a row, Sunday to Saturday.', f'{WORDS[sg].capitalize()} in 26 weeks, about {sg_y} a year each (today\u00a0about\u00a0{sg_y_t}).')   # kept together: "(today" ended a line
    eo, eo_t = dp.early_off(P), dp.early_off(TP)
    put(s, f'{dp.early_off(PE)} a year each finish before 14:00 (today {eo_t}).', f'{eo} a year each finish before 14:00 (today {eo_t}).')
    s.save()
    check('fewer early finishes than today', eo < eo_t)
    same('slide 13’s other cards: the blocks, the Saturdays, the late finishes', 'block', 'blockUpTo', 'sat', 'late23', 'late22')

    # SLIDE 14: the table's own rows are deck-check.mjs's; the costs line gains the single rest days
    p14 = f'{d}/ppt/slides/slide14.xml'; dp.replace_run(p14, E['times'], F['times'])
    s = S(14)
    put(s, 'The costs: more late finishes and longer runs of earlies or lates.', 'The costs: more late finishes, more single rest days and longer runs of earlies or lates.')
    s.save()
    # SLIDE 15: the credit line is Even Step's with the longer name, which pushed "tooling" onto a line of its own at 12pt;
    # at 11pt it is one line again (measured from the PDF)
    s = S(15)
    i = shape_of(s, f'{BASE} · {BCODE} · every figure worked out from the rota by the Marylebone Roster app and its tooling')
    s.sub(i, 'sz="1200"', 'sz="1100"', count=2); s.save()

def strip(d):
    """Slide 10's picture, drawn by rota-strip.mjs from this design's grid, in Even Step's place and at its size."""
    png = os.path.join(tempfile.mkdtemp(), 'strip.png')
    subprocess.check_call(['node', os.path.join(TOOL, 'rota-strip.mjs'), os.path.join(TOOL, GRID), png], stdout=subprocess.DEVNULL)
    media = f'{d}/ppt/media/rota-strip.png'
    size = lambda f: struct.unpack('>II', open(f, 'rb').read(24)[16:24])
    if size(png) != size(media): raise SystemExit(f'slide 10: the strip is {size(png)}, {BASE}’s {size(media)}; the picture’s frame is sized for the old one')
    shutil.copy(png, media); shutil.rmtree(os.path.dirname(png))

# ── the managers' deck ─────────────────────────────────────────────────────────────────────────────────────────────────
def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    sg, sg_t = singles(P), singles(TP)
    s = S(1)
    put(s, 'The recommended new CEA link, in ten minutes', 'A new CEA link proposal, in ten minutes')
    put(s, f'For managers · from 1 January 2027 · 26 weeks · code {BCODE} · the full proposal sheet has the detail', f'For managers · from 1 January 2027 · 26 weeks · code {BCODE} · not on the shortlist')
    s.save()
    s = S(2)
    put(s, 'Every December staffing rule met — and no shift over 8h 30m, Monday to Saturday.', 'Every December staffing rule met — and 30 days off for 14 days’ leave, as now.')
    s.save()
    same('slide 2’s four numbers', 'met', 'hours', 'people')
    check('no avoidable fatigue warning, cover weeks aside', dp.first(F['ff']) == 0)
    # SLIDE 3: four at the open, the minimum — the same as today but on a Sunday, so not coloured as a gain
    s = S(3)
    cell(s, 11, E['open'], F['open'], NAVY); s.save()
    same('slide 3’s other rows and bar', 'daily', 'at22', 'close', 'floor')
    check('four at the open every day, the minimum', F['open'] == '4 · 4 · 4')
    if not note_text(d, 3).endswith('which is what keeps its late finishes down.'): raise SystemExit('managers’ notes 3 no longer end as this file expects')
    swap_in(d, 3, 'which is what keeps its late finishes down.', f'which is what keeps its late finishes down. Four at the open is the minimum too, and {NAME} rosters four every day, Sunday included.')
    # SLIDE 4: the fit
    c = f'{d}/ppt/charts/chart1.xml'; x = open(c, encoding='utf-8').read()
    cv = lambda v: f'<c:v>{float(v):g}</c:v>'   # the labels' own format writes 10 as 10.0, so the cache holds 10
    for k in ('fitWk', 'fitSat', 'fitSun'):
        if x.count(cv(E[k])) != 1: raise SystemExit(f'chart: {cv(E[k])} found {x.count(cv(E[k]))} times')
        x = x.replace(cv(E[k]), cv(F[k]))
    open(c, 'w', encoding='utf-8').write(x)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'; wb = openpyxl.load_workbook(xp); ws = wb.active; col = None
    for row in ws.iter_rows():
        for c_ in row:
            if c_.value == BASE: col = c_.column
    if col is None: raise SystemExit('chart workbook: no design column')
    for r, k in ((2, 'fitWk'), (3, 'fitSat'), (4, 'fitSun')):
        if abs(float(ws.cell(row=r, column=col).value) - float(E[k])) > 1e-9: raise SystemExit(f'chart workbook: row {r} is not {BASE}’s {E[k]}')
        ws.cell(row=r, column=col).value = float(F[k])
    wb.save(xp)
    o = OTHERS
    check('the weakest weekday fit of the four, a Saturday between theirs, a closer Sunday than all three; slightly weaker: under a tenth of today’s score behind the best',
          all(float(F['fitWk']) > float(v['fitWk']) for v in o.values()) and min(float(v['fitSat']) for v in o.values()) < float(F['fitSat']) < max(float(v['fitSat']) for v in o.values())
          and len({v['fitSun'] for v in o.values()}) == 1 and all(float(F['fitSun']) < float(v['fitSun']) for v in o.values())
          and float(F['fitWk']) - min(float(v['fitWk']) for v in o.values()) <= 0.1 * float(T['fitWk']))
    check('the staffing follows the trains more closely every day, far more at weekends', float(F['fitWk']) < float(T['fitWk']) and all(float(F[k]) < 0.5 * float(T[k]) for k in ('fitSat', 'fitSun')))
    alt = subprocess.check_output(['node', '-e', "import('./report-data.mjs').then(async m => { const fs = await import('node:fs'); const j = JSON.parse(fs.readFileSync('" + GRID + "', 'utf8')); const p = j.patterns ?? j; "
                                   "for (const k in p) for (const d of ['mon','tue','wed','thu','fri']) if (p[k][d] === '11:00-19:30') p[k][d] = '11:30-20:00'; process.stdout.write(m.assess(p, 26).office.wkFit.toFixed(1)); })"], cwd=TOOL, text=True)
    alt_fit = alt.strip()
    check(f'an 11:30–20:00 in place of today’s 11:00–19:30 would fit the weekday better ({alt_fit} against {F["fitWk"]})', '11:00-19:30' in KNOWN and days_of(P, '11:00-19:30') == set(WK) and float(alt_fit) < float(F['fitWk']))
    head4 = note_text(d, 4).split(f' {ES_} scores')[0]
    if not head4.endswith('the rules on the previous slide are the requirement.'): raise SystemExit('managers’ notes 4 no longer open as this file expects')
    notes(d, 4, 'The score compares', head4 + f' {NAME} scores {F["fitWk"]} on weekdays, {F["fitSat"]} on a Saturday and {F["fitSun"]} on a Sunday, against today’s {T["fitWk"]}, {T["fitSat"]} and {T["fitSun"]}; lower is closer. '
          f'Beside the three shortlisted links, its weekday fit is the weakest ({ES_} {o["Even Step"]["fitWk"]}, {IS_} {o["In Step"]["fitWk"]}, {SR_} {o["Short Run"]["fitWk"]}), '
          f'its Saturday fit between theirs ({ES_} {o["Even Step"]["fitSat"]}, {IS_} {o["In Step"]["fitSat"]}, {SR_} {o["Short Run"]["fitSat"]}), and its Sunday a little closer (theirs {o["Even Step"]["fitSun"]}). '
          f'Part of the gap is today’s 11:00–19:30, kept on weekdays where an 11:30–20:00 would score {alt_fit}.')
    # SLIDE 5: the weeks' range and the Sunday's hours
    swap_in(d, 5, f'from {E["light"]} to {E["heavy"]} Monday to Saturday (today', f'from {F["light"]} to {F["heavy"]} Monday to Saturday (today')
    swap_in(d, 5, f'{E["sunHours"]} of overtime each Sunday against {T["sunHours"]}', f'{F["sunHours"]} of overtime each Sunday against {T["sunHours"]}')
    same('slide 5’s rows, bar and the rest of its notes', 'people', 'hours', 'cover', 'sundayPeople', 'sun', 'daysYear')
    # SLIDE 6: the 55-hour week
    swap_in(d, 6, f'seven days can reach {E["h55"]} hours', f'seven days can reach {F["h55"]} hours')
    same('slide 6’s rows', 'ff', 'run', 'rest', 'longest')
    # SLIDE 7: WHY THIS ONE, FROM OUTSIDE THE SHORTLIST. What it shares with all three is checked against it as the polish
    # checks the three; what it adds is its own against every one of them; what it costs, against them and against today
    s = S(7)
    put(s, 'What all three shortlisted links give, what this one adds, and what it costs', 'What it shares with the shortlisted links, what it adds, and what it costs')
    check('all 9 December rules and no avoidable fatigue warning, like all three', F['met'] == '9' and all(v['met'] == '9' for v in o.values()) and dp.first(F['ff']) == 0)
    check(f'{F["weekendsYear"]} full weekends a year, at most {F["weekendGap"]} weeks apart, like all three', all(v['weekendsYear'] == F['weekendsYear'] and int(v['weekendGap']) <= 5 for v in o.values()) and int(F['weekendGap']) <= 5)
    check('no shift over 9 hours and every closer shorter, like all three', H(F['longest']) <= 540 and all(H(F[k]) < H(T[k]) for k in ('closerWk', 'closerSat', 'closerSun')))
    for old, new in ((f'All three: all 9 December rules; no avoidable fatigue warning, cover weeks aside', 'Like all three: all 9 December rules; no avoidable fatigue warning, cover weeks aside'),
                     (f'All three: {E["weekendsYear"]} full weekends off a year each (today {T["weekendsYear"]}), at most 5 weeks apart', f'Like all three: {F["weekendsYear"]} full weekends off a year each (today {T["weekendsYear"]}), at most {F["weekendGap"]} weeks apart'),
                     ('All three: no shift over 9 hours, and every closing shift shorter', 'Like all three: no shift over 9 hours, and every closing shift shorter'),
                     ('This one adds: no shift over 8h 30m and every early one of today’s times, Mon–Sat', f'Like all three: fewer shift times than today’s {T["times"]} — here {tn(F)[0]}, {tn(F)[1]} worked today'),
                     (f'Shift times: {tn(E)[0]} (today {T["times"]}), {tn(E)[1]} of them worked today', 'This one adds: 30 days off for 14 days’ leave, and four weeks off for 14, as now'),
                     ('This one costs: lates near today’s 8h 30m, and a slightly weaker weekday fit', f'This one costs: {WORDS[sg]} single rest days, not {WORDS[singles(PE)]}, and a slightly weaker weekday fit')):
        put(s, old, new)
    check('fewer shift times than today, on all three and this one', tn(F)[0] < int(T['times']) and all(tn(v)[0] < int(T['times']) for v in o.values()))
    check('the shortlisted links all have four single rest days', all(singles(grid(dp.DESIGNS[n])) == singles(PE) for n in SHORT) and sg > singles(PE))
    put(s, 'What all three cost: more late finishes, two more Saturdays a year, a\u00a0day\u00a0more\u00a0leave\u00a0for\u00a0four\u00a0weeks\u00a0off.',
        f'Like the shortlisted three, it costs more late finishes and {WORDS[int(F["sat"]) - int(T["sat"])]} more Saturdays a year.')
    s.save()
    check('more late finishes than today, as all three', int(F['late23']) > int(T['late23']) and all(v['late23'] == F['late23'] for v in o.values()))
    check('one shift time Monday to Friday in more weeks than any of the three, and the gentlest change of start',
          all(int(F['oneTurn'].split()[0]) > int(v['oneTurn'].split()[0]) for v in o.values()) and all(H(F['step']) < H(v['step']) for v in o.values()))
    check('five at the open Monday to Saturday on all three shortlisted links', all(v['open'].startswith('5 · 5') for v in o.values()))
    check('nothing over 8h 30m Monday to Saturday on Even Step', ms_max(PE, DAYS[1:]) == 510)
    sat_long_year = round(a_year(P, lambda s_, d_: s_ == SAT_LONG))
    notes(d, 7, f'{ES_} is the recommended design.',
          f'{NAME} (4 November 2026) is today’s link taken to 26 weeks: today’s 13:45 and 14:20 kept as the openers’ finishes, closers from 15:45 Monday to Saturday, an even Sunday, '
          'and 14 days’ leave buying 30 days off as it does today, on weeks that meet every rule. It is in the pack, but not on the shortlist. '
          f'What it adds, against the three shortlisted links: four weeks off for {F["leaveFour"]} days’ leave, where they need 15, and {F["leaveBest"]} days off for 14 at best, where they buy 28; '
          f'one shift time Monday to Friday in {F["oneTurn"]} weeks, where they have {o["Even Step"]["oneTurn"].split()[0]}; and the gentlest change of start from one week to the next, {F["step"]} on average '
          f'({ES_} {o["Even Step"]["step"]}, {IS_} {o["In Step"]["step"]} and {SR_} {o["Short Run"]["step"]}; today {T["step"]}). '
          f'What it costs, against them: {WORDS[sg]} single rest days in 26 weeks, where they have four (today four in 20); a slightly weaker weekday fit to the trains, {F["fitWk"]} '
          f'({ES_} {o["Even Step"]["fitWk"]}, {IS_} {o["In Step"]["fitWk"]} and {SR_} {o["Short Run"]["fitWk"]}; today {T["fitWk"]}); and four at the open, the minimum, where they have five Monday to Saturday. '
          f'Its shift times are no more familiar than theirs: {tn(F)[1]} of its {tn(F)[0]} are worked today ({ES_} {tn(o["Even Step"])[1]} of {tn(o["Even Step"])[0]}, {IS_} and {SR_} {tn(o["In Step"])[1]} of {tn(o["In Step"])[0]}), '
          f'and counted Monday to Saturday its share, {familiar_ms(P)}%, is between theirs ({ES_} {familiar_ms(PE)}%, {SR_} {familiar_ms(grid(dp.DESIGNS["Short Run"]))}%, {IS_} {familiar_ms(grid(dp.DESIGNS["In Step"]))}%). '
          f'Its one shift over 8h 30m is a 9-hour Saturday late, {dash(SAT_LONG)}, about {WORDS[sat_long_year]} a year each; {ES_} has none Monday to Saturday, '
          f'{IS_} about {long_ms(grid(dp.DESIGNS["In Step"]))} a year each and {SR_} about {long_ms(grid(dp.DESIGNS["Short Run"]))}. '
          'Every closing shift is 30 to 60 minutes shorter than today’s. '
          f'The costs it shares with all three are in the bar: {F["late23"]} finishes a year at 23:00 or later against {T["late23"]}, and {F["sat"]} Saturdays against {T["sat"]}.')
    check('the three shortlisted share one shift time in 18 of 21 weeks', len({v['oneTurn'] for v in o.values()}) == 1)
    fam = {n: familiar_ms(grid(f)) for n, f in dp.DESIGNS.items()}
    check(f'this one’s familiar share between the shortlisted links’ ({familiar_ms(P)} against {fam})', min(fam.values()) < familiar_ms(P) < max(fam.values()))
    check('In Step and Short Run keep the same number of today’s times, more than this one', tn(o['In Step']) == tn(o['Short Run']) and tn(o['In Step'])[1] > tn(F)[1] and tn(o['Even Step'])[1] > tn(F)[1])
    check('long duties: Even Step none Monday to Saturday, In Step and Short Run more than this one', long_ms(PE) == 0 and min(long_ms(grid(dp.DESIGNS[n])) for n in ('In Step', 'Short Run')) > long_ms(P) == sat_long_year)
    check('every Sunday duty 8h to 8h 30m (an even Sunday); closers from 15:45 Monday to Saturday',
          {_len(P[k]['sun']) for k in P if _timed(P[k]['sun'])} <= set(range(480, 511)) and closer_start(P, DAYS[1:], '23:55') == ['15:45'])
    check('In Step and Short Run start-time changes the same', o['In Step']['step'] == o['Short Run']['step'])
    # SLIDE 8: what colleagues will notice — a gain against today in place of Even Step's 8h 30m, the rest days in place of its leave
    s = S(8)
    s.runs(5, ['More weekends off', f'{E["weekendsYear"]} full weekends a year, not {T["weekendsYear"]}', 'Fewer days in a row', f'{dp.first(E["run"])} at most, not {dp.first(T["run"])}', 'Nothing over 8h 30m, Mon–Sat', f'today’s longest is {T["longest"]}'],
           ['More weekends off', f'{F["weekendsYear"]} full weekends a year, not {T["weekendsYear"]}', 'Fewer days in a row', f'{dp.first(F["run"])} at most, not {dp.first(T["run"])}', 'Shorter closing shifts', f'{F["closerWk"]} every day, not up to {T["closerSat"]}'])
    check('every closer 8h 10m; today’s longest the Saturday closer', len({F[k] for k in ('closerWk', 'closerSat', 'closerSun')}) == 1 and H(T['closerSat']) == max(H(T[k]) for k in ('closerWk', 'closerSat', 'closerSun')))
    pe, _ = pay(PE, E, BASE); pounds, _ = pay(P, F, NAME)
    sg_y, sg_y_t = round(sg * 52 / len(P)), round(sg_t * 52 / len(TP))
    s.runs(9, ['More late finishes', f'{E["late22"]} a year at 22:00 or later, not {T["late22"]}', 'More leave for four weeks off', f'{E["leaveFour"]} days, not {T["leaveFour"]}', 'Less premium and overtime pay', f'about £{pe} a year, gross, for\u00a0a\u00a0full\u00a0share\u00a0of\u00a0Sundays, swaps\u00a0aside'],
           ['More late finishes', f'{F["late22"]} a year at 22:00 or later, not {T["late22"]}', 'More single rest days', f'about {sg_y} a year, not {sg_y_t}', 'Less premium and overtime pay', f'about £{pounds} a year, gross, for\u00a0a\u00a0full\u00a0share\u00a0of\u00a0Sundays, swaps\u00a0aside'])
    put(s, 'Expect late finishes and leave first — the colleague presentation answers both.', 'Expect late finishes and single rest days first — the colleague presentation answers both.')
    s.save()
    rl_t = dp.rest_lens(TP)
    notes(d, 8, 'Figures are per person, a year', 'Figures are per person, a year, with cover weeks aside, as on the slide. '
          f'Days at work are {F["daysYear"]} a year, Monday to Saturday, just under today’s 219; Sunday is overtime. '
          f'Finishes at 23:00 or later rise by about three a year each, all from the December staffing: three to the close every day, where today has two Monday to Saturday, so no link meeting the rules could have fewer. '
          f'Finishes at 22:00 or later rise from about {T["late22"]} to {F["late22"]}: the rules want five still on duty at 22:00, and two floor lates finish at 22:30 with the ticket office every weekday, which makes {WORDS[dp.first(F["at22"])]}. '
          f'Leave is only needed for working days, Monday to Saturday. Today one stretch lets 14 days’ leave buy 30 days off; this link has such a stretch too, and four whole weeks off take {F["leaveFour"]} days, as today; on average 14 days goes as far as today, {F["leaveAvg"]} days off. '
          f'The price is in the rest days: {WORDS[sg]} single rest days in 26 weeks, about {sg_y} a year each against {sg_y_t} today, where the shortlisted links have four. '
          f'Blocks of earlies or lates run up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks beside them go the same way (today {T["block"]}, up to {T["blockUpTo"]}), and two rest-day breaks are three days, where today {WORDS[sum(1 for n in rl_t if n > 2)]} are three or four days. '
          'The two extra Saturdays come from aiming for fourteen on a Saturday. '
          f'The pay figure is gross premium and overtime pay at the CEA rate of £{PAY["rate"]:.2f}, for someone working their full share of Sundays and no swap overtime; basic pay does not change. '
          f'On average, swapping an early for a late pays less on this link: on the same day a late is {F["swap"].replace("min", "minutes")} than an early, against {T["swap"].replace("min", "minutes")} today, and the shortest earlies, the 13:35 and 13:45 finishes that add most when swapped, fall from about {T["shortYear"]} a year each to {F["shortYear"]}. Other swaps may still add paid time. '
          f'No shift Monday to Friday is over 8h 30m; the one longer shift is the Saturday {dash(SAT_LONG)}, 9 hours. '
          f'Not on the slide, but worth having to hand: one shift time Monday to Friday in {F["oneTurn"]} weeks (today {T["oneTurn"]}), every closing shift 30 to 60 minutes shorter, the shortest rest between shifts {F["rest"]} (today {T["rest"]}), '
          f'at least {F["floorMin"]} on the floor at all times (today {T["floorMin"]}), {len(NEW)} of the {len(times(P))} shift times new to learn, and {F["late23"]} finishes a year at 23:00 or later (today {T["late23"]}). The full comparison is on the proposal sheet.')
    check('seven at 22:00 on a weekday: the office pair and two floor lates on 14:00–22:30, and the three closers', F['at22'].startswith('7 ·') and per_day(P, '14:00-22:30', WK) == {4} and per_day(P, '15:45-23:55', WK) == {3})
    check('late finishes three more a year; three to the close every day, today two Monday to Saturday', int(F['late23']) - int(T['late23']) == 3 and F['close'] == '3 · 3 · 3' and T['close'].startswith('2 · 2'))
    check('two three-day breaks; blocks longer than today', dp.rest_lens(P).count(3) == 2 and int(F['block']) > int(T['block']))
    # SLIDE 10: the sheet's fingerprint is the rename's (with the name and the code)

# ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
# Even Step's text that must not survive into Common Ground's decks: its new times, its counts of times, its leave, its
# Monday-to-Saturday claim, its heaviest week, its open, its fit, its pay and swaps, its 55-hour week, its breaks and
# one-turn weeks, its "adds" and "costs" lines, its recommendation. The figures the two share are deliberately absent.
# Matched with no-break spaces and word joiners read as plain spaces, so "8h\u00a030m" cannot slip past "8h 30m".
ES_ONLY = re.compile(
    r'12:15–|09:00–\u2060?18:00|06:20–14:00|41h 30m|^13 \(8 you know\)$|^8 of 13$|^5 new ones$|[Ff]ive new shift|\(13, not 18\)|13 shift times in all'
    r'|You work these today \(8\)|New times \(5\)|[Ee]ight of its thirteen|£250|£290|10h 50m|^5 min longer$|56\.8|83h 30m|^5 · 5 · 4$|^32\.6$'
    r'|22 of 26|18 of the 21|^18 of 21$|four of the seven weekday earlies|its best is 28|^Best stretch 28|15 days’ leave, not 14|^15 days, not 14$'
    r'|[Nn]othing (over 8h 30m|Monday to Saturday runs over)|no early Monday to Saturday is new|[Rr]ecommended|^All three:'
    r'|twice a year each|9-hour Sunday early|d1921b7a|ES-26-T5|no shift over 8h 30m|every early one of today|lates near today'
    r'|today’s longest is|More leave for four weeks off|and leave first|day more leave')
plain = lambda t: t.replace('\u00a0', ' ').replace('\u2060', '')

def rename(d):
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith(('.xml', '.rels')): continue
            p = os.path.join(root, f); x = open(p, encoding='utf-8').read()
            y = x.replace(BASE, NAME).replace(BCODE, CODE).replace(BFP, FP)
            if y != x: open(p, 'w', encoding='utf-8').write(y)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'
    if os.path.exists(xp):
        wb = openpyxl.load_workbook(xp); ws = wb.active; hit = False
        for row in ws.iter_rows():
            for cell in row:
                if cell.value == BASE: cell.value = NAME; hit = True
        if hit: wb.save(xp)

def build(who, edit):
    src, out = os.path.join(SRC, f'{BASE.replace(" ", "-")}-for-{who}.pptx'), os.path.join(OUT, f'{NAME.replace(" ", "-")}-for-{who}.pptx')
    d = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(d)
    try:
        texts = lambda: [(f, t[0] or t[1]) for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml')
                         for t in re.findall(r'<a:t>([^<]*)</a:t>|<c:v>([^<]*)</c:v>', open(os.path.join(r, f), encoding='utf-8').read())]
        named = lambda: {(f, x) for f, t in texts() for x in re.split(r'(?<=[.;?!])\s+', t) if BASE in x}   # by sentence: a note edited elsewhere keeps its own
        before = named()
        edit(d)
        # the rename turns every "Even Step" into "Common Ground", which is right for Even Step's own runs (its footers, titles,
        # headers and the sentences kept above, whose figures same() has checked) and wrong for a sentence written here ABOUT
        # Even Step: those carry a no-break space (ES_). A sentence of this file's that names it with an ordinary space is refused
        mine = sorted(named() - before)
        if mine: raise SystemExit(f'{out}: text written here names {BASE} with an ordinary space, which the rename would turn into {NAME} —\n  ' + '\n  '.join(f'{f}: {t[:90]!r}' for f, t in mine))
        # before the rename: another design's name with an ordinary space is a sentence of Even Step's left in place (its own
        # deliberate mentions were written with a no-break space, and so are this file's)
        stray = [f'{f}: {t[:90]!r}' for f, t in texts() if re.search(r'In Step|Short Run|Closing Time|Grand Tour|Fair Share', t)]
        if stray: raise SystemExit(f'{out}: another design named before the rename —\n  ' + '\n  '.join(stray))
        rename(d)
        left = [f'{f}: {t[:90]!r}' for f, t in texts() if ES_ONLY.search(plain(t)) or re.search(r'Even Step|ES-26', t)]
        chart = f'{d}/ppt/charts/chart1.xml'   # the fit chart's cache: Even Step's three values, as the chart labels write them
        if os.path.exists(chart): left += [f'chart1.xml: {v}' for v in (E['fitWk'], E['fitSat'], E['fitSun']) if f'<c:v>{float(v):g}</c:v>' in open(chart, encoding='utf-8').read()]
        if left: raise SystemExit(f'{out}: text that is not {NAME}’s —\n  ' + '\n  '.join(left))
        os.makedirs(OUT, exist_ok=True)
        tmp = out + '.tmp'
        with zipfile.ZipFile(src) as zs, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for n in zs.namelist(): z.write(os.path.join(d, n), n)   # the source's own part order, [Content_Types].xml first
        os.replace(tmp, out)
    finally:
        shutil.rmtree(d, ignore_errors=True)   # a refused build leaves nothing behind
    return out

if __name__ == '__main__':
    for who, edit in (('colleagues', colleagues), ('managers', managers)):
        print('wrote', os.path.relpath(build(who, edit)))
