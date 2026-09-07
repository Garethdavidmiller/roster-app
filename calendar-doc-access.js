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
 *   · It opens on a FULL access grant — `named` or `viewer` (the `open` mode too, where the
 *     server will then refuse a claimless anonymous session and the viewers show their failure
 *     state, which is the honest outcome for a mode the PIN flag has retired).
 *   · It does NOT open on a PROVISIONAL grant. A provisional paint is one member's own cached
 *     roster while their stored identity is being revalidated — it is not access (CALENDAR_DATA.md
 *     invariant 13), and a document is not theirs to see on the strength of a localStorage record.
 *     The window is a second or two; the viewers hold the tap and finish it when the grant lands.
 *   · It closes when access is LOST mid-session (a permission-denied override read, an expired
 *     viewer session). A deliberate "Lock Calendar" reloads the page, so the default applies.
 *
 * ── WHY SUBSCRIBERS, NOT JUST A FLAG ────────────────────────────────────────────────────────────
 *
 * The overrides gate is a boolean the fetch paths consult. This one has to START things: the Huddle
 * viewer's live subscription must attach when access arrives (a notification tap that landed on the
 * PIN card must open the Huddle once the PIN is entered — the deep link has to SURVIVE the unlock,
 * AUTH_PLAN.md §5), and a Circular tap made while locked must complete when the reader signs in.
 * Neither can poll a flag; both are told.
 *
 * No imports, so it loads in Node and the viewers can be handed a fake of the same shape.
 */

let _open = false;
/** @type {Set<(open: boolean) => void>} */
const _subs = new Set();

/** Is a document read permitted right now? */
export function hasDocumentAccess() { return _open; }

/**
 * Open or shut the gate. Only a literal `true` opens it — a truthy scope string from a provisional
 * grant must never read as access. Subscribers are told once per CHANGE, never on a no-op, so a
 * repeated grant cannot re-attach a subscription that is already listening.
 * @param {boolean} open
 */
export function setDocumentAccess(open) {
    const next = open === true;
    if (next === _open) return;
    _open = next;
    for (const fn of [..._subs]) {
        try { fn(next); } catch (e) { console.error('[DocAccess] subscriber failed', e); }
    }
}

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

/** Test seam: back to a freshly-loaded module. */
export function _resetDocumentAccessForTests() { _open = false; _subs.clear(); }
