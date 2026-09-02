// @ts-check
/**
 * settings-app.js — Coordinator for settings.html.
 *
 * Owns: login/session check, push notifications card.
 * Session is shared with admin-app.js via the same AUTH_KEY in localStorage —
 * a user already signed in on admin.html will arrive here without seeing the login overlay.
 */

import { CONFIG, isValidEmail, isChilternWorkEmail } from './roster-data.js';
import { getStaffContact, saveStaffContact, deleteStaffContact, getPasswordStatus, reauthenticateWithPassword, setOwnPassword } from './firebase-client.js';
import { isPasswordMigrated, isCredentialRejection, validateNewPassword } from './auth-identity.js';
import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { initHuddleNotifications } from './huddle.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { ensureNamedSession, getSession, clearSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { requirePage, canOpenOvertime } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initCardCollapse, confirmDialog } from './overlay.js';
import { summarise, shouldOpen } from './settings-status.js';
import { setStatus } from './status-text.js';
import { inventoryOf } from './paycalc-inventory.js';
import { selectBackupKeys } from './paycalc-transfer.js';
import { pcPrefix, setPaycalcNamespace } from './paycalc-migrations.js';
import { lsKeys } from './ls.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce, withTimeout, settleOrTimeout } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';

/**
 * Phase 4a.2 (ARCHITECTURE_PLAN.md): the coordinator body is an exported init() invoked by
 * settings-boot.js (a 2-line bootstrap — CSP `script-src 'self'` blocks inline module scripts).
 * Wrapping it means a test can `import { init }` WITHOUT the coordinator auto-running (the last
 * of the five write coordinators to get this seam, v17.09). Body unchanged — same statements,
 * same order, one indent level in.
 */
export function init() {
    // ── IS THIS ACCOUNT AND THIS DEVICE SET UP? (v22.37) ──────────────────────────
    //
    // Each card reports its own state as its own data lands; this paints the chip, opens the card
    // if it needs looking at, and repaints the one line at the top. The RULES are in
    // settings-status.js and nothing here duplicates them — in particular, nothing here decides
    // that an unreported card is fine.
    //
    // `_cardHandles` holds the collapse handles so a card can be opened AFTER it was wired, which
    // is the whole difficulty: three of the four states arrive over the network or from the
    // browser, long after the page has drawn.

    /** @type {Record<string, import('./settings-status.js').CardState>} */
    const _states = {};
    /** @type {Record<string, { setOpen(open: boolean): void }>} */
    const _cardHandles = {};
    /** Chip element id per card. @type {Record<string, string>} */
    const _CHIP_IDS = {
        'work-email':    'contactStatusChip',
        'password':      'passwordStatusChip',
        'notifications': 'notifStatusChip',
        'pay-data':      'payDataStatusChip',
    };

    /**
     * A card tells the page what it found.
     *
     * @param {string} id one of settings-status.js's card ids.
     * @param {import('./settings-status.js').CardState} state
     * @param {string} [chip] the chip text. Omitted leaves the chip untouched, which is what a
     *   card wants while it is still reading — an empty chip renders as nothing (`:empty`).
     */
    function reportSetting(id, state, chip) {
        _states[id] = state;
        if (chip !== undefined) {
            const el = document.getElementById(_CHIP_IDS[id]);
            // Through `setStatus`, not `.textContent`: a chip reading "✓ Saved" in a header a
            // screen reader walks would otherwise announce the tick as a word (status-text.js).
            if (el) setStatus(el, chip);
        }
        // Opening is one-way. A card the member has been shown must not shut under them because a
        // later report improved — they may be typing in it.
        if (shouldOpen(state)) _cardHandles[id]?.setOpen(true);
        _paintSummary();
    }

    function _paintSummary() {
        const box   = document.getElementById('settingsSummary');
        const line  = document.getElementById('settingsSummaryLine');
        const items = document.getElementById('settingsSummaryItems');
        if (!box || !line || !items) return;
        const s = summarise(_states);
        box.hidden = false;
        box.setAttribute('data-tone', s.tone);
        setStatus(line, s.headline);
        items.textContent = '';
        for (const t of s.items) {
            const li = document.createElement('li');
            li.textContent = t;
            items.appendChild(li);
        }
    }

    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Fire-and-forget, login-safe: no-op on a valid session, stands down if a login supersedes it.
    reconcileExpiredIdentity().catch(() => {});

    // ── Check session ─────────────────────────────────────────────────────────────
    // `let` (not const): on the in-place sign-in path (CONFIG.INPLACE_LOGIN.settings, ARCHITECTURE_PLAN.md Phase 9)
    // these are refreshed inside initAuthorised() from the just-saved session — the module loaded while
    // signed out, so the load-time values are null. With the flag off they are assigned once and never
    // change, identical to before.
    let currentSession   = getSession();
    let isAuthenticated  = !!currentSession;
    let currentUser      = currentSession?.name ?? null;

    // Assigned by initIconLightbox (runs inside initApp when signed in); the closure
    // below only reads it when the drawer logo is tapped.
    /** @type {any} */
    let openAboutLightbox = null;

    // Nav panel. Always initialised — even when not signed in — so the user can navigate to Calendar or
    // Admin rather than being stranded. onSignOut is null when not authenticated, which hides the footer.
    function wireNavPanel() {
        initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
            currentPage: 'settings',
            memberName:  currentUser,
            isAdmin:         currentUser ? CONFIG.ADMIN_NAMES.includes(currentUser) : false,
            isLinksDesigner: currentUser ? CONFIG.LINKS_DESIGNERS.includes(currentUser) : false,
            canOpenOvertime: canOpenOvertime(currentUser),
            onLogoClick: () => openAboutLightbox?.(),
            onSignOut:   currentUser ? () => { clearSession(); window.location.href = './'; } : null,
        });
    }

    // Page-access via the Phase-3 policy (auth-policy.js → ARCHITECTURE_PLAN.md Phase 7). Settings'
    // policy is "any named user" (role null) — no 'forbidden' path. The snapshot maps the LOCAL
    // session-existence flag (isAuthenticated = !!currentSession) to an optimistic 'named' status —
    // preserving the exact prior trigger — so requirePage returns 'login' iff there is no local session
    // (decision identical to the old `if (!isAuthenticated)`). member is irrelevant: Settings needs no role.
    const _access = requirePage({ status: isAuthenticated ? 'named' : 'signedOut', member: currentUser }, 'settings');
    // Wire the nav now EXCEPT on the in-place login path, where it is deferred to initAuthorised() so it
    // renders ONCE with the signed-in identity (the full-screen overlay covers the burger meanwhile).
    // Flag off → wired now exactly as before.
    if (!CONFIG.INPLACE_LOGIN.settings || _access.decision !== 'login') wireNavPanel();

    if (_access.decision === 'login') {
        // On success: flag off (default) → reload + resolveSession(false) on this non-auth load (today's
        // path); flag on → initialise in place via initAuthorised(), falling back to a reload if it throws
        // mid-wiring (never less robust than reload). Don't resolveSession(false) when in-place, or the
        // one-shot sessionReady is poisoned before initAuthorised can resolve it true.
        const onSuccess = CONFIG.INPLACE_LOGIN.settings
            // Reload (fresh overlay) rather than run initAuthorised() with a null identity if saveSession
            // silently failed (iOS private mode) and getSession() is still null. See operations-app.js.
            ? () => { try { if (!getSession()) { window.location.reload(); return; } initAuthorised(); } catch { window.location.reload(); } }
            : () => window.location.reload();
        initLoginOverlay({ pageLabel: 'Settings', onSuccess });
        if (!CONFIG.INPLACE_LOGIN.settings) resolveSession(false); // fulfil sessionReady on the non-auth path
    } else {
        initAuthorised();
    }
    // Usable from here (v21.71) — either the cards are wired (initAuthorised) or the sign-in
    // overlay is up, and BOTH are a page the member can act on. Marking only the signed-in branch
    // would silently exclude every first visit, which is the slowest one there is.
    markPageReady();
    registerServiceWorker();
    sessionReady.then(() => { initErrorReporter(); recordUsage('settings', currentUser); recordPageLatency('settings', currentUser); });
    // Forced set-password overlay (PASSWORD_PLAN.md Phase 2) — fire-and-forget, never on the login
    // critical path. Inside the sessionReady callback so `currentUser` is read LATE: on the in-place
    // sign-in path the module loaded signed-out and the identity is only refreshed inside
    // initAuthorised(), so passing it eagerly here would pass null and silently never compel anyone.
    sessionReady.then(() => initPasswordForce(currentUser));

    /**
     * The authorised (signed-in) init body. Called directly on a normal already-signed-in load, or from
     * the login overlay's onSuccess on the in-place path. Runs exactly once per page life either way.
     */
    function initAuthorised() {
        // Refresh identity — on the in-place path the module loaded signed-out, so re-read the just-saved
        // session (saveSession ran before onSuccess). Identical no-op re-read on a normal signed-in load.
        currentSession  = getSession();
        currentUser     = currentSession?.name ?? null;
        isAuthenticated = !!currentSession;
        // In-place: remove the still-mounted overlay to reveal the page. No-op on a normal load.
        dismissLoginOverlay();
        // Re-establish Firebase Auth in the background. A returning user skips the login handler, so
        // auth.currentUser may still be null for a moment and an immediate Firestore write would fail the
        // request.auth rule. resolveSession() fulfils sessionReady so feature modules (initApp handlers)
        // can import sessionReady instead of reading window._mybSession.
        const _setAuth = ensureNamedSession(currentUser);
        resolveSession(_setAuth);
        // B1.2 enforcement, decided via the policy: once the named session resolves, the store (fed by the
        // Phase-2 bridge inside ensureNamedSession) reflects the terminal Firebase identity, so
        // `requirePage(getAuthSnapshot(), 'settings')` returns 'login' exactly when this member's OWN named
        // session could not be confirmed. Flag OFF → resolves to 'allow', so this never fires (unchanged).
        _setAuth.then(() => {
            // resetNavPanel() before the overlay (v16.25, mirrors admin-app's stale-session path):
            // clearSession() drops the identity, but the nav drawer was already wired to the OLD
            // member — on a shared/stale device that stale identity stayed behind the overlay until
            // reload. Reset tears it down; the fresh login → reload re-wires it.
            if (CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'settings').decision === 'login') { clearSession(); resetNavPanel(); initLoginOverlay({ pageLabel: 'Settings', onSuccess: () => window.location.reload() }); }
        });
        initApp();
        wireNavPanel();   // deduped by initNavPanel's navPanelInit guard if the nav was already wired above
    }

    // ── Main app init (runs when authenticated) ───────────────────────────────────
    function initApp() {
        // notif card collapse is wired by initHuddleNotifications() below.

        // Work Email card
        initContactCard();

        // Password card (PASSWORD_PLAN.md — chosen password + migration status)
        initPasswordCard();

        // Notifications card. It reports its own state — the words in huddle.js are already the
        // authority on what each one means, and a second read of `peekNotifState` here could
        // disagree with the sentence on screen.
        _cardHandles['notifications'] = initHuddleNotifications({
            onState: (state, chip) => reportSetting('notifications', state, chip),
        });
        initDeviceCard();

        // Pay Calculator Data — a pointer card, so collapse and the inventory are all it has.
        _cardHandles['pay-data'] = initCardCollapse('payDataToggleHeader', 'payDataBody', 'payDataChevron');
        initPayDataCard();

        // Icon lightbox
        initIconLightbox();
    }

    // ── Pay Calculator Data — what this device is actually holding ────────────────
    //
    // "Saved on this device only" is a warning about nothing until it says how much. The engine
    // that already answers this for the backup card is `paycalc-inventory.js`, so it answers here
    // too rather than a second count being written — the whole point of that module is that the
    // summary, the itemised list and the damage preflight cannot disagree.
    //
    // It reports `n/a`: there is no wrong amount of pay data, so this card can never be a to-do
    // and can never delay "all set". The chip is information, not a verdict.
    function initPayDataCard() {
        const line = document.getElementById('payDataInventory');
        try {
            // The keys are namespaced per member, so the namespace has to be set before they can
            // be found — Settings never opens the pay calculator, which is where that normally
            // happens. `lsKeys` is the iOS-safe enumerator (ls.js); a private-mode SecurityError
            // returns an empty list rather than throwing.
            setPaycalcNamespace(currentUser || undefined);
            // `periods` is the payslip count; `taxYears` is a LIST, not a count — naming the
            // years is what answers "is my old year in here?", which is why that module returns
            // them rather than a number.
            // `selectBackupKeys` is the ONE selector — it filters to this member's prefix and
            // drops the device-level flags. Handing `inventoryOf` unfiltered keys would slice
            // every unrelated key by the prefix length and classify the wreckage as 'unknown',
            // so a phone with no pay data at all would report a pile of it.
            const inv  = inventoryOf(selectBackupKeys(lsKeys(), pcPrefix()), pcPrefix());
            const bits = [];
            if (inv.periods)         bits.push(`${inv.periods} payslip${inv.periods === 1 ? '' : 's'}`);
            if (inv.taxYears.length) bits.push(inv.taxYears.length === 1
                ? `tax year ${inv.taxYears[0]}`
                : `${inv.taxYears.length} tax years (${inv.taxYears.join(', ')})`);
            if (line) line.textContent = bits.length
                ? `${bits.join(' · ')} saved on this device`
                : 'No pay calculator history saved yet';
            reportSetting('pay-data', 'n/a',
                inv.periods ? `${inv.periods} payslip${inv.periods === 1 ? '' : 's'}` : 'None saved');
        } catch (err) {
            console.warn('[payData] Inventory failed:', err);
            if (line) line.textContent = '';
            reportSetting('pay-data', 'n/a');
        }
    }

    // ── Work Email card ───────────────────────────────────────────────────────────
    function initContactCard() {
        const emailInput = /** @type {HTMLInputElement} */ (document.getElementById('workEmailInput'));
        const saveBtn    = /** @type {HTMLButtonElement} */ (document.getElementById('workEmailSaveBtn'));
        const removeBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('workEmailRemoveBtn'));
        const feedback   = /** @type {HTMLElement} */ (document.getElementById('contactFeedback'));
        if (!emailInput || !saveBtn) return;

        _cardHandles['work-email'] = initCardCollapse('contactToggleHeader', 'contactBody', 'contactChevron');

        // The domain, beside the field rather than appended in silence on blur.
        const domainEl = document.getElementById('workEmailDomain');
        if (domainEl) domainEl.textContent = '@' + CONFIG.WORK_EMAIL_DOMAIN;

        // Guard against a slow Firestore load overwriting text the user has already typed.
        // Listen to both 'input' and 'change' — some browsers (Chrome on Android) fire
        // 'change' but not 'input' when autofilling a field.
        let userHasTyped = false;
        let userSaved    = false;   // a completed save outranks the slow initial load (v16.69)
        const markUserTyped = () => { userHasTyped = true; };
        emailInput.addEventListener('input',  markUserTyped);
        emailInput.addEventListener('change', markUserTyped);
        emailInput.addEventListener('blur', () => {
            const v = emailInput.value.trim();
            if (v && !v.includes('@')) emailInput.value = v + '@' + CONFIG.WORK_EMAIL_DOMAIN;
        });

        function setFeedback(/** @type {any} */ msg, /** @type {any} */ state) {
            feedback.textContent = msg;
            feedback.className   = `contact-feedback${state ? ' ' + state : ''}`;
        }

        function formatDate(/** @type {any} */ ts) {
            try {
                const d = ts?.toDate?.();
                if (!d || isNaN(d.getTime())) return null;
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            } catch { return null; }
        }

        // The subtitle earns its line twice over: before saving it says WHY to save an address,
        // after saving it says WHICH address is saved — which is the question a collapsed card
        // has to answer without being opened.
        const hintEl = document.getElementById('contactHint');
        const WHY_HINT = 'Save your Chiltern work email for account recovery';

        function showSavedState(/** @type {any} */ dateStr) {
            userSaved = true;
            setFeedback(dateStr ? `✓ Saved — last updated ${dateStr}` : '✓ Saved', 'ok');
            if (removeBtn) removeBtn.style.display = '';
            if (hintEl && emailInput.value.trim()) hintEl.textContent = emailInput.value.trim();
            reportSetting('work-email', 'ok', '✓ Saved');
        }

        function clearSavedState() {
            setFeedback('', '');
            if (removeBtn) removeBtn.style.display = 'none';
            if (hintEl) hintEl.textContent = WHY_HINT;
            reportSetting('work-email', 'action', 'Not saved');
        }

        // Load existing email; show a loading message while waiting.
        setFeedback('Checking for a saved email…', '');
        sessionReady.then(() => getStaffContact(currentUser)).then(data => {
            // A fast type-and-save can beat this slow initial load: once the user has SAVED, the load's
            // stale result must not wipe the "✓ Saved" feedback or re-hide the Remove button — bail
            // entirely (the saved state on screen is newer than this read) (v16.69 review fix).
            if (userSaved) return;
            if (data?.workEmail && !userHasTyped) {
                emailInput.value = data.workEmail;
                showSavedState(formatDate(data.updatedAt));
            } else if (data?.workEmail && userHasTyped) {
                // User started typing before the load finished — keep their input,
                // just clear the loading message.
                setFeedback('', '');
                reportSetting('work-email', 'ok', '✓ Saved');
            } else {
                clearSavedState();
            }
        }).catch(err => {
            console.warn('[staffContact] Load failed:', err);
            setFeedback('Couldn\'t check your saved email — check your connection.', 'err');
            // NOT 'action': nothing was learnt, so the summary must not count it as a to-do and
            // must not count it as done either. `error` opens the card and holds back "all set".
            reportSetting('work-email', 'error', 'Couldn’t check');
        });

        emailInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
        });

        saveBtn.addEventListener('click', async () => {
            const raw = emailInput.value.trim();
            if (raw && !raw.includes('@')) emailInput.value = raw + '@' + CONFIG.WORK_EMAIL_DOMAIN;
            const email = emailInput.value.trim();
            setFeedback('', '');

            if (!email) {
                setFeedback('Please enter your work email address.', 'err');
                emailInput.focus();
                return;
            }
            if (!isValidEmail(email)) {
                setFeedback('That doesn\'t look like a valid email address.', 'err');
                emailInput.focus();
                return;
            }
            if (!isChilternWorkEmail(email)) {
                setFeedback(`Please use your Chiltern work email (ending @${CONFIG.WORK_EMAIL_DOMAIN}).`, 'err');
                emailInput.focus();
                return;
            }

            saveBtn.disabled    = true;
            saveBtn.textContent = 'Saving…';
            try {
                await sessionReady;
                await saveStaffContact(currentUser, email);
                const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                showSavedState(today);
            } catch (err) {
                console.warn('[staffContact] Save failed:', err);
                setFeedback(
                    (/** @type {any} */ (err))?.code === 'permission-denied'
                        ? 'Couldn\'t save — please sign out and sign back in.'
                        : 'Couldn\'t save — check your connection and try again.',
                    'err'
                );
            } finally {
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save email';
            }
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                if (!await confirmDialog({ message: 'Remove your saved work email address?', confirmLabel: 'Remove', danger: true })) return;
                removeBtn.disabled = true;
                try {
                    await sessionReady;
                    await deleteStaffContact(currentUser);
                    emailInput.value = '';
                    clearSavedState();
                } catch (err) {
                    console.warn('[staffContact] Remove failed:', err);
                    setFeedback(
                        (/** @type {any} */ (err))?.code === 'permission-denied'
                            ? 'Couldn\'t remove — please sign out and sign back in.'
                            : 'Couldn\'t remove — check your connection and try again.',
                        'err'
                    );
                } finally {
                    removeBtn.disabled = false;
                }
            });
        }
    }

    // ── Tips lightbox ─────────────────────────────────────────────────────────────
    // Wired unconditionally at module scope (same pattern as admin-app.js and
    // operations-app.js) so the ? buttons always get stopPropagation regardless of
    // auth state. Previously lived inside initApp() — if initApp() wasn't called
    // (stale session, auth race) the ? buttons had no handler and the click bubbled
    // up to the card header, toggling the card instead of opening the lightbox.
    const CARD_TIPS = {
            'password': {
                title: 'Password',
                sections: [
                    { items: [
                        { icon: '🔑', html: 'Replace your <strong>surname default</strong> with a password only you know — anyone who knows your name can guess the default.' },
                        { icon: '✏️', html: 'Enter your <strong>current</strong> password (your surname, if you haven\'t changed it yet), then a new one of <strong>at least 8 characters</strong>.' },
                        { icon: '↩️', html: 'Forgotten it? On the sign-in screen tap <strong>“Can’t get in?”</strong> — that asks the admin for you. They reset it back to your surname, and you choose a new one when you next sign in.' },
                        { icon: '🔒', html: 'Your password is never shown to anyone, not even the admin.' },
                    ]},
                ],
            },
            'work-email': {
                title: 'Work Email',
                sections: [
                    { items: [
                        { icon: '✉️', html: 'Use your <strong>Chiltern work email</strong> — the one the company already sends things to.' },
                        { icon: '🔑', html: 'It is saved so that one day you can reset your own password by email. That is not built yet — today a reset goes through the admin, and the <strong>“Can’t get in?”</strong> link on the sign-in screen asks them for you.' },
                        { icon: '🔒', html: 'Only you and the admin can see it. It is not shown to your manager or to anyone else.' },
                    ]},
                ],
            },
            'notifications': {
                title: 'Notifications',
                sections: [
                    // FOUR, not two. Circular and Newsletter have been pushed to everybody since
                    // v13.58/59 and this list never mentioned them — so a member turning
                    // notifications on was agreeing to two things and receiving four.
                    { heading: 'What you\'ll get', items: [
                        { icon: '📋', html: '<strong>Daily Huddle</strong> — when the day\'s Huddle has been uploaded.' },
                        { icon: '📰', html: '<strong>Weekly Retail Circular</strong> — when a new one is posted.' },
                        { icon: '🗞️', html: '<strong>Marylebone Newsletter</strong> — when a new one is posted.' },
                        { icon: '💷', html: '<strong>Pay reminder</strong> — on the cut-off Saturday, six days before payday, to enter your hours.' },
                    ]},
                    { heading: 'How it works', items: [
                        { icon: '📲', html: 'Tap <strong>Enable notifications</strong> and allow it when your phone asks. That is all.' },
                        { icon: '🔕', html: 'Tap <strong>Disable notifications</strong> to stop them at any time. You can turn them back on later.' },
                        { icon: '🚫', html: 'If you tapped <strong>Don\'t allow</strong> when your phone asked, the button cannot ask again — your phone will not let it. Turn notifications back on for this app in your phone\'s own settings.' },
                    ]},
                    { heading: 'iPhone users', items: [
                        { icon: '🍎', html: 'Notifications only work on iPhone if the app has been <strong>added to your Home Screen</strong> — tap Share, then Add to Home Screen, in Safari.' },
                    ]},
                ],
            },
            // ADDED v20.09. This card was the only one of the four with no `?`, which reads as a
            // control that failed to render rather than as a card too simple to need one — and it is
            // not too simple: it is the one place in the app where something does NOT follow your
            // account, which is the opposite of every expectation the rest of the app sets.
            'pay-data': {
                title: 'Pay Calculator Data',
                sections: [
                    { heading: 'Why this card exists', items: [
                        { icon: '💾', html: 'Your pay calculator figures are saved <strong>on this device</strong>, not to your account — so they do not follow you to a new phone, and they do not appear at a different web address.' },
                        { icon: '🔒', html: 'That is deliberate: <strong>pay data is never sent to the server</strong>. The trade is that moving it is something you have to do yourself.' },
                    ]},
                    { heading: 'Moving it', items: [
                        { icon: '📄', html: 'The button opens the <strong>pay calculator</strong>, where you can download a backup or copy it as text — the controls live there because that is where the data is.' },
                        { icon: '⚠️', html: 'Restoring <strong>replaces</strong> what is on the device — it does not merge. Take a backup of the new device first if it already has figures on it.' },
                        { icon: '🙋', html: 'A backup belongs to the member who made it. Restoring somebody else\'s is refused, because staff share devices.' },
                    ]},
                ],
            },
    };
    initTipsLightbox(CARD_TIPS);

    // ── Password card (PASSWORD_PLAN.md — self-service chosen password + migration status) ────────
    /** Ceiling on each password network call. Same 8s budget as sign-in and the forced overlay. */
    const SAVE_TIMEOUT_MS = 8000;

    function initPasswordCard() {
        const curEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('pwCurrent'));
        const newEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('pwNew'));
        const confEl  = /** @type {HTMLInputElement|null} */ (document.getElementById('pwConfirm'));
        const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('pwSaveBtn'));
        const feedback = document.getElementById('pwFeedback');
        const chip    = document.getElementById('passwordStatusChip');
        const nudge   = document.getElementById('passwordNudge');
        if (!curEl || !newEl || !confEl || !saveBtn || !feedback) return;
        _cardHandles['password'] = initCardCollapse('passwordToggleHeader', 'passwordBody', 'passwordChevron');

        // ONE reveal control, covering all THREE fields (v22.37, owner review). The old `Show`
        // button sat beside New and also governed Confirm — defensible, and not what its placement
        // said. A labelled checkbox states which of its two positions it is in, and reaches Current
        // as well, which is where a mistyped password most often comes from.
        const pwShow = /** @type {HTMLInputElement|null} */ (document.getElementById('pwShowAll'));
        /** @param {boolean} reveal */
        const setRevealed = (reveal) => {
            curEl.type = newEl.type = confEl.type = reveal ? 'text' : 'password';
            if (pwShow) pwShow.checked = reveal;
        };
        pwShow?.addEventListener('change', () => setRevealed(!!pwShow.checked));

        // The two halves of the card body, and the latch that keeps the form open once opened.
        const settled   = document.getElementById('pwSettled');
        const form      = document.getElementById('pwForm');
        const changeBtn = document.getElementById('pwChangeBtn');
        let _pwFormOpened = false;
        changeBtn?.addEventListener('click', () => {
            _pwFormOpened = true;
            if (settled) settled.hidden = true;
            if (form)    form.hidden    = false;
            curEl.focus();
        });

        const member = currentUser;
        const setFeedback = (/** @type {string} */ msg, /** @type {string} */ state = '') => {
            feedback.textContent = msg;
            feedback.className   = `contact-feedback${state ? ' ' + state : ''}`;
        };

        // Reflect migration status (header chip + nudge banner). Best-effort — a failed read leaves
        // both blank. Migrated ⇔ passwordSetAt exists AND is at least as new as any resetAt (§6).
        // `optimisticMigrated` lets the just-completed save flip the UI to migrated WITHOUT waiting on
        // the serverTimestamp() to resolve (an immediate local-cache read returns passwordSetAt:null
        // right after the write, which would briefly flash "using surname" under the ✓ message).
        async function refreshStatus(optimisticMigrated = false) {
            if (!member) return;
            const paint = (/** @type {boolean} */ migrated) => {
                // RETIRE THE CALENDAR NOTICE ON WHATEVER DEVICE LEARNS THE ANSWER (v19.91, external
                // review). The flag used to be set only by `onWriteConfirmed` — i.e. only on the
                // device where the password was actually changed. But `passwordStatus` is per
                // ACCOUNT and this device has just read it, so a member who set their password on
                // phone A and then signs in to Settings on phone B is confirmed migrated here while
                // phone B's flag stays unset, and the calendar notice returns after its snooze to
                // someone who has already done what it asks — for the rest of the window.
                //
                // Every path into `paint(true)` is real evidence: either the server says migrated,
                // or a password write on THIS device just succeeded (`optimisticMigrated`, from the
                // card's own save and from the forced overlay's `myb:password-set`). No branch
                // paints migrated on a guess, which is why this can live here rather than at each
                // call site.
                // Through `setStatus`: this chip leads with a tick, and a live header a screen
                // reader walks would otherwise announce it as a word (status-text.js).
                if (chip) setStatus(chip, migrated ? '✓ Password set' : 'Using surname');
                if (nudge) {
                    nudge.hidden = migrated;
                    if (!migrated) nudge.textContent =
                        'You’re still using your surname as your password — anyone who knows your name could guess it. Set a password only you know below.';
                }
                // THE FORM IS BEHIND A DOOR ONCE THERE IS NOTHING TO FIX (v22.37, owner review).
                // A migrated member met three empty password fields on every visit, which reads as
                // a form they have to fill in rather than as a setting that is already right.
                // `_pwFormOpened` makes this ONE-WAY: once Change password has been pressed, a
                // later refresh (the optimistic repaint after a successful save, say) must not
                // fold the form away under someone who is typing in it.
                if (settled && form) {
                    settled.hidden = !migrated || _pwFormOpened;
                    form.hidden    = migrated && !_pwFormOpened;
                }
                reportSetting('password', migrated ? 'ok' : 'action',
                    migrated ? '✓ Password set' : 'Using surname');
            };
            if (optimisticMigrated) paint(true);
            try {
                // Gate the owner-only read on the Firebase session (like initContactCard) — a cold-load
                // read before auth.currentUser exists is rejected by the rules and would blank the chip.
                await sessionReady;
                const st = await getPasswordStatus(member);
                // isPasswordMigrated (auth-identity.js) is the single, unit-tested source (§6).
                paint(isPasswordMigrated(st) || optimisticMigrated);
            } catch {
                // Leave the chip/nudge as the optimistic paint left them — but the SUMMARY must
                // hear about it. Silence here would let "✓ You’re all set" appear over a password
                // status nobody actually read, which is the one thing that line must never do.
                if (!optimisticMigrated) reportSetting('password', 'error', 'Couldn’t check');
            }
        }
        refreshStatus();
        // The forced overlay (password-force.js) can change the password AFTER this card has already
        // read passwordStatus, leaving the header chip saying "using surname" until a reload (FIX,
        // v18.94). It dispatches this when it succeeds; optimistic because the serverTimestamp hasn't
        // resolved yet.
        document.addEventListener('myb:password-set', () => refreshStatus(true));

        /** True while a password write has passed its deadline but may still be in flight. */
        let _pwIndeterminate = false;

        /** The write completed. Shared by the in-time and the LATE success paths.
         *  @param {any} res the setOwnPassword result ({ statusRecorded }) */
        const onWriteConfirmed = (res) => {
            setFeedback(res && res.statusRecorded === false
                ? '✓ Password updated. Use it next time you sign in. (Your status will refresh shortly.)'
                : '✓ Password updated. Use it the next time you sign in.', 'ok');
            // NOTHING TO RETIRE ON THE CALENDAR ANY MORE (v21.84). This used to write the
            // `pw-own-2026` done-flag, because that notice asked for exactly what has just
            // happened and would otherwise keep returning to someone who had done it. Its
            // replacement is addressed to the SIGNED-OUT only, so it retires itself the moment
            // this member has a session — the audience is re-checked on every load. One page
            // reaching across to silence another page's notice was a real coupling, and the
            // audience rule removed the need for it rather than tidying it up.
            curEl.value = newEl.value = confEl.value = '';
            // Re-mask on success (v18.95). Clearing the values alone left the fields in whatever
            // reveal state the member chose, so the NEXT password typed into this card — possibly
            // by someone else on a shared device — would appear in the clear with no warning.
            setRevealed(false);
            refreshStatus(true);   // optimistic: the password changed, so show migrated immediately
        };

        /**
         * The write passed its deadline and is still running. Say exactly that — the one thing we must
         * NOT say is that it failed, because it may be about to succeed, and the member would then be
         * signing in with a password that no longer exists (external review, v18.97).
         *
         * The fields are deliberately left FILLED: if the write did land, what they typed is now their
         * password, and clearing it would destroy the only copy on screen.
         * @param {Promise<{status:string, value?:any}>} settled
         */
        const onIndeterminate = (settled) => {
            _pwIndeterminate = true;
            saveBtn.disabled = true;                  // no racing second write
            saveBtn.textContent = 'Still saving…';
            setFeedback('We couldn’t confirm whether your password was updated. Keep the password you just entered and try it first next time you sign in.', 'err');
            settled.then(late => {
                _pwIndeterminate = false;
                saveBtn.disabled = false; saveBtn.textContent = 'Set password';
                if (late.status === 'ok') onWriteConfirmed(late.value);   // it landed after all
                else setFeedback('Your password wasn’t updated — try again.', 'err');
            });
        };

        saveBtn.addEventListener('click', async () => {
            if (!member) return;
            const current = curEl.value;
            const next    = newEl.value.trim();
            const confirm = confEl.value.trim();
            if (!current.trim())  { setFeedback('Enter your current password.', 'err'); curEl.focus(); return; }
            // Length / match / surname-block now come from the SHARED validator (auth-identity.js,
            // v18.92) so this card and the forced overlay can never disagree about what a valid
            // password is — two copies of a rule is how the Other-day grammar drifted (v18.91). The
            // messages and their order are unchanged.
            const invalid = validateNewPassword(member, next, confirm);
            if (invalid) {
                setFeedback(invalid, 'err');
                (next && next !== confirm ? confEl : newEl).focus();
                return;
            }
            saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
            // Track WHICH stage failed: a failure AFTER reauth succeeded is NOT "current password wrong"
            // (the old catch mapped every non-rate-limit/weak error to that, so a network blip during the
            // update told the member their correct password was incorrect → needless retries + admin reset).
            let reauthed = false;
            try {
                // Wait for the session like every OTHER write on this page does (the contact card's
                // save/remove and refreshStatus all await it; this handler didn't — v18.84). initApp()
                // runs while ensureNamedSession is still in flight, so a save fired before it settled
                // could (a) hit a null auth.currentUser — reauthenticateWithPassword throws a plain
                // 'Not signed in' with no .code, which fell through to "couldn't verify your current
                // password" for a CORRECT password — or (b) on a shared device mid-identity-switch,
                // reauthenticate and updatePassword against the PREVIOUSLY persisted member while
                // stamping passwordStatus for this one.
                await sessionReady;
                // Both calls TIME-BOXED (v18.95, shared with password-force.js). Without it a promise
                // that never settles — dead-air mobile data, not an error — skips both `catch` and
                // `finally`, leaving the button disabled on "Saving…" with no message, for good. The
                // forced overlay got this at v18.94; this card makes the same call and was missed.
                // Re-auth may time out as a plain failure — it changes nothing, so "it did not happen"
                // is a true statement about it and retrying is free.
                await withTimeout(reauthenticateWithPassword(member, current), SAVE_TIMEOUT_MS);
                reauthed = true;
                // The WRITE may NOT (v18.97, external review). Promise.race stops WAITING; it does not
                // CANCEL — so a slow updatePassword can land after we would have reported failure, and
                // the member would then sign in with an old password that no longer works.
                const outcome = await settleOrTimeout(setOwnPassword(member, next), SAVE_TIMEOUT_MS);
                if (outcome.status === 'pending') { onIndeterminate(outcome.settled); return; }
                if (outcome.status === 'failed')  throw outcome.error;
                // The password DID change (setOwnPassword only rejects if reauth/updatePassword failed).
                // A missing migration stamp is a soft note, never "it failed" — see setOwnPassword.
                onWriteConfirmed(outcome.value);
            } catch (e) {
                const code = /** @type {any} */ (e)?.code || '';
                // Map by CAUSE and by STAGE. Order: the cause-specific codes first, then the stage split.
                if (code === 'auth/too-many-requests') setFeedback('Too many attempts — wait a few minutes and try again.', 'err');
                else if (code === 'auth/weak-password') setFeedback('That password is too weak — choose a longer one.', 'err');
                else if (code === 'auth/network-request-failed' || code === 'myb/timeout') setFeedback('Couldn’t connect — check your connection and try again.', 'err');
                else if (code === 'auth/requires-recent-login') setFeedback('For your security, sign out and back in, then change your password.', 'err');
                else if (!reauthed && isCredentialRejection(code)) setFeedback('Current password incorrect — try again, or ask the admin to reset it.', 'err');
                else if (!reauthed) setFeedback('Couldn’t verify your current password — try again shortly.', 'err');
                else setFeedback('Your password wasn’t updated — try again shortly.', 'err');   // reauth OK, update stage failed
            } finally {
                // Not re-enabled while a write may still be in flight — onIndeterminate owns the
                // button until the real outcome arrives, so a second save can't race the first.
                if (!_pwIndeterminate) { saveBtn.disabled = false; saveBtn.textContent = 'Set password'; }
            }
        });
    }

    // ── Icon lightbox ─────────────────────────────────────────────────────────────
    // About panel (version, update status, bug link) is the shared about-lightbox.js.
    function initIconLightbox() {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Settings',
            getUserName: () => currentUser,
        });
        if (about) openAboutLightbox = about.open;

        // Header logo is a back-to-calendar button (About moved to the drawer logo).
        const iconBtn = document.getElementById('appIcon');
        if (iconBtn) {
            iconBtn.title = 'Back to calendar';
            iconBtn.setAttribute('aria-label', 'Back to calendar');
            // Keyboard-operable: the logo is an interactive control (was a non-focusable <img>). v18.29.
            iconBtn.setAttribute('role', 'button');
            iconBtn.tabIndex = 0;
            iconBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); iconBtn.click(); } });
            iconBtn.addEventListener('click', () => { window.location.href = './'; });
        }
        // The coming-soon lightbox is owned entirely by nav-panel.js (open/close, Escape,
        // Android Back, focus trap). Do not re-wire it here — a duplicate handler used to
        // live in this function and left the nav-panel state flags out of sync (v11.50).
    }
}

/**
 * The install affordance, wired to the browser's own offer (v22.13).
 *
 * `beforeinstallprompt` fires on Chromium when the app is installable and NOT already installed —
 * so on Android in a browser tab, which is exactly the population this helps and no one else. It
 * never fires on WebKit (iOS has no such event; the Home Screen route is what the notifications
 * copy above already explains) and never fires inside an installed PWA. The row therefore stays
 * `hidden` for everybody the offer would be meaningless to, rather than being conditionally
 * reasoned about — nothing is drawn unless the browser has told us it can act.
 *
 * WHY IT EARNS A PLACE IN SETTINGS. Installing is what makes push possible on iOS and what makes
 * this device's stored pay data durable on both platforms — the two subjects this page is already
 * about. It is deliberately NOT on the calendar, which is meant to stay one thing.
 *
 * The event must be `preventDefault()`ed to keep the deferred prompt usable, and a saved prompt is
 * single-use: after `prompt()` the reference is spent, so the row goes away whichever way the
 * member answers. `appinstalled` hides it too, for the case where they install from Chrome's own
 * menu while this page is open.
 */
/**
 * The conditional "Install on this device" card (v22.37, owner review).
 *
 * It used to be a row inside Notifications, because installing is what makes notifications
 * possible on iOS and what makes this device's saved pay data durable. Both true, and neither is
 * something a member knows — so somebody looking for "how do I put this on my home screen?" would
 * never have thought to open Notifications, and the control was undiscoverable to exactly the
 * person it was for.
 *
 * The whole CARD is conditional rather than just the button: it appears only while there is an
 * install to offer and disappears the moment there is not. A permanent "✓ Installed" row would be
 * a card that never does anything again, which is the opposite of what this page is becoming.
 */
function initDeviceCard() {
    const row = document.getElementById('deviceCard');
    const btn = document.getElementById('installBtn');
    if (!row || !btn) return;
    /** @type {any} */
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();          // keep it; without this Chrome shows its own mini-infobar instead
        deferred = e;
        row.hidden = false;
    });
    window.addEventListener('appinstalled', () => { deferred = null; row.hidden = true; });
    btn.addEventListener('click', () => {
        if (!deferred) { row.hidden = true; return; }
        const p = deferred;
        deferred = null;             // single-use: a spent prompt cannot be shown again
        row.hidden = true;
        try { p.prompt(); } catch { /* the browser withdrew it — nothing to recover */ }
    });
}
