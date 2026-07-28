// @ts-check
/**
 * calendar-initial-fetch.js — Initial 3-month Firestore fetch and sync-chip UI for index.html.
 *
 * Owns: initial 3-month override fetch, sync-chip state machine (loading timer, timeout,
 *   retry), visibilitychange re-render guard.
 * Does NOT own: override cache internals (calendar-overrides.js), render logic (calendar-renderer.js).
 * Edit here for: sync chip appearance, retry behaviour, initial fetch range.
 */

import { _initialFetchInProgress, setInitialFetchInProgress, addFetchedMonths, clearFetchedMonth, monthKey, fetchOverridesForRange, fetchOverridesForRangeFromCache } from './calendar-overrides.js';
import { formatISO } from './roster-data.js';

/** The sync's own failure deadline — the point at which the chip says "Couldn't update" (v19.08).
 *  Phase 2's auth wait is bounded by the SAME value, deliberately: if we are going to declare the
 *  sync failed at 10s, there is no sense waiting for a session past it. That also makes the async
 *  IIFE ALWAYS settle, which the state machine depends on — a never-settling `await authReady` meant
 *  neither `catch` nor `finally` ran, so `_initialFetchInProgress` stayed true, the three months
 *  stayed claimed (so no later navigation could re-fetch them) and `.calendar-fetching` stayed on
 *  the grid, permanently. The 10s timer painted a retry chip, but only where a `.calendar-header`
 *  exists — not in first-run or Team View, which is exactly where the stall was invisible. */
const SYNC_TIMEOUT_MS = 10000;

/** How long a user-initiated RETRY will wait for a session before reading anyway (v19.07).
 *  Not a tuned number and not a general timeout: the retry chip only exists after the 10s failure
 *  timeout, so auth has already had 10s+ to settle. This is just the "you tapped, here's a response"
 *  budget before an unresponsive control reads as broken. The READ itself is never bounded here. */
const RETRY_AUTH_WAIT_MS = 2000;

/**
 * Kick off the initial 3-month Firestore fetch and wire the sync chip + visibility handler.
 *
 * TWO-PHASE since v19.01 (AUTH_PLAN.md → E1). Phase 1 paints from the local Firestore cache
 * immediately — no network, no auth, so a returning device shows its roster at once. Phase 2 awaits
 * `authReady` and then runs the authoritative server read. The phases are ordered this way so that
 * requiring a session for reads (Track E, E2/E5) can never put a `signInAnonymously` round-trip in
 * front of data the device already holds — the failure mode that would break offline-first on the
 * app's primary surface. Under today's open rules both phases succeed and the only visible change is
 * that the cached roster paints sooner.
 *
 * @param {{ isTeamViewMode: () => boolean, renderCalendar: () => void, renderTeamView?: () => void,
 *           authReady?: Promise<any> }} deps
 *   authReady — resolves once a usable Firebase Auth session exists (the calendar passes
 *   `calendarAuthReady`). Defaults to already-resolved, so callers and tests that don't care are
 *   unaffected. Phase 2 waits on it; phase 1 deliberately does NOT.
 *   renderTeamView — re-renders the Team Week View grid from the (now-populated) cache
 *   WITHOUT re-fetching (v18.21). Without it, a user in team view when this fetch resolved
 *   was stranded on a base-roster grid: this success path rendered nothing in team view,
 *   and the team view's own week fetch then reconciled against the cache this fetch had
 *   ALREADY populated → "no change" → it skipped its re-render too. Both notifiers stood
 *   down. Deterministic on boot-into-team-view (restored mode), because Firestore's
 *   IndexedDB persistence makes this 3-month read reliably beat the week query — which is
 *   why a refresh never recovered.
 */
export function initInitialFetch({ isTeamViewMode, renderCalendar, renderTeamView = () => {}, authReady = Promise.resolve() }) {
  const now  = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Mark all three months as fetched before awaiting — prevents
  // ensureOverridesCached() from issuing redundant per-month fetches
  // if renderCalendar() fires while the initial query is in flight.
  setInitialFetchInProgress(true);
  const _initialMonthKeys = [
    monthKey(prev.getFullYear(), prev.getMonth()),
    monthKey(now.getFullYear(),  now.getMonth()),
    monthKey(next.getFullYear(), next.getMonth()),
  ];
  addFetchedMonths(_initialMonthKeys);

  /** @type {HTMLButtonElement|null} */
  /** @type {HTMLButtonElement|null} */ let syncChip = null;
  /** @type {any} */
  let syncStatus = null;
  let syncResolved = false;
  // Distinct from syncResolved (which means "settled" — set true on BOTH success AND failure): this
  // is set true ONLY when a fetch actually POPULATED the cache. The retry catch uses it so a failed
  // retry that follows an already-SUCCEEDED original doesn't needlessly clear fetchedMonths, WITHOUT
  // breaking the ordinary offline path (original failed → retry failed) where syncResolved is also true.
  let _dataLoaded = false;
  const calGrid = document.getElementById('calendarDisplay');

  // Announce sync state via a dedicated visually-hidden role="status" region.
  // The chip itself is a <button> (the retry control); aria-live on a focusable
  // control is announced unreliably, so the spoken status lives in its own node.
  /** @param {string} msg */
  function announceSync(msg) {
    const header = document.querySelector('.calendar-header');
    if (!header) return;
    if (!syncStatus || !(/** @type {Node} */ (syncStatus)).isConnected) {
      syncStatus = document.createElement('div');
      syncStatus.className = 'sr-only';
      syncStatus.setAttribute('role', 'status');
      syncStatus.setAttribute('aria-live', 'polite');
      header.appendChild(syncStatus);
    }
    syncStatus.textContent = msg;
  }

  // Generation counter — incremented by each doRetry() call so the original
  // slow request can detect that a retry has superseded it and skip modifying
  // the UI (otherwise a retry-success followed by a belated original-rejection
  // would re-show the error chip even though the data loaded successfully).
  let _fetchGen = 0;
  const _origGen = ++_fetchGen;

  // Show "↻ Updating your shifts…" chip after 800 ms if Firestore hasn't responded yet.
  const loadingTimer = setTimeout(() => {
    const header = document.querySelector('.calendar-header');
    if (header && !syncResolved) {
      syncChip = document.createElement('button');
      syncChip.type = 'button';
      syncChip.className = 'sync-chip';
      syncChip.textContent = '↻ Updating your shifts…';
      syncChip.disabled = true;
      header.appendChild(syncChip);
      announceSync('Updating your shifts');
    }
    if (calGrid) calGrid.classList.add('calendar-fetching');
  }, 800);

  // Re-attach the chip if a re-render detached it. The chip lives inside .calendar-header,
  // which renderCalendar()/swipe commits REBUILD — writing an error/retry state onto a detached
  // node announces "activate to retry" to screen readers while sighted users see nothing and have
  // nothing to tap (v16.69 review fix; the original-fetch catch always had this re-create logic).
  /** @returns {HTMLButtonElement|null} the attached chip (existing, re-created, or null when no header) */
  function ensureChipAttached() {
    if (syncChip && syncChip.isConnected) return syncChip;
    const header = document.querySelector('.calendar-header');
    if (!header) return null;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sync-chip';
    header.appendChild(chip);
    return chip;
  }

  // ── The failed-sync state, held OUTSIDE the chip DOM (v19.10) ───────────────────────────────
  //
  // Until now "the sync failed and can be retried" was represented ONLY by the existence of an
  // error chip. That is fine while `.calendar-header` exists — and it does not exist in FIRST RUN
  // or TEAM VIEW, the two states this module already documents as chip-less. There the failure was
  // simply dropped: ensureChipAttached() returned null, nothing recorded that a retry was owed, and
  // nothing looked again. Releasing the pre-claimed months (below) meant a later navigation could
  // silently re-fetch, but the user was never told anything had gone wrong and had nothing to press.
  //
  // So the state lives here instead, and the DOM becomes a VIEW of it: record first, render if we
  // can, and if we cannot, watch for a header and render then. A user who picks their name, or
  // toggles out of Team View, now gets the retry chip at that moment rather than never.
  /** @type {{text: string, className: string, announce: string, disabled?: boolean}|null} */
  let _chipState = null;
  /** @type {any} */
  let _headerWatcher = null;

  /** Record the chip state and render it if a header exists; otherwise wait for one. */
  function setChipState(/** @type {{text: string, className: string, announce: string, disabled?: boolean}|null} */ state) {
    _chipState = state;
    if (!state) { stopWatchingForHeader(); return; }
    renderChipState();
  }

  function renderChipState() {
    if (!_chipState) return;
    const chip = ensureChipAttached();
    // Keep watching whether or not we could render. With no header we are waiting for one to
    // appear; WITH one we are waiting for the next re-render to destroy the chip — and that is the
    // common case, not the exotic one: `buildCalendarContainer` rebuilds `.calendar-header` on
    // every swipe and month navigation, so the very first swipe after a failed sync used to take
    // the retry away permanently (v19.11). Stop only when the state itself is cleared.
    watchForHeader();
    if (!chip) return;
    syncChip = chip;
    chip.textContent = _chipState.text;
    chip.className   = _chipState.className;
    chip.disabled    = !!_chipState.disabled;
    chip.onclick     = doRetry;   // assignment is idempotent — never accumulates handlers
    announceSync(_chipState.announce);
  }

  // Watch for a `.calendar-header` appearing. Deliberately a MutationObserver rather than a hook on
  // the injected renderCalendar: the header is rebuilt by buildCalendarContainer on EVERY calendar
  // render, and most of those (swipe, month navigation, member change, first-run name selection) do
  // not pass through this module's callbacks — so a callback hook would miss exactly the transitions
  // that matter. The observer only exists while a chip is owed AND no header exists, and disconnects
  // the moment either changes, so the common path costs nothing.
  function watchForHeader() {
    if (_headerWatcher || typeof MutationObserver !== 'function' || !document.body) return;
    _headerWatcher = new MutationObserver(() => {
      if (!_chipState) { stopWatchingForHeader(); return; }
      if (syncChip && syncChip.isConnected) return;   // still on screen — nothing owed
      if (document.querySelector('.calendar-header')) renderChipState();
    });
    _headerWatcher.observe(document.body, { childList: true, subtree: true });
  }

  function stopWatchingForHeader() {
    if (!_headerWatcher) return;
    _headerWatcher.disconnect();
    _headerWatcher = null;
  }

  // `syncChip` is now assigned inside renderChipState(), which the type checker's control-flow
  // analysis cannot see across the function boundary — so at the `finally` below it wrongly narrows
  // to `never` (it only observes the `= null` on the success path). Reading through an accessor with
  // a declared return type restores the real type. Preferred over a cast, which would ASSERT
  // non-null and hide exactly the case the guard is there to handle.
  /** @returns {HTMLButtonElement|null} */
  function currentChip() { return syncChip; }

  // If Firestore takes more than 10 s, show an error state with a retry link.
  const timeoutTimer = setTimeout(() => {
    if (syncResolved) return;
    setChipState({
      text: '⚠ Couldn\'t update — tap to retry',
      className: 'sync-chip sync-chip-error',
      announce: 'Couldn\'t update your shifts. Activate to retry.',
    });
    if (calGrid) calGrid.classList.remove('calendar-fetching');
  }, SYNC_TIMEOUT_MS);

  async function doRetry() {
    if (!syncChip) return;
    const _retryGen = ++_fetchGen; // supersede any older pending request
    // Through setChipState, NOT a direct write: _chipState must stay the single source, or a
    // re-render landing mid-retry would repaint the error state still recorded underneath and tell
    // the user the sync had failed while it was in fact still running (v19.11).
    setChipState({ text: '↻ Retrying…', className: 'sync-chip', announce: 'Retrying', disabled: true });

    addFetchedMonths(_initialMonthKeys);

    const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
    const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

    try {
      // A retry is user-initiated with a visible "Retrying…" state, so waiting is expected — but it
      // must not be UNBOUNDED, which a plain `await authReady` would be (v19.07 fix to v19.01).
      // calendarAuthReady starts at page load, and this chip only appears after the 10s timeout, so
      // an auth promise still pending HERE has already hung for 10s+ and may never settle. Awaiting
      // it plainly would strand the chip on "Retrying…" — disabled, with no handler and no way back,
      // which is worse than the failure it was trying to recover from.
      //
      // So: give it a short moment, then read regardless. Under today's open rules the read succeeds
      // without a session; once reads require one it fails RETRYABLY into the error chip, which is
      // the recoverable outcome. (Phase 1 deliberately does NOT do this — there the right answer is
      // never to wait at all. Bounded-wait is right here precisely because a user is watching.)
      await Promise.race([authReady, new Promise(r => setTimeout(r, RETRY_AUTH_WAIT_MS))]);
      await fetchOverridesForRange(startStr, endStr);
      syncResolved = true;
      _dataLoaded  = true;
      // Release the in-progress flag before rendering — same reason as the original success path:
      // the render's ensureOverridesCached must be able to top up an out-of-window display month.
      // Reachable here when the ORIGINAL fetch is still hung (its finally hasn't run) (v16.23).
      setInitialFetchInProgress(false);
      // Clear the RECORDED state, not just the node — otherwise a header appearing later would
      // faithfully re-render an error that no longer applies (v19.10).
      setChipState(null);
      if (syncChip) { syncChip.remove(); syncChip = null; }
      // A user-initiated retry succeeded — confirm it to screen readers, then clear.
      // (The initial silent fetch below stays silent so it isn't announced on every load.)
      announceSync('Shifts updated');
      setTimeout(() => announceSync(''), 3000);
      if (isTeamViewMode()) renderTeamView(); else renderCalendar();
    } catch (err) {
      console.error('[Firestore] Retry failed:', err);
      // Bail if a later retry superseded this one OR if a fetch has meanwhile actually LOADED the
      // cache (_dataLoaded — success only, NOT the settle-on-failure syncResolved): a failed retry
      // that follows an already-succeeded original must not un-mark the three months as fetched and
      // force a needless re-query. Using syncResolved here would have wrongly bailed on the ordinary
      // offline path (original failed → retry failed) and stranded the chip on "Retrying…" (v16.19).
      if (_retryGen !== _fetchGen || _dataLoaded) return;
      // Mirror the initial fetch's failure path: release the re-claimed months so a later
      // render/navigation can re-fetch them — otherwise a failed retry re-strands all three
      // for the session (the chip is a recovery path only while the calendar header exists).
      _initialMonthKeys.forEach(clearFetchedMonth);
      setChipState({
        text: '⚠ Couldn\'t update — tap to retry',
        className: 'sync-chip sync-chip-error',
        announce: 'Still couldn\'t update your shifts. Activate to retry.',
      });
      // Only a RETRY moves focus: the user pressed something, so the result belongs under their
      // cursor. The initial fetch's failure is unsolicited and must not steal focus.
      if (syncChip && syncChip.isConnected) syncChip.focus();
    }
  }

  (async () => {
    try {
      const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
      const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

      // ── Phase 1: paint from the local cache (no network, no auth) ──────────────────────────
      // Deliberately NOT gated on authReady — that is the whole point of the split. It never
      // touches syncResolved/_dataLoaded: those mean "the authoritative read settled", and the chip
      // must still say "Updating…" while phase 2 runs. A cache miss returns false and paints nothing.
      const _painted = await fetchOverridesForRangeFromCache(startStr, endStr);
      // Skip the paint if a retry has already superseded this load (same guard as the catch below).
      if (_painted && _origGen === _fetchGen && !syncResolved) {
        if (isTeamViewMode()) renderTeamView(); else renderCalendar();
      }

      // ── Phase 2: the authoritative server read, once a session exists ─────────────────────
      // BOUNDED by the sync's own failure deadline (v19.08). Waiting for a session is the point of
      // this phase, but waiting FOREVER is not: an unbounded await meant the IIFE could never
      // settle, so neither catch nor finally ran and the fetch state leaked permanently (see
      // SYNC_TIMEOUT_MS). Past the deadline we read anyway — today that succeeds, and once reads
      // require a session it fails into the catch below, which is the recoverable path.
      await Promise.race([authReady, new Promise(r => setTimeout(r, SYNC_TIMEOUT_MS))]);
      await fetchOverridesForRange(startStr, endStr);
      syncResolved = true;
      _dataLoaded  = true;
      // Release the in-progress flag BEFORE the success render (v16.23): initInitialFetch now
      // starts before the first renderCalendar, so if the persisted display month sits OUTSIDE
      // the 3-month window, this render's ensureOverridesCached must be allowed to top it up —
      // waiting for the finally would skip that fetch and leave the month override-less.
      setInitialFetchInProgress(false);
      if (isTeamViewMode()) renderTeamView(); else renderCalendar();

      setChipState(null);   // see the retry path — a stale error must not be re-rendered later
      if (syncChip) { /** @type {HTMLButtonElement} */ (syncChip).remove(); syncChip = null; }
      announceSync('');
    } catch (err) {
      // A retry may have already succeeded while this original request was still
      // in-flight — if so, the UI is already in a good state; don't clobber it.
      if (_origGen !== _fetchGen) return;
      syncResolved = true;
      console.error('[Firestore] Initial override fetch failed — base roster will be used', err);
      // Release the 3 pre-claimed months so ensureOverridesCached() can re-fetch them on a later
      // render/navigation. Without this they stay marked fetched forever and their overrides never
      // load for the session — and the retry chip below only exists inside `.calendar-header`, which
      // is absent in team-view and first-run, leaving those states with NO recovery path at all.
      _initialMonthKeys.forEach(clearFetchedMonth);
      // A renderCalendar() call between the fetch start and the catch (e.g. from visibilitychange)
      // rebuilds the calendar header, detaching the chip — setChipState re-creates it. When there
      // is NO header at all (first run, Team View) the state is still recorded and rendered the
      // moment one appears, instead of the failure being silently dropped.
      setChipState({
        text: '⚠ Couldn\'t update — tap to retry',
        className: 'sync-chip sync-chip-error',
        announce: 'Couldn\'t update your shifts. Activate to retry.',
      });
    } finally {
      setInitialFetchInProgress(false);
      clearTimeout(loadingTimer);
      clearTimeout(timeoutTimer);
      const _chip = currentChip();
      if (_chip && syncResolved && !_chip.className.includes('sync-chip-error')) {
        _chip.remove();
      }
      if (calGrid) calGrid.classList.remove('calendar-fetching');
    }
  })();

  // If the tab is suspended on iOS during the initial fetch and then restored,
  // re-render from whatever cached data we have so the calendar is not blank.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _initialFetchInProgress) {
      if (isTeamViewMode()) renderTeamView(); else renderCalendar();
    }
  });
}
