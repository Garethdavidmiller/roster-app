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

The workspace is one coordinator over seven pure/extracted modules. Everything except `links-app.js`
is testable without a browser, which is deliberate — the coordinator is where the Firestore and DOM
state lives, and the rules that have historically produced bugs have been pulled out of it.

| Module | Owns |
|--------|------|
| `links-app.js` | coordinator: Firestore, grid, paint, picker, save/dirty state (+ `links-boot.js`, the CSP bootstrap) |
| `links-design.js` | the design maths — classification, coverage, the generator, `runDesignChecks`, `endMinutesAbs` |
| `links-fatigue.js` | the ORR p3 fatigue factors (v19.46) |
| `links-analysis.js` | the two read-only panels — Coverage heat map + Design checks — rendered from those pure results |
| `links-compare.js` | compare mode; sole owner of `compareMode`/`compareDesignId` |
| `links-concurrency.js` | the co-editing rules (three historical silent-overwrite bugs, one test each) |
| `links-deletion.js` | the soft-delete/restore/purge rules |

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
All design maths live in `links-design.js` (no DOM, no Firebase; tested by `links-design.test.mjs`) — `classifyShift`, `normaliseCustomShift`, `calcCoverage`, `calcHourlyCoverage`, `generatePatterns`, `runDesignChecks`, `dayClass`, `endMinutesAbs`. `links-app.js` imports these; do not duplicate them back into the app file. The ORR fatigue factors sit alongside in `links-fatigue.js` (v19.46), which imports from here — see the module table above for the full set.

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

### Coverage heat map (v12.40)
The Coverage card renders an **hour-by-hour table** (`calcHourlyCoverage`) — rows = days, columns = hours spanning the staffed day, cell = on-duty headcount, intensity buckets `heat-b0`–`heat-b5` (color-mix tints of `--cov-early`, scaled to the week's peak).

The station is staffed in **waves** (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+) — do not revert to per-type stacked bars. A red `0` inside a day's staffed span marks a coverage gap; spares get their own `SP` column. The grid `tfoot` keeps compact per-day `E:/L:/SP:` counts.

### Design checks (v12.39, completeness added v12.41; fatigue factors added v19.46)

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

`links-app.js` also passes a `getBaseline` thunk so the panel can show what **today's** link scores.
It is computed over `weeklyRoster` (20 lines) and `bilingualRoster` (8) **at their own lengths** —
splicing them into one 28 reports a longest run of 19, which is a property of the join and not of
either roster.

### Auto-generator (v12.39, slot-based v12.40)
**The only way to create a new design** (v12.43). Targets are a LIST of shift slots — one row per distinct start time, each with separate **Mon–Fri / Sat / Sun** headcounts — plus a spare row.

The table is **seeded from the current roster** on page load via `buildRosterTargets()` (main 20 weeks + the 2 BL lines; weekday count = busiest Mon–Fri day); `↺ Reset targets from current roster` re-seeds.

`generatePatterns({ slots, spare, lines: 28 })` uses a rotating-window construction: window slides forward completing one lap per week; within the window slots are ordered latest-start at front, earliest at back, spare in the middle — so each person's week only moves later (never a late finish then early start; asserted by tests). Daily targets are met exactly; any day-class total > 28 is rejected. Generator writes all 28 lines.

**Do not add back** `buildDefaultDesign`, `initFromRosters`, or `resetFromRosters` — those paths were removed at v12.43 because they copied raw 22-line roster patterns leaving lines 23–28 as all-RD blanks. The generator produces a complete 28-line rotation.

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

**The masthead carries provenance.** `#printDesignName` names the design, who last saved it and
when, and the date it was printed (stamped on `beforeprint`, so a page left open for a week cannot
print a stale date). Before v19.45 it printed the design name alone: the save row that carries
"last saved by X" is hidden in print, so a circulated sheet had no way to say which version it was.
Coverage and Design checks keep their card headers — they are separate sections a reader needs
named.

### Sticky day headers (v12.37)
At ≥1024px `.links-grid-wrapper` drops `overflow-x` and `.card` uses `overflow: clip` (not `hidden`) — both load-bearing for the sticky `thead`.
