// @ts-check
/**
 * admin-app.js — Coordinator and primary feature file for admin.html.
 *
 * Owns: login/session, AL booking, absence recording, Team Week View,
 *   page coordinator wiring (initialises modules on load).
 * Does NOT own: override entry/week-grid/bulk-bar (admin-overrides.js),
 *   roster PDF upload/review (admin-roster-upload.js), huddle upload/notifications
 *   (huddle.js), staff Firebase Auth setup (admin-auth.js),
 *   Notifications card (settings-app.js),
 *   pay maths (paycalc-calc.js), calendar display (calendar-app.js), roster data (roster-data.js).
 * Edit here for: login, AL/absence forms, Team Week View.
 * Do not edit here for: shift override grid or forms, roster PDF pipeline,
 *   notifications, pay calculator, roster data structure, shared CSS.
 */

import { CONFIG, teamMembers, DAY_NAMES, MONTH_ABB, getALEntitlement, getBaseShift, escapeHtml, formatISO, isSunday, SWIPE_THRESHOLD, SWIPE_VELOCITY, TIME_RE, projectAnnualLeaveOverage } from './roster-data.js';
import { db, auth, doc, writeBatch, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { ensureNamedSession, getSession, clearSession, sessionReady, resolveSession } from './session.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { TYPES, PILL_TYPES, getAllOverrides, setAllOverrides, initOverrides, loadOverrides, renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, renderTable, executeSave, validateShiftRules, formatDisplay, resetBulkPills, updateSaveBtn, resetTableMemberFilter, _hasStagedEdits } from './admin-overrides.js';
import { initALSection, triggerConfirmedALSave } from './admin-al.js';
import { initSickSection } from './admin-sick.js';

import { lsGet, lsSet, lsDel } from './ls.js';
import { SELECTED_MEMBER, SELECTED_MEMBER_LEGACY, VIEWED_MONTH, VIEWED_YEAR } from './storage-keys.js';
import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { initCardCollapse } from './overlay.js';
import { initEmailCheck } from './admin-email-check.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { isRestShift, computePeriodDeleteIds, mergeBookedPeriods } from './override-utils.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';

// Allow ?logout in the URL to force-clear session (useful when the sign-out
// button is unreachable due to a broken or skipped login state).
if (new URLSearchParams(location.search).has('logout')) {
    clearSession();
    history.replaceState(null, '', location.pathname); // remove ?logout from URL
}

// ---- Check session immediately ----
// `let` (not const): on the in-place sign-in path (CONFIG.INPLACE_LOGIN.admin, ARCHITECTURE_PLAN.md Phase 9)
// these are refreshed inside initAuthorised() from the just-saved session — the module loaded while
// signed out, so the load-time values are null. With the flag off they are assigned once and never
// change, identical to before. (The AL/sick sections read currentUser via a live getter so a later
// in-place save still stamps the correct `changedBy`.)
let currentSession = getSession();
let isAuthenticated = !!currentSession;
let currentUser     = currentSession?.name ?? null;
let currentIsAdmin   = CONFIG.ADMIN_NAMES.includes(currentUser);
let currentIsManager = (CONFIG.MANAGER_NAMES || []).includes(currentUser);

// ---- Login overlay (shared in-place sign-in; see login-overlay.js) ----
/** Show the shared sign-in overlay configured for Admin. On a confirmed sign-in, reload straight
 *  into the app.
 *  The work-email check is DELIBERATELY NOT awaited here (v14.74). It used to run inline on the
 *  login overlay before the reload (v13.68), but it awaits a Firestore read (getStaffContact), and
 *  the FIRST read after a fresh sign-in can take several seconds (connection + auth-token handshake
 *  warming up) — which froze the user on the login overlay (the v14.72–73 login-freeze reports).
 *  Instead, onSuccess sets a one-shot "pending" marker and reloads; the check then runs on the next
 *  page load via initEmailCheck() (async/non-blocking), gated so it appears ONLY after a real login
 *  and at most once every ~3 months (Fix 4 + cadence, v14.77; see _emailCheckDue / _runEmailCheck). */
function showAdminLogin({ reloadOnSuccess = false } = {}) {
    initLoginOverlay({
        pageLabel: 'Admin',
        onSuccess: (/** @type {string} */ name) => {
            // Mark a real login so the work-email check can fire (consumed by _runEmailCheck on the
            // next pass / in initAuthorised). Set on BOTH paths so the email-check behaviour is
            // identical whether we reload or initialise in place.
            lsSet(`myb_email_check_pending_${name}`, '1');
            // reloadOnSuccess is set on the B1 stale-session path (see the _adminAuth.then block in
            // initAuthorised): initAuthorised() ALREADY ran optimistically there and resolved the
            // one-shot sessionReady, which cannot be re-resolved — so re-initialising in place would
            // leave feature modules (admin-overrides, huddle, admin-auth) gated on a stale/failed auth
            // barrier. Reload for a fresh page life + fresh sessionReady, mirroring operations/settings/
            // links' B1 handling. The normal not-signed-in path (initAuthorised never ran, sessionReady
            // still pending) initialises in place as before, falling back to a reload if init throws.
            if (reloadOnSuccess || !CONFIG.INPLACE_LOGIN.admin) {
                window.location.reload();
            } else {
                try { initAuthorised(); } catch { window.location.reload(); }
            }
        },
    });
}

// ---- Lightbox ----
// Exposed to module scope so the nav-panel drawer logo can open it (the header
// logo is a back button — see headerIcon handler below). Lifecycle, SW update
// status, bug link, and print button are the shared about-lightbox.js.
/** @type {any} */
let openAboutLightbox = null;
(function() {
    const about = initAboutLightbox({
        appLabel: 'Marylebone Roster — Admin',
        bugLinkId: 'adminBugReportLink',
        getUserName: () => currentUser || 'Unknown',
    });
    if (about) openAboutLightbox = about.open;

    // Header logo is a back-to-calendar button (About moved to the drawer logo).
    const headerIcon = document.getElementById('appIcon');
    if (!headerIcon) return;
    headerIcon.title = 'Back to calendar';
    headerIcon.setAttribute('aria-label', 'Back to calendar');
    headerIcon.addEventListener('click', () => { window.location.href = './'; });
})();

// ---- Per-card tips lightbox ----
// Each card has a small ? button. Tapping it opens a focused lightbox
// with only the tips relevant to that card. Content lives here as data
// so the HTML stays clean; lifecycle, renderer (incl. the adminOnly /
// staffOnly filtering), and button wiring live in tips-lightbox.js.
(function() {
    /** Tips content keyed by data-card attribute on each .btn-card-tips button. */
    const CARD_TIPS = {
        'change-shift': {
            title: 'Change a Shift',
            sections: [
                { heading: 'One shift', items: [
                    { icon: '1️⃣', html: 'Select a <strong>staff member</strong> and <strong>week</strong> at the top', adminOnly: true },
                    { icon: '1️⃣', html: 'Select the <strong>week</strong> at the top using the arrows or date picker', staffOnly: true },
                    { icon: '2️⃣', html: 'Tap a type on any day — it turns amber. Tap <strong>Save changes</strong> when done' },
                    { icon: '👆', html: 'Swipe left or right to move between weeks' },
                ]},
                { heading: 'Multiple shifts', items: [
                    { icon: '1️⃣', html: 'Tap <strong>Mon–Fri</strong>, <strong>Working days</strong> or <strong>All 7</strong> — or tick individual days' },
                    { icon: '2️⃣', html: 'Pick a type — add a start and end time if needed' },
                    { icon: '3️⃣', html: 'Tap <strong>3. Apply to ticked days</strong>' },
                ]},
                { heading: 'Type meanings', items: [
                    { icon: '📋', html: '<strong>Spare</strong> — on standby; actual shift not yet known' },
                    { icon: '📅', html: '<strong>Shift</strong> — a confirmed working shift; use for spare-week confirmations, changed shift times, and swaps with colleagues' },
                    { icon: '💼', html: '<strong>RDW</strong> — rest day worked; use when someone works a full shift on their rest day' },
                    { icon: '✏️', html: '<strong>Rest Day</strong> — corrects a working day back to a rest day' },
                    { icon: '🏷️', html: '<strong>Other</strong> — a training, induction or assessment day. Pick the type, tick "Rest day (RDW)" if it\'s on a rest day, and add times if you know them — blank times pay the default (the base shift, or 8 hours RDW)' },
                ]},
            ],
        },
        'annual-leave': {
            title: 'Annual leave',
            sections: [
                { items: [
                    { icon: '🏖️', html: 'Select a <strong>staff member</strong> and date range — rest days and Sundays are skipped automatically', adminOnly: true },
                    { icon: '🏖️', html: 'Select a date range — rest days and Sundays are skipped automatically', staffOnly: true },
                    { icon: '⚠️', html: 'A warning appears if leave would exceed the annual limit — you can still save' },
                ]},
            ],
        },
        'sick-days': {
            title: 'Record Absence',
            sections: [
                { heading: 'What to use it for', items: [
                    { icon: '🤧', html: '<strong>Illness or time off</strong> — any number of days' },
                    { icon: '👨‍👩‍👧', html: '<strong>Family or domestic emergency</strong> — e.g. child ill, caring for a relative' },
                    { icon: '🪑', html: 'You don\'t need to say why — only the dates are saved, not the reason' },
                ]},
                { heading: 'Good to know', items: [
                    { icon: '📅', html: 'Rest days and Sundays in the range are ignored automatically — you only need to pick the start and end date' },
                    { icon: '👁️', html: 'Absence days are visible to all staff in the calendar' },
                ]},
            ],
        },
        'daily-huddle': {
            title: 'Daily Huddle',
            sections: [
                { items: [
                    { icon: '📋', html: 'Upload the day\'s Huddle briefing — staff open it via ☰ → <strong>Daily Huddle</strong> on the main app' },
                    { icon: '📄', html: '<strong>PDF</strong> — opens in the browser. <strong>Word (.docx)</strong> — displayed inside the app' },
                    { icon: '🔄', html: 'Uploading a new file for the same date overwrites the previous one' },
                    { icon: '🤖', html: 'The Huddle email uploads automatically each day — use this card if you need to upload it manually' },
                ]},
            ],
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
            sections: [
                { items: [
                    { icon: '🔐', html: 'Creates a secure login for every active staff member so the app knows who is saving changes' },
                    { icon: '✅', html: 'Safe to run any time — people who already have an account are skipped, so it won\'t break anything' },
                    { icon: '👤', html: 'Run this whenever someone <strong>joins</strong> the roster to give them access' },
                    { icon: '🚪', html: 'Tick <strong>"Disable accounts for leavers"</strong> and run it when someone <strong>leaves</strong> — their account is disabled so they can no longer sign in' },
                ]},
            ],
        },
        'notifications': {
            title: 'Notifications',
            sections: [
                { heading: 'What you\'ll get', items: [
                    { icon: '📋', html: '<strong>Daily Huddle</strong> — an alert when today\'s Huddle briefing has been uploaded, so you don\'t have to keep checking' },
                    { icon: '💷', html: '<strong>Pay reminder</strong> — an alert on the cutoff Saturday, reminding you that payday is 6 days away' },
                ]},
                { heading: 'How it works', items: [
                    { icon: '📲', html: 'Tap <strong>Enable notifications</strong> and allow when your phone asks — that\'s it. You can disable them here at any time' },
                    { icon: '🔕', html: 'Tap <strong>Disable notifications</strong> to stop them. Your browser settings are not changed — you can re-enable here whenever you like' },
                ]},
                { heading: 'iPhone users', items: [
                    { icon: '🍎', html: 'Notifications only work on iPhone if the app has been <strong>added to your Home Screen</strong> (tap Share → Add to Home Screen in Safari) and you open it from there. They do not work in the regular Safari browser tab' },
                ]},
            ],
        },
        'saved-changes': {
            title: 'Saved Changes',
            sections: [
                { heading: 'Viewing', items: [
                    { icon: '🔍', html: 'Use the <strong>member dropdown</strong> to see one person\'s changes, or leave it on All to see everyone\'s', adminOnly: true },
                    { icon: '🔍', html: 'This list shows your own saved changes only', staffOnly: true },
                    { icon: '📅', html: 'Use the <strong>month filter</strong> to narrow down to a specific month — defaults to the current month' },
                ]},
                { heading: 'Editing and deleting', items: [
                    { icon: '✏️', html: 'Tap <strong>Edit</strong> on any change to adjust the shift type or time, then tap <strong>Save changes</strong>' },
                    { icon: '🗑️', html: 'Tap <strong>Delete</strong> on any change to remove it — the day goes back to the original scheduled shift' },
                ]},
                { heading: 'Sources', adminOnly: true, items: [
                    { icon: '📋', html: '<strong>Roster upload</strong> entries came from a PDF upload — a new upload will replace them automatically without a warning' },
                    { icon: '✍️', html: 'All other entries were added manually — a new PDF upload will flag them if it disagrees, so you can choose which to keep' },
                ]},
            ],
        },
    };

    initTipsLightbox(CARD_TIPS, { getIsAdmin: () => currentIsAdmin });
})();

// ============================================
// ROSTER LOGIC
// ============================================

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

// On desktop, move the member-context-bar into col-side as the first card.
// This replaces the full-width navy banner with a compact white sidebar card.
// Mobile layout is unaffected — the bar stays in its original HTML position
// (before col-main) when the viewport is < 1024px.
// Uses a matchMedia listener so layout corrects on resize (not just at load).
(function syncMemberBarToSidebar() {
    const mq  = window.matchMedia('(min-width: 1024px)');
    const barEl = document.querySelector('.member-context-bar');
    if (!barEl) return;
    const bar = /** @type {Element} */ (barEl);
    const colMain = bar.parentElement;
    const colSide = document.querySelector('.col-side');
    if (!colMain || !colSide) return;

    /** @param {boolean} isDesktop */
    function apply(isDesktop) {
        if (isDesktop) {
            const _side = /** @type {Element} */ (colSide);
            _side.insertBefore(bar, _side.firstChild || null);
        } else {
            // colMain is .container; insert bar after the header, not before it
            const _main = /** @type {Element} */ (colMain);
            const appHeader = _main.querySelector('header.app-header');
            if (appHeader) {
                appHeader.after(bar);
            } else {
                _main.insertBefore(bar, _main.firstChild || null);
            }
        }
    }

    apply(mq.matches);
    mq.addEventListener('change', e => apply(e.matches));
})();

// ============================================
// POPULATE MEMBER DROPDOWNS
// ============================================
// Order the optgroups by an explicit grade order (matching login-overlay's GRADE_ORDER) rather than
// teamMembers insertion order — otherwise reordering a member row could silently break the documented
// CEA·CES·Dispatcher·Management grouping. Any role not listed falls to the end, order preserved. (v16.21)
const _GRADE_ORDER = ['CEA', 'CES', 'Dispatcher', 'Management'];
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

// iOS Safari silently fails when setting .value on a <select> with <optgroup>s.
// Iterate options and set .selected directly instead.
/**
 * @param {any} sel
 * @param {any} val
 */
function _setSelectValue(sel, val) {
    for (const o of sel.options) if (o.value === val) { o.selected = true; return true; }
    return false;   // no matching option — caller may need to handle (e.g. a hidden/leaver member)
}

// Restore last used member — prefer the shared cross-page key (written by both index and admin)
// so navigating between pages keeps the same person selected. Fall back to admin-only key.
// The member must still be SELECTABLE (exists AND not hidden): populateMemberDropdown omits
// hidden members, so a stale saved name pointing at a colleague who has since left or been
// hidden would set the <select> to a value with no matching <option> — leaving the STAFF
// MEMBER dropdown blank. Reject and clear stale names so the field falls back to a real
// member and the bad value can't recur. (v12.32)
const _savedMember = lsGet(SELECTED_MEMBER) || lsGet(SELECTED_MEMBER_LEGACY);
const lastMember = (_savedMember && teamMembers.find(m => m.name === _savedMember && !m.hidden))
    ? _savedMember : null;
if (lastMember) {
    _setSelectValue(fieldMember, lastMember);
    // Persist the member so the reverse journey (admin → index) restores it (v16.81: the
    // legacy 'adminLastMember' mirror is no longer written — only read as a one-release fallback).
    lsSet(SELECTED_MEMBER, lastMember);
} else if (_savedMember) {
    // Stale (hidden/left) — clear it so the dropdown keeps its valid default. Clear the legacy
    // mirror too, so a stale name can't ride back in via the read fallback above.
    lsDel(SELECTED_MEMBER);
    lsDel(SELECTED_MEMBER_LEGACY);
}

// Default date = today, or the date passed from index.html via ?date=YYYY-MM-DD.
// This preserves the month the staff member was viewing when they tapped Admin.
const _urlDate = new URLSearchParams(location.search).get('date');
fieldDate.value = (_urlDate && /^\d{4}-\d{2}-\d{2}$/.test(_urlDate)) ? _urlDate : formatISO(new Date());
(function updateWeekNavLabelFromDate() {
    const d    = new Date(fieldDate.value + 'T12:00:00');
    const sun  = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const sat  = new Date(sun); sat.setDate(sun.getDate() + 6);
    const weekNavLabel   = document.getElementById('weekNavLabel');
    if (weekNavLabel) {
        weekNavLabel.textContent = `${sun.getDate()} ${MONTH_ABB[sun.getMonth()]} – ${sat.getDate()} ${MONTH_ABB[sat.getMonth()]} ${sat.getFullYear()}`;
        weekNavLabel.classList.add('is-current-week'); // init always shows today's week
    }
}());

// ============================================
// UNSAVED CHANGES GUARD
// ============================================
// Tracks whether the USER has made a change since the last render.
// renderWeekGrid() pre-fills rows from existing overrides — those are
// NOT unsaved changes, so we use an explicit flag rather than checking
// dataset.type (which is set by the pre-fill as well).
let userMadeChanges = false;

/** Returns true if the user has interacted with the week grid without saving. */
function hasUnsavedChanges() { return userMadeChanges; }

/** Marks the grid as having unsaved changes. Call on any user interaction. */
function markChanged() {
    userMadeChanges = true;
    // A new edit invalidates a showing AL over-limit bar: its captured batch predates this edit,
    // so "Save anyway" would write a stale snapshot and the success path would then deactivate
    // the rows, silently discarding the newer edit (v16.69 review fix). The admin re-taps Save,
    // which recollects and re-checks.
    hideALConfirm();
}

// Warn browser/OS before closing or navigating away
window.addEventListener('beforeunload', e => {
    if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; }
});

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
        // The discard action navigates/re-renders, which moves focus itself; just drop
        // the saved reference so it can't be restored over the new view.
        _bannerReturnFocus = null;
        userMadeChanges = false;
        // Disarm any pending AL over-limit confirm bar too (v16.80 review fix): discarding
        // staged edits mid-flow must not leave "Save anyway" armed with the batch the admin
        // just threw away — otherwise a later tap writes overrides they explicitly discarded.
        // The v16.69 disarm sweep covered markChanged / member-change / stagedDiscardBtn but
        // not this banner path.
        hideALConfirm();
        if (_pendingNavigate) { const fn = _pendingNavigate; _pendingNavigate = null; fn(); }
    });
    keepBtn.addEventListener('click', () => {
        banner.style.display = 'none';
        _pendingNavigate = null;
        // Restore focus to wherever the user was before the banner interrupted them.
        _bannerReturnFocus?.focus?.();
        _bannerReturnFocus = null;
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
    const go = () => {
        const d = new Date(fieldDate.value + 'T12:00:00');
        d.setDate(d.getDate() + delta * 7);
        fieldDate.value = formatISO(d);
        lastFieldDate = fieldDate.value;
        renderWeekGrid();
        // Match the swipe-commit + fieldDate-change paths: refresh the AL banner + booked boxes so a
        // Dec→Jan week jump doesn't leave the previous year's entitlement/taken figures showing
        // (updateALBanner infers the year from fieldDate when no range is picked) (v16.21).
        updateALBanner(); updateALBookedBox(); updateSickBookedBox();
    };
    if (confirmNavigate(go)) go();
}

/** @type {HTMLElement} */ (document.getElementById('thisWeekBtn')).addEventListener('click', () => {
    const go = () => {
        fieldDate.value = formatISO(new Date()); lastFieldDate = fieldDate.value; renderWeekGrid();
        updateALBanner(); updateALBookedBox(); updateSickBookedBox();   // keep the banner year in sync (v16.21)
    };
    if (confirmNavigate(go)) go();
});

// ============================================
// WEEK GRID — SWIPE GESTURE
// Lazy-capture: pointerdown only records the start position. Horizontal
// intent is confirmed in pointermove (dx > dy), at which point
// setPointerCapture is called and the carousel starts. This makes the
// entire grid surface swipeable — including overridden rows where
// .col-pills and .col-time expand to full width — while still letting
// taps on checkboxes, pills, and time inputs fire their click handlers.
// Safety guards: blocks if unsaved changes exist, blocks if no member/week loaded.
// ============================================
(function initWeekSwipe() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TRANSITION  = prefersReducedMotion ? 'none' : 'transform 0.35s cubic-bezier(0.4,0,0.2,1)';
    const DURATION_MS = prefersReducedMotion ? 0 : 350;
    const SWIPE_PX  = SWIPE_THRESHOLD;  // shared constant from roster-data.js
    const SWIPE_VEL = SWIPE_VELOCITY;   // shared constant from roster-data.js

    /** @type {any} */
    let swipePanelPrev = null;
    /** @type {any} */
    let swipePanelNext = null;
    /** @type {any} */
    let swipePanelCurrent = null;
    let swipePanelWidth = 0, swipeStartX = 0, swipeStartY = 0, swipeStartTime = 0;
    let swipeListening = false, swipeDragging = false, swipeHapticFired = false, swipeCooldown = false;

    // Build a fully-functional adjacent week panel offset off-screen by delta weeks.
    /** @param {any} delta */
    function buildAdjPanel(delta) {
        const d = new Date(fieldDate.value + 'T12:00:00');
        d.setDate(d.getDate() + delta * 7);
        const panel = document.createElement('div');
        panel.className = 'week-panel week-carousel-panel';
        buildWeekGridInto(panel, formatISO(d));
        weekGrid.appendChild(panel);
        panel.style.transform = `translate3d(${delta < 0 ? -swipePanelWidth : swipePanelWidth}px, 0, 0)`;
        return panel;
    }

    function discardPanels() {
        if (swipePanelPrev && swipePanelPrev.parentNode) swipePanelPrev.remove();
        if (swipePanelNext && swipePanelNext.parentNode) swipePanelNext.remove();
        swipePanelPrev = null; swipePanelNext = null;
    }

    function snapBack() {
        if (swipePanelCurrent) { swipePanelCurrent.style.transition = TRANSITION; swipePanelCurrent.style.transform = 'translate3d(0, 0, 0)'; }
        if (swipePanelPrev)    { swipePanelPrev.style.transition    = TRANSITION; swipePanelPrev.style.transform    = `translate3d(${-swipePanelWidth}px, 0, 0)`; }
        if (swipePanelNext)    { swipePanelNext.style.transition    = TRANSITION; swipePanelNext.style.transform    = `translate3d(${swipePanelWidth}px, 0, 0)`; }
        setTimeout(() => {
            discardPanels();
            if (swipePanelCurrent) { swipePanelCurrent.style.transition = ''; swipePanelCurrent.style.willChange = ''; }
            swipePanelCurrent = null; swipeCooldown = false;
        }, DURATION_MS + 50);
    }

    // pointerdown: record start position only — no capture, no panel building yet.
    weekGrid.addEventListener('pointerdown', e => {
        if (e.clientX < 24) return; // leave iOS system back-swipe region
        if (!e.isPrimary || swipeCooldown) return;
        if (userMadeChanges) return;
        if (!fieldMember.value || !fieldDate.value) return;

        swipePanelCurrent = weekGrid.querySelector('.week-panel:not(.week-carousel-panel)');
        if (!swipePanelCurrent) return;

        navigator.vibrate?.(0);  // prime Vibration API on Android Chrome
        swipeStartX = e.clientX; swipeStartY = e.clientY; swipeStartTime = e.timeStamp;
        swipeListening = true; swipeDragging = false; swipeHapticFired = false;
    });

    // pointermove: confirm direction; start carousel only when clearly horizontal.
    weekGrid.addEventListener('pointermove', e => {
        if (!e.isPrimary || !swipeListening) return;
        const dx = e.clientX - swipeStartX;
        const dy = e.clientY - swipeStartY;

        if (!swipeDragging) {
            if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;

            if (Math.abs(dy) >= Math.abs(dx)) {
                // Vertical — abandon; let the browser scroll
                swipeListening = false;
                return;
            }

            // Horizontal confirmed — commit to swipe gesture
            swipePanelWidth = Math.ceil(weekGrid.getBoundingClientRect().width);
            weekGrid.setPointerCapture(e.pointerId);
            swipePanelCurrent.style.transition = 'none';
            swipePanelCurrent.style.willChange = 'transform';
            swipePanelPrev = buildAdjPanel(-1);
            swipePanelNext = buildAdjPanel(+1);
            swipeCooldown = true;
            swipeDragging = true;
        }

        swipePanelCurrent.style.transform = `translate3d(${dx}px, 0, 0)`;
        if (swipePanelPrev) swipePanelPrev.style.transform = `translate3d(${-swipePanelWidth + dx}px, 0, 0)`;
        if (swipePanelNext) swipePanelNext.style.transform = `translate3d(${swipePanelWidth + dx}px, 0, 0)`;

        if (!swipeHapticFired && Math.abs(dx) >= SWIPE_PX) {
            navigator.vibrate?.(6);
            swipeHapticFired = true;
        }
    });

    weekGrid.addEventListener('pointerup', e => {
        if (!e.isPrimary || !swipeListening) return;
        swipeListening = false;

        if (!swipeDragging) return; // was a tap — buttons/inputs handle their own clicks
        swipeDragging = false;
        try { weekGrid.releasePointerCapture(e.pointerId); } catch (_) {}

        const dx  = e.clientX - swipeStartX;
        const vel = e.timeStamp > swipeStartTime ? Math.abs(dx) / (e.timeStamp - swipeStartTime) : 0;
        const goLeft  = dx < 0 && (Math.abs(dx) >= SWIPE_PX || vel >= SWIPE_VEL);
        const goRight = dx > 0 && (Math.abs(dx) >= SWIPE_PX || vel >= SWIPE_VEL);

        if (goLeft || goRight) {
            if (!swipeHapticFired) navigator.vibrate?.(6);
            const incoming = goLeft ? swipePanelNext : swipePanelPrev;
            const discard  = goLeft ? swipePanelPrev : swipePanelNext;
            if (!incoming) { snapBack(); return; }

            // Commit: advance date state before animation so label is correct
            const d = new Date(fieldDate.value + 'T12:00:00');
            d.setDate(d.getDate() + (goLeft ? +7 : -7));
            fieldDate.value = lastFieldDate = formatISO(d);
            updateWeekNavLabel(fieldDate.value);
            updateALBanner();
            updateALBookedBox();
            updateSickBookedBox();
            userMadeChanges = false;

            swipePanelCurrent.style.transition = TRANSITION;
            swipePanelCurrent.style.transform  = `translate3d(${goLeft ? -swipePanelWidth : swipePanelWidth}px, 0, 0)`;
            incoming.style.transition = TRANSITION;
            incoming.style.transform  = 'translate3d(0, 0, 0)';
            if (discard && discard.parentNode) discard.remove();

            function restore() {
                incoming.classList.remove('week-carousel-panel');
                incoming.style.transition = incoming.style.transform = incoming.style.willChange = '';
                if (swipePanelCurrent && swipePanelCurrent.parentNode) swipePanelCurrent.remove();
                swipePanelPrev = swipePanelNext = swipePanelCurrent = null;
                resetBulkPills();
                updateSaveBtn();
                swipeCooldown = false;
            }
            const timer = setTimeout(restore, DURATION_MS + 50);
            incoming.addEventListener('transitionend', () => { clearTimeout(timer); restore(); }, { once: true });

        } else {
            snapBack();
        }
    });

    weekGrid.addEventListener('pointercancel', e => {
        if (!e.isPrimary || !swipeListening) return;
        swipeListening = false; swipeCooldown = false;
        try { weekGrid.releasePointerCapture(e.pointerId); } catch (_) {}
        if (swipeDragging) {
            swipeDragging = false;
            if (swipePanelCurrent) { swipePanelCurrent.style.transition = swipePanelCurrent.style.transform = swipePanelCurrent.style.willChange = ''; }
            discardPanels(); swipePanelCurrent = null;
        }
    });

    // Button handlers inside IIFE so they share the swipeCooldown closure variable
    /** @type {HTMLElement} */ (prevWeekBtn).addEventListener('click', () => { if (!swipeCooldown) shiftWeek(-1); });
    /** @type {HTMLElement} */ (nextWeekBtn).addEventListener('click', () => { if (!swipeCooldown) shiftWeek(+1); });
})();

// ============================================
// ANNUAL LEAVE BANNER
// ============================================
/**
 * Refreshes the AL entitlement banner above the Annual Leave card.
 * Shows taken, booked, and remaining days for the year inferred from
 * the current AL date inputs or the week currently being viewed.
 * Hidden when no member is selected.
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

    if (!memberName) {
        banner.hidden = true;
        const _hb = document.getElementById('alHeaderBalance');
        if (_hb) _hb.hidden = true;
        return;
    }

    const member      = teamMembers.find(m => m.name === memberName);
    if (!member)      { banner.hidden = true; return; }

    const alFrom      = /** @type {HTMLInputElement|null} */ (document.getElementById('alFrom'));
    const yearStr     = alFrom?.value ? alFrom.value.substring(0, 4) : (fieldDate.value ? fieldDate.value.substring(0, 4) : String(new Date().getFullYear()));
    const entitlement = getALEntitlement(member, parseInt(yearStr, 10), getAllOverrides());
    const todayStr    = formatISO(new Date());

    let taken  = 0;
    let booked = 0;
    getAllOverrides().forEach(o => {
        // Sundays are uncontracted — don't count Sunday AL entries against the entitlement
        if (o.memberName === memberName && o.type === 'annual_leave' && o.date && o.date.startsWith(yearStr) && !isSunday(o.date)) {
            if (o.date <= todayStr) taken++; else booked++;
        }
    });
    const remaining   = entitlement - taken - booked;

    remEl.textContent    = String(remaining);
    takenEl.textContent  = String(taken);
    bookedEl.textContent = String(booked);
    entEl.textContent    = String(entitlement);

    // Show breakdown note for Dispatchers (22 base + N bank holiday lieu days)
    const breakdownEl = document.getElementById('alBannerBreakdown');
    if (breakdownEl) {
        if (member.role === 'Dispatcher') {
            const lieu = entitlement - 22;
            breakdownEl.textContent = `22 base + ${lieu} BH lieu`;
            breakdownEl.hidden = false;
        } else {
            breakdownEl.hidden = true;
        }
    }

    banner.hidden = false;
    banner.classList.toggle('al-banner-warning', remaining <= 0);
    banner.classList.toggle('al-banner-low',     remaining > 0 && remaining <= 5);

    warnEl.hidden      = remaining > 0;
    warnEl.textContent = remaining === 0 ? 'Limit reached' : `${Math.abs(remaining)} over limit`;

    // Show remaining balance on the collapsed card header so staff see it at a glance
    const headerBalEl = document.getElementById('alHeaderBalance');
    const headerRemEl = document.getElementById('alHeaderRemaining');
    if (headerBalEl && headerRemEl) {
        headerRemEl.textContent = String(remaining);
        headerBalEl.hidden = false;
        headerBalEl.className = 'al-header-balance'
            + (remaining <= 0 ? ' balance-none' : remaining <= 5 ? ' balance-low' : '');
    }
}

// ============================================
// WEEK GRID
// ============================================
// updateWeekNavLabel, buildWeekGridInto, renderWeekGrid, activateRow,
// deactivateRow, updateSaveBtn, updateBulkSelCount — imported from admin-overrides.js

// ============================================
// SAVE
// ============================================
saveBtn.addEventListener('click', async () => {
    try {
    hideFeedback();
    const memberName = fieldMember.value;
    if (!memberName) return showError('No member selected.');

    // Clear any previous row-level errors
    weekGrid.querySelectorAll('.day-row.row-error').forEach(r => r.classList.remove('row-error'));

    /** @type {any[]} */
    const toSave = [];
    /** @type {any[]} */
    const toDelete = [];
    /** @type {any[]} */
    const errors = [];

    /** @type {NodeListOf<HTMLElement>} */ (weekGrid.querySelectorAll('.day-row')).forEach(row => {
        if (!row.dataset.type) {
            // Row was pre-filled with an existing override but user deactivated it → delete.
            if (row.dataset.existingId) toDelete.push(row.dataset.existingId);
            return;
        }
        // Pre-filled rows the user hasn't changed don't need re-saving.
        if (row.classList.contains('prefilled-existing')) return;

        const date    = row.dataset.date || '';
        const type    = row.dataset.type || '';

        // Sundays are uncontracted — AL and sick cannot be saved on a Sunday regardless of how it was set
        if (type === 'annual_leave' && isSunday(date)) {
            row.classList.add('row-error');
            errors.push(`${formatDisplay(date)}: annual leave cannot be recorded on a Sunday`);
            return;
        }
        if (type === 'sick' && isSunday(date)) {
            row.classList.add('row-error');
            errors.push(`${formatDisplay(date)}: absence cannot be recorded on a Sunday`);
            return;
        }
        if (type === 'other' && isSunday(date)) {
            row.classList.add('row-error');
            errors.push(`${formatDisplay(date)}: an "Other" day cannot be recorded on a Sunday`);
            return;
        }
        const typeMeta    = TYPES[type];
        const startEl = /** @type {HTMLInputElement} */ (row.querySelector('.day-start'));
        const endEl   = /** @type {HTMLInputElement} */ (row.querySelector('.day-end'));
        const note    = '';

        let value;
        if (type === 'other') {
            // Compose the Other-family grammar from the row's sub-controls:
            // FLAVOUR[" RDW"][" HH:MM-HH:MM"]. Times are OPTIONAL — blank means the pay
            // defaults apply (base shift on a rostered day, 8h RDW on an Other rest-day) —
            // but a half-filled or malformed pair is still an error.
            const flavour = (/** @type {HTMLElement|null} */ (row.querySelector('.other-flavour-btn.active')))?.dataset.flavour;
            // Force an explicit flavour choice — no silent Training default (owner decision,
            // v15.56): a manager recording an induction/assessment/team day who didn't tap a
            // type would otherwise have it saved as Training.
            if (!flavour) {
                row.classList.add('row-error');
                errors.push(`${formatDisplay(date)}: choose the type of Other day (Training, Induction, Assessment, Team Day or Spare)`);
                return;
            }
            if (flavour === 'SPARE') {
                // Spare lives under the Other pill but is its OWN override type — a standby
                // placeholder (not a worked day; keeps its 📋 purple badge; no RDW/times). Write
                // it directly as spare_shift and skip the Other-family grammar below. (v15.57)
                toSave.push({ memberName, date, type: 'spare_shift', value: 'SPARE', note, existingId: row.dataset.existingId || null });
                return;
            }
            // Rest-day base FORCES the RDW marker regardless of the tick: the pay engine and both
            // display layers derive RDW-ness from a rest-day base anyway (belt-and-braces — as-base
            // would pay £0), so storing 'TRG' for such a day would just make the saved value lie
            // about the behaviour the app honours. The tick still governs worked-base days.
            const _rdwTicked = (/** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb')))?.checked;
            const rdw     = (_rdwTicked || row.dataset.baseIsRd === '1') ? ' RDW' : '';
            const s = (/** @type {HTMLInputElement} */ (row.querySelector('.day-start'))).value.trim();
            const e = (/** @type {HTMLInputElement} */ (row.querySelector('.day-end'))).value.trim();
            let time = '';
            if (s || e) {
                const timeRe = TIME_RE;
                if (!s || !e) {
                    row.classList.add('row-error');
                    errors.push(`${formatDisplay(date)}: fill in both times, or leave both blank to use the default hours`);
                    return;
                }
                if (!timeRe.test(s) || !timeRe.test(e)) {
                    row.classList.add('row-error');
                    errors.push(`${formatDisplay(date)}: times must be in HH:MM format (e.g. 07:00)`);
                    return;
                }
                if (s === e) {
                    // Equal start/end would validate as a 0h shift but PAY as 24h (the overnight
                    // wrap in the duration maths) — reject at the only place times are authored.
                    row.classList.add('row-error');
                    errors.push(`${formatDisplay(date)}: start and end times are the same`);
                    return;
                }
                time = ` ${s}-${e}`;
            }
            value = `${flavour}${rdw}${time}`;
        } else if (typeMeta && typeMeta.fixed) {
            value = typeMeta.fixedValue;
        } else {
            const s = startEl.value.trim();
            const e = endEl.value.trim();
            const timeRe = TIME_RE;
            if (!s || !e) {
                row.classList.add('row-error');
                errors.push(`${formatDisplay(date)}: fill in the start and end time`);
                return;
            }
            if (!timeRe.test(s) || !timeRe.test(e)) {
                row.classList.add('row-error');
                errors.push(`${formatDisplay(date)}: times must be in HH:MM format (e.g. 07:00)`);
                return;
            }
            if (s === e) {
                // Same hazard as the Other path: equal times validate as a 0h shift but PAY as
                // 24h via the overnight wrap in the duration maths.
                row.classList.add('row-error');
                errors.push(`${formatDisplay(date)}: start and end times are the same`);
                return;
            }
            value = `${s}-${e}`;
        }

        toSave.push({ memberName, date, type, value, note, existingId: row.dataset.existingId || null });
    });

    if (errors.length)                    return showError("Can't save — " + errors.join(' · '));
    if (!toSave.length && !toDelete.length) return showError('No changes to save.');

    // Validate shift duration and rest-gap rules
    const ruleErrors = validateShiftRules(toSave, memberName, toDelete);
    if (ruleErrors.length) return showError(ruleErrors.join(' · '));

    // Annual leave entitlement warning
    const alInBatch = toSave.filter(e => e.type === 'annual_leave');
    if (alInBatch.length > 0) {
        const member      = /** @type {any} */ (teamMembers.find(m => m.name === memberName));
        const overwriteDates  = new Set(alInBatch.filter(e => e.existingId).map(e => e.date));
        const deletedALDates  = new Set(
            getAllOverrides()
                .filter(o => toDelete.includes(o.id) && o.type === 'annual_leave')
                .map(o => o.date)
        );
        // Check EVERY calendar year the batch touches, not just the first entry's — a week grid
        // spanning New Year (Dec/Jan) writes AL into two years, each with its own entitlement.
        const years = [...new Set(alInBatch.map(e => e.date.substring(0, 4)))];
        for (const yearStr of years) {
            const entitlement = getALEntitlement(member, parseInt(yearStr, 10), getAllOverrides());
            // Existing AL for the year, excluding Sundays (uncontracted) and the dates this batch
            // OVERWRITES or DELETES (they're re-accounted via newALDates / removed).
            const existingALDates = new Set(
                getAllOverrides().filter(o =>
                    o.memberName === memberName &&
                    o.type       === 'annual_leave' &&
                    o.date       && o.date.startsWith(yearStr) &&
                    !overwriteDates.has(o.date) &&
                    !deletedALDates.has(o.date) &&
                    !isSunday(o.date)
                ).map(o => o.date)
            );
            const newALDates = [...new Set(alInBatch.map(e => e.date).filter(d => d.startsWith(yearStr) && !isSunday(d)))];
            const overage = projectAnnualLeaveOverage({ name: memberName, year: yearStr, existingALDates, newALDates, entitlement });
            if (overage) {
                showALConfirm(overage.headline, overage.detail, toSave, toDelete);
                return;
            }
        }
    }

    await executeSave(toSave, toDelete);
    } catch (err) {
        console.error('[Admin] Save handler error:', err);
        showError('Unexpected error — please reload and try again.');
    }
});

// ── Staged bar — duplicates Save / Discard at the bottom so users don't scroll up ──
document.getElementById('stagedSaveBtn')?.addEventListener('click', () => saveBtn.click());
document.getElementById('stagedDiscardBtn')?.addEventListener('click', () => {
    userMadeChanges = false;
    // The bar's captured batch is exactly what was just discarded — "Save anyway" after a discard
    // must not write it back (v16.69 review fix).
    hideALConfirm();
    renderWeekGrid();
});

// ── AL / sick — element handles and display helpers referenced by the member picker below ──
// Declared here because the fieldMember change handler references them.
const alMember   = /** @type {HTMLSelectElement} */ (document.getElementById('alMember'));
const sickMember = /** @type {HTMLSelectElement} */ (document.getElementById('sickMember'));
function syncMemberDisplay() {
    const memberDisplay = document.getElementById('alMemberDisplay');
    if (memberDisplay) memberDisplay.textContent = fieldMember.value || 'Select a staff member above';
}
function syncSickMemberDisplay() {
    const memberDisplay = document.getElementById('sickMemberDisplay');
    if (memberDisplay) memberDisplay.textContent = fieldMember.value || 'Select a staff member above';
}

// Preview refreshers exposed by initALSection / initSickSection (assigned when those
// run, further down). Called on member change so the AL/absence previews can't keep
// naming the previously-selected person or their rest-day count. (stale-preview fix)
/** @type {(() => void) | null} */ let _refreshAlPreview   = null;
/** @type {(() => void) | null} */ let _refreshSickPreview = null;

let lastFieldMember = fieldMember.value;
fieldMember.addEventListener('change', () => {
    const chosen   = fieldMember.value;
    const previous = lastFieldMember;
    const go = () => {
        // Re-assert the value: on the unsaved-changes path the select was reverted to
        // `previous` (line below) and the banner's Discard runs this later, so without
        // this the field would stay on the old member while the grid switched. (v12.32)
        _setSelectValue(fieldMember, chosen);
        lastFieldMember  = chosen;
        lsSet(SELECTED_MEMBER, chosen);
        _setSelectValue(alMember, chosen);
        _setSelectValue(sickMember, chosen);
        syncMemberDisplay();
        syncSickMemberDisplay();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        _refreshAlPreview?.();   // keep the AL/absence previews pointed at the new member
        _refreshSickPreview?.();
        // The over-limit bar (either mode) was computed for the PREVIOUS member: the week-editor
        // batch belongs to them, and the AL-booking confirm must not let "Save anyway" book the
        // NEW member with the entitlement check silently skipped (v16.69 review fix).
        hideALConfirm();
        resetTableMemberFilter(); // also calls renderTable internally
        renderWeekGrid();
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
        // A hidden/leaver member is NOT in the STAFF MEMBER dropdown (populateMemberDropdown omits
        // them), so _setSelectValue can't switch to them — proceeding would silently edit whoever is
        // currently selected. Abort with a message instead (v16.84 review fix). To touch a leaver's
        // record, un-hide the member first, or just delete the row from Saved Changes.
        if (!_setSelectValue(fieldMember, memberName)) {
            showError(`${memberName} isn't in the staff list (hidden or left) — can't edit their entry here. Delete it from Saved Changes, or un-hide the member first.`);
            return;
        }
        fieldDate.value   = date;
        lastFieldMember   = memberName;
        lastFieldDate     = date;
        // _setSelectValue fires no 'change' event, so the fieldMember change handler (which
        // re-syncs these) never runs on this path. Sync the AL/Absence selects + labels here
        // exactly like showInChangeAShift, or a booking made from those cards right after an
        // ✏️ edit would record against the PREVIOUSLY-selected member, not the edited one.
        _setSelectValue(alMember, memberName);
        _setSelectValue(sickMember, memberName);
        syncMemberDisplay();
        syncSickMemberDisplay();
        // Also re-run the preview refreshers the fieldMember change handler would fire — since
        // _setSelectValue dispatches no 'change', an already-selected AL/absence date range would
        // otherwise keep naming the PREVIOUS member and their rest-day count (stale-preview, v16.19).
        _refreshAlPreview?.();
        _refreshSickPreview?.();
        // Refresh the AL banner + booked boxes like the fieldMember change handler does (v16.23):
        // after ✏️ Edit on member B, the banner otherwise kept showing member A's entitlement/
        // taken/booked — and the booked boxes kept A's periods with LIVE Delete buttons — while
        // every other control targeted B.
        updateALBanner(); updateALBookedBox(); updateSickBookedBox();
        lsSet(SELECTED_MEMBER, memberName);
        renderWeekGrid();
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
        lastFieldMember   = memberName;
        lastFieldDate     = date;
        _setSelectValue(alMember, memberName);
        _setSelectValue(sickMember, memberName);
        syncMemberDisplay();
        syncSickMemberDisplay();
        // Keep the AL/absence previews pointed at the new member (see handleEdit — stale-preview, v16.19).
        _refreshAlPreview?.();
        _refreshSickPreview?.();
        // Align the saved-changes month filter so the new days aren't filtered out.
        const monthFilter = /** @type {HTMLSelectElement} */ (document.getElementById('overridesMonthFilter'));
        if (monthFilter) monthFilter.value = date.substring(0, 7);
        renderTable();
        renderWeekGrid();
        // The grid was rebuilt fresh from saved data — no pending edits remain.
        userMadeChanges = false;
    };
    // Re-pointing the grid re-renders it, which would silently discard any UNSAVED
    // week-grid edits. Guard it the same way every other navigation does (member/date
    // change, edit-from-table): if the grid is dirty, show the Discard/Keep-editing
    // banner instead of wiping the staged edits. The AL/absence save has already
    // committed; this only governs whether the grid jumps to reflect it. (data-loss fix)
    if (confirmNavigate(go)) go();
}


// ============================================
// UTILITIES
// ============================================


/** @type {any} */ let _toastTimer = null;
/** @type {any} */ let _feedbackTimer = null;
/** Shows a success message in the week editor feedback area.  @param {string} msg */
function showSuccess(msg) {
    clearTimeout(_feedbackTimer);
    formFeedback.className = 'feedback success';
    formFeedback.textContent = '✓ ' + msg;
    _feedbackTimer = setTimeout(hideFeedback, 7000);

    // Also show a bottom-anchored toast so confirmation is visible regardless of scroll position
    const toast = document.getElementById('saveToast');
    if (toast) {
        clearTimeout(_toastTimer);
        toast.textContent = '✓ ' + msg;
        toast.classList.add('visible');
        _toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
    }
}

/** Shows an error message in the week editor feedback area.  @param {string} msg */
function showError(msg) {
    clearTimeout(_feedbackTimer);
    formFeedback.className = 'feedback error';
    formFeedback.textContent = '⚠ ' + msg;
    formFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Clears the week editor feedback area. */
function hideFeedback() {
    formFeedback.className = 'feedback';
    hideALConfirm();
}

// ---- AL over-limit confirm bar ----
/** @type {any} */ let _alPendingSave   = null;
/** @type {any[]} */ let _alPendingDelete = [];
const alConfirmBar       = /** @type {HTMLElement} */ (document.getElementById('alConfirmBar'));
const alConfirmMsg       = /** @type {HTMLElement} */ (document.getElementById('alConfirmMsg'));
const alConfirmSub       = /** @type {HTMLElement} */ (document.getElementById('alConfirmSub'));
const alConfirmSaveBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('alConfirmSaveBtn'));
const alConfirmCancelBtn = /** @type {HTMLElement} */ (document.getElementById('alConfirmCancelBtn'));

/**
 * Shows the AL over-entitlement confirmation bar with a warning and two options.
 * In the week editor path, pendingSave is the toSave array to resume with.
 * In the AL booking path, pendingSave is null — the bar re-triggers alSaveBtn.click().
 * @param {string}      msg          Main warning line
 * @param {string}      sub          Secondary detail line
 * @param {any[]|null}  pendingSave  toSave batch to resume, or null for AL booking path
 * @param {string[]}    pendingDelete  IDs to delete in the same batch
 */
function showALConfirm(msg, sub, pendingSave, pendingDelete = []) {
    _alPendingSave   = pendingSave;
    _alPendingDelete = pendingDelete;
    alConfirmMsg.textContent = msg;
    alConfirmSub.textContent = sub;
    alConfirmSaveBtn.disabled = false;   // re-arm (the click handler disables to block a double-tap)
    alConfirmBar.classList.add('visible');
    alConfirmSaveBtn.focus();
}
/** Hides the AL over-entitlement confirmation bar and clears pending save state. */
function hideALConfirm() {
    alConfirmBar.classList.remove('visible');
    _alPendingSave   = null;
    _alPendingDelete = [];
    // Disarm the button too: the slide-out keeps the bar hit-testable for 0.25s, and with
    // _alPendingSave just nulled a tap in that window would fall through to the AL-booking
    // branch (an entitlement-unchecked booking). showALConfirm re-arms it. (v16.69)
    alConfirmSaveBtn.disabled = true;
}

alConfirmSaveBtn.addEventListener('click', async () => {
    // Disable immediately: the bar's slide-out keeps it hit-testable for 0.25s (CSS visibility
    // delay), so without this a fast double-tap on the week-editor path would see _alPendingSave
    // already nulled by hideALConfirm and fall into the AL-booking branch — an unintended,
    // entitlement-unchecked AL write. Re-enabled by showALConfirm the next time the bar opens.
    if (alConfirmSaveBtn.disabled) return;
    alConfirmSaveBtn.disabled = true;
    if (_alPendingSave) {
        // Week editor path — toSave is an array of override entries
        const toSave   = _alPendingSave;
        const toDelete = _alPendingDelete;
        hideALConfirm();
        await executeSave(toSave, toDelete);
    } else {
        // AL booking path — delegate to admin-al.js which owns the save button and flag
        hideALConfirm();
        triggerConfirmedALSave();
    }
});

alConfirmCancelBtn.addEventListener('click', () => {
    hideALConfirm();
    saveBtn.textContent = 'Save changes';
    // Let staged-row state govern the week-editor Save's disabled state (v16.23). The confirm bar
    // is shared by the AL-BOOKING card too — force-enabling here on that path left a primary
    // action enabled with ZERO staged rows (clicking only yielded "No changes to save").
    updateSaveBtn();
});

// ============================================
// ANNUAL LEAVE BOOKING  (logic in admin-al.js)
// ============================================
_refreshAlPreview = initALSection({
    alMember,
    syncMemberDisplay,
    populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox,
    getCurrentUser: () => currentUser, showALConfirm, hideALConfirm, showInChangeAShift,
    showSuccess,
})?.updateAlPreview ?? null;

// ============================================
// SICK DAYS RECORDING  (logic in admin-sick.js)
// ============================================
_refreshSickPreview = initSickSection({
    sickMember,
    syncSickMemberDisplay, populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox, getCurrentUser: () => currentUser, showInChangeAShift,
    showSuccess,
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
 */
async function deletePeriodOverrides(type, memberName, start, end, feedbackEl, btn) {
    // Scope the delete so an overlapping range's shared Sunday RD-correction is not
    // stripped. The previous check looked for an AL/sick record ON the Sunday, which the
    // range writer never creates (Sundays are non-contracted) — so it always removed the
    // correction, even when another overlapping range still needed it. The pure helper
    // keeps a Sunday correction whenever a remaining AL/sick override is adjacent to it.
    const allForDelete = getAllOverrides();
    const deleteIds = computePeriodDeleteIds(allForDelete, { type, memberName, start, end });
    if (!deleteIds.length) { btn.classList.remove('confirming'); btn.textContent = 'Delete'; return; }
    const idSet = new Set(deleteIds);
    // User-facing count = leave days only (exclude the Sunday RD corrections from the tally).
    const leaveCount = allForDelete.filter(o => idSet.has(o.id) && o.type === type).length;
    // Wait for the Firebase Auth session to (re-)establish before writing, and surface a clear
    // message if it hasn't — parity with executeSave(). A returning user has a valid LOCAL session
    // but auth.currentUser is briefly null while Firebase restores; a delete fired in that window
    // gets a permission-denied that writeWithClaimRetry can't recover (no currentUser to refresh),
    // showing a false "Delete failed" for a session that is merely still loading (v16.19).
    await sessionReady;
    if (!auth.currentUser) {
        if (feedbackEl) {
            feedbackEl.textContent = "⚠ You've been signed out — please sign in again.";
            feedbackEl.className = 'feedback error';
        }
        // Reset the button off its "⚠ Confirm?" state (these early returns skip the try/finally) (v16.22).
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
        return;
    }
    btn.disabled    = true;
    btn.textContent = '…';
    try {
        // Re-runnable thunk (fresh batch each attempt) so a stale-claim manager's period delete
        // self-heals via writeWithClaimRetry — parity with the other override write paths.
        await writeWithClaimRetry(async () => {
            const batch = writeBatch(db);
            deleteIds.forEach(id => batch.delete(doc(db, COLLECTIONS.overrides, id)));
            await batch.commit();
        });
        setAllOverrides(getAllOverrides().filter(o => !idSet.has(o.id)));
        renderTable();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        // Preserve unsaved staged week-grid edits across an AL/absence range delete (v16.82).
        if (fieldMember.value && fieldDate.value && !_hasStagedEdits()) renderWeekGrid();
        if (feedbackEl) {
            const noun = type === 'annual_leave' ? 'AL day' : 'absence day';
            feedbackEl.textContent = `✓ Deleted ${leaveCount} ${noun}${leaveCount !== 1 ? 's' : ''} for ${memberName}`;
            feedbackEl.className = 'feedback success';
            setTimeout(() => { feedbackEl.className = 'feedback'; }, 6000);
        }
    } catch (err) {
        console.error('[Admin] Period delete failed:', err);
        if (feedbackEl) {
            const msg = (/** @type {any} */ (err)).code === 'unavailable'
                ? '⚠ You appear to be offline — reconnect and try again.'
                : '⚠ Delete failed — check your connection and try again.';
            feedbackEl.textContent = msg;
            feedbackEl.className = 'feedback error';
        }
    } finally {
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
    }
}

// ── Shared helpers for AL and sick booked-box rendering ──────────────────────

/**
 * @param {string} dateStr
 * @param {number} n
 */
function _addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return formatISO(d);
}

/**
 * @param {string} dateStr
 * @param {any} memberObj
 */
function _isRestGap(dateStr, memberObj) {
    if (isSunday(dateStr)) return true; // Sunday — uncontracted
    if (!memberObj) return false;
    const shift = getBaseShift(memberObj, new Date(dateStr + 'T12:00:00'));
    return isRestShift(shift);
}

/** @param {string} d */
function _fmtPeriodDate(d) {
    const dt = new Date(d + 'T12:00:00');
    return `${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;
}

/**
 * @param {string} start
 * @param {string} end
 */
function _fmtPeriodRange(start, end) {
    const ds = new Date(start + 'T12:00:00');
    const de = new Date(end   + 'T12:00:00');
    if (ds.getMonth() === de.getMonth()) {
        return `${DAY_NAMES[ds.getDay()]} ${ds.getDate()} – ${DAY_NAMES[de.getDay()]} ${de.getDate()} ${MONTH_ABB[de.getMonth()]}`;
    }
    return `${_fmtPeriodDate(start)} – ${_fmtPeriodDate(end)}`;
}

/**
 * Shared renderer for AL and sick booked-dates boxes.
 * @param {{ type: string, memberName: string, boxId: string, bodyId: string,
 *           countFn: (n: number) => string, countClass: string, feedbackId: string }} cfg
 */
function _renderBookedPeriods({ type, memberName, boxId, bodyId, countFn, countClass, feedbackId }) {
    const box  = document.getElementById(boxId);
    const body = document.getElementById(bodyId);
    if (!box || !body) return;

    if (!memberName) { box.hidden = true; return; }

    const entries = getAllOverrides().filter(o =>
        o.memberName === memberName &&
        o.type       === type &&
        o.date
    ).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

    if (!entries.length) { box.hidden = true; return; }

    const memberObj = teamMembers.find(m => m.name === memberName);
    const dateList  = [...new Set(entries.map(e => e.date))].filter(d => !isSunday(d)).sort();
    if (!dateList.length) { box.hidden = true; return; }
    // Gap-merge is the pure, unit-tested override-utils helper; the day-of-week / base-roster
    // knowledge stays here via the two injected closures (v16.42).
    const periods = mergeBookedPeriods(dateList, d => _isRestGap(d, memberObj), d => _addDays(d, 1));

    const byMonth = /** @type {Record<string, any[]>} */ ({});
    for (const p of periods) {
        const key = p.start.slice(0, 7);
        (byMonth[key] = byMonth[key] || []).push(p);
    }

    body.innerHTML = '';
    const feedbackEl = document.getElementById(feedbackId);
    for (const key of Object.keys(byMonth).sort()) {
        const [yr, mo] = key.split('-');
        const monthDiv = document.createElement('div');
        monthDiv.className = 'al-period-month';
        monthDiv.innerHTML = `<div class="al-period-month-hdr">${MONTH_ABB[parseInt(mo, 10) - 1]} ${yr}</div>`;
        for (const p of byMonth[key]) {
            const dateStr = p.start === p.end ? _fmtPeriodDate(p.start) : _fmtPeriodRange(p.start, p.end);
            const row     = document.createElement('div');
            row.className = 'al-period-row';
            row.innerHTML = `<span class="al-period-dates">${dateStr}</span>`;
            const meta    = document.createElement('div');
            meta.className = 'al-period-row-meta';
            meta.innerHTML = `<span class="${countClass}">${countFn(p.count)}</span>`;
            const btn     = document.createElement('button');
            btn.className   = 'btn-period-delete';
            btn.textContent = 'Delete';
            btn.addEventListener('click', () => {
                if (!btn.classList.contains('confirming')) {
                    btn.classList.add('confirming');
                    btn.textContent = '⚠ Confirm?';
                    setTimeout(() => {
                        if (btn.classList.contains('confirming')) {
                            btn.classList.remove('confirming');
                            btn.textContent = 'Delete';
                        }
                    }, 5000);
                    return;
                }
                deletePeriodOverrides(type, memberName, p.start, p.end, /** @type {HTMLElement} */ (feedbackEl), btn);
            });
            meta.appendChild(btn);
            row.appendChild(meta);
            monthDiv.appendChild(row);
        }
        body.appendChild(monthDiv);
    }
    box.hidden = false;
}

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
        countFn:    n => `${n} absence day${n !== 1 ? 's' : ''}`,
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

    // Non-admin: lock all member selectors to their own name.
    // Flag it on <body> so the mobile sticky-member-bar rule can opt OUT for these
    // self-service users — their bar shows only their own (unchangeable) name, so
    // pinning it would just cost vertical space. Admins/managers (who switch between
    // people and can lose track on scroll) keep the sticky bar.
    document.body.classList.add('member-locked');
    const _memberSelectable = _setSelectValue(fieldMember, currentUser);
    if (!_memberSelectable) {
        // currentUser isn't a selectable (non-hidden) member — a leaver whose Firebase account
        // wasn't disabled yet but still holds a valid 30-day session. Without this, the three
        // DISABLED selects stay pinned to the FIRST member in the dropdown, so any AL/absence/shift
        // booking would silently target the WRONG person (changedBy is real, target is not). Clear
        // the selects so their value is '' and every write path's `if (!member) return` guard blocks,
        // and surface a clear message. (v16.21)
        fieldMember.selectedIndex = -1;
        alMember.selectedIndex = -1;
        sickMember.selectedIndex = -1;
        fieldMember.disabled = alMember.disabled = sickMember.disabled = true;
        const _msg = 'Your account is no longer on the roster — please contact the admin.';
        document.querySelectorAll('#alToggleHeader .hint, #sickToggleHeader .hint, #overridesToggleHeader .hint')
            .forEach(el => { el.textContent = _msg; });
        console.warn(`[Admin] Signed-in member "${currentUser}" is not a selectable roster member (hidden/leaver) — booking selectors blocked.`);
        return;
    }
    fieldMember.disabled  = true;
    syncMemberDisplay();
    _setSelectValue(alMember, currentUser);
    alMember.disabled     = true;
    _setSelectValue(sickMember, currentUser);
    sickMember.disabled   = true;
    // Refresh the absence card's display label too (v16.23) — the module-scope restore may have
    // stamped a COLLEAGUE's name into #sickMemberDisplay (myb_roster_selected_member follows
    // whichever calendar the user last viewed), and with the select disabled no change event
    // ever corrects it. The write targeted sickMember.value (self) — display-only, but alarming.
    syncSickMemberDisplay();
    lsSet(SELECTED_MEMBER, currentUser);

    // Reword card hints to use first-person language for self-service users
    const alHint   = document.querySelector('#alToggleHeader .hint');
    const sickHint = document.querySelector('#sickToggleHeader .hint');
    const savedHint = document.querySelector('#overridesToggleHeader .hint');
    if (alHint)    alHint.textContent   = 'Select a date range — rest days and Sundays are skipped automatically';
    if (sickHint)  sickHint.textContent = 'Record your own absence days — for any reason';
    if (savedHint) savedHint.textContent = 'Your saved changes — tap any row to edit or delete';

    // Auto-open the Annual Leave card — most staff visit here primarily to book AL
    const alBody    = document.getElementById('alBody');
    const alChevron = document.getElementById('alChevron');
    if (alBody)    alBody.classList.add('open');
    if (alChevron) alChevron.classList.add('open');
}

// ============================================
// ANNUAL LEAVE — booked dates collapsible box
// ============================================
function updateALBookedBox() {
    _renderBookedPeriods({
        type:       'annual_leave',
        memberName: alMember.value,
        boxId:      'alBookedBox',
        bodyId:     'alBookedBody',
        countFn:    n => `${n} day${n !== 1 ? 's' : ''} AL`,
        countClass: 'al-period-count',
        feedbackId: 'alFeedback',
    });
}

initCardCollapse('alBookedToggle',      'alBookedBody',   'alBookedChevron');

// ============================================
// CARD COLLAPSE — AL, Sick, Overrides
// ============================================
initCardCollapse('alToggleHeader',          'alBody',            'alChevron');
initCardCollapse('sickToggleHeader',        'sickBody',          'sickChevron');
initCardCollapse('overridesToggleHeader',   'overridesBody',     'overridesChevron');


// ============================================
// PRINT HEADER — member name, week, timestamp
// ============================================
// iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
// eagerly on load. The beforeprint handler is kept for desktop browsers, where it
// fires reliably just before the print dialog opens.
function stampAdminPrintHeader() {
    const member    = fieldMember.value || 'All members';
    const weekLabel = document.getElementById('weekNavLabel')?.textContent || '';
    const now       = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const printHeaderEl = document.getElementById('printHeader');
    if (printHeaderEl) printHeaderEl.innerHTML = `Marylebone Roster — ${escapeHtml(member)}<span class="print-sub">Week: ${escapeHtml(weekLabel)} · Printed: ${escapeHtml(now)}</span>`;
}
stampAdminPrintHeader();
window.addEventListener('beforeprint', stampAdminPrintHeader);

/**
 * One-time cleanup: deletes any annual_leave overrides that fall on a Sunday.
 * These can't be created any more but may exist from before v5.73.
 * Scans the in-memory cache (populated by loadOverrides) — no extra Firestore read.
 * Runs silently on admin page load; skipped after the first clean run.
 *
 * SUNSET: this is a pre-v5.73 data cleanup that still runs per-device on every admin load
 * (guarded by the localStorage `purgeSundayAL_done` flag, so it's a no-op after the first
 * clean pass on each device). Safe to delete once confident no Sunday-AL docs remain in
 * Firestore — verify with a one-off admin query, then remove this function + its call site.
 */
async function purgeSundayAL() {
    if (lsGet('purgeSundayAL_done') === '1') return;
    try {
        const allOverrides = getAllOverrides();
        const toDelete = allOverrides.filter(o => o.type === 'annual_leave' && isSunday(o.date));

        if (!toDelete.length) {
            // Only mark done when the cache is non-empty: an empty cache on first load
            // (offline/slow network) doesn't mean there are no Sunday AL overrides to purge.
            if (allOverrides.length > 0) {
                lsSet('purgeSundayAL_done', '1');
            }
            return;
        }

        // Wrap in writeWithClaimRetry for parity with every other override write path — a transient
        // stale-claim permission-denied then self-heals instead of logging + leaving
        // purgeSundayAL_done UNSET, which re-ran this cleanup on every admin load until the claim
        // refreshed. Fresh batch per attempt (a WriteBatch can't be re-committed). (v16.19)
        await writeWithClaimRetry(async () => {
            const batch = writeBatch(db);
            toDelete.forEach(o => batch.delete(doc(db, COLLECTIONS.overrides, o.id)));
            await batch.commit();
        });
        lsSet('purgeSundayAL_done', '1');

        // Update in-memory cache so Saved Changes reflects the cleanup
        const removedIds = new Set(toDelete.map(o => o.id));
        setAllOverrides(getAllOverrides().filter(o => !removedIds.has(o.id)));
        renderTable();
        updateALBanner();
        updateALBookedBox();

    } catch (err) {
        console.error('[purgeSundayAL] Cleanup failed:', err);
    }
}

// ---- One-time work email check (shown once per device after login) ----

/** ~3-monthly work-email re-confirmation cadence (v14.77). */
// Page-access decision via the Phase-3 policy (auth-policy.js → ARCHITECTURE_PLAN.md Phase 6).
// Admin's policy is "any named user" (role null) — staff get self-service; the admin/manager split
// gates ACTIONS (applyPermissions below), NOT page access, so there is no 'forbidden' path here.
// The snapshot maps the LOCAL session-existence flag (isAuthenticated = !!currentSession) to an
// optimistic 'named' status — preserving the exact prior trigger — so requirePage returns 'login'
// iff there is no local session (decision identical to the old `if (!isAuthenticated)`). member is
// irrelevant to the decision because Admin requires no role.
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
 * Authorised (signed-in) init body — ARCHITECTURE_PLAN.md Phase 9. Runs exactly once per page life:
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
    // Returning user with a valid localStorage session never passes through the
    // login click handler, so re-establish the Firebase Auth session here.
    // Without this, auth.currentUser stays null and every Firestore write fails.
    // resolveSession() fulfils sessionReady so feature modules (admin-auth.js,
    // admin-overrides.js, huddle.js) can import sessionReady instead of window._mybSession.
    const _adminAuth = ensureNamedSession(currentUser);
    resolveSession(_adminAuth);
    // B1.2: when the named-session requirement is on, a returning local session that can't be
    // confirmed as this member's OWN Firebase identity is cleared and re-authenticated via the
    // login overlay. Decided via the policy now: once the named session resolves, the store (fed
    // by the Phase-2 bridge inside ensureNamedSession) reflects the terminal Firebase identity, so
    // `requirePage(getAuthSnapshot(), 'admin')` returns 'login' exactly when the member's OWN named
    // session could not be confirmed — equivalent to the old `if (ENFORCE && !named)`. Flag OFF →
    // resolves 'named'/'anonymous' to 'allow', so this never fires (unchanged).
    _adminAuth.then(() => {
        // B1: this optimistic 'allow' init turned out to be an unconfirmable session → clear it and
        // re-show the login overlay. The re-login RELOADS on success (reloadOnSuccess), because this
        // optimistic pass already resolved the one-shot sessionReady — re-initialising in place cannot
        // re-resolve it and would strand feature modules on a stale auth barrier. resetNavPanel() clears
        // the stale identity the optimistic pass wired into the drawer so it isn't briefly visible
        // behind the overlay before the reload (initNavPanel self-guards against re-wiring otherwise).
        if (CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'admin').decision === 'login') { clearSession(); resetNavPanel(); showAdminLogin({ reloadOnSuccess: true }); }
    });
    // All dropdowns are now populated — apply permissions then load data
    document.body.classList.add('auth-ready');
    applyPermissions();
    // Render bulk-bar type pills from PILL_TYPES (single source of truth with per-row pills).
    // 'other' is excluded here — the deliberate one exception: an "Other" day needs a per-row
    // flavour (Training/Induction/Assessment/Team Day/Spare) that the bulk bar can't supply, so
    // bulk-applying it staged rows that ALWAYS failed at save with "choose the type of Other day".
    // Other is still applied per-row in the week grid. (If bulk training-weeks ever need first-class
    // support, add a bulk flavour sub-selector rather than re-adding the bare pill.)
    const _bulkPillsContainer = document.getElementById('bulkTypePills');
    if (_bulkPillsContainer) {
        _bulkPillsContainer.innerHTML = PILL_TYPES.filter(t => t !== 'other').map(t =>
            `<button class="type-pill-btn pill-${t}" data-type="${t}" aria-pressed="false">${TYPES[t].pill}</button>`
        ).join('');
    }
    initOverrides({
        currentUser,
        currentIsAdmin,
        currentIsManager,
        showSuccess,
        showError,
        onAfterSave: () => {
            userMadeChanges = false;
            updateALBanner();
            updateALBookedBox();
            updateSickBookedBox();
        },
        markChanged,
        onEditRow: handleEdit,
    });
    const _loadPromise = loadOverrides(); // internally calls renderWeekGrid() after data loads
    // purgeSundayAL scans the in-memory cache, so it must run after loadOverrides completes
    if (currentIsAdmin) _loadPromise.then(() => purgeSundayAL());

    // If arriving via deep-link (e.g. from the AL lightbox), open and scroll to the target card.
    // Look the target up by ID, never `querySelector(location.hash)` — a malformed hash (#[, #%, #..)
    // makes querySelector throw a SyntaxError, which on the in-place-login path is caught into a
    // reload; the bad hash then survives the reload and loops. getElementById can't throw; a bad
    // decode is swallowed and treated as "no target".
    if (location.hash) {
        let target = null;
        try { const id = decodeURIComponent(location.hash.slice(1)); target = id ? document.getElementById(id) : null; }
        catch { target = null; }
        if (target) {
            // Open the collapsible body inside the target card if present
            const body    = target.querySelector('.card-collapsible-body');
            const chevron = target.querySelector('.collapse-chevron');
            if (body)    body.classList.add('open');
            if (chevron) chevron.classList.add('open');
            requestAnimationFrame(() => requestAnimationFrame(() =>
                target.scrollIntoView({ behavior: 'smooth', block: 'start' })
            ));
        }
    }
    // One-time email check — fire-and-forget; async Firestore fetch inside.
    initEmailCheck(currentUser);
    // Nav panel — deferred here on the in-place login path so it renders with the signed-in identity
    // (deduped by initNavPanel's navPanelInit guard if already wired on a normal load).
    wireNavPanel();
}

// ============================================
// If the admin has unsaved changes, wait until they navigate away before reloading.
registerServiceWorker({
    beforeReload() {
        if (!hasUnsavedChanges()) { window.location.reload(); return; }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') window.location.reload();
        }, { once: true });
    },
});
sessionReady.then(() => { initErrorReporter(); recordUsage('admin', currentUser); recordPageLatency('admin', currentUser); });

// ── Navigation panel ─────────────────────────────────────────────────────────
function wireNavPanel() {
    initNavPanel({
        currentPage: 'admin',
        memberName:  currentUser,
        isAdmin:         currentIsAdmin,
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(currentUser),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   () => { clearSession(); window.location.reload(); },
    });
    // Calendar pill: write the current fieldDate month/year to localStorage before navigating so
    // index.html opens on the same month the user was editing. (Replaces the removed v10.63 header
    // back button.) Wired HERE — inside wireNavPanel, guarded per element — not at module scope: the
    // B1 teardown path resetNavPanel()s and re-injects a FRESH pill, and a module-scope listener on
    // the old pill would be silently lost with it. initNavPanel's own guard means the pill element
    // survives repeat wireNavPanel() calls, so the dataset guard prevents double-attach.
    const calPill = /** @type {HTMLElement|null} */ (document.querySelector('.nav-panel-pill--calendar'));
    if (calPill && !calPill.dataset.monthPersistWired) {
        calPill.dataset.monthPersistWired = '1';
        calPill.addEventListener('click', () => {
            if (fieldDate.value) {
                const d = new Date(fieldDate.value + 'T12:00:00');
                lsSet(VIEWED_MONTH, d.getMonth());     // 0-indexed, matches app.js
                lsSet(VIEWED_YEAR,  d.getFullYear());
            }
            // Let the <a> navigate normally
        });
    }
}
// Wire the nav now EXCEPT on the in-place login path, where initAuthorised() defers it so it renders
// with the signed-in identity (the full-screen overlay covers the burger meanwhile). Flag off → wired
// now exactly as before (null identity on the login screen, corrected after the reload).
if (!CONFIG.INPLACE_LOGIN.admin || _access.decision !== 'login') wireNavPanel();

