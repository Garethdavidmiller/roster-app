// @ts-check
/**
 * admin-shift-rules.js — the two rules a shift change must not break, decided without a DOM.
 *
 * ── WHY IT LEFT THE COORDINATOR (v21.38, external review) ───────────────────────────────────────
 *
 * A maximum shift length and a minimum rest gap are the only checks standing between a saved
 * override and somebody being rostered a duty they may not legally work. They lived inside a
 * function that also queried `document`, marked rows red and read module-level cache state — so the
 * rule and the paint were one thing, and the rule could only be exercised through a fake DOM.
 *
 * The split is along the honest seam: this module DECIDES, the caller PAINTS. What comes back is
 * both the sentences to show and the dates that failed, so the caller can mark exactly those rows
 * without re-deriving anything — re-deriving is how the message and the highlight come to disagree.
 *
 * ── THE ADJACENT DAY IS RESOLVED BY THE CALLER, ON PURPOSE ──────────────────────────────────────
 *
 * `checkShiftRules` never reads a cache. It asks `resolveShift(dateISO)` for the neighbouring day,
 * which keeps it pure — and, more usefully, keeps the decision honest about its own inputs: the
 * caller is the thing that knows whether the cache holds that member authoritatively, and a rule
 * that fetched for itself would happily answer from an empty cache. A missed rest gap and a cache
 * that had not loaded look identical from in here, which is exactly why the question is asked
 * outward. See `admin-override-coverage.js`.
 *
 * ── WHAT AN "OTHER" DAY CONSTRAINS ──────────────────────────────────────────────────────────────
 *
 * The Other family (Training, Induction, Assessment, Team Day, Union, Meeting) carries the grammar
 * `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`, and the three cases are genuinely different:
 *
 *   · TIMED        → constrains by its own times; the member is at work then
 *   · untimed RDW  → exempt; it is a rest day with an event on it and no hours we can know
 *   · untimed base → constrains by the BASE shift, because the member attends during their shift
 *
 * Collapsing those was a real defect: a naive `split('-')` on `TRG 09:00-17:00` shreds into NaN and
 * silently skips every check on that day, which reads as "no problem found".
 *
 * Pure — no DOM, no Firebase. Tested by admin-shift-rules.test.mjs.
 */

import { parseOtherValue, isRestShift } from './override-utils.js';

/** Maximum length of a single shift. */
export const MAX_SHIFT_MINS = 12 * 60;
/** Minimum rest between the end of one shift and the start of the next. */
export const MIN_REST_MINS = 12 * 60;

/** @param {string} timeStr @returns {number} */
export function parseMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

/**
 * End time in minutes, unwrapped past midnight so a night shift is later than its start rather
 * than earlier — the difference between a 8-hour night and a "minus 16 hour" one.
 * @param {string} startStr @param {string} endStr @returns {number}
 */
export function effectiveEndMins(startStr, endStr) {
    const s = parseMinutes(startStr), e = parseMinutes(endStr);
    return e >= s ? e : e + 24 * 60;
}

/** @param {number} mins @returns {string} */
export function fmtHours(mins) {
    const h = mins / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h';
}

/**
 * What times, if any, does a value constrain by? `null` means "does not constrain" — which is a
 * different answer from "constrains by nothing" and is why this returns null rather than ''.
 * @param {string} value the effective shift value on the adjacent day
 * @param {() => string} baseShiftFor resolves that day's BASE shift, called only when needed
 * @returns {string|null} an `HH:MM-HH:MM` string, or null
 */
export function constrainingTime(value, baseShiftFor) {
    let shift = value;
    const other = parseOtherValue(shift);
    if (other) {
        if (other.time) shift = other.time;
        else if (other.rdw) return null;             // untimed Other on a rest day — hours unknowable
        else {
            shift = baseShiftFor() || '';
            if (parseOtherValue(shift) || isRestShift(shift)) return null;
        }
    }
    if (!shift || !shift.includes('-')) return null;
    return shift;
}

/**
 * Check the maximum-duration and minimum-rest rules across a pending save batch.
 *
 * @param {object} args
 * @param {any[]} args.toSave                       pending entries `{date, value, type}`
 * @param {(type: string) => boolean} args.isFixedType  true for types whose value is not a time
 * @param {(dateISO: string) => string} args.resolveShift  effective shift on any date, batch-aware
 * @param {(dateISO: string) => string} args.baseShiftFor  base roster shift on any date
 * @param {(dateISO: string) => string} args.formatDate    display form for a message
 * @param {(dateISO: string, delta: number) => string} args.shiftDate  date arithmetic, ±1 day
 * @returns {{ errors: string[], failedDates: string[] }} sentences to show, and the rows to mark.
 *   `failedDates` is deduplicated: one row can break both neighbours' rest gaps and must not be
 *   marked twice, while both sentences are still worth saying.
 */
export function checkShiftRules({ toSave, isFixedType, resolveShift, baseShiftFor, formatDate, shiftDate }) {
    /** @type {string[]} */ const errors = [];
    /** @type {string[]} */ const failedDates = [];
    const fail = (/** @type {string} */ date, /** @type {string} */ msg) => {
        if (!failedDates.includes(date)) failedDates.push(date);
        errors.push(msg);
    };

    toSave.forEach(entry => {
        const { date, value, type } = entry;
        if (isFixedType(type)) return;
        let checkValue = value;
        if (type === 'other') {
            const t = parseOtherValue(value);
            if (!t || !t.time) return;               // an untimed Other day has nothing to check
            checkValue = t.time;
        }
        if (!checkValue || !checkValue.includes('-')) return;

        const [startStr, endStr] = checkValue.split('-');
        const startMins = parseMinutes(startStr);
        const endMins   = effectiveEndMins(startStr, endStr);

        const duration = endMins - startMins;
        if (duration > MAX_SHIFT_MINS) {
            fail(date, `${formatDate(date)}: shift is ${fmtHours(duration)} — max is 12h`);
            return;                                   // an over-long shift is the finding; stop here
        }

        [-1, 1].forEach(delta => {
            const adjISO = shiftDate(date, delta);
            const adjShift = constrainingTime(resolveShift(adjISO), () => baseShiftFor(adjISO));
            if (!adjShift) return;
            const [adjStart, adjEnd] = adjShift.split('-');
            if (delta === -1) {
                const prevEnd = effectiveEndMins(adjStart, adjEnd);
                const gap = startMins + 24 * 60 - prevEnd;
                if (gap < MIN_REST_MINS) {
                    fail(date, `${formatDate(date)}: only ${fmtHours(gap)} rest after ${formatDate(adjISO)} shift — need 12h`);
                }
            } else {
                const nextStart = parseMinutes(adjStart);
                const gap = nextStart + 24 * 60 - endMins;
                if (gap < MIN_REST_MINS) {
                    fail(date, `${formatDate(date)}: only ${fmtHours(gap)} rest before ${formatDate(adjISO)} shift — need 12h`);
                }
            }
        });
    });

    return { errors, failedDates };
}
