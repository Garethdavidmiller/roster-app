// @ts-check
/**
 * admin-auth.js — Staff Firebase Auth account setup (admin only).
 *
 * Owns: Staff Login Accounts card — creates/disables Firebase Auth accounts for
 *   all roster members by calling the setupRosterAuth Cloud Function.
 * Does NOT own: login flow (admin-app.js), Firestore auth rules (firestore.rules),
 *   account credential derivation (firebase-client.js nameToEmail / nameToPassword).
 * Edit here for: account setup UI.
 *
 * Auth: Firebase ID token with admin custom claim (set by setupRosterAuth on first run).
 * No hardcoded secret — the request uses a short-lived signed JWT from Firebase Auth.
 */

import { escapeHtml } from './roster-data.js';
import { auth, getAccountSetupGaps } from './firebase-client.js';
import { sessionReady, getFirebaseAuthError, restoreFirstAuthUser } from './session.js';
import { fetchWithTimeout, isFetchTimeout } from './fetch-timeout.js';

const SETUP_AUTH_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth';

/**
 * Initialises the Staff Login Accounts setup card (admin only). Call once after
 * authentication resolves.
 * @param {{ currentIsAdmin: boolean,
 *           onAttention?: (counts: { setUp: number, leavers: number }) => void }} cfg
 *        `onAttention` is called ONLY when the audit actually answered — a failed or refused check
 *        reports nothing, because the strip it feeds treats an unreported item as UNKNOWN and an
 *        absent one as "nothing to do". Those must not be the same thing here.
 */
export function initAuthSetup({ currentIsAdmin, onAttention }) {
    if (!currentIsAdmin) return;

    const card      = document.getElementById('authSetupCard');
    const btn       = document.getElementById('authSetupBtn');
    const orphansCb = document.getElementById('authSetupOrphans');
    const resultEl  = document.getElementById('authSetupResult');
    const gapsEl    = document.getElementById('authSetupGaps');
    if (!card || !btn || !orphansCb || !resultEl) return;

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
    const WHY_TEXT = /** @type {Record<string, string>} */ ({
        'no-account': 'no account',
        'disabled':   'account disabled',
        'claims':     'wrong permissions',
    });

    /** One line: a count, the names behind it, and the button that fixes them. */
    function gapLine(/** @type {string} */ cls, /** @type {string} */ lead,
                     /** @type {string[]} */ names, /** @type {string} */ fix) {
        const p = document.createElement('p');
        p.className = `auth-gap-line ${cls}`;
        const strong = document.createElement('strong');
        strong.textContent = String(names.length);
        p.append(strong, ` ${lead} — ${names.join(', ')}`);
        const fixEl = document.createElement('span');
        fixEl.className = 'auth-gap-fix';
        fixEl.textContent = fix;
        p.append(fixEl);
        return p;
    }

    async function loadGaps() {
        if (!gapsEl) return;
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
            console.warn('[authSetup] account check failed', err);
            gapsEl.removeAttribute('aria-busy');
            renderUnknown('Couldn’t check the accounts — check your connection.');
            return;                                   // report NOTHING: unknown is not "nothing to do"
        }
        gapsEl.removeAttribute('aria-busy');
        if (gaps && gaps.refused) {
            // The server could see no roster accounts at all and declined to name the whole roster
            // as missing. Say what happened rather than inventing either answer.
            renderUnknown('Couldn’t check the accounts — the account list didn’t load.');
            return;
        }
        const setUp   = Array.isArray(gaps && gaps.setUp)   ? gaps.setUp   : [];
        const leavers = Array.isArray(gaps && gaps.leavers) ? gaps.leavers : [];
        gapsEl.textContent = '';
        if (!setUp.length && !leavers.length) {
            const ok = document.createElement('p');
            ok.className = 'auth-gap-ok';
            const tick = document.createElement('span');
            tick.setAttribute('aria-hidden', 'true');
            tick.textContent = '✓';
            ok.append(tick, ' Everyone on the roster has a login, and no leaver still has one.');
            gapsEl.append(ok);
            gapsEl.classList.remove('auth-gaps--warn');
        } else {
            if (setUp.length) {
                gapsEl.append(gapLine('auth-gap-line--setup',
                    setUp.length === 1 ? 'member is not set up' : 'members are not set up',
                    setUp.map(/** @param {any} g */ g => `${g.name} (${WHY_TEXT[g.why] || g.why})`),
                    'Press Set up accounts below.'));
            }
            if (leavers.length) {
                gapsEl.append(gapLine('auth-gap-line--leaver',
                    leavers.length === 1 ? 'leaver can still sign in' : 'leavers can still sign in',
                    leavers,
                    'Tick the leavers box below, then press Set up accounts.'));
            }
            gapsEl.classList.add('auth-gaps--warn');
        }
        gapsEl.hidden = false;
        onAttention?.({ setUp: setUp.length, leavers: leavers.length });
    }

    /** Neither "gaps" nor "clean" — and it must not be mistaken for either. */
    function renderUnknown(/** @type {string} */ message) {
        if (!gapsEl) return;
        gapsEl.textContent = '';
        gapsEl.classList.remove('auth-gaps--warn');
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

    sessionReady.then(loadGaps).catch(() => {});

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
            // be restored in the Firebase console first. Surface that honestly rather than
            // implying a bootstrap is in progress.
            if (!tokenResult.claims.admin) {
                resultEl.innerHTML = '<p class="auth-result-info"><span aria-hidden="true">⚠️</span> Your account is missing the admin claim, which this setup requires — the server will reject this call. Set the admin claim in the Firebase console, then sign out and back in.</p>';
                resultEl.classList.add('visible');
                return;   // without this, the fetch below 403s and the catch overwrites this guidance with a raw error
            }

            // Body carries ACTION flags only (B4 — server owns the member/role lists). Fetches a
            // FRESH ID token on EVERY call — never reuses a token captured once. The orphan dry-run
            // may be CONFIRMED >1h later (past the Firebase ID-token lifetime), so a retry that reused
            // the captured token would keep hitting the same expired token and could never recover
            // without a page reload. forceRefresh:true mints a current, non-expired token each time.
            const doSetup = async (/** @type {Record<string, any>} */ extraBody) => {
                const fresh = await currentUser.getIdTokenResult(/* forceRefresh */ true);
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
                } catch (err) {
                    // A WRITE, and a broad one — it creates, disables and re-claims accounts. The
                    // abort stopped us waiting, not the server working, so this must not read as
                    // "nothing happened": re-running it blind could act on a half-finished sweep.
                    // Re-running is in fact safe (the endpoint is idempotent), but the admin should
                    // look first, so the copy says look.
                    if (isFetchTimeout(err)) throw new Error('Timed out waiting for the server — account setup may still be running. Reload and check Account status before running it again.', { cause: err });
                    throw err;
                }
                if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
                return r.json();
            };

            /** Render a setupRosterAuth response, wiring the dry-run → confirm step for leaver removal. */
            const renderResult = (/** @type {any} */ data) => {
                const { created = [], skipped = [], disabled = [], failed = [],
                        orphanSweepFailed = false, orphanDryRun = false, orphansToDisable = [] } = data;
                const lines = [];
                if (created.length)  lines.push(`✅ Created (${created.length}): ${created.join(', ')}`);
                if (skipped.length)  lines.push(`⏭️ Already existed (${skipped.length}): ${skipped.join(', ')}`);
                if (disabled.length) lines.push(`🚫 Disabled leavers (${disabled.length}): ${disabled.join(', ')}`);
                if (failed.length)   lines.push(`❌ Failed (${failed.length}): ${failed.join(', ')}`);
                // Leaver-sweep failure is a FLAG on an otherwise-200 response — surface it (v16.23).
                if (orphanSweepFailed) lines.push('⚠️ The leaver check failed — leavers were not disabled. Run Set up accounts again.');
                if (!lines.length && !orphanDryRun) lines.push('Nothing to do — all accounts already up to date.');

                resultEl.innerHTML = lines.map(l => `<p class="auth-result-line">${escapeHtml(l)}</p>`).join('');

                // B4 dry-run: the server previewed which accounts WOULD be disabled — require an
                // explicit confirm before any account is disabled (no accidental leaver sweeps).
                if (orphanDryRun) {
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
                                renderResult(await doSetup({ removeOrphans: true, confirmOrphanRemoval: true }));
                                loadGaps().catch(() => {});   // the leavers line above should now clear
                            } catch (e) {
                                // Re-enable so a transient/expired-token failure (the dry-run may be
                                // confirmed >1h later, after the ID token expired) is retryable — don't
                                // strand the button on "Disabling…".
                                resultEl.insertAdjacentHTML('beforeend', `<p class="auth-result-error">❌ ${escapeHtml(/** @type {any} */ (e).message)} — tap Confirm to retry.</p>`);
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = confirmLabel;
                            }
                        });
                    } else {
                        resultEl.insertAdjacentHTML('beforeend', '<p class="auth-result-line">✓ No leaver accounts to disable.</p>');
                    }
                }
                resultEl.classList.add('visible');
            };

            // First call: provision + (if the checkbox is set) a DRY-RUN leaver preview.
            renderResult(await doSetup({ removeOrphans: /** @type {HTMLInputElement} */ (orphansCb).checked }));
            // Re-audit, so the block above states what is true AFTER the run rather than what was
            // true when the page loaded. Best-effort: the run itself already reported what it did.
            loadGaps().catch(() => {});
        } catch (err) {
            resultEl.innerHTML = `<p class="auth-result-error">❌ ${escapeHtml(/** @type {any} */ (err).message)}</p>`;
            resultEl.classList.add('visible');
            console.error('[authSetup]', err);
        } finally {
            /** @type {HTMLButtonElement} */ (btn).disabled    = false;
            btn.textContent = 'Set up accounts';
        }
    });
}
