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
 * HOW MUCH BACKGROUND WORK THE SERVICE WORKER DID DURING A BOOT (v22.94).
 *
 * A COUNT vocabulary, and deliberately not a duration one. The external calendar-latency review
 * asked for exactly these bands — "0 / 1–10 / 11–30 / 31+" — because the question is whether a boot
 * carrying a full revalidation sweep is materially slower than one carrying none, and the interesting
 * shape is the two ENDS: a worker already awake does almost none, a worker that just woke does the
 * lot.
 *
 * **These strings live in the same `bucket` slot of `perfSampleKey` as the duration bands**, which
 * keeps the key at six components — a seventh would invalidate every sample stored since v21.30.
 * The cost is that the duration summarisers would band these nonsensically if pointed at them, so
 * they never are: every summariser filters by METRIC first, and no duration row names `swrCount`.
 */
export const SWR_COUNT_BUCKETS = ['0', '1-10', '11-30', '31+'];

/**
 * Bucket a revalidation COUNT. Returns null for anything that is not a finite count, so a browser
 * that could not answer (no controller, no reply, an older worker that does not know the message)
 * records nothing rather than a fabricated zero — the two are different, and "no service worker
 * revalidations happened" is the finding this exists to test.
 * @param {number} n
 * @returns {string|null}
 */
export function bucketSwrCount(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return null;
    if (n === 0) return '0';
    if (n <= 10) return '1-10';
    if (n <= 30) return '11-30';
    return '31+';
}

/** The band from which a boot counts as carrying a FULL sweep — the review's "31+". */
export const SWR_HEAVY_BUCKET = '31+';

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
/**
 * The Calendar's START LADDER — four cumulative milestones from the moment the page began.
 *
 * ── WHY CUMULATIVE, WHERE BOOT_PHASES ARE SPANS ─────────────────────────────────────────────────
 *
 * `BOOT_PHASES` answers "which STAGE ran long" and stops at DOMContentLoaded. Everything expensive
 * on the Calendar happens AFTER that: the auth restore, the access decision, then Firestore. Those
 * are not stages of loading code, they are things the page waits for, and each one only makes sense
 * as "how far into the start had we got when this happened". So they share the card's normal bands
 * rather than the phase bands — the reader is asking the same question they ask of a page open.
 *
 * ── THE ONE QUESTION THIS EXISTS TO ANSWER ──────────────────────────────────────────────────────
 *
 * Before it, a slow Calendar was a single number and the card could not say WHERE it went. The
 * ladder separates the three candidates, and because each milestone contains the ones above it, a
 * reader compares adjacent rows rather than doing arithmetic: signed in fast but access slow means
 * the gate; access fast but roster slow means Firestore.
 *
 * `ready` is deliberately the third rung and NOT the last. It fires on a cached grid as readily as
 * an authoritative one, which is right — that is a roster the member can read — but it would flatter
 * the figure if it were the end of the story, because a device can show yesterday's roster instantly
 * and take another two seconds to confirm it. `rosterLive` is that confirmation.
 */
export const START_MILESTONES = /** @type {const} */ ([
    // "Recognised", NOT "Signed in" — the card's FIRST section is "🔑 Signing in" and means an
    // actual credential sign-in, which is a different event with a different distribution. Two
    // near-identical names for two different things in one card is the kind of collision a reader
    // resolves silently and wrongly. This rung is the saved session being restored, no typing.
    { metric: 'authBoot',   label: 'Recognised',   sub: 'your saved sign-in being restored' },
    // **THE LADDER IS NO LONGER MONOTONIC FOR EVERY MEMBER, AND THE INVERSION IS THE POINT
    // (v22.97).** Each rung is measured from navigation start and bucketed on its own, so none is
    // derived by subtracting another and every figure below stays true — but a returning member now
    // takes the PROVISIONAL PAINT, which puts `rosterCached` and `ready` on screen BEFORE this rung
    // resolves. So `Shifts shown` reading faster than `Unlocked` is not a broken card: it is the
    // fast path working, and it is exactly the signature `LATENCY_PLAN.md` says to look for.
    // Do not "fix" it by marking access at the paint — a paint is not a grant.
    { metric: 'access',     label: 'Unlocked',     sub: 'the Calendar deciding you may see it' },
    // THE RUNG THAT SPLITS THE GAP NOBODY COULD SEE (v22.95). The field read of 5 Sep 2026 put
    // Unlocked at 58% over a second and Shifts shown at 78% — about eighteen points appearing
    // between deciding a member may look and actually painting their roster, with no rung in
    // between to say where. This is the device's own saved copy coming back out of storage, which
    // is what 98% of attributed starts are served from.
    //
    // It reports ONLY when the cache produced something. A device with no saved copy has no such
    // moment, and giving it one would put a first-visit boot into a distribution about how quickly
    // storage answers — the same rule every other rung here follows.
    { metric: 'rosterCached', label: 'Roster found', sub: 'your own saved copy, back from this device' },
    { metric: 'ready',      label: 'Shifts shown', sub: 'a roster on screen, saved or current' },
    { metric: 'rosterLive', label: 'Confirmed',    sub: 'those shifts checked against the server' },
]);

/**
 * Roll the start ladder up for one page, in ladder order, on the card's standard bands. Same shape
 * as `summariseBootPhases` so the card renders both blocks through one idiom. A milestone nothing
 * has reported yet is simply absent — no scaffolding for data that does not exist.
 * @param {Record<string, number>} samples raw `analytics/perf_<month>.samples`
 * @param {{ page: string }} opts
 * @returns {{ total: number, rows: Array<{ metric: string, label: string, sub: string, total: number,
 *   quick: number, ok: number, slow: number, pctQuick: number, pctOk: number, pctSlow: number,
 *   pctOver1s: number }> }}
 */
export function summariseStartMilestones(samples, { page }) {
    return _summariseMetricRows(samples, page, START_MILESTONES);
}

/**
 * WHAT SERVED THE FIRST GRID — the split that decides `LATENCY_PLAN.md` Phase 2 (v21.99).
 *
 * Phase 2 narrows the Calendar's authoritative Firestore read, and its whole value rests on how many
 * loads reach a grid THROUGH that read rather than from the local cache. A cache-served load never
 * touches the network on this path, so narrowing the read cannot move it — and the card could not
 * tell the two apart, so the phase could only be argued.
 *
 * **The two rows do NOT sum to `ready`**, and the note beside them has to say so: a page that does
 * not know its source (the three whose container unhides on `auth-ready`) reports `ready` alone.
 * Reading these as a partition of the whole would understate whichever way the remainder fell.
 */
// SHORT LABELS, because the column they sit in is `minmax(76px, 27%)` and the bar beside them is
// what the row is for. "From the saved copy" ellipsised to "From the save…" at 390px — the label
// that named the whole distinction, truncated on the width most staff read the card at. The heading
// above carries the question, so the rows only have to name the two answers; the fuller wording
// survives in `sub`, which is the bar's accessible description.
export const READY_SOURCES = /** @type {const} */ ([
    { metric: 'readyCached',  label: 'Saved copy', sub: 'a grid the device already held' },
    { metric: 'readyFetched', label: 'The server', sub: 'a grid that waited for the read' },
]);

/** @param {Record<string, number>} samples @param {{page: string}} opts */
export function summariseReadySource(samples, { page }) {
    return _summariseMetricRows(samples, page, READY_SOURCES);
}

/**
 * OPENS A RELEASE CAUSED (v22.92) — the reading v22.90 shipped without.
 *
 * Deferring the update reload until the member looks away removed a cost nobody could size. This is
 * how it gets sized: `readyUpdate` is written beside `ready`, from the same bucket on the same path,
 * whenever the load followed an update.
 *
 * **It is a SUBSET of `ready`, not a split of it** — the opposite relation to `READY_SOURCES` above,
 * and the card must say which it is or the reader will apply the wrong arithmetic to whichever block
 * they met second. Because it is a subset, the counts divide cleanly: this row's total over the
 * ladder's `ready` total is the share of opens that followed a release.
 *
 * ONE ROW, deliberately. The complement ("opens no release caused") would be a second sample on
 * every load, on every page, to carry a number `ready` already holds — writes bought for a
 * subtraction. And it is not rendered next to a re-drawn `ready` bar either: the ladder above
 * already draws that one, and the same figure twice on one card is how a card comes to state it two
 * ways.
 */
export const UPDATE_OPENS = /** @type {const} */ ([
    { metric: 'readyUpdate', label: 'After a release', sub: 'the open that followed an update installing' },
]);

/** @param {Record<string, number>} samples @param {{page: string}} opts */
export function summariseUpdateOpens(samples, { page }) {
    return _summariseMetricRows(samples, page, UPDATE_OPENS);
}

// ── HOW MUCH THE SERVICE WORKER WAS DOING (v23.00) ──────────────────────────────────────────────
//
// `swrCount` and `readyHeavySwr` were written from v22.94 and read by NOTHING until this block:
// every Calendar load asked the worker for its revalidation count and wrote the answer to
// Firestore, and no surface could show it. That is the worst of the three states an instrument can
// be in — it kept costing writes and could not answer the question it was built for. Found by an
// external review of the release that added it.
//
// TWO METRICS, TWO DIFFERENT SHAPES, and this is the thing not to tidy into one:
//   · `swrCount` is a DISTRIBUTION OVER COUNT BANDS — how many revalidations a boot carried. Its
//     buckets are `SWR_COUNT_BUCKETS`, not durations, so `_summariseMetricRows` cannot read it:
//     that function bands through `_BUCKET_GROUP`, which knows only quick/ok/slow, and every row
//     would silently total zero and be dropped. Hence its own summariser below.
//   · `readyHeavySwr` is a SUBSET OF `ready`, banded by DURATION exactly like `readyUpdate` — so it
//     uses the shared body and is directly comparable with the ladder's own `Shifts shown` row.
//
// Together they answer the demoted-but-open hypothesis in LATENCY_PLAN.md: does a boot carrying a
// full revalidation sweep reach the roster more slowly than one that does not?
export const HEAVY_SWR_OPENS = /** @type {const} */ ([
    { metric: 'readyHeavySwr', label: 'Worker busy', sub: 'the open where the worker was rechecking 31+ files' },
]);

/** @param {Record<string, number>} samples @param {{page: string}} opts */
export function summariseHeavySwrOpens(samples, { page }) {
    return _summariseMetricRows(samples, page, HEAVY_SWR_OPENS);
}

/**
 * The `swrCount` distribution for one page, in `SWR_COUNT_BUCKETS` order.
 *
 * A band with no samples is OMITTED rather than rendered as zero — the same rule the rest of this
 * file follows, and it matters most here: `'0'` means "the worker rechecked nothing", which is a
 * real and reassuring answer, so a manufactured zero would be indistinguishable from the finding.
 * `askSwrCount` never records a band it could not establish, so anything absent is genuinely
 * unobserved rather than observed-as-none.
 *
 * @param {Record<string, number>} samples
 * @param {{page: string}} opts
 * @returns {{ total: number, rows: Array<{ band: string, count: number, pct: number }> }}
 */
export function summariseSwrCounts(samples, { page }) {
    /** @type {Record<string, number>} */
    const perBand = {};
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
        const parsed = parsePerfSampleKey(key);
        if (parsed.page !== page || parsed.metric !== 'swrCount') continue;
        if (!SWR_COUNT_BUCKETS.includes(parsed.bucket)) continue;   // an unknown band is not a band
        perBand[parsed.bucket] = (perBand[parsed.bucket] || 0) + n;
    }
    const total = Object.values(perBand).reduce((a, b) => a + b, 0);
    const rows = SWR_COUNT_BUCKETS
        .filter(b => perBand[b])
        .map(b => ({ band: b, count: perBand[b], pct: total ? Math.round((perBand[b] / total) * 100) : 0 }));
    return { total, rows };
}

/**
 * The shared body. Extracted rather than copied when the ready-source split arrived: the bucket
 * banding, the thin-sample total and the deliberately-inverted `pctOver1s` are one reading, and two
 * copies of them is how a card comes to state the same figure two ways.
 * @param {Record<string, number>} samples @param {string} page
 * @param {ReadonlyArray<{metric: string, label: string, sub: string}>} wanted
 */
function _summariseMetricRows(samples, page, wanted) {
    /** @type {Record<string, Record<string, number>>} */
    const perMilestone = {};
    for (const [key, raw] of Object.entries(samples || {})) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;
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
            // The share OVER a second — the complement of pctQuick, and deliberately that way round.
            // Every other block in this section states a bad-when-high number ("over ½s", "over 1s"),
            // so a good-when-high column here would flip the reading direction halfway down one
            // section with nothing but the header to say so. Same band as the neighbouring splits.
            pctOver1s: p.total ? Math.round(((p.ok + p.slow) / p.total) * 100) : 0,
            ...p,
        });
        grand = Math.max(grand, p.total);
    }
    return { total: grand, rows };
}

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
        thin: 'Too few page opens yet to read as a trend.',
    },
    ready: {
        good: 'Pages become usable quickly for staff.',
        ok:   'Pages mostly become usable quickly, with some slower loads.',
        bad:  'Some staff are waiting too long before a page is usable.',
        none: 'Not enough data yet — only pages that report this milestone are counted.',
        thin: 'Too few page opens yet to read as a trend.',
    },
    fcp: {
        good: 'Pages appear on screen almost instantly.',
        ok:   'Pages mostly appear quickly, with some slower first paints.',
        bad:  'Some staff wait too long before anything appears on screen.',
        none: 'Not enough data yet — this builds up as staff use the app.',
        thin: 'Too few page opens yet to read as a trend.',
    },
    login: {
        good: 'Signing in is quick for staff.',
        ok:   'Signing in mostly feels quick, with some slower sign-ins.',
        bad:  'Signing in is taking too long for some staff.',
        none: 'No sign-ins recorded for this period.',   // month-neutral: this headline also renders in the Last-month view (v16.22)
        thin: 'Too few sign-ins yet to read as a trend.',
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
 * ≥20% slow → bad; else ≥80% quick → good; else ok. Empty → a "still building up" message.
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
