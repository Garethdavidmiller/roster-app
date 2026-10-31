# THE DECK POLISH (3 Oct 2026, from the reader's critique of the pack; owner: "do all of your suggestions"). Runs AFTER the
# design builders and edits the shipped decks in place (since 31 Oct 2026 Even Step's, In Step's and Short Run's, the shortlist; a
# design's name on the command line polishes only its pair), so the cross-cutting changes live here once instead of
# threaded through every builder's expected text:
#   · the four-weeks-off leave cost is said early (notes 2), on the leave slide's takeaway and on the trade-offs slide;
#   · full weekends off are per year first, as the sheets say them (owner, 2 Oct 2026), with the rotation count beside;
#   · days a year is 218.6 against 219.0, and days a week 4.19 against 4.20, never a rounded "219 | 219";
#   · the one-turn row says what it counts; the fit slide says what its score is;
#   · slide 10 becomes a picture of the 26 weeks (rota-strip.mjs) instead of three prose cards;
#   · the manager "Why" slide separates what every link in the pack gives, what this one adds and what it costs.
# Every figure comes from `deck-check.mjs --print` (the sheets' own counts) or is computed from the grid here; shapes are
# found by their text, so a template change fails loudly. From the repository root, after the builders:
#   python3 docs/links-26/tooling/deck-polish.py && node docs/links-26/tooling/deck-check.mjs
import importlib.util, json, os, re, shutil, struct, subprocess, tempfile, zipfile

TOOL = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(TOOL, '..', 'presentations')
spec = importlib.util.spec_from_file_location('snd', os.path.join(TOOL, 'second-nature-decks.py')); snd = importlib.util.module_from_spec(spec); spec.loader.exec_module(snd)
Slide, spans, runs_of, escape, GREEN, NAVY, AMBER = snd.Slide, snd.spans, snd.runs_of, snd.escape, snd.GREEN, snd.NAVY, snd.AMBER
FIG = json.loads(subprocess.check_output(['node', os.path.join(TOOL, 'deck-check.mjs'), '--print'], text=True))
T = FIG['today']
# Only the shortlist's decks are shipped (owner, 3 Oct 2026): since 30 Oct 2026 that is In Step and Short Run (owner: "Only do
# the shortlist for instep and short run"), so Second Edition's, Even Keel's and Closing Time's decks went, as Second Wind's
# and Second Sight's did on 3 Oct. Their wording is in git; Second Edition's builder stays, as Short Run's is built on it.
# Even Step joined them on 31 Oct 2026, recommended (owner: "Do your suggestions"; "Yes, keep all three").
DESIGNS = {'Even Step': 'even-step.json', 'In Step': 'in-step.json', 'Short Run': 'short-run.json'}
# the shortlist is fresh.mjs's, read rather than restated (four from 30 Oct 2026, when Closing Time joined; two that evening; three since 31 Oct 2026, with Even Step): every deck's
# manager "Why" slide and leave notes say what ALL of them share, so a copy here that fell behind would put a claim on
# a slide about a design it was never checked against
SHORTLIST = tuple(re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', open(os.path.join(TOOL, 'fresh.mjs'), encoding='utf-8').read()).group(1)))
ALL = 'both' if len(SHORTLIST) == 2 else f"all {'zero one two three four five six'.split()[len(SHORTLIST)]}"   # "both", "all four"
# DECKS FOR A DESIGN OFF THE SHORTLIST, made because the owner asked (30 Oct 2026: "Create presentations for instep"). Its
# manager "Why" slide says what it shares with the shortlisted links instead of speaking as one of them, and every line it
# shares is checked against it too. A design that joins the shortlist leaves this list in the same change, or the
# assertion stops the polish: its slide would go on speaking from outside the shortlist it had joined.
OFF_SHORTLIST = ()   # In Step's, until it joined the shortlist the same evening
assert set(DESIGNS) == set(SHORTLIST) | set(OFF_SHORTLIST) and not set(SHORTLIST) & set(OFF_SHORTLIST), \
    f'decks are built for {sorted(DESIGNS)} but the shortlist is {sorted(SHORTLIST)} and the designs off it {sorted(OFF_SHORTLIST)}'
if len(SHORTLIST) != len(set(SHORTLIST)): raise SystemExit(f'a name twice in the shortlist: {SHORTLIST}')   # the set comparison passes it; "all five" would not
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
WORDS = 'zero one two three four five six seven eight nine ten'.split(); ORDS = 'zeroth first second third fourth fifth sixth'.split()

# WHAT EVERY "ALL FOUR" LINE RESTS ON, CHECKED BEFORE A DECK IS TOUCHED (30 Oct 2026 review). The manager "Why" slide prints
# three lines about the whole shortlist on every design's deck, and the comparison above proves only that each shortlisted
# design HAS decks: a design that broke one of the lines would have been printed under it. Each is checked here against
# every design's own figures (deck-check.mjs --print, the sheets' counts); a check that fails stops the polish.
H = lambda v: int(v.split('h')[0]) * 60 + int(v.split('h')[1].strip().rstrip('m'))   # "8h 10m" → 490
first = lambda v: int(v.split(' ')[0])                                             # "5 (up to 6)", "18 of 21" → the first figure
SL = {n: FIG[n] for n in (*SHORTLIST, *OFF_SHORTLIST)}   # an off-shortlist deck prints these lines as shared, so they must be its too
def every(what, ok):
    bad = [n for n, f in SL.items() if not ok(f)]
    if bad: raise SystemExit(f'deck-polish: "{what}" is printed for {ALL} shortlisted, and is not true of {", ".join(bad)}')
def same(what, key):
    vals = {f[key] for f in SL.values()}
    if len(vals) != 1: raise SystemExit(f'deck-polish: "{what}" is printed as shared, and is not: ' + ', '.join(f'{n} {f[key]}' for n, f in SL.items()))
    return vals.pop()
def explain_h55(name, f):
    """Is the fatigue worst case the 55-hour week the notes explain? Refused if it is anything else (31 Oct 2026)."""
    if f['ff'] == '0': return False
    if f['ff'] == '0 (up to 1)' and f['h55']: return True
    raise SystemExit(f'deck-polish: {name}’s fatigue worst case is {f["ff"]}, not the 55-hour week the notes explain')
every('all 9 December rules', lambda f: f['met'] == '9')
# on the FIXED rota (31 Oct 2026): a cover week worked with its Sunday as overtime can make a 55-hour week, so the worst
# case is "0 (up to 1)" on both — the line says what holds of the fixed rota, and the tables carry the rest
every('no avoidable fatigue warning on the fixed rota', lambda f: first(f['ff']) == 0)
same('full weekends off a year', 'weekendsYear'); GAP = max(int(f['weekendGap']) for f in SL.values())
every('no shift over 9 hours', lambda f: H(f['longest']) <= 9 * 60)
every('every closing shift shorter', lambda f: all(H(f[k]) < H(T[k]) for k in ('closerWk', 'closerSat', 'closerSun')))
every('four weeks off takes more leave than today', lambda f: int(f['leaveFour']) > int(T['leaveFour']))   # the leave notes on slide 11
# slide 12's subtitle (colleagues): more on duty every day, and more at the open and the close on most days — "most" because
# no shortlisted design has more than today's 3 at the Sunday close (Closing Time, while shortlisted, had today's 4 at the Saturday open)
lo_hi = lambda v: [(min(x), max(x)) for x in ([int(n) for n in part.split('–')] for part in v.split(' · '))]   # "11–12 · 10 · 8"
def more_on(f, key, days_needed):
    """More than today on at least `days_needed` of the week's seven days (a weekday counts five), and fewer on none."""
    d, t = lo_hi(f[key]), lo_hi(T[key])
    days = 5 * (d[0][0] > t[0][1]) + (d[1][0] > t[1][1]) + (d[2][0] > t[2][1])
    return days >= days_needed and all(d[i][0] >= t[i][1] for i in range(3))
every('more people rostered every day', lambda f: more_on(f, 'daily', 7))
every('more at the open on most days', lambda f: more_on(f, 'open', 4))
every('more at the close on most days', lambda f: more_on(f, 'close', 4))

def shape_of(s, text):
    hits = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) == [escape(text)]]
    if len(hits) != 1: raise SystemExit(f'{s.path}: {text!r} found in {len(hits)} shapes')
    return hits[0]
def put(s, old, new, color=None): s.text(shape_of(s, old), old, new, color)
def set_shape(s, i, new, color=None): s.text(i, runs_of(s.x[slice(*spans(s.x)[i])])[0].replace('&amp;', '&'), new, color)
def tile(s, i, olds, new):
    """A short-version tile's caption or sub-caption, by index (the designs' sub-captions differ): shape i must hold one of
    `olds`. A newline in `new` is a deliberate break — every caption is two lines with no lone last word, every
    sub-caption one, so the number, caption and sub-caption bands line up across the row."""
    cur = runs_of(s.x[slice(*spans(s.x)[i])]); old = next((o for o in olds if [escape(o)] == cur), None)
    if old is None: raise SystemExit(f'{s.path} shape {i}: {cur} is none of {olds}')
    s.text(i, old, new)
def replace_run(path, old, new, after=None):
    """Replace one <a:t> run in a slide's XML (a table cell or a list item), optionally the first one after another run."""
    x = open(path, encoding='utf-8').read(); start = 0
    if after is not None:
        start = x.find(f'<a:t>{escape(after)}</a:t>'); assert start >= 0, f'{path}: {after!r} not found'
    i = x.find(f'<a:t>{escape(old)}</a:t>', start); assert i >= 0, f'{path}: {old!r} not found after {after!r}'
    x = x[:i] + f'<a:t>{escape(new)}</a:t>' + x[i + len(f'<a:t>{escape(old)}</a:t>'):]; open(path, 'w', encoding='utf-8').write(x)
def replace_in_run(path, old_sub, new_sub):
    """Replace a phrase inside exactly one <a:t> run of a slide."""
    x = open(path, encoding='utf-8').read(); hits = [m for m in re.finditer(r'<a:t>([^<]*)</a:t>', x) if escape(old_sub) in m.group(1)]
    assert len(hits) == 1, f'{path}: {old_sub!r} in {len(hits)} runs'; m = hits[0]
    open(path, 'w', encoding='utf-8').write(x[:m.start(1)] + m.group(1).replace(escape(old_sub), escape(new_sub)) + x[m.end(1):])
def drop_shape(s, text):
    """Remove the one shape whose only run is `text` (the ~7pt footnotes beside the footer, unreadable when projected: their
    sentence goes to the speaker notes instead)."""
    a, b = spans(s.x)[shape_of(s, text)]; s.x = s.x[:a] + s.x[b:]
def notes_edit(d, n, old, new):
    p = f'{d}/ppt/notesSlides/notesSlide{n}.xml'; x = open(p, encoding='utf-8').read()
    assert escape(old) in x, f'{p}: {old[:50]!r} not in notes'; open(p, 'w', encoding='utf-8').write(x.replace(escape(old), escape(new), 1))
def notes_append(d, n, extra):
    p = f'{d}/ppt/notesSlides/notesSlide{n}.xml'; x = open(p, encoding='utf-8').read(); r = max(runs_of(x), key=len)
    open(p, 'w', encoding='utf-8').write(x.replace(f'<a:t>{r}</a:t>', f'<a:t>{r} {escape(extra)}</a:t>', 1))

TODAY_P = json.loads(subprocess.check_output(['node', '-e', "import('./report-data.mjs').then(m => process.stdout.write(JSON.stringify(m.today().patterns)))"], cwd=TOOL, text=True))
_timed = lambda s: re.match(r'^\d\d:\d\d-\d\d:\d\d$', s or '') is not None
_len = lambda s: (int(s[6:8]) * 60 + int(s[9:]) - int(s[:2]) * 60 - int(s[3:5])) % 1440
def wk_early(p):
    """The longest early (a start before 11:00) Monday to Friday, as the decks write a duration: "8h 55m"."""
    m = max(_len(p[k][d]) for k in p for d in DAYS[1:6] if _timed(p[k][d]) and int(p[k][d][:2]) < 11)
    return f'{m // 60}h {m % 60:02d}m'
def an(s):
    """'an 8h 10m', 'a 42h 30m'."""
    return ('an ' if re.match(r'(8|11|18)\D', s) else 'a ') + s
def per_year(p, test):
    return sum(1 for k in p for d in DAYS if _timed(p[k][d]) and test(p[k][d], d)) * 52 / len(p)
def long_shifts(p):
    """Shifts over 8h 30m, each a year."""
    return round(per_year(p, lambda s, d: _len(s) > 510))
def long_wk_earlies(p):
    """Earlies (a start before 11:00) over 8h 30m, Monday to Friday, each a year."""
    return round(per_year(p, lambda s, d: d in DAYS[1:6] and int(s[:2]) < 11 and _len(s) > 510))
def sat_new(p):
    """How many Saturday times today's link does not work at all."""
    today = {TODAY_P[k][d] for k in TODAY_P for d in DAYS if _timed(TODAY_P[k][d])}
    return len({p[k]['sat'] for k in p if _timed(p[k]['sat'])} - today)
def shorter_lates(p):
    """How many of a design's NEW times are shorter versions of one of today's lates: a late (from 11:00) that today does
    not work, sharing its start or its end with a time today works and shorter than it — In Step's 15:45 and 15:15 closers
    and its 22:30 office late."""
    today = {TODAY_P[k][d] for k in TODAY_P for d in DAYS if _timed(TODAY_P[k][d])}
    new = {p[k][d] for k in p for d in DAYS if _timed(p[k][d])} - today
    return sum(1 for t in new if int(t[:2]) >= 11 and any((u[:5] == t[:5] or u[6:] == t[6:]) and _len(u) > _len(t) for u in today))

def grid_facts(grid):
    p = json.load(open(os.path.join(TOOL, grid)))['patterns']; L = len(p)
    timed = lambda s: re.match(r'^\d\d:\d\d-\d\d:\d\d$', s or '') is not None
    fam = lambda s: 'E' if int(s[:2]) * 60 + int(s[3:5]) < 660 else 'L'
    kinds = {}
    for k in range(1, L + 1):
        ts = [p[str(k)][d] for d in DAYS]
        kinds[k] = 'C' if all(t == 'SPARE' for t in ts) else (lambda f: f.pop() if len(f) == 1 else 'M')(set(fam(t) for t in ts if timed(t)))
    # whether every change of family happens across a cover week. (The longest run of one family is
    # NOT computed here any more: blocks.mjs owns that figure, read in through F["block"]/F["blockUpTo"],
    # and a third definition that disagreed with both of its two was removed in the 24-hour review.)
    switches_across_cover = True; last = None
    for k in range(1, L + 1):
        f = kinds[k]
        if f == 'C': last = None; continue
        if last and f != last and f in ('E', 'L'): switches_across_cover = False
        if f in ('E', 'L'): last = f
    return {'L': L, 'kinds': kinds, 'switches_across_cover': switches_across_cover, 'mixed': sum(1 for v in kinds.values() if v == 'M')}

def strip_slide(d, name, grid, F):
    """Slide 10: the 26 weeks as a strip (rota-strip.mjs), in place of the three prose cards."""
    png = os.path.join(tempfile.gettempdir(), f'strip-{name.replace(" ", "-")}.png')
    subprocess.check_call(['node', os.path.join(TOOL, 'rota-strip.mjs'), os.path.join(TOOL, grid), png], stdout=subprocess.DEVNULL)
    media = f'{d}/ppt/media/rota-strip.png'; shutil.copy(png, media)
    w, h = struct.unpack('>II', open(png, 'rb').read(24)[16:24]); cy = round(8229600 * h / w)   # the PNG's own aspect, never stretched
    assert cy <= 4069080 - 1371600, f'strip too tall for the slide: {w}×{h}'
    rels = f'{d}/ppt/slides/_rels/slide10.xml.rels'; r = open(rels, encoding='utf-8').read()
    assert 'rota-strip.png' not in r
    r = r.replace('</Relationships>', '<Relationship Id="rIdStrip" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/rota-strip.png"/></Relationships>')
    open(rels, 'w', encoding='utf-8').write(r)
    p = f'{d}/ppt/slides/slide10.xml'; x = open(p, encoding='utf-8').read()
    # drop the three cards (every shape and picture between the subtitle and the takeaway box) and the pictures in them
    sp = list(re.finditer(r'<p:(sp|pic)>.*?</p:\1>', x, re.S))
    keep = []
    for m in sp:
        t = ' '.join(re.findall(r'<a:t>([^<]*)</a:t>', m.group(0)))
        off = re.search(r'<a:off x="(\d+)" y="(\d+)"/>', m.group(0))
        y = int(off.group(2)) if off else 0
        keep.append(not (m.group(1) == 'pic' or (1_300_000 < y < 4_000_000 and not t.startswith('Earlies'))))
    body = x
    for m, k in reversed(list(zip(sp, keep))):
        if not k: body = body[:m.start()] + body[m.end():]
    facts = grid_facts(grid); L = facts['L']
    pic = ('<p:pic><p:nvPicPr><p:cNvPr id="990" name="Rota strip" descr="The 26 weeks of the link"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
           '<p:blipFill><a:blip r:embed="rIdStrip"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
           f'<p:spPr><a:xfrm><a:off x="457200" y="1371600"/><a:ext cx="8229600" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
    # the picture goes before the takeaway box, which is the first remaining shape below y = 4,000,000
    anchor = re.search(r'<p:sp>(?:(?!</p:sp>).)*?<a:off x="457200" y="4160520"/>', body, re.S); assert anchor, 'takeaway box not found'
    body = body[:anchor.start()] + pic + body[anchor.start():]
    open(p, 'w', encoding='utf-8').write(body)
    s = Slide(p)
    put(s, 'Earlies, lates and Sundays', 'Your 26 weeks at a glance')
    put(s, 'The balance you have now stays much the same', 'The green bars are the full weekends off; where you start is decided later')
    upto_banner = f', {F["blockUpTo"]} if the cover weeks go the same way' if int(F["blockUpTo"]) > int(F["block"]) else ''
    put(s, 'Much the same balance. Sundays stay overtime and still finish at 23:25.', f'{F["weekendsYear"]} full weekends off a year, at most five weeks apart; blocks of earlies or lates up to {F["block"]} weeks{upto_banner}{", and every switch from one kind to the other crosses a cover week" if facts["switches_across_cover"] else ""}.')
    s.save()
    upto = (f'; because a cover week’s duties are placed later, a block can run to {F["blockUpTo"]} if the cover weeks beside it are given the same kind (today {T["blockUpTo"]})'
            if int(F["blockUpTo"]) > int(F["block"]) else '; the cover weeks cannot lengthen it')
    notes_after_10 = f'A block is weeks in a row all on earlies or all on lates. On the fixed rota the longest is {F["block"]} weeks (today {T["block"]}){upto}. Fewer switches between earlies and lates, but someone who prefers one kind waits longer for it to come round.'
    snd.notes(d, 10, 'Earlies here means', f'Read the strip left to right; week 27 is week 1 again. A cover week has no fixed shifts of its own — its four duties are placed later to cover leave and sickness, which is why it is drawn empty. Earlies here means a start before 11:00. A weekday has 7 earlies and 8 lates; a Saturday 7 and 7; a Sunday 5 and 5. Sundays stay overtime, {F["sun"]} a year each (today {T["sun"]}), and still finish at 23:25. Who starts on which week is decided after the link is chosen.')
    notes_append(d, 10, notes_after_10)

def colleagues(d, name, grid, F):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    put(s, '7 in 26', F['weekendsYear'])
    tile(s, 4, ['the same contracted week'], 'the contracted\nweek, as now'); tile(s, 5, ['no extra contracted hours'], 'no extra hours')
    tile(s, 8, ['most days in a row'], 'most days\nin a row')                        # its sub-caption is one line already, in every design
    tile(s, 12, ['full weekends off'], 'full weekends\noff a year'); tile(s, 13, ['at most 5 weeks apart'], f'today {T["weekendsYear"]} · {F["weekendsShort"]}')
    tile(s, 16, ['shift times you already work'], 'shift times you\nalready work')
    tile(s, 20, ['shorter on every closing shift'], 'off every\nclosing shift')
    sub = runs_of(s.x[slice(*spans(s.x)[21])])[0]
    tile(s, 21, ['45 min on a Sunday', '1h 15m on a Saturday', 'up to 1 hour'],
         {'45 min on a Sunday': 'Sundays: 45 min', '1h 15m on a Saturday': 'Saturdays: 1h 15m'}.get(sub, sub))
    s.save()
    notes_append(d, 2, f'Say the leave cost here too, before anyone asks: four full weeks off, Sunday to Saturday, takes {F["leaveFour"]} days’ leave rather than {T["leaveFour"]}, and the best 14-day stretch is {F["leaveBest"]} days off rather than {T["leaveBest"]}; the average is the same and the worst a day better. A cover week is one of the five weeks in 26 with no fixed shifts: its four duties are placed later to cover leave and sickness; the fixed rota is the other 21 weeks, whose shifts are set.')
    s = S(4)
    a, b = shape_of(s, '4.2'), shape_of(s, '4.19'); assert a < b, 'today left of proposal'
    put(s, '4.2', T['daysWeek'])
    both = [i for i, (x0, x1) in enumerate(spans(s.x)) if runs_of(s.x[x0:x1]) == ['219']]; assert both == [14, 15], both   # today's, then the proposal's (second-nature-decks.py sets shape 15)
    set_shape(s, both[0], T['daysYear']); set_shape(s, both[1], F['daysYear'], NAVY)
    put(s, 'No. Exactly the same 35-hour week — and no more contracted days than today.', f'No. The same 35-hour week on average and no more days; weeks run from {F["light"]} to {F["heavy"]} (today {T["light"]} to {T["heavy"]}), and two more of the days fall on a Saturday.')
    s.save()
    # THE LONGEST EARLY, SAID FOR MONDAY TO SATURDAY WHERE THAT IS THE POINT (31 Oct 2026, Even Step): its longest early
    # anywhere is the Sunday 09:00–18:00, overtime that all three shortlisted links share, so "the longest early turn goes
    # from 8h 30m to 9h 00m" would be true and say the opposite of what the design is for. A design whose every shift
    # Monday to Saturday is within today's longest early says that instead; the others keep the sentence.
    P6 = json.load(open(os.path.join(TOOL, grid), encoding='utf-8'))['patterns']
    ms_longest = max(_len(P6[k][dd]) for k in P6 for dd in DAYS[1:] if _timed(P6[k][dd]))
    if ms_longest <= H(T['longestEarly']):
        replace_in_run(f'{d}/ppt/slides/slide6.xml', ' shorter, and nothing runs over 9 hours.', f' shorter; nothing Monday to Saturday runs over {ms_longest // 60}h\u00a0{ms_longest % 60:02d}m, and nothing at all over 9 hours.')   # no-break: "8h" ended a line
    else:
        replace_in_run(f'{d}/ppt/slides/slide6.xml', ' shorter, and nothing runs over 9 hours.', f' shorter; the longest early turn goes from {T["longestEarly"]} to {F["longestEarly"]}, and nothing runs over 9 hours.')
    s = S(7)
    put(s, f'A little — about {F["late23"]} a year each, against {T["late23"]} today', f'{int(F["late23"]) - int(T["late23"])} more a year after 23:00 ({F["late23"]}, today {T["late23"]}); {int(F["late22"]) - int(T["late22"])} more at 22:00 or later ({F["late22"]}, today {T["late22"]})')
    s.save()
    if int(F['late23']) - int(T['late23']) != 3: raise SystemExit(f'deck-polish: slide 7 says three more after 23:00; {name} has {F["late23"]}, today {T["late23"]}')
    replace_run(f'{d}/ppt/slides/slide7.xml', 'Three more late finishes a year — the fewest the rules allow — and every closer is shorter.', 'More people stay on after 22:00 under the December staffing; the three more after 23:00 are the fewest the rules allow.')
    # NOT AVERAGES ON 26 WEEKS (the deck review, 30 Oct 2026): a year is exactly two turns of the link, so the yearly figures
    # are everyone's, whichever line they start on. Slide 5's notes say so and already leave the cover weeks out; slide 7's
    # gain the line the slide drops.
    for n in (5, 7):
        s = S(n); drop_shape(s, 'Yearly figures are averages from the fixed rota; cover-week duties are not included.'); s.save()
    notes_append(d, 7, 'The yearly figures are the fixed rota’s, which everyone works through twice a year; a cover week’s duties are not known yet and are left out.')
    s = S(9)
    put(s, 'Full weekends off', 'Full weekends off, about a year'); put(s, '4 in 20', T['weekendsYear']); put(s, '7 in 26', F['weekendsYear'], GREEN)
    put(s, 'Weeks on one turn, Monday to Friday', 'Weeks on one turn, no early–late switch')
    s.save()
    replace_in_run(f'{d}/ppt/slides/slide9.xml', 'Seven weekends off in 26,', f'{F["weekendsYear"]} full weekends off a year,')
    strip_slide(d, name, grid, F)
    s = S(11)
    put(s, 'About the same. A cover week still counts as at most 4 days of leave, as now.', f'Best stretch {F["leaveBest"]} days, not {T["leaveBest"]}; four full weeks off, Sunday to Saturday, costs {F["leaveFour"]} days’ leave, not {T["leaveFour"]}. Average the same, worst a day better.')
    s.save()
    plainly = f'{ALL} shortlisted links are worse than today here' if name in SHORTLIST else f'{name} and {ALL} shortlisted links are worse than today here'
    notes_edit(d, 11, 'The exact averages depend on where you count a booking as starting, so quote them as “about the same”.', f'Say the four-weeks figure plainly: {plainly} (Long Break, the leave-first design in the pack, keeps the 14), and people plan a year around it. The averages depend on where you count a booking as starting, so quote those as “about the same”.')
    # SLIDE 3'S STAFFING CARD said "more at the open and the close": the rules raise the open only on a Sunday (four; today
    # three), the close Monday to Saturday (three; today two) and the 22:00 headcount every day (five) — the deck review
    nums = lambda v: [int(n) for n in v.split(' · ')]
    if not (nums(T['open'])[:2] == [4, 4] and max(nums(T['close'])[:2]) < 3 and max(nums(T['at22'])) < 5):
        raise SystemExit(f'deck-polish: slide 3 says the rules add people at the close and at 22:00, not the open; today reads {T["open"]}, {T["close"]}, {T["at22"]}')
    s = S(3); put(s, 'At least 10 on a Sunday, and more at the open and the close. We also aim for 14 on a Saturday.', 'At least 10 on a Sunday, and more at the close and at 22:00. We also aim for 14 on a Saturday.'); s.save()
    s = S(12); put(s, 'More people rostered every day, at the open and the close', 'More people rostered every day, and more at the open and the close on most days'); s.save()   # checked above, for every design
    s = S(13)
    put(s, 'Best leave stretch: 28 days, not 30', f'Four weeks off: {F["leaveFour"]} days’ leave, not {T["leaveFour"]}')
    # under "each one is on the full proposal sheet too": the 14-day stretches are not on it (slide 11 has them), so the line
    # is the sheet's own page-2 note on the four-week figure (30 Oct 2026 review)
    put(s, 'Average as today, and the worst a day better.', 'The least leave for four complete weeks off, Sunday to Saturday.')   # the sheet's words, cut to fit the tile
    put(s, 'Five cover weeks', 'Two more Saturdays a year')
    put(s, 'Spaced evenly: weeks 1, 6, 11, 16 and 21.', f'{F["sat"]} a year each, today {T["sat"]} — fourteen on a Saturday, shared across 26 lines.')
    s.save()
    p14 = f'{d}/ppt/slides/slide14.xml'
    replace_run(p14, '219', T['daysYear'], after='Contracted days at work a year'); replace_run(p14, '219', F['daysYear'], after='Contracted days at work a year')
    replace_run(p14, '4 in 20', T['weekendsYear'], after='Full weekends off'); replace_run(p14, '7 in 26', F['weekendsYear'], after='Full weekends off'); replace_run(p14, 'Full weekends off', 'Full weekends off, about a year')
    # THE FATIGUE CELLS CARRY THE WORST CASE (31 Oct 2026), as today's "4 (up to 5)" beside them does: with a cover week's
    # Sunday worked as overtime the four can make a 55-hour week, which the sheets give as "0 (up to 1)"
    for n in (12, 14): replace_run(f'{d}/ppt/slides/slide{n}.xml', '0', F['ff'], after='Avoidable fatigue warnings in the fixed rota')
    if explain_h55(name, F): notes_append(d, 12, f'The “up to 1” beside the fatigue warnings is a 55-hour week. If a cover week’s four duties come straight after a busy week, and its Sunday is worked as overtime too, those seven days can come to {F["h55"]} hours, which the rail industry’s guidance flags. Where the four fall, and whether the Sunday is worked, is for the roster office.')

def managers(d, name, grid, F):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    tile(s, 4, ['December rules met'], 'December\nrules met')
    tile(s, 8, ['contract rostered exactly, on average'], 'contracted hours\na week'); tile(s, 9, ['Monday to Saturday'], 'Mon–Sat average')
    tile(s, 12, ['avoidable fatigue warnings'], 'avoidable\nfatigue warnings'); tile(s, 13, ['in the fixed rota · today 4'], 'fixed rota · today 4')
    tile(s, 16, ['people on the link'], 'people\non the link')
    s.save()
    s = S(6); drop_shape(s, 'Early starts and a weekly rotation come with every link, so are not counted. The written source of the 13-day limit is still to be confirmed.'); s.save()
    replace_run(f'{d}/ppt/slides/slide6.xml', '0', F['ff'], after='Avoidable fatigue warnings, fixed rota')   # the worst case too, as on the colleagues' slides
    if explain_h55(name, F): notes_append(d, 6, f'The “up to 1” beside the fatigue warnings is the rail industry’s 55-hour guideline: worked as four 8-hour duties straight after a busy line, with its Sunday as overtime too, a cover week can make {F["h55"]} hours in seven days. Where the four fall, and whether the Sunday is worked, is for the roster office.')
    # the dropped line's first half the notes already say ("come with every weekly link … not counted"), so only the second
    # goes on; and the FF19 sentence says what its reading is and what the stricter one would mean (the deck review)
    notes_append(d, 6, 'The written source of the 13-day limit is still to be confirmed.')
    notes_edit(d, 6, 'is counted on our reading and should be confirmed by whoever assesses it.',
               'is counted on our reading, in which a rest day breaks the run, and whoever assesses it should confirm that: on the stricter reading every link has it (FF19 on the rules sheet).')
    s = S(4)
    drop_shape(s, 'A measure of the day’s shape only — not a staffing requirement or a passenger forecast.')
    notes_edit(d, 4, 'It is a guide to shape, not a staffing requirement —', 'It is a guide to shape, not a staffing requirement or a passenger forecast —')   # the dropped line, without saying "not a staffing requirement" twice
    # "much closer" on weekdays only where the weekday score is under about 60% of today's (Short Run's 56%, In Step's 57%; Closing Time's was 70%)
    closer = 'Closer to the December pattern every day, much closer at the weekend.' if float(F['fitWk']) > 0.6 * float(T['fitWk']) else 'Much closer to the December pattern every day.'
    put(s, 'Much closer to the December pattern on weekdays, Saturday and Sunday.', f'{closer} The score: hour by hour, how far staffing sits from the trains; 0 would track them exactly.')
    s.save()
    s = S(7)
    ticks = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) == ['✓']]; assert len(ticks) == 6, ticks
    times = re.match(r'(\d+) \((\d+) you know\)', F['times']); n_times, n_known = int(times.group(1)), int(times.group(2)); n_new = n_times - n_known
    # WHAT THIS ONE ADDS IS WHAT THE OTHERS HAVE NOT, CHECKED (30 Oct 2026; three designs since 31 Oct). Each line is measured
    # against every other shortlisted design: Short Run's old line (five-day runs, the most weeks on one turn, the fewest late
    # finishes) is In Step's too, and In Step's "five at the Saturday open" was Short Run's as well. Each names the design's own
    # edge and is refused if another has it. In Step's edge is not the fit: its three days added together are the closest, but
    # counted day by day across a week Short Run's is a shade closer (the review of In Step's decks, 30 Oct 2026). Even Step
    # took two of In Step's three (today's 13:45 and the 8h 10m Saturday closer are its too) and Short Run's "half the long
    # earlies" (it has none), so both lines were rewritten on 31 Oct 2026 for what is still theirs alone.
    others = [FIG[n] for n in SHORTLIST if n != name]
    P = (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, grid), encoding='utf-8')))   # `grid` is the design's file
    grid_of = lambda n: (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, DESIGNS[n]), encoding='utf-8')))
    O = [grid_of(n) for n in SHORTLIST if n != name]
    today_times = {TODAY_P[k][dd] for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd])}
    ms_long = lambda g: round(per_year(g, lambda s, dd: dd != 'sun' and _len(s) > 510))   # shifts over 8h 30m Monday to Saturday, each a year
    ms_new_earlies = lambda g: len({g[k][dd] for k in g for dd in DAYS[1:] if _timed(g[k][dd]) and int(g[k][dd][:2]) < 11} - today_times)
    edge = {'Even Step': ms_long(P) == 0 < min(ms_long(g) for g in O) and ms_new_earlies(P) == 0 < min(ms_new_earlies(g) for g in O),
            'Short Run': float(F['fitWk']) < min(float(o['fitWk']) for o in others) and sat_new(P) == 0 < min(sat_new(g) for g in O),
            'In Step': H(F['heavy']) < min(H(o['heavy']) for o in others) and float(F['fitSat']) < min(float(o['fitSat']) for o in others)}[name]
    if not edge: raise SystemExit(f'deck-polish: {name}’s "This one adds" line is no longer its own among the shortlist')
    adds = {'Even Step': 'This one adds: no shift over 8h 30m Mon–Sat; every early a time worked today',
            'Short Run': 'This one adds: the closest weekday fit, and no new Saturday time',
            'In Step': f'This one adds: no week over {F["heavy"]}, and the closest Saturday fit'}[name]
    # WHAT IT COSTS IS AGAINST TODAY, as the bar beneath and the four weeks' leave are (30 Oct 2026). Short Run's line was "one
    # 42h 30m week (today up to 43h 50m)": heavier than In Step's, and lighter than today's, so it read as a cost and was not
    # one. Both now name their long weekday earlies, where today no early is over 8h 30m: In Step's 40 a year, Short Run's
    # 20. Refused if either stops being a cost against today. Even Step has no weekday early over 8h 30m, so its line names
    # the cost it does carry against today, the two more Saturdays a year each (31 Oct 2026), which the colleagues' slide 13
    # shows too.
    if long_wk_earlies(P) > long_wk_earlies(TODAY_P):
        costs = f'Costs: {long_wk_earlies(P)} weekday earlies a year over 8h 30m; four weeks off {F["leaveFour"]} days, not {T["leaveFour"]}'
    elif int(F['sat']) > int(T['sat']):
        costs = f'Costs: {WORDS[int(F["sat"]) - int(T["sat"])]} more Saturdays a year each; four weeks off {F["leaveFour"]} days, not {T["leaveFour"]}'
    else: costs = None
    if not (costs and int(F['leaveFour']) > int(T['leaveFour'])):
        raise SystemExit(f'deck-polish: {name}’s "Costs" line is no longer a cost against today')
    times_line = f'{n_known} of {n_times} shift times worked today; {n_new} new, {WORDS[shorter_lates(P)]} shorter versions of today’s lates'
    # true of every shortlisted design, or it would not be on every deck: the flexible rules are left out, as the ticks have no
    # room for them; every one meets all three, which the managers' notes 2 and 3 say
    lead = f'{ALL.capitalize()} shortlisted' if name in SHORTLIST else f'Like {ALL} shortlisted'   # an off-shortlist design shares them
    labels = [f'{lead}: all 9 December rules; no avoidable fatigue warning, fixed rota',   # one line: "on the fixed rota" wrapped
              f'{lead}: about {F["weekendsYear"]} full weekends off a year (today {T["weekendsYear"]}), at most {GAP} apart',
              f'{lead}: no shift over 9 hours, and every closing shift shorter',
              adds, times_line, costs]
    for i, (t, lab) in enumerate(zip(ticks, labels)): set_shape(s, t + 1, lab)
    set_shape(s, ticks[-1], '–')
    ell = ticks[-1] - 1   # the circle behind the dash is amber, as the worries on slide 8 are: a cost is not a benefit (the deck review)
    if 'prst="ellipse"' not in s.x[slice(*spans(s.x)[ell])]: raise SystemExit('deck-polish: no circle behind the costs line')
    s.sub(ell, GREEN, AMBER, 2)
    bars = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) and runs_of(s.x[a:b])[0].startswith('The trade-off')]; assert len(bars) == 1
    if int(F['late23']) != 42: raise SystemExit(f'deck-polish: the bar says 42 is the rules’ minimum; {name} has {F["late23"]}')
    set_shape(s, bars[0], f'Late finishes: {F["late23"]} a year each (today {T["late23"]}) — the rules’ minimum. The colleague deck shows every cost openly.')
    set_shape(s, 1, f'What {ALL} shortlisted links give, what this one adds, and what it costs' if name in SHORTLIST
              else f'What it shares with the shortlisted links, what it adds, and what it costs')
    s.save()
    s = S(5)
    put(s, '4 — 1 week in 5', '4 in 20 (1 in 5)'); put(s, '5 — 1 week in 5', '5 in 26 (1 in 5.2)')
    put(s, 'Six more people, 35 hours a week on average — Sundays still rely on overtime.', f'Six more people, 35 hours a week on average; Sunday overtime {F["sunHours"]} a week across the link (today {T["sunHours"]}).')
    s.save()
    s = S(9)
    put(s, 'Three things confirmed verbally (29 Sep and 1 Oct 2026), two decisions left', 'Three things confirmed verbally, two decisions left, two points still open')
    put(s, 'Who begins on which week of the link.', 'Who begins on which week. Open: the 13-day limit’s written source; the FF19 reading.')
    s.save()
    replace_run(f'{d}/ppt/slides/slide8.xml', '7 weekends off, at most 5 weeks apart', f'{F["weekendsYear"]} full weekends off a year (today {T["weekendsYear"]})')

def polish(path, name, grid, who):
    d = tempfile.mkdtemp(); zipfile.ZipFile(path).extractall(d)
    (colleagues if who == 'colleagues' else managers)(d, name, grid, FIG[name])
    names = zipfile.ZipFile(path).namelist()
    extra = [os.path.relpath(os.path.join(r, f), d) for r, _, fs in os.walk(d) for f in fs if os.path.relpath(os.path.join(r, f), d) not in names]
    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in names + extra: z.write(os.path.join(d, n), n)
    os.replace(tmp, path); shutil.rmtree(d)

if __name__ == '__main__':
    import sys
    names = sys.argv[1:] or list(DESIGNS)   # a name on the command line polishes only that design's freshly built decks
    bad = [n for n in names if n not in DESIGNS]
    if bad: raise SystemExit(f'deck-polish: no design {bad}; the designs are {list(DESIGNS)}')
    for name in names:
        for who in ('colleagues', 'managers'):
            polish(os.path.join(OUT, f'{name.replace(" ", "-")}-for-{who}.pptx'), name, DESIGNS[name], who)
    print('polished', ', '.join(names))
