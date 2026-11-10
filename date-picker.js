// @ts-check
/**
 * date-picker.js — brand-styled single-date picker for the Operations date fields, Admin's week jump
 * and Team View's week jump. Its CSS (`.dp-*`, `.date-trigger`) is in shared.css because three pages
 * use it: a shared component's rules on one page's stylesheet silently do not apply on the others.
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
 * Pure: the day cells of a month as a flat grid, Monday-first by default. Leading blanks
 * (before day 1) are `null`; each real day is its ISO `YYYY-MM-DD` string. No DOM,
 * no clamping — the caller styles out-of-range days.
 *
 * `weekStart` is the first column's `getDay()` value: 1 (Monday, the default — every date field)
 * or 0 (Sunday — Admin's week jump, whose week runs Sunday–Saturday; see `openDatePicker`'s `week`).
 * @param {number} year  Full year, e.g. 2026
 * @param {number} month 0-based month (0 = January)
 * @param {number} [weekStart] 1 = Monday-first (default), 0 = Sunday-first
 * @returns {(string|null)[]}
 */
export function monthCells(year, month, weekStart = 1) {
    const startOff    = (new Date(year, month, 1).getDay() - weekStart + 7) % 7; // first column = 0
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

/** The one overlay every field on a page shares. Built on first use, never at import.
 *  @type {{ open: (input: HTMLInputElement, title?: string, week?: boolean) => void }|null} */
let _picker = null;

/**
 * Open the shared calendar for `input`, building it on first call.
 *
 * Exported (v23.38) so a page that ALREADY has its own trigger can use this calendar instead of
 * the OS one. `initDatePickers` is the case where the module supplies the trigger too; Admin's
 * week-jump is the case where it does not — the control there is the week label, which reads
 * "8–14 Sep 2026" rather than a date, so only the page can write it.
 *
 * `title` is passed rather than read off the input, because a caller that supplies its own
 * trigger has moved the `aria-label` there — onto the thing a screen reader actually reaches —
 * and the input it leaves behind is `aria-hidden`. Reading a dialog's heading out of an
 * attribute on a hidden element would work and would be a lie about where the label lives.
 * `initDatePickers` still passes the input's own label, so its four fields are unchanged.
 *
 * `week: true` (polish round 2) makes it a WEEK picker for a caller whose week runs Sunday–Saturday
 * — Admin's and Team View's "Jump to a week": Sunday is the first column, the week holding the chosen day is
 * banded, and hovering or focusing a day bands ITS week, so the grid answers the question the
 * control asks ("which week?") rather than "which day?". Picking still sets a single day; the page
 * already reads the week that contains it. Off by default, so every date field keeps its Monday-
 * first single-day grid — and the AL/Absence range picker is a different module altogether
 * (`admin-rangepicker.js`) and is not touched by this.
 * @param {HTMLInputElement|null} input
 * @param {{ title?: string, week?: boolean }} [opts]
 */
export function openDatePicker(input, opts = {}) {
    // A DISABLED field is not changed, whoever asks — the roster read locks its week this way, and the
    // field is hidden behind a trigger the lock cannot reach on its own (`initDatePickers` mirrors it).
    if (!input || input.disabled) return;
    const picker = _ensurePicker();
    if (!picker) return;
    // Ask the consumer to refresh `min`/`max` FIRST — `onOpen` reads them off the input, so
    // whatever they say at this instant is what the grid will enforce (v23.37). doc-upload.js
    // recomputes its cap at init and on submit, which was the whole v16.23 stale-tab fix, and was
    // written before this picker existed: an Operations tab left open past midnight then had a
    // `max` of yesterday, so the real today rendered `dp-off` and the admin could not pick it at
    // all. Synchronous and BEFORE the open, so a consumer that re-defaults the value emits its own
    // `date-refreshed` and the trigger label is right before we open.
    //
    // It lives HERE rather than in `initDatePickers`'s click handler (where v23.37 put it, when
    // this was the only way in) so that EVERY caller gets it — otherwise Admin's week jump, which
    // supplies its own trigger, would have inherited the stale-`max` bug the same release fixed for
    // Operations. A field with no cap, as Admin's is, simply has no listener and the event is a
    // no-op; that is the point of announcing rather than asking.
    input.dispatchEvent(new CustomEvent('date-picker-opening'));
    picker.open(input, opts.title || '', opts.week === true);
}

/** Pure: the ISO date of the Sunday that starts `iso`'s Sunday–Saturday week.
 *  @param {string} iso YYYY-MM-DD @returns {string} */
function _sundayOf(iso) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() - d.getDay());
    return formatISO(d);
}

/** @returns {{ open: (input: HTMLInputElement, title?: string, week?: boolean) => void }|null} */
function _ensurePicker() {
    if (_picker) return _picker;
    if (typeof document === 'undefined') return null;

    // ── One shared overlay for every field ──────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay dp-overlay';
    overlay.id = 'datePickerLightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    // Labelled by the live #dpTitle (set per-open to the field's own name), so the dialog
    // announces which date it's for; the static text is the pre-open fallback.
    overlay.setAttribute('aria-labelledby', 'dpTitle');
    overlay.innerHTML = `
        <div class="lb-content dp-content">
            <button class="lb-close dp-close" type="button" aria-label="Close">✕</button>
            <div class="dp-title" id="dpTitle">Choose a date</div>
            <div class="dp-nav">
                <button class="dp-nav-btn" id="dpPrev" type="button" aria-label="Previous month">‹</button>
                <span class="dp-month" id="dpMonth" aria-live="polite"></span>
                <button class="dp-nav-btn" id="dpNext" type="button" aria-label="Next month">›</button>
            </div>
            <div class="dp-grid" id="dpGrid"></div>
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
    /** The heading for that open, when the caller supplied one. */
    let _pendingTitle = '';
    /** Week mode for the pending open, and for the open in progress (see openDatePicker). */
    let _pendingWeek = false;
    let _week = false;
    let _yr = new Date().getFullYear();
    let _mo = new Date().getMonth();
    let _min = '';   // ISO lower bound (inclusive) or '' for none
    let _max = '';   // ISO upper bound (inclusive) or '' for none
    let _focusIso = '';   // the day holding the grid's one Tab stop, once the arrow keys have moved it

    /** @param {string} iso @returns {boolean} */
    function _outOfBounds(iso) {
        return (!!_min && iso < _min) || (!!_max && iso > _max);
    }

    function _render() {
        monthEl.textContent = `${MONTH_NAMES[_mo]} ${_yr}`;
        const selISO   = _input && _input.value ? _input.value : '';
        const todayISO = formatISO(new Date());
        const selWeek  = _week && selISO ? _sundayOf(selISO) : '';
        const lastDay  = new Date(_yr, _mo + 1, 0).getDate();
        gridEl.classList.toggle('dp-week', _week);
        let html = '';
        const dows = _week ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
        for (const d of dows) html += `<div class="dp-dow" aria-hidden="true">${d}</div>`;
        // ONE TAB STOP FOR THE WHOLE MONTH (desktop audit, Nov 2026) — a roving tabindex, as the
        // Calendar's own grid: every day was its own stop, so crossing the picker took up to 31 Tab
        // presses and the arrow keys did nothing. The stop is the day the arrows last reached, else the
        // chosen day, else today, else the first day that can be picked — the day `initialFocus` opens on.
        const cells = monthCells(_yr, _mo, _week ? 0 : 1);
        const live  = (/** @type {string|null} */ iso) => !!iso && !_outOfBounds(iso);
        const stop  = [_focusIso, selISO, todayISO].find(i => live(i) && cells.includes(i)) ?? cells.find(live);
        for (const iso of cells) {
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
            // Week mode: every cell knows its week, so a band can be drawn across a grid ROW. The
            // band's ends round where the week starts or stops being drawn — its Sunday/Saturday,
            // or the month's first/last day when the week runs into the next month.
            const wk = _week ? _sundayOf(iso) : '';
            if (_week) {
                if (wk === selWeek) cls.push('dp-inweek');
                if (dd.getDay() === 0 || day === 1)       cls.push('dp-wk-first');
                if (dd.getDay() === 6 || day === lastDay) cls.push('dp-wk-last');
            }
            let aria = `${DAY_NAMES[dd.getDay()]} ${day} ${MONTH_NAMES[_mo]} ${_yr}`;
            if (sel)   aria += ', selected';
            if (today) aria += ', today';
            // Plain accessible buttons (not role=gridcell — an ARIA grid needs row owners we don't
            // have; the admin range picker likewise uses buttons). Full date in aria-label.
            html += `<button type="button" class="${cls.join(' ')}" data-iso="${iso}"${wk ? ` data-week="${wk}"` : ''}`
                 + ` aria-label="${aria}" aria-pressed="${sel}"`
                 // Out-of-bounds days are marked disabled; no day but the one stop is in the Tab order.
                 + (off ? ' aria-disabled="true"' : '') + (iso === stop ? '' : ' tabindex="-1"') + `>${day}</button>`;
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
        const input = _input;
        input.value = iso;
        // CLOSE FIRST, THEN ANNOUNCE — both inside the tap. The close retires the open dialog's focus
        // guard and hands focus back to the control that opened it, so a consumer that moves focus in
        // its `change` handler keeps it: Team View focuses its rebuilt week label, Admin its
        // unsaved-changes banner. Announced while the picker was still open, the guard pulled that
        // focus back into the closing picker, and it fell to <body> when the picker hid.
        lb.close();
        // input THEN change: doc-upload's "touched" guard listens to both; the roster card's
        // Saturday-snap listens to change and may REWRITE the value — the per-input change
        // listener below re-reads the final value into the trigger, so the snap shows through.
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** Week mode: band the week the pointer or focus is on. '' clears it. @param {string} wk */
    function _hoverWeek(wk) {
        gridEl.querySelectorAll('.dp-day').forEach(c =>
            c.classList.toggle('dp-hoverweek', !!wk && /** @type {HTMLElement} */ (c).dataset.week === wk));
    }
    /** @param {Event} e */
    const _onEnter = e => {
        if (!_week) return;
        const cell = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.dp-day'));
        _hoverWeek(cell && !cell.classList.contains('dp-off') ? (cell.dataset.week || '') : '');
    };
    gridEl.addEventListener('pointerover', _onEnter);
    gridEl.addEventListener('focusin', _onEnter);
    gridEl.addEventListener('pointerleave', () => { if (_week) _hoverWeek(''); });
    gridEl.addEventListener('focusout', () => { if (_week) _hoverWeek(''); });

    gridEl.addEventListener('click', e => {
        const cell = /** @type {Element} */ (e.target).closest('.dp-day');
        if (!cell || cell.classList.contains('dp-off')) return;
        _select(/** @type {HTMLElement} */ (cell).dataset.iso || '');
    });
    /** Arrows move a day or a week, Home/End to the row's ends, Page Up/Down a month; crossing a month's
     *  edge turns the page. A day that cannot be picked is never landed on — the key does nothing. */
    const STEP = /** @type {Record<string, number>} */ ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 });
    gridEl.addEventListener('keydown', e => {
        const from = /** @type {HTMLElement} */ (e.target).dataset?.iso;
        if (!from || !(e.key in STEP || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))) return;
        e.preventDefault();
        const d = parseISODate(from);
        const col = (d.getDay() - (_week ? 0 : 1) + 7) % 7;   // its column: week mode is Sunday-first
        if (e.key in STEP) d.setDate(d.getDate() + STEP[e.key]);
        else if (e.key === 'Home' || e.key === 'End') d.setDate(d.getDate() + (e.key === 'Home' ? -col : 6 - col));
        else {   // the same day a month away — or that month's last, when it is shorter
            const delta = e.key === 'PageUp' ? -1 : 1;
            d.setDate(Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + delta + 1, 0).getDate()));
            d.setMonth(d.getMonth() + delta);
        }
        const to = formatISO(d);
        if (_outOfBounds(to)) return;
        _focusIso = to; _yr = d.getFullYear(); _mo = d.getMonth();
        _render();
        /** @type {HTMLElement|null} */ (gridEl.querySelector(`[data-iso="${to}"]`))?.focus();
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
            _week = _pendingWeek;
            _min = input.min || '';
            _max = input.max || '';
            _focusIso = '';   // each open starts on the chosen day, not where the arrows last left off
            const cur = input.value ? parseISODate(input.value) : new Date();
            _yr = cur.getFullYear();
            _mo = cur.getMonth();
            titleEl.textContent = _pendingTitle || input.getAttribute('aria-label') || 'Choose a date';
            _render();
        },
        // Focus the grid's one Tab stop — the selected day if visible, else today, else the first day
        // that can be picked (`_render` places it) — else close.
        initialFocus: () => /** @type {HTMLElement} */ (
            gridEl.querySelector('.dp-day:not([tabindex="-1"])') || closeBtn),
    });

    _picker = {
        open: (/** @type {HTMLInputElement} */ input, /** @type {string} */ title = '', week = false) => {
            _pendingInput = input; _pendingTitle = title; _pendingWeek = week; lb.open();
        },
    };
    return _picker;
}

/**
 * Progressively enhance each `<input type="date">` named in `inputIds`: hide it as the value
 * holder and put a styled trigger in its place. See the module header for the contract. Call once,
 * after the owning cards have set their default values, so the first trigger label is right;
 * missing ids are skipped silently.
 * @param {string[]} inputIds
 */
export function initDatePickers(inputIds) {
    if (!Array.isArray(inputIds) || !inputIds.length) return;
    if (!_ensurePicker()) return;

    for (const id of inputIds) {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
        if (!el) continue;
        const input = el;   // narrowed non-null for the closures below

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'date-trigger';
        const label = input.getAttribute('aria-label') || 'Date';

        /** Reflect the input's CURRENT value — and whether it may be changed — into the trigger. */
        const _sync = () => {
            const v = input.value;
            trigger.textContent = v ? formatLabel(v) : 'Choose date';
            trigger.classList.toggle('date-trigger--empty', !v);
            trigger.setAttribute('aria-label', `${label}: ${v ? formatLabel(v) : 'no date chosen'}. Change.`);
            trigger.disabled = input.disabled;
        };

        input.style.display = 'none';
        input.insertAdjacentElement('afterend', trigger);
        _sync();

        trigger.addEventListener('click', () => openDatePicker(input));
        // Any value change — the user's pick OR a consumer's normalisation — refreshes the label.
        // Registered AFTER the cards' own listeners (this runs post-init), so it reads the
        // final, snapped value.
        input.addEventListener('change', _sync);
        // doc-upload.js fires this when it re-defaults an untouched date programmatically (which
        // emits no 'change') — resync so the trigger label can't go stale (v17.41).
        input.addEventListener('date-refreshed', _sync);
        // A form that locks the field — the roster read disables its week until the read is over —
        // fires no event either, and the field is hidden, so the trigger is what the lock must reach.
        // An observer, as select-sheet.js keeps its trigger in step with a disabled select.
        if (typeof MutationObserver === 'function') {
            new MutationObserver(_sync).observe(input, { attributes: true, attributeFilter: ['disabled'] });
        }
    }
}
