# THE ONE-DOWNLOAD PACK (2 Oct 2026, owner: "a different zip for the links 26 proposals … matching our folder names").
# Builds docs/links-26/links-26-proposals.zip from the files in this folder, laid out as the 24-line pack was
# (../../links-24/links-24-proposals.zip): a read-me, then summary, rules, presentations, sheets, import files and
# technical notes, in the order a reader wants them. The 24-line pack was zipped by hand, so it went stale whenever a
# sheet was re-rendered; this one is rebuilt by running the script after any re-render:
#   python3 docs/links-26/tooling/pack.py
# Every proposal in regenerate.mjs's SUPPLIED list is packed; a missing file stops the build rather than leaving a
# gap in the pack.
# THE ZIP IS NOT COMMITTED (owner, 3 Nov 2026: "build it on demand"). It was re-committed with every change to the
# pack, and each copy added ~15 MB to the repository's history for good — sixteen times by then. The repository
# ignores *.zip; run this script and send the file to whoever needs it. Never `git add -f` it.
import os, re, zipfile

ROOT = 'docs/links-26'
TOP = 'links-26-proposals'
OUT = f'{ROOT}/{TOP}.zip'

reg = open(f'{ROOT}/tooling/regenerate.mjs', encoding='utf-8').read()
found = re.findall(r"name: '([^']+)',\s*code: '([^']+)',\s*fp: '([0-9a-f]{8})'(?:,\s*dir: '([^']+)')?", reg)
if not found: raise SystemExit('pack: no proposals in regenerate.mjs SUPPLIED')
proposals = [(n, c, f) for n, c, f, _ in found]
# THE PACK'S FOLDERS (4 Nov 2026, owner: "Put all of the links that give 30 days off for 14 days AL into a subfolder within
# links 26"). A design ships into proposals/ unless its SUPPLIED entry names another of report-data.mjs's PACK_DIRS, read
# here as the other lists are; in the zip the 30-day folder is a folder of its own inside the sheets and the import files
PACK_DIRS = re.findall(r"'([^']+)'", re.search(r"export const PACK_DIRS = \[([^\]]*)\]", open(f'{ROOT}/tooling/report-data.mjs', encoding='utf-8').read()).group(1))
DIR_OF = {c: (d or 'proposals') for _, c, _, d in found}
if any(d not in PACK_DIRS for d in DIR_OF.values()): raise SystemExit(f'pack: a SUPPLIED folder is not one of PACK_DIRS {PACK_DIRS}: {DIR_OF}')
IN_ZIP = {'proposals': '', '30-days-off': '30 days off/'}   # each folder's place inside "4 Proposal sheets" and "5 Import files"
if set(IN_ZIP) != set(PACK_DIRS): raise SystemExit(f'pack: IN_ZIP {sorted(IN_ZIP)} does not name every one of PACK_DIRS {PACK_DIRS}')

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
    d = DIR_OF[code]
    files += [(f'{ROOT}/{d}/{base}-{fp}.pdf', f'4 Proposal sheets/{IN_ZIP[d]}{base}-{fp}.pdf'),
              (f'{ROOT}/{d}/{base}-import.txt', f'5 Import files for the Links page/{IN_ZIP[d]}{base}-import.txt')]
# THE TECHNICAL NOTES ARE RULES.md ALONE (owner, 5 Nov 2026: "Leave it out of the pack"). README.md is this folder's working
# record — every design's history, the tooling, the league — written for whoever rebuilds the pack rather than for a reader
# of it, and it had come to say things the pack does not. It stays in the repository, where the read-me's history points
files += [(f'{ROOT}/RULES.md', '6 Technical notes/RULES.md')]
missing = [s for s, _ in files if not os.path.exists(s)]
if missing: raise SystemExit(f'pack: missing {missing}')

names = ', '.join(n for n, _, _ in proposals)
# the shortlist is fresh.mjs's, read rather than restated: this read-me once said "three shortlisted" and "one recommended
# (Short Run)" in its own words, so it would have gone on saying both after the sheets, the summary and the decks had moved on
FRESH = open(f'{ROOT}/tooling/fresh.mjs', encoding='utf-8').read()
SHORTLIST = re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', FRESH).group(1))
# NO RECOMMENDATION, AND A TO Z (owner, 5 Nov 2026: "Remove the marks"). From 3 Oct 2026 the read-me opened on "THE
# RECOMMENDATION" — Short Run, then In Step, then Even Step — and sent both audiences through that design's presentations.
# It now presents the three evenly, in the order every other surface uses. A RECOMMENDED back in fresh.mjs, or a shortlist
# out of order, stops the build rather than tilting the read-me again
if re.search(r'export const RECOMMENDED\b', FRESH): raise SystemExit('pack: fresh.mjs exports RECOMMENDED again; the pack names no recommendation (owner, 5 Nov 2026)')
if SHORTLIST != sorted(SHORTLIST): raise SystemExit(f'pack: the shortlist is listed A to Z everywhere; fresh.mjs lists {SHORTLIST}')
# THE DECKS KEPT OFF THE SHORTLIST (5 Nov 2026, owner: "keep the other presentations in the pack, just not the shortlist"):
# In Step's, from when it was shortlisted; and the day the shortlist was drawn, which the read-me says
DECKS_KEPT = re.findall(r"'([^']+)'", re.search(r'export const DECKS_KEPT = \[([^\]]*)\]', FRESH).group(1))
SHORTLIST_DATE = re.search(r"export const SHORTLIST_DATE = '([^']+)'", FRESH).group(1)
if not SHORTLIST or any(s not in names.split(', ') for s in SHORTLIST): raise SystemExit(f'pack: shortlist {SHORTLIST} is not all in the pack')
# WHERE EACH AUDIENCE STARTS: the shortlisted designs' presentations, A to Z — a manager reads all three, a colleague the
# chosen link's — and the one-page sheet last
MANAGERS = [f"3 Presentations/{n.replace(' ', '-')}-for-managers.pdf" for n in SHORTLIST]
COLLEAGUES = [f"3 Presentations/{n.replace(' ', '-')}-for-colleagues.pdf" for n in SHORTLIST]
WHAT_IT_MEANS = '1 Summary/links-26-what-it-means.pdf'   # 1 Nov 2026
for path in MANAGERS + COLLEAGUES + [WHAT_IT_MEANS]:
    if not any(dst == path for _, dst in files): raise SystemExit(f'pack: the read-me points at {path}, which the pack does not hold')
# NOT A STALE SHEET (the deep review, 1 Nov 2026): the sheet reads the colleague decks' slide 5 and asserts its £ against them,
# but only when it is rebuilt, so a re-polish followed straight by this script would ship a sheet the decks have moved on
# from. It must be at least as new as every colleague deck (a minute's grace: a fresh checkout writes the files in path
# order, the sheet a moment before the decks)
_sheet = f'{ROOT}/links-26-what-it-means.pdf'
_older = [os.path.basename(s) for s, _ in files if s.endswith('-for-colleagues.pptx') and os.path.getmtime(s) > os.path.getmtime(_sheet) + 60]
if _older: raise SystemExit(f'pack: links-26-what-it-means.pdf is older than {_older}; run what-it-means-sheet.mjs after deck-polish.py')
# WHO TO TELL (owner, 5 Nov 2026: "Match the New link page"). The colleagues' ask is the page's and the colleague decks' last
# slide's, and the name and role are newlink-config.js's, read as deck-polish.py reads them
CFG = open('newlink-config.js', encoding='utf-8').read()
CONTACT = re.search(r"export const CONTACT = '([^']+)'", CFG).group(1)
CONTACT_ROLE = re.search(r"export const CONTACT_ROLE = '([^']+)'", CFG).group(1)
if 'Tell ${CONTACT} or your manager what worries you' not in CFG:
    raise SystemExit('pack: the New link page no longer says "Tell <contact> or your manager what worries you", which the read-me repeats')
# EACH ONE'S EDGE AND ITS PRICE, SAID SHORTER (5 Nov 2026). The read-me's first section repeats the shortlist sheet's "How to
# choose", whose figures that sheet checks (claim() in shortlist-sheet.mjs), and the few figures it types are the New link
# page's own sentences, each asserted against the rotas by newlink-data.mjs. It refuses to build if either source stops
# saying what it repeats. (Until 5 Nov the figures were checked against the sheet's template text alone, which pins the
# sentence and not the number.)
SHEET = open(f'{ROOT}/tooling/shortlist-sheet.mjs', encoding='utf-8').read()
# THE 22:30 OFFICE (6 Nov 2026): Common Ground has no shift over 8h 30m on any day, alone of the three, so Even Step's choice is
# today's earlies and steady weeks rather than "no long days"; and Common Ground leads the league, which the 6 Nov paragraph says
for said in ['is the one to choose for something different',
             '<b>Choose Common Ground</b> if keeping today’s leave, or no shift over 8h&nbsp;30m on any day, matters most',
             'no shift over 8h&nbsp;30m on any day, alone of the three',
             '<b>Choose Even Step</b> if keeping today’s earlies and steady weeks matters most',
             'Every early from Monday to Saturday one of today’s times, no shift there over 8h&nbsp;30m',
             '<b>Choose Short Run</b> if the weekday fit and short weekday lates matter most', 'a weaker weekday fit',
             'the biggest change of start',
             'Common Ground, as the example of the links that keep today’s leave; Even Step, then first in the pack’s league; Short Run, which colleagues have seen',
             'Since the Saturday ticket office lates moved to 22:30, ${LEADER} is first, about a point and a half ahead of Even Step']:
    if said not in SHEET: raise SystemExit(f'pack: the read-me repeats the shortlist sheet, which no longer says "{said}"')
PAGE = open('newlink-data.js', encoding='utf-8').read().replace('\\u00a0', ' ')
for said in ['four full weeks off, Sunday to Saturday, for 14 days, and 30 days off for 14 at best',
             'The price on Common Ground is more single rest days: about 12 a year, where the other two have about 8',
             'Common Ground has nothing over 8h 30m on any day, and Even Step nothing over 8h 30m from Monday to Saturday',
             'Short Run has 9-hour weekday earlies and an 8h 40m Saturday closer',
             'On all three, the two Saturday ticket-office lates finish at 22:30, to cash up after the office shuts at 22:10',
             'Short Run has no shift finishing at 13:35 or 13:45', 'On Even Step and Short Run four weeks off take 15']:
    if said not in PAGE: raise SystemExit(f'pack: the read-me repeats the New link page, which no longer says "{said}"')
# the count is the SUPPLIED list's, never typed: "Ten candidate links" stayed ten for three designs (26 Oct 2026)
# SENTENCES BELOW NAME MEMBERS, AND ARE CHECKED (30 Oct 2026 review; Even Step's added 31 Oct; the 5 Nov redraw): the 26 Oct
# paragraph says none of its three is on the shortlist; the 5 Nov paragraph, and the first section, name the three and say In
# Step left it and its decks stay; the Even Step paragraph says Even Step joined it; and item 5 says every shortlisted design
# is built into the app. Each reads the names it was typed with, so a change to SHORTLIST would otherwise leave the read-me
# contradicting itself.
if {'Home Grown', 'Closing Time', 'Both Ways'} & set(SHORTLIST):
    raise SystemExit(f'pack: the read-me says none of the 26 Oct three is shortlisted; SHORTLIST is {SHORTLIST}')
if 'In Step' in SHORTLIST or DECKS_KEPT != ['In Step']:   # the 5 Nov paragraph below says it left the shortlist and its decks stay
    raise SystemExit(f'pack: the read-me says In Step left the shortlist and its presentations stay; SHORTLIST is {SHORTLIST}, DECKS_KEPT {DECKS_KEPT}')
if SHORTLIST != ['Common Ground', 'Even Step', 'Short Run'] or SHORTLIST_DATE != '5 Nov 2026':   # the first section and the 5 Nov paragraph name the three
    raise SystemExit(f'pack: the read-me says Common Ground, Even Step and Short Run were shortlisted on 5 November 2026; SHORTLIST is {SHORTLIST}, drawn {SHORTLIST_DATE}')
# THE THREE THAT CAME AFTER THE SHORTLIST (3 Nov 2026, owner: add Clean Slate and Next Step to the pack, the shortlist and the
# recommendation unchanged). Read from fresh.mjs's FIRST, as the shortlist sheet reads them: every design first drawn after
# the last shortlisted one. The 3 Nov paragraph below says none is shortlisted and says what each is, so it refuses any
# other set, and a shortlist that takes one of them in
import datetime
FIRST = dict(re.findall(r"'([A-Z]{2}-26-[A-Z0-9]+)': '([^']+)'", re.search(r'export const FIRST = \{([^}]*)\}', FRESH).group(1)))
_day = lambda code: datetime.datetime.strptime(FIRST[code], '%d %b %Y')
_drawn = max(_day(c) for n, c, _ in proposals if n in SHORTLIST)
LATE = sorted(n for n, c, _ in proposals if _day(c) > _drawn)   # none since 5 Nov 2026: the shortlist was drawn after every design
# THE DESIGNS DRAWN AFTER THE SHORTLIST OF 31 OCT 2026 (Even Step's day), which the history below describes; the shortlist of
# 5 Nov 2026 took one of them in, Common Ground
AFTER_31_OCT = sorted(n for n, c, _ in proposals if _day(c) > datetime.datetime(2026, 10, 31))
# Fair Share joined on 4 Nov 2026 (owner: "add fair share to the repo"): Next Step with an even Sunday. The paragraph says
# what it is too, so it is in the one set this accepts. So are the day's other three (owner, 4 Nov 2026: "Do a proposal
# sheet for all of today's work. Put them into the repo"): Quarter Past, a one-page roster drawn outside the app, and the
# two laid from its duties, Quarter Past Relaid and Short Openers; the paragraph names each and what it is
# Quarter Past Relaid was renamed Open Return, and Fair Share's 30-day search result joined as Grand Tour, the same day
# (owner: "Give all proposals individual names")
# Quarter Past was taken out the same evening (owner: "Remove quarter past from the pack please"), and Well Kept, drawn up on
# 26 Oct 2026 as Same Again Tidy, joined the 30-day folder; it was taken out on 5 Nov 2026 (owner: "Remove well kept"). Both
# were deleted on 6 Nov 2026 (DELETED, below)
# Common Ground joined the same day on main (owner: "give this new proposal a better name and create the sheet and put it in
# the pack"): today's link taken to 26 weeks on the owner's brief, on Grand Tour's weeks. It buys 30 days off for 14 days'
# leave, so it is in the 30-day folder too, and it is a late design
# Middle Ground joined on 5 Nov 2026 (owner: "rename good turn as Middle Ground and add it to the pack"), after the shortlist of
# that day: Common Ground's weeks with the shift times varied from week to week. It is the one design after the 5 Nov shortlist,
# and it buys 30 days off for 14 days' leave, so it is in the 30-day folder; its own paragraph follows the 5 Nov one
# Balanced V5 and Balanced V6 joined on 6 Nov 2026 (owner: "Balanced v5 and Relief Point need adding to the pack, but can you
# rename Relief Point as Balanced v6"), both drawn on 5 Nov 2026, after the shortlist: a one-page roster drawn up outside the
# app, and a 15-minute weekday handover drawn from it. Both buy 30 days off for 14 days' leave, so both are in the 30-day
# folder; the late paragraph describes each on its own terms, as it does Middle Ground
AFTER_31_OCT_SET = ['Balanced V5', 'Balanced V6', 'Clean Slate', 'Common Ground', 'Fair Share', 'Grand Tour', 'Middle Ground', 'Next Step', 'Open Return', 'Short Openers']
LATE_SET = ['Balanced V5', 'Balanced V6', 'Middle Ground']
if LATE and LATE != LATE_SET:
    raise SystemExit(f'pack: the read-me describes {", ".join(LATE_SET)} as the designs after the shortlist; they are {LATE}')
if AFTER_31_OCT != AFTER_31_OCT_SET:
    raise SystemExit(f'pack: the read-me describes {", ".join(AFTER_31_OCT_SET)} as drawn up after 31 October 2026; they are {AFTER_31_OCT}')
LATE_WORDS = ', '.join(LATE[:-1]) + ' and ' + LATE[-1] if len(LATE) > 1 else ''.join(LATE)   # three since 4 Nov: 'A, B and C', never 'A and B and C'
# DELETED, 6 NOV 2026 (owner: "Permanently delete well kept, quarter past, the four second designs, quiet friday, little and
# often and same again"). Nine designs that had left the pack, or were never in it, are gone from the repository: grids,
# metas and their own search files (README.md -> "Nine designs deleted"). Until then the read-me named six of them as
# withdrawn or taken out, with their record "kept in the repository"; it now names none. Refused if one is back in SUPPLIED,
# and refused if the read-me names one, so a deleted design cannot come back unnoticed
DELETED = ['Second Nature', 'Second Wind', 'Second Sight', 'Second Gear', 'Quiet Friday', 'Same Again', 'Little and Often',
           'Quarter Past', 'Well Kept']   # Same Again Tidy was Well Kept; 'Same Again' also catches its name
if any(n in names.split(', ') for n in DELETED):
    raise SystemExit(f'pack: {DELETED} were deleted on 6 Nov 2026; regenerate.mjs SUPPLIED lists one of them')
# THE 30-DAY FOLDER, NAMED IN FULL (4 Nov 2026): the paragraph lists what is in it, so the list is the folder's, read from SUPPLIED
THIRTY_SET = ['Balanced V5', 'Balanced V6', 'Common Ground', 'Grand Tour', 'Middle Ground', 'Open Return', 'Short Openers']
THIRTY_IN = sorted(n for n, c, _ in proposals if DIR_OF[c] == '30-days-off')
if THIRTY_IN != THIRTY_SET:
    raise SystemExit(f'pack: the read-me names {THIRTY_SET} as the 30-day folder; regenerate.mjs puts {THIRTY_IN} there')
built_in = open('links-proposals.js', encoding='utf-8').read()
missing = [n for n, c, _ in proposals if n in SHORTLIST and f"code: '{c}'" not in built_in]
if missing: raise SystemExit(f'pack: the read-me says every shortlisted design is built into the app; links-proposals.js lacks {missing}')
# to thirty since 6 Nov 2026: twenty-one designs ran off the end of a list that stopped at twenty
WORDS = ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty '
         'twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty').split()
ORDER = SHORTLIST + DECKS_KEPT   # the shortlist's order, A to Z, then the decks kept off it
with_decks = sorted((n for n, _, _ in proposals if os.path.exists(f"{ROOT}/presentations/{n.replace(' ', '-')}-for-colleagues.pptx")),
                    key=lambda n: ORDER.index(n) if n in ORDER else len(ORDER))
# owner, 3 Oct 2026: "only keep the shortlist's presentations, delete the rest"; and 5 Nov 2026: "keep the other presentations
# in the pack, just not the shortlist" — the shortlist's and In Step's, which was on it until that day
if with_decks != ORDER:
    raise SystemExit(f'pack: presentations for {with_decks}; the shortlist {SHORTLIST} and the decks kept {DECKS_KEPT}')
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
    for f in FOLDERS + NAMES + TITLES + [CONTACT]: t = t.replace(f, f.replace(' ', '\x00'))   # nor a person's (5 Nov 2026: "S. / Silva")
    t = re.sub(rf'\b\d{{1,2}} (?:{MONTHS})(?: \d{{4}})?', lambda m: m.group(0).replace(' ', '\x00'), t)
    t = re.sub(r'\bapp version (?=\d)', 'app\x00version\x00', t)
    t = re.sub(r'\b\d{1,2}h \d{2}m\b', lambda m: m.group(0).replace(' ', '\x00'), t)   # nor a duration (4 Nov 2026: "8h / 10m")
    return t.replace(' - ', '\x00- ')
para = lambda t: textwrap.fill(whole(' '.join(t.split())), W, break_on_hyphens=False).replace('\x00', ' ')
def item(label, text, hang=21):
    return textwrap.fill(whole(' '.join(text.split())), W, initial_indent=f'  {label:<{hang - 2}}', subsequent_indent=' ' * hang,
                         break_on_hyphens=False).replace('\x00', ' ')
# the colour key: the mark at column 22, its words at 38, so a long description cannot run into the next mark (pack polish;
# moved left on 5 Nov 2026, when "amber" became "amber triangle", the sheets' own name for the mark)
def mark_item(label, text):
    return textwrap.fill(whole(' '.join(text.split())), W, initial_indent=' ' * 21 + f'{label:<16}', subsequent_indent=' ' * 37,
                         break_on_hyphens=False).replace('\x00', ' ')
andl = lambda a: (', '.join(a[:-1]) + ' and ' + a[-1]) if len(a) > 1 else (a[0] if a else 'None yet')
decks = andl(SHORTLIST) + (f', the shortlist, and {andl(DECKS_KEPT)}, kept from when it was on the shortlist' if DECKS_KEPT else '')
# THE ROUTE FIRST, THE HISTORY LAST (the fifth review's follow-up, 1 Nov 2026): "The history interrupts the route into the pack. A
# new reader needs the current recommendation, what they are being asked to decide, and which file to open." And
# colleagues start with their presentation, "the proposal sheet and rota should follow as supporting detail". So the
# read-me opens on the shortlist (since 5 Nov 2026 the three evenly, each with its edge and its price, and no
# recommendation), the two asks and the two routes in, then what is still open and what each folder holds; how the
# shortlist came about follows. Every file the route names starts a line of its own, so no wrap splits a name.
names_in = {n for n, _, _ in proposals}
readme = '\n'.join([
    'NEW CEA LINK PROPOSALS - 26 LINES',
    '=' * len('NEW CEA LINK PROPOSALS - 26 LINES'),
    # The START date is said; the date the 26 lines were set is not (office detail, owner, of slide 9's). The link starts on
    # 1 January 2027, after the timetable changes in December (owner, 2 Nov 2026), and was "December 2026" here until then.
    'Marylebone CEA link from 1 January 2027 - 26 weeks',
    '',
    # THE SATURDAY OFFICE, SAID FIRST (6 Nov 2026, the external review: "Give the Saturday correction one prominent
    # sentence ... Bring a short version forward"). The whole account stays in how the shortlist came about, below
    para('Saturday ticket-office lates finish at 22:30 on every link here, so that the office can cash up after it shuts '
         'at 22:10 (corrected on 6 November 2026). On the links drawn before then the extra time comes off other Saturday '
         'lates, so the contracted hours are unchanged.'),
    '',
    'THE SHORTLIST',
    para(f'{WORDS[len(proposals)].capitalize()} candidate links were drawn up and {WORDS[len(SHORTLIST)]} shortlisted. They '
         'are listed A to Z, and none is recommended: each is the one to choose for something different.'
         + (f' {LATE_WORDS} came after the shortlist; see how the shortlist came about, below.' if LATE else '')),
    item('Common Ground', 'If keeping today\'s leave matters most, or no shift over 8h 30m on any day: four full weeks '
         'off, Sunday to Saturday, for 14 days\' leave, and 30 days off for 14 at best. The price: more single rest days, '
         'about 12 a year where the other two have about 8, and a weaker weekday fit.'),
    item('Even Step', 'If keeping today\'s earlies and steady weeks matters most: every early from Monday to Saturday one '
         'of today\'s times, and nothing over 8h 30m there. The price: the biggest change of start from week to week of the '
         'three, and four weeks off take 15 days\' leave.'),
    item('Short Run', 'If the weekday fit and short weekday lates matter most. The price: 9-hour weekday earlies and an '
         '8h 40m Saturday closer, no shift finishing at 13:35 or 13:45, and four weeks off take 15 days\' leave.'),
    para('Page 2 of the shortlist sheet sets out each one\'s edge and its costs in full.'),
    '',
    'WHAT IS ASKED',
    item('Managers', f'Which of the {WORDS[len(SHORTLIST)]} shortlisted links goes to colleagues for their views.'),
    item('Colleagues', f'Tell {CONTACT} or your manager what worries you about the chosen link, even if it is small. '
         f'{CONTACT}, {CONTACT_ROLE}, is leading the change.'),
    '',
    'WHERE TO START',
    item('Managers', 'Ten minutes: the shortlist sheet,'),
    ' ' * 23 + '1 Summary/links-26-shortlist.pdf',
    item('', 'Then ten minutes for each presentation for managers:'),
    *[' ' * 23 + path for path in MANAGERS],
    item('Colleagues', 'First, the chosen link\'s presentation for colleagues:'),
    *[' ' * 23 + path for path in COLLEAGUES],
    item('', 'Then pages 1 to 3 of its proposal sheet, in 4 Proposal sheets: the detail, and every week of the link on '
         'page 3.'),
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
         'and today: what they share, where they differ, and which to choose for what. A one-page sheet for colleagues, '
         '"What it means if you...", on what each '
         'shortlisted link means for someone who prefers earlies or lates, swaps earlies for lates, works their share '
         'of Sundays or no overtime, or saves leave for long breaks. And one page with every proposal against today\'s '
         'link: its print is small, so read it on screen, zoomed in, or print it at A3. It is a reference, not a page '
         'to present.'),
    item('2 Rules', 'The three tiers of rule, two pages: the hard limits (three, and the ceiling of 219 contracted days '
         'a year, which is hard too), the nine December 2026 rules scored on every sheet, and three flexible rules '
         'aimed for when designing (14 on a Saturday, five cover weeks as evenly spaced as 26 weeks allow, and '
         'weekday closers starting at 15:45 or later).'),
    item('3 Presentations', f'{decks}: one for colleagues and one for managers{" each" if len(with_decks) > 1 else ""}. '
         'PowerPoint and PDF copies of each. On the slides a figure better than today carries a green tick and one '
         'worse an amber triangle, as on the sheets. The PowerPoints use the Inter font; if the PC showing them does '
         'not have Inter, present the PDF instead.'),
    item('4 Proposal sheets', 'One eight-page PDF per proposal, compared only with today\'s link: pages 1 and 2 are the '
         'plain-English comparison, page 3 the rota, the rest the evidence managers can inspect. The links where 14 '
         'days\' leave buys 30 days off, as today, are in the folder 30 days off, Common Ground\'s among them. The marks mean the '
         'same on every page:'),
    mark_item('green tick', 'meets a rule, or better than today on something the rules, the limits or the fatigue '
              'guidance aim for, or on a plain gain such as full weekends off or the fit to the trains'),
    mark_item('amber triangle', 'worse than today on one of those'),
    mark_item('red cross', 'a rule or limit broken'),
    mark_item('no colour', 'a fact, or for colleagues to weigh'),
    item('', 'The code and eight-character fingerprint in each file name identify the exact rota, so a printout can '
         'never be mixed up with a variant.'),
    item('5 Import files', 'Each proposal as text for the Links page (Import), which lays out 26 lines since app version '
         '24.47 (3 October 2026) and re-runs the hard limits, the fatigue checks, the weekends, the hours and the hour-by-hour staffing on whatever is pasted in; the December rules and the yearly figures are the sheets\' own. The '
         f'{WORDS[len(SHORTLIST)]} shortlisted designs are built into the app\'s Links designer as examples, for reference '
         f'(these {WORDS[len(SHORTLIST)]} since app version 25.36).'),
    item('6 Technical notes', 'The 26-line rules with what changed from 24. Written for the technical record, not for '
         'reading out.'),
    '',
    para(f'Proposals in this pack: {names}.'),
    '',
    'HOW THE SHORTLIST CAME ABOUT',
    *([para('The first shortlist, on 3 October 2026, was Second Edition, Short Run and Even Keel.'), '']
      if {'Second Edition', 'Short Run', 'Even Keel'} <= names_in else []),
    *([para('Home Grown, Closing Time and Both Ways (26 October 2026) answer a later question: today\'s link on 26 lines, '
            'keeping as many of its shift times as it can, with a 13:35 or 13:45 finish every weekday and the weekday closer at 16:00. Each pays for '
            'the short finishes a different way; the summary sheet sets them side by side. Closing Time, improved on 27 and 30 '
            'October, was shortlisted on 30 October until the shortlist was cut to two the same day; the other two '
            'were never on it.'), '']
      if {'Home Grown', 'Closing Time', 'Both Ways'} <= names_in else []),
    *([para('In Step (30 October 2026) answers the next question: whether Closing Time could have five on at the Saturday '
            'open and follow the weekday trains more closely. It keeps Closing Time\'s weeks and a 13:45 finish every '
            'weekday, with the closer at 15:45 instead of 16:00. The same day the shortlist was cut to two: In Step and '
            'Short Run, on it since 3 October (Second Edition, Even Keel and Closing Time left it).'), '']
      if 'In Step' in names_in else []),
    *([para('Even Step (31 October 2026) answers the one thing about In Step expected to be hard to sell: the length of its '
            'main weekday earlies, 8h 55m and 8h 45m. It keeps In Step\'s weeks - the same rest days, weekends and early '
            'and late weeks - with the shift times chosen again. It joined the shortlist the same day, beside In Step '
            'and Short Run.'), '']
      if 'Even Step' in names_in else []),
    *([para('Clean Slate and Next Step (3 November 2026) and Fair Share, Open Return, Short Openers, Grand Tour and '
            'Common Ground (4 November 2026) came after the shortlist of 31 October. Clean Slate '
            'chooses every shift time afresh for the trains, with no shift over 8h 30m Monday to Saturday, one 13:45 '
            'finish and a closer from 15:45 every weekday. Next Step has Even Step\'s shift times with three weekday ones '
            'retimed for the trains, laid on Home Grown\'s weeks, still with no shift over 8h 30m Monday to Saturday. Fair '
            'Share is Next Step with an even Sunday: '
            'every Sunday duty is 8h 10m or 8h 15m, so a Sunday early and a Sunday late pay within a few pounds, and no '
            'shift is over 8h 30m on any day. Open Return, Short Openers, Grand Tour and Common Ground are links where '
            '14 days\' leave buys 30 days off, and four weeks off take 14, as today; their sheets and import files have a '
            'folder of their own, 30 days off. Open Return has a 16:15 closer every weekday and no avoidable fatigue '
            'warning. Short Openers has Open Return\'s weeks, with every weekday 06:20 finishing by 14:20, every weekday '
            'closer at 15:45, and two weekday lates 15 minutes shorter, which keeps each weekday\'s hours. Grand Tour keeps '
            'Fair Share\'s shift times in new weeks. Common Ground was drawn on the brief of today\'s link taken to 26 '
            'weeks, and is laid on Grand Tour\'s weeks: today\'s shift times kept where the rules allow, a 13:45 finish '
            'every weekday, closers from 15:45 Monday to Saturday, nothing over 8h 30m on any day, and Sunday duties of 8h to '
            '8h 30m.'), '']
      if AFTER_31_OCT else []),
    para(f'On {SHORTLIST_DATE.replace("Nov", "November")} the shortlist was drawn again, after every design then in the pack, '
         'and listed A to Z: Common Ground, as the example of the links that keep today\'s leave; Even Step, then first in '
         'the pack\'s league; and Short Run, which colleagues had already seen. In Step left the shortlist, and its '
         'presentations stay in the pack. Page 2 of the shortlist sheet sets every other design beside the three.'),
    '',
    # described on its own terms, as its headline is (owner, 5 Nov 2026: "the proposal description headlines should not
    # reference other proposals")
    *([para('Middle Ground, Balanced V5 and Balanced V6 (5 November 2026) came after it. Middle Ground has seven of '
            'today\'s shift times, varied from week to week so that no two closing weeks and no two 06:20 weeks fall '
            'together. Balanced V5, a one-page roster drawn up outside the app, has weeks of 06:20 starts and weeks of '
            '08:00 starts and a 15:45 closer every weekday. Balanced V6 has a 15-minute handover every weekday, from three '
            '07:30-16:00s to the three 15:45 closers. All three buy 30 days off for 14 days\' leave too, and are in the '
            'folder 30 days off.'), '']
      if LATE else []),
    # THE 22:30 OFFICE (6 Nov 2026; README.md -> "The Saturday ticket office to 22:30"): what it changed, said once, for a reader
    # holding a printout from before it, whose fingerprints no longer match
    para('On 6 November 2026 the rules were corrected: the ticket office shuts at 22:10 on a Saturday and takes 20 minutes '
         'to cash up, so on every link here its two Saturday lates finish at 22:30, where today\'s finish at 22:00. On the '
         'nineteen already in the pack that hour comes off the Saturday\'s other lates, so the hours and the contract are '
         'as they were; every sheet and presentation was redrawn, and those nineteen fingerprints changed. Balanced V5 and '
         'Balanced V6, which joined the same day, already finished them at 22:30. Since then Common Ground is first in the '
         'pack\'s league, about a point and a half ahead of Even Step.'),
    '',
    para('The link was 24 weeks until 1 October 2026; that work is kept in its own pack, links-24-proposals.zip, for '
         'reference.'),
    '',
    'HOW THE FIGURES ARE WORKED OUT',
    para('Every figure in the summary, the shortlist sheet, the "What it means if you..." sheet, the rules sheet and the '
         'proposal sheets was worked out from '
         'the rotas, by the Marylebone Roster app\'s own checks and the tooling beside them. What is typed by hand is the '
         'rules\' own numbers, the one-line description under each design\'s name, and the wording of the shortlist '
         'sheet and the "What it means if you..." sheet, whose comparisons their builds check against the rotas. The '
         'presentations are built by '
         'scripts, and every figure in their tables is checked against those counts (docs/links-26/tooling/deck-check.mjs '
         'in the repository).'),
    '',
])
assert all(len(l) <= W for l in readme.split('\n')), [l for l in readme.split('\n') if len(l) > W]
_named = [n for n in DELETED if n in ' '.join(readme.split())]
if _named: raise SystemExit(f'pack: the read-me names {_named}, deleted on 6 Nov 2026 (owner: "Permanently delete ...")')
# PLAIN ASCII: it opens in Notepad, and an older one reads a file with no byte-order mark in the PC's own code page
if not readme.isascii(): raise SystemExit(f'pack: the read-me holds {sorted({c for c in readme if not c.isascii()})}; Notepad may garble them')
# NO RECOMMENDATION IN IT EITHER (owner, 5 Nov 2026): the one use of the word is the sentence saying there is none
_flat = ' '.join(readme.split())
if 'none is recommended' not in _flat or re.search(r'recommend', _flat.replace('none is recommended', ''), re.I):
    raise SystemExit('pack: the read-me names a recommendation, or no longer says there is none (owner, 5 Nov 2026: "Remove the marks")')
# and no name split across two lines: each file the route names is whole on a line, and no folder's name breaks
for path in ['1 Summary/links-26-shortlist.pdf', *MANAGERS, *COLLEAGUES, WHAT_IT_MEANS]:
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
