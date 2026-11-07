# OTHER_DAYS.md — the "Other" day family (Training / Induction / Assessment / Team Day / Union / Meeting)

*Not version-stamped; not a runtime asset. **BUILT + SHIPPED** — a record and a how-to, not a plan
(renamed from `OTHER_PLAN.md`). The shipped behaviour is documented in CLAUDE.md, AI_MAP.md,
OPERATIONS_REFERENCE.md and `.claude/rules/paycalc.md`; the pay and grammar single source is
`override-utils.js`. What remains here: the **design decisions** (cited from code as "OTHER_DAYS.md
decision N"), the **Evolution** record of the rename to the Other family, and the **Phase B**
checklist for adding a flavour. Every flavour planned so far has shipped.*

## Evolution — decisions confirmed by Gareth, Jul 2026

The training family became the **"Other" family**: a home for every non-standard day type.
Training / Induction / Assessment were its first flavours; then **Team Day**; **Union course**
(roster word "Union course"; badge + full word "Union"; pays as the day underneath; Sunday-blocked);
and **Meeting** (roster code "MTG", also "MEETING"; badge "Meet" / full "Meeting"; pays as the day
underneath; Sunday-blocked — confirmed by Gareth Jul 2026).
**Both Meeting and Union also carry `hideBaseTime`:** their calendar hours slot shows the badge with
NO time unless a time is actually entered (they are attend-an-event days). Training / Induction /
Assessment / Team Day still show the base shift time — they run DURING your shift. (Gareth Jul 2026.)

| Decision | Answer |
|---|---|
| Family name | **Other** — pill "Other", legend "Other", Saved-Changes pill "Other" |
| Stored type | **`type: 'other'`** (renamed from `training` pre-deploy — a MEET under type `training` would have been permanently wrong) |
| Icon | **🏷️ label/tag** (replaces 🎓 — a tag says "day labelled as something else"; the badge word IS the label). Chosen over 📌 (weaker metaphor) |
| Badge | 🏷️ + SHORT flavour word (Train / Ind / Assess / Team — later Meet / Union). Confirmed: badge never literally reads "Other" |
| Colour | **Leaf green `oklch(46% 0.115 136°)`** (`--other`/`--other-light`, 18% tint). NOT the original bronze — bronze (65°) was hue-identical to Early's orange (64.1°): indistinguishable at tint level and literally the same colour under red-green colour-blindness. Green 136° is the only empty band (46° from AL teal 183°); under deutan vision it keeps a yellow-olive cast while teal stays blue-grey, so it separates BETTER for colour-blind staff. Swatch proof: the "green-vs-teal" artifact, Jul 2026. "Reassess down the line" per Gareth |
| Manual UX | One **"Other"** pill → previously-hidden submenu with **full-word** flavour chips (generated from `OTHER_FLAVOURS`), the pre-ticked-on-rest-day RDW tick, optional times. **A flavour must be chosen — no default:** a Training pre-select silently mis-categorised an unnoticed induction/assessment/team day, so the save errors until a flavour is tapped. New kinds become chips, never new pills. **Spare also lives here:** a 📋 purple chip demoted from a top pill — but it is NOT a training flavour; picking it writes a `spare_shift`/'SPARE' (not an 'other' day) and hides the RDW tick + times |
| In a base pattern | A **bare** flavour, Monday to Saturday only. `fixedRoster[3]` is `TRG` Mon–Fri, a starter's training weeks shown as training with no times (owner, 6 Nov 2026). A pattern may not carry times (the hours slot is filled only by an override, so the cell would hide them while the day panel printed them), an `RDW` marker (shown, never paid — the pay engine reads Other days from overrides) or a Sunday; `validateRosterPatterns` refuses all three. Pay is unchanged: a weekday pays as contracted basic either way |
| Namespace note | The legacy unknown-value fallback classes were renamed `other-day`→`unknown-day`, `badge-other`→`badge-unknown` so the Other family owns the `other-*`/`--other` names coherently with `type: 'other'` |

**Flavour semantics (owner, Jul 2026):** `ASSESS` means the member is the **assessor** — spending
the day conducting assessments of junior staff (most likely a CES duty). It is a full-day activity
exactly like delivering training, so the pay-as-the-day treatment and the 8h rest-day default are
correct for it — do not shorten the default for assessments.

**Worked-base RDW tick (owner, Jul 2026):** ticking "Rest day (RDW)" on a day whose base roster is a
WORKED shift is ALLOWED (the admin may know the roster is wrong) but shows a brief warning line —
"Originally rostered {base} this day — RDW pays it as rest-day working instead" (`.other-rdw-warn`,
synced by `_syncOtherRdwWarn` on tick/activate/prefill). Rest-day rows never warn.

## Phase B — adding a new Other flavour (the precise checklist)

Union course and Meeting were added this way (roster code "MTG" / "MEETING"; badge "Meet" / full
"Meeting"). **Gareth's Phase B answers (Jul 2026):** pay the same way (as the day underneath, 8h RDW
default on a rest day) = **yes**; Sunday block = **yes**; and both Meeting + Union show **no shift
time** unless one is actually entered (the `hideBaseTime` flag — see Evolution).

Per new flavour, the touch-list (short because the submenu chips are GENERATED from `OTHER_FLAVOURS`
and the server uses an explicit alias table, so neither needs hand-edited UI):

1. `override-utils.js` — one `OTHER_FLAVOURS` entry (`MEET: {badge:'Meet', full:'Meeting'}` /
   `UNION: {badge:'Union', full:'Union'}`). Nothing else in this file: `_OTHER_RE` is built from
   `OTHER_FLAVOURS`.
2. `functions/roster-other-days.js` — one `OTHER_DAY_ALIASES` entry per roster word, and the words in
   `BARE_OTHER_DAY` (the deliberate server-side duplicate, recognition only; its header says why).
3. `firestore.rules` — add the sentinel to the training-grammar `matches()` clause (rules deploy —
   rides `deploy-rules.yml`, gated by the emulator suite).
4. `functions/roster-prompt.js` — one `SHIFT_VOCABULARY` ("WHAT THE CODES MEAN") line per flavour.
   `roster-prompt-parity.test.mjs` then holds both sides of that line to what `normaliseShift` reads.
5. Tests — grammar matrix rows (`override-utils.test`), recognition aliases (`roster-parse-helpers.test`),
   rules accept/reject rows (`firestore.rules.test` TYPE_VALUE_MAP loop covers the happy path),
   one pay-engine case each, badge words (`roster-data.test`).
6. Copy strings that enumerate the flavours (only if wording should change): the flavour-choice save
   error and the admin `CARD_TIPS` (both `admin-app.js`), the `staff-guide.html` badge row and table,
   and `paycalc-help.js` — plus the docs sweep (CLAUDE.md shift-types row, AI_MAP, OPERATIONS_REFERENCE).
   The Sunday row note, pill aria-labels (`admin-week-editor.js`) and Sunday save error say "Other"
   and need nothing.
7. One version bump; verify a new-flavour day at 375px in a private window.

Comment vocabulary: shared-code comments say "Other family" / "Other day" for the whole family. Left
as "training" on purpose: peer-training (a separate pay item), user-facing copy, the `TRG` flavour
data, and the "Training / Induction / Assessment …" enumeration headers.

---

## Locked decisions (the record of the design conversation)

*Cited from code as "OTHER_DAYS.md decision N" (currently decisions 5 and 8). Identifiers below
predate the rename — read `training` as the `other` family, 🎓 as 🏷️, and bronze as leaf
green (see Evolution above for the final values).*

| # | Decision | Answer |
|---|----------|--------|
| 1 | Family colour | **Bronze** — one new token pair `--trg` / `--trg-light` (as-was) (all three flavours share it) |
| 2 | Badge | 🎓 + short flavour word: **Train** / **Ind** / **Assess** |
| 3 | Hours slot (where a time normally shows) | The **time** (base shift time, or actual times when entered) — or the word **RDW** for a training rest-day with no times |
| 4 | Tap on the day (day-detail / tooltip / aria) | The **full word**: "Training" / "Induction" / "Assessment" (+ " — Rest Day Worked" when RDW, + times when known) |
| 5 | Pay on a rostered day | Base hours at **that day's rate** (basic / Sat 1.25× / BH), automatic; never less |
| 6 | Pay on a training rest-day (TRG RDW) | **Default 8h → RDW bucket**, manually adjusted afterwards (member in pay calc, or admin by entering real times) |
| 7 | Over-run | Excess beyond the base shift → the existing **Overtime** bucket (BH over-run → BH-overtime bucket, matching the payslip). RDW days are never split — all hours stay RDW |
| 8 | How RDW-ness is decided | **Explicitly marked on the roster** ("TRG RDW"). Manual entry gets an RDW tick, **pre-ticked** when the day's base is a rest day. Engine belt-and-braces: base RD/OFF ⇒ treat as RDW even if the flag is missing |
| 9 | Sunday | **Blocked** — a Sunday can never be a training day (same enforcement-layer treatment as AL/Absent; the layers are enumerated in CLAUDE.md) |
| 10 | Admin manual entry | Yes — **one** "Training" pill in Change a Shift; picking it reveals flavour choice + RDW tick + **optional** time boxes (blank = defaults) |
| 11 | Times storage | Optional, on the override value itself (see grammar). Roster upload carries times for a **meeting** only (`"10:00-14:00 MTG"` imports as `MEET 10:00-14:00` — `functions/roster-other-days.js`); for every other flavour only manual admin entry does |
| 12 | Worked-day status | Training counts as a **worked** day (dispatcher BH-lieu counting included — a BH training earns lieu, since it pays as the day) |
