// @ts-check
/**
 * links-target-hours.js — does this target table pay the contract, and what does the card say so?
 *
 * Owns: the VERDICT on a generator target table (hours per line, the gap, on-target or not) and the
 *   words the card states it in — including the provenance note about where the table came from.
 * Does NOT own: the minutes arithmetic (`targetExSundayMinutes`/`dutyMinutes` in links-design.js),
 *   the default table (links-default-targets.js), or any DOM. `links-app.js` writes the result.
 * Edit here for: the on-target rule, the wording of the gap, the provenance note.
 *
 * ── WHY THIS IS ITS OWN MODULE (v21.31) ─────────────────────────────────────────────────────────
 *
 * The app had already extracted and tested the MEASUREMENT and left the JUDGEMENT in a coordinator
 * — and the defect was in the judgement.
 *
 * `targetExSundayMinutes` is covered by two suites. The verdict built on it — the tick, the class,
 * and the sentence a designer acts on — had no unit test at all, only two end-to-end string
 * assertions. At v21.07 it passed anything within half an hour, a tolerance inherited from the
 * Design-checks row where it is correct because a design can be painted by hand. Here it was wrong:
 * `generateLink` refuses on an EQUALITY, so a table twenty minutes short wore a green "on target
 * (35h)" and then met a red refusal on the next press. Nothing could have caught that without a
 * browser, because the rule and the `getElementById` calls were the same function.
 *
 * ── THE THREE RULES THAT MUST SURVIVE AN EDIT ───────────────────────────────────────────────────
 *
 * 1. **ON TARGET MEANS EXACTLY, BECAUSE THE GENERATOR MEANS EXACTLY.** No tolerance, ever. The tick
 *    is a prediction of what `generateLink` will do; a tick that is kinder than the gate is a
 *    promise the next press breaks. If the gate ever gains a tolerance, this changes WITH it, from
 *    the same constant — not in parallel.
 *
 * 2. **SUNDAYS ARE EXCLUDED, AND THE DIVISOR IS THE WHOLE ROTATION.** Two different exclusions that
 *    look like one. Sunday is not contracted for any grade, so counting it toward 35 would report a
 *    week as contracted using time that is not. The AVERAGE, separately, divides by every line and
 *    counts each spare week as a full contracted week — which is what the Design-checks row does, so
 *    the card predicting one figure and the finished design reporting another would be two answers
 *    to one question arriving four seconds apart.
 *
 * 3. **THE GAP IS STATED AS A TOTAL, NEVER PER LINE.** The per-line average divides by the whole
 *    rotation, so a full hour of missing duty reads "0h 02m" — a figure that makes a refusal look
 *    like a rounding error. The total is the number that has to reach zero.
 *
 * Pure: no DOM, no Firebase. Tested by links-target-hours.test.mjs.
 */

import { dutyMinutes, targetExSundayMinutes, CONTRACTED_HOURS_PER_WEEK, hmFromHours } from './links-design.js';

/**
 * @typedef {{ time: string, weekday: number, sat: number, sun: number }} TargetSlot
 * @typedef {{ workingLines: number, hoursPerLine: number|null, askedMinutes: number|null,
 *   neededMinutes: number, diffMinutes: number|null, unreadable: number, onTarget: boolean,
 *   empty: 'no-working-lines'|'all-unreadable'|'no-hours'|'no-slots'|null }} TargetHours
 */

/**
 * Assess a target table against the contract.
 *
 * @param {TargetSlot[]} slots
 * @param {{ spareLines: number, totalLines: number }} opts
 * @returns {TargetHours}
 */
export function assessTargetHours(slots, { spareLines, totalLines }) {
    const rows = Array.isArray(slots) ? slots : [];
    const workingLines = totalLines - spareLines;

    // Mon–Fri counts five times, Saturday once. Sunday is deliberately absent — see rule 2.
    let minutes = 0;
    let unreadable = 0;
    for (const s of rows) {
        const m = dutyMinutes(s.time);
        // COUNTED WHETHER OR NOT IT CONTRIBUTES — because the GATE is, and the card is a prediction
        // of the gate (v21.31, found by this extraction). `targetExSundayMinutes` returns null on
        // ANY unreadable time and bails before it looks at the counts, so a garbled time on a row
        // asking for nobody still makes Generate refuse. The old rule only counted rows that would
        // have contributed, so that table showed a red tick, a vague "Xh under the contract" note,
        // and nothing at all about the row causing it. Naming it is the only way the note explains
        // the refusal it sits beside.
        if (m === null) { unreadable++; continue; }
        minutes += m * (s.weekday * 5 + s.sat);
    }

    const neededMinutes = workingLines * CONTRACTED_HOURS_PER_WEEK * 60;
    if (workingLines <= 0 || minutes === 0) {
        // Never a zero figure. A "0h 00m" reads as a finding about the targets rather than as an
        // empty table — the same mistake `weeklyHours` returns null to avoid. A table holding only
        // Sunday targets lands here too, so the caller must not claim there are no shifts.
        return {
            workingLines, hoursPerLine: null, askedMinutes: null, neededMinutes,
            diffMinutes: null, unreadable, onTarget: false,
            // A table whose rows are ALL unreadable is its own case (v21.31). It used to land on
            // "no Mon–Sat hours in these targets yet", which sends a designer looking for missing
            // COUNTS when the fault is the times — the same mistake as the silent unreadable row
            // above, one state over. Only reachable when nothing readable contributed.
            empty: workingLines <= 0 ? 'no-working-lines'
                : unreadable && !rows.some(r => dutyMinutes(r.time) !== null) ? 'all-unreadable'
                : rows.length ? 'no-hours' : 'no-slots',
        };
    }

    // Each spare week counts as a full contracted week and the divisor is the WHOLE rotation — the
    // Design-checks row's average, not a variant of it.
    const hoursPerLine = (minutes + spareLines * CONTRACTED_HOURS_PER_WEEK * 60) / 60 / totalLines;
    // The gate's OWN measure, so the tick and the refusal cannot disagree (null if any time used is
    // unreadable). Deliberately not recomputed from `minutes` above: that would be a second
    // arithmetic of the same question, which is the shape this module exists to remove.
    const askedMinutes = targetExSundayMinutes(rows);

    return {
        workingLines, hoursPerLine, askedMinutes, neededMinutes,
        diffMinutes: askedMinutes === null ? null : askedMinutes - neededMinutes,
        unreadable,
        // EQUALITY. See rule 1 — a tolerance here is a promise the generator breaks.
        onTarget: unreadable === 0 && askedMinutes !== null && askedMinutes === neededMinutes,
        empty: null,
    };
}

/**
 * The two lines the card shows for an assessment: the figure and the note beneath it.
 *
 * @param {TargetHours} a
 * @returns {{ value: string, tone: 'ok'|'off'|'none', note: string }}
 */
export function targetHoursLines(a) {
    if (a.empty) {
        return {
            value: '—', tone: 'none',
            note: a.empty === 'no-working-lines' ? 'every line is a spare week'
                : a.empty === 'all-unreadable'   ? `no shift times could be read — check the ${a.unreadable} time${a.unreadable === 1 ? '' : 's'} in the table`
                : a.empty === 'no-hours'         ? 'no Mon–Sat hours in these targets yet'
                :                                  'add a shift to see this',
        };
    }
    const lines = `${a.workingLines} working line${a.workingLines === 1 ? '' : 's'}`;
    const gap = a.onTarget
        ? `on target (${CONTRACTED_HOURS_PER_WEEK}h)`
        : a.diffMinutes !== null
            // "Generate needs it exact" is doing real work: it names the EQUALITY, which is what
            // stops the next press being a surprise. Do not soften it to "about".
            ? `${hmFromHours(Math.abs(a.diffMinutes) / 60)} ${a.diffMinutes < 0 ? 'short' : 'over'} in total — Generate needs it exact`
            // No readable total to compare, so fall back to the average's distance from contract.
            // Stated without the word "exact": we cannot claim what the gate would do from here.
            : `${hmFromHours(Math.abs((a.hoursPerLine ?? 0) - CONTRACTED_HOURS_PER_WEEK))} `
              + `${(a.hoursPerLine ?? 0) < CONTRACTED_HOURS_PER_WEEK ? 'under' : 'over'} the ${CONTRACTED_HOURS_PER_WEEK}h contract`;
    return {
        value: `${hmFromHours(a.hoursPerLine ?? 0)} each`,
        tone: a.onTarget ? 'ok' : 'off',
        note: `${gap} · over ${lines}`
            + (a.unreadable ? ` · ${a.unreadable} shift${a.unreadable === 1 ? '' : 's'} not counted (unreadable time)` : ''),
    };
}

/**
 * The provenance note — where the table on screen came from, when that is not the default.
 *
 * Names the SET when there is one, because "the table your device remembers" is true of a loaded set
 * and tells the designer nothing: they knew they loaded something, and what they cannot see is
 * which. Returns null when there is nothing worth saying, so the caller hides the row rather than
 * rendering an empty one.
 *
 * @param {{ fromMemory: boolean, differsFromDefault: boolean, setName?: string }} state
 * @returns {string|null}
 */
export function targetProvenanceNote({ fromMemory, differsFromDefault, setName = '' }) {
    if (!fromMemory || !differsFromDefault) return null;
    return (setName
        ? `These hours came from the saved set “${setName}”, not the recommended Dec 2026 staffing. `
        : 'These hours are from the table your device remembers, not the recommended Dec 2026 staffing. ')
        + 'Press “Use the recommended Dec 2026 staffing” to load it; anything you change here is kept.';
}
