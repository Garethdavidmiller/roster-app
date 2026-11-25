// @ts-check
/**
 * calendar-keyboard.js — Keyboard navigation and hover tooltip for index.html.
 *
 * Owns: arrow-key cell navigation (roving tabindex), PageUp/Down month jump,
 *   Enter/Space cell activation, desktop hover tooltip, and the page's keyboard shortcuts
 *   (`initCalendarShortcuts`: ← → for a month or a week, T for today, P to print).
 * Does NOT own: month navigation state (calendar-state.js), swipe cooldown (calendar-swipe.js), or
 *   what a month change DOES — every key that moves the month presses the page's own control
 *   (`#prevMonth`, `#nextMonth`, `goToToday`), so a key and a press cannot drift apart.
 * Edit here for: keyboard shortcut behaviour, tooltip positioning.
 */

import { isSwipeCooldown } from './calendar-swipe.js';
import { paydayForCutoff } from './roster-data.js';

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

  // A MOUSE'S PREVIEW, NEVER A FINGER'S (17 Nov 2026). The query above describes the device's PRIMARY
  // pointer, and a touchscreen laptop or a tablet with a trackpad reports the trackpad — so a finger on
  // the screen fires the compatibility mouseover that follows every tap, and the tip stuck where the
  // finger had been, back over the grid once the day panel closed. Pointer events name the input that
  // moved, so the tip answers only to a mouse (or trackpad); a touch or a pen takes it down.
  let _byMouse = true;
  const notePointer = (/** @type {PointerEvent} */ e) => {
    _byMouse = e.pointerType === 'mouse';
    if (!_byMouse) tip.hidden = true;
  };
  for (const type of ['pointerover', 'pointermove', 'pointerdown']) document.addEventListener(type, /** @type {any} */ (notePointer), true);

  let _tipW = 0, _tipH = 0;
  document.addEventListener('mouseover', e => {
    if (!_byMouse) { tip.hidden = true; return; }
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
    if (!_byMouse) { tip.hidden = true; return; }
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
 * @param {{ navigateToPaycalc: (paydayStr: string) => boolean, openDayDetail: ((cell: HTMLElement) => void)|null }} deps
 *   `navigateToPaycalc` RETURNS whether it went — this module acts on the answer (see the Enter
 *   case), so the boolean is part of the contract and not an incidental return value.
 */
export function initCalendarKeyboard({ navigateToPaycalc, openDayDetail }) {
  document.addEventListener('keydown', e => {
    const focused = /** @type {HTMLElement|null} */ (document.activeElement);
    if (!focused?.classList.contains('calendar-day') || focused.classList.contains('other-month')) return;

    const cells = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.calendar-day:not(.other-month)')]);
    const idx   = cells.indexOf(focused);
    if (idx === -1) return;
    // THE STORED COPY IS READ, NOT USED (whole-app review, Oct 2026). Since v24.59 the member's own
    // stored roster can be painted in the lock slot before access is decided, with real day cells — so
    // PageUp/Down clicked the hidden month buttons and rendered a month behind the lock card, and Enter
    // opened a day panel, all before the grant. Arrows still move between its cells, so a screen-reader
    // user can read it; what ACTS works only in the live workspace.
    const live = !!focused.closest('#calendarDisplay');

    let next;
    switch (e.key) {
      case 'ArrowRight': next = cells[idx + 1]; break;
      case 'ArrowLeft':  next = cells[idx - 1]; break;
      case 'ArrowDown':  next = cells[idx + 7]; break;
      case 'ArrowUp':    next = cells[idx - 7]; break;
      case 'PageDown':
        if (!live) return;
        e.preventDefault();
        // renderCalendar() (run synchronously by the nav button's click handler) preserves keyboard
        // focus itself now — it restores the roving anchor whenever a day cell was focused at wipe
        // time, covering both this sync change AND the async override-fetch re-render on far paging.
        document.getElementById('nextMonth')?.click();
        return;
      case 'PageUp':
        if (!live) return;
        e.preventDefault();
        document.getElementById('prevMonth')?.click();
        return;
      case 'Enter':
      case ' ':
        if (!live) return;
        e.preventDefault();
        // A REFUSED jump falls through to the day panel rather than swallowing the key (v23.07).
        // `navigateToPaycalc` now answers whether it went, because the calculator is personal and
        // it declines on a colleague's calendar. Returning here on a
        // refusal would make Enter a dead key on exactly those days — worse than the jump it
        // replaced, and only for keyboard users, who have no hover tooltip to fall back on.
        if (focused.dataset.paydayIso && navigateToPaycalc(focused.dataset.paydayIso)) return;
        if (focused.dataset.cutoffIso) {
          const payday = paydayForCutoff(focused.dataset.cutoffIso);
          if (payday && navigateToPaycalc(payday)) return;
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

/**
 * The page's keyboard shortcuts, outside the grid (moved from calendar-app.js, 25 Nov 2026):
 * ← → change the month (the week, in Team View), T goes to today, P prints.
 *
 * MONTH NAVIGATION IS WRITTEN ONCE. ← → press `#prevMonth` / `#nextMonth`, as PageUp/PageDown above
 * already did, so the button's own guards — the swipe cooldown, the first-run prompt and the
 * year-boundary no-op (`aria-disabled`, set at the boundary during render) — are the key's too. The
 * key used to restate the button's body and its boundary check beside it (v16.21: at Dec MAX_YEAR /
 * Jan MIN_YEAR it re-rendered and announced the identical clamped month). T is `goToToday`, the
 * Today button's own action.
 *
 * Registered BEFORE `initCalendarKeyboard`'s listener (calendar-app.js wires this in its init block,
 * that at the module tail), as it always was: a key another handler has already taken
 * (`defaultPrevented`, a grade tab's arrows) is left alone here.
 *
 * @param {{
 *   getAccessType: () => string,
 *   isTeamViewMode: () => boolean,
 *   isFirstRun: () => boolean,
 *   jumpToCurrentWeek: () => void,
 *   goToToday: () => void,
 *   print: () => void,
 * }} deps
 */
export function initCalendarShortcuts({ getAccessType, isTeamViewMode, isFirstRun, jumpToCurrentWeek, goToToday, print }) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;   // taken already (a grade tab's arrows), or a browser chord (Ctrl+P, Alt+←)
    // Re-locked (access lost mid-session): the grid is behind the card, and an arrow here moved
    // and PERSISTED the month there, so the member signed back in to a different one (Oct 2026).
    if (getAccessType() === 'none') return;
    // Don't fire if user is typing in an input
    if (/** @type {Element} */ (e.target).tagName === 'SELECT' || /** @type {Element} */ (e.target).tagName === 'INPUT') return;
    // Don't fire behind ANY open overlay — focus sits on a button there,
    // so the input check above doesn't help: arrows/t would silently
    // change the month behind the overlay (and PERSIST the drift via
    // persistViewedMonth) and p would print it. The huddle viewer and the
    // nav drawer are NOT .lb-overlay lightboxes, so they need their own
    // checks (v16.69 review fix — the month drifted behind the Huddle).
    if (document.querySelector('.lb-overlay.visible')) return;
    if (document.getElementById('huddleViewer')?.classList.contains('visible')) return;
    if (document.querySelector('.nav-panel.open')) return;
    if (isSwipeCooldown()) return; // Don't interrupt a swipe animation
    if (isTeamViewMode()) {
      // The week table is a tab stop on a narrow screen so that a keyboard can SCROLL it
      // (axe scrollable-region-focusable, v25.43) — and ← → are how it scrolls. Turned into
      // week changes, they re-rendered the grid and the off-screen days stayed out of reach.
      if (/** @type {Element} */ (e.target).closest?.('#gradeTabPanel')) return;
      if (e.key === 'ArrowLeft')  document.getElementById('tvPrevWeek')?.click();
      if (e.key === 'ArrowRight') document.getElementById('tvNextWeek')?.click();
      if (e.key === 't' || e.key === 'T') jumpToCurrentWeek();
      return;
    }
    // Below Team View, which draws a first run itself (no "my row"), so its keys work there.
    if (isFirstRun()) return;      // don't drift the hidden month behind the first-run prompt (v16.21)
    // Guard: when a calendar day cell has focus, arrow keys move between cells
    // (handled by initCalendarKeyboard). Only navigate months when no cell is focused.
    const onCell = !!document.activeElement?.classList.contains('calendar-day');
    if (e.key === 'ArrowLeft'  && !onCell) document.getElementById('prevMonth')?.click();
    if (e.key === 'ArrowRight' && !onCell) document.getElementById('nextMonth')?.click();
    if (e.key === 't' || e.key === 'T') goToToday();
    // Any open overlay (lightbox / huddle viewer / nav drawer) already returned above, so
    // print is unguarded here.
    if (e.key === 'p' || e.key === 'P') print();
  });
}
