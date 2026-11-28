// @ts-check
/**
 * links-selector-app.js — coordinator for links-selector.html, the Links Selector.
 *
 * Choose a shortlisted proposal and the week you would start on, and see your months as the Calendar shows them, with
 * the Calendar's swipe — or press 📆 Year for the proposal's whole year in twelve small months (buildSelectorYear),
 * ⚖️ Compare all for every proposal side by side, the same month from the same week, or 👤 Compare with mine for the
 * reader's own roster today beside the chosen proposal (buildSelectorTable). None of the three is ever where the page
 * opens by itself (owner, 28 Nov 2026: "not as the default view"): only its tab, or an address that asks for it
 * (`?view=year`, `?view=compare`, `?view=mine`), and this device never keeps one. The rules — which line a date falls on, blank days before the start, Christmas, what the address
 * and this device remember — are links-selector-core.js; the month is links-selector-render.js; this file wires the
 * page: the sign-in gate, the two pickers, the month buttons and swipe, and the day panel.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * The New CEA Link page's audience (owner: "Same as new link page"), open since 28 Nov 2026 after a beta for the admin
 * alone — one switch, `CONFIG.LINKS_SELECTOR_OPEN`, read by auth-policy.js for the page and its drawer pill together.
 *
 * ── WHAT IT NEVER DOES ─────────────────────────────────────────────────────────────────────────
 *
 * Read or write Firestore for the roster, or draw anybody's leave, absences or changed shifts (owner: "Leave out"). It
 * signs in like every page, so the error reporter and the usage count work as they do everywhere; nothing else is sent.
 */

import { SHARED_SCREEN } from './login-core.js';
import { MONTH_NAMES, shiftBadgeParts, escapeHtml, computeEaster, teamMembers, isOtherStaff } from './roster-data.js';
import { createLegend } from './calendar-legend.js';
import { initNavPanel } from './nav-panel.js';
import { sessionReady, reconcileExpiredIdentity } from './session.js';
import { signOutAndLeave, onReturnToPage } from './page-session.js';
import { startPage } from './page-start.js';
import { navGatesFor, rolesFor, selectorRoles } from './auth-policy.js';
import { createLightbox, openNoticeIfClear } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { markPageReady, clearLoginStart } from './perf-reporter.js';
import { enhanceSelect } from './select-sheet.js';
import { initSwipeHandler, isSwipeCooldown, isSwipeGestureActive } from './calendar-swipe.js';
import { rovingCellFor } from './calendar-renderer.js';
import { initCalendarTooltip, initCalendarKeyboard, initCalendarShortcuts } from './calendar-keyboard.js';
import { initMonthJump } from './calendar-month-jump.js';
import { lsGet, lsSet, lsAvailable } from './ls.js';
import { CARD_TIPS } from './links-selector-tips.js';
import { formatDayMonth, formatDayMonthYear, formatClock, printedStamp, DAY_NAMES_FULL } from './date-format.js';
import { proposalById, proposalDisplayName } from './link-designer-proposals.js';
import { buildSelectorMonth, buildSelectorTable, buildSelectorYear } from './links-selector-render.js';
import { FIRST_MONTH, LAST_MONTH, inRange, openingMonth, shiftTypesInMonth, shiftTypesInMonthAll, hasBlankDays, initialChoice, choiceQuery, lineOptions, proposalsAtoZ, startDate,
    lineOn, ignoredWords, refusalWords, rosterDayOn, isCoverLine, dayOn, shiftTypesInYear, MONTH_VIEW, YEAR_VIEW, COMPARE_VIEW, MINE_VIEW } from './links-selector-core.js';

/** New CEA Link, opened on one proposal's weeks: its `weeks` word (newlink-app.js → WEEKS_PARAM), then a sheet code. */
const NEWLINK_WEEKS = './newlink.html?weeks=';

/** Where this device keeps the last choice — a proposal code and a line, nothing about the person. */
export const STORE_KEY = 'myb_links_selector_choice';

/** Set once the ? panel has opened by itself on a first visit, so it does not open by itself again. */
export const WELCOME_KEY = 'myb_links_selector_welcome_seen';

/** How long after the session settles the first-visit panel waits: the notices' own delay (/new-notice → "Show delay"). */
const WELCOME_DELAY_MS = 1500;

/** What the page is and who it is for, on the sign-in card and on the card a colleague it is not for is shown. */
const ABOUT = Object.freeze({
    lines: Object.freeze([
        'A shortlisted proposal for the new CEA link, shown month by month as the Calendar shows your roster.',
        'Choose a proposal and the week you would start on.',
        'A proposal, not your roster: your own roster carries on as it is.',
    ]),
});

/** Coordinator body, invoked by links-selector-boot.js. Exported so a test can import without running. */
export function init() {
    registerServiceWorker();   // BEFORE the sign-in gate, as every page: a signed-out view must still take an update
    reconcileExpiredIdentity().catch(() => {});   // it handles and logs its own failures
    startPage({ page: 'selector', label: 'Links Selector', about: { ...ABOUT, footnote: SHARED_SCREEN }, refusalKeepsSession: true,
        run: (member) => start(member, true),
        refuse: (_decision, { member }) => start(/** @type {string} */ (member), false) });
}

/** @param {string} member @param {boolean} admitted */
function start(member, admitted) {
    /** @type {(() => void)|null} */
    let openAbout = null;
    initNavPanel({
        authReady: sessionReady,
        currentPage: 'selector',
        memberName: member,
        ...navGatesFor(member),
        onLogoClick: () => openAbout?.(),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    openAbout = initAboutLightbox({ appLabel: 'Marylebone Roster — Links Selector', getUserName: () => member })?.open ?? null;
    wireHeaderLogo();
    initTipsLightbox({});
    if (!admitted) {
        showNotForYou(member);
        markPageReady();
        clearLoginStart();
        return;
    }
    runSelector(member);
    markPageReady();
}

/** The one card a signed-in colleague the page is not (yet) for is shown — the app's refusal card. @param {string} member */
function showNotForYou(member) {
    const card = document.createElement('div');
    card.className = 'role-card';
    card.id = 'selectorNotForYou';
    // WHICH ANSWER IS TRUE is asked of the reader, not of the switch: would the page admit them once it opens
    // (`selectorRoles(true)`, the policy's own open list)? Asked of `CONFIG.LINKS_SELECTOR_OPEN`, a colleague on a
    // bilingual contract was told during the beta that it "isn't open to you yet" — a promise it will never keep.
    const roles = /** @type {Record<string, boolean>} */ (rolesFor(member));
    const { title, why, newlink } = refusalWords({ otherStaff: roles.otherStaff === true, inAudience: selectorRoles(true).some(r => roles[r] === true) });
    // The way to the proposals, worded as the About panel's own link to them (#selectorNewlinkLink), for the one reader
    // who may open that page. Its own line, so it never sits beside the way back.
    const toNewlink = newlink
        ? `<div><a href="./newlink.html" class="role-card-back" id="selectorNotForYouNewlink"><span aria-hidden="true">🔁</span> Compare the proposals on New CEA Link</a></div>`
        : '';
    card.innerHTML = `<div class="role-card-icon" aria-hidden="true">🗓️</div>
        <h2 class="role-card-title">${title}</h2>
        <p class="role-card-why">${why}</p>
        <div class="login-about">
            <p class="field-eyebrow">What it does</p>
            ${ABOUT.lines.map(line => `<p class="login-about-line">${escapeHtml(line)}</p>`).join('')}
        </div>
        ${toNewlink}
        <a href="./" class="role-card-back">← Back to roster</a>`;
    document.querySelector('nav.controls')?.remove();
    document.getElementById('selectorNoteBox')?.remove();   // the note and its ?: nothing here to explain
    document.getElementById('calendarLegend')?.remove();
    document.getElementById('selectorPrintHead')?.remove();   // nothing chosen to print
    document.getElementById('calendarDisplay')?.replaceChildren(card);
}

/**
 * The kinds of day the reader's own roster has in a month, in the key's words ('SPARE', 'AL'), by `rosterDayOn` as the
 * column draws it — so the key never names a day the column does not show. @param {any} member @param {number} y @param {number} m
 */
function rosterTypesInMonth(member, y, m) {
    const types = new Set();
    for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
        const { shift } = rosterDayOn(member, new Date(y, m, d));
        if (shift === 'SPARE' || shift === 'AL') types.add(shift);
    }
    return types;
}

/** The stored choice, or null — never throws on a value another version wrote. @returns {any} */
function storedChoice() {
    try { return JSON.parse(lsGet(STORE_KEY) || 'null'); } catch { return null; }
}

/** The page proper, for somebody it admits. @param {string} member the name signed in */
function runSelector(member) {
    const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
    const proposalSel = /** @type {HTMLSelectElement} */ (document.getElementById('selectorProposal'));
    const lineSel = /** @type {HTMLSelectElement} */ (document.getElementById('selectorLine'));
    const display = el('calendarDisplay');
    const announcer = document.getElementById('ariaAnnouncer');

    const choice = initialChoice(location.search, storedChoice());
    let proposal = /** @type {NonNullable<ReturnType<typeof proposalById>>} */ (proposalById(choice.proposalId));
    let line = choice.line;
    // The reader's own roster line, for "Compare with mine": a teamMembers row that is not an Other Staff login. Without one
    // (a name not on the roster) the tab is not offered, and an address asking for that view opens the month.
    const myRow = teamMembers.find(m => m.name === member && !isOtherStaff(m)) ?? null;
    /** @type {string} */
    let view = choice.view === MINE_VIEW && !myRow ? MONTH_VIEW : choice.view;
    let { year, month } = openingMonth();

    // Chosen as the option is made, so the picker is never told one value and shown another.
    for (const p of proposalsAtoZ()) proposalSel.add(new Option(proposalDisplayName(p), p.id, false, p.id === proposal.id));
    const fillLines = () => {
        lineSel.replaceChildren(...lineOptions(proposal).map(o => new Option(o.label, o.value)));
        lineSel.value = String(line);
    };
    fillLines();
    const paintProposal = enhanceSelect(proposalSel, { title: 'Which proposal?', placeholder: 'Choose a proposal', createLightbox });
    const paintLine = enhanceSelect(lineSel, { title: 'Which week do you start on?', placeholder: 'Choose a week', searchLabel: 'Search weeks', createLightbox });

    // WHAT THIS IS AND HOW TO READ IT, in the order a colleague needs it (staff-copy.md: discover, understand, act): not
    // their roster; what the two choices mean; what happens each week; and why January starts blank. "Date not final"
    // rather than "provisional", which is the word nobody uses out loud.
    const start = startDate();
    const note = el('selectorNote');
    // Each view says what its columns are, and the one thing a side-by-side could mislead about: the same week number is
    // not a promise of the same start in each proposal, and "your roster today" is the pattern without anything recorded.
    const NOTES = {
        // SHORT, every one (owner, 28 Nov 2026: the top looked "messy"): what you are looking at, and the one thing it could
        // mislead about. How the weeks turn over, and everything else, is the ? panel's.
        [MONTH_VIEW]: ['A proposal, not your roster.', ` Choose a proposal and the week you’d start on, from ${DAY_NAMES_FULL[start.getDay()]} `
            + `${formatDayMonthYear(start)} (date not final). Who starts on which week is decided later.`],
        [YEAR_VIEW]: ['A proposal, not your roster.', ' The whole year, each day coloured by what it is. Select a month to see it day by day.'],
        [COMPARE_VIEW]: ['Proposals, not your roster.', ' A column for each proposal, all from the week you chose. '
            + 'Who starts on which week is decided later, and it may differ in each, so try a few.'],
        [MINE_VIEW]: ['Your roster beside a proposal.', ' Left, your roster today, without leave or changed shifts. Right, the proposal, '
            + 'from the week you chose. Who starts on which week is decided later, so try a few.'],
    };
    const writeNote = () => {
        const [lead, rest] = NOTES[/** @type {keyof typeof NOTES} */ (view)];
        note.replaceChildren(Object.assign(document.createElement('strong'), { textContent: lead }), rest);
    };
    writeNote();
    // A shared link that named something this page cannot show says so, and what it shows instead — never a quiet swap.
    const linkNote = el('selectorLinkNote');
    linkNote.textContent = ignoredWords(choice.ignored, proposalDisplayName(proposal), line);
    linkNote.hidden = !linkNote.textContent;
    el('selectorStartDate').textContent = formatDayMonth(start);
    el('selectorStartBtn').setAttribute('aria-label', `${formatDayMonth(start)}: go to the week the new link starts`);

    // ── the day panel ───────────────────────────────────────────────────────────────────────────
    const dayLb = createLightbox({
        overlay: el('dayDetailLightbox'), content: el('dayDetailContent'), closeBtn: el('dayDetailClose'),
    });
    /** @param {HTMLElement} cell */
    function openDayDetail(cell) {
        const d = cell.dataset;
        if (!d.detailDay) return;   // a blank day before the start: nothing to show, and Enter on one opens nothing
        el('dayDetailDate').textContent = d.detailDay || '';
        const week = el('dayDetailWeek'); week.textContent = d.detailWeek || ''; week.hidden = !d.detailWeek;
        const who = el('dayDetailWho'); who.textContent = d.detailWho || ''; who.hidden = !d.detailWho;
        el('dayDetailLightbox').setAttribute('aria-label', d.detailWho ? `Day details, ${d.detailWho}` : 'Day details');
        el('dayDetailShiftWords').textContent = d.detailShiftWords || '';
        const time = el('dayDetailShiftTime'); time.textContent = d.detailShiftTime || ''; time.hidden = !d.detailShiftTime;
        const glyph = el('dayDetailShiftGlyph');
        glyph.textContent = d.detailShiftValue ? shiftBadgeParts(d.detailShiftValue).emoji : '';
        glyph.hidden = !glyph.textContent;
        const xmas = el('dayDetailChristmas');
        const xmasDay = d.detailChristmas === '25' ? 'Christmas Day' : d.detailChristmas === '26' ? 'Boxing Day' : '';
        xmas.textContent = xmasDay ? `${xmasDay}: due at work, so this is annual leave. It does not come off the allowance.` : '';
        xmas.hidden = !xmasDay;
        const cover = el('selectorCoverLine');
        cover.textContent = d.detailCover === 'sunday' ? 'The Sunday of a cover week. Its four shifts fall between Monday and Saturday.'
            : d.detailCover === 'week' ? 'A cover week: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.'
            : '';
        cover.hidden = !cover.textContent;
        const sunday = el('selectorSundayLine');
        sunday.textContent = d.detailSunday === 'overtime' ? 'Sunday shifts are overtime.' : '';
        sunday.hidden = !sunday.textContent;
        const extras = el('dayDetailExtras');
        /** @type {Array<{ icon: string, label: string }>} */
        let markers;
        try { markers = d.detailMarkers ? JSON.parse(d.detailMarkers) : []; } catch { markers = []; }
        extras.replaceChildren(...markers.map(m => {
            const chip = document.createElement('span');
            chip.className = 'ddm-chip';
            const ic = Object.assign(document.createElement('span'), { className: 'ddm-icon', textContent: m.icon || '' });
            ic.setAttribute('aria-hidden', 'true');
            chip.append(ic, Object.assign(document.createElement('span'), { textContent: m.label || '' }));
            return chip;
        }));
        extras.hidden = !markers.length;
        dayLb.open();
    }

    // ── the month ───────────────────────────────────────────────────────────────────────────────
    /** A proposal as a side-by-side column, from the chosen week. @param {any} p */
    const proposalColumn = (p) => ({ key: p.code, name: proposalDisplayName(p), kind: /** @type {const} */ ('proposal'), chosen: p.id === proposal.id,
        dayAt: (/** @type {Date} */ d) => dayOn(p, line, d), isCover: (/** @type {number} */ n) => isCoverLine(p, n) });
    const build = (/** @type {number} */ y, /** @type {number} */ m) => {
        if (view === COMPARE_VIEW) return buildSelectorTable(proposalsAtoZ().map(proposalColumn), line, y, m,
            { caption: 'Every proposal side by side' });
        if (view === MINE_VIEW && myRow) return buildSelectorTable([
            { key: 'mine', name: 'Your roster today', kind: 'mine', dayAt: (d) => rosterDayOn(myRow, d) },
            { ...proposalColumn(proposal), chosen: true },
        ], line, y, m, { caption: `Your roster today beside ${proposalDisplayName(proposal)}` });
        if (view === YEAR_VIEW) return buildSelectorYear(proposal, line, y,
            { firstMonth: y === FIRST_MONTH.year ? FIRST_MONTH.month : 0, lastMonth: y === LAST_MONTH.year ? LAST_MONTH.month : 11 });
        return buildSelectorMonth(proposal, proposalDisplayName(proposal), line, y, m, { onDayDetail: openDayDetail });
    };
    // A step is a month, or in the Year view a year — so Prev and Next, ← →, PgUp/PgDn and the swipe all move by what is
    // shown, and the range check needs nothing new (a year on from December 2027 is December 2028, the last month).
    const shift = (/** @type {number} */ delta) => {
        const n = year * 12 + month + delta * (view === YEAR_VIEW ? 12 : 1);
        return { year: Math.floor(n / 12), month: n % 12 };
    };
    const title = () => `${view === YEAR_VIEW ? year : `${MONTH_NAMES[month]} ${year}`} — Links Selector — Marylebone Roster`;
    const prevBtn = /** @type {HTMLButtonElement} */ (el('prevMonth'));
    const nextBtn = /** @type {HTMLButtonElement} */ (el('nextMonth'));
    // THE CALENDAR'S WAY AT THE ENDS (calendar-app.js → updateNavButtonState): `aria-disabled` and a faded button, never
    // `disabled` — a disabled button drops the focus it holds, so pressing Next →, key by key, into December 2028 left the
    // keyboard on <body>. The press itself is refused in `step`.
    function updateNav() {
        for (const [btn, delta] of /** @type {Array<[HTMLButtonElement, number]>} */ ([[prevBtn, -1], [nextBtn, 1]])) {
            const to = shift(delta);
            const end = !inRange(to.year, to.month);
            btn.setAttribute('aria-disabled', end ? 'true' : 'false');
            btn.style.opacity = end ? '0.4' : '';
            // Said as what it moves: a month, or in the Year view a year.
            btn.setAttribute('aria-label', `${delta < 0 ? 'Prev' : 'Next'} ${view === YEAR_VIEW ? 'year' : 'month'}`);
        }
    }
    /** The printed heading's second line (links-selector.html → #selectorPrintHead): the choice, and when it was printed. */
    function stampPrint() {
        const now = new Date();
        const what = view === COMPARE_VIEW ? 'Every proposal side by side'
            : view === YEAR_VIEW ? `${proposalDisplayName(proposal)} (${proposal.ref}), the year ${year}`
            : view === MINE_VIEW ? `Your roster today beside ${proposalDisplayName(proposal)} (${proposal.ref})`
            : `${proposalDisplayName(proposal)} (${proposal.ref})`;
        el('selectorPrintChoice').textContent = `${what} · starting in week ${line}`
            + ` · ${view === MONTH_VIEW ? 'a proposal, not a roster' : 'proposals are not rosters'} · ${printedStamp(now, formatClock(now))}`;
    }
    // THE CALENDAR'S KEY RULE (calendar-legend.js), handed this page's month: an item shows only in a month that has it.
    // No member is drawn, so its "member" is an empty one — never on the Dispatcher roster, so no Night key — and its month
    // is always a drawn grid ('render'). This page's own two follow its month too: the blank days, and Today, which is
    // drawn only where today has a line — so not at all before the link starts, where a Today key would explain nothing.
    const legend = createLegend({
        getCurrentMember: () => ({}),
        // In Compare, what ANY column has: the key under the table explains every column.
        // Beside your roster, what either column has (a Spare on your own roster too).
        // In the Year view, what any month of the year has.
        getShiftTypesInMonth: (_m, y, mo) => view === YEAR_VIEW ? shiftTypesInYear(proposal, line, y)
            : view === COMPARE_VIEW ? shiftTypesInMonthAll(proposalsAtoZ(), line, y, mo)
            : view === MINE_VIEW && myRow ? new Set([...shiftTypesInMonth(proposal, line, y, mo), ...rosterTypesInMonth(myRow, y, mo)])
            : shiftTypesInMonth(proposal, line, y, mo),
        getDisplayYear: () => year,
        getDisplayMonth: () => month,
        computeEaster,
        displayVerdict: () => 'render',
        isTeamViewMode: () => false,
    });
    function updateLegend() {
        legend.update();
        const blankKey = document.getElementById('selectorLegendBlank');
        if (blankKey) blankKey.style.display = (view === YEAR_VIEW ? hasBlankDays(year, 0) : hasBlankDays(year, month)) ? '' : 'none';
        const todayKey = document.getElementById('selectorLegendToday');
        const now = new Date();
        if (todayKey) todayKey.style.display = now.getFullYear() === year && now.getMonth() === month && lineOn(1, now) !== null ? '' : 'none';
    }
    /** Draw the shown month. @param {{ keepDay?: boolean }} [opts] `keepDay`: a redraw of the SAME month (a return to the
     *  app) gives the keyboard back to the same day, as the Calendar's background repaint does (`focusDay`); a press that
     *  changes the month gives it to the new grid's entry day. */
    function render({ keepDay = false } = {}) {
        // KEEP THE KEYBOARD ON THE GRID, as the Calendar's renderCalendar does: replacing the month drops a focused day to
        // <body>, and then ← → change the month instead of moving between days.
        const active = document.activeElement;
        const onCell = active instanceof HTMLElement && active.classList.contains('calendar-day');
        const day = onCell && keepDay ? /** @type {HTMLElement} */ (active).dataset.detailDay ?? null : null;
        const container = build(year, month);
        display.replaceChildren(container);
        if (onCell) rovingCellFor(container, day)?.focus({ preventScroll: true });
        document.title = title();
        updateNav();
        updateLegend();
        stampPrint();
    }
    const announce = () => { if (announcer) announcer.textContent = view === YEAR_VIEW ? `The year ${year}` : `${MONTH_NAMES[month]} ${year}`; };
    /** Move the shown month, inside the range; reports whether it moved. @param {number} delta */
    function changeMonth(delta) {
        const to = shift(delta);
        if (!inRange(to.year, to.month)) return false;
        ({ year, month } = to);
        return true;
    }
    /** A press of Prev or Next (and PgUp/PgDn and ← →, which press them). Refused mid-swipe, as the Calendar's are: a month
     *  drawn under a finger would be overtaken by the swipe's own commit. At the faded end button a true no-op, nothing
     *  re-announced. @param {number} delta */
    function step(delta) {
        if (isSwipeCooldown()) return;
        if (changeMonth(delta)) { render(); announce(); }
    }

    /** The way to New CEA Link opens on the weeks of the proposal shown (newlink-app.js reads `weeks`). */
    function aimOnward() {
        const onward = /** @type {HTMLAnchorElement|null} */ (document.getElementById('selectorOnward'));
        if (onward) onward.href = `${NEWLINK_WEEKS}${encodeURIComponent(proposal.code)}`;
        const from = document.getElementById('selectorOnwardFrom');
        if (from) from.textContent = `, starting with ${proposalDisplayName(proposal)}`;
    }

    // ── 📅 One proposal | ⚖️ Compare all | 👤 Compare with mine ─────────────────────────────────────
    // The views, every one always named, the one shown pressed and in the page's colour (Team Week View's grade tabs). A
    // press on the one already shown does nothing, so nothing is redrawn or re-announced. "Compare with mine" is offered
    // only to a reader with a roster line.
    const viewBtns = /** @type {Array<[HTMLElement, string]>} */ ([[el('selectorViewMonth'), MONTH_VIEW], [el('selectorViewYear'), YEAR_VIEW],
        [el('selectorViewCompare'), COMPARE_VIEW], [el('selectorViewMine'), MINE_VIEW]]);
    el('selectorViewMine').hidden = !myRow;
    function paintCompare() {
        for (const [btn, v] of viewBtns) btn.setAttribute('aria-pressed', v === view ? 'true' : 'false');
        document.body.classList.toggle('selector-compare-active', view === COMPARE_VIEW || view === MINE_VIEW);
        document.body.classList.toggle('selector-year-active', view === YEAR_VIEW);
        writeNote();
    }
    for (const [btn, v] of viewBtns) btn.addEventListener('click', () => {
        if (isSwipeCooldown() || view === v) return;
        view = v;
        paintCompare();
        chosen();
        if (view === YEAR_VIEW) { announce(); return; }
        if (announcer) announcer.textContent = (view === COMPARE_VIEW ? 'Every proposal side by side'
            : view === MINE_VIEW ? `Your roster today beside ${proposalDisplayName(proposal)}`
            : proposalDisplayName(proposal)) + `, ${MONTH_NAMES[month]} ${year}`;
    });

    // A month's name in the Year view opens that month, day by day, where the day panel has what a small cell cannot say.
    display.addEventListener('click', (e) => {
        const open = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.yr-open'));
        if (!open || isSwipeCooldown()) return;
        year = Number(open.dataset.year); month = Number(open.dataset.month);
        view = MONTH_VIEW;
        paintCompare();
        chosen();
        announce();
        el('selectorViewMonth').focus({ preventScroll: true });
    });

    /** Keep the choice in the address and on this device, then redraw. Compare stays in the ADDRESS only. */
    function chosen() {
        try { history.replaceState(history.state, '', choiceQuery(proposal, line, view) + location.hash); } catch { /* a sandboxed frame */ }
        lsSet(STORE_KEY, JSON.stringify({ proposal: proposal.code, line }));
        linkNote.hidden = true;   // what the link named is behind them now: the screen shows their own choice
        aimOnward();
        render();
    }

    proposalSel.addEventListener('change', () => {
        const p = proposalById(proposalSel.value);
        if (!p) return;
        proposal = p;
        fillLines();   // the cover-week labels are the proposal's own
        paintLine();
        chosen();
    });
    lineSel.addEventListener('change', () => {
        const n = Number(lineSel.value);
        if (!Number.isInteger(n)) return;
        line = n;
        chosen();
    });
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    el('selectorStartBtn').addEventListener('click', () => {
        if (isSwipeCooldown()) return;
        year = FIRST_MONTH.year; month = FIRST_MONTH.month;
        render(); announce();
    });
    // THE CALENDAR'S OWN KEYS AND HOVER LINE (calendar-keyboard.js), not a copy: ← → change the month until a day has focus,
    // then the arrows walk the days, PgUp/PgDn change the month, Enter opens a day, T goes to this month (the opening one)
    // and P prints — with the Calendar's guards (an open overlay, the drawer, a swipe in flight). Registered in the Calendar's
    // order, the shortcuts first. There is no team view or first run here, so those two answer no; the one LOCKED state is
    // the sign-in card a lost session puts up (page-session.js), and behind it the keys must not move the month, as the
    // Calendar's do not behind its lock. No pay day leads to the calculator from a proposal, so Enter on a payday opens the
    // day like any other.
    initCalendarShortcuts({
        getAccessType: () => (document.getElementById('loginOverlay') ? 'none' : 'named'),
        isTeamViewMode: () => false, isFirstRun: () => false,
        jumpToCurrentWeek: () => {},
        goToToday: () => { ({ year, month } = openingMonth()); render(); announce(); },
        print: () => { stampPrint(); window.print(); },
    });
    initCalendarKeyboard({ navigateToPaycalc: () => false, openDayDetail: /** @type {any} */ (openDayDetail) });
    // THE CALENDAR'S MONTH PICKER (owner, 28 Nov 2026: "The month doesn't have the drop down selector"), opened by the month's
    // name as on the Calendar, handed this page's month and its two years. Every month of both is in range, so a choice
    // never lands outside it.
    initMonthJump({
        renderCalendar: render, announceMonthChange: announce,
        getAccessType: () => (document.getElementById('loginOverlay') ? 'none' : 'named'),
        month: {
            get: () => ({ year, month }),
            set: (y, m) => { if (inRange(y, m)) ({ year, month } = { year: y, month: m }); },
            firstYear: FIRST_MONTH.year, lastYear: LAST_MONTH.year,
        },
    });
    initCalendarTooltip();

    // With `months` given the swipe builds, bounds, titles and settles through the page's own months, so two of its
    // Calendar-only deps — the month read's repaint and the day panel for its adjacent panels — are never called here;
    // they are passed because the signature is the Calendar's. The key IS updated on a commit.
    initSwipeHandler({
        isTeamViewMode: () => false,
        changeMonth,
        renderCalendar: render,
        updateLegend,            // a swipe's commit updates the key, as the Calendar's does: it never calls render()
        updateNavButtonState: updateNav,
        openDayDetail: null,
        announceMonthChange: announce,
        months: {
            buildPanel: (delta) => { const to = shift(delta); return build(to.year, to.month); },
            canNavigate: (direction) => { const to = shift(direction === 'prev' ? -1 : 1); return inRange(to.year, to.month); },
            title,
            settled: () => {},
        },
    });

    // The print time is stamped again as the browser prints, where it says it is printing (Safari's AirPrint does not —
    // CLAUDE.md, the iOS hazards — and keeps the time of the last redraw or the P key).
    window.addEventListener('beforeprint', stampPrint);
    // An installed app is reopened, not reloaded: the month shown is redrawn, so today's ring and the Today key move on
    // with the date. The month itself stays where the colleague left it; T goes to today's. NOT under an open panel: the
    // panel gives focus back to the day it was opened from when it closes, and a redraw under it would have put that day
    // out of the page, leaving the keyboard on <body> (where ← → change the month). NOT mid-swipe either: the swipe's
    // panels live in the grid a redraw replaces — the Calendar's rule (calendar-redraw.js). Either way the next press
    // draws the month afresh.
    onReturnToPage(0, () => {
        if (document.body.classList.contains('lb-open') || isSwipeGestureActive()) return;
        render({ keepDay: true });
    });

    paintProposal();
    paintLine();
    paintCompare();
    aimOnward();
    // The address says what is shown, from the first paint — a link copied straight away is the view on screen.
    try { history.replaceState(history.state, '', choiceQuery(proposal, line, view) + location.hash); } catch { /* a sandboxed frame */ }
    render();

    // ── what it is and how to read it ─────────────────────────────────────────────────────────
    // The app's own ? and Tips panel (tips-lightbox.js), and the FIRST-VISIT ORIENTATION is that same panel opened by
    // itself (owner, 28 Nov 2026: "nothing to say what it is and how to use it") — the Link Designer's welcome, not a
    // dated notice: a dated one expires and is then marked seen unshown, and this explanation never stops being needed.
    // Flagged as it opens, so a colleague who leaves without closing it is not shown it again; never stacked on another
    // overlay (`openNoticeIfClear` defers it, unflagged, to the next visit); and not where storage keeps no flag, where
    // it would open on every visit.
    // AFTER THE SESSION HAS SETTLED, and the notices' 1500ms after it (/new-notice): a colleague whose password the admin
    // has just reset is asked for a new one (password-force.js) once the session is ready, and the panel opened at once
    // would sit UNDER that card, closing on its Escape. Asked then, `openNoticeIfClear` sees the card and waits a visit.
    const tips = initTipsLightbox(CARD_TIPS);
    if (tips && !lsGet(WELCOME_KEY) && lsAvailable()) {
        sessionReady.catch(() => {}).finally(() => setTimeout(() => {
            if (openNoticeIfClear({ open: () => tips.open('selector') })) lsSet(WELCOME_KEY, '1');
        }, WELCOME_DELAY_MS));
    }
}
