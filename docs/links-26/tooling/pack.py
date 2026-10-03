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

A WORK IN PROGRESS, not a decision pack: the proposals, the figures and the wording
are still moving, and the staffing levels behind the rules were confirmed verbally.
The link was 24 weeks until 1 October 2026; that work is kept in its own pack,
links-24-proposals.zip, for reference.

Proposals in this pack: {names}.

Start with these:
  1 Summary        One page: every proposal against today's link.
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
  5 Import files      Each proposal as text for the Links page (Import). The Links
                      page still lays out 24 lines, so it will refuse these until
                      it moves to 26 - that is planned as its own app release.
  6 Technical notes   The 26-line rules with what changed from 24, and how the
                      proposals were built and checked. Written for the technical
                      record, not for reading out.

Every figure in the summary, the rules sheet and the proposal sheets was worked
out from the rotas by the Marylebone Roster app; none was typed in by hand. The
presentations are built from the Familiar Nine decks by a script, and every figure
in their tables is checked against those counts by another
(docs/links-26/tooling/deck-check.mjs in the repository).
"""

if os.path.exists(OUT): os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f'{TOP}/Read me first.txt', readme)
    for src, dst in files: z.write(src, f'{TOP}/{dst}')
print(f'wrote {OUT}: {len(files) + 1} files')
