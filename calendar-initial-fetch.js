// @ts-check
/**
 * calendar-initial-fetch.js — Initial 3-month Firestore fetch and sync-chip UI for index.html.
 *
 * Owns: initial 3-month override fetch, sync-chip state machine (loading timer, timeout,
 *   retry), visibilitychange re-render guard.
 * Does NOT own: override cache internals (calendar-overrides.js), render logic (calendar-renderer.js).
 * Edit here for: sync chip appearance, retry behaviour, initial fetch range.
 */

import { _initialFetchInProgress, setInitialFetchInProgress, addFetchedMonths, clearFetchedMonth, monthKey, fetchOverridesForRange } from './calendar-overrides.js';
import { formatISO } from './roster-data.js';

/**
 * Kick off the initial 3-month Firestore fetch and wire the sync chip + visibility handler.
 *
 * @param {{ isTeamViewMode: () => boolean, renderCalendar: () => void }} deps
 */
export function initInitialFetch({ isTeamViewMode, renderCalendar }) {
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
  let syncChip = null;
  /** @type {any} */
  let syncStatus = null;
  let syncResolved = false;
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

  // If Firestore takes more than 10 s, show an error state with a retry link.
  const timeoutTimer = setTimeout(() => {
    if (syncResolved) return;
    if (syncChip) {
      syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
      syncChip.className = 'sync-chip sync-chip-error';
      syncChip.disabled = false;
      syncChip.onclick = doRetry;   // assignment is idempotent — never accumulates handlers
      announceSync('Couldn\'t update your shifts. Activate to retry.');
    }
    if (calGrid) calGrid.classList.remove('calendar-fetching');
  }, 10000);

  async function doRetry() {
    if (!syncChip) return;
    const _retryGen = ++_fetchGen; // supersede any older pending request
    syncChip.textContent = '↻ Retrying…';
    syncChip.className = 'sync-chip';
    syncChip.disabled = true;
    announceSync('Retrying');

    addFetchedMonths(_initialMonthKeys);

    const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
    const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

    try {
      await fetchOverridesForRange(startStr, endStr);
      syncResolved = true;
      if (syncChip) { syncChip.remove(); syncChip = null; }
      // A user-initiated retry succeeded — confirm it to screen readers, then clear.
      // (The initial silent fetch below stays silent so it isn't announced on every load.)
      announceSync('Shifts updated');
      setTimeout(() => announceSync(''), 3000);
      if (!isTeamViewMode()) renderCalendar();
    } catch (err) {
      console.error('[Firestore] Retry failed:', err);
      if (_retryGen !== _fetchGen) return; // a later retry superseded this one
      // Mirror the initial fetch's failure path: release the re-claimed months so a later
      // render/navigation can re-fetch them — otherwise a failed retry re-strands all three
      // for the session (the chip is a recovery path only while the calendar header exists).
      _initialMonthKeys.forEach(clearFetchedMonth);
      if (syncChip) {
        syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
        syncChip.className = 'sync-chip sync-chip-error';
        syncChip.disabled = false;
        syncChip.onclick = doRetry;   // assignment is idempotent — never accumulates handlers
        syncChip.focus();
        announceSync('Still couldn\'t update your shifts. Activate to retry.');
      }
    }
  }

  (async () => {
    try {
      const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
      const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

      await fetchOverridesForRange(startStr, endStr);
      syncResolved = true;
      if (!isTeamViewMode()) renderCalendar();

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
      // A renderCalendar() call between the fetch start and the catch (e.g. from
      // visibilitychange) rebuilds the calendar header, detaching the chip from the
      // DOM. Re-create it if the reference is stale (null or disconnected).
      const _chip = /** @type {Node|null} */ (syncChip);
      if (!_chip || !_chip.isConnected) {
        const header = document.querySelector('.calendar-header');
        if (header) {
          syncChip = document.createElement('button');
          syncChip.type = 'button';
          syncChip.className = 'sync-chip';
          header.appendChild(syncChip);
        }
      }
      if (syncChip) {
        syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
        syncChip.className = 'sync-chip sync-chip-error';
        syncChip.disabled = false;
        syncChip.onclick = doRetry;   // assignment is idempotent — never accumulates handlers
        announceSync('Couldn\'t update your shifts. Activate to retry.');
      }
    } finally {
      setInitialFetchInProgress(false);
      clearTimeout(loadingTimer);
      clearTimeout(timeoutTimer);
      if (syncChip && syncResolved && !syncChip.className.includes('sync-chip-error')) {
        syncChip.remove();
      }
      if (calGrid) calGrid.classList.remove('calendar-fetching');
    }
  })();

  // If the tab is suspended on iOS during the initial fetch and then restored,
  // re-render from whatever cached data we have so the calendar is not blank.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _initialFetchInProgress) {
      if (!isTeamViewMode()) renderCalendar();
    }
  });
}
