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
 * Where this account-device's ONE rolling-window count should sit after an open now (v25.00).
 *
 * Each account-device holds a single +1 in the daily buckets, so summing the buckets over the window
 * counts it at most once — once PER DEVICE AND ADDRESS, never a headcount (v19.86): one person on two
 * devices counts twice, and somebody using both addresses appears in both.
 *
 * ── WHY THE COUNT MOVES (v25.00) ─────────────────────────────────────────────────────────────────
 * Until v25.00 the +1 was placed on the day an account-device was first seen and then frozen for 30
 * days (`shouldCountRolling`). The window therefore summed the days accounts were FIRST seen, not the
 * days they were last active, and anyone whose +1 had just aged out while they kept using the app was
 * missed until their next open after day 30 placed a new one. Simulated over a year of habits, that
 * missed about 1 in 30 daily users, 1 in 6 weekly ones and 1 in 5 monthly ones — and it under-read
 * the very figure that decides when the old address can be retired. Now every open on a new day
 * MOVES the +1 to today, so the window holds each account-device once, on its LATEST active day,
 * which is what "active in the last 30 days" says.
 *
 * At most one write per account-device per day: an open on a day already holding the count moves
 * nothing. The device flag keeps its old meaning (when the count was last placed), so a flag written
 * by the old code is read correctly — the day it names is the day its +1 sits on.
 *
 * @param {number} lastCountedMs - epoch ms the count was last placed on this device (NaN/0 if never)
 * @param {Date} now
 * @param {number} [windowDays]
 * @returns {{ add: string, remove: string|null }|null} null when today already holds the count.
 *   `remove` is the day to take it back from — only while that day is INSIDE the window: a day that
 *   has left it no longer counts toward the figure, and may already have been pruned, where a
 *   decrement would recreate the key at -1.
 */
export function rollingMove(lastCountedMs, now, windowDays = ROLLING_WINDOW_DAYS) {
    const add = dayKey(now);
    if (!lastCountedMs || Number.isNaN(lastCountedMs)) return { add, remove: null };
    const last = dayKey(new Date(lastCountedMs));
    if (last === add) return null;
    return { add, remove: recentDayKeys(now, windowDays).includes(last) ? last : null };
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
 *
 * Never below zero (v25.00). A count MOVES by a -1 on its old day and a +1 on today (`rollingMove`),
 * and if the original +1 was ever lost — a write refused or dropped — the -1 lands on a day that never
 * had it. The total then reads one short until that day leaves the window, which is the right
 * direction to fail in; a negative total is not a figure at all.
 * @param {Record<string, any>} daily
 * @param {Date} now
 * @param {number} [days]
 */
export function sumDailyWindow(daily, now, days = ROLLING_WINDOW_DAYS) {
    return Math.max(0, recentDayKeys(now, days).reduce((sum, k) => sum + (Number(daily[k]) || 0), 0));
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
 * `accounts` is an account-DEVICE signal, not a headcount (each account-device holds ONE +1 per
 * address, on its latest active day — `rollingMove` — so summing the days cannot double-count).
 * `installed` is the same rule applied to opens of the INSTALLED app, so it is a subset: an
 * account-device whose only opens in the window were browser tabs is in `accounts` and not in
 * `installed`, which is correct.
 *
 * Each row is clamped (v25.00): never below zero, and `installed` never above `accounts` — a count
 * that moves by -1/+1 can leave a lost write's -1 behind for a while (`sumDailyWindow` says why), and
 * a bar is not drawn from a negative share. A row with nobody left on it is dropped.
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
    return Object.values(out)
        .map(r => {
            const accounts = Math.max(0, r.accounts);
            return { origin: r.origin, accounts, installed: Math.min(accounts, Math.max(0, r.installed)) };
        })
        .filter(r => r.accounts > 0)
        .sort((a, b) => b.accounts - a.accounts || a.origin.localeCompare(b.origin));
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
