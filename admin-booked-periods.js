// @ts-check
/**
 * admin-booked-periods.js — THE RECORDED-DATES LIST, AND WHICH YEAR OF IT YOU ARE LOOKING AT.
 *
 * The "Recorded Annual Leave dates" and "Recorded absence dates" sub-cards on admin.html. Both are
 * the same list of the same shape, differing only in the type they filter on and the colour of
 * their count pill, so they are one renderer with an injected config — as they were when this lived
 * inside admin-app.js.
 *
 * ── WHY IT LEFT THE COORDINATOR (v23.09) ────────────────────────────────────────────────────────
 *
 * Because it grew a RULE. A list of every date a member has ever booked is fine at four rows and
 * unusable at fifteen: the owner's own card ran January 2026 to June 2027 in one scroll, and every
 * month header had to repeat the year because nothing else on the card said which year a row
 * belonged to. Choosing a year is a decision with precedence in it — a pinned choice, an inferred
 * one, and what to do when neither exists in the data — and precedence is exactly the kind of thing
 * that must be testable without a DOM. `coordinator-ratchet.test.mjs` had named this function as
 * the next extraction candidate; the feature is what made it due.
 *
 * ── EVERY DATE APPEARS IN THE YEAR IT FALLS IN, EXACTLY ONCE (v23.11, owner decision) ────────────
 *
 * A booking that runs Mon 28 Dec → Fri 1 Jan is SPLIT at the year end: 28–31 Dec under 2026,
 * 1 Jan under 2027. The first cut filed the whole booking under the year it started in, on the
 * reasoning that it is one booking made once — and the owner's own leave showed why that is the
 * wrong axis: a member opening 2027 to see what leave they have in it found no 1 January, because
 * the day was filed under a year they had no reason to open. Leave is counted, capped and asked
 * about PER YEAR; the list has to be cut the way the question is asked.
 *
 * The consequence worth stating: each year's list holds the dates of that year the AL banner counts.
 * There is still no total printed here — the banner directly above owns the figures and this owns
 * the dates, one fact one home. ONE KIND OF DAY IS FILED APART FROM ITS ALLOWANCE (v25.18): a
 * January day moved to the previous year's allowance (leave-year.js) stays under its own date's
 * year, as the Calendar shows it, while the banner counts it the year before. So the two can differ
 * by exactly the moved days, and each says so — the row holding one names the year it comes out
 * of, and that year's list ends with a line naming the days it lends.
 *
 * ── WHAT THE PURE HALF IS FOR ───────────────────────────────────────────────────────────────────
 *
 * `bookedYears` and `pickBookedYear` are the whole decision, and they are separated because the way
 * to get this wrong is silent: show a year with nothing in it and the card reads as "no leave
 * recorded" — the same false statement v23.08 fixed one layer up, arrived at from a different
 * direction. `pickBookedYear` may therefore only ever return a year that is IN the list it was
 * handed, or null when the list is empty.
 *
 * ── THE TWO CONTROLS A DELETING LIST NEEDS, SHARED ──────────────────────────────────────────────
 *
 * The two-tap ✕ (`armConfirm` / `disarmConfirm`) and the feedback line's fade (`fadeFeedback` /
 * `holdFeedback`) are exported because Saved Changes deletes the same records another way, and the
 * range cards write the same feedback line this list's deletes report on. There was a second copy
 * of the two-tap in Saved Changes, and only that copy had been fixed: this one left its five-second
 * disarm timer running, so it could disarm a re-armed ✕ early or put "✕" back over a slow delete's
 * "…" (whole-app check, 10 Nov 2026). One copy cannot drift.
 *
 * A DOUBLE TAP IS ONE GESTURE, NOT A QUESTION ANSWERED (confirm review, Nov 2026). The second tap of a
 * double tap met an armed control and deleted at once, so the two-tap asked nothing of the hand that
 * double-tapped — and iOS teaches double taps by swallowing a first tap with the keypad up. The Pay
 * Calculator's Clear had already learned this (`CLEAR_CONFIRM_MIN_MS`, paycalc-app.js); here the
 * minimum lives in the one way to arm a control, `twoTap`, so no caller can arm without it.
 * `armConfirm` is deliberately NOT exported: a caller that armed it directly and tested `confirming`
 * itself would be the copy that forgot. Operations' email Remove uses it too.
 */

import { carriedFrom } from './leave-year.js';
import { computePeriodDeleteIds, withOutrankedManualCopies } from './override-utils.js';
import { isChristmasClosureDate } from './christmas-leave.js';
import { namedDays } from './admin-period-dates.js';

/**
 * What a row's ✕ deletes, and the line that then says so (review, Nov 2026). The records are
 * `computePeriodDeleteIds`' — less a leave record STORED ON CHRISTMAS DAY OR BOXING DAY unless the row
 * is the Christmas row: that record has a row and a ✕ of its own, and a December period spanning it
 * took it unsaid. The line counts the days the row LISTED, and names the uncounted days of the same
 * type the delete takes with them (leave on a rest day, which costs nothing and so is not listed; a
 * Sunday's), which it used to leave out.
 *
 * …AND THE OLDER COPIES THOSE RECORDS OUTRANK GO WITH THEM (review, Nov 2026), as in every other Admin
 * delete since v24.48 (`withOutrankedManualCopies`). Left behind, a copy from before the fixed per-day
 * ids shows as the day's value the moment the record above it goes: an absence deleted from over an
 * older leave copy brought the leave back, and the allowance fell by a day under "Deleted 1 absence
 * day". The line names the days those copies were on.
 *
 * …AND A SUNDAY THE BOOKING SET AS A REST DAY IS SAID TO BE BACK (review, Nov 2026). A booking over a
 * worked Sunday wrote a rest-day correction beside it, and its receipt named that Sunday; deleting the
 * period deletes the correction too, so the rostered shift shows on the Calendar again, and the line
 * said only "Deleted 5 AL days".
 * @param {{ overrides: any[], type: string, memberName: string, start: string, end: string,
 *           isRestGap: (d: string) => boolean, listedCount?: number }} args
 * @returns {{ ids: string[], said: string }}
 */
export function periodDelete({ overrides, type, memberName, start, end, isRestGap, listedCount }) {
    const christmasRow = isChristmasClosureDate(start) && isChristmasClosureDate(end);
    const byId = new Map(overrides.map(o => [o.id, o]));
    const own = computePeriodDeleteIds(overrides, { type, memberName, start, end, isRestGap }).filter(id => {
        const o = byId.get(id);
        return christmasRow || !(o?.type === type && isChristmasClosureDate(o.date));
    });
    const ids = [...withOutrankedManualCopies(overrides, own)];
    /** The records behind some ids, each day once, in date order. @param {string[]} list @param {(o: any) => boolean} which */
    const datesOf = (list, which) => [...new Set(list.map(id => byId.get(id)).filter(o => o && which(o)).map(o => o.date))].sort();
    const days = datesOf(own, o => o.type === type).length;
    const listed = listedCount ?? days;
    const more = days - listed;
    const older = ids.filter(id => !own.includes(id));
    const olderOn = datesOf(older, () => true);
    const sundays = datesOf(own, o => o.type === 'correction');
    const noun = type === 'annual_leave' ? 'AL day' : 'absence day';
    const one = sundays.length === 1;
    return { ids, said: `✓ Deleted ${listed} ${noun}${listed !== 1 ? 's' : ''} for ${memberName}`
        + (more > 0 ? `, and ${more} more day${more === 1 ? ' that was' : 's that were'} not counted` : '')
        + (older.length ? `, and ${older.length === 1 ? 'an earlier entry' : `${older.length} earlier entries`} for ${namedDays(olderOn)}` : '')
        + (sundays.length ? `. ${namedDays(sundays)}, set as ${one ? 'a rest day' : 'rest days'} for this `
            + `${type === 'annual_leave' ? 'leave' : 'absence'}, ${one ? 'is' : 'are'} back on the roster.` : '') };
}

/**
 * Arm a two-tap destructive control: its label, class and accessible name change together. A
 * DESTRUCTIVE TWO-STEP CONTROL MUST SAY ITS MEANING CHANGED (v23.16, external review), so the name
 * becomes "Confirm …"; the idle name is kept on the element, so any exit — the timer, a failure,
 * success — can restore it, and a re-arm while armed never reads "Confirm confirm …". It disarms
 * itself after five seconds — but never while it is `disabled`, which is how both delete paths mark
 * a delete in flight.
 *
 * The countdown is ONE per control, so a re-arm gets its own five seconds, and it lives ON the
 * control as `armTimer`, where the Saved Changes copy kept it: e2e/axe.spec.js clears it to hold
 * a confirm open for the length of its scan.
 * @param {HTMLElement} btn
 * @param {string} armedText what the armed control SHOWS
 * @param {string} idleText what it shows again once disarmed
 * @param {string} [armedName] the armed accessible name, where "Confirm " + the idle one would not
 *   contain what the control shows — the bulk button's count, said by a voice user as "Delete 3"
 *   (WCAG 2.5.3; 6 Nov 2026)
 */
function armConfirm(btn, armedText, idleText, armedName) {
    /** @type {any} */ (btn).armedAt = performance.now();
    btn.classList.add('confirming');
    btn.textContent = armedText;
    const idle = btn.dataset.idleLabel || btn.getAttribute('aria-label');
    if (idle) {
        btn.dataset.idleLabel = idle;
        btn.setAttribute('aria-label', armedName ?? `Confirm ${idle.charAt(0).toLowerCase()}${idle.slice(1)}`);
    }
    const b = /** @type {any} */ (btn);
    clearTimeout(b.armTimer);
    b.armTimer = setTimeout(() => {
        if (btn.classList.contains('confirming') && !b.disabled) disarmConfirm(btn, idleText);
    }, 5000);
}

/** A confirming tap sooner than this after arming is the SAME gesture — a double tap — never a
 *  question read and answered. The figure is the Pay Calculator's `CLEAR_CONFIRM_MIN_MS`, for the
 *  same reason (header). Measured on `performance.now()`, not `Date.now()`: it is monotonic, so a
 *  clock correction between the taps cannot shorten or stretch it, and the end-to-end suites pin
 *  `Date` with `page.clock.setFixedTime`, under which a `Date` gap never grows and no delete could
 *  ever be confirmed. */
export const TWO_TAP_MIN_MS = 500;

/**
 * One tap of a two-tap destructive control, and whether it CONFIRMS. An idle control is armed and the
 * tap confirms nothing; an armed one confirms only once `TWO_TAP_MIN_MS` has passed since it was
 * armed, so the second tap of a double tap is ignored and the control stays armed for a real answer.
 * On `true` the control is still armed: the caller disarms it, as it always has, when the action
 * starts or ends.
 *
 * `armedFor` names WHAT was asked about — the bulk delete's selection. A tap while armed for
 * something else re-arms for the new thing, with its own count and its own minimum, so the count asked
 * about is the count deleted.
 * @param {HTMLElement} btn
 * @param {string} armedText what the armed control shows — ONE word per action: 'Delete?' for one row,
 *   `Delete ${n}?` for several
 * @param {string} idleText what it shows again once disarmed
 * @param {string} [armedName] the armed accessible name (`armConfirm`)
 * @param {string} [armedFor] what this arming is for, when that can change under it
 * @returns {boolean} true: carry out the action now
 */
export function twoTap(btn, armedText, idleText, armedName, armedFor = '') {
    if (!btn.classList.contains('confirming') || (btn.dataset.armedFor ?? '') !== armedFor) {
        if (armedFor) btn.dataset.armedFor = armedFor; else delete btn.dataset.armedFor;
        armConfirm(btn, armedText, idleText, armedName);
        return false;
    }
    return performance.now() - (/** @type {any} */ (btn).armedAt ?? 0) >= TWO_TAP_MIN_MS;
}

/**
 * The armed control back to idle — label, class and accessible name together, so no exit can
 * restore two of the three — and its countdown stopped.
 * @param {HTMLElement} btn @param {string} idleText
 */
export function disarmConfirm(btn, idleText) {
    const b = /** @type {any} */ (btn);
    clearTimeout(b.armTimer);
    b.armTimer = undefined;
    btn.classList.remove('confirming');
    btn.textContent = idleText;
    if (btn.dataset.idleLabel) btn.setAttribute('aria-label', btn.dataset.idleLabel);
}

/** Each feedback line's pending fade. ONE per line, cancelled by every later write to it. */
const _fades = new WeakMap();

/**
 * Stop a feedback line's pending fade. Every writer of a shared line calls this before it writes:
 * a fade started for an earlier message took a later one down — an error three seconds after a
 * delete, or a receipt meant never to time out (whole-app check, 10 Nov 2026).
 * @param {Element|null|undefined} el
 */
export function holdFeedback(el) {
    if (!el) return;
    clearTimeout(_fades.get(el));
    _fades.delete(el);
}

/**
 * Fade a feedback line back to `idleClass` after `ms`, replacing any fade already pending on it.
 * @param {Element|null|undefined} el @param {string} idleClass @param {number} ms
 */
export function fadeFeedback(el, idleClass, ms) {
    if (!el) return;
    holdFeedback(el);
    _fades.set(el, setTimeout(() => { _fades.delete(el); el.className = idleClass; }, ms));
}

/**
 * Split merged booking periods at every year end, so no segment crosses 31 Dec → 1 Jan.
 *
 * Each segment carries its own `count` — the number of booked DATES inside it — recomputed from
 * `dateList` rather than divided out of the parent's, because a period bridges rest days that are
 * not booked dates and a naive split would count them. A segment's `start` and `end` are always
 * booked dates: the last booked date on or before 31 Dec closes the old year's segment, the first
 * booked date on or after 1 Jan opens the new one. A period that does not span a year end is
 * returned as it came.
 *
 * @param {{ start: string, end: string, count: number }[]} periods
 * @param {string[]} dateList  the sorted booked ISO dates the periods were merged from
 * @returns {{ start: string, end: string, count: number, splitFrom?: string, splitTo?: string }[]}
 *   `splitFrom`/`splitTo` carry the parent booking's start and end on every segment that is NOT the
 *   whole booking, so a renderer can say a lone 1 Jan continues from 28 Dec.
 */
export function splitAtYearEnd(periods, dateList) {
    const dates = Array.isArray(dateList) ? dateList : [];
    /** @type {{ start: string, end: string, count: number, splitFrom?: string, splitTo?: string }[]} */
    const out = [];
    for (const p of periods || []) {
        if (!p || typeof p.start !== 'string' || typeof p.end !== 'string') continue;
        const inRange = dates.filter(d => d >= p.start && d <= p.end);
        if (p.start.slice(0, 4) === p.end.slice(0, 4) || inRange.length === 0) { out.push(p); continue; }
        // Walk the booked dates and cut wherever the year changes.
        let segStart = inRange[0];
        let prev = inRange[0];
        let n = 1;
        for (let i = 1; i < inRange.length; i++) {
            const d = inRange[i];
            if (d.slice(0, 4) !== prev.slice(0, 4)) {
                out.push({ start: segStart, end: prev, count: n, splitFrom: p.start, splitTo: p.end });
                segStart = d; n = 0;
            }
            prev = d; n++;
        }
        out.push({ start: segStart, end: prev, count: n, splitFrom: p.start, splitTo: p.end });
    }
    return out;
}

/**
 * The years this member has bookings in, ascending.
 *
 * Keyed on each segment's START — which, after `splitAtYearEnd`, is also every date's own year:
 * no segment crosses a year end, so the set of start years IS the set of years with leave in them.
 *
 * @param {{ start: string }[]} periods  year-bounded segments, each with an ISO `start`
 * @returns {string[]} four-digit years, ascending, no duplicates
 */
export function bookedYears(periods) {
    const seen = new Set();
    for (const p of periods || []) {
        if (p && typeof p.start === 'string' && p.start.length >= 4) seen.add(p.start.slice(0, 4));
    }
    return [...seen].sort();
}

/**
 * Which year the list should show.
 *
 * The precedence is the point, and each rung answers a different question:
 *   1. `pinned`    — the reader tapped a year chip. An explicit choice outranks anything inferred,
 *                    and it is dropped on a member change by the caller, never here.
 *   2. `preferred` — the year the rest of the card is talking about (the AL banner's year, which
 *                    follows the date picker). Landing on the year you are already working in is
 *                    the difference between a selector you never touch and one you always do.
 *   3. the most recent year with data — for a member whose bookings are all in the past, where
 *                    both of the above name a year that is simply not there.
 *
 * A year is only ever returned if `years` contains it. That is the whole safety property: every
 * other outcome renders an empty list, and an empty list on this card reads as "nothing booked".
 *
 * @param {{ pinned?: string|null, preferred?: string|null, years: string[] }} o
 * @returns {string|null} a year present in `years`, or null if there are none
 */
export function pickBookedYear({ pinned, preferred, years }) {
    const has = /** @param {any} y */ y => typeof y === 'string' && years.includes(y);
    if (has(pinned))    return /** @type {string} */ (pinned);
    if (has(preferred)) return /** @type {string} */ (preferred);
    return years.length ? years[years.length - 1] : null;
}


/**
 * Build the renderer. Every handle it needs is INJECTED — this module imports only leave-year.js, and
 * for `periodDelete` the delete-set builder (override-utils.js) and the Christmas closure rule
 * (christmas-leave.js), none of which reaches a DOM or Firebase — so the whole of it is tested in Node.
 *
 * @param {{
 *   doc: Document,
 *   getEntries: (memberName: string, type: string) => any[],
 *   hasAuthority: (memberName: string) => boolean,
 *   memberFor: (name: string) => any,
 *   isSunday: (iso: string) => boolean,
 *   mergePeriods: (dates: string[], isRestGap: (d: string) => boolean, addDay: (d: string) => string) => any[],
 *   isRestGap: (iso: string, memberObj: any, ovByDate?: Map<string, any>|null) => boolean,
 *   addDays: (iso: string, n: number) => string,
 *   monthAbb: string[],
 *   memberDateMap?: (name: string) => Map<string, any>,
 *   fmtDate: (iso: string) => string,
 *   fmtRange: (start: string, end: string) => string,
 *   onDelete: (type: string, memberName: string, start: string, end: string, feedbackEl: any, btn: any,
 *              listedCount: number, ask: { resume: ((atPress: any) => void), atPress?: any }) => (void | 'asked' | Promise<void | 'asked'>),
 *   onRendered?: (boxId: string) => void,
 * }} deps
 */
export function createBookedPeriods(deps) {
    /** Pinned year per box id — an explicit tap, cleared when the member changes. @type {Record<string,string|null>} */
    const pinned = {};

    /** Forget every pinned choice. The caller does this on a member change: a year the LAST person
     *  had bookings in is not a choice the reader made about THIS one. */
    function resetPinned() { for (const k of Object.keys(pinned)) delete pinned[k]; }

    /**
     * `consumes` is optional and per-list: the predicate deciding whether a recorded date actually
     * counts as a day. The AL card passes `consumesEntitlement` so the list and the banner answer
     * with one rule; omit it and every non-Sunday recorded date is listed, which is what the
     * absence card still does.
     *
     * `listed` (optional) is which recorded dates are SHOWN when that differs from which are counted:
     * a Spare day past its week's four is leave the member is on, and costs nothing (owner, 21 Nov
     * 2026), so it is listed in its period while the period's pill counts only what is charged.
     *
     * @param {{ type: string, memberName: string, boxId: string, bodyId: string,
     *           consumes?: (memberObj: any, dateStr: string, ovByDate: Map<string, any>|null) => boolean,
     *           listed?: (memberObj: any, dateStr: string, ovByDate: Map<string, any>|null) => boolean,
     *           countFn: (n: number) => string, countClass: string, feedbackId: string,
     *           preferredYear?: string|null, christmas?: Record<string, string[]>,
     *           christmasFor?: (year: string) => string[] }} cfg
     */
    function render(cfg) {
        const { type, memberName, boxId, bodyId, countFn, countClass, feedbackId } = cfg;
        const box  = deps.doc.getElementById(boxId);
        const body = deps.doc.getElementById(bodyId);
        if (!box || !body) return;
        const hide = () => { /** @type {any} */ (box).hidden = true; };

        if (!memberName) return hide();
        // NOT READ IS NOT NOTHING BOOKED (v23.08). An unread member also falls through the empty
        // exits below, so on that path this changes no pixel — but a CAPPED all-staff read leaves
        // some of their rows in the cache and would present a partial history as the whole of it.
        if (!deps.hasAuthority(memberName)) return hide();

        // CHRISTMAS LEAVE (v25.37, owner 5 Nov 2026) — year → the member's Christmas leave dates, which
        // the owner asked to be RECORDED here. Derived from the roster, never stored, never counted
        // (christmas-leave.js → christmasLeaveByYear), so it is a row of its own and a year it falls in
        // is a year with something to show even when nothing else was booked.
        //
        // A YEAR ALREADY ON SCREEN SHOWS ITS CHRISTMAS (6 Nov 2026 review). `christmas` stops at this
        // calendar year, so that no LATER year grows a chip from Christmas alone. But a later year on
        // screen anyway — it has bookings, or the reader asked for it (a chip, or the Calendar's
        // "Leave dates" link from 25 Dec 2027, which pins it) — showed its list without the Christmas
        // row the Calendar shows, and a link to a year holding only Christmas fell back to another
        // year. `christmasFor` answers for exactly those years and no others.
        const xmas = { ...(cfg.christmas || {}) };
        const addXmas = (/** @type {string|null|undefined} */ y) => {
            if (!cfg.christmasFor || !y || !/^\d{4}$/.test(y) || y in xmas) return;
            const dates = cfg.christmasFor(y);
            if (dates.length) xmas[y] = dates;
        };
        addXmas(pinned[boxId]);
        const hasXmas = Object.keys(xmas).length > 0;
        const entries = deps.getEntries(memberName, type);
        if (!entries.length && !hasXmas) return hide();

        const memberObj = deps.memberFor(memberName);
        // WHAT THE LIST COUNTS MUST BE WHAT THE ENTITLEMENT COUNTS (v23.72). This filtered Sundays
        // and nothing else, so a day the member was not contracted to work — a REST DAY carrying an
        // AL override — was listed and counted, while `consumesEntitlement` (which the AL banner
        // above it uses) correctly ignored it. One card, two disagreeing counts of the same thing:
        // one member's chips summed to 33 against a banner reading 32 of 32, and their December period
        // began a day before their leave did. Reported by the owner from the roster office's own
        // spreadsheet, which agreed with the banner.
        //
        // `cfg.consumes` is the ENTITLEMENT rule itself, injected rather than re-derived, so the two
        // can no longer drift. It is per-list because the question is not the same for both: for
        // annual leave it is "does this day spend entitlement", and the absence list has no
        // entitlement to spend — so that list passes no predicate and is unchanged here.
        //
        // The map is built ONCE per render. `consumesEntitlement` needs it to read `replacedType`,
        // which is the only surviving record of what an AL doc replaced — without it a swapped-in
        // day reads as a rest day and would be filtered out of a list it belongs in. The MERGE reads it
        // too: a rest day the member WORKED splits two runs of leave (review, Nov 2026). The ✕'s reach
        // below does not — it walks out over the rest days the booking itself spanned, worked since or not.
        const ovByDate  = deps.memberDateMap ? deps.memberDateMap(memberName) : null;
        const shows     = cfg.listed ?? cfg.consumes;
        const dateList  = [...new Set(entries.map(e => e.date))]
            .filter(d => !deps.isSunday(d))
            .filter(d => !shows || shows(memberObj, d, ovByDate))
            .sort();
        // What each period's pill COUNTS, when that is fewer than it lists — a Spare week's fifth and
        // sixth days (owner, 21 Nov 2026). Null when everything listed is counted, as before.
        const charged = cfg.listed && cfg.consumes
            ? new Set(dateList.filter(d => /** @type {any} */ (cfg.consumes)(memberObj, d, ovByDate))) : null;
        if (!dateList.length && !hasXmas) return hide();
        const periods = dateList.length ? deps.mergePeriods(dateList,
            d => deps.isRestGap(d, memberObj, ovByDate), d => deps.addDays(d, 1)) : [];

        // A ROW'S ✕ ALSO TAKES THE UNCOUNTED LEAVE AT ITS EDGES (whole-app check, 10 Nov 2026). Leave
        // on a rest day costs nothing, so it is not listed — and the ✕ deletes from its first listed
        // date to its last, which removes such a day INSIDE a period but left one at either END: a
        // pre-v23.88 week-grid booking of Mon–Thu plus the Friday and Saturday rest days deleted as
        // "4 AL days" and kept 🏖️ on the Friday and Saturday, with no row left to remove them from.
        // The reach walks out through rest days only, and stops at a Sunday and at the year end, so a
        // delete never widens past the week or the year its row is in — and at Christmas Day and Boxing
        // Day, whose stored leave is the Christmas row's to delete (`periodDelete`, review Nov 2026).
        const counted   = new Set(dateList);
        const uncounted = new Set(entries.map(e => e.date).filter(d => !counted.has(d)));
        const reach = (/** @param {string} edge @param {number} dir */ (edge, dir) => {
            let out = edge;
            for (let d = deps.addDays(edge, dir), i = 0; i < 6 && d.slice(0, 4) === edge.slice(0, 4)
                && !deps.isSunday(d) && !isChristmasClosureDate(d) && deps.isRestGap(d, memberObj); d = deps.addDays(d, dir), i++) {
                if (uncounted.has(d)) out = d;
            }
            return out;
        });
        /** Which counted dates come out of ANOTHER year's allowance — a January day moved back (v25.18). */
        const winnerOn = new Map(entries.map(e => [e.date, e]));
        const movedTo  = (/** @type {string} */ d) => carriedFrom(winnerOn.get(d), d);
        /** Does a listed day cost a day? Every listed day does, unless the list shows days it does not count. */
        const costs    = (/** @type {string} */ d) => !charged || charged.has(d);

        // Cut at every year end FIRST, so a 28 Dec → 1 Jan booking puts its January day under
        // January's year — the owner's decision at v23.11, argued in the header.
        const segments = splitAtYearEnd(periods, dateList);
        for (const y of bookedYears(segments)) addXmas(y);
        const years = [...new Set([...bookedYears(segments), ...Object.keys(xmas)])].sort();
        const year  = pickBookedYear({ pinned: pinned[boxId], preferred: cfg.preferredYear, years });
        if (!year) return hide();

        const shown = segments.filter(p => p.start.slice(0, 4) === year);
        /** @type {Record<string, any[]>} */ const byMonth = {};
        for (const p of shown) (byMonth[p.start.slice(0, 7)] = byMonth[p.start.slice(0, 7)] || []).push(p);
        const xmasDates = xmas[year] || [];
        const xmasKey = `${year}-12`;
        if (xmasDates.length && !byMonth[xmasKey]) byMonth[xmasKey] = [];
        /** The Christmas leave row, in date order inside December: listed so it is on record, and
         *  outside every count. Mostly nothing is stored to delete; it comes from the roster.
         *
         *  UNLESS A LEAVE RECORD IS STORED ON ONE OF ITS DAYS (6 Nov 2026 review) — one booked before
         *  v25.37, or a swapped day. The ordinary list leaves that date out (it costs nothing, so
         *  `consumes` says no) and this row had no ✕, so the record could not be deleted from the
         *  list at all; the week grid and Saved Changes were the only ways. It now carries the same
         *  two-tap ✕ as every other row, for the stored days only: what the roster gives is not
         *  stored, and deleting the record leaves it as it was.
         *
         *  LAID OUT LIKE EVERY OTHER ROW (v25.38, owner: it "doesn't look aesthetically right compared
         *  to the rest of the table"). v25.37 put a 🎄 before the dates and a "Not counted" pill where
         *  the count goes; the pill was 35px wider than a day pill, so at 375px it pushed the range onto
         *  two lines and stood out of the pill column, and the tree moved the dates off the edge every
         *  other row's dates share. Now the dates are the dates, the pill is the same day count in the
         *  same column, and what is different is said on a quiet second line — 🎄 Not counted.
         *  The pill is the leave colour HOLLOW rather than filled: leave on record, nothing
         *  taken from the allowance. */
        const christmasRow = () => {
            const row = deps.doc.createElement('div');
            row.className = 'al-period-row al-period-row--christmas';
            const dates = deps.doc.createElement('span');
            dates.className = 'al-period-dates';
            const first = xmasDates[0], last = xmasDates[xmasDates.length - 1];
            dates.textContent = first === last ? deps.fmtDate(first) : deps.fmtRange(first, last);
            const note = deps.doc.createElement('span');
            note.className = 'al-period-note';
            const glyph = deps.doc.createElement('span');
            glyph.setAttribute('aria-hidden', 'true');
            glyph.textContent = '🎄 ';
            // "🎄 Not counted" on screen: the tree and the 25–26 December dates already say
            // Christmas, and "Christmas · not counted" wrapped to a third line at 360px. A screen
            // reader, which hears no tree, is told.
            const said = deps.doc.createElement('span');
            said.className = 'visually-hidden';
            said.textContent = 'Christmas leave, ';
            note.append(glyph, said, 'Not counted');
            dates.appendChild(note);
            const free = deps.doc.createElement('span');
            free.className = 'al-period-free';
            free.textContent = countFn(xmasDates.length);
            row.append(dates, free);
            const stored = xmasDates.filter(d => storedDates.has(d));
            if (stored.length) {
                const s0 = stored[0], s1 = stored[stored.length - 1];
                row.appendChild(deleteButton(`the leave recorded on ${s0 === s1 ? deps.fmtDate(s0) : deps.fmtRange(s0, s1)}`,
                    s0, s1, stored.length));
            }
            return row;
        };
        /** Dates holding a stored record of this type — what the Christmas row may delete. */
        const storedDates = new Set(entries.map(e => e.date));
        /**
         * The two-tap ✕ every row that deletes ends with — one control, so the Christmas row's
         * cannot behave differently from its neighbours'.
         * @param {string} what what it deletes, in words — its name
         * @param {string} start first date it deletes, inclusive
         * @param {string} end last date it deletes, inclusive
         * @param {number} count how many days the row showed, for the confirmation
         */
        const deleteButton = (what, start, end, count) => {
            const btn = deps.doc.createElement('button');
            btn.type      = 'button';
            btn.className = 'btn-period-delete';
            // THIS MODULE OWNS EVERY STATE OF THE CONTROL — idle, confirming, and back again
            // after the delete has run, whatever it did. The first cut left the "back again" to
            // the coordinator, which restored the label it remembered: the WORD "Delete", into
            // a 44px square built for a glyph, with the aria-label still saying "Confirm". On
            // a successful delete the row is gone before anyone can see it; on a refused or
            // failed one it stays, and that is the row the admin is looking at.
            //
            // NAMED BY WHAT IT DELETES. Fifteen buttons all called "Delete" are fifteen
            // identical announcements with nothing to choose between them, and the glyph alone
            // has no name at all.
            btn.textContent = '✕';
            btn.setAttribute('aria-label', `Delete ${what}`);
            /** One run of the delete: from the confirming tap, or — `atPress` given — from "Save anyway" on the
             *  over-allowance question it asked (`'asked'`), carrying what was on screen at the tap.
             *  @param {any} [atPress] */
            const run = (atPress) => {
                // FOCUS IS HANDED ON, NOT DROPPED (whole-app check, 10 Nov 2026). A delete that lands
                // re-renders the list and destroys this control — and a focused element that is
                // removed hands focus to <body>, so a keyboard user's next Tab began at the burger.
                // From "Save anyway", which had focus and goes with the bar, focus follows the delete.
                const hadFocus = !!atPress || deps.doc.activeElement === btn;
                const pos = [...body.querySelectorAll('.btn-period-delete')].indexOf(btn);
                // Whatever the delete does — succeeds, is refused, throws, asks — the control comes
                // back to idle. On success the box has already re-rendered and this node is
                // detached, which is harmless; on every other path it is the node on screen.
                Promise.resolve(deps.onDelete(type, memberName, start, end, feedbackEl, btn, count, { resume: run, atPress }))
                    .catch(() => {})
                    .then((outcome) => {
                        disarmConfirm(btn, '✕');
                        // It ASKED (the over-allowance bar): focus is the bar's now, and its Cancel hands it back.
                        if (outcome === 'asked' || !hadFocus) return;
                        // Still here (refused, or failed): back to this ✕. Gone: the ✕ now in its
                        // place, the year chip, or — the list emptied and hid — the line saying why.
                        if (!box.hidden && body.contains(btn)) { btn.focus(); return; }
                        const left = box.hidden ? [] : [...body.querySelectorAll('.btn-period-delete')];
                        /** @type {any} */ (left[Math.min(pos, left.length - 1)]
                            ?? (box.hidden ? null : body.querySelector('.al-year-chip.is-active'))
                            ?? deps.doc.getElementById(feedbackId))?.focus();
                    });
            };
            btn.addEventListener('click', () => {
                if (!twoTap(btn, 'Delete?', '✕')) return;   // arms, or the same gesture's second tap
                run();
            });
            return btn;
        };

        // A CHIP ACTIVATED FROM THE KEYBOARD MUST STILL BE FOCUSED AFTERWARDS. The re-render below
        // destroys every node, and a focused element that is removed hands focus to <body> — so
        // Enter on a chip would land a keyboard user back at the top of the page with no way to
        // tell which year they had just chosen. Remembered here, restored at the end.
        const active = deps.doc.activeElement;
        const refocusChip = !!(active && body.contains(active) && active.classList?.contains('al-year-chip'));

        body.innerHTML = '';

        // YEAR CHIPS — only years that HAVE bookings, so a chip can never lead to an empty list.
        // Rendered even when there is one, because it is what tells the reader which year the
        // months below belong to: the month headers no longer repeat it fifteen times.
        const bar = deps.doc.createElement('div');
        bar.className = 'al-year-bar';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Year');
        for (const y of years) {
            const chip = deps.doc.createElement('button');
            chip.type      = 'button';
            chip.className = 'al-year-chip' + (y === year ? ' is-active' : '');
            chip.textContent = y;
            chip.setAttribute('aria-pressed', String(y === year));
            chip.addEventListener('click', () => { pinned[boxId] = y; render(cfg); });
            bar.appendChild(chip);
        }
        body.appendChild(bar);

        const feedbackEl = deps.doc.getElementById(feedbackId);
        for (const key of Object.keys(byMonth).sort()) {
            const monthDiv = deps.doc.createElement('div');
            monthDiv.className = 'al-period-month';
            // The month alone — the chip above owns the year. Repeating it on every header was
            // fifteen copies of the one fact the card had no way to change.
            const hdr = deps.doc.createElement('div');
            hdr.className = 'al-period-month-hdr';
            hdr.textContent = deps.monthAbb[parseInt(key.slice(5, 7), 10) - 1];
            monthDiv.appendChild(hdr);

            let xmasPending = key === xmasKey && xmasDates.length > 0;
            for (const p of byMonth[key]) {
                if (xmasPending && xmasDates[0] < p.start) { monthDiv.appendChild(christmasRow()); xmasPending = false; }
                const dateStr = p.start === p.end ? deps.fmtDate(p.start) : deps.fmtRange(p.start, p.end);
                const row = deps.doc.createElement('div');
                row.className = 'al-period-row';

                const dates = deps.doc.createElement('span');
                dates.className = 'al-period-dates';
                dates.textContent = dateStr;
                // A segment of a booking that crossed the year end says so — a lone "Fri 1 Jan"
                // otherwise reads as a one-day booking somebody made, rather than the tail of the
                // Christmas week. The VISIBLE marker is an arrow — leading for a segment continued
                // from the previous year, trailing for one that continues into the next — because
                // the sentence ("continued from previous year") measured 66px against a 46px row
                // at 375px: it wrapped the pill and the delete control onto a second line. The
                // sentence, with the actual date, is kept for screen readers.
                if (p.splitFrom && p.splitTo) {
                    const isHead = p.start === p.splitFrom;
                    const isTail = p.end === p.splitTo;
                    /** @param {'before'|'after'} where @param {string} arrow @param {string} phrase */
                    const mark = (where, arrow, phrase) => {
                        const cont = deps.doc.createElement('span');
                        cont.className = 'al-period-cont';
                        const glyph = deps.doc.createElement('span');
                        glyph.setAttribute('aria-hidden', 'true');
                        glyph.textContent = arrow;
                        const said = deps.doc.createElement('span');
                        said.className = 'visually-hidden';
                        said.textContent = ` ${phrase}`;
                        cont.append(glyph, said);
                        if (where === 'before') dates.prepend(cont); else dates.appendChild(cont);
                    };
                    // WITH THE YEAR (v23.16, external review): the active chip gives a sighted
                    // reader the year, but a screen-reader user tabbing straight to the row's ✕
                    // hears "continued from Mon 28 Dec" with no year in earshot. `fmtDate` omits it
                    // on purpose for the visible column; the hidden phrase is the one place it costs
                    // nothing to say.
                    if (!isHead) mark('before', '←', `continued from ${deps.fmtDate(p.splitFrom)} ${p.splitFrom.slice(0, 4)}`);
                    if (!isTail) mark('after',  '→', `continues to ${deps.fmtDate(p.splitTo)} ${p.splitTo.slice(0, 4)}`);
                }
                // A January day moved to the previous year's allowance is listed here, under its
                // own date, and counted on the banner the year before — so the row says so (header).
                // …while it is CHARGED (external review of v26.55): a moved day a Spare week's four has since made free
                // keeps its stored year, but comes out of no allowance, so it is not said to.
                const moved = dateList.filter(d => d >= p.start && d <= p.end && movedTo(d) !== null && costs(d));
                if (moved.length) {
                    const note = deps.doc.createElement('span');
                    note.className = 'al-period-note';
                    note.textContent = `${moved.length === 1 ? '1 day' : `${moved.length} days`} from ${movedTo(moved[0])}’s allowance`;
                    dates.appendChild(note);
                }
                // A SPARE WEEK USES AT MOST FOUR (owner, 21 Nov 2026): the days past it are listed,
                // since the member is off, and the row says why the pill counts fewer.
                const inRow = dateList.filter(d => d >= p.start && d <= p.end);
                const chargedHere = charged ? inRow.filter(d => charged.has(d)).length : p.count;
                const uncharged = charged ? inRow.length - chargedHere : 0;
                if (uncharged > 0) {
                    const note = deps.doc.createElement('span');
                    note.className = 'al-period-note';
                    note.textContent = `${uncharged === 1 ? '1 Spare day' : `${uncharged} Spare days`} not counted — a Spare week uses at most 4`;
                    dates.appendChild(note);
                }
                row.appendChild(dates);

                const count = deps.doc.createElement('span');
                count.className = countClass;
                count.textContent = countFn(chargedHere);
                row.appendChild(count);

                row.appendChild(deleteButton(dateStr, reach(p.start, -1), reach(p.end, 1), p.count));
                monthDiv.appendChild(row);
            }
            if (xmasPending) monthDiv.appendChild(christmasRow());
            body.appendChild(monthDiv);
        }
        // …and the year those days come out of names them, since its own list cannot show them.
        const next = String(Number(year) + 1);
        const lent = dateList.filter(d => d.startsWith(`${next}-01-`) && movedTo(d) === Number(year) && costs(d)).length;
        if (lent) {
            const foot = deps.doc.createElement('p');
            foot.className = 'ly-note';
            foot.textContent = `Also from ${year}’s allowance: ${lent === 1 ? '1 day' : `${lent} days`} in January ${next}, listed under ${next}.`;
            body.appendChild(foot);
        }
        if (refocusChip) /** @type {any} */ (bar.querySelector('.al-year-chip.is-active'))?.focus();
        /** @type {any} */ (box).hidden = false;
        // The box now has a height for the first time, which is the one moment a deep link can
        // land on it. No-op unless somebody arrived by one.
        deps.onRendered?.(boxId);
    }

    /** Choose a box's year as if its chip had been tapped — the Calendar's "View recorded leave"
     *  link names one (v24.46). Safe with any value: `pickBookedYear` ignores a pinned year the
     *  member has no bookings in, so a link can never open an empty list.
     *  @param {string} boxId @param {string} year */
    function pin(boxId, year) { pinned[boxId] = year; }

    return { render, resetPinned, pin };
}
