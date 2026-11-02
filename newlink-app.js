// @ts-check
/**
 * newlink-app.js — coordinator for newlink.html: the three shortlisted proposals for the December 2026 link, presented to
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
 * Short Run was shown to colleagues first; In Step and Even Step were drawn up afterwards, from what they said, and all
 * three are now on the shortlist (owner, 2 Nov 2026). A slide deck shown once cannot answer "what does it mean for ME?"
 * a week later, and three decks side by side cannot be compared on a phone. So the page leads with what has changed
 * since Short Run was shown, then what all three share, then lets each colleague pick the way they work and read the
 * three against today for exactly that — the pack's one-page sheet, made into a choice.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * The admin alone while `PHASE` is 'preview' (auth-policy.js `newlink`, nav-panel.js `adminOnly`). The sign-in is the
 * app's ordinary front door rather than a protection — the proposals are public files — and the station PIN never reads
 * this page (owner: "No, signed-in only"), so it signs out on arrival like every page that does not ask for it.
 */

import { CONFIG } from './roster-data.js';
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse } from './page-session.js';
import { requirePage, canOpenOvertime } from './auth-policy.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { PROPOSALS } from './links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { PHASE, CLOSES, AUDIENCE, audienceNames, PACK_BASE, HAVE_YOUR_SAY, PREPARED_BY } from './newlink-config.js';
import { renderStatus, renderPreviewBanner, renderList, renderCommon, renderPersonas, renderPersonaChips,
    renderWeeks, renderWeeksKey, renderWeeksTabs, renderPack, designName, ifYou } from './newlink-render.js';

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
            pageLabel: 'December link',
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
    guardNamedSession({ page: 'newlink', pageLabel: 'December link', member, established });

    /** @type {(() => void)|null} */
    let openAboutLightbox = null;
    initNavPanel({
        authReady: sessionReady,
        currentPage: 'newlink',
        memberName: member,
        isAdmin: CONFIG.ADMIN_NAMES.includes(member),
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member),
        canOpenOvertime: canOpenOvertime(member),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    // initAboutLightbox returns `{ open, close }`, not a function. Taking the object whole — as this page first did, copying
    // Trains — made the drawer's logo throw instead of opening About (found 2 Nov 2026).
    openAboutLightbox = initAboutLightbox({ appLabel: 'Marylebone Roster — December link', getUserName: () => member })?.open ?? null;
    wireHeaderLogo();
    const cards = Object.fromEntries(CARDS.map(id => [id, initCardCollapse(`${id}ToggleHeader`, `${id}Body`, `${id}Chevron`)]));

    renderStatic();
    wireChoices(cards);
    markPageReady();

    sessionReady.then(() => {
        initErrorReporter();
        recordUsage('newlink', member);
        recordPageLatency('newlink', member);
    });
    sessionReady.then(() => initPasswordForce(member)).catch(() => {});
}

/** Everything that does not depend on a choice: the status, the banner, the lists, the pack, the notes. */
function renderStatic() {
    setHTML('nlStatus', renderStatus({ proposals: PROPOSALS, closes: CLOSES }));
    const banner = el('nlPreview');
    if (banner) {
        banner.hidden = PHASE !== 'preview';
        if (PHASE === 'preview') setHTML('nlPreview', renderPreviewBanner({ audience: audienceNames(), decided: !!AUDIENCE }));
    }
    setHTML('nlChangesList', renderList(CHANGES));
    setHTML('nlCommonList', renderCommon({ gains: GAINS, costs: COSTS }));
    setHTML('nlWeeksKey', renderWeeksKey());
    setHTML('nlSayList', renderList(HAVE_YOUR_SAY));
    setHTML('nlPackList', renderPack(PACK, PACK_BASE));
    setHTML('nlHowList', renderList(NOTES));
    setText('nlPrepared', PREPARED_BY);
}

/**
 * The two choices on the page — a kind of colleague, and a proposal's weeks — and what each redraws.
 * @param {Record<string, { setOpen: (open: boolean) => void }>} cards  the collapsible cards, by id prefix
 */
function wireChoices(cards) {
    /** @type {string|null} */ let persona = null;
    let design = PROPOSALS[0].id;   // A to Z: the first is first in the alphabet, not first in anyone's estimation

    const drawPersonas = () => {
        setHTML('nlPersonaChips', renderPersonaChips(PERSONAS, persona));
        setHTML('nlPersonaPanel', renderPersonas(PERSONAS, COLUMNS, persona));
    };
    const drawWeeks = () => {
        const p = PROPOSALS.find(x => x.id === design) ?? PROPOSALS[0];
        setHTML('nlWeeksTabs', renderWeeksTabs(PROPOSALS, p.id));
        setHTML('nlWeeksPanel', renderWeeks(p));
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
    /** Show one proposal's weeks, keep focus on its tab, and say so in one line. @param {string} id */
    const showWeeks = (id) => {
        design = id;
        drawWeeks();
        /** @type {HTMLElement|null} */ (el('nlWeeksTabs')?.querySelector(`[data-design="${design}"]`) ?? null)?.focus();
        const p = PROPOSALS.find(x => x.id === design);
        if (p) setText('nlWeeksStatus', `Showing ${designName(p)}’s ${Object.keys(p.patterns).length} weeks, below.`);
    };
    el('nlWeeksTabs')?.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-design]'));
        if (!b || b.dataset.design === design) return;
        showWeeks(/** @type {string} */ (b.dataset.design));
    });
    // A name tile at the top opens that proposal's weeks: the card opens if it was folded, and the page scrolls to it.
    el('nlStatus')?.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-open-weeks]'));
        if (!b) return;
        cards.nlWeeks?.setOpen(true);
        showWeeks(/** @type {string} */ (b.dataset.openWeeks));
        el('nlWeeksCard')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
}

/**
 * The header logo goes back to the Calendar, as on Admin and Operations — its alt text has always said so (CLAUDE.md →
 * "Header logo = back to calendar on sub-pages"). Keyboard-operable: the logo is an image, so it is given a button's role.
 */
function wireHeaderLogo() {
    const icon = el('appIcon');
    if (!icon) return;
    icon.setAttribute('aria-label', 'Back to calendar');
    icon.setAttribute('role', 'button');
    icon.tabIndex = 0;
    icon.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); icon.click(); } });
    icon.addEventListener('click', () => { window.location.href = './'; });
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
