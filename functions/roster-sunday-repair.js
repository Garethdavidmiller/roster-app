'use strict';

/**
 * functions/roster-sunday-repair.js — the Sunday-anchored day-shift repair (layer 1 of the drift
 * defence), and what happens to a Sunday it could not repair.
 *
 * Moved out of `roster-parse-helpers.js` at the v24.28 review, which was at its line cap with this
 * fix to make. Requires `cell-day-rules.js` and `roster-parse-helpers.js`; nothing requires it but
 * `functions/index.js` and the tests.
 *
 * ** `.claude/rules/roster-import.md` IS THE CONTRACT FOR THIS PIPELINE — read it before changing
 * anything here.**
 *
 * ── TWO DEFECTS THE REVIEW FOUND, AND THE RULE EACH LEFT BEHIND ────────────────────────────────
 *
 * 1. **The empty trailing slot changed shape at v22.25, and the clean repair never noticed.** A
 *    row that skipped its blank Sunday ends with nothing in the Saturday slot. That slot used to
 *    arrive as `RD`; since the prompt asks the model to REPORT an empty cell it arrives as `BLANK`,
 *    and `buildSafeEntries` turns a blank Saturday into the "no Saturday cell was read" question.
 *    `=== 'RD'` never matched it, so every real left-shift took the partial branch below and kept
 *    Mon–Fri a day out. Both shapes are the empty slot now.
 *
 * 2. **The partial branch must not overwrite the Sunday claim.** It used to set Sunday to `RD`,
 *    which erased the one value the geometry witness (roster-geometry.js, applied later) could
 *    refuse — and a refusal is what unticks the member's whole row on the review. So the claim is
 *    left where it is and the member is returned as DISPUTED; `settleDisputedSundays` runs after the
 *    witness and sends to review any disputed Sunday the witness could not look at. A Sunday the
 *    grid shows as occupied keeps the row read when the scan called it EMPTY: the physical fact
 *    beats a second reading by the same model. When the scan saw a printed rest code the grid
 *    agrees with the scan, not the row read, and the Sunday goes to review (re-review R-A1).
 */

const { blankCellMeaning, isPhysicallyBlank, isNotAvailable, isNotAvailableSunday } = require('./cell-day-rules');
const { reviewLabel } = require('./roster-parse-helpers');

/** The value `buildSafeEntries` writes for a Saturday the model reported empty. */
const BLANK_SATURDAY = blankCellMeaning(6, 'Saturday');

/** The Sunday scan saw NOTHING in the cell — the only reading the PDF grid can contradict. */
const scanSawEmpty = (/** @type {any} */ raw) => isPhysicallyBlank(raw) || String(raw).trim().toUpperCase() === 'EMPTY';

/** The Sunday scan saw a printed rest code. NA and NS on a Sunday are both the rest day a Sunday
 *  already is (cell-day-rules.js, which also reads `N.A.` as `NA`). */
const scanSawRestCode = (/** @type {any} */ raw) => {
    const s = String(raw).trim().toUpperCase();
    return s === 'RD' || s === '-' || isNotAvailable(s) || isNotAvailableSunday(s);
};

/**
 * Apply Sunday scan corrections to safe entries (modifies in place).
 *
 * The AI commits to what it sees in each Sunday cell via sundayScan (a dedicated "look at ONLY
 * the Sunday column" pass) before producing the full parsed output. It catches:
 *   Case A — DAY-SHIFT: the AI skips the blank Sunday cell and shifts the whole row LEFT —
 *     Monday's shift lands in the Sun key, …, and the Saturday slot is left empty (`RD` before
 *     v22.25, the blank-Saturday question since). That signature is exactly a one-day left-shift,
 *     so a one-day RIGHT-shift deterministically undoes it. If Saturday is occupied the shift can't
 *     be cleanly reversed, and the Sunday claim is left for the witness (see the header).
 *   Case B — worked Sunday with RDW stripped — sundayScan="RDW HH:MM" but parsed has plain time.
 *
 * @param {object[]} safeEntries    - modified in place
 * @param {object}   sundayScan     - { memberName: scanValue } from AI output
 * @param {boolean}  hasSundayColumn
 * @param {string[]} dates          - 7 ISO dates; dates[0] is Sunday, dates[6] Saturday
 * @returns {string[]} members whose Sunday claim the scan disputes and nothing could repair
 */
function applySundayScanCorrections(safeEntries, sundayScan, hasSundayColumn, dates) {
    /** @type {string[]} */
    const disputed = [];
    if (!sundayScan || typeof sundayScan !== 'object') return disputed;
    if (!hasSundayColumn) return disputed;
    if (dates.length < 7) return disputed;   // a full Sun→Sat week is required for the shift repair

    const sunDate     = dates[0];
    const satDate     = dates[6];
    const isPlainTime = v => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v);

    for (const entry of safeEntries) {
        const scanRaw = sundayScan[entry.memberName];
        if (scanRaw === undefined || scanRaw === null) continue;

        const scanStr  = String(scanRaw).trim().toUpperCase();
        const sunShift = entry.shifts[sunDate];

        // Case A: scan says the Sunday cell is blank, but the AI put SOMETHING there.
        // NA and NS on a Sunday are both blank-equivalent: the rest day a Sunday already is (cell-day-rules.js).
        // OFF is a rest day (the CES and bilingual rosters print it), not a claim — without this a
        // correct OFF week was right-shifted a day.
        const isBlank = scanSawEmpty(scanStr) || scanSawRestCode(scanStr);
        if (isBlank && sunShift !== 'RD' && sunShift !== 'OFF') {
            const sat = entry.shifts[satDate];
            if (sat === 'RD' || sat === BLANK_SATURDAY) {
                // Clean left-shift signature (Sat empty) → RIGHT-shift the whole row to undo it:
                // each day takes the value the AI mis-placed one slot earlier; Sunday becomes RD;
                // the old (empty) Saturday slot falls off. Provably reverses a one-day left-shift.
                for (let i = 6; i >= 1; i--) entry.shifts[dates[i]] = entry.shifts[dates[i - 1]];
                entry.shifts[sunDate] = 'RD';
                console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (blank) but parsed Sunday="${sunShift}" and Saturday empty — day-shift detected, RIGHT-shifted the week to realign`);
            } else {
                // Can't cleanly reverse (Saturday is occupied). Leave the claim for the witness.
                disputed.push(entry.memberName);
                console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (blank) but parsed Sunday="${sunShift}" with a non-empty Saturday — left for the PDF grid to settle; a wider shift may remain, CHECK THE REVIEW TABLE`);
            }
            continue;
        }

        // Case B: scan says RDW shift but AI stripped the RDW prefix
        if (scanStr.includes('RDW') && isPlainTime(sunShift)) {
            console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (RDW) but parsed Sunday="${sunShift}" (plain time) — adding RDW prefix`);
            entry.shifts[sunDate] = `RDW|${sunShift}`;
        }
    }
    return disputed;
}

/**
 * After the geometry witness: a disputed Sunday the witness did not look at goes to review
 * (modifies in place). One it refused is already a question; one whose cell the grid shows as
 * OCCUPIED keeps the row read — but ONLY when the scan saw a literally empty cell, which the grid
 * then contradicts. A printed rest code (NS, NA, RD, '-') is ink in that cell: the grid's
 * "occupied" AGREES with the scan and is no evidence for the worked shift the row read put there.
 *
 * @param {object[]} safeEntries
 * @param {string[]} disputed   from applySundayScanCorrections
 * @param {{ ran?: boolean, unmatched?: string[] }|null|undefined} geoStats  from applyGeometryWitness
 * @param {string[]} dates
 * @param {Record<string, any>|null|undefined} sundayScan  the model's Sunday scan; without it no row read stands
 */
function settleDisputedSundays(safeEntries, disputed, geoStats, dates, sundayScan) {
    if (!Array.isArray(disputed) || !disputed.length) return;
    const unmatched = new Set((geoStats && geoStats.unmatched) || []);
    for (const entry of safeEntries) {
        if (!disputed.includes(entry.memberName)) continue;
        const v = entry.shifts[dates[0]];
        if (typeof v !== 'string' || v.startsWith('UNKNOWN|')) continue;   // the witness refused it
        const scan = sundayScan && typeof sundayScan === 'object' ? sundayScan[entry.memberName] : undefined;
        if (geoStats && geoStats.ran && !unmatched.has(entry.memberName)
            && scan !== undefined && scanSawEmpty(scan)) continue;   // the grid saw occupied what the scan called empty
        entry.shifts[dates[0]] = `UNKNOWN|${reviewLabel(v)} was read for Sunday, but a second look saw no shift there — check the PDF`;
        console.warn(`[parseRosterPDF] ${entry.memberName}: disputed Sunday "${v}" could not be checked against the PDF grid — sent to review`);
    }
}

module.exports = { applySundayScanCorrections, settleDisputedSundays };
