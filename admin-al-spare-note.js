// @ts-check
import { costsWithoutSpareCap, spareUnderneath, SPARE_WEEK_MAX_DAYS } from './al-entitlement.js';
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
// out to be — the one exception is the week's cap, below. The text this replaced said a shift over seven
// hours "may use more than 1 AL day", which was wrong three ways: the app's own accounting charges
// whole dates (`countedAlDates` returns a Set of them, `alPosition` subtracts their count), the
// depot's workbook charges one day per Spare day in the register, and the sentence was an inversion
// of an older instruction about a WEEK — "for shifts over 7h, add RD corrections to reduce to 4 AL
// days" — which pointed the other way and did not apply to a single day at all. It then sent the
// reader to their manager to settle a discrepancy the app had invented.
//
// ONE EXCEPTION, BY RULE (owner, 21 Nov 2026): a Spare WEEK never costs more than four days, so a
// booking holding more Spare days than its weeks charge is told the cap and the true figure rather
// than "each still uses 1 day" — `spareShiftNote`'s `charged`, which the preview reads off the
// booking's own projection (admin-al.js). Each day up to the fourth is still exactly one day.
//
// So the note is INFORMATION, not a warning: it names the day type, says what Spare means, and
// closes the entitlement question rather than opening it. It carries 📋 — the Spare badge the app
// already uses — and not ⚠, because there is nothing here to be careful about.
//
// A Spare turn saved on a base REST day costs nothing at all — leave over rest-day working is free,
// like leave over RDW (owner, 10 Nov 2026) — so `countSpareDays` leaves it out, and the note never
// says "still uses 1 day" about it.
//
// ── A SPARE DAY IS ONE THAT IS *STILL* SPARE (v24.44, owner-reported) ─────────────────────────
//
// The count read the BASE roster alone, so a Spare week the weekly roster upload had since turned
// into real shifts went on being called Spare: the owner booked one of those days off and was told
// "This is a Spare day — on standby, with the shift not yet assigned", about a day whose shift had
// been assigned. The day's kind is read from the record first and the base only when the record says
// nothing about the contract — `spareUnderneath` (al-entitlement.js), the same rule the Spare week's
// cap reads, so the note and the count can never call one day two things (21 Nov 2026; it asked
// `resolveEffectiveShift` before, which could not see a Spare day under leave already booked).
//
// It is also written in the THIRD PERSON. A manager books leave on somebody else's behalf from this
// same card, so "you're on standby" would be addressed to the wrong person half the time.

/**
 * The Spare-day line for the AL booking preview, or `''` when there is nothing to say.
 *
 * @param {number} spareCount how many of the booked days are Spare and cost a day (`countSpareDays`)
 * @param {number} totalDays  how many days the booking covers, so a one-day booking can say
 *                            "This is…" rather than "1 of these days is…", which has no "these"
 *                            to be one of
 * @param {number} [charged]  how many of those Spare days the booking actually charges — fewer when
 *                            a Spare week reaches its four (`projectAlBooking`); omitted, all of them
 * @returns {string} plain text, no markup — the caller decides how to wrap it
 */
export function spareShiftNote(spareCount, totalDays, charged = spareCount) {
    if (!Number.isFinite(spareCount) || spareCount < 1) return '';

    const MEANING = 'on standby, with the shift not yet assigned';
    // A SPARE WEEK USES AT MOST FOUR (owner, 21 Nov 2026): when the booking's Spare days are more
    // than its weeks charge, the note says the cap and the true figure — never "each still uses 1".
    if (Number.isFinite(charged) && charged < spareCount) {
        const cap = `A Spare week uses at most ${SPARE_WEEK_MAX_DAYS} days of annual leave`;
        if (spareCount === 1) {
            const subject = totalDays === 1 ? 'This is a Spare day' : '1 of these days is a Spare day';
            return `📋 ${subject} — ${MEANING}. ${cap}, and this week's ${SPARE_WEEK_MAX_DAYS} are already booked, so it uses none.`;
        }
        const uses = charged === 0 ? 'none' : `${charged} day${charged === 1 ? '' : 's'}`;
        // Fewer than four of them and still not all charged: the rest of the week's four were booked
        // earlier, and the note says so — a lower figure with no reason reads like a mistake.
        const why = spareCount <= SPARE_WEEK_MAX_DAYS ? ', counting the days already booked that week' : '';
        return `📋 ${spareCount} of these days are Spare days — ${MEANING}. ${cap}${why}, so they use ${uses}.`;
    }
    // The cost sentence is the point of the note and is never omitted or softened: it is the
    // question the old wording left open.
    if (spareCount === 1) {
        const subject = totalDays === 1 ? 'This is a Spare day' : '1 of these days is a Spare day';
        return `📋 ${subject} — ${MEANING}. It still uses 1 day of annual leave.`;
    }
    return `📋 ${spareCount} of these days are Spare days — ${MEANING}. Each still uses 1 day of annual leave.`;
}

/**
 * How many of `dates` are STILL Spare and COST a day of leave — the base roster says Spare and no
 * override has since replaced it (a roster upload, a Change a Shift), or a Spare turn was saved over
 * a working day. Whether a day costs is `consumesEntitlement`'s answer, the one the booking itself
 * charges by: never a Sunday or 25/26 December, and never a Spare turn saved on a base rest day
 * (owner, 10 Nov 2026), which the note would otherwise say "still uses 1 day" about.
 *
 * @param {any} memberObj
 * @param {string[]} dates ISO `YYYY-MM-DD`
 * @param {Map<string, any>|null} ovByDate the member's overrides keyed by date
 * @returns {number}
 */
export function countSpareDays(memberObj, dates, ovByDate) {
    return spareDaysOf(memberObj, dates, ovByDate).length;
}

/**
 * The days `countSpareDays` counts, so the preview can ask how many of them the booking CHARGES. A
 * day past its week's four is still a Spare day booked, so "would it cost on its own" is the test
 * here (`costsWithoutSpareCap`), and the cap is the projection's to apply (owner, 21 Nov 2026).
 * @param {any} memberObj @param {string[]} dates @param {Map<string, any>|null} ovByDate
 * @returns {string[]}
 */
export function spareDaysOf(memberObj, dates, ovByDate) {
    if (!memberObj) return [];
    // ONE "is this day Spare" (review, 21 Nov 2026): the cap's own `spareUnderneath`, which reads what a
    // record replaced — so a day already on leave over a Spare day is counted here as the cap counts it.
    return dates.filter(d => costsWithoutSpareCap(memberObj, d, ovByDate) && spareUnderneath(memberObj, d, ovByDate));
}
