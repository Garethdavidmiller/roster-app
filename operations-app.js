/**
 * operations-app.js — Coordinator for operations.html.
 *
 * Owns: session guard (redirect to admin.html if not admin), Firebase Auth
 *   re-establishment, page init wiring for the three operations cards.
 * Does NOT own: Huddle upload logic (huddle.js), roster PDF pipeline
 *   (admin-roster-upload.js), staff auth setup (admin-auth.js).
 * Edit here for: page-level session handling, card order, nav wiring.
 */

import { CONFIG, escapeHtml } from './roster-data.js';
import { auth } from './firebase-client.js';
import { loadOverrides } from './admin-overrides.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initAuthSetup } from './admin-auth.js';
import { initNavPanel } from './nav-panel.js';
import { getSession, clearSession, ensureFirebaseSession } from './session.js';
import { lockBodyScroll, unlockBodyScroll, _pushOverlayState, _clearOverlayHistory } from './overlay.js';

// ============================================
// SESSION — read from localStorage (shared with admin-app.js via session.js)
// ============================================
const currentSession = getSession();
const currentUser    = currentSession?.name ?? null;
const isAdmin        = CONFIG.ADMIN_NAMES.includes(currentUser);

// Guard: must be signed in AND be an admin — redirect otherwise
if (!currentUser || !isAdmin) {
    window.location.replace('./admin.html');
    // Throw to halt module execution immediately — location.replace is async and JS continues otherwise.
    throw new Error('Not authorised — redirecting');
}

// Store as a Promise so admin-auth.js can await it before "Set up accounts"
window._mybSession = ensureFirebaseSession(currentUser);


// ============================================
// PAGE INIT
// ============================================
document.body.classList.add('auth-ready');

// Assigned by the About-lightbox IIFE further down; the closure below only reads
// it when the drawer logo is tapped, by which point it is set.
let openAboutLightbox = null;

initNavPanel({
    currentPage: 'operations',
    memberName:  currentUser,
    isAdmin:     true,
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   () => { clearSession(); window.location.href = './admin.html'; },
});

initHuddleUpload({ currentIsAdmin: true, currentUser });

initRosterUpload({
    currentUser,
    currentIsAdmin: true,
    parseUrl:   'https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF',
    getIdToken: async () => { await window._mybSession; return auth.currentUser?.getIdToken(); },
    loadOverrides,
});

initAuthSetup({ currentIsAdmin: true });

// ============================================
// COLLAPSIBLE CARD HEADERS
// ============================================
function initCardCollapse(triggerId, bodyId, chevronId) {
    const trigger = document.getElementById(triggerId);
    const body    = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if (!trigger || !body || !chevron) return;
    trigger.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
}

initCardCollapse('huddleToggleHeader',      'huddleBody',      'huddleChevron');
initCardCollapse('rosterUploadToggleHeader','rosterUploadBody','rosterUploadChevron');
initCardCollapse('authSetupToggleHeader',   'authSetupBody',   'authSetupChevron');

// Show a banner if Firebase Auth couldn't establish a real admin session.
// Anonymous fallback still resolves the Promise so the page renders, but
// Cloud Functions and Storage both require a valid admin token — they'll
// reject silently without this warning.
window._mybSession.then(ok => {
    if (!ok || window._mybAuthError) {
        const main   = document.querySelector('.container');
        if (!main) return;
        const banner = document.createElement('p');
        banner.style.cssText = 'margin:12px 16px 0;padding:12px 14px;background:var(--error-bg);border-left:4px solid var(--error-banner);border-radius:6px;font-size:14px;color:var(--text-dark);';
        banner.textContent   = 'We couldn\'t confirm your admin sign-in. Please sign out and back in before using these tools.';
        main.prepend(banner);
    }
});

// ============================================
// ICON LIGHTBOX — tap header icon for version / about
// ============================================
(function () {
    const OPS_VERSION = CONFIG.APP_VERSION;
    const lightbox  = document.getElementById('iconLightbox');
    const headerIcon = document.getElementById('appIcon');
    const closeBtn  = document.getElementById('iconLightboxClose');
    const versionEl = document.getElementById('lightboxVersion');
    const statusEl  = document.getElementById('lightboxUpdateStatus');
    const bugLink   = document.getElementById('opsBugReportLink');

    if (!lightbox || !headerIcon) return;
    if (versionEl) versionEl.textContent = OPS_VERSION;

    function open() {
        if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; }
        if (bugLink) {
            const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const body = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster Operations v${OPS_VERSION}\nUser: ${currentUser}\nDate: ${date}\nBrowser: ${navigator.userAgent}`;
            bugLink.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — MYB Roster Operations v${OPS_VERSION}`)}&body=${encodeURIComponent(body)}`;
        }
        lightbox.classList.add('visible');
        requestAnimationFrame(() => lightbox.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(close);
        document.addEventListener('keydown', onKey);
    }

    function close() {
        _clearOverlayHistory();
        lightbox.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        let done = false;
        function finish() {
            if (done) return; done = true;
            lightbox.classList.remove('visible');
            unlockBodyScroll();
        }
        const t = setTimeout(finish, 400);
        lightbox.addEventListener('transitionend', () => { clearTimeout(t); finish(); }, { once: true });
    }

    function onKey(e) { if (e.key === 'Escape') close(); }

    // Header logo is a back-to-calendar button (About moved to the drawer logo).
    openAboutLightbox = open;
    headerIcon.title = 'Back to calendar';
    headerIcon.setAttribute('aria-label', 'Back to calendar');
    headerIcon.addEventListener('click', () => { window.location.href = './index.html'; });
    lightbox.addEventListener('click', e => { if (e.target === lightbox || e.target === closeBtn) close(); });
    if (bugLink) bugLink.addEventListener('click', e => e.stopPropagation());
})();

// ============================================
// TIPS LIGHTBOX — ? button on each card
// ============================================
(function () {
    const lb       = document.getElementById('tipsLightbox');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb) return;

    const CARD_TIPS = {
        'daily-huddle': {
            title: 'Daily Huddle',
            sections: [{ items: [
                { icon: '📋', html: 'Upload the day\'s Huddle briefing — staff open it via ☰ → <strong>Daily Huddle</strong> on the main app' },
                { icon: '📄', html: '<strong>PDF</strong> — opens in the browser. <strong>Word (.docx)</strong> — displayed inside the app' },
                { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
                { icon: '🤖', html: 'The Huddle email uploads automatically each day — use this card if you need to upload it manually' },
            ]}],
        },
        'weekly-roster': {
            title: 'Weekly Roster upload',
            sections: [
                { heading: 'How it works', items: [
                    { icon: '1️⃣', html: 'Choose the <strong>roster type</strong> (CEA/Bilingual, CES, or Dispatcher) and the <strong>week ending date</strong> (always a Saturday)' },
                    { icon: '2️⃣', html: 'Choose the PDF roster file and tap <strong>Read roster</strong> — the app reads the shifts (takes ~15 seconds)' },
                    { icon: '3️⃣', html: 'Review each person\'s changes — <strong>Save</strong> or <strong>Skip</strong> each day individually' },
                    { icon: '4️⃣', html: 'Tap <strong>Save changes</strong> to write approved shifts to the roster' },
                ]},
                { heading: 'Conflicts', items: [
                    { icon: '⚠️', html: 'If a day already has a <strong>recorded change</strong> that differs from the PDF, it shows as a conflict — choose which to keep' },
                    { icon: '🔄', html: 'Old roster uploads are replaced automatically — only your manual changes show a warning if the new PDF disagrees' },
                ]},
            ],
        },
        'staff-login': {
            title: 'Staff Login Accounts',
            sections: [{ items: [
                { icon: '🔐', html: 'Creates a secure login for every active staff member so the app knows who is saving changes' },
                { icon: '✅', html: 'Safe to run any time — people who already have an account are skipped, so it won\'t break anything' },
                { icon: '👤', html: 'Run this whenever someone <strong>joins</strong> the roster to give them access' },
                { icon: '🚪', html: 'Tick <strong>"Disable accounts for leavers"</strong> and run it when someone <strong>leaves</strong> — their account is disabled so they can no longer sign in' },
            ]}],
        },
    };

    function openTips(card) {
        const data = CARD_TIPS[card];
        if (!data || !titleEl || !bodyEl) return;
        titleEl.textContent = data.title;
        bodyEl.innerHTML = data.sections.map(section => {
            const heading = section.heading
                ? `<div class="tips-lb-section">${escapeHtml(section.heading)}</div>`
                : '';
            const items = section.items.map(item =>
                `<div class="tips-lb-item"><span class="tips-lb-icon" aria-hidden="true">${item.icon}</span><span>${item.html}</span></div>`
            ).join('');
            return heading + items;
        }).join('');
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(closeTips);
        document.addEventListener('keydown', onKey);
    }

    function closeTips() {
        _clearOverlayHistory();
        lb.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        let done = false;
        function finish() {
            if (done) return; done = true;
            lb.classList.remove('visible');
            unlockBodyScroll();
        }
        const t = setTimeout(finish, 400);
        lb.addEventListener('transitionend', () => { clearTimeout(t); finish(); }, { once: true });
    }

    function onKey(e) { if (e.key === 'Escape') closeTips(); }

    document.querySelectorAll('.btn-card-tips').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openTips(btn.dataset.card);
        });
    });

    if (closeBtn) closeBtn.addEventListener('click', closeTips);
    lb.addEventListener('click', e => { if (e.target === lb) closeTips(); });
})();

// ============================================
// SERVICE WORKER — registration + silent update
// ============================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
            function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }
            if (registration.waiting) activate(registration.waiting);
            registration.addEventListener('updatefound', () => {
                const nw = registration.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw);
                });
            });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            }, { once: true });
        })
        .catch(e => console.warn('[SW] Registration failed:', e));
}
