// @ts-check
/**
 * overlay-panel-scroll.js — A panel that scrolls: its "more below" fade (`watchScrollFade`) and its ✕ kept
 * in reach as the words move under it (`pinCloseButton`). Every createLightbox panel wears both, and so do
 * the nav drawer's body and its two lightboxes (nav-panel.js), which hand-roll their lifecycle.
 *
 * Moved out of overlay.js (25 Nov 2026), which re-exports both, so every caller imports them from there as
 * it always has. Best-effort decoration: no module state, no imports, and with no layout API each does
 * nothing. shared.css holds the classes they toggle (`.has-more`, `.is-scrolled`, `.lb-close--pinned`).
 */

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
        // Scrolled at all: a pinned ✕ takes its disc, so the words passing beneath it do not show
        // through the glyph (`pinCloseButton` below; shared.css → THE ✕ STAYS).
        panel.classList.toggle('is-scrolled', panel.scrollTop > 0);
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
 * Keep a panel's ✕ in reach while the panel scrolls (lightbox review R1-5, 22 Nov 2026).
 *
 * The shared `.lb-close` is placed ABSOLUTELY inside the panel that scrolls, so it scrolled away with
 * the words: a long About or notice on a small phone, or at a large text size, left the reader with no
 * close control on screen — and iOS has no system Back. shared.css's `.lb-close--pinned` makes it
 * sticky instead. This measures where the shared rule put it — its `top` and `right` less the panel's
 * own padding, and what cancels its height (and a flex gap) — so the pinned ✕ sits on exactly the same
 * spot at rest, whatever the panel's padding is on this page at this window size, and the content
 * does not move. Measured here rather than restated per panel in CSS, where a copy of each padding
 * would drift from the panel the first time either changed.
 *
 * Re-measured on every open (a window or text size may have changed since). Left alone, and so as it
 * always was: a ✕ that is not a direct child of the panel (the Tips' and the picker's sit in a sticky
 * top of their own), one a page has placed differently (`position: static` in a full-bleed header),
 * a panel that does not scroll, and a flex ROW or grid panel, where an in-flow ✕ would take a column.
 * Best-effort decoration, as `watchScrollFade` is: with no layout API it does nothing.
 * @param {Element|null|undefined} panel the scrolling `.lb-content`
 */
export function pinCloseButton(panel) {
    const btn = /** @type {HTMLElement|null} */ (panel?.querySelector?.(':scope > .lb-close') ?? null);
    if (!panel || !btn || typeof getComputedStyle !== 'function') return;
    btn.classList.remove('lb-close--pinned');   // measure where the SHARED rule places it
    const b = getComputedStyle(btn), p = getComputedStyle(panel);
    const flex = /flex/.test(p.display);
    if (b.position !== 'absolute' || !/auto|scroll/.test(p.overflowY)
        || (flex && !p.flexDirection.startsWith('column')) || /grid/.test(p.display)) return;
    const px = (/** @type {string} */ v) => parseFloat(v) || 0;
    const y = px(b.top) - px(p.paddingTop);
    const x = px(b.right) - px(p.paddingRight);
    const gap = flex ? px(p.rowGap) : 0;
    btn.style.setProperty('--lb-pin-y', `${y}px`);
    btn.style.setProperty('--lb-pin-x', `${x}px`);
    btn.style.setProperty('--lb-pin-after', `${-(y + btn.offsetHeight + gap)}px`);
    btn.classList.add('lb-close--pinned');
}
