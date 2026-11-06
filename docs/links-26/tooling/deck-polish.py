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
# Even Step joined them on 31 Oct 2026 (owner: "Do your suggestions"; "Yes, keep all three"), recommended until 5 Nov 2026.
DESIGNS = {'Even Step': 'even-step.json', 'In Step': 'in-step.json', 'Short Run': 'short-run.json'}
# the shortlist is fresh.mjs's, read rather than restated (four from 30 Oct 2026, when Closing Time joined; two that evening; three since 31 Oct 2026, with Even Step): every deck's
# manager "Why" slide and leave notes say what ALL of them share, so a copy here that fell behind would put a claim on
# a slide about a design it was never checked against
SHORTLIST = tuple(re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', open(os.path.join(TOOL, 'fresh.mjs'), encoding='utf-8').read()).group(1)))
# NO RECOMMENDATION SINCE 5 NOV 2026 (owner: "Remove the marks"): the three are presented evenly, A to Z, as the New link page
# shows them. fresh.mjs exports no RECOMMENDED; one that came back would put a recommendation back on every deck unseen, so
# its return stops the polish rather than being read
if re.search(r'export const RECOMMENDED\b', open(os.path.join(TOOL, 'fresh.mjs'), encoding='utf-8').read()):
    raise SystemExit('deck-polish: fresh.mjs exports a RECOMMENDED again; the decks present the shortlist evenly (owner, 5 Nov 2026)')
if list(SHORTLIST) != sorted(SHORTLIST): raise SystemExit(f'deck-polish: the shortlist is presented A to Z, and fresh.mjs gives {SHORTLIST}')
# WHO COLLEAGUES TELL (owner, 5 Nov 2026: "Match the New link page"): the contact and their role are the page's, read from
# newlink-config.js, so the presentations and the page cannot name different people
NEWLINK = open(os.path.join(TOOL, '..', '..', '..', 'newlink-config.js'), encoding='utf-8').read()
CONTACT = re.search(r"export const CONTACT = '([^']+)'", NEWLINK).group(1)
CONTACT_ROLE = re.search(r"export const CONTACT_ROLE = '([^']+)'", NEWLINK).group(1)
IDS = {n: (c, f) for n, c, f in re.findall(r"name: '([^']+)',\s*code: '([^']+)',\s*fp: '([0-9a-f]{8})'", open(os.path.join(TOOL, 'regenerate.mjs'), encoding='utf-8').read())}
ALL = 'both' if len(SHORTLIST) == 2 else f"all {'zero one two three four five six'.split()[len(SHORTLIST)]}"   # "both", "all four"
# DECKS FOR A DESIGN OFF THE SHORTLIST, made because the owner asked (30 Oct 2026: "Create presentations for instep"). Its
# manager "Why" slide says what it shares with the shortlisted links instead of speaking as one of them, and every line it
# shares is checked against it too. A design that joins the shortlist leaves this list in the same change, or the
# assertion stops the polish: its slide would go on speaking from outside the shortlist it had joined.
# IN STEP AGAIN SINCE 5 NOV 2026, when Common Ground took its place on the shortlist and the owner kept its decks in the
# pack ("keep the other presentations in the pack, just not the shortlist"): fresh.mjs's DECKS_KEPT, read, never typed
OFF_SHORTLIST = tuple(re.findall(r"'([^']+)'", re.search(r'export const DECKS_KEPT = \[([^\]]*)\]', open(os.path.join(TOOL, 'fresh.mjs'), encoding='utf-8').read()).group(1)))
# A SHORTLISTED DESIGN WHOSE DECKS ARE BUILT AFTER THE POLISH (5 Nov 2026): Common Ground's are Even Step's finished decks
# rewritten by common-ground-decks.py, so the polish never writes them; it knows the grid, because every "Why" slide and set
# of notes compares a design with the other shortlisted ones, and the lines all three share are checked against it
BUILT_AFTER = {'Common Ground': 'common-ground.json'}
GRIDS = {**DESIGNS, **BUILT_AFTER}
def grid_of(n):
    """A design's grid by name: the three built here and Common Ground's, which is built after them."""
    return (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, GRIDS[n]), encoding='utf-8')))
assert set(GRIDS) == set(SHORTLIST) | set(OFF_SHORTLIST) and not set(SHORTLIST) & set(OFF_SHORTLIST) and not set(DESIGNS) & set(BUILT_AFTER), \
    f'decks are built for {sorted(DESIGNS)} and after the polish for {sorted(BUILT_AFTER)}, but the shortlist is {sorted(SHORTLIST)} and the designs off it {sorted(OFF_SHORTLIST)}'
if len(SHORTLIST) != len(set(SHORTLIST)): raise SystemExit(f'a name twice in the shortlist: {SHORTLIST}')   # the set comparison passes it; "all five" would not
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
WORDS = 'zero one two three four five six seven eight nine ten'.split(); ORDS = 'zeroth first second third fourth fifth sixth'.split()
andl = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]   # "A, B and C"; the functions keep their own copies

# WHAT EVERY "ALL FOUR" LINE RESTS ON, CHECKED BEFORE A DECK IS TOUCHED (30 Oct 2026 review). The manager "Why" slide prints
# three lines about the whole shortlist on every design's deck, and the comparison above proves only that each shortlisted
# design HAS decks: a design that broke one of the lines would have been printed under it. Each is checked here against
# every design's own figures (deck-check.mjs --print, the sheets' counts); a check that fails stops the polish.
H = lambda v: int(v.split('h')[0]) * 60 + int(v.split('h')[1].strip().rstrip('m'))   # "8h 10m" → 490
first = lambda v: int(v.split(' ')[0])                                             # "5 (up to 6)", "18 of 21" → the first figure
upto = lambda v: int(re.search(r'up to (\d+)', v).group(1)) if 'up to' in v else first(v)   # "5 (up to 7)" → 7
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
# the polish's own designs, for the lines it writes about each one alone (slide 12's subtitle); Common Ground's builder writes its own
def every_built(what, ok):
    bad = [n for n in DESIGNS if not ok(FIG[n])]
    if bad: raise SystemExit(f'deck-polish: "{what}" is printed on the decks of {", ".join(bad)}, and is not true of them')
every('all 9 December rules', lambda f: f['met'] == '9')
# on the FIXED rota (31 Oct 2026): a cover week worked with its Sunday as overtime can make a 55-hour week, so the worst
# case is "0 (up to 1)" on both — the line says what holds of the fixed rota, and the tables carry the rest
every('no avoidable fatigue warning on the fixed rota', lambda f: first(f['ff']) == 0)
same('full weekends off a year', 'weekendsYear'); GAP = max(int(f['weekendGap']) for f in SL.values())
every('no shift over 9 hours', lambda f: H(f['longest']) <= 9 * 60)
every('every closing shift shorter', lambda f: all(H(f[k]) < H(T[k]) for k in ('closerWk', 'closerSat', 'closerSun')))
# FOUR WEEKS OFF IS NO LONGER A SHARED COST (5 Nov 2026): Common Ground, shortlisted, keeps today's 14 days. The leave notes on
# slide 11 and the managers' notes 7 now say which designs need more and which keeps today's, from the figures
# slide 12's subtitle (colleagues): more on duty every day, and more at the open and the close on most days — "most" because
# no shortlisted design has more than today's 3 at the Sunday close (Closing Time, while shortlisted, had today's 4 at the Saturday open)
lo_hi = lambda v: [(min(x), max(x)) for x in ([int(n) for n in part.split('–')] for part in v.split(' · '))]   # "11–12 · 10 · 8"
def more_on(f, key, days_needed):
    """More than today on at least `days_needed` of the week's seven days (a weekday counts five), and fewer on none."""
    d, t = lo_hi(f[key]), lo_hi(T[key])
    days = 5 * (d[0][0] > t[0][1]) + (d[1][0] > t[1][1]) + (d[2][0] > t[2][1])
    return days >= days_needed and all(d[i][0] >= t[i][1] for i in range(3))
every('more people rostered every day', lambda f: more_on(f, 'daily', 7))
every_built('more at the open on most days', lambda f: more_on(f, 'open', 4))   # not Common Ground's: four at every open, the minimum
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
def add_row(s, like, after, label, today, prop, color=None):
    """A row added to a comparison table (1 Nov 2026, owner: "make all three changes"). A row is four shapes in order:
    its background, label, today's figure and the proposal's. The row labelled `like` is cloned with fresh ids onto the
    next place of the five-row pitch below the row labelled `after`, and put straight after that row, so deck-check.mjs
    reads it in order and balance_tables can respace the table. Refused unless both rows are those four shapes on one
    line, on the pitch, and the new row lands below everything else in the table."""
    sp = spans(s.x); i, j = shape_of(s, like), shape_of(s, after)
    def row(k):
        q = [s.x[slice(*sp[n])] for n in range(k - 1, k + 3)]
        g = [tuple(map(int, re.search(r'<a:off x="(\d+)" y="(\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', x).groups())) for x in q]
        if 'prst="roundRect"' not in q[0] or g[0][0] != ROW_X or g[0][2] != ROW_W or {v[1] for v in g} != {g[0][1]} or {v[3] for v in g} != {ROW_H} \
                or any(len(runs_of(x)) != 1 for x in q[1:]) or (g[0][1] - ROW_TOP) % ROW_PITCH:
            raise SystemExit(f'{s.path}: the row {runs_of(q[1])} is not a background, a label and two figures on the five-row pitch')
        return q, g[0][1]
    src, _ = row(i); _, y_after = row(j); y = y_after + ROW_PITCH
    tops = [int(m.group(1)) for m in re.finditer(r'<a:off x="\d+" y="(\d+)"/>', s.x)]
    if any(y_after < t < BAR_TOP for t in tops if t != y_after): raise SystemExit(f'{s.path}: something sits under the row {after!r}')
    nxt = max(int(v) for v in re.findall(r'<p:cNvPr id="(\d+)"', s.x)) + 1; out = []
    for k, (q, new) in enumerate(zip(src, (None, label, today, prop))):
        q = re.sub(r'<p:cNvPr id="\d+" name="([^"]*)"', lambda m: f'<p:cNvPr id="{nxt + k}" name="{m[1]} {nxt + k}"', q, count=1)
        q = re.sub(r'(<a:off x="\d+" y=")\d+(")', lambda m: f'{m[1]}{y}{m[2]}', q, count=1)
        if new is not None: q = snd.AT.sub(lambda m: f'<a:t>{escape(new)}</a:t>', q, count=1)
        if color and k == 3: q = re.sub(r'srgbClr val="[0-9A-F]{6}"', f'srgbClr val="{color}"', q)
        out.append(q)
    end = sp[j + 2][1]; s.x = s.x[:end] + ''.join(out) + s.x[end:]
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
def early_off(p):
    """Earlies (a start before 11:00) finishing before 14:00, any day, each a year — the shortlist sheet's count."""
    return round(per_year(p, lambda s, d: int(s[:2]) < 11 and int(s[6:8]) * 60 + int(s[9:]) < 14 * 60))
def weekday_late_avg(p):
    """The Monday-to-Friday lates (a start at 11:00 or later) other than the closers, on average, in minutes."""
    v = [_len(p[k][d]) for k in p for d in DAYS[1:6] if _timed(p[k][d]) and int(p[k][d][:2]) >= 11 and p[k][d][6:] != '23:55']
    return round(sum(v) / len(v))
def long_wk_earlies(p):
    """Earlies (a start before 11:00) over 8h 30m, Monday to Friday, each a year."""
    return round(per_year(p, lambda s, d: d in DAYS[1:6] and int(s[:2]) < 11 and _len(s) > 510))
def long_wk_lengths(p):
    """The lengths, in minutes, of the earlies over 8h 30m Monday to Friday."""
    return {_len(p[k][d]) for k in p for d in DAYS[1:6] if _timed(p[k][d]) and int(p[k][d][:2]) < 11 and _len(p[k][d]) > 510}
def shorter_lates(p):
    """How many of a design's NEW times are shorter versions of one of today's lates: a late (from 11:00) that today does
    not work, sharing its start or its end with a time today works and shorter than it — In Step's 15:45 and 15:15 closers
    and its 22:30 office late."""
    today = {TODAY_P[k][d] for k in TODAY_P for d in DAYS if _timed(TODAY_P[k][d])}
    new = {p[k][d] for k in p for d in DAYS if _timed(p[k][d])} - today
    return sum(1 for t in new if int(t[:2]) >= 11 and any((u[:5] == t[:5] or u[6:] == t[6:]) and _len(u) > _len(t) for u in today))

# THE PAY FIGURES ARE THE APP'S (31 Oct 2026, the deck review): slide 5 said "plus about two more Saturdays at time and a
# quarter" and nothing about the Sunday overtime, which falls by more than the Saturdays add. The rate and the two premiums
# are read from paycalc-calc.js, the Pay Calculator's own, never typed here
PAY = json.loads(subprocess.check_output(['node', '-e', "import('../../../paycalc-calc.js').then(m => process.stdout.write(JSON.stringify({rate: m.GRADES.cea.rate, sat: m.RATE_125, sun: m.RATE_150, ot: m.RATE_125})))"], cwd=TOOL, text=True))   # ot: computeGross's rate for overtime hours ("Overtime 1.25")
def day_hours(p, day):
    """Rostered hours on one day of the week, each person a year: the fixed duties, 52 weeks shared across the link."""
    return sum(_len(p[k][day]) for k in p if _timed(p[k][day])) * 52 / len(p) / 60
def rest_lens(p):
    """The length of every rest-day break round the rotation (week 27 is week 1 again), as the shortlist sheet counts them."""
    seq = [p[k][dd] for k in sorted(p, key=int) for dd in DAYS]; n = len(seq); out = []
    for i in range(n):
        if seq[i] == 'RD' and seq[i - 1] != 'RD':
            L = 0
            while L < n and seq[(i + L) % n] == 'RD': L += 1
            out.append(L)
    return out
def new_time_kinds(p):
    """Slide 13's card: every new shift time by kind — shorter versions of today's lates, longer weekday earlies, other new
    lates and the Sunday early. Refused if a new time is of none of them, so the card can never leave one out (the review
    of 31 Oct 2026: the card named three of In Step's six and left the Sunday 09:00–18:00 off all three decks)."""
    today = {TODAY_P[k][dd] for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd])}
    new = {p[k][dd] for k in p for dd in DAYS if _timed(p[k][dd])} - today
    early = lambda t: int(t[:2]) < 11
    longest_early = max(_len(t) for t in today if early(t))
    days_of = lambda t: {dd for k in p for dd in DAYS if p[k][dd] == t}
    shorter = {t for t in new if not early(t) and any((u[:5] == t[:5] or u[6:] == t[6:]) and _len(u) > _len(t) for u in today)}
    sunday = {t for t in new if early(t) and days_of(t) == {'sun'}}
    longer = {t for t in new - sunday if early(t) and _len(t) > longest_early and days_of(t) & set(DAYS[1:6])}
    other = {t for t in new - shorter if not early(t)}
    left = new - shorter - sunday - longer - other
    if left: raise SystemExit(f'deck-polish: new times of no kind slide 13 names: {sorted(left)}')
    hm_ = lambda m: f'{m // 60}h\u00a0{m % 60:02d}m'   # one unit: "8h | 15m" broke across the card's lines
    def body(lates):
        parts = ([f'{WORDS[len(shorter)].capitalize()} {lates}'] if shorter else []) \
            + (['a longer weekday early' if len(longer) == 1 else f'{WORDS[len(longer)]} longer weekday earlies'] if longer else []) \
            + [f'a new {hm_(_len(t))} late' for t in sorted(other)] \
            + [f'the {_len(t) // 60}-hour Sunday early' if _len(t) % 60 == 0 else f'a {hm_(_len(t))} Sunday early' for t in sorted(sunday)]
        return (', '.join(parts[:-1]) + ' and ' + parts[-1] if len(parts) > 1 else parts[0]) + '.'
    # the card holds two lines, about 92 characters (Short Run's 91 fits, In Step's 96 ran out of the card, measured from the
    # PDFs): a list too long for them says "shorter lates", as the shortlist sheet does
    full = body(f'shorter {"version" if len(shorter) == 1 else "versions"} of today’s lates')
    return len(new), full if len(full) <= 92 else body(f'shorter {"late" if len(shorter) == 1 else "lates"}')
def moved_days(p):
    """Times worked today that this design also puts on a day they are not worked today: {time: (today's days, the new)}."""
    kind = lambda dd: 'Sunday' if dd == 'sun' else 'Saturday' if dd == 'sat' else 'weekday'
    def kinds(g):
        out = {}
        for k in g:
            for dd in DAYS:
                if _timed(g[k][dd]): out.setdefault(g[k][dd], set()).add(kind(dd))
        return out
    t_, p_ = kinds(TODAY_P), kinds(p)
    return {t: (t_[t], p_[t] - t_[t]) for t in sorted(p_) if t in t_ and not p_[t] <= t_[t]}
def moved_sentence(p):
    """'Some known times move day: the Saturday's 06:20–13:35 and 08:00–16:30 are worked today only on weekdays, and …'"""
    groups = {}
    for t, (was, now) in moved_days(p).items(): groups.setdefault((tuple(sorted(now)), tuple(sorted(was))), []).append(t.replace('-', '–'))
    adj = {('Saturday',): 'Saturday’s', ('weekday',): 'weekday', ('Sunday',): 'Sunday’s'}
    when = {('weekday',): 'weekdays', ('Saturday',): 'a Saturday', ('Sunday',): 'a Sunday', ('Saturday', 'Sunday'): 'a Saturday and a Sunday'}
    lst = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]
    bits = []
    for i, ((now, was), ts) in enumerate(sorted(groups.items(), key=lambda g: -len(g[1]))):   # the largest group first, carrying the verb
        if now not in adj or was not in when: raise SystemExit(f'deck-polish: no words for a time moving from {was} to {now}')
        verb = f'{"is" if len(ts) == 1 else "are"} worked today ' if i == 0 else ''
        bits.append(f'the {adj[now]} {lst(ts)} {verb}only on {when[was]}')
    return 'Some known times move day: ' + (bits[0] if len(bits) == 1 else ', '.join(bits[:-1]) + ', and ' + bits[-1]) + '.'

def pay_change(p):
    """Slide 5's sum, for any deck: (Saturday premium, Sunday overtime, pounds) in hours' pay, each person a year."""
    prem_sat = (PAY['sat'] - 1) * (day_hours(p, 'sat') - day_hours(TODAY_P, 'sat'))
    prem_sun = PAY['sun'] * (day_hours(p, 'sun') - day_hours(TODAY_P, 'sun'))
    return prem_sat, prem_sun, round(-(prem_sat + prem_sun) * PAY['rate'] / 50) * 50
def set_list(path, first_item, items, space_after=None, size=None):
    """Rewrite one bulleted list, the text body whose first paragraph reads `first_item`, as `items`: one paragraph each, in
    the first paragraph's own style, with `space_after` and the text `size` (both hundredths of a point) if given."""
    x = open(path, encoding='utf-8').read(); i = x.find(f'<a:t>{escape(first_item)}</a:t>')
    assert i >= 0, f'{path}: {first_item!r} not found'
    b0, b1 = x.rfind('<p:txBody>', 0, i), x.find('</p:txBody>', i); body = x[b0:b1]
    paras = re.findall(r'<a:p>.*?</a:p>', body, re.S); tpl = next(q for q in paras if 'buChar' in q)
    if space_after is not None: tpl = re.sub(r'<a:spcAft><a:spcPts val="\d+"/></a:spcAft>', f'<a:spcAft><a:spcPts val="{space_after}"/></a:spcAft>', tpl)
    if size is not None: tpl = re.sub(r'\bsz="\d+"', f'sz="{size}"', tpl)
    new = ''.join(re.sub(r'<a:t>[^<]*</a:t>', lambda m, t=t: f'<a:t>{escape(t)}</a:t>', tpl, count=1) for t in items)
    a, z = body.find(paras[0]), body.rfind(paras[-1]) + len(paras[-1])
    open(path, 'w', encoding='utf-8').write(x[:b0] + body[:a] + new + body[z:] + x[b1:])

def set_pairs(path, first_item, items, space_after=1200, head=1600, detail=1400, detail_color='5B6778'):
    """Rewrite one bulleted list (found as set_list finds it) as headline-and-detail items: a bold headline, a line break,
    and the figure under it in a quieter colour, so the slide reads from its headlines alone (third review, 1 Nov 2026)."""
    x = open(path, encoding='utf-8').read(); i = x.find(f'<a:t>{escape(first_item)}</a:t>')
    assert i >= 0, f'{path}: {first_item!r} not found'
    b0, b1 = x.rfind('<p:txBody>', 0, i), x.find('</p:txBody>', i); body = x[b0:b1]
    paras = re.findall(r'<a:p>.*?</a:p>', body, re.S); tpl = next(q for q in paras if 'buChar' in q)
    ppr = re.sub(r'<a:spcAft><a:spcPts val="\d+"/></a:spcAft>', f'<a:spcAft><a:spcPts val="{space_after}"/></a:spcAft>', re.search(r'<a:pPr\b.*?</a:pPr>', tpl, re.S).group(0))
    rpr = re.search(r'<a:rPr\b.*?</a:rPr>', tpl, re.S).group(0)
    rh = re.sub(r'\bsz="\d+"', f'sz="{head}" b="1"', rpr, count=1)
    rd = re.sub(r'srgbClr val="[0-9A-F]{6}"', f'srgbClr val="{detail_color}"', re.sub(r'\bsz="\d+"', f'sz="{detail}"', rpr, count=1))
    new = ''.join(f'<a:p>{ppr}<a:r>{rh}<a:t>{escape(h)}</a:t></a:r><a:br/><a:r>{rd}<a:t>{escape(t)}</a:t></a:r><a:endParaRPr lang="en-GB" sz="{detail}" dirty="0"/></a:p>' for h, t in items)
    a, z = body.find(paras[0]), body.rfind(paras[-1]) + len(paras[-1])
    open(path, 'w', encoding='utf-8').write(x[:b0] + body[:a] + new + body[z:] + x[b1:])

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
    off = lambda k, d: not timed(p[str(k)][d]) and p[str(k)][d] != 'SPARE'   # rota-strip.mjs's own reading of a weekend
    weekends = [k for k in range(1, L + 1) if off(k, 'sat') and off(k % L + 1, 'sun')]
    back_to_back = sum(1 for k in weekends if k % L + 1 in weekends)
    return {'L': L, 'kinds': kinds, 'switches_across_cover': switches_across_cover, 'mixed': sum(1 for v in kinds.values() if v == 'M'),
            'weekends': len(weekends), 'back_to_back': back_to_back}

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
    # LEADS WITH THE BLOCKS (31 Oct 2026, the screenshot pass): it opened with slide 9's own takeaway, word for word, so the
    # presenter read the same clause on two slides running, and "up to 5" broke from its "weeks" at the line end
    put(s, 'Much the same balance. Sundays stay overtime and still finish at 23:25.', f'Blocks of earlies or lates up to {F["block"]}\u00a0weeks{upto_banner}{", and every switch from one kind to the other crosses a cover week" if facts["switches_across_cover"] else ""}; a\u00a0full\u00a0weekend\u00a0off comes round at least every {WORDS[int(F["weekendGap"])]}\u00a0weeks.')   # in words, as slide 9's "at most five weeks apart" (5 Nov 2026)
    s.save()
    upto = (f'; because a cover week’s duties are placed later, a block can run to {F["blockUpTo"]} if the cover weeks beside it are given the same kind (today {T["blockUpTo"]})'
            if int(F["blockUpTo"]) > int(F["block"]) else '; the cover weeks cannot lengthen it')
    notes_after_10 = f'A block is weeks in a row all on earlies or all on lates. Cover weeks aside, the longest is {F["block"]} weeks (today {T["block"]}){upto}. Fewer switches between earlies and lates, but someone who prefers one kind waits longer for it to come round.'
    snd.notes(d, 10, 'Earlies here means', f'Read the strip left to right; week 27 is week 1 again. A cover week has no set shifts of its own — its four duties are placed later to cover leave and sickness, which is why it is drawn empty. Earlies here means a start before 11:00. A weekday has 7 earlies and 8 lates; a Saturday 7 and 7; a Sunday 5 and 5. Sundays stay overtime, {F["sun"]} a year each (today {T["sun"]}), and still finish at 23:25. Who starts on which week is decided after the link is chosen.')
    notes_append(d, 10, notes_after_10)
    # ONE BAR A WEEKEND (31 Oct 2026, the deck review): two weekends one after the other used to share one longer bar, and a
    # note here said the bars undercounted; rota-strip.mjs now draws each with a gap where two meet, so the bars count them

def colleagues(d, name, grid, F):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    put(s, '7 in 26', F['weekendsYear'])
    tile(s, 4, ['the same contracted week'], 'the contracted\nweek, as now'); tile(s, 5, ['no extra contracted hours'], 'no extra hours')
    tile(s, 8, ['most days in a row'], 'most days\nin a row')                        # its sub-caption is one line already, in every design
    # LIKE WITH LIKE (31 Oct 2026 review): "up to 7 · today 7" set this design's worst case beside today's FIXED figure, whose
    # own worst case is 9; the line now gives both of today's
    tile(s, 9, [f'up to {upto(F["run"])} · today {first(T["run"])}'], f'up to {upto(F["run"])} · today {first(T["run"])}–{upto(T["run"])}')   # one line, as every tile's sub-caption
    tile(s, 12, ['full weekends off'], 'full weekends\noff a year'); tile(s, 13, ['at most 5 weeks apart'], f'today {T["weekendsYear"]}')   # "today 10 · 7 in 26" read as two of today's figures; slide 9 has the 7 in 26 (5 Nov 2026)
    tile(s, 16, ['shift times you already work'], 'shift times you\nalready work')
    tile(s, 20, ['shorter on every closing shift'], 'off every\nclosing shift')
    sub = runs_of(s.x[slice(*spans(s.x)[21])])[0]
    tile(s, 21, ['45 min on a Sunday', '1h 15m on a Saturday', 'up to 1 hour'],
         {'45 min on a Sunday': 'up to 45 min', '1h 15m on a Saturday': 'up to 1h 15m'}.get(sub, sub))   # in the form the others use, "up to 1 hour" (5 Nov 2026)
    s.save()
    notes_append(d, 2, f'Say the leave cost here too, before anyone asks: four full weeks off in a row, Sunday to Saturday, takes {F["leaveFour"]} days’ leave rather than {T["leaveFour"]}, and the best 14-day stretch is {F["leaveBest"]} days off rather than {T["leaveBest"]}; the average is the same and the worst a day better. A cover week is one of the five weeks in 26 with no set shifts: its four duties are placed later to cover leave and sickness. When a slide says “cover weeks aside”, it means the other 21 weeks, whose shifts are set.')
    s = S(4)
    a, b = shape_of(s, '4.2'), shape_of(s, '4.19'); assert a < b, 'today left of proposal'
    put(s, '4.2', T['daysWeek'])
    both = [i for i, (x0, x1) in enumerate(spans(s.x)) if runs_of(s.x[x0:x1]) == ['219']]; assert both == [14, 15], both   # today's, then the proposal's (second-nature-decks.py sets shape 15)
    set_shape(s, both[0], T['daysYear']); set_shape(s, both[1], F['daysYear'], NAVY)
    put(s, 'No. Exactly the same 35-hour week — and no more contracted days than today.', f'No. The same 35-hour week on average; weeks run {F["light"]}–{F["heavy"]} Monday\u00a0to\u00a0Saturday (today {T["light"]}–{T["heavy"]}), and {WORDS[int(F["sat"]) - int(T["sat"])]} more days a year are Saturdays.')   # two lines in the bar (the days are the table's)
    s.save()
    # SLIDE 5: WHAT THE PREMIUMS DO, NOT ONLY THE SATURDAYS (31 Oct 2026, the deck review). Basic pay does not move; the
    # Saturday premium rises (time and a quarter on about two more Saturdays) and the Sunday overtime falls by more (fewer,
    # shorter Sunday duties each, at time and a half). Each figure is computed, the rate is the app's, and the line is refused
    # unless the Saturdays add, the Sundays take away more, and the pounds come to something worth saying
    PG = (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, grid), encoding='utf-8')))
    sat_t, sat_p, sun_t, sun_p = day_hours(TODAY_P, 'sat'), day_hours(PG, 'sat'), day_hours(TODAY_P, 'sun'), day_hours(PG, 'sun')
    prem_sat, prem_sun = (PAY['sat'] - 1) * (sat_p - sat_t), PAY['sun'] * (sun_p - sun_t)   # hours' pay: a Saturday's premium is the quarter; a Sunday is all overtime
    net = prem_sat + prem_sun; pounds = round(-net * PAY['rate'] / 50) * 50
    ps, pu = round(prem_sat, 1), round(-prem_sun, 1)   # the notes print these to one decimal, and their difference, so the sum on the page adds up
    if not (prem_sat > 0 and prem_sun < -prem_sat and pounds >= 50):
        raise SystemExit(f'deck-polish: slide 5 says the Saturdays add less than the Sundays take away; for {name} they add {prem_sat:.1f} and take {-prem_sun:.1f} hours')
    # SWAPS, ON THE PAY SLIDE (1 Nov 2026, owner: "make all three changes"). Many people swap an early for a late on the same
    # day to earn overtime, because today's lates are longer: the time over the rostered shift is assumed paid as
    # "Overtime 1.25" (the payslip line; the Pay Calculator suggests it for a changed shift longer than the rostered one). The £
    # above leaves that out, and the bar now says so. The table gains what a swap
    # does to the day, on average, and how many of the short earlies — the 13:35 and 13:45 finishes, the ones worth
    # swapping — each person works a year; the notes price swapping every one of those for that day's longest late
    # WHAT THE SWAP ROW MEASURES, ON THE SLIDE (the deep review, 1 Nov 2026): "Swapping an early for a late, on average — 32 min
    # longer" left the reader to supply "your day is" and "and that time is paid", and on In Step and Short Run "11 min shorter"
    # invited "swaps now lose me pay"; why the row is on a pay slide was only in the notes, which the PDF does not carry. The
    # row now says what it compares, as the one-page sheet does, and the subtitle says why it is here. Refused unless the swap
    # earns less on this link both ways: the short earlies' total and the average same-day difference
    swap_min = lambda f: int(f['swap'].split()[0]) * (1 if f['swap'].endswith('longer') else -1)
    s = S(5)
    put(s, 'Basic pay follows your contracted hours', 'Basic pay follows your contracted hours — and a swap for a late earns less overtime')
    put(s, 'No. The same 35-hour week — plus about two more Saturdays at time and a quarter.',
        f'No. Basic pay stays the same. Premium and overtime pay come to about £{pounds} a year less, gross, if you work your share of Sundays. That assumes no swap overtime.')   # gross, and what it is (external review, 31 Oct 2026); the table above gives the Saturdays and Sundays
    # AMBER, AS THE DECK COLOURS A COST (the consistency review, 1 Nov 2026): both new rows are worse than today on every link —
    # less from a swap, fewer early finishes (slide 13 lists those as a trade-off; slide 7 colours more late finishes amber) —
    # and the checks below refuse the slide if either stops being so. Saturdays and Sundays stay navy: on a pay slide they
    # cut both ways
    add_row(s, 'Saturdays a year, at time and a quarter', 'Sunday overtime to share — each, a year', 'A late against an early, same day, on average', T['swap'], F['swap'], AMBER)
    add_row(s, 'Sunday overtime to share — each, a year', 'A late against an early, same day, on average', 'Finishing at 13:35 or 13:45 — each, a year', T['shortYear'], F['shortYear'], AMBER)
    s.save()
    ot = lambda f: int(f['swapShortMins']) / 60 * PAY['ot']                          # hours' pay a year, swapping every short early
    pot = lambda f: round(ot(f) * PAY['rate'] / 10) * 10                              # to the nearest £10
    mean = lambda f: (lambda m: f'a late is on average {m} minutes {"longer" if f["swap"].endswith("longer") else "shorter"} than an early on the same day')(int(f['swap'].split()[0]))
    # ONE COUNT, TWO NAMES (the deep review, 1 Nov 2026): slide 5 counts the 13:35 and 13:45 finishes, slide 13 and the shortlist
    # sheet "early finishes before 14:00". They are the same earlies only while no other early ends before 14:00, so the notes
    # say so and this proves it, for today and the design
    if int(F['shortYear']) != early_off(PG) or int(T['shortYear']) != early_off(TODAY_P):
        raise SystemExit(f'deck-polish: slide 5 counts {F["shortYear"]} (today {T["shortYear"]}) 13:35 or 13:45 finishes and slide 13 {early_off(PG)} (today {early_off(TODAY_P)}) before 14:00 on {name}; the notes say they are the same earlies')
    if not swap_min(F) < swap_min(T): raise SystemExit(f'deck-polish: slide 5’s subtitle says a swap for a late earns less on {name}; a late is {F["swap"]} than an early, today {T["swap"]}')
    if not (int(F['shortYear']) < int(T['shortYear']) and ot(F) < ot(T)): raise SystemExit(f'deck-polish: slide 5’s notes say swapping pays less on {name}; it has {F["shortYear"]} short earlies ({F["swapShort"]}), today {T["shortYear"]} ({T["swapShort"]})')
    longer = F['swap'].endswith('longer')
    # NOT EVERY SWAP (the external review, 1 Nov 2026): the £ is the 13:35 and 13:45 earlies' alone, and an 8-hour early for an
    # 8½-hour late still adds time on every link, so "those swaps add nothing" must not read as "no swap pays"
    swaps = (f'Swaps are left out of the £{pounds}. Today {mean(T)}, Monday to Saturday, so swapping an early for a late usually adds time, paid as overtime at time and a quarter. '
             f'The swaps that add most are the shortest earlies, the ones that finish at 13:35 or 13:45, which are the only earlies to finish before 14:00 (slide 13): about {T["shortYear"]} a year each today. Swapping every one of them for that day’s longest late adds about {T["swapShort"]} a year, roughly £{pot(T)} gross. '
             f'On {name} {mean(F)}' + ((f', and there are about ' if longer else f', but there are still about ') + f'{F["shortYear"]} of those short earlies a year each, so the same swaps add about {F["swapShort"]}, roughly £{pot(F)}.' if int(F['shortYear']) else ', and there are none of those short earlies, so those particular swaps add nothing.')
             + ' Other swaps may still add paid time wherever the late is the longer duty. Each figure is the most those particular swaps could make: it needs a partner for every swap, and assumes the extra time is paid as overtime at time and a quarter (“Overtime 1.25” on a payslip).')
    snd.notes(d, 5, 'Basic pay follows the 35-hour week', f'Basic pay follows the 35-hour week, which does not change. What moves is the premium and overtime pay. Every figure here is for 52 weeks, which is exactly two turns of the 26, so on this link they are everyone’s, whichever line you start on; today’s, on 20 weeks, are averages. Saturdays in the contract are paid at time and a quarter, and each person is rostered about {F["sat"]} a year instead of {T["sat"]} — about {round(sat_p - sat_t)} more Saturday hours, worth {ps:.1f} hours’ pay. Sundays stay overtime, paid at time and a half: {F["sundayPeople"]} a week shared among {F["people"]} people instead of {T["sundayPeople"]} among {T["people"]}, so about {F["sun"]} each a year against {T["sun"]}, and a little shorter — about {round(sun_p)} Sunday hours a year each against {round(sun_t)}, worth {pu:.1f} hours’ pay less. Together, someone who works their full share of Sundays gets {pu - ps:.1f} hours’ pay less a year: roughly £{pounds} gross, before tax, at the CEA rate of £{PAY["rate"]:.2f}. That estimate assumes the rate, a full share of the Sunday overtime and the fixed duties only — anything later given in a cover week is left out. Someone who works no Sunday overtime is {ps:.1f} hours’ pay better off. How much Sunday overtime each person works is up to them, as now. ' + swaps + ' None of this is a payslip; the Pay Calculator in the app does that.')
    # SLIDE 3'S NOTES NAME ALL NINE RULES (31 Oct 2026 review): the handovers and the 8–9-hour Sundays were left out of the list
    notes_edit(d, 3, 'with the ticket office’s pairs and the cap on shift times they are the nine December rules', 'with the ticket office’s pairs, the handovers, Sunday duties of 8 to 9 hours and the cap on shift times they are the nine December rules')
    # SLIDE 8'S NOTES SAY WHICH KNOWN TIMES MOVE DAY (31 Oct 2026 review): "you work these today" is true of a time worked today
    # only on another day, and Even Step's notes said so where In Step's and Short Run's did not. Computed for those two;
    # Even Step's own sentence is checked against the same computation
    moved = moved_days(PG); x8 = open(f'{d}/ppt/notesSlides/notesSlide8.xml', encoding='utf-8').read()
    if 'Some known times move day:' in x8:
        said = set(re.findall(r'\d\d:\d\d–\d\d:\d\d', x8.split('Some known times move day:')[1].split('. ')[0]))
        if said != {t.replace('-', '–') for t in moved}: raise SystemExit(f'deck-polish: {name}’s notes 8 name {sorted(said)} as moving day; the grid moves {sorted(moved)}')
    else:
        if name == 'In Step': notes_edit(d, 8, 'Today’s 06:20–13:45 stays on every weekday, and today’s 06:20–13:35 moves to a Saturday.', 'Today’s 06:20–13:45 stays on every weekday.')
        notes_edit(d, 8, 'The full list is on the slide.', f'{moved_sentence(PG)} The full list is on the slide.')
    # THE LONGEST EARLY, SAID FOR MONDAY TO SATURDAY WHERE THAT IS THE POINT (31 Oct 2026, Even Step): its longest early
    # anywhere is the Sunday 09:00–18:00, overtime that all three shortlisted links share, so "the longest early turn goes
    # from 8h 30m to 9h 00m" would be true and say the opposite of what the design is for. A design whose every shift
    # Monday to Saturday is within today's longest early says that instead; the others keep the sentence.
    P6 = json.load(open(os.path.join(TOOL, grid), encoding='utf-8'))['patterns']
    ms_longest = max(_len(P6[k][dd]) for k in P6 for dd in DAYS[1:] if _timed(P6[k][dd]))
    if ms_longest <= H(T['longestEarly']):
        replace_in_run(f'{d}/ppt/slides/slide6.xml', ' shorter, and nothing runs over 9 hours.', f' shorter; nothing Monday to Saturday runs over {ms_longest // 60}h\u00a0{ms_longest % 60:02d}m, and nothing at all over 9 hours.')   # no-break: "8h" ended a line
    else:
        # MONDAY TO SATURDAY HERE TOO (31 Oct 2026 review): "the longest early turn goes from 8h 30m to 9h 00m" was the Sunday
        # 09:00–18:00 all three share, so on In Step's deck it hid the 8h 55m weekday earlies that are its cost. The figure is
        # now the longest early Monday to Saturday, against today's
        ms_early = lambda g: max(_len(g[k][dd]) for k in g for dd in DAYS[1:] if _timed(g[k][dd]) and int(g[k][dd][:2]) < 11)
        me, te = ms_early(P6), ms_early(TODAY_P)
        if not me > te: raise SystemExit(f'deck-polish: {name}’s slide 6 says its longest early Monday to Saturday is longer than today’s; it is {me}, today {te}')
        replace_in_run(f'{d}/ppt/slides/slide6.xml', ' shorter, and nothing runs over 9 hours.', f' shorter; the longest early Monday to Saturday goes from {te // 60}h\u00a0{te % 60:02d}m to {me // 60}h\u00a0{me % 60:02d}m, and nothing runs over 9 hours.')
    # SLIDE 6: WHERE THE CLOSERS' TIME GOES (1 Nov 2026, owner: "make all three changes"). The slide said every closer is
    # shorter and the average two minutes longer, and left the reader to work out that the difference lands on the earlies
    # \u2014 which is the one thing someone who prefers earlies needs to know. The average early and the average late, Monday to
    # Saturday, take the place of "Longest shift anywhere" (the bar says nothing runs over 9 hours, and the Saturday closer
    # row already shows today's 9h 10m), and the average shift moves below them, as the two averages it is made of. Each is
    # coloured as the closers are: green where it is shorter than today, amber where it is longer. Refused unless the
    # earlies are longer and the lates shorter, which is what the subtitle says
    if not (H(F['avgEarly']) > H(T['avgEarly']) and H(F['avgLate']) < H(T['avgLate'])):
        raise SystemExit(f'deck-polish: slide 6 says the earlies get longer and the lates shorter; {name} has earlies {F["avgEarly"]} (today {T["avgEarly"]}) and lates {F["avgLate"]} (today {T["avgLate"]})')
    tone = lambda k: GREEN if H(F[k]) < H(T[k]) else AMBER if H(F[k]) > H(T[k]) else NAVY
    s = S(6)
    put(s, 'Every closing shift gets shorter \u2014 the average goes up about two minutes', 'Closing shifts get shorter, earlies longer \u2014 the average goes up about two minutes')
    for old, label, key in (('Longest shift anywhere', 'Average early, Monday to Saturday', 'avgEarly'), ('Average shift', 'Average late, Monday to Saturday', 'avgLate')):
        i = shape_of(s, old); set_shape(s, i, label); set_shape(s, i + 1, T[key]); set_shape(s, i + 2, F[key], tone(key))
    add_row(s, 'Average early, Monday to Saturday', 'Average late, Monday to Saturday', 'Average shift, Monday to Saturday', T['avg'], F['avg'], tone('avg'))
    s.save()
    # CORRECTED BY THE DEEP REVIEW (1 Nov 2026): the counts are the fixed duties, so "cover weeks aside", and the cover weeks
    # fill the rest — without that, 84 + 94 = 178 against today's 176.8 read as MORE shifts straight after "slightly fewer,
    # slightly longer shifts". The average late includes the closers, which the shortlist sheet's weekday lates leave out, so
    # the two figures are named apart. Even Step's notes already say the closers' time goes onto the other shifts, so theirs
    # starts plainly rather than say it twice
    cover_days = lambda p: 4 * sum(all(p[k][dd] == 'SPARE' for dd in DAYS) for k in p) * 52 / len(p)
    said6 = 'the time the closers lose goes onto the other shifts' in open(f'{d}/ppt/notesSlides/notesSlide6.xml', encoding='utf-8').read()
    notes_append(d, 6, ('On average, Monday to Saturday, ' if said6 else 'The averages show where the closers’ time goes: Monday to Saturday, ')
                 + f'the average early is {F["avgEarly"]} against {T["avgEarly"]} today, and the average late {F["avgLate"]} against {T["avgLate"]}, so the average shift hardly moves. '
                 + ('The average late includes the closers; the shortlist sheet’s weekday lates leave them out. ' if name in SHORTLIST else 'The average late includes the closers. ')
                 + f'Cover weeks aside, each person works about {F["earlyYear"]} earlies and {F["lateYear"]} lates a year, Monday to Saturday, against about {T["earlyYear"]} of each today; the cover weeks add about {round(cover_days(P6))} days a year to that, against about {round(cover_days(TODAY_P))} today, so the total stays just under today’s.')
    s = S(7)
    # THE 22:00 ROW IS EACH DESIGN'S OWN (6 Nov 2026): the template's 94 stood for every design while all of them had it; with
    # one Saturday floor late back to today's 13:30–21:00 or 14:30–22:00, Short Run and In Step have 92 and Even Step 94
    put(s, '94', F['late22'], AMBER)
    put(s, f'A little — about {F["late23"]} a year each, against {T["late23"]} today', f'{int(F["late23"]) - int(T["late23"])} more a year at 23:00 or later ({F["late23"]}, today {T["late23"]}); {int(F["late22"]) - int(T["late22"])} more at 22:00 or later ({F["late22"]}, today {T["late22"]})')
    s.save()
    if int(F['late23']) - int(T['late23']) != 3: raise SystemExit(f'deck-polish: slide 7 says three more after 23:00; {name} has {F["late23"]}, today {T["late23"]}')
    replace_run(f'{d}/ppt/slides/slide7.xml', 'Three more late finishes a year — the fewest the rules allow — and every closer is shorter.', 'More people stay on after 22:00 under the December staffing; the three more at\u00a023:00\u00a0or\u00a0later are the fewest the rules allow.')
    # the shortest gap is the FIXED duties' (the review, 31 Oct 2026): a cover week's duties are placed later, within the limits
    notes_edit(d, 7, 'And because the shortest gap between two shifts is', 'And outside the cover weeks the shortest gap between two shifts is')
    notes_edit(d, 7, ', nobody finishes late and starts early the next morning', ', so nobody finishes late and starts early the next morning')
    # NOT AVERAGES ON 26 WEEKS (the deck review, 30 Oct 2026): 52 weeks are exactly two turns of the link, so the yearly figures
    # are everyone's, whichever line they start on. Slide 5's notes say so and already leave the cover weeks out; slide 7's
    # gain the line the slide drops.
    for n in (5, 7):
        s = S(n); drop_shape(s, 'Yearly figures are averages from the fixed rota; cover-week duties are not included.'); s.save()
    notes_append(d, 7, 'The yearly figures leave the cover weeks aside, as their duties are not known yet. They are worked out over 52 weeks, which is exactly two turns of the link, so they are everyone’s.')   # not "twice a year": two turns are 364 days (external review)
    s = S(9)
    put(s, 'Full weekends off', 'Full weekends off, about a year'); put(s, '4 in 20', T['weekendsYear']); put(s, '7 in 26', F['weekendsYear'], GREEN)
    # ONE SHIFT TIME, AS THE SHEETS SAY IT (31 Oct 2026 review): "no early–late switch" is true of all 21 weeks, not the 18 the row
    # counts, and of 9 of today's 16, not 7 — the row counts weeks on one clock time Monday to Friday
    put(s, 'Weeks on one turn, Monday to Friday', 'Weeks on one shift time, Monday to Friday')
    s.save()
    replace_in_run(f'{d}/ppt/slides/slide9.xml', 'Seven weekends off in 26,', f'{F["weekendsYear"]} full weekends off a year,')
    notes_edit(d, 9, 'a full weekend cannot start in a cover week or the week before one, so only 16 of the 26 weeks can begin one', 'a cover week’s days are placed later, so a full weekend is not counted in a cover week or the week before one, which leaves 16 of the 26 weeks able to begin one')
    a1, b1 = F['oneTurn'].split(' of ')
    notes_edit(d, 9, f'and {a1} of the {b1} keep the same shift time Monday to Friday.', f'and {a1} of the {b1} keep one shift time Monday to Friday; today {T["oneTurn"].replace(" of ", " weeks in ")} do both.')   # today's 7 of 16 counts weeks that are one time AND one kind (5 Nov 2026)
    # THE BREAKS SAID AS THEY ARE (31 Oct 2026 review): "22 of 26 are two days or more, against 13 of 17" read as though the
    # design kept today's three- and four-day breaks; it has none. Computed, and refused unless that is still so
    rl, rl_t = rest_lens(PG), rest_lens(TODAY_P); one, one_t, long_t = rl.count(1), rl_t.count(1), sum(1 for n in rl_t if n > 2)
    if not (max(rl) == 2 and long_t > 0 and one == one_t and f'{rl.count(2)} of {len(rl)}' == F['breaks']):
        raise SystemExit(f'deck-polish: {name}’s notes 9 say every break is one or two days and today has longer; breaks {sorted(rl)}, today {sorted(rl_t)}')
    notes_edit(d, 9, f'Rest days mostly come in pairs: {F["breaks"].replace(" of ", " of the ")} rest-day breaks are two days or more, against {T["breaks"]} today, and single rest days stay at {WORDS[one]}, as today.',
               f'Rest days mostly come in pairs: {rl.count(2)} of the {len(rl)} rest-day breaks are two days and the other {WORDS[one]} single days, none longer; today {T["breaks"]} are two days or more, {WORDS[long_t]} of them three or four days, about one every {WORDS[round(len(TODAY_P) / long_t)]} weeks each. Single rest days stay at {WORDS[one]}, as today, so fewer a year each: about {round(one * 52 / len(PG))}, against {round(one_t * 52 / len(TODAY_P))}.')
    # THE ROW LABELS, AS THE SHEETS SAY THEM (whole-pack review, 5 Nov 2026; owner: "Say what is counted"): today's 7 of 16 counts
    # weeks on one shift time Monday to Friday that are also all earlies or all lates, and "gap" was this deck's word alone
    replace_run(f'{d}/ppt/slides/slide9.xml', 'Weeks on one shift time, Monday to Friday', 'Weeks on one shift time, all earlies or all lates')
    for n in (7, 9, 14): replace_run(f'{d}/ppt/slides/slide{n}.xml', 'Shortest gap between two shifts', 'Shortest rest between shifts')
    strip_slide(d, name, grid, F)
    s = S(11)
    put(s, 'About the same. A cover week still counts as at most 4 days of leave, as now.', f'Best stretch {F["leaveBest"]} days, not {T["leaveBest"]}; four full weeks off in a row, Sunday to Saturday, costs {F["leaveFour"]}\u00a0days’ leave, not {T["leaveFour"]}. Average the same, worst a day better.')
    s.save()
    # WHO ELSE NEEDS MORE, AND WHO KEEPS TODAY'S (5 Nov 2026): since Common Ground joined the shortlist one of the three keeps
    # today's four weeks for 14 days, so the line names the shortlisted designs that need more and the one that does not, and
    # what that one pays for it — read from the figures, and refused unless this design needs more and the keeper has more
    # single rest days
    andl_ = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]
    worse = [n for n in SHORTLIST if n != name and int(FIG[n]['leaveFour']) > int(T['leaveFour'])]
    keep = [n for n in SHORTLIST if int(FIG[n]['leaveFour']) <= int(T['leaveFour'])]
    singles = lambda n: rest_lens(grid_of(n)).count(1)
    if not (int(F['leaveFour']) > int(T['leaveFour']) and worse and keep and all(singles(k) > singles(name) for k in keep)):
        raise SystemExit(f'deck-polish: {name}’s notes 11 say it needs more leave than today for four weeks off, as {worse} do, and {keep} keep today’s for more single rest days')
    nb_ = lambda t: t.replace(' ', '\u00a0')
    plainly = (f'{name} is worse than today here, as {andl_([nb_(n) for n in worse])} {"is" if len(worse) == 1 else "are"}; {andl_([nb_(n) for n in keep])}, also on the shortlist, keeps the {T["leaveFour"]}, for more single rest days'
               if name in SHORTLIST else
               f'{name} is worse than today here, as {andl_([nb_(n) for n in worse])} on the shortlist {"is" if len(worse) == 1 else "are"}; {andl_([nb_(n) for n in keep])}, also on it, keeps the {T["leaveFour"]}, for more single rest days')
    notes_edit(d, 11, 'The exact averages depend on where you count a booking as starting, so quote them as “about the same”.', f'Say the four-weeks figure plainly, as people plan a year around it: {plainly}. The averages depend on where you count a booking as starting, so quote those as “about the same”.')
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
    put(s, 'Average as today, and the worst a day better.', 'The least leave for four complete weeks off in\u00a0a\u00a0row, Sunday to Saturday.')   # "in a / row" broke at the card's edge   # the sheet's words, cut to fit the tile
    # EVERY NEW TIME ON THE CARD (31 Oct 2026 review): it named the shorter lates and the longer earlies and left the rest out
    n_new13, body13 = new_time_kinds(PG)
    t13 = shape_of(s, f'{WORDS[n_new13].capitalize()} new shift times to learn')
    old13 = runs_of(s.x[slice(*spans(s.x)[t13 + 1])])
    if len(old13) != 1 or 'shorter versions of today’s lates' not in old13[0]: raise SystemExit(f'deck-polish: slide 13’s new-times card body is {old13}')
    set_shape(s, t13 + 1, body13)
    put(s, 'Five cover weeks', 'Two more Saturdays a year')
    put(s, 'Spaced evenly: weeks 1, 6, 11, 16 and 21.', f'{F["sat"]} a year each, today {T["sat"]} — fourteen on\u00a0a\u00a0Saturday, shared across 26 lines.')
    # THE COSTS THE SHEETS NAME (31 Oct 2026, the review of Even Step's decks): the slide said "Nothing is free — here is what it
    # costs" and left out the longer blocks and the fewer early finishes the proposal sheet and the shortlist sheet both list,
    # and the 22:00 finishes slide 7 shows. They take the places of "about 2 minutes longer on average" (slide 6 says it) and
    # "Still a proposal" (slides 1 and 15 say it); every one is computed, and refused unless it is a cost against today
    P13 = (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, grid), encoding='utf-8')))
    eo, eo_t = early_off(P13), early_off(TODAY_P)
    if not (int(F['block']) > int(T['block']) and eo < eo_t and int(F['late22']) > int(T['late22'])):
        raise SystemExit(f'deck-polish: {name}’s slide 13 names longer blocks, fewer early finishes and more 22:00 finishes as costs, and they are not')
    if 'by hand.' in open(f'{d}/ppt/notesSlides/notesSlide1.xml', encoding='utf-8').read():
        # every figure is computed, so "the slides themselves present those results by hand" said the opposite of what it meant
        notes_edit(d, 1, 'has been independently checked; the slides themselves present those results by hand.', 'has been independently checked.')
    up13 = f', {F["blockUpTo"]} if the cover weeks go the same way' if int(F['blockUpTo']) > int(F['block']) else ''
    put(s, 'Shifts about 2 minutes longer on average', 'Earlies or lates in longer runs')
    put(s, 'That is what keeps days at work to 219 a year or fewer on the same 35 hours.', f'Up to {F["block"]}\u00a0weeks of one kind{up13} (today {T["block"]}, up to {T["blockUpTo"]}).')
    put(s, 'A few more late finishes', 'More late finishes')
    put(s, f'{F["late23"]} a year each at 23:00 or later (today {T["late23"]}) — the rules’ minimum.', f'{F["late23"]} a year each at 23:00 or later (today {T["late23"]}), and {F["late22"]} at 22:00 or later (today {T["late22"]}).')
    # THE LONG BREAKS ARE A COST TOO (whole-pack review, 5 Nov 2026): slide 9 counts "rest-day breaks of two days or more" as a gain,
    # and today five of its 17 are three or four days, about 13 a year each, where these links have none (Common Ground about
    # four, its builder says). The shortlist sheet lists it among the honest costs; this card now does too, beside the early
    # finishes, both being time off that gets rarer
    lb_y = lambda g: round(sum(1 for n in rest_lens(g) if n > 2) * 52 / len(g))   # rest-day breaks of three days or more, each a year
    lb, lb_t = lb_y(P13), lb_y(TODAY_P)
    if not lb < lb_t: raise SystemExit(f'deck-polish: {name}’s slide 13 names fewer long breaks as a cost; it has {lb} a year, today {lb_t}')
    put(s, 'Still a proposal', 'Fewer early finishes and long breaks')
    put(s, 'Your views count before a link is chosen, and who goes on which line is not decided.',
        (f'{eo} a year each finish before 14:00 (today {eo_t})' if eo else f'None finish before 14:00 (today {eo_t} a year each)')
        + (f'; no 3\u2011 or 4\u2011day breaks (today {lb_t} a year).' if lb == 0 else f'; {lb} three\u2011day breaks a year (today {lb_t}).'))   # a no-break hyphen: "3-" ended a line
    put(s, 'None of these is hidden: each one is on the full proposal sheet too.', 'None of these is hidden: every figure here is worked out from the rota.')
    s.save()
    notes_edit(d, 13, 'None of these is hidden on the full proposal sheet either.', ('Every one is on the proposal sheet or the shortlist sheet as well' if name in SHORTLIST else 'Every one is on the proposal sheet as well') + ', and slide 7 has the late finishes in full.')
    replace_in_run(f'{d}/ppt/slides/slide15.xml', 'every figure worked out from the rota by the Marylebone Roster app', 'every figure worked out from the rota by the Marylebone Roster app and its tooling')
    # SLIDE 15: WHO TO TELL (owner, 5 Nov 2026: "Match the New link page"). "Tell us what worries you … your feedback goes to the
    # managers with the proposal" named nobody, and put the managers in charge of a change S. Silva, the RMT rep, leads
    p15 = f'{d}/ppt/slides/slide15.xml'
    replace_run(p15, 'Tell us what worries you, even if it is small', f'Tell {CONTACT} or your manager what worries you, even if it is small')
    replace_run(p15, 'Your feedback goes to the managers with the proposal', f'{CONTACT}, {CONTACT_ROLE}, is leading the change')
    # the closing line without the name the cover slide carries, at the managers' closing line's 13pt (12pt, with the name, it
    # pushed "tooling" onto a line of its own on the longest name)
    code15 = IDS[name][0]
    s = S(15); i = shape_of(s, f'{name} · {code15} · every figure worked out from the rota by the Marylebone Roster app and its tooling')
    set_shape(s, i, f'{code15} · every figure worked out from the rota by the Marylebone Roster app and its tooling')
    if s.x[slice(*spans(s.x)[i])].count('sz="1200"') != 2: raise SystemExit(f'deck-polish: {name}’s closing line is not 12pt')
    s.sub(i, 'sz="1200"', 'sz="1300"', count=2); s.save()
    p14 = f'{d}/ppt/slides/slide14.xml'
    replace_run(p14, '219', T['daysYear'], after='Contracted days at work a year'); replace_run(p14, '219', F['daysYear'], after='Contracted days at work a year')
    replace_run(p14, '4 in 20', T['weekendsYear'], after='Full weekends off'); replace_run(p14, '7 in 26', F['weekendsYear'], after='Full weekends off'); replace_run(p14, 'Full weekends off', 'Full weekends off, about a year')
    # THE FATIGUE CELLS CARRY THE WORST CASE (31 Oct 2026), as today's "4 (up to 5)" beside them does: with a cover week's
    # Sunday worked as overtime the four can make a 55-hour week, which the sheets give as "0 (up to 1)"
    for n in (12, 14):
        replace_run(f'{d}/ppt/slides/slide{n}.xml', 'Avoidable fatigue warnings in the fixed rota', 'Avoidable fatigue warnings, cover weeks aside')
        replace_run(f'{d}/ppt/slides/slide{n}.xml', '0', F['ff'], after='Avoidable fatigue warnings, cover weeks aside')
    if explain_h55(name, F): notes_append(d, 12, f'The “up to 1” beside the fatigue warnings is more than 55 hours in seven days. If a cover week’s four duties come straight after a busy week, and its Sunday is worked as overtime too, those seven days can come to {F["h55"]} with 8-hour duties, and more with longer ones, which the rail industry’s guidance flags. Where the four fall, and whether the Sunday is worked, is for the roster office.')
    # SLIDE 8, THE TIMES, SET FOR A ROOM (third review, 1 Nov 2026: "the familiar-time list and explanatory annotations are
    # small for projection. Enlarge the times and shorten annotations. There is spare space within the panels"). The times
    # people already work go in two columns at 18pt, read down; each new time becomes one row — the day, the time, what it is
    # — at 13pt, with the day named once for its group. Every note is the builder's own, shortened by a rule below, so a
    # note no rule knows stops the build rather than reaching a slide unreviewed.
    # COLUMNS ARE SEPARATE BOXES, NOT TAB STOPS: LibreOffice ignored the paragraphs' own tab stops and used its default grid,
    # which wrapped "07:15– / 15:45" and ran a note into its time (screenshots, 1 Nov 2026). Boxes with the same size and
    # spacing, every line one row, align the same way in both programs. Widths measured against Inter: "Weekdays" 0.92in
    # bold, a time 1.05in at 13pt and 1.46in at 18pt, the longest note 2.50in
    p8 = f'{d}/ppt/slides/slide8.xml'; x = open(p8, encoding='utf-8').read()
    TIME = r'\d\d:\d\d–\d\d:\d\d'; IN = 914400
    text = lambda q: ''.join(re.findall(r'<a:t>([^<]*)</a:t>', q)).replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    paras = lambda sp: re.findall(r'<a:p>.*?</a:p>', sp, re.S)
    shapes = re.findall(r'<p:sp>.*?</p:sp>', x, re.S)
    known = [sp for sp in shapes if len(paras(sp)) >= 6 and all(re.fullmatch(TIME, text(q)) for q in paras(sp))]
    news = [sp for sp in shapes if paras(sp) and text(paras(sp)[0]) == 'Weekdays']
    if len(known) != 1 or len(news) != 1: raise SystemExit(f'deck-polish: {name}’s slide 8 lists not found ({len(known)} and {len(news)})')
    def rpr(sz, color, bold=False):
        b = ' b="1"' if bold else ''
        return (f'<a:rPr lang="en-GB" sz="{sz}"{b} dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
                '<a:latin typeface="Inter" pitchFamily="34" charset="0"/><a:ea typeface="Inter" pitchFamily="34" charset="-122"/>'
                '<a:cs typeface="Inter" pitchFamily="34" charset="-120"/></a:rPr>')
    def para(t, sz, color, after, before=0, bold=False):   # an empty `t` still takes a line of this size, so rows stay level
        ppr = '<a:pPr marL="0" indent="0">' + (f'<a:spcBef><a:spcPts val="{before}"/></a:spcBef>' if before else '') + f'<a:spcAft><a:spcPts val="{after}"/></a:spcAft><a:buNone/></a:pPr>'
        return '<a:p>' + ppr + (f'<a:r>{rpr(sz, color, bold)}<a:t>{escape(t)}</a:t></a:r>' if t else '') + f'<a:endParaRPr lang="en-GB" sz="{sz}" dirty="0"/></a:p>'
    ids = [int(v) for v in re.findall(r'<p:cNvPr id="(\d+)"', x)]; nxt = iter(range(max(ids) + 1, max(ids) + 10))
    def boxes(sp, cols):   # one box per column [(x offset, width, paragraphs)], the first keeping the shape's own id
        out = []
        x0, y0, cx0, cy0 = (int(v) for v in re.search(r'<a:off x="(\d+)" y="(\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', sp).groups())
        for k, (dx, w, ps) in enumerate(cols):
            c = sp if k == 0 else re.sub(r'<p:cNvPr id="\d+" name="([^"]*)"', lambda m: f'<p:cNvPr id="{next(nxt)}" name="{m[1]} {k + 1}"', sp, count=1)
            c = re.sub(r'<a:off x="\d+" y="\d+"/><a:ext cx="\d+" cy="\d+"/>', f'<a:off x="{x0 + dx}" y="{y0}"/><a:ext cx="{w}" cy="{cy0}"/>', c, count=1)
            q = paras(c); out.append(c[:c.find(q[0])] + ''.join(ps) + c[c.rfind(q[-1]) + len(q[-1]):])
        return ''.join(out)
    # the times worked today: two columns at 18pt, read down
    ts = [text(q) for q in paras(known[0])]; half = -(-len(ts) // 2)
    col = lambda items: [para(t, 1800, '1B2533', 600) for t in items]
    left = boxes(known[0], [(0, int(1.6 * IN), col(ts[:half])), (int(1.65 * IN), int(1.55 * IN), col(ts[half:]))])
    # the new times: day, time, what it is
    def short(note):
        rules = [(r'(?:the |a )?(?:weekday )?closer, (\d+) minutes later than \d\d:\d\d', lambda m: f'closer, starts {m[1]} min later'),
                 (r'(?:the |a )?(?:weekday )?closer, 1 hour later than \d\d:\d\d', lambda m: 'closer, starts 1 hour later'),
                 (r'a new late, ending with the ticket office', lambda m: 'new late, ends with the office'),
                 (r'a new (early|late), (.+)', lambda m: f'new {m[1]}, {m[2]}'),
                 (r'the ticket-office late(?: \(also a weekday time\))?', lambda m: 'ticket-office late'),
                 (r'all (\w+) worked today, .+', lambda m: f'all {m[1]} worked today')]
        for pat, fn in rules:
            m = re.fullmatch(pat, note)
            if m: return fn(m)
        raise SystemExit(f'deck-polish: {name}’s slide 8 has a new-time note no rule shortens: {note!r}')
    groups = []
    for q in paras(news[0]):
        t = text(q)
        if t in ('Weekdays', 'Saturday', 'Sunday'): groups.append((t, [])); continue
        times, _, note = t.partition(' — ')
        if not groups or not note: raise SystemExit(f'deck-polish: {name}’s slide 8 new-time line not understood: {t!r}')
        found = re.findall(TIME, times)
        if times == 'nothing new': groups[-1][1].append((times, short(note)))
        elif ' and ' in times:   # "06:20–15:15 and 07:00–15:45 — new earlies, 8h 55m and 8h 45m": a row each
            durs = re.findall(r'\d+h[ \u00a0]\d+m', note)
            if not (note.startswith('new earlies') and len(found) == len(durs) == 2): raise SystemExit(f'deck-polish: {name}’s slide 8 pair not understood: {t!r}')
            groups[-1][1].extend((tt, f'new early, {dd}') for tt, dd in zip(found, durs))
        elif found == [times]: groups[-1][1].append((times, short(note)))
        else: raise SystemExit(f'deck-polish: {name}’s slide 8 new-time line not understood: {t!r}')
    # WHAT CHANGES, IN THREE LINES (fourth review, 1 Nov 2026: "emphasise what changes and what stays familiar. Leave the
    # exhaustive list available as a reference"). The rows above were complete and still had to be read row by row; the
    # panel now says what the new times amount to, and the notes give every one. Each design's lines are written for it and
    # checked against the builder's own list: every new time must be named, or be a closer whose later start the first
    # line states for its day, and no time may be named that is not new
    WHEN = {'Weekdays': 'weekdays', 'Saturday': 'Saturdays', 'Sunday': 'Sundays'}
    andl = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]
    closers = {WHEN[day]: re.fullmatch(r'closer, starts (\d+ min|1 hour) later', nt)[1] for day, items in groups for tm, nt in items if nt.startswith('closer')}
    SAY = {'30 min': '30 minutes', '45 min': '45 minutes', '1 hour': 'an hour'}
    # THE WEEKEND'S NEW LATE (the 22:30 ticket office, 6 Nov 2026): the office late is 14:30–22:30 on a Saturday as on a Sunday —
    # named once, as In Step's 14:30–22:30 is (whole-pack review, 5 Nov 2026: named twice, six new times read as seven). The
    # floor's 14:00–22:00, new for a few hours that day, went when one floor late kept 22:30 and the other became a time
    # worked today (14:30–22:00 or 13:30–21:00)
    sunday = 'On Sundays: a 9-hour early, 09:00–18:00'
    weekend = 'Weekends: the ticket-office late, 14:30–22:30'
    lines = {'Even Step': ['A new weekday late, 12:15–20:30', weekend, sunday],
             'In Step': ['Two weekday earlies longer than any today, 06:20–15:15 and 07:00–15:45',
                         'A new late, 14:30–22:30, on weekdays and as the weekend ticket-office late', 'A 9-hour Sunday early, 09:00–18:00'],
             'Short Run': ['A 9-hour weekday early, 07:00–16:00, and a\u00a0new\u00a0late, 15:00–22:30', weekend, sunday]}[name]
    lines = ['Closers start later: ' + ', '.join(f'{SAY[v]} on {k}' for k, v in closers.items())] + lines   # every line two at most
    # THE PANEL HOLDS SEVEN LINES AT 15PT (2.15 in, measured against Inter, 6 Nov 2026), and only just with 10pt between three
    # bullets: four bullets go 8pt apart, which keeps Short Run's seven lines off the card's edge; In Step's four take eight
    # lines, two each, so its panel is set at 14pt, 6pt apart, rather than lose a time or a word that says what one is
    size, gap = (1400, 600) if name == 'In Step' else (1500, 800 if len(lines) > 3 else 1000)
    named = {t for ln in lines for t in re.findall(TIME, ln)}
    new_all = {tm for day, items in groups for tm, nt in items if re.fullmatch(TIME, tm)}
    closer_t = {tm for day, items in groups for tm, nt in items if nt.startswith('closer')}
    if not (named <= new_all and new_all - closer_t <= named): raise SystemExit(f'deck-polish: {name}’s slide 8 lines name {sorted(named)}; the new times are {sorted(new_all)}')
    # and the builder's list is the grid's (6 Nov 2026): a list that kept a time the grid no longer works, or missed one it
    # gained, would pass the check above and print both
    grid_new = {t.replace('-', '–') for t in {PG[k][dd] for k in PG for dd in DAYS if _timed(PG[k][dd])} - {TODAY_P[k][dd] for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd])}}
    if new_all != grid_new: raise SystemExit(f'deck-polish: {name}’s slide 8 lists {sorted(new_all)} as new; the grid’s new times are {sorted(grid_new)}')
    joined = lambda t: re.sub(r'(\d\d:\d\d–)(?=\d)', '\\1\u2060', t)   # a word joiner: a time never breaks at its dash
    def bullet(t, sz=1500, after=1000):
        return ('<a:p><a:pPr marL="190500" indent="-190500"><a:spcAft><a:spcPts val="' + str(after) + '"/></a:spcAft><a:buSzPct val="100000"/>'
                '<a:buFont typeface="Inter" pitchFamily="34" charset="0"/><a:buChar char="&#x2022;"/></a:pPr>'
                f'<a:r>{rpr(sz, "1B2533")}<a:t>{escape(joined(t))}</a:t></a:r><a:endParaRPr lang="en-GB" sz="{sz}" dirty="0"/></a:p>')
    right = boxes(news[0], [(0, int(4.8 * IN), [bullet(ln, size, gap) for ln in lines])])
    notes_append(d, 8, 'For reference, every new time: ' + '; '.join(f'{day}, ' + ', '.join(f'{tm} ({nt})' for tm, nt in items) for day, items in groups) + '.')
    x = x.replace(known[0], left).replace(news[0], right)
    open(p8, 'w', encoding='utf-8').write(x)
    # SLIDE 14: THE MESSAGE BEFORE THE FIGURES (fourth review, 1 Nov 2026: "make the principal choice obvious before presenting
    # the detailed figures"). The subtitle says what the table shows; the three rows that carry it stay bold and the rest go
    # to regular weight, so the eye lands on them first; and the bar, which used to repeat the message, now says the price,
    # so the closing slide is as balanced as slide 13
    if not (H(F['closerWk']) < H(T['closerWk']) and int(F['weekendsYear']) > int(T['weekendsYear']) and first(F['run']) < first(T['run'])
            and int(F['late22']) > int(T['late22']) and int(F['block']) > int(T['block'])):
        raise SystemExit(f'deck-polish: slide 14’s subtitle or bar is no longer true of {name}')
    s = S(14)
    put(s, f'Today’s roster and {name}, side by side', 'Same hours and days, shorter closers, more weekends off, fewer days in a row')
    # THE COSTS IN FULL (whole-pack review, 5 Nov 2026): the bar named two of them, and left out the leave for four weeks off
    # and, on two designs, the long weekday earlies, both on slide 13 — on a slide left up during questions
    costs14 = ['more late finishes', 'longer runs of earlies or lates'] + (['longer weekday earlies'] if long_wk_earlies(P13) else []) \
              + ([f'{F["leaveFour"]}\u00a0days’\u00a0leave\u00a0for\u00a0four\u00a0weeks\u00a0off'] if int(F['leaveFour']) > int(T['leaveFour']) else [])   # kept together: "weeks off." ended alone
    put(s, 'Same hours and days, shorter closers, more full weekends off.', f'The costs: {andl(costs14)}.')
    s.save()
    p14 = f'{d}/ppt/slides/slide14.xml'; x = open(p14, encoding='utf-8').read()
    KEY = ('Closing shift: weekday · Saturday · Sunday', 'Full weekends off, about a year', 'Most days worked in a row')
    rows = re.findall(r'<a:tr\b.*?</a:tr>', x, re.S)
    label = lambda r: ''.join(re.findall(r'<a:t>([^<]*)</a:t>', re.search(r'<a:tc\b.*?</a:tc>', r, re.S).group(0)))
    if sorted(label(r) for r in rows if label(r) in [escape(k) for k in KEY]) != sorted(escape(k) for k in KEY): raise SystemExit(f'deck-polish: {name}’s slide 14 rows not found')
    for r in rows[1:]:
        if label(r) not in [escape(k) for k in KEY]: x = x.replace(r, r.replace(' b="1"', ''))
    open(p14, 'w', encoding='utf-8').write(x)
    # SLIDE 14 IS A REFERENCE, NOT A READ-THROUGH (third review, 1 Nov 2026)
    notes_append(d, 14, 'Do not read it row by row. Take the rows people ask about; if nobody asks, three carry the case: the closing shifts, the full weekends off and the days in a row.')

    # "COVER WEEKS ASIDE", NOT "THE FIXED ROTA" (owner, 1 Nov 2026, after the managers' review): the managers read "fixed rota"
    # as the station's fixed lines — the app has a roster type called 'fixed' — and these decks used the term on five slides
    # while defining it only in notes 2, which a PDF does not carry. The sentences above are written in the new words; the
    # builders' own are reworded here, and polish() refuses a deck that still says it
    def reword(part, old, new):
        path = f'{d}/ppt/{part}.xml'; x = open(path, encoding='utf-8').read()
        if x.count(escape(old)) != 1: raise SystemExit(f'deck-polish: {path} holds {old!r} {x.count(escape(old))} times, not once')
        open(path, 'w', encoding='utf-8').write(x.replace(escape(old), escape(new)))
    reword('slides/slide2', ' days in a row on the fixed rota.', ' days in a row, cover weeks aside.')
    reword('slides/slide9', ' five days in a row on the fixed rota.', ' five\u00a0days\u00a0in\u00a0a\u00a0row, cover weeks aside.')   # kept together: the bar broke "in a / row"
    reword('slides/slide12', 'no avoidable fatigue warnings in the fixed rota.', 'no avoidable fatigue warnings, cover weeks aside.')
    reword('notesSlides/notesSlide2', 'Never more than five days in a row on the fixed rota —', 'Never more than five days in a row outside the cover weeks —')
    reword('notesSlides/notesSlide9', 'Nobody works more than five days in a row on the fixed rota —', 'Outside the cover weeks nobody works more than five days in a row —')
    reword('notesSlides/notesSlide12', 'shows four of them in the fixed rota (up to five', 'shows four of them, cover weeks aside (up to five')

def managers(d, name, grid, F):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    tile(s, 4, ['December rules met'], 'December staffing\nrules met')   # what the rules are about (managers' review, 1 Nov 2026)
    tile(s, 8, ['contract rostered exactly, on average'], 'contracted hours\na week'); tile(s, 9, ['Monday to Saturday'], 'Mon–Sat average')
    tile(s, 12, ['avoidable fatigue warnings'], 'avoidable\nfatigue warnings'); tile(s, 13, ['in the fixed rota · today 4'], 'cover weeks aside')   # "fixed rota" read as the fixed lines (review); today's 4 is slide 6's, as one line will not hold both
    tile(s, 16, ['people on the link'], 'people\non the link')
    tile(s, 5, ['today’s link: 4'], 'today 4 of 9'); tile(s, 17, ['today: 20'], 'today 20')   # one form across the row (screenshot pass)
    s.save()
    # ROSTERED THAT DAY (31 Oct 2026 review): "on duty during the day" read as on at once; at any one moment a weekday has at most
    # 11. The sheets' own words, "on duty each day", and deck-check.mjs reads the row by them
    s = S(3); put(s, 'On duty during the day', 'On duty each day (Sunday: at least 10)'); s.save()   # each row says its rule (managers' review)
    # THE SUNDAY AS THE MODEL HAS IT (31 Oct 2026 review): "(on a Sunday both lates, until 15:00)" left out the early's hours and
    # the late who goes back to the floor at 18:00 — report-data.mjs's OFFICE_HELP_TEXT, read here so the two cannot drift
    help_ = subprocess.check_output(['node', '-e', "import('./report-data.mjs').then(m => process.stdout.write(m.OFFICE_HELP_TEXT))"], cwd=TOOL, text=True)
    # and the other late at 22:00, once the office has shut and cashed up (6 Nov 2026, the 72-hour review): the model gained
    # that clause with the Sunday office emptied at 22:00, and this check, asking only for the three older ones, still passed
    if not all(w in help_ for w in ('one early is on the floor until 09:00', 'the two lates are on the floor until 15:00', 'one goes back to the floor from 18:00', 'and the other at 22:00, once the office has shut and cashed up')):
        raise SystemExit(f'deck-polish: managers’ notes 3 describe the Sunday office as the model did; it now says {help_!r}')
    notes_edit(d, 3, 'except its second person at the quiet ends of the day.', 'except at the quiet ends of the day, when one of each pair helps on the floor — on a Sunday one early until 09:00, and both lates until 15:00, one of them again from 18:00 and the other at 22:00, once the office has shut and cashed up.')
    s = S(6); drop_shape(s, 'Early starts and a weekly rotation come with every link, so are not counted. The written source of the 13-day limit is still to be confirmed.'); s.save()
    replace_run(f'{d}/ppt/slides/slide6.xml', '0', F['ff'], after='Avoidable fatigue warnings, fixed rota')   # the worst case too, as on the colleagues' slides
    if explain_h55(name, F): notes_append(d, 6, f'The “up to 1” beside the fatigue warnings is the rail industry’s guideline of no more than 55 hours in any seven-day period: worked as four 8-hour duties straight after a busy line, with its Sunday as overtime too, a cover week can make {F["h55"]} in seven days. Where the four fall, and whether the Sunday is worked, is for the roster office.')
    # the dropped line's first half the notes already say ("come with every weekly link … not counted"), so only the second
    # goes on; and the FF19 sentence says what its reading is and what the stricter one would mean (the deck review)
    notes_append(d, 6, 'The written source of the 13-day limit is still to be confirmed.')
    notes_edit(d, 6, 'is counted on our reading and should be confirmed by whoever assesses it.',
               'is counted on our reading, in which a rest day breaks the run, and whoever assesses it should confirm that: on the stricter reading every link has it (FF19 on the rules sheet).')
    s = S(4)
    drop_shape(s, 'A measure of the day’s shape only — not a staffing requirement or a passenger forecast.')
    notes_edit(d, 4, 'It is a guide to shape, not a staffing requirement —', 'It is a guide to shape, not a staffing requirement or a passenger forecast —')   # the dropped line, without saying "not a staffing requirement" twice
    # "much closer" on weekdays only where the weekday score is under about 60% of today's (Short Run's 56%, In Step's 57%; Closing Time's was 70%)
    # ONE SENTENCE FOR ALL THREE (managers' review, 1 Nov 2026): the threshold gave Even Step a different bar for a difference
    # the subtitle's numbers already show; the score's definition moved up into the subtitle, so the bar says the point
    if not (float(F['fitWk']) < float(T['fitWk']) and all(float(F[k]) < 0.5 * float(T[k]) for k in ('fitSat', 'fitSun'))):
        raise SystemExit(f'deck-polish: slide 4 says {name} follows the trains more closely every day and far more at weekends; it does not')
    put(s, 'Much closer to the December pattern on weekdays, Saturday and Sunday.', 'Staffing follows the December trains more closely every day — far more at weekends.')
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
    O = [grid_of(n) for n in SHORTLIST if n != name]
    today_times = {TODAY_P[k][dd] for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd])}
    ms_new_earlies = lambda g: len({g[k][dd] for k in g for dd in DAYS[1:] if _timed(g[k][dd]) and int(g[k][dd][:2]) < 11} - today_times)
    # THE 22:30 TICKET OFFICE (6 Nov 2026) TOOK ONE EDGE FROM EACH: Common Ground lost its 9-hour Saturday late, so it has nothing
    # over 8h 30m on any day and Even Step's "no shift over 8h 30m, Mon–Sat" is no longer its own; and every design gained two
    # new Saturday lates, so Short Run's "no new Saturday time" went. Short Run's line keeps the two it has.
    # ONE SATURDAY FLOOR LATE BACK TO TODAY'S TIME (6 Nov 2026, the owner's "Yes"): each design then had one new Saturday late,
    # not two, and Common Ground's Saturday fit became the closest of the three (9.8, Even Step 10.4), so Even Step's line names
    # its steadiest weeks instead, the shortlist sheet's measure (a lighter heaviest week and a narrower range than either
    # other); and In Step's Saturday fit now shows as Common Ground's, 9.8 each, so its line keeps the steadier hours alone
    steadiest = lambda F, others: (H(F['heavy']) < min(H(o['heavy']) for o in others)
                                   and H(F['heavy']) - H(F['light']) < min(H(o['heavy']) - H(o['light']) for o in others))
    edge = {'Even Step': ms_new_earlies(P) == 0 < min(ms_new_earlies(g) for g in O) and steadiest(F, others),
            'Short Run': float(F['fitWk']) < min(float(o['fitWk']) for o in others),
            'In Step': steadiest(F, others)}[name]
    # IN STEP'S EARLY FINISHES ARE NO LONGER ITS OWN (5 Nov 2026): Common Ground, shortlisted, has as many, 12 a year each, so the
    # line names the two edges it still has over all three shortlisted links, and the notes give the early finishes with their figures
    # (1 Nov 2026, managers' review: In Step's line now names its early finishes, Short Run's its short lates, as the shortlist does)
    if name == 'Short Run' and not weekday_late_avg(P) < min(weekday_late_avg(g) for g in O):
        raise SystemExit('deck-polish: Short Run’s "This one adds" names the shortest weekday lates, and they are not')
    if not edge: raise SystemExit(f'deck-polish: {name}’s "This one adds" line is no longer its own among the shortlist')
    adds = {'Even Step': 'This one adds: every early one of today’s times, Mon–Sat; the steadiest weeks',
            'Short Run': 'This one adds: the closest weekday fit and the shortest weekday lates',
            'In Step': 'This one adds: steadier weekly hours than all three'}[name]   # off the shortlist since 5 Nov 2026: against the three, not "of the three"
    # WHAT IT COSTS IS AGAINST TODAY, as the bar beneath and the four weeks' leave are (30 Oct 2026). Short Run's line was "one
    # 42h 30m week (today up to 43h 50m)": heavier than In Step's, and lighter than today's, so it read as a cost and was not
    # one. Both now name their long weekday earlies, where today no early is over 8h 30m: In Step's 40 a year, Short Run's
    # 20. Refused if either stops being a cost against today. Even Step has no weekday early over 8h 30m, so its line names
    # the cost it does carry against today, the two more Saturdays a year each (31 Oct 2026), which the colleagues' slide 13
    # shows too.
    worst = lambda mine, theirs: all(mine > t for t in theirs)   # the worst of the three: more is worse
    # EVEN STEP'S COST AMONG THE NEW THREE (5 Nov 2026): its lates and its weekday fit were the worst of the three beside In Step
    # and Short Run, and are not beside Common Ground (8h 30m lates, a 32.7 fit). What is still its own is the change of start
    # from one week to the next, the biggest of the three; its leave, which Short Run shares and Common Ground does not, is on
    # slide 8 and in the notes
    # SAID AGAINST TODAY TOO (whole-pack review, 5 Nov 2026): "start times that move most week to week" is the most of the three,
    # and still far less than today's, which the line now gives beside it
    costs = {'Even Step': worst(H(F['step']), [H(o['step']) for o in others]) and H(F['step']) < H(T['step'])
                          and f'This one costs: start times that move most week to week, {F["step"]} (today {T["step"]})',
             'In Step': worst(long_wk_earlies(P), [long_wk_earlies(g) for g in O])
                        and f'This one costs: the most long weekday earlies, about {long_wk_earlies(P)} a year each over 8h 30m',
             # SHORT RUN'S LONG EARLIES ARE ITS COST TOO (1 Nov 2026, managers' review): side by side the slides said only In Step had
             # them, though Short Run's are the longer (9h 00m); its heaviest week moved to the notes, being lighter than today's
             # ONE COST, SAID AGAINST TODAY (whole-pack review, 5 Nov 2026): its 8h 40m Saturday closer is in notes 7 and still
             # shorter than today's 9h 10m, so the line names the long earlies alone, with today's none beside them
             'Short Run': worst(long_wk_earlies(P), [long_wk_earlies(g) for g in O]) and long_wk_lengths(P) == {540}
                          and not any(_len(TODAY_P[k][dd]) > 510 for k in TODAY_P for dd in DAYS[1:6] if _timed(TODAY_P[k][dd]) and int(TODAY_P[k][dd][:2]) < 11)
                          and f'This one costs: 9-hour weekday earlies, {long_wk_earlies(P)} a year each (today none over 8h 30m)'}.get(name)   # its 13:45 and early finishes: slide 8 and the notes
    if not costs: raise SystemExit(f'deck-polish: {name}’s "This one costs" line is no longer its own among the shortlist')
    # THE BAR NAMES ONLY WHAT ALL THREE COST (5 Nov 2026): Common Ground keeps today's four weeks for 14 days, so the leave left
    # the bar; it is said, design by design, on slide 8 and in the notes
    if not all(int(f['sat']) - int(T['sat']) == int(F['sat']) - int(T['sat']) > 0 and int(f['late23']) > int(T['late23']) for f in SL.values()):
        raise SystemExit(f'deck-polish: the bar names more late finishes and the same more Saturdays as costs all three share, and for one of them they are not')
    # THE TIMES LINE IS THE GAIN (1 Nov 2026, managers' review): it carried a green tick beside "5 new", which slide 8 lists as a
    # worry; it now says what the tick is for, fewer times than today and most of them known, and the new ones stay on slide 8.
    # A GAIN ALL THREE SHARE (whole-pack review, 5 Nov 2026): it sat between "this one adds" and "this one costs" as though it
    # were this design's own, and every shortlisted link has fewer times than today; it joins the shared lines, with this
    # design's own count after the dash
    every('fewer shift times than today', lambda f: first(f['times']) < int(T['times']))
    lead = ALL.capitalize() if name in SHORTLIST else f'Like {ALL}'   # an off-shortlist design shares them; the subtitle says who the three are (5 Nov 2026: "Like all three shortlisted" wrapped two lines)
    times_line = f'{lead}: fewer shift times than today’s {T["times"]} — here {n_times}, {n_known} worked today'
    # true of every shortlisted design, or it would not be on every deck: the flexible rules are left out, as the ticks have no
    # room for them; every one meets all three, which the managers' notes 2 and 3 say
    labels = [f'{lead}: all 9 December rules; no avoidable fatigue warning, cover weeks aside',   # "fixed rota" read as the fixed lines (review)
              f'{lead}: {F["weekendsYear"]} full weekends off a year each (today {T["weekendsYear"]}), at most {GAP} weeks apart',
              f'{lead}: no shift over 9 hours, and every closing shift shorter',
              times_line, adds, costs]
    for i, (t, lab) in enumerate(zip(ticks, labels)): set_shape(s, t + 1, lab)
    set_shape(s, ticks[-1], '–')
    ell = ticks[-1] - 1   # the circle behind the dash is amber, as the worries on slide 8 are: a cost is not a benefit (the deck review)
    if 'prst="ellipse"' not in s.x[slice(*spans(s.x)[ell])]: raise SystemExit('deck-polish: no circle behind the costs line')
    s.sub(ell, GREEN, AMBER, 2)
    bars = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) and runs_of(s.x[a:b])[0].startswith('The trade-off')]; assert len(bars) == 1
    # SAID AS COSTS, EACH AGAINST TODAY (1 Nov 2026, managers' review): "four weeks off for 15 days’ leave" read as a perk
    # the shared costs said without their figures (fourth review, 1 Nov 2026: "qualifications and multiple figures sometimes
    # compete with the main message"); the figures are in notes 7 and 8
    more_sat = WORDS[int(F["sat"]) - int(T["sat"])]
    set_shape(s, bars[0], f'What {ALL} cost: more late finishes and {more_sat} more Saturdays a year.' if name in SHORTLIST
              else f'Like the shortlisted three, it costs more late finishes and {more_sat} more Saturdays a year.')
    set_shape(s, 1, f'What {ALL} shortlisted links give, what this one adds, and what it costs' if name in SHORTLIST
              else f'What it shares with the shortlisted links, what it adds, and what it costs')
    if name not in SHORTLIST: put(s, f'Why {name}?', f'{name} beside the shortlist')   # "Why In Step?" argued for a design off the shortlist (5 Nov 2026)
    s.save()
    replace_run(f'{d}/ppt/slides/slide8.xml', f'Late finishes: {F["late23"]} a year (today {T["late23"]})', f'Late finishes: {F["late23"]} a year at 23:00 or later (today {T["late23"]}), {F["late22"]} at 22:00 or later (today {T["late22"]})')
    replace_run(f'{d}/ppt/slides/slide8.xml', f'Best 14-day leave stretch {F["leaveBest"]} days, not {T["leaveBest"]}', f'14 days’ leave: at best {F["leaveBest"]} days off, not\u00a0{T["leaveBest"]}')
    replace_run(f'{d}/ppt/slides/slide8.xml', f'Four weeks off needs {F["leaveFour"]} days’ leave, not {T["leaveFour"]}', f'Four weeks off in a row: {F["leaveFour"]} days’ leave, not\u00a0{T["leaveFour"]}')   # "14" was left alone on a line
    # THE WEEKLY HOURS ARE MONDAY TO SATURDAY (31 Oct 2026 review): Sunday is overtime, so "its working weeks run from 25h 30m to
    # 41h 05m" was a Monday-to-Saturday figure read as a whole week's. Said so wherever the notes quote the range
    nx = lambda n: open(f'{d}/ppt/notesSlides/notesSlide{n}.xml', encoding='utf-8').read()
    rng = f'Its working weeks run from {F["light"]} to {F["heavy"]} (today'
    if escape(rng) in nx(7): notes_edit(d, 7, rng, f'Its working weeks run from {F["light"]} to {F["heavy"]} Monday to Saturday (today')
    notes_edit(d, 8, f'Weekly hours run from {F["light"]} to {F["heavy"]}', f'Weekly hours, Monday to Saturday, run from {F["light"]} to {F["heavy"]}')
    if name == 'Short Run':
        notes_edit(d, 7, f'Its heaviest week is {F["heavy"]}, against today’s {T["heavy"]}.', f'Its heaviest week, Monday to Saturday, is {F["heavy"]}, against today’s {T["heavy"]}.')
        # ITS SHORTEST REST IS ON THE CARD AND THE SHEET, AND WAS NOT IN WHAT IT GIVES UP (31 Oct 2026 review)
        rests = {FIG[n]['rest'] for n in SHORTLIST if n != name}
        if not (len(rests) == 1 and H(F['rest']) < H(next(iter(rests)))): raise SystemExit(f'deck-polish: Short Run’s notes 7 say its rest is the shortest of the three; {F["rest"]} against {rests}')
        notes_edit(d, 7, f'; and less even weeks ({F["light"]} to {F["heavy"]},', f'; the shortest rest of the three, {F["rest"]} against their {next(iter(rests))} (today {T["rest"]}); and less even weeks, Monday to Saturday ({F["light"]} to {F["heavy"]},')
    if name == 'In Step':
        # NAMED FOR WHAT THEY ARE (31 Oct 2026 review): "none over 8h 30m" was untrue of Even Step's Sunday 09:00–18:00, and "Closing
        # Time's weeks" named a design a manager reading the shortlist has not met
        # (the notes keep a design's name together with a no-break space, as rename_everywhere writes it)
        notes_edit(d, 7, 'where Even\u00a0Step has none over 8h 30m and neither has today', 'where neither Even\u00a0Step nor today has an early over 8h 30m Monday to Saturday')
        notes_edit(d, 7, 'In Step (30 October 2026) is Closing\u00a0Time’s weeks with the shift times chosen again', 'In Step (30 October 2026) takes the weeks of Closing\u00a0Time, another design in the pack, and chooses the shift times again')
    s = S(5)
    put(s, '4 — 1 week in 5', T['cover']); put(s, '5 — 1 week in 5', F['cover'])   # "4 of 20 (20%)": the share, not "1 in 5.2" (review)
    # THE SUNDAY TOTAL IS THE LINK'S (1 Nov 2026, managers' review): "a week across the link" read as each person getting more
    put(s, 'Six more people, 35 hours a week on average — Sundays still rely on overtime.', 'Six more people, the same 35-hour week — and Sundays are still worked as overtime.')
    s.save()
    s = S(9)
    put(s, 'Three things confirmed verbally (29 Sep and 1 Oct 2026), two decisions left', 'Three things settled, two decisions left, two points still open')   # the 26 lines were set on 1 Oct, not confirmed verbally (31 Oct review)
    # THE OPEN POINTS IN THE BAR, APART FROM THE ROWS (the fifth review's follow-up, 1 Nov 2026): "The 'Still open' sentence sits beneath
    # 'who starts on which line', although it concerns separate matters." Each row now describes only its own topic, the
    # order of the two decisions is said on the rows themselves, and the bar carries the two open points, set apart from both
    put(s, 'Who begins on which week of the link.', 'Decided after the link is chosen.')
    put(s, 'Colleagues’ views come first; the link is chosen after them, then who starts where.',
        'Still open: where the 13-day limit is written; how one fatigue check treats a rest day.')   # no "FF19" (review); one line at 14pt
    # SAID AS THEY WERE SETTLED (external review, 31 Oct 2026): the rules and the Sunday cover were confirmed VERBALLY, as every
    # other surface says; the 26 lines were set by the owner on 1 October
    put(s, 'December rules — confirmed', 'December rules — confirmed verbally'); put(s, 'Sunday cover — confirmed', 'Sunday cover — confirmed verbally')
    put(s, '26 people on the link — confirmed', '26 people on the link — decided')   # no date on the slide (owner: office detail nobody needs); the notes keep it
    s.save()
    notes_append(d, 9, 'The December rules and the Sunday cover were confirmed verbally on 29 September 2026, and are worth having in writing before a link is chosen; the 26-week link was set on 1 October 2026.')
    replace_run(f'{d}/ppt/slides/slide8.xml', '7 weekends off, at most 5 weeks apart', f'{F["weekendsYear"]} full weekends off a year (today {T["weekendsYear"]})')
    managers_review(d, name, P, O, others, F, help_)

def managers_review(d, name, P, O, others, F, help_):
    """THE MANAGERS' DECKS, REVIEWED FOR CLARITY AND CONSISTENCY (1 Nov 2026, owner: "Review the managers presentations for
    clarity", "for consistency", "Aesthetic polish the managers presentations using screenshots"). Two independent reviews
    read the three managers' decks against the rotas, the sheets and the colleague decks; this pass carries what was checked
    and kept. What drives it:
      · the PDFs carry the slides and no speaker notes, so a caveat that matters is ON A SLIDE (not a fatigue risk assessment,
        what the brackets mean, the costs colleagues will be shown, whether the design is on the shortlist);
      · "fixed rota" read as the station's fixed lines, so the decks say "cover weeks aside";
      · each row says its rule, each yearly count says "each", each comparison says "(today X)";
      · the notes are short enough to read aloud, keep the history and the dates to slide 9, and say the same things in the
        same order on all three decks.
    Every figure is FIG's (the sheets' own counts) or computed here; every claim is checked before it is printed."""
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    hm = lambda m: f'{m // 60}h {m % 60:02d}m'
    def nb(t):
        for n in (*GRIDS, 'Closing Time'): t = t.replace(n, n.replace(' ', '\u00a0'))
        return t
    notes = lambda n, start, text: snd.notes(d, n, start, nb(text))
    andl = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]
    code, fp = IDS[name]
    off = name not in SHORTLIST   # In Step since 5 Nov 2026: its decks stay in the pack, and say it is not on the shortlist
    times = re.match(r'(\d+) \((\d+) you know\)', F['times']); n_times, n_known = int(times.group(1)), int(times.group(2)); n_new = n_times - n_known
    cuts = [H(T[k]) - H(F[k]) for k in ('closerWk', 'closerSat', 'closerSun')]
    if min(cuts) <= 0: raise SystemExit(f'deck-polish: {name}’s closers are said to be shorter, and one is not')
    today_times = {TODAY_P[k][dd] for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd])}
    longs = sorted({(P[k][dd], _len(P[k][dd])) for k in P for dd in DAYS[1:6] if _timed(P[k][dd]) and int(P[k][dd][:2]) < 11 and _len(P[k][dd]) > 510}, key=lambda x: -x[1])
    if any(t in today_times for t, _ in longs): raise SystemExit(f'deck-polish: {name}’s long weekday earlies are said to be new, and one is worked today')
    long_phrase = ('' if not longs else f'a new weekday early, {longs[0][0].replace("-", "–")}, {hm(longs[0][1])}' if len(longs) == 1
                   else f'{WORDS[len(longs)]} new weekday earlies, {andl([t.replace("-", "–") for t, _ in longs])}, of {andl([hm(m) for _, m in longs])}')
    eo, eo_t = early_off(P), early_off(TODAY_P)
    has_1345 = lambda g: all(any(g[k][dd] == '06:20-13:45' for k in g) for dd in DAYS[1:6])   # today's 13:45, on every weekday
    if not (has_1345(P) if name != 'Short Run' else not any(P[k][dd] == '06:20-13:45' for k in P for dd in DAYS[1:6]) and all(has_1345(g) for g in O)):
        raise SystemExit(f'deck-polish: {name}’s notes 7 say where today’s 13:45 is kept, every weekday, and it is not')
    _, _, pounds = pay_change(P)
    wla = weekday_late_avg(P)

    # SLIDE 1: which design this is, on the slide — a PDF passed round carries no notes
    s = S(1)
    put(s, 'The December 2026 CEA link — the proposal in ten minutes',
        'A new CEA link proposal, in ten minutes' if off else f'One of {WORDS[len(SHORTLIST)]} shortlisted new CEA links, in ten minutes')
    # the start date, on the slide (link_date); every shortlisted deck points at its sheet, as the recommended one alone did
    # until 5 Nov 2026 (owner: "Remove the marks")
    put(s, f'For managers · 26 weeks · code {code} · the full proposal sheet has the detail',
        f'For managers · from {LINK_STARTS} · 26 weeks · code {code} · ' + ('not on the shortlist' if off else 'the full proposal sheet has the detail'))
    s.save()
    notes(1, 'The headline figures only.', 'The headline figures only. Everything week by week, hour by hour and rule by rule is on the eight-page proposal sheet. Every figure here is worked out from the rota by the Marylebone Roster app and its tooling, and has been checked independently.'
              + (f' {name} is not on the shortlist, which is {andl(list(SHORTLIST))}; this deck sets out {name} on its own terms.' if off
                 else f' {name} is one of {WORDS[len(SHORTLIST)]} shortlisted designs, with {andl([n for n in SHORTLIST if n != name])}, and this deck sets out {name} on its own terms.'))

    # SLIDE 2: the bar says what this design is for (the edge slide 7 checks), not the line all three shared
    s = S(2)
    put(s, 'Every December rule met — and no avoidable fatigue warnings in the fixed rota.', 'Every December staffing rule met — and ' + {'Even Step': 'no shift over 8h 30m, Monday to Saturday', 'In Step': 'steadier weekly hours than the shortlisted three', 'Short Run': 'the closest weekday fit of the three shortlisted'}[name] + '.')
    s.save()
    notes(2, 'The nine rules are the December 2026 rules', f'There are nine December staffing rules, confirmed verbally. Four are headcounts: at least four at the open, three to the close, five still on duty at 22:00 and ten on a Sunday. Two are about the floor and the office: at least two on the floor at all times, and the ticket office in fixed pairs. Three more: handovers between shifts, Sunday duties of 8 to 9 hours, and no more shift times than today. There are also three aims, met where possible but not counted: fourteen on a Saturday, five cover weeks as evenly spaced as 26 weeks allow, and weekday closers starting at 15:45 or later. A cover week has no set shifts: its four duties are placed later to cover leave and sickness, so the figures here leave cover weeks aside unless they say otherwise. “Avoidable” fatigue warnings leave out early starts and a weekly rotation, which every weekly link has.')

    # SLIDE 3: each row says its rule, checked against the design's own figures
    nums = lambda v: [int(n) for n in re.findall(r'\d+', v)]
    if not (min(nums(F['open'])) >= 4 and min(nums(F['at22'])) >= 5 and min(nums(F['close'])) >= 3 and min(nums(F['floor'])) >= 2 and nums(F['daily'])[-1] >= 10):
        raise SystemExit(f'deck-polish: slide 3 says {name} meets each level it names, and it does not')
    s = S(3)
    put(s, 'Weekday · Saturday · Sunday', 'Each figure reads weekday · Saturday · Sunday')
    put(s, 'At the open (06:20, Sunday 07:15)', 'At the open, at least 4 (06:20, Sun 07:15)')
    put(s, 'Still on after 22:00', 'Still on duty at 22:00, at least 5')   # the rule's own name (the rules sheet)
    put(s, 'Through to the close', 'Through to the close, at least 3')
    put(s, 'Fewest rostered on the floor', 'Fewest on the floor at any time, at least 2')
    s.save()
    if 'the morning one until 08:00, the evening one from 19:30' not in help_: raise SystemExit(f'deck-polish: managers’ notes 3 give the weekday office hours the model did; it now says {help_!r}')
    notes_edit(d, 3, 'and the three flexible ones as well', 'and the three aims as well')
    notes_edit(d, 3, 'is not counted as still on after 22:00.', 'is not counted as still on duty at 22:00.')
    notes_edit(d, 3, 'when one of each pair helps on the floor — on a Sunday one early until 09:00,', 'when one of each pair helps on the floor: Monday to Saturday the morning one until 08:00 and the evening one from 19:30; on a Sunday one early until 09:00,')

    # SLIDE 4: the subtitle names the measure the later slides call "fit"; the notes read the chart's own numbers
    s = S(4); put(s, 'How far the floor staffing is from the shape of the December timetable — lower is better', 'Fit to the trains: floor staff against the December trains, hour by hour — lower is better'); s.save()
    def place(key):
        v, rest = float(F[key]), [(n, float(FIG[n][key])) for n in SHORTLIST if n != name]
        where = ('the closest' if all(v < x for _, x in rest) else 'the weakest' if all(v > x for _, x in rest)
                 else 'level with ' + andl([f'{n}’s' for n, x in rest if x == v]) if any(x == v for _, x in rest) and len({x for _, x in rest}) > 1
                 else 'between theirs' if off else 'between the other two')
        return f'{where} ({", ".join(f"{n} {x:.1f}" for n, x in rest)})'
    same_sun = len({FIG[n]['fitSun'] for n in (*SHORTLIST, name)}) == 1   # never since Common Ground joined (5 Nov 2026): its Sunday is 28.2
    sun_clause = ' and the Sunday the same on all of them' if same_sun else ' and its Sunday fit ' + place('fitSun')
    why = ' Holding every shift Monday to Saturday to 8h 30m or less costs a little of the weekday shape.' if max(_len(P[k][dd]) for k in P for dd in DAYS[1:] if _timed(P[k][dd])) <= 510 else ''
    notes(4, 'The figure compares', f'The score compares, hour by hour, each day’s share of the floor staff on duty with its share of the trains: every arrival and departure, counted by the length of the train. 0 would track the trains exactly. It is a guide to shape, not a staffing requirement or a passenger forecast; the rules on the previous slide are the requirement. {name} scores {F["fitWk"]} on weekdays, {F["fitSat"]} on a Saturday and {F["fitSun"]} on a Sunday, against today’s {T["fitWk"]}, {T["fitSat"]} and {T["fitSun"]}; lower is closer. {"Beside" if off else "Among"} the three shortlisted links, its weekday fit is {place("fitWk")}, its Saturday fit {place("fitSat")}{sun_clause}.{why}')

    # SLIDE 5: the notes without the arithmetic, and the Sunday overtime said per person
    pct = lambda v: int(re.search(r'\((\d+)%\)', v).group(1))
    # A FIGURE IN HOURS AND MINUTES (the deep review, 1 Nov 2026): a key written twice in deck-check.mjs's figures() once
    # replaced this one with a bare decimal, and these notes printed "167.00 of overtime each Sunday against 177.45"
    for who, f in (('today', T), (name, F)):
        if not re.fullmatch(r'\d+h \d\dm', f['sunHours']): raise SystemExit(f'deck-polish: managers’ notes 5 would print {f["sunHours"]!r} as {who}’s Sunday hours; they want "83h 30m"')
    notes(5, 'Working weeks average', f'Working weeks average exactly 35 hours Monday to Saturday, so no overtime is needed to balance the week. Individual weeks run from {F["light"]} to {F["heavy"]} Monday to Saturday (today {T["light"]} to {T["heavy"]}); only the average is the contract, as today. Five cover weeks in 26 keep about the same share of the link as today’s four in 20 ({pct(F["cover"])}%, against {pct(T["cover"])}%). Sunday is not contracted, so the {F["sundayPeople"]} Sunday duties are worked as overtime, as today’s {T["sundayPeople"]} are; shared among {F["people"]} people instead of {T["people"]}, that is a little less each — about {F["sun"]} Sundays a year against {T["sun"]}; across the link, {F["sunHours"]} of overtime each Sunday against {T["sunHours"]}. The two extra Sunday duties come from the Sunday staffing of ten, which any link meeting the rules needs. Each person works {F["daysYear"]} contracted days a year, under the ceiling of 219, which is today’s figure.')

    # SLIDE 6: not a fatigue risk assessment, on the slide; what the brackets are, in the bar
    s = S(6)
    put(s, 'Against the Office of Rail and Road’s good-practice list and the rail industry’s own checks', 'Office of Rail and Road and rail-industry good practice — not a fatigue risk assessment')
    put(s, 'Avoidable fatigue warnings, fixed rota', 'Avoidable fatigue warnings, cover weeks aside')
    put(s, 'Longest shift', 'Longest shift, any day')   # the 9h is the Sunday early on two of the three; slide 8 gives Monday to Saturday's
    put(s, 'Rest and run limits met with room to spare; no avoidable fatigue warnings in the fixed rota.', 'Rest and days-in-a-row limits met with room to spare. In brackets: the worst case, if\u00a0a\u00a0cover\u00a0week falls badly.')
    s.save()
    notes(6, 'The ORR factors are good practice', 'The Office of Rail and Road’s factors are good practice, not pass-or-fail limits, and this is not a fatigue risk assessment. Two of them, early starts at a 06:20 station and a weekly rotation, come with every weekly link, so the proposal sheet lists them for information and does not count them; that is what “avoidable” means here. One check, start times moving more than two hours between shifts, is not counted across a rest day. That is more lenient than the regulator’s wording, on which every link shows it, today’s included; whoever assesses fatigue should decide. '
              + (f'The one possible warning, the “up to 1”, is the guideline of no more than 55 hours in any seven days: if a cover week’s four duties come straight after a heavy week and its Sunday is worked as overtime too, seven days can reach {F["h55"]} with 8-hour duties. The roster office can avoid that when it places the duties. ' if explain_h55(name, F) else '')
              + 'The written source of the 13-day limit is still to be confirmed.')

    # SLIDE 7'S NOTES: about a minute aloud, in the same order on every deck — what it is, what it adds, what it gives up
    # AGAINST THE NEW THREE (5 Nov 2026): Common Ground took In Step's place on the shortlist. Each design is set beside the other
    # shortlisted ones (In Step, now off the shortlist, beside all three); every comparison is read from the figures and refused
    # when it stops holding, a superlative only where the design is strictly first or last; and the leave is said for each,
    # since one of the three keeps today's four weeks for 14 days and two do not
    peers = [n for n in SHORTLIST if n != name]
    rest_of = lambda key, f=lambda v: v: andl([f'{n} {f(FIG[n][key])}' for n in peers])
    others_of = lambda key, f: [f(FIG[n][key]) for n in peers]
    wla_of = {n: weekday_late_avg(grid_of(n)) for n in peers}
    # EVEN STEP SINCE THE 22:30 TICKET OFFICE (6 Nov 2026): Common Ground lost its Saturday 13:30–22:30 and a shift time with it, so
    # Even Step no longer has the fewest times (13, as Common Ground) nor the only week with nothing over 8h 30m Monday to Saturday
    # (Common Ground has nothing over it on any day); what is its own is the closest Saturday fit and the lightest heaviest week.
    # Once one Saturday floor late went back to today's time (6 Nov 2026, the owner's "Yes"), Common Ground had the closest Saturday
    # fit, 9.8 against Even Step's 10.4 and Short Run's 13.6: Even Step's own is the lightest heaviest week, and its Saturday fit,
    # between the other two, moves into what it gives up against Common Ground
    over_of = lambda g: {(dd, g[k][dd]) for k in g for dd in DAYS if _timed(g[k][dd]) and _len(g[k][dd]) > 510}
    n_of = lambda n: first(FIG[n]['times'])
    ties = [n for n in peers if n_of(n) == n_times]
    if name == 'Even Step' and not (ties and all(n_of(n) >= n_times for n in peers)
                                    and float(FIG['Common Ground']['fitSat']) < float(F['fitSat']) < float(FIG['Short Run']['fitSat']) and H(F['heavy']) < min(others_of('heavy', H))
                                    and H(F['heavy']) - H(F['light']) < min(H(FIG[n]['heavy']) - H(FIG[n]['light']) for n in peers)
                                    and over_of(P) == {('sun', '09:00-18:00')} and 'Common Ground' in peers and not over_of(grid_of('Common Ground'))
                                    and H(F['step']) > max(others_of('step', H))
                                    and wla_of['Short Run'] < wla <= wla_of['Common Ground']
                                    and float(FIG['Short Run']['fitWk']) < float(F['fitWk']) < float(FIG['Common Ground']['fitWk'])):
        raise SystemExit('deck-polish: Even Step’s notes 7 give it as few shift times as one of the others and no more than any, the steadiest weeks and the lightest heaviest week of the three, a Saturday fit between Common Ground’s and Short Run’s, the Sunday 09:00–18:00 as its one shift over 8h 30m where Common Ground has none, the furthest week-to-week move, and lates and a weekday fit between Short Run’s and Common Ground’s, and it has not')
    if name == 'Short Run' and not (H(F['closerSat']) > max(others_of('closerSat', H)) and H(F['rest']) < min(others_of('rest', H)) and wla < min(wla_of.values())):
        raise SystemExit('deck-polish: Short Run’s notes 7 give it the longest Saturday closer, the shortest rest and the shortest weekday lates of the three, and it has not')
    if name == 'In Step' and not (H(F['heavy']) < min(others_of('heavy', H)) and H(F['heavy']) - H(F['light']) < min(H(FIG[n]['heavy']) - H(FIG[n]['light']) for n in peers)
                                  and float(F['fitSat']) <= min(others_of('fitSat', float))):
        raise SystemExit('deck-polish: In Step’s notes 7 give it steadier weekly hours than all three shortlisted and a Saturday fit as close as any, and it has not')
    lead7 = (f'{name} is not on the shortlist: it was from 30 October to 5 November 2026, when Common Ground took its place. Even Step, which is on it, keeps its weeks with the shift times chosen again.' if off
             else f'{name} is one of {WORDS[len(SHORTLIST)]} shortlisted designs, with {andl(peers)}.'
             + (' It keeps the weeks of In Step, another design in the pack — the same rest days, weekends, cover weeks and blocks of earlies and lates — with the shift times chosen again, so that nothing Monday to Saturday runs over 8h 30m and every early Monday to Saturday is a time worked today.' if name == 'Even Step' else ''))
    none0 = lambda v: 'none' if str(v) == '0' else v
    # AS MANY AS COMMON GROUND (whole-pack review, 5 Nov 2026): In Step's 12 finishes before 14:00 a year were listed among its
    # edges beside the three shortlisted links, and Common Ground has 12 too; the sentence says whom it matches
    eo_same = [n for n in peers if int(FIG[n]['shortYear']) == eo]
    eo_rest = andl([f'{n} {none0(FIG[n]["shortYear"])}' for n in peers if n not in eo_same])
    eo_said = (f'as many finishes before 14:00 as {andl(eo_same)}, {eo} a year each ({eo_rest}; today {eo_t})' if eo_same
               else f'{eo} finishes before 14:00 a year each ({rest_of("shortYear", none0)}; today {eo_t})')
    es_lates = andl([f'{n} {hm(wla_of[n])}' for n in ('Short Run', 'Common Ground') if n in wla_of])
    ties_said = (f'as many as {andl(ties)}' + (f' ({andl([f"{n} {n_of(n)}" for n in peers if n not in ties])})' if len(ties) < len(peers) else '')) if ties else ''   # Even Step's, checked above
    es_fits = andl([f'{n} {FIG[n]["fitWk"]}' for n in ('Short Run', 'Common Ground')])
    es_sat = andl([f'{n} {FIG[n]["fitSat"]}' for n in ('Common Ground', 'Short Run')])   # Even Step's, checked above
    es_ranges = andl([f'{n} {FIG[n]["light"]} to {FIG[n]["heavy"]}' for n in peers])   # the slide's "steadiest weeks", checked above
    # IN STEP'S SATURDAY FIT SHOWS AS COMMON GROUND'S (6 Nov 2026): 9.8 each once one Saturday floor late went back to today's
    # time, so "the closest" would contradict the two figures the reader sees; the sentence says whom it matches, as eo_said does
    sat_same = [n for n in peers if FIG[n]['fitSat'] == F['fitSat']]
    sat_rest = andl([f'{n} {FIG[n]["fitSat"]}' for n in peers if n not in sat_same])
    sat_said = (f'and a Saturday fit to the trains as close as {andl(sat_same)}’s, {F["fitSat"]} each ({sat_rest})' if sat_same
                else f'and the closest Saturday fit to the trains, {F["fitSat"]} ({rest_of("fitSat")})')
    body7 = {
        'Even Step': f' Its weeks are the steadiest of the three, {F["light"]} to {F["heavy"]} Monday to Saturday ({es_ranges}; today {T["light"]} to {T["heavy"]}), with the lightest heaviest week. Its one shift over 8h 30m is the Sunday 09:00–18:00, 9 hours, where Common Ground has none on any day. It has {n_times} shift times, {ties_said}, and keeps today’s 13:45 every weekday. What it gives up, against the other two: start times that move further from one week to the next, {F["step"]} on average ({rest_of("step")}; today {T["step"]}). Against Short Run, though not Common Ground, longer weekday lates, {hm(wla)} on average, closers aside ({es_lates}; today {hm(weekday_late_avg(TODAY_P))}), and a weaker weekday fit to the trains, {F["fitWk"]} ({es_fits}; today {T["fitWk"]}). Against Common Ground, though not Short Run, a weaker Saturday fit, {F["fitSat"]} ({es_sat}; today {T["fitSat"]}).',
        'In Step': f' Beside the three shortlisted links it has the steadiest weekly hours, {F["light"]} to {F["heavy"]} Monday to Saturday (today {T["light"]} to {T["heavy"]}); {eo_said}; {sat_said}. It keeps today’s 13:45 every weekday. What it gives up: {long_phrase}, about {long_wk_earlies(P)} a year each in all, where today no early is over 8h 30m.',
        'Short Run': f' It has the closest weekday fit to the trains, {F["fitWk"]} ({rest_of("fitWk")}; today {T["fitWk"]}), and the shortest weekday lates, {hm(wla)} on average, closers aside. What it gives up: {long_phrase}, about {long_wk_earlies(P)} a year each, where today no early is over 8h 30m; today’s 13:45, which both others keep every weekday; a Saturday closer of {F["closerSat"]} ({rest_of("closerSat")}); and the shortest rest of the three, {F["rest"]} ({rest_of("rest")}).'}[name]
    if eo != int(F['shortYear']): raise SystemExit(f'deck-polish: {name}’s notes 7 count {eo} finishes before 14:00 beside the others’ 13:35 and 13:45 counts, {F["shortYear"]}; they are the same earlies only while they agree')
    # THE LEAVE, DESIGN BY DESIGN (5 Nov 2026): who needs more than today for four weeks off, and who on the shortlist keeps today's
    worse = [n for n in SHORTLIST if n != name and int(FIG[n]['leaveFour']) > int(T['leaveFour'])]
    keep = [n for n in SHORTLIST if int(FIG[n]['leaveFour']) <= int(T['leaveFour'])]
    if not (int(F['leaveFour']) > int(T['leaveFour']) and worse and keep and all(FIG[n]['leaveFour'] == F['leaveFour'] and FIG[n]['leaveBest'] == F['leaveBest'] for n in worse)
            and all(rest_lens(grid_of(k)).count(1) > rest_lens(P).count(1) for k in keep)):
        raise SystemExit(f'deck-polish: {name}’s notes 7 say it needs more leave for four weeks off, as {worse} do, and {keep} keep today’s for more single rest days; they do not')
    leave7 = (f' Four weeks off take {F["leaveFour"]} days’ leave against {T["leaveFour"]} today, and 14 days buy {F["leaveBest"]} days off at best against {T["leaveBest"]}, as on {andl(worse)}; '
              f'{andl(keep)}{", on the shortlist," if off else ", also shortlisted,"} keeps today’s, for more single rest days.')
    notes(7, 'This is the case in one slide.', lead7 + body7 + leave7 + f' Every closing shift is {min(cuts)} to {max(cuts)} minutes shorter than today’s. '
          + ('The costs it shares with all three are in the bar' if off else 'The costs all three share are in the bar') + f': {F["late23"]} finishes a year at 23:00 or later against {T["late23"]}, and {F["sat"]} Saturdays against {T["sat"]}.')

    # SLIDE 8: THE THREE BIGGEST GAINS AND THE THREE BIGGEST COSTS (fourth review, 1 Nov 2026: "show the three biggest benefits
    # and three biggest trade-offs. Keep the complete comparison in the supporting sheet and notes"). The pass before had cut
    # 16 points to 11 and the slide was still read rather than glanced at. Each point is now a bold headline in plain words
    # with its figure under it, in a quieter colour, so the slide reads from the headlines alone; notes 8 carry everything
    # else by name. The costs are each design's own three: late finishes, leave and pay for Even Step, the longer weekday
    # earlies in place of leave for In Step and Short Run (slide 7's cost; leave stays in slide 7's bar). The pay line keeps
    # its condition — the one caveat that stops the slide misleading (the third review). "Cover weeks aside" is said once,
    # in the subtitle, for the days in a row
    s = S(8)
    put(s, 'The good and the not so good — the colleague presentation shows both', 'The three biggest gains and costs, per person, cover weeks aside')
    put(s, 'Expect late finishes to be the first question — the colleague deck answers it openly.',
        'Expect late finishes and leave first — the colleague presentation answers both.' if not longs else 'Expect late finishes and long earlies first — the colleague presentation answers both.')
    s.save()
    nbs = lambda t: t.replace(' ', '\u00a0')
    ms_longest = lambda g: max(_len(g[k][dd]) for k in g for dd in DAYS[1:] if _timed(g[k][dd]))
    early_max = lambda g: max(_len(g[k][dd]) for k in g for dd in DAYS[1:6] if _timed(g[k][dd]) and int(g[k][dd][:2]) < 11)
    if not (H(F['rest']) > H(T['rest']) and int(F['floorMin']) > int(T['floorMin'])): raise SystemExit(f'deck-polish: notes 8 welcome {name}’s rest and floor staffing as better than today’s, and one is not')
    if not (int(F['weekendsYear']) > int(T['weekendsYear']) and first(F['run']) < first(T['run'])): raise SystemExit(f'deck-polish: slide 8’s gains are not gains for {name}')
    gains = [('More weekends off', f'{F["weekendsYear"]} full weekends a year, not {T["weekendsYear"]}'), ('Fewer days in a row', f'{first(F["run"])} at most, not {first(T["run"])}'),
             (f'Nothing over {hm(ms_longest(P))}, Mon–Sat', f'today’s longest is {hm(ms_longest(TODAY_P))}') if ms_longest(P) <= 510
             else ('Shorter closing shifts', f'every one {min(cuts)} to {max(cuts)} minutes shorter')]
    if not (int(F['block']) > int(T['block']) and int(F['leaveFour']) - int(T['leaveFour']) == 1 and int(F['sat']) > int(T['sat']) and eo < eo_t and pounds >= 50
            and int(F['late22']) > int(T['late22']) and (not longs or early_max(P) > early_max(TODAY_P))):
        raise SystemExit(f'deck-polish: slide 8’s costs, or the ones left to the notes, are not costs against today for {name}')
    costs = [('More late finishes', f'{F["late22"]} a year at 22:00 or later, not {T["late22"]}'),
             ('Longer weekday earlies', f'up to {nbs("9 hours" if early_max(P) == 540 else hm(early_max(P)))}, not {nbs(hm(early_max(TODAY_P)))}') if longs
             else ('More leave for four weeks off', f'{F["leaveFour"]} days, not {T["leaveFour"]}'),
             ('Less premium and overtime pay', f'about £{pounds} a year, gross, for\u00a0a\u00a0full\u00a0share\u00a0of\u00a0Sundays, swaps\u00a0aside')]   # the colleagues' slide 5 says the same (the deep review, 1 Nov 2026)
    p8 = f'{d}/ppt/slides/slide8.xml'
    set_pairs(p8, f'{F["weekendsYear"]} full weekends off a year (today {T["weekendsYear"]})', gains)
    set_pairs(p8, f'Late finishes: {F["late23"]} a year at 23:00 or later (today {T["late23"]}), {F["late22"]} at 22:00 or later (today {T["late22"]})', costs)
    s = S(8)   # both lists start a little higher, so three two-line points, one with a two-line figure, sit inside the card
    for h0 in (gains[0][0], costs[0][0]):
        i = next(k for k, (a0, b0) in enumerate(spans(s.x)) if runs_of(s.x[a0:b0])[:1] == [escape(h0)])
        x0, y0, cx0, cy0 = s.box(i); s.geo(i, y=y0 - 73152, cy=cy0 + 73152)   # 0.08in
    s.save()
    # what left the slide, said in the notes by name, so the presenter has it to hand
    # "ALL EARLIES OR ALL LATES" HERE TOO (owner, 5 Nov 2026: "Say what is counted"): the sheets and slides say it, and today's
    # 7 of 16 is only true of weeks that are both — the notes were the last place it was missing
    aside = [f'one shift time Monday to Friday, all earlies or all lates, in {F["oneTurn"]} weeks (today {T["oneTurn"]})']
    if ms_longest(P) <= 510: aside.append(f'every closing shift {min(cuts)} to {max(cuts)} minutes shorter')
    aside += [f'the shortest rest between shifts {F["rest"]} (today {T["rest"]})', f'at least {F["floorMin"]} on the floor at all times (today {T["floorMin"]})',
            f'{n_new} of the {n_times} shift times new to learn',   # the early finishes are in swap8 now, said once (the deep review, 1 Nov 2026)
            f'{F["late23"]} finishes a year at 23:00 or later (today {T["late23"]})']
    off_sentence = ' Not on the slide, but worth having to hand: ' + andl(aside) + '. The full comparison is on the proposal sheet.'
    # NOT THE RULES ALONE (the independent review of Common Ground's decks, 5 Nov 2026): on 26 lines the rules alone would give
    # about 74 finishes at 22:00 or later a year each, fewer than today's 78; the rest is the two floor lates finishing with the
    # office's pair on every weekday. Refused unless every weekday has the four 22:30 finishes and the three closers that make seven
    if not (first(F['at22']) == 7 and all(sum(1 for k in P if _timed(P[k][dd]) and P[k][dd][6:] == '22:30') == 4 and sum(1 for k in P if _timed(P[k][dd]) and P[k][dd][6:] == '23:55') == 3 for dd in DAYS[1:6])):
        raise SystemExit(f'deck-polish: {name}’s notes 8 say two floor lates finish at 22:30 with the office every weekday, making seven at 22:00; they do not')
    over = lambda g: {(dd, g[k][dd]) for k in g for dd in DAYS if _timed(g[k][dd]) and _len(g[k][dd]) > 510}
    if not all(_len(TODAY_P[k][dd]) <= 510 for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd]) and int(TODAY_P[k][dd][:2]) < 11):
        raise SystemExit('deck-polish: the managers’ notes say no early today is over 8h 30m, and one is')
    if ms_longest(P) <= 510 and over(P) != {('sun', '09:00-18:00')}: raise SystemExit(f'deck-polish: {name}’s notes 8 call the Sunday 09:00–18:00 its one shift over 8h 30m; it has {sorted(over(P))}')
    rl, rl_t = rest_lens(P), rest_lens(TODAY_P); long_t = sum(1 for n in rl_t if n > 2)
    if not (max(rl) == 2 and long_t > 0 and all(n in (3, 4) for n in rl_t if n > 2) and F['leaveAvg'] == T['leaveAvg'] and int(F['late23']) - int(T['late23']) == 3):
        raise SystemExit(f'deck-polish: {name}’s notes 8 no longer hold')
    # THE SWAP ASSUMPTION, AS THE COLLEAGUES' PAY SLIDE STATES IT (1 Nov 2026): the £ leaves out swap overtime, and swapping
    # an early for a late pays less on every shortlisted link — the lates are no longer the longer shifts, and the short
    # earlies that are worth swapping are fewer. Refused if either stops being true of this design
    sw = lambda f: (int(f['swap'].split()[0]), f['swap'].split()[-1])
    if not (int(F['shortYear']) < int(T['shortYear']) and (sw(F)[1] == 'shorter' or sw(F)[0] < sw(T)[0])):
        raise SystemExit(f'deck-polish: managers’ notes 8 say swapping pays less on {name}; it has {F["swap"]} and {F["shortYear"]} short earlies, today {T["swap"]} and {T["shortYear"]}')
    swap8 = (f'On average, swapping an early for a late pays less on this link: on the same day a late is {sw(F)[0]} minutes {sw(F)[1]} than an early, against {sw(T)[0]} minutes {sw(T)[1]} today, '
             f'and the shortest earlies, the 13:35 and 13:45 finishes that add most when swapped, fall from about {T["shortYear"]} a year each to {F["shortYear"] if int(F["shortYear"]) else "none"}. Other swaps may still add paid time.')
    tail8 = (f' No shift Monday to Saturday is over 8h 30m; the one longer shift is the Sunday 09:00–18:00, 9 hours.' if ms_longest(P) <= 510
             else f' {long_phrase[0].upper() + long_phrase[1:]}: about {long_wk_earlies(P)} a year each, where today no early is over 8h 30m.')
    notes(8, 'Days at work stay at 219', f'Figures are per person, a year, with cover weeks aside, as on the slide. Days at work are {F["daysYear"]} a year, Monday to Saturday, just under today’s 219; Sunday is overtime. Finishes at 23:00 or later rise by about three a year each, all from the December staffing: three to the close every day, where today has two Monday to Saturday, so no link meeting the rules could have fewer. Finishes at 22:00 or later rise from about {T["late22"]} to {F["late22"]}: the rules want five still on duty at 22:00, and two floor lates finish at 22:30 with the ticket office every weekday, which makes {WORDS[first(F["at22"])]}. Leave is only needed for working days, Monday to Saturday. Today one stretch lets 14 days’ leave buy {T["leaveBest"]} days off; this link spreads rest days more evenly, so its best is {F["leaveBest"]}, and four whole weeks off needs {F["leaveFour"]} days, not {T["leaveFour"]}; on average 14 days goes as far as today, {F["leaveAvg"]} days off. Blocks of earlies or lates run up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks beside them go the same way (today {T["block"]}, up to {T["blockUpTo"]}), and no rest-day break is longer than two days, where today {WORDS[long_t]} are three or four days. The two extra Saturdays come from aiming for fourteen on a Saturday. The pay figure is gross premium and overtime pay at the CEA rate of £{PAY["rate"]:.2f}, for someone working their full share of Sundays and no swap overtime; basic pay does not change. ' + swap8 + tail8 + off_sentence)

    # SLIDE 9: what the managers are asked to do, on the slide; the dates and the history in the notes alone
    s = S(9)
    put(s, 'The nine December rules. Everything here is built on them.', 'Everything here is built on them; worth having in writing before a link is chosen.')
    put(s, 'Colleagues’ views come first.', 'After colleagues’ views. Not yet seen by the roster office.')   # no union rep (owner, 5 Nov 2026: S. Silva, the RMT rep, leads it)
    s.save()
    notes(9, 'The Sunday finish stays at 23:25', 'The December rules and the Sunday cover were confirmed verbally on 29 September 2026, and are worth having in writing before a link is chosen; the 26-week link was set on 1 October 2026. The new link starts on 1 January 2027, after the timetable changes in December. The 13-day limit used in the checks is Chiltern practice; its written source is still to be confirmed. The fatigue check still open is FF19 on the rules sheet: start times moving more than two hours between shifts, which is not counted across a rest day. The proposal has not yet been through the roster office. The Sunday finish stays at 23:25, as agreed practice.')

    # SLIDE 10: the fingerprint beside the code, as the sheets and the shortlist pair them
    replace_in_run(f'{d}/ppt/slides/slide10.xml', code, f'{code} · {fp}')

# THE SHORT TABLES FILL THEIR SPACE (31 Oct 2026, owner: "deep review them and aesthetic polish using screenshots"). Every
# comparison table is laid out for five rows, each 0.40 in tall on a 0.48 in pitch from 1.97 in, above a takeaway bar fixed at
# 4.55 in. Seven slides across the two decks have three or four rows, so the screenshots showed a band of empty slide up to
# 1.2 in deep between the table and its takeaway — the largest empty area in either deck. Such a table now fills the band a
# five-row table fills: its rows taller and spread in the same proportion, its text a size larger where there are three, the
# corner radius kept the same, so every comparison slide ends its table at the same height. Rows are found by their exact
# geometry, a table is respaced only when its rows sit on the five-row pitch from the top with nothing between them and the
# bar, and the checker reads rows in shape order, not position, so deck-check.mjs sees no difference.
# SIX ROWS GO INTO THE SAME BAND (1 Nov 2026): slide 6 gained the average early and the average late (add_row), and a sixth
# row on the five-row pitch would run into the takeaway bar, so it is drawn there and respaced here like the short tables —
# rows a little shallower, the same band, the same bottom edge as every other comparison slide.
ROW_X, ROW_W, ROW_H, ROW_PITCH, ROW_TOP, BAR_TOP = 457200, 8229600, 365760, 438912, 1801368, 4160520
BAND = 4 * ROW_PITCH + ROW_H                      # the height five rows take
def balance_tables(d):
    geo = lambda sp: (lambda m: tuple(map(int, m.groups())) if m else None)(re.search(r'<a:off x="(\d+)" y="(\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', sp))
    sdir = os.path.join(d, 'ppt', 'slides'); moved = []
    for fn in sorted(os.listdir(sdir), key=lambda n: int(re.sub(r'\D', '', n) or 0)):
        if not re.fullmatch(r'slide\d+\.xml', fn): continue
        path = os.path.join(sdir, fn); x = open(path, encoding='utf-8').read()
        sps = re.findall(r'<p:sp>.*?</p:sp>', x, re.S)
        rows = sorted(g[1] for sp in sps if (g := geo(sp)) and 'prst="roundRect"' in sp and g[0] == ROW_X and g[2] == ROW_W and g[3] == ROW_H)
        n = len(rows)
        if n not in (3, 4, 6) or rows != [ROW_TOP + i * ROW_PITCH for i in range(n)]: continue
        if any((g := geo(sp)) and rows[-1] + ROW_H <= g[1] < BAR_TOP for sp in sps): continue   # something sits under the table
        h = round(BAND / (n + 0.2 * (n - 1))); gap = round(0.2 * h); bump = {3: 200, 6: 0}.get(n, 0)
        def respace(sp):
            g = geo(sp)
            if not g or g[3] != ROW_H or g[1] not in rows: return sp
            i = rows.index(g[1])
            sp = sp.replace(f'<a:off x="{g[0]}" y="{g[1]}"/><a:ext cx="{g[2]}" cy="{g[3]}"/>', f'<a:off x="{g[0]}" y="{ROW_TOP + i * (h + gap)}"/><a:ext cx="{g[2]}" cy="{h}"/>', 1)
            sp = re.sub(r'<a:gd name="adj" fmla="val (\d+)"/>', lambda m: f'<a:gd name="adj" fmla="val {round(int(m.group(1)) * ROW_H / h)}"/>', sp)
            return re.sub(r' sz="(\d+)"', lambda m: f' sz="{int(m.group(1)) + bump}"', sp) if bump else sp
        x2 = re.sub(r'<p:sp>.*?</p:sp>', lambda m: respace(m.group(0)), x, flags=re.S)
        if x2 != x: open(path, 'w', encoding='utf-8').write(x2); moved.append(f'{fn[5:-4]}:{n}')
    # NO ROW RUNS INTO THE BAR (the deep review, 1 Nov 2026): add_row draws a row on the five-row pitch and relies on the
    # respacing above to pull the table back into the band, which it does for three, four and six rows only. A table of any
    # other size, or a row added below a seventh, would be left overlapping the takeaway — so every slide is checked here
    for fn in sorted(os.listdir(sdir)):
        if not re.fullmatch(r'slide\d+\.xml', fn): continue
        sps = re.findall(r'<p:sp>.*?</p:sp>', open(os.path.join(sdir, fn), encoding='utf-8').read(), re.S)
        if not any((g := geo(sp)) and 'prst="roundRect"' in sp and g[:3] == (ROW_X, BAR_TOP, ROW_W) for sp in sps): continue   # no takeaway bar
        over = [g[1] for sp in sps if (g := geo(sp)) and 'prst="roundRect"' in sp and g[0] == ROW_X and g[2] == ROW_W and g[3] <= ROW_H and g[1] < BAR_TOP < g[1] + g[3]]
        if over: raise SystemExit(f'deck-polish: {d} {fn}: a table row at y={over} runs into the takeaway bar at {BAR_TOP}')
    return moved

# THE PACK POLISH (1 Nov 2026, owner: "aesthetic polish and aesthetic consistency polish the entire pack", checked with
# screenshots). Geometry the three designs share, so it is written once; every step finds its shapes by their exact place
# and refuses when the template moves, as balance_tables does.
def family_polish(d, who):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    nums = sorted(int(m.group(1)) for m in (re.fullmatch(r'slide(\d+)\.xml', f) for f in os.listdir(f'{d}/ppt/slides')) if m)
    def boxes_of(s): return [(i, s.box(i)) for i in range(len(spans(s.x))) if '<a:off ' in s.x[slice(*spans(s.x)[i])]]
    # 1. THE NAVY SLIDES ON THE DECK'S MARGIN: the cover and the closing slide set everything 0.6in in, every other slide
    #    0.5in, so the left edge jumped going into slide 2 and out of the last content slide. The cover's footer moves onto
    #    the closing slide's line, and the managers' closing bullets take the colleagues' hanging indent
    for n in (nums[0], nums[-1]):
        s = S(n)
        if s.x.count('<a:off x="548640"') != 4: raise SystemExit(f'deck-polish: slide {n} is not the navy layout ({s.x.count(chr(60) + "a:off x=" + chr(34) + "548640")} shapes at 0.6in)')
        s.x = s.x.replace('<a:off x="548640"', '<a:off x="457200"')
        pic = re.search(r'(<p:pic>.*?<a:off x=")(\d+)(")', s.x, re.S)
        if not pic: raise SystemExit(f'deck-polish: slide {n} has no icon inside its circle')
        s.x = s.x[:pic.start(2)] + str(int(pic.group(2)) - 91440) + s.x[pic.end(2):]
        if n == nums[0]:
            if s.x.count('<a:off x="457200" y="4206240"/>') != 1: raise SystemExit('deck-polish: the cover footer has moved')
            s.x = s.x.replace('<a:off x="457200" y="4206240"/>', '<a:off x="457200" y="4343400"/>')
        elif who == 'managers':
            k = s.x.count('<a:pPr marL="203200" indent="-203200">')
            if k != 3: raise SystemExit(f'deck-polish: the managers’ closing list has {k} bullets at the old indent, not 3')
            s.x = s.x.replace('<a:pPr marL="203200" indent="-203200">', '<a:pPr marL="342900" indent="-342900">')
        s.save()
    if who == 'colleagues':
        # 2. ONE TICK: slide 8's "You work these today" was a white tick on gold, faint and unlike every other tick in the
        #    pack (white on green); gold stays the colour of what is new, beside it
        s = S(8); hit = [i for i, b in boxes_of(s) if b == (640080, 1508760, 411480, 411480)]
        if len(hit) != 1 or 'prst="ellipse"' not in s.x[slice(*spans(s.x)[hit[0]])]: raise SystemExit('deck-polish: slide 8’s tick circle has moved')
        s.sub(hit[0], '<a:srgbClr val="F5C800"/>', f'<a:srgbClr val="{GREEN}"/>', count=2); s.save()
        # 3. THE SIX CARDS ON EVEN GUTTERS: 0.2in between the columns and 0.08in between the rows read as stacked strips;
        #    both are now 0.125in, inside the same block, so the slide ends where it did
        s = S(13); G = 114300; W = (8229600 - G) // 2; H = (3986784 - 1371600 - 2 * G) // 3
        cols, rows = (457200, 4663440), (1371600, 2267712, 3163824)
        ncols, nrows = (457200, 457200 + W + G), tuple(1371600 + r * (H + G) for r in range(3))
        moved = 0
        for i, (x, y, cx, cy) in boxes_of(s):
            c = next((k for k, cx0 in enumerate(cols) if cx0 <= x < cx0 + 4023360), None)
            r = next((k for k, ry in enumerate(rows) if ry <= y < ry + 822960), None)
            if c is None or r is None: continue
            kw = dict(x=ncols[c] + (x - cols[c]), y=nrows[r] + (y - rows[r]))
            if (cx, cy) == (4023360, 822960): kw.update(cx=W, cy=H)
            s.geo(i, **kw); moved += 1
        if moved != 18: raise SystemExit(f'deck-polish: slide 13’s grid moved {moved} shapes, not 18')
        s.save()
    else:
        # 4. SLIDE 2'S FOUR CARDS SPAN THE MARGINS: they stopped 0.05in short of the bar's right edge, on 0.25in gutters
        #    where the colleagues' five use 0.15in
        s = S(2); G = 137160; W = (8229600 - 3 * G) // 4; old = (457200, 2560320, 4663440, 6766560); moved = 0
        for i, (x, y, cx, cy) in boxes_of(s):
            k = next((k for k, x0 in enumerate(old) if x in (x0, x0 + 68580)), None)
            if k is None or y not in (1463040, 1645920, 2560320, 3200400): continue
            nx = 457200 + k * (W + G)
            s.geo(i, **(dict(x=nx, cx=W) if x == old[k] else dict(x=nx + 68580, cx=W - 137160))); moved += 1
        if moved != 16: raise SystemExit(f'deck-polish: slide 2 moved {moved} shapes, not 16')
        s.save()
        # 5. WHERE IT STANDS, ITEMS THAT READ AS ITEMS: 0.5in circles on a 0.6in pitch sat 0.1in apart, and the gap between
        #    two items equalled the gap inside one, so a detail line floated between titles. The circles are 0.4in, centred on
        #    their two lines; each detail sits 0.04in nearer its title; the text column keeps the circles' 0.2in gap
        s = S(9); moved = 0
        for i, (x, y, cx, cy) in boxes_of(s):
            if (x, cx, cy) == (457200, 457200, 457200):                       # a circle, or the ✓ / ? drawn over it
                s.geo(i, y=y + 13716, cx=365760, cy=365760); moved += 1
                if '<a:t>' in s.x[slice(*spans(s.x)[i])]: s.sub(i, 'sz="1800"', 'sz="1500"')
            elif (x, cx) == (1097280, 7589520) and cy == 292608: s.geo(i, x=1005840, cx=7680960); moved += 1
            elif (x, cx) == (1097280, 7589520) and cy == 274320: s.geo(i, x=1005840, y=y - 36576, cx=7680960); moved += 1
        if moved != 20: raise SystemExit(f'deck-polish: slide 9 moved {moved} shapes, not 20')
        s.save()
        # 6. THE CHART'S LEGEND IN THE DECK'S TYPE: it had no colour of its own, so it fell back to black, the one black text
        #    in either deck; it takes the axis labels' colour and size, and the axis line the deck's slate. The tables' outline
        #    grey, tried first, left the bars standing on a line at 1.3:1 against white, which a projector would lose (the
        #    regression check, 1 Nov); the slate is the deck's own detail colour, and darker than the 888888 it replaces
        cp = f'{d}/ppt/charts/chart1.xml'; x = open(cp, encoding='utf-8').read()
        leg = re.search(r'<c:legend>.*?</c:legend>', x, re.S)
        if not leg or leg.group(0).count('<a:defRPr sz="1200">') != 1 or x.count('<a:srgbClr val="888888"/>') != 2:
            raise SystemExit('deck-polish: the chart’s legend or axis lines have changed')
        x = x[:leg.start()] + leg.group(0).replace('<a:defRPr sz="1200">', '<a:defRPr sz="1300"><a:solidFill><a:srgbClr val="1B2533"/></a:solidFill>') + x[leg.end():]
        open(cp, 'w', encoding='utf-8').write(x.replace('<a:srgbClr val="888888"/>', '<a:srgbClr val="5B6778"/>'))

# THE NEW LINK STARTS ON 1 JANUARY 2027 (owner, 2 Nov 2026: "Whilst the new timetable will start in December, the new cea link
# design will be from January 1st"; of the pack, "Fix the date and rename it"). The decks called it "the December 2026 link" —
# on the title slide, in the footer of every slide and in the file's own title, which a PDF viewer shows — and the colleagues'
# slide 3 said the link "has to follow" the December trains. The timetable does change in December, and the nine December
# rules are still its rules, so those words stay. What changes is the link's own name, and its date is said on the title
# slide, on slide 3 and in the notes. Every replacement is counted, and polish() refuses a deck that still names the old link.
LINK_STARTS = '1 January 2027'
OLD_LINK = re.compile(r'December 2026 (?:CEA )?link')
def link_date(d, who):
    nums = sorted(int(m.group(1)) for m in (re.fullmatch(r'slide(\d+)\.xml', f) for f in os.listdir(f'{d}/ppt/slides')) if m)
    footed = 0
    for n in nums:
        p = f'{d}/ppt/slides/slide{n}.xml'
        if ' · December 2026 link proposal · ' in open(p, encoding='utf-8').read():
            replace_in_run(p, ' · December 2026 link proposal · ', ' · new CEA link proposal · '); footed += 1
    want = len(nums) - 2   # every slide but the cover and the closing slide carries the footer
    if footed != want: raise SystemExit(f'deck-polish: {footed} footers named the December 2026 link, not {want}')
    p = f'{d}/docProps/core.xml'; x = open(p, encoding='utf-8').read()
    old = ' — the December 2026 link</dc:title>' if who == 'colleagues' else ' — the December 2026 CEA link, for managers</dc:title>'
    if x.count(old) != 1: raise SystemExit(f'deck-polish: the {who} deck’s file title is not “… {old[3:-11]}”')
    open(p, 'w', encoding='utf-8').write(x.replace(old, ' — the new CEA link</dc:title>' if who == 'colleagues' else ' — the new CEA link, for managers</dc:title>'))
    if who == 'colleagues':
        s = Slide(f'{d}/ppt/slides/slide1.xml')
        put(s, 'Our December 2026 link — what changes for you, in plain English', 'Our new link — what changes for you, in plain English')
        s.save()
        replace_in_run(f'{d}/ppt/slides/slide1.xml', 'A proposal for discussion · CEA link · ', f'A proposal for discussion · CEA link from {LINK_STARTS} · ')
        s = Slide(f'{d}/ppt/slides/slide3.xml')
        put(s, 'More trains, at new times — the link has to follow them.', f'More trains, at new times — the new link follows from {LINK_STARTS}.')
        s.save()
        notes_edit(d, 3, 'mean the link has to be redrawn.', f'mean the link has to be redrawn. The timetable changes in December, and the new link starts on {LINK_STARTS}.')

# UK ENGLISH (owner, 3 Nov 2026: "use UK English ... throughout the app"). The decks' template tagged every run of text
# lang="en-US", so PowerPoint spell-checked British spelling as American and a screen reader read it in an American voice,
# while every word on the slides was already British. Every language tag becomes en-GB — the runs this script and the
# builders add are written en-GB at source, and this converts whatever the template still carries — and polish() refuses
# a deck that keeps one. LibreOffice takes the PDF's /Lang from the deck, so the exported PDFs follow.
US_LANG = re.compile(r'\b(lang|altLang)="en-US"')
def uk_language(d):
    changed = 0
    for r, _, fs in os.walk(d):
        for f in fs:
            if not f.endswith(('.xml', '.rels')): continue
            p = os.path.join(r, f); x = open(p, encoding='utf-8').read()
            x, n = US_LANG.subn(lambda m: f'{m.group(1)}="en-GB"', x)
            if n: open(p, 'w', encoding='utf-8').write(x); changed += n
    return changed

def polish(path, name, grid, who):
    d = tempfile.mkdtemp(); zipfile.ZipFile(path).extractall(d)
    (colleagues if who == 'colleagues' else managers)(d, name, grid, FIG[name])
    said = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and 'fixed rota' in open(os.path.join(r, f), encoding='utf-8').read()]
    if said: raise SystemExit(f'deck-polish: {name} for {who} still says "fixed rota" ({", ".join(sorted(said))}); the decks say "cover weeks aside"')
    # NO RECOMMENDATION AND NO UNION REP, ANYWHERE IN A DECK (owner, 5 Nov 2026): the three are presented evenly, A to Z, as the
    # New link page shows them, and S. Silva, the RMT rep, leads the change — "not yet seen by … a union rep" read as though
    # somebody else would vet it. Slides and notes alike, since a recommendation in the notes is read aloud
    for word, why in (('recommend', 'the shortlist is presented evenly'), ('union rep', 'S. Silva, the RMT rep, leads it')):
        said = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and word in open(os.path.join(r, f), encoding='utf-8').read().lower()]
        if said: raise SystemExit(f'deck-polish: {name} for {who} still says "{word}" ({", ".join(sorted(said))}); {why} (owner, 5 Nov 2026)')
    moved = balance_tables(d)
    family_polish(d, who)
    link_date(d, who)
    if who == 'colleagues' and name not in SHORTLIST:   # In Step since 5 Nov 2026: the managers' cover says so, and now the colleagues' too
        code1 = IDS[name][0]
        replace_in_run(f'{d}/ppt/slides/slide1.xml', f'· code {code1}', f'· code {code1} · not\u00a0on\u00a0the\u00a0shortlist')   # kept together: "shortlist" ended alone
        notes_append(d, 1, f'Say plainly that {name} is not on the shortlist: the three on it are {andl(list(SHORTLIST))}. Its presentations stay in the pack so it can be compared with them.')
    uk_language(d)
    us = [f for r, _, fs in os.walk(d) for f in fs if f.endswith(('.xml', '.rels')) and US_LANG.search(open(os.path.join(r, f), encoding='utf-8').read())]
    if us: raise SystemExit(f'deck-polish: {name} for {who} still tags text as US English ({", ".join(sorted(us))})')
    old = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and OLD_LINK.search(open(os.path.join(r, f), encoding='utf-8').read())]
    if old: raise SystemExit(f'deck-polish: {name} for {who} still names the December 2026 link ({", ".join(sorted(old))}); it starts on {LINK_STARTS}')
    names = zipfile.ZipFile(path).namelist()
    extra = [os.path.relpath(os.path.join(r, f), d) for r, _, fs in os.walk(d) for f in fs if os.path.relpath(os.path.join(r, f), d) not in names]
    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in names + extra: z.write(os.path.join(d, n), n)
    os.replace(tmp, path); shutil.rmtree(d)
    return moved

if __name__ == '__main__':
    import sys
    names = sys.argv[1:] or list(DESIGNS)   # a name on the command line polishes only that design's freshly built decks
    bad = [n for n in names if n not in DESIGNS]
    if bad: raise SystemExit(f'deck-polish: no design {bad}; the designs are {list(DESIGNS)}')
    for name in names:
        for who in ('colleagues', 'managers'):
            moved = polish(os.path.join(OUT, f'{name.replace(" ", "-")}-for-{who}.pptx'), name, DESIGNS[name], who)
            print(f'{name} for {who}: tables respaced into the five-row band on slides {", ".join(moved) or "none"} (slide:rows)')
    print('polished', ', '.join(names))
