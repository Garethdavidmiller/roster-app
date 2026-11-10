// @ts-check
/**
 * overtime-review-controller.js — the REVIEWER's side of the Overtime page.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────
 *
 * `overtime.html` deliberately carries both surfaces — a member's own form and the reviewer
 * workspace — because they are the same subject seen from two sides, and a second page would double
 * every contract the feature has. That was, and remains, the right call for the PAGE.
 *
 * It is not the right call for one coordinator. The two are different applications sharing a
 * header: the member has a window, a form, a submission and a deadline; the reviewer has a planning
 * horizon, a week selection, a detail workspace, grade and day lenses, a creation preview and a
 * confirm bar. Nothing in the second is reachable from the first, and none of its state means
 * anything to a member.
 *
 * ── THE PLANNING HORIZON IS THE POINT OF THE PAGE, NOT A CONVENIENCE ────────────────────────────
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
 * ── WHICH READ IS LATEST, NOT MERELY WHICH WEEK IS SELECTED ─────────────────────────────────────
 *
 * `renderWeekDetail` guards on the selected WEEK, so two reads of the SAME week both satisfy it —
 * and three things start one (Refresh, the visibility refetch, a week press). If the second returns
 * first, the first lands after it and paints the OLDER snapshot beneath the NEWER "as at" time.
 * Every other stale render is a page that is behind; this is a page that is behind while saying it
 * is current, on the surface a clerk rings people from. Hence `detailGeneration`: a ticket per call,
 * and only the newest may paint. Coalescing into one in-flight promise is worse — it would hand a
 * Refresh press the answer to the read already running, which is the stale data the press exists
 * to replace.
 *
 * ── WHAT IT OWNS, AND WHY THAT IS ALL ONE THING ─────────────────────────────────────────────────
 *
 * Every piece of state here exists to keep several asynchronous reads from disagreeing about which
 * week the reviewer is looking at:
 *
 *   · `horizonGeneration` / `detailGeneration` — the two GENERATION TICKETS. Three actions and
 *     every refresh reload the horizon, and two in quick succession put two reads in flight; the
 *     older one painting LAST showed pre-action counts and repopulated `horizonByWeek` with the
 *     stale rows the next detail read takes its milestones from.
 *   · `selectedWeek` — checked again after every await, because painting an older week's answers
 *     over a newer selection is the classic late-read bug.
 *   · `horizonByWeek` — where a week's milestones come from when the detail read needs them.
 *   · `reviewGrade` / `reviewDay` — held ACROSS a re-render, which is the only reason they are not
 *     inside the workspace: it is rebuilt from scratch on every week change, so anything it owned
 *     would be reset by the act of changing week. They differ from each other deliberately (grade
 *     survives a week switch, day does not — its values are one window's dates).
 *   · `pendingWeek` — what the Create button is armed for, and nothing else.
 *   · `detailFetchedAt` / `horizonFetchedAt` — what the visibility refresh debounces on.
 *   · `weekShown` / `horizonShown` — the newest snapshot each card drew, so a re-read that fails can
 *     put it back, with its own age, rather than an error card (overtime-ui-3, -11).
 *
 * They have to agree with each other and with nothing else on the page. That is the invariant, and
 * this module is the one owner of it.
 *
 * ── WHAT IT DOES NOT OWN ────────────────────────────────────────────────────────────────────────
 *
 * Session, identity, tabs, nav, the member's form, and the page's own chrome. It renders through
 * `overtime-manager.js` and reads through `overtime-data.js`, exactly as the coordinator did — the
 * layer that was missing was this one, between them.
 *
 * The four DOM helpers it shares with the coordinator (`el`, `esc`, `renderLoading`, `renderError`)
 * are injected rather than duplicated: they are the page's, not the reviewer's.
 */

import * as OTD from './overtime-data.js';
import {
    weekLabel, weekSpan, deadlineLabel, rowStateCopy, countsCopy, isWithdrawn, putBackWindow, weekDates,
    writeOutcomeUnknown,
} from './overtime-format.js';
import { phaseAt } from './overtime-phase.js';
import { renderWeekDetail as paintWeekDetail, stampPrinted } from './overtime-manager.js';
import { confirmDialog } from './overlay.js';

/**
 * @param {object} deps
 * @param {(id: string) => HTMLElement|null} deps.el
 * @param {(s: any) => string} deps.esc
 * @param {(host: HTMLElement, message: string) => void} deps.renderLoading
 * @param {(host: HTMLElement, retry?: () => void) => void} deps.renderError
 * @param {number} deps.detailRefreshDebounceMs
 */
export function createReviewController({ el, esc, renderLoading, renderError, detailRefreshDebounceMs }) {
    // ── The state, and the reason it lives together (see the header) ────────────────────────────

    /** Ticket for the newest horizon read. Only its holder may paint. */
    let horizonGeneration = 0;
    /** When the horizon last came back — the visibility refresh's debounce for it. */
    let horizonFetchedAt = 0;
    /** The overview the horizon is drawing, and when it was read. @type {{weeks: any[], past: any[], readAt: number}|null} */
    let horizonShown = null;
    /** The newest snapshot the workspace drew — what a failed re-read of THAT week falls back on. @type {{weekEnding: string, win: any, data: any, dates: string[], now: number}|null} */
    let weekShown = null;
    /** The week the Manager detail card is showing, if any. @type {string|null} */
    let selectedWeek = null;
    /** The planning rows from the last overview, keyed by week. @type {Map<string, any>} */
    const horizonByWeek = new Map();
    /** The week a Create preview is currently offering, if any. @type {string|null} */
    let pendingWeek = null;
    /** The grade the reviewer is working, held ACROSS week switches. */
    let reviewGrade = 'ALL';
    /** The DAY lens — held only across a refresh of the SAME week; reset by selectWeek. */
    let reviewDay = 'ALL';
    /** When the selected week's detail last came back — what the visibility refresh debounces on. */
    let detailFetchedAt = 0;
    /** Ticket for the newest week-detail read. Only its holder may paint. */
    let detailGeneration = 0;

    // The sheet's "Printed …" line names the moment it PRINTS, by the corrected clock (overtime-ui-7).
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeprint', () => stampPrinted(el('otWeekContent'), OTD.correctedNow()));
    }

// ── Upcoming weeks (the planning horizon) ───────────────────────────────────────────────────

/**
 * Read and draw the horizon. `quiet` is a REFRESH (overtime-ui-3): rows already on screen stay there
 * while it reads and if it fails — then with a line saying how old they are — because a loading line
 * or an error card in their place would take away the one surface that shows a week nobody created.
 * @param {{ quiet?: boolean }} [opts]
 */
async function loadHorizon({ quiet = false } = {}) {
    const host = el('otHorizonContent');
    if (!host) return;
    const keep = quiet ? horizonShown : null;
    if (!keep) { renderLoading(host, 'Loading upcoming weeks…'); horizonShown = null; }
    const generation = ++horizonGeneration;
    const r = await OTD.getOvertimeManagerOverview();
    if (generation !== horizonGeneration) return;   // a newer load owns the card now
    if (!r.ok && keep) { paintHorizon(host, keep, true); return; }
    // Its OWN retry: the page default is loadEverything, which rebuilds the member's form too.
    if (!r.ok) { renderError(host, () => loadHorizon()); return; }
    horizonFetchedAt = Date.now();

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

    horizonShown = { weeks, past, readAt: OTD.correctedNow() };
    paintHorizon(host, horizonShown, false);

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
        if (lead) await selectWeek(lead.weekEnding, { scroll: false });
    }
}

/**
 * Draw one overview's rows and wire their buttons — `stale` when a refresh of them has just failed.
 * @param {HTMLElement} host @param {{weeks: any[], past: any[], readAt: number}} shown @param {boolean} stale
 */
function paintHorizon(host, { weeks, past, readAt }, stale) {
    host.innerHTML = (stale ? `<div class="ot-reminder-line ot-reminder-line--warn" role="status">Couldn't refresh `
            + `just now — this list is as at ${esc(deadlineLabel(readAt))}.</div>` : '')
        + `<div class="ot-week-list">${weeks.map(renderHorizonRow).join('')}</div>`
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
    //
    // ONE SERVER-SIDE NUMBER, not two subtracted here (v21.15). This used to be
    // `audienceCount - expected`, and those count different populations: `expected` is net of
    // withdrawals while the top-up compares against every participant document. So one use of
    // "Stop asking" gave the row a permanent "Add 1" that reported "Nobody new to add" and came
    // straight back. The arithmetic now lives beside the code that performs the action — see
    // `canAdd` in functions/overtime.js.
    const shortBy = w.exists && Number.isInteger(w.canAdd) ? w.canAdd : 0;
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
            //
            // Unless the schedule has already failed this week (v20.94), where that reasoning
            // inverts exactly: the system is not going to do it, the label says so, and a
            // recessive button under a red label reads as "nothing you can do".
            ? `<button type="button" class="ot-row-btn${w.state === 'not-created-overdue' ? ' ot-row-btn--primary' : ''}" data-create="${esc(w.weekEnding)}">Open now</button>`
            : '');
    // A deadline that has gone is stated in the past tense (overtime-ui-16): the first row is always
    // a closed week, and it said "Closes …" beside "Form closed". Past at the instant, as phases are.
    const now = OTD.correctedNow();
    return `
        <div class="ot-week-row ot-week-row--${tone}">
            <div class="ot-week-main">
                <div class="ot-week-title">${esc(weekLabel(w.weekEnding))}</div>
                <div class="ot-week-meta">
                    ${now >= w.initialDeadlineAt ? 'Answers were due' : 'Answers due'} ${esc(deadlineLabel(w.initialDeadlineAt))}<br>
                    ${now >= w.finalDeadlineAt ? 'Closed' : 'Closes'} ${esc(deadlineLabel(w.finalDeadlineAt))}
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
                <button type="button" class="ot-row-btn" data-open="${esc(w.weekEnding)}"
                        aria-pressed="${selectedWeek === w.weekEnding}">View</button>
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
    if (!r.ok) { flashConfirm(esc(accessRefusal(r) ?? `Couldn't prepare that week (${r.code}).`), false); return; }
    const w = r.data.window;
    pendingWeek = weekEnding;
    const bar = el('otConfirmBar');
    const text = el('otConfirmText');
    if (text) {
        text.innerHTML = `Open the availability form for <strong>${esc(weekLabel(weekEnding))}</strong>?<br>`
            + `Roster week ${esc(weekSpan(w.weekStart, w.weekEnding))} · `
            + `initial deadline ${esc(deadlineLabel(w.initialDeadlineAt))}<br>`
            + `<strong>${w.audience === 'restricted' ? 'Beta audience' : 'All eligible staff'}</strong>`
            // Guarded because a deploy-window version skew (older function, newer client) would
            // otherwise print the literal word "undefined" into a confirmation about creating
            // a week — omitting the count is honest, inventing one is not (v21.59).
            + (Number.isFinite(w.expectedCount)
                ? ` · ${w.expectedCount} expected ${w.expectedCount === 1 ? 'participant' : 'participants'}`
                : '');
    }
    armConfirmBar();
    showConfirmBar(bar);
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
    // Disarm any earlier preview: the flash below re-arms Create from `pendingWeek`, which would
    // leave it live under a message about a different week. AND AGAIN AFTER THE WAIT (whole-app
    // review, Nov 2026): Add is not a button a preview locks, so a preview still preparing when this
    // was pressed could land during the call and re-arm — and the message below then replaced its
    // question with Create still live for that other week.
    pendingWeek = null;
    const label = btn.textContent;
    btn.textContent = 'Adding…';
    /** @type {HTMLButtonElement} */ (btn).disabled = true;
    // The SAME endpoint as creation: for a week that exists it reconciles the population and
    // reports what it added. One server path, so the button and the nightly job can never
    // disagree about what "in this week's audience" means.
    const r = await OTD.createOvertimeWindow(weekEnding, { dryRun: false });
    pendingWeek = null;
    if (!r.ok) {
        btn.textContent = label;
        /** @type {HTMLButtonElement} */ (btn).disabled = false;
        // The server may have added them, and told them (overtime-ui-10): say so, and re-read.
        if (writeOutcomeUnknown(r)) { await unknownOutcome(weekEnding, 'whether anyone was added to'); return; }
        flashConfirm(esc(accessRefusal(r) ?? `Couldn't add anyone to that week (${r.code}).`), false);
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
        hideConfirmBar();
    });
    el('otConfirmCreate')?.addEventListener('click', async () => {
        if (!pendingWeek) return;
        const btn = /** @type {HTMLButtonElement} */ (el('otConfirmCreate'));
        btn.disabled = true;
        const week = pendingWeek;
        const r = await OTD.createOvertimeWindow(week, { dryRun: false });
        // Re-arm from `pendingWeek`, not unconditionally: a failure keeps the week pending, so the
        // press can be repeated (a second create of a week that exists answers with that week), and
        // only a success clears it. Unless a preview of ANOTHER week landed while this was out
        // (48-hour review): the message below is about THIS week, so Create must not stay armed for
        // that one under it.
        if (pendingWeek !== week) pendingWeek = null;
        armConfirmBar();
        if (!r.ok) {
            // A create whose answer never came is not a failure — the window may exist. Say so, and
            // say what to do, rather than inviting a second create that would look like a failure
            // too (it would return the existing window, which is right, but reads as confusing). The
            // list is re-read, so "check the list" checks a current one (overtime-ui-10).
            if (writeOutcomeUnknown(r)) {
                flashConfirm('Couldn\'t confirm whether the week was created — it may still have been created. '
                    + 'Close this and check the list.', false);
                loadHorizon({ quiet: true });
                return;
            }
            flashConfirm(esc(accessRefusal(r) ?? `Couldn't create that week (${r.code}).`), false);
            return;
        }
        pendingWeek = null;
        hideConfirmBar();
        await loadHorizon();
        selectWeek(week);
    });
}

/**
 * The pending auto-hide from the last SUCCESS flash.
 *
 * ── A TIMER FROM ONE MESSAGE MUST NOT CLOSE THE NEXT ONE (v21.15) ───────────────────────────
 *
 * A success flash hides itself after 2.5 seconds, and that timer used to be untracked. Every
 * success is followed by `loadHorizon()`, so the reviewer is back in a live list with up to two
 * seconds still on a clock nothing is watching — and the very next thing they do is often press
 * "Open now" on another week. The preview lands, the bar is shown with the question on it, and
 * the old timer hides it again, leaving an ARMED create with nothing on screen.
 *
 * The reviewer sees a button that took a press and did nothing, which is precisely the failure
 * v20.73 exists to prevent, arriving from the other end: there the press showed nothing while it
 * worked, here it shows nothing after it worked.
 */
/** @type {any} */
let confirmHideTimer = null;

/** @param {string} html @param {boolean} ok */
function flashConfirm(html, ok) {
    const text = el('otConfirmText');
    if (text) text.innerHTML = html;
    const bar = el('otConfirmBar');
    armConfirmBar();
    showConfirmBar(bar);
    if (ok) confirmHideTimer = setTimeout(() => {
        confirmHideTimer = null;
        if (bar) bar.hidden = true;
        reserveConfirmSpace(false);
    }, 2500);

}

/**
 * A write whose answer never came (overtime-ui-10). The server may have done it — added people and
 * told them, or stood somebody down and taken the week off their page — so it is neither reported
 * as a failure nor left unread. Both writes are idempotent, so a second press after the re-read is safe.
 * @param {string} weekEnding @param {string} what e.g. "whether anyone was added to"
 */
async function unknownOutcome(weekEnding, what) {
    flashConfirm(`Couldn't confirm ${esc(what)} ${esc(weekLabel(weekEnding))} — it may still have happened. `
        + 'Check the week before trying again.', false);
    await loadHorizon({ quiet: true });
    if (selectedWeek === weekEnding) renderWeekDetail(weekEnding);
}

/**
 * A refusal about the REVIEWER rather than the action (the overtime-core lead): for these the server
 * puts a sentence in its code field, which read as "(Forbidden — reviewer access required)" after the
 * action's words. And `offline`: nothing was sent. Null for anything the action words itself.
 * @param {{ code?: string, status?: number }} r
 */
function accessRefusal(r) {
    if (r.code === 'offline') return 'Couldn\'t reach the server, so nothing was sent. Check your connection and try again.';
    if (r.code === 'no-session' || r.status === 401 || r.status === 403) {
        return 'Your sign-in no longer has reviewer access. Reload the page and sign in again.';
    }
    return null;
}

/**
 * Put the bar on screen and cancel any pending auto-hide. EVERY path that shows the bar goes
 * through here, so a stale timer can never outlive the message that set it.
 * @param {HTMLElement|null} bar
 */
function showConfirmBar(bar) {
    if (confirmHideTimer) { clearTimeout(confirmHideTimer); confirmHideTimer = null; }
    if (bar) bar.hidden = false;
    reserveConfirmSpace(true);
}

/** Take the bar down, and the pending auto-hide with it. The mirror of `showConfirmBar`. */
function hideConfirmBar() {
    if (confirmHideTimer) { clearTimeout(confirmHideTimer); confirmHideTimer = null; }
    const bar = el('otConfirmBar');
    if (bar) bar.hidden = true;
    reserveConfirmSpace(false);
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
    // CLEAR THE RATIO BEFORE THE TITLE CHANGES UNDER IT.
    //
    // The chip is written only by a SUCCESSFUL `renderWeekDetail`, so switching weeks used to
    // leave the previous week's `5/8` sitting beside the new week's name — through the whole
    // load, and permanently if that load failed. That is the same "two answers to one question"
    // the chip's own code worries about three functions down, one level up: there the mismatch
    // is between the chip and the card, here it is between the chip and the title beside it,
    // and a reader has no way to tell which half is stale.
    //
    // Empty is the honest state and it costs nothing to show: `.card-year-chip` is hidden while
    // `:empty`, so the header simply has no chip until there is a number to put in it.
    const chip = el('otWeekChip');
    if (chip) chip.textContent = '';
    if (host) renderLoading(host, 'Loading availability…');
    document.querySelectorAll('[data-open]').forEach(b =>
        b.setAttribute('aria-pressed', String(b.getAttribute('data-open') === weekEnding)));
    if (scroll) card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // A week SWITCH resets the day lens (its values belong to the window being left); a
    // refresh of the same week goes through renderWeekDetail directly and keeps it.
    reviewDay = 'ALL';
    // Returned so the auto-select in loadHorizon can await it: for a pure reviewer the page's
    // `ready` mark must mean the workspace is usable, not that a loading line is on screen.
    return renderWeekDetail(weekEnding);
}

/**
 * The by-day workspace for the selected week.
 * @param {string} weekEnding
 */
async function renderWeekDetail(weekEnding) {
    const host = el('otWeekContent');
    if (!host) return;
    const win = horizonByWeek.get(weekEnding);
    if (!win) {
        // The week has left the horizon (a rebuild after it crossed retention mid-session).
        // A silent return here would strand whatever the card shows — including a disabled
        // "Refreshing…" button, which wireRefresh promises can never survive — so say what
        // happened and clear the selection instead (v21.56, external sweep).
        selectedWeek = null;
        weekShown = null;
        host.innerHTML = '<div class="ot-state">That week is no longer available — pick a week above.</div>';
        // EMPTY, not `hidden` (v21.94). `selectWeek` clears this chip by writing '' and relying on
        // the `.card-year-chip:empty { display: none }` rule; setting `hidden` here was a second
        // mechanism that nothing ever undoes, so once this branch ran the ratio was gone for the
        // rest of the page life — a later week would write `4/6` into an element still hidden.
        // One way it goes away, one way it comes back.
        const chip = el('otWeekChip');
        if (chip) chip.textContent = '';
        return;
    }
    const dates = weekDates(win.weekStart);
    // A ticket per call — only the newest may paint. See "WHICH READ IS LATEST" in the header.
    const generation = ++detailGeneration;
    const data = await OTD.loadWeekDetail(weekEnding,
        { initialDeadlineAt: win.initialDeadlineAt }, dates);
    // Superseded by a later read of ANY week — including this one. Checked before the week
    // guard because it is the stronger statement.
    if (generation !== detailGeneration) return;
    // A stale-render guard: the reviewer may have picked another week while this read was in
    // flight, and painting the older answer over the newer selection is the classic late-read
    // bug. Cheap to prevent; invisible when it happens.
    if (selectedWeek !== weekEnding) return;
    // A RE-READ of the week on screen that fails — one the device's cache answered included —
    // keeps the snapshot, whose "as at" is still true, and says the refresh failed (overtime-ui-11).
    // The error card is for a week with nothing drawn yet.
    if (!data.ok && weekShown?.weekEnding === weekEnding) { paintShown(host, weekShown, true); return; }
    if (!data.ok) { weekShown = null; renderError(host, () => renderWeekDetail(weekEnding)); return; }
    detailFetchedAt = Date.now();
    weekShown = { weekEnding, win, data, dates, now: OTD.correctedNow() };
    paintShown(host, weekShown, false);
}

/**
 * Draw a week's snapshot — again, with `refreshFailed`, when a newer read of it did not arrive.
 * @param {HTMLElement} host @param {{weekEnding: string, win: any, data: any, dates: string[], now: number}} shown
 * @param {boolean} refreshFailed
 */
function paintShown(host, { weekEnding, win, data, dates, now }, refreshFailed) {
    // The overview's rows carry no `phase`, and the workspace keys the closed-week panels and the
    // reminder audit on it — so it is derived from the clock here, never read off the row.
    const drawn = paintWeekDetail(host, { ...win, phase: phaseAt(win, now) }, data, {
        dates, now, refreshFailed, printedAt: OTD.correctedNow(),
        grade: reviewGrade, onGrade: (g) => { reviewGrade = g; paintWeekChip(data, g); },
        day: reviewDay, onDay: (d) => { reviewDay = d; },
        // The horizon too: its row for this week says the same counts (overtime-ui-3).
        onRefresh: () => { loadHorizon({ quiet: true }); return renderWeekDetail(weekEnding); },
        onAsk: (memberName, ask) => setAsking(weekEnding, memberName, ask),
    });
    // The grade the card OPENED on: a carried grade this week does not hold falls back to All
    // grades there, and `reviewGrade` stays the reviewer's for the next week (overtime-ui-8).
    paintWeekChip(data, drawn?.grade ?? reviewGrade);
}

/**
 * The card header's `received/expected` chip, from the SAME population the card counts.
 *
 * Withdrawn participants come out of BOTH halves of the chip, exactly as they come out of the
 * counts inside the card. A chip reading 4/6 above a card reading "4 of 5" is two answers to one
 * question, and the reader has no way to tell which is the mistake — and the same goes for the
 * GRADE lens, which the chip ignored until the whole-app review (Oct 2026): "1/2" above "0 of 1
 * form received" under CES. So it is repainted when the grade changes, too.
 * @param {any} data @param {string} grade  'ALL' or one grade
 */
function paintWeekChip(data, grade) {
    const chip = el('otWeekChip');
    if (!chip) return;
    const expected = data.participants.filter((/** @type {any} */ p) =>
        !isWithdrawn(p) && (grade === 'ALL' || p.grade === grade));
    const received = expected.filter((/** @type {any} */ p) => data.submissions.has(p.memberName)).length;
    chip.textContent = `${received}/${expected.length}`;
}

/**
 * Stop expecting an answer from somebody for one week — or start again.
 *
 * ── IT ASKS FIRST, AND IT RE-READS AFTERWARDS ───────────────────────────────────────────────
 *
 * Confirming is not ceremony: this is the one control on the page that changes what another
 * person's record is measured against, and "Stop asking" sits inches from "Open" on a list a
 * reviewer scrolls with a thumb. Re-reading rather than patching the local copy is the same
 * rule the rest of this coordinator follows — the server owns the population, and a page that
 * drew the outcome it hoped for would disagree with the next reload if the write had failed.
 * @param {string} weekEnding @param {string} memberName @param {boolean} ask
 */
async function setAsking(weekEnding, memberName, ask) {
    const week = weekLabel(weekEnding);
    const ok = await confirmDialog(ask
        ? {
            title: `Ask ${memberName} again?`,
            message: `${memberName} goes back into the counts for ${week} and can fill the `
                + 'form in for the rest of the time it is open.',
            confirmLabel: 'Ask again',
            cancelLabel: 'Cancel',
        }
        : {
            title: `Stop asking ${memberName}?`,
            // Worked out from the restore rule, not "while the form is open" (overtime-ui-2).
            message: `${memberName} comes out of the counts for ${week} and stops appearing `
                + 'as outstanding. Anything they have already said is kept, and you can put them back '
                + `${putBackWindow(Number(horizonByWeek.get(weekEnding)?.initialDeadlineAt), OTD.correctedNow())}.`,
            confirmLabel: 'Stop asking',
            cancelLabel: 'Cancel',
        });
    if (!ok) return;
    pendingWeek = null;   // as in topUpWeek — the flash must not re-arm an earlier preview…
    const r = await OTD.withdrawOvertimeParticipant(weekEnding, memberName, !ask);
    pendingWeek = null;   // …nor one that landed while this call was out
    if (!r.ok) {
        // The server may have done it, and the member's own page with it (overtime-ui-10).
        if (writeOutcomeUnknown(r)) {
            await unknownOutcome(weekEnding, `whether ${memberName} was ${ask ? 'put back on' : 'taken off'}`);
            return;
        }
        // `closed` is the one refusal worth naming rather than reporting as a fault: it is a
        // rule, and a reviewer told only "that didn't work" would try it again.
        flashConfirm(r.code === 'closed'
            ? `${esc(week)} has closed, so who was asked can no longer be changed — a closed `
              + 'week is the record the roster was planned from.'
            : esc(accessRefusal(r) ?? `That couldn't be saved (${r.code}).`), false);
        return;
    }
    flashConfirm(ask
        ? `<strong>${esc(memberName)}</strong> is being asked for ${esc(week)} again.`
        : `<strong>${esc(memberName)}</strong> is no longer being asked for ${esc(week)}.`, true);
    await loadHorizon();
    if (selectedWeek === weekEnding) renderWeekDetail(weekEnding);
}

    return {
        loadHorizon,
        selectWeek,
        wireConfirmBar,
        /**
         * The coordinator's visibility handler asks this; the debounce rule lives here. The HORIZON
         * too, on the same debounce (overtime-ui-3): re-reading only the week let a row that guards
         * the one catastrophic failure ("did not open overnight") go stale above a fresh card.
         */
        refreshIfStale() {
            if (Date.now() - horizonFetchedAt >= detailRefreshDebounceMs) loadHorizon({ quiet: true });
            if (!selectedWeek) return;
            if (Date.now() - detailFetchedAt < detailRefreshDebounceMs) return;
            renderWeekDetail(selectedWeek);
        },
        /**
         * The reviewer's side has left the screen. The confirm bar goes with it — fixed to the foot, it
         * covered the member's Submit bar after a switch to "My availability" (css-overtime-guides lead)
         * — and a Create armed for a week no longer in view is disarmed. `clear`: the session was lost
         * mid-visit, and the sign-in that covers the page is hidden in print, so what was read under the
         * account goes too, and no read still out may paint it back (overtime-ui-4).
         * @param {{ clear?: boolean }} [opts]
         */
        standDown({ clear = false } = {}) {
            pendingWeek = null;
            hideConfirmBar();
            armConfirmBar();
            if (!clear) return;
            // A horizon read still out is dropped by its ticket, a week read by the selection guard; a
            // later read that fails finds no snapshot to put back.
            horizonGeneration++;
            selectedWeek = null; weekShown = null; horizonShown = null;
            for (const id of ['otHorizonContent', 'otWeekContent', 'otWeekChip']) { const host = el(id); if (host) host.innerHTML = ''; }
        },
    };
}
