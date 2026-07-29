// @ts-check
/**
 * usage-stats.js — pure date-bucketing + aggregation for anonymous usage analytics.
 *
 * No DOM, no Firebase: the "humble object" core shared by the usage helpers in
 * firebase-client.js (recordPageView / recordActiveAccount / getUsageStats) and the
 * client-side dedup decisions in usage-reporter.js. Split out so the policy (which
 * day buckets count toward the rolling window, when an account should be re-counted,
 * how page counts order, which daily keys are stale) is unit-testable without the
 * Firestore SDK. Tested by usage-stats.test.mjs.
 *
 * Privacy note: every metric here is an anonymous integer count. Uniqueness of
 * "active accounts" is deduped on the client (see usage-reporter.js) so the server
 * never stores who was active — only how many. There is no member identity in any
 * value this module touches.
 */

/** Rolling window (days) for the "active accounts in the last N days" metric. */
export const ROLLING_WINDOW_DAYS = 30;
/** Daily counter buckets older than this are pruned (a few days of slack over the window). */
export const DAILY_RETENTION_DAYS = 35;

/** "YYYY-MM" for a Date (local time). @param {Date} d */
export function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * "YYYY-MM" for the calendar month BEFORE the given date — the comparison window for the
 * Operations cards ("this month" vs "last month"). Crosses the year boundary correctly
 * (Jan → previous Dec) because `new Date(y, -1, 1)` rolls the year back.
 * @param {Date} d
 */
export function prevMonthKey(d) {
    return monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

/** "YYYY-MM-DD" for a Date (local time). @param {Date} d */
export function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Should this account be counted toward the current calendar month yet?
 * @param {string|null} lastCountedMonth - the "YYYY-MM" last recorded for this account on this device
 * @param {Date} now
 */
export function shouldCountMonth(lastCountedMonth, now) {
    return lastCountedMonth !== monthKey(now);
}

/**
 * Should this account be counted toward the rolling window again? Each account
 * self-suppresses for the whole window, so summing the per-day buckets over the
 * window yields a true unique count with each account counted at most once.
 * @param {number} lastCountedMs - epoch ms last recorded for this account on this device (NaN/0 if never)
 * @param {Date} now
 * @param {number} [windowDays]
 */
export function shouldCountRolling(lastCountedMs, now, windowDays = ROLLING_WINDOW_DAYS) {
    if (!lastCountedMs || Number.isNaN(lastCountedMs)) return true;
    return (now.getTime() - lastCountedMs) > windowDays * 86400000;
}

/**
 * The day-keys covering the last `days` days, ending today (inclusive), newest first.
 * @param {Date} now
 * @param {number} [days]
 * @returns {string[]}
 */
export function recentDayKeys(now, days = ROLLING_WINDOW_DAYS) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);
        out.push(dayKey(d));
    }
    return out;
}

/**
 * Sum of the daily counters over the rolling window — the "active accounts in the
 * last N days" figure.
 * @param {Record<string, any>} daily
 * @param {Date} now
 * @param {number} [days]
 */
export function sumDailyWindow(daily, now, days = ROLLING_WINDOW_DAYS) {
    return recentDayKeys(now, days).reduce((sum, k) => sum + (Number(daily[k]) || 0), 0);
}

/**
 * Page-view counts → [{ page, count }] sorted by count desc, then page name asc
 * (stable ordering so equal counts don't reshuffle between reads).
 * @param {Record<string, any>} counts
 * @returns {Array<{page: string, count: number}>}
 */
export function orderPageCounts(counts) {
    return Object.entries(counts || {})
        .map(([page, count]) => ({ page, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count || a.page.localeCompare(b.page));
}

/**
 * Daily counter keys outside the retention window — safe to prune.
 * @param {Record<string, any>} daily
 * @param {Date} now
 * @param {number} [keepDays]
 * @returns {string[]}
 */
export function staleDailyKeys(daily, now, keepDays = DAILY_RETENTION_DAYS) {
    const keep = new Set(recentDayKeys(now, keepDays));
    return Object.keys(daily || {}).filter(k => !keep.has(k));
}

// ── ORIGIN / MIGRATION TRACKING (v19.23) ──────────────────────────────────────
// The app is served from TWO addresses during the move off the GitHub Pages mirror, and nothing
// recorded which one a member was actually using. These helpers key the anonymous per-origin
// counters in `analytics/origins`.

/**
 * The address a hostname belongs to, as a short STABLE LABEL — never the raw hostname.
 *
 * Three reasons it is a label: a `.` in a Firestore map key is a field-path hazard (it nests the
 * value wrongly — the same trap `perfSampleKey` sanitises for); the key space stays bounded and
 * therefore readable; and the label survives a domain change, so a future custom domain is one line
 * here rather than a broken chart.
 *
 * @param {string} hostname `location.hostname`
 * @returns {'web'|'pages'|'fb'|'other'}
 */
export function originLabel(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (h === 'myb-roster.web.app')          return 'web';
    if (h === 'garethdavidmiller.github.io') return 'pages';
    if (h === 'myb-roster.firebaseapp.com')  return 'fb';
    return 'other';
}

/**
 * Key for the "an account used this address today" counter, and — with `pwa` — the "…from the
 * INSTALLED app" counter. Two counters rather than one keyed by mode, because they are deduped
 * INDEPENDENTLY: someone whose first open in the window was a browser tab must still be counted as
 * installed when they later open the installed app.
 * @param {string} day `dayKey(now)`
 * @param {string} origin an `originLabel` value
 * @param {boolean} [installed] true for the installed-app counter
 */
export function originKey(day, origin, installed = false) {
    return `${day}|${origin}${installed ? '|pwa' : ''}`;
}

/**
 * Split an origin key back into its parts. Returns null for anything unparseable, so a stray key
 * can never be counted as a date.
 * @param {string} key
 * @returns {{ day: string, origin: string, installed: boolean }|null}
 */
export function parseOriginKey(key) {
    const parts = String(key).split('|');
    if (parts.length < 2 || parts.length > 3) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) return null;
    if (parts.length === 3 && parts[2] !== 'pwa') return null;
    return { day: parts[0], origin: parts[1], installed: parts.length === 3 };
}

/**
 * Roll the per-day origin counters up into the migration picture for the rolling window.
 *
 * `accounts` is a true unique count (each account self-suppresses for the window, so summing the
 * days cannot double-count). `installed` is deduped separately and is therefore a subset — but a
 * LOWER BOUND, not an exact one: an account whose only opens in the window were browser tabs is
 * counted in `accounts` and not in `installed`, which is correct, while one that installed midway
 * through the window is picked up from that point.
 *
 * @param {Record<string, any>} daily the `analytics/origins` daily map
 * @param {Date} now
 * @param {number} [days]
 * @returns {Array<{ origin: string, accounts: number, installed: number }>} busiest first
 */
export function summariseOrigins(daily, now, days = ROLLING_WINDOW_DAYS) {
    const win = new Set(recentDayKeys(now, days));
    /** @type {Record<string, { origin: string, accounts: number, installed: number }>} */
    const out = {};
    for (const [key, value] of Object.entries(daily || {})) {
        const p = parseOriginKey(key);
        if (!p || !win.has(p.day)) continue;
        const row = out[p.origin] || (out[p.origin] = { origin: p.origin, accounts: 0, installed: 0 });
        row[p.installed ? 'installed' : 'accounts'] += Number(value) || 0;
    }
    return Object.values(out).sort((a, b) => b.accounts - a.accounts || a.origin.localeCompare(b.origin));
}

/**
 * Origin keys outside the retention window — pruned by the Operations card, exactly as the
 * activeAccounts daily buckets are. Keys that do not parse are ALSO returned: they are junk that
 * `summariseOrigins` would ignore for ever, so sweeping them keeps the doc from growing without
 * bound if a future writer ever malforms a key.
 * @param {Record<string, any>} daily
 * @param {Date} now
 * @param {number} [keepDays]
 */
export function staleOriginKeys(daily, now, keepDays = DAILY_RETENTION_DAYS) {
    const keep = new Set(recentDayKeys(now, keepDays));
    return Object.keys(daily || {}).filter(k => {
        const p = parseOriginKey(k);
        return !p || !keep.has(p.day);
    });
}
