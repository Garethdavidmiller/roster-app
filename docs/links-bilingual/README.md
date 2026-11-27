# Links — a shorter bilingual link

**Where it stands (27 November 2026).** A discussion draft, not a proposal: three ways to work the bilingual link in
6 lines instead of today's 8, each beside today's, shared for comment. Nothing is decided. The bilingual contract is
being phased out (`RULES.md` → Facts), which is why a shorter link is being looked at.

**This folder is public.** `docs/` is served by the GitHub Pages mirror, and the repository is public. Nothing here may
name a colleague: the rosters are patterns, which the app already publishes, and that is all this folder holds.

## What is in this folder

| | What it is |
|---|---|
| `links-bilingual-6-line-options.pdf` | the sheet: today's link and Options A, B and the wildcard as rosters, then the numbers for one person over a year and each option's gains and costs, on three A4 pages |
| `RULES.md` | the rules every option keeps, and what the three options are each for |
| `tooling/options.json` | the three options' rosters, line by line — the one source the sheet is built from |
| `tooling/rules.mjs` | the rules and measures as arithmetic, shared by the three scripts below |
| `tooling/check.mjs` | checks every option against every rule, prints the numbers, and fails on a breach |
| `tooling/search.mjs` | looks for options inside the rules |
| `tooling/sheet.mjs`, `tooling/sheet.css` | build the PDF from `options.json`, every figure worked out, none typed |

Today's link is read from the app's own `roster-cycle-data.js`, never copied, so the comparison cannot go stale.

## Changing an option

1. Edit its rows in `tooling/options.json`. **Change Option B and the wildcard together**: the wildcard must stay Option B
   with every 07:00 start at 06:20 and each Sunday an hour longer, and `check.mjs` fails if it does not.
2. `node docs/links-bilingual/tooling/check.mjs` — every option must meet every rule.
3. `node docs/links-bilingual/tooling/sheet.mjs` — rebuilds the PDF. It must stay three pages; the script says how many it
   wrote. Its gains and costs are worded in `sheet.mjs`, so read them again after a change: the figures in them update,
   the sentences do not.
4. Commit the PDF with `git add -f` (`.gitignore` refuses every PDF, so a payslip can never slip in).

**The PDF needs Chromium.** `sheet.mjs` uses the repository's Playwright. Where its own browser is not installed, name
another in `PLAYWRIGHT_CHROMIUM` (a cloud session's: `PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium`).

## Searching again

`node docs/links-bilingual/tooling/search.mjs <A|B|B-daytime> [seconds]` prints the best rosters it found, each with its
JSON for `options.json`. It is random, so run it several times (four at once on four cores) and keep the lowest cost; a
four-minute run of `B` finds a handful that keep every rule. How it weighs one roster against another is its header
and `RULES.md` → The search.
