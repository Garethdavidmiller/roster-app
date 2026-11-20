// @ts-check
/**
 * admin-week-editor.js — the seven-day grid, its pills, and everything staged but not yet saved.
 *
 * The week grid, the per-row type pills, the bulk bar, and the Save button's read of what is staged:
 * one job — decide what a week SHOULD say — which ends where `executeSave` begins.
 *
 * ── STAGED IS NOT SAVED, AND THE DIFFERENCE IS LOAD-BEARING ─────────────────────────────────────
 *
 * `hasStagedEdits` is the reason a background refresh does not repaint over an admin mid-edit, and
 * it counts BOTH directions: a row given a type that is not an unchanged prefill (a staged change)
 * and a prefilled row with its type taken away (a staged REMOVAL). Counting only the first lets a
 * refresh discard staged removals while the page still believes it has unsaved changes.
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
import { isRestShift, isForbiddenOnSunday, isBeforeMemberStart, OTHER_FLAVOURS, isChristmasOrBoxingDay } from './override-utils.js';
import { isWorkingDate } from './al-entitlement.js';
import { formatDisplay } from './admin-period-dates.js';
import { isChristmasLeaveDay, isChristmasClosureDate, resolveDayShift, allowanceForBoxingDay } from './christmas-leave.js';
import { TYPES, PILL_TYPES, typePillHtml } from './admin-shift-types.js';
import { bulkApplyWaitingFor, bulkSkippedLine } from './admin-bulk-apply.js';
import { isBoxingDay, christmasDayName, weekStepAllowed } from './admin-shift-rules.js';
import { restrictDayPills } from './admin-day-pills.js';
import { hasOverrideAuthorityFor, loadFailedFor, loadOverrides } from './admin-override-store.js';
// The row's own appearance rules (admin-week-row-state.js), under the same names.
import { _syncOtherRdwWarn, _syncOtherSpareMode, _activateRow, _syncOverwriteBadge, _deactivateRow, isStagedRow, prefillRow,
         rosteredWords } from './admin-week-row-state.js';
export { rosteredWords };   // its home is the row's own words now; exported here as it always was
// The grid's time boxes — typed formatting and the HH:MM check, by clock-input.js's rule.
import { initTimeInputs } from './admin-time-inputs.js';
import { setStatus } from './status-text.js';

/** What a member still signed in after leaving the roster is told, on every card (admin-app.js). */
export const NOT_ON_ROSTER_LINE = 'Your account is no longer on the roster — please contact the admin.';

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
    // DEPS ABOVE EVERY TIME; WIRING ONCE. `initOverrides` can run twice on the in-place login path,
    // and these attach DELEGATED listeners (`initTimeInputs` two at `document` level): a second attach
    // double-fires every click — on the two-tap Delete, one tap both arms AND executes. The guard lives
    // where the listeners are; identity and permissions are re-assigned on every call.
    if (_wired) return;
    _wired = true;
    _initBulkBar();
    initTimeInputs();
}

/** True when the week grid holds STAGED (unsaved) work, BOTH directions (the header). It stops a
 *  re-render over in-progress edits — by loadOverrides, and by the page's own writes, which then redraw
 *  only the days they touched (admin-own-write.js) — and feeds admin-app's unsaved-changes guard. The
 *  row test is `isStagedRow` (admin-week-row-state.js), which a kept draft reads its rows with too. */
export function _hasStagedEdits() {
    const weekGrid = document.getElementById('weekGrid');
    if (!weekGrid) return false;
    return [...weekGrid.querySelectorAll('.day-row')].some(r => isStagedRow(/** @type {HTMLElement} */ (r)));
}

/** Return every row in the week grid to its unstaged state, after a save — here, with the row lifecycle. @returns {void} */
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

/** Returns a new Date set to the Sunday of the week containing dateStr. @param {string} dateStr */
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
        // Same-month ranges collapse to "19–25 Jul 2026", as formatTeamWeekLabel does, and both forms use
        // a tight en-dash: at 375px a few pixels more ellipsise the label and cut the date picker's 📅.
        // The week across New Year names the year it STARTS in, "27 Dec 2026–2 Jan": "27 Dec–2 Jan 2027" put
        // 27 December in 2027. Team View names both years; here both measured 22px over the 375px box, and
        // a January after a December needs no year of its own.
        label.textContent = sunday.getMonth() === saturday.getMonth()
            ? `${sunday.getDate()}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`
            : sunday.getFullYear() !== saturday.getFullYear()
                ? `${sunday.getDate()} ${MONTH_ABB[sunday.getMonth()]} ${sunday.getFullYear()}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]}`
                : `${sunday.getDate()} ${MONTH_ABB[sunday.getMonth()]}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`;
        // The NAME leads with the week it shows (WCAG 2.5.3 Label in Name), written beside the text so
        // the two cannot describe different weeks.
        label.setAttribute('aria-label', `${label.textContent} — jump to week containing date`);
        const todaySun = new Date();
        todaySun.setDate(todaySun.getDate() - todaySun.getDay());
        label.classList.toggle('is-current-week', sunday.toDateString() === todaySun.toDateString());
    }
    // NO ARROW INTO A WEEK OUTSIDE THE CONFIGURED YEARS — `weekStepAllowed`.
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
    const memberDateMap = buildMemberDateMap(memberName);   // priority-correct: manual beats roster_import
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
        // which the Calendar never shows, and an Other day on Boxing Day (owner, Jul 2026). Nor a Spare
        // turn on Christmas Day or Boxing Day (owner, 19 Nov 2026; admin-day-pills.js).
        const beforeStart = isBeforeMemberStart(member, date), boxing = isBoxingDay(dateISO) && !isSunday(dateISO);
        // CHRISTMAS LEAVE — the Base roster column shows it as the Calendar does, AL, and the row says why
        // (rules: christmas-leave.js). The column used to show the rest day `getBaseShift` makes both
        // Christmas days, with only this row's note to say the member is on leave; on a phone that note
        // is hidden until the row is ticked, so the grid read REST beside a Calendar reading AL with
        // nothing on screen to reconcile them (owner, 18 Nov 2026). Only the badge changes: every rule
        // below still reads `baseShift`, the closure's rest day — work there is RDW, as the hint says.
        // Asked of the SAME resolver the Calendar draws with, so neither can describe a day differently.
        const xmasDue   = isChristmasLeaveDay(member, date);
        const xmasShows = xmasDue ? resolveDayShift(existing ?? null, baseShift, isSunday(dateISO), true, isChristmasOrBoxingDay(dateISO)).shift : '';
        const baseShown = xmasDue ? resolveDayShift(null, baseShift, isSunday(dateISO), true, isChristmasOrBoxingDay(dateISO)).shift : baseShift;
        const xmasDay   = date.getDate() === 25 ? 'Christmas Day' : 'Boxing Day';
        // A Spare saved here before Spare turns were refused is not drawn on the Calendar (override-utils.js,
        // `isOverrideDisplaySuppressed`), so the row says so beside it rather than "nothing to record"
        // (review, 20 Nov 2026) — and says how it goes: its pill is on for that one act.
        const hiddenSpare = existing?.type === 'spare_shift' && isChristmasOrBoxingDay(dateISO);
        const christmasNote = hiddenSpare
                ? `${xmasDay}: a Spare saved here before Spare turns were refused is not shown on the Calendar — select Other to remove it`
            : !xmasDue ? ''
            : xmasShows === 'AL'
                ? `${xmasDay}: due at work, so on annual leave that is never counted — nothing to record`
            : date.getDate() === 26 && isWorkedShift(xmasShows)
                ? `Boxing Day worked when due at work: one day of annual leave in lieu is added to the ${allowanceForBoxingDay(member, date.getFullYear())} allowance`
            : '';

        const row = document.createElement('div');
        const isToday = dateISO === todayISO;
        // The overwrite badge is drawn empty: `prefillRow` below writes its words before the row is painted.
        // A per-row id links the time inputs to their inline error message (aria-describedby).
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
            <div class="col-base">${getShiftBadge(baseShown, { showTime: true })}</div>
            <div class="col-pills">
                ${PILL_TYPES.map(t => typePillHtml(t)).join('\n                ')}
                ${isSunday(dateISO) ? `<span class="sunday-note">Sunday isn’t a contracted day — work is recorded as RDW; leave, absence and Other days can’t be recorded${christmasDayName(dateISO) ? `, nor a Spare turn on ${christmasDayName(dateISO)}` : ', but a Spare turn can'}</span>` : ''}
                ${christmasNote ? `<span class="christmas-note">${escapeHtml(christmasNote)}</span>` : ''}
                ${beforeStart ? `<span class="start-note">Before the start date (${formatDisplay(formatISO(/** @type {Date} */ (member.startDate)))}) — the Calendar doesn’t show changes here, so none can be recorded</span>`
                    : boxing ? '<span class="christmas-note">Boxing Day can’t be an Other day — training, meetings and the rest — or a Spare turn</span>'
                    : christmasDayName(dateISO) === 'Christmas Day' && !isSunday(dateISO) ? '<span class="christmas-note">Christmas Day can’t be a Spare turn</span>' : ''}
            </div>
            <div class="col-time">
                <input type="text" class="time-input day-start" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" aria-label="Start time (HH:MM)" aria-describedby="${timeErrId}">
                <span class="time-sep">–</span>
                <input type="text" class="time-input day-end" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" aria-label="End time (HH:MM)" aria-describedby="${timeErrId}">
                <span class="time-note">No time needed</span>
                <span class="time-hint">24h · max 12 hrs</span>
                <span class="time-error-msg" id="${timeErrId}" role="alert">Use HH:MM format (e.g. 07:00)</span>
            </div>
            <div class="col-rd-hint" hidden>${xmasDue ? `The station is closed on ${xmasDay} — use <strong>RDW</strong> if this day was worked`
                : 'Base roster: Rest Day — use <strong>RDW</strong> if this was overtime'}</div>
            <!-- Swapped-day question: no pre-pressed state, save refuses until answered (al-swapped-days.js). -->
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
                ${!isRestShift(baseShift) ? '' : `<span class="other-rdw-auto">Ticked and locked because ${xmasDue ? `the station is closed on ${xmasDay}` : 'the base roster has this as a rest day'} — RDW is automatic</span>`}
                <span class="other-rdw-warn" hidden>Originally rostered ${escapeHtml(rosteredWords(baseShift))} this day — RDW pays it as rest-day working instead</span>
                <span class="other-opts-hint">Pick a type above, then times (optional — blank pays the default: base shift, or 8h RDW).</span>
            </div>`;

        container.appendChild(row);

        // What this day cannot take is turned off at its pills, with the reason — the Sunday rule's layer 1,
        // Boxing Day, and before the start date; Other offers Spare alone on an ordinary Sunday (never on
        // 25 or 26 December, which take no Spare turn).
        restrictDayPills(row, { sunday: isSunday(dateISO), boxing, beforeStart, christmas: christmasDayName(dateISO) });

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
                    // Time inputs return to tabindex=-1, so focus stays on the pill — unless it was on only
                    // to remove a record the day no longer takes, and is off again (admin-week-row-state.js).
                    if (pill.disabled) /** @type {HTMLElement|null} */ (checkbox)?.focus(); else pill.focus();
                } else {
                    _activateRow(row, checkbox, pills, startEl, endEl, type);
                    // Shift or RDW pre-fill the base shift's times, unless something is already entered.
                    if (!TYPES[type]?.fixed && !/** @type {HTMLInputElement} */ (startEl).value && !/** @type {HTMLInputElement} */ (endEl).value) {
                        if ((type === 'shift' || type === 'rdw') && baseShift && baseShift.includes('-')) {
                            const [prefillS, prefillE] = baseShift.split('-');
                            /** @type {HTMLInputElement} */ (startEl).value = prefillS;
                            /** @type {HTMLInputElement} */ (endEl).value   = prefillE;
                        }
                    }
                    // timesOptional (Other): no focus on the time input, whose keyboard would cover the
                    // just-revealed flavour and RDW controls for times that are usually unknown.
                    if (!TYPES[type]?.fixed && !TYPES[type]?.timesOptional) /** @type {HTMLInputElement} */ (startEl).focus();
                }
                // Show RD hint when Shift is chosen on a base-rest day
                const rdHint = /** @type {HTMLElement|null} */ (row.querySelector('.col-rd-hint'));
                if (rdHint) rdHint.hidden = !(type === 'shift' && row.dataset.baseIsRd === '1' && !already);
                // AL on a base rest day is asked about — by _activateRow / _deactivateRow, so bulk apply and
                // the checkbox follow the same rule.
                _markChanged();
                updateSaveBtn();
            });
        });

        if (checkbox) {
            checkbox.addEventListener('change', () => {
                if (/** @type {HTMLInputElement} */ (checkbox).checked) {
                    if (!row.dataset.type) row.classList.add('selected');
                    // Ticking stages nothing (the collector keys off dataset.type), so it is not a change.
                } else {
                    // UNTICKING NEVER DELETES A SAVED CHANGE (owner, 10 Nov 2026): a saved day goes back to its
                    // record; any other is cleared. Removal is its type selected again, or ✕ in Saved Changes.
                    const hadStaged = isStagedRow(row);
                    if (existing) prefillRow(row, existing); else _deactivateRow(row, checkbox, pills, startEl, endEl);
                    if (hadStaged) _markChanged();
                }
                updateSaveBtn();   // …which recounts the bulk bar too
            });
        }

        // 'input' as well as 'change': the auto-format (admin-time-inputs.js) sets .value on each
        // keystroke, which on WebKit resets the baseline, so 'change' never fires on leaving.
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
        // Somebody who cannot pick a member has their own — unless they left the roster while signed in, and
        // admin-app.js cleared the selects: "Select a date above" was untrue there, with a date showing.
        const why = _canPickMember ? 'Select a staff member and date above to load the week.'
            : !memberName ? NOT_ON_ROSTER_LINE : 'Select a date above to load the week.';
        if (weekGrid) weekGrid.innerHTML = `<div class="week-empty">${why}</div>`;
        if (bulkBar)  bulkBar.style.display = 'none';
        updateSaveBtn();
        return;
    }

    // AN UNREAD MEMBER IS NOT A MEMBER WITH NO CHANGES (the header). Saving is refused here anyway;
    // this stops the week being MISREAD. Cleared by the re-render `loadOverrides` runs on arrival.
    if (!hasOverrideAuthorityFor(memberName)) {
        // WAITING AND STUCK ARE DIFFERENT STATES. The retry is here as well as in Saved Changes,
        // because this is the card the admin is looking at.
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

// A save awaiting the server, set around the commit: Save and both sticky-bar buttons stay disabled,
// or a keystroke re-arms Save and a "discarded" save lands anyway.
let _saveInFlight = false;
/** Is the week itself held still for its own save? @type {boolean} */
let _weekHeld = false;
/** What the week's save in flight sends, for a draft kept mid-save. @type {null|import('./admin-week-row-state.js').SendingDay[]} */ let _sending = null;
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
/** Is any override write on this page still sending? One lock for the grid AND the range cards. @returns {boolean} */
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
    // The unsaved banner's "Discard and continue" too: a landing save would reset the NEW view's rows.
    for (const id of ['stagedSaveBtn', 'stagedDiscardBtn', 'unsavedDiscardBtn']) { const b = /** @type {HTMLButtonElement|null} */ (document.getElementById(id)); if (b) b.disabled = _saveInFlight; }

    // Staged bar — the save state as a fixed bottom affordance, so nobody scrolls back up to save.
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

    // Inline change preview — what you are about to do, naming the member, so a wrong person or count
    // is caught before saving.
    const gridPreview = document.getElementById('gridPreview');
    let previewShown = false;
    if (gridPreview) {
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        if (total > 0 && memberName) {
            // THE VERB BELONGS TO EACH CLAUSE, so every combination is a sentence.
            const bits = [];
            if (saveCount) bits.push(`change <strong>${saveCount} day${saveCount > 1 ? 's' : ''}</strong>`);
            if (delCount)  bits.push(`remove <strong>${delCount} change${delCount > 1 ? 's' : ''}</strong>`);
            // A live region, and this runs on every keystroke: rewrite (re-announce) only on a change.
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
        // Blank only while the preview carries the summary: never an enabled Save with no explanation.
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
 * each): before the member's start date, or — for Absent — a rest day by `isWorkingDate`, so a
 * swapped-in shift saved on a rest day counts as work here too. (The Absence card also passes over a rest
 * day's RDW or free leave, which an absence would hide; the grid records what it is told on such a day.)
 * @param {string} type @returns {(date: string) => import('./admin-bulk-apply.js').LeftAlone}
 */
function _leftAloneBy(type) {
    const name   = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value ?? '';
    const member = teamMembers.find(m => m.name === name);
    const map    = member && type === 'sick' ? buildMemberDateMap(name) : null;
    return d => !member ? '' : isBeforeMemberStart(member, parseISODate(d)) ? 'start'
        : !map || isWorkingDate(member, d, map) ? ''
        // Christmas Day and Boxing Day are named as themselves; then rest by the base roster, or a working day
        // a SAVED change has set as rest — each said apart (admin-bulk-apply.js).
        : isChristmasClosureDate(d) ? 'christmas'
        : isRestShift(getBaseShift(member, parseISODate(d))) ? 'rest' : 'setRest';
}

// ── BULK BAR ──────────────────────────────────────────────────────────────────
/**
 * Clears the active bulk-bar type pill, hides the time inputs, resets values, and recounts the
 * "N days selected" line — here, because a week SWIPE settles by calling this on a fresh panel.
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
    // The LABEL span, not the button's textContent, which would wipe its step-number circle.
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
        // DELEGATED ON THE CONTAINER: `#bulkTypePills` ships empty and `admin-app.js` fills it at init,
        // and the wiring runs once — per-pill listeners would depend on the order and die on a rebuild.
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
     * Deselect one out-of-selection row for the bulk tick buttons. Three cases:
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
        // Only when staged state changed — ticking stages nothing, and a false flag freezes the week swipe.
        if (stagedChanged) _markChanged();
        updateSaveBtn();
    });

    document.getElementById('bulkSelWorking')?.addEventListener('click', () => {
        let stagedChanged = false;
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
        // Priority-correct, once: manual beats roster_import per date.
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
                stagedChanged = _bulkDeselectRow(row, checkbox) || stagedChanged;   // see bulkSelMonFri
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
        /** @type {Array<{ date: string, why: 'sunday' | 'rest' | 'setRest' | 'christmas' | 'start' }>} */ const skipped = [];
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
            // User-edited — cleared FIRST, so _activateRow sees a staged row (the swap question asks only one).
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
