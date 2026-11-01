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
RECOMMENDED = re.search(r"export const RECOMMENDED = '([^']+)'", open(os.path.join(TOOL, 'fresh.mjs'), encoding='utf-8').read()).group(1)
IDS = {n: (c, f) for n, c, f in re.findall(r"name: '([^']+)',\s*code: '([^']+)',\s*fp: '([0-9a-f]{8})'", open(os.path.join(TOOL, 'regenerate.mjs'), encoding='utf-8').read())}
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

# THE PAY FIGURES ARE THE APP'S (31 Oct 2026, the deck review): slide 5 said "plus about two more Saturdays at time and a
# quarter" and nothing about the Sunday overtime, which falls by more than the Saturdays add. The rate and the two premiums
# are read from paycalc-calc.js, the Pay Calculator's own, never typed here
PAY = json.loads(subprocess.check_output(['node', '-e', "import('../../../paycalc-calc.js').then(m => process.stdout.write(JSON.stringify({rate: m.GRADES.cea.rate, sat: m.RATE_125, sun: m.RATE_150})))"], cwd=TOOL, text=True))
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
    new = ''.join(f'<a:p>{ppr}<a:r>{rh}<a:t>{escape(h)}</a:t></a:r><a:br/><a:r>{rd}<a:t>{escape(t)}</a:t></a:r><a:endParaRPr lang="en-US" sz="{detail}" dirty="0"/></a:p>' for h, t in items)
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
    put(s, 'Much the same balance. Sundays stay overtime and still finish at 23:25.', f'Blocks of earlies or lates up to {F["block"]}\u00a0weeks{upto_banner}{", and every switch from one kind to the other crosses a cover week" if facts["switches_across_cover"] else ""}; a\u00a0full\u00a0weekend\u00a0off comes round at least every {F["weekendGap"]}\u00a0weeks.')
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
    tile(s, 12, ['full weekends off'], 'full weekends\noff a year'); tile(s, 13, ['at most 5 weeks apart'], f'today {T["weekendsYear"]} · {F["weekendsShort"]}')
    tile(s, 16, ['shift times you already work'], 'shift times you\nalready work')
    tile(s, 20, ['shorter on every closing shift'], 'off every\nclosing shift')
    sub = runs_of(s.x[slice(*spans(s.x)[21])])[0]
    tile(s, 21, ['45 min on a Sunday', '1h 15m on a Saturday', 'up to 1 hour'],
         {'45 min on a Sunday': 'Sundays: 45 min', '1h 15m on a Saturday': 'Saturdays: 1h 15m'}.get(sub, sub))
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
    s = S(5)
    put(s, 'No. The same 35-hour week — plus about two more Saturdays at time and a quarter.',
        f'No: basic pay stays the same. Premium and overtime pay come to about £{pounds} a year less, gross, if you work your share of Sundays.')   # gross, and what it is (external review, 31 Oct 2026); the table above gives the Saturdays and Sundays
    s.save()
    snd.notes(d, 5, 'Basic pay follows the 35-hour week', f'Basic pay follows the 35-hour week, which does not change. What moves is the premium and overtime pay. Every figure here is for 52 weeks, which is exactly two turns of the 26, so on this link they are everyone’s, whichever line you start on; today’s, on 20 weeks, are averages. Saturdays in the contract are paid at time and a quarter, and each person is rostered about {F["sat"]} a year instead of {T["sat"]} — about {round(sat_p - sat_t)} more Saturday hours, worth {ps:.1f} hours’ pay. Sundays stay overtime, paid at time and a half: {F["sundayPeople"]} a week shared among {F["people"]} people instead of {T["sundayPeople"]} among {T["people"]}, so about {F["sun"]} each a year against {T["sun"]}, and a little shorter — about {round(sun_p)} Sunday hours a year each against {round(sun_t)}, worth {pu:.1f} hours’ pay less. Together, someone who works their full share of Sundays gets {pu - ps:.1f} hours’ pay less a year: roughly £{pounds} gross, before tax, at the CEA rate of £{PAY["rate"]:.2f}. That estimate assumes the rate, a full share of the Sunday overtime and the fixed duties only — anything later given in a cover week is left out. Someone who works no Sunday overtime is {ps:.1f} hours’ pay better off. How much Sunday overtime each person works is up to them, as now. None of this is a payslip; the Pay Calculator in the app does that.')
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
    s = S(7)
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
    notes_edit(d, 9, f'and {a1} of the {b1} keep the same shift time Monday to Friday.', f'and {a1} of the {b1} keep one shift time Monday to Friday, against {T["oneTurn"]} today.')
    # THE BREAKS SAID AS THEY ARE (31 Oct 2026 review): "22 of 26 are two days or more, against 13 of 17" read as though the
    # design kept today's three- and four-day breaks; it has none. Computed, and refused unless that is still so
    rl, rl_t = rest_lens(PG), rest_lens(TODAY_P); one, one_t, long_t = rl.count(1), rl_t.count(1), sum(1 for n in rl_t if n > 2)
    if not (max(rl) == 2 and long_t > 0 and one == one_t and f'{rl.count(2)} of {len(rl)}' == F['breaks']):
        raise SystemExit(f'deck-polish: {name}’s notes 9 say every break is one or two days and today has longer; breaks {sorted(rl)}, today {sorted(rl_t)}')
    notes_edit(d, 9, f'Rest days mostly come in pairs: {F["breaks"].replace(" of ", " of the ")} rest-day breaks are two days or more, against {T["breaks"]} today, and single rest days stay at {WORDS[one]}, as today.',
               f'Rest days mostly come in pairs: {rl.count(2)} of the {len(rl)} rest-day breaks are two days and the other {WORDS[one]} single days, none longer; today {T["breaks"]} are two days or more, {WORDS[long_t]} of them three or four days (about {round(long_t * 52 / len(TODAY_P))} a year each). Single rest days stay at {WORDS[one]}, as today, so fewer a year each: about {round(one * 52 / len(PG))}, against {round(one_t * 52 / len(TODAY_P))}.')
    strip_slide(d, name, grid, F)
    s = S(11)
    put(s, 'About the same. A cover week still counts as at most 4 days of leave, as now.', f'Best stretch {F["leaveBest"]} days, not {T["leaveBest"]}; four full weeks off in a row, Sunday to Saturday, costs {F["leaveFour"]}\u00a0days’ leave, not {T["leaveFour"]}. Average the same, worst a day better.')
    s.save()
    plainly = f'{ALL} shortlisted links are worse than today here' if name in SHORTLIST else f'{name} and {ALL} shortlisted links are worse than today here'
    notes_edit(d, 11, 'The exact averages depend on where you count a booking as starting, so quote them as “about the same”.', f'Say the four-weeks figure plainly: {plainly} (one design in the pack keeps the 14, at other costs), and people plan a year around it. The averages depend on where you count a booking as starting, so quote those as “about the same”.')
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
    put(s, 'Average as today, and the worst a day better.', 'The least leave for four complete weeks off in a row, Sunday to Saturday.')   # the sheet's words, cut to fit the tile
    # EVERY NEW TIME ON THE CARD (31 Oct 2026 review): it named the shorter lates and the longer earlies and left the rest out
    n_new13, body13 = new_time_kinds(PG)
    t13 = shape_of(s, f'{WORDS[n_new13].capitalize()} new shift times to learn')
    old13 = runs_of(s.x[slice(*spans(s.x)[t13 + 1])])
    if len(old13) != 1 or 'shorter versions of today’s lates' not in old13[0]: raise SystemExit(f'deck-polish: slide 13’s new-times card body is {old13}')
    set_shape(s, t13 + 1, body13)
    put(s, 'Five cover weeks', 'Two more Saturdays a year')
    put(s, 'Spaced evenly: weeks 1, 6, 11, 16 and 21.', f'{F["sat"]} a year each, today {T["sat"]} — fourteen on a Saturday, shared across 26 lines.')
    # THE COSTS THE SHEETS NAME (31 Oct 2026, the review of Even Step's decks): the slide said "Nothing is free — here is what it
    # costs" and left out the longer blocks and the fewer early finishes the proposal sheet and the shortlist sheet both list,
    # and the 22:00 finishes slide 7 shows. They take the places of "about 2 minutes longer on average" (slide 6 says it) and
    # "Still a proposal" (slides 1 and 15 say it); every one is computed, and refused unless it is a cost against today
    P13 = (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, grid), encoding='utf-8')))
    eo, eo_t = early_off(P13), early_off(TODAY_P)
    if not (int(F['block']) > int(T['block']) and eo < eo_t and int(F['late22']) > int(T['late22'])):
        raise SystemExit(f'deck-polish: {name}’s slide 13 names longer blocks, fewer early finishes and more 22:00 finishes as costs, and they are not')
    up13 = f', {F["blockUpTo"]} if the cover weeks go the same way' if int(F['blockUpTo']) > int(F['block']) else ''
    put(s, 'Shifts about 2 minutes longer on average', 'Earlies or lates in longer runs')
    put(s, 'That is what keeps days at work to 219 a year or fewer on the same 35 hours.', f'Up to {F["block"]}\u00a0weeks of one kind{up13} (today {T["block"]}, up to {T["blockUpTo"]}).')
    put(s, 'A few more late finishes', 'More late finishes')
    put(s, f'{F["late23"]} a year each at 23:00 or later (today {T["late23"]}) — the rules’ minimum.', f'{F["late23"]} a year each at 23:00 or later (today {T["late23"]}), and {F["late22"]} at 22:00 or later (today {T["late22"]}).')
    put(s, 'Still a proposal', 'Fewer early finishes')
    put(s, 'Your views count before a link is chosen, and who goes on which line is not decided.',
        f'{eo} a year each finish before 14:00 (today {eo_t}).' if eo else f'No early finishes before 14:00 (today\u00a0{eo_t}\u00a0a\u00a0year\u00a0each).')
    put(s, 'None of these is hidden: each one is on the full proposal sheet too.', 'None of these is hidden: every figure here is worked out from the rota.')
    s.save()
    notes_edit(d, 13, 'None of these is hidden on the full proposal sheet either.', 'Every one is on the proposal sheet or the shortlist sheet as well, and slide 7 has the late finishes in full.')
    replace_in_run(f'{d}/ppt/slides/slide15.xml', 'every figure worked out from the rota by the Marylebone Roster app', 'every figure worked out from the rota by the Marylebone Roster app and its tooling')
    p14 = f'{d}/ppt/slides/slide14.xml'
    replace_run(p14, '219', T['daysYear'], after='Contracted days at work a year'); replace_run(p14, '219', F['daysYear'], after='Contracted days at work a year')
    replace_run(p14, '4 in 20', T['weekendsYear'], after='Full weekends off'); replace_run(p14, '7 in 26', F['weekendsYear'], after='Full weekends off'); replace_run(p14, 'Full weekends off', 'Full weekends off, about a year')
    # THE FATIGUE CELLS CARRY THE WORST CASE (31 Oct 2026), as today's "4 (up to 5)" beside them does: with a cover week's
    # Sunday worked as overtime the four can make a 55-hour week, which the sheets give as "0 (up to 1)"
    for n in (12, 14):
        replace_run(f'{d}/ppt/slides/slide{n}.xml', 'Avoidable fatigue warnings in the fixed rota', 'Avoidable fatigue warnings, cover weeks aside')
        replace_run(f'{d}/ppt/slides/slide{n}.xml', '0', F['ff'], after='Avoidable fatigue warnings, cover weeks aside')
    if explain_h55(name, F): notes_append(d, 12, f'The “up to 1” beside the fatigue warnings is more than 55 hours in seven days. If a cover week’s four duties come straight after a busy week, and its Sunday is worked as overtime too, those seven days can come to {F["h55"]} hours with 8-hour duties, and more with longer ones, which the rail industry’s guidance flags. Where the four fall, and whether the Sunday is worked, is for the roster office.')
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
        return (f'<a:rPr lang="en-US" sz="{sz}"{b} dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
                '<a:latin typeface="Inter" pitchFamily="34" charset="0"/><a:ea typeface="Inter" pitchFamily="34" charset="-122"/>'
                '<a:cs typeface="Inter" pitchFamily="34" charset="-120"/></a:rPr>')
    def para(t, sz, color, after, before=0, bold=False):   # an empty `t` still takes a line of this size, so rows stay level
        ppr = '<a:pPr marL="0" indent="0">' + (f'<a:spcBef><a:spcPts val="{before}"/></a:spcBef>' if before else '') + f'<a:spcAft><a:spcPts val="{after}"/></a:spcAft><a:buNone/></a:pPr>'
        return '<a:p>' + ppr + (f'<a:r>{rpr(sz, color, bold)}<a:t>{escape(t)}</a:t></a:r>' if t else '') + f'<a:endParaRPr lang="en-US" sz="{sz}" dirty="0"/></a:p>'
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
    sunday = 'On Sundays: a 9-hour early, 09:00–18:00, and the ticket-office late, 14:30–22:30'
    lines = {'Even Step': ['A new weekday late, 12:15–20:30', sunday],
             'In Step': ['Two longer weekday earlies, 06:20–15:15 and 07:00–15:45, and a new late, 14:30–22:30', sunday],
             'Short Run': ['A 9-hour weekday early, 07:00–16:00, and a new late, 15:00–22:30', sunday]}[name]
    lines = ['Closers start later: ' + ', '.join(f'{SAY[v]} on {k}' for k, v in closers.items())] + lines   # every line two at most, at 15pt
    named = {t for ln in lines for t in re.findall(TIME, ln)}
    new_all = {tm for day, items in groups for tm, nt in items if re.fullmatch(TIME, tm)}
    closer_t = {tm for day, items in groups for tm, nt in items if nt.startswith('closer')}
    if not (named <= new_all and new_all - closer_t <= named): raise SystemExit(f'deck-polish: {name}’s slide 8 lines name {sorted(named)}; the new times are {sorted(new_all)}')
    joined = lambda t: re.sub(r'(\d\d:\d\d–)(?=\d)', '\\1\u2060', t)   # a word joiner: a time never breaks at its dash
    def bullet(t, sz=1500, after=1000):
        return ('<a:p><a:pPr marL="190500" indent="-190500"><a:spcAft><a:spcPts val="' + str(after) + '"/></a:spcAft><a:buSzPct val="100000"/>'
                '<a:buFont typeface="Inter" pitchFamily="34" charset="0"/><a:buChar char="&#x2022;"/></a:pPr>'
                f'<a:r>{rpr(sz, "1B2533")}<a:t>{escape(joined(t))}</a:t></a:r><a:endParaRPr lang="en-US" sz="{sz}" dirty="0"/></a:p>')
    right = boxes(news[0], [(0, int(4.8 * IN), [bullet(ln) for ln in lines])])
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
    put(s, 'Same hours and days, shorter closers, more full weekends off.', 'The costs: more late finishes and longer runs of earlies or lates.')
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
    if not all(w in help_ for w in ('one early is on the floor until 09:00', 'the two lates are on the floor until 15:00', 'one goes back to the floor from 18:00')):
        raise SystemExit(f'deck-polish: managers’ notes 3 describe the Sunday office as the model did; it now says {help_!r}')
    notes_edit(d, 3, 'except its second person at the quiet ends of the day.', 'except at the quiet ends of the day, when one of each pair helps on the floor — on a Sunday one early until 09:00, and both lates until 15:00, one of them again from 18:00.')
    s = S(6); drop_shape(s, 'Early starts and a weekly rotation come with every link, so are not counted. The written source of the 13-day limit is still to be confirmed.'); s.save()
    replace_run(f'{d}/ppt/slides/slide6.xml', '0', F['ff'], after='Avoidable fatigue warnings, fixed rota')   # the worst case too, as on the colleagues' slides
    if explain_h55(name, F): notes_append(d, 6, f'The “up to 1” beside the fatigue warnings is the rail industry’s guideline of no more than 55 hours in any seven-day period: worked as four 8-hour duties straight after a busy line, with its Sunday as overtime too, a cover week can make {F["h55"]} hours in seven days. Where the four fall, and whether the Sunday is worked, is for the roster office.')
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
    grid_of = lambda n: (lambda j: j.get('patterns', j))(json.load(open(os.path.join(TOOL, DESIGNS[n]), encoding='utf-8')))
    O = [grid_of(n) for n in SHORTLIST if n != name]
    today_times = {TODAY_P[k][dd] for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd])}
    ms_long = lambda g: round(per_year(g, lambda s, dd: dd != 'sun' and _len(s) > 510))   # shifts over 8h 30m Monday to Saturday, each a year
    ms_new_earlies = lambda g: len({g[k][dd] for k in g for dd in DAYS[1:] if _timed(g[k][dd]) and int(g[k][dd][:2]) < 11} - today_times)
    edge = {'Even Step': ms_long(P) == 0 < min(ms_long(g) for g in O) and ms_new_earlies(P) == 0 < min(ms_new_earlies(g) for g in O),
            'Short Run': float(F['fitWk']) < min(float(o['fitWk']) for o in others) and sat_new(P) == 0 < min(sat_new(g) for g in O),
            'In Step': H(F['heavy']) < min(H(o['heavy']) for o in others) and float(F['fitSat']) < min(float(o['fitSat']) for o in others)
                       and H(F['heavy']) - H(F['light']) < min(H(o['heavy']) - H(o['light']) for o in others) and early_off(P) > max(early_off(g) for g in O)}[name]
    # (1 Nov 2026, managers' review: In Step's line now names its early finishes, Short Run's its short lates, as the shortlist does)
    if name == 'Short Run' and not weekday_late_avg(P) < min(weekday_late_avg(g) for g in O):
        raise SystemExit('deck-polish: Short Run’s "This one adds" names the shortest weekday lates, and they are not')
    if not edge: raise SystemExit(f'deck-polish: {name}’s "This one adds" line is no longer its own among the shortlist')
    adds = {'Even Step': 'This one adds: no shift over 8h 30m and every early one of today’s times, Mon–Sat',
            'Short Run': 'This one adds: closest weekday fit, shortest weekday lates, no new Saturday time',
            'In Step': 'This one adds: steadiest weeks, closest Saturday fit, most early finishes of the three'}[name]   # "of the three": slide 8 has fewer early finishes than today as a worry
    # WHAT IT COSTS IS AGAINST TODAY, as the bar beneath and the four weeks' leave are (30 Oct 2026). Short Run's line was "one
    # 42h 30m week (today up to 43h 50m)": heavier than In Step's, and lighter than today's, so it read as a cost and was not
    # one. Both now name their long weekday earlies, where today no early is over 8h 30m: In Step's 40 a year, Short Run's
    # 20. Refused if either stops being a cost against today. Even Step has no weekday early over 8h 30m, so its line names
    # the cost it does carry against today, the two more Saturdays a year each (31 Oct 2026), which the colleagues' slide 13
    # shows too.
    worst = lambda mine, theirs: all(mine > t for t in theirs)   # the worst of the three: more is worse
    costs = {'Even Step': worst(weekday_late_avg(P), [weekday_late_avg(g) for g in O]) and worst(float(F['fitWk']), [float(o['fitWk']) for o in others])
                          and abs(weekday_late_avg(P) - weekday_late_avg(TODAY_P)) <= 10   # "near today's": within ten minutes
                          and float(F['fitWk']) - min(float(o['fitWk']) for o in others) <= 0.1 * float(T['fitWk'])   # "slightly": under a tenth of today's score behind
                          # SAID WITH ITS SIZE (fifth review, 1 Nov 2026): "longest weekday lates" and "weakest weekday fit" were accurate
                          # and sounded worse than they are — the lates are a shade shorter than today's, the fit 32.6 against 29.8 and
                          # 29.1 where today's is 52.0. "Lates near today's" is the shortlist sheet's own phrase
                          and f'This one costs: lates near today’s {weekday_late_avg(TODAY_P) // 60}h {weekday_late_avg(TODAY_P) % 60:02d}m, and a slightly weaker weekday fit',
             'In Step': worst(long_wk_earlies(P), [long_wk_earlies(g) for g in O])
                        and f'This one costs: the most long weekday earlies, about {long_wk_earlies(P)} a year each over 8h 30m',
             # SHORT RUN'S LONG EARLIES ARE ITS COST TOO (1 Nov 2026, managers' review): side by side the slides said only In Step had
             # them, though Short Run's are the longer (9h 00m); its heaviest week moved to the notes, being lighter than today's
             'Short Run': worst(H(F['closerSat']), [H(o['closerSat']) for o in others]) and long_wk_lengths(P) == {540}
                          and not any(P[k][dd] == '06:20-13:45' for k in P for dd in DAYS[1:6]) and all(any(g[k][dd] == '06:20-13:45' for k in g for dd in DAYS[1:6]) for g in O)
                          and f'This one costs: {long_wk_earlies(P)} nine-hour weekday earlies a year each, {F["closerSat"]} Saturday closers'}.get(name)   # its 13:45 and early finishes: slide 8 and the notes
    if not costs: raise SystemExit(f'deck-polish: {name}’s "This one costs" line is no longer its own among the shortlist')
    if not (int(F['leaveFour']) > int(T['leaveFour']) and int(F['sat']) > int(T['sat'])):
        raise SystemExit(f'deck-polish: the bar names the four weeks’ leave and the Saturdays as costs against today, and for {name} they are not')
    # THE TIMES LINE IS THE GAIN (1 Nov 2026, managers' review): it carried a green tick beside "5 new", which slide 8 lists as a
    # worry; it now says what the tick is for, fewer times than today and most of them known, and the new ones stay on slide 8
    times_line = f'Shift times: {n_times} (today {T["times"]}), {n_known} of them worked today'
    # true of every shortlisted design, or it would not be on every deck: the flexible rules are left out, as the ticks have no
    # room for them; every one meets all three, which the managers' notes 2 and 3 say
    lead = ALL.capitalize() if name in SHORTLIST else f'Like {ALL} shortlisted'   # an off-shortlist design shares them; the subtitle says "shortlisted"
    labels = [f'{lead}: all 9 December rules; no avoidable fatigue warning, cover weeks aside',   # "fixed rota" read as the fixed lines (review)
              f'{lead}: {F["weekendsYear"]} full weekends off a year each (today {T["weekendsYear"]}), at most {GAP} weeks apart',
              f'{lead}: no shift over 9 hours, and every closing shift shorter',
              adds, times_line, costs]
    for i, (t, lab) in enumerate(zip(ticks, labels)): set_shape(s, t + 1, lab)
    set_shape(s, ticks[-1], '–')
    ell = ticks[-1] - 1   # the circle behind the dash is amber, as the worries on slide 8 are: a cost is not a benefit (the deck review)
    if 'prst="ellipse"' not in s.x[slice(*spans(s.x)[ell])]: raise SystemExit('deck-polish: no circle behind the costs line')
    s.sub(ell, GREEN, AMBER, 2)
    bars = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) and runs_of(s.x[a:b])[0].startswith('The trade-off')]; assert len(bars) == 1
    # SAID AS COSTS, EACH AGAINST TODAY (1 Nov 2026, managers' review): "four weeks off for 15 days’ leave" read as a perk
    # the shared costs said without their figures (fourth review, 1 Nov 2026: "qualifications and multiple figures sometimes
    # compete with the main message"); the figures are in notes 7 and 8
    if int(F['leaveFour']) - int(T['leaveFour']) != 1: raise SystemExit(f'deck-polish: slide 7 says a day more leave for four weeks off; {name} needs {F["leaveFour"]}, today {T["leaveFour"]}')
    set_shape(s, bars[0], f'What {ALL} cost: more late finishes, {WORDS[int(F["sat"]) - int(T["sat"])]} more Saturdays a year, ' + 'a day more leave for four weeks off.'.replace(' ', '\u00a0'))   # the last clause kept whole
    set_shape(s, 1, f'What {ALL} shortlisted links give, what this one adds, and what it costs' if name in SHORTLIST
              else f'What it shares with the shortlisted links, what it adds, and what it costs')
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
        what the brackets mean, the costs colleagues will be shown, which design is recommended);
      · "fixed rota" read as the station's fixed lines, so the decks say "cover weeks aside";
      · each row says its rule, each yearly count says "each", each comparison says "(today X)";
      · the notes are short enough to read aloud, keep the history and the dates to slide 9, and say the same things in the
        same order on all three decks.
    Every figure is FIG's (the sheets' own counts) or computed here; every claim is checked before it is printed."""
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    hm = lambda m: f'{m // 60}h {m % 60:02d}m'
    def nb(t):
        for n in (*DESIGNS, 'Closing Time'): t = t.replace(n, n.replace(' ', '\u00a0'))
        return t
    notes = lambda n, start, text: snd.notes(d, n, start, nb(text))
    andl = lambda a: a[0] if len(a) == 1 else ', '.join(a[:-1]) + ' and ' + a[-1]
    rec, (code, fp) = name == RECOMMENDED, IDS[name]
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
        'The recommended December 2026 CEA link, in ten minutes' if rec else f'One of {WORDS[len(SHORTLIST)]} shortlisted December 2026 CEA links, in ten minutes')
    if not rec: put(s, f'For managers · 26 weeks · code {code} · the full proposal sheet has the detail', f'For managers · 26 weeks · code {code} · {RECOMMENDED} is the recommended design')
    s.save()
    notes(1, 'The headline figures only.', 'The headline figures only. Everything week by week, hour by hour and rule by rule is on the eight-page proposal sheet. Every figure here is worked out from the rota by the Marylebone Roster app and its tooling, and has been checked independently.'
              + ('' if rec else f' {RECOMMENDED} is the recommended design; this deck sets out {name} on its own terms.'))

    # SLIDE 2: the bar says what this design is for (the edge slide 7 checks), not the line all three shared
    s = S(2)
    put(s, 'Every December rule met — and no avoidable fatigue warnings in the fixed rota.', 'Every December staffing rule met — and ' + {'Even Step': 'no shift over 8h 30m, Monday to Saturday', 'In Step': 'the steadiest weekly hours of the three', 'Short Run': 'the closest fit to the weekday trains'}[name] + '.')
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
        where = 'the closest' if all(v < x for _, x in rest) else 'the weakest' if all(v > x for _, x in rest) else 'between the other two'
        return f'{where} ({", ".join(f"{n} {x:.1f}" for n, x in rest)})'
    same_sun = len({FIG[n]['fitSun'] for n in SHORTLIST}) == 1
    why = ' Holding every shift Monday to Saturday to 8h 30m or less costs a little of the weekday shape.' if max(_len(P[k][dd]) for k in P for dd in DAYS[1:] if _timed(P[k][dd])) <= 510 else ''
    notes(4, 'The figure compares', f'The score compares, hour by hour, each day’s share of the floor staff on duty with its share of the trains: every arrival and departure, counted by the length of the train. 0 would track the trains exactly. It is a guide to shape, not a staffing requirement or a passenger forecast; the rules on the previous slide are the requirement. {name} scores {F["fitWk"]} on weekdays, {F["fitSat"]} on a Saturday and {F["fitSun"]} on a Sunday, against today’s {T["fitWk"]}, {T["fitSat"]} and {T["fitSun"]}; lower is closer. Among the three shortlisted links, its weekday fit is {place("fitWk")} and its Saturday fit {place("fitSat")}{"; the Sunday is the same on all three" if same_sun else ""}.{why}')

    # SLIDE 5: the notes without the arithmetic, and the Sunday overtime said per person
    pct = lambda v: int(re.search(r'\((\d+)%\)', v).group(1))
    notes(5, 'Working weeks average', f'Working weeks average exactly 35 hours Monday to Saturday, so no overtime is needed to balance the week. Individual weeks run from {F["light"]} to {F["heavy"]} Monday to Saturday (today {T["light"]} to {T["heavy"]}); only the average is the contract, as today. Five cover weeks in 26 keep about the same share of the link as today’s four in 20 ({pct(F["cover"])}%, against {pct(T["cover"])}%). Sunday is not contracted, so the {F["sundayPeople"]} Sunday duties are worked as overtime, as today’s {T["sundayPeople"]} are; shared among {F["people"]} people instead of {T["people"]}, that is a little less each — about {F["sun"]} Sundays a year against {T["sun"]}; across the link, {F["sunHours"]} of overtime each Sunday against {T["sunHours"]}. The two extra Sunday duties come from the Sunday staffing of ten, which any link meeting the rules needs. Each person works {F["daysYear"]} contracted days a year, under the ceiling of 219, which is today’s figure.')

    # SLIDE 6: not a fatigue risk assessment, on the slide; what the brackets are, in the bar
    s = S(6)
    put(s, 'Against the Office of Rail and Road’s good-practice list and the rail industry’s own checks', 'Office of Rail and Road and rail-industry good practice — not a fatigue risk assessment')
    put(s, 'Avoidable fatigue warnings, fixed rota', 'Avoidable fatigue warnings, cover weeks aside')
    put(s, 'Longest shift', 'Longest shift, any day')   # the 9h is the Sunday early on two of the three; slide 8 gives Monday to Saturday's
    put(s, 'Rest and run limits met with room to spare; no avoidable fatigue warnings in the fixed rota.', 'Rest and days-in-a-row limits met with room to spare. In brackets: the worst case, if\u00a0a\u00a0cover\u00a0week falls badly.')
    s.save()
    notes(6, 'The ORR factors are good practice', 'The Office of Rail and Road’s factors are good practice, not pass-or-fail limits, and this is not a fatigue risk assessment. Two of them, early starts at a 06:20 station and a weekly rotation, come with every weekly link, so the proposal sheet lists them for information and does not count them; that is what “avoidable” means here. One check, start times moving more than two hours between shifts, is not counted across a rest day. That is more lenient than the regulator’s wording, on which every link shows it, today’s included; whoever assesses fatigue should decide. '
              + (f'The one possible warning, the “up to 1”, is the guideline of no more than 55 hours in any seven days: if a cover week’s four duties come straight after a heavy week and its Sunday is worked as overtime too, seven days can reach {F["h55"]} hours with 8-hour duties. The roster office can avoid that when it places the duties. ' if explain_h55(name, F) else '')
              + 'The written source of the 13-day limit is still to be confirmed.')

    # SLIDE 7'S NOTES: about a minute aloud, in the same order on all three — what it is, what it adds, what it gives up
    rest_of = lambda key, f=lambda v: v: andl([f'{n} {f(FIG[n][key])}' for n in SHORTLIST if n != name])
    others_of = lambda key, f: [f(FIG[n][key]) for n in SHORTLIST if n != name]
    if name == 'Even Step' and not (n_times < min(others_of('times', lambda v: int(v.split(' ')[0]))) and H(F['step']) > max(others_of('step', H))):
        raise SystemExit('deck-polish: Even Step’s notes 7 give it the fewest shift times and the furthest week-to-week move of the three, and it has not')
    if name == 'Short Run' and not H(F['heavy']) > max(others_of('heavy', H)):
        raise SystemExit('deck-polish: Short Run’s notes 7 give it the heaviest week of the three, and it has not')
    lead7 = (f'{name} is the recommended design. It keeps {"In Step" if name == "Even Step" else "the other shortlisted"}’s weeks — the same rest days, weekends, cover weeks and blocks of earlies and lates — with the shift times chosen again, so that nothing Monday to Saturday runs over 8h 30m and every early Monday to Saturday is a time worked today.'
             if rec else f'{name} is one of {WORDS[len(SHORTLIST)]} shortlisted designs; {RECOMMENDED} is the recommended one.')
    body7 = {
        'Even Step': f' It has the fewest shift times of the three, {n_times}, and keeps today’s 13:45 every weekday. What it gives up, against the other two: weekday lates of {hm(wla)} on average, closers aside ({andl([f"{n} {hm(weekday_late_avg(g))}" for n, g in zip([n for n in SHORTLIST if n != name], O)])}; today {hm(weekday_late_avg(TODAY_P))}); start times that move further from one week to the next, {F["step"]} on average ({rest_of("step")}; today {T["step"]}); and a slightly weaker weekday fit to the trains, {F["fitWk"]} ({rest_of("fitWk")}; today {T["fitWk"]}).',
        'In Step': f' It has the steadiest weekly hours of the three, {F["light"]} to {F["heavy"]} Monday to Saturday (today {T["light"]} to {T["heavy"]}); the most finishes before 14:00, {eo} a year each (today {eo_t}); and the closest Saturday fit to the trains, {F["fitSat"]} ({rest_of("fitSat")}). It keeps today’s 13:45 every weekday. What it gives up: {long_phrase}, about {long_wk_earlies(P)} a year each in all, where today no early is over 8h 30m.',
        'Short Run': f' It has the closest weekday fit to the trains, {F["fitWk"]} ({rest_of("fitWk")}; today {T["fitWk"]}); the shortest weekday lates, {hm(wla)} on average, closers aside; and no new shift time on a Saturday. What it gives up: {long_phrase}, about {long_wk_earlies(P)} a year each, where today no early is over 8h 30m; today’s 13:45, which both others keep every weekday; a Saturday closer of {F["closerSat"]} ({rest_of("closerSat")}); the heaviest week of the three, {F["heavy"]} Monday to Saturday (today {T["heavy"]}); and the shortest rest, {F["rest"]} ({rest_of("rest")}).'}[name]
    notes(7, 'This is the case in one slide.', lead7 + body7 + f' Every closing shift is {min(cuts)} to {max(cuts)} minutes shorter than today’s. The costs all three share are in the bar: {F["late23"]} finishes a year at 23:00 or later against {T["late23"]}, {F["sat"]} Saturdays against {T["sat"]}, and {F["leaveFour"]} days’ leave for four weeks off against {T["leaveFour"]}.')

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
             ('Less premium and overtime pay', f'about £{pounds} a year, gross, for\u00a0a\u00a0full\u00a0share\u00a0of\u00a0Sundays')]
    p8 = f'{d}/ppt/slides/slide8.xml'
    set_pairs(p8, f'{F["weekendsYear"]} full weekends off a year (today {T["weekendsYear"]})', gains)
    set_pairs(p8, f'Late finishes: {F["late23"]} a year at 23:00 or later (today {T["late23"]}), {F["late22"]} at 22:00 or later (today {T["late22"]})', costs)
    s = S(8)   # both lists start a little higher, so three two-line points, one with a two-line figure, sit inside the card
    for h0 in (gains[0][0], costs[0][0]):
        i = next(k for k, (a0, b0) in enumerate(spans(s.x)) if runs_of(s.x[a0:b0])[:1] == [escape(h0)])
        x0, y0, cx0, cy0 = s.box(i); s.geo(i, y=y0 - 73152, cy=cy0 + 73152)   # 0.08in
    s.save()
    # what left the slide, said in the notes by name, so the presenter has it to hand
    off = [f'one shift time Monday to Friday in {F["oneTurn"]} weeks (today {T["oneTurn"]})']
    if ms_longest(P) <= 510: off.append(f'every closing shift {min(cuts)} to {max(cuts)} minutes shorter')
    off += [f'the shortest rest between shifts {F["rest"]} (today {T["rest"]})', f'at least {F["floorMin"]} on the floor at all times (today {T["floorMin"]})',
            f'{n_new} of the {n_times} shift times new to learn', f'{eo or "no"} finishes before 14:00 a year (today {eo_t})',
            f'{F["late23"]} finishes a year at 23:00 or later (today {T["late23"]})']
    off_sentence = ' Not on the slide, but worth having to hand: ' + andl(off) + '. The full comparison is on the proposal sheet.'
    over = lambda g: {(dd, g[k][dd]) for k in g for dd in DAYS if _timed(g[k][dd]) and _len(g[k][dd]) > 510}
    if not all(_len(TODAY_P[k][dd]) <= 510 for k in TODAY_P for dd in DAYS if _timed(TODAY_P[k][dd]) and int(TODAY_P[k][dd][:2]) < 11):
        raise SystemExit('deck-polish: the managers’ notes say no early today is over 8h 30m, and one is')
    if ms_longest(P) <= 510 and over(P) != {('sun', '09:00-18:00')}: raise SystemExit(f'deck-polish: {name}’s notes 8 call the Sunday 09:00–18:00 its one shift over 8h 30m; it has {sorted(over(P))}')
    rl, rl_t = rest_lens(P), rest_lens(TODAY_P); long_t = sum(1 for n in rl_t if n > 2)
    if not (max(rl) == 2 and long_t > 0 and all(n in (3, 4) for n in rl_t if n > 2) and F['leaveAvg'] == T['leaveAvg'] and int(F['late23']) - int(T['late23']) == 3):
        raise SystemExit(f'deck-polish: {name}’s notes 8 no longer hold')
    tail8 = (f' No shift Monday to Saturday is over 8h 30m; the one longer shift is the Sunday 09:00–18:00, 9 hours.' if ms_longest(P) <= 510
             else f' {long_phrase[0].upper() + long_phrase[1:]}: about {long_wk_earlies(P)} a year each, where today no early is over 8h 30m.')
    notes(8, 'Days at work stay at 219', f'Figures are per person, a year, with cover weeks aside, as on the slide. Days at work are {F["daysYear"]} a year, Monday to Saturday, just under today’s 219; Sunday is overtime. Finishes at 23:00 or later rise by about three a year each, all from the December staffing: three to the close every day, where today has two Monday to Saturday, so no link meeting the rules could have fewer. Finishes at 22:00 or later rise from about {T["late22"]} to {F["late22"]}, because the rules also want five still on duty at 22:00. Leave is only needed for working days, Monday to Saturday. Today one stretch lets 14 days’ leave buy {T["leaveBest"]} days off; this link spreads rest days more evenly, so its best is {F["leaveBest"]}, and four whole weeks off needs {F["leaveFour"]} days, not {T["leaveFour"]}; on average 14 days goes as far as today, {F["leaveAvg"]} days off. Blocks of earlies or lates run up to {F["block"]} weeks, {F["blockUpTo"]} if the cover weeks beside them go the same way (today {T["block"]}, up to {T["blockUpTo"]}), and no rest-day break is longer than two days, where today {WORDS[long_t]} are three or four days. The two extra Saturdays come from aiming for fourteen on a Saturday. The pay figure is gross premium and overtime pay at the CEA rate of £{PAY["rate"]:.2f}, for someone working their full share of Sundays; basic pay does not change.' + tail8 + off_sentence)

    # SLIDE 9: what the managers are asked to do, on the slide; the dates and the history in the notes alone
    s = S(9)
    put(s, 'The nine December rules. Everything here is built on them.', 'Everything here is built on them; worth having in writing before a link is chosen.')
    put(s, 'Colleagues’ views come first.', 'After colleagues’ views. Not yet seen by the roster office or a union rep.')
    s.save()
    notes(9, 'The Sunday finish stays at 23:25', 'The December rules and the Sunday cover were confirmed verbally on 29 September 2026, and are worth having in writing before a link is chosen; the 26-week link was set on 1 October 2026. The 13-day limit used in the checks is Chiltern practice; its written source is still to be confirmed. The fatigue check still open is FF19 on the rules sheet: start times moving more than two hours between shifts, which is not counted across a rest day. The proposal has not yet been through the roster office or a union rep. The Sunday finish stays at 23:25, as agreed practice.')

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
        if n not in (3, 4) or rows != [ROW_TOP + i * ROW_PITCH for i in range(n)]: continue
        if any((g := geo(sp)) and rows[-1] + ROW_H <= g[1] < BAR_TOP for sp in sps): continue   # something sits under the table
        h = round(BAND / (n + 0.2 * (n - 1))); gap = round(0.2 * h); bump = 200 if n == 3 else 0
        def respace(sp):
            g = geo(sp)
            if not g or g[3] != ROW_H or g[1] not in rows: return sp
            i = rows.index(g[1])
            sp = sp.replace(f'<a:off x="{g[0]}" y="{g[1]}"/><a:ext cx="{g[2]}" cy="{g[3]}"/>', f'<a:off x="{g[0]}" y="{ROW_TOP + i * (h + gap)}"/><a:ext cx="{g[2]}" cy="{h}"/>', 1)
            sp = re.sub(r'<a:gd name="adj" fmla="val (\d+)"/>', lambda m: f'<a:gd name="adj" fmla="val {round(int(m.group(1)) * ROW_H / h)}"/>', sp)
            return re.sub(r' sz="(\d+)"', lambda m: f' sz="{int(m.group(1)) + bump}"', sp) if bump else sp
        x2 = re.sub(r'<p:sp>.*?</p:sp>', lambda m: respace(m.group(0)), x, flags=re.S)
        if x2 != x: open(path, 'w', encoding='utf-8').write(x2); moved.append(f'{fn[5:-4]}:{n}')
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

def polish(path, name, grid, who):
    d = tempfile.mkdtemp(); zipfile.ZipFile(path).extractall(d)
    (colleagues if who == 'colleagues' else managers)(d, name, grid, FIG[name])
    said = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and 'fixed rota' in open(os.path.join(r, f), encoding='utf-8').read()]
    if said: raise SystemExit(f'deck-polish: {name} for {who} still says "fixed rota" ({", ".join(sorted(said))}); the decks say "cover weeks aside"')
    moved = balance_tables(d)
    family_polish(d, who)
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
            print(f'{name} for {who}: short tables respaced on slides {", ".join(moved) or "none"} (slide:rows)')
    print('polished', ', '.join(names))
