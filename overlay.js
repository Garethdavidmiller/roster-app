/**
 * overlay.js — Shared scroll lock and Android Back button overlay helpers.
 *
 * Imported by app.js, admin-app.js, paycalc.js, operations-app.js,
 * settings-app.js, and nav-panel.js.
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
