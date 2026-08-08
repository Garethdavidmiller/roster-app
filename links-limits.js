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
 * A HARD limit is the opposite kind of statement: a design that exceeds one is not "featuring a
 * factor worth justifying" — it is one that cannot be run. Rendering that in the same amber, inside
 * the same "not pass/fail" framing, would understate it exactly as much as recolouring the ORR rows
 * red would overstate them.
 *
 * ── WHOSE LIMIT IT IS (v19.96 — the fourth and, one hopes, final attribution) ───────────────────
 *
 * **It is CHILTERN's roster limit** (owner, Aug 2026: at Chiltern these limits are carried in
 * company policy). Its ORIGIN is the working-hours standard the industry adopted after the **Hidden
 * report** — Anthony Hidden QC's inquiry into the Clapham Junction crash of 12 December 1988, in
 * which 35 people died; excessive working hours were among its findings, the technician whose
 * wiring error caused the crash having worked thirteen consecutive weeks without a rest day.
 *
 * **But that industry standard was WITHDRAWN in 2007, and this row must not imply otherwise.** The
 * ORR's current fatigue guidance says the post-Clapham limits were based heavily on what was
 * operationally achievable at the time rather than on fatigue science, that the group standard
 * carrying them was withdrawn, and that it now expects duty holders to run a risk-based fatigue
 * management system and set their own suitable company standards. RAIB's London Bridge report
 * describes the "Hidden limits" the same way — historic, superseded by a risk-based approach, and
 * retained by an individual operator only where that operator chooses to keep them alongside legal
 * requirements and local agreements.
 *
 * Which is precisely the situation here: Chiltern is such an operator. So the row is defensible as
 * **a company limit with a named historic origin**, and indefensible as *"the current industry
 * limit"* — the claim it made from v19.90 to v19.95, when the section was headed "Industry limits ·
 * Hidden report — must be met". An external review could not substantiate that, and it was right
 * not to: an assessing manager who checked the citation would have found a standard withdrawn
 * nineteen years ago and reasonably discounted everything else on the sheet.
 *
 * ⚠️ **IT IS NOT LEGISLATION, AND THE WORDING MUST NOT DRIFT THERE.** Four attributions now, each
 * corrected in turn, which is why the claim is pinned by tests as hard as the number is:
 *
 *   v19.80  "the UK railway legal maximum"     — unsubstantiable; printed "cannot be run" in red
 *   v19.85  "Chiltern company limit"           — true and safe, but understated the provenance
 *   v19.90  "Hidden report", industry limit    — right source, wrong tense: presented as current
 *   v19.96  Chiltern policy, Hidden origin     — whose limit it is, and where the number came from
 *
 * Note the ORR's own use of the same number is different again, and the two must not be conflated:
 * it treats more than 13 shifts WITHOUT A 48h BREAK as advisory fatigue factor FF11 — a different
 * measurement, which `links-fatigue.js` does separately and correctly. Same number, different
 * question, different kind of answer.
 *
 * ── "13 CONSECUTIVE DAYS" vs THE HISTORIC "13 SHIFTS IN 14 DAYS" ───────────────────────────────
 *
 * The historic formulation is *no more than 13 shifts in any 14 consecutive days*. This module
 * measures the longest run of consecutive worked days. **For a one-duty-per-day roster the two are
 * equivalent**, in both directions: a maximum run of 13 forces at least one rest day into every
 * 14-day window (so at most 13 shifts in it), and conversely 14 consecutive worked days is 14
 * shifts in 14 days. Marylebone CEAs work at most one duty a day, so the substitution holds here.
 *
 * It is written down because it is an ASSUMPTION, not an identity — it would stop holding the day
 * anyone works two duties in a day, and the failure would be silent: the run check would still pass
 * a design that the rolling formulation refuses.
 *
 * ⚠️ **THE EXACT POLICY CITATION IS STILL OUTSTANDING** — title, clause, which staff group it
 * covers, and its effective/review date. `basis` names the policy so a manager can ask for it,
 * which is the minimum bar; a row that says "must be met" ought to be able to say *where*. See
 * KNOWN_LIMITATIONS.md → Links.
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
 * The maximum number of consecutive days a person may work: **Chiltern's roster limit**, carried in
 * company policy (owner, Aug 2026), historically derived from the post-Clapham Hidden standard —
 * see the attribution history in the module header before changing this or the wording round it.
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
 * @param {number} [lines=ROTATING_LINES]
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
            basis: 'Chiltern roster policy — legacy Hidden 13-in-14 standard',
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
        basis: 'Chiltern roster policy — legacy Hidden 13-in-14 standard',
        detail: (breach
            ? `This design reaches ${run} consecutive worked days against Chiltern's limit of ${MAX_CONSECUTIVE_WORKED_DAYS} (the historic Hidden standard). It cannot be run as drawn.`
            : `Longest possible run is ${run} days, within Chiltern's limit of ${MAX_CONSECUTIVE_WORKED_DAYS} (the historic Hidden standard).`)
            // Stated whenever a spare week could move the answer — the figure is what the link
            // PERMITS, not what a given week produces, and a reader who takes it for the latter
            // will read a pass as a guarantee about something it never measured.
            + (hasSpare
                ? ` A spare week is 4 duties of 7 and the roster clerk places them, so this is the worst case the link allows.`
                : ''),
    });

    return { checks, breaches: checks.filter(c => c.status === 'breach').length, assessable: true };
}
