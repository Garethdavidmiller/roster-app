/**
 * guide-back.js — points a guide's ← back arrow at the page you actually came FROM (v18.84).
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
