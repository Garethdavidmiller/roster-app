// Unit tests for perf-stats.js — the pure latency maths (Project 0 instrumentation).
// Run with: node --test perf-stats.test.mjs   (part of test:hygiene)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { THIN_SAMPLE, PERF_BUCKETS, bucketDuration, perfSampleKey, parsePerfSampleKey, summarisePerf, summarisePerfBy, PERF_DIMENSIONS, perfVerdict, loginDurationBucket, LOGIN_MAX_MS, BOOT_PHASES, bootPhases, summariseBootPhases, START_MILESTONES, summariseStartMilestones, READY_SOURCES, summariseReadySource } from './perf-stats.js';

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

    test('versions ROLL UP into buckets big enough to read — the shipped-and-wrong case', () => {
        // v20.19 listed each version individually. The version bumps 0.01 per change, so one month
        // spanned ~30 releases and 480 samples gave rows of 1–9 loads, every one flagged "(few)",
        // none comparable — the dimension meant to answer "did a release make this worse" answered
        // nothing while taking more screen than the other two put together.
        const rows = [];
        for (let i = 1; i <= 9; i++) rows.push(['calendar', 'lt500ms', 'browser', '4g', 4, `20.${i}`]);
        const r = summarisePerfBy(dimSamples(rows), { page: 'calendar', dimension: 'version', minSamples: 10 });
        assert.ok(r.rows.length <= 4, `still fragmented: ${r.rows.map(x => x.label).join(', ')}`);
        assert.equal(r.total, 36, 'roll-up lost samples');
        assert.equal(r.rows.reduce((n, x) => n + x.total, 0), 36, 'the rows no longer add up to the total');
        assert.ok(r.rows.every(x => x.total >= 10), 'a bucket below the threshold survived');
    });

    test('buckets accumulate NEWEST-first, so the current release is not diluted by old ones', () => {
        // The release being judged is the newest. Accumulating oldest-first would average it into a
        // bucket with its predecessors and hide exactly the regression this is here to surface.
        const r = summarisePerfBy(dimSamples([
            ['calendar', 'over8s',  'browser', '4g', 12, '20.20'],   // the new, bad release
            ['calendar', 'lt500ms', 'browser', '4g', 12, '20.10'],
            ['calendar', 'lt500ms', 'browser', '4g', 12, '20.9'],
        ]), { page: 'calendar', dimension: 'version', minSamples: 10 });
        assert.equal(r.rows[0].label, 'v20.20', 'the newest release was merged into older ones');
        assert.equal(r.rows[0].pctSlow, 100, 'the regression was averaged away');
    });

    test('a contiguous bucket is LABELLED as a range, and a lone version is not', () => {
        const r = summarisePerfBy(dimSamples([
            ['calendar', 'lt500ms', 'browser', '4g', 30, '20.20'],   // alone: meets the threshold
            ['calendar', 'lt500ms', 'browser', '4g', 5,  '20.12'],
            ['calendar', 'lt500ms', 'browser', '4g', 5,  '20.11'],
            ['calendar', 'lt500ms', 'browser', '4g', 25, '20.10'],
        ]), { page: 'calendar', dimension: 'version', minSamples: 20 });
        assert.equal(r.rows[0].label, 'v20.20');
        assert.equal(r.rows[1].label, 'v20.10–v20.12', 'the range reads low–high');
    });

    test('the oldest remainder is MERGED, never left as a thin trailing row', () => {
        // A trailing "(few)" row is the thing the roll-up exists to remove; producing one at the
        // end would reintroduce it in the one place nobody looks.
        const r = summarisePerfBy(dimSamples([
            ['calendar', 'lt500ms', 'browser', '4g', 25, '20.20'],
            ['calendar', 'lt500ms', 'browser', '4g', 2,  '20.10'],
        ]), { page: 'calendar', dimension: 'version', minSamples: 20 });
        assert.equal(r.rows.length, 1, 'a 2-sample tail was emitted as its own row');
        assert.equal(r.rows[0].total, 27);
        assert.equal(r.rows[0].label, 'v20.10–v20.20');
    });

    test('a month with barely any data shows what it has rather than nothing', () => {
        const r = summarisePerfBy(dimSamples([['calendar', 'lt500ms', 'browser', '4g', 3, '20.20']]),
            { page: 'calendar', dimension: 'version', minSamples: 20 });
        assert.equal(r.rows.length, 1);
        assert.equal(r.rows[0].total, 3);
    });

    test('conn and mode are NOT rolled up — their values are a fixed, small set', () => {
        // Only the version dimension is unbounded. Bucketing "3G-like" into "4G-like" because it is
        // small would destroy the comparison the row exists to make.
        const r = summarisePerfBy(dimSamples([
            ['calendar', 'lt500ms', 'browser', '4g', 200],
            ['calendar', 'over8s',  'browser', '3g', 2],
        ]), { page: 'calendar', dimension: 'conn', minSamples: 20 });
        assert.deepEqual(r.rows.map(x => x.value), ['4g', '3g']);
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

describe('perfVerdict — a verdict is a CLAIM, and needs enough to make one (v21.16)', () => {
    // The card marked breakdown rows "(few)" below 20 samples from v20.19 and applied no such test
    // to its own HEADLINE. Measured on a real month, that produced a confident amber verdict about
    // signing in from 19 samples — one below the card's own bar for meaninglessness — where two
    // slow sign-ins move the figure ten points.
    const from = (/** @type {number} */ quick, /** @type {number} */ slow) =>
        summarisePerf(samplesFrom([['login', 'loginTotal', 'lt500ms', quick],
            ['login', 'loginTotal', '3-8s', slow]]), { metric: 'loginTotal' }).overall;

    test('below the threshold there is no verdict, whatever the percentages say', () => {
        // 19 samples that are 100% SLOW — the most confident "bad" the maths can produce.
        const v = perfVerdict(from(0, 19), 'login');
        assert.equal(v.tone, 'thin', 'not bad, not ok — too few to say');
        assert.match(v.text, /Too few sign-ins/);
    });

    test('and the same shape one sample later IS a verdict', () => {
        // The boundary is the point: `< THIN_SAMPLE`, so 20 reads.
        assert.equal(perfVerdict(from(0, THIN_SAMPLE), 'login').tone, 'bad');
    });

    test('a thin sample outranks good, ok and bad alike', () => {
        // All three verdict branches must be unreachable below the threshold, not just the alarming
        // one — a "good" claim from four samples is exactly as unfounded as a "bad" one.
        assert.equal(perfVerdict(from(19, 0), 'login').tone, 'thin', '100% quick, still too few');
        assert.equal(perfVerdict(from(10, 5), 'login').tone, 'thin', 'a middling split, still too few');
    });

    test('EMPTY still reads as empty, not as thin', () => {
        // Two different states and two different sentences: nothing recorded at all is not the same
        // as a handful recorded, and the card says so ("builds up" vs "too few to read").
        assert.equal(perfVerdict(from(0, 0), 'login').tone, 'none');
    });

    test('every journey has thin copy, so none falls back to another journey\'s words', () => {
        for (const kind of /** @type {const} */ (['pages', 'login', 'fcp', 'ready'])) {
            const v = perfVerdict(from(1, 0), kind);
            assert.equal(v.tone, 'thin', kind);
            assert.ok(v.text && !/undefined/.test(v.text), `${kind} has its own thin sentence`);
        }
    });
});

describe('perfVerdict', () => {
    // ── THE COUNTS BELOW ARE ×10 THEIR ORIGINALS, AND THE RATIOS ARE UNTOUCHED (v21.16) ──────────
    //
    // Every fixture here was ten samples, which is now below `THIN_SAMPLE` and short-circuits to a
    // thin verdict before any tone threshold is reached. These tests are about the THRESHOLDS, so
    // they need enough samples for a threshold to apply at all; scaling by ten preserves 30% slow,
    // 90% quick and 50/50 exactly. The thin behaviour itself is pinned in its own block above.
    test('empty → "still building up" (tone none)', () => {
        assert.equal(perfVerdict(summarisePerf({}).overall).tone, 'none');
    });
    test('≥20% slow → bad', () => {
        const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 70], ['admin', 'domReady', 'over8s', 30]]));
        assert.equal(perfVerdict(r.overall).tone, 'bad');   // 30% slow
    });
    test('≥80% quick (and little slow) → good', () => {
        const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 90], ['admin', 'domReady', '1-3s', 10]]));
        assert.equal(perfVerdict(r.overall).tone, 'good');  // 90% quick, 0% slow
    });
    test('mixed but not slow-heavy → ok', () => {
        const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 50], ['admin', 'domReady', '1-3s', 50]]));
        assert.equal(perfVerdict(r.overall).tone, 'ok');    // 50% quick, 0% slow, <80% quick
    });

    test('login kind uses sign-in copy; tone logic unchanged', () => {
        const empty = perfVerdict(summarisePerf({}).overall, 'login');
        assert.equal(empty.tone, 'none');
        assert.match(empty.text, /sign-ins/i);
        const good = perfVerdict(summarisePerf(samplesFrom([['login', 'loginTotal', 'lt500ms', 90], ['login', 'loginTotal', '1-3s', 10]]), { metric: 'loginTotal' }).overall, 'login');
        assert.equal(good.tone, 'good');
        assert.match(good.text, /Signing in/i);
    });

    test('fcp kind uses "appear on screen" copy; tone logic unchanged', () => {
        const r = summarisePerf(samplesFrom([['paycalc', 'fcp', 'lt500ms', 90], ['paycalc', 'fcp', '1-3s', 10]]), { metric: 'fcp' });
        const good = perfVerdict(r.overall, 'fcp');
        assert.equal(good.tone, 'good');                 // 90% quick → good, same thresholds
        assert.match(good.text, /appear/i);              // FCP-specific wording
        assert.equal(perfVerdict(summarisePerf({}).overall, 'fcp').tone, 'none');
    });
});

describe('bootPhases — where a cold start goes (v20.33)', () => {
    // A realistic slow installed-app open: SW woke at 40ms, served at 220ms, SDK executed by
    // 1100ms, DCL at 1600ms. The three spans must be contiguous slices of that timeline.
    const nav = { workerStart: 40, responseStart: 220, domContentLoadedEventEnd: 1600 };

    test('splits a load into three contiguous spans', () => {
        const p = bootPhases(nav, 1100);
        assert.equal(p.swBoot, 180);    // 220 − 40
        assert.equal(p.sdkLoad, 880);   // 1100 − 220
        assert.equal(p.appBoot, 500);   // 1600 − 1100
        // Contiguity is the property the card's allocation depends on: the spans plus the
        // pre-worker time must reconstruct the load, or the phases would double-count.
        assert.equal(nav.workerStart + p.swBoot + p.sdkLoad + p.appBoot, nav.domContentLoadedEventEnd);
    });

    test('no service worker on this load (workerStart 0) → swBoot is not invented', () => {
        const p = bootPhases({ ...nav, workerStart: 0 }, 1100);
        assert.ok(Number.isNaN(p.swBoot), 'a first visit has no SW to wake — recording 220ms of network as "SW wake" would be a lie');
        assert.equal(p.sdkLoad, 880);   // the mark-based spans are unaffected
    });

    test('no SDK mark → both mark-based spans are dropped, not mislabelled', () => {
        const p = bootPhases(nav, undefined);
        assert.ok(Number.isNaN(p.sdkLoad));
        assert.ok(Number.isNaN(p.appBoot));
        assert.equal(p.swBoot, 180);    // the nav-only span survives
    });

    test('a negative span never becomes a fake fast sample', () => {
        // A mark that reads BEFORE responseStart (bfcache restore / clock weirdness): sdkLoad is
        // negative, and bucketDuration's <=0 guard must drop it — asserted end-to-end here because
        // the failure mode is silent (a phantom lt500ms count that flatters the phase).
        const p = bootPhases(nav, 100);
        assert.equal(bucketDuration(p.sdkLoad), null);
        assert.equal(bucketDuration(p.appBoot), '1-3s');   // 1600−100 = 1500ms — still honest on its own span
    });
});

describe('summariseBootPhases — the "By stage of start-up" rows', () => {
    test('rows come out in boot order with the ½s share computed from the bucket split', () => {
        const samples = samplesFrom([
            // swBoot: 90 fast, 10 in 500ms-1s → 10% over ½s
            ['calendar', 'swBoot', 'lt500ms', 90], ['calendar', 'swBoot', '500ms-1s', 10],
            // sdkLoad: 60 fast, 30 in 500ms-1s, 10 in 1-3s → 40% over ½s
            ['calendar', 'sdkLoad', 'lt500ms', 60], ['calendar', 'sdkLoad', '500ms-1s', 30], ['calendar', 'sdkLoad', '1-3s', 10],
            // appBoot: all fast
            ['calendar', 'appBoot', 'lt500ms', 100],
            // noise that must not leak in: another page, and a non-phase metric on this page
            ['admin', 'sdkLoad', '1-3s', 50], ['calendar', 'domReady', '1-3s', 50],
        ]);
        const { total, rows } = summariseBootPhases(samples, { page: 'calendar' });
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map(r => r.metric), BOOT_PHASES.map(p => p.metric), 'boot order, always');
        assert.equal(rows[0].pctOver500, 10);
        assert.equal(rows[1].pctOver500, 40);
        assert.equal(rows[2].pctOver500, 0);
        assert.equal(total, 100, 'the section total is loads, not phase-samples summed thrice');
        // The bands are PHASE-scaled: green is lt500ms ALONE (the load bands put 500ms-1s in green
        // too, which made the stated 40% disagree with a bar showing 15% non-green — the v20.19
        // defect class, mirrored). The number must be the complement of the bar's green.
        assert.equal(rows[1].pctQuick, 60, 'green = under ½s only');
        assert.equal(rows[1].pctOk, 30, 'amber = ½–1s');
        assert.equal(rows[1].pctSlow, 10, 'red = everything over 1s');
        assert.equal(rows[1].pctOver500, 100 - rows[1].pctQuick, 'the stated % is the bar’s non-green share');
        // The label set is the staff-facing one — jargon staying out of the card is a contract here,
        // not a style preference (the card states its reader is non-technical).
        for (const r of rows) assert.doesNotMatch(r.label + r.sub, /SDK|service worker|worker|DCL/i);
    });

    test('a phase nobody has recorded yet is omitted — no scaffolding rows', () => {
        const { rows } = summariseBootPhases(samplesFrom([['calendar', 'swBoot', 'lt500ms', 5]]), { page: 'calendar' });
        assert.deepEqual(rows.map(r => r.metric), ['swBoot'],
            'pre-v20.33 clients record no phases; the card must not render empty rows for them');
    });

    test('empty samples → no rows, zero total', () => {
        assert.deepEqual(summariseBootPhases({}, { page: 'calendar' }), { total: 0, rows: [] });
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

// ── summariseStartMilestones — "How far the start had got" ─────────────────────────────────────
//
// The rows are CUMULATIVE, which is the whole reason the block is readable: a reader compares
// neighbours instead of subtracting. Two things therefore have to hold and neither is visible in
// the output — ladder ORDER, and that a rung with no data is ABSENT rather than zero. A zero row
// in a cumulative ladder reads as "nothing ever got this far", which is a much stronger claim than
// "nobody has reported it yet", and it is the claim a partly-rolled-out release would make.

const mk = (page, metric, bucket, n) => [perfSampleKey({ version: 'v21.29', page, metric, bucket, mode: 'standalone', conn: '4g' }), n];

describe('summariseStartMilestones', () => {
    test('rows come back in LADDER order, not sample order', () => {
        // Fed deliberately backwards. Insertion order would put "Confirmed" above "Signed in",
        // which inverts the one relationship the block asks the reader to use.
        const samples = Object.fromEntries([
            mk('calendar', 'rosterLive', '1-3s', 5),
            mk('calendar', 'ready', 'lt500ms', 5),
            mk('calendar', 'access', 'lt500ms', 5),
            mk('calendar', 'authBoot', 'lt500ms', 5),
        ]);
        const { rows } = summariseStartMilestones(samples, { page: 'calendar' });
        assert.deepEqual(rows.map(r => r.metric), START_MILESTONES.map(m => m.metric));
    });

    test('a rung nobody has reported is ABSENT, not a zero row', () => {
        const samples = Object.fromEntries([mk('calendar', 'authBoot', 'lt500ms', 3)]);
        const { rows } = summariseStartMilestones(samples, { page: 'calendar' });
        assert.deepEqual(rows.map(r => r.metric), ['authBoot']);
    });

    test('another page\'s samples never leak in', () => {
        const samples = Object.fromEntries([
            mk('calendar', 'access', 'lt500ms', 4),
            mk('paycalc',  'access', 'over8s', 90),
        ]);
        const { rows } = summariseStartMilestones(samples, { page: 'calendar' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].total, 4, 'the other page\'s 90 slow loads must not be counted here');
        assert.equal(rows[0].pctQuick, 100);
    });

    test('bands are the CARD\'S bands, not the boot-phase bands', () => {
        // The distinction matters: boot phases call 500ms slow, the card calls under a second
        // quick. A milestone landing at 700ms is quick here and would be amber there.
        const samples = Object.fromEntries([mk('calendar', 'ready', '500ms-1s', 10)]);
        const { rows } = summariseStartMilestones(samples, { page: 'calendar' });
        assert.equal(rows[0].pctQuick, 100);
    });

    test('an unknown bucket is dropped rather than counted into a band', () => {
        const samples = Object.fromEntries([
            mk('calendar', 'ready', 'lt500ms', 2),
            mk('calendar', 'ready', 'nonsense', 99),
        ]);
        const { rows } = summariseStartMilestones(samples, { page: 'calendar' });
        assert.equal(rows[0].total, 2);
    });

    test('every milestone has a label and a distinct id', () => {
        const ids = START_MILESTONES.map(m => m.metric);
        assert.equal(new Set(ids).size, ids.length, 'duplicate milestone ids would merge two rungs');
        for (const m of START_MILESTONES) {
            assert.ok(m.label && m.label.length <= 13, `${m.metric}: label must fit the row column`);
            assert.ok(m.sub && m.sub.length > 0, `${m.metric}: the sub carries what the label gives up`);
        }
    });
});

// ── summariseReadySource — what put the shifts on screen ────────────────────────────────────────
//
// This block exists to decide ONE thing: `LATENCY_PLAN.md` Phase 2 narrows the Calendar's
// authoritative Firestore read, and a load the local cache already served never touches the network
// on that path. So "how many loads waited for the read?" is the whole question, and the card could
// not answer it.
//
// The dangerous misreading is treating the two rows as a PARTITION of "Shifts shown". They are not:
// a page that cannot tell its source reports `ready` alone, so the remainder is real and invisible.
// A reader who assumes they add up over-states whichever row they are looking at.
describe('summariseReadySource', () => {
    test('the two sources are separated, and neither absorbs the other', () => {
        const samples = Object.fromEntries([
            mk('calendar', 'readyCached', 'lt500ms', 40),
            mk('calendar', 'readyFetched', '1-3s', 10),
        ]);
        const { rows } = summariseReadySource(samples, { page: 'calendar' });
        assert.deepEqual(rows.map(r => r.metric), READY_SOURCES.map(m => m.metric));
        assert.equal(rows[0].total, 40);
        assert.equal(rows[1].total, 10);
        assert.equal(rows[0].pctOver1s, 0, 'a cache hit under half a second is not over one second');
        assert.equal(rows[1].pctOver1s, 100);
    });

    test('it does NOT count plain `ready`, which is the row it splits', () => {
        // Folding `ready` in would double-count every attributed load and make the cache share look
        // like whatever fraction of the population happened to report a source.
        const samples = Object.fromEntries([
            mk('calendar', 'ready', 'lt500ms', 900),
            mk('calendar', 'readyCached', 'lt500ms', 40),
        ]);
        const { rows } = summariseReadySource(samples, { page: 'calendar' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].total, 40);
    });

    test('a source nobody has reported is ABSENT, not a zero row', () => {
        // Same rule as the ladder, and for a stronger reason here: a zero against "From the server"
        // reads as "no load has ever waited for the read", which is the Phase 2 answer itself. A
        // partly-rolled-out release would be making that claim on no evidence at all.
        const samples = Object.fromEntries([mk('calendar', 'readyCached', 'lt500ms', 12)]);
        const { rows } = summariseReadySource(samples, { page: 'calendar' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].metric, 'readyCached');
    });

    test('another page’s samples are not mixed in', () => {
        const samples = Object.fromEntries([
            mk('calendar', 'readyCached', 'lt500ms', 5),
            mk('paycalc', 'readyCached', '3s+', 500),
        ]);
        const { rows } = summariseReadySource(samples, { page: 'calendar' });
        assert.equal(rows[0].total, 5);
    });
});
