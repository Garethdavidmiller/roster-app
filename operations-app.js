// @ts-check
/**
 * operations-app.js — Coordinator for operations.html.
 *
 * Owns: the access gate (signed out → the in-place sign-in; a non-admin → admin.html), Firebase
 *   Auth re-establishment, the Account status and reset-request cards, and the page's wiring.
 * Does NOT own: Huddle upload logic (huddle.js), roster PDF pipeline
 *   (admin-roster-upload.js), staff auth setup (admin-auth.js), the three reporting cards
 *   (operations-errors.js, -usage.js, -speed.js) or the Needs-attention strip (operations-attention.js).
 * Edit here for: page-level session handling, card order, nav wiring.
 */

import { CONFIG, teamMembers, isValidEmail, isChilternWorkEmail, escapeHtml } from './roster-data.js';
import { auth, getAllStaffContacts, saveStaffContact, deleteStaffContact, getAllPasswordStatus, resetMemberPassword, getResetRequests, clearResetRequest, uploadCircular, uploadNewsletter, withClaimRetry } from './firebase-client.js';
import { isPasswordMigrated } from './auth-identity.js';
import { unconfirmedWriteLine } from './claim-retry.js';
import { _cardLoadError, _relativeTime } from './operations-reports.js';
import { initErrorLog } from './operations-errors.js';
import { createAttentionStrip } from './operations-attention.js';
import { initUsageCard } from './operations-usage.js';
import { initPageSpeedCard } from './operations-speed.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { initRosterUpload } from './admin-roster-upload.js';
import { initHuddleUpload } from './huddle.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';
import { initDocLinksCard, docLinksRequestInFlight } from './operations-doc-links.js';
import { initAuthSetup } from './admin-auth.js';
import { initDatePickers } from './date-picker.js';
import { initSelectSheets, enhanceSelect } from './select-sheet.js';
import { isFetchTimeout, serverRefusal } from './fetch-timeout.js';
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, getFirebaseAuthError, reconcileExpiredIdentity } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse } from './page-session.js';
import { requirePage, canOpenOvertime, canOpenNewlink } from './auth-policy.js';
import { initCardCollapse, confirmDialog, createLightbox } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { CARD_TIPS } from './operations-tips.js';
import { registerServiceWorker, reloadWhenNotBusy } from './sw-register.js';
import { withSlowSaveNotice, writesInFlight } from './slow-save.js';



/**
 * Phase 4a.2 (AUTH_ARCHITECTURE.md): the coordinator body is an exported init()
 * called by operations-boot.js (a 2-line bootstrap — CSP `script-src 'self'`
 * blocks inline module scripts). This replaces the former top-level `throw`s
 * (which aborted module evaluation on the login/forbidden paths) with explicit
 * early `return`s, and lets a test import this module WITHOUT auto-running it.
 * Body unchanged otherwise — same statements, same order, one indent level in.
 */
export function init() {
    reloadIfRestoredForSomeoneElse();
    // Register the service worker UNCONDITIONALLY, before the access gate — a signed-out (or
    // non-admin) visit returns early below and would otherwise never register/update the SW for
    // that page load (v16.21). Settings registers before its sign-in decision too.
    // Defer an SW-update reload while an admin is mid-way through a Weekly Roster Upload REVIEW —
    // the one piece of unsaved, in-flight work on this page (uncommitted review edits would be lost
    // on a reload). #rosterReviewSection carries `.visible` only while a review table is on screen;
    // otherwise reload immediately. Mirrors admin-app.js's hasUnsavedChanges guard. (v18.29)
    // A roster PARSE in flight (the form is locked, #rosterType disabled) and a document UPLOAD in
    // flight (doc-upload.js marks its button `data-uploading`) are in-flight work too: a reload
    // mid-way loses the parse's answer, or leaves an upload unconfirmed (Sep 2026 review).
    // Asked again at the moment of reloading (v24.61): the `{ once: true }` listener this replaced
    // reloaded on the FIRST hide whether or not the review, parse or upload had finished — and if it
    // had not, the one chance was spent and the page never reloaded for that release at all.
    // And a WRITE still on its way holds it, read from the writes themselves (`writesInFlight`, as
    // Admin and Settings do) rather than from the screen: a roster save in several parts whose review
    // was dismissed is invisible to the three checks above, and a reload between parts strands the
    // rest (Nov 2026 review). That count includes a write whose outcome is UNKNOWN, which holds the
    // reload for good (v25.21; AUTH_AND_SESSIONS invariant 22): in a second tab Firestore keeps it in
    // memory only, so a reload could lose it. The reader was told to reload; that is theirs to do.
    // And a Document links check or run still waiting for its answer holds it too (v25.92): a run can
    // take minutes, and its report is the only record of what it did (operations-doc-links.js).
    const _opsBusy = () =>
        !!document.getElementById('rosterReviewSection')?.classList.contains('visible')
        || !!/** @type {HTMLSelectElement|null} */ (document.getElementById('rosterType'))?.disabled
        || !!document.querySelector('[data-uploading]')
        || writesInFlight() > 0
        || docLinksRequestInFlight();
    registerServiceWorker({ beforeReload: () => reloadWhenNotBusy(_opsBusy), isBusy: _opsBusy });
    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Fire-and-forget, login-safe: no-op on a valid session, stands down if a login supersedes it.
    reconcileExpiredIdentity().catch(() => {});
    // ============================================
    // SESSION — read from localStorage (shared with admin-app.js via session.js)
    // ============================================
    const currentSession = getSession();
    const currentUser    = currentSession?.name ?? null;

    // Page-access decision via the Phase-3 policy (auth-policy.js → AUTH_ARCHITECTURE.md Phase 4a).
    // The "local-derived" snapshot maps the localStorage session to an identity status — present →
    // 'named' (today's optimistic fast render from local), absent → 'signedOut' — and requirePage
    // applies the Operations policy (admin-only). Behaviour is identical to the prior two-gate form;
    // this routes the same decision through the shared authz layer instead of inline checks.
    const _access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'operations');
    if (_access.decision === 'login') {
        // Not signed in → show the shared in-place sign-in (no redirect). On success, re-invoke init()
        // in place: the authorised body below never ran on this pass (we return now), so re-entering
        // runs it exactly ONCE with the just-saved session — no reload, no double-wiring. Do NOT
        // resolveSession(false) here, or the one-shot sessionReady would be poisoned before the
        // in-place pass can resolve it true.
        // In-place re-invocation falls back to a reload if init() throws mid-wiring, so the in-place
        // path is never less robust than the reload path (the overlay is already torn down by then).
        // If saveSession silently failed (iOS private mode — lsSet swallows the error), getSession()
        // is still null, so re-invoking init() would re-enter the 'login' branch where
        // initLoginOverlay no-ops (overlay already mounted) and the button stays stuck on
        // "Signed in…" — a soft-lock. Reload instead to present a fresh, usable overlay.
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

    // Resolve sessionReady so admin-auth.js and huddle.js (feature modules) can
    // import sessionReady and await it instead of reading window._mybSession.
    const _opsAuth = ensureNamedSession(currentUser);
    resolveSession(_opsAuth);
    // B1.2 enforcement, now decided via the policy. Once the named session resolves, the store (fed by
    // the Phase-2 bridge inside ensureNamedSession) reflects the terminal Firebase identity, so
    // `requirePage(getAuthSnapshot(), 'operations')` returns 'login' exactly when the member's OWN
    // named session could not be confirmed.
    // An own session that cannot be confirmed signs in again now; one revoked LATER does too
    // (page-session.js — the same follow-up every named page runs).
    guardNamedSession({ page: 'operations', pageLabel: 'Operations', member: currentUser, established: _opsAuth });

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
        canOpenOvertime: canOpenOvertime(currentUser), canOpenNewlink: canOpenNewlink(currentUser),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   () => signOutAndLeave({ to: './' }),
    });

    initHuddleUpload({ currentIsAdmin: true, currentUser });
    initCircularUpload();
    initNewsletterUpload();
    initDocLinksCard({ auth, askToConfirm: confirmDialog });

    initRosterUpload({
        currentUser,
        currentIsAdmin: true,
        parseUrl:   'https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF',
        getIdToken: async () => { await sessionReady; return auth.currentUser?.getIdToken(); },
        // Nothing to re-read: this page has no Saved Changes list. Admin's loadOverrides returned at once
        // here (no member picker), and importing it loaded a dozen Admin modules (Nov 2026 review).
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
    const authSetupCard = initCardCollapse('authSetupToggleHeader',   'authSetupBody',   'authSetupChevron');
    // Account status collapse wired ONCE here (not inside initAccountStatus) — its _cardLoadError
    // retry re-invokes initAccountStatus, and initCardCollapse has no idempotency guard, so wiring it
    // there would add a duplicate listener per failed load (an even number of retries → dead toggle).
    initCardCollapse('accountStatusToggleHeader', 'accountStatusBody', 'accountStatusChevron');
    // A card this page opens BY CODE keeps its handle: `setOpen` is the one place a card's open state
    // is written (card-collapse.js), and a hand-made second copy here could drift from what a tap does.
    const resetRequestsCard = initCardCollapse('resetRequestsToggleHeader', 'resetRequestsBody', 'resetRequestsChevron');
    const errorLogCard = initCardCollapse('errorLogToggleHeader',   'errorLogBody',   'errorLogChevron');
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
            // Under prefers-reduced-motion the jump is instant: a notification tap should not
            // throw the page around for somebody who has asked for less motion.
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    }
    /** A deep link has done its job once its card is open, so the hash is STRIPPED: a second tap on
     *  the same notification is then a hash CHANGE, where a repeat of an unchanged hash fired nothing.
     *  And a reset-request tap while this page is already open REFRESHES the queue — it was read when
     *  the page loaded, so the new request was not in it (Sep 2026 review). */
    function followDeepLink(/** @type {boolean} */ refresh) {
        if (!DEEP_LINK_CARDS[location.hash]) return;
        const hash = location.hash;
        openDeepLinkedCard(hash);
        history.replaceState(history.state, '', location.pathname + location.search);
        if (refresh && hash === '#reset-requests') initResetRequests();
    }
    followDeepLink(false);   // on load the queue's own first read (below) is the fresh one
    window.addEventListener('hashchange', () => followDeepLink(true));
    // Back to a tab left open: the queue may have grown while it was hidden.
    document.addEventListener('visibilitychange', () => {
        // A REFRESH, not a re-open (48-hour review): the admin may have closed the card, and every
        // return to the tab forced it open again. The list and the count chip still update.
        if (document.visibilityState === 'visible') initResetRequests({ autoOpen: false });
    });

    // The Needs-attention strip (v22.03) — an index the cards feed; it runs no reads of its own
    // (operations-attention.js header has the three refusals that ARE the design).
    const attention = createAttentionStrip({
        container: document.getElementById('attentionStrip'),
        onJump: (hash) => openDeepLinkedCard(hash),
    });

    // Staff Login Accounts. AFTER the strip exists, deliberately — `onAttention` fires from an async
    // read so a `const` declared below would happen to work, and "happens to work by timing" is not
    // a thing to leave in a file this long. The audit feeds the strip only when it ANSWERED:
    // admin-auth.js reports nothing on a failed or refused check, because an unreported item is
    // UNKNOWN to the strip while an absent one reads as nothing to do — and a check that fails after
    // one that answered WITHDRAWS what that one reported, so the strip goes back to unknown with it.
    initAuthSetup({
        currentIsAdmin: true,
        onAttention: ({ setUp, leavers }) => {
            attention.report('accountSetup', setUp);
            attention.report('accountLeavers', leavers);
        },
        onWithdraw: () => { attention.withdraw('accountSetup'); attention.withdraw('accountLeavers'); },
    });

    // ============================================
    // ACCOUNT STATUS  (work email + password, per member)
    // ============================================
    // The single per-member account-admin table (v18.65 — merged from the former Work Email Progress
    // + Account status cards, which duplicated the email column). Joins getAllStaffContacts +
    // getAllPasswordStatus (both admin-only reads) and renders, per member: the work email (address +
    // Set/Edit/Remove) and the password posture (own password vs surname default + a break-glass
    // Reset). Grade filter + two count summaries. PASSWORD_DESIGN.md §6.
    async function initAccountStatus() {
        const contentEl = document.getElementById('accountStatusContent');
        if (!contentEl) return;
        const content = /** @type {HTMLElement} */ (contentEl);
        // Eligible = active accounts + management (managerOnly: hidden from the calendar but login-capable).
        // Excludes leavers. Management DO have Settings — `auth-policy.js` gates it on `requireNamed`
        // with no role — so this card is a convenience for doing it on their behalf, not the only
        // route. This comment said otherwise until v23.36; the same claim was corrected in the
        // `account-status` tip below and not carried back here.
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

        /** A row button's words and its name change TOGETHER, and the name LEADS with the words (WCAG
         *  2.5.3, Nov 2026 review): fixed names went on describing buttons whose words had changed —
         *  "Cancel", "Confirm?", "Retry" — and "Set email" was named "Set work email for …", so a voice
         *  user saying what they saw reached nothing. @param {Element} btn @param {string} text @param {string} name */
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

            // Head line: name · password posture · Reset (ALWAYS — v18.84). Reset used to render only
            // for a MIGRATED member ("a surname-default account has nothing to reset TO"), which quietly
            // made the migration flag a security control. It isn't one: changeOwnPassword deliberately
            // tolerates the Firestore stamp failing after updatePassword has already succeeded (its
            // stamp settles false and its own JSDoc calls the stamp "a monitoring signal, not
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
            // characters on all 51 rows kept its full width (v21.72). The chip below gives back the
            // space that caused it — and since v23.50 the name WRAPS rather than ellipsising, because
            // the `title` this line used to set "restored it on long-press" only on paper: no phone
            // shows a title on long-press, so on the device this card is read on the name was cut.
            const mig = migrated(m.name);
            const pwEl = document.createElement('span');
            pwEl.className = 'acct-pw' + (mig ? '' : ' acct-pw--warn');
            // "Default", not "Surname default": the word repeated verbatim down every unmigrated
            // row and the card's own key explains what the default IS. The full wording stays in
            // the card's key and its `?` panel — this line used to say "and in the title here",
            // which stopped being true at v23.50 when every tooltip in the app went.
            // The ✓ is decoration; "Own" is the whole statement, on ~50 rows (v21.94).
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
                    // Every write on this page says when the server is slow to answer, as Admin's and
                    // Settings' do (slow-save.js), rather than sitting on "Saving…" (Nov 2026 review).
                    await withSlowSaveNotice(saveStaffContact(m.name, email));
                    emailMap.set(m.name, email);
                    renderForGrade(filterSelect.value);
                    focusGradeFilter();
                } catch (e) {
                    console.error('[AccountStatus] email save failed', e);
                    // An UNKNOWN outcome says so and Save stays off — a second save would only be refused by
                    // the gate (AUTH_AND_SESSIONS 21/22; the reset-requests Clear already did, v25.06).
                    const unknown = unconfirmedWriteLine(e, 'this save', 'this list');
                    errorEl.textContent = unknown || 'Couldn\'t save — check your connection and try again';
                    saveBtn.disabled = !!unknown; saveBtn.textContent = 'Save';
                }
            });

            input.addEventListener('keydown', e => {   // not the Enter that accepts an input method's suggestion, which saved half-typed text
                if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveBtn.click(); }
                // Focus back to the button that opened the form, not to the page (Nov 2026 review).
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
                // It used to fail SILENTLY — the button just came back. Now it says which kind (v25.06).
                const unknown = unconfirmedWriteLine(e, 'this removal', 'this list');
                removeBtn.disabled = !!unknown; removeBtn.dataset.confirm = ''; sayRemove(removeBtn, m.name);
                const msg = Object.assign(document.createElement('span'), { className: 'email-set-error', textContent: unknown || 'Couldn’t remove — check your connection and try again' });
                msg.setAttribute('role', 'alert'); msg.dataset.removeError = '';
                // Only ITS OWN earlier line (48-hour review): the first in the row was the open edit
                // form's, and its next save failure then wrote to a detached element.
                removeBtn.closest('.acct-row')?.querySelector('.email-set-error[data-remove-error]')?.remove();
                removeBtn.closest('.acct-row')?.append(msg);
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
            btn.disabled = true; say(btn, 'Resetting…', `Resetting ${name}'s password`);
            /** @type {any} */ let result;
            try {
                result = await resetMemberPassword(name);
            } catch (e) {
                console.warn('[Operations] resetMemberPassword failed:', e);
                // A TIMEOUT IS NOT A FAILURE, and `fetch-timeout.js`'s header names THIS endpoint
                // when it says so: the abort stopped us waiting, it did not stop the server
                // working. A reset that timed out may have landed a second later — the member's
                // password may already BE their surname and their other devices already signed
                // out. Reporting that as "Reset failed" is how an admin comes to tell a member
                // their old password still works, on the app's only break-glass path.
                //
                // `firebase-client.js` already composes the honest sentence and hangs the tagged
                // original off `cause`; this used to discard both into a console warning. The
                // sibling break-glass path on this page (admin-auth.js's Set up accounts) renders
                // `err.message`, so its equivalent message has always reached the admin — this one
                // was the exception.
                if (isFetchTimeout(/** @type {any} */ (e)?.cause)) {
                    // NOT "Retry": the button must not describe an outcome nobody knows.
                    btn.disabled = false; sayReset(btn, name);
                    confirmDialog({
                        title: 'Couldn’t confirm the reset',
                        message: `The reset for ${name} was sent, but the server didn’t answer in time. It may still have gone through — their password may already be their surname, and their other devices already signed out.\n\nReload this page and check ${name}'s row before resetting again. Resetting again is safe.`,
                        confirmLabel: 'OK',
                    }).catch(() => {});
                    return;
                }
                // A REFUSAL (4xx) names its reason and offers no Retry — retrying cannot change the answer (whole-app review).
                const refused = serverRefusal(e);
                btn.disabled = false;
                if (refused) sayReset(btn, name); else say(btn, 'Retry', `Retry resetting ${name}'s password`);
                // The endpoint refuses in JSON sentences written for the admin, all before it changes
                // anything. A body that is MARKUP is not a reason (an HTML error page from in front of the
                // function), so it is not shown as one (Nov 2026 review).
                const why = refused && (/<[a-z!/]/i.test(refused.reason)
                    ? `The server answered ${refused.status} without a reason this page can show. Nothing was reset.` : refused.reason);
                if (why) confirmDialog({ title: 'The reset was refused', message: why, confirmLabel: 'OK' }).catch(() => {});
                // A 503 is the server saying, BEFORE it changed anything, that it could not record the
                // reset — no stamp, no reset (functions-core-2, Nov 2026). Retry is the right answer, and
                // its sentence says nothing changed, so it is shown beside the button rather than lost.
                const unrecorded = !refused && /^Server responded 503: ([\s\S]*)$/.exec(String(/** @type {any} */ (e)?.message ?? ''));
                if (unrecorded) {
                    let line = unrecorded[1].trim();
                    try { const parsed = JSON.parse(line); line = typeof parsed?.error === 'string' ? parsed.error : ''; } catch { line = ''; }
                    if (line && !/<[a-z!/]/i.test(line)) confirmDialog({ title: 'The reset didn’t go through', message: line, confirmLabel: 'OK' }).catch(() => {});
                }
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
            // v23.62: the member is now told on their OWN devices that their password was reset.
            // This is the one notification state worth a receipt — they were signed OUT and could
            // not be reached, so they are locked out with no explanation and the admin is the only
            // one who can close that gap. Deliberately NOT shown when the reset left their sessions
            // running: nobody is stranded, so there is nothing to act on.
            // `notified` is what HAPPENED, so a member with no push subscription lands here — which
            // is the point, since that is exactly who needs telling another way.
            // v24.57: an account registered from OUTSIDE the app was taken back rather than reset.
            // It holds no claim yet, so the member cannot use it until Set up accounts runs.
            const _takenBack    = result && result.takenBack === true;
            const _uninformed   = !_takenBack && !!(result && result.notified === false && result.revoked === true);
            if (_revokeFailed || _uninformed || _takenBack) {
                console.warn('[Operations] resetMemberPassword partial for', name,
                             { revoked: result?.revoked, stamped: result?.stamped, notified: result?.notified });
                const parts = [`${name}'s password WAS reset to their surname.`];
                // The security-relevant half leads, because it is the one with an action attached.
                if (_revokeFailed) {
                    parts.push('Their other devices could NOT be signed out, so an existing session there may still work. Reset again to retry that.');
                } else {
                    parts.push('Their other sessions were signed out.');
                }
                // No "couldn't be recorded" case here any more: since functions-core-2 (Nov 2026) the
                // server stamps resetAt FIRST and refuses with a 503 when it cannot, so a reset that
                // happened was always recorded — the 503 is handled above, beside Retry.
                if (_takenBack) {
                    parts.push(`This account had been registered outside the app, so it was taken back: anyone signed in on it was signed out. Run Set up accounts next — until then ${name} cannot use the app on it. Then let them know their password is their surname.`);
                }
                if (_uninformed) {
                    parts.push(`${name} has no notifications on this app, so they have NOT been told. Let them know their password is now their surname and they are signed out.`);
                }
                parts.push('Resetting again is safe.');
                confirmDialog({
                    // Precedence, most actionable first: a live session somewhere is a security state; an
                    // account taken back waits on Set up accounts; and an untold member is an errand.
                    title: _revokeFailed ? 'Password reset — other devices not signed out'
                         : _takenBack    ? 'Account taken back — run Set up accounts'
                         :                 'Password reset — tell them yourself',
                    message: parts.join('\n\n'),
                    confirmLabel: 'OK',
                }).catch(() => {});   // informational; the reset itself already succeeded
            }
            // Reset SUCCEEDED (member re-defaulted + signed out). The follow-up status re-read is
            // best-effort — if it fails, do NOT show "Retry"/"Reset failed" (that would prompt a
            // redundant second reset). Reflect the done state and let the next load reconcile the table.
            const sayDone = (/** @type {Element} */ b) => say(b, 'Reset ✓', `Reset done for ${name} — press to reset their password again`);
            try {
                const fresh = await withClaimRetry(getAllPasswordStatus);
                statusMap = new Map(fresh.map(/** @param {any} s */ s => [s.memberName, s]));
                // The re-draw destroys this button; focus that was on it (or had already fallen to the
                // page, as it does from a disabled button) follows the row rather than vanishing.
                const follow = document.activeElement === btn || document.activeElement === document.body;
                renderForGrade(filterSelect.value);   // re-rendered — and a row on its default looks just as it did, so it says so (whole-app review)
                const again = /** @type {HTMLElement|null|undefined} */ ([...listEl.querySelectorAll('.acct-row')].find(r => /** @type {HTMLElement} */ (r).dataset.member === name)?.querySelector('.btn-acct-reset'));
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
    // The queue behind the login overlay's "ask the admin to reset your password" link. Read-only here
    // plus a Clear; the actual reset is the Account status card's button directly below, so the two sit
    // adjacent. Written ONLY by the requestPasswordReset Cloud Function (no client can write the
    // collection — firestore.rules), and the name in each row came from the server-owned activeMembers
    // list, never from the request body, which is what makes it safe to render.
    let _rrLoading = false;
    let _rrReloadPending = false;
    let _rrPendingOpen = false;   // a queued reload inherits the strongest ask it stood in for
    /** @param {{ autoOpen?: boolean }} [opts] */
    async function initResetRequests({ autoOpen = true } = {}) {
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
        if (_rrLoading) { _rrReloadPending = true; _rrPendingOpen = _rrPendingOpen || autoOpen; return; }
        _rrLoading = true;
        content.setAttribute('aria-busy', 'true');
        try {
            // Like the other admin reads on this page: after the session exists, and through the
            // claim-retry, so a stale token is refreshed once instead of reading as a failed load.
            await sessionReady;
            const requests = await withClaimRetry(getResetRequests);
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
            if (autoOpen) resetRequestsCard.setOpen(true);
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
                // saying "Reset below" for it would be a guess presented as fact. A DISABLED account
                // exists, and a reset is refused for it: Set up accounts re-enables it (Nov 2026).
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
                        // A gated write (Oct 2026 review): an outcome that is UNKNOWN is said so, and
                        // the button stays off — a second Clear would only be refused by the gate.
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
            // Clear the chip: leaving the previous count above an error panel told the admin "5
            // outstanding" while showing no list (v18.94).
            if (chip) chip.textContent = '';
            // The strip's count is as stale as the chip's was (whole-app review), and an absent item
            // read as "nothing outstanding" from outside the closed card — so it says it couldn't
            // check (owner, 10 Nov 2026).
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

    // A banner when this admin's named Firebase session could not be confirmed. The page renders
    // either way, but the uploads, the reset and the Cloud Function reads all need a valid admin
    // token, and each would otherwise fail on its own with less to say. (There is no anonymous
    // fallback since v24.34: a refused session is simply not established.)
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
            // doc-upload.js hands the date over in words ("6 Nov 2026"), as app copy writes one — formatted
            // a second time here, it read "uploaded for —" (whole-app check, 10 Nov 2026).
            successMsg: date => `Newsletter uploaded for ${date} — staff can open it from ☰ → Marylebone Newsletter`,
            btnLabel: 'Upload Newsletter', logPrefix: 'Newsletter',
            whereToCheck: '☰ → Marylebone Newsletter',   // where a sign-out mid-upload is told to look
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
            whereToCheck: '☰ → Weekly Retail Circular',
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

        wireHeaderLogo();   // the header logo goes back to the calendar (about-lightbox.js)
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

    // ============================================
    // registerServiceWorker() moved to the top of init() (runs before the access gate) — v16.21.
    sessionReady.then(() => { initErrorReporter(); recordUsage('operations', currentUser); recordPageLatency('operations', currentUser); });
    // Forced set-password overlay (PASSWORD_DESIGN.md Phase 2) — fire-and-forget, never on the sign-in's
    // critical path, so it waits for the session. `currentUser` is right here: an in-place sign-in
    // re-runs init() with the new session, and only that signed-in pass gets this far (Settings, which
    // signs in without a re-run, is why the same line there must read the identity late).
    sessionReady.then(() => initPasswordForce(currentUser));

}
