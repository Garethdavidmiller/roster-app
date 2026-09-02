// @ts-check
/**
 * calendar-huddle-viewer.js — Daily Huddle overlay for index.html.
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

// DOMPurify is self-hosted at ./purify.es.mjs (v3.4.12) and loaded LAZILY — it is only
// needed when a DOCX-converted huddle's HTML is rendered, which most calendar opens never
// do, so a static import would put ~45 KB on every cold calendar load for nothing. The
// dynamic import below pulls it in on first render and memoises the module. (Still precached
// by the service worker, so it loads from cache offline.) To upgrade: npm pack dompurify@<new>,
// extract package/dist/purify.es.mjs, replace the file, RE-ADD the `// @ts-nocheck` first line (tsc
// follows this dynamic import despite the jsconfig exclude), and update the version comment here.
/** @type {Promise<any>|null} */
let _purifyPromise = null;
function _loadPurify() {
    // Reset on rejection (v16.23): ||= never re-assigns over a rejected (truthy) promise, so one
    // failed load (offline + evicted cache) permanently broke every DOCX render until reload.
    return (_purifyPromise ||= import('./purify.es.mjs').then(m => m.default)
        .catch(err => { _purifyPromise = null; throw err; }));
}
import { subscribeToLatestHuddle, isSafeStorageUrl } from './firebase-client.js';
import { lockBodyScroll, _pushOverlayState, dismissOverlay, trapFocus } from './overlay.js';
import { recordOpen } from './usage-reporter.js';
import { getCurrentMember, isFirstRun } from './calendar-member.js';

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
 * @returns {Promise<string>}
 */
async function sanitiseHtml(html) {
    const DOMPurify = await _loadPurify();
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','br','table','thead','tbody','tr','th','td'],
        ALLOWED_ATTR: ['colspan','rowspan'],
    });
}

/**
 * Give every table its own horizontal scroll box.
 *
 * WHY, from two staff screenshots on a 412px phone (v22.27). The Huddle grew a fifth column and
 * stopped fitting. `#huddleViewerBody` was the only scroll container, so reading the Late column
 * scrolled the WHOLE document sideways: the date heading slid off ("Wednesday 2nd September 2026"
 * showing as "nd September 2026") and the Shift and Call Sign columns — the ones that say whose
 * row you are reading — went with it. Nothing errored. It was simply unusable.
 *
 * Done HERE rather than in the sanitiser or server-side, deliberately. The HTML arrives from
 * mammoth via the Cloud Function and `style` is stripped (see sanitiseHtml), so there is no markup
 * hook to target — and adding a wrapper element inside the ALLOWED_TAGS list would mean trusting
 * the document to carry its own layout. This wraps what actually rendered, after sanitising, and
 * touches nothing else.
 *
 * @param {HTMLElement} root
 */
export function wrapTables(root) {
    for (const table of [...root.querySelectorAll('table')]) {
        // Idempotent: showInlineHuddle can re-render the memoised HTML on reopen.
        if (table.parentElement?.classList.contains('huddle-table-wrap')) continue;
        const wrap = document.createElement('div');
        wrap.className = 'huddle-table-wrap';
        // ── THE STICKY JOB COLUMN IS OPT-IN, AND A ROWSPAN OPTS OUT (v22.31) ──────────────────
        //
        // The CSS pins the first column so a scrolled row still says whose it is, and it selects
        // that column as `td:first-child`. **That selector cannot express "column 1" in a table
        // with rowspans**, and the real Huddle has them: the Gate line job cell spans three rows,
        // so those rows have no cell of their own in column 1 and `td:first-child` resolves to the
        // CALL SIGN instead. C17 and C18 were pinned to the left edge, on top of the job cell's
        // own text — reported from a phone, with the reminder note showing through them.
        //
        // There is no CSS fix: without `:nth-col()` support the first column of a rowspan table is
        // not addressable. So the sticky column is enabled per table, here, only when nothing
        // spans rows. A Huddle that uses rowspans scrolls without a pinned column, which is a
        // smaller loss than cells drawn over each other — and the wrapper still stops the page
        // itself dragging sideways, which was the original defect.
        if (!table.querySelector('[rowspan]:not([rowspan="1"])')) wrap.classList.add('huddle-table-wrap--pinned');
        table.replaceWith(wrap);
        wrap.appendChild(table);
    }
}

/** Wire up the Huddle viewer overlay and start the Firestore subscription. Call once on page load. */
/**
 * @param {{ authReady?: Promise<any> }} [deps] authReady — resolves once a Firebase session exists.
 *   Awaited before the snapshot listener attaches (AUTH_PLAN.md → E1). Defaults to already-resolved.
 */
export function initHuddleViewer({ authReady = Promise.resolve() } = {}) {
    const viewer = /** @type {HTMLElement} */ (document.getElementById('huddleViewer'));
    const body   = /** @type {HTMLElement} */ (document.getElementById('huddleViewerBody'));
    const close  = document.getElementById('huddleViewerClose');

    // Detect notification tap — SW appends #huddle to the URL so we know to
    // auto-open the viewer once the Firestore subscription delivers data.
    // _autoOpen is mutable so the hashchange handler below can set it when the
    // page was already open and the SW navigated it to #huddle (vs. a fresh load).
    let _autoOpen = window.location.hash === '#huddle';
    if (_autoOpen) history.replaceState(null, '', window.location.pathname + window.location.search);
    let _autoOpened = false;
    // Open-counter arming (v18.22): one count per user open GESTURE (#huddle arrival), consumed by
    // the first _triggerAutoOpen it produces. Counting inside _triggerAutoOpen unconditionally
    // (v18.20) double-counted the COMMON notification path: the cache-first snapshot renders the
    // previous huddle (count 1), then the server snapshot delivers the new one and the stale-viewer
    // refresh branch re-triggers (count 2) — one tap, two increments. It also counted an admin
    // re-upload landing while a viewer was open (zero user action).
    let _openCountPending = _autoOpen;

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
            // Push history state and attach keydown listener only once per open —
            // a stale-huddle re-trigger calls openViewer() a second time while the
            // viewer is already visible, which would push a duplicate history entry
            // and add a second keydown listener (Android Back would then need two presses).
            _pushOverlayState(closeViewer);
            document.addEventListener('keydown', onKey);
        }
        _viewerOpen = true;
        viewer.classList.add('visible');
        requestAnimationFrame(() => viewer.classList.add('open'));
    }
    function closeViewer() {
        _viewerOpen = false;
        const focusReturn = _viewerFocusReturn;
        _viewerFocusReturn = null;
        dismissOverlay(viewer, { onKey, focusReturn, backHandler: closeViewer });
    }
    /** @param {any} e */
    function onKey(e) {
        if (e.key === 'Escape') { closeViewer(); return; }
        trapFocus(viewer, e);
    }

    // PDF path, DOCX-conversion-failed path, AND the inline-render failure fallback (v16.23):
    // show an explicit button. A notification tap carries no in-page user activation, so calling
    // window.open() directly here would be blocked as a pop-up — and navigating the standalone
    // window itself (location.href) to the cross-origin file knocks the app out of standalone
    // mode (it comes back wrapped in browser chrome). Instead, open the viewer with an explicit
    // button: tapping it IS a real gesture, so the file opens as a separate Custom Tab over the
    // intact standalone app, and Back returns to the clean app.
    /** @param {any} huddle */
    function showOpenFileButton(huddle) {
        body.innerHTML = '<div class="huddle-open-prompt">'
            + '<p>The latest Huddle is ready.</p>'
            + '<button type="button" id="huddleOpenFileBtn" class="huddle-open-btn">📄 Open Huddle</button>'
            + '</div>';
        openViewer();
        const openBtn = document.getElementById('huddleOpenFileBtn');
        openBtn?.addEventListener('click', () => {
            // Defence-in-depth: only open a recognised Firebase Storage HTTPS URL
            // (same validator the Circular/Newsletter openers use). Guards against
            // malformed Firestore data or a compromised write opening an arbitrary URL.
            if (isSafeStorageUrl(huddle.storageUrl)) {
                window.open(huddle.storageUrl, '_blank', 'noopener');
            } else {
                body.innerHTML = '<p class="huddle-error">This Huddle link is unavailable — please contact the admin.</p>';
            }
        });
        openBtn?.focus();
    }

    // Render a DOCX-converted huddle inline — memoises sanitised HTML per storageUrl
    // so DOMPurify doesn't re-parse the same document on every reopen.
    /** @param {any} huddle */
    async function showInlineHuddle(huddle) {
        try {
            if (huddle.storageUrl !== _sanitisedUrl) {
                _sanitisedHtml = await sanitiseHtml(huddle.htmlContent);
                _sanitisedUrl  = huddle.storageUrl;
            }
            body.innerHTML = _sanitisedHtml;
            wrapTables(body);
            openViewer();
            close?.focus();
        } catch (err) {
            // DOMPurify failed to load (offline + evicted) or sanitise threw — never render
            // unsanitised HTML. Previously this left the viewer CLOSED with the notification tap
            // already consumed (_autoOpened=true) and no retry path — the tap silently did
            // nothing. Fall back to the Open-file button instead: the storageUrl is still
            // perfectly openable, matching the documented DOCX-conversion-failed UX (v16.23).
            console.error('[Huddle] inline render failed:', err);
            showOpenFileButton(huddle);
        }
    }

    if (close) {
        close.addEventListener('click', closeViewer);
    }

    /** @param {any} huddle */
    function _triggerAutoOpen(huddle) {
        _autoOpened = true;
        try {
            // Anonymous open-counter — consumed once per gesture (see _openCountPending above).
            // Identity for the admin exclusion: the selected member, EXCEPT on a first-run device
            // where the selection is only the DEFAULT member (the developer) — excluding on that
            // would silently drop every fresh visitor's opens (the same trap the recordUsage call
            // site documents; v18.22 review fix).
            if (_openCountPending) {
                _openCountPending = false;
                recordOpen('huddle', isFirstRun() ? null : getCurrentMember()?.name ?? null);
            }
            if (huddle.htmlContent) {
                // DOCX converted to HTML server-side — render inline.
                showInlineHuddle(huddle);
            } else {
                // PDF, or DOCX where conversion failed.
                showOpenFileButton(huddle);
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
        history.replaceState(null, '', window.location.pathname + window.location.search);
        _autoOpen   = true;
        _autoOpened = false;
        _openCountPending = true;   // a fresh user gesture — arm one open count (v18.22)
        if (_huddleState === 'ready' && _huddleData) _triggerAutoOpen(_huddleData);
    });

    // Real-time listener — fires from IndexedDB cache on repeat visits (near-instant)
    // then again when the server confirms. Also fires when a new huddle is uploaded,
    // so staff don't need to refresh the page.
    /** @type {any} */
    let _unsubHuddle = null;
    // startHuddleSubscription became async at v19.01 (it awaits a session before attaching), so both
    // fire-and-forget call sites need this wrapper: without it a synchronous throw from
    // subscribeToLatestHuddle would surface as an UNHANDLED REJECTION rather than the viewer's own
    // error state, which is both less visible and noisier (error-reporter would log it as uncaught).
    function _startHuddleSubscriptionSafe() {
        startHuddleSubscription().catch(err => {
            _huddleState = 'error';
            console.warn('[Huddle] Could not start the huddle subscription:', err);
        });
    }
    let _subGen = 0;
    async function startHuddleSubscription() {
        const _gen = ++_subGen;
        if (_unsubHuddle) { _unsubHuddle(); _unsubHuddle = null; }
        // Attach only once a session exists (AUTH_PLAN.md → E1). Attaching too early is worse than
        // attaching late: an onSnapshot that hits permission-denied is TERMINATED, not retried, and
        // today only recovers on the next visibilitychange — useless to someone who just tapped a
        // notification. A plain await is safe because the 8s safety timeout below is registered at
        // init, so it already bounds this wait; and the generation guard stops the visibilitychange
        // re-subscribe from stacking two listeners when two calls await concurrently.
        await authReady;
        if (_gen !== _subGen) return;
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
    _startHuddleSubscriptionSafe();

    // If the tab was discarded while still loading — OR the subscription errored (an onSnapshot
    // error terminates the listener; the 8s timeout also flips 'loading'→'error') — re-subscribe on
    // return so the Huddle doesn't stay permanently broken until a full reload. startHuddleSubscription
    // unsubscribes any prior listener first, so this can't stack listeners (v16.19).
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && (_huddleState === 'loading' || _huddleState === 'error')) {
            _startHuddleSubscriptionSafe();
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
