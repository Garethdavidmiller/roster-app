// @ts-check
/**
 * roster-cell-rules.js — what a parsed roster cell MEANS as an override.
 *
 * Owns: the two rules that stand between "the PDF said X" and "we wrote Y" — the per-cell guards
 *   (`normaliseCellValue`) and the value-to-override-type mapping (`shiftValueToOverrideType`) — and
 *   the `RDW|` / `UNKNOWN|` review encodings every import module reads.
 * Does NOT own: the parse, the review states, the renderer, or any write.
 * Edit here for: a guard, or a new override type the import can produce.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
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

// ── THE TWO REVIEW-ONLY ENCODINGS, DEFINED ONCE (whole-app fix, Nov 2026) ─────────────────────────
// They were written out in this module, in roster-alignment.js and in roster-review-states.js, whose
// comment said a second copy was what it avoided. This module is the one all three can import
// without a cycle; roster-review-states.js re-exports them for the renderer and its tests.

/** The review's internal marker for "this worked time is rest-day working". The value SAVED to
 *  Firestore is the bare time — the RDW-ness lives in the override's `type` — so this prefix
 *  exists only between the parse and the save. */
export const RDW_PREFIX     = 'RDW|';
export const isRdwEncoded   = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(RDW_PREFIX);
export const stripRdw       = /** @param {any} v */ v => v.slice(RDW_PREFIX.length);

/** UNKNOWN|<raw> — a value the AI returned that `normaliseShift` (server) could not recognise as a
 *  shift. Surfaced in review as an UNREADABLE cell so a garbled real shift isn't silently dropped;
 *  never written to Firestore (roster-review-states.js, rule 3). Mirrors the RDW encoding. */
export const UNKNOWN_PREFIX   = 'UNKNOWN|';
export const isUnknownEncoded = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(UNKNOWN_PREFIX);
export const stripUnknown     = /** @param {any} v */ v => v.slice(UNKNOWN_PREFIX.length);

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
 * @returns {{ value: string, display: string, guarded: 'sunday'|'sunday-other'|'rest-day'|null }}
 *
 * `guarded` NAMES THE GUARD THAT CHANGED THE VALUE, and exists so the review can say so (v23.97).
 * Both guards silently rewrite a real thing the PDF said into `RD`, and until now the only record
 * of that was the rewrite itself — the classifier compared the RESULT against the base roster,
 * found `RD === RD`, and called the cell a MATCH. Deriving it a second time at the call site was
 * the alternative and is the pattern this module exists to prevent: two copies of a rule, one of
 * which eventually stops agreeing. Returning it is one authority, still pure.
 *
 * Sunday wins when both could apply, because it runs first and leaves nothing for the rest-day
 * guard to act on — so the reported guard is always the one that actually moved the value.
 */
export function normaliseCellValue(rawShift, baseShift, date) {
    const parsedValue = isRdwEncoded(rawShift) ? stripRdw(rawShift) : rawShift;
    const isSun       = isSunday(date);
    const sundaySafe  = isSun ? sundaySafeValue(parsedValue) : parsedValue;
    const normRest = /** @param {any} s */ s => (s === 'OFF' ? 'RD' : s);
    const restSafe = ((normRest(sundaySafe) === 'SICK' || normRest(sundaySafe) === 'AL') && normRest(baseShift) === 'RD')
        ? 'RD' : sundaySafe;
    // The Sunday guard REFUSED the value only where it made it a rest day. A timed Other day it
    // turns into Sunday work at those times is recorded, not refused (`sundaySafeValue`), so it is
    // not reported as guarded — a review row saying nothing is recorded would then be untrue.
    const sundayGuarded = sundaySafe !== parsedValue && sundaySafe === 'RD';
    // A TRAINING OR MEETING DAY ON A SUNDAY IS ITS OWN REASON (owner, 7 Nov 2026: "You can't have
    // training or a meeting on a Sunday"). Leave or an absence there means the member is not at work,
    // so `RD` is the answer; an Other day there is a roster that cannot be right, so nothing is
    // recorded at all — `computeCellStates` holds the row, whatever the base or a saved record says.
    return {
        value:   normRest(restSafe),
        display: (isRdwEncoded(rawShift) && restSafe !== 'RD') ? `${RDW_PREFIX}${restSafe}` : restSafe,
        guarded: sundayGuarded ? (isOtherValue(parsedValue) ? 'sunday-other' : 'sunday')
               : (restSafe !== sundaySafe ? 'rest-day' : null),
    };
}

/**
 * Map a shift value to the Firestore override `type` field.
 * This mirrors the existing override type vocabulary.
 * Module-scope + exported (v15.34) so the classification is unit-testable —
 * it is pure (uses only isSunday and the module's value helpers).
 *
 * The base shift is NOT a parameter (whole-app fix, Nov 2026): it was passed by every caller and read
 * by none. A caller still passing it would hand a shift where the date belongs and silently lose the
 * Sunday rule, so anything that is not an ISO date there is refused loudly instead.
 *
 * @param {string} value     - e.g. "05:30-11:30", "SPARE", "AL", "SICK", "RD", "TRG RDW"
 * @param {string|null} date - ISO date string "YYYY-MM-DD" — used to detect Sunday
 * @returns {string}  override type
 */
export function shiftValueToOverrideType(value, date = null) {
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        throw new TypeError(`shiftValueToOverrideType: "${date}" is not an ISO date — the base shift is no longer an argument`);
    }
    // Layer 4 of the Sunday rule — the transformation is `sundaySafeValue` (override-utils.js).
    // A value it rewrites to RD becomes a correction rather than the type it claimed to be.
    const isSun = date !== null && isSunday(date);
    if (isSun) {
        const safe = sundaySafeValue(value);
        if (safe === 'RD' && value !== 'RD') return 'correction';
        // A timed Other day is Sunday work at its times, which is rest-day working like any Sunday
        // time — never an `other` record on a Sunday (6 Nov 2026 review).
        value = safe;
    }
    if (value === 'AL')    return 'annual_leave';
    if (value === 'SICK')  return 'sick';
    if (value === 'SPARE') return 'spare_shift';
    // Training / Induction / Assessment (OTHER_DAYS.md) — flavour sentinel, optional
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

/**
 * Is this a worked-time value whose start and end are the SAME clock time?
 *
 * Equal times are the one range shape that is always wrong here: every duration helper in the app
 * treats `end <= start` as an overnight wrap, so a zero-length range is read as TWENTY-FOUR HOURS
 * and reaches pay. `end < start` is deliberately NOT caught — a genuine overnight shift is ordinary
 * on this roster. Accepts the internal `RDW|` encoding as well as a bare time (v20.39).
 * @param {string} value
 * @returns {boolean}
 */
export function isZeroLengthRange(value) {
    const m = String(value).replace(/^RDW\|/, '').match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    return !!m && m[1] === m[3] && m[2] === m[4];
}
