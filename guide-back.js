/**
 * guide-back.js — points a guide's back links at the page you actually came FROM (v18.84).
 *
 * Loaded as a CLASSIC script by all five guide pages (the guides load no shared.css, and only
 * guide-print.js as a module — see .claude/rules/guide-pages.md). No exports; it runs once on load.
 *
 * Why: each guide's ← is a hardcoded destination (the Staff, Railcard, Rangers and FIP guides → the
 * calendar, paycalc-guide → the pay calculator). That was harmless while guides opened in a new tab,
 * because the page you left survived in the original tab. Since v18.81 they navigate in the SAME tab
 * (the new-tab open was wrapping every guide in Android's Chrome Custom Tab / iOS's in-app Safari —
 * the "extra header at the top of all the guides" staff report), so opening the Railcard Guide from
 * Admin and tapping ← dumped you on the Calendar instead of back on Admin. In an installed iOS PWA
 * that arrow is the only back control there is.
 *
 * How: nav-panel.js appends `?from=<page>` when it opens a guide; this rewrites the arrow to match.
 * The value is checked against an ALLOWLIST of the app's own pages, never used as a raw URL, so a
 * crafted `?from=` can't turn the back arrow into an off-site link. No `from` (a direct visit, a
 * bookmark, a shared link) leaves the authored href exactly as written.
 *
 * THE FOOTER LINK FOLLOWS IT TOO (owner, Nov 2026). The Railcard, Rangers and FIP guides end with a
 * "← Back to calendar" link (`.guide-back-link`), and it ignored `?from=` while the header's ← obeyed
 * it — one page offering two different ways back. It now goes where the arrow goes and names that
 * page the way the arrow's label does ("← Back to Admin"); with no or an unknown `from` it stays
 * "← Back to calendar" to `./`, as authored.
 *
 * GOING BACK IS GOING BACK, WHERE THE PAGE BEFORE IS THE ONE NAMED (Nov 2026). A link to Admin is a
 * NEW visit to Admin, pushed on top of the guide. The drawer opens a guide by REPLACING its own
 * history entry (nav-panel.js), so after Admin → drawer → guide → ← the history read Admin, guide,
 * Admin — and the phone's Back, from Admin, landed on the guide again. So when the page this guide
 * was opened from IS the destination — same origin, same path, read from `document.referrer` — the
 * back links call `history.back()` instead, which returns to that entry and leaves nothing behind.
 * The href stays as the fallback, and is followed whenever that is not certain: no referrer, another
 * origin, a tab with no history, or a reader who has since moved within the guide (the FIP guide's
 * country links push a `#fragment` entry each, and `history.back()` from one of them would only go
 * back a country). The entry the guide LOADED on is marked in `history.state`, so the links know.
 *
 * ⚠ THE ALLOWLIST IS WRITTEN BY `npm run generate:copies` (26 Nov 2026), from scripts/app-pages.mjs
 * and the drawer's page names. It was hand-kept, and it fell a page behind (v22.48, external review):
 * `overtime.html` sent `?from=overtime.html` from the day it shipped, this file did not know the value,
 * and the arrow silently dropped a reviewer on the calendar. Nothing errors on an unrecognised `from`,
 * which is right for a hostile value and is exactly what hid a legitimate one. It stays a FIXED list in
 * this file, because the allowlist is what stops `?from=https://elsewhere` becoming the back arrow;
 * generated, it simply cannot miss a page. Never edit its rows by hand.
 */
(function () {
    'use strict';

    /** The app pages that can open a guide from the nav drawer → the label the arrow and the footer
     *  link both carry. The Calendar is "calendar" in both, as the app names it everywhere else.
     *  @type {Record<string, { href: string, label: string }>} */
    var DESTINATIONS = {
        'index.html':      { href: './',                label: 'Back to calendar' },
        'admin.html':      { href: './admin.html',      label: 'Back to Admin' },
        'paycalc.html':    { href: './paycalc.html',    label: 'Back to Pay Calculator' },
        'operations.html': { href: './operations.html', label: 'Back to Operations' },
        'settings.html':   { href: './settings.html',   label: 'Back to Settings' },
        'link-designer.html': { href: './link-designer.html', label: 'Back to Link Designer' },
        'overtime.html':   { href: './overtime.html',   label: 'Back to Overtime' },
        'trains.html':     { href: './trains.html',     label: 'Back to Trains' },
        'newlink.html':    { href: './newlink.html',    label: 'Back to New CEA link' },
    };

    var back = document.querySelector('.btn-back');
    if (!back) return;

    var from;
    try {
        from = new URLSearchParams(window.location.search).get('from') || '';
    } catch (_e) {
        return;   // no URLSearchParams / malformed query — keep the authored hrefs
    }

    var dest = Object.prototype.hasOwnProperty.call(DESTINATIONS, from) ? DESTINATIONS[from] : null;
    if (!dest) return;

    back.setAttribute('href', dest.href);
    back.setAttribute('aria-label', dest.label);
    var footer = document.querySelector('.guide-back-link');
    if (footer) {
        footer.setAttribute('href', dest.href);
        footer.textContent = '← ' + dest.label;
    }

    /** A page's path with any trailing `index.html` dropped: `/` and `/index.html` are one page. @param {string} p */
    function pagePath(p) { return p.replace(/\/index\.html$/, '/'); }

    var MARK = 'mybGuideLanding';
    var cameFromDest;
    try {
        var ref = document.referrer ? new URL(document.referrer) : null;
        var target = new URL(dest.href, window.location.href);
        cameFromDest = !!ref && ref.origin === window.location.origin
            && pagePath(ref.pathname) === pagePath(target.pathname)
            && window.history.length > 1;
        if (cameFromDest) {
            var state = window.history.state;
            var marked = (state && typeof state === 'object') ? Object.assign({}, state) : {};
            marked[MARK] = true;
            window.history.replaceState(marked, '');
        }
    } catch (_e) {
        cameFromDest = false;   // a URL or history this engine will not read — the hrefs stand
    }
    if (!cameFromDest) return;

    /** Go back to the page before, when that is certainly the destination; else follow the href. @param {MouseEvent} e */
    function goBack(e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var state = window.history.state;
        if (!state || state[MARK] !== true) return;   // moved within the guide since it loaded
        e.preventDefault();
        window.history.back();
    }
    back.addEventListener('click', /** @type {EventListener} */ (goBack));
    if (footer) footer.addEventListener('click', /** @type {EventListener} */ (goBack));
}());
