/**
 * operations-app.js — Coordinator for operations.html.
 *
 * Owns: session guard (redirect to admin.html if not admin), Firebase Auth
 *   re-establishment, page init wiring for the three operations cards.
 * Does NOT own: Huddle upload logic (huddle.js), roster PDF pipeline
 *   (admin-roster-upload.js), staff auth setup (admin-auth.js).
 * Edit here for: page-level session handling, card order, nav wiring.
 */

import { CONFIG, teamMembers } from './roster-data.js';
import { auth, getAllStaffContacts, getClientErrors, resolveClientError } from './firebase-client.js';
import { initErrorReporter } from './error-reporter.js';
import { loadOverrides } from './admin-overrides.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initAuthSetup } from './admin-auth.js';
import { initNavPanel } from './nav-panel.js';
import { getSession, clearSession, ensureFirebaseSession } from './session.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';

// ============================================
// SESSION — read from localStorage (shared with admin-app.js via session.js)
// ============================================
const currentSession = getSession();
const currentUser    = currentSession?.name ?? null;
const isAdmin        = CONFIG.ADMIN_NAMES.includes(currentUser);

// Guard: must be signed in AND be an admin — redirect otherwise
if (!currentUser || !isAdmin) {
    window.location.replace('./admin.html');
    // Throw to halt module execution immediately — location.replace is async and JS continues otherwise.
    throw new Error('Not authorised — redirecting');
}

// Store as a Promise so admin-auth.js can await it before "Set up accounts"
window._mybSession = ensureFirebaseSession(currentUser);


// ============================================
// PAGE INIT
// ============================================
document.body.classList.add('auth-ready');

// Assigned by the About-lightbox IIFE further down; the closure below only reads
// it when the drawer logo is tapped, by which point it is set.
let openAboutLightbox = null;

initNavPanel({
    currentPage: 'operations',
    memberName:  currentUser,
    isAdmin:         true,
    isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(currentUser),
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   () => { clearSession(); window.location.href = './admin.html'; },
});

initHuddleUpload({ currentIsAdmin: true, currentUser });

initRosterUpload({
    currentUser,
    currentIsAdmin: true,
    parseUrl:   'https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF',
    getIdToken: async () => { await window._mybSession; return auth.currentUser?.getIdToken(); },
    loadOverrides,
});

initAuthSetup({ currentIsAdmin: true });

// ============================================
// COLLAPSIBLE CARD HEADERS
// ============================================
initCardCollapse('huddleToggleHeader',      'huddleBody',      'huddleChevron');
initCardCollapse('rosterUploadToggleHeader','rosterUploadBody','rosterUploadChevron');
initCardCollapse('authSetupToggleHeader',   'authSetupBody',   'authSetupChevron');
initCardCollapse('workEmailToggleHeader',   'workEmailBody',   'workEmailChevron');
initCardCollapse('errorLogToggleHeader',   'errorLogBody',   'errorLogChevron');

// ============================================
// WORK EMAIL PROGRESS
// ============================================
(async function initWorkEmailStatus() {
    // Active front-line staff only — excludes leavers (hidden: true).
    // Management (hidden+managerOnly) are excluded because the password
    // project targets the staff who use the Settings page to add emails.
    const eligible = teamMembers.filter(m => !m.hidden);
    const content  = document.getElementById('emailStatusContent');
    if (!content) return;

    try {
        // Wait for the Firebase Auth session so Firestore rules pass.
        await window._mybSession;
        const contacts   = await getAllStaffContacts();
        const savedNames = new Set(contacts.filter(c => c.workEmail).map(c => c.memberName));

        content.innerHTML = '';

        // Grade filter
        const filterRow = document.createElement('div');
        filterRow.className = 'email-filter-row';
        const filterSelect = document.createElement('select');
        filterSelect.id = 'emailGradeFilter';
        filterSelect.className = 'email-filter-select';
        filterSelect.setAttribute('aria-label', 'Filter by grade');
        [['', 'All grades'], ['CEA', 'CEA'], ['CES', 'CES'], ['Dispatcher', 'Dispatcher']].forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            filterSelect.appendChild(opt);
        });
        filterRow.appendChild(filterSelect);
        content.appendChild(filterRow);

        // Summary and list — re-rendered on grade change
        const summaryEl = document.createElement('p');
        summaryEl.className = 'email-count-summary';
        content.appendChild(summaryEl);

        const listContainer = document.createElement('div');
        content.appendChild(listContainer);

        function renderForGrade(grade) {
            const pool     = grade ? eligible.filter(m => m.role === grade) : eligible;
            const total    = pool.length;
            const added    = pool.filter(m =>  savedNames.has(m.name));
            const notAdded = pool.filter(m => !savedNames.has(m.name));
            const label    = grade || 'staff';

            summaryEl.innerHTML = `<strong class="email-count-num">${added.length}</strong> of <strong>${total}</strong> ${label} have added their work email`;

            listContainer.innerHTML = '';

            // Who has added — the "engaged" list
            if (added.length > 0) {
                const addedLabel = document.createElement('p');
                addedLabel.className = 'email-count-added-label';
                addedLabel.textContent = `Added (${added.length}):`;
                listContainer.appendChild(addedLabel);

                const addedList = document.createElement('div');
                addedList.className = 'email-count-list';
                added.forEach(m => {
                    const chip = document.createElement('span');
                    chip.className = 'email-count-chip email-count-chip--added';
                    chip.textContent = m.name;
                    addedList.appendChild(chip);
                });
                listContainer.appendChild(addedList);
            }

            // Who hasn't yet
            if (notAdded.length === 0) {
                const done = document.createElement('p');
                done.className = 'email-count-done';
                done.textContent = `✓ All ${label} have added their work email${grade ? '' : ' — ready for the next step'}.`;
                listContainer.appendChild(done);
            } else {
                const missingLabel = document.createElement('p');
                missingLabel.className = 'email-count-missing-label';
                missingLabel.textContent = `Still to add (${notAdded.length}):`;
                listContainer.appendChild(missingLabel);

                const list = document.createElement('div');
                list.className = 'email-count-list';
                notAdded.forEach(m => {
                    const chip = document.createElement('span');
                    chip.className = 'email-count-chip';
                    chip.textContent = m.name;
                    list.appendChild(chip);
                });
                listContainer.appendChild(list);
            }
        }

        renderForGrade('');
        filterSelect.addEventListener('change', () => renderForGrade(filterSelect.value));

    } catch (err) {
        content.innerHTML = '<p class="auth-desc" style="color:var(--error-red)">Couldn\'t load email status — check your connection and reload.</p>';
        console.error('[WorkEmailStatus]', err);
    }
})();

// Show a banner if Firebase Auth couldn't establish a real admin session.
// Anonymous fallback still resolves the Promise so the page renders, but
// Cloud Functions and Storage both require a valid admin token — they'll
// reject silently without this warning.
window._mybSession.then(ok => {
    if (!ok || window._mybAuthError) {
        const main   = document.querySelector('.container');
        if (!main) return;
        const banner = document.createElement('p');
        banner.className   = 'ops-auth-warning';
        banner.textContent = 'We couldn\'t confirm your admin sign-in. Please sign out and back in before using these tools.';
        main.prepend(banner);
    }
});

// ============================================
// ICON LIGHTBOX — About panel (shared about-lightbox.js)
// ============================================
(function () {
    const about = initAboutLightbox({
        appLabel: 'MYB Roster Operations',
        bugLinkId: 'opsBugReportLink',
        getUserName: () => currentUser,
    });
    if (about) openAboutLightbox = about.open;

    // Header logo is a back-to-calendar button (About moved to the drawer logo).
    const headerIcon = document.getElementById('appIcon');
    if (!headerIcon) return;
    headerIcon.title = 'Back to calendar';
    headerIcon.setAttribute('aria-label', 'Back to calendar');
    headerIcon.addEventListener('click', () => { window.location.href = './index.html'; });
})();

// ============================================
// TIPS LIGHTBOX — ? button on each card
// Lifecycle, renderer, and button wiring live in tips-lightbox.js — only the
// content data is owned here.
// ============================================
(function () {
    const CARD_TIPS = {
        'daily-huddle': {
            title: 'Daily Huddle',
            sections: [{ items: [
                { icon: '📋', html: 'Upload the day\'s Huddle briefing — staff open it via ☰ → <strong>Daily Huddle</strong> on the main app' },
                { icon: '📄', html: '<strong>PDF</strong> — opens in the browser. <strong>Word (.docx)</strong> — displayed inside the app' },
                { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
                { icon: '🤖', html: 'The Huddle email uploads automatically each day — use this card if you need to upload it manually' },
            ]}],
        },
        'weekly-roster': {
            title: 'Weekly Roster upload',
            sections: [
                { heading: 'How it works', items: [
                    { icon: '1️⃣', html: 'Choose the <strong>roster type</strong> (CEA/Bilingual, CES, or Dispatcher) and the <strong>week ending date</strong> (always a Saturday)' },
                    { icon: '2️⃣', html: 'Choose the PDF roster file and tap <strong>Read roster</strong> — the app reads the shifts (takes ~15 seconds)' },
                    { icon: '3️⃣', html: 'Review each person\'s changes — <strong>Save</strong> or <strong>Skip</strong> each day individually' },
                    { icon: '4️⃣', html: 'Tap <strong>Save changes</strong> to write approved shifts to the roster' },
                ]},
                { heading: 'Conflicts', items: [
                    { icon: '⚠️', html: 'If a day already has a <strong>recorded change</strong> that differs from the PDF, it shows as a conflict — choose which to keep' },
                    { icon: '🔄', html: 'Old roster uploads are replaced automatically — only your manual changes show a warning if the new PDF disagrees' },
                ]},
            ],
        },
        'staff-login': {
            title: 'Staff Login Accounts',
            sections: [{ items: [
                { icon: '🔐', html: 'Creates a secure login for every active staff member so the app knows who is saving changes' },
                { icon: '✅', html: 'Safe to run any time — people who already have an account are skipped, so it won\'t break anything' },
                { icon: '👤', html: 'Run this whenever someone <strong>joins</strong> the roster to give them access' },
                { icon: '🚪', html: 'Tick <strong>"Disable accounts for leavers"</strong> and run it when someone <strong>leaves</strong> — their account is disabled so they can no longer sign in' },
            ]}],
        },
    };

    initTipsLightbox(CARD_TIPS);
})();

// ============================================
// ERROR LOG CARD
// ============================================
(async function initErrorLog() {
    const content = document.getElementById('errorLogContent');
    if (!content) return;

    try {
        await window._mybSession;
        const errors = await getClientErrors();

        content.innerHTML = '';

        if (errors.length === 0) {
            const none = document.createElement('p');
            none.className = 'email-count-done';
            none.textContent = '✓ No errors recorded.';
            content.appendChild(none);
            return;
        }

        errors.forEach(err => {
            const row = document.createElement('div');
            row.className = 'error-row' + (err.resolved ? ' error-row--resolved' : '');

            // Summary line: when · member · page · message
            const summary = document.createElement('div');
            summary.className = 'error-summary';
            const addSpan = (cls, text) => {
                const s = document.createElement('span');
                s.className = cls;
                s.textContent = text;
                summary.appendChild(s);
            };
            addSpan('error-when',    err.timestamp?.toDate ? _relativeTime(err.timestamp.toDate()) : '—');
            addSpan('error-member',  err.memberName ?? '—');
            addSpan('error-page',    err.page ?? '—');
            addSpan('error-version', `v${err.appVersion ?? '—'}`);
            addSpan('error-msg',     err.message ?? '—');
            row.appendChild(summary);

            // Stack trace — collapsed by default
            if (err.stack) {
                const details = document.createElement('details');
                details.className = 'error-stack-details';
                const sum = document.createElement('summary');
                sum.textContent = 'Stack trace';
                const pre = document.createElement('pre');
                pre.className = 'error-stack';
                pre.textContent = err.stack;
                details.appendChild(sum);
                details.appendChild(pre);
                row.appendChild(details);
            }

            // Action buttons
            const actions = document.createElement('div');
            actions.className = 'error-actions';

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-action btn-secondary error-copy-btn';
            copyBtn.textContent = '⎘ Copy for Claude';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(_formatForClaude(err)).then(() => {
                    copyBtn.textContent = '✓ Copied';
                    setTimeout(() => { copyBtn.textContent = '⎘ Copy for Claude'; }, 2000);
                });
            });
            actions.appendChild(copyBtn);

            if (!err.resolved) {
                const resolveBtn = document.createElement('button');
                resolveBtn.className = 'btn-action btn-secondary error-resolve-btn';
                resolveBtn.textContent = '✓ Resolve';
                resolveBtn.addEventListener('click', async () => {
                    resolveBtn.disabled = true;
                    await resolveClientError(err.id);
                    row.classList.add('error-row--resolved');
                    resolveBtn.remove();
                });
                actions.appendChild(resolveBtn);
            }

            row.appendChild(actions);
            content.appendChild(row);
        });

    } catch (e) {
        content.innerHTML = '<p class="auth-desc" style="color:var(--error-red)">Couldn\'t load error log — check your connection and reload.</p>';
        console.error('[ErrorLog]', e);
    }
})();

/** Format a relative time string with the exact time appended, e.g. "3h ago · 22 Jun 14:23". */
function _relativeTime(date) {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    const exact = date.toLocaleString('en-GB', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
    });
    let rel;
    if (secs < 60)    rel = `${secs}s ago`;
    else if (secs < 3600)  rel = `${Math.floor(secs / 60)}m ago`;
    else if (secs < 86400) rel = `${Math.floor(secs / 3600)}h ago`;
    else                   rel = `${Math.floor(secs / 86400)}d ago`;
    return `${rel} · ${exact}`;
}

/** Build the plain-text block that gets pasted into Claude for diagnosis. */
function _formatForClaude(err) {
    const when = err.timestamp?.toDate
        ? err.timestamp.toDate().toLocaleString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : 'unknown';
    return [
        '🐛 App error — please diagnose',
        '',
        `App version: ${err.appVersion ?? '—'}`,
        `Page:        ${err.page ?? '—'}`,
        `Member:      ${err.memberName ?? '—'}`,
        `Time:        ${when}`,
        `Device:      ${err.userAgent ?? '—'}`,
        '',
        `Error: ${err.message ?? '—'}`,
        '',
        err.stack ? `Stack:\n${err.stack}` : '(no stack trace)',
    ].join('\n');
}

// ============================================
registerServiceWorker();
window._mybSession.then(() => initErrorReporter());
