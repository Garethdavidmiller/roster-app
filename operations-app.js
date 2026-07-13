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

import { CONFIG, teamMembers, isValidEmail, isChilternWorkEmail, escapeHtml } from './roster-data.js';
import { auth, getAllStaffContacts, saveStaffContact, deleteStaffContact, getClientErrors, resolveClientError, uploadCircular, uploadNewsletter, getUsageStats, getPerfStats } from './firebase-client.js';
import { SPEED_GROUPS, perfVerdict } from './perf-stats.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import { loadOverrides } from './admin-overrides.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';
import { initAuthSetup } from './admin-auth.js';
import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, clearSession, ensureNamedSession, sessionReady, resolveSession, getFirebaseAuthError } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';


/**
 * Emoji + label for each page id — shared by the Usage and App Speed cards (was defined
 * identically inside both). One source so a label change (or a new page) is edited once.
 * @type {Record<string, { emoji: string, label: string }>}
 */
const PAGE_META = {
    calendar:   { emoji: '📅', label: 'Calendar' },
    admin:      { emoji: '📝', label: 'Admin' },
    paycalc:    { emoji: '💷', label: 'Pay calculator' },
    operations: { emoji: '🔧', label: 'Operations' },
    settings:   { emoji: '⚙️', label: 'Settings' },
    links:      { emoji: '🔗', label: 'Links' },
};

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
    registerServiceWorker();
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

    /**
     * Run an admin-only Firestore read, self-healing a stale auth token (Phase 4b,
     * ARCHITECTURE_PLAN.md). The three Operations read cards (Work Email, Error Log,
     * Usage) all read admin-gated collections. Immediately after "Set up accounts"
     * the freshly-minted token does not yet carry the `admin` claim — Firebase only
     * refreshes ID tokens ~hourly — so the first read fails `permission-denied` even
     * though the account IS an admin. Rather than make the admin wait (or reload),
     * we force a token refresh once and retry, picking up the claim immediately.
     *
     * Fail-safe: only retries on `permission-denied` with a live user; any other
     * error (offline, etc.) is re-thrown so the card's existing catch shows its
     * silent-fallback message. Retries at most once — a genuinely non-admin token
     * still throws on the second attempt and falls through to the card's catch.
     * @template T
     * @param {() => Promise<T>} readFn  The admin-gated read (e.g. getClientErrors).
     * @returns {Promise<T>}
     */
    async function adminReadWithRetry(readFn) {
        try {
            return await readFn();
        } catch (err) {
            const user = auth.currentUser;
            if (/** @type {any} */ (err)?.code === 'permission-denied' && user) {
                // If the refresh itself fails (offline/flaky), do NOT let its network error replace the
                // original permission-denied — mirrors writeWithClaimRetry so the card's catch keys its
                // silent-fallback message on the genuine error, not a spurious connectivity one.
                try {
                    await user.getIdToken(true);   // force refresh → pick up the admin claim
                } catch {
                    throw err;                     // preserve the original permission-denied
                }
                return await readFn();          // retry once with the fresh token
            }
            throw err;
        }
    }


    /**
     * Render a monitoring-card load failure with a "Try again" button that re-runs JUST this card
     * (B2). Previously each card's catch told the admin to "reload" — a full page reload that re-runs
     * every other card too, for a blip on one. The button clears the card and re-invokes its own init
     * function, so a transient failure costs one tap, not a whole-page refresh.
     * @param {HTMLElement} content   the card's content container
     * @param {string} message        the failure message (no "reload" wording — the button IS the retry)
     * @param {() => void} retryFn     the card's own init function
     */
    function _cardLoadError(content, message, retryFn) {
        content.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'auth-desc';
        p.style.color = 'var(--error-red)';
        p.textContent = message;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-action btn-secondary card-retry-btn';
        btn.textContent = '↻ Try again';
        btn.addEventListener('click', () => { btn.disabled = true; content.setAttribute('aria-busy', 'true'); retryFn(); });
        content.appendChild(p);
        content.appendChild(btn);
    }

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
            const contacts = await adminReadWithRetry(getAllStaffContacts);

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
                    done.textContent = `✓ All ${gradeLabel} have added their work email${grade ? '' : ' — ready for when password reset is switched on'}.`;
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
                        { icon: '🐛', html: 'Errors the app ran into on <strong>any signed-in page</strong> (admin, pay calculator, operations, settings) — across all staff, not just you' },
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
    async function initErrorLog() {
        const content = document.getElementById('errorLogContent');
        if (!content) return;

        try {
            await sessionReady;
            const { errors = [], truncated = false } = (await adminReadWithRetry(getClientErrors)) || {};

            content.innerHTML = '';

            // Visually-hidden live region so resolving an error is announced to AT
            // (the row just gains a strikethrough class otherwise — a silent change).
            const errStatus = document.createElement('div');
            errStatus.className = 'sr-only';
            errStatus.setAttribute('role', 'status');
            errStatus.setAttribute('aria-live', 'polite');
            content.appendChild(errStatus);

            // No-silent-caps: more than 100 unresolved errors exist; only the first 100 are
            // shown. The card renders once on load and the Resolve button doesn't re-fetch, so
            // tell the admin to reload after clearing some — don't imply they appear on their own.
            if (truncated) {
                const note = document.createElement('p');
                note.className = 'error-truncation-note';
                note.textContent = '⚠ More than 100 unresolved errors — showing the first 100. Resolve these to load the rest.';
                content.appendChild(note);
            }

            // Resolve-all toolbar — after a bad release spikes many similar errors, clearing them one
            // tap per row (with no refresh) is a grind. This resolves every unresolved error currently
            // shown, then refreshes the card in place to pull the next batch (B3).
            let unresolvedShown = errors.filter(e => !e.resolved);
            /** Keep the resolve-all button's count in step as individual resolves prune the
             *  snapshot; disable it when nothing unresolved remains shown. Assigned below. */
            let _syncResolveAllBtn = () => {};
            if (unresolvedShown.length > 0) {
                const bar = document.createElement('div');
                bar.className = 'error-log-toolbar';
                const allBtn = document.createElement('button');
                allBtn.type = 'button';
                allBtn.className = 'btn-action btn-secondary error-resolve-all-btn';
                allBtn.textContent = `✓ Resolve all shown (${unresolvedShown.length})`;
                _syncResolveAllBtn = () => {
                    allBtn.textContent = unresolvedShown.length
                        ? `✓ Resolve all shown (${unresolvedShown.length})`
                        : '✓ All shown resolved';
                    allBtn.disabled = unresolvedShown.length === 0;
                };
                allBtn.addEventListener('click', async () => {
                    allBtn.disabled = true;
                    allBtn.textContent = 'Resolving…';
                    const count   = unresolvedShown.length;
                    const results = await Promise.allSettled(unresolvedShown.map(e => resolveClientError(e.id)));
                    const failedItems = unresolvedShown.filter((_, i) => results[i].status === 'rejected');
                    if (failedItems.length) {
                        // Retry only the ones that FAILED — re-resolving the already-succeeded rows would
                        // reset their 90-day retention clock and inflate the count.
                        const succeeded = count - failedItems.length;
                        unresolvedShown = failedItems;
                        allBtn.disabled = false;
                        allBtn.textContent = `✗ ${failedItems.length} didn't resolve — tap to retry`;
                        errStatus.textContent = `${succeeded} resolved, ${failedItems.length} failed`;
                        return;   // leave the list as-is so the admin can retry just the failures
                    }
                    content.setAttribute('aria-busy', 'true');
                    await initErrorLog();   // in-place refresh — pulls the next batch, no page reload
                    // Announce on the FRESH live region, after aria-busy cleared (the refresh's
                    // finally removes it): setting it before the refresh put the message inside an
                    // aria-busy subtree that was then destroyed — screen readers heard nothing
                    // (v16.69 review fix).
                    const freshStatus = content.querySelector('[role="status"]');
                    if (freshStatus) freshStatus.textContent = `${count} error${count !== 1 ? 's' : ''} resolved`;
                });
                bar.appendChild(allBtn);
                content.appendChild(bar);
            }

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
                const addSpan = (/** @type {string} */ cls, /** @type {string} */ text) => {
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
                copyBtn.textContent = '⎘ Copy details';
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(_formatForClaude(err)).then(() => {
                        copyBtn.textContent = '✓ Copied';
                        setTimeout(() => { copyBtn.textContent = '⎘ Copy details'; }, 2000);
                    }).catch(() => {
                        copyBtn.textContent = '✗ Copy failed';
                        setTimeout(() => { copyBtn.textContent = '⎘ Copy details'; }, 2000);
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
                            // Prune this doc from the resolve-all snapshot: without this, a later
                            // "Resolve all shown" re-stamps it (fresh resolvedAt → a NEW 90-day
                            // retention clock) and overcounts (v16.69 review fix).
                            unresolvedShown = unresolvedShown.filter(u => u.id !== err.id);
                            _syncResolveAllBtn();
                            errStatus.textContent = `Error from ${err.memberName ?? 'unknown'} marked resolved`;
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
            console.error('[ErrorLog]', e);
            _cardLoadError(content, 'Couldn\'t load error log — check your connection.', initErrorLog);
        } finally {
            content.removeAttribute('aria-busy');
        }
    }
    initErrorLog();

    // ============================================
    // USAGE CARD
    // ============================================
    async function initUsageCard() {
        const content = document.getElementById('usageContent');
        if (!content) return;

        // Page id → emoji + label, matching the app's nav vocabulary (📅 Calendar,
        // 📝 Admin, 💷 Pay, 🔧 Ops, ⚙ Settings, 🔗 Links).
        /** @type {Record<string, {emoji: string, label: string}>} */
        try {
            await sessionReady;
            const stats = await adminReadWithRetry(getUsageStats);
            content.innerHTML = '';

            // Active-account headline numbers.
            const accounts = document.createElement('div');
            accounts.className = 'usage-stats';
            accounts.innerHTML =
                `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsThisMonth}</span>` +
                `<span class="usage-stat-lbl"><span aria-hidden="true">👥</span> accounts this month</span></div>` +
                `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsLast30}</span>` +
                `<span class="usage-stat-lbl"><span aria-hidden="true">📅</span> active in last 30 days</span></div>`;
            content.appendChild(accounts);

            // Page popularity — This month / Last month toggle (trend; stable early in a month).
            let popActive = 'this';
            const popToggle = document.createElement('div');
            popToggle.className = 'speed-toggle';
            popToggle.setAttribute('role', 'group');
            popToggle.setAttribute('aria-label', 'Time window');
            const heading = document.createElement('p');
            heading.className = 'usage-section-label';
            const popBody = document.createElement('div');

            const renderPop = () => {
                const counts = popActive === 'this' ? stats.pageCounts : stats.prevPageCounts;
                const month  = popActive === 'this' ? stats.month : stats.prevMonth;
                heading.textContent = `Page popularity — ${_usageMonthLabel(month)}`;
                popBody.innerHTML = '';
                if (!counts.length) {
                    const none = document.createElement('p');
                    none.className = 'auth-desc';
                    none.textContent = popActive === 'this'
                        ? 'No page views recorded yet this month.'
                        : 'No page views recorded last month.';
                    popBody.appendChild(none);
                    return;
                }
                const max = counts[0].count || 1;
                const list = document.createElement('div');
                list.className = 'usage-bars';
                counts.forEach(({ page, count }) => {
                    const meta  = PAGE_META[page];
                    const emoji = meta ? meta.emoji : '📄';
                    // Known labels are static/safe; an unknown page key (a tampered client
                    // could write one) is escaped before it reaches innerHTML.
                    const label = meta ? meta.label : escapeHtml(page);
                    const pct   = Math.max(4, Math.round((count / max) * 100));
                    const row = document.createElement('div');
                    row.className = 'usage-bar-row';
                    row.innerHTML =
                        `<span class="usage-bar-label"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
                        `<span class="usage-bar-track"><span class="usage-bar-fill" style="width:${pct}%"></span></span>` +
                        `<span class="usage-bar-count">${count.toLocaleString('en-GB')}</span>`;
                    list.appendChild(row);
                });
                popBody.appendChild(list);
            };

            [['this', 'This month'], ['last', 'Last month']].forEach(([key, label]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'speed-toggle-btn' + (key === popActive ? ' speed-toggle-btn--on' : '');
                btn.textContent = label;
                btn.setAttribute('aria-pressed', String(key === popActive));
                btn.addEventListener('click', () => {
                    if (popActive === key) return;
                    popActive = key;
                    popToggle.querySelectorAll('.speed-toggle-btn').forEach((b, i) => {
                        const on = (i === 0 ? 'this' : 'last') === popActive;
                        b.classList.toggle('speed-toggle-btn--on', on);
                        b.setAttribute('aria-pressed', String(on));
                    });
                    renderPop();
                });
                popToggle.appendChild(btn);
            });

            content.appendChild(popToggle);
            content.appendChild(heading);
            content.appendChild(popBody);
            renderPop();

            const note = document.createElement('p');
            note.className = 'usage-note';
            note.textContent = 'Anonymous — we never record who. Your own (admin) loads are excluded.';
            content.appendChild(note);

        } catch (e) {
            console.error('[Usage]', e);
            _cardLoadError(content, 'Couldn\'t load usage — check your connection.', initUsageCard);
        } finally {
            content.removeAttribute('aria-busy');
        }
    }
    initUsageCard();

    // ── App speed card (Project 0 latency, surfaced in plain language) ──────────────
    async function initPageSpeedCard() {
        const content = document.getElementById('pageSpeedContent');
        if (!content) return;

        const TONE_CLASS = { good: 'good', ok: 'ok', bad: 'bad', none: 'none' };
        /** width:% segments (good/ok/slow) from a {quick,ok,slow,total} band row.
         *  @param {{quick:number, ok:number, slow:number, total:number}} b */
        const segs = (b) => {
            if (!b.total) return '';
            const w = (/** @type {number} */ n) => (n / b.total) * 100;
            return `<span class="speed-seg speed-seg--good" style="width:${w(b.quick)}%"></span>` +
                   `<span class="speed-seg speed-seg--ok"   style="width:${w(b.ok)}%"></span>` +
                   `<span class="speed-seg speed-seg--bad"  style="width:${w(b.slow)}%"></span>`;
        };
        /** A small "🔑 Signing in" / "📄 Opening pages" section heading. @param {string} emoji @param {string} label */
        const subhead = (emoji, label) => {
            const p = document.createElement('p');
            p.className = 'speed-subhead';
            p.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
            return p;
        };
        /** A full-width overall band bar (Quick/A moment/Slow) — used for the aggregate login section,
         *  so it shows the SAME three bands as the per-page bars (not just a single headline %).
         *  @param {{quick:number, ok:number, slow:number, total:number, pctQuick:number, pctOk:number, pctSlow:number}} b */
        const overallBar = (b) => {
            const wrap = document.createElement('div');
            wrap.className = 'speed-bar speed-bar--overall';
            wrap.setAttribute('role', 'img');
            wrap.setAttribute('aria-label', `${b.pctQuick}% quick, ${b.pctOk}% a moment, ${b.pctSlow}% slow`);
            wrap.innerHTML = segs(b);
            return wrap;
        };
        /** The shared colour key (Quick/A moment/Slow) — explains both the login bar and the page bars. */
        const legendEl = () => {
            const legend = document.createElement('div');
            legend.className = 'speed-legend';
            legend.innerHTML = /** @type {Array<'quick'|'ok'|'slow'>} */ (['quick', 'ok', 'slow']).map(g => {
                const grp = SPEED_GROUPS[g];
                return `<span class="speed-legend-item"><span class="speed-dot speed-dot--${grp.tone}"></span>${grp.label} <span class="speed-legend-sub">(${grp.sub})</span></span>`;
            }).join('');
            return legend;
        };
        /** A toned verdict banner: big % "quick" + plain sentence + a sub line.
         *  @param {{tone:'good'|'ok'|'bad'|'none', text:string}} verdict
         *  @param {{pctQuick:number}} overall @param {number} total @param {string} unit
         *  @param {string} [windowLabel] - "this month" / "last month", for the sub line */
        const verdictBanner = (verdict, overall, total, unit, windowLabel = 'this month') => {
            const div = document.createElement('div');
            div.className = `speed-verdict speed-verdict--${TONE_CLASS[verdict.tone]}`;
            const sub = total
                ? `${overall.pctQuick}% within a second · ${total.toLocaleString('en-GB')} ${unit} ${windowLabel}`
                : (windowLabel === 'this month'
                    ? 'Fills in as staff use the app over the coming days.'
                    : 'No data recorded last month.');
            div.innerHTML =
                `<span class="speed-verdict-num">${total ? overall.pctQuick + '%' : '—'}</span>` +
                `<span class="speed-verdict-text">${verdict.text}<span class="speed-verdict-sub">${sub}</span></span>`;
            return div;
        };

        /** A lighter sub-heading for the two "opening a page" milestones. @param {string} emoji @param {string} label */
        const subMilestone = (emoji, label) => {
            const p = document.createElement('p');
            p.className = 'speed-subhead speed-subhead--sub';
            p.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
            return p;
        };
        /** A small muted framing line. @param {string} text */
        const noteLine = (text) => {
            const p = document.createElement('p');
            p.className = 'speed-note';
            p.textContent = text;
            return p;
        };
        /** Per-page rows showing BOTH milestones — an "appears" bar and a "ready" bar per page — so the
         *  same page's two speeds sit together and one page's "appears" can be scanned against every other.
         *  @param {Array<any>} fcpByPage @param {Array<any>} pagesByPage @param {string} month */
        const dualRows = (fcpByPage, pagesByPage, month) => {
            const frag = document.createDocumentFragment();
            const heading = document.createElement('p');
            heading.className = 'usage-section-label';
            heading.textContent = `By page — ${_usageMonthLabel(month)}`;
            frag.appendChild(heading);

            const fcpMap   = new Map(fcpByPage.map(p => [p.page, p]));
            const pagesMap = new Map(pagesByPage.map(p => [p.page, p]));
            const allPages = [...new Set([...pagesMap.keys(), ...fcpMap.keys()])]
                .sort((a, b) => (pagesMap.get(b)?.total || 0) - (pagesMap.get(a)?.total || 0)
                             || (fcpMap.get(b)?.total   || 0) - (fcpMap.get(a)?.total   || 0)
                             || a.localeCompare(b));

            const rows = document.createElement('div');
            rows.className = 'speed-rows';
            const head = document.createElement('div');
            head.className = 'speed-row speed-row--dual speed-dual-head';
            head.innerHTML = '<span></span><span class="speed-dual-label">Appears</span><span class="speed-dual-label">Ready</span><span></span>';
            rows.appendChild(head);

            allPages.forEach(pg => {
                const meta  = PAGE_META[pg];
                const emoji = meta ? meta.emoji : '📄';
                const label = meta ? meta.label : escapeHtml(pg);
                const f = fcpMap.get(pg);
                const r = pagesMap.get(pg);
                const count = (r?.total) || (f?.total) || 0;
                const row = document.createElement('div');
                row.className = 'speed-row speed-row--dual';
                row.innerHTML =
                    `<span class="speed-row-label"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
                    `<span class="speed-bar" role="img" aria-label="appears: ${f ? f.pctQuick : 0}% quick">${f ? segs(f) : ''}</span>` +
                    `<span class="speed-bar" role="img" aria-label="ready: ${r ? r.pctQuick : 0}% quick">${r ? segs(r) : ''}</span>` +
                    `<span class="speed-row-count">${count.toLocaleString('en-GB')}</span>`;
                rows.appendChild(row);
            });
            frag.appendChild(rows);
            return frag;
        };

        try {
            await sessionReady;
            const stats = await adminReadWithRetry(getPerfStats);   // { thisMonth, lastMonth }
            content.innerHTML = '';

            // ── Window toggle: This month / Last month (trend across deploys; stable early in a month) ──
            let active = 'thisMonth';
            const toggle = document.createElement('div');
            toggle.className = 'speed-toggle';
            toggle.setAttribute('role', 'group');
            toggle.setAttribute('aria-label', 'Time window');
            const body = document.createElement('div');

            /** Render the body for the active window. */
            const render = () => {
                const w = stats[/** @type {'thisMonth'|'lastMonth'} */ (active)];   // { month, login, fcp, pages }
                const windowLabel = active === 'thisMonth' ? 'this month' : 'last month';
                body.innerHTML = '';

                // Section 1 — Signing in (a distinct journey).
                body.appendChild(subhead('🔑', 'Signing in'));
                body.appendChild(noteLine('Only fresh sign-ins are timed — normally fewer than the accounts on the Usage card, since a saved session opens the app without signing in again.'));
                body.appendChild(verdictBanner(perfVerdict(w.login.overall, 'login'), w.login.overall, w.login.total, 'sign-ins', windowLabel));
                if (w.login.total) body.appendChild(overallBar(w.login.overall));

                if (w.login.total || w.fcp.total || w.pages.total) body.appendChild(legendEl());

                // Section 2 — Opening a page: two milestones in timeline order (appears → ready).
                body.appendChild(subhead('📄', 'Opening pages'));
                body.appendChild(noteLine('Two moments when a page opens — when it first appears on screen, then when it’s fully ready to use.'));
                body.appendChild(subMilestone('✨', 'First appears'));
                body.appendChild(verdictBanner(perfVerdict(w.fcp.overall, 'fcp'), w.fcp.overall, w.fcp.total, 'page opens', windowLabel));
                body.appendChild(subMilestone('✅', 'Fully ready'));
                body.appendChild(verdictBanner(perfVerdict(w.pages.overall, 'pages'), w.pages.overall, w.pages.total, 'page opens', windowLabel));

                if (w.fcp.total || w.pages.total) body.appendChild(dualRows(w.fcp.byPage, w.pages.byPage, w.month));

                const note = document.createElement('p');
                note.className = 'usage-note';
                note.textContent = 'Speeds are how long the app took to respond. Your own (admin) loads are excluded. Anonymous — we never record who.';
                body.appendChild(note);
            };

            [['thisMonth', 'This month'], ['lastMonth', 'Last month']].forEach(([key, label]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'speed-toggle-btn' + (key === active ? ' speed-toggle-btn--on' : '');
                btn.textContent = label;
                btn.setAttribute('aria-pressed', String(key === active));
                btn.addEventListener('click', () => {
                    if (active === key) return;
                    active = key;
                    toggle.querySelectorAll('.speed-toggle-btn').forEach((b, i) => {
                        const on = (i === 0 ? 'thisMonth' : 'lastMonth') === active;
                        b.classList.toggle('speed-toggle-btn--on', on);
                        b.setAttribute('aria-pressed', String(on));
                    });
                    render();
                });
                toggle.appendChild(btn);
            });

            content.appendChild(toggle);
            content.appendChild(body);
            render();

        } catch (e) {
            console.error('[AppSpeed]', e);
            _cardLoadError(content, 'Couldn\'t load app speed — check your connection.', initPageSpeedCard);
        } finally {
            content.removeAttribute('aria-busy');
        }
    }
    initPageSpeedCard();

    /** "2026-06" → "June 2026" for the Usage card heading. */
    function _usageMonthLabel(/** @type {string} */ ym) {
        const [y, m] = String(ym).split('-').map(Number);
        if (!y || !m) return ym;
        return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    }

    /** Format a relative time string with the exact time appended, e.g. "3h ago · 22 Jun 14:23". */
    function _relativeTime(/** @type {Date} */ date) {
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
    function _formatForClaude(/** @type {any} */ err) {
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
    // registerServiceWorker() moved to the top of init() (runs before the access gate) — v16.21.
    sessionReady.then(() => { initErrorReporter(); recordUsage('operations', currentUser); recordPageLatency('operations', currentUser); });

}
