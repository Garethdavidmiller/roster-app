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
import { buildLegacyReader, summariseLegacy, legacyRowText, YEARS_CAP, NO_DATE, BATCH_LIMIT, planLegacyConversion, conversionWrite, planSignature, previewRowText, setAsideText } from './operations-legacy.js';
import { LEGACY_OVERRIDE_TYPES, buildOverrideWrite } from './override-utils.js';

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

// ── THE CONVERSION (v25.31) ─────────────────────────────────────────────────────────────────────
// The owner's mapping (4 Nov 2026) and the four rules the module header lists. Names here are
// synthetic and the roster is a stub — a Saturday is a rest day, any other day a working one — so
// every outcome below is decided by the rule under test and nothing else.
const ts = (iso) => ({ toMillis: () => Date.parse(iso) });
const MEMBERS = [{ name: 'A. Test' }, { name: 'B. Test' }];
const baseShift = (_m, day) => (day.getDay() === 6 ? 'RD' : '06:20-14:20');
const rec = (id, f) => ({ id, data: { memberName: 'A. Test', value: '06:20-14:20', note: '', source: 'manual', createdAt: ts('2026-03-01T09:00:00Z'), ...f } });
const plan = (sameDay) => planLegacyConversion(sameDay, { adminName: 'G. Admin', members: MEMBERS, baseShift });
const outcome = (p) => Object.fromEntries([
    ...p.convert.map(c => [c.id, `${c.to}:${c.why}`]),
    ...p.remove.map(r => [r.id, 'remove']),
    ...p.skip.map(s => [s.id, `skip:${s.reason}`]),
]);

describe('the owner\'s mapping', () => {
    test('Allocated shift and Swap become Shift; Overtime becomes RDW on a rest day and Shift on a working day', () => {
        const p = plan([
            rec('al', { type: 'allocated', date: '2026-03-03' }),     // Tue
            rec('sw', { type: 'swap',      date: '2026-03-07', memberName: 'B. Test' }),   // Sat — a swap ONTO a rest day stays contracted
            rec('ot1', { type: 'overtime', date: '2026-03-07' }),     // Sat, a rest day
            rec('ot2', { type: 'overtime', date: '2026-03-03', memberName: 'B. Test' }),   // Tue, a working day
        ]);
        assert.deepEqual(outcome(p), { al: 'shift:contracted', sw: 'shift:contracted', ot1: 'rdw:rest-day', ot2: 'shift:working-day' });
    });

    test('any of them on a Sunday becomes RDW — a worked Sunday always is, and they already show as RDW', () => {
        const p = plan(['allocated', 'overtime', 'swap'].map((type, i) =>
            rec(`s${i}`, { type, date: '2026-03-01', memberName: i ? 'B. Test' : 'A. Test', ...(i === 2 ? { memberName: 'C. Test' } : {}) })));
        // C. Test is not on the stub roster, and a Sunday does not need the roster to decide.
        assert.deepEqual(outcome(p), { s0: 'rdw:sunday', s1: 'rdw:sunday', s2: 'rdw:sunday' });
    });

    test('records of today\'s types are never touched', () => {
        const p = plan([rec('x', { type: 'shift', date: '2026-03-03' }), rec('y', { type: 'rdw', date: '2026-03-07' })]);
        assert.deepEqual(outcome(p), {});
    });
});

describe('a rewrite is a new save, so a superseded record is removed, never revived', () => {
    test('an old record a NEWER change has replaced is removed — converting it would make it win again', () => {
        const p = plan([
            rec('old', { type: 'swap', date: '2026-03-03', createdAt: ts('2026-03-01T09:00:00Z') }),
            rec('new', { type: 'shift', date: '2026-03-03', value: '14:00-22:00', createdAt: ts('2026-03-02T09:00:00Z') }),
        ]);
        assert.deepEqual(outcome(p), { old: 'remove' });
    });

    test('between two old records for one day, the older goes and the newer is converted', () => {
        const p = plan([
            rec('a', { type: 'allocated', date: '2026-03-03', createdAt: ts('2026-03-01T09:00:00Z') }),
            rec('b', { type: 'swap', date: '2026-03-03', createdAt: ts('2026-03-02T09:00:00Z') }),
        ]);
        assert.deepEqual(outcome(p), { a: 'remove', b: 'shift:contracted' });
    });

    test('a hand-made old record over a NEWER roster import still shows today, so it is converted', () => {
        const p = plan([
            rec('mine', { type: 'swap', date: '2026-03-03', createdAt: ts('2026-03-01T09:00:00Z') }),
            rec('imp', { type: 'shift', date: '2026-03-03', source: 'roster_import', createdAt: ts('2026-03-05T09:00:00Z') }),
        ]);
        assert.deepEqual(outcome(p), { mine: 'shift:contracted' });
    });

    test('a record for another member, or another day, does not count against it', () => {
        const p = plan([
            rec('mine', { type: 'swap', date: '2026-03-03' }),
            rec('theirs', { type: 'shift', date: '2026-03-03', memberName: 'B. Test', createdAt: ts('2026-03-09T09:00:00Z') }),
            rec('later', { type: 'shift', date: '2026-03-04', createdAt: ts('2026-03-09T09:00:00Z') }),
        ]);
        assert.deepEqual(outcome(p), { mine: 'shift:contracted' });
    });

    test('a tie is left alone and listed — which one shows today is not something the plan can know', () => {
        const p = plan([
            rec('old', { type: 'swap', date: '2026-03-03' }),
            rec('twin', { type: 'shift', date: '2026-03-03' }),
        ]);
        assert.deepEqual(outcome(p), { old: 'skip:tie' });
    });
});

describe('what the rules would refuse is left and listed, never sent', () => {
    for (const [why, f, reason] of [
        ['times not in today\'s bounded format', { value: '6:20-14:20' }, 'bad-times'],
        ['a value that is not a time at all', { value: 'RDW' }, 'bad-times'],
        ['no value', { value: undefined }, 'bad-times'],
        ['a date that is not a real day', { date: '2026-02-30' }, 'bad-date'],
        ['no name', { memberName: '' }, 'bad-name'],
    ]) {
        test(`${why} → skipped, not written`, () => {
            assert.deepEqual(outcome(plan([rec('x', { type: 'swap', date: '2026-03-03', ...f })])), { x: `skip:${reason}` });
        });
    }

    test('a fixed id that does not name its own day is skipped; one that does is fine', () => {
        const p = plan([
            rec('m_2026-03-04_A.%20Test', { type: 'swap', date: '2026-03-03' }),
            rec('m_2026-03-03_B.%20Test', { type: 'swap', date: '2026-03-03', memberName: 'B. Test' }),
        ]);
        assert.deepEqual(outcome(p), { 'm_2026-03-04_A.%20Test': 'skip:bad-id', 'm_2026-03-03_B.%20Test': 'shift:contracted' });
    });

    test('Overtime for somebody no longer on the roster is skipped — its rest days cannot be checked', () => {
        assert.deepEqual(outcome(plan([rec('x', { type: 'overtime', date: '2026-03-03', memberName: 'Z. Gone' })])), { x: 'skip:not-on-roster' });
    });
});

describe('the document a conversion writes', () => {
    const SENTINEL = { serverTimestamp: true };
    const [c] = plan([rec('x', { type: 'overtime', date: '2026-03-07', changedBy: 'A. Test', legacyField: 'from before hasOnly', note: 'old note', replacedType: 'swap' })]).convert;

    test('is buildOverrideWrite\'s output — nothing an old record carried beyond today\'s fields survives', () => {
        const w = conversionWrite(c, SENTINEL);
        assert.deepEqual(w, buildOverrideWrite({
            memberName: 'A. Test', date: '2026-03-07', type: 'rdw', value: '06:20-14:20', note: '',
            source: 'manual', changedBy: 'G. Admin', replacedType: 'swap',
        }, SENTINEL));
        assert.equal('legacyField' in w, false);
        assert.equal(w.note, '', 'the note is written empty, as every save writes it');
    });

    test('changedBy is the admin who converts — the rules accept only the writer\'s own name', () => {
        assert.equal(conversionWrite(c, SENTINEL).changedBy, 'G. Admin');
    });

    test('a roster import stays an import; anything else is a manual save; an unknown replacedType is dropped', () => {
        const p = plan([
            rec('i', { type: 'swap', date: '2026-03-03', source: 'roster_import' }),
            rec('q', { type: 'swap', date: '2026-03-04', source: 'mystery', replacedType: 'nonsense' }),
        ]);
        const byId = Object.fromEntries(p.convert.map(x => [x.id, conversionWrite(x, SENTINEL)]));
        assert.equal(byId.i.source, 'roster_import');
        assert.equal(byId.q.source, 'manual');
        assert.equal('replacedType' in byId.q, false);
    });
});

describe('the press re-reads, and refuses a list that has changed', () => {
    test('the same records give the same signature; one gone, or one whose fate changed, does not', () => {
        const a = [rec('a', { type: 'swap', date: '2026-03-03' }), rec('b', { type: 'overtime', date: '2026-03-07' })];
        assert.equal(planSignature(plan(a)), planSignature(plan([...a].reverse())), 'order of arrival does not matter');
        assert.notEqual(planSignature(plan(a)), planSignature(plan([a[0]])));
        const superseded = [...a, rec('n', { type: 'shift', date: '2026-03-03', createdAt: ts('2026-03-04T09:00:00Z') })];
        assert.notEqual(planSignature(plan(a)), planSignature(plan(superseded)));
    });

    test('a record whose TIMES changed since the preview changes it — the press sends what was shown', () => {
        const before = [rec('a', { type: 'swap', date: '2026-03-03', value: '06:20-14:20' })];
        const after = [rec('a', { type: 'swap', date: '2026-03-03', value: '07:00-15:00' })];
        assert.equal(plan(before).convert[0].to, plan(after).convert[0].to, 'same id, same fate — only the times differ');
        assert.notEqual(planSignature(plan(before)), planSignature(plan(after)));
    });

    test('what is only left alone writes nothing, so a change there does not stop a press', () => {
        const a = [rec('a', { type: 'swap', date: '2026-03-03' })];
        const withLeftover = [...a, rec('bad', { type: 'swap', date: '2026-03-05', value: '6:20-14:20' })];
        assert.equal(plan(withLeftover).skip.length, 1);
        assert.equal(planSignature(plan(a)), planSignature(plan(withLeftover)));
    });
});

describe('the reader\'s two new reads and one write', () => {
    function writeHarness(rows = []) {
        const read = [];
        const ops = [];
        let commits = 0;
        const fs = {
            collection: (_db, path) => ({ path }),
            where: (field, op, value) => ({ where: [field, op, value] }),
            limit: (n) => ({ limit: n }),
            query: (col, ...parts) => ({ col: col.path, parts }),
            getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
            getDocs: async (q) => { read.push(q); return { docs: rows.map(r => ({ id: r.id, data: () => r.data })) }; },
            doc: (_db, col, id) => ({ path: `${col}/${id}` }),
            serverTimestamp: () => 'TS',
            writeBatch: () => ({
                set: (ref, data, options) => ops.push(['set', ref.path, data, options]),
                delete: (ref) => ops.push(['delete', ref.path]),
                commit: async () => { commits++; },
            }),
        };
        return { reader: buildLegacyReader({ db: {}, collectionName: 'overrides', fs }), read, ops, commits: () => commits };
    }

    test('every override on the old records\' days, in chunks of 30, real days only, each day once', async () => {
        const { reader, read } = writeHarness();
        const dates = Array.from({ length: 35 }, (_, i) => `2026-01-${String(i % 31 + 1).padStart(2, '0')}`);
        await reader.fetchByDates([...dates, '2026-01-01', 'garbled']);
        assert.equal(read.length, 2, '31 distinct days → two queries');
        assert.equal(read[0].parts[0].where[0], 'date');
        assert.equal(read[0].parts[0].where[1], 'in');
        assert.equal(read[0].parts[0].where[2].length, 30);
        assert.equal(read[1].parts[0].where[2].length, 1);
    });

    test('one batch: a whole-document set per conversion, a delete per removal, one commit', async () => {
        const { reader, ops, commits } = writeHarness();
        const p = plan([
            rec('old', { type: 'swap', date: '2026-03-03', createdAt: ts('2026-03-01T09:00:00Z') }),
            rec('new', { type: 'swap', date: '2026-03-03', createdAt: ts('2026-03-02T09:00:00Z') }),
            rec('ot', { type: 'overtime', date: '2026-03-07' }),
        ]);
        assert.deepEqual(await reader.apply(p), { converted: 2, removed: 1 });
        assert.equal(commits(), 1);
        assert.deepEqual(ops.map(o => [o[0], o[1]]), [['set', 'overrides/new'], ['set', 'overrides/ot'], ['delete', 'overrides/old']]);
        assert.deepEqual(ops[1][2], conversionWrite(p.convert[1], 'TS'));
        // A PLAIN set, which replaces the document. `{ merge: true }` would keep whatever an old record
        // carries from before the rules' `hasOnly` list, and the rules refuse that — every write in
        // the batch with it (firestore.rules.test.mjs → "patching the type in place is REFUSED").
        assert.deepEqual(ops.filter(o => o[0] === 'set').map(o => o[3]), [undefined, undefined]);
    });

    test('more than one batch is refused, not split — a split could leave half of them converted', async () => {
        const { reader, ops, commits } = writeHarness();
        const big = { convert: Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => ({ ...plan([rec(`r${i}`, { type: 'swap', date: '2026-03-03' })]).convert[0] })), remove: [], skip: [] };
        await assert.rejects(reader.apply(big), /Too many/);
        assert.equal(ops.length, 0);
        assert.equal(commits(), 0);
    });
});

describe('what the preview says', () => {
    test('a row names who, the day, what it was and what it becomes', () => {
        const [c] = plan([rec('x', { type: 'overtime', date: '2026-03-07' })]).convert;
        assert.equal(previewRowText(c), 'A. Test · Sat 7 Mar 2026 · Overtime 06:20-14:20 → RDW');
    });
    test('a set-aside row says why, quoting what it holds', () => {
        const [s] = plan([rec('x', { type: 'swap', date: '2026-03-03', value: '6:20-14:20' })]).skip;
        assert.equal(setAsideText(s), 'its times (“6:20-14:20”) are not in today’s format');
    });
});
