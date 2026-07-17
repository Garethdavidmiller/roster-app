// @ts-check
/**
 * date-picker.js — brand-styled single-date picker for Operations date fields.
 *
 * WHY: the Operations upload cards used bare `<input type="date">` controls, whose
 * internal glyph/popup are drawn by the browser and can't be themed — the one
 * off-brand spot in an app that custom-styles every other field. This replaces each
 * with a styled trigger button that opens a modal month calendar (the same visual
 * language as admin's range picker), built on the canonical `createLightbox` so it
 * inherits focus-trap / Escape / Android-Back / scroll-lock.
 *
 * DESIGN — progressive enhancement, NOT a rewrite of the fields:
 *   The native `<input type="date">` stays in the DOM (hidden) as the value holder.
 *   Every consumer keeps working unchanged — doc-upload.js reads `.value` and sets
 *   `.max`, the roster card's `change` listener snaps a non-Saturday forward, the
 *   default-to-today logic runs at card init. The picker only SETS `input.value` and
 *   dispatches `input`+`change`; a per-input `change` listener then re-reads the
 *   (possibly consumer-normalised, e.g. Saturday-snapped) value to render the trigger
 *   label — so normalisation flows through for free and the label never lies.
 *
 * Modal (not inline): an always-open calendar per card would bulk up the Operations
 * stack — the compact "one line, opens on tap" affordance is why a native input was
 * ever defensible here, so the replacement keeps it.
 *
 * DOM access is confined to functions (module import is side-effect-free) so the pure
 * `monthCells` helper is unit-testable in Node — see date-picker.test.mjs.
 */

import { DAY_NAMES, MONTH_ABB, MONTH_NAMES, formatISO, parseISODate } from './roster-data.js';
import { createLightbox } from './overlay.js';

/**
 * Pure: the day cells of a month as a flat, Monday-first grid. Leading blanks
 * (before day 1) are `null`; each real day is its ISO `YYYY-MM-DD` string. No DOM,
 * no clamping — the caller styles out-of-range days.
 * @param {number} year  Full year, e.g. 2026
 * @param {number} month 0-based month (0 = January)
 * @returns {(string|null)[]}
 */
export function monthCells(year, month) {
    const startOff    = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = /** @type {(string|null)[]} */ ([]);
    for (let i = 0; i < startOff; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return cells;
}

/**
 * Compact display label for a chosen date, e.g. "Fri 17 Jul 2026".
 * @param {string} iso YYYY-MM-DD
 * @returns {string}
 */
function formatLabel(iso) {
    const d = parseISODate(iso);
    return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTH_ABB[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Enhance a set of `<input type="date">` elements into brand-styled trigger buttons
 * backed by one shared modal calendar. Safe to call once, after the owning cards have
 * set their default values (so the initial trigger label is correct). Missing ids are
 * skipped silently.
 * @param {string[]} inputIds ids of the date inputs to enhance
 */
export function initDatePickers(inputIds) {
    if (!Array.isArray(inputIds) || !inputIds.length) return;
    if (typeof document === 'undefined') return;

    // ── One shared overlay for every field ──────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay dp-overlay';
    overlay.id = 'datePickerLightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Choose a date');
    overlay.innerHTML = `
        <div class="lb-content dp-content">
            <button class="lb-close dp-close" type="button" aria-label="Close">✕</button>
            <div class="dp-title" id="dpTitle">Choose a date</div>
            <div class="dp-nav">
                <button class="dp-nav-btn" id="dpPrev" type="button" aria-label="Previous month">‹</button>
                <span class="dp-month" id="dpMonth" aria-live="polite"></span>
                <button class="dp-nav-btn" id="dpNext" type="button" aria-label="Next month">›</button>
            </div>
            <div class="dp-grid" id="dpGrid" role="grid"></div>
        </div>`;
    document.body.appendChild(overlay);

    const content  = /** @type {HTMLElement} */ (overlay.querySelector('.dp-content'));
    const closeBtn = /** @type {HTMLElement} */ (overlay.querySelector('.dp-close'));
    const titleEl  = /** @type {HTMLElement} */ (overlay.querySelector('#dpTitle'));
    const monthEl  = /** @type {HTMLElement} */ (overlay.querySelector('#dpMonth'));
    const gridEl   = /** @type {HTMLElement} */ (overlay.querySelector('#dpGrid'));

    // ── Per-open state ───────────────────────────────────────────────────────────
    /** @type {HTMLInputElement|null} */ let _input = null;
    /** The input a trigger click is opening for — read by onOpen (open() takes no args). */
    /** @type {HTMLInputElement|null} */ let _pendingInput = null;
    let _yr = new Date().getFullYear();
    let _mo = new Date().getMonth();
    let _min = '';   // ISO lower bound (inclusive) or '' for none
    let _max = '';   // ISO upper bound (inclusive) or '' for none

    /** @param {string} iso @returns {boolean} */
    function _outOfBounds(iso) {
        return (!!_min && iso < _min) || (!!_max && iso > _max);
    }

    function _render() {
        monthEl.textContent = `${MONTH_NAMES[_mo]} ${_yr}`;
        const selISO   = _input && _input.value ? _input.value : '';
        const todayISO = formatISO(new Date());
        let html = '';
        for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) html += `<div class="dp-dow" aria-hidden="true">${d}</div>`;
        for (const iso of monthCells(_yr, _mo)) {
            if (!iso) { html += '<div class="dp-filler"></div>'; continue; }
            const dd    = parseISODate(iso);
            const day   = dd.getDate();
            const off   = _outOfBounds(iso);
            const sel   = iso === selISO;
            const today = iso === todayISO;
            const cls = ['dp-day'];
            if (sel)   cls.push('dp-sel');
            if (today) cls.push('dp-today');
            if (off)   cls.push('dp-off');
            let aria = `${DAY_NAMES[dd.getDay()]} ${day} ${MONTH_NAMES[_mo]} ${_yr}`;
            if (sel)   aria += ', selected';
            if (today) aria += ', today';
            html += `<button type="button" class="${cls.join(' ')}" data-iso="${iso}"`
                 + ` role="gridcell" aria-label="${aria}" aria-pressed="${sel}"`
                 + (off ? ' aria-disabled="true"' : '') + `>${day}</button>`;
        }
        gridEl.innerHTML = html;
    }

    /** @param {number} delta */
    function _moveMonth(delta) {
        _mo += delta;
        if (_mo > 11) { _mo = 0; _yr++; }
        if (_mo < 0)  { _mo = 11; _yr--; }
        _render();
    }

    /** @param {string} iso */
    function _select(iso) {
        if (!_input || _outOfBounds(iso)) return;
        _input.value = iso;
        // input THEN change: doc-upload's "touched" guard listens to both; the roster card's
        // Saturday-snap listens to change and may REWRITE the value — the per-input change
        // listener below re-reads the final value into the trigger, so the snap shows through.
        _input.dispatchEvent(new Event('input',  { bubbles: true }));
        _input.dispatchEvent(new Event('change', { bubbles: true }));
        lb.close();
    }

    gridEl.addEventListener('click', e => {
        const cell = /** @type {Element} */ (e.target).closest('.dp-day');
        if (!cell || cell.classList.contains('dp-off')) return;
        _select(/** @type {HTMLElement} */ (cell).dataset.iso || '');
    });
    /** @type {HTMLElement} */ (overlay.querySelector('#dpPrev')).addEventListener('click', () => _moveMonth(-1));
    /** @type {HTMLElement} */ (overlay.querySelector('#dpNext')).addEventListener('click', () => _moveMonth(+1));

    const lb = createLightbox({
        overlay, content, closeBtn,
        // Configure the calendar for the triggering input BEFORE the overlay is shown
        // (createLightbox runs onOpen with open()'s args, ahead of the .visible/focus step).
        onOpen: () => {
            const input = _pendingInput;
            if (!input) return;
            _input = input;
            _min = input.min || '';
            _max = input.max || '';
            const cur = input.value ? parseISODate(input.value) : new Date();
            _yr = cur.getFullYear();
            _mo = cur.getMonth();
            titleEl.textContent = input.getAttribute('aria-label') || 'Choose a date';
            _render();
        },
        // Focus the selected day if visible, else today, else the first day, else close.
        initialFocus: () => /** @type {HTMLElement} */ (
            gridEl.querySelector('.dp-sel') || gridEl.querySelector('.dp-today')
            || gridEl.querySelector('.dp-day:not(.dp-off)') || closeBtn),
    });

    // ── Enhance each input ───────────────────────────────────────────────────────
    for (const id of inputIds) {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
        if (!el) continue;
        const input = el;   // narrowed non-null for the closures below

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'date-trigger';
        const label = input.getAttribute('aria-label') || 'Date';

        /** Reflect the input's CURRENT value into the trigger (post any consumer normalisation). */
        const _sync = () => {
            const v = input.value;
            trigger.textContent = v ? formatLabel(v) : 'Choose date';
            trigger.classList.toggle('date-trigger--empty', !v);
            trigger.setAttribute('aria-label', `${label}: ${v ? formatLabel(v) : 'no date chosen'}. Change.`);
        };

        input.style.display = 'none';
        input.insertAdjacentElement('afterend', trigger);
        _sync();

        trigger.addEventListener('click', () => { _pendingInput = input; lb.open(); });
        // Any value change — the user's pick OR a consumer's normalisation — refreshes the label.
        // Registered AFTER the cards' own listeners (this runs post-init), so it reads the
        // final, snapped value.
        input.addEventListener('change', _sync);
    }
}
