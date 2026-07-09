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

import { CONFIG, escapeHtml, getMembersForGrade } from './roster-data.js';
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

    // Active members: all non-hidden staff plus management/clerk accounts (so everyone who can log in gets an account)
    const ACTIVE_MEMBERS = [
        ...getMembersForGrade('CEA'),
        ...getMembersForGrade('CES'),
        ...getMembersForGrade('Dispatcher'),
        ...getMembersForGrade('Management'),
    ].map(m => /** @type {any} */ (m).name);

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

            const resp = await fetch(SETUP_AUTH_URL, {
                method:  'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResult.token}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    members:        ACTIVE_MEMBERS,
                    adminMembers:   CONFIG.ADMIN_NAMES,
                    managerMembers: CONFIG.MANAGER_NAMES,   // B2: managers get the manager:true claim (write on behalf, not admin)
                    designerMembers: CONFIG.LINKS_DESIGNERS, // H2: designers get the linksDesigner:true claim (gate linkDesigns writes)
                    removeOrphans:  /** @type {HTMLInputElement} */ (orphansCb).checked,
                }),
            });

            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`Server responded ${resp.status}: ${err}`);
            }

            const { created = [], skipped = [], disabled = [], failed = [], orphanSweepFailed = false } = await resp.json();

            const lines = [];
            if (created.length)  lines.push(`✅ Created (${created.length}): ${created.join(', ')}`);
            if (skipped.length)  lines.push(`⏭️ Already existed (${skipped.length}): ${skipped.join(', ')}`);
            if (disabled.length) lines.push(`🚫 Disabled leavers (${disabled.length}): ${disabled.join(', ')}`);
            if (failed.length)   lines.push(`❌ Failed (${failed.length}): ${failed.join(', ')}`);
            // The server reports a leaver-sweep failure as a FLAG on an otherwise-200 response
            // (the accounts above WERE processed) — surface it or the failure is silent (v16.23).
            if (orphanSweepFailed) lines.push('⚠️ The leaver check failed — leavers were NOT disabled. Run Set up accounts again.');
            if (!lines.length)   lines.push('Nothing to do — all accounts already up to date.');

            resultEl.innerHTML = lines.map(l => `<p class="auth-result-line">${escapeHtml(l)}</p>`).join('');
            resultEl.classList.add('visible');
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
