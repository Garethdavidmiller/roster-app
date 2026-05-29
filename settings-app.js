/**
 * settings-app.js — Coordinator for settings.html.
 *
 * Owns: login/session check, push notifications card, cultural calendar card.
 * Session is shared with admin-app.js via the same AUTH_KEY in localStorage —
 * a user already signed in on admin.html will arrive here without seeing the login overlay.
 */

import { CONFIG, teamMembers, CALENDAR_NAMES, resolveFaithCalendar, APP_VERSION } from './roster-data.js';
import { db, doc, getDoc, setDoc, auth, authReady, onAuthStateChanged, nameToEmail, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut as firebaseSignOut } from './firebase-client.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { initNavPanel } from './nav-panel.js';
import { initHuddleNotifications } from './admin-huddle.js';

// ── Scroll lock (iOS Safari) ──────────────────────────────────────────────────
let _lbScrollY = 0;
function lockBodyScroll() {
    _lbScrollY = window.scrollY;
    document.body.style.setProperty('--lb-scroll-y', `-${_lbScrollY}px`);
    document.body.classList.add('lb-open');
}
function unlockBodyScroll() {
    document.body.classList.remove('lb-open');
    document.body.style.removeProperty('--lb-scroll-y');
    window.scrollTo(0, _lbScrollY);
}

// ── Android Back button pattern ───────────────────────────────────────────────
let _overlayHistoryPushed = false;
let _backHandler = null;
function _pushOverlayState(closeHandler) {
    if (!_overlayHistoryPushed) {
        history.pushState({ mybOverlay: true }, '');
        _overlayHistoryPushed = true;
    }
    _backHandler = closeHandler;
}
function _clearOverlayHistory() {
    if (_overlayHistoryPushed) {
        _overlayHistoryPushed = false;
        _backHandler = null;
        history.back();
    }
}
window.addEventListener('popstate', () => {
    if (!_overlayHistoryPushed) return;
    _overlayHistoryPushed = false;
    const fn = _backHandler;
    _backHandler = null;
    fn?.();
});

// ── Session (shared key with admin-app.js) ────────────────────────────────────
const AUTH_KEY    = 'myb_admin_session';
const SESSION_MS  = 30 * 24 * 60 * 60 * 1000;
const SESSION_VER = 2;

function getSurname(fullName) {
    return fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
}

async function ensureFirebaseSession(name) {
    await authReady;
    const existing = await new Promise(resolve => {
        const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
    });
    if (existing) return true;

    const pw       = getSurname(name);
    const fbPw     = pw.length >= 6 ? pw : pw.padEnd(6, pw);
    const email    = nameToEmail(name);
    let firstError = null;

    try {
        await signInWithEmailAndPassword(auth, email, fbPw);
        return true;
    } catch (e) {
        firstError = e.code;
        if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
            try {
                await createUserWithEmailAndPassword(auth, email, fbPw);
                return true;
            } catch (createErr) {
                firstError = createErr.code;
            }
        }
    }
    try {
        await signInAnonymously(auth);
        return true;
    } catch (anonErr) {
        console.error('[Auth] Anonymous sign-in failed:', anonErr.code);
        return false;
    }
}

function getSession() {
    try {
        const raw = lsGet(AUTH_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (Date.now() > s.expiry) { lsDel(AUTH_KEY); return null; }
        if ((s.ver || 1) < SESSION_VER) { lsDel(AUTH_KEY); return null; }
        return s;
    } catch { return null; }
}

function saveSession(name) {
    lsSet(AUTH_KEY, JSON.stringify({ name, ver: SESSION_VER, expiry: Date.now() + SESSION_MS }));
}

function clearSession() {
    lsDel(AUTH_KEY);
    firebaseSignOut(auth).catch(() => {});
}

// ── Check session ─────────────────────────────────────────────────────────────
const currentSession   = getSession();
const isAuthenticated  = !!currentSession;
const currentUser      = currentSession?.name ?? null;

// Assigned by initIconLightbox (runs inside initApp when signed in); the closure
// below only reads it when the drawer logo is tapped.
let openAboutLightbox = null;

// Nav panel is always initialised — even when not signed in, so the user can
// navigate to Calendar or Admin rather than being stranded on the login overlay.
// onSignOut is null when not authenticated, which hides the footer.
initNavPanel({
    currentPage: 'settings',
    memberName:  currentUser,
    isAdmin:     currentUser ? CONFIG.ADMIN_NAMES.includes(currentUser) : false,
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   currentUser ? () => { clearSession(); window.location.href = './index.html'; } : null,
});

if (isAuthenticated) {
    ensureFirebaseSession(currentUser); // re-establish Firebase Auth in background
    initApp();
} else {
    initLoginOverlay();
}
registerSW();

// ── Login overlay ─────────────────────────────────────────────────────────────
function initLoginOverlay() {
    const overlay       = document.getElementById('loginOverlay');
    const gradeSelect   = document.getElementById('loginGrade');
    const nameSelect    = document.getElementById('loginName');
    const passwordInput = document.getElementById('loginPassword');
    const submitBtn     = document.getElementById('loginSubmit');
    const errorEl       = document.getElementById('loginError');

    if (!overlay) return;
    overlay.classList.add('visible');
    lockBodyScroll();

    const GRADE_ORDER = ['CEA', 'CES', 'Dispatcher'];
    const GRADE_KEY   = 'myb_login_grade';

    GRADE_ORDER.forEach(g => gradeSelect.appendChild(new Option(g, g)));

    const savedGrade = lsGet(GRADE_KEY);
    if (savedGrade) { gradeSelect.value = savedGrade; populateNames(savedGrade); }

    function populateNames(grade) {
        const gradeMap = { CEA: ['main', 'bilingual', 'fixed'], CES: ['ces'], Dispatcher: ['dispatcher'] };
        const types    = gradeMap[grade] || [];
        const members  = teamMembers.filter(m => !m.hidden && types.includes(m.rosterType));
        nameSelect.innerHTML = '<option value="">— Select name —</option>';
        members.forEach(m => nameSelect.appendChild(new Option(m.name, m.name)));
        nameSelect.disabled = members.length === 0;
    }

    gradeSelect.addEventListener('change', () => {
        lsSet(GRADE_KEY, gradeSelect.value);
        populateNames(gradeSelect.value);
        passwordInput.value = '';
        errorEl.classList.remove('visible');
    });

    async function attemptLogin() {
        const name = nameSelect.value;
        const pw   = passwordInput.value.trim().toLowerCase().replace(/[^a-z]/g, '');
        if (!name) { showError('Please select your name.'); return; }
        if (!pw)   { showError('Please enter your password.'); return; }
        if (pw !== getSurname(name)) { showError('Incorrect password. Your password is your surname (lowercase).'); return; }

        submitBtn.disabled  = true;
        submitBtn.textContent = 'Signing in…';
        errorEl.classList.remove('visible');

        await ensureFirebaseSession(name);
        saveSession(name);
        overlay.classList.remove('visible');
        unlockBodyScroll();
        window.location.reload();
    }

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.add('visible');
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Sign in →';
    }

    submitBtn.addEventListener('click', attemptLogin);
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
}

// ── Main app init (runs when authenticated) ───────────────────────────────────
function initApp() {
    // Card collapse — notif card is wired by initHuddleNotifications() below; only wire religious here
    initCardCollapse('religiousToggleHeader','religiousBody',  'religiousChevron');

    // Notifications card
    initHuddleNotifications();

    // Cultural calendar card
    initCulturalCalendarCard();

    // Tips lightbox
    initTipsLightbox();

    // Icon lightbox
    initIconLightbox();
}

// ── Card collapse helper ──────────────────────────────────────────────────────
function initCardCollapse(headerId, bodyId, chevronId) {
    const header  = document.getElementById(headerId);
    const body    = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if (!header || !body) return;
    header.addEventListener('click', () => {
        const open = body.classList.toggle('open');
        if (chevron) chevron.classList.toggle('open', open);
    });
}

// ── Cultural calendar card ────────────────────────────────────────────────────
function initCulturalCalendarCard() {
    const saved      = document.getElementById('religiousSaved');
    const disclaimer = document.getElementById('calendarDisclaimer');
    const activeTag  = document.getElementById('calendarActiveTag');
    const radios     = document.querySelectorAll('input[name="faithCalendar"]');
    if (!saved || !radios.length) return;

    const DISCLAIMERS = {
        islamic:    'Islamic dates follow the Umm al-Qura calendar (±1 day — actual dates depend on moon-sighting). Mawlid al-Nabi is observed by most UK Muslim communities but not all denominations.',
        hindu:      'Hindu dates follow the Hindu lunar calendar (±1 day — may vary by region).',
        chinese:    'Chinese lunisolar dates follow the Chinese lunisolar calendar (±1 day). Qingming follows the solar calendar and always falls on 4–5 April.',
        jamaican:   'Jamaican public holidays. Ash Wednesday and National Heroes Day are moveable; all other dates are fixed each year.',
        congolese:  'Congolese national public holidays (DRC). All four dates are fixed each year.',
        portuguese: 'Portuguese national public holidays not already covered by the UK calendar. Labour Day is fixed on 1 May. Carnival Tuesday is widely observed but discretionary.',
    };

    function updateActiveTag(value) {
        if (!activeTag) return;
        if (value && value !== 'none') {
            activeTag.textContent  = (CALENDAR_NAMES[value] || value) + ' active';
            activeTag.style.display = '';
        } else {
            activeTag.style.display = 'none';
        }
    }

    function updateDisclaimer(value) {
        const text = DISCLAIMERS[value] || '';
        disclaimer.textContent  = text;
        disclaimer.style.display = text ? '' : 'none';
    }

    async function loadSetting() {
        const local = lsGet(`faithCalendar_${currentUser}`) || 'none';
        radios.forEach(r => { r.checked = (r.value === local); });
        updateDisclaimer(local);
        updateActiveTag(local);
        try {
            const snap = await getDoc(doc(db, 'memberSettings', currentUser));
            if (snap.exists()) {
                const value = resolveFaithCalendar(snap.data());
                lsSet(`faithCalendar_${currentUser}`, value);
                radios.forEach(r => { r.checked = (r.value === value); });
                updateDisclaimer(value);
                updateActiveTag(value);
            }
        } catch (e) {
            console.warn('[Firestore] memberSettings load failed:', e);
        }
    }

    let saveTimer;
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            updateDisclaimer(radio.value);
            updateActiveTag(radio.value);
            clearTimeout(saveTimer);
            saved.classList.remove('visible', 'error');
            lsSet(`faithCalendar_${currentUser}`, radio.value);
            saved.textContent = '✓ Saved';
            saved.classList.add('visible');
            saveTimer = setTimeout(() => saved.classList.remove('visible'), 2500);
            setDoc(doc(db, 'memberSettings', currentUser), { memberName: currentUser, faithCalendar: radio.value }, { merge: true })
                .catch(e => {
                    console.warn('[Firestore] memberSettings sync failed:', e);
                    clearTimeout(saveTimer);
                    saved.textContent = '✓ Saved — other devices will update when you\'re back online';
                    saveTimer = setTimeout(() => saved.classList.remove('visible'), 4000);
                });
        });
    });

    loadSetting();
}

// ── Tips lightbox ─────────────────────────────────────────────────────────────
function initTipsLightbox() {
    const lb       = document.getElementById('tipsLightbox');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb || !closeBtn) return;

    const CARD_TIPS = {
        'notifications': {
            title: 'Notifications',
            sections: [
                { heading: 'What you\'ll get', items: [
                    { icon: '📋', html: '<strong>Daily Huddle</strong> — an alert when today\'s Huddle briefing has been uploaded' },
                    { icon: '💷', html: '<strong>Pay reminder</strong> — an alert on the cutoff Saturday, reminding you that payday is 6 days away' },
                ]},
                { heading: 'How it works', items: [
                    { icon: '📲', html: 'Tap <strong>Enable notifications</strong> and allow when your phone asks — that\'s it' },
                    { icon: '🔕', html: 'Tap <strong>Disable notifications</strong> to stop them at any time' },
                ]},
                { heading: 'iPhone users', items: [
                    { icon: '🍎', html: 'Notifications only work on iPhone if the app has been <strong>added to your Home Screen</strong> (tap Share → Add to Home Screen in Safari)' },
                ]},
            ],
        },
        'cultural-calendar': {
            title: 'Cultural calendar',
            sections: [
                { items: [
                    { icon: '🌍', html: 'Shows key dates for the chosen tradition in the corner of matching days' },
                    { icon: '👁️', html: 'Visible to anyone who views your roster' },
                    { icon: 'ℹ️', html: 'Only one calendar can be active per person at a time' },
                ]},
            ],
        },
    };

    function openTips(key) {
        const tips = CARD_TIPS[key];
        if (!tips || !titleEl || !bodyEl) return;
        lb.setAttribute('aria-label', tips.title);
        titleEl.textContent = tips.title;
        let html = '';
        for (const section of tips.sections) {
            if (section.heading) html += `<div class="tips-lb-section">${section.heading}</div>`;
            for (const { icon, html: content } of section.items) {
                html += `<div class="tips-lb-item"><span class="tips-lb-icon">${icon}</span><span>${content}</span></div>`;
            }
        }
        bodyEl.innerHTML = html;
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(closeTips);
        document.addEventListener('keydown', onKey);
    }

    function closeTips() {
        _clearOverlayHistory();
        lb.classList.remove('open');
        lb.addEventListener('transitionend', () => {
            lb.classList.remove('visible');
            unlockBodyScroll();
        }, { once: true });
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) { if (e.key === 'Escape') closeTips(); }

    closeBtn.addEventListener('click', closeTips);
    lb.addEventListener('click', e => { if (e.target === lb) closeTips(); });
    document.querySelectorAll('.btn-card-tips').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openTips(btn.dataset.card);
        });
    });
}

// ── Icon lightbox ─────────────────────────────────────────────────────────────
function initIconLightbox() {
    const lb       = document.getElementById('iconLightbox');
    const closeBtn = document.getElementById('iconLightboxClose');
    const iconBtn  = document.getElementById('appIcon');
    if (!lb || !iconBtn) return;

    const versionEl = document.getElementById('lightboxVersion');
    if (versionEl) versionEl.textContent = APP_VERSION;

    const statusEl = document.getElementById('lightboxUpdateStatus');
    const bugLink = document.getElementById('bugReportLink');
    if (bugLink) {
        bugLink.href = `mailto:gdmiller1979@gmail.com?subject=MYB Roster bug report (v${APP_VERSION})&body=Page: Settings%0ADevice: ${encodeURIComponent(navigator.userAgent)}%0A%0ADescribe the issue:%0A`;
    }

    function openLightbox() {
        if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; }
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(closeLightbox);
    }
    function closeLightbox() {
        lb.classList.remove('open');
        _clearOverlayHistory();
        const t = setTimeout(done, 300);
        function done() { clearTimeout(t); lb.classList.remove('visible'); unlockBodyScroll(); }
        lb.addEventListener('transitionend', done, { once: true });
    }

    // Header logo is a back-to-calendar button (About moved to the drawer logo).
    openAboutLightbox = openLightbox;
    iconBtn.title = 'Back to calendar';
    iconBtn.setAttribute('aria-label', 'Back to calendar');
    iconBtn.addEventListener('click', () => { window.location.href = './index.html'; });
    closeBtn.addEventListener('click', closeLightbox);
    lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

    // Coming soon lightbox (nav panel)
    const csLb    = document.getElementById('navComingSoonLightbox');
    const csClose = document.getElementById('navComingSoonClose');
    if (csLb && csClose) {
        csClose.addEventListener('click', () => { csLb.classList.remove('open'); unlockBodyScroll(); });
        csLb.addEventListener('click',    e => { if (e.target === csLb) { csLb.classList.remove('open'); unlockBodyScroll(); } });
    }
}

// ── Service worker ────────────────────────────────────────────────────────────
function registerSW() {
    if (!('serviceWorker' in navigator)) return;
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
