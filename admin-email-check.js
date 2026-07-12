// @ts-check
/**
 * admin-email-check.js — the one-time work-email confirmation overlay, extracted from admin-app.js
 * (v16.41) as a self-contained, independently-loadable feature module.
 *
 * Shown ONCE right after a fresh login (the one-shot `myb_email_check_pending_<member>` marker set by
 * admin-app.js's login onSuccess) AND only when DUE (>= 3 months since last confirmed). Mandatory once
 * shown (no close button). Never blocks the app — a slow/failed Firestore read just skips it. Also
 * editable any time via Settings. Full rationale + call-site contract: CLAUDE.md -> "Work email check".
 */

import { lsGet, lsSet, lsDel } from './ls.js';
import { getStaffContact, saveStaffContact } from './firebase-client.js';
import { CONFIG, isValidEmail, isChilternWorkEmail } from './roster-data.js';
import { lockBodyScroll, unlockBodyScroll } from './overlay.js';
import { sessionReady } from './session.js';

export const EMAIL_CHECK_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * PURE cadence decision (extracted + unit-tested v16.66): is a work-email confirmation DUE?
 * `rawStamp` is the stored `myb_email_check_done_<member>` value — the last-confirmed time in ms as a
 * string, or null. Due when: never confirmed (null), a legacy/junk value (the pre-v14.77 done-forever
 * `'1'` flag, or any parse that isn't a real ms timestamp — i.e. below `1e12` ms ≈ Sep 2001), or when
 * `now − last ≥ intervalMs`. Kept DOM/storage-free so the tricky legacy heuristic is testable.
 * @param {string|null|undefined} rawStamp
 * @param {number} now  Date.now() at the call site
 * @param {number} [intervalMs]
 * @returns {boolean}
 */
export function isEmailCheckDue(rawStamp, now, intervalMs = EMAIL_CHECK_INTERVAL_MS) {
    const last = rawStamp ? parseInt(rawStamp, 10) : 0;
    if (!Number.isFinite(last) || last < 1e12) return true;   // never / legacy '1' / junk → due
    return now - last >= intervalMs;
}

/** True if the member is DUE a work-email confirmation (reads the stored stamp). @param {string} member */
function _emailCheckDue(member) {
    return isEmailCheckDue(lsGet(`myb_email_check_done_${member}`), Date.now());
}

/**
 * Inner promise-based engine for the email check overlay.
 * Returns without showing unless this is a fresh login (pending marker) AND the check is due
 * (≥ 3 months since last confirmed), or if the Firestore fetch fails (never blocks the app).
 * Resolves when the user confirms or saves their email.
 * @param {any} member
 */
async function _runEmailCheck(member) {
    // Fix 4 + cadence (v14.77): prompt ONLY right after a fresh login (the one-shot pending marker
    // set in showAdminLogin) — never on a random Admin page load — and only when actually due
    // (≥ 3 months since last confirmed). Consume the marker as soon as we decide, so the modal can
    // never reappear on a later non-login load this session; the result is stamped on dismiss.
    const pendingKey = `myb_email_check_pending_${member}`;
    if (!lsGet(pendingKey)) return;            // not a fresh login → don't prompt
    lsDel(pendingKey);                         // one-shot: consume the login marker now
    if (!_emailCheckDue(member)) return;       // confirmed within the last ~3 months — nothing to do

    // Time-box the Firestore read so a slow/hung getStaffContact can't hang the (now async,
    // off-login-path) check. On timeout/error we skip it this load — it reappears on the next login.
    let existing = null;
    try {
        existing = await Promise.race([
            getStaffContact(member),
            new Promise((_, reject) => setTimeout(() => reject(new Error('email-check read timed out')), 4000)),
        ]);
    } catch { return; }

    const overlayEl   = document.getElementById('emailCheckOverlay');
    if (!overlayEl) return;
    const overlay     = /** @type {HTMLElement} */ (overlayEl);
    const confirmView = /** @type {HTMLElement} */ (document.getElementById('emailCheckConfirmView'));
    const editView    = /** @type {HTMLElement} */ (document.getElementById('emailCheckEditView'));
    const storedEl    = /** @type {HTMLElement} */ (document.getElementById('emailCheckStoredEmail'));
    const yesBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('emailCheckYesBtn'));
    const changeBtn   = /** @type {HTMLElement} */ (document.getElementById('emailCheckChangeBtn'));
    const backBtn     = /** @type {HTMLElement} */ (document.getElementById('emailCheckBackBtn'));
    const laterBtn    = /** @type {HTMLElement} */ (document.getElementById('emailCheckLaterBtn'));
    const input       = /** @type {HTMLInputElement} */ (document.getElementById('emailCheckInput'));
    const errorEl     = /** @type {HTMLElement} */ (document.getElementById('emailCheckError'));
    const saveBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('emailCheckSaveBtn'));

    // Hide the login overlay from assistive tech when the email check stacks on top.
    const loginOverlay = document.getElementById('loginOverlay');
    loginOverlay?.setAttribute('aria-hidden', 'true');

    return /** @type {Promise<void>} */ (new Promise(resolve => {
        function _showConfirm() {
            confirmView.hidden = false;
            editView.hidden = true;
            backBtn.hidden = true;
            overlay.setAttribute('aria-label', 'Confirm work email');
        }

        /**
         * @param {any} prefill
         * @param {any} showBack
         */
        function _showEdit(prefill, showBack) {
            editView.hidden = false;
            confirmView.hidden = true;
            if (prefill !== undefined) input.value = prefill;
            backBtn.hidden = !showBack;
            // "I'll add this later" shows ONLY on the pure-add screen (no email stored yet, so no Back
            // exists) — a new starter who doesn't know their work email must not be locked out of the
            // app behind a mandatory field. The confirm-existing and edit-from-confirm screens stay
            // mandatory (they already have an email and can Back out). (D2)
            laterBtn.hidden = showBack;
            overlay.setAttribute('aria-label', showBack ? 'Edit work email' : 'Add work email');
        }

        /** Close the overlay (animation + unlock + resolve). Does NOT stamp the done time. */
        function _close() {
            loginOverlay?.removeAttribute('aria-hidden');
            overlay.classList.remove('open');
            const content = /** @type {HTMLElement} */ (document.getElementById('emailCheckContent'));
            let _done = false;
            const onEnd = () => {
                // Idempotent (v16.25): transitionend AND the 500ms fallback both call this — without
                // the guard a second run fired a second unlockBodyScroll (depth-counted, so it could
                // drop an outer overlay's lock). Mirrors the shared dismissOverlay lifecycle.
                if (_done) return;
                _done = true;
                overlay.classList.remove('visible');
                unlockBodyScroll();
                resolve();
            };
            content.addEventListener('transitionend', onEnd, { once: true });
            setTimeout(onEnd, 500);
        }

        function _dismiss() {
            // Stamp the confirmation time so the check is not due again for ~3 months (v14.77).
            lsSet(`myb_email_check_done_${member}`, String(Date.now()));
            _close();
        }

        function _addLater() {
            // Deliberately do NOT stamp the done time: the member still has no email, so the check
            // stays DUE and prompts again on the NEXT fresh login (the one-shot pending marker was
            // already consumed, so it won't re-show this session). A gentle re-nudge, not a 3-month
            // skip — and never a lock-out. (D2)
            _close();
        }

        if (existing?.workEmail) {
            storedEl.textContent = existing.workEmail;
            _showConfirm();
        } else {
            _showEdit('', false);
        }

        lockBodyScroll();
        overlay.classList.add('visible');
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('open')));
        setTimeout(() => (existing?.workEmail ? yesBtn : input).focus(), 60);

        overlay.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            const focusable = /** @type {HTMLElement[]} */ (Array.from(overlay.querySelectorAll(
                'button:not([disabled]), input'
            ))).filter(el => !el.closest('[hidden]') && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); }
        });

        yesBtn.addEventListener('click', _dismiss, { once: true });

        changeBtn.addEventListener('click', () => {
            _showEdit(existing?.workEmail ?? '', true);
            input.focus();
        });

        backBtn.addEventListener('click', () => {
            _showConfirm();
            yesBtn.focus();
        });

        laterBtn.addEventListener('click', _addLater, { once: true });

        input.addEventListener('blur', () => {
            const v = input.value.trim();
            if (v && !v.includes('@')) input.value = v + '@' + CONFIG.WORK_EMAIL_DOMAIN;
        });

        saveBtn.addEventListener('click', async () => {
            // Mirror the blur handler: append the work domain if the user typed only a username and
            // reached Save WITHOUT blurring (keyboard / assistive flows don't always fire blur first).
            // Matches the settings/operations save paths, which append inside the save action.
            const rawSave = input.value.trim();
            if (rawSave && !rawSave.includes('@')) input.value = rawSave + '@' + CONFIG.WORK_EMAIL_DOMAIN;
            const email = input.value.trim();
            errorEl.textContent = '';
            if (!email) {
                errorEl.textContent = 'Please enter your work email address.';
                input.focus(); return;
            }
            if (!isValidEmail(email)) {
                errorEl.textContent = 'That doesn\'t look like a valid email address.';
                input.focus(); return;
            }
            if (!isChilternWorkEmail(email)) {
                errorEl.textContent = `Please use a Chiltern work email (@${CONFIG.WORK_EMAIL_DOMAIN}).`;
                input.focus(); return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            try {
                await saveStaffContact(member, email);
                _dismiss();
            } catch {
                errorEl.textContent = 'Couldn\'t save — check your connection and try again.';
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save email →';
                saveBtn.focus();
            }
        });
    }));
}

/**
 * Called on every admin page load for an authenticated user.
 * Awaits sessionReady so getStaffContact() doesn't run before authentication
 * is restored (returning-user path re-establishes Firebase Auth asynchronously).
 * @param {any} member
 */
export async function initEmailCheck(member) {
    await sessionReady;
    await _runEmailCheck(member);
}
