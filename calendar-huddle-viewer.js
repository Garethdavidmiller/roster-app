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

// DOMPurify is self-hosted at ./purify.es.mjs (v3.4.17) and loaded LAZILY — it is only
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
import { subscribeToLatestHuddle, resolveDocumentOpenUrl, fetchSignedDocumentUrl } from './firebase-client.js';
import {
    lockBodyScroll, _pushOverlayState, dismissOverlay, trapFocus, _isTopOverlay,
    registerPopInterceptor, suppressNextPop, whenHistorySettled,
} from './overlay.js';
import { recordOpen } from './usage-reporter.js';
import { getSession } from './session.js';
import { firstColumnMask } from './huddle-table-grid.js';

// Module-level state — set once at startup and survives the page lifetime.
/** @type {any} */
let _huddleData  = null;
let _huddleState = 'loading'; // 'loading' | 'ready' | 'none' | 'error' | 'locked'
/** Whether `_huddleData` was answered by this device's cache alone (the listener passes it). */
let _huddleFromCache = false;

/** How long a tap waits on the Huddle's first answer before it is told it could not be loaded. A
 *  late answer still replaces the message while it is on screen, so the bound costs nothing. */
const ANSWER_DEADLINE_MS = 8000;

/** A tap the LOCK was holding when the page unloaded — see `initHuddleViewer`. sessionStorage, so it
 *  lives with this tab and no other; `myb_held_huddle_tap` is read and written only here. */
const HELD_TAP_KEY = 'myb_held_huddle_tap';
/** How old that record may be when the next load reads it. It carries a tap across a RELOAD — the
 *  sign-in that finishes it reloads the page — not into a visit nobody would connect with the tap. */
const HELD_TAP_CARRY_MS = 60_000;

/**
 * Take the held tap this tab's last unload left, if it is recent enough. Read ONCE and removed
 * whatever it says, so a record is good for one load only. sessionStorage can throw (iOS private
 * mode), and a tap that cannot be carried is simply not carried.
 * @returns {{ countPending: boolean } | null}
 */
function _takeHeldTap() {
    try {
        const raw = sessionStorage.getItem(HELD_TAP_KEY);
        sessionStorage.removeItem(HELD_TAP_KEY);
        if (!raw) return null;
        const [at, count] = raw.split('|');
        const age = Date.now() - Number(at);
        return age >= 0 && age < HELD_TAP_CARRY_MS ? { countPending: count === '1' } : null;
    } catch { return null; }
}

/**
 * Sanitise HTML from a Huddle document before rendering it in the viewer.
 * Strict tag allowlist plus only the two structural table attributes:
 *   - colspan/rowspan: preserve merged-cell structure in duty-board tables
 *     (Mammoth emits these for merged Word cells; without them a merged board
 *     collapses into the wrong columns). Both are numeric/structural — no URL,
 *     CSS, or script surface.
 * ONLY the two: DOMPurify passes every `data-*` and `aria-*` attribute BEFORE it consults
 * ALLOWED_ATTR unless told not to (its `_isValidAttribute`), so the two flags below are what make
 * that true. Nothing on the Calendar acts on a data attribute inside this viewer today; the next
 * delegated `[data-…]` click handler would have been reachable from a Huddle document.
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
 * No SVG, no script, no event-handler attributes — and no `img`, so a picture is left out and the
 * reader is told so (`_picturesNote`).
 * @param {string} html
 * @returns {Promise<string>}
 */
async function sanitiseHtml(html) {
    const DOMPurify = await _loadPurify();
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','br','table','thead','tbody','tr','th','td'],
        ALLOWED_ATTR: ['colspan','rowspan'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
    });
}

/**
 * Did the converted document carry a picture? Mammoth writes each one as an inline `<img>` (its
 * default, with no `convertImage`), and the sanitiser above drops it — silently, until v25.65.
 * @param {string} html
 */
function _hasPictures(html) {
    return /<img\b/i.test(html);
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
        // ── THE STICKY JOB COLUMN IS MARKED, NOT SELECTED (v22.33) ───────────────────────────
        //
        // The CSS pins column 1 so a scrolled row still says whose it is. It used to select that
        // column as `td:first-child`, which is not the same statement: in the real Huddle the Gate
        // line job cell spans three rows, so the rows beneath it write no cell in column 1 and
        // `td:first-child` resolved to the CALL SIGN — C17 and C18 pinned to the left edge over the
        // job cell's own text, reported from a phone twice.
        //
        // v22.31 answered that by disabling the feature for any table containing a rowspan. Safe,
        // and it cost the feature exactly where it earns its keep, because the real Huddle is a
        // rowspan table. So the column is COMPUTED instead — `firstColumnMask` performs the same
        // grid walk the browser does — and only genuine column-1 cells are classed. A row that
        // writes no column-1 cell classes nothing and is covered by the spanning cell above it,
        // which is what the rendered table does anyway.
        //
        // `table.rows` is FLAT — it concatenates thead, every tbody and tfoot — and flattening is
        // what loses the row-group boundary a span cannot cross. Measured: a `rowspan="5"` header
        // cell in a one-row `<thead>` leaves the first `<tbody>` cell in column 1, so without the
        // boundaries below that cell would be reported as column 2 and lose its pin. Found in the
        // v22.36 external review as the narrower `rowspan="0"` case.
        const rows = [...table.rows];
        const groupStarts = [];
        let seen = 0;
        for (const section of [table.tHead, ...table.tBodies, table.tFoot]) {
            if (!section) continue;
            groupStarts.push(seen);
            seen += section.rows.length;
        }
        const mask = firstColumnMask(
            rows.map(r => [...r.cells].map(c => ({ rowSpan: c.rowSpan, colSpan: c.colSpan }))),
            { groupStarts },
        );
        rows.forEach((row, r) => {
            [...row.cells].forEach((cell, c) => {
                if (mask[r]?.[c]) cell.classList.add('huddle-shift-col');
            });
        });
        table.replaceWith(wrap);
        wrap.appendChild(table);
    }
}

/**
 * A table too wide for the viewer scrolls sideways inside its own box — and a box the keyboard cannot
 * reach cannot be scrolled (WCAG 2.1.1; axe's scrollable-region-focusable, the fault already fixed for
 * Team View and App Notices). The sanitised Huddle can hold nothing focusable, so such a box is made a
 * Tab stop itself. Measured AFTER the viewer is on screen: a hidden viewer has no widths to compare.
 * @param {HTMLElement} root
 */
function _tabbableWideTables(root) {
    for (const wrap of /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.huddle-table-wrap')])) {
        if (wrap.scrollWidth <= wrap.clientWidth + 1) continue;
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Table');
    }
}

/** Wire up the Huddle viewer overlay and start the Firestore subscription. Call once on page load. */
/**
 * @param {{ authReady?: Promise<any>, docAccess?: { has: () => boolean, onChange: (fn: (open: boolean) => void) => (() => void) } }} [deps]
 *   authReady — resolves once a Firebase session exists. Awaited before the snapshot listener
 *   attaches (AUTH_PLAN.md → E1). Defaults to already-resolved.
 *   docAccess — THE DOCUMENT GATE (v23.17, calendar-doc-access.js). The subscription attaches only
 *   while it is open and is torn down when it shuts; a `#huddle` tap while shut shows a message
 *   rather than doing nothing, and is FINISHED when access arrives — a notification tap that landed
 *   on the PIN card opens the Huddle once the PIN is entered, or once the member signs in, which
 *   reloads the page (the held tap is carried across that reload). Defaults to always-open, which
 *   is what every page other than the Calendar means.
 */
export function initHuddleViewer({ authReady = Promise.resolve(), docAccess = { has: () => true, onChange: () => () => {} } } = {}) {
    const viewer = /** @type {HTMLElement} */ (document.getElementById('huddleViewer'));
    const body   = /** @type {HTMLElement} */ (document.getElementById('huddleViewerBody'));
    const close  = document.getElementById('huddleViewerClose');
    /** The dialog's own status line (visually hidden): a message replacing "Loading…" is spoken. */
    const status = document.getElementById('huddleViewerStatus');

    // Detect notification tap — SW appends #huddle to the URL so we know to
    // auto-open the viewer once the Firestore subscription delivers data.
    // _autoOpen is mutable so the hashchange handler below can set it when the
    // page was already open and the SW navigated it to #huddle (vs. a fresh load).
    // A COLD tap's entry is the page's own (a new window, or a navigation from another page), so its
    // hash is rewritten in place; a tap on an open page pushed an entry of its own, which is taken
    // back off the history instead (the hashchange handler below).
    // ── A TAP THE LOCK HELD SURVIVES A RELOAD (whole-app review, 10 Nov 2026) ─────────────────────
    // Both sign-ins on a locked Calendar end in `window.location.reload()` (calendar-lock-cards.js),
    // and the hash had been consumed long before — so a member who answered "Enter the staff PIN, or
    // sign in, to read the Daily Huddle" by signing in got the Calendar and no Huddle. Only the PIN,
    // which grants in place, finished the tap. The tap the lock is holding is now written down as the
    // page unloads (`pagehide`, below) and taken back here: the sign-in finishes it as the PIN does.
    const held = _takeHeldTap();
    let _autoOpen = window.location.hash === '#huddle';
    // Open-counter arming (v18.22): one count per user open GESTURE (#huddle arrival), consumed by
    // the first _triggerAutoOpen it produces. Counting inside _triggerAutoOpen unconditionally
    // (v18.20) double-counted the COMMON notification path: the cache-first snapshot renders the
    // previous huddle (count 1), then the server snapshot delivers the new one and the stale-viewer
    // refresh branch re-triggers (count 2) — one tap, two increments. It also counted an admin
    // re-upload landing while a viewer was open (zero user action). A carried tap keeps its own
    // count, so the reload does not count the gesture twice.
    let _openCountPending = _autoOpen;
    if (_autoOpen) history.replaceState(null, '', window.location.pathname + window.location.search);
    else if (held) { _autoOpen = true; _openCountPending = held.countPending; }
    let _autoOpened = false;

    window.addEventListener('pagehide', () => {
        try {
            if (_autoOpen && !_autoOpened && !docAccess.has()) {
                sessionStorage.setItem(HELD_TAP_KEY, `${Date.now()}|${_openCountPending ? 1 : 0}`);
            } else {
                sessionStorage.removeItem(HELD_TAP_KEY);
            }
        } catch { /* no sessionStorage: the tap is not carried, as before */ }
    });
    // Back from the back/forward cache, this page's memory is current again: a record its unload
    // wrote would only be read by the NEXT load, as a tap this page has already dealt with.
    window.addEventListener('pageshow', (e) => {
        if (/** @type {PageTransitionEvent} */ (e).persisted) { try { sessionStorage.removeItem(HELD_TAP_KEY); } catch { /* noop */ } }
    });

    /** @type {any} */
    let _viewerFocusReturn = null;
    let _viewerOpen = false;  // true from the openViewer call; false from closeViewer call
    /** A close still fading out: its finisher, completed by a re-open (see openViewer). @type {(() => void)|null} */
    let _pendingFinish = null;
    /** @type {any} */
    let _sanitisedUrl  = null;
    /** @type {any} */
    let _sanitisedHtml = null;

    // ── WHICH WRITE TO THE VIEWER IS CURRENT (v24.23; widened 10 Nov 2026) ─────────────────────────
    // Every write to the body takes the next number, and so do a close and a lock. An answer that had
    // to WAIT — a short-lived url for the Open button, the sanitiser's first load for an inline Huddle —
    // compares its number when it wakes, and if anything has happened since it draws nothing, opens
    // nothing and focuses nothing. The inline render had no such check: a newer Huddle that landed
    // while it waited was dropped and the OLDER one drawn as the latest, a lock let it draw the Huddle
    // over the sign-in card, and a close let it re-open the viewer inside the fade — whose finisher
    // then hid it, leaving the page scroll-locked behind nothing.
    let _bodySeq = 0;
    /** The body write still waiting on the sanitiser, if it is still current (else -1). */
    let _inlineSeq = -1;
    /** The body write that put "Loading…" up — the deadline answers only a wait still on screen. */
    let _loadingSeq = -1;
    const _inlineWaiting = () => _inlineSeq === _bodySeq;

    function openViewer() {
        // RE-OPENED WHILE A CLOSE IS STILL FADING (whole-app review, 10 Nov 2026): finish that close
        // first, as createLightbox does (v21.86). Left to run, its finisher removed `.visible` from the
        // viewer just opened — which then sat "open", invisible, with the page behind it scroll-locked.
        if (_pendingFinish) { const finish = _pendingFinish; _pendingFinish = null; finish(); }
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
        // ALREADY CLOSING? Do nothing. The ✕ stays clickable through the fade, so a second tap ran
        // a second `dismissOverlay` — each with its own finisher, so `unlockBodyScroll` was called
        // twice for one lock. Alone that is absorbed by the depth guard; with the doc viewer open
        // over this one the depth goes 2 → 1 → 0 and the page behind the OTHER overlay starts
        // scrolling. `createLightbox` grew both halves of this guard at v21.86 and this hand-rolled
        // viewer never did — the cost of being the app's one documented lifecycle exception.
        if (!_viewerOpen) return;
        _viewerOpen = false;
        ++_bodySeq;   // an answer still on its way must not draw into, or re-open, a closed viewer
        // A tap answered with "none"/"couldn't load"/"Loading…" is DONE when dismissed. Left armed, a
        // Huddle landing later auto-opened over whatever the member had moved on to. (A LOCKED tap
        // stays armed on purpose — closing it is how the PIN form is reached; see showLockedMessage.)
        if (_disarmOnClose && !_autoOpened) _autoOpen = false;
        _disarmOnClose = false;
        const focusReturn = _viewerFocusReturn;
        _viewerFocusReturn = null;
        _pendingFinish = dismissOverlay(viewer, {
            onKey, focusReturn, backHandler: closeViewer,
            afterClose: () => { _pendingFinish = null; },
        });
    }
    /** @param {any} e */
    function onKey(e) {
        // ONLY THE TOPMOST OVERLAY ANSWERS THE KEYBOARD (v19.53). This is a `document` listener, so
        // it fired for a viewer sitting UNDERNEATH something else: a notification tap on a Circular
        // while the Huddle is open sets the hash, and `calendar-doc-viewer.js` opens over the top
        // without closing this one — both listen to `hashchange`, and neither closes the other.
        // One Escape then closed both, and `trapFocus` dragged Tab into a panel nobody could see.
        // That is the exact pair of symptoms the rule was written for; `createLightbox` has enforced
        // it since v19.53 and this viewer, being hand-rolled, was never brought along.
        // Fails OPEN, like the shared one — a suppressed Escape traps the reader.
        if (!_isTopOverlay(closeViewer)) return;
        if (e.key === 'Escape') { closeViewer(); return; }
        // Two kinds of Tab stop now: the ✕, and the body (and any table too wide for it), so the
        // keyboard can scroll the plan — index.html gives the body its tabindex.
        trapFocus(viewer, e);
    }

    /** What the dialog's status line says — the words of a message, or nothing over a Huddle. @param {string} words */
    function say(words) { if (status) status.textContent = words; }

    /**
     * A HUDDLE THIS DEVICE COULD NOT CHECK IS LABELLED (whole-app review, 10 Nov 2026; owner's default).
     * Offline, the listener answers from this device's cache, and the viewer showed whatever Huddle it
     * last saved under "📋 Daily Huddle" with nothing to say so. The Calendar's month grid answers the
     * same situation with "Saved copy — couldn't check for changes" (CALENDAR_DATA.md 18); this says
     * it in the same words and the same pill. ONLY while the device also says it is OFFLINE: a cached
     * answer on a working connection is usually just the first of two, and the SDK raises no second one
     * when the server merely agrees (QueryListener.shouldRaiseEvent — a sync-state change alone is
     * withheld unless includeMetadataChanges is set), so "couldn't check" there would be untrue.
     * @returns {HTMLElement|null}
     */
    function _savedCopyNote() {
        if (!_huddleFromCache || navigator.onLine !== false) return null;
        const note = document.createElement('div');
        note.className = 'calendar-stale-note';
        const words = document.createElement('span');
        words.setAttribute('role', 'status');
        words.textContent = 'Saved copy — couldn\'t check for changes';
        note.appendChild(words);
        return note;
    }

    /**
     * Wire an "open the file" button. It works from the moment it is drawn and reads whatever url has
     * arrived BY THE TAP (v24.23) — see showOpenFileButton.
     * @param {HTMLElement|null} btn @param {any} huddle @param {number} seq
     * @returns {Promise<void>} settles once the short-lived url has been asked for
     */
    async function _wireOpenFile(btn, huddle, seq) {
        /** @type {import('./document-url.js').SignedDocumentUrl|null} */
        let signed = null;
        btn?.addEventListener('click', () => {
            // Resolved AT THE TAP: a url minted when the prompt appeared can have lapsed by now,
            // and resolveDocumentOpenUrl passes a near-expiry one over for the stored url.
            // Defence-in-depth as before: only a recognised Firebase Storage HTTPS url is opened.
            const open = resolveDocumentOpenUrl({ signed, stored: huddle.storageUrl, fileType: huddle.fileType, storagePath: huddle.storagePath });
            if (open) {
                window.open(open.url, '_blank', 'noopener');
            } else {
                ++_bodySeq;
                body.innerHTML = '<p class="huddle-error">This Huddle link is unavailable — please contact the admin.</p>';
                say('This Huddle link is unavailable — please contact the admin.');
            }
        });
        // A null is ORDINARY — no IAM grant, a lapsed claim, a timeout — and the stored url is used.
        const minted = await fetchSignedDocumentUrl('huddle');
        if (seq === _bodySeq) signed = minted;   // superseded: that button is gone anyway
    }

    // PDF path, DOCX-conversion-failed path, AND the inline-render failure fallback (v16.23):
    // show an explicit button. A notification tap carries no in-page user activation, so calling
    // window.open() directly here would be blocked as a pop-up — and navigating the standalone
    // window itself (location.href) to the cross-origin file knocks the app out of standalone
    // mode (it comes back wrapped in browser chrome). Instead, open the viewer with an explicit
    // button: tapping it IS a real gesture, so the file opens as a separate Custom Tab over the
    // intact standalone app, and Back returns to the clean app.
    /** @param {any} huddle */
    async function showOpenFileButton(huddle) {
        // A notification tap on a cold start draws twice — the cached snapshot, then the server's —
        // and the older call's wait could finish second and hand its url to the newer call's button
        // (v24.23). The body number lets a finished wait know it has been superseded.
        const seq = ++_bodySeq;
        body.innerHTML = '<div class="huddle-open-prompt">'
            + '<p>The latest Huddle is ready.</p>'
            + '<button type="button" id="huddleOpenFileBtn" class="huddle-open-btn">📄 Open Huddle</button>'
            + '</div>';
        const saved = _savedCopyNote();
        if (saved) body.prepend(saved);
        say('');
        openViewer();
        // ── THE BUTTON WORKS FROM THE MOMENT IT IS DRAWN (v24.23) ───────────────────────────────
        // v24.19 attached the handler only after the short-lived url arrived, so for up to eight
        // seconds (longer on a cold function) the button did nothing, and focus stayed behind the
        // dialog. It is wired now, captured by reference so a later call's button is never touched,
        // and it reads whatever url has arrived BY THE TAP: the stored one until the signed one
        // lands. The click stays synchronous — awaiting inside it would spend the gesture that
        // makes the file open as a Custom Tab over the standalone app (see above this function).
        const openBtn = document.getElementById('huddleOpenFileBtn');
        const minting = _wireOpenFile(openBtn, huddle, seq);
        openBtn?.focus();
        await minting;
    }

    /**
     * A PICTURE IN THE HUDDLE IS NOT LOST WITHOUT A WORD (whole-app review, 10 Nov 2026; owner's
     * default). The sanitiser keeps no `img`, so a screenshot or diagram the author pasted vanished
     * from the in-app view with nothing to say it had been there. Pictures are still not drawn here —
     * the reader is told, and given the route to the file, which shows them.
     * @param {any} huddle @param {number} seq
     */
    function _picturesNote(huddle, seq) {
        const note = document.createElement('div');
        note.className = 'calendar-snapshot-note';
        note.append('This Huddle has pictures that aren’t shown here. ');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'huddleOpenOriginalBtn';
        btn.className = 'calendar-stale-retry';
        btn.textContent = 'Open the full Huddle';
        note.appendChild(btn);
        body.prepend(note);
        _wireOpenFile(btn, huddle, seq).catch(e => console.error('[Huddle] open-file link failed:', e));
    }

    // Render a DOCX-converted huddle inline — memoises sanitised HTML per storageUrl
    // so DOMPurify doesn't re-parse the same document on every reopen.
    /** @param {any} huddle */
    async function showInlineHuddle(huddle) {
        const seq = ++_bodySeq;
        try {
            if (huddle.storageUrl !== _sanitisedUrl) {
                _inlineSeq = seq;
                const html = await sanitiseHtml(huddle.htmlContent);
                // OVERTAKEN WHILE IT WAITED — a newer Huddle, a close, or a lock — or the gate shut by
                // some other road: draw nothing. A lock drops the memo too, so it is not written back.
                if (seq !== _bodySeq || !docAccess.has()) return;
                _inlineSeq = -1;
                _sanitisedHtml = html;
                _sanitisedUrl  = huddle.storageUrl;
            }
            body.innerHTML = _sanitisedHtml;
            wrapTables(body);
            if (_hasPictures(huddle.htmlContent)) _picturesNote(huddle, seq);
            const saved = _savedCopyNote();
            if (saved) body.prepend(saved);
            say('');
            openViewer();
            _tabbableWideTables(body);
            close?.focus();
        } catch (err) {
            if (seq !== _bodySeq) return;   // overtaken: whatever replaced it stands
            // DOMPurify failed to load (offline + evicted) or sanitise threw — never render
            // unsanitised HTML. Previously this left the viewer CLOSED with the notification tap
            // already consumed (_autoOpened=true) and no retry path — the tap silently did
            // nothing. Fall back to the Open-file button instead: the storageUrl is still
            // perfectly openable, matching the documented DOCX-conversion-failed UX (v16.23).
            console.error('[Huddle] inline render failed:', err);
            // `showOpenFileButton` is async since v24.19 and this call is fire-and-forget from
            // inside a catch, so its own failure has nowhere to go but an unhandled rejection.
            showOpenFileButton(huddle).catch(e => console.error('[Huddle] open-file fallback failed:', e));
        }
    }

    if (close) {
        close.addEventListener('click', closeViewer);
    }

    // NOT A DEAD TAP (v23.17). Before the gate, a `#huddle` tap with nothing loaded did nothing — the
    // hashchange handler only opens on `ready`. Silence is the wrong answer for a locked visitor:
    // the drawer link was there, they pressed it, and the reason nothing came is one they can act
    // on. Neutral prompt styling, not the error class — this is not a fault.
    function showLockedMessage() {
        ++_bodySeq;
        _disarmOnClose = false;
        body.innerHTML = '<div class="huddle-open-prompt">'
            + '<p>Enter the staff PIN, or sign in, to read the Daily Huddle.</p>'
            + '</div>';
        say('Enter the staff PIN, or sign in, to read the Daily Huddle.');
        openViewer();
        close?.focus();
    }

    /** Whether closing the viewer should drop the pending tap — see closeViewer. */
    let _disarmOnClose = false;
    /**
     * A tap with nothing to show — no Huddle yet, or it could not be read — is ANSWERED, not
     * ignored: the hashchange handler used to open only on `ready`, so the drawer link did nothing.
     * The pending tap stays armed while the viewer is up, so a Huddle (or a retry) arriving now
     * still opens in place of the message.
     * @param {'none'|'error'} state
     */
    function showStateMessage(state) {
        ++_bodySeq;
        body.innerHTML = state === 'none'
            ? '<div class="huddle-open-prompt"><p>No Daily Huddle has been uploaded yet.</p></div>'
            : '<div class="huddle-open-prompt"><p class="huddle-error">Couldn\'t load the Daily Huddle.</p>'
              + '<button type="button" id="huddleRetryBtn" class="huddle-open-btn">↻ Try again</button></div>';
        say(state === 'none' ? 'No Daily Huddle has been uploaded yet.' : 'Couldn\'t load the Daily Huddle.');
        const retry = document.getElementById('huddleRetryBtn');
        retry?.addEventListener('click', () => {
            _huddleState = 'loading';
            showLoading();
            _startHuddleSubscriptionSafe();
        });
        openViewer();
        _disarmOnClose = true;
        (retry ?? close)?.focus();
    }

    /**
     * A TAP MADE BEFORE THE FIRST ANSWER IS ANSWERED TOO (whole-app review, 10 Nov 2026). The
     * hashchange handler opened only on `ready`, `none` or `error`, so a tap while the listener had
     * not yet spoken drew nothing at all — and if the answer was then the offline cache's empty one,
     * it stayed unanswered until a second tap. It says "Loading…" now, and the wait has a real end
     * (`_armDeadline`): the old 8-second "safety timeout" tested for a state the Calendar never held
     * by then. Closing it gives up the tap, as closing a message does.
     */
    function showLoading() {
        _loadingSeq = ++_bodySeq;
        body.innerHTML = '<p id="huddleViewerLoading">Loading…</p>';
        say('');
        openViewer();
        _disarmOnClose = true;
        close?.focus();
        _armDeadline();
    }

    /** Still waiting on this tap with the viewer up? Then a settled failure should be shown in it. */
    const _awaitingInViewer = () => _autoOpen && !_autoOpened && _viewerOpen;
    /**
     * A tap still waiting at all — including a COLD one (a notification that opened the page),
     * where the viewer is not up yet. Left unanswered, a cold tap that settled on a failure showed
     * nothing, stayed armed, and a later successful resubscribe opened the Huddle over whatever
     * the member had moved on to. Answering opens the message, and closing it disarms the tap.
     */
    const _awaitingTap = () => _autoOpen && !_autoOpened && docAccess.has();

    /** @type {ReturnType<typeof setTimeout>|null} */
    let _deadline = null;
    /**
     * Give a waiting tap an end. When it passes with no Huddle and no "none" from the server, the
     * Huddle could not be loaded: a tap on screen as "Loading…" is told so, and so is a COLD tap that
     * has been holding off for the server's answer — the offline cache's empty answer included, which
     * a cold tap deliberately does not show (see the listener) and which otherwise left it unanswered
     * for as long as the device stayed offline, to open by itself whenever the signal came back.
     */
    function _armDeadline() {
        if (_deadline) clearTimeout(_deadline);
        _deadline = setTimeout(() => {
            _deadline = null;
            if (_huddleState !== 'loading' && _huddleState !== 'error') return;   // answered, or locked
            _huddleState = 'error';
            if (!_awaitingTap()) return;
            // Not over a message the member is already reading — only over "Loading…", or nothing.
            if (!_viewerOpen || _loadingSeq === _bodySeq) showStateMessage('error');
        }, ANSWER_DEADLINE_MS);
    }
    function _clearDeadline() { if (_deadline) { clearTimeout(_deadline); _deadline = null; } }

    /** @param {any} huddle */
    function _triggerAutoOpen(huddle) {
        _autoOpened = true;
        try {
            // Anonymous open-counter — consumed once per gesture (see _openCountPending above).
            // Identity for the admin exclusion: the SIGNED-IN member only (v25.00). It was the
            // selected member, and on the station PC that is whichever row was picked last — so a
            // selection left on the admin dropped every staff open there, while the admin's own
            // opens counted whenever another row was picked (usage-reporter.js header).
            if (_openCountPending) {
                _openCountPending = false;
                recordOpen('huddle', getSession()?.name ?? null);
            }
            if (huddle.htmlContent) {
                // DOCX converted to HTML server-side — render inline.
                showInlineHuddle(huddle);
            } else {
                // PDF, or DOCX where conversion failed. Async since v24.19 — see the other call
                // site; the surrounding try only catches what it awaits.
                showOpenFileButton(huddle).catch(e => console.error('[Huddle] open-file failed:', e));
            }
        } catch (err) {
            console.error('[Huddle] Auto-open error:', err);
        }
    }

    // ── A TAP IS NOT A BACK PRESS, AND LEAVES NO DEAD ENTRY (whole-app review, 10 Nov 2026) ─────────
    // A hash navigation fires `popstate` before `hashchange` (measured in Chromium; the HTML standard
    // says so), and overlay.js reads every popstate as Android Back: a Huddle tap closed whatever was
    // open — this viewer included, which the tap then re-opened while the close was still fading, and
    // the fade's end hid it again. The tap is claimed here instead, so nothing is closed by it.
    registerPopInterceptor(() => window.location.hash === '#huddle');
    /**
     * The entry the tap pushed is then taken back OFF the history rather than rewritten. Rewritten
     * (`replaceState`), it stayed as a second copy of the page — a Back press that did nothing, one
     * more for every Huddle read (measured: two presses to leave after a notification-style tap, where
     * one is right). `then` runs once that Back has landed, so the viewer's own entry is pushed after
     * it — pushed before, the Back would have taken the viewer's entry instead (overlay.js,
     * "WHEN HAS A BUTTON-CLOSE ACTUALLY LANDED?"). calendar-doc-viewer.js does the same for its hashes.
     * @param {() => void} then
     */
    function _consumeHashEntry(then) {
        try {
            history.back();
            suppressNextPop();   // the echo is ours, not a Back press
        } catch {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        whenHistorySettled(then);
    }

    // When the page is already open and the SW navigates it to #huddle (hash-only
    // navigation, no page reload), the IIFE has already run with _autoOpen=false.
    // The hashchange event fires instead — set _autoOpen and open immediately if
    // data is already loaded, or let the subscription callback catch it.
    window.addEventListener('hashchange', () => {
        if (window.location.hash !== '#huddle') return;
        _consumeHashEntry(() => {
            _autoOpen   = true;
            _autoOpened = false;
            _openCountPending = true;   // a fresh user gesture — arm one open count (v18.22)
            // Locked: say so, and keep `_autoOpen` armed so the grant that follows finishes the tap.
            if (!docAccess.has()) { showLockedMessage(); return; }
            if (_huddleState === 'ready' && _huddleData) _triggerAutoOpen(_huddleData);
            else if (_huddleState === 'none' || _huddleState === 'error') showStateMessage(_huddleState);
            else showLoading();   // no answer yet: say so, and bound the wait
        });
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
            if (_awaitingTap()) showStateMessage('error');
        });
    }
    let _subGen = 0;
    async function startHuddleSubscription() {
        const _gen = ++_subGen;
        if (_unsubHuddle) { _unsubHuddle(); _unsubHuddle = null; }
        // REFUSED AT SOURCE while the gate is shut (v23.17): no query is issued, cached or live. The
        // `onChange(true)` below is what starts it when access arrives. A lock that lands DURING the
        // wait is caught by the generation guard, because the lock branch below advances it (v24.56 —
        // until then nothing did, and a slow `authReady` attached the listener to a locked page).
        if (!docAccess.has()) { _huddleState = 'locked'; return; }
        // LISTENING AGAIN MEANS LOADING AGAIN. The state stayed 'locked' from init until the first
        // answer, so a tap in that window matched no branch of the hashchange handler and drew nothing.
        if (_huddleState !== 'ready') _huddleState = 'loading';
        if (_autoOpen && !_autoOpened) _armDeadline();   // a tap is already waiting on this answer
        // Attach only once a session exists (AUTH_PLAN.md → E1). Attaching too early is worse than
        // attaching late: an onSnapshot that hits permission-denied is TERMINATED, not retried, and
        // today only recovers on the next visibilitychange — useless to someone who just tapped a
        // notification. The await is UNBOUNDED (it settles when Auth has initialised — past the
        // `accounts:lookup`, up to the SDK's 30s timeout); the deadline bounds a TAP's wait for an
        // answer, not this one. Bounding this would buy nothing: Firestore itself holds the
        // listener until Auth initialises (CALENDAR_DATA.md 10). The generation guard stops the
        // visibilitychange re-subscribe from stacking two listeners when two calls await concurrently.
        await authReady;
        if (_gen !== _subGen) return;
        _unsubHuddle = subscribeToLatestHuddle(
            /** @param {any} huddle @param {boolean} [fromCache] */ (huddle, fromCache) => {
                if (!docAccess.has()) return;   // a snapshot that outlived a lock delivers nothing
                const prevUrl = _huddleData?.storageUrl;
                if (!huddle) {
                    // ONLY THE SERVER CAN SAY "NONE" (48-hour review). An empty answer from the local
                    // cache alone means this device could not ask — the SDK raises one when offline —
                    // so it is 'error' ("Couldn't load", with Try again), never "No Daily Huddle has
                    // been uploaded yet", which is a claim about the world. A server answer that
                    // follows replaces it. A cold tap still waits for the server either way: a fresh
                    // device's empty cache answers first, and would flash over a Huddle that exists.
                    // (The deadline answers that wait if the server never does.)
                    const state = fromCache ? 'error' : 'none';
                    _huddleState = state;
                    if (state === 'none') _clearDeadline();
                    if (_awaitingInViewer() || (!fromCache && _awaitingTap())) showStateMessage(state);
                } else {
                    _huddleData  = huddle;
                    _huddleFromCache = !!fromCache;
                    _huddleState = 'ready';
                    _clearDeadline();
                    if (_autoOpen && !_autoOpened) {
                        _triggerAutoOpen(huddle);
                    } else if (_autoOpen && _autoOpened
                               && (_viewerOpen || _inlineWaiting())
                               && huddle.storageUrl !== prevUrl) {
                        // Viewer is open showing a stale huddle — Firestore delivered a fresher one
                        // (race: notification tap beat the WebSocket reconnect). OR the stale one is
                        // still being sanitised for its first showing, and has not opened the viewer
                        // yet: it is overtaken here rather than drawn as the latest.
                        _triggerAutoOpen(huddle);
                    }
                }
            },
            /** @param {any} err */ (err) => {
                _huddleState = 'error';
                console.warn('[Huddle] Could not fetch latest huddle:', err);
                if (_awaitingTap()) showStateMessage('error');
            }
        );
    }
    _startHuddleSubscriptionSafe();

    // THE GATE MOVES; THE SUBSCRIPTION FOLLOWS (v23.17). Opening starts the listener — for a
    // notification tap that landed on the PIN card, `_autoOpen` is still armed, so the first
    // snapshot opens the Huddle: the deep link survives the unlock. Shutting tears the listener
    // down and DROPS what it delivered, so a re-locked screen holds nothing a later tap could show;
    // if the viewer is open at that moment it says so rather than sitting on a document its reader
    // is no longer entitled to — and, as for a locked tap, the PIN or sign-in it asks for then
    // reopens it (until 10 Nov 2026 the message asked for the PIN and the PIN brought nothing back).
    docAccess.onChange((open) => {
        if (open) { _startHuddleSubscriptionSafe(); return; }
        ++_subGen;   // a subscription still awaiting authReady must not attach after this
        const showing = _viewerOpen || _inlineWaiting();   // read before the bump below ends a render's wait
        ++_bodySeq;  // …and a render still waiting on the sanitiser must not draw after this
        if (_unsubHuddle) { _unsubHuddle(); _unsubHuddle = null; }
        _huddleData = null; _huddleFromCache = false; _sanitisedHtml = null; _sanitisedUrl = null;
        _huddleState = 'locked';
        _clearDeadline();
        if (showing) {
            _autoOpen = true; _autoOpened = false;
            showLockedMessage();
        }
    });

    // If the tab was discarded while still loading — OR the subscription errored (an onSnapshot
    // error terminates the listener; the deadline also turns a tap's 'loading' into 'error') —
    // re-subscribe on return so the Huddle doesn't stay permanently broken until a full reload.
    // startHuddleSubscription unsubscribes any prior listener first, so this can't stack listeners (v16.19).
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && docAccess.has() && (_huddleState === 'loading' || _huddleState === 'error')) {
            _startHuddleSubscriptionSafe();
        }
    });
}
