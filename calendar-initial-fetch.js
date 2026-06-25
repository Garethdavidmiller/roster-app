// @ts-check
/**
 * calendar-initial-fetch.js — Initial 3-month Firestore fetch and sync-chip UI for index.html.
 *
 * Owns: initial 3-month override fetch, sync-chip state machine (loading timer, timeout,
 *   retry), visibilitychange re-render guard.
 * Does NOT own: override cache internals (calendar-overrides.js), render logic (calendar-renderer.js).
 * Edit here for: sync chip appearance, retry behaviour, initial fetch range.
 */

import { _initialFetchInProgress, setInitialFetchInProgress, addFetchedMonths, monthKey, fetchOverridesForRange } from './calendar-overrides.js';
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
  addFetchedMonths([
    monthKey(prev.getFullYear(), prev.getMonth()),
    monthKey(now.getFullYear(),  now.getMonth()),
    monthKey(next.getFullYear(), next.getMonth()),
  ]);

  /** @type {HTMLButtonElement|null} */
  let syncChip = null;
  let syncResolved = false;
  const calGrid = document.getElementById('calendarDisplay');

  // Show "↻ Updating your shifts…" chip after 800 ms if Firestore hasn't responded yet.
  const loadingTimer = setTimeout(() => {
    const header = document.querySelector('.calendar-header');
    if (header && !syncResolved) {
      syncChip = document.createElement('button');
      syncChip.type = 'button';
      syncChip.className = 'sync-chip';
      syncChip.setAttribute('aria-live', 'polite');
      syncChip.textContent = '↻ Updating your shifts…';
      syncChip.disabled = true;
      header.appendChild(syncChip);
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
      syncChip.addEventListener('click', doRetry, { once: true });
    }
    if (calGrid) calGrid.classList.remove('calendar-fetching');
  }, 10000);

  async function doRetry() {
    if (!syncChip) return;
    syncChip.textContent = '↻ Retrying…';
    syncChip.className = 'sync-chip';
    syncChip.disabled = true;

    addFetchedMonths([
      monthKey(prev.getFullYear(), prev.getMonth()),
      monthKey(now.getFullYear(),  now.getMonth()),
      monthKey(next.getFullYear(), next.getMonth()),
    ]);

    const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
    const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

    try {
      await fetchOverridesForRange(startStr, endStr);
      syncResolved = true;
      if (syncChip) { syncChip.remove(); syncChip = null; }
      if (!isTeamViewMode()) renderCalendar();
    } catch (err) {
      console.error('[Firestore] Retry failed:', err);
      if (syncChip) {
        syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
        syncChip.className = 'sync-chip sync-chip-error';
        syncChip.disabled = false;
        syncChip.addEventListener('click', doRetry, { once: true });
        syncChip.focus();
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

      if (syncChip) { syncChip.remove(); syncChip = null; }
    } catch (err) {
      syncResolved = true;
      console.error('[Firestore] Initial override fetch failed — base roster will be used', err);
      if (!syncChip) {
        const header = document.querySelector('.calendar-header');
        if (header) {
          syncChip = document.createElement('button');
          syncChip.type = 'button';
          syncChip.className = 'sync-chip';
          syncChip.setAttribute('aria-live', 'polite');
          header.appendChild(syncChip);
        }
      }
      if (syncChip) {
        syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
        syncChip.className = 'sync-chip sync-chip-error';
        syncChip.disabled = false;
        syncChip.addEventListener('click', doRetry, { once: true });
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
