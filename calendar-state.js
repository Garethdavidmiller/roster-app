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

/** @type {number} */
let _month = new Date().getMonth();
/** @type {number} */
let _year  = new Date().getFullYear();

// Restore last-viewed month from localStorage (if valid, within app bounds,
// and not a future month — staff should open on today's roster, not a month
// they previously browsed ahead to).
(function restoreViewedMonth() {
    const m = parseInt(lsGet('myb_roster_month') ?? '', 10);
    const y = parseInt(lsGet('myb_roster_year')  ?? '', 10);
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
    _month += delta;
    if (_month > 11) { _month = 0; _year++; }
    if (_month < 0)  { _month = 11; _year--; }
    if (_year > CONFIG.MAX_YEAR) { _year = CONFIG.MAX_YEAR; _month = 11; }
    if (_year < CONFIG.MIN_YEAR) { _year = CONFIG.MIN_YEAR; _month = 0;  }
}

/** Persist current display position to localStorage after each navigation. */
export function persistViewedMonth() {
    lsSet('myb_roster_month', _month);
    lsSet('myb_roster_year',  _year);
}
