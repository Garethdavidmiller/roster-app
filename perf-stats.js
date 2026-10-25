// @ts-check
/**
 * perf-stats.js — PURE latency maths for the performance-instrumentation pipeline (Project 0).
 * No DOM, no Firebase, no timing reads: just bucketing + the Firestore sample-key shape. The pure
 * analogue of usage-stats.js. Tested by perf-stats.test.mjs (part of test:hygiene).
 *
 * The reporter (perf-reporter.js) reads navigation timing and calls firebase-client.recordPerfSample,
 * which increments an anonymous monthly counter `analytics/perf_<YYYY-MM>.samples[<key>]`. NO member
 * identity is ever part of a key — only coarse, non-identifying dimensions: app version, page, metric,
 * a duration BUCKET (never a raw millisecond value), PWA display mode, and connection class.
 */

/** Coarse latency buckets (ids are Firestore-map-key-safe: no `.`, `|`, `<`). Ordered fast→slow. */
export const PERF_BUCKETS = ['lt500ms', '500ms-1s', '1-3s', '3-8s', 'over8s'];

/**
 * Bucket a duration in milliseconds into one of PERF_BUCKETS. Returns null for a non-finite or
 * negative value (e.g. a timing field the browser never populated) so the caller skips it.
 * @param {number} ms
 * @returns {string|null}
 */
export function bucketDuration(ms) {
    // <= 0 (not < 0): an UNPOPULATED PerformanceNavigationTiming field reads 0, not negative —
    // bucketing it as lt500ms recorded a fake "Quick" sample. A genuine 0ms duration is not a
    // real page-load measurement, so dropping 0 loses nothing (v16.23).
    if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return null;
    if (ms < 500)  return 'lt500ms';
    if (ms < 1000) return '500ms-1s';
    if (ms < 3000) return '1-3s';
    if (ms < 8000) return '3-8s';
    return 'over8s';
}

/**
 * Build the flat Firestore sample key from its dimensions, pipe-separated. The app version contains
 * dots (`14.89`) and a `.` is HAZARDOUS in a Firestore map key (it can be interpreted as a field
 * path, nesting the value wrongly), so dots in the version are swapped for `_` → `14_89`. Every other
 * component is a dot-free, `|`-free fixed token (page/metric id, a PERF_BUCKETS id, mode, conn class),
 * so the key is a safe map key and round-trips with parsePerfSampleKey.
 * @param {{ version: string, page: string, metric: string, bucket: string, mode: string, conn: string }} d
 * @returns {string}
 */
export function perfSampleKey({ version, page, metric, bucket, mode, conn }) {
    // Sanitise EVERY component: a `.` is a Firestore field-path hazard in a map key (it nests the
    // value wrongly) and a `|` would break parsePerfSampleKey. Only the version has a dot today and
    // the rest are fixed tokens — but `conn` comes from navigator.connection.effectiveType, so harden
    // defensively in case a non-conforming browser ever returns an unexpected string.
    const safe = (/** @type {any} */ x) => String(x).replace(/[.|]/g, '_');
    return [version, page, metric, bucket, mode, conn].map(safe).join('|');
}

/**
 * Inverse of perfSampleKey — split a stored key back into its dimensions (for the future Operations
 * latency card; keeps the read side pure + tested alongside the write side).
 * @param {string} key
 * @returns {{ version: string, page: string, metric: string, bucket: string, mode: string, conn: string }}
 */
export function parsePerfSampleKey(key) {
    const [version, page, metric, bucket, mode, conn] = String(key).split('|');
    return { version, page, metric, bucket, mode, conn };
}

// ── Plain-language summary for the Operations "App speed" card ──────────────────
// The fine PERF_BUCKETS roll up into THREE non-technical speed bands. A non-technical admin reads
// "Quick / A moment / Slow", never milliseconds. Order matters: good → bad (drives bar/legend order).
/** @typedef {{ label: string, sub: string, tone: 'good'|'ok'|'bad', buckets: string[] }} SpeedGroup */
/** @type {Record<'quick'|'ok'|'slow', SpeedGroup>} */
export const SPEED_GROUPS = {
    quick: { label: 'Quick',    sub: 'under 1 second', tone: 'good', buckets: ['lt500ms', '500ms-1s'] },
    ok:    { label: 'A moment', sub: '1 to 3 seconds', tone: 'ok',   buckets: ['1-3s'] },
    slow:  { label: 'Slow',     sub: 'over 3 seconds', tone: 'bad',  buckets: ['3-8s', 'over8s'] },
};

/** bucket id → speed group id ('quick'|'ok'|'slow'). */
const _BUCKET_GROUP = (() => {
    /** @type {Record<string, 'quick'|'ok'|'slow'>} */ const m = {};
    for (const g of /** @type {Array<'quick'|'ok'|'slow'>} */ (Object.keys(SPEED_GROUPS))) {
        for (const b of SPEED_GROUPS[g].buckets) m[b] = g;
    }
    return m;
})();

/**
 * Add the total and three whole percentages that ALWAYS SUM TO 100 (App Speed review, Oct 2026).
 * Rounding each band on its own printed 34 + 34 + 33 = 101 for an even split, on the one line that
 * states all three. Largest remainder instead: floor every band, then hand the points left over to
 * the bands that lost most to the floor (ties to the faster band, so the order is stable).
 * @param {{quick:number, ok:number, slow:number}} g */
function _withPct(g) {
    const total = g.quick + g.ok + g.slow;
    const pcts = [0, 0, 0];
    if (total) {
        const exact = [g.quick, g.ok, g.slow].map(n => (n / total) * 100);
        exact.forEach((x, i) => { pcts[i] = Math.floor(x); });
        const left = 100 - pcts[0] - pcts[1] - pcts[2];
        const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
        for (let k = 0; k < left; k++) pcts[order[k][1]] += 1;
    }
    return { quick: g.quick, ok: g.ok, slow: g.slow, total, pctQuick: pcts[0], pctOk: pcts[1], pctSlow: pcts[2] };
}

/** What a written page id looks like — see `summarisePerf`. */
const PAGE_ID_TOKEN = /^[a-z][a-z0-9-]{0,39}$/;

/** No real month holds more opens than this under ONE key (one version, page, timing, band, mode and
 *  connection) at one depot — the busiest key measured is a few thousand. */
const PERF_COUNT_MAX = 1_000_000;

/**
 * A stored count, or 0 for anything a real counter could not hold. The sample VALUES are written by
 * any signed-in session and the rules cannot check them (firestore.rules → perf_), and `Number()`
 * read `true` as 1, `"7"` as 7 and 1e308 as a count — two of the last summed to Infinity and the card
 * printed "∞ page opens" (App Speed review, Oct 2026). A counter only ever holds a whole number.
 * @param {unknown} raw @returns {number}
 */
function _count(raw) {
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= PERF_COUNT_MAX ? raw : 0;
}

/**
 * Roll the raw `analytics/perf_<month>.samples` map up into the three speed bands — overall and
 * per page — for ONE metric (default 'domReady', i.e. how fast the page opened). PURE; no identity
 * is involved (the keys never carry one). Malformed/zero counts are skipped.
 * @param {Record<string, number>} samples
 * @param {{ metric?: string }} [opts]
 * @returns {{ total: number, overall: ReturnType<typeof _withPct>, byPage: Array<{ page: string } & ReturnType<typeof _withPct>> }}
 */
export function summarisePerf(samples, { metric = 'domReady' } = {}) {
    const overall = { quick: 0, ok: 0, slow: 0 };
    /** @type {Record<string, {quick:number, ok:number, slow:number}>} */
    const pages = {};
    let total = 0;
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = _count(raw);
        if (!n) continue;
        const { page, metric: mtr, bucket } = parsePerfSampleKey(key);
        if (mtr !== metric) continue;
        const group = _BUCKET_GROUP[bucket];
        // A page id is a fixed lower-case token ('calendar', 'guide-staff'). Sample keys are writable
        // by any signed-in session, and the busiest page's id is RENDERED on the admin's card — so
        // anything else is nobody's page and is dropped here, before it can reach the DOM.
        if (!group || !PAGE_ID_TOKEN.test(page || '')) continue;
        overall[group] += n;
        (pages[page] || (pages[page] = { quick: 0, ok: 0, slow: 0 }))[group] += n;
        total += n;
    }
    const byPage = Object.keys(pages)
        .map(p => ({ page: p, ..._withPct(pages[p]) }))
        .sort((a, b) => b.total - a.total || a.page.localeCompare(b.page));
    return { total, overall: _withPct(overall), byPage };
}

// ── WHY a page is slow, not just THAT it is ─────────────────────────────────────────────────────
//
// Every sample already carries three dimensions beyond page/metric/bucket — app VERSION, PWA MODE
// (installed app vs browser tab) and CONNECTION class — because `perfSampleKey` has written them
// since Project 0 shipped. `summarisePerf` destructured `{ page, metric, bucket }` and dropped the
// rest on the floor, so the card could say the Calendar was slower than every other page and had
// nothing whatever to say about why.
//
// That gap mattered because the candidate fixes are wildly different in cost — vendoring the
// Firebase SDK off the cold path is a large change that bumps into the no-bundler rule, trimming
// network before first paint is a targeted one, and a version regression is a bisect — and the
// only thing that distinguishes them is a breakdown of samples that were ALREADY BEING COLLECTED.
//
// Read-side only. Nothing new is recorded, so this adds no privacy surface: the dimensions are
// coarse, non-identifying, and were chosen for exactly this at the time.

/** The dimensions a breakdown can group by, and how each renders for a non-technical reader. */
export const PERF_DIMENSIONS = {
    conn: {
        label: 'By connection',
        /** `navigator.connection.effectiveType`. It reports how the network BEHAVES, not the radio
         *  in use — a 4G phone in a basement reports `3g` — so the labels say "-like" rather than
         *  naming a technology the number does not actually claim. */
        labels: {
            '4g': '4G-like', '3g': '3G-like', '2g': '2G-like', 'slow-2g': 'Very slow',
            unknown: 'Not reported',
        },
        /** Fast → slow, so the rows read like the bars do. Unknown last: it is not a speed. */
        order: ['4g', '3g', '2g', 'slow-2g', 'unknown'],
    },
    mode: {
        label: 'By how it was opened',
        labels: { standalone: 'Installed app', browser: 'Browser tab' },
        order: ['standalone', 'browser'],
    },
    version: {
        label: 'By app version',
        labels: {},
        order: null,   // newest first, computed — versions are not a fixed set
    },
};

/**
 * Break ONE page's samples down by one dimension.
 *
 * The counterpart to `summarisePerf`'s `byPage`: that answers "which page is slow", this answers
 * "slow for whom". Same three speed bands, same shape per row, so the card renders both with one
 * bar builder.
 *
 * **Rows carry their own `total` and the card must show it.** A dimension value with four samples
 * can read 100% slow and mean nothing, and a breakdown that displayed only percentages would
 * present that with exactly the confidence of a real finding.
 *
 * @param {Record<string, number>} samples raw `analytics/perf_<month>.samples`
 * @param {{ page: string, metric?: string, dimension?: 'conn'|'mode'|'version', minSamples?: number, splitAt?: string }} opts
 *   `minSamples` and `splitAt` only affect `version` — see `_bucketVersions`.
 * @returns {{ total: number, rows: Array<{ value: string, label: string, afterSplit?: boolean } & ReturnType<typeof _withPct>> }}
 */
export function summarisePerfBy(samples, { page, metric = 'domReady', dimension = 'conn', minSamples = 0, splitAt = '' }) {
    const dim = PERF_DIMENSIONS[dimension];
    /** @type {Record<string, {quick:number, ok:number, slow:number}>} */
    const groups = {};
    let total = 0;
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = _count(raw);
        if (!n) continue;
        const parsed = parsePerfSampleKey(key);
        if (parsed.page !== page || parsed.metric !== metric) continue;
        const group = _BUCKET_GROUP[parsed.bucket];
        if (!group) continue;
        // A key written by an older/odd client may be missing a component entirely. Bucket those as
        // 'unknown' rather than dropping them: a silently shrinking total would make the breakdown
        // disagree with the per-page count above it, and the reader would have no way to tell.
        const value = /** @type {any} */ (parsed)[dimension] || 'unknown';
        (groups[value] || (groups[value] = { quick: 0, ok: 0, slow: 0 }))[group] += n;
        total += n;
    }
    // Versions get ROLLED UP rather than listed. See `_bucketVersions`.
    if (dimension === 'version') return { total, rows: _bucketVersions(groups, minSamples, splitAt) };

    const keys = Object.keys(groups);
    const order = /** @type {string[]|null} */ (dim.order);
    const ordered = order
        // Declared order first (fast→slow), then anything unrecognised, so a new effectiveType
        // value appears rather than vanishing.
        ? [...order.filter(k => keys.includes(k)), ...keys.filter(k => !order.includes(k)).sort()]
        : keys.sort(_compareVersionsDesc);
    return {
        total,
        rows: ordered.map(v => ({
            value: v,
            label: /** @type {Record<string,string>} */ (dim.labels)[v] || _versionLabel(v, dimension),
            ..._withPct(groups[v]),
        })),
    };
}

/**
 * Roll the version dimension into buckets big enough to mean something.
 *
 * **Listing versions individually does not work here, and shipping it that way proved it.** The
 * version bumps by 0.01 on every change, so a month spans ~30 releases and 480 samples spread
 * across them gives rows of 1–9 loads each — every one flagged "(few)", none comparable to any
 * other, and the dimension that was supposed to answer "did a release make this worse" answering
 * nothing at all while occupying more screen than the other two dimensions combined.
 *
 * So: walk newest→oldest, accumulating into a bucket, and close it once it holds enough samples to
 * be worth reading. That yields a handful of contiguous ranges — `v20.10–v20.19` — which is the
 * shape the question actually has ("recent releases vs before"), since nobody cares whether it was
 * v20.14 or v20.15 specifically. Newest-first accumulation matters: the current release must not be
 * diluted by being averaged into a bucket with old ones, because it is the one being judged.
 *
 * The oldest remainder is MERGED into the previous bucket rather than emitted as a thin row — a
 * trailing "(few)" row is exactly what this exists to remove. Unless it is the only bucket, in
 * which case it is shown as-is: a month with barely any data should look like one.
 *
 * NO ROW CROSSES `splitAt` (App Speed review, Oct 2026). From that version the timings are taken a
 * different way (CLEAN_TIMINGS_FROM), and a row holding versions from both sides would average two
 * measurements into a figure that is neither. So a bucket closes at the split even when thin, and
 * the remainder is never merged across it; each row then says which side it is on (`afterSplit`).
 *
 * @param {Record<string, {quick:number, ok:number, slow:number}>} groups
 * @param {number} minSamples
 * @param {string} [splitAt] a version; '' for none
 */
function _bucketVersions(groups, minSamples, splitAt = '') {
    const versions = Object.keys(groups).sort(_compareVersionsDesc);
    const floor = splitAt ? _versionNum(splitAt) : 0;
    const after = (/** @type {string} */ ver) => floor > 0 && _versionNum(ver) >= floor;
    /** @type {Array<{ newest: string, oldest: string, quick: number, ok: number, slow: number }>} */
    const buckets = [];
    /** @type {{ newest: string, oldest: string, quick: number, ok: number, slow: number }|null} */
    let cur = null;
    for (const v of versions) {
        if (cur && after(v) !== after(cur.newest)) { buckets.push(cur); cur = null; }
        if (!cur) cur = { newest: v, oldest: v, quick: 0, ok: 0, slow: 0 };
        cur.oldest = v;
        cur.quick += groups[v].quick; cur.ok += groups[v].ok; cur.slow += groups[v].slow;
        if (cur.quick + cur.ok + cur.slow >= minSamples) { buckets.push(cur); cur = null; }
    }
    if (cur) {
        const last = buckets[buckets.length - 1];
        if (last && after(last.newest) === after(cur.newest)) {
            last.oldest = cur.oldest;
            last.quick += cur.quick; last.ok += cur.ok; last.slow += cur.slow;
        } else {
            buckets.push(cur);
        }
    }
    return buckets.map(b => ({
        value: b.newest,
        label: b.newest === b.oldest ? _versionText(b.newest) : `${_versionText(b.oldest)}–${_versionText(b.newest)}`,
        ...(floor > 0 ? { afterSplit: after(b.newest) } : {}),
        ..._withPct(b),
    }));
}

/** A stored version as the card prints it: `20_18` → `v20.18`. Versions are stored dot-swapped because
 *  a `.` is a Firestore field-path hazard; a leading `v` is dropped first, because a key any session
 *  can write may carry one and the card printed "vv24.98" for it (App Speed review, Oct 2026).
 *  @param {string} value */
function _versionText(value) {
    return 'v' + String(value).replace(/^v/i, '').replace(/_/g, '.');
}

/** @param {string} value @param {string} dimension */
function _versionLabel(value, dimension) {
    return dimension === 'version' ? _versionText(value) : String(value);
}

/** Newest version first. Numeric per segment, so `20_9` sorts below `20_18` (string sort does not).
 *  @param {string} a @param {string} b */
function _compareVersionsDesc(a, b) {
    const parts = (/** @type {string} */ v) => String(v).split('_').map(Number);
    const [aMaj = 0, aMin = 0] = parts(a);
    const [bMaj = 0, bMin = 0] = parts(b);
    return (bMaj - aMaj) || (bMin - aMin) || String(b).localeCompare(String(a));
}

/**
 * WHAT A MEMBER SEES BEFORE THE SIGN-IN CHECK (v24.85) — the moment their shifts first appear.
 *
 * Since v24.59 the Calendar paints a signed-in member's own roster from the copy kept on their phone
 * (calendar-snapshot.js) before the check answers, and nothing timed it: "Usable" times the grid
 * AFTER that check, so it reported the wait for the confirmed roster as though it were the wait to
 * see one, and the card could not say whether the stored copy was doing its job. It is reported only
 * when the copy was painted — the member's own calendar, signed in, a copy under 14 days old; Team
 * View, the station PIN and a first visit have none — so its count is also how often the copy got
 * the chance. One of the four readings the App Speed card kept when it was trimmed (Oct 2026): the
 * copy is new, and this is its only instrument.
 */
export const EARLY_ROSTER = /** @type {const} */ ([
    { metric: 'rosterSnapshot', label: 'Own roster', sub: 'from opening the Calendar until the stored copy was on screen' },
]);

/** @param {Record<string, number>} samples @param {{page: string}} opts */
export function summariseEarlyRoster(samples, { page }) {
    return _summariseMetricRows(samples, page, EARLY_ROSTER);
}

/** The first app version that reports `rosterSnapshot`. Opens on an older version cannot. */
export const EARLY_ROSTER_FROM = '24.85';

/** A stored version as one comparable number: '24_85', 'v24.85' and '24.85' all read 2485; an
 *  unreadable one reads 0, below every release. @param {string|undefined} v */
function _versionNum(v) {
    const m = /^v?(\d+)[._](\d+)/i.exec(String(v ?? ''));
    return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

/** The samples written by app versions at or after `from`.
 *  @param {Record<string, number>} samples @param {string} from @returns {Record<string, number>} */
function _fromVersion(samples, from) {
    const floor = _versionNum(from);
    return Object.fromEntries(Object.entries(samples || {}).filter(([k]) => _versionNum(parsePerfSampleKey(k).version) >= floor));
}

/** How many valid samples one page holds for one metric. @param {Record<string, number>} samples
 *  @param {string} page @param {string} metric */
function _metricTotal(samples, page, metric) {
    let n = 0;
    for (const [key, raw] of Object.entries(samples || {})) {
        const c = _count(raw);
        if (!c) continue;
        const p = parsePerfSampleKey(key);
        if (p.page === page && p.metric === metric && _BUCKET_GROUP[p.bucket]) n += c;
    }
    return n;
}

/**
 * A share in words: "under 1%" for one that is real but rounds to nothing (it printed "0%" beside a
 * row of 1 open), "over 99%" for one that rounds up to a whole it is not, otherwise the whole percent.
 * Null with nothing to divide, or a part LARGER than its whole — judged on the raw counts, because the
 * old check ran on the rounded figure and let 251 of 250 through as "100%".
 * @param {number} part @param {number} whole @returns {string|null}
 */
export function shareLabel(part, whole) {
    if (!(part > 0) || !(whole > 0) || part > whole) return null;
    const pct = (part / whole) * 100;
    if (pct < 1) return 'under 1%';
    if (pct > 99 && part < whole) return 'over 99%';
    return `${Math.round(pct)}%`;
}

/**
 * A band's whole percentage as a narrow column prints it — `shareLabel`'s rule in three characters.
 * The rounded figure alone lies at both ends: 1 open in 400 rounds to "0%", which reads as none at
 * all, and 399 in 400 to "100%", which reads as every one (App Speed review, Oct 2026).
 * @param {number} pct the rounded percentage @param {number} count the opens in the band
 * @param {number} total @returns {string}
 */
export function compactPct(pct, count, total) {
    if (count > 0 && pct === 0) return '<1%';
    if (count < total && pct === 100) return '>99%';
    return `${pct}%`;
}

/**
 * How often a member was shown the stored copy, in words: `rosterSnapshot` over `ready`, BOTH counted
 * only on versions at or after EARLY_ROSTER_FROM, and only once there are enough opens to make a
 * claim (THIN_SAMPLE — the share said "33%" over 3 opens until v24.96). Every version's `ready` was
 * the divisor until v24.89, so the month the metric shipped printed 19% for a true 60%.
 * @param {Record<string, number>} samples @param {{ page: string }} opts @returns {string|null}
 */
export function earlyRosterShareLabel(samples, { page }) {
    const counted = _fromVersion(samples, EARLY_ROSTER_FROM);
    const ready = _metricTotal(counted, page, 'ready');
    if (ready < THIN_SAMPLE) return null;
    return shareLabel(_metricTotal(counted, page, 'rosterSnapshot'), ready);
}

/**
 * AFTER A RELEASE — how long a person waited for a page an update had just reloaded (v22.92; timed
 * as the WAIT since Oct 2026).
 *
 * The Calendar reloads onto an update while nobody is looking (sw-register.js, `deferWhileVisible`),
 * so the load itself kept nobody waiting and its full time was a background figure. From
 * UPDATE_OPENS_FROM such a reload is timed as the wait the member actually had — from coming back to
 * the page until it was usable. A release reload somebody watched from its start (a page that asked
 * first, or reloaded while idle in view) is timed from the start, as any open is, so it is counted in
 * "Usable" too. Older versions timed the background load itself, so the block reads only from this
 * version on: two different measurements in one bar would be neither.
 *
 * No share of all opens any more: a background reload is not in `ready` (nobody was watching it),
 * so the two counts are different populations and their ratio would mean nothing.
 */
export const UPDATE_OPENS = /** @type {const} */ ([
    { metric: 'readyUpdate', label: 'Until usable', sub: 'from coming back to the page, or from the reload if somebody watched it' },
]);

/** The first app version that times `readyUpdate` as the wait. MUST be the release that ships the
 *  recorder change (perf-reporter.js); an earlier figure would mix two measurements. */
export const UPDATE_OPENS_FROM = '24.98';

/** @param {Record<string, number>} samples @param {{page: string}} opts */
export function summariseUpdateOpens(samples, { page }) {
    return _summariseMetricRows(_fromVersion(samples, UPDATE_OPENS_FROM), page, UPDATE_OPENS);
}

/**
 * THE MONTH THE MEASUREMENT CHANGED (Oct 2026). From CLEAN_TIMINGS_FROM a load nobody watched, and
 * time somebody spent typing, are left out of every page timing (perf-reporter.js); older versions
 * counted both. A month holding enough opens from older versions mixes the two, and the card says
 * so rather than presenting the improvement as the app getting faster.
 */
export const CLEAN_TIMINGS_FROM = '24.98';

/**
 * The share of a month's code-loaded opens (`domReady` — recorded on every watched open, on every
 * page) written by versions BEFORE `from`. 0 when there is nothing to divide.
 * @param {Record<string, number>} samples @param {string} [from] @returns {number}
 */
export function shareMeasuredBefore(samples, from = CLEAN_TIMINGS_FROM) {
    const floor = _versionNum(from);
    let before = 0, all = 0;
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = _count(raw);
        if (!n) continue;
        const p = parsePerfSampleKey(key);
        if (p.metric !== 'domReady' || !_BUCKET_GROUP[p.bucket]) continue;
        all += n;
        if (_versionNum(p.version) < floor) before += n;
    }
    return all ? before / all : 0;
}

/** Firestore refuses a document over 1 MiB, or with more than 20,000 fields — every entry of a map
 *  is a field. */
const PERF_RECORD_LIMIT_BYTES = 1024 * 1024;
const PERF_RECORD_LIMIT_FIELDS = 20000;

/**
 * How full the month's record is, as a fraction of whichever Firestore limit is nearer (1 = full).
 *
 * Every release adds keys, because the version is part of each one — September shipped about a
 * hundred versions — and once the record is full the merged write that adds to it is refused, the
 * app swallows the error as it must, and the card simply stops changing for the rest of the month.
 * Nothing else would show that, so the card states the figure (App Speed review, Oct 2026).
 *
 * Bytes by Firestore's own sizing rules: a field name is its UTF-8 length plus one, a count is 8
 * bytes, and the document's name, its `month` field and the `samples` map itself come to under 128.
 * Unindexing the counters (firestore.indexes.json) lifted the 40,000-index-entry ceiling, which was
 * the nearest; these two are what is left.
 * @param {Record<string, number>} samples @returns {number}
 */
export function perfRecordFullness(samples) {
    const keys = Object.keys(samples || {});
    const encoder = new TextEncoder();
    let bytes = 128;
    for (const key of keys) bytes += encoder.encode(key).length + 1 + 8;
    // +2 fields: `month`, and the `samples` map itself.
    return Math.max(bytes / PERF_RECORD_LIMIT_BYTES, (keys.length + 2) / PERF_RECORD_LIMIT_FIELDS);
}

/**
 * The shared body of the closer-look rows. One function, not one per block: the bucket banding, the
 * thin-sample total and the deliberately-inverted `pctOver1s` are one reading, and two copies of them
 * is how a card comes to state the same figure two ways.
 * @param {Record<string, number>} samples @param {string} page
 * @param {ReadonlyArray<{metric: string, label: string, sub: string}>} wanted
 */
function _summariseMetricRows(samples, page, wanted) {
    /** @type {Record<string, Record<string, number>>} */
    const perMilestone = {};
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = _count(raw);
        if (!n) continue;
        const parsed = parsePerfSampleKey(key);
        if (parsed.page !== page) continue;
        if (!wanted.some(m => m.metric === parsed.metric)) continue;
        (perMilestone[parsed.metric] || (perMilestone[parsed.metric] = {}))[parsed.bucket] =
            (perMilestone[parsed.metric]?.[parsed.bucket] || 0) + n;
    }
    const rows = [];
    let grand = 0;
    for (const milestone of wanted) {
        const buckets = perMilestone[milestone.metric];
        if (!buckets) continue;
        const g = { quick: 0, ok: 0, slow: 0 };
        for (const [bucket, n] of Object.entries(buckets)) {
            const band = _BUCKET_GROUP[bucket];
            if (band) g[band] += n;
        }
        const p = _withPct(g);
        if (!p.total) continue;
        rows.push({
            metric: milestone.metric, label: milestone.label, sub: milestone.sub,
            // The share OVER a second — the complement of pctQuick, and deliberately that way round:
            // every column in the section states a bad-when-high number. Derived from the DISPLAYED
            // pctQuick, as the breakdown rows do, so the same split never reads 87% in one block and
            // 88% in another (it was rounded separately until Oct 2026). `over1s` is the count behind
            // it, which is what tells a real "under 1%" from a true zero.
            pctOver1s: 100 - p.pctQuick,
            over1s: p.ok + p.slow,
            ...p,
        });
        grand = Math.max(grand, p.total);
    }
    return { total: grand, rows };
}

/**
 * Plain-English verdict copy per journey:
 *   'login' = signing in · 'fcp' = a page first appearing on screen · 'pages' = the page's CODE
 *   finishing (DOMContentLoaded) · 'ready' = the page's own content actually on screen.
 *
 * `ok` is a wide band — under a fifth slow and not green — so it carries several sentences, chosen by
 * which band is larger and whether quick is a majority (`perfVerdict`; v24.85, v24.96, Oct 2026). With
 * one, a month of 8% quick, 79% "a moment" and 13% slow read "Signing in mostly feels quick" directly
 * beside its own 8%. `mixed` is quick as the largest band without being half; `moment` is worded "most
 * often" because the larger band can be anything above 40%; `momentSlow` adds the tail only when
 * something actually was slow, so a sentence never mentions slower loads there were none of.
 *
 * `none` and `thin` name no month (Oct 2026): the headline renders in the Last-month view too, where
 * "not enough data yet — this builds up as staff use the app" described a month that was over.
 *
 * `pages` and `ready` used to be the same claim and are not (v20.80). DCL fires when the module
 * scripts finish; the Calendar's access decision is asynchronous, so it can land while the page is
 * still blank. The copy below therefore stops calling `pages` "fully ready" — that phrase now
 * belongs to `ready` and to nothing else.
 */
const VERDICT_TEXT = {
    pages: {
        good: 'The app\u2019s code loads quickly for staff.',
        ok:   'The app\u2019s code mostly loads quickly, with some slower loads.',
        moment:     'The app\u2019s code most often takes a moment to load.',
        momentSlow: 'The app\u2019s code most often takes a moment to load, and sometimes longer.',
        bad:  'The app\u2019s code is taking too long to load for some staff.',
        mixed:      'The app\u2019s code loads quickly on under half of opens; the rest take a moment or longer.',
        none: 'No page opens recorded for this period.',
        thin: 'Too few page opens to read as a trend.',
    },
    ready: {
        good: 'Pages become usable quickly for staff.',
        ok:   'Pages mostly become usable quickly, with some slower loads.',
        moment:     'Pages most often take a moment to become usable.',
        momentSlow: 'Pages most often take a moment to become usable, and some take longer.',
        bad:  'Some staff are waiting too long before a page is usable.',
        mixed:      'Pages are usable quickly on under half of opens; the rest take a moment or longer.',
        none: 'No usable-page timings for this period \u2014 only pages that report this moment are counted.',
        thin: 'Too few page opens to read as a trend.',
    },
    fcp: {
        good: 'Pages appear on screen almost instantly.',
        ok:   'Pages mostly appear quickly, with some slower first paints.',
        moment:     'Pages most often take a moment to appear.',
        momentSlow: 'Pages most often take a moment to appear, and some take longer.',
        bad:  'Some staff wait too long before anything appears on screen.',
        mixed:      'Pages appear quickly on under half of opens; the rest take a moment or longer.',
        none: 'No page opens recorded for this period.',
        thin: 'Too few page opens to read as a trend.',
    },
    login: {
        good: 'Signing in is quick for staff.',
        ok:   'Signing in mostly feels quick, with some slower sign-ins.',
        moment:     'Sign-ins most often take a moment.',
        momentSlow: 'Sign-ins most often take a moment, and some take longer.',
        bad:  'Signing in is taking too long for some staff.',
        mixed:      'Under half of sign-ins are quick; the rest take a moment or longer.',
        none: 'No sign-ins recorded for this period.',   // month-neutral: this headline also renders in the Last-month view (v16.22)
        thin: 'Too few sign-ins to read as a trend.',
    },
};

/**
 * Below how many samples a set of percentages is not worth reading as a finding.
 *
 * DECLARED HERE, not in the card, because the card was applying it to only some of its own figures
 * (v21.16). The breakdown rows have marked thin groups `(few)` since v20.19 on the reasoning that
 * "four samples can say 100% slow and mean nothing" — while the headline verdict above them and the
 * per-page table below them applied no such test at all. Measured on a real month, that produced a
 * confident amber headline about signing in from **19 samples** — one below the card's own bar for
 * meaninglessness — and a full-width RED bar against a page with **three** opens.
 *
 * Marked rather than hidden, for the same reason as the rows: a small group that is always slow is
 * still a lead, it just is not yet a finding.
 */
export const THIN_SAMPLE = 20;

/**
 * One-line plain-English verdict for the overall speed, with a status tone for colour. Thresholds:
 * ≥20% slow → bad; else ≥80% quick AND under 10% slow → good; else ok, with one of THREE sentences:
 *   · `ok` ("mostly quick") only when quick is the larger band AND at least half (v24.96 — at
 *     41 / 40 / 19 it read "mostly feels quick" over 59% of opens taking longer than a second);
 *   · `mixed` when quick is the larger band but under half (Oct 2026 — those fell to "most often take
 *     a moment", so 124 / 100 / 26 and 50 / 40 / 10 showed the same 50% · 40% · 10% under two
 *     different sentences, the first of them false);
 *   · `moment` when "a moment" is at least as common as quick.
 * Raw counts decide the bands, because rounded percentages can tie (99 / 100 / 1).
 *
 * GREEN NEEDS THE TAIL SMALL TOO (Oct 2026): 81 / 0 / 19 was "quick for staff" in green while 80 / 0
 * / 20 was red — one point between the two ends of the scale, with nearly a fifth of opens over three
 * seconds under the green one. Empty → `none`.
 *
 * A total below `THIN_SAMPLE` short-circuits to `thin` BEFORE any of those, because a verdict is a
 * claim and there is not enough here to make one. The percentage is still shown beside it — the
 * reader loses the assertion, not the number.
 * @param {ReturnType<typeof _withPct>} overall
 * @param {'pages'|'login'|'fcp'|'ready'} [kind]  which journey the copy describes
 * @returns {{ tone: 'good'|'ok'|'bad'|'none'|'thin', text: string }}
 */
export function perfVerdict(overall, kind = 'pages') {
    const text = VERDICT_TEXT[kind] || VERDICT_TEXT.pages;
    if (!overall || !overall.total) return { tone: 'none', text: text.none };
    if (overall.total < THIN_SAMPLE) return { tone: 'thin', text: text.thin };
    if (overall.pctSlow >= 20) return { tone: 'bad', text: text.bad };
    if (overall.pctQuick >= 80 && overall.pctSlow < 10) return { tone: 'good', text: text.good };
    if (overall.quick > overall.ok && overall.quick * 2 >= overall.total) return { tone: 'ok', text: text.ok };
    if (overall.quick > overall.ok) return { tone: 'ok', text: text.mixed };
    return { tone: 'ok', text: overall.pctSlow ? text.momentSlow : text.moment };
}

/** A login-to-usable span older than this is treated as a stale/abandoned marker and ignored. */
export const LOGIN_MAX_MS = 120000;   // 2 minutes

/**
 * Bucket a login-to-usable duration from a stored start timestamp (perf-reporter's sign-in marker).
 * Returns a PERF_BUCKETS id, or null when the marker is missing/invalid, in the future, or implausibly
 * old (an abandoned sign-in — don't record a bogus huge time). PURE.
 * @param {number} t0   Date.now() captured at the Sign-in click
 * @param {number} now  Date.now() at the "page usable" point
 * @param {number} [maxMs]
 * @returns {string|null}
 */
export function loginDurationBucket(t0, now, maxMs = LOGIN_MAX_MS) {
    if (!(t0 > 0) || !(now >= t0)) return null;   // missing/invalid marker, or clock went backwards
    const elapsed = now - t0;
    if (elapsed >= maxMs) return null;            // stale/abandoned — ignore
    return bucketDuration(elapsed);
}

/**
 * Coalesce perf samples into ONE merged write per month (review F5, Sep 2026).
 *
 * `recordPerfSample` used to issue a `setDoc` per sample, and a Calendar open records a dozen or
 * more — every one queued on Firestore's single operation queue ahead of, or beside, the roster's own
 * reads. Batched, the open costs one write, issued after the burst. Holds only counts; the TIMING is
 * injected (`arm` is handed the flush to schedule) so this stays free of timers and the DOM.
 *
 * @param {(month: string, counts: Record<string, number>) => void} write  one merged write per month
 * @param {(flush: () => void) => void} arm  schedule `flush` — called once per batch, on its first sample
 * @returns {{ add: (month: string, key: string) => void, flush: () => void }}
 */
export function createPerfBatcher(write, arm) {
    /** @type {Map<string, Record<string, number>>} */
    let pending = new Map();
    let armed = false;
    const flush = () => {
        armed = false;
        const batch = pending;
        pending = new Map();
        for (const [month, counts] of batch) write(month, counts);
    };
    return {
        add(month, key) {
            const counts = pending.get(month) || {};
            counts[key] = (counts[key] || 0) + 1;
            pending.set(month, counts);
            if (!armed) { armed = true; arm(flush); }
        },
        flush,
    };
}
