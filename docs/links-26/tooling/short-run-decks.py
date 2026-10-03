# THE SHORT RUN PRESENTATIONS (3 Oct 2026, owner: "do the presentations for Short Run"). Short Run is Second Edition's duty
# table on an exact-solver skeleton with no run over five days, so its decks are Second Edition's with only what differs
# changed: the longest run (5 on the fixed rota, up to 6 when a cover week falls badly — said both ways, as deck-check
# prints it), the weekly hours (24h 30m to 42h 30m, inside today's 25h 10m to 43h 50m), and the pitch lines that lead
# with the run. Weekends, rest-day breaks, one-turn weeks, leave, times, late finishes and fit are Second Edition's exactly.
# Like every deck, they compare only with TODAY's link. Built by applying Second Edition's edits to the Second Nature
# decks and then these, so run second-nature-decks.py first. From the repository root:
#   python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/short-run-decks.py \
#     && node docs/links-26/tooling/deck-check.mjs
# Every edit refuses if the shape does not hold the text it expects (Slide, from second-nature-decks.py). Shapes are
# found by their text rather than by a typed index, so a template change fails loudly instead of editing the wrong box.
import importlib.util, os, re, shutil, tempfile, zipfile

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(os.path.dirname(__file__), name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
snd, sed = load('second-nature-decks'), load('second-edition-decks')
Slide, notes, GREEN, AMBER, runs_of, spans, escape = snd.Slide, snd.notes, snd.GREEN, snd.AMBER, snd.runs_of, snd.spans, snd.escape

OUT = 'docs/links-26/presentations'
TEMPLATE = 'docs/links-26/tooling/deck-template'   # Second Nature's decks, built by second-nature-decks.py, not shipped
NAME, CODE = 'Short Run', 'SR-26-F1'

def shape(s, old):
    """The one shape whose only run is `old`."""
    hits = [i for i, (a, b) in enumerate(spans(s.x)) if runs_of(s.x[a:b]) == [escape(old)]]
    if len(hits) != 1: raise SystemExit(f'{s.path}: {old!r} found in {len(hits)} shapes')
    return hits[0]
def put(s, old, new, color=None): s.text(shape(s, old), old, new, color)

def rename(d):
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith('.xml'): continue
            p = os.path.join(root, f); x = open(p, encoding='utf-8').read()
            y = x.replace('Second Nature', NAME).replace('Second Edition', NAME).replace('SN-26-F2', CODE).replace('SE-26-F1', CODE)
            if y != x: open(p, 'w', encoding='utf-8').write(y)
    xp = f'{d}/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'   # the manager deck's chart workbook: its series is still headed "Second Nature"
    if os.path.exists(xp):
        import openpyxl; wb = openpyxl.load_workbook(xp); ws = wb.active; hit = False
        for row in ws.iter_rows():
            for cell in row:
                if cell.value in ('Second Nature', 'Second Edition'): cell.value = NAME; hit = True
        if hit: wb.save(xp)

def build(src, out, edits):
    d = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(d)
    for e in edits: e(d)
    rename(d)
    left = [f for r, _, fs in os.walk(d) for f in fs if f.endswith('.xml') and re.search(r'Second Nature|Second Edition|SN-26|SE-26|10 weeks apart|ten weeks apart|43h 40m|25h 30m|42h 00m|six days in a row|6 days in a row', open(os.path.join(r, f), encoding='utf-8').read())]
    if left: raise SystemExit(f'{out}: Second Edition text left in {left}')
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(src) as zs, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in zs.namelist(): z.write(os.path.join(d, n), n)
    shutil.rmtree(d)

def colleagues(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    s = S(2)
    put(s, '6', '5'); put(s, 'today 7, up to 9', 'up to 6 · today 7')   # the tile's sub-line, as Even Keel's deck states it
    put(s, 'Same hours, shorter closers, weekends off never more than five weeks apart, and the same shift time most weeks.',
           'Same hours, shorter closers, weekends off never more than five weeks apart, and never more than five days in a row on the fixed rota.')
    s.save()
    notes(d, 2, 'This is the whole pitch', 'This is the whole pitch on one slide. Same 35-hour week as now. Never more than five days in a row on the fixed rota — six at most when a cover week falls badly, where today it is seven and can reach nine. Seven full weekends off in every 26 weeks, against four in 20 today, and never more than five weeks apart — though each person works about two more Saturdays a year. Every week is all earlies or all lates, and 18 of the 21 working weeks keep one shift time Monday to Friday. Nine of the fifteen shift times are ones people already work. And every closing shift is shorter: the weekday and Saturday closers by 30 minutes, the Sunday closer by 45.')

    s = S(9)
    put(s, '6', '5 (up to 6)', GREEN)
    put(s, 'Seven weekends off in 26, at most five weeks apart, and one shift time in 18 of 21 weeks.',
           'Seven weekends off in 26, at most five weeks apart, and never more than five days in a row on the fixed rota.')
    s.save()
    notes(d, 9, 'A full weekend is', 'A full weekend is Saturday and the following Sunday both off. Today that is 4 weekends in a 20-week cycle; Short Run gives 7 in 26, and they are never more than five weeks apart, against seven today. Five is as close as they can be: a full weekend cannot start in a cover week or the week before one, so only 16 of the 26 weeks can begin one. Nobody works more than five days in a row on the fixed rota — today it is seven — and six is the most a badly placed cover week can make it. Every working week is all earlies or all lates — today seven weeks in 16 mix the two — and 18 of the 21 keep the same shift time Monday to Friday. Rest days mostly come in pairs: 22 of the 26 rest-day breaks are two days or more, against 13 of 17 today, and single rest days stay at four, as today. There are no six-day weeks (today there is one).')

    # slide 14 is a real table (one shape, many runs): change the run cell that follows today's "7 (up to 9)"
    p14 = f'{d}/ppt/slides/slide14.xml'; x = open(p14, encoding='utf-8').read()
    i = x.index('<a:t>7 (up to 9)</a:t>'); j = x.index('<a:t>6</a:t>', i)
    if '<a:t>' in x[i + 22:j]: raise SystemExit(f'{p14}: the run cell after today\'s is not the next run')
    open(p14, 'w', encoding='utf-8').write(x[:j] + '<a:t>5 (up to 6)</a:t>' + x[j + len('<a:t>6</a:t>'):])

def managers(d):
    S = lambda n: Slide(f'{d}/ppt/slides/slide{n}.xml')
    notes(d, 5, 'Working weeks average', 'Working weeks average exactly 35 hours Monday to Saturday — 44,100 minutes across the 21 working weeks — so no overtime is needed to balance the Monday-to-Saturday week. Individual weeks range from 24h 30m to 42h 30m — today’s run from 25h 10m to 43h 50m, so the heaviest is lighter than today’s heaviest and the lightest a little lighter than today’s lightest; only the average is the contract, as today. Five cover weeks keep about the same share of the link as today’s four in 20 (one week in 5.2, against one in 5). Sunday is not contracted, so the ten Sunday duties are worked as rest-day overtime, exactly as today’s eight are. The two extra Sunday overtime duties a week come from the Sunday staffing of ten, confirmed verbally — any link that meets the rules needs them. The 26-week link, its five cover weeks and the ceiling of 219 contracted days a year were agreed on 1 October 2026; Short Run gives 218.6.')

    s = S(6); put(s, '6', '5 (up to 6)', GREEN); s.save()

    s = S(7)
    put(s, 'One shift time in 18 of 21 weeks, and the fewest late finishes the rules allow', 'No run over five days on the fixed rota, and the fewest late finishes the rules allow')
    put(s, 'Never more than 6 days in a row — today 7', 'Never more than 5 days in a row on the fixed rota — today 7')
    s.save()
    notes(d, 7, 'This is the case in one slide', 'This is the case in one slide. It meets every December staffing rule and keeps the shift times people already work wherever that cost little — nine of its fifteen are worked today, and none on a Saturday is new. Nobody works more than five days in a row on the fixed rota, where today it is seven; a cover week placed badly can make it six, never more. Every working week is all earlies or all lates, and 18 of the 21 keep one shift time Monday to Friday, where today it is seven weeks in 16. Its seven full weekends off in 26 weeks are never more than five weeks apart, which is as close as the five cover weeks allow; today it is four in 20, up to seven weeks apart. The honest cost is late finishes, and it is the smallest one possible: the December staffing needs three to the close every day, and only those three finish after 23:00, so finishes at 23:00 or later go from about 39 to 42 a year each. Its heaviest week is 42h 30m, against today’s 43h 50m. Every closing shift is 30 to 45 minutes shorter. Six shift times are new.')

    s = S(8)
    s.runs(5, ['7 weekends off, at most 5 weeks apart', 'One shift time in 18 of 21 weeks (today 7 of 16)', 'Every closing shift 30–45 minutes shorter', '9 of the 15 shift times already worked', 'Shortest rest 14h 20m (today 12h 30m)'],
              ['7 weekends off, at most 5 weeks apart', 'Never more than 5 days in a row on the fixed rota (today 7)', 'One shift time in 18 of 21 weeks (today 7 of 16)', 'Every closing shift 30–45 minutes shorter', '9 of the 15 shift times already worked'])
    s.save()
    notes(d, 8, 'Days at work stay', 'Days at work stay at 219 a year (218.6 exactly; Monday to Saturday; Sunday is overtime), under the ceiling agreed on 1 October 2026. Late finishes average about three more a year each, all of them from the December staffing — three to the close every day, where today’s weekdays have two — so no link meeting the same rules on 26 weeks could have fewer. Full weekends off are seven in 26 and never more than five weeks apart; nobody works more than five days in a row on the fixed rota; no week mixes earlies and lates, and 18 of the 21 working weeks keep one shift time. Weekly hours run from 24h 30m to 42h 30m (today 25h 10m to 43h 50m); only the average is the contract. The average shift is about two minutes longer.')

if __name__ == '__main__':
    build(f'{TEMPLATE}/Second-Nature-for-colleagues.pptx', f'{OUT}/Short-Run-for-colleagues.pptx', [sed.colleagues, colleagues])
    build(f'{TEMPLATE}/Second-Nature-for-managers.pptx', f'{OUT}/Short-Run-for-managers.pptx', [sed.managers, managers])
    print('wrote', OUT)
