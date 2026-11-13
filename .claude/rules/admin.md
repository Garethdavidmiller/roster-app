---
paths:
  - "admin.html"
  - "admin.css"
  - "admin-*.js"
  - "admin-*.test.mjs"
  - "al-*.js"
  - "al-*.test.mjs"
  - "e2e/admin.spec.js"
---

# Admin page — area decisions

The Admin page is `admin.html`, `admin.css` and the `admin-*.js` modules, plus the two leave helpers
it books through (`al-swapped-days.js`, `al-entitlement.js`). These are its "never change without
discussion" decisions, moved here from `CLAUDE.md`'s architecture table, which every session loads.
Rules that bind more than this page stayed there: **Sundays are non-contracted** (six enforcement
layers, `SUNDAY_FORBIDDEN_TYPES`), the 🪑 absence emoji, `formatClockInput`, the AL entitlement
rules, and the wording conventions. The weekly roster import has its own file,
`.claude/rules/roster-import.md`.

| Decision | Rule |
|----------|------|
| "Recording for &lt;name&gt;" on the AL and Absence cards | `.card-member-for` at the TOP OF EACH CARD BODY, filled by `_syncMemberFor` in `admin-app.js` from the same sites that sync the two member displays. **Managers and admin only** — they are the only identities that can point these cards at somebody else, and for a self-service member the row would state the one fact they already know. **Three things not to "tidy"** — it is not in the `.card-header-actions` cluster, it is outside `#alBanner`, and its `[hidden]` rule is load-bearing — each with its reason beside the `.card-member-for` block in `admin.css`. |
| Type pills in admin — single source of truth | `PILL_TYPES` in `admin-shift-types.js` is the ONE authoritative list, and neither pill row may restate it: `renderWeekGrid()` (admin-week-editor.js) generates the per-row pills, `admin-app.js` the bulk bar — **minus `other`**, deliberately (its flavours need per-row sub-controls a bulk bar cannot host; the rationale is beside the filter). Order: AL · Shift · RDW · Absent · Rest Day · Other. Other reveals per-row sub-controls (flavour chips + a pre-ticked-on-rest-day RDW tick + OPTIONAL times, `timesOptional: true`) and the save collector composes `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`. **Spare is special-cased**: it stays its own `spare_shift`/'SPARE' type (📋, not worked), so picking it writes a `spare_shift` and hides the tick and times. Why the table is its own module: `admin-shift-types.js`'s header. |
| **No new top pill** | The top row is `PILL_TYPES` and stays that size: new day KINDS go into the Other submenu, not new top pills (Spare moved there for the same reason). |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| Admin's week grid — one template, one left edge | The `.week-grid-header` and `.day-row` templates must stay identical, and every block on the card shares the content width. The rules and their measurements are `css-tokens.md` → "A card has ONE left edge, and a header shares its rows' template", which loads with `admin.css`. |
| **AL on a rest day is ASKED about, never defaulted** | Leave on a base-roster rest day costs no entitlement — **unless the member SWAPPED working days onto it**, which only the person booking knows. So both booking paths ASK, per affected day, and refuse to save unanswered; a declared swap is recorded as `replacedType: 'shift'`, which the rules already permit. **Ask only when a day is affected, and never default** — both halves are the owner's, and a silent default lost three of one member's days. **"Rest day — free" means NOTHING IS WRITTEN, on both surfaces**, and the save receipt NAMES the days it left alone — a save may not do nothing silently. **A day that already HELD leave is named differently**: answering never deletes, so the record stands and the Calendar still shows it; reporting it like an empty day contradicted the grid. **The answer must reach every layer, not just the write** — one projection feeds preview, warning and save. **Two kinds of day are never asked about:** a day before the member's start date — never written or counted either, and the preview names it as before the start date, never as a rest day — and a rest day already holding RDW, an Other day or a Spare turn, which is settled, and free (owner, 10 Nov 2026). Never wire any of it to the Absence card. Reasoning: `al-swapped-days.js` (which days are asked), `admin-al-projection.js` (what the answers mean, and why the grid reads `answeredFree` rather than `skipped`) and `admin-al-week-save.js` (what one save does with a batch of them). |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. One implementation, `recordRangeOverrides` in `admin-overrides.js`, which both the AL and the Absence card save through; it skips a Sunday whose existing override is already a rest day or genuinely worked, and writes a correction only alongside a booking. |
| **Every save of a day is CHECKED when the server can be asked** (owner, 12 Nov 2026) | The week grid's save and each part of a leave or absence range commit through `commitChecked` (`admin-override-store.js`): online, ONE transaction that refuses — writing nothing and naming the days — unless each day still holds what the page showed (the row's drawn record, `drawnDays`; for a range, what the page had loaded). **Offline, a save that only writes is held as a batch, unchecked** — that is the offline-first half, not an oversight; a save that removes a day is never held. Do not turn an online save back into a plain batch, and do not compare a written day with the cache instead of its row. What remains: KNOWN_LIMITATIONS.md → "Two editors on one day". |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-rangepicker.js`. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| The AL and Absence member handles in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay` and `syncSickMemberDisplay` are declared in `init()` ABOVE the `fieldMember` change handler, because that handler can fire before `initALSection()` (`admin-al.js`) and `initSickSection()` (`admin-sick.js`) have run. Do not move them inside those init functions. |
