// @ts-check
/**
 * settings-password-card.js — the Settings page's Password card (AUTH_AND_SESSIONS.md → "Chosen passwords" — self-service
 * chosen password + migration status).
 *
 * Moved out of `settings-app.js` on 25 Nov 2026, unchanged but for its inputs, when that coordinator
 * reached its size cap: the card is one subject with its own reads, its own form and its own save. The
 * coordinator hands it what it needs — the member, the page's `reportSetting` and the collapse-handle
 * table — and reads back one thing: whether a save is on its way (`passwordSaving`), which holds a
 * release's reload and makes signing out ask first (settings-app.js → `_busy`, `beforeSignOut`).
 *
 * The rules a member is held to are not here: the new password's validity is `validateNewPassword`
 * (auth-identity.js, shared with the forced change), the save's sequence and deadline are
 * `runPasswordSave` (own-password.js), and "has this member set their own password" is
 * `isPasswordMigrated`. This module wires them to the card. Behaviour-tested in e2e/settings.spec.js.
 */

import { getPasswordStatus, reauthenticateWithPassword, changeOwnPassword, withClaimRetry } from './firebase-client.js';
import { isPasswordMigrated, validateNewPassword, newPasswordProblemField, passwordChangeFailure } from './auth-identity.js';
import { sessionReady } from './session.js';
import { initCardCollapse } from './overlay.js';
import { setStatus } from './status-text.js';
import { trackBackgroundWrite } from './claim-retry.js';
import { runPasswordSave } from './own-password.js';

/** True from a password save's first write until its outcome is known — the two writes (re-auth,
 *  then the update) must never have a release's reload land between them (v24.61, iOS audit B2). */
let _passwordSaving = false;

/**
 * Is a password save on its way? True from the re-authentication until the outcome is known. The
 * re-authentication writes nothing, so `writesInFlight` (slow-save.js) cannot see it: the page's
 * reload hold and its sign-out question read this as well.
 * @returns {boolean}
 */
export function passwordSaving() { return _passwordSaving; }

/**
 * Wire the Password card: the migration status (chip, nudge, the settled state behind its door) and
 * the change-password form.
 *
 * @param {object} deps
 * @param {string|null} deps.member the signed-in member — whose password this card changes
 * @param {(id: string, state: import('./settings-status.js').CardState, chip?: string) => void} deps.reportSetting
 *   the page's report (settings-app.js): every path, a missing form included, must report, or the
 *   summary waits on "Checking…" for good
 * @param {Record<string, { setOpen(open: boolean): void }>} deps.cardHandles the page's collapse handles;
 *   this card adds its own under `'password'`, so a report can open it
 */
export function initPasswordCard({ member, reportSetting, cardHandles }) {
    const curEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('pwCurrent'));
    const newEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('pwNew'));
    const confEl  = /** @type {HTMLInputElement|null} */ (document.getElementById('pwConfirm'));
    const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('pwSaveBtn'));
    const feedback = document.getElementById('pwFeedback');
    const chip    = document.getElementById('passwordStatusChip');
    const nudge   = document.getElementById('passwordNudge');
    // Same rule as the work-email card above — a missing form must not silence the summary.
    if (!curEl || !newEl || !confEl || !saveBtn || !feedback) { reportSetting('password', 'error', 'Couldn’t check'); return; }
    cardHandles['password'] = initCardCollapse('passwordToggleHeader', 'passwordBody', 'passwordChevron');

    // ONE reveal control, covering all THREE fields (v22.37, owner review). The old `Show`
    // button sat beside New and also governed Confirm — defensible, and not what its placement
    // said. A labelled checkbox states which of its two positions it is in, and reaches Current
    // as well, which is where a mistyped password most often comes from.
    const pwShow = /** @type {HTMLInputElement|null} */ (document.getElementById('pwShowAll'));
    /** @param {boolean} reveal */
    const setRevealed = (reveal) => {
        curEl.type = newEl.type = confEl.type = reveal ? 'text' : 'password';
        if (pwShow) pwShow.checked = reveal;
    };
    pwShow?.addEventListener('change', () => setRevealed(!!pwShow.checked));

    // The two halves of the card body, and the latch that keeps the form open once opened.
    const settled   = document.getElementById('pwSettled');
    const form      = /** @type {HTMLFormElement|null} */ (document.getElementById('pwForm'));
    const changeBtn = document.getElementById('pwChangeBtn');
    const cancelBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('pwCancelBtn'));
    let _pwFormOpened = false;
    changeBtn?.addEventListener('click', () => {
        _pwFormOpened = true;
        if (settled) settled.hidden = true;
        if (form)    form.hidden    = false;
        if (cancelBtn) cancelBtn.hidden = false;
        curEl.focus();
    });
    // CANCEL PUTS THE SETTLED STATE BACK (settings review, Nov 2026). Change password opened a door
    // with no way back but a reload. It is offered only on that path, takes what was typed with it
    // (re-masked, as a save does, for the next person on a shared device), and waits out a save.
    cancelBtn?.addEventListener('click', () => {
        if (_passwordSaving) return;
        _pwFormOpened = false;
        curEl.value = newEl.value = confEl.value = '';
        setRevealed(false);
        setFeedback('');
        cancelBtn.hidden = true;
        if (form)    form.hidden    = true;
        if (settled) settled.hidden = false;
        changeBtn?.focus();
    });
    /** A save is on its way, or no longer — Cancel waits for it. @param {boolean} on */
    const setSaving = (on) => { _passwordSaving = on; if (cancelBtn) cancelBtn.disabled = on; };

    // THE FORM IS FOR THE PASSWORD MANAGER (iPhone audit, Nov 2026; the sign-in card's shape): it
    // files a new password under the username in the SAME form — this member's roster name. It never
    // goes anywhere: every submit is cancelled, and it is submitted only once a write is CONFIRMED
    // (`onWriteConfirmed`), so a password manager is never offered one the account does not have.
    const userEl = /** @type {HTMLInputElement|null} */ (document.getElementById('pwUsername'));
    if (userEl) userEl.value = member ?? '';
    form?.addEventListener('submit', e => e.preventDefault());
    // The return key does what the keyboard labels it: Next moves on, Done (Confirm's) saves — never the Enter that accepts an input method's suggestion (password-force.js's rule).
    form?.addEventListener('keydown', e => {
        const next = e.target === curEl ? newEl : e.target === newEl ? confEl : null;
        if (e.key !== 'Enter' || e.isComposing || saveBtn.disabled || (!next && e.target !== confEl)) return;
        e.preventDefault();
        if (next) next.focus(); else saveBtn.click();
    });
    const setFeedback = (/** @type {string} */ msg, /** @type {string} */ state = '') => {
        setStatus(feedback, msg);   // a leading ✓ is decoration, not a word to announce (status-text.js)
        feedback.className   = `contact-feedback${state ? ' ' + state : ''}`;
    };

    // Reflect migration status (header chip + nudge banner). Best-effort — a failed read leaves
    // both blank. Migrated ⇔ passwordSetAt exists AND is at least as new as any resetAt
    // (AUTH_AND_SESSIONS.md → "Password migration status").
    // `optimisticMigrated` lets the just-completed save flip the UI to migrated WITHOUT waiting on
    // the serverTimestamp() to resolve (an immediate local-cache read returns passwordSetAt:null
    // right after the write, which would briefly flash "using surname" under the ✓ message).
    //
    // ── ONLY THE LATEST READ PAINTS, AND A CONFIRMED WRITE IS LATCHED (settings review, Nov 2026) ──
    // The first read can be the slow one — a cold connection — while the read after a successful
    // change is answered at once from the local cache. Painting each answer as it landed let the
    // FIRST read, arriving last, turn "✓ Password set" back into "Using surname" (or "Couldn’t
    // check") under the member who had just set it. So every call is numbered and only the newest
    // may paint; and once a password write on this device is confirmed (`optimisticMigrated` — the
    // card's own save, or the forced overlay's event) migrated is held for the page's life: no read
    // made before the write can know about it, and nothing on this page un-sets a password.
    let _statusRead = 0;
    let _writeConfirmed = false;
    async function refreshStatus(optimisticMigrated = false) {
        // No identity to ask about — nothing was learnt, and the summary must be told that
        // rather than waiting for an answer that is never coming.
        if (!member) { reportSetting('password', 'error', 'Couldn’t check'); return; }
        if (optimisticMigrated) _writeConfirmed = true;
        const mine = ++_statusRead;
        const paint = (/** @type {boolean} */ migrated) => {
            // Every path into `paint(true)` is real evidence: the server says migrated, or a password
            // write on THIS device just succeeded (`optimisticMigrated` — the card's own save, and the
            // forced overlay's `myb:password-set`). Nothing paints migrated on a guess.
            // Through `setStatus`: this chip leads with a tick, and a live header a screen
            // reader walks would otherwise announce it as a word (status-text.js).
            if (chip) setStatus(chip, migrated ? '✓ Password set' : 'Using surname');
            if (nudge) {
                nudge.hidden = migrated;
                // "Still" was wrong after an admin reset, when the surname is the password AGAIN (settings review).
                if (!migrated) nudge.textContent =
                    'Your password is your surname — anyone who knows your name could guess it. Set one only you know below.';
            }
            // THE FORM IS BEHIND A DOOR ONCE THERE IS NOTHING TO FIX (v22.37, owner review).
            // A migrated member met three empty password fields on every visit, which reads as
            // a form they have to fill in rather than as a setting that is already right.
            // `_pwFormOpened` makes this ONE-WAY: once Change password has been pressed, a
            // later refresh (the optimistic repaint after a successful save, say) must not
            // fold the form away under someone who is typing in it.
            if (settled && form) {
                settled.hidden = !migrated || _pwFormOpened;
                form.hidden    = migrated && !_pwFormOpened;
            }
            reportSetting('password', migrated ? 'ok' : 'action',
                migrated ? '✓ Password set' : 'Using surname');
        };
        if (_writeConfirmed) paint(true);
        try {
            // Gate the owner-only read on the Firebase session (like initContactCard) — a cold-load
            // read before auth.currentUser exists is rejected by the rules and would blank the chip.
            await sessionReady;
            const st = await withClaimRetry(() => getPasswordStatus(member));   // a stale token, refreshed once (the work email's reason)
            if (mine !== _statusRead) return;   // a newer read was asked for: its answer is the one
            // isPasswordMigrated (auth-identity.js) is the single, unit-tested source
            // (AUTH_AND_SESSIONS.md → "Password migration status").
            paint(isPasswordMigrated(st) || _writeConfirmed);
        } catch {
            if (mine !== _statusRead) return;
            // Leave the chip/nudge as the optimistic paint left them — but the SUMMARY must
            // hear about it. Silence here would let "✓ You’re all set" appear over a password
            // status nobody actually read, which is the one thing that line must never do.
            if (!_writeConfirmed) reportSetting('password', 'error', 'Couldn’t check');
        }
    }
    refreshStatus();
    // The forced overlay (password-force.js) can change the password AFTER this card has already
    // read passwordStatus, leaving the header chip saying "using surname" until a reload (FIX,
    // v18.94). It dispatches this when it succeeds; optimistic because the serverTimestamp hasn't
    // resolved yet.
    document.addEventListener('myb:password-set', () => refreshStatus(true));

    /** True while a password write has passed its deadline but may still be in flight. */
    let _pwIndeterminate = false;

    /** The write completed. Shared by the in-time and the LATE success paths.
     *  @param {any} res the changeOwnPassword result ({ stamp }): the password HAS changed */
    const onWriteConfirmed = (res) => {
        // Only now tell the password manager, before the fields clear: earlier, a wrong CURRENT password
        // left Keychain offering a new password that was never set (the submit itself is cancelled).
        form?.requestSubmit();
        const done = '✓ Password updated. Use it the next time you sign in.';
        setFeedback(done, 'ok');   // a stamp that then FAILS is a soft note, and amends only this line
        // …and says what is true (review, Nov 2026). It promised "Your status will refresh shortly",
        // but nothing retries the stamp: without it the app still believes the surname is in use,
        // so the next sign-in may ask for a new password again. The password itself HAS changed.
        res?.stamp?.then((/** @type {boolean} */ ok) => { if (!ok && feedback?.textContent === done)
            setFeedback('✓ Password updated — use it next time you sign in. The app couldn’t record the change, so it may ask you to choose a password again.', 'ok'); });
        curEl.value = newEl.value = confEl.value = '';
        // Re-mask on success (v18.95). Clearing the values alone left the fields in whatever
        // reveal state the member chose, so the NEXT password typed into this card — possibly
        // by someone else on a shared device — would appear in the clear with no warning.
        setRevealed(false);
        // A first save folds the form away with focus in it, or already dropped to the page by the
        // disabled Save: it goes to Change password, which brings the form back (Nov 2026 review).
        const follow = !!form?.contains(document.activeElement) || document.activeElement === document.body;
        refreshStatus(true);   // optimistic: the password changed, so show migrated immediately
        if (follow && form?.hidden) changeBtn?.focus();
    };

    /**
     * The write passed its deadline and is still running. Say exactly that — the one thing we must
     * NOT say is that it failed, because it may be about to succeed, and the member would then be
     * signing in with a password that no longer exists (external review, v18.97).
     *
     * The fields are deliberately left FILLED: if the write did land, what they typed is now their
     * password, and clearing it would destroy the only copy on screen.
     * @param {Promise<{status:string, value?:any}>} settled
     */
    const onIndeterminate = (settled) => {
        _pwIndeterminate = true;
        saveBtn.disabled = true;                  // no racing second write
        saveBtn.textContent = 'Still saving…';
        setFeedback('We couldn’t confirm whether your password was updated. Remember the new password you just entered: try it first the next time you sign in, and your old one if it doesn’t work.', 'err');
        settled.then(late => {
            _pwIndeterminate = false;
            setSaving(false);
            saveBtn.disabled = false; saveBtn.textContent = 'Set password';
            if (late.status === 'ok') onWriteConfirmed(late.value);   // it landed after all
            else setFeedback('Your password wasn’t updated — try again.', 'err');
        });
    };

    saveBtn.addEventListener('click', async () => {
        if (!member) return;
        const current = curEl.value;
        const next    = newEl.value.trim();
        const confirm = confEl.value.trim();
        if (!current.trim())  { setFeedback('Enter your current password.', 'err'); curEl.focus(); return; }
        // Length / match / surname-block now come from the SHARED validator (auth-identity.js,
        // v18.92) so this card and the forced overlay can never disagree about what a valid
        // password is — two copies of a rule is how the Other-day grammar drifted (v18.91). The
        // messages and their order are unchanged.
        const invalid = validateNewPassword(member, next, confirm);
        if (invalid) {
            setFeedback(invalid, 'err');
            (newPasswordProblemField(next, confirm) === 'confirm' ? confEl : newEl).focus();
            return;
        }
        // The last attempt's message goes as this one starts (sign-in check, 11 Nov 2026 — a
        // "✓ Password updated" or an old refusal sat beside "Saving…").
        setFeedback('');
        const startFocus = document.activeElement;   // see the caret, in `finally`
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        setSaving(true);
        // Track WHICH stage failed: a failure AFTER reauth succeeded is NOT "current password wrong"
        // (the old catch mapped every non-rate-limit/weak error to that, so a network blip during the
        // update told the member their correct password was incorrect → needless retries + admin reset).
        let reauthed = false;
        /** Where the caret goes after a refusal — never left on the page (sign-in check, 11 Nov 2026). */
        let refocus = /** @type {HTMLElement|null} */ (null);
        try {
            // Wait for the session like every other write here (v18.84): initApp() runs while
            // ensureNamedSession is in flight, so an early save could meet a null auth.currentUser
            // ("Not signed in", read as a wrong CORRECT password) or, on a shared device mid-switch,
            // the PREVIOUS member's account.
            await sessionReady;
            // The sequence is own-password.js's (`runPasswordSave`, shared with the forced change, whose
            // header says why each call is time-boxed as it is). The write is COUNTED while it runs, so
            // `writesInFlight` sees it: the update reload holds and signing out asks (settings review).
            const outcome = await runPasswordSave({ member, current, next,
                reauthenticate: reauthenticateWithPassword, change: changeOwnPassword, track: trackBackgroundWrite });
            if (outcome.status === 'pending') { onIndeterminate(outcome.settled); return; }
            if (outcome.status === 'failed')  { reauthed = outcome.reauthed; throw outcome.error; }
            onWriteConfirmed(outcome.value);
        } catch (e) {
            const code = /** @type {any} */ (e)?.code || '';
            refocus = saveBtn;
            // Map by CAUSE and by STAGE — the ladder the forced change reads too (auth-identity.js).
            // A stale sign-in is this card's own: its remedy here is to sign out and back in.
            // Effectively unreachable today: the card re-authenticates with the current password
            // just above, which is exactly what makes a sign-in "recent". It stays as a guard: if
            // that step were ever skipped, reordered or changed, Firebase would refuse with this
            // code, and the generic "wasn’t updated — try again shortly" line would send the member
            // to retry something only signing out and back in can fix.
            if (code === 'auth/requires-recent-login') setFeedback('For your security, sign out and back in, then change your password.', 'err');
            else {
                const f = passwordChangeFailure(code, reauthed);
                setFeedback(f.message, 'err');
                if (f.focus) refocus = f.focus === 'current' ? curEl : newEl;
            }
        } finally {
            // Not re-enabled while a write may still be in flight — onIndeterminate owns the
            // button until the real outcome arrives, so a second save can't race the first.
            if (!_pwIndeterminate) { setSaving(false); saveBtn.disabled = false; saveBtn.textContent = 'Set password'; }
            // Only where the member left it (review, 11 Nov 2026): a save can wait out the re-auth
            // deadline, and one who moved on meanwhile — a field, the drawer — keeps their place.
            const here = document.activeElement;
            if (refocus && (here === startFocus || here === saveBtn || here === document.body || !here)) refocus.focus();
        }
    });
}
