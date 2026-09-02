// @ts-check
/**
 * nav-panel.js — Slide-out navigation panel, shared by all seven app pages.
 *
 * Injects overlay + drawer HTML into document.body, then wires the burger
 * button (#navMenuBtn). Uses the same history.pushState / popstate pattern
 * as the existing overlay helpers in calendar-app.js so Android Back closes the panel.
 *
 * Usage (call once, after DOM is ready — ES modules are deferred by default):
 *   import { initNavPanel } from './nav-panel.js';
 *   initNavPanel({ currentPage: 'calendar', memberName: 'G. Miller', onSignOut: fn });
 *   // memberName + onSignOut are optional; omit both to suppress the footer.
 *
 * The footer also hosts a push-notification bell toggle (🔔/🔕) when the device
 * supports Web Push. All push logic lives in notif.js — this file only renders
 * and refreshes the bell.
 *
 * ── THREE ZONES, ONE IDIOM EACH (v20.06) ────────────────────────────────────────────────────────
 *
 * Moved here from CLAUDE.md's architecture table (v21.63), which is the always-loaded file and was
 * carrying the whole argument. The drawer had grown FIVE competing treatments for one list of
 * destinations, which is what "cluttered" turned out to mean — measured, it was not dense; there
 * was ~130px of dead space. Now: **pills** = go to a page · **Today** = the documents you open on
 * a shift · **Reference** = look something up.
 *
 * Three consequences that look like taste and are not:
 *
 *   · **Settings is a PILL, not a pinned link.** It is a page. Rendering it as an Information-style
 *     row is what forced the drawer's fourth zone in the first place.
 *   · **Pills are one per row, full width — that is ARITHMETIC.** The drawer is 260px, so a 2-col
 *     grid gives 110px while "📅 Calendar" needs 135 and "⚙️ Settings" 118. Content-width flex
 *     cannot pair Calendar with anything either (135 + the smallest, 86, blows the 220px budget),
 *     which is what left an orphan row at every permission count.
 *   · **Reference is EXPANDED by default** — collapsed at v20.06, reopened at v20.09 (owner). The
 *     fold measurement was real and was not the whole question: a collapsed section is one you have
 *     to know is there, and the guides are exactly what a reader does not know to look for.
 *     Re-measured signed-in, expanded costs 194px of drawer scroll at 360×640 and NOTHING at
 *     390×844. To collapse it again, flip `aria-expanded` and re-add `hidden` on the list — and
 *     change nothing else, because of the next paragraph.
 *
 * **`aria-expanded` is the ONLY state** (v20.09). The arrow's rotation and the count chip's
 * visibility are both CSS-keyed to it. There used to be an `.open` class as well, and expanding by
 * default is what exposed the drift: the initial markup carried `aria-expanded="true"` with no
 * `.open`, so the arrow pointed down over an open section and stayed inverted for good — the
 * handler only ever toggles from wherever it started. The count chip is the COLLAPSED-state
 * affordance and is hidden by CSS while expanded, where the rows are the count.
 */

import { notifSupported, peekNotifState, enableNotifications, disableNotifications } from './notif.js';
import { getLatestCircular, getLatestNewsletter, isSafeStorageUrl, officeViewerUrl } from './firebase-client.js';
import { APP_VERSION, avatarInitials, avatarHue } from './roster-data.js';
import { lockBodyScroll, unlockBodyScroll, suppressNextPop, registerPopInterceptor } from './overlay.js';
import { lsGet, lsSet } from './ls.js';
import { recordOpen } from './usage-reporter.js';

/**
 * Page navigation destinations. The current page is NOT omitted — it renders as an inert
 * `aria-current` pill (see `_inject`), so the row is the same shape on every page and the
 * drawer doubles as a map rather than a list of exits. This comment said "omitted" from
 * v10.57 to v20.06 while the code did the opposite.
 * colorClass mirrors the equivalent quick-action button on the calendar page:
 *   calendar → gold (matches Today button)
 *   admin    → navy + gold text (matches Admin button)
 *   paycalc  → green (matches Pay button)
 */
const NAV_PAGES = [
    { id: 'calendar',   label: '📅 Calendar',   url: './',      colorClass: 'nav-panel-pill--calendar'   },
    { id: 'admin',      label: '📝 Admin',       url: './admin.html',      colorClass: 'nav-panel-pill--admin'      },
    { id: 'paycalc',    label: '💷 Pay',         url: './paycalc.html',    colorClass: 'nav-panel-pill--pay'        },
    { id: 'operations', label: '🔧 Operations',   url: './operations.html', colorClass: 'nav-panel-pill--operations', adminOnly: true },
    { id: 'links',      label: '🔗 Links',         url: './links.html',      colorClass: 'nav-panel-pill--links',      linksDesignerOnly: true },
    // Overtime is REVIEWER-ONLY during the restricted live beta, so the pill is filtered the same
    // way Ops and Links are. Hiding it is not the security boundary — the page gates itself and the
    // server refuses everyone else — it is only so ordinary staff are not shown a destination that
    // would turn them away. At full launch the flag comes off and every eligible member sees it.
    { id: 'overtime',   label: '⏱️ Overtime',      url: './overtime.html',   colorClass: 'nav-panel-pill--overtime',   overtimeAudienceOnly: true },
    // SETTINGS IS A PAGE, SO IT IS A PILL (v20.06). It used to be a flat link pinned above the
    // footer, styled like the Information rows — which made it the only page-destination in the
    // drawer that did not look like one, and meant "where do I go" had two answers in two places
    // with two treatments. Folding it in removes a whole visual idiom and leaves the pill grid as
    // the single, complete answer. It keeps its own quiet colour so it does not compete with the
    // work pages above it.
    { id: 'settings',   label: '⚙️ Settings',      url: './settings.html',   colorClass: 'nav-panel-pill--settings'   },
];

/**
 * Information section — flat, always-open. Live workplace documents only.
 * A link with `comingSoon: true` (instead of `url`) renders as a button that
 * opens the "coming soon" lightbox rather than navigating.
 * (Guides moved to their own collapsible submenu — see NAV_GUIDES.)
 */
const NAV_INFORMATION = [
    {
        heading: 'Workplace',
        links: [
            { icon: '📋', label: 'Daily Huddle',           url: './#huddle' },
            { icon: '📰', label: 'Weekly Retail Circular', circular: true, body: 'No circular has been uploaded yet — it\'s usually available on Friday.' },
            { icon: '🗞️', label: 'Marylebone Newsletter',  newsletter: true, body: 'No newsletter has been uploaded yet — check back soon.' },
            // App Notices MOVED OUT at v20.06 — it sat here beside three live workplace documents
            // while being a changelog for the app itself. Wrong group, and it diluted the one thing
            // this section is for: the documents staff open on a shift. It now lives with the guides
            // under "Reference", which is where you go to look something up rather than to work.
        ],
    },
];

/**
 * Guides — collapsible submenu (tap "📖 Guides" to expand). Static reference
 * pages, grouped together so the Information section stays focused on live docs.
 * Adding a guide = one entry here.
 *
 * `openId` is the anonymous open-counter id (v18.20 for the first two, v19.95 for the rest). It
 * lives on the ENTRY and is stamped onto the rendered link as `data-open-id`, so the click handler
 * reads it off the element rather than inferring it from the href. That is not tidiness: the two
 * ids added at v19.95 are the exact case a href test gets wrong:
 * `'./paycalc-guide.html'.includes('guide.html')` is TRUE, and `guide.html` is what the Staff
 * Guide was called until v22.47 — so a substring match counted every Pay Calculator Guide open as
 * a Staff Guide open, and both bars still looked plausible. The rename ended THAT collision and
 * changes nothing here: a filename is not a stable key, and the next rename is free to make a new
 * one. A guide added here without an `openId` simply is not counted, which
 * firestore-contract-parity.test.mjs fails on rather than leaving to be noticed.
 */
const NAV_GUIDES = [
    { icon: '📘', label: 'Staff & Admin Guide',  url: './staff-guide.html',          openId: 'guide-staff'    },
    { icon: '💷', label: 'Pay Calculator Guide', url: './paycalc-guide.html',  openId: 'guide-paycalc'  },
    { icon: '🎫', label: 'Railcard Guide',       url: './railcard-guide.html', openId: 'guide-railcard' },
    { icon: '🗺️', label: 'Rangers & Rovers',    url: './rangers-guide.html',  openId: 'guide-rangers'  },
    { icon: '🇪🇺', label: 'FIP Travel Guide',     url: './fip-guide.html',            openId: 'guide-fip'      },
];

/**
 * This page's bare filename, for the `?from=` hint appended to a guide link (v18.84) so the guide's
 * ← comes back HERE instead of its hardcoded default. A directory URL ("/", "/roster-app/") means
 * the calendar. Guide-side this is checked against an allowlist, so an odd value is simply ignored.
 * @returns {string}
 */
function _currentPageFile() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

let _panelOpen      = false;
// A single shallow history entry, shared by the panel and any lightbox that
// opens from inside it — so Android Back pops exactly one entry.
let _historyPushed  = false;
let _comingSoonOpen = false;
let _noticesOpen    = false;

// Claim the drawer's live history entry with overlay.js's shared popstate handler (v16.23).
// Without this, a hardware Back with the drawer open reached the overlay STACK first and popped
// an unrelated handler — concretely, it invoked toggleTeamView and kicked the user out of Team
// Week View while also closing the drawer (one press, two surfaces). Registered once at module
// level (the flags are module-level too, so this survives resetNavPanel→initNavPanel cycles).
registerPopInterceptor(() => _historyPushed);
// The document keydown + window popstate handlers registered by initNavPanel — held at module
// level so resetNavPanel() can remove them (they close over the injected panel; a stale copy
// surviving a reset would consume the shared flags against a detached panel).
/** @type {any} */ let _docKeydownHandler = null;
/** @type {any} */ let _popstateHandler   = null;
// The coming-soon / notices lightbox keydown handlers, held so resetNavPanel can remove them too
// (v16.23) — a copy surviving a reset-while-open closed over the detached lightbox and could steal
// the REBUILT drawer's history entry on Escape (the in-handler open-flag guards remain as backup).
/** @type {any[]} */ let _navLbKeyHandlers = [];

/** localStorage key for the archived notices list. */
/** How long a drawer document tap waits for a session before reading anyway (v19.07). The user has
 *  just tapped and a loading state is showing, so this is the "here's a response" budget — not a
 *  general timeout. The whole fetch stays bounded by the existing 8s race below. */
const DOC_AUTH_WAIT_MS = 2000;

const NOTICES_KEY = 'myb_app_notices';
/** Archive entries older than this are pruned from localStorage. */
const ARCHIVE_EXPIRY_DAYS = 180;

const _MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
/** @param {any} str */
function _parseNoticeDate(str) {
    const [d, mon, y] = str.trim().split(/\s+/);
    const m = /** @type {Record<string, any>} */ (_MONTHS)[mon];
    return (m === undefined) ? NaN : new Date(+y, m, +d).getTime();
}

/**
 * Returns true if a notice's posting date is older than the given number of days.
 * Use to silently dismiss stale notices on a new device:
 *   if (isNoticeExpired(NOTICE_DATE))     { lsSet(DONE_KEY, '1'); return; }  // 28-day (default)
 *   if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }  // 90-day (long)
 * @param {string} dateStr - "D Mon YYYY", e.g. "22 Jun 2026"
 * @param {number} [days=28] - expiry window: 28 for short-range, 90 for long-range
 */
export function isNoticeExpired(dateStr, days = 28) {
    const posted = _parseNoticeDate(dateStr);
    return !isNaN(posted) && (Date.now() - posted) > days * 86_400_000;
}

/**
 * Archive a notice so it appears in the App Notices panel.
 * Call this when the user dismisses a notice lightbox.
 * Entries older than ARCHIVE_EXPIRY_DAYS (180) are pruned automatically.
 * @param {{ id: string, title: string, section: string, date: string, body: string }} notice
 */
export function archiveNotice({ id, title, section, date, body }) {
    try {
        const expiryMs = ARCHIVE_EXPIRY_DAYS * 86_400_000;
        const now    = Date.now();
        const nowIso = new Date(now).toISOString();

        // Parse defensively — malformed or non-array stored data must not stop a new
        // notice being saved (it just starts a fresh archive).
        let parsed;
        try { parsed = JSON.parse(lsGet(NOTICES_KEY) || '[]'); } catch { parsed = []; }
        const records = Array.isArray(parsed) ? parsed : [];

        const existing = records
            // Drop non-object members first: a null/garbage element would otherwise become
            // `{ ...null, archivedAt }` = a content-less record that survives the expiry filter
            // and later renders as a blank App Notices card (v16.19).
            .filter(n => n && typeof n === 'object')
            // Migrate legacy pre-v13.41 records (no archivedAt) by stamping them with
            // `now` instead of dropping them — otherwise the first archive write after
            // an upgrade would silently wipe the user's whole notice history.
            .map(n => n.archivedAt ? n : { ...n, archivedAt: nowIso })
            .filter(n => {
                const t = new Date(n.archivedAt).getTime();
                return Number.isFinite(t) && (now - t) < expiryMs;
            });

        if (!existing.some(n => n.id === id)) {
            existing.unshift({ id, title, section, date, body, archivedAt: nowIso });
        }
        // Always write back so the legacy migration and expiry pruning persist even on
        // the idempotent path (the same notice id archived again).
        lsSet(NOTICES_KEY, JSON.stringify(existing.slice(0, 50)));
    } catch (e) {
        console.warn('[Nav] archiveNotice failed:', e);
    }
}

/**
 * Tear down an already-initialised nav panel so initNavPanel() can rebuild it from scratch with a
 * different identity. initNavPanel self-guards (burger.dataset.navPanelInit) and _inject APPENDS its
 * DOM (a second call would duplicate the drawer), so there is otherwise no way to refresh the footer
 * name / admin pills after the panel is wired. Used on the admin in-place B1-teardown path, where the
 * nav was optimistically wired with a stale identity before the session was cleared and re-entered.
 * Removes the injected DOM, drops the burger's listeners (via clone-replace) and clears the guard.
 */
export function resetNavPanel() {
    // Balance the scroll lock for ANY open surface, not just the drawer: the coming-soon / notices
    // lightboxes visually close the panel (_panelOpen=false) but hold their OWN lockBodyScroll, so
    // tearing down while one is open would leave _lbDepth ≥ 1 and body.lb-open (position:fixed)
    // stuck. (unlockBodyScroll is depth-counted + depth-0-safe, so an extra call is harmless.) (v16.22)
    if (_panelOpen || _comingSoonOpen || _noticesOpen) unlockBodyScroll();
    // Remove the document/window-level listeners the previous initNavPanel registered — the
    // clone-replace below only drops the BURGER's listeners; these two close over the old panel
    // and share the module flags, so a surviving copy would fire first on the next Escape /
    // Android Back and leave the rebuilt drawer stuck open.
    if (_docKeydownHandler) { document.removeEventListener('keydown', _docKeydownHandler); _docKeydownHandler = null; }
    if (_popstateHandler)   { window.removeEventListener('popstate', _popstateHandler);   _popstateHandler = null; }
    _navLbKeyHandlers.forEach(fn => document.removeEventListener('keydown', fn));
    _navLbKeyHandlers = [];
    ['navPanel', 'navPanelOverlay', 'navComingSoonLightbox', 'navNoticesLightbox']
        .forEach(id => document.getElementById(id)?.remove());
    const burger = document.getElementById('navMenuBtn');
    if (burger) {
        // Clone-replace drops every listener wired in the previous initNavPanel; removing the guard
        // attribute lets the next initNavPanel treat the fresh burger as un-initialised.
        const fresh = /** @type {HTMLElement} */ (burger.cloneNode(true));
        fresh.removeAttribute('data-nav-panel-init');
        fresh.setAttribute('aria-expanded', 'false');
        burger.replaceWith(fresh);
    }
    _panelOpen = false;
    _historyPushed = false;
    _comingSoonOpen = false;
    _noticesOpen = false;
}

/**
 * Initialise the navigation panel for the current page.
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc'|'operations'|'settings'|'links'|'overtime', memberName?: string|null, onSignOut?: (() => void)|null, isAdmin?: boolean, isLinksDesigner?: boolean, canOpenOvertime?: boolean, onLogoClick?: (() => void)|null, usageIdentity?: string|null, authReady?: Promise<any>, onLockCalendar?: { isViewer: () => boolean, lock: () => void }|null }} opts
 *   onLockCalendar (v20.12, calendar only) — the shared-PIN viewer's way to lock the roster before
 *   walking away from a shared office PC. `isViewer` is a THUNK read at drawer-open time, never at
 *   init: Calendar access resolves asynchronously and is still `none` when this function runs.
 *   authReady — resolves once a Firebase session exists; awaited before the Circular/Newsletter
 *   read (AUTH_PLAN.md → E1). Each page passes its own (calendar: `calendarAuthReady`; the five
 *   authenticated pages: `sessionReady`). Defaults to already-resolved.
 *   onLogoClick — opens the page's existing About/version lightbox when the
 *   drawer logo is tapped. The header logo on sub-pages is now a back button,
 *   so About lives on the drawer logo instead.
 */
export function initNavPanel({ currentPage = 'calendar', memberName = null, onSignOut = null, isAdmin = false, isLinksDesigner = false, canOpenOvertime = false, onLogoClick = null, usageIdentity = null, authReady = Promise.resolve(), onLockCalendar = null } = {}) {
    // Identity for the anonymous open-counters' admin-exclusion (v18.20): the signed-in name by
    // default; the calendar passes its SELECTED member (its session is optional — same precedent
    // as recordUsage's identity there). Never stored — only compared against CONFIG.ADMIN_NAMES.
    const _usageId = usageIdentity ?? memberName;
    const burger = /** @type {HTMLElement} */ (document.getElementById('navMenuBtn'));
    if (!burger) return;
    if (burger.dataset.navPanelInit) return;
    burger.dataset.navPanelInit = '1';
    burger.setAttribute('aria-haspopup', 'dialog');
    burger.setAttribute('aria-controls', 'navPanel');
    burger.setAttribute('aria-expanded', 'false');

    _inject(currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, canOpenOvertime, onLockCalendar);

    const panel    = /** @type {HTMLElement} */ (document.getElementById('navPanel'));
    const overlay  = /** @type {HTMLElement} */ (document.getElementById('navPanelOverlay'));
    const closeBtn = document.getElementById('navPanelClose');
    if (!panel || !overlay) return;

    function openPanel() {
        _panelOpen = true;
        panel.removeAttribute('aria-hidden');
        overlay.removeAttribute('aria-hidden');
        overlay.classList.add('open');
        panel.classList.add('open');
        burger.setAttribute('aria-expanded', 'true');
        lockBodyScroll();
        if (!_historyPushed) {
            history.pushState({ mybNavPanel: true }, '');
            _historyPushed = true;
        }
        // Permission/subscription can change between opens (toggled in admin, or
        // at OS level), so re-read the bell state every time the panel opens.
        _refreshBell();
        _refreshLock();
        // Delay focus so the CSS transition has started — screen readers
        // announce the dialog heading rather than the close button label alone.
        setTimeout(() => closeBtn?.focus(), 60);
    }

    // Shared closed-state DOM mutations. Callers move focus OUT of the panel
    // before calling this, so we never set aria-hidden over the focused element.
    function _applyClosedState() {
        _panelOpen = false;
        panel.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.remove('open');
        panel.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
    }

    // Close via ✕, overlay tap, or Escape. Pops the entry we pushed.
    function closePanel() {
        burger.focus();          // move focus out before aria-hidden (a11y)
        _applyClosedState();
        unlockBodyScroll();
        if (_historyPushed) {
            _historyPushed = false;
            // The flag is already false when the echo pop arrives, so the interceptor can't claim
            // it — absorb it explicitly or it reaches the overlay STACK and pops an unrelated
            // handler (the close-drawer-exits-Team-View bug, v16.23).
            suppressNextPop();
            history.back(); // removes the state we pushed — triggers popstate
        }
    }

    // Called from popstate — history.back() already happened, don't call it again.
    function closePanelFromBack() {
        _historyPushed = false;
        burger.focus();
        _applyClosedState();
        unlockBodyScroll();
    }

    // Visual-only close used when a link inside the panel is clicked.
    // Does NOT call history.back() — the navigation that follows handles page
    // transitions, and for hash-only links (e.g. #huddle) history.back() would
    // race with the hash navigation and cause unexpected behaviour.
    function closePanelForNavigation() {
        _historyPushed = false; // consumed — popstate won't reopen the panel
        _applyClosedState();
        unlockBodyScroll();
    }

    // Visual-only close that PRESERVES the pushed history entry, so the
    // coming-soon lightbox opened from inside the panel can reuse that single
    // entry instead of leaking it and pushing a second one (which used to leave
    // a phantom entry that swallowed an Android Back press).
    function _closePanelVisualOnly() {
        _applyClosedState();
        unlockBodyScroll();
    }

    burger.addEventListener('click', openPanel);
    closeBtn?.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    // Guard against repeated taps while a circular/newsletter Firestore fetch is in flight.
    let _docFetching = false;

    /**
     * Failure/no-doc fallback for _openLatestDoc, GUARDED on the drawer still being the open
     * surface (v16.69 review fix). The fetch can settle up to 8s later; if the user opened App
     * Notices or About meanwhile, _closePanelVisualOnly()'s unlockBodyScroll would decrement THAT
     * lightbox's scroll lock (background scrolls behind the modal) and the coming-soon lightbox
     * would stack on the same history entry — closing it then eats the entry while the other
     * lightbox is still open, so the next Android Back leaves the page. If the panel is no longer
     * open, just drop the fallback: the spinner was already cleared by the .finally.
     * @param {HTMLElement} triggerEl @param {string} [msg]
     */
    function _docFailureFallback(triggerEl, msg) {
        if (!_panelOpen) return;
        _closePanelVisualOnly();
        _openComingSoon(triggerEl, msg);
    }

    /**
     * Opens the latest Circular or Newsletter in a new tab — DIRECTLY, in one tap.
     * A PDF opens by its own URL (browsers render it inline); a Word (.docx) document
     * would DOWNLOAD if opened directly, so it is routed through Microsoft's Office
     * Online viewer (officeViewerUrl) which renders it — with images — in the same tab.
     * The nav link is a real user gesture, so window.open is allowed (unlike a
     * notification tap, which has no activation and must route through the in-app
     * #circular/#newsletter viewer's Open button — calendar-doc-viewer.js).
     * Opens a blank tab synchronously (same event tick = user gesture) so Safari
     * doesn't classify the later window.open() inside .then() as a popup.
     * Falls back to the coming-soon lightbox if no document exists or fetch fails.
     * @param {HTMLElement} triggerEl
     * @param {() => Promise<any>} fetchFn
     * @param {string} docId - open-counter id ('circular' | 'newsletter'), recorded on the success path (v18.20)
     */
    function _openLatestDoc(triggerEl, fetchFn, docId) {
        if (_docFetching) return;
        _docFetching = true;
        // Visible in-flight state — the fetch races an 8s timeout, and on weak signal the tapped
        // link otherwise just sat there (a blank tab open in the background) reading as "broken".
        triggerEl.classList.add('nav-panel-link--loading');
        triggerEl.setAttribute('aria-busy', 'true');
        const newTab = window.open('', '_blank');
        if (newTab) newTab.opener = null;
        // Race the fetch against a timeout: a wedged Firestore promise that never settles would
        // otherwise leave _docFetching stuck true, killing BOTH doc nav-links until a reload and
        // orphaning the blank tab. On timeout the .catch closes the tab and shows the fallback (v16.19).
        const timed = new Promise((_res, reject) =>
            setTimeout(() => reject(new Error('doc-fetch-timeout')), 8000));
        // Wait for a Firebase session before reading (AUTH_PLAN.md → E1): the three document
        // collections are open today, but Track E requires a session, and a read fired before
        // signInAnonymously lands would return nothing. Each page passes its own promise (the
        // calendar `calendarAuthReady`; the five authenticated pages `sessionReady`).
        //
        // BOUNDED, not plain (v19.07). A plain `await authReady` broke the very thing E1 was meant to
        // preserve: on operations/links the in-place-login path deliberately leaves `sessionReady`
        // UNRESOLVED until the user signs in, so a SIGNED-OUT user tapping a document there sat
        // through the whole 8s race and got the failure fallback — where before it opened instantly,
        // because these collections are open today. Waiting a moment for a session and then reading
        // anyway restores that: it succeeds under today's rules, and once reads require a session it
        // fails into the same fallback rather than stalling first.
        const authOrSoon = Promise.race([authReady, new Promise(r => setTimeout(r, DOC_AUTH_WAIT_MS))]);
        Promise.race([authOrSoon.then(() => fetchFn()), timed]).then(/** @param {any} data */ data => {
            const url = data?.storageUrl;
            const safeUrl = isSafeStorageUrl(url) ? url : null;
            if (safeUrl) {
                // A .docx would download if opened directly — render it via the Office Online
                // viewer instead. PDFs open by their own URL (browsers show them inline).
                const openUrl = data.fileType === 'docx' ? officeViewerUrl(safeUrl) : safeUrl;
                // The document genuinely opens on both branches below — count it (anonymous,
                // admin-excluded; v18.20). Failure/no-doc paths never reach here.
                recordOpen(docId, _usageId);
                if (newTab) {
                    // Doc opened in a SEPARATE tab — this page STAYS put, so close with a real
                    // history.back() to CONSUME the drawer's pushed entry. closePanelForNavigation()
                    // only clears the flag (no back()), leaving a dead same-URL entry that swallows
                    // the next Android Back press — the exact leak the brand→About handler fixed (v16.21).
                    newTab.location.href = openUrl;
                    // ...but ONLY if the drawer is still the open surface. On slow signal the user can
                    // open another drawer item (App Notices / About) mid-fetch, which reuses the shared
                    // history entry + scroll-lock; closePanel() would then unlockBodyScroll + history.back()
                    // on THAT surface, scrolling its background and breaking its Android Back. Mirrors the
                    // _panelOpen guard on the failure path (_docFailureFallback).
                    if (_panelOpen) closePanel();
                } else {
                    // Popup was blocked — THIS tab navigates away, so the pushed entry goes with it;
                    // closePanelForNavigation() (no back()) is correct here.
                    location.href = openUrl;
                    if (_panelOpen) closePanelForNavigation();
                }
            } else {
                if (newTab) newTab.close();
                _docFailureFallback(triggerEl);
            }
        }).catch(() => {
            if (newTab) newTab.close();
            _docFailureFallback(triggerEl, 'Couldn\'t connect — check your signal and try again.');
        }).finally(() => {
            triggerEl.classList.remove('nav-panel-link--loading');
            triggerEl.removeAttribute('aria-busy');
            _docFetching = false;
        });
    }

    // Close panel before navigating so the panel doesn't flash behind the new page.
    // "Coming soon" and "App Notices" links are buttons — close the panel and open
    // their lightboxes instead of navigating.
    panel.addEventListener('click', e => {
        const comingSoon = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--coming-soon'));
        if (comingSoon) {
            _closePanelVisualOnly();    // keep the history entry for the lightbox
            _openComingSoon(comingSoon);
            return;
        }
        const circular = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--circular'));
        if (circular) { _openLatestDoc(circular, getLatestCircular, 'circular'); return; }
        const newsletter = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--newsletter'));
        if (newsletter) { _openLatestDoc(newsletter, getLatestNewsletter, 'newsletter'); return; }
        if (/** @type {Element} */ (e.target).closest('.nav-panel-link--notices')) {
            _closePanelVisualOnly();
            _openNotices();
            return;
        }
        // Guide links navigate IN THE SAME WINDOW (v18.81 — was target="_blank" until then). From the
        // installed PWA a new-tab open doesn't stay in the standalone window: Android wraps the guide
        // in a Chrome Custom Tab (the ✕/title/URL bar a staff screenshot reported as "an extra header
        // on every guide") and iOS shows the in-app Safari sheet. The guides are same-origin,
        // SW-precached, and carry a ← back to the calendar, so in-place navigation keeps the app
        // feeling like one app. Same replace-the-drawer-entry dance as the page pills below (the
        // drawer's pushed history entry must not survive as a dead duplicate). On the links page the
        // unsaved-changes guard now correctly intercepts these like any same-tab navigation (its
        // capture-phase handler runs first and swallows the click while dirty).
        const guideLink = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--guide'));
        if (guideLink) {
            // Anonymous open-counter for the two reference guides (v18.20; admin-excluded). The
            // guides are static pages with no Firebase, so the tap here — their only in-app
            // route — is where the open is counted. Fire-and-forget: the ~120ms navigation defer
            // below gives the write time to reach Firestore's LOCAL persistence queue before this
            // page unloads (persistentLocalCache then syncs it on the next app open); the delay is
            // visually covered by the drawer's close animation.
            //
            // Counted at the moment the navigation actually COMMITS, not on the click (v18.91):
            // the plain-click path below defers ~120ms and Back cancels it, so counting up front
            // recorded opens that never happened.
            //
            // The id is READ OFF THE ELEMENT (`data-open-id`, stamped from NAV_GUIDES at render).
            // It was matched from the href until v19.95, which covered only two of the four guides
            // — and adding the other two that way would have been wrong, because
            // `'./paycalc-guide.html'.includes('guide.html')` is true and `guide.html` was the
            // Staff Guide's own filename until v22.47.
            const _countGuideOpen = () => {
                const openId = guideLink.dataset.openId;
                if (openId) recordOpen(openId, _usageId);
            };
            const plainGuideClick = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
            if (plainGuideClick && _historyPushed) {
                e.preventDefault();
                // Close visually but KEEP the drawer's claim on its history entry until the
                // navigation actually fires (v18.84). closePanelForNavigation() cleared
                // _historyPushed immediately, leaving a ~120ms window where that entry was live but
                // unclaimed: registerPopInterceptor(() => _historyPushed) returned false, so a Back
                // press in the window fell through to overlay.js's handler stack and ran an
                // UNRELATED overlay's close handler (on the calendar it could drop you out of Team
                // Week View) — and then navigated to the guide anyway. Back now cancels the pending
                // navigation, which is what Back means. The page-pill branch below needs none of
                // this: its location.replace is synchronous, so it has no window.
                _closePanelVisualOnly();   // already unlocks body scroll — do not unlock again here
                // Tell the guide where we came FROM so its ← returns here (guide-back.js, v18.84).
                // Each guide's arrow is otherwise hardcoded to the calendar (or the pay calculator),
                // which was fine while guides opened in a new tab but strands you since v18.81's
                // same-tab navigation — open the Railcard Guide from Admin and ← dropped you on the
                // calendar. Only ever the current page's own filename, and the guide checks it
                // against an allowlist before using it.
                const dest = new URL(/** @type {HTMLAnchorElement} */ (guideLink).href);
                dest.searchParams.set('from', _currentPageFile());
                let _navTimer = 0;
                const _cancelNav = () => {
                    clearTimeout(_navTimer);
                    window.removeEventListener('popstate', _cancelNav);
                };
                _navTimer = window.setTimeout(() => {
                    window.removeEventListener('popstate', _cancelNav);
                    _countGuideOpen();                       // committed — count it now, not on click
                    _historyPushed = false;                  // consumed by the replace below
                    location.replace(dest.href);             // overwrite the drawer's same-URL entry
                }, 120);
                window.addEventListener('popstate', _cancelNav);
                return;
            }
            // Modifier/middle click (desktop "open in new tab") or no pushed entry: default anchor path.
            // Nothing is deferred or cancellable here, so the open is committed — count it.
            _countGuideOpen();
            closePanelForNavigation();
            return;
        }
        // Same-tab page navigation (pills, Settings, real info links). The drawer pushed a history
        // entry on open whose URL equals THIS page's; a plain <a> nav stacks the destination ON TOP of
        // it, leaving that entry as a phantom same-URL duplicate that swallows one Android Back press
        // after you return here (closePanelForNavigation only clears the flag, never pops it). For a
        // plain left-click on a real cross-page link, REPLACE that throwaway entry with the destination
        // via location.replace — no race (unlike history.back()+nav, the reason closePanel() isn't used
        // here) and single-Back behaviour is unchanged: Back still lands on the page you were on before
        // opening the drawer, just without the dead duplicate. Hash links (#huddle — the Daily Huddle
        // same-doc nav, whose viewer owns its own history) and modifier / new-tab clicks keep the
        // default <a> path. (v16.87)
        const navTarget = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-pill, .nav-panel-link'));
        if (navTarget) {
            const anchor  = navTarget.tagName === 'A' ? /** @type {HTMLAnchorElement} */ (navTarget) : null;
            const rawHref = anchor?.getAttribute('href') || '';
            const plainClick = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
            if (anchor && _historyPushed && plainClick && rawHref && !rawHref.includes('#') && anchor.target !== '_blank') {
                e.preventDefault();
                closePanelForNavigation();      // clear _historyPushed + visually close (no history.back)
                location.replace(anchor.href);  // overwrite the drawer's same-URL entry with the destination
                return;
            }
            closePanelForNavigation();
            return;
        }
    });

    // Lock Calendar (viewer mode only). Both the button and the footer label are refreshed on every
    // drawer open — see _refreshLock, called from openPanel beside _refreshBell.
    const lockBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('navLockCalendarBtn'));
    lockBtn?.addEventListener('click', async () => {
        // THE DRAWER STAYS OPEN UNTIL THE LOCK IS CONFIRMED (v20.39, audit §13). `lock()` now
        // rejects if the viewer session survives sign-out, and on success it replaces the page — so
        // closing the drawer first would have hidden the only surface left to report a failure on,
        // and the user would be looking at an unchanged, still-unlocked Calendar with no explanation.
        if (!lockBtn) return;
        const label = lockBtn.textContent;
        lockBtn.disabled = true;
        lockBtn.textContent = 'Locking…';
        try {
            await onLockCalendar?.lock?.();
            closePanelForNavigation();      // only reached if `lock()` did not navigate away
        } catch (err) {
            console.warn('[nav] Lock Calendar failed:', err);
            lockBtn.textContent = "Couldn't lock — try again";
            lockBtn.disabled = false;
            setTimeout(() => { if (lockBtn.textContent === "Couldn't lock — try again") lockBtn.textContent = label; }, 6000);
        }
    });

    /** Reveal the lock button (and name the mode) when this browser is on the shared staff PIN. */
    function _refreshLock() {
        if (!onLockCalendar) return;
        // Fail CLOSED on a thrown thunk — hiding a button costs a walk to the browser menu, whereas
        // showing "Lock Calendar" to a signed-in member offers them an action that does nothing to
        // their session and reads as though it did.
        let viewer;
        try { viewer = onLockCalendar.isViewer() === true; } catch { viewer = false; }
        if (lockBtn) { if (viewer) lockBtn.removeAttribute('hidden'); else lockBtn.setAttribute('hidden', ''); }
        const label = document.getElementById('navPanelMember');
        if (viewer && label && !label.textContent) label.textContent = 'Staff PIN access';
        // A footer with no member and no viewer has nothing in it — keep it away entirely rather
        // than showing an empty bar. (A member's footer is never hidden: it renders without the
        // attribute, and this only ever runs on the calendar.)
        const footer = document.querySelector('.nav-panel-footer');
        if (footer && !onSignOut) {
            if (viewer) footer.removeAttribute('hidden'); else footer.setAttribute('hidden', '');
        }
    }

    // Sign-out footer button
    const signOutBtn = document.getElementById('navSignOutBtn');
    signOutBtn?.addEventListener('click', () => {
        closePanelForNavigation();
        onSignOut?.();
    });

    // Brand (logo + title + version) opens the page's About lightbox.
    // About opens via createLightbox, which pushes its OWN history entry — so, unlike the
    // coming-soon link (which reuses the drawer's entry), we must POP the drawer's entry here,
    // not abandon it. closePanelForNavigation() only cleared _historyPushed without calling
    // history.back(), leaking a dead same-URL entry that swallowed the next Android Back press
    // (and accumulated on each About-from-drawer cycle). closePanel() pops it; About opens on
    // the next tick, AFTER the back()'s popstate settles, so About's fresh entry isn't
    // immediately consumed by the queued back().
    const brandBtn = document.getElementById('navPanelBrand');
    brandBtn?.addEventListener('click', () => {
        closePanel();
        setTimeout(() => onLogoClick?.(), 0);
    });

    // Guides submenu accordion — an in-panel toggle, so the panel stays open.
    const guidesToggle = document.getElementById('navGuidesToggle');
    const guidesList   = document.getElementById('navGuidesList');
    guidesToggle?.addEventListener('click', () => {
        // aria-expanded is the ONLY state (v20.09). It used to also toggle an `.open` class that
        // the arrow's rotation was keyed on — two copies of one boolean, which held together only
        // while the initial markup happened to agree with both. See the CSS note in shared.css.
        const isOpen = guidesToggle.getAttribute('aria-expanded') === 'true';
        guidesToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        if (guidesList) guidesList.hidden = isOpen;
        const searchZone = document.getElementById('navGuideSearchZone');
        if (searchZone) searchZone.hidden = isOpen;
    });

    // Cross-guide search loads on FIRST FOCUS only — the module and its ~90KB index are not part
    // of any page's boot. If the import fails (it is SW-precached, so this is rare), the box says
    // so rather than sitting silently dead.
    const gsInput = /** @type {HTMLInputElement|null} */ (document.getElementById('navGuideSearchInput'));
    let _gsRequested = false;
    gsInput?.addEventListener('focus', () => {
        if (_gsRequested) return;
        _gsRequested = true;
        import('./nav-guide-search.js')
            .then(m => m.initGuideSearch({ guides: NAV_GUIDES }))
            .catch(() => {
                const st = document.getElementById('navGuideSearchStatus');
                if (st) st.textContent = 'Search is unavailable — the guides below still open.';
            });
    });

    // Notification toggle — an in-panel action, so the panel stays open.
    const bell      = /** @type {HTMLButtonElement|null} */ (document.getElementById('navNotifBell'));
    const bellIcon  = document.getElementById('navNotifIcon');
    let _bellBusy   = false;

    /** Apply a state string to the toggle glyph and accessible name.
     * @param {any} state */
    function _paintBell(state) {
        if (!bell) return;
        const on = state === 'on';
        // While the real state is still resolving (up to ~8s for swReady), show a neutral
        // "working" glyph — never 🔔, which reads as "on" and briefly mislabels an off/blocked
        // device. 🔔 only ever means genuinely on; 🔕 genuinely off/blocked (A2).
        // (Compact icon since v16.75 — no visible state word; the aria-label carries it.)
        if (bellIcon)  bellIcon.textContent  = state === 'loading' ? '🔄' : on ? '🔔' : '🔕';
        bell.setAttribute('aria-pressed', on ? 'true' : 'false');
        bell.dataset.notifState = state;
        bell.setAttribute('aria-label',
            state === 'loading' ? 'Notifications — checking status'
          : on        ? 'Notifications on — tap to turn off'
          : state === 'denied' ? 'Notifications blocked in browser settings'
          : 'Notifications off — tap to turn on');
    }

    /**
     * Re-read and repaint the bell. No-op when the bell is not rendered.
     * Uses peekNotifState (no side effects) — repainting on every panel open
     * must not write to Firestore. VAPID rotation runs from calendar-app.js on load.
     */
    async function _refreshBell() {
        if (!bell) return;
        _paintBell(await peekNotifState());
    }

    bell?.addEventListener('click', async () => {
        if (_bellBusy) return;
        const state = bell.dataset.notifState;
        // Browser-blocked: nothing we can do programmatically. The blocked status is
        // already conveyed by the bell's aria-label (set in _paintBell), so just no-op.
        // 'loading' (the initial state before peekNotifState resolves — swReady can take up to 8s)
        // is also a no-op: toggling then would re-prompt/re-subscribe a device that may already be
        // subscribed. _refreshBell resolves the real state on panel open (v16.22).
        if (state === 'denied' || state === 'loading') return;
        _bellBusy = true;
        bell.dataset.notifState = 'loading';
        _paintBell('loading');   // repaint NOW — otherwise the old 🔔/"On" glyph shows through a slow toggle (up to 8s)
        bell.disabled = true;
        try {
            _paintBell(state === 'on' ? await disableNotifications() : await enableNotifications());
        } catch (err) {
            console.warn('[Nav] Bell toggle failed:', err);
            await _refreshBell(); // restore correct state if toggle errored
        } finally {
            bell.disabled = false;
            _bellBusy = false;
        }
    });

    // "Coming soon" placeholder lightbox — reuses the shared .lb-overlay pattern.
    const csLightbox = document.getElementById('navComingSoonLightbox');
    const csClose    = document.getElementById('navComingSoonClose');
    const csTitle    = document.getElementById('navComingSoonTitle');
    const csIcon     = document.getElementById('navComingSoonIcon');
    const csBody     = document.getElementById('navComingSoonBody');

    /**
     * Open the placeholder lightbox for a "coming soon" link.
     * @param {HTMLElement} [triggerEl] the link that was tapped - its
     *   data-cs-title / data-cs-icon drive the heading, so the one generic
     *   lightbox shows the right title for whichever item opened it.
     * @param {string} [overrideBody]
     */
    function _openComingSoon(triggerEl, overrideBody) {
        if (!csLightbox) return;
        const title = triggerEl?.dataset.csTitle || 'Coming soon';
        const icon  = triggerEl?.dataset.csIcon  || '🔔';
        const body  = overrideBody ?? triggerEl?.dataset.csBody ?? '';
        if (csTitle) csTitle.textContent = title;
        if (csIcon)  csIcon.textContent  = icon;
        if (csBody)  csBody.textContent  = body;
        csLightbox.setAttribute('aria-label', title);

        lockBodyScroll();
        csLightbox.classList.add('visible');
        requestAnimationFrame(() => csLightbox.classList.add('open'));
        document.addEventListener('keydown', _onComingSoonKey);
        // Reuse the panel's single history entry (normally already present, as
        // the lightbox opens from the open panel); push one only if missing.
        if (!_historyPushed) {
            history.pushState({ mybNavOverlay: true }, '');
            _historyPushed = true;
        }
        _comingSoonOpen = true;
        setTimeout(() => csClose?.focus(), 60);
    }

    /**
     * Shared teardown: hide `el` after its slide-out transition completes, then
     * unlock scroll and return focus to the burger. A 500ms fallback fires in case
     * transitionend is suppressed (iOS backgrounded tab, prefers-reduced-motion).
     * @param {HTMLElement} el - The .lb-overlay element to finish closing.
     */
    function _finishNavLightboxClose(el) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            el.classList.remove('visible');
            unlockBodyScroll();
            burger.focus();
            return;
        }
        const t = setTimeout(done, 500);
        function done() {
            clearTimeout(t);
            el.removeEventListener('transitionend', done);
            el.classList.remove('visible');
            unlockBodyScroll();
            burger.focus();
        }
        el.addEventListener('transitionend', done, { once: true });
    }

    function _finishComingSoonClose() { _finishNavLightboxClose(/** @type {HTMLElement} */ (csLightbox)); }

    // Called by user action (Escape, ✕, backdrop) — pop the shared entry.
    function _closeComingSoon() {
        if (!csLightbox) return;
        _comingSoonOpen = false;
        document.removeEventListener('keydown', _onComingSoonKey);
        csLightbox.classList.remove('open');
        if (_historyPushed) {
            _historyPushed = false;
            suppressNextPop();   // don't let the echo reach the overlay stack (v16.23)
            history.back();
        }
        _finishComingSoonClose();
    }

    // Called from popstate — history.back() already happened.
    function _closeComingSoonFromBack() {
        if (!csLightbox) return;
        _comingSoonOpen = false;
        _historyPushed  = false;
        document.removeEventListener('keydown', _onComingSoonKey);
        csLightbox.classList.remove('open');
        _finishComingSoonClose();
    }

    // Escape closes the lightbox. Tab is trapped — the lightbox has only one
    // focusable element (the ✕ button) so Tab would immediately escape otherwise.
    /** @param {any} e */
    function _onComingSoonKey(e) {
        // Stale-survivor guard (v16.23): resetNavPanel removes the panel DOM + flags but not this
        // document-level listener — a copy surviving a reset-while-open would swallow every Tab
        // page-wide and its Escape would steal the REBUILT drawer's history entry. Self-remove.
        if (!_comingSoonOpen) { document.removeEventListener('keydown', _onComingSoonKey); return; }
        if (e.key === 'Escape') { _closeComingSoon(); return; }
        if (e.key === 'Tab')    { e.preventDefault(); csClose?.focus(); }
    }

    csClose?.addEventListener('click', _closeComingSoon);
    // Only close on direct backdrop click — csClose already has its own listener
    // and event bubbling would otherwise call _closeComingSoon twice.
    csLightbox?.addEventListener('click', e => {
        if (e.target === csLightbox) _closeComingSoon();
    });

    // App Notices archive lightbox — same bespoke pattern as the coming-soon
    // lightbox (reuses the panel's single history entry; no createLightbox).
    const noticesLightbox = document.getElementById('navNoticesLightbox');
    const noticesClose    = document.getElementById('navNoticesClose');
    const noticesList     = document.getElementById('navNoticesList');
    const noticesEmpty    = document.getElementById('navNoticesEmpty');

    function _openNotices() {
        if (!noticesLightbox) return;
        // Render archived notices from localStorage
        const list  = noticesList;
        const empty = noticesEmpty;
        let notices = [];
        // Array.isArray guard like archiveNotice: a valid-JSON NON-array (e.g. `{}` from corruption)
        // would pass JSON.parse, then notices.forEach throws a TypeError and breaks the panel (v16.21).
        try { const p = JSON.parse(lsGet(NOTICES_KEY) || '[]'); notices = Array.isArray(p) ? p : []; } catch (_) {}
        const SECTION_MODS = { Pay: 'pay', Links: 'links', Settings: 'settings', Operations: 'ops', Calendar: 'calendar' };
        if (list) {
            list.innerHTML = '';
            notices.forEach(/** @param {any} n */ n => {
                const item    = document.createElement('div');
                item.className = 'notices-item';
                const header  = document.createElement('div');
                header.className = 'notices-item-header';
                const sectionEl = document.createElement('span');
                const sectionMod = /** @type {Record<string, any>} */ (SECTION_MODS)[n.section];
                sectionEl.className = `notices-item-section${sectionMod ? ' notices-item-section--' + sectionMod : ''}`;
                sectionEl.textContent = n.section || '';
                const dateEl  = document.createElement('span');
                dateEl.className = 'notices-item-date';
                dateEl.textContent = n.date || '';
                header.appendChild(sectionEl);
                header.appendChild(dateEl);
                const titleEl = document.createElement('div');
                titleEl.className = 'notices-item-title';
                titleEl.textContent = n.title || '';
                const bodyEl  = document.createElement('div');
                bodyEl.className = 'notices-item-body';
                bodyEl.textContent = n.body || '';
                item.appendChild(header);
                item.appendChild(titleEl);
                item.appendChild(bodyEl);
                list.appendChild(item);
            });
        }
        if (list)  list.hidden  = notices.length === 0;
        if (empty) empty.hidden = notices.length > 0;
        // Open the lightbox
        lockBodyScroll();
        noticesLightbox.classList.add('visible');
        requestAnimationFrame(() => noticesLightbox.classList.add('open'));
        document.addEventListener('keydown', _onNoticesKey);
        if (!_historyPushed) {
            history.pushState({ mybNavOverlay: true }, '');
            _historyPushed = true;
        }
        _noticesOpen = true;
        setTimeout(() => noticesClose?.focus(), 60);
    }

    function _finishNoticesClose() { _finishNavLightboxClose(/** @type {HTMLElement} */ (noticesLightbox)); }

    function _closeNotices() {
        if (!noticesLightbox) return;
        _noticesOpen = false;
        document.removeEventListener('keydown', _onNoticesKey);
        noticesLightbox.classList.remove('open');
        if (_historyPushed) {
            _historyPushed = false;
            suppressNextPop();   // don't let the echo reach the overlay stack (v16.23)
            history.back();
        }
        _finishNoticesClose();
    }

    function _closeNoticesFromBack() {
        if (!noticesLightbox) return;
        _noticesOpen    = false;
        _historyPushed  = false;
        document.removeEventListener('keydown', _onNoticesKey);
        noticesLightbox.classList.remove('open');
        _finishNoticesClose();
    }

    /** @param {any} e */
    function _onNoticesKey(e) {
        // Stale-survivor guard — see _onComingSoonKey (v16.23).
        if (!_noticesOpen) { document.removeEventListener('keydown', _onNoticesKey); return; }
        if (e.key === 'Escape') { _closeNotices(); return; }
        if (e.key === 'Tab')    { e.preventDefault(); noticesClose?.focus(); }
    }
    // Register both with resetNavPanel's teardown list (v16.23) — this init's handlers replace
    // any earlier init's (already removed by the reset that preceded this init).
    _navLbKeyHandlers = [_onComingSoonKey, _onNoticesKey];

    noticesClose?.addEventListener('click', _closeNotices);
    noticesLightbox?.addEventListener('click', e => {
        if (e.target === noticesLightbox) _closeNotices();
    });

    // Close panel on Escape; trap Tab focus within the panel while it is open.
    // The !panel.contains(active) guard catches focus that escaped the panel
    // (e.g. via a programmatic focus() call elsewhere) and pulls it back in.
    // Stored in the module-level ref so resetNavPanel() can remove it — a stale copy left behind
    // after a reset would fire FIRST on the next Escape, consume the shared _panelOpen/_historyPushed
    // flags against the detached old panel, and leave the rebuilt drawer stuck open.
    _docKeydownHandler = (/** @type {KeyboardEvent} */ e) => {
        if (!_panelOpen) return;
        if (e.key === 'Escape') { closePanel(); return; }
        if (e.key === 'Tab') {
            const focusable = /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(
                'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ))).filter(el => el.offsetParent !== null); // visible only — skip the collapsed Guides links
            if (focusable.length === 0) return;
            const first  = focusable[0];
            const last   = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (e.shiftKey) {
                if (active === first || !panel.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last || !panel.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    };
    document.addEventListener('keydown', _docKeydownHandler);

    // Android Back button closes whichever overlay is currently open. The
    // coming-soon and notices lightboxes share the panel's single history entry,
    // so check them first (they sit on top of the visually-closed panel).
    // Stored in the module-level ref so resetNavPanel() can remove it (same stale-copy hazard
    // as the keydown handler above — Android Back is the primary close gesture on staff phones).
    _popstateHandler = () => {
        if (_comingSoonOpen) { _closeComingSoonFromBack(); return; }
        if (_noticesOpen)   { _closeNoticesFromBack(); return; }
        if (!_historyPushed) return;
        closePanelFromBack();
    };
    window.addEventListener('popstate', _popstateHandler);
}

// lockBodyScroll / unlockBodyScroll imported from overlay.js

/** Build and inject the overlay + drawer HTML into document.body.
 * @param {any} currentPage
 * @param {any} memberName
 * @param {any} onSignOut
 * @param {any} onLockCalendar
 * @param {any} isAdmin
 * @param {any} isLinksDesigner
 * @param {any} canOpenOvertime
 */
function _inject(currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, canOpenOvertime, onLockCalendar) {
    // Render every permitted destination. The current page is shown too — as an
    // inert "you are here" pill (aria-current) rather than being filtered out —
    // so the drawer doubles as a map, not just a list of exits.
    const pills = NAV_PAGES
        .filter(p => !p.adminOnly || isAdmin)
        .filter(p => !p.linksDesignerOnly || isLinksDesigner)
        .filter(p => !p.overtimeAudienceOnly || canOpenOvertime)
        .map(p => p.id === currentPage
            ? `<span class="nav-panel-pill ${p.colorClass} nav-panel-pill--current" aria-current="page">${p.label}</span>`
            : `<a href="${p.url}" class="nav-panel-pill ${p.colorClass}">${p.label}</a>`)
        .join('');

    // Render the per-group sub-heading only when there is more than one group — with a single
    // group ("Workplace") it just echoes the "Information" section heading directly above it (A5).
    const infoGroups = NAV_INFORMATION.map(group => `
        ${NAV_INFORMATION.length > 1 ? `<p class="nav-panel-group-heading">${group.heading}</p>` : ''}
        <ul class="nav-panel-links">
            ${group.links.map(/** @param {any} link */ link => {
                if (link.comingSoon) return `<li><button type="button" class="nav-panel-link nav-panel-link--coming-soon" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}"><span aria-hidden="true">${link.icon}</span> ${link.label}</button></li>`;
                if (link.circular)    return `<li><button type="button" class="nav-panel-link nav-panel-link--circular" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}"><span aria-hidden="true">${link.icon}</span> ${link.label}</button></li>`;
                if (link.newsletter)  return `<li><button type="button" class="nav-panel-link nav-panel-link--newsletter" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}"><span aria-hidden="true">${link.icon}</span> ${link.label}</button></li>`;
                if (link.notices)   return `<li><button type="button" class="nav-panel-link nav-panel-link--notices"><span aria-hidden="true">${link.icon}</span> ${link.label}</button></li>`;
                return `<li><a href="${link.url}" class="nav-panel-link"><span aria-hidden="true">${link.icon}</span> ${link.label}</a></li>`;
            }).join('')}
        </ul>`).join('');

    // Guides — expanded by default; the toggle can collapse the list. They navigate in the SAME TAB
    // (v18.81 — the old target="_blank" wrapped every guide in Android's Chrome Custom Tab / iOS's
    // in-app Safari, the "extra header on all the guides" staff report). The click handler above
    // appends ?from=<this page> so the guide's ← comes back HERE (guide-back.js, v18.84) — which is
    // what the new-tab open used to buy us, without the extra browser chrome.
    const guideLinks = NAV_GUIDES
        .map(g => `<li><a href="${g.url}" class="nav-panel-link nav-panel-link--guide" data-open-id="${g.openId}"><span aria-hidden="true">${g.icon}</span> ${g.label}</a></li>`)
        .join('')
        // App Notices joins the guides (v20.06): both are "look something up", neither is a document
        // you open on a shift. It goes LAST — it is the rarest thing in the drawer.
        + `<li><button type="button" class="nav-panel-link nav-panel-link--notices"><span aria-hidden="true">📣</span> App Notices</button></li>`;

    // Settings is a PILL now (v20.06) — see NAV_PAGES. Nothing renders here.

    // Footer is only rendered when a sign-out callback is supplied.
    // Member name is set via textContent (not innerHTML) after injection to avoid XSS.
    // The bell is only included when the device supports Web Push (notif.js folds
    // in the iOS-must-be-standalone rule); the settings Notifications card explains
    // the unsupported case for users who need it.
    // A COMPACT icon button next to Sign out (owner decision, v16.75 — reverting the
    // v16.56 full-width labelled row, the second time a labelled row has been tried
    // and rolled back, see v13.19): the full Notifications area on settings.html is
    // the canonical, discoverable surface; the drawer bell is just a quick toggle,
    // and the labelled row gave it more footer prominence than it earns. Signed-in
    // only (matches the footer) — unsigned users have the calendar's one-time
    // #notifPrompt strip and the Settings card after signing in.
    // `onSignOut` as well as notifSupported() (v20.15). The footer used to render only for a
    // signed-in member, so "signed-in only" came for free; widening the footer to carry the
    // viewer's Lock Calendar button silently handed the bell to people with no member identity at
    // all — a locked calendar visitor, and a staff-PIN viewer whose subscription write the v20.12
    // rules now DENY. A control that cannot succeed must not be offered.
    const bellHtml = (onSignOut && notifSupported()) ? `
                    <button class="nav-panel-bell" id="navNotifBell" type="button"
                            aria-pressed="false" aria-label="Checking notification status…"
                            data-notif-state="loading">
                        <span id="navNotifIcon" aria-hidden="true">🔄</span>
                    </button>` : '';
    // "Lock Calendar" — shown ONLY while the Calendar is open through the shared staff PIN (v20.12).
    // Rendered hidden and revealed on drawer open, because access resolves after this markup is
    // built. It sits where Sign out sits for a member, which is the same idea in the same place:
    // the thing you press before you walk away.
    const lockHtml = onLockCalendar ? `
                    <button class="nav-panel-signout nav-panel-lock" id="navLockCalendarBtn" type="button" hidden>Lock Calendar</button>` : '';
    // The footer exists for a member (name + bell + sign out) OR for a viewer (the lock button).
    // Before v20.12 it was `onSignOut ?` alone, which is why a viewer — who has no session and so no
    // sign-out — would otherwise have no footer to put this in.
    // Rendered `hidden` for a lock-only footer and revealed by `_refreshLock` once access resolves,
    // because whether there is anything to put in it is not known at inject time. Without that a
    // LOCKED visitor got an empty footer bar with a blank member name where a name should be.
    const footerHtml = (onSignOut || onLockCalendar) ? `
        <div class="nav-panel-footer"${onSignOut ? '' : ' hidden'}>
            <div class="nav-panel-footer-row">
                <div class="nav-panel-member-wrap">
                    <span class="nav-panel-avatar" id="navPanelAvatar" aria-hidden="true"></span>
                    <span class="nav-panel-member" id="navPanelMember"></span>
                </div>
                <div class="nav-panel-footer-actions">
                    ${bellHtml}
                    ${lockHtml}
                    ${onSignOut ? '<button class="nav-panel-signout" id="navSignOutBtn">Sign out</button>' : ''}
                </div>
            </div>
        </div>` : '';

    const html = `
        <div id="navPanelOverlay" class="nav-panel-overlay" aria-hidden="true"></div>
        <div id="navPanel" class="nav-panel" role="dialog" aria-modal="true"
             aria-label="Navigation menu" aria-hidden="true">
            <div class="nav-panel-head">
                <button type="button" class="nav-panel-brand" id="navPanelBrand"
                        aria-label="About this app — version ${APP_VERSION}">
                    <img src="./icon-192.png" alt="" class="nav-panel-icon" loading="eager">
                    <span class="nav-panel-brand-text">
                        <span class="nav-panel-title">Marylebone Roster</span>
                        <span class="nav-panel-version">Version ${APP_VERSION}</span>
                    </span>
                </button>
                <button class="nav-panel-close" id="navPanelClose"
                        aria-label="Close navigation menu">✕</button>
            </div>
            <div class="nav-panel-body">
                <div class="nav-panel-pills">${pills}</div>
                <div class="nav-panel-section">
                    <!-- "Latest", not "Today" (v22.23, external review). The heading replaced
                         "Information" at v20.06, which classified nothing — every drawer item is
                         information. "Today" classified correctly under the zone's own idiom (the
                         documents you open on a shift), and a reader does not have the idiom: they
                         see TODAY over a WEEKLY circular and a MONTHLY newsletter, and one of the
                         three is today's. "Latest" is true of all three and needs no idiom. -->
                    <p class="nav-panel-section-heading">Latest</p>
                    ${infoGroups}
                </div>
                <div class="nav-panel-section">
                    <!-- EXPANDED BY DEFAULT AGAIN (v20.09, owner) — reverting the one v20.06 change
                         that was a judgement rather than a structural fix.
                         v20.06 closed it on a fold measurement: six rows expanded put three of the
                         five guides below 640px on a 360-wide phone. That measurement was right and
                         it was not the whole question. A collapsed section is not a smaller version
                         of an open one — it is a section you have to know is there, and the guides
                         are exactly the content a reader does not know to look for. The drawer's
                         three-zone structure (pills / Today / Reference), which is what "cluttered"
                         actually meant, is untouched and stays.
                         The rest of the v20.06 pass survives on its own evidence: the pills are one
                         per row by arithmetic (260px drawer, Calendar needs 135), Settings is a pill
                         because it is a page, and App Notices left Workplace because it is a
                         changelog and not a document you open on a shift.
                         It is still a real toggle, so anyone who wants the short drawer can close
                         it — the state simply is not the default any more. -->
                    <button type="button" class="nav-panel-guides-toggle" id="navGuidesToggle"
                            aria-expanded="true" aria-controls="navGuidesList">
                        <span class="nav-panel-guides-heading">Reference</span>
                        <!-- A COUNT ON A COLLAPSED HEADER is an established convention here
                             (css-tokens.md: "chips are added only where a card is often COLLAPSED
                             and has one clear datum"): closed, "Reference ▾" alone reads like a
                             section that failed to render rather than one holding six things.
                             OPEN, the rows ARE the count, and printing it beside them states twice
                             what the reader can already see — so the CSS hides it while expanded and
                             brings it back the moment somebody collapses the section. Rendered in
                             both states rather than branched in JS, because the toggle handler only
                             flips aria-expanded; deriving the markup from the state would give the
                             count a second home. Derived, never typed: a guide added to NAV_GUIDES
                             must not leave a stale number behind it. -->
                        <span class="nav-panel-guides-count" aria-hidden="true">${NAV_GUIDES.length + 1}</span>
                        <span class="nav-panel-guides-arrow" aria-hidden="true">▾</span>
                    </button>
                    <div id="navGuideSearchZone">
                        <!-- Cross-guide search (v22.02). The box is a dumb input until first focus:
                             nav-guide-search.js and the generated index load lazily then, so the
                             drawer costs every page boot nothing for it. Results render into the
                             list below as ordinary guide links — the delegated handler above gives
                             them counting, ?from= and the history dance with no second copy. -->
                        <input id="navGuideSearchInput" class="nav-gs-input" type="search"
                               enterkeyhint="search" autocomplete="off" spellcheck="false"
                               placeholder="Search the guides…" aria-label="Search the staff guides">
                        <div class="nav-gs-status" id="navGuideSearchStatus" role="status"></div>
                        <ul class="nav-panel-links nav-panel-guides-list" id="navGuideSearchResults" hidden></ul>
                    </div>
                    <ul class="nav-panel-links nav-panel-guides-list" id="navGuidesList">
                        ${guideLinks}
                    </ul>
                </div>
            </div>
            ${footerHtml}
        </div>
        <div id="navComingSoonLightbox" class="lb-overlay" role="dialog"
             aria-label="Coming soon" aria-modal="true">
            <div class="lb-content" id="navComingSoonContent">
                <button type="button" id="navComingSoonClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-icon" id="navComingSoonIcon" aria-hidden="true">📰</div>
                <div class="nav-cs-title" id="navComingSoonTitle">Coming soon</div>
                <div class="nav-cs-body" id="navComingSoonBody"></div>
            </div>
        </div>
        <div id="navNoticesLightbox" class="lb-overlay" role="dialog"
             aria-label="App Notices" aria-modal="true">
            <div class="lb-content" id="navNoticesContent">
                <button type="button" id="navNoticesClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-title">📣 App Notices</div>
                <div id="navNoticesList" class="nav-notices-list"></div>
                <div id="navNoticesEmpty" class="nav-notices-empty" hidden>No notices yet — check back soon.</div>
            </div>
        </div>`;

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);

    // Set member name safely via textContent (XSS-safe — no innerHTML for user data)
    if (!memberName) {
        // No member: a viewer footer, which has a lock button but nobody to name. Drop the avatar
        // entirely rather than leaving an initial-less coloured circle — an empty badge beside empty
        // text reads as a rendering fault, and there is no identity here to represent.
        document.getElementById('navPanelAvatar')?.remove();
    }
    if (memberName) {
        const memberEl = document.getElementById('navPanelMember');
        if (memberEl) memberEl.textContent = memberName;

        const avatarEl = document.getElementById('navPanelAvatar');
        if (avatarEl) {
            avatarEl.textContent = avatarInitials(memberName);
            avatarEl.style.background = avatarHue(memberName);
        }
    }
}
