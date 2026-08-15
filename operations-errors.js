// @ts-check
/**
 * operations-errors.js — the Error Log card on operations.html.
 *
 * One of the three reporting cards split out of operations-reports.js at v21.32 — see that
 * module's header for why. It awaits `sessionReady`, reads Firestore, and renders into its own
 * card by id; it touches no coordinator state and no other card.
 */
import { sessionReady } from './session.js';
import { withClaimRetry, getClientErrors, resolveClientError } from './firebase-client.js';
import { _cardLoadError, _relativeTime } from './operations-reports.js';

async function initErrorLog() {
    const content = document.getElementById('errorLogContent');
    if (!content) return;

    try {
        await sessionReady;
        const { errors = [], truncated = false } = (await withClaimRetry(getClientErrors)) || {};

        content.innerHTML = '';

        // Visually-hidden live region so resolving an error is announced to AT
        // (the row just gains a strikethrough class otherwise — a silent change).
        const errStatus = document.createElement('div');
        errStatus.className = 'sr-only';
        errStatus.setAttribute('role', 'status');
        errStatus.setAttribute('aria-live', 'polite');
        content.appendChild(errStatus);

        // No-silent-caps: more than 100 unresolved errors exist; only the first 100 are
        // shown. The card renders once on load and the Resolve button doesn't re-fetch, so
        // tell the admin to reload after clearing some — don't imply they appear on their own.
        if (truncated) {
            const note = document.createElement('p');
            note.className = 'error-truncation-note';
            note.textContent = '⚠ More than 100 unresolved errors — showing the first 100. Resolve these to load the rest.';
            content.appendChild(note);
        }

        // Resolve-all toolbar — after a bad release spikes many similar errors, clearing them one
        // tap per row (with no refresh) is a grind. This resolves every unresolved error currently
        // shown, then refreshes the card in place to pull the next batch (B3).
        let unresolvedShown = errors.filter(e => !e.resolved);
        // Header count chip (v18.17): the unresolved backlog at a glance while the card is collapsed.
        // '100+' when the query cap hid the true total; empty (→ :empty hides it) at zero. Re-set on
        // every render (resolve-all does a full refresh) and on each per-row resolve (via
        // _syncResolveAllBtn below), so it never goes stale.
        const _countChip = document.getElementById('errorLogCountChip');
        const _setCountChip = () => {
            if (_countChip) _countChip.textContent = unresolvedShown.length
                ? (truncated ? '100+' : String(unresolvedShown.length)) : '';
        };
        _setCountChip();
        /** Keep the resolve-all button's count in step as individual resolves prune the
         *  snapshot; disable it when nothing unresolved remains shown. Assigned below. */
        let _syncResolveAllBtn = () => {};
        if (unresolvedShown.length > 0) {
            const bar = document.createElement('div');
            bar.className = 'error-log-toolbar';
            const allBtn = document.createElement('button');
            allBtn.type = 'button';
            allBtn.className = 'btn-action btn-secondary error-resolve-all-btn';
            allBtn.textContent = `✓ Resolve all shown (${unresolvedShown.length})`;
            _syncResolveAllBtn = () => {
                allBtn.textContent = unresolvedShown.length
                    ? `✓ Resolve all shown (${unresolvedShown.length})`
                    : '✓ All shown resolved';
                allBtn.disabled = unresolvedShown.length === 0;
                _setCountChip();
            };
            allBtn.addEventListener('click', async () => {
                allBtn.disabled = true;
                allBtn.textContent = 'Resolving…';
                const count   = unresolvedShown.length;
                const results = await Promise.allSettled(unresolvedShown.map(e => resolveClientError(e.id)));
                const failedItems = unresolvedShown.filter((_, i) => results[i].status === 'rejected');
                if (failedItems.length) {
                    // Retry only the ones that FAILED — re-resolving the already-succeeded rows would
                    // reset their 90-day retention clock and inflate the count.
                    const succeeded = count - failedItems.length;
                    unresolvedShown = failedItems;
                    // Chip in step with the pruned snapshot (v18.23 review fix — this path bypassed
                    // _syncResolveAllBtn because it sets its own "✗ N didn't resolve" button text,
                    // so the header chip stranded on the pre-resolve count).
                    _setCountChip();
                    allBtn.disabled = false;
                    allBtn.textContent = `✗ ${failedItems.length} didn't resolve — tap to retry`;
                    errStatus.textContent = `${succeeded} resolved, ${failedItems.length} failed`;
                    return;   // leave the list as-is so the admin can retry just the failures
                }
                content.setAttribute('aria-busy', 'true');
                await initErrorLog();   // in-place refresh — pulls the next batch, no page reload
                // Announce on the FRESH live region, after aria-busy cleared (the refresh's
                // finally removes it): setting it before the refresh put the message inside an
                // aria-busy subtree that was then destroyed — screen readers heard nothing
                // (v16.69 review fix).
                const freshStatus = content.querySelector('[role="status"]');
                if (freshStatus) freshStatus.textContent = `${count} error${count !== 1 ? 's' : ''} resolved`;
            });
            bar.appendChild(allBtn);
            content.appendChild(bar);
        }

        if (errors.length === 0) {
            const none = document.createElement('p');
            none.className = 'email-count-done';
            none.textContent = '✓ No errors recorded.';
            content.appendChild(none);
            return;
        }

        errors.forEach(err => {
            const row = document.createElement('div');
            row.className = 'error-row' + (err.resolved ? ' error-row--resolved' : '');

            // Summary line: when · member · page · message
            const summary = document.createElement('div');
            summary.className = 'error-summary';
            const addSpan = (/** @type {string} */ cls, /** @type {string} */ text) => {
                const s = document.createElement('span');
                s.className = cls;
                s.textContent = text;
                summary.appendChild(s);
            };
            addSpan('error-when',    err.timestamp?.toDate ? _relativeTime(err.timestamp.toDate()) : '—');
            addSpan('error-member',  err.memberName ?? '—');
            addSpan('error-page',    err.page ?? '—');
            addSpan('error-version', `v${err.appVersion ?? '—'}`);
            addSpan('error-msg',     err.message ?? '—');
            row.appendChild(summary);

            // Stack trace — collapsed by default
            if (err.stack) {
                const details = document.createElement('details');
                details.className = 'error-stack-details';
                const sum = document.createElement('summary');
                sum.textContent = 'Stack trace';
                const pre = document.createElement('pre');
                pre.className = 'error-stack';
                pre.textContent = err.stack;
                details.appendChild(sum);
                details.appendChild(pre);
                row.appendChild(details);
            }

            // Action buttons
            const actions = document.createElement('div');
            actions.className = 'error-actions';

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-action btn-secondary error-copy-btn';
            copyBtn.textContent = '⎘ Copy details';
            copyBtn.addEventListener('click', () => {
                // Guard first: on iOS (and any non-secure context) `navigator.clipboard` can be
                // undefined, so `navigator.clipboard.writeText` would throw synchronously — the
                // `.catch()` below only handles a rejected Promise, not that throw.
                if (!navigator.clipboard?.writeText) {
                    copyBtn.textContent = '✗ Copy unavailable';
                    setTimeout(() => { copyBtn.textContent = '⎘ Copy details'; }, 2000);
                    return;
                }
                navigator.clipboard.writeText(_formatForClaude(err)).then(() => {
                    copyBtn.textContent = '✓ Copied';
                    setTimeout(() => { copyBtn.textContent = '⎘ Copy details'; }, 2000);
                }).catch(() => {
                    copyBtn.textContent = '✗ Copy failed';
                    setTimeout(() => { copyBtn.textContent = '⎘ Copy details'; }, 2000);
                });
            });
            actions.appendChild(copyBtn);

            if (!err.resolved) {
                const resolveBtn = document.createElement('button');
                resolveBtn.className = 'btn-action btn-secondary error-resolve-btn';
                resolveBtn.textContent = '✓ Resolve';
                resolveBtn.addEventListener('click', async () => {
                    resolveBtn.disabled = true;
                    try {
                        await resolveClientError(err.id);
                        row.classList.add('error-row--resolved');
                        resolveBtn.remove();
                        // Prune this doc from the resolve-all snapshot: without this, a later
                        // "Resolve all shown" re-stamps it (fresh resolvedAt → a NEW 90-day
                        // retention clock) and overcounts (v16.69 review fix).
                        unresolvedShown = unresolvedShown.filter(u => u.id !== err.id);
                        _syncResolveAllBtn();
                        errStatus.textContent = `Error from ${err.memberName ?? 'unknown'} marked resolved`;
                    } catch {
                        resolveBtn.disabled = false;
                        resolveBtn.textContent = '✗ Failed — tap to retry';
                        setTimeout(() => { resolveBtn.textContent = '✓ Resolve'; }, 3000);
                    }
                });
                actions.appendChild(resolveBtn);
            }

            row.appendChild(actions);
            content.appendChild(row);
        });

    } catch (e) {
        console.error('[ErrorLog]', e);
        // The count is now UNKNOWN — clear the header chip rather than let a pre-failure count
        // (possibly just resolved server-side) keep advertising on the collapsed card (v18.23
        // review fix; re-looked-up because _countChip is scoped inside the try).
        const _chip = document.getElementById('errorLogCountChip');
        if (_chip) _chip.textContent = '';
        _cardLoadError(content, 'Couldn\'t load error log — check your connection.', initErrorLog);
    } finally {
        content.removeAttribute('aria-busy');
    }
}

/** Build the plain-text block that gets pasted into Claude for diagnosis. */
function _formatForClaude(/** @type {any} */ err) {
    const when = err.timestamp?.toDate
        ? err.timestamp.toDate().toLocaleString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : 'unknown';
    return [
        '🐛 App error — please diagnose',
        '',
        `App version: ${err.appVersion ?? '—'}`,
        `Page:        ${err.page ?? '—'}`,
        `Member:      ${err.memberName ?? '—'}`,
        `Time:        ${when}`,
        `Device:      ${err.userAgent ?? '—'}`,
        '',
        `Error: ${err.message ?? '—'}`,
        '',
        err.stack ? `Stack:\n${err.stack}` : '(no stack trace)',
    ].join('\n');
}

export { initErrorLog };
