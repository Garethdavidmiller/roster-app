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

import { teamMembers, CONFIG, escapeHtml } from './roster-data.js?v=9.91';
import { auth } from './firebase-client.js?v=9.91';

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

    // Collapse toggle
    const header  = document.getElementById('authSetupToggleHeader');
    const body    = document.getElementById('authSetupBody');
    const chevron = document.getElementById('authSetupChevron');
    if (header && body && chevron) {
        header.addEventListener('click', () => {
            const isOpen = body.classList.toggle('open');
            chevron.classList.toggle('open', isOpen);
        });
    }

    // Active members: non-hidden staff + management/clerk accounts (so they get Firebase Auth)
    const ACTIVE_MEMBERS = teamMembers
        .filter(m => (!m.hidden && ['CEA', 'CES', 'Dispatcher'].includes(m.role)) || m.managerOnly)
        .map(m => m.name);

    btn.addEventListener('click', async () => {
        btn.disabled    = true;
        btn.textContent = 'Working…';
        resultEl.style.display = 'none';

        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                throw new Error('Not signed in — please refresh the page and sign in again');
            }
            // forceRefresh:true fetches a fresh token from Firebase so any recent
            // claim changes are included. The token is short-lived and signed by Firebase.
            const tokenResult = await currentUser.getIdTokenResult(/* forceRefresh */ true);
            if (!tokenResult.claims.admin) {
                throw new Error('Admin claim not found — try signing out and back in, then click again');
            }

            const resp = await fetch(SETUP_AUTH_URL, {
                method:  'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResult.token}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    members:       ACTIVE_MEMBERS,
                    adminMembers:  CONFIG.ADMIN_NAMES,
                    removeOrphans: orphansCb.checked,
                }),
            });

            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`Server responded ${resp.status}: ${err}`);
            }

            const { created = [], skipped = [], disabled = [], failed = [] } = await resp.json();

            const lines = [];
            if (created.length)  lines.push(`✅ Created (${created.length}): ${created.join(', ')}`);
            if (skipped.length)  lines.push(`⏭️ Already existed (${skipped.length}): ${skipped.join(', ')}`);
            if (disabled.length) lines.push(`🚫 Disabled leavers (${disabled.length}): ${disabled.join(', ')}`);
            if (failed.length)   lines.push(`❌ Failed (${failed.length}): ${failed.join(', ')}`);
            if (!lines.length)   lines.push('Nothing to do — all accounts already up to date.');

            resultEl.innerHTML = lines.map(l => `<p style="margin:0 0 6px">${escapeHtml(l)}</p>`).join('');
            resultEl.style.display = 'block';
        } catch (err) {
            resultEl.innerHTML = `<p style="color:var(--error-red)">❌ ${escapeHtml(err.message)}</p>`;
            resultEl.style.display = 'block';
            console.error('[authSetup]', err);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Set up accounts';
        }
    });
}
