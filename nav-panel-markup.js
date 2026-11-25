// @ts-check
/**
 * nav-panel-markup.js — The drawer's HTML: the overlay, the panel (its head, the pills, Latest, Reference and
 * the footer) and its two lightboxes, built once per `initNavPanel` and appended to document.body.
 *
 * Moved out of nav-panel.js (25 Nov 2026), which wires what this draws. WHAT it draws is DATA —
 * nav-destinations.js's NAV_PAGES, NAV_INFORMATION and NAV_GUIDES, filtered by `visiblePills` — and the
 * argument behind the drawer's SHAPE (three zones, one pill per row, Reference expanded, `aria-expanded` the
 * fold's only state) is nav-panel.js's header, which is where a reader changing the drawer starts.
 *
 * Two rules that live in THIS file:
 *   · the member's name and initials go in by `textContent`, never into the template (XSS);
 *   · every id the wiring looks up is written here (`navPanel`, `navNotifBell`, `navGuidesToggle`, …): an id
 *     renamed here is a control that nav-panel.js, nav-bell.js or nav-guide-fold.js silently stops wiring.
 */

import { notifSupported } from './notif.js';
import { APP_VERSION, avatarInitials, avatarHue } from './roster-data.js';
import { newsletterInMenu } from './newsletter-recency.js';
import { NAV_PAGES, NAV_INFORMATION, NAV_GUIDES, visiblePills } from './nav-destinations.js';

/** Build and inject the overlay + drawer HTML into document.body (nav-panel.js calls it once per `initNavPanel`).
 * @param {any} currentPage
 * @param {any} memberName
 * @param {any} onSignOut
 * @param {import('./nav-destinations.js').NavGates} gates  the pill gates, as `visiblePills` reads them
 */
export function injectNavPanel(currentPage, memberName, onSignOut, gates) {
    // Render every permitted destination. The current page is shown too — as an
    // inert "you are here" pill (aria-current) rather than being filtered out —
    // so the drawer doubles as a map, not just a list of exits.
    const pills = visiblePills(NAV_PAGES, gates, currentPage)
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
    // canonical surface. Signed-in only — `onSignOut` as well as notifSupported(), as the footer it
    // sits in is (a subscription write with nobody signed in is one the rules DENY, and a control that
    // cannot succeed must not be offered).
    const bellHtml = (onSignOut && notifSupported()) ? `
                    <button class="nav-panel-bell" id="navNotifBell" type="button"
                            aria-label="Notifications — checking…"
                            data-notif-state="loading" data-cs-title="Notifications blocked" data-cs-icon="🔕">
                        <span id="navNotifIcon" aria-hidden="true">🔄</span>
                    </button>` : '';
    // The footer exists for a member only: name, bell and Sign out. ("End staff PIN", the footer a PIN
    // viewer had, went with the PIN, 23 Nov 2026.)
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
                         real toggle. The measurements are nav-panel.js's header. -->
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
                             list below as ordinary guide links — the delegated handler in nav-panel.js gives
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
                <p class="nav-notices-intro">The notices this app has shown on this phone or computer, newest first. Each stays for six months.</p>
                <div id="navNoticesList" class="nav-notices-list" tabindex="0" role="group" aria-label="Notices shown on this device"></div>
                <div id="navNoticesEmpty" class="nav-notices-empty" hidden>Notices shown on this device appear here.</div>
            </div>
        </div>`;

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);

    // Set member name safely via textContent (XSS-safe — no innerHTML for user data)
    if (!memberName) {
        // No member (a footer is drawn only with Sign out, so this is defensive): nobody to name. Drop the avatar
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
