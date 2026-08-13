// @ts-check
/**
 * operations-reports.js — the three read-only "reporting" cards on operations.html:
 * Error Log, Usage, and App Speed. Extracted from operations-app.js (v17.46) as
 * behaviour-preserving card controllers — each awaits sessionReady, reads Firestore,
 * and renders into its own card by id; none touches coordinator state. `_cardLoadError`
 * is shared (the staying Work Email card uses it too), so it's exported back and imported
 * by operations-app.js — a one-directional dependency, no import cycle.
 */
import { sessionReady } from './session.js';
import { withClaimRetry, getClientErrors, resolveClientError, getUsageStats, getPerfStats, getSignInStats } from './firebase-client.js';
import { SPEED_GROUPS, perfVerdict, summarisePerfBy, PERF_DIMENSIONS, summariseBootPhases, THIN_SAMPLE } from './perf-stats.js';
import { escapeHtml } from './roster-data.js';

/**
 * Emoji + label for each page id — shared by the Usage and App Speed cards (was defined
 * identically inside both). One source so a label change (or a new page) is edited once.
 *
 * ── A MISSING ENTRY IS INVISIBLE UNTIL THE PAGE HAS TRAFFIC ─────────────────────────────────────
 *
 * Both cards fall back to the raw id and a generic 📄 when a page is not listed here, so `overtime`
 * shipped at v20.59 and rendered lower-case beside six title-case names for twenty-five releases —
 * until it had enough opens to appear at all. That is the whole failure mode: the fallback is
 * silent, the counter itself works, and nothing surfaces the gap while the page is quiet. Every
 * emoji matches the page's own nav pill (`NAV_PAGES`), which is what makes the two surfaces read as
 * one app. `page-contract-parity.test.mjs` now fails when a served page has no entry.
 * @type {Record<string, { emoji: string, label: string }>}
 */
const PAGE_META = {
    calendar:   { emoji: '📅', label: 'Calendar' },
    admin:      { emoji: '📝', label: 'Admin' },
    paycalc:    { emoji: '💷', label: 'Pay calculator' },
    operations: { emoji: '🔧', label: 'Operations' },
    settings:   { emoji: '⚙️', label: 'Settings' },
    links:      { emoji: '🔗', label: 'Links' },
    overtime:   { emoji: '⏱️', label: 'Overtime' },
};

/** Document/guide OPEN counters (v18.20) — share the pv_ counts map with the page ids above but
 *  render as their own "opens" group (an open is a different act from a page view). Emojis match
 *  each feature's in-app icon (nav drawer / notification signature).
 * @type {Record<string, { emoji: string, label: string }>}
 */
const OPEN_META = {
    'huddle':         { emoji: '📋', label: 'Daily Huddle' },
    'circular':       { emoji: '📰', label: 'Weekly Retail Circular' },
    'newsletter':     { emoji: '🗞️', label: 'Marylebone Newsletter' },
    // All four guides, not two (v19.95). The Staff & Admin Guide and the Pay Calculator Guide are
    // the two most likely to answer a question staff would otherwise ask a manager, and they were
    // the two with no counter at all — so the group answered "which of the two REFERENCE guides is
    // read more" while reading as "which guides are read". Emojis match NAV_GUIDES.
    'guide-staff':    { emoji: '📘', label: 'Staff & Admin Guide' },
    'guide-paycalc':  { emoji: '💷', label: 'Pay Calculator Guide' },
    'guide-railcard': { emoji: '🎫', label: 'Railcard Guide' },
    'guide-fip':      { emoji: '🇪🇺', label: 'FIP Travel Guide' },
    'guide-rangers':  { emoji: '🗺️', label: 'Rangers & Rovers' },
};

/**
 * Render a monitoring-card load failure with a "Try again" button that re-runs JUST this card
 * (B2). Previously each card's catch told the admin to "reload" — a full page reload that re-runs
 * every other card too, for a blip on one. The button clears the card and re-invokes its own init
 * function, so a transient failure costs one tap, not a whole-page refresh.
 * @param {HTMLElement} content   the card's content container
 * @param {string} message        the failure message (no "reload" wording — the button IS the retry)
 * @param {() => void} retryFn     the card's own init function
 */
function _cardLoadError(content, message, retryFn) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'auth-desc';
    p.style.color = 'var(--error-red)';
    p.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action btn-secondary card-retry-btn';
    btn.textContent = '↻ Try again';
    btn.addEventListener('click', () => { btn.disabled = true; content.setAttribute('aria-busy', 'true'); retryFn(); });
    content.appendChild(p);
    content.appendChild(btn);
}

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
// ============================================
// USAGE CARD
// ============================================
async function initUsageCard() {
    const content = document.getElementById('usageContent');
    if (!content) return;

    try {
        await sessionReady;
        const stats = await withClaimRetry(getUsageStats);
        content.innerHTML = '';

        // Active-use headline numbers. These are the DEVICE-deduped trend: a member using a
        // phone and a laptop counts twice, which is the price of the server never learning who was
        // active. The exact unique count is the separate section below.
        // The card used to OPEN on two hero numbers with no heading, then hit a second set under
        // "Accounts that have signed in" — five big numbers, only one block labelled, so nothing said
        // how they related or which was authoritative. Both blocks are now headed and paired.
        //
        // ── WHY THIS IS NOT CALLED "ACCOUNTS ACTIVE" ANY MORE (v20.08, external review P2) ───────
        // It said that from v14.14 to v20.07, sitting directly above a block headed "Accounts that
        // have signed in" — so the two read as the same measure at different precisions, and the
        // upper one as the authoritative headcount. It is neither. The unit is a MEMBER ON A DEVICE
        // (a phone and a laptop are two), and since v19.95 the identity for a calendar-only visitor
        // is the member SELECTED on that device, which on a shared phone need not be the person
        // holding it. Every one of those caveats was already written down in the ? panel; what was
        // missing was a label that did not contradict them at a glance. "Accounts" is the word this
        // app uses for a provisioned Firebase identity, which is precisely what this is not counting.
        const accountsLabel = document.createElement('p');
        accountsLabel.className = 'usage-section-label';
        accountsLabel.innerHTML = '<span aria-hidden="true">\u{1F465}</span> Roster in use — by member and device';
        content.appendChild(accountsLabel);

        const accounts = document.createElement('div');
        accounts.className = 'usage-stats';
        accounts.innerHTML =
            `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsThisMonth}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">👥</span> member-devices this month</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsLast30}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">📅</span> active in last 30 days</span></div>`;
        content.appendChild(accounts);
        // No note here. "Counted per account-device… a trend, not a headcount" is stated verbatim by
        // the card's own ? panel (the 📱 tip), and four blocks of dense grey micro-copy was most of
        // what made this card read as cluttered. The ? exists precisely for the standing caveats.

        // Exact unique accounts, from Firebase Auth's own lastSignInTime (v18.96). Rendered as its
        // own section, NOT merged into the numbers above, because it measures something different:
        // sign-ins rather than activity. Appended asynchronously and independently — it is a second
        // network call to a Cloud Function, and it must never delay or break the card that already
        // has its data.
        _appendSignInSection(content);

        // Which ADDRESS is each account on (v19.23) — the migration picture while the app is served
        // from both myb-roster.web.app and the GitHub Pages mirror.
        _appendOriginSection(content, stats.origins || []);

        // Page popularity — This month / Last month toggle (trend; stable early in a month).
        let popActive = 'this';
        const popToggle = document.createElement('div');
        popToggle.className = 'speed-toggle';
        popToggle.setAttribute('role', 'group');
        popToggle.setAttribute('aria-label', 'Time window');
        const heading = document.createElement('p');
        heading.className = 'usage-section-label';
        const popBody = document.createElement('div');

        /** Build one bar list (page views or opens). Both groups share ONE scale (`max`)
         * so a document opened once shows a proportional sliver, not a full-width bar as
         * long as the busiest page — bar length stays honest across the whole card.
         * @param {Array<{page:string,count:number}>} items @param {Record<string,{emoji:string,label:string}>} metaMap @param {number} max */
        const _bars = (items, metaMap, max) => {
            const list = document.createElement('div');
            list.className = 'usage-bars';
            items.forEach(({ page, count }) => {
                const meta  = metaMap[page];
                const emoji = meta ? meta.emoji : '📄';
                // Known labels are static/safe; an unknown page key (a tampered client
                // could write one) is escaped before it reaches innerHTML.
                const label = meta ? meta.label : escapeHtml(page);
                const pct   = Math.max(4, Math.round((count / max) * 100));
                const row = document.createElement('div');
                row.className = 'usage-bar-row';
                row.innerHTML =
                    // `title` so a truncated label is still recoverable. "Weekly Retail Circular"
                    // ellipsises at 390px and must NOT be shortened — it is a canonical staff-facing
                    // term (CLAUDE.md wording conventions), so the name stays and the tooltip carries it.
                    `<span class="usage-bar-label" title="${label}"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
                    `<span class="usage-bar-track"><span class="usage-bar-fill" style="width:${pct}%"></span></span>` +
                    `<span class="usage-bar-count">${count.toLocaleString('en-GB')}</span>`;
                list.appendChild(row);
            });
            return list;
        };

        const renderPop = () => {
            const all   = popActive === 'this' ? stats.pageCounts : stats.prevPageCounts;
            const month = popActive === 'this' ? stats.month : stats.prevMonth;
            // Split the shared counts map: page views vs document/guide opens (v18.20).
            const counts = all.filter(c => !OPEN_META[c.page]);
            const opens  = all.filter(c => OPEN_META[c.page]);
            // Emoji + label on every section heading — the card had four different patterns
            // (none / bare / emoji / bare-with-date), which is what made the sections read as a
            // pile rather than a sequence.
            // NOT \u{1F4CA} — that is the Usage card's OWN header icon, and a section should not
            // wear its parent's identity. \u{1F440} says what the number is: what gets looked at.
            heading.innerHTML = '<span aria-hidden="true">\u{1F440}</span> Page popularity — '
                + _usageMonthLabel(month);
            popBody.innerHTML = '';
            if (!counts.length && !opens.length) {
                const none = document.createElement('p');
                none.className = 'auth-desc';
                none.textContent = popActive === 'this'
                    ? 'No page views recorded yet this month.'
                    : 'No page views recorded last month.';
                popBody.appendChild(none);
                return;
            }
            // One shared scale across both groups (busiest count anywhere on the card).
            const scaleMax = Math.max(counts[0]?.count || 0, opens[0]?.count || 0) || 1;
            if (counts.length) popBody.appendChild(_bars(counts, PAGE_META, scaleMax));
            if (opens.length) {
                const openLbl = document.createElement('p');
                openLbl.className = 'usage-section-label usage-section-label--sub';
                openLbl.innerHTML = '<span aria-hidden="true">\u{1F4C4}</span> Documents &amp; guides — opens';
                popBody.appendChild(openLbl);
                popBody.appendChild(_bars(opens, OPEN_META, scaleMax));
            }
        };

        [['this', 'This month'], ['last', 'Last month']].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'speed-toggle-btn' + (key === popActive ? ' speed-toggle-btn--on' : '');
            btn.textContent = label;
            btn.setAttribute('aria-pressed', String(key === popActive));
            btn.addEventListener('click', () => {
                if (popActive === key) return;
                popActive = key;
                popToggle.querySelectorAll('.speed-toggle-btn').forEach((b, i) => {
                    const on = (i === 0 ? 'this' : 'last') === popActive;
                    b.classList.toggle('speed-toggle-btn--on', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                renderPop();
            });
            popToggle.appendChild(btn);
        });

        // Heading FIRST, then its toggle. Appended the other way round, the "This month / Last
        // month" buttons sat above the only text that says what they filter — so they read as
        // controlling whatever section happened to precede them.
        content.appendChild(heading);
        content.appendChild(popToggle);
        content.appendChild(popBody);
        renderPop();

        const note = document.createElement('p');
        note.className = 'usage-note';
        note.textContent = 'Anonymous — we never record who. Your own (admin) loads are excluded.';
        content.appendChild(note);

    } catch (e) {
        console.error('[Usage]', e);
        _cardLoadError(content, 'Couldn\'t load usage — check your connection.', initUsageCard);
    } finally {
        content.removeAttribute('aria-busy');
    }
}

/** Short labels for the addresses the app is served from, each with the text that says what it
 *  actually IS. `other` is deliberately vague — it is localhost and anything not yet named, and
 *  naming it precisely would imply we know what it is. */
/** @type {Record<string, {emoji: string, label: string, explain: string}>} */
// Labels kept SHORT so these rows can share the same label column as every other bar group in the
// card (38%). The v19.24 fix widened this section to 47% to stop "GitHub Pages mirror" truncating at
// 390px — which cured the truncation and left the three bar groups no longer lining up with each
// other, a worse kind of untidy.
//
// v19.29 — but a short label needs its meaning somewhere VISIBLE, and a `title` tooltip is not that.
// The owner, who owns both addresses, could not tell what the `web.app` row meant: a title needs a
// hover, and this card is read on a phone, so the one thing explaining these rows was unreachable on
// the device they are read on. `explain` is now rendered as a KEY under the bars (and still feeds the
// desktop title, but nothing depends on that). Every row gets a line, `elsewhere` included — it is
// the least self-explanatory label of the four, so omitting it would leave the same gap in miniature.
const ORIGIN_META = {
    web:   { emoji: '\u2705', label: 'web.app', explain: 'myb-roster.web.app' },
    pages: { emoji: '\u{1F4E6}', label: 'GitHub Pages', explain: 'garethdavidmiller.github.io/roster-app/' },
    fb:    { emoji: '\u{1F517}', label: 'firebaseapp', explain: 'myb-roster.firebaseapp.com' },
    other: { emoji: '\u2753', label: 'elsewhere', explain: 'localhost, or an address not recognised' },
};

/**
 * Render the migration picture: unique accounts per address over the last 30 days, and how many of
 * them opened the INSTALLED app rather than a browser tab.
 *
 * Deliberately states what it CANNOT see. The counters record opens, so an install that nobody has
 * opened in 30 days is invisible — and those are exactly the people a migration strands, which makes
 * the caveat load-bearing rather than boilerplate.
 *
 * @param {HTMLElement} content
 * @param {Array<{origin:string,accounts:number,installed:number}>} rows
 */
function _appendOriginSection(content, rows) {
    // Its own wrapper with a rule top AND bottom, exactly as `.usage-signin` does. Without the
    // bottom rule the Page-popularity "This month / Last month" toggle sits directly under this
    // section's note and reads as though it filters the ADDRESSES — the toggle's own heading is
    // below it, so nothing else says otherwise.
    const sec = document.createElement('div');
    sec.className = 'usage-origins';
    content.appendChild(sec);

    const label = document.createElement('p');
    label.className = 'usage-section-label';
    label.innerHTML = '<span aria-hidden="true">\u{1F6A6}</span> Which address staff are on';
    sec.appendChild(label);

    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'usage-note';
        // Says it is a STATE, not a fault, and when to look again. The old wording named the
        // version it shipped in, which is developer-speak in user-facing copy and goes stale —
        // in six months "after v19.23" tells the reader nothing at all.
        empty.textContent = 'No opens recorded yet. This fills in as staff open the app, and reads '
            + 'properly once it has a full 30 days.';
        sec.appendChild(empty);
        return;
    }

    const total = rows.reduce((n, r) => n + r.accounts, 0);
    const bars = document.createElement('div');
    bars.className = 'usage-bars';
    rows.forEach(({ origin, accounts, installed }) => {
        const meta = ORIGIN_META[origin] || ORIGIN_META.other;
        const pct  = total ? Math.round((accounts / total) * 100) : 0;
        const row  = document.createElement('div');
        row.className = 'usage-bar-row';
        const name = document.createElement('span');
        name.className = 'usage-bar-label';
        name.textContent = `${meta.emoji} ${meta.label}`;
        name.title = meta.explain;
        // A STACKED bar, not a longer count column. "22 · 17 installed" made this the only group in
        // the card whose count column was wide enough to shorten the tracks, so its bars no longer
        // lined up with the ones above and below. Nesting the installed share inside the accounts
        // share says the same thing — and says the RELATIONSHIP, which the text could not: installed
        // is a subset of these accounts, never a second population.
        const track = document.createElement('span');
        track.className = 'usage-bar-track';
        const fill = document.createElement('span');
        fill.className = 'usage-origin-fill';
        fill.style.width = `${Math.max(pct, accounts ? 2 : 0)}%`;
        const inner = document.createElement('span');
        inner.className = 'usage-origin-installed';
        inner.style.width = `${accounts ? Math.round((installed / accounts) * 100) : 0}%`;
        fill.appendChild(inner);
        track.appendChild(fill);
        const num = document.createElement('span');
        num.className = 'usage-bar-count';
        num.textContent = String(accounts);
        row.append(name, track, num);
        bars.appendChild(row);
    });
    sec.appendChild(bars);

    const legend = document.createElement('p');
    legend.className = 'usage-origin-legend';
    legend.innerHTML = '<span class="usage-origin-key usage-origin-key--installed"></span> opened from the installed app'
        + '<span class="usage-origin-key usage-origin-key--browser"></span> browser tab';
    sec.appendChild(legend);

    // The KEY (v19.29). Built from the rows actually SHOWN, in bar order, one line each — so it
    // never names an address nobody is on, and the eye can map each line back onto its bar. A
    // run-on sentence ("web.app is X, GitHub Pages is Y") is the shape that cannot be mapped back.
    const key  = document.createElement('ul');
    const seen = new Set();
    key.className = 'usage-origin-addr';
    rows.forEach(({ origin }) => {
        const meta = ORIGIN_META[origin] || ORIGIN_META.other;
        if (seen.has(meta.label)) return;
        seen.add(meta.label);
        const li = document.createElement('li');
        const name = document.createElement('b');
        name.textContent = meta.label;
        li.append(name, ` \u2014 ${meta.explain}`);
        key.appendChild(li);
    });
    sec.appendChild(key);

    const note = document.createElement('p');
    note.className = 'usage-note';
    // "Unique accounts" was too strong (v19.86, external review P2) and this figure is the one most
    // likely to be acted on — it is the evidence for deciding an old address can be retired, and a
    // count that reads as exact invites retiring one while staff are still on it. Deduplication is
    // a localStorage flag per identity per origin, so one person on two devices counts twice,
    // clearing browser data allows another count, a shared device counts each member picked, and
    // somebody using both addresses appears in both bars — which is what half-migrated looks like
    // and is exactly why the figure must not claim to be a headcount. The EXACT unique count is a
    // different measure altogether and sits in its own section below, from Firebase Auth.
    note.textContent = 'Account-device signals over the last 30 days — directional, not an exact headcount. '
        + 'One person can count on more than one device or address.';
    sec.appendChild(note);
}

/**
 * Append the EXACT unique-account sign-in figures (v18.96) to the Usage card.
 *
 * Deliberately its own section rather than more numbers in the row above, because it answers a
 * different question. The figures above count ACTIVITY, deduped per device; these count distinct
 * accounts that have SIGNED IN, which Firebase Auth already tracks exactly. Both are true and
 * neither replaces the other, so the card says which is which rather than picking one.
 *
 * Runs detached and swallows its own failure: it is a second network call (a Cloud Function, not
 * Firestore) hanging off a card that already has everything else it needs. A slow or failed call
 * must degrade to "this section is absent", never to a failed Usage card — so this is intentionally
 * NOT awaited by initUsageCard and never calls _cardLoadError.
 *
 * @param {HTMLElement} content
 * @returns {void}
 */
function _appendSignInSection(content) {
    const wrap = document.createElement('div');
    wrap.className = 'usage-signin';
    content.appendChild(wrap);

    getSignInStats().then(s => {
        // Guard against a re-render finishing first (retry, or a second initUsageCard): if this
        // wrapper is no longer in the document, its card has been replaced — drop the result.
        if (!wrap.isConnected) return;
        const label = document.createElement('p');
        label.className = 'usage-section-label';
        label.innerHTML = '<span aria-hidden="true">\u{1F511}</span> Accounts that have signed in';
        const nums = document.createElement('div');
        nums.className = 'usage-stats';
        // Labels are terse ("last 30 days", not "in the last 30 days") because three stats share the
        // row: at 375px the longer form wrapped to three lines and left the boxes cramped. The
        // section heading above already supplies the verb. 💤 for never-signed-in reads as dormant
        // and stays legible at 12px — 🕳️ was tried first and renders as an illegible dark smudge.
        nums.innerHTML =
            `<div class="usage-stat"><span class="usage-stat-num">${s.last30}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">🔑</span> last 30 days</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${s.last7}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">📆</span> last 7 days</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${s.neverSignedIn}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">💤</span> never signed in</span></div>`;
        const note = document.createElement('p');
        note.className = 'usage-note';
        // State the caveats rather than let the number be read as "active staff". Until v20.47 there
        // was a tidy relationship to lean on: sessions capped at 30 days, so a live session REQUIRED
        // a sign-in inside 30 days and this figure was a slight OVER-count of active people. **That
        // is no longer true and the direction has flipped** — at 60 days (`SESSION_MS`, session.js)
        // someone can sign in once and use the app daily for two months without ever re-entering
        // this window, so the count now misses active people as well as including stopped ones. It
        // is a sign-in count and nothing more, which is exactly what the visible note says; do not
        // re-add a claim about active staff in either direction unless the window is derived from
        // SESSION_MS. `neverSignedIn` is the actionable one: provisioned staff who may not know the
        // app exists.
        // "staff accounts", never "active accounts": THIS CARD already uses "active" for the
        // device-deduped activity figure directly above, so reusing the word here would make two
        // different numbers appear to measure the same thing.
        note.textContent =
            `Exact count across ${s.total} staff accounts — counts sign-ins, not opens.`;
        wrap.append(label, nums, note);
    }).catch(e => {
        // Silent by design — see the docstring. Logged for the developer only.
        console.error('[Usage] sign-in stats', e);
        wrap.remove();
    });
}
// ── App speed card (Project 0 latency, surfaced in plain language) ──────────────
async function initPageSpeedCard() {
    const content = document.getElementById('pageSpeedContent');
    if (!content) return;

    // `thin` renders like `none` — neutral, no colour verdict. The percentage is still shown; it
    // is the CLAIM that is withheld, not the number.
    const TONE_CLASS = { good: 'good', ok: 'ok', bad: 'bad', none: 'none', thin: 'none' };
    /** width:% segments (good/ok/slow) from a {quick,ok,slow,total} band row.
     *  @param {{quick:number, ok:number, slow:number, total:number}} b */
    const segs = (b) => {
        if (!b.total) return '';
        const w = (/** @type {number} */ n) => (n / b.total) * 100;
        return `<span class="speed-seg speed-seg--good" style="width:${w(b.quick)}%"></span>` +
               `<span class="speed-seg speed-seg--ok"   style="width:${w(b.ok)}%"></span>` +
               `<span class="speed-seg speed-seg--bad"  style="width:${w(b.slow)}%"></span>`;
    };
    /** A small "🔑 Signing in" / "📄 Opening pages" section heading. @param {string} emoji @param {string} label */
    const subhead = (emoji, label, rule = false) => {
        const p = document.createElement('p');
        // `rule` draws a divider above, the way the Usage card separates its bar groups. Without it
        // the card is one continuous scroll and a new subject has nothing marking where it begins.
        p.className = 'speed-subhead' + (rule ? ' speed-subhead--rule' : '');
        p.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
        return p;
    };
    /** A full-width overall band bar (Quick/A moment/Slow) — used for the aggregate login section,
     *  so it shows the SAME three bands as the per-page bars (not just a single headline %).
     *  @param {{quick:number, ok:number, slow:number, total:number, pctQuick:number, pctOk:number, pctSlow:number}} b */
    const overallBar = (b) => {
        const wrap = document.createElement('div');
        wrap.className = 'speed-bar speed-bar--overall';
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', `${b.pctQuick}% quick, ${b.pctOk}% a moment, ${b.pctSlow}% slow`);
        wrap.innerHTML = segs(b);
        return wrap;
    };
    /** The shared colour key (Quick/A moment/Slow) — explains both the login bar and the page bars. */
    const legendEl = () => {
        const legend = document.createElement('div');
        legend.className = 'speed-legend';
        legend.innerHTML = /** @type {Array<'quick'|'ok'|'slow'>} */ (['quick', 'ok', 'slow']).map(g => {
            const grp = SPEED_GROUPS[g];
            return `<span class="speed-legend-item"><span class="speed-dot speed-dot--${grp.tone}"></span>${grp.label} <span class="speed-legend-sub">(${grp.sub})</span></span>`;
        }).join('');
        return legend;
    };
    /** A toned verdict banner: big % "quick" + plain sentence + a sub line.
     *  @param {{tone:'good'|'ok'|'bad'|'none'|'thin', text:string}} verdict
     *  @param {{pctQuick:number}} overall @param {number} total @param {string} unit
     *  @param {string} [windowLabel] - "this month" / "last month", for the sub line */
    const verdictBanner = (verdict, overall, total, unit, windowLabel = 'this month') => {
        const div = document.createElement('div');
        div.className = `speed-verdict speed-verdict--${TONE_CLASS[verdict.tone]}`;
        // NO "(few)" MARKER HERE, deliberately — `perfVerdict` already returns a whole sentence
        // saying it ("Too few sign-ins yet to read as a trend"), and this line sits directly under
        // that sentence. v21.16 added one anyway and it was doing nothing twice over: it repeated
        // the sentence above it, and `.speed-thin` is `--text-mid`/400 against a sub-line that is
        // ALREADY `--text-mid`/400 — measured identical in colour, weight and size, so it read as
        // three more words rather than as a mark. The marker earns its place on the breakdown rows
        // and the per-page table, where the label beside it is `--text-dark` and there is no
        // sentence; it does not earn it here.
        const sub = total
            ? `${overall.pctQuick}% within a second · ${total.toLocaleString('en-GB')} ${unit} ${windowLabel}`
            : (windowLabel === 'this month'
                ? 'Fills in as staff use the app over the coming days.'
                : 'No data recorded last month.');
        div.innerHTML =
            `<span class="speed-verdict-num">${total ? overall.pctQuick + '%' : '—'}</span>` +
            `<span class="speed-verdict-text">${verdict.text}<span class="speed-verdict-sub">${sub}</span></span>`;
        return div;
    };

    /** A lighter sub-heading for the two "opening a page" milestones. @param {string} emoji @param {string} label */
    const subMilestone = (emoji, label) => {
        const p = document.createElement('p');
        p.className = 'speed-subhead speed-subhead--sub';
        p.innerHTML = `<span aria-hidden="true">${emoji}</span> ${label}`;
        return p;
    };
    /** A small muted framing line. @param {string} text */
    const noteLine = (text) => {
        const p = document.createElement('p');
        p.className = 'speed-note';
        p.textContent = text;
        return p;
    };
    /** Per-page rows showing ALL THREE milestones — appears, code loaded, usable — so the same page's
     *  speeds sit together and one page's stage can be scanned against every other's.
     *
     *  The third column is the point (v20.80). With two columns the second one was labelled "ready"
     *  and carried `domReady`, which is when the SCRIPTS finished, not when the page was usable — on
     *  the Calendar those are now different by seconds. A page that never marks the milestone leaves
     *  its cell EMPTY rather than borrowing another bar, exactly as a page with no paint data does.
     *  @param {Array<any>} fcpByPage @param {Array<any>} pagesByPage @param {Array<any>} readyByPage @param {string} month */
    const dualRows = (fcpByPage, pagesByPage, readyByPage, month) => {
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label';
        heading.textContent = `By page — ${_usageMonthLabel(month)}`;
        frag.appendChild(heading);

        const fcpMap   = new Map(fcpByPage.map(p => [p.page, p]));
        const pagesMap = new Map(pagesByPage.map(p => [p.page, p]));
        const readyMap = new Map((readyByPage || []).map(p => [p.page, p]));
        const allPages = [...new Set([...pagesMap.keys(), ...fcpMap.keys(), ...readyMap.keys()])]
            .sort((a, b) => (pagesMap.get(b)?.total || 0) - (pagesMap.get(a)?.total || 0)
                         || (fcpMap.get(b)?.total   || 0) - (fcpMap.get(a)?.total   || 0)
                         || a.localeCompare(b));

        const rows = document.createElement('div');
        rows.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--dual speed-dual-head';
        head.innerHTML = '<span></span><span class="speed-dual-label">Appears</span>' +
                         '<span class="speed-dual-label">Code</span>' +
                         '<span class="speed-dual-label">Usable</span><span></span>';
        rows.appendChild(head);

        allPages.forEach(pg => {
            const meta  = PAGE_META[pg];
            const emoji = meta ? meta.emoji : '📄';
            const label = meta ? meta.label : escapeHtml(pg);
            const f = fcpMap.get(pg);
            const r = pagesMap.get(pg);
            const u = readyMap.get(pg);
            const count = (r?.total) || (f?.total) || (u?.total) || 0;
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--dual';
            row.innerHTML =
                // A page with three opens can render a full-width RED bar and mean nothing at all.
                // Same marker, same threshold and same reasoning as the breakdown rows below — it
                // was simply never applied here, where the bar is at its most emphatic.
                `<span class="speed-row-label"><span aria-hidden="true">${emoji}</span> ${label}`
                    + `${count && count < THIN_SAMPLE ? ' <span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="appears: ${f ? f.pctQuick : 0}% quick">${f ? segs(f) : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="code loaded: ${r ? r.pctQuick : 0}% quick">${r ? segs(r) : ''}</span>` +
                (u ? `<span class="speed-bar" role="img" aria-label="usable: ${u.pctQuick}% quick">${segs(u)}</span>`
                   // An EMPTY bar is not the honest mark for "this page does not report the
                   // milestone" — an unfilled track sitting beside a filled one reads as 0%, which
                   // is a measurement, and the wrong one. A dash says there is no number.
                   : '<span class="speed-bar-none" aria-label="usable: not reported">—</span>') +
                `<span class="speed-row-count">${count.toLocaleString('en-GB')}</span>`;
            rows.appendChild(row);
        });
        frag.appendChild(rows);
        return frag;
    };

    // The thin-sample threshold now lives in perf-stats.js, so the headline verdict and the per-page
    // table are governed by the same number as these rows (v21.16). It used to be declared here and
    // therefore applied only here — which is exactly how a card ends up marking a 10-sample row
    // "(few)" while making a confident claim from 19 samples two sections above it.

    /** One breakdown block: the busiest page's samples split by a single dimension.
     *  @param {Record<string, number>} samples @param {string} page
     *  @param {'conn'|'mode'|'version'} dimension */
    const breakdownRows = (samples, page, dimension) => {
        const { rows } = summarisePerfBy(samples, { page, metric: 'domReady', dimension, minSamples: THIN_SAMPLE });
        if (rows.length < 2) return null;   // one group explains nothing — it IS the page total
        const frag = document.createDocumentFragment();
        // The SAME class the "By page" group above uses. These are the same kind of thing — a label
        // over a set of bars — and they were styled three ranks apart: bold dark, bold muted, and
        // plain muted body text. Two structural ranks, five treatments, was the whole problem.
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = PERF_DIMENSIONS[dimension].label;
        frag.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'speed-rows';
        // A column header, borrowing the idiom the per-page dual rows already established. It is
        // what lets each row drop the repeated "over 1s" and become a number — three words per row
        // that never change are noise, and on a 390px screen they were most of the column.
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--why speed-dual-head';
        head.innerHTML = '<span></span><span></span>'
            + '<span class="speed-dual-label">over 1s</span>'
            + '<span class="speed-dual-label">loads</span>';
        list.appendChild(head);
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--why';
            const thin = r.total < THIN_SAMPLE;
            // ── WHICH NUMBER GOES HERE ──────────────────────────────────────────────────────
            //
            // It said "% slow" first, and the first real data showed that was the wrong band. Every
            // row read 0–3% slow while its bar carried a wide amber middle: the Calendar's tail is
            // not "over 3 seconds", it is "over ONE second", which is 13% of loads and the band the
            // whole card is framed around ("86% within a second"). A number reporting 3% next to a
            // bar that is visibly a quarter amber makes the reader trust the number and miss the
            // finding.
            //
            // So the row states the complement of the headline — everything NOT under a second —
            // and the bar keeps showing how that splits. The full three-way breakdown stays in the
            // aria-label, which is where a screen-reader user gets what sighted users read off the
            // bar.
            const overOneSecond = 100 - r.pctQuick;
            row.innerHTML =
                `<span class="speed-row-label">${escapeHtml(r.label)}${thin ? ' <span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="${r.pctQuick}% quick, ${r.pctOk}% a moment, ${r.pctSlow}% slow">${segs(r)}</span>` +
                `<span class="speed-row-count">${overOneSecond}%</span>` +
                `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}</span>`;
            list.appendChild(row);
        });
        frag.appendChild(list);
        return frag;
    };

    /** The boot-phase block (v20.33): the busiest page's opens split into the three STAGES of
     *  starting up, in boot order. Same row grammar as the dimensional blocks — but where those
     *  split the LOADS into groups, these rows are contiguous SPANS of every load, so the loads
     *  column reads near-identical down the rows and each row answers "how often did THIS stage
     *  run long". The stated number is the share over ½ SECOND — a stage-scaled threshold, named
     *  in the column header exactly like the dimensional blocks name theirs (the v20.19 rule: a
     *  number must state its own band): the load-level bands call under-a-second Quick, but one
     *  STAGE eating 500ms+ is precisely what pushes a whole open into the amber band.
     *  Renders nothing until updated devices report — no scaffolding for future data.
     *  @param {Record<string, number>} samples @param {string} page */
    const phaseRows = (samples, page) => {
        const { rows } = summariseBootPhases(samples, { page });
        if (!rows.length) return null;
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label speed-dim-label';
        heading.textContent = 'By stage of start-up';
        frag.appendChild(heading);
        // This block declares its OWN bands — the one place on the card the top legend does not
        // apply, so the note must say so or the legend silently lies about these three bars.
        frag.appendChild(noteLine('Every open passes through all three stages, so these bars use finer bands: green under ½ second, amber to 1 second, red over. One long stage is what makes a slow open slow.'));

        const list = document.createElement('div');
        list.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--why speed-dual-head';
        head.innerHTML = '<span></span><span></span>'
            + '<span class="speed-dual-label">over ½s</span>'
            + '<span class="speed-dual-label">loads</span>';
        list.appendChild(head);
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--why';
            const thin = r.total < THIN_SAMPLE;
            // The aria-label states the PHASE bands, because this block's bars do not follow the
            // card legend — a screen-reader user must not be told "quick/a moment/slow" here.
            row.innerHTML =
                `<span class="speed-row-label">${escapeHtml(r.label)}${thin ? ' <span class="speed-thin">(few)</span>' : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="${escapeHtml(r.sub)}: ${r.pctQuick}% under half a second, ${r.pctOk}% between half and one second, ${r.pctSlow}% over a second">${segs(r)}</span>` +
                `<span class="speed-row-count">${r.pctOver500}%</span>` +
                `<span class="speed-row-sub">${r.total.toLocaleString('en-GB')}</span>`;
            list.appendChild(row);
        });
        frag.appendChild(list);
        return frag;
    };

    /** The whole "why" section, for the page with the most samples.
     *
     *  Deliberately NOT hardcoded to the Calendar, even though the Calendar is what prompted it and
     *  is ~74% of all opens: pinning a page id here would leave the section quietly answering about
     *  the wrong page the first time that changes. The busiest page is the one whose distribution
     *  drives the headline figure, which is the same reason the Calendar is the interesting one now.
     *  @param {Record<string, number>} samples @param {Array<any>} byPage */
    const whySection = (samples, byPage) => {
        const busiest = byPage[0];
        if (!busiest || !busiest.total) return null;
        const meta = PAGE_META[busiest.page];
        const frag = document.createDocumentFragment();
        // A top-level SECTION, at the same rank as "Signing in" and "Opening pages" — it answers a
        // question of its own. It was rendered at milestone rank (the "First appears" tier), which
        // put the card's third subject one level below the two it sits beside.
        frag.appendChild(subhead('🔍', `Why some are slower — ${meta ? meta.emoji + ' ' + meta.label : busiest.page}`, true));
        frag.appendChild(noteLine(
            `The busiest page (${busiest.total.toLocaleString('en-GB')} opens), split by what was already being recorded with each load.`));
        let any = false;
        // Boot stages FIRST — "which part of starting up ran long" is the question the dimensional
        // splits below can only gesture at, so when the data exists it leads.
        const phases = phaseRows(samples, busiest.page);
        if (phases) { frag.appendChild(phases); any = true; }
        for (const dim of /** @type {Array<'conn'|'mode'|'version'>} */ (['conn', 'mode', 'version'])) {
            const block = breakdownRows(samples, busiest.page, dim);
            if (block) { frag.appendChild(block); any = true; }
        }
        return any ? frag : null;
    };

    try {
        await sessionReady;
        const stats = await withClaimRetry(getPerfStats);   // { thisMonth, lastMonth }
        content.innerHTML = '';

        // ── Window toggle: This month / Last month (trend across deploys; stable early in a month) ──
        let active = 'thisMonth';
        const toggle = document.createElement('div');
        toggle.className = 'speed-toggle';
        toggle.setAttribute('role', 'group');
        toggle.setAttribute('aria-label', 'Time window');
        const body = document.createElement('div');

        /** Render the body for the active window. */
        const render = () => {
            const w = stats[/** @type {'thisMonth'|'lastMonth'} */ (active)];   // { month, login, fcp, pages }
            const windowLabel = active === 'thisMonth' ? 'this month' : 'last month';
            body.innerHTML = '';

            // The colour key belongs to the WHOLE card — every bar in it uses these three bands. It
            // used to sit after the sign-in bar, which was ambiguous and became wrong the moment
            // section dividers arrived: it read as part of "Signing in" rather than as the key to
            // everything below it. First position, before any bars, is the only place it is
            // unambiguous.
            if (w.login.total || w.fcp.total || w.pages.total) body.appendChild(legendEl());

            // Section 1 — Signing in (a distinct journey).
            body.appendChild(subhead('🔑', 'Signing in'));
            body.appendChild(noteLine('Only fresh sign-ins are timed — normally fewer than the accounts on the Usage card, since a saved session opens the app without signing in again.'));
            body.appendChild(verdictBanner(perfVerdict(w.login.overall, 'login'), w.login.overall, w.login.total, 'sign-ins', windowLabel));
            if (w.login.total) body.appendChild(overallBar(w.login.overall));

            // Section 2 — Opening a page: two milestones in timeline order (appears → ready).
            body.appendChild(subhead('📄', 'Opening pages', true));
            body.appendChild(noteLine('Three moments when a page opens — when something first appears, when the app’s code has loaded, and when the page is actually usable.'));
            body.appendChild(subMilestone('✨', 'First appears'));
            body.appendChild(verdictBanner(perfVerdict(w.fcp.overall, 'fcp'), w.fcp.overall, w.fcp.total, 'page opens', windowLabel));
            body.appendChild(subMilestone('📦', 'Code loaded'));
            body.appendChild(verdictBanner(perfVerdict(w.pages.overall, 'pages'), w.pages.overall, w.pages.total, 'page opens', windowLabel));
            // The one an admin should read as "how fast is the app". The two above are stages of
            // getting there and neither is the answer: "appears" is the splash painting, and "code
            // loaded" fires while the Calendar can still be blank — it waits on the access decision,
            // which is asynchronous and happens after DOMContentLoaded (v20.80).
            body.appendChild(subMilestone('✅', 'Usable'));
            body.appendChild(verdictBanner(perfVerdict(w.ready.overall, 'ready'), w.ready.overall, w.ready.total, 'page opens', windowLabel));
            body.appendChild(noteLine('“Usable” is counted only on pages that report it, so its total is smaller than the two above — it is not a sign of fewer opens.'));

            if (w.fcp.total || w.pages.total || w.ready.total) {
                body.appendChild(dualRows(w.fcp.byPage, w.pages.byPage, w.ready.byPage, w.month));
            }

            // Section 3 — WHY. The per-page rows above say which page is slow; this says for whom.
            const why = whySection(w.samples || {}, w.pages.byPage);
            if (why) body.appendChild(why);

            const note = document.createElement('p');
            note.className = 'usage-note';
            note.textContent = 'Speeds are how long the app took to respond. Groups marked "(few)" have too few loads to read into. Your own (admin) loads are excluded. Anonymous — we never record who.';
            body.appendChild(note);
        };

        [['thisMonth', 'This month'], ['lastMonth', 'Last month']].forEach(([key, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'speed-toggle-btn' + (key === active ? ' speed-toggle-btn--on' : '');
            btn.textContent = label;
            btn.setAttribute('aria-pressed', String(key === active));
            btn.addEventListener('click', () => {
                if (active === key) return;
                active = key;
                toggle.querySelectorAll('.speed-toggle-btn').forEach((b, i) => {
                    const on = (i === 0 ? 'thisMonth' : 'lastMonth') === active;
                    b.classList.toggle('speed-toggle-btn--on', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                render();
            });
            toggle.appendChild(btn);
        });

        content.appendChild(toggle);
        content.appendChild(body);
        render();

    } catch (e) {
        console.error('[AppSpeed]', e);
        _cardLoadError(content, 'Couldn\'t load app speed — check your connection.', initPageSpeedCard);
    } finally {
        content.removeAttribute('aria-busy');
    }
}
/** "2026-06" → "June 2026" for the Usage card heading. */
function _usageMonthLabel(/** @type {string} */ ym) {
    const [y, m] = String(ym).split('-').map(Number);
    if (!y || !m) return ym;
    return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

/** Format a relative time string with the exact time appended, e.g. "3h ago · 22 Jun 14:23".
 *  EXPORTED (v18.93) so the Password Reset Requests card in operations-app.js reads identically to the
 *  Error Log rows beside it — a second formatter would have drifted. */
function _relativeTime(/** @type {Date} */ date) {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    const exact = date.toLocaleString('en-GB', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
    });
    let rel;
    if (secs < 60)    rel = `${secs}s ago`;
    else if (secs < 3600)  rel = `${Math.floor(secs / 60)}m ago`;
    else if (secs < 86400) rel = `${Math.floor(secs / 3600)}h ago`;
    else                   rel = `${Math.floor(secs / 86400)}d ago`;
    return `${rel} · ${exact}`;
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

export { initErrorLog, initUsageCard, initPageSpeedCard, _cardLoadError, _relativeTime };
