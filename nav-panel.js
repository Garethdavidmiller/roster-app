/**
 * nav-panel.js — Slide-out navigation panel, shared by all three main pages.
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

import { notifSupported, getNotifState, enableNotifications, disableNotifications } from './notif.js';
import { teamMembers, APP_VERSION } from './roster-data.js';

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
            { icon: '📰', label: 'Weekly Retail Circular', comingSoon: true           },
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

let _panelOpen    = false;
let _historyPushed = false;
let _csHistoryPushed = false;

/**
 * Initialise the navigation panel for the current page.
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc'|'operations'|'settings', memberName?: string|null, onSignOut?: (() => void)|null, isAdmin?: boolean, onLogoClick?: (() => void)|null }} opts
 *   onLogoClick — opens the page's existing About/version lightbox when the
 *   drawer logo is tapped. The header logo on sub-pages is now a back button,
 *   so About lives on the drawer logo instead.
 */
export function initNavPanel({ currentPage = 'calendar', memberName = null, onSignOut = null, isAdmin = false, onLogoClick = null } = {}) {
    const burger = document.getElementById('navMenuBtn');
    if (!burger) return;
    if (burger.dataset.navPanelInit) return;
    burger.dataset.navPanelInit = '1';

    _inject(currentPage, memberName, onSignOut, isAdmin);

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
        _lockBodyScroll();
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

    function closePanel() {
        _panelOpen    = false;
        panel.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.remove('open');
        panel.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        _unlockBodyScroll();
        if (_historyPushed) {
            _historyPushed = false;
            history.back(); // removes the state we pushed — triggers popstate
        }
        burger.focus();
    }

    // Called from popstate — history.back() already happened, don't call it again.
    function closePanelFromBack() {
        _panelOpen    = false;
        _historyPushed = false;
        panel.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.remove('open');
        panel.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        _unlockBodyScroll();
        burger.focus();
    }

    // Visual-only close used when a link inside the panel is clicked.
    // Does NOT call history.back() — the navigation that follows handles page
    // transitions, and for hash-only links (e.g. #huddle) history.back() would
    // race with the hash navigation and cause unexpected behaviour.
    function closePanelForNavigation() {
        _panelOpen    = false;
        _historyPushed = false; // consumed — popstate won't reopen the panel
        panel.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.remove('open');
        panel.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        _unlockBodyScroll();
    }

    burger.addEventListener('click', openPanel);
    closeBtn?.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    // Close panel before navigating so the panel doesn't flash behind the new page.
    // A "coming soon" link is a button, not a navigation link — close the panel
    // and open the placeholder lightbox instead.
    panel.addEventListener('click', e => {
        const comingSoon = e.target.closest('.nav-panel-link--coming-soon');
        if (comingSoon) {
            closePanelForNavigation();
            _openComingSoon();
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

    // Notification bell toggle — an in-panel action, so the panel stays open.
    const bell     = document.getElementById('navNotifBell');
    const bellHint = document.getElementById('navNotifHint');
    let _bellBusy  = false;

    /** Apply a state string to the bell glyph, label, and data attribute. */
    function _paintBell(state) {
        if (!bell) return;
        const on = state === 'on';
        bell.textContent = on ? '🔔' : '🔕';
        bell.setAttribute('aria-pressed', on ? 'true' : 'false');
        bell.dataset.notifState = state;
        bell.setAttribute('aria-label',
            on        ? 'Notifications on — tap to turn off'
          : state === 'denied' ? 'Notifications blocked in browser settings'
          : 'Notifications off — tap to turn on');
        if (bellHint) bellHint.hidden = true;
    }

    /** Re-read and repaint the bell. No-op when the bell is not rendered. */
    async function _refreshBell() {
        if (!bell) return;
        _paintBell(await getNotifState());
    }

    bell?.addEventListener('click', async () => {
        if (_bellBusy) return;
        const state = bell.dataset.notifState;
        // Browser-blocked: nothing we can do programmatically — just hint.
        if (state === 'denied') {
            if (bellHint) bellHint.hidden = false;
            return;
        }
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
    let _csReturnFocus = null;

    function _openComingSoon() {
        if (!csLightbox) return;
        _csReturnFocus = document.activeElement; // restore focus here on close
        _lockBodyScroll();
        csLightbox.classList.add('visible');
        requestAnimationFrame(() => csLightbox.classList.add('open'));
        document.addEventListener('keydown', _onComingSoonKey);
        if (!_csHistoryPushed) {
            history.pushState({ mybNavComingSoon: true }, '');
            _csHistoryPushed = true;
        }
        setTimeout(() => csClose?.focus(), 60);
    }

    // Called by user action (Escape, click) — history entry still exists, remove it.
    function _closeComingSoon() {
        if (!csLightbox) return;
        document.removeEventListener('keydown', _onComingSoonKey);
        csLightbox.classList.remove('open');
        if (_csHistoryPushed) {
            _csHistoryPushed = false;
            history.back();
        }
        // Fallback timer ensures body scroll is always unlocked even if
        // transitionend never fires (prefers-reduced-motion, iOS quirks, etc.).
        const t = setTimeout(done, 400);
        function done() {
            clearTimeout(t);
            csLightbox.classList.remove('visible');
            _unlockBodyScroll();
            _csReturnFocus?.focus();
            _csReturnFocus = null;
        }
        csLightbox.addEventListener('transitionend', done, { once: true });
    }

    // Called from popstate — history.back() already happened.
    function _closeComingSoonFromBack() {
        if (!csLightbox) return;
        _csHistoryPushed = false;
        document.removeEventListener('keydown', _onComingSoonKey);
        csLightbox.classList.remove('open');
        const t = setTimeout(done, 400);
        function done() {
            clearTimeout(t);
            csLightbox.classList.remove('visible');
            _unlockBodyScroll();
            _csReturnFocus?.focus();
            _csReturnFocus = null;
        }
        csLightbox.addEventListener('transitionend', done, { once: true });
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

    // Close panel on Escape; trap Tab focus within the panel while it is open.
    // The !panel.contains(active) guard catches focus that escaped the panel
    // (e.g. via a programmatic focus() call elsewhere) and pulls it back in.
    document.addEventListener('keydown', e => {
        if (!_panelOpen) return;
        if (e.key === 'Escape') { closePanel(); return; }
        if (e.key === 'Tab') {
            const focusable = Array.from(panel.querySelectorAll(
                'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ));
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

    // Android Back button closes whichever overlay is currently open.
    // Coming-soon lightbox is checked first (it sits on top of the nav panel).
    window.addEventListener('popstate', () => {
        if (_csHistoryPushed) { _closeComingSoonFromBack(); return; }
        if (!_historyPushed) return;
        closePanelFromBack();
    });
}

// Body-scroll lock for the coming-soon lightbox. Mirrors the per-page helpers in
// app.js / admin-app.js / paycalc.js (not exported there, so re-implemented here).
let _navScrollY = 0;
function _lockBodyScroll() {
    _navScrollY = window.scrollY || 0;
    document.body.style.setProperty('--lb-scroll-y', `-${_navScrollY}px`);
    document.body.classList.add('lb-open');
}
function _unlockBodyScroll() {
    document.body.classList.remove('lb-open');
    document.body.style.removeProperty('--lb-scroll-y');
    window.scrollTo(0, _navScrollY);
}

/** Build and inject the overlay + drawer HTML into document.body. */
function _inject(currentPage, memberName, onSignOut, isAdmin) {
    const pills = NAV_PAGES
        .filter(p => p.id !== currentPage)
        .filter(p => !p.adminOnly || isAdmin)
        .map(p => `<a href="${p.url}" class="nav-panel-pill ${p.colorClass}">${p.label}</a>`)
        .join('');

    const infoGroups = NAV_INFORMATION.map(group => `
        <p class="nav-panel-group-heading">${group.heading}</p>
        <ul class="nav-panel-links">
            ${group.links.map(link => link.comingSoon
                ? `<li><button type="button" class="nav-panel-link nav-panel-link--coming-soon">${link.icon} ${link.label}</button></li>`
                : `<li><a href="${link.url}" class="nav-panel-link">${link.icon} ${link.label}</a></li>`
            ).join('')}
        </ul>`).join('');

    // Guides — collapsed by default; the toggle reveals the list.
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
    const bellHtml = notifSupported() ? `
            <button class="nav-panel-bell" id="navNotifBell" type="button"
                    aria-pressed="false" aria-label="Notifications"
                    data-notif-state="loading">🔕</button>` : '';
    const footerHtml = onSignOut ? `
        <div class="nav-panel-footer">
            <div class="nav-panel-footer-row">
                <div class="nav-panel-member-wrap">
                    <span class="nav-panel-member" id="navPanelMember"></span>
                    <span class="nav-panel-flags" id="navPanelFlags" aria-hidden="true"></span>
                </div>
                <div class="nav-panel-footer-actions">
                    ${bellHtml}
                    <button class="nav-panel-signout" id="navSignOutBtn">Sign out</button>
                </div>
            </div>
            <span class="nav-panel-bell-hint" id="navNotifHint" hidden>Blocked — change in browser settings</span>
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
                        <span class="nav-panel-version">v${APP_VERSION}</span>
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
                    <button type="button" class="nav-panel-guides-toggle" id="navGuidesToggle"
                            aria-expanded="false" aria-controls="navGuidesList">
                        <span class="nav-panel-guides-heading">📖 Guides</span>
                        <span class="nav-panel-guides-arrow" aria-hidden="true">▾</span>
                    </button>
                    <ul class="nav-panel-links nav-panel-guides-list" id="navGuidesList" hidden>
                        ${guideLinks}
                    </ul>
                </div>
            </div>
            ${settingsHtml}
            ${footerHtml}
        </div>
        <div id="navComingSoonLightbox" class="lb-overlay" role="dialog"
             aria-label="Weekly Retail Circular" aria-modal="true">
            <div class="lb-content" id="navComingSoonContent">
                <button id="navComingSoonClose" class="lb-close" aria-label="Close">✕</button>
                <div class="nav-cs-icon" aria-hidden="true">📰</div>
                <div class="nav-cs-title">Weekly Retail Circular</div>
                <div class="nav-cs-body">Coming soon</div>
            </div>
        </div>`;

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);

    // Set member name safely via textContent (XSS-safe — no innerHTML for user data)
    if (memberName) {
        const memberEl = document.getElementById('navPanelMember');
        if (memberEl) memberEl.textContent = `👤 ${memberName}`;

        // Nationality flags (optional `flags` array on the teamMember). Shown
        // between the name and the bell. Up to two flags per member.
        // Hidden on Windows — flag emoji render as 2-letter country codes there.
        const isWindows = /Win/.test(navigator.userAgentData?.platform ?? navigator.platform) || /Windows/.test(navigator.userAgent);
        const member    = teamMembers.find(m => m.name === memberName);
        const flagsEl   = document.getElementById('navPanelFlags');
        if (flagsEl && member?.flags?.length && !isWindows) {
            flagsEl.textContent = member.flags.join(' ');
        }
    }
}
