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
# the shortlist and the recommendation are fresh.mjs's, read rather than restated (two since 30 Oct 2026, In Step
# recommended): this read-me said "three shortlisted" and "one recommended (Short Run)" in its own words, so it would have
# gone on saying both after the sheets, the summary and the decks had moved on
FRESH = open(f'{ROOT}/tooling/fresh.mjs', encoding='utf-8').read()
SHORTLIST = re.findall(r"'([^']+)'", re.search(r'export const SHORTLIST = \[([^\]]*)\]', FRESH).group(1))
RECOMMENDED = re.search(r"export const RECOMMENDED = '([^']+)'", FRESH).group(1)
if not SHORTLIST or any(s not in names.split(', ') for s in SHORTLIST): raise SystemExit(f'pack: shortlist {SHORTLIST} is not all in the pack')
if RECOMMENDED not in SHORTLIST: raise SystemExit(f'pack: the recommendation {RECOMMENDED} is not on the shortlist {SHORTLIST}')
TWENTY = f"3 Presentations/{RECOMMENDED.replace(' ', '-')}-for-managers.pdf"   # the read-me's twenty-minute read
if not any(dst == TWENTY for _, dst in files): raise SystemExit(f'pack: the read-me points at {TWENTY}, which the pack does not hold')
# the count is the SUPPLIED list's, never typed: "Ten candidate links" stayed ten for three designs (26 Oct 2026)
# THREE SENTENCES BELOW NAME MEMBERS, AND ARE CHECKED (30 Oct 2026 review): the 26 Oct paragraph says none of its three is
# on the shortlist, the In Step paragraph says In Step is and is the recommendation, and item 5 says every shortlisted design
# is built into the app. Each reads the names it was typed with, so a change to SHORTLIST would otherwise leave the read-me
# contradicting its own first line.
if {'Home Grown', 'Closing Time', 'Both Ways'} & set(SHORTLIST):
    raise SystemExit(f'pack: the read-me says none of the 26 Oct three is shortlisted; SHORTLIST is {SHORTLIST}')
if 'In Step' not in SHORTLIST or RECOMMENDED != 'In Step':   # the 30 Oct paragraph below says it is both
    raise SystemExit(f'pack: the read-me says In Step is shortlisted and recommended; SHORTLIST is {SHORTLIST}, RECOMMENDED {RECOMMENDED}')
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
para = lambda t: textwrap.fill(' '.join(t.split()), W)
def item(label, text, hang=21):
    return textwrap.fill(' '.join(text.split()), W, initial_indent=f'  {label:<{hang - 2}}', subsequent_indent=' ' * hang)
decks = (', '.join(with_decks[:-1]) + ' and ' + with_decks[-1]) if len(with_decks) > 1 else (with_decks[0] if with_decks else 'None yet')
readme = '\n'.join([
    'DECEMBER 2026 LINK PROPOSALS - 26 LINES',
    'Marylebone CEA link, December 2026 timetable - 26 weeks, set on 1 October 2026',
    '',
    para(f'{WORDS[len(proposals)].capitalize()} candidate links, {WORDS[len(SHORTLIST)]} shortlisted ({", ".join(SHORTLIST[:-1])} and {SHORTLIST[-1]}), one recommended ({RECOMMENDED}). '
         f'Asked of managers: which of the {WORDS[len(SHORTLIST)]} goes to colleagues. Asked of colleagues: look at page 3 of the chosen '
         'sheet and say what worries you.'),
    item('Ten minutes:', '1 Summary/links-26-shortlist.pdf', 18),
    item('Twenty minutes:', f'add {TWENTY}', 18),
    para('The rest is the evidence behind them.'),
    '',
    *([para('Home Grown, Closing Time and Both Ways (26 October 2026) answer a later question: today\'s link on 26 lines, '
            'keeping as many of its shift times as it can, with a 13:35 or 13:45 finish every weekday and the weekday closer at 16:00. Each pays for '
            'the short finishes a different way; the technical notes compare them. Closing Time, improved on 27 and 30 '
            'October, was shortlisted on 30 October until the shortlist was cut to two the same day; the other two '
            'were never on it.'), '']
      if {'Home Grown', 'Closing Time', 'Both Ways'} <= {n for n, _, _ in proposals} else []),
    *([para('In Step (30 October 2026) answers the next question: whether Closing Time could have five on at the Saturday '
            'open and follow the weekday trains more closely. It keeps Closing Time\'s weeks and a 13:45 finish every '
            'weekday, with the closer at 15:45 instead of 16:00. The same day the shortlist was cut to two: In Step, and '
            'Short Run, on it since 3 October (Second Edition, Even Keel and Closing Time left it). In Step is the one '
            'recommended; the shortlist sheet sets out why, and how close it is.'), '']
      if 'In Step' in {n for n, _, _ in proposals} else []),
    para('Still moving: the staffing levels and Sunday cover behind the rules were confirmed verbally, not in writing; '
         'the written source of the 13-day limit is to be confirmed; and the reading of one fatigue factor (FF19, marked '
         '"definition to confirm" on the rules page) is open. The figures are computed from the rotas and will not move '
         'unless a rule does. The link was 24 weeks until 1 October 2026; that work is kept in its own pack, '
         'links-24-proposals.zip, for reference.'),
    '',
    para(f'Proposals in this pack: {names}.'),
    '',
    'START WITH THESE',
    item('1 Summary', f'One page: every proposal against today\'s link; and the two-page shortlist sheet - the '
         f'{WORDS[len(SHORTLIST)]} shortlisted designs against each other and today, with a recommendation. Start there.'),
    item('2 Rules', 'The three tiers of rule, two pages: the hard limits (three, and the ceiling of 219 contracted days '
         'a year, which is hard too), the nine December 2026 rules scored on every sheet, and three flexible rules '
         'aimed for when designing (14 on a Saturday, five cover weeks as evenly spaced as 26 weeks allow, 15:45 '
         'weekday closers).'),
    item('3 Presentations', f'{decks}: one for colleagues and one for managers{" each" if len(with_decks) > 1 else ""}. '
         'PowerPoint and PDF copies of each. The PowerPoints use the Inter font; if the PC showing them does not have '
         'Inter, present the PDF instead.'),
    '',
    'THE DETAIL',
    item('4 Proposal sheets', 'One eight-page PDF per proposal, compared only with today\'s link: pages 1-2 are the '
         'plain-English comparison, the rest the evidence managers can inspect. The marks mean the same on every page:'),
    item('', 'green tick - meets a rule, or better than today on something the rules, the limits or the fatigue '
         'guidance aim for', 24),
    item('', 'amber - worse than today on one of those', 24),
    item('', 'red cross - a rule or limit broken', 24),
    item('', 'no colour - a matter of preference', 24),
    item('', 'The code and eight-character fingerprint in each file name identify the exact rota, so a printout can '
         'never be mixed up with a variant.'),
    item('5 Import files', 'Each proposal as text for the Links page (Import), which lays out 26 lines since app version '
         '24.47 (3 October 2026) and re-runs the hard limits, the fatigue checks, the weekends, the hours and the hour-by-hour staffing on whatever is pasted in; the December rules and the yearly figures are the sheets\' own. The '
         f'{WORDS[len(SHORTLIST)]} shortlisted designs are built into the app\'s Links designer as examples, for reference '
         '(these two since app version 25.02).'),
    item('6 Technical notes', 'The 26-line rules with what changed from 24, and how the proposals were built and '
         'checked. Written for the technical record, not for reading out.'),
    '',
    para('Every figure in the summary, the shortlist sheet, the rules sheet and the proposal sheets was worked out from '
         'the rotas, by the Marylebone Roster app\'s own checks and the tooling beside them; what is typed by hand is the rules\' own numbers and the one-line description under each design\'s name. The presentations are built from the '
         'Familiar Nine decks by scripts, through a Second Nature template that is not shipped, and every figure in '
         'their tables is checked against those counts by another (docs/links-26/tooling/deck-check.mjs in the '
         'repository).'),
    '',
])
assert all(len(l) <= W for l in readme.split('\n')), [l for l in readme.split('\n') if len(l) > W]


if os.path.exists(OUT): os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f'{TOP}/Read me first.txt', readme)
    for src, dst in files: z.write(src, f'{TOP}/{dst}')
print(f'wrote {OUT}: {len(files) + 1} files')
