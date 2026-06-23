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

import { CONFIG, teamMembers, DAY_KEYS, DAY_NAMES, MONTH_ABB, MONTH_NAMES, getALEntitlement, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml, formatISO, isSunday, SWIPE_THRESHOLD, SWIPE_VELOCITY, getMembersForGrade } from './roster-data.js';
import { db, collection, query, where, orderBy, limit, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, serverTimestamp, writeBatch } from './firebase-client.js';
import { getSurname, ensureFirebaseSession, getSession, saveSession, clearSession } from './session.js';
import { TYPES, PILL_TYPES, getAllOverrides, setAllOverrides, initOverrides, loadOverrides, renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, renderTable, executeSave, validateShiftRules, getEffectiveShift, formatDisplay, resetBulkPills, updateSaveBtn, resetTableMemberFilter } from './admin-overrides.js';
import { initALSection, triggerConfirmedALSave } from './admin-al.js';
import { initSickSection } from './admin-sick.js';
import { buildRangePicker } from './admin-rangepicker.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { initNavPanel } from './nav-panel.js';
import { lockBodyScroll, initCardCollapse, trapFocus } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { isRestShift } from './app-override-utils.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';

// Allow ?logout in the URL to force-clear session (useful when the sign-out
// button is unreachable due to a broken or skipped login state).
if (new URLSearchParams(location.search).has('logout')) {
    clearSession();
    history.replaceState(null, '', location.pathname); // remove ?logout from URL
}

// ---- Check session immediately ----
const currentSession = getSession();
const isAuthenticated = !!currentSession;
const currentUser     = currentSession?.name ?? null;
const currentIsAdmin   = CONFIG.ADMIN_NAMES.includes(currentUser);
const currentIsManager = (CONFIG.MANAGER_NAMES || []).includes(currentUser);

// ---- Login overlay (shown when not authenticated) ----
function initLoginOverlay() {
    const overlay       = document.getElementById('loginOverlay');
    const gradeSelect   = document.getElementById('loginGrade');
    const nameSelect    = document.getElementById('loginName');
    const passwordInput = document.getElementById('loginPassword');
    const submitBtn     = document.getElementById('loginSubmit');
    const errorEl       = document.getElementById('loginError');

    if (!overlay) return;
    overlay.classList.add('visible');
    lockBodyScroll();

    overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { window.location.href = './index.html'; return; }
        trapFocus(overlay, e);
    });

    // Grade order — defines display sequence; Management always last
    const GRADE_ORDER = ['CEA', 'CES', 'Dispatcher', 'Management'];
    const GRADE_KEY   = 'myb_login_grade';

    // Populate grade dropdown
    GRADE_ORDER.forEach(g => gradeSelect.appendChild(new Option(g, g)));

    // Repopulate name dropdown whenever grade changes
    function populateNames(grade) {
        nameSelect.innerHTML = '';
        if (!grade) {
            nameSelect.appendChild(new Option('— Select grade first —', ''));
            nameSelect.disabled = true;
            return;
        }
        nameSelect.appendChild(new Option('— Select your name —', ''));
        getMembersForGrade(grade).forEach(m => nameSelect.appendChild(new Option(m.name, m.name)));
        nameSelect.disabled = false;
    }

    // Restore last-used grade so returning users go straight to name → password
    const savedGrade = lsGet(GRADE_KEY);
    if (savedGrade && GRADE_ORDER.includes(savedGrade)) {
        gradeSelect.value = savedGrade;
        populateNames(savedGrade);
    } else {
        populateNames('');
    }

    gradeSelect.addEventListener('change', () => {
        errorEl.classList.remove('visible');
        passwordInput.value = '';
        nameSelect.value = '';
        populateNames(gradeSelect.value);
        if (gradeSelect.value) nameSelect.focus();
    });

    nameSelect.addEventListener('change', () => {
        errorEl.classList.remove('visible');
        passwordInput.value = '';
        if (nameSelect.value) passwordInput.focus();
    });

    let _failCount = 0;
    let _lockedUntil = 0;
    let _attempting = false;
    // Note: this client-side lockout is a UX measure only — it resets on page reload.
    // Real rate limiting is enforced server-side by Firebase Auth.

    async function attempt() {
        if (_attempting || Date.now() < _lockedUntil) return;
        _attempting = true;
        const name = nameSelect.value;
        // Strip non-alpha and lowercase to match normaliseSurname() in firebase-client.js
        const pw   = passwordInput.value.toLowerCase().replace(/[^a-z]/g, '');
        errorEl.classList.remove('visible');

        if (!gradeSelect.value) {
            errorEl.textContent = 'Please select your grade.';
            errorEl.classList.add('visible');
            gradeSelect.focus();
            return;
        }
        if (!name) {
            errorEl.textContent = 'Please select your name.';
            errorEl.classList.add('visible');
            return;
        }
        if (pw !== getSurname(name)) {
            _failCount++;
            if (_failCount >= 3) {
                _lockedUntil = Date.now() + 30_000;
                submitBtn.disabled = true;
                submitBtn.textContent = 'Try again in 30s';
                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign in →';
                    _failCount = 0;
                    _lockedUntil = 0;
                }, 30_000);
            }
            errorEl.textContent = 'Incorrect password. Please try again.';
            errorEl.classList.add('visible');
            passwordInput.value = '';
            passwordInput.focus();
            return;
        }
        lsSet(GRADE_KEY, gradeSelect.value);
        saveSession(name);
        // Authenticate with Firebase Auth so Firestore Security Rules can verify the session.
        // Must await before reloading — the page reload would otherwise cancel the async
        // network request before Firebase can save the auth token to IndexedDB.
        await ensureFirebaseSession(name);
        const redirect = new URLSearchParams(location.search).get('redirect');
        // Whitelist redirect values to prevent open-redirect. New redirect targets
        // require an entry here — the pattern catches them at compile time.
        const REDIRECT_MAP = { paycalc: './paycalc.html' };
        if (redirect && REDIRECT_MAP[redirect]) {
            window.location.replace(REDIRECT_MAP[redirect]);
        } else {
            window.location.reload();
        }
        // _attempting stays true — page is reloading; no need to reset.
    }

    submitBtn.addEventListener('click', () => { attempt().finally(() => { _attempting = false; }); });
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt().finally(() => { _attempting = false; }); });
}

// ---- Lightbox ----
// Exposed to module scope so the nav-panel drawer logo can open it (the header
// logo is a back button — see headerIcon handler below). Lifecycle, SW update
// status, bug link, and print button are the shared about-lightbox.js.
let openAboutLightbox = null;
(function() {
    const about = initAboutLightbox({
        appLabel: 'MYB Roster Admin',
        bugLinkId: 'adminBugReportLink',
        getUserName: () => currentUser || 'Unknown',
    });
    if (about) openAboutLightbox = about.open;

    // Header logo is a back-to-calendar button (About moved to the drawer logo).
    const headerIcon = document.getElementById('appIcon');
    if (!headerIcon) return;
    headerIcon.title = 'Back to calendar';
    headerIcon.setAttribute('aria-label', 'Back to calendar');
    headerIcon.addEventListener('click', () => { window.location.href = './index.html'; });
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
            title: 'Record a Shift',
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
                    { icon: '🤧', html: '<strong>Sickness</strong> — any number of days' },
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
                    { icon: '✏️', html: 'Tap any row to open it for editing — change the shift type or time, then tap <strong>Save changes</strong>' },
                    { icon: '🗑️', html: 'To remove a change, open it and tap <strong>Delete</strong> — the day goes back to the original scheduled shift' },
                ]},
                { heading: 'Sources', adminOnly: true, items: [
                    { icon: '📋', html: '<strong>Roster import</strong> entries came from a PDF upload — a new upload will replace them automatically without a warning' },
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
const fieldMember  = document.getElementById('fieldMember');
const fieldDate    = document.getElementById('fieldDate');
const prevWeekBtn  = document.getElementById('prevWeekBtn');
const nextWeekBtn  = document.getElementById('nextWeekBtn');
const weekGrid     = document.getElementById('weekGrid');
const saveBtn      = document.getElementById('saveBtn');
const formFeedback = document.getElementById('formFeedback');

// On desktop, move the member-context-bar into col-side as the first card.
// This replaces the full-width navy banner with a compact white sidebar card.
// Mobile layout is unaffected — the bar stays in its original HTML position
// (before col-main) when the viewport is < 1024px.
// Uses a matchMedia listener so layout corrects on resize (not just at load).
(function syncMemberBarToSidebar() {
    const mq  = window.matchMedia('(min-width: 1024px)');
    const bar = document.querySelector('.member-context-bar');
    if (!bar) return;
    const colMain = bar.parentElement;
    const colSide = document.querySelector('.col-side');
    if (!colMain || !colSide) return;

    function apply(isDesktop) {
        if (isDesktop) {
            colSide.insertBefore(bar, colSide.firstChild);
        } else {
            // colMain is .container; insert bar after the header, not before it
            const appHeader = colMain.querySelector('header.app-header');
            if (appHeader) {
                appHeader.after(bar);
            } else {
                colMain.insertBefore(bar, colMain.firstChild);
            }
        }
    }

    apply(mq.matches);
    mq.addEventListener('change', e => apply(e.matches));
})();

// ============================================
// POPULATE MEMBER DROPDOWNS
// ============================================
const roles = [...new Set(teamMembers.filter(m => !m.hidden).map(m => m.role))];

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
function _setSelectValue(sel, val) {
    for (const o of sel.options) if (o.value === val) { o.selected = true; return; }
}

// Restore last used member — prefer the shared cross-page key (written by both index and admin)
// so navigating between pages keeps the same person selected. Fall back to admin-only key.
// The member must still be SELECTABLE (exists AND not hidden): populateMemberDropdown omits
// hidden members, so a stale saved name pointing at a colleague who has since left or been
// hidden would set the <select> to a value with no matching <option> — leaving the STAFF
// MEMBER dropdown blank. Reject and clear stale names so the field falls back to a real
// member and the bad value can't recur. (v12.32)
const _savedMember = lsGet('myb_roster_selected_member') || lsGet('adminLastMember');
const lastMember = (_savedMember && teamMembers.find(m => m.name === _savedMember && !m.hidden))
    ? _savedMember : null;
if (lastMember) {
    _setSelectValue(fieldMember, lastMember);
    // Keep both keys in sync so the reverse journey (admin → index) always works
    lsSet('adminLastMember', lastMember);
    lsSet('myb_roster_selected_member', lastMember);
} else if (_savedMember) {
    // Stale (hidden/left) — drop both keys so the dropdown keeps its valid default
    lsDel('adminLastMember');
    lsDel('myb_roster_selected_member');
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
function markChanged() { userMadeChanges = true; }

// Warn browser/OS before closing or navigating away
window.addEventListener('beforeunload', e => {
    if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; }
});

// Pending navigation callback — set by confirmNavigate() when unsaved changes
// exist. Executed if the user taps "Discard and continue" in the banner.
let _pendingNavigate = null;
// Element focus returns to when the unsaved banner is dismissed without navigating.
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
    };
    if (confirmNavigate(go)) go();
}

document.getElementById('thisWeekBtn').addEventListener('click', () => {
    const go = () => { fieldDate.value = formatISO(new Date()); lastFieldDate = fieldDate.value; renderWeekGrid(); };
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

    let swipePanelPrev = null, swipePanelNext = null, swipePanelCurrent = null;
    let swipePanelWidth = 0, swipeStartX = 0, swipeStartY = 0, swipeStartTime = 0;
    let swipeListening = false, swipeDragging = false, swipeHapticFired = false, swipeCooldown = false;

    // Build a fully-functional adjacent week panel offset off-screen by delta weeks.
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
    prevWeekBtn.addEventListener('click', () => { if (!swipeCooldown) shiftWeek(-1); });
    nextWeekBtn.addEventListener('click', () => { if (!swipeCooldown) shiftWeek(+1); });
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
    const banner      = document.getElementById('alBanner');
    const remEl       = document.getElementById('alBannerRemaining');
    const takenEl     = document.getElementById('alBannerTaken');
    const bookedEl    = document.getElementById('alBannerBooked');
    const entEl       = document.getElementById('alBannerEntitlement');
    const warnEl      = document.getElementById('alBannerWarn');
    const memberName  = alMember.value;

    if (!memberName) {
        banner.hidden = true;
        const _hb = document.getElementById('alHeaderBalance');
        if (_hb) _hb.hidden = true;
        return;
    }

    const member      = teamMembers.find(m => m.name === memberName);
    if (!member)      { banner.hidden = true; return; }

    const yearStr     = alFrom.value ? alFrom.value.substring(0, 4) : (fieldDate.value ? fieldDate.value.substring(0, 4) : String(new Date().getFullYear()));
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

    remEl.textContent    = remaining;
    takenEl.textContent  = taken;
    bookedEl.textContent = booked;
    entEl.textContent    = entitlement;

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
        headerRemEl.textContent = remaining;
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

    const toSave = [], toDelete = [], errors = [];

    weekGrid.querySelectorAll('.day-row').forEach(row => {
        if (!row.dataset.type) {
            // Row was pre-filled with an existing override but user deactivated it → delete.
            if (row.dataset.existingId) toDelete.push(row.dataset.existingId);
            return;
        }
        // Pre-filled rows the user hasn't changed don't need re-saving.
        if (row.classList.contains('prefilled-existing')) return;

        const date    = row.dataset.date;
        const type    = row.dataset.type;

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
        const typeMeta    = TYPES[type];
        const startEl = row.querySelector('.day-start');
        const endEl   = row.querySelector('.day-end');
        const note    = '';

        let value;
        if (typeMeta && typeMeta.fixed) {
            value = typeMeta.fixedValue;
        } else {
            const s = startEl.value.trim();
            const e = endEl.value.trim();
            const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
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
            value = `${s}-${e}`;
        }

        toSave.push({ memberName, date, type, value, note, existingId: row.dataset.existingId || null });
    });

    if (errors.length)                    return showError('Missing times — ' + errors.join(' · '));
    if (!toSave.length && !toDelete.length) return showError('No changes to save.');

    // Validate shift duration and rest-gap rules
    const ruleErrors = validateShiftRules(toSave, memberName);
    if (ruleErrors.length) return showError(ruleErrors.join(' · '));

    // Annual leave entitlement warning
    const alInBatch = toSave.filter(e => e.type === 'annual_leave');
    if (alInBatch.length > 0) {
        const member      = teamMembers.find(m => m.name === memberName);
        // Use the year of the AL dates being saved, not the current calendar year
        const yearStr     = alInBatch[0].date.substring(0, 4);
        const entitlement = getALEntitlement(member, parseInt(yearStr, 10), getAllOverrides());
        // Count existing AL for this year, excluding days being overwritten (they're replaced, not added)
        const overwriteDates  = new Set(alInBatch.filter(e => e.existingId).map(e => e.date));
        // Also exclude days being purely deleted in this same batch (no replacement entry)
        const deletedALDates  = new Set(
            getAllOverrides()
                .filter(o => toDelete.includes(o.id) && o.type === 'annual_leave')
                .map(o => o.date)
        );
        // Sundays are uncontracted — exclude from entitlement counts
        const existingAL = getAllOverrides().filter(o =>
            o.memberName === memberName &&
            o.type       === 'annual_leave' &&
            o.date       && o.date.startsWith(yearStr) &&
            !overwriteDates.has(o.date) &&
            !deletedALDates.has(o.date) &&
            !isSunday(o.date)
        ).length;
        const newALDates = [...new Set(alInBatch.map(e => e.date).filter(d => d.startsWith(yearStr) && !isSunday(d)))];
        const projectedTotal = existingAL + newALDates.length;
        if (projectedTotal > entitlement) {
            const over = projectedTotal - entitlement;
            showALConfirm(
                `${memberName} will be ${over} day${over !== 1 ? 's' : ''} over their AL entitlement`,
                `${projectedTotal} days used of ${entitlement} allowed in ${yearStr}`,
                toSave,
                toDelete
            );
            return;
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
    renderWeekGrid();
});

// ── AL / sick — element handles and display helpers referenced by the member picker below ──
// Declared here because the fieldMember change handler references them.
const alMember   = document.getElementById('alMember');
const sickMember = document.getElementById('sickMember');
function syncMemberDisplay() {
    const memberDisplay = document.getElementById('alMemberDisplay');
    if (memberDisplay) memberDisplay.textContent = fieldMember.value || 'Select a staff member above';
}
function syncSickMemberDisplay() {
    const memberDisplay = document.getElementById('sickMemberDisplay');
    if (memberDisplay) memberDisplay.textContent = fieldMember.value || 'Select a staff member above';
}

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
        lsSet('adminLastMember', chosen);
        lsSet('myb_roster_selected_member', chosen);
        _setSelectValue(alMember, chosen);
        _setSelectValue(sickMember, chosen);
        syncMemberDisplay();
        syncSickMemberDisplay();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
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
    const btn        = e.target.closest('.btn-edit');
    if (!btn) return;
    const memberName = btn.dataset.member;
    const date       = btn.dataset.date;
    const go = () => {
        _setSelectValue(fieldMember, memberName);
        fieldDate.value   = date;
        lastFieldDate     = date;
        lsSet('adminLastMember', memberName);
        lsSet('myb_roster_selected_member', memberName);
        renderWeekGrid();
        document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    _setSelectValue(fieldMember, memberName);
    fieldDate.value   = date;
    lastFieldMember   = memberName;
    lastFieldDate     = date;
    _setSelectValue(alMember, memberName);
    _setSelectValue(sickMember, memberName);
    syncMemberDisplay();
    syncSickMemberDisplay();
    // Align the saved-changes month filter so the new days aren't filtered out.
    const monthFilter = document.getElementById('overridesMonthFilter');
    if (monthFilter) monthFilter.value = date.substring(0, 7);
    renderTable();
    renderWeekGrid();
    // The grid was rebuilt fresh from saved data — no pending edits remain.
    userMadeChanges = false;
}


// ============================================
// UTILITIES
// ============================================


let _toastTimer = null;
let _feedbackTimer = null;
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
let _alPendingSave   = null;
let _alPendingDelete = [];
const alConfirmBar       = document.getElementById('alConfirmBar');
const alConfirmMsg       = document.getElementById('alConfirmMsg');
const alConfirmSub       = document.getElementById('alConfirmSub');
const alConfirmSaveBtn   = document.getElementById('alConfirmSaveBtn');
const alConfirmCancelBtn = document.getElementById('alConfirmCancelBtn');

/**
 * Shows the AL over-entitlement confirmation bar with a warning and two options.
 * In the week editor path, pendingSave is the toSave array to resume with.
 * In the AL booking path, pendingSave is null — the bar re-triggers alSaveBtn.click().
 * @param {string}      msg          Main warning line
 * @param {string}      sub          Secondary detail line
 * @param {Array|null}  pendingSave  toSave batch to resume, or null for AL booking path
 * @param {string[]}    pendingDelete  IDs to delete in the same batch
 */
function showALConfirm(msg, sub, pendingSave, pendingDelete = []) {
    _alPendingSave   = pendingSave;
    _alPendingDelete = pendingDelete;
    alConfirmMsg.textContent = msg;
    alConfirmSub.textContent = sub;
    alConfirmBar.classList.add('visible');
    alConfirmSaveBtn.focus();
}
/** Hides the AL over-entitlement confirmation bar and clears pending save state. */
function hideALConfirm() {
    alConfirmBar.classList.remove('visible');
    _alPendingSave   = null;
    _alPendingDelete = [];
}

alConfirmSaveBtn.addEventListener('click', async () => {
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
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save changes';
});

// ============================================
// ANNUAL LEAVE BOOKING  (logic in admin-al.js)
// ============================================
initALSection({
    alMember,
    syncMemberDisplay,
    populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox,
    currentUser, showALConfirm, hideALConfirm, showInChangeAShift,
    showSuccess,
});

// ============================================
// SICK DAYS RECORDING  (logic in admin-sick.js)
// ============================================
initSickSection({
    sickMember,
    syncSickMemberDisplay, populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox, currentUser, showInChangeAShift,
    showSuccess,
});


/**
 * Deletes all overrides of the given type for a member within a date range.
 * Used by the period-row delete buttons in the AL and sick booked boxes.
 * @param {string}      type       'annual_leave' | 'sick'
 * @param {string}      memberName
 * @param {string}      start      YYYY-MM-DD — inclusive
 * @param {string}      end        YYYY-MM-DD — inclusive
 * @param {HTMLElement} feedbackEl Feedback div to write success/error into
 * @param {HTMLElement} btn        The delete button (disabled during the request)
 */
async function deletePeriodOverrides(type, memberName, start, end, feedbackEl, btn) {
    const toDelete = getAllOverrides().filter(o =>
        o.memberName === memberName &&
        o.date       >= start &&
        o.date       <= end &&
        // Also delete Sunday RD correction docs that recordRangeOverrides writes
        // alongside AL/sick overrides — otherwise the Sunday base shift reappears.
        (o.type === type || (o.type === 'correction' && o.value === 'RD' && isSunday(o.date)))
    );
    if (!toDelete.length) return;
    btn.disabled    = true;
    btn.textContent = '…';
    try {
        const batch = writeBatch(db);
        toDelete.forEach(o => batch.delete(doc(db, 'overrides', o.id)));
        await batch.commit();
        const ids = new Set(toDelete.map(o => o.id));
        setAllOverrides(getAllOverrides().filter(o => !ids.has(o.id)));
        renderTable();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
        if (feedbackEl) {
            const noun = type === 'annual_leave' ? 'AL day' : 'absence day';
            feedbackEl.textContent = `✓ Deleted ${toDelete.length} ${noun}${toDelete.length !== 1 ? 's' : ''} for ${memberName}`;
            feedbackEl.className = 'feedback success';
            setTimeout(() => { feedbackEl.className = 'feedback'; }, 6000);
        }
    } catch (err) {
        console.error('[Admin] Period delete failed:', err);
        if (feedbackEl) {
            const msg = err.code === 'unavailable'
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

function _addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return formatISO(d);
}

function _isRestGap(dateStr, memberObj) {
    if (isSunday(dateStr)) return true; // Sunday — uncontracted
    if (!memberObj) return false;
    const shift = getBaseShift(memberObj, new Date(dateStr + 'T12:00:00'));
    return isRestShift(shift);
}

function _fmtPeriodDate(d) {
    const dt = new Date(d + 'T12:00:00');
    return `${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;
}

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
    const periods   = [];
    let periodStart = dateList[0];
    let periodEnd   = dateList[0];
    let count       = 1;

    for (let i = 1; i < dateList.length; i++) {
        const prev = dateList[i - 1];
        const curr = dateList[i];
        let gapAllRest = true;
        let cursor = _addDays(prev, 1);
        while (cursor < curr) {
            if (!_isRestGap(cursor, memberObj)) { gapAllRest = false; break; }
            cursor = _addDays(cursor, 1);
        }
        if (gapAllRest) {
            periodEnd = curr;
            count++;
        } else {
            periods.push({ start: periodStart, end: periodEnd, count });
            periodStart = curr;
            periodEnd   = curr;
            count       = 1;
        }
    }
    periods.push({ start: periodStart, end: periodEnd, count });

    const byMonth = {};
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
                deletePeriodOverrides(type, memberName, p.start, p.end, feedbackEl, btn);
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

    // Non-admin: lock all member selectors to their own name
    _setSelectValue(fieldMember, currentUser);
    fieldMember.disabled  = true;
    syncMemberDisplay();
    _setSelectValue(alMember, currentUser);
    alMember.disabled     = true;
    _setSelectValue(sickMember, currentUser);
    sickMember.disabled   = true;
    lsSet('adminLastMember', currentUser);
    lsSet('myb_roster_selected_member', currentUser);

    // Reword card hints to use first-person language for self-service users
    const alHint   = document.querySelector('#alToggleHeader .hint');
    const sickHint = document.querySelector('#sickToggleHeader .hint');
    const savedHint = document.querySelector('#overridesToggleHeader .hint');
    if (alHint)    alHint.textContent   = 'Select a date range — rest days and Sundays are skipped automatically';
    if (sickHint)  sickHint.textContent = 'Record your own absence days — sickness, family, or any other reason';
    if (savedHint) savedHint.textContent = 'Your schedule changes — tap any row to edit or delete';

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
    if (printHeaderEl) printHeaderEl.innerHTML = `MYB Roster — ${escapeHtml(member)}<span class="print-sub">Week: ${escapeHtml(weekLabel)} · Printed: ${escapeHtml(now)}</span>`;
}
stampAdminPrintHeader();
window.addEventListener('beforeprint', stampAdminPrintHeader);

/**
 * One-time cleanup: deletes any annual_leave overrides that fall on a Sunday.
 * These can't be created any more but may exist from before v5.73.
 * Scans the in-memory cache (populated by loadOverrides) — no extra Firestore read.
 * Runs silently on admin page load; skipped after the first clean run.
 */
async function purgeSundayAL() {
    if (lsGet('purgeSundayAL_done') === '1') return;
    try {
        const toDelete = getAllOverrides().filter(o => o.type === 'annual_leave' && isSunday(o.date));

        if (!toDelete.length) {
            console.log('[purgeSundayAL] No Sunday AL overrides found — nothing to clean up.');
            lsSet('purgeSundayAL_done', '1');
            return;
        }

        const batch = writeBatch(db);
        toDelete.forEach(o => batch.delete(doc(db, 'overrides', o.id)));
        await batch.commit();

        console.log(`[purgeSundayAL] Removed ${toDelete.length} Sunday AL override${toDelete.length !== 1 ? 's' : ''}:`,
            toDelete.map(o => `${o.memberName} ${o.date}`));
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

if (!isAuthenticated) {
    // Show login overlay; do not load any Firestore data
    initLoginOverlay();
} else {
    // Returning user with a valid localStorage session never passes through the
    // login click handler, so re-establish the Firebase Auth session here.
    // Without this, auth.currentUser stays null and every Firestore write fails.
    // Stored on window so admin-auth.js can await it before "Set up accounts".
    window._mybSession = ensureFirebaseSession(currentUser);
    // All dropdowns are now populated — apply permissions then load data
    document.body.classList.add('auth-ready');
    applyPermissions();
    // Render bulk-bar type pills from PILL_TYPES (single source of truth with per-row pills)
    const _bulkPillsContainer = document.getElementById('bulkTypePills');
    if (_bulkPillsContainer) {
        _bulkPillsContainer.innerHTML = PILL_TYPES.map(t =>
            `<button class="type-pill-btn pill-${t}" data-type="${t}" aria-pressed="false">${TYPES[t].pill}</button>`
        ).join('');
    }
    initOverrides({
        currentUser,
        currentIsAdmin,
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

    // If arriving via deep-link (e.g. from the AL lightbox), open and scroll to the target card
    if (location.hash) {
        const target = document.querySelector(location.hash);
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
window._mybSession?.then(() => initErrorReporter());

// ── Navigation panel ─────────────────────────────────────────────────────────
initNavPanel({
    currentPage: 'admin',
    memberName:  currentUser,
    isAdmin:         currentIsAdmin,
    isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(currentUser),
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   () => { clearSession(); window.location.reload(); },
});

// Calendar pill in the nav drawer: write the current fieldDate month/year to
// localStorage before navigating so index.html opens on the same month the user
// was looking at in admin. (Replaces the removed header back button, v10.63.)
document.querySelector('.nav-panel-pill--calendar')?.addEventListener('click', () => {
    if (fieldDate.value) {
        const d = new Date(fieldDate.value + 'T12:00:00');
        lsSet('myb_roster_month', d.getMonth());     // 0-indexed, matches app.js
        lsSet('myb_roster_year',  d.getFullYear());
    }
    // Let the <a> navigate normally
});

