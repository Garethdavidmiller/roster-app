'use strict';

/**
 * functions/cell-day-rules.js — what a roster cell MEANS, given which day of the week it sits in.
 * Requires nothing: no Firebase, no HTTP, no clock. Imported by `functions/roster-parse-helpers.js`.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────
 *
 * Two rules live here and they are the same rule twice, which is the argument for keeping them
 * together rather than beside the loop that applies them:
 *
 *   · a cell the model reported as EMPTY
 *   · a cell the model reported as "not available" (`NA` / `N/A` / `NS`)
 *
 * Both are an ANSWER on Sunday and a QUESTION every other day, and for one reason: **Sunday is
 * uncontracted**. Nobody is rostered to be there, so "nothing written" and "not available" both
 * mean the same as "not working", and `RD` states it correctly. Monday to Saturday the person IS
 * contracted; the two stop coinciding, and writing `RD` would record a rest day the sheet never
 * claimed — silently, in the one place a silent wrong answer is worst.
 *
 * ── AND WHY NOT LEAVE THEM WHERE THEY WERE ──────────────────────────────────────────────────────
 *
 * The blank rule was applied at TWO sites in `buildSafeEntries` — a day whose header the model
 * never listed, and a header it listed with nothing in it — and its own comment records why that
 * matters: *"Both were 'RD' until v22.19, so the fix had to be made twice or it would have been
 * made nowhere the model actually goes."* A rule written out per call site is a rule that can be
 * fixed in one of them. Here there is one function and three call sites, and they cannot disagree.
 *
 * The history behind the blank rule — three real rosters, 50 member rows, 24 blank Sundays against
 * 5 blank Mon–Sat cells all belonging to one person, and why the model's three "independent layers"
 * are not independent — stays in `buildSafeEntries`, beside the decision to trust this at all.
 */

/** The token the prompt returns for a cell with no text in it. */
const BLANK_CELL_TOKEN = 'BLANK';

/**
 * The ways a roster says "not available". `NS` and `N/A` are spellings, not separate meanings.
 */
const NOT_AVAILABLE_TOKENS = new Set(['NA', 'N/A', 'NS']);

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

/**
 * Did the model report this cell as "not available"?
 *
 * Matches the WHOLE cell, never a substring: `NAT` and `ANA` are not this, and a time is not this.
 * @param {any} raw
 * @returns {boolean}
 */
function isNotAvailable(raw) {
    if (raw === undefined || raw === null) return false;
    return NOT_AVAILABLE_TOKENS.has(String(raw).trim().toUpperCase());
}

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
 * What a "not available" cell means on this day.
 *
 * The owner's fact is what decides it (20 Sep 2026): `NA` means NOT AVAILABLE, and "usually only
 * falls on a Sunday as it is uncontracted". The prompt used to answer this itself — `Return "RD"`,
 * unconditionally, for every day — which is the same mistake the blank rule exists to undo: a model
 * deciding what a cell MEANS when the meaning depends on a column the model is not asked to know.
 *
 * @param {number} dayIndex  0 = Sunday
 * @param {string} dayLabel  for the reviewer's message
 * @returns {string}
 */
function notAvailableMeaning(dayIndex, dayLabel) {
    return dayIndex === SUNDAY
        ? 'RD'
        : `UNKNOWN|marked NA (not available) on a contracted ${dayLabel || 'day'} — check the PDF`;
}

module.exports = {
    BLANK_CELL_TOKEN,
    NOT_AVAILABLE_TOKENS,
    SUNDAY,
    isPhysicallyBlank,
    isNotAvailable,
    blankCellMeaning,
    notAvailableMeaning,
};
