# THE ONE-DOWNLOAD PACK (2 Oct 2026, owner: "a different zip for the links 26 proposals … matching our folder names").
# Builds docs/links-26/links-26-proposals.zip from the files in this folder, laid out as the 24-line pack was
# (links-24-proposals.zip, in docs/links-24 until that folder was removed on 7 Nov 2026): a read-me, then summary, rules, presentations, sheets, import files and
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
# THE BALANCED SUBFOLDER (7 Nov 2026, owner: "Put all the Balanced proposals in their own subfolder"): inside the 30-day one
IN_ZIP = {'proposals': '', '30-days-off': '30 days off/', '30-days-off/balanced': '30 days off/Balanced/'}   # each folder's place inside "4 Proposal sheets" and "5 Import files"
in30 = lambda d: d.split('/')[0] == '30-days-off'   # the 30-day folder or its Balanced subfolder
if set(IN_ZIP) != set(PACK_DIRS): raise SystemExit(f'pack: IN_ZIP {sorted(IN_ZIP)} does not name every one of PACK_DIRS {PACK_DIRS}')

# the shortlist and the decks kept off it, read before the file list: since 8 Nov 2026 the zip carries the presentations of
# those designs only (fresh.mjs -> DECKS_KEPT), where until then it carried every deck in presentations/
FRESH = open(f'{ROOT}/tooling/fresh.mjs', encoding='utf-8').read()
SHORTLIST = re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', FRESH).group(1))
DECKS_KEPT = re.findall(r"'([^']+)'", re.search(r'export const DECKS_KEPT = \[([^\]]*)\]', FRESH).group(1))
files = [  # (source, path in the pack)
    (f'{ROOT}/links-26-summary.pdf', '1 Summary/links-26-summary.pdf'),
    (f'{ROOT}/links-26-shortlist.pdf', '1 Summary/links-26-shortlist.pdf'),
    (f'{ROOT}/links-26-other-designs.pdf', '1 Summary/links-26-other-designs.pdf'),   # off the shortlist's page 2 (7 Nov 2026, the outside review)
    (f'{ROOT}/links-26-what-it-means.pdf', '1 Summary/links-26-what-it-means.pdf'),   # colleagues: what it means if you… (1 Nov 2026)
    (f'{ROOT}/links-26-rules.pdf', '2 Rules/links-26-rules.pdf'),
]
for name, code, fp in proposals:
    base = f"{name.replace(' ', '-')}-{code}"
    # ONLY THE SHORTLIST'S DECKS, AND THOSE KEPT (8 Nov 2026): the eight in presentations/ were last rebuilt for the shortlist of
    # 5 Nov 2026 and each names it as the shortlist (In Step's say it is not on it), so none of them ships. The three shortlisted
    # on 8 Nov had none that morning, and the zip carried no presentations; theirs were drawn later the same day, from Common
    # Ground's (shortlist-decks.py), and ship. The eight stay in the repository, unchanged, and deck-check.mjs still holds
    # their figures to the grids
    for who in ('colleagues', 'managers') if name in SHORTLIST + DECKS_KEPT else ():
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
# the shortlist is fresh.mjs's, read rather than restated (above, with DECKS_KEPT): this read-me once said "three shortlisted"
# and "one recommended (Short Run)" in its own words, so it would have gone on saying both after the sheets had moved on
# NO RECOMMENDATION, AND A TO Z (owner, 5 Nov 2026: "Remove the marks"). From 3 Oct 2026 the read-me opened on "THE
# RECOMMENDATION" — Short Run, then In Step, then Even Step — and sent both audiences through that design's presentations.
# It now presents the three evenly, in the order every other surface uses. A RECOMMENDED back in fresh.mjs, or a shortlist
# out of order, stops the build rather than tilting the read-me again
if re.search(r'export const RECOMMENDED\b', FRESH): raise SystemExit('pack: fresh.mjs exports RECOMMENDED again; the pack names no recommendation (owner, 5 Nov 2026)')
if SHORTLIST != sorted(SHORTLIST): raise SystemExit(f'pack: the shortlist is listed A to Z everywhere; fresh.mjs lists {SHORTLIST}')
# THE DECKS KEPT OFF THE SHORTLIST (5 Nov 2026, owner: "keep the other presentations in the pack, just not the shortlist"):
# In Step's, from when it was shortlisted, until 8 Nov 2026 (none since: fresh.mjs); and the day the shortlist was drawn
SHORTLIST_DATE = re.search(r"export const SHORTLIST_DATE = '([^']+)'", FRESH).group(1)
if not SHORTLIST or any(s not in names.split(', ') for s in SHORTLIST): raise SystemExit(f'pack: shortlist {SHORTLIST} is not all in the pack')
# WHERE EACH AUDIENCE STARTS: the shortlisted designs' presentations, A to Z, for managers and for colleagues alike — and
# the one-page sheet last. Until the external review of 6 Nov 2026 a colleague was sent to "the chosen link's" deck: a
# leftover of the managers' ask (removed the same day), and it read as if a link had already been picked. ONLY THE DECKS
# THE ZIP HOLDS: on the morning of 8 Nov 2026 the three shortlisted that day had none, and the route ran through the sheets
# until theirs were drawn, later the same day
MANAGERS = [d for _, d in files if d.startswith('3 Presentations/') and d.endswith('-for-managers.pdf')]
COLLEAGUES = [d for _, d in files if d.startswith('3 Presentations/') and d.endswith('-for-colleagues.pdf')]
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
# WHEN THE NEW LINK STARTS, the month alone (owner, 8 Nov 2026): link.mjs states it for the sheets, the read-me and the decks
LINK_STARTS = re.search(r"^export const LINK_STARTS = '([^']+)';$", open(f'{ROOT}/tooling/link.mjs', encoding='utf-8').read(), re.M).group(1)
# THE SHORTLIST OF 8 NOV 2026: each one's choice and its price, the target the three were drawn for, and the closing weeks of
# the three that left, which the 8 Nov paragraph names — the last two are the sheet's claims, so the sheet still asserts them
for said in ['is the one to choose for something different',
             '<b>Choose Balanced V6</b> if the shortest runs of earlies or of lates, and the most long breaks, matter most',
             'weeks on one shift time, a ${hm(Math.round(BF.step))} change of start', 'fatigue warnings if a cover week falls badly',
             '<b>Choose Level Crossing</b> if no fatigue warning in any cover-week placement tested, steady start times and the most starts at 06:20',
             'matter most — for the fewest long breaks, about ${longRestYear(LF)} a year', 'for those who like them. Its cost: the fewest breaks of three days or more',
             '<b>Choose Middle Ground</b> if no shift over 8h&nbsp;30m and the closest Saturday fit matter most',
             'for the fewest early finishes, four at the open every day and the least Sunday overtime pay',
             'for a new design target: no two closing weeks side by side, changes between earlies and lates placed at useful rest breaks, and weeks on one shift time still important',
             "claim('Common Ground and Crossover: four closing weeks together;",
             "claim('Even Step: two closing weeks side by side; Short Run, Balanced V8 and Balanced V9 three together'"]:
    if said not in SHEET: raise SystemExit(f'pack: the read-me repeats the shortlist sheet, which no longer says "{said}"')
PAGE = open('newlink-data.js', encoding='utf-8').read().replace('\\u00a0', ' ')
for said in ['All three keep today’s leave: four full weeks off, Sunday to Saturday, for 14 days, and 30 days off for 14 at best',
             'All three keep closing weeks apart: a week of closing shifts is never followed by another, cover weeks aside',
             'Level Crossing and Middle Ground keep 18 of 21 weeks on one shift time', 'Balanced V6 has 7,',
             'On all three, the two Saturday ticket-office lates finish at 22:30, to cash up after the office shuts at 22:10']:
    if said not in PAGE: raise SystemExit(f'pack: the read-me repeats the New link page, which no longer says "{said}"')
# the count is the SUPPLIED list's, never typed: "Ten candidate links" stayed ten for three designs (26 Oct 2026)
# SENTENCES BELOW NAME MEMBERS, AND ARE CHECKED (30 Oct 2026 review; Even Step's added 31 Oct; the 5 Nov redraw): the 26 Oct
# paragraph says none of its three is on the shortlist; the 5 Nov paragraph, and the first section, name the three and say In
# Step left it and its decks stay; the Even Step paragraph says Even Step joined it; and item 5 says every shortlisted design
# is built into the app. Each reads the names it was typed with, so a change to SHORTLIST would otherwise leave the read-me
# contradicting itself.
if {'Home Grown', 'Closing Time'} & set(SHORTLIST):   # the third of 26 Oct, Both Ways, was deleted on 7 Nov 2026
    raise SystemExit(f'pack: the read-me says neither of the 26 Oct two is shortlisted; SHORTLIST is {SHORTLIST}')
if 'In Step' in SHORTLIST or DECKS_KEPT:   # the history says In Step left on 5 Nov, and item 3 that no presentations ship
    raise SystemExit(f'pack: the read-me says In Step left the shortlist and no presentations ship; SHORTLIST is {SHORTLIST}, DECKS_KEPT {DECKS_KEPT}')
if SHORTLIST != ['Balanced V6', 'Level Crossing', 'Middle Ground'] or SHORTLIST_DATE != '8 Nov 2026':   # the first section and the 8 Nov paragraph name the three
    raise SystemExit(f'pack: the read-me says Balanced V6, Level Crossing and Middle Ground were shortlisted on 8 November 2026; SHORTLIST is {SHORTLIST}, drawn {SHORTLIST_DATE}')
# THE THREE THAT CAME AFTER THE SHORTLIST (3 Nov 2026, owner: add Clean Slate and Next Step to the pack, the shortlist and the
# recommendation unchanged). Read from fresh.mjs's FIRST, as the shortlist sheet reads them: every design first drawn after
# the last shortlisted one. The 3 Nov paragraph below says none is shortlisted and says what each is, so it refuses any
# other set, and a shortlist that takes one of them in
import datetime
FIRST = dict(re.findall(r"'([A-Z]{2}-26-[A-Z0-9]+)': '([^']+)'", re.search(r'export const FIRST = \{([^}]*)\}', FRESH).group(1)))
_day = lambda code: datetime.datetime.strptime(FIRST[code], '%d %b %Y')
_drawn = max(_day(c) for n, c, _ in proposals if n in SHORTLIST)
LATE = sorted(n for n, c, _ in proposals if _day(c) > _drawn)   # none since 5 Nov 2026: the shortlist was drawn after every design
# THE DESIGNS DRAWN AFTER THE SHORTLIST OF 5 NOV 2026 (whose latest design, Common Ground, was drawn on 4 Nov), which the history
# describes in a paragraph of their own; the shortlist of 8 Nov 2026 took three of them in
AFTER_5_NOV = sorted(n for n, c, _ in proposals if _day(c) > datetime.datetime(2026, 11, 4))
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
# Balanced V7 joined the same day (owner: Balanced V6 made again "without losing anything", then "Add v7 please"), drawn on 6 Nov
# 2026: Balanced V6's duties laid on new weeks. It buys 30 days off for 14 days' leave too, so it is in the 30-day folder, and the
# late paragraph says what it has, as it does the others
# Crossover joined on 7 Nov 2026 (owner: "create a proposal that keeps the 1345 finishes and converts all the 1335 finishes to
# 1345 too ... 30 days off for 14 days AL ... minimise numbers of shift times and be competitive with the best proposals in the
# league table"; then "give hb a new name and put that into the pack. Delete set fair as it would not work"): two 13:45s every
# weekday, and no weekday early finishing between 15:00 and 16:00, so two are still on for the 15:45 closers' first 15 minutes.
# Set Fair, drawn first the same day, had three 07:15-15:45s leaving as the closers came on, and was deleted (DELETED, below).
# Drawn as Safe Hands, it was renamed the same day (owner: "Needs a better name", "Use railway names in future": RENAMED,
# below). Crossover buys 30 days off for 14 days' leave, so it is in the 30-day folder; the late paragraph says what it has, as
# it does the others, and the 22:30 paragraph says it is now first in the league
# Level Crossing joined later the same day (owner, of Crossover: "people don't want to do several weeks of closes. How possible
# is it to do the same to crossover?", then "Do it"): Crossover's duties and rest days with its weeks chosen again, so that no
# two closing weeks fall side by side. It is in the 30-day folder too, and the late paragraph says what it has
# Balanced V8 and Balanced V9 joined later the same day (owner: "Do the v7 week lay out again", then "Do A as Balanced V8 and B as
# Balanced V9"): Balanced V7's duties with every rest day chosen again, no 55-hour week however the cover weeks fall, and four
# weeks off for 13 days' leave. Both are in the 30-day folder, finish the Saturday office lates at 22:30 as drawn, and the late
# paragraph says what each has
AFTER_31_OCT_SET = ['Balanced V5', 'Balanced V6', 'Balanced V7', 'Balanced V8', 'Balanced V9', 'Clean Slate', 'Common Ground', 'Crossover', 'Fair Share', 'Grand Tour', 'Level Crossing', 'Middle Ground', 'Next Step', 'Open Return', 'Short Openers']
AFTER_5_NOV_SET = ['Balanced V5', 'Balanced V6', 'Balanced V7', 'Balanced V8', 'Balanced V9', 'Crossover', 'Level Crossing', 'Middle Ground']
if AFTER_5_NOV != AFTER_5_NOV_SET:
    raise SystemExit(f'pack: the read-me describes {", ".join(AFTER_5_NOV_SET)} as the designs after the shortlist of 5 November; they are {AFTER_5_NOV}')
if LATE:   # the read-me says the shortlist of 8 Nov 2026 was drawn after every design in the pack
    raise SystemExit(f'pack: the read-me says the shortlist was drawn after every design in the pack; {LATE} came after it')
if AFTER_31_OCT != AFTER_31_OCT_SET:
    raise SystemExit(f'pack: the read-me describes {", ".join(AFTER_31_OCT_SET)} as drawn up after 31 October 2026; they are {AFTER_31_OCT}')
LATE_WORDS = ', '.join(LATE[:-1]) + ' and ' + LATE[-1] if len(LATE) > 1 else ''.join(LATE)   # three since 4 Nov: 'A, B and C', never 'A and B and C'
# DELETED, 6 NOV 2026 (owner: "Permanently delete well kept, quarter past, the four second designs, quiet friday, little and
# often and same again"). Nine designs that had left the pack, or were never in it, are gone from the repository: grids,
# metas and their own search files (README.md -> "Nine designs deleted"). Until then the read-me named six of them as
# withdrawn or taken out, with their record "kept in the repository"; it now names none. Refused if one is back in SUPPLIED,
# and refused if the read-me names one, so a deleted design cannot come back unnoticed
DELETED = ['Second Nature', 'Second Wind', 'Second Sight', 'Second Gear', 'Quiet Friday', 'Same Again', 'Little and Often',
           'Quarter Past', 'Well Kept',   # Same Again Tidy was Well Kept; 'Same Again' also catches its name
           'Set Fair',   # 7 Nov 2026 (owner: "Delete set fair as it would not work"): drawn and deleted the same day, Crossover in its place
           'Both Ways', 'Fine Tune']   # 7 Nov 2026 (owner: "Please cut both ways and fine tune from the links 26 pack"): of the
           # 21 outside Balanced V5-V7, the lowest and fourth-lowest average place over the league's ten readings, and alone
           # best at none of its twenty measures (README.md -> "Both Ways and Fine Tune deleted")
if any(n in names.split(', ') for n in DELETED):
    raise SystemExit(f'pack: {DELETED} were deleted (6 and 7 Nov 2026); regenerate.mjs SUPPLIED lists one of them')
# RENAMED (7 Nov 2026): a design's old name, and the name it has now. The owner saw Safe Hands on a sheet before it was renamed
# Crossover, so the old name is refused in SUPPLIED and in the read-me, as a deleted one is, and so are the old names of the
# other designs renamed in the pack (Same Again Tidy, Well Kept's, is refused already, by DELETED's 'Same Again').
# The pack's names are railway names from Crossover on (owner, 7 Nov 2026: "Use railway names in future")
RENAMED = {'Quarter Past Relaid': 'Open Return', 'Relief Point': 'Balanced V6', 'Good Turn': 'Middle Ground', 'Safe Hands': 'Crossover'}
if any(n in names.split(', ') for n in RENAMED):
    raise SystemExit(f'pack: regenerate.mjs SUPPLIED lists an old name; {", ".join(f"{o} is {n}" for o, n in RENAMED.items())}')
# THE 30-DAY FOLDER, NAMED IN FULL (4 Nov 2026): the paragraph lists what is in it, so the list is the folder's, read from SUPPLIED
THIRTY_SET = ['Balanced V5', 'Balanced V6', 'Balanced V7', 'Balanced V8', 'Balanced V9', 'Common Ground', 'Crossover', 'Grand Tour', 'Level Crossing', 'Middle Ground', 'Open Return', 'Short Openers']
THIRTY_IN = sorted(n for n, c, _ in proposals if in30(DIR_OF[c]))
if THIRTY_IN != THIRTY_SET:
    raise SystemExit(f'pack: the read-me names {THIRTY_SET} as the 30-day folder; regenerate.mjs puts {THIRTY_IN} there')
built_in = open('links-proposals.js', encoding='utf-8').read()
missing = [n for n, c, _ in proposals if n in SHORTLIST and f"code: '{c}'" not in built_in]
if missing: raise SystemExit(f'pack: the read-me says every shortlisted design is built into the app; links-proposals.js lacks {missing}')
if '(v25.52)' not in built_in:   # item 5 says these three have been built in since app version 25.52
    raise SystemExit('pack: the read-me says the three were built in at app version 25.52; links-proposals.js no longer says so')
sl_where = sorted({DIR_OF[c] for n, c, _ in proposals if n in SHORTLIST})
if sl_where != ['30-days-off', '30-days-off/balanced']:   # the route and item 4 say where the three sheets are
    raise SystemExit(f'pack: the read-me says the three sheets are in 30 days off, Balanced V6\'s in its subfolder; they are in {sl_where}')
# to thirty since 6 Nov 2026: twenty-one designs ran off the end of a list that stopped at twenty
WORDS = ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty '
         'twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty').split()
# owner, 3 Oct 2026: "only keep the shortlist's presentations, delete the rest"; 5 Nov 2026: "keep the other presentations in
# the pack, just not the shortlist". The zip ships the decks of the shortlist and of those kept off it, and only theirs; every
# one of them has all four files (a deck for each audience, PowerPoint and PDF), as the read-me's item 3 says. From the
# morning of 8 Nov 2026 it shipped none, until the three shortlisted that day had theirs, drawn the same day
ORDER = sorted(SHORTLIST + DECKS_KEPT)
with_decks = sorted({os.path.basename(d).rsplit('-for-', 1)[0].replace('-', ' ') for _, d in files if d.startswith('3 Presentations/')})
if with_decks != ORDER:
    raise SystemExit(f'pack: presentations for {with_decks}; the shortlist {SHORTLIST} and the decks kept {DECKS_KEPT}')
_missing = [f'{n.replace(" ", "-")}-for-{w}.{e}' for n in ORDER for w in ('colleagues', 'managers') for e in ('pptx', 'pdf')
            if f'3 Presentations/{n.replace(" ", "-")}-for-{w}.{e}' not in {dst for _, dst in files}]
if _missing: raise SystemExit(f'pack: the read-me says each design has both presentations, as PowerPoint and PDF; missing {_missing}')
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
# A LABEL TOO LONG FOR ITS COLUMN HAS A LINE OF ITS OWN (8 Nov 2026, the pack audit). A format width pads a short label and
# never cuts a long one, so when item 5 took its folder's full name on 6 Nov, "5 Import files for the Links page" ran
# straight into its text: "5 Import files for the Links pageEach proposal as text...". Every label is kept, and the read-me
# is refused below if one ever runs into its text again
LABELS = []
def item(label, text, hang=21):
    LABELS.append(label)
    body = whole(' '.join(text.split()))
    if len(label) > hang - 3:   # at least one space between the label and the text, as every other label has
        return f'  {label}\n' + textwrap.fill(body, W, initial_indent=' ' * hang, subsequent_indent=' ' * hang,
                                              break_on_hyphens=False).replace('\x00', ' ')
    return textwrap.fill(body, W, initial_indent=f'  {label:<{hang - 2}}', subsequent_indent=' ' * hang,
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
AT_2230 = ['Balanced V5', 'Balanced V6', 'Balanced V7', 'Balanced V8', 'Balanced V9', 'Crossover', 'Level Crossing']   # the read-me's
if not set(AT_2230) <= names_in:   # 22:30 paragraph names these seven as drawn with it, and counts the rest
    raise SystemExit(f'pack: the read-me says {AT_2230} were drawn with the 22:30 office; the pack has {sorted(set(AT_2230) & names_in)}')
# THE LEAGUE'S LEADER AND ITS LEAD, READ (8 Nov 2026, the pack audit). The 22:30 paragraph ended "since 7 November 2026
# Crossover is, by 0.4 points", typed, while the shortlist sheet reads the same two facts from league.mjs. Its claim held
# them only loosely (Crossover first by 0.35 to half a point, which can print 0.5), so a design joining or a grid changing
# could have left the read-me a tenth, or a leader, behind the sheet. They are read here as the sheet reads them: the main
# league, today's link and Familiar Nine inside its ranges (REF_IN_RANGE=1), the lead to a tenth (the sheet's f1). The
# sentence says the leader has led since the day it was drawn, so a leader drawn before the shortlist is refused rather
# than printed: the paragraph would need rewriting
import json, subprocess, tempfile
with tempfile.TemporaryDirectory() as _t:
    subprocess.run(['node', 'league.mjs'], cwd=f'{ROOT}/tooling', check=True, stdout=subprocess.DEVNULL,
                   env={**os.environ, 'REF_IN_RANGE': '1', 'OLD_READINGS': '0', 'JSON': f'{_t}/league.json'})
    with open(f'{_t}/league.json', encoding='utf-8') as _f: _league = json.load(_f)
if not _league.get('refInRange') or _league.get('oldReadings'):
    raise SystemExit('pack: league.mjs did not write the main league with today inside its ranges')
_ranked = sorted(_league['proposals'], key=lambda r: -r['total'])
LEADER, LEAD = _ranked[0]['name'], f"{_ranked[0]['total'] - _ranked[1]['total']:.1f}"
_LEADER_CODE = next(c for n, c, _ in proposals if n == LEADER)
if _day(_LEADER_CODE) <= datetime.datetime(2026, 11, 6):   # since 8 Nov 2026 against the correction of 6 Nov, which the paragraph is about
    raise SystemExit(f'pack: the read-me says the league leader was drawn after the 22:30 correction; {LEADER} was drawn on {FIRST[_LEADER_CODE]}')
LEADER_FROM = f"{_day(_LEADER_CODE).day} {_day(_LEADER_CODE).strftime('%B %Y')}"   # '7 November 2026'
readme = '\n'.join([
    'NEW CEA LINK PROPOSALS - 26 LINES',
    '=' * len('NEW CEA LINK PROPOSALS - 26 LINES'),
    # The START is said; the date the 26 lines were set is not (office detail, owner, of slide 9's). The link starts after
    # the timetable changes in December (owner, 2 Nov 2026), and was "December 2026" here until then, "1 January 2027" until
    # 8 Nov 2026, and is the month alone since (owner: "We don't now know exactly what day"), read from link.mjs
    f'Marylebone CEA link from {LINK_STARTS} - 26 weeks',
    '',
    # THE SATURDAY OFFICE, SAID FIRST (6 Nov 2026, the external review: "Give the Saturday correction one prominent
    # sentence ... Bring a short version forward"). The whole account stays in how the shortlist came about, below
    para('Saturday ticket-office lates finish at 22:30 on every link here, so that the office can cash up after it shuts '
         'at 22:10 (corrected on 6 November 2026). On the links drawn before then the extra time comes off other Saturday '
         'lates, so the contracted hours are unchanged.'),
    '',
    'THE SHORTLIST',
    para(f'{WORDS[len(proposals)].capitalize()} candidate links are in this pack, and {WORDS[len(SHORTLIST)]} are shortlisted. They '
         'are listed A to Z, and none is recommended: each is the one to choose for something different.'
         + (f' {LATE_WORDS} came after the shortlist; see how the shortlist came about, below.' if LATE else '')),
    para('All three keep closing weeks apart: a week of closing shifts is never followed by another, cover weeks aside. All '
         'three keep today\'s leave too: four full weeks off, Sunday to Saturday, for 14 days, and 30 days off for 14 at best.'),
    item('Balanced V6', 'If the shortest runs of earlies or of lates, and the most long breaks, matter most. The price: 7 of its 21 weeks on one shift '
         'time, where the other two have 18, a larger change of start from week to week, more single rest days, and more '
         'fatigue warnings if a cover week falls badly.'),
    item('Level Crossing', 'If no fatigue warning in any cover-week placement tested, steady start times and the most starts '
         'at 06:20 matter most. The price: the fewest long breaks of the three.'),
    item('Middle Ground', 'If no shift over 8h 30m and the closest Saturday fit matter most. The price: the fewest early '
         'finishes, four at the open every day, and the least Sunday overtime pay.'),
    para('Pages 1 and 2 of the shortlist sheet set out each one\'s edge and its costs in full.'),
    '',
    'WHAT IS ASKED',
    # NO ASK OF MANAGERS (owner, 6 Nov 2026: "No", asked whether the read-me should keep asking them which shortlisted link
    # goes to colleagues): the pack is deliberately vague about how the choice is made, and S. Silva leads it
    item('Colleagues', f'Tell {CONTACT} or your manager what worries you about any of the shortlisted links, even if it is small. '
         f'{CONTACT}, {CONTACT_ROLE}, is leading the change.'),
    '',
    'WHERE TO START',
    # THE PRESENTATIONS FIRST AGAIN (8 Nov 2026): the three's decks drawn, each audience starts from them, A to Z, as before the
    # morning's shortlist; WHERE THE THREE SHEETS ARE (the pack's accuracy review, 6 Nov 2026) is said, and checked above (sl_where)
    item('Managers', 'Ten minutes: the shortlist sheet,'),
    ' ' * 23 + '1 Summary/links-26-shortlist.pdf',
    item('', 'Then ten minutes for each presentation for managers:'),
    *[' ' * 23 + path for path in MANAGERS],
    item('Colleagues', 'First, the presentations for colleagues, one for each shortlisted link:'),
    *[' ' * 23 + path for path in COLLEAGUES],
    item('', 'Then pages 1 to 3 of each one\'s proposal sheet, in 4 Proposal sheets, folder 30 days off (Balanced V6\'s '
         'in its subfolder Balanced): the detail, and every week of the link on page 3.'),
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
         'and today: what they share, where they differ, and which to choose for what. A one-page sheet setting every other '
         'design beside them: what each has, and what it pays. A one-page sheet for colleagues, '
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
         'days\' leave buys 30 days off, as today, are in the folder 30 days off, the three shortlisted among them, and the '
         'five Balanced designs in its subfolder Balanced. The marks mean the '
         'same on every page:'),
    mark_item('green tick', 'meets a rule, or better than today on something the rules, the limits or the fatigue '
              'guidance aim for, or on a plain gain such as full weekends off or the fit to the trains'),
    mark_item('amber triangle', 'worse than today on one of those'),
    mark_item('red cross', 'a rule or limit broken'),
    mark_item('no colour', 'a fact, or for colleagues to weigh'),
    item('', 'The code and eight-character fingerprint in each file name identify the exact rota, so a printout can '
         'never be mixed up with a variant.'),
    item('5 Import files for the Links page', 'Each proposal as text for the Links page (Import), which lays out 26 lines since app version '
         '24.47 (3 October 2026) and re-runs the hard limits, the fatigue checks, the weekends, the hours and the hour-by-hour staffing on whatever is pasted in; the December rules and the yearly figures are the sheets\' own. The '
         f'{WORDS[len(SHORTLIST)]} shortlisted designs are built into the app\'s Links designer as examples, for reference '
         f'(these {WORDS[len(SHORTLIST)]} since app version 25.52).'),
    item('6 Technical notes', 'The 26-line rules with what changed from 24. Written for the technical record, not for '
         'reading out.'),
    '',
    para(f'Proposals in this pack: {names}.'),
    '',
    'HOW THE SHORTLIST CAME ABOUT',
    *([para('The first shortlist, on 3 October 2026, was Second Edition, Short Run and Even Keel.'), '']
      if {'Second Edition', 'Short Run', 'Even Keel'} <= names_in else []),
    *([para('Home Grown and Closing Time (26 October 2026) answer a later question: today\'s link on 26 lines, '
            'keeping as many of its shift times as it can, with a 13:35 or 13:45 finish every weekday and the weekday closer at 16:00. Each pays for '
            'the short finishes a different way; the summary sheet sets them side by side. Closing Time, improved on 27 and 30 '
            'October, was shortlisted on 30 October until the shortlist was cut to two the same day; Home Grown '
            'was never on it.'), '']
      if {'Home Grown', 'Closing Time'} <= names_in else []),
    *([para('In Step (30 October 2026) answers the next question: whether Closing Time could have five on at the Saturday '
            'open and follow the weekday trains more closely. It keeps Closing Time\'s weeks and a 13:45 finish every '
            'weekday, with the closer at 15:45 instead of 16:00. The same day the shortlist was cut to two: Short Run, on it '
            'since 3 October, and In Step (Second Edition, Even Keel and Closing Time left it).'), '']
      if 'In Step' in names_in else []),
    *([para('Even Step (31 October 2026) answers the one thing about In Step expected to concern colleagues most: the length of its '
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
    para('On 5 November 2026 the shortlist was drawn again, after every design then in the pack, and listed A to Z: Common '
         'Ground, as the example of the links that keep today\'s leave; Even Step, then first in the pack\'s league; and '
         'Short Run, which colleagues had already seen. In Step left the shortlist, and its presentations stayed in the pack.'),
    '',
    # described on its own terms, as its headline is (owner, 5 Nov 2026: "the proposal description headlines should not
    # reference other proposals")
    *([para('Middle Ground, Balanced V5 and Balanced V6 (5 November 2026), Balanced V7 (6 November 2026), and Crossover, '
            'Level Crossing, Balanced V8 and Balanced V9 (7 November 2026) came after it. Middle Ground has seven of today\'s shift times, varied from week to week so '
            'that no two closing weeks fall together. Balanced V5, a one-page roster drawn up outside '
            'the app, has weeks of 06:20 starts and weeks of 08:00 starts and a 15:45 closer every weekday. Balanced V6 has a '
            '15-minute handover every weekday, from three 07:30-16:00s to the three 15:45 closers. Balanced V7 has Balanced '
            'V6\'s duties, every one, laid in new weeks, with no six-day weeks. Crossover keeps two 13:45 finishes every '
            'weekday, where today has a 13:35 and a 13:45, and every weekday closer at 15:45, with two earlies on until '
            '16:00, the closers\' first 15 minutes; no fatigue warning is present in any cover-week placement tested. Level '
            'Crossing has the same shift times and the same handover, laid in different weeks so that no two closing weeks '
            'come in a row. Balanced V8 and Balanced V9 have Balanced V7\'s duties again, every one, in new weeks: no '
            'fatigue warning is present in any cover-week placement tested, and four full weeks off take 13 days\' leave. '
            'Balanced V8 has 19 of its 21 working weeks on one shift time and no week mixing earlies and lates; Balanced V9 '
            'has no more than three early or three late weeks in a row outside the cover weeks, with two weeks mixing them. '
            'All eight buy 30 days off for 14 days\' leave too, and are in the folder 30 days off, the five Balanced designs in its '
            'subfolder Balanced.'), '']
      if AFTER_5_NOV else []),
    # THE 22:30 OFFICE (6 Nov 2026; README.md -> "The Saturday ticket office to 22:30"): what it changed, said once, for a reader
    # holding a printout from before it, whose fingerprints no longer match. THE COUNT IS READ SINCE 7 NOV 2026: it said "the
    # nineteen already in the pack", true on 6 Nov, until Both Ways and Fine Tune were deleted and a reader counting found 17
    para('On 6 November 2026 the rules were corrected: the ticket office shuts at 22:10 on a Saturday and takes 20 minutes '
         'to cash up, so on every link here its two Saturday lates finish at 22:30, where today\'s finish at 22:00. Balanced '
         'V5, Balanced V6 and Balanced V7 already finished them at 22:30, as Crossover, Level Crossing, Balanced V8 and '
         'Balanced V9, drawn since, do. On the other '
         f'{WORDS[len(names_in - set(AT_2230))]} that hour comes off other Saturday lates, so the hours and the contract are '
         'as they were; every sheet and presentation was redrawn, and their fingerprints changed. Common Ground was then '
         f'first in the pack\'s league, just over half a point ahead of the next; since {LEADER_FROM} {LEADER} is, by {LEAD} '
         'points.'),
    '',
    # THE SHORTLIST OF 8 NOV 2026 (owner: "Put Level Crossing, Middle Ground and Balanced V6 as the shortlist for now"), for the
    # target set that day; the closing weeks of the three that left are the shortlist sheet's claims, held above (SHEET)
    para(f'On {SHORTLIST_DATE.replace("Nov", "November")} the shortlist was drawn again, after every design in the pack, '
         'for a new design target: no two closing weeks side by side, changes between earlies and lates placed at useful '
         'rest breaks, and weeks on one shift time still important. Balanced V6, Level Crossing and Middle Ground keep '
         'closing weeks apart, where Common Ground, Even Step and Short Run each put two or more side by side, and all '
         'three keep today\'s leave. The presentations drawn for the earlier shortlists are left out of the pack, since each '
         'says its link is shortlisted; the three were given their own the same day. A one-page sheet, '
         'links-26-other-designs.pdf, sets every other design beside the three.'),
    '',
    'HOW THE FIGURES ARE WORKED OUT',
    para('Every figure in the summary, the shortlist sheet, the sheet of the other designs, the "What it means if you..." '
         'sheet, the rules sheet and the '
         'proposal sheets was worked out from '
         'the rotas, by the Marylebone Roster app\'s own checks and the tooling beside them. What is typed by hand is the '
         'rules\' own numbers, the one-line description under each design\'s name, and the wording of the shortlist '
         'sheet, the sheet of the other designs and the "What it means if you..." sheet, whose comparisons their builds '
         'check against the rotas.'
         + (' The presentations are built by scripts, and every figure in their tables is checked against those counts '
            '(docs/links-26/tooling/deck-check.mjs in the repository).' if MANAGERS + COLLEAGUES else '')),
    '',
])
assert all(len(l) <= W for l in readme.split('\n')), [l for l in readme.split('\n') if len(l) > W]
_named = [n for n in DELETED if n in ' '.join(readme.split())]
if _named: raise SystemExit(f'pack: the read-me names {_named}, deleted on 6 or 7 Nov 2026 (README.md -> "Nine designs deleted", "Crossover", "Both Ways and Fine Tune deleted")')
_old = [n for n in RENAMED if n in ' '.join(readme.split())]
if _old: raise SystemExit(f'pack: the read-me names {_old}, the old name of {[RENAMED[n] for n in _old]}')
# PLAIN ASCII: it opens in Notepad, and an older one reads a file with no byte-order mark in the PC's own code page
# NO DAY FOR THE START (owner, 8 Nov 2026), as the sheets refuse one (link.mjs → longDates) and the decks (deck-polish.py)
_day_start = next((m for m in re.finditer(r'\b(?:from|starts?(?: on)?|follows(?: from)?) (\d{1,2}(?:st|nd|rd|th)? Jan(?:uary)? 2027)\b|\b(January 1st)\b', ' '.join(readme.split()), re.I)
                   if (m.group(1) or m.group(2)) != LINK_STARTS), None)   # a day other than link.mjs's: none while it is a month
if _day_start: raise SystemExit(f'pack: the read-me dates the new link\'s start to a day ("{_day_start.group(0)}"); it starts {("on " if LINK_STARTS[0].isdigit() else "in ") + LINK_STARTS}')
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
# and no label running into its text (the pack audit, 8 Nov 2026: "5 Import files for the Links pageEach proposal")
_run = sorted({lab for lab in LABELS if lab for l in readme.split('\n')
               if l.startswith(f'  {lab}') and len(l) > 2 + len(lab) and l[2 + len(lab)] != ' '})
if _run: raise SystemExit(f'pack: the read-me runs the label {_run} into its text; a label too long for its column needs a line of its own')


if os.path.exists(OUT): os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f'{TOP}/Read me first.txt', readme.replace('\n', '\r\n'))   # CRLF: an older Notepad shows LF-only text as one line
    for src, dst in files: z.write(src, f'{TOP}/{dst}')
print(f'wrote {OUT}: {len(files) + 1} files')
