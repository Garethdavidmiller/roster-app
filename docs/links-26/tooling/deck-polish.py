# THE DECK POLISH (3 Oct 2026, from the reader's critique of the pack; owner: "do all of your suggestions"). Runs AFTER the
# three design builders and edits the six shipped decks in place, so the cross-cutting changes live here once instead of
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
Slide, spans, runs_of, escape, GREEN, NAVY = snd.Slide, snd.spans, snd.runs_of, snd.escape, snd.GREEN, snd.NAVY
FIG = json.loads(subprocess.check_output(['node', os.path.join(TOOL, 'deck-check.mjs'), '--print'], text=True))
T = FIG['today']
DESIGNS = {'Second Edition': 'second-edition.json', 'Short Run': 'short-run.json', 'Even Keel': 'even-keel.json'}
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

def grid_facts(grid):
    p = json.load(open(os.path.join(TOOL, grid)))['patterns']; L = len(p)
    timed = lambda s: re.match(r'^\d\d:\d\d-\d\d:\d\d$', s or '') is not None
    fam = lambda s: 'E' if int(s[:2]) * 60 + int(s[3:5]) < 660 else 'L'
    kinds = {}
    for k in range(1, L + 1):
        ts = [p[str(k)][d] for d in DAYS]
        kinds[k] = 'C' if all(t == 'SPARE' for t in ts) else (lambda f: f.pop() if len(f) == 1 else 'M')(set(fam(t) for t in ts if timed(t)))
    # the longest run of weeks in one family, and whether every change of family happens across a cover week
    best = (0, None); run = 0; prev = None
    for k in list(range(1, L + 1)) * 2:
        f = kinds[k]
        if f in ('E', 'L') and f == prev: run += 1
        else: run = 1 if f in ('E', 'L') else 0
        prev = f if f in ('E', 'L') else (prev if f == 'C' else None)
        if run > best[0]: best = (min(run, L), f)
    switches_across_cover = True; last = None
    for k in range(1, L + 1):
        f = kinds[k]
        if f == 'C': last = None; continue
        if last and f != last and f in ('E', 'L'): switches_across_cover = False
        if f in ('E', 'L'): last = f
    return {'L': L, 'kinds': kinds, 'longest': best, 'switches_across_cover': switches_across_cover, 'mixed': sum(1 for v in kinds.values() if v == 'M')}

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
    facts = grid_facts(grid); L = facts['L']; n, f = facts['longest']
    famword = {'E': 'earlies', 'L': 'lates'}[f]
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
    put(s, 'Much the same balance. Sundays stay overtime and still finish at 23:25.', f'{F["weekendsYear"]} full weekends off a year, never more than five weeks apart; the longest run of one kind is {n} weeks of {famword}{", and every switch from one kind to the other crosses a cover week" if facts["switches_across_cover"] else ""}.')
    s.save()
    snd.notes(d, 10, 'Earlies here means', f'Read the strip left to right; week 27 is week 1 again. A cover week has no fixed shifts of its own — its four duties are placed later to cover leave and sickness, which is why it is drawn empty. Earlies here means a start before 11:00. A weekday has 7 earlies and 8 lates; a Saturday 7 and 7; a Sunday 5 and 5. Sundays stay overtime, {F["sun"]} a year each (today {T["sun"]}), and still finish at 23:25. Who starts on which week is decided after the link is chosen.')

def colleagues(d, name, grid, F):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    put(s, '7 in 26', F['weekendsYear'])
    tile(s, 4, ['the same contracted week'], 'the contracted\nweek, as now'); tile(s, 5, ['no extra contracted hours'], 'no extra hours')
    tile(s, 8, ['most days in a row'], 'most days\nin a row')                        # its sub-caption is one line already, in every design
    tile(s, 12, ['full weekends off'], 'full weekends\noff a year'); tile(s, 13, ['at most 5 weeks apart'], f'today {T["weekendsYear"]} · {F["weekendsShort"]}')
    tile(s, 16, ['shift times you already work'], 'shift times you\nalready work')
    tile(s, 20, ['shorter on every closing shift'], 'off every\nclosing shift'); tile(s, 21, ['45 min on a Sunday'], 'Sundays: 45 min')
    s.save()
    notes_append(d, 2, f'Say the leave cost here too, before anyone asks: four full weeks off, Sunday to Saturday, takes {F["leaveFour"]} days’ leave rather than {T["leaveFour"]}, and the best 14-day stretch is {F["leaveBest"]} days off rather than {T["leaveBest"]}; the average is the same and the worst a day better. A cover week is one of the five weeks in 26 with no fixed shifts: its four duties are placed later to cover leave and sickness; the fixed rota is the other 21 weeks, whose shifts are set.')
    s = S(4)
    a, b = shape_of(s, '4.2'), shape_of(s, '4.19'); assert a < b, 'today left of proposal'
    put(s, '4.2', T['daysWeek'])
    both = [i for i, (x0, x1) in enumerate(spans(s.x)) if runs_of(s.x[x0:x1]) == ['219']]; assert both == [14, 15], both   # today's, then the proposal's (second-nature-decks.py sets shape 15)
    set_shape(s, both[0], T['daysYear']); set_shape(s, both[1], F['daysYear'], NAVY)
    put(s, 'No. Exactly the same 35-hour week — and no more contracted days than today.', f'No. The same 35-hour week on average and no more days; weeks run from {F["light"]} to {F["heavy"]} (today {T["light"]} to {T["heavy"]}), and two more of the days fall on a Saturday.')
    s.save()
    replace_in_run(f'{d}/ppt/slides/slide6.xml', 'Every closing shift is 30 to 45 minutes shorter, and nothing runs over 9 hours.', f'Every closing shift is 30 to 45 minutes shorter; the longest early turn goes from {T["longestEarly"]} to {F["longestEarly"]}, and nothing runs over 9 hours.')
    s = S(7)
    put(s, f'A little — about {F["late23"]} a year each, against {T["late23"]} today', f'{int(F["late23"]) - int(T["late23"])} more a year after 23:00 ({F["late23"]}, today {T["late23"]}); {int(F["late22"]) - int(T["late22"])} more at 22:00 or later ({F["late22"]}, today {T["late22"]})')
    s.save()
    lead = 'More people stay on after 22:00 under the December staffing; '
    if name == 'Even Keel':
        replace_run(f'{d}/ppt/slides/slide7.xml', 'Five more late finishes a year — four to the close on a Saturday — and every closer is shorter.', lead + 'five more a year after 23:00, four to the Saturday close.')
    else:
        replace_run(f'{d}/ppt/slides/slide7.xml', 'Three more late finishes a year — the fewest the rules allow — and every closer is shorter.', lead + 'the three more after 23:00 are the fewest the rules allow.')
    for n in (5, 7):
        s = S(n); drop_shape(s, 'Yearly figures are averages from the fixed rota; cover-week duties are not included.'); s.save()
        notes_append(d, n, 'The yearly figures are averages from the fixed rota; a cover week’s duties are not known yet and are left out.')
    s = S(9)
    put(s, 'Full weekends off', 'Full weekends off, about a year'); put(s, '4 in 20', T['weekendsYear']); put(s, '7 in 26', F['weekendsYear'], GREEN)
    put(s, 'Weeks on one turn, Monday to Friday', 'Weeks on one turn, no early–late switch')
    s.save()
    replace_in_run(f'{d}/ppt/slides/slide9.xml', 'Seven weekends off in 26,', f'{F["weekendsYear"]} full weekends off a year,')
    strip_slide(d, name, grid, F)
    s = S(11)
    put(s, 'About the same. A cover week still counts as at most 4 days of leave, as now.', f'Best stretch {F["leaveBest"]} days, not {T["leaveBest"]}; four full weeks off, Sunday to Saturday, costs {F["leaveFour"]} days’ leave, not {T["leaveFour"]}. Average the same, worst a day better.')
    s.save()
    notes_edit(d, 11, 'The exact averages depend on where you count a booking as starting, so quote them as “about the same”.', 'Say the four-weeks figure plainly: all three shortlisted links are worse than today here (Long Break, the leave-first design in the pack, keeps the 14), and people plan a year around it. The averages depend on where you count a booking as starting, so quote those as “about the same”.')
    s = S(13)
    put(s, 'Best leave stretch: 28 days, not 30', f'Four weeks off: {F["leaveFour"]} days’ leave, not {T["leaveFour"]}')
    put(s, 'Average as today, and the worst a day better.', f'Best 14-day stretch {F["leaveBest"]} days, not {T["leaveBest"]}; average as today, worst a day better.')
    put(s, 'Five cover weeks', 'Two more Saturdays a year')
    put(s, 'Spaced evenly: weeks 1, 6, 11, 16 and 21.', f'{F["sat"]} a year each, today {T["sat"]} — fourteen on a Saturday, shared across 26 lines.')
    s.save()
    p14 = f'{d}/ppt/slides/slide14.xml'
    replace_run(p14, '219', T['daysYear'], after='Contracted days at work a year'); replace_run(p14, '219', F['daysYear'], after='Contracted days at work a year')
    replace_run(p14, '4 in 20', T['weekendsYear'], after='Full weekends off'); replace_run(p14, '7 in 26', F['weekendsYear'], after='Full weekends off'); replace_run(p14, 'Full weekends off', 'Full weekends off, about a year')

def managers(d, name, grid, F):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    tile(s, 4, ['December rules met'], 'December\nrules met')
    tile(s, 8, ['contract rostered exactly, on average'], 'contracted hours\na week'); tile(s, 9, ['Monday to Saturday'], 'Mon–Sat average')
    tile(s, 12, ['avoidable fatigue warnings'], 'avoidable\nfatigue warnings'); tile(s, 13, ['in the fixed rota · today 4'], 'fixed rota · today 4')
    tile(s, 16, ['people on the link'], 'people\non the link')
    s.save()
    s = S(6); drop_shape(s, 'Early starts and a weekly rotation come with every link, so are not counted. The written source of the 13-day limit is still to be confirmed.'); s.save()
    notes_append(d, 6, 'Early starts and a weekly rotation come with every link, so they are not counted. The written source of the 13-day limit is still to be confirmed.')
    s = S(4)
    drop_shape(s, 'A measure of the day’s shape only — not a staffing requirement or a passenger forecast.')
    notes_append(d, 4, 'The score is a measure of the day’s shape only — not a staffing requirement or a passenger forecast.')
    put(s, 'Much closer to the December pattern on weekdays, Saturday and Sunday.', 'Much closer to the December pattern every day. The score: hour by hour, how far staffing sits from the trains; 0 would track them exactly.')
    s.save()
    s = S(7)
    ticks = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) == ['✓']]; assert len(ticks) == 6, ticks
    times = re.match(r'(\d+) \((\d+) you know\)', F['times']); n_times, n_known = int(times.group(1)), int(times.group(2)); n_new = n_times - n_known
    # Second Edition's line said one shift time in 18 of 21 weeks — true of all three (outside review, 4 Oct 2026); its own edge is the step
    adds = {'Second Edition': f'This one adds: the steadiest starts of the three, {F["step"]} week to week (today {T["step"].replace(" 00m", "")})',
            'Short Run': f'This one adds: never more than {F["run"].split(" ")[0]} days in a row on the fixed rota (today {T["run"].split(" ")[0]})',
            'Even Keel': f'This one adds: no week over {F["heavy"]}, and at least {F["rest"]} between shifts'}[name]
    costs = {'Second Edition': f'Costs: {F["run"]} days in a row on the fixed rota (today {T["run"].split(" ")[0]}); four weeks off {F["leaveFour"]} days, not {T["leaveFour"]}',
             'Short Run': f'Costs: one {F["heavy"]} week (today up to {T["heavy"]}); four weeks off {F["leaveFour"]} days, not {T["leaveFour"]}',
             'Even Keel': f'Costs: {F["late23"]} late finishes (today {T["late23"]}), a mixed week, four weeks off {F["leaveFour"]} days, not {T["leaveFour"]}'}[name]
    labels = ['All three shortlisted: all 9 December rules, all 3 flexible ones, no fatigue warning',
              f'All three shortlisted: about {F["weekendsYear"]} full weekends off a year (today {T["weekendsYear"]}), at most 5 apart',
              'All three shortlisted: no shift over 9 hours, and every closing shift shorter',
              adds,
              f'{n_known} of {n_times} shift times worked today; {n_new} new, several shorter versions of today’s lates',
              costs]
    for i, (t, lab) in enumerate(zip(ticks, labels)): set_shape(s, t + 1, lab)
    set_shape(s, ticks[-1], '–')
    bars = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) and runs_of(s.x[a:b])[0].startswith('The trade-off')]; assert len(bars) == 1
    minimum = int(F['late23']) == 42
    set_shape(s, bars[0], f'Late finishes: {F["late23"]} a year each (today {T["late23"]}){" — the rules’ minimum" if minimum else " — two above the rules’ minimum, buying a fourth person to the Saturday close"}. The colleague deck shows every cost openly.')
    set_shape(s, 1, 'What all three shortlisted links give, what this one adds, and what it costs')
    s.save()
    if name == 'Second Edition':
        notes_append(d, 7, f'The week-to-week figure is the average, round the rotation, of how far a week’s mean start time moves from the week before — Sundays included, cover weeks left out: {F["step"]} here, against {T["step"]} on today’s link.')
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
    for name, grid in DESIGNS.items():
        for who in ('colleagues', 'managers'):
            polish(os.path.join(OUT, f'{name.replace(" ", "-")}-for-{who}.pptx'), name, grid, who)
    print('polished', ', '.join(DESIGNS))
