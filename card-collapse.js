// @ts-check
/**
 * card-collapse.js — a card's collapsible header, and the deep link that opens a collapsed card by name.
 *
 * Moved out of overlay.js (Nov 2026), whose subject is overlays: a card is not one, and both functions
 * here are about cards. overlay.js re-exports them, so every page's `import … from './overlay.js'`
 * is unchanged. No imports, and no browser global is read at load — only inside a call — so the module
 * loads in Node, where `card-collapse.test.mjs` drives the deep link and `overlay.test.mjs` the toggle.
 */

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
    // A no-op handle rather than `undefined`, so a caller that wants to open the card later does
    // not have to guard every call site against a card that was not on the page.
    if (!header || !body) return { setOpen() {} };

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

    /**
     * The ONE place a card's open state is written (v22.37). `toggle()` and the returned
     * `setOpen` both come through here, because Settings now decides a card's state AFTER the
     * card is wired — its data arrives asynchronously — and a second copy of these three lines is
     * how `aria-expanded` ends up disagreeing with the `.open` class it is meant to describe.
     * @param {boolean} open
     */
    function apply(open) {
        /** @type {HTMLElement} */ (body).classList.toggle('open', open);
        if (stateEl && stateEl !== body) stateEl.classList.toggle('open', open);
        ctrl.setAttribute('aria-expanded', String(open));
        onToggle?.(open);
    }

    function toggle() {
        apply(!(/** @type {HTMLElement} */ (body).classList.contains('open')));
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

    // Lets a caller set the state directly — Settings opens a card once it learns the setting
    // needs attention, which is after this ran. Same code path as a tap.
    return { setOpen: apply };
}

/**
 * How long a card deep link keeps WATCHING for the page to move under it.
 *
 * Not a delay before acting — the corrections happen the moment the page grows (see
 * `openCardNamedByHash` below); this is only when we stop listening. Watching costs nothing once the
 * page has settled, because a settled page fires no resizes, so this is sized for the slowest device
 * rather than the machine it was written on: growth was still arriving ~3s in on a desktop WebKit.
 *
 * ── "STOP WHEN THE PAGE GOES QUIET" WAS TRIED HERE, AND IT IS WORSE (v21.50) ────────────────────
 *
 * It is the obvious refinement — settling is a property of the page, so measure it from the last
 * thing that moved rather than from a clock — and it FAILED a third of the time where this passed
 * 12/12. The page does not grow continuously: it grows in BURSTS, and the gap between the first
 * layout and the big one is ~670ms, longer than any quiet window short enough to be worth having.
 * So the watch ended inside the gap, moments before the growth it existed for. Measured, not
 * reasoned about — and recorded because it is a natural idea to have twice.
 */
const DEEP_LINK_WATCH_MS = 4000;

/**
 * Open a collapsed card when the page's URL fragment names it (`#<cardId>`), and keep it at the top
 * of the screen while the page finishes growing. Call it once the card's collapse is wired
 * (`initCardCollapse`): it opens the card through the same header click a tap would make.
 *
 * Written for the Pay Calculator's `#payTransferCard` (Settings links there, v21.50) and shared at
 * v24.86, when the Calendar's Year to Date notice began linking to `#payslipCard` — a second copy
 * of the correction below would have been the second place to forget why it is not a timeout. The
 * fragment IS the card's id, so with no script at all the browser's own jump still lands on its
 * header.
 *
 * ── THE PAGE IS NOT FINISHED WHEN THIS RUNS, AND THAT IS THE WHOLE PROBLEM ──────────────────────
 *
 * Measured on WebKit at 390×844: the document is ~2,230px tall when the first scroll runs and
 * ~4,750px a second later — the period band, the roster hint bar and the result card all arrive
 * late. So that scroll hits the bottom of a page too short to put the card at the top and leaves it
 * at y=1578; only a LATER scroll can finish the job.
 *
 * Until v21.50 the later scroll was a single `setTimeout(…, 400)`, and a fixed delay is a RACE
 * against a growth whose timing nothing controls: land after the growth and the card reaches y=45,
 * land before it and the correction is a no-op against a page that has not grown yet — after which
 * nothing tries again and the card sits at 1578 for good. Sampled every frame for three seconds, it
 * lost that race about a third of the time in a real browser (and every time on CI's slower runner).
 *
 * So the correction follows the GROWTH instead of guessing when it will end. A ResizeObserver on
 * <body> fires exactly when the layout that moves the card changes, however slow the device, and
 * costs nothing on a page that has settled. Repeated corrections are free: scrolling to a card
 * already at the top is a no-op.
 *
 * The cancel signal is a real GESTURE, not a scrollY delta. A delta guard looks obvious and does not
 * work here: growing content above the card makes the browser's own scroll anchoring move scrollY,
 * so the guard reads that as "the member scrolled" and suppresses the very correction it exists to
 * allow. (Measured — the delta version left it at y=681.) Yanking the page under someone already
 * reading is worse than landing low, so the first gesture stops the corrections for good — as does
 * the end of the watch window.
 *
 * @param {string} cardId    the card's element id, and the fragment that names it
 * @param {string} bodyId    its collapsible body
 * @param {string} toggleId  the header `initCardCollapse` wired
 * @returns {boolean} whether the fragment named this card (and it was on the page)
 */
export function openCardNamedByHash(cardId, bodyId, toggleId) {
    if (window.location.hash !== `#${cardId}`) return false;
    const card = document.getElementById(cardId);
    if (!card) return false;
    const body = document.getElementById(bodyId);
    if (body && !body.classList.contains('open')) {
        document.getElementById(toggleId)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    card.scrollIntoView({ block: 'start' });

    let userMoved = false;
    /** @type {ResizeObserver | null} */ let observer = null;
    /** @type {any} */ let watch = null;
    const gestures = ['wheel', 'touchstart', 'keydown'];
    const stop = () => {
        gestures.forEach(e => window.removeEventListener(e, mark));
        observer?.disconnect();
        observer = null;
        clearTimeout(watch);
    };
    function mark() { userMoved = true; stop(); }
    const correct = () => { if (!userMoved) card.scrollIntoView({ block: 'start' }); };

    gestures.forEach(e => window.addEventListener(e, mark, { passive: true, once: true }));
    watch = setTimeout(stop, DEEP_LINK_WATCH_MS);
    if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(correct);
        observer.observe(document.body);
    } else {
        // No observer: the pre-v21.50 single retry. It is what those devices already had, and it is
        // still better than never correcting at all.
        setTimeout(correct, 400);
    }
    return true;
}
