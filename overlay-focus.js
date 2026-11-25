// @ts-check
/**
 * overlay-focus.js — Where keyboard focus may go while an overlay is open: the Tab trap (`trapFocus`), the
 * guard for focus moves no key reports (`_guardFocus`), and the paint-order helpers the guard and the
 * dialogs share (`_zOf`, `_highestOpenLayer`).
 *
 * Moved out of overlay.js (25 Nov 2026), which re-exports `trapFocus`; the underscored helpers are the
 * overlay layer's own, imported only by overlay.js (`createLightbox` and `_openDialog`). No module state
 * and no imports: which overlay is TOPMOST is the history stack's answer (overlay-history.js), handed to
 * `_guardFocus` as `isTop` rather than read here, so this file needs nothing from it.
 */

/**
 * What Tab can reach in `container` (enabled, rendered, in the Tab order) — one list for the trap and
 * the focus guard. A NEGATIVE tabindex takes a control out of the Tab order whatever its tag, and the
 * trap's two ends must be stops Tab can land on: counted, the date picker's last day, the sign-in
 * card's hidden username field and the 1px select behind a picker trigger each became an end that
 * focus never reached, so the trap never wrapped and Tab walked out of the dialog.
 * @param {Element} container
 */
function _tabStops(container) {
    return /** @type {HTMLElement[]} */ ([...container.querySelectorAll('button,a[href],input,select,textarea,[contenteditable],[tabindex]')]).filter(el =>
        !/** @type {any} */ (el).disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null
        && !(Number.parseInt(el.getAttribute('tabindex') ?? '', 10) < 0));
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
// `_isTopOverlay` orders the stack, and any other open `aria-modal` surface that paints above (by
// z-index, then document order) stands the guard down. That is meant for the surfaces OFF the stack —
// the sign-in card a lost session mounts over a dialog, the password-force card: fighting those would
// leave a member unable to type a password. Nothing here asks whether a surface is on the stack, so one
// that is stands it down too. That happens only where paint and stack disagree (the document viewer
// under the Huddle until 10 Nov 2026), and focus is then left where the reader can see it.
/** An element's layer as it paints: its computed z-index, `auto` as 0. @param {Element} el */
export const _zOf = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
/** Does another open modal surface paint above `overlay` — in practice one off the stack (above)? (A shut drawer is aria-hidden; a shut lightbox has no boxes.) @param {Element} overlay */
function _unstackedSurfaceAbove(overlay) {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(el => {
        if (el === overlay || el.contains(overlay) || overlay.contains(el)) return false;
        if (el.getAttribute('aria-hidden') === 'true' || !el.getClientRects().length) return false;
        return _zOf(el) > _zOf(overlay) || (_zOf(el) === _zOf(overlay) && !!(overlay.compareDocumentPosition(el) & 4));   // 4: FOLLOWING
    });
}
/**
 * The highest layer on screen: the open lightboxes and sheets, and the modal surfaces off the stack
 * (the sign-in and password cards) — shown, and not aria-hidden, as above. 0 when nothing is up.
 */
export function _highestOpenLayer() {
    let top = 0;
    for (const el of Array.from(document.querySelectorAll('.lb-overlay, [aria-modal="true"]'))) {
        if (el.getAttribute('aria-hidden') === 'true' || !el.getClientRects().length) continue;
        top = Math.max(top, _zOf(el));
    }
    return top;
}
/** Pull focus landing outside `overlay` back in. Returns the detach. @param {Element} overlay @param {Element} panel @param {() => boolean} isTop */
export function _guardFocus(overlay, panel, isTop) {
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
