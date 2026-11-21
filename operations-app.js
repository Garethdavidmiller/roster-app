// @ts-check
/**
 * operations-app.js — Coordinator for operations.html.
 *
 * Owns: the access gate (signed out → the in-place sign-in; a non-admin → admin.html), Firebase
 *   Auth re-establishment, the Account status and reset-request cards, and the page's wiring.
 * Does NOT own: Huddle upload logic (huddle.js), roster PDF pipeline
 *   (admin-roster-upload.js), staff auth setup (admin-auth.js), the three reporting cards
 *   (operations-errors.js, -usage.js, -speed.js), the Needs-attention strip (operations-attention.js) or what
 *   Account status's Reset asks and says (operations-reset.js).
 * Edit here for: page-level session handling, card order, nav wiring.
 */

import { CONFIG, teamMembers, isValidEmail, isChilternWorkEmail, escapeHtml } from './roster-data.js';
import { auth, getAllStaffContacts, saveStaffContact, deleteStaffContact, getAllPasswordStatus, resetMemberPassword, getResetRequests, clearResetRequest, withClaimRetry } from './firebase-client.js';
import { isPasswordMigrated } from './auth-identity.js';
import { unconfirmedWriteLine } from './claim-retry.js';
import { _cardLoadError, _relativeTime } from './operations-reports.js';
import { initErrorLog } from './operations-errors.js';
import { createAttentionStrip, reportLoginAccounts, withdrawLoginAccounts } from './operations-attention.js';
import { initUsageCard } from './operations-usage.js';
import { initPageSpeedCard } from './operations-speed.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initDocumentUploadCards } from './operations-doc-uploads.js';
import { initDocLinksCard, docLinksRequestInFlight } from './operations-doc-links.js';
import { initAlSheetCard, alSheetBusy, alSheetUnsaved } from './operations-al-sheet.js';
import { initAuthSetup } from './admin-auth.js';
import { initDatePickers } from './date-picker.js';
import { initSelectSheets, enhanceSelect } from './select-sheet.js';
import { resetQuestion, resetFailure, resetOutcome } from './operations-reset.js';
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, getFirebaseAuthError, reconcileExpiredIdentity } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse, askBeforeSignOut, leaveAfterAsking } from './page-session.js';
import { requirePage, navGatesFor } from './auth-policy.js';
import { initCardCollapse, confirmDialog, confirmWithOption, createLightbox, registerPopInterceptor, suppressNextPop, whenHistorySettled } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { CARD_TIPS } from './operations-tips.js';
import { registerServiceWorker, reloadWhenNotBusy } from './sw-register.js';
import { withSlowSaveNotice, writesInFlight } from './slow-save.js';



/**
 * The coordinator body, called by operations-boot.js (CSP `script-src 'self'` blocks an inline module
 * call), so a test can import this module WITHOUT running it. The login and forbidden paths return early.
 */
export function init() {
    reloadIfRestoredForSomeoneElse();
    // Register the service worker UNCONDITIONALLY, before the access gate: a signed-out or non-admin
    // visit returns early below and would otherwise never register or update it.
    // An update reload waits — asked again at the moment of reloading — for the work a reload loses: a
    // roster upload REVIEW on screen, a roster PARSE (#rosterType disabled), a document UPLOAD
    // (`data-uploading`), any WRITE still on its way (`writesInFlight`, which includes one whose outcome
    // is UNKNOWN and so holds it for good — AUTH_AND_SESSIONS 22), and a Document links check or run,
    // whose report is the only record of what it did. An Annual leave sheet check, running or on
    // screen, holds an UPDATE; a tap waits only for its unsaved answers:
    const _opsBusy = () =>
        !!document.getElementById('rosterReviewSection')?.classList.contains('visible')
        || !!/** @type {HTMLSelectElement|null} */ (document.getElementById('rosterType'))?.disabled
        || !!document.querySelector('[data-uploading]')
        || writesInFlight() > 0
        || docLinksRequestInFlight();
    // a tap is the reader's own choice (operations-al-sheet.js).
    registerServiceWorker({ beforeReload: () => reloadWhenNotBusy(() => _opsBusy() || alSheetBusy()), isBusy: () => _opsBusy() || alSheetUnsaved() });
    // Tear down a privileged Firebase identity whose local session has expired, so a deep link cannot
    // keep an old credential live. Fire-and-forget and login-safe.
    reconcileExpiredIdentity().catch(() => {});   // it handles and logs its own failures; this only keeps an unexpected one from going unhandled
    // ============================================
    // SESSION — read from localStorage (shared with admin-app.js via session.js)
    // ============================================
    const currentSession = getSession();
    const currentUser    = currentSession?.name ?? null;

    // Page access (auth-policy.js): the local session maps to 'named' (the optimistic fast render) or
    // 'signedOut', and requirePage applies the Operations policy — admin only.
    const _access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'operations');
    if (_access.decision === 'login') {
        // Not signed in → the shared in-place sign-in. On success init() runs again, and the authorised
        // body below runs exactly ONCE. Do NOT resolveSession(false) here: sessionReady is one-shot.
        // A reload instead if init() throws, or if the session did not save (iOS private mode): the
        // 'login' branch again would find the overlay mounted and soft-lock on "Signed in…".
        const onSuccess = () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } };
        initLoginOverlay({ pageLabel: 'Operations', onSuccess });
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

    // Resolve sessionReady, which the feature modules (admin-auth.js, huddle.js) await.
    const _opsAuth = ensureNamedSession(currentUser);
    resolveSession(_opsAuth);
    // An own session that cannot be confirmed signs in again now; one revoked LATER does too
    // (page-session.js — the same follow-up every named page runs).
    guardNamedSession({ page: 'operations', pageLabel: 'Operations', member: currentUser, established: _opsAuth });
    // The admin-gated reads below go through `withClaimRetry`: just after "Set up accounts" the token
    // may not carry the `admin` claim yet, and one refresh picks it up.


    // ============================================
    // PAGE INIT
    // ============================================
    document.body.classList.add('auth-ready');
    // The page's content is on screen from this line (`.container` is hidden until `auth-ready`).
    markPageReady();

    // Assigned by the About-lightbox IIFE further down, before any drawer-logo tap can read it.
    /** @type {any} */
    let openAboutLightbox = null;

    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
        currentPage: 'operations',
        memberName:  currentUser,
        ...navGatesFor(currentUser),   // the pill gates (auth-policy.js); the page gate above already required the admin role
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   () => signOutAndLeave({ to: './' }), beforeSignOut: askBeforeSignOut(alSheetUnsaved),
    });

    initHuddleUpload({ currentIsAdmin: true, currentUser });
    initDocumentUploadCards({ currentUser });
    initDocLinksCard({ auth, askToConfirm: confirmDialog });
    initAlSheetCard();

    initRosterUpload({
        currentUser,
        currentIsAdmin: true,
        parseUrl:   'https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF',
        getIdToken: async () => { await sessionReady; return auth.currentUser?.getIdToken(); },
        // Nothing to re-read: this page has no Saved Changes list (and importing Admin's loads a dozen modules).
        loadOverrides: async () => {},
    });

    // Brand-styled date pickers over the four upload date fields. AFTER the card inits above,
    // which set each field's default value (today / next Saturday) that the trigger label reads.
    initDatePickers(['huddleDate', 'circularDate', 'newsletterDate', 'rosterWeekEnding']);

    // ...and the app's own dropdown over the roster-type select, missed by the sweep that did the
    // other six pages. It is disabled during a parse (fires no event — hence the observer).
    initSelectSheets([{ id: 'rosterType', title: 'Roster type' }], { createLightbox });

    // ============================================
    // COLLAPSIBLE CARD HEADERS
    // ============================================
    initCardCollapse('huddleToggleHeader',         'huddleBody',         'huddleChevron');
    initCardCollapse('circularUploadToggleHeader',    'circularUploadBody',    'circularUploadChevron');
    initCardCollapse('newsletterUploadToggleHeader', 'newsletterUploadBody', 'newsletterUploadChevron');
    initCardCollapse('docLinksToggleHeader',       'docLinksBody',       'docLinksChevron');
    initCardCollapse('rosterUploadToggleHeader',   'rosterUploadBody',   'rosterUploadChevron');
    initCardCollapse('alSheetToggleHeader',        'alSheetBody',        'alSheetChevron');
    const authSetupCard = initCardCollapse('authSetupToggleHeader',   'authSetupBody',   'authSetupChevron');
    // Wired ONCE here, not in initAccountStatus: its retry re-runs that, and initCardCollapse has no
    // idempotency guard (an even number of retries → a dead toggle).
    initCardCollapse('accountStatusToggleHeader', 'accountStatusBody', 'accountStatusChevron');
    // A card this page opens BY CODE keeps its handle: `setOpen` is the one place a card's open state
    // is written (card-collapse.js), and a hand-made second copy here could drift from what a tap does.
    const resetRequestsCard = initCardCollapse('resetRequestsToggleHeader', 'resetRequestsBody', 'resetRequestsChevron');
    const errorLogCard = initCardCollapse('errorLogToggleHeader',   'errorLogBody',   'errorLogChevron');
    initCardCollapse('usageToggleHeader',   'usageBody',   'usageChevron');
    initCardCollapse('pageSpeedToggleHeader',   'pageSpeedBody',   'pageSpeedChevron');

    // Deep links (a push lands here, on a page of collapsed cards): open that card and scroll to it. The
    // map is the allowlist, so an arbitrary hash can never expand an unrelated card. On load AND on
    // hashchange — a notification tap while the page is open fires only hashchange.
    /** @type {Record<string, [{ setOpen(open: boolean): void }, string]>} hash → [collapse handle, cardId] */
    const DEEP_LINK_CARDS = {
        '#reset-requests': [resetRequestsCard, 'resetRequestsCard'],
        '#error-log':      [errorLogCard,      'errorLogCard'],
        '#login-accounts': [authSetupCard,     'authSetupCard'],
    };
    /** @param {string} [hash] defaults to location.hash — the strip passes its own so a repeat
     *  tap (same hash, no hashchange) still opens and scrolls. */
    function openDeepLinkedCard(hash) {
        const target = DEEP_LINK_CARDS[hash || location.hash];
        if (!target) return;
        const [card, cardId] = target;
        // Only ever OPENS. Re-running on a repeat tap must not toggle a card the admin just closed.
        card.setOpen(true);
        document.getElementById(cardId)?.scrollIntoView({
            block: 'start',
            // Instant under prefers-reduced-motion.
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    }
    /** A deep link has done its job once its card is open, so the hash is STRIPPED: a second tap on
     *  the same notification is then a hash CHANGE, where a repeat of an unchanged hash fired nothing.
     *  A tap while this page is open (`refresh`) also re-reads what the card shows, which was read
     *  before the push came: the reset queue here, and the account audit — where the staff-PIN
     *  lockout's line is — through `authSetup` below. (The Error Log re-reads itself, from the event's
     *  own hash: operations-errors.js.) @param {string} hash @param {boolean} refresh */
    function followDeepLink(hash, refresh) {
        openDeepLinkedCard(hash);
        if (!refresh) return;
        if (hash === '#reset-requests') initResetRequests();
        if (hash === '#login-accounts') authSetup.refresh();
    }
    // A COLD deep link: the hash is on the page's own history entry, so it is rewritten in place.
    if (DEEP_LINK_CARDS[location.hash]) {
        const hash = location.hash;
        history.replaceState(history.state, '', location.pathname + location.search);
        followDeepLink(hash, false);   // on load each card's own first read (below) is the fresh one
    }
    // ── A TAP ON AN OPEN PAGE IS NOT A BACK PRESS, AND LEAVES NO DEAD ENTRY (whole-app check, 17 Nov 2026) ──
    // A notification tapped while Operations is open is a hash navigation of this page — as is a tap on
    // the strip's links — and that fires `popstate` before `hashchange`. overlay.js reads every popstate
    // as Android Back, so the tap closed whatever was open: "Reset password?" vanished under the
    // admin's thumb. The tap's popstate is claimed here instead, and the history entry it pushed is taken
    // back off (rewritten, it stayed behind as a Back press that did nothing). The Calendar's own hashes
    // have done this since 10 Nov 2026 — calendar-huddle-viewer.js `_consumeHashEntry` has the argument,
    // including why the card waits for the Back to land.
    registerPopInterceptor(() => Object.hasOwn(DEEP_LINK_CARDS, location.hash));
    window.addEventListener('hashchange', (e) => {
        let hash = '';
        try { hash = new URL(e.newURL).hash; } catch { /* not a URL: not a deep link */ }
        // The hash the event CARRIED, and only while it is still the page's: two hash changes in one
        // task each fire an event, and the earlier one must not take the later one's entry back.
        if (!Object.hasOwn(DEEP_LINK_CARDS, hash) || location.hash !== hash) return;
        try {
            history.back();
            suppressNextPop();   // the echo is ours, not a Back press
        } catch {
            history.replaceState(history.state, '', location.pathname + location.search);
        }
        whenHistorySettled(() => followDeepLink(hash, true));
    });
    // Back to a tab left open: the queue may have grown while it was hidden, and the audit's answer —
    // gaps, leavers, a PIN block begun or ended — may be out of date.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        // A REFRESH, not a re-open: the admin may have closed the card. The list and the chip still update.
        initResetRequests({ autoOpen: false });
        authSetup.refresh();
    });

    // The Needs-attention strip — an index the cards feed; it runs no reads of its own (operations-attention.js).
    const attention = createAttentionStrip({
        container: document.getElementById('attentionStrip'),
        onJump: (hash) => openDeepLinkedCard(hash),
    });

    // Staff Login Accounts, AFTER the strip exists — not left to timing. The audit feeds the strip only
    // when it ANSWERED (unreported is UNKNOWN, absent reads as nothing to do), and a check that fails
    // after one that answered WITHDRAWS what that one reported.
    const authSetup = initAuthSetup({
        currentIsAdmin: true,
        onAttention: (counts) => reportLoginAccounts(attention, counts),   // with the PIN lockout's (operations-attention.js)
        onWithdraw: () => withdrawLoginAccounts(attention),
    });

    // ============================================
    // ACCOUNT STATUS  (work email + password, per member)
    // ============================================
    // One per-member table joining getAllStaffContacts + getAllPasswordStatus (both admin-only): the work
    // email (Set/Edit/Remove) and the password posture with a break-glass Reset. PASSWORD_DESIGN.md §6.
    async function initAccountStatus() {
        const contentEl = document.getElementById('accountStatusContent');
        if (!contentEl) return;
        const content = /** @type {HTMLElement} */ (contentEl);
        // Eligible = active accounts + management (managerOnly: off the calendar but login-capable); no
        // leavers. Management have Settings too, so for them this card is a convenience, not the only route.
        const eligible = teamMembers.filter(m => !m.hidden || m.managerOnly);
        /** @type {Map<string, string>} name → work email */
        let emailMap = new Map();
        /** @type {Map<string, any>} name → passwordStatus doc */
        let statusMap = new Map();

        /** Migrated ⇔ passwordSetAt present AND at least as new as any admin resetAt (§6).
         *  isPasswordMigrated (auth-identity.js) is the single, unit-tested source. */
        const migrated = (/** @type {string} */ name) => isPasswordMigrated(statusMap.get(name));

        /** @type {HTMLSelectElement} */ let filterSelect;
        /** Focus the grade filter after a re-render has destroyed the row the admin was on. NOT
         *  `filterSelect.focus()` — the enhanced select is 1px and `aria-hidden`, so that sends a
         *  keyboard user off the page; the trigger is what they see. Rule: select-sheet-parity. */
        const focusGradeFilter = () =>
            /** @type {HTMLElement|null} */ (document.getElementById('acctGradeFilterTrigger') ?? filterSelect)?.focus();
        /** @type {HTMLElement} */ let summaryEl;
        /** @type {HTMLElement} */ let listEl;

        /** A row button's words and its name change TOGETHER, and the name LEADS with the words (WCAG 2.5.3:
         *  a voice user says what they see). @param {Element} btn @param {string} text @param {string} name */
        const say = (btn, text, name) => { btn.textContent = text; btn.setAttribute('aria-label', name); };
        const sayEmail = (/** @type {Element} */ btn, /** @type {string} */ nm) => (emailMap.has(nm)
            ? say(btn, 'Edit', `Edit email for ${nm}`) : say(btn, 'Set email', `Set email for ${nm}`));
        const sayReset = (/** @type {Element} */ btn, /** @type {string} */ nm) => say(btn, 'Reset', `Reset ${nm}'s password to their surname default`);
        const sayRemove = (/** @type {Element} */ btn, /** @type {string} */ nm) => say(btn, 'Remove', `Remove email for ${nm}`);

        // Close every open email form and restore each Set/Edit button to its resting label.
        function closeAllEmailForms() {
            listEl.querySelectorAll('.email-set-form').forEach(f => f.remove());
            listEl.querySelectorAll('.acct-row').forEach(r => {
                const b = r.querySelector('.email-set-btn');
                if (b) sayEmail(b, /** @type {HTMLElement} */ (r).dataset.member || '');
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

            // Head line: name · password posture · Reset, ALWAYS. The migration flag is not a security
            // control: its stamp can be lost after a real password change, and a row reading "Default"
            // must still offer the only in-app break-glass. Resetting a true default is harmless (and
            // still signs their other devices out).
            const head = document.createElement('div');
            head.className = 'acct-row-head';
            const nameEl = document.createElement('span');
            nameEl.className = 'acct-name';
            nameEl.textContent = m.name;
            // The NAME identifies the row, so at 375px it WRAPS rather than being cut — the short chip below
            // gives back the room, and no phone shows a `title` on long-press.
            const mig = migrated(m.name);
            const pwEl = document.createElement('span');
            pwEl.className = 'acct-pw' + (mig ? '' : ' acct-pw--warn');
            // "Default", not "Surname default": the card's key and its `?` panel say what the default IS.
            // The ✓ is decoration; "Own" is the whole statement.
            pwEl.innerHTML = mig ? '<span aria-hidden="true">✓</span> Own' : 'Default';
            head.append(nameEl, pwEl);
            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'btn-acct-reset';
            sayReset(resetBtn, m.name);
            resetBtn.addEventListener('click', () => doReset(m.name, resetBtn));
            head.appendChild(resetBtn);
            row.appendChild(head);

            // Email line: 📧 address + Edit/Remove, OR 📧 "No work email" + Set email.
            const emailLine = document.createElement('div');
            emailLine.className = 'acct-row-email';
            const has = emailMap.has(m.name);
            const emailText = document.createElement('span');
            emailText.className = 'acct-email' + (has ? '' : ' acct-email--none');
            // The whole address, wrapping where it must (operations.css → .acct-email): the 📧 held to it by a
            // no-break space, so it is never left alone on a line, and a break offered after the @ before any other.
            const addr = has ? String(emailMap.get(m.name)) : '', at = addr.indexOf('@') + 1;
            if (!has) emailText.textContent = '📧 No work email';
            else emailText.append(`📧\u00a0${addr.slice(0, at || addr.length)}`, ...(at ? [document.createElement('wbr'), addr.slice(at)] : []));
            emailLine.appendChild(emailText);

            const setBtn = document.createElement('button');
            setBtn.type = 'button';
            setBtn.className = 'email-set-btn';
            sayEmail(setBtn, m.name);
            setBtn.addEventListener('click', () => toggleEmailForm(row, emailLine, m, setBtn));
            emailLine.appendChild(setBtn);

            if (has) {
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'email-set-btn email-set-btn--remove';
                sayRemove(removeBtn, m.name);
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
            say(setBtn, 'Cancel', `Cancel editing the email for ${m.name}`);

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
                    // Every write here says when the server is slow to answer (slow-save.js).
                    await withSlowSaveNotice(saveStaffContact(m.name, email));
                    emailMap.set(m.name, email);
                    renderForGrade(filterSelect.value);
                    focusGradeFilter();
                } catch (e) {
                    console.error('[AccountStatus] email save failed', e);
                    // An UNKNOWN outcome says so and Save stays off — the gate would refuse a second (AUTH_AND_SESSIONS 21/22).
                    const unknown = unconfirmedWriteLine(e, 'this save', 'this list');
                    errorEl.textContent = unknown || 'Couldn\'t save — check your connection and try again';
                    saveBtn.disabled = !!unknown; saveBtn.textContent = 'Save';
                }
            });

            input.addEventListener('keydown', e => {   // not the Enter that accepts an input method's suggestion, which saved half-typed text
                if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveBtn.click(); }
                // Focus back to the button that opened the form, not to the page.
                if (e.key === 'Escape') { form.remove(); sayEmail(setBtn, m.name); setBtn.focus(); }
            });
        }

        async function removeEmail(/** @type {any} */ m, /** @type {HTMLButtonElement} */ removeBtn) {
            // Two-tap confirm (no dialog — keeps the inline row flow); auto-reverts after 3s.
            if (removeBtn.dataset.confirm !== 'pending') {
                removeBtn.dataset.confirm = 'pending';
                say(removeBtn, 'Confirm?', `Confirm? Press again to remove the email for ${m.name}`);
                setTimeout(() => {
                    if (removeBtn.dataset.confirm === 'pending') { removeBtn.dataset.confirm = ''; sayRemove(removeBtn, m.name); }
                }, 3000);
                return;
            }
            // Disarmed as the delete starts, or the revert above fires into it ("Removing…" → "Remove").
            removeBtn.dataset.confirm = ''; removeBtn.disabled = true; say(removeBtn, 'Removing…', `Removing the email for ${m.name}`);
            try {
                await withSlowSaveNotice(deleteStaffContact(m.name));
                emailMap.delete(m.name);
                renderForGrade(filterSelect.value);
                focusGradeFilter();
            } catch (e) {
                console.error('[AccountStatus] email remove failed', e);
                // Never silent: it says which kind of failure.
                const unknown = unconfirmedWriteLine(e, 'this removal', 'this list');
                removeBtn.disabled = !!unknown; removeBtn.dataset.confirm = ''; sayRemove(removeBtn, m.name);
                const msg = Object.assign(document.createElement('span'), { className: 'email-set-error', textContent: unknown || 'Couldn’t remove — check your connection and try again' });
                msg.setAttribute('role', 'alert'); msg.dataset.removeError = '';
                // Only ITS OWN earlier line: the first in the row may be the open edit form's.
                removeBtn.closest('.acct-row')?.querySelector('.email-set-error[data-remove-error]')?.remove();
                removeBtn.closest('.acct-row')?.append(msg);
            }
        }

        /** This member's Reset as the list holds it NOW — a re-draw replaces the row's button. @param {string} name */
        const resetBtnOf = (name) => /** @type {HTMLElement|null|undefined} */ (
            [...listEl.querySelectorAll('.acct-row')].find(r => /** @type {HTMLElement} */ (r).dataset.member === name)?.querySelector('.btn-acct-reset'));
        /**
         * Tell the admin what became of a reset, AFTER it: a report with one button, "OK". It had the
         * question's "Cancel" beside it, which reads as a way to undo a reset that has already happened
         * (whole-app check, 17 Nov 2026). Once it is read, focus goes back to the member's Reset: the
         * dialog hands it to the button that opened it, which the list's re-draw has usually replaced by
         * then, so it fell to the page — or, as the report closes, still sits on its hidden OK button.
         * @param {string} name @param {{ title?: string, message: string }} note
         */
        const report = (name, note) => confirmDialog({ ...note, confirmLabel: 'OK', cancelLabel: null })
            .then(() => {
                const at = document.activeElement;
                if (!at || at === document.body || at.closest('.dialog-overlay:not(.visible)')) resetBtnOf(name)?.focus();
            })
            // Fire-and-forget: nobody awaits a report, and the reset it describes has already happened, so a
            // failure here (the dialog, or handing focus back) is logged and nothing else — never a rejection
            // left unhandled in the console with no line to say what it was.
            .catch((/** @type {any} */ err) => console.warn('[Operations] The reset report could not be shown or closed:', err?.message));

        async function doReset(/** @type {string} */ name, /** @type {HTMLButtonElement} */ btn) {
            // Every word the admin reads about a reset — the question, its lost-phone box, each failure and
            // each outcome — is operations-reset.js's, beside the reasoning for what each one may claim.
            const { confirmed, option: lostDevice } = await confirmWithOption(resetQuestion(name));
            if (!confirmed) return;
            btn.disabled = true; say(btn, 'Resetting…', `Resetting ${name}'s password`);
            /** @type {any} */ let result;
            try {
                result = await resetMemberPassword(name, { lostDevice });
            } catch (e) {
                console.warn('[Operations] resetMemberPassword failed:', e);
                // A timeout or a refusal offers no Retry: one may have landed, the other cannot change.
                const { retry, note } = resetFailure(name, e);
                btn.disabled = false;
                if (retry) say(btn, 'Retry', `Retry resetting ${name}'s password`); else sayReset(btn, name);
                if (note) report(name, note);
                return;
            }
            // Built from the stages the answer reports — null when the row's receipt below says it all.
            const outcome = resetOutcome(name, result, { lostDevice });
            if (outcome) {
                console.warn('[Operations] resetMemberPassword partial for', name,
                             { revoked: result?.revoked, stamped: result?.stamped, notified: result?.notified, lostDevice: result?.lostDevice });
                report(name, outcome);   // informational; the reset itself already succeeded
            }
            // Reset SUCCEEDED. The status re-read is best-effort: if it fails, never show "Retry" (a
            // redundant second reset) — show done, and let the next load reconcile the table.
            const sayDone = (/** @type {Element} */ b) => say(b, 'Reset ✓', `Reset done for ${name} — press to reset their password again`);
            try {
                const fresh = await withClaimRetry(getAllPasswordStatus);
                statusMap = new Map(fresh.map(/** @param {any} s */ s => [s.memberName, s]));
                // The re-draw destroys this button; focus that was on it (or had already fallen to the
                // page, as it does from a disabled button) follows the row rather than vanishing.
                const follow = document.activeElement === btn || document.activeElement === document.body;
                renderForGrade(filterSelect.value);   // re-rendered — and a row on its default looks just as it did, so it says so (whole-app review)
                const again = resetBtnOf(name);
                if (again) { sayDone(again); if (follow) again.focus(); }
            } catch (e) {
                console.warn('[Operations] status refresh after reset failed (reset itself succeeded):', e);
                sayDone(btn);
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
            // Enhanced HERE, not in the page's `initSelectSheets` call: this select does not exist
            // at boot, so an id there would be skipped silently and for ever. Enhance where built.
            enhanceSelect(filterSelect, { title: 'Filter by grade', createLightbox });

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
    // The queue behind the sign-in's "ask the admin to reset your password": read-only plus a Clear; the
    // reset is Account status's button below. Written ONLY by requestPasswordReset (firestore.rules),
    // its names from the server-owned member list, never the request body.
    let _rrLoading = false;
    let _rrReloadPending = false;
    let _rrPendingOpen = false;   // a queued reload inherits the strongest ask it stood in for
    /** @param {{ autoOpen?: boolean }} [opts] */
    async function initResetRequests({ autoOpen = true } = {}) {
        const content = document.getElementById('resetRequestsContent');
        const chip    = document.getElementById('resetRequestsCountChip');
        if (!content) return;
        // A refresh during a load is QUEUED, never dropped or raced: the last word must belong to a load
        // started AFTER the last Clear, or an older snapshot repaints a cleared row as a ghost.
        if (_rrLoading) { _rrReloadPending = true; _rrPendingOpen = _rrPendingOpen || autoOpen; return; }
        _rrLoading = true;
        content.setAttribute('aria-busy', 'true');
        try {
            // After the session, and through the claim-retry, like the page's other admin reads.
            await sessionReady;
            const requests = await withClaimRetry(getResetRequests);
            content.removeAttribute('aria-busy');
            if (chip) chip.textContent = requests.length ? String(requests.length) : '';
            attention.report('resets', requests.length);
            if (!requests.length) {
                // "All clear" looks the same as the Error Log's, or the quieter one reads as "not loaded yet".
                content.innerHTML = '<p class="email-count-done"><span aria-hidden="true">✓</span> No outstanding requests.</p>';
                return;
            }
            // Auto-open when there IS something to action — an outstanding request is time-sensitive
            // (someone is locked out right now) and this card is collapsed by default.
            if (autoOpen) resetRequestsCard.setOpen(true);
            content.innerHTML = `<div class="rr-list">${requests.map(r => {
                // Escaped although the writer is server-validated: that control is three layers away, and
                // a crafted name could break out of data-member and retarget Clear.
                const safeName = escapeHtml(r.memberName);
                const when = r.requestedAt?.toDate?.() ? _relativeTime(r.requestedAt.toDate()) : 'recently';
                const again = (Number(r.count) || 1) > 1 ? ` · asked ${Number(r.count)} times` : '';
                // No account (or a DISABLED one, which a reset refuses): the remedy is Set up accounts. The
                // sign-in cannot tell the member (it would leak who is provisioned); here it saves a wasted
                // round trip. An ABSENT `provisioned` means the lookup failed — unknown, so no guess.
                const remedy = r.provisioned === false || r.disabled === true
                    ? `<span class="rr-remedy rr-remedy--setup">${r.disabled === true ? 'Account disabled' : 'No account yet'} — run Set up accounts</span>`
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
                    const row = btn.closest('.rr-row');
                    row?.querySelector('.rr-error')?.remove();
                    try { await withSlowSaveNotice(clearResetRequest(name)); initResetRequests(); }
                    catch (e) {
                        // An UNKNOWN outcome is said so, and the button stays off: the gate would refuse a second.
                        const unknown = unconfirmedWriteLine(e, 'this clear', 'this list');
                        /** @type {HTMLButtonElement} */ (btn).disabled = !!unknown;
                        const msg = document.createElement('span');
                        msg.className = 'rr-error'; msg.setAttribute('role', 'alert');
                        msg.textContent = unknown || 'Couldn’t clear — check your connection and try again.';
                        // The list may have been redrawn while the delete was out (a queued reload, a
                        // notification tap): report on the row that is on the page NOW, not the old one.
                        const live = row?.isConnected ? row
                            : [...content.querySelectorAll('.btn-rr-clear')].find(b => /** @type {HTMLElement} */ (b).dataset.member === name)?.closest('.rr-row');
                        if (live && live !== row && unknown) /** @type {HTMLButtonElement|null} */ (live.querySelector('.btn-rr-clear'))?.setAttribute('disabled', '');
                        live?.querySelector('.rr-error')?.remove();
                        live?.append(msg);
                    }
                });
            });
        } catch {
            content.removeAttribute('aria-busy');
            if (chip) chip.textContent = '';   // a stale count above an error panel
            // The strip says it couldn't check: an absent item would read as nothing outstanding (owner, 10 Nov 2026).
            attention.unchecked('resets');
            _cardLoadError(content, 'Couldn’t load the password reset requests — check your connection.', () => initResetRequests());
        } finally {
            _rrLoading = false;
            // Run the refresh that arrived mid-load, so a delete during a load is never the one whose
            // result is missing. Not awaited — this IS the tail of the load it was queued behind.
            if (_rrReloadPending) { const open = _rrPendingOpen; _rrReloadPending = false; _rrPendingOpen = false; initResetRequests({ autoOpen: open }); }
        }
    }
    initResetRequests();

    // A banner when this admin's Firebase session could not be confirmed: the uploads, the reset and the
    // function reads all need a valid admin token, and each would otherwise fail with less to say.
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
    // ICON LIGHTBOX — About panel (shared about-lightbox.js)
    // ============================================
    (function () {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Operations',
            getUserName: () => currentUser,
        });
        if (about) openAboutLightbox = about.open;

        wireHeaderLogo(() => leaveAfterAsking(alSheetUnsaved, () => { window.location.href = './'; }));   // asks first, as the drawer does
    })();

    // ============================================
    // TIPS LIGHTBOX — ? button on each card
    // Lifecycle, renderer and button wiring live in tips-lightbox.js; the content is operations-tips.js.
    // ============================================
    initTipsLightbox(CARD_TIPS);

    // ============================================
    // ERROR LOG CARD
    // ============================================
    initErrorLog({ onAttention: (n, extra) => attention.report('errors', n, extra), onWithdraw: () => attention.withdraw('errors') });
    initUsageCard();
    initPageSpeedCard();

    sessionReady.then(() => { initErrorReporter(); recordUsage('operations', currentUser); recordPageLatency('operations', currentUser); });
    // Forced set-password overlay — fire-and-forget, with the session as its barrier, so the sign-in's one-shot
    // marker is spent as the page opens (password-force.js). `currentUser` is right here: an in-place sign-in
    // re-runs init(), and only that signed-in pass gets this far.
    initPasswordForce(currentUser, { ready: sessionReady });

}
