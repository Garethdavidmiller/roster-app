// @ts-check
/**
 * overtime-roster.js — what a member is actually rostered to do on each day of an Overtime week.
 *
 * Owns: one bounded Firestore read for one member over seven dates, and the honest four-state
 * answer about how well that read went. Does NOT own the override→display LADDER — that is
 * `resolveEffectiveShift` in `override-utils.js`, the same resolution the calendar renderer, Team
 * View and the month legend all use, and reimplementing it here is how those three drifted apart
 * before v16.48.
 *
 * ── WHY THIS IS NOT THE CALENDAR'S FETCHER ──────────────────────────────────────────────────────
 *
 * `calendar-overrides.js` already fetches overrides, and reusing it was the obvious move. It is the
 * wrong one twice over. It holds PROCESS-WIDE mutable state — a month cache, a fetched-month claim
 * set, and an access gate that defaults CLOSED — none of which belongs to this page; and its
 * `reconcileRangeIntoCache` is AUTHORITATIVE for its range, evicting in-range keys its snapshot
 * omits. A second authoritative reconciler racing the first is precisely the v18.76 Team View bug,
 * where a later-resolving staler read wiped overrides the calendar had just loaded.
 *
 * So this module reads its own seven dates and keeps its own answer. What it DOES share is the
 * pure decision vocabulary of `calendar-data-state.js` — the four knowledge states — because that
 * argument is general and was won once already.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────────────────────────
 *
 *   An unknown override state must never be presented as a plausible base roster.
 *
 * The base roster is a rotating pattern computed locally, so it can always be drawn instantly — and
 * it is WRONG for anybody with leave, an absence, a changed shift or an RDW. On this page the
 * consequence is sharper than on the calendar: the form OFFERS OPTIONS derived from it ("Available
 * after 15:00"), so a wrong base roster does not merely mislead, it puts a time the member never
 * works into a declaration they then submit.
 */

import { db, COLLECTIONS, collection, query, where, getDocs } from './firebase-client.js';
import { teamMembers, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { resolveEffectiveShift, isRestShift, toOverrideRecord } from './override-utils.js';
import { shiftSpanMinutes, rosterBadge } from './overtime-format.js';

// `rosterBadge` moved to overtime-format.js at v20.87 so the REVIEWER's rows could draw the
// same chip — this module imports the Firebase SDK, so overtime-manager.js cannot import it
// and stay Node-loadable. Re-exported because the form has always reached it through here.
export { rosterBadge };

/** @typedef {'authoritative'|'error'} RosterKnowledge */
/** @typedef {{ shift: string, isRest: boolean, hasTime: boolean, overnight: boolean, start: string, end: string, rosteredMinutes: number|null }} DayContext */

/** A worked shift, as the app stores it. */
const SHIFT_RANGE_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Read one member's effective roster across the seven dates of a window.
 *
 * Returns `knowledge: 'error'` rather than a half-answer on ANY failure — including a partial read.
 * There is no `cached` state here on purpose: unlike the calendar, this page has nothing useful to
 * do with possibly-stale context, because the options it would generate get submitted.
 *
 * @param {string} memberName
 * @param {string[]} dates the window's seven Sunday→Saturday dates
 * @returns {Promise<{ knowledge: RosterKnowledge, byDate: Record<string, DayContext> }>}
 */
export async function loadRosterContext(memberName, dates) {
    const member = teamMembers.find(m => m.name === memberName);
    if (!member || !dates?.length) return { knowledge: 'error', byDate: {} };

    /** @type {Record<string, any>} */
    let overrides = {};
    try {
        // `in` caps at 30 values and a roster week is 7, so one query covers the window. Scoped to
        // this member: the page never needs anybody else's, and a wider query would return
        // colleagues' leave to a client that has no business holding it.
        const snap = await getDocs(query(
            collection(db, COLLECTIONS.overrides),
            where('memberName', '==', memberName),
            where('date', 'in', dates),
        ));
        snap.forEach((/** @type {any} */ d) => {
            const data = d.data();
            // `toOverrideRecord` deliberately does NOT carry the date — it is the record shape the
            // cache stores UNDER a key, so the date comes from the document itself.
            if (data && typeof data.date === 'string') overrides[data.date] = toOverrideRecord(data);
        });
    } catch (_) {
        return { knowledge: 'error', byDate: {} };
    }

    return { knowledge: 'authoritative', byDate: resolveWeek(member, dates, overrides) };
}

/**
 * The whole week for EVERY participant — the reviewer's side of the same question.
 *
 * ── WHY THIS IS NOT A LOOP OVER THE ONE ABOVE ───────────────────────────────────────────────────
 *
 * Per member it would be one Firestore query each: ~50 round trips to paint one week, in series or
 * as a fan-out hammering the same index. `in` caps at 30 values and a week is 7 dates, so ONE query
 * over the dates alone returns every override the workspace needs, and the base roster is computed
 * locally for nothing.
 *
 * Dropping the `memberName` filter is a widening, and it is the right one HERE and nowhere else.
 * The caller is a reviewer, whose rules already grant them the whole overrides collection and whose
 * entire job is to see the team's week. The member's own loader keeps its filter — a member has no
 * business holding colleagues' leave — so this function must never be called from that side.
 *
 * `knowledge: 'error'` on any failure, exactly as above: a half-read roster shown beside
 * availability would let a clerk ring somebody whose shift they cannot actually see.
 *
 * @param {string[]} memberNames
 * @param {string[]} dates the window's seven Sunday→Saturday dates
 * @returns {Promise<{ knowledge: RosterKnowledge, byMember: Record<string, Record<string, DayContext>> }>}
 */
export async function loadRosterForMembers(memberNames, dates) {
    if (!memberNames?.length || !dates?.length) return { knowledge: 'error', byMember: {} };

    /** @type {Record<string, Record<string, any>>} */
    const byName = {};
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTIONS.overrides),
            where('date', 'in', dates),
        ));
        snap.forEach((/** @type {any} */ d) => {
            const data = d.data();
            if (!data || typeof data.date !== 'string' || typeof data.memberName !== 'string') return;
            (byName[data.memberName] ||= {})[data.date] = toOverrideRecord(data);
        });
    } catch (_) {
        return { knowledge: 'error', byMember: {} };
    }

    /** @type {Record<string, Record<string, DayContext>>} */
    const byMember = {};
    for (const name of memberNames) {
        const member = teamMembers.find(m => m.name === name);
        // A participant this client's roster does not know (renamed, or left since the freeze) gets
        // NO entry rather than a fabricated one — `rosterBadge(null)` then says so on the row.
        if (member) byMember[name] = resolveWeek(member, dates, byName[name] || {});
    }
    return { knowledge: 'authoritative', byMember };
}

/**
 * One member's seven days, resolved through the shared override→display ladder.
 *
 * The single place that turns (member, date, override) into a DayContext, so the member's form and
 * the reviewer's workspace cannot disagree about what somebody is rostered to do — which is the
 * whole reason the reviewer's rows were given the roster in the first place.
 * @param {any} member @param {string[]} dates @param {Record<string, any>} overrides
 * @returns {Record<string, DayContext>}
 */
function resolveWeek(member, dates, overrides) {
    /** @type {Record<string, DayContext>} */
    const byDate = {};
    for (const date of dates) {
        // `getBaseShift` takes a DATE, not an ISO string — passing the string would skip the
        // Christmas rule and mis-key the roster lookup, silently, on exactly the weeks that matter
        // most. `parseISODate` is the app's own noon-anchored parse (DST-safe).
        const base = getBaseShift(member, parseISODate(date));
        const eff = resolveEffectiveShift(overrides[date] || null, base, isSunday(date));
        // The hours slot an override may carry (an RDW time, an Other day's actual times) is more
        // specific than the shift value, so it wins when present — the same precedence the calendar
        // renders from.
        const timed = SHIFT_RANGE_RE.test(eff.rdwTime) ? eff.rdwTime
            : (SHIFT_RANGE_RE.test(eff.shift) ? eff.shift : '');
        const [start, end] = timed ? timed.split('-') : ['', ''];
        byDate[date] = {
            shift: eff.shift,
            isRest: isRestShift(eff.shift),
            hasTime: !!timed,
            // A duty that crosses midnight — dispatcher turns (22:00–07:00; the late ones ending
            // past 00:00 too). `end` names the NEXT morning, so anchored offers built from it are
            // wrong on this day; `modesFor` (overtime-format.js) withholds them when this is set.
            overnight: !!timed && end < start,
            start,
            end,
            // How long the day's EFFECTIVE duty runs — including a timed RDW, i.e. extra already
            // agreed. `modesFor` withholds the "Up to 12 hours" offer when this already reaches
            // 720; a day with no times is 0, not null, because "rostered nothing" is a known
            // length, where null is reserved for a day whose roster could not be read at all.
            rosteredMinutes: timed ? shiftSpanMinutes(start, end) : 0,
        };
    }
    return byDate;
}

// `modesFor` — which availability modes a day may offer — moved to overtime-format.js at v20.75:
// this module imports the Firebase SDK, so the rule was unreachable from a Node test, and the
// untested branch was wrong (an overnight dispatcher duty offered anchors the server refuses).
