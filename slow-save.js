// @ts-check
/**
 * slow-save.js — say so when a save is waiting for signal.
 *
 * ── WHY THIS EXISTS (v24.21) ─────────────────────────────────────────────────────────────────────
 *
 * A manager changed a shift, the Save button sat on "Saving 1 change…", and nothing else happened.
 * They swiped the app closed, reopened it, and found the change had saved. Reported as a freeze.
 *
 * It was not a freeze. With `persistentLocalCache` (firebase-client.js) a Firestore write lands in
 * the phone's own database FIRST — that is what survived the swipe — and `batch.commit()` then
 * resolves only when the SERVER acknowledges it. On a weak signal that takes as long as it takes,
 * and nothing in the app put a limit on the wait or said a word while it lasted. The write path was
 * correct; the silence was the defect.
 *
 * ── WHAT IT DOES, AND THE TWO THINGS IT DELIBERATELY DOES NOT ─────────────────────────────────────
 *
 * After SLOW_SAVE_MS without an answer it shows one line: the change is held on this phone and will
 * send by itself. When the write settles the line goes, and the caller's own receipt or error takes
 * over exactly as it always did — this module never touches the result.
 *
 *   1. It does not say "Saved". A held write can still be REFUSED by the server when it arrives (a
 *      signed-out session, a rule change), and Firestore then quietly undoes the local copy. Saying
 *      "Saved" of a write the server has not seen is the one claim that could be false.
 *   2. It does not give the Save button back. Freeing the button while the first write is unconfirmed
 *      invites a second tap on the same days. A roster import mints new document ids, so a repeat
 *      there is a duplicate; a manual record's fixed id (override-id.js) turns it into a second write
 *      of a change still in flight (the v16.23 double-tap hazard, which is why every write path
 *      disables its button before its first await). Explaining the wait is the fix; shortening it is
 *      not ours to do.
 *
 * `watchSlowCommit` is pure (timers injected) and unit-tested in slow-save.test.mjs. The DOM half is
 * the smallest thing that can hold one live line, and it reference-counts, because two writes can
 * be waiting at once and the first to finish must not take down the notice the second still needs.
 */

import { hasUnconfirmedWrite, backgroundWritesInFlight } from './claim-retry.js';

/** How long a write may wait for the server before the app says why. */
export const SLOW_SAVE_MS = 8000;

/**
 * The one line shown while a write is waiting. It never says "saved" — see the header — and since
 * v24.26 it no longer says "You can leave this page". That was true when the write sat in the
 * device's own database, and not otherwise: with the app open in a SECOND tab the SDK quietly falls
 * back to a memory-only cache (the IndexedDB lease is single-tab), and a held write later REFUSED can
 * only be retried while the page is open. Leaving then loses the change without a word. The line now
 * states what is true and gives no instruction it cannot stand behind.
 */
export const SLOW_SAVE_TEXT =
    'Waiting for signal — your change is held on this device and will send automatically.';

/**
 * The line for a write that is one batch of SEVERAL (v24.23). Two writers — the roster upload and a
 * long leave or absence range — commit in chunks, one after another, and only the chunk in
 * flight is held on the device: a chunk not yet started exists nowhere. Telling that admin they may
 * leave, as v24.21 did, lost every later chunk without an error. So this one asks them to stay.
 */
export const SLOW_SAVE_TEXT_BATCHED =
    'Waiting for signal — this save is still sending in parts. Keep this page open until it finishes.';

/**
 * The same two lines for a phone that says it IS online (v24.54). The notice is a TIMER: it knows only
 * that the server has not answered within SLOW_SAVE_MS, never why. Saying "Waiting for signal" on a
 * phone with full bars was reported from an iPhone whose every save took longer than that — the claim
 * was false, and it sent the reader looking at their signal instead of reporting a fault. So the
 * signal is named only when the browser itself reports being offline (`navigator.onLine === false`),
 * which is the one case where it is known. Neither line says "saved" (see the header).
 */
export const SLOW_SAVE_TEXT_ONLINE =
    'Still sending — the server has not confirmed this change yet. It is held on this device and will send automatically.';
/** The online twin of SLOW_SAVE_TEXT_BATCHED. */
export const SLOW_SAVE_TEXT_BATCHED_ONLINE =
    'Still sending — this save is going in parts. Keep this page open until it finishes.';

/** Is the browser reporting itself offline? Only `false` counts; an unknown is not a known outage. */
const _offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** The line for the notice right now. @param {boolean} batched */
export function slowSaveText(batched) {
    if (_offline()) return batched ? SLOW_SAVE_TEXT_BATCHED : SLOW_SAVE_TEXT;
    return batched ? SLOW_SAVE_TEXT_BATCHED_ONLINE : SLOW_SAVE_TEXT_ONLINE;
}

/**
 * The event a SLOW save announces twice, both carrying the save's `id`: `{ phase: 'slow' }` the moment it passes SLOW_SAVE_MS
 * (v24.55), and `{ phase: 'done', ms, hiddenMs, onlineWhenSlow, batched, ok }` when it settles (v24.54;
 * `hiddenMs`, the part of `ms` the page spent in the background, v25.87 — see trackHiddenTime). A
 * diagnostic, not a feature — error-reporter.js listens and records the case that cannot be explained
 * by signal (the browser said online), because an iPhone whose every save took longer than
 * SLOW_SAVE_MS left nothing behind to say WHICH part was slow. An event rather than an import, because
 * this module must stay free of Firebase so its rules can be unit-tested.
 */
export const SLOW_SAVE_EVENT = 'myb-slow-save';

/**
 * Watch a write promise and report when it is slow. Returns the SAME promise, so a caller's
 * `await` sees exactly the result or error it would have seen without the watcher.
 * `onSlow` fires at most once, only if the promise is still unsettled after `ms`. `onDone` fires
 * once on settlement, and ONLY if `onSlow` fired — a quick write shows nothing and clears nothing.
 * @template T
 * @param {Promise<T>} promise
 * @param {{ ms?: number, onSlow?: () => void, onDone?: () => void,
 *           setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (id: any) => void }} [opts]
 * @returns {Promise<T>}
 */
export function watchSlowCommit(promise, opts = {}) {
    const { ms = SLOW_SAVE_MS, onSlow = () => {}, onDone = () => {},
            setTimer = setTimeout, clearTimer = clearTimeout } = opts;
    let settled = false, slow = false;
    const timer = setTimer(() => { if (!settled) { slow = true; onSlow(); } }, ms);
    const finish = () => {
        settled = true;
        clearTimer(timer);
        if (slow) onDone();
    };
    // Observe without consuming: the rejection still reaches the caller through `promise` itself.
    promise.then(finish, finish);
    return promise;
}

/**
 * Is the page hidden right now — in the background, or behind a locked screen? `null` when the
 * browser cannot say, so an unknown is never read as "on screen".
 * @returns {boolean|null}
 */
const _pageHidden = () => {
    const state = /** @type {any} */ (globalThis).document?.visibilityState;
    return typeof state === 'string' ? state === 'hidden' : null;
};

/**
 * Listen for the page going into or out of the background. Returns the way to stop listening, or
 * `null` when there is nothing to listen on.
 * @param {() => void} onChange
 * @returns {(() => void)|null}
 */
const _onVisibilityChange = onChange => {
    const doc = /** @type {any} */ (globalThis).document;
    if (typeof doc?.addEventListener !== 'function') return null;
    doc.addEventListener('visibilitychange', onChange);
    return () => doc.removeEventListener('visibilitychange', onChange);
};

/**
 * A stopwatch for the time the page spends HIDDEN — in the background, or behind a locked screen —
 * from now until `stop()` (v25.87).
 *
 * WHY: an installed iPhone app reported a save that took 81.8s to be confirmed while online, with its
 * sign-in token back in 0.0s. Two different causes fit that, and the report could not tell them
 * apart: a slow connection to the server, or a phone that put the app in the background mid-save.
 * iOS FREEZES an installed app it has backgrounded and the wall clock runs on through the freeze, so
 * a save the server would have confirmed in a second reads as a minute and more. The hidden time
 * beside the total says which: most of the wait hidden is the phone's, none of it the connection's.
 *
 * It counts by the clock from the hidden moment to the visible one, so the frozen stretch counts
 * although no code ran during it. A frozen page can resume, run its overdue timers and even settle
 * the save BEFORE the queued `visibilitychange` back to visible arrives, with the state already
 * reading visible (splash-watchdog.test.mjs pins the same order) — so `stop()` closes a stretch that
 * is still open at its own moment rather than waiting for that event.
 *
 * `stop()` returns the hidden milliseconds, or `null` when they cannot be measured (no Page
 * Visibility API, or nothing to listen on) — never a 0, which would claim "on screen throughout".
 * Pure: the three dependencies are injected for the tests.
 * @param {{ isHidden?: () => boolean|null, subscribe?: (onChange: () => void) => ((() => void)|null),
 *           now?: () => number }} [deps]
 * @returns {{ stop: () => number|null }}
 */
export function trackHiddenTime({ isHidden = _pageHidden, subscribe = _onVisibilityChange, now = Date.now } = {}) {
    const unmeasured = { stop: () => null };
    try {
        const hiddenAtStart = isHidden();
        if (hiddenAtStart === null) return unmeasured;
        let total = 0;
        /** @type {number|null} */ let since = hiddenAtStart ? now() : null;
        // Math.max: a wall clock set backwards mid-save must not subtract time that was hidden.
        const close = () => { if (since !== null) { total += Math.max(0, now() - since); since = null; } };
        const unsubscribe = subscribe(() => {
            if (isHidden()) { if (since === null) since = now(); }
            else close();
        });
        if (typeof unsubscribe !== 'function') return unmeasured;
        // Once it has stopped listening nothing can open a stretch again, so a later call returns the
        // same figure.
        return { stop() { try { unsubscribe(); } catch { /* the figure stands without it */ } close(); return total; } };
    } catch {
        return unmeasured;   // a diagnostic must never disturb the save it describes
    }
}

let _waiting = 0;

/** @returns {HTMLElement|null} */
function _noticeEl() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('slowSaveNotice');
    if (!el) {
        el = document.createElement('div');
        el.id = 'slowSaveNotice';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.hidden = true;
        document.body.appendChild(el);
    }
    return el;
}

/** The usual visually-hidden recipe (`.sr-only` in shared.css), inline because the notice's own id
 *  rule out-specifies a class: present for assistive tech, invisible on screen. */
const _UNSEEN = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0';

/**
 * Draw the notice for the counts as they stand — three states.
 *
 * THE LIVE REGION IS THERE BEFORE ITS WORDS (Nov 2026). It used to be created, filled and un-hidden
 * in one step, and a live region that arrives already holding its text is commonly NOT announced:
 * assistive technology announces changes to a region it already knows (MDN, "ARIA live regions":
 * "Establish the live region before updating its content. Start with an empty live region…"). So
 * the person who could not see the line was the one not told why Save stayed disabled. Now, while
 * any write is on its way, the region is in the page empty and unseen; when one turns slow, only
 * its text changes, and the box appears. With nothing in flight it is hidden, as before.
 */
function _render() {
    try {
        const el = _noticeEl();
        if (!el) return;
        const text = _waiting > 0 ? slowSaveText(_batchedWaiting > 0) : '';
        if (el.textContent !== text) el.textContent = text;   // an unchanged line is not re-announced
        el.style.cssText = _waiting > 0 || _inFlight === 0 ? '' : _UNSEEN;
        el.hidden = _waiting === 0 && _inFlight === 0;
    } catch { /* the notice must never disturb the save it describes */ }
}

/** Writes handed to withSlowSaveNotice and not yet settled, slow or not. */
let _inFlight = 0;
/** A number per save, so a listener can pair the two announcements of one save. */
let _saveSeq = 0;

/**
 * How many app writes are waiting on the server right now. A page that reloads itself (a service
 * worker update) asks this first: a range booking commits in chunks, and a reload between two of
 * them strands the rest (review A13).
 * @returns {number}
 */
export function writesInFlight() { return _inFlight + backgroundWritesInFlight() + (hasUnconfirmedWrite() ? 1 : 0); }
// …PLUS the background writes no page started (`trackBackgroundWrite`, claim-retry.js — the "own
// password" record, review 11 Nov 2026), PLUS one while a write is UNCONFIRMED (v24.39, external review). A write abandoned on sign-out
// settles its promise here, so the count fell to zero while Firestore still held the write — and in
// a second tab that cache is memory-only, so an automatic reload lost it. The reader is told to
// reload; that choice stays theirs, not the service worker's.

/** Waiting writes that are part of a batched save — while any is up, the stay-here line wins. */
let _batchedWaiting = 0;

/**
 * Raise the notice for one more waiting write. Reference-counted: two writes can wait at once, and
 * the line must stay up until the LAST of them settles. A batched write anywhere in the set shows
 * the stay-here wording, because leaving would strand its later batches.
 * @param {boolean} batched
 */
function _show(batched) {
    _waiting++;
    if (batched) _batchedWaiting++;
    _render();
}

/**
 * Lower the notice for one settled write; it disappears only when none is left waiting, and falls
 * back to the ordinary wording once no batched write remains.
 * @param {boolean} batched
 */
function _hide(batched) {
    _waiting = Math.max(0, _waiting - 1);
    if (batched) _batchedWaiting = Math.max(0, _batchedWaiting - 1);
    _render();
}

/**
 * Wrap an app write so a long wait for the server is explained on screen. Pass-through: the
 * caller awaits the result and handles success and failure exactly as before.
 * @template T
 * @param {Promise<T>} promise
 * @param {{ batched?: boolean }} [opts]  `batched: true` when this write is one of several batches
 *   committed in sequence — the notice then asks the reader to stay (see SLOW_SAVE_TEXT_BATCHED).
 * @returns {Promise<T>}
 */
export function withSlowSaveNotice(promise, { batched = false } = {}) {
    _inFlight++;
    _render();   // the live region goes into the page now, empty, so its words can be announced later
    // From the START, the span `ms` below covers: a phone usually freezes the app before the slow
    // moment, and it is the overdue timer, on the way back, that raises the notice (v25.87).
    const hidden = trackHiddenTime();
    const settle = () => { _inFlight = Math.max(0, _inFlight - 1); _render(); hidden.stop(); };
    promise.then(settle, settle);   // observe only — the caller still sees the result or error
    // `window.__E2E?.slowSaveMs` is a TEST SEAM, the same shape as text-scale.js's: the e2e holds a
    // commit open and would otherwise sit through eight real seconds to see the notice. Nothing in
    // production sets __E2E, so production always waits SLOW_SAVE_MS.
    const seam = /** @type {any} */ (globalThis).__E2E?.slowSaveMs;
    const ms = typeof seam === 'number' && seam > 0 ? seam : SLOW_SAVE_MS;
    const started = Date.now();
    const id = ++_saveSeq;   // pairs this save's 'slow' with its 'done' when two overlap (v24.57)
    let onlineWhenSlow = true;
    /** @type {boolean} */ let ok = true;
    promise.then(() => { ok = true; }, () => { ok = false; });
    return watchSlowCommit(promise, {
        ms,
        onSlow: () => {
            onlineWhenSlow = !_offline();
            _show(batched);
            // The moment it BECOMES slow (v24.55), so a listener can measure what is slow while it
            // still is — error-reporter.js times a sign-in token here, to tell auth from transport.
            try { globalThis.dispatchEvent?.(new CustomEvent(SLOW_SAVE_EVENT, { detail: { phase: 'slow', id, batched } })); } catch { /* diagnostic only */ }
        },
        onDone: () => {
            _hide(batched);
            try {
                globalThis.dispatchEvent?.(new CustomEvent(SLOW_SAVE_EVENT, {
                    detail: { phase: 'done', id, ms: Date.now() - started, hiddenMs: hidden.stop(), onlineWhenSlow, batched, ok },
                }));
            } catch { /* a diagnostic must never disturb the save it describes */ }
        },
    });
}
