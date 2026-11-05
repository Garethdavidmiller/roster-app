# Presentations outside the pack

Decks for designs that are **not on the shortlist**, made at the owner's request for the owner to look at and use. They
are **not part of the pack**: the pack ships only the shortlist's presentations (owner, 3 October 2026), from
`../presentations/`, and `../tooling/pack.py` refuses any other design's deck there. Keeping these in a folder of their own
leaves the pack, the shortlist and the shortlist's six decks exactly as they were.

| Design | Decks | Built by |
|---|---|---|
| **Common Ground** (`CG-26-T8` · `e02c295f`, in `../30-days-off/`) | `Common-Ground-for-colleagues` (15 slides) and `Common-Ground-for-managers` (10 slides), each as `.pptx` and `.pdf` | `../tooling/common-ground-decks.py` |

They were asked for on 5 November 2026 (owner: "Then create presentations for common ground"; offered where to keep
them: "Outside the pack").

**What they say.** Common Ground is today's link taken to 26 weeks: today's shift times where the December rules allow,
today's 13:45 and 14:20 finishes kept, and 14 days' leave buying 30 days off, with four weeks off for 14 days' leave, as
today. The decks lead with that: it is what Common Ground has and the three shortlisted links do not. Its costs are said as
plainly: six single rest days in 26 weeks, where the shortlisted links have four; a 9-hour Saturday late (13:30–22:30); a
slightly weaker weekday fit to the trains. The managers' "Why Common Ground?" slide speaks from outside the shortlist: what
it shares with the three shortlisted links, what it adds, and what it costs.

**How they are made.** They are Even Step's finished decks with what differs rewritten, so the two read alike wherever the
designs agree (most of the figures: the hours and days, the run, the weekends, the closers, the late finishes, the
staffing but the open, the Saturdays and Sundays). Every figure comes from the grid or from the sheets' own counts, and
`../tooling/deck-check.mjs` checks every table row in these two decks as it checks the shortlist's six. Rebuild after Even
Step's decks, from the repository root:

```
python3 docs/links-26/tooling/common-ground-decks.py && node docs/links-26/tooling/deck-check.mjs
soffice --headless --convert-to pdf --outdir docs/links-26/presentations-outside-the-pack \
  docs/links-26/presentations-outside-the-pack/Common-Ground-for-*.pptx
```

The builder stops if Even Step's decks no longer say what it expects to rewrite, or if any sentence it leaves alone quotes
a figure that differs between the two designs.
