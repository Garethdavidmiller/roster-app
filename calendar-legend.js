// @ts-check
/**
 * calendar-legend.js — WHICH KEYS THE MONTH LEGEND SHOWS, AND WHETHER IT SHOWS AT ALL.
 *
 * Left `calendar-app.js` at v23.70, when that coordinator stood FIVE lines under its ratchet cap —
 * the most saturated file in the repo, and the one where the next fix would have had to buy its own
 * room first, under whatever pressure that fix arrived with.
 *
 * It is a good thing to lift out rather than a convenient one. The legend is a KEY to the grid, so
 * it answers two questions that are easy to confuse and have different consequences:
 *
 *   · WHICH ITEMS apply to this member in this month — `legendVisibility`. Getting this wrong shows
 *     a key for a symbol that is not on the grid, or hides one that is. Visible, and merely untidy.
 *   · WHETHER THE LEGEND APPLIES AT ALL — `legendShown`. Getting this wrong is the one that misleads:
 *     with a month WITHHELD the grid is not being shown, and a legend derived from the BASE roster
 *     would go on announcing this month's shift types beside a panel saying we do not yet know them.
 *     A key to a grid that is not there is a statement about data we have not got.
 *
 * ── THE RULE THAT MOVED WITH IT, AND MUST NOT MOVE AGAIN ────────────────────────────────────────
 *
 * The shown/hidden decision belongs to the legend UPDATE, not to a render. v20.40 put it in
 * `renderCalendar` and it was wrong in both directions, because a swipe COMMIT calls the legend
 * update and never `renderCalendar` — the incoming carousel panel simply becomes the live view. So
 * swiping from a withheld month onto a good one left the legend hidden until some later full
 * render, and swiping onto an unfetched one left it up over the wait panel. The legend update is
 * the one function every navigation path calls, which is what makes it the choke point — the same
 * argument that put the grid gate in `buildCalendarContainer`. `e2e/calendar.spec.js` pins the
 * swipe case; the pure rules here are pinned by `calendar-legend.test.mjs`.
 *
 * **Team View owns the legend while it is active** (`applyTeamViewChrome` hides it), so this stands
 * down rather than fighting it. Leaving Team View calls `renderCalendar`, which comes back through
 * here and settles the real answer.
 *
 * ── WHAT AN EDIT CAN SILENTLY BREAK ─────────────────────────────────────────────────────────────
 *
 * 1. **Row 2 is shown when ANY of its five items is** — it is their container, so a sixth item added
 *    to the row and not to that test leaves the row collapsed over a key that is present.
 * 2. **Easter is not a fixed month.** It falls in March or April, so the month is computed per year
 *    and compared; hardcoding April hides the key in a March Easter year (2024, 2027).
 * 3. **`legendShown` is asked about KNOWLEDGE, not about data.** `'stale'` still shows — a cached
 *    month is a grid, and a grid gets its key. Only a withheld month hides it.
 * 4. Every collaborator is INJECTED. This module imports NOTHING, which is what lets the two rules
 *    be tested in Node with no DOM and no Firebase — and importing `calendar-state.js` or
 *    `calendar-overrides.js` back would also be a cycle.
 */

/**
 * Which conditional legend items apply. PURE — no DOM, no reads.
 *
 * @param {object} ctx
 * @param {Set<string>} ctx.types        shift types present in the displayed month
 * @param {boolean} ctx.isDispatcher     dispatchers are the only grade that works nights
 * @param {number} ctx.displayMonth      0-11
 * @param {number} ctx.easterMonth       0-11 — the month Easter Sunday falls in THIS year
 * @returns {Record<string, boolean>} element id → visible
 */
export function legendVisibility({ types, isDispatcher, displayMonth, easterMonth }) {
    const has = (/** @type {string} */ t) => !!types && types.has(t);
    // The five that share row 2. Named once, so the row's own test below cannot fall out of step
    // with them — that is rule 1, and a sixth item added here joins the container automatically.
    const rowTwo = {
        'legend-spare': has('SPARE'),
        'legend-rdw':   has('RDW'),
        'legend-al':    has('AL'),
        'legend-sick':  has('SICK'),
        'legend-other': has('OTHER'),
    };
    return {
        ...rowTwo,
        'legend-row-2':     Object.values(rowTwo).some(Boolean),
        'legend-night':     !!isDispatcher,
        'legend-christmas': displayMonth === 11,
        // Rule 2: Easter moves between March and April, so this is a comparison and never a literal.
        'legend-easter':    displayMonth === easterMonth,
    };
}

/**
 * Is the legend shown at all? PURE, and THREE answers rather than two.
 *
 * `'stand-down'` is not a synonym for `'hide'`, and collapsing the two is the easiest mistake here
 * to make and the hardest to see. Team View owns the legend while it is active, so the correct
 * behaviour is to WRITE NOTHING — not to write `none` and happen to agree with it. Writing `none`
 * looks identical today, because `applyTeamViewChrome` hides it anyway; it stops being identical the
 * moment Team View wants its own legend, and then this module is silently fighting the owner of
 * the element. Leaving Team View calls `renderCalendar`, which comes back through here and settles
 * the real answer.
 *
 * @param {string} display   the `decideDisplay` verdict for the displayed month
 * @param {boolean} isTeamViewMode  Team View owns the legend while it is active
 * @returns {'render'|'hide'|'stand-down'}
 */
export function legendShown(display, isTeamViewMode) {
    if (isTeamViewMode) return 'stand-down';
    // Rule 3: a cached month is still a grid, and a grid gets its key.
    return (display === 'render' || display === 'stale') ? 'render' : 'hide';
}

/**
 * Wire the legend. Every collaborator is injected — see rule 4.
 *
 * @param {object} deps
 * @param {() => any} deps.getCurrentMember
 * @param {(member: any, year: number, month: number) => Set<string>} deps.getShiftTypesInMonth
 * @param {() => number} deps.getDisplayYear
 * @param {() => number} deps.getDisplayMonth
 * @param {(year: number) => Date} deps.computeEaster
 * @param {() => string} deps.displayVerdict   `decideDisplay(knowledgeOf(monthKey(...)))`
 * @param {() => boolean} deps.isTeamViewMode
 * @returns {{ update: () => void }}
 */
export function createLegend(deps) {
    const byId = (/** @type {string} */ id) => document.getElementById(id);

    function update() {
        const member = deps.getCurrentMember();
        const types = member
            ? deps.getShiftTypesInMonth(member, deps.getDisplayYear(), deps.getDisplayMonth())
            : new Set();

        const visible = legendVisibility({
            types,
            isDispatcher: !!member && member.rosterType === 'dispatcher',
            displayMonth: deps.getDisplayMonth(),
            easterMonth: deps.computeEaster(deps.getDisplayYear()).getMonth(),
        });
        for (const [id, on] of Object.entries(visible)) {
            const elem = byId(id);
            if (elem) elem.style.display = on ? '' : 'none';
        }

        const shown = legendShown(deps.displayVerdict(), deps.isTeamViewMode());
        if (shown === 'stand-down') return;                 // Team View owns it — write NOTHING.
        const legendEl = /** @type {HTMLElement|null} */ (document.querySelector('.legend'));
        if (legendEl) legendEl.style.display = shown === 'render' ? '' : 'none';
    }

    return { update };
}
