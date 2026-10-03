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
with_decks = [n for n, _, _ in proposals if os.path.exists(f"{ROOT}/presentations/{n.replace(' ', '-')}-for-colleagues.pptx")]
readme = f"""DECEMBER 2026 LINK PROPOSALS - 26 LINES
Marylebone CEA link, December 2026 timetable - the 26-week link (from 1 October 2026)

TEN candidate links, THREE shortlisted (Second Edition, Short Run, Even Keel), ONE
recommended (Short Run). Asked of managers: which of the three goes to colleagues.
Asked of colleagues: look at page 3 of the chosen sheet and say what worries you.
  Ten minutes:    1 Summary/links-26-shortlist.pdf
  Twenty minutes: add 3 Presentations/Short-Run-for-managers.pdf
  The rest is the evidence behind them.

Still moving: the staffing levels and Sunday cover behind the rules were confirmed
verbally, not in writing; the written source of the 13-day limit is to be confirmed;
and the reading of one fatigue factor (FF19, marked "definition to confirm" on the
rules page) is open. The figures are computed from the rotas and will not move unless a
rule does. The link was 24 weeks until 1 October 2026; that work is kept in its own
pack, links-24-proposals.zip, for reference.

Proposals in this pack: {names}.

Start with these:
  1 Summary        One page: every proposal against today's link; and the two-page
                   shortlist sheet - the three recommended designs against each
                   other and today, with a recommendation. Start there.
  2 Rules          The three tiers of rule, two pages: the hard limits (three, and the
                   ceiling of 219 contracted days a year, which is hard too), the nine
                   December 2026 rules scored on every sheet, and three flexible
                   rules aimed for when designing (14 on a Saturday, five cover
                   weeks as evenly spaced as 26 weeks allow, 15:45 weekday closers).
  3 Presentations  {(', '.join(with_decks[:-1]) + ' and ' + with_decks[-1]) if len(with_decks) > 1 else (with_decks[0] if with_decks else 'None yet')}:
                   one for colleagues and one for managers{' each' if len(with_decks) > 1 else ''}.
                   PowerPoint and PDF copies of each. The PowerPoints use the
                   Inter font; if the PC showing them does not have Inter,
                   present the PDF instead.

The detail:
  4 Proposal sheets   One eight-page PDF per proposal, compared only with today's
                      link: pages 1-2 are the plain-English comparison, the rest
                      the evidence managers can inspect. The marks mean the same
                      on every page:
                        green tick   meets a rule, or better than today on
                                     something the rules, the limits or the
                                     fatigue guidance aim for
                        amber        worse than today on one of those
                        red cross    a rule or limit broken
                        no colour    a matter of preference
                      The code and eight-character fingerprint in each file name
                      identify the exact rota, so a printout can never be mixed
                      up with a variant.
  5 Import files      Each proposal as text for the Links page (Import), which lays
                      out 26 lines since app version 24.47 (3 October 2026) and
                      re-runs every check in this pack on whatever is pasted in. The
                      three shortlisted designs are already in the app's Links
                      designer as examples, for reference.
  6 Technical notes   The 26-line rules with what changed from 24, and how the
                      proposals were built and checked. Written for the technical
                      record, not for reading out.

Every figure in the summary, the shortlist sheet, the rules sheet and the proposal sheets was worked
out from the rotas by the Marylebone Roster app; none was typed in by hand. The
presentations are built from the Familiar Nine decks by scripts (through a Second Nature template that is not shipped), and every figure
in their tables is checked against those counts by another
(docs/links-26/tooling/deck-check.mjs in the repository).
"""

if os.path.exists(OUT): os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f'{TOP}/Read me first.txt', readme)
    for src, dst in files: z.write(src, f'{TOP}/{dst}')
print(f'wrote {OUT}: {len(files) + 1} files')
