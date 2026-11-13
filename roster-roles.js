// @ts-check
// ============================================
// A MEMBER'S GRADE ON A DATE
// ============================================
//
// `role` on a `teamMembers` entry is the grade NOW. Every list reads it as that — the pickers, Team
// Week, the roster import's name lists, the leave allowance — so a change of grade reaches them with
// the release that makes it. `roleHistory` records the grades held BEFORE it, each with the LAST day
// it applied (`until`, midnight local, inclusive), oldest first:
//
//     role: 'CES', roleHistory: [{ role: 'CEA', until: new Date(2026, 10, 21) }]
//
// is a CEA up to and including Saturday 21 November 2026 and a CES from the Sunday. This module is
// the one reader of the pair. Its caller is the Pay Calculator, the one surface that must know the
// grade on a DAY rather than now: a promotion is released days before it starts, so pricing by `role`
// alone would reprice the periods worked before it at the new grade's rates.
//
// A grade is not carried on `rosterChanges`, because a change of grade and a change of line are
// different facts: most line moves change no grade, and a CEA promoted on a fixed pattern changes
// grade without moving line.
//
// It lives in a module of its own, rather than in roster-data.js beside `resolveMemberRoster`, because
// roster-data.js is held at its size cap (coordinator-ratchet.test.mjs) and this is a rule that can be
// tested on its own. Pure: no imports, no DOM, nothing stored. OPERATIONS_REFERENCE.md → "A member
// changes grade" is the procedure; never delete a `roleHistory` entry, for the reason a `rosterChanges`
// entry is never deleted — without it the member reads as the new grade on every day they have worked.

/** A calendar day as one comparable number (yyyymmdd), read from the Date's LOCAL fields. @param {Date} d */
function dayNumber(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

/**
 * The member's grade (`role`) on a date: the `roleHistory` entry with the earliest `until` on or after
 * the date, else the current `role`. Order-independent, like `resolveMemberRoster`, so an entry
 * authored out of order cannot answer for the wrong days (the data test still requires oldest first).
 * @param {any} member  teamMembers entry
 * @param {Date} date
 * @returns {string|undefined}  'CEA' | 'CES' | 'Dispatcher' | 'Management' (undefined without a member)
 */
export function roleOn(member, date) {
    if (!member) return undefined;
    const day = dayNumber(date);
    /** @type {{ until: number, role: string }|null} */
    let best = null;
    for (const held of member.roleHistory || []) {
        const until = dayNumber(held.until);
        if (day <= until && (best === null || until < best.until)) best = { until, role: held.role };
    }
    return best ? best.role : member.role;
}

/**
 * The member's grades over an INCLUSIVE span of days, in order, each with how many days it covers.
 * A 28-day pay period that starts a week before a promotion is `[{ role: 'CEA', days: 7 },
 * { role: 'CES', days: 21 }]`. Consecutive days on one grade are one entry, so a span with no change
 * of grade is a single entry whatever its length. An end before the start is `[]`.
 * @param {any} member  teamMembers entry
 * @param {Date} start  first day (inclusive)
 * @param {Date} end    last day (inclusive)
 * @returns {{ role: string|undefined, days: number }[]}
 */
export function rolesInRange(member, start, end) {
    /** @type {{ role: string|undefined, days: number }[]} */
    const out = [];
    const last = dayNumber(end);
    for (const d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); dayNumber(d) <= last; d.setDate(d.getDate() + 1)) {
        const role = roleOn(member, d);
        const tail = out[out.length - 1];
        if (tail && tail.role === role) tail.days++;
        else out.push({ role, days: 1 });
    }
    return out;
}
