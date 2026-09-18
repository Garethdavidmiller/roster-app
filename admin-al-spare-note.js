// @ts-check
// admin-al-spare-note.js — the one sentence the AL booking preview says about Spare days.
//
// ── WHY A MODULE FOR ONE SENTENCE ──────────────────────────────────────────────────────────────
//
// It was a template literal inside `renderReady` in `admin-al.js`, which imports Firebase through
// `admin-overrides.js` — so nothing could read the string in Node, and for four months nothing did.
// It shipped ungrammatical in BOTH branches at once (v11.35 → v23.72):
//
//     `${n} of these day${n !== 1 ? 's are' : ' is'} an unconfirmed "Spare" shift`
//
// pluralises `day` and nothing else, so n=1 renders "1 of these day is" and n=2 renders "2 of these
// days ARE AN unconfirmed shift". The owner read the first of those off a phone. A defect visible in
// every render and invisible to every test is the repo's own named blind spot — the rule tested and
// the wiring not — so the fix is a pure function with a test, not a better literal.
//
// ── WHAT IT MAY AND MAY NOT SAY (owner decision, 14 Sep 2026) ──────────────────────────────────
//
// **A day is a day.** A Spare day costs exactly ONE day of annual leave, whatever the shift turns
// out to be, and NOTHING here may suggest otherwise. The text this replaced said a shift over seven
// hours "may use more than 1 AL day", which was wrong three ways: the app's own accounting charges
// whole dates (`countedAlDates` returns a Set of them, `alPosition` subtracts their count), the
// depot's workbook charges one day per Spare day in the register, and the sentence was an inversion
// of an older instruction about a WEEK — "for shifts over 7h, add RD corrections to reduce to 4 AL
// days" — which pointed the other way and did not apply to a single day at all. It then sent the
// reader to their manager to settle a discrepancy the app had invented.
//
// So the note is INFORMATION, not a warning: it names the day type, says what Spare means, and
// closes the entitlement question rather than opening it. It carries 📋 — the Spare badge the app
// already uses — and not ⚠, because there is nothing here to be careful about.
//
// It is also written in the THIRD PERSON. A manager books leave on somebody else's behalf from this
// same card, so "you're on standby" would be addressed to the wrong person half the time.

/**
 * The Spare-day line for the AL booking preview, or `''` when there is nothing to say.
 *
 * @param {number} spareCount how many of the booked days have a Spare base shift
 * @param {number} totalDays  how many days the booking covers, so a one-day booking can say
 *                            "This is…" rather than "1 of these days is…", which has no "these"
 *                            to be one of
 * @returns {string} plain text, no markup — the caller decides how to wrap it
 */
export function spareShiftNote(spareCount, totalDays) {
    if (!Number.isFinite(spareCount) || spareCount < 1) return '';

    const MEANING = 'on standby, with the shift not yet assigned';
    // The cost sentence is the point of the note and is never omitted or softened: it is the
    // question the old wording left open.
    if (spareCount === 1) {
        const subject = totalDays === 1 ? 'This is a Spare day' : '1 of these days is a Spare day';
        return `📋 ${subject} — ${MEANING}. It still uses 1 day of annual leave.`;
    }
    return `📋 ${spareCount} of these days are Spare days — ${MEANING}. Each still uses 1 day of annual leave.`;
}
