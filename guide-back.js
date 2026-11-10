/**
 * guide-back.js — points a guide's ← back arrow at the page you actually came FROM (v18.84), and on
 * a guide with no chip bar lands an anchor below the sticky header (the second block, at the end).
 *
 * Loaded as a CLASSIC script by all five guide pages (the guides have no module graph and no
 * shared.css — see .claude/rules/guide-pages.md). No exports; it runs once on load.
 *
 * Why: each guide's ← is a hardcoded destination (guide/railcard/fip → the calendar,
 * paycalc-guide → the pay calculator). That was harmless while guides opened in a new tab, because
 * the page you left survived in the original tab. Since v18.81 they navigate in the SAME tab (the
 * new-tab open was wrapping every guide in Android's Chrome Custom Tab / iOS's in-app Safari — the
 * "extra header at the top of all the guides" staff report), so opening the Railcard Guide from
 * Admin and tapping ← dumped you on the Calendar instead of back on Admin. The browser/hardware
 * Back button was always correct; it is the visible arrow that went wrong — and in an installed iOS
 * PWA that arrow is the only back control there is.
 *
 * How: nav-panel.js appends `?from=<page>` when it opens a guide; this rewrites the arrow to match.
 * The value is checked against an ALLOWLIST of the app's own pages, never used as a raw URL, so a
 * crafted `?from=` can't turn the back arrow into an off-site link. No `from` (a direct visit, a
 * bookmark, a shared link) leaves the hardcoded href exactly as authored.
 *
 * ⚠ THE ALLOWLIST IS A HAND-KEPT LIST OF PAGES, AND IT FELL BEHIND ONE (v22.48, external review).
 * `overtime.html` arrived with the drawer like every other page, so it sent `?from=overtime.html`
 * from the day it shipped — and this file did not know the value, so the arrow silently kept its
 * authored default and dropped a reviewer on the calendar. Nothing errors on an unrecognised
 * `from`, which is right for a hostile value and is exactly what hid a legitimate one. There is no
 * general fix available here: the allowlist is what stops `?from=https://elsewhere` becoming the
 * back arrow, so it cannot be derived from the query. It is instead pinned from OUTSIDE, by
 * `page-contract-parity.test.mjs`, which enumerates the app pages from the filesystem — so the next
 * page to arrive fails there rather than losing its readers their way back.
 */
(function () {
    'use strict';

    /** The app pages that can open a guide from the nav drawer → the arrow's label for each.
     *  @type {Record<string, { href: string, label: string }>} */
    var DESTINATIONS = {
        'index.html':      { href: './',                label: 'Back to roster' },
        'admin.html':      { href: './admin.html',      label: 'Back to Admin' },
        'paycalc.html':    { href: './paycalc.html',    label: 'Back to Pay Calculator' },
        'operations.html': { href: './operations.html', label: 'Back to Operations' },
        'settings.html':   { href: './settings.html',   label: 'Back to Settings' },
        'links.html':      { href: './links.html',      label: 'Back to Links' },
        'overtime.html':   { href: './overtime.html',   label: 'Back to Overtime' },
        'trains.html':     { href: './trains.html',     label: 'Back to Trains' },
        'newlink.html':    { href: './newlink.html',    label: 'Back to New link' },
    };

    var back = document.querySelector('.btn-back');
    if (!back) return;

    var from;
    try {
        from = new URLSearchParams(window.location.search).get('from') || '';
    } catch (_e) {
        return;   // no URLSearchParams / malformed query — keep the authored href
    }

    var dest = Object.prototype.hasOwnProperty.call(DESTINATIONS, from) ? DESTINATIONS[from] : null;
    if (!dest) return;

    back.setAttribute('href', dest.href);
    back.setAttribute('aria-label', dest.label);
}());

/*
 * ── AN ANCHOR LANDS BELOW THE HEADER, ON A GUIDE WITH NO CHIP BAR (whole-app fix, 10 Nov 2026) ──
 * The Staff and Pay Calculator guides have only the sticky header, and no stylesheet can know its
 * height: it follows how the title wraps. With the phone's text one step up, a search result opened
 * its heading 25px under the header at 375px, and 60px at 1.3× (guide-shell.css's fallback margin
 * holds at the default text size only). So the header is measured here, as the chip-bar guides
 * measure theirs, and every id in <main> keeps the header's height + 12px clear of it.
 *
 * The landing rules are railcard-guide.js's, whose comment says why the browser's own landing is not
 * enough: while the page is still LANDING on a #fragment — until it has loaded and measured with its
 * fonts, or the reader touches, clicks, wheels or types — each measurement moves a target the header
 * covers back out from under it. A reload or Back/Forward keeps the reader's restored position.
 *
 * A guide WITH a chip bar measures its whole sticky stack (header + bar) in its own script, so this
 * leaves it alone.
 */
(function () {
    'use strict';

    if (document.querySelector('.chip-bar')) return;
    var header = /** @type {HTMLElement|null} */ (document.querySelector('.page-header'));
    if (!header) return;
    var GAP = 12;   // the room the stylesheet's fallback leaves too: 78px of header + 12 = its 90px

    var landingId = '';
    var nav = /** @type {PerformanceNavigationTiming|undefined} */ (
        window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : undefined);
    if (!nav || nav.type === 'navigate') {
        try { landingId = decodeURIComponent(location.hash.slice(1)); } catch (_e) { landingId = ''; }
    }
    function endLanding() { landingId = ''; }
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (type) {
        window.addEventListener(type, endLanding, { capture: true, passive: true });
    });
    window.addEventListener('hashchange', endLanding);

    /** Give every id in <main> the header's measured clearance, and re-land a deep link it covers. */
    function measure() {
        var clear = /** @type {HTMLElement} */ (header).offsetHeight + GAP;
        document.querySelectorAll('main [id]').forEach(function (el) {
            /** @type {HTMLElement} */ (el).style.scrollMarginTop = clear + 'px';
        });
        if (!landingId) return;
        var target = document.getElementById(landingId);
        if (!target) { landingId = ''; return; }
        // Only a target that STARTS under the header moves: one the page cannot scroll to the top (near
        // its end) sits lower and stays, and so does one already scrolled past.
        var top = target.getBoundingClientRect().top;
        if (top >= 0 && top < clear - 1) target.scrollIntoView({ block: 'start' });
    }

    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(measure);
    // The landing ends with one last measurement once the page has loaded AND its fonts are ready.
    Promise.all([
        fontsReady,
        document.readyState === 'complete' ? Promise.resolve()
            : new Promise(function (resolve) { window.addEventListener('load', resolve, { once: true }); }),
    ]).then(function () {
        requestAnimationFrame(function () { measure(); endLanding(); });
    });
    // …and follows the header after that: a late font swap, a change of text size, a rotation.
    if (typeof ResizeObserver === 'function') {
        var queued = false;
        new ResizeObserver(function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () { queued = false; measure(); });
        }).observe(header);
    }
}());
