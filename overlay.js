// @ts-check
/**
 * overlay.js — Shared scroll lock, Android Back button overlay helpers,
 * and card-collapse toggle.
 *
 * Imported by calendar-app.js, admin-app.js, paycalc-app.js, operations-app.js,
 * settings-app.js, links-app.js, and nav-panel.js.
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

let _lbScrollY = 0;

/** Lock body scroll for an open overlay (iOS Safari fix). */
export function lockBodyScroll() {
    _lbScrollY = window.scrollY;
    document.body.style.setProperty('--lb-scroll-y', `-${_lbScrollY}px`);
    document.body.classList.add('lb-open');
}

/** Restore body scroll after an overlay closes. */
export function unlockBodyScroll() {
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
    function finish() { el.classList.remove('visible'); unlockBodyScroll(); afterClose?.(); }
    // Reduced motion disables the fade transition entirely (shared.css), so
    // transitionend never fires — finish immediately instead of making those
    // users wait out the 500 ms fallback with body scroll still locked.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
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
        finish();
    };
    _t = setTimeout(finishOnce, 500);
    el.addEventListener('transitionend', finishOnce);
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

window.addEventListener('popstate', () => {
    // Absorb the echo from our own button-initiated history.back().
    if (_suppressPops > 0) { _suppressPops--; return; }
    if (_backHandlers.length === 0) return;
    const fn = _backHandlers.pop();
    // Guard so the handler's own _clearOverlayHistory() call is a no-op (the entry is gone).
    _handlingPop = true;
    try { fn?.(); } finally { _handlingPop = false; }
});

/**
 * Trap keyboard focus inside a lightbox container (accessibility).
 * Call from the container's keydown handler — no-op if key is not Tab.
 * @param {Element|null} container
 * @param {KeyboardEvent} e
 */
export function trapFocus(container, e) {
    if (e.key !== 'Tab' || !container) return;
    const els = /** @type {HTMLElement[]} */ ([...container.querySelectorAll('button,a[href],input,select,textarea,[contenteditable],[tabindex]:not([tabindex="-1"])')]).filter(el => !/** @type {any} */ (el).disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/**
 * Build a lightbox with the canonical open/close lifecycle (see CLAUDE.md
 * "Canonical lightbox lifecycle"). One factory so every lightbox gets the
 * same behaviour and none can drift: focus save/restore, .visible → rAF →
 * .open + focus, body scroll lock, Android Back support, Escape to close,
 * and a Tab focus trap inside the content card.
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
 * @returns {{ open: () => void, close: () => void }}
 */
export function createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose }) {
    /** @type {Element|null} */
    let _focusReturn = null;

    /** @param {KeyboardEvent} e */
    function onKey(e) {
        if (e.key === 'Escape') { close(); return; }
        trapFocus(content ?? overlay, e);
    }

    function open(/** @type {any[]} */...args) {
        _focusReturn = document.activeElement;
        onOpen?.(...args);
        lockBodyScroll();
        _pushOverlayState(close);
        overlay.classList.add('visible');
        requestAnimationFrame(() => {
            overlay.classList.add('open');
            const target = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
            (target ?? closeBtn)?.focus();
        });
        document.addEventListener('keydown', onKey);
    }

    function close() {
        onClose?.();
        // Pass `close` as backHandler so a double-tap on the ✕ (or backdrop) during the fade
        // drops only THIS lightbox's entry, never the overlay beneath it.
        dismissOverlay(overlay, { onKey: /** @type {EventListener} */ (onKey), focusReturn: /** @type {HTMLElement|undefined} */ (_focusReturn ?? undefined), backHandler: close });
        _focusReturn = null;
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    closeBtn?.addEventListener('click', close);

    return { open, close };
}

/**
 * Wire up a collapsible card header: clicking the header toggles .open on
 * the body and (optionally) the chevron. Adds keyboard (Enter/Space) and
 * ARIA support so screen-reader users can operate the collapse.
 * Safe to call before the page is fully loaded — no-op if the header or
 * body element is not found.
 * @param {string} headerId   - id of the clickable header element
 * @param {string} bodyId     - id of the collapsible body element
 * @param {string} [chevronId] - optional id of the ▾ chevron element (may be
 *   the headerId itself when the open state lives on the header)
 * @param {Function} [onToggle] - optional callback invoked with the new open
 *   state after every toggle (e.g. pre-fill fields when a card opens)
 */
export function initCardCollapse(headerId, bodyId, chevronId, onToggle) {
    const header  = document.getElementById(headerId);
    const body    = document.getElementById(bodyId);
    const chevron = chevronId ? document.getElementById(chevronId) : null;
    if (!header || !body) return;

    // Make non-button/non-anchor headers keyboard-reachable
    const tag = header.tagName;
    if (tag !== 'BUTTON' && tag !== 'A') {
        header.setAttribute('role', 'button');
        if (!header.hasAttribute('tabindex')) header.setAttribute('tabindex', '0');
    }
    // Link header to its controlled body for screen readers
    if (!header.hasAttribute('aria-controls')) header.setAttribute('aria-controls', bodyId);

    function toggle() {
        const open = /** @type {HTMLElement} */ (body).classList.toggle('open');
        if (chevron && chevron !== body) chevron.classList.toggle('open', open);
        /** @type {HTMLElement} */ (header).setAttribute('aria-expanded', String(open));
        onToggle?.(open);
    }

    // Initialise aria-expanded from the current DOM state
    header.setAttribute('aria-expanded', String(body.classList.contains('open')));

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
}
