// @ts-check
/**
 * operations-errors.js — the Error Log card on operations.html.
 *
 * One of the three reporting cards split out of operations-reports.js at v21.32 — see that
 * module's header for why. It awaits `sessionReady`, reads Firestore, and renders into its own
 * card by id; it touches no coordinator state and no other card.
 */
import { sessionReady } from './session.js';
import { formatDayMonthYear, formatClock } from './date-format.js';
import { withClaimRetry, getClientErrors, resolveClientError } from './firebase-client.js';
import { _cardLoadError, _relativeTime } from './operations-reports.js';

import { setStatus } from './status-text.js';
import { isDiagnosticEntry } from './client-errors.js';
import { attentionBadge } from './operations-attention.js';
import { unconfirmedWriteLine } from './claim-retry.js';
import { withSlowSaveNotice } from './slow-save.js';

/** A line under a control that says what became of its write, as the Account status rows do.
 *  @param {string} text @returns {HTMLSpanElement} */
function writeLine(text) {
    const msg = Object.assign(document.createElement('span'), { className: 'email-set-error', textContent: text });
    msg.setAttribute('role', 'alert');
    return msg;
}
/** Whether the notification-tap re-read below is wired — once per page. */
let _tapRereadWired = false;
/**
 * A tap on the admin's Error Log notification (v26.04, functions/error-log-notify.js) while Operations is
 * ALREADY open only changes the hash, so without this the card opened over the entries read at page
 * load — "2 new" beside a log without them, the reset-request card's Sep 2026 bug again. The page's deep
 * link (operations-app.js) opens the card and STRIPS the hash in the same event, so this reads the hash
 * the event carried (`newURL`), never `location.hash`. It lives here rather than beside that deep link
 * because the re-read must carry this card's `opts` (the header below says why), and they arrive here.
 * Wired once, from the first call; a re-entry reuses it.
 * @param {object} opts  initErrorLog's own options, forwarded
 */
function _rereadOnNotificationTap(opts) {
    if (_tapRereadWired) return;
    _tapRereadWired = true;
    window.addEventListener('hashchange', (e) => {
        let hash = '';
        try { hash = new URL(e.newURL).hash; } catch { /* not a URL: not the notification */ }
        if (hash === '#error-log') void initErrorLog(opts);
    });
}

/**
 * @param {{onAttention?: (count: number, extra: {truncated: boolean}) => void, onWithdraw?: () => void}} [opts]
 *   `onWithdraw` (v25.06) — the count has become UNKNOWN (a refresh failed): the strip withdraws its
 *   item, exactly as the header chip clears. It kept "3 unresolved errors" above a failed panel.
 *   `onAttention` feeds the Needs-attention strip — called at the SAME moments the header count
 *   chip is set, with the same pair the chip is spelled from (`attentionBadge`), so the strip and the
 *   chip cannot disagree. Deliberately NOT called when the card
 *   load fails: the strip only claims what is known, and a reassuring zero from a failed read
 *   would be a lie (operations-attention.js header).
 *
 *   ── `opts` IS FORWARDED THROUGH EVERY RE-ENTRY, AND THAT IS THE WHOLE POINT (v23.36) ──────────
 *   This card re-invokes ITSELF twice — the in-place refresh after "Resolve all shown", and the
 *   retry button on a failed load — and both used to call `initErrorLog()` bare. The refreshed
 *   render then re-looked-up the header chip by id and set it correctly while `onAttention` was
 *   undefined, so the chip and the strip disagreed in both directions: after a resolve-all the
 *   card read "No errors recorded" under a strip still listing them, and after a failed load
 *   followed by a successful retry the strip was ABSENT ENTIRELY over a card showing four errors
 *   — a false all-clear on the page's own index of what needs attention.
 *
 *   `admin-auth.js` never had this because its `loadGaps` is a CLOSURE over `onAttention`; this is
 *   a module-level function re-invoked by name, so the options have to travel by hand. If you add
 *   another re-entry point, pass `opts`.
 */
async function initErrorLog(opts = {}) {
    const { onAttention } = opts;
    const content = document.getElementById('errorLogContent');
    if (!content) return;
    _rereadOnNotificationTap(opts);

    try {
        await sessionReady;
        const got = (await withClaimRetry(getClientErrors)) || {};
        const { errors = [], truncated = false } = got;
        // More than 200 RESOLVED records exist, and the reader took an unordered 200 of them, so the
        // resolved rows below are the newest of that 200 — not necessarily the newest (pwa-5). Read
        // loosely: a reader without the flag has not cut the list.
        const resolvedTruncated = /** @type {any} */ (got).resolvedTruncated === true;

        content.innerHTML = '';

        // Visually-hidden live region so resolving an error is announced to AT
        // (the row just gains a strikethrough class otherwise — a silent change).
        const errStatus = document.createElement('div');
        errStatus.className = 'sr-only';
        errStatus.setAttribute('role', 'status');
        errStatus.setAttribute('aria-live', 'polite');
        content.appendChild(errStatus);

        // No-silent-caps: more than 100 unresolved ENTRIES exist and 100 are shown. "Resolve all
        // shown" re-reads and pulls the next batch; a per-row Resolve does not, so the note says how
        // the rest arrive. Entries, not errors: slow-save diagnostics share the cap and are not errors.
        if (truncated) {
            const note = document.createElement('p');
            note.className = 'error-truncation-note';
            const diag = errors.filter(e => !e.resolved && isDiagnosticEntry(e)).length;
            setStatus(note, `⚠ More than 100 unresolved entries — showing 100${diag ? `, ${diag} of them slow-save diagnostics` : ''}. Resolve these to load the rest.`);
            content.appendChild(note);
        }

        // Resolve-all toolbar — after a bad release spikes many similar errors, clearing them one
        // tap per row (with no refresh) is a grind. This resolves every unresolved error currently
        // shown, then refreshes the card in place to pull the next batch (B3).
        let unresolvedShown = errors.filter(e => !e.resolved);
        // Header count chip (v18.17): the unresolved backlog at a glance while the card is collapsed.
        // A floor ("2+") when the query cap hid entries; empty (→ :empty hides it) at a known zero.
        // Re-set on every render (resolve-all does a full refresh) and on each per-row resolve (via
        // _syncResolveAllBtn below), so it never goes stale.
        const _countChip = document.getElementById('errorLogCountChip');
        const _setCountChip = () => {
            // Diagnostics are listed and resolvable, but never COUNTED as errors (v24.57).
            const n = unresolvedShown.filter(e => !isDiagnosticEntry(e)).length;
            if (_countChip) _countChip.textContent = attentionBadge(n, truncated);
            onAttention?.(n, { truncated });
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
                bar.querySelector('.email-set-error')?.remove();
                // The batch is captured ONCE (Nov 2026 review). A row's own Resolve finishing meanwhile
                // replaces `unresolvedShown` with a shorter array, and matching the results by index
                // against THAT blamed a neighbour — "try again" then re-stamped a row that had resolved.
                const batch   = unresolvedShown;
                const count   = batch.length;
                const results = await Promise.allSettled(batch.map(e => withSlowSaveNotice(resolveClientError(e.id))));
                // …and a failure the row's own Resolve has since made good is no failure.
                const failedItems = batch.filter((e, i) => results[i].status === 'rejected' && unresolvedShown.some(u => u.id === e.id));
                // An outcome nobody knows (signed out mid-write, or refused by the page's write gate after
                // one) is said so, and the button stays off: another press would only be refused.
                const unknown = results.map(r => (r.status === 'rejected' ? unconfirmedWriteLine(r.reason, 'this batch of resolves', 'the Error Log') : null)).find(Boolean);
                if (failedItems.length) {
                    // Retry only the ones that FAILED — re-resolving the already-succeeded rows would
                    // reset their 90-day retention clock and inflate the count.
                    const succeeded = count - failedItems.length;
                    unresolvedShown = failedItems;
                    // Chip in step with the pruned snapshot (v18.23 review fix — this path bypassed
                    // _syncResolveAllBtn because it sets its own "✗ N didn't resolve" button text,
                    // so the header chip stranded on the pre-resolve count).
                    _setCountChip();
                    allBtn.disabled = !!unknown;
                    allBtn.textContent = unknown ? `${failedItems.length} not confirmed` : `✗ ${failedItems.length} didn't resolve — try again`;
                    if (unknown) bar.append(writeLine(unknown));
                    errStatus.textContent = `${succeeded} resolved, ${failedItems.length} ${unknown ? 'not confirmed' : 'failed'}`;
                    return;   // leave the list as-is so the admin can retry just the failures
                }
                content.setAttribute('aria-busy', 'true');
                await initErrorLog(opts);   // in-place refresh — pulls the next batch, no page reload
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
            setStatus(none, '✓ No errors recorded.');
            content.appendChild(none);
            return;
        }

        // Said once, where the resolved rows begin (or at the end, when none of them is shown).
        let resolvedCapSaid = !resolvedTruncated;
        const sayResolvedCap = () => {
            const note = Object.assign(document.createElement('p'), { className: 'error-truncation-note error-resolved-cap-note',
                textContent: 'More than 200 resolved errors — the resolved entries shown may not be the most recent.' });
            content.appendChild(note);
            resolvedCapSaid = true;
        };
        errors.forEach(err => {
            if (err.resolved && !resolvedCapSaid) sayResolvedCap();
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
                        // withSlowSaveNotice (Nov 2026 review): a write the server has not answered
                        // says so, as Admin's and Settings' do, rather than sitting on a disabled button.
                        await withSlowSaveNotice(resolveClientError(err.id));
                        row.classList.add('error-row--resolved');
                        resolveBtn.remove();
                        // Prune this doc from the resolve-all snapshot: without this, a later
                        // "Resolve all shown" re-stamps it (fresh resolvedAt → a NEW 90-day
                        // retention clock) and overcounts (v16.69 review fix).
                        unresolvedShown = unresolvedShown.filter(u => u.id !== err.id);
                        _syncResolveAllBtn();
                        errStatus.textContent = `Error from ${err.memberName ?? 'unknown'} marked resolved`;
                    } catch (e) {
                        // An UNKNOWN outcome is not a failure (AUTH_AND_SESSIONS 22): the write may still
                        // land, and the page's write gate refuses the next one — so it says which, and
                        // Resolve stays off rather than inviting a press that can only be refused.
                        const unknown = unconfirmedWriteLine(e, 'this resolve', 'the Error Log');
                        if (unknown) { actions.append(writeLine(unknown)); return; }
                        resolveBtn.disabled = false;
                        resolveBtn.textContent = '✗ Failed — try again';
                        setTimeout(() => { resolveBtn.textContent = '✓ Resolve'; }, 3000);
                    }
                });
                actions.appendChild(resolveBtn);
            }

            row.appendChild(actions);
            content.appendChild(row);
        });
        if (!resolvedCapSaid) sayResolvedCap();

    } catch (e) {
        console.error('[ErrorLog]', e);
        // The count is now UNKNOWN — clear the header chip rather than let a pre-failure count
        // (possibly just resolved server-side) keep advertising on the collapsed card (v18.23
        // review fix; re-looked-up because _countChip is scoped inside the try).
        const _chip = document.getElementById('errorLogCountChip');
        if (_chip) _chip.textContent = '';
        opts.onWithdraw?.();   // …and the strip with it — one fact, two voices (v25.06)
        _cardLoadError(content, 'Couldn\'t load error log — check your connection.', () => initErrorLog(opts));
    } finally {
        content.removeAttribute('aria-busy');
    }
}

/** Build the plain-text block that gets pasted into Claude for diagnosis. */
function _formatForClaude(/** @type {any} */ err) {
    const at = err.timestamp?.toDate ? err.timestamp.toDate() : null;
    const when = at ? `${formatDayMonthYear(at)}, ${formatClock(at)}` : 'unknown';
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
