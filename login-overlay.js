// @ts-check
/**
 * login-overlay.js — the single shared in-place sign-in overlay for every protected page
 * (admin, settings, operations, links, paycalc).
 *
 * WHY THIS EXISTS: each page used to either carry its own copy of the login overlay + wiring
 * (admin, settings — duplicated logic) or redirect to admin to sign in (operations, links,
 * paycalc — inconsistent: you signed in somewhere else and bounced back). This module unifies
 * both: any page calls initLoginOverlay({...}) and gets an identical, in-place login. No page
 * redirects elsewhere to authenticate.
 *
 * It injects its own markup (like nav-panel.js), so a consuming page needs NO login HTML.
 *
 * Owns: the overlay UI, grade/name dropdowns, the local surname-password check, the client-side
 *   rate-limit, and the Firebase named-session establishment (B1: ensureNamedSession + the
 *   enforce-failure messaging).
 * Does NOT own: what happens AFTER a confirmed sign-in — the caller passes onSuccess (typically a
 *   reload, or admin's inline email-check-then-reload).
 */

import { CONFIG, getMembersForGrade } from './roster-data.js';
import { getSurname, saveSession, clearSession, ensureNamedSession, isTransientAuthError, getFirebaseAuthError } from './session.js';
import { lsGet, lsSet } from './ls.js';
import { lockBodyScroll, trapFocus } from './overlay.js';

// Full grade order — Management last. The login lists every grade; per-page ACCESS control
// (admin-only Operations, designer-only Links) is enforced by the caller after sign-in, not here.
const GRADE_ORDER = ['CEA', 'CES', 'Dispatcher', 'Management'];
const GRADE_KEY   = 'myb_login_grade';

/** Resolve `promise`, or reject after `ms`, so a hung async step can't strand the login overlay.
 *  Clears the timer on either outcome. (The underlying promise keeps running — that is fine; a late
 *  success is simply ignored and benefits the next attempt.)
 *  @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<T>} */
function withTimeout(promise, ms) {
    /** @type {any} */ let timer;
    return /** @type {Promise<T>} */ (Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); }),
    ]).finally(() => clearTimeout(timer)));
}

/** Build the overlay markup. `pageLabel` sets the subtitle, e.g. "Admin" → "Admin · Sign in". */
function overlayHtml(/** @type {string} */ pageLabel) {
    return `
    <div id="loginCard">
        <img src="icon-192.png" alt="MYB Roster">
        <div class="login-app-name">Marylebone Roster</div>
        <div class="login-subtitle">${pageLabel} · Sign in</div>
        <div class="login-field">
            <label for="loginGrade">Grade</label>
            <select id="loginGrade"><option value="">— Select grade —</option></select>
        </div>
        <div class="login-field">
            <label for="loginName">Your name</label>
            <select id="loginName" disabled><option value="">— Select grade first —</option></select>
        </div>
        <div class="login-field">
            <label for="loginPassword">Password</label>
            <input type="password" id="loginPassword" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
        </div>
        <div id="loginError" class="login-error" aria-live="polite"></div>
        <button type="button" id="loginSubmit">Sign in →</button>
        <a href="index.html" class="login-back">← Back to roster</a>
    </div>`;
}

/**
 * Mount and show the shared login overlay. Call only when the user is NOT signed in.
 *
 * @param {object} opts
 * @param {string} opts.pageLabel  Subtitle prefix, e.g. 'Admin', 'Settings', 'Operations'.
 * @param {(name: string) => (void | Promise<void>)} opts.onSuccess  Runs after a CONFIRMED named
 *   sign-in (surname matched AND, when B1 is on, the member's own Firebase session is active).
 *   Typically `() => window.location.reload()`; admin passes an inline email-check + reload.
 * @returns {void}
 */
export function initLoginOverlay({ pageLabel, onSuccess }) {
    // Inject the overlay (idempotent — never double-mount).
    if (document.getElementById('loginOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'loginOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `Sign in to ${pageLabel}`);
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = overlayHtml(pageLabel);
    document.body.appendChild(overlay);

    const gradeSelect   = /** @type {HTMLSelectElement} */ (overlay.querySelector('#loginGrade'));
    const nameSelect    = /** @type {HTMLSelectElement} */ (overlay.querySelector('#loginName'));
    const passwordInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#loginPassword'));
    const submitBtn     = /** @type {HTMLButtonElement} */ (overlay.querySelector('#loginSubmit'));
    const errorEl       = /** @type {HTMLElement} */ (overlay.querySelector('#loginError'));

    overlay.classList.add('visible');
    lockBodyScroll();

    overlay.addEventListener('keydown', e => {
        // Ignore Escape while a sign-in is in progress — navigating mid-submit would leave the
        // user neither signed in nor on the calendar.
        if (e.key === 'Escape') { if (!submitBtn.disabled) window.location.href = './index.html'; return; }
        trapFocus(overlay, e);
    });

    /** @param {string} grade */
    function populateNames(grade) {
        nameSelect.innerHTML = '';
        if (!grade) {
            nameSelect.appendChild(new Option('— Select grade first —', ''));
            nameSelect.disabled = true;
            return;
        }
        nameSelect.appendChild(new Option('— Select your name —', ''));
        getMembersForGrade(grade).forEach(m => nameSelect.appendChild(new Option(/** @type {any} */ (m).name, /** @type {any} */ (m).name)));
        nameSelect.disabled = false;
    }

    GRADE_ORDER.forEach(g => gradeSelect.appendChild(new Option(g, g)));

    // Restore last-used grade so returning users go straight to name → password.
    const savedGrade = lsGet(GRADE_KEY);
    if (savedGrade && GRADE_ORDER.includes(savedGrade)) {
        gradeSelect.value = savedGrade;
        populateNames(savedGrade);
    } else {
        populateNames('');
    }

    gradeSelect.addEventListener('change', () => {
        errorEl.classList.remove('visible');
        passwordInput.value = '';
        nameSelect.value = '';
        populateNames(gradeSelect.value);
        if (gradeSelect.value) nameSelect.focus();
    });

    nameSelect.addEventListener('change', () => {
        errorEl.classList.remove('visible');
        passwordInput.value = '';
        if (nameSelect.value) passwordInput.focus();
    });

    let _failCount   = 0;
    let _lockedUntil = 0;
    let _attempting  = false;
    // This client-side lockout is a UX measure only — it resets on page reload. Real rate
    // limiting is enforced server-side by Firebase Auth.

    /** @param {string} msg */
    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.add('visible');
    }

    async function attempt() {
        if (_attempting || Date.now() < _lockedUntil) return;
        _attempting = true;
        try {
            const name = nameSelect.value;
            // Strip non-alpha and lowercase to match normaliseSurname() in firebase-client.js.
            const pw   = passwordInput.value.toLowerCase().replace(/[^a-z]/g, '');
            errorEl.classList.remove('visible');

            if (!gradeSelect.value) { showError('Please select your grade.'); gradeSelect.focus(); return; }
            if (!name)              { showError('Please select your name.'); return; }

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
                }
                showError('Incorrect password. Please try again.');
                passwordInput.value = '';
                passwordInput.focus();
                return;
            }

            lsSet(GRADE_KEY, gradeSelect.value);
            // Visible in-progress state — establishing the Firebase session is a network round trip,
            // so the button must not look idle (and silently swallow taps) while we wait.
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing in…';

            // Establish the member's Firebase Auth session so Firestore rules accept their writes.
            // TIME-BOXED (8s): a slow/hung Firebase Auth step (token restore, sign-in, anonymous
            // fallback) must never strand the user on the overlay. And — the load-bearing part — we
            // do NOT save the local session until auth resolves. Saving it first (the old order at
            // v14.74-) created a "half signed-in" state the rest of the app honoured even though the
            // overlay never finished: a slow auth left the user able to navigate away as a phantom
            // signed-in user, and Admin then ran its email check off that stray session. Now nothing
            // is written until sign-in genuinely completes.
            let named = false, authResolved = true;
            try {
                named = await withTimeout(ensureNamedSession(name), 8000);
            } catch {
                authResolved = false;   // timed out (or threw) → treat as not signed in
            }

            if (!authResolved || (CONFIG.ENFORCE_NAMED_SESSION && !named)) {
                // Surname matched locally but sign-in didn't complete (timeout, or — when enforcing
                // — the member's OWN Firebase session couldn't be established; usually an
                // unprovisioned account, since browser account creation is disabled). Leave NO local
                // session behind, restore the button, and explain. Re-entering works once the cause
                // clears; persistent enforce-failures route to admin break-glass.
                clearSession();
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in →';
                showError(!authResolved
                    ? 'Couldn’t complete sign-in — check your connection and try again.'
                    : isTransientAuthError(getFirebaseAuthError())
                        ? 'Couldn’t reach sign-in — check your connection and try again.'
                        : 'Couldn’t complete sign-in. Ask your manager to set up your account.');
                return;
            }

            // Auth resolved (named — or, flag off, an acceptable anonymous fallback). ONLY NOW commit
            // the local session and hand off to the caller (which reloads / navigates).
            saveSession(name);
            await onSuccess(name);
            // onSuccess reloads/navigates; the resets below are harmless (the page is leaving).
        } finally {
            // Don't reset during the 30s lockout (submit is disabled) so a queued click can't slip
            // through; otherwise allow the next attempt. The click handler also resets as a backstop.
            if (!submitBtn.disabled) _attempting = false;
        }
    }

    submitBtn.addEventListener('click', () => { attempt().finally(() => { _attempting = false; }); });
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt().finally(() => { _attempting = false; }); });
}
