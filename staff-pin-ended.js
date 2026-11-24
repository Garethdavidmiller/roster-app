// @ts-check
/**
 * staff-pin-ended.js — whether arriving on THIS page signed out a leftover staff-PIN session, and who
 * is waiting to hear it.
 *
 * ── WHY (v25.78 — owner, 11 Nov 2026; the PIN retired, 23 Nov 2026) ──────────────────────────────
 *
 * The shared staff PIN is retired: only a member's own sign-in opens the app. A browser can still
 * hold a viewer session from before, and every page signs it out on arrival (session.js →
 * `reconcileExpiredIdentity`, which no page asks to keep it any more). The sign-out is the rule; its
 * SILENCE would be the fault — a station computer that opened the Calendar yesterday with the PIN
 * would meet a sign-in card today with nothing to say why the code it used no longer works. So the
 * sign-in card says ONE line (`STAFF_PIN_ENDED_NOTICE`; login-overlay.js → `sayStaffPinEnded`), and
 * this is where it hears it. TRANSITION plumbing: it goes with the rest of the viewer's in the
 * cleanup release, once the `calendar-viewer` account is deleted and no browser can hold one.
 *
 * ── ONE WRITER, AT ONE MOMENT ─────────────────────────────────────────────────────────────────────
 *
 * `noteStaffPinEnded` is called by `reconcileExpiredIdentity` alone, and only once its sign-out of
 * the viewer has LANDED. Never for a member's expired identity (they never had the PIN), and never
 * for a sign-out that failed (the line would then be untrue). Each is pinned by session.test.mjs,
 * through the real teardown rather than by calling this module directly.
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
 * lost their identity — would say again that the PIN had been retired, to somebody it never concerned.
 *
 * There is no way back to a PIN box and no one-tab mark for one (both removed with the PIN): the
 * card's way back is the roster, and the roster's own card is a sign-in.
 *
 * Why a module of its own: session.js was at its size cap (coordinator-ratchet.test.mjs) when this
 * landed, and this is one subject a Node test can hold without a DOM — the ratchet's EXTRACT. (The one
 * function that draws, `sayStaffPinEndedIn`, is handed the element it draws in.)
 */

import { speakAfterMount } from './status-text.js';

// ── WHAT IS SAID — ONE SENTENCE WHEREVER A LEFTOVER PIN SESSION ENDS (audit C1) ─────────────────────
// The sign-in card says it (login-overlay.js → `sayStaffPinEnded`), and a page with no card says it in
// its own body (`sayStaffPinEndedIn`): paused Overtime offers no sign-in. "The admin", because a login
// is an account matter (CLAUDE.md → Staff-facing wording conventions).

/** The line said when arriving signed out a leftover staff-PIN session. */
export const STAFF_PIN_ENDED_NOTICE =
    'The staff PIN has been retired. Sign in with your own name — if you don’t have a login yet, ask the admin.';

let ended = false;
/** @type {Set<() => void>} */
const waiting = new Set();

/**
 * Record that arriving here signed out a leftover staff-PIN session, and tell each listener already
 * waiting, once. Only `reconcileExpiredIdentity` (session.js) calls this — see the header.
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
 * by the sign-in core (`runNamedSignIn`, login-core.js) once a sign-in has succeeded.
 */
export function forgetStaffPinEnded() {
    ended = false;
}

/**
 * Say it on a page with no sign-in card (see the block above). A status region goes into `host` NOW,
 * empty — an empty div takes no room — and the words, with the way back to the roster, go in once the
 * browser has DRAWN it (`speakAfterMount`, status-text.js). Text a live region is created with is read
 * by nobody, and "created" means the same TASK, not the same line: when the session had already
 * ended, the listener below runs on a microtask of the task that put the region here, so writing at
 * once was silent (17 Nov 2026). A teardown that lands later waits the same frame, which costs nothing.
 * @param {Element|null} host
 * @returns {() => void}  stop listening — and stop a line not yet written
 */
export function sayStaffPinEndedIn(host) {
    if (!host) return () => {};
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    host.appendChild(region);
    let listening = true;
    const stop = onStaffPinEnded(() => speakAfterMount(region, () => {
        if (!listening) return;   // stopped; a region the page has redrawn away is skipped by speakAfterMount
        const line = document.createElement('p');
        const back = document.createElement('a');
        back.href = './';
        back.textContent = '← Back to roster';
        line.append(STAFF_PIN_ENDED_NOTICE + ' ', back);
        region.appendChild(line);
    }));
    return () => { listening = false; stop(); };
}

/**
 * Run `fn` once if arriving on THIS page signed out a leftover staff-PIN session: when it happens, or
 * on a microtask if it already has.
 * @param {() => void} fn
 * @returns {() => void}  Unsubscribe — also stops a call already queued.
 */
export function onStaffPinEnded(fn) {
    if (!ended) { waiting.add(fn); return () => { waiting.delete(fn); }; }
    let live = true;
    queueMicrotask(() => { if (live) fn(); });
    return () => { live = false; };
}
