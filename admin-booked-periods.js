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
 * The consequence worth stating: each year's list now adds up to exactly the dates the AL banner
 * counts for that year, because both cut on the DATE. There is still no total printed here —
 * the banner directly above owns the figures and this owns the dates, one fact one home — but the
 * two can no longer disagree, which the start-year rule could not promise.
 *
 * ── WHAT THE PURE HALF IS FOR ───────────────────────────────────────────────────────────────────
 *
 * `bookedYears` and `pickBookedYear` are the whole decision, and they are separated because the way
 * to get this wrong is silent: show a year with nothing in it and the card reads as "no leave
 * recorded" — the same false statement v23.08 fixed one layer up, arrived at from a different
 * direction. `pickBookedYear` may therefore only ever return a year that is IN the list it was
 * handed, or null when the list is empty.
 */

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
 * Build the renderer. Every handle it needs is INJECTED — this module imports nothing, which is
 * what lets the two pure functions above be tested in Node with no DOM and no Firebase.
 *
 * @param {{
 *   doc: Document,
 *   getEntries: (memberName: string, type: string) => any[],
 *   hasAuthority: (memberName: string) => boolean,
 *   memberFor: (name: string) => any,
 *   isSunday: (iso: string) => boolean,
 *   mergePeriods: (dates: string[], isRestGap: (d: string) => boolean, addDay: (d: string) => string) => any[],
 *   isRestGap: (iso: string, memberObj: any) => boolean,
 *   addDays: (iso: string, n: number) => string,
 *   monthAbb: string[],
 *   fmtDate: (iso: string) => string,
 *   fmtRange: (start: string, end: string) => string,
 *   onDelete: (type: string, memberName: string, start: string, end: string, feedbackEl: any, btn: any) => (void | Promise<void>),
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
     * @param {{ type: string, memberName: string, boxId: string, bodyId: string,
     *           countFn: (n: number) => string, countClass: string, feedbackId: string,
     *           preferredYear?: string|null }} cfg
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

        const entries = deps.getEntries(memberName, type);
        if (!entries.length) return hide();

        const memberObj = deps.memberFor(memberName);
        const dateList  = [...new Set(entries.map(e => e.date))].filter(d => !deps.isSunday(d)).sort();
        if (!dateList.length) return hide();
        const periods = deps.mergePeriods(dateList,
            d => deps.isRestGap(d, memberObj), d => deps.addDays(d, 1));

        // Cut at every year end FIRST, so a 28 Dec → 1 Jan booking puts its January day under
        // January's year — the owner's decision at v23.11, argued in the header.
        const segments = splitAtYearEnd(periods, dateList);
        const years = bookedYears(segments);
        const year  = pickBookedYear({ pinned: pinned[boxId], preferred: cfg.preferredYear, years });
        if (!year) return hide();

        const shown = segments.filter(p => p.start.slice(0, 4) === year);
        /** @type {Record<string, any[]>} */ const byMonth = {};
        for (const p of shown) (byMonth[p.start.slice(0, 7)] = byMonth[p.start.slice(0, 7)] || []).push(p);

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

            for (const p of byMonth[key]) {
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
                row.appendChild(dates);

                const count = deps.doc.createElement('span');
                count.className = countClass;
                count.textContent = countFn(p.count);
                row.appendChild(count);

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
                const idle = () => {
                    btn.classList.remove('confirming');
                    btn.textContent = '✕';
                    btn.setAttribute('aria-label', `Delete ${dateStr}`);
                };
                idle();
                btn.addEventListener('click', () => {
                    if (!btn.classList.contains('confirming')) {
                        btn.classList.add('confirming');
                        btn.textContent = 'Confirm?';
                        btn.setAttribute('aria-label', `Confirm delete ${dateStr}`);
                        setTimeout(() => { if (btn.classList.contains('confirming')) idle(); }, 5000);
                        return;
                    }
                    // Whatever the delete does — succeeds, is refused, throws — the control comes
                    // back to idle. On success the box has already re-rendered and this node is
                    // detached, which is harmless; on every other path it is the node on screen.
                    Promise.resolve(deps.onDelete(type, memberName, p.start, p.end, feedbackEl, btn))
                        .catch(() => {})
                        .finally(idle);
                });
                row.appendChild(btn);
                monthDiv.appendChild(row);
            }
            body.appendChild(monthDiv);
        }
        if (refocusChip) /** @type {any} */ (bar.querySelector('.al-year-chip.is-active'))?.focus();
        /** @type {any} */ (box).hidden = false;
        // The box now has a height for the first time, which is the one moment a deep link can
        // land on it. No-op unless somebody arrived by one.
        deps.onRendered?.(boxId);
    }

    return { render, resetPinned };
}
