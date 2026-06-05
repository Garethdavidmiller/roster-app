/**
 * links-app.js — Coordinator for links.html.
 *
 * Owns: auth guard (LINKS_DESIGNERS check), Firestore load/save for
 *   linkDesigns/combined-28, 28×7 design grid, coverage analysis,
 *   inline staff assignment, and initialise-from-rosters action.
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
    onSignOut: () => {
        if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
        clearSession();
        window.location.href = './admin.html';
    },
});

// ============================================
// CONSTANTS
// ============================================
const DAYS       = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOTAL_POS  = 28;
const FIXED_POS   = 28;  // C. Reen — fixed link, shown separately at bottom of grid
const VACANT_FROM = 23;  // lines 23–27 are vacant placeholders

const DESIGN_REF = doc(db, 'linkDesigns', 'combined-28');

// Shift option lists — derived at module load from actual roster data so the
// dropdown always matches real shifts without needing manual maintenance.
const { EARLY_SHIFTS, LATE_SHIFTS, NIGHT_SHIFTS } = (() => {
    const all = new Set();
    for (const roster of [weeklyRoster, bilingualRoster]) {
        for (const week of Object.values(roster)) {
            for (const shift of Object.values(week)) {
                if (shift && shift !== 'RD' && shift !== 'OFF' && shift !== 'SPARE') all.add(shift);
            }
        }
    }
    const early = [], late = [], night = [];
    for (const s of [...all].sort()) {
        const h = parseInt(s.slice(0, 2), 10);
        if (h >= 4 && h < 11) early.push(s);
        else if (h >= 11 && h < 21) late.push(s);
        else night.push(s);
    }
    return { EARLY_SHIFTS: early, LATE_SHIFTS: late, NIGHT_SHIFTS: night };
})();

// ============================================
// STATE
// ============================================

/**
 * @type {{ patterns: Object.<string,{sun:string,mon:string,tue:string,wed:string,thu:string,fri:string,sat:string}>,
 *          meta: Object.<string,{staffName:string,isFixed:boolean}> } | null}
 */
let design = null;
let dirty  = false;  // true when shifts or staff names have unsaved changes

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

/** Compact label for a shift in a grid cell — full time shown on two lines. */
function shiftLabel(shift) {
    if (!shift || shift === 'RD' || shift === 'OFF') return 'RD';
    if (shift === 'SPARE') return 'SP';
    const dash = shift.indexOf('-');
    return dash > 0 ? `${shift.slice(0, dash)}\n${shift.slice(dash + 1)}` : shift;
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
 * Build a default 28-position design from the current roster data.
 * @returns {{ patterns: Object, meta: Object }}
 */
function buildDefaultDesign() {
    const patterns = {};
    const meta     = {};

    // Positions 1–20: one entry per week of the CEA main 20-week roster.
    // Staff names are intentionally blank — who goes in which position is a
    // separate decision made after the link patterns themselves are agreed.
    for (let week = 1; week <= 20; week++) {
        const pos     = String(week);
        patterns[pos] = normalisePattern(weeklyRoster[week]);
        meta[pos]     = { staffName: '', isFixed: false };
    }

    // Positions 21–22: the two BL slots (patterns only — names left blank).
    const blMembers = teamMembers.filter(m => m.rosterType === 'bilingual' && !m.hidden);
    for (let i = 0; i < 2; i++) {
        const pos  = String(21 + i);
        const week = blMembers[i]?.currentWeek || (i + 1);
        patterns[pos] = normalisePattern(bilingualRoster[week]);
        meta[pos]     = { staffName: '', isFixed: false };
    }

    // Lines 23–27: vacant placeholders
    for (let i = 0; i < 5; i++) {
        const pos  = String(VACANT_FROM + i);
        patterns[pos] = emptyPattern();
        meta[pos]     = { staffName: '', isFixed: false };
    }

    // Line 28: C. Reen — fixed link, Mon–Fri 12:00–19:00, shown separately at bottom
    patterns[String(FIXED_POS)] = {
        sun: 'RD', mon: '12:00-19:00', tue: '12:00-19:00',
        wed: '12:00-19:00', thu: '12:00-19:00', fri: '12:00-19:00', sat: 'RD',
    };
    meta[String(FIXED_POS)] = { staffName: 'C. Reen', isFixed: true };

    return { patterns, meta };
}

/** Count early/late/spare/night/rd per day across all 28 positions. */
function calcCoverage(patterns) {
    const cov = {};
    for (const d of DAYS) cov[d] = { early: 0, late: 0, spare: 0, night: 0, rd: 0 };
    for (let pos = 1; pos <= TOTAL_POS; pos++) {
        const p = patterns[String(pos)];
        if (!p) continue;
        for (const d of DAYS) {
            const type = classifyShift(p[d] ?? 'RD');
            cov[d][type]++;
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
    // If the current value isn't in any known group (e.g. roster was updated since last
    // save), add it as a plain option so the cell doesn't silently revert to RD on change.
    const known = new Set([...EARLY_SHIFTS, ...LATE_SHIFTS, ...NIGHT_SHIFTS]);
    const isUnknown = currentVal && currentVal !== 'RD' && currentVal !== 'SPARE' && !known.has(currentVal);
    return [
        opt('RD',    'RD — Rest Day'),
        opt('SPARE', 'SPARE — Standby'),
        ...(isUnknown ? ['<optgroup label="Current">', opt(currentVal, `${currentVal} (current)`), '</optgroup>'] : []),
        ...(EARLY_SHIFTS.length ? ['<optgroup label="Early (starting before 11:00)">', ...EARLY_SHIFTS.map(s => opt(s, s)), '</optgroup>'] : []),
        ...(LATE_SHIFTS.length  ? ['<optgroup label="Late (starting 11:00 or after)">', ...LATE_SHIFTS.map(s => opt(s, s)), '</optgroup>'] : []),
    ].join('');
}

// ============================================
// GRID RENDERING
// ============================================

function renderGrid() {
    const tbody      = document.getElementById('linksGridBodyRows');
    const tfoot      = document.getElementById('linksCoverageFoot');
    const wrapper    = document.getElementById('linksGridWrapper');
    const emptyState = document.getElementById('linksEmptyState');
    const saveRow    = document.getElementById('linksSaveRow');

    if (!design) {
        if (wrapper)    wrapper.style.display    = 'none';
        if (emptyState) emptyState.style.display = '';
        if (saveRow)    saveRow.style.display    = 'none';
        if (tbody)      tbody.innerHTML          = '';
        if (tfoot)      tfoot.innerHTML          = '';
        renderCoverageChart();
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (wrapper)    wrapper.style.display    = '';
    if (saveRow)    saveRow.style.display    = '';

    const rows = [];
    for (let pos = 1; pos <= TOTAL_POS; pos++) {
        // Insert a visual separator row immediately before the fixed link (Line 28).
        if (pos === FIXED_POS) {
            rows.push(
                `<tr class="fixed-link-separator">` +
                `<td colspan="9">Fixed Link — additional cover</td>` +
                `</tr>`
            );
        }

        const posStr  = String(pos);
        const p       = design.patterns[posStr] || emptyPattern();
        const m       = design.meta[posStr] || { staffName: '', isFixed: false };
        const isFixed  = m.isFixed;
        const isVacant = !isFixed && !m.staffName;
        const rowClass = isFixed ? 'row-fixed' : (isVacant ? 'row-vacant' : 'row-normal');

        // Staff name cell: plain text for fixed row; inline input for all others.
        // Placeholder shows the line name so vacant rows are identifiable at a glance.
        const staffCellHtml = isFixed
            ? `<td class="staff-name">${escapeHtml(m.staffName)}<span class="fixed-tag">Fixed</span></td>`
            : `<td class="staff-name"><input class="staff-name-input-inline" type="text" ` +
              `value="${escapeHtml(m.staffName)}" placeholder="Line ${posStr}" data-pos="${posStr}" ` +
              `autocomplete="off" spellcheck="false" aria-label="Staff name for Line ${posStr}"></td>`;

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
                `data-pos="${posStr}" data-day="${d}" ` +
                `aria-label="Line ${posStr} ${DAY_LABELS[di]}: ${shift} — tap to edit">` +
                `${escapeHtml(label)}</button></td>`;
        }).join('');

        rows.push(
            `<tr class="${rowClass}" data-pos="${posStr}">` +
            `<td class="pos-num">${posStr}</td>` +
            staffCellHtml + dayCells +
            `</tr>`
        );
    }
    if (tbody) tbody.innerHTML = rows.join('');

    // Wire shift cell buttons
    tbody?.querySelectorAll('.shift-cell-btn:not(.fixed-cell)').forEach(btn => {
        btn.addEventListener('click', () => openCellEdit(btn));
    });

    // Wire inline staff name inputs
    tbody?.querySelectorAll('.staff-name-input-inline').forEach(input => {
        input.addEventListener('input', () => {
            const pos = input.dataset.pos;
            if (!design.meta[pos]) design.meta[pos] = { staffName: '', isFixed: false };
            design.meta[pos].staffName = input.value.trim();
            dirty = true;
            updateSaveBtn();
        });
    });

    const cov = calcCoverage(design.patterns);
    renderFooter(cov);
    renderCoverageChart(cov);
}

function renderFooter(cov) {
    const tfoot = document.getElementById('linksCoverageFoot');
    if (!tfoot || !design) return;
    if (!cov) cov = calcCoverage(design.patterns);
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
        dirty = true;
        updateSaveBtn();
        cell.innerHTML = '';
        restoreBtn(cell, pos, day, newVal);
        const cov = calcCoverage(design.patterns);
        renderFooter(cov);
        renderCoverageChart(cov);
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

function renderCoverageChart(cov) {
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

    if (!cov) cov = calcCoverage(design.patterns);
    const BAR_H = 96; // px

    const cols = DAYS.map((d, di) => {
        const { early, late, spare } = cov[d];
        const worked = early + late + spare;
        const eH = Math.round((early / TOTAL_POS) * BAR_H);
        const lH = Math.round((late  / TOTAL_POS) * BAR_H);
        const sH = Math.round((spare / TOTAL_POS) * BAR_H);
        // Warn only when absolutely no one is working — anything else is a design choice.
        const warn = worked === 0;

        // DOM order with column-reverse: first item sits at bottom.
        // Order: early (bottom) → late → spare (top).
        return `<div class="cov-day-col">` +
            `<span class="cov-count${warn ? ' cov-count-warn' : ''}">${worked}</span>` +
            `<div class="cov-bar-wrap" style="height:${BAR_H}px">` +
            `<div class="cov-bar-ref-line"></div>` +
            (eH ? `<div class="cov-bar-seg early" style="height:${eH}px"></div>` : '') +
            (lH ? `<div class="cov-bar-seg late"  style="height:${lH}px"></div>` : '') +
            (sH ? `<div class="cov-bar-seg spare" style="height:${sH}px"></div>` : '') +
            `</div>` +
            `<span class="cov-day-label${warn ? ' cov-day-label-warn' : ''}">${DAY_LABELS[di]}</span>` +
            `</div>`;
    }).join('');

    wrap.innerHTML =
        `<div class="links-cov-chart">${cols}</div>` +
        `<div class="cov-legend">` +
        `<div class="cov-legend-item"><div class="cov-legend-dot early"></div>Early</div>` +
        `<div class="cov-legend-item"><div class="cov-legend-dot late"></div>Late</div>` +
        `<div class="cov-legend-item"><div class="cov-legend-dot spare"></div>Spare</div>` +
        `<div class="cov-legend-item"><div class="cov-legend-dot rd"></div>Rest/vacant</div>` +
        `</div>`;
}

// ============================================
// SAVE / LOAD
// ============================================

function updateSaveBtn() {
    const btn    = document.getElementById('linksSaveBtn');
    const status = document.getElementById('linksSaveStatus');
    if (btn) btn.disabled = !dirty;
    if (status && dirty) status.textContent = '';
}

function updateLastSaved(updatedBy, updatedAt) {
    const el = document.getElementById('linksLastSaved');
    if (!el) return;
    if (!updatedBy) { el.textContent = ''; return; }
    const d       = updatedAt?.toDate?.();
    const timeStr = d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    el.textContent = `Last saved by ${updatedBy}` + (timeStr ? ` at ${timeStr}` : '');
}

/** Saves both patterns and staff meta in a single Firestore write. */
async function saveChanges() {
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
        dirty = false;
        updateSaveBtn();
        if (status) { status.textContent = 'Saved ✓'; status.className = 'links-save-status ok'; }
        updateLastSaved(currentUser, { toDate: () => new Date() });
        // Update vacant/normal row classes in-place without wiping inputs or losing focus.
        document.querySelectorAll('#linksGridBodyRows tr[data-pos]').forEach(row => {
            const pos = row.dataset.pos;
            const m   = design.meta[pos] || {};
            if (m.isFixed) return;
            row.classList.toggle('row-vacant', !m.staffName);
            row.classList.toggle('row-normal', !!m.staffName);
        });
    } catch (err) {
        console.error('[Links] Save failed:', err);
        dirty = true;
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
            // Migrate pre-v12.09 data: C. Reen was at position 23, now at position 28.
            // Swap if 23 is marked fixed and 28 is not yet populated as fixed.
            if (design.meta['23']?.isFixed && !design.meta['28']?.isFixed) {
                design.patterns['28'] = design.patterns['23'];
                design.meta['28']    = design.meta['23'];
                design.patterns['23'] = emptyPattern();
                design.meta['23']    = { staffName: '', isFixed: false };
            }
            updateLastSaved(data.updatedBy, data.updatedAt);
        } else {
            design = null;
        }
    } catch (err) {
        console.error('[Links] Load failed:', err);
        design = null;
    }
    dirty = false;
    renderGrid();
    updateSaveBtn();
}

function initFromRosters() {
    if (!confirm('Initialise from current rosters? This will overwrite any unsaved changes to the design.')) return;
    design = buildDefaultDesign();
    dirty  = true;
    renderGrid();
    updateSaveBtn();
    // Show feedback in the grid save row — always visible once the grid is shown,
    // so this works whether triggered from the inline button or the Init card.
    const saveStatus = document.getElementById('linksSaveStatus');
    if (saveStatus) {
        saveStatus.textContent = 'Design seeded — save when ready.';
        saveStatus.className   = 'links-save-status ok';
    }
    // Also update the Init card status in case that card is open.
    const initStatus = document.getElementById('linksInitStatus');
    if (initStatus) {
        initStatus.textContent = 'Design seeded — review and save when ready.';
        initStatus.className   = 'links-save-status ok';
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

initCardCollapse('linksGridToggleHeader',  'linksGridBody',  'linksGridChevron');
initCardCollapse('coverageToggleHeader',   'coverageBody',   'coverageChevron');
initCardCollapse('linksInitToggleHeader',  'linksInitBody',  'linksInitChevron');

// ============================================
// BUTTON HANDLERS
// ============================================
document.getElementById('linksSaveBtn')?.addEventListener('click', saveChanges);
document.getElementById('linksInitBtn')?.addEventListener('click', initFromRosters);
document.getElementById('linksInitBtnInline')?.addEventListener('click', initFromRosters);

// ============================================
// UNSAVED CHANGES GUARD
// ============================================
window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

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

    let _iconFocusReturn = null;
    function open() {
        _iconFocusReturn = document.activeElement;
        if (statusEl) {
            statusEl.textContent = '';
            statusEl.className = 'lightbox-status';
            (navigator.serviceWorker?.getRegistration() ?? Promise.resolve(null))
                .then(reg => {
                    statusEl.textContent = reg?.waiting ? '↻ Update available — close and reopen to refresh' : '✓ Up to date';
                    statusEl.className   = reg?.waiting ? 'lightbox-status needs-update' : 'lightbox-status up-to-date';
                })
                .catch(() => { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; });
        }
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

    function close() { dismissOverlay(lightbox, { onKey, focusReturn: _iconFocusReturn }); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    openAboutLightbox = open;
    headerIcon.title = 'Back to calendar';
    headerIcon.setAttribute('aria-label', 'Back to calendar');
    headerIcon.addEventListener('click', () => {
        if (dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
        window.location.href = './index.html';
    });
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
                { icon: '📊', html: 'Shows how many of the 28 positions are <strong>working</strong> each day' },
                { icon: '🔵', html: '<strong>Early</strong> — shifts starting before 11:00' },
                { icon: '🟠', html: '<strong>Late</strong> — shifts starting at 11:00 or after' },
                { icon: '🟡', html: '<strong>Spare</strong> — standby positions with no fixed shift time' },
                { icon: '⬜', html: 'The grey portion of each bar is rest-day or vacant positions' },
                { icon: '💡', html: 'The dashed line marks 14 — half the link on shift. Coverage updates live as you edit cells.' },
            ]}],
        },
        'links-grid': {
            title: 'Link design grid',
            sections: [
                { heading: 'How it works', items: [
                    { icon: '📋', html: 'Each <strong>row</strong> is one of the 28 lines. Each <strong>column</strong> is a day of the week (Sun–Sat).' },
                    { icon: '🔄', html: 'Lines 1–27 are the main rotating link. Line 28 is the fixed link (C. Reen) — shown separately at the bottom as additional cover.' },
                    { icon: '✏️', html: '<strong>Tap any shift cell</strong> to change it. <strong>Tap a name field</strong> to assign staff to that line.' },
                    { icon: '💾', html: 'Tap <strong>Save changes</strong> when done — saves both shifts and names in one go.' },
                ]},
                { heading: 'Row types', items: [
                    { icon: '👤', html: '<strong>Named</strong> — a line with a staff member assigned' },
                    { icon: '🔒', html: '<strong>Fixed Link</strong> — Line 28, C. Reen\'s fixed hours (Mon–Fri 12:00–19:00); not editable. She covers gaps and breaks across the link.' },
                    { icon: '⬜', html: '<strong>Unassigned</strong> — placeholder shows the line number; tap to assign someone once the patterns are agreed' },
                ]},
            ],
        },
        'links-init': {
            title: 'Initialise from rosters',
            sections: [{ items: [
                { icon: '⚙️', html: 'Seeds the design grid from the current roster data as a <strong>starting point</strong>' },
                { icon: '1️⃣', html: 'Lines 1–20: the shift pattern for each week of the CEA 20-week main roster (names left blank — assign people after the link design is agreed)' },
                { icon: '2️⃣', html: 'Lines 21–22: the two BL roster patterns (names left blank)' },
                { icon: '3️⃣', html: 'Lines 23–27: all RD (vacant placeholders for future recruitment)' },
                { icon: '4️⃣', html: 'Line 28: C. Reen\'s fixed link (Mon–Fri 12:00–19:00) — shown separately at the bottom as additional cover' },
                { icon: '⚠️', html: '<strong>This will overwrite any unsaved changes.</strong> Use it once to get started, then save and edit.' },
            ]}],
        },
    };

    let _tipsFocusReturn = null;
    function openTips(card) {
        _tipsFocusReturn = document.activeElement;
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

    function closeTips() { dismissOverlay(lb, { onKey, focusReturn: _tipsFocusReturn }); }
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
                if (!dirty || confirm('An update is available. Reload to apply it? Unsaved changes will be lost.')) {
                    window.location.reload();
                }
            }, { once: true });
        })
        .catch(e => console.warn('[SW] Registration failed:', e));
}

// ============================================
// BOOT — load design on page open
// ============================================
loadDesign();
