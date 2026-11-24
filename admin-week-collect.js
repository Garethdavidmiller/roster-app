// @ts-check
// admin-week-collect.js — what ONE press of the week grid's Save asks to write.
//
// ── WHY A MODULE ───────────────────────────────────────────────────────────────────────────────
//
// It was 130 lines inside the Save click handler in `admin-app.js`, behind the session guard, the
// login overlay and the Firestore client, so the only way to test it was to SLICE it out of the
// source text and evaluate it (override-utils.test.mjs did, under fixed variable names). Here it is a
// function that takes the rows and returns the batch, so the Sunday promotion, the swapped-day
// refusal and the Other grammar are tested by importing them (review, 21 Nov 2026).
//
// ── WHAT IT DOES AND DOES NOT DO ───────────────────────────────────────────────────────────────
//
// It reads each staged row and says what the save would write (`toSave`), which saved records the
// grid has unset (`toDelete`), the swapped-day answers (`swapAnswers`) and why a row cannot be saved
// (`errors`, each starting with the row's date). It marks a refused row with `row-error`, because the
// refusal and the red row are one fact — and that is ALL it touches: no read of the cache, no write.
// What a batch then MEANS for annual leave is `admin-al-week-save.js`'s, and the days that take no
// change at all `admin-shift-rules.js`'s, both after this.
//
// ── THE SUNDAY ANSWERS (CLAUDE.md, layer 6) ───────────────────────────────────────────────────
//
// `SUNDAY_FORBIDDEN_TYPES` (override-utils.js) is the list, and this cannot be a loop over it, because
// its four types get three different answers: `shift` is PROMOTED to `rdw`, `other` is refused unless
// it is Spare, leave and absence are refused. `override-utils.test.mjs` pins each type to an answer.

import { isSunday } from './roster-data.js';
import { TYPES } from './admin-shift-types.js';
import { composeOtherValue, OTHER_FLAVOURS } from './override-utils.js';
import { composeTimedValue } from './clock-input.js';

/** "Training, Induction, …, Meeting or Spare": every Other flavour, read from `OTHER_FLAVOURS`, then Spare. */
const OTHER_DAY_KINDS = `${Object.values(OTHER_FLAVOURS).map(f => f.full).join(', ')} or Spare`;

/**
 * What the week grid's Save would write, from its rows.
 * @param {{ rows: Iterable<HTMLElement>|ArrayLike<HTMLElement>, memberName: string, formatDate: (iso: string) => string }} args
 *   `rows` are the grid's `.day-row`s (anything with their `dataset`, `classList` and `querySelector`)
 * @returns {{ toSave: any[], toDelete: string[], errors: string[], swapAnswers: Map<string, boolean> }}
 */
export function collectWeekRows({ rows, memberName, formatDate }) {
    /** @type {any[]} */
    const toSave = [];
    /** @type {Map<string, boolean>} */
    const swapAnswers = new Map();   // date → was this rest day a swapped working day? (this save's)
    /** @type {any[]} */
    const toDelete = [];
    /** @type {any[]} */
    const errors = [];

    Array.from(rows).forEach(row => {
        if (!row.dataset.type) {
            // Row was pre-filled with an existing override but user deactivated it → delete.
            if (row.dataset.existingId) toDelete.push(row.dataset.existingId);
            return;
        }
        // Pre-filled rows the user hasn't changed don't need re-saving.
        if (row.classList.contains('prefilled-existing')) return;

        const date    = row.dataset.date || '';
        let   type    = row.dataset.type || '';

        // ── Sunday write guard — the list is `SUNDAY_FORBIDDEN_TYPES` (override-utils.js) ──
        // A bespoke copy on purpose: each of the four types gets a DIFFERENT answer here (see
        // below), so this cannot be a loop over the declaration. `override-utils.test.mjs` pins
        // it to that list instead, so a fifth forbidden type fails there rather than being
        // silently written by this path.
        //
        // A worked Sunday is always RDW, never a plain shift (Sundays are uncontracted). The Shift
        // pill is disabled on Sunday rows, but promote defensively here too — matching the roster-
        // upload path — so a legacy or time-edited Sunday shift can never be written as a non-RDW
        // shift (which renders as an ordinary badge and the pay estimate's Sunday-OT pre-fill
        // misses). 'shift' and 'rdw' share the same timed value composition, so this flows cleanly.
        if (type === 'shift' && isSunday(date)) type = 'rdw';

        // ── THE SWAPPED-DAY ANSWER IS REQUIRED ───────────────────────────────────────────
        // AL on a base REST day costs nothing unless the member was SWAPPED onto it, which only the
        // person recording it knows. The row asks; this refuses to save it unanswered (al-swapped-days.js).
        if (type === 'annual_leave' && row.dataset.alSwapAsk === '1' && !row.dataset.alSwap) {
            row.classList.add('row-error');
            errors.push(`${formatDate(date)}: say whether this rest day was a swapped working day`);
            return;
        }
        if (type === 'annual_leave' && row.dataset.alSwap) swapAnswers.set(date, row.dataset.alSwap === 'yes');
        // Sundays are uncontracted — AL and sick cannot be saved on a Sunday regardless of how it was set
        if (type === 'annual_leave' && isSunday(date)) {
            row.classList.add('row-error');
            errors.push(`${formatDate(date)}: annual leave cannot be recorded on a Sunday`);
            return;
        }
        if (type === 'sick' && isSunday(date)) {
            row.classList.add('row-error');
            errors.push(`${formatDate(date)}: absence cannot be recorded on a Sunday`);
            return;
        }
        // The flavour BEFORE the Sunday guard: Spare sits under the Other pill but is its own type,
        // and IS legal on a Sunday.
        const otherFlavour = (/** @type {HTMLElement|null} */ (row.querySelector('.other-flavour-btn.active')))?.dataset.flavour;
        if (type === 'other' && isSunday(date) && otherFlavour !== 'SPARE') {
            row.classList.add('row-error');
            errors.push(`${formatDate(date)}: an "Other" day cannot be recorded on a Sunday`);
            return;
        }
        const typeMeta    = TYPES[type];
        const startEl = /** @type {HTMLInputElement} */ (row.querySelector('.day-start'));
        const endEl   = /** @type {HTMLInputElement} */ (row.querySelector('.day-end'));
        const note    = '';

        let value;
        if (type === 'other') {
            // Compose the Other-family grammar from the row's sub-controls:
            // FLAVOUR[" RDW"][" HH:MM-HH:MM"]. Times are OPTIONAL — blank means the pay
            // defaults apply (base shift on a rostered day, 8h RDW on an Other rest-day) —
            // but a half-filled or malformed pair is still an error.
            const flavour = otherFlavour;
            // An explicit flavour choice — no silent Training default (owner decision).
            if (!flavour) {
                row.classList.add('row-error');
                errors.push(`${formatDate(date)}: choose the type of Other day (${OTHER_DAY_KINDS})`);
                return;
            }
            if (flavour === 'SPARE') {
                // Spare is its OWN type — a standby placeholder, no RDW or times: written as spare_shift.
                toSave.push({ memberName, date, type: 'spare_shift', value: 'SPARE', note, existingId: row.dataset.existingId || null });
                return;
            }
            // composeOtherValue is the grammar's WRITER, beside its reader parseOtherValue. A rest-day
            // base FORCES the RDW marker, or the saved value would lie about how the day is paid.
            const _composed = composeOtherValue({
                flavour,
                rdwTicked: (/** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb')))?.checked,
                baseIsRd:  row.dataset.baseIsRd === '1',
                start:     (/** @type {HTMLInputElement} */ (row.querySelector('.day-start'))).value,
                end:       (/** @type {HTMLInputElement} */ (row.querySelector('.day-end'))).value,
            });
            if (_composed.error) {
                row.classList.add('row-error');
                errors.push(`${formatDate(date)}: ${_composed.error}`);
                return;
            }
            value = _composed.value;
        } else if (typeMeta && typeMeta.fixed) {
            value = typeMeta.fixedValue;
        } else {
            // ONE time rule for a timed day and an Other day's times (`composeTimedValue`, clock-input.js,
            // whose `timePairError` `composeOtherValue` shares), so the two never accept different clocks.
            const timed = composeTimedValue({ start: startEl.value, end: endEl.value });
            if (timed.error) {
                row.classList.add('row-error');
                errors.push(`${formatDate(date)}: ${timed.error}`);
                return;
            }
            value = timed.value;
        }

        // `swapped` is a WRITE INSTRUCTION, not a field — admin-overrides.js strips it before the
        // Firestore set, because `hasOnly()` in the rules would refuse a document carrying it.
        toSave.push({ memberName, date, type, value, note, existingId: row.dataset.existingId || null,
                      ...(type === 'annual_leave' && row.dataset.alSwap === 'yes' ? { swapped: true } : {}) });
    });

    return { toSave, toDelete, errors, swapAnswers };
}
