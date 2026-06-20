/**
 * settings-app.js — Coordinator for settings.html.
 *
 * Owns: login/session check, push notifications card, cultural calendar card.
 * Session is shared with admin-app.js via the same AUTH_KEY in localStorage —
 * a user already signed in on admin.html will arrive here without seeing the login overlay.
 */

import { CONFIG, CALENDAR_NAMES, resolveFaithCalendar, getMembersForGrade } from './roster-data.js';
import { db, doc, getDoc, setDoc, getStaffContact, saveStaffContact, deleteStaffContact } from './firebase-client.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { initNavPanel } from './nav-panel.js';
import { initHuddleNotifications } from './huddle.js';
import { getSurname, ensureFirebaseSession, getSession, saveSession, clearSession } from './session.js';
import { lockBodyScroll, unlockBodyScroll, initCardCollapse, trapFocus } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';

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
    isAdmin:         currentUser ? CONFIG.ADMIN_NAMES.includes(currentUser) : false,
    isLinksDesigner: currentUser ? CONFIG.LINKS_DESIGNERS.includes(currentUser) : false,
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   currentUser ? () => { clearSession(); window.location.href = './index.html'; } : null,
});

if (isAuthenticated) {
    // Re-establish Firebase Auth in the background. Stored as a Promise (matching
    // operations-app.js) so the cultural-calendar Firestore write can await it —
    // a returning user skips the login handler, so auth.currentUser may still be
    // null for a moment and an immediate setDoc would fail the request.auth rule.
    window._mybSession = ensureFirebaseSession(currentUser);
    initApp();
} else {
    initLoginOverlay();
}
registerServiceWorker();

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

    overlay.addEventListener('keydown', e => {
        // Ignore Escape while a sign-in is in progress — navigating mid-submit
        // would leave the user neither signed in nor on the calendar.
        if (e.key === 'Escape') { if (!submitBtn.disabled) window.location.href = './index.html'; return; }
        trapFocus(overlay, e);
    });

    const GRADE_ORDER = ['CEA', 'CES', 'Dispatcher'];
    const GRADE_KEY   = 'myb_login_grade';

    GRADE_ORDER.forEach(g => gradeSelect.appendChild(new Option(g, g)));

    const savedGrade = lsGet(GRADE_KEY);
    if (savedGrade) { gradeSelect.value = savedGrade; populateNames(savedGrade); }

    function populateNames(grade) {
        const members = getMembersForGrade(grade);
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

    // Client-side lockout after repeated wrong passwords — a UX speed bump only
    // (resets on reload); real rate limiting is enforced server-side by Firebase
    // Auth. Mirrors the Admin login so both sign-in screens behave the same.
    let _failCount = 0;
    let _lockedUntil = 0;

    async function attemptLogin() {
        if (Date.now() < _lockedUntil) return;
        const name = nameSelect.value;
        const pw   = passwordInput.value.trim().toLowerCase().replace(/[^a-z]/g, '');
        if (!name) { showError('Please select your name.'); return; }
        if (!pw)   { showError('Please enter your password.'); return; }
        if (pw !== getSurname(name)) {
            _failCount++;
            if (_failCount >= 3) {
                _lockedUntil = Date.now() + 30_000;
                submitBtn.disabled = true;
                submitBtn.textContent = 'Try again in 30s';
                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign in →';
                    _failCount = 0;
                    _lockedUntil = 0;
                }, 30_000);
                errorEl.textContent = 'Too many attempts. Try again in 30 seconds.';
                errorEl.classList.add('visible');
                return;
            }
            showError('Incorrect password. Your password is your surname (lowercase).');
            return;
        }

        submitBtn.disabled  = true;
        submitBtn.textContent = 'Signing in…';
        errorEl.classList.remove('visible');

        const authOk = await ensureFirebaseSession(name);
        if (!authOk) console.warn('[Auth] Firebase session not established — Firestore writes may fail');
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
    // notif card collapse is wired by initHuddleNotifications() below.
    // Religious card collapse is wired inside initCulturalCalendarCard() so it can
    // reference updateActiveTag, which needs the collapse state for its logic.

    // Work Email card
    initContactCard();

    // Notifications card
    initHuddleNotifications();

    // Cultural calendar card
    initCulturalCalendarCard();

    // Icon lightbox
    initIconLightbox();
}

// ── Work Email card ───────────────────────────────────────────────────────────
function initContactCard() {
    const emailInput = document.getElementById('workEmailInput');
    const saveBtn    = document.getElementById('workEmailSaveBtn');
    const removeBtn  = document.getElementById('workEmailRemoveBtn');
    const feedback   = document.getElementById('contactFeedback');
    if (!emailInput || !saveBtn) return;

    initCardCollapse('contactToggleHeader', 'contactBody', 'contactChevron');

    // Guard against a slow Firestore load overwriting text the user has already typed.
    // Listen to both 'input' and 'change' — some browsers (Chrome on Android) fire
    // 'change' but not 'input' when autofilling a field.
    let userHasTyped = false;
    const markUserTyped = () => { userHasTyped = true; };
    emailInput.addEventListener('input',  markUserTyped);
    emailInput.addEventListener('change', markUserTyped);

    function isValidEmail(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    }

    function setFeedback(msg, state) {
        feedback.textContent = msg;
        feedback.className   = `contact-feedback${state ? ' ' + state : ''}`;
    }

    function formatDate(ts) {
        try {
            const d = ts?.toDate?.();
            if (!d || isNaN(d.getTime())) return null;
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return null; }
    }

    function showSavedState(dateStr) {
        setFeedback(dateStr ? `✓ Saved — last updated ${dateStr}` : '✓ Saved', 'ok');
        if (removeBtn) removeBtn.style.display = '';
    }

    function clearSavedState() {
        setFeedback('', '');
        if (removeBtn) removeBtn.style.display = 'none';
    }

    // Load existing email; show a loading message while waiting.
    setFeedback('Checking for a saved email…', '');
    getStaffContact(currentUser).then(data => {
        if (data?.workEmail && !userHasTyped) {
            emailInput.value = data.workEmail;
            showSavedState(formatDate(data.updatedAt));
        } else if (data?.workEmail && userHasTyped) {
            // User started typing before the load finished — keep their input,
            // just clear the loading message.
            setFeedback('', '');
        } else {
            clearSavedState();
        }
    }).catch(err => {
        console.warn('[staffContact] Load failed:', err);
        setFeedback('Couldn\'t check your saved email — check your connection.', 'err');
    });

    emailInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });

    saveBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        setFeedback('', '');

        if (!email) {
            setFeedback('Please enter your work email address.', 'err');
            emailInput.focus();
            return;
        }
        if (!isValidEmail(email)) {
            setFeedback('That doesn\'t look like a valid email address.', 'err');
            emailInput.focus();
            return;
        }

        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        try {
            if (window._mybSession) await window._mybSession;
            await saveStaffContact(currentUser, email);
            const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            showSavedState(today);
        } catch (err) {
            console.warn('[staffContact] Save failed:', err);
            setFeedback(
                err?.code === 'permission-denied'
                    ? 'Couldn\'t save — please sign out and sign back in.'
                    : 'Couldn\'t save — check your connection and try again.',
                'err'
            );
        } finally {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save email';
        }
    });

    if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
            if (!confirm('Remove your saved work email address?')) return;
            removeBtn.disabled = true;
            try {
                if (window._mybSession) await window._mybSession;
                await deleteStaffContact(currentUser);
                emailInput.value = '';
                clearSavedState();
            } catch (err) {
                console.warn('[staffContact] Remove failed:', err);
                setFeedback(
                    err?.code === 'permission-denied'
                        ? 'Couldn\'t remove — please sign out and sign back in.'
                        : 'Couldn\'t remove — check your connection and try again.',
                    'err'
                );
            } finally {
                removeBtn.disabled = false;
            }
        });
    }
}

// ── Cultural calendar card ────────────────────────────────────────────────────
function initCulturalCalendarCard() {
    const saved      = document.getElementById('religiousSaved');
    const disclaimer = document.getElementById('calendarDisclaimer');
    const activeTag  = document.getElementById('calendarActiveTag');
    const radios     = document.querySelectorAll('input[name="faithCalendar"]');
    if (!saved || !radios.length) return;

    function updateActiveTag(value) {
        if (!activeTag) return;
        const bodyOpen = document.getElementById('religiousBody')?.classList.contains('open') ?? false;
        if (!bodyOpen && value && value !== 'none') {
            activeTag.textContent   = (CALENDAR_NAMES[value] || value) + ' active';
            activeTag.style.display = '';
        } else {
            activeTag.style.display = 'none';
        }
    }

    function updateDisclaimer(value) {
        const radio = document.querySelector(`input[name="faithCalendar"][value="${value}"]`);
        const text  = radio?.dataset.disclaimer || '';
        disclaimer.textContent = text;
        disclaimer.classList.toggle('visible', !!text);
    }

    // Wire card collapse here (not in initApp) so onToggle can reference updateActiveTag.
    initCardCollapse('religiousToggleHeader', 'religiousBody', 'religiousChevron', () => {
        const checked = document.querySelector('input[name="faithCalendar"]:checked');
        updateActiveTag(checked?.value || 'none');
    });

    async function loadSetting() {
        const local = lsGet(`faithCalendar_${currentUser}`) || 'none';
        radios.forEach(r => { r.checked = (r.value === local); });
        updateDisclaimer(local);
        updateActiveTag(local);

        // Guard against a user changing a radio while Firestore is loading —
        // once the user interacts, their choice takes priority over the snapshot.
        let userInteracted = false;
        const markInteracted = () => { userInteracted = true; };
        radios.forEach(r => r.addEventListener('change', markInteracted, { once: true }));

        try {
            const snap = await getDoc(doc(db, 'memberSettings', currentUser));
            if (!userInteracted && snap.exists()) {
                const value = resolveFaithCalendar(snap.data());
                lsSet(`faithCalendar_${currentUser}`, value);
                radios.forEach(r => { r.checked = (r.value === value); });
                updateDisclaimer(value);
                updateActiveTag(value);
            }
        } catch (e) {
            console.warn('[Firestore] memberSettings load failed:', e);
        } finally {
            radios.forEach(r => r.removeEventListener('change', markInteracted));
        }
    }

    let saveTimer;
    radios.forEach(radio => {
        radio.addEventListener('change', async () => {
            updateDisclaimer(radio.value);
            updateActiveTag(radio.value);
            clearTimeout(saveTimer);
            saved.classList.remove('visible', 'error');
            lsSet(`faithCalendar_${currentUser}`, radio.value);
            saved.textContent = '✓ Saved';
            saved.classList.add('visible');
            saveTimer = setTimeout(() => saved.classList.remove('visible'), 2500);
            try {
                // Wait for Firebase Auth restoration before the write — otherwise an
                // immediate change after a cold open can fail the request.auth rule.
                if (window._mybSession) await window._mybSession;
                await setDoc(doc(db, 'memberSettings', currentUser), { memberName: currentUser, faithCalendar: radio.value }, { merge: true });
            } catch (e) {
                console.warn('[Firestore] memberSettings sync failed:', e);
                clearTimeout(saveTimer);
                saved.textContent = 'Saved locally — sync to other devices failed';
                saved.classList.add('error');
                saveTimer = setTimeout(() => saved.classList.remove('visible', 'error'), 4000);
            }
        });
    });

    loadSetting();
}

// ── Tips lightbox ─────────────────────────────────────────────────────────────
// Wired unconditionally at module scope (same pattern as admin-app.js and
// operations-app.js) so the ? buttons always get stopPropagation regardless of
// auth state. Previously lived inside initApp() — if initApp() wasn't called
// (stale session, auth race) the ? buttons had no handler and the click bubbled
// up to the card header, toggling the card instead of opening the lightbox.
const CARD_TIPS = {
        'work-email': {
            title: 'Work Email',
            sections: [
                { items: [
                    { icon: '🔑', html: 'Groundwork for self-service password reset — for now it just saves the email we\'ll use for that later. <strong>To reset a password today, contact the admin.</strong>' },
                    { icon: '🔒', html: 'Only you and the admin can see this email' },
                    { icon: '✉️', html: 'Use your Chiltern work email — the one the company already sends things to' },
                ]},
            ],
        },
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
initTipsLightbox(CARD_TIPS);

// ── Icon lightbox ─────────────────────────────────────────────────────────────
// About panel (version, update status, bug link) is the shared about-lightbox.js.
function initIconLightbox() {
    const about = initAboutLightbox({
        appLabel: 'MYB Roster Settings',
        getUserName: () => currentUser,
    });
    if (about) openAboutLightbox = about.open;

    // Header logo is a back-to-calendar button (About moved to the drawer logo).
    const iconBtn = document.getElementById('appIcon');
    if (iconBtn) {
        iconBtn.title = 'Back to calendar';
        iconBtn.setAttribute('aria-label', 'Back to calendar');
        iconBtn.addEventListener('click', () => { window.location.href = './index.html'; });
    }
    // The coming-soon lightbox is owned entirely by nav-panel.js (open/close, Escape,
    // Android Back, focus trap). Do not re-wire it here — a duplicate handler used to
    // live in this function and left the nav-panel state flags out of sync (v11.50).
}
