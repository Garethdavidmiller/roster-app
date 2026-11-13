// @ts-check
/**
 * staff-pin-ended.js — whether arriving on THIS page ended the shared staff PIN, and who is waiting
 * to hear it.
 *
 * ── WHY (v25.78 — owner, 11 Nov 2026) ─────────────────────────────────────────────────────────────
 *
 * A page that does not admit the staff PIN signs it out on arrival (session.js →
 * `reconcileExpiredIdentity`; AUTH_AND_SESSIONS 24). The sign-out is the rule and stays: its SILENCE
 * was the fault. Somebody who opened Admin or Pay with the PIN met a sign-in card, went back, and
 * found the Calendar asking for the PIN again with nothing to say why. The page's sign-in card now
 * says so (login-overlay.js → `sayStaffPinEnded`), and this is where it hears it.
 *
 * ── ONE WRITER, AT ONE MOMENT ─────────────────────────────────────────────────────────────────────
 *
 * `noteStaffPinEnded` is called by `reconcileExpiredIdentity` alone, and only once its sign-out of
 * the viewer has LANDED. Never for a Lock (the visitor's own act, on a page that admits the PIN),
 * never for a member's expired identity (they never had the PIN), and never for a sign-out that
 * failed (the roster is still open behind them, so "locked again" would be untrue). Each is pinned
 * by session.test.mjs, through the real teardown rather than by calling this module directly.
 *
 * ── STICKY FOR THE PAGE'S LIFE — UNTIL A MEMBER SIGNS IN THERE ───────────────────────────────────
 *
 * The card can be up before the teardown lands (the usual order) or be mounted after it. So the
 * fact is kept, and a late listener is told on a microtask — never inside the call that subscribed,
 * so the caller finishes wiring first. Unsubscribing cancels a call already queued: a card rebuilt or
 * signed in before then is not told. One listener throwing does not stop the others being told.
 *
 * A member signing in on the page makes it old news (`forgetStaffPinEnded`, from the sign-in core,
 * audit B2/C2). Kept for good, a LATER card on the same page — the member signed in in place, then
 * lost their identity — said again that the PIN had ended, and pointed a member at the shared code.
 *
 * ── AND THE CALENDAR IN THIS TAB HEARS IT TOO (audit B3) ─────────────────────────────────────────
 *
 * The card's way back is a link to the PIN box (`#staff-pin`); the phone's Back is not. It returns to
 * the Calendar, which reloads a restored viewer page — with no hash — and a fresh load has none either,
 * so both landed on the member sign-in card, one tap short of the box the card had just sent them to.
 * So noting it also leaves a ONE-TAB mark in sessionStorage, which the Calendar's boot reads exactly as
 * it reads `#staff-pin`: once, removed whatever the decision (`takeStaffPinEndedMark`, through
 * calendar-lock-cards.js's `takePinFirst`). A tab's storage, so it reaches no other tab and no later
 * browser session; forgotten with the fact. Every access is in a try — iOS private mode can throw.
 *
 * Why a module of its own: session.js was at its size cap (coordinator-ratchet.test.mjs) when this
 * landed, and this is one subject a Node test can hold without a DOM — the ratchet's EXTRACT. (The one
 * function that draws, `sayStaffPinEndedIn`, is handed the element it draws in.)
 */

import { PIN_FIRST_HASH } from './calendar-access-core.js';

/** sessionStorage: a page in THIS tab ended the PIN. One writer and one reader, both here. */
const PIN_ENDED_MARK = 'myb_staff_pin_ended';

// ── WHAT IS SAID, AND WHERE ITS WAY BACK GOES — ONE SENTENCE WHEREVER THE PIN ENDS (audit C1) ──────
// The sign-in card says it (login-overlay.js → `sayStaffPinEnded`), and a page with no card says it in
// its own body (`sayStaffPinEndedIn`): paused Overtime offers no sign-in, and until then signed the PIN
// out in silence, against AUTH_AND_SESSIONS 24. Worded as what the PIN OPENS, never as a sign-in (18).

/** The line said when arriving on a page ended the staff PIN. */
export const STAFF_PIN_ENDED_NOTICE =
    'The staff PIN only opens the Calendar and Trains, so the roster is locked again. Sign in as yourself, or go back and enter the PIN.';
/** Where the way back goes once the PIN has ended: the Calendar, PIN box first. */
export const BACK_TO_PIN = './' + PIN_FIRST_HASH;

let ended = false;
/** @type {Set<() => void>} */
const waiting = new Set();

/**
 * Record that arriving here ended the staff PIN, and tell each listener already waiting, once.
 * Only `reconcileExpiredIdentity` (session.js) calls this — see the header.
 */
export function noteStaffPinEnded() {
    ended = true;
    try { sessionStorage.setItem(PIN_ENDED_MARK, '1'); } catch { /* no mark: Back is one tap longer, as before */ }
    const now = [...waiting];
    waiting.clear();
    for (const fn of now) {
        try { fn(); } catch (err) { console.warn('[Auth] a staff-PIN listener failed:', /** @type {any} */ (err)?.message); }
    }
}

/**
 * A member has signed in on this page: the PIN's end is no longer its news (see the header). Called
 * by the sign-in core (`runNamedSignIn`, login-overlay.js) once a sign-in has succeeded.
 */
export function forgetStaffPinEnded() {
    ended = false;
    try { sessionStorage.removeItem(PIN_ENDED_MARK); } catch { /* nothing to forget */ }
}

/**
 * Did a page in this tab end the PIN? The Calendar's boot asks ONCE, beside `#staff-pin`, and the mark
 * is removed whatever the answer (see the header).
 * @returns {boolean}
 */
export function takeStaffPinEndedMark() {
    try {
        const marked = sessionStorage.getItem(PIN_ENDED_MARK) === '1';
        sessionStorage.removeItem(PIN_ENDED_MARK);
        return marked;
    } catch { return false; }
}

/**
 * Say it on a page with no sign-in card (see the block above). A status region goes into `host` NOW,
 * empty — an empty div takes no room — so the words written when the teardown lands are a change a
 * screen reader announces (text a live region is created with is read by nobody), with the way back.
 * @param {Element|null} host
 * @returns {() => void}  stop listening
 */
export function sayStaffPinEndedIn(host) {
    if (!host) return () => {};
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    host.appendChild(region);
    return onStaffPinEnded(() => {
        if (!region.isConnected) return;   // the page has moved on, or redrawn this part
        const line = document.createElement('p');
        const back = document.createElement('a');
        back.href = BACK_TO_PIN;
        back.textContent = '← Back to roster';
        line.append(STAFF_PIN_ENDED_NOTICE + ' ', back);
        region.appendChild(line);
    });
}

/**
 * Run `fn` once if arriving on THIS page ended the shared staff PIN: when it happens, or on a
 * microtask if it already has.
 * @param {() => void} fn
 * @returns {() => void}  Unsubscribe — also stops a call already queued.
 */
export function onStaffPinEnded(fn) {
    if (!ended) { waiting.add(fn); return () => { waiting.delete(fn); }; }
    let live = true;
    queueMicrotask(() => { if (live) fn(); });
    return () => { live = false; };
}
