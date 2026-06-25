// @ts-check
/**
 * app-huddle-viewer.js — Daily Huddle overlay for index.html.
 *
 * Owns: Huddle viewer overlay, auto-open on notification tap, real-time
 *   Firestore subscription, HTML sanitisation.
 * Does NOT own: Huddle upload (huddle.js), Firestore huddles collection writes
 *   (firebase-client.js), push notification logic (notif.js).
 * Edit here for: viewer open/close behaviour, auto-open paths.
 *
 * Two render paths — do NOT collapse into one, do NOT revert to opening the
 * file with window.open/location.href at viewer-open time:
 *   htmlContent present (DOCX converted server-side) → render inline in viewer.
 *   No htmlContent (PDF, or DOCX where conversion failed) → show an in-overlay
 *     "📄 Open Huddle" button. The viewer is reached only via the #huddle hash
 *     (the nav-panel "Daily Huddle" link and notification taps alike), so both
 *     triggers run this same path. A notification tap carries no user activation,
 *     so calling window.open at open time would be pop-up-blocked and a
 *     location.href to the cross-origin file would break standalone mode —
 *     routing through the button avoids relying on activation that may be absent.
 *     Tapping the button IS a real gesture, so its handler can window.open safely.
 * Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".
 */

// Self-hosted at ./purify.es.mjs (v3.4.8). To upgrade: npm pack dompurify@<new>, extract
// package/dist/purify.es.mjs, replace the file, update the version comment here, and
// re-run `node generate-sri.mjs --apply` to update the <link rel="modulepreload"> SRI in index.html.
import DOMPurify from './purify.es.mjs';
import { subscribeToLatestHuddle } from './firebase-client.js';
import { lockBodyScroll, _pushOverlayState, dismissOverlay, trapFocus } from './overlay.js';

// Module-level state — set once at startup and survives the page lifetime.
/** @type {any} */
let _huddleData  = null;
let _huddleState = 'loading'; // 'loading' | 'ready' | 'none' | 'error'

/**
 * Sanitise HTML from a Huddle document before rendering it in the viewer.
 * Strict tag allowlist plus only the two structural table attributes:
 *   - colspan/rowspan: preserve merged-cell structure in duty-board tables
 *     (Mammoth emits these for merged Word cells; without them a merged board
 *     collapses into the wrong columns). Both are numeric/structural — no URL,
 *     CSS, or script surface.
 * `style` is deliberately NOT allowed (it was tried at v12.83–v12.85 and reverted):
 *   - Mammoth does not read Word's text colour or cell shading (w:color / w:shd),
 *     so style carried no colour anyway — only fixed pt column widths that broke
 *     the mobile layout and had to be fought with width:auto !important in CSS.
 *   - It widens the attack surface with no sanitiser behind it: this self-hosted
 *     DOMPurify build lists `style` as a URI-safe attribute and passes its CSS
 *     value through UNMODIFIED — it does NOT strip url()/position:fixed/etc. The
 *     Huddle source is trusted (written via the ingestHuddle Cloud Function, Admin
 *     SDK), but there is no second layer sanitising inline CSS, so keeping the
 *     attribute out is the safe default.
 * No SVG, no script, no event-handler attributes.
 * @param {string} html
 * @returns {string}
 */
function sanitiseHtml(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','br','table','thead','tbody','tr','th','td'],
        ALLOWED_ATTR: ['colspan','rowspan'],
    });
}

/** Wire up the Huddle viewer overlay and start the Firestore subscription. Call once on page load. */
export function initHuddleViewer() {
    const viewer = /** @type {HTMLElement} */ (document.getElementById('huddleViewer'));
    const body   = /** @type {HTMLElement} */ (document.getElementById('huddleViewerBody'));
    const close  = document.getElementById('huddleViewerClose');

    // Detect notification tap — SW appends #huddle to the URL so we know to
    // auto-open the viewer once the Firestore subscription delivers data.
    // _autoOpen is mutable so the hashchange handler below can set it when the
    // page was already open and the SW navigated it to #huddle (vs. a fresh load).
    let _autoOpen = window.location.hash === '#huddle';
    if (_autoOpen) history.replaceState(null, '', window.location.pathname);
    let _autoOpened = false;

    /** @type {any} */
    let _viewerFocusReturn = null;
    let _viewerOpen = false;  // true from the openViewer call; false from closeViewer call
    /** @type {any} */
    let _sanitisedUrl  = null;
    /** @type {any} */
    let _sanitisedHtml = null;

    function openViewer() {
        if (!_viewerOpen) {
            // Capture focus return only on fresh open — not on a stale-huddle re-open
            // where the viewer is already showing (focus return could be a doomed
            // element about to be overwritten by body.innerHTML).
            _viewerFocusReturn = document.activeElement;
            lockBodyScroll();
        }
        _viewerOpen = true;
        viewer.classList.add('visible');
        requestAnimationFrame(() => viewer.classList.add('open'));
        _pushOverlayState(closeViewer);
        document.addEventListener('keydown', onKey);
    }
    function closeViewer() {
        _viewerOpen = false;
        const focusReturn = _viewerFocusReturn;
        _viewerFocusReturn = null;
        dismissOverlay(viewer, { onKey, focusReturn });
    }
    /** @param {any} e */
    function onKey(e) {
        if (e.key === 'Escape') { closeViewer(); return; }
        trapFocus(viewer, e);
    }

    // Render a DOCX-converted huddle inline — memoises sanitised HTML per storageUrl
    // so DOMPurify doesn't re-parse the same document on every reopen.
    /** @param {any} huddle */
    function showInlineHuddle(huddle) {
        if (huddle.storageUrl !== _sanitisedUrl) {
            _sanitisedHtml = sanitiseHtml(huddle.htmlContent);
            _sanitisedUrl  = huddle.storageUrl;
        }
        body.innerHTML = _sanitisedHtml;
        openViewer();
        close?.focus();
    }

    if (close) {
        close.addEventListener('click', closeViewer);
    }

    /** @param {any} huddle */
    function _triggerAutoOpen(huddle) {
        _autoOpened = true;
        try {
            if (huddle.htmlContent) {
                // DOCX converted to HTML server-side — render inline.
                showInlineHuddle(huddle);
            } else {
                // PDF, or DOCX where conversion failed — show an explicit button.
                // A notification tap carries no in-page user activation, so calling
                // window.open() directly here would be blocked as a pop-up — and
                // navigating the standalone window itself (location.href) to the
                // cross-origin file knocks the app out of standalone mode (it comes
                // back wrapped in browser chrome). Instead, open the viewer with an
                // explicit button: tapping it IS a real gesture, so the file opens as
                // a separate Custom Tab over the intact standalone app, and Back
                // returns to the clean app. (The button click here is itself a real
                // gesture, so window.open is allowed.)
                body.innerHTML = '<div class="huddle-open-prompt">'
                    + '<p>Today’s Huddle is ready.</p>'
                    + '<button type="button" id="huddleOpenFileBtn" class="huddle-open-btn">📄 Open Huddle</button>'
                    + '</div>';
                openViewer();
                const openBtn = document.getElementById('huddleOpenFileBtn');
                openBtn?.addEventListener('click', () => window.open(huddle.storageUrl, '_blank', 'noopener'));
                openBtn?.focus();
            }
        } catch (err) {
            console.error('[Huddle] Auto-open error:', err);
        }
    }

    // When the page is already open and the SW navigates it to #huddle (hash-only
    // navigation, no page reload), the IIFE has already run with _autoOpen=false.
    // The hashchange event fires instead — set _autoOpen and open immediately if
    // data is already loaded, or let the subscription callback catch it.
    window.addEventListener('hashchange', () => {
        if (window.location.hash !== '#huddle') return;
        history.replaceState(null, '', window.location.pathname);
        _autoOpen   = true;
        _autoOpened = false;
        if (_huddleState === 'ready' && _huddleData) _triggerAutoOpen(_huddleData);
    });

    // Real-time listener — fires from IndexedDB cache on repeat visits (near-instant)
    // then again when the server confirms. Also fires when a new huddle is uploaded,
    // so staff don't need to refresh the page.
    /** @type {any} */
    let _unsubHuddle = null;
    function startHuddleSubscription() {
        if (_unsubHuddle) _unsubHuddle();
        _unsubHuddle = subscribeToLatestHuddle(
            /** @param {any} huddle */ (huddle) => {
                const prevUrl = _huddleData?.storageUrl;
                if (!huddle) {
                    _huddleState = 'none';
                } else {
                    _huddleData  = huddle;
                    _huddleState = 'ready';
                    if (_autoOpen && !_autoOpened) {
                        _triggerAutoOpen(huddle);
                    } else if (_autoOpen && _autoOpened
                               && _viewerOpen
                               && huddle.storageUrl !== prevUrl) {
                        // Viewer is open showing a stale huddle — Firestore delivered a
                        // fresher one (race: notification tap beat the WebSocket reconnect).
                        _triggerAutoOpen(huddle);
                    }
                }
            },
            /** @param {any} err */ (err) => {
                _huddleState = 'error';
                console.warn('[Huddle] Could not fetch latest huddle:', err);
            }
        );
    }
    startHuddleSubscription();

    // If the tab was discarded while still loading, re-subscribe on return so
    // the Huddle button doesn't stay stuck in 'loading'.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _huddleState === 'loading') {
            startHuddleSubscription();
        }
    });

    // Safety timeout — don't leave the button in 'loading' forever if the
    // listener never fires (offline, blocked, etc.).
    setTimeout(() => {
        if (_huddleState === 'loading') {
            _huddleState = 'error';
        }
    }, 8000);
}
