// Unit tests for perf-stats.js — the pure latency maths (Project 0 instrumentation).
// Run with: node --test perf-stats.test.mjs   (part of test:hygiene)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PERF_BUCKETS, bucketDuration, perfSampleKey, parsePerfSampleKey, summarisePerf, summarisePerfBy, PERF_DIMENSIONS, perfVerdict, loginDurationBucket, LOGIN_MAX_MS } from './perf-stats.js';

/** Build a samples map from [page, metric, bucket, count] rows (version/mode/conn fixed). */
function samplesFrom(rows) {
    /** @type {Record<string, number>} */ const s = {};
    for (const [page, metric, bucket, count] of rows) {
        s[perfSampleKey({ version: '14.89', page, metric, bucket, mode: 'browser', conn: '4g' })] = count;
    }
    return s;
}

describe('bucketDuration', () => {
    test('maps each range to the right bucket (boundaries are inclusive-low)', () => {
        assert.equal(bucketDuration(1), 'lt500ms');
        assert.equal(bucketDuration(499), 'lt500ms');
        assert.equal(bucketDuration(500), '500ms-1s');
        assert.equal(bucketDuration(999), '500ms-1s');
        assert.equal(bucketDuration(1000), '1-3s');
        assert.equal(bucketDuration(2999), '1-3s');
        assert.equal(bucketDuration(3000), '3-8s');
        assert.equal(bucketDuration(7999), '3-8s');
        assert.equal(bucketDuration(8000), 'over8s');
        assert.equal(bucketDuration(60000), 'over8s');
    });

    test('every returned bucket is a member of PERF_BUCKETS', () => {
        for (const ms of [1, 700, 1500, 5000, 20000]) {
            assert.ok(PERF_BUCKETS.includes(/** @type {string} */ (bucketDuration(ms))));
        }
    });

    test('returns null for non-finite / zero / negative / non-number (skip the sample)', () => {
        // 0 = an UNPOPULATED PerformanceNavigationTiming field, not a real duration (v16.23)
        assert.equal(bucketDuration(0), null);
        assert.equal(bucketDuration(-1), null);
        assert.equal(bucketDuration(NaN), null);
        assert.equal(bucketDuration(Infinity), null);
        assert.equal(bucketDuration(/** @type {any} */ ('500')), null);
        assert.equal(bucketDuration(/** @type {any} */ (undefined)), null);
    });
});

describe('perfSampleKey / parsePerfSampleKey', () => {
    test('joins all six dimensions, sanitising the version dots → underscores', () => {
        const key = perfSampleKey({ version: '14.88', page: 'admin', metric: 'domReady', bucket: '1-3s', mode: 'standalone', conn: '4g' });
        assert.equal(key, '14_88|admin|domReady|1-3s|standalone|4g');
        // parse returns the SANITISED version (a display label, not re-parsed); other fields round-trip.
        assert.deepEqual(parsePerfSampleKey(key),
            { version: '14_88', page: 'admin', metric: 'domReady', bucket: '1-3s', mode: 'standalone', conn: '4g' });
    });

    test('key contains no "." so it is a safe Firestore map key (no field-path hazard)', () => {
        const key = perfSampleKey({ version: '14.88', page: 'calendar', metric: 'ttfb', bucket: 'over8s', mode: 'browser', conn: 'unknown' });
        assert.ok(!key.includes('.'), 'no dot in the key');
    });

    test('sanitises a dot/pipe in ANY component (e.g. a non-conforming connection value)', () => {
        const key = perfSampleKey({ version: '14.88', page: 'calendar', metric: 'domReady', bucket: '1-3s', mode: 'browser', conn: 'weird.type|x' });
        assert.ok(!key.includes('.'), 'no dot');
        assert.equal(key.split('|').length, 6, 'still exactly six components (pipe in a value was neutralised)');
    });
});

describe('summarisePerf', () => {
    test('rolls buckets into quick/ok/slow bands, overall + per page, for the chosen metric only', () => {
        const samples = samplesFrom([
            ['calendar', 'domReady', 'lt500ms', 6],
            ['calendar', 'domReady', '500ms-1s', 2],   // → quick total 8
            ['calendar', 'domReady', '1-3s', 1],        // → ok 1
            ['calendar', 'domReady', 'over8s', 1],      // → slow 1
            ['admin',    'domReady', '3-8s', 5],         // → admin slow 5
            ['calendar', 'ttfb',     'lt500ms', 99],     // different metric — must be ignored
        ]);
        const r = summarisePerf(samples, { metric: 'domReady' });
        assert.equal(r.total, 15);   // 6+2+1+1 (calendar) + 5 (admin); the ttfb row is excluded
        assert.deepEqual(
            { quick: r.overall.quick, ok: r.overall.ok, slow: r.overall.slow },
            { quick: 8, ok: 1, slow: 6 });
        // pages sorted by total desc: calendar (10) before admin (5)
        assert.deepEqual(r.byPage.map(p => p.page), ['calendar', 'admin']);
        assert.equal(r.byPage[0].pctQuick, 80);   // 8/10
        assert.equal(r.byPage[1].slow, 5);
    });

    test('ignores malformed/zero counts and unknown buckets, and is empty for no data', () => {
        const s = samplesFrom([['admin', 'domReady', 'lt500ms', 0], ['admin', 'domReady', 'nonsense', 3]]);
        s['bad|key'] = 5;
        const r = summarisePerf(s, { metric: 'domReady' });
        assert.equal(r.total, 0);
        assert.deepEqual(r.byPage, []);
        assert.equal(summarisePerf({}).total, 0);
    });
});

/** Like samplesFrom, but every dimension is settable — this is the suite for the dimensions the
 *  card used to discard, so they cannot be pinned to one value. */
function dimSamples(rows) {
    /** @type {Record<string, number>} */ const s = {};
    for (const [page, bucket, mode, conn, count, version = '20.19'] of rows) {
        s[perfSampleKey({ version, page, metric: 'domReady', bucket, mode, conn })] = count;
    }
    return s;
}

describe('summarisePerfBy — WHY a page is slow, not just that it is', () => {
    // The dimensions were written into every key from the start and thrown away at read time, so
    // the card could say the Calendar was the slowest page and nothing about who it was slow for.

    test('splits ONE page by connection, and leaves other pages out of it', () => {
        const s = dimSamples([
            ['calendar', 'lt500ms', 'standalone', '4g', 10],
            ['calendar', 'over8s',  'standalone', '3g', 4],
            ['calendar', '1-3s',    'browser',    '3g', 6],
            ['admin',    'over8s',  'browser',    '2g', 99],   // another page — must not appear
        ]);
        const r = summarisePerfBy(s, { page: 'calendar', dimension: 'conn' });
        assert.equal(r.total, 20, 'the admin samples leaked into the calendar breakdown');
        assert.deepEqual(r.rows.map(x => x.value), ['4g', '3g']);
        assert.equal(r.rows[0].pctSlow, 0);
        assert.equal(r.rows[1].total, 10);
        assert.equal(r.rows[1].pctSlow, 40);   // 4 of 10
    });

    test('rows are ordered FAST → SLOW, not by size — the shape is the finding', () => {
        // A breakdown sorted by volume would put the biggest group first and scatter the gradient,
        // which is exactly the pattern being looked for ("it degrades with the connection").
        const s = dimSamples([
            ['calendar', 'over8s',  'browser', 'slow-2g', 1],
            ['calendar', 'lt500ms', 'browser', '4g', 500],
            ['calendar', '1-3s',    'browser', '2g', 3],
        ]);
        const r = summarisePerfBy(s, { page: 'calendar', dimension: 'conn' });
        assert.deepEqual(r.rows.map(x => x.value), ['4g', '2g', 'slow-2g']);
    });

    test('an UNRECOGNISED connection value still appears rather than vanishing', () => {
        // effectiveType is a browser-supplied string. A value the label table has never heard of
        // must not be silently dropped, or the rows would stop adding up to the page total and
        // nothing on screen would say so.
        const s = dimSamples([
            ['calendar', 'lt500ms', 'browser', '4g', 5],
            ['calendar', 'over8s',  'browser', '5g', 2],
        ]);
        const r = summarisePerfBy(s, { page: 'calendar', dimension: 'conn' });
        assert.equal(r.total, 7);
        assert.ok(r.rows.some(x => x.value === '5g'), '5g was dropped');
        assert.equal(r.rows.find(x => x.value === '5g').label, '5g', 'falls back to the raw value');
    });

    test('install mode separates the installed app from a browser tab', () => {
        const s = dimSamples([
            ['calendar', 'lt500ms', 'standalone', '4g', 8],
            ['calendar', 'over8s',  'browser',    '4g', 2],
        ]);
        const r = summarisePerfBy(s, { page: 'calendar', dimension: 'mode' });
        assert.deepEqual(r.rows.map(x => x.label), ['Installed app', 'Browser tab']);
        assert.equal(r.rows[1].pctSlow, 100);
    });

    test('versions read newest-first and NUMERICALLY — 20.9 is older than 20.18', () => {
        // The reason this needs saying: versions are stored dot-swapped ('20_18'), and a string
        // sort puts '20_9' after '20_18'. A regression hunt reading the newest row first would
        // then be reading the wrong release.
        const s = dimSamples([
            ['calendar', 'lt500ms', 'browser', '4g', 3, '20.9'],
            ['calendar', 'over8s',  'browser', '4g', 3, '20.18'],
            ['calendar', '1-3s',    'browser', '4g', 3, '19.100'],
        ]);
        const r = summarisePerfBy(s, { page: 'calendar', dimension: 'version' });
        assert.deepEqual(r.rows.map(x => x.label), ['v20.18', 'v20.9', 'v19.100']);
    });

    test('a key missing its dimension is counted as unknown, never dropped', () => {
        // A short key (an older or non-conforming client) must not shrink the total, or the
        // breakdown would silently disagree with the per-page count printed right above it.
        const s = { '20_19|calendar|domReady|over8s': 4 };
        const r = summarisePerfBy(s, { page: 'calendar', dimension: 'conn' });
        assert.equal(r.total, 4);
        assert.equal(r.rows[0].value, 'unknown');
    });

    test('every declared dimension label set is complete for the values it orders', () => {
        // A dimension whose `order` names a value with no label would render a raw token like
        // 'slow-2g' to an admin who reads plain English everywhere else on this card.
        for (const [name, dim] of Object.entries(PERF_DIMENSIONS)) {
            if (!dim.order) continue;
            for (const v of dim.order) {
                assert.ok(dim.labels[v], `${name}.${v} has no plain-language label`);
            }
        }
    });

    test('no data → no rows, and no throw', () => {
        assert.deepEqual(summarisePerfBy({}, { page: 'calendar' }), { total: 0, rows: [] });
    });
});

describe('perfVerdict', () => {
    test('empty → "still building up" (tone none)', () => {
        assert.equal(perfVerdict(summarisePerf({}).overall).tone, 'none');
    });
    test('≥20% slow → bad', () => {
        const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 7], ['admin', 'domReady', 'over8s', 3]]));
        assert.equal(perfVerdict(r.overall).tone, 'bad');   // 30% slow
    });
    test('≥80% quick (and little slow) → good', () => {
        const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 9], ['admin', 'domReady', '1-3s', 1]]));
        assert.equal(perfVerdict(r.overall).tone, 'good');  // 90% quick, 0% slow
    });
    test('mixed but not slow-heavy → ok', () => {
        const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 5], ['admin', 'domReady', '1-3s', 5]]));
        assert.equal(perfVerdict(r.overall).tone, 'ok');    // 50% quick, 0% slow, <80% quick
    });

    test('login kind uses sign-in copy; tone logic unchanged', () => {
        const empty = perfVerdict(summarisePerf({}).overall, 'login');
        assert.equal(empty.tone, 'none');
        assert.match(empty.text, /sign-ins/i);
        const good = perfVerdict(summarisePerf(samplesFrom([['login', 'loginTotal', 'lt500ms', 9], ['login', 'loginTotal', '1-3s', 1]]), { metric: 'loginTotal' }).overall, 'login');
        assert.equal(good.tone, 'good');
        assert.match(good.text, /Signing in/i);
    });

    test('fcp kind uses "appear on screen" copy; tone logic unchanged', () => {
        const r = summarisePerf(samplesFrom([['paycalc', 'fcp', 'lt500ms', 9], ['paycalc', 'fcp', '1-3s', 1]]), { metric: 'fcp' });
        const good = perfVerdict(r.overall, 'fcp');
        assert.equal(good.tone, 'good');                 // 90% quick → good, same thresholds
        assert.match(good.text, /appear/i);              // FCP-specific wording
        assert.equal(perfVerdict(summarisePerf({}).overall, 'fcp').tone, 'none');
    });
});

describe('loginDurationBucket', () => {
    test('buckets a plausible recent span', () => {
        assert.equal(loginDurationBucket(1000, 1000 + 300), 'lt500ms');
        assert.equal(loginDurationBucket(1000, 1000 + 2000), '1-3s');
    });
    test('ignores missing / invalid / future / stale markers', () => {
        assert.equal(loginDurationBucket(0, 5000), null, 'no marker');
        assert.equal(loginDurationBucket(NaN, 5000), null, 'invalid');
        assert.equal(loginDurationBucket(5000, 4000), null, 'clock went backwards');
        assert.equal(loginDurationBucket(1000, 1000 + LOGIN_MAX_MS), null, 'stale (>= max)');
        assert.equal(loginDurationBucket(1000, 1000 + LOGIN_MAX_MS + 1), null, 'well past max');
    });
});
