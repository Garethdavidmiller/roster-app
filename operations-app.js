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
import { auth, getAllStaffContacts, saveStaffContact, deleteStaffContact, getAllPasswordStatus, resetMemberPassword, getResetRequests, clearResetRequest, uploadCircular, uploadNewsletter, withClaimRetry } from './firebase-client.js';
import { isPasswordMigrated } from './auth-identity.js';
import { _cardLoadError, _relativeTime } from './operations-reports.js';
import { initErrorLog } from './operations-errors.js';
import { createAttentionStrip } from './operations-attention.js';
import { initUsageCard } from './operations-usage.js';
import { initPageSpeedCard } from './operations-speed.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { loadOverrides } from './admin-overrides.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';
import { initAuthSetup } from './admin-auth.js';
import { initDatePickers } from './date-picker.js';
import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, clearSession, ensureNamedSession, sessionReady, resolveSession, getFirebaseAuthError, reconcileExpiredIdentity } from './session.js';
import { requirePage, canOpenOvertime } from './auth-policy.js';
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
    // The page's content is on screen from this line: `.container` is `display:none` until
    // `auth-ready`, so everything before it was a blank page (v20.80). See markPageReady.
    markPageReady();

    // Assigned by the About-lightbox IIFE further down; the closure below only reads
    // it when the drawer logo is tapped, by which point it is set.
    /** @type {any} */
    let openAboutLightbox = null;

    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
        currentPage: 'operations',
        memberName:  currentUser,
        isAdmin:         true,
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(currentUser),
        canOpenOvertime: canOpenOvertime(currentUser),
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
    // Account status collapse wired ONCE here (not inside initAccountStatus) — its _cardLoadError
    // retry re-invokes initAccountStatus, and initCardCollapse has no idempotency guard, so wiring it
    // there would add a duplicate listener per failed load (an even number of retries → dead toggle).
    initCardCollapse('accountStatusToggleHeader', 'accountStatusBody', 'accountStatusChevron');
    initCardCollapse('resetRequestsToggleHeader', 'resetRequestsBody', 'resetRequestsChevron');
    initCardCollapse('errorLogToggleHeader',   'errorLogBody',   'errorLogChevron');
    initCardCollapse('usageToggleHeader',   'usageBody',   'usageChevron');
    initCardCollapse('pageSpeedToggleHeader',   'pageSpeedBody',   'pageSpeedChevron');

    // Deep link from the reset-request push (v18.95). The notification lands the admin on this page,
    // which has nine collapsed cards — without this they would arrive and still have to go find the
    // one the notification was about. Opens that card and scrolls it into view.
    //
    // Driven by the hash rather than a query so it costs nothing to add another later; the map is the
    // allowlist, so an arbitrary hash can never expand an unrelated card. Runs on load AND on
    // hashchange, because tapping the notification while Operations is already open re-navigates an
    // existing client (see the SW's notificationclick) and fires only hashchange.
    /** @type {Record<string, [string, string, string]>} hash → [bodyId, chevronId, cardId] */
    const DEEP_LINK_CARDS = {
        '#reset-requests': ['resetRequestsBody', 'resetRequestsChevron', 'resetRequestsCard'],
        '#error-log':      ['errorLogBody',      'errorLogChevron',      'errorLogCard'],
    };
    /** @param {string} [hash] defaults to location.hash — the strip passes its own so a repeat
     *  tap (same hash, no hashchange) still opens and scrolls. */
    function openDeepLinkedCard(hash) {
        const target = DEEP_LINK_CARDS[hash || location.hash];
        if (!target) return;
        const [bodyId, chevronId, cardId] = target;
        // Only ever OPENS. Re-running on a repeat tap must not toggle a card the admin just closed.
        openCard(bodyId, chevronId);
        document.getElementById(cardId)?.scrollIntoView({
            block: 'start',
            // The app honours prefers-reduced-motion everywhere else; a notification tap is no place
            // to start an exception.
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    }
    openDeepLinkedCard();
    window.addEventListener('hashchange', () => openDeepLinkedCard());

    // The Needs-attention strip (v22.03) — an index the cards feed; it runs no reads of its own
    // (operations-attention.js header has the three refusals that ARE the design).
    const attention = createAttentionStrip({
        container: document.getElementById('attentionStrip'),
        onJump: (hash) => openDeepLinkedCard(hash),
    });

    /**
     * Expand a collapsible card programmatically — idempotent, and never a toggle.
     *
     * `aria-expanded` is set alongside the class because opening a card by class ALONE leaves the
     * chevron reporting "collapsed" to a screen reader until the first manual toggle
     * (A11Y_FINDINGS.md, v18.68) — the failure this helper exists to make unrepeatable.
     *
     * @param {string} bodyId @param {string} chevronId @returns {void}
     */
    function openCard(bodyId, chevronId) {
        const body = document.getElementById(bodyId);
        if (!body || body.classList.contains('open')) return;
        body.classList.add('open');
        const chev = document.getElementById(chevronId);
        chev?.classList.add('open');
        chev?.setAttribute('aria-expanded', 'true');
    }

    // ============================================
    // ACCOUNT STATUS  (work email + password, per member)
    // ============================================
    // The single per-member account-admin table (v18.65 — merged from the former Work Email Progress
    // + Account status cards, which duplicated the email column). Joins getAllStaffContacts +
    // getAllPasswordStatus (both admin-only reads) and renders, per member: the work email (address +
    // Set/Edit/Remove) and the password posture (own password vs surname default + a break-glass
    // Reset). Grade filter + two count summaries. PASSWORD_PLAN.md §6.
    async function initAccountStatus() {
        const contentEl = document.getElementById('accountStatusContent');
        if (!contentEl) return;
        const content = /** @type {HTMLElement} */ (contentEl);
        // Eligible = active accounts + management (managerOnly: hidden from the calendar but login-capable,
        // and with no Settings page of their own, so the admin manages their email here). Excludes leavers.
        const eligible = teamMembers.filter(m => !m.hidden || m.managerOnly);
        /** @type {Map<string, string>} name → work email */
        let emailMap = new Map();
        /** @type {Map<string, any>} name → passwordStatus doc */
        let statusMap = new Map();

        /** Migrated ⇔ passwordSetAt present AND at least as new as any admin resetAt (§6).
         *  isPasswordMigrated (auth-identity.js) is the single, unit-tested source. */
        const migrated = (/** @type {string} */ name) => isPasswordMigrated(statusMap.get(name));

        /** @type {HTMLSelectElement} */ let filterSelect;
        /** @type {HTMLElement} */ let summaryEl;
        /** @type {HTMLElement} */ let listEl;

        // Close every open email form and restore each Set/Edit button to its resting label.
        function closeAllEmailForms() {
            listEl.querySelectorAll('.email-set-form').forEach(f => f.remove());
            listEl.querySelectorAll('.acct-row').forEach(r => {
                const nm = /** @type {HTMLElement} */ (r).dataset.member || '';
                const b = r.querySelector('.email-set-btn');
                if (b) b.textContent = emailMap.has(nm) ? 'Edit' : 'Set email';
            });
        }

        function renderForGrade(/** @type {string} */ grade) {
            const pool = grade ? eligible.filter(m => m.role === grade) : eligible;
            const withEmail = pool.filter(m => emailMap.has(m.name)).length;
            const withPw    = pool.filter(m => migrated(m.name)).length;
            summaryEl.innerHTML =
                `<span class="acct-stat"><span class="acct-stat-num">${withEmail}</span>/${pool.length} work email</span>` +
                `<span class="acct-stat"><span class="acct-stat-num">${withPw}</span>/${pool.length} own password</span>`;
            listEl.innerHTML = '';
            pool.forEach(m => listEl.appendChild(buildRow(m)));
        }

        function buildRow(/** @type {any} */ m) {
            const row = document.createElement('div');
            row.className = 'acct-row';
            row.dataset.member = m.name;

            // Head line: name · password posture · Reset (ALWAYS — v18.84). Reset used to render only
            // for a MIGRATED member ("a surname-default account has nothing to reset TO"), which quietly
            // made the migration flag a security control. It isn't one: setOwnPassword deliberately
            // tolerates the Firestore stamp failing after updatePassword has already succeeded (it
            // returns statusRecorded:false and its own JSDoc calls the stamp "a monitoring signal, not
            // a security control"). A member whose stamp was lost therefore holds a REAL password while
            // this table reads "Surname default" — and with Reset hidden, the only in-app break-glass
            // path was gone: their surname no longer signs them in and recovery needed the Firebase
            // console. Resetting a genuinely surname-default account is harmless (it re-applies the same
            // default) and still usefully signs their other devices out, so always offer it.
            const head = document.createElement('div');
            head.className = 'acct-row-head';
            const nameEl = document.createElement('span');
            nameEl.className = 'acct-name';
            nameEl.textContent = m.name;
            // The NAME is what identifies the row, and at 375px it was the element being cut
            // ("C. Francisco-C…", "R. Forrester-Bla…") while a chip reading the same fifteen
            // characters on all 51 rows kept its full width (v21.72). The title restores the whole
            // name to a long-press/hover; the chip below gives back the space that caused it.
            nameEl.title = m.name;
            const mig = migrated(m.name);
            const pwEl = document.createElement('span');
            pwEl.className = 'acct-pw' + (mig ? '' : ' acct-pw--warn');
            // "Default", not "Surname default": the word repeated verbatim down every unmigrated
            // row and the card's own key explains what the default IS. The full wording stays in
            // the `?` panel and in the title here, so nothing is lost from the one place a reader
            // goes when they do not know the term.
            pwEl.title = mig ? 'Has set their own password' : 'Still on the surname default password';
            // The ✓ is decoration; "Own" is the whole statement, on ~50 rows (v21.94).
            pwEl.innerHTML = mig ? '<span aria-hidden="true">✓</span> Own' : 'Default';
            head.append(nameEl, pwEl);
            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'btn-acct-reset';
            resetBtn.textContent = 'Reset';
            resetBtn.setAttribute('aria-label', `Reset ${m.name}'s password to their surname default`);
            resetBtn.title = mig
                ? `Reset ${m.name} back to their surname default`
                : `Re-apply ${m.name}'s surname default and sign out their other devices`;
            resetBtn.addEventListener('click', () => doReset(m.name, resetBtn));
            head.appendChild(resetBtn);
            row.appendChild(head);

            // Email line: 📧 address + Edit/Remove, OR 📧 "No work email" + Set email.
            const emailLine = document.createElement('div');
            emailLine.className = 'acct-row-email';
            const has = emailMap.has(m.name);
            const emailText = document.createElement('span');
            emailText.className = 'acct-email' + (has ? '' : ' acct-email--none');
            emailText.textContent = has ? `📧 ${emailMap.get(m.name)}` : '📧 No work email';
            emailLine.appendChild(emailText);

            const setBtn = document.createElement('button');
            setBtn.type = 'button';
            setBtn.className = 'email-set-btn';
            setBtn.textContent = has ? 'Edit' : 'Set email';
            setBtn.setAttribute('aria-label', `${has ? 'Edit' : 'Set'} work email for ${m.name}`);
            setBtn.addEventListener('click', () => toggleEmailForm(row, emailLine, m, setBtn));
            emailLine.appendChild(setBtn);

            if (has) {
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'email-set-btn email-set-btn--remove';
                removeBtn.textContent = 'Remove';
                removeBtn.setAttribute('aria-label', `Remove email for ${m.name}`);
                removeBtn.addEventListener('click', () => removeEmail(m, removeBtn));
                emailLine.appendChild(removeBtn);
            }
            row.appendChild(emailLine);
            return row;
        }

        // The inline email Set/Edit form — shared by both the "no email" (Set) and "has email" (Edit)
        // buttons; injected after the email line inside the member's row.
        function toggleEmailForm(
            /** @type {HTMLElement} */ row,
            /** @type {HTMLElement} */ emailLine,
            /** @type {any} */ m,
            /** @type {HTMLButtonElement} */ setBtn,
        ) {
            const wasOpen = !!row.querySelector('.email-set-form');
            closeAllEmailForms();
            if (wasOpen) return;   // toggle: it was open, closeAll shut it — done
            setBtn.textContent = 'Cancel';

            const form = document.createElement('div');
            form.className = 'email-set-form';
            form.setAttribute('role', 'group');
            form.setAttribute('aria-label', `Work email for ${m.name}`);

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

            form.append(input, saveBtn, errorEl);
            emailLine.after(form);
            input.select();

            saveBtn.addEventListener('click', async () => {
                const rawVal = input.value.trim();
                if (rawVal && !rawVal.includes('@')) input.value = rawVal + '@' + CONFIG.WORK_EMAIL_DOMAIN;
                const email = input.value.trim();
                if (!isValidEmail(email)) {
                    errorEl.textContent = 'Please enter a valid email address'; input.focus(); return;
                }
                if (!isChilternWorkEmail(email)) {
                    errorEl.textContent = `Use a Chiltern work email (@${CONFIG.WORK_EMAIL_DOMAIN})`; input.focus(); return;
                }
                saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; errorEl.textContent = '';
                try {
                    await saveStaffContact(m.name, email);
                    emailMap.set(m.name, email);
                    renderForGrade(filterSelect.value);
                    filterSelect.focus();
                } catch (e) {
                    console.error('[AccountStatus] email save failed', e);
                    errorEl.textContent = 'Couldn\'t save — check your connection and try again';
                    saveBtn.disabled = false; saveBtn.textContent = 'Save';
                }
            });

            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
                if (e.key === 'Escape') { form.remove(); setBtn.textContent = emailMap.has(m.name) ? 'Edit' : 'Set email'; }
            });
        }

        async function removeEmail(/** @type {any} */ m, /** @type {HTMLButtonElement} */ removeBtn) {
            // Two-tap confirm (no dialog — keeps the inline row flow); auto-reverts after 3s.
            if (removeBtn.dataset.confirm !== 'pending') {
                removeBtn.dataset.confirm = 'pending';
                removeBtn.textContent = 'Confirm?';
                setTimeout(() => {
                    if (removeBtn.dataset.confirm === 'pending') { removeBtn.dataset.confirm = ''; removeBtn.textContent = 'Remove'; }
                }, 3000);
                return;
            }
            removeBtn.disabled = true; removeBtn.textContent = 'Removing…';
            try {
                await deleteStaffContact(m.name);
                emailMap.delete(m.name);
                renderForGrade(filterSelect.value);
                filterSelect.focus();
            } catch (e) {
                console.error('[AccountStatus] email remove failed', e);
                removeBtn.disabled = false; removeBtn.dataset.confirm = ''; removeBtn.textContent = 'Remove';
            }
        }

        async function doReset(/** @type {string} */ name, /** @type {HTMLButtonElement} */ btn) {
            const ok = await confirmDialog({
                title: 'Reset password?',
                // Tracks the FORCED overlay (v21.94): `password-force.js` shipped at v18.92 and
                // `CONFIG.FORCE_PASSWORD_SET` is true, so a reset member is compelled to choose a
                // new password at their next sign-in. This used to send them to Settings instead.
                message: `Reset ${name}'s password back to their surname default and sign them out of their other devices? Tell them to sign in with their surname — the app will then ask them to choose a new one.`,
                confirmLabel: 'Reset', danger: true,
            });
            if (!ok) return;
            btn.disabled = true; btn.textContent = 'Resetting…';
            /** @type {any} */ let result;
            try {
                result = await resetMemberPassword(name, { revoke: true });
            } catch (e) {
                // Only a genuine RESET failure gets the Retry affordance.
                console.warn('[Operations] resetMemberPassword failed:', e);
                btn.disabled = false; btn.textContent = 'Retry';
                btn.title = 'Reset failed — try again shortly';
                return;
            }
            // PARTIAL SUCCESS. The endpoint reports each stage separately (v21.86) because the
            // password change is the irreversible one: once it lands, the account IS on the surname
            // default whatever else failed, and telling the admin otherwise invites them either to
            // reset again or to tell the member their old password still works.
            //
            // The message is BUILT from what happened rather than asserted. It used to say "and
            // their other sessions were signed out" unconditionally — true on the only partial path
            // that existed then, and a flat untruth on the one this release added.
            const _revokeFailed = result && result.revokeFailed === true;
            const _notStamped   = result && result.stamped === false;
            if (_revokeFailed || _notStamped) {
                console.warn('[Operations] resetMemberPassword partial for', name,
                             { revoked: result?.revoked, stamped: result?.stamped });
                const parts = [`${name}'s password WAS reset to their surname.`];
                // The security-relevant half leads, because it is the one with an action attached.
                if (_revokeFailed) {
                    parts.push('Their other devices could NOT be signed out, so an existing session there may still work. Reset again to retry that.');
                } else {
                    parts.push('Their other sessions were signed out.');
                }
                if (_notStamped) {
                    parts.push('The account-status stamp couldn\'t be saved, so the table below may still show "Own password".');
                }
                parts.push('Resetting again is safe.');
                confirmDialog({
                    title: _revokeFailed ? 'Password reset — other devices not signed out' : 'Password reset — status not updated',
                    message: parts.join('\n\n'),
                    confirmLabel: 'OK',
                }).catch(() => {});   // informational; the reset itself already succeeded
            }
            // Reset SUCCEEDED (member re-defaulted + signed out). The follow-up status re-read is
            // best-effort — if it fails, do NOT show "Retry"/"Reset failed" (that would prompt a
            // redundant second reset). Reflect the done state and let the next load reconcile the table.
            try {
                const fresh = await withClaimRetry(getAllPasswordStatus);
                statusMap = new Map(fresh.map(/** @param {any} s */ s => [s.memberName, s]));
                renderForGrade(filterSelect.value);   // the row re-renders → Reset drops off (now surname)
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
            emailMap  = new Map(contacts.filter(/** @param {any} c */ c => c.workEmail).map(/** @param {any} c */ c => [c.memberName, c.workEmail]));
            statusMap = new Map(statuses.map(/** @param {any} s */ s => [s.memberName, s]));
            content.removeAttribute('aria-busy');

            // Build the static chrome once (filter + summary + list), then render rows.
            content.innerHTML = '';
            const filterRow = document.createElement('div');
            filterRow.className = 'email-filter-row';
            filterSelect = document.createElement('select');
            filterSelect.id = 'acctGradeFilter';
            filterSelect.className = 'email-filter-select';
            filterSelect.setAttribute('aria-label', 'Filter by grade');
            [['', 'All grades'], ['CEA', 'CEA'], ['CES', 'CES'], ['Dispatcher', 'Dispatcher'], ['Management', 'Management']].forEach(([val, lbl]) => {
                const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl; filterSelect.appendChild(opt);
            });
            filterRow.appendChild(filterSelect);
            content.appendChild(filterRow);

            summaryEl = document.createElement('div');
            summaryEl.className = 'acct-summary';
            summaryEl.setAttribute('aria-live', 'polite');
            content.appendChild(summaryEl);

            listEl = document.createElement('div');
            listEl.className = 'acct-status-list';
            content.appendChild(listEl);

            filterSelect.addEventListener('change', () => renderForGrade(filterSelect.value));
            renderForGrade('');
        } catch {
            content.removeAttribute('aria-busy');   // announce "finished" even on a failed load (a11y)
            _cardLoadError(content, 'Couldn’t load the account status — check your connection.', () => initAccountStatus());
        }
    }
    initAccountStatus();

    // ============================================
    // PASSWORD RESET REQUESTS
    // ============================================
    // The queue behind the login overlay's "ask the admin to reset your password" link. Read-only here
    // plus a Clear; the actual reset is the Account status card's button directly below, so the two sit
    // adjacent. Written ONLY by the requestPasswordReset Cloud Function (no client can write the
    // collection — firestore.rules), and the name in each row came from the server-owned activeMembers
    // list, never from the request body, which is what makes it safe to render.
    let _rrLoading = false;
    let _rrReloadPending = false;
    async function initResetRequests() {
        const content = document.getElementById('resetRequestsContent');
        const chip    = document.getElementById('resetRequestsCountChip');
        if (!content) return;
        // Two Clears in quick succession each started their own load; whichever snapshot landed LAST
        // won, so an older one could repaint a just-deleted row as a ghost (v18.94).
        //
        // The v18.94 guard DROPPED the second refresh, which fixed the ordering but left a subtler
        // ghost (external review, v18.96): clear A → its refresh starts → clear B → B's refresh is
        // discarded → A's in-flight snapshot (taken before B was deleted) renders B back, and nothing
        // is queued to correct it. QUEUE the request instead of dropping it, so the last word always
        // belongs to a load started AFTER the last delete.
        if (_rrLoading) { _rrReloadPending = true; return; }
        _rrLoading = true;
        content.setAttribute('aria-busy', 'true');
        try {
            const requests = await getResetRequests();
            content.removeAttribute('aria-busy');
            if (chip) chip.textContent = requests.length ? String(requests.length) : '';
            attention.report('resets', requests.length);
            if (!requests.length) {
                // Same treatment as the Error Log's empty state (v21.72): both cards report that
                // nothing needs the admin's attention, and they said so in two different voices —
                // a green ✓ there, plain grey here. On a page of ten cards an admin scans for
                // trouble, "all clear" has to look the same wherever it appears, or the quieter
                // one reads as "not loaded yet".
                content.innerHTML = '<p class="email-count-done"><span aria-hidden="true">✓</span> No outstanding requests.</p>';
                return;
            }
            // Auto-open when there IS something to action — an outstanding request is time-sensitive
            // (someone is locked out right now) and this card is collapsed by default.
            openCard('resetRequestsBody', 'resetRequestsChevron');
            content.innerHTML = `<div class="rr-list">${requests.map(r => {
                // escapeHtml even though the writer is server-validated (v18.94). The allowlist IS the
                // control, but it sits three layers away with no test tying it to this render, and a
                // crafted name provably broke out of the data-member attribute — retargeting Clear at
                // another doc id. The two neighbouring cards on this page escape; so does this one now.
                const safeName = escapeHtml(r.memberName);
                const when = r.requestedAt?.toDate?.() ? _relativeTime(r.requestedAt.toDate()) : 'recently';
                const again = (Number(r.count) || 1) > 1 ? ` · asked ${Number(r.count)} times` : '';
                // provisioned === false means there is no Firebase account at all, so a Reset cannot
                // help — the remedy is Set up accounts. The login overlay deliberately cannot tell the
                // member which of the two it is (that would leak which names are provisioned); here it
                // saves the admin a wasted round trip.
                // Three states, not two (v18.94): the endpoint now OMITS `provisioned` when its Auth
                // lookup failed, rather than losing the whole request — so "absent" means unknown, and
                // saying "Reset below" for it would be a guess presented as fact.
                const remedy = r.provisioned === false
                    ? '<span class="rr-remedy rr-remedy--setup">No account yet — run Set up accounts</span>'
                    : r.provisioned === true
                        ? '<span class="rr-remedy">Reset below in Account status</span>'
                        : '<span class="rr-remedy">Check the account below</span>';
                return `<div class="rr-row">
                    <div class="rr-main"><strong>${safeName}</strong><span class="rr-when">${escapeHtml(when)}${again}</span></div>
                    ${remedy}
                    <button type="button" class="btn-rr-clear" data-member="${safeName}">Clear</button>
                </div>`;
            }).join('')}</div>`;
            content.querySelectorAll('.btn-rr-clear').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const name = /** @type {HTMLElement} */ (btn).dataset.member || '';
                    /** @type {HTMLButtonElement} */ (btn).disabled = true;
                    try { await clearResetRequest(name); initResetRequests(); }
                    catch { /** @type {HTMLButtonElement} */ (btn).disabled = false; }
                });
            });
        } catch {
            content.removeAttribute('aria-busy');
            // Clear the chip: leaving the previous count above an error panel told the admin "5
            // outstanding" while showing no list (v18.94).
            if (chip) chip.textContent = '';
            _cardLoadError(content, 'Couldn’t load the password reset requests — check your connection.', () => initResetRequests());
        } finally {
            _rrLoading = false;
            // Run the refresh that arrived mid-load, so a delete during a load is never the one whose
            // result is missing. Not awaited — this IS the tail of the load it was queued behind.
            if (_rrReloadPending) { _rrReloadPending = false; initResetRequests(); }
        }
    }
    initResetRequests();

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
                        { icon: '2️⃣', html: 'Choose the PDF roster file and tap <strong>Read roster</strong> — the app reads the shifts. It usually takes under a minute, sometimes a good deal longer — the spinner means it is still working' },
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
            'reset-requests': {
                title: '🙋 Password Reset Requests',
                sections: [{ items: [
                    { icon: '🔑', html: 'Staff who tap <strong>“ask the admin to reset your password”</strong> on the sign-in screen appear here. Nothing is reset automatically — <strong>you</strong> do it, from Account status below.' },
                    { icon: '⚠️', html: '<strong>Requests are not verified.</strong> The sign-in screen has no way to prove who is tapping, so anyone could file a request in someone else\'s name. <strong>Confirm with the member before resetting</strong> — a reset puts them back on their surname default and signs them out of their other devices.' },
                    { icon: '🆕', html: 'A row saying <strong>“No account yet”</strong> means there is no Firebase account to reset. Run <strong>Set up accounts</strong> instead.' },
                    { icon: '🧹', html: '<strong>Clear</strong> removes the row once you have dealt with it. If they ask again it comes back, with the count showing how many times.' },
                ]}],
            },
            'account-status': {
                title: 'Account status',
                sections: [
                    { heading: 'What it shows', items: [
                        { icon: '📧', html: 'Each person\'s <strong>work email</strong> — the address if they\'ve added one, or "No work email" if not. Used for <strong>self-service password reset in a future update</strong>; nothing uses it right now.' },
                        { icon: '🔑', html: 'Their <strong>password</strong> — either <strong>Own password</strong> (they\'ve set their own in ☰ → Settings → Password) or <strong>Surname default</strong> (still the guessable default).' },
                        { icon: '🔒', html: 'Each person can only see their <strong>own</strong> email; as admin you see everyone\'s. Use the <strong>All / CEA / CES / Dispatcher / Management</strong> filter to track each grade.' },
                    ]},
                    { heading: 'Work email', items: [
                        { icon: '⚙️', html: 'CEA, CES, and Dispatcher staff can add their own email in ☰ → <strong>Settings → Work Email</strong> — the easiest way to get them to register.' },
                        { icon: '📝', html: 'You can enter, edit, or remove an email on anyone\'s behalf with the <strong>Set email</strong> / <strong>Edit</strong> buttons — useful if they\'re having trouble, or for <strong>Management accounts</strong> (which have no Settings page of their own).' },
                    ]},
                    { heading: 'Resetting a password', items: [
                        // Both lines rewritten at v21.94: Reset is offered to EVERYONE (see
                        // `buildRow` — v18.84), and the new password is compelled, not optional.
                        { icon: '↩️', html: '<strong>Reset</strong> is offered next to <strong>everyone</strong>. Tap it if someone has forgotten their password — it goes back to their <strong>surname default</strong> and they\'re signed out of their other devices. Resetting an account that is already on the default is harmless, and still signs their other devices out.' },
                        { icon: '🔒', html: 'They sign in with their surname again, and the app then <strong>asks them to choose a new password</strong> before they can carry on.' },
                    ]},
                ],
            },
            'usage': {
                title: 'Usage',
                sections: [
                    { heading: 'What it shows', items: [
                        { icon: '👥', html: '<strong>Roster in use</strong> — how many <strong>member-and-device pairs</strong> opened the app this calendar month and over the last 30 days. Simply opening the app counts, <strong>including just looking at the roster without signing in</strong>' },
                        { icon: '🧮', html: 'It is not a headcount of people, which is why it is no longer labelled "accounts". One person on a phone <em>and</em> a laptop counts <strong>twice</strong>; on a shared device it follows <strong>whichever member is selected</strong>, who need not be the person holding it. For the exact count of distinct accounts, see the block below' },
                        { icon: '📈', html: 'That last part changed in <strong>August 2026</strong>. Before then this counted only people who opened a page you must sign in for, so it missed anyone who just reads their shifts — most of the staff. Expect a <strong>step up</strong> from that point; figures either side of it aren\'t comparable' },
                        { icon: '📊', html: '<strong>Page popularity</strong> — how many times each page has been opened this month, and how many times each document and guide has been opened' },
                    ]},
                    { heading: 'Which address staff are on', items: [
                        { icon: '\u{1F6A6}', html: 'While the app is served from <strong>two addresses</strong>, this shows how far the move has got — unique accounts on each over the last 30 days, and how many opened the <strong>installed</strong> app rather than a browser tab' },
                        { icon: '\u{1F4CD}', html: 'Someone using <strong>both</strong> addresses counts on each — that is what half-migrated looks like. An install nobody has <em>opened</em> in 30 days is invisible here, so treat it as a floor' },
                    ]},
                    { heading: 'Sign-ins vs opens', items: [
                        { icon: '\u{1F511}', html: '<strong>Accounts that have signed in</strong> is the exact unique count, from Firebase Auth itself. It counts <strong>sign-ins, not opens</strong> — a session lasts up to 60 days, so someone can sign in once and use the app daily for two months without ever appearing here again' },
                        { icon: '\u{1F423}', html: '<strong>Never signed in</strong> is the actionable one: accounts set up that have never been used' },
                        { icon: '\u{1F50D}', html: 'The <strong>gap</strong> between the two blocks is now readable: roughly the staff who use the roster but have <strong>never held an account session</strong>. They can\'t be reached by anything that happens at sign-in — a password prompt, for one' },
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
                        { icon: '🔴', html: 'If a page is <strong>consistently</strong> red across many opens, that\'s worth raising — it\'s not just one person on a bad connection' },
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
    initErrorLog({ onAttention: (n, extra) => attention.report('errors', n, extra) });
    initUsageCard();
    initPageSpeedCard();

    // ============================================
    // registerServiceWorker() moved to the top of init() (runs before the access gate) — v16.21.
    sessionReady.then(() => { initErrorReporter(); recordUsage('operations', currentUser); recordPageLatency('operations', currentUser); });
    // Forced set-password overlay (PASSWORD_PLAN.md Phase 2) — fire-and-forget, never on the login
    // critical path. Inside the sessionReady callback so `currentUser` is read LATE: on the in-place
    // sign-in path the module loaded signed-out and the identity is only refreshed inside
    // initAuthorised(), so passing it eagerly here would pass null and silently never compel anyone.
    sessionReady.then(() => initPasswordForce(currentUser));

}
