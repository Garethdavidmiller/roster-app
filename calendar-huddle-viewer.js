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
 *   htmlContent present (a DOCX converted to HTML — by ingestHuddle, or in the admin's browser
 *     for a manual upload, huddle.js) → render inline in viewer.
 *   No htmlContent (PDF, or DOCX where conversion failed) → show an in-overlay
 *     "📄 Open Huddle" button. The viewer is reached only via the #huddle hash (the drawer link
 *     and notification taps alike). A notification tap carries no user activation, so
 *     window.open at open time would be pop-up-blocked, and location.href to the cross-origin
 *     file would break standalone mode. Tapping the button IS a real gesture.
 * Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".
 */

// DOMPurify is self-hosted at ./purify.es.mjs (v3.4.18) and loaded LAZILY — only a DOCX-converted
// huddle needs it, so a static import would put ~45 KB on every cold calendar load. (Still precached
// by the service worker.) To upgrade: npm pack dompurify@<new>, extract package/dist/purify.es.mjs,
// replace the file, RE-ADD the `// @ts-nocheck` first line (tsc follows this dynamic import despite
// the jsconfig exclude), and update the version here (dependency-pin-parity.test.mjs checks it).
/** @type {Promise<any>|null} */
let _purifyPromise = null;
function _loadPurify() {
    // Reset on rejection: ||= never re-assigns over a rejected (truthy) promise, so one failed load
    // (offline + evicted cache) would break every DOCX render until reload.
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
import { recordDocDate } from './doc-dates.js';

// Module-level state — set once at startup and survives the page lifetime.
/** @type {any} */
let _huddleData  = null;
let _huddleState = 'loading'; // 'loading' | 'ready' | 'none' | 'error' | 'locked'
/** Whether `_huddleData` was answered by this device's cache alone (the listener passes it). */
let _huddleFromCache = false;
/** Set when a waiting tap's deadline passed with no word from the server; cleared by the server's next
 *  answer. While set, a cached Huddle is shown at once, labelled a saved copy — see `_mustWaitForServer`. */
let _serverWaitExpired = false;
/** Whether the current subscription has been ATTACHED — the server asked. Its deadline is armed before
 *  the wait for a session, and a deadline that passed in that wait proves nothing about the server, so
 *  it must not set `_serverWaitExpired` (D-L2). */
let _serverAsked = false;
/** The file a Huddle record names. Its STORAGE PATH, never its url: Operations → Document links →
 *  Replace gives the same file a new url, and that is not a new Huddle. The url stands in only for a
 *  record with no path. @param {any} h */
const _fileOf = (h) => h?.storagePath ?? h?.storageUrl;

/** How long a tap waits on the Huddle's first answer before it is told it could not be loaded. A
 *  late answer still replaces the message while it is on screen, so the bound costs nothing. */
const ANSWER_DEADLINE_MS = 8000;

/** A tap the LOCK was holding when the page unloaded — see `initHuddleViewer`. sessionStorage, so it
 *  lives with this tab and no other; `myb_held_huddle_tap` is read and written only here. */
const HELD_TAP_KEY = 'myb_held_huddle_tap';
/** How old that record may be when the next load reads it. It carries a tap across a RELOAD — a
 *  sign-in on a Calendar granted before reloads the page (calendar-access.js → `finishSignIn`) — not into a visit
 *  nobody would connect with the tap. */
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
 * Strict tag allowlist plus only the two structural table attributes, colspan/rowspan: Mammoth emits
 * them for merged Word cells, and without them a duty board collapses into the wrong columns.
 * ONLY the two: DOMPurify passes every `data-*` and `aria-*` attribute BEFORE it consults
 * ALLOWED_ATTR unless told not to, so the two flags below are what make that true — otherwise the
 * next delegated `[data-…]` click handler would be reachable from a Huddle document.
 * `style` is deliberately NOT allowed (tried and reverted):
 *   - Mammoth does not read Word's text colour or shading, so style carried only fixed pt column
 *     widths that broke the mobile layout.
 *   - This DOMPurify build passes `style` values through UNMODIFIED (no url()/position:fixed
 *     stripping), and there is no second layer sanitising inline CSS.
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
 * default, with no `convertImage`), and the sanitiser above drops it.
 * @param {string} html
 */
function _hasPictures(html) {
    return /<img\b/i.test(html);
}

/**
 * Give every table its own horizontal scroll box.
 *
 * WHY: on a 412px phone a five-column Huddle scrolled the WHOLE document sideways, so the date
 * heading and the Shift and Call Sign columns — the ones that say whose row you are reading — slid
 * off screen.
 *
 * Done HERE rather than in the sanitiser or server-side, deliberately: `style` is stripped, so there
 * is no markup hook, and a wrapper inside ALLOWED_TAGS would trust the document to carry its own
 * layout. This wraps what actually rendered, after sanitising, and touches nothing else.
 *
 * @param {HTMLElement} root
 */
export function wrapTables(root) {
    for (const table of [...root.querySelectorAll('table')]) {
        // Idempotent: showInlineHuddle can re-render the memoised HTML on reopen.
        if (table.parentElement?.classList.contains('huddle-table-wrap')) continue;
        const wrap = document.createElement('div');
        wrap.className = 'huddle-table-wrap';
        // ── THE STICKY JOB COLUMN IS MARKED, NOT SELECTED ───────────────────────────────────
        //
        // The CSS pins column 1 so a scrolled row still says whose it is. `td:first-child` is not
        // the same statement: in the real Huddle a job cell spans three rows, so the rows beneath it
        // write no cell in column 1 and `td:first-child` resolved to the CALL SIGN. Disabling the
        // pin for rowspan tables would cost it exactly where it earns its keep. So the column is
        // COMPUTED — `firstColumnMask` performs the browser's grid walk — and only genuine column-1
        // cells are classed; a row that writes none is covered by the spanning cell above it.
        //
        // `table.rows` is FLAT — it concatenates thead, every tbody and tfoot — and flattening loses
        // the row-group boundary a span cannot cross: a `rowspan="5"` cell in a one-row `<thead>`
        // leaves the first `<tbody>` cell in column 1, so the boundaries below are needed.
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
 * reach cannot be scrolled (WCAG 2.1.1; axe's scrollable-region-focusable). The sanitised Huddle can
 * hold nothing focusable, so such a box is made a Tab stop itself. Measured AFTER the viewer is on
 * screen: a hidden viewer has no widths to compare.
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
 *   attaches (AUTH_AND_SESSIONS.md → "The two-phase load (E1)"). Defaults to already-resolved.
 *   docAccess — THE DOCUMENT GATE (calendar-doc-access.js, CALENDAR_DATA.md 15). The subscription
 *   attaches only while it is open and is torn down when it shuts; a `#huddle` tap while shut shows a
 *   message rather than doing nothing, and is FINISHED when access arrives — in place, or across the
 *   reload a sign-in still makes on a page granted before (the held tap is carried across it).
 *   Defaults to always-open, which is what every page other than the Calendar means.
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
    // A COLD tap's entry is the page's own, so its hash is rewritten in place; a tap on an open page
    // pushed an entry of its own, which is taken back off the history instead (the hashchange handler).
    // ── A TAP THE LOCK HELD SURVIVES A RELOAD ────────────────────────────────────────────────────
    // A sign-in grants in place on a page not yet granted, and finishes the tap there; one that still
    // reloads (`finishSignIn`'s fallback) needs the tap the lock is holding written down as the page
    // unloads (`pagehide`, below) and taken back here.
    const held = _takeHeldTap();
    let _autoOpen = window.location.hash === '#huddle';
    // Open-counter arming: one count per user open GESTURE (#huddle arrival), consumed by the first
    // _triggerAutoOpen it produces. Counting inside _triggerAutoOpen would double-count the common
    // notification path (the cached snapshot, then the server's fresher one re-triggers) and count an
    // admin re-upload landing while a viewer was open. A carried tap keeps its own count, so the
    // reload does not count the gesture twice.
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
    /** The file whose sanitised html `_sanitisedHtml` holds (`_fileOf`). @type {any} */
    let _sanitisedFile = null;
    /** @type {any} */
    let _sanitisedHtml = null;

    // ── WHICH WRITE TO THE VIEWER IS CURRENT ─────────────────────────────────────────────────────
    // Every write to the body takes the next number, and so do a close and a lock. An answer that had
    // to WAIT — a short-lived url for the Open button, the sanitiser's first load for an inline Huddle —
    // compares its number when it wakes, and if anything has happened since it draws nothing, opens
    // nothing and focuses nothing: otherwise an older Huddle is drawn as the latest, a Huddle over the
    // sign-in card, or the viewer re-opened inside a close's fade (leaving the page scroll-locked).
    let _bodySeq = 0;
    /** The body write still waiting on the sanitiser, if it is still current (else -1). */
    let _inlineSeq = -1;
    /** The body write that put "Loading…" up — the deadline answers only a wait still on screen. */
    let _loadingSeq = -1;
    const _inlineWaiting = () => _inlineSeq === _bodySeq;

    function openViewer() {
        // RE-OPENED WHILE A CLOSE IS STILL FADING: finish that close first, as createLightbox does.
        // Left to run, its finisher removed `.visible` from the viewer just opened — which then sat
        // "open", invisible, with the page behind it scroll-locked.
        if (_pendingFinish) { const finish = _pendingFinish; _pendingFinish = null; finish(); }
        if (!_viewerOpen) {
            // Capture focus return only on fresh open — not on a stale-huddle re-open, where the
            // return could be an element about to be overwritten by body.innerHTML.
            _viewerFocusReturn = document.activeElement;
            lockBodyScroll();
            // Push history state and attach keydown only once per open — a stale-huddle re-trigger
            // would push a duplicate entry and a second listener (Android Back would need two presses).
            _pushOverlayState(closeViewer);
            document.addEventListener('keydown', onKey);
        }
        _viewerOpen = true;
        viewer.classList.add('visible');
        // A CLOSE BEFORE THIS FRAME RETIRES IT, as createLightbox's does: an Escape before a slow
        // engine draws, or a tab that runs no frames while hidden, must not fade the viewer back in.
        requestAnimationFrame(() => { if (_viewerOpen) viewer.classList.add('open'); });
    }
    function closeViewer() {
        // ALREADY CLOSING? Do nothing. The ✕ stays clickable through the fade, and a second
        // `dismissOverlay` calls `unlockBodyScroll` twice for one lock — with the doc viewer open over
        // this one, the page behind the OTHER overlay starts scrolling. `createLightbox` has the same
        // guard; this hand-rolled viewer is the app's one documented lifecycle exception.
        if (!_viewerOpen) return;
        _viewerOpen = false;
        ++_bodySeq;   // an answer still on its way must not draw into, or re-open, a closed viewer
        // A tap answered with "none"/"couldn't load"/"Loading…" is DONE when dismissed. Left armed, a
        // Huddle landing later auto-opened over whatever the member had moved on to. (A LOCKED tap
        // stays armed on purpose — closing it is how the sign-in form is reached; see showLockedMessage.)
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
        // ONLY THE TOPMOST OVERLAY ANSWERS THE KEYBOARD. This is a `document` listener, and the
        // Circular's viewer (`calendar-doc-viewer.js`) can open over this one without closing it: one
        // Escape would close both, and `trapFocus` would drag Tab into a panel nobody could see.
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
     * A HUDDLE THIS DEVICE COULD NOT CHECK IS LABELLED (owner's default). Offline, the listener answers
     * from this device's cache; this says so in the month grid's words and pill, "Saved copy — couldn't
     * check for changes" (CALENDAR_DATA.md 18). Only once checking has actually failed: while the
     * device says it is OFFLINE, or once a tap has waited out its deadline with no word from the server
     * (`_serverWaitExpired`). A cached answer on a working connection is otherwise the first of two —
     * and a waiting tap does not show it at all (`_mustWaitForServer`).
     * @returns {HTMLElement|null}
     */
    function _savedCopyNote() {
        if (!_huddleFromCache || (navigator.onLine !== false && !_serverWaitExpired)) return null;
        const note = document.createElement('div');
        note.className = 'calendar-stale-note';
        const words = document.createElement('span');
        words.setAttribute('role', 'status');
        words.textContent = 'Saved copy — couldn’t check for changes';
        note.appendChild(words);
        _savedNote = note;
        return note;
    }
    /** The saved-copy label on screen, if any — taken down when the server answers. @type {HTMLElement|null} */
    let _savedNote = null;

    /**
     * MUST A WAITING TAP WAIT FOR THE SERVER? A notification says a NEW Huddle has arrived, and the
     * local cache cannot hold it yet: its first answer is yesterday's, and Open would open yesterday's
     * file. So while the device is online a tap waits for the server's answer (the listener raises one
     * even when the server merely agrees — documents-client.js), within the tap's deadline; past it, the
     * cached Huddle is shown, labelled a saved copy. Offline, the labelled copy is shown at once.
     */
    const _mustWaitForServer = () => _huddleFromCache && navigator.onLine !== false && !_serverWaitExpired;

    /**
     * Wire an "open the file" button. It works from the moment it is drawn and reads whatever url has
     * arrived BY THE TAP — see showOpenFileButton.
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
            // The SAME FILE's latest record, if one has come since: Document links → Replace changes
            // the url and not the file, so it does not redraw the viewer (`_fileOf`).
            const rec = _fileOf(_huddleData) === _fileOf(huddle) ? _huddleData : huddle;
            const open = resolveDocumentOpenUrl({ signed, stored: rec.storageUrl, fileType: rec.fileType, storagePath: rec.storagePath });
            if (open) {
                window.open(open.url, '_blank', 'noopener');
            } else {
                ++_bodySeq;
                body.innerHTML = '<p class="huddle-error">This Huddle link is unavailable — please tell the admin.</p>';
                say('This Huddle link is unavailable — please tell the admin.');   // the doc viewer's words
            }
        });
        // A null is ORDINARY — no IAM grant, a lapsed claim, a timeout — and the stored url is used.
        const minted = await fetchSignedDocumentUrl('huddle');
        if (seq === _bodySeq) signed = minted;   // superseded: that button is gone anyway
    }

    // PDF path, DOCX-conversion-failed path, AND the inline-render failure fallback: show an
    // explicit button. A notification tap carries no in-page user activation, so window.open() here
    // would be blocked as a pop-up — and navigating the standalone window (location.href) to the
    // cross-origin file knocks the app out of standalone mode. Tapping the button IS a real gesture,
    // so the file opens as a separate Custom Tab over the intact standalone app.
    /** @param {any} huddle */
    async function showOpenFileButton(huddle) {
        // A cold-start tap draws twice — the cached snapshot, then the server's — and the older call's
        // wait could finish second; the body number lets a finished wait know it has been superseded.
        const seq = ++_bodySeq;
        body.innerHTML = '<div class="huddle-open-prompt">'
            + '<p>The latest Huddle is ready.</p>'
            + '<button type="button" id="huddleOpenFileBtn" class="huddle-open-btn"><span aria-hidden="true">📄</span> Open Huddle</button>'
            + '</div>';
        const saved = _savedCopyNote();
        if (saved) body.prepend(saved);
        say('');
        openViewer();
        // ── THE BUTTON WORKS FROM THE MOMENT IT IS DRAWN ─────────────────────────────────────────
        // Wired now, captured by reference so a later call's button is never touched, and it reads
        // whatever url has arrived BY THE TAP: the stored one until the signed one lands. The click
        // stays synchronous — awaiting inside it would spend the gesture that makes the file open as
        // a Custom Tab over the standalone app (see above this function).
        const openBtn = document.getElementById('huddleOpenFileBtn');
        const minting = _wireOpenFile(openBtn, huddle, seq);
        openBtn?.focus();
        await minting;
    }

    /**
     * A PICTURE IN THE HUDDLE IS NOT LOST WITHOUT A WORD (owner's default). The sanitiser keeps no
     * `img`; pictures are still not drawn here — the reader is told, and given the route to the
     * file, which shows them.
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

    // Render a DOCX-converted huddle inline — memoises sanitised HTML per FILE (`_fileOf`)
    // so DOMPurify doesn't re-parse the same document on every reopen.
    /** @param {any} huddle */
    async function showInlineHuddle(huddle) {
        const seq = ++_bodySeq;
        try {
            if (_fileOf(huddle) !== _sanitisedFile) {
                _inlineSeq = seq;
                const html = await sanitiseHtml(huddle.htmlContent);
                // OVERTAKEN WHILE IT WAITED — a newer Huddle, a close, or a lock — or the gate shut by
                // some other road: draw nothing. A lock drops the memo too, so it is not written back.
                if (seq !== _bodySeq || !docAccess.has()) return;
                _inlineSeq = -1;
                _sanitisedHtml = html;
                _sanitisedFile = _fileOf(huddle);
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
            // unsanitised HTML, and never leave the tap silently consumed. Fall back to the Open-file
            // button: the storageUrl is still openable (the DOCX-conversion-failed UX).
            console.error('[Huddle] inline render failed:', err);
            // Fire-and-forget from inside a catch, so its own failure is caught here.
            showOpenFileButton(huddle).catch(e => console.error('[Huddle] open-file fallback failed:', e));
        }
    }

    if (close) {
        close.addEventListener('click', closeViewer);
    }

    // NOT A DEAD TAP. A `#huddle` tap while locked is told why nothing came — the reason is one
    // the visitor can act on. Neutral prompt styling, not the error class — this is not a fault.
    function showLockedMessage() {
        ++_bodySeq;
        _disarmOnClose = false;
        body.innerHTML = '<div class="huddle-open-prompt">'
            + '<p>Sign in to read the Daily Huddle.</p>'
            + '</div>';
        say('Sign in to read the Daily Huddle.');
        openViewer();
        close?.focus();
    }

    /** Whether closing the viewer should drop the pending tap — see closeViewer. */
    let _disarmOnClose = false;
    /**
     * A tap with nothing to show — no Huddle yet, or it could not be read — is ANSWERED, not ignored.
     * The pending tap stays armed while the viewer is up, so a Huddle (or a retry) arriving now still
     * opens in place of the message.
     * @param {'none'|'error'} state
     */
    function showStateMessage(state) {
        ++_bodySeq;
        body.innerHTML = state === 'none'
            ? '<div class="huddle-open-prompt"><p>No Daily Huddle has been uploaded yet.</p></div>'
            : '<div class="huddle-open-prompt"><p class="huddle-error">Couldn’t load the Daily Huddle.</p>'
              + '<button type="button" id="huddleRetryBtn" class="huddle-open-btn">↻ Try again</button></div>';
        say(state === 'none' ? 'No Daily Huddle has been uploaded yet.' : 'Couldn’t load the Daily Huddle.');
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
     * A TAP MADE BEFORE THE FIRST ANSWER IS ANSWERED TOO: it says "Loading…", and the wait has a real
     * end (`_armDeadline`). Otherwise a tap before the listener spoke drew nothing, and an empty
     * offline-cache answer left it unanswered until a second tap. Closing it gives up the tap, as
     * closing a message does.
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
     * A tap still waiting at all — including a COLD one (a notification that opened the page), where
     * the viewer is not up yet. Left unanswered, a cold tap that settled on a failure stayed armed, and
     * a later resubscribe opened the Huddle over whatever the member had moved on to.
     */
    const _awaitingTap = () => _autoOpen && !_autoOpened && docAccess.has();

    /** @type {ReturnType<typeof setTimeout>|null} */
    let _deadline = null;
    /**
     * Give a waiting tap an end. When it passes with no Huddle and no "none" from the server, the
     * Huddle could not be loaded: a tap on screen as "Loading…" is told so, and so is a COLD tap that
     * has been holding off for the server's answer — the offline cache's empty answer included, which
     * a cold tap deliberately does not show and which otherwise left it to open by itself whenever the
     * signal came back.
     */
    function _armDeadline() {
        if (_deadline) clearTimeout(_deadline);
        _deadline = setTimeout(() => {
            _deadline = null;
            // A tap waited, and the server said nothing — until it does. Only once it was ASKED: a
            // deadline that passed while the subscription still waited for a session leaves the next
            // cached answer to wait for the server in its turn, on a deadline of its own.
            if (_serverAsked) _serverWaitExpired = true;
            // Only this device's cache has answered, and the tap was held for the server: show what it
            // holds now, labelled a saved copy (`_savedCopyNote`), in place of whatever the wait showed.
            if (_huddleState === 'ready' && _huddleData && _huddleFromCache) {
                if (_awaitingTap()) _triggerAutoOpen(_huddleData);
                return;
            }
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
            // Identity for the admin exclusion: the SIGNED-IN member only, never the selected member
            // (on the station PC that is whichever row was picked last; usage-reporter.js header).
            if (_openCountPending) {
                _openCountPending = false;
                recordOpen('huddle', getSession()?.name ?? null);
            }
            if (huddle.htmlContent) {
                // A DOCX converted to HTML at upload (the server's ingest or the admin's browser) — render inline.
                showInlineHuddle(huddle);
            } else {
                // PDF, or DOCX where conversion failed. Async — the surrounding try only catches
                // what it awaits.
                showOpenFileButton(huddle).catch(e => console.error('[Huddle] open-file failed:', e));
            }
        } catch (err) {
            console.error('[Huddle] Auto-open error:', err);
        }
    }

    // ── A TAP IS NOT A BACK PRESS, AND LEAVES NO DEAD ENTRY ───────────────────────────────────────
    // A hash navigation fires `popstate` before `hashchange` (measured in Chromium; the HTML standard
    // says so), and overlay.js reads every popstate as Android Back: a Huddle tap would close whatever
    // was open, this viewer included. The tap is claimed here instead, so nothing is closed by it.
    registerPopInterceptor(() => window.location.hash === '#huddle');
    /**
     * The entry the tap pushed is then taken back OFF the history rather than rewritten: rewritten, it
     * stayed as a second copy of the page — a Back press that did nothing. `then` runs once that Back
     * has landed, so the viewer's own entry is pushed after it — pushed before, the Back would have
     * taken the viewer's entry instead (overlay.js, "WHEN HAS A BUTTON-CLOSE ACTUALLY LANDED?").
     * calendar-doc-viewer.js does the same for its hashes.
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
            _openCountPending = true;   // a fresh user gesture — arm one open count
            // Locked: say so, and keep `_autoOpen` armed so the grant that follows finishes the tap.
            if (!docAccess.has()) { showLockedMessage(); return; }
            if (_huddleState === 'ready' && _huddleData && !_mustWaitForServer()) _triggerAutoOpen(_huddleData);
            else if (_huddleState === 'none' || _huddleState === 'error') showStateMessage(_huddleState);
            else showLoading();   // no answer yet, or the cache's alone: say so, and bound the wait
        });
    });

    // Real-time listener — fires from IndexedDB cache on repeat visits (near-instant)
    // then again when the server confirms. Also fires when a new huddle is uploaded,
    // so staff don't need to refresh the page.
    /** @type {any} */
    let _unsubHuddle = null;
    // startHuddleSubscription is async (it awaits a session), so both fire-and-forget call sites need
    // this wrapper: a synchronous throw from subscribeToLatestHuddle would otherwise be an UNHANDLED
    // REJECTION rather than the viewer's own error state.
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
        _serverAsked = false;
        // REFUSED AT SOURCE while the gate is shut: no query is issued, cached or live. The
        // `onChange(true)` below starts it when access arrives. A lock that lands DURING the wait is
        // caught by the generation guard, because the lock branch below advances it.
        if (!docAccess.has()) { _huddleState = 'locked'; return; }
        // LISTENING AGAIN MEANS LOADING AGAIN: left 'locked' until the first answer, a tap in that
        // window matched no branch of the hashchange handler and drew nothing.
        if (_huddleState !== 'ready') _huddleState = 'loading';
        if (_autoOpen && !_autoOpened) _armDeadline();   // a tap is already waiting on this answer
        // Attach only once a session exists (AUTH_AND_SESSIONS.md → "The two-phase load (E1)"). Attaching too early is worse than
        // attaching late: an onSnapshot that hits permission-denied is TERMINATED, not retried. The
        // await is UNBOUNDED (it settles when Auth has initialised); the deadline bounds a TAP's wait,
        // not this one — Firestore itself holds the listener until Auth initialises (CALENDAR_DATA.md
        // 10). The generation guard stops the visibilitychange re-subscribe from stacking two listeners.
        await authReady;
        if (_gen !== _subGen) return;
        _serverAsked = true;
        _unsubHuddle = subscribeToLatestHuddle(
            /** @param {any} huddle @param {boolean} [fromCache] */ (huddle, fromCache) => {
                if (!docAccess.has()) return;   // a snapshot that outlived a lock delivers nothing
                // The ☰ menu's date for the Huddle (doc-dates.js): what this listener delivers, and only the
                // server may say there is none.
                if (huddle) recordDocDate('huddle', huddle.date ?? null); else if (!fromCache) recordDocDate('huddle', null);
                const prevFile = _fileOf(_huddleData);
                if (!fromCache) {
                    // The server has answered: the wait is over, and a label saying it could not be
                    // asked comes down (a different Huddle is redrawn below anyway).
                    _serverWaitExpired = false;
                    _savedNote?.remove(); _savedNote = null;
                }
                if (!huddle) {
                    // ONLY THE SERVER CAN SAY "NONE". An empty answer from the local cache alone means
                    // this device could not ask, so it is 'error' ("Couldn't load", with Try again),
                    // never "No Daily Huddle has been uploaded yet", which is a claim about the world.
                    // A cold tap still waits for the server either way: a fresh device's empty cache
                    // answers first, and would flash over a Huddle that exists (the deadline answers
                    // that wait if the server never does).
                    const state = fromCache ? 'error' : 'none';
                    _huddleState = state;
                    if (state === 'none') _clearDeadline();
                    if (_awaitingInViewer() || (!fromCache && _awaitingTap())) showStateMessage(state);
                } else {
                    _huddleData  = huddle;
                    _huddleFromCache = !!fromCache;
                    _huddleState = 'ready';
                    // A tap still waiting does not open on the cache's answer while the server can be
                    // asked (`_mustWaitForServer`): the deadline, still running, shows it labelled if the
                    // server never answers.
                    if (_autoOpen && !_autoOpened && _mustWaitForServer()) { if (!_deadline) _armDeadline(); return; }
                    _clearDeadline();
                    if (_autoOpen && !_autoOpened) {
                        _triggerAutoOpen(huddle);
                    } else if (_autoOpen && _autoOpened
                               && (_viewerOpen || _inlineWaiting())
                               && _fileOf(huddle) !== prevFile) {
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

    // THE GATE MOVES; THE SUBSCRIPTION FOLLOWS. Opening starts the listener — a tap that landed on a
    // sign-in card is still armed, so the first snapshot opens the Huddle. Shutting tears the listener
    // down and DROPS what it delivered, so a re-locked screen holds nothing a later tap could show; an
    // open viewer says so, and, as for a locked tap, the sign-in it asks for then reopens it.
    docAccess.onChange((open) => {
        if (open) { _startHuddleSubscriptionSafe(); return; }
        ++_subGen;   // a subscription still awaiting authReady must not attach after this
        const showing = _viewerOpen || _inlineWaiting();   // read before the bump below ends a render's wait
        ++_bodySeq;  // …and a render still waiting on the sanitiser must not draw after this
        if (_unsubHuddle) { _unsubHuddle(); _unsubHuddle = null; }
        _huddleData = null; _huddleFromCache = false; _sanitisedHtml = null; _sanitisedFile = null;
        _serverWaitExpired = false; _serverAsked = false; _savedNote = null;   // the next grant's tap waits for its own answer
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
    // startHuddleSubscription unsubscribes any prior listener first, so this can't stack listeners.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && docAccess.has() && (_huddleState === 'loading' || _huddleState === 'error')) {
            _startHuddleSubscriptionSafe();
        }
    });
}
