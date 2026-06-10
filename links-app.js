/**
 * links-app.js — Coordinator for links.html.
 *
 * Owns: auth guard, Firestore load/save for linkDesigns/combined-28,
 *   28-line design grid, paint-mode brush bar, coverage analysis,
 *   design quality checks, and the auto-generator.
 * Pure maths (classifyShift, calcCoverage, generatePatterns, runDesignChecks)
 *   live in links-design.js — no DOM, no Firebase there.
 */

import { CONFIG, teamMembers, weeklyRoster, bilingualRoster, escapeHtml } from './roster-data.js';
import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase-client.js';
import { initNavPanel } from './nav-panel.js';
import { getSession, clearSession, ensureFirebaseSession } from './session.js';
import { lockBodyScroll, _pushOverlayState, dismissOverlay, initCardCollapse, trapFocus } from './overlay.js';
import { registerServiceWorker } from './sw-register.js';
import { lsGet, lsSet } from './ls.js';
import {
    DAYS,
    classifyShift,
    normaliseCustomShift,
    calcCoverage,
    generatePatterns,
    runDesignChecks,
} from './links-design.js';

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
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOTAL_POS  = 28;
const FIXED_POS  = 28;  // C. Reen — fixed link, shown separately at the bottom
const VACANT_FROM = 23; // lines 23–27 are vacant placeholders

const DESIGN_REF = doc(db, 'linkDesigns', 'combined-28');

// Shift option lists derived from actual roster data so they always match real shifts.
const { EARLY_SHIFTS, LATE_SHIFTS } = (() => {
    const all = new Set();
    for (const roster of [weeklyRoster, bilingualRoster]) {
        for (const week of Object.values(roster)) {
            for (const shift of Object.values(week)) {
                if (shift && shift !== 'RD' && shift !== 'OFF' && shift !== 'SPARE') all.add(shift);
            }
        }
    }
    const early = [], late = [];
    for (const s of [...all].sort()) {
        const h = parseInt(s.slice(0, 2), 10);
        if (h >= 4 && h < 11) early.push(s);
        else if (h >= 11 && h < 21) late.push(s);
        // Night times never appear here — CEAs do not work nights.
    }
    return { EARLY_SHIFTS: early, LATE_SHIFTS: late };
})();

// ============================================
// STATE
// ============================================
/** @type {{ patterns: Object.<string,{sun:string,mon:string,tue:string,wed:string,thu:string,fri:string,sat:string}> } | null} */
let design = null;
let dirty  = false;
let loadFailed      = false;
let loadedUpdatedAt = null; // millis — for the save concurrency check

// Paint-mode brush: string = armed shift, null = no brush
let brush = null;

// ============================================
// HELPERS
// ============================================

/** Compact two-line label for a shift button: "06:20\n14:20" or "RD" / "SP". */
function shiftLabel(shift) {
    if (!shift || shift === 'RD' || shift === 'OFF') return 'RD';
    if (shift === 'SPARE') return 'SP';
    const dash = shift.indexOf('-');
    return dash > 0 ? `${shift.slice(0, dash)}\n${shift.slice(dash + 1)}` : shift;
}

/** Start-time portion of a shift string for compact chip labels: "06:20-14:20" → "06:20". */
function formatShortTime(shift) {
    const dash = shift.indexOf('-');
    return dash > 0 ? shift.slice(0, dash) : shift;
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

/** All-RD pattern for vacant or unknown positions. */
const emptyPattern = () => Object.fromEntries(DAYS.map(d => [d, 'RD']));

/**
 * Build a default 28-line design from the current roster data.
 * Lines 1–20: one week per row of the CEA 20-week link.
 * Lines 21–22: bilingual roster patterns.
 * Lines 23–27: all RD (vacant placeholders).
 * Line 28: C. Reen's fixed Mon–Fri 12:00–19:00 link.
 */
function buildDefaultDesign() {
    const patterns = {};
    for (let week = 1; week <= 20; week++) {
        patterns[String(week)] = normalisePattern(weeklyRoster[week]);
    }
    const blMembers = teamMembers.filter(m => m.rosterType === 'bilingual' && !m.hidden);
    for (let i = 0; i < 2; i++) {
        const week = blMembers[i]?.currentWeek || (i + 1);
        patterns[String(21 + i)] = normalisePattern(bilingualRoster[week]);
    }
    for (let i = 0; i < 5; i++) {
        patterns[String(VACANT_FROM + i)] = emptyPattern();
    }
    patterns[String(FIXED_POS)] = {
        sun: 'RD', mon: '12:00-19:00', tue: '12:00-19:00',
        wed: '12:00-19:00', thu: '12:00-19:00', fri: '12:00-19:00', sat: 'RD',
    };
    return { patterns };
}

/** HTML for the shift dropdown inside an editing cell. */
function buildSelectOptions(currentVal) {
    const opt = (val, label) => {
        const sel = val === currentVal ? ' selected' : '';
        return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
    };
    const known = new Set([...EARLY_SHIFTS, ...LATE_SHIFTS]);
    const isUnknown = currentVal && currentVal !== 'RD' && currentVal !== 'SPARE' && !known.has(currentVal);
    // CEAs do not work night shifts — night times are never offered here.
    // normaliseCustomShift() also rejects starts between 21:00 and 03:59.
    return [
        opt('RD',    'RD — Rest Day'),
        opt('SPARE', 'SPARE — Standby'),
        ...(isUnknown ? ['<optgroup label="Current">', opt(currentVal, `${currentVal} (current)`), '</optgroup>'] : []),
        ...(EARLY_SHIFTS.length ? ['<optgroup label="Early (starting before 11:00)">', ...EARLY_SHIFTS.map(s => opt(s, s)), '</optgroup>'] : []),
        ...(LATE_SHIFTS.length  ? ['<optgroup label="Late (starting 11:00 or after)">', ...LATE_SHIFTS.map(s => opt(s, s)), '</optgroup>'] : []),
        opt('__custom__', 'Custom time…'),
    ].join('');
}

// ============================================
// PAINT BRUSH
// ============================================

function armBrush(shift) {
    brush = shift;
    document.querySelectorAll('.brush-chip').forEach(c => {
        c.classList.toggle('brush-chip--active', c.dataset.shift === shift);
    });
}

function dearmBrush() {
    brush = null;
    document.querySelectorAll('.brush-chip').forEach(c => c.classList.remove('brush-chip--active'));
}

function renderBrushBar() {
    const bar = document.getElementById('brushBar');
    if (!bar) return;
    if (!design) { bar.style.display = 'none'; return; }
    bar.style.display = '';

    const chip = (shift, label, typeClass, extra = '') =>
        `<button class="brush-chip type-${typeClass}${extra}" data-shift="${escapeHtml(shift)}" ` +
        `aria-label="Paint: ${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`;

    bar.innerHTML = [
        '<span class="brush-bar-label">Paint:</span>',
        chip('RD',    'RD',     'rd'),
        chip('SPARE', 'SP',     'spare'),
        ...EARLY_SHIFTS.map(s => chip(s, formatShortTime(s), 'early')),
        ...LATE_SHIFTS.map(s  => chip(s, formatShortTime(s), 'late')),
        `<button class="brush-chip brush-chip--custom" data-shift="__custom__" title="Custom time…">Custom…</button>`,
    ].join('');

    bar.querySelectorAll('.brush-chip').forEach(c => {
        c.addEventListener('click', () => {
            let shift = c.dataset.shift;
            if (shift === '__custom__') {
                const typed = normaliseCustomShift(
                    prompt('Enter a shift time, e.g. 06:00-14:00 (start between 04:00 and 20:59):', ''));
                if (!typed) return;
                shift = typed;
            }
            if (brush === shift) dearmBrush();
            else armBrush(shift);
        });
    });
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
    const resetRow   = document.getElementById('linksResetRow');

    if (!design) {
        const emptyMsg  = document.getElementById('linksEmptyMsg');
        const inlineBtn = document.getElementById('linksInitBtnInline');
        if (emptyMsg) emptyMsg.textContent = loadFailed
            ? 'Couldn’t load the saved design — check your connection and refresh the page.'
            : 'No link design loaded yet.';
        if (inlineBtn)  inlineBtn.style.display  = loadFailed ? 'none' : '';
        if (wrapper)    wrapper.style.display    = 'none';
        if (emptyState) emptyState.style.display = '';
        if (saveRow)    saveRow.style.display    = 'none';
        if (resetRow)   resetRow.style.display   = 'none';
        if (tbody)      tbody.innerHTML          = '';
        if (tfoot)      tfoot.innerHTML          = '';
        renderBrushBar();
        renderCoverageChart();
        renderDesignChecks();
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (wrapper)    wrapper.style.display    = '';
    if (saveRow)    saveRow.style.display    = '';
    if (resetRow)   resetRow.style.display   = '';

    const rows = [];
    for (let pos = 1; pos <= TOTAL_POS; pos++) {
        if (pos === FIXED_POS) {
            rows.push(
                `<tr class="fixed-link-separator">` +
                `<td colspan="8">Fixed Link — additional cover</td>` +
                `</tr>`
            );
        }

        const posStr  = String(pos);
        const p       = design.patterns[posStr] || emptyPattern();
        const isFixed  = pos === FIXED_POS;
        const isVacant = !isFixed && pos >= VACANT_FROM;
        const rowClass = isFixed ? 'row-fixed' : (isVacant ? 'row-vacant' : 'row-normal');

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
                `aria-label="Line ${posStr} ${DAY_LABELS[di]}: ${shift}">` +
                `${escapeHtml(label)}</button></td>`;
        }).join('');

        rows.push(
            `<tr class="${rowClass}" data-pos="${posStr}">` +
            `<td class="pos-num">${posStr}</td>` +
            dayCells +
            `</tr>`
        );
    }
    if (tbody) tbody.innerHTML = rows.join('');
    // Grid clicks are handled by delegated listener in wireGridEvents() — nothing to re-attach.

    const cov = calcCoverage(design.patterns);
    renderFooter(cov);
    renderCoverageChart(cov);
}

// Delegated grid events — one listener instead of one per cell button.
// #linksGridBodyRows is a static element in links.html.
(function wireGridEvents() {
    const tbody = document.getElementById('linksGridBodyRows');
    if (!tbody) return;

    tbody.addEventListener('click', e => {
        const btn = e.target.closest('.shift-cell-btn');
        if (!btn || btn.classList.contains('fixed-cell') || !design) return;

        const pos = btn.dataset.pos;
        const day = btn.dataset.day;

        if (brush !== null) {
            // Paint mode: apply brush directly without opening the dropdown.
            applyShift(pos, day, brush);
        } else {
            openCellEdit(btn);
        }
    });
})();

/** Apply a shift value to a cell, update state and re-render coverage. */
function applyShift(pos, day, shift) {
    if (!design.patterns[pos]) design.patterns[pos] = emptyPattern();
    design.patterns[pos][day] = shift;
    dirty = true;
    updateSaveBtn();

    // Update the button in-place without calling renderGrid() (which would kill focus/brush).
    const tbody = document.getElementById('linksGridBodyRows');
    const oldBtn = tbody?.querySelector(`.shift-cell-btn[data-pos="${pos}"][data-day="${day}"]`);
    if (oldBtn) restoreBtn(oldBtn.parentElement, pos, day, shift);

    const cov = calcCoverage(design.patterns);
    renderFooter(cov);
    renderCoverageChart(cov);
    renderDesignChecks();
}

function renderFooter(cov) {
    const tfoot = document.getElementById('linksCoverageFoot');
    if (!tfoot || !design) return;
    if (!cov) cov = calcCoverage(design.patterns);
    const cells = DAYS.map(d => {
        const { early, late, spare, night } = cov[d];
        const worked = early + late + spare + night;
        return `<td class="cov-cell">` +
            `<span class="cov-num">${worked}</span>` +
            `<span class="cov-label-e"> E:${early}</span>` +
            ` <span class="cov-label-l">L:${late}</span>` +
            (night ? ` <span class="cov-label-n">N:${night}</span>` : '') +
            (spare ? ` <span class="cov-label-s">SP:${spare}</span>` : '') +
            `</td>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="col-pos cov-foot-label">Cover</td>${cells}</tr>`;
}

// ============================================
// INLINE CELL EDITING (dropdown mode)
// ============================================

function openCellEdit(btn) {
    const cell     = btn.parentElement;
    const pos      = btn.dataset.pos;
    const day      = btn.dataset.day;
    const dayLabel = DAY_LABELS[DAYS.indexOf(day)];
    const current  = design.patterns[pos]?.[day] ?? 'RD';

    const select = document.createElement('select');
    select.className = 'shift-cell-select';
    select.setAttribute('aria-label', `Line ${pos} ${dayLabel}: change shift`);
    select.innerHTML = buildSelectOptions(current);

    let committed = false;

    function cancel() {
        committed = true;
        cell.innerHTML = '';
        restoreBtn(cell, pos, day, current);
    }

    select.addEventListener('change', () => {
        committed = true;
        let newVal = select.value;
        if (newVal === '__custom__') {
            const typed = normaliseCustomShift(
                prompt('Type the shift as start–end, e.g. 06:00-14:00 (CEA shifts start between 04:00 and 20:59)',
                    current.includes('-') ? current : ''));
            if (!typed) { cancel(); return; }
            newVal = typed;
        }
        cell.innerHTML = '';
        restoreBtn(cell, pos, day, newVal);
        applyShift(pos, day, newVal);
    });

    select.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    });

    select.addEventListener('blur', () => {
        if (!committed) cancel();
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
    btn.className   = `shift-cell-btn type-${type}`;
    btn.dataset.pos = pos;
    btn.dataset.day = day;
    btn.setAttribute('aria-label', `Line ${pos} ${DAY_LABELS[dayIdx]}: ${shift}`);
    btn.textContent = label;
    cell.innerHTML  = '';
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
    const BAR_H = 96;

    const cols = DAYS.map((d, di) => {
        const { early, late, spare, night } = cov[d];
        const worked = early + late + spare + night;
        const eH = Math.round((early / TOTAL_POS) * BAR_H);
        const lH = Math.round((late  / TOTAL_POS) * BAR_H);
        const nH = Math.round((night / TOTAL_POS) * BAR_H);
        const sH = Math.round((spare / TOTAL_POS) * BAR_H);
        const warn = worked === 0;

        return `<div class="cov-day-col">` +
            `<span class="cov-count${warn ? ' cov-count-warn' : ''}">${worked}</span>` +
            `<div class="cov-bar-wrap" style="height:${BAR_H}px">` +
            `<div class="cov-bar-ref-line"></div>` +
            (eH ? `<div class="cov-bar-seg early" style="height:${eH}px"></div>` : '') +
            (lH ? `<div class="cov-bar-seg late"  style="height:${lH}px"></div>` : '') +
            (nH ? `<div class="cov-bar-seg night" style="height:${nH}px"></div>` : '') +
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
// DESIGN QUALITY CHECKS
// ============================================

function renderDesignChecks() {
    const content  = document.getElementById('checksContent');
    const emptyMsg = document.getElementById('checksEmptyMsg');
    if (!content) return;

    if (!design) {
        if (emptyMsg) emptyMsg.style.display = '';
        return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Only check the 27 rotating lines — line 28 is fixed and does not rotate.
    const checks = runDesignChecks(design.patterns, 27);
    const { weekendsOff, totalWeeks, turnarounds, longestStretch, balance } = checks;
    const { early, late, spare, worked } = balance;
    const earlyPct = worked ? Math.round((early / worked) * 100) : 0;
    const latePct  = worked ? Math.round((late  / worked) * 100) : 0;

    const tick  = `<span class="check-icon check-tick" aria-hidden="true">✓</span>`;
    const warn  = `<span class="check-icon check-warn" aria-hidden="true">⚠</span>`;
    const cross = `<span class="check-icon check-cross" aria-hidden="true">✗</span>`;
    const info  = `<span class="check-icon check-info-icon" aria-hidden="true">ℹ</span>`;

    const rows = [];

    // Weekends off: Sat of line w + Sun of line w+1 both rest days.
    const wkendGood = weekendsOff >= Math.round(totalWeeks * 0.4); // 40% threshold
    rows.push(
        `<div class="check-row ${wkendGood ? 'check-good' : 'check-warn-row'}">` +
        `${wkendGood ? tick : warn}` +
        `<div class="check-body">` +
        `<strong>Weekends off</strong> — ${weekendsOff} out of ${totalWeeks} weeks ` +
        `<span class="check-note">(${Math.round(weekendsOff / totalWeeks * 100)}%)</span>` +
        `<div class="check-sub">A full weekend off = Saturday rest + next Sunday rest.</div>` +
        `</div></div>`
    );

    // Short turnarounds: consecutive shifts with less than 12 h rest.
    if (turnarounds.length === 0) {
        rows.push(
            `<div class="check-row check-good">` +
            `${tick}<div class="check-body"><strong>Rest between shifts</strong> — always 12 hours or more</div>` +
            `</div>`
        );
    } else {
        const cap = turnarounds.slice(0, 4);
        const more = turnarounds.length - cap.length;
        rows.push(
            `<div class="check-row check-bad">` +
            `${cross}<div class="check-body">` +
            `<strong>Short turnarounds</strong> — ${turnarounds.length} transition${turnarounds.length !== 1 ? 's' : ''} with less than 12 hours rest` +
            `<ul class="check-list">${cap.map(t =>
                `<li>Line ${t.fromLine} ${t.fromDay} (ends ${t.fromShift.split('-')[1] || ''}) → ` +
                `Line ${t.toLine} ${t.toDay} (starts ${t.toShift.split('-')[0] || ''}) — ` +
                `${Math.floor(t.restMinutes / 60)}h ${t.restMinutes % 60}m rest</li>`
            ).join('')}${more > 0 ? `<li>…and ${more} more</li>` : ''}</ul>` +
            `</div></div>`
        );
    }

    // Longest run of consecutive worked days.
    const stretchOk = longestStretch <= 7;
    rows.push(
        `<div class="check-row ${stretchOk ? 'check-good' : 'check-warn-row'}">` +
        `${stretchOk ? tick : warn}<div class="check-body">` +
        `<strong>Longest run</strong> — ${longestStretch} consecutive working days in a row` +
        (longestStretch > 7 ? `<div class="check-sub">Over 7 days without a rest — worth reviewing.</div>` : '') +
        `</div></div>`
    );

    // Early/late/spare balance.
    rows.push(
        `<div class="check-row check-neutral">` +
        `${info}<div class="check-body">` +
        `<strong>Shift balance</strong> — ${early} early / ${late} late / ${spare} spare` +
        ` across the 27-line rotation` +
        `<span class="check-note"> (${earlyPct}% early, ${latePct}% late)</span>` +
        `</div></div>`
    );

    content.innerHTML = `<div class="check-rows">${rows.join('')}</div>`;
}

// ============================================
// AUTO-GENERATOR
// ============================================

(function initGenerator() {
    const earlySelect = document.getElementById('genEarlyTime');
    const lateSelect  = document.getElementById('genLateTime');
    if (!earlySelect || !lateSelect) return;

    // Populate shift-time dropdowns from real roster data.
    EARLY_SHIFTS.forEach(s => earlySelect.appendChild(new Option(s, s)));
    earlySelect.appendChild(new Option('Custom…', '__custom_early__'));
    LATE_SHIFTS.forEach(s => lateSelect.appendChild(new Option(s, s)));
    lateSelect.appendChild(new Option('Custom…', '__custom_late__'));

    document.getElementById('genApplyBtn')?.addEventListener('click', () => {
        const errEl = document.getElementById('genError');
        if (errEl) errEl.textContent = '';

        let earlyTime = earlySelect.value;
        let lateTime  = lateSelect.value;

        if (earlyTime === '__custom_early__') {
            earlyTime = normaliseCustomShift(
                prompt('Early shift time (e.g. 06:20-14:20, start between 04:00 and 20:59):', '')) ?? '';
            if (!earlyTime) return;
        }
        if (lateTime === '__custom_late__') {
            lateTime = normaliseCustomShift(
                prompt('Late shift time (e.g. 15:15-23:15, start between 04:00 and 20:59):', '')) ?? '';
            if (!lateTime) return;
        }

        const monSat = {
            early: parseInt(document.getElementById('genMonSatEarly')?.value || '0', 10),
            late:  parseInt(document.getElementById('genMonSatLate')?.value  || '0', 10),
            spare: parseInt(document.getElementById('genMonSatSpare')?.value || '0', 10),
        };
        const sunday = {
            early: parseInt(document.getElementById('genSunEarly')?.value || '0', 10),
            late:  parseInt(document.getElementById('genSunLate')?.value  || '0', 10),
            spare: parseInt(document.getElementById('genSunSpare')?.value || '0', 10),
        };

        const generated = generatePatterns({ monSat, sunday, earlyTime, lateTime, lines: 27 });
        if (!generated) {
            if (errEl) {
                const msTotal = monSat.early + monSat.late + monSat.spare;
                const suTotal = sunday.early + sunday.late + sunday.spare;
                errEl.textContent = `Can’t generate: the total (early + late + spare) can’t exceed 27 lines. ` +
                    `Mon–Sat total: ${msTotal}, Sunday total: ${suTotal}.`;
            }
            return;
        }

        if (!confirm('Apply the generated pattern to lines 1–27?\nLine 28 (C. Reen) will not be changed.')) return;

        // Preserve line 28 if a design is already loaded.
        const fixed28 = design?.patterns?.['28'] || {
            sun: 'RD', mon: '12:00-19:00', tue: '12:00-19:00',
            wed: '12:00-19:00', thu: '12:00-19:00', fri: '12:00-19:00', sat: 'RD',
        };
        design = { patterns: { ...generated, '28': fixed28 } };

        dirty = true;
        dearmBrush();
        renderGrid();
        renderBrushBar();
        renderDesignChecks();
        updateSaveBtn();

        const status = document.getElementById('linksSaveStatus');
        if (status) { status.textContent = 'Link generated — review and save when ready.'; status.className = 'links-save-status ok'; }
    });
})();

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

async function saveChanges() {
    const btn    = document.getElementById('linksSaveBtn');
    const status = document.getElementById('linksSaveStatus');
    if (!design) return;
    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.className = 'links-save-status'; }

    try {
        await window._mybSession;

        // Concurrency check: two designers can have this page open simultaneously.
        // setDoc replaces the whole document — re-read and warn if someone else saved
        // since we loaded; otherwise their work would be silently overwritten.
        try {
            const fresh   = await getDoc(DESIGN_REF);
            const freshTs = fresh.exists() ? (fresh.data().updatedAt?.toMillis?.() ?? null) : null;
            if (freshTs !== null && freshTs !== loadedUpdatedAt) {
                const by   = fresh.data().updatedBy || 'Someone';
                const when = fresh.data().updatedAt?.toDate?.()
                    ?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '';
                const overwrite = confirm(
                    `${by} saved a different version${when ? ` at ${when}` : ''} after you opened this page.\n\n` +
                    `Save anyway and replace their changes?`);
                if (!overwrite) {
                    if (btn) btn.disabled = false;
                    if (status) {
                        status.textContent = 'Not saved — refresh the page to see the latest version.';
                        status.className   = 'links-save-status err';
                    }
                    return;
                }
            }
        } catch { /* offline — proceed; the write will report its own error */ }

        await setDoc(DESIGN_REF, {
            patterns:  design.patterns,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser,
        });
        // Capture the new timestamp so the next save's concurrency check compares
        // against OUR write, not the version we first loaded.
        try {
            const after = await getDoc(DESIGN_REF);
            loadedUpdatedAt = after.data()?.updatedAt?.toMillis?.() ?? null;
        } catch { loadedUpdatedAt = null; }

        dirty = false;
        updateSaveBtn();
        if (status) { status.textContent = 'Saved ✓'; status.className = 'links-save-status ok'; }
        updateLastSaved(currentUser, { toDate: () => new Date() });
    } catch (err) {
        console.error('[Links] Save failed:', err);
        dirty = true;
        if (btn) btn.disabled = false;
        if (status) { status.textContent = 'Save failed — try again'; status.className = 'links-save-status err'; }
    }
}

async function loadDesign() {
    loadFailed = false;
    try {
        await window._mybSession;
        const snap = await getDoc(DESIGN_REF);
        if (snap.exists()) {
            const data = snap.data();
            design = { patterns: data.patterns || {} };
            loadedUpdatedAt = data.updatedAt?.toMillis?.() ?? null;
            updateLastSaved(data.updatedBy, data.updatedAt);
        } else {
            design = null;
        }
    } catch (err) {
        console.error('[Links] Load failed:', err);
        design = null;
        loadFailed = true;
    }
    dirty = false;
    renderGrid();
    renderBrushBar();
    renderDesignChecks();
    updateSaveBtn();
}

function initFromRosters() {
    if (loadFailed) {
        // Seeding defaults over a design that merely failed to load would risk
        // wiping a real saved document. Make the user refresh first.
        const saveStatus = document.getElementById('linksSaveStatus');
        if (saveStatus) {
            saveStatus.textContent = 'Can’t initialise — the saved design couldn’t be loaded. Refresh the page and try again.';
            saveStatus.className   = 'links-save-status err';
            const wrapper = document.getElementById('linksGridWrapper');
            if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
    }
    if (!confirm('Initialise from current rosters? This will overwrite any unsaved changes.')) return;
    design = buildDefaultDesign();
    dirty  = true;
    dearmBrush();
    renderGrid();
    renderBrushBar();
    renderDesignChecks();
    updateSaveBtn();
    const saveStatus = document.getElementById('linksSaveStatus');
    if (saveStatus) {
        saveStatus.textContent = 'Design seeded from rosters — save when ready.';
        saveStatus.className   = 'links-save-status ok';
    }
}

function resetFromRosters() {
    if (loadFailed) {
        alert('Can’t reset — the saved design couldn’t be loaded. Refresh the page and try again.');
        return;
    }
    if (!confirm('Reset patterns from current rosters? Lines 1–27 will be overwritten. Line 28 (C. Reen) will not change.')) return;
    const fresh = buildDefaultDesign();
    // Preserve line 28 as loaded.
    if (design?.patterns?.['28']) fresh.patterns['28'] = design.patterns['28'];
    design = fresh;
    dirty  = true;
    dearmBrush();
    renderGrid();
    renderBrushBar();
    renderDesignChecks();
    updateSaveBtn();
    const saveStatus = document.getElementById('linksSaveStatus');
    if (saveStatus) {
        saveStatus.textContent = 'Patterns reset from rosters — save when ready.';
        saveStatus.className   = 'links-save-status ok';
    }
}

// ============================================
// COLLAPSIBLE CARDS
// ============================================
initCardCollapse('linksGridToggleHeader', 'linksGridBody',  'linksGridChevron');
initCardCollapse('coverageToggleHeader',  'coverageBody',   'coverageChevron');
initCardCollapse('checksToggleHeader',    'checksBody',     'checksChevron');
initCardCollapse('generatorToggleHeader', 'generatorBody',  'generatorChevron');

// ============================================
// BUTTON HANDLERS
// ============================================
document.getElementById('linksSaveBtn')?.addEventListener('click', saveChanges);
document.getElementById('linksInitBtnInline')?.addEventListener('click', initFromRosters);
document.getElementById('linksResetBtn')?.addEventListener('click', resetFromRosters);

// Disarm brush on Escape anywhere in the page.
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && brush !== null) dearmBrush();
});

// ============================================
// UNSAVED CHANGES GUARD
// ============================================
window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// beforeunload is suppressed on Android/iOS — nav drawer links need an explicit
// confirm. Capture phase so this runs before nav-panel.js's own click handling.
document.addEventListener('click', e => {
    if (!dirty) return;
    const link = e.target.closest('.nav-panel a[href]');
    if (link && !confirm('You have unsaved changes. Leave this page anyway?')) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

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
            const body = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster Links Version ${CONFIG.APP_VERSION}\nUser: ${currentUser}\nDate: ${date}\nBrowser: ${navigator.userAgent}`;
            bugLink.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — MYB Roster Links Version ${CONFIG.APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
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
        'links-grid': {
            title: 'Link design grid',
            sections: [
                { heading: 'How it works', items: [
                    { icon: '📋', html: 'Each <strong>row</strong> is one of the 28 lines. Each <strong>column</strong> is a day of the week (Sun–Sat).' },
                    { icon: '🔄', html: 'Lines 1–27 are the main rotating link. Line 28 (C. Reen) is the fixed link — shown separately at the bottom.' },
                    { icon: '🖌️', html: '<strong>Paint mode</strong> — arm a shift in the Paint bar above the grid, then click cells to fill them. Click the same chip again (or press Escape) to stop painting.' },
                    { icon: '✏️', html: '<strong>Single-cell edit</strong> — with no brush armed, tap any cell to pick a shift from the dropdown, or choose <strong>Custom time…</strong> to type a new one.' },
                    { icon: '💾', html: 'Tap <strong>Save changes</strong> when done.' },
                ]},
                { heading: 'Row types', items: [
                    { icon: '🔵', html: '<strong>Lines 1–22</strong> — the active rotating pattern (CEA main + bilingual lines)' },
                    { icon: '⬜', html: '<strong>Lines 23–27</strong> — vacant placeholders for future recruits (all rest days by default)' },
                    { icon: '🔒', html: '<strong>Line 28</strong> — C. Reen\'s fixed Mon–Fri 12:00–19:00 link; not editable in the grid' },
                ]},
            ],
        },
        'links-coverage': {
            title: 'Coverage analysis',
            sections: [{ items: [
                { icon: '📊', html: 'Shows how many of the 28 lines are <strong>working</strong> each day' },
                { icon: '🔵', html: '<strong>Early</strong> — shifts starting before 11:00' },
                { icon: '🟠', html: '<strong>Late</strong> — shifts starting at 11:00 or after' },
                { icon: '🟡', html: '<strong>Spare</strong> — standby positions with no fixed time' },
                { icon: '⬜', html: 'Grey portion = rest-day or vacant lines' },
                { icon: '💡', html: 'The dashed line marks 14 — half the link on shift. Updates live as you edit cells.' },
            ]}],
        },
        'links-checks': {
            title: 'Design checks',
            sections: [{ items: [
                { icon: '✅', html: '<strong>Weekends off</strong> — a full weekend = Saturday rest + the following Sunday rest. Aim for at least 40% of weeks.' },
                { icon: '⏱️', html: '<strong>Rest between shifts</strong> — checks every transition across the rotation for less than 12 hours rest. Late-to-early next morning is the classic short turnaround.' },
                { icon: '📅', html: '<strong>Longest run</strong> — how many consecutive working days appear anywhere in the 27-line cycle. Over 7 days is flagged.' },
                { icon: '⚖️', html: '<strong>Shift balance</strong> — how the worked days split between early, late, and spare across the full rotation.' },
                { icon: '🔄', html: 'Checks cover the <em>rotation</em>, not a single week — turnarounds and run lengths wrap across line boundaries.' },
            ]}],
        },
        'links-generator': {
            title: 'Auto-generator',
            sections: [
                { heading: 'What it does', items: [
                    { icon: '⚡', html: 'Builds a fair 27-line rotating pattern from your staffing targets — how many on early, late, and spare each day.' },
                    { icon: '🌅', html: 'The pattern always moves <strong>forward</strong> through the day (late shifts before earlies), so everyone\'s body clock shifts in the easy direction: later, not earlier.' },
                    { icon: '✅', html: 'Your daily targets are met <strong>exactly</strong> by construction — no manual cell editing needed to hit the numbers.' },
                ]},
                { heading: 'How to use it', items: [
                    { icon: '1️⃣', html: 'Enter how many <strong>early, late, and spare</strong> you need each Mon–Sat, and separately for Sundays.' },
                    { icon: '2️⃣', html: 'Pick the <strong>shift times</strong> from the dropdowns — or choose Custom… to type a time.' },
                    { icon: '3️⃣', html: 'Tap <strong>Generate link</strong>. Review the grid and the Design Checks, then save.' },
                    { icon: '⚠️', html: 'The total (early + late + spare) can\'t exceed 27 lines — the rest become rest days.' },
                ]},
            ],
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
    function onKey(e) { if (e.key === 'Escape') closeTips(); }

    document.querySelectorAll('.btn-card-tips').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openTips(btn.dataset.card); });
    });
    if (closeBtn) closeBtn.addEventListener('click', closeTips);
    lb.addEventListener('click', e => { if (e.target === lb) closeTips(); });
})();

// ============================================
// BETA NOTICE LIGHTBOX — shown once on first visit
// ============================================
(function () {
    const BETA_KEY = 'myb_links_beta_seen';
    const lb       = document.getElementById('betaLightbox');
    const content  = document.getElementById('betaLightboxContent');
    const closeBtn = document.getElementById('betaLightboxClose');
    if (!lb) return;

    let _betaFocusReturn = null;
    function open() {
        _betaFocusReturn = document.activeElement;
        lockBodyScroll();
        _pushOverlayState(close);
        lb.classList.add('visible');
        requestAnimationFrame(() => { lb.classList.add('open'); closeBtn?.focus(); });
        document.addEventListener('keydown', onKey);
    }
    function close() {
        lsSet(BETA_KEY, '1');
        dismissOverlay(lb, { onKey, focusReturn: _betaFocusReturn });
        _betaFocusReturn = null;
    }
    function onKey(e) {
        if (e.key === 'Escape') { close(); return; }
        trapFocus(content, e);
    }

    lb.addEventListener('click', close);
    if (content)  content.addEventListener('click', e => e.stopPropagation());
    if (closeBtn) closeBtn.addEventListener('click', close);

    if (!lsGet(BETA_KEY)) open();
})();

// ============================================
registerServiceWorker({
    beforeReload() {
        if (!dirty || confirm('An update is available. Reload to apply it? Unsaved changes will be lost.')) {
            window.location.reload();
        }
    },
});

// ============================================
// BOOT
// ============================================
loadDesign();
