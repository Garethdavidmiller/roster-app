// @ts-check
/**
 * about-lightbox.js — Shared About (#iconLightbox) panel for all six app pages.
 *
 * One implementation of the version display, service-worker update status,
 * pre-filled bug-report mailto link, and optional print button that was
 * previously copy-pasted into every page coordinator (and had drifted —
 * missing focus traps, missing initial focus on some pages).
 *
 * Owns: open/close lifecycle (via createLightbox), SW status refresh, bug link.
 * Does NOT own: the header logo / nav-drawer logo that opens it — each page
 *   wires its own trigger to the returned open() (pages differ: the calendar
 *   header logo opens About; sub-page header logos navigate back to the
 *   calendar and only the drawer logo opens About).
 *
 * @module about-lightbox
 */

import { APP_VERSION, CONFIG } from './roster-data.js';
import { createLightbox } from './overlay.js';

/**
 * Wire up the page's #iconLightbox. Safe no-op (returns null) if the page
 * has no #iconLightbox.
 *
 * @param {object} [opts]
 * @param {string}   [opts.appLabel='MYB Roster'] - App name used in the bug-report subject/body
 * @param {string}   [opts.bugLinkId='bugReportLink'] - id of the bug-report <a> in this page's markup
 * @param {Function} [opts.getUserName] - Returns the logged-in user's name for the bug report;
 *                                        omit on pages without a session (no User line is added)
 * @param {Function} [opts.onOpen]      - Page-specific extra work on open (e.g. calendar's
 *                                        team-view content swap), run before the panel shows
 * @param {Function} [opts.printFn]     - Replaces window.print() for the optional
 *                                        #lightboxPrintBtn (e.g. calendar's landscape team print)
 * @returns {{ open: () => void, close: () => void }|null}
 */
export function initAboutLightbox({ appLabel = 'MYB Roster', bugLinkId = 'bugReportLink', getUserName, onOpen, printFn } = {}) {
    const lightbox = document.getElementById('iconLightbox');
    if (!lightbox) return null;
    const content  = document.getElementById('iconLightboxContent');
    const closeBtn = document.getElementById('iconLightboxClose');
    const statusEl = document.getElementById('lightboxUpdateStatus');
    const bugLink  = /** @type {HTMLAnchorElement|null} */ (document.getElementById(bugLinkId));

    const versionEl = document.getElementById('lightboxVersion');
    if (versionEl) versionEl.textContent = APP_VERSION;

    /** Refresh the "✓ Up to date / ↻ Update available" line from the SW registration. */
    function refreshUpdateStatus() {
        if (!statusEl) return;
        statusEl.textContent = '';
        statusEl.className = 'lightbox-status';
        (navigator.serviceWorker?.getRegistration() ?? Promise.resolve(null))
            .then(reg => {
                statusEl.textContent = reg?.waiting ? '↻ Update available — close and reopen to refresh' : '✓ Up to date';
                statusEl.className   = reg?.waiting ? 'lightbox-status needs-update' : 'lightbox-status up-to-date';
            })
            .catch(() => { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; });
    }

    /** Rebuild the bug-report mailto with current user/date/browser details. */
    function refreshBugLink() {
        if (!bugLink) return;
        const date  = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const user  = getUserName?.();
        const body  = 'Please describe the bug:\n\n\n\n— Auto-filled —\n'
            + `App: ${appLabel} Version ${APP_VERSION}\n`
            + (user ? `User: ${user}\n` : '')
            + `Date: ${date}\nBrowser: ${navigator.userAgent}`;
        bugLink.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — ${appLabel} Version ${APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
    }

    const lb = createLightbox({
        overlay: lightbox, content: content ?? undefined, closeBtn: closeBtn ?? undefined,
        onOpen() {
            refreshUpdateStatus();
            refreshBugLink();
            onOpen?.();
        },
    });

    // Bug link opens the mail app — must not bubble to the backdrop close check.
    if (bugLink) bugLink.addEventListener('click', e => e.stopPropagation());

    // Optional print button — close first so the lightbox doesn't appear in the
    // output, then print after the exit transition. The 500 ms delay matches the
    // dismissOverlay fallback that fires when transitionend doesn't (iOS backgrounded tab,
    // prefers-reduced-motion) — no need to wire a second transitionend listener here.
    const printBtn = document.getElementById('lightboxPrintBtn');
    if (printBtn) printBtn.addEventListener('click', () => {
        lb.close();
        setTimeout(() => (printFn ?? (() => window.print()))(), 500);
    });

    return lb;
}
