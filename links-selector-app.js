// @ts-check
/**
 * links-selector-app.js — coordinator for links-selector.html, the Links Selector.
 *
 * Choose a shortlisted proposal and the line you would start on, and see your months as the Calendar shows them, with
 * the Calendar's swipe. The rules — which line a date falls on, blank days before the start, Christmas, what the address
 * and this device remember — are links-selector-core.js; the month is links-selector-render.js; this file wires the
 * page: the sign-in gate, the two pickers, the month buttons and swipe, and the day panel.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * A BETA for the admin alone until it is right (owner, 27 Nov 2026: "The beta would only be accessible to me the master
 * admin until it is perfected"), then the New CEA Link page's audience (owner: "Same as new link page") — one switch,
 * `CONFIG.LINKS_SELECTOR_OPEN`, read by auth-policy.js for the page and its drawer pill together.
 *
 * ── WHAT IT NEVER DOES ─────────────────────────────────────────────────────────────────────────
 *
 * Read or write Firestore for the roster, or draw anybody's leave, absences or changed shifts (owner: "Leave out"). It
 * signs in like every page, so the error reporter and the usage count work as they do everywhere; nothing else is sent.
 */

import { SHARED_SCREEN } from './login-core.js';
import { MONTH_NAMES, shiftBadgeParts, escapeHtml, teamMembers } from './roster-data.js';
import { initNavPanel } from './nav-panel.js';
import { sessionReady, reconcileExpiredIdentity } from './session.js';
import { signOutAndLeave } from './page-session.js';
import { startPage } from './page-start.js';
import { navGatesFor } from './auth-policy.js';
import { createLightbox } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { markPageReady, clearLoginStart } from './perf-reporter.js';
import { enhanceSelect } from './select-sheet.js';
import { initSwipeHandler } from './calendar-swipe.js';
import { lsGet, lsSet } from './ls.js';
import { proposalById, proposalDisplayName } from './link-designer-proposals.js';
import { buildSelectorMonth } from './links-selector-render.js';
import { FIRST_MONTH, inRange, openingMonth, initialChoice, choiceQuery, lineOptions, proposalsAtoZ, startDate } from './links-selector-core.js';

/** Where this device keeps the last choice — a proposal code and a line, nothing about the person. */
export const STORE_KEY = 'myb_links_selector_choice';

/** What the page is and who it is for, on the sign-in card and on the card a colleague it is not for is shown. */
const ABOUT = Object.freeze({
    lines: Object.freeze([
        'A shortlisted proposal for the new CEA link, shown month by month as the Calendar shows your roster.',
        'Choose a proposal and the line you would start on.',
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
    runSelector();
    markPageReady();
}

/** The one card a signed-in colleague the page is not (yet) for is shown — the app's refusal card. @param {string} member */
function showNotForYou(member) {
    const other = teamMembers.find(m => m.name === member)?.otherStaff === true;
    const card = document.createElement('div');
    card.className = 'role-card';
    card.id = 'selectorNotForYou';
    card.innerHTML = `<div class="role-card-icon" aria-hidden="true">📆</div>
        <h2 class="role-card-title">The Links Selector isn’t open to you yet</h2>
        <p class="role-card-why">${other
            ? 'It shows the proposed new rota for colleagues on a normal CEA contract. An Other Staff login has no roster line, so there is nothing here for it.'
            : 'It is being tried out before it opens. The three proposals are on the New CEA Link page in the meantime.'}</p>
        <div class="login-about">
            <p class="field-eyebrow">What it does</p>
            ${ABOUT.lines.map(line => `<p class="login-about-line">${escapeHtml(line)}</p>`).join('')}
        </div>
        <a href="./" class="role-card-back">← Back to roster</a>`;
    document.querySelector('nav.controls')?.remove();
    document.getElementById('selectorNote')?.remove();
    document.getElementById('calendarLegend')?.remove();
    document.getElementById('calendarDisplay')?.replaceChildren(card);
}

/** The stored choice, or null — never throws on a value another version wrote. @returns {any} */
function storedChoice() {
    try { return JSON.parse(lsGet(STORE_KEY) || 'null'); } catch { return null; }
}

/** The page proper, for somebody it admits. */
function runSelector() {
    const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
    const proposalSel = /** @type {HTMLSelectElement} */ (document.getElementById('selectorProposal'));
    const lineSel = /** @type {HTMLSelectElement} */ (document.getElementById('selectorLine'));
    const display = el('calendarDisplay');
    const announcer = document.getElementById('ariaAnnouncer');

    const choice = initialChoice(location.search, storedChoice());
    let proposal = /** @type {NonNullable<ReturnType<typeof proposalById>>} */ (proposalById(choice.proposalId));
    let line = choice.line;
    let { year, month } = openingMonth();

    // Chosen as the option is made, so the picker is never told one value and shown another.
    for (const p of proposalsAtoZ()) proposalSel.add(new Option(proposalDisplayName(p), p.id, false, p.id === proposal.id));
    const fillLines = () => {
        lineSel.replaceChildren(...lineOptions(proposal).map(o => new Option(o.label, o.value)));
        lineSel.value = String(line);
    };
    fillLines();
    const paintProposal = enhanceSelect(proposalSel, { title: 'Which proposal?', placeholder: 'Choose a proposal', createLightbox });
    const paintLine = enhanceSelect(lineSel, { title: 'Which line do you start on?', placeholder: 'Choose a line', searchLabel: 'Search lines', createLightbox });

    el('selectorNote').textContent = `A proposal, not your roster. The new link starts on Sunday ${startDate().getDate()} ${MONTH_NAMES[startDate().getMonth()]} ${startDate().getFullYear()} (provisional): days before it are blank.`;

    // ── the day panel ───────────────────────────────────────────────────────────────────────────
    const dayLb = createLightbox({
        overlay: el('dayDetailLightbox'), content: el('dayDetailContent'), closeBtn: el('dayDetailClose'),
    });
    /** @param {HTMLElement} cell */
    function openDayDetail(cell) {
        const d = cell.dataset;
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
    const build = (/** @type {number} */ y, /** @type {number} */ m) =>
        buildSelectorMonth(proposal, proposalDisplayName(proposal), line, y, m, { onDayDetail: openDayDetail });
    const shift = (/** @type {number} */ delta) => {
        const n = year * 12 + month + delta;
        return { year: Math.floor(n / 12), month: n % 12 };
    };
    const title = () => `${MONTH_NAMES[month]} ${year} — Links Selector — Marylebone Roster`;
    const prevBtn = /** @type {HTMLButtonElement} */ (el('prevMonth'));
    const nextBtn = /** @type {HTMLButtonElement} */ (el('nextMonth'));
    function updateNav() {
        prevBtn.disabled = !inRange(shift(-1).year, shift(-1).month);
        nextBtn.disabled = !inRange(shift(1).year, shift(1).month);
    }
    function render() {
        display.replaceChildren(build(year, month));
        document.title = title();
        updateNav();
    }
    const announce = () => { if (announcer) announcer.textContent = `${MONTH_NAMES[month]} ${year}`; };
    /** @param {number} delta */
    function changeMonth(delta) {
        const to = shift(delta);
        if (!inRange(to.year, to.month)) return;
        ({ year, month } = to);
    }
    /** @param {number} delta */
    function step(delta) { changeMonth(delta); render(); announce(); }

    /** Keep the choice in the address and on this device, then redraw. */
    function chosen() {
        try { history.replaceState(history.state, '', choiceQuery(proposal, line) + location.hash); } catch { /* a sandboxed frame */ }
        lsSet(STORE_KEY, JSON.stringify({ proposal: proposal.code, line }));
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
        year = FIRST_MONTH.year; month = FIRST_MONTH.month;
        render(); announce();
    });
    // ← and → change the month, as on the Calendar — but never while a field or a sheet has the keys.
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const t = /** @type {HTMLElement|null} */ (e.target);
        if (t && (t.closest('input, select, textarea, [contenteditable], .lb-overlay') || t.isContentEditable)) return;
        if (document.querySelector('.lb-overlay.active, .lb-overlay.open')) return;
        e.preventDefault();
        step(e.key === 'ArrowLeft' ? -1 : 1);
    });

    initSwipeHandler({
        isTeamViewMode: () => false,
        changeMonth,
        renderCalendar: render,
        updateLegend: () => {},
        updateNavButtonState: updateNav,
        openDayDetail: /** @type {any} */ (openDayDetail),
        announceMonthChange: announce,
        months: {
            buildPanel: (delta) => { const to = shift(delta); return build(to.year, to.month); },
            canNavigate: (direction) => { const to = shift(direction === 'prev' ? -1 : 1); return inRange(to.year, to.month); },
            title,
            settled: () => {},
        },
    });

    paintProposal();
    paintLine();
    // The address says what is shown, from the first paint — a link copied straight away is the view on screen.
    try { history.replaceState(history.state, '', choiceQuery(proposal, line) + location.hash); } catch { /* a sandboxed frame */ }
    render();
}
