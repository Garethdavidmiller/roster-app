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
 * Why a module of its own: session.js was at its size cap (coordinator-ratchet.test.mjs) when this
 * landed, and this is one subject a Node test can hold without a DOM — the ratchet's EXTRACT.
 */

let ended = false;
/** @type {Set<() => void>} */
const waiting = new Set();

/**
 * Record that arriving here ended the staff PIN, and tell each listener already waiting, once.
 * Only `reconcileExpiredIdentity` (session.js) calls this — see the header.
 */
export function noteStaffPinEnded() {
    ended = true;
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
