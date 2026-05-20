/**
 * nav-panel.js — Slide-out navigation panel, shared by all three main pages.
 *
 * Injects overlay + drawer HTML into document.body, then wires the burger
 * button (#navMenuBtn). Uses the same history.pushState / popstate pattern
 * as the existing overlay helpers in app.js so Android Back closes the panel.
 *
 * Usage (call once, after DOM is ready — ES modules are deferred by default):
 *   import { initNavPanel } from './nav-panel.js';
 *   initNavPanel({ currentPage: 'calendar' }); // 'calendar' | 'admin' | 'paycalc'
 */

/** Page navigation destinations. The current page is omitted from the pill row. */
const NAV_PAGES = [
    { id: 'calendar', label: '📅 Calendar', url: './index.html'    },
    { id: 'admin',    label: '⚙ Admin',    url: './admin.html'    },
    { id: 'paycalc',  label: '💷 Pay',      url: './paycalc.html' },
];

/**
 * Information section — flat, always-open. Two sub-groups: Workplace and Staff Travel.
 * Adding a new guide means one entry here; no other changes needed.
 */
const NAV_INFORMATION = [
    {
        heading: 'Workplace',
        links: [
            { icon: '🎫', label: 'Railcard Guide', url: './railcard-guide.html' },
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
 * @param {{ currentPage?: 'calendar'|'admin'|'paycalc' }} opts
 */
export function initNavPanel({ currentPage = 'calendar' } = {}) {
    const burger = document.getElementById('navMenuBtn');
    if (!burger) return;

    _inject(currentPage);

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

    burger.addEventListener('click', openPanel);
    closeBtn?.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

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

/** Build and inject the overlay + drawer HTML into document.body. */
function _inject(currentPage) {
    const pills = NAV_PAGES
        .filter(p => p.id !== currentPage)
        .map(p => `<a href="${p.url}" class="nav-panel-pill">${p.label}</a>`)
        .join('');

    const infoGroups = NAV_INFORMATION.map(group => `
        <p class="nav-panel-group-heading">${group.heading}</p>
        <ul class="nav-panel-links">
            ${group.links.map(link =>
                `<li><a href="${link.url}" class="nav-panel-link">${link.icon} ${link.label}</a></li>`
            ).join('')}
        </ul>`).join('');

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
        </div>`;

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);
}
