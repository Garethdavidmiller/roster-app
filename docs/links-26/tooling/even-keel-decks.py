# THE EVEN KEEL PRESENTATIONS (3 Oct 2026, owner: "create the presentations for Even Keel"). Built from the Second Nature
# decks like every 26-line deck, but Even Keel sits on Second Gear's duty table (H1), not Second Nature's, so more changes:
# the shift-time list (8 worked today, 7 new — two of them on a Saturday), 44 late finishes a year (four to the close on a
# Saturday, so two more than the rules' minimum — the decks must not repeat Second Nature's "fewest the rules allow"),
# at most 5 days in a row in the fixed duties (6 if a cover week falls badly), rest 14h 35m, the fit chart, the weekend
# spacing, the one-turn weeks, the rest-day breaks and the weekly hours. The leave figures, the closers, the average and
# longest shift, the staffing at the open and after 22:00, and the early/late split are the same as Second Nature's and
# stand. Like every deck, they compare only with TODAY's link.
# Built from the Second Nature decks, so run second-nature-decks.py first. From the repository root:
#   python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/even-keel-decks.py \
#     && node docs/links-26/tooling/deck-check.mjs
# Every edit refuses if the shape does not hold the text it expects (Slide, from second-nature-decks.py).
import importlib.util, os, re, shutil, tempfile, zipfile
import openpyxl

spec = importlib.util.spec_from_file_location('snd', os.path.join(os.path.dirname(__file__), 'second-nature-decks.py'))
snd = importlib.util.module_from_spec(spec); spec.loader.exec_module(snd)
Slide, notes, GREEN, AMBER = snd.Slide, snd.notes, snd.GREEN, snd.AMBER

OUT = 'docs/links-26/presentations'
NAME, CODE = 'Even Keel', 'EK-26-H1'

def rename(d):
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith('.xml'): continue
            p = os.path.join(root, f); x = open(p, encoding='utf-8').read()
            y = x.replace('Second Nature', NAME).replace('SN-26-F2', CODE)
            if y != x: open(p, 'w', encoding='utf-8').write(y)

def build(src, out, edit):
    d = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(d)
    edit(d); rename(d)
    bad = r'Second Nature|SN-26|10 weeks apart|ten weeks apart|43h 40m|9 of (the|its) 15|9 of 15|fewest the rules allow|rules’ minimum|\(42, today 39\)|about 42 a year'
    left = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and re.search(bad, open(os.path.join(r, f), encoding='utf-8').read())]
    if left: raise SystemExit(f'{out}: Second Nature text left in {left}')
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(src) as zs, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in zs.namelist(): z.write(os.path.join(d, n), n)
    shutil.rmtree(d)

def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    s.text(7, '6', '5'); s.text(9, 'today 7, up to 9', 'up to 6 · today 7')
    s.text(13, 'today 4 in 20', 'at most 5 weeks apart')
    s.text(15, '9 of 15', '8 of 15'); s.text(17, '6 new ones', '7 new ones')
    s.text(23, 'Same hours, shorter closers, more full weekends off — and most of the times familiar.', 'Same hours, shorter closers, weekends off never more than five weeks apart, and one shift time most weeks.')
    s.save()
    notes(d, 2, 'This is the whole pitch', 'This is the whole pitch on one slide. Same 35-hour week as now. Never more than five days in a row in the fixed duties, six if a cover week falls badly. Seven full weekends off in every 26 weeks, against four in 20 today, and never more than five weeks apart — though each person works about two more Saturdays a year. 18 of the 21 working weeks keep one shift time Monday to Friday. Eight of the fifteen shift times are ones people already work. And every closing shift is shorter: the weekday and Saturday closers by 30 minutes, the Sunday closer by 45.')

    s = S(7)
    s.text(1, 'A little — about 42 a year each, against 39 today', 'A little — about 44 a year each, against 39 today')
    s.text(7, '42', '44'); s.text(19, '14h 20m', '14h 35m', GREEN)
    s.text(21, 'Three more late finishes a year — the fewest the rules allow — and every closer is shorter.', 'Five more late finishes a year — four to the close on a Saturday — and every closer is shorter.')
    s.save()
    notes(d, 7, 'Be straight about this one', 'Be straight about this one. About five more a year each finish at 23:00 or later. Three of those come from the December rules — three on duty to the close every day, where today’s weekdays have two — and two from Even Keel’s Saturday, which has four to the close rather than three. Finishes at 22:00 or later go up more, from 78 to 94 a year: the rules also want five still on duty after 22:00, and two weekday lates finish at 22:30 with the ticket office. Early 06:20 starts hardly change. And because the shortest gap between two shifts is 14h 35m, nobody finishes late and starts early the next morning.')

    s = S(8)
    s.text(1, '15 shift times in all — 9 of them you already work', '15 shift times in all — 8 of them you already work')
    s.text(4, 'You work these today (9)', 'You work these today (8)')
    s.paras(5, '06:20–14:00 · 06:20–14:20', [(0, '06:20–14:00 · 06:20–14:20'), (1, '06:20–14:50 · 07:15–15:45'), (2, '11:00–19:30 · 14:00–22:30'), (3, '14:30–22:00 · 15:15–23:55')])
    s.text(8, 'New times (6)', 'New times (7)')
    # paragraphs 0, 4 and 6 are the day headings, the rest bullets: two weekday lates, two Saturday earlies, three Sunday times
    s.paras(9, 'Weekdays', [(0, 'Weekdays'), (1, '14:45–22:30 — a new late, ending with the ticket office'), (2, '15:45–23:55 — the closer, 30 minutes later than 15:15'),
                            (4, 'Saturday'), (5, '06:20–15:00 — a new early, 8h 40m'), (5, '07:45–16:45 — a new early, 9 hours'),
                            (6, 'Sunday'), (7, '15:15–23:25 — the closer, 45 minutes later than 14:30'), (8, '09:00–18:00 — a new early, 9 hours'), (9, '14:30–22:30 — the ticket-office late')])
    s.text(11, 'Fewer shift times than today (15, not 18) — and nothing new on a Saturday.', 'Fewer shift times than today (15, not 18) — and three of the new ones are today’s shifts starting later.')
    s.save()
    notes(d, 8, 'Second Nature was built', 'Even Keel uses fifteen shift times, fewer than today’s eighteen, and eight of them are worked today. Three of the seven new ones are today’s shifts starting later — the weekday closer, the Sunday closer and the Sunday ticket-office late — so they are shorter, not longer. The other new ones are a weekday late finishing with the ticket office, two Saturday earlies and a Sunday 09:00 start. The Sunday opener stays today’s 07:15–15:45.')

    s = S(9)
    s.text(11, '6', '5 (up to 6)', GREEN)
    s.text(15, '21 of 25', '22 of 26', GREEN); s.text(19, '14h 20m', '14h 35m', GREEN); s.text(23, '15 of 21', '18 of 21', GREEN)
    s.text(25, 'Seven weekends off in 26 weeks, never more than six days on, and more rest.', 'Seven weekends off in 26, at most five weeks apart, and one shift time in 18 of 21 weeks.')
    s.save()
    notes(d, 9, 'A full weekend is', 'A full weekend is Saturday and the following Sunday both off. Today that is 4 weekends in a 20-week cycle; Even Keel gives 7 in 26, and they are never more than five weeks apart, against seven today. Five is as close as they can be: a full weekend cannot start in a cover week or the week before one, so only 16 of the 26 weeks can begin one. 18 of the 21 working weeks keep the same shift time Monday to Friday — today it is seven weeks in 16 — and only one week mixes earlies and lates. Rest days mostly come in pairs: 22 of the 26 rest-day breaks are two days or more, against 13 of 17 today, and single rest days stay at four, as today. Never more than five days in a row in the fixed duties; six at most if a cover week’s four duties fall badly.')

    s = S(13)
    s.text(3, 'Six new shift times to learn', 'Seven new shift times to learn')
    s.text(16, '42 a year each at 23:00 or later (today 39) — the rules’ minimum.', '44 a year each at 23:00 or later (today 39) — four to the close on a Saturday.')
    s.save()

    s = S(14)
    old = ['Today', 'Second Nature', 'Contracted hours a week', '35h', '35h', 'Contracted days at work a year', '219', '219', 'Average shift · longest shift', '8h 14m · 9h 10m', '8h 16m · 9h 00m', 'Closing shift: weekday · Saturday · Sunday', '8h 40m · 9h 10m · 8h 55m', '8h 10m · 8h 40m · 8h 10m', 'Full weekends off', '4 in 20', '7 in 26', 'Most days worked in a row', '7 (up to 9)', '6', 'Shortest gap between two shifts', '12h 30m', '14h 20m', 'Different shift times', '18', '15 (9 you know)', 'On duty weekday · Saturday · Sunday', '11–12 · 10 · 8', '15 · 14 · 10', 'Avoidable fatigue warnings in the fixed rota', '4 (up to 5)', '0']
    new = list(old); new[1] = NAME; new[19] = '5 (up to 6)'; new[22] = '14h 35m'; new[25] = '15 (8 you know)'
    s.runs(2, old, new); s.save()

def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(3); s.text(19, '3 · 3 · 3', '3 · 4 · 3', GREEN); s.save()
    notes(d, 3, 'Today’s link meets', 'Today’s link meets 4 of the 9 December rules; Even Keel meets all 9, and the three flexible ones as well (14 on a Saturday, evenly spaced cover weeks, 15:45 weekday closers). Someone finishing at exactly 22:00 is not counted as still on after 22:00. The floor figure leaves out the ticket office, except its second person at the quiet ends of the day. Three to the close is the minimum; Even Keel rosters exactly that on weekdays and Sundays, and four on a Saturday, which is where its two extra late finishes a year come from.')

    c = f'{d}/ppt/charts/chart1.xml'; x = open(c, encoding='utf-8').read()
    for old, new in (('<c:v>29.1</c:v>', '<c:v>29.4</c:v>'), ('<c:v>12.7</c:v>', '<c:v>14.5</c:v>')):
        if x.count(old) != 1: raise SystemExit(f'chart: {old} found {x.count(old)} times')
        x = x.replace(old, new)
    open(c, 'w', encoding='utf-8').write(x)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'; wb = openpyxl.load_workbook(xp); ws = wb.active; col = None
    for row in ws.iter_rows():
        for cell in row:
            if cell.value == 'Second Nature': cell.value = NAME; col = cell.column
    if col is None: raise SystemExit('chart workbook: no Second Nature column')
    for r, v in ((2, 29.4), (3, 14.5), (4, 29.0)): ws.cell(row=r, column=col).value = v
    wb.save(xp)

    notes(d, 5, 'Working weeks average', 'Working weeks average exactly 35 hours Monday to Saturday — 44,100 minutes across the 21 working weeks — so no overtime is needed to balance the Monday-to-Saturday week. Individual weeks range from 24h 30m to 41h 30m; only the average is the contract, as today. Five cover weeks keep about the same share of the link as today’s four in 20 (one week in 5.2, against one in 5). Sunday is not contracted, so the ten Sunday duties are worked as rest-day overtime, exactly as today’s eight are. The two extra Sunday overtime duties a week come from the Sunday staffing of ten, confirmed verbally — any link that meets the rules needs them. The 26-week link, its five cover weeks and the ceiling of 219 contracted days a year were agreed on 1 October 2026; Even Keel gives 218.6.')

    s = S(6); s.text(11, '6', '5 (up to 6)', GREEN); s.text(15, '14h 20m', '14h 35m', GREEN); s.save()

    s = S(7)
    s.text(1, 'It meets the brief with the fewest late finishes the rules allow', 'One shift time in 18 of 21 weeks, and no week over 41h 30m')
    s.text(7, 'Seven full weekends off in 26 weeks — today four in 20', 'Seven full weekends off in 26, never more than five weeks apart')
    s.text(10, 'Never more than 6 days in a row — today 7', 'Never more than 5 days in a row in the fixed duties — today 7')
    s.text(13, '9 of its 15 shift times are worked today', '8 of its 15 shift times are worked today')
    s.text(21, 'The trade-off: three more late finishes a year each (42, today 39) — the rules’ minimum.', 'The trade-off: five more late finishes a year each (44, today 39), and seven new shift times.')
    s.save()
    notes(d, 7, 'This is the case in one slide', 'This is the case in one slide. It meets every December staffing rule. 18 of its 21 working weeks keep one shift time Monday to Friday, where today it is seven weeks in 16, and only one week mixes earlies and lates. No working week is over 41h 30m Monday to Saturday, the shortest rest is 14h 35m, and nobody works more than five days in a row in the fixed duties. Its seven full weekends off in 26 weeks are never more than five weeks apart, as close as the five cover weeks allow. The honest costs: finishes at 23:00 or later go from about 39 to 44 a year each — three of those from the December staffing and two from a Saturday with four to the close — and seven shift times are new, eight already worked. Every closing shift is 30 to 45 minutes shorter.')

    s = S(8)
    s.runs(5, ['Weekends off: 7 in 26 (today 4 in 20)', 'At most 6 days in a row (today 7)', 'Every closing shift 30–45 minutes shorter', '9 of the 15 shift times already worked', 'Shortest rest 14h 20m (today 12h 30m)'],
              ['7 weekends off, at most 5 weeks apart', 'One shift time in 18 of 21 weeks (today 7 of 16)', 'At most 5 days in a row (today 7)', 'No week over 41h 30m Monday to Saturday', 'Shortest rest 14h 35m (today 12h 30m)'])
    s.runs(9, ['Late finishes: 42 a year (today 39)', '6 new shift times to learn', 'Weekends off up to 10 weeks apart', 'Best 14-day leave stretch 28 days, not 30', 'Four weeks off takes 15 days’ leave at best, not 14'],
              ['Late finishes: 44 a year (today 39)', '7 new shift times to learn, 2 on a Saturday', 'Average shift about 2 minutes longer', 'Best 14-day leave stretch 28 days, not 30', 'Four weeks off takes 15 days’ leave at best, not 14'])
    s.save()
    notes(d, 8, 'Days at work stay', 'Days at work stay at 219 a year (218.6 exactly; Monday to Saturday; Sunday is overtime), under the ceiling agreed on 1 October 2026. Late finishes average about five more a year each: three from the December staffing — three to the close every day, where today’s weekdays have two — and two from a Saturday with four to the close. Full weekends off are seven in 26 and never more than five weeks apart; 18 of the 21 working weeks keep one shift time. The average shift is about two minutes longer.')

if __name__ == '__main__':
    build(f'{OUT}/Second-Nature-for-colleagues.pptx', f'{OUT}/Even-Keel-for-colleagues.pptx', colleagues)
    build(f'{OUT}/Second-Nature-for-managers.pptx', f'{OUT}/Even-Keel-for-managers.pptx', managers)
    print('wrote', OUT)
