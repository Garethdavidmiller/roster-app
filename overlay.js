// @ts-check
/**
 * overlay.js — Shared scroll lock, Android Back button overlay helpers, the canonical lightbox and the
 * in-app confirm/prompt dialogs. The collapsible card and the deep link that opens one by name are
 * card-collapse.js's, re-exported below so every page imports them from here as it always has.
 *
 * Imported by most pages and many feature modules — grep for the import rather than trusting a
 * list here.
 *
 * Body scroll lock: iOS Safari ignores overflow:hidden on body, so we pin
 * position:fixed at the current scroll offset and restore on close. The
 * .lb-open class (defined in shared.css) applies the fix.
 *
 * Android Back button: opening any overlay pushes a shallow history entry and
 * registers its close handler on a LIFO stack, so NESTED overlays (e.g. a lightbox
 * opened over Team Week View) each get their own entry and Back closes only the
 * topmost — the lower overlay keeps its entry and closes on the next Back. Closing via
 * a button pops that overlay's entry with history.back(); the resulting popstate echo
 * is absorbed so its handler is not re-invoked. (Before v15.69 this was a single slot:
 * the second overlay clobbered the first's registration, so after closing the top one
 * the lower overlay was left open with no entry and Back then left the page.)
 */

export { initCardCollapse, openCardNamedByHash } from './card-collapse.js';

let _lbScrollY = 0;
// Depth-counted so nesting is safe (the v15.69 history stack made nested overlays a
// supported case). Once `.lb-open` is applied (position:fixed) window.scrollY reads 0, so a
// naive second lock would capture 0 and the inner unlock would strip the lock (background
// jumps to top) while the outer overlay is still open. Capture only on 0→1, restore on 1→0.
let _lbDepth = 0;

/** Lock body scroll for an open overlay (iOS Safari fix). Re-entrant / nesting-safe. */
export function lockBodyScroll() {
    if (_lbDepth++ > 0) return;   // already locked by an outer overlay — keep its scroll baseline
    _lbScrollY = window.scrollY;
    document.body.style.setProperty('--lb-scroll-y', `-${_lbScrollY}px`);
    document.body.classList.add('lb-open');
}

/** Restore body scroll after an overlay closes. Only the outermost unlock restores. */
export function unlockBodyScroll() {
    // Already fully unlocked → do nothing. Without this, an UNBALANCED second unlock at depth 0
    // (e.g. Android Back closes the nav drawer mid doc-fetch, then the fetch's own close fires a
    // second unlock) fell straight through to scrollTo(0, _lbScrollY) with a now-stale offset,
    // yanking the reader back to where the overlay opened. Restore only when we truly go 1→0 (v16.19).
    if (_lbDepth === 0) return;
    if (--_lbDepth > 0) return;    // an outer overlay is still open — keep the lock
    document.body.classList.remove('lb-open');
    document.body.style.removeProperty('--lb-scroll-y');
    window.scrollTo(0, _lbScrollY);
}

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
 * Open a one-time NOTICE only if nothing else is on screen — otherwise leave it for the next load.
 *
 * A notice is dismissed once and then never shown again, so it must never appear stacked behind (or
 * in front of) another overlay: the reader either cannot see it, or cannot see what it covered.
 * Returning without opening leaves the notice UNSEEN and UNARCHIVED — the "seen" flag is written in
 * `onClose`, which cannot run — so it simply gets its turn next time.
 *
 * Which one wins when two are due is DOM/registration order, and that is fine: the point is that
 * exactly one shows per load, not which. The `new-notice` skill's actionable pattern already had
 * this guard inline; the close-only pattern (which both of the app's current notices use) did not.
 * @param {{ open: (...a: any[]) => void }} lightbox - the createLightbox handle
 * @returns {boolean} true if it opened
 */
export function openNoticeIfClear(lightbox) {
    if (document.body.classList.contains('lb-open')) return false;
    lightbox.open();
    return true;
}

/**
 * Close an overlay: remove .open, then once the CSS fade-out ends (or after a
 * 500 ms safety fallback) remove .visible and unlock body scroll.
 *
 * @param {Element}  el                  - The .lb-overlay element
 * @param {object}   [opts]
 * @param {EventListener} [opts.onKey]   - document keydown listener to remove
 * @param {HTMLElement}  [opts.focusReturn]  - element to focus synchronously on close
 * @param {Function} [opts.afterClose]   - called once .visible is removed and scroll unlocked
 * @param {Function} [opts.backHandler]  - the close handler this overlay registered via
 *   _pushOverlayState; passed on so _clearOverlayHistory drops THIS overlay's entry (not
 *   just the top) and a double-tap / non-topmost dismiss can't pop a different overlay's entry.
 */
export function dismissOverlay(el, { onKey, focusReturn, afterClose, backHandler } = {}) {
    _clearOverlayHistory(backHandler);
    el.classList.remove('open');
    if (onKey) document.removeEventListener('keydown', onKey);
    focusReturn?.focus();
    // Whichever fires first (the transition ending, or the 500 ms fallback when iOS suppresses
    // transitionend on a backgrounded tab) runs finish() exactly once AND removes the listener.
    // Previously the fallback timer left the {once:true} transitionend listener attached, so it
    // survived and re-fired on the overlay's NEXT opening transition — hiding it right after it
    // appeared and leaking a phantom history entry.
    let _done = false;
    /** @type {any} */ let _t;
    const finishOnce = () => {
        if (_done) return;
        _done = true;
        clearTimeout(_t);
        el.removeEventListener('transitionend', finishOnce);
        el.classList.remove('visible');
        unlockBodyScroll();
        afterClose?.();
    };
    // Reduced motion disables the fade transition entirely (shared.css), so transitionend never
    // fires — finish immediately (return null: nothing left pending) instead of making those users
    // wait out the 500 ms fallback with body scroll still locked.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finishOnce(); return null; }
    _t = setTimeout(finishOnce, 500);
    el.addEventListener('transitionend', finishOnce);
    // Return the idempotent finisher so a caller re-opening DURING the fade can complete this close
    // synchronously first (removes .visible + unlocks scroll exactly once) and then re-open cleanly,
    // instead of the re-open being silently dropped by a `.visible`-still-set guard.
    return finishOnce;
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

/** What Tab can reach in `container` (enabled, rendered) — one list for the trap and the focus guard. @param {Element} container */
function _tabStops(container) {
    return /** @type {HTMLElement[]} */ ([...container.querySelectorAll('button,a[href],input,select,textarea,[contenteditable],[tabindex]:not([tabindex="-1"])')]).filter(el => !/** @type {any} */ (el).disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null);
}

/**
 * Trap keyboard focus inside a lightbox container (accessibility).
 * Call from the container's keydown handler — no-op if key is not Tab.
 * @param {Element|null} container
 * @param {KeyboardEvent} e
 */
export function trapFocus(container, e) {
    if (e.key !== 'Tab' || !container) return;
    const els = _tabStops(container);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    const active = document.activeElement;
    // When focus is on the dialog PANEL itself (its tabindex="-1" — the default open focus since the
    // WAI-ARIA panel-focus change) it is outside `els`, so neither wrap branch below fires and a
    // Shift+Tab would walk backwards PAST the overlay into the page behind it. Treat container-held
    // focus as sitting just before the first element: Shift+Tab wraps to last, Tab goes to first —
    // keeping the trap closed on the very first keystroke after open.
    if (active === container) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

// ── FOCUS THAT ARRIVES WITHOUT A KEY (iPhone audit, 7 Nov 2026) ── The ‹ › arrows over the iPhone
// keyboard step to the previous or next text field IN THE DOCUMENT and fire no key event, so the Tab
// trap never saw them: typing walked out of a prompt into a field behind it (a screen reader's moves
// and a late `focus()` are the same shape). So an open overlay pulls focus that lands outside it back
// in — to the control last focused inside, else the first. TOPMOST ONLY and failing OPEN, as Escape:
// `_isTopOverlay` orders the stack, and an open `aria-modal` surface NOT on it that paints above (by
// z-index, then document order) stands the guard down — the sign-in card a lost session mounts over a
// dialog, the password-force card. Fighting those would leave a member unable to type a password.
/** Does an open modal surface off the stack paint above `overlay`? (A shut drawer is aria-hidden; a shut lightbox has no boxes.) @param {Element} overlay */
function _unstackedSurfaceAbove(overlay) {
    const z = (/** @type {Element} */ el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(el => {
        if (el === overlay || el.contains(overlay) || overlay.contains(el)) return false;
        if (el.getAttribute('aria-hidden') === 'true' || !el.getClientRects().length) return false;
        return z(el) > z(overlay) || (z(el) === z(overlay) && !!(overlay.compareDocumentPosition(el) & 4));   // 4: FOLLOWING
    });
}
/** Pull focus landing outside `overlay` back in. Returns the detach. @param {Element} overlay @param {Element} panel @param {() => boolean} isTop */
function _guardFocus(overlay, panel, isTop) {
    if (typeof overlay.contains !== 'function') return () => {};
    /** @type {any} */ let last = null;
    const onFocusIn = (/** @type {any} */ e) => {
        const t = e.target;
        if (t?.nodeType !== 1) return;                       // the window or the document regaining focus
        if (overlay.contains(t)) { last = t; return; }
        if (!isTop() || _unstackedSurfaceAbove(overlay)) return;
        const kept = last?.isConnected && overlay.contains(last) && !last.disabled;
        /** @type {any} */ (kept ? last : _tabStops(panel)[0] ?? (panel.hasAttribute?.('tabindex') ? panel : null))?.focus?.({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
}
/** Input types that raise no keyboard; any other input, and a textarea, is typed into. */
const _NO_KEYBOARD = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden']);
const _isTextEntry = (/** @type {any} */ el) => el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !_NO_KEYBOARD.has(String(el.type || 'text').toLowerCase()));

/**
 * Mark a panel with more below its fold, for shared.css's fade: every lightbox, and the drawer's body.
 *
 * Toggled rather than always-on: fading the last line of a panel that FITS would invent the
 * ambiguity this exists to remove. Re-measured on scroll (the fade must go once you reach the
 * bottom) and on resize — a phone rotating turns a scrolling panel into a fitting one.
 *
 * Best-effort decoration: a panel that never gains the class looks as it did before v21.36.
 *
 * @param {HTMLElement|null} panel the scrolling element
 * @returns {() => void} stops watching
 */
export function watchScrollFade(panel) {
    if (!panel) return () => {};
    const sync = () => {
        const more = panel.scrollHeight - panel.clientHeight - panel.scrollTop > 2;
        panel.classList.toggle('has-more', more);
    };
    // The WINDOW listener outlives the panel unless something removes it (v21.86, external audit).
    // The scroll listener dies with the element; `resize` is on `window`, so every open added one
    // more, and for the dialogs built on the fly (`confirmDialog`/`promptDialog`) the handler also
    // closed over a detached node and kept it alive. One AbortController per open, aborted on
    // close, retires both listeners together and cannot drift out of step the way a pair of
    // matching add/remove calls can.
    const ac = new AbortController();
    requestAnimationFrame(() => requestAnimationFrame(sync));
    panel.addEventListener('scroll', sync, { passive: true, signal: ac.signal });
    window.addEventListener('resize', sync, { passive: true, signal: ac.signal });
    // THE PANEL CAN CHANGE SIZE WITH NOTHING SCROLLED OR RESIZED (v24.30 polish pass). The picker
    // sheet's search box filters its own list: a 45-name sheet opens capped at 85vh and gains the
    // fade, then "zzz" leaves one line of "No match" in a 189px panel — measured scrollHeight ===
    // clientHeight — still wearing the fade over that line, because neither listener above had
    // fired. So the panel's CONTENT is watched, and its box too. The content observer is the one that
    // matters: a MutationObserver runs as a microtask, and `sync` reads `scrollHeight`, which forces
    // the layout it needs. ResizeObserver and requestAnimationFrame both ride the rendering loop,
    // which headless WebKit throttled in about half of measured runs — the fade stayed on with the
    // observer never called. The box observer stays for a size change with no DOM change (a late
    // font), and `hidden` is watched for a fold — the drawer's Reference — that adds no node.
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(sync);
        ro.observe(panel);
        ac.signal.addEventListener('abort', () => ro.disconnect());
    }
    if (typeof MutationObserver === 'function') {
        const mo = new MutationObserver(sync);
        mo.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
        ac.signal.addEventListener('abort', () => mo.disconnect());
    }
    return () => ac.abort();
}

/**
 * Build a lightbox with the canonical open/close lifecycle (the rule is in CLAUDE.md's
 * architecture table; the full lifecycle and its three exceptions are AI_MAP → `overlay.js`). One factory so every lightbox gets the
 * same behaviour and none can drift: focus save/restore, .visible → rAF →
 * .open + focus, body scroll lock, Android Back support, Escape to close,
 * a Tab trap and a guard for focus moves Tab never sees, and a text field focused in the tap.
 *
 * Default wiring added here: clicking the backdrop (the overlay itself, not
 * the content card) closes, and the close button closes. Callers add any
 * further triggers themselves and prepare dynamic content BEFORE calling
 * open() — or via onOpen, which runs before the overlay becomes visible.
 *
 * @param {object} opts
 * @param {Element}   opts.overlay       - The .lb-overlay element
 * @param {Element}  [opts.content]      - The .lb-content card (focus-trap boundary; defaults to overlay)
 * @param {Element}  [opts.closeBtn]     - The .lb-close button (also the default initial focus)
 * @param {Element|Function} [opts.initialFocus] - Element (or fn returning one) to focus on open instead of closeBtn
 * @param {Function} [opts.onOpen]       - Called with open()'s arguments before the overlay is shown
 * @param {Function} [opts.onClose]      - Called as the overlay starts closing (any close path)
 * @param {Function} [opts.afterClose]   - Called once a close has fully LANDED: the fade finished
 *   (or the reduced-motion synchronous finish) AND the popstate echo of its history.back() has
 *   arrived. The moment after which opening another overlay is safe — see `whenHistorySettled`.
 * @returns {{ open: () => void, close: () => Promise<void> }} — `close()` resolves at that same
 *   moment. A caller that does not care may ignore the promise; one that acts on a close (the
 *   picker sheet applying a pick) awaits it rather than a timer.
 */
export function createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose, afterClose }) {
    /** @type {Element|null} */
    let _focusReturn = null;
    // The in-flight close's finisher while the overlay is fading out (null otherwise). Lets a
    // re-open DURING the fade complete that close synchronously and then re-open, instead of the
    // re-open being silently dropped.
    /** @type {(() => void)|null} */
    let _pendingClose = null;
    /** The in-flight close's landing promise (fade AND history echo), so a second close() during the
     *  fade hands back the same promise rather than a fresh resolved one. */
    /** @type {Promise<void>|null} */
    let _settling = null;
    /** Retires this open's scroll/resize listeners. Reassigned per open, called on close. */
    let _stopScrollFade = /** @type {() => void} */ (() => {});
    let _stopFocusGuard = /** @type {() => void} */ (() => {});   // this open's guard; retired first thing in a close

    /** @param {KeyboardEvent} e */
    function onKey(e) {
        // Only the TOPMOST overlay reacts. Both halves matter: Escape used to close every open
        // overlay at once (see `_isTopOverlay`), and `trapFocus` on a BURIED overlay would drag Tab
        // back into a dialog the user cannot see. Fails open — see `_isTopOverlay`.
        if (!_isTopOverlay(close)) return;
        if (e.key === 'Escape') { close(); return; }
        trapFocus(content ?? overlay, e);
    }

    function open(/** @type {any[]} */...args) {
        // Re-open during the close fade: the overlay is still `.visible` (removed only at
        // transitionend/fallback) but logically closing. Complete that close NOW (removes .visible +
        // unlocks scroll exactly once — idempotent finisher) so the fresh open below re-locks and
        // re-shows cleanly. Without this, a staff member re-tapping the trigger within ~0.2–0.5 s of
        // closing (e.g. re-checking the About panel) got nothing until a second tap.
        if (_pendingClose) { _pendingClose(); _pendingClose = null; }
        // Idempotent: a second open() while already/still open (not closing) would push a duplicate
        // lockBodyScroll (depth counter → the lock never releases on close) and re-run onOpen.
        // Reachable via a fast double-tap on a trigger during the opener's slide-in.
        else if (overlay.classList.contains('visible')) return;
        _focusReturn = document.activeElement;
        onOpen?.(...args);
        lockBodyScroll();
        _pushOverlayState(close);
        overlay.classList.add('visible');
        _stopScrollFade = watchScrollFade(/** @type {HTMLElement|null} */ (content ?? null));
        _stopFocusGuard = _guardFocus(overlay, content ?? overlay, () => _isTopOverlay(close));   // after the push: already top
        // A TEXT FIELD IS FOCUSED NOW, IN THE TAP (iPhone audit, 7 Nov 2026): iOS raises its keyboard only for
        // a focus made synchronously in the gesture, and the frame below is not. The rest keep the frame.
        const early = /** @type {any} */ (typeof initialFocus === 'function' ? initialFocus() : initialFocus);
        const focusedEarly = _isTextEntry(early) && (early.focus(), document.activeElement === early);
        requestAnimationFrame(() => {
            overlay.classList.add('open');
            if (focusedEarly) return;
            const explicit = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
            // Default focus goes to the dialog PANEL (given a `tabindex="-1"`), NOT the ✕ close button.
            // Moving focus into the dialog on open is the WAI-ARIA pattern, but landing it on the close
            // BUTTON makes a keyboard-focus ring appear around the ✕ even when the dialog was opened by
            // tap or AUTO-opened (a notice): Samsung/Android treat the programmatic focus as
            // focus-visible → a heavy navy outline box round the ✕. A non-interactive panel with
            // tabindex="-1" is outside the global :focus-visible ring selector (button/[tabindex="0"]),
            // so screen-reader users still get moved into the dialog with no ring on a control.
            // Explicit initialFocus callers (login field, confirm/prompt input) are unchanged.
            let target = explicit;
            const panel = /** @type {HTMLElement|null} */ (content ?? null);
            if (!target && panel) {
                if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
                target = panel;
            }
            (target ?? closeBtn)?.focus?.();
        });
        document.addEventListener('keydown', onKey);
    }

    function close() {
        // ALREADY CLOSING — do nothing (v21.86, external audit). `close` is reachable from four
        // places at once (✕, backdrop, Escape, Android Back), and during the ~300ms fade a second
        // one used to run the whole body again: a second `onClose`, and a second `dismissOverlay`
        // with its own `_done` flag, so `unlockBodyScroll()` ran TWICE for one open.
        //
        // That is only invisible while a single overlay is up, because the lock is DEPTH-COUNTED.
        // With a lightbox open over another (a confirm over the bin, a notice over the Huddle
        // viewer) the depth went 2 → 1 → 0 and the page behind the still-open outer overlay became
        // scrollable. Reproduced by the audit.
        //
        // The history stack was already guarded against the same double-tap — `backHandler: close`
        // below exists for exactly that — so this was the one lifecycle the guard had missed.
        // TWO conditions, because there are two ways to be "already closed" and only one of them
        // leaves a pending finisher behind. `_pendingClose` covers the fade; the `visible` check
        // covers REDUCED MOTION, where `dismissOverlay` finishes synchronously and returns null —
        // so a guard on `_pendingClose` alone would let a second close through on exactly the
        // devices whose users asked for less animation.
        if (_pendingClose) return _settling ?? Promise.resolve();
        if (!overlay.classList.contains('visible')) return _settling ?? Promise.resolve();
        _stopScrollFade();
        _stopFocusGuard();
        // A caller's onClose must NEVER strand the overlay: if it threw, dismissOverlay below would
        // not run, leaving the overlay .open/.visible, body scroll locked, and the pushed Back-history
        // entry orphaned (a later Android Back would then pop the wrong overlay). Isolate it.
        try { onClose?.(); } catch (e) { console.error('[overlay] onClose threw:', e); }
        // Pass `close` as backHandler so a double-tap on the ✕ (or backdrop) during the fade
        // drops only THIS lightbox's entry, never the overlay beneath it. Capture the finisher so a
        // re-open during the fade can complete this close first; afterClose clears it once the close
        // lands naturally (transitionend/fallback).
        /** @type {() => void} */ let fadeLanded = () => {};
        const fade = /** @type {Promise<void>} */ (new Promise(res => { fadeLanded = () => res(); }));
        _pendingClose = dismissOverlay(overlay, {
            onKey: /** @type {EventListener} */ (onKey),
            focusReturn: /** @type {HTMLElement|undefined} */ (_focusReturn ?? undefined),
            backHandler: close,
            afterClose: () => { _pendingClose = null; fadeLanded(); },
        });
        _focusReturn = null;
        // The close has LANDED when both halves have: the fade (or its fallback, or the synchronous
        // reduced-motion finish — `fade` covers all three) AND the history echo, which
        // `dismissOverlay` has just made outstanding via `_clearOverlayHistory`. Under reduced motion
        // the first half is already done by this line and the second is what the caller is really
        // waiting for; a picker that opened a dialog on the fade alone would have it popped.
        const echo = /** @type {Promise<void>} */ (new Promise(res => whenHistorySettled(() => res())));
        _settling = Promise.all([fade, echo]).then(() => {
            _settling = null;
            try { afterClose?.(); } catch (e) { console.error('[overlay] afterClose threw:', e); }
        });
        return _settling;
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    closeBtn?.addEventListener('click', close);

    return { open, close };
}

// Monotonic id source for dynamically-built dialogs (aria-labelledby/-describedby targets).
// A plain counter — deterministic, no Math.random/Date needed.
let _dialogSeq = 0;

/**
 * Build the DOM for a confirm/prompt dialog and wire it through createLightbox. Shared by
 * confirmDialog and promptDialog. The overlay reuses the `.lb-overlay`/`.lb-content` chrome
 * (so it inherits the canonical open animation, backdrop, blur) plus dialog-specific classes
 * styled in shared.css. Returns a Promise resolving to the caller's result.
 *
 * @param {object}  o
 * @param {string}  o.message
 * @param {string} [o.title]
 * @param {string}  o.confirmLabel
 * @param {string}  o.cancelLabel
 * @param {boolean} o.danger
 * @param {boolean} o.withInput            - render a text input (prompt) vs none (confirm)
 * @param {string} [o.defaultValue]        - initial input value (prompt)
 * @param {string} [o.placeholder]         - input placeholder (prompt)
 * @param {number} [o.maxLength]           - input maxlength (prompt)
 * @param {(input: HTMLInputElement|null) => any} o.resultOnConfirm - value to resolve on confirm
 * @param {any}     o.resultOnCancel       - value to resolve on the Cancel button
 * @param {any}     o.resultOnDismiss      - value to resolve on a dismissal: the backdrop, Escape, Android Back
 * @returns {Promise<any>}
 */
function _openDialog(o) {
    return new Promise(resolve => {
        const seq   = ++_dialogSeq;
        const msgId = `mybDlgMsg${seq}`;
        const titleId = `mybDlgTitle${seq}`;

        const overlay = document.createElement('div');
        overlay.className = 'lb-overlay dialog-overlay';
        overlay.setAttribute('role', o.withInput ? 'dialog' : 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        if (o.title) overlay.setAttribute('aria-labelledby', titleId);
        else overlay.setAttribute('aria-label', o.message);
        overlay.setAttribute('aria-describedby', msgId);

        const content = document.createElement('div');
        content.className = 'lb-content dialog-lb-content';

        if (o.title) {
            const h = document.createElement('h2');
            h.className = 'dialog-title';
            h.id = titleId;
            h.textContent = o.title;
            content.appendChild(h);
        }

        const p = document.createElement('p');
        p.className = 'dialog-message';
        p.id = msgId;
        p.textContent = o.message;   // textContent — never innerHTML (message can be arbitrary)
        content.appendChild(p);

        /** @type {HTMLInputElement|null} */
        let input = null;
        if (o.withInput) {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'dialog-input';
            input.value = o.defaultValue ?? '';
            if (o.placeholder) input.placeholder = o.placeholder;
            if (o.maxLength)   input.maxLength = o.maxLength;
            input.setAttribute('aria-label', o.title || o.message);
            content.appendChild(input);
        }

        const actions = document.createElement('div');
        actions.className = 'dialog-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'dialog-btn dialog-btn-cancel';
        cancelBtn.textContent = o.cancelLabel;
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'dialog-btn dialog-btn-confirm' + (o.danger ? ' danger' : '');
        confirmBtn.textContent = o.confirmLabel;
        // Cancel first, confirm last — matches the app's primary-action-on-the-right convention.
        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        content.appendChild(actions);

        overlay.appendChild(content);
        document.body.appendChild(overlay);

        let settled = false;
        // Until a button is pressed the dialog is being DISMISSED — the backdrop, Escape or Android Back
        // — which `confirmDialog` reads as Cancel unless its caller must tell "not now" from "no": the
        // unsaved-work offer, whose Cancel deletes the kept work (unsaved-draft.js).
        let result = o.resultOnDismiss;
        // ONE ANSWER PER DIALOG. The card stays on screen, and tappable, through its close fade, so a
        // second tap used to run its button again: a double tap on "Open in Safari" ran `onConfirm`
        // twice, and Cancel then Confirm resolved a cancelled dialog as confirmed. The first answer —
        // a button, or a dismissal (`onClose` below) — stands.
        let answered = false;
        /** @param {() => any} pick */
        const answer = (pick) => {
            if (answered) return;
            answered = true;
            // try/finally so a throwing resultOnConfirm can never leave the dialog open and the Promise
            // pending (today both resolvers are total, but this keeps the contract robust).
            try { result = pick(); } finally { lb.close(); }
        };

        const lb = createLightbox({
            overlay,
            content,
            // No `closeBtn`: Cancel is wired below, because it is an ANSWER, and createLightbox's close
            // control would resolve it as a dismissal. The backdrop, Escape and Back stay its own.
            initialFocus: () => input ?? confirmBtn,
            // Resolve when the close has LANDED, not as it starts. Callers chain dialogs
            // (`if (!await confirmDialog(…)) return; await promptDialog(…)`), and a resolve here in
            // onClose let the next dialog push its Back entry while this close's history.back() was
            // still in flight — the traversal popped the NEW entry, so Back then left the page.
            afterClose: () => { if (!settled) { settled = true; resolve(result); } },
            onClose: () => {
                answered = true;   // a dismissal is an answer too: no button may change it during the fade
                // Remove the dynamic node AFTER the close transition (not synchronously here): a
                // node detached now would suppress dismissOverlay's transitionend, forcing its 500ms
                // fallback AND skipping the fade-out every other lightbox shows. 500ms clears the
                // 0.2s fade with margin; reduced-motion finishes sooner and the node just lingers
                // invisibly until this fires.
                setTimeout(() => overlay.remove(), 500);
            },
        });

        const confirmAndClose = () => answer(() => o.resultOnConfirm(input));
        confirmBtn.addEventListener('click', confirmAndClose);
        cancelBtn.addEventListener('click', () => answer(() => o.resultOnCancel));
        // Enter in the prompt input submits (mirrors native prompt()).
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmAndClose(); }
        });

        lb.open();
    });
}

/**
 * Promise-based replacement for the browser's confirm(), styled as an app lightbox (inherits the
 * createLightbox lifecycle: focus trap, Escape, Android Back, scroll lock, transitionend fallback).
 * Resolves true if the user confirms and false on Cancel. A DISMISSAL — backdrop, Escape, Android
 * Back — resolves `dismissResult`, which is false, a Cancel, unless the caller passes something else.
 *
 * ASYNC by nature — it cannot stand in for confirm() in a SYNCHRONOUS context that must decide
 * `preventDefault()` inline (a capture-phase navigation guard) or in a `beforeunload` handler.
 * For a navigation guard, intercept-always then navigate when the returned Promise resolves true;
 * beforeunload must keep the native dialog.
 *
 * @template [D=false]
 * @param {object} opts
 * @param {string}  opts.message
 * @param {string} [opts.title]
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.danger=false]  - style the confirm button as destructive (e.g. Delete)
 * @param {() => void} [opts.onConfirm]  - run synchronously INSIDE the confirm tap, for work that
 *                                         needs the user gesture (window.open)
 * @param {D} [opts.dismissResult]       - what a dismissal resolves to (default false). For a question
 *   whose Cancel destroys something, so that a tap meant for the page behind cannot: the unsaved-work
 *   offer passes null, and a dismissed offer is asked again next load (unsaved-draft.js).
 * @returns {Promise<boolean|D>}
 */
export function confirmDialog({ message, title, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, onConfirm, dismissResult }) {
    return _openDialog({
        message, title, confirmLabel, cancelLabel, danger,
        withInput: false,
        // `onConfirm` runs INSIDE the confirm tap (v25.06): the promise settles only after the close
        // fade and the Back echo, by which time the user gesture is spent — so work that needs one
        // (`window.open`) belongs here, not after the await. print-guard.js → explainNoPrint.
        resultOnConfirm: () => { onConfirm?.(); return true; },
        resultOnCancel: false,
        resultOnDismiss: dismissResult === undefined ? false : dismissResult,
    });
}

/**
 * Promise-based replacement for the browser's prompt(), styled as an app lightbox. Resolves the
 * entered string on confirm (Enter or the confirm button), or null on Cancel / dismiss — matching
 * native prompt()'s string|null contract, so callers keep their `(await promptDialog(...))?.trim()`.
 *
 * @param {object} opts
 * @param {string}  opts.message
 * @param {string} [opts.title]
 * @param {string} [opts.defaultValue='']
 * @param {string} [opts.placeholder]
 * @param {number} [opts.maxLength]
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 * @returns {Promise<string|null>}
 */
export function promptDialog({ message, title, defaultValue = '', placeholder, maxLength, confirmLabel = 'OK', cancelLabel = 'Cancel' }) {
    return _openDialog({
        message, title, confirmLabel, cancelLabel, danger: false,
        withInput: true, defaultValue, placeholder, maxLength,
        resultOnConfirm: input => (input ? input.value : null),
        resultOnCancel: null,
        resultOnDismiss: null,
    });
}
