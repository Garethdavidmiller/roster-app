// @ts-check
/**
 * calendar-access-state.js — DOES THIS BROWSER HOLD THE CALENDAR? Kept ONCE (Calendar step 2, v25.74).
 *
 * Owns: the one answer to "is Calendar access held right now?", the number of the grant it is held
 *   under, and the list of who is told when either moves.
 * Does NOT own: the DECISION (calendar-access.js — sign-in, the staff PIN, re-locking), what a gate
 *   does with the answer (calendar-overrides.js for the roster reads, calendar-doc-access.js for the
 *   three documents), or anything on screen.
 * Edit here for: nothing, ordinarily. A new thing that must follow access READS (`hasCalendarAccess`)
 *   or LISTENS (`onCalendarAccess`). It does not get a copy of its own.
 *
 * ── WHY ONE COPY ────────────────────────────────────────────────────────────────────────────────
 *
 * Until v25.74 three modules each kept their own: `calendar-access.js` the decision, and the two
 * gates a flag apiece, which the page's coordinator set by hand — once on a grant, and again on
 * each of the two ways access is lost mid-session. Every copy was right. What was fragile was the
 * COPYING: a third way of losing access that shut one gate and not the other would leave this
 * device's saved copy of fifty colleagues' leave and absence readable behind the lock card, with no
 * server rule to notice — a cache read never consults one (calendar-overrides.js → THE ACCESS GATE).
 * Now neither gate holds the answer; each asks for it here. There is nothing left to keep in step.
 *
 * ── THREE PROPERTIES, EACH ONE A LINE BELOW ─────────────────────────────────────────────────────
 *
 *   1. SHUT AS LOADED. The default is the security property: a page that never grants reads nothing.
 *      Nothing here restores an earlier answer. There is no stored "unlocked" flag and there must
 *      not be (calendar-access.js → PERSISTENCE IS THE SECURITY BOUNDARY).
 *   2. ONLY A LITERAL `true` OPENS. A name, a 1 and an object are all truthy, and none is access.
 *   3. WRITTEN BEFORE ANYONE IS TOLD. A listener that repaints, or reads through a gate, finds the
 *      new answer already in force: on a loss no gate is still open while the news goes round, and
 *      on a grant none is still shut. So listeners need no order among themselves, and must not
 *      assume one.
 *
 * ── EVERY `true` IS A GRANT, EVEN OVER A CALENDAR ALREADY OPEN ──────────────────────────────────
 *
 * The grant number moves on every grant, and listeners hear EVERY write, with `changed` saying
 * whether the answer itself moved. The two gates want different halves of that, which is why one
 * flag could not serve both:
 *   · the roster reads start afresh on EVERY grant — a month claimed under one grant is not read
 *     under the next (v20.41), and a read's ticket is the number of the grant it was issued under
 *     (calendar-overrides.js → THE READ TICKET);
 *   · the documents are told only when the answer CHANGES, or a Huddle subscription already
 *     listening would be attached a second time (v23.17).
 *
 * No imports. Both gates load in Node for their tests, and neither they nor this module may come to
 * depend on the sign-in code they exist to back up.
 */

/** THE one copy. Shut as loaded (property 1). */
let _open = false;

/** Which grant access is held under: advanced on every grant, never reset. A read issued under an
 *  earlier number has outlived its grant, whatever the answer is now. */
let _grant = 0;

/** @typedef {{ open: boolean, changed: boolean }} AccessWrite
 *    open — the answer now in force; changed — whether this write moved it. */

/** @type {Set<(write: AccessWrite) => void>} */
const _listeners = new Set();

/** @returns {boolean} whether Calendar access is held right now. */
export function hasCalendarAccess() { return _open; }

/** @returns {number} the number of the grant access is, or was last, held under. */
export function grantNumber() { return _grant; }

/**
 * THE ONE WRITE. `true` is a grant; anything else shuts (property 2).
 *
 * The answer is written FIRST and listeners told after (property 3). One that throws is logged and
 * the rest are still told: a broken listener must not leave another believing access is still held.
 * @param {boolean} open
 */
export function setCalendarAccess(open) {
    const next = open === true;
    const changed = next !== _open;
    _open = next;
    if (next) _grant++;
    for (const fn of [..._listeners]) {
        try { fn({ open: next, changed }); } catch (e) { console.error('[CalendarAccess] an access listener failed', e); }
    }
}

/**
 * Be told of every write. Returns the unsubscribe.
 * @param {(write: AccessWrite) => void} fn
 * @returns {() => void}
 */
export function onCalendarAccess(fn) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
}
