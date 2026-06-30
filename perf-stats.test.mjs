// Unit tests for perf-stats.js — the pure latency maths (Project 0 instrumentation).
// Run with: node --test perf-stats.test.mjs   (part of test:hygiene)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PERF_BUCKETS, bucketDuration, perfSampleKey, parsePerfSampleKey, summarisePerf, perfVerdict, loginDurationBucket, LOGIN_MAX_MS } from './perf-stats.js';

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
        assert.equal(bucketDuration(0), 'lt500ms');
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
        for (const ms of [0, 700, 1500, 5000, 20000]) {
            assert.ok(PERF_BUCKETS.includes(/** @type {string} */ (bucketDuration(ms))));
        }
    });

    test('returns null for non-finite / negative / non-number (skip the sample)', () => {
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
