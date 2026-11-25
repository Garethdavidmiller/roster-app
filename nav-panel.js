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
 * supports Web Push. All push logic lives in notif.js — nav-bell.js only renders,
 * refreshes and toggles the bell.
 *
 * ── WHAT THIS FILE KEEPS, AND WHAT IT HANDS OUT ─────────────────────────────────────────────────
 *
 * This file is the drawer's COORDINATOR: its open/close, its ONE history entry (shared with its two
 * lightboxes, and claimed from overlay.js's stack while live), the delegated click that every link,
 * pill and guide row goes through, the Tab trap, sign-out and the reset. The rest was moved out on
 * 25 Nov 2026, each part with its own reasoning in its own header, and is wired from `initNavPanel`:
 *
 *   · nav-panel-markup.js      — the HTML, drawn from nav-destinations.js's data
 *   · nav-drawer-lightboxes.js — the info panel and App Notices, and their one shared lifecycle
 *   · nav-latest-doc.js        — the Circular and Newsletter rows' one-tap open
 *   · nav-bell.js              — the footer's notification bell
 *   · nav-guide-fold.js        — the Reference fold and the guide search's lazy load
 *
 * Each is handed only what it needs of the drawer — a getter for a flag, the close it may call —
 * and every flag stays HERE, because the reset and the Back handler below read them all at once.
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

import { releaseDevicePush } from './notif.js';
import { getLatestCircular, getLatestNewsletter } from './firebase-client.js';
import { newsletterInMenu } from './newsletter-recency.js';
import { lockBodyScroll, unlockBodyScroll, suppressNextPop, registerPopInterceptor, whenHistorySettled, watchScrollFade } from './overlay.js';
import { recordOpen } from './usage-reporter.js';
import { injectNavPanel } from './nav-panel-markup.js';
import { createDrawerLightboxes, FOCUS_DELAY_MS } from './nav-drawer-lightboxes.js';
import { createLatestDocOpener } from './nav-latest-doc.js';
import { wireNavBell } from './nav-bell.js';
import { wireGuideFold } from './nav-guide-fold.js';

// The drawer's destinations — NAV_PAGES, NAV_INFORMATION, NAV_GUIDES, SECTION_MODS — and the pill
// filter are DATA, in nav-destinations.js: imported by the tests rather than read out of this file as
// text, and by the modules that draw them (nav-panel-markup.js, nav-drawer-lightboxes.js, nav-guide-fold.js).

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

/**
 * Tear down an already-initialised nav panel so initNavPanel() can rebuild it from scratch with a
 * different identity. initNavPanel self-guards (burger.dataset.navPanelInit) and `injectNavPanel`
 * (nav-panel-markup.js) APPENDS its DOM (a second call would duplicate the drawer), so there is otherwise
 * no way to refresh the footer name / admin pills after the panel is wired. Three callers: page-session.js, when a session ends in place
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
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc'|'operations'|'settings'|'links'|'overtime'|'trains'|'newlink', memberName?: string|null, onSignOut?: (() => void)|null, beforeSignOut?: (() => boolean|Promise<boolean>)|null, isAdmin?: boolean, isLinksDesigner?: boolean, canOpenOvertime?: boolean, canOpenNewlink?: boolean, isNotOtherStaff?: boolean, onLogoClick?: (() => void)|null, authReady?: Promise<any>, canReadDocuments?: () => boolean }} opts
 *   canReadDocuments — a THUNK: may the two document links read? Calendar, Overtime, Pay and Trains pass
 *   their own; with none it is `!!memberName`, never "yes" (22 Nov 2026): offline the cache answers with no
 *   rule asked (calendar-doc-access.js), so a drawer wired for nobody opened an earlier visitor's document.
 *   authReady — resolves once a Firebase session exists; awaited before the Circular/Newsletter
 *   read (AUTH_PLAN.md → E1). Each page passes its own (calendar: `calendarAuthReady`; the
 *   authenticated pages: `sessionReady`). Defaults to already-resolved.
 *   onLogoClick — opens the page's About lightbox when the drawer logo is tapped (a sub-page's
 *   header logo goes back to the calendar, so About lives here).
 *   isNotOtherStaff — the one gate that defaults to TRUE (nav-destinations.js → `otherStaffHidden` says why).
 */
export function initNavPanel({ currentPage = 'calendar', memberName = null, onSignOut = null, beforeSignOut = null, isAdmin = false, isLinksDesigner = false, canOpenOvertime = false, canOpenNewlink = false, isNotOtherStaff = true, onLogoClick = null, authReady = Promise.resolve(), canReadDocuments = () => !!memberName } = {}) {
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

    injectNavPanel(currentPage, memberName, onSignOut, { isAdmin, isLinksDesigner, canOpenOvertime, canOpenNewlink, isNotOtherStaff });

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

    // The drawer's two lightboxes — the info panel and App Notices — share the drawer's ONE history entry, so
    // they are handed the three moves on it, and their open flags stay here (nav-drawer-lightboxes.js).
    const { openComingSoon: _openComingSoon, openNotices: _openNotices, csLb, noticesLb } = createDrawerLightboxes({
        burger,
        entry: { isPushed: () => _historyPushed, push: _pushDrawerEntry, forget: () => { _historyPushed = false; } },
        comingSoon: { isOpen: () => _comingSoonOpen, setOpen: v => { _comingSoonOpen = v; } },
        notices: { isOpen: () => _noticesOpen, setOpen: v => { _noticesOpen = v; } },
    });

    // The Circular and Newsletter rows open the latest issue in one tap (nav-latest-doc.js).
    const _openLatestDoc = createLatestDocOpener({
        panel, isPanelOpen: () => _panelOpen, closePanel, _closePanelVisualOnly, _openComingSoon, _onCalendarPage,
        canReadDocuments, authReady, _usageId,
    });

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

    // The Reference fold, and the guide search that loads on the box's first focus (nav-guide-fold.js).
    wireGuideFold();

    // Notification toggle — an in-panel action, so the panel stays open (a BLOCKED bell is the exception: its
    // tap explains itself in the info panel). Wired once; `openPanel` refreshes it on every open (nav-bell.js).
    const _refreshBell = wireNavBell({ currentPage, _closePanelVisualOnly, _openComingSoon });

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
