// @ts-check
/**
 * calendar-state.js — Display month/year state for index.html.
 *
 * Owns the two variables (currentDisplayMonth, currentDisplayYear) that every
 * calendar section reads, plus the localStorage-restore logic and the pure
 * state-change function. Centralising here lets calendar-swipe.js and any
 * future module read current position without receiving them as parameters.
 */

import { CONFIG } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { VIEWED_MONTH, VIEWED_YEAR } from './storage-keys.js';

/** @type {number} */
let _month = new Date().getMonth();
/** @type {number} */
let _year  = new Date().getFullYear();

// Restore last-viewed month from localStorage (if valid, within app bounds,
// and not a future month — staff should open on today's roster, not a month
// they previously browsed ahead to).
(function restoreViewedMonth() {
    const m = parseInt(lsGet(VIEWED_MONTH) ?? '', 10);
    const y = parseInt(lsGet(VIEWED_YEAR)  ?? '', 10);
    if (!isNaN(m) && !isNaN(y) && y >= CONFIG.MIN_YEAR && y <= CONFIG.MAX_YEAR && m >= 0 && m <= 11) {
        const today = new Date();
        const isFuture = y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth());
        if (!isFuture) { _month = m; _year = y; }
    }
})();

export function getDisplayMonth() { return _month; }
export function getDisplayYear()  { return _year;  }
/** @param {number} m */
export function setDisplayMonth(m) { _month = m; }
/** @param {number} y */
export function setDisplayYear(y)  { _year  = y; }

/**
 * Pure display state change — advances by `delta` months with boundary clamping.
 * Does NOT call dismissSwipeHint or trigger any DOM side-effect.
 * The coordinator's changeMonth() calls this then handles side-effects.
 * @param {number} delta
 */
export function changeDisplay(delta) {
    ({ month: _month, year: _year } = addMonths(_month, _year, delta));
}

/**
 * Add `delta` months to a (month, year) position, rolling the year over and clamping to
 * CONFIG.MIN_YEAR..MAX_YEAR. Pure — the single source for the month-rollover + boundary-clamp
 * arithmetic shared by changeDisplay (state mutation) and calendar-swipe's buildAdjacentPanel
 * (local vars); keeping one copy stops the clamp rules diverging on a future MIN/MAX_YEAR change.
 * @param {number} month 0-indexed
 * @param {number} year
 * @param {number} delta months to add (callers use ±1; larger deltas roll correctly too)
 * @returns {{ month: number, year: number }}
 */
export function addMonths(month, year, delta) {
    let m = month + delta;
    let y = year;
    while (m > 11) { m -= 12; y++; }
    while (m < 0)  { m += 12; y--; }
    if (y > CONFIG.MAX_YEAR) { y = CONFIG.MAX_YEAR; m = 11; }
    if (y < CONFIG.MIN_YEAR) { y = CONFIG.MIN_YEAR; m = 0;  }
    return { month: m, year: y };
}

/**
 * Call `onChange` when the device's LOCAL date has moved on since the last check — on a resume
 * (`visibilitychange` → visible) and at each local midnight while the page stays open.
 *
 * Every "Today" the Calendar draws (the grid's highlight, Team View's column, the pay-period strip)
 * is read from `new Date()` at render time, and nothing re-renders on its own: an installed PWA
 * resumed the next morning highlighted yesterday until the member navigated. It fires only when the
 * DATE changed, so an ordinary resume costs a string comparison, not a render.
 *
 * @param {() => void} onChange
 * @param {{ doc?: Document, now?: () => Date, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} [env] test seams
 * @returns {() => void} stop watching
 */
export function watchLocalDate(onChange, env = {}) {
    const doc = env.doc ?? document;
    const now = env.now ?? (() => new Date());
    const setTimer = env.setTimer ?? setTimeout;
    const clearTimer = env.clearTimer ?? clearTimeout;
    const dayOf = (/** @type {Date} */ d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let last = dayOf(now());
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    const check = () => {
        const today = dayOf(now());
        if (today === last) return;
        last = today;
        try { onChange(); } catch (e) { console.error('[Calendar] date-change repaint failed', e); }
    };
    // Re-armed from every check: a timer in a backgrounded tab is throttled or frozen, so the resume
    // path re-aims it at the real coming midnight. One second past it, so the date has turned.
    const arm = () => {
        clearTimer(timer);
        const n = now();
        const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
        timer = setTimer(() => { check(); arm(); }, Math.max(1000, next.getTime() - n.getTime()));
    };
    const onVisibility = () => { if (doc.visibilityState === 'visible') { check(); arm(); } };
    doc.addEventListener('visibilitychange', onVisibility);
    arm();
    return () => { clearTimer(timer); doc.removeEventListener('visibilitychange', onVisibility); };
}

/** Persist current display position to localStorage after each navigation. */
export function persistViewedMonth() {
    lsSet(VIEWED_MONTH, _month);
    lsSet(VIEWED_YEAR,  _year);
}
