// Unit tests for perf-stats.js — the pure latency maths (Project 0 instrumentation).
// Run with: node --test perf-stats.test.mjs   (part of test:hygiene)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { THIN_SAMPLE, PERF_BUCKETS, bucketDuration, perfSampleKey, parsePerfSampleKey, summarisePerf, summarisePerfBy, PERF_DIMENSIONS, perfVerdict, loginDurationBucket, LOGIN_MAX_MS, EARLY_ROSTER, summariseEarlyRoster, EARLY_ROSTER_FROM, earlyRosterShareLabel, shareLabel, compactPct, UPDATE_OPENS, UPDATE_OPENS_FROM, summariseUpdateOpens, CLEAN_TIMINGS_FROM, shareMeasuredBefore, perfRecordFullness, createPerfBatcher } from './perf-stats.js';

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

    test('a page id that is not a page-id TOKEN is dropped — sample keys are writable by any session', () => {
        // Any authenticated session can write an analytics counter, and the busiest page's id was
        // rendered as HTML on the admin's Operations page (Sep 2026 review). A real page id is a
        // fixed lower-case token; markup, spaces and capitals are nobody's page.
        const evil = '<a href="https://evil.example/login">Session expired</a>';
        const s = samplesFrom([['calendar', 'domReady', 'lt500ms', 5], ['guide-staff', 'domReady', 'lt500ms', 1]]);
        s[`24_28|${evil}|domReady|lt500ms|pwa|4g`] = 99999;
        s['24_28|Calendar|domReady|lt500ms|pwa|4g'] = 7;
        const r = summarisePerf(s, { metric: 'domReady' });
        assert.deepEqual(r.byPage.map(p => p.page), ['calendar', 'guide-staff']);
        assert.equal(r.total, 6);
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
    test('empty → none', () => {
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

    test('"mostly quick" only when quick IS the larger band (v24.85)', () => {
        // The month that reported it: 2 quick, 19 a moment, 3 slow — 24 sign-ins, 8% within a second.
        // One sentence for the whole ok band read "Signing in mostly feels quick" beside that 8%.
        const login = (/** @type {number} */ q, /** @type {number} */ m, /** @type {number} */ sl) => perfVerdict(summarisePerf(samplesFrom([
            ['login', 'loginTotal', 'lt500ms', q], ['login', 'loginTotal', '1-3s', m], ['login', 'loginTotal', '3-8s', sl]]), { metric: 'loginTotal' }).overall, 'login');
        const real = login(2, 19, 3);
        assert.equal(real.tone, 'ok', 'still amber — the thresholds are unchanged');
        assert.equal(real.text, 'Sign-ins most often take a moment, and some take longer.');
        assert.doesNotMatch(real.text, /quick/);
        // No tail about slower ones when none were slow.
        assert.equal(login(6, 14, 0).text, 'Sign-ins most often take a moment.');
        // Quick a MAJORITY (v24.96 — a tie is not one): the sentence it always had.
        assert.equal(login(12, 8, 0).text, 'Signing in mostly feels quick, with some slower sign-ins.');
        assert.equal(login(10, 10, 0).text, 'Sign-ins most often take a moment.');
        // Every journey has both halves, so none borrows another's words.
        for (const kind of /** @type {const} */ (['pages', 'login', 'fcp', 'ready'])) {
            const r = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 2], ['admin', 'domReady', '1-3s', 19], ['admin', 'domReady', '3-8s', 3]]));
            const v = perfVerdict(r.overall, kind);
            assert.match(v.text, /most often takes? a moment/, kind);
            assert.ok(!/undefined/.test(v.text), kind);
        }
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

const mk = (page, metric, bucket, n) => [perfSampleKey({ version: 'v21.29', page, metric, bucket, mode: 'standalone', conn: '4g' }), n];
/** The same, at a chosen version — the summaries that read only from one release on need it. */
const mkAt = (version, page, metric, bucket, n) => [perfSampleKey({ version, page, metric, bucket, mode: 'standalone', conn: '4g' }), n];

describe('summariseEarlyRoster', () => {
    test('the stored copy\'s paint is its own row, on the card\'s usual bands', () => {
        const samples = Object.fromEntries([
            mk('calendar', 'rosterSnapshot', 'lt500ms', 30),
            mk('calendar', 'rosterSnapshot', '500ms-1s', 6),
            mk('calendar', 'rosterSnapshot', '1-3s', 4),
        ]);
        const { rows } = summariseEarlyRoster(samples, { page: 'calendar' });
        assert.deepEqual(rows.map(r => r.metric), EARLY_ROSTER.map(m => m.metric));
        assert.equal(rows[0].total, 40);
        assert.equal(rows[0].label, 'Own roster');
        assert.equal(rows[0].pctOver1s, 10, 'only the 1–3s four are over a second');
    });

    test('it counts nothing but the paint — not `ready`, not another page', () => {
        const samples = Object.fromEntries([
            mk('calendar', 'ready', 'lt500ms', 900),
            mk('calendar', 'authBoot', '1-3s', 400),
            mk('paycalc', 'rosterSnapshot', '3-8s', 50),
        ]);
        assert.deepEqual(summariseEarlyRoster(samples, { page: 'calendar' }).rows, [],
            'no paint reported ⇒ no row: a zero here would claim the copy never helped');
    });

});

// ── earlyRosterShareLabel — how often the copy had the chance (v24.89, the 48-hour review) ───────
//
// The share was divided by every version's `ready`, so in the month the metric shipped the opens of
// versions that CANNOT report a copy sat under it. This is the reviewer's case, to the percent.
describe('earlyRosterShareLabel', () => {
    const at = (version, metric, n, page = 'calendar') =>
        [perfSampleKey({ version, page, metric, bucket: 'lt500ms', mode: 'standalone', conn: '4g' }), n];
    const label = (rows) => earlyRosterShareLabel(Object.fromEntries(rows), { page: 'calendar' });

    test('only versions that can report a copy are divided — 60%, not the 19% mixed versions printed', () => {
        assert.equal(label([
            at('v24.84', 'ready', 1300),          // three weeks before the metric existed
            at('v24.85', 'ready', 600),
            at('v24.85', 'rosterSnapshot', 360),
        ]), '60%');
        assert.equal(Math.round(360 / 1900 * 100), 19, 'the old divisor — what the card used to print');
    });

    test('a version counts by its number, written with or without a v, and a later major counts', () => {
        assert.equal(label([
            at('24.86', 'ready', 100), at('24.86', 'rosterSnapshot', 50),
            at('v25.01', 'ready', 100), at('v25.01', 'rosterSnapshot', 50),
            at('v24.9', 'ready', 800),            // reads as 24.9, which is BELOW 24.85 — not 24.90
            at('nonsense', 'ready', 800),         // unreadable ⇒ below every release, so not divided
        ]), '50%');
        assert.equal(EARLY_ROSTER_FROM, '24.85', 'the release that began reporting the copy');
    });

    test('nothing to state ⇒ null: no copy shown, no counted opens, or more copies than opens', () => {
        assert.equal(label([]), null);
        assert.equal(label([at('v24.85', 'ready', 400)]), null,
            'no paint reported is not 0% — the block itself does not render');
        assert.equal(label([at('v24.84', 'ready', 400), at('v24.85', 'rosterSnapshot', 40)]), null,
            'a copy but no counted opens to divide by');
        assert.equal(label([at('v24.85', 'ready', 250), at('v24.85', 'rosterSnapshot', 251)]), null,
            'judged on the RAW counts: 251 of 250 rounded to "100%" under the old check');
    });

    test('a share that rounds to nothing or to everything says so', () => {
        assert.equal(label([at('v24.85', 'ready', 400), at('v24.85', 'rosterSnapshot', 1)]), 'under 1%',
            'it printed "0%" beside a row of 1 open');
        assert.equal(label([at('v24.85', 'ready', 400), at('v24.85', 'rosterSnapshot', 399)]), 'over 99%');
        assert.equal(label([at('v24.85', 'ready', 400), at('v24.85', 'rosterSnapshot', 400)]), '100%');
    });

    test('another page\'s opens are not divided', () => {
        assert.equal(label([
            at('v24.85', 'ready', 100), at('v24.85', 'rosterSnapshot', 25),
            at('v24.85', 'ready', 900, 'paycalc'),
        ]), '25%');
    });

    test('below THIN_SAMPLE counted opens there is no share, as the rows beside it say "(few)" (v24.96)', () => {
        assert.equal(label([at('v24.90', 'ready', 3), at('v24.90', 'rosterSnapshot', 1)]), null,
            '3 opens, 1 copy painted: "33%" is not a finding');
        assert.equal(label([at('v24.90', 'ready', THIN_SAMPLE), at('v24.90', 'rosterSnapshot', 12)]), '60%');
    });
});

describe('summariseUpdateOpens', () => {
    // From UPDATE_OPENS_FROM `readyUpdate` is the wait a member had after a release reload; older
    // versions timed the background load itself, so the block reads only from that version on.
    const AT = 'v' + UPDATE_OPENS_FROM;

    test('it counts only the update opens, and does NOT absorb `ready`', () => {
        const samples = Object.fromEntries([
            mkAt(AT, 'calendar', 'ready', 'lt500ms', 900),
            mkAt(AT, 'calendar', 'readyUpdate', '1-3s', 30),
        ]);
        const { rows } = summariseUpdateOpens(samples, { page: 'calendar' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].metric, 'readyUpdate');
        assert.equal(rows[0].total, 30, 'the 900 ordinary opens are not this row');
    });

    test('older versions are not counted — they timed a load nobody was waiting for', () => {
        const samples = Object.fromEntries([
            mkAt('v24.97', 'calendar', 'readyUpdate', '3-8s', 400),
            mkAt(AT, 'calendar', 'readyUpdate', 'lt500ms', 30),
        ]);
        const { rows } = summariseUpdateOpens(samples, { page: 'calendar' });
        assert.equal(rows[0].total, 30);
        assert.equal(rows[0].pctSlow, 0, 'the 400 slow background loads are not this row');
        assert.equal(UPDATE_OPENS_FROM, CLEAN_TIMINGS_FROM, 'the same release changed both');
    });

    test('no update open reported ⇒ NO row, never a zero', () => {
        // A zero here would state "no release has ever reloaded anybody", which is the finding
        // itself — asserted on an empty collection.
        const samples = Object.fromEntries([mkAt(AT, 'calendar', 'ready', 'lt500ms', 500)]);
        assert.equal(summariseUpdateOpens(samples, { page: 'calendar' }).rows.length, 0);
    });

    test('another page’s update opens are not mixed in', () => {
        const samples = Object.fromEntries([
            mkAt(AT, 'calendar', 'readyUpdate', 'lt500ms', 4),
            mkAt(AT, 'paycalc', 'readyUpdate', '3-8s', 400),
        ]);
        assert.equal(summariseUpdateOpens(samples, { page: 'calendar' }).rows[0].total, 4);
    });

    test('the row set is the one the card renders, and each row says what it times', () => {
        assert.deepEqual(UPDATE_OPENS.map(m => m.metric), ['readyUpdate']);
        for (const m of [...UPDATE_OPENS, ...EARLY_ROSTER]) assert.ok(m.sub.length > 20, `${m.metric} explains itself`);
    });
});

// ── One write per page open, not fifteen (review F5) ───────────────────────────────────────────
// Every sample used to be its own setDoc to analytics/perf_<month>, and a Calendar open makes a dozen
// or more of them — all queued on Firestore's one operation queue beside the roster's own reads.
describe('createPerfBatcher — samples coalesce into one merged write', () => {
    /** @returns {{ writes: Array<[string, Record<string, number>]>, arms: Function[], b: ReturnType<typeof createPerfBatcher> }} */
    function harness() {
        /** @type {Array<[string, Record<string, number>]>} */ const writes = [];
        /** @type {Function[]} */ const arms = [];
        const b = createPerfBatcher((month, counts) => { writes.push([month, counts]); }, (flush) => { arms.push(flush); });
        return { writes, arms, b };
    }

    test('nothing is written until the armed flush runs — then ONE write carries every sample', () => {
        const { writes, arms, b } = harness();
        b.add('2026-09', 'k1'); b.add('2026-09', 'k2'); b.add('2026-09', 'k3');
        assert.equal(writes.length, 0, 'a sample must not reach Firestore on its own');
        assert.equal(arms.length, 1, 'one flush armed for the whole burst');
        arms[0]();
        assert.deepEqual(writes, [['2026-09', { k1: 1, k2: 1, k3: 1 }]]);
    });

    test('a repeated key is counted, not dropped', () => {
        const { writes, arms, b } = harness();
        b.add('2026-09', 'k1'); b.add('2026-09', 'k1');
        arms[0]();
        assert.deepEqual(writes, [['2026-09', { k1: 2 }]]);
    });

    test('an explicit flush (pagehide) drains at once, and the armed one then writes nothing twice', () => {
        const { writes, arms, b } = harness();
        b.add('2026-09', 'k1');
        b.flush();
        arms[0]();
        assert.deepEqual(writes, [['2026-09', { k1: 1 }]]);
    });

    test('a sample after a flush arms a fresh batch', () => {
        const { writes, arms, b } = harness();
        b.add('2026-09', 'k1'); arms[0]();
        b.add('2026-09', 'k2');
        assert.equal(arms.length, 2);
        arms[1]();
        assert.deepEqual(writes, [['2026-09', { k1: 1 }], ['2026-09', { k2: 1 }]]);
    });

    test('a batch straddling month-end goes to each month\'s own document', () => {
        const { writes, arms, b } = harness();
        b.add('2026-09', 'k1'); b.add('2026-10', 'k2');
        arms[0]();
        assert.deepEqual(writes, [['2026-09', { k1: 1 }], ['2026-10', { k2: 1 }]]);
    });
});

describe('perfVerdict — "mostly quick" is a MAJORITY claim (v24.96, the 72-hour review)', () => {
    // v24.85 chose the sentence by the larger band. At 41% quick / 40% a moment / 19% slow — 59% over
    // a second — it still read "mostly feels quick"; at 99 / 100 / 1 the rounded percentages tied
    // and the comparison went to quick. The rule is raw counts and a majority.
    const of = (/** @type {number} */ quick, /** @type {number} */ ok, /** @type {number} */ slow) => {
        const total = quick + ok + slow, pct = (/** @type {number} */ n) => Math.round((n / total) * 100);
        return { quick, ok, slow, total, pctQuick: pct(quick), pctOk: pct(ok), pctSlow: pct(slow) };
    };
    test('a plurality of quick opens is not "mostly quick"', () => {
        // Since Oct 2026 a quick PLURALITY says exactly that (`mixed`); before, it fell to "most often
        // take a moment", which was false — see the block on the mixed sentence below.
        assert.match(perfVerdict(of(41, 40, 19), 'login').text, /Under half of sign-ins are quick/, '41% quick, 59% over a second');
        assert.match(perfVerdict(of(99, 100, 1), 'login').text, /most often/, 'the rounded percentages tie; the counts do not');
        assert.match(perfVerdict(of(45, 36, 19), 'login').text, /Under half/);
    });
    test('a majority is', () => {
        assert.match(perfVerdict(of(60, 30, 10), 'login').text, /mostly feels quick/);
        assert.match(perfVerdict(of(50, 40, 10), 'login').text, /mostly feels quick/, 'exactly half, and the larger band');
        assert.match(perfVerdict(of(50, 50, 0), 'login').text, /most often/, 'half, but not the larger band');
    });
});

// ════ THE APP SPEED REVIEW (Oct 2026) — the maths a reader was shown wrong ════════════════════════

describe('the three percentages always add to 100 (largest remainder)', () => {
    const bands = (q, o, sl) => summarisePerf(samplesFrom([
        ['admin', 'domReady', 'lt500ms', q], ['admin', 'domReady', '1-3s', o], ['admin', 'domReady', '3-8s', sl]])).overall;

    test('an even three-way split prints 34 + 33 + 33, not 34 + 34 + 33', () => {
        const r = bands(1, 1, 1);
        assert.deepEqual([r.pctQuick, r.pctOk, r.pctSlow], [34, 33, 33], 'the spare point goes to the faster band on a tie');
    });

    test('every split of up to 60 opens sums to exactly 100, each band within a point of its share', () => {
        for (let q = 0; q <= 20; q++) for (let o = 0; o <= 20; o++) for (let sl = 0; sl <= 20; sl++) {
            const total = q + o + sl;
            if (!total) continue;
            const r = bands(q, o, sl);
            assert.equal(r.pctQuick + r.pctOk + r.pctSlow, 100, `${q}/${o}/${sl}`);
            for (const [pct, n] of [[r.pctQuick, q], [r.pctOk, o], [r.pctSlow, sl]]) {
                assert.ok(Math.abs(pct - (n / total) * 100) < 1, `${q}/${o}/${sl}: ${pct} for ${n}`);
            }
        }
    });

    test('nothing to divide gives zeros, not NaN', () => {
        const r = bands(0, 0, 0);
        assert.deepEqual([r.total, r.pctQuick, r.pctOk, r.pctSlow], [0, 0, 0, 0]);
    });
});

describe('the share over a second is the complement of the quick share shown', () => {
    test('two blocks can no longer print 87% and 88% for one split', () => {
        // 87.5% quick: rounded on its own the over-a-second share was 13, beside a quick 88 — 101.
        const samples = Object.fromEntries([
            mkAt('v' + UPDATE_OPENS_FROM, 'calendar', 'readyUpdate', 'lt500ms', 175),
            mkAt('v' + UPDATE_OPENS_FROM, 'calendar', 'readyUpdate', '1-3s', 25),
        ]);
        const [row] = summariseUpdateOpens(samples, { page: 'calendar' }).rows;
        assert.equal(row.pctQuick, 88);
        assert.equal(row.pctOver1s, 12, 'derived from the shown quick share, not rounded separately');
        assert.equal(row.pctQuick + row.pctOver1s, 100);
        assert.equal(row.over1s, 25, 'the count behind it');
    });
});

describe('compactPct — a share never rounds to a lie', () => {
    test('a real share that rounds to nothing reads <1%, not 0%', () => {
        assert.equal(compactPct(0, 1, 400), '<1%');
    });
    test('one short of the whole reads >99%, not 100%', () => {
        assert.equal(compactPct(100, 399, 400), '>99%');
    });
    test('a true zero, a true whole and everything between read as themselves', () => {
        assert.equal(compactPct(0, 0, 400), '0%');
        assert.equal(compactPct(100, 400, 400), '100%');
        assert.equal(compactPct(46, 184, 400), '46%');
    });
});

describe('shareLabel', () => {
    test('words at both ends, a whole percent between', () => {
        assert.equal(shareLabel(1, 400), 'under 1%');
        assert.equal(shareLabel(399, 400), 'over 99%');
        assert.equal(shareLabel(400, 400), '100%');
        assert.equal(shareLabel(3, 5), '60%');
    });
    test('nothing to state ⇒ null — and a part larger than its whole is judged on the raw counts', () => {
        assert.equal(shareLabel(0, 400), null);
        assert.equal(shareLabel(5, 0), null);
        assert.equal(shareLabel(251, 250), null, 'it rounded to "100%" under the old check');
    });
});

describe('shareMeasuredBefore — the month the measurement changed', () => {
    const at = (version, metric, n, page = 'calendar') =>
        [perfSampleKey({ version, page, metric, bucket: 'lt500ms', mode: 'browser', conn: '4g' }), n];

    test('the share of code-loaded opens timed by versions before the change', () => {
        const samples = Object.fromEntries([at('v24.97', 'domReady', 300), at('v24.98', 'domReady', 60), at('v24.99', 'domReady', 40, 'paycalc')]);
        assert.equal(shareMeasuredBefore(samples, '24.98'), 0.75);
        assert.equal(shareMeasuredBefore(samples), 0.75, 'CLEAN_TIMINGS_FROM by default');
        assert.equal(CLEAN_TIMINGS_FROM, '24.98', 'the release that stopped counting unwatched loads and typing');
    });

    test('only `domReady` is counted — every watched open records it, on every page', () => {
        const samples = Object.fromEntries([at('v24.97', 'ready', 900), at('v24.97', 'fcp', 900), at('v24.98', 'domReady', 10)]);
        assert.equal(shareMeasuredBefore(samples, '24.98'), 0);
    });

    test('nothing to divide gives 0', () => {
        assert.equal(shareMeasuredBefore({}, '24.98'), 0);
    });
});

describe('perfRecordFullness — how close the month\'s record is to Firestore\'s limits', () => {
    test('an empty record is all but empty', () => {
        assert.ok(perfRecordFullness({}) < 0.001);
    });

    test('long keys reach the byte limit first', () => {
        // 100-character keys cost 109 bytes each (name + 1, count 8): 9,619 of them and the
        // document's own 128 come to just over 1 MiB, at under half the field limit.
        const long = (i) => String(i).padStart(100, 'k');
        const n = 9619;
        const samples = Object.fromEntries(Array.from({ length: n }, (_, i) => [long(i), 1]));
        assert.ok(perfRecordFullness(samples) >= 1, 'full by bytes');
        const fewer = Object.fromEntries(Array.from({ length: n - 2 }, (_, i) => [long(i), 1]));
        assert.ok(perfRecordFullness(fewer) < 1, 'two keys fewer is not');
    });

    test('short keys reach the field limit first — every map entry is a field', () => {
        const samples = Object.fromEntries(Array.from({ length: 19998 }, (_, i) => [`k${i}`, 1]));
        assert.equal(perfRecordFullness(samples), 1, '19,998 entries + `month` + the map itself = 20,000 fields');
    });

    test('it grows with every key, as every release adds keys', () => {
        const one = { [perfSampleKey({ version: '24.98', page: 'calendar', metric: 'ready', bucket: 'lt500ms', mode: 'standalone', conn: '4g' })]: 3 };
        const two = { ...one, [perfSampleKey({ version: '24.99', page: 'calendar', metric: 'ready', bucket: 'lt500ms', mode: 'standalone', conn: '4g' })]: 1 };
        assert.ok(perfRecordFullness(two) > perfRecordFullness(one));
    });
});

describe('a stored count must be a count — sample values are written by any signed-in session', () => {
    const key = (bucket, metric = 'domReady') =>
        perfSampleKey({ version: '24.98', page: 'calendar', metric, bucket, mode: 'browser', conn: '4g' });

    test('true, "7", a fraction, a negative and an absurd number are not opens', () => {
        const samples = { [key('lt500ms')]: true, [key('500ms-1s')]: '7', [key('1-3s')]: 2.5, [key('3-8s')]: -3, [key('over8s')]: 1e308 };
        assert.equal(summarisePerf(/** @type {any} */ (samples)).total, 0);
        assert.equal(summarisePerfBy(/** @type {any} */ (samples), { page: 'calendar', dimension: 'mode' }).total, 0);
        assert.equal(shareMeasuredBefore(/** @type {any} */ (samples)), 0);
    });

    test('two absurd values can no longer sum to "∞ page opens"', () => {
        const samples = { [key('lt500ms')]: 1e308, [key('1-3s')]: 1e308 };
        assert.ok(Number.isFinite(summarisePerf(samples).total));
        assert.equal(summarisePerf(samples).total, 0);
    });

    test('a real count still counts', () => {
        assert.equal(summarisePerf({ [key('lt500ms')]: 41, [key('1-3s')]: 9 }).total, 50);
    });
});

describe('summarisePerfBy — no version row crosses the change in how pages are timed', () => {
    const at = (version, bucket, n) =>
        [perfSampleKey({ version, page: 'calendar', metric: 'ready', bucket, mode: 'browser', conn: '4g' }), n];
    const rows = (entries, splitAt) => summarisePerfBy(Object.fromEntries(entries),
        { page: 'calendar', metric: 'ready', dimension: 'version', minSamples: 20, splitAt }).rows;

    test('a bucket closes at the split even when thin, and the remainder is never merged across it', () => {
        const r = rows([
            at('24.99', 'lt500ms', 5), at('24.98', '1-3s', 10),          // after: 15, thin
            at('24.97', 'lt500ms', 100), at('24.96', '3-8s', 100), at('24.95', 'lt500ms', 3),
        ], '24.98');
        assert.deepEqual(r.map(x => [x.label, x.total, x.afterSplit]), [
            ['v24.98–v24.99', 15, true],
            ['v24.97', 100, false],
            ['v24.95–v24.96', 103, false],                                 // the thin remainder merged, on its own side
        ]);
    });

    test('a thin remainder on the near side of the split stays its own row', () => {
        const r = rows([at('24.99', 'lt500ms', 100), at('24.97', 'lt500ms', 4)], '24.98');
        assert.deepEqual(r.map(x => [x.label, x.total]), [['v24.99', 100], ['v24.97', 4]]);
    });

    test('without a split nothing changes, and no row claims a side', () => {
        const r = rows([at('24.99', 'lt500ms', 5), at('24.98', '1-3s', 10), at('24.97', 'lt500ms', 100)], '');
        assert.deepEqual(r.map(x => [x.label, x.total]), [['v24.97–v24.99', 115]]);
        assert.ok(r.every(x => !('afterSplit' in x)));
    });
});

describe('perfVerdict — green needs the slow tail small too', () => {
    const of = (quick, ok, slow) => summarisePerf(samplesFrom([
        ['admin', 'domReady', 'lt500ms', quick], ['admin', 'domReady', '1-3s', ok], ['admin', 'domReady', '3-8s', slow]])).overall;

    test('81 / 0 / 19 is not green — it was, one point from 80 / 0 / 20 being red', () => {
        assert.equal(perfVerdict(of(81, 0, 19)).tone, 'ok');
        assert.equal(perfVerdict(of(80, 0, 20)).tone, 'bad');
    });
    test('under 10% slow with 80% quick still is', () => {
        assert.equal(perfVerdict(of(85, 6, 9)).tone, 'good');
        assert.equal(perfVerdict(of(85, 5, 10)).tone, 'ok', 'at 10% slow it is not');
    });
});

describe('perfVerdict — quick the largest band but under half has its own sentence', () => {
    const login = (quick, ok, slow) => perfVerdict(summarisePerf(samplesFrom([
        ['login', 'loginTotal', 'lt500ms', quick], ['login', 'loginTotal', '1-3s', ok], ['login', 'loginTotal', '3-8s', slow]]),
        { metric: 'loginTotal' }).overall, 'login');

    test('the review\'s pair: identical percentages, one sentence', () => {
        // Both show 50% · 40% · 10%. The first read "most often take a moment" — false: quick was
        // the largest band — and the second "mostly feels quick".
        const first = login(124, 100, 26);
        assert.equal(first.text, 'Under half of sign-ins are quick; the rest take a moment or longer.');
        assert.doesNotMatch(first.text, /most often/);
        assert.equal(login(50, 40, 10).text, 'Signing in mostly feels quick, with some slower sign-ins.');
    });

    test('every journey has the sentence, so none borrows another\'s', () => {
        const overall = summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 45], ['admin', 'domReady', '1-3s', 40], ['admin', 'domReady', '3-8s', 15]])).overall;
        for (const kind of /** @type {const} */ (['pages', 'login', 'fcp', 'ready'])) {
            const v = perfVerdict(overall, kind);
            assert.match(v.text, /under half/i, kind);
            assert.ok(!/undefined/.test(v.text), kind);
        }
    });
});

describe('perfVerdict — the empty and thin sentences name no month', () => {
    // The headline renders under "Last month" too, where "not enough data yet — this builds up as
    // staff use the app" described a month that was over.
    test('none and thin are true of any period', () => {
        for (const kind of /** @type {const} */ (['pages', 'login', 'fcp', 'ready'])) {
            const none = perfVerdict(summarisePerf({}).overall, kind).text;
            const thin = perfVerdict(summarisePerf(samplesFrom([['admin', 'domReady', 'lt500ms', 3]])).overall, kind).text;
            for (const t of [none, thin]) assert.doesNotMatch(t, /\byet\b|builds up|this month/i, `${kind}: ${t}`);
        }
    });
});

describe('a version label never doubles its "v"', () => {
    test('a key carrying a leading v prints once, as the dot-swapped form does', () => {
        const at = (version, n) => [perfSampleKey({ version, page: 'calendar', metric: 'ready', bucket: 'lt500ms', mode: 'browser', conn: '4g' }), n];
        const rows = summarisePerfBy(Object.fromEntries([at('v24.98', 30), at('24.97', 30)]),
            { page: 'calendar', metric: 'ready', dimension: 'version', minSamples: 20 }).rows;
        assert.deepEqual(rows.map(r => r.label), ['v24.98', 'v24.97'], 'it printed "vv24.98"');
    });
});

describe('the version constants name a release the app has reached', () => {
    // CLEAN_TIMINGS_FROM and UPDATE_OPENS_FROM must be the release that ships the recorder change. One
    // AHEAD of the app would file every current sample as timed "the older way" and hide the wait
    // after a release entirely. (The other mistake — a release shipped under a later number than
    // these say — no test can see: re-check both when re-bumping a branch against main.)
    test('neither is ahead of APP_VERSION', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('./roster-data.js', import.meta.url), 'utf8');
        const m = /APP_VERSION = '(\d+)\.(\d+)'/.exec(src);
        assert.ok(m, 'APP_VERSION found');
        const n = (/** @type {string} */ v) => { const [a, b] = v.split('.').map(Number); return a * 100 + b; };
        const app = Number(m[1]) * 100 + Number(m[2]);
        assert.ok(n(CLEAN_TIMINGS_FROM) <= app, `CLEAN_TIMINGS_FROM ${CLEAN_TIMINGS_FROM} is ahead of the app`);
        assert.ok(n(UPDATE_OPENS_FROM) <= app, `UPDATE_OPENS_FROM ${UPDATE_OPENS_FROM} is ahead of the app`);
    });
});
