---
paths:
  - "links.html"
  - "links.css"
  - "links-*.js"
  - "links-*.test.mjs"
---

# Links workspace — full architecture

> **The `paths:` list above uses GLOBS, and must stay that way** (fixed Aug 2026). It enumerated five
> filenames from the extraction-programme era and had silently stopped covering **nine of the
> sixteen** Links files — every module added since (`links-analysis`, `-compare`, `-concurrency`,
> `-deletion`, `-fatigue`, `-boot`) plus their tests. Editing any of them did not surface this
> document, which is the one place the workspace's decisions are written down. Same failure as the
> enumerated class list fixed at v19.49 and the `selectBackupKeys` prefix scan: a hand-maintained
> list stops covering what arrives after it, and nothing says so. `paycalc.md` already globbed.

## The module set

The workspace is one coordinator over eight pure/extracted modules. Everything except `links-app.js`
is testable without a browser, which is deliberate — the coordinator is where the Firestore and DOM
state lives, and the rules that have historically produced bugs have been pulled out of it.

| Module | Owns |
|--------|------|
| `links-app.js` | coordinator: Firestore, grid, paint, picker, save/dirty state (+ `links-boot.js`, the CSP bootstrap) |
| `links-design.js` | the design maths — classification, coverage, the generator, `runDesignChecks`, `endMinutesAbs` |
| `links-fatigue.js` | the ORR p3 fatigue factors (v19.46) |
| `links-window.js` | the staffed OPERATING WINDOW — when the station is open (v19.54) |
| `links-demand.js` | the SERVICE that window has to cover — trains per hour (v19.56) |
| `links-analysis.js` | the two read-only panels — Coverage heat map + Design checks — rendered from those pure results |
| `links-compare.js` | compare mode; sole owner of `compareMode`/`compareDesignId` |
| `links-concurrency.js` | the co-editing rules (three historical silent-overwrite bugs, one test each) |
| `links-deletion.js` | the soft-delete/restore/purge rules |
| `links-adjacency.js` | what happens BETWEEN the lines — the ORDER they sit in (v19.58) |

## Access control

- `NAV_PAGES` entry has `linksDesignerOnly: true`. `initNavPanel({ isLinksDesigner })` filters it out for non-designers.
- Each page passes `isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member)`. `links-app.js` passes `isLinksDesigner: true` (page already guards non-designers, redirecting to `admin.html`).
- To grant access: add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` — every page derives `isLinksDesigner` from that list. Current designers: `'G. Miller'`, `'S. Silva'`, `'M. Robson'`.
- **Two more steps, or the new designer can open the page and not save a thing.** The client list only decides what the nav and the page gate show; the `linksDesigner` CLAIM comes from the server-owned `functions/roster-members.json`. So (1) run `npm run generate:roster-members` in the same commit — `sw-asset-check.test.mjs` fails the build if it drifts — and (2) after deploy, run **Operations → Set up accounts**, which is what actually mints the claim. Until then every save permission-denies (`writeWithClaimRetry` refreshes the token, but a refresh can't invent a claim the server never set).
- **Server-side (the real control):** `linkDesigns` writes require the `linksDesigner` or `admin` claim (H2, v16.29). **Reads require a `name` claim** (v19.39) — a session that has actually signed in as a member. The previous `request.auth != null` was intended as "any signed-in member", but the calendar signs every visitor in anonymously, so it admitted anyone who could open the app URL. Reads are deliberately NOT gated on `linksDesigner`: a designer whose token predates that claim has to be able to LOAD the page for the write self-heal (`writeWithClaimRetry`) to get its chance to run.
- **Delete is a soft delete (v19.41).** `✕` writes `deletedAt`/`deletedBy` (a MERGE write — a replace would push the deleting device's copy of `patterns` over the server's) and the design moves to **🗑 Recently deleted**, restorable for `SOFT_DELETE_RETENTION_DAYS` (30), then purged on load. Restore clears both fields with `deleteField()`. All the decisions are pure and tested in `links-deletion.js`; the coordinator owns only the Firestore calls and the panel. Notes that matter when changing this:
  - **`isDeleted` and `isPurgeable` are not mirrors.** An unresolved `deletedAt` — what `serverTimestamp()` reads back as on the writing device — is DELETED but never PURGEABLE. Both directions are load-bearing and both have tests.
  - **A save against a design someone else deleted does not resurrect it.** `saveChanges` detects the deletion in the transaction and offers "Save mine as new" instead — an overwrite there would be one designer undoing another's delete without ever seeing it.
  - The 30 days is a client policy enforced by a load-time purge, not a server rule. See KNOWN_LIMITATIONS.md → Links for the full list of what that does and does not promise.

## The beta marker — REMOVED v19.50

The header carried a gold-OUTLINE `.beta-chip` ("Beta") beside the "🔗 Links" `.badge-page` from
v12.33, with a finite `beta-sheen` sweep (v18.31). Owner decision, Aug 2026: the workspace is the
tool the December 2026 proposals will actually be built in, so it is no longer being announced as a
sketch. The chip, its keyframes and the reduced-motion override are gone; `.header-end` stays, since
it is the flex wrapper the page badge lives in.

## First-visit notice (rewritten v19.51)

`#linksWelcomeLb` — one-time, `createLightbox`, gated on `myb_links_welcome_seen`, **14-day expiry**
(owner, Aug 2026; the skill's default is 28). It replaced the v12.33 beta notice, whose lead
paragraph — "this is an early beta… the finished version will look quite different" — described a
page that stopped existing at v19.50. Only the paragraph that was still true survived; it now sits
with two more, chosen for what a first-time visitor could otherwise get **wrong**:

1. Changes affect the link-design document only, never the live roster. Desktop or tablet.
2. The Design checks report which ORR fatigue factors a pattern **features** — they do not pass or
   fail a design and nothing here approves one. (The panel says this too; a designer who reads only
   the first screen should still not be able to mistake a clean panel for an approval.)
3. Designs are shared, and a deleted one is restorable for 30 days.

**It took a NEW storage key.** Reusing `myb_links_beta_seen` would have meant every current designer
— all three of whom closed the beta notice months ago — never saw the replacement, which is the whole
point of bringing it back. The e2e specs seed the new key; the old one is left on devices as an inert
flag.

**Know what expiry does before setting one.** `isNoticeExpired` marks the notice seen *without
showing it*, so from ~16 Aug 2026 this lightbox is dead code on any device that had not already
opened the page. That is correct for an announcement — and it is why both of the app's previous
notices sat silently inert. CLAUDE.md's notice table now carries a Status column so that state is
visible rather than inferred.

## Design and save model (v12.09, redesigned v12.39–v12.43, multi-design v12.46–v12.47)

### Card order (v12.46)
Grid (primary object) → Auto-generator (collapsed by default) → Coverage (hourly heat map) → Design checks. The generator sits directly beneath the grid because it is the only way to create a new design.

### Firestore model (multi-design, v12.46)
`linkDesigns` is a **collection** of named design documents `{ name, patterns, updatedAt, updatedBy }` with auto-IDs. The legacy singleton `linkDesigns/combined-28` (no `name` field) is auto-migrated to a named design ("Design 1") on first load and thereafter ignored — never write to it.

A picker strip switches designs: **+ New** (blank), **⎘ Duplicate** (forks the LIVE in-memory patterns, unsaved edits included), **✎ Rename**, **✕ Delete** (disabled on the last design). Designs sort by name; the active design id persists via `lsGet('myb_links_active_design')`. Picker chips are a `<div>` wrapping separate `<button>`s — **buttons must not nest**.

### Compare mode (v12.46)
With ≥2 designs, shows two read-only grids side-by-side (≥1024px) or stacked, with a gold-outline diff on differing cells. Each compare column keeps `overflow-x:auto` even on desktop. The main grid stays **rendered** in compare mode — hidden on screen only (`body.links-compare-on` + `@media screen`) so print always outputs the active design. A print-only `#printDesignName` label names the printed sheet.

### patterns data shape
`patterns` is `{ "1"–"28": { sun, mon, tue, wed, thu, fri, sat } }` (each value a shift string, `"SPARE"`, or `"RD"`). **Position keys:** always `String(pos)` (`"1"`–`"28"`), never `Number`.

Staff names were removed at v12.39 — the design is patterns-only ("Line 1", "Line 2"…); who goes on which line is decided after patterns are agreed. Legacy `meta` in old docs is ignored on load and dropped on next save.

### Pure-maths module
All design maths live in `links-design.js` (no DOM, no Firebase; tested by `links-design.test.mjs`) — `classifyShift`, `normaliseCustomShift`, `calcCoverage`, `calcHourlyCoverage`, `generateLink`, `generatePatterns`, `groupIntoWaves`, `WAVE_SPAN_MINUTES`, `runDesignChecks`, `dayClass`, `endMinutesAbs`. `links-app.js` imports these; do not duplicate them back into the app file. The ORR fatigue factors sit alongside in `links-fatigue.js` (v19.46), which imports from here — see the module table above for the full set.

### Save and dirty flag
Single dirty flag + one `linksSaveBtn` / `saveChanges()`. Grid clicks are **delegated** on `#linksGridBodyRows` — do NOT call `renderGrid()` from inside `saveChanges()`.

**Unsaved-changes guard:** `beforeunload` + explicit `confirm()` on sign-out, logo navigation, and a capture-phase click guard on nav-drawer links (mobile browsers suppress `beforeunload` dialogs).

### Aesthetic conventions (v19.43 polish pass)

- **A brush chip shows BOTH times, on two lines, exactly like the grid cell it paints.** It showed the start only until v19.43, and the roster has five distinct shifts starting 06:20, three starting 08:00 and so on — so the bar rendered as seven pairs of visually identical chips that paint different shifts, with the start time in `title` and `aria-label` too. Nothing anywhere disambiguated them. Do not "tidy" this back to a single time.
- **The picker strip is always visible**, even with no designs: the empty state tells you to tap `+ New`, which lives inside it, and the bin button lives there too.
- **`.design-chips` uses `min-width: min-content`, not `0`.** `0` lets a flex item shrink below its own contents, and the chips are `nowrap` — at 390px the box collapsed to 50px while the active chip stayed ~120px and its ✎ ✕ painted on top of "+ New".
- **Overlay panels take their surface from an id rule or a modifier class** — `.lb-content` alone is only transform/scroll/cursor. The Recently-deleted panel shipped at v19.41 with the bare class and rendered as a transparent box (heading and prose in navy on the dimmed backdrop). It now joins the compact-dialog family, and `e2e/visual.spec.js` has a baseline for it, because behaviour tests cannot see this.
- **Row actions reuse `.dialog-btn` + `.dialog-btn-confirm`/`-cancel`** from shared.css rather than a page-local recipe — that brings the 44px touch target and press feedback with them.
- **The Design checks card is a 30-row list, so it needs structure, not just rows** (v19.49). Three things carry it, and each replaced something that read as noise: `.check-section-head` gains a **hairline rule** and its **headline counts** at the far end (`3 present · 2 standing · 3 to confirm`) — a small uppercase label alone was not enough weight to break a ribbon of same-height rows, and the reader should not have to tally 24 icons to get the summary; `.check-code` is a **fixed-width tag** so the FF numbers align down the left edge (they were `.check-note`, the faintest thing in the row, running inline with the title and vanishing into wrapped prose on mobile — cross-referencing the ORR's own p3 list is the panel's whole job); and `.check-family` names the ORR's **families**, without which the code column read as shuffled. The factors are also ordered by number **within** each family. Counts keep `present` and `standing` separate — an unavoidable characteristic of the operation is not a finding about the design, and one combined total would say it was.
- **Accepted, not fixed:** each compare column keeps `overflow-x: auto` with no scroll affordance, so at 1280px both grids clip mid-column with nothing indicating they scroll. Adding a fade would fight the gold diff outline; the alternative is a narrower cell, which hurts the primary (single-design) view. Revisit only with a real complaint.

### Paint mode (v12.39)
A brush chip bar above the grid (`#brushBar`) — clicking a chip arms that shift; clicking grid cells then applies it directly (no dropdown); clicking the armed chip again or pressing Escape disarms. With no brush armed, a cell click opens the dropdown as before. `.shift-cell-btn` and `.brush-chip` set `touch-action: manipulation` — paint mode is rapid tapping, which otherwise triggers double-tap zoom on iOS/Android.

### Night shifts
**CEAs do not work night shifts (confirmed by Gareth June 2026)** — night times are never offered in any dropdown or brush chip. `normaliseCustomShift()` rejects starts between 21:00 and 03:59 **and any wrapping (past-midnight) end**; do not re-add a Night option and do not relax either guard. `classifyShift`'s `night` return is defensive only (legacy/imported data).

**A duty that does run past midnight is read in ONE place — `endMinutesAbs`** (v19.47). Before it, `calcHourlyCoverage` and `runDesignChecks` each carried their own inline expression and both erred the same way, towards *safer than the truth*: the heat map clamped the end to 24:00 and simply lost the post-midnight hours, and the turnaround check computed `(1440 − end) + start`, so a 00:30 finish before an 06:20 start reported ~26h of rest instead of 5h50 — the most dangerous turnaround the module can express, scored as compliant. The heat map now counts such a duty on **both** days (Sat spills round to Sun) and `links-fatigue.js`'s `dutyMinutes` delegates here. This is only reachable through legacy/imported data — the same route `canonicaliseShift` exists for — which is exactly why it is worth keeping correct: nothing exercises it, so nothing would tell you.

**Shift option lists:** `EARLY_SHIFTS` / `LATE_SHIFTS` derived from `weeklyRoster` + `bilingualRoster` at module load — never a static list. **Custom time…** validated by `normaliseCustomShift()`.

### The staffed operating window (v19.54)

Stored on each design as `window` (`{monSat,sun}:{start,end}`), defaulting to Mon–Sat 06:20–23:55 ·
Sun 07:15–23:25. All the rules are the pure `links-window.js`; the coordinator owns only the editor
on the Coverage card and the Firestore field.

**It exists because the heat map could not see missing cover at the ends of the day.** The span ran
first-worked-hour → last-worked-hour and a gap had to fall strictly between them, so a design where
everybody finishes at 14:20 — leaving the station unstaffed to the 23:55 close — showed **no gaps at
all**. It now shows 71. Span and gaps both come from the window; an hour outside it renders
`heat-closed` (hatched, inert) because a shut station is not a hole in the cover and must never look
like one.

Three rules that are easy to undo by accident:

- **Compare mode diffs CELLS, not windows.** Two designs built to different spans would read as like
  for like — the per-design override becoming a way to make an unfair comparison look fair. Both
  column headers state the window and `windowsDiffer` flags a mismatch; the printed masthead states
  it too. Never render a comparison without them.
- **`normaliseWindow` falls back per ROW, never per FIELD.** A good Sunday survives a corrupt
  Mon–Sat; a stored start is never paired with a default end, because that invents a window nobody
  chose and then prints it as deliberate.
- **TEXT inputs, not `<input type="time">`.** Chromium renders that widget in the OS's 12-hour
  format *even at en-GB* (measured in both locales), which would put "11:55 PM" beside a grid, heat
  map and window line all reading 23:55. `canonicaliseWindowTime` does the padding.

Three things the v19.55 pass fixed, all found by driving the page rather than reading it:

- **A design carries its window through the BIN.** The bin kept patterns but not the window, so a
  restore handed back a design wearing the app default — and the next save wrote that default
  straight over the moved boundary it was actually built to. Same class as the v19.41 restore bugs.
- **`renderCoverageCard()` renders the chart AND the editor**, in one call. They are one card, and
  as two calls every site had to remember both. The generator — the only way to create a design —
  refreshed the chart through `renderGrid` but never painted the editor, so a designer's very first
  link had no visible window control until they reloaded.
- **`.win-editor[hidden] { display: none }` is mandatory, not tidiness.** An author `display` rule
  beats the `hidden` attribute's UA `display:none`, so the editor rendered on a page with no design
  at all. Missed on the first pass because the probe read `el.hidden` — the property, correctly
  true — instead of what the browser actually painted.

The window is stated **once** on screen: by the editor's own fields, under a "Staffed window"
eyebrow. A prose line repeating the same two times 20px below it was removed — duplication like
that reads as a second, possibly different, fact. On paper the editor is hidden and the print
masthead carries it. The reset control reuses `.btn-text-link`, this stylesheet's existing small
text button, rather than a second link-button recipe.

An invalid pair (finish at or before start) is **refused, not coerced** — and the refusal message is
written AFTER the repaint, because `paint()` rewrites the status line from the stored window and
would otherwise wipe it in the same tick, leaving the field to appear to revert for no stated reason.

### Coverage heat map (v12.40; demand overlay v19.56)

The Coverage card renders an **hour-by-hour table** (`calcHourlyCoverage`) — rows = days, columns = hours spanning the staffed window, cell = on-duty headcount, intensity buckets `heat-b0`–`heat-b5` (color-mix tints of `--cov-early`, scaled to the week's peak).

The station is staffed in **waves** (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+) — do not revert to per-type stacked bars. A red `0` inside the staffed window marks a coverage gap; spares get their own `SP` column. The grid `tfoot` keeps compact per-day `E:/L:/SP:` counts.

**Beneath it, three DEMAND rows** (`links-demand.js`) — the December 2026 service, one row per day class, in the **same table** so a reader comparing cover against service is comparing columns rather than fighting two horizontal scrolls. Rules that are easy to undo:

- **A different hue is load-bearing.** Demand uses `--cov-late` orange against the cover's `--cov-early` blue. Two rows of the same colour in one table mean two different things in two different units (people · cars), and the eye reads the darker one as more of the same.
- **Separate scales, stated.** Each half is shaded against its own peak; the note tells the reader to compare shapes, not depth of colour.
- **Never score the design.** No "covers N% of demand". Same principle as the fatigue panel — show, do not decide.
- **The finding/fact split is the anti-cry-wolf rule.** `uncovered` (open, trains running, nobody on) is a finding and renders red. `outside` (trains when the station is shut) is a neutral fact: the last trains and the 05:5x first departure are outside the window on **every** design there has ever been, so flagging them would fire forever and teach the reader to skip the row.
- **Ask the boundary question to the MINUTE, never by the hour.** This shipped broken once. Sunday closes at 23:25, so `isHourStaffed('sun', 23)` is TRUE and an hour-level test reported the five post-23:25 movements as fully covered — the one live finding the feature exists for, invisible in it, with a green unit test that used a synthetic whole-hour window. `summariseDemand` takes the window in **minutes**, and the profile stores **times**, not hourly buckets, precisely so the hourly question cannot be asked by accident.
- The `dem-shut` cell marker comes from the same summary the prose reads, so a marked cell and a named movement can never disagree. It marks hour 06 as well as hour 23 — three weekday trains run before the 06:20 opening.

### The sticky summary bar (v19.57)

The grid card's save row is `position: sticky; bottom: 0` and carries three live figures plus a jump
link. **It exists because the feedback loop was broken by distance**: the grid card is ~1,400px tall
and the Coverage and Design-checks cards start ~1,600px and ~2,300px below the fold (measured at
1440×900), so editing meant paint a cell → scroll two screens → read → scroll two screens back. The
analysis already updated live; you could not see it happen.

- **Which three, and why not others.** Lines still undesigned (nothing else matters until it is zero),
  staffed hours with trains and nobody on duty, and fatigue factors **present**. `standing` is
  deliberately excluded — an unavoidable characteristic of the operation is not something an edit can
  improve, and putting it in a number the designer is trying to drive down tells them to chase the
  unchaseable. It is **not a score**, for the same reason the panels it summarises are not.
- **`renderSummary` recomputes rather than reading the other renderers' results.** Duplicated WORK,
  not duplicated LOGIC — each figure still comes from the one pure function that owns it — bought in
  exchange for order-independence. Shared state would make the strip silently wrong whenever a caller
  ran the three renderers in a different order, which renders fine and tells nobody.
- `sticky` works here without a scroll container because the card uses `overflow: clip` at ≥1024px
  (chosen for the sticky `thead` precisely because it does NOT create one). The bar keeps its place in
  flow, so it can never cover the last grid row.

### Design checks (v12.39, completeness added v12.41; fatigue factors added v19.46; quiet rows collapsed v19.57)

The card has **two halves**. The first is `runDesignChecks(patterns, 28)`:
- **Unfilled lines** (any line that is entirely rest days is *not yet designed*, not a vacancy)
- Weekends off (Sat of line w + Sun of line w+1, wrapping)
- Short turnarounds (<12 h rest between consecutive timed shifts across the full circular rotation)
- Longest consecutive-worked-days run
- Early/late balance

Renders plain-English traffic-light rows (completeness first); updates live on every cell edit / generate. All 28 lines rotate and are checked.

### Fatigue factors — ORR good practice, p3 (v19.46)

The second half of the card, from `links-fatigue.js`. It exists because the December 2026 proposals
will be **assessed** against that list (`LINKS_DEC2026_PLAN.md`), and `runDesignChecks` covered two
of its 24 factors. Read the module header before changing any rule; the four things that govern it:

- **It reports factors PRESENT. It never passes or fails a design.** The ORR states these are not
  prescriptive limits, so red/green would misrepresent the guidance being quoted. Amber
  (`.check-warn-row`), never `.check-bad` red.
- **The dominant risk is FALSE ASSURANCE**, not a missing rule — a design showing nothing and being
  read as approved. So CLEAR and NOT-APPLICABLE report themselves too: silence must never be the
  same shape as compliance. **Never hardcode a status.** FF13's was hardcoded `clear` for one
  version and put a green tick directly beneath the amber short-turnaround row it is the same
  finding as; it now reads from `runDesignChecks`, so the two cannot disagree.
- **NOT-APPLICABLE ≠ CLEAR, and STANDING ≠ PRESENT.** FF4 called itself "not applicable" while FF3
  was counting the very same duties (fixed v19.48). And FF2 fires on every 06:20 duty, so it is a
  property of the operation — marked `standing` and counted separately, because adding it to the
  findings total would claim the designer could have avoided it.
- **Three definitions are unsettled** (FF17, FF18, FF19) and carry `confirm: true`, rendered as
  "(definition to confirm)". FF18 in particular may be unavoidable by construction — a link moves
  everyone one line per week — which is a conversation to have with the assessing manager *before*
  the proposals are drawn, not a checklist item.

Two things about the rules themselves that are easy to get wrong, both caught by their own tests:
**FF11 is not the consecutive-worked-days check it resembles** (a single rest day is not a 48h break,
and a rotation with no 48h break at all returns every worked day, not the sequence length); and
**every rule laps the rotation** — `earlyBlocksWithShortRecovery` was the one that did not, so a
block straddling line 28 → line 1 was cut in half and reported as nothing.

Hours totals are a **floor**: SPARE carries no times, so a standby day contributes zero.

**The `clear` and `n/a` rows are collapsed behind a disclosure** (v19.57). The card measured 1,799px —
24 rows of which 16 said nothing had happened, so the 8 real findings were diluted five to one in a
card taller than the grid it describes. It is now 1,134px. **This must not be allowed to weaken the
"silence is not compliance" rule**, and three things keep it honest: the counts stay in the
always-visible section heading (with `clear` now among them, which it was not before); the disclosure
is labelled with what is inside; and CLEAR and NOT-APPLICABLE keep their separate icons and wording
inside it. What is hidden is the PROSE, never the fact of the check. `present` and `standing` always
render inline.

Two things that had to be right and were not on the first attempt: the **night-family rollup belongs
INSIDE the disclosure** (outside it, the heading counted 17 clear while the label said 10 — both true,
impossible to reconcile by looking), and **printing must force every `<details>` open**. CSS cannot do
the latter: Chromium hides a closed disclosure's content through an internal slot no author rule
reaches, so a `@media print` override still printed 13 of 24 rows. `links-app.js` opens them on
`beforeprint` and closes them on `afterprint`. The printed sheet goes to the assessing manager, so
silently dropping 17 completed checks from it would be the precise false-assurance failure this panel
exists to prevent.

`links-app.js` also passes a `getBaseline` thunk so the panel can show what **today's** link scores.
It is computed over `weeklyRoster` (20 lines) and `bilingualRoster` (8) **at their own lengths** —
splicing them into one 28 reports a longest run of 19, which is a property of the join and not of
either roster.

### Generator layout — the v19.61 polish pass

Measured at 390px and 1280px, not eyeballed. Five things, and the first is a bug rather than polish:

- **The iOS focus-zoom guard had never worked.** Full account in `css-tokens.md` → "The 16px
  focusable-field rule is now MEASURED". The override now sits at the END of `links.css`, after the
  base rule it has to beat, and an e2e measures the computed size on a real coarse pointer.
- **Touch targets.** On a coarse pointer the fields were 28px, the row ✕ 20px and the two text
  links 15px. All now ≥40/44px. The app's rule is that density is gated on `pointer: fine` — a wide
  touch screen still needs the target spacing.
- **The SHIFT TIME column is sticky on mobile.** At 390px the table is 443px inside a 306px wrapper:
  131px hidden, which is the whole **Sunday** column and the ✕. Sunday is a required INPUT, so this
  is not the same call as compare mode's accepted clipping of a read-only view. Sticky identifies the
  row while you type AND makes the scroll self-evident, and a right-edge shadow (pure CSS,
  `local`/`scroll` gradients — no scroll listener) says there is more. **Every sticky cell needs an
  OPAQUE fill:** the spare row's own background is `color-mix(gold 10%, transparent)` — 90%
  see-through — so the caption sat there with the scrolled column showing through it, which reads as
  a fault, not a feature. And `white-space: nowrap` had to go: fine in a cell that sizes to content,
  but in a sticky one it just overflows the fill.
- **ONE measure on desktop.** The table filled all 1036px of the card, putting a 90px shift time in a
  477px cell. Capping the table alone then left a 620px table under a 1036px objectives box under a
  1036px button — a card reading as three unrelated widths. The cap belongs on `.generator-form`, so
  every part lines up, at 660px beside the ~72ch the intro prose already uses.
- **The objective labels.** Two of the five carry an inline number, and at 390px the tail wrapped
  flush with the CHECKBOX, reading as a sixth objective. The label text is now one `<span>` (a flex
  item) so it wraps as a block, and the numeric clause has its own line — a 40px-tall field cannot
  sit inside a sentence in a 260px column. **Grid was tried here and is wrong**: every child of a
  grid container becomes an item, so the number box left its sentence and dropped into the
  checkbox's column.

### Auto-generator (v12.39, slot-based v12.40; whole spare WEEKS v19.58)
**The only way to create a new design** (v12.43). Targets are a LIST of shift slots — one row per distinct start time, each with separate **Mon–Fri / Sat / Sun** headcounts — plus **one** number: how many whole lines are spare weeks.

**SPARE IS A WHOLE WEEK, NOT A SCATTER OF DAYS** (owner, Aug 2026). A spare line is spare on all seven days: you are cover, you work four days of that week, and you can be put on any range of shifts. The real roster is built this way — main lines **1, 7, 12, 17** are `SPARE` on every day, bilingual **1 and 8**, and there is not one scattered spare day anywhere in it.

The previous model took a per-day-class spare HEADCOUNT and fed it to the rotating window as one more segment. Because the window slides daily, that gave each person spare on some days and a timed duty on others. **The daily SP headcount came out right, which is why it went unnoticed** — the total was correct and the distribution was wrong. `spareLines` whole lines are now reserved and spread evenly around the wheel, and the rotation is built over the remainder; daily targets are still met exactly, and every day shows the same SP count, as the real roster does.

Two consequences worth knowing: the targets are validated against the **working** lines (`lines − spareLines`), so a total that fits in 28 can still be refused; and a spare week counts as **7 worked days** in the run-length check although the person works four of them — we do not know which three are rest, and over-reporting a run is the safe direction for a fatigue check.

The table is **seeded from the current roster** on page load via `buildRosterTargets()` — **all 28 real lines: the main 20 weeks AND the whole 8-week bilingual roster** (v19.59). It used to take main 20 plus only the two bilingual weeks the two bilingual members happen to sit on, then apply that 22-line sample to a 28-line design; bilingual weeks 1 and 8 are the SPARE ones and were never sampled, so the seeded spare count came back as **4** where the real combined roster has **6** (main 1/7/12/17 + bilingual 1/8). Two whole lines of standby cover, missing by default. The design is 28 because that is main + bilingual, so the seed has to be main + bilingual too; which weeks two people sit on today is a fact about staffing, not about the roster's shape. Pinned by an e2e that drives `↺ Reset targets from current roster`, because the seed lives in the coordinator and a unit test would be checking its own copy of it.

Weekday count = the **busiest** Mon–Fri day for that time (some shifts only run Tue/Thu/Fri), and the generator then staffs all five weekdays at that level. Deliberate — under-staffing a day is the worse error — but the real roster varies Mon to Fri, so the column header says `busiest day`.

### The two constructions (v19.59)

`generateLink({ slots, spareLines, lines })` tries **settled weeks** first and falls back to the original **rotating window**. Which one ran is REPORTED in the status line, never silent — they give visibly different designs. `generatePatterns` is the thin wrapper returning patterns only; it keeps the old signature because every existing caller and test is written against it.

**1. Settled weeks (default).** Slots are grouped into WAVES — starts within `WAVE_SPAN_MINUTES` (2h, the same threshold FF19 uses) — each wave gets a contiguous BLOCK of lines sized by the duty it carries, and slides its own window inside that block. **A line therefore never leaves its wave**: its start can move 06:20 → 07:15, never 06:20 → 15:25.

Measured against the real roster, the old construction was giving people a week nobody at Marylebone has ever worked:

| | within-week start spread | lines above 4h | FF19 |
|---|---|---|---|
| Real main roster (20 lines) | 3h44 | 7 of 16 | 6 |
| Generated, rotating (old) | **8h09** | **22 of 22** | **27** |
| Generated, settled (v19.59) | **1h33** | **0 of 22** | **2** |

The tool reports FF19 and its own generator was the thing inflating it ~5×. Days worked per line now matches the real roster's distribution (3–6, clustered at 5).

Waves rather than exact times, deliberately: per-TIME blocks are infeasible here — the seed produces 28 distinct times over 22 working lines and several are weekend-only — and waves are also what the real roster does (line 3 works 06:20-14:20 midweek and 06:20-14:00 on the Saturday).

Three things that were wrong on the way and are each pinned by a test:

- **A wave too small to fund a line is merged into its nearer neighbour.** The two 08:30 weekend-only slots formed their own wave, so one whole line existed to work Sat and Sun and nothing else — days per line came out 2 to 6 where the old construction ran 3 to 6. A shape improvement paid for with an unfair link is not an improvement. Merging widens a wave past 2h (06:20…08:30 is 2h10) and the panel then counts that movement, which is the right way round.
- **A lap is spread ACROSS the week, never front-loaded.** `base + (i < rem)` strides lap a 3-line block by Tuesday and then hold the window still to Saturday, so the same lines work all four of those days and one caught two a week. `floor((i+1)·n/7) − floor(i·n/7)` shares it out exactly.
- **The fairness test is comparative, not an absolute floor.** "Nobody under 3 days" is a fact about the TARGETS, not the construction — it would pass or fail on the fixture.

**2. Rotating window (fallback).** The wheel: a window of consecutive lines slides forward a few lines a day, one lap per week, slots ordered latest-start at front.

Its documented promise — *"a person's week only moves later, never a late finish then an early start; asserted by tests"* — **was not true**. Positions are read mod `working`, so every line wraps front-to-back once a week and that wrap IS the step; it lands on a rest day only while the targets leave lines resting. At full staffing it produced **27** short turnarounds, `15:15-23:55` into `06:20-14:20` — **6h25** rest. The test that "asserted" it staffed 13 of 24 lines, where the wrap always fell on RD.

Strides are no longer near-equal: each day's is capped at `working − (next day's total)`, exactly the condition for a wrapping line to be resting the following day, and the lap is distributed in proportion to those caps. When the caps cannot fund a lap the targets leave under one rest day per line per week — the generator **refuses** (`reason: 'no-rest'`, with its own message) rather than shipping the phantom guarantee. Settled weeks survive those same targets, because a line staying in one wave costs nothing in body-clock movement.

Daily targets are met exactly by both; any day-class total > the working lines is rejected. Generator writes all 28 lines.

**Do not add back** `buildDefaultDesign`, `initFromRosters`, or `resetFromRosters` — those paths were removed at v12.43 because they copied raw 22-line roster patterns leaving lines 23–28 as all-RD blanks. The generator produces a complete 28-line rotation.

### Line ORDER — the five objectives (v19.58; `variety` added v19.60)

> **`variety` and `gentle` are opposite ends of one dial, and `variety` must stay ON by default.**
> Minimising the week-to-week step, taken to its limit, IS a long block of the same shift — the
> smallest possible step is no step at all. Between v19.59 and v19.60 the generator settled each week
> and then laid the waves out contiguously, so a person got **11 straight weeks of mornings and 11 of
> afternoons**; turning `gentle` on made it 8 even after a reorder. The owner's verdict was "a bit
> excessive and would be unpopular", and the live roster's longest run on much the same shift is
> **3** (bilingual 2), which is `DEFAULT_BLOCK_TARGET`.
>
> `variety` is weighted as a **constraint** rather than a preference (excess × 400 against gentle's
> raw minutes), so the optimiser alternates but alternates by the smallest step available — early →
> middles → late rather than early → late. Measured on the roster seed: block 3, week-to-week 95 min,
> 8 weekends off, 0 short turnarounds. With `variety` off: block 8.
>
> **`blockRuns` treats a SPARE line as transparent** — neither breaking a block nor counting towards
> one. A cover week interrupts, but it does not change what you go back to; counting it as a break
> would let four spare weeks hide a 20-week block behind a reported maximum of 4.
>
> **Interleaving the waves inside the generator is a WON'T-DO** — tried and reverted at v19.60, with
> the numbers in `links-design.js`'s own comment. It fixes the raw block length but introduces short
> turnarounds and costs two long weekends. The generator owns the SHAPE; this module owns the ORDER.

`links-adjacency.js`, applied by the generator through five switches. A whole class of the design's
quality lives in which line follows which, because you work line w one week and line w+1 the next:
the week-to-week movement of your working day (the FF18 question), whether Saturday off is followed
by Sunday off, whether that extends to three or four days, and whether Saturday's finish runs into
Sunday's start.

**Reordering is FREE with respect to coverage, and that fact is what makes the feature safe.** Daily
coverage is "how many lines work shift X on day D"; permuting the rows leaves that multiset
identical. So these objectives cannot cost a single person's cover — they compete only with EACH
OTHER, over the one scarce resource of line adjacency. There is a test asserting the multiset is
unchanged; if it ever fails, the reorder has started moving cells rather than rows.

**Switches, not a formula** (owner, Aug 2026). Turning one on takes freedom from the rest, so the
tool's job is to let you turn each on and SHOW what it cost — `scoreOrder` returns all the figures
whatever you optimised for, and the generator's status line reports before→after. A blended score
would hide the trade. Measured on a generated design: gentle-only takes week-to-week movement from
42 to 9 minutes but drops weekends off from 10 to 9; all four on gives 14 minutes and 12 weekends.

**Everything off means leave it alone** — the order comes back untouched rather than re-sorted by
whatever was left.

Two rules that are easy to undo:

- **A spare week must not read as a gentle transition.** A spare line carries no times, so the step
  across it cannot be measured — and an optimiser scoring "unmeasurable" as "no change" would learn
  to park spare weeks between the two harshest lines and report a beautiful number. Unmeasurable
  steps are counted and reported SEPARATELY, never folded into the mean.
- **Days off and contracted days GIVEN are two different answers.** Sunday is not contracted, so
  Sat + Sun off is a two-day break but only one contracted day. Rolled into one number, a design
  that simply never rosters Sundays would score as generous while giving nothing away. `breakLength`
  returns both; `days` is right for fatigue, `given` is right for judging the design.

**Deterministic** — no randomness. The same design and switches always give the same order, so a
designer can re-run and get their design back, and two designers comparing notes compare the same
thing. Greedy nearest-neighbour then a bounded 2-opt; not optimal and does not claim to be.

### Sunday is not contracted, and the generator does not model it

Sundays appear on the roster as agreed **RDW** — overtime by agreement, not contracted hours — but
`dayClass` returns `'sun'` and that is the entire extent of it. Nothing in the generator,
`runDesignChecks` or `links-fatigue.js` treats a Sunday duty as voluntary. Mostly harmless (the cover
still has to be found, and an hour worked is an hour worked for fatigue), but two readings change:
the Sunday column is cover you HOPE to fill rather than cover you can require, and "weekends off"
counts a Sunday you were never going to work. The generator table labels the column `RDW` for the
first; `links-adjacency.js` splits days-off from contracted-days-given for the second.

**A spare week's four days come from Mon–Sat.** The Sunday of a spare week stays RDW if the roster
clerk gives it, on top of the four — it is not one of them. All seven days are still marked SPARE,
which is what the real roster does and what "available for cover" means, but a reader should not take
the four out of seven.

### Line numbering (full 28-line rotation, v12.42)
All 28 lines rotate and **every one must carry a real worked pattern** — in the rotation everyone passes through every line, so a "vacancy" is a missing *person*, not a missing *pattern*. `ROTATING_LINES = 28`.

**C. Reen is NOT a special case:** the link is designed as full 28 so it still works if she ever leaves; her adjusted fixed shifts are applied as overrides on the base roster. The old `FIXED_POS` / `fixed-link-separator` / `fixed-cell` model and the earlier `VACANT_FROM` placeholders model were both removed (v12.41 dropped vacant; v12.42 dropped fixed). All 28 rows are normal editable rotating rows.

The grid flags an all-rest line with an amber line-number cell (`.row-unfilled`); the Design checks "Lines not yet designed" row lists them until filled.

### Concurrency & load safety (v12.37; atomic v17.02)
`saveChanges()` writes via an **atomic Firestore transaction** (`runTransaction`) that reads the doc's `updatedAt` and writes in one step — closing the old getDoc-then-setDoc check-then-act window where a co-designer's save between our read and write was silently clobbered (Finding #13). On a baseline mismatch the transaction throws `concurrent-edit`; a `confirm()` names who saved and when, and on overwrite a plain (unconditional) `setDoc` replaces it. Transactions need connectivity, so **offline / any transaction failure falls back to the previous getDoc-check + queued `setDoc`** (persistentLocalCache syncs it) — offline-first preserved. The mismatch check (`conflictOf`) and the confirm are shared by both paths so they can't drift. A failed load sets `loadFailed` — empty state shows an error.

**Baseline-unknown guard (v17.18):** after a successful save, `saveChanges()` re-reads the doc to re-arm the concurrency baseline (`loadedUpdatedAt`). If that read-back FAILS (brief blip), the catch now sets `baselineUnknown = true` (mirroring the transaction path) — leaving it `false` meant the NEXT save saw neither a known timestamp nor an unknown-baseline flag, so a co-editor's intervening save could be overwritten with no conflict prompt. Residual accepted limit: two devices under the SAME display name (`updatedBy` equal) still won't conflict-prompt — inherent to identifying editors by name.

### Print (v12.37; reviewed v19.45)
A4 landscape grid + coverage + checks; generator, brush bar, picker, save row, tips and chevrons hidden.

**The whole 28-line rotation must land on ONE sheet** — you cannot judge a rotation split across
two pages. That is a measured constraint, not a preference: A4 landscape at 1cm margins gives
**718px** of printable height, and at the old 26px rows the grid card came to **903px**, so it
always broke (the CSS comment claimed it fitted "or close to"). Rows are now 21px, the cell
line-height 1.15, and the grid card's own header is dropped in print — the masthead names the sheet
— which brings it to **703px**. Re-measure if the cell font or the masthead changes; there is only
~15px of headroom.

**There is a Print button** (`#linksPrintBtn`, v19.62) in the sticky save row beside Save changes —
outlined, because two filled buttons would compete and saving is the one that matters. All of the
print machinery above had existed since v12.37 with **no way to reach it but the browser menu**,
which an installed PWA often does not expose at all. It only calls `window.print()`, so it goes
through the same `beforeprint` path as the menu item rather than duplicating any of it. The save row
is already in the print hide-list, so the button costs the sheet nothing (measured: grid card 703px
with and without, against the 718px printable height).

**The masthead carries provenance — and must say when that provenance does not describe the sheet.**
`#printDesignName` names the design, who last saved it and when, and the date it was printed (stamped
on `beforeprint`, so a page left open for a week cannot print a stale date). **The provenance line
reads the SAVED Firestore doc while the grid prints the LIVE in-memory patterns**, so with unsaved
edits those are two different designs and a sheet showing your changes would carry somebody else's
"Last saved by". It appends **"· includes unsaved changes"** when `dirty` (v19.62). Printing a work
in progress is a reasonable thing to want, so this states the fact rather than blocking the print —
but do not remove it: this sheet goes to the assessing manager, and a misattributed proposal is the
same false-assurance failure the fatigue panel is built around. Pinned by an e2e that prints clean,
then edits and prints again. Before v19.45 it printed the design name alone: the save row that carries
"last saved by X" is hidden in print, so a circulated sheet had no way to say which version it was.
Coverage and Design checks keep their card headers — they are separate sections a reader needs
named.

### Sticky day headers (v12.37)
At ≥1024px `.links-grid-wrapper` drops `overflow-x` and `.card` uses `overflow: clip` (not `hidden`) — both load-bearing for the sticky `thead`.
