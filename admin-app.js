import { CONFIG, teamMembers, DAY_KEYS, DAY_NAMES, MONTH_ABB, getALEntitlement, getSpecialDayBadges, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml, formatISO, isSunday, SWIPE_THRESHOLD, SWIPE_VELOCITY } from './roster-data.js?v=6.85';
import { db, collection, query, where, orderBy, limit, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, serverTimestamp, writeBatch, uploadHuddle } from './firebase-client.js?v=6.85';

// ADMIN_VERSION reads from CONFIG which is set from APP_VERSION in roster-data.js — one source of truth.
const ADMIN_VERSION = CONFIG.APP_VERSION;

// ============================================
// AUTH — SESSION MANAGEMENT
// 30-day localStorage session.
// Passwords are surnames (lowercase) — sufficient
// to prevent casual misbehaviour, not cryptographic security.
// ============================================
const AUTH_KEY   = 'myb_admin_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
        return s;
    } catch { return null; }
}

function saveSession(name) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({
        name,
        expiry: Date.now() + SESSION_MS
    }));
}

function clearSession() {
    localStorage.removeItem(AUTH_KEY);
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

    function attempt() {
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

    // SW update status (mirrors app.js logic — no update button; admin uses the #updateToast)
    let swRegistration = null;
    function showUpToDate()       { if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; } }
    function showUpdateAvailable(){ if (statusEl) { statusEl.textContent = 'Update available'; statusEl.className = 'lightbox-status update-available'; } }
    function checkUpdateStatus()  { swRegistration && swRegistration.waiting ? showUpdateAvailable() : showUpToDate(); }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
            swRegistration = reg;
            if (reg.waiting) showUpdateAvailable();
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                if (!w) return;
                w.addEventListener('statechange', () => {
                    if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateAvailable();
                });
            });
        });
    }

    function openLightbox() {
        checkUpdateStatus();
        const userEl = document.getElementById('lightboxCurrentUser');
        if (userEl) userEl.textContent = currentUser ? `Signed in as ${currentUser}` : '';

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
            title: 'Changing shifts',
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

// Override type metadata
const TYPES = {
    spare_shift:  { label: 'Spare shift',    fixed: true,  fixedValue: 'SPARE' },
    shift:        { label: 'Shift',          fixed: false },
    rdw:          { label: 'Rest Day Working', fixed: false },
    annual_leave: { label: 'Annual Leave',   fixed: true,  fixedValue: 'AL' },
    correction:   { label: 'Set as Rest Day', fixed: true,  fixedValue: 'RD' },
    sick:         { label: 'Absent',          fixed: true,  fixedValue: 'SICK' },
    // Legacy types — no pill buttons; kept so old Saved Changes records display correctly
    allocated:    { label: 'Allocated shift', fixed: false },
    overtime:     { label: 'Overtime',        fixed: false },
    swap:         { label: 'Swap',            fixed: false },
};

// ============================================
// ROSTER LOGIC
// ============================================

// getRosterData, getWeekNum, getBaseShift — imported from roster-data.js as getRosterForMember, getWeekNumberForDate, getBaseShift
// shiftBadge — alias for getShiftBadge; layout direction controlled by admin.html CSS
function shiftBadge(shift) { return getShiftBadge(shift); }

// ============================================
// DOM
// ============================================
const fieldMember  = document.getElementById('fieldMember');
const fieldDate    = document.getElementById('fieldDate');
const prevWeekBtn  = document.getElementById('prevWeekBtn');
const nextWeekBtn  = document.getElementById('nextWeekBtn');
const bulkBar      = document.getElementById('bulkBar');
const bulkTypePills = document.getElementById('bulkTypePills');
const bulkTimeGroup = document.getElementById('bulkTimeGroup');
const bulkStart    = document.getElementById('bulkStart');
const bulkEnd      = document.getElementById('bulkEnd');
const bulkApplyBtn = document.getElementById('bulkApplyBtn');
const weekGrid     = document.getElementById('weekGrid');
const saveBtn      = document.getElementById('saveBtn');
const formFeedback = document.getElementById('formFeedback');
const tableBody    = document.getElementById('overrideTableBody');
const listCount    = document.getElementById('listCount');
const listFeedback          = document.getElementById('listFeedback');
const shiftNote             = document.getElementById('shiftNote');
const overridesMonthFilter  = document.getElementById('overridesMonthFilter');
const selectAllOverrides    = document.getElementById('selectAllOverrides');
const bulkDeleteBtn         = document.getElementById('bulkDeleteBtn');

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

/**
 * Prompts for confirmation when there are unsaved changes.
 * Returns true immediately if nothing is unsaved.
 * @returns {boolean} true = safe to navigate, false = user cancelled
 */
function confirmNavigate() {
    if (!hasUnsavedChanges()) return true;
    return confirm('You have unsaved changes. Continue and lose them?');
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
    if (!confirmNavigate()) return;
    const d = new Date(fieldDate.value + 'T12:00:00');
    d.setDate(d.getDate() + delta * 7);
    fieldDate.value = formatISO(d);
    lastFieldDate = fieldDate.value;
    renderWeekGrid();
}

document.getElementById('thisWeekBtn').addEventListener('click', () => {
    if (!confirmNavigate()) return;
    fieldDate.value = formatISO(new Date());
    lastFieldDate = fieldDate.value;
    renderWeekGrid();
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
    const entitlement = getALEntitlement(member, parseInt(yearStr, 10), allOverrides);
    const todayStr    = formatISO(new Date());

    let taken  = 0;
    let booked = 0;
    allOverrides.forEach(o => {
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

// Update the week nav label for a given ISO date string.
// Extracted so swipe can update the label without a full re-render.
/**
 * Updates the week navigation date label to show the Sun–Sat range that
 * contains dateStr, and highlights it if it is the current week.
 * @param {string} dateStr  YYYY-MM-DD
 */
function updateWeekNavLabel(dateStr) {
    if (!dateStr) return;
    const _picked   = new Date(dateStr + 'T12:00:00');
    const _sunday   = new Date(_picked);
    _sunday.setDate(_picked.getDate() - _picked.getDay());
    const _saturday = new Date(_sunday);
    _saturday.setDate(_sunday.getDate() + 6);
    const weekNavLabel = document.getElementById('weekNavLabel');
    if (weekNavLabel) {
        weekNavLabel.textContent =
            `${_sunday.getDate()} ${MONTH_ABB[_sunday.getMonth()]} – ${_saturday.getDate()} ${MONTH_ABB[_saturday.getMonth()]} ${_saturday.getFullYear()}`;
        const todaySun = new Date(); todaySun.setDate(todaySun.getDate() - todaySun.getDay());
        weekNavLabel.classList.toggle('is-current-week',
            _sunday.toDateString() === todaySun.toDateString());
    }
}

/**
 * Builds a 7-day week grid (column header + one row per day) into container
 * for the week that contains dateStr.
 *
 * Reads fieldMember.value and allOverrides from module scope, but has NO
 * side-effects on fieldDate, userMadeChanges, bulkBar, or saveBtn —
 * safe to call for adjacent panels during carousel pre-building.
 *
 * @param {HTMLElement} container  DOM node to append the grid into
 * @param {string}      dateStr    YYYY-MM-DD — any date within the target week
 */
function buildWeekGridInto(container, dateStr) {
    const memberName = fieldMember.value;
    const member     = teamMembers.find(m => m.name === memberName);
    if (!member || !memberName || !dateStr) return;

    const picked = new Date(dateStr + 'T12:00:00');
    const sunday = new Date(picked);
    sunday.setDate(picked.getDate() - picked.getDay());

    const header = document.createElement('div');
    header.className = 'week-grid-header';
    header.innerHTML = `
        <div class="hdr-check"></div>
        <div class="hdr-day">Day</div>
        <div class="hdr-base">Base roster</div>
        <div class="hdr-pills">Change to</div>
        <div class="hdr-time">Shift time</div>`;
    container.appendChild(header);

    // Read faith calendar opt-in for the selected member
    const faithCalendar = document.querySelector('input[name="faithCalendar"]:checked')?.value || 'none';

    for (let i = 0; i < 7; i++) {
        const date      = new Date(sunday);
        date.setDate(sunday.getDate() + i);
        const dateISO   = formatISO(date);
        const baseShift = getBaseShift(member, date);

        // Special day badges (⭐ ✂️ 💷 🎄 🐣 and optional faith calendar markers)
        const badges = getSpecialDayBadges(date, dateISO, faithCalendar);
        const badgeHTML = badges.map(b => `<span class="day-badge" title="${b.title}">${b.icon}</span>`).join('');

        // Check if an override already exists for this member + date
        const existing  = allOverrides.find(o => o.memberName === memberName && o.date === dateISO);

        // --- Main row ---
        const row = document.createElement('div');
        const isToday = dateISO === formatISO(new Date());
        row.className   = 'day-row' + (existing ? ' has-override' : '') + (isToday ? ' today' : '');
        row.dataset.date = dateISO;
        if (existing) row.dataset.existingId = existing.id;

        row.innerHTML = `
            <div class="col-check">
                <input type="checkbox" class="day-cb" aria-label="${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_ABB[date.getMonth()]}">
            </div>
            <div class="col-day">
                <span class="day-name">${DAY_NAMES[date.getDay()]}</span>
                <span class="day-date">${date.getDate()} ${MONTH_ABB[date.getMonth()]}${badgeHTML}${existing ? ' <span class="overwrite-badge">⚠ change saved</span>' : ''}</span>
            </div>
            <div class="col-base">${shiftBadge(baseShift)}</div>
            <div class="col-pills">
                <button class="type-pill-btn pill-annual_leave" data-type="annual_leave">AL</button>
                <button class="type-pill-btn pill-spare_shift"  data-type="spare_shift">Spare</button>
                <button class="type-pill-btn pill-shift"        data-type="shift">Shift</button>
                <button class="type-pill-btn pill-rdw"          data-type="rdw">RDW</button>
                <button class="type-pill-btn pill-sick"         data-type="sick">Absent</button>
                <button class="type-pill-btn pill-correction"   data-type="correction">Rest Day</button>
            </div>
            <div class="col-time">
                <input type="text" class="time-input day-start" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour start time, e.g. 06:20">
                <span class="time-sep">–</span>
                <input type="text" class="time-input day-end" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour end time, e.g. 14:20">
                <span class="time-note">No time needed</span>
                <span class="time-hint">24h · max 12 hrs</span>
                <span class="time-error-msg">Use HH:MM format (e.g. 07:00)</span>
            </div>`;

        container.appendChild(row);

        // Sundays are uncontracted — disable the AL pill so it can't be selected
        if (date.getDay() === 0) {
            const alPill = row.querySelector('.pill-annual_leave');
            if (alPill) {
                alPill.disabled = true;
                alPill.title    = 'Annual leave cannot be recorded on a Sunday — Sundays are not contracted days';
            }
        }

        // Refs
        const checkbox = row.querySelector('.day-cb');
        const pills    = row.querySelectorAll('.type-pill-btn');
        const startEl  = row.querySelector('.day-start');
        const endEl    = row.querySelector('.day-end');

        // Pre-fill with existing override if present.
        // Mark as prefilled-existing so the save button doesn't light up until
        // the user explicitly changes something — and so deactivation can trigger deletion.
        if (existing) {
            // Map legacy types to the new unified 'shift' type so the Shift pill
            // highlights correctly and re-saving migrates the record to the new type.
            const legacyToShift = { overtime: 'shift', swap: 'shift', allocated: 'shift' };
            const prefillType = legacyToShift[existing.type] ?? existing.type;
            const typeMeta = TYPES[prefillType];
            activateRow(row, checkbox, pills, startEl, endEl, prefillType);
            row.classList.add('prefilled-existing');
            if (typeMeta && !typeMeta.fixed && existing.value && existing.value.includes('-')) {
                const [s, e] = existing.value.split('-');
                startEl.value = s;
                endEl.value   = e;
            }
            if (existing.note && shiftNote) {
                shiftNote.value = existing.note;
            }
        }

        // Pill click: set type, activate row.
        // Remove prefilled-existing so the row counts as a user change from here on.
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                const type    = pill.dataset.type;
                const already = pill.classList.contains('active');
                row.classList.remove('prefilled-existing');
                if (already) {
                    deactivateRow(row, checkbox, pills, startEl, endEl);
                } else {
                    activateRow(row, checkbox, pills, startEl, endEl, type);
                    const typeMeta = TYPES[type];
                    if (typeMeta && !typeMeta.fixed) startEl.focus();
                }
                markChanged();
                updateSaveBtn();
            });
        });

        // Checkbox: syncs with pill state
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                row.classList.remove('prefilled-existing');
                deactivateRow(row, checkbox, pills, startEl, endEl);
            }
            markChanged();
            updateSaveBtn();
            updateBulkSelCount();
        });

        // Time inputs: editing a pre-filled time marks the row as user-modified
        startEl.addEventListener('change', () => { row.classList.remove('prefilled-existing'); markChanged(); updateSaveBtn(); });
        endEl.addEventListener('change',   () => { row.classList.remove('prefilled-existing'); markChanged(); updateSaveBtn(); });

    }
}

/**
 * Re-renders the full week grid for the currently selected member and date.
 * Resets unsaved-changes state, shows the bulk bar, and refreshes Save button.
 * Shows a placeholder message if either selector is empty.
 */
function renderWeekGrid() {
    userMadeChanges = false;
    const memberName = fieldMember.value;
    const dateStr    = fieldDate.value;

    updateWeekNavLabel(dateStr);

    if (!memberName || !dateStr) {
        weekGrid.innerHTML = `<div class="week-empty">${currentIsAdmin ? 'Select a staff member and date above to load the week.' : 'Select a date above to load the week.'}</div>`;
        bulkBar.style.display = 'none';
        saveBtn.disabled = true;
        if (shiftNote) shiftNote.value = '';
        return;
    }

    weekGrid.innerHTML = '';
    if (shiftNote) shiftNote.value = '';

    const member = teamMembers.find(m => m.name === memberName);
    if (!member) {
        bulkBar.style.display = 'none';
        saveBtn.disabled = true;
        return;
    }
    const panel = document.createElement('div');
    panel.className = 'week-panel';
    buildWeekGridInto(panel, dateStr);
    weekGrid.appendChild(panel);

    bulkBar.style.display = 'block';
    resetBulkPills();
    updateSaveBtn();
    updateBulkSelCount();
}

/**
 * Activates a day row by checking the checkbox, highlighting the selected type pill,
 * and enabling or disabling the time inputs based on whether the type has fixed times.
 * @param {HTMLElement}         row     The .day-row element
 * @param {HTMLInputElement}    cb      The row's checkbox
 * @param {NodeList}            pills   All .type-pill-btn elements in the row
 * @param {HTMLInputElement}    startEl The shift-start time input
 * @param {HTMLInputElement}    endEl   The shift-end time input
 * @param {string}              type    Override type key (e.g. 'annual_leave', 'swap')
 */
function activateRow(row, checkbox, pills, startEl, endEl, type) {
    checkbox.checked = true;
    row.classList.add('active');
    row.classList.remove('selected');
    pills.forEach(p => p.classList.toggle('active', p.dataset.type === type));
    const typeMeta = TYPES[type];
    if (typeMeta && typeMeta.fixed) {
        row.classList.add('fixed-type');
        startEl.tabIndex = -1;
        endEl.tabIndex   = -1;
    } else {
        row.classList.remove('fixed-type');
        startEl.tabIndex = 0;
        endEl.tabIndex   = 0;
    }
    row.dataset.type = type;
    const badge = row.querySelector('.overwrite-badge');
    if (badge) badge.textContent = '⚠ replacing';
}

/**
 * Deactivates a day row by unchecking the checkbox, clearing the active pill,
 * wiping time inputs, and removing all state classes.
 * @param {HTMLElement}      row     The .day-row element
 * @param {HTMLInputElement} cb      The row's checkbox
 * @param {NodeList}         pills   All .type-pill-btn elements in the row
 * @param {HTMLInputElement} startEl The shift-start time input
 * @param {HTMLInputElement} endEl   The shift-end time input
 */
function deactivateRow(row, checkbox, pills, startEl, endEl) {
    checkbox.checked = false;
    row.classList.remove('active', 'fixed-type', 'selected', 'row-error');
    pills.forEach(p => p.classList.remove('active'));
    startEl.value = endEl.value = '';
    startEl.classList.remove('input-error');
    endEl.classList.remove('input-error');
    startEl.tabIndex = endEl.tabIndex = -1;
    delete row.dataset.type;
    const badge = row.querySelector('.overwrite-badge');
    if (badge) badge.textContent = '⚠ already saved';
}

/**
 * Updates the Save button — disabled when nothing has changed, enabled with a
 * summary hint ("2 days to save, 1 override to remove") when there are pending writes.
 */
function updateSaveBtn() {
    // Only count rows the user has explicitly changed (not pre-filled existing overrides).
    // Pre-filled rows carry the prefilled-existing class until the user interacts with them.
    const rows     = [...weekGrid.querySelectorAll('.day-row')];
    const saveCount   = rows.filter(r => r.dataset.type && !r.classList.contains('prefilled-existing')).length;
    const deleteCount = rows.filter(r => !r.dataset.type && r.dataset.existingId).length;
    const total = saveCount + deleteCount;
    saveBtn.disabled = total === 0;
    const hint = document.getElementById('saveBtnHint');
    if (hint) {
        if (total > 0) {
            const parts = [];
            if (saveCount)   parts.push(`${saveCount} day${saveCount   > 1 ? 's' : ''} to save`);
            if (deleteCount) parts.push(`${deleteCount} override${deleteCount > 1 ? 's' : ''} to remove`);
            hint.textContent = `Ready — ${parts.join(', ')}`;
        } else {
            hint.textContent = 'Select a type on at least one day, then tap Save changes';
        }
    }
}

/** Updates the "N days selected" counter in the bulk bar. */
function updateBulkSelCount() {
    const selCountDisplay = document.getElementById('bulkSelCount');
    if (!selCountDisplay) return;
    const n = weekGrid.querySelectorAll('.day-cb:checked').length;
    selCountDisplay.textContent = n > 0 ? `${n} day${n > 1 ? 's' : ''} selected` : '';
}

// ============================================
// BULK BAR — type pills
// ============================================
let bulkActiveType = '';

/** Clears the active bulk-bar type pill, hides the time inputs, and resets their values. */
function resetBulkPills() {
    bulkActiveType = '';
    bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => p.classList.remove('active'));
    bulkTimeGroup.style.display = 'none';
    bulkStart.value = bulkEnd.value = '';
}

bulkTypePills.querySelectorAll('.type-pill-btn').forEach(pill => {
    pill.addEventListener('click', () => {
        const type    = pill.dataset.type;
        const already = pill.classList.contains('active');
        if (already) { resetBulkPills(); return; }
        bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        bulkActiveType = type;
        const typeMeta = TYPES[type];
        bulkTimeGroup.style.display = (typeMeta && !typeMeta.fixed) ? 'flex' : 'none';
        bulkStart.value = bulkEnd.value = '';
    });
});

// Day selection shortcuts
document.getElementById('bulkSelMonFri').addEventListener('click', () => {
    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const dayIdx   = new Date(row.dataset.date + 'T12:00:00').getDay();
        const checkbox = row.querySelector('.day-cb');
        if (!checkbox) return;
        // Mon=1, Fri=5
        if (dayIdx >= 1 && dayIdx <= 5) {
            checkbox.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        } else {
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = row.querySelector('.day-start');
            const endEl   = row.querySelector('.day-end');
            deactivateRow(row, checkbox, pills, startEl, endEl);
        }
    });
    updateSaveBtn();
    updateBulkSelCount();
});

document.getElementById('bulkSelWorking').addEventListener('click', () => {
    const memberName = fieldMember.value;
    const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const date     = new Date(row.dataset.date + 'T12:00:00');
        const checkbox = row.querySelector('.day-cb');
        if (!checkbox) return;
        const base  = member ? getBaseShift(member, date) : 'RD';
        const works = base !== 'RD' && base !== 'OFF';
        if (works) {
            checkbox.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        } else {
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = row.querySelector('.day-start');
            const endEl   = row.querySelector('.day-end');
            deactivateRow(row, checkbox, pills, startEl, endEl);
        }
    });
    updateSaveBtn();
    updateBulkSelCount();
});

document.getElementById('bulkSelAll').addEventListener('click', () => {
    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const checkbox = row.querySelector('.day-cb');
        if (!checkbox) return;
        checkbox.checked = true;
        if (!row.dataset.type) row.classList.add('selected');
    });
    updateSaveBtn();
    updateBulkSelCount();
});

// Apply bulk type + time to all active (checked) rows
bulkApplyBtn.addEventListener('click', () => {
    if (!bulkActiveType) { showError('Choose a type in step 2 first, then tap Apply.'); return; }
    const typeMeta = TYPES[bulkActiveType];

    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const checkbox = row.querySelector('.day-cb');
        if (!checkbox || !checkbox.checked) return;
        const pills   = row.querySelectorAll('.type-pill-btn');
        const startEl = row.querySelector('.day-start');
        const endEl   = row.querySelector('.day-end');
        activateRow(row, checkbox, pills, startEl, endEl, bulkActiveType);
        if (typeMeta && !typeMeta.fixed) {
            if (bulkStart.value) startEl.value = bulkStart.value;
            if (bulkEnd.value)   endEl.value   = bulkEnd.value;
        }
    });
    markChanged();
    updateSaveBtn();
    updateBulkSelCount();
});

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
        const entitlement = getALEntitlement(member, parseInt(yearStr, 10), allOverrides);
        // Count existing AL for this year, excluding days being overwritten (they're replaced, not added)
        const overwriteDates = new Set(alInBatch.filter(e => e.existingId).map(e => e.date));
        // Sundays are uncontracted — exclude from entitlement counts
        const existingAL = allOverrides.filter(o =>
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

/**
 * Writes a batch of override changes to Firestore and updates the in-memory cache.
 * Disables the Save button while running, then re-enables it in the finally block.
 * Shows success/error feedback in the week editor feedback area.
 * @param {Array<{memberName,date,type,value,note,existingId}>} toSave   Overrides to create (existingId means overwrite)
 * @param {string[]} toDelete  Firestore document IDs to delete
 */
async function executeSave(toSave, toDelete = []) {
    const memberName = fieldMember.value;
    const overwrites = toSave.filter(e => e.existingId).length;
    const creates    = toSave.length - overwrites;
    const removes    = toDelete.length;
    const total      = toSave.length + removes;

    saveBtn.disabled    = true;
    saveBtn.textContent = `Saving ${total} change${total !== 1 ? 's' : ''}…`;

    try {
        const batch   = writeBatch(db);
        const newDocs = [];   // track new docs for in-memory update

        // Process deletions first (deactivated pre-filled rows)
        toDelete.forEach(id => batch.delete(doc(db, 'overrides', id)));

        toSave.forEach(entry => {
            // Delete existing first if overwriting, then add fresh doc
            if (entry.existingId) {
                batch.delete(doc(db, 'overrides', entry.existingId));
            }
            const { existingId: _, ...data } = entry;
            const newRef = doc(collection(db, 'overrides'));
            batch.set(newRef, { ...data, source: 'manual', createdAt: serverTimestamp(), changedBy: currentUser });
            // Capture the new ID so we can update allOverrides without a round-trip
            newDocs.push({ id: newRef.id, ...data, createdAt: new Date() });
        });
        await batch.commit();

        const parts = [];
        if (creates    > 0) parts.push(`${creates} added`);
        if (overwrites > 0) parts.push(`${overwrites} updated`);
        if (removes    > 0) parts.push(`${removes} removed`);
        showSuccess(`${parts.join(', ')} for ${memberName}`);
        userMadeChanges = false;
        if (shiftNote) shiftNote.value = '';

        // Reset checked rows
        weekGrid.querySelectorAll('.day-row').forEach(row => {
            const checkbox = row.querySelector('.day-cb');
            const pills    = row.querySelectorAll('.type-pill-btn');
            const s        = row.querySelector('.day-start');
            const e        = row.querySelector('.day-end');
            if (checkbox) deactivateRow(row, checkbox, pills, s, e);
        });

        // Update allOverrides in-memory — no Firestore round-trip needed
        const removedIds = new Set([
            ...toDelete,
            ...toSave.filter(e => e.existingId).map(e => e.existingId)
        ]);
        allOverrides = allOverrides.filter(o => !removedIds.has(o.id));
        allOverrides.push(...newDocs);
        allOverrides.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        renderTable();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        if (fieldMember.value && fieldDate.value) renderWeekGrid();

    } catch (err) {
        console.error('[Admin] Save failed:', err);
        showError(err.code === 'permission-denied'
            ? 'Permission denied — contact your admin to check Firestore rules.'
            : 'Could not save — check your connection and try again.');
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save changes';
        updateSaveBtn();
    }
}

fieldMember.addEventListener('change', () => {
    if (!confirmNavigate()) { fieldMember.value = localStorage.getItem('myb_roster_selected_member') || localStorage.getItem('adminLastMember') || ''; return; }
    localStorage.setItem('adminLastMember', fieldMember.value);
    localStorage.setItem('myb_roster_selected_member', fieldMember.value);
    alMember.value   = fieldMember.value;
    sickMember.value = fieldMember.value;
    syncMemberDisplay();
    syncSickMemberDisplay();
    if (fieldMember.value && typeof window._loadReligiousSetting === 'function') window._loadReligiousSetting(fieldMember.value);
    updateALBanner();
    updateALBookedBox();
    updateSickBookedBox();
    renderTable();
    renderWeekGrid();
});
let lastFieldDate = fieldDate.value;
fieldDate.addEventListener('change', () => {
    if (hasUnsavedChanges()) {
        const newVal = fieldDate.value;
        fieldDate.value = lastFieldDate; // revert so user sees the restore if they cancel
        if (!confirm('You have unsaved changes. Continue and lose them?')) return;
        fieldDate.value = newVal;
    }
    lastFieldDate = fieldDate.value;
    renderWeekGrid();
    // Banner year follows the week being viewed (when no alFrom date is set)
    updateALBanner();
    updateALBookedBox();
    updateSickBookedBox();
});

// ============================================
// OVERRIDES LIST
// ============================================
let allOverrides = [];



/**
 * Loads all override documents from Firestore into the allOverrides module-level
 * array, then renders the table, week grid, and AL/sick summary boxes.
 * On failure shows an inline error with a reload link.
 */
async function loadOverrides() {
    tableBody.innerHTML = '<tr class="state-row"><td colspan="8"><span class="spinner"></span>Loading…</td></tr>';
    try {
        const snap = await getDocs(query(collection(db, 'overrides'), orderBy('date', 'desc'), limit(2000)));
        allOverrides = [];
        snap.forEach(s => allOverrides.push({ id: s.id, ...s.data() }));
        renderTable();
        // Re-render week grid so existing-override detection is current
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
    } catch (err) {
        console.error('[Admin] Load failed:', err);
        tableBody.innerHTML = '<tr class="state-row"><td colspan="8">Couldn\'t load saved changes.<br><span class="reload-link" id="reloadLink">↻ Reload page</span></td></tr>';
        document.getElementById('reloadLink')?.addEventListener('click', () => location.reload());
        listCount.textContent = 'Error';
    }
}

/**
 * Renders the Saved Changes table from the allOverrides in-memory array.
 * Filtered to the currently selected member (if one is chosen) and by the
 * selected month/year from the overridesMonthFilter dropdown.
 * Rebuilds the month dropdown options each time from available data.
 */
function renderTable() {
    const memberFilter = fieldMember.value;
    const memberRows   = memberFilter
        ? allOverrides.filter(o => o.memberName === memberFilter)
        : allOverrides;

    // Rebuild month dropdown from data available after the member filter
    if (overridesMonthFilter) {
        const months     = [...new Set(memberRows.map(o => (o.date || '').substring(0, 7)))]
            .filter(Boolean)
            .sort((a, b) => b.localeCompare(a));
        const isFirstRender = !overridesMonthFilter.dataset.initialized;
        const today         = new Date();
        const currentMonth  = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const prevValue     = isFirstRender ? currentMonth : overridesMonthFilter.value;
        overridesMonthFilter.dataset.initialized = '1';
        overridesMonthFilter.innerHTML = '<option value="">All months</option>';
        months.forEach(ym => {
            const [y, m] = ym.split('-');
            const label  = `${new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'long' })} ${y}`;
            const opt    = document.createElement('option');
            opt.value    = ym;
            opt.textContent = label;
            if (ym === prevValue) opt.selected = true;
            overridesMonthFilter.appendChild(opt);
        });
    }

    const monthFilter = overridesMonthFilter ? overridesMonthFilter.value : '';
    const rows = monthFilter
        ? memberRows.filter(o => (o.date || '').startsWith(monthFilter))
        : memberRows;
    listCount.textContent = `${rows.length} saved change${rows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
        tableBody.innerHTML = '<tr class="state-row"><td colspan="8">No saved changes.</td></tr>';
        return;
    }

    tableBody.innerHTML = '';
    if (selectAllOverrides) selectAllOverrides.checked = false;
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
    rows.forEach(o => {
        const typeMeta = TYPES[o.type];
        const isLegacyType = ['allocated', 'overtime', 'swap'].includes(o.type);
        const tr   = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="row-select" data-id="${o.id}" aria-label="Select ${esc(o.memberName)} ${o.date}"></td>
            <td style="white-space:nowrap;font-weight:600">${formatDisplay(o.date)}</td>
            <td>${esc(o.memberName)}</td>
            <td><span class="list-type-pill lpill-${o.type}">${typeMeta ? typeMeta.label : esc(o.type)}</span>${isLegacyType ? '<span class="legacy-pill">legacy</span>' : ''}</td>
            <td style="font-family:monospace;font-size:12px">${esc(o.value)}</td>
            <td style="color:var(--text-light);font-style:italic">${esc(o.note)}${o.source === 'roster_import' ? '<span class="source-pill">PDF upload</span>' : ''}</td>
            <td>
                <button class="btn-edit" data-member="${esc(o.memberName)}" data-date="${o.date}" aria-label="Edit ${esc(o.memberName)} ${o.date}">Edit</button>
            </td>
            <td>
                <button class="btn-delete" data-id="${o.id}" aria-label="Delete ${esc(o.memberName)} ${o.date}">Delete</button>
            </td>`;
        tableBody.appendChild(tr);
    });
    tableBody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', handleDelete));
    tableBody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', handleEdit));
    tableBody.querySelectorAll('.row-select').forEach(checkbox => checkbox.addEventListener('change', updateBulkDeleteVisibility));
}

/** Shows or hides the "Delete selected" button based on how many rows are checked. */
function updateBulkDeleteVisibility() {
    const checkedCount = tableBody.querySelectorAll('.row-select:checked').length;
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = checkedCount > 0 ? 'inline-block' : 'none';
    if (selectAllOverrides) {
        const total = tableBody.querySelectorAll('.row-select').length;
        selectAllOverrides.checked = total > 0 && checkedCount === total;
        selectAllOverrides.indeterminate = checkedCount > 0 && checkedCount < total;
    }
}

// Select-all checkbox — checks/unchecks every visible row and updates the button visibility.
if (selectAllOverrides) {
    selectAllOverrides.addEventListener('change', () => {
        tableBody.querySelectorAll('.row-select').forEach(checkbox => { checkbox.checked = selectAllOverrides.checked; });
        updateBulkDeleteVisibility();
    });
}

// Bulk delete — deletes all checked rows in one Firestore batch.
if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
        const checkedRows = [...tableBody.querySelectorAll('.row-select:checked')];
        if (!checkedRows.length) return;
        const ids = checkedRows.map(checkbox => checkbox.dataset.id);
        bulkDeleteBtn.disabled = true;
        bulkDeleteBtn.textContent = `Deleting ${ids.length}…`;
        try {
            const batch = writeBatch(db);
            ids.forEach(id => batch.delete(doc(db, 'overrides', id)));
            await batch.commit();
            allOverrides = allOverrides.filter(o => !ids.includes(o.id));
            renderTable();
            updateALBanner();
            updateALBookedBox();
            updateSickBookedBox();
            if (fieldMember.value && fieldDate.value) renderWeekGrid();
            if (listFeedback) {
                listFeedback.textContent = `✓ Deleted ${ids.length} saved change${ids.length !== 1 ? 's' : ''}`;
                listFeedback.className = 'list-feedback success';
                setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
            }
        } catch (err) {
            console.error('[Admin] Bulk delete failed:', err);
            bulkDeleteBtn.disabled = false;
            bulkDeleteBtn.textContent = 'Delete selected';
            if (listFeedback) {
                const msg = err.code === 'unavailable'
                    ? '⚠ You appear to be offline — reconnect and try again.'
                    : '⚠ Bulk delete failed — check your connection and try again.';
                listFeedback.textContent = msg;
                listFeedback.className = 'list-feedback error';
            }
        }
    });
}

/**
 * Handles delete button clicks in the Saved Changes table.
 * First click changes the label to "⚠ Delete?" (5 s to confirm); second click
 * deletes the document from Firestore and removes it from the in-memory cache.
 * @param {MouseEvent} e
 */
async function handleDelete(e) {
    const btn = e.currentTarget;
    if (!btn.classList.contains('confirming')) {
        btn.classList.add('confirming');
        btn.textContent = '⚠ Delete?';
        setTimeout(() => {
            if (btn.classList.contains('confirming')) {
                btn.classList.remove('confirming');
                btn.textContent = 'Delete';
            }
        }, 5000);
        return;
    }

    // Capture what we're deleting before removing it
    const deleted = allOverrides.find(o => o.id === btn.dataset.id);

    btn.disabled = true;
    btn.textContent = '…';
    try {
        await deleteDoc(doc(db, 'overrides', btn.dataset.id));
        allOverrides = allOverrides.filter(o => o.id !== btn.dataset.id);
        renderTable();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        // Re-render week grid to clear the "change saved" badge if this date is visible
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
        // Brief confirmation of what was removed
        if (deleted && listFeedback) {
            const typeMeta = TYPES[deleted.type];
            listFeedback.textContent = `✓ Deleted: ${deleted.memberName} — ${formatDisplay(deleted.date)} (${typeMeta ? typeMeta.label : deleted.type})`;
            listFeedback.className = 'list-feedback success';
            setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
        }
    } catch (err) {
        console.error('[Admin] Delete failed:', err);
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
        if (listFeedback) {
            const msg = err.code === 'unavailable'
                ? '⚠ You appear to be offline — reconnect and try again.'
                : '⚠ Could not delete — check your connection and try again.';
            listFeedback.textContent = msg;
            listFeedback.className = 'list-feedback error';
        }
    }
}

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
    if (!confirmNavigate()) return;
    // Populate selectors and re-render the week grid
    fieldMember.value = memberName;
    fieldDate.value   = date;
    lastFieldDate     = date;
    localStorage.setItem('adminLastMember', memberName);
    localStorage.setItem('myb_roster_selected_member', memberName);
    renderWeekGrid();
    // Scroll to the override form card
    document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================
// TIME INPUT AUTO-FORMAT + INLINE VALIDATION
// ============================================
// Typing 4 digits auto-inserts the colon: "0730" → "07:30"
document.addEventListener('input', e => {
    if (!e.target.classList.contains('time-input')) return;
    const timeInput  = e.target;
    // Clear error while user is typing so the red border doesn't linger mid-edit
    timeInput.classList.remove('input-error');
    const raw = timeInput.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (raw.length >= 3) {
        timeInput.value = raw.slice(0, 2) + ':' + raw.slice(2);
    } else {
        timeInput.value = raw;
    }
});

// On blur: validate completed time and show inline error if malformed
document.addEventListener('focusout', e => {
    if (!e.target.classList.contains('time-input')) return;
    const timeInput  = e.target;
    const val = timeInput.value.trim();
    if (!val) { timeInput.classList.remove('input-error'); return; } // empty is fine (caught on save)
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRe.test(val)) {
        timeInput.classList.add('input-error');
    } else {
        timeInput.classList.remove('input-error');
    }
});

// ============================================
// UTILITIES
// ============================================
// formatISO and isSunday are imported from roster-data.js

/** Formats YYYY-MM-DD as a readable date string: "18 Mar 2026".
 *  Returns "—" for empty/null input.
 *  @param {string} str  YYYY-MM-DD
 *  @returns {string} */

// ---- Shift rule helpers ----

// Parse "HH:MM" → total minutes from midnight
function parseMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

// Effective end in minutes from midnight of the START day.
// Overnight shifts (end < start) add 24 h so gap maths stays consistent.
function effectiveEndMins(startStr, endStr) {
    const s = parseMinutes(startStr);
    const e = parseMinutes(endStr);
    return e >= s ? e : e + 24 * 60;
}

// Human-readable hours: 450 → "7.5h", 720 → "12h"
function fmtHours(mins) {
    const h = mins / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h';
}

// Return the effective shift value string for memberName on dateISO.
// Checks the pending save batch first, then existing overrides, then base roster.
/**
 * Returns the effective shift value for a member on a given date, checking
 * the pending save batch first, then allOverrides, then the base roster.
 * Used by validateShiftRules to calculate rest gaps across day boundaries.
 * @param {string}   memberName
 * @param {string}   dateISO  YYYY-MM-DD
 * @param {Array}    batch    The toSave array being validated (may override allOverrides)
 * @returns {string} shift value e.g. "07:00-15:00" or "RD"
 */
function getEffectiveShift(memberName, dateISO, batch) {
    const inBatch = batch.find(e => e.date === dateISO);
    if (inBatch) return inBatch.value;
    const inOverrides = allOverrides.find(o => o.memberName === memberName && o.date === dateISO);
    if (inOverrides) return inOverrides.value;
    const member = teamMembers.find(m => m.name === memberName);
    if (!member) return 'RD';
    return getBaseShift(member, new Date(dateISO + 'T12:00:00'));
}

/**
 * Validates max shift duration (12 h) and minimum rest gap (12 h) between consecutive
 * shifts for all entries in toSave. Also marks failing rows with .row-error in the DOM.
 * @param {Array}  toSave      The pending save batch from the week editor
 * @param {string} memberName
 * @returns {string[]} Array of human-readable error strings (empty = no violations)
 */
function validateShiftRules(toSave, memberName) {
    const ruleErrors = [];

    toSave.forEach(entry => {
        const { date, value, type } = entry;
        if (TYPES[type]?.fixed) return;           // AL / Make Rest Day — no times
        if (!value || !value.includes('-')) return; // RD, SPARE, etc.

        const [startStr, endStr] = value.split('-');
        const startMins = parseMinutes(startStr);
        const endMins   = effectiveEndMins(startStr, endStr); // may exceed 1440 for overnight

        const markRow = () => {
            const row = weekGrid.querySelector(`.day-row[data-date="${date}"]`);
            if (row) row.classList.add('row-error');
        };

        // 1. Duration check (max 12 h)
        const duration = endMins - startMins;
        if (duration > 12 * 60) {
            markRow();
            ruleErrors.push(`${formatDisplay(date)}: shift is ${fmtHours(duration)} — max is 12h`);
        }

        // 2. Gap with previous calendar day (prev shift end → this shift start)
        const prevDate = new Date(date + 'T12:00:00');
        prevDate.setDate(prevDate.getDate() - 1);
        const prevISO   = formatISO(prevDate);
        const prevShift = getEffectiveShift(memberName, prevISO, toSave);

        if (prevShift && prevShift.includes('-')) {
            const [ps, pe] = prevShift.split('-');
            const prevEffEnd = effectiveEndMins(ps, pe);
            // This shift starts startMins into the *next* calendar day from prevShift's start
            const gap = (startMins + 24 * 60) - prevEffEnd;
            if (gap < 12 * 60) {
                markRow();
                ruleErrors.push(
                    `${formatDisplay(date)}: only ${fmtHours(gap)} rest after ${formatDisplay(prevISO)} shift — need 12h`
                );
            }
        }

        // 3. Gap with next calendar day (this shift end → next shift start)
        const nextDate = new Date(date + 'T12:00:00');
        nextDate.setDate(nextDate.getDate() + 1);
        const nextISO   = formatISO(nextDate);
        const nextShift = getEffectiveShift(memberName, nextISO, toSave);

        if (nextShift && nextShift.includes('-')) {
            const [ns] = nextShift.split('-');
            const nextStartMins = parseMinutes(ns);
            const gap = (nextStartMins + 24 * 60) - endMins;
            if (gap < 12 * 60) {
                markRow();
                ruleErrors.push(
                    `${formatDisplay(date)}: only ${fmtHours(gap)} rest before ${formatDisplay(nextISO)} shift — need 12h`
                );
            }
        }
    });

    return ruleErrors;
}

function formatDisplay(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${parseInt(d,10)} ${MONTH_ABB[parseInt(m,10)-1]} ${y}`;
}

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
            const ov = allOverrides.find(o => o.memberName === memberObj.name && o.date === dateStr);
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

alFrom.addEventListener('change',   () => { updateAlPreview(); updateALBanner(); updateALBookedBox(); });
alTo.addEventListener('change',     () => { updateAlPreview(); updateALBanner(); updateALBookedBox(); });
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
        const entitlement    = getALEntitlement(memberObj, parseInt(yearStr, 10), allOverrides);
        // Sundays are uncontracted — exclude from entitlement counts
        const existingAL     = allOverrides.filter(o =>
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
            const ov = allOverrides.find(o => o.memberName === member && o.date === dateStr);
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
            const existing = allOverrides.find(o => o.memberName === member && o.date === date);
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

        alFrom.value = alTo.value = '';
        updateAlPreview();

        // Update allOverrides in-memory — no Firestore round-trip needed
        allOverrides = allOverrides.filter(o => !alDeletedIds.has(o.id));
        allOverrides.push(...alNewDocs);
        allOverrides.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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

    if (dates.length > 60) {
        sickPreview.className = 'al-preview sick-preview error';
        sickPreview.textContent = `That's ${dates.length} days — maximum range is 60 days.`;
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
            if (base === 'RD' || base === 'OFF') restCount++;
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
            return base !== 'RD' && base !== 'OFF';
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
            const existing = allOverrides.find(o => o.memberName === member && o.date === date);
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

        sickFrom.value = sickTo.value = '';
        updateSickPreview();

        // Update in-memory cache — no Firestore round-trip needed
        allOverrides = allOverrides.filter(o => !sickDeletedIds.has(o.id));
        allOverrides.push(...sickNewDocs);
        allOverrides.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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
    const toDelete = allOverrides.filter(o =>
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
        allOverrides = allOverrides.filter(o => !ids.has(o.id));
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

    const entries = allOverrides.filter(o =>
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

    const entries = allOverrides.filter(o =>
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

        // For DOCX files, convert to HTML in the browser before uploading.
        // The HTML is stored in Firestore alongside the file URL so the viewer
        // can display it directly — no CORS fetch or external viewer needed.
        let htmlContent = null;
        const isDocx = file.name.toLowerCase().endsWith('.docx');
        if (isDocx) {
            uploadBtn.textContent = 'Converting…';
            await new Promise((resolve, reject) => {
                if (window.mammoth) { resolve(); return; }
                const s = document.createElement('script');
                s.src     = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
                s.onload  = resolve;
                s.onerror = () => reject(new Error('Could not load converter'));
                document.head.appendChild(s);
            });
            const arrayBuffer = await file.arrayBuffer();
            const result      = await mammoth.convertToHtml({ arrayBuffer });
            htmlContent       = result.value || null;
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
        allOverrides = allOverrides.filter(o => !removedIds.has(o.id));
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
// ============================================
// Registers the shared service worker so admin.html benefits from caching.
// When a new SW finishes installing and is waiting, shows the update toast
// instead of reloading immediately — lets the user decide when to refresh.
if ('serviceWorker' in navigator) {
    const updateToast = document.getElementById('updateToast');
    const updateBtn   = document.getElementById('updateToastBtn');
    let swRegistration = null;
    let updateToastTimer = null;

    function showUpdateToast() {
        if (!updateToast) return;
        updateToast.classList.add('visible');
        clearTimeout(updateToastTimer);
        updateToastTimer = setTimeout(() => updateToast.classList.remove('visible'), 12000);
    }

    navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
            swRegistration = registration;

            // A new SW is already waiting (page was loaded while one was pending)
            if (registration.waiting) showUpdateToast();

            // A new SW starts downloading — watch for it to finish installing
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateToast();
                    }
                });
            });

            // Poll for updates every 60 minutes (catches long-lived sessions).
            // Cleared on hidden and restarted on visible to avoid background network traffic.
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

    // "Refresh now" button — sends SKIP_WAITING then reloads once the new SW takes control
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            clearTimeout(updateToastTimer);
            updateBtn.textContent = 'Updating…';
            updateBtn.disabled    = true;

            if (swRegistration?.waiting) {
                // Normal case: new SW installed and waiting — tell it to activate
                swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    window.location.reload();
                }, { once: true });
            } else {
                // SW already auto-activated via skipWaiting() on install —
                // the new version is in control; just reload to run it.
                window.location.reload();
            }
        });
    }
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

(function initRosterUpload() {
    if (!currentIsAdmin) return;

    const card            = document.getElementById('rosterUploadCard');
    const rosterTypeEl    = document.getElementById('rosterType');
    const weekEndingEl    = document.getElementById('rosterWeekEnding');
    const fileInput       = document.getElementById('rosterFileInput');
    const fileNameEl      = document.getElementById('rosterFileName');
    const parseBtn        = document.getElementById('rosterParseBtn');
    const parseFeedback   = document.getElementById('rosterParseFeedback');
    const reviewSection   = document.getElementById('rosterReviewSection');
    const conflictBanner  = document.getElementById('rosterConflictBanner');
    const conflictTitle   = document.getElementById('rosterConflictTitle');
    const conflictDetail  = document.getElementById('rosterConflictDetail');
    const reviewLabel     = document.getElementById('rosterReviewLabel');
    let   changeList      = document.getElementById('rosterChangeList');
    const applyBtn        = document.getElementById('rosterApplyBtn');
    const cancelBtn       = document.getElementById('rosterCancelBtn');
    const applyFeedback   = document.getElementById('rosterApplyFeedback');

    if (!card || !rosterTypeEl || !weekEndingEl || !fileInput || !parseBtn) return;

    // Reveal the card for admin users
    card.style.display = '';

    // In-memory store for the parsed result and computed cell states.
    // Cleared when "Start over" is clicked.
    let _parsedResult = null;      // response from parseRosterPDF Cloud Function
    let _cellStates   = null;      // computed Map: "memberName|date" → { state, parsedShift, manualValue, manualId, chosen }

    // ---- Week ending defaults to next Saturday ----
    // All roster PDFs end on a Saturday. If today is already Saturday, default
    // to next Saturday (the upcoming week, not today).
    (function setDefaultWeekEnding() {
        const today = new Date();
        const day   = today.getDay(); // 0=Sun … 6=Sat
        const daysUntilNextSaturday = day === 6 ? 7 : 6 - day;
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + daysUntilNextSaturday);
        weekEndingEl.value = formatISO(nextSaturday);
    })();

    // ---- Snap any non-Saturday selection to the nearest Saturday ----
    // HTML date inputs have no built-in day-of-week restriction, so we enforce
    // it here: if the user picks a date that isn't a Saturday, we move it forward
    // to the next Saturday automatically.
    weekEndingEl.addEventListener('change', () => {
        if (!weekEndingEl.value) return;
        const picked = new Date(weekEndingEl.value + 'T12:00:00');
        const day    = picked.getDay(); // 0=Sun … 6=Sat
        if (day !== 6) {
            const daysToSaturday = day === 0 ? 6 : 6 - day;
            picked.setDate(picked.getDate() + daysToSaturday);
            weekEndingEl.value = formatISO(picked);
        }
    });

    // ---- Show chosen filename and enable parse button ----
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        if (!file) {
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;
            return;
        }
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;
            parseFeedback.textContent = 'Please choose a PDF file';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;
            parseFeedback.textContent = 'File too large — maximum 20 MB';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        fileNameEl.textContent   = file.name;
        fileNameEl.style.display = '';
        parseBtn.disabled        = false;
    });

    // ---- "Read Roster" button ----
    parseBtn.addEventListener('click', async () => {
        const file      = fileInput.files[0];
        const weekEnding = weekEndingEl.value;
        const rosterType = rosterTypeEl.value;

        if (!file || !weekEnding) return;

        // Reset UI
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        reviewSection.style.display = 'none';
        parseBtn.disabled           = true;
        parseBtn.textContent        = 'Reading…';

        try {
            // Convert file to base64 — same technique as ingestHuddle
            const base64 = await fileToBase64(file);

            // Call the Cloud Function
            parseFeedback.textContent = 'Reading the PDF — this takes about 15 seconds…';
            parseFeedback.className   = 'huddle-feedback';

            const response = await fetch(PARSE_ROSTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization':  `Bearer ${ROSTER_SECRET_VALUE}`,
                    'Content-Type':   'text/plain',
                    'X-Week-Ending':  weekEnding,
                    'X-Roster-Type':  rosterType,
                },
                body: base64,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server error (${response.status})`);
            }

            _parsedResult = await response.json();
            parseFeedback.textContent = '';

            // Fetch existing overrides for this week from Firestore so we can detect conflicts
            parseFeedback.textContent = 'Checking for existing schedule changes…';
            const existingOverrides = await fetchOverridesForWeek(_parsedResult.dates);
            parseFeedback.textContent = '';

            // Compute cell states and render the review table
            _cellStates = computeCellStates(_parsedResult, existingOverrides);
            renderReviewTable(_parsedResult, _cellStates);

        } catch (err) {
            console.error('[RosterUpload] Parse failed:', err);
            const userMsg = (err instanceof TypeError && err.message === 'Failed to fetch')
                ? 'Could not reach the server — the Cloud Function may not be deployed yet, or check your internet connection.'
                : err.message;
            parseFeedback.textContent = `Could not read the roster: ${userMsg}`;
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
        } finally {
            parseBtn.disabled    = false;
            parseBtn.textContent = 'Read Roster';
        }
    });

    // ---- "Start over" button ----
    cancelBtn.addEventListener('click', () => {
        reviewSection.style.display = 'none';
        _parsedResult = null;
        _cellStates   = null;
        fileInput.value           = '';
        fileNameEl.style.display  = 'none';
        parseBtn.disabled         = true;
        applyFeedback.textContent = '';
        applyFeedback.className   = 'huddle-feedback';
    });

    // ---- "Apply approved changes" button ----
    applyBtn.addEventListener('click', async () => {
        if (!_parsedResult || !_cellStates) return;

        // Collect all DIFF cells that are ticked (approved) + any CONFLICT cells
        // where the admin chose "Use PDF"
        const toWrite = [];

        for (const [key, state] of _cellStates) {
            const [memberName, date] = key.split('|');

            if (state.state === 'DIFF' && state.chosen !== false) {
                // Use the edited value if the admin changed it, otherwise the parsed value
                toWrite.push({ memberName, date, value: state.editedValue ?? state.parsedShift, baseShift: state.baseShift });
            }
            if (state.state === 'CONFLICT' && state.chosen === 'pdf') {
                toWrite.push({ memberName, date, value: state.parsedShift, baseShift: state.baseShift });
            }
        }

        if (toWrite.length === 0) {
            applyFeedback.textContent = 'Nothing to save — all changes are either skipped or already up to date.';
            applyFeedback.className   = 'huddle-feedback';
            return;
        }

        applyBtn.disabled    = true;
        applyBtn.textContent = `Saving ${toWrite.length} change${toWrite.length !== 1 ? 's' : ''}…`;
        applyFeedback.textContent = '';

        try {
            const batch = writeBatch(db);

            for (const { memberName, date, value, baseShift } of toWrite) {
                // Map shift value to override type — pass date so Sunday shifts are
                // correctly saved as 'rdw' and explicit RDW| prefix is honoured
                const type = shiftValueToOverrideType(value, baseShift, date);
                // Strip the internal "RDW|" encoding before saving — Firestore stores
                // the plain time as the value (e.g. "14:30-22:00"), type field carries 'rdw'
                const savedValue = value.startsWith('RDW|') ? value.slice(4) : value;
                const ref  = doc(collection(db, 'overrides'));
                batch.set(ref, {
                    memberName,
                    date,
                    type,
                    value: savedValue,
                    note:       '',
                    source:     'roster_import',   // marks this as auto-applied, not hand-entered
                    createdAt:  serverTimestamp(),
                    changedBy:  currentUser,
                });
            }

            await batch.commit();

            // Update the in-memory override cache so the week grid and table refresh
            // without a round-trip to Firestore.  We don't know the new doc IDs but
            // loadOverrides() will re-fetch cleanly.
            await loadOverrides();

            applyFeedback.textContent = `Done — ${toWrite.length} shift${toWrite.length !== 1 ? 's' : ''} saved to the roster.`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--ok';

            // Clear the review table so it can't be applied twice
            reviewSection.style.display = 'none';
            _parsedResult = null;
            _cellStates   = null;
            fileInput.value          = '';
            fileNameEl.style.display = 'none';
            parseBtn.disabled        = true;

        } catch (err) {
            console.error('[RosterUpload] Apply failed:', err);
            const detail = err?.code === 'permission-denied'
                ? 'Permission denied — the Firestore security rules may need updating. Check the browser console for details.'
                : (err?.message || 'Unknown error — check the browser console.');
            applyFeedback.textContent = `Could not save: ${detail}`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--err';
            applyBtn.disabled    = false;
            applyBtn.textContent = 'Save changes';
        }
    });

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------

    /**
     * Read a File object and return its contents as a base64 string.
     * @param {File} file
     * @returns {Promise<string>}
     */
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => {
                // result is "data:application/pdf;base64,AAAA…" — strip the prefix
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('Could not read the file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Fetch all override documents for a specific set of dates from Firestore.
     * We only fetch dates in the roster week — no need to load the full cache.
     *
     * @param {string[]} dates - Array of YYYY-MM-DD strings (the 7 days of the week)
     * @returns {Promise<Array>} Array of override objects { id, memberName, date, value, source, ... }
     */
    async function fetchOverridesForWeek(dates) {
        try {
            const q    = query(collection(db, 'overrides'), where('date', 'in', dates));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (err) {
            console.error('[RosterUpload] Could not fetch existing overrides:', err);
            return [];   // Non-fatal — means we may miss conflicts, but won't crash
        }
    }

    /**
     * Compute the state of every (member, date) cell in the review table.
     *
     * Returns a Map keyed by "memberName|date" with values:
     *   { state: 'MATCH'|'DIFF'|'CONFLICT'|'COVERED', parsedShift, baseShift,
     *     manualValue?, manualId?, chosen }
     *
     * State meanings:
     *   MATCH    — PDF matches base roster, no override → nothing to do
     *   DIFF     — PDF differs from base roster, no manual override → propose change
     *   CONFLICT — A manually entered override exists that differs from the PDF → flag it
     *   COVERED  — A manual override exists and already matches the PDF → nothing to do
     *
     * @param {object} parsedResult  - Response from parseRosterPDF
     * @param {Array}  existingOverrides - Overrides already in Firestore for this week
     * @returns {Map}
     */
    function computeCellStates(parsedResult, existingOverrides) {
        const states = new Map();

        // Build a quick lookup: "memberName|date" → override doc
        const overrideMap = new Map();
        for (const o of existingOverrides) {
            overrideMap.set(`${o.memberName}|${o.date}`, o);
        }

        for (const entry of parsedResult.parsed) {
            // Only process names that exist in teamMembers (not hidden)
            const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
            if (!member) continue;

            for (const date of parsedResult.dates) {
                const parsedShift  = entry.shifts[date] || 'RD';
                const baseShift    = getBaseShift(member, new Date(date + 'T12:00:00'));
                const key          = `${entry.memberName}|${date}`;
                const existing     = overrideMap.get(key);

                // Determine whether the existing override is manual or a previous import
                const isManual = existing
                    ? (existing.source !== 'roster_import')   // no source field → treat as manual
                    : false;

                // Normalise parsedShift for comparisons — strip the "RDW|" encoding so
                // "RDW|14:30-22:00" compares correctly against a stored value "14:30-22:00"
                const parsedValue = parsedShift.startsWith('RDW|') ? parsedShift.slice(4) : parsedShift;

                let state;
                if (!existing || !isManual) {
                    // No override (or only a previous import) — compare PDF vs base roster
                    if (parsedShift === baseShift || parsedValue === baseShift) {
                        state = 'MATCH';
                    } else {
                        state = 'DIFF';
                    }
                } else {
                    // A manual override exists — check if it already matches the PDF
                    if (existing.value === parsedShift || existing.value === parsedValue) {
                        state = 'COVERED';   // manual is already correct — nothing to do
                    } else {
                        state = 'CONFLICT';  // manual differs from PDF — flag it
                    }
                }

                states.set(key, {
                    state,
                    parsedShift,
                    baseShift,
                    manualValue: existing?.value ?? null,
                    manualId:    existing?.id    ?? null,
                    editedValue: null,    // set if admin edits a DIFF cell
                    chosen:      state === 'DIFF' ? true : null,
                    // 'chosen' for DIFF = true (approved) or false (skipped)
                    // 'chosen' for CONFLICT = 'manual' (default) or 'pdf'
                });
            }
        }

        return states;
    }

    /**
     * Render the review table from the parsed result and computed cell states.
     * Shows only rows that have at least one DIFF or CONFLICT cell.
     *
     * @param {object} parsedResult
     * @param {Map}    cellStates
     */
    /**
     * Render the post-parse review UI as a list of per-person cards.
     * Only people with at least one DIFF or CONFLICT are shown.
     * Uses event delegation on changeList so no listener accumulation on re-render.
     */
    function renderReviewTable(parsedResult, cellStates) {
        const { dates, parsed, weekEnding } = parsedResult;
        const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

        // Returns badge HTML + the raw time for worked shifts so the user sees
        // both the shift type (Early/Late/Night/RDW etc.) and the actual times.
        //
        // The AI now returns "RDW|HH:MM-HH:MM" (pipe-encoded) for cells explicitly
        // marked RDW in the PDF — this works on any base shift including SPARE weeks.
        // RDW is only inferred (without the prefix) for Sunday shifts, which are always
        // uncontracted — any Sunday shift is by definition an RDW.
        function shiftDisplay(shiftStr, baseShift = null, date = null) {
            // Pipe-encoded RDW: "RDW|14:30-22:00" — explicit flag from AI
            if (typeof shiftStr === 'string' && shiftStr.startsWith('RDW|')) {
                const time  = shiftStr.slice(4);
                const badge = getShiftBadge('RDW');
                return `${badge}<span class="review-shift-time">${esc(time)}</span>`;
            }
            const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shiftStr);
            // Sunday is always uncontracted — any shift worked on a Sunday is an RDW
            const isSunday = isTime && date !== null && new Date(date + 'T12:00:00Z').getUTCDay() === 0;
            const badge  = getShiftBadge(isSunday ? 'RDW' : shiftStr);
            return isTime
                ? `${badge}<span class="review-shift-time">${esc(shiftStr)}</span>`
                : badge;
        }

        // ---- Count totals for banner + label ----
        let diffCount = 0, conflictCount = 0;
        const conflictLines = [];
        for (const [key, s] of cellStates) {
            if (s.state === 'DIFF') diffCount++;
            if (s.state === 'CONFLICT') {
                conflictCount++;
                const [memberName, date] = key.split('|');
                const dt = new Date(date + 'T12:00:00');
                conflictLines.push(
                    `${esc(memberName)} — ${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}: ` +
                    `saved <strong>${esc(s.manualValue)}</strong>, PDF says <strong>${esc(s.parsedShift.startsWith('RDW|') ? 'RDW ' + s.parsedShift.slice(4) : s.parsedShift)}</strong>`
                );
            }
        }

        // ---- Conflict banner ----
        if (conflictCount > 0) {
            conflictTitle.textContent    = `${conflictCount} conflict${conflictCount !== 1 ? 's' : ''} — manually saved entries are protected`;
            conflictDetail.innerHTML     = conflictLines.join('<br>');
            conflictBanner.style.display = '';
        } else {
            conflictBanner.style.display = 'none';
        }

        // ---- Build per-person sections ----
        changeList.innerHTML = '';
        let sectionsShown = 0;

        for (const entry of parsed) {
            const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
            if (!member) continue;

            const changedDates = dates.filter(d => {
                const s = cellStates.get(`${entry.memberName}|${d}`);
                return s && (s.state === 'DIFF' || s.state === 'CONFLICT');
            });
            if (changedDates.length === 0) continue;

            const section = document.createElement('div');
            section.className = 'roster-person-section';
            section.dataset.member = entry.memberName;

            // Person header
            section.innerHTML = `
                <div class="roster-person-header">
                    <span class="roster-person-name">${esc(entry.memberName)}</span>
                    <span class="roster-change-badge">${changedDates.length}</span>
                    <button class="roster-skip-all-btn" data-member="${esc(entry.memberName)}">Skip all</button>
                </div>`;

            // One row per changed day
            for (const date of changedDates) {
                const key = `${entry.memberName}|${date}`;
                const s   = cellStates.get(key);
                const dt  = new Date(date + 'T12:00:00');
                const dayName = DAY_NAMES[dt.getDay()];
                const dateStr = `${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;

                const row = document.createElement('div');
                row.className  = `roster-change-row${s.state === 'CONFLICT' ? ' roster-change-conflict' : ''}`;
                row.dataset.key = key;

                if (s.state === 'DIFF') {
                    const approved = s.chosen !== false;
                    row.innerHTML = `
                        <div class="roster-chg-day">
                            <span class="roster-day-abbr">${dayName}</span>
                            <span class="roster-day-date">${dateStr}</span>
                        </div>
                        <div class="roster-chg-vals">
                            <span class="roster-from-val">${shiftDisplay(s.baseShift)}</span>
                            <span class="roster-arrow">→</span>
                            <span class="roster-to-val">${shiftDisplay(s.parsedShift, s.baseShift, date)}</span>
                        </div>
                        <button class="roster-approve-btn ${approved ? 'is-approved' : 'is-skipped'}" data-key="${esc(key)}">
                            ${approved ? 'Save' : 'Skip'}
                        </button>`;
                } else {
                    // CONFLICT — show Manual vs PDF toggle, defaulting to Manual
                    const usesPDF = s.chosen === 'pdf';
                    row.innerHTML = `
                        <div class="roster-chg-day">
                            <span class="roster-day-abbr">${dayName}</span>
                            <span class="roster-day-date">${dateStr}</span>
                        </div>
                        <div class="roster-chg-vals">
                            <span class="roster-conflict-icon-sm">⚠</span>
                            <span class="roster-manual-val ${usesPDF ? 'val-dim' : 'val-active'}">${shiftDisplay(s.manualValue)}</span>
                            <span class="roster-vs-sep">vs</span>
                            <span class="roster-manual-val ${usesPDF ? 'val-active' : 'val-dim'}">${shiftDisplay(s.parsedShift, s.baseShift, date)}</span>
                        </div>
                        <div class="roster-conflict-choice">
                            <button class="roster-choice-btn ${!usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="manual">Manual</button>
                            <button class="roster-choice-btn ${usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="pdf">PDF</button>
                        </div>`;
                }
                section.appendChild(row);
            }

            changeList.appendChild(section);
            sectionsShown++;
        }

        // ---- Event delegation (replace old listener to avoid accumulation) ----
        const newList = changeList.cloneNode(true);
        changeList.parentNode.replaceChild(newList, changeList);
        changeList = newList;

        changeList.addEventListener('click', e => {
            // Save / Skip toggle on DIFF rows
            const approveBtn = e.target.closest('.roster-approve-btn');
            if (approveBtn) {
                const s = cellStates.get(approveBtn.dataset.key);
                if (!s) return;
                s.chosen = !s.chosen;
                approveBtn.classList.toggle('is-approved', s.chosen !== false);
                approveBtn.classList.toggle('is-skipped',  s.chosen === false);
                approveBtn.textContent = (s.chosen !== false) ? 'Save' : 'Skip';
                approveBtn.closest('.roster-change-row').classList.toggle('is-skipped', s.chosen === false);
                return;
            }

            // Skip all / Restore for a person
            const skipAllBtn = e.target.closest('.roster-skip-all-btn');
            if (skipAllBtn) {
                const memberName = skipAllBtn.dataset.member;
                const sec = changeList.querySelector(`.roster-person-section[data-member="${CSS.escape(memberName)}"]`);
                if (!sec) return;
                const nowSkipped = !sec.classList.contains('section-skipped');
                sec.classList.toggle('section-skipped', nowSkipped);
                skipAllBtn.textContent = nowSkipped ? 'Restore' : 'Skip all';
                sec.querySelectorAll('.roster-approve-btn').forEach(btn => {
                    const s = cellStates.get(btn.dataset.key);
                    if (!s) return;
                    s.chosen = !nowSkipped;
                    btn.classList.toggle('is-approved', !nowSkipped);
                    btn.classList.toggle('is-skipped',  nowSkipped);
                    btn.textContent = nowSkipped ? 'Skip' : 'Save';
                });
                return;
            }

            // Manual / PDF choice on CONFLICT rows
            const choiceBtn = e.target.closest('.roster-choice-btn');
            if (choiceBtn) {
                const s = cellStates.get(choiceBtn.dataset.key);
                if (!s) return;
                s.chosen = choiceBtn.dataset.pick;
                choiceBtn.closest('.roster-conflict-choice').querySelectorAll('.roster-choice-btn').forEach(b => {
                    b.classList.toggle('is-chosen', b.dataset.pick === s.chosen);
                });
                // Update the value pills to show which is active
                const row = choiceBtn.closest('.roster-change-row');
                const manualPill = row.querySelector('.roster-manual-val');
                const pdfVal     = row.querySelector('.roster-to-val');
                if (manualPill) manualPill.classList.toggle('val-active', s.chosen === 'manual');
                if (manualPill) manualPill.classList.toggle('val-dim',    s.chosen === 'pdf');
                if (pdfVal)     pdfVal.classList.toggle('val-active', s.chosen === 'pdf');
                if (pdfVal)     pdfVal.classList.toggle('val-dim',    s.chosen === 'manual');
            }
        });

        // ---- Empty state ----
        if (sectionsShown === 0) {
            changeList.innerHTML = `<div class="roster-no-changes">✓ The roster matches what's already saved — no changes needed.</div>`;
            applyBtn.disabled = true;
        } else {
            applyBtn.disabled    = false;
            applyBtn.textContent = 'Save changes';
        }

        // ---- Summary label ----
        const weekEndDate = new Date(weekEnding + 'T12:00:00');
        const formatted   = weekEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        reviewLabel.textContent = `Week ending ${formatted} — ${diffCount} change${diffCount !== 1 ? 's' : ''}, ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}`;

        reviewSection.style.display = '';
        applyFeedback.textContent   = '';
        applyFeedback.className     = 'huddle-feedback';
    }

    /**
     * Map a shift value to the Firestore override `type` field.
     * This mirrors the existing override type vocabulary.
     *
     * @param {string} value     - e.g. "05:30-11:30", "SPARE", "AL", "SICK", "RD"
     * @param {string} baseShift - the base roster shift for that day (e.g. "RD", "06:00-12:00")
     * @param {string|null} date - ISO date string "YYYY-MM-DD" — used to detect Sunday
     * @returns {string}  override type
     */
    function shiftValueToOverrideType(value, baseShift, date = null) {
        if (value === 'AL')    return 'annual_leave';
        if (value === 'SICK')  return 'sick';
        if (value === 'SPARE') return 'spare_shift';
        if (value === 'RD' || value === 'OFF') return 'correction';
        // Pipe-encoded RDW from AI: "RDW|14:30-22:00" — explicit flag regardless of base shift
        if (value.startsWith('RDW|') || value === 'RDW') return 'rdw';
        // Sunday is always uncontracted — any shift worked on a Sunday is an RDW.
        // For all other days, only classify as RDW when the AI explicitly flagged it above.
        // Staff may swap rest/working days with permission without it being an RDW.
        const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value);
        if (isTime && date !== null && new Date(date + 'T12:00:00Z').getUTCDay() === 0) return 'rdw';
        // Spare week receiving its actual allocation — semantically distinct from overtime
        return 'shift';
    }

    // ---- Collapse / expand ----
    (function initCollapse() {
        const header  = document.getElementById('rosterUploadToggleHeader');
        const body    = document.getElementById('rosterUploadBody');
        const chevron = document.getElementById('rosterUploadChevron');
        if (!header || !body || !chevron) return;
        header.addEventListener('click', () => {
            const isOpen = body.classList.toggle('open');
            chevron.classList.toggle('open', isOpen);
        });
    })();

})();
