# THE SECOND SIGHT PRESENTATIONS (2 Oct 2026, owner: "create the presentations for Second Sight"). Second Sight is Second
# Nature's duty table with its weeks searched afresh — the same duties every day — so its decks are Second Nature's with
# only what differs changed: the weekend spacing, no week mixing earlies and lates, the rest-day breaks (one more single
# rest day than today, said plainly), the one-turn weeks and the weekly hours. Everything else (rules, shift times, late
# finishes, staffing, fatigue, the leave figures) is the same rota fact and stays.
# Like every deck, they compare Second Sight only with TODAY's link, never with Second Nature or Second Wind.
# Built from the Second Nature decks, so run second-nature-decks.py first. From the repository root:
#   python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/second-sight-decks.py \
#     && node docs/links-26/tooling/deck-check.mjs
# Every edit refuses if the shape does not hold the text it expects (Slide, from second-nature-decks.py).
import importlib.util, os, re, shutil, tempfile, zipfile

spec = importlib.util.spec_from_file_location('snd', os.path.join(os.path.dirname(__file__), 'second-nature-decks.py'))
snd = importlib.util.module_from_spec(spec); spec.loader.exec_module(snd)
Slide, notes, GREEN, AMBER = snd.Slide, snd.notes, snd.GREEN, snd.AMBER

OUT = 'docs/links-26/presentations'
NAME, CODE = 'Second Sight', 'SS-26-F1'

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
    left = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and re.search(r'Second Nature|SN-26|10 weeks apart|ten weeks apart|25h 30m|43h 40m', open(os.path.join(r, f), encoding='utf-8').read())]
    if left: raise SystemExit(f'{out}: Second Nature text left in {left}')
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(src) as zs, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in zs.namelist(): z.write(os.path.join(d, n), n)
    shutil.rmtree(d)

def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    s.text(13, 'today 4 in 20', 'at most 5 weeks apart')
    s.text(23, 'Same hours, shorter closers, more full weekends off — and most of the times familiar.', 'Same hours, shorter closers, and weekends off never more than five weeks apart.')
    s.save()
    notes(d, 2, 'This is the whole pitch', 'This is the whole pitch on one slide. Same 35-hour week as now. Never more than six days in a row. Seven full weekends off in every 26 weeks, against four in 20 today, and never more than five weeks apart — though each person works about two more Saturdays a year. Every week is all earlies or all lates, so nobody switches between the two inside a week. Nine of the fifteen shift times are ones people already work. And every closing shift is shorter: the weekday and Saturday closers by 30 minutes, the Sunday closer by 45.')

    s = S(9)
    s.text(15, '21 of 25', '21 of 26', GREEN); s.text(23, '15 of 21', '16 of 21', GREEN)
    s.text(25, 'Seven weekends off in 26 weeks, never more than six days on, and more rest.', 'Seven weekends off in 26, at most five weeks apart, and no week mixing earlies and lates.')
    s.save()
    notes(d, 9, 'A full weekend is', 'A full weekend is Saturday and the following Sunday both off. Today that is 4 weekends in a 20-week cycle; Second Sight gives 7 in 26, and they are never more than five weeks apart, against seven today. Five is as close as they can be: a full weekend cannot start in a cover week or the week before one, so only 16 of the 26 weeks can begin one. Every working week is all earlies or all lates — today seven weeks in 16 mix the two — and most keep the same shift time Monday to Friday, 16 of the 21. Rest days mostly come in pairs: 21 of the 26 rest-day breaks are two days or more, against 13 of 17 today. That leaves five single rest days, one more than today’s four — worth saying, because somebody will ask. There are no six-day weeks (today there is one).')

def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    notes(d, 5, 'Working weeks average', 'Working weeks average exactly 35 hours Monday to Saturday — 44,100 minutes across the 21 working weeks — so no overtime is needed to balance the Monday-to-Saturday week. Individual weeks range from 22h 30m to 42h 00m; only the average is the contract, as today. Five cover weeks keep about the same share of the link as today’s four in 20 (one week in 5.2, against one in 5). Sunday is not contracted, so the ten Sunday duties are worked as rest-day overtime, exactly as today’s eight are. The two extra Sunday overtime duties a week come from the Sunday staffing of ten, confirmed verbally — any link that meets the rules needs them. The 26-week link, its five cover weeks and the ceiling of 219 contracted days a year were agreed on 1 October 2026; Second Sight gives 218.6.')

    s = S(7)
    s.text(1, 'It meets the brief with the fewest late finishes the rules allow', 'Every week all earlies or all lates, and the fewest late finishes the rules allow')
    s.text(7, 'Seven full weekends off in 26 weeks — today four in 20', 'Seven full weekends off in 26, never more than five weeks apart')
    s.save()
    notes(d, 7, 'This is the case in one slide', 'This is the case in one slide. It meets every December staffing rule and keeps the shift times people already work wherever that cost little — nine of its fifteen are worked today, and none on a Saturday is new. Every working week is all earlies or all lates, where today seven weeks in 16 mix the two. Its seven full weekends off in 26 weeks are never more than five weeks apart, which is as close as the five cover weeks allow; today it is four in 20, up to seven weeks apart. The honest cost is late finishes, and it is the smallest one possible: the December staffing needs three to the close every day, and only those three finish after 23:00, so finishes at 23:00 or later go from about 39 to 42 a year each. Every closing shift is 30 to 45 minutes shorter. Six shift times are new.')

    s = S(8)
    s.runs(5, ['Weekends off: 7 in 26 (today 4 in 20)', 'At most 6 days in a row (today 7)', 'Every closing shift 30–45 minutes shorter', '9 of the 15 shift times already worked', 'Shortest rest 14h 20m (today 12h 30m)'],
              ['7 weekends off, at most 5 weeks apart', 'No week mixing earlies and lates (today 7)', 'Every closing shift 30–45 minutes shorter', '9 of the 15 shift times already worked', 'Shortest rest 14h 20m (today 12h 30m)'])
    s.runs(9, ['Late finishes: 42 a year (today 39)', '6 new shift times to learn', 'Weekends off up to 10 weeks apart', 'Best 14-day leave stretch 28 days, not 30', 'Four weeks off takes 15 days’ leave at best, not 14'],
              ['Late finishes: 42 a year (today 39)', '6 new shift times to learn', 'One more single rest day (5, today 4)', 'Best 14-day leave stretch 28 days, not 30', 'Four weeks off takes 15 days’ leave at best, not 14'])
    s.save()
    notes(d, 8, 'Days at work stay', 'Days at work stay at 219 a year (218.6 exactly; Monday to Saturday; Sunday is overtime), under the ceiling agreed on 1 October 2026. Late finishes average about three more a year each, all of them from the December staffing — three to the close every day, where today’s weekdays have two — so no link meeting the same rules on 26 weeks could have fewer. Full weekends off are seven in 26 and never more than five weeks apart, and no week mixes earlies and lates. The one figure worse than today on rest is single rest days: five, against four. The average shift is about two minutes longer.')

if __name__ == '__main__':
    build(f'{OUT}/Second-Nature-for-colleagues.pptx', f'{OUT}/Second-Sight-for-colleagues.pptx', colleagues)
    build(f'{OUT}/Second-Nature-for-managers.pptx', f'{OUT}/Second-Sight-for-managers.pptx', managers)
    print('wrote', OUT)
