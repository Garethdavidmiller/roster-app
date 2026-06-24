// @ts-check
/**
 * operations-app.js — Coordinator for operations.html.
 *
 * Owns: session guard (redirect to admin.html if not admin), Firebase Auth
 *   re-establishment, page init wiring for the three operations cards.
 * Does NOT own: Huddle upload logic (huddle.js), roster PDF pipeline
 *   (admin-roster-upload.js), staff auth setup (admin-auth.js).
 * Edit here for: page-level session handling, card order, nav wiring.
 */

import { CONFIG, teamMembers, formatISO, isValidEmail } from './roster-data.js';
import { auth, getAllStaffContacts, saveStaffContact, deleteStaffContact, getClientErrors, resolveClientError, uploadCircular, uploadNewsletter } from './firebase-client.js';
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
initCircularUpload();
initNewsletterUpload();

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
initCardCollapse('huddleToggleHeader',         'huddleBody',         'huddleChevron');
initCardCollapse('circularUploadToggleHeader',    'circularUploadBody',    'circularUploadChevron');
initCardCollapse('newsletterUploadToggleHeader', 'newsletterUploadBody', 'newsletterUploadChevron');
initCardCollapse('rosterUploadToggleHeader',   'rosterUploadBody',   'rosterUploadChevron');
initCardCollapse('authSetupToggleHeader',   'authSetupBody',   'authSetupChevron');
initCardCollapse('workEmailToggleHeader',   'workEmailBody',   'workEmailChevron');
initCardCollapse('errorLogToggleHeader',   'errorLogBody',   'errorLogChevron');

// ============================================
// WORK EMAIL PROGRESS
// ============================================
(async function initWorkEmailStatus() {
    // All active accounts — excludes leavers (hidden:true without managerOnly).
    // Management accounts (hidden:true + managerOnly:true) are included: the admin
    // sets their emails here since they have no Settings page of their own.
    const eligible = teamMembers.filter(m => !m.hidden || m.managerOnly);
    const content  = document.getElementById('emailStatusContent');
    if (!content) return;

    try {
        // Wait for the Firebase Auth session so Firestore rules pass.
        await window._mybSession;
        const contacts = await getAllStaffContacts();

        // Mutable maps — updated in-place after an admin saves an email.
        const emailMap   = new Map(contacts.filter(c => c.workEmail).map(c => [c.memberName, c.workEmail]));
        const savedNames = new Set(emailMap.keys());

        content.innerHTML = '';

        // Grade filter
        const filterRow = document.createElement('div');
        filterRow.className = 'email-filter-row';
        const filterSelect = document.createElement('select');
        filterSelect.id = 'emailGradeFilter';
        filterSelect.className = 'email-filter-select';
        filterSelect.setAttribute('aria-label', 'Filter by grade');
        [['', 'All grades'], ['CEA', 'CEA'], ['CES', 'CES'], ['Dispatcher', 'Dispatcher'], ['Management', 'Management']].forEach(([val, lbl]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = lbl;
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
            const gradeLabel = grade || 'staff';

            summaryEl.innerHTML = `<strong class="email-count-num">${added.length}</strong> of <strong>${total}</strong> ${gradeLabel} have added their work email`;

            listContainer.innerHTML = '';

            // Who has added — show name + email for easy verification
            if (added.length > 0) {
                const addedLabel = document.createElement('p');
                addedLabel.className = 'email-count-added-label';
                addedLabel.textContent = `Added (${added.length}):`;
                listContainer.appendChild(addedLabel);

                const addedList = document.createElement('div');
                addedList.className = 'email-count-list email-count-list--added';
                added.forEach(m => {
                    const rowEl = document.createElement('div');
                    rowEl.className = 'email-added-row';

                    const chip = document.createElement('span');
                    chip.className = 'email-count-chip email-count-chip--added';
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'email-chip-name';
                    nameSpan.textContent = m.name;
                    const emailSpan = document.createElement('span');
                    emailSpan.className = 'email-chip-email';
                    emailSpan.textContent = emailMap.get(m.name) || '';
                    chip.appendChild(nameSpan);
                    chip.appendChild(emailSpan);

                    const editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'email-set-btn';
                    editBtn.textContent = 'Edit';
                    editBtn.setAttribute('aria-label', `Edit email for ${m.name}`);

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.className = 'email-set-btn email-set-btn--remove';
                    removeBtn.textContent = 'Remove';
                    removeBtn.setAttribute('aria-label', `Remove email for ${m.name}`);

                    rowEl.appendChild(chip);
                    rowEl.appendChild(editBtn);
                    rowEl.appendChild(removeBtn);
                    addedList.appendChild(rowEl);

                    editBtn.addEventListener('click', () => {
                        // Check this row's state BEFORE the close-others loop so the
                        // loop's reset of editBtn.textContent to 'Edit' doesn't make
                        // the subsequent check always false (Cancel → Edit → not Cancel → opens form again).
                        if (editBtn.textContent === 'Cancel') {
                            editBtn.textContent = 'Edit';
                            rowEl.nextElementSibling?.classList.contains('email-set-form')
                                && rowEl.nextElementSibling.remove();
                            return;
                        }
                        // Close any other open edit form in the list
                        addedList.querySelectorAll('.email-set-form').forEach(f => {
                            const prevRow = f.previousElementSibling;
                            f.remove();
                            prevRow?.querySelector('.email-set-btn')?.textContent === 'Cancel'
                                && (prevRow.querySelector('.email-set-btn').textContent = 'Edit');
                        });
                        editBtn.textContent = 'Cancel';

                        const form = document.createElement('div');
                        form.className = 'email-set-form';
                        form.setAttribute('role', 'group');
                        form.setAttribute('aria-label', `Edit email for ${m.name}`);

                        const input = document.createElement('input');
                        input.type = 'email';
                        input.className = 'email-set-input';
                        input.placeholder = 'firstname.surname';
                        input.autocomplete = 'off';
                        input.autocapitalize = 'off';
                        input.spellcheck = false;
                        input.value = emailMap.get(m.name) || '';
                        input.setAttribute('aria-label', `Work email address for ${m.name}`);
                        input.enterKeyHint = 'done';
                        input.addEventListener('blur', () => {
                            const v = input.value.trim();
                            if (v && !v.includes('@')) input.value = v + '@chilternrailways.co.uk';
                        });

                        const saveBtn = document.createElement('button');
                        saveBtn.type = 'button';
                        saveBtn.className = 'email-set-save';
                        saveBtn.textContent = 'Save';

                        const errorEl = document.createElement('span');
                        errorEl.className = 'email-set-error';
                        errorEl.setAttribute('role', 'alert');
                        errorEl.setAttribute('aria-live', 'polite');

                        form.appendChild(input);
                        form.appendChild(saveBtn);
                        form.appendChild(errorEl);
                        rowEl.after(form);
                        input.select();

                        saveBtn.addEventListener('click', async () => {
                            const rawVal = input.value.trim();
                            if (rawVal && !rawVal.includes('@')) input.value = rawVal + '@chilternrailways.co.uk';
                            const email = input.value.trim();
                            if (!isValidEmail(email)) {
                                errorEl.textContent = 'Please enter a valid email address';
                                input.focus();
                                return;
                            }
                            saveBtn.disabled = true;
                            saveBtn.textContent = 'Saving…';
                            errorEl.textContent = '';
                            try {
                                await saveStaffContact(m.name, email);
                                emailMap.set(m.name, email);
                                renderForGrade(filterSelect.value);
                                filterSelect.focus();
                            } catch (e) {
                                console.error('[WorkEmailStatus] edit failed', e);
                                errorEl.textContent = 'Couldn\'t save — check your connection and try again';
                                saveBtn.disabled = false;
                                saveBtn.textContent = 'Save';
                            }
                        });

                        input.addEventListener('keydown', e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
                            if (e.key === 'Escape') { form.remove(); editBtn.textContent = 'Edit'; }
                        });
                    });

                    removeBtn.addEventListener('click', async () => {
                        if (removeBtn.dataset.confirm !== 'pending') {
                            removeBtn.dataset.confirm = 'pending';
                            removeBtn.textContent = 'Confirm?';
                            setTimeout(() => {
                                if (removeBtn.dataset.confirm === 'pending') {
                                    removeBtn.dataset.confirm = '';
                                    removeBtn.textContent = 'Remove';
                                }
                            }, 3000);
                            return;
                        }
                        removeBtn.disabled = true;
                        removeBtn.textContent = 'Removing…';
                        try {
                            await deleteStaffContact(m.name);
                            emailMap.delete(m.name);
                            savedNames.delete(m.name);
                            renderForGrade(filterSelect.value);
                            filterSelect.focus();
                        } catch (e) {
                            console.error('[WorkEmailStatus] remove failed', e);
                            removeBtn.disabled = false;
                            removeBtn.dataset.confirm = '';
                            removeBtn.textContent = 'Remove';
                        }
                    });
                });
                listContainer.appendChild(addedList);
            }

            // Who hasn't yet — each row has a "Set email" button for admin entry
            if (notAdded.length === 0) {
                const done = document.createElement('p');
                done.className = 'email-count-done';
                done.textContent = `✓ All ${gradeLabel} have added their work email${grade ? '' : ' — ready for the next step'}.`;
                listContainer.appendChild(done);
            } else {
                const missingLabel = document.createElement('p');
                missingLabel.className = 'email-count-missing-label';
                missingLabel.textContent = `Still to add (${notAdded.length}):`;
                listContainer.appendChild(missingLabel);

                const list = document.createElement('div');
                list.className = 'email-count-list email-count-list--missing';

                notAdded.forEach(m => {
                    const rowEl = document.createElement('div');
                    rowEl.className = 'email-missing-row';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'email-count-chip';
                    nameSpan.textContent = m.name;

                    const setBtn = document.createElement('button');
                    setBtn.type = 'button';
                    setBtn.className = 'email-set-btn';
                    setBtn.textContent = 'Set email';
                    setBtn.setAttribute('aria-label', `Set work email for ${m.name}`);
                    setBtn.dataset.member = m.name;

                    rowEl.appendChild(nameSpan);
                    rowEl.appendChild(setBtn);
                    list.appendChild(rowEl);

                    setBtn.addEventListener('click', () => {
                        // Toggle: if this row's form is already open, close it
                        const existing = rowEl.nextElementSibling?.classList.contains('email-set-form')
                            ? rowEl.nextElementSibling : null;
                        if (existing) {
                            existing.remove();
                            setBtn.textContent = 'Set email';
                            return;
                        }

                        // Close any other open form in the list first
                        list.querySelectorAll('.email-set-form').forEach(f => {
                            const prevRow = f.previousElementSibling;
                            f.remove();
                            const btn = prevRow?.querySelector('.email-set-btn');
                            if (btn) btn.textContent = 'Set email';
                        });

                        setBtn.textContent = 'Cancel';

                        const form = document.createElement('div');
                        form.className = 'email-set-form';
                        form.setAttribute('role', 'group');
                        form.setAttribute('aria-label', `Set email for ${m.name}`);

                        const input = document.createElement('input');
                        input.type = 'email';
                        input.className = 'email-set-input';
                        input.placeholder = 'firstname.surname';
                        input.autocomplete = 'off';
                        input.autocapitalize = 'off';
                        input.spellcheck = false;
                        input.setAttribute('aria-label', `Work email address for ${m.name}`);
                        input.enterKeyHint = 'done';
                        input.addEventListener('blur', () => {
                            const v = input.value.trim();
                            if (v && !v.includes('@')) input.value = v + '@chilternrailways.co.uk';
                        });

                        const saveBtn = document.createElement('button');
                        saveBtn.type = 'button';
                        saveBtn.className = 'email-set-save';
                        saveBtn.textContent = 'Save';

                        const errorEl = document.createElement('span');
                        errorEl.className = 'email-set-error';
                        errorEl.setAttribute('role', 'alert');
                        errorEl.setAttribute('aria-live', 'polite');

                        form.appendChild(input);
                        form.appendChild(saveBtn);
                        form.appendChild(errorEl);
                        rowEl.after(form);
                        input.focus();

                        saveBtn.addEventListener('click', async () => {
                            const rawVal = input.value.trim();
                            if (rawVal && !rawVal.includes('@')) input.value = rawVal + '@chilternrailways.co.uk';
                            const email = input.value.trim();
                            if (!isValidEmail(email)) {
                                errorEl.textContent = 'Please enter a valid email address';
                                input.focus();
                                return;
                            }
                            saveBtn.disabled = true;
                            saveBtn.textContent = 'Saving…';
                            errorEl.textContent = '';
                            try {
                                await saveStaffContact(m.name, email);
                                emailMap.set(m.name, email);
                                savedNames.add(m.name);
                                renderForGrade(filterSelect.value);
                                // The saved member moved to "Added" chips — no set-email button
                                // remains. Return focus to the grade filter so the user can continue.
                                filterSelect.focus();
                            } catch (e) {
                                console.error('[WorkEmailStatus] save failed', e);
                                errorEl.textContent = 'Couldn\'t save — check your connection and try again';
                                saveBtn.disabled = false;
                                saveBtn.textContent = 'Save';
                            }
                        });

                        input.addEventListener('keydown', e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
                            if (e.key === 'Escape') {
                                form.remove();
                                setBtn.textContent = 'Set email';
                            }
                        });
                    });
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
// MARYLEBONE NEWSLETTER UPLOAD
// ============================================
function initNewsletterUpload() {
    const dateInput = document.getElementById('newsletterDate');
    const fileInput = document.getElementById('newsletterFileInput');
    const fileLabel = document.getElementById('newsletterFileName');
    const uploadBtn = document.getElementById('newsletterUploadBtn');
    const feedback  = document.getElementById('newsletterFeedback');
    if (!dateInput || !fileInput || !uploadBtn) return;

    dateInput.value = formatISO(new Date());
    dateInput.max   = formatISO(new Date());

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';
        if (!file) {
            fileLabel.classList.remove('visible');
            uploadBtn.disabled = true;
            return;
        }
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            fileLabel.classList.remove('visible');
            uploadBtn.disabled = true;
            feedback.textContent = 'Please choose a PDF file';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            fileLabel.classList.remove('visible');
            uploadBtn.disabled = true;
            feedback.textContent = 'File too large — maximum 20 MB';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        fileLabel.textContent = file.name;
        fileLabel.classList.add('visible');
        uploadBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', async () => {
        const date = dateInput.value;
        const file = fileInput.files[0];
        if (!date || !file) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading…';
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';
        try {
            if (window._mybSession) await window._mybSession;
            await uploadNewsletter(date, file, currentUser);
            feedback.textContent = `Newsletter uploaded for ${date} — staff can open it from ☰ → Marylebone Newsletter`;
            feedback.className = 'huddle-feedback huddle-feedback--ok';
            fileInput.value = '';
            fileLabel.textContent = '';
            fileLabel.classList.remove('visible');
        } catch (err) {
            console.error('[Newsletter] Upload failed:', err);
            feedback.textContent = 'Upload failed — please try again';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            uploadBtn.disabled = false;
        } finally {
            uploadBtn.textContent = 'Upload Newsletter';
        }
    });
}

// ============================================
// WEEKLY RETAIL CIRCULAR UPLOAD
// ============================================
function initCircularUpload() {
    const dateInput = document.getElementById('circularDate');
    const fileInput = document.getElementById('circularFileInput');
    const fileLabel = document.getElementById('circularFileName');
    const uploadBtn = document.getElementById('circularUploadBtn');
    const feedback  = document.getElementById('circularFeedback');
    if (!dateInput || !fileInput || !uploadBtn) return;

    dateInput.value = formatISO(new Date());
    dateInput.max   = formatISO(new Date());

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';
        if (!file) {
            fileLabel.classList.remove('visible');
            uploadBtn.disabled = true;
            return;
        }
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            fileLabel.classList.remove('visible');
            uploadBtn.disabled = true;
            feedback.textContent = 'Please choose a PDF file';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            fileLabel.classList.remove('visible');
            uploadBtn.disabled = true;
            feedback.textContent = 'File too large — maximum 20 MB';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        fileLabel.textContent = file.name;
        fileLabel.classList.add('visible');
        uploadBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', async () => {
        const date = dateInput.value;
        const file = fileInput.files[0];
        if (!date || !file) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading…';
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';
        try {
            if (window._mybSession) await window._mybSession;
            await uploadCircular(date, file, currentUser);
            feedback.textContent = `Circular uploaded for ${date} — staff can open it from ☰ → Weekly Retail Circular`;
            feedback.className = 'huddle-feedback huddle-feedback--ok';
            fileInput.value = '';
            fileLabel.textContent = '';
            fileLabel.classList.remove('visible');
        } catch (err) {
            console.error('[Circular] Upload failed:', err);
            feedback.textContent = 'Upload failed — please try again';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            uploadBtn.disabled = false;
        } finally {
            uploadBtn.textContent = 'Upload Circular';
        }
    });
}

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
        'weekly-circular': {
            title: 'Weekly Retail Circular',
            sections: [{ items: [
                { icon: '📰', html: 'Upload the weekly Retail Circular PDF — staff open it from <strong>☰ → Weekly Retail Circular</strong>' },
                { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
                { icon: '📅', html: 'Set the date to the week the circular covers — usually the Friday it was issued' },
                { icon: '🤖', html: 'In a future update this will upload automatically, like the Huddle' },
            ]}],
        },
        'newsletter': {
            title: 'Marylebone Newsletter',
            sections: [{ items: [
                { icon: '🗞️', html: 'Upload the latest Marylebone Newsletter PDF — staff open it from <strong>☰ → Marylebone Newsletter</strong>' },
                { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
                { icon: '📅', html: 'Set the date to the issue date of the newsletter' },
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
        'work-email-progress': {
            title: 'Work Email Progress',
            sections: [
                { heading: 'What it\'s for', items: [
                    { icon: '🔑', html: 'Staff save their work email to enable <strong>password recovery</strong> in a future update — nothing uses it right now. It\'s Stage 1 of the password security project.' },
                    { icon: '🔒', html: 'Each person can only see their <strong>own email</strong>. As admin you can see all of them.' },
                ]},
                { heading: 'How it works', items: [
                    { icon: '⚙️', html: 'CEA, CES, and Dispatcher staff can add their own email in ☰ → <strong>Settings → Work Email</strong> — the easiest way to get them to register' },
                    { icon: '📝', html: 'You can enter an email on behalf of any staff member using the <strong>Set email</strong> button next to their name — useful if they\'re having trouble or their phone is unavailable' },
                    { icon: '🔑', html: '<strong>Management accounts</strong> aren\'t in the Settings sign-in dropdown, so they can\'t sign in directly through Settings — use the <strong>Set email</strong> button on their behalf, or have them sign in via Admin first' },
                    { icon: '✅', html: 'Green chips at the top show who has registered. Use the <strong>All / CEA / CES / Dispatcher / Management</strong> filter to track each grade.' },
                ]},
            ],
        },
        'error-log': {
            title: 'Error Log',
            sections: [
                { heading: 'What it captures', items: [
                    { icon: '🐛', html: 'Uncaught JS errors from <strong>any authenticated page</strong> (admin, pay calculator, operations, settings) — across all users\' sessions, not just yours' },
                    { icon: '⎘', html: 'Tap <strong>⎘ Copy</strong> on any error to copy all details (message, page, app version, browser) formatted for diagnosis' },
                ]},
                { heading: 'Resolving errors', items: [
                    { icon: '✓', html: 'Tapping <strong>Resolve</strong> marks an error as reviewed and hides it from the active list — it is <strong>not deleted immediately</strong>, just archived for 90 days then pruned automatically' },
                    { icon: '🔄', html: 'You don\'t need to manually clean up the log — resolved errors expire on their own' },
                ]},
                { heading: 'What to act on', items: [
                    { icon: '⚠️', html: '<strong>Worth investigating:</strong> the same error from multiple people, or new errors appearing after a deployment' },
                    { icon: '🔕', html: '<strong>Usually safe to resolve:</strong> isolated one-off errors, cross-origin/extension errors (no page or version shown), brief network failures' },
                ]},
            ],
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
                }).catch(() => {
                    copyBtn.textContent = '✗ Copy failed';
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
                    try {
                        await resolveClientError(err.id);
                        row.classList.add('error-row--resolved');
                        resolveBtn.remove();
                    } catch {
                        resolveBtn.disabled = false;
                        resolveBtn.textContent = '✗ Failed — tap to retry';
                        setTimeout(() => { resolveBtn.textContent = '✓ Resolve'; }, 3000);
                    }
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
