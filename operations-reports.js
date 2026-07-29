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
import { SPEED_GROUPS, perfVerdict } from './perf-stats.js';
import { escapeHtml } from './roster-data.js';

/**
 * Emoji + label for each page id — shared by the Usage and App Speed cards (was defined
 * identically inside both). One source so a label change (or a new page) is edited once.
 * @type {Record<string, { emoji: string, label: string }>}
 */
const PAGE_META = {
    calendar:   { emoji: '📅', label: 'Calendar' },
    admin:      { emoji: '📝', label: 'Admin' },
    paycalc:    { emoji: '💷', label: 'Pay calculator' },
    operations: { emoji: '🔧', label: 'Operations' },
    settings:   { emoji: '⚙️', label: 'Settings' },
    links:      { emoji: '🔗', label: 'Links' },
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
    'guide-railcard': { emoji: '🎫', label: 'Railcard Guide' },
    'guide-fip':      { emoji: '🇪🇺', label: 'FIP Travel Guide' },
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

        // Active-account headline numbers. These are the DEVICE-deduped trend: a member using a
        // phone and a laptop counts twice, which is the price of the server never learning who was
        // active. The exact unique count is the separate section below.
        const accounts = document.createElement('div');
        accounts.className = 'usage-stats';
        accounts.innerHTML =
            `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsThisMonth}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">👥</span> accounts this month</span></div>` +
            `<div class="usage-stat"><span class="usage-stat-num">${stats.accountsLast30}</span>` +
            `<span class="usage-stat-lbl"><span aria-hidden="true">📅</span> active in last 30 days</span></div>`;
        content.appendChild(accounts);
        const trendNote = document.createElement('p');
        trendNote.className = 'usage-note';
        trendNote.textContent = 'Counted per account-device, so anyone using two devices counts twice — a trend, not a headcount.';
        content.appendChild(trendNote);

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
                    `<span class="usage-bar-label"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
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
            heading.textContent = `Page popularity — ${_usageMonthLabel(month)}`;
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
                openLbl.textContent = 'Documents & guides — opens';
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

        content.appendChild(popToggle);
        content.appendChild(heading);
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

/** Short labels for the addresses the app is served from. `other` is deliberately vague — it is
 *  localhost and anything not yet named, and naming it precisely would imply we know what it is. */
/** @type {Record<string, {emoji: string, label: string, note: string}>} */
const ORIGIN_META = {
    web:   { emoji: '\u2705', label: 'myb-roster.web.app', note: 'the address staff should end up on' },
    pages: { emoji: '\u{1F4E6}', label: 'GitHub Pages mirror', note: 'the old address' },
    fb:    { emoji: '\u{1F517}', label: 'myb-roster.firebaseapp.com', note: 'the Firebase auth domain' },
    other: { emoji: '\u2753', label: 'somewhere else', note: 'localhost, or an address not yet named' },
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
    const label = document.createElement('p');
    label.className = 'usage-section-label';
    label.innerHTML = '<span aria-hidden="true">\u{1F6A6}</span> Which address staff are on';
    content.appendChild(label);

    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'usage-note';
        empty.textContent = 'Nothing recorded yet — this starts counting from the first page open after v19.23.';
        content.appendChild(empty);
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
        name.className = 'usage-bar-lbl';
        name.textContent = `${meta.emoji} ${meta.label}`;
        name.title = meta.note;
        const track = document.createElement('span');
        track.className = 'usage-bar-track';
        const fill = document.createElement('span');
        fill.className = 'usage-bar-fill';
        fill.style.width = `${Math.max(pct, accounts ? 2 : 0)}%`;
        track.appendChild(fill);
        const num = document.createElement('span');
        num.className = 'usage-bar-num';
        // Installed is deduped separately, so it is a LOWER bound on the same accounts — never a
        // second population. Showing it as "N of M" keeps that relationship visible.
        num.textContent = `${accounts} · ${installed} installed`;
        row.append(name, track, num);
        bars.appendChild(row);
    });
    content.appendChild(bars);

    const note = document.createElement('p');
    note.className = 'usage-note';
    note.textContent = 'Unique accounts over the last 30 days, counted once per address — someone using both '
        + 'counts on each, which is what half-migrated looks like. "Installed" means opened from the home-screen '
        + 'app rather than a browser tab. An install nobody has opened in 30 days is invisible here, and your own '
        + 'admin devices are never counted.';
    content.appendChild(note);
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
        label.textContent = 'Accounts that have signed in';
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
        // State the two caveats rather than let the number be read as "active staff". Sessions last
        // 30 days absolute / 7 idle, so a live session REQUIRES a sign-in inside 30 days — which
        // makes this a slight over-count of active people (it includes anyone who signed in once and
        // stopped). And `neverSignedIn` is the actionable one: provisioned staff who may not know
        // the app exists.
        // "staff accounts", never "active accounts": THIS CARD already uses "active" for the
        // device-deduped activity figure directly above, so reusing the word here would make two
        // different numbers appear to measure the same thing.
        note.textContent =
            `Exact count across ${s.total} staff accounts — one per person, however many devices they use. ` +
            'Counts sign-ins, not opens: a session lasts up to 30 days, so someone can sign in once and use the app daily.';
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

    const TONE_CLASS = { good: 'good', ok: 'ok', bad: 'bad', none: 'none' };
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
    const subhead = (emoji, label) => {
        const p = document.createElement('p');
        p.className = 'speed-subhead';
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
     *  @param {{tone:'good'|'ok'|'bad'|'none', text:string}} verdict
     *  @param {{pctQuick:number}} overall @param {number} total @param {string} unit
     *  @param {string} [windowLabel] - "this month" / "last month", for the sub line */
    const verdictBanner = (verdict, overall, total, unit, windowLabel = 'this month') => {
        const div = document.createElement('div');
        div.className = `speed-verdict speed-verdict--${TONE_CLASS[verdict.tone]}`;
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
    /** Per-page rows showing BOTH milestones — an "appears" bar and a "ready" bar per page — so the
     *  same page's two speeds sit together and one page's "appears" can be scanned against every other.
     *  @param {Array<any>} fcpByPage @param {Array<any>} pagesByPage @param {string} month */
    const dualRows = (fcpByPage, pagesByPage, month) => {
        const frag = document.createDocumentFragment();
        const heading = document.createElement('p');
        heading.className = 'usage-section-label';
        heading.textContent = `By page — ${_usageMonthLabel(month)}`;
        frag.appendChild(heading);

        const fcpMap   = new Map(fcpByPage.map(p => [p.page, p]));
        const pagesMap = new Map(pagesByPage.map(p => [p.page, p]));
        const allPages = [...new Set([...pagesMap.keys(), ...fcpMap.keys()])]
            .sort((a, b) => (pagesMap.get(b)?.total || 0) - (pagesMap.get(a)?.total || 0)
                         || (fcpMap.get(b)?.total   || 0) - (fcpMap.get(a)?.total   || 0)
                         || a.localeCompare(b));

        const rows = document.createElement('div');
        rows.className = 'speed-rows';
        const head = document.createElement('div');
        head.className = 'speed-row speed-row--dual speed-dual-head';
        head.innerHTML = '<span></span><span class="speed-dual-label">Appears</span><span class="speed-dual-label">Ready</span><span></span>';
        rows.appendChild(head);

        allPages.forEach(pg => {
            const meta  = PAGE_META[pg];
            const emoji = meta ? meta.emoji : '📄';
            const label = meta ? meta.label : escapeHtml(pg);
            const f = fcpMap.get(pg);
            const r = pagesMap.get(pg);
            const count = (r?.total) || (f?.total) || 0;
            const row = document.createElement('div');
            row.className = 'speed-row speed-row--dual';
            row.innerHTML =
                `<span class="speed-row-label"><span aria-hidden="true">${emoji}</span> ${label}</span>` +
                `<span class="speed-bar" role="img" aria-label="appears: ${f ? f.pctQuick : 0}% quick">${f ? segs(f) : ''}</span>` +
                `<span class="speed-bar" role="img" aria-label="ready: ${r ? r.pctQuick : 0}% quick">${r ? segs(r) : ''}</span>` +
                `<span class="speed-row-count">${count.toLocaleString('en-GB')}</span>`;
            rows.appendChild(row);
        });
        frag.appendChild(rows);
        return frag;
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

            // Section 1 — Signing in (a distinct journey).
            body.appendChild(subhead('🔑', 'Signing in'));
            body.appendChild(noteLine('Only fresh sign-ins are timed — normally fewer than the accounts on the Usage card, since a saved session opens the app without signing in again.'));
            body.appendChild(verdictBanner(perfVerdict(w.login.overall, 'login'), w.login.overall, w.login.total, 'sign-ins', windowLabel));
            if (w.login.total) body.appendChild(overallBar(w.login.overall));

            if (w.login.total || w.fcp.total || w.pages.total) body.appendChild(legendEl());

            // Section 2 — Opening a page: two milestones in timeline order (appears → ready).
            body.appendChild(subhead('📄', 'Opening pages'));
            body.appendChild(noteLine('Two moments when a page opens — when it first appears on screen, then when it’s fully ready to use.'));
            body.appendChild(subMilestone('✨', 'First appears'));
            body.appendChild(verdictBanner(perfVerdict(w.fcp.overall, 'fcp'), w.fcp.overall, w.fcp.total, 'page opens', windowLabel));
            body.appendChild(subMilestone('✅', 'Fully ready'));
            body.appendChild(verdictBanner(perfVerdict(w.pages.overall, 'pages'), w.pages.overall, w.pages.total, 'page opens', windowLabel));

            if (w.fcp.total || w.pages.total) body.appendChild(dualRows(w.fcp.byPage, w.pages.byPage, w.month));

            const note = document.createElement('p');
            note.className = 'usage-note';
            note.textContent = 'Speeds are how long the app took to respond. Your own (admin) loads are excluded. Anonymous — we never record who.';
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
