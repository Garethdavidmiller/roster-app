# Colleague emails — the new link, from one person's point of view

Five email templates, each written for colleagues who share a set of preferences. Each compares the three
shortlisted proposals — Balanced V6, Level Crossing and Middle Ground — and today's link, says which proposal's figures
fit that person best and what each one gives up, and points them to the New CEA link page and the proposal sheet. Written
on 27 Nov 2026 against the shortlist of 8 Nov 2026.

**They are not a recommendation of how to vote.** Sara Silva, the RMT rep, leads the change; every template says so,
says nothing has been decided, and asks the reader to tell Sara or their manager what worries them.

## The templates

| File | For a colleague who… | Closest fit |
|---|---|---|
| `prefer-earlies.html` | likes early shifts, 06:20 starts most of all, and swaps onto earlies | Level Crossing |
| `lates-by-2200.html` | likes late shifts finishing no later than 22:00, always swaps onto lates, and loves Sunday overtime | Balanced V6 |
| `home-by-2230.html` | dislikes shifts finishing after 22:30, closing shifts most of all. It says first that no proposal has fewer closing shifts (three close every day), then which makes them easiest to live with. It also says the answer turns on whether a 22:30 finish is itself too late: then Balanced V6 | Middle Ground |
| `lates-swapper-and-day-shifts.html` | swaps onto a late every day, and is thinking of also taking day shifts of roughly 08:00 to 17:00: it answers both, and says how the answer turns on how early is too early (07:30 or 07:00) | Balanced V6 |
| `weekends-and-long-breaks.html` | wants full weekends off and three or four days off in a row, and would use a day or two of annual leave to get more of both. It explains why (how the days off are grouped: pairs against single days) and shows the year twice, Sundays worked and Sundays given up in advance, with every figure that needs the Sunday given up marked | Middle Ground |

Each is for the **main CEA roster** — the roster the new link replaces. Check the person's line in `roster-member-data.js`
(`rosterType: 'main'`, `role: 'CEA'`) before sending: the figures mean nothing to anybody else.

## Sending one

1. Copy the template and replace `[First name]` in the greeting. Check the person's preferences match the template's
   exactly: a template written for "finishing by 22:00" says the wrong things to somebody happy to close.
2. Paste the whole file into the email body as HTML.
3. Subject lines that have worked: "The new link: which proposal suits your earlies", "The new link: which proposal
   suits your lates and Sundays", "The new link: weekends, long breaks, and making your leave go further".

**A preference no template covers needs its own email**, worked out the same way (below) — and once it is polished, a
template of its own here.

## Privacy — what never goes in this folder

- **No copy with a name in it.** `docs/` is published by the GitHub Pages mirror, so anything here is public. A
  colleague's name next to their preferences is personal; the named copies live outside the repository.
- **Nothing personal in the hidden comments.** The comment at the top of a template travels with the HTML when it is
  pasted, so a reader can find it in the email's source. Keep it to the template's own description.

## Where the figures come from

Every figure is either the New CEA link page's (`newlink-data.js`) or a proposal sheet's, or **counted from the proposals'
own weeks** (`link-designer-proposals.js`) by the page's rules: one person over a year, Monday to Saturday as Sundays are
overtime, cover weeks left out. Each counted figure was first checked by reproducing a figure the page publishes with
the same count; a count that cannot reproduce the page's figures is not used.

- **`lates-by-2200.html`** counts lates by finish time (by 22:00, at 22:30, to the close) and the colleagues' lates
  finishing by 22:00 on the rota each weekday. Checked against the page's lates a year (88 · 94 · 94 · 94) and the
  presentations' finishes at 22:00 or later (78 today, 94 on Level Crossing).
- **`prefer-earlies.html`** counts the lates to the close, checked the same way.
- **`lates-swapper-and-day-shifts.html`** counts earlies by start time, the weeks that are all earlies, all lates
  or mixed (a whole week of earlies is one swap), and the extra time from swapping every early for the day's average
  late, which reproduces the page's "a late against an early, same day" minutes times the earlies a year.
- **`weekends-and-long-breaks.html`** plans a whole year exactly: for each proposal, the fewest days of leave that give
  a number of football weekends (a Saturday and Sunday off) and three- or four-day trips with no day used twice,
  averaged over every week of the rota the year could start on — once with rostered Sundays worked, and once with
  every Sunday given up in advance (the owner, 27 Nov 2026: unavailability is marked ahead, and there are plenty of
  takers for the overtime). It assumes leave is granted when asked, and leaves out cover weeks, whose four shifts are set nearer the time. Its weekends and breaks with no
  leave reproduce the page's single rest days (10 · 22 · 10 · 12) and breaks of three or four days (13 · 6 · 2 · 4).

## When they go stale

The figures belong to the three designs as they stand. **If the shortlist changes, or a design's weeks change
(`link-designer-proposals.js`), every figure here must be checked again before another email is sent** — the proposal
sheets' links name each design's fingerprint, so a changed design also changes the link in the template. Once a
proposal is chosen (`CHOSEN` in `newlink-config.js`), these templates are history: do not send them.
