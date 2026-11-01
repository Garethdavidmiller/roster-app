# THE IN STEP PRESENTATIONS (30 Oct 2026, owner: "Create presentations for instep ... Compare the presentation to the one
# for short run, don't miss anything"). In Step keeps Closing Time's weeks with times of its own, and in everything the
# decks say it is Short Run's but for five things, so its decks are Short Run's (Second Edition's edits, then Short Run's)
# with those changed:
#   · the Saturday closer starts at 15:45 like the weekday's (8h 10m, today 9h 10m), so every closing shift is 30 to 60
#     minutes shorter, not 30 to 45;
#   · the shift times: Short Run's count (15, 9 worked today, 6 new) but not its times — today's 13:45 kept every weekday,
#     today's 13:35 on a Saturday, and two new weekday earlies (06:20–15:15, 07:00–15:45) where Short Run has one;
#   · rest 14h 35m, not 14h 20m;
#   · weeks of 25h 30m to 41h 05m, not 24h 30m to 42h 30m;
#   · the fit chart (29.8 · 9.6 · 29.0).
# Everything else the decks quote — the run, the weekends, the one-turn weeks, the step, the leave, the late finishes (42
# after 23:00, 94 at 22:00 or later), 60 starts at 06:20, the staffing, the Sunday, all three flexible rules — is Short
# Run's figure exactly (deck-check.mjs --print), and stays. Made off the shortlist, In Step joined it the same evening, with
# Short Run (owner: "Only do the shortlist for instep and short run"), and Even Step, recommended, joined them on 31 Oct 2026
# (owner: "Yes, keep all three"). So its manager "Why" slide (deck-polish.py) says what all three give, what In Step adds
# against the other two and what it costs, and its notes set it beside both. Like every deck, they compare otherwise only
# with TODAY's link.
# Built from the Second Nature template like every deck, so run second-nature-decks.py first. From the repository root:
#   python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/in-step-decks.py \
#     && python3 docs/links-26/tooling/deck-polish.py "In Step" && node docs/links-26/tooling/deck-check.mjs
# Every edit refuses if the shape does not hold the text it expects; shapes are found by their text, as in Short Run's.
import importlib.util, json, os, re, shutil, subprocess, tempfile, zipfile
import openpyxl

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(os.path.dirname(__file__), name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
snd, sed, srd = load('second-nature-decks'), load('second-edition-decks'), load('short-run-decks')
Slide, notes, GREEN, runs_of, spans, escape = snd.Slide, snd.notes, snd.GREEN, snd.runs_of, snd.spans, snd.escape
put = srd.put

OUT = 'docs/links-26/presentations'
TEMPLATE = 'docs/links-26/tooling/deck-template'   # Second Nature's decks, built by second-nature-decks.py, not shipped
NAME, CODE = 'In Step', 'IS-26-T4'

# What Short Run's decks say that is not true of In Step, searched in the text a reader sees (slide and notes runs, chart
# values), after the rename. Its times that In Step does not work (06:20–14:00, 15:15–23:55, 07:00–16:00, 15:00–22:30),
# its Saturday closer (15:15, 8h 40m), its rest and its weekly range, the "30 to 45 minutes" its closers come to, its fit
# and the Saturday that had nothing new. The figures the two share (94, 60, 18 of 21, 9 of 15, 1h 13m, 5 · 5 · 4, 7 · 5 · 5)
# are deliberately absent: they are In Step's too.
SHORT_RUN_ONLY = re.compile(
    r'14h 20m|42h 30m|24h 30m|^29\.1$|^12\.7$'
    r'|06:20–14:00|15:15–23:55|07:00–16:00|15:00–22:30'
    r'|30 to 45|30–45|starts 15:15, not 14:45|8h 40m, not 9h 10m|Saturday 15:15|and Saturday closers by 30'
    r'|nothing new|none on a Saturday is new|every Saturday time is worked today'
    r'|a little lighter than today’s lightest|about a fifth on a Saturday|45 min on a Sunday|8h 10m · 8h 40m · 8h 10m')
# The template's sentences that name their design ("today or in Second Nature", "In Second Nature the only people") read
# wrongly once that name is In Step. Each is rewritten below; this refuses any that survives.
AWKWARD = re.compile(r'\b[Ii]n In Step\b')

def rename(d):
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith('.xml'): continue
            p = os.path.join(root, f); x = open(p, encoding='utf-8').read()
            y = x
            for old, new in (('Second Nature', NAME), ('Second Edition', NAME), ('Short Run', NAME), ('SN-26-F2', CODE), ('SE-26-F1', CODE), ('SR-26-F1', CODE)):
                y = y.replace(old, new)
            if y != x: open(p, 'w', encoding='utf-8').write(y)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'   # the manager deck's chart workbook: its series is still headed "Second Nature"
    if os.path.exists(xp):
        wb = openpyxl.load_workbook(xp); ws = wb.active; hit = False
        for row in ws.iter_rows():
            for cell in row:
                if cell.value in ('Second Nature', 'Second Edition', 'Short Run'): cell.value = NAME; hit = True
        if hit: wb.save(xp)

# Before the rename the template's own name, Second Nature, is the only design a slide or a note may name: another
# design's name at that point is a sentence ABOUT that design, carried over, which the rename would quietly turn into a
# sentence about this one (Closing Time's builder, 30 Oct 2026 review; in git). It is refused instead.
OTHER_NAMES = re.compile(r'Second Edition|Short Run|Closing Time|Even Step|SE-26-F1|SR-26-F1|CT-26-T2|ES-26-T5')
# The deliberate mentions of another design — the managers' notes say In Step keeps Closing Time's weeks, and set it beside
# Short Run — are written with a no-break space, as second-nature-decks.py writes Familiar Nine, so the check above passes
# them and the rename (which turns every "Short Run" of the source decks into "In Step") leaves them alone.
# Short Run's own figures quoted beside In Step's (its 24h 30m to 42h 30m weeks) carry the same mark, for SHORT_RUN_ONLY's sake.
CT = 'Closing\u00a0Time'
SR = 'Short\u00a0Run'   # the notes set In Step beside Short Run; the rename would otherwise make it In Step beside itself
ES = 'Even\u00a0Step'   # and beside Even Step, the recommended design (31 Oct 2026)

def build(src, out, edits):
    d = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(d)
    for e in edits: e(d)
    carried = [f'{f}: {t[:90]!r}' for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml')
               for t in re.findall(r'<a:t>([^<]*)</a:t>', open(os.path.join(r, f), encoding='utf-8').read()) if OTHER_NAMES.search(t)]
    if carried: raise SystemExit(f'{out}: another design named before the rename —\n  ' + '\n  '.join(carried))
    rename(d)
    left = []
    for r, _, fs in os.walk(d):
        for f in fs:
            if not f.endswith('.xml'): continue
            x = open(os.path.join(r, f), encoding='utf-8').read()
            for t in re.findall(r'<a:t>([^<]*)</a:t>|<c:v>([^<]*)</c:v>', x):
                t = t[0] or t[1]
                if SHORT_RUN_ONLY.search(t): left.append(f'{f}: Short Run text {t[:90]!r}')
                if AWKWARD.search(t): left.append(f'{f}: renamed into "in In Step" {t[:90]!r}')
    if left: raise SystemExit(f'{out}: text that is not In Step\'s —\n  ' + '\n  '.join(left))
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(src) as zs, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in zs.namelist(): z.write(os.path.join(d, n), n)
    shutil.rmtree(d)

KNOWN = ('06:20–13:35', '06:20–13:45', '06:20–14:20', '06:20–14:50', '07:15–15:45', '08:00–16:30', '12:00–20:00', '14:00–22:30', '14:30–22:00')
CLOSERS = '8h 10m · 8h 10m · 8h 10m'

def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    put(s, '45 min on a Sunday', 'up to 1 hour')   # "Saturdays: 1 hour" read as though Sunday's were the tile's 30 (review); Sunday's is 45
    s.save()
    notes(d, 2, 'This is the whole pitch', 'This is the whole pitch on one slide. Same 35-hour week as now. Never more than five days in a row on the fixed rota — seven at most when a cover week falls badly and its Sunday is worked as overtime, where today it is seven and can reach nine. Seven full weekends off in every 26 weeks, against four in 20 today, and never more than five weeks apart — though each person works about two more Saturdays a year. Every working week is all earlies or all lates, and 18 of the 21 working weeks keep one shift time Monday to Friday. Nine of the fifteen shift times are ones people already work, today’s 13:45 finish among them. And every closing shift is shorter: the weekday closer by 30 minutes, the Saturday closer by an hour and the Sunday closer by 45 minutes.')

    notes(d, 4, 'Monday to Saturday, counting', 'Monday to Saturday, counting a cover week as four days worked, the same way the clerks do. Sundays are overtime by agreement, so they are not in these figures, today’s or In Step’s. Exactly, In Step works out at 218.6 days a year: just under today’s 219, which is also the most the 26-week link is allowed (set on 1 October 2026; a year here is 365 days, as the ceiling’s is). The average shift is about two minutes longer, which is on slide 6.')

    s = S(6)   # "8h 40m" is in two rows (today's weekday closer, Short Run's Saturday one), so the cell is found from its row label
    old = 'Saturday closer — starts 15:15, not 14:45'
    i = srd.shape(s, old); s.text(i, old, 'Saturday closer — starts 15:45, not 14:45'); s.text(i + 2, '8h 40m', '8h 10m')   # label, today, design
    put(s, 'Every closing shift is 30 to 45 minutes shorter, and nothing runs over 9 hours.', 'Every closing shift is 30 to 60 minutes shorter, and nothing runs over 9 hours.')   # Short Run's own length, so it wraps where Short Run's does
    s.save()
    notes(d, 6, 'Lead with the closers', 'Lead with the closers: they are the shifts people dislike most, and every one of them is shorter. Weekday 15:45 to 23:55 instead of 15:15 (8h 10m, not 8h 40m); Saturday 15:45 too, instead of 14:45 (8h 10m, not 9h 10m); Sunday 15:15 to 23:25 instead of 14:30 (8h 10m, not 8h 55m). Some earlies go the other way: two new weekday earlies, 06:20–15:15 and 07:00–15:45, are 8h 55m and 8h 45m, each about 20 a year — 40 in all — where no early today is longer than 8h 30m. Be upfront about the two minutes on the average: the 26-week link may have no more than 219 contracted days a year, so the same 35 hours go into slightly fewer, slightly longer shifts. Nothing runs over 9 hours.')

    s = S(7); put(s, '14h 20m', '14h 35m', GREEN); s.save()
    notes(d, 7, 'Be straight about this one', 'Be straight about this one. About three more a year each finish at 23:00 or later, and all of that comes from the December rules: three on duty to the close every day, where today has two Monday to Saturday. With In Step the only people who finish after 23:00 are those three closers, so no link that meets the rules on 26 weeks can have fewer. Finishes at 22:00 or later go up more, from 78 to 94 a year: the rules also want five still on duty after 22:00, and two weekday lates finish at 22:30 with the ticket office. Early 06:20 starts hardly change. And because the shortest gap between two shifts is 14h 35m, nobody finishes late and starts early the next morning.')

    s = S(8)
    i = next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:1] == ['06:20–14:00'])
    s.paras(i, '06:20–14:00', [(0, t) for t in KNOWN])
    i = next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:1] == ['Weekdays'])
    # paragraphs 0, 4 and 6 are the day headings, the rest bullets; ten in all, as Short Run's, which is what the box holds
    # — so the weekday's two new earlies share a line
    s.paras(i, 'Weekdays', [(0, 'Weekdays'), (1, '06:20–15:15 and 07:00–15:45 — new earlies, 8h 55m and 8h 45m'), (2, '14:30–22:30 — a new late, ending with the ticket office'),
                            (3, '15:45–23:55 — the closer, 30 minutes later than 15:15'),
                            (4, 'Saturday'), (5, '15:45–23:55 — the weekday closer, 1 hour later than 14:45'),
                            (6, 'Sunday'), (7, '15:15–23:25 — the closer, 45 minutes later than 14:30'), (8, '09:00–18:00 — a new early, 9 hours'), (9, '14:30–22:30 — the ticket-office late (also a weekday time)')])
    put(s, 'Fewer shift times than today (15, not 18) — and nothing new on a Saturday.', 'Fewer shift times than today (15, not 18) — and on a Saturday only the closer is new.')
    s.save()
    notes(d, 8, 'Second Nature was built', 'In Step was built keeping the times people already work wherever that cost little. Nine of its fifteen are worked today, and it uses fewer different times overall than today’s eighteen. Today’s 06:20–13:45 stays on every weekday, and today’s 06:20–13:35 moves to a Saturday. Three of the new times are shorter versions of today’s lates: the weekday and Saturday closers start at 15:45 and the Sunday closer at 15:15, and the Sunday office late finishes at 22:30, not 23:25 — the same 14:30–22:30 is a new weekday late too, ending with the ticket office. Two new weekday earlies, 06:20–15:15 and 07:00–15:45, are longer than any early worked today, and the Sunday 09:00–18:00 is new. The full list is on the slide. The Sunday opener stays today’s 07:15–15:45.')

    s = S(9); put(s, '14h 20m', '14h 35m', GREEN); s.save()

    s = S(13); put(s, 'Four are shorter versions of today’s lates; one\u00a0is a longer weekday early.', 'Three are shorter versions of today’s lates; two\u00a0are longer weekday earlies.'); s.save()   # no-break: the line breaks at the semicolon, not after a lone "two"
    notes(d, 9, 'A full weekend is', 'A full weekend is Saturday and the following Sunday both off. Today that is 4 weekends in a 20-week cycle; In Step gives 7 in 26, and they are never more than five weeks apart, against seven today. Five is as close as they can be: a full weekend cannot start in a cover week or the week before one, so only 16 of the 26 weeks can begin one. Nobody works more than five days in a row on the fixed rota — today it is seven — and seven is the most a badly placed cover week can make it, with its Sunday worked as overtime. Every working week is all earlies or all lates — today seven weeks in 16 mix the two — and 18 of the 21 keep the same shift time Monday to Friday. Rest days mostly come in pairs: 22 of the 26 rest-day breaks are two days or more, against 13 of 17 today, and single rest days stay at four, as today. There are no six-day weeks (today there is one).')

    s = S(14)
    old = ['Today', 'Second Nature', 'Contracted hours a week', '35h', '35h', 'Contracted days at work a year', '219', '219', 'Average shift · longest shift', '8h 14m · 9h 10m', '8h 16m · 9h 00m', 'Closing shift: weekday · Saturday · Sunday', '8h 40m · 9h 10m · 8h 55m', '8h 10m · 8h 40m · 8h 10m', 'Full weekends off', '4 in 20', '7 in 26', 'Most days worked in a row', '7 (up to 9)', '5 (up to 7)', 'Shortest gap between two shifts', '12h 30m', '14h 20m', 'Different shift times', '18', '15 (9 you know)', 'On duty weekday · Saturday · Sunday', '11–12 · 10 · 8', '15 · 14 · 10', 'Avoidable fatigue warnings in the fixed rota', '4 (up to 5)', '0']
    i = next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:2] == ['Today', 'Second Nature'])   # renamed after the edits
    new = list(old); new[1] = NAME; new[13] = CLOSERS; new[22] = '14h 35m'
    s.runs(i, old, new); s.save()

def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    c = f'{d}/ppt/charts/chart1.xml'; x = open(c, encoding='utf-8').read()
    for old, new in (('<c:v>29.1</c:v>', '<c:v>29.8</c:v>'), ('<c:v>12.7</c:v>', '<c:v>9.6</c:v>')):
        if x.count(old) != 1: raise SystemExit(f'chart: {old} found {x.count(old)} times')
        x = x.replace(old, new)
    open(c, 'w', encoding='utf-8').write(x)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'; wb = openpyxl.load_workbook(xp); ws = wb.active; col = None
    for row in ws.iter_rows():
        for cell in row:
            if cell.value in ('Second Nature', 'Short Run'): cell.value = NAME; col = cell.column
    if col is None: raise SystemExit('chart workbook: no design column')
    for r, v in ((2, 29.8), (3, 9.6), (4, 29.0)): ws.cell(row=r, column=col).value = v
    wb.save(xp)
    notes(d, 4, 'The figure compares', 'The figure compares, hour by hour, the share of the day’s floor staff on duty with the share of the day’s train service, each train weighted by its length. 0 would be a perfect match. It is a guide to shape, not a staffing requirement — the rules on the previous slide are the requirement. Against today’s link, In Step’s score is a little over half on weekdays, about a seventh on a Saturday and about two-fifths on a Sunday; lower is closer.')

    notes(d, 5, 'Working weeks average', 'Working weeks average exactly 35 hours Monday to Saturday — 44,100 minutes across the 21 working weeks — so no overtime is needed to balance the Monday-to-Saturday week. Individual weeks range from 25h 30m to 41h 05m — today’s run from 25h 10m to 43h 50m, so both the heaviest and the lightest week sit inside today’s range; only the average is the contract, as today. Five cover weeks keep about the same share of the link as today’s four in 20 (one week in 5.2, against one in 5). Sunday is not contracted, so the ten Sunday duties are worked as rest-day overtime, exactly as today’s eight are. The two extra Sunday overtime duties a week come from the Sunday staffing of ten, confirmed verbally — any link that meets the rules needs them. The 26-week link, its five cover weeks and the ceiling of 219 contracted days a year were set on 1 October 2026; In Step gives 218.6.')

    s = S(6); put(s, '14h 20m', '14h 35m', GREEN); s.save()

    # slide 7's subtitle and six lines are deck-polish.py's; Short Run's pre-polish wording there is true of In Step
    notes(d, 7, 'This is the case in one slide', f'This is the case in one slide. In Step (30 October 2026) is {CT}’s weeks with the shift times chosen again, to put five on at every opening Monday to Saturday and to follow the weekday trains more closely. It is on the shortlist with {ES}, the recommended design, and {SR}, and this slide sets it beside both. It meets every December staffing rule and all three flexible ones. Nine of its fifteen shift times are worked today, today’s 13:45 finish among them on every weekday. Nobody works more than five days in a row on the fixed rota, where today it is seven; a cover week placed badly, with its Sunday worked as overtime, can make it seven, never more. Every working week is all earlies or all lates, and 18 of the 21 keep one shift time Monday to Friday; today seven weeks in 16 do both. Its seven full weekends off in 26 weeks are never more than five weeks apart, which is as close as the five cover weeks allow; today it is four in 20, up to seven weeks apart. Its working weeks run from 25h 30m to 41h 05m (today 25h 10m to 43h 50m), the most even of the three, and the shortest rest is 14h 35m. {ES} is these same weeks with no shift over 8h 30m Monday to Saturday; against it In Step’s weekday lates are shorter (8h 12m on average, closers aside, against 8h 27m), its working day moves less from one week to the next (1h 13m on average, against 1h 31m) and its weekday fit to the trains is closer (29.8 against 32.6), and the price is its two new weekday earlies, 8h 55m and 8h 45m, which come round about 20 times a year each, 40 in all, where {ES} has none over 8h 30m and neither has today. Against {SR} it has the same run, weekends, weeks on one shift time, late finishes and leave; it adds today’s 13:45, an 8h 10m Saturday closer ({SR}’s is 8h 40m) and more even weeks ({SR}’s run from 24h\u00a030m to 42h\u00a030m), and its fit to the trains is the closer with the three days’ scores added together, though counted day by day across a week {SR}’s is a shade closer (26.7 against 26.8), as it is on weekdays alone; {SR} has 20 weekday earlies a year over 8h 30m, at 9h 00m. The other honest costs: its Saturday closer is a new time on a Saturday, where {SR} has none; finishes at 23:00 or later go from about 39 to 42 a year each, the smallest rise possible — the December staffing needs three to the close every day, and only those three finish after 23:00 — and finishes at 22:00 or later from about 78 to 94; and six shift times are new. Every closing shift is 30 to 60 minutes shorter than today’s.')

    s = S(8)
    s.runs(next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:1] == ['7 weekends off, at most 5 weeks apart']),
           ['7 weekends off, at most 5 weeks apart', 'At most 5 days in a row, fixed rota (today 7)', 'One turn in 18 of 21 weeks (today 7 of 16)', 'Every closing shift 30–45 minutes shorter', '9 of the 15 shift times already worked'],
           ['7 weekends off, at most 5 weeks apart', 'At most 5 days in a row, fixed rota (today 7)', 'One turn in 18 of 21 weeks (today 7 of 16)', 'Every closing shift 30–60 minutes shorter', '9 of the 15 shift times already worked'])
    s.runs(next(i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b])[:1] == ['Late finishes: 42 a year (today 39)']),
           ['Late finishes: 42 a year (today 39)', '6 new shift times to learn', 'A longer weekday early, 9h 00m', 'Best 14-day leave stretch 28 days, not 30', 'Four weeks off needs 15 days’ leave, not 14'],
           ['Late finishes: 42 a year (today 39)', '6 new shift times to learn', 'Longer weekday earlies, up to 8h 55m', 'Best 14-day leave stretch 28 days, not 30', 'Four weeks off needs 15 days’ leave, not 14'])
    s.save()
    notes(d, 8, 'Days at work stay', 'Days at work stay at 219 a year (218.6 exactly; Monday to Saturday; Sunday is overtime), under the ceiling set on 1 October 2026. Late finishes average about three more a year each, all of them from the December staffing — three to the close every day, where today has two Monday to Saturday — so no link meeting the same rules on 26 weeks could have fewer. Full weekends off are seven in 26 and never more than five weeks apart; nobody works more than five days in a row on the fixed rota; no week mixes earlies and lates, and 18 of the 21 working weeks keep one shift time. Weekly hours run from 25h 30m to 41h 05m (today 25h 10m to 43h 50m); only the average is the contract. Two new weekday earlies, 06:20–15:15 and 07:00–15:45, are 8h 55m and 8h 45m, each about 20 a year — 40 in all — where today no early is over 8h 30m. The average shift is about two minutes longer.')

def check_typed():
    """THE TYPED FIGURES, CHECKED, as Closing Time's builder checked its own: the slides' shift-time lists, labels and notes are typed
    in this file, and deck-check.mjs reads only table rows, so each is compared here with the grid and with deck-check.mjs's
    figures before a deck is built."""
    tool = os.path.dirname(os.path.abspath(__file__))
    fig = json.loads(subprocess.check_output(['node', os.path.join(tool, 'deck-check.mjs'), '--print'], text=True)); F, T = fig[NAME], fig['today']
    today = json.loads(subprocess.check_output(['node', '-e', "import('./report-data.mjs').then(m => process.stdout.write(JSON.stringify(m.today().patterns)))"], cwd=tool, text=True))
    g = json.load(open(os.path.join(tool, '..', 'proposals', f'{NAME.replace(" ", "-")}-{CODE}.json'), encoding='utf-8')); g = g.get('patterns', g)
    timed = lambda v: bool(re.fullmatch(r'\d\d:\d\d-\d\d:\d\d', v or ''))
    mins = lambda v: (int(v[6:8]) * 60 + int(v[9:]) - int(v[:2]) * 60 - int(v[3:5])) % 1440
    WK, ALLD = ('mon', 'tue', 'wed', 'thu', 'fri'), ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')
    times = lambda p, days: {r[d] for r in p.values() for d in days if timed(r[d])}
    starts = lambda p, days, end: sorted({r[d][:5] for r in p.values() for d in days if timed(r[d]) and r[d][6:] == end})
    per_day = lambda p, t, days: {sum(1 for r in p.values() if r[d] == t) for d in days}   # how many work time t, day by day
    dash = lambda v: sorted(t.replace('-', '–') for t in v)
    gT, toT = times(g, ALLD), times(today, ALLD); known, new = gT & toT, gT - toT
    early = lambda p: max(mins(t) for t in times(p, ALLD) if int(t[:2]) < 11)
    fit = lambda r: f'{r[0]} · {r[1]} · {r[2]}'
    frac = lambda a, b: float(a) / float(b)
    SL = re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', open(os.path.join(tool, 'fresh.mjs'), encoding='utf-8').read()).group(1))
    G = {n: (lambda j: j.get('patterns', j))(json.load(open(os.path.join(tool, f), encoding='utf-8'))) for n, f in (('Short Run', 'short-run.json'), ('Even Step', 'even-step.json'))}
    S, E = fig['Short Run'], fig['Even Step']
    REC = re.search(r"export const RECOMMENDED = '([^']+)'", open(os.path.join(tool, 'fresh.mjs'), encoding='utf-8').read()).group(1)
    H = lambda v: int(v.split('h')[0]) * 60 + int(v.split('h')[1].strip().rstrip('m'))
    long_ms = lambda p: round(sum(1 for r in p.values() for d in WK + ('sat',) if timed(r[d]) and mins(r[d]) > 510) * 52 / len(p))
    late_avg = lambda p: (lambda l: round(sum(l) / len(l)))([mins(r[d]) for r in p.values() for d in WK if timed(r[d]) and int(r[d][:2]) >= 11 and r[d][6:] != '23:55'])   # the sheet's lateAvg
    shape = lambda p: [[('C' if r[d] == 'SPARE' else 'R' if not timed(r[d]) else 'E' if int(r[d][:2]) < 11 else 'L') for d in ALLD] for k, r in sorted(p.items(), key=lambda kv: int(kv[0]))]
    long_lengths = lambda p: sorted({mins(r[d]) for r in p.values() for d in WK if timed(r[d]) and int(r[d][:2]) < 11 and mins(r[d]) > 510})
    long_wk = lambda p: round(sum(1 for r in p.values() for d in WK if timed(r[d]) and int(r[d][:2]) < 11 and mins(r[d]) > 510) * 52 / len(p))
    add3 = lambda f: float(f['fitWk']) + float(f['fitSat']) + float(f['fitSun'])
    wk7 = lambda f: (5 * float(f['fitWk']) + float(f['fitSat']) + float(f['fitSun'])) / 7
    k1345 = lambda p: all(any(r[d] == '06:20-13:45' for r in p.values()) for d in WK)
    checks = [   # (what the slides say, what the data says, what is typed)
        ('the times worked today, slide 8', dash(known), sorted(KNOWN)),
        ('15 shift times, 9 worked today, 6 new; today 18', [len(gT), len(known), len(new), len(toT)], [15, 9, 6, 18]),
        ('the new weekday times, slide 8', dash(new & times(g, WK)), ['06:20–15:15', '07:00–15:45', '14:30–22:30', '15:45–23:55']),
        ('the new Saturday time, slide 8', dash(new & times(g, ('sat',))), ['15:45–23:55']),
        ('the new Sunday times, slide 8', dash(new & times(g, ('sun',))), ['09:00–18:00', '14:30–22:30', '15:15–23:25']),
        ('the new earlies 8h 55m and 8h 45m, the Sunday 9 hours, today none over 8h 30m, slides 6 and 8',
         [mins('06:20-15:15'), mins('07:00-15:45'), mins('09:00-18:00'), early(today)], [535, 525, 540, 510]),
        ('closers from 15:45 Monday to Saturday, today 15:15 and 14:45, slides 2, 6 and 8', [starts(g, WK, '23:55'), starts(g, ('sat',), '23:55'), starts(today, WK, '23:55'), starts(today, ('sat',), '23:55')],
         [['15:45'], ['15:45'], ['15:15'], ['14:45']]),
        ('the Sunday closer from 15:15, today 14:30, slides 6 and 8', [starts(g, ('sun',), '23:25'), starts(today, ('sun',), '23:25')], [['15:15'], ['14:30']]),
        ('today’s 13:45 on every weekday, its 13:35 on a Saturday and no weekday, notes 2, 8 and the managers’ 7',
         [all(n >= 1 for n in per_day(g, '06:20-13:45', WK)), per_day(g, '06:20-13:35', ('sat',)), per_day(g, '06:20-13:35', WK), per_day(today, '06:20-13:35', ('sat',))], [True, {1}, {0}, {0}]),
        ('two weekday lates to 22:30 with the ticket office, notes 7', [per_day(g, '14:30-22:30', WK), per_day(g, '14:00-22:30', WK)], [{2}, {2}]),
        ('the figures on slides 2, 4, 6, 7, 9, 14 and the manager slides',
         [F['rest'], F['closers'], T['closers'], F['heavy'], F['light'], T['heavy'], T['light'], F['late22'], T['late22'], F['late23'], T['late23'], F['open0620'], F['times'], F['oneTurn'], F['at22'], F['open'], F['run'], F['longestEarly'], T['longestEarly']],
         ['14h 35m', CLOSERS, '8h 40m · 9h 10m · 8h 55m', '41h 05m', '25h 30m', '43h 50m', '25h 10m', '94', '78', '42', '39', '60', '15 (9 you know)', '18 of 21', '7 · 5 · 5', '5 · 5 · 4', '5 (up to 7)', '9h 00m', '8h 30m']),
        ('the fit chart, manager slide 4', fit([F['fitWk'], F['fitSat'], F['fitSun']]), '29.8 · 9.6 · 29.0'),
        # the managers' notes 7 and 8, the colleagues' notes 6 and slide 13 (30 Oct 2026 review): the longer weekday earlies,
        # how often they come round, and the shortlist against them; the fit three ways; the only 13:45 with five at the
        # Saturday open; what In Step gives up against Closing Time; and that it is not on the shortlist
        ('weekday earlies over 8h 30m a year each: In Step, and Short Run’s, all 9h 00m', [long_wk(g), long_wk(G['Short Run']), long_lengths(G['Short Run'])], [40, 20, [540]]),
        ('the fit against Short Run: the three days added, counted day by day, on weekdays alone',
         [add3(F) < add3(S), round(wk7(S), 1), round(wk7(F), 1), wk7(S) < wk7(F), float(S['fitWk']) < float(F['fitWk'])], [True, 26.7, 26.8, True, True]),
        ('against Short Run: the same run, weekends, weeks on one shift time, late finishes and leave',
         [[F[k] == S[k] for k in ('run', 'weekends', 'weekendGap', 'oneTurn', 'late23', 'late22', 'leaveBest', 'leaveAvg', 'leaveWorst', 'leaveFour')], k1345(g), k1345(G['Short Run'])],
         [[True] * 10, True, False]),
        ('against Short Run: its Saturday closer and its weeks', [S['closerSat'], S['light'], S['heavy'], F['closerSat']], ['8h 40m', '24h 30m', '42h 30m', '8h 10m']),
        ('In Step is on the shortlist, with Even Step (recommended) and Short Run', [sorted(SL), REC], [['Even Step', 'In Step', 'Short Run'], 'Even Step']),
        # the managers' notes 7 against Even Step (31 Oct 2026): its same weeks, its step, its weekday fit, none of its shifts
        # Monday to Saturday over 8h 30m, and In Step's weeks the most even of the three
        ('against Even Step: the same weeks, a smaller step, a closer weekday fit, none of Even Step’s over 8h 30m Monday to Saturday',
         [shape(g) == shape(G['Even Step']), F['step'], E['step'], F['fitWk'], E['fitWk'], long_ms(G['Even Step']), late_avg(g), late_avg(G['Even Step'])], [True, '1h 13m', '1h 31m', '29.8', '32.6', 0, 492, 507]),
        ('In Step’s weeks the most even of the three', H(F['heavy']) - H(F['light']) < min(H(o['heavy']) - H(o['light']) for o in (S, E)), True),
        # the notes word the fit against today's as a fraction: "a little over half" (0.5–0.6), "about a seventh" and
        # "about two-fifths" (each within a hundredth or so of 1/7 and 2/5)
        ('the fit as fractions of today’s, manager notes 4',
         [0.5 < frac(F['fitWk'], T['fitWk']) < 0.6, abs(frac(F['fitSat'], T['fitSat']) - 1 / 7) < 0.01, abs(frac(F['fitSun'], T['fitSun']) - 2 / 5) < 0.01], [True, True, True]),
    ]
    bad = [f'{what}: the data says {got}, the slides say {typed}' for what, got, typed in checks if got != typed]
    if bad: raise SystemExit('in-step-decks: a typed figure no longer matches the rota —\n  ' + '\n  '.join(bad))

if __name__ == '__main__':
    check_typed()
    build(f'{TEMPLATE}/Second-Nature-for-colleagues.pptx', f'{OUT}/In-Step-for-colleagues.pptx', [sed.colleagues, srd.colleagues, colleagues])
    build(f'{TEMPLATE}/Second-Nature-for-managers.pptx', f'{OUT}/In-Step-for-managers.pptx', [sed.managers, srd.managers, managers])
    print('wrote', OUT)
