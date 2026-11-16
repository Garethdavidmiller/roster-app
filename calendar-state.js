// @ts-check
/**
 * calendar-state.js — which month the Calendar (index.html) is showing, and when that moves by itself.
 *
 * Owns: the month on screen (`_month`, 0-indexed, and `_year`, read and written only through
 *   `getDisplayMonth`/`getDisplayYear`/`setDisplayMonth`/`setDisplayYear`, so calendar-swipe.js and
 *   the rest read the position without being handed it); the month arithmetic (`addMonths`,
 *   `changeDisplay`); the month a load opens on — a `?date=` link first, else a month stored by
 *   `persistViewedMonth` under VIEWED_MONTH / VIEWED_YEAR / VIEWED_AT and still inside
 *   BROWSED_MONTH_KEPT_MS (half an hour), else today's; and `watchLocalDate`, which moves the month
 *   when the date turns or the page is back after more than that half hour, then asks for a repaint.
 * Does NOT own: drawing anything (calendar-app.js through calendar-redraw.js), Team View's week
 *   (calendar-team-view.js, which follows the same rule from what `watchLocalDate` hands it), or the
 *   page's other stored state (storage-keys.js).
 */

import { CONFIG } from './roster-data.js';
import { lsGet, lsSet, lsDel } from './ls.js';

// The month on screen, kept for a moment (below). Only this module reads or writes them, so they are
// not in storage-keys.js: Admin's Calendar pill used to write the first two as well, and now names
// its date in the link instead (v26.19). 0-indexed month, full year, and when they were stored (ms).
const VIEWED_MONTH = 'myb_roster_month';
const VIEWED_YEAR  = 'myb_roster_year';
const VIEWED_AT    = 'myb_roster_month_at';

/**
 * How long a stored month is kept once the member stops looking at it (owner, 15 Nov 2026).
 *
 * It used to be kept until they came back to today's month, however long that took, and every draw
 * of it stored it again, so it never ran out. "It always reopens on June 2026" was the month the owner
 * installed the app: until 10 Nov 2026 every render stored the month on screen, today's included, so
 * June was stored in June and every launch after it opened there. Today's month is what opening the
 * roster is for; a kept month is only for coming straight back: Android or iOS reloading the app
 * behind another one, or a quick trip to another page and back through the drawer. Half an hour covers
 * those, and anything longer opens on today. A link that names a date (`?date=`) still opens that
 * month whenever it is followed.
 */
export const BROWSED_MONTH_KEPT_MS = 30 * 60 * 1000;

/** What `watchLocalDate` hands its listener: the date it last saw, the date now, and whether the page
 *  is back after longer than BROWSED_MONTH_KEPT_MS out of sight.
 *  @typedef {{ was: Date, now: Date, away: boolean }} DateChange */

/** @type {number} */
let _month = new Date().getMonth();
/** @type {number} */
let _year  = new Date().getFullYear();

// Restore last-viewed month: a `?date=` the link named first, else localStorage (if valid, within app
// bounds, stored in the last BROWSED_MONTH_KEPT_MS, and not a future month — staff should open on
// today's roster, not a month they previously browsed ahead to). Only a month the member moved AWAY
// from today to is ever stored — see `persistViewedMonth` — so nothing stored means today.
(function restoreViewedMonth() {
    // A LINK THAT NAMES A DATE WINS, a future month included (whole-app review, Oct 2026): the Pay
    // Calculator's "View these dates in your roster calendar" and Admin's Calendar pill both say which
    // month they mean, and nothing read it — Admin's hand-off went through the stored month, which the
    // future-month rule below then dropped. Honoured ONCE: the parameter is taken off the address, so a
    // reload opens where the member has navigated since.
    const loc = /** @type {any} */ (globalThis).location;
    const asked = /^(\d{4})-(\d{2})-\d{2}$/.exec(loc ? new URLSearchParams(loc.search).get('date') ?? '' : '');
    if (asked) {
        const y = Number(asked[1]), m = Number(asked[2]) - 1;
        try { const u = new URL(loc.href); u.searchParams.delete('date'); history.replaceState(history.state, '', u); } catch { /* address left as it is */ }
        if (y >= CONFIG.MIN_YEAR && y <= CONFIG.MAX_YEAR && m >= 0 && m <= 11) { _month = m; _year = y; return; }
    }
    // A month stored more than BROWSED_MONTH_KEPT_MS ago opens on today, and so does one stored with
    // no time at all — every month stored before v26.19, which is how an install month stayed. A
    // time AHEAD of the clock (the clock put back since) is not trusted either: today is the safe answer.
    const age = Date.now() - parseInt(lsGet(VIEWED_AT) ?? '', 10);
    if (!(age >= 0 && age <= BROWSED_MONTH_KEPT_MS)) return;
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
 * Every "Today" the Calendar draws (the grid's highlight, Team View's column)
 * is read from `new Date()` at render time, and nothing re-renders on its own: an installed PWA
 * resumed the next morning highlighted yesterday until the member navigated. It fires only when the
 * DATE changed, so an ordinary resume costs a string comparison, not a render.
 *
 * A display on the month the old date fell in is moved to the new date's month FIRST, so the repaint
 * draws today (cal-data-1, 10 Nov 2026). Across a month end that display was "now", and keeping it
 * left a phone resumed on 1 December showing November with no today in it. A month the member had
 * browsed to stays where it is — unless they were AWAY for longer than BROWSED_MONTH_KEPT_MS (owner,
 * 15 Nov 2026): an app left in memory on June is not reloaded when it is opened again, it is just
 * shown, so without this the restore's half-hour rule would hold only when the phone had happened to
 * close it. Back after longer than that, the display returns to today's month and repaints, whether
 * or not the date has turned.
 *
 * The same rule holds for TEAM VIEW's week, which this module does not own (16 Nov 2026): Team View
 * answers it itself from what `onChange` is handed (`weekAfterDateChange`, calendar-team-view.js),
 * and `offToday` tells this watcher when that week is not this week, so a long absence repaints a
 * Team View on a browsed week although the month behind it is today's.
 *
 * @param {(change: DateChange) => void} onChange
 * @param {{ doc?: Document, now?: () => Date, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, offToday?: () => boolean }} [env]
 *   test seams, and `offToday`: another surface on screen shows a period that is not today's
 * @returns {() => void} stop watching
 */
export function watchLocalDate(onChange, env = {}) {
    const doc = env.doc ?? document;
    const now = env.now ?? (() => new Date());
    const offToday = env.offToday ?? (() => false);
    const setTimer = env.setTimer ?? setTimeout;
    const clearTimer = env.clearTimer ?? clearTimeout;
    const dayOf = (/** @type {Date} */ d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let lastDate = now();
    let last = dayOf(lastDate);
    /** When the page went out of sight; null while it is on screen. @type {number|null} */
    let hiddenAt = null;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    /** @param {boolean} [away] back after longer than BROWSED_MONTH_KEPT_MS out of sight */
    const check = (away = false) => {
        const date = now();
        const today = dayOf(date);
        const onToday = _month === date.getMonth() && _year === date.getFullYear() && !offToday();
        if (today === last && (onToday || !away)) return;
        const was = lastDate;
        if (away || (_month === was.getMonth() && _year === was.getFullYear())) { _month = date.getMonth(); _year = date.getFullYear(); }
        last = today;
        lastDate = date;
        try { onChange({ was, now: date, away }); } catch (e) { console.error('[Calendar] date-change repaint failed', e); }
    };
    // Re-armed from every check: a timer in a backgrounded tab is throttled or frozen, so the resume
    // path re-aims it at the real coming midnight. One second past it, so the date has turned.
    const arm = () => {
        clearTimer(timer);
        const n = now();
        const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
        timer = setTimer(() => { check(); arm(); }, Math.max(1000, next.getTime() - n.getTime()));
    };
    const onVisibility = () => {
        if (doc.visibilityState === 'hidden') { hiddenAt ??= now().getTime(); return; }
        if (doc.visibilityState !== 'visible') return;
        const away = hiddenAt !== null && now().getTime() - hiddenAt > BROWSED_MONTH_KEPT_MS;
        hiddenAt = null;
        check(away); arm();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    arm();
    return () => { clearTimer(timer); doc.removeEventListener('visibilitychange', onVisibility); };
}

/**
 * Persist the display position after each render, so the member returns to a month they moved to.
 *
 * The CURRENT month is not stored — it is cleared (cal-data-1, 10 Nov 2026). Every render saves, so a
 * member who simply had today's month open saved it, and once that month ended the restore could not
 * tell it from a month browsed back to: the Calendar opened on November on every launch in December
 * until somebody navigated. With nothing stored the restore falls back to today, which is what a
 * member reading "this month" meant.
 *
 * A browsed month is stored WITH THE TIME, which the restore holds to BROWSED_MONTH_KEPT_MS. And only
 * a page somebody can see stores anything (v26.19): a copy in the background — a second tab, or the
 * app behind another one — still redraws when the date turns or a read lands, and would otherwise
 * keep its month, and its time, fresh for the next launch to open on.
 */
export function persistViewedMonth() {
    if (/** @type {any} */ (globalThis).document?.visibilityState === 'hidden') return;
    const today = new Date();
    if (_month === today.getMonth() && _year === today.getFullYear()) {
        lsDel(VIEWED_MONTH);
        lsDel(VIEWED_YEAR);
        lsDel(VIEWED_AT);
        return;
    }
    lsSet(VIEWED_MONTH, _month);
    lsSet(VIEWED_YEAR,  _year);
    lsSet(VIEWED_AT,    today.getTime());
}
