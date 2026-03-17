import { CONFIG, teamMembers, DAY_KEYS, DAY_NAMES, MONTH_ABB, getALEntitlement, getSpecialDayBadges, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml } from './roster-data.js?v=5.17';
import { db, collection, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, serverTimestamp, writeBatch } from './firebase-client.js?v=5.17';

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
        window.location.reload();
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
    const headerIcon = document.querySelector('.app-header img');
    const closeBtn   = document.getElementById('iconLightboxClose');
    const versionEl  = document.getElementById('lightboxVersion');
    const bugLink    = document.getElementById('adminBugReportLink');

    if (!lightbox || !headerIcon) return;

    if (versionEl) versionEl.textContent = ADMIN_VERSION;

    function openLightbox() {
        if (bugLink) {
            const name   = currentUser || 'Unknown';
            const date   = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const ua     = navigator.userAgent;
            const body   = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster Admin v${ADMIN_VERSION}\nUser: ${name}\nDate: ${date}\nBrowser: ${ua}`;
            bugLink.href = `mailto:Gareth.Miller@chilternrailways.co.uk?subject=${encodeURIComponent(`Bug Report — MYB Roster Admin v${ADMIN_VERSION}`)}&body=${encodeURIComponent(body)}`;
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

// ---- Tips lightbox ----
(function() {
    const lb       = document.getElementById('tipsLightbox');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const tipsBtn  = document.getElementById('tipsBtn');

    if (!lb || !tipsBtn) return;

    function openTips() {
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

    tipsBtn.addEventListener('click', openTips);
    if (closeBtn) closeBtn.addEventListener('click', closeTips);
    lb.addEventListener('click', e => { if (e.target === lb) closeTips(); });
})();

// Override type metadata
const TYPES = {
    spare_shift:  { label: 'Spare shift',       fixed: false },
    overtime:     { label: 'Overtime',           fixed: false },
    rdw:          { label: 'Rest Day Working',   fixed: false },
    swap:         { label: 'Swap',               fixed: false },
    annual_leave: { label: 'Annual Leave',       fixed: true,  fixedValue: 'AL' },
    correction:   { label: 'Make Rest Day',      fixed: true,  fixedValue: 'RD' },
    sick:         { label: 'Sick',               fixed: true,  fixedValue: 'SICK' },
};

// ============================================
// ROSTER LOGIC
// ============================================

// getRosterData, getWeekNum, getBaseShift — imported from roster-data.js as getRosterForMember, getWeekNumberForDate, getBaseShift
// shiftBadge — thin wrapper so inline admin grid uses a space separator instead of <br>
function shiftBadge(shift) { return getShiftBadge(shift, ' '); }

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
const listFeedback = document.getElementById('listFeedback');

// ============================================
// POPULATE MEMBER DROPDOWNS
// ============================================
const roles = [...new Set(teamMembers.filter(m => !m.hidden).map(m => m.role))];
roles.forEach(role => {
    const grp1 = document.createElement('optgroup');
    grp1.label = role;
    teamMembers.filter(m => m.role === role && !m.hidden).forEach(m => {
        grp1.appendChild(new Option(m.name, m.name));
    });
    fieldMember.appendChild(grp1);
});

// Restore last used member from localStorage
const lastMember = localStorage.getItem('adminLastMember');
if (lastMember && teamMembers.find(m => m.name === lastMember)) {
    fieldMember.value  = lastMember;
}

// Default date = today, or the date passed from index.html via ?date=YYYY-MM-DD.
// This preserves the month the staff member was viewing when they tapped Admin.
const _urlDate = new URLSearchParams(location.search).get('date');
fieldDate.value = (_urlDate && /^\d{4}-\d{2}-\d{2}$/.test(_urlDate)) ? _urlDate : formatISO(new Date());
(function updateWeekNavLabelFromDate() {
    const d    = new Date(fieldDate.value + 'T12:00:00');
    const sun  = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const sat  = new Date(sun); sat.setDate(sun.getDate() + 6);
    const el   = document.getElementById('weekNavLabel');
    if (el) {
        el.textContent = `${sun.getDate()} ${MONTH_ABB[sun.getMonth()]} – ${sat.getDate()} ${MONTH_ABB[sat.getMonth()]} ${sat.getFullYear()}`;
        el.classList.add('is-current-week'); // init always shows today's week
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

function hasUnsavedChanges() { return userMadeChanges; }

// Call this whenever the user explicitly interacts with the grid
function markChanged() { userMadeChanges = true; }

// Warn browser/OS before closing or navigating away
window.addEventListener('beforeunload', e => {
    if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; }
});

function confirmNavigate() {
    if (!hasUnsavedChanges()) return true;
    return confirm('You have unsaved changes. Continue and lose them?');
}

// ============================================
// WEEK NAVIGATION
// ============================================
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
    const SWIPE_PX    = 75;   // minimum px for a committed swipe
    const SWIPE_VEL   = 0.4;  // px/ms fast-flick threshold

    let wPrev = null, wNext = null, wCurrent = null;
    let wW = 0, wX0 = 0, wY0 = 0, wT0 = 0;
    let wListening = false, wDragging = false, wHapticFired = false, wCooldown = false;

    // Build a fully-functional adjacent week panel offset off-screen by delta weeks.
    function buildAdjPanel(delta) {
        const d = new Date(fieldDate.value + 'T12:00:00');
        d.setDate(d.getDate() + delta * 7);
        const panel = document.createElement('div');
        panel.className = 'week-panel week-carousel-panel';
        buildWeekGridInto(panel, formatISO(d));
        weekGrid.appendChild(panel);
        panel.style.transform = `translateX(${delta < 0 ? -wW : wW}px)`;
        return panel;
    }

    function discardPanels() {
        if (wPrev && wPrev.parentNode) wPrev.remove();
        if (wNext && wNext.parentNode) wNext.remove();
        wPrev = null; wNext = null;
    }

    function snapBack() {
        if (wCurrent) { wCurrent.style.transition = TRANSITION; wCurrent.style.transform = 'translateX(0)'; }
        if (wPrev)    { wPrev.style.transition    = TRANSITION; wPrev.style.transform    = `translateX(${-wW}px)`; }
        if (wNext)    { wNext.style.transition    = TRANSITION; wNext.style.transform    = `translateX(${wW}px)`; }
        setTimeout(() => {
            discardPanels();
            if (wCurrent) { wCurrent.style.transition = ''; wCurrent.style.willChange = ''; }
            wCurrent = null; wCooldown = false;
        }, DURATION_MS + 50);
    }

    // pointerdown: record start position only — no capture, no panel building yet.
    weekGrid.addEventListener('pointerdown', e => {
        if (!e.isPrimary || wCooldown) return;
        if (userMadeChanges) return;
        if (!fieldMember.value || !fieldDate.value) return;

        wCurrent = weekGrid.querySelector('.week-panel:not(.week-carousel-panel)');
        if (!wCurrent) return;

        navigator.vibrate?.(0);  // prime Vibration API on Android Chrome
        wX0 = e.clientX; wY0 = e.clientY; wT0 = e.timeStamp;
        wListening = true; wDragging = false; wHapticFired = false;
    });

    // pointermove: confirm direction; start carousel only when clearly horizontal.
    weekGrid.addEventListener('pointermove', e => {
        if (!e.isPrimary || !wListening) return;
        const dx = e.clientX - wX0;
        const dy = e.clientY - wY0;

        if (!wDragging) {
            if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;

            if (Math.abs(dy) >= Math.abs(dx)) {
                // Vertical — abandon; let the browser scroll
                wListening = false;
                return;
            }

            // Horizontal confirmed — commit to swipe gesture
            wW = Math.ceil(weekGrid.getBoundingClientRect().width);
            weekGrid.setPointerCapture(e.pointerId);
            wCurrent.style.transition = 'none';
            wCurrent.style.willChange = 'transform';
            wPrev = buildAdjPanel(-1);
            wNext = buildAdjPanel(+1);
            wCooldown = true;
            wDragging = true;
        }

        wCurrent.style.transform = `translateX(${dx}px)`;
        if (wPrev) wPrev.style.transform = `translateX(${-wW + dx}px)`;
        if (wNext) wNext.style.transform = `translateX(${wW + dx}px)`;

        if (!wHapticFired && Math.abs(dx) >= SWIPE_PX) {
            navigator.vibrate?.(6);
            wHapticFired = true;
        }
    });

    weekGrid.addEventListener('pointerup', e => {
        if (!e.isPrimary || !wListening) return;
        wListening = false;

        if (!wDragging) return; // was a tap — buttons/inputs handle their own clicks
        wDragging = false;
        try { weekGrid.releasePointerCapture(e.pointerId); } catch (_) {}

        const dx  = e.clientX - wX0;
        const vel = e.timeStamp > wT0 ? Math.abs(dx) / (e.timeStamp - wT0) : 0;
        const goLeft  = dx < 0 && (Math.abs(dx) >= SWIPE_PX || vel >= SWIPE_VEL);
        const goRight = dx > 0 && (Math.abs(dx) >= SWIPE_PX || vel >= SWIPE_VEL);

        if (goLeft || goRight) {
            if (!wHapticFired) navigator.vibrate?.(6);
            const incoming = goLeft ? wNext : wPrev;
            const discard  = goLeft ? wPrev : wNext;
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

            wCurrent.style.transition = TRANSITION;
            wCurrent.style.transform  = `translateX(${goLeft ? -wW : wW}px)`;
            incoming.style.transition = TRANSITION;
            incoming.style.transform  = 'translateX(0)';
            if (discard && discard.parentNode) discard.remove();

            function restore() {
                incoming.classList.remove('week-carousel-panel');
                incoming.style.transition = incoming.style.transform = incoming.style.willChange = '';
                if (wCurrent && wCurrent.parentNode) wCurrent.remove();
                wPrev = wNext = wCurrent = null;
                resetBulkPills();
                updateSaveBtn();
                wCooldown = false;
            }
            const timer = setTimeout(restore, DURATION_MS + 50);
            incoming.addEventListener('transitionend', () => { clearTimeout(timer); restore(); }, { once: true });

        } else {
            snapBack();
        }
    });

    weekGrid.addEventListener('pointercancel', e => {
        if (!e.isPrimary || !wListening) return;
        wListening = false; wCooldown = false;
        try { weekGrid.releasePointerCapture(e.pointerId); } catch (_) {}
        if (wDragging) {
            wDragging = false;
            if (wCurrent) { wCurrent.style.transition = wCurrent.style.transform = wCurrent.style.willChange = ''; }
            discardPanels(); wCurrent = null;
        }
    });

    // Button handlers inside IIFE so they share the wCooldown closure variable
    prevWeekBtn.addEventListener('click', () => { if (!wCooldown) shiftWeek(-1); });
    nextWeekBtn.addEventListener('click', () => { if (!wCooldown) shiftWeek(+1); });
})();

// ============================================
// ANNUAL LEAVE BANNER
// ============================================
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

    const entitlement = getALEntitlement(member);
    const yearStr     = alFrom.value ? alFrom.value.substring(0, 4) : (fieldDate.value ? fieldDate.value.substring(0, 4) : String(new Date().getFullYear()));
    const todayStr    = new Date().toISOString().slice(0, 10);

    let taken  = 0;
    let booked = 0;
    allOverrides.forEach(o => {
        if (o.memberName === memberName && o.type === 'annual_leave' && o.date && o.date.startsWith(yearStr)) {
            if (o.date <= todayStr) taken++; else booked++;
        }
    });
    const remaining   = entitlement - taken - booked;

    remEl.textContent    = remaining;
    takenEl.textContent  = taken;
    bookedEl.textContent = booked;
    entEl.textContent    = entitlement;

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

// Build a week grid (header + 7 day rows with full event listeners) into `container`
// for the given ISO date string. Reads fieldMember.value and allOverrides from module
// scope but has NO side-effects on fieldDate, userMadeChanges, bulkBar, or saveBtn —
// safe to call for adjacent panels during swipe pre-building.
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
        <div class="hdr-time">Shift time</div>
        <div class="hdr-note"></div>`;
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
                <span class="day-date">${date.getDate()} ${MONTH_ABB[date.getMonth()]}${badgeHTML}${existing ? ' <span class="overwrite-badge">⚠ has override</span>' : ''}</span>
            </div>
            <div class="col-base">${shiftBadge(baseShift)}</div>
            <div class="col-pills">
                <button class="type-pill-btn pill-annual_leave" data-type="annual_leave">AL</button>
                <button class="type-pill-btn pill-rdw"          data-type="rdw">RDW</button>
                <button class="type-pill-btn pill-overtime"     data-type="overtime">Overtime</button>
                <button class="type-pill-btn pill-spare_shift"  data-type="spare_shift">Spare</button>
                <button class="type-pill-btn pill-swap"         data-type="swap">Swap</button>
                <button class="type-pill-btn pill-sick"         data-type="sick">Sick</button>
                <button class="type-pill-btn pill-correction"   data-type="correction">Rest Day</button>
            </div>
            <div class="col-time">
                <input type="text" class="time-input day-start" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour start time, e.g. 06:20">
                <span class="time-sep">–</span>
                <input type="text" class="time-input day-end" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour end time, e.g. 14:20">
                <span class="time-note">No time needed</span>
                <span class="time-hint">24h · max 12 hrs</span>
                <span class="time-error-msg">Use HH:MM format (e.g. 07:00)</span>
            </div>
            <div class="col-note-btn">
                <button class="btn-note-toggle" title="Add a note to this override">+ Note</button>
            </div>`;

        // --- Note row (full width, hidden by default) ---
        const noteRow = document.createElement('div');
        noteRow.className = 'note-row';
        noteRow.innerHTML = `<input type="text" class="day-note" placeholder="Note (optional)">`;

        container.appendChild(row);
        container.appendChild(noteRow);

        // Refs
        const cb        = row.querySelector('.day-cb');
        const pills     = row.querySelectorAll('.type-pill-btn');
        const startEl   = row.querySelector('.day-start');
        const endEl     = row.querySelector('.day-end');
        const noteBtn   = row.querySelector('.btn-note-toggle');
        const noteInput = noteRow.querySelector('.day-note');

        // Pre-fill with existing override if present.
        // Mark as prefilled-existing so the save button doesn't light up until
        // the user explicitly changes something — and so deactivation can trigger deletion.
        if (existing) {
            const meta = TYPES[existing.type];
            activateRow(row, cb, pills, startEl, endEl, existing.type);
            row.classList.add('prefilled-existing');
            if (meta && !meta.fixed && existing.value && existing.value.includes('-')) {
                const [s, e] = existing.value.split('-');
                startEl.value = s;
                endEl.value   = e;
            }
            if (existing.note) {
                noteInput.value = existing.note;
                noteRow.classList.add('visible');
                noteBtn.classList.add('has-note');
                noteBtn.title = 'Edit this note';
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
                    deactivateRow(row, cb, pills, startEl, endEl);
                } else {
                    activateRow(row, cb, pills, startEl, endEl, type);
                    const meta = TYPES[type];
                    if (meta && !meta.fixed) startEl.focus();
                }
                markChanged();
                updateSaveBtn();
            });
        });

        // Checkbox: syncs with pill state
        cb.addEventListener('change', () => {
            if (cb.checked) {
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                row.classList.remove('prefilled-existing');
                deactivateRow(row, cb, pills, startEl, endEl);
            }
            markChanged();
            updateSaveBtn();
            updateBulkSelCount();
        });

        // Time inputs: editing a pre-filled time marks the row as user-modified
        startEl.addEventListener('change', () => { row.classList.remove('prefilled-existing'); markChanged(); });
        endEl.addEventListener('change',   () => { row.classList.remove('prefilled-existing'); markChanged(); });

        // Note button
        noteBtn.addEventListener('click', () => {
            const showing = noteRow.classList.toggle('visible');
            noteBtn.title = showing ? 'Remove note' : 'Add a note to this override';
            if (showing) noteInput.focus();
        });

        noteInput.addEventListener('input', () => {
            noteBtn.classList.toggle('has-note', noteInput.value.trim().length > 0);
        });
    }
}

function renderWeekGrid() {
    userMadeChanges = false;
    const memberName = fieldMember.value;
    const dateStr    = fieldDate.value;

    updateWeekNavLabel(dateStr);

    if (!memberName || !dateStr) {
        weekGrid.innerHTML = '<div class="week-empty">Select a staff member and date above to load the week.</div>';
        bulkBar.style.display = 'none';
        saveBtn.disabled = true;
        return;
    }

    weekGrid.innerHTML = '';

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

function activateRow(row, cb, pills, startEl, endEl, type) {
    cb.checked = true;
    row.classList.add('active');
    row.classList.remove('selected');
    pills.forEach(p => p.classList.toggle('active', p.dataset.type === type));
    const meta = TYPES[type];
    if (meta && meta.fixed) {
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

function deactivateRow(row, cb, pills, startEl, endEl) {
    cb.checked = false;
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
            hint.textContent = 'Choose a shift type on at least one day, then tap Save';
        }
    }
}

function updateBulkSelCount() {
    const el = document.getElementById('bulkSelCount');
    if (!el) return;
    const n = weekGrid.querySelectorAll('.day-cb:checked').length;
    el.textContent = n > 0 ? `${n} day${n > 1 ? 's' : ''} selected` : '';
}

// ============================================
// BULK BAR — type pills
// ============================================
let bulkActiveType = '';

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
        const meta = TYPES[type];
        bulkTimeGroup.style.display = (meta && !meta.fixed) ? 'flex' : 'none';
        bulkStart.value = bulkEnd.value = '';
    });
});

// Day selection shortcuts
document.getElementById('bulkSelMonFri').addEventListener('click', () => {
    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const dayIdx = new Date(row.dataset.date + 'T12:00:00').getDay();
        const cb = row.querySelector('.day-cb');
        if (!cb) return;
        // Mon=1, Fri=5
        if (dayIdx >= 1 && dayIdx <= 5) {
            cb.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        } else {
            const pills  = row.querySelectorAll('.type-pill-btn');
            const startEl = row.querySelector('.day-start');
            const endEl   = row.querySelector('.day-end');
            deactivateRow(row, cb, pills, startEl, endEl);
        }
    });
    updateSaveBtn();
    updateBulkSelCount();
});

document.getElementById('bulkSelWorking').addEventListener('click', () => {
    const memberName = fieldMember.value;
    const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const date  = new Date(row.dataset.date + 'T12:00:00');
        const cb    = row.querySelector('.day-cb');
        if (!cb) return;
        const base  = member ? getBaseShift(member, date) : 'RD';
        const works = base !== 'RD' && base !== 'OFF';
        if (works) {
            cb.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        } else {
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = row.querySelector('.day-start');
            const endEl   = row.querySelector('.day-end');
            deactivateRow(row, cb, pills, startEl, endEl);
        }
    });
    updateSaveBtn();
    updateBulkSelCount();
});

document.getElementById('bulkSelAll').addEventListener('click', () => {
    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const cb = row.querySelector('.day-cb');
        if (!cb) return;
        cb.checked = true;
        if (!row.dataset.type) row.classList.add('selected');
    });
    updateSaveBtn();
    updateBulkSelCount();
});

// Apply bulk type + time to all active (checked) rows
bulkApplyBtn.addEventListener('click', () => {
    if (!bulkActiveType) { showError('Choose a type in step 2 first, then tap Apply.'); return; }
    const meta = TYPES[bulkActiveType];

    weekGrid.querySelectorAll('.day-row').forEach(row => {
        const cb = row.querySelector('.day-cb');
        if (!cb || !cb.checked) return;
        const pills   = row.querySelectorAll('.type-pill-btn');
        const startEl = row.querySelector('.day-start');
        const endEl   = row.querySelector('.day-end');
        activateRow(row, cb, pills, startEl, endEl, bulkActiveType);
        if (meta && !meta.fixed) {
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
        const meta    = TYPES[type];
        const startEl = row.querySelector('.day-start');
        const endEl   = row.querySelector('.day-end');
        // Note row immediately follows the day-row in the DOM
        const noteRow = row.nextElementSibling;
        const note    = (noteRow && noteRow.classList.contains('note-row'))
                        ? (noteRow.querySelector('.day-note')?.value?.trim() || '')
                        : '';

        let value;
        if (meta && meta.fixed) {
            value = meta.fixedValue;
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
        const entitlement = getALEntitlement(member);
        // Use the year of the AL dates being saved, not the current calendar year
        const yearStr     = alInBatch[0].date.substring(0, 4);
        // Count existing AL for this year, excluding days being overwritten (they're replaced, not added)
        const overwriteDates = new Set(alInBatch.filter(e => e.existingId).map(e => e.date));
        const existingAL = allOverrides.filter(o =>
            o.memberName === memberName &&
            o.type       === 'annual_leave' &&
            o.date       && o.date.startsWith(yearStr) &&
            !overwriteDates.has(o.date)
        ).length;
        const newALDates = [...new Set(alInBatch.map(e => e.date).filter(d => d.startsWith(yearStr)))];
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
});

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
            batch.set(newRef, { ...data, createdAt: serverTimestamp() });
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

        // Reset checked rows
        weekGrid.querySelectorAll('.day-row').forEach(row => {
            const cb    = row.querySelector('.day-cb');
            const pills = row.querySelectorAll('.type-pill-btn');
            const s     = row.querySelector('.day-start');
            const e     = row.querySelector('.day-end');
            if (cb) deactivateRow(row, cb, pills, s, e);
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
        saveBtn.textContent = 'Save Changes';
        updateSaveBtn();
    }
}

fieldMember.addEventListener('change', () => {
    if (!confirmNavigate()) { fieldMember.value = localStorage.getItem('adminLastMember') || ''; return; }
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



async function loadOverrides() {
    tableBody.innerHTML = '<tr class="state-row"><td colspan="6"><span class="spinner"></span>Loading…</td></tr>';
    try {
        const snap = await getDocs(collection(db, 'overrides'));
        allOverrides = [];
        snap.forEach(s => allOverrides.push({ id: s.id, ...s.data() }));
        allOverrides.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        renderTable();
        // Re-render week grid so existing-override detection is current
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
    } catch (err) {
        console.error('[Admin] Load failed:', err);
        tableBody.innerHTML = '<tr class="state-row"><td colspan="6">Failed to load overrides.<br><span class="reload-link" onclick="location.reload()">↻ Reload page</span></td></tr>';
        listCount.textContent = 'Error';
    }
}

function renderTable() {
    const filter = fieldMember.value;
    const rows   = filter ? allOverrides.filter(o => o.memberName === filter) : allOverrides;
    listCount.textContent = `${rows.length} saved change${rows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
        tableBody.innerHTML = '<tr class="state-row"><td colspan="6">No overrides found.</td></tr>';
        return;
    }

    tableBody.innerHTML = '';
    rows.forEach(o => {
        const meta = TYPES[o.type];
        const tr   = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space:nowrap;font-weight:600">${formatDisplay(o.date)}</td>
            <td>${esc(o.memberName)}</td>
            <td><span class="list-type-pill lpill-${o.type}">${meta ? meta.label : esc(o.type)}</span></td>
            <td style="font-family:monospace;font-size:12px">${esc(o.value)}</td>
            <td style="color:var(--text-light);font-style:italic">${esc(o.note)}</td>
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
}

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
        // Re-render week grid to clear the "has override" badge if this date is visible
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
        // Brief confirmation of what was removed
        if (deleted && listFeedback) {
            const meta = TYPES[deleted.type];
            listFeedback.textContent = `✓ Deleted: ${deleted.memberName} — ${formatDisplay(deleted.date)} (${meta ? meta.label : deleted.type})`;
            listFeedback.className = 'list-feedback success';
            setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
        }
    } catch (err) {
        console.error('[Admin] Delete failed:', err);
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
        if (listFeedback) {
            listFeedback.textContent = '⚠ Could not delete — check your connection and try again.';
            listFeedback.className = 'list-feedback error';
        }
    }
}

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
    const el  = e.target;
    // Clear error while user is typing so the red border doesn't linger mid-edit
    el.classList.remove('input-error');
    const raw = el.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (raw.length >= 3) {
        el.value = raw.slice(0, 2) + ':' + raw.slice(2);
    } else {
        el.value = raw;
    }
});

// On blur: validate completed time and show inline error if malformed
document.addEventListener('focusout', e => {
    if (!e.target.classList.contains('time-input')) return;
    const el  = e.target;
    const val = el.value.trim();
    if (!val) { el.classList.remove('input-error'); return; } // empty is fine (caught on save)
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRe.test(val)) {
        el.classList.add('input-error');
    } else {
        el.classList.remove('input-error');
    }
});

// ============================================
// UTILITIES
// ============================================
function formatISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

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
function getEffectiveShift(memberName, dateISO, batch) {
    const inBatch = batch.find(e => e.date === dateISO);
    if (inBatch) return inBatch.value;
    const inOverrides = allOverrides.find(o => o.memberName === memberName && o.date === dateISO);
    if (inOverrides) return inOverrides.value;
    const member = teamMembers.find(m => m.name === memberName);
    if (!member) return 'RD';
    return getBaseShift(member, new Date(dateISO + 'T12:00:00'));
}

// Validate max shift duration (12 h) and minimum rest gap (12 h) between consecutive shifts.
// Returns an array of human-readable error strings; also marks failing rows with .row-error.
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

function showError(msg) {
    formFeedback.className = 'feedback error';
    formFeedback.textContent = '⚠ ' + msg;
}

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

function showALConfirm(msg, sub, pendingSave, pendingDelete = []) {
    _alPendingSave   = pendingSave;
    _alPendingDelete = pendingDelete;
    alConfirmMsg.textContent = msg;
    alConfirmSub.textContent = sub;
    alConfirmBar.classList.add('visible');
    alConfirmSaveBtn.focus();
}
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
    const el = document.getElementById('alMemberDisplay');
    if (el) el.textContent = fieldMember.value || 'Select a staff member above';
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
        alPreview.textContent = 'Choose a date range to see a preview.';
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

    // Count rest days (RD/OFF) in the range to warn the user
    const memberObj = teamMembers.find(m => m.name === member);
    let restCount = 0;
    if (memberObj) {
        dates.forEach(dateStr => {
            const d = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') restCount++;
        });
    }
    const workDays = dates.length - restCount;
    const label    = workDays === 1 ? '1 working day' : `${workDays} working day${workDays !== 1 ? 's' : ''}`;
    const restNote = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';

    alPreview.className = 'al-preview ready';
    alPreview.innerHTML = `🏖️ <strong>${label}</strong> of Annual Leave for ${esc(member)}: ${rangeStr}${restNote}`;
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
        const entitlement    = getALEntitlement(memberObj);
        // Use the year from the booking dates, not the current calendar year
        const yearStr        = alFrom.value ? alFrom.value.substring(0, 4) : String(new Date().getFullYear());
        const existingAL     = allOverrides.filter(o =>
            o.memberName === member &&
            o.type       === 'annual_leave' &&
            o.date       && o.date.startsWith(yearStr)
        ).length;
        const newALInYear    = dates.filter(d => d.startsWith(yearStr)).length;
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

    // Filter out rest days — no point writing AL over an already-resting day
    const workingDates = memberObj
        ? dates.filter(dateStr => {
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            return base !== 'RD' && base !== 'OFF';
          })
        : dates;

    if (!workingDates.length) {
        alFeedback.className = 'feedback error';
        alFeedback.textContent = '⚠ No working days in that range — nothing to book.';
        alSaveBtn.disabled    = false;
        alSaveBtn.textContent = 'Record Annual Leave';
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
                type:  'annual_leave',
                value: 'AL',
                note:  '',
                createdAt: serverTimestamp()
            });
            // Capture the new ID so we can update allOverrides without a round-trip
            alNewDocs.push({ id: newRef.id, memberName: member, date, type: 'annual_leave', value: 'AL', note: '', createdAt: new Date() });
        });
        await alBatch.commit();

        alFeedback.className = 'feedback success';
        alFeedback.textContent = `✓ Booked ${workingDates.length} day${workingDates.length > 1 ? 's' : ''} of Annual Leave for ${member}`;
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
        alSaveBtn.textContent = 'Record Annual Leave';
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
    const el = document.getElementById('sickMemberDisplay');
    if (el) el.textContent = fieldMember.value || 'Select a staff member above';
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
        sickPreview.textContent = 'Choose the dates you were off sick.';
        sickSaveBtn.disabled = true;
        return;
    }

    if (dates === null) {
        sickPreview.className = 'al-preview sick-preview error';
        sickPreview.textContent = '"Last sick day" must be on or after "First sick day".';
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

    // Count rest days in the range — they will be skipped
    const memberObj = teamMembers.find(m => m.name === member);
    let restCount = 0;
    if (memberObj) {
        dates.forEach(dateStr => {
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') restCount++;
        });
    }
    const workDays = dates.length - restCount;
    const label    = workDays === 1 ? '1 sick day' : `${workDays} sick days`;
    const restNote = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';

    sickPreview.className = 'al-preview sick-preview ready';
    sickPreview.innerHTML = `🤒 <strong>${label}</strong> for ${esc(member)}: ${rangeStr}${restNote}`;
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
    const workingDates = memberObj
        ? dates.filter(dateStr => {
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
                createdAt: serverTimestamp()
            });
            sickNewDocs.push({ id: newRef.id, memberName: member, date, type: 'sick', value: 'SICK', note: '', createdAt: new Date() });
        });
        await sickBatch.commit();

        sickFeedback.className = 'feedback success';
        sickFeedback.textContent = `✓ Recorded ${workingDates.length} sick day${workingDates.length > 1 ? 's' : ''} for ${member}`;
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
        sickSaveBtn.textContent = 'Record Sick Days';
    }
});

/**
 * Refreshes the collapsible list of recorded sick days for the selected member.
 * Shows sick periods grouped by month, merging consecutive dates that are
 * bridged by rest days on the base roster (same logic as AL booked box).
 */
function updateSickBookedBox() {
    const box  = document.getElementById('sickBookedBox');
    const body = document.getElementById('sickBookedBody');
    if (!box || !body) return;

    const memberName = sickMember.value;
    if (!memberName) { box.hidden = true; return; }

    const yearStr = sickFrom.value ? sickFrom.value.substring(0, 4) : (fieldDate.value ? fieldDate.value.substring(0, 4) : String(new Date().getFullYear()));
    const entries = allOverrides.filter(o =>
        o.memberName === memberName &&
        o.type       === 'sick' &&
        o.date       && o.date.startsWith(yearStr)
    ).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

    if (!entries.length) { box.hidden = true; return; }

    const memberObj  = teamMembers.find(m => m.name === memberName);
    const sickDateSet = new Set(entries.map(e => e.date));

    function addDays(dateStr, n) {
        const d = new Date(dateStr + 'T12:00:00');
        d.setDate(d.getDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function isRestGap(dateStr) {
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

    const dateList = [...sickDateSet].sort();
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

    let html = '';
    for (const key of Object.keys(byMonth).sort()) {
        const [yr, mo] = key.split('-');
        const monthLabel = `${MONTH_ABB[parseInt(mo, 10) - 1]} ${yr}`;
        html += `<div class="al-period-month"><div class="al-period-month-hdr">${monthLabel}</div>`;
        for (const p of byMonth[key]) {
            const dateStr  = p.start === p.end ? fmtDate(p.start) : fmtRange(p.start, p.end);
            const countStr = `${p.count} sick day${p.count !== 1 ? 's' : ''}`;
            html += `<div class="al-period-row">
                <span class="al-period-dates">${dateStr}</span>
                <span class="sick-period-count">${countStr}</span>
            </div>`;
        }
        html += `</div>`;
    }

    body.innerHTML = html;
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

function applyPermissions() {
    // Show signed-in name in header badge
    // Show surname (e.g. "Springer") for staff, "Admin" for G. Miller
    document.getElementById('adminBadge').textContent =
        currentIsAdmin ? 'Admin' : currentUser.split(' ').slice(1).join(' ');

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

    const yearStr = alFrom.value ? alFrom.value.substring(0, 4) : (fieldDate.value ? fieldDate.value.substring(0, 4) : String(new Date().getFullYear()));
    const entries = allOverrides.filter(o =>
        o.memberName === memberName &&
        o.type       === 'annual_leave' &&
        o.date       && o.date.startsWith(yearStr)
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
        return d.toISOString().slice(0, 10);
    }

    /**
     * Return true if the date is a non-working day on the base roster
     * (i.e. a gap between AL dates should be bridged into the same period).
     * @param {string} dateStr YYYY-MM-DD
     * @returns {boolean}
     */
    function isRestGap(dateStr) {
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
    // entirely rest days on the base roster.
    const dateList = [...alDateSet].sort();
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

    // Render
    let html = '';
    for (const key of Object.keys(byMonth).sort()) {
        const [yr, mo] = key.split('-');
        const monthLabel = `${MONTH_ABB[parseInt(mo, 10) - 1]} ${yr}`;
        html += `<div class="al-period-month"><div class="al-period-month-hdr">${monthLabel}</div>`;
        for (const p of byMonth[key]) {
            const dateStr  = p.start === p.end ? fmtDate(p.start) : fmtRange(p.start, p.end);
            const countStr = `${p.count} day${p.count !== 1 ? 's' : ''} AL`;
            html += `<div class="al-period-row">
                <span class="al-period-dates">${dateStr}</span>
                <span class="al-period-count">${countStr}</span>
            </div>`;
        }
        html += `</div>`;
    }

    body.innerHTML = html;
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
            // Fire-and-forget Firestore sync for cross-device persistence.
            setDoc(doc(db, 'memberSettings', target), { faithCalendar: radio.value }, { merge: true })
                .catch(e => console.warn('[Firestore] memberSettings sync failed:', e));
        });
    });

    // Expose loader so the auth block can call it after currentUser is confirmed
    window._loadReligiousSetting = loadReligiousSetting;
})();

// ============================================
// PRINT HEADER — member name, week, timestamp
// ============================================
window.addEventListener('beforeprint', () => {
    const member    = fieldMember.value || 'All members';
    const weekLabel = document.getElementById('weekNavLabel')?.textContent || '';
    const now       = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const el        = document.getElementById('printHeader');
    if (el) el.innerHTML = `MYB Roster \u2014 ${esc(member)}<span class="print-sub">Week: ${esc(weekLabel)} \u00b7 Printed: ${esc(now)}</span>`;
});

if (!isAuthenticated) {
    // Show login overlay; do not load any Firestore data
    initLoginOverlay();
} else {
    // All dropdowns are now populated — apply permissions then load data
    document.body.classList.add('auth-ready');
    applyPermissions();
    loadOverrides(); // internally calls renderWeekGrid() after data loads
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
            setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
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

    /** Show the "Update ready" toast. */
    function showUpdateToast() {
        if (updateToast) updateToast.classList.add('visible');
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

            // Poll for updates every 60 minutes (catches long-lived sessions)
            setInterval(() => registration.update(), 60 * 60 * 1000);
        })
        .catch(e => console.warn('[SW] Registration failed:', e));

    // "Refresh now" button — sends SKIP_WAITING then reloads once the new SW takes control
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
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
