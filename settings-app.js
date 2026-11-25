// @ts-check
/**
 * settings-app.js — Coordinator for settings.html.
 *
 * Owns: login/session check and the page's cards, each reporting its state to settings-status.js.
 * Three left for modules of their own on 25 Nov 2026, when this file reached its size cap: the `?`
 * panels' content (settings-tips.js), the Password card (settings-password-card.js) and the Install
 * card (settings-install-card.js). The Work Email and Pay Calculator Data cards are still wired here.
 * Session is shared with admin-app.js via the same AUTH_KEY in localStorage —
 * a user already signed in on admin.html will arrive here without seeing the login overlay.
 */

import { CONFIG, isValidEmail, isChilternWorkEmail, workEmailLocalPart, workEmailFrom, teamMembers } from './roster-data.js';
import { payCalculatorPrices } from './pay-audience.js';
import { formatDayMonthYear } from './date-format.js';
import { getStaffContact, saveStaffContact, deleteStaffContact, withClaimRetry } from './firebase-client.js';
import { initNavPanel } from './nav-panel.js';
import { initNotificationsCard } from './notif-card.js';
import { getSession, sessionReady, reconcileExpiredIdentity } from './session.js';
import { navGatesFor } from './auth-policy.js';
import { startPage } from './page-start.js';
import { initCardCollapse, confirmDialog } from './overlay.js';
import { summarise, shouldOpen } from './settings-status.js';
import { CARD_TIPS } from './settings-tips.js';
import { initPasswordCard, passwordSaving } from './settings-password-card.js';
import { captureInstallOffer, initDeviceCard } from './settings-install-card.js';
import { setStatus } from './status-text.js';
import { unconfirmedWriteLine } from './claim-retry.js';
import { signOutAndLeave, askBeforeSignOut } from './page-session.js';
import { withSlowSaveNotice, writesInFlight } from './slow-save.js';
import { inventoryOf, inventorySummary } from './paycalc-inventory.js';
import { selectBackupKeys } from './paycalc-transfer.js';
import { pcPrefix, setPaycalcNamespace } from './paycalc-migrations.js';
import { payslipsShownTo } from './paycalc-periods.js';
import { lsKeys } from './ls.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker, reloadWhenNotBusy } from './sw-register.js';
import { markPageReady } from './perf-reporter.js';

/**
 * Phase 4a.2 (AUTH_ARCHITECTURE.md): the coordinator body is an exported init() invoked by
 * settings-boot.js (a 2-line bootstrap — CSP `script-src 'self'` blocks inline module scripts).
 * The seam (v17.09) would let a test `import { init }` without the coordinator auto-running, but no
 * test does: the page is driven in a browser (e2e/settings.spec.js), and its rules live in the
 * Node-tested modules it calls (settings-status.js, own-password.js, paycalc-inventory.js).
 */
export function init() {
    // Listen for the browser's install offer NOW, before the sign-in wait (Sep 2026 review):
    // Chromium fires `beforeinstallprompt` once, early, and the Device card is wired only after
    // sign-in — so the event had come and gone before anything listened, and the row never showed.
    const installOffer = captureInstallOffer();

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
        'install':       'deviceStatusChip',
    };

    /**
     * A card tells the page what it found.
     *
     * @param {string} id one of settings-status.js's card ids.
     * @param {import('./settings-status.js').CardState} state
     * @param {string} [chip] the chip text. Omitted leaves the chip untouched, which is what a
     *   card wants while it is still reading — an empty chip renders as nothing (`:empty`).
     * @param {string} [tone] the chip's colour, when it must not follow `state` — only `'plain'`
     *   today, for the notifications "Off" a member chose: `ok` to the summary, but no green.
     */
    function reportSetting(id, state, chip, tone = state) {
        _states[id] = state;
        if (chip !== undefined) {
            const el = document.getElementById(_CHIP_IDS[id]);
            // Through `setStatus`, not `.textContent`: a chip reading "✓ Saved" in a header a
            // screen reader walks would otherwise announce the tick as a word (status-text.js).
            if (el) {
                setStatus(el, chip);
                // The chip's colour is the state that wrote its words (v25.14), set here and only
                // here so the two cannot disagree: a report without a chip leaves both alone.
                // settings.css colours `ok` and `action`/`blocked` with the summary strip's own
                // declarations; every other tone — `'plain'` included — stays neutral.
                el.dataset.tone = tone;
            }
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
        s.items.forEach((t, i) => {   // each to-do is a link to the card that fixes it (desktop audit, 7 Nov 2026)
            const a = items.appendChild(document.createElement('li')).appendChild(document.createElement('a'));
            a.href = `#${s.cards[i]}`; a.textContent = t;
            a.onclick = () => _cardHandles[s.ids[i]]?.setOpen(true);   // open first, so the jump lands on it open
        });
    }

    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Fire-and-forget, login-safe: no-op on a valid session, stands down if a login supersedes it.
    reconcileExpiredIdentity().catch(() => {});   // it handles and logs its own failures; this only keeps an unexpected one from going unhandled

    // ── Check session ─────────────────────────────────────────────────────────────
    // `let` (not const): after an in-place sign-in (AUTH_ARCHITECTURE.md Phase 9) these two are refreshed
    // inside initAuthorised() from the just-saved session — the module loaded while signed out, so the
    // load-time values are null.
    let currentSession   = getSession();
    let currentUser      = currentSession?.name ?? null;

    // Assigned by initIconLightbox (runs inside initApp when signed in); the closure
    // below only reads it when the drawer logo is tapped.
    /** @type {any} */
    let openAboutLightbox = null;

    // Nav panel. NOT wired at module scope for a signed-out visitor — initAuthorised() wires it, so the drawer renders ONCE
    // with the signed-in identity. (This comment said "always initialised … so the user can navigate
    // rather than being stranded" for as long as that had been untrue, which is the sentence a reader
    // would have restored the two-identity double render from. A signed-out visitor is not stranded:
    // the full-screen login overlay carries its own "← Back to roster" — login-overlay.js.)
    // It is only ever wired for a signed-in member, so Sign out is always there.
    function wireNavPanel() {
        initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
            currentPage: 'settings',
            memberName:  currentUser,
            ...navGatesFor(currentUser),   // the pill gates (auth-policy.js); all false signed out
            onLogoClick: () => openAboutLightbox?.(),
            onSignOut:   () => signOutAndLeave({ to: './' }),
            // A SAVE ON ITS WAY IS ASKED ABOUT FIRST (settings review, Nov 2026). Signing out mid-save said
            // nothing: the email's write and the password's change are counted by `writesInFlight`, and
            // the password's re-authentication — before anything is written — by `passwordSaving()`, which asks
            // "without saving?" only until the change is sent: after that "still saving" is the whole truth.
            beforeSignOut: askBeforeSignOut(() => passwordSaving() && writesInFlight() === 0),
        });
    }

    // ── Wired BEFORE the sign-in decision, as Operations does (Nov 2026 review) ──────────────────────
    // initAuthorised() has no try/catch on the signed-in path, so a throw in any card's wiring used to
    // skip all of these (the set-password step now runs in the start-up, before initAuthorised). Hold a release's
    // reload, and a notification tap, while a save is on its way (v24.61): the contact card's writes are
    // counted by slow-save; the password's change and its "own password" record by `trackBackgroundWrite`
    // (claim-retry.js), which `writesInFlight` reads; and the re-authentication before them, which
    // writes nothing, by `passwordSaving()` (settings-password-card.js). Behaviour-tested in e2e/settings.spec.js.
    const _busy = () => writesInFlight() > 0 || passwordSaving();
    registerServiceWorker({ beforeReload: () => reloadWhenNotBusy(_busy), isBusy: _busy });
    initTipsLightbox(CARD_TIPS);   // the ? buttons are static markup, signed in or not

    // The start-up every card-opening page shares (page-start.js): the Back guard, the Phase-3 policy
    // (auth-policy.js → AUTH_ARCHITECTURE.md Phase 7) decided from the LOCAL session — "any named user"
    // (role null, Other Staff admitted), so 'login' iff there is no local session — and the in-place
    // sign-in, which runs initAuthorised() in place and reloads if it throws mid-wiring. Before
    // initAuthorised runs, the start-up re-establishes the member's own Firebase session, fulfils
    // `sessionReady`, guards it (an own session that cannot be confirmed signs in again now; one revoked
    // LATER does too), runs the forced set-password step (PASSWORD_DESIGN.md Phase 2) NOW with the session
    // as its barrier — before any card can throw, so the sign-in's one-shot marker is spent as the page
    // opens — and starts the error reporter and the usage and latency counts behind it.
    startPage({ page: 'settings', label: 'Settings', run: initAuthorised,
        // Not reachable while the policy admits every named member: a refusal added later fails closed,
        // back to the roster, rather than open.
        refuse: () => window.location.replace('./') });

    /**
     * The authorised (signed-in) init body. Called directly on a normal already-signed-in load, or from
     * the login overlay's onSuccess on the in-place path. Runs exactly once per page life either way.
     */
    function initAuthorised() {
        // Refresh identity — on the in-place path the module loaded signed-out, so re-read the just-saved
        // session (saveSession ran before onSuccess). Identical no-op re-read on a normal signed-in load.
        currentSession  = getSession();
        currentUser     = currentSession?.name ?? null;
        // The drawer, ONCE, with the signed-in identity, and BEFORE the cards: initApp() has no try/catch,
        // so a throw in any card's wiring must not leave a signed-in member without Sign out.
        wireNavPanel();
        initApp();
        // Usable from here: the cards are wired. On the sign-in path that is AFTER the sign-in, which
        // is where the sign-in timing ends (perf-reporter.js). It was marked when the sign-in FORM
        // appeared from v21.71 until the App Speed review (Oct 2026) — a second meaning of "usable"
        // in one figure, and a mark before "Sign in" was pressed would leave that sign-in untimed. A
        // load that asked somebody to type records no "usable" either way; its sign-in is the figure.
        markPageReady();
    }

    // ── Main app init (runs when authenticated) ───────────────────────────────────
    function initApp() {
        // notif card collapse is wired by initNotificationsCard() below.

        // EACH CARD IS WIRED ON ITS OWN (settings review, Nov 2026). One card that threw stopped every
        // card after it, and the summary — which waits for all of them — said "Checking…" for good.
        // A card that cannot be set up says so on its own chip, and the summary reports a check that
        // failed instead of waiting for one that is never coming.

        // Work Email card
        wireCard('work-email', initContactCard);

        // Password card (PASSWORD_DESIGN.md — chosen password + migration status; settings-password-card.js)
        wireCard('password', () => initPasswordCard({ member: currentUser, reportSetting, cardHandles: _cardHandles }));

        // Notifications card. It reports its own state — notif-card-core.js's words are the authority, and a second
        // `peekNotifState` read here could disagree with the screen. It names the pay reminder only to CEA and CES
        // (functions/pay-reminder.js), and re-registers this device once `sessionReady` is true (notif-card.js).
        wireCard('notifications', () => {
        _cardHandles['notifications'] = initNotificationsCard({
            onState: (state, chip, tone) => reportSetting('notifications', state, chip, tone),
            payReminders: payCalculatorPrices(teamMembers.find(m => m.name === currentUser) ?? null),
            sessionReady,
        });
        });
        // Pay Calculator Data — a pointer card, so collapse and the inventory are all it has. Read
        // BEFORE the Install card (Nov 2026): on an iPhone its first step copies the figures across
        // when this device holds some, and this card's inventory is the one count of them.
        let holdsPayFigures = false;
        wireCard('pay-data', () => {
            const me = teamMembers.find(m => m.name === currentUser) ?? null, shown = payCalculatorPrices(me, { periods: payslipsShownTo(me) });
            document.getElementById('payDataCard')?.toggleAttribute('hidden', !shown);   // the Pay page's own rule; its label follows (settings.css)
            if (!shown) return reportSetting('pay-data', 'n/a');
            _cardHandles['pay-data'] = initCardCollapse('payDataToggleHeader', 'payDataBody', 'payDataChevron');
            holdsPayFigures = initPayDataCard();
        });

        // Install. It is either an offer or, on an iPhone in a browser, the prerequisite for
        // notifications — the one case that is a to-do, and the one case it opens itself. Either way
        // it reports at once, with its chip, so the chip and the summary are one report.
        wireCard('install', () => {
            _cardHandles['install'] = initCardCollapse('deviceToggleHeader', 'deviceBody', 'deviceChevron');
            initDeviceCard((state, chip) => reportSetting('install', state, chip), installOffer, holdsPayFigures);
        });

        // Icon lightbox
        wireCard(null, initIconLightbox);
    }

    /**
     * Wire one card, so a throw in it costs that card alone (see initApp).
     * @param {string|null} id the card's settings-status.js id, told `error`; null for the About panel,
     *   which has no state to report
     * @param {() => void} wire
     */
    function wireCard(id, wire) {
        try { wire(); } catch (err) {
            console.error(`[settings] the ${id ?? 'About'} card could not be set up:`, err);
            if (id) reportSetting(id, 'error', 'Couldn’t check');
        }
    }

    // ── Pay Calculator Data — what this device is actually holding ────────────────
    //
    // "Saved in this browser only" is a warning about nothing until it says how much. The engine
    // that already answers this for the backup card is `paycalc-inventory.js`, so it answers here
    // too rather than a second count being written — the whole point of that module is that the
    // summary, the itemised list and the damage preflight cannot disagree.
    //
    // It reports `n/a`: there is no wrong amount of pay data, so this card can never be a to-do
    // and can never delay "all set". The chip is information, not a verdict.
    /** @returns {boolean} whether this browser holds ANY of this member's pay calculator figures — what the line says */
    function initPayDataCard() {
        const line = document.getElementById('payDataInventory');
        try {
            // The keys are namespaced per member, so the namespace has to be set before they can
            // be found — Settings never opens the pay calculator, which is where that normally
            // happens. `lsKeys` is the iOS-safe enumerator (ls.js); a private-mode SecurityError
            // returns an empty list rather than throwing.
            setPaycalcNamespace(currentUser || undefined);
            // `selectBackupKeys` is the ONE selector — it filters to this member's prefix and
            // drops the device-level flags. Handing `inventoryOf` unfiltered keys would slice
            // every unrelated key by the prefix length and classify the wreckage as 'unknown',
            // so a phone with no pay data at all would report a pile of it.
            // EVERY kind it holds, not payslips and tax years alone (settings review, Nov 2026): pension
            // history, settings or back pay on their own read "None saved", and hid the Install card's
            // copy-your-figures step from a member who had figures to lose. `inventorySummary` words it.
            const sum = inventorySummary(inventoryOf(selectBackupKeys(lsKeys(), pcPrefix()), pcPrefix()));
            if (line) line.textContent = sum.any
                ? `${sum.line} — saved in this browser on this device`
                : 'No pay calculator history saved in this browser yet';
            reportSetting('pay-data', 'n/a', sum.chip);
            return sum.any;
        } catch (err) {
            console.warn('[payData] Inventory failed:', err);
            if (line) line.textContent = '';
            reportSetting('pay-data', 'n/a');
            return false;
        }
    }

    // ── Work Email card ───────────────────────────────────────────────────────────
    function initContactCard() {
        const emailInput = /** @type {HTMLInputElement} */ (document.getElementById('workEmailInput'));
        const saveBtn    = /** @type {HTMLButtonElement} */ (document.getElementById('workEmailSaveBtn'));
        const removeBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('workEmailRemoveBtn'));
        const feedback   = /** @type {HTMLElement} */ (document.getElementById('contactFeedback'));
        // REPORT BEFORE BAILING. `unknown` outranks every other state, so a card that never
        // reports does not merely lose its own chip — it holds the whole summary on "Checking your
        // settings…" for the life of the page, hiding a genuine to-do on a DIFFERENT card. The
        // markup is missing, so nothing was learnt: that is `error`, not `n/a`.
        if (!emailInput || !saveBtn) { reportSetting('work-email', 'error', 'Couldn’t check'); return; }

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
        // The field owns the LOCAL PART only — the domain sits beside it. Autofill and a
        // pasted address both arrive complete, so strip our own domain back off rather than
        // rendering it twice. 'change' as well as 'blur' because autofill fires change.
        const stripDomain = () => { emailInput.value = workEmailLocalPart(emailInput.value); };
        emailInput.addEventListener('change', stripDomain);
        emailInput.addEventListener('blur', () => {
            stripDomain();
        });
        // "✓ SAVED" ANSWERS THE ADDRESS IT WAS SAID ABOUT (settings review, Nov 2026). Typing a different one
        // left the tick beside it, reading as though the new address were saved before Save was pressed.
        let savedEmail = '';   // the full address the card last saw saved; '' when none is
        emailInput.addEventListener('input', () => {
            if (feedback.classList.contains('ok') && workEmailFrom(emailInput.value).toLowerCase() !== savedEmail.toLowerCase()) setFeedback('', '');
        });

        function setFeedback(/** @type {any} */ msg, /** @type {any} */ state) {
            setStatus(feedback, msg);   // a leading ✓ is decoration, not a word to announce (status-text.js)
            feedback.className   = `contact-feedback${state ? ' ' + state : ''}`;
        }

        function formatDate(/** @type {any} */ ts) {
            try {
                const d = ts?.toDate?.();
                if (!d || isNaN(d.getTime())) return null;
                return formatDayMonthYear(d);
            } catch { return null; }
        }

        // The subtitle earns its line twice over: before saving it says WHY to save an address,
        // after saving it says WHICH address is saved — which is the question a collapsed card
        // has to answer without being opened.
        const hintEl = document.getElementById('contactHint');
        const WHY_HINT = 'Save your Chiltern work email for account recovery';

        // The hint takes the FULL address explicitly: the field holds only the local part now,
        // so reading it back would put a half-address on the collapsed card — which is the one
        // place that has to answer "which address is saved?" without being opened.
        function showSavedState(/** @type {any} */ dateStr, /** @type {string} */ fullEmail) {
            userSaved = true;
            setFeedback(dateStr ? `✓ Saved — last updated ${dateStr}` : '✓ Saved', 'ok');
            markSaved(fullEmail);
        }

        /** An address IS saved: the card offers to remove it, its subtitle names it, and the summary counts it done.
         *  @param {string} fullEmail */
        function markSaved(fullEmail) {
            savedEmail = fullEmail || '';
            if (removeBtn) removeBtn.style.display = '';
            if (hintEl && fullEmail) hintEl.textContent = fullEmail;
            reportSetting('work-email', 'ok', '✓ Saved');
        }

        function clearSavedState() {
            savedEmail = '';
            setFeedback('', '');
            if (removeBtn) removeBtn.style.display = 'none';
            if (hintEl) hintEl.textContent = WHY_HINT;
            reportSetting('work-email', 'action', 'Not saved');
        }

        // Load existing email; show a loading message while waiting.
        setFeedback('Checking for a saved email…', '');
        // Through the claim retry, as Operations reads the same collection (settings review, Nov 2026): a
        // token minted before this member's `name` claim existed is refused until it refreshes, which read
        // here as "Couldn’t check" for a member whose email is saved.
        sessionReady.then(() => withClaimRetry(() => getStaffContact(/** @type {string} */ (currentUser)))).then(data => {
            // A fast type-and-save can beat this slow initial load: once the user has SAVED, the load's
            // stale result must not wipe the "✓ Saved" feedback or re-hide the Remove button — bail
            // entirely (the saved state on screen is newer than this read) (v16.69 review fix).
            if (userSaved) return;
            if (data?.workEmail && !userHasTyped) {
                emailInput.value = workEmailLocalPart(data.workEmail);
                showSavedState(formatDate(data.updatedAt), data.workEmail);
            } else if (data?.workEmail && userHasTyped) {
                // User started typing before the load finished — keep their input, and clear the loading message
                // without a "✓ Saved" that would answer a Save they have not pressed. But an address IS saved, so the
                // card says which and offers Remove (18 Nov 2026): it told the summary "✓ Saved" and left the
                // subtitle asking for an email and Remove hidden.
                setFeedback('', '');
                markSaved(data.workEmail);
            } else {
                clearSavedState();
            }
        }).catch(err => {
            console.warn('[staffContact] Load failed:', err);
            setFeedback('Couldn’t check your saved email — check your connection.', 'err');
            // NOT 'action': nothing was learnt, so the summary must not count it as a to-do and
            // must not count it as done either. `error` opens the card and holds back "all set".
            reportSetting('work-email', 'error', 'Couldn’t check');
        });

        emailInput.addEventListener('keydown', e => {   // not the Enter that accepts an input method's suggestion, which saved half-typed text
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveBtn.click(); }
        });

        saveBtn.addEventListener('click', async () => {
            const email = workEmailFrom(emailInput.value);
            setFeedback('', '');

            if (!email) {
                setFeedback('Please enter your work email address.', 'err');
                emailInput.focus();
                return;
            }
            if (!isValidEmail(email)) {
                setFeedback('That doesn’t look like a valid email address.', 'err');
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
                // withSlowSaveNotice: offline, a Firestore write settles only when the server answers,
                // and "Saving…" alone read as a freeze (v24.38 — Admin has said why since v24.21).
                await withSlowSaveNotice(saveStaffContact(currentUser, email));
                const today = formatDayMonthYear(new Date());
                emailInput.value = workEmailLocalPart(email);
                showSavedState(today, email);
            } catch (err) {
                console.warn('[staffContact] Save failed:', err);
                setFeedback(
                    // The app never verifies an email, so the check is the member's: is it SAVED (settings review).
                    unconfirmedWriteLine(err, 'the save', 'that your email is saved') ? /** @type {string} */ (unconfirmedWriteLine(err, 'the save', 'that your email is saved'))
                    : (/** @type {any} */ (err))?.code === 'permission-denied'
                        ? 'Couldn’t save — please sign out and sign back in.'
                        : 'Couldn’t save — check your connection and try again.',
                    'err'
                );
            } finally {
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save email';
            }
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                if (!await confirmDialog({ title: 'Remove your work email?', message: 'Only you and the admin can see it. You can save it again at any time.',
                    confirmLabel: 'Remove', danger: true })) return;
                removeBtn.disabled = true;
                try {
                    await sessionReady;
                    await withSlowSaveNotice(deleteStaffContact(currentUser));
                    emailInput.value = '';
                    clearSavedState();
                } catch (err) {
                    console.warn('[staffContact] Remove failed:', err);
                    setFeedback(
                        unconfirmedWriteLine(err, 'the removal', 'it is gone') ? /** @type {string} */ (unconfirmedWriteLine(err, 'the removal', 'it is gone'))
                        : (/** @type {any} */ (err))?.code === 'permission-denied'
                            ? 'Couldn’t remove — please sign out and sign back in.'
                            : 'Couldn’t remove — check your connection and try again.',
                        'err'
                    );
                } finally {
                    removeBtn.disabled = false;
                }
            });
        }
    }

    // ── Icon lightbox ─────────────────────────────────────────────────────────────
    // About panel (version, update status, bug link) is the shared about-lightbox.js.
    function initIconLightbox() {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Settings',
            getUserName: () => currentUser,
        });
        if (about) openAboutLightbox = about.open;

        wireHeaderLogo();   // the header logo goes back to the calendar (about-lightbox.js)
        // The coming-soon lightbox is owned entirely by nav-panel.js (open/close, Escape,
        // Android Back, focus trap). Do not re-wire it here — a duplicate handler used to
        // live in this function and left the nav-panel state flags out of sync (v11.50).
    }
}
