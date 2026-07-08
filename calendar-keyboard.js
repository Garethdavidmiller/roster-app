// @ts-check
/**
 * calendar-keyboard.js — Keyboard navigation and hover tooltip for index.html.
 *
 * Owns: arrow-key cell navigation (roving tabindex), PageUp/Down month jump,
 *   Enter/Space cell activation, desktop hover tooltip.
 * Does NOT own: month navigation state (calendar-state.js), swipe cooldown (calendar-swipe.js).
 * Edit here for: keyboard shortcut behaviour, tooltip positioning.
 */

import { isSwipeCooldown } from './calendar-swipe.js';
import { getPaydaysAndCutoffs, formatISO } from './roster-data.js';

/**
 * Initialise the desktop hover tooltip. No-op on touch/pointer-coarse devices.
 * Creates a single floating #calTooltip div and repositions it on mousemove.
 * Reads data-tooltip set per cell by buildCalendarContainer().
 */
export function initCalendarTooltip() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const tip = document.createElement('div');
  tip.id = 'calTooltip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  let _tipW = 0, _tipH = 0;
  document.addEventListener('mouseover', e => {
    const cell = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.calendar-day[data-tooltip]'));
    if (!cell) { tip.hidden = true; return; }
    tip.textContent = cell.dataset.tooltip ?? '';
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    _tipW = r.width;
    _tipH = r.height;
  });

  document.addEventListener('mousemove', e => {
    // Re-resolve the cell under the pointer on every move (not only on mouseover). A month change
    // (keyboard PageUp/Down, Enter, a swipe) re-renders the grid under a stationary cursor, swapping
    // the cell's DOM node without firing mouseover — so without re-reading here the tip kept showing
    // the PREVIOUS month's text until the cursor next crossed a cell boundary (v16.22).
    const cell = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.calendar-day[data-tooltip]'));
    if (!cell) { tip.hidden = true; return; }
    const text = cell.dataset.tooltip ?? '';
    if (tip.hidden || tip.textContent !== text) {
      tip.textContent = text;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      _tipW = r.width; _tipH = r.height;
    }
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth  - _tipW - 8) + 'px';
    tip.style.top  = Math.min(e.clientY + 16, window.innerHeight - _tipH - 8) + 'px';
  });
}

/**
 * Initialise keyboard navigation for calendar day cells (roving tabindex).
 * Arrow keys move focus between cells; PageUp/Down change months; Enter/Space activate.
 *
 * @param {{ navigateToPaycalc: (paydayStr: string) => void, openDayDetail: ((cell: HTMLElement) => void)|null }} deps
 */
export function initCalendarKeyboard({ navigateToPaycalc, openDayDetail }) {
  document.addEventListener('keydown', e => {
    const focused = /** @type {HTMLElement|null} */ (document.activeElement);
    if (!focused?.classList.contains('calendar-day') || focused.classList.contains('other-month')) return;

    const cells = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.calendar-day:not(.other-month)')]);
    const idx   = cells.indexOf(focused);
    if (idx === -1) return;

    let next;
    switch (e.key) {
      case 'ArrowRight': next = cells[idx + 1]; break;
      case 'ArrowLeft':  next = cells[idx - 1]; break;
      case 'ArrowDown':  next = cells[idx + 7]; break;
      case 'ArrowUp':    next = cells[idx - 7]; break;
      case 'PageDown':
        e.preventDefault();
        document.getElementById('nextMonth')?.click();
        return;
      case 'PageUp':
        e.preventDefault();
        document.getElementById('prevMonth')?.click();
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focused.dataset.paydayIso) { navigateToPaycalc(focused.dataset.paydayIso); return; }
        if (focused.dataset.cutoffIso) {
          const cutoffIso  = focused.dataset.cutoffIso;
          const cutoffYear = Number(cutoffIso.slice(0, 4));
          const { paydays, cutoffs } = getPaydaysAndCutoffs(cutoffYear);
          const i = cutoffs.findIndex(/** @param {any} c */ c => formatISO(c) === cutoffIso);
          if (i !== -1) navigateToPaycalc(formatISO(paydays[i]));
          return;
        }
        openDayDetail?.(/** @type {HTMLElement} */ (focused));
        return;
      default: return;
    }

    if (!next) return;
    e.preventDefault();
    if (isSwipeCooldown()) return;
    focused.setAttribute('tabindex', '-1');
    next.setAttribute('tabindex', '0');
    next.focus();
  });
}
