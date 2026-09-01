// @ts-check
/**
 * roster-cell-rules.js — what a parsed roster cell MEANS as an override.
 *
 * Owns: the two rules that stand between "the PDF said X" and "we wrote Y" — the per-cell guards
 *   (`normaliseCellValue`) and the value-to-override-type mapping (`shiftValueToOverrideType`).
 * Does NOT own: the parse, the review states, the renderer, or any write.
 * Edit here for: a guard, or a new override type the import can produce.
 *
 * ── WHY IT IS ITS OWN MODULE (v22.17) ──────────────────────────────────────────────────────────
 *
 * Two consumers and a cycle. `admin-roster-upload.js`'s state machine has always needed these; the
 * in-place entry control now needs `normaliseCellValue` too, so an entered value passes exactly the
 * guards a parsed one does. Neither of the obvious homes works: they cannot live in
 * `override-utils.js`, because they need `isSunday` and `roster-data.js` already imports
 * override-utils (a cycle `import-graph.test.mjs` refuses), and they cannot live in the entry
 * control, because the state machine would then import the widget.
 *
 * A module that imports both and is imported by neither of them resolves it — and it is the honest
 * home anyway. These are RULES about meaning, not coordination, and the ratchet said so first.
 *
 * ── THE GUARDS ARE NOT OPTIONAL, AND THE REASON IS IN THEM ─────────────────────────────────────
 *
 * Every path that produces a value for the review — the parsed cell, a picked reading, an entered
 * shift — goes through `normaliseCellValue`. Two copies of these rules would eventually let one of
 * those paths write a Sunday AL, which is the one thing the six-layer Sunday rule exists to prevent.
 */

import { isSunday } from './roster-data.js';
import { sundaySafeValue, isOtherValue } from './override-utils.js';

const RDW_PREFIX   = 'RDW|';
const isRdwEncoded = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(RDW_PREFIX);
const stripRdw     = /** @param {any} v */ v => v.slice(RDW_PREFIX.length);

/**
 * Normalise one parsed cell value into the pair the review table compares and saves.
 *
 * Extracted from computeCellStates (v19.32) because a SECOND consumer arrived: an unreadable cell
 * where the two AI reads disagreed now offers both readings as a pick, and a picked value has to
 * pass exactly the same guards a parsed one does. Two copies of these rules would eventually let a
 * pick write a Sunday AL — the one thing the Sunday layer exists to prevent.
 *
 * Both guards are deliberate and documented elsewhere:
 *  · SUNDAY (CLAUDE.md): Sundays are non-contracted for every grade, so a PDF marking one as AL,
 *    Absent, or an Other-family day is invalid — it becomes RD, matches the rest-day base, and is
 *    never written. A worked Sunday TIME is untouched (it becomes RDW downstream).
 *  · BASE REST DAY (v16.19, owner Jul 2026): full-pay absence and AL apply only to days the member
 *    was rostered to WORK. This is the overpay guard for blanket Mon–Fri "OD" markings, and it stops
 *    a week-long "AL" scrawled across the paper roster consuming entitlement for the rest days
 *    inside it. The manual AL path already excludes rest days; this closes the import asymmetry.
 *
 * `display` keeps the "RDW|" marker while `value` is stripped: the stripped form compares correctly
 * against stored plain-time docs (so re-imports don't churn), while the marked form is what gets
 * SAVED — without it a weekday rest-day-worked import writes {type:'shift'} and the overtime is lost
 * from both the calendar badge and paycalc's RDW pre-fill (v16.23).
 *
 * @param {string} rawShift  parsed value, possibly "RDW|HH:MM-HH:MM"
 * @param {string} baseShift the member's base roster value for that date
 * @param {string} date      "YYYY-MM-DD"
 * @returns {{ value: string, display: string }}
 */
export function normaliseCellValue(rawShift, baseShift, date) {
    const parsedValue = isRdwEncoded(rawShift) ? stripRdw(rawShift) : rawShift;
    const isSun       = isSunday(date);
    const sundaySafe  = isSun ? sundaySafeValue(parsedValue) : parsedValue;
    const normRest = /** @param {any} s */ s => (s === 'OFF' ? 'RD' : s);
    const restSafe = ((normRest(sundaySafe) === 'SICK' || normRest(sundaySafe) === 'AL') && normRest(baseShift) === 'RD')
        ? 'RD' : sundaySafe;
    return {
        value:   normRest(restSafe),
        display: (isRdwEncoded(rawShift) && restSafe !== 'RD') ? `${RDW_PREFIX}${restSafe}` : restSafe,
    };
}

/**
 * Map a shift value to the Firestore override `type` field.
 * This mirrors the existing override type vocabulary.
 * Module-scope + exported (v15.34) so the classification is unit-testable —
 * it is pure (uses only isSunday and the module's value helpers).
 *
 * @param {string} value     - e.g. "05:30-11:30", "SPARE", "AL", "SICK", "RD", "TRG RDW"
 * @param {string} baseShift - the base roster shift for that day (e.g. "RD", "06:00-12:00")
 * @param {string|null} date - ISO date string "YYYY-MM-DD" — used to detect Sunday
 * @returns {string}  override type
 */
export function shiftValueToOverrideType(value, baseShift, date = null) {
    // Layer 4 of the Sunday rule — the transformation is `sundaySafeValue` (override-utils.js).
    // A value it rewrites to RD becomes a correction rather than the type it claimed to be.
    const isSun = date !== null && isSunday(date);
    if (isSun && sundaySafeValue(value) === 'RD' && value !== 'RD') return 'correction';
    if (value === 'AL')    return 'annual_leave';
    if (value === 'SICK')  return 'sick';
    if (value === 'SPARE') return 'spare_shift';
    // Training / Induction / Assessment (OTHER_PLAN.md) — flavour sentinel, optional
    // " RDW" marker, optional actual times. Checked before RD/RDW: a 'TRG RDW' value must
    // classify as an Other day, not fall through on its RDW substring (no clash today — the
    // bare-'RDW' and pipe checks are exact/prefix — but the ordering makes that explicit).
    if (isOtherValue(value)) return 'other';
    if (value === 'RD' || value === 'OFF') return 'correction';
    // Pipe-encoded RDW from AI: "RDW|14:30-22:00" — explicit flag regardless of base shift
    if (isRdwEncoded(value) || value === 'RDW') return 'rdw';
    // Sunday is always uncontracted — any shift worked on a Sunday is an RDW.
    // For all other days, only classify as RDW when the AI explicitly flagged it above.
    // Staff may swap rest/working days with permission without it being an RDW.
    const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value);
    if (isTime && isSun) return 'rdw';
    // Spare week receiving its actual allocation — semantically distinct from overtime
    return 'shift';
}
