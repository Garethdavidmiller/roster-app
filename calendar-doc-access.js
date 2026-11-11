// @ts-check
/**
 * calendar-doc-access.js — MAY THIS CALENDAR READ THE DOCUMENTS? (v23.17, owner decision 7 Sep 2026)
 *
 * The Daily Huddle, the Weekly Retail Circular and the Marylebone Newsletter are not to be visible
 * to anyone without the staff PIN or a password. `firestore.rules` is what enforces that on the
 * server; this module is what makes the CLIENT honour it, and it exists for the same reason
 * `calendar-overrides.js` has a gate of its own: **rules are evaluated on the server, so a read that
 * the local Firestore cache can answer never consults them.** A browser that opened the Huddle
 * yesterday still holds it. `onSnapshot` fires from IndexedDB before the server has said a word.
 * Tightening the rules without this gate would have left every previously-unlocked device able to
 * show yesterday's Huddle to whoever picked it up — the exact lesson `calendar-access-gate.test.mjs`
 * pins for the roster. So the reads are refused AT SOURCE while the gate is shut: no query, cached
 * or otherwise, is issued.
 *
 * ── WHEN IT OPENS, AND WHEN IT DOES NOT ─────────────────────────────────────────────────────────
 *
 *   · It opens on a FULL access grant — `named` or `viewer`. (A third, anonymous `open` grant
 *     existed while the staff PIN could be switched off; that switch was retired v24.34.)
 *   · It closes when access is LOST mid-session (a permission-denied override read, an expired
 *     viewer session). A deliberate "Lock Calendar" reloads the page, so the default applies.
 *
 * Those are the moments the roster reads open and close too, and since v25.74 (Calendar step 2)
 * that is by construction: THIS MODULE KEEPS NO ANSWER OF ITS OWN. `hasDocumentAccess` asks
 * calendar-access-state.js, the one copy, which the roster gate asks as well, so no route that
 * loses access can shut one and leave the other. Until then a flag lived here, and the coordinator
 * set it beside the roster's by hand.
 *
 * ── WHY SUBSCRIBERS, NOT JUST A FLAG ────────────────────────────────────────────────────────────
 *
 * The overrides gate is a boolean the fetch paths consult. This one has to START things: the Huddle
 * viewer's live subscription must attach when access arrives (a notification tap that landed on the
 * PIN card must open the Huddle once the PIN is entered — the deep link has to SURVIVE the unlock,
 * AUTH_PLAN.md §5), and a Circular tap made while locked must complete when the reader signs in.
 * Neither can poll a flag; both are told.
 *
 * One import, of a module that has none: it still loads in Node, and the viewers can be handed a
 * fake of the same shape.
 */

import { hasCalendarAccess, setCalendarAccess, onCalendarAccess } from './calendar-access-state.js';

/** @type {Set<(open: boolean) => void>} */
const _subs = new Set();

/** Is a document read permitted right now? */
export function hasDocumentAccess() { return hasCalendarAccess(); }

// TOLD ONCE PER CHANGE, NEVER ON A NO-OP. A second grant over a Calendar already open is news to the
// roster reads (a fresh start) and is NOT news here: a subscription already listening must not be
// attached again. The state reports every write; this is where the documents' half is picked out.
// A subscriber that throws is logged and the rest still hear it: the viewer behind a broken one
// must still lock.
onCalendarAccess(({ open, changed }) => {
    if (!changed) return;
    for (const fn of [..._subs]) {
        try { fn(open); } catch (e) { console.error('[DocAccess] subscriber failed', e); }
    }
});

/**
 * Open or shut: this module's name for THE ONE WRITE (calendar-access-state.js →
 * `setCalendarAccess`), kept for its tests. The page no longer calls it (v25.74): the access layer
 * writes the state itself. Only a literal `true` opens — a truthy non-boolean (a name, a 1) must
 * never read as access — and that rule has one home, the state's own write.
 * @param {boolean} open
 */
export function setDocumentAccess(open) { setCalendarAccess(open); }

/**
 * Be told when the gate changes. Returns the unsubscribe.
 * @param {(open: boolean) => void} fn
 * @returns {() => void}
 */
export function onDocumentAccess(fn) {
    _subs.add(fn);
    return () => { _subs.delete(fn); };
}

/** The shape the viewers take, built once here so every consumer is handed the same thing. */
export const documentAccess = Object.freeze({ has: hasDocumentAccess, onChange: onDocumentAccess });

/** Test seam: back to a freshly-loaded module. The subscribers go FIRST, so none hears the reset. */
export function _resetDocumentAccessForTests() { _subs.clear(); setCalendarAccess(false); }
