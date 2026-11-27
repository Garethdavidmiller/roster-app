// @ts-check
/**
 * about-lightbox.js — Shared About (#iconLightbox) panel for every app page.
 *
 * One implementation of the version display, service-worker update status,
 * pre-filled bug-report mailto link, and optional print button that was
 * previously copy-pasted into every page coordinator (and had drifted —
 * missing focus traps, missing initial focus on some pages).
 *
 * Owns: open/close lifecycle (via createLightbox), SW status refresh, bug link, the panel's
 *   page links (each replaces the panel's history entry — `followLinkOutOf`, overlay.js),
 *   and `wireHeaderLogo` — the sub-page header logo's back-to-calendar wiring.
 * Does NOT own: the trigger that OPENS About — each page wires its drawer logo
 *   to the returned `.open` (pages differ: the calendar header logo opens About;
 *   sub-page header logos navigate back to the calendar and only the drawer logo
 *   opens About). Store `.open`, never the returned object: Trains stored the
 *   object and called it, so its About panel never opened (v24.71 → v25.06).
 *
 * @module about-lightbox
 */

import { APP_VERSION, CONFIG } from './roster-data.js';
import { createLightbox, confirmDialog, followLinkOutOf } from './overlay.js';
import { printOrExplain, explainNoPrint } from './print-guard.js';
import { setStatus } from './status-text.js';
import { hasPendingUpdate } from './sw-register.js';

/**
 * Wire up the page's #iconLightbox. Safe no-op (returns null) if the page
 * has no #iconLightbox.
 *
 * @param {object} [opts]
 * @param {string}   [opts.appLabel='Marylebone Roster'] - App name used in the bug-report subject/body
 * @param {Function} [opts.getUserName] - Returns who is reporting, for the bug report's User line:
 *                                        the signed-in user's name (the Calendar also says how it was
 *                                        opened without one); omit on pages without a session (no
 *                                        User line is added)
 * @param {() => string[]} [opts.getReportLines] - Further auto-filled lines for the bug report, each
 *                                        "Label: value", after the User line (the Calendar's says whose
 *                                        calendar was on screen, which need not be the reporter's)
 * @param {Function} [opts.onOpen]      - Page-specific extra work on open (e.g. calendar's
 *                                        team-view content swap), run before the panel shows
 * @param {() => void} [opts.printFn] - Replaces window.print() for the optional
 *                                        #lightboxPrintBtn (e.g. calendar's landscape team print)
 * @returns {{ open: () => void, close: () => void }|null}
 */
export function initAboutLightbox({ appLabel = 'Marylebone Roster', getUserName, getReportLines, onOpen, printFn } = {}) {
    const lightbox = document.getElementById('iconLightbox');
    if (!lightbox) return null;
    const content  = document.getElementById('iconLightboxContent');
    const closeBtn = document.getElementById('iconLightboxClose');
    const statusEl = document.getElementById('lightboxUpdateStatus');
    // Every page's panel uses the same ids (about-markup-parity.test.mjs holds them to this list).
    const bugLink  = /** @type {HTMLAnchorElement|null} */ (document.getElementById('bugReportLink'));

    const versionEl = document.getElementById('lightboxVersion');
    if (versionEl) versionEl.textContent = APP_VERSION;

    /** Refresh the "✓ Up to date / ↻ Update available" line from the SW registration. */
    function refreshUpdateStatus() {
        if (!statusEl) return;
        statusEl.textContent = '';
        statusEl.className = 'lightbox-status';
        (navigator.serviceWorker?.getRegistration() ?? Promise.resolve(null))
            .then(reg => {
                // A held release counts too — the worker skipWaiting()s, so `waiting` is never set while
                // a reload waits for the member to look away (hasPendingUpdate, sw-register.js).
                const ready = !!reg?.waiting || hasPendingUpdate();
                setStatus(statusEl, ready ? '↻ Update ready — it will apply next time you reopen the app' : '✓ Up to date');
                statusEl.className   = ready ? 'lightbox-status needs-update' : 'lightbox-status up-to-date';
            })
            // The CHECK itself failed (registration lookup rejected) — we don't actually know the app
            // is current, so don't show a green "Up to date" tick. A resolved-but-null registration
            // (no waiting worker) is the normal "no update" case and is handled in .then above.
            .catch(() => { statusEl.textContent = 'Couldn’t check for an update'; statusEl.className = 'lightbox-status'; });
    }

    /** Rebuild the bug-report mailto with current user/date/browser details. */
    function refreshBugLink() {
        if (!bugLink) return;
        const date  = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const user  = getUserName?.();
        const more  = getReportLines?.() ?? [];
        // TWO THINGS AN iPHONE'S REPORT CANNOT SAY FOR ITSELF (iPhone audit, 7 Nov 2026). Whether it came
        // from the home-screen app — half the iOS behaviour differs there, and the user agent is the same
        // either way — and which iOS: from iOS 26 Safari freezes the version in the user agent at 18_7,
        // so the line below would report every newer iPhone as 18.7. The first is read here; the second
        // only the reporter knows, so it is a line for them to fill, with where to find it, above the
        // auto-filled block (an iPad that reports itself as a Mac is caught by its touch points).
        const installed = /** @type {any} */ (navigator).standalone === true
            || !!window.matchMedia?.('(display-mode: standalone)').matches;
        const ua    = navigator.userAgent;
        const ios   = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
        const body  = 'Please describe the bug:\n\n\n\n'
            + (ios ? 'iOS version (Settings → General → About): \n\n' : '')
            + '— Auto-filled —\n'
            + `App: ${appLabel} Version ${APP_VERSION}\n`
            + (user ? `User: ${user}\n` : '')
            + more.map(line => `${line}\n`).join('')
            + `Date: ${date}\nInstalled app: ${installed ? 'yes' : 'no'}\nBrowser: ${ua}`;
        bugLink.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — ${appLabel} Version ${APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
    }

    // ONE TAP, ONE PRINT. The panel stays on screen, and tappable, through its close fade, so each
    // further tap on Print queued another print: the print dialog came back after the first was
    // closed, and in a home-screen app two "Printing isn't available here" dialogs stacked. One print
    // per opening of the panel; opening it again re-arms the button.
    let printQueued = false;

    const lb = createLightbox({
        overlay: lightbox, content: content ?? undefined, closeBtn: closeBtn ?? undefined,
        onOpen() {
            printQueued = false;
            refreshUpdateStatus();
            refreshBugLink();
            onOpen?.();
        },
    });

    // A PAGE LINK REPLACES THE PANEL'S HISTORY ENTRY (18 Nov 2026) — "Calendar" (it read "View staff roster" until 21 Nov 2026), a guide, Admin,
    // Operations: followed as plain links, the page they opened sat on top of the panel's own entry, and one
    // Back from it landed on a step of this page that nothing answered (`followLinkOutOf`, overlay.js, says
    // why). On the PANEL, so every page's links are covered. The unsaved-work question still comes first: it
    // listens on the document in the capture phase and re-clicks the link on "Leave" (page-session.js). Mail,
    // a new tab and an external `_blank` link are left to the browser.
    content?.addEventListener('click', e => { followLinkOutOf(lb, /** @type {MouseEvent} */ (e)); });

    // Optional print button — close first so the lightbox doesn't appear in the output, then print
    // once the close has LANDED: `lb.close()` resolves when the fade (or its fallback, or the
    // reduced-motion finish) AND the Back echo are both done (lightbox review R1-11, 22 Nov 2026).
    // A fixed 500 ms timer did that job before the promise existed, and made reduced-motion users
    // wait half a second for a close that had finished at once.
    // Through the print guard (v24.61): in a home-screen app on iOS 27 `window.print()` does nothing,
    // so the tap explains and offers Safari instead — on every page that has this button.
    const printBtn = document.getElementById('lightboxPrintBtn');
    if (printBtn) printBtn.addEventListener('click', () => {
        if (printQueued) return;
        printQueued = true;
        // Landed, not merely started: the close pops the lightbox's history entry, and the dialog the
        // explain path opens pushes its own — had the Back echo not landed yet it would consume the
        // dialog's entry and the next hardware Back would leave the page (24-hour review). The print
        // path touches no history and is unaffected.
        lb.close().then(() => printOrExplain({ print: printFn ?? (() => window.print()), explain: () => explainNoPrint(confirmDialog) }));
    });

    return lb;
}

/**
 * THE APP'S NAME IS NEVER CUT FOR THE PAGE BADGE (owner, 27 Nov 2026: "Marylebone Ro…" beside "NEW CEA LINK" on
 * an Android phone with larger text). The header gives the name what the badge leaves, and a long badge under
 * larger text left too little. A width rule cannot see text size, so the header is MEASURED: when the name would
 * be cut, the badge shows its emoji alone (`.app-header--tight`, shared.css) — its colour still says which page,
 * and the words stay in the page for a screen reader. Re-measured whenever the header's size changes (a rotation,
 * a text-size change). Every sub-page reaches it through `wireHeaderLogo`; the Calendar has its own header.
 */
function fitHeaderBadge() {
    const header = document.querySelector('.app-header');
    const name = header?.querySelector('h1');
    if (!header || !name || !header.querySelector('.badge-page') || header.dataset.badgeFit) return;
    header.dataset.badgeFit = '1';
    const fit = () => {
        header.classList.remove('app-header--tight');
        if (name.scrollWidth > name.clientWidth + 1) header.classList.add('app-header--tight');
    };
    fit();
    if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(header);
}

/**
 * The sub-page header logo is a BACK-TO-CALENDAR control (v11.21 — About lives on the drawer logo).
 *
 * ONE copy, because the copies were the bug (whole-app review, Nov 2026): five pages each carried
 * the same nine lines, and the two pages that arrived later — Trains and Overtime — shipped the
 * `#appIcon` labelled "Back to calendar" with nobody wiring it, so tapping it did nothing. Idempotent
 * (`data-wired`) because Overtime's start() re-runs on an in-place sign-in. The only module allowed to
 * wire `#appIcon`: page-contract-parity.test.mjs refuses any other.
 * @param {() => void} [onActivate] - What a tap does. Default: go to the app root. A page with
 *   unsaved work passes its own confirm-then-go here, exactly as its other exits do.
 */
export function wireHeaderLogo(onActivate = () => { window.location.href = './'; }) {
    fitHeaderBadge();
    const icon = document.getElementById('appIcon');
    if (!icon || icon.dataset.wired) return;
    icon.dataset.wired = '1';
    icon.setAttribute('aria-label', 'Back to calendar');
    // Keyboard-operable: the logo is an interactive control (it was a non-focusable <img>). v18.29.
    icon.setAttribute('role', 'button');
    icon.tabIndex = 0;
    icon.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); icon.click(); } });
    icon.addEventListener('click', () => onActivate());
}
