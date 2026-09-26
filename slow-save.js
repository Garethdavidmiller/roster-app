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
 *      invites a second tap on the same days — and every save MINTS NEW document ids, so a repeat is
 *      a duplicate rather than an overwrite (the v16.23 double-tap hazard, which is why every write
 *      path disables its button before its first await). Explaining the wait is the fix; shortening
 *      it is not ours to do.
 *
 * `watchSlowCommit` is pure (timers injected) and unit-tested in slow-save.test.mjs. The DOM half is
 * the smallest thing that can hold one live line, and it reference-counts, because two writes can
 * be waiting at once and the first to finish must not take down the notice the second still needs.
 */

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
 * long leave or absence range — commit in chunks of 200, one after another, and only the chunk in
 * flight is held on the device: a chunk not yet started exists nowhere. Telling that admin they may
 * leave, as v24.21 did, lost every later chunk without an error. So this one asks them to stay.
 */
export const SLOW_SAVE_TEXT_BATCHED =
    'Waiting for signal — this save is still sending in parts. Keep this page open until it finishes.';

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

/** Writes handed to withSlowSaveNotice and not yet settled, slow or not. */
let _inFlight = 0;

/**
 * How many app writes are waiting on the server right now. A page that reloads itself (a service
 * worker update) asks this first: a range booking commits in chunks, and a reload between two of
 * them strands the rest (review A13).
 * @returns {number}
 */
export function writesInFlight() { return _inFlight; }

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
    const el = _noticeEl();
    if (!el) return;
    el.textContent = _batchedWaiting ? SLOW_SAVE_TEXT_BATCHED : SLOW_SAVE_TEXT;
    el.hidden = false;
}

/**
 * Lower the notice for one settled write; it disappears only when none is left waiting, and falls
 * back to the ordinary wording once no batched write remains.
 * @param {boolean} batched
 */
function _hide(batched) {
    _waiting = Math.max(0, _waiting - 1);
    if (batched) _batchedWaiting = Math.max(0, _batchedWaiting - 1);
    const el = _noticeEl();
    if (!el) return;
    if (_waiting) { el.textContent = _batchedWaiting ? SLOW_SAVE_TEXT_BATCHED : SLOW_SAVE_TEXT; return; }
    el.hidden = true; el.textContent = '';
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
    const settle = () => { _inFlight = Math.max(0, _inFlight - 1); };
    promise.then(settle, settle);   // observe only — the caller still sees the result or error
    // `window.__E2E?.slowSaveMs` is a TEST SEAM, the same shape as text-scale.js's: the e2e holds a
    // commit open and would otherwise sit through eight real seconds to see the notice. Nothing in
    // production sets __E2E, so production always waits SLOW_SAVE_MS.
    const seam = /** @type {any} */ (globalThis).__E2E?.slowSaveMs;
    const ms = typeof seam === 'number' && seam > 0 ? seam : SLOW_SAVE_MS;
    return watchSlowCommit(promise, { ms, onSlow: () => _show(batched), onDone: () => _hide(batched) });
}
