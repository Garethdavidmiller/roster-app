'use strict';

/**
 * functions/cell-day-rules.js — what a roster cell MEANS, given which day of the week it sits in.
 * Requires nothing: no Firebase, no HTTP, no clock. Required by `roster-parse-helpers.js`,
 * `roster-prompt.js` and `roster-sunday-repair.js`.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
 *
 * ── ONE DAY RULE, AND TWO CODES THAT USED TO BE ONE ─────────────────────────────────────────────
 *
 * A cell the model reported as EMPTY means something different on a Sunday — the uncontracted
 * column, whose blank is how the sheet says "not working" — from any other day, where a blank is a
 * cell nobody read. A per-cell normaliser cannot know which column it is reading, so the rule lives
 * here, one function, and its two call sites in `buildSafeEntries` cannot disagree.
 *
 * `NA` / `N/A` and `NS` — NOT AVAILABLE — were decided here too, by the day, until v25.38:
 *
 *   v24.20  `NA` a Sunday rest day and a Mon–Sat QUESTION, on a misheard remark that it "usually
 *           only falls on a Sunday".
 *   v24.22  `NA` an ABSENCE Monday to Saturday and a rest day on Sunday (owner, 24 Sep 2026: it
 *           "always means absent"); `NS` the Sunday code, a rest day there and absent on a weekday.
 *   v25.38  BOTH A REST DAY, ON EVERY DAY (owner, 6 Nov 2026: "NA and NS should be treated as rest
 *           days on the roster uploader", Sundays included).
 *
 * The last answer took the day out of the question, so `normaliseShift` now records both as the
 * rest day, beside `SN`. Their RECOGNISERS stay here: `normaliseShift` asks them, and so does the
 * Sunday scan repair (`roster-sunday-repair.js`), which reads the printed code before anything has
 * normalised it — one list of what the roster writes, so the two cannot disagree about a spelling.
 *
 * ── AND WHY NOT LEAVE THE BLANK RULE WHERE IT WAS ───────────────────────────────────────────────
 *
 * The blank rule was applied at TWO sites in `buildSafeEntries` — a day whose header the model
 * never listed, and a header it listed with nothing in it — and its own comment records why that
 * matters: *"Both were 'RD' until v22.19, so the fix had to be made twice or it would have been
 * made nowhere the model actually goes."* A rule written out per call site is a rule that can be
 * fixed in one of them. Here it is one function, and its call sites cannot disagree.
 *
 * The history behind the blank rule — three real rosters, 50 member rows, 24 blank Sundays against
 * 5 blank Mon–Sat cells all belonging to one person, and why the model's three "independent layers"
 * are not independent — stays in `buildSafeEntries`, beside the decision to trust this at all.
 */

/** The token the prompt returns for a cell with no text in it. */
const BLANK_CELL_TOKEN = 'BLANK';

/**
 * Every word a model writes for an EMPTY cell, in upper case: nothing at all, the BLANK both prompts
 * ask for, the EMPTY it sometimes writes instead, and a lone dash, which the shared vocabulary itself
 * calls blank ("NO text at all (or only a dash)"). ONE list for every read of a cell (whole-app fix,
 * Nov 2026): the row read knew only the first two, so an empty Sunday it reported as "-" was an
 * unreadable claim, and the Sunday repair moved a correctly read week a day right.
 */
const BLANK_READINGS = Object.freeze(['', BLANK_CELL_TOKEN, 'EMPTY', '-']);

/** The ways a roster writes "not available" — a rest day (v25.38). `N/A` is a spelling of `NA`. */
const NOT_AVAILABLE_TOKENS = new Set(['NA', 'N/A']);

/** The Sunday code: "not available on a Sunday". A different code from `NA`, not a spelling of it,
 *  and a rest day too, on whichever day it is written (v25.38). */
const NOT_AVAILABLE_SUNDAY_TOKENS = new Set(['NS']);

/** Sunday's index in a Sunday-first week. Named because `0` alone reads as "the first column". */
const SUNDAY = 0;

/**
 * Does this reading say the cell was EMPTY — no answer at all, or one of `BLANK_READINGS`? This is
 * what a cell MEANS, so the row read, the column scan and the geometry path's check of an empty read
 * all ask it.
 * @param {any} raw
 * @returns {boolean}
 */
function isBlankReading(raw) {
    if (raw === undefined || raw === null) return true;
    return BLANK_READINGS.includes(String(raw).trim().toUpperCase());
}

/**
 * …and was there NOTHING in the cell, not even ink? The same, less the dash: the PDF grid sees a
 * printed dash as an occupied cell, so where a reading is weighed against the grid
 * (`settleDisputedSundays`) a dash is a printed code, not an empty cell.
 * @param {any} raw
 * @returns {boolean}
 */
function isPhysicallyBlank(raw) {
    return isBlankReading(raw) && String(raw ?? '').trim() !== '-';
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
 * Is this cell `NA` / `N/A` — not available? (`normaliseShift` records it as the rest day.)
 *
 * Matches the WHOLE cell, never a substring: `NAT` and `ANA` are not this, and a time is not this.
 * @param {any} raw
 * @returns {boolean}
 */
function isNotAvailable(raw) { return isWholeCell(raw, NOT_AVAILABLE_TOKENS); }

/**
 * Is this cell `NS` — not available on a Sunday? (A rest day on any day — `normaliseShift`.)
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

module.exports = {
    BLANK_CELL_TOKEN,
    BLANK_READINGS,
    NOT_AVAILABLE_TOKENS,
    NOT_AVAILABLE_SUNDAY_TOKENS,
    SUNDAY,
    isBlankReading,
    isPhysicallyBlank,
    isNotAvailable,
    isNotAvailableSunday,
    blankCellMeaning,
};
