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
 * Owns: the overlay UI, grade/name dropdowns, passing the TYPED password to Firebase (the authority
 *   — no local surname pre-check since PASSWORD_PLAN.md §3.2), the client-side wrong-password
 *   lockout, and the Firebase named-session establishment (B1: ensureNamedSession + the
 *   enforce-failure messaging).
 * Does NOT own: what happens AFTER a confirmed sign-in — the caller passes onSuccess (typically a
 *   reload, or admin's inline email-check-then-reload).
 */

import { CONFIG, getMembersForGrade } from './roster-data.js';
import { saveSession, clearSession, ensureNamedSession, isTransientAuthError, getFirebaseAuthError, primeAuth } from './session.js';
import { lsGet, lsSet } from './ls.js';
import { lockBodyScroll, unlockBodyScroll, trapFocus } from './overlay.js';
import { markLoginStart, clearLoginStart } from './perf-reporter.js';

// Full grade order — Management last. The login lists every grade; per-page ACCESS control
// (admin-only Operations, designer-only Links) is enforced by the caller after sign-in, not here.
const GRADE_ORDER = CONFIG.GRADE_ORDER;   // single source (roster-data CONFIG) — shared with admin-app's selector
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

/**
 * The DOM-free core of a sign-in attempt (exported for tests). Establishes the member's named
 * Firebase session, time-boxed, and commits the LOCAL session ONLY if auth genuinely resolves — so
 * a slow/hung auth can never leave a "half signed-in" state (the v14.72–75 login-freeze class; see
 * LOGIN_INCIDENT.md). Pure of DOM: the caller passes the already-name-bound session helpers and the
 * enforce flag, and applies the button/error effects from the result.
 *
 * @param {object} deps
 * @param {boolean} deps.enforce                            CONFIG.ENFORCE_NAMED_SESSION
 * @param {() => Promise<boolean>} deps.ensureNamedSession  pre-bound to the member name
 * @param {() => boolean} deps.saveSession                  pre-bound to the member name; returns false if storage is blocked
 * @param {() => void} deps.clearSession
 * @param {() => (string|null|undefined)} deps.getAuthError
 * @param {(code: any) => boolean} deps.isTransient
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{ ok: boolean, error?: string, kind?: 'timeout'|'ratelimit'|'transient'|'credential'|'storage' }>}
 *   ok=true ⇒ local session saved; caller runs onSuccess. On failure, `kind` names the cause
 *   ('credential' = wrong password → the caller's lockout counts it; others must not).
 */
export async function runNamedSignIn({ enforce, ensureNamedSession, saveSession, clearSession, getAuthError, isTransient, timeoutMs = 8000 }) {
    let named = false, authResolved = true;
    try {
        named = await withTimeout(ensureNamedSession(), timeoutMs);
    } catch {
        authResolved = false;   // timed out (or threw) → treat as not signed in
    }
    if (!authResolved || (enforce && !named)) {
        clearSession();         // never leave a stale/legacy session behind a failed sign-in
        // `kind` lets the caller act on the CAUSE (only a genuine wrong-password drives the client
        // lockout; a network/rate-limit failure must not). Messages follow PASSWORD_PLAN.md §3.5 +
        // the house wording rule (an account matter → "the admin").
        if (!authResolved) return { ok: false, kind: 'timeout', error: 'Couldn’t complete sign-in — check your connection and try again.' };
        const code = getAuthError();
        if (code === 'auth/too-many-requests') return { ok: false, kind: 'ratelimit', error: 'Too many attempts — please wait a few minutes and try again.' };
        if (isTransient(code))                 return { ok: false, kind: 'transient', error: 'Couldn’t reach sign-in — check your connection and try again.' };
        // Definitive credential rejection — the typed password was wrong (or the account isn't set up).
        return { ok: false, kind: 'credential', error: 'Password incorrect — if you’ve forgotten it, ask the admin to reset it.' };
    }
    // Commit ONLY now that auth has genuinely resolved. If the write is swallowed (storage blocked —
    // iOS Private Browsing), fail cleanly: without the local session every page re-check returns null,
    // so an in-place re-init or reload would just loop back to this overlay. Sign back out (clearSession)
    // so we don't strand a signed-in Firebase identity with no app session, and tell the user why.
    if (!saveSession()) {
        clearSession();
        return { ok: false, kind: 'storage', error: 'This browser is blocking storage. Turn off Private Browsing, or open the installed app, then sign in again.' };
    }
    return { ok: true };
}

/**
 * Tear down the in-place login overlay (in-place sign-in / CONFIG.INPLACE_LOGIN — ARCHITECTURE_PLAN.md
 * Phase 9). A coordinator whose `onSuccess` initialises the page in place (rather than reloading) calls
 * this to remove the overlay and reveal the now-rendered page. Safe to call when no overlay is present
 * (a normal already-signed-in load) — it then does nothing, so coordinators can call it unconditionally
 * on their authorised path. Only unlocks body scroll when an overlay actually existed, so it never
 * disturbs scroll state on a page that never showed the overlay.
 * @returns {void}
 */
export function dismissLoginOverlay() {
    const el = document.getElementById('loginOverlay');
    if (!el) return;
    el.remove();
    unlockBodyScroll();
}

/** Build the overlay markup. `pageLabel` sets the subtitle, e.g. "Admin" → "Admin · Sign in". */
function overlayHtml(/** @type {string} */ pageLabel) {
    return `
    <div id="loginCard">
        <img src="icon-192.png" alt="Marylebone Roster">
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
            <div class="login-pw-wrap">
                <input type="password" id="loginPassword" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-describedby="loginPwHint">
                <button type="button" id="loginPwToggle" class="login-pw-toggle" aria-label="Show password" aria-pressed="false">Show</button>
            </div>
            <div id="loginPwHint" class="login-hint">Your surname in lowercase — or the password you’ve set yourself.</div>
        </div>
        <div id="loginError" class="login-error" aria-live="polite"></div>
        <button type="button" id="loginSubmit">Sign in →</button>
        <div id="loginStatus" class="login-status" aria-live="polite"></div>
        <a href="./" class="login-back">← Back to roster</a>
        <p class="login-help">Trouble signing in? Ask the admin.</p>
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
    const pwToggle      = /** @type {HTMLButtonElement} */ (overlay.querySelector('#loginPwToggle'));
    const submitBtn     = /** @type {HTMLButtonElement} */ (overlay.querySelector('#loginSubmit'));
    const errorEl       = /** @type {HTMLElement} */ (overlay.querySelector('#loginError'));
    const statusEl      = /** @type {HTMLElement} */ (overlay.querySelector('#loginStatus'));
    const backLink      = /** @type {HTMLAnchorElement} */ (overlay.querySelector('.login-back'));

    // Show/hide the password. It isn't a secret (the hint literally states the convention), and
    // typing it blind on a phone is the main cause of the 3-strikes 30s lockout — so a reveal
    // toggle removes lock-outs with no security cost. Starts masked, so the field still reads as a
    // normal password field.
    pwToggle?.addEventListener('click', () => {
        const revealing = passwordInput.type === 'password';
        passwordInput.type = revealing ? 'text' : 'password';
        pwToggle.textContent = revealing ? 'Hide' : 'Show';
        pwToggle.setAttribute('aria-pressed', revealing ? 'true' : 'false');
        pwToggle.setAttribute('aria-label', revealing ? 'Hide password' : 'Show password');
        passwordInput.focus();
    });

    overlay.classList.add('visible');
    lockBodyScroll();
    // Pre-warm Firebase Auth restoration now, while the user is still picking grade/name and typing
    // their password — so the sign-in click pays only for the network sign-in, not persistence setup
    // + IndexedDB restore on top. Best-effort and side-effect-free (see primeAuth in session.js).
    primeAuth();

    overlay.addEventListener('keydown', e => {
        // Ignore Escape while a sign-in is in progress — navigating mid-submit would leave the
        // user neither signed in nor on the calendar. Keyed on _signingIn, NOT submitBtn.disabled
        // (v16.23): the button is also disabled for the whole 30s password lockout, which made
        // Escape-to-calendar silently dead there — the back link already uses this exact narrower
        // guard for the same reason.
        if (e.key === 'Escape') { if (!_signingIn) window.location.href = './'; return; }
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
    const gradeRestored = !!(savedGrade && GRADE_ORDER.includes(savedGrade));
    if (gradeRestored) {
        gradeSelect.value = /** @type {string} */ (savedGrade);
        populateNames(/** @type {string} */ (savedGrade));
    } else {
        populateNames('');
    }

    // Move focus INTO the dialog, onto the first control the user still needs (grade, or name when
    // grade was restored). Without this, focus stays on <body> behind the opaque overlay: the first
    // Tab lands on the page controls hidden behind it, and — critically — the `trapFocus` keydown
    // handler below only engages once focus is already inside the overlay, so it was dead. Sighted
    // keyboard-only sign-in was effectively broken on all five protected pages (axe can't see focus
    // movement, so the a11y gate stayed green). v18.28.
    (gradeRestored ? nameSelect : gradeSelect).focus();

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
    let _signingIn   = false;   // true ONLY while Firebase auth is genuinely in flight (not lockout)
    // This client-side lockout is a UX measure only — it resets on page reload. Real rate
    // limiting is enforced server-side by Firebase Auth.

    /** @param {string} msg */
    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.add('visible');
    }

    // Staged "still working" reassurance under the button while auth is in flight. The button itself
    // stays "Signing in…"; this line escalates so a multi-second wait (app update / weak signal)
    // reads as progress, not a freeze. Cleared the moment the attempt settles. Kept calm and
    // non-technical (no "Firebase"/"token" jargon) per the owner's quiet-app principle.
    /** @type {ReturnType<typeof setTimeout>[]} */
    let _statusTimers = [];
    /** @param {string} msg */
    function setStatus(msg) { statusEl.textContent = msg; statusEl.classList.toggle('visible', !!msg); }
    function startStatusProgress() {
        setStatus('Checking your sign-in…');
        _statusTimers.push(setTimeout(() => setStatus('Still checking — almost there…'), 1500));
        _statusTimers.push(setTimeout(() => setStatus('Still working — this can happen after an app update or on weak signal.'), 4000));
    }
    function clearStatusProgress() { _statusTimers.forEach(clearTimeout); _statusTimers = []; setStatus(''); }

    async function attempt() {
        if (_attempting || Date.now() < _lockedUntil) return;
        _attempting = true;
        try {
            const name = nameSelect.value;
            // The RAW typed password — NOT normalised. A chosen password keeps its case/digits/
            // symbols; the surname fallback is applied (gated) inside ensureFirebaseSession via
            // credentialCandidatesFor. Firebase is now the authority — there is no local surname
            // pre-check (PASSWORD_PLAN.md §3.2). Whitespace-trim only for the empty-field guard.
            const typedPw = passwordInput.value;
            errorEl.classList.remove('visible');

            if (!gradeSelect.value)   { showError('Please select your grade.'); gradeSelect.focus(); return; }
            if (!name)                { showError('Please select your name.'); return; }
            if (!typedPw.trim())      { showError('Please enter your password.'); passwordInput.focus(); return; }

            lsSet(GRADE_KEY, gradeSelect.value);
            // Visible in-progress state — establishing the Firebase session is a network round trip,
            // so the button must not look idle (and silently swallow taps) while we wait. The Back
            // link is also made inert for this window (see the .login-back guard below) so a mid-
            // submit "Back to roster" tap can't strand the user in the half signed-in state.
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing in…';
            _signingIn = true;
            backLink.classList.add('login-back--busy');
            backLink.setAttribute('aria-disabled', 'true');
            startStatusProgress();
            // Start the login-to-usable timer (perf telemetry) — the moment the user commits to signing
            // in. Read once on the destination page; cleared on failure below. (See perf-reporter.js.)
            markLoginStart();

            // DOM-free core: time-boxes auth and commits the local session ONLY on success, so a
            // slow/hung Firebase Auth can never leave a "half signed-in" state (the v14.72–75 freeze
            // class; see runNamedSignIn / LOGIN_INCIDENT.md). On failure we restore the button and
            // show the message it returns; on success we hand off to onSuccess (reload/navigate).
            const _result = await runNamedSignIn({
                enforce:            CONFIG.ENFORCE_NAMED_SESSION,
                ensureNamedSession: () => ensureNamedSession(name, { password: typedPw }),
                saveSession:        () => saveSession(name),
                clearSession,
                getAuthError:       getFirebaseAuthError,
                isTransient:        isTransientAuthError,
            });
            if (!_result.ok) {
                clearStatusProgress();
                clearLoginStart();   // failed sign-in — drop the timer so a later load can't log a stale time
                // Client 3-strikes → 30s lockout — ONLY on a genuine wrong password (`kind:'credential'`),
                // never on a network/timeout/rate-limit failure (which would punish a connectivity
                // problem). Firebase does the real rate-limiting; this is a UX brake on hammering.
                if (_result.kind === 'credential') {
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
                            _attempting = false;   // release the mutex the inner finally kept latched
                        }, 30_000);
                        showError(/** @type {string} */ (_result.error));
                        passwordInput.value = '';
                        passwordInput.focus();
                        return;
                    }
                    passwordInput.value = '';
                    passwordInput.focus();
                }
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in →';
                showError(/** @type {string} */ (_result.error));
                return;
            }
            _failCount = 0;   // a successful sign-in clears the wrong-password streak
            // Confirm success before the (usually slow) reload kicks in, so there is no silent
            // "did it work?" gap between the click and the destination page appearing.
            clearStatusProgress();
            submitBtn.textContent = `Signed in — opening ${pageLabel}…`;
            try {
                await onSuccess(name);
                // onSuccess reloads/navigates; the resets below are harmless (the page is leaving).
            } catch (e) {
                // onSuccess CAN reject (the admin path does inline work before reloading). The
                // rejection used to be swallowed by the click handler's .catch(()=>{}), stranding
                // the primary button disabled on "Signed in — opening …" forever. The session IS
                // saved at this point, so recover the UI and let the user retry (v16.23).
                console.warn('[Login] onSuccess failed after a successful sign-in:', e);
                clearLoginStart();   // drop the perf marker — a later open must not log an inflated loginTotal
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in →';
                showError('Signed in, but the page couldn’t open — try again.');
            }
        } finally {
            // Release the in-flight mutex on completion — EXCEPT during the 30s lockout, whose own
            // timer (above) releases it when it expires. Keyed on `_lockedUntil` (not the button's
            // disabled state, which is also true during the "Signing in…" success window) so a real
            // attempt is serialised end-to-end. The handlers below must NOT also reset `_attempting`:
            // an early-returned (mutex-held) call would otherwise clear the flag mid-flight and let a
            // concurrent attempt start. `_attempting` is owned solely here + in the lockout timer.
            if (Date.now() >= _lockedUntil) {
                _attempting = false;
                // Belt-and-braces: an UNEXPECTED throw after the button was set to "Signing in…"
                // (line ~298) but before any normal branch restored it would leave it stuck disabled
                // (a soft-lock). Every intended exit already restores the button — success left the
                // page, failure/lockout branches reset it — so acting ONLY on the still-"Signing in…"
                // text touches nothing but the genuinely-stuck case, and never the success/lockout label.
                if (submitBtn.textContent === 'Signing in…') {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign in →';
                }
            }
            // Auth is no longer in flight once attempt() settles (the success path has already left
            // the page, so re-enabling Back here is moot for it but correct for every other exit).
            _signingIn = false;
            backLink.classList.remove('login-back--busy');
            backLink.removeAttribute('aria-disabled');
            clearStatusProgress();   // belt-and-braces: no progress timer outlives an attempt
        }
    }

    // Don't abandon an in-flight sign-in via the Back link — same intent as the Escape guard above.
    // Gated on `_signingIn` (true ONLY during the Firebase round trip), NOT on submitBtn.disabled,
    // so a mere 30s password lockout still lets the user escape to the public roster.
    backLink.addEventListener('click', e => { if (_signingIn) e.preventDefault(); });

    submitBtn.addEventListener('click', () => { attempt().catch(() => {}); });
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt().catch(() => {}); });
}
