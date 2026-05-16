/**
 * admin-auth.js — Staff Firebase Auth account setup (admin only).
 *
 * Owns: Staff Login Accounts card — creates/disables Firebase Auth accounts for
 *   all roster members by calling the setupRosterAuth Cloud Function.
 * Does NOT own: login flow (admin-app.js), Firestore auth rules (firestore.rules),
 *   account credential derivation (firebase-client.js nameToEmail / nameToPassword).
 * Edit here for: account setup UI.
 *
 * Auth strategy (v9.87):
 *   - If the logged-in user already has the Firebase Auth admin custom claim, the
 *     request uses their Firebase ID token as the bearer — no secret in the request.
 *   - If the claim is not yet set (first ever run), the ROSTER_SECRET is sent instead.
 *     The Cloud Function sets the admin claim during that call, so all subsequent
 *     calls use the ID token. Once confirmed, ROSTER_SECRET_VALUE can be removed.
 */

import { teamMembers, CONFIG, escapeHtml } from './roster-data.js?v=9.87';
import { auth } from './firebase-client.js?v=9.87';

const SETUP_AUTH_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth';
// Bootstrap fallback — only sent when the admin custom claim is not yet on the account.
// After one successful "Set up accounts" call the claim is set and this is never sent again.
const ROSTER_SECRET_VALUE = 'a7f3d2e1-9b4c-4f8a-b6e5-3c1d0a2f5e8b';

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
            // Prefer Firebase ID token auth if the admin custom claim is already set.
            // forceRefresh:true fetches a fresh token from Firebase, picking up any claim
            // changes (e.g. the admin claim that was just set by the previous call).
            // Falls back to ROSTER_SECRET on first run when the claim is not yet present.
            let authHeader;
            const currentUser = auth.currentUser;
            if (currentUser) {
                const tokenResult = await currentUser.getIdTokenResult(/* forceRefresh */ true);
                if (tokenResult.claims.admin) {
                    authHeader = `Bearer ${tokenResult.token}`;
                }
            }
            if (!authHeader) {
                authHeader = `Bearer ${ROSTER_SECRET_VALUE}`;
            }

            const resp = await fetch(SETUP_AUTH_URL, {
                method:  'POST',
                headers: {
                    'Authorization': authHeader,
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
