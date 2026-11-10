# A11Y_BASELINE.md — accessibility gate baseline

*Not version-stamped; not a runtime asset. Every finding recorded here is fixed, so the file is the
gate's baseline and the archive of what it caught, not a list of open problems.*

`e2e/axe.spec.js` runs the [axe-core](https://github.com/dequelabs/axe-core) engine against the
fully-rendered states of every page (WCAG 2.0/2.1 A + AA). Run it with **`npm run test:a11y`**.

It is a **floor**: axe catches the machine-checkable ~third of real issues (labels, names, contrast,
ARIA, duplicate ids). It does not replace a manual screen-reader pass.

**Open items: one, and it is not a finding.** Every finding recorded below is fixed. What has
never been done is a **manual screen-reader pass** —
somebody driving the app with VoiceOver or TalkBack and listening to it. That is the only way to
reach the two-thirds axe cannot: reading ORDER, whether announcements arrive at a useful moment,
whether a live region interrupts something the user was in the middle of, and whether the app is
usable by ear at all. It needs a person and a device, not a test run, which is why it is stated here
as outstanding rather than tracked as a defect.

**What the pass must listen for, by name (Nov 2026 review).** A live region held at `display: none`
is not in the accessibility tree, and screen readers differ on whether it speaks when it is switched
on. axe cannot tell: it checks that a live region exists, not that anybody heard it.

- **The sign-in and set-password error boxes.** `.login-error` stays hidden until it gains
  `.visible`, and both pages write the message before the class goes on (`showError` in
  `login-overlay.js`, `setError` in `password-force.js`). On an iPhone and on an Android phone, type
  a wrong password and confirm that "Password not recognised…" is read out. If it is not, keep the box
  rendered and change only its text. The Calendar PIN card already shows its box first and writes
  second, and its `say` in `calendar-lock-cards.js` explains why.
- **Admin's and Operations' status lines.** `.feedback`, `.list-feedback`, `.huddle-filename` and
  `#authSetupResult` are live regions held at `display: none` until a class shows them. Listen for
  one of each: a Change a Shift save, a deletion from Saved Changes, a chosen upload file and the
  result of Set up accounts.

## Current status — ✅ GREEN + BLOCKING

Every state the spec drives passes on both projects (Desktop Chrome + Pixel 5), and the gate is part
of `npm run test:e2e` — a new WCAG A/AA violation fails the suite. `npm run test:a11y` runs it
standalone (chromium). One documented per-page exclusion remains (calendar `.other-month`; see #2).

## Findings (baseline, Jul 2026)

### 1. `nested-interactive` (SERIOUS) — ✅ FIXED

`initCardCollapse` (overlay.js) used to set `role="button"` + `tabindex="0"` on the whole
`.card-collapsible-header`, but a header contains a nested real `<button class="btn-card-tips">?</button>`
(Tips / paycalc Help) — an interactive control wrapping another (ambiguous focus/activation).

**Fix (shared, one place):** `initCardCollapse` now makes the **chevron/arrow** the focusable toggle
(`role="button"` + `aria-expanded`/`aria-controls` + an `aria-label` from the card heading) and leaves
the header **non-interactive**. The header keeps a mouse-only click convenience that ignores clicks on
any nested control (so the Tips/Help "?" no longer falls through and toggles the card). The no-chevron
case falls back to the original header-as-toggle. Chevron/arrow gained `cursor` + a `:focus-visible`
ring (shared.css / paycalc.css). Verified: axe reports **0** `nested-interactive`; overlay.test.mjs
green; e2e green. No visual change to the cards.

### 2. `color-contrast` (SERIOUS) — ✅ FIXED

*Originally flagged: muted text / badges below 4.5:1 AA — calendar `#alBtn`/`#payBtn` + other-month
day numbers, paycalc badges (`#paycalcBadge`/`#badge-sat`/`#badge-ot`), guide `.guide-footer`,
railcard `.rc-cost`/`.rc-lbl`, shift badges (`.sb-early`/`.sb-al`), FIP `.not-fip-name`. All resolved:*


- **Guides:** darkened the muted grey tokens (`--light` #888 → #6b6b6b / #666, guide footer
  #7c8794 → #5a6472), deepened the legend swatches, and removed the FIP "not-FIP" `opacity: 0.45`
  wash (opacity can't meet AA — the ✗ NO tag + a muted name colour carry "not available" instead).
- **Calendar + paycalc + admin:** deepened the shared shift/pay tokens just enough to clear
  white-text AA (`--green`, `--al`, `--ot`, `--success-green`) while keeping the hue, and switched
  the badges that could not (orange `.badge-early`, admin's gold "today" text) to **navy text on
  the colour tint** — the tint + border keep each badge's identity. (`.badge-early` has since moved to
  white on its own darkened token, `--early-badge` in `shared.css`.) `.badge-sat` takes `--orange-text`
  instead (owner-approved): a darkened 64.1°-hue orange that clears AA on `--orange-light` and keeps
  Saturday's category colour, matching the OT/Peer badges, whose text kept their category colour. Screenshotted: no brand
  drift. Also fixed the `aria-allowed-attr` regression this surfaced (`setSettingsCardOpen` was
  setting `aria-expanded` on the now-non-interactive paycalc header — moved it to the arrow control).
- **Documented exclusion:** the calendar's faint **other-month day numbers** are `aria-hidden`
  decorative context (darkening them defeats the "not this month" cue for zero SR benefit), so they
  are `.exclude('.other-month')`d in the calendar scan — a targeted exclusion, not a rule waiver.

## Functional-emoji screen-reader treatment (H1)

An audit of every emoji RENDERED to users (shift badges, markers, headings, buttons, nav) checked
each against WCAG: emoji that duplicate adjacent text should be `aria-hidden`; an emoji that is the
sole label of a control/marker needs an accessible name. **Result: the app already had a strong,
consistent convention** (shift badges wrap the glyph in `aria-hidden`; every emoji-only button —
📍/☰/✕/✎/🔔 — carries an `aria-label`; the calendar day cell's `aria-label` carries payday/cut-off
so the CSS `::before` markers are correctly decorative). **No P1 (control-unusable) findings.**

Fixed this pass:
- **P2 (real correctness gain):** the "Change a Shift" per-day badge (`admin-week-editor.js`
  `renderWeekGrid`) conveyed Bank Holiday / Payday / Cut-off by emoji + `title` only — `title`
  isn't reliably announced (esp. mobile SR), and the meaning wasn't in the row's visible text.
  Now `role="img" aria-label="<title>"`.
- **P3 convention gaps** (emoji duplicated visible text but wasn't hidden — brought back in line
  with the app's own pattern): nav-drawer link + guide builders (`nav-panel.js`); paycalc card
  sub-headings (`.h-title` ×8); admin `.al-booked-title` ×2; `admin-week-editor.js` overwrite-badge
  ⚠ + the Spare 📋 flavour button; index.html action buttons (🖨️ Print, 📖 guide, 🐛 Report a bug,
  💷 View pay estimate, 🔔 notify).

These are aria-tree-only changes (glyphs still render — visual baselines byte-identical).

### Transient status glyphs — ✅ FIXED

*Deferred by the emoji pass as "P3, low return": the dozens of transient status strings that prefix
`textContent` with ✓/⚠/✗/ℹ️ in `aria-live` regions — "the glyph arguably reinforces the status, and
hiding it needs a span restructure at each site; best done later via one shared helper."*

The helper is `status-text.js`. `setStatus(el, '✓ Settings saved')` puts the glyph in an
`aria-hidden` span, so the announcement is the sentence and nothing else. The glyph is split OFF the
message rather than passed separately (`setStatus(el, glyph, text)`, as originally sketched)
precisely because of the cost noted above: a signature requiring every caller that composes its
message — counts, names, dates, i.e. most of them — to be taken apart first is a migration that gets
done to half the sites, and half-done is worse here than not started, since the sites left behind
look identical in the source.

Converted: every call site, the `innerHTML` templates that carry markup of their own (wrapped by
hand), and **the two static `role="alert"` regions in `paycalc.html`** — `#pensionWarn` and
`#satWarn`, which every automated pass read straight past, because they are correct HTML with the
glyph as real text.

**Buttons are deliberately excluded.** `✓ Resolve` is a stable accessible NAME, matched by
`getByRole('button', { name })` and announced once on focus rather than interrupting a reader
mid-sentence. Different problem, different risk; if it is taken on later it should be its own pass
with its own test surface, not folded into this one.

Two page modules turned out to have their own local functions called `setStatus`, both writing to
live regions (`login-overlay.js`, `paycalc-lightboxes.js`). Both now delegate to the shared helper
and are named for their surface.

**Why this needed its own guard.** Nothing else in the repo can see this rule: rendering is
byte-identical so the visual baselines pass, `textContent` reads back unchanged so every e2e
assertion passes, and axe has no rule for "a decorative glyph that was not hidden" — that is a
judgement about meaning, which is why it sat here as prose for months instead of failing a
build. `status-glyph-parity.test.mjs` enforces it in the three shapes it can break (markup,
`textContent`, `innerHTML`), plus that the helper is imported wherever it is called.

### BH rate badges — `color-contrast` (SERIOUS) — ✅ FIXED

`#badge-bh` / `#badge-bhot` on paycalc rendered `--al` on `--al-light` — teal on teal tint, measured
**4.16:1** against the 4.5 AA floor. Fixed by using `--al-text` (`oklch(43% 0.101 182.5)`, 5.98:1),
the token that already existed in `shared.css` beside `--orange-text` and `--rdw-text` for exactly
this case. The border keeps `--al`: a non-text element, 3:1. No new token, and the badge keeps its
teal identity. The same pair in admin's `.al-banner-stat .stat-val` was corrected with it.

**Why the gate had never caught it, which is the part worth keeping.** Two independent maskings, and
neither is a hole in the gate:

1. **The badges only exist some of the time.** They render when the selected pay period contains a
   bank holiday, so the scan first SAW them on 28 Aug 2026, with Monday's holiday in period P28. A
   gate that scans one settled state per page can only find what that state happens to contain, and
   conditional UI is invisible to it for most of the year.
2. **An open modal hid them even then.** The Year to Date notice opened during this scan — the
   spec suppressed it with a key that had been renamed — and axe does not flag what sits behind an
   open dialog. So the run that first had the badges on screen ALSO had them covered. Suppressing the
   notice correctly is what made the violation appear, and the failure looked at first like the
   notice change had caused it.

The general lesson, and it applies to every page in `axe.spec.js`: **a green a11y scan is a statement
about the state that was scanned, not about the page.** If a surface only appears under a condition —
a bank holiday, an error, a populated list — the gate is silent on it until something puts it there.

### Admin and Operations, five reader-facing contrasts and a clipped ring — `color-contrast` / focus — ✅ FIXED (Nov 2026)

Found by the November 2026 review, each measured on its own background:

- **Admin's "AL left" chip at 1–5 days** was `--accent-gold-dark`, 1.69:1. It now uses the AL
  banner's own `--al-low`, 6.28:1.
- **Admin's "⚠ Removing" badge** on an unticked saved day was white on `--orange`, 2.16:1. It is
  white on `--orange-deep` now, 5.24:1.
- **The AL banner's entitlement note** ("Includes 1 day in lieu for working Boxing Day") was faded
  with `opacity`, 3.47:1. It is unfaded now, 5.97:1, and quieter by its size instead.
- **Operations' Staff Login Accounts leaver line** was `--error-red` on its own tint, 4.36:1. It is
  `--error-text` now, 6.63:1. The remedy under it was faded on top, 3.62:1, and is unfaded now.
- **The App Speed and Usage month toggle** drew its focus ring outside the button, where the pill's
  `overflow: hidden` cut it away. The ring is drawn inside the button now (`outline-offset: -2px`).

None was reachable by the scan: each needs a state no axe test drives. Each now has its own e2e test,
in `e2e/admin.spec.js` or `e2e/operations.spec.js`. It is the BH badges' lesson again.

### Leave panel "Remaining" label — `color-contrast` (SERIOUS), phone layout — ✅ FIXED (10 Nov 2026)

White at 0.6 on the glass measured 4.14:1 for its 10px text; the desktop scan could only call it
obscured. `.al-lb-lbl` takes `--on-navy-muted` (0.70) now: 5.0:1. Found by the new scan of the
Calendar's glass panels, which is why that scan exists.

## The surface the gate could not reach — the roster review table

The section above states the rule; this is the largest thing it had been hiding. The gate scans
**one rendered state per page**, and reaching this table needs a PDF upload driven through to a
parsed review — so for most of the gate's life it was never scanned at all, while "every page the
spec drives passes" stayed true and said nothing about it. Scanned by hand on
18 Sep 2026 it had 8 `color-contrast` violations in its default state, and more in the states one
tap away.

**The lesson is about diagnosis, not about the count.** The failures all pointed at `.shift-badge`,
so the obvious reading was that the badge component was wrong — and the obvious fix, recolouring it,
would have changed the Calendar, the admin grid, Overtime and the guides, and would not have worked.
Measured on their own, all nine badges clear AA (Early is the floor at 4.65:1). Every failure came
from an **ancestor `opacity`**, which axe composites, and which no colour choice can survive: a pair
clearing by 0.15 cannot be multiplied by 0.5 and still clear. Four such dims were replaced with cues
that cost no contrast. Full before/after table: `docs/ROADMAP_HISTORY.md` → "The roster review table was never
accessibility-scanned"; the reasoning that an editor needs beside the code is `operations.css` → the
dims note.

**What changed in this spec.** Two tests now drive the real upload and scan **four** states — the
default review, one row skipped, a whole member skipped, and a read refused by the alignment breaker
(reached through three genuine geometry refusals, not by adding the class). Each dim was
re-introduced with `scripts/mutate.mjs` and each turned the gate red.

**But the scan is not the witness for all of them.** The first pass fixed four dims and missed a
fifth — `.section-skipped`, the whole-member flip — because **axe reports nothing
for it**: measured directly, with every row at `opacity: .35` and plainly washed out in a
screenshot, the scan returned zero violations *and* zero `incomplete`, with and without the
`pointer-events: none` that state also sets. A state the gate cannot see is a state with no gate —
the same lesson this table taught in the first place, found a second time inside the fix for it.

So `faded()` in this spec now checks the MECHANISM directly: no element in the review may sit under
a fractional opacity, bar two exemptions that are both WCAG 1.4.3's inactive-component case — a
natively `disabled` control (exempted by that property, not by selector, so it does not go stale)
and `.roster-blocked .roster-tick`, whose clicks are returned early at the delegate. It found a
sixth faded element on its first run. It does not replace the scan: axe catches a bad colour pair at
full opacity that this cannot, and this catches a fade axe will not.

**One dim was deliberately kept.** `.roster-blocked .roster-tick` stays at `opacity: .35`. A tick in
a refused section is a genuinely inactive control — clicks are returned early at the delegate — and
an inactive user-interface component is the one thing WCAG 1.4.3 exempts. A SKIPPED row is not the
same case: its content is what the admin re-reads before changing their mind, so it got no exemption
and was fixed.

## `label-content-name-mismatch` (SERIOUS) — ✅ FIXED

WCAG 2.5.3, *Label in Name*, Level A. axe 4.14 runs it under the gate's WCAG tags, where 4.12 did
not, and it failed **27 of the gate's states** on one pattern: a control whose accessible name does
not contain its visible text. That is the failure for somebody driving a phone by voice, who says
what they see — "tap Prev", "tap AL" — and reaches nothing. The owner chose fixing over a waiver
(3 Nov 2026).

**axe matches WORDS, in order and side by side.** It splits both strings into words (case folded,
emoji and punctuation dropped, a bracketed aside removed) and passes only when the visible words are
one unbroken run inside the name's. So "Prev" is not in "Previous month", and a day cell printing
"20 Early 06:20-14:00" is not in "Friday 20 November 2026 — Early shift 06:20-14:00": every word is
there, with "November 2026" and "shift" standing between them.

Three ways the names were fixed. Reach for the first one next time:

- **Build the name from the strings the control shows.** The calendar's day cells (`dayCellParts`
  feeds both the cell and `dayCellName`), Operations' Needs-attention items (`text` is now
  `short: badge after`), the Links design picker (eyebrow, count and design name, in the face's
  order) and Admin's week label (named beside the line that writes its text).
- **Let the name come from the content**, and put what only an icon said in a visually hidden
  phrase at the end: the Pay Calculator's calendar rows.
- **Lead with the visible word** where the name is a fixed string: "Prev month", "AL — view annual
  leave balance", "Today — jump to current week", "PDF — save or print this guide", the drawer's
  "Marylebone Roster, Version … — about this app", and the Links paint chips and cells ("Paint: RD,
  rest day", "Line 9 Sat: SP, spare").

**One was the MARKUP, not the name.** The picker's eyebrow and count were adjacent spans with no
space between them, so the page's text read "Designs0 saved" — the single word "designs0", which no
name can contain — while the screen showed "DESIGNS · 0 saved", separated by CSS. A space between
the spans is not rendered in a flex row, and makes the text say what the screen does. Found by
asking axe's own functions inside the page; reading the rule said it should already pass.

**Three more, in states the gate had never scanned (6 Nov 2026).** The Team view's
week bar said "Previous week" under "← Prev" and its toggle "Switch back to monthly calendar" under
"Month" ("monthly" is not the word "Month"); the ARMED bulk delete said "Confirm delete selected
changes" under "⚠ Delete 2?". Each now leads with or carries the visible words — "Prev week",
"Switch back to the month view", "Confirm delete 2 selected changes" — and `axe.spec.js` scans the
Team view and both armed deletes, holding the five-second confirm open for the scan. Putting the old
names back fails both scans, on exactly those three controls. The lesson is the first rule's
converse: a state no scan opens is a state nothing checks, however clean the rest of the gate is.

**And that first Team view scan found a fourth on a phone** (`scrollable-region-focusable`, SERIOUS,
WCAG 2.1.1). Below desktop width the seven days do not fit, so `#gradeTabPanel` scrolls sideways — and
it held nothing focusable, so a keyboard user could not reach the days off-screen. Desktop Chrome
never saw it, because there the table fits; the phone projects failed in CI. The panel is now a tab
stop (`tabindex="0"`, as the ARIA tabs pattern advises for a panel with no focusable content), with an
inset focus ring because the panel is the box that clips. **Being focusable was half of it**:
← → are how a focused box scrolls, and the page's own shortcut turned them into a week
change first, so axe passed and the days stayed out of reach. The shortcut now leaves the panel's
arrows alone; `e2e/calendar.spec.js` → "→ on the focused team week table scrolls it" holds the
behaviour, which a scan cannot see.

**The gate sees four kinds of calendar day; a unit test walks all of them.**
`calendar-renderer.test.mjs` → "a day cell's name contains what it shows" drives every badge, the
six Other flavours with their three time slots, an unrecognised value and both permanent-shift
members through the real renderer, and holds each cell's name to what it prints, with axe's word
rule restated small. Mutation-checked: the old name order fails it on every cell.

**And Operations' Account status buttons (Nov 2026 review).** “Set email” was named “Set work email
for …”, and Cancel, Confirm?, Removing…, Resetting…, Retry and the Reset ✓ receipt kept the name of
the state before. One helper now sets the words and the name together, the name leading with the
words; `e2e/operations.spec.js` scans the card with axe's rule in every state.

## Guarded by convention, not by the gate

- **`aria-expanded` must follow a programmatically-opened card — ✅ RESOLVED.** A few coordinators
  opened a collapsible card/disclosure by adding the `.open` class directly (the auto-open /
  deep-link paths) without updating `aria-expanded`, so an auto-opened card reported
  `aria-expanded="false"` until the first manual toggle self-corrected. All such paths now keep the
  control's ARIA state in step: `admin-app.js` via its `openCollapsibleCard(body, chevron)` helper,
  `links-app.js`'s generator auto-expand sets `aria-expanded` alongside `.open`, `paycalc-settings.js
  setSettingsCardOpen` mirrors `initCardCollapse`, and the paycalc "more options" auto-expand
  (`loadPeriodData`) now routes through the shared `_setDisclosure(btnId, bodyId, open, …)` (which
  `_toggleDisclosure` also delegates to) instead of a class-only `.open`. The axe gate can't catch
  this class (it scans a settled state), so it's guarded by convention, not the gate.

## Waived rules

No blanket rule waivers. One targeted per-page **element exclusion**: calendar `.other-month` (faint,
`aria-hidden` adjacent-month day numbers — see #2). When accepting anything else, add a `GLOBAL_WAIVERS`
entry or a page `exclude` in `axe.spec.js` **with a one-line reason**, and record it here.

## Promotion path — ✅ COMPLETE

1. ~~Fix `nested-interactive`~~ ✅ 2. ~~Fix `color-contrast`~~ ✅ 3. ~~Green on both projects~~ ✅
4. ~~Make it block (`test:e2e` includes `@a11y`)~~ ✅
5. ~~Wire more rendered STATES per page beyond the one settled snapshot~~ ✅ — forced transient
states (sync-chip, active pills); **open-overlay states (H2): the login overlay, the nav drawer
open, and the About lightbox open**; and since 10 Nov 2026 the Calendar's day, leave and Team View
help panels, and Operations with every card open — each a full interactive surface (focus trap,
buttons, headings) the settled scans can't reach. All axe-clean.

**CI gate — ✅ in place.** The axe `@a11y` spec runs as part of `npm run test:e2e`, and the `smoke`
job in `.github/workflows/e2e.yml` runs it on every branch/PR, one job per Playwright project — so a
new WCAG A/AA violation fails CI, not just the local run. (A dedicated standalone `test:a11y` CI job
would only add attribution clarity — the gate itself is already blocking through `smoke`.)
