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
 * ── THE BOX HOLDS NO FIGURES, AND THAT IS DELIBERATE ────────────────────────────────────────────
 *
 * There is no "31 days in 2026" total here, and it is not an oversight — it was drafted and cut.
 * The AL banner directly above already states entitlement, taken, booked and remaining, and it
 * counts by the year each DATE falls in. This list groups a period under the year it STARTS in,
 * because a booking is one thing a person made and splitting "Mon 28 Dec – Fri 1 Jan" across two
 * chips would misrepresent it. Those two rules disagree by exactly the days in a year-spanning
 * booking — so a total here would sit inches under the banner's total, differ from it by one or
 * two, and be right. The banner owns the figures; this owns the dates. One fact, one home.
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
 * The years this member has bookings in, ascending.
 *
 * Keyed on each period's START. A booking that runs 28 Dec → 1 Jan is one booking, made once, and
 * it belongs under the year the person started it — listing it twice, or under the year it happens
 * to finish in, would both be worse.
 *
 * @param {{ start: string }[]} periods  merged booking periods, each with an ISO `start`
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

        const years = bookedYears(periods);
        const year  = pickBookedYear({ pinned: pinned[boxId], preferred: cfg.preferredYear, years });
        if (!year) return hide();

        const shown = periods.filter(p => p.start.slice(0, 4) === year);
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
                row.appendChild(dates);

                const count = deps.doc.createElement('span');
                count.className = countClass;
                count.textContent = countFn(p.count);
                row.appendChild(count);

                const btn = deps.doc.createElement('button');
                btn.type      = 'button';
                btn.className = 'btn-period-delete';
                btn.title     = `Delete ${dateStr}`;
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
