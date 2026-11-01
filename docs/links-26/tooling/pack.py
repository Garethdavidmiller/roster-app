# THE ONE-DOWNLOAD PACK (2 Oct 2026, owner: "a different zip for the links 26 proposals … matching our folder names").
# Builds docs/links-26/links-26-proposals.zip from the files in this folder, laid out as the 24-line pack was
# (../../links-24/links-24-proposals.zip): a read-me, then summary, rules, presentations, sheets, import files and
# technical notes, in the order a reader wants them. The 24-line pack was zipped by hand, so it went stale whenever a
# sheet was re-rendered; this one is rebuilt by running the script after any re-render:
#   python3 docs/links-26/tooling/pack.py
# Every proposal in regenerate.mjs's SUPPLIED list is packed; a missing file stops the build rather than leaving a
# gap in the pack.
import os, re, zipfile

ROOT = 'docs/links-26'
TOP = 'links-26-proposals'
OUT = f'{ROOT}/{TOP}.zip'

reg = open(f'{ROOT}/tooling/regenerate.mjs', encoding='utf-8').read()
proposals = re.findall(r"name: '([^']+)',\s*code: '([^']+)',\s*fp: '([0-9a-f]{8})'", reg)
if not proposals: raise SystemExit('pack: no proposals in regenerate.mjs SUPPLIED')

files = [  # (source, path in the pack)
    (f'{ROOT}/links-26-summary.pdf', '1 Summary/links-26-summary.pdf'),
    (f'{ROOT}/links-26-shortlist.pdf', '1 Summary/links-26-shortlist.pdf'),
    (f'{ROOT}/links-26-what-it-means.pdf', '1 Summary/links-26-what-it-means.pdf'),   # colleagues: what it means if you… (1 Nov 2026)
    (f'{ROOT}/links-26-rules.pdf', '2 Rules/links-26-rules.pdf'),
]
for name, code, fp in proposals:
    base = f"{name.replace(' ', '-')}-{code}"
    for who in ('colleagues', 'managers'):
        for ext in ('pptx', 'pdf'):
            src = f"{ROOT}/presentations/{name.replace(' ', '-')}-for-{who}.{ext}"
            if os.path.exists(src): files.append((src, f'3 Presentations/{os.path.basename(src)}'))
    files += [(f'{ROOT}/proposals/{base}-{fp}.pdf', f'4 Proposal sheets/{base}-{fp}.pdf'),
              (f'{ROOT}/proposals/{base}-import.txt', f'5 Import files for the Links page/{base}-import.txt')]
files += [(f'{ROOT}/RULES.md', '6 Technical notes/RULES.md'),
          (f'{ROOT}/README.md', '6 Technical notes/README.md')]
missing = [s for s, _ in files if not os.path.exists(s)]
if missing: raise SystemExit(f'pack: missing {missing}')

names = ', '.join(n for n, _, _ in proposals)
# the shortlist and the recommendation are fresh.mjs's, read rather than restated (two on 30 Oct 2026, In Step
# recommended; three since 31 Oct, Even Step recommended): this read-me said "three shortlisted" and "one recommended (Short Run)" in its own words, so it would have
# gone on saying both after the sheets, the summary and the decks had moved on
FRESH = open(f'{ROOT}/tooling/fresh.mjs', encoding='utf-8').read()
SHORTLIST = re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', FRESH).group(1))
RECOMMENDED = re.search(r"export const RECOMMENDED = '([^']+)'", FRESH).group(1)
if not SHORTLIST or any(s not in names.split(', ') for s in SHORTLIST): raise SystemExit(f'pack: shortlist {SHORTLIST} is not all in the pack')
if RECOMMENDED not in SHORTLIST: raise SystemExit(f'pack: the recommendation {RECOMMENDED} is not on the shortlist {SHORTLIST}')
TWENTY = f"3 Presentations/{RECOMMENDED.replace(' ', '-')}-for-managers.pdf"   # the read-me's twenty-minute read
if not any(dst == TWENTY for _, dst in files): raise SystemExit(f'pack: the read-me points at {TWENTY}, which the pack does not hold')
COLLEAGUES_FIRST = f"3 Presentations/{RECOMMENDED.replace(' ', '-')}-for-colleagues.pdf"   # where the colleagues' route starts
WHAT_IT_MEANS = '1 Summary/links-26-what-it-means.pdf'   # and where it ends (1 Nov 2026)
if not any(dst == WHAT_IT_MEANS for _, dst in files): raise SystemExit(f'pack: the read-me points at {WHAT_IT_MEANS}, which the pack does not hold')
# NOT A STALE SHEET (the deep review, 1 Nov 2026): the sheet reads the colleague decks' slide 5 and asserts its £ against them,
# but only when it is rebuilt, so a re-polish followed straight by this script would ship a sheet the decks have moved on
# from. It must be at least as new as every colleague deck (a minute's grace: a fresh checkout writes the files in path
# order, the sheet a moment before the decks)
_sheet = f'{ROOT}/links-26-what-it-means.pdf'
_older = [os.path.basename(s) for s, _ in files if s.endswith('-for-colleagues.pptx') and os.path.getmtime(s) > os.path.getmtime(_sheet) + 60]
if _older: raise SystemExit(f'pack: links-26-what-it-means.pdf is older than {_older}; run what-it-means-sheet.mjs after deck-polish.py')
if not any(dst == COLLEAGUES_FIRST for _, dst in files): raise SystemExit(f'pack: the read-me points at {COLLEAGUES_FIRST}, which the pack does not hold')
# THE RECOMMENDATION IS THE SHORTLIST SHEET'S, SAID SHORTER (1 Nov 2026). The read-me's first paragraph repeats page 2's
# case for Even Step, whose figures that sheet checks (claim() in shortlist-sheet.mjs). The read-me types no figure of
# its own, and refuses to build if the sheet stops saying what it repeats
SHEET = open(f'{ROOT}/tooling/shortlist-sheet.mjs', encoding='utf-8').read()
for said in ['it equals both — days in a row, weekends, weeks on one shift time, late finishes and the leave',
             'Monday to Saturday it alone has no shift over 8h&nbsp;30m', 'every early is one of today’s times',
             'Its costs: weekday lates near today’s', 'a slightly weaker weekday fit', 'change of start (the others']:
    if said not in SHEET: raise SystemExit(f'pack: the read-me repeats the shortlist sheet\'s recommendation, which no longer says "{said}"')
# the count is the SUPPLIED list's, never typed: "Ten candidate links" stayed ten for three designs (26 Oct 2026)
# FOUR SENTENCES BELOW NAME MEMBERS, AND ARE CHECKED (30 Oct 2026 review; Even Step's added 31 Oct): the 26 Oct paragraph
# says none of its three is on the shortlist, the In Step paragraph that In Step is, the Even Step paragraph that Even Step
# is and is the recommendation, and item 5 that every shortlisted design is built into the app. Each reads the names it was
# typed with, so a change to SHORTLIST would otherwise leave the read-me contradicting its own first line.
if {'Home Grown', 'Closing Time', 'Both Ways'} & set(SHORTLIST):
    raise SystemExit(f'pack: the read-me says none of the 26 Oct three is shortlisted; SHORTLIST is {SHORTLIST}')
if 'In Step' not in SHORTLIST:   # the 30 Oct paragraph below says it is
    raise SystemExit(f'pack: the read-me says In Step is shortlisted; SHORTLIST is {SHORTLIST}')
if 'Even Step' not in SHORTLIST or RECOMMENDED != 'Even Step':   # the 31 Oct paragraph below says it is both, and the recommendation is its case
    raise SystemExit(f'pack: the read-me says Even Step is shortlisted and recommended; SHORTLIST is {SHORTLIST}, RECOMMENDED {RECOMMENDED}')
built_in = open('links-proposals.js', encoding='utf-8').read()
missing = [n for n, c, _ in proposals if n in SHORTLIST and f"code: '{c}'" not in built_in]
if missing: raise SystemExit(f'pack: the read-me says every shortlisted design is built into the app; links-proposals.js lacks {missing}')
WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()
with_decks = sorted((n for n, _, _ in proposals if os.path.exists(f"{ROOT}/presentations/{n.replace(' ', '-')}-for-colleagues.pptx")),
                    key=lambda n: SHORTLIST.index(n) if n in SHORTLIST else len(SHORTLIST))   # the shortlist's order, recommendation first
if set(with_decks) != set(SHORTLIST):   # owner, 3 Oct 2026: "only keep the shortlist's presentations, delete the rest"
    raise SystemExit(f'pack: presentations for {with_decks}, shortlist {SHORTLIST}')
# THE READ-ME IS WRAPPED BY CODE (4 Oct 2026, outside review): it opens in Notepad, so every line is at most 78
# columns, both lists hang at the same column, and a paragraph edited later cannot come out ragged.
import textwrap
W = 78
# A NAME IS NEVER SPLIT (1 Nov 2026): no wrap at a hyphen, so Even-Step-for-colleagues.pdf stays whole, and none inside a
# folder's name, so "4 Proposal sheets" never ends one line and starts the next. The folders are the pack's own, read from
# the file list; their spaces are held as a placeholder of the same width while the text is wrapped
FOLDERS = sorted({dst.split('/')[0] for _, dst in files if '/' in dst and ' ' in dst.split('/')[0]})
# AND NO NAME, DATE OR VERSION EITHER (pack polish, 1 Nov 2026): the outside review found "Even / Step", "Home / Grown",
# "(3 October / 2026)" and "app version / 25.04" split at line ends, and a line beginning "- with the shift times", which in
# Notepad reads as a bullet. A design's name, a date and a version are held like a folder's name, and a spaced dash keeps to
# the word before it, so it ends a line and never starts one
NAMES = sorted({n for n, _, _ in proposals}, key=len, reverse=True)
MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
TITLES = ['"What it means if you..."']   # a document's title is a name too (the deep review, 1 Nov 2026: "What it / means if you...")
def whole(t):
    for f in FOLDERS + NAMES + TITLES: t = t.replace(f, f.replace(' ', '\x00'))
    t = re.sub(rf'\b\d{{1,2}} (?:{MONTHS})(?: \d{{4}})?', lambda m: m.group(0).replace(' ', '\x00'), t)
    t = re.sub(r'\bapp version (?=\d)', 'app\x00version\x00', t)
    return t.replace(' - ', '\x00- ')
para = lambda t: textwrap.fill(whole(' '.join(t.split())), W, break_on_hyphens=False).replace('\x00', ' ')
def item(label, text, hang=21):
    return textwrap.fill(whole(' '.join(text.split())), W, initial_indent=f'  {label:<{hang - 2}}', subsequent_indent=' ' * hang,
                         break_on_hyphens=False).replace('\x00', ' ')
# the colour key: the mark at column 24, its words at 36, so a long description cannot run into the next mark (pack polish)
def mark_item(label, text):
    return textwrap.fill(whole(' '.join(text.split())), W, initial_indent=' ' * 24 + f'{label:<12}', subsequent_indent=' ' * 36,
                         break_on_hyphens=False).replace('\x00', ' ')
decks = (', '.join(with_decks[:-1]) + ' and ' + with_decks[-1]) if len(with_decks) > 1 else (with_decks[0] if with_decks else 'None yet')
# THE ROUTE FIRST, THE HISTORY LAST (the fifth review's follow-up, 1 Nov 2026): "The history interrupts the route into the pack. A
# new reader needs the current recommendation, what they are being asked to decide, and which file to open." And
# colleagues start with their presentation, "the proposal sheet and rota should follow as supporting detail". So the
# read-me opens on the recommendation, the two asks and the two routes in, then what is still open and what each folder
# holds; how the shortlist came about follows, its paragraphs and their checks unchanged. Every file the route names
# starts a line of its own, so no wrap splits a name.
names_in = {n for n, _, _ in proposals}
readme = '\n'.join([
    'DECEMBER 2026 LINK PROPOSALS - 26 LINES',
    '=' * len('DECEMBER 2026 LINK PROPOSALS - 26 LINES'),
    'Marylebone CEA link, December 2026 timetable - 26 weeks',   # no date: office detail (owner, of slide 9's)
    '',
    'THE RECOMMENDATION',
    para(f'{RECOMMENDED}. {WORDS[len(proposals)].capitalize()} candidate links were drawn up and {WORDS[len(SHORTLIST)]} '
         f'shortlisted: {", ".join(SHORTLIST[:-1])} and {SHORTLIST[-1]}. On what weighs most here Even Step equals the '
         'other two - days in a row, weekends, weeks on one shift time, late finishes and leave. Monday to Saturday it '
         'alone has no shift over 8h 30m, and every early is one of today\'s times. What it gives up against the other '
         'two: weekday lates nearly as long as today\'s, a slightly weaker weekday fit to the trains, and start times '
         'that change more from week to week. Page 2 of the shortlist sheet sets out the case, and the costs.'),
    '',
    'WHAT IS ASKED',
    item('Managers', f'Which of the {WORDS[len(SHORTLIST)]} shortlisted links goes to colleagues for their views.'),
    item('Colleagues', 'What worries you about the chosen link, even if it is small. It goes to the managers with '
         'the proposal.'),
    '',
    'WHERE TO START',
    item('Managers', 'Ten minutes: the shortlist sheet,'),
    ' ' * 23 + '1 Summary/links-26-shortlist.pdf',
    item('', 'Twenty minutes: add the presentation for managers,'),
    ' ' * 23 + TWENTY,
    item('Colleagues', 'First, the presentation for colleagues,'),
    ' ' * 23 + COLLEAGUES_FIRST,
    item('', f'(or the chosen link\'s, if it is not {RECOMMENDED}). Then pages 1 to 3 of its proposal sheet, in '
         '4 Proposal sheets: the detail, and every week of the link on page 3.'),
    item('', 'Last, the one-page sheet on what it means if you prefer earlies or lates, swap for overtime, work your '
         'share of Sundays or no overtime at all, or save leave for long breaks,'),
    ' ' * 23 + WHAT_IT_MEANS,
    '',
    'STILL OPEN',
    para('Where the 13-day limit is written down, and how one fatigue factor (FF19, marked "definition to confirm" on '
         'the rules page) treats a rest day. The staffing levels and Sunday cover behind the rules were confirmed '
         'verbally, and are worth having in writing. The figures are computed from the rotas and will not move unless '
         'a rule does.'),
    '',
    'WHAT IS IN THE PACK',
    item('1 Summary', f'The two-page shortlist sheet - the {WORDS[len(SHORTLIST)]} shortlisted designs against each other '
         'and today, with the recommendation. A one-page sheet for colleagues, "What it means if you...", on what each '
         'shortlisted link means for someone who prefers earlies or lates, swaps earlies for lates, works their share '
         'of Sundays or no overtime, or saves leave for long breaks. And one page with every proposal against today\'s '
         'link: its print is small, so read it on screen, zoomed in, or print it at A3. It is a reference, not a page '
         'to present.'),
    item('2 Rules', 'The three tiers of rule, two pages: the hard limits (three, and the ceiling of 219 contracted days '
         'a year, which is hard too), the nine December 2026 rules scored on every sheet, and three flexible rules '
         'aimed for when designing (14 on a Saturday, five cover weeks as evenly spaced as 26 weeks allow, and '
         'weekday closers starting at 15:45 or later).'),
    item('3 Presentations', f'{decks}: one for colleagues and one for managers{" each" if len(with_decks) > 1 else ""}. '
         'PowerPoint and PDF copies of each. The PowerPoints use the Inter font; if the PC showing them does not have '
         'Inter, present the PDF instead.'),
    item('4 Proposal sheets', 'One eight-page PDF per proposal, compared only with today\'s link: pages 1 and 2 are the '
         'plain-English comparison, page 3 the rota, the rest the evidence managers can inspect. The marks mean the '
         'same on every page:'),
    mark_item('green tick', 'meets a rule, or better than today on something the rules, the limits or the fatigue '
              'guidance aim for, or on a plain gain such as full weekends off'),
    mark_item('amber', 'worse than today on one of those'),
    mark_item('red cross', 'a rule or limit broken'),
    mark_item('no colour', 'a matter of preference'),
    item('', 'The code and eight-character fingerprint in each file name identify the exact rota, so a printout can '
         'never be mixed up with a variant.'),
    item('5 Import files', 'Each proposal as text for the Links page (Import), which lays out 26 lines since app version '
         '24.47 (3 October 2026) and re-runs the hard limits, the fatigue checks, the weekends, the hours and the hour-by-hour staffing on whatever is pasted in; the December rules and the yearly figures are the sheets\' own. The '
         f'{WORDS[len(SHORTLIST)]} shortlisted designs are built into the app\'s Links designer as examples, for reference '
         f'(these {WORDS[len(SHORTLIST)]} since app version 25.04).'),
    item('6 Technical notes', 'The 26-line rules with what changed from 24, and how the proposals were built and '
         'checked. Written for the technical record, not for reading out.'),
    '',
    para(f'Proposals in this pack: {names}.'),
    '',
    'HOW THE SHORTLIST CAME ABOUT',
    *([para('The first shortlist, on 3 October 2026, was Second Edition, Short Run and Even Keel, with Short Run '
            'recommended.'), ''] if {'Second Edition', 'Short Run', 'Even Keel'} <= names_in else []),
    *([para('Home Grown, Closing Time and Both Ways (26 October 2026) answer a later question: today\'s link on 26 lines, '
            'keeping as many of its shift times as it can, with a 13:35 or 13:45 finish every weekday and the weekday closer at 16:00. Each pays for '
            'the short finishes a different way; the technical notes compare them. Closing Time, improved on 27 and 30 '
            'October, was shortlisted on 30 October until the shortlist was cut to two the same day; the other two '
            'were never on it.'), '']
      if {'Home Grown', 'Closing Time', 'Both Ways'} <= names_in else []),
    *([para('In Step (30 October 2026) answers the next question: whether Closing Time could have five on at the Saturday '
            'open and follow the weekday trains more closely. It keeps Closing Time\'s weeks and a 13:45 finish every '
            'weekday, with the closer at 15:45 instead of 16:00. The same day the shortlist was cut to two: In Step, '
            'recommended then, and Short Run, on it since 3 October (Second Edition, Even Keel and Closing Time left it).'), '']
      if 'In Step' in names_in else []),
    *([para('Even Step (31 October 2026) answers the one thing about In Step expected to be hard to sell: the length of its '
            'main weekday earlies, 8h 55m and 8h 45m. It keeps In Step\'s weeks - the same rest days, weekends and early '
            'and late weeks - with the shift times chosen again. It joined the shortlist the same day, beside In Step '
            'and Short Run, and is the one recommended.'), '']
      if 'Even Step' in names_in else []),
    para('The link was 24 weeks until 1 October 2026; that work is kept in its own pack, links-24-proposals.zip, for '
         'reference.'),
    '',
    'HOW THE FIGURES ARE WORKED OUT',
    para('Every figure in the summary, the shortlist sheet, the "What it means if you..." sheet, the rules sheet and the '
         'proposal sheets was worked out from '
         'the rotas, by the Marylebone Roster app\'s own checks and the tooling beside them; what is typed by hand is the '
         'rules\' own numbers and the one-line description under each design\'s name. The presentations are built by '
         'scripts, and every figure in their tables is checked against those counts (docs/links-26/tooling/deck-check.mjs '
         'in the repository).'),
    '',
])
assert all(len(l) <= W for l in readme.split('\n')), [l for l in readme.split('\n') if len(l) > W]
# and no name split across two lines: each file the route names is whole on a line, and no folder's name breaks
for path in ['1 Summary/links-26-shortlist.pdf', TWENTY, COLLEAGUES_FIRST, WHAT_IT_MEANS]:
    if not any(l.strip() == path for l in readme.split('\n')):
        raise SystemExit(f'pack: the read-me does not give {path} a line of its own, so a wrap can split it')
for f in FOLDERS:
    w = f.split(' ')
    for k in range(1, len(w)):
        if re.search(re.escape(' '.join(w[:k])) + r'\n *' + re.escape(' '.join(w[k:])), readme):
            raise SystemExit(f'pack: the read-me splits the folder name "{f}" across lines')


if os.path.exists(OUT): os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f'{TOP}/Read me first.txt', readme.replace('\n', '\r\n'))   # CRLF: an older Notepad shows LF-only text as one line
    for src, dst in files: z.write(src, f'{TOP}/{dst}')
print(f'wrote {OUT}: {len(files) + 1} files')
