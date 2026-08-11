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
 * @param {{ page: string, metric?: string, dimension?: 'conn'|'mode'|'version', minSamples?: number }} opts
 *   `minSamples` only affects `version` — see `_bucketVersions`.
 * @returns {{ total: number, rows: Array<{ value: string, label: string } & ReturnType<typeof _withPct>> }}
 */
export function summarisePerfBy(samples, { page, metric = 'domReady', dimension = 'conn', minSamples = 0 }) {
    const dim = PERF_DIMENSIONS[dimension];
    /** @type {Record<string, {quick:number, ok:number, slow:number}>} */
    const groups = {};
    let total = 0;
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
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
    if (dimension === 'version') return { total, rows: _bucketVersions(groups, minSamples) };

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
 * @param {Record<string, {quick:number, ok:number, slow:number}>} groups
 * @param {number} minSamples
 */
function _bucketVersions(groups, minSamples) {
    const versions = Object.keys(groups).sort(_compareVersionsDesc);
    /** @type {Array<{ newest: string, oldest: string, quick: number, ok: number, slow: number }>} */
    const buckets = [];
    /** @type {{ newest: string, oldest: string, quick: number, ok: number, slow: number }|null} */
    let cur = null;
    for (const v of versions) {
        if (!cur) cur = { newest: v, oldest: v, quick: 0, ok: 0, slow: 0 };
        cur.oldest = v;
        cur.quick += groups[v].quick; cur.ok += groups[v].ok; cur.slow += groups[v].slow;
        if (cur.quick + cur.ok + cur.slow >= minSamples) { buckets.push(cur); cur = null; }
    }
    if (cur) {
        const last = buckets[buckets.length - 1];
        if (last) {
            last.oldest = cur.oldest;
            last.quick += cur.quick; last.ok += cur.ok; last.slow += cur.slow;
        } else {
            buckets.push(cur);
        }
    }
    const v = (/** @type {string} */ x) => 'v' + String(x).replace(/_/g, '.');
    return buckets.map(b => ({
        value: b.newest,
        label: b.newest === b.oldest ? v(b.newest) : `${v(b.oldest)}–${v(b.newest)}`,
        ..._withPct(b),
    }));
}

/** Versions are stored dot-swapped (`20_18`) because a `.` is a Firestore field-path hazard.
 *  @param {string} value @param {string} dimension */
function _versionLabel(value, dimension) {
    return dimension === 'version' ? 'v' + String(value).replace(/_/g, '.') : String(value);
}

/** Newest version first. Numeric per segment, so `20_9` sorts below `20_18` (string sort does not).
 *  @param {string} a @param {string} b */
function _compareVersionsDesc(a, b) {
    const parts = (/** @type {string} */ v) => String(v).split('_').map(Number);
    const [aMaj = 0, aMin = 0] = parts(a);
    const [bMaj = 0, bMin = 0] = parts(b);
    return (bMaj - aMaj) || (bMin - aMin) || String(b).localeCompare(String(a));
}

// ── WHERE the wait goes — the boot phases (v20.33) ──────────────────────────────────────────────
//
// The dimensional breakdown above told us WHO is slow (installed app, budget devices) and the
// metrics told us HOW OFTEN — but every explanation of WHERE the amber second goes was inference:
// "probably SW wake, probably module parse". The last time this card ran on inference it was wrong
// (the cold-start hypothesis had installed vs browser-tab backwards until the data arrived), so
// before optimising anything the boot is split into measured phases:
//
//   swBoot  — workerStart → responseStart: waking the service worker and serving from its cache.
//   sdkLoad — responseStart → the 'myb-sdk-ready' mark: HTML parse + fetching the module graph up
//             through the Firebase SDK finishing execution (the mark fires as firebase-client.js's
//             body starts, which by ES module semantics is the moment its SDK imports have run).
//   appBoot — that mark → domContentLoadedEventEnd: the app's own modules executing after the SDK.
//
// The three are CONTIGUOUS SPANS of the same load, so each buckets independently with the ordinary
// PERF_BUCKETS — and that coarseness is the point, not a compromise: a phase under 500ms is never
// the reason a load went over a second, so `lt500ms` is exactly the "not the culprit" band. The
// card then asks one question per phase: what fraction of loads had THIS phase run long?

/** The boot-phase metric ids, in boot order, with their staff-facing labels (the Operations card is
 *  read by a non-technical admin — "SDK" and "service worker" stay out of the copy). Labels are
 *  parallel gerunds kept ≤13 chars, MEASURED not assumed: the why-rows' label column is
 *  minmax(76px, 27%) ≈ 89px at 375px, "Waking the app" (14) fit and "Loading the engine" (18)
 *  ellipsised — a truncated label in one block only would break the rows' shared rhythm. The `sub`
 *  carries the precision the short label gives up, and reaches readers via the bar's aria-label. */
export const BOOT_PHASES = /** @type {const} */ ([
    { metric: 'swBoot',  label: 'Waking up',     sub: 'the saved offline copy starting' },
    { metric: 'sdkLoad', label: 'Loading code',  sub: 'the shared code every page needs' },
    { metric: 'appBoot', label: 'Getting ready', sub: 'this page’s own code' },
]);

/**
 * Compute the three boot-phase durations (ms) from a PerformanceNavigationTiming entry and the
 * 'myb-sdk-ready' mark time. PURE — the reporter passes the raw numbers in. Any phase that cannot
 * be computed honestly is NaN, which bucketDuration then skips:
 *   - no service worker on this load (workerStart 0 — e.g. the very first visit) → no swBoot;
 *   - no SDK mark (Performance API unavailable, or a page that never loads firebase-client) → no
 *     sdkLoad/appBoot rather than a mislabelled span.
 * Negative spans (clock weirdness, an unpopulated field) also come out NaN-safe via the <= 0 guard
 * in bucketDuration — never clamped to a fake fast sample.
 * @param {{ workerStart?: number, responseStart?: number, domContentLoadedEventEnd?: number }} nav
 * @param {number|undefined} sdkMarkMs  the mark's startTime (ms from timeOrigin), if present
 * @returns {{ swBoot: number, sdkLoad: number, appBoot: number }}
 */
export function bootPhases(nav, sdkMarkMs) {
    const n = nav || {};
    const worker   = Number(n.workerStart);
    const response = Number(n.responseStart);
    const dcl      = Number(n.domContentLoadedEventEnd);
    const mark     = Number(sdkMarkMs);
    return {
        swBoot:  worker > 0 && response > 0 ? response - worker : NaN,
        sdkLoad: mark > 0 && response > 0   ? mark - response   : NaN,
        appBoot: mark > 0 && dcl > 0        ? dcl - mark        : NaN,
    };
}

/**
 * Summarise the boot-phase samples for ONE page: per phase, how many loads there were and what
 * fraction ran long.
 *
 * **The bands here are PHASE-scaled, deliberately finer than the card's load bands** — green under
 * ½s, amber ½–1s, red over 1s — because a single PHASE eating 500ms+ is precisely what pushes a
 * whole open into the load-level amber, while the load bands would paint an 800ms stage green and
 * make the block deny its own finding. The first render proved this the v20.19 way, mirrored: the
 * stated number (40% over ½s) sat beside a load-banded bar showing 15% non-green, and a number
 * disagreeing with the bar next to it is the exact defect that rule exists for. So the number IS
 * the complement of the bar's green — same grammar as every other row on the card — and the block
 * states its own bands rather than borrowing the card legend's.
 *
 * The three band shares are exposed as `pctQuick`/`pctOk`/`pctSlow` — the same property names every
 * other row uses — so the card's one bar builder renders these rows unchanged. The MEANING of each
 * band differs (declared in the block's note + each bar's aria-label); the names are kept because a
 * second bar builder for one block is how render code drifts.
 *
 * Phases with no samples are omitted (a pre-v20.33 client records none — the card must not render
 * empty scaffolding for them).
 * @param {Record<string, number>} samples raw `analytics/perf_<month>.samples`
 * @param {{ page: string }} opts
 * @returns {{ total: number, rows: Array<{ metric: string, label: string, sub: string, total: number,
 *   quick: number, ok: number, slow: number, pctQuick: number, pctOk: number, pctSlow: number,
 *   pctOver500: number }> }}
 */
export function summariseBootPhases(samples, { page }) {
    /** @type {Record<string, Record<string, number>>} */
    const perPhase = {};
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
        const parsed = parsePerfSampleKey(key);
        if (parsed.page !== page) continue;
        if (!BOOT_PHASES.some(p => p.metric === parsed.metric)) continue;
        (perPhase[parsed.metric] || (perPhase[parsed.metric] = {}))[parsed.bucket] =
            (perPhase[parsed.metric]?.[parsed.bucket] || 0) + n;
    }
    const rows = [];
    let grand = 0;
    for (const phase of BOOT_PHASES) {
        const buckets = perPhase[phase.metric];
        if (!buckets) continue;
        // Phase bands: under ½s / ½–1s / 1s+. The stored buckets split exactly there (lt500ms,
        // 500ms-1s, then everything from 1-3s up), so no information is invented.
        const g = { quick: 0, ok: 0, slow: 0 };
        for (const [bucket, n] of Object.entries(buckets)) {
            if (!PERF_BUCKETS.includes(bucket)) continue;
            const band = bucket === 'lt500ms' ? 'quick' : bucket === '500ms-1s' ? 'ok' : 'slow';
            g[band] += n;
        }
        const p = _withPct(g);
        if (!p.total) continue;
        rows.push({
            metric: phase.metric, label: phase.label, sub: phase.sub,
            pctOver500: p.total ? Math.round(((p.total - p.quick) / p.total) * 100) : 0,
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
 * `pages` and `ready` used to be the same claim and are not (v20.80). DCL fires when the module
 * scripts finish; the Calendar's access decision is asynchronous, so it can land while the page is
 * still blank. The copy below therefore stops calling `pages` "fully ready" — that phrase now
 * belongs to `ready` and to nothing else.
 */
const VERDICT_TEXT = {
    pages: {
        good: 'The app\u2019s code loads quickly for staff.',
        ok:   'The app\u2019s code mostly loads quickly, with some slower loads.',
        bad:  'The app\u2019s code is taking too long to load for some staff.',
        none: 'Not enough data yet — this builds up as staff use the app.',
    },
    ready: {
        good: 'Pages become usable quickly for staff.',
        ok:   'Pages mostly become usable quickly, with some slower loads.',
        bad:  'Some staff are waiting too long before a page is usable.',
        none: 'Not enough data yet — only pages that report this milestone are counted.',
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
 * @param {'pages'|'login'|'fcp'|'ready'} [kind]  which journey the copy describes
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
