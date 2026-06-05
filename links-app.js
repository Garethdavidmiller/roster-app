/**
 * links-app.js — Coordinator for links.html.
 *
 * Owns: auth guard (LINKS_DESIGNERS check), Firestore load/save for
 *   linkDesigns/combined-28, 28×7 design grid, coverage analysis,
 *   staff assignment panel, and initialise-from-rosters action.
 * Edit here for: link design logic, grid rendering, coverage maths,
 *   adding new positions or shift options.
 */

import { CONFIG, teamMembers, weeklyRoster, bilingualRoster, escapeHtml } from './roster-data.js';
import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase-client.js';
import { initNavPanel } from './nav-panel.js';
import { getSession, clearSession, ensureFirebaseSession } from './session.js';
import { lockBodyScroll, _pushOverlayState, dismissOverlay } from './overlay.js';

// ============================================
// SESSION — guard access to LINKS_DESIGNERS only
// ============================================
const currentSession  = getSession();
const currentUser     = currentSession?.name ?? null;
const isLinksDesigner = CONFIG.LINKS_DESIGNERS.includes(currentUser);

if (!currentUser || !isLinksDesigner) {
    window.location.replace('./admin.html');
    throw new Error('Not authorised — redirecting');
}

window._mybSession = ensureFirebaseSession(currentUser);

// ============================================
// PAGE INIT
// ============================================
document.body.classList.add('auth-ready');

let openAboutLightbox = null;

initNavPanel({
    currentPage:     'links',
    memberName:      currentUser,
    isLinksDesigner: true,
    onLogoClick:     () => openAboutLightbox?.(),
    onSignOut:       () => { clearSession(); window.location.href = './admin.html'; },
});

// ============================================
// CONSTANTS
// ============================================
const DAYS       = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOTAL_POS  = 28;
const FIXED_POS  = 23;  // C. Reen — Mon–Fri 12:00–19:00, not editable
const VACANT_FROM = 24; // positions 24–28 are vacant placeholders

const DESIGN_REF = doc(db, 'linkDesigns', 'combined-28');

// All shift times from weeklyRoster + bilingualRoster, grouped by classification.
const EARLY_SHIFTS = [
    '06:20-13:35', '06:20-13:45', '06:20-14:00', '06:20-14:20', '06:20-14:50',
    '07:00-15:00', '07:00-16:00', '07:15-15:45', '07:55-15:55',
    '08:00-14:30', '08:00-16:30', '08:00-17:00',
    '08:30-16:30', '08:30-17:00',
];
const LATE_SHIFTS = [
    '11:00-19:30',
    '12:00-19:00', '12:00-20:00', '12:00-21:00',
    '13:00-21:00', '13:30-21:00', '13:30-22:00',
    '14:00-22:30', '14:25-23:55', '14:30-22:00', '14:30-23:25',
    '14:45-23:55', '15:00-23:30', '15:15-23:55', '15:25-23:25',
];

// ============================================
// STATE
// ============================================

/**
 * @type {{ patterns: Object.<string,{sun:string,mon:string,tue:string,wed:string,thu:string,fri:string,sat:string}>,
 *          meta: Object.<string,{staffName:string,isBilingual:boolean,isFixed:boolean}> } | null}
 */
let design      = null;
let designDirty = false;
let staffDirty  = false;

// ============================================
// HELPERS
// ============================================

/** Classify a shift value into a CSS colour class. */
function classifyShift(shift) {
    if (!shift || shift === 'RD' || shift === 'OFF') return 'rd';
    if (shift === 'SPARE') return 'spare';
    const h = parseInt(shift.slice(0, 2), 10);
    if (h >= 4 && h < 11) return 'early';
    if (h >= 11 && h < 21) return 'late';
    return 'night';
}

/** Compact label for a shift in a narrow grid cell. */
function shiftLabel(shift) {
    if (!shift || shift === 'RD' || shift === 'OFF') return 'RD';
    if (shift === 'SPARE') return 'SP';
    return shift.slice(0, 5); // "HH:MM"
}

/** Normalise a weekly-roster pattern entry: replaces OFF with RD. */
function normalisePattern(week) {
    const out = {};
    for (const d of DAYS) {
        const v = (week && week[d]) ? week[d] : 'RD';
        out[d] = (v === 'OFF') ? 'RD' : v;
    }
    return out;
}

/** All-RD pattern (vacant or unknown position). */
const emptyPattern = () => Object.fromEntries(DAYS.map(d => [d, 'RD']));

/**
 * Build a default 28-position design from the current roster data:
 *   Positions 1–20  — CEA main roster, one position per week number
 *   Positions 21–22 — CEA bilingual (D. Irvine week 3, T. Gherbi week 6)
 *   Position 23     — C. Reen fixed hours (Mon–Fri 12:00–19:00)
 *   Positions 24–28 — Vacant (all RD)
 *
 * @returns {{ patterns: Object, meta: Object }}
 */
function buildDefaultDesign() {
    const patterns = {};
    const meta     = {};

    // Positions 1–20: one entry per week of the CEA main 20-week roster
    for (let week = 1; week <= 20; week++) {
        const pos     = String(week);
        patterns[pos] = normalisePattern(weeklyRoster[week]);
        const member  = teamMembers.find(
            m => m.rosterType === 'main' && !m.hidden && !m.managerOnly && m.currentWeek === week
        );
        meta[pos] = { staffName: member?.name ?? '', isFixed: false };
    }

    // Positions 21–22: the two remaining bilingual CEAs
    const blMembers = teamMembers.filter(m => m.rosterType === 'bilingual' && !m.hidden);
    for (let i = 0; i < 2; i++) {
        const pos    = String(21 + i);
        const member = blMembers[i] ?? null;
        const week   = member?.currentWeek ?? (i + 1);
        patterns[pos] = normalisePattern(bilingualRoster[week]);
        meta[pos]     = { staffName: member?.name ?? '', isFixed: false };
    }

    // Position 23: C. Reen — fixed Mon–Fri 12:00–19:00
    patterns[String(FIXED_POS)] = {
        sun: 'RD', mon: '12:00-19:00', tue: '12:00-19:00',
        wed: '12:00-19:00', thu: '12:00-19:00', fri: '12:00-19:00', sat: 'RD',
    };
    meta[String(FIXED_POS)] = { staffName: 'C. Reen', isFixed: true };

    // Positions 24–28: vacant placeholders
    for (let i = 0; i < 5; i++) {
        const pos  = String(VACANT_FROM + i);
        patterns[pos] = emptyPattern();
        meta[pos]     = { staffName: '', isFixed: false };
    }

    return { patterns, meta };
}

/** Count early/late/spare/rd per day across all 28 positions. */
function calcCoverage(patterns) {
    const cov = {};
    for (const d of DAYS) cov[d] = { early: 0, late: 0, spare: 0, rd: 0 };
    for (let pos = 1; pos <= TOTAL_POS; pos++) {
        const p = patterns[String(pos)];
        if (!p) continue;
        for (const d of DAYS) {
            const type = classifyShift(p[d] ?? 'RD');
            if (cov[d][type] !== undefined) cov[d][type]++;
            else cov[d].rd++;
        }
    }
    return cov;
}

/** HTML for the shift dropdown inside an editing cell. */
function buildSelectOptions(currentVal) {
    const opt = (val, label) => {
        const sel = val === currentVal ? ' selected' : '';
        return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
    };
    return [
        opt('RD',    'RD — Rest Day'),
        opt('SPARE', 'SPARE — Standby'),
        '<optgroup label="Early (before 11:00)">',
        ...EARLY_SHIFTS.map(s => opt(s, s)),
        '</optgroup>',
        '<optgroup label="Late (11:00 onward)">',
        ...LATE_SHIFTS.map(s => opt(s, s)),
        '</optgroup>',
    ].join('');
}

// ============================================
// GRID RENDERING
// ============================================

function renderGrid() {
    const tbody    = document.getElementById('linksGridBodyRows');
    const tfoot    = document.getElementById('linksCoverageFoot');
    const wrapper  = document.getElementById('linksGridWrapper');
    const emptyMsg = document.getElementById('linksEmptyMsg');
    const saveRow  = document.getElementById('linksSaveRow');

    if (!design) {
        if (wrapper)  wrapper.style.display  = 'none';
        if (emptyMsg) emptyMsg.style.display = '';
        if (saveRow)  saveRow.style.display  = 'none';
        if (tbody)    tbody.innerHTML = '';
        if (tfoot)    tfoot.innerHTML = '';
        return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (wrapper)  wrapper.style.display  = '';
    if (saveRow)  saveRow.style.display  = '';

    // Build body rows
    const rows = [];
    for (let pos = 1; pos <= TOTAL_POS; pos++) {
        const posStr  = String(pos);
        const p       = design.patterns[posStr] || emptyPattern();
        const m       = design.meta[posStr] || { staffName: '', isFixed: false };
        const isFixed  = m.isFixed;
        const isVacant = !isFixed && !m.staffName;
        const rowClass = isFixed ? 'row-fixed' : (isVacant ? 'row-vacant' : 'row-normal');

        let staffHtml = escapeHtml(m.staffName || '—');
        if (!m.staffName && !isFixed) {
            staffHtml += ' <span class="vacant-tag">(vacant)</span>';
        } else if (isFixed) {
            staffHtml += ' <span class="fixed-tag">Fixed</span>';
        }

        const dayCells = DAYS.map((d, di) => {
            const shift = p[d] ?? 'RD';
            const type  = classifyShift(shift);
            const label = shiftLabel(shift);
            if (isFixed) {
                return `<td class="shift-cell">` +
                    `<button class="shift-cell-btn type-${type} fixed-cell" ` +
                    `aria-label="${DAY_LABELS[di]}: ${shift}" tabindex="-1">` +
                    `${escapeHtml(label)}</button></td>`;
            }
            return `<td class="shift-cell">` +
                `<button class="shift-cell-btn type-${type}" ` +
                `data-pos="${pos}" data-day="${d}" ` +
                `aria-label="Position ${pos} ${DAY_LABELS[di]}: ${shift} — tap to edit">` +
                `${escapeHtml(label)}</button></td>`;
        }).join('');

        rows.push(
            `<tr class="${rowClass}" data-pos="${pos}">` +
            `<td class="pos-num">${pos}</td>` +
            `<td class="staff-name">${staffHtml}</td>` +
            dayCells +
            `</tr>`
        );
    }
    if (tbody) tbody.innerHTML = rows.join('');

    // Coverage footer
    renderFooter();

    // Wire up cell click handlers
    tbody?.querySelectorAll('.shift-cell-btn:not(.fixed-cell)').forEach(btn => {
        btn.addEventListener('click', () => openCellEdit(btn));
    });

    renderCoverageChart();
}

function renderFooter() {
    const tfoot = document.getElementById('linksCoverageFoot');
    if (!tfoot || !design) return;
    const cov = calcCoverage(design.patterns);
    const cells = DAYS.map(d => {
        const { early, late, spare } = cov[d];
        const worked = early + late + spare;
        return `<td class="cov-cell">` +
            `<span class="cov-num">${worked}</span>` +
            `<span class="cov-label-e"> E:${early}</span>` +
            ` <span class="cov-label-l">L:${late}</span>` +
            (spare ? ` <span class="cov-label-s">SP:${spare}</span>` : '') +
            `</td>`;
    }).join('');
    tfoot.innerHTML =
        `<tr><td class="col-pos"></td><td class="col-staff">Coverage</td>${cells}</tr>`;
}

// ============================================
// INLINE CELL EDITING
// ============================================

function openCellEdit(btn) {
    const cell    = btn.parentElement;
    const pos     = btn.dataset.pos;
    const day     = btn.dataset.day;
    const current = design.patterns[pos]?.[day] ?? 'RD';

    const select = document.createElement('select');
    select.className = 'shift-cell-select';
    select.setAttribute('aria-label', `Position ${pos} ${day}: change shift`);
    select.innerHTML = buildSelectOptions(current);

    let committed = false;

    select.addEventListener('change', () => {
        committed = true;
        const newVal = select.value;
        if (!design.patterns[pos]) design.patterns[pos] = emptyPattern();
        design.patterns[pos][day] = newVal;
        designDirty = true;
        updateSaveBtn();
        cell.innerHTML = '';
        restoreBtn(cell, pos, day, newVal);
        renderFooter();
        renderCoverageChart();
    });

    select.addEventListener('blur', () => {
        if (!committed) {
            cell.innerHTML = '';
            restoreBtn(cell, pos, day, current);
        }
    });

    cell.innerHTML = '';
    cell.appendChild(select);
    requestAnimationFrame(() => select.focus());
}

function restoreBtn(cell, pos, day, shift) {
    const type   = classifyShift(shift);
    const label  = shiftLabel(shift);
    const dayIdx = DAYS.indexOf(day);
    const btn    = document.createElement('button');
    btn.className     = `shift-cell-btn type-${type}`;
    btn.dataset.pos   = pos;
    btn.dataset.day   = day;
    btn.setAttribute('aria-label', `Position ${pos} ${DAY_LABELS[dayIdx]}: ${shift} — tap to edit`);
    btn.textContent   = label;
    btn.addEventListener('click', () => openCellEdit(btn));
    cell.appendChild(btn);
}

// ============================================
// COVERAGE BAR CHART
// ============================================

function renderCoverageChart() {
    const wrap     = document.getElementById('coverageBarChart');
    const emptyMsg = document.getElementById('coverageEmptyMsg');
    if (!wrap) return;

    if (!design) {
        wrap.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = '';
        return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    wrap.style.display = '';

    const cov   = calcCoverage(design.patterns);
    const BAR_H = 72; // px

    const cols = DAYS.map((d, di) => {
        const { early, late, spare } = cov[d];
        const worked = early + late + spare;
        // Heights proportional to share of total positions (28).
        // DOM order: early, late, spare → with column-reverse, early sits at bottom.
        const eH = Math.round((early / TOTAL_POS) * BAR_H);
        const lH = Math.round((late  / TOTAL_POS) * BAR_H);
        const sH = Math.round((spare / TOTAL_POS) * BAR_H);

        return `<div class="cov-day-col">` +
            `<span class="cov-count">${worked}</span>` +
            `<div class="cov-bar-wrap" style="height:${BAR_H}px">` +
            (eH ? `<div class="cov-bar-seg early" style="height:${eH}px"></div>` : '') +
            (lH ? `<div class="cov-bar-seg late"  style="height:${lH}px"></div>` : '') +
            (sH ? `<div class="cov-bar-seg spare" style="height:${sH}px"></div>` : '') +
            `</div>` +
            `<span class="cov-day-label">${DAY_LABELS[di]}</span>` +
            `</div>`;
    }).join('');

    wrap.innerHTML =
        `<div class="links-cov-chart">${cols}</div>` +
        `<div class="cov-legend">` +
        `<div class="cov-legend-item"><div class="cov-legend-dot early"></div>Early</div>` +
        `<div class="cov-legend-item"><div class="cov-legend-dot late"></div>Late</div>` +
        `<div class="cov-legend-item"><div class="cov-legend-dot spare"></div>Spare</div>` +
        `<div class="cov-legend-item"><div class="cov-legend-dot rd"></div>RD/Vacant</div>` +
        `</div>`;
}

// ============================================
// STAFF ASSIGNMENT PANEL
// ============================================

function renderStaffPanel() {
    const list     = document.getElementById('linksStaffList');
    const emptyMsg = document.getElementById('staffEmptyMsg');
    const saveRow  = document.getElementById('linksStaffSaveRow');
    if (!list) return;

    if (!design) {
        list.style.display      = 'none';
        if (emptyMsg) emptyMsg.style.display = '';
        if (saveRow)  saveRow.style.display  = 'none';
        return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    list.style.display     = '';
    if (saveRow) saveRow.style.display   = '';

    const rows = [];
    for (let pos = 1; pos <= TOTAL_POS; pos++) {
        const posStr = String(pos);
        const m      = design.meta[posStr] || { staffName: '', isFixed: false };

        if (m.isFixed) {
            rows.push(
                `<div class="links-staff-row" data-pos="${pos}">` +
                `<span class="links-staff-pos">${pos}</span>` +
                `<span style="flex:1;font-size:var(--type-body);color:var(--text-mid)">${escapeHtml(m.staffName)}</span>` +
                `<span class="links-staff-fixed-badge">Fixed hours</span>` +
                `</div>`
            );
        } else {
            rows.push(
                `<div class="links-staff-row" data-pos="${pos}">` +
                `<span class="links-staff-pos">${pos}</span>` +
                `<input class="links-staff-name-input" type="text" ` +
                `value="${escapeHtml(m.staffName)}" placeholder="Vacant" ` +
                `data-pos="${pos}" aria-label="Staff name for position ${pos}">` +
                `</div>`
            );
        }
    }
    list.innerHTML = rows.join('');

    list.querySelectorAll('.links-staff-name-input[data-pos]').forEach(input => {
        input.addEventListener('input', () => {
            const pos = input.dataset.pos;
            if (!design.meta[pos]) design.meta[pos] = { staffName: '', isFixed: false };
            design.meta[pos].staffName = input.value.trim();
            staffDirty = true;
            updateStaffSaveBtn();
        });
    });
}

// ============================================
// SAVE / LOAD
// ============================================

function updateSaveBtn() {
    const btn    = document.getElementById('linksSaveBtn');
    const status = document.getElementById('linksSaveStatus');
    if (btn) btn.disabled = !designDirty;
    if (status && designDirty) status.textContent = '';
}

function updateStaffSaveBtn() {
    const btn    = document.getElementById('linksStaffSaveBtn');
    const status = document.getElementById('linksStaffSaveStatus');
    if (btn) btn.disabled = !staffDirty;
    if (status && staffDirty) status.textContent = '';
}

async function saveDesign() {
    const btn    = document.getElementById('linksSaveBtn');
    const status = document.getElementById('linksSaveStatus');
    if (!design) return;
    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.className = 'links-save-status'; }

    try {
        await window._mybSession;
        await setDoc(DESIGN_REF, {
            patterns:  design.patterns,
            meta:      design.meta,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser,
        });
        designDirty = false;
        if (status) { status.textContent = 'Saved ✓'; status.className = 'links-save-status ok'; }
    } catch (err) {
        console.error('[Links] Save failed:', err);
        designDirty = true;
        if (btn) btn.disabled = false;
        if (status) { status.textContent = 'Save failed — try again'; status.className = 'links-save-status err'; }
    }
}

async function saveStaff() {
    const btn    = document.getElementById('linksStaffSaveBtn');
    const status = document.getElementById('linksStaffSaveStatus');
    if (!design) return;
    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.className = 'links-save-status'; }

    try {
        await window._mybSession;
        // merge: true preserves any fields we don't explicitly write
        await setDoc(DESIGN_REF, {
            patterns:  design.patterns,
            meta:      design.meta,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser,
        }, { merge: true });
        staffDirty = false;
        if (status) { status.textContent = 'Saved ✓'; status.className = 'links-save-status ok'; }
        renderGrid(); // refresh staff names in the grid
    } catch (err) {
        console.error('[Links] Staff save failed:', err);
        staffDirty = true;
        if (btn) btn.disabled = false;
        if (status) { status.textContent = 'Save failed — try again'; status.className = 'links-save-status err'; }
    }
}

async function loadDesign() {
    try {
        await window._mybSession;
        const snap = await getDoc(DESIGN_REF);
        if (snap.exists()) {
            const data = snap.data();
            design = { patterns: data.patterns || {}, meta: data.meta || {} };
        } else {
            design = null;
        }
    } catch (err) {
        console.error('[Links] Load failed:', err);
        design = null;
    }
    designDirty = false;
    staffDirty  = false;
    renderGrid();
    renderStaffPanel();
    updateSaveBtn();
    updateStaffSaveBtn();
}

function initFromRosters() {
    if (!confirm('Initialise from current rosters? This will overwrite any unsaved changes to the design.')) return;
    design = buildDefaultDesign();
    designDirty = true;
    staffDirty  = true;
    renderGrid();
    renderStaffPanel();
    updateSaveBtn();
    updateStaffSaveBtn();
    const status = document.getElementById('linksInitStatus');
    if (status) {
        status.textContent = 'Design seeded — review and save when ready.';
        status.className   = 'links-save-status ok';
    }
}

// ============================================
// COLLAPSIBLE CARDS
// ============================================
function initCardCollapse(triggerId, bodyId, chevronId) {
    const trigger = document.getElementById(triggerId);
    const body    = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if (!trigger || !body || !chevron) return;
    trigger.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
}

initCardCollapse('coverageToggleHeader',   'coverageBody',   'coverageChevron');
initCardCollapse('linksGridToggleHeader',  'linksGridBody',  'linksGridChevron');
initCardCollapse('linksInitToggleHeader',  'linksInitBody',  'linksInitChevron');
initCardCollapse('linksStaffToggleHeader', 'linksStaffBody', 'linksStaffChevron');

// ============================================
// BUTTON HANDLERS
// ============================================
document.getElementById('linksSaveBtn')?.addEventListener('click', saveDesign);
document.getElementById('linksInitBtn')?.addEventListener('click', initFromRosters);
document.getElementById('linksStaffSaveBtn')?.addEventListener('click', saveStaff);

// ============================================
// ICON LIGHTBOX — tap drawer logo for About
// ============================================
(function () {
    const lightbox   = document.getElementById('iconLightbox');
    const headerIcon = document.getElementById('appIcon');
    const closeBtn   = document.getElementById('iconLightboxClose');
    const versionEl  = document.getElementById('lightboxVersion');
    const statusEl   = document.getElementById('lightboxUpdateStatus');
    const bugLink    = document.getElementById('linksBugReportLink');
    if (!lightbox || !headerIcon) return;

    if (versionEl) versionEl.textContent = CONFIG.APP_VERSION;

    function open() {
        if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; }
        if (bugLink) {
            const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const body = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster Links v${CONFIG.APP_VERSION}\nUser: ${currentUser}\nDate: ${date}\nBrowser: ${navigator.userAgent}`;
            bugLink.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — MYB Roster Links v${CONFIG.APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
        }
        lightbox.classList.add('visible');
        requestAnimationFrame(() => { lightbox.classList.add('open'); closeBtn?.focus(); });
        lockBodyScroll();
        _pushOverlayState(close);
        document.addEventListener('keydown', onKey);
    }

    function close() { dismissOverlay(lightbox, { onKey }); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    openAboutLightbox = open;
    headerIcon.title = 'Back to calendar';
    headerIcon.setAttribute('aria-label', 'Back to calendar');
    headerIcon.addEventListener('click', () => { window.location.href = './index.html'; });
    lightbox.addEventListener('click', e => { if (e.target === lightbox || e.target === closeBtn) close(); });
    if (bugLink) bugLink.addEventListener('click', e => e.stopPropagation());
})();

// ============================================
// TIPS LIGHTBOX — ? button on each card
// ============================================
(function () {
    const lb       = document.getElementById('tipsLightbox');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb) return;

    const CARD_TIPS = {
        'links-coverage': {
            title: 'Coverage analysis',
            sections: [{ items: [
                { icon: '📊', html: 'Shows how many positions are <strong>working</strong> each day across the 28-position link' },
                { icon: '🔵', html: '<strong>Early</strong> — shifts starting before 11:00' },
                { icon: '🟠', html: '<strong>Late</strong> — shifts starting at 11:00 or after' },
                { icon: '🟡', html: '<strong>Spare</strong> — standby positions with no fixed shift time' },
                { icon: '💡', html: 'Coverage updates live as you edit cells in the grid below' },
            ]}],
        },
        'links-grid': {
            title: 'Link design grid',
            sections: [
                { heading: 'How it works', items: [
                    { icon: '📋', html: 'Each <strong>row</strong> is one position in the 28-position link. Each <strong>column</strong> is a day of the week (Sun–Sat).' },
                    { icon: '🔄', html: 'In a 28-person link all 28 patterns are always in use simultaneously — one per person.' },
                    { icon: '✏️', html: '<strong>Tap any cell</strong> to change the shift for that day. Fixed positions (C. Reen) are not editable.' },
                    { icon: '💾', html: 'Tap <strong>Save design</strong> when happy with your changes.' },
                ]},
                { heading: 'Row types', items: [
                    { icon: '👤', html: '<strong>Normal</strong> — standard CEA position' },
                    { icon: '🔒', html: '<strong>Fixed</strong> — C. Reen\'s fixed hours (Mon–Fri 12:00–19:00); not editable' },
                    { icon: '⬜', html: '<strong>Vacant</strong> — placeholder for future recruitment' },
                ]},
            ],
        },
        'links-init': {
            title: 'Initialise from current rosters',
            sections: [{ items: [
                { icon: '⚙️', html: 'Seeds the design grid from the current roster data as a <strong>starting point</strong>' },
                { icon: '1️⃣', html: 'Positions 1–20: each member\'s current weekly pattern from the CEA 20-week main roster' },
                { icon: '2️⃣', html: 'Positions 21–22: D. Irvine and T. Gherbi\'s current patterns from the bilingual roster' },
                { icon: '3️⃣', html: 'Position 23: C. Reen\'s fixed Mon–Fri 12:00–19:00 pattern' },
                { icon: '4️⃣', html: 'Positions 24–28: all RD (vacant placeholders for future recruitment)' },
                { icon: '⚠️', html: '<strong>This will overwrite any unsaved changes.</strong> Use it once to get started, then save and edit from there.' },
            ]}],
        },
        'links-staff': {
            title: 'Staff assignment',
            sections: [{ items: [
                { icon: '👤', html: 'Change the staff member assigned to each position — useful when people move between positions' },
                { icon: '💾', html: 'Tap <strong>Save assignments</strong> when done — the grid updates automatically' },
                { icon: '🔒', html: 'Position 23 (C. Reen) is fixed and cannot be reassigned' },
            ]}],
        },
    };

    function openTips(card) {
        const data = CARD_TIPS[card];
        if (!data || !titleEl || !bodyEl) return;
        titleEl.textContent = data.title;
        bodyEl.innerHTML = data.sections.map(section => {
            const heading = section.heading
                ? `<div class="tips-lb-section">${escapeHtml(section.heading)}</div>`
                : '';
            const items = section.items.map(item =>
                `<div class="tips-lb-item"><span class="tips-lb-icon" aria-hidden="true">${item.icon}</span><span>${item.html}</span></div>`
            ).join('');
            return heading + items;
        }).join('');
        lb.classList.add('visible');
        requestAnimationFrame(() => { lb.classList.add('open'); closeBtn?.focus(); });
        lockBodyScroll();
        _pushOverlayState(closeTips);
        document.addEventListener('keydown', onKey);
    }

    function closeTips() { dismissOverlay(lb, { onKey }); }
    function onKey(e)    { if (e.key === 'Escape') closeTips(); }

    document.querySelectorAll('.btn-card-tips').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openTips(btn.dataset.card); });
    });
    if (closeBtn) closeBtn.addEventListener('click', closeTips);
    lb.addEventListener('click', e => { if (e.target === lb) closeTips(); });
})();

// ============================================
// SERVICE WORKER
// ============================================
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
                window.location.reload();
            }, { once: true });
        })
        .catch(e => console.warn('[SW] Registration failed:', e));
}

// ============================================
// BOOT — load design on page open
// ============================================
loadDesign();
