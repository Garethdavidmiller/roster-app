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
import { auth, onAuthStateChanged } from './firebase-client.js';
import { sessionReady } from './session.js';

const SETUP_AUTH_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth';

/**
 * Initialises the Staff Login Accounts setup card (admin only). Call once after
 * authentication resolves.
 * @param {{ currentIsAdmin: boolean }} cfg
 */
export function initAuthSetup({ currentIsAdmin }) {
    if (!currentIsAdmin) return;

    const card      = document.getElementById('authSetupCard');
    const btn       = document.getElementById('authSetupBtn');
    const orphansCb = document.getElementById('authSetupOrphans');
    const resultEl  = document.getElementById('authSetupResult');
    if (!card || !btn || !orphansCb || !resultEl) return;

    card.style.display = '';

    // Collapse is wired centrally in operations-app.js via initCardCollapse.

    // B4: the member + role lists are now SERVER-OWNED (setupRosterAuth reads them from
    // roster-members.json, generated from roster-data.js). The client no longer sends them —
    // it only asks the server to provision and, optionally, to sweep leavers (dry-run first).

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
            // completes, even when a valid session exists.
            const currentUser = await new Promise(resolve => {
                if (auth.currentUser) { resolve(auth.currentUser); return; }
                const unsub = onAuthStateChanged(auth, /** @param {any} user */ user => { unsub(); resolve(user); });
            });
            if (!currentUser) {
                const code = /** @type {any} */ (window)._mybAuthError ? ` (Firebase error: ${/** @type {any} */ (window)._mybAuthError})` : '';
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
                resultEl.innerHTML = '<p class="auth-result-info">⚠️ Your account is missing the admin claim, which this setup requires — the server will reject this call. Set the admin claim in the Firebase console, then sign out and back in.</p>';
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
                const r = await fetch(SETUP_AUTH_URL, {
                    method:  'POST',
                    headers: { 'Authorization': `Bearer ${fresh.token}`, 'Content-Type': 'application/json' },
                    body:    JSON.stringify(extraBody),
                });
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
