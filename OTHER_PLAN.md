# OTHER_PLAN.md — the "Other" day family (Training / Induction / Assessment; Meetings / Union duties later)

*Status: **BUILT** (v15.34–v15.38) and **EVOLVED into the "Other" family at v15.40** (pre-deploy, so
the rename was free — no data migration). Verify live in a private window after deploy (375px badge
fit + a real roster upload with a training day), then this file can be archived — the shipped
behaviour is documented in CLAUDE.md, AI_MAP.md, OPERATIONS_REFERENCE.md and .claude/rules/paycalc.md.
Not version-stamped; not a runtime asset.*

## Evolution (v15.40) — decisions confirmed by Gareth, Jul 2026

The training family became the **"Other" family**: a home for every non-standard day type.
Training / Induction / Assessment are its first flavours; **Meetings and Union duties join later**
(roster words TBC from Gareth — Phase B below).

| Decision | Answer |
|---|---|
| Family name | **Other** — pill "Other", legend "Other", Saved-Changes pill "Other" |
| Stored type | **`type: 'other'`** (renamed from `training` pre-deploy — a MEET under type `training` would have been permanently wrong) |
| Icon | **🏷️ label/tag** (replaces 🎓 — a tag says "day labelled as something else"; the badge word IS the label). Chosen over 📌 (weaker metaphor) |
| Badge | 🏷️ + SHORT flavour word (Train / Ind / Assess — later Meet / Union). Confirmed: badge never literally reads "Other" |
| Colour | **Leaf green `oklch(46% 0.115 136°)`** (`--other`/`--other-light`, 13% tint). NOT the original bronze — bronze (65°) was hue-identical to Early's orange (64.1°): indistinguishable at tint level and literally the same colour under red-green colour-blindness. Green 136° is the only empty band (46° from AL teal 183°); under deutan vision it keeps a yellow-olive cast while teal stays blue-grey, so it separates BETTER for colour-blind staff. Swatch proof: the "green-vs-teal" artifact, Jul 2026. "Reassess down the line" per Gareth |
| Manual UX | One **"Other"** pill → previously-hidden submenu with **full-word** flavour chips (Training / Induction / Assessment), the pre-ticked-on-rest-day RDW tick, optional times. New kinds become chips, never new pills |
| Namespace note | The legacy unknown-value fallback classes were renamed `other-day`→`unknown-day`, `badge-other`→`badge-unknown` so the Other family owns the `other-*`/`--other` names coherently with `type: 'other'` |

**Flavour semantics (owner, Jul 2026):** `ASSESS` means the member is the **assessor** — spending
the day conducting assessments of junior staff (most likely a CES duty). It is a full-day activity
exactly like delivering training, so the pay-as-the-day treatment and the 8h rest-day default are
correct for it — do not shorten the default for assessments.

**Worked-base RDW tick (owner, Jul 2026):** ticking "Rest day (RDW)" on a day whose base roster is a
WORKED shift is ALLOWED (the admin may know the roster is wrong) but shows a brief warning line —
"Originally rostered {base} this day — RDW pays it as rest-day working instead" (`.other-rdw-warn`,
synced by `_syncOtherRdwWarn` on tick/activate/prefill). Rest-day rows never warn.

## Phase B — adding Meetings / Union duties (the precise checklist)

**Blocked on Gareth supplying:** (1) the exact roster words/codes for each; (2) two confirmations —
do they **pay the same way** (as the day underneath, 8h RDW default — note ASSESS already confirmed
full-day), and does the **Sunday block** apply to them too?

Per new flavour, the touch-list (kept short by the v15.43 prep — the submenu chips are GENERATED
from `OTHER_FLAVOURS` and the server uses an explicit alias lookup, so neither needs hand-edited UI):

1. `override-utils.js` — one `OTHER_FLAVOURS` entry (`MEET: {badge:'Meet', full:'Meeting'}` /
   `UNION: {badge:'Union', full:'Union Duties'}`) + add the sentinel to `_OTHER_RE`.
2. `functions/roster-parse-helpers.js` — extend the recognition regex with the roster words + one
   `FLAVOUR_LOOKUP` entry per alias (the deliberate server-side duplicate).
3. `firestore.rules` — add the sentinel to the training-grammar `matches()` clause (rules deploy —
   rides `deploy-rules.yml`, gated by the emulator suite).
4. `functions/index.js` — one AI-prompt "WHAT THE CODES MEAN" line per flavour.
5. Tests — grammar matrix rows (`override-utils.test`), recognition aliases (`roster-parse-helpers.test`),
   rules accept/reject rows (`firestore.rules.test` TYPE_VALUE_MAP loop covers the happy path),
   one pay-engine case each, badge words (`roster-data.test`).
6. Copy strings that enumerate the flavours (only if wording should change): Sunday pill title
   (`admin-overrides.js`), Sunday save error (`admin-app.js`), admin CARD_TIPS, `guide.html` badge row,
   `paycalc-help.js` — plus the docs sweep (CLAUDE.md shift-types row, AI_MAP, OPERATIONS_REFERENCE).
7. One version bump; verify a new-flavour day at 375px in a private window.

Also do at Phase B: the deferred comment-vocabulary sweep — shared-code comments still say
"training" where they mean the family (fine while training is the only live flavour; factually
wrong the day a MEET ships).

---

## Original build spec (historical — identifiers below predate the v15.40 rename: read
## `training` as `other`, 🎓 as 🏷️, bronze as leaf green)

---

## The feature in one paragraph

Rosters sometimes mark a day **Training**, **TRG**, **TRG RDW**, **Induction**, or **Assessment**.
These days have **no times on the roster** (the trainer sets them). They must show on the
calendar as their own bronze shift family, and they **pay exactly like the working day they sit
on**: a normal weekday training is already covered by basic pay; a Saturday/BH training keeps that
day's premium; a training rest-day (**TRG RDW**) defaults to **8 hours in the RDW bucket** which
the member (or the admin) corrects to the real hours; training that **runs over** a rostered shift
puts the excess in the existing **Overtime** bucket. A member is **never paid less than their
rostered shift** even if training runs short. Sundays can never be training days.

⚠️ **Do not confuse with "Peer Training"** — the existing 2h-per-day basic-rate item in the pay
calculator (`peerDays`). That is a different feature; keep all copy distinct.

---

## Locked decisions (the record of the design conversation)

| # | Decision | Answer |
|---|----------|--------|
| 1 | Family colour | **Bronze** — one new token pair `--trg` / `--trg-light` (as-was) (all three flavours share it) |
| 2 | Badge | 🎓 + short flavour word: **Train** / **Ind** / **Assess** |
| 3 | Hours slot (where a time normally shows) | The **time** (base shift time, or actual times when entered) — or the word **RDW** for a training rest-day with no times |
| 4 | Tap on the day (day-detail / tooltip / aria) | The **full word**: “Training” / “Induction” / “Assessment” (+ “ — Rest Day Worked” when RDW, + times when known) |
| 5 | Pay on a rostered day | Base hours at **that day's rate** (basic / Sat 1.25× / BH), automatic; never less |
| 6 | Pay on a training rest-day (TRG RDW) | **Default 8h → RDW bucket**, manually adjusted afterwards (member in pay calc, or admin by entering real times) |
| 7 | Over-run | Excess beyond the base shift → the existing **Overtime** bucket (BH over-run → BH-overtime bucket, matching the payslip). RDW days are never split — all hours stay RDW |
| 8 | How RDW-ness is decided | **Explicitly marked on the roster** (“TRG RDW”). Manual entry gets an RDW tick, **pre-ticked** when the day's base is a rest day. Engine belt-and-braces: base RD/OFF ⇒ treat as RDW even if the flag is missing |
| 9 | Sunday | **Blocked** — a Sunday can never be a training day (same 5-layer treatment as AL/Absent) |
| 10 | Admin manual entry | Yes — **one** “Training” pill in Change a Shift; picking it reveals flavour choice + RDW tick + **optional** time boxes (blank = defaults) |
| 11 | Times storage | Optional, on the override value itself (see grammar). Roster upload never carries times; only manual admin entry does |
| 12 | Worked-day status | Training counts as a **worked** day (dispatcher BH-lieu counting included — a BH training earns lieu, since it pays as the day) |

---

## Data model

**Override document:** `type: 'other'` (new), with a single human-readable value grammar that
mirrors the roster's own language:

```
value := FLAVOUR [ " RDW" ] [ " HH:MM-HH:MM" ]
FLAVOUR := "TRG" | "IND" | "ASSESS"
```

Examples: `TRG` · `IND` · `ASSESS` · `TRG RDW` · `TRG 08:00-16:00` · `TRG RDW 08:00-16:00`

- Value reads exactly like the roster → debuggable by eye in the Saved Changes list.
- One Firestore rules clause validates the whole grammar (bounded time regex, RE2 full-string):
  `type == 'other' && value.matches('(TRG|IND|ASSESS)( RDW)?( ([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9])?')`
- All other override fields (`note`, `source`, `createdAt`, `changedBy`) unchanged; the `hasOnly`
  field allowlist unchanged. Per-member isolation / delete rules are type-agnostic — no change.

**Single sources of truth (new, in `override-utils.js`** — pure module, already imported by
`roster-data.js`, no cycle):
- `OTHER_FLAVOURS = { TRG: {badge:'Train', full:'Training'}, IND: {badge:'Ind', full:'Induction'}, ASSESS: {badge:'Assess', full:'Assessment'} }`
- `isOtherValue(v)` / `parseOtherValue(v)` → `{ flavour, rdw, time|null }` or `null`
- `OTHER_RDW_DEFAULT_MINS = 480` (the 8h default — one place)
- `resolveOtherPay(parsed, baseValue)` → the pay mapping as a discriminated union —
  `{mode:'rdw', mins}` | `{mode:'timed', time}` | `{mode:'as-base'}` (as built at v15.34; the plan's
  earlier `resolveOverrideShift` name was refined — a single string return couldn't express the
  8h-default RDW case). **This helper is the spine** — training is the only override that means
  “fall back to the base”, the inverse of every other type, and this keeps that rule in one place.

A deliberate duplicate of the recognition grammar lives server-side in
`functions/roster-parse-helpers.js` (CommonJS cannot import browser ES modules — same accepted
pattern as `normaliseSurname`; if the grammar changes, update both).

---

## Recognition — roster upload (server)

`functions/roster-parse-helpers.js → normaliseShift()`, **before** the `UNKNOWN|` fall-through
(hard dependency: today these cells become UNREADABLE):

| Cell says (case-insensitive) | Canonical |
|---|---|
| TRG / TRAINING / TRAIN | `TRG` |
| INDUCTION / IND | `IND` |
| ASSESSMENT / ASSESSMENTS / ASSESS | `ASSESS` |
| any of the above + RDW (either order: “TRG RDW”, “RDW TRG”) | `<FLAVOUR> RDW` |

- A training cell **with times** in the PDF is unexpected (roster never sets times) → falls to
  `UNKNOWN|` → UNREADABLE review row. Surfaced, never mis-written. Acceptable; documented.
- `functions/index.js` — AI prompt “WHAT THE CODES MEAN” block: add the four lines so the model
  returns the exact strings above (without this the AI may emit free text).

## Upload review (client — `admin-roster-upload.js`)

- `shiftValueToOverrideType()`: Sunday + training value → `'correction'` (Sunday block, mirrors
  AL/SICK); otherwise training value → `'other'`. **Hoist this function to module scope and
  export it** — it is pure, currently an untestable closure; this change adds a type to it, so it
  gets unit tests now.
- `computeCellStates()`: extend the `sundaySafe` normalisation — a Sunday training value → `'RD'`
  (classifies MATCH, never written). Non-Sunday training classifies naturally: DIFF vs base
  (proposed), COVERED when a previous import already matches, CONFLICT vs a manual override.
- Save path: value saved verbatim (`TRG RDW` has no pipe — the `RDW|` strip doesn't touch it);
  `correction → 'RD'` backstop already covers the Sunday case.
- Review display: `shiftDisplay()` picks up the new badge automatically once `getShiftBadge`
  knows training values.

---

## Display spec

**Calendar cell** (`calendar-renderer.js` + `roster-data.js`):
- `getShiftClass(v)` → `other-day` (bronze tint cell) for any training value.
- `getShiftBadge(v)` → `🎓 Train` / `🎓 Ind` / `🎓 Assess` (`badge-other`).
- Hours slot: `time` if present → else `RDW` if the RDW flag → else the **base shift time** when
  the base is a real time → else blank (e.g. spare-week training: badge only).
- Training must be branched **before** the worked-day logic: it must NOT get the
  early/late/night classification, must NOT print its raw value as a time line, and must NOT be
  overridden by a member's `permanentShift` badge.
- **Tap / tooltip / aria-label**: the full word — “Training” · “Induction” · “Assessment”;
  RDW variant: “Training — Rest Day Worked”; with times: “Training 08:00-16:00”. (Flows into the
  day-detail lightbox via the same label attributes.)
- **Sunday defensive layer**: a (legacy) training override on a Sunday is suppressed in display —
  the base shift shows instead (mirrors the v12.61 sick-on-Sunday suppression).

**Team Week View** (`calendar-team-view.js`): resolution passes `override.value` through already;
`getTeamCellDisplay` gets a training branch → `{ text: '🎓 Train|Ind|Assess', cls: 'tv-other',
label: full word }`. Sunday suppression mirrored.

**Legend / keys**: `getShiftTypesInMonth` adds `TRG` when any training value is present that month
→ `updateLegend` toggles a new `legend-other` item (“Training”); team-info `?` key gets a
`tv-key-dot--other` row.

**CSS** (all colours as `:root` variables per css-tokens.md — never hardcoded):
- `shared.css :root`: `--trg` (bronze, oklch — tuned at build for AA white-on-bronze badge text
  and clear distance from `--accent-gold`/`--warning-amber`, which share the hue zone; low chroma +
  low lightness keeps it “bronze” not “gold”) and `--other-light: color-mix(in oklch, var(--other) 14%, white)`.
- `shared.css`: `.badge-other` — screen **and** print blocks.
- `index.css`: `.calendar-day.other-day` — screen **and** `@media print` (`!important`, per the
  print checklist; print rules are MANDATORY for a new shift type) · `.legend-color.trg` ·
  `.tv-other` · `.tv-key-dot--other`.
- `shared.css`/`admin.css`: `.pill-other`, `.lpill-other` (+ print).

---

## Pay spec (the heart of it)

**Engine:** `paycalc-roster-suggestions.js → getRosterSuggestion()`, via
`parseOtherValue`/`resolveOverrideShift`. Effective RDW-ness = explicit `RDW` flag **or** base
is RD/OFF (defensive).

| Training day case | Engine behaviour | Pay result |
|---|---|---|
| Rostered weekday, no times | resolve to `baseValue`, `fromOv=false` | nothing to fill — contracted basic already covers it |
| Rostered **Saturday**, no times | resolve to base → existing `sat` path | base hours at 1.25× |
| Rostered **BH / Boxing Day**, no times | resolve to base → `bh`/`box` paths | day's premium |
| Rostered day, **with times** | `effValue = times`, `fromOv=true` → the existing override-split machinery | base hours in the day's bucket, **excess → Overtime** (`ot`; on a BH → `bhOt`) — exactly the current shift-extension logic, reused |
| **TRG RDW, no times** | `rdw` bucket, **`OTHER_RDW_DEFAULT_MINS` (8h)**; day-breakdown row labelled “(8h default — adjust to actual)” | 8h RDW pre-filled, gold-highlighted, member edits like any pre-fill |
| **TRG RDW, with times** | `rdw` bucket, actual duration; never split into base+OT | all hours at RDW 1.25× |
| Spare-week training | resolves to `SPARE` → contributes nothing | correct: it's one of the four contracted days, basic pay covers it |
| Sunday (legacy doc only) | ignored by the engine | Sunday block holds |

- “Never paid less”: guaranteed structurally — base hours are never reduced by a training
  override; short-running training changes nothing.
- HPP / back-pay: read the member's **saved period fields**, so RDW/OT hours entered this way
  flow through with zero changes.
- Roster-hint copy: the RDW category row shows the “(8h default)” marker so the default is
  visibly a default, keeping faith with the v9.02 conservatism policy (this pre-fill is
  owner-mandated, but it must *look* provisional).

---

## Sunday block — the same 5 layers as AL/Absent (do not drop any)

1. `shiftValueToOverrideType`: Sunday training → `correction`/RD.
2. Upload review `computeCellStates`: Sunday training normalised to RD → MATCH → never written.
3. Manual entry: Training pill **disabled** on Sunday rows; bulk-apply silently skips Sundays
   when Training is active; `recordRangeOverrides` filters Sundays.
4. Write-path backstop: `correction` always saves value `'RD'`.
5. Display: calendar + team view suppress a Sunday training override (base shows).

---

## Admin manual entry (Change a Shift)

- `TYPES` add: `training: { label: 'Training', pill: 'Training', fixed: false, timesOptional: true }`
  — a **new semi-fixed pattern**: time inputs shown but optional (`validateShiftRules` skips the
  required-time check for training when blank; validates format when filled).
- `PILL_TYPES` append `'other'` → **7 pills** (one edit feeds both the per-row pills and the
  bulk bar). Verify 375px wrap; update CLAUDE.md's pinned pill-order note (AL · Spare · Shift ·
  RDW · Absent · Rest Day · **Training**).
- Selecting Training reveals: **flavour choice** (Train / Ind / Assess — segmented, defaults
  Train), **“rest day (RDW)” tick** (pre-ticked when the day's base is RD/OFF), **optional times**.
  Composed into the value grammar on save (`TRG RDW 08:00-16:00` etc.).
- Bulk bar: reuse the same sub-controls if layout allows; if too tight, bulk = Train flavour only
  (Ind/Assess are rare bulk operations) — build-time judgement, note the outcome in CLAUDE.md.
- Saved Changes list: `lpill-other` pill “Training”; the value column shows the readable
  grammar verbatim.

---

## Tests

| File | Cases |
|---|---|
| `roster-parse-helpers.test.mjs` | every alias → sentinel (case-insensitive); `TRG RDW`/`RDW TRG` → `TRG RDW`; training NOT `UNKNOWN`; `XYZ RDW` still UNKNOWN; training-with-times → UNKNOWN |
| `override-utils.test.mjs` | `parseOtherValue` full grammar matrix; `resolveOverrideShift` per pay-mapping row; `OTHER_RDW_DEFAULT_MINS` |
| `firestore.rules.test.mjs` | `training` valid with each grammar form (bare, RDW, timed, RDW+timed); invalid: bad flavour, bad time, trailing junk |
| `paycalc-roster-suggestions.test.mjs` | weekday→null; Sat→sat; BH→bh; timed over-run→ot (and bhOt on BH); TRG RDW default→rdw 8h; TRG RDW timed→rdw actual; spare-week→null; Sunday ignored; base-RD-without-flag→rdw (defensive) |
| `admin-roster-upload` (newly exported `shiftValueToOverrideType`) | three values → `training`; Sunday → `correction` |
| `roster-data.test.mjs` | `getShiftBadge`/`getShiftClass` per flavour |
| e2e | smoke: admin page renders the Training pill; calendar renders a seeded training day (if fixture-cheap) |

## Docs to update (same-commit rules apply)

- **CLAUDE.md**: Shift types table (+`TRG`/`IND`/`ASSESS`/`TRG RDW` row), `overrides` collection
  `type`/`value` lists, an Architecture-decisions row (training = pay-as-base; grammar; 8h
  default; Sunday block; `resolveOverrideShift` is the single source), pill-order note.
- **`.claude/rules/paycalc.md`**: payroll rules — the pay table above + payslip lines (RDW 1.25 /
  Overtime 1.25 / BH Overtime 1.25) + “never less than base”.
- **OPERATIONS_REFERENCE.md**: upload recognition grammar + review behaviour.
- **AI_MAP.md**: new `override-utils.js` exports + the exported `shiftValueToOverrideType`.
- **Staff-facing help**: one entry each in `paycalc-help.js` (what the 8h RDW default means),
  admin `CARD_TIPS` (the Training pill), and the staff guide page.

---

## Build order (each step gate-green before the next; one version bump per commit)

1. **Foundation** — `override-utils.js` grammar/labels/resolver + tests · server `normaliseShift`
   + AI prompt + tests · `firestore.rules` + rules tests · `shiftValueToOverrideType` hoist/export
   + Sunday guard in `computeCellStates`.
2. **Display** — badges/classes/labels, calendar renderer (incl. full-word tap detail), team
   view, legend/key, all CSS screen+print.
3. **Pay** — engine mapping + 8h default + hint copy + tests.
4. **Admin entry** — Training pill + flavour/RDW-tick/optional-times UI + Sunday layer-3.
5. **Docs + guides** — everything above; final e2e + 375px badge-fit check.

**Gates per step:** `npm run check` · `npm run test:functions` · `npm run test:rules` (steps 1)
· `npm run test:e2e` (steps 2+). Live verification in a private window after deploy.

## ⚠️ Release sequencing — do not merge this with the B3 sweep

The branch currently carries **v15.33 (CLAIM_EPOCH → 2, the B3 token sweep)**, unmerged. The
standing rule (LOGIN_INCIDENT.md / SECURITY_RELEASE_PLAN.md → B3) is **never ship an auth-flag
change and a feature rollout in the same release** — separate the variables. So: **merge and
deploy the sweep first, on its own**, health-check it, and only then merge Training work as its
own later release. The B3 **strict cutover** must also not ride with Training.
