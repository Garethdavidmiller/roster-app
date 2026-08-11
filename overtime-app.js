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
import { requirePage, isOvertimeReviewer, canOpenOvertime } from './auth-policy.js';
import { initCardCollapse, confirmDialog } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import * as OTD from './overtime-data.js';
import {
    weekLabel, weekSpan, deadlineLabel, rowStateCopy, countsCopy, shouldResyncClock,
} from './overtime-format.js';
import { CARD_TIPS } from './overtime-tips.js';
import { renderWeekForm } from './overtime-form.js';
import { renderWeekDetail as paintWeekDetail } from './overtime-manager.js';

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
    /** The planning rows from the last overview, keyed by week. @type {Map<string, any>} */
    const horizonByWeek = new Map();
    /** The week a Create preview is currently offering, if any. @type {string|null} */
    let pendingWeek = null;

    /** The member's windows as last fetched — what the deadline resync compares against. */
    /** @type {any[]} */
    let myWindows = [];
    /** One resync in flight at a time; a second visibilitychange mid-read must not stack. */
    let resyncing = false;
    /** The form currently on screen — the `{ isDirty, setPhase }` handle it returned. @type {any} */
    let currentForm = null;
    /** Which week that form is for, so a resync knows whether a moved window is the visible one. */
    /** @type {string|null} */
    let currentFormWeek = null;

    // ── Nav + chrome, always, so an unauthorised visitor can leave ──────────────────────────────

    function wireNavPanel() {
        initNavPanel({
            currentPage: 'overtime',
            memberName: currentUser,
            isAdmin: !!currentUser && CONFIG.ADMIN_NAMES.includes(currentUser),
            isLinksDesigner: !!currentUser && CONFIG.LINKS_DESIGNERS.includes(currentUser),
            canOpenOvertime: canOpenOvertime(currentUser),
            onSignOut: currentUser ? handleSignOut : null,
            onLogoClick: () => openAboutLightbox?.(),
            usageIdentity: currentUser,
        });
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

        canReview = isOvertimeReviewer(currentUser);
        wireTabs();
        // The page opens on the member's own form, so that is the print state until told otherwise.
        // Set here rather than left undefined: an unset attribute would make the print rules fall
        // through to whichever branch happened to be written last, on the one surface where a
        // wrong answer prints a page of blank capsules and gets taken to a desk.
        document.body.dataset.otView = 'mine';

        // ESTABLISH the Firebase session, then fulfil `sessionReady`. Nothing else does this: the
        // promise is created pending in session.js and resolved only by whichever coordinator owns
        // the page. Awaiting it without calling this is a page that loads and then waits for ever —
        // no error, no timeout, just "Loading…" — which is exactly what it did until this line.
        resolveSession(currentUser ? ensureNamedSession(currentUser) : false);

        // ── THE `ready` MILESTONE IS LATE ON THIS PAGE, AND THAT IS THE POINT ───────────────────
        //
        // This page's shell is a row of "Loading…" placeholders, and its content needs TWO network
        // round trips before any of it can be used: `getMyOvertimeState`, then the member's roster
        // behind the form. `domReady` fires at the first of those and `fcp` paints the placeholder,
        // so the two metrics the App Speed card had would both have called this page ready while
        // it was still empty — the same mis-measurement `markPageReady` was written for at v20.80,
        // and worse here than on the pages it was written for, because those are waiting on auth
        // rather than on data.
        //
        // `recordPageLatency` therefore moves AFTER the load — the mark has to exist before the
        // read, which is why the three `auth-ready` pages get away with marking synchronously. It
        // is in a `finally`, not the success path: a page that failed to load still took time, and
        // dropping its sample would quietly bias the figures towards loads that went well.
        sessionReady.then(() => {
            initErrorReporter();
            recordUsage('overtime', currentUser);
            return loadEverything();
        }).then(() => {
            // Not marked when the member's own surface FAILED. An error is not a usable page, and
            // an absent `ready` is rendered as "—" by the card, which is honest — where a number
            // would be a measurement of something nobody could use.
            if (!mineFailed) markPageReady();
        }).catch(() => {
            renderError(document.getElementById('otMineContent'));
        }).finally(() => {
            recordPageLatency('overtime', currentUser);
        });

        wireConfirmBar();
        wireDeadlineResync();
    }

    /**
     * Keep the page honest across a deadline it sat open through.
     *
     * `shouldResyncClock` and its five-minute window have existed since v20.69 with nothing
     * calling them — a member who opened the form at 11:50 was still told "open" at 12:05. The
     * realistic shape of that failure is a phone pocketed and re-woken, so the trigger is the page
     * BECOMING VISIBLE near a deadline, not a timer: a timer burns battery all afternoon to catch
     * a case that, when it matters, always arrives through this event.
     *
     * ── IT RE-RENDERS ONLY WHEN A PHASE ACTUALLY CHANGED, AND THEN ONLY IF IT MUST ──────────────
     *
     * The blunt version — reload the card whenever the window is near a deadline — would WIPE a
     * half-filled form under the member's thumb, which is worse than the stale line it fixes. So
     * this re-reads state (which also refreshes the clock offset that `submitDisposition` uses) and
     * compares phases.
     *
     * Until v20.86 ANY phase move then reloaded, with a comment reasoning that a member mid-form
     * whose week just closed loses their picks and the server would have refused them anyway. That
     * is true of `FINAL_OPEN → CLOSED`. It is not true of `INITIAL_OPEN → FINAL_OPEN`, where the
     * form stays fully submittable — so there the reload destroyed work for nothing, and the
     * realistic case is exactly the one this whole function was written for: answering at 11:58,
     * pocket, reopen at 12:02, five days' answers gone. The window is ±5 minutes of EITHER deadline,
     * so it is the initial deadline that most often triggers it.
     *
     * A still-open move is therefore handed to the form to absorb (`setPhase` repaints the head and
     * touches nothing else). Only a form that must lose its controls is rebuilt.
     */
    function wireDeadlineResync() {
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden || resyncing || !myWindows.length) return;
            const deadlines = myWindows.flatMap(
                (/** @type {any} */ w) => [w.initialDeadlineAt, w.finalDeadlineAt]).filter(Boolean);
            if (!shouldResyncClock(OTD.correctedNow(), deadlines)) return;
            resyncing = true;
            try {
                const r = await OTD.getMyOvertimeState();
                if (!r.ok) return;
                const phases = new Map((r.data.windows || []).map(
                    (/** @type {any} */ w) => [w.weekEnding, w.phase]));
                const moved = myWindows.filter(
                    (/** @type {any} */ w) => phases.get(w.weekEnding)
                        && phases.get(w.weekEnding) !== w.phase);
                if (!moved.length) return;
                // Record every move on the window objects — the week LIST rows read `phase` too, and
                // leaving them stale would be the same lie in a quieter place.
                for (const w of moved) w.phase = phases.get(w.weekEnding);
                // The form on screen is the only one that can absorb a change in place. If it took
                // the new phase, nothing else is needed; if it refused (it is closing), rebuild.
                const onScreen = currentForm && currentFormWeek
                    && moved.some((/** @type {any} */ w) => w.weekEnding === currentFormWeek);
                if (onScreen && currentForm.setPhase(phases.get(currentFormWeek))) return;
                await loadMine();
            } finally {
                resyncing = false;
            }
        });
    }

    /**
     * Ask before throwing away answers the member has not submitted.
     *
     * Everything on this page that shows a form REPLACES the card body to do it — opening another
     * week, going back to the list, a resync that has to rebuild. None of them could see that the
     * form held unsaved work, because the answers live inside `renderWeekForm`'s closure; the handle
     * it now returns is what makes the question askable at all.
     *
     * Deliberately NOT persisted. A draft in localStorage would be a second, invisible copy of a
     * declaration about somebody's own availability, surviving sign-out on a shared station PC and
     * capable of disagreeing with the server. In-session is the whole requirement: the loss this
     * prevents happens seconds later, on the same page.
     * @returns {Promise<boolean>} true when it is safe to proceed
     */
    async function confirmDiscard() {
        if (!currentForm?.isDirty()) return true;
        return confirmDialog({
            title: 'Leave without submitting?',
            message: 'You have answers on this form that have not been submitted. '
                + 'They will be lost if you leave it now.',
            confirmLabel: 'Leave',
            cancelLabel: 'Stay on this form',
        });
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
        // The form on screen is about to be replaced whatever happens below, so the handle to it
        // must go now. A stale one would let a later resync call `setPhase` on a detached node —
        // and, worse, let `confirmDiscard` warn about unsaved answers that are no longer anywhere.
        currentForm = null;
        currentFormWeek = null;
        const r = await OTD.getMyOvertimeState();
        if (!r.ok) { mineFailed = true; renderError(host); return; }

        const windows = r.data.windows || [];
        myWindows = windows;
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

        await renderMine(host, windows);
    }

    /**
     * The member lands IN a form, never on a list of forms.
     *
     * ── WHY THIS IS NOT A PICKER ────────────────────────────────────────────────────────────────
     *
     * This used to open a form directly only when exactly ONE window was open, and show a
     * tap-through list otherwise — reasonable when a reviewer created one week at a time, so one
     * open window was the ordinary case and a list meant a genuine choice.
     *
     * Automatic creation (v20.61) fills the whole six-week horizon, and a window stays open until
     * eleven days before its week, so **four or five are open simultaneously, permanently**. The
     * list stopped being the exception and became the only path: every member, every visit, tapped
     * through an index before reaching anything they could fill in. That is a step that exists
     * because of how the weeks are made, which is not a fact the member should have to care about.
     *
     * So a form is rendered directly, the other open weeks are listed beneath it for anyone who
     * wants to answer further ahead, and closed weeks below that as history. Nothing is hidden; the
     * ordering just matches the urgency.
     *
     * ── SOONEST-CLOSING, BUT ONLY AMONG THE ONES STILL TO DO (v20.86) ───────────────────────────
     *
     * It was the soonest-closing OPEN week full stop, which lands on a form that is already
     * submitted whenever the nearest deadline belongs to a week the member has dealt with. The
     * question the page is answering is "what do I need to do?", and a completed form is not an
     * answer to it — so the member arrives at a green screen with the outstanding week one tap away
     * in a list, which costs response rate for no reason.
     *
     * The fallback order still matters: an all-submitted member lands on the soonest-closing form
     * (their most recent work, and the one they might still amend), and a member with nothing open
     * lands on the newest closed week, read-only. Neither is a dead end.
     *
     * @param {HTMLElement} host @param {any[]} windows
     */
    async function renderMine(host, windows) {
        const open = windows.filter((/** @type {any} */ w) => w.phase !== 'CLOSED')
            .sort((/** @type {any} */ a, /** @type {any} */ b) => a.finalDeadlineAt - b.finalDeadlineAt);
        const closed = windows.filter((/** @type {any} */ w) => w.phase === 'CLOSED');
        // With nothing open, the newest CLOSED week is still what they came to look at (read-only).
        const lead = open.find((/** @type {any} */ w) => !w.submission)
            || open[0] || closed[closed.length - 1];
        if (!lead) return;

        const holder = document.createElement('div');
        host.innerHTML = '';
        host.appendChild(holder);
        // Re-render the LISTS after a save, not the form: the row for a week just submitted has to
        // stop saying "Not submitted yet", and the outstanding-count nudge below has to recount.
        // Re-rendering the form as well would throw away the confirmation the member is reading.
        currentForm = await renderWeekForm(holder, lead, String(currentUser),
            { onSaved: () => paintLists() });
        currentFormWeek = lead.weekEnding;
        paintLists();

        function paintLists() {
            while (holder.nextSibling) host.removeChild(holder.nextSibling);
            appendWeekList(host, open.filter((/** @type {any} */ w) => w !== lead),
                'Other open weeks', windows);
            appendWeekList(host, closed.filter((/** @type {any} */ w) => w !== lead),
                'Previous forms', windows);
            appendOutstandingNudge(host, open, lead);
        }
    }

    /**
     * "1 other form still needs a response" — the one nudge this page makes.
     *
     * Placed under the lists rather than in the form's own feedback line, because it is about the
     * OTHER weeks and it has to survive the member reading their confirmation. It states a count and
     * stops: no exclamation, no countdown, and nothing at all when every open form is answered,
     * which is the state most members are in most weeks and does not need congratulating.
     * @param {HTMLElement} host @param {any[]} open @param {any} lead
     */
    function appendOutstandingNudge(host, open, lead) {
        const waiting = open.filter((/** @type {any} */ w) => w !== lead && !w.submission);
        if (!waiting.length || !lead.submission) return;
        const note = document.createElement('div');
        note.className = 'ot-outstanding';
        note.setAttribute('role', 'status');
        note.textContent = waiting.length === 1
            ? '1 other form still needs a response.'
            : `${waiting.length} other forms still need a response.`;
        host.appendChild(note);
    }

    /**
     * A labelled list of OTHER weeks, under the form. Empty lists render nothing — a heading over
     * no rows is a section that looks like it failed to load.
     * @param {HTMLElement} host @param {any[]} rows @param {string} title @param {any[]} all
     */
    function appendWeekList(host, rows, title, all) {
        if (!rows.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'ot-history';
        wrap.innerHTML = `<div class="ot-history-title">${esc(title)}</div>
            <div class="ot-week-list">${rows.map(renderMyWeekRow).join('')}</div>`;
        host.appendChild(wrap);
        // These rows carry the same View/Open button the list did, so they need the same wiring.
        // Without it they are buttons that do nothing, which reads as a broken page.
        //
        // WIRE THE NEW WRAPPER, NOT THE WHOLE HOST. This searched `host` until v20.69, and this
        // function is called twice — once for the open weeks, once for the closed ones — so the
        // second call found the FIRST list's buttons again and gave each of them a second listener.
        // One tap then ran the whole open-a-week routine twice: two roster reads, two full form
        // renders, and the first render landing in a node the second had already detached. Nothing
        // visibly broke, which is why it survived; it is a duplicate-invocation bug sitting one
        // non-idempotent line away from being a real one.
        wireWeekButtons(wrap, host, all);
    }

    /**
     * Give every `data-openweek` button in `scope` its handler. One place, because the rows are
     * rendered from two call sites and a button wired in only one of them is a dead control.
     * @param {HTMLElement} scope the container just rendered — never an ancestor holding earlier rows
     * @param {HTMLElement} cardHost the card body the opened form replaces (`scope` is inside it)
     * @param {any[]} windows
     */
    function wireWeekButtons(scope, cardHost, windows) {
        scope.querySelectorAll('[data-openweek]').forEach(btn =>
            btn.addEventListener('click', async () => {
                const week = String(btn.getAttribute('data-openweek'));
                const w = windows.find((/** @type {any} */ x) => x.weekEnding === week);
                if (!w) return;
                // Opening another week DESTROYS the form on screen. Ask first if it holds work.
                if (!await confirmDiscard()) return;
                const holder = document.createElement('div');
                cardHost.innerHTML = '';
                cardHost.appendChild(holder);
                currentForm = await renderWeekForm(holder, w, String(currentUser), { onSaved: () => {} });
                currentFormWeek = w.weekEnding;
                // A way BACK to the list. Opening a week replaces the whole card, so without this
                // the member is stranded on one form with no route to the others.
                if (windows.length > 1) appendBackToList(cardHost, windows);
            }));
    }

    /** @param {HTMLElement} host @param {any[]} windows */
    function appendBackToList(host, windows) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'ot-row-btn ot-back-to-list';
        back.textContent = '← Back to my current form';
        // Back to the layout they LANDED on — the soonest-closing unanswered form with the other
        // weeks beneath it. Returning to a bare index would reintroduce the very step
        // this arrangement removes, one tap further in.
        back.addEventListener('click', async () => {
            if (await confirmDiscard()) renderMine(host, windows);
        });
        host.appendChild(back);
    }

    /** One of the member's own weeks, as a row in a list. */
    /** @param {any} w */
    function renderMyWeekRow(w) {
        const submitted = !!w.submission;
        const tone = submitted ? 'ok' : (w.phase === 'CLOSED' ? 'bad' : 'warn');
        // Four states, one voice — what YOU did, then what that means now. The old set mixed a
        // passive record-keeping register ("Final availability recorded", "no form was submitted")
        // into a list otherwise written to the member.
        const state = submitted
            ? (w.phase === 'CLOSED' ? 'Submitted — now final' : 'Submitted — you can still change it')
            : (w.phase === 'CLOSED' ? 'Nothing was submitted' : 'Not submitted yet');
        return `
            <div class="ot-week-row ot-week-row--${tone}">
                <div class="ot-week-main">
                    <div class="ot-week-title">${esc(weekLabel(w.weekEnding))}</div>
                    <div class="ot-week-meta">
                        ${esc(weekSpan(w.weekStart, w.weekEnding))}<br>
                        ${w.phase === 'CLOSED'
                            ? `Closed ${esc(deadlineLabel(w.finalDeadlineAt))}`
                            : `Closes ${esc(deadlineLabel(w.finalDeadlineAt))}`}
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
        horizonByWeek.clear();
        for (const w of weeks) horizonByWeek.set(w.weekEnding, w);
        const missing = weeks.filter((/** @type {any} */ w) => !w.exists).length;
        const chip = el('otHorizonChip');
        if (chip) {
            // The chip counts what is MISSING, not what exists. A card headed "Upcoming weeks · 6"
            // would be reassuring and say nothing; "2 without a form" is the number worth seeing
            // from a collapsed card.
            chip.textContent = missing ? `${missing} without a form` : 'All created';
            chip.hidden = false;
        }
        // PAST WEEKS. The server has always sent `retained` — every week still inside the 13-week
        // retention, newest first — and this page fetched it and threw it away. So the moment a
        // week's Saturday passed, its submissions became unreachable, while the member's own screen
        // promised "forms are kept for around 13 weeks". A reviewer asking "who was available the
        // week we made that call?" had no answer in the app, from data already crossing the wire.
        const shown = new Set(weeks.map((/** @type {any} */ w) => w.weekEnding));
        const past = (r.data.retained || [])
            .filter((/** @type {any} */ w) => !shown.has(w.weekEnding));
        for (const w of past) horizonByWeek.set(w.weekEnding, w);

        host.innerHTML = `<div class="ot-week-list">${weeks.map(renderHorizonRow).join('')}</div>`
            + (past.length ? `
                <div class="ot-history">
                    <div class="ot-history-title">Previous weeks</div>
                    <div class="ot-week-list">${past.map(renderPastWeekRow).join('')}</div>
                </div>` : '');
        host.querySelectorAll('[data-create]').forEach(btn =>
            btn.addEventListener('click', () => previewWindow(
                String(btn.getAttribute('data-create')), /** @type {HTMLElement} */ (btn))));
        host.querySelectorAll('[data-open]').forEach(btn =>
            btn.addEventListener('click', () => selectWeek(String(btn.getAttribute('data-open')))));
        host.querySelectorAll('[data-topup]').forEach(btn =>
            btn.addEventListener('click', () => topUpWeek(
                String(btn.getAttribute('data-topup')), /** @type {HTMLElement} */ (btn))));

        // OPEN THE WEEK BEING PLANNED, rather than making the reviewer ask for it.
        //
        // The horizon used to be a gate: land on a list, press View, then see availability. That is
        // the same step removed from the member's side at v20.64 — tapping through an index to reach
        // the thing you came for exists for the code's benefit, not the person's — and it should
        // have been removed from both surfaces at once, since they are the same rows rendered by the
        // same coordinator.
        //
        // View stops being a gate and becomes what it always should have been: how you switch week.
        // Only on first load — a reviewer who has since chosen another week keeps it across a
        // refresh of this card.
        //
        // ── THE EARLIEST WEEK WITH A FORM IS THE WRONG ONE ──────────────────────────────────────
        //
        // That is what this did until v20.69, and it was wrong every single time rather than
        // occasionally: the horizon's FIRST row is always the current week, whose final deadline is
        // eleven days behind it and whose roster has already been published. So a reviewer opening
        // the page landed on a finished week, and had to press View to reach the one they were
        // actually planning — the gate this change was supposed to have removed, still there, just
        // less visible.
        //
        // The week being planned is the earliest one still OPEN. If none is (every horizon week has
        // closed — possible only when creation has fallen a long way behind), fall back to the most
        // recent created week, because a reviewer looking at a closed week is still better served
        // than a reviewer looking at an empty card.
        if (!selectedWeek) {
            const created = weeks.filter((/** @type {any} */ w) => w.exists);
            const lead = created.find((/** @type {any} */ w) => w.state === 'created')
                || created[created.length - 1];
            if (lead) selectWeek(lead.weekEnding, { scroll: false });
        }
    }

    /** @param {any} w */
    function renderHorizonRow(w) {
        const { label, tone } = rowStateCopy(w.state);
        const counts = w.exists ? countsCopy(w.expected || 0, w.received || 0) : '';
        // An OPEN week whose audience has grown since it was created. The frozen population is
        // right for everything already recorded, but somebody invited afterwards is not in it —
        // and with the whole horizon pre-created, that is EVERY week they could answer.
        // The scheduler tops these up nightly; this is the same thing, now, when you have just
        // invited somebody and want them to see a form.
        const shortBy = w.exists && Number.isInteger(w.audienceCount)
            ? w.audienceCount - (w.expected || 0) : 0;
        const action = w.exists
            ? `${shortBy > 0
                ? `<button type="button" class="ot-row-btn ot-row-btn--primary" data-topup="${esc(w.weekEnding)}">Add ${shortBy}</button>`
                : ''}
               <button type="button" class="ot-row-btn" data-open="${esc(w.weekEnding)}"
                       aria-pressed="${selectedWeek === w.weekEnding}">View</button>`
            : (w.canCreate
                // Secondary, not primary: since v20.61 this week opens by itself overnight, so the
                // button is the "I want it now" shortcut rather than the thing a reviewer must
                // remember to press. Making it the loudest control on the row would teach a habit
                // the system exists to remove.
                ? `<button type="button" class="ot-row-btn" data-create="${esc(w.weekEnding)}">Open now</button>`
                : '');
        return `
            <div class="ot-week-row ot-week-row--${tone}">
                <div class="ot-week-main">
                    <div class="ot-week-title">${esc(weekLabel(w.weekEnding))}</div>
                    <div class="ot-week-meta">
                        Answers due ${esc(deadlineLabel(w.initialDeadlineAt))}<br>
                        Closes ${esc(deadlineLabel(w.finalDeadlineAt))}
                        ${counts ? `<br>${esc(counts)}` : ''}
                    </div>
                    <span class="ot-week-state ot-week-state--${tone}">${esc(label)}</span>
                </div>
                <div class="ot-week-actions">${action}</div>
            </div>`;
    }

    /** A week that has already run, still inside retention. @param {any} w */
    function renderPastWeekRow(w) {
        return `
            <div class="ot-week-row ot-week-row--past">
                <div class="ot-week-main">
                    <div class="ot-week-title">${esc(weekLabel(w.weekEnding))}</div>
                    <div class="ot-week-meta">Closed ${esc(deadlineLabel(w.finalDeadlineAt))}</div>
                </div>
                <div class="ot-week-actions">
                    <button type="button" class="ot-row-btn" data-open="${esc(w.weekEnding)}">View</button>
                </div>
            </div>`;
    }

    // ── Creating a window ───────────────────────────────────────────────────────────────────────

    /**
     * Preview first, always. The server runs the SAME code for the preview and the commit, so what
     * a reviewer approves here is exactly what gets created — and the participant count is the part
     * worth approving, because during the restricted beta it is one rather than the whole team.
     */
    /**
     * ── A PRESS THAT SHOWS NOTHING HAS NOT HAPPENED ─────────────────────────────────────────────
     *
     * This used to go straight to the network. The dry run is a Cloud Function call — on 4G, from
     * cold, seconds — and for every one of those seconds the page was byte-for-byte unchanged: the
     * button still read "Open now", nothing spun, nothing greyed. Measured in a browser at 390px
     * with a 2.5s response, the entire viewport was identical before and during.
     *
     * So the press read as a dead control, and the reasonable thing to do with a dead control is
     * press it again. That is exactly what was reported — "it still keeps saying Open now" — and it
     * is the worst possible failure for THIS button, because a reviewer concludes the feature does
     * not work while the only thing missing is a label change.
     *
     * The busy state disables every other create button too, not just this one. A second week
     * previewed mid-flight would resolve into the same single confirm bar, and the bar names only
     * the week it is armed for — so the reviewer would be looking at a question about a week they
     * pressed first and an answer about a week they pressed second.
     *
     * @param {string} weekEnding
     * @param {HTMLElement} btn the button pressed — it is the thing that has to change
     */
    async function previewWindow(weekEnding, btn) {
        // Disarm FIRST. A failed preview used to leave the bar showing an error for week B while
        // its Create button was still armed for week A from an earlier successful preview — one
        // press away from creating the wrong week.
        pendingWeek = null;
        const restore = setCreateBusy(btn);
        const r = await OTD.createOvertimeWindow(weekEnding, { dryRun: true });
        restore();
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
        armConfirmBar();
        if (bar) bar.hidden = false;
        reserveConfirmSpace(true);
    }

    /**
     * Top an existing OPEN week up to the current audience — the "Add N" row action.
     *
     * No confirm bar, unlike creating a week. Creating one freezes a population and cannot be
     * undone; this only ADDS people the audience already includes, to a week they can still answer.
     * The worst outcome is that somebody is asked who could have been asked anyway, so a
     * confirmation would be ceremony rather than a safeguard — and this is the button somebody
     * presses immediately after inviting a colleague, where a second step is friction at the exact
     * moment they want to see it work.
     *
     * @param {string} weekEnding @param {HTMLElement} btn
     */
    async function topUpWeek(weekEnding, btn) {
        const label = btn.textContent;
        btn.textContent = 'Adding…';
        /** @type {HTMLButtonElement} */ (btn).disabled = true;
        // The SAME endpoint as creation: for a week that exists it reconciles the population and
        // reports what it added. One server path, so the button and the nightly job can never
        // disagree about what "in this week's audience" means.
        const r = await OTD.createOvertimeWindow(weekEnding, { dryRun: false });
        if (!r.ok) {
            btn.textContent = label;
            /** @type {HTMLButtonElement} */ (btn).disabled = false;
            flashConfirm(`Couldn't add anyone to that week (${esc(r.code)}).`, false);
            return;
        }
        const added = (r.data && r.data.added) || [];
        flashConfirm(added.length
            ? `Added to ${esc(weekLabel(weekEnding))}: <strong>${esc(added.join(', '))}</strong>. `
              + 'They can fill in that week now.'
            : `Nobody new to add to ${esc(weekLabel(weekEnding))}.`, true);
        await loadHorizon();
        if (selectedWeek === weekEnding) renderWeekDetail(weekEnding);
    }

    /**
     * Put the pressed button into a busy state and lock its siblings; returns the undo.
     *
     * Returning the restore rather than exposing a `setCreateIdle` keeps the two halves impossible
     * to separate — the failure mode here is a button left disabled for ever on an error path, and
     * that is a page the reviewer has to reload.
     *
     * @param {HTMLElement} btn
     * @returns {() => void}
     */
    function setCreateBusy(btn) {
        const all = /** @type {HTMLButtonElement[]} */ (
            Array.from(document.querySelectorAll('[data-create]')));
        const label = btn.textContent;
        for (const b of all) b.disabled = true;
        btn.textContent = 'Opening…';
        btn.classList.add('ot-row-btn--busy');
        return () => {
            for (const b of all) b.disabled = false;
            btn.textContent = label;
            btn.classList.remove('ot-row-btn--busy');
        };
    }

    /**
     * Reserve the space the fixed confirm bar occupies, so it cannot cover the row it is asking
     * about.
     *
     * The bar is `position: fixed; bottom: 0` and measured 199px tall at 390px — taller than a week
     * row. Nothing compensated for it, so opening it hid the last row or two of the list, and
     * pressing "Open now" on the LAST week put the question directly on top of the thing it named.
     *
     * Measured rather than a constant: the bar wraps to two, three or four lines depending on the
     * week label and the viewport, so any number written here would be wrong somewhere.
     *
     * @param {boolean} on
     */
    function reserveConfirmSpace(on) {
        const bar = el('otConfirmBar');
        document.body.style.paddingBottom = on && bar ? `${bar.offsetHeight}px` : '';
    }

    /**
     * The Create button is armed by `pendingWeek` and by nothing else.
     *
     * A failed preview disarms the bar but leaves it on screen carrying the error — and the button
     * beside that error stayed enabled, doing nothing at all when pressed (`if (!pendingWeek)
     * return`). A control that looks live and silently refuses reads as a broken page, which is
     * exactly the wrong impression to give somebody who has just been told something failed.
     */
    function armConfirmBar() {
        const btn = /** @type {HTMLButtonElement|null} */ (el('otConfirmCreate'));
        if (btn) btn.disabled = !pendingWeek;
    }

    function wireConfirmBar() {
        el('otConfirmCancel')?.addEventListener('click', () => {
            pendingWeek = null;
            const bar = el('otConfirmBar'); if (bar) bar.hidden = true;
            reserveConfirmSpace(false);
        });
        el('otConfirmCreate')?.addEventListener('click', async () => {
            if (!pendingWeek) return;
            const btn = /** @type {HTMLButtonElement} */ (el('otConfirmCreate'));
            btn.disabled = true;
            const week = pendingWeek;
            const r = await OTD.createOvertimeWindow(week, { dryRun: false });
            // Re-arm from `pendingWeek`, not unconditionally: a timeout keeps the week pending (the
            // press is worth repeating), and every other outcome below clears it.
            armConfirmBar();
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
            reserveConfirmSpace(false);
            await loadHorizon();
            selectWeek(week);
        });
    }

    /** @param {string} html @param {boolean} ok */
    function flashConfirm(html, ok) {
        const text = el('otConfirmText');
        if (text) text.innerHTML = html;
        const bar = el('otConfirmBar');
        armConfirmBar();
        if (bar) bar.hidden = false;
        reserveConfirmSpace(true);
        if (ok) setTimeout(() => {
            if (bar) bar.hidden = true;
            reserveConfirmSpace(false);
        }, 2500);
    }

    // ── Week detail (filled in by the Manager workspace step) ───────────────────────────────────

    /** @param {string} weekEnding */
    /**
     * @param {string} weekEnding
     * @param {{ scroll?: boolean }} [opts] `scroll: false` when the page CHOSE the week rather than
     *   the reviewer — arriving on a page that has scrolled itself down is disorienting, whereas
     *   moving to the card you just asked for is the point.
     */
    function selectWeek(weekEnding, { scroll = true } = {}) {
        selectedWeek = weekEnding;
        const card = el('otWeekCard');
        const hint = el('otWeekHint');
        const host = el('otWeekContent');
        if (card) card.hidden = false;
        if (hint) hint.textContent = weekLabel(weekEnding);
        if (host) renderLoading(host, 'Loading availability…');
        document.querySelectorAll('[data-open]').forEach(b =>
            b.setAttribute('aria-pressed', String(b.getAttribute('data-open') === weekEnding)));
        if (scroll) card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        renderWeekDetail(weekEnding);
    }

    /**
     * The by-day workspace for the selected week.
     * @param {string} weekEnding
     */
    async function renderWeekDetail(weekEnding) {
        const host = el('otWeekContent');
        const win = horizonByWeek.get(weekEnding);
        if (!host || !win) return;
        const dates = weekDatesFrom(win.weekStart);
        const data = await OTD.loadWeekDetail(weekEnding,
            { initialDeadlineAt: win.initialDeadlineAt }, dates);
        // A stale-render guard: the reviewer may have picked another week while this read was in
        // flight, and painting the older answer over the newer selection is the classic late-read
        // bug. Cheap to prevent; invisible when it happens.
        if (selectedWeek !== weekEnding) return;
        if (!data.ok) { renderError(host, () => renderWeekDetail(weekEnding)); return; }
        paintWeekDetail(host, win, data, { dates, now: OTD.correctedNow() });
        const chip = el('otWeekChip');
        if (chip) {
            const received = data.participants.filter((/** @type {any} */ p) => data.submissions.has(p.memberName)).length;
            chip.textContent = `${received}/${data.participants.length}`;
        }
    }

    /**
     * The seven Sunday→Saturday dates. The server's `weekDates` is authoritative; this mirrors it.
     * @param {string} weekStart
     */
    function weekDatesFrom(weekStart) {
        const [y, m, d] = String(weekStart).split('-').map(Number);
        return Array.from({ length: 7 }, (_, i) => {
            const dt = new Date(Date.UTC(y, m - 1, d + i));
            return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        });
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

    /**
     * @param {'mine'|'all'} which @param {boolean} [focus]
     *
     * Also stamps `data-ot-view` on `<body>`, which is what the PRINT rules key off. Only the
     * reviewer's workspace is a document — a member's form is a set of controls, and printing it
     * would produce a page of empty capsules. CSS alone cannot tell which panel is showing (both
     * exist in the document and `hidden` is toggled on a mid-tree element), so the one thing the
     * stylesheet needs to know is put where a stylesheet can read it.
     */
    function showPanel(which, focus = false) {
        const mine = which === 'mine';
        toggleTab('otTabMine', mine, focus);
        toggleTab('otTabAll', !mine, focus);
        const minePanel = el('otMinePanel');
        const allPanel  = el('otAllPanel');
        if (minePanel) minePanel.hidden = !mine;
        if (allPanel)  allPanel.hidden = mine;
        document.body.dataset.otView = which;
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

    /**
     * @param {any} host
     * @param {() => any} [retry] what "Try again" should do. Defaults to a full reload, which is
     *   right for the two top-level cards and WRONG for the week detail — reloading everything
     *   there leaves the failed week exactly as it was, so the button appears to do nothing.
     */
    function renderError(host, retry) {
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
        host.querySelector('.ot-retry')?.addEventListener('click', () => (retry || loadEverything)());
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
