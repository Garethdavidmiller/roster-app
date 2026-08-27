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
 *
 * ── WHICH READ IS LATEST, NOT MERELY WHICH WEEK IS SELECTED ─────────────────────────────────────
 *
 * `renderWeekDetail` guards on the selected WEEK, so two reads of the SAME week both satisfy it —
 * and since v21.48 three things start one (Refresh, the visibility refetch, a week press). If the
 * second returns first, the first lands after it and paints the OLDER snapshot beneath the NEWER
 * "as at" time. Every other stale render is a page that is behind; this is a page that is behind
 * while saying it is current, on the surface a clerk rings people from. Hence `detailGeneration`:
 * a ticket per call, and only the newest may paint. Coalescing into one in-flight promise is
 * worse — it would hand a Refresh press the answer to the read already running, which is the
 * stale data the press exists to replace.
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
    weekLabel, weekSpan, deadlineLabel, shouldResyncClock,
} from './overtime-format.js';
import { CARD_TIPS } from './overtime-tips.js';
import { renderWeekForm } from './overtime-form.js';
import { createReviewController } from './overtime-review-controller.js';

/**
 * How recently the reviewer's week must have been fetched for a visibility return to skip the
 * re-read. A minute: long enough that checking another app for ten seconds costs nothing, short
 * enough that a phone coming out of a pocket mid-morning reads fresh.
 */
const DETAIL_REFRESH_DEBOUNCE_MS = 60_000;

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

    /**
     * The reviewer's workspace — horizon, week selection, detail, creation preview, confirm bar,
     * and the eight pieces of state that have to agree about which week is on screen (v21.88).
     *
     * A page holding BOTH surfaces is deliberate (see overtime.html), and it is still not a reason
     * for one coordinator to hold both: nothing in the reviewer's world is reachable from the
     * member's, and none of its state means anything to them. What is shared is the page's own DOM
     * helpers, which are passed in rather than duplicated.
     */
    const review = createReviewController({
        el, esc, renderLoading, renderError,
        detailRefreshDebounceMs: DETAIL_REFRESH_DEBOUNCE_MS,
    });

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
        // WHOSE form this is. The member surface is always "you", and nothing on the card said who
        // "you" was — the name lived only in the drawer footer, behind the burger. On a shared
        // device that is a colleague's availability amended under their still-signed-in session,
        // with nothing on screen to catch it. The surface is ADMIN'S OWN locked member bar
        // (v21.58, owner request) — the same "Staff member" field a self-service member sees
        // there, locked to the one name it can hold — so both pages answer "who am I acting as?"
        // in one visual language. A real <select>, disabled: there is genuinely nobody else to
        // pick. Filled here because start() re-runs on an in-place sign-in, so a changed
        // identity repaints it — and REBUILT rather than appended, for exactly that path.
        const idBar = el('otMineIdentity');
        const idSel = /** @type {HTMLSelectElement|null} */ (el('otIdentityMember'));
        if (idBar && idSel && currentUser) {
            idSel.innerHTML = `<option>${esc(currentUser)}</option>`;
            idBar.hidden = false;
        }
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

        review.wireConfirmBar();
        wireDeadlineResync();

        // ── Browser-level protection for a half-filled form (v21.48, external review) ───────────
        //
        // `confirmDiscard` guards every navigation THIS PAGE performs — another week, back to the
        // list, a rebuilding resync. It cannot see a reload, the drawer's links, browser Back or a
        // closed tab, all of which discarded six answered days silently. Best-effort native
        // protection while the form is dirty: the browser shows its own generic warning. No
        // handler removal is needed — a successful submit makes `isDirty()` false, which disarms
        // it. Deliberately NOT a localStorage draft, for the reasons on `confirmDiscard`: a copy
        // of somebody's availability outliving them on a shared station PC is worse than the loss
        // this prevents. A mobile OS killing the PWA outright remains uncatchable, and persisting
        // drafts to catch it is the same bad trade.
        window.addEventListener('beforeunload', (e) => {
            if (currentForm?.isDirty()) { e.preventDefault(); e.returnValue = ''; }
        });

        // ── The reviewer's week must not go quietly stale (v21.48, external review) ─────────────
        //
        // The workspace is a one-off snapshot, and the page states its age ("Availability as at…")
        // without ever improving it: a reviewer who opened a week at 09:00 and looked again at
        // 09:20 was reading 09:00 answers with no way to know. The realistic shape — as with the
        // member's deadline resync above — is a pocketed phone or a backgrounded tab, so the
        // trigger is the page BECOMING VISIBLE, debounced so a ten-second glance elsewhere does
        // not buy a read. The Refresh button in the workspace covers the reviewer who never left.
        // Deliberately not a Firestore listener yet: if real beta use shows the page held open
        // through arriving submissions, listen to the heads then — the checklist carries it.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden || !canReview) return;
            review.refreshSelectedIfStale();
        });
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
        await Promise.all([loadMine(), canReview ? review.loadHorizon() : Promise.resolve()]);
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
