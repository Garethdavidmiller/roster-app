'use strict';

/**
 * functions/cell-day-rules.js — what a roster cell MEANS, given which day of the week it sits in.
 * Requires nothing: no Firebase, no HTTP, no clock. Imported by `functions/roster-parse-helpers.js`.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
 *
 * ── THREE RULES, ONE REASON ─────────────────────────────────────────────────────────────────────
 *
 * Three cell kinds live here because each one's meaning turns on the same fact — **Sunday is
 * uncontracted** — and a per-cell normaliser cannot know which column it is reading:
 *
 *   · a cell the model reported as EMPTY
 *   · a cell marked `NA` / `N/A` — NOT AVAILABLE, which is an ABSENCE
 *   · a cell marked `NS` — NOT AVAILABLE ON A SUNDAY
 *
 * ── THE OWNER'S CORRECTION (24 Sep 2026) ────────────────────────────────────────────────────────
 *
 * v24.20 read `NA` as "an answer on Sunday and a question everywhere else", on the owner's earlier
 * words that it "usually only falls on a Sunday as it is uncontracted". That was the wrong fact,
 * and the owner corrected it: **`NA` means not available and ALWAYS means absent.** It is normally
 * written Monday to Saturday; on a Sunday it is a clerical error. **`NS` is the Sunday code** — not
 * available on a Sunday — and the two are different codes, not spellings of one.
 *
 * So the rules are now:
 *
 *   `NA`/`N/A`  Mon–Sat → `SICK` (the app's Absent day — the reason is never stored, GDPR)
 *               Sunday  → `RD`, because a Sunday cannot hold an absence (CLAUDE.md, the six-layer
 *                         Sunday rule: the client's Sunday layer strips a Sunday `SICK` to `RD`
 *                         regardless, so writing `RD` here says the same thing one step earlier and
 *                         keeps the Sunday scans' blank-equivalence intact). The coordinator warns,
 *                         because the owner says a Sunday `NA` is an error worth noticing.
 *   `NS`        Sunday  → `RD` (not available and not working coincide — nobody is contracted)
 *               Mon–Sat → `SICK` (owner, 24 Sep 2026: "NS on a weekday should also mean absent").
 *               So the two codes carry ONE rule and differ only in which day is the clerical
 *               error — `NA` on a Sunday, `NS` on a weekday — which is what the warnings say.
 *   blank       Sunday  → `RD`; Mon–Sat → a question (v22.19, unchanged).
 *
 * ── AND WHY NOT LEAVE THEM WHERE THEY WERE ──────────────────────────────────────────────────────
 *
 * The blank rule was applied at TWO sites in `buildSafeEntries` — a day whose header the model
 * never listed, and a header it listed with nothing in it — and its own comment records why that
 * matters: *"Both were 'RD' until v22.19, so the fix had to be made twice or it would have been
 * made nowhere the model actually goes."* A rule written out per call site is a rule that can be
 * fixed in one of them. Here each rule is one function, and its call sites cannot disagree.
 *
 * The history behind the blank rule — three real rosters, 50 member rows, 24 blank Sundays against
 * 5 blank Mon–Sat cells all belonging to one person, and why the model's three "independent layers"
 * are not independent — stays in `buildSafeEntries`, beside the decision to trust this at all.
 */

/** The token the prompt returns for a cell with no text in it. */
const BLANK_CELL_TOKEN = 'BLANK';

/** The ways a roster writes "not available" — an absence. `N/A` is a spelling of `NA`. */
const NOT_AVAILABLE_TOKENS = new Set(['NA', 'N/A']);

/** The Sunday code: "not available on a Sunday". A different code from `NA`, not a spelling of it. */
const NOT_AVAILABLE_SUNDAY_TOKENS = new Set(['NS']);

/** Sunday's index in a Sunday-first week. Named because `0` alone reads as "the first column". */
const SUNDAY = 0;

/**
 * Did the model report this cell as physically empty? True for a missing key, an empty string and
 * the BLANK token — the three ways "there was nothing there" arrives.
 * @param {any} raw
 * @returns {boolean}
 */
function isPhysicallyBlank(raw) {
    if (raw === undefined || raw === null) return true;
    const s = String(raw).trim();
    return s === '' || s.toUpperCase() === BLANK_CELL_TOKEN;
}

/** Separators dropped before matching, so `N.A.` and `N/A` are the `NA` they spell. A cell
 *  that still does not match goes to review as unreadable, which is the safe failure.
 *  @param {any} raw @param {Set<string>} tokens */
function isWholeCell(raw, tokens) {
    if (raw === undefined || raw === null) return false;
    const s = String(raw).trim().toUpperCase();
    return tokens.has(s) || tokens.has(s.replace(/[./]/g, ''));
}

/**
 * Is this cell `NA` / `N/A` — not available, an absence?
 *
 * Matches the WHOLE cell, never a substring: `NAT` and `ANA` are not this, and a time is not this.
 * @param {any} raw
 * @returns {boolean}
 */
function isNotAvailable(raw) { return isWholeCell(raw, NOT_AVAILABLE_TOKENS); }

/**
 * Is this cell `NS` — not available on a Sunday?
 * @param {any} raw
 * @returns {boolean}
 */
function isNotAvailableSunday(raw) { return isWholeCell(raw, NOT_AVAILABLE_SUNDAY_TOKENS); }

/**
 * What an EMPTY cell means on this day.
 *
 * @param {number} dayIndex  0 = Sunday
 * @param {string} dayLabel  for the reviewer's message
 * @returns {string} a shift value, or an `UNKNOWN|…` sentinel for the review UI
 */
function blankCellMeaning(dayIndex, dayLabel) {
    return dayIndex === SUNDAY
        ? 'RD'
        : `UNKNOWN|no ${dayLabel || 'day'} cell was read — check the PDF`;
}

/**
 * What an `NA` cell means on this day: an ABSENCE Monday to Saturday; on a Sunday, where it is a
 * clerical error and no absence can be held, the rest day the Sunday already is.
 *
 * @param {number} dayIndex  0 = Sunday
 * @returns {'SICK'|'RD'}
 */
function notAvailableMeaning(dayIndex) {
    return dayIndex === SUNDAY ? 'RD' : 'SICK';
}

/**
 * What an `NS` cell means on this day: the rest day a Sunday already is, and — on a weekday, where
 * the Sunday code is a clerical error — an absence, exactly as `NA` (owner, 24 Sep 2026).
 *
 * @param {number} dayIndex  0 = Sunday
 * @returns {'SICK'|'RD'}
 */
function notAvailableSundayMeaning(dayIndex) {
    return notAvailableMeaning(dayIndex);
}

module.exports = {
    BLANK_CELL_TOKEN,
    NOT_AVAILABLE_TOKENS,
    NOT_AVAILABLE_SUNDAY_TOKENS,
    SUNDAY,
    isPhysicallyBlank,
    isNotAvailable,
    isNotAvailableSunday,
    blankCellMeaning,
    notAvailableMeaning,
    notAvailableSundayMeaning,
};
