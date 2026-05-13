/**
 * admin-auth.js — Staff Firebase Auth account setup (admin only).
 *
 * Owns: Staff Login Accounts card — creates/disables Firebase Auth accounts for
 *   all roster members by calling the setupRosterAuth Cloud Function.
 * Does NOT own: login flow (admin-app.js), Firestore auth rules (firestore.rules),
 *   account credential derivation (firebase-client.js nameToEmail / nameToPassword).
 * Edit here for: account setup UI, ROSTER_SECRET rotation (known limitation — see CLAUDE.md).
 *
 * ⚠ ROSTER_SECRET is visible in page source — known limitation documented in CLAUDE.md.
 *   Do not rotate without updating this value and redeploying.
 */

import { teamMembers, CONFIG, escapeHtml } from './roster-data.js?v=9.59';

const SETUP_AUTH_URL      = 'https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth';
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
            const resp = await fetch(SETUP_AUTH_URL, {
                method:  'POST',
                headers: {
                    'Authorization': `Bearer ${ROSTER_SECRET_VALUE}`,
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
            resultEl.innerHTML = `<p style="color:var(--error)">❌ ${escapeHtml(err.message)}</p>`;
            resultEl.style.display = 'block';
            console.error('[authSetup]', err);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Set up accounts';
        }
    });
}
