// @ts-check
/**
 * nav-panel.js — Slide-out navigation panel, shared by all six app pages.
 *
 * Injects overlay + drawer HTML into document.body, then wires the burger
 * button (#navMenuBtn). Uses the same history.pushState / popstate pattern
 * as the existing overlay helpers in app.js so Android Back closes the panel.
 *
 * Usage (call once, after DOM is ready — ES modules are deferred by default):
 *   import { initNavPanel } from './nav-panel.js';
 *   initNavPanel({ currentPage: 'calendar', memberName: 'G. Miller', onSignOut: fn });
 *   // memberName + onSignOut are optional; omit both to suppress the footer.
 *
 * The footer also hosts a push-notification bell toggle (🔔/🔕) when the device
 * supports Web Push. All push logic lives in notif.js — this file only renders
 * and refreshes the bell.
 */

import { notifSupported, peekNotifState, enableNotifications, disableNotifications } from './notif.js';
import { APP_VERSION, avatarInitials, avatarHue } from './roster-data.js';
import { lockBodyScroll, unlockBodyScroll } from './overlay.js';
import { lsGet, lsSet } from './ls.js';
import { getLatestCircular, getLatestNewsletter } from './firebase-client.js';

/**
 * Page navigation destinations. The current page is omitted from the pill row.
 * colorClass mirrors the equivalent quick-action button on the calendar page:
 *   calendar → gold (matches Today button)
 *   admin    → navy + gold text (matches Admin button)
 *   paycalc  → green (matches Pay button)
 */
const NAV_PAGES = [
    { id: 'calendar',   label: '📅 Calendar',   url: './index.html',      colorClass: 'nav-panel-pill--calendar'   },
    { id: 'admin',      label: '📝 Admin',       url: './admin.html',      colorClass: 'nav-panel-pill--admin'      },
    { id: 'paycalc',    label: '💷 Pay',         url: './paycalc.html',    colorClass: 'nav-panel-pill--pay'        },
    { id: 'operations', label: '🔧 Ops',          url: './operations.html', colorClass: 'nav-panel-pill--operations', adminOnly: true },
    { id: 'links',      label: '🔗 Links',         url: './links.html',      colorClass: 'nav-panel-pill--links',      linksDesignerOnly: true },
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
            { icon: '📋', label: 'Daily Huddle',           url: './index.html#huddle' },
            { icon: '📰', label: 'Weekly Retail Circular', circular: true, body: 'No circular has been uploaded yet — it\'s usually available on Friday.' },
            { icon: '🗞️', label: 'Marylebone Newsletter',  newsletter: true, body: 'No newsletter has been uploaded yet — check back soon.' },
            { icon: '📣', label: 'App Notices', notices: true },
        ],
    },
];

/**
 * Guides — collapsible submenu (tap "📖 Guides" to expand). Static reference
 * pages, grouped together so the Information section stays focused on live docs.
 * Adding a guide = one entry here.
 */
const NAV_GUIDES = [
    { icon: '📘', label: 'Staff & Admin Guide',  url: './guide.html'          },
    { icon: '💷', label: 'Pay Calculator Guide', url: './paycalc-guide.html'  },
    { icon: '🎫', label: 'Railcard Guide',       url: './railcard-guide.html' },
    { icon: '🇪🇺', label: 'FIP Travel Guide',     url: './fip.html'            },
];

let _panelOpen      = false;
// A single shallow history entry, shared by the panel and any lightbox that
// opens from inside it — so Android Back pops exactly one entry.
let _historyPushed  = false;
let _comingSoonOpen = false;
let _noticesOpen    = false;

/** localStorage key for the archived notices list. */
const NOTICES_KEY = 'myb_app_notices';
/** Archive entries older than this are pruned from localStorage. */
const ARCHIVE_EXPIRY_DAYS = 180;

const _MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
function _parseNoticeDate(str) {
    const [d, mon, y] = str.trim().split(/\s+/);
    const m = _MONTHS[mon];
    return (m === undefined) ? NaN : new Date(+y, m, +d).getTime();
}

/**
 * Returns true if a notice's posting date is older than the given number of days.
 * Use to silently dismiss stale notices on a new device:
 *   if (isNoticeExpired(NOTICE_DATE))     { lsSet(DONE_KEY, '1'); return; }  // 28-day (default)
 *   if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }  // 90-day (long)
 * @param {string} dateStr — "D Mon YYYY", e.g. "22 Jun 2026"
 * @param {number} [days=28] — expiry window: 28 for short-range, 90 for long-range
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
            // Migrate legacy pre-v13.41 records (no archivedAt) by stamping them with
            // `now` instead of dropping them — otherwise the first archive write after
            // an upgrade would silently wipe the user's whole notice history.
            .map(n => (n && n.archivedAt) ? n : { ...n, archivedAt: nowIso })
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
 * Initialise the navigation panel for the current page.
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc'|'operations'|'settings', memberName?: string|null, onSignOut?: (() => void)|null, isAdmin?: boolean, onLogoClick?: (() => void)|null }} opts
 *   onLogoClick — opens the page's existing About/version lightbox when the
 *   drawer logo is tapped. The header logo on sub-pages is now a back button,
 *   so About lives on the drawer logo instead.
 */
export function initNavPanel({ currentPage = 'calendar', memberName = null, onSignOut = null, isAdmin = false, isLinksDesigner = false, onLogoClick = null } = {}) {
    const burger = document.getElementById('navMenuBtn');
    if (!burger) return;
    if (burger.dataset.navPanelInit) return;
    burger.dataset.navPanelInit = '1';
    burger.setAttribute('aria-haspopup', 'dialog');
    burger.setAttribute('aria-controls', 'navPanel');
    burger.setAttribute('aria-expanded', 'false');

    _inject(currentPage, memberName, onSignOut, isAdmin, isLinksDesigner);

    const panel    = document.getElementById('navPanel');
    const overlay  = document.getElementById('navPanelOverlay');
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

    // Close panel before navigating so the panel doesn't flash behind the new page.
    // "Coming soon" and "App Notices" links are buttons — close the panel and open
    // their lightboxes instead of navigating.
    panel.addEventListener('click', e => {
        const comingSoon = e.target.closest('.nav-panel-link--coming-soon');
        if (comingSoon) {
            _closePanelVisualOnly();    // keep the history entry for the lightbox
            _openComingSoon(comingSoon);
            return;
        }
        const circular = e.target.closest('.nav-panel-link--circular');
        if (circular) {
            if (_docFetching) return;
            _docFetching = true;
            // Open a blank tab synchronously (same event tick = user gesture) so
            // Safari does not classify the later window.open() inside .then() as a
            // popup and block it. Clear opener to prevent the opened page from
            // accessing window.opener on this app.
            const newTab = window.open('', '_blank');
            if (newTab) newTab.opener = null;
            getLatestCircular().then(data => {
                if (data?.storageUrl) {
                    if (newTab) {
                        newTab.location.href = data.storageUrl;
                    } else {
                        // Popup was blocked — fall back to current-tab navigation.
                        location.href = data.storageUrl;
                    }
                    closePanelForNavigation();
                } else {
                    if (newTab) newTab.close();
                    _closePanelVisualOnly();
                    _openComingSoon(circular);
                }
            }).catch(() => {
                if (newTab) newTab.close();
                _closePanelVisualOnly();
                _openComingSoon(circular, 'Couldn\'t connect — check your signal and try again.');
            }).finally(() => { _docFetching = false; });
            return;
        }
        const newsletter = e.target.closest('.nav-panel-link--newsletter');
        if (newsletter) {
            if (_docFetching) return;
            _docFetching = true;
            const newTab = window.open('', '_blank');
            if (newTab) newTab.opener = null;
            getLatestNewsletter().then(data => {
                if (data?.storageUrl) {
                    if (newTab) {
                        newTab.location.href = data.storageUrl;
                    } else {
                        // Popup was blocked — fall back to current-tab navigation.
                        location.href = data.storageUrl;
                    }
                    closePanelForNavigation();
                } else {
                    if (newTab) newTab.close();
                    _closePanelVisualOnly();
                    _openComingSoon(newsletter);
                }
            }).catch(() => {
                if (newTab) newTab.close();
                _closePanelVisualOnly();
                _openComingSoon(newsletter, 'Couldn\'t connect — check your signal and try again.');
            }).finally(() => { _docFetching = false; });
            return;
        }
        if (e.target.closest('.nav-panel-link--notices')) {
            _closePanelVisualOnly();
            _openNotices();
            return;
        }
        if (e.target.closest('.nav-panel-pill, .nav-panel-link')) { closePanelForNavigation(); return; }
    });

    // Sign-out footer button
    const signOutBtn = document.getElementById('navSignOutBtn');
    signOutBtn?.addEventListener('click', () => {
        closePanelForNavigation();
        onSignOut?.();
    });

    // Brand (logo + title + version) opens the page's About lightbox.
    // Close the panel first (same pattern as the coming-soon link) so the
    // About lightbox isn't stacked behind the open drawer.
    const brandBtn = document.getElementById('navPanelBrand');
    brandBtn?.addEventListener('click', () => {
        closePanelForNavigation();
        onLogoClick?.();
    });

    // Guides submenu accordion — an in-panel toggle, so the panel stays open.
    const guidesToggle = document.getElementById('navGuidesToggle');
    const guidesList   = document.getElementById('navGuidesList');
    guidesToggle?.addEventListener('click', () => {
        const isOpen = guidesToggle.getAttribute('aria-expanded') === 'true';
        guidesToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        guidesToggle.classList.toggle('open', !isOpen);
        if (guidesList) guidesList.hidden = isOpen;
    });

    // Notification toggle — an in-panel action, so the panel stays open.
    const bell      = document.getElementById('navNotifBell');
    const bellIcon  = document.getElementById('navNotifIcon');
    let _bellBusy   = false;

    /** Apply a state string to the toggle glyph and accessible name. */
    function _paintBell(state) {
        if (!bell) return;
        const on = state === 'on';
        if (bellIcon)  bellIcon.textContent  = on ? '🔔' : '🔕';
        bell.setAttribute('aria-pressed', on ? 'true' : 'false');
        bell.dataset.notifState = state;
        bell.setAttribute('aria-label',
            on        ? 'Notifications on — tap to turn off'
          : state === 'denied' ? 'Notifications blocked in browser settings'
          : 'Notifications off — tap to turn on');
    }

    /**
     * Re-read and repaint the bell. No-op when the bell is not rendered.
     * Uses peekNotifState (no side effects) — repainting on every panel open
     * must not write to Firestore. VAPID rotation runs from app.js on load.
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
        if (state === 'denied') return;
        _bellBusy = true;
        bell.dataset.notifState = 'loading';
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
     * @param {HTMLElement} [triggerEl] the link that was tapped — its
     *   data-cs-title / data-cs-icon drive the heading, so the one generic
     *   lightbox shows the right title for whichever item opened it.
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

    function _finishComingSoonClose() { _finishNavLightboxClose(csLightbox); }

    // Called by user action (Escape, ✕, backdrop) — pop the shared entry.
    function _closeComingSoon() {
        if (!csLightbox) return;
        _comingSoonOpen = false;
        document.removeEventListener('keydown', _onComingSoonKey);
        csLightbox.classList.remove('open');
        if (_historyPushed) {
            _historyPushed = false;
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
    function _onComingSoonKey(e) {
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
        try { notices = JSON.parse(lsGet(NOTICES_KEY) || '[]'); } catch (_) {}
        const SECTION_MODS = { Pay: 'pay', Links: 'links', Settings: 'settings', Operations: 'ops', Calendar: 'calendar' };
        if (list) {
            list.innerHTML = '';
            notices.forEach(n => {
                const item    = document.createElement('div');
                item.className = 'notices-item';
                const header  = document.createElement('div');
                header.className = 'notices-item-header';
                const sectionEl = document.createElement('span');
                const sectionMod = SECTION_MODS[n.section];
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

    function _finishNoticesClose() { _finishNavLightboxClose(noticesLightbox); }

    function _closeNotices() {
        if (!noticesLightbox) return;
        _noticesOpen = false;
        document.removeEventListener('keydown', _onNoticesKey);
        noticesLightbox.classList.remove('open');
        if (_historyPushed) {
            _historyPushed = false;
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

    function _onNoticesKey(e) {
        if (e.key === 'Escape') { _closeNotices(); return; }
        if (e.key === 'Tab')    { e.preventDefault(); noticesClose?.focus(); }
    }

    noticesClose?.addEventListener('click', _closeNotices);
    noticesLightbox?.addEventListener('click', e => {
        if (e.target === noticesLightbox) _closeNotices();
    });

    // Close panel on Escape; trap Tab focus within the panel while it is open.
    // The !panel.contains(active) guard catches focus that escaped the panel
    // (e.g. via a programmatic focus() call elsewhere) and pulls it back in.
    document.addEventListener('keydown', e => {
        if (!_panelOpen) return;
        if (e.key === 'Escape') { closePanel(); return; }
        if (e.key === 'Tab') {
            const focusable = Array.from(panel.querySelectorAll(
                'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(el => el.offsetParent !== null); // visible only — skip the collapsed Guides links
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
    });

    // Android Back button closes whichever overlay is currently open. The
    // coming-soon and notices lightboxes share the panel's single history entry,
    // so check them first (they sit on top of the visually-closed panel).
    window.addEventListener('popstate', () => {
        if (_comingSoonOpen) { _closeComingSoonFromBack(); return; }
        if (_noticesOpen)   { _closeNoticesFromBack(); return; }
        if (!_historyPushed) return;
        closePanelFromBack();
    });
}

// lockBodyScroll / unlockBodyScroll imported from overlay.js

/** Build and inject the overlay + drawer HTML into document.body. */
function _inject(currentPage, memberName, onSignOut, isAdmin, isLinksDesigner) {
    // Render every permitted destination. The current page is shown too — as an
    // inert "you are here" pill (aria-current) rather than being filtered out —
    // so the drawer doubles as a map, not just a list of exits.
    const pills = NAV_PAGES
        .filter(p => !p.adminOnly || isAdmin)
        .filter(p => !p.linksDesignerOnly || isLinksDesigner)
        .map(p => p.id === currentPage
            ? `<span class="nav-panel-pill ${p.colorClass} nav-panel-pill--current" aria-current="page">${p.label}</span>`
            : `<a href="${p.url}" class="nav-panel-pill ${p.colorClass}">${p.label}</a>`)
        .join('');

    const infoGroups = NAV_INFORMATION.map(group => `
        <p class="nav-panel-group-heading">${group.heading}</p>
        <ul class="nav-panel-links">
            ${group.links.map(link => {
                if (link.comingSoon) return `<li><button type="button" class="nav-panel-link nav-panel-link--coming-soon" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}">${link.icon} ${link.label}</button></li>`;
                if (link.circular)    return `<li><button type="button" class="nav-panel-link nav-panel-link--circular" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}">${link.icon} ${link.label}</button></li>`;
                if (link.newsletter)  return `<li><button type="button" class="nav-panel-link nav-panel-link--newsletter" data-cs-title="${link.label}" data-cs-icon="${link.icon}" data-cs-body="${link.body ?? ''}">${link.icon} ${link.label}</button></li>`;
                if (link.notices)   return `<li><button type="button" class="nav-panel-link nav-panel-link--notices">${link.icon} ${link.label}</button></li>`;
                return `<li><a href="${link.url}" class="nav-panel-link">${link.icon} ${link.label}</a></li>`;
            }).join('')}
        </ul>`).join('');

    // Guides — expanded by default; the toggle can collapse the list.
    const guideLinks = NAV_GUIDES
        .map(g => `<li><a href="${g.url}" class="nav-panel-link">${g.icon} ${g.label}</a></li>`)
        .join('');

    // Settings link — always visible except on the settings page itself.
    // Uses the same nav-panel-link / nav-panel-links / nav-panel-group-heading classes
    // as the INFORMATION section so it is visually identical to the info links.
    // Settings has its own login overlay, so unsigned-in users are handled there.
    const settingsHtml = (currentPage !== 'settings') ? `
        <div class="nav-panel-settings">
            <p class="nav-panel-group-heading">Preferences</p>
            <ul class="nav-panel-links">
                <li><a href="./settings.html" class="nav-panel-link">⚙ Settings</a></li>
            </ul>
        </div>` : '';

    // Footer is only rendered when a sign-out callback is supplied.
    // Member name is set via textContent (not innerHTML) after injection to avoid XSS.
    // The bell is only included when the device supports Web Push (notif.js folds
    // in the iOS-must-be-standalone rule); the admin Notifications card explains
    // the unsupported case for users who need it.
    // A labelled full-width row (not a bare glyph) so the app's core feature —
    // push alerts — is discoverable, and separated from the destructive Sign out.
    const bellHtml = notifSupported() ? `
                <button class="nav-panel-bell" id="navNotifBell" type="button"
                        aria-pressed="false" aria-label="Checking notification status…"
                        data-notif-state="loading">
                    <span id="navNotifIcon" aria-hidden="true">🔔</span>
                </button>` : '';
    const footerHtml = onSignOut ? `
        <div class="nav-panel-footer">
            <div class="nav-panel-footer-row">
                <div class="nav-panel-member-wrap">
                    <span class="nav-panel-avatar" id="navPanelAvatar" aria-hidden="true"></span>
                    <span class="nav-panel-member" id="navPanelMember"></span>
                </div>
                <div class="nav-panel-footer-actions">
                    ${bellHtml}
                    <button class="nav-panel-signout" id="navSignOutBtn">Sign out</button>
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
                    <p class="nav-panel-section-heading">Information</p>
                    ${infoGroups}
                </div>
                <div class="nav-panel-section">
                    <button type="button" class="nav-panel-guides-toggle open" id="navGuidesToggle"
                            aria-expanded="true" aria-controls="navGuidesList">
                        <span class="nav-panel-guides-heading">📖 Guides</span>
                        <span class="nav-panel-guides-arrow" aria-hidden="true">▾</span>
                    </button>
                    <ul class="nav-panel-links nav-panel-guides-list" id="navGuidesList">
                        ${guideLinks}
                    </ul>
                </div>
            </div>
            ${settingsHtml}
            ${footerHtml}
        </div>
        <div id="navComingSoonLightbox" class="lb-overlay" role="dialog"
             aria-label="Coming soon" aria-modal="true">
            <div class="lb-content" id="navComingSoonContent">
                <button id="navComingSoonClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-icon" id="navComingSoonIcon" aria-hidden="true">📰</div>
                <div class="nav-cs-title" id="navComingSoonTitle">Coming soon</div>
                <div class="nav-cs-body" id="navComingSoonBody"></div>
            </div>
        </div>
        <div id="navNoticesLightbox" class="lb-overlay" role="dialog"
             aria-label="App Notices" aria-modal="true">
            <div class="lb-content" id="navNoticesContent">
                <button id="navNoticesClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-title">📣 App Notices</div>
                <div id="navNoticesList" class="nav-notices-list"></div>
                <div id="navNoticesEmpty" class="nav-notices-empty" hidden>No notices yet — check back soon.</div>
            </div>
        </div>`;

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);

    // Set member name safely via textContent (XSS-safe — no innerHTML for user data)
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
