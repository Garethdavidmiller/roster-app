// @ts-check
/**
 * calendar-month-jump.js — the Calendar's month/year jump picker (`#monthJumpOverlay`), opened from
 * the month heading (left calendar-app.js on 25 Nov 2026).
 *
 * Owns: filling the two selects once, opening the picker from the heading (click, Enter, Space),
 *   Go to month and Cancel, and closing it when Calendar access is lost.
 * Does NOT own: the displayed month (calendar-state.js), drawing it (`renderCalendar`, handed in),
 *   announcing it (`announceMonthChange`, handed in), or whether the Calendar is open
 *   (`getAccessType`, handed in; calendar-access.js decides).
 * Edit here for: the picker's behaviour. Its markup is in index.html.
 */

import { CONFIG, MONTH_NAMES } from './roster-data.js';
import { createLightbox } from './overlay.js';
import { onCalendarAccess } from './calendar-access-state.js';
import { getDisplayMonth, getDisplayYear, setDisplayMonth, setDisplayYear } from './calendar-state.js';

/**
 * Wire the picker. A page without `#monthJumpOverlay` gets nothing, and returns null.
 * @param {{ renderCalendar: () => void, announceMonthChange: () => void, getAccessType: () => string }} deps
 * @returns {{ open: () => void, close: () => void }|null} the picker, for a test; the page keeps nothing
 */
export function initMonthJump({ renderCalendar, announceMonthChange, getAccessType }) {
    const overlay    = document.getElementById('monthJumpOverlay');
    const card       = document.getElementById('monthJumpCard');
    const selMonth   = /** @type {HTMLSelectElement} */ (document.getElementById('monthJumpMonth'));
    const selYear    = /** @type {HTMLSelectElement} */ (document.getElementById('monthJumpYear'));
    const btnConfirm = document.getElementById('monthJumpConfirm');
    const btnCancel  = document.getElementById('monthJumpCancel');
    if (!overlay) return null;

    // Populate year select once (CONFIG.MIN_YEAR..MAX_YEAR)
    for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR; y++) {
        const opt = document.createElement('option');
        opt.value = String(y); opt.textContent = String(y);
        selYear.appendChild(opt);
    }
    // Populate month select once
    MONTH_NAMES.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = String(i); opt.textContent = name;
        selMonth.appendChild(opt);
    });

    // Shared canonical lifecycle — adds the focus restore this picker
    // never had (closing used to drop keyboard focus to <body>).
    // No .lb-close button here: Cancel is the close control.
    const picker = createLightbox({
        overlay,
        content: card || undefined,
        initialFocus: () => selMonth || undefined,
        onOpen() {
            selMonth.value = String(getDisplayMonth());
            selYear.value  = String(getDisplayYear());
        },
    });

    // Delegated click: any .month-year element (rebuilt on each render)
    (/** @type {HTMLElement} */ (document.getElementById('calendarDisplay'))).addEventListener('click', e => {
        if (/** @type {Element} */ (e.target).closest('.month-year')) picker.open();
    });
    (/** @type {HTMLElement} */ (document.getElementById('calendarDisplay'))).addEventListener('keydown', e => {
        if (/** @type {Element} */ (e.target).closest('.month-year') && (/** @type {KeyboardEvent} */ (e).key === 'Enter' || /** @type {KeyboardEvent} */ (e).key === ' ')) {
            e.preventDefault(); picker.open();
        }
    });

    // A LOST GRANT TAKES THE PICKER WITH IT (17 Nov 2026), as it takes the leave and day panels:
    // left open over the lock card, "Go to month" moved and PERSISTED the month behind it, so the
    // member signed back in to a month they had not chosen — the keyboard already refuses
    // (calendar-keyboard.js → `initCalendarShortcuts`), and Go to month refuses below as well.
    onCalendarAccess(({ open }) => { if (!open) picker.close(); });
    btnConfirm?.addEventListener('click', () => {
        if (getAccessType() === 'none') { picker.close(); return; }
        setDisplayMonth(parseInt(selMonth.value, 10));
        setDisplayYear(parseInt(selYear.value, 10));
        picker.close();
        renderCalendar();
        announceMonthChange();
        // renderCalendar() rebuilt the heading the focus restore pointed
        // at — move focus onto the freshly rendered equivalent.
        /** @type {HTMLElement} */ (document.querySelector('.month-year'))?.focus();
    });

    btnCancel?.addEventListener('click', () => picker.close());
    return picker;
}
