// @ts-check
// overtime-sunday-release.js — asking to be taken off a Sunday you are ROSTERED to work.
//
// ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
//
// Every other rule on the Overtime page is about OVERTIME: extra work a member is offering, when
// they can do it, how long they would go. This one is about their CONTRACTED work — a Sunday they
// are rostered to and would like to be released from — and it is a REQUEST, which nothing else here
// is. Two different subjects in one file is how `overtime-format.js` got to a thousand lines; this
// is small enough to name properly and keep separate.
//
// ── THE GAP IT CLOSES ──────────────────────────────────────────────────────────────────────────
//
// Sundays are uncontracted for every grade, so annual leave and absence cannot be written on one
// (`SUNDAY_FORBIDDEN_TYPES`, override-utils.js). That is right, and it is what stops a Sunday
// costing somebody a day they do not owe. The consequence was that a fact the depot's leave workbook
// has always been able to state — "this person was away for their Sunday duty", a free-text tag in
// the Sunday row, on 52 of its 75 tagged Sundays — had no representation in the app at all.
//
// An external review of v23.78 proposed a new non-entitlement absence type. The owner's answer was
// better: the member ASKS, through the form they already fill in for that week, and the roster team
// decides. No new kind of absence, and the fact lands where it is actually acted on.
//
// ── WHAT IT MUST NEVER DO ──────────────────────────────────────────────────────────────────────
//
// Grant anything. It writes no override, changes no roster and consumes no annual leave, and no
// surface may word it as agreed. That is invariant 14 in `docs/OVERTIME_AVAILABILITY.md`, and the
// wording below is the whole of the app's promise about it.

import { isSunday } from './roster-data.js';

/**
 * Whether this day may ask to be taken off a ROSTERED SUNDAY (v23.81, owner).
 *
 * ── A DIFFERENT QUESTION FROM EVERYTHING ELSE ON THE FORM ───────────────────────────────────────
 *
 * Every other control here is about OVERTIME — extra work the member is offering. This one is about
 * CONTRACTED work: a Sunday they are rostered to and would like to be released from. So it is not a
 * mode competing with the others; it rides beside them, and a member can be unavailable for overtime
 * all week AND ask to come off their Sunday without the two answers fighting.
 *
 * ── THREE CONDITIONS, AND THE THIRD IS THE ONE THAT MATTERS ─────────────────────────────────────
 *
 *   1. It is a SUNDAY. Sundays are uncontracted for every grade, which is exactly why leave cannot
 *      be recorded on one, and why this was the fact the app could not state until now.
 *   2. The member is ROSTERED TO WORK it — there is nothing to be taken off a rest day.
 *   3. **The roster for that day is KNOWN.** A null context is the state where the read failed, and
 *      this module's standing invariant is that an unknown override state is never presented as a
 *      plausible base roster. Offering here would invite a member to ask to be released from a duty
 *      that may not exist — the same class of error as offering "Available after 15:00" anchored to
 *      a shift nobody could read.
 *
 * Withholding on unknown is the same direction every other unknown resolves on this page.
 *
 * @param {string} date ISO `YYYY-MM-DD`
 * @param {{isRest?: boolean}|null} ctx the day's roster context, or null when it could not be read
 * @returns {boolean}
 */
export function offersSundayRelease(date, ctx) {
    if (!isSunday(date)) return false;
    if (!ctx) return false;
    return ctx.isRest !== true;
}

/**
 * What a member is told once they have asked. Pure, so the wording is pinned.
 *
 * **It must never read as granted** (OVERTIME_AVAILABILITY.md invariant 14). The request changes no
 * roster; the answer reaches the member the way every roster answer does, on the roster itself. So
 * the copy states what was asked and who decides, and promises no status to come back and check —
 * there is none, by decision (owner, 14 Sep 2026).
 */
export const SUNDAY_RELEASE_ASKED = 'Asked to come off this Sunday — the roster team will decide.';

/** The control's own label, in the same voice. */
export const SUNDAY_RELEASE_LABEL = 'Ask to be taken off this Sunday';

/**
 * How the REVIEWER sees it, beside that member's answer for the day.
 *
 * Deliberately not merged into `answerCopy`: invariant 1 of this feature is that two different
 * answers may never be collapsed into one, and this is a second, independent thing the member said
 * about a day whose overtime answer stands on its own.
 * @param {any} day one normalised day answer
 */
export function releaseRequestLine(day) {
    return day?.releaseRequested === true ? 'Asked to come off this Sunday' : '';
}
