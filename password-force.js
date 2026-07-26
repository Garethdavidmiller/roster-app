// @ts-check
/**
 * password-force.js — the MANDATORY "set your own password" overlay (PASSWORD_PLAN.md Phase 2).
 *
 * Owns: compelling an un-migrated member to replace their surname-derived password with one only they
 *   know, at the moment they next sign in. Injects its own overlay markup (the `login-overlay.js` /
 *   `nav-panel.js` pattern) so the five authenticated pages need no HTML of their own.
 * Does NOT own: the sign-in candidate ladder (session.js), the password rules
 *   (`validateNewPassword` in auth-identity.js — shared with the Settings card), the migration flag
 *   (`passwordStatus`, written by `setOwnPassword`), or the admin reset (a Cloud Function).
 *
 * ── WHY IT IS SAFE TO BLOCK ───────────────────────────────────────────────────────────────────
 * Blocking a member is the whole point — a dismissible prompt is the Phase-1 nudge, which produced
 * roughly one migration a day. Three properties keep a block from becoming a lockout:
 *
 *  1. **The roster is not behind this.** index.html is `anonymousOk` (auth-policy.js), so a member
 *     who cannot get past this overlay can still see their own shifts. They lose AL booking and the
 *     pay calculator until they set a password — an inconvenience, not an incident.
 *  2. **It fails open BEFORE showing.** A slow/failed `getPasswordStatus`, a non-`named` identity, or
 *     a missing login marker means it simply doesn't appear and tries again at the next sign-in.
 *  3. **It fails open AFTER showing too.** This is the part a "mandatory overlay" gets wrong: once
 *     it is up, a rate-limit or a dropped connection would otherwise leave the member facing a
 *     dialogue they cannot satisfy and cannot dismiss. On any auth-layer failure they can't fix by
 *     typing (`too-many-requests`, network, or a TIMEOUT), and after three failed attempts of any
 *     other kind, a "Continue for now" escape appears. It stamps nothing, so they are compelled again
 *     next sign-in.
 *     · v18.92 shipped this covering REJECTIONS only. A promise that never settles is not a rejection:
 *       it reached neither the catch nor the close, so a dead-air connection left "Saving…" up with the
 *       escape still hidden — the exact trap. `SAVE_TIMEOUT_MS` converts a hang into a rejection
 *       (v18.94). When adding any await inside the overlay, time-box it or this property is void.
 *
 * ── WHY IT IS LOGIN-GATED ─────────────────────────────────────────────────────────────────────
 * `login-overlay.js` sets a one-shot `myb_pw_force_pending_<member>` marker on a CONFIRMED sign-in;
 * this module consumes it as soon as it decides. Two reasons that matters:
 *   · A fresh sign-in is what makes `updatePassword` legal without re-entering the old password —
 *     Firebase requires a recent login, which a sign-in seconds ago satisfies. (If it doesn't, the
 *     `requires-recent-login` path below asks for the current password and reauthenticates.)
 *   · Without the marker the overlay would ambush a member mid-task on an ordinary page load — the
 *     v14.77 "Fix 4" defect that the email check's identical marker exists to prevent.
 * The marker is consumed EVEN WHEN we then decide not to show (or fail to read the status), so it can
 * never resurface on a later non-login load. That costs a compel cycle on a failed read; leaving the
 * marker set would re-create Fix 4, which is worse.
 *
 * Coverage note: this reaches anyone who signs in. Sessions are capped at 30 days absolute / 7 days
 * idle (session.js), and an expired session forces a real typed login (`reconcileExpiredIdentity`),
 * so the rollout completes itself within 30 days and staggers naturally by each member's own expiry.
 * A member who only ever views the roster never signs in anywhere and is never compelled — accepted;
 * reaching them means putting the calendar behind a login (SECURITY_RELEASE_PLAN.md → Track E).
 */

import { lsGet, lsSet, lsDel } from './ls.js';
import { PW_FORCE_PENDING_PREFIX } from './storage-keys.js';
import { CONFIG } from './roster-data.js';
import { getPasswordStatus, setOwnPassword, reauthenticateWithPassword } from './firebase-client.js';
import { isPasswordMigrated, isCredentialRejection, validateNewPassword, MIN_PASSWORD_LENGTH } from './auth-identity.js';
import { getAuthSnapshot } from './auth-state.js';
import { lockBodyScroll, unlockBodyScroll } from './overlay.js';

/** How long to wait for the owner-only `passwordStatus` read before giving up for this login. */
const STATUS_READ_TIMEOUT_MS = 4000;

/** Failed save attempts before the escape hatch appears regardless of the error. */
const ESCAPE_AFTER_FAILURES = 3;

/** Ceiling on the password WRITE. Mirrors runNamedSignIn's 8s sign-in budget (LOGIN_INCIDENT.md). */
const SAVE_TIMEOUT_MS = 8000;

/**
 * Reject `promise` if it hasn't settled in `ms`. Load-bearing here, not defensive padding: a promise
 * that never settles reaches neither `catch` nor the close path, so without this a dead-air mobile
 * connection left a MANDATORY overlay showing "Saving…" with the escape hatch still hidden — the
 * member could neither satisfy it nor dismiss it, which is precisely the trap this feature's design
 * claims to have closed. It closed it for REJECTIONS; a hang is not a rejection. Every other network
 * call in the feature was already time-boxed (the ready barrier, the status read, sign-in itself);
 * this one wasn't.
 * EXPORTED (v18.95) so the Settings Password card can reuse it rather than grow a second copy — it
 * makes the same `setOwnPassword` call and had the same gap. Its consequence is milder (a stuck card,
 * not a trap, because Settings is dismissible) but identical in kind: `finally` never runs on a
 * promise that never settles, so the button stayed disabled on "Saving…" until a reload.
 * @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<T>}
 */
export function withTimeout(promise, ms) {
    /** @type {any} */ let timer;
    return /** @type {Promise<T>} */ (Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'myb/timeout' })), ms); }),
    ]).finally(() => clearTimeout(timer)));
}

/**
 * PURE gate decision — no DOM, no Firebase, no storage (so it is unit-testable).
 *
 * All four conditions are load-bearing:
 *  · `flagOn`      — CONFIG.FORCE_PASSWORD_SET, the one-line kill switch.
 *  · `hasMarker`   — only immediately after a confirmed sign-in (see the header).
 *  · `authStatus`  — must be exactly `'named'`. NOT "an auth user exists": on the calendar that user
 *                    is ANONYMOUS, and on paycalc (a `soft` policy page) a member can be locally
 *                    signed in with a FAILED Firebase session. In either case `updatePassword` cannot
 *                    succeed, so showing a hard block would trap them with no way through.
 *  · `!migrated`   — nothing to compel once they have their own password.
 *
 * @param {{ flagOn: boolean, hasMarker: boolean, authStatus: string, migrated: boolean }} input
 * @returns {boolean}
 */
export function shouldForcePasswordSet({ flagOn, hasMarker, authStatus, migrated }) {
    if (!flagOn) return false;
    if (!hasMarker) return false;
    if (authStatus !== 'named') return false;
    return !migrated;
}

/** Build the overlay markup once and return its element refs. */
function _mount() {
    const existing = document.getElementById('pwForceOverlay');
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = 'pwForceOverlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Set your own password');
    // No ✕, no backdrop-close, no Escape handler — mandatory by construction. This is a deliberate
    // exception to the createLightbox lifecycle (CLAUDE.md), for the same reason as the work-email
    // check: every dismissal path createLightbox provides is one this overlay must not have.
    el.innerHTML = `
        <div id="pwForceContent">
            <img src="icon-192.png" alt="" aria-hidden="true">
            <div class="login-app-name">Set your own password</div>
            <div class="login-subtitle">Your password is still your surname, which anyone who knows your name could guess. Choose one only you know — you’ll need it the next time you sign in on any device.</div>
            <div class="login-field">
                <label for="pwfNew">New password <span class="pwf-req">(at least ${MIN_PASSWORD_LENGTH} characters)</span></label>
                <div class="login-pw-wrap">
                    <input type="password" id="pwfNew" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next">
                    <button type="button" id="pwfToggle" class="login-pw-toggle" aria-label="Show password" aria-pressed="false">Show</button>
                </div>
            </div>
            <div class="login-field">
                <label for="pwfConfirm">Confirm new password</label>
                <input type="password" id="pwfConfirm" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
            </div>
            <div class="login-field" id="pwfCurrentWrap" hidden>
                <label for="pwfCurrent">Current password</label>
                <input type="password" id="pwfCurrent" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false">
                <div class="login-hint">Your surname in lowercase, unless you’ve already changed it.</div>
            </div>
            <div id="pwfError" class="login-error" aria-live="polite"></div>
            <button type="button" id="pwfSave">Set password →</button>
            <button type="button" id="pwfEscape" class="pwf-escape" hidden>Continue for now</button>
        </div>`;
    document.body.appendChild(el);
    return el;
}

/**
 * Show the mandatory overlay and resolve when it closes (set or escaped).
 * @param {string} member
 * @returns {Promise<void>}
 */
function _show(member) {
    const overlay  = /** @type {HTMLElement} */ (_mount());
    const newEl    = /** @type {HTMLInputElement} */ (document.getElementById('pwfNew'));
    const confEl   = /** @type {HTMLInputElement} */ (document.getElementById('pwfConfirm'));
    const curWrap  = /** @type {HTMLElement} */ (document.getElementById('pwfCurrentWrap'));
    const curEl    = /** @type {HTMLInputElement} */ (document.getElementById('pwfCurrent'));
    const toggle   = /** @type {HTMLButtonElement} */ (document.getElementById('pwfToggle'));
    const errorEl  = /** @type {HTMLElement} */ (document.getElementById('pwfError'));
    const saveBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('pwfSave'));
    const escBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('pwfEscape'));

    // Hide whatever is behind from assistive tech while a modal is up (the login overlay can still be
    // mounted on the in-place sign-in path).
    const loginOverlay = document.getElementById('loginOverlay');
    loginOverlay?.setAttribute('aria-hidden', 'true');

    return /** @type {Promise<void>} */ (new Promise(resolve => {
        let failures = 0;
        let closed   = false;

        function close() {
            if (closed) return;                 // lockBodyScroll is depth-counted — unlock exactly once
            closed = true;
            loginOverlay?.removeAttribute('aria-hidden');
            overlay.classList.remove('visible');
            unlockBodyScroll();
            resolve();
        }

        /** Reveal the escape hatch — see property 3 in the header. Never stamps anything. */
        function offerEscape() {
            escBtn.hidden = false;
        }

        // `.visible` is NOT decoration: shared.css keeps `.login-error` at `display: none` and only
        // `.login-error.visible` is shown. Setting textContent alone left every message in this
        // overlay INVISIBLE — a member typing a short password saw nothing happen at all — and a test
        // asserting textContent passes right through that, because textContent is set either way.
        const setError = (/** @type {string} */ msg) => {
            errorEl.textContent = msg;
            errorEl.classList.toggle('visible', !!msg);
        };

        // The fields carry enterkeyhint="next"/"go", so the Android keyboard shows a Go key — which
        // did nothing (FIX, v18.94). There is no <form> here (a mandatory overlay must not be
        // submittable by stray means), so wire the key explicitly, as login-overlay.js does.
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !saveBtn.disabled) { e.preventDefault(); saveBtn.click(); }
        });

        toggle.addEventListener('click', () => {
            const show = newEl.type === 'password';
            newEl.type = confEl.type = show ? 'text' : 'password';
            toggle.textContent = show ? 'Hide' : 'Show';
            toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            toggle.setAttribute('aria-pressed', String(show));
        });

        escBtn.addEventListener('click', close);

        saveBtn.addEventListener('click', async () => {
            setError('');
            const next    = newEl.value.trim();
            const confirm = confEl.value.trim();
            // Shared rules — identical to the Settings card by construction (auth-identity.js).
            const invalid = validateNewPassword(member, next, confirm);
            if (invalid) {
                setError(invalid);
                // Focus the field the message is about. Derive the MISMATCH condition exactly rather
                // than inferring it from "the values differ" (FIX, v18.94): a too-short password with
                // an empty Confirm box also has differing values, so the old test sent the cursor to
                // Confirm while the error talked about the new password. Same bug reached the shipped
                // Settings card through the shared validator.
                const isMismatch = next.length >= MIN_PASSWORD_LENGTH && next !== confirm;
                (isMismatch ? confEl : newEl).focus();
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            try {
                // If the current-password field is showing we already know a plain updatePassword was
                // refused for staleness, so reauthenticate first. credentialCandidatesFor (inside
                // reauthenticateWithPassword) handles the un-migrated short-surname padding, exactly
                // as sign-in does — otherwise "C. Reen" typing "reen" could never complete this.
                if (!curWrap.hidden) await withTimeout(reauthenticateWithPassword(member, curEl.value), SAVE_TIMEOUT_MS);
                await withTimeout(setOwnPassword(member, next), SAVE_TIMEOUT_MS);
                // The password IS changed at this point. A missing migration stamp is a soft note
                // (setOwnPassword's own contract), never a failure — do not re-prompt on it.
                lsSet('myb_notice_password-2026_done', '1');   // this completes that campaign
                // Let the host page refresh anything showing migration state. On settings.html the
                // Password card read passwordStatus BEFORE this overlay ran, so without this its
                // header chip still said "using surname" until a reload (FIX, v18.94).
                document.dispatchEvent(new CustomEvent('myb:password-set'));
                close();
            } catch (e) {
                failures++;
                const code = /** @type {any} */ (e)?.code || '';
                if (code === 'auth/requires-recent-login') {
                    // The sign-in wasn't recent enough after all (the assumption this overlay is built
                    // on). Ask for the current password rather than dead-ending.
                    curWrap.hidden = false;
                    setError('For your security, confirm your current password as well.');
                    curEl.focus();
                } else if (code === 'auth/too-many-requests') {
                    setError('Too many attempts — wait a few minutes and try again.');
                    offerEscape();          // they cannot proceed by typing; must not be trapped
                } else if (code === 'auth/network-request-failed' || code === 'myb/timeout') {
                    // A hang lands here now (FIX, v18.94) and MUST offer the escape — it is
                    // indistinguishable to the member from being offline.
                    setError('Couldn’t connect — check your connection and try again.');
                    offerEscape();
                } else if (code === 'auth/missing-password') {
                    // Empty current-password box. Say so, rather than spending one of the three
                    // failures on the generic "try again shortly" (auth/missing-password is not in
                    // CREDENTIAL_REJECTION_CODES, so it used to fall through to it).
                    setError('Enter your current password.');
                    curEl.focus();
                } else if (isCredentialRejection(code)) {
                    setError('Current password incorrect — try again, or ask the admin to reset it.');
                    curEl.focus();
                } else if (code === 'auth/weak-password') {
                    setError('That password is too weak — choose a longer one.');
                    newEl.focus();
                } else {
                    setError('Couldn’t set your password — try again shortly.');
                }
                if (failures >= ESCAPE_AFTER_FAILURES) offerEscape();
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Set password →';
            }
        });

        // Focus trap. Mirrors the work-email check rather than overlay.js's trapFocus, because the
        // focusable set CHANGES at runtime here (the current-password field and the escape button
        // both appear conditionally), so it must be recomputed on each Tab.
        overlay.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            const focusable = /** @type {HTMLElement[]} */ (Array.from(overlay.querySelectorAll(
                'button:not([disabled]), input',
            ))).filter(el => !el.closest('[hidden]') && !el.hasAttribute('hidden') && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first)  { e.preventDefault(); last.focus(); }
            if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); }
        });

        lockBodyScroll();
        overlay.classList.add('visible');
        // Focus SYNCHRONOUSLY. The work-email check defers this by 60ms because it animates in; this
        // overlay has no transition, so a timer here buys nothing and creates a race — anything that
        // reaches the fields inside that window has focus yanked back to the first input mid-input.
        // (That race is what made the mobile e2e intermittently see two fills land in one field.)
        if (!overlay.contains(document.activeElement)) newEl.focus();
    }));
}

/**
 * Compel an un-migrated member to set their own password, once, right after a confirmed sign-in.
 * Fire-and-forget from a coordinator's authorised path — never awaited on the login critical path.
 *
 * @param {string|null|undefined} member
 * @param {{ ready?: Promise<any>, onShow?: () => void }} [opts]  `ready` is a barrier that resolves once the Firebase session is
 *   settled. The four `sessionReady` pages pass it; paycalc calls this from inside its own post-auth
 *   callback and passes nothing (already settled). Raced with a timeout so a page whose barrier never
 *   resolves degrades to "don't show" instead of hanging.
 * @returns {Promise<boolean>} whether the overlay was shown (callers use this to defer the work-email
 *   check — PASSWORD_PLAN.md §4: password wins when both are due).
 */
export async function initPasswordForce(member, { ready, onShow } = {}) {
    if (!member) return false;
    const pendingKey = PW_FORCE_PENDING_PREFIX + member;
    if (!lsGet(pendingKey)) return false;      // not a fresh sign-in → never ambush an ordinary load
    lsDel(pendingKey);                         // one-shot: consume BEFORE any await (see header)
    // The flag is checked AFTER consuming the marker, which looks backwards but is deliberate: if it
    // were checked first, a flag-OFF deployment would leave markers lying in localStorage, and the
    // day the flag is switched on every one of those members would be ambushed on their next ordinary
    // page load rather than at their next sign-in — the Fix-4 defect, arriving en masse.
    if (!CONFIG.FORCE_PASSWORD_SET) return false;

    if (ready) {
        try {
            await Promise.race([
                ready,
                new Promise(res => setTimeout(res, STATUS_READ_TIMEOUT_MS)),
            ]);
        } catch { /* a rejected barrier is just "not settled" — the identity check below decides */ }
    }
    // Identity must be NAMED — see shouldForcePasswordSet. Checked after the barrier so the store
    // reflects the terminal state, not the in-flight one.
    const authStatus = getAuthSnapshot().status;

    /** @type {any} */
    let status;
    try {
        status = await Promise.race([
            getPasswordStatus(member),
            new Promise((_, reject) => setTimeout(() => reject(new Error('passwordStatus read timed out')), STATUS_READ_TIMEOUT_MS)),
        ]);
    } catch {
        return false;      // fail open: never block on a read we couldn't complete
    }

    if (!shouldForcePasswordSet({
        flagOn:     CONFIG.FORCE_PASSWORD_SET,
        hasMarker:  true,                       // consumed above
        authStatus,
        migrated:   isPasswordMigrated(status),
    })) return false;

    try {
        // Fire BEFORE awaiting the overlay (FIX, v18.94). The returned promise resolves only when the
        // member CLOSES the overlay, so a caller using it to settle a competing overlay never ran if
        // they navigated away or backgrounded the app while it was up — which for a modal with no ✕ is
        // the natural reflex. That stranded the work-email check's one-shot marker, and the email
        // check then ambushed them on a later ordinary load: the v14.77 "Fix 4" defect, re-created by
        // the very line meant to prevent it.
        onShow?.();
        await _show(member);
    } catch (e) {
        console.warn('[Auth] forced password overlay failed to run:', e);
        return false;
    }
    return true;
}
