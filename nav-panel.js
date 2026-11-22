// @ts-check
/**
 * nav-panel.js — Slide-out navigation panel, shared by every app page.
 *
 * Injects overlay + drawer HTML into document.body, then wires the burger
 * button (#navMenuBtn). Uses the same history.pushState / popstate pattern
 * as overlay.js's lightboxes, so Android Back closes the panel.
 *
 * Usage (call once, after DOM is ready — ES modules are deferred by default):
 *   import { initNavPanel } from './nav-panel.js';
 *   initNavPanel({ currentPage: 'calendar', memberName: 'G. Miller', onSignOut: fn });
 *   // memberName + onSignOut are optional; omit both to suppress the footer. `beforeSignOut`
 *   // (optional) returns false to CANCEL — the push record is released only after it agrees.
 *
 * The footer also hosts a push-notification bell toggle (🔔/🔕) when the device
 * supports Web Push. All push logic lives in notif.js — this file only renders
 * and refreshes the bell.
 *
 * ── THREE ZONES, ONE IDIOM EACH ─────────────────────────────────────────────────────────────────
 *
 * The drawer had grown FIVE competing treatments for one list of destinations, which is what
 * "cluttered" turned out to mean — measured, it was not dense. Now: **pills** = go to a page ·
 * **Latest** = the documents you open on a shift · **Reference** = look something up.
 *
 * Three consequences that look like taste and are not:
 *
 *   · **Settings is a PILL, not a pinned link.** It is a page. Rendering it as an Information-style
 *     row is what forced the drawer's fourth zone in the first place.
 *   · **Pills are one per row, full width — that is ARITHMETIC.** The drawer is 260px, so a 2-col
 *     grid gives 110px while "📅 Calendar" needs 135 and "⚙️ Settings" 118. Content-width flex
 *     cannot pair Calendar with anything either (135 + the smallest, 86, blows the 220px budget),
 *     which is what left an orphan row at every permission count.
 *   · **Reference is EXPANDED by default** (owner): a collapsed section is one you have to know is
 *     there, and the guides are exactly what a reader does not know to look for. Measured signed-in,
 *     expanded costs 194px of drawer scroll at 360×640 and NOTHING at 390×844. To collapse it again,
 *     flip `aria-expanded` and re-add `hidden` on the list — and change nothing else, because:
 *
 * **`aria-expanded` is the ONLY state.** The arrow's rotation and the count chip's visibility are
 * both CSS-keyed to it. A second `.open` class drifted from it (the arrow pointed down over an open
 * section for good — the handler only toggles from wherever it started). The count chip is the
 * COLLAPSED-state affordance and is hidden by CSS while expanded, where the rows are the count.
 */

import { notifSupported, peekNotifState, enableNotifications, disableNotifications, releaseDevicePush } from './notif.js';
import { getLatestCircular, getLatestNewsletter, isSafeStorageUrl, resolveDocumentOpenUrl, fetchSignedDocumentUrl, currentUserAfterBoot } from './firebase-client.js';
import { APP_VERSION, avatarInitials, avatarHue } from './roster-data.js';
import { newsletterInMenu, recordLatestNewsletter } from './newsletter-recency.js';
import { lockBodyScroll, unlockBodyScroll, suppressNextPop, registerPopInterceptor, whenHistorySettled, watchScrollFade, closeOnBackdropTap, pinCloseButton } from './overlay.js';
import { readArchivedNotices } from './notice-archive.js';
import { isAccessFailure } from './claim-retry.js';
import { recordOpen } from './usage-reporter.js';
import { NAV_PAGES, NAV_INFORMATION, NAV_GUIDES, SECTION_MODS, visiblePills } from './nav-destinations.js';

// The drawer's destinations — NAV_PAGES, NAV_INFORMATION, NAV_GUIDES, SECTION_MODS — and the pill
// filter are DATA, in nav-destinations.js: imported by the tests rather than read out of this file as text.

/**
 * This page's bare filename, for the `?from=` hint appended to a guide link so the guide's
 * ← comes back HERE instead of its hardcoded default. A directory URL ("/", "/roster-app/") means
 * the calendar. Guide-side this is checked against an allowlist, so an odd value is simply ignored.
 * @returns {string}
 */
function _currentPageFile() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

/** Is this document the Calendar — the app's root, as a directory or as `index.html`? Where a `./#…`
 *  link is only a hash change, so the drawer must not let it navigate (`./#…` from an explicit
 *  /index.html resolves to `/#…`: a path change and a full reload where a hash change was meant). */
const _onCalendarPage = () => /(^|\/)(index\.html)?$/.test(window.location?.pathname ?? '');

let _panelOpen      = false;
// A single shallow history entry, shared by the panel and any lightbox that
// opens from inside it — so Android Back pops exactly one entry.
let _historyPushed  = false;
/** This opening's own history-entry marker: a pop that LANDS on it removed an entry ABOVE the
 *  drawer (a dialog), so the drawer stays. Per opening, so a pre-reload leftover never passes for it. */
let _navEntry = 0;
const _landedOnOwnEntry = () => history.state?.mybNavPanel === _navEntry;
/** This page's address, read where the module may run without one (the unit tests' fake window). */
const _hereHref = () => String(globalThis.location?.href ?? '');
/** The address the drawer's entry was pushed at — so the entry BENEATH it has it too, and a Back lands there. */
let _entryHref = '';
/** Push the drawer's ONE entry — shared by the panel and its two lightboxes — with a fresh marker. */
function _pushDrawerEntry() {
    _navEntry = Date.now() + Math.random();
    _entryHref = _hereHref();
    history.pushState({ mybNavPanel: _navEntry }, '');
    _historyPushed = true;
}

// ── A NOTIFICATION TAPPED WITH THE DRAWER OPEN (18 Nov 2026) ─────────────────────────────────────────────
// A tap is a hash navigation of this page (`#huddle`, `#circular`, an Operations card), pushed ON TOP of the
// drawer's entry, and a hash navigation fires popstate. The drawer read that as Back and closed — but its entry
// was still in the history, under the tap's. The page then takes the tap's entry back off (its viewer or card
// opens once that lands), which leaves the reader ON the drawer's entry: after the viewer closed, one Back did
// nothing at all. A Back lands on the entry the drawer was pushed from, at the address it was pushed at; a tap
// lands somewhere else. So a pop at another address marks the entry as LEFT BEHIND, and a pop that later lands on
// it — while nothing has been pushed above it — steps off it again, as if it had never been there.
/** The marker of a drawer entry a tap left in the history beneath it, or 0. */
let _leftBehind = 0;
/** Step off the drawer's left-behind entry when a pop lands on it. Never on any other entry: the marker is
 *  per opening, and a viewer pushed above it in the meantime has its own Back. */
function _stepOffLeftBehind() {
    if (!_leftBehind || history.state?.mybNavPanel !== _leftBehind) return;
    _leftBehind = 0;
    suppressNextPop();   // the echo is ours, not a Back press
    history.back();
}
let _comingSoonOpen = false;
let _noticesOpen    = false;

// Claim the drawer's live history entry with overlay.js's shared popstate handler — without it, Back
// with the drawer open popped an UNRELATED overlay handler too (it left Team Week View). Registered
// once at module level, so it survives resetNavPanel→initNavPanel cycles. …Unless the pop LANDED on
// the drawer's own entry: a dialog over the drawer (or over App Notices / coming-soon, which share
// the entry) was popped, and that dialog owns its own Back.
registerPopInterceptor(() => _historyPushed && !_landedOnOwnEntry());
// The document keydown + window popstate handlers registered by initNavPanel — held at module
// level so resetNavPanel() can remove them (they close over the injected panel; a stale copy
// surviving a reset would consume the shared flags against a detached panel).
/** @type {any} */ let _docKeydownHandler = null;
/** @type {any} */ let _popstateHandler   = null;
// The coming-soon / notices lightbox keydown handlers, held so resetNavPanel can remove them too — a
// surviving copy could steal the REBUILT drawer's history entry on Escape.
/** @type {any[]} */ let _navLbKeyHandlers = [];
// The body's "more below" fade, as every scrolling lightbox wears; open to close.
/** @type {() => void} */ let _stopBodyFade = () => {};

/** How long after an open the drawer and its two lightboxes move focus to their ✕: long enough for the CSS
 *  transition to have started, so a screen reader announces the dialog rather than the button alone. */
const FOCUS_DELAY_MS = 60;
/** How long a drawer document tap waits for a session before reading anyway — a "here's a response"
 *  budget, not a general timeout. The whole open stays inside `DOC_FETCH_BUDGET_MS`. */
const DOC_AUTH_WAIT_MS = 2000;
/** The most a drawer document tap waits, from the tap, before it gives its answer: the read and the
 *  short-lived link race this one budget, and past it the stored url (or the fallback) is used. */
const DOC_FETCH_BUDGET_MS = 8000;
/**
 * What a tap on a BLOCKED bell says (its title and icon are the bell's `data-cs-*`). On Settings the card it sends
 * the reader to is on the page under the drawer, so it says so rather than giving the menu route to the page they
 * are already reading (18 Nov 2026).
 * @param {string} currentPage
 */
const blockedBellText = (currentPage) => 'Notifications are blocked for this app in your phone’s or browser’s settings, so the bell can’t switch '
    + 'them on. ' + (currentPage === 'settings'
        ? 'The Notifications card on this page says how to allow them.'
        : '☰ → Settings → Notifications says how to allow them.');

/**
 * Tear down an already-initialised nav panel so initNavPanel() can rebuild it from scratch with a
 * different identity. initNavPanel self-guards (burger.dataset.navPanelInit) and _inject APPENDS its
 * DOM (a second call would duplicate the drawer), so there is otherwise no way to refresh the footer
 * name / admin pills after the panel is wired. Three callers: page-session.js, when a session ends in place
 * and the sign-in is shown over the page (the drawer was wired with the identity that has gone); and the two
 * in-place sign-ins that rebuild it for the member who signed in — overtime-app.js and calendar-drawer.js.
 * Removes the injected DOM, drops the burger's listeners (via clone-replace) and clears the guard.
 */
export function resetNavPanel() {
    // Balance the scroll lock for ANY open surface: the coming-soon / notices lightboxes hold their
    // OWN lockBodyScroll with the panel closed (unlockBodyScroll is depth-counted and depth-0-safe).
    if (_panelOpen || _comingSoonOpen || _noticesOpen) unlockBodyScroll();
    // Remove the previous init's document/window listeners (the clone-replace below drops only the
    // BURGER's): a surviving copy would fire first and leave the rebuilt drawer stuck open.
    if (_docKeydownHandler) { document.removeEventListener('keydown', _docKeydownHandler); _docKeydownHandler = null; }
    if (_popstateHandler)   { window.removeEventListener('popstate', _popstateHandler);   _popstateHandler = null; }
    _navLbKeyHandlers.forEach(fn => document.removeEventListener('keydown', fn));
    _navLbKeyHandlers = [];
    _stopBodyFade(); _stopBodyFade = () => {};
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
    // CONSUME A LIVE DRAWER ENTRY: left behind, the next Back popped it and nothing answered.
    // The echo is absorbed; a caller that pushes history straight after waits on `whenHistorySettled`.
    if (_historyPushed) { suppressNextPop(); history.back(); }
    _panelOpen = false;
    _historyPushed = false;
    _comingSoonOpen = false;
    _noticesOpen = false;
}

/**
 * Initialise the navigation panel for the current page.
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc'|'operations'|'settings'|'links'|'overtime'|'trains'|'newlink', memberName?: string|null, onSignOut?: (() => void)|null, beforeSignOut?: (() => boolean|Promise<boolean>)|null, isAdmin?: boolean, isLinksDesigner?: boolean, canOpenOvertime?: boolean, canOpenNewlink?: boolean, onLogoClick?: (() => void)|null, authReady?: Promise<any>, canReadDocuments?: () => boolean, onLockCalendar?: { isViewer: () => boolean, lock: () => void }|null }} opts
 *   onLockCalendar (the Calendar and Trains) — the shared-PIN viewer's way to lock the roster before
 *   walking away from a shared office PC. `isViewer` is a THUNK read at drawer-open time, never at
 *   init: Calendar access resolves asynchronously and is still `none` when this function runs.
 *   canReadDocuments — a THUNK: may the drawer's two document links read? The Calendar, Overtime, Pay
 *   and Trains pass their own. With none it is "is there a named session?" — `memberName` — and never
 *   "yes" (review, 22 Nov 2026): a drawer wired for nobody read the documents anyway, and offline the
 *   device's cache answers without asking a rule (calendar-doc-access.js), so the link opened what an
 *   earlier visitor's session had left behind.
 *   authReady — resolves once a Firebase session exists; awaited before the Circular/Newsletter
 *   read (AUTH_PLAN.md → E1). Each page passes its own (calendar: `calendarAuthReady`; the
 *   authenticated pages: `sessionReady`). Defaults to already-resolved.
 *   onLogoClick — opens the page's About lightbox when the drawer logo is tapped (a sub-page's
 *   header logo goes back to the calendar, so About lives here).
 */
export function initNavPanel({ currentPage = 'calendar', memberName = null, onSignOut = null, beforeSignOut = null, isAdmin = false, isLinksDesigner = false, canOpenOvertime = false, canOpenNewlink = false, onLogoClick = null, authReady = Promise.resolve(), onLockCalendar = null, canReadDocuments = () => !!memberName } = {}) {
    // Identity for the anonymous open-counters' admin-exclusion: the SIGNED-IN name, never a selected
    // member (on the station PC that is whichever row was picked last). Never stored — only compared
    // against CONFIG.ADMIN_NAMES; usage-reporter.js has the reasoning.
    const _usageId = memberName;
    const burger = /** @type {HTMLElement} */ (document.getElementById('navMenuBtn'));
    if (!burger) return;
    if (burger.dataset.navPanelInit) return;
    burger.dataset.navPanelInit = '1';
    burger.setAttribute('aria-haspopup', 'dialog');
    burger.setAttribute('aria-controls', 'navPanel');
    burger.setAttribute('aria-expanded', 'false');

    _inject(currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, canOpenOvertime, canOpenNewlink, onLockCalendar);

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
        if (!_historyPushed) _pushDrawerEntry();
        _stopBodyFade(); _stopBodyFade = watchScrollFade(/** @type {HTMLElement|null} */ (panel.querySelector('.nav-panel-body')));
        // Permission/subscription can change between opens (toggled in admin, or
        // at OS level), so re-read the bell state every time the panel opens.
        _refreshBell();
        _refreshLock();
        // And the Newsletter's row: an issue that turns six weeks old with the page open goes, and one
        // the Calendar's check or an upload has just recorded comes (newsletter-recency.js).
        const nl = panel.querySelector('.nav-panel-link--newsletter')?.parentElement; if (nl) nl.hidden = !newsletterInMenu();
        // Delay focus so the CSS transition has started — screen readers announce the dialog heading
        // rather than the close button label alone. …Unless the drawer has closed since: the ✕ would
        // take focus inside a panel already aria-hidden, and lose it when the slide-out ended.
        setTimeout(() => { if (_panelOpen) closeBtn?.focus(); }, FOCUS_DELAY_MS);
    }

    // Shared closed-state DOM mutations. Callers move focus OUT of the panel
    // before calling this, so we never set aria-hidden over the focused element.
    function _applyClosedState() {
        _panelOpen = false;
        _stopBodyFade(); _stopBodyFade = () => {};
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
            // The flag is already false when the echo pop arrives, so absorb it explicitly or it
            // reaches the overlay STACK and pops an unrelated handler.
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

    // Visual-only close that PRESERVES the pushed history entry, so the coming-soon lightbox opened
    // from inside the panel reuses that single entry rather than leaking a phantom one.
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
     * surface: the fetch can settle up to 8s later, and over App Notices or About it would unlock
     * THAT lightbox's scroll and stack on its history entry. If the panel is no longer open, the
     * fallback is dropped (the spinner was already cleared by the .finally).
     * @param {HTMLElement} triggerEl @param {string} [msg]
     */
    function _docFailureFallback(triggerEl, msg) {
        // …and only THIS drawer: a slow read that answers after `resetNavPanel` rebuilt the drawer belongs
        // to one no longer on the page, and closing "the open drawer" then closed the new one's state
        // under it — Escape stopped working (review, 21 Nov 2026). A rebuild removes the old element.
        if (!_panelOpen || panel.isConnected === false) return;
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
     * @param {string} docId - open-counter id ('circular' | 'newsletter'), recorded on the success path
     */
    function _openLatestDoc(triggerEl, fetchFn, docId) {
        if (_docFetching) return;
        // THE DOCUMENT GATE (calendar-doc-access.js): refused HERE, before the blank tab is opened —
        // a tab that closes a second later reads as a fault. The message names the fix.
        if (!canReadDocuments()) {
            // The viewers' own words (calendar-doc-viewer.js), naming the document; "on the Calendar" only
            // where the PIN card is somewhere else (review, 21 Nov 2026).
            _docFailureFallback(triggerEl, `Sign in, or enter the staff PIN${_onCalendarPage() ? '' : ' on the Calendar'}, to read the ${triggerEl.dataset.csTitle}.`);
            return;
        }
        _docFetching = true;
        // Visible in-flight state — the fetch races an 8s timeout, and on weak signal the tapped
        // link otherwise just sat there (a blank tab open in the background) reading as "broken".
        triggerEl.classList.add('nav-panel-link--loading');
        triggerEl.setAttribute('aria-busy', 'true');
        const newTab = window.open('', '_blank');
        if (newTab) newTab.opener = null;
        // Race the fetch against a timeout: a wedged promise would leave _docFetching stuck true,
        // killing BOTH doc links and orphaning the blank tab. On timeout the .catch closes the tab.
        const timed = new Promise((_res, reject) =>
            setTimeout(() => reject(new Error('doc-fetch-timeout')), DOC_FETCH_BUDGET_MS));
        // Wait for a Firebase session before reading (AUTH_PLAN.md → E1): the document collections
        // require access, so a read fired before the session lands is refused. BOUNDED, not plain:
        // the in-place-login pages leave `sessionReady` UNRESOLVED until the user signs in, so a plain
        // await sat a signed-out tap through the whole 8s race. Waiting a moment then reading anyway
        // refuses a visitor with no session straight into the fallback.
        const authOrSoon = Promise.race([authReady, new Promise(r => setTimeout(r, DOC_AUTH_WAIT_MS))]);
        // The short-lived url is requested ALONGSIDE the document read (the server picks the latest
        // itself) and never rejects (document-url.js). It races the SAME budget as the read, or a token
        // refresh on a weak signal holds the blank tab far past it. Out of time, the stored url opens.
        const signedP = Promise.race([
            authOrSoon.then(() => fetchSignedDocumentUrl(/** @type {any} */ (docId))),
            new Promise(r => setTimeout(() => r(null), DOC_FETCH_BUDGET_MS)),
        ]);
        Promise.race([authOrSoon.then(() => fetchFn()), timed]).then(/** @param {any} data */ async data => {
            // The issue just read is the latest the ☰ menu should offer (newsletter-recency.js): kept, as
            // the Calendar's own check and its viewer keep it (review, 22 Nov 2026).
            if (docId === 'newsletter') recordLatestNewsletter(data?.date ?? null);
            const url = data?.storageUrl;
            const safeUrl = isSafeStorageUrl(url) ? url : null;
            if (safeUrl) {
                // ── THE SHORT-LIVED URL, AND WHY AWAITING IS SAFE *HERE* ─────────────────────────
                // Elsewhere awaiting inside a click handler spends the user gesture; here `newTab` was
                // opened ON the gesture, above, so there is no gesture left to lose. `docId` is the KIND
                // the endpoint takes; a null is ordinary (no IAM grant, lapsed claim, timeout) and the
                // stored url is then used.
                const signed = await signedP;
                const open = resolveDocumentOpenUrl({ signed, stored: safeUrl, fileType: data.fileType, storagePath: data.storagePath });
                // Unreachable while `safeUrl` is non-null, but this branch hands a url to window.open,
                // so it fails closed: the pre-opened tab is CLOSED, as on the no-document path below.
                if (!open) { if (newTab) newTab.close(); return _docFailureFallback(triggerEl); }
                const openUrl = open.url;
                if (newTab) {
                    // The document genuinely opens — count it (anonymous, admin-excluded). The other
                    // branch hands over to the in-app viewer, whose own Open button counts.
                    recordOpen(docId, _usageId);
                    // A SEPARATE tab — this page stays, so close with a real history.back() to CONSUME
                    // the drawer's entry (a dead same-URL entry would swallow the next Back)…
                    newTab.location.href = openUrl;
                    // …but ONLY if the drawer is still the open surface, and still this one (as _docFailureFallback).
                    if (_panelOpen && panel.isConnected !== false) closePanel();
                } else {
                    // NO TAB CAME BACK — a popup blocker, or a home-screen app on iOS (iOS audit B5).
                    // Navigating THIS page to the storage url left an installed app on a bare PDF with
                    // no way back, so hand over to the Calendar's in-app viewer (calendar-doc-viewer.js,
                    // the notification tap's route). On the Calendar that is a hash change after the
                    // drawer's Back echo; elsewhere a navigation, and the drawer's entry goes with the page.
                    if (panel.isConnected === false) {
                        // The drawer the tap came from has been rebuilt: nothing of it is left to hand over from.
                    } else if (_panelOpen && _onCalendarPage()) {
                        closePanel();
                        // The hash alone, never `./#…` (24-hour review) — see `_onCalendarPage`.
                        whenHistorySettled(() => { location.hash = docId; });
                    } else {
                        // THROUGH THE DRAWER'S OWN LINK PATH: `location.href` would skip the unsaved-work
                        // question (page-session.js watches `.nav-panel a[href]`); a hidden panel link is asked.
                        const handoff = /** @type {HTMLAnchorElement} */ (panel.querySelector('a[data-doc-handoff]')
                            ?? panel.appendChild(Object.assign(document.createElement('a'), { className: 'nav-panel-link', hidden: true })));
                        handoff.setAttribute('data-doc-handoff', ''); handoff.href = `./#${docId}`; handoff.click();
                    }
                }
            } else {
                if (newTab) newTab.close();
                // An uploaded document whose link this app will not open is not "none uploaded yet" —
                // the in-app viewer says the same (calendar-doc-viewer.js, whole-app check 17 Nov 2026).
                _docFailureFallback(triggerEl, data ? `The latest ${triggerEl.dataset.csTitle} can’t be opened — please tell the admin.` : undefined);
            }
        }).catch((/** @type {any} */ err) => {
            if (newTab) newTab.close();
            // AN ACCESS REFUSAL IS NOT A CONNECTION FAULT (`isAccessFailure`, claim-retry.js). The gate
            // above answers a page that knows it has no access; this is the SERVER refusing one that
            // thought it had. "On the Calendar" only off it, as the gate's own message (review, 22 Nov 2026).
            _docFailureFallback(triggerEl, isAccessFailure(err)
                // Not "you may have been signed out" alone: a staff-PIN viewer on Trains never signed in.
                ? `Couldn’t open — your sign-in or staff PIN may have ended. Sign in again, or enter the staff PIN${_onCalendarPage() ? '' : ' on the Calendar'}.`
                : 'Couldn’t connect — check your signal and try again.');
        }).finally(() => {
            triggerEl.classList.remove('nav-panel-link--loading');
            triggerEl.removeAttribute('aria-busy');
            _docFetching = false;
        });
    }

    // Close panel before navigating so the panel doesn't flash behind the new page.
    // The document rows and "App Notices" are buttons — they open the latest issue or a lightbox
    // instead of navigating.
    panel.addEventListener('click', e => {
        const circular = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--circular'));
        if (circular) { _openLatestDoc(circular, getLatestCircular, 'circular'); return; }
        const newsletter = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--newsletter'));
        if (newsletter) { _openLatestDoc(newsletter, getLatestNewsletter, 'newsletter'); return; }
        if (/** @type {Element} */ (e.target).closest('.nav-panel-link--notices')) {
            _closePanelVisualOnly();
            _openNotices();
            return;
        }
        // Guide links navigate IN THE SAME WINDOW: from the installed PWA a new tab leaves the
        // standalone window (Android's Chrome Custom Tab, iOS's in-app Safari sheet). Same
        // replace-the-drawer-entry dance as the page pills below; a page's unsaved-changes guard
        // intercepts these like any same-tab navigation.
        const guideLink = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-link--guide'));
        if (guideLink) {
            // Anonymous open-counter (admin-excluded): the guides have no Firebase, so the tap here
            // is where the open is counted. Fire-and-forget — the ~120ms defer below lets the write
            // reach Firestore's LOCAL persistence queue before the page unloads. Counted when the
            // navigation COMMITS (Back cancels the defer), and the id is READ OFF THE ELEMENT
            // (`data-open-id`, from NAV_GUIDES) — never matched from the href (see NAV_GUIDES).
            const _countGuideOpen = () => {
                const openId = guideLink.dataset.openId;
                if (openId) recordOpen(openId, _usageId);
            };
            const plainGuideClick = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
            if (plainGuideClick && _historyPushed) {
                e.preventDefault();
                // Close visually but KEEP the drawer's claim on its history entry until the navigation
                // fires: an unclaimed live entry let a Back in the ~120ms window run an UNRELATED
                // overlay's close handler. Back now cancels the pending navigation, which is what Back
                // means. (The page-pill branch's location.replace is synchronous: no window.)
                _closePanelVisualOnly();   // already unlocks body scroll — do not unlock again here
                // Tell the guide where we came FROM so its ← returns here (guide-back.js). Only ever the
                // current page's own filename, and the guide checks it against an allowlist.
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
            // Modifier click (desktop "open in new tab") or no pushed entry: default anchor path.
            // Nothing is deferred or cancellable here, so the open is committed — count it. A new tab
            // leaves THIS page where it is, so the drawer closes properly and pops its own entry;
            // only forgetting it left a dead same-URL entry that swallowed the next Back press.
            _countGuideOpen();
            if (plainGuideClick) closePanelForNavigation(); else if (_panelOpen) closePanel();
            return;
        }
        // Same-tab page navigation (pills, Settings, real info links). The drawer's pushed entry has
        // THIS page's URL; a plain <a> nav would stack the destination on top of it, leaving a phantom
        // duplicate that swallows one Back. So a plain left-click REPLACES that entry with the
        // destination via location.replace — no race, unlike history.back()+nav.
        //
        // THE OTHER TWO WAYS OUT POP THE ENTRY INSTEAD. A `./#…` link on the Calendar (the Daily Huddle)
        // is a hash change, not a navigation: the drawer closes properly and the hash is set once that
        // close's Back echo has landed. A click that leaves this page where it is — a new tab, or the
        // inert "you are here" pill — closes it properly too, or a dead Back press is left behind.
        const navTarget = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.nav-panel-pill, .nav-panel-link'));
        if (navTarget) {
            const anchor  = navTarget.tagName === 'A' ? /** @type {HTMLAnchorElement} */ (navTarget) : null;
            const rawHref = anchor?.getAttribute('href') || '';
            const plainClick = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
            const navigatesHere = !!anchor && !!rawHref && plainClick && anchor.target !== '_blank';
            if (navigatesHere && rawHref.startsWith('./#') && _onCalendarPage()) {
                e.preventDefault();
                if (_panelOpen) closePanel();
                whenHistorySettled(() => { location.hash = rawHref.slice(2); });
                return;
            }
            if (navigatesHere && _panelOpen && _historyPushed) {
                e.preventDefault();
                closePanelForNavigation();      // clear _historyPushed + visually close (no history.back)
                location.replace(/** @type {HTMLAnchorElement} */ (anchor).href);   // overwrite the drawer's same-URL entry with the destination
                return;
            }
            if (!_panelOpen) return;            // a hand-off click can come with the drawer shut
            if (navigatesHere) closePanelForNavigation();   // no entry of ours to replace: the <a> navigates
            else closePanel();                  // this page stays: pop the entry, as ✕ does
            return;
        }
    });

    // End staff PIN (viewer mode only). Both the button and the footer label are refreshed on every
    // drawer open — see _refreshLock, called from openPanel beside _refreshBell.
    const lockBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('navLockCalendarBtn'));
    lockBtn?.addEventListener('click', async () => {
        // THE DRAWER STAYS OPEN UNTIL THE LOCK IS CONFIRMED: `lock()` rejects if the viewer session
        // survives sign-out, and the drawer is the only surface left to report that failure on.
        if (!lockBtn) return;
        const label = lockBtn.textContent;
        lockBtn.disabled = true;
        lockBtn.textContent = 'Ending…';
        try {
            await onLockCalendar?.lock?.();
            closePanelForNavigation();      // only reached if `lock()` did not navigate away
        } catch (err) {
            console.warn('[nav] End staff PIN failed:', err);
            const failed = 'Couldn’t end it — try again';
            lockBtn.textContent = failed;
            lockBtn.disabled = false;
            setTimeout(() => { if (lockBtn.textContent === failed) lockBtn.textContent = label; }, 6000);
        }
    });

    /** Reveal the lock button (and name the mode) when this browser is on the shared staff PIN. */
    function _refreshLock() {
        if (!onLockCalendar) return;
        // Fail CLOSED on a thrown thunk — hiding a button costs a walk to the browser menu, whereas
        // showing "End staff PIN" to a signed-in member offers them an action that does nothing to
        // their session and reads as though it did.
        let viewer;
        try { viewer = onLockCalendar.isViewer() === true; } catch { viewer = false; }
        if (lockBtn) { if (viewer) lockBtn.removeAttribute('hidden'); else lockBtn.setAttribute('hidden', ''); }
        const label = document.getElementById('navPanelMember');
        if (viewer && label && !label.textContent) label.textContent = 'Staff PIN access';
        // A footer with no member and no viewer has nothing in it — keep it away entirely. (A member's
        // footer is never hidden; this runs only where a PIN viewer can be: the Calendar and Trains.)
        const footer = document.querySelector('.nav-panel-footer');
        if (footer && !onSignOut) {
            if (viewer) footer.removeAttribute('hidden'); else footer.setAttribute('hidden', '');
        }
    }

    // Sign-out footer button
    const signOutBtn = document.getElementById('navSignOutBtn');
    let signingOut = false;   // a second tap during the close fade stacked two "Sign out anyway?"
    signOutBtn?.addEventListener('click', async () => {
        if (signingOut) return;
        signingOut = true;
        // POP the drawer's history entry and let it land first — left under the dialog it was a ghost entry.
        closePanel();
        await new Promise((resolve) => whenHistorySettled(() => resolve(undefined)));
        try {   // a throw re-arms the button rather than leaving it dead until a reload
            // Ask FIRST: releasing before a cancelled sign-out left the device with no push record.
            if (beforeSignOut && await beforeSignOut() === false) { signingOut = false; return; }
            // Release this device's push record WHILE still signed in (only its owner may delete it), so
            // targeted notices stop reaching a device they have left. Best-effort; never blocks sign-out.
            await releaseDevicePush();
            onSignOut?.();
        } catch (err) { signingOut = false; console.error('[nav-panel] sign-out failed:', err); }
    });

    // Brand (logo + title + version) opens the page's About lightbox, which pushes its OWN history
    // entry — so the drawer's entry is POPPED here (abandoned, it would swallow the next Back), and
    // About opens once that back()'s popstate has LANDED (whenHistorySettled), so its fresh entry
    // isn't consumed by the queued back().
    const brandBtn = document.getElementById('navPanelBrand');
    brandBtn?.addEventListener('click', () => {
        closePanel();
        whenHistorySettled(() => onLogoClick?.());
    });

    // Guides submenu accordion — an in-panel toggle, so the panel stays open.
    const guidesToggle = document.getElementById('navGuidesToggle');
    const guidesList   = document.getElementById('navGuidesList');
    guidesToggle?.addEventListener('click', () => {
        // aria-expanded is the ONLY state (the header says why; see the CSS note in shared.css).
        const isOpen = guidesToggle.getAttribute('aria-expanded') === 'true';
        guidesToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        // EXPANDING RESTORES THE SECTION, NOT NECESSARILY THE STATIC LIST: a search shows results in
        // its place. WHICH LIST SHOWS is `nav-guide-search.js`'s `render()` — read, never recomputed
        // here (a second copy of one boolean). Absent = the module never loaded = not filtering.
        const filtering = document.getElementById('navGuideSearchResults')?.dataset.gsActive === '1';
        if (guidesList) guidesList.hidden = isOpen || filtering;
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
                if (st) { st.textContent = 'Search is unavailable — the guides below still open.'; st.dataset.state = 'error'; }
            });
    });

    // Notification toggle — an in-panel action, so the panel stays open (a BLOCKED bell is the exception:
    // its tap explains itself in the info panel, below).
    const bell      = /** @type {HTMLButtonElement|null} */ (document.getElementById('navNotifBell'));
    const bellIcon  = document.getElementById('navNotifIcon');
    let _bellBusy   = false;
    // A REFRESH ANSWERS ONLY IF NOTHING NEWER HAS STARTED (review, 21 Nov 2026). Each open starts a
    // refresh it does not wait for; a tap while that refresh was still reading repainted the bell, when
    // it answered, with the state it read BEFORE the tap — 🔕 "off" on a device just subscribed. Every
    // refresh and every tap takes the next number, and a refresh paints only while its number is current.
    // …AND NEVER WHILE A TAP IS IN FLIGHT, NOR AFTER ITS ANSWER (24-hour check, 22 Nov 2026): the drawer
    // closed and reopened during a slow toggle (up to ~8 s) started a refresh with a HIGHER number than
    // the tap's, whose read — begun before the toggle settled — then painted the old 🔕 over the tap's 🔔.
    // So a refresh that finds a tap in flight after its first wait stands aside (`_bellBusy`): one that
    // gets past it begins its read only once the tap has let go, so it reads the tap's answer, never the
    // state from before it — and a tap that starts after that still makes it stale through the number.
    let _bellGen    = 0;

    /** Apply a state string to the toggle glyph and accessible name.
     * @param {any} state */
    function _paintBell(state) {
        if (!bell) return;
        const on = state === 'on';
        // While the real state is still resolving (up to ~8s for swReady), a neutral "working" glyph —
        // never 🔔, which only ever means genuinely on. Compact icon: the aria-label carries the state.
        if (bellIcon)  bellIcon.textContent  = state === 'loading' ? '🔄' : on ? '🔔' : '🔕';
        bell.dataset.notifState = state;
        // A TOGGLE SAYS ITS STATE ONCE (review, 21 Nov 2026): `aria-pressed` is the state, so the name
        // stays "Notifications" — the name used to say it too ("on — tap to turn off, toggle button,
        // pressed"). Checking and blocked are not on/off, so they drop `aria-pressed` and say what
        // they are; a blocked bell's tap explains how to allow them, and its name says so.
        const toggle = state !== 'loading' && state !== 'denied';
        if (toggle) bell.setAttribute('aria-pressed', on ? 'true' : 'false');
        else bell.removeAttribute('aria-pressed');
        bell.setAttribute('aria-label',
            state === 'loading' ? 'Notifications — checking…'
          : state === 'denied' ? 'Notifications blocked — how to allow them'
          : 'Notifications');
    }

    /**
     * Re-read and repaint the bell. No-op when the bell is not rendered.
     * Uses peekNotifState (no side effects) — repainting on every panel open
     * must not write to Firestore. VAPID rotation runs from calendar-app.js on load.
     */
    async function _refreshBell() {
        if (!bell) return;
        const gen = ++_bellGen;
        // NOT WHILE THE ACCOUNT BEHIND THE SESSION IS GONE: a tap then subscribed, the rules refused
        // the save and the bell flipped back to off unexplained. After the boot restore, so one in progress keeps it.
        const user = await currentUserAfterBoot(3000);
        if (gen !== _bellGen || _bellBusy) return;
        bell.hidden = !user;
        // A restore still running at 3s is not an account gone (48-hour review): bring it back when it lands.
        if (bell.hidden) { void currentUserAfterBoot().then(u => { if (u) void _refreshBell(); }); return; }
        const state = await peekNotifState();
        if (gen === _bellGen) _paintBell(state);
    }

    bell?.addEventListener('click', async () => {
        if (_bellBusy) return;
        const state = bell.dataset.notifState;
        // Browser-blocked: the browser will not ask again, so the tap SAYS where it is fixed — in the
        // drawer's info panel, as a document that cannot open does. It did nothing at all, under a 🔕
        // that looks exactly like "off" (whole-app check, 17 Nov 2026); the aria-label said "blocked"
        // to a screen reader only. Settings' card has each phone's own steps. 'loading' is a no-op:
        // toggling then would re-subscribe a device that may already be subscribed.
        if (state === 'denied') { _closePanelVisualOnly(); _openComingSoon(bell, blockedBellText(currentPage)); return; }
        if (state === 'loading') return;
        _bellBusy = true;
        _bellGen++;   // a refresh still reading from before this tap must not paint over it
        bell.dataset.notifState = 'loading';
        _paintBell('loading');   // repaint NOW — otherwise the old 🔔/"On" glyph shows through a slow toggle (up to 8s)
        bell.disabled = true;
        let failed = false;
        try {
            _paintBell(state === 'on' ? await disableNotifications() : await enableNotifications());
        } catch (err) {
            console.warn('[Nav] Bell toggle failed:', err);
            failed = true;
        } finally {
            bell.disabled = false;
            _bellBusy = false;
        }
        // Restore the real state if the toggle errored — once the tap has let go, or the refresh stands aside.
        if (failed) await _refreshBell();
    });

    // The drawer's info panel — a document that cannot open, and the blocked bell, explain themselves
    // here (its ids still say "coming soon": the links it was first built for are gone). Shared .lb-overlay pattern.
    const csLightbox = document.getElementById('navComingSoonLightbox');
    const csClose    = document.getElementById('navComingSoonClose');
    const csTitle    = document.getElementById('navComingSoonTitle');
    const csIcon     = document.getElementById('navComingSoonIcon');
    const csBody     = document.getElementById('navComingSoonBody');

    /**
     * Open the drawer's info panel for the control that was tapped (a document row, the blocked bell).
     * @param {HTMLElement} [triggerEl] the link that was tapped - its
     *   data-cs-title / data-cs-icon drive the heading, so the one generic
     *   lightbox shows the right title for whichever item opened it.
     * @param {string} [overrideBody]
     */
    function _openComingSoon(triggerEl, overrideBody) {
        if (!csLightbox) return;
        // Every trigger names itself (a document row, the blocked bell); these are only a neutral fallback —
        // "Coming soon" with a bell outlived the coming-soon links it was for (review, 21 Nov 2026).
        const title = triggerEl?.dataset.csTitle || 'Menu';
        const icon  = triggerEl?.dataset.csIcon  || 'ℹ️';
        const body  = overrideBody ?? triggerEl?.dataset.csBody ?? '';
        if (csTitle) csTitle.textContent = title;
        if (csIcon)  csIcon.textContent  = icon;
        if (csBody)  csBody.textContent  = body;
        csLightbox.setAttribute('aria-label', title);
        csLb.open();
    }

    /**
     * Shared teardown: fade `el` out, hide it once the fade completes, then unlock
     * scroll and return focus to the burger. A 500ms fallback fires in case
     * transitionend is suppressed (iOS backgrounded tab, prefers-reduced-motion).
     * At once when there is no fade: reduced motion, or a panel that never faded in.
     * @param {HTMLElement} el - The .lb-overlay element to finish closing.
     */
    function _finishNavLightboxClose(el) {
        const fadedIn = el.classList.contains('open');   // read before it goes: see the finish below
        el.classList.remove('open');
        // NEVER FADED IN, NOTHING TO FADE OUT (15 Nov 2026) — dismissOverlay's rule (overlay.js): a panel
        // closed before its first frame added `.open` is still transparent, so no transition runs, and
        // waiting for one left an invisible layer over the page for 500 ms, swallowing every tap.
        if (!fadedIn || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            el.classList.remove('visible');
            unlockBodyScroll();
            burger.focus();
            return;
        }
        const t = setTimeout(done, 500);
        // The panel's OWN fade only — `transitionend` bubbles, and a child's (a pressed button easing
        // back) finished this close early (lightbox review R1-4). Not `{ once: true }`: a child's event
        // would spend it, and `done` removes the listener itself.
        /** @param {Event} e */
        const onEnd = (e) => { if (e.target === el) done(); };
        function done() {
            clearTimeout(t);
            el.removeEventListener('transitionend', onEnd);
            el.classList.remove('visible');
            unlockBodyScroll();
            burger.focus();
        }
        el.addEventListener('transitionend', onEnd);
    }
    /** Another overlay open over a drawer lightbox (a dialog, a viewer a notification tap opened) owns the keyboard — `_isTopOverlay`'s rule, read from the DOM because these share the drawer's history entry (test audit, 7 Nov 2026). */
    const _overlayAbove = (/** @type {Element|null} */ own) => Array.from(document.querySelectorAll('.lb-overlay.open')).some(el => el !== own);

    /**
     * The lifecycle the drawer's two lightboxes share — the info panel and App Notices. NOT createLightbox
     * (.claude/rules/nav-drawer.md): both reuse the DRAWER's one history entry, so they hand-roll it, and
     * this is the one copy (they were two, line for line). What each keeps for itself is its content and
     * what Tab does in it. Its open state is the module's flag (`isOpen`/`setOpen`), because
     * `resetNavPanel` and the popstate handler ask it with no lightbox in hand.
     * @param {{ el: HTMLElement|null, closeBtn: HTMLElement|null, isOpen: () => boolean, setOpen: (v: boolean) => void, onTab: (e: KeyboardEvent) => void }} cfg
     */
    function _drawerLightbox({ el, closeBtn, isOpen, setOpen, onTab }) {
        function open() {
            if (!el) return;
            lockBodyScroll();
            setOpen(true);   // before the frame and the timer below, which both ask it
            el.classList.add('visible');
            // Its ✕ stays in reach as a long panel scrolls, as every createLightbox panel's does (overlay.js).
            // A no-op where the ✕ is not directly inside a scrolling panel (App Notices' list scrolls instead).
            pinCloseButton(/** @type {HTMLElement|null} */ (el.querySelector('.lb-content')));
            // A CLOSE BEFORE THIS FRAME, OR THE TIMER, RETIRES THEM (15 Nov 2026), as createLightbox's does:
            // an Escape before a slow engine draws, or a tab that runs no frames while hidden. Run after the
            // close, the frame faded the panel back in over the page and the timer moved focus into it.
            requestAnimationFrame(() => { if (isOpen()) el.classList.add('open'); });
            document.addEventListener('keydown', onKey);
            // Reuse the panel's single history entry (normally already present, as
            // the lightbox opens from the open panel); push one only if missing.
            if (!_historyPushed) _pushDrawerEntry();
            setTimeout(() => { if (isOpen()) closeBtn?.focus(); }, FOCUS_DELAY_MS);
        }
        // Called by user action (Escape, ✕, backdrop) — pop the shared entry.
        function close() {
            if (!el || !isOpen()) return;   // ONCE: a second ✕/backdrop tap mid-fade unlocked twice (test audit)
            setOpen(false);
            document.removeEventListener('keydown', onKey);
            if (_historyPushed) {
                _historyPushed = false;
                suppressNextPop();   // don't let the echo reach the overlay stack (v16.23)
                history.back();
            }
            _finishNavLightboxClose(el);
        }
        // Called from popstate — history.back() already happened.
        function closeFromBack() {
            if (!el) return;
            setOpen(false);
            _historyPushed = false;
            document.removeEventListener('keydown', onKey);
            _finishNavLightboxClose(el);
        }
        /** Escape closes it; Tab stays inside (`onTab` says where it goes). @param {any} e */
        function onKey(e) {
            // Stale-survivor guard: a copy surviving a reset-while-open would swallow every Tab page-wide
            // and its Escape would steal the REBUILT drawer's history entry. Self-remove.
            if (!isOpen()) { document.removeEventListener('keydown', onKey); return; }
            if (_overlayAbove(el)) return;   // one Escape closed both, and Tab was dragged back under it
            if (e.key === 'Escape') { close(); return; }
            if (e.key === 'Tab') { e.preventDefault(); onTab(e); }
        }
        closeBtn?.addEventListener('click', close);
        // Only close on a tap on the backdrop itself — the ✕ already has its own listener and event
        // bubbling would otherwise close twice; and a text selection dragged out onto it is not a tap
        // (`closeOnBackdropTap`).
        if (el) closeOnBackdropTap(el, close);
        return { open, closeFromBack, onKey };
    }

    // The info panel has one focusable element (the ✕), so Tab stays on it.
    const csLb = _drawerLightbox({
        el: /** @type {HTMLElement|null} */ (csLightbox), closeBtn: csClose,
        isOpen: () => _comingSoonOpen, setOpen: v => { _comingSoonOpen = v; },
        onTab: () => csClose?.focus(),
    });

    // App Notices archive lightbox — its lifecycle is `_drawerLightbox`'s, like the info
    // panel's (it reuses the panel's single history entry; no createLightbox).
    const noticesLightbox = document.getElementById('navNoticesLightbox');
    const noticesClose    = document.getElementById('navNoticesClose');
    const noticesList     = document.getElementById('navNoticesList');
    const noticesEmpty    = document.getElementById('navNoticesEmpty');

    function _openNotices() {
        if (!noticesLightbox) return;
        // Render the archive (notice-archive.js reads it, and an unreadable one reads as empty).
        const notices = readArchivedNotices();
        if (noticesList) {
            noticesList.innerHTML = '';
            notices.forEach(/** @param {any} n */ n => {
                const item    = document.createElement('div');
                item.className = 'notices-item';
                const header  = document.createElement('div');
                header.className = 'notices-item-header';
                const sectionEl = document.createElement('span');
                const sectionMod = SECTION_MODS[n.section];   // nav-destinations.js — a section with none stays grey
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
                noticesList.appendChild(item);
            });
        }
        if (noticesList)  noticesList.hidden  = notices.length === 0;
        if (noticesEmpty) noticesEmpty.hidden = notices.length > 0;
        noticesLb.open();
    }

    const noticesLb = _drawerLightbox({
        el: /** @type {HTMLElement|null} */ (noticesLightbox), closeBtn: noticesClose,
        isOpen: () => _noticesOpen, setOpen: v => { _noticesOpen = v; },
        // TWO STOPS, the ✕ and the list: the list SCROLLS, and one the keyboard cannot reach cannot
        // be scrolled (axe scrollable-region-focusable). A hidden (empty) list is no stop.
        onTab: e => {
            const stops = [noticesClose, noticesList].filter(el => el && !el.hidden);
            const at = stops.indexOf(/** @type {HTMLElement} */ (document.activeElement));
            stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
        },
    });
    // Register both with resetNavPanel's teardown list (an earlier init's were removed by its reset).
    _navLbKeyHandlers = [csLb.onKey, noticesLb.onKey];

    // Close panel on Escape; trap Tab focus within the panel while it is open (the
    // !panel.contains(active) guard pulls escaped focus back in). Stored module-level so
    // resetNavPanel() can remove it — a stale copy would leave the rebuilt drawer stuck open.
    _docKeydownHandler = (/** @type {KeyboardEvent} */ e) => {
        if (!_panelOpen) return;
        // ONLY THE TOPMOST SURFACE TAKES THE KEYBOARD: under a dialog such as
        // Admin's "Leave this page anyway?", Tab pulled focus behind the modal and one Escape closed both.
        if (document.querySelector('.lb-overlay.open')) return;
        if (e.key === 'Escape') { closePanel(); return; }
        if (e.key === 'Tab') {
            // The guide search box is a stop too (18 Nov 2026). Left out, a search matching nothing in a drawer with
            // no footer (a locked Calendar's) made it the last thing Tab could reach, and one Tab from it left the drawer.
            const focusable = /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

    // Android Back closes whichever overlay is open. The coming-soon and notices lightboxes share the
    // panel's single history entry, so check them first. Stored module-level so resetNavPanel() can
    // remove it (the keydown handler's stale-copy hazard).
    _popstateHandler = () => {
        if (!_historyPushed) { _stepOffLeftBehind(); return; }
        // What was popped sat ABOVE the drawer's entry — a dialog over the drawer or over one of its two
        // lightboxes, by Back or by the echo of its own Cancel, which overlay.js absorbs but cannot stop
        // reaching this listener too. It is the dialog's pop, not ours.
        if (_landedOnOwnEntry()) return;
        // Not at the address the entry was pushed at: a tap's hash navigation pushed above it, so the entry is
        // still there beneath — the drawer closes all the same, and steps off the entry later (above).
        if (_hereHref() !== _entryHref) _leftBehind = _navEntry;
        if (_comingSoonOpen) { csLb.closeFromBack(); return; }
        if (_noticesOpen)   { noticesLb.closeFromBack(); return; }
        closePanelFromBack();
    };
    window.addEventListener('popstate', _popstateHandler);
}

/** Build and inject the overlay + drawer HTML into document.body.
 * @param {any} currentPage
 * @param {any} memberName
 * @param {any} onSignOut
 * @param {any} isAdmin
 * @param {any} isLinksDesigner
 * @param {any} canOpenOvertime
 * @param {any} canOpenNewlink
 * @param {any} onLockCalendar
 */
function _inject(currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, canOpenOvertime, canOpenNewlink, onLockCalendar) {
    // Render every permitted destination. The current page is shown too — as an
    // inert "you are here" pill (aria-current) rather than being filtered out —
    // so the drawer doubles as a map, not just a list of exits.
    const pills = visiblePills(NAV_PAGES, { isAdmin, isLinksDesigner, canOpenOvertime, canOpenNewlink }, currentPage)
        .map(p => p.current
            ? `<span class="nav-panel-pill ${p.colorClass} nav-panel-pill--current" aria-current="page">${p.label}</span>`
            : `<a href="${p.url}" class="nav-panel-pill ${p.colorClass}">${p.label}</a>`)
        .join('');

    // The Latest documents: one flat list (nav-destinations.js).
    const infoLinks = `
        <ul class="nav-panel-links">
            ${NAV_INFORMATION.map(link => {
                if (link.circular)    return `<li><button type="button" class="nav-panel-link nav-panel-link--circular" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}"><span aria-hidden="true">${link.icon}</span> ${link.label}</button></li>`;
                if (link.newsletter)  return `<li${newsletterInMenu() ? '' : ' hidden'}><button type="button" class="nav-panel-link nav-panel-link--newsletter" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}"><span aria-hidden="true">${link.icon}</span> ${link.label}</button></li>`;
                return `<li><a href="${link.url}" class="nav-panel-link"><span aria-hidden="true">${link.icon}</span> ${link.label}</a></li>`;
            }).join('')}
        </ul>`;

    // Guides — expanded by default; the toggle can collapse the list. They navigate in the SAME TAB,
    // and the click handler appends ?from=<this page> so the guide's ← comes back HERE (guide-back.js).
    const guideLinks = NAV_GUIDES
        .map(g => `<li><a href="${g.url}" class="nav-panel-link nav-panel-link--guide nav-panel-link--stacked" data-open-id="${g.openId}"><span aria-hidden="true">${g.icon}</span><span class="nav-link-text"><span class="nav-link-title">${g.label}</span><span class="nav-link-sub">${g.sub}</span></span></a></li>`)
        .join('')
        // App Notices joins the guides, not the Workplace documents: it is a changelog for the app, and
        // both are "look something up", never a document you open on a shift. It goes LAST — it is the
        // rarest thing in the drawer.
        + `<li><button type="button" class="nav-panel-link nav-panel-link--notices"><span aria-hidden="true">📣</span> App Notices</button></li>`;

    // Member name is set via textContent (not innerHTML) after injection to avoid XSS.
    // The bell is only included when the device supports Web Push (notif.js folds in the
    // iOS-must-be-standalone rule). A COMPACT icon button next to Sign out (owner decision: a labelled
    // full-width row has been tried and reverted twice): settings.html's Notifications card is the
    // canonical surface. Signed-in only — `onSignOut` as well as notifSupported(): the footer also
    // carries a PIN viewer's End staff PIN button, and a viewer's subscription write the rules DENY.
    // A control that cannot succeed must not be offered.
    const bellHtml = (onSignOut && notifSupported()) ? `
                    <button class="nav-panel-bell" id="navNotifBell" type="button"
                            aria-label="Notifications — checking…"
                            data-notif-state="loading" data-cs-title="Notifications blocked" data-cs-icon="🔕">
                        <span id="navNotifIcon" aria-hidden="true">🔄</span>
                    </button>` : '';
    // "End staff PIN" (owner, 21 Nov 2026; it read "Lock Calendar", but it ends the PIN for the documents
    // and Trains too, and shows on Trains) — shown ONLY while this browser is on the shared staff PIN.
    // Rendered hidden and revealed on drawer open, because access resolves after this markup is
    // built. It sits where Sign out sits for a member, which is the same idea in the same place:
    // the thing you press before you walk away.
    const lockHtml = onLockCalendar ? `
                    <button class="nav-panel-signout nav-panel-lock" id="navLockCalendarBtn" type="button" hidden>End staff PIN</button>` : '';
    // The footer exists for a member (name + bell + sign out) OR for a viewer (the lock button).
    // Rendered `hidden` for a lock-only footer and revealed by `_refreshLock` once access resolves —
    // otherwise a LOCKED visitor got an empty footer bar with a blank member name.
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
                        aria-label="Marylebone Roster, Version ${APP_VERSION} — about this app">
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
                    <!-- "Latest", not "Today" or "Information": TODAY over a weekly circular and a
                         monthly newsletter is wrong for two of three, and every drawer item is
                         information. "Latest" is true of all three and needs no idiom. -->
                    <p class="nav-panel-section-heading">Latest</p>
                    ${infoLinks}
                </div>
                <div class="nav-panel-section">
                    <!-- EXPANDED BY DEFAULT (owner): a collapsed section is one you have to know is
                         there, and the guides are what a reader does not know to look for. Still a
                         real toggle. The measurements are this module's header. -->
                    <button type="button" class="nav-panel-guides-toggle" id="navGuidesToggle"
                            aria-expanded="true" aria-controls="navGuidesList">
                        <span class="nav-panel-guides-heading">Reference</span>
                        <!-- The COLLAPSED header's count (css-tokens.md: a chip goes where a card is
                             often collapsed): closed, "Reference ▾" alone reads as a section that
                             failed to render. Open, the rows are the count, so the CSS hides it there
                             (shared.css has why it is not branched here). Derived, never typed: a
                             guide added to NAV_GUIDES must not leave a stale number behind it. -->
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
                               enterkeyhint="search" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="none"
                               placeholder="Search the guides…" aria-label="Search all the guides">
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
             aria-label="Menu" aria-describedby="navComingSoonBody" aria-modal="true">
            <div class="lb-content" id="navComingSoonContent">
                <button type="button" id="navComingSoonClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-icon" id="navComingSoonIcon" aria-hidden="true">📰</div>
                <div class="nav-cs-title" id="navComingSoonTitle">Menu</div>
                <div class="nav-cs-body" id="navComingSoonBody"></div>
            </div>
        </div>
        <div id="navNoticesLightbox" class="lb-overlay" role="dialog"
             aria-label="App Notices" aria-modal="true">
            <div class="lb-content" id="navNoticesContent">
                <button type="button" id="navNoticesClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-title">📣 App Notices</div>
                <div id="navNoticesList" class="nav-notices-list" tabindex="0" role="group" aria-label="Notices shown on this device"></div>
                <div id="navNoticesEmpty" class="nav-notices-empty" hidden>Notices shown on this device appear here.</div>
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
