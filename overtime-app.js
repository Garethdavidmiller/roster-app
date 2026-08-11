// @ts-check
/**
 * overtime-app.js — coordinator for overtime.html.
 *
 * Owns: the access gate, the session/login wiring, the two tab surfaces, and the Manager planning
 * horizon. Delegates every RULE to the server (functions/overtime-core.js) and every WORD to
 * overtime-format.js; the network lives in overtime-data.js.
 *
 * ── THE PLANNING HORIZON IS THE POINT OF THIS PAGE, NOT A CONVENIENCE ───────────────────────────
 *
 * A weekly-window system has exactly one catastrophic failure, and it happens before any document
 * exists: nobody creates the window. Then no participants exist, so nobody is outstanding, so no
 * reminder can fire, so staff see nothing — and "no window" is indistinguishable from "no overtime
 * needed this week". The clerk plans a roster from a page that is quietly empty.
 *
 * So the horizon is rendered FIRST, above the week detail, from the CALENDAR rather than from
 * Firestore, and a missed week keeps its row until its Saturday has passed. Anything that makes
 * these rows less prominent makes the feature less safe.
 *
 * ── BETA ACCESS IS A CLIENT COURTESY, NOT THE BOUNDARY ──────────────────────────────────────────
 *
 * The gate below decides what to RENDER. The real controls are elsewhere and are unaffected by it:
 * Firestore gives ordinary members nothing, and every endpoint re-checks the claim server-side.
 * Someone who types the URL sees a short "not available" panel because that is kinder than a blank
 * page — not because it stops them.
 */

import { CONFIG } from './roster-data.js';
import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { ensureNamedSession, getSession, clearSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { requirePage } from './auth-policy.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import * as OTD from './overtime-data.js';
import {
    weekLabel, weekSpan, deadlineLabel, rowStateCopy, countsCopy, shortDate,
} from './overtime-format.js';
import { CARD_TIPS } from './overtime-tips.js';
import { renderWeekForm } from './overtime-form.js';

/** Coordinator body, invoked by overtime-boot.js. Exported so a test can import without running. */
export function init() {
    // Tear down a lingering privileged Firebase identity whose local session has expired, so a
    // direct deep-link cannot keep an old credential live. Fire-and-forget, login-safe.
    reconcileExpiredIdentity().catch(() => {});

    let currentSession = getSession();
    let currentUser    = currentSession?.name ?? null;

    /** @type {any} */
    let openAboutLightbox = null;

    /** Which surfaces this identity has. Both true only for a rostered Master Admin. */
    let canReview = false;
    let canSubmit = false;
    /** Whether the member's own load FAILED, as distinct from returning nothing. */
    let mineFailed = false;

    /** The week the Manager detail card is showing, if any. @type {string|null} */
    let selectedWeek = null;
    /** The week a Create preview is currently offering, if any. @type {string|null} */
    let pendingWeek = null;

    // ── Nav + chrome, always, so an unauthorised visitor can leave ──────────────────────────────

    function wireNavPanel() {
        initNavPanel({
            currentPage: 'overtime',
            memberName: currentUser,
            isAdmin: !!currentUser && CONFIG.ADMIN_NAMES.includes(currentUser),
            isLinksDesigner: !!currentUser && CONFIG.LINKS_DESIGNERS.includes(currentUser),
            isOvertimeReviewer: reviewerByName(currentUser),
            onSignOut: currentUser ? handleSignOut : null,
            onLogoClick: () => openAboutLightbox?.(),
            usageIdentity: currentUser,
        });
    }

    /**
     * The CLIENT's guess at reviewer status, from CONFIG — a UX optimisation, never enforcement.
     * The server reads the claim; this only decides whether a tab strip is drawn.
     */
    /** @param {string|null} name */
    function reviewerByName(name) {
        if (!name) return false;
        return CONFIG.ADMIN_NAMES.includes(name) || (CONFIG.MANAGER_NAMES || []).includes(name);
    }

    function handleSignOut() {
        clearSession();
        resetNavPanel();
        location.reload();
    }

    // ── Access gate ─────────────────────────────────────────────────────────────────────────────

    // DECIDE FROM THE LOCAL SESSION, not from `getAuthSnapshot()`.
    //
    // The auth store is often still `initialising` when a coordinator runs, and `requirePageAuth`
    // maps that to `pending` — which every other page can treat as "carry on", because they admit
    // any named member. This page has a ROLE requirement, so pending-as-allow rendered the whole
    // workspace to an ordinary member for as long as the store took to settle. The data was never
    // at risk (Firestore gives them nothing and every endpoint re-checks the claim) but they were
    // shown a form they could not submit, which is worse than a clear "not yet".
    //
    // The local session is the client's own identity assertion and is available synchronously.
    // `auth-policy` is explicitly CLIENT UX rather than a boundary, so feeding it that is honest —
    // and it produces an answer immediately, which is the whole difficulty here.
    const decision = requirePage(
        { status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'overtime');

    if (decision.decision === 'login') {
        wireNavPanel();
        initLoginOverlay({
            pageLabel: 'Overtime',
            onSuccess: () => {
                currentSession = getSession();
                currentUser = currentSession?.name ?? null;
                dismissLoginOverlay();
                resetNavPanel();
                wireNavPanel();
                start();
            },
        });
        return;
    }

    if (decision.decision === 'forbidden') {
        // A named member without reviewer rights during the restricted beta. Say so briefly and
        // leave the drawer working; do not query anything, and do not imply they did wrong.
        wireNavPanel();
        renderUnavailable();
        // Nothing on this path needs Firebase, but `sessionReady` is a ONE-SHOT promise that other
        // modules await — leaving it pending would strand anything wired later on this load.
        resolveSession(false);
        return;
    }

    start();

    // ── Start ───────────────────────────────────────────────────────────────────────────────────

    function start() {
        wireNavPanel();
        openAboutLightbox = initAboutLightbox();
        initTipsLightbox(CARD_TIPS, { getIsAdmin: () => !!currentUser && CONFIG.ADMIN_NAMES.includes(currentUser) });
        // Per card, with its own ids — the shared helper takes them explicitly. A bare call is
        // silently a no-op, which would leave every chevron on the page inert.
        initCardCollapse('otMineToggleHeader',    'otMineBody',    'otMineChevron');
        initCardCollapse('otHorizonToggleHeader', 'otHorizonBody', 'otHorizonChevron');
        initCardCollapse('otWeekToggleHeader',    'otWeekBody',    'otWeekChevron');
        registerServiceWorker();

        canReview = reviewerByName(currentUser);
        wireTabs();

        // ESTABLISH the Firebase session, then fulfil `sessionReady`. Nothing else does this: the
        // promise is created pending in session.js and resolved only by whichever coordinator owns
        // the page. Awaiting it without calling this is a page that loads and then waits for ever —
        // no error, no timeout, just "Loading…" — which is exactly what it did until this line.
        resolveSession(currentUser ? ensureNamedSession(currentUser) : false);

        sessionReady.then(() => {
            initErrorReporter();
            recordUsage('overtime', currentUser);
            recordPageLatency('overtime', currentUser);
            return loadEverything();
        }).catch(() => {
            renderError(document.getElementById('otMineContent'));
        });

        wireConfirmBar();
    }

    async function loadEverything() {
        await Promise.all([loadMine(), canReview ? loadHorizon() : Promise.resolve()]);
        // The tab strip appears only once BOTH surfaces are known to exist. Drawing it from the
        // CONFIG guess would flash a tab at a reviewer who turns out to have no form of their own.
        const tabs = el('otTabs');
        if (tabs) tabs.hidden = !(canReview && canSubmit);
        // Switch a reviewer to the workspace only when their own side genuinely has nothing —
        // never when it FAILED. Switching on failure hides the error the member is looking at and
        // replaces it with a different card, which reads as the page ignoring them.
        if (canReview && !canSubmit && !mineFailed) showPanel('all');
    }

    // ── My availability ─────────────────────────────────────────────────────────────────────────

    async function loadMine() {
        const host = el('otMineContent');
        if (!host) return;
        renderLoading(host, 'Loading your forms…');
        mineFailed = false;
        const r = await OTD.getMyOvertimeState();
        if (!r.ok) { mineFailed = true; renderError(host); return; }

        const windows = r.data.windows || [];
        canSubmit = windows.length > 0;

        if (!windows.length) {
            // A SUCCESSFUL response with nothing open. Deliberately different copy from the error
            // state below: an empty screen used for both is the commonest way a page lies about
            // itself, and this is the state most members will meet most weeks.
            host.innerHTML = `
                <div class="ot-state">
                    <span class="ot-state-icon" aria-hidden="true">📭</span>
                    No overtime availability forms are open for you right now.
                </div>`;
            return;
        }

        // One open week is the ordinary case, and a list-then-tap for a single item is a tap that
        // exists only to satisfy the shape of the code. So one week opens straight into its form;
        // several get the list, which is where the choice actually matters.
        // ONE window opens straight into its form — including a closed one, which is read-only but
        // is still the thing the member came to look at. A list-then-tap for a single item is a tap
        // that exists only to satisfy the shape of the code.
        const open = windows.filter((/** @type {any} */ w) => w.phase !== 'CLOSED');
        const solo = open.length === 1 ? open[0] : (windows.length === 1 ? windows[0] : null);
        if (solo) {
            const holder = document.createElement('div');
            host.innerHTML = '';
            host.appendChild(holder);
            await renderWeekForm(holder, solo, String(currentUser), { onSaved: () => { /* head refreshes on next load */ } });
            if (windows.length > 1) appendHistory(host, windows.filter((/** @type {any} */ w) => w !== solo));
            return;
        }

        host.innerHTML = `<div class="ot-week-list">${
            windows.map(renderMyWeekRow).join('')}</div>`;
        host.querySelectorAll('[data-openweek]').forEach(btn =>
            btn.addEventListener('click', async () => {
                const week = String(btn.getAttribute('data-openweek'));
                const w = windows.find((/** @type {any} */ x) => x.weekEnding === week);
                if (!w) return;
                const holder = document.createElement('div');
                host.innerHTML = '';
                host.appendChild(holder);
                await renderWeekForm(holder, w, String(currentUser), { onSaved: () => {} });
            }));
    }

    /** Closed weeks, listed under the live form so history is present without competing with it. */
    /** @param {HTMLElement} host @param {any[]} past */
    function appendHistory(host, past) {
        if (!past.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'ot-history';
        wrap.innerHTML = `<div class="ot-history-title">Previous forms</div>
            <div class="ot-week-list">${past.map(renderMyWeekRow).join('')}</div>`;
        host.appendChild(wrap);
    }

    /** One of the member's own weeks. The form itself arrives in the next step. */
    /** @param {any} w */
    function renderMyWeekRow(w) {
        const submitted = !!w.submission;
        const tone = submitted ? 'ok' : (w.phase === 'CLOSED' ? 'bad' : 'warn');
        const state = submitted
            ? (w.phase === 'CLOSED' ? 'Final availability recorded' : 'Submitted — you can still change it')
            : (w.phase === 'CLOSED' ? 'Closed — no form was submitted' : 'Not submitted yet');
        return `
            <div class="ot-week-row ot-week-row--${tone}">
                <div class="ot-week-main">
                    <div class="ot-week-title">${esc(weekLabel(w.weekEnding))}</div>
                    <div class="ot-week-meta">
                        Roster week ${esc(weekSpan(w.weekStart, w.weekEnding))}<br>
                        Final changes close ${esc(deadlineLabel(w.finalDeadlineAt))}
                    </div>
                    <span class="ot-week-state ot-week-state--${tone}">${esc(state)}</span>
                </div>
                <div class="ot-week-actions">
                    <button type="button" class="ot-row-btn${w.phase === 'CLOSED' ? '' : ' ot-row-btn--primary'}"
                            data-openweek="${esc(w.weekEnding)}">${w.phase === 'CLOSED' ? 'View' : 'Open'}</button>
                </div>
            </div>`;
    }

    // ── Upcoming weeks (the planning horizon) ───────────────────────────────────────────────────

    async function loadHorizon() {
        const host = el('otHorizonContent');
        if (!host) return;
        renderLoading(host, 'Loading upcoming weeks…');
        const r = await OTD.getOvertimeManagerOverview();
        if (!r.ok) { renderError(host); return; }

        const weeks = r.data.planningWeeks || [];
        const missing = weeks.filter((/** @type {any} */ w) => !w.exists).length;
        const chip = el('otHorizonChip');
        if (chip) {
            // The chip counts what is MISSING, not what exists. A card headed "Upcoming weeks · 6"
            // would be reassuring and say nothing; "2 without a form" is the number worth seeing
            // from a collapsed card.
            chip.textContent = missing ? `${missing} without a form` : 'All created';
            chip.hidden = false;
        }
        host.innerHTML = `<div class="ot-week-list">${weeks.map(renderHorizonRow).join('')}</div>`;
        host.querySelectorAll('[data-create]').forEach(btn =>
            btn.addEventListener('click', () => previewWindow(String(btn.getAttribute('data-create')))));
        host.querySelectorAll('[data-open]').forEach(btn =>
            btn.addEventListener('click', () => selectWeek(String(btn.getAttribute('data-open')))));
    }

    /** @param {any} w */
    function renderHorizonRow(w) {
        const { label, tone } = rowStateCopy(w.state);
        const counts = w.exists ? countsCopy(w.expected || 0, w.received || 0) : '';
        const action = w.exists
            ? `<button type="button" class="ot-row-btn" data-open="${esc(w.weekEnding)}"
                       aria-pressed="${selectedWeek === w.weekEnding}">View</button>`
            : (w.canCreate
                ? `<button type="button" class="ot-row-btn ot-row-btn--primary" data-create="${esc(w.weekEnding)}">Create</button>`
                : '');
        return `
            <div class="ot-week-row ot-week-row--${tone}">
                <div class="ot-week-main">
                    <div class="ot-week-title">${esc(weekLabel(w.weekEnding))}</div>
                    <div class="ot-week-meta">
                        Initial deadline ${esc(deadlineLabel(w.initialDeadlineAt))} ·
                        final ${esc(deadlineLabel(w.finalDeadlineAt))}
                        ${counts ? `<br>${esc(counts)}` : ''}
                    </div>
                    <span class="ot-week-state ot-week-state--${tone}">${esc(label)}</span>
                </div>
                <div class="ot-week-actions">${action}</div>
            </div>`;
    }

    // ── Creating a window ───────────────────────────────────────────────────────────────────────

    /**
     * Preview first, always. The server runs the SAME code for the preview and the commit, so what
     * a reviewer approves here is exactly what gets created — and the participant count is the part
     * worth approving, because during the restricted beta it is one rather than the whole team.
     */
    /** @param {string} weekEnding */
    async function previewWindow(weekEnding) {
        const r = await OTD.createOvertimeWindow(weekEnding, { dryRun: true });
        if (!r.ok) { flashConfirm(`Couldn't prepare that week (${esc(r.code)}).`, false); return; }
        const w = r.data.window;
        pendingWeek = weekEnding;
        const bar = el('otConfirmBar');
        const text = el('otConfirmText');
        if (text) {
            text.innerHTML = `Open the availability form for <strong>${esc(weekLabel(weekEnding))}</strong>?<br>`
                + `Roster week ${esc(weekSpan(w.weekStart, w.weekEnding))} · `
                + `initial deadline ${esc(deadlineLabel(w.initialDeadlineAt))}<br>`
                + `<strong>${w.audience === 'restricted' ? 'Beta audience' : 'All eligible staff'}</strong> · `
                + `${w.expectedCount} expected ${w.expectedCount === 1 ? 'participant' : 'participants'}`;
        }
        if (bar) bar.hidden = false;
    }

    function wireConfirmBar() {
        el('otConfirmCancel')?.addEventListener('click', () => {
            pendingWeek = null;
            const bar = el('otConfirmBar'); if (bar) bar.hidden = true;
        });
        el('otConfirmCreate')?.addEventListener('click', async () => {
            if (!pendingWeek) return;
            const btn = /** @type {HTMLButtonElement} */ (el('otConfirmCreate'));
            btn.disabled = true;
            const week = pendingWeek;
            const r = await OTD.createOvertimeWindow(week, { dryRun: false });
            btn.disabled = false;
            if (!r.ok) {
                // A timeout on a CREATE is not a failure — the window may exist. Say so, and say
                // what to do, rather than inviting a second create that would look like a failure
                // too (it would return the existing window, which is right, but reads as confusing).
                flashConfirm(r.code === 'timeout'
                    ? 'Timed out waiting for the server. The week may still have been created — close this and check the list.'
                    : `Couldn't create that week (${esc(r.code)}).`, false);
                return;
            }
            pendingWeek = null;
            const bar = el('otConfirmBar'); if (bar) bar.hidden = true;
            await loadHorizon();
            selectWeek(week);
        });
    }

    /** @param {string} html @param {boolean} ok */
    function flashConfirm(html, ok) {
        const text = el('otConfirmText');
        if (text) text.innerHTML = html;
        const bar = el('otConfirmBar');
        if (bar) bar.hidden = false;
        if (ok) setTimeout(() => { if (bar) bar.hidden = true; }, 2500);
    }

    // ── Week detail (filled in by the Manager workspace step) ───────────────────────────────────

    /** @param {string} weekEnding */
    function selectWeek(weekEnding) {
        selectedWeek = weekEnding;
        const card = el('otWeekCard');
        const hint = el('otWeekHint');
        const host = el('otWeekContent');
        if (card) card.hidden = false;
        if (hint) hint.textContent = weekLabel(weekEnding);
        if (host) renderLoading(host, 'Loading availability…');
        document.querySelectorAll('[data-open]').forEach(b =>
            b.setAttribute('aria-pressed', String(b.getAttribute('data-open') === weekEnding)));
        card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        renderWeekDetail(weekEnding);
    }

    /** Placeholder until the Manager workspace lands; the horizon is the commit's deliverable. */
    /** @param {string} weekEnding */
    function renderWeekDetail(weekEnding) {
        const host = el('otWeekContent');
        if (!host) return;
        host.innerHTML = `
            <div class="ot-state">
                <span class="ot-state-icon" aria-hidden="true">👥</span>
                The by-day view for ${esc(shortDate(weekEnding))} is being built.
            </div>`;
    }

    // ── Tabs ────────────────────────────────────────────────────────────────────────────────────

    function wireTabs() {
        el('otTabMine')?.addEventListener('click', () => showPanel('mine'));
        el('otTabAll')?.addEventListener('click', () => showPanel('all'));
        // Left/right arrows move between tabs, which is what a tablist is expected to do; without
        // it the roving tabindex below strands a keyboard user on whichever tab loaded selected.
        for (const id of ['otTabMine', 'otTabAll']) {
            el(id)?.addEventListener('keydown', (/** @type {any} */ e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                showPanel(id === 'otTabMine' ? 'all' : 'mine', true);
            });
        }
    }

    /** @param {'mine'|'all'} which @param {boolean} [focus] */
    function showPanel(which, focus = false) {
        const mine = which === 'mine';
        toggleTab('otTabMine', mine, focus);
        toggleTab('otTabAll', !mine, focus);
        const minePanel = el('otMinePanel');
        const allPanel  = el('otAllPanel');
        if (minePanel) minePanel.hidden = !mine;
        if (allPanel)  allPanel.hidden = mine;
    }

    /** @param {string} id @param {boolean} selected @param {boolean} [focus] */
    function toggleTab(id, selected, focus) {
        const t = el(id);
        if (!t) return;
        t.setAttribute('aria-selected', String(selected));
        t.setAttribute('tabindex', selected ? '0' : '-1');
        if (selected && focus) t.focus();
    }

    // ── Shared render helpers ───────────────────────────────────────────────────────────────────

    /** @param {any} host @param {string} message */
    function renderLoading(host, message) {
        if (host) host.innerHTML = `<div class="ot-state">${esc(message)}</div>`;
    }

    /** @param {any} host */
    function renderError(host) {
        if (!host) return;
        host.innerHTML = `
            <div class="ot-state ot-state--error">
                <span class="ot-state-icon" aria-hidden="true">⚠️</span>
                Couldn't load overtime availability.
                <div class="ot-state-actions">
                    <button type="button" class="ot-row-btn ot-retry">Try again</button>
                </div>
            </div>`;
        // A CLASS, not an id: both cards can fail on the same load, and two elements sharing an id
        // is invalid markup that also breaks every id-based lookup — including this one's.
        host.querySelector('.ot-retry')?.addEventListener('click', () => loadEverything());
    }

    function renderUnavailable() {
        const mine = el('otMineContent');
        const tabs = el('otTabs');
        const allPanel = el('otAllPanel');
        if (tabs) tabs.hidden = true;
        if (allPanel) allPanel.hidden = true;
        if (mine) {
            mine.innerHTML = `
                <div class="ot-state">
                    <span class="ot-state-icon" aria-hidden="true">🔒</span>
                    Overtime availability isn't open to everyone yet. Your manager will let you know
                    when it is.
                </div>`;
        }
    }

    /**
     * A `function` declaration, NOT `const el = id => …`.
     *
     * `start()` is called from the access gate near the top of `init()`, long before the bottom of
     * the function body executes — and a `const` arrow is in the temporal dead zone until its own
     * line runs, so every call threw "Cannot access 'el' before initialization" and the page
     * rendered its shell and then silently did nothing. Function declarations hoist; that is the
     * whole reason this one is a declaration.
     * @param {string} id
     */
    function el(id) { return document.getElementById(id); }

    /** Escape for interpolation into innerHTML. Every dynamic value below goes through it. */
    /** @param {any} s */
    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}
