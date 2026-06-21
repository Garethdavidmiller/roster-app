/**
 * overlay.js — Shared scroll lock, Android Back button overlay helpers,
 * and card-collapse toggle.
 *
 * Imported by app.js, admin-app.js, paycalc.js, operations-app.js,
 * settings-app.js, links-app.js, and nav-panel.js.
 *
 * Body scroll lock: iOS Safari ignores overflow:hidden on body, so we pin
 * position:fixed at the current scroll offset and restore on close. The
 * .lb-open class (defined in shared.css) applies the fix.
 *
 * Android Back button: opening any overlay pushes a shallow history entry;
 * Back dismisses it instead of navigating away. Closing via a button clears
 * the entry via history.back(), which fires popstate — the flag is already
 * false by then so the handler is a no-op.
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

let _overlayHistoryPushed = false;
let _backHandler = null;

/** Push a shallow history entry so Android Back closes the overlay. */
export function _pushOverlayState(closeHandler) {
    if (!_overlayHistoryPushed) {
        history.pushState({ mybOverlay: true }, '');
        _overlayHistoryPushed = true;
    }
    _backHandler = closeHandler;
}

/**
 * Close an overlay: remove .open, then once the CSS fade-out ends (or after a
 * 500 ms safety fallback) remove .visible and unlock body scroll.
 *
 * @param {Element}  el                  - The .lb-overlay element
 * @param {object}   [opts]
 * @param {Function} [opts.onKey]        - document keydown listener to remove
 * @param {Element}  [opts.focusReturn]  - element to focus synchronously on close
 * @param {Function} [opts.afterClose]   - called once .visible is removed and scroll unlocked
 */
export function dismissOverlay(el, { onKey, focusReturn, afterClose } = {}) {
    _clearOverlayHistory();
    el.classList.remove('open');
    if (onKey) document.removeEventListener('keydown', onKey);
    focusReturn?.focus();
    function finish() { el.classList.remove('visible'); unlockBodyScroll(); afterClose?.(); }
    // Reduced motion disables the fade transition entirely (shared.css), so
    // transitionend never fires — finish immediately instead of making those
    // users wait out the 500 ms fallback with body scroll still locked.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const t = setTimeout(finish, 500);
    el.addEventListener('transitionend', () => { clearTimeout(t); finish(); }, { once: true });
}

/** Remove the pushed history entry when the overlay is closed by a button. */
export function _clearOverlayHistory() {
    if (_overlayHistoryPushed) {
        _overlayHistoryPushed = false;
        _backHandler = null;
        history.back();
    }
}

window.addEventListener('popstate', () => {
    if (!_overlayHistoryPushed) return;
    _overlayHistoryPushed = false;
    const fn = _backHandler;
    _backHandler = null;
    fn?.();
});

/**
 * Trap keyboard focus inside a lightbox container (accessibility).
 * Call from the container's keydown handler — no-op if key is not Tab.
 * @param {Element|null} container
 * @param {KeyboardEvent} e
 */
export function trapFocus(container, e) {
    if (e.key !== 'Tab' || !container) return;
    const els = [...container.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
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
 * @param {Element}  opts.overlay        - The .lb-overlay element
 * @param {Element}  [opts.content]      - The .lb-content card (focus-trap boundary; defaults to overlay)
 * @param {Element}  [opts.closeBtn]     - The .lb-close button (also the default initial focus)
 * @param {Element|Function} [opts.initialFocus] - Element (or fn returning one) to focus on open instead of closeBtn
 * @param {Function} [opts.onOpen]       - Called with open()'s arguments before the overlay is shown
 * @param {Function} [opts.onClose]      - Called as the overlay starts closing (any close path)
 * @returns {{ open: Function, close: Function }}
 */
export function createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose } = {}) {
    let _focusReturn = null;

    function onKey(e) {
        if (e.key === 'Escape') { close(); return; }
        trapFocus(content ?? overlay, e);
    }

    function open(...args) {
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
        dismissOverlay(overlay, { onKey, focusReturn: _focusReturn });
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

    function toggle() {
        const open = body.classList.toggle('open');
        if (chevron && chevron !== body) chevron.classList.toggle('open', open);
        header.setAttribute('aria-expanded', String(open));
        onToggle?.(open);
    }

    // Initialise aria-expanded from the current DOM state
    header.setAttribute('aria-expanded', String(body.classList.contains('open')));

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
}
