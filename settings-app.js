// @ts-check
/**
 * settings-app.js — Coordinator for settings.html.
 *
 * Owns: login/session check, push notifications card.
 * Session is shared with admin-app.js via the same AUTH_KEY in localStorage —
 * a user already signed in on admin.html will arrive here without seeing the login overlay.
 */

import { CONFIG, isValidEmail, isChilternWorkEmail } from './roster-data.js';
import { getStaffContact, saveStaffContact, deleteStaffContact } from './firebase-client.js';
import { initNavPanel } from './nav-panel.js';
import { initHuddleNotifications } from './huddle.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { ensureNamedSession, getSession, clearSession, sessionReady, resolveSession } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';

// ── Check session ─────────────────────────────────────────────────────────────
// `let` (not const): on the in-place sign-in path (CONFIG.INPLACE_LOGIN.settings, ARCHITECTURE_PLAN.md Phase 9)
// these are refreshed inside initAuthorised() from the just-saved session — the module loaded while
// signed out, so the load-time values are null. With the flag off they are assigned once and never
// change, identical to before.
let currentSession   = getSession();
let isAuthenticated  = !!currentSession;
let currentUser      = currentSession?.name ?? null;

// Assigned by initIconLightbox (runs inside initApp when signed in); the closure
// below only reads it when the drawer logo is tapped.
/** @type {any} */
let openAboutLightbox = null;

// Nav panel. Always initialised — even when not signed in — so the user can navigate to Calendar or
// Admin rather than being stranded. onSignOut is null when not authenticated, which hides the footer.
function wireNavPanel() {
    initNavPanel({
        currentPage: 'settings',
        memberName:  currentUser,
        isAdmin:         currentUser ? CONFIG.ADMIN_NAMES.includes(currentUser) : false,
        isLinksDesigner: currentUser ? CONFIG.LINKS_DESIGNERS.includes(currentUser) : false,
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   currentUser ? () => { clearSession(); window.location.href = './index.html'; } : null,
    });
}

// Page-access via the Phase-3 policy (auth-policy.js → ARCHITECTURE_PLAN.md Phase 7). Settings'
// policy is "any named user" (role null) — no 'forbidden' path. The snapshot maps the LOCAL
// session-existence flag (isAuthenticated = !!currentSession) to an optimistic 'named' status —
// preserving the exact prior trigger — so requirePage returns 'login' iff there is no local session
// (decision identical to the old `if (!isAuthenticated)`). member is irrelevant: Settings needs no role.
const _access = requirePage({ status: isAuthenticated ? 'named' : 'signedOut', member: currentUser }, 'settings');
// Wire the nav now EXCEPT on the in-place login path, where it is deferred to initAuthorised() so it
// renders ONCE with the signed-in identity (the full-screen overlay covers the burger meanwhile).
// Flag off → wired now exactly as before.
if (!CONFIG.INPLACE_LOGIN.settings || _access.decision !== 'login') wireNavPanel();

if (_access.decision === 'login') {
    // On success: flag off (default) → reload + resolveSession(false) on this non-auth load (today's
    // path); flag on → initialise in place via initAuthorised(), falling back to a reload if it throws
    // mid-wiring (never less robust than reload). Don't resolveSession(false) when in-place, or the
    // one-shot sessionReady is poisoned before initAuthorised can resolve it true.
    const onSuccess = CONFIG.INPLACE_LOGIN.settings
        ? () => { try { initAuthorised(); } catch { window.location.reload(); } }
        : () => window.location.reload();
    initLoginOverlay({ pageLabel: 'Settings', onSuccess });
    if (!CONFIG.INPLACE_LOGIN.settings) resolveSession(false); // fulfil sessionReady on the non-auth path
} else {
    initAuthorised();
}
registerServiceWorker();
sessionReady.then(() => { initErrorReporter(); recordUsage('settings', currentUser); recordPageLatency('settings', currentUser); });

/**
 * The authorised (signed-in) init body. Called directly on a normal already-signed-in load, or from
 * the login overlay's onSuccess on the in-place path. Runs exactly once per page life either way.
 */
function initAuthorised() {
    // Refresh identity — on the in-place path the module loaded signed-out, so re-read the just-saved
    // session (saveSession ran before onSuccess). Identical no-op re-read on a normal signed-in load.
    currentSession  = getSession();
    currentUser     = currentSession?.name ?? null;
    isAuthenticated = !!currentSession;
    // In-place: remove the still-mounted overlay to reveal the page. No-op on a normal load.
    dismissLoginOverlay();
    // Re-establish Firebase Auth in the background. A returning user skips the login handler, so
    // auth.currentUser may still be null for a moment and an immediate Firestore write would fail the
    // request.auth rule. resolveSession() fulfils sessionReady so feature modules (initApp handlers)
    // can import sessionReady instead of reading window._mybSession.
    const _setAuth = ensureNamedSession(currentUser);
    resolveSession(_setAuth);
    // B1.2 enforcement, decided via the policy: once the named session resolves, the store (fed by the
    // Phase-2 bridge inside ensureNamedSession) reflects the terminal Firebase identity, so
    // `requirePage(getAuthSnapshot(), 'settings')` returns 'login' exactly when this member's OWN named
    // session could not be confirmed. Flag OFF → resolves to 'allow', so this never fires (unchanged).
    _setAuth.then(() => {
        if (CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'settings').decision === 'login') { clearSession(); initLoginOverlay({ pageLabel: 'Settings', onSuccess: () => window.location.reload() }); }
    });
    initApp();
    wireNavPanel();   // deduped by initNavPanel's navPanelInit guard if the nav was already wired above
}

// ── Main app init (runs when authenticated) ───────────────────────────────────
function initApp() {
    // notif card collapse is wired by initHuddleNotifications() below.

    // Work Email card
    initContactCard();

    // Notifications card
    initHuddleNotifications();

    // Icon lightbox
    initIconLightbox();
}

// ── Work Email card ───────────────────────────────────────────────────────────
function initContactCard() {
    const emailInput = /** @type {HTMLInputElement} */ (document.getElementById('workEmailInput'));
    const saveBtn    = /** @type {HTMLButtonElement} */ (document.getElementById('workEmailSaveBtn'));
    const removeBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('workEmailRemoveBtn'));
    const feedback   = /** @type {HTMLElement} */ (document.getElementById('contactFeedback'));
    if (!emailInput || !saveBtn) return;

    initCardCollapse('contactToggleHeader', 'contactBody', 'contactChevron');

    // Guard against a slow Firestore load overwriting text the user has already typed.
    // Listen to both 'input' and 'change' — some browsers (Chrome on Android) fire
    // 'change' but not 'input' when autofilling a field.
    let userHasTyped = false;
    const markUserTyped = () => { userHasTyped = true; };
    emailInput.addEventListener('input',  markUserTyped);
    emailInput.addEventListener('change', markUserTyped);
    emailInput.addEventListener('blur', () => {
        const v = emailInput.value.trim();
        if (v && !v.includes('@')) emailInput.value = v + '@' + CONFIG.WORK_EMAIL_DOMAIN;
    });

    function setFeedback(/** @type {any} */ msg, /** @type {any} */ state) {
        feedback.textContent = msg;
        feedback.className   = `contact-feedback${state ? ' ' + state : ''}`;
    }

    function formatDate(/** @type {any} */ ts) {
        try {
            const d = ts?.toDate?.();
            if (!d || isNaN(d.getTime())) return null;
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return null; }
    }

    function showSavedState(/** @type {any} */ dateStr) {
        setFeedback(dateStr ? `✓ Saved — last updated ${dateStr}` : '✓ Saved', 'ok');
        if (removeBtn) removeBtn.style.display = '';
    }

    function clearSavedState() {
        setFeedback('', '');
        if (removeBtn) removeBtn.style.display = 'none';
    }

    // Load existing email; show a loading message while waiting.
    setFeedback('Checking for a saved email…', '');
    sessionReady.then(() => getStaffContact(currentUser)).then(data => {
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
        const raw = emailInput.value.trim();
        if (raw && !raw.includes('@')) emailInput.value = raw + '@' + CONFIG.WORK_EMAIL_DOMAIN;
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
        if (!isChilternWorkEmail(email)) {
            setFeedback(`Please use your Chiltern work email (ending @${CONFIG.WORK_EMAIL_DOMAIN}).`, 'err');
            emailInput.focus();
            return;
        }

        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        try {
            await sessionReady;
            await saveStaffContact(currentUser, email);
            const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            showSavedState(today);
        } catch (err) {
            console.warn('[staffContact] Save failed:', err);
            setFeedback(
                (/** @type {any} */ (err))?.code === 'permission-denied'
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
                await sessionReady;
                await deleteStaffContact(currentUser);
                emailInput.value = '';
                clearSavedState();
            } catch (err) {
                console.warn('[staffContact] Remove failed:', err);
                setFeedback(
                    (/** @type {any} */ (err))?.code === 'permission-denied'
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
