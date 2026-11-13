// @ts-check
/**
 * newlink-app.js — coordinator for newlink.html: the three shortlisted proposals for the new CEA link (from January 2027), presented to
 * the colleagues who will work it.
 *
 * Owns: the access gate, the session wiring, and which view is on screen — the kind of colleague chosen in "What it means
 * if you…" and the proposal whose weeks are drawn. Every word of HTML is `newlink-render.js`; every figure is the
 * generated `newlink-data.js` (from the pack's own tooling, docs/links-26/tooling/newlink-data.mjs); every decision —
 * the phase, the closing date, the audience — is `newlink-config.js`. Nothing here reads the network: once opened, the
 * page works offline. Only the pack's files need a connection, and they open in the app's PDF viewer (pdf-viewer.js).
 *
 * ── WHY THE PAGE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * Short Run was shown to colleagues first; the designs beside it were drawn up afterwards, and since 8 Nov 2026 the shortlist
 * is Balanced V6, Level Crossing and Middle Ground, each keeping closing weeks apart (Short Run left it then). A slide deck
 * shown once cannot answer "what does it mean for ME?" a week later, and three decks side by side cannot be compared on a
 * phone. So the page leads with what has changed since Short Run was shown (folded since 12 Nov 2026, as the owner agreed:
 * it is for those who saw Short Run, and a first look starts with the three), then what all three share, then what sets
 * each apart from the other two, then lets each colleague pick the way they work and read the three against today for
 * exactly that — the pack's one-page sheet, made into a choice.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * Every colleague on a normal CEA contract and the managers, since `PHASE` became 'open' (v25.60, owner, 9 Nov 2026), with
 * the admin and the named previewers (CONFIG.NEWLINK_PREVIEW, v25.33), who had it alone while it was a preview (auth-policy.js
 * `newlink`, nav-panel.js `newlinkAudienceOnly`, both read through `canOpenNewlink`). The sign-in is the
 * app's ordinary front door rather than a protection — the proposals are public files — and the station PIN never reads
 * this page (owner: "No, signed-in only"), so it signs out on arrival like every page that does not ask for it.
 *
 * ── AND WHO IT IS NOT FOR IS TOLD, NOT SENT AWAY (sign-in audit B1, 13 Nov 2026) ────────────────────────────────
 *
 * A link to this page travels in group chats, so colleagues it is not for open it: a bilingual contract, which keeps its
 * own links (owner, 8 Nov 2026), a CES, a Dispatcher. The sign-in card said nothing about the page, and a sign-in that
 * landed was answered with "Signed in — opening New link…" and a silent jump to the Calendar, every time. So the card
 * says what the page is and who it is for (`ABOUT`, as Admin, Pay and Trains do), and a signed-in colleague outside the
 * audience gets the page's chrome — header, drawer, sign-out — round one card saying the same, with the way back
 * (`showNotForYou`). Those are the only words on the page that are not newlink-render.js's: they belong to the gate.
 */

import { CONFIG, formatISO, escapeHtml } from './roster-data.js';
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse, onReturnToPage } from './page-session.js';
import { requirePage, canOpenOvertime, canOpenNewlink } from './auth-policy.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { initPdfViewer } from './pdf-viewer.js';
import { isPlainClick } from './pdf-viewer-core.js';
import { PROPOSALS } from './links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, DIFFERS, DIFFER_RULE, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { CLOSES, STARTS, TIMETABLE_STARTS, PACK_BASE, HAVE_YOUR_SAY, CHOSEN, CONTACT } from './newlink-config.js';
import { renderStatus, statusPhase, statusHint, renderList, renderCommon, renderDiffers, renderPersonas, renderPersonaChips,
    renderAllWeeks, renderWeeksKey, renderWeeksTabs, renderPack, designName, ifYou, aToZ } from './newlink-render.js';

/** The collapsible cards, by the id prefix their header, body and chevron share. */
const CARDS = ['nlChanges', 'nlCommon', 'nlDiffer', 'nlMeans', 'nlWeeks', 'nlSay', 'nlPack', 'nlHow'];

/**
 * What the page is and who it is for — on the sign-in card (login-overlay.js → `about`) and on the card a colleague outside
 * the audience is shown, the same words in both, so the page's two answers to "not for you" read as one door (the Pay
 * Calculator's arrangement). The audience is auth-policy.js `newlinkAudience`; the bilingual contract's own links are the
 * owner's of 8 Nov 2026 (newlink-config.js → AUDIENCE). It names nobody as deciding anything (newlink-config.js → WHO IS
 * IN CHARGE).
 */
const ABOUT = Object.freeze({
    lines: Object.freeze([
        'The three shortlisted proposals for the new CEA link, to read and compare.',
        'They are for colleagues on a normal CEA contract, and the managers.',
        'Colleagues on a bilingual contract, CESs and Dispatchers keep their own links.',
    ]),
});

/** Coordinator body, invoked by newlink-boot.js. Exported so a test can import without running. */
export function init() {
    reloadIfRestoredForSomeoneElse();
    registerServiceWorker();   // BEFORE the sign-in gate, as Operations/Trains: a signed-out view must still take an update
    // Tear down a lingering privileged Firebase identity whose local session has expired — and the station PIN, which
    // this page does not admit (reconcileExpiredIdentity's default).
    reconcileExpiredIdentity().catch(() => {});
    const currentUser = getSession()?.name ?? null;

    // Decided from the LOCAL session, as Operations does — the auth store is often still initialising here, and a
    // role-gated page must not treat "pending" as "allowed".
    const access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'newlink');
    if (access.decision === 'login') {
        // No session saved (iOS private mode can refuse the write): reload into a fresh sign-in.
        initLoginOverlay({
            pageLabel: 'New link', about: ABOUT,
            onSuccess: () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } },
        });
        return;
    }
    // Signed in, and either in the audience or not: a colleague it is not for gets the page's chrome round a card saying
    // so, never a silent jump to the roster — the pill is not offered to them, but a shared link still brings them here.
    start(/** @type {string} */ (currentUser), access.decision !== 'forbidden');
}

/**
 * The page, for a signed-in member: the proposals if the policy admits them, and otherwise who the page is for.
 * @param {string} member @param {boolean} admitted
 */
function start(member, admitted) {
    dismissLoginOverlay();
    const established = ensureNamedSession(member);
    resolveSession(established);
    guardNamedSession({ page: 'newlink', pageLabel: 'New link', member, established,
        signIn: () => initLoginOverlay({ pageLabel: 'New link', about: ABOUT, onSuccess: () => window.location.reload() }) });

    /** @type {(() => void)|null} */
    let openAboutLightbox = null;
    initNavPanel({
        authReady: sessionReady,
        currentPage: 'newlink',
        memberName: member,
        isAdmin: CONFIG.ADMIN_NAMES.includes(member),
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member),
        canOpenOvertime: canOpenOvertime(member), canOpenNewlink: canOpenNewlink(member),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    // initAboutLightbox returns `{ open, close }`, not a function. Taking the object whole — as this page first did, copying
    // Trains — made the drawer's logo throw instead of opening About (found 2 Nov 2026).
    openAboutLightbox = initAboutLightbox({ appLabel: 'Marylebone Roster — New link', getUserName: () => member })?.open ?? null;
    wireHeaderLogo();   // the header logo goes back to the calendar (about-lightbox.js — the one wiring)
    if (!admitted) {
        showNotForYou();
        markPageReady();
        // A real view by a real member, counted as the Pay Calculator counts its refusal; not timed, as nothing loads.
        sessionReady.then(() => { initErrorReporter(); recordUsage('newlink', member); });
        sessionReady.then(() => initPasswordForce(member)).catch(() => {});
        return;
    }
    const cards = Object.fromEntries(CARDS.map(id => [id, initCardCollapse(`${id}ToggleHeader`, `${id}Body`, `${id}Chevron`)]));

    renderStatic();
    wireChoices(cards);
    wirePack();
    markPageReady();
    // The status speaks of TODAY — which dates have come — and an installed app is not reloaded when it is reopened:
    // iOS keeps it resident for days (iPhone audit, Nov 2026). So it is drawn again whenever the page comes back.
    onReturnToPage(0, drawStatus);

    sessionReady.then(() => {
        initErrorReporter();
        recordUsage('newlink', member);
        recordPageLatency('newlink', member);
    });
    sessionReady.then(() => initPasswordForce(member)).catch(() => {});
}

/**
 * The page for a signed-in colleague it is not for (sign-in audit B1): one card in place of the proposals — what the page
 * is and who it is for, in the sign-in card's own box and words (`ABOUT`), and the way back to their roster. The header,
 * the drawer and Sign out are wired as on any page, by `start`.
 */
function showNotForYou() {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'nlNotForYou';
    card.innerHTML = `<div class="card-header card-header--row"><div><h2><span aria-hidden="true">🔁</span> The new link doesn’t apply to your contract</h2></div></div>
        <div class="card-body">
            <div class="login-about">${ABOUT.lines.map(line => `<p class="login-about-line">${escapeHtml(line)}</p>`).join('')}</div>
            <a href="./" class="btn-action btn-primary">Back to your roster</a>
        </div>`;
    el('newlinkMain')?.replaceChildren(card);
}

/**
 * Everything that does not depend on a choice: the status, the lists, the pack, the notes. NO PREVIEW BANNER (owner, 8 Nov
 * 2026: "Remove the preview banner as it will be going live soon"): the admin and the named previewers see exactly what
 * colleagues will, and who the page will reach is newlink-config.js → AUDIENCE, held to the roster by its test.
 */
function renderStatic() {
    drawStatus();
    setHTML('nlChangesList', renderList(CHANGES));
    setHTML('nlCommonList', renderCommon({ gains: GAINS, costs: COSTS }));
    // the one-page comparison, found by its file rather than its place in the list: the card offers it only while the pack has it
    const glance = PACK.find(f => f.path.endsWith('at-a-glance.pdf')) ?? null;
    setHTML('nlDifferList', renderDiffers({ differs: DIFFERS, rule: DIFFER_RULE, glance, base: PACK_BASE }));
    setHTML('nlWeeksKey', renderWeeksKey());
    setHTML('nlSayList', renderList(HAVE_YOUR_SAY));
    setHTML('nlPackList', renderPack(PACK, PACK_BASE));
    setHTML('nlHowList', renderList(NOTES));
}

/**
 * The pack's files open in the app's PDF viewer, on this page (pdf-viewer.js — why: pdf-viewer-core.js's header), wherever
 * the page offers one: the full pack's list, and the one-page comparison under "Where they differ". One listener on each
 * list, so a redraw of it keeps working. A click with a modifier is left alone: Ctrl, Cmd or the middle button asks the
 * browser for a tab, and the link is still a real link to the file.
 */
function wirePack() {
    const viewer = initPdfViewer();
    if (!viewer) return;
    for (const list of ['nlDifferList', 'nlPackList'].map(id => document.getElementById(id))) {
        list?.addEventListener('click', (e) => {
            if (!isPlainClick(e)) return;
            const link = /** @type {HTMLAnchorElement|null} */ (/** @type {Element} */ (e.target).closest('a.nl-file'));
            const file = link && PACK.find(f => f.path === link.dataset.file);
            if (!link || !file) return;
            e.preventDefault();
            viewer.open({ url: link.href, title: file.label, kicker: file.design ?? 'For all three', pages: file.pages });
        });
    }
}

/** The day the status card was last drawn for. @type {string} */
let statusDay = '';

/**
 * The status card, for today. Drawn again only when the day has moved, so a return on the same day leaves it — and a
 * name tile holding focus — exactly as it was. Its taps are delegated to the card itself (`wireChoices`), so a redraw
 * keeps them. The day can move the page out of 'open' — the link's start coming with nothing chosen (`statusPhase`) — so
 * the two other things that ask for views are settled here too: the card's "For discussion, not a decision", and the
 * Have your say card, both shown only while the page is open (owner, 10 Nov 2026).
 */
function drawStatus() {
    const today = formatISO(new Date());
    if (today === statusDay) return;
    statusDay = today;
    setHTML('nlStatus', renderStatus({ proposals: PROPOSALS, closes: CLOSES, starts: STARTS, timetable: TIMETABLE_STARTS, today, chosen: CHOSEN, contact: CONTACT }));
    const { phase } = statusPhase({ proposals: PROPOSALS, chosen: CHOSEN, starts: STARTS, today });
    setText('nlStatusHint', statusHint(phase));   // words, not `hidden`: `.card-header .hint` is display:block, which outranks it
    el('nlSayCard')?.toggleAttribute('hidden', phase !== 'open');
}

/**
 * The two choices on the page — a kind of colleague, and a proposal's weeks — and what each redraws.
 * @param {Record<string, { setOpen: (open: boolean) => void }>} cards  the collapsible cards, by id prefix
 */
function wireChoices(cards) {
    /** @type {string|null} */ let persona = null;
    let design = aToZ(PROPOSALS)[0].id;   // A to Z: the first is first in the alphabet, not first in anyone's estimation (the page sorts for itself, whatever order the built-in list keeps)

    const drawPersonas = () => {
        setHTML('nlPersonaChips', renderPersonaChips(PERSONAS, persona));
        setHTML('nlPersonaPanel', renderPersonas(PERSONAS, COLUMNS, persona));
    };
    const drawWeeks = () => {
        const p = PROPOSALS.find(x => x.id === design) ?? aToZ(PROPOSALS)[0];
        setHTML('nlWeeksTabs', renderWeeksTabs(PROPOSALS, p.id));
        setHTML('nlWeeksPanel', renderAllWeeks(PROPOSALS, p.id));
    };
    drawPersonas();
    drawWeeks();

    // Delegated, and the pressed button keeps focus across the redraw: the chips are rebuilt, so the handler puts focus
    // back on the new copy of the one that was pressed rather than dropping it to <body>. What changed is said in ONE
    // line (a polite live region) — never by making the panel live, which would read a whole table aloud on every press.
    el('nlPersonaChips')?.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-persona]'));
        if (!b) return;
        const id = /** @type {string} */ (b.dataset.persona);
        persona = persona === id ? null : id;   // pressing the chosen one again goes back to the six one-line answers
        drawPersonas();
        /** @type {HTMLElement|null} */ (el('nlPersonaChips')?.querySelector(`[data-persona="${id}"]`) ?? null)?.focus();
        setText('nlPersonaStatus', personaStatus(persona));
    });
    // "Back to the six short answers", at the foot of a chosen answer: focus returns to the tile that was chosen, so the
    // reader lands on the tiles, above the six answers they asked for.
    el('nlPersonaPanel')?.addEventListener('click', (e) => {
        if (!(/** @type {HTMLElement} */ (e.target).closest('[data-persona-reset]'))) return;
        const was = persona;
        persona = null;
        drawPersonas();
        /** @type {HTMLElement|null} */ (el('nlPersonaChips')?.querySelector(`[data-persona="${was}"]`) ?? null)?.focus();
        setText('nlPersonaStatus', personaStatus(null));
    });
    /** Show one proposal's weeks, and say so in one line. @param {string} id */
    const showWeeks = (id) => {
        design = id;
        drawWeeks();
        const p = PROPOSALS.find(x => x.id === design);
        if (p) setText('nlWeeksStatus', `Showing ${designName(p)}’s ${Object.keys(p.patterns).length} weeks, below.`);
    };
    /** The chosen proposal's tab — or, on a wide screen, where the three stand side by side and there are no tabs, its weeks. */
    const focusChosenWeeks = () => {
        const tab = /** @type {HTMLElement|null} */ (el('nlWeeksTabs')?.querySelector(`[data-design="${design}"]`) ?? null);
        const target = tab && tab.getClientRects().length ? tab : /** @type {HTMLElement|null} */ (el('nlWeeksPanel')?.querySelector('.nl-weeks-one.is-chosen') ?? null);
        target?.focus({ preventScroll: true });
    };
    el('nlWeeksTabs')?.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-design]'));
        if (!b || b.dataset.design === design) return;
        showWeeks(/** @type {string} */ (b.dataset.design));
        focusChosenWeeks();   // the tabs are redrawn: back onto the new copy of the one pressed
    });
    // The two ways on from the top card: a name tile opens that proposal's weeks, and "Have your say" its card — each card
    // opens if it was folded, and the page scrolls to it.
    const reveal = (/** @type {string} */ cardId) => el(cardId)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    el('nlStatus')?.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const weeks = /** @type {HTMLElement|null} */ (target.closest('[data-open-weeks]'));
        if (weeks) {
            cards.nlWeeks?.setOpen(true);
            showWeeks(/** @type {string} */ (weeks.dataset.openWeeks));
            reveal('nlWeeksCard');
            focusChosenWeeks();
            return;
        }
        const card = /** @type {HTMLElement|null} */ (target.closest('[data-open-card]'));
        if (!card) return;
        const id = /** @type {string} */ (card.dataset.openCard);
        cards[id]?.setOpen(true);
        reveal(`${id}Card`);
        /** @type {HTMLElement|null} */ (el(`${id}Card`)?.querySelector('h2') ?? null)?.focus({ preventScroll: true });
    });
}

/** The one line a screen reader hears when the choice of colleague changes. @param {string|null} persona */
function personaStatus(persona) {
    if (!persona) return 'Showing the six one-line answers, below.';
    if (persona === 'all') return 'Showing all six, with their figures, below.';
    const p = PERSONAS.find(x => x.id === persona);
    return p ? `Showing ${ifYou(p.who).replace(/^If/, 'what it means if')}, with its figures, below.` : '';
}

/** @param {string} id */
const el = (id) => document.getElementById(id);
/** @param {string} id @param {string} html */
const setHTML = (id, html) => { const n = el(id); if (n) n.innerHTML = html; };
/** @param {string} id @param {string} text */
const setText = (id, text) => { const n = el(id); if (n) n.textContent = text; };
