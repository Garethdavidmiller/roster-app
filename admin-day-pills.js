// @ts-check
/**
 * admin-day-pills.js — WHICH CHANGES ONE WEEK-GRID DAY TAKES, refused at its pills.
 *
 * Owns: turning off the pills, and the Other submenu's chips, that a day cannot take — with the
 *   reason in each one's accessible name — for the three kinds of day that refuse something:
 *     · a SUNDAY: leave, absence and a plain shift are refused (layer 1 of the Sunday rule —
 *       CLAUDE.md "Sundays are non-contracted"; the save-side layers are numbered in their own code);
 *     · BOXING DAY: no Other day (owner, Jul 2026), and no Spare turn either, so no Other pill at all;
 *     · CHRISTMAS DAY: no Spare turn (owner, 19 Nov 2026 — "Christmas days and Boxing days cannot be
 *       spare days even if they fall in a usually spare week");
 *     · a day BEFORE THE MEMBER'S START DATE: nothing at all — the Calendar never shows one.
 * Does NOT own: the sentences in the row that say why (they are part of the row's markup, in
 *   `buildWeekGridInto`), what an enabled pill does, or the backstops at Save (`checkDayRules`,
 *   admin-shift-rules.js, and the single-row save in admin-app.js).
 *
 * ── SPARE ON A SUNDAY OR BOXING DAY: THE OTHER PILL OFFERS SPARE ALONE (owner decision, Nov 2026) ──
 *    (except where that day is ALSO Christmas Day or Boxing Day — never a Spare turn, owner 19 Nov
 *    2026 — so Boxing Day, and a Sunday 25 December, have no Other pill at all: the branch above it)
 *
 * Spare lives in the Other submenu (`PILL_TYPES`, admin-shift-types.js) but is its OWN type,
 * `spare_shift` — a standby turn, not an Other day. Neither Sunday rule forbids it
 * (`SUNDAY_FORBIDDEN_TYPES` leaves it out; the single-row save lets a Sunday Spare through) and the
 * Boxing Day backstop refuses only `other`, so the saves already took a Spare on either day. The grid
 * turned the whole Other pill off there, so the one route to a Spare was closed while the saves
 * allowed it. Now the pill stays on, every Other-family chip is off with its reason, and the row is
 * marked `spareOnly`, so picking Other there presses Spare at once (`_activateRow`,
 * admin-week-row-state.js) — one choice is not a decision to ask for. Training, Induction,
 * Assessment, Team Day, Union and Meeting stay refused on both days (confirmed by the owner).
 *
 * ── …EXCEPT ON 25 OR 26 DECEMBER, WHICH CANNOT BE SPARE DAYS (owner, 19 Nov 2026) ───────────────────
 *
 * With Spare refused as well, Boxing Day (and a Sunday Christmas Day) has nothing left under Other, so
 * the pill itself is turned off with the reason. A weekday Christmas Day keeps its Other days and loses
 * the Spare chip alone.
 *
 * ── WHY IT IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────
 *
 * `admin-week-editor.js` was at its ratchet cap with no headroom, and this is a RULE — a pill left on
 * is a change that cannot be saved, or a refused one the manager is never told about — that works
 * from the row element alone, like admin-week-row-state.js. It needs nothing from the editor.
 */

import { TYPES } from './admin-shift-types.js';

/**
 * Turn off what `row`'s day cannot take, and say why on each control turned off.
 * @param {HTMLElement} row a `.day-row` as `buildWeekGridInto` draws it
 * @param {{ sunday: boolean, boxing: boolean, beforeStart: boolean, christmas?: string|null }} day
 *   `christmas` names the day when it is Christmas Day or Boxing Day (`christmasDayName`), else null.
 */
export function restrictDayPills(row, { sunday, boxing, beforeStart, christmas = null }) {
    /** Disabled buttons drop out of the tab order, so the reason goes in the accessible name — and in
     *  a line in the row, for sighted readers (a `title` was a hover surface no phone shows, v23.50).
     *  @param {Element|null} el @param {string} label */
    const off = (el, label) => {
        if (!el) return;
        /** @type {HTMLButtonElement} */ (el).disabled = true;
        el.setAttribute('aria-label', label);
    };
    if (beforeStart) {
        row.querySelectorAll('.type-pill-btn').forEach(p => {
            const t = /** @type {HTMLElement} */ (p).dataset.type ?? '';
            off(p, `${TYPES[t]?.label ?? t} — unavailable before the start date`);
        });
        return;
    }
    // Rule: see CLAUDE.md — "Sundays are non-contracted" (layer 1: disable pills in week grid). Only e2e/admin.spec.js proves them dead.
    if (sunday) {
        off(row.querySelector('.pill-annual_leave'), 'Annual Leave — unavailable on Sundays (not a contracted day)');
        off(row.querySelector('.pill-sick'), 'Absent — unavailable on Sundays (not a contracted day)');
        // A worked Sunday is always Rest Day Working (RDW), never a plain shift — Sundays are
        // uncontracted, so any Sunday work is overtime (the roster upload promotes Sunday shift → rdw
        // for the same reason). A Sunday saved as 'shift' drew an ordinary worked badge and the pay
        // calculator's Sunday-overtime pre-fill missed it, under-counting pay.
        off(row.querySelector('.pill-shift'), 'Shift — unavailable on Sundays; record Sunday work as Rest Day Working (RDW)');
    }
    if ((sunday || boxing) && christmas) {
        // Neither an Other day nor a Spare turn is left, so the pill itself is off.
        off(row.querySelector('.pill-other'), `Other — unavailable on ${christmas}: no Other day or Spare turn`);
    } else if (christmas) {
        off(row.querySelector('.other-flavour-btn[data-flavour="SPARE"]'), `Spare — unavailable on ${christmas}`);
    } else if (sunday || boxing) {
        const where = sunday ? 'on Sundays' : 'on Boxing Day';
        row.dataset.spareOnly = '1';
        row.querySelector('.pill-other')?.setAttribute('aria-label', `Other — only Spare ${where}`);
        row.querySelectorAll('.other-flavour-btn:not([data-flavour="SPARE"])').forEach(b =>
            off(b, `${(b.textContent ?? '').trim()} — unavailable ${where}`));
    }
}
