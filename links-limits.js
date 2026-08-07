// @ts-check
/**
 * links-limits.js — HARD limits: the ones a design either meets or does not (v19.80, owner).
 *
 * ── WHY THIS IS A SEPARATE MODULE FROM links-fatigue.js ────────────────────────────────────────
 *
 * That module's governing rule is that it **reports factors present and never passes or fails a
 * design**, because the ORR is explicit its p3 factors are not prescriptive limits. Everything
 * about it is built on that: amber and never red, `standing` counted apart from `present`, "this
 * panel is an aid to a conversation, not a fatigue risk assessment".
 *
 * A HARD limit is the opposite kind of statement. **13 consecutive worked days comes from the
 * Hidden report** (owner, Aug 2026) — Anthony Hidden QC's inquiry into the Clapham Junction crash
 * of 12 December 1988, in which 35 people died. Excessive working hours were among its findings:
 * the technician whose wiring error caused the crash had worked thirteen consecutive weeks without
 * a rest day. The working-hours limits the railway industry adopted from its recommendations are
 * known as the Hidden limits, and a design that exceeds one is not "featuring a factor worth
 * justifying" — it is one that cannot be run. Rendering that in the same amber, inside the same
 * "not pass/fail" framing, would understate it exactly as much as recolouring the ORR rows red
 * would overstate them.
 *
 * ⚠️ **IT IS NOT LEGISLATION, AND THE WORDING MUST NOT DRIFT THERE** (v19.85, re-sourced v19.90).
 * This module has now had three attributions and the history is the reason the current one is
 * pinned by tests. It first called 13 "the UK railway legal maximum" and printed "cannot be run"
 * in red on a sheet going to an assessing manager, sourced to nothing but "owner, Aug 2026"; an
 * external review could not substantiate that, so v19.85 reclassified it as a Chiltern company
 * limit. That was true and safe, but it understated the provenance — it left the number looking
 * local and arbitrary, and invited the reply "says who?". Hidden is an INQUIRY REPORT whose
 * recommendations the industry adopted as standards and which companies apply through their own
 * safety management systems: stronger than a house rule, still not statute.
 *
 * Naming the real source is what makes the row survivable. "Hidden report" is a citation an
 * assessing manager can check, and it explains why the number is thirteen rather than any other
 * number. `basis` is asserted by a test in BOTH directions — it must name Hidden, and no row in
 * any state may present itself as law — because the number alone was already pinned before v19.85,
 * and pinning a number does not pin the claim around it.
 *
 * Note the ORR's framing is different again, and the two must not be conflated: it treats more
 * than 13 shifts WITHOUT A 48h BREAK as fatigue factor FF11 — a different measurement, which
 * `links-fatigue.js` does separately and correctly — and says its guidelines are not prescriptive
 * limits. Same number, different question, different kind of answer.
 *
 * So the separation is STRUCTURAL, not a label. A hard-limit check lives in a different module, is
 * returned by a different function, is counted in a different total and is rendered in its own
 * section. That is deliberate: put a hard limit into `assessFatigue`'s `results` array and within a
 * release it is being tallied into "3 present · 2 standing", carrying an amber left edge, and
 * collapsing into the quiet-rows disclosure when it passes. None of those would look wrong.
 *
 * ── THREE RULES THAT MUST SURVIVE ANY EDIT ─────────────────────────────────────────────────────
 *
 * 1. **The answer is a WORST CASE, and that is what makes it a hard-limit check rather than a
 *    description.** A spare week is four duties whose placement the roster clerk chooses week by
 *    week, so if any placement reaches 14 the LINK PERMITS a breach — it does not matter that it
 *    usually works out. A check that reported the typical case would be answering a question
 *    nobody asked.
 *
 * 2. **It fails to `unknown`, never to `ok`.** An empty or part-built design has nothing to
 *    measure, and "no breach found" over a design with no lines in it is the most dangerous
 *    sentence this file could produce. Same principle as the fatigue module's insistence that
 *    silence must never be the same shape as compliance — with more riding on it.
 *
 * 3. **A passing hard-limit check still renders.** The fatigue panel hides `clear` rows behind a
 *    disclosure, which is right for 24 advisory factors and wrong here: the printed sheet goes to
 *    the assessing manager, and "the limit was checked and met" is a thing that must be
 *    visible on it, not a thing they have to expand a disclosure to discover.
 */

import { ROTATING_LINES, worstCaseWorkedRun } from './links-design.js';
import { toSequence } from './links-fatigue.js';

/**
 * The maximum number of consecutive days a person may work, from the working-hours limits the
 * industry adopted after the Hidden report into the Clapham Junction crash (owner, Aug 2026).
 * Named rather than inlined because it is quoted on screen, in the printed sheet and in the tests,
 * and those three must never be able to disagree.
 */
export const MAX_CONSECUTIVE_WORKED_DAYS = 13;

/**
 * @typedef {object} HardLimitCheck
 * @property {string} id
 * @property {string} title
 * @property {'ok'|'breach'|'unknown'} status
 * @property {number|null} value      - what the design actually reaches, or null when unmeasurable
 * @property {number} limit
 * @property {string} basis           - where the limit comes from, for the printed sheet
 * @property {string} detail
 */

/**
 * Assess a design against the hard limits.
 *
 * @param {Record<string, Record<string, any>>} patterns
 * @param {number} [lines=28]
 * @returns {{ checks: HardLimitCheck[], breaches: number, assessable: boolean }}
 */
export function assessHardLimits(patterns, lines = ROTATING_LINES) {
    const seq = toSequence(patterns, lines);

    // A design is assessable only once it has at least one worked day. `toSequence` fills a missing
    // line with RD, so an empty design produces a full-length sequence of rest days and a longest
    // run of 0 — which would read as a comfortable pass. That is rule 2 above, and it is the one
    // failure mode that would matter most.
    const anyWorked = seq.some(x => x.shift && x.shift !== 'RD' && x.shift !== 'OFF');
    const hasSpare = seq.some(x => x.shift === 'SPARE');

    /** @type {HardLimitCheck[]} */
    const checks = [];

    if (!anyWorked) {
        checks.push({
            id: 'consecutive-days',
            title: `More than ${MAX_CONSECUTIVE_WORKED_DAYS} consecutive days worked`,
            status: 'unknown', value: null, limit: MAX_CONSECUTIVE_WORKED_DAYS,
            basis: 'Hidden report (Clapham Junction, 1988)',
            detail: 'Nothing to assess yet — this design has no worked days in it.',
        });
        return { checks, breaches: 0, assessable: false };
    }

    const run = worstCaseWorkedRun(seq);
    const breach = run > MAX_CONSECUTIVE_WORKED_DAYS;
    checks.push({
        id: 'consecutive-days',
        title: `More than ${MAX_CONSECUTIVE_WORKED_DAYS} consecutive days worked`,
        status: breach ? 'breach' : 'ok',
        value: run,
        limit: MAX_CONSECUTIVE_WORKED_DAYS,
        basis: 'Hidden report (Clapham Junction, 1988)',
        detail: (breach
            ? `This design reaches ${run} consecutive worked days against the Hidden limit of ${MAX_CONSECUTIVE_WORKED_DAYS}. It cannot be run as drawn.`
            : `Longest possible run is ${run} days, within the Hidden limit of ${MAX_CONSECUTIVE_WORKED_DAYS}.`)
            // Stated whenever a spare week could move the answer — the figure is what the link
            // PERMITS, not what a given week produces, and a reader who takes it for the latter
            // will read a pass as a guarantee about something it never measured.
            + (hasSpare
                ? ` A spare week is 4 duties of 7 and the roster clerk places them, so this is the worst case the link allows.`
                : ''),
    });

    return { checks, breaches: checks.filter(c => c.status === 'breach').length, assessable: true };
}
