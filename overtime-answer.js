// @ts-check
// overtime-answer.js — the ONE place a day's answer is edited on the Overtime form.
//
// ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
//
// A day's answer carries up to three independent statements: the overtime MODE (when the member
// can do extra work), the WILLINGNESS tick (`fullTwelve` — they would go a full twelve hours), and
// the SUNDAY-RELEASE REQUEST (`releaseRequested` — please take me off the Sunday I am rostered to).
// The form used to edit them in three places, and each edit knew about some of the others: the mode
// change carried the willingness tick forward but not the request, and the request created an
// `unavailable` answer for a day that had none. Both were found by an external review of v23.85,
// and both are the same shape of defect — a transition that forgets a field it did not set out to
// touch. So every transition is here, pure, and tested against every other.
//
// ── THE RULES, EACH LEARNED THE HARD WAY ───────────────────────────────────────────────────────
//
//   1. THE REQUEST IS NOT AN ANSWER. Ticking "Ask to be taken off this Sunday" on a day with no
//      availability answer leaves the day UNANSWERED — `{ releaseRequested: true }` with no mode.
//      Until v23.87 it wrote `{ mode: 'unavailable' }` underneath, on the reasoning that this was
//      "the honest mode for I have said nothing". It is not: it is the one answer this feature must
//      never invent (OVERTIME_AVAILABILITY.md invariant 3 — no response is not "not available"),
//      and the completeness check then stopped counting the Sunday as still to answer, so a roster
//      clerk could read a "Not available" the member never gave. A mode-less answer is a state the
//      WORKING COPY may hold; `dayUnfinished` reads it as unfinished, so Submit refuses it until a
//      mode is chosen — which is what keeps the server's schema (mode required) exactly as it is.
//
//   2. A MODE CHANGE KEEPS THE REQUEST. The request is about CONTRACTED work and the mode about
//      overtime — different work entirely (invariant 14) — so no choice among the modes can speak
//      to it. That includes "Not available", and it includes the bulk "Mark all seven days Not
//      available", which is a mode change on every day at once. Before v23.87 the request survived
//      neither, with nothing on screen to say it had gone.
//
//   3. THE WILLINGNESS TICK DIES WITH "NOT AVAILABLE" — deliberately, and the server refuses the
//      pairing outright (`OPTIONAL_DAY_FIELDS` in functions/overtime-core.js). Unlike the request it
//      QUALIFIES the overtime answer, so a mode that says "none" leaves it nothing to qualify.
//
//   4. A FLAG OFF IS AN ABSENCE, NOT A STORED `false`. The server writes these fields only when
//      true; a client writing `false` would produce an answer structurally different from the saved
//      one and `sameAnswer` would report a saved form as changed for ever. So a flag is DELETED, and
//      an answer left with nothing in it is `undefined` — the day goes back to exactly unanswered.
//
//   5. NOTHING HERE MUTATES. Every function returns a new object (or the same one when nothing
//      changed), so the form can compare before and after and a stale reference can never be edited
//      behind a repaint.

/**
 * Choose an availability MODE for a day, carrying forward whatever the member has said that the
 * new mode does not contradict.
 *
 * @param {any} previous     the day's current working answer, or undefined
 * @param {string} mode      one of the AVAILABILITY modes
 * @param {{start?: string, end?: string}|null|undefined} shift  the day's roster context — the
 *        `before`/`after` boundaries are seeded from it
 * @returns {any} the new answer (the SAME object when the mode is unchanged)
 */
export function withMode(previous, mode, shift) {
    if (previous?.mode === mode) return previous;
    // The two riders. The request survives EVERY mode (rule 2); the willingness tick survives every
    // mode but `unavailable` (rule 3).
    const keep = {
        ...(mode !== 'unavailable' && previous?.fullTwelve === true ? { fullTwelve: true } : {}),
        ...(previous?.releaseRequested === true ? { releaseRequested: true } : {}),
    };
    switch (mode) {
        case 'unavailable':
        case 'all_day':
        case 'twelve_hours':
            return { mode, ...keep };
        case 'before':
            return { mode, until: shift?.start || '', ...keep };
        case 'after':
            return { mode, from: shift?.end || '', ...keep };
        case 'before_after':
            return { mode, until: shift?.start || '', from: shift?.end || '', ...keep };
        case 'custom':
            return { mode, start: '', end: '', nextDay: false, ...keep };
        default:
            return { mode, ...keep };
    }
}

/**
 * Tick or untick "I'd work up to a full 12-hour day". A refinement of an AVAILABLE answer, so on a
 * day with no mode, or with `unavailable`, it changes nothing — the form does not render the
 * control there, and the server would refuse the pairing.
 * @param {any} previous @param {boolean} on
 * @returns {any}
 */
export function withFullTwelve(previous, on) {
    if (!previous?.mode || previous.mode === 'unavailable') return previous;
    if (on) return previous.fullTwelve === true ? previous : { ...previous, fullTwelve: true };
    if (previous.fullTwelve !== true) return previous;
    const { fullTwelve: _drop, ...rest } = previous;
    return rest;
}

/**
 * Tick or untick "Ask to be taken off this Sunday". Stands alone (rule 1): on a day with no answer
 * it creates a mode-less `{ releaseRequested: true }`, and unticking on such a day returns
 * `undefined` — the day is exactly unanswered again, not answered "unavailable".
 * @param {any} previous @param {boolean} on
 * @returns {any} the new answer, or `undefined` when nothing is left of it
 */
export function withRelease(previous, on) {
    if (on) return previous?.releaseRequested === true ? previous : { ...(previous || {}), releaseRequested: true };
    if (previous?.releaseRequested !== true) return previous;
    const { releaseRequested: _drop, ...rest } = previous;
    return Object.keys(rest).length ? rest : undefined;
}
