// @ts-nocheck
/**
 * operations-legacy.test.mjs — the Old-format records card's reader and summary (v25.28), run
 * against a fake Firestore. Possible because `operations-legacy.js` takes its handles as arguments.
 *
 * Two promises are pinned here, matching the module header: the queries are the cheap ones it says
 * they are (a COUNT per type on the default index; the records themselves only on request, capped),
 * and "None left" — the answer that gets code deleted — never comes from a count that did not
 * arrive. The wiring, a real page through the e2e stub, is e2e/operations.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyReader, summariseLegacy, legacyRowText, YEARS_CAP, NO_DATE } from './operations-legacy.js';
import { LEGACY_OVERRIDE_TYPES } from './override-utils.js';

/** A recording fake: every query is kept, counts answer per type, getDocs serves `rows`. */
function harness({ counts = {}, rows = [] } = {}) {
    const counted = [];
    const read = [];
    const fs = {
        collection: (_db, path) => ({ path }),
        where: (field, op, value) => ({ where: [field, op, value] }),
        limit: (n) => ({ limit: n }),
        query: (col, ...parts) => ({ col: col.path, parts }),
        getCountFromServer: async (q) => {
            counted.push(q);
            const type = q.parts[0].where[2];
            return { data: () => ({ count: counts[type] }) };
        },
        getDocs: async (q) => {
            read.push(q);
            return { docs: rows.map(r => ({ data: () => r })) };
        },
    };
    return { reader: buildLegacyReader({ db: {}, collectionName: 'overrides', fs }), counted, read };
}

describe('the reads are the cheap ones the card says they are', () => {
    test('one server-side count per old type, on the overrides collection, by type alone', async () => {
        const { reader, counted, read } = harness({ counts: { allocated: 4, overtime: 0, swap: 2 } });
        const got = await reader.countByType();
        assert.deepEqual(got, { allocated: 4, overtime: 0, swap: 2 });
        assert.deepEqual(counted.map(q => q.col), ['overrides', 'overrides', 'overrides']);
        // ONE equality each and nothing else — an equality plus a range on another field would need
        // a composite index this project does not have.
        assert.deepEqual(counted.map(q => q.parts), LEGACY_OVERRIDE_TYPES.map(t => [{ where: ['type', '==', t] }]));
        assert.equal(read.length, 0, 'counting must download nothing');
    });

    test('the server figure is passed through untouched — believing it is the summary’s job', async () => {
        const { reader } = harness({ counts: { allocated: '3' } });
        const got = await reader.countByType();
        assert.equal(got.allocated, '3');
        assert.equal(got.overtime, undefined);
        assert.throws(() => summariseLegacy(got));
    });

    test('the records are read in ONE query over the old types, capped', async () => {
        const { reader, read } = harness({ rows: [
            { type: 'allocated', date: '2025-03-01', memberName: 'X' },
            { type: 'swap', date: 20250301 },
        ] });
        const days = await reader.fetchDays();
        assert.equal(read.length, 1);
        assert.deepEqual(read[0], { col: 'overrides', parts: [
            { where: ['type', 'in', [...LEGACY_OVERRIDE_TYPES]] }, { limit: YEARS_CAP },
        ] });
        // Only what the summary needs comes out; a date that is not a string is kept as "no day".
        assert.deepEqual(days, [{ type: 'allocated', date: '2025-03-01' }, { type: 'swap', date: '' }]);
    });
});

describe('"None left" only from three counts that said so', () => {
    test('three zeros are none left', () => {
        const s = summariseLegacy({ allocated: 0, overtime: 0, swap: 0 });
        assert.equal(s.total, 0);
        assert.deepEqual(s.rows.map(legacyRowText), ['Allocated shift: none', 'Overtime: none', 'Swap: none']);
    });

    for (const [why, value] of [
        ['missing', undefined], ['null', null], ['an object', {}], ['a string', '0'],
        ['negative', -1], ['fractional', 1.5], ['NaN', Number.NaN], ['infinite', Infinity],
    ]) {
        test(`a count that is ${why} is a failure, not a zero`, () => {
            assert.throws(() => summariseLegacy({ allocated: 0, overtime: value, swap: 0 }), /overtime/);
        });
    }

    test('no counts at all is a failure, not a zero', () => {
        assert.throws(() => summariseLegacy({}));
        assert.throws(() => summariseLegacy(null));
    });
});

describe('what each line says', () => {
    const counts = { allocated: 9, overtime: 5, swap: 0 };
    const days = [
        { type: 'allocated', date: '2026-01-04' }, { type: 'allocated', date: '2025-11-30' },
        { type: 'allocated', date: '2025-02-01' }, { type: 'allocated', date: 'garbled' },
        { type: 'overtime', date: '2025-06-07' }, { type: 'shift', date: '2024-01-01' },
    ];

    test('the total, the labels Admin uses, and years oldest first with no-date last', () => {
        const s = summariseLegacy(counts, days);
        assert.equal(s.total, 14);
        assert.deepEqual(s.rows.map(r => r.label), ['Allocated shift', 'Overtime', 'Swap']);
        assert.deepEqual(s.rows[0].years, [
            { year: '2025', count: 2 }, { year: '2026', count: 1 }, { year: NO_DATE, count: 1 },
        ]);
        // A record of another type is never counted under one of these.
        assert.deepEqual(s.rows[1].years, [{ year: '2025', count: 1 }]);
        assert.equal(s.rows[2].years, null, 'a type with none has no years to list');
    });

    test('a line reads as the admin sees it', () => {
        const s = summariseLegacy(counts, days);
        assert.equal(legacyRowText(s.rows[0]), 'Allocated shift: 9 — 2025: 2 · 2026: 1 · no date: 1');
        assert.equal(legacyRowText(s.rows[2]), 'Swap: none');
    });

    test('before the years are read, a line is its count alone', () => {
        const s = summariseLegacy(counts, null);
        assert.equal(s.rows[0].years, null);
        assert.equal(legacyRowText(s.rows[0]), 'Allocated shift: 9');
    });
});
