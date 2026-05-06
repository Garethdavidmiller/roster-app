/**
 * admin-app.js — Admin portal UI for admin.html.
 *
 * Owns: login flow, session management, override entry, week grid, bulk bar,
 *   roster PDF review pipeline, Firebase Auth sign-in/out, Team Week View.
 * Does NOT own: pay maths, calendar display (app.js), roster data (roster-data.js).
 * Edit here for: override forms, admin UI, week grid, override review.
 * Do not edit here for: roster data structure, pay calculator, shared CSS.
 */

import { CONFIG, teamMembers, DAY_KEYS, DAY_NAMES, MONTH_ABB, getALEntitlement, getSpecialDayBadges, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml, formatISO, isSunday, SWIPE_THRESHOLD, SWIPE_VELOCITY } from './roster-data.js?v=8.67';
import { db, collection, query, where, orderBy, limit, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, serverTimestamp, writeBatch, uploadHuddle, savePushSubscription, deletePushSubscription, auth, nameToEmail, signInWithEmailAndPassword, signOut as firebaseSignOut } from './firebase-client.js?v=8.67';
import { initRosterUpload } from './admin-roster-upload.js?v=8.67';
import { TYPES, getAllOverrides, setAllOverrides, initOverrides, loadOverrides, renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, renderTable, executeSave, validateShiftRules, getEffectiveShift, formatDisplay, resetBulkPills, updateSaveBtn } from './admin-overrides.js?v=8.67';

// ADMIN_VERSION reads from CONFIG which is set from APP_VERSION in roster-data.js — one source of truth.
const ADMIN_VERSION = CONFIG.APP_VERSION;

// ============================================
// AUTH — SESSION MANAGEMENT
// 30-day localStorage session.
// Passwords are surnames (lowercase) — sufficient
// to prevent casual misbehaviour, not cryptographic security.
// ============================================
const AUTH_KEY      = 'myb_admin_session';
const SESSION_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_VER   = 2; // bump to force all existing sessions to re-login

/**
 * Derive the login password from a staff member's display name.
 *
 * Rules (must stay in sync with how passwords were originally set):
 *  - Take everything after the first word (the initial + dot), e.g. "G. Miller" → "Miller"
 *  - Join multi-word surnames without spaces, e.g. "M. De Silva" → "DeSilva"
 *  - Lowercase the result
 *  - Strip ALL non-alpha characters: hyphens, apostrophes, spaces, accents, etc.
 *    e.g. "C. Francisco-Charles" → "franciscocharles"
 *    e.g. "O'Brien" → "obrien"
 *
 * WARNING: changing this function will lock out every staff member.
 * Any change must be accompanied by a password reset for all affected users.
 *
 * @param {string} fullName - Display name exactly as stored in teamMembers, e.g. "G. Miller"
 * @returns {string} Lowercase password with all non-alpha characters removed
 */
function getSurname(fullName) {
    return fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
}

// Allow ?logout in the URL to force-clear session (useful when the sign-out
// button is unreachable due to a broken or skipped login state).
if (new URLSearchParams(location.search).has('logout')) {
    localStorage.removeItem(AUTH_KEY);
    history.replaceState(null, '', location.pathname); // remove ?logout from URL
}

function getSession() {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (Date.now() > s.expiry) { localStorage.removeItem(AUTH_KEY); return null; }
        if ((s.ver || 1) < SESSION_VER) { localStorage.removeItem(AUTH_KEY); return null; }
        return s;
    } catch { return null; }
}

function saveSession(name) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({
        name,
        ver:    SESSION_VER,
        expiry: Date.now() + SESSION_MS
    }));
}

function clearSession() {
    localStorage.removeItem(AUTH_KEY);
    firebaseSignOut(auth).catch(() => {}); // fire-and-forget
}

// ---- Check session immediately ----
const currentSession = getSession();
const isAuthenticated = !!currentSession;
const currentUser     = currentSession?.name ?? null;
const currentIsAdmin  = CONFIG.ADMIN_NAMES.includes(currentUser);

// ---- Login overlay (shown when not authenticated) ----
function initLoginOverlay() {
    const overlay      = document.getElementById('loginOverlay');
    const nameSelect   = document.getElementById('loginName');
    const passwordInput = document.getElementById('loginPassword');
    const submitBtn    = document.getElementById('loginSubmit');
    const errorEl      = document.getElementById('loginError');

    if (!overlay) return;
    overlay.classList.add('visible');

    // Populate name dropdown — exclude hidden members (vacancies)
    const loginRoles = [...new Set(teamMembers.filter(m => !m.hidden).map(m => m.role))];
    loginRoles.forEach(role => {
        const grp = document.createElement('optgroup');
        grp.label = role;
        teamMembers.filter(m => m.role === role && !m.hidden).forEach(m => {
            grp.appendChild(new Option(m.name, m.name));
        });
        nameSelect.appendChild(grp);
    });

    async function attempt() {
        const name = nameSelect.value;
        const pw   = passwordInput.value.trim().toLowerCase();
        errorEl.classList.remove('visible');

        if (!name) {
            errorEl.textContent = 'Please select your name.';
            errorEl.classList.add('visible');
            return;
        }
        if (pw !== getSurname(name)) {
            errorEl.textContent = 'Incorrect password. Please try again.';
            errorEl.classList.add('visible');
            passwordInput.value = '';
            passwordInput.focus();
            return;
        }
        saveSession(name);
        // Authenticate with Firebase Auth so Firestore Security Rules can verify the session.
        // Must await before reloading — the page reload would otherwise cancel the async
        // network request before Firebase can save the auth token to IndexedDB.
        // Password is padded to 6+ chars to match what setupRosterAuth stored (Firebase minimum).
        const fbPassword = pw.length >= 6 ? pw : pw.padEnd(6, pw);
        try {
            await signInWithEmailAndPassword(auth, nameToEmail(name), fbPassword);
        } catch (e) {
            // Account may not exist yet — app still works via localStorage session.
            console.warn('[Auth] Firebase sign-in skipped:', e.code);
        }
        const redirect = new URLSearchParams(location.search).get('redirect');
        if (redirect === 'paycalc') {
            window.location.replace('./paycalc.html');
        } else {
            window.location.reload();
        }
    }

    submitBtn.addEventListener('click', attempt);
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
    nameSelect.addEventListener('change', () => {
        errorEl.classList.remove('visible');
        passwordInput.value = '';
        if (nameSelect.value) passwordInput.focus();
    });
}

// ---- Lightbox ----
(function() {
    const lightbox   = document.getElementById('iconLightbox');
    const headerIcon = document.getElementById('appIcon');
    const closeBtn   = document.getElementById('iconLightboxClose');
    const versionEl  = document.getElementById('lightboxVersion');
    const statusEl   = document.getElementById('lightboxUpdateStatus');
    const bugLink    = document.getElementById('adminBugReportLink');

    if (!lightbox || !headerIcon) return;

    if (versionEl) versionEl.textContent = ADMIN_VERSION;

    function checkUpdateStatus() {
        if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; }
    }

    function openLightbox() {
        checkUpdateStatus();
        if (bugLink) {
            const name   = currentUser || 'Unknown';
            const date   = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const ua     = navigator.userAgent;
            const body   = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster Admin v${ADMIN_VERSION}\nUser: ${name}\nDate: ${date}\nBrowser: ${ua}`;
            bugLink.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — MYB Roster Admin v${ADMIN_VERSION}`)}&body=${encodeURIComponent(body)}`;
        }
        lightbox.classList.add('visible');
        requestAnimationFrame(() => lightbox.classList.add('open'));
        document.addEventListener('keydown', onKey);
    }

    function closeLightbox() {
        lightbox.classList.remove('open');
        lightbox.addEventListener('transitionend', () => lightbox.classList.remove('visible'), { once: true });
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) { if (e.key === 'Escape') closeLightbox(); }

    headerIcon.addEventListener('click', openLightbox);

    // Click on overlay (not the card) closes
    lightbox.addEventListener('click', e => {
        if (e.target === lightbox || e.target === closeBtn) closeLightbox();
    });

    // Bug link opens mail app — stopPropagation prevents the overlay click handler closing the lightbox
    if (bugLink) bugLink.addEventListener('click', e => e.stopPropagation());
})();

// ---- Per-card tips lightbox ----
// Each card has a small ? button. Tapping it opens a focused lightbox
// with only the tips relevant to that card. Content lives here as data
// so the HTML stays clean.
(function() {
    const lb       = document.getElementById('tipsLightbox');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb) return;

    /** Tips content keyed by data-card attribute on each .btn-card-tips button. */
    const CARD_TIPS = {
        'change-shift': {
            title: 'Updating shifts',
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
                    { icon: '3️⃣', html: 'Tap <strong>3. Apply to selected days</strong>' },
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
        'cultural-calendar': {
            title: 'Cultural calendar',
            sections: [
                { items: [
                    { icon: '🌍', html: 'Shows key dates for the chosen tradition in the corner of matching days' },
                    { icon: '👁️', html: 'Visible to anyone who views that person\'s roster' },
                    { icon: 'ℹ️', html: 'Only one calendar can be active per person at a time' },
                ]},
            ],
        },
        'daily-huddle': {
            title: 'Daily Huddle',
            sections: [
                { items: [
                    { icon: '📋', html: 'Upload the day\'s Huddle briefing — staff see an orange <strong>Huddle</strong> button on the main app' },
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
                    { icon: '⚠️', html: 'If a day already has a <strong>manual override</strong> that differs from the PDF, it shows as a conflict — choose which to keep' },
                    { icon: '🔄', html: 'Old roster uploads are replaced automatically — only your manual changes show a warning if the new PDF disagrees' },
                ]},
            ],
        },
        'fip-travel': {
            title: 'FIP Travel',
            sections: [
                { items: [
                    { icon: '🃏', html: '<strong>FIP Card</strong> — gives you 50% off most European rail fares at station ticket offices' },
                    { icon: '🎟️', html: '<strong>Free Coupons</strong> — a small annual allowance of completely free journeys on partner railways and ferries' },
                    { icon: '👨‍👩‍👧', html: 'Both cover you, your spouse or partner, and dependent children' },
                    { icon: '✈️', html: 'Leisure travel only — not for commuting or any work purpose' },
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
                    { icon: '✏️', html: 'Tap any row to open it for editing — change the shift type, time, or note, then tap <strong>Save changes</strong>' },
                    { icon: '🗑️', html: 'To remove a change, open it and tap <strong>Delete</strong> — the day goes back to the original scheduled shift' },
                ]},
                { heading: 'Sources', adminOnly: true, items: [
                    { icon: '📋', html: '<strong>Roster import</strong> entries came from a PDF upload — a new upload will replace them automatically without a warning' },
                    { icon: '✍️', html: 'All other entries were added manually — a new PDF upload will flag them if it disagrees, so you can choose which to keep' },
                ]},
            ],
        },
    };

    function openTips(key) {
        const tips = CARD_TIPS[key];
        if (!tips || !titleEl || !bodyEl) return;
        lb.setAttribute('aria-label', tips.title);
        titleEl.textContent = tips.title;
        let html = '';
        for (const section of tips.sections) {
            if (section.adminOnly && !currentIsAdmin) continue;
            if (section.staffOnly &&  currentIsAdmin) continue;
            if (section.heading) html += `<div class="tips-lb-section">${section.heading}</div>`;
            for (const { icon, html: content, adminOnly, staffOnly } of section.items) {
                if (adminOnly && !currentIsAdmin) continue;
                if (staffOnly &&  currentIsAdmin) continue;
                html += `<div class="tips-lb-item"><span class="tips-lb-icon">${icon}</span><span>${content}</span></div>`;
            }
        }
        bodyEl.innerHTML = html;
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        document.addEventListener('keydown', onKey);
    }

    function closeTips() {
        lb.classList.remove('open');
        lb.addEventListener('transitionend', () => lb.classList.remove('visible'), { once: true });
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) { if (e.key === 'Escape') closeTips(); }

    // Wire every card's ? button — stopPropagation prevents collapsing the card
    document.querySelectorAll('.btn-card-tips').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openTips(btn.dataset.card);
        });
    });

    if (closeBtn) closeBtn.addEventListener('click', closeTips);
    lb.addEventListener('click', e => { if (e.target === lb) closeTips(); });
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
const shiftNote             = document.getElementById('shiftNote');

// On desktop, move the member-context-bar into col-side as the first card.
// This replaces the full-width navy banner with a compact white sidebar card.
// Mobile layout is unaffected — the bar stays in its original HTML position
// (before col-main) when the viewport is < 1024px.
(function syncMemberBarToSidebar() {
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const bar     = document.querySelector('.member-context-bar');
    const colSide = document.querySelector('.col-side');
    if (bar && colSide) colSide.insertBefore(bar, colSide.firstChild);
})();

// ============================================
// POPULATE MEMBER DROPDOWNS
// ============================================
const roles = [...new Set(teamMembers.filter(m => !m.hidden).map(m => m.role))];
roles.forEach(role => {
    const roleGroup = document.createElement('optgroup');
    roleGroup.label = role;
    teamMembers.filter(m => m.role === role && !m.hidden).forEach(m => {
        roleGroup.appendChild(new Option(m.name, m.name));
    });
    fieldMember.appendChild(roleGroup);
});

// Restore last used member — prefer the shared cross-page key (written by both index and admin)
// so navigating between pages keeps the same person selected. Fall back to admin-only key.
const lastMember = localStorage.getItem('myb_roster_selected_member') || localStorage.getItem('adminLastMember');
if (lastMember && teamMembers.find(m => m.name === lastMember)) {
    fieldMember.value = lastMember;
    // Keep both keys in sync so the reverse journey (admin → index) always works
    localStorage.setItem('adminLastMember', lastMember);
    localStorage.setItem('myb_roster_selected_member', lastMember);
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

(function initUnsavedBanner() {
    const banner      = document.getElementById('unsavedBanner');
    const discardBtn  = document.getElementById('unsavedDiscardBtn');
    const keepBtn     = document.getElementById('unsavedKeepBtn');
    if (!banner || !discardBtn || !keepBtn) return;

    discardBtn.addEventListener('click', () => {
        banner.style.display = 'none';
        userMadeChanges = false;
        if (_pendingNavigate) { const fn = _pendingNavigate; _pendingNavigate = null; fn(); }
    });
    keepBtn.addEventListener('click', () => {
        banner.style.display = 'none';
        _pendingNavigate = null;
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
        banner.style.display = 'flex';
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
            if (shiftNote) shiftNote.value = '';

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

    if (!memberName) { banner.hidden = true; return; }

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
    const batchNote = shiftNote ? shiftNote.value.trim() : '';

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

        // Sundays are uncontracted — AL cannot be saved on a Sunday regardless of how it was set
        if (type === 'annual_leave' && isSunday(date)) {
            row.classList.add('row-error');
            errors.push(`${formatDisplay(date)}: annual leave cannot be recorded on a Sunday`);
            return;
        }
        const typeMeta    = TYPES[type];
        const startEl = row.querySelector('.day-start');
        const endEl   = row.querySelector('.day-end');
        const note    = batchNote;

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
        const overwriteDates = new Set(alInBatch.filter(e => e.existingId).map(e => e.date));
        // Sundays are uncontracted — exclude from entitlement counts
        const existingAL = getAllOverrides().filter(o =>
            o.memberName === memberName &&
            o.type       === 'annual_leave' &&
            o.date       && o.date.startsWith(yearStr) &&
            !overwriteDates.has(o.date) &&
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


fieldMember.addEventListener('change', () => {
    const chosen = fieldMember.value;
    const go = () => {
        localStorage.setItem('adminLastMember', chosen);
        localStorage.setItem('myb_roster_selected_member', chosen);
        alMember.value   = chosen;
        sickMember.value = chosen;
        syncMemberDisplay();
        syncSickMemberDisplay();
        if (chosen && typeof window._loadReligiousSetting === 'function') window._loadReligiousSetting(chosen);
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        renderTable();
        renderWeekGrid();
    };
    if (confirmNavigate(go)) { go(); return; }
    // Revert the dropdown to the previously selected member while the banner waits
    fieldMember.value = localStorage.getItem('myb_roster_selected_member') || localStorage.getItem('adminLastMember') || '';
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
    const btn        = e.currentTarget;
    const memberName = btn.dataset.member;
    const date       = btn.dataset.date;
    const go = () => {
        fieldMember.value = memberName;
        fieldDate.value   = date;
        lastFieldDate     = date;
        localStorage.setItem('adminLastMember', memberName);
        localStorage.setItem('myb_roster_selected_member', memberName);
        renderWeekGrid();
        document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (confirmNavigate(go)) go();
}


// ============================================
// UTILITIES
// ============================================

// escapeHtml — imported from roster-data.js; local alias preserves existing call sites
const esc = escapeHtml;

let _toastTimer = null;
/** Shows a success message in the week editor feedback area.  @param {string} msg */
function showSuccess(msg) {
    formFeedback.className = 'feedback success';
    formFeedback.textContent = '✓ ' + msg;
    setTimeout(hideFeedback, 7000);

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
    formFeedback.className = 'feedback error';
    formFeedback.textContent = '⚠ ' + msg;
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
        // AL booking path — set confirmed flag then re-trigger booking
        _alBookingConfirmed = true;
        hideALConfirm();
        alSaveBtn.click();
    }
});

alConfirmCancelBtn.addEventListener('click', () => {
    hideALConfirm();
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Changes';
});

// ============================================
// ============================================
// INLINE DATE-RANGE PICKER
// ============================================
/**
 * Builds an inline date-range calendar inside #{prefix}RangePicker and wires
 * it to the hidden <input type="date"> elements #{prefix}From / #{prefix}To.
 * Returns { reset() } for post-save clearing.
 * @param {string} prefix  'al' | 'sick'
 */
function buildRangePicker(prefix) {
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const fromInput = document.getElementById(prefix + 'From');
    const toInput   = document.getElementById(prefix + 'To');
    const wrap      = document.getElementById(prefix + 'RangePicker');

    let fromISO  = '', toISO = '', hoverISO = '';
    let yr = new Date().getFullYear(), mo = new Date().getMonth();

    wrap.innerHTML = `
        <div class="rp-chips">
            <div class="rp-chip" id="${prefix}RpFrom">Choose start</div>
            <span class="rp-sep">→</span>
            <div class="rp-chip" id="${prefix}RpTo">Choose end</div>
            <button class="rp-clear" id="${prefix}RpClear" aria-label="Clear dates">✕</button>
        </div>
        <div class="rp-nav">
            <button class="rp-nav-btn" id="${prefix}RpPrev" aria-label="Previous month">‹</button>
            <span class="rp-label" id="${prefix}RpLabel"></span>
            <button class="rp-nav-btn" id="${prefix}RpNext" aria-label="Next month">›</button>
        </div>
        <div class="rp-grid" id="${prefix}RpGrid"></div>`;

    const chipFrom  = document.getElementById(prefix + 'RpFrom');
    const chipTo    = document.getElementById(prefix + 'RpTo');
    const clearBtn  = document.getElementById(prefix + 'RpClear');
    const label     = document.getElementById(prefix + 'RpLabel');
    const grid      = document.getElementById(prefix + 'RpGrid');

    document.getElementById(prefix + 'RpPrev').addEventListener('click', () => { if (--mo < 0) { mo = 11; yr--; } render(); });
    document.getElementById(prefix + 'RpNext').addEventListener('click', () => { if (++mo > 11) { mo = 0; yr++; } render(); });
    clearBtn.addEventListener('click', () => {
        fromISO = toISO = hoverISO = '';
        fromInput.value = toInput.value = '';
        toInput.dispatchEvent(new Event('change'));
        render();
        updateChips();
    });

    function fmt(iso) {
        const d = new Date(iso + 'T12:00:00');
        return `${DAY_NAMES[d.getDay()].slice(0,3)} ${d.getDate()} ${MONTH_ABB[d.getMonth()]}`;
    }

    function updateChips() {
        chipFrom.textContent = fromISO ? fmt(fromISO) : 'Choose start';
        chipFrom.classList.toggle('rp-chip-set', !!fromISO);
        chipTo.textContent   = toISO   ? fmt(toISO)   : 'Choose end';
        chipTo.classList.toggle('rp-chip-set', !!toISO);
        clearBtn.classList.toggle('visible', !!(fromISO || toISO));
    }

    function render() {
        label.textContent    = `${MONTHS[mo]} ${yr}`;
        const startOff       = (new Date(yr, mo, 1).getDay() + 6) % 7; // Mon = 0
        const daysInMonth    = new Date(yr, mo + 1, 0).getDate();
        const todayISO       = formatISO(new Date());
        const previewEnd     = !toISO && fromISO && hoverISO > fromISO ? hoverISO : toISO;

        grid.innerHTML = '';
        ['M','T','W','T','F','S','S'].forEach(d => {
            const el = document.createElement('div');
            el.className = 'rp-dow';
            el.textContent = d;
            grid.appendChild(el);
        });
        for (let i = 0; i < startOff; i++) {
            const el = document.createElement('div');
            el.className = 'rp-day rp-filler';
            grid.appendChild(el);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const el  = document.createElement('div');
            el.className  = 'rp-day';
            el.textContent = d;
            el.dataset.iso = iso;
            el.tabIndex    = 0;
            el.setAttribute('role', 'button');
            if (iso === todayISO) el.classList.add('rp-today');
            if (iso === fromISO)  el.classList.add('rp-from');
            if (iso === toISO)    el.classList.add('rp-to');
            if (fromISO && previewEnd && iso > fromISO && iso < previewEnd)
                el.classList.add(toISO ? 'rp-in-range' : 'rp-preview');
            if (!toISO && fromISO && iso === hoverISO && iso > fromISO)
                el.classList.add('rp-preview', 'rp-preview-end');
            grid.appendChild(el);
        }
    }

    function commit() {
        fromInput.value = fromISO;
        toInput.value   = toISO;
        if (toISO) toInput.dispatchEvent(new Event('change'));
        updateChips();
        render();
    }

    grid.addEventListener('click', e => {
        const cell = e.target.closest('[data-iso]');
        if (!cell) return;
        const iso = cell.dataset.iso;
        if (!fromISO || toISO)  { fromISO = iso; toISO = ''; }
        else if (iso < fromISO) { fromISO = iso; toISO = ''; }
        else                    { toISO   = iso; }
        hoverISO = '';
        commit();
    });

    grid.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
    });

    grid.addEventListener('mouseover', e => {
        if (!fromISO || toISO) return;
        const iso = e.target.closest('[data-iso]')?.dataset.iso || '';
        if (iso === hoverISO) return;
        hoverISO = iso;
        render();
    });

    grid.addEventListener('mouseleave', () => {
        if (!hoverISO) return;
        hoverISO = '';
        render();
    });

    render();
    updateChips();

    return {
        reset() {
            fromISO = toISO = hoverISO = '';
            yr = new Date().getFullYear();
            mo = new Date().getMonth();
            fromInput.value = toInput.value = '';
            toInput.dispatchEvent(new Event('change'));
            render();
            updateChips();
        }
    };
}

// ============================================
// ANNUAL LEAVE BOOKING
// ============================================
const alMember   = document.getElementById('alMember');
const alFrom     = document.getElementById('alFrom');
const alTo       = document.getElementById('alTo');
const alPreview  = document.getElementById('alPreview');
const alSaveBtn  = document.getElementById('alSaveBtn');
const alFeedback = document.getElementById('alFeedback');

// Populate alMember dropdown — same grouped list, excluding vacancies
roles.forEach(role => {
    const grp = document.createElement('optgroup');
    grp.label = role;
    teamMembers.filter(m => m.role === role && !m.hidden).forEach(m => {
        grp.appendChild(new Option(m.name, m.name));
    });
    alMember.appendChild(grp);
});

// Restore last used member
if (lastMember) alMember.value = lastMember;

// Helper: keep alMemberDisplay in sync with fieldMember
function syncMemberDisplay() {
    const memberDisplay = document.getElementById('alMemberDisplay');
    if (memberDisplay) memberDisplay.textContent = fieldMember.value || 'Select a staff member above';
}
syncMemberDisplay(); // set on page load

// Sync alMember with the main member picker (keep them in step)
alMember.addEventListener('change', () => {
    updateALBanner();
    updateALBookedBox();
    updateSickBookedBox();
    updateAlPreview();
    if (alMember.value) {
        fieldMember.value  = alMember.value;
        sickMember.value   = alMember.value;
        syncMemberDisplay();
        syncSickMemberDisplay();
        localStorage.setItem('adminLastMember', alMember.value);
        localStorage.setItem('myb_roster_selected_member', alMember.value);
        renderWeekGrid();
        renderTable();
    }
});

function getAlDates() {
    if (!alFrom.value || !alTo.value) return [];
    const from = new Date(alFrom.value + 'T12:00:00');
    const to   = new Date(alTo.value   + 'T12:00:00');
    if (to < from) return null; // invalid range
    const dates = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(formatISO(new Date(d)));
    }
    return dates;
}

function updateAlPreview() {
    const member = alMember.value;
    const dates  = getAlDates();

    if (!member) {
        alPreview.className = 'al-preview empty';
        alPreview.textContent = 'Select a staff member above.';
        alSaveBtn.disabled = true;
        return;
    }
    if (!alFrom.value || !alTo.value) {
        alPreview.className = 'al-preview empty';
        alPreview.textContent = 'Select a date range to see a preview.';
        alSaveBtn.disabled = true;
        return;
    }

    if (dates === null) {
        alPreview.className = 'al-preview error';
        alPreview.textContent = '"To" date must be on or after "From" date.';
        alSaveBtn.disabled = true;
        return;
    }

    if (dates.length > 60) {
        alPreview.className = 'al-preview error';
        alPreview.textContent = `That's ${dates.length} days — maximum range is 60 days.`;
        alSaveBtn.disabled = true;
        return;
    }

    const fromDisp = formatDisplay(dates[0]);
    const toDisp   = formatDisplay(dates[dates.length - 1]);
    const rangeStr = dates.length === 1 ? fromDisp : `${fromDisp} – ${toDisp}`;

    // Count rest days (RD/OFF) in the range to warn the user.
    // Checks both the base roster and any existing RD/OFF Firestore overrides so the
    // preview matches what the booking will actually skip.
    const memberObj = teamMembers.find(m => m.name === member);
    let restCount  = 0;
    let spareCount = 0; // spare days that will be booked as AL (not already overridden to RD)
    if (memberObj) {
        dates.forEach(dateStr => {
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') { restCount++; return; }
            // Also treat existing RD/OFF overrides as rest days (same logic as the booking filter)
            const ov = getAllOverrides().find(o => o.memberName === memberObj.name && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) { restCount++; return; }
            // Sundays are uncontracted for all staff — skip, don't book AL
            if (isSunday(dateStr)) { restCount++; return; }
            if (base === 'SPARE') spareCount++;
        });
    }
    const workDays  = dates.length - restCount;
    const label     = workDays === 1 ? '1 working day' : `${workDays} working day${workDays !== 1 ? 's' : ''}`;
    const restNote  = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';
    // Warn for CEA/CES when spare days will be booked as AL: prompt admin to add RDs first if needed
    const isSpareRole = memberObj && (memberObj.role === 'CEA' || memberObj.role === 'CES');
    const spareNote = (isSpareRole && spareCount > 0)
        ? `<br><em>⚠ Includes ${spareCount} spare day${spareCount !== 1 ? 's' : ''}. For shifts over 7h, add RD corrections in the week editor first to reduce to 4 AL days.</em>`
        : '';

    alPreview.className = 'al-preview ready';
    alPreview.innerHTML = `🏖️ <strong>${label}</strong> of Annual Leave for ${esc(member)}: ${rangeStr}${restNote}${spareNote}`;
    alSaveBtn.disabled = workDays === 0;
}

alFrom.addEventListener('change', () => { updateAlPreview(); updateALBanner(); updateALBookedBox(); });
alTo.addEventListener('change',   () => { updateAlPreview(); updateALBanner(); updateALBookedBox(); });
const alPicker = buildRangePicker('al');
updateAlPreview();

let _alBookingConfirmed = false;
alSaveBtn.addEventListener('click', async () => {
    const member = alMember.value;
    const dates  = getAlDates();
    if (!member || !dates || !dates.length) return;

    // Annual leave entitlement check (skip if user already confirmed via the bar)
    const memberObj = teamMembers.find(m => m.name === member);
    if (!_alBookingConfirmed) {
        // Use the year from the booking dates, not the current calendar year
        const yearStr        = alFrom.value ? alFrom.value.substring(0, 4) : String(new Date().getFullYear());
        const entitlement    = getALEntitlement(memberObj, parseInt(yearStr, 10), getAllOverrides());
        // Sundays are uncontracted — exclude from entitlement counts
        const existingAL     = getAllOverrides().filter(o =>
            o.memberName === member &&
            o.type       === 'annual_leave' &&
            o.date       && o.date.startsWith(yearStr) && !isSunday(o.date)
        ).length;
        const newALInYear    = dates.filter(d => d.startsWith(yearStr) && !isSunday(d)).length;
        const projectedTotal = existingAL + newALInYear;
        if (projectedTotal > entitlement) {
            const over = projectedTotal - entitlement;
            showALConfirm(
                `${member} will be ${over} day${over !== 1 ? 's' : ''} over their AL entitlement`,
                `${projectedTotal} days used of ${entitlement} allowed in ${yearStr}`,
                null // null = AL booking path (not week editor)
            );
            return;
        }
    }
    _alBookingConfirmed = false; // reset after use

    alFeedback.className = 'feedback';
    alSaveBtn.disabled    = true;
    alSaveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

    // Filter out rest days and Sundays — Sundays are uncontracted for all staff.
    // Also skips base-roster RDs/OFFs and existing RD/OFF overrides.
    const workingDates = memberObj
        ? dates.filter(dateStr => {
            if (isSunday(dateStr)) return false;
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') return false;
            const ov = getAllOverrides().find(o => o.memberName === member && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) return false;
            return true;
          })
        : dates;

    if (!workingDates.length) {
        alFeedback.className = 'feedback error';
        alFeedback.textContent = '⚠ No working days in that range — nothing to record.';
        alSaveBtn.disabled    = false;
        alSaveBtn.textContent = 'Record annual leave';
        return;
    }

    try {
        const alNewDocs    = [];   // track new docs for in-memory update
        const alDeletedIds = new Set();
        const alBatch      = writeBatch(db);
        workingDates.forEach(date => {
            // Overwrite any existing override for this member+date
            const existing = getAllOverrides().find(o => o.memberName === member && o.date === date);
            if (existing) { alBatch.delete(doc(db, 'overrides', existing.id)); alDeletedIds.add(existing.id); }
            const newRef = doc(collection(db, 'overrides'));
            alBatch.set(newRef, {
                memberName: member,
                date,
                type:      'annual_leave',
                value:     'AL',
                note:      '',
                source:    'manual',
                createdAt: serverTimestamp(),
                changedBy: currentUser
            });
            // Capture the new ID so we can update allOverrides without a round-trip
            alNewDocs.push({ id: newRef.id, memberName: member, date, type: 'annual_leave', value: 'AL', source: 'manual', note: '', createdAt: new Date() });
        });
        await alBatch.commit();

        alFeedback.className = 'feedback success';
        alFeedback.textContent = `✓ Recorded ${workingDates.length} day${workingDates.length > 1 ? 's' : ''} of Annual Leave for ${member}`;
        setTimeout(() => { alFeedback.className = 'feedback'; }, 7000);

        alPicker.reset();
        updateAlPreview();

        // Update in-memory cache — no Firestore round-trip needed
        const alUpdated = getAllOverrides().filter(o => !alDeletedIds.has(o.id));
        alUpdated.push(...alNewDocs);
        alUpdated.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setAllOverrides(alUpdated);
        renderTable();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
    } catch (err) {
        console.error('[Admin] AL save failed:', err);
        alFeedback.className = 'feedback error';
        alFeedback.textContent = '⚠ Could not save — check your connection and try again.';
    } finally {
        alSaveBtn.disabled    = false;
        alSaveBtn.textContent = 'Record annual leave';
    }
});

// ============================================
// SICK DAYS RECORDING
// ============================================
const sickMember   = document.getElementById('sickMember');
const sickFrom     = document.getElementById('sickFrom');
const sickTo       = document.getElementById('sickTo');
const sickPreview  = document.getElementById('sickPreview');
const sickSaveBtn  = document.getElementById('sickSaveBtn');
const sickFeedback = document.getElementById('sickFeedback');

// Populate sickMember dropdown (hidden, mirrors fieldMember)
roles.forEach(role => {
    const grp = document.createElement('optgroup');
    grp.label = role;
    teamMembers.filter(m => m.role === role && !m.hidden).forEach(m => {
        grp.appendChild(new Option(m.name, m.name));
    });
    sickMember.appendChild(grp);
});
if (lastMember) sickMember.value = lastMember;

/** Keep the sick section's read-only member display in sync with fieldMember. */
function syncSickMemberDisplay() {
    const memberDisplay = document.getElementById('sickMemberDisplay');
    if (memberDisplay) memberDisplay.textContent = fieldMember.value || 'Select a staff member above';
}
syncSickMemberDisplay();

/**
 * Returns an array of ISO date strings from sickFrom to sickTo inclusive,
 * or null if the range is invalid (to < from), or [] if either input is empty.
 * Maximum range is 60 days.
 * @returns {string[]|null}
 */
function getSickDates() {
    if (!sickFrom.value || !sickTo.value) return [];
    const from = new Date(sickFrom.value + 'T12:00:00');
    const to   = new Date(sickTo.value   + 'T12:00:00');
    if (to < from) return null;
    const dates = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(formatISO(new Date(d)));
    }
    return dates;
}

/** Refreshes the preview message and enables/disables the save button. */
function updateSickPreview() {
    const member = sickMember.value;
    const dates  = getSickDates();

    if (!member) {
        sickPreview.className = 'al-preview sick-preview empty';
        sickPreview.textContent = 'Select a staff member above.';
        sickSaveBtn.disabled = true;
        return;
    }
    if (!sickFrom.value || !sickTo.value) {
        sickPreview.className = 'al-preview sick-preview empty';
        sickPreview.textContent = 'Select a date range to see a preview.';
        sickSaveBtn.disabled = true;
        return;
    }

    if (dates === null) {
        sickPreview.className = 'al-preview sick-preview error';
        sickPreview.textContent = '"Last absence day" must be on or after "First absence day".';
        sickSaveBtn.disabled = true;
        return;
    }

    const from  = new Date(sickFrom.value + 'T12:00:00');
    const maxTo = new Date(from);
    maxTo.setMonth(maxTo.getMonth() + 6);
    const to    = new Date(sickTo.value   + 'T12:00:00');
    if (to > maxTo) {
        sickPreview.className = 'al-preview sick-preview error';
        sickPreview.textContent = 'Maximum range is 6 months.';
        sickSaveBtn.disabled = true;
        return;
    }

    const fromDisp = formatDisplay(dates[0]);
    const toDisp   = formatDisplay(dates[dates.length - 1]);
    const rangeStr = dates.length === 1 ? fromDisp : `${fromDisp} – ${toDisp}`;

    // Count rest days in the range — they will be skipped.
    // Sundays are always skipped (uncontracted for all staff).
    const memberObj = teamMembers.find(m => m.name === member);
    let restCount = 0;
    if (memberObj) {
        dates.forEach(dateStr => {
            if (isSunday(dateStr)) { restCount++; return; }
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') { restCount++; return; }
            const ov = getAllOverrides().find(o => o.memberName === memberObj.name && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) restCount++;
        });
    }
    const workDays = dates.length - restCount;
    const label    = workDays === 1 ? '1 absence day' : `${workDays} absence days`;
    const restNote = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';

    sickPreview.className = 'al-preview sick-preview ready';
    sickPreview.innerHTML = `🪑 <strong>${label}</strong> for ${esc(member)}: ${rangeStr}${restNote}`;
    sickSaveBtn.disabled = workDays === 0;
}

sickFrom.addEventListener('change', () => { updateSickPreview(); updateSickBookedBox(); });
sickTo.addEventListener('change',   () => { updateSickPreview(); updateSickBookedBox(); });
const sickPicker = buildRangePicker('sick');
updateSickPreview();

sickSaveBtn.addEventListener('click', async () => {
    const member = sickMember.value;
    const dates  = getSickDates();
    if (!member || !dates || !dates.length) return;

    const memberObj    = teamMembers.find(m => m.name === member);
    // Sundays are uncontracted — never record sick on a Sunday
    const workingDates = memberObj
        ? dates.filter(dateStr => {
            if (isSunday(dateStr)) return false;
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') return false;
            const ov = getAllOverrides().find(o => o.memberName === member && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) return false;
            return true;
          })
        : dates;

    if (!workingDates.length) {
        sickFeedback.className = 'feedback error';
        sickFeedback.textContent = '⚠ No working days in that range — nothing to record.';
        return;
    }

    sickFeedback.className = 'feedback';
    sickSaveBtn.disabled    = true;
    sickSaveBtn.textContent = `Saving ${workingDates.length} day${workingDates.length > 1 ? 's' : ''}…`;

    try {
        const sickNewDocs    = [];
        const sickDeletedIds = new Set();
        const sickBatch      = writeBatch(db);
        workingDates.forEach(date => {
            const existing = getAllOverrides().find(o => o.memberName === member && o.date === date);
            if (existing) { sickBatch.delete(doc(db, 'overrides', existing.id)); sickDeletedIds.add(existing.id); }
            const newRef = doc(collection(db, 'overrides'));
            sickBatch.set(newRef, {
                memberName: member,
                date,
                type:      'sick',
                value:     'SICK',
                note:      '',
                source:    'manual',
                createdAt: serverTimestamp(),
                changedBy: currentUser
            });
            sickNewDocs.push({ id: newRef.id, memberName: member, date, type: 'sick', value: 'SICK', source: 'manual', note: '', createdAt: new Date() });
        });
        await sickBatch.commit();

        sickFeedback.className = 'feedback success';
        sickFeedback.textContent = `✓ Recorded ${workingDates.length} absence day${workingDates.length > 1 ? 's' : ''} for ${member}`;
        setTimeout(() => { sickFeedback.className = 'feedback'; }, 7000);

        sickPicker.reset();
        updateSickPreview();

        // Update in-memory cache — no Firestore round-trip needed
        const sickUpdated = getAllOverrides().filter(o => !sickDeletedIds.has(o.id));
        sickUpdated.push(...sickNewDocs);
        sickUpdated.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setAllOverrides(sickUpdated);
        renderTable();
        updateSickBookedBox();
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
    } catch (err) {
        console.error('[Admin] Sick save failed:', err);
        sickFeedback.className = 'feedback error';
        sickFeedback.textContent = '⚠ Could not save — check your connection and try again.';
    } finally {
        sickSaveBtn.disabled    = false;
        sickSaveBtn.textContent = 'Record absence';
    }
});

/**
 * Refreshes the collapsible list of recorded sick days for the selected member.
 * Shows sick periods grouped by month, merging consecutive dates that are
 * bridged by rest days on the base roster (same logic as AL booked box).
 */
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
        o.type       === type &&
        o.date       >= start &&
        o.date       <= end
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
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
        if (feedbackEl) {
            const msg = err.code === 'unavailable'
                ? '⚠ You appear to be offline — reconnect and try again.'
                : '⚠ Delete failed — check your connection and try again.';
            feedbackEl.textContent = msg;
            feedbackEl.className = 'feedback error';
        }
    }
}

function updateSickBookedBox() {
    const box  = document.getElementById('sickBookedBox');
    const body = document.getElementById('sickBookedBody');
    if (!box || !body) return;

    const memberName = sickMember.value;
    if (!memberName) { box.hidden = true; return; }

    const entries = getAllOverrides().filter(o =>
        o.memberName === memberName &&
        o.type       === 'sick' &&
        o.date
    ).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

    if (!entries.length) { box.hidden = true; return; }

    const memberObj  = teamMembers.find(m => m.name === memberName);
    const sickDateSet = new Set(entries.map(e => e.date));

    function addDays(dateStr, n) {
        const d = new Date(dateStr + 'T12:00:00');
        d.setDate(d.getDate() + n);
        return formatISO(d);
    }
    function isRestGap(dateStr) {
        if (new Date(dateStr + 'T12:00:00').getDay() === 0) return true; // Sunday — uncontracted
        if (!memberObj) return false;
        const shift = getBaseShift(memberObj, new Date(dateStr + 'T12:00:00'));
        return shift === 'RD' || shift === 'OFF';
    }
    function fmtDate(d) {
        const dt = new Date(d + 'T12:00:00');
        return `${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;
    }
    function fmtRange(start, end) {
        const ds = new Date(start + 'T12:00:00');
        const de = new Date(end   + 'T12:00:00');
        if (ds.getMonth() === de.getMonth()) {
            return `${DAY_NAMES[ds.getDay()]} ${ds.getDate()} – ${DAY_NAMES[de.getDay()]} ${de.getDate()} ${MONTH_ABB[de.getMonth()]}`;
        }
        return `${fmtDate(start)} – ${fmtDate(end)}`;
    }

    // Sundays excluded from count (uncontracted) but still bridge via isRestGap
    const dateList = [...sickDateSet].filter(d => !isSunday(d)).sort();
    const periods  = [];
    let periodStart = dateList[0];
    let periodEnd   = dateList[0];
    let count       = 1;
    for (let i = 1; i < dateList.length; i++) {
        const prev = dateList[i - 1];
        const curr = dateList[i];
        let gapAllRest = true;
        let cursor = addDays(prev, 1);
        while (cursor < curr) {
            if (!isRestGap(cursor)) { gapAllRest = false; break; }
            cursor = addDays(cursor, 1);
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

    // Render — use createElement so delete buttons can have direct event listeners
    body.innerHTML = '';
    const sickFeedbackEl = document.getElementById('sickFeedback');
    for (const key of Object.keys(byMonth).sort()) {
        const [yr, mo] = key.split('-');
        const monthDiv = document.createElement('div');
        monthDiv.className = 'al-period-month';
        monthDiv.innerHTML = `<div class="al-period-month-hdr">${MONTH_ABB[parseInt(mo, 10) - 1]} ${yr}</div>`;
        for (const p of byMonth[key]) {
            const dateStr  = p.start === p.end ? fmtDate(p.start) : fmtRange(p.start, p.end);
            const countStr = `${p.count} absence day${p.count !== 1 ? 's' : ''}`;
            const row = document.createElement('div');
            row.className = 'al-period-row';
            row.innerHTML = `<span class="al-period-dates">${dateStr}</span>`;
            const meta = document.createElement('div');
            meta.className = 'al-period-row-meta';
            meta.innerHTML = `<span class="sick-period-count">${countStr}</span>`;
            const btn = document.createElement('button');
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
                deletePeriodOverrides('sick', memberName, p.start, p.end, sickFeedbackEl, btn);
            });
            meta.appendChild(btn);
            row.appendChild(meta);
            monthDiv.appendChild(row);
        }
        body.appendChild(monthDiv);
    }
    box.hidden = false;
}

(function initSickBookedToggle() {
    const toggle  = document.getElementById('sickBookedToggle');
    const body    = document.getElementById('sickBookedBody');
    const chevron = document.getElementById('sickBookedChevron');
    if (!toggle || !body || !chevron) return;
    toggle.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// INIT — runs last so all dropdowns are populated
// ============================================
document.getElementById('signOutBtn').addEventListener('click', () => {
    clearSession();
    window.location.reload();
});

// ← Roster button: write the current fieldDate month/year to localStorage before
// navigating so index.html opens on the same month the user was looking at in admin.
document.querySelector('.btn-back').addEventListener('click', e => {
    if (fieldDate.value) {
        const d = new Date(fieldDate.value + 'T12:00:00');
        localStorage.setItem('myb_roster_month', d.getMonth());     // 0-indexed, matches app.js
        localStorage.setItem('myb_roster_year',  d.getFullYear());
    }
    // Let the <a> navigate normally
});

function applyPermissions() {
    if (currentIsAdmin) return; // full access — nothing to restrict

    // Non-admin: lock all member selectors to their own name
    fieldMember.value     = currentUser;
    fieldMember.disabled  = true;
    syncMemberDisplay();
    alMember.value        = currentUser;
    alMember.disabled     = true;
    sickMember.value      = currentUser;
    sickMember.disabled   = true;
    localStorage.setItem('adminLastMember', currentUser);
    localStorage.setItem('myb_roster_selected_member', currentUser);

    // Reword card hints to use first-person language for self-service users
    const alHint   = document.querySelector('#alToggleHeader .hint');
    const sickHint = document.querySelector('#sickToggleHeader .hint');
    const savedHint = document.querySelector('#overridesToggleHeader .hint');
    if (alHint)    alHint.textContent   = 'Select a date range — rest days and Sundays are skipped automatically';
    if (sickHint)  sickHint.textContent = 'Record your own absence days — sickness, family, or any other reason';
    if (savedHint) savedHint.textContent = 'Your schedule changes — tap any row to edit or delete';
}

// ============================================
// ANNUAL LEAVE — booked dates collapsible box
// ============================================
function updateALBookedBox() {
    const box  = document.getElementById('alBookedBox');
    const body = document.getElementById('alBookedBody');
    if (!box || !body) return;

    const memberName = alMember.value;
    if (!memberName) { box.hidden = true; return; }

    const entries = getAllOverrides().filter(o =>
        o.memberName === memberName &&
        o.type       === 'annual_leave' &&
        o.date
    ).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

    if (!entries.length) { box.hidden = true; return; }

    const memberObj = teamMembers.find(m => m.name === memberName);
    const alDateSet = new Set(entries.map(e => e.date));

    /**
     * Return a date string N days after the given date string.
     * @param {string} dateStr YYYY-MM-DD
     * @param {number} n
     * @returns {string}
     */
    function addDays(dateStr, n) {
        const d = new Date(dateStr + 'T12:00:00');
        d.setDate(d.getDate() + n);
        return formatISO(d);
    }

    /**
     * Return true if the date is a non-working day and should bridge AL periods.
     * Sundays are always a rest gap (uncontracted for all staff).
     * @param {string} dateStr YYYY-MM-DD
     * @returns {boolean}
     */
    function isRestGap(dateStr) {
        if (new Date(dateStr + 'T12:00:00').getDay() === 0) return true; // Sunday — uncontracted
        if (!memberObj) return false;
        const shift = getBaseShift(memberObj, new Date(dateStr + 'T12:00:00'));
        return shift === 'RD' || shift === 'OFF';
    }

    /**
     * Format a date string as "Mon 9 Mar".
     * @param {string} d YYYY-MM-DD
     * @returns {string}
     */
    function fmtDate(d) {
        const dt = new Date(d + 'T12:00:00');
        return `${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;
    }

    /**
     * Format a date range. Same-month ranges omit the month on the start date:
     * "Mon 9 – Fri 13 Mar". Cross-month ranges show both: "Mon 30 Mar – Wed 1 Apr".
     * @param {string} start YYYY-MM-DD
     * @param {string} end   YYYY-MM-DD
     * @returns {string}
     */
    function fmtRange(start, end) {
        const ds = new Date(start + 'T12:00:00');
        const de = new Date(end   + 'T12:00:00');
        if (ds.getMonth() === de.getMonth()) {
            return `${DAY_NAMES[ds.getDay()]} ${ds.getDate()} – ${DAY_NAMES[de.getDay()]} ${de.getDate()} ${MONTH_ABB[de.getMonth()]}`;
        }
        return `${fmtDate(start)} – ${fmtDate(end)}`;
    }

    // Merge sorted AL dates into consecutive periods, bridging gaps that are
    // entirely rest days on the base roster. Sundays are excluded from the count
    // (uncontracted) but still act as bridge days via isRestGap.
    const dateList = [...alDateSet].filter(d => !isSunday(d)).sort();
    const periods  = []; // { start, end, count }
    let periodStart = dateList[0];
    let periodEnd   = dateList[0];
    let count       = 1;

    for (let i = 1; i < dateList.length; i++) {
        const prev = dateList[i - 1];
        const curr = dateList[i];

        // Walk every day in the gap; if all are rest days, the period continues
        let gapAllRest = true;
        let cursor = addDays(prev, 1);
        while (cursor < curr) {
            if (!isRestGap(cursor)) { gapAllRest = false; break; }
            cursor = addDays(cursor, 1);
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

    // Group periods by the month of their start date
    const byMonth = {};
    for (const p of periods) {
        const key = p.start.slice(0, 7); // "YYYY-MM"
        (byMonth[key] = byMonth[key] || []).push(p);
    }

    // Render — use createElement so delete buttons can have direct event listeners
    body.innerHTML = '';
    const alFeedbackEl = document.getElementById('alFeedback');
    for (const key of Object.keys(byMonth).sort()) {
        const [yr, mo] = key.split('-');
        const monthDiv = document.createElement('div');
        monthDiv.className = 'al-period-month';
        monthDiv.innerHTML = `<div class="al-period-month-hdr">${MONTH_ABB[parseInt(mo, 10) - 1]} ${yr}</div>`;
        for (const p of byMonth[key]) {
            const dateStr  = p.start === p.end ? fmtDate(p.start) : fmtRange(p.start, p.end);
            const countStr = `${p.count} day${p.count !== 1 ? 's' : ''} AL`;
            const row = document.createElement('div');
            row.className = 'al-period-row';
            row.innerHTML = `<span class="al-period-dates">${dateStr}</span>`;
            const meta = document.createElement('div');
            meta.className = 'al-period-row-meta';
            meta.innerHTML = `<span class="al-period-count">${countStr}</span>`;
            const btn = document.createElement('button');
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
                deletePeriodOverrides('annual_leave', memberName, p.start, p.end, alFeedbackEl, btn);
            });
            meta.appendChild(btn);
            row.appendChild(meta);
            monthDiv.appendChild(row);
        }
        body.appendChild(monthDiv);
    }
    box.hidden = false;
}

(function initALBookedToggle() {
    const toggle  = document.getElementById('alBookedToggle');
    const body    = document.getElementById('alBookedBody');
    const chevron = document.getElementById('alBookedChevron');
    if (!toggle || !body || !chevron) return;
    toggle.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// ANNUAL LEAVE CARD — collapse/expand
// ============================================
(function initALCard() {
    const header  = document.getElementById('alToggleHeader');
    const body    = document.getElementById('alBody');
    const chevron = document.getElementById('alChevron');
    if (!header || !body || !chevron) return;
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// SICK DAYS CARD — collapse/expand
// ============================================
(function initSickCard() {
    const header  = document.getElementById('sickToggleHeader');
    const body    = document.getElementById('sickBody');
    const chevron = document.getElementById('sickChevron');
    if (!header || !body || !chevron) return;
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// Month filter re-renders the table when changed
if (overridesMonthFilter) {
    overridesMonthFilter.addEventListener('change', renderTable);
}

// ============================================
// FIP TRAVEL CARD — collapse/expand
// ============================================
(function initFipCard() {
    const header  = document.getElementById('fipToggleHeader');
    const body    = document.getElementById('fipBody');
    const chevron = document.getElementById('fipChevron');
    if (!header || !body || !chevron) return;
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// EXISTING OVERRIDES CARD — collapse/expand
// ============================================
(function initOverridesCard() {
    const header  = document.getElementById('overridesToggleHeader');
    const body    = document.getElementById('overridesBody');
    const chevron = document.getElementById('overridesChevron');
    if (!header || !body || !chevron) return;
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// CULTURAL CALENDAR CARD — collapse/expand + Firestore opt-in
// ============================================
(function initReligiousCard() {
    const header     = document.getElementById('religiousToggleHeader');
    const body       = document.getElementById('religiousBody');
    const chevron    = document.getElementById('religiousChevron');
    const saved      = document.getElementById('religiousSaved');
    const disclaimer = document.getElementById('calendarDisclaimer');
    const activeTag  = document.getElementById('calendarActiveTag');
    const radios     = document.querySelectorAll('input[name="faithCalendar"]');
    if (!header || !body || !chevron || !saved || !radios.length) return;

    // Human-readable names for each calendar option.
    const CALENDAR_NAMES = {
        islamic:    '🌙 Islamic',
        hindu:      '🪔 Hindu',
        chinese:    '🧧 Chinese',
        jamaican:   '🇯🇲 Jamaican',
        congolese:  '🇨🇩 Congolese',
        portuguese: '🇵🇹 Portuguese',
    };

    // Update the "active calendar" tag shown in the card header.
    function updateActiveTag(value) {
        if (!activeTag) return;
        if (value && value !== 'none') {
            activeTag.textContent = (CALENDAR_NAMES[value] || value) + ' active';
            activeTag.style.display = '';
        } else {
            activeTag.style.display = 'none';
        }
    }

    // Disclaimer text per calendar — shown only for the active selection.
    const DISCLAIMERS = {
        islamic:  'Islamic dates follow the Umm al-Qura calendar (±1 day — actual dates depend on moon-sighting). Mawlid al-Nabi is observed by most UK Muslim communities but not all denominations.',
        hindu:    'Hindu dates follow the Hindu lunar calendar (±1 day — may vary by region).',
        chinese:  'Chinese lunisolar dates (Lunar New Year, Lantern Festival, Dragon Boat, Mid-Autumn) follow the Chinese lunisolar calendar (±1 day). Qingming follows the solar calendar and always falls on 4–5 April.',
        jamaican:   'Jamaican public holidays. Ash Wednesday and National Heroes Day are moveable; all other dates are fixed each year.',
        congolese:   'Congolese national public holidays (DRC). All four dates are fixed each year.',
        portuguese:  'Portuguese national public holidays not already covered by the UK calendar. Labour Day is fixed on 1 May (coincides with the UK Early May back holiday only when 1 May falls on a Monday). Carnival Tuesday is widely observed but discretionary. All other dates are fixed or calculated from Easter.',
        none:        '',
    };

    function updateDisclaimer(value) {
        const text = DISCLAIMERS[value] || '';
        disclaimer.textContent = text;
        disclaimer.style.display = text ? '' : 'none';
    }

    // Collapse / expand
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });

    // Derive the faith calendar value from Firestore data.
    // Handles backward compat: old docs stored islamicMarkers:true rather than faithCalendar.
    function resolveFaithCalendar(data) {
        if (!data) return 'none';
        if (data.faithCalendar) return data.faithCalendar;
        return data.islamicMarkers ? 'islamic' : 'none';
    }

    // Load the setting for the given member. Reads localStorage first (instant,
    // no network), then tries Firestore so a cross-device value can override.
    async function loadReligiousSetting(userName) {
        const local = localStorage.getItem(`faithCalendar_${userName}`) || 'none';
        radios.forEach(r => { r.checked = (r.value === local); });
        updateDisclaimer(local);
        updateActiveTag(local);
        try {
            const snap  = await getDoc(doc(db, 'memberSettings', userName));
            if (snap.exists()) {
                const value = resolveFaithCalendar(snap.data());
                localStorage.setItem(`faithCalendar_${userName}`, value);
                radios.forEach(r => { r.checked = (r.value === value); });
                updateDisclaimer(value);
                updateActiveTag(value);
            }
        } catch (e) {
            console.warn('[Firestore] memberSettings load failed:', e);
        }
    }

    // Save on radio change — save against the currently selected member,
    // not always currentUser (admin may be managing another member's settings).
    let saveTimer;
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            updateDisclaimer(radio.value);
            updateActiveTag(radio.value);
            clearTimeout(saveTimer);
            saved.classList.remove('visible', 'error');
            const target = fieldMember.value || currentUser;
            // localStorage always succeeds and is readable by index.html on the same device.
            localStorage.setItem(`faithCalendar_${target}`, radio.value);
            saved.textContent = '✓ Saved';
            saved.classList.add('visible');
            saveTimer = setTimeout(() => saved.classList.remove('visible'), 2500);
            renderWeekGrid(); // Update the admin grid immediately so icons appear without a page reload
            // Firestore sync for cross-device persistence. localStorage save above is the primary;
            // this is a bonus sync. If it fails, the setting still works on this device.
            setDoc(doc(db, 'memberSettings', target), { faithCalendar: radio.value }, { merge: true })
                .catch(e => {
                    console.warn('[Firestore] memberSettings sync failed:', e);
                    clearTimeout(saveTimer);
                    saved.textContent = '✓ Saved on this device (couldn\'t sync to cloud)';
                    saveTimer = setTimeout(() => saved.classList.remove('visible'), 4000);
                });
        });
    });

    // Expose loader so the auth block can call it after currentUser is confirmed
    window._loadReligiousSetting = loadReligiousSetting;
})();

// ============================================
// NOTIFICATIONS CARD — all staff
// ============================================
// Lets staff enable or disable Huddle and pay-reminder push notifications.
// Shows current permission state and provides appropriate action buttons.
(function initNotificationsCard() {
    const VAPID_PUBLIC_KEY = 'BDycpNlvciF7kfUv3yxSQ0iRzWdi3BDZipNf-vk7QYaOSsbbIgb5FRSW9GrJlZJlmThoyQrbK0t9sd3hEdmhgSg';

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        const statusMsg = document.getElementById('notifStatusMsg');
        if (statusMsg) statusMsg.textContent = 'Push notifications are not supported on this device or browser.';
        return;
    }

    const header     = document.getElementById('notifToggleHeader');
    const body       = document.getElementById('notifBody');
    const chevron    = document.getElementById('notifChevron');
    const statusMsg  = document.getElementById('notifStatusMsg');
    const enableBtn  = document.getElementById('notifEnableBtn');
    const disableBtn = document.getElementById('notifDisableBtn');
    const deniedMsg  = document.getElementById('notifDeniedMsg');

    if (!header || !body || !chevron) return;

    // Collapse/expand
    header.addEventListener('click', () => {
        body.classList.toggle('open');
        chevron.textContent = body.classList.contains('open') ? '▴' : '▾';
    });

    // Fingerprint stored in localStorage so we can detect a VAPID key rotation.
    // Value is just the first 12 chars of the public key — enough to spot a change.
    const VAPID_VER_KEY  = 'myb_vapid_ver';
    const VAPID_FINGERPRINT = VAPID_PUBLIC_KEY.slice(0, 12);

    function vapidKey() {
        const base64 = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    }

    async function refreshUI() {
        const perm = Notification.permission;
        const reg  = await navigator.serviceWorker.ready;
        let sub    = await reg.pushManager.getSubscription();

        // If the VAPID key has been rotated since this device subscribed, silently
        // unsubscribe and re-subscribe with the current key. Staff never see this happen.
        if (perm === 'granted' && sub && localStorage.getItem(VAPID_VER_KEY) !== VAPID_FINGERPRINT) {
            try {
                await sub.unsubscribe();
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
                await savePushSubscription(sub);
                localStorage.setItem(VAPID_VER_KEY, VAPID_FINGERPRINT);
                console.log('[Notifications] Re-subscribed after VAPID key rotation');
            } catch (err) {
                console.warn('[Notifications] VAPID key refresh failed:', err);
                sub = null;
            }
        } else if (perm === 'granted' && sub) {
            localStorage.setItem(VAPID_VER_KEY, VAPID_FINGERPRINT);
        }

        const active = perm === 'granted' && !!sub;

        enableBtn.style.display  = 'none';
        disableBtn.style.display = 'none';
        deniedMsg.style.display  = 'none';

        if (perm === 'granted' && active) {
            statusMsg.textContent = 'Notifications are on — you\'ll be alerted when the Huddle is ready and when payday is approaching.';
            disableBtn.style.display = 'block';
        } else if (perm === 'granted' && !active) {
            statusMsg.textContent = 'Notifications are enabled in your browser but your subscription has lapsed. Tap Enable to resubscribe.';
            enableBtn.style.display = 'block';
        } else if (perm === 'denied') {
            statusMsg.textContent = 'Notifications are blocked. To re-enable, change your browser settings.';
            deniedMsg.style.display = 'block';
        } else {
            statusMsg.textContent = 'Tap Enable to get an alert when the daily Huddle is ready or when payday is approaching.';
            enableBtn.style.display = 'block';
        }
    }

    enableBtn.addEventListener('click', async () => {
        try {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly:      true,
                    applicationServerKey: vapidKey(),
                });
                await savePushSubscription(sub);
                localStorage.setItem(VAPID_VER_KEY, VAPID_FINGERPRINT);
            }
        } catch (err) {
            console.warn('[Notifications] Enable failed:', err);
        }
        await refreshUI();
    });

    disableBtn.addEventListener('click', async () => {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const endpoint = sub.endpoint;
                await sub.unsubscribe();
                await deletePushSubscription(endpoint).catch(() => {});
            }
        } catch (err) {
            console.warn('[Notifications] Disable failed:', err);
        }
        await refreshUI();
    });

    refreshUI().catch(err => console.warn('[Notifications] Init error:', err));
})();

// ============================================
// DAILY HUDDLE UPLOAD — admin only
// ============================================
// The card HTML is always in the DOM but hidden via style="display:none".
// This block reveals it and wires up the upload flow only when the signed-in
// user is an admin. Non-admins never see the card.
(function initHuddleUpload() {
    if (!currentIsAdmin) return;

    const card      = document.getElementById('huddleUploadCard');
    const dateInput = document.getElementById('huddleDate');
    const fileInput = document.getElementById('huddleFileInput');
    const fileLabel = document.getElementById('huddleFileName');
    const uploadBtn = document.getElementById('huddleUploadBtn');
    const feedback  = document.getElementById('huddleFeedback');

    if (!card || !dateInput || !fileInput || !uploadBtn) return;

    // Reveal card for admin
    card.style.display = '';

    // Default date to today
    dateInput.value = formatISO(new Date());

    // Show chosen filename and enable upload button when a file is selected
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';
        if (!file) {
            fileLabel.style.display = 'none';
            uploadBtn.disabled = true;
            return;
        }
        const isPdf  = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    || file.name.toLowerCase().endsWith('.docx');
        if (!isPdf && !isDocx) {
            fileLabel.style.display = 'none';
            uploadBtn.disabled = true;
            feedback.textContent = 'Please choose a PDF or Word (.docx) file';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            fileLabel.style.display = 'none';
            uploadBtn.disabled = true;
            feedback.textContent = 'File too large — maximum 20 MB';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        fileLabel.textContent = file.name;
        fileLabel.style.display = '';
        uploadBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', async () => {
        const date = dateInput.value;
        const file = fileInput.files[0];
        if (!date || !file) return;

        uploadBtn.disabled = true;
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';

        let htmlContent = null;
        const isDocx = file.name.toLowerCase().endsWith('.docx');
        if (isDocx) {
            uploadBtn.textContent = 'Converting…';
            try {
                await new Promise((resolve, reject) => {
                    if (window.mammoth) { resolve(); return; }
                    const s = document.createElement('script');
                    s.src     = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
                    s.onload  = resolve;
                    s.onerror = () => reject(new Error('load'));
                    document.head.appendChild(s);
                });
                const arrayBuffer = await file.arrayBuffer();
                const result      = await mammoth.convertToHtml({ arrayBuffer });
                const html        = result.value || null;
                // Firestore document limit is 1 MB — skip htmlContent if the conversion
                // is too large; the viewer will fall back to opening the Storage URL.
                htmlContent = html && html.length < 800_000 ? html : null;
            } catch (convErr) {
                console.error('[Huddle] DOCX conversion failed:', convErr);
                feedback.textContent = convErr.message === 'load'
                    ? 'Could not load Word converter — check your connection and try again'
                    : 'Could not read the Word file — make sure it is a valid .docx';
                feedback.className = 'huddle-feedback huddle-feedback--err';
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Upload Huddle';
                return;
            }
        }

        uploadBtn.textContent = 'Uploading…';

        try {
            await uploadHuddle(date, file, currentUser, htmlContent);
            feedback.textContent = `Huddle uploaded for ${date} — staff will see it on the main app`;
            feedback.className = 'huddle-feedback huddle-feedback--ok';
            fileInput.value = '';
            fileLabel.textContent = '';
            fileLabel.style.display = 'none';
        } catch (err) {
            console.error('[Huddle] Upload failed:', err);
            feedback.textContent = 'Upload failed — please try again';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            uploadBtn.disabled = false;
        }

        uploadBtn.textContent = 'Upload Huddle';
    });
})();

// ============================================
// HUDDLE CARD — collapse/expand
// ============================================
(function initHuddleCard() {
    const header  = document.getElementById('huddleToggleHeader');
    const body    = document.getElementById('huddleBody');
    const chevron = document.getElementById('huddleChevron');
    if (!header || !body || !chevron) return;
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
})();

// ============================================
// PRINT HEADER — member name, week, timestamp
// ============================================
window.addEventListener('beforeprint', () => {
    const member    = fieldMember.value || 'All members';
    const weekLabel = document.getElementById('weekNavLabel')?.textContent || '';
    const now       = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const printHeaderEl        = document.getElementById('printHeader');
    if (printHeaderEl) printHeaderEl.innerHTML = `MYB Roster \u2014 ${esc(member)}<span class="print-sub">Week: ${esc(weekLabel)} \u00b7 Printed: ${esc(now)}</span>`;
});

/**
 * One-time cleanup: finds and deletes any annual_leave overrides that fall on
 * a Sunday. These can't be created any more but may exist from before v5.73.
 * Runs silently on admin page load — logs a summary to the console only.
 * Skipped after the first clean run via localStorage flag to avoid a full
 * Firestore scan on every subsequent page load.
 */
async function purgeSundayAL() {
    if (localStorage.getItem('purgeSundayAL_done') === '1') return;
    try {
        const snap = await getDocs(query(
            collection(db, 'overrides'),
            where('type', '==', 'annual_leave')
        ));

        const toDelete = snap.docs.filter(d => isSunday(d.data().date));

        if (toDelete.length === 0) {
            console.log('[purgeSundayAL] No Sunday AL overrides found — nothing to clean up.');
            localStorage.setItem('purgeSundayAL_done', '1');
            return;
        }

        const batch = writeBatch(db);
        toDelete.forEach(d => batch.delete(doc(db, 'overrides', d.id)));
        await batch.commit();

        console.log(`[purgeSundayAL] Removed ${toDelete.length} Sunday AL override${toDelete.length !== 1 ? 's' : ''}:`,
            toDelete.map(d => `${d.data().memberName} ${d.data().date}`));
        localStorage.setItem('purgeSundayAL_done', '1');

        // Refresh the in-memory cache so Saved Changes reflects the cleanup
        const removedIds = new Set(toDelete.map(d => d.id));
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
    // All dropdowns are now populated — apply permissions then load data
    document.body.classList.add('auth-ready');
    applyPermissions();
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
    loadOverrides(); // internally calls renderWeekGrid() after data loads
    if (currentIsAdmin) purgeSundayAL();
    if (typeof window._loadReligiousSetting === 'function') window._loadReligiousSetting(fieldMember.value || currentUser);

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
// SERVICE WORKER — registration + update toast
// Registers the shared service worker. Auto-updates silently — skips waiting
// immediately and reloads on controllerchange, consistent with index.html and paycalc.html.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
            function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }

            if (registration.waiting) activate(registration.waiting);

            registration.addEventListener('updatefound', () => {
                const nw = registration.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw);
                });
            });

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // If the admin has unsaved changes, wait until they navigate away
                // before reloading so they don't lose their work mid-form.
                if (!hasUnsavedChanges()) { window.location.reload(); return; }
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') window.location.reload();
                }, { once: true });
            }, { once: true });

            let updateInterval = setInterval(() => registration.update(), 60 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    clearInterval(updateInterval);
                } else {
                    clearInterval(updateInterval);
                    updateInterval = setInterval(() => registration.update(), 60 * 60 * 1000);
                }
            });
        })
        .catch(e => console.warn('[SW] Registration failed:', e));
}

// ============================================
// ROSTER UPLOAD — parse PDF and review shifts
// ============================================
//
// HOW THIS WORKS (plain English):
//
// 1. Gareth chooses the roster type, week-ending date, and PDF file.
// 2. The PDF is sent to the "parseRosterPDF" Cloud Function, which:
//    a. Reads the text from the PDF.
//    b. Asks Claude AI to identify each person's shifts.
//    c. Returns a tidy list of shifts — does NOT write anything yet.
// 3. The browser fetches any overrides already saved in Firestore for that week.
// 4. For each cell (person + day) we decide one of four states:
//    - MATCH:    PDF matches the base roster. Nothing to do.
//    - DIFF:     PDF differs from base roster, no manual override exists.
//                → Show in amber, ticked by default. Will save if approved.
//    - CONFLICT: A manually entered override exists AND the PDF says something
//                different. The manual entry wins automatically — but Gareth
//                is told about it and can tap the cell to see both values.
//    - COVERED:  A manual override already matches what the PDF says. Nothing to do.
// 5. Gareth reviews, edits any cells he wants to correct, then clicks "Apply".
// 6. The browser writes only the approved DIFF cells to Firestore as overrides
//    with source: 'roster_import', in a single batch write.
//
// The "source" field on override documents:
//   'manual'        — entered by a person on the admin page (sick leave, AL, etc.)
//   'roster_import' — written by this roster upload feature
// Existing documents without a source field are treated as 'manual' (safe default).
//
// ============================================

// The Cloud Function URL for parsing rosters.
// Replace with the actual deployed URL if it differs.
const PARSE_ROSTER_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF';

// ⚠ SECURITY NOTE: This secret is visible to anyone who views the page source.
// It is embedded here because the current app has no server-side authentication (see CLAUDE.md #14).
// If this value is ever leaked or the function is abused, rotate it immediately:
//   firebase functions:secrets:set ROSTER_SECRET   (paste a new UUID when prompted)
// Then update this constant to match the new value.
const ROSTER_SECRET_VALUE = 'a7f3d2e1-9b4c-4f8a-b6e5-3c1d0a2f5e8b';

// ── Roster upload pipeline ───────────────────────────────────────────────────
// Extracted to admin-roster-upload.js at v8.61. Passing ROSTER_SECRET_VALUE
// here keeps the secret in one place — it is also used by initAuthSetup below.
initRosterUpload({
    currentUser,
    currentIsAdmin,
    parseUrl:      PARSE_ROSTER_URL,
    rosterSecret:  ROSTER_SECRET_VALUE,
    loadOverrides,
});

// ── Staff login accounts setup ───────────────────────────────────────────────
(function initAuthSetup() {
    if (!currentIsAdmin) return;

    const card      = document.getElementById('authSetupCard');
    const btn       = document.getElementById('authSetupBtn');
    const orphansCb = document.getElementById('authSetupOrphans');
    const resultEl  = document.getElementById('authSetupResult');
    if (!card || !btn || !orphansCb || !resultEl) return;

    card.style.display = '';

    // Collapse toggle
    const header  = document.getElementById('authSetupToggleHeader');
    const body    = document.getElementById('authSetupBody');
    const chevron = document.getElementById('authSetupChevron');
    if (header && body && chevron) {
        header.addEventListener('click', () => {
            const isOpen = body.classList.toggle('open');
            chevron.classList.toggle('open', isOpen);
        });
    }

    // Active members: non-hidden staff with a real role (excludes vacancies and cultural calendar entries)
    const ACTIVE_MEMBERS = teamMembers
        .filter(m => !m.hidden && ['CEA', 'CES', 'Dispatcher'].includes(m.role))
        .map(m => m.name);

    const SETUP_AUTH_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth';

    btn.addEventListener('click', async () => {
        btn.disabled  = true;
        btn.textContent = 'Working…';
        resultEl.style.display = 'none';

        try {
            const resp = await fetch(SETUP_AUTH_URL, {
                method:  'POST',
                headers: {
                    'Authorization':  `Bearer ${ROSTER_SECRET_VALUE}`,
                    'Content-Type':   'application/json',
                },
                body: JSON.stringify({
                    members:       ACTIVE_MEMBERS,
                    removeOrphans: orphansCb.checked,
                }),
            });

            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`Server responded ${resp.status}: ${err}`);
            }

            const { created = [], skipped = [], disabled = [], failed = [] } = await resp.json();

            const lines = [];
            if (created.length)  lines.push(`✅ Created (${created.length}): ${created.join(', ')}`);
            if (skipped.length)  lines.push(`⏭️ Already existed (${skipped.length}): ${skipped.join(', ')}`);
            if (disabled.length) lines.push(`🚫 Disabled leavers (${disabled.length}): ${disabled.join(', ')}`);
            if (failed.length)   lines.push(`❌ Failed (${failed.length}): ${failed.join(', ')}`);
            if (!lines.length)   lines.push('Nothing to do — all accounts already up to date.');

            resultEl.innerHTML = lines.map(l => `<p style="margin:0 0 6px">${escapeHtml(l)}</p>`).join('');
            resultEl.style.display = 'block';
        } catch (err) {
            resultEl.innerHTML = `<p style="color:var(--error)">❌ ${escapeHtml(err.message)}</p>`;
            resultEl.style.display = 'block';
            console.error('[authSetup]', err);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Set up accounts';
        }
    });
})();
