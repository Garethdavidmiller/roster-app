// @ts-check
/**
 * admin-week-editor.js — the seven-day grid, its pills, and everything staged but not yet saved.
 *
 * ── WHY IT LEFT THE COORDINATOR (v21.38) ────────────────────────────────────────────────────────
 *
 * The largest of the surfaces `admin-overrides.js` owned, and the one the review named first: the
 * week grid, the per-row type pills, the bulk bar, and the Save button's read of what is staged.
 * All of it is one job — decide what a week SHOULD say — and it ends where `executeSave` begins.
 *
 * ── STAGED IS NOT SAVED, AND THE DIFFERENCE IS LOAD-BEARING ─────────────────────────────────────
 *
 * `hasStagedEdits` is the reason a background refresh does not repaint over an admin mid-edit, and
 * it counts BOTH directions: a row given a type that is not an unchanged prefill (a staged change)
 * and a prefilled row with its type taken away (a staged REMOVAL). Counting only the first is a
 * defect that has shipped here before — the refresh discarded staged removals while `userMadeChanges` stayed true,
 * which blocked the week swipe and left a phantom unsaved-changes warning behind.
 *
 * ── AN UNREAD MEMBER IS NOT A MEMBER WITH NO CHANGES ────────────────────────────────────────────
 *
 * The load is staged per member, so this grid can be asked to draw somebody whose overrides have
 * never been fetched. Painting seven base-roster days would be indistinguishable from a genuinely
 * clear week. It draws a loading state instead — and a distinct FAILED state, because saying
 * "Loading…" over a load that has stopped is the same false claim in the patient direction.
 *
 * Permissions, feedback and the dirty-state marker arrive through `initWeekEditor`, which is what
 * keeps this out of a cycle with the coordinator that wires it.
 */

import { teamMembers, getBaseShift, getShiftBadge, getSpecialDayBadges, formatISO, isSunday,
         DAY_NAMES, MONTH_ABB, escapeHtml, parseISODate, isWorkedShift } from './roster-data.js';
import { swapDecisionDates } from './al-swapped-days.js';
import { isRestShift, isForbiddenOnSunday, isBeforeMemberStart, OTHER_FLAVOURS } from './override-utils.js';
import { isWorkingDate } from './al-entitlement.js';
import { formatDisplay } from './admin-period-dates.js';
import { isChristmasLeaveDay, resolveDayShift } from './christmas-leave.js';
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { bulkApplyWaitingFor, bulkSkippedLine } from './admin-bulk-apply.js';
import { isBoxingDay, weekStepAllowed } from './admin-shift-rules.js';
import { hasOverrideAuthorityFor, loadFailedFor, loadOverrides } from './admin-override-store.js';
// The row's own appearance rules — moved out at v23.98 when this file hit its ratchet cap with no
// headroom. Same names, so every call site below is unchanged; see that module's header for why
// this cluster was the seam and the bulk bar was not.
import { _syncOtherRdwWarn, _syncOtherSpareMode, _activateRow, _syncOverwriteBadge, _deactivateRow, isStagedRow, prefillRow,
         rosteredWords } from './admin-week-row-state.js';
export { rosteredWords };   // its home is the row's own words now; exported here as it always was
// The grid's time boxes — typed formatting and the HH:MM check — moved out at v24.64, for the same
// reason as the line above, and now share clock-input.js's rule rather than restating it.
import { initTimeInputs } from './admin-time-inputs.js';
import { setStatus } from './status-text.js';

// ── INJECTED ──────────────────────────────────────────────────────────────────
let _canPickMember = false;   // admin or manager: the member field is theirs to change
/** @type {(msg: string, lines?: string[], o?: { toast?: boolean }) => void} */   let _showSuccess  = () => {};
/** @type {() => void} */              let _markChanged  = () => {};
/** @type {(m: string) => Map<string, any>} */ let buildMemberDateMap = () => new Map();

/** Delegated listeners are attached once per page life — see the note inside initWeekEditor. */
let _wired = false;


/**
 * @param {object} deps
 * @param {boolean} deps.canPickMember  admin or manager
 * @param {(msg: string, lines?: string[], o?: { toast?: boolean }) => void} deps.showSuccess
 * @param {() => void} deps.markChanged
 * @param {(m: string) => Map<string, any>} deps.memberDateMap
 * @returns {void}
 */
export function initWeekEditor(deps) {
    _canPickMember    = deps.canPickMember;
    _showSuccess      = deps.showSuccess;
    _markChanged      = deps.markChanged;
    buildMemberDateMap = deps.memberDateMap;
    // DEPS ABOVE EVERY TIME; WIRING ONCE (v21.94).
    //
    // `initOverrides` can be called twice on the in-place login path — an optimistic 'allow' init,
    // then again after B1 clears an unconfirmable session — and both of these attach DELEGATED
    // listeners, `initTimeInputs` (admin-time-inputs.js) two of them at `document` level. A second attach double-fires
    // every click, which on the two-tap Delete means one tap both arms AND executes.
    //
    // The guard used to live in `admin-overrides.js`, around wiring that moved out in the v21.38
    // split; what was left there was an `if` with an EMPTY body and a comment still describing the
    // hazard as handled. It belongs where the listeners are. Identity/permissions are re-assigned
    // on every call, which is what keeps a re-init meaningful.
    if (_wired) return;
    _wired = true;
    _initBulkBar();
    initTimeInputs();
}

/** True when the week grid currently holds STAGED (unsaved) work — mirrors updateSaveBtn's
 *  save/delete counts so it catches BOTH a staged addition/change (a row with a chosen type that
 *  isn't an unchanged prefill) AND a staged REMOVAL (a prefilled row whose type was taken away →
 *  existingId, no type). Used to avoid re-rendering the week grid over the admin's in-progress edits — by
 *  loadOverrides AND by the page's own writes, which then redraw only the days they touched (admin-own-write.js;
 *  v16.82: deleting an unrelated saved change must not silently discard staged pills; the old active-pill-only
 *  check also missed staged removals). Exported for admin-app's unsaved-changes guard. The row test is
 *  `isStagedRow` (admin-week-row-state.js), which a kept draft reads its rows with too. */
export function _hasStagedEdits() {
    const weekGrid = document.getElementById('weekGrid');
    if (!weekGrid) return false;
    return [...weekGrid.querySelectorAll('.day-row')].some(r => isStagedRow(/** @type {HTMLElement} */ (r)));
}

/**
 * Return every row in the week grid to its unstaged state.
 *
 * Called after a successful save. It lives here because the row lifecycle does — `executeSave` used
 * to reach into `_deactivateRow` directly, which is the coordinator knowing how a row is built.
 * @returns {void}
 */
export function resetStagedRows() {
    document.getElementById('weekGrid')?.querySelectorAll('.day-row').forEach(rowEl => {
        const row      = /** @type {HTMLElement} */ (rowEl);
        const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
        const pills    = row.querySelectorAll('.type-pill-btn');
        const s        = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
        const e        = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
        if (checkbox) _deactivateRow(row, checkbox, pills, s, e);
    });
}

/** Returns a new Date set to the Sunday of the week containing dateStr. */
/** @param {string} dateStr */
function getSundayOfWeek(dateStr) {
    const d = parseISODate(dateStr);
    d.setDate(d.getDate() - d.getDay());
    return d;
}

/** The type currently armed on the bulk bar. */
let _bulkActiveType = '';

/**
 * Updates the week nav label to show the Sun–Sat range containing dateStr,
 * and highlights it when it is the current week.
 * @param {string} dateStr  YYYY-MM-DD
 */
export function updateWeekNavLabel(dateStr) {
    if (!dateStr) return;
    const sunday   = getSundayOfWeek(dateStr);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const label = document.getElementById('weekNavLabel');
    if (label) {
        // Same-month ranges collapse to "19–25 Jul 2026" (v18.90). The full form repeats the month
        // for no information, and at the documented 375px width it overflowed the nav pill — it
        // ellipsised to "19 Jul – 25 Jul 2026 …", dropping the 📅 tap affordance with it.
        // formatTeamWeekLabel (calendar-team-view.js) has always collapsed; admin was the outlier.
        // The CROSS-month form uses the same tight en-dash as the same-month one (v18.91). The
        // spaced " – " cost ~6px, and at 375px that was the difference between fitting and
        // ellipsising: v18.89 reclaimed 14px from this row (gap replaced padding) without
        // re-measuring, which pushed SIX cross-month weeks over the line. v18.90 then collapsed
        // only the same-month form, so today's week looked fixed while those six still clipped —
        // and what gets cut is the trailing 📅, the date-picker's only affordance.
        label.textContent = sunday.getMonth() === saturday.getMonth()
            ? `${sunday.getDate()}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`
            : `${sunday.getDate()} ${MONTH_ABB[sunday.getMonth()]}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`;
        // The NAME leads with the week it shows (v25.27, WCAG 2.5.3 Label in Name): somebody driving
        // the page by voice says "1–7 Nov 2026", and a fixed "Jump to week containing date" never
        // contained it. Written here, beside the text, so the two cannot describe different weeks.
        label.setAttribute('aria-label', `${label.textContent} — jump to week containing date`);
        const todaySun = new Date();
        todaySun.setDate(todaySun.getDate() - todaySun.getDay());
        label.classList.toggle('is-current-week', sunday.toDateString() === todaySun.toDateString());
    }
    // NO ARROW INTO A WEEK OUTSIDE THE CONFIGURED YEARS (whole-app check, Nov 2026) — `weekStepAllowed`.
    for (const [id, n] of /** @type {Array<[string, number]>} */ ([['prevWeekBtn', -7], ['nextWeekBtn', 7]])) { const b = /** @type {HTMLButtonElement|null} */ (document.getElementById(id)); if (b) b.disabled = !weekStepAllowed(dateStr, n); }
}

/**
 * Builds a 7-day week grid into container for the week containing dateStr.
 * Reads fieldMember.value and _allOverrides; has no side-effects on other state.
 * Used by renderWeekGrid and by the swipe carousel (adjacent panel pre-build).
 * @param {HTMLElement} container
 * @param {string}      dateStr  YYYY-MM-DD
 */
export function buildWeekGridInto(container, dateStr) {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const memberName  = fieldMember?.value;
    const member      = teamMembers.find(m => m.name === memberName);
    if (!member || !memberName || !dateStr) return;

    const sunday = getSundayOfWeek(dateStr);

    const header = document.createElement('div');
    header.className = 'week-grid-header';
    header.innerHTML = `
        <div class="hdr-check"></div>
        <div class="hdr-day">Day</div>
        <div class="hdr-base">Base roster</div>`;
    container.appendChild(header);

    // Compute once for the whole 7-row loop instead of allocating a Date per row.
    const todayISO      = formatISO(new Date());
    // buildMemberDateMap applies shouldReplaceOverride() so manual beats roster_import
    // (bare .find() would return whichever arrived first in the array — wrong precedence).
    const memberDateMap = buildMemberDateMap(memberName);
    /** Icon → meaning, for the legend below the grid; a Map, so a repeat lists once.
     *  @type {Map<string, string>} */
    const weekBadges = new Map();

    for (let i = 0; i < 7; i++) {
        const date    = new Date(sunday);
        date.setDate(sunday.getDate() + i);
        const dateISO = formatISO(date);
        const baseShift = getBaseShift(member, date);

        const badges    = getSpecialDayBadges(date, dateISO);
        badges.forEach(b => weekBadges.set(b.icon, b.title));
        const badgeHTML = badges.map(b => `<span class="day-badge" role="img" aria-label="${b.title}">${b.icon}</span>`).join('');

        const existing = memberDateMap.get(dateISO);
        // TWO DAYS THAT TAKE NO CHANGE, refused at the pills as a Sunday is, with the reason in the row
        // (admin-shift-rules.js → checkDayRules, the backstop at Save): before the member's start date,
        // which the Calendar never shows, and an Other day on Boxing Day (owner, Jul 2026).
        const beforeStart = isBeforeMemberStart(member, date), boxing = isBoxingDay(dateISO) && !isSunday(dateISO);
        // CHRISTMAS LEAVE (v25.37) — said in the row, as the Sunday reason is, because the Base roster
        // column shows the rest day `getBaseShift` makes both Christmas days for everybody. A member due
        // at work is on leave that is never counted, unless work is recorded on the day; a Boxing Day
        // worked by somebody due to work it adds a day in lieu (christmas-leave.js has the rules).
        // Asked of the SAME resolver the Calendar draws with, so the note can never describe a day the
        // Calendar shows differently — a correction there is rest, and says nothing here.
        const xmasDue   = isChristmasLeaveDay(member, date);
        const xmasShows = xmasDue ? resolveDayShift(existing ?? null, baseShift, isSunday(dateISO), true).shift : '';
        const christmasNote = !xmasDue ? ''
            : xmasShows === 'AL'
                ? `${date.getDate() === 25 ? 'Christmas Day' : 'Boxing Day'}: due at work, so on annual leave that is never counted — nothing to record`
            : date.getDate() === 26 && isWorkedShift(xmasShows)
                ? 'Boxing Day worked when due at work: one day of annual leave in lieu is added to the allowance'
            : '';

        const row = document.createElement('div');
        const isToday = dateISO === todayISO;
        // The overwrite badge is drawn empty: `prefillRow` below writes its words before the row is painted.
        // Unique id linking each row's time inputs to their inline error message
        // (aria-describedby / aria-errormessage need a per-row target id).
        const timeErrId = `timeErr-${dateISO}`;
        row.className   = 'day-row' + (existing ? ' has-override' : '') + (isToday ? ' today' : '');
        row.dataset.date = dateISO;
        row.dataset.baseIsRd = isRestShift(baseShift) ? '1' : '';
        row.dataset.alSwapAsk = swapDecisionDates({ dates: [dateISO], memberObj: member, ovByDate: memberDateMap }).length ? '1' : '';
        if (existing) row.dataset.existingId = existing.id;

        row.innerHTML = `
            <div class="col-check">
                <input type="checkbox" class="day-cb" id="day-cb-${dateISO}" aria-label="${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_ABB[date.getMonth()]}">
            </div>
            <label class="col-day" for="day-cb-${dateISO}">
                <span class="day-name">${DAY_NAMES[date.getDay()]}</span>
                <span class="day-date">${date.getDate()} ${MONTH_ABB[date.getMonth()]}${isToday ? '<span class="day-today-tag">Today</span>' : ''}${badgeHTML}${existing ? ' <span class="overwrite-badge"></span>' : ''}</span>
            </label>
            <div class="col-base">${getShiftBadge(baseShift, { showTime: true })}</div>
            <div class="col-pills">
                ${PILL_TYPES.map(t => `<button class="type-pill-btn pill-${t}" data-type="${t}" aria-pressed="false">${TYPES[t].pill}</button>`).join('\n                ')}
                ${isSunday(dateISO) ? `<span class="sunday-note">Sunday isn’t a contracted day — work is recorded as RDW; leave, absence and Other days can’t be recorded</span>` : ''}
                ${christmasNote ? `<span class="christmas-note">${escapeHtml(christmasNote)}</span>` : ''}
                ${beforeStart ? `<span class="start-note">Before the start date (${formatDisplay(formatISO(/** @type {Date} */ (member.startDate)))}) — the Calendar doesn’t show changes here, so none can be recorded</span>`
                    : boxing ? '<span class="christmas-note">Boxing Day can’t be an Other day — training, meetings and the rest</span>' : ''}
            </div>
            <div class="col-time">
                <input type="text" class="time-input day-start" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" aria-label="Start time (HH:MM)" aria-describedby="${timeErrId}">
                <span class="time-sep">–</span>
                <input type="text" class="time-input day-end" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" aria-label="End time (HH:MM)" aria-describedby="${timeErrId}">
                <span class="time-note">No time needed</span>
                <span class="time-hint">24h · max 12 hrs</span>
                <span class="time-error-msg" id="${timeErrId}" role="alert">Use HH:MM format (e.g. 07:00)</span>
            </div>
            <div class="col-rd-hint" hidden>Base roster: Rest Day — use <strong>RDW</strong> if this was overtime</div>
            <!-- Swapped-day question (v23.75): no pre-pressed state, save refuses until answered.
                 Why it is asked: al-swapped-days.js. -->
            <div class="col-al-swap" role="group" aria-label="Is this a swapped working day?" hidden>
                <span class="al-swap-q">Rest day on the roster — was this a <strong>swapped</strong> working day?</span>
                <span class="al-swap-opts"><button type="button" class="al-swap-btn" data-swap="yes" aria-pressed="false">Swapped — counts</button><button type="button" class="al-swap-btn" data-swap="no" aria-pressed="false">Rest day — free</button></span>
            </div>
            <div class="other-opts" hidden>
                <span class="other-flavour-group" role="group" aria-label="Type of day">
                    ${Object.entries(OTHER_FLAVOURS).map(([k, f]) =>
                        `<button type="button" class="other-flavour-btn" data-flavour="${k}" aria-pressed="false">${f.full}</button>`
                    ).join('\n                    ')}
                    <button type="button" class="other-flavour-btn other-flavour-spare" data-flavour="SPARE" aria-pressed="false"><span aria-hidden="true">📋</span> Spare</button>
                </span>
                <label class="other-rdw-label"><input type="checkbox" class="other-rdw-cb"${isRestShift(baseShift) ? ' checked disabled' : ''}> Rest day (RDW)</label>
                ${isRestShift(baseShift) ? `<span class="other-rdw-auto">Ticked and locked because the base roster has this as a rest day — RDW is automatic</span>` : ''}
                <span class="other-rdw-warn" hidden>Originally rostered ${escapeHtml(rosteredWords(baseShift))} this day — RDW pays it as rest-day working instead</span>
                <span class="other-opts-hint">Pick a type above, then times (optional — blank pays the default: base shift, or 8h RDW).</span>
            </div>`;

        container.appendChild(row);

        // Rule: see CLAUDE.md — "Sundays are non-contracted" (layer 1: disable pills in week grid). Only e2e/admin.spec.js proves them dead.
        if (isSunday(dateISO)) {
            const alPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-annual_leave'));
            if (alPill) {
                alPill.disabled = true;
                // Disabled buttons drop out of the tab order — put the reason in the accessible
                // name so a screen reader reading the row in browse mode hears why the pill is
                // unavailable. Sighted readers get the same reason as a LINE IN THE ROW (the
                // `.sunday-note` below, v23.50): it used to be a `title`, which is a hover surface
                // no phone shows, so on the device every manager uses the pills simply went grey.
                alPill.setAttribute('aria-label', 'Annual Leave — unavailable on Sundays (not a contracted day)');
            }
            const sickPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-sick'));
            if (sickPill) {
                sickPill.disabled = true;
                sickPill.setAttribute('aria-label', 'Absent — unavailable on Sundays (not a contracted day)');
            }
            const otherPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-other'));
            if (otherPill) {
                otherPill.disabled = true;
                otherPill.setAttribute('aria-label', 'Other — unavailable on Sundays (not a contracted day)');
            }
            // A worked Sunday is always Rest Day Working (RDW), never a plain shift — Sundays are
            // uncontracted, so any Sunday work is overtime. Disable the Shift pill and point staff at
            // RDW (the roster-upload path promotes Sunday shift→rdw for the same reason). Without this,
            // a Sunday saved as 'shift' rendered as an ordinary worked badge and the pay calculator's
            // Sunday-overtime pre-fill missed it, under-counting pay.
            const shiftPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-shift'));
            if (shiftPill) {
                shiftPill.disabled = true;
                shiftPill.setAttribute('aria-label', 'Shift — unavailable on Sundays; record Sunday work as Rest Day Working (RDW)');
            }
        }
        if (beforeStart || boxing) row.querySelectorAll('.type-pill-btn').forEach(p => {
            const t = /** @type {HTMLElement} */ (p).dataset.type ?? '';
            if (!beforeStart && t !== 'other') return;
            /** @type {HTMLButtonElement} */ (p).disabled = true;
            p.setAttribute('aria-label', `${TYPES[t]?.label ?? t} — unavailable ${beforeStart ? 'before the start date' : 'on Boxing Day'}`);
        });

        const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
        const pills    = row.querySelectorAll('.type-pill-btn');
        const startEl  = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
        const endEl    = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));

        // Pre-fill with existing override — mark as prefilled so Save button stays disabled until user edits
        if (existing) prefillRow(row, existing);

        pills.forEach(pillEl => {
            const pill = /** @type {HTMLButtonElement} */ (pillEl);
            pill.addEventListener('click', () => {
                const type    = pill.dataset.type ?? '';
                const already = pill.classList.contains('active');
                row.classList.remove('prefilled-existing');
                if (already) {
                    _deactivateRow(row, checkbox, pills, startEl, endEl);
                    // Time inputs return to tabindex=-1 on deactivate; keep focus on the
                    // (still-focusable) pill so keyboard users aren't stranded.
                    pill.focus();
                } else {
                    _activateRow(row, checkbox, pills, startEl, endEl, type);
                    // Pre-fill times from the base roster shift when choosing Shift or RDW,
                    // but only if the user hasn't already entered something.
                    if (!TYPES[type]?.fixed && !/** @type {HTMLInputElement} */ (startEl).value && !/** @type {HTMLInputElement} */ (endEl).value) {
                        if ((type === 'shift' || type === 'rdw') && baseShift && baseShift.includes('-')) {
                            const [prefillS, prefillE] = baseShift.split('-');
                            /** @type {HTMLInputElement} */ (startEl).value = prefillS;
                            /** @type {HTMLInputElement} */ (endEl).value   = prefillE;
                        }
                    }
                    // timesOptional types (Other): DON'T auto-focus the time input — on a phone the
                    // keyboard would pop over the just-revealed flavour/RDW sub-controls, for times
                    // that are optional and usually unknown. (This is timesOptional's behavioural job.)
                    if (!TYPES[type]?.fixed && !TYPES[type]?.timesOptional) /** @type {HTMLInputElement} */ (startEl).focus();
                }
                // Show RD hint when Shift is chosen on a base-rest day
                const rdHint = /** @type {HTMLElement|null} */ (row.querySelector('.col-rd-hint'));
                if (rdHint) rdHint.hidden = !(type === 'shift' && row.dataset.baseIsRd === '1' && !already);
                // AL on a base rest day is asked about (v23.75) — shown and reset by _activateRow /
                // _deactivateRow now, so bulk apply and the checkbox follow the same rule (review A6).
                _markChanged();
                updateSaveBtn();
            });
        });

        if (checkbox) {
            checkbox.addEventListener('change', () => {
                if (/** @type {HTMLInputElement} */ (checkbox).checked) {
                    if (!row.dataset.type) row.classList.add('selected');
                    // Ticking stages nothing (the collector keys off dataset.type), so it is not a
                    // change — the v16.23 rule for the bulk tick buttons, missed here (review A17).
                } else {
                    // UNTICKING NEVER DELETES A SAVED CHANGE (owner, 10 Nov 2026): a day with a saved
                    // record goes back to it, unticked; any other day is cleared. Removing a saved change
                    // is its type selected again, or ✕ in Saved Changes.
                    const hadStaged = isStagedRow(row);
                    if (existing) prefillRow(row, existing); else _deactivateRow(row, checkbox, pills, startEl, endEl);
                    if (hadStaged) _markChanged();
                }
                updateSaveBtn();   // …which recounts the bulk bar too
            });
        }

        // 'input' is needed alongside 'change' because the auto-format handler in
        // initTimeInputs() (admin-time-inputs.js) programmatically sets element.value on each keystroke.
        // On Safari/WebKit this resets the browser's change-detection baseline, so
        // 'change' never fires when focus leaves (current value == last programmatic value).
        const onTimeEdit = () => { row.classList.remove('prefilled-existing'); _markChanged(); updateSaveBtn(); };
        if (startEl) {
            startEl.addEventListener('input',  onTimeEdit);
            startEl.addEventListener('change', onTimeEdit);
        }
        if (endEl) {
            endEl.addEventListener('input',    onTimeEdit);
            endEl.addEventListener('change',   onTimeEdit);
        }

        // Other-family sub-controls: flavour is a single-select toggle; the RDW tick marks an
        // Other rest-day. Both mark the grid changed like any other edit.
        row.querySelectorAll('.al-swap-btn').forEach(btnEl => {
            btnEl.addEventListener('click', () => {
                const answer = /** @type {HTMLElement} */ (btnEl).dataset.swap || '';
                row.dataset.alSwap = answer;
                row.querySelectorAll('.al-swap-btn').forEach(b =>
                    b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.swap === answer)));
                _markChanged();
                updateSaveBtn();
            });
        });

        row.querySelectorAll('.other-flavour-btn').forEach(btnEl => {
            const btn = /** @type {HTMLButtonElement} */ (btnEl);
            btn.addEventListener('click', () => {
                row.querySelectorAll('.other-flavour-btn').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                row.classList.remove('prefilled-existing');
                _syncOtherSpareMode(row);   // Spare hides RDW/times; Other-family flavours restore them
                _markChanged(); updateSaveBtn();
            });
        });
        const otherRdwCb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (otherRdwCb) otherRdwCb.addEventListener('change', () => {
            row.classList.remove('prefilled-existing');
            _syncOtherRdwWarn(row);
            _markChanged(); updateSaveBtn();
        });
    }

    // The day markers' meaning used to live ONLY in an `aria-label`. Listed here for everybody, and
    // only the icons THIS week carries, so an ordinary week adds no row. Reasoning: admin.css.
    if (weekBadges.size) {
        container.insertAdjacentHTML('beforeend', `<div class="week-badge-legend">${[...weekBadges].map(([icon, title]) =>
            `<span class="wbl-item"><span class="wbl-icon" aria-hidden="true">${icon}</span>${escapeHtml(title)}</span>`).join('')}</div>`);
    }
}

/**
 * Re-renders the full week grid for the currently selected member and date — or the state that stands
 * in for it (no member, loading, failed) — and refreshes the bulk bar and the Save button to match, on
 * every branch: a bar left counting the previous week's rows has a Save that does nothing.
 */
export function renderWeekGrid() {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    const weekGrid    = document.getElementById('weekGrid');
    const bulkBar     = document.getElementById('bulkBar');
    const memberName  = fieldMember?.value;
    const dateStr     = fieldDate?.value;

    updateWeekNavLabel(dateStr ?? '');

    if (!memberName || !dateStr) {
        if (weekGrid) weekGrid.innerHTML = `<div class="week-empty">${_canPickMember ? 'Select a staff member and date above to load the week.' : 'Select a date above to load the week.'}</div>`;
        if (bulkBar)  bulkBar.style.display = 'none';
        updateSaveBtn();
        return;
    }

    // AN UNREAD MEMBER IS NOT A MEMBER WITH NO CHANGES (v21.38). The load is staged, so selecting
    // somebody whose slice has not arrived would paint seven base-roster days with no overrides on
    // them — which is exactly what a member with a clear week looks like, and an admin reading it
    // would conclude there is nothing recorded. Saving is refused in this state anyway; this is the
    // half that stops it being MISREAD. Cleared by the re-render `loadOverrides` runs on arrival.
    if (!hasOverrideAuthorityFor(memberName)) {
        // WAITING AND STUCK ARE DIFFERENT STATES (v21.38, review). Saying "Loading…" over a load
        // that has already failed is the same class of false claim as showing an empty week — it
        // just fails in the patient direction, and the admin waits instead of acting. The retry
        // lives HERE as well as in Saved Changes, because this is the card they are looking at.
        if (weekGrid) {
            if (loadFailedFor(memberName)) {
                weekGrid.innerHTML = '<div class="week-empty" role="alert">' + (globalThis.navigator?.onLine === false
                    ? 'You\'re offline — this member\'s saved changes can\'t be checked until you reconnect.'
                    : 'Couldn\'t load this member\'s saved changes.')
                    + '<br><span class="reload-link" id="retryWeekLink" role="button" tabindex="0">↻ Retry</span></div>';
                const r = document.getElementById('retryWeekLink');
                const again = () => { loadOverrides({ everyone: false, member: memberName }); };   // this member: a capped re-read never covers them
                r?.addEventListener('click', again);
                r?.addEventListener('keydown', /** @param {KeyboardEvent} e */ e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); again(); }
                });
            } else {
                weekGrid.innerHTML = '<div class="week-empty" role="status">Loading this member\'s saved changes…</div>';
            }
        }
        if (bulkBar)  bulkBar.style.display = 'none';
        updateSaveBtn();
        return;
    }

    if (weekGrid) weekGrid.innerHTML = '';

    if (!teamMembers.find(m => m.name === memberName)) {
        if (bulkBar) bulkBar.style.display = 'none';
        updateSaveBtn();
        return;
    }

    const panel = document.createElement('div');
    panel.className = 'week-panel';
    buildWeekGridInto(panel, dateStr);
    if (weekGrid) weekGrid.appendChild(panel);
    if (bulkBar)  bulkBar.style.display = 'block';
    resetBulkPills();
    updateSaveBtn();
}

// A save awaiting the server (v24.23): updateSaveBtn used to re-arm Save mid-save on any keystroke,
// and the sticky bar's Discard stayed live — a "discarded" save then landed anyway. Set around the
// commit by executeSave; while set, Save and both sticky-bar buttons stay disabled.
let _saveInFlight = false;
/** Is the week itself held still for its own save? @type {boolean} */
let _weekHeld = false;
/** What the week's save in flight sends, for a draft kept mid-save (v25.97). @type {null|import('./admin-week-row-state.js').SendingDay[]} */ let _sending = null;
/**
 * @param {boolean} on
 * @param {{ grid?: boolean, sending?: null|import('./admin-week-row-state.js').SendingDay[] }} [opts] `grid`: the write is this WEEK's own save, which resets and redraws
 *   every row when it lands — so a change made in the wait (seconds, on an iPhone) was taken and then
 *   thrown away without a word. The grid and the bulk bar are `inert` until it settles. A range booking
 *   leaves them live: it never redraws over staged rows, and asks before it moves the week.
 *   `sending`: what it sends (`sendingEntries`), held until it settles, for `sendingDays`.
 */
export function setSaveInFlight(on, { grid = false, sending = null } = {}) {
    _saveInFlight = !!on;
    _weekHeld = _saveInFlight && grid;
    _sending = _saveInFlight ? sending : null;
    for (const id of ['weekGrid', 'bulkBar']) { const el = document.getElementById(id); if (el) el.inert = _weekHeld; }
    updateSaveBtn();
}
/** Is any override write on this page still sending? One lock for the grid AND the range cards (v24.38). @returns {boolean} */
export function isSaveInFlight() { return _saveInFlight; }
/** What the week's save in flight is sending, or null between saves: kept with a draft taken mid-save (unsaved-draft.js rule 6). @returns {null|import('./admin-week-row-state.js').SendingDay[]} */
export function sendingDays() { return _sending; }

export function updateSaveBtn() {
    const weekGrid = document.getElementById('weekGrid');
    const saveBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    if (!weekGrid || !saveBtn) return;
    const rows       = /** @type {HTMLElement[]} */ ([...weekGrid.querySelectorAll('.day-row')]);
    rows.forEach(_syncOverwriteBadge); _updateBulkSelCount(); // every overwrite badge, and the bulk bar, in step with the rows
    const saveCount  = rows.filter(r => r.dataset.type && !r.classList.contains('prefilled-existing')).length;
    const delCount   = rows.filter(r => !r.dataset.type && r.dataset.existingId).length;
    const total = saveCount + delCount;
    saveBtn.disabled = total === 0 || _saveInFlight;
    // The unsaved banner's "Discard and continue" too (review A9): navigating mid-save let the
    // landing save reset the rows of the NEW view.
    for (const id of ['stagedSaveBtn', 'stagedDiscardBtn', 'unsavedDiscardBtn']) { const b = /** @type {HTMLButtonElement|null} */ (document.getElementById(id)); if (b) b.disabled = _saveInFlight; }

    // Staged bar — mirrors the save state as a fixed bottom affordance so users
    // can save without scrolling back up to the Save button.
    const stagedBar   = document.getElementById('stagedBar');
    const stagedCount = document.getElementById('stagedCount');
    if (stagedBar) {
        stagedBar.hidden = total === 0;
        if (stagedCount) {
            const parts = [];
            if (saveCount) parts.push(`${saveCount} day${saveCount > 1 ? 's' : ''}`);
            if (delCount)  parts.push(`${delCount} to remove`);
            stagedCount.textContent = parts.join(', ');
        }
    }

    // Inline change preview (v15.58) — a calm "what you're about to do" line above the
    // Save button, naming the member so a wrong-person / wrong-count edit is caught before
    // saving. Type-neutral copy; reuses the counts already computed above.
    const gridPreview = document.getElementById('gridPreview');
    let previewShown = false;
    if (gridPreview) {
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        if (total > 0 && memberName) {
            // THE VERB BELONGS TO EACH CLAUSE, NOT TO THE SENTENCE (v21.40). This used to read
            // "You're about to save <n days to change>", which is what you get when one fixed verb
            // has to cover both halves — and it was worse on a pure deletion ("about to save 2 to
            // remove"). Each clause carries its own verb, so every combination is a sentence.
            const bits = [];
            if (saveCount) bits.push(`change <strong>${saveCount} day${saveCount > 1 ? 's' : ''}</strong>`);
            if (delCount)  bits.push(`remove <strong>${delCount} change${delCount > 1 ? 's' : ''}</strong>`);
            // #gridPreview is an aria-live region, and updateSaveBtn() also fires on every
            // time-input keystroke — only rewrite (and thus re-announce) when the summary
            // actually changes, so typing a shift time doesn't re-read the unchanged sentence.
            const sig = `${saveCount}|${delCount}|${memberName}`;
            if (gridPreview.dataset.sig !== sig) {
                gridPreview.innerHTML = `<span aria-hidden="true">🗓️</span> <span>You're about to ${bits.join(' and ')} for <strong>${escapeHtml(memberName)}</strong>.</span>`;
                gridPreview.dataset.sig = sig;
            }
            gridPreview.hidden = false;
            previewShown = true;
        } else {
            gridPreview.hidden = true;
            gridPreview.textContent = '';
            delete gridPreview.dataset.sig;
        }
    }

    const hint = document.getElementById('saveBtnHint');
    if (hint) {
        // Blank the hint only when the preview above is actually carrying the summary; if the
        // preview isn't showing (no member selected, or stale HTML without #gridPreview) fall
        // back to the guidance so there's never an enabled Save with no on-screen explanation.
        // While the week is held for its own save, a tap on it does nothing, and this says why.
        hint.textContent = _weekHeld ? 'You can change this week again once the save has finished.'
            : previewShown ? '' : 'Select a type on at least one day, then save your changes';
    }
}

/** A bulk-bar refusal, said BESIDE the bar (desktop audit: at the card's foot it sat under the Unsaved bar). '' clears. */
const _bulkSay = (/** @type {string} */ msg) => { const el = document.getElementById('bulkFeedback');
    if (el) { el.className = msg ? 'feedback error' : 'feedback'; setStatus(el, msg ? '⚠ ' + msg : ''); } };

/** The bulk bar as the grid stands: the count, and Apply greyed out with the reason under it (admin-bulk-apply.js). */
function _updateBulkSelCount() {
    _bulkSay('');   // whatever a press refused, the bar has changed since
    const ticked = [...(document.getElementById('weekGrid')?.querySelectorAll('.day-cb:checked') ?? [])]
        .map(cb => /** @type {HTMLElement|null} */ (cb.closest('.day-row'))?.dataset.date ?? ''), n = ticked.length;
    const why = bulkApplyWaitingFor(ticked, _bulkActiveType, _leftAloneBy(_bulkActiveType));
    const count = document.getElementById('bulkSelCount'), hint = document.getElementById('bulkApplyHint');
    const apply = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkApplyBtn'));
    if (count) count.textContent = n > 0 ? `${n} day${n > 1 ? 's' : ''} selected` : '';
    if (apply) apply.disabled = !!why;
    if (hint && hint.textContent !== why) hint.textContent = why;
}

/**
 * Why Apply leaves a ticked day alone for `type`, beyond the Sunday rule (admin-bulk-apply.js names
 * each): before the member's start date, or — for Absent — a rest day by `isWorkingDate`, the rule the
 * Absence card writes by, so a swapped-in shift saved on a rest day counts as work here too.
 * @param {string} type @returns {(date: string) => import('./admin-bulk-apply.js').LeftAlone}
 */
function _leftAloneBy(type) {
    const name   = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value ?? '';
    const member = teamMembers.find(m => m.name === name);
    const map    = member && type === 'sick' ? buildMemberDateMap(name) : null;
    return d => !member ? '' : isBeforeMemberStart(member, parseISODate(d)) ? 'start'
        : map && !isWorkingDate(member, d, map) ? 'rest' : '';
}

// ── BULK BAR ──────────────────────────────────────────────────────────────────
/**
 * Clears the active bulk-bar type pill, hides the time inputs, resets values, and recounts the
 * "N days selected" line against the grid as it stands. The recount is here, not left to callers,
 * because a week SWIPE settles by calling this on a panel built fresh with nothing ticked — and the
 * line went on naming boxes that were no longer on screen (whole-app review, Oct 2026).
 */
export function resetBulkPills() {
    _bulkActiveType = '';
    const bulkTypePills = document.getElementById('bulkTypePills');
    const bulkTimeGroup = document.getElementById('bulkTimeGroup');
    const bulkStart     = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkStart'));
    const bulkEnd       = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkEnd'));
    if (bulkTypePills) bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
    if (bulkTimeGroup) bulkTimeGroup.style.display = 'none';
    if (bulkStart) bulkStart.value = '';
    if (bulkEnd)   bulkEnd.value   = '';
    // Write the LABEL span, not the button's textContent — the button also carries the
    // step-number circle (.bulk-step-num), which textContent would wipe (v16.73).
    const bulkApplyLabel = document.getElementById('bulkApplyLabel');
    if (bulkApplyLabel) bulkApplyLabel.textContent = 'Apply to ticked days';
    _updateBulkSelCount();
}

function _initBulkBar() {
    const bulkTypePills = document.getElementById('bulkTypePills');
    const bulkTimeGroup = document.getElementById('bulkTimeGroup');
    const bulkStart     = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkStart'));
    const bulkEnd       = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkEnd'));
    const bulkApplyBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkApplyBtn'));
    const weekGrid      = document.getElementById('weekGrid');

    if (bulkTypePills) {
        // DELEGATED ON THE CONTAINER, not attached per pill (v21.94).
        //
        // The pills do not exist in `admin.html` — `#bulkTypePills` ships empty and `admin-app.js`
        // fills it from `PILL_TYPES` at init. Per-pill listeners therefore depend on this running
        // AFTER that fill and on the row never being rebuilt, and the wiring guard added in the
        // same release makes the second half load-bearing: a rebuild would leave dead pills with
        // no second `initWeekEditor` to re-attach them. The container is static, so delegating on
        // it is true whatever order the two run in and however often the row is redrawn.
        bulkTypePills.addEventListener('click', (e) => {
            const pill = /** @type {HTMLButtonElement|null} */ (
                /** @type {Element} */ (e.target).closest('.type-pill-btn'));
            if (!pill || !bulkTypePills.contains(pill)) return;
            const type    = pill.dataset.type ?? '';
            const already = pill.classList.contains('active');
            resetBulkPills();   // pills, times, label and Apply back to rest; a second press stops there
            if (already) return;
            pill.classList.add('active');
            pill.setAttribute('aria-pressed', 'true');
            _bulkActiveType = type; _updateBulkSelCount();
            const bulkApplyLabel = document.getElementById('bulkApplyLabel');
            if (bulkApplyLabel) bulkApplyLabel.textContent = `Apply “${TYPES[type]?.label ?? type}” to ticked days`;
            if (bulkTimeGroup) bulkTimeGroup.style.display = (TYPES[type] && !TYPES[type].fixed) ? 'flex' : 'none';
        });
    }

    /**
     * Deselect one out-of-selection row for the bulk tick buttons (v16.23). Three cases:
     *  · UNTOUCHED prefilled row (existingId + prefilled-existing): visually uncheck only —
     *    _deactivateRow would clear dataset.type and stage a DELETE of the saved doc.
     *  · EDITED saved-override row (existingId, prefilled class removed): leave the checkbox
     *    CHECKED and the edit staged — unchecking it visually while the collector still saved
     *    the edit made the box lie, and deactivating staged a silent delete. The bulk buttons
     *    only tick days; they never unstage an edit.
     *  · Plain staged row (no existingId): deactivate as before. Returns true when staged
     *    state actually changed (drives _markChanged, which must not fire for mere ticking).
     * @param {HTMLElement} row @param {HTMLInputElement} checkbox
     * @returns {boolean} staged state changed
     */
    function _bulkDeselectRow(row, checkbox) {
        if (row.dataset.existingId) {
            if (row.classList.contains('prefilled-existing')) {
                checkbox.checked = false;
                row.classList.remove('selected');
            }
            return false;   // edited row: untouched (checkbox stays ticked, edit stays staged)
        }
        const hadStaged = !!row.dataset.type;
        _deactivateRow(row, checkbox, row.querySelectorAll('.type-pill-btn'),
            /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start')),
            /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end')));
        return hadStaged;
    }

    document.getElementById('bulkSelMonFri')?.addEventListener('click', () => {
        let stagedChanged = false;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dayIdx   = parseISODate((row.dataset.date ?? '')).getDay();
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            if (dayIdx >= 1 && dayIdx <= 5) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                stagedChanged = _bulkDeselectRow(row, checkbox) || stagedChanged;
            }
        });
        // Only when staged state genuinely changed — mere ticking stages nothing, and a false
        // unsaved-changes flag also froze the admin week-swipe gesture (v16.23).
        if (stagedChanged) _markChanged();
        updateSaveBtn();
    });

    document.getElementById('bulkSelWorking')?.addEventListener('click', () => {
        let stagedChanged = false;
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
        // Build priority-correct override map once — manual beats roster_import per date.
        const selMemberDateMap = memberName ? buildMemberDateMap(memberName) : null;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dateISO  = row.dataset.date ?? '';
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            // The cards' rule (`isWorkingDate`): a saved rest-day correction makes a day rest, and a
            // shift swapped onto a rest day makes it worked — the AL card charges that day, so this ticks it.
            if (member && selMemberDateMap && isWorkingDate(member, dateISO, selMemberDateMap)) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                stagedChanged = _bulkDeselectRow(row, checkbox) || stagedChanged;   // see bulkSelMonFri (v16.23)
            }
        });
        if (stagedChanged) _markChanged();
        updateSaveBtn();
    });

    document.getElementById('bulkSelAll')?.addEventListener('click', () => {
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            checkbox.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        });
        // No _markChanged: ticking alone stages nothing (the collector keys off dataset.type).
        updateSaveBtn();
    });

    bulkApplyBtn?.addEventListener('click', () => {
        if (!_bulkActiveType) { _bulkSay('Choose a type in step 2 first, then select Apply.'); return; }
        const typeMeta = TYPES[_bulkActiveType], leftAlone = _leftAloneBy(_bulkActiveType);
        let applied = 0;
        /** @type {string[]} */ const ticked = [];
        /** @type {Array<{ date: string, why: 'sunday' | 'rest' | 'start' }>} */ const skipped = [];
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox || !checkbox.checked) return;
            const date = row.dataset.date ?? '';
            ticked.push(date);
            if (isForbiddenOnSunday(_bulkActiveType) && isSunday(date)) { skipped.push({ date, why: 'sunday' }); return; } // Layer 2 of the Sunday rule — the list is `SUNDAY_FORBIDDEN_TYPES` (override-utils.js).
            const why = leftAlone(date);
            if (why) { skipped.push({ date, why }); return; }   // Absent on a rest day; any day before the start date
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
            const endEl   = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
            // User-edited, not pre-filled — cleared FIRST so _activateRow sees a staged row (the swap
            // question is only asked of one, review A6).
            row.classList.remove('prefilled-existing');
            _activateRow(row, checkbox, pills, startEl, endEl, _bulkActiveType);
            applied++;
            if (typeMeta && !typeMeta.fixed) {
                if (bulkStart?.value && startEl) startEl.value = bulkStart.value;
                if (bulkEnd?.value && endEl)     endEl.value   = bulkEnd.value;
            }
        });
        // Backstops: Apply is greyed out for both of these before a press (admin-bulk-apply.js).
        if (!ticked.length) { _bulkSay('Tick some days first — use the buttons above, or tick days in the week below.'); return; }
        if (applied === 0)  { _bulkSay(bulkApplyWaitingFor(ticked, _bulkActiveType, leftAlone) || 'Nothing applied.'); return; }
        _markChanged();
        updateSaveBtn();   // …and with it the bulk bar's count and Apply
        // Name the ticked days left alone, so "All 7 → 4 applied" isn't a surprise.
        const said = bulkSkippedLine(applied, skipped, formatDisplay);
        if (said) _showSuccess(said, undefined, { toast: false });   // staged, not saved: never the save's toast
    });
}
