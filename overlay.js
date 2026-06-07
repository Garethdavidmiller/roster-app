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
 * Wire up a collapsible card header: clicking the header toggles .open on
 * the body and (optionally) the chevron. Safe to call before the page is
 * fully loaded — no-op if the header or body element is not found.
 * @param {string} headerId   - id of the clickable header element
 * @param {string} bodyId     - id of the collapsible body element
 * @param {string} [chevronId] - optional id of the ▾ chevron element
 */
export function initCardCollapse(headerId, bodyId, chevronId) {
    const header  = document.getElementById(headerId);
    const body    = document.getElementById(bodyId);
    const chevron = chevronId ? document.getElementById(chevronId) : null;
    if (!header || !body) return;
    header.addEventListener('click', () => {
        const open = body.classList.toggle('open');
        if (chevron) chevron.classList.toggle('open', open);
    });
}
