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

/** Persist current display position to localStorage after each navigation. */
export function persistViewedMonth() {
    lsSet(VIEWED_MONTH, _month);
    lsSet(VIEWED_YEAR,  _year);
}
