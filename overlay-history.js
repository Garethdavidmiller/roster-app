// @ts-check
/**
 * overlay-history.js — The overlay layer's Android Back history: the LIFO stack of close handlers, the
 * popstate listener that drives it, the external pop owners (the nav drawer), `whenHistorySettled`, and
 * `followLinkOutOf` for a link that leaves the page from inside a lightbox.
 *
 * Moved out of overlay.js (25 Nov 2026), which RE-EXPORTS every name here: pages and modules import them
 * from overlay.js as they always have, and `createLightbox` — this stack's main client — stays there.
 *
 * Android Back button: opening any overlay pushes a shallow history entry and
 * registers its close handler on a LIFO stack, so NESTED overlays (e.g. a lightbox
 * opened over Team Week View) each get their own entry and Back closes only the
 * topmost — the lower overlay keeps its entry and closes on the next Back. Closing via
 * a button pops that overlay's entry with history.back(); the resulting popstate echo
 * is absorbed so its handler is not re-invoked. (Before v15.69 this was a single slot:
 * the second overlay clobbered the first's registration, so after closing the top one
 * the lower overlay was left open with no entry and Back then left the page.)
 *
 * ONE STACK PER PAGE. The module-level state below is the page's single record of what is open, and a
 * module URL is evaluated once, so importing this file directly or through overlay.js reaches the same
 * stack. `followLinkOutOf` lives here, not beside createLightbox, because it must read and pop the
 * PRIVATE stack — the reason it could not leave overlay.js before this file existed. No imports: a leaf,
 * so nothing that imports overlay.js can make a cycle through it (import-graph.test.mjs).
 * overlay-history.test.mjs holds all of it without a DOM, loading a fresh copy per test.
 */

// LIFO stack of overlay close handlers — one per pushed history entry, so nested
// overlays stack instead of clobbering each other's Back registration.
/** @type {Function[]} */
let _backHandlers = [];
// Absorbs the popstate ECHO that a button-initiated history.back() fires (see
// _clearOverlayHistory) — a counter, not a boolean, so overlapping button-closes stay balanced.
let _suppressPops = 0;
// True only while a popstate-invoked handler runs. A _clearOverlayHistory() call from
// inside such a handler (the browser already consumed the entry) must be a no-op — otherwise
// it would pop and history.back() a SECOND overlay. (Team view's toggle and every lightbox's
// close call _clearOverlayHistory, so they hit this on the Back path.)
let _handlingPop = false;

/**
 * Push a shallow history entry so Android Back closes the overlay, and register its
 * close handler on the stack. Idempotent per handler: re-registering the SAME overlay's
 * close (e.g. open() called twice with no intervening close) does not stack a duplicate
 * entry — preserving the old model's resilience to a double-open.
 * @param {Function} closeHandler
 */
export function _pushOverlayState(closeHandler) {
    if (_backHandlers.includes(closeHandler)) return;
    history.pushState({ mybOverlay: true }, '');
    _backHandlers.push(closeHandler);
}

/**
 * Is this overlay's close handler at the TOP of the stack — i.e. is it the one the user can
 * actually see and interact with?
 *
 * WHY (v19.53). Every open overlay attaches its OWN `document`-level keydown listener, so a single
 * Escape fired all of them. Android Back was already correct (one history entry is consumed per
 * press, so only the topmost handler runs) and so was the ✕ (it belongs to one overlay) — Escape
 * was the odd one out, and it was the dangerous one: with two one-time NOTICES open, one keypress
 * ran both `onClose` callbacks, so the notice buried underneath was archived and flagged
 * permanently seen by someone who never saw it. Measured, not theorised.
 *
 * `_backHandlers` is reused deliberately rather than a second stack being introduced: it is already
 * the ordered record of what is open, already drives Back, and already has tests. Two stacks would
 * be two things to keep in step.
 *
 * **Fails OPEN.** A handler that is not on the stack at all cannot be shown to be underneath
 * anything, so it is treated as topmost — a wrongly-suppressed Escape is a user trapped in a dialog,
 * which is far worse than an extra close.
 * @param {Function} closeHandler
 */
export function _isTopOverlay(closeHandler) {
    if (!_backHandlers.includes(closeHandler)) return true;
    return _backHandlers[_backHandlers.length - 1] === closeHandler;
}

/**
 * Remove an overlay's history entry when it is closed by a button (not Back).
 * Pass the overlay's own close handler so its SPECIFIC entry is removed — this makes the
 * call idempotent (a double-tap on the ✕, common during the 500ms fade, finds the handler
 * already gone and no-ops instead of popping the overlay BENEATH it) and safe if a
 * non-topmost overlay is dismissed. With no handler it falls back to popping the top (the
 * closing overlay is normally the topmost). Either way it history.back()s ONE entry and the
 * echoed popstate is absorbed by _suppressPops. A no-op inside a popstate-invoked handler
 * (_handlingPop) — the browser already consumed that entry.
 * @param {Function} [closeHandler]
 */
export function _clearOverlayHistory(closeHandler) {
    if (_handlingPop) return;
    const idx = closeHandler ? _backHandlers.lastIndexOf(closeHandler) : _backHandlers.length - 1;
    if (idx < 0) return;   // already removed (double-tap) or not registered → idempotent no-op
    _backHandlers.splice(idx, 1);
    _suppressPops++;
    history.back();
}

// External pop owners (v16.23). nav-panel.js manages its OWN history entry (the drawer) outside
// this stack; without coordination, the popstate from the drawer's history.back() — or a hardware
// Back while the drawer is open — reached this handler and POPPED an unrelated overlay handler
// (concretely: closing the nav drawer while Team Week View was active invoked toggleTeamView and
// kicked the user out of team view). An interceptor returning true claims the pop; this stack is
// left untouched. Registered once at module level by the owner (survives resetNavPanel cycles).
/** @type {Array<() => boolean>} */
const _popInterceptors = [];
/** @param {() => boolean} fn — return true iff the current popstate belongs to you. */
export function registerPopInterceptor(fn) { _popInterceptors.push(fn); }
/** Absorb the NEXT popstate before it reaches the overlay stack — for an external owner's
 *  button-initiated history.back() (its ownership flag is already cleared by then, so the
 *  interceptor can't claim the echo). */
export function suppressNextPop() { _suppressPops++; }

// ── WHEN HAS A BUTTON-CLOSE ACTUALLY LANDED? (v23.61) ────────────────────────────────────────────
//
// `_clearOverlayHistory` calls `history.back()`, and the browser answers with a popstate LATER —
// asynchronously, after the call returns. Anything that pushes a history entry in between (a
// dialog opened from a picker's callback, say) pushes it on top of the entry the traversal is about
// to pop, so the traversal pops the NEW entry instead: the dialog's own Back handler runs and it
// closes itself, having just opened. That race is why every sheet action in this app used to wait
// out a fixed timer before acting. A timer measures neither the fade nor the echo; this does.
/** @type {Array<() => void>} */ let _settleWaiters = [];
/** @type {any} */ let _settleFallback = null;
function _drainSettleWaiters() {
    clearTimeout(_settleFallback); _settleFallback = null;
    const fns = _settleWaiters; _settleWaiters = [];
    for (const fn of fns) {
        try { fn(); } catch (e) { console.error('[overlay] settle callback threw:', e); }
    }
}
/**
 * Run `fn` once no popstate echo from our own `history.back()` is outstanding — SYNCHRONOUSLY when
 * none is (a hardware-Back close issues no `history.back()`, so there is nothing to wait for),
 * otherwise when the echo lands. A 500 ms fallback covers a browser that never sends one, the same
 * tolerance `dismissOverlay` gives a missing `transitionend`; a late echo after the fallback is
 * simply absorbed as before.
 * @param {() => void} fn
 */
export function whenHistorySettled(fn) {
    if (_suppressPops === 0) { fn(); return; }
    _settleWaiters.push(fn);
    if (!_settleFallback) _settleFallback = setTimeout(_drainSettleWaiters, 500);
}

window.addEventListener('popstate', () => {
    // Absorb the echo from our own button-initiated history.back() (or an external owner's — see
    // suppressNextPop). Checked FIRST so a claimed/suppressed pop can never leak the counter.
    if (_suppressPops > 0) {
        _suppressPops--;
        if (_suppressPops === 0 && _settleWaiters.length) _drainSettleWaiters();
        return;
    }
    // An external owner (the nav drawer) claims pops for its own live history entry.
    for (const claims of _popInterceptors) {
        try { if (claims()) return; } catch (_e) { /* interceptor must never break the stack */ }
    }
    if (_backHandlers.length === 0) return;
    const fn = _backHandlers.pop();
    // Guard so the handler's own _clearOverlayHistory() call is a no-op (the entry is gone).
    _handlingPop = true;
    try { fn?.(); } finally { _handlingPop = false; }
});

// ── A LINK OUT OF THE PAGE FROM INSIDE A LIGHTBOX (18 Nov 2026) ──────────────────────────────────────
//
// An open lightbox holds a history entry with THIS page's address (`_pushOverlayState`), and a plain link
// followed from inside it — a one-time notice's call to action, an About panel's page link — stacked the
// next page on top of that entry. Back from there came back to it: from the back/forward cache with the
// lightbox still up although it had been answered, or, reloaded (as a page holding a database connection
// usually is), to a page whose stack is empty — so the NEXT Back was a step within the page that nothing
// answered, and an installed app took one press more to leave. The drawer met this first and REPLACES its
// entry with the destination (nav-panel.js); this is that move for a lightbox. The lightbox's entry leaves
// the stack WITHOUT a `history.back()` — the replace is what removes it — the lightbox closes as any close
// does (its `onClose` runs), and `location.replace` puts the destination where the entry was. Back from
// there lands on the page as it was before the lightbox opened.
//
// Taken over only for a plain click on a link to ANOTHER document in this tab: a new tab or window, a
// download, mail or another scheme, a fragment of this page and a click the page has already handled
// (`defaultPrevented`) are left to the browser. And two cases keep the link's own push:
//   · an echo still on its way is waited for first (`whenHistorySettled`) — "Leave" on the unsaved-work
//     question re-clicks the link as that dialog closes (page-session.js), and a replace issued while the
//     dialog's `history.back()` is pending would land on the wrong entry;
//   · a lightbox that no longer holds the TOP entry — closed by then (a ✕ or Back during the fade, when the
//     card can still be tapped), or under another overlay — has no entry of its own to replace.

/**
 * Is this a link to another document, opened in this tab — not a fragment of this page, mail or another
 * scheme, a new window or a download?
 * @param {HTMLAnchorElement} link
 */
function _leavesThisDocument(link) {
    const raw = link.getAttribute('href') ?? '';
    if (!raw || raw.startsWith('#') || link.hasAttribute('download')) return false;
    if (link.target && link.target !== '_self') return false;
    let to;
    try { to = new URL(link.href); } catch { return false; }
    if (to.protocol !== 'https:' && to.protocol !== 'http:') return false;
    const here = new URL(location.href);
    return to.origin !== here.origin || to.pathname !== here.pathname || to.search !== here.search;
}

/**
 * Follow a click on a link inside an open lightbox by REPLACING the lightbox's history entry with the
 * link's page (the reasoning is above). Wire it as the link's click listener, or the panel's: it finds the
 * link from the event's target.
 * @param {{ close: () => unknown }} lightbox  the `createLightbox` handle the link sits in
 * @param {MouseEvent} e  the click
 * @returns {boolean} true when it took the click over; false when the browser follows the link as it would
 */
export function followLinkOutOf(lightbox, e) {
    const link = /** @type {HTMLAnchorElement|null} */ (/** @type {any} */ (e?.target)?.closest?.('a[href]') ?? null);
    if (!link || e.defaultPrevented || !_leavesThisDocument(link)) return false;
    if ((e.button ?? 0) !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;   // a new tab or window
    e.preventDefault();
    const href = link.href;
    whenHistorySettled(() => {
        if (_backHandlers[_backHandlers.length - 1] !== lightbox.close) { location.assign(href); return; }
        _backHandlers.pop();   // its entry becomes the destination below, so nothing is left to pop it
        lightbox.close();      // the close every lightbox makes, without the history.back() it has no entry for
        location.replace(href);
    });
    return true;
}
