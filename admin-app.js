// @ts-check
/**
 * admin-app.js — the coordinator for admin.html.
 *
 * Owns: sign-in and the session, the member bar and week navigation, the unsaved-changes guard, the
 *   Change a Shift Save collector and its over-limit bar, the AL banner and recorded-dates wiring, the
 *   kept week draft, and initialising every card's module on load.
 * Does NOT own: the week grid and bulk bar (admin-week-editor.js), what a save writes
 *   (admin-overrides.js), the AL and Absence cards (admin-al.js, admin-sick.js, admin-range-booking.js),
 *   pay maths, calendar display or roster data. The roster PDF review and staff account set-up are
 *   Operations' (operations-app.js), not on this page.
 * Edit here for: login, page wiring, the Save collector. Not here: the grid, a save's write, shared CSS.
 */

import { CONFIG, teamMembers, MONTH_ABB, formatISO, isSunday, parseISODate } from './roster-data.js';
import { addDays, isRestGap, fmtPeriodDate, fmtPeriodRange } from './admin-period-dates.js';
import { auth, writeWithClaimRetry } from './firebase-client.js';
import { unconfirmedWriteLine, saveFailureMessage } from './claim-retry.js';
import { guardNamedSession, askBeforeSignOut, askBeforeLeavingByDrawer, signOutAndLeave, warnOnUnload, reloadIfRestoredForSomeoneElse, keepDraftWhenHidden, onReturnToPage } from './page-session.js';
import { createDraftSlot, weekRestoredLine } from './unsaved-draft.js';
import { ensureNamedSession, getSession, clearSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { requirePage, canOpenOvertime, canOpenNewlink } from './auth-policy.js';
import { deleteIfUnchanged, DELETE_REFUSED } from './admin-override-store.js';
import { PILL_TYPES, getAllOverrides, buildMemberDateMap, removeFromCache, initOverrides, loadOverrides, renderWeekGrid, updateWeekNavLabel, renderTable, executeSave, validateShiftRules, formatDisplay, resetBulkPills, updateSaveBtn, resetTableMemberFilter, _hasStagedEdits, setSaveInFlight, isSaveInFlight, whenOverridesReady, hasOverrideAuthorityFor, ensureMemberLoaded, sendingDays, NOT_ON_ROSTER_LINE, refusedLine } from './admin-overrides.js';
import { readWeekDraft, applyWeekDraft, unsavedWeekDraft, keptWeekDraft, _syncAlSwap } from './admin-week-row-state.js';
import { typePillHtml } from './admin-shift-types.js';
import { syncWeekAfterOwnWrite, withClearedDays } from './admin-own-write.js';
import { checkDayRules, weekStepAllowed, linkableDate } from './admin-shift-rules.js';
import { initLeaveYearPanel } from './admin-leave-year.js';
import { setLeaveYear } from './admin-leave-year-save.js';
import { initALSection, triggerConfirmedALSave } from './admin-al.js';
import { initSickSection } from './admin-sick.js';
import { initSelectSheets } from './select-sheet.js';
import { openDatePicker } from './date-picker.js';

import { lsGet, lsSet, lsDel } from './ls.js';
import { SELECTED_MEMBER } from './storage-keys.js';
import { initNavPanel } from './nav-panel.js';
import { initCardCollapse, createLightbox, confirmDialog, watchScrollFade } from './overlay.js';
import { initPasswordForce } from './password-force.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { CARD_TIPS } from './admin-tips.js';
import { mergeBookedPeriods } from './override-utils.js';
import { collectWeekRows } from './admin-week-collect.js';
import { alPosition, consumesEntitlement, costsWithoutSpareCap, entitlementNote, winningEntriesOfType } from './al-entitlement.js';
import { christmasLeaveByYear, christmasLeaveDates } from './christmas-leave.js';
import { planAlWeekSave } from './admin-al-week-save.js';
import { createBookedPeriods, fadeFeedback, holdFeedback, periodDelete } from './admin-booked-periods.js';
import { alFigureYear } from './admin-al-year.js';
import { registerServiceWorker, reloadWhenNotBusy } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';


import { setStatus } from './status-text.js';
import { initAdminWeekSwipe } from './admin-week-swipe.js';
import { resolveDeepLink, createDeepLinkLanding } from './admin-deep-link.js';
import { withSlowSaveNotice, writesInFlight } from './slow-save.js';

/**
 * Admin's sign-in card (login-overlay.js → `about`; owner, 11 Nov 2026): Pay's arrangement, with Pay's
 * PIN clause word for word — a station reaches both pages from one menu and the PIN opens neither
 * (AUTH_AND_SESSIONS 18, 24). The footnote is that station's way out: a sign-in here stays until undone.
 * @type {Readonly<{ lines: readonly string[], footnote: string }>}
 */
const ADMIN_SIGN_IN_ABOUT = Object.freeze({
    lines: Object.freeze([
        'Record your annual leave, absences and shift changes, so they show on the Calendar.',
        "It keeps them under your own name, so you sign in as yourself — the staff PIN doesn't open it.",
    ]),
    footnote: 'On a shared screen, sign out from the menu when you finish.',
});

/**
 * Programmatically open a collapsible card body, keeping the collapse control's ARIA state
 * in step. `initCardCollapse` only syncs `aria-expanded` on user click, so a class-only
 * `.open` (the auto-open / deep-link paths) would leave a screen reader hearing "collapsed"
 * on an expanded card. The chevron is the focusable control that carries `aria-expanded`.
 * @param {Element|null} body    - the `.card-collapsible-body`
 * @param {Element|null} chevron - the `.collapse-chevron` control
 */
function openCollapsibleCard(body, chevron) {
    if (body) body.classList.add('open');
    if (chevron) {
        chevron.classList.add('open');
        chevron.setAttribute('aria-expanded', 'true');
    }
}


/**
 * The coordinator body. admin-boot.js calls init() once (CSP `script-src 'self'` blocks an inline
 * module call), so a test can `import { init }` without it wiring listeners or touching the DOM. The
 * in-place sign-in calls the nested initAuthorised(), NOT init(), so module wiring happens once.
 */
export function init() {
    reloadIfRestoredForSomeoneElse();
    /** Where an `admin.html#…` arrival scrolls to, and the one-shot state behind its second scroll.
     *  Inside init() deliberately: at module scope it would be a bare `window` reference in the one
     *  coordinator whose stated property is that importing it runs nothing. */
    const _landing = createDeepLinkLanding(window);
    // Allow ?logout in the URL to force-clear session (useful when the sign-out
    // button is unreachable due to a broken or skipped login state).
    if (new URLSearchParams(location.search).has('logout')) {
        clearSession();
        history.replaceState(null, '', location.pathname); // remove ?logout from URL
    }

    // Tear down a privileged Firebase identity whose LOCAL session has expired, so a deep link cannot
    // keep an old credential live on a shared device. Fire-and-forget and login-safe: a no-op on a
    // valid session, and it stands down if a sign-in supersedes it.
    reconcileExpiredIdentity().catch(() => {});

    // ---- Check session immediately ----
    // `let`: an in-place sign-in refreshes these inside initAuthorised(). The AL and Absence sections
    // read currentUser through a live getter, so a later save still stamps the right `changedBy`.
    let currentSession = getSession();
    let isAuthenticated = !!currentSession;
    let currentUser     = currentSession?.name ?? null;
    let currentIsAdmin   = CONFIG.ADMIN_NAMES.includes(currentUser);
    let currentIsManager = (CONFIG.MANAGER_NAMES || []).includes(currentUser);

    // ---- Login overlay (shared in-place sign-in; see login-overlay.js) ----
    /** Show the shared sign-in overlay configured for Admin.
     *  NOTHING may be awaited on this path (the login freeze, ROADMAP_HISTORY.md): the first read after a fresh sign-in
     *  can take seconds, and it froze people on the overlay. Keep post-login work fire-and-forget. */
    function showAdminLogin({ reloadOnSuccess = false } = {}) {
        initLoginOverlay({
            pageLabel: 'Admin',
            about: ADMIN_SIGN_IN_ABOUT,
            onSuccess: () => {
                // reloadOnSuccess: on the stale-session path initAuthorised() already ran and resolved the
                // one-shot sessionReady, so only a reload gives a fresh one. A first sign-in initialises in
                // place, falling back to a reload if that throws.
                if (reloadOnSuccess) {
                    window.location.reload();
                } else {
                    try { initAuthorised(); } catch { window.location.reload(); }
                }
            },
        });
    }

    // ---- About lightbox (about-lightbox.js) — opened from the drawer logo; the header logo goes back ----
    /** @type {any} */
    let openAboutLightbox = null;
    (function() {
        const about = initAboutLightbox({
            appLabel: 'Marylebone Roster — Admin',
            getUserName: () => currentUser || 'Unknown',
        });
        if (about) openAboutLightbox = about.open;

        // Header logo: back to the calendar, through the unsaved-changes banner like every other exit.
        wireHeaderLogo(() => { const go = () => { window.location.href = './'; }; if (confirmNavigate(go)) go(); });
    })();

    // ---- Per-card tips lightbox: content in admin-tips.js, lifecycle and filtering in tips-lightbox.js ----
    // Managers pick members and see All staff exactly as the admin does, so they get the same tips (v24.56).
    initTipsLightbox(CARD_TIPS, { getIsAdmin: () => currentIsAdmin || currentIsManager });

    // ============================================
    // DOM
    // ============================================
    const fieldMember  = /** @type {HTMLSelectElement} */ (document.getElementById('fieldMember'));
    const fieldDate    = /** @type {HTMLInputElement} */ (document.getElementById('fieldDate'));
    const prevWeekBtn  = document.getElementById('prevWeekBtn');
    const nextWeekBtn  = document.getElementById('nextWeekBtn');
    const weekGrid     = /** @type {HTMLElement} */ (document.getElementById('weekGrid'));
    const saveBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('saveBtn'));
    const formFeedback = /** @type {HTMLElement} */ (document.getElementById('formFeedback'));

    // THE MEMBER BAR STAYS WHERE THE DOCUMENT PUTS IT — straight after the header, an early Tab stop —
    // and admin.css places it. What CSS cannot know is three heights it lays out round: this bar's,
    // the fixed Unsaved bar's (0 while hidden) and the over-allowance question's.
    if (typeof ResizeObserver === 'function') {
        const root = document.documentElement, heights = new Map([[document.querySelector('.member-context-bar'), '--member-bar-h'],
            [document.getElementById('stagedBar'), '--staged-bar-h'], [document.getElementById('alConfirmBar'), '--al-confirm-h']]);
        const ro = new ResizeObserver(es => es.forEach(e => root.style.setProperty(/** @type {string} */ (heights.get(e.target)),
            `${e.borderBoxSize?.[0]?.blockSize ?? /** @type {HTMLElement} */ (e.target).offsetHeight}px`)));
        heights.forEach((_, el) => { if (el) ro.observe(el); });
    }
    watchScrollFade(document.querySelector('.col-side'));   // a short window scrolls the side column: the fade says so

    // ============================================
    // POPULATE MEMBER DROPDOWNS
    // ============================================
    // Optgroups in CONFIG.GRADE_ORDER (as the sign-in's), not teamMembers order; unlisted roles go last.
    const _GRADE_ORDER = CONFIG.GRADE_ORDER;
    const roles = [...new Set(teamMembers.filter(m => !m.hidden).map(m => m.role))]
        .sort((a, b) => {
            const ia = _GRADE_ORDER.indexOf(a), ib = _GRADE_ORDER.indexOf(b);
            return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
        });

    /** @param {any} select */
    function populateMemberDropdown(select) {
        roles.forEach(role => {
            const grp = document.createElement('optgroup');
            grp.label = role;
            teamMembers.filter(m => m.role === role && !m.hidden).forEach(m => {
                grp.appendChild(new Option(m.name, m.name));
            });
            select.appendChild(grp);
        });
    }

    populateMemberDropdown(fieldMember);

    // Selects `val` and returns true — or leaves the select as it was and returns false when no option carries it, where `.value` would empty it.
    // (Written believing iOS Safari ignores `.value` with <optgroup>s; WebKit does not — measured 10 Nov 2026, see select-sheet.js.)
    /**
     * @param {any} sel
     * @param {any} val
     */
    function _setSelectValue(sel, val) {
        for (const o of sel.options) if (o.value === val) {
            o.selected = true;
            // Announce it: setting `selected` is invisible to every observer, so the enhanced trigger —
            // the only member name on screen — would keep naming the previous person (select-sheet-parity 8).
            sel.dispatchEvent(new Event('input', { bubbles: false }));
            return true;
        }
        return false;   // no matching option — caller may need to handle (e.g. a hidden/leaver member)
    }

    // Restore the last-used member from the shared cross-page key — if still SELECTABLE (not hidden),
    // or the field would be blank. With nothing to restore the first member is chosen HERE: WebKit,
    // unlike Chromium, does not skip the disabled placeholder. applyPermissions still locks staff.
    const _savedMember = lsGet(SELECTED_MEMBER);
    const lastMember = (_savedMember && teamMembers.find(m => m.name === _savedMember && !m.hidden))
        ? _savedMember : null;
    if (lastMember) {
        _setSelectValue(fieldMember, lastMember);
        // Persist the member so the reverse journey (admin → index) restores it.
        lsSet(SELECTED_MEMBER, lastMember);
    } else if (_savedMember) {
        lsDel(SELECTED_MEMBER);   // stale (hidden/left)
    }
    if (!fieldMember.value) _setSelectValue(fieldMember, Array.from(fieldMember.options).find(o => !o.disabled && o.value)?.value);

    // Default date = today, or the date passed from index.html via ?date=YYYY-MM-DD.
    // This preserves the month the staff member was viewing when they tapped Admin.
    const _urlDate = new URLSearchParams(location.search).get('date');
    fieldDate.value = linkableDate(_urlDate) ? /** @type {string} */ (_urlDate) : formatISO(new Date());
    fieldDate.min = `${CONFIG.MIN_YEAR}-01-01`; fieldDate.max = `${CONFIG.MAX_YEAR}-12-31`;   // the configured years; the date picker greys out past them
    // One writer owns the label's format (admin-week-editor.js).
    updateWeekNavLabel(fieldDate.value);

    // ============================================
    // UNSAVED CHANGES GUARD
    // ============================================
    // Tracks whether the USER has made a change since the last render.
    // renderWeekGrid() pre-fills rows from existing overrides — those are
    // NOT unsaved changes, so we use an explicit flag rather than checking
    // dataset.type (which is set by the pre-fill as well).
    let userMadeChanges = false;

    /** True if the user has edited the week grid AND something is still staged — derived, never
     *  cleared by hand, since loads and deletes keep staged rows on screen. */
    function hasUnsavedChanges() { return userMadeChanges && _hasStagedEdits(); }

    /** Marks the grid as having unsaved changes. Call on any user interaction. */
    function markChanged() {
        userMadeChanges = true;
        // A new edit invalidates a showing over-limit bar: its batch predates the edit, and "Save anyway"
        // would write it and discard the newer edit. Save again recollects and re-checks.
        hideALConfirm('week');
    }

    // Warn browser/OS before closing or navigating away — and ask in the page before a drawer link
    // leaves, since a phone never shows the browser's prompt (whole-app review, Oct 2026).
    warnOnUnload(hasUnsavedChanges);
    askBeforeLeavingByDrawer(hasUnsavedChanges);

    // Pending navigation callback — set by confirmNavigate() when unsaved changes
    // exist. Executed if the user taps "Discard and continue" in the banner.
    /** @type {any} */
    let _pendingNavigate = null;
    // Element focus returns to when the unsaved banner is dismissed without navigating.
    /** @type {any} */
    let _bannerReturnFocus = null;

    (function initUnsavedBanner() {
        const banner      = document.getElementById('unsavedBanner');
        const discardBtn  = document.getElementById('unsavedDiscardBtn');
        const keepBtn     = document.getElementById('unsavedKeepBtn');
        if (!banner || !discardBtn || !keepBtn) return;

        discardBtn.addEventListener('click', () => {
            banner.style.display = 'none';
            // The discard action navigates/re-renders. Focus goes back to the control that asked to
            // leave — the week arrow or the member picker — once it has, unless the new view took
            // it; the banner hiding under the pressed button sent it to <body> (review, 21 Nov 2026).
            const asker = /** @type {HTMLElement|null} */ (_bannerReturnFocus);
            _bannerReturnFocus = null;
            // (A hidden button can still be the active element until the next style pass, so focus
            // still inside the banner counts as lost too.)
            const lost = () => !document.activeElement || document.activeElement === document.body || banner.contains(document.activeElement);
            const refocus = () => { if (asker?.isConnected && lost()) asker.focus({ preventScroll: true }); };
            userMadeChanges = false;
            // …and disarm the over-limit bar, or "Save anyway" writes the batch just discarded.
            hideALConfirm('week');
            if (_pendingNavigate) { const fn = _pendingNavigate; _pendingNavigate = null; Promise.resolve(fn()).finally(refocus); }
            else refocus();
        });
        keepBtn.addEventListener('click', () => {
            banner.style.display = 'none';
            _pendingNavigate = null;
            // Restore focus to wherever the user was before the banner interrupted them.
            _bannerReturnFocus?.focus?.();
            _bannerReturnFocus = null;
        });
        // Escape is "Keep editing", as it declines every question — unless a dialog over it owns that Escape.
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && banner.style.display === 'flex' && !document.body.classList.contains('lb-open')) keepBtn.click();
        });
    })();

    /**
     * If there are unsaved changes, shows a confirmation banner and stores the
     * navigation action for execution if the user chooses to discard.
     * Returns true immediately if nothing is unsaved (safe to continue now).
     * Returns false if unsaved changes exist — the banner handles continuation.
     * @param {Function} onConfirm  Action to run after the user confirms discard
     * @returns {boolean} true = proceed now, false = wait for banner response
     */
    function confirmNavigate(onConfirm) {
        if (!hasUnsavedChanges()) return true;
        const banner = document.getElementById('unsavedBanner');
        if (banner) {
            _pendingNavigate = onConfirm || null;
            // Non-modal alertdialog: move focus into it so keyboard/AT users land on the
            // decision, and remember where they were so "Keep editing" can return them.
            _bannerReturnFocus = document.activeElement;
            banner.style.display = 'flex';
            document.getElementById('unsavedKeepBtn')?.focus();
        }
        return false;
    }

    // ============================================
    // WEEK NAVIGATION
    // ============================================
    /**
     * Moves the selected week forwards or backwards by delta weeks.
     * Prompts for confirmation if there are unsaved changes.
     * @param {number} delta  Positive = forward, negative = back
     */
    function shiftWeek(delta) {
        if (!weekStepAllowed(fieldDate.value, delta * 7)) return;   // the configured years (the arrow is disabled too)
        const go = () => {
            const d = parseISODate(fieldDate.value);
            d.setDate(d.getDate() + delta * 7);
            fieldDate.value = formatISO(d);
            lastFieldDate = fieldDate.value;
            renderWeekGrid();
            // As the swipe and the date field: a Dec→Jan jump must not leave last year's figures showing.
            updateALBanner(); updateALBookedBox(); updateSickBookedBox();
        };
        if (confirmNavigate(go)) go();
    }

    // The week label IS the app's date picker's trigger (the OS draws nothing the app can). The input
    // stays the value holder: the picker writes `.value` and dispatches `change`, so the unsaved-changes
    // guard below still gets its say, and still reverts on a decline.
    /** @type {HTMLElement} */ (document.getElementById('weekNavLabel'))
        // `week: true` — this grid's week runs Sunday–Saturday, so the picker does too, and bands it.
        .addEventListener('click', () => openDatePicker(fieldDate, { title: 'Jump to a week', week: true }));

    /** @type {HTMLElement} */ (document.getElementById('thisWeekBtn')).addEventListener('click', () => {
        const go = () => {
            fieldDate.value = formatISO(new Date()); lastFieldDate = fieldDate.value; renderWeekGrid();
            updateALBanner(); updateALBookedBox(); updateSickBookedBox();   // keep the banner year in sync
        };
        if (confirmNavigate(go)) go();
    });

    // ============================================
    // WEEK GRID — SWIPE GESTURE. The gesture itself — lazy capture, the carousel, the cooldown — is
    // admin-week-swipe.js; what a week change MEANS stays here. No swipe with unsaved changes or no member/week.
    // ============================================
    initAdminWeekSwipe({
        weekGrid: /** @type {HTMLElement} */ (weekGrid),
        fieldDate: /** @type {HTMLInputElement} */ (fieldDate),
        prevWeekBtn: /** @type {HTMLElement} */ (prevWeekBtn),
        nextWeekBtn: /** @type {HTMLElement} */ (nextWeekBtn),
        canNavigate: () => !hasUnsavedChanges() && !!fieldMember.value && !!fieldDate.value,
        // What a week change MEANS to Admin stays here; the gesture knows none of it.
        onWeekCommitted: (iso) => {
            lastFieldDate = iso;
            updateWeekNavLabel(iso);
            updateALBanner();
            updateALBookedBox();
            updateSickBookedBox();
            userMadeChanges = false;
        },
        onSettled: (redrawn) => { if (redrawn) renderWeekGrid(); resetBulkPills(); updateSaveBtn(); },
        shiftWeek,
    });

    // ============================================
    // ANNUAL LEAVE BANNER
    // ============================================
    /** The year the AL range picker is SHOWING, or null until it crosses a year (see admin-al-year.js). */
    let alPickerViewYear = /** @type {number|null} */ (null);

    // WHICH YEAR'S ALLOWANCE A JANUARY LEAVE DAY COMES OUT OF: admin-leave-year.js. Built
    // BEFORE `updateALBanner`, which reads it, so no first call can find it uninitialised.
    const _leaveYearPanel = initLeaveYearPanel({
        getMember: () => teamMembers.find(m => m.name === alMember?.value) ?? null,
        hasAuthority: hasOverrideAuthorityFor, getOverrides: getAllOverrides,
        save: (args) => setLeaveYear({ ...args, changedBy: currentUser ?? '' }),
        onSaved: () => { updateALBanner(); updateALBookedBox(); },
    });

    /**
     * Refreshes the AL entitlement banner above the Annual Leave card: taken, booked and remaining
     * for the year `admin-al-year.js` picks. Hidden when there is nothing truthful to state.
     */
    function updateALBanner() {
        const banner      = /** @type {HTMLElement} */ (document.getElementById('alBanner'));
        const remEl       = /** @type {HTMLElement} */ (document.getElementById('alBannerRemaining'));
        const takenEl     = /** @type {HTMLElement} */ (document.getElementById('alBannerTaken'));
        const bookedEl    = /** @type {HTMLElement} */ (document.getElementById('alBannerBooked'));
        const entEl       = /** @type {HTMLElement} */ (document.getElementById('alBannerEntitlement'));
        const warnEl      = /** @type {HTMLElement} */ (document.getElementById('alBannerWarn'));
        if (!alMember || !banner) return;
        const memberName  = alMember.value;
        _leaveYearPanel?.refresh();   // the same moment as this banner, before any exit below

        /** Hide every figure this card states — the banner AND the header chip, or the previous
         *  member's leave left sits under the new member's name. ONE exit for every way to have nothing
         *  truthful to say. */
        const showNothing = () => {
            banner.hidden = true;
            const _hb = document.getElementById('alHeaderBalance');
            if (_hb) _hb.hidden = true;
        };

        if (!memberName) { showNothing(); return; }

        const member      = teamMembers.find(m => m.name === memberName);
        if (!member)      { showNothing(); return; }

        // Nor for a member whose overrides were never read: unread and no leave are the same empty slice.
        if (!hasOverrideAuthorityFor(memberName)) { showNothing(); return; }

        // WHICH YEAR THESE FOUR FIGURES DESCRIBE — the precedence between the four places this page
        // implies one is `admin-al-year.js`, where the ordering that broke is tested with no DOM.
        const alFrom  = /** @type {HTMLInputElement|null} */ (document.getElementById('alFrom'));
        const yearStr = alFigureYear({ pickedFrom: alFrom?.value, pickerViewYear: alPickerViewYear,
                                       shiftDate: fieldDate.value, today: new Date() });
        // The banner and the two save-time cap checks must answer ONE question the same way — see
        // al-entitlement.js for the two rules and the disagreement that made it a module.
        const { entitlement, taken, booked, remaining } = alPosition({
            overrides: getAllOverrides(),
            member,
            year: yearStr,
            todayStr: formatISO(new Date()),
        });

        // NO ENTITLEMENT ON RECORD → SHOW NO FIGURES: every number here derives from it. Both are
        // checked — they are null together — so the type checker can prove the arithmetic never sees one.
        if (entitlement === null || remaining === null) { showNothing(); return; }

        remEl.textContent    = String(remaining);
        takenEl.textContent  = String(taken);
        bookedEl.textContent = String(booked);
        entEl.textContent    = String(entitlement);
        // …AND WHICH YEAR (whole-app check, Nov 2026; admin-2-14): a save keeps the picker on the year it booked.
        const entLbl = document.getElementById('alBannerLblEntitlement');
        if (entLbl) entLbl.textContent = `${yearStr} entitlement`;

        // What the entitlement is made of, in ONE line shared with the Calendar's leave panel
        // (`entitlementNote`). Never `entitlement - 22`, which goes negative for a mid-year joiner.
        const breakdownEl = document.getElementById('alBannerBreakdown');
        if (breakdownEl) {
            const note = entitlementNote({ member, year: yearStr, overrides: getAllOverrides() });
            if (note) breakdownEl.textContent = note;
            breakdownEl.hidden = !note;
        }

        banner.hidden = false;
        banner.classList.toggle('al-banner-warning', remaining <= 0);
        banner.classList.toggle('al-banner-low',     remaining > 0 && remaining <= 5);

        warnEl.hidden      = remaining > 0;
        warnEl.textContent = remaining === 0 ? 'Allowance used up' : `${Math.abs(remaining)} over allowance`;

        // Show remaining balance on the collapsed card header so staff see it at a glance
        const headerBalEl = document.getElementById('alHeaderBalance');
        const headerRemEl = document.getElementById('alHeaderRemaining');
        if (headerBalEl && headerRemEl) {
            headerRemEl.textContent = String(remaining);
            // …AND WHICH YEAR (review, Nov 2026): the banner's, which can be next year's in December. "2026: 12
            // left" rather than "2026 AL left: 12", which wrapped the card's title onto two lines at 375px.
            const headerYearEl = document.getElementById('alHeaderYear');
            if (headerYearEl) headerYearEl.textContent = yearStr;
            headerBalEl.hidden = false;
            // The shared .card-year-chip; .al-left-chip modifiers colour the low/none states.
            headerBalEl.className = 'card-year-chip al-left-chip'
                + (remaining <= 0 ? ' balance-none' : remaining <= 5 ? ' balance-low' : '');
        }
    }

    // ============================================
    // SAVE
    // ============================================
    saveBtn.addEventListener('click', async () => {
        try {
        hideFeedback();
        const memberName = fieldMember.value;
        if (!memberName) return showError('Select a staff member at the top first.');

        // Clear any previous row-level errors
        weekGrid.querySelectorAll('.day-row.row-error').forEach(r => r.classList.remove('row-error'));
        _alPendingSkipped = [];   // and the last save's skipped days: this one answers for itself
        _alPendingKept    = [];

        // What the rows ask to write, and why any cannot be (admin-week-collect.js, review 21 Nov 2026).
        const collected = collectWeekRows({ rows: /** @type {NodeListOf<HTMLElement>} */ (weekGrid.querySelectorAll('.day-row')),
            memberName, formatDate: formatDisplay });
        let toSave = collected.toSave;
        const { toDelete, errors, swapAnswers } = collected;

        if (errors.length)                    return showError("Can't save — " + errors.join(' · '));
        // DAYS THAT TAKE NO CHANGE (admin-shift-rules.js): before the start date; an Other day or a Spare
        // turn on Christmas Day or Boxing Day.
        // Here, after the collector (admin-week-collect.js): it reads the member, which the collector does not.
        const dayRules = checkDayRules({ toSave, member: teamMembers.find(m => m.name === memberName), formatDate: formatDisplay });
        dayRules.failedDates.forEach(d => weekGrid.querySelector(`.day-row[data-date="${d}"]`)?.classList.add('row-error'));
        if (dayRules.errors.length)           return showError("Can't save — " + dayRules.errors.join(' · '));
        if (!toSave.length && !toDelete.length) return showError('No changes to save.');

        // The rest-gap check (adjacent days) and the entitlement check read the cache, so wait for the
        // load — Save IN FLIGHT first, not merely disabled, or a keystroke re-arms it during the wait.
        // The finally restores it on every exit.
        setSaveInFlight(true);
        await whenOverridesReady();
        // …and refuse unless THIS MEMBER's records were read: an unread member reads as an empty week,
        // a rest gap missed and no leave taken.
        if (!hasOverrideAuthorityFor(fieldMember?.value)) return showError(globalThis.navigator?.onLine === false
            ? "You're offline, so this member's saved changes can't be checked — reconnect, then save."
            : "Still loading this member's saved changes — try again in a moment.");

        // Validate shift duration and rest-gap rules
        const ruleErrors = validateShiftRules(toSave, memberName, toDelete);
        if (ruleErrors.length) return showError(ruleErrors.join(' · '));

        // ANNUAL LEAVE: what this save writes, what it leaves alone, and whether it over-books —
        // decided in one place, `admin-al-week-save.js`, which is pure and takes the record rather
        // than reading it. `buildMemberDateMap` is what makes a SWAPPED-IN day already on record cost
        // a day: its `shift` override is still there at this point, the leave replacing it not yet
        // written. What stays here is the DOM half — the bar, or the commit.
        const alPlan = planAlWeekSave({
            member: /** @type {any} */ (teamMembers.find(m => m.name === memberName)),
            memberName, toSave, toDelete,
            ovByDate: buildMemberDateMap(memberName), swapAnswers, overrides: getAllOverrides(),
        });
        // The planner decides; this names the days. Ordinarily the per-row check above has already
        // refused and this never fires — it is reached when that check's input was stale, which the
        // planner's own block explains. Marking the rows keeps the two refusals looking the same, and
        // the question is PUT on each (review, Nov 2026): the row was drawn before the record that
        // settled it went, so it had never asked, and the refusal named a question nobody could see.
        if (alPlan.unanswered.length) {
            alPlan.unanswered.forEach(d => {
                const row = /** @type {HTMLElement|null} */ (document.querySelector(`.day-row[data-date="${d}"]`));
                if (!row) return;
                row.classList.add('row-error');
                row.dataset.alSwapAsk = '1';
                _syncAlSwap(row);
            });
            return showError(alPlan.unanswered
                .map(d => `${formatDisplay(d)}: say whether this rest day was a swapped working day`)
                .join(' · '));
        }
        // …and a day answered about a record that has changed since, which the planner withholds too: refused
        // in the words the commit's own check uses for a day changed under the page (admin-overrides.js).
        if (alPlan.changedUnder.length) {
            alPlan.changedUnder.forEach(d => weekGrid.querySelector(`.day-row[data-date="${d}"]`)?.classList.add('row-error'));
            return showError(refusedLine(alPlan.changedUnder));
        }
        toSave = alPlan.toSave;
        _alPendingSkipped = alPlan.skipped;      // the receipt names them: never a silent drop
        _alPendingKept    = alPlan.keptLeave;    // …and which of them the reader will still see leave on
        if (alPlan.overage) {
            showALConfirm(alPlan.overage.headline, alPlan.overage.detail, toSave, toDelete);
            return;
        }

        await executeSave(toSave, toDelete, _alPendingSkipped, _alPendingKept);
        } catch (err) {
            console.error('[Admin] Save handler error:', err);
            showError('Unexpected error — please reload and try again.');
        } finally {
            // Restore the Save button on every exit path, recomputed from the grid.
            setSaveInFlight(false);
        }
    });

    // ── Staged bar — duplicates Save / Discard at the bottom so users don't scroll up ──
    document.getElementById('stagedSaveBtn')?.addEventListener('click', () => saveBtn.click());
    document.getElementById('stagedDiscardBtn')?.addEventListener('click', () => {
        userMadeChanges = false;
        // "Save anyway" after a discard must not write the batch back.
        hideALConfirm('week');
        // The bar is about to go under the pressed button: the keyboard goes to the week's date button
        // first, rather than to the last receipt, which is about the work just thrown away (21 Nov 2026).
        /** @type {HTMLElement|null} */ (document.getElementById('weekNavLabel'))?.focus({ preventScroll: true });
        renderWeekGrid();
    });

    // ── AL / sick — element handles and display helpers referenced by the member picker below ──
    // Declared here because the fieldMember change handler references them.
    const alMember   = /** @type {HTMLSelectElement} */ (document.getElementById('alMember'));
    const sickMember = /** @type {HTMLSelectElement} */ (document.getElementById('sickMember'));
    /** Fill (or hide) one card's "Recording for <name>" row.
     *  Shown only to a manager or admin: they are the only identities that can point these cards at
     *  somebody else, and for a self-service member the row would state the one fact they already
     *  know. It reads the LIVE `currentIsAdmin`/`currentIsManager` rather than a captured value —
     *  the in-place sign-in path assigns those inside initAuthorised(), after this module loaded
     *  signed out. Empty name ⇒ hidden, never a row saying "Recording for" with nothing after it.
     *  @param {string} rowId  id of the .card-member-for row
     *  @param {string} nameId id of the .cmf-name span inside it
     */
    function _syncMemberFor(rowId, nameId) {
        const row  = document.getElementById(rowId);
        const name = document.getElementById(nameId);
        if (!row || !name) return;
        const who = (currentIsAdmin || currentIsManager) ? fieldMember.value : '';
        name.textContent = who;
        row.hidden = !who;
    }
    // "Recording for" is what each card says about its member.
    function syncMemberDisplay()     { _syncMemberFor('alMemberFor', 'alMemberForName'); }
    function syncSickMemberDisplay() { _syncMemberFor('sickMemberFor', 'sickMemberForName'); }

    // Preview refreshers from initALSection / initSickSection (assigned further down), called on a
    // member change so neither preview keeps naming the previous person.
    /** @type {(() => void) | null} */ let _refreshAlPreview   = null;
    /** @type {(() => void) | null} */ let _refreshSickPreview = null;

    let lastFieldMember = fieldMember.value;
    /** Point the AL/Absence cards, banner, booked lists and previews at `name` (fieldMember and
     *  fieldDate already set). ONE list for every path that switches member: ✏️ Edit and the jump
     *  after a booking kept their own and lost resetPinned/hideALConfirm (review A8/A11), so the
     *  booked box's ✕ could delete the previous member's periods. @param {string} name */
    function _followMember(name) {
        if (name !== lastFieldMember) _bookedPeriods.resetPinned();   // a year chosen for someone else
        lastFieldMember = name;
        lsSet(SELECTED_MEMBER, name);
        _setSelectValue(alMember, name);
        _setSelectValue(sickMember, name);
        syncMemberDisplay();
        syncSickMemberDisplay();
        updateALBanner(); updateALBookedBox(); updateSickBookedBox();
        _refreshAlPreview?.();   // an already-picked range must not keep naming the previous member
        _refreshSickPreview?.();
        // The over-limit bar was for the PREVIOUS view: "Save anyway" must not book the new member unchecked.
        hideALConfirm();
    }
    fieldMember.addEventListener('change', () => {
        const chosen   = fieldMember.value;
        const previous = lastFieldMember;
        const go = () => {
            // Re-assert: on the unsaved-changes path the select was reverted to `previous` below.
            _setSelectValue(fieldMember, chosen);
            _followMember(chosen);
            resetTableMemberFilter(); // also calls renderTable internally
            renderWeekGrid();
            // The new member's overrides may never have been read. renderWeekGrid paints a "loading"
            // week for an uncovered member rather than an empty one — an empty week is a claim, and
            // it would be a false one. ensureMemberLoaded is a no-op for anyone already covered, so
            // switching back to a member costs nothing and flashes nothing.
            ensureMemberLoaded(chosen).catch(() => { /* the load path renders its own retry */ });
        };
        if (confirmNavigate(go)) { go(); return; }
        // Revert the dropdown to the previously confirmed member while the banner waits
        _setSelectValue(fieldMember, previous);
    });
    let lastFieldDate = fieldDate.value;
    fieldDate.addEventListener('change', () => {
        const newVal = fieldDate.value;
        const go = () => {
            fieldDate.value = newVal;
            lastFieldDate = newVal;
            renderWeekGrid();
            updateALBanner();
            updateALBookedBox();
            updateSickBookedBox();
        };
        if (confirmNavigate(go)) { go(); return; }
        // Revert the date picker while the banner waits for a decision
        fieldDate.value = lastFieldDate;
    });

    // ============================================

    /**
     * Handles edit button clicks in the Saved Changes table.
     * Populates the member selector and week date with the override's values,
     * re-renders the week grid, and scrolls to the Change a Shift card.
     * @param {MouseEvent} e
     */
    function handleEdit(e) {
        // closest() makes this work both directly and via delegation on tableBody.
        const btn        = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('.btn-edit'));
        if (!btn) return;
        const memberName = btn.dataset.member || '';
        const date       = btn.dataset.date || '';
        const go = () => {
            // A hidden member is not in the dropdown, and going on would edit whoever IS selected.
            if (!_setSelectValue(fieldMember, memberName)) {
                showError(`${memberName} isn't in the staff list (hidden or left) — can't edit their entry here. Delete it from Saved Changes, or un-hide the member first.`);
                return;
            }
            fieldDate.value   = date;
            lastFieldDate     = date;
            // _setSelectValue fires no 'change' event, so the fieldMember handler never runs here —
            // without this a booking made right after an ✏️ edit records against the previous member.
            _followMember(memberName);
            renderWeekGrid();
            // The row may come from a capped All-staff read, which covers nobody (review A11).
            ensureMemberLoaded(memberName).catch(() => { /* the load path renders its own retry */ });
            /** @type {HTMLElement} */ (document.querySelector('.card')).scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        if (confirmNavigate(go)) go();
    }

    /**
     * Points the Change a Shift section at a member + date and re-renders its
     * week grid and saved-changes list. Called after an AL or absence save so
     * the section immediately reflects what was just recorded — without this it
     * stays on whatever week it was showing, making the save look like it failed.
     * @param {string} memberName
     * @param {string} date        YYYY-MM-DD — any date within the week to show
     */
    function showInChangeAShift(memberName, date) {
        const go = () => {
            _setSelectValue(fieldMember, memberName);
            fieldDate.value   = date;
            lastFieldDate     = date;
            _followMember(memberName);   // the banner and booked boxes too (review A8)
            // Align the saved-changes month filter so the new days aren't filtered out.
            const monthFilter = /** @type {HTMLSelectElement} */ (document.getElementById('overridesMonthFilter'));
            if (monthFilter) monthFilter.value = date.substring(0, 7);
            renderTable();
            renderWeekGrid();
            ensureMemberLoaded(memberName).catch(() => { /* the load path renders its own retry */ });
            // The grid was rebuilt fresh from saved data — no pending edits remain.
            userMadeChanges = false;
        };
        // Re-pointing the grid would discard UNSAVED edits, so it asks as every navigation does. The
        // booking has already committed; this only governs whether the grid jumps to it.
        if (confirmNavigate(go)) go();
    }


    // ============================================
    // UTILITIES
    // ============================================


    /** @type {any} */ let _toastTimer = null;
    /** @type {any} */ let _feedbackTimer = null;
    /**
     * @param {string} msg
     * @param {string[]} [lines] one per changed DAY — rendered as an expandable receipt (v21.38).
     *   Built with DOM nodes rather than markup: the lines carry member-entered times and notes, and
     *   textContent cannot be made to mean anything but text.
     * @param {{ toast?: boolean }} [o] `toast: false` for STAGED days (Apply): the toast confirms a SAVE, and it covered the Unsaved bar.
     */
    function showSuccess(msg, lines, { toast = true } = {}) {
        clearTimeout(_feedbackTimer);
        formFeedback.className = 'feedback success';
        setStatus(formFeedback, '✓ ' + msg);
        if (lines?.length) {
            const details = document.createElement('details');
            details.className = 'save-receipt';
            const summary = document.createElement('summary');
            summary.textContent = `Show the ${lines.length === 1 ? 'day' : lines.length + ' days'}`;
            details.appendChild(summary);
            const ul = document.createElement('ul');
            lines.forEach(l => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
            details.appendChild(ul);
            formFeedback.appendChild(details);
        }
        // A RECEIPT DOES NOT TIME OUT: the fold is an interactive control, and a timer would drop focus
        // on <body> mid-check. It stays until the next save, error or member change replaces it.
        if (!lines?.length) _feedbackTimer = setTimeout(hideFeedback, 7000);

        // Also show a bottom-anchored toast so confirmation is visible regardless of scroll position
        if (toast) showToast('✓ ' + msg);
    }

    /**
     * The bottom-anchored confirmation — visible whatever the scroll position, which is the point:
     * the inline feedback lines sit at the TOP of their cards, and the control that was just used
     * can be a screen's height below them. Shared by Save and by a recorded-dates delete.
     * @param {string} msg
     */
    function showToast(msg) {
        const toast = document.getElementById('saveToast');
        if (!toast) return;
        clearTimeout(_toastTimer);
        setStatus(toast, msg);
        toast.classList.add('visible');
        _toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
    }

    /** Shows an error message in the week editor feedback area.  @param {string} msg */
    function showError(msg) {
        clearTimeout(_feedbackTimer);
        formFeedback.className = 'feedback error';
        setStatus(formFeedback, '⚠ ' + msg);
        formFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /** Clears the week editor feedback area. */
    function hideFeedback() {
        formFeedback.className = 'feedback';
        hideALConfirm('week');
    }

    // ---- AL over-limit confirm bar ----
    /** @type {any} */ let _alPendingSave   = null;
    /** @type {any[]} */ let _alPendingDelete = [];
    /** @type {string[]} */ let _alPendingSkipped = [];   // staged days the projection leaves alone
    /** @type {string[]} */ let _alPendingKept    = [];   // …of those, the ones that still hold leave
    /** @type {HTMLElement|null} */ let _alOpener = null;
    /** @type {(() => void)|null} */ let _alResume = null;   // a range card's own "Save anyway" (the Absence card's, admin-sick.js)
    // WHOSE QUESTION THE BAR IS ASKING (review, 21 Nov 2026). Four cards share one bar — the week grid,
    // Annual Leave, Absence and Saved Changes — and each took it down on its own routine events, so
    // editing an AL range dismissed the week grid's question unanswered, and the week's Save the AL
    // card's. A card now takes down only its OWN question; a member change, Cancel and Save anyway
    // still clear whatever is showing, because each of those ends the question for everybody.
    /** @type {'week'|'al'|'sick'|'saved'|null} */ let _alOwner = null;
    const alConfirmBar       = /** @type {HTMLElement} */ (document.getElementById('alConfirmBar'));
    const alConfirmMsg       = /** @type {HTMLElement} */ (document.getElementById('alConfirmMsg'));
    const alConfirmSub       = /** @type {HTMLElement} */ (document.getElementById('alConfirmSub'));
    const alConfirmSaveBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('alConfirmSaveBtn'));
    const alConfirmCancelBtn = /** @type {HTMLElement} */ (document.getElementById('alConfirmCancelBtn'));

    /**
     * Shows the AL over-entitlement confirmation bar with a warning and two options.
     * In the week editor path, pendingSave is the toSave array to resume with.
     * In the AL booking path, pendingSave is null — the bar re-triggers alSaveBtn.click(), or runs `resume`.
     * @param {string}      msg          Main warning line
     * @param {string}      sub          Secondary detail line
     * @param {any[]|null}  pendingSave  toSave batch to resume, or null for AL booking path
     * @param {string[]}    pendingDelete  IDs to delete in the same batch
     * @param {(() => void)|null} [resume] what "Save anyway" runs for a range card other than AL's
     * @param {'week'|'al'|'sick'|'saved'} [owner] the card asking; by default the week grid when it
     *        hands a batch, else the AL card
     */
    function showALConfirm(msg, sub, pendingSave, pendingDelete = [], resume = null, owner) {
        _alOwner = owner ?? (pendingSave ? 'week' : 'al');
        clearTimeout(_feedbackTimer);   // an earlier success line's fade must not take the question down (Oct 2026)
        _alPendingSave   = pendingSave;
        _alPendingDelete = pendingDelete;
        _alResume        = resume;
        alConfirmMsg.textContent = msg;
        alConfirmSub.textContent = sub;
        alConfirmSaveBtn.disabled = false;   // re-arm (the click handler disables to block a double-tap)
        const asker = document.activeElement;   // the Save that asked, which Cancel goes back to — on Safari, which focuses no button on a tap, this path's Save
        _alOpener = asker && asker !== document.body ? /** @type {HTMLElement} */ (asker) : pendingSave ? saveBtn : document.getElementById(resume ? 'sickSaveBtn' : 'alSaveBtn');
        alConfirmBar.classList.add('visible');
        alConfirmSaveBtn.focus();
    }
    /** Hides the AL over-entitlement confirmation bar and clears pending save state — or, given a card,
     *  only when the question showing is that card's (`_alOwner`). @param {'week'|'al'|'sick'|'saved'} [onlyFor] */
    function hideALConfirm(onlyFor) {
        if (onlyFor && _alOwner && onlyFor !== _alOwner) return;
        _alOwner = null;
        alConfirmBar.classList.remove('visible');
        _alPendingSave   = null;
        _alPendingDelete = [];
        _alResume        = null;
        _alPendingSkipped = [];
        _alPendingKept    = [];
        // Disarm the button too: hit-testable through the 0.25s slide-out, a tap would fall through to
        // the AL-booking branch unchecked. showALConfirm re-arms it.
        alConfirmSaveBtn.disabled = true;
    }

    alConfirmSaveBtn.addEventListener('click', async () => {
        // Disabled at once, for the same slide-out: a double-tap would fall into the unchecked AL branch.
        if (alConfirmSaveBtn.disabled) return;
        // ONE WRITE AT A TIME, this button too: a booking still sending holds the lock.
        if (_alPendingSave && isSaveInFlight()) return showError('Another change is still saving — try again when it has finished.');
        alConfirmSaveBtn.disabled = true;
        if (_alPendingSave) {
            // Week editor path — toSave is an array of override entries
            const toSave   = _alPendingSave;
            const toDelete = _alPendingDelete;
            const skipped  = _alPendingSkipped;
            const kept     = _alPendingKept;
            hideALConfirm();
            await executeSave(toSave, toDelete, skipped, kept);
        } else {
            // A range card — delegate to the card that asked (admin-al.js or admin-sick.js), which owns its button and flag
            const resume = _alResume;
            hideALConfirm();
            (resume ?? triggerConfirmedALSave)();
        }
    });

    alConfirmCancelBtn.addEventListener('click', () => {
        hideALConfirm();
        saveBtn.textContent = 'Save changes';
        updateSaveBtn();   // staged rows govern Save: the bar is the AL card's too
        // …and focus back to the Save that asked, not a hidden button.
        if (_alOpener?.isConnected && !(/** @type {any} */ (_alOpener)).disabled) _alOpener.focus();
    });

    // ============================================
    // ANNUAL LEAVE BOOKING  (logic in admin-al.js)
    // ============================================
    // The TWO dropdowns open the app's own sheet. `alMember` and `sickMember` must never join: they
    // are `hidden` value holders — the member is chosen ONCE, in the top bar — and enhancing them made a
    // second picker that moved what the SAVE reads under another person's name. select-sheet-parity
    // refuses a hidden id here.
    initSelectSheets([
        { id: 'fieldMember',          title: 'Which member are you working on?', searchLabel: 'Search staff' },
        { id: 'overridesMonthFilter', title: 'Show which month?' },
    ], { createLightbox });

    _refreshAlPreview = initALSection({
        alMember,
        syncMemberDisplay,
        populateMemberDropdown, lastMember,
        updateALBanner, updateALBookedBox, updateSickBookedBox,
        // ONLY the AL picker feeds this: the Absence card has no per-year figure (admin-sick.js).
        setALPickerYear: (/** @type {number} */ y) => { alPickerViewYear = y; },
        getCurrentUser: () => currentUser, showALConfirm, hideALConfirm: () => hideALConfirm('al'), showInChangeAShift,
        showSuccess,
    })?.updateAlPreview ?? null;

    // ============================================
    // SICK DAYS RECORDING  (logic in admin-sick.js)
    // ============================================
    _refreshSickPreview = initSickSection({
        sickMember,
        syncSickMemberDisplay, populateMemberDropdown, lastMember,
        updateALBanner, updateALBookedBox, updateSickBookedBox, getCurrentUser: () => currentUser, showInChangeAShift,
        showSuccess,   // an absence can take back a day in lieu (admin-sick.js): the bar, as the Absence card's
        showALConfirm: (/** @type {string} */ m, /** @type {string} */ sub, /** @type {any} */ p, /** @type {any[]} */ d, /** @type {any} */ r) => showALConfirm(m, sub, p, d, r, 'sick'),
        hideALConfirm: () => hideALConfirm('sick'),
    })?.updateSickPreview ?? null;


    /**
     * Deletes all overrides of the given type for a member within a date range.
     * Used by the period-row delete buttons in the AL and sick booked boxes.
     * @param {string}      type       'annual_leave' | 'sick'
     * @param {string}      memberName
     * @param {string}      start      YYYY-MM-DD — inclusive
     * @param {string}      end        YYYY-MM-DD — inclusive
     * @param {HTMLElement} feedbackEl Feedback div to write success/error into
     * @param {HTMLButtonElement} btn  The delete button (disabled during the request)
     * @param {number} [listedCount]  How many days the row showed — what the confirmation reports
     */
    async function deletePeriodOverrides(type, memberName, start, end, feedbackEl, btn, listedCount) {
        // WHICH RECORDS GO, AND WHAT THE LINE SAYS: `periodDelete` (admin-booked-periods.js) — scoped so a Sunday RD
        // correction another range still needs is kept (edge Sunday, A1), a stored Christmas day stays the Christmas
        // row's, and the line counts the DAYS the row listed (not documents), naming any uncounted ones it takes too.
        const allForDelete = getAllOverrides();
        const memberObj = teamMembers.find(m => m.name === memberName);
        const { ids: deleteIds, said } = periodDelete({ overrides: allForDelete, type, memberName, start, end,
            isRestGap: d => isRestGap(d, memberObj), listedCount });
        // THE BUTTON'S IDLE STATE IS admin-booked-periods.js's, restored when this promise settles.
        if (!deleteIds.length) return;
        const idSet = new Set(deleteIds);
        // Wait for the session, as executeSave() does: auth.currentUser is briefly null while a returning
        // session restores, and a delete then would report a false "Delete failed".
        await sessionReady;
        if (!auth.currentUser) {
            if (feedbackEl) {
                holdFeedback(feedbackEl);
                setStatus(feedbackEl, "⚠ You've been signed out — please sign in again.");
                feedbackEl.className = 'feedback error';
            }
            feedbackEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            return;
        }
        btn.disabled    = true;
        btn.textContent = '…';
        try {
            // The rows this card LISTED are compared with the server and deleted in ONE transaction.
            await withSlowSaveNotice(writeWithClaimRetry(() => deleteIfUnchanged(allForDelete.filter(o => idSet.has(o.id)))), { held: false });
            removeFromCache(idSet);   // drops the deleted rows; does NOT widen coverage
            renderTable();
            updateALBanner();
            updateALBookedBox();
            updateSickBookedBox();
            _refreshAlPreview?.(); _refreshSickPreview?.();   // a range already picked was drawn over the deleted days (admin-2-2)
            // The week follows the delete (admin-own-write.js): a change staged on a deleted day is cleared, named below.
            const cleared = syncWeekAfterOwnWrite(allForDelete.filter(o => idSet.has(o.id)));
            if (feedbackEl) {
                setStatus(feedbackEl, withClearedDays(said, cleared));
                feedbackEl.className = 'feedback success';
                if (!cleared.length) fadeFeedback(feedbackEl, 'feedback', 6000);   // the line's ONE fade, which a later message cancels (admin-2-7)
            }
            // The inline line can be a screen above the deleted row, so the same toast Save gets.
            showToast(said);
        } catch (err) {
            console.error('[Admin] Period delete failed:', err);
            if (feedbackEl) {
                // Never blamed on the connection when it was a refusal (admin-2-10): `saveFailureMessage` words each cause.
                const msg = (/** @type {any} */ (err)).code === DELETE_REFUSED ? '⚠ ' + /** @type {any} */ (err).line
                    : (/** @type {any} */ (err)).code === 'unavailable'
                    ? '⚠ You appear to be offline — reconnect and try again.'
                    : unconfirmedWriteLine(err, 'this delete', 'Saved Changes')
                        ? '⚠ ' + unconfirmedWriteLine(err, 'this delete', 'Saved Changes')
                        : '⚠ ' + saveFailureMessage(err);
                holdFeedback(feedbackEl);   // an earlier delete's fade must not take this error down (admin-2-7)
                feedbackEl.textContent = msg;
                feedbackEl.className = 'feedback error';
                // An error has to be READ, so it stays inline rather than in a 4s toast — and is
                // brought into view, because the control that failed can be a screen below it.
                feedbackEl.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            }
        } finally {
            btn.disabled = false;
        }
    }

    // THE RECORDED-DATES LIST is admin-booked-periods.js (its date helpers admin-period-dates.js);
    // every handle it needs is passed in here, and nothing about the list is decided in this file.
    const _bookedPeriods = createBookedPeriods({
        doc: document,
        // THE WINNER MAP, not a filter over every historical document — resolve which doc
        // owns the date first, then ask what it is. Why it matters: al-entitlement.js.
        getEntries: (memberName, type) => winningEntriesOfType(getAllOverrides(), memberName, type),
        hasAuthority: hasOverrideAuthorityFor,
        memberFor:    name => teamMembers.find(m => m.name === name),
        isSunday,
        mergePeriods: mergeBookedPeriods,
        isRestGap,
        addDays,
        monthAbb:     MONTH_ABB,
        // Built once per render and handed to `cfg.consumes`. `consumesEntitlement` reads
        // `replacedType` off it, which is the only surviving record of what an AL doc replaced —
        // without it a swapped-in working day reads as a rest day and drops out of the list.
        memberDateMap: buildMemberDateMap,
        fmtDate:      fmtPeriodDate,
        fmtRange:     fmtPeriodRange,
        onDelete:     deletePeriodOverrides,
        onRendered:   boxId => _landing.settle(boxId),
    });

    // The Calendar's leave panel links here for one year (`?alYear=2027#alBookedBox`).
    const _linkedAlYear = new URLSearchParams(location.search).get('alYear');
    if (_linkedAlYear && /^\d{4}$/.test(_linkedAlYear)) _bookedPeriods.pin('alBookedBox', _linkedAlYear);

    /** @param {Parameters<ReturnType<typeof createBookedPeriods>['render']>[0]} cfg */
    function _renderBookedPeriods(cfg) { _bookedPeriods.render(cfg); }

    /**
     * Refreshes the collapsible list of recorded sick days for the selected member.
     * Shows sick periods grouped by month, merging consecutive dates that are
     * bridged by rest days on the base roster (same logic as AL booked box).
     */
    function updateSickBookedBox() {
        _renderBookedPeriods({
            type:       'sick',
            memberName: sickMember.value,
            boxId:      'sickBookedBox',
            bodyId:     'sickBookedBody',
            countFn:    n => `${n} day${n !== 1 ? 's' : ''}`,
            countClass: 'sick-period-count',
            feedbackId: 'sickFeedback',
        });
    }

    initCardCollapse('sickBookedToggle', 'sickBookedBody', 'sickBookedChevron');

    // ============================================
    // INIT — runs last so all dropdowns are populated
    // ============================================

    function applyPermissions() {
        if (currentIsAdmin || currentIsManager) return; // full access — nothing to restrict

        // Non-admin: lock every member selector to their own name, and flag <body> so the sticky
        // member bar (admin.css) stands down for a name that cannot change.
        document.body.classList.add('member-locked');
        const _memberSelectable = _setSelectValue(fieldMember, currentUser);
        if (!_memberSelectable) {
            // Not selectable — a leaver whose session is still valid. The disabled selects would stay on
            // the FIRST member, so every booking would target the WRONG person: clear them, so every
            // write path's `if (!member) return` blocks, and say why.
            fieldMember.selectedIndex = -1;
            alMember.selectedIndex = -1;
            sickMember.selectedIndex = -1;
            fieldMember.disabled = alMember.disabled = sickMember.disabled = true;
            // The week grid says it too, in the same words (`renderWeekGrid`), where it said "Select a date above".
            document.querySelectorAll('#alToggleHeader .hint, #sickToggleHeader .hint, #overridesToggleHeader .hint')
                .forEach(el => { el.textContent = NOT_ON_ROSTER_LINE; });
            console.warn(`[Admin] Signed-in member "${currentUser}" is not a selectable roster member (hidden/leaver) — booking selectors blocked.`);
            return;
        }
        fieldMember.disabled  = true;
        syncMemberDisplay();
        _setSelectValue(alMember, currentUser);
        alMember.disabled     = true;
        _setSelectValue(sickMember, currentUser);
        sickMember.disabled   = true;
        // And the absence card's member row: with the select disabled no change event re-syncs it.
        syncSickMemberDisplay();
        lsSet(SELECTED_MEMBER, currentUser);

        // Reword card hints to use first-person language for self-service users
        const sickHint = document.querySelector('#sickToggleHeader .hint');
        const savedHint = document.querySelector('#overridesToggleHeader .hint');
        // NO AL hint here: admin.html's own is audience-neutral. One sentence, one home (al-copy-parity).
        if (sickHint)  sickHint.textContent = 'Record your own absence days — for any reason';
        if (savedHint) savedHint.textContent = 'Your saved changes — ✎ to edit, ✕ to delete';

        // Nothing auto-opens: every card ships collapsed for everyone. An auto-open must never be a
        // SECOND writer of a collapse state. DECISIONS.md → "Admin task navigator".
    }

    // ============================================
    // ANNUAL LEAVE — booked dates collapsible box
    // ============================================
    function updateALBookedBox() {
        const alFrom = /** @type {HTMLInputElement|null} */ (document.getElementById('alFrom'));
        _renderBookedPeriods({
            type:       'annual_leave',
            memberName: alMember.value,
            boxId:      'alBookedBox',
            bodyId:     'alBookedBody',
            // THE SAME RULE THE BANNER USES — the function itself, so the two cannot disagree about a day.
            consumes:   consumesEntitlement,
            // …but a Spare day past its week's four is LISTED, since the member is off (21 Nov 2026).
            listed:     costsWithoutSpareCap,
            // CHRISTMAS LEAVE — on record here, never counted (christmas-leave.js); and for any later year shown.
            christmas:  christmasLeaveByYear({ member: teamMembers.find(m => m.name === alMember.value),
                                               overrides: getAllOverrides(), thisYear: new Date().getFullYear() }),
            christmasFor: year => christmasLeaveDates({ member: teamMembers.find(m => m.name === alMember.value), year, overrides: getAllOverrides() }),
            // "3 days", not "3 days AL": the title says so, and it keeps the row on ONE line at 375px.
            countFn:    n => `${n} day${n !== 1 ? 's' : ''}`,
            countClass: 'al-period-count',
            feedbackId: 'alFeedback',
            // THE SAME YEAR THE BANNER IS TALKING ABOUT (admin-al-year.js); a tapped chip outranks it.
            preferredYear: alFigureYear({ pickedFrom: alFrom?.value, pickerViewYear: alPickerViewYear,
                                          shiftDate: fieldDate.value, today: new Date() }),
        });
    }

    initCardCollapse('alBookedToggle',      'alBookedBody',   'alBookedChevron');

    // ============================================
    // CARD COLLAPSE — AL, Sick, Overrides
    // ============================================
    initCardCollapse('alToggleHeader',          'alBody',            'alChevron');
    initCardCollapse('sickToggleHeader',        'sickBody',          'sickChevron');
    initCardCollapse('overridesToggleHeader',   'overridesBody',     'overridesChevron');


    // Admin does not print: printing shows a "use the Calendar" notice (admin.css @media print).

    // Page access (auth-policy.js): "any named user" — the admin/manager split gates ACTIONS
    // (applyPermissions), not the page, so there is no 'forbidden' path. 'login' iff no local session.
    const _access = requirePage({ status: isAuthenticated ? 'named' : 'signedOut', member: currentUser }, 'admin');
    if (_access.decision === 'login') {
        // Not signed in → show login overlay; do not load any Firestore data. On a confirmed sign-in,
        // showAdminLogin's onSuccess reloads (flag off) or runs initAuthorised() in place (flag on).
        showAdminLogin();
    } else {
        // _access.decision === 'allow' (a named user; Admin requires no role).
        initAuthorised();
    }

    /**
     * Authorised (signed-in) init body — AUTH_ARCHITECTURE.md Phase 9. Runs exactly once per page life:
     * directly on a normal already-signed-in load, or from showAdminLogin's onSuccess on the in-place path.
     */
    function initAuthorised() {
        // Refresh identity — on the in-place path the module loaded signed-out, so re-read the just-saved
        // session (saveSession ran before onSuccess). No-op re-read on a normal signed-in load.
        currentSession = getSession();
        currentUser     = currentSession?.name ?? null;
        currentIsAdmin   = CONFIG.ADMIN_NAMES.includes(currentUser);
        currentIsManager = (CONFIG.MANAGER_NAMES || []).includes(currentUser);
        isAuthenticated = !!currentSession;
        // In-place: remove the still-mounted overlay to reveal the page. No-op on a normal load.
        dismissLoginOverlay();
        // A returning member never passes the sign-in, so re-establish the Firebase session here —
        // without it every Firestore write fails. resolveSession() fulfils the sessionReady the
        // feature modules await.
        const _adminAuth = ensureNamedSession(currentUser);
        resolveSession(_adminAuth);
        // A session that cannot be confirmed as this member's OWN — now, or LATER (claim-retry.js) — is
        // cleared and shown Admin's sign-in, which RELOADS on success: sessionReady is one-shot.
        guardNamedSession({ page: 'admin', pageLabel: 'Admin', member: currentUser, established: _adminAuth,
            signIn: () => showAdminLogin({ reloadOnSuccess: true }) });
        // All dropdowns are now populated — apply permissions then load data
        document.body.classList.add('auth-ready');
        // The page's content is on screen from this line (`.container` is hidden until `auth-ready`).
        markPageReady();
        applyPermissions();
        // SYNC THE BOOKING SELECTS FROM THE MEMBER FIELD: a RESTORED member never fires the change
        // handler, and both cards would say "Select a staff member above" over a page that has one.
        // AFTER applyPermissions, which sets `alMember.disabled` — or the LEAVER branch, which clears
        // the selects, would show a colleague's name under "no longer on the roster".
        if (fieldMember.value && !alMember.disabled) {
            _setSelectValue(alMember, fieldMember.value);
            _setSelectValue(sickMember, fieldMember.value);
            syncMemberDisplay();
            syncSickMemberDisplay();
            // AND REPAINT THE PREVIEWS, which rendered once at init, before this.
            _refreshAlPreview?.();
            _refreshSickPreview?.();
        }
        // Bulk-bar pills from PILL_TYPES, minus 'other' — deliberately: its flavour is per-row, and a
        // bulk Other ALWAYS failed at save. A bulk flavour sub-selector, never the bare pill, if needed.
        const _bulkPillsContainer = document.getElementById('bulkTypePills');
        if (_bulkPillsContainer) {
            _bulkPillsContainer.innerHTML = PILL_TYPES.filter(t => t !== 'other').map(t => typePillHtml(t)).join('');
        }
        // UNSAVED WEEK EDITS OUTLIVE THE PAGE (iPhone audit, Nov 2026): iOS discards a hidden page and a swipe back asks
        // nothing, so the staged rows are kept whenever the page is hidden and offered on the next load (unsaved-draft.js).
        const _draft = createDraftSlot({ page: 'admin', by: currentUser ?? '', usable: (d) => Array.isArray(d.rows) && d.rows.length > 0 });
        initOverrides({
            currentUser,
            currentIsAdmin,
            currentIsManager,
            showSuccess,
            showError,
            onAfterSave: () => {   // does NOT touch userMadeChanges: loads call this too (review A4)
                updateALBanner();
                updateALBookedBox();
                updateSickBookedBox();
                // …and a range already picked, drawn while this member's records were still loading
                // — it asked about rest days its records answer (whole-app review, Oct 2026).
                _refreshAlPreview?.(); _refreshSickPreview?.();
                if (!hasUnsavedChanges()) _draft.forget();   // saved: the kept copy is not work any more
            },
            markChanged,
            onEditRow: handleEdit,
            // a Saved Changes delete that lowers an allowance asks first (admin-saved-changes.js)
            showALConfirm: (/** @type {string} */ m, /** @type {string} */ sub, /** @type {any} */ p, /** @type {any[]} */ d, /** @type {any} */ r) => showALConfirm(m, sub, p, d, r, 'saved'),
        });
        // Each kept row carries the whole record its row was DRAWN from (readWeekDraft), checked on Restore.
        keepDraftWhenHidden(hasUnsavedChanges, {
            keep: () => _draft.keep({ member: fieldMember.value, date: fieldDate.value }, keptWeekDraft(readWeekDraft(weekGrid), sendingDays(), fieldMember.value)),
            forget: () => _draft.forget(),
        });
        /** Offered once the member it is for has loaded, to somebody who may still edit them; Restore shows that member
         *  and week and puts back each row whose saved record has not changed since. */
        const _offerDraft = async () => {
            const d = _draft.peek(), member = String(d?.scope.member ?? ''), date = String(d?.scope.date ?? '');
            if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ![...fieldMember.options].some(o => o.value === member)
                || !(currentIsAdmin || currentIsManager || member === currentUser)) return;
            await ensureMemberLoaded(member).catch((e) => console.warn('[Admin] Draft offer: the member did not load:', e));
            if (!hasOverrideAuthorityFor(member)) return;   // kept, for a load that can read what it was edited over
            const onDay = buildMemberDateMap(member);   // a row whose save has since LANDED is not offered back (rule 6)
            await _draft.offer({ ask: confirmDialog, unsaved: (kept) => unsavedWeekDraft(kept.data, (d) => onDay.get(d), (id) => getAllOverrides().some(o => o.id === id)), apply: async (kept) => {
                showInChangeAShift(member, date);
                await ensureMemberLoaded(member).catch((e) => console.warn('[Admin] Draft restore: the member did not load:', e));
                // ONLY ON ITS OWN MEMBER AND WEEK (whole-app check, Nov 2026). With changes staged here the jump stops at
                // "Discard or keep editing?", and the rows went onto the member on screen. Not put back: the slot keeps it.
                if (fieldMember.value !== member || fieldDate.value !== date) {
                    showError(hasUnsavedChanges()
                        ? 'Your unsaved changes weren’t put back, because this week has changes of its own. Save or discard them, and yours will be offered again the next time you open Admin.'
                        : 'Your unsaved changes weren’t put back, because a different member or week is on screen. They’ll be offered again the next time you open Admin.');
                    return false;
                }
                const heldNow = buildMemberDateMap(member);   // read after the load above: what each day holds NOW
                const { put, left } = applyWeekDraft(weekGrid, kept.data.rows, (d) => heldNow.get(d));
                if (put) markChanged();
                updateSaveBtn();
                (put ? showSuccess : showError)(weekRestoredLine(put, left.map(formatDisplay)));
            } });
        };
        // Loads the SELECTED MEMBER only (admin-override-coverage.js). Drawn FIRST, so the week says
        // "Loading…" while it reads.
        renderWeekGrid();
        loadOverrides().then(_offerDraft).catch((err) => console.error('[Admin] The unsaved-changes offer failed:', err));
        // AN INSTALLED APP STAYS OPEN FOR DAYS (iPhone audit, Nov 2026), and this week was read once, its "Today" stamped
        // as it drew. Back after five minutes away, with nothing staged and nothing sending, it is read and drawn again.
        onReturnToPage(5 * 60_000, () => { if (!hasUnsavedChanges() && writesInFlight() === 0 && !isSaveInFlight()) loadOverrides(); });

        // WHERE A HASH LANDS is `admin-deep-link.js`'s decision — which folds to open (a nested
        // target needs its card AND its own), and what to scroll to. This opens and scrolls, and
        // owns neither rule; `openCollapsibleCard` stays here because it is what keeps
        // `aria-expanded` in step, and a second opener would be a second place to forget that.
        const _deepLink = resolveDeepLink(location.hash, document);
        if (_deepLink) {
            for (const f of _deepLink.folds) openCollapsibleCard(f.body, f.chevron);
            _landing.arrive(_deepLink);
        }
        // Forced password migration — fire-and-forget, NOT on the sign-in's critical path (showAdminLogin).
        initPasswordForce(currentUser, { ready: sessionReady });
        // Nav panel — deferred here on the in-place login path so it renders with the signed-in identity
        // (deduped by initNavPanel's navPanelInit guard if already wired on a normal load).
        wireNavPanel();
    }

    // ============================================
    // If the admin has unsaved changes, wait until they navigate away before reloading.
    registerServiceWorker({
        // A write still waiting on the server counts as unsaved (a range commits in chunks); both are
        // re-asked at the moment of reloading.
        beforeReload: () => reloadWhenNotBusy(() => hasUnsavedChanges() || writesInFlight() > 0),
        isBusy: () => hasUnsavedChanges() || writesInFlight() > 0,   // a notification tap asks too
    });
    sessionReady.then(() => { initErrorReporter(); recordUsage('admin', currentUser); recordPageLatency('admin', currentUser); });

    // ── Navigation panel ─────────────────────────────────────────────────────────
    function wireNavPanel() {
        initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: sessionReady,
            currentPage: 'admin',
            memberName:  currentUser,
            isAdmin:         currentIsAdmin,
            isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(currentUser),
            canOpenOvertime: canOpenOvertime(currentUser), canOpenNewlink: canOpenNewlink(currentUser),
            onLogoClick: () => openAboutLightbox?.(),
            // Unsaved week-grid edits are asked about BEFORE anything is released (page-session.js).
            beforeSignOut: askBeforeSignOut(hasUnsavedChanges),
            onSignOut:   () => signOutAndLeave(),
        });
        // Calendar pill: the week's date in the link, so the Calendar opens on the month being edited.
        // Wired HERE, guarded per element: a teardown re-injects a FRESH pill, which a module-scope
        // listener would miss, and the dataset guard prevents a double attach on a repeat call.
        const calPill = /** @type {HTMLElement|null} */ (document.querySelector('.nav-panel-pill--calendar'));
        if (calPill && !calPill.dataset.monthPersistWired) {
            calPill.dataset.monthPersistWired = '1';
            calPill.addEventListener('click', () => {
                if (fieldDate.value) calPill.setAttribute('href', `./?date=${fieldDate.value}`);
                // Let the <a> navigate normally
            });
        }
    }
    // Wire the nav now EXCEPT on the login path, where initAuthorised() defers it so it renders with the
    // signed-in identity (the full-screen overlay covers the burger meanwhile).
    if (_access.decision !== 'login') wireNavPanel();

}
