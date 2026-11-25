// @ts-check
/**
 * admin-auth.js — Staff Firebase Auth account setup (admin only).
 *
 * Owns: Staff Login Accounts card — creates/disables Firebase Auth accounts for
 *   all roster members by calling the setupRosterAuth Cloud Function.
 * Does NOT own: login flow (login-overlay.js, session.js), Firestore auth rules (firestore.rules),
 *   account credential derivation (auth-identity.js nameToEmail / surnamePassword).
 * Edit here for: account setup UI.
 *
 * Auth: Firebase ID token with admin custom claim (set by setupRosterAuth on first run).
 * No hardcoded secret — the request uses a short-lived signed JWT from Firebase Auth.
 */

import { escapeHtml } from './roster-data.js';
import { auth, getAccountSetupGaps } from './firebase-client.js';
import { sessionReady, getFirebaseAuthError, restoreFirstAuthUser } from './session.js';
import { fetchWithTimeout, isFetchTimeout } from './fetch-timeout.js';
import { functionUrl } from './function-url.js';

const SETUP_AUTH_URL = functionUrl('setupRosterAuth');

/**
 * Initialises the Staff Login Accounts setup card (admin only). Call once after
 * authentication resolves.
 * @param {{ currentIsAdmin: boolean,
 *           onAttention?: (counts: { setUp: number, leavers: number }) => void,
 *           onWithdraw?: () => void }} cfg
 *        `onAttention` is called ONLY when the audit actually answered — a failed or refused check
 *        reports nothing, because the strip it feeds treats an unreported item as UNKNOWN and an
 *        absent one as "nothing to do". Those must not be the same thing here.
 *        `onWithdraw` is called whenever a check could NOT answer, so that what an earlier one
 *        reported goes back to unknown with it — the re-audit after a run, or a Retry, that fails
 *        (whole-app check, 10 Nov 2026; settings-ops-6). Reporting nothing was right and was not
 *        enough: the strip kept "Leavers still active 2" beside a card saying it could not tell.
 *        As the Error Log's (`operations-errors.js`).
 * @returns {{ refresh: () => Promise<void> }}  `refresh` asks the audit again — for the page to call
 *        when a deep link to the card lands on a page already open, and on a return to the tab
 *        (whole-app check, 17 Nov 2026). The card read the audit once, at load, so a tap opened Staff
 *        Login Accounts on an answer from before it; the reset queue and the Error Log had both been
 *        given the same re-read before (Sep 2026, v26.04). A no-op where the card is not wired.
 */
export function initAuthSetup({ currentIsAdmin, onAttention, onWithdraw }) {
    const unwired = { refresh: async () => {} };
    if (!currentIsAdmin) return unwired;

    const card      = document.getElementById('authSetupCard');
    const btn       = document.getElementById('authSetupBtn');
    const orphansCb = document.getElementById('authSetupOrphans');
    const resultEl  = document.getElementById('authSetupResult');
    const gapsEl    = document.getElementById('authSetupGaps');
    if (!card || !btn || !orphansCb || !resultEl) return unwired;

    card.style.display = '';

    // Collapse is wired centrally in operations-app.js via initCardCollapse.

    // B4: the member + role lists are now SERVER-OWNED (setupRosterAuth reads them from
    // roster-members.json, generated from roster-data.js). The client no longer sends them —
    // it only asks the server to provision and, optionally, to sweep leavers (dry-run first).


    // ── What is actually wrong right now (v22.53) ───────────────────────────────────────────────
    //
    // Provisioning is the one part of joining and leaving that leaves no trace when it is skipped.
    // A member added to roster-data.js whose "Set up accounts" run never happened appears correct
    // on every screen until they try to sign in; a new manager without their claim signs in fine
    // and then permission-denies on every write for somebody else; a leaver whose disable step was
    // missed simply keeps a working login. Until now the ONLY way to find any of the three was to
    // press the button and read what it says it did — which is a check you have to already suspect
    // you need. This block states it on load instead.
    //
    // It is a READ (getAccountSetupGaps changes nothing), and it is deliberately NOT a repair: an
    // audit that quietly fixed what it found would make the gap invisible again, which is the state
    // the whole thing exists to end. The button stays the only thing that changes anything.
    //
    // The three states are three DIFFERENT sentences and none of them may be collapsed into
    // another: gaps found · none found · could not tell. The last is why `refused` exists on the
    // response — an empty account list means the audit could not see the roster, not that the
    // roster is clean, and rendering it as a tick would be a false all-clear on the one surface
    // written to prevent one.
    //
    // TWO OF THE FOUR REASONS ARE MENDED BY A RESET, AND THE ADMIN IS TOLD BEFORE PRESSING (sign-in audit E6, Nov 2026).
    // Set up accounts takes back an account with NO permissions at all — registered from outside the app — and
    // re-enables a DISABLED one, each on the surname default with every device signed out (functions/auth-endpoints.js,
    // `mustReclaim` and the re-enable). Both read "Press Set up accounts below." and nothing more, so the admin learned
    // from the result that two colleagues had been put back on their surname. A wrong tier ('claims') only has its
    // permissions corrected. 'unstamped' is the server's word for no permissions at all; an older server sent 'claims'
    // for it, so during a deploy that one still reads as wrong permissions.
    //
    // AND TWO IT REFUSES (review D3, Nov 2026). An account at a member's address that is the shared staff PIN account
    // ('viewer-linked'), or whose permissions name another member ('other-member'), read "wrong permissions — Press Set
    // up accounts below", and pressing it only reported the refusal. Each now says what Set up accounts says when it
    // refuses it, and the press is offered only when some gap on the line is one it mends.
    const WHY_TEXT = /** @type {Record<string, string>} */ ({
        'no-account':    'no account',
        'claims':        'wrong permissions',
        'unstamped':     'no permissions',
        'disabled':      'account disabled',
        'viewer-linked': 'linked to the staff PIN account',
        'other-member':  'account claimed for another member',
    });
    /** The reasons Set up accounts answers by resetting the account to the surname default and signing it out. */
    const RESET_BY_SETUP = new Set(['unstamped', 'disabled']);
    /** The reasons Set up accounts REFUSES, each with its remedy — the server's own (functions/auth-endpoints.js). */
    const REFUSED_BY_SETUP = /** @type {Record<string, (names: string) => string>} */ ({
        'viewer-linked': (names) => `${names}: the address is linked to the shared staff PIN account, which Set up accounts will not take over. With the staff PIN retired nothing in the app clears it: delete the staff PIN account in the Firebase console (the retirement’s last step), then press Set up accounts.`,
        'other-member':  (names) => `${names}: the account at that address is claimed for another member, so Set up accounts will not adopt it. Check it in the Firebase console.`,
    });

    /** "A", "A and B", "A, B and C". @param {string[]} names */
    const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

    /** What pressing Set up accounts will do to the members it resets, by name. @param {string[]} names */
    const resetWarning = (names) => (names.length === 1
        ? `It will reset ${names[0]}’s password to their surname and sign them out — tell them afterwards.`
        : `It will reset the passwords of ${listed(names)} to their surnames and sign them out — tell them afterwards.`);

    /** One line: a count, the names behind it, and the button that fixes them — each remedy on a line of its own.
     *  `cls` is the whole class list — a modifier only where operations.css styles one (the leaver line's red). */
    function gapLine(/** @type {string} */ cls, /** @type {string} */ lead,
                     /** @type {string[]} */ names, /** @type {string[]} */ fixes) {
        const p = document.createElement('p');
        p.className = cls;
        const strong = document.createElement('strong');
        strong.textContent = String(names.length);
        p.append(strong, ` ${lead} — ${names.join(', ')}`);
        for (const fix of fixes) {
            const fixEl = document.createElement('span');
            fixEl.className = 'auth-gap-fix';
            fixEl.textContent = fix;
            p.append(fixEl);
        }
        return p;
    }

    // ── ONLY THE ANSWER ASKED LAST MAY DRAW (whole-app check, 17 Nov 2026) ──────────────────────────
    // The audit is asked again — after a run, on a Retry, on a deep link, on a return to the tab — so
    // two can be out at once, and only the one asked LAST may draw: an earlier answer landing after it
    // painted the roster as it was before the run. (Until the staff PIN's server release, Nov 2026, the
    // answer also carried the PIN's station-wide block, and its line was redrawn by the clock.)
    let asked = 0;

    async function loadGaps() {
        if (!gapsEl) return;
        const mine = ++asked;
        gapsEl.setAttribute('aria-busy', 'true');
        /** @type {any} */ let gaps;
        try {
            // sessionReady resolving means the app has a session; auth.currentUser can still be null
            // for a moment while Firebase restores it from IndexedDB. Without this the very first
            // load reports "couldn't check" on a perfectly healthy device — the same restore race
            // the Set up accounts button already handles, and the same shared helper.
            if (!auth.currentUser) await restoreFirstAuthUser();
            gaps = await getAccountSetupGaps();
        } catch (err) {
            if (mine !== asked) return;               // a later check is on its way: it has the last word
            console.warn('[authSetup] account check failed', err);
            gapsEl.removeAttribute('aria-busy');
            renderUnknown('Couldn’t check the accounts — check your connection.');
            return;                                   // report NOTHING: unknown is not "nothing to do"
        }
        if (mine !== asked) return;
        gapsEl.removeAttribute('aria-busy');
        if (gaps && gaps.refused) {
            // The server could see no roster accounts at all and declined to name the whole roster
            // as missing. Say what happened rather than inventing either answer.
            renderUnknown('Couldn’t check the accounts — the account list didn’t load.');
            return;
        }
        // BOTH LISTS, OR NO ANSWER (test audit, 7 Nov 2026). A list that was missing used to default
        // to empty, so a garbled or cut-short reply — `{}` — rendered "Everyone on the roster has a
        // login, and no leaver still has one", which is exactly the line /leaver step 6 reads as proof
        // that a leaver's login is off. The endpoint sends both arrays on every answer, a refusal
        // included, so a reply without them is not a clean result: it is one nobody can read.
        if (!gaps || !Array.isArray(gaps.setUp) || !Array.isArray(gaps.leavers)) {
            renderUnknown('Couldn’t check the accounts — the answer couldn’t be read. Try again.');
            return;                                   // report NOTHING: unknown is not "nothing to do"
        }
        const { setUp, leavers } = gaps;
        gapsEl.textContent = '';
        if (!setUp.length && !leavers.length) {
            const ok = document.createElement('p');
            ok.className = 'auth-gap-ok';
            const tick = document.createElement('span');
            tick.setAttribute('aria-hidden', 'true');
            tick.textContent = '✓';
            ok.append(tick, ' Everyone on the roster has a login, and no leaver still has one.');
            gapsEl.append(ok);
        } else {
            if (setUp.length) {
                /** @param {(g: any) => boolean} pick */
                const namesWhere = (pick) => setUp.filter(pick).map(/** @param {any} g */ g => g.name);
                const resets = namesWhere(g => RESET_BY_SETUP.has(g.why));
                const pressMends = namesWhere(g => !(g.why in REFUSED_BY_SETUP)).length > 0;
                const refusals = Object.entries(REFUSED_BY_SETUP)
                    .map(([why, remedy]) => ({ names: namesWhere(g => g.why === why), remedy }))
                    .filter(r => r.names.length).map(r => r.remedy(listed(r.names)));
                gapsEl.append(gapLine('auth-gap-line',
                    setUp.length === 1 ? 'member is not set up' : 'members are not set up',
                    setUp.map(/** @param {any} g */ g => `${g.name} (${WHY_TEXT[g.why] || g.why})`),
                    [...(pressMends ? ['Press Set up accounts below.'] : []), ...(resets.length ? [resetWarning(resets)] : []), ...refusals]));
            }
            if (leavers.length) {
                gapsEl.append(gapLine('auth-gap-line auth-gap-line--leaver',
                    leavers.length === 1 ? 'leaver can still sign in' : 'leavers can still sign in',
                    leavers,
                    ['Tick the leavers box below, then press Set up accounts.']));
            }
        }
        gapsEl.hidden = false;
        onAttention?.({ setUp: setUp.length, leavers: leavers.length });
    }

    /** Neither "gaps" nor "clean" — and it must not be mistaken for either, here or on the strip. */
    function renderUnknown(/** @type {string} */ message) {
        onWithdraw?.();   // what an earlier answer reported is unknown again (see the JSDoc above)
        if (!gapsEl) return;
        gapsEl.textContent = '';
        const p = document.createElement('p');
        p.className = 'auth-gap-unknown';
        p.textContent = message + ' ';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'auth-gap-retry';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => { retry.disabled = true; loadGaps(); });
        p.append(retry);
        gapsEl.append(p);
        gapsEl.hidden = false;
    }

    sessionReady.then(loadGaps).catch(() => {});   // loadGaps shows its own failures; this only stops an unhandled rejection

    btn.addEventListener('click', async () => {
        /** @type {HTMLButtonElement} */ (btn).disabled    = true;
        btn.textContent = 'Working…';
        resultEl.classList.remove('visible');

        try {
            // sessionReady resolves once operations-app.js confirms the Firebase Auth
            // session. Awaiting it ensures the session is live even if the admin clicks
            // "Set up accounts" before the background sign-in completes.
            await sessionReady;
            // Wait for Firebase Auth to restore its session from IndexedDB before
            // checking currentUser — auth.currentUser is null until the async restore
            // completes, even when a valid session exists. Shared helper (session.js)
            // so this restore stays in lockstep with ensureFirebaseSession's.
            const currentUser = auth.currentUser || await restoreFirstAuthUser();
            if (!currentUser) {
                const authErr = getFirebaseAuthError();
                const code = authErr ? ` (Firebase error: ${authErr})` : '';
                throw new Error(`Firebase Auth session not found${code} — please sign out and sign back in`);
            }
            // forceRefresh:true fetches a fresh token from Firebase so any recent
            // claim changes are included. The token is short-lived and signed by Firebase.
            const tokenResult = await currentUser.getIdTokenResult(/* forceRefresh */ true);
            // The server (setupRosterAuth) requires the admin custom claim on the caller's
            // token — there is NO unauthenticated bootstrap path. If the claim is missing
            // (e.g. accounts were rebuilt) this call WILL be rejected (403); the claim must
            // be restored first, and the Firebase console CANNOT set a custom claim — only the
            // Admin SDK can, so the procedure is RECOVERY_RUNBOOK.md → "Restoring a lost admin
            // claim" (review D2, Nov 2026). Surface that honestly rather than implying a
            // bootstrap is in progress.
            if (!tokenResult.claims.admin) {
                resultEl.innerHTML = '<p class="auth-result-info"><span aria-hidden="true">⚠️</span> Your account is missing the admin claim, which this setup requires — the server will reject this call. The Firebase console cannot restore it: follow “Restoring a lost admin claim” in RECOVERY_RUNBOOK.md, then sign out and back in.</p>';
                resultEl.classList.add('visible');
                return;   // without this, the fetch below 403s and the catch overwrites this guidance with a raw error
            }

            // Body carries ACTION flags only (B4 — server owns the member/role lists). Every LATER
            // call fetches a FRESH ID token — never one captured earlier. The orphan dry-run may be
            // CONFIRMED >1h later (past the Firebase ID-token lifetime), so a confirm that reused a
            // captured token would keep hitting the same expired token and could never recover
            // without a page reload. The FIRST call reuses the token minted just above, a moment ago
            // with forceRefresh — a second forced refresh in series bought nothing (Sep 2026 review).
            /** @type {string|null} */
            let justMinted = tokenResult.token;
            const doSetup = async (/** @type {Record<string, any>} */ extraBody) => {
                const fresh = justMinted
                    ? { token: justMinted }
                    : await currentUser.getIdTokenResult(/* forceRefresh */ true);
                justMinted = null;
                // 130s: above the endpoint's own 120s ceiling (fetch-timeout.js). Provisioning walks
                // the whole roster, so this is legitimately the app's slowest call — the bound is
                // here to end an INFINITE wait, not to make it feel quick.
                let r;
                try {
                    r = await fetchWithTimeout(SETUP_AUTH_URL, {
                        method:  'POST',
                        headers: { 'Authorization': `Bearer ${fresh.token}`, 'Content-Type': 'application/json' },
                        body:    JSON.stringify(extraBody),
                    }, 130_000);
                    // Read INSIDE the try: the body shares the deadline, and a body cut off by it is a timeout too.
                    if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
                    return await r.json();
                } catch (err) {
                    // A WRITE, and a broad one — it creates, disables and re-claims accounts. The
                    // abort stopped us waiting, not the server working, so this must not read as
                    // "nothing happened": re-running it blind could act on a half-finished sweep.
                    // Re-running is in fact safe (the endpoint is idempotent), but the admin should
                    // look first, so the copy says look.
                    if (isFetchTimeout(err)) throw new Error('Timed out waiting for the server — account setup may still be running. Reload and check Account status before running it again.', { cause: err });
                    throw err;
                }
            };

            /** The last preview's labels by uid — what a confirm's `confirmSkipped` uids are named by. @type {Map<string, string>} */
            const previewLabels = new Map();

            /**
             * Render a setupRosterAuth response, wiring the dry-run → confirm step for leaver removal.
             * `afterConfirm` APPENDS beneath the first run's report rather than replacing it (whole-app
             * review, Oct 2026): the confirm used to wipe it, and with it the "reset — tell them"
             * names the admin is the only person able to act on. The re-run's "already existed" list
             * is the whole roster again, so it is left out of the appended part.
             * @param {any} data @param {boolean} [afterConfirm]
             */
            const renderResult = (data, afterConfirm = false) => {
                const { created = [], skipped = [], reclaimed = [], disabled = [], failed = [], demoted = [],
                        orphanSweepFailed = false, orphanDryRun = false, orphansToDisable = [], orphanUids = [],
                        confirmSkipped = [], notPreviewed = [], disabledLeaverPushRemoved = 0 } = data;
                const lines = [];
                if (created.length)  lines.push(`✅ Created (${created.length}): ${created.join(', ')}`);
                if (skipped.length && !afterConfirm) lines.push(`⏭️ Already existed (${skipped.length}): ${skipped.join(', ')}`);
                // An account the server reset to the member's default password and signed out of every
                // session: one it never stamped, taken back from whoever registered it (v24.24), or a
                // DISABLED one it re-enabled — a returning leaver, from whom nothing was taken back. So
                // the line says what happened to the account, which is true of both, and never "taken
                // back" (functions-core, 10 Nov 2026). The admin is the only person who can tell the
                // member, so the names are the point of the line.
                if (reclaimed.length) lines.push(`🔁 Reset to the default password and signed out (${reclaimed.length}): ${reclaimed.join(', ')} — tell them their password is their surname`);
                // A tier taken away (off the admin, manager or Links designer list) is signed out of every device at once,
                // so its old access stops now rather than when the sign-in renews (sign-in audit D3). Their password is
                // untouched, so they sign back in as usual — said, because a member signed out unasked will ask why.
                if (demoted.length)  lines.push(`🔒 Access reduced and signed out of every device (${demoted.length}): ${demoted.join(', ')} — they sign back in with the password they already use`);
                if (disabled.length) lines.push(`🚫 Disabled leavers (${disabled.length}): ${disabled.join(', ')}`);
                // A confirm disables only what the preview named AND is still a leaver (review D1, Nov 2026;
                // `sweepAgainstPreview`, functions/account-lifecycle.js). The two it left alone are named.
                // A server older than that sends neither, and disables every leaver it finds, as before.
                if (confirmSkipped.length) {
                    const named = confirmSkipped.map(/** @param {string} uid */ uid => previewLabels.get(uid) || uid);
                    lines.push(`⏭️ Not disabled — no longer found as a leaver since the preview (${named.length}): ${named.join(', ')}`);
                }
                if (notPreviewed.length) lines.push(`⚠️ Not disabled — not in the preview you confirmed (${notPreviewed.length}): ${notPreviewed.join(', ')} — press Set up accounts again with the leavers box ticked to preview them.`);
                // Leavers disabled on an earlier run whose phones had saved their notification records again (D2).
                if (disabledLeaverPushRemoved > 0) lines.push(`🔕 Notifications switched off on ${disabledLeaverPushRemoved} device${disabledLeaverPushRemoved !== 1 ? 's' : ''} of leavers disabled earlier`);
                if (failed.length)   lines.push(`❌ Failed (${failed.length}): ${failed.join(', ')}`);
                // Leaver-sweep failure is a FLAG on an otherwise-200 response — surface it (v16.23).
                if (orphanSweepFailed) lines.push('⚠️ The leaver check failed — leavers were not disabled. Run Set up accounts again.');
                if (!lines.length && !orphanDryRun) lines.push('Nothing to do — all accounts already up to date.');

                const html = lines.map(l => `<p class="auth-result-line">${escapeHtml(l)}</p>`).join('');
                if (afterConfirm) { document.getElementById('authConfirmOrphans')?.remove(); resultEl.insertAdjacentHTML('beforeend', html); }
                else resultEl.innerHTML = html;

                // B4 dry-run: the server previewed which accounts WOULD be disabled — require an
                // explicit confirm before any account is disabled (no accidental leaver sweeps).
                if (orphanDryRun) {
                    // The uids the confirm sends back, so it disables what is listed here and nothing else. Sent
                    // ALWAYS: a server older than them ignores the field and disables as before, and a preview
                    // from that server confirmed by a newer one sends none — so it disables nobody and says
                    // to preview again, rather than every leaver it finds. Misaligned is treated as none.
                    const aligned = Array.isArray(orphanUids) && orphanUids.length === orphansToDisable.length;
                    previewLabels.clear();
                    if (aligned) orphanUids.forEach(/** @param {any} uid @param {number} i */ (uid, i) => {
                        if (typeof uid === 'string' && uid) previewLabels.set(uid, orphansToDisable[i]);
                    });
                    const previewedUids = [...previewLabels.keys()];
                    if (orphansToDisable.length) {
                        const n = orphansToDisable.length;
                        resultEl.insertAdjacentHTML('beforeend',
                            `<p class="auth-result-line">🔍 <strong>${n}</strong> account${n !== 1 ? 's' : ''} would be disabled as leaver${n !== 1 ? 's' : ''}: ${escapeHtml(orphansToDisable.join(', '))}</p>`
                            + `<button type="button" id="authConfirmOrphans" class="btn-action">Confirm — disable ${n} leaver${n !== 1 ? 's' : ''}</button>`);
                        const confirmBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('authConfirmOrphans'));
                        const confirmLabel = confirmBtn ? confirmBtn.textContent : '';
                        confirmBtn?.addEventListener('click', async () => {
                            confirmBtn.disabled = true;
                            confirmBtn.textContent = 'Disabling…';
                            try {
                                renderResult(await doSetup({ removeOrphans: true, confirmOrphanRemoval: true, confirmUids: previewedUids }), true);
                                loadGaps().catch(() => {});   // the leavers line above should now clear (loadGaps shows its own failures)
                            } catch (e) {
                                // Re-enable so a transient/expired-token failure (the dry-run may be
                                // confirmed >1h later, after the ID token expired) is retryable — don't
                                // strand the button on "Disabling…".
                                resultEl.insertAdjacentHTML('beforeend', `<p class="auth-result-error">❌ ${escapeHtml(/** @type {any} */ (e).message)} — tap Confirm to retry.</p>`);
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = confirmLabel;
                            }
                        });
                    } else if (!orphanSweepFailed) {
                        // Not after a FAILED check (whole-app review, Oct 2026): "none" is not known
                        // then, and the two lines side by side contradicted each other.
                        resultEl.insertAdjacentHTML('beforeend', '<p class="auth-result-line">✓ No leaver accounts to disable.</p>');
                    }
                }
                resultEl.classList.add('visible');
            };

            // First call: provision + (if the checkbox is set) a DRY-RUN leaver preview.
            renderResult(await doSetup({ removeOrphans: /** @type {HTMLInputElement} */ (orphansCb).checked }));
            // Re-audit, so the block above states what is true AFTER the run rather than what was
            // true when the page loaded. Best-effort: the run itself already reported what it did.
            loadGaps().catch(() => {});   // loadGaps shows its own failures; this only stops an unhandled rejection
        } catch (err) {
            resultEl.innerHTML = `<p class="auth-result-error">❌ ${escapeHtml(/** @type {any} */ (err).message)}</p>`;
            resultEl.classList.add('visible');
            console.error('[authSetup]', err);
        } finally {
            /** @type {HTMLButtonElement} */ (btn).disabled    = false;
            btn.textContent = 'Set up accounts';
        }
    });

    return { refresh: () => loadGaps().catch(() => {}) };   // loadGaps shows its own failures; this only stops an unhandled rejection
}
