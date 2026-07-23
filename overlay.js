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

window.addEventListener('popstate', () => {
    // Absorb the echo from our own button-initiated history.back() (or an external owner's — see
    // suppressNextPop). Checked FIRST so a claimed/suppressed pop can never leak the counter.
    if (_suppressPops > 0) { _suppressPops--; return; }
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
        // Idempotent: a second open() while already open would push a duplicate lockBodyScroll
        // (depth counter → the lock never releases on close) and re-run onOpen. Reachable via a
        // fast double-tap on a trigger during the opener's slide-out (e.g. the nav-drawer logo).
        if (overlay.classList.contains('visible')) return;
        _focusReturn = document.activeElement;
        onOpen?.(...args);
        lockBodyScroll();
        _pushOverlayState(close);
        overlay.classList.add('visible');
        requestAnimationFrame(() => {
            overlay.classList.add('open');
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
        // A caller's onClose must NEVER strand the overlay: if it threw, dismissOverlay below would
        // not run, leaving the overlay .open/.visible, body scroll locked, and the pushed Back-history
        // entry orphaned (a later Android Back would then pop the wrong overlay). Isolate it.
        try { onClose?.(); } catch (e) { console.error('[overlay] onClose threw:', e); }
        // Pass `close` as backHandler so a double-tap on the ✕ (or backdrop) during the fade
        // drops only THIS lightbox's entry, never the overlay beneath it.
        dismissOverlay(overlay, { onKey: /** @type {EventListener} */ (onKey), focusReturn: /** @type {HTMLElement|undefined} */ (_focusReturn ?? undefined), backHandler: close });
        _focusReturn = null;
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
 * @param {any}     o.resultOnCancel       - value to resolve on cancel/dismiss
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
        let result = o.resultOnCancel;

        const lb = createLightbox({
            overlay,
            content,
            closeBtn: cancelBtn,                       // Cancel = the close control (also Esc/backdrop/Back)
            initialFocus: () => input ?? confirmBtn,
            onClose: () => {
                if (!settled) { settled = true; resolve(result); }
                // Remove the dynamic node AFTER the close transition (not synchronously here): a
                // node detached now would suppress dismissOverlay's transitionend, forcing its 500ms
                // fallback AND skipping the fade-out every other lightbox shows. 500ms clears the
                // 0.2s fade with margin; reduced-motion finishes sooner and the node just lingers
                // invisibly until this fires.
                setTimeout(() => overlay.remove(), 500);
            },
        });

        // try/finally so a throwing resultOnConfirm can never leave the dialog open and the Promise
        // pending (today both resolvers are total, but this keeps the contract robust).
        const confirmAndClose = () => { try { result = o.resultOnConfirm(input); } finally { lb.close(); } };
        confirmBtn.addEventListener('click', confirmAndClose);
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
 * Resolves true if the user confirms; false on Cancel / backdrop / Escape / Android Back.
 *
 * ASYNC by nature — it cannot stand in for confirm() in a SYNCHRONOUS context that must decide
 * `preventDefault()` inline (a capture-phase navigation guard) or in a `beforeunload` handler.
 * For a navigation guard, intercept-always then navigate when the returned Promise resolves true;
 * beforeunload must keep the native dialog.
 *
 * @param {object} opts
 * @param {string}  opts.message
 * @param {string} [opts.title]
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.danger=false]  - style the confirm button as destructive (e.g. Delete)
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ message, title, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    return _openDialog({
        message, title, confirmLabel, cancelLabel, danger,
        withInput: false,
        resultOnConfirm: () => true,
        resultOnCancel: false,
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
    });
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
    if (!header || !body) return;

    // The element whose `.open` class drives the chevron/arrow rotation — unchanged: a distinct
    // chevron span for most cards; the header itself for paycalc's cards (which pass
    // chevronId === headerId and rotate their arrow off the header's open state).
    const stateEl = chevronId ? document.getElementById(chevronId) : null;

    // The FOCUSABLE toggle control. A card header often contains a Tips/Help <button>; making the
    // whole header the toggle (role="button") would nest one interactive control inside another —
    // the WCAG "nested-interactive" failure. So prefer a dedicated chevron/arrow element as the
    // control and leave the header non-interactive. Fall back to the header ONLY when there is no
    // separate affordance at all (preserves the original behaviour for headers with no chevron).
    let control = (stateEl && stateEl !== header) ? stateEl : null;
    if (!control && typeof header.querySelector === 'function') {
        control = /** @type {HTMLElement|null} */ (header.querySelector('.collapse-chevron, .card-toggle-arrow'));
    }
    const headerIsControl = !control;
    if (headerIsControl) control = header;
    const ctrl = /** @type {HTMLElement} */ (control);

    // ARIA + keyboard reachability on the CONTROL (never on a header that wraps another control).
    const ctag = ctrl.tagName;
    if (ctag !== 'BUTTON' && ctag !== 'A') {
        ctrl.setAttribute('role', 'button');
        if (!ctrl.hasAttribute('tabindex')) ctrl.setAttribute('tabindex', '0');
    }
    if (!ctrl.hasAttribute('aria-controls')) ctrl.setAttribute('aria-controls', bodyId);
    // Give a bare chevron/arrow an accessible name from the card title ("Toggle Work Email").
    // Prefer a heading, but FALL BACK to the header itself — some sub-cards title with a <span>, not
    // an h* (e.g. admin's "Recorded Annual Leave dates" booked-dates cards), and without this fallback
    // their chevron's only name would be the "▾" glyph. Clone + strip nested buttons (the Tips/Help
    // "?"), the chevron/arrow, hints, and decorative aria-hidden nodes so the name is JUST the title.
    if (!headerIsControl && !ctrl.hasAttribute('aria-label') && typeof header.querySelector === 'function') {
        const src = header.querySelector('h1, h2, h3, h4') || header;
        let name = '';
        if (typeof src.cloneNode === 'function') {
            const clone = /** @type {HTMLElement} */ (src.cloneNode(true));
            clone.querySelectorAll('button, a, .collapse-chevron, .card-toggle-arrow, .hint, [aria-hidden="true"]')
                .forEach(n => n.remove());
            name = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (name) ctrl.setAttribute('aria-label', `Toggle ${name}`);
    }

    function toggle() {
        const open = /** @type {HTMLElement} */ (body).classList.toggle('open');
        if (stateEl && stateEl !== body) stateEl.classList.toggle('open', open);
        ctrl.setAttribute('aria-expanded', String(open));
        onToggle?.(open);
    }

    // Initialise aria-expanded from the current DOM state
    ctrl.setAttribute('aria-expanded', String(body.classList.contains('open')));

    ctrl.addEventListener('click', e => { /** @type {any} */ (e).stopPropagation?.(); toggle(); });
    ctrl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    // Mouse convenience: clicking anywhere on the header toggles too — EXCEPT on a nested
    // interactive control (the Tips/Help button, or the chevron itself), which handle their own
    // clicks. Keyboard/screen-reader users operate the chevron/arrow control above. Skipped when the
    // header IS the control (no separate chevron) — it already has the click handler.
    if (!headerIsControl) {
        header.addEventListener('click', e => {
            const t = /** @type {any} */ (e).target;
            if (t && typeof t.closest === 'function' &&
                t.closest('button, a, [role="button"], input, select, textarea')) return;
            toggle();
        });
    }
}
