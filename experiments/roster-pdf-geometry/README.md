# Does the roster PDF already contain the grid the AI is reconstructing?

**Yes — measured, on a real roster, and more completely than expected.** Run against
`MYB CEA & Bilingual WE 05/09/2026`, September 2026.

This is the proof behind the roster-import direction in `ROADMAP.md`. It is **not a CI gate** and
not a runtime asset: it tests a PDF, not us, and it needs a dependency the app does not carry.

## Why it was run

The import's day-drift defence rests on three channels — the AI's row read, its `sundayScan` and
its `columnScan` — and they are **not independent witnesses**. All three come from one model call
looking at one PDF. When the model visually collapses a blank Sunday cell, every channel repeats the
same positional mistake and every server-side cross-check agrees with the wrong answer. v22.16 added
`assessRosterAlignment`, which compares against the member's own base roster instead — the one
witness the PDF cannot influence — but a base roster is a *weak* witness by design, because the
published roster legitimately carries leave, absence, overtime and swaps on top of it.

The question this answers is whether a *strong* witness exists in the file itself.

## What is actually in the file

**The table's rules are DRAWN.** Not implied by alignment — stroked line segments, recoverable from
the page's operator list. The vertical rules sit at:

```
25.3   154.8   250.3   347.0   442.3   537.5   633.5   729.5   822.5
 │  NAME  │  Sun  │  Mon  │  Tue  │  Wed  │  Thu  │  Fri  │  Sat  │
```

identical on all three content pages, with horizontal row rules too. Columns are 93–97px wide.

**They are `moveTo`/`lineTo` segments, not rectangles.** The first version of `rules2.mjs` looked
only for rectangles and reported *zero* rules on every page — a confident wrong answer that would
have closed this investigation. Worth knowing before anyone re-derives it.

## What that buys — G. Miller, page 3, the exact row that drifts

Every text object on the row, with the column its x lands in:

```
  x= 28.2  →  NAME        "G. Miller"
  x=292.7  →  Monday      "RD"
  x=372.7  →  Tuesday     "06:20"   … "CEA 1" … "14:20"
  x=468.9  →  Wednesday   "06:20"   … "CEA 3" … "14:20"
  x=580.7  →  Thursday    "RD"
  x=660.0  →  Friday      "07:00"   … "CEA BL 1" … "16:00"
  x=755.8  →  Saturday    "07:00"   … "CEA BL 4" … "15:00"
```

**Not one object falls between 154.8 and 250.3.** The Sunday cell is empty as a matter of physical
fact, so there is nothing for a reader — model or otherwise — to place there, and no way for
`RD` at x=292.7 to become Sunday. The flattened text stream, which is what the model works from,
loses exactly this and begins `RD`.

## Across the whole document

`extract.mjs` assigns every run to a physical `(row, column)` cell. On this file: **3 content pages,
28 member rows, all seven days each, no cell mis-assigned.** (Two earlier figures in
this file said 12 and 11 — they were counted with the three `Vacant` rows filtered out, which is a
different question from how many cells the witness can speak for.)

| | |
|---|---|
| member rows (including three legitimately named `Vacant`) | **28** |
| physically empty Sunday cells | **13** |
| Sundays holding a timed duty — the negative case's control | **12** |
| Sundays holding a code (`SC`, `SP`) | **3** |
| rows with all seven cells filled | **15** |
| cells no deterministic rule reads | **1** — `S. Fayombo` Wed, `"07:00-16:00 CEA BL 1"` (missing the `\|` separator the others carry) |

Both directions matter. An emptiness claim is only useful if worked Sundays are equally visible,
and they are.

## How much does the WITNESS actually buy? Less than it looks — measure before committing

`phase1.mjs` builds the phase-1 witness (for each member, does each physical cell hold any text?)
and tests it two ways: against the honest read, and against a simulated one-day-LEFT shift, which is
the failure being closed.

```
honest reads passing the witness : 28/28
one-day-left misreads REFUSED    : 13/28
```

**Zero false refusals** — the direction that would make this unusable is clean. But it refuses fewer
than half of arbitrary one-day shifts, and the reason is structural rather than fixable: a member
whose week is **fully occupied** (`XXXXXXX` — 15 of the 28 here) has no empty cell for a shifted
claim to contradict. Every day the AI names has text in it. The witness can only speak where the
grid is empty.

So state its scope precisely:

- It closes **the reported bug** — the blank-Sunday collapse — completely, because that failure is
  *defined* by a claim landing in an empty cell. Every one of the 13 blank-Sunday rows is caught.
- It is **not** a general day-drift detector, and must not be described as one. `assessRosterAlignment`
  stays; the two catch different halves.

**This is the argument for not stopping at phase 1.** Under phase 2 — geometry ASSIGNS the day and
the model is handed already-separated cells — a full row cannot shift either, because each cell's
content is bound to its column by construction rather than checked after the fact. The witness is
worth shipping first because it is small, deterministic and changes nothing else; it is not the
destination.

## Three things the advice did not predict, and one of them bites

1. **The file has six pages; three are completely empty** (`items.length === 0`). Skip by content,
   never by page number.
2. **The print footer parses as a member row.** `Print Date: 27/08/2026 | 09:52 | Page 1 of 3` sits
   inside the grid, and `Page 1 of 3` lands in the **Tuesday** column. A geometry reader that trusts
   "anything in a row is a member" imports a member called `Print Date: 27/08/2026` with a Tuesday
   duty. It has to be filtered — and it is the shape of hazard geometry introduces in exchange for
   the one it removes.
3. **`Vacant` appears three times** as a legitimate row name, so rows are not uniquely keyed by name.

## The gate is CLEARED — all three roster types, one grid (v22.19)

The Supervisor (CES) and Dispatch rosters for the same week arrived after the first pass, and they
are the thing that was needed before geometry could be more than a witness. Both carry the
**identical** vertical rules:

```
25.3   154.8   250.3   347.0   442.3   537.5   633.5   729.5   822.5
```

`extract.mjs` reads all three correctly with no change. That is stronger than the caution below
required: the positions did not merely have to be *detectable* per document, they turn out to be the
same across roster types produced by the same system.

**What the two new rosters add, and it settles the Sunday question outright:**

| | CEA | Supervisor | Dispatch | total |
|---|---|---|---|---|
| Sundays holding a timed duty | 12 | 5 | 4 | **21** |
| …of which carry an RDW marker | 0 | 0 | 0 | **0** |
| RDW markers on Mon–Sat | 4 | 0 | 6 | **10** |

So `RDW` means **a rest day being worked**. Sunday is uncontracted, its work is inherently
overtime, and the sheet never labels it. v22.16's rule — flag a plain-time Sunday as unreadable
because it lacks RDW — would have sent every one of those 21 to review. It was removed at v22.19.

**And blanks:** over 50 member rows, 24 blank Sundays against 5 blank Mon–Sat cells — all five
belonging to **S. Horsman**, who appears on the Supervisor roster with a full week and on the
Dispatch roster working only its Saturday. That is a real, legitimate blank weekday, and it is still
the right thing to send to an admin: defaulting it to RD would write rest days over the shifts the
Supervisor import had just written for the same person.

**Vocabulary the deterministic parser will meet**, gathered from all three: `RD` `AL` `SP` `NA` `SC`
`SN` `OD` `HA` `ML` `TBC`, times with and without a duty number, `06:20-18:20 RDW`, `SUP 1/TRG`, and
free text — `SEE NATHAN`, `See CEM`, `Assessments`. The last three are the cells that genuinely
belong in the review's UNREADABLE state, which is a useful reminder that phase 3's "AI only for the
unusual cell" is not the same as "AI almost never".

## The corpus question — ANSWERED (1 Sep 2026, 12 documents)

This section used to say the evidence was "one week and one generator", and set the test to pass
before geometry could be a positional **authority**: run `extract.mjs` over several HISTORICAL
rosters and look for a page with no drawn rules at all, which is what a re-generated or scanned
sheet would produce.

That has now been done. **12 documents — 3 roster types x 3 week-endings (22 Aug, 5 Sep, 12 Sep),
DRAFT and FINAL of each.** Result:

    pages rejected for not carrying the 9-column grid:  0 of 12 documents
    member rows extracted:                              207 (footer rows excluded)

Every page of every document carries the grid, at nine fixed x positions, including the DRAFT
variants — which matter because a draft is the roster office's own working copy and is the likeliest
place for a different export path to show up. It does not.

**What this still does not establish.** Three consecutive week-endings from one software version.
It says nothing about an archive from before a system change, and nothing about a scanned sheet —
which would have no text layer at all and is the case the import should refuse outright rather than
mis-read. The honest position is that the grid is now established as STABLE across the material the
roster office produces today, not as permanent.

## What the geometry says about the domain rules

The point of an independent witness is to check the claims the parser is built on, and here it
either confirms or corrects three of them. These figures come from the PDF's own text positions, so
the model had no part in them.

| Claim | Measured across the 12 documents |
|---|---|
| A blank Sunday is ordinary | **111 of 207 rows** have a physically empty Sunday cell — 54% |
| A worked Sunday carries no RDW marker | **80 worked Sundays with NO marker, against 1 with** |
| Mon-Sat states are written explicitly, so a blank weekday is exceptional | **49 blank cells in 1,242** — 3.9% |

The first two are decisive, and the second is the strongest evidence yet that removing the v22.16
"an unmarked Sunday time must be RDW" rule at v22.19 was right: 80 counter-examples.

**The third one is where the number moved, and it matters.** Blank weekdays are not spread thinly —
they are almost entirely one roster type and a handful of people:

    CEA          1 blank weekday cell  in 678   (S. Fayombo, one Friday)
    Supervisors  0                     in 240
    Dispatch    48                     in 324   = 15%, across four people
                 S. Horsman 19 · S Faure 18 · P. Prashanthan 6 · F. Mohamed 5

The v22.19 rule sends every one of those to the review. On CEA and Supervisors that is one row in
918. On **Dispatch it is roughly a dozen review rows per import on a 14-16 row roster** — because
these are people who appear on the Dispatch sheet and work most of their week elsewhere, which is
exactly the case the rule exists for: writing RD across them would overwrite what their primary
roster's import had just written. The rule is right and the volume is higher than the single-week
sample suggested. See KNOWN_LIMITATIONS.md.

## Running it

Needs `pdfjs-dist`, now a **devDependency** (owner decision, 1 Sep 2026 — it is a development tool
for this experiment, is not served to anyone, and nothing in the app imports it).

**Pinned to v4 deliberately.** `extract.mjs` reads `OPS.constructPath`'s argument shape directly to
find the drawn rules, and pdfjs 6 changed that encoding: on 6.3.289 every one of the 12 documents
failed identically with `fns is not iterable`, which looks exactly like a PDF problem and is not
one. If this is ever upgraded, `rulesOf` is the function to rewrite first.

```
npm i pdfjs-dist@4          # in a scratch directory, not the repo
node rules2.mjs  <roster.pdf>          # the drawn rules, per page
node extract.mjs <roster.pdf>          # every member × every day, as JSON
node witness.mjs <roster.pdf> "G. Miller"   # one row, as raw x → column arithmetic
node phase1.mjs  out.json               # the witness, scored both ways (feed it extract.mjs's output)
```

`witness.mjs` is the one to reach for in an argument: it shows the assignment as arithmetic rather
than as a result. Its ±18px row window is deliberately cruder than `extract.mjs`'s rule-based one —
on page 1 it picks up the `Sunday` column header as though it were on the first member's row, which
is a good illustration of why the drawn rules are worth using.
