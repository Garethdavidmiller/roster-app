// @ts-check
/**
 * admin-leave-year.js — the Annual Leave card's "which year's allowance" panel (v25.18).
 *
 * Lists the selected member's January leave days that may come out of the PREVIOUS year's allowance,
 * each with the two years to choose between, and both years' figures. The owner's decisions, and why
 * the choice is a per-day record rather than a carried-forward number, are in leave-year.js; which
 * days are listed, and the cap, are `leaveYearChoices` in al-entitlement.js. This module draws that
 * answer and sends a tap to the save it is given — it decides neither.
 *
 * ── A TAP IS THE SAVE ───────────────────────────────────────────────────────────────────────────
 *
 * There is no Save button. A handful of days, each a two-way choice that is put back with the other
 * tap, does not earn a staged form with unsaved-changes guards; the control IS the record, as the
 * drawer's notification bell is. While a day saves, its two buttons are disabled and the line under
 * the panel says so; a refused save says why, and the day redraws as it really is.
 *
 * ── THE CAP IS SHOWN, NOT SURPRISED ─────────────────────────────────────────────────────────────
 *
 * When the earlier year has no days left, its button is disabled on every day still on the later
 * year, and one line says why. A day already moved can always move forward again — that is never
 * refused. The figures are the banner's own (`alPosition`), so the panel and the banner above it
 * cannot disagree about whether a year has room.
 *
 * ── WHO SEES IT ─────────────────────────────────────────────────────────────────────────────────
 *
 * Anyone on the card for themselves, and a manager or the admin for anyone: the same people who may
 * book the leave in the first place (owner, decision 1). Hidden while the switch is off
 * (`leaveYearChoiceEnabled`), while the member's records are unread, and when nothing is listed.
 */

import { leaveYearChoiceEnabled } from './leave-year.js';
import { leaveYearChoices } from './al-entitlement.js';
import { fmtPeriodDate } from './admin-period-dates.js';
import { formatISO } from './roster-data.js';
import { saveFailureMessage } from './claim-retry.js';

/** "3 days left", "1 day left", "2 over" — a remaining figure as a reader says it. @param {number} n */
export function leftWords(n) {
    if (n < 0) return `${-n} over`;
    return `${n} day${n === 1 ? '' : 's'} left`;
}

/**
 * The panel's markup for the model `leaveYearChoices` returns. Pure, so the words and the disabled
 * states are tested without a page. Every value interpolated is a year or a date the model built.
 * @param {ReturnType<typeof leaveYearChoices>} groups
 * @param {{ busyDate?: string|null }} [opts]
 * @returns {string}
 */
export function leaveYearPanelHtml(groups, { busyDate = null } = {}) {
    return groups.map(g => {
        const prevLeft = /** @type {number} */ (g.positions[g.prev].remaining);
        const ownLeft  = /** @type {number} */ (g.positions[g.january].remaining);
        const note = g.prevOpen ? ''
            : `<p class="ly-note">${g.prev} has no days left, so these days stay on ${g.january}’s allowance.</p>`;
        const rows = g.days.map(d => {
            const label = fmtPeriodDate(d.date);
            const busy = d.date === busyDate;
            const opt = (/** @type {number} */ y) => {
                const pressed = d.from === y;
                // The earlier year is closed while it has no room — but never to a day already on it.
                const closed = y === g.prev && !g.prevOpen && !pressed;
                return `<button type="button" class="leaveyear-opt" data-date="${d.date}" data-year="${y}"`
                    + ` aria-pressed="${pressed}"${busy || closed ? ' disabled' : ''}>${y}</button>`;
            };
            return `<div class="ly-row">`
                + `<span class="ly-date">${label}</span>`
                + `<div class="ly-opts" role="group" aria-label="Which year’s allowance ${label} comes out of">`
                + opt(g.prev) + opt(g.january) + `</div></div>`;
        }).join('');
        return `<div class="ly-group" data-january="${g.january}">`
            + `<div class="ly-head">January ${g.january}</div>`
            + `<p class="ly-figures">${g.prev}: ${leftWords(prevLeft)} · ${g.january}: ${leftWords(ownLeft)}</p>`
            + note + rows + `</div>`;
    }).join('');
}

/**
 * Wire the panel. Returns `refresh`, which the page calls wherever the leave banner refreshes —
 * a member switch, a load landing, a save — so the two can never show different moments. The three
 * elements default to admin.html's own; the rest is injected, so this module loads in Node.
 * @param {{
 *   root?: HTMLElement, body?: HTMLElement, feedback?: HTMLElement,
 *   getMember: () => any,
 *   hasAuthority: (name: string) => boolean,
 *   getOverrides: () => any[],
 *   todayStr?: () => string,
 *   save: (args: { memberName: string, date: string, leaveYear: number|null }) => Promise<void>,
 *   onSaved: () => void,
 *   failureMessage?: (err: any) => string,
 * }} given
 * @returns {{ refresh: () => void }}
 */
export function initLeaveYearPanel(given) {
    const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
    const deps = {
        todayStr: () => formatISO(new Date()), failureMessage: saveFailureMessage, ...given,
        root: given.root ?? byId('alLeaveYear'), body: given.body ?? byId('alLeaveYearBody'),
        feedback: given.feedback ?? byId('alLeaveYearFeedback'),
    };
    /** @type {string|null} the day being saved — its two buttons stay disabled until it lands */
    let busyDate = null;
    /** @type {string|null} whose panel is drawn — a member switch clears the last save's line */
    let shownFor = null;

    /** @param {string} text @param {'success'|'error'|''} kind */
    function say(text, kind) {
        deps.feedback.textContent = text;
        deps.feedback.className = `feedback${kind ? ' ' + kind : ''}`;
    }

    function refresh() {
        const member = deps.getMember();
        const name = member?.name ?? null;
        if (name !== shownFor) { shownFor = name; say('', ''); }
        const groups = (leaveYearChoiceEnabled() && member && deps.hasAuthority(member.name))
            ? leaveYearChoices({ overrides: deps.getOverrides(), member, todayStr: deps.todayStr() })
            : [];
        deps.root.hidden = groups.length === 0;
        deps.body.innerHTML = groups.length ? leaveYearPanelHtml(groups, { busyDate }) : '';
    }

    deps.body.addEventListener('click', async (e) => {
        const btn = /** @type {HTMLButtonElement|null} */ (/** @type {Element} */ (e.target).closest('.leaveyear-opt'));
        if (!btn || btn.disabled || btn.getAttribute('aria-pressed') === 'true' || busyDate) return;
        const member = deps.getMember();
        const date = btn.dataset.date || '';
        const year = Number(btn.dataset.year);
        if (!member || !date || !Number.isInteger(year)) return;
        // The earlier year is the one recorded; the day's own year is the default, recorded as nothing.
        const leaveYear = year === Number(date.slice(0, 4)) ? null : year;
        busyDate = date;
        say('Saving…', '');
        refresh();
        try {
            await deps.save({ memberName: member.name, date, leaveYear });
            busyDate = null;
            say(`Saved — ${fmtPeriodDate(date)} now comes out of ${year}’s allowance.`, 'success');
            deps.onSaved();
        } catch (err) {
            busyDate = null;
            console.error('[Admin] Leave-year save failed:', err);
            say(deps.failureMessage(err), 'error');
        }
        refresh();
    });

    return { refresh };
}
