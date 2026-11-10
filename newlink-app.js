// @ts-check
/**
 * newlink-app.js — coordinator for newlink.html: the three shortlisted proposals for the new CEA link (from January 2027), presented to
 * the colleagues who will work it.
 *
 * Owns: the access gate, the session wiring, and which view is on screen — the kind of colleague chosen in "What it means
 * if you…" and the proposal whose weeks are drawn. Every word of HTML is `newlink-render.js`; every figure is the
 * generated `newlink-data.js` (from the pack's own tooling, docs/links-26/tooling/newlink-data.mjs); every decision —
 * the phase, the closing date, the audience — is `newlink-config.js`. Nothing here reads the network: once opened, the
 * page works offline.
 *
 * ── WHY THE PAGE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * Short Run was shown to colleagues first; the designs beside it were drawn up afterwards, and since 8 Nov 2026 the shortlist
 * is Balanced V6, Level Crossing and Middle Ground, each keeping closing weeks apart (Short Run left it then). A slide deck shown once
 * cannot answer "what does it mean for ME?" a week later, and three decks side by side cannot be compared on a phone. So
 * the page leads with what has changed since Short Run was shown, then what all three share, then lets each colleague
 * pick the way they work and read the three against today for exactly that — the pack's one-page sheet, made into a choice.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * Every colleague on a normal CEA contract and the managers, since `PHASE` became 'open' (v25.60, owner, 9 Nov 2026), with
 * the admin and the named previewers (CONFIG.NEWLINK_PREVIEW, v25.33), who had it alone while it was a preview (auth-policy.js
 * `newlink`, nav-panel.js `newlinkAudienceOnly`, both read through `canOpenNewlink`). The sign-in is the
 * app's ordinary front door rather than a protection — the proposals are public files — and the station PIN never reads
 * this page (owner: "No, signed-in only"), so it signs out on arrival like every page that does not ask for it.
 */

import { CONFIG, formatISO } from './roster-data.js';
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
import { PROPOSALS } from './links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { CLOSES, STARTS, TIMETABLE_STARTS, PACK_BASE, HAVE_YOUR_SAY, CHOSEN, CONTACT } from './newlink-config.js';
import { renderStatus, statusPhase, statusHint, renderList, renderCommon, renderPersonas, renderPersonaChips,
    renderAllWeeks, renderWeeksKey, renderWeeksTabs, renderPack, designName, ifYou, aToZ } from './newlink-render.js';

/** The collapsible cards, by the id prefix their header, body and chevron share. */
const CARDS = ['nlChanges', 'nlCommon', 'nlMeans', 'nlWeeks', 'nlSay', 'nlPack', 'nlHow'];

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
            pageLabel: 'New link',
            onSuccess: () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } },
        });
        return;
    }
    if (access.decision === 'forbidden') {
        // Signed in, not in the audience: back to the roster, quietly. The pill is not offered to them either.
        window.location.replace('./');
        return;
    }
    start(/** @type {string} */ (currentUser));
}

/** The page, for a signed-in member the policy admits. @param {string} member */
function start(member) {
    dismissLoginOverlay();
    const established = ensureNamedSession(member);
    resolveSession(established);
    guardNamedSession({ page: 'newlink', pageLabel: 'New link', member, established });

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
    const cards = Object.fromEntries(CARDS.map(id => [id, initCardCollapse(`${id}ToggleHeader`, `${id}Body`, `${id}Chevron`)]));

    renderStatic();
    wireChoices(cards);
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
 * Everything that does not depend on a choice: the status, the lists, the pack, the notes. NO PREVIEW BANNER (owner, 8 Nov
 * 2026: "Remove the preview banner as it will be going live soon"): the admin and the named previewers see exactly what
 * colleagues will, and who the page will reach is newlink-config.js → AUDIENCE, held to the roster by its test.
 */
function renderStatic() {
    drawStatus();
    setHTML('nlChangesList', renderList(CHANGES));
    setHTML('nlCommonList', renderCommon({ gains: GAINS, costs: COSTS }));
    setHTML('nlWeeksKey', renderWeeksKey());
    setHTML('nlSayList', renderList(HAVE_YOUR_SAY));
    setHTML('nlPackList', renderPack(PACK, PACK_BASE));
    setHTML('nlHowList', renderList(NOTES));
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
