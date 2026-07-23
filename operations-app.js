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

import { CONFIG, teamMembers, isValidEmail, isChilternWorkEmail } from './roster-data.js';
import { auth, getAllStaffContacts, saveStaffContact, deleteStaffContact, getAllPasswordStatus, resetMemberPassword, uploadCircular, uploadNewsletter, withClaimRetry } from './firebase-client.js';
import { initErrorLog, initUsageCard, initPageSpeedCard, _cardLoadError } from './operations-reports.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import { loadOverrides } from './admin-overrides.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';
import { initAuthSetup } from './admin-auth.js';
import { initDatePickers } from './date-picker.js';
import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, clearSession, ensureNamedSession, sessionReady, resolveSession, getFirebaseAuthError, reconcileExpiredIdentity } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initCardCollapse, confirmDialog } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';



/**
 * Phase 4a.2 (ARCHITECTURE_PLAN.md): the coordinator body is an exported init()
 * called by operations-boot.js (a 2-line bootstrap — CSP `script-src 'self'`
 * blocks inline module scripts). This replaces the former top-level `throw`s
 * (which aborted module evaluation on the login/forbidden paths) with explicit
 * early `return`s, and lets a test import this module WITHOUT auto-running it.
 * Body unchanged otherwise — same statements, same order, one indent level in.
 */
export function init() {
    // Register the service worker UNCONDITIONALLY, before the access gate — a signed-out (or
    // non-admin) visit returns early below and would otherwise never register/update the SW for
    // that page load. Matches settings-app.js (module-scope registration). (v16.21)
    // Defer an SW-update reload while an admin is mid-way through a Weekly Roster Upload REVIEW —
    // the one piece of unsaved, in-flight work on this page (uncommitted review edits would be lost
    // on a reload). #rosterReviewSection carries `.visible` only while a review table is on screen;
    // otherwise reload immediately. Mirrors admin-app.js's hasUnsavedChanges guard. (v18.29)
    registerServiceWorker({
        beforeReload() {
            const reviewing = document.getElementById('rosterReviewSection')?.classList.contains('visible');
            if (!reviewing) { window.location.reload(); return; }
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') window.location.reload();
            }, { once: true });
        },
    });
    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Fire-and-forget, login-safe: no-op on a valid session, stands down if a login supersedes it.
    reconcileExpiredIdentity().catch(() => {});
    // ============================================
    // SESSION — read from localStorage (shared with admin-app.js via session.js)
    // ============================================
    const currentSession = getSession();
    const currentUser    = currentSession?.name ?? null;

    // Page-access decision via the Phase-3 policy (auth-policy.js → ARCHITECTURE_PLAN.md Phase 4a).
    // The "local-derived" snapshot maps the localStorage session to an identity status — present →
    // 'named' (today's optimistic fast render from local), absent → 'signedOut' — and requirePage
    // applies the Operations policy (admin-only). Behaviour is identical to the prior two-gate form;
    // this routes the same decision through the shared authz layer instead of inline checks.
    const _access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'operations');
    if (_access.decision === 'login') {
        // Not signed in → show the shared in-place sign-in (no redirect). On success:
        //  • INPLACE_LOGIN off (default) → reload; the reloaded page re-checks access (today's path).
        //    resolveSession(false) fulfils sessionReady on this non-auth load.
        //  • INPLACE_LOGIN on → re-invoke init() in place: the authorised body below never ran on this
        //    pass (we return now), so re-entering runs it exactly ONCE with the just-saved session —
        //    no reload, no double-wiring. Do NOT resolveSession(false) here, or the one-shot
        //    sessionReady would be poisoned before the in-place pass can resolve it true.
        // In-place re-invocation falls back to a reload if init() throws mid-wiring, so the in-place
        // path is never less robust than the reload path (the overlay is already torn down by then).
        const onSuccess = CONFIG.INPLACE_LOGIN.operations
            // If saveSession silently failed (iOS private mode — lsSet swallows the error), getSession()
            // is still null, so re-invoking init() would re-enter the 'login' branch where
            // initLoginOverlay no-ops (overlay already mounted) and the button stays stuck on
            // "Signed in…" — a soft-lock. Reload instead to present a fresh, usable overlay.
            ? () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } }
            : () => window.location.reload();
        initLoginOverlay({ pageLabel: 'Operations', onSuccess });
        if (!CONFIG.INPLACE_LOGIN.operations) resolveSession(false);
        return;
    }
    if (_access.decision === 'forbidden') {
        // Signed in but NOT an admin — Operations is admin-only (access control, not a login divert).
        window.location.replace('./admin.html');
        return;
    }
    // _access.decision === 'allow' → proceed (signed-in admin).
    // In-place sign-in: if we re-entered via the overlay's onSuccess, the overlay is still mounted —
    // remove it to reveal the page. No-op on a normal already-signed-in load (no overlay present).
    dismissLoginOverlay();

    // Resolve sessionReady so admin-auth.js and huddle.js (feature modules) can
    // import sessionReady and await it instead of reading window._mybSession.
    const _opsAuth = ensureNamedSession(currentUser);
    resolveSession(_opsAuth);
    // B1.2 enforcement, now decided via the policy. Once the named session resolves, the store (fed by
    // the Phase-2 bridge inside ensureNamedSession) reflects the terminal Firebase identity, so
    // `requirePage(getAuthSnapshot(), 'operations')` returns 'login' exactly when the member's OWN
    // named session could not be confirmed — equivalent to the old `if (ENFORCE && !named)`. Flag OFF →
    // the snapshot is 'named'/'anonymous' and the decision is 'allow', so this never fires (unchanged).
    _opsAuth.then(() => {
        if (CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'operations').decision === 'login') {
            clearSession();
            // resetNavPanel() before the overlay (v16.69, mirrors settings' v16.25 fix): the drawer
            // was wired with the now-cleared member's identity — a stale name/avatar/admin pill must
            // not stay reachable behind the login on a shared device.
            resetNavPanel();
            initLoginOverlay({ pageLabel: 'Operations', onSuccess: () => window.location.reload() });
        }
    });

    // The Operations read cards (Work Email, Error Log, Usage, App Speed) read admin-gated collections.
    // Immediately after "Set up accounts" the freshly-minted token doesn't yet carry the `admin` claim
    // (Firebase refreshes ID tokens ~hourly), so the first read fails `permission-denied` even though the
    // account IS an admin. `withClaimRetry` (firebase-client.js) forces one token refresh + one retry to
    // pick up the claim immediately — read/write-agnostic, so these reads use the same helper as the write
    // paths instead of a byte-identical local copy (v17.08; was `adminReadWithRetry`).


    // ============================================
    // PAGE INIT
    // ============================================
    document.body.classList.add('auth-ready');

    // Assigned by the About-lightbox IIFE further down; the closure below only reads
    // it when the drawer logo is tapped, by which point it is set.
    /** @type {any} */
    let openAboutLightbox = null;

    initNavPanel({
        currentPage: 'operations',
        memberName:  currentUser,
        isAdmin:         true,
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(currentUser),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   () => { clearSession(); window.location.href = './'; },
    });

    initHuddleUpload({ currentIsAdmin: true, currentUser });
    initCircularUpload();
    initNewsletterUpload();

    initRosterUpload({
        currentUser,
        currentIsAdmin: true,
        parseUrl:   'https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF',
        getIdToken: async () => { await sessionReady; return auth.currentUser?.getIdToken(); },
        loadOverrides,
    });

    initAuthSetup({ currentIsAdmin: true });

    // Brand-styled date pickers over the four upload date fields. AFTER the card inits above,
    // which set each field's default value (today / next Saturday) that the trigger label reads.
    initDatePickers(['huddleDate', 'circularDate', 'newsletterDate', 'rosterWeekEnding']);

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
    initCardCollapse('usageToggleHeader',   'usageBody',   'usageChevron');
    initCardCollapse('pageSpeedToggleHeader',   'pageSpeedBody',   'pageSpeedChevron');

    // ============================================
    // WORK EMAIL PROGRESS
    // ============================================
    // Account status (PASSWORD_PLAN.md §6) — per-member Email ✓/✗ + Password migrated ✓/✗, with a
    // per-member "Reset password to surname" break-glass. Joins getAllStaffContacts +
    // getAllPasswordStatus by member name; both admin-only reads (Firestore rules).
    async function initAccountStatus() {
        initCardCollapse('accountStatusToggleHeader', 'accountStatusBody', 'accountStatusChevron');
        const contentEl = document.getElementById('accountStatusContent');
        if (!contentEl) return;
        const content = /** @type {HTMLElement} */ (contentEl);
        const eligible = teamMembers.filter(m => !m.hidden || m.managerOnly);
        /** @type {Map<string, any>} */ let statusMap = new Map();
        /** @type {Set<string>} */ let emailSet = new Set();

        const migrated = (/** @type {string} */ name) => {
            const s = statusMap.get(name);
            const setAt   = /** @type {any} */ (s?.passwordSetAt)?.toMillis?.() ?? 0;
            const resetAt = /** @type {any} */ (s?.resetAt)?.toMillis?.() ?? 0;
            return setAt > 0 && setAt >= resetAt;
        };

        function render() {
            const done = eligible.filter(m => migrated(m.name)).length;
            content.innerHTML = '';
            const summary = document.createElement('p');
            summary.className = 'email-count-summary';
            summary.setAttribute('aria-live', 'polite');
            summary.innerHTML = `<strong class="email-count-num">${done}</strong> of <strong>${eligible.length}</strong> have set their own password`;
            content.appendChild(summary);
            const list = document.createElement('div');
            list.className = 'acct-status-list';
            eligible.forEach(m => {
                const row = document.createElement('div');
                row.className = 'acct-status-row';
                const nameEl = document.createElement('span'); nameEl.className = 'acct-name'; nameEl.textContent = m.name;
                const emailEl = document.createElement('span'); emailEl.className = 'acct-flag'; emailEl.title = 'Work email';
                emailEl.textContent = emailSet.has(m.name) ? '📧 ✓' : '📧 —';
                const pwEl = document.createElement('span'); pwEl.className = 'acct-flag'; pwEl.title = 'Password';
                const mig = migrated(m.name);
                pwEl.textContent = mig ? '🔑 ✓' : '🔑 surname';
                pwEl.classList.toggle('acct-flag--warn', !mig);
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'btn-acct-reset'; btn.textContent = 'Reset';
                btn.setAttribute('aria-label', `Reset ${m.name}'s password to their surname`);
                btn.addEventListener('click', () => doReset(m.name, btn));
                row.append(nameEl, emailEl, pwEl, btn);
                list.appendChild(row);
            });
            content.appendChild(list);
        }

        async function doReset(/** @type {string} */ name, /** @type {HTMLButtonElement} */ btn) {
            const ok = await confirmDialog({
                title: 'Reset password?',
                message: `Reset ${name}'s password back to their surname default? They'll be asked to set a new one, and signed out of their other devices.`,
                confirmLabel: 'Reset', danger: true,
            });
            if (!ok) return;
            btn.disabled = true; btn.textContent = 'Resetting…';
            try {
                await resetMemberPassword(name, { revoke: true });
            } catch (e) {
                // Only a genuine RESET failure gets the Retry affordance.
                console.warn('[Operations] resetMemberPassword failed:', e);
                btn.disabled = false; btn.textContent = 'Retry';
                btn.title = 'Reset failed — try again shortly';
                return;
            }
            // Reset SUCCEEDED (member re-defaulted + signed out). The follow-up status re-read is
            // best-effort — if it fails, do NOT show "Retry"/"Reset failed" (that would prompt a
            // redundant second reset). Reflect the done state and let the next load reconcile the table.
            try {
                const fresh = await withClaimRetry(getAllPasswordStatus);
                statusMap = new Map(fresh.map(/** @param {any} s */ s => [s.memberName, s]));
                render();   // rebuilds the row (btn is replaced) — reflects the new "surname" state
            } catch (e) {
                console.warn('[Operations] status refresh after reset failed (reset itself succeeded):', e);
                btn.textContent = 'Reset ✓'; btn.title = 'Password reset — refresh the page to update the table';
            }
        }

        try {
            await sessionReady;
            const [contacts, statuses] = await Promise.all([
                withClaimRetry(getAllStaffContacts),
                withClaimRetry(getAllPasswordStatus),
            ]);
            emailSet  = new Set(contacts.filter(/** @param {any} c */ c => c.workEmail).map(/** @param {any} c */ c => c.memberName));
            statusMap = new Map(statuses.map(/** @param {any} s */ s => [s.memberName, s]));
            content.removeAttribute('aria-busy');
            render();
        } catch {
            _cardLoadError(content, 'account status', () => initAccountStatus());
        }
    }

    async function initWorkEmailStatus() {
        // All active accounts — excludes leavers (hidden:true without managerOnly).
        // Management accounts (hidden:true + managerOnly:true) are included: the admin
        // sets their emails here since they have no Settings page of their own.
        const eligible = teamMembers.filter(m => !m.hidden || m.managerOnly);
        const content  = document.getElementById('emailStatusContent');
        if (!content) return;

        try {
            // Wait for the Firebase Auth session so Firestore rules pass.
            await sessionReady;
            const contacts = await withClaimRetry(getAllStaffContacts);

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
            summaryEl.setAttribute('aria-live', 'polite');
            content.appendChild(summaryEl);

            const listContainer = document.createElement('div');
            content.appendChild(listContainer);

            function renderForGrade(/** @type {string} */ grade) {
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
                                if (prevRow?.querySelector('.email-set-btn')?.textContent === 'Cancel') {
                                    const setBtn = prevRow.querySelector('.email-set-btn');
                                    if (setBtn) setBtn.textContent = 'Edit';
                                }
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
                                if (v && !v.includes('@')) input.value = v + '@' + CONFIG.WORK_EMAIL_DOMAIN;
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
                                if (rawVal && !rawVal.includes('@')) input.value = rawVal + '@' + CONFIG.WORK_EMAIL_DOMAIN;
                                const email = input.value.trim();
                                if (!isValidEmail(email)) {
                                    errorEl.textContent = 'Please enter a valid email address';
                                    input.focus();
                                    return;
                                }
                                if (!isChilternWorkEmail(email)) {
                                    errorEl.textContent = `Use a Chiltern work email (@${CONFIG.WORK_EMAIL_DOMAIN})`;
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
                    done.textContent = `✓ All ${gradeLabel} have added their work email${grade ? '' : ' — ready for when self-service password reset is switched on'}.`;
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
                                if (v && !v.includes('@')) input.value = v + '@' + CONFIG.WORK_EMAIL_DOMAIN;
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
                                if (rawVal && !rawVal.includes('@')) input.value = rawVal + '@' + CONFIG.WORK_EMAIL_DOMAIN;
                                const email = input.value.trim();
                                if (!isValidEmail(email)) {
                                    errorEl.textContent = 'Please enter a valid email address';
                                    input.focus();
                                    return;
                                }
                                if (!isChilternWorkEmail(email)) {
                                    errorEl.textContent = `Use a Chiltern work email (@${CONFIG.WORK_EMAIL_DOMAIN})`;
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
            console.error('[WorkEmailStatus]', err);
            _cardLoadError(content, 'Couldn\'t load email status — check your connection.', initWorkEmailStatus);
        } finally {
            content.removeAttribute('aria-busy');   // announce "finished loading" to screen readers
        }
    }
    initWorkEmailStatus();
    initAccountStatus();

    // Show a banner if Firebase Auth couldn't establish a real admin session.
    // Anonymous fallback still resolves the Promise so the page renders, but
    // Cloud Functions and Storage both require a valid admin token — they'll
    // reject silently without this warning.
    sessionReady.then(ok => {
        if (!ok || getFirebaseAuthError()) {
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
        initDocUploadCard({
            dateId: 'newsletterDate', fileId: 'newsletterFileInput',
            fileLabelId: 'newsletterFileName', uploadBtnId: 'newsletterUploadBtn',
            feedbackId: 'newsletterFeedback', uploadFn: uploadNewsletter, currentUser,
            isAccepted: f => isPdfFile(f) || isDocxFile(f),
            rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
            sigMismatchMsg: "That file isn't a valid PDF or Word document — please choose the original file",
            successMsg: date => `Newsletter uploaded for ${date} — staff can open it from ☰ → Marylebone Newsletter`,
            btnLabel: 'Upload Newsletter', logPrefix: 'Newsletter',
        });
    }

    // ============================================
    // WEEKLY RETAIL CIRCULAR UPLOAD
    // ============================================
    function initCircularUpload() {
        initDocUploadCard({
            dateId: 'circularDate', fileId: 'circularFileInput',
            fileLabelId: 'circularFileName', uploadBtnId: 'circularUploadBtn',
            feedbackId: 'circularFeedback', uploadFn: uploadCircular, currentUser,
            isAccepted: f => isPdfFile(f) || isDocxFile(f),
            rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
            sigMismatchMsg: "That file isn't a valid PDF or Word document — please choose the original file",
            successMsg: date => `Circular uploaded for ${date} — staff can open it from ☰ → Weekly Retail Circular`,
            btnLabel: 'Upload Circular', logPrefix: 'Circular',
        });
    }

    // ============================================
    // ICON LIGHTBOX — About panel (shared about-lightbox.js)
    // ============================================
    (function () {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Operations',
            bugLinkId: 'opsBugReportLink',
            getUserName: () => currentUser,
        });
        if (about) openAboutLightbox = about.open;

        // Header logo is a back-to-calendar button (About moved to the drawer logo).
        const headerIcon = document.getElementById('appIcon');
        if (!headerIcon) return;
        headerIcon.title = 'Back to calendar';
        headerIcon.setAttribute('aria-label', 'Back to calendar');
        // Keyboard-operable: the logo is an interactive control (was a non-focusable <img>). v18.29.
        headerIcon.setAttribute('role', 'button');
        headerIcon.tabIndex = 0;
        headerIcon.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); headerIcon.click(); } });
        headerIcon.addEventListener('click', () => { window.location.href = './'; });
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
                    { icon: '📰', html: 'Upload the Weekly Retail Circular (PDF or Word) — staff open it from <strong>☰ → Weekly Retail Circular</strong>' },
                    { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
                    { icon: '📅', html: 'Set the date to the week the circular covers — usually the Friday it was issued' },
                    { icon: '🤖', html: 'In a future update this will upload automatically, like the Huddle' },
                ]}],
            },
            'newsletter': {
                title: 'Marylebone Newsletter',
                sections: [{ items: [
                    { icon: '🗞️', html: 'Upload the latest Marylebone Newsletter (PDF or Word) — staff open it from <strong>☰ → Marylebone Newsletter</strong>' },
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
                    { icon: '🔐', html: 'Creates an app login for every active staff member so the app knows who is saving changes' },
                    { icon: '✅', html: 'Safe to run any time — existing accounts are kept as they are, and only new joiners get an account added' },
                    { icon: '👤', html: 'Run this whenever someone <strong>joins</strong> the roster to give them access' },
                    { icon: '🚪', html: 'Tick <strong>"Disable accounts for leavers"</strong> and run it when someone <strong>leaves</strong> — their account is disabled so they can no longer sign in' },
                ]}],
            },
            'account-status': {
                title: 'Account status',
                sections: [
                    { heading: 'What it shows', items: [
                        { icon: '🔑', html: 'Whether each person still signs in with their <strong>surname default</strong> or has <strong>set their own password</strong> in ☰ → Settings → Password' },
                        { icon: '📧', html: 'A ✓ against the envelope means they\'ve also registered a <strong>work email</strong> (from the Work Email Progress card)' },
                    ]},
                    { heading: 'Resetting a password', items: [
                        { icon: '↩️', html: 'Tap <strong>Reset</strong> next to anyone who\'s forgotten their password — it goes back to their <strong>surname default</strong> and they\'re signed out of their other devices' },
                        { icon: '🔒', html: 'After a reset they can sign in with their surname and set a new password of their own again' },
                    ]},
                ],
            },
            'work-email-progress': {
                title: 'Work Email Progress',
                sections: [
                    { heading: 'What it\'s for', items: [
                        { icon: '🔑', html: 'Staff save their work email so they can <strong>reset a forgotten password</strong> in a future update — nothing uses it right now.' },
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
            'usage': {
                title: 'Usage',
                sections: [
                    { heading: 'What it shows', items: [
                        { icon: '👥', html: '<strong>Accounts active</strong> — how many individual staff accounts <strong>used the app</strong> this calendar month and over the last 30 days. Simply opening the app counts — a saved session doesn\'t need a fresh sign-in, so this is normally higher than the sign-in count on App Speed' },
                        { icon: '📊', html: '<strong>Page popularity</strong> — how many times each page has been opened this month' },
                    ]},
                    { heading: 'Privacy', items: [
                        { icon: '🔒', html: 'Completely <strong>anonymous</strong> — it counts <em>how many</em> accounts and visits, never <em>which</em> account did what. No names, no per-person history is stored' },
                        { icon: '📱', html: 'Counts are per account-device, so someone using both a phone and a laptop may count twice — treat the numbers as a usage trend, not an exact headcount' },
                    ]},
                ],
            },
            'page-speed': {
                title: 'App Speed',
                sections: [
                    { heading: 'What it shows', items: [
                        { icon: '⚡', html: 'How long pages took to <strong>open</strong> for staff this month, grouped into <strong>Quick</strong> (under 1s), <strong>A moment</strong> (1–3s) and <strong>Slow</strong> (over 3s)' },
                        { icon: '📄', html: 'The bar for each page shows the mix — a page with a lot of red is opening slowly for some staff' },
                        { icon: '🔑', html: '<strong>Signing in</strong> counts only <strong>fresh sign-ins</strong> — normally fewer than the accounts on the Usage card, because most staff open the app on a saved session without signing in again' },
                    ]},
                    { heading: 'How to read it', items: [
                        { icon: '🟢', html: 'Mostly green is healthy. A page is usually slower on a <strong>weak phone signal</strong> or right after an <strong>app update</strong> (the first load rebuilds the cache)' },
                        { icon: '🔴', html: 'If a page is <strong>consistently</strong> red across many loads, that\'s worth raising — it\'s not just one person on a bad connection' },
                    ]},
                    { heading: 'Privacy', items: [
                        { icon: '🔒', html: 'Completely <strong>anonymous</strong> — it records <em>how fast</em> pages opened, never <em>who</em> opened them. No names are stored' },
                    ]},
                ],
            },
            'error-log': {
                title: 'Error Log',
                sections: [
                    { heading: 'What it captures', items: [
                        { icon: '🐛', html: 'Errors the app ran into on <strong>any page across the app</strong> (calendar, pay calculator, admin, operations, settings, links) — across all staff, not just you' },
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
    initErrorLog();
    initUsageCard();
    initPageSpeedCard();

    // ============================================
    // registerServiceWorker() moved to the top of init() (runs before the access gate) — v16.21.
    sessionReady.then(() => { initErrorReporter(); recordUsage('operations', currentUser); recordPageLatency('operations', currentUser); });

}
