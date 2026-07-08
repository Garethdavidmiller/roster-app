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
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return null;
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

/** @param {{quick:number, ok:number, slow:number}} g → adds total + integer percentages. */
function _withPct(g) {
    const total = g.quick + g.ok + g.slow;
    const pct = (/** @type {number} */ n) => (total ? Math.round((n / total) * 100) : 0);
    return { quick: g.quick, ok: g.ok, slow: g.slow, total, pctQuick: pct(g.quick), pctOk: pct(g.ok), pctSlow: pct(g.slow) };
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
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
        const { page, metric: mtr, bucket } = parsePerfSampleKey(key);
        if (mtr !== metric) continue;
        const group = _BUCKET_GROUP[bucket];
        if (!group || !page) continue;
        overall[group] += n;
        (pages[page] || (pages[page] = { quick: 0, ok: 0, slow: 0 }))[group] += n;
        total += n;
    }
    const byPage = Object.keys(pages)
        .map(p => ({ page: p, ..._withPct(pages[p]) }))
        .sort((a, b) => b.total - a.total || a.page.localeCompare(b.page));
    return { total, overall: _withPct(overall), byPage };
}

/**
 * Plain-English verdict copy per journey:
 *   'login' = signing in · 'fcp' = a page first appearing on screen · 'pages' = a page being fully ready.
 */
const VERDICT_TEXT = {
    pages: {
        good: 'Pages become fully ready quickly for staff.',
        ok:   'Pages mostly become ready quickly, with some slower loads.',
        bad:  'Some staff are waiting too long for pages to be ready.',
        none: 'Not enough data yet — this builds up as staff use the app.',
    },
    fcp: {
        good: 'Pages appear on screen almost instantly.',
        ok:   'Pages mostly appear quickly, with some slower first paints.',
        bad:  'Some staff wait too long before anything appears on screen.',
        none: 'Not enough data yet — this builds up as staff use the app.',
    },
    login: {
        good: 'Signing in is quick for staff.',
        ok:   'Signing in mostly feels quick, with some slower sign-ins.',
        bad:  'Signing in is taking too long for some staff.',
        none: 'No sign-ins recorded for this period.',   // month-neutral: this headline also renders in the Last-month view (v16.22)
    },
};

/**
 * One-line plain-English verdict for the overall speed, with a status tone for colour. Thresholds:
 * ≥20% slow → bad; else ≥80% quick → good; else ok. Empty → a "still building up" message.
 * @param {ReturnType<typeof _withPct>} overall
 * @param {'pages'|'login'|'fcp'} [kind]  which journey the copy describes
 * @returns {{ tone: 'good'|'ok'|'bad'|'none', text: string }}
 */
export function perfVerdict(overall, kind = 'pages') {
    const text = VERDICT_TEXT[kind] || VERDICT_TEXT.pages;
    if (!overall || !overall.total) return { tone: 'none', text: text.none };
    if (overall.pctSlow >= 20)  return { tone: 'bad',  text: text.bad };
    if (overall.pctQuick >= 80) return { tone: 'good', text: text.good };
    return { tone: 'ok', text: text.ok };
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
