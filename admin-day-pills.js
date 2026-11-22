// @ts-check
/**
 * admin-day-pills.js — WHICH CHANGES ONE WEEK-GRID DAY TAKES, refused at its pills.
 *
 * Owns: turning off the pills, and the Other submenu's chips, that a day cannot take — with the
 *   reason in each one's accessible name — for the three kinds of day that refuse something:
 *     · a SUNDAY: leave, absence and a plain shift are refused (layer 1 of the Sunday rule —
 *       CLAUDE.md "Sundays are non-contracted"; the save-side layers are numbered in their own code);
 *     · CHRISTMAS DAY AND BOXING DAY: no Other day (owner: Boxing Day, Jul 2026; Christmas Day, 21 Nov
 *       2026 — "There cannot be training or meeting on December 25th or 26th") and no Spare turn
 *       (owner, 19 Nov 2026), so no Other pill at all;
 *     · a day BEFORE THE MEMBER'S START DATE: nothing at all — the Calendar never shows one.
 *   A record SAVED before a day refused its type keeps its own pill usable for one act, removing it
 *   (`_onToRemove`, admin-week-row-state.js, after these rules run): never for a new choice.
 * Does NOT own: the sentences in the row that say why (they are part of the row's markup, in
 *   `buildWeekGridInto`), what an enabled pill does, or the backstops at Save (`checkDayRules`,
 *   admin-shift-rules.js, and the single-row save in admin-app.js).
 *
 * ── SPARE ON A SUNDAY: THE OTHER PILL OFFERS SPARE ALONE (owner decision, Nov 2026) ──────────────
 *    (except where the Sunday is ALSO Christmas Day or Boxing Day — never a Spare turn, owner 19 Nov
 *    2026 — so it has no Other pill at all: the branch above it)
 *
 * Spare lives in the Other submenu (`PILL_TYPES`, admin-shift-types.js) but is its OWN type,
 * `spare_shift` — a standby turn, not an Other day. Neither Sunday rule forbids it
 * (`SUNDAY_FORBIDDEN_TYPES` leaves it out; the single-row save lets a Sunday Spare through), so the
 * save already took a Spare there. The grid turned the whole Other pill off, so the one route to a
 * Spare was closed while the save allowed it. Now the pill stays on, every Other-family chip is off
 * with its reason, and the row is marked `spareOnly`, so picking Other there presses Spare at once
 * (`_activateRow`, admin-week-row-state.js) — one choice is not a decision to ask for. Training,
 * Induction, Assessment, Team Day, Union and Meeting stay refused (confirmed by the owner). Boxing Day
 * was the rule's other day until it lost Spare too (19 Nov 2026), and Christmas Day its Other days
 * (21 Nov 2026).
 *
 * ── 25 AND 26 DECEMBER, ANY WEEKDAY: NO OTHER PILL (owner, 19 and 21 Nov 2026) ─────────────────────
 *
 * Neither day can be a Spare day (19 Nov 2026) or an Other day (21 Nov 2026: "There cannot be training
 * or meeting on December 25th or 26th"), so nothing is left under Other on either, weekday or Sunday,
 * and the pill itself is turned off with the reason. (Until 21 Nov 2026 a weekday Christmas Day kept
 * its Other days and lost the Spare chip alone.) The day is named by `christmas`, which the caller
 * passes as `christmasDayName` for every row, so the Sunday branch below never sees either day.
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
 * @param {{ sunday: boolean, beforeStart: boolean, christmas?: string|null }} day
 *   `christmas` names the day when it is Christmas Day or Boxing Day (`christmasDayName`), else null.
 */
export function restrictDayPills(row, { sunday, beforeStart, christmas = null }) {
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
    if (christmas) {
        // Neither an Other day nor a Spare turn is left, so the pill itself is off — and every chip behind
        // it, because the pill can be ON again for one act, removing a record saved before (review,
        // 20 Nov 2026: `_onToRemove`, admin-week-row-state.js), and its strip must offer nothing new.
        off(row.querySelector('.pill-other'), `Other — unavailable on ${christmas}: no Other day or Spare turn`);
        row.querySelectorAll('.other-flavour-btn').forEach(b =>
            off(b, `${(b.textContent ?? '').trim()} — unavailable on ${christmas}`));
    } else if (sunday) {
        const where = 'on Sundays';
        row.dataset.spareOnly = '1';
        row.querySelector('.pill-other')?.setAttribute('aria-label', `Other — only Spare ${where}`);
        row.querySelectorAll('.other-flavour-btn:not([data-flavour="SPARE"])').forEach(b =>
            off(b, `${(b.textContent ?? '').trim()} — unavailable ${where}`));
    }
}
