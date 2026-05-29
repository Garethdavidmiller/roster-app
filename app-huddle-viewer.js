/**
 * app-huddle-viewer.js — Daily Huddle overlay for index.html.
 *
 * Owns: Huddle viewer overlay, auto-open on notification tap, real-time
 *   Firestore subscription, huddle button state management, HTML sanitisation.
 * Does NOT own: Huddle upload (huddle.js), Firestore huddles collection writes
 *   (firebase-client.js), push notification logic (notif.js).
 * Edit here for: viewer open/close behaviour, auto-open paths, button state.
 *
 * Two _triggerAutoOpen paths — do NOT unify, do NOT revert auto-open to
 * window.open/location.href:
 *   HTML huddles render inline.
 *   PDF/DOCX huddles render an in-overlay "📄 Open Huddle" button because a
 *   notification tap has no user activation (window.open is blocked; location.href
 *   to a cross-origin PDF breaks standalone mode). The manual #huddleBtn click
 *   calls window.open directly — that click IS a real gesture.
 * Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".
 */

// @3 is a floating version tag — run `node generate-sri.mjs --apply` to pin to a
// specific release and add the matching <link rel="modulepreload" integrity="..."> to index.html.
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs';
import { subscribeToLatestHuddle } from './firebase-client.js';
import { lockBodyScroll, unlockBodyScroll, _pushOverlayState, _clearOverlayHistory } from './overlay.js';

// Module-level state — set once at startup and survives the page lifetime.
// applyHuddleButtonState() is exported so app.js can call it during calendar renders.
let _huddleData  = null;
let _huddleState = 'loading'; // 'loading' | 'ready' | 'none' | 'error'

/**
 * Update the #huddleBtn disabled state and accessible label.
 * Called by app.js on every calendar render and by the Firestore subscription callback.
 */
export function applyHuddleButtonState() {
    const btn = document.getElementById('huddleBtn');
    if (!btn) return;
    if (_huddleState === 'loading') {
        btn.disabled = true;
    } else if (_huddleState === 'none') {
        btn.disabled = true;
        btn.title = 'No briefing uploaded today';
        btn.setAttribute('aria-label', 'Huddle — no briefing uploaded yet');
    } else if (_huddleState === 'error') {
        btn.disabled = true;
        btn.title = "Couldn't load the briefing";
        btn.setAttribute('aria-label', "Huddle — couldn't load, check your connection");
    } else {
        btn.disabled = false;
        btn.title = "Open today's Huddle";
        btn.setAttribute('aria-label', "Open today's Huddle");
    }
}

/**
 * Sanitise HTML from a Huddle document before rendering it in the viewer.
 * Uses DOMPurify with a strict allowlist — no attributes, no SVG, no script vectors.
 * @param {string} html
 * @returns {string}
 */
function sanitiseHtml(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','br','table','thead','tbody','tr','th','td'],
        ALLOWED_ATTR: [],
    });
}

// ============================================
// HUDDLE VIEWER
// #huddleBtn is in the static <header> and persists across renders.
// Event delegation on document is used for consistency with other overlays.
// _huddleData / _huddleState are module-level and survive the page lifetime.
// ============================================

/** Wire up the Huddle viewer overlay and start the Firestore subscription. Call once on page load. */
export function initHuddleViewer() {
    const viewer = document.getElementById('huddleViewer');
    const body   = document.getElementById('huddleViewerBody');
    const close  = document.getElementById('huddleViewerClose');

    // Detect notification tap — SW appends #huddle to the URL so we know to
    // auto-open the viewer once the Firestore subscription delivers data.
    // _autoOpen is mutable so the hashchange handler below can set it when the
    // page was already open and the SW navigated it to #huddle (vs. a fresh load).
    let _autoOpen = window.location.hash === '#huddle';
    if (_autoOpen) history.replaceState(null, '', window.location.pathname);
    let _autoOpened = false;

    let _viewerFocusReturn = null;
    function openViewer() {
        _viewerFocusReturn = document.activeElement;
        viewer.classList.add('visible');
        requestAnimationFrame(() => viewer.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(closeViewer);
        document.addEventListener('keydown', onKey);
    }
    function closeViewer() {
        _clearOverlayHistory();
        viewer.classList.remove('open');
        const t = setTimeout(() => {
            viewer.classList.remove('visible');
            unlockBodyScroll();
        }, 500);
        viewer.addEventListener('transitionend', () => {
            clearTimeout(t);
            viewer.classList.remove('visible');
            unlockBodyScroll();
        }, { once: true });
        document.removeEventListener('keydown', onKey);
        _viewerFocusReturn?.focus();
        _viewerFocusReturn = null;
    }
    function onKey(e) { if (e.key === 'Escape') closeViewer(); }

    if (close) {
        close.addEventListener('click', closeViewer);
    }

    // Event delegation — fires on every document click; only acts on #huddleBtn.
    document.addEventListener('click', e => {
        if (!e.target.closest('#huddleBtn')) return;
        if (_huddleState !== 'ready' || !_huddleData) return;
        const huddle = _huddleData;
        try {
            if (huddle.htmlContent) {
                body.innerHTML = sanitiseHtml(huddle.htmlContent);
                openViewer();
                close.focus();
            } else if (huddle.fileType === 'pdf' || !huddle.fileType) {
                // Open the PDF directly — Android Chrome's built-in PDF viewer
                // handles this natively and is far faster than routing through
                // Google Docs Viewer (which fetches, renders, and re-serves the file).
                window.open(huddle.storageUrl, '_blank', 'noopener');
            } else {
                body.innerHTML = '<p class="huddle-error">This Huddle could not be previewed — please re-upload the Word file from the Admin page.</p>';
                openViewer();
                close.focus();
            }
        } catch (err) {
            console.error('[Huddle] Viewer error:', err);
            body.innerHTML = '<p class="huddle-error">Could not display this Huddle — please try again.</p>';
            openViewer();
            close.focus();
        }
    });

    function _triggerAutoOpen(huddle) {
        _autoOpened = true;
        try {
            if (huddle.htmlContent) {
                body.innerHTML = sanitiseHtml(huddle.htmlContent);
                openViewer();
                close.focus();
            } else if (huddle.fileType === 'pdf' || !huddle.fileType) {
                // A notification tap carries no in-page user activation, so calling
                // window.open() directly here would be blocked as a pop-up — and
                // navigating the standalone window itself (location.href) to the
                // cross-origin PDF knocks the app out of standalone mode (it comes
                // back wrapped in browser chrome). Instead, open the viewer with an
                // explicit button: tapping it IS a real gesture, so the PDF opens as
                // a separate Custom Tab over the intact standalone app, and Back
                // returns to the clean app. (The manual #huddleBtn handler can call
                // window.open directly — that click is already a real gesture.)
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
    let _unsubHuddle = null;
    function startHuddleSubscription() {
        if (_unsubHuddle) _unsubHuddle();
        _unsubHuddle = subscribeToLatestHuddle(
            (huddle) => {
                const prevUrl = _huddleData?.storageUrl;
                if (!huddle) {
                    _huddleState = 'none';
                } else {
                    _huddleData  = huddle;
                    _huddleState = 'ready';
                    if (_autoOpen && !_autoOpened) {
                        _triggerAutoOpen(huddle);
                    } else if (_autoOpen && _autoOpened
                               && viewer.classList.contains('open')
                               && huddle.storageUrl !== prevUrl) {
                        // Viewer is open showing a stale huddle — Firestore delivered a
                        // fresher one (race: notification tap beat the WebSocket reconnect).
                        _triggerAutoOpen(huddle);
                    }
                }
                applyHuddleButtonState();
            },
            (err) => {
                _huddleState = 'error';
                console.warn('[Huddle] Could not fetch latest huddle:', err);
                applyHuddleButtonState();
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
            applyHuddleButtonState();
        }
    }, 8000);
}
