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
 *     v14.77 "Fix 4" defect, first seen with the (since retired) work-email check's identical marker.
 * The marker is consumed EVEN WHEN we then decide not to show (or fail to read the status), so it can
 * never resurface on a later non-login load. That costs a compel cycle on a failed read; leaving the
 * marker set would re-create Fix 4, which is worse.
 *
 * Coverage note: this reaches anyone who signs in. Sessions are capped at 60 days absolute
 * (`SESSION_MS` in session.js — 30 days until v20.47; the 7-day idle cutoff went at v20.41), and an
 * expired session forces a real typed login (`reconcileExpiredIdentity`), so the rollout completes
 * itself within 60 days and staggers naturally by each member's own expiry. That window is a
 * CONSEQUENCE of the session length, not a policy of this module — it doubled when the session did.
 * A member who only ever views the roster never signs in anywhere and is never compelled — accepted;
 * reaching them means putting the calendar behind a login (SECURITY_RELEASE_PLAN.md → Track E).
 */

import { lsGet, lsDel } from './ls.js';
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
 *
 * **Use this only for operations that change NOTHING** — a read, or an idempotent re-auth. For a
 * STATE-CHANGING call, use `settleOrTimeout` below: this one reports a timeout as a rejection, and a
 * rejection means "it did not happen", which for a password write is a claim we cannot make.
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
 * Race a promise against a deadline WITHOUT claiming that a slow operation failed.
 *
 * `withTimeout` above turns a deadline into a rejection, and every caller treats a rejection as "it
 * did not happen". For a password WRITE that is false, and dangerously so: `Promise.race` stops
 * *waiting*, it does not *cancel* — Firebase's `updatePassword` keeps going and can succeed a second
 * after we have told the member it failed. They then believe their old password still works, retry
 * against a credential that has already changed, or walk away from a compulsory overlay mis-informed.
 * With FORCE_PASSWORD_SET live that is a route into a genuine lockout, caused by the very guard added
 * to prevent one (external review, v18.96).
 *
 * So this reports THREE outcomes rather than two, and hands back a handle on the original work:
 *   { status: 'ok', value }       — settled in time
 *   { status: 'failed', error }   — genuinely rejected in time
 *   { status: 'pending', settled }— deadline passed, STILL RUNNING; await `settled` for the real
 *                                   outcome (it resolves to an 'ok' or 'failed' record, never rejects)
 *
 * The tracked promise absorbs its own rejection immediately, so a late failure can never surface as
 * an unhandled rejection even if the caller stops caring.
 *
 * @template T @param {Promise<T>} promise @param {number} ms
 * @returns {Promise<{status:'ok',value:T}|{status:'failed',error:any}|{status:'pending',settled:Promise<{status:'ok',value:T}|{status:'failed',error:any}>}>}
 */
export function settleOrTimeout(promise, ms) {
    /** @type {any} */ let timer;
    const settled = promise.then(
        value => /** @type {any} */ ({ status: 'ok', value }),
        error => /** @type {any} */ ({ status: 'failed', error }),
    );
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve(/** @type {any} */ ({ status: 'pending', settled })), ms);
    });
    return /** @type {any} */ (Promise.race([settled, deadline]).finally(() => clearTimeout(timer)));
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
                <label for="pwfNew">New password</label>
                <div class="login-pw-wrap">
                    <input type="password" id="pwfNew" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-describedby="pwfNewHint">
                    <button type="button" id="pwfToggle" class="login-pw-toggle" aria-label="Show password" aria-pressed="false">Show</button>
                </div>
                <div class="login-hint" id="pwfNewHint">At least ${MIN_PASSWORD_LENGTH} characters. Anything you'll remember — it replaces your surname everywhere you sign in.</div>
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
        /** True while a password write has passed its deadline but may still be in flight. */
        let _indeterminate = false;
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
                // Re-auth is safe to time out as a plain failure: it changes nothing, so retrying is
                // free and "it did not happen" is a true statement about it.
                if (!curWrap.hidden) await withTimeout(reauthenticateWithPassword(member, curEl.value), SAVE_TIMEOUT_MS);
                // The WRITE is different — see settleOrTimeout. A deadline here means "we don't know",
                // never "it failed".
                const res = await settleOrTimeout(setOwnPassword(member, next), SAVE_TIMEOUT_MS);
                if (res.status === 'pending') { onIndeterminate(res.settled); return; }
                if (res.status === 'failed')  throw res.error;
                // The password IS changed at this point. A missing migration stamp is a soft note
                // (setOwnPassword's own contract), never a failure — do not re-prompt on it.
                onWriteConfirmed();
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
                // NOT re-enabled after an indeterminate write — onIndeterminate owns the button from
                // that point, because a second save racing a first that may still land is the worst
                // version of this bug (the retry re-authenticates with a password the late write may
                // already have replaced).
                if (!_indeterminate) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Set password →';
                }
            }
        });

        /** The write completed: finish the flow. Shared by the in-time and the LATE success paths. */
        function onWriteConfirmed() {
            // Let the host page refresh anything showing migration state. On settings.html the
            // Password card read passwordStatus BEFORE this overlay ran, so without this its
            // header chip still said "using surname" until a reload (FIX, v18.94).
            document.dispatchEvent(new CustomEvent('myb:password-set'));
            close();
        }

        /**
         * The write passed its deadline but is STILL RUNNING. Tell the truth — we do not know whether
         * it worked — and keep watching, rather than reporting a failure that may be about to become a
         * success (external review, v18.96).
         *
         * The member is told to KEEP the new password and try it first, because that is the safe
         * instruction under both outcomes: if the write landed it is now their password, and if it
         * didn't, trying it once and falling back costs them one attempt. The escape is offered
         * immediately — a compulsory overlay must never hold someone on an outcome nobody can resolve.
         * @param {Promise<{status:string, error?:any}>} settled
         */
        function onIndeterminate(settled) {
            _indeterminate = true;
            saveBtn.disabled = true;                 // no racing second write
            saveBtn.textContent = 'Still saving…';
            setError('We couldn’t confirm whether your password was updated. Keep the password you just entered and try it first next time you sign in.');
            offerEscape();
            settled.then(late => {
                if (!overlay.isConnected) return;    // they left; nothing to update
                if (late.status === 'ok') {
                    _indeterminate = false;
                    onWriteConfirmed();              // it landed after all — finish normally
                    return;
                }
                // It genuinely failed. NOW a retry is safe, and they get the real reason.
                _indeterminate = false;
                saveBtn.disabled = false;
                saveBtn.textContent = 'Set password →';
                setError('Your password wasn’t updated — try again.');
            });
        }

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
 * @param {{ ready?: Promise<any> }} [opts]  `ready` is a barrier that resolves once the Firebase session is
 *   settled. The four `sessionReady` pages pass it; paycalc calls this from inside its own post-auth
 *   callback and passes nothing (already settled). Raced with a timeout so a page whose barrier never
 *   resolves degrades to "don't show" instead of hanging.
 * @returns {Promise<boolean>} whether the overlay was shown. No caller consumes it today — the
 *   work-email check that used to defer to it was retired at v19.30 — but it is the honest result of
 *   the call, and the next overlay that has to queue behind this one will need it.
 */
export async function initPasswordForce(member, { ready } = {}) {
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
        // NOTE for whoever adds a second post-login overlay: anything that must happen when this one
        // OPENS has to fire before this await, not after it. The returned promise settles only when the
        // member CLOSES the overlay, and a modal with no ✕ is exactly the kind people navigate away
        // from — so "on close" never runs for them. That was the v18.94 bug: the work-email check's
        // one-shot marker was cleared after the await, survived, and ambushed the member on a later
        // ordinary load — the v14.77 "Fix 4" defect, re-created by the line meant to prevent it.
        await _show(member);
    } catch (e) {
        console.warn('[Auth] forced password overlay failed to run:', e);
        return false;
    }
    return true;
}
