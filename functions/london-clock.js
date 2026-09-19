'use strict';

/**
 * functions/london-clock.js — an ISO calendar date, and the instant it names in London.
 *
 * ── WHY THIS IS ITS OWN MODULE (v24.14) ─────────────────────────────────────────────────────────
 *
 * It was the first 130 lines of `overtime-core.js`, and it is the one thing in that file that is
 * not an Overtime rule. Overtime USES the London clock; it does not own it. A deadline, a frozen
 * population and a purge date are policy this depot chose. "What is the UTC offset in London at
 * this instant" is not — it is the same answer for anybody who asks, and it would be the same
 * answer if the Overtime feature were deleted tomorrow.
 *
 * The move was made when `overtime-core.js` reached its size cap with ZERO lines of headroom, which
 * `coordinator-ratchet.test.mjs`'s own header names as the state in which a guard stops being read
 * and starts being raised. The classification it asks for is SPLIT rather than EXTRACT: no new rule
 * came out, the file was doing two unrelated jobs.
 *
 * ── THE PROPERTY THAT MAKES THIS TESTABLE, AND HOW IT DECAYS ────────────────────────────────────
 *
 * **This module requires nothing.** Not Firebase, not a date library, not a sibling. That is what
 * lets the DST pathologies be tested at the minute either side of a transition with no fixtures and
 * no emulator — and it is why `overtime-core.test.mjs` runs in `test:hygiene` (every branch) rather
 * than `test:functions` (which needs `functions/node_modules`). It is asserted, not hoped for, in
 * `london-clock.test.mjs`, because the first time somebody wants a helper in here the property goes
 * without anything visibly breaking.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────────
 *
 * The HOURS that matter to a feature stay with the feature. `londonNoonTimestamp` (the availability
 * deadline), `londonMidnightTimestamp` (the retention boundary) and `lastSchedulerRun` (which has
 * to agree with a cron expression) all remain in `overtime-core.js`, because each encodes a choice
 * this depot made rather than a fact about the timezone. `isSaturday`, `weekDates` and
 * `weekEndingFor` stay for the same reason: they encode the Sunday→Saturday ROSTER week, which is
 * this railway's shape, not the calendar's.
 *
 * The line to hold: if changing it would change what the app PROMISES somebody, it is not clock
 * code. If it would only change whether the app is telling the truth about the time, it is.
 */


const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC offset Europe/London was on at a given instant, in minutes east of UTC (+0 GMT, +60 BST).
 *
 * Derived from `Intl`, never from month arithmetic: the UK's transition dates are "last Sunday in
 * March/October", which is exactly the kind of rule that gets hand-coded slightly wrong and then
 * fails twice a year. Formatting the instant in London and reading it back as though it were UTC
 * gives the offset directly, and the runtime's own tz database stays the authority.
 * @param {number} utcMs
 * @returns {number} minutes
 */
function londonOffsetMinutes(utcMs) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(utcMs));
    /** @type {Record<string,number>} */
    const f = {};
    for (const p of parts) if (p.type !== 'literal') f[p.type] = Number(p.value);
    // `h23` should never yield 24, but a runtime that does would silently shift the day.
    const hour = f.hour === 24 ? 0 : f.hour;
    const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second);
    return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * The epoch-ms instant of `hour:00:00` Europe/London on an ISO calendar date.
 *
 * ── WHY TWO PASSES, HONESTLY ────────────────────────────────────────────────────────────────────
 * For the only two hours this module actually uses — 00:00 and 12:00 — ONE pass is already correct
 * everywhere, including on both transition days, and mutation-testing confirms it (removing the
 * second pass leaves every noon and midnight assertion green). The reason is arithmetic: the guess
 * is at most |offset| = 1h from the answer, and the UK moves its clocks at 01:00–02:00 local, so
 * neither the guess nor the answer straddles a transition at those hours.
 *
 * The second pass is here for the NEXT hour somebody uses. It diverges only where local time is
 * pathological — 01:00 on spring-forward, which does not exist — and there it resolves forward
 * (01:00 → 02:00 BST) instead of backwards into the previous day. That is the conventional
 * resolution and the one a reader expects. It is one extra `Intl` read, it is pinned by
 * `overtime-core.test.mjs`, and it is what stops a future deadline time from shipping an hour out.
 *
 * ⚠️ 00:00 and 12:00 are both safe from the two pathologies of local-time arithmetic. **If you add
 * a third hour, decide first** what a non-existent time (spring gap) and a doubled time (autumn
 * overlap) should mean for a DEADLINE — "which 01:30 was I supposed to submit by" is not a question
 * to answer at the keyboard.
 * @param {string} isoDate "YYYY-MM-DD"
 * @param {number} hour    0–23; in production only 0 or 12 — see above
 * @returns {number} epoch ms
 */
function londonTimestamp(isoDate, hour) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
    const firstPass = guess - londonOffsetMinutes(guess) * 60000;
    return guess - londonOffsetMinutes(firstPass) * 60000;
}

/** The ISO calendar date in Europe/London at a given instant. */
function londonIsoDate(utcMs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(utcMs));
    return parts;   // en-CA formats as YYYY-MM-DD
}

// ── Calendar helpers (pure date arithmetic, no timezone) ────────────────────────────────────────

/**
 * True for a real "YYYY-MM-DD" that names a date which actually exists.
 * The round-trip is the point: `2026-02-30` parses happily and rolls into March otherwise.
 * @param {any} isoDate
 */
function isValidIsoDate(isoDate) {
    if (typeof isoDate !== 'string' || !ISO_DATE_RE.test(isoDate)) return false;
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Day of week for an ISO date, 0=Sunday…6=Saturday. Timezone-free — it names a calendar date. */
function isoDayOfWeek(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Shift an ISO date by whole days. Pure calendar arithmetic; DST cannot affect a date count. */
function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

module.exports = {
    londonOffsetMinutes,
    londonTimestamp,
    londonIsoDate,
    isValidIsoDate,
    isoDayOfWeek,
    addDays,
};
