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

/**
 * Page navigation destinations. The current page is omitted from the pill row.
 * colorClass mirrors the equivalent quick-action button on the calendar page:
 *   calendar → gold (matches Today button)
 *   admin    → navy + gold text (matches Admin button)
 *   paycalc  → green (matches Pay button)
 */
const NAV_PAGES = [
    { id: 'calendar', label: '📅 Calendar', url: './index.html',    colorClass: 'nav-panel-pill--calendar' },
    { id: 'admin',    label: '⚙ Admin',    url: './admin.html',    colorClass: 'nav-panel-pill--admin'    },
    { id: 'paycalc',  label: '💷 Pay',      url: './paycalc.html', colorClass: 'nav-panel-pill--pay'      },
];

/**
 * Information section — flat, always-open. Two sub-groups: Workplace and Staff Travel.
 * Adding a new guide means one entry here; no other changes needed.
 * A link with `comingSoon: true` (instead of `url`) renders as a button that
 * opens the "coming soon" lightbox rather than navigating.
 */
const NAV_INFORMATION = [
    {
        heading: 'Workplace',
        links: [
            { icon: '📋', label: 'Daily Huddle',           url: './index.html#huddle'   },
            { icon: '📰', label: 'Weekly Retail Circular', comingSoon: true             },
            { icon: '🎫', label: 'Railcard Guide',         url: './railcard-guide.html' },
        ],
    },
    {
        heading: 'Staff Travel',
        links: [
            { icon: '🇪🇺', label: 'FIP Travel Guide', url: './fip.html' },
        ],
    },
];

let _panelOpen    = false;
let _historyPushed = false;

/**
 * Initialise the navigation panel for the current page.
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc', memberName?: string|null, onSignOut?: (() => void)|null }} opts
 */
export function initNavPanel({ currentPage = 'calendar', memberName = null, onSignOut = null } = {}) {
    const burger = document.getElementById('navMenuBtn');
    if (!burger) return;

    _inject(currentPage, memberName, onSignOut);

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
        if (e.target.closest('.nav-panel-pill, .nav-panel-link')) closePanelForNavigation();
    });

    // Sign-out footer button
    const signOutBtn = document.getElementById('navSignOutBtn');
    signOutBtn?.addEventListener('click', () => {
        closePanelForNavigation();
        onSignOut?.();
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
        } finally {
            bell.disabled = false;
            _bellBusy = false;
        }
    });

    // "Coming soon" placeholder lightbox — reuses the shared .lb-overlay pattern.
    const csLightbox = document.getElementById('navComingSoonLightbox');
    const csClose    = document.getElementById('navComingSoonClose');

    function _openComingSoon() {
        if (!csLightbox) return;
        _lockBodyScroll();
        csLightbox.classList.add('visible');
        requestAnimationFrame(() => csLightbox.classList.add('open'));
        document.addEventListener('keydown', _onComingSoonKey);
        setTimeout(() => csClose?.focus(), 60);
    }

    function _closeComingSoon() {
        if (!csLightbox) return;
        csLightbox.classList.remove('open');
        csLightbox.addEventListener('transitionend', function done() {
            csLightbox.classList.remove('visible');
            csLightbox.removeEventListener('transitionend', done);
            _unlockBodyScroll();
        }, { once: true });
        document.removeEventListener('keydown', _onComingSoonKey);
    }

    function _onComingSoonKey(e) { if (e.key === 'Escape') _closeComingSoon(); }

    csClose?.addEventListener('click', _closeComingSoon);
    csLightbox?.addEventListener('click', e => {
        if (e.target === csLightbox || e.target === csClose) _closeComingSoon();
    });

    document.addEventListener('keydown', e => {
        if (_panelOpen && e.key === 'Escape') closePanel();
    });

    // Android Back button closes the panel.
    // Guard on _historyPushed so this handler ignores all other popstate events
    // (e.g. from app.js overlay pattern — both handlers listen to the same event).
    window.addEventListener('popstate', () => {
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
function _inject(currentPage, memberName, onSignOut) {
    const pills = NAV_PAGES
        .filter(p => p.id !== currentPage)
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
                <span class="nav-panel-member" id="navPanelMember"></span>
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
                <img src="./icon-192.png" alt="" class="nav-panel-icon" loading="eager">
                <span class="nav-panel-title">Marylebone Roster</span>
                <button class="nav-panel-close" id="navPanelClose"
                        aria-label="Close navigation menu">✕</button>
            </div>
            <div class="nav-panel-body">
                <div class="nav-panel-pills">${pills}</div>
                <div class="nav-panel-section">
                    <p class="nav-panel-section-heading">Information</p>
                    ${infoGroups}
                </div>
            </div>
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
    }
}
