# A11Y_BASELINE.md — accessibility gate baseline

*Not version-stamped; not a runtime asset. Every finding recorded here is fixed, so the file is the
gate's baseline and the rules its findings left behind, not a list of open problems. Each fix's full
story is in git.*

`e2e/axe.spec.js` runs the [axe-core](https://github.com/dequelabs/axe-core) engine against the
fully-rendered states of every page (WCAG 2.0/2.1 A + AA). Run it with **`npm run test:a11y`**.

It is a **floor**: axe catches the machine-checkable ~third of real issues (labels, names, contrast,
ARIA, duplicate ids). It does not replace a manual screen-reader pass.

**Open items: one, and it is not a finding.** What has never been done is a **manual screen-reader
pass** — somebody driving the app with VoiceOver or TalkBack and listening to it. That is the only
way to reach the two-thirds axe cannot: reading ORDER, whether announcements arrive at a useful
moment, whether a live region interrupts something the user was in the middle of, and whether the
app is usable by ear at all. It needs a person and a device, not a test run.

**What the pass must listen for, by name.** A live region held at `display: none` is not in the
accessibility tree, and screen readers differ on whether it speaks when it is switched on. axe cannot
tell: it checks that a live region exists, not that anybody heard it.

- **The sign-in and set-password error boxes.** `.login-error` stays hidden until it gains
  `.visible`, and both pages write the message before the class goes on (`showError` in
  `login-overlay.js`, `setError` in `password-force.js`). On an iPhone and on an Android phone, type
  a wrong password and confirm that "Password not recognised…" is read out. If it is not, keep the box
  rendered and change only its text: box first, words second.
- **Admin's and Operations' status lines.** `.feedback`, `.list-feedback`, `.huddle-filename` and
  `#authSetupResult` are live regions held at `display: none` until a class shows them. Listen for
  one of each: a Change a Shift save, a deletion from Saved Changes, a chosen upload file and the
  result of Set up accounts.

## Current status — ✅ GREEN + BLOCKING

Every state the spec drives passes on both projects (Desktop Chrome + Pixel 5), and the gate is part
of `npm run test:e2e` — a new WCAG A/AA violation fails the suite. `npm run test:a11y` runs it
standalone (chromium). One documented per-page exclusion remains (calendar `.other-month`; see #2).

**A green a11y scan is a statement about the state that was scanned, not about the page.** If a
surface only appears under a condition — a bank holiday, an error, a populated list, an armed button,
a phone width — the gate is silent on it until something puts it there. Every finding below that the
scan had missed was in a state no test drove, and each was closed by driving that state.

## Findings (baseline, Jul 2026)

### 1. `nested-interactive` (SERIOUS) — ✅ FIXED

A collapsible card's whole header was the toggle while holding a real `?` button. **The rule:**
`initCardCollapse` (overlay.js) makes the **chevron/arrow** the focusable toggle (`role="button"` +
`aria-expanded`/`aria-controls` + an `aria-label` from the card heading) and leaves the header
**non-interactive**, with a mouse-only click convenience that ignores clicks on any nested control.
The no-chevron case falls back to the header as the toggle.

### 2. `color-contrast` (SERIOUS) — ✅ FIXED

Muted text and badges below 4.5:1 across the guides, the Calendar, the Pay Calculator and Admin.
**How they were fixed, which is how the next one is:** darken the token just enough to clear AA while
keeping the hue; where white text cannot clear, use a darker text token on the tint (`--orange-text`,
`--al-text`, `--rdw-text` in `shared.css`, owner-approved for `.badge-sat`) and let the tint and
border keep the badge's identity; **never `opacity`** to mute text — it cannot meet AA.

- **Documented exclusion:** the calendar's faint **other-month day numbers** are `aria-hidden`
  decorative context (darkening them defeats the "not this month" cue for zero SR benefit), so they
  are `.exclude('.other-month')`d in the calendar scan — a targeted exclusion, not a rule waiver. The
  **Links Selector** draws the same grid with the same filler days (it builds the Calendar's cells), so
  its two scans take the same exclusion and nothing more (27 Nov 2026).

## Functional-emoji screen-reader treatment (H1)

**The convention:** an emoji that duplicates adjacent text is `aria-hidden` (shift badges wrap the
glyph); an emoji that is the sole label of a control or marker carries an accessible name (every
emoji-only button — 📍/☰/✕/✎/🔔 — has an `aria-label`; the calendar day cell's `aria-label` carries
payday/cut-off, so the CSS `::before` markers are decorative). A marker conveyed by emoji + `title`
alone is not announced reliably: the Change a Shift per-day badge (`renderWeekGrid`,
`admin-week-editor.js`) is `role="img" aria-label="<title>"`.

### Transient status glyphs — ✅ FIXED

The helper is `status-text.js`. `setStatus(el, '✓ Settings saved')` puts the glyph in an
`aria-hidden` span, so the announcement is the sentence and nothing else. The glyph is split OFF the
message rather than passed separately, because a signature that made every caller take its composed
message apart would be done to half the sites — and the half left behind look identical in the source.
It covers every call site, the `innerHTML` templates that carry markup of their own (wrapped by
hand), and the two static `role="alert"` regions in `paycalc.html` (`#pensionWarn`, `#satWarn`).
`login-overlay.js` and `paycalc-lightboxes.js` delegate to it.

**Buttons are deliberately excluded.** `✓ Resolve` is a stable accessible NAME, matched by
`getByRole('button', { name })` and announced once on focus rather than interrupting a reader
mid-sentence. If it is taken on, it is its own pass with its own test surface.

**Why it has its own guard:** rendering is byte-identical, `textContent` reads back unchanged and axe
has no rule for "a decorative glyph that was not hidden", so nothing else can see it.
`status-glyph-parity.test.mjs` enforces it in the three shapes it can break (markup, `textContent`,
`innerHTML`), plus that the helper is imported wherever it is called.

### BH rate badges — `color-contrast` (SERIOUS) — ✅ FIXED

`#badge-bh` / `#badge-bhot` on paycalc rendered `--al` on `--al-light`, **4.16:1**. They use
`--al-text` (5.98:1), the token beside `--orange-text` and `--rdw-text` for exactly this case; the
border keeps `--al` (a non-text element, 3:1). Admin's `.al-banner-stat .stat-val` was corrected with
it. The gate had missed it twice over: the badges render only when the pay period holds a bank
holiday, and the one run that had them on screen also had the Year to Date notice open over them (axe
does not flag what sits behind an open dialog) — so **suppress a notice by its real key, and drive the
conditional state**.

### Admin and Operations, five reader-facing contrasts and a clipped ring — `color-contrast` / focus — ✅ FIXED (Nov 2026)

Each measured on its own background, and each in a state no axe test drives, so each has its own e2e
test (`e2e/admin-layout.spec.js`, `e2e/admin-leave-records.spec.js`, `e2e/operations.spec.js`):
Admin's leave-left chip at 1–5 days (`--al-low`, 6.28:1); Admin's "⚠ Removing" badge (white on
`--orange-deep`, 5.24:1); the AL banner's entitlement note (unfaded, 5.97:1, quieter by its size);
Operations' Staff Login Accounts leaver line (`--error-text`, 6.63:1, its remedy unfaded); and the App
Speed and Usage month toggle, whose focus ring the pill's `overflow: hidden` clipped
(`outline-offset: -2px`, drawn inside the button).

### Leave panel "Remaining" label — `color-contrast` (SERIOUS), phone layout — ✅ FIXED

White at 0.6 on the glass measured 4.14:1 for its 10px text; `.al-lb-lbl` takes `--on-navy-muted`
(0.70): 5.0:1. Found by the scan of the Calendar's glass panels, which is why that scan exists.

## The surface the gate could not reach — the roster review table

Reaching this table needs a PDF upload driven through to a parsed review, so for most of the gate's
life it was never scanned; scanned by hand it had 8 `color-contrast` violations in its default state.
**The lesson is about diagnosis:** the failures all pointed at `.shift-badge`, but measured on their
own all nine badges clear AA (Early is the floor at 4.65:1). Every failure came from an **ancestor
`opacity`**, which axe composites and no colour choice can survive. Recolouring the badge would have
changed the Calendar, the admin grid, Overtime and the guides, and would not have worked. The dims
became cues that cost no contrast; the reasoning an editor needs is `operations.css` → the dims note.

**What the spec does.** Two tests drive the real upload and scan **four** states — the default
review, one row skipped, a whole member skipped, and a read refused by the alignment breaker (reached
through three genuine geometry refusals, not by adding the class). Each dim, re-introduced with
`scripts/mutate.mjs`, turns the gate red.

**The scan is not the witness for all of them.** axe reports nothing for `.section-skipped` (every row
at `opacity: .35`, plainly washed out): zero violations and zero `incomplete`. So `faded()` in this
spec checks the MECHANISM directly: no element in the review may sit under a fractional opacity, bar
two exemptions that are both WCAG 1.4.3's inactive-component case — a natively `disabled` control
(exempted by that property, not by selector, so it does not go stale) and `.roster-blocked
.roster-tick`. It does not replace the scan: axe catches a bad colour pair at full opacity that this
cannot, and this catches a fade axe will not.

**One dim was deliberately kept.** `.roster-blocked .roster-tick` stays at `opacity: .35`. A tick in
a refused section is a genuinely inactive control — clicks are returned early at the delegate — and
an inactive user-interface component is the one thing WCAG 1.4.3 exempts. A SKIPPED row is not the
same case: its content is what the admin re-reads before changing their mind, so it got no exemption.

## `label-content-name-mismatch` (SERIOUS) — ✅ FIXED

WCAG 2.5.3, *Label in Name*, Level A: a control whose accessible name does not contain its visible
text fails somebody driving a phone by voice, who says what they see — "tap Prev", "tap AL" — and
reaches nothing. The owner chose fixing over a waiver (3 Nov 2026).

**axe matches WORDS, in order and side by side.** It splits both strings into words (case folded,
emoji and punctuation dropped, a bracketed aside removed) and passes only when the visible words are
one unbroken run inside the name's. So "Prev" is not in "Previous month", and a day cell printing
"20 Early 06:20-14:00" is not in "Friday 20 November 2026 — Early shift 06:20-14:00".

Three ways to fix one. Reach for the first:

- **Build the name from the strings the control shows.** The calendar's day cells (`dayCellParts`
  feeds both the cell and `dayCellName`), Operations' Needs-attention items (`short: badge after`),
  the Link Designer design picker and Admin's week label.
- **Let the name come from the content**, and put what only an icon said in a visually hidden
  phrase at the end: the Pay Calculator's calendar rows.
- **Lead with the visible word** where the name is a fixed string: "Prev month", "AL — view annual
  leave balance", "PDF — save or print this guide", "Prev week", "Confirm delete 2 selected changes".

**Check the MARKUP, not only the name.** Adjacent spans with no space between them read as one word
("Designs0 saved") that no name can contain; a space between spans in a flex row is not rendered and
makes the text say what the screen does. Ask axe's own functions inside the page when reading the rule
says it should already pass.

**States the gate had not scanned** — the Team view and both armed bulk deletes (the five-second
confirm held open) — are scanned now. The Team view's scan also found `scrollable-region-focusable`
on a phone: `#gradeTabPanel` scrolls sideways below desktop width, so it is a tab stop (`tabindex="0"`,
as the ARIA tabs pattern advises) with an inset focus ring, and the page's arrow shortcut leaves the
focused panel's ← → alone — a scan cannot see that, so `e2e/calendar-team-view.spec.js` → "→ on the
focused team week table scrolls it" holds it.

**The gate sees four kinds of calendar day; a unit test walks all of them.**
`calendar-renderer.test.mjs` → "a day cell's name contains what it shows" drives every badge, the
six Other flavours with their three time slots, an unrecognised value and both permanent-shift
members through the real renderer, and holds each cell's name to what it prints, with axe's word
rule restated small. Operations' Account status buttons set their words and name together through one
helper, the name leading with the words; `e2e/operations.spec.js` scans the card with axe's rule in
every state.

## Guarded by convention, not by the gate

- **`aria-expanded` must follow a programmatically-opened card.** A coordinator that opens a
  collapsible card or disclosure by adding `.open` directly must update the control's ARIA state too,
  or an auto-opened card reports `aria-expanded="false"` until its first manual toggle. The paths:
  `admin-app.js` via `openCollapsibleCard(body, chevron)`, `link-designer-app.js`'s generator auto-expand,
  `paycalc-settings.js setSettingsCardOpen` (mirrors `initCardCollapse`), and the paycalc "more
  options" auto-expand through `setDisclosure(btnId, bodyId, open, …)` in `paycalc-disclosures.js`.
  The axe gate can't catch this class (it scans a settled state).

## Waived rules

No blanket rule waivers. One targeted per-page **element exclusion**: calendar `.other-month` (faint,
`aria-hidden` adjacent-month day numbers — see #2), on the Calendar and on the Links Selector, which draws its grid. When accepting anything else, add a `GLOBAL_WAIVERS`
entry or a page `exclude` in `axe.spec.js` **with a one-line reason**, and record it here.

## Promotion path — ✅ COMPLETE

1. ~~Fix `nested-interactive`~~ ✅ 2. ~~Fix `color-contrast`~~ ✅ 3. ~~Green on both projects~~ ✅
4. ~~Make it block (`test:e2e` includes `@a11y`)~~ ✅
5. ~~Wire more rendered STATES per page beyond the one settled snapshot~~ ✅ — forced transient
states (sync-chip, active pills); **open-overlay states (H2): the login overlay, the nav drawer
open, and the About lightbox open**; the Calendar's day, leave and Team View help panels; and
Operations with every card open — each a full interactive surface the settled scans can't reach.

**CI gate — ✅ in place.** The axe `@a11y` spec runs as part of `npm run test:e2e`, and the `smoke`
job in `.github/workflows/e2e.yml` runs it on every branch/PR, one job per Playwright project — so a
new WCAG A/AA violation fails CI, not just the local run.
