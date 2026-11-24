// @ts-check
/**
 * al-leave-file.test.mjs — what a valid leave file is, and that a changed one is refused
 * (al-leave-file.js; docs/AL_UPLOADER_PLAN.md §3).
 * Run: node scripts/run-tests.mjs test/al-leave-file.test.mjs   (part of `npm run test:hygiene`)
 *
 * Every person here is INVENTED ("A. Example" and friends) and so is every date and figure: a leave
 * file is personal data, and nothing in this repository may look like a real one
 * (leave-file-privacy.test.mjs). The sample is built so its own sums hold, and each test breaks ONE
 * thing — so a refusal that appears here appears for the reason the test names, not by accident.
 *
 * The seal is pinned to a fixed vector, checked once against `sha256sum`: the format's canonical
 * form is a CONTRACT between two stages that run in different places, so a change to it must fail
 * here, not surface as every real file refused on the day.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    LEAVE_FILE_FORMAT, LEAVE_FILE_VERSION, LEAVE_FILE_MAX_AGE_DAYS, FOUND_IN,
    canonicalJson, leaveFileDigest, sealLeaveFile, readLeaveFile, validateLeaveFile,
    personSums, usedRow, leaveFileAgeDays, londonDayOf, describeRefusal, isSundayIso, isRealIsoDate,
} from '../al-leave-file.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const printed = (o = {}) => ({ carriedForward: 0, allowance: 32, used: 3, columnE: 1, remaining: 28, ...o });

/** A small file whose sums hold. Weekdays are asserted below, so a wrong calendar fails loudly. */
function sample() {
    return {
        format: LEAVE_FILE_FORMAT, version: LEAVE_FILE_VERSION, year: 2026,
        source: { sha256: 'a'.repeat(64), firstDate: '2026-01-01', lastDate: '2027-01-02',
                  clerksLastSaved: '2026-11-06T14:07:00Z', lastSavedByClerk: true },
        made: { on: '2026-11-14', script: 'test', appVersion: '26.10' },
        nameMap: { rows: { 'Example . A': 'A. Example' }, cells: {}, tags: { 'A Example': 'A. Example' } },
        people: [
            { name: 'A. Example', grade: 'CEA',
              sheetRows: [
                  { row: 12, spelt: 'Example . A', grade: 'CEA', used: true, printed: printed() },
                  { row: 31, spelt: 'Example . A', grade: 'CEA', used: false, why: 'duplicate-identical', printed: printed() },
              ],
              columnE: { datedDays: 1, joinerReduction: 0, lump: 0, unexplained: 0 },
              corrected: { remaining: 28, because: [] } },
            { name: 'B. Example', grade: 'DISP', sheetRows: [], columnE: null, corrected: null },
        ],
        days: [
            { name: 'A. Example', date: '2026-02-06', kind: 'leave', foundIn: 'grid', countedBySheet: true },
            { name: 'A. Example', date: '2026-02-08', kind: 'sunday-tag', foundIn: 'grid-tag', countedBySheet: false },
            { name: 'A. Example', date: '2026-02-09', kind: 'leave', foundIn: 'grid', countedBySheet: true },
            { name: 'A. Example', date: '2026-02-24', kind: 'leave', foundIn: 'column-e', countedBySheet: true },
            { name: 'A. Example', date: '2027-01-02', kind: 'leave', foundIn: 'grid', countedBySheet: true, leaveYear: 2026 },
            { name: 'B. Example', date: '2026-06-10', kind: 'leave', foundIn: 'no-totals-row', countedBySheet: false },
        ],
        absentFromWorkbook: ['C. Example'],
        notImported: [{ name: 'D. Example', reason: 'leaver' }],
        unplacedSundayTags: 0,
    };
}
/** @param {any} f */
const codes = f => validateLeaveFile(f).map(r => r.code);
/** @param {any} f @returns {Promise<string>} */
const sealedText = async f => JSON.stringify(await sealLeaveFile(f));

test('the sample is what it claims: real dates, the tag on a Sunday, the leave on weekdays, its sums hold', () => {
    const f = sample();
    for (const d of f.days) {
        assert.ok(isRealIsoDate(d.date), d.date);
        assert.equal(isSundayIso(d.date), d.kind !== 'leave', `${d.date} ${d.kind}`);
    }
    assert.deepEqual(validateLeaveFile(f), []);
    assert.deepEqual(personSums(f.people[0], f.days.filter(d => d.name === 'A. Example')), []);
    assert.equal(usedRow(f.people[0])?.row, 12);
    assert.equal(usedRow(f.people[1]), null);
});

describe('the seal', () => {
    test('the canonical form is pinned: sorted keys, no whitespace, arrays in order, the digest left out', async () => {
        const v = { format: 'myb-test', digest: 'ignored', b: [1, 'é', { d: true, c: null }], a: null, z: -0.5 };
        const { digest: _d, ...rest } = v;
        assert.equal(canonicalJson(rest), '{"a":null,"b":[1,"é",{"c":null,"d":true}],"format":"myb-test","z":-0.5}');
        // Checked once against `printf '%s' '<that text>' | sha256sum` — the UTF-8 bytes, not the UTF-16.
        assert.equal(await leaveFileDigest(v), 'sha256:a038c38aead79bb16f687cbb74ffb7ffaf44eccc723f594d0e0651ee6f5b2d13');
    });

    test('key ORDER in the text does not change the seal; a changed VALUE does', async () => {
        const f = sample();
        const reordered = { unplacedSundayTags: 0, ...f };
        assert.equal(await leaveFileDigest(reordered), await leaveFileDigest(f));
        assert.notEqual(await leaveFileDigest({ ...f, year: 2027 }), await leaveFileDigest(f));
    });

    test('a sealed file reads back exactly', async () => {
        const read = await readLeaveFile(await sealedText(sample()));
        assert.equal(read.ok, true);
        assert.deepEqual(read.ok && read.file.days.length, 6);
    });

    test('a hand-edited file is refused, whatever was edited — a date, a figure, a name', async () => {
        const text = await sealedText(sample());
        for (const [from, to] of [['2026-02-24', '2026-02-25'], ['"remaining":28', '"remaining":29'], ['B. Example', 'B. Exampel']]) {
            assert.ok(text.includes(from), from);
            const read = await readLeaveFile(text.replace(from, to));
            assert.deepEqual(read.ok ? [] : read.refusals.map(r => r.code), ['changed-since-made'], from);
        }
    });

    test('no seal, or a malformed one, is refused as not sealed — never as "fine"', async () => {
        const f = sample();
        for (const digest of [undefined, '', 'sha256:abc', 'md5:' + 'a'.repeat(64)]) {
            const read = await readLeaveFile(JSON.stringify({ ...f, digest }));
            assert.deepEqual(read.ok ? [] : read.refusals.map(r => r.code), ['not-sealed'], String(digest));
        }
    });

    test('a copy that only changed FORM is the file that was made: accents decomposed, a byte-order mark', async () => {
        // Invented accented names (NFC, as the workbook and the roster write them), and two map keys
        // whose ORDER flips when decomposed: `ö` (U+00F6) sorts after `p`, `o` + U+0308 before it — so
        // normalising the canonical TEXT, after the keys were sorted, would still have refused this.
        const f = JSON.parse(JSON.stringify(sample()).replaceAll('A. Example', 'Å. Exåmple'));
        f.nameMap.cells = { 'CEA|öst . ö': null, 'CEA|pst . p': null };
        const text = await sealedText(f);
        const nfd = text.normalize('NFD');
        assert.notEqual(nfd, text, 'the copy is decomposed');
        const read = await readLeaveFile(nfd);
        assert.equal(read.ok, true, read.ok ? '' : JSON.stringify(read.refusals));
        // …and it comes back in NFC, so its names are the roster's however the copy spelt them.
        assert.ok(read.ok && read.file.people[0].name === 'Å. Exåmple' && read.file.days[0].name === 'Å. Exåmple');
        assert.ok(read.ok && Object.keys(read.file.nameMap.cells).every(k => k === k.normalize('NFC')));
        // A byte-order mark is not part of the file: `Blob.text()` drops one, Node's `readFileSync` keeps it.
        const bom = await readLeaveFile(String.fromCharCode(0xFEFF) + text);
        assert.equal(bom.ok, true, bom.ok ? '' : JSON.stringify(bom.refusals));
        assert.deepEqual(await readLeaveFile(String.fromCharCode(0xFEFF)), { ok: false, refusals: [{ code: 'empty' }] });
        // The seal of an NFC file is what it always was: a file sealed before this still verifies.
        const { digest: _d, ...rest } = await sealLeaveFile(sample());
        assert.equal(await leaveFileDigest(sample()), 'sha256:' + createHash('sha256').update(canonicalJson(rest)).digest('hex'));
    });

    test('a file sealed before the seal was worked out over NFC still verifies, whatever form its text was in', async () => {
        // Sealed the old way — over the text as it stood — with names that were never NFC.
        const f = JSON.parse(JSON.stringify(sample()).replaceAll('A. Example', 'Å. Exåmple'.normalize('NFD')));
        const oldSeal = 'sha256:' + createHash('sha256').update(canonicalJson(f)).digest('hex');
        assert.notEqual(oldSeal, await leaveFileDigest(f), 'the old seal differs from the NFC one, or this tests nothing');
        const read = await readLeaveFile(JSON.stringify({ ...f, digest: oldSeal }));
        assert.equal(read.ok, true, read.ok ? '' : JSON.stringify(read.refusals));
        assert.ok(read.ok && read.file.people[0].name === 'Å. Exåmple');
        // …and an edit is still an edit, under either seal.
        const edited = await readLeaveFile(JSON.stringify({ ...f, digest: oldSeal }).replace('2026-02-24', '2026-02-25'));
        assert.deepEqual(edited.ok ? [] : edited.refusals.map(r => r.code), ['changed-since-made']);
    });

    test('a page that cannot work out the seal refuses rather than throws', async () => {
        const text = await sealedText(sample());
        const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
        try {
            const read = await readLeaveFile(text);
            assert.deepEqual(read.ok ? [] : read.refusals.map(r => r.code), ['cannot-check-seal']);
        } finally {
            if (real) Object.defineProperty(globalThis, 'crypto', real);
        }
    });
});

describe('reading refuses by name, never by default', () => {
    test('not JSON: refused, and the refusal carries NOTHING of the text (it would name people)', async () => {
        const text = '{"people":[{"name":"A. Example", oops';
        const read = await readLeaveFile(text);
        assert.equal(read.ok, false);
        assert.deepEqual(!read.ok && read.refusals, [{ code: 'not-json' }]);
        assert.ok(!JSON.stringify(read).includes('Example'));
    });

    test('empty, too large, not a leave file, a newer and an unknown version', async () => {
        const f = sample();
        const first = async (/** @type {string} */ t) => { const r = await readLeaveFile(t); return r.ok ? 'ok' : r.refusals[0].code; };
        assert.equal(await first('   '), 'empty');
        assert.equal(await first('x'.repeat(2_000_001)), 'too-large');
        assert.equal(await first('[]'), 'not-a-leave-file');
        assert.equal(await first(JSON.stringify({ ...f, format: 'myb-backup' })), 'not-a-leave-file');
        assert.equal(await first(JSON.stringify({ ...f, version: 2 })), 'newer-version');
        assert.equal(await first(JSON.stringify({ ...f, version: '1' })), 'unknown-version');
    });

    test('a field the format does not have is refused (a file from elsewhere, or added by hand)', () => {
        assert.deepEqual(codes({ ...sample(), comment: 'x' }), ['bad-field']);
        const f = sample();
        /** @type {any} */ (f.people[0]).note = 'x';
        assert.deepEqual(codes(f), ['bad-field']);   // once — not again for each of their days
    });

    test('a place named after something every object has is not a place: refused, never thrown', async () => {
        // `FOUND_IN.constructor` is Object, whose missing `kinds` threw — and a re-sealed file with it
        // made readLeaveFile throw, the one thing it must never do (header).
        for (const foundIn of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
            const f = sample();
            f.days.push({ name: 'A. Example', date: '2026-03-03', kind: 'leave', foundIn, countedBySheet: true });
            assert.deepEqual(codes(f), ['bad-day'], foundIn);
            const read = await readLeaveFile(await sealedText(f));
            assert.deepEqual(read.ok ? [] : read.refusals, [{ code: 'bad-day', name: 'A. Example', date: '2026-03-03' }], foundIn);
        }
        // The refusal table is read the same way: a code it does not have gets the plain default.
        for (const code of ['constructor', 'toString', '__proto__']) assert.equal(describeRefusal({ code }), 'The file could not be read.', code);
    });

    test('a sealed file the validator did not foresee is refused, never thrown — and nothing of the fault is kept', async () => {
        const text = await sealedText(sample());
        // An unforeseen fault inside the validator, made to order: reading a field that is not there
        // throws, with a message that names somebody.
        Object.defineProperty(Object.prototype, 'why', { get() { throw new Error('A. Example 2026-02-06'); }, configurable: true });
        try {
            const read = await readLeaveFile(text);
            assert.deepEqual(read.ok ? [] : read.refusals, [{ code: 'bad-field' }]);
            assert.ok(!JSON.stringify(read).includes('Example'));
        } finally {
            delete /** @type {any} */ (Object.prototype).why;
        }
    });
});

describe('the sheet’s own dates', () => {
    /** @param {(f: any) => void} edit @returns {import('./al-leave-file.js').Refusal[]} */
    const after = edit => { const f = sample(); edit(f); return validateLeaveFile(f); };

    test('the first date is 1 January of the file’s year, and nothing else', () => {
        assert.deepEqual(after(f => { f.source.firstDate = '2026-01-02'; }), [{ code: 'bad-field', field: 'source' }]);
        assert.deepEqual(after(f => { f.source.firstDate = '2025-01-01'; }), [{ code: 'bad-field', field: 'source' }]);
    });
    test('the last date falls from 31 December to the end of the next January — the grid runs into it', () => {
        assert.deepEqual(after(f => { f.source.lastDate = '2026-12-30'; }), [{ code: 'bad-field', field: 'source' }]);
        assert.deepEqual(after(f => { f.source.lastDate = '2027-02-01'; }), [{ code: 'bad-field', field: 'source' }]);
        assert.deepEqual(after(f => { f.source.lastDate = '2027-01-31'; }), []);
    });
    test('a day before the sheet’s first date is outside it, as one after its last is', () => {
        assert.ok(after(f => { f.days[0].date = '2025-12-31'; }).some(r => r.code === 'outside-sheet' && r.date === '2025-12-31'));
    });
});

describe('every day must be a day the app could hold, said honestly', () => {
    /** @param {(f: any) => void} edit @returns {string[]} */
    const after = edit => { const f = sample(); edit(f); return codes(f); };

    test('leave on a Sunday is refused — the app never records one (SUNDAY_FORBIDDEN_TYPES)', () => {
        assert.ok(after(f => { f.days[0].date = '2026-02-01'; }).includes('sunday-leave'));
    });
    test('a Sunday kind on a weekday is refused', () => {
        assert.ok(after(f => { f.days[1].date = '2026-02-10'; }).includes('bad-day'));
    });
    test('Christmas Day and Boxing Day are refused — the sheet marks them closed', () => {
        assert.ok(after(f => { f.days[0].date = '2026-12-25'; }).includes('christmas-leave'));
        assert.ok(after(f => { f.days[0].date = '2026-12-26'; }).includes('christmas-leave'));
    });
    test('a date outside the sheet, or not a real date', () => {
        assert.ok(after(f => { f.days[0].date = '2027-01-04'; }).includes('outside-sheet'));
        assert.ok(after(f => { f.days[0].date = '2026-02-30'; }).includes('bad-date'));
    });
    test('the same date twice for one person', () => {
        assert.ok(after(f => { f.days[2].date = '2026-02-06'; }).includes('duplicate-day'));
    });
    test('next January on this year’s sheet must say it comes out of THIS year; no other day may', () => {
        assert.ok(after(f => { delete f.days[4].leaveYear; }).includes('bad-leave-year'));
        assert.ok(after(f => { f.days[4].leaveYear = 2027; }).includes('bad-leave-year'));
        assert.ok(after(f => { f.days[0].leaveYear = 2026; }).includes('bad-leave-year'));
    });
    test('countedBySheet cannot lie: each place fixes it', () => {
        for (const [foundIn, rule] of Object.entries(FOUND_IN)) {
            const d = { name: 'A. Example', date: rule.kinds.includes('leave') ? '2026-03-03' : '2026-03-01', kind: rule.kinds[0], foundIn, countedBySheet: !rule.counted };
            assert.ok(after(f => { f.days.push(d); }).includes('bad-day'), foundIn);
        }
    });
    test('a kind a place cannot hold is refused (a tag found in column E)', () => {
        assert.ok(after(f => { f.days[1].foundIn = 'column-e'; }).includes('bad-day'));
    });
    test('a day for somebody with no entry of their own', () => {
        assert.ok(after(f => { f.days[5].name = 'E. Example'; }).includes('unknown-person'));
    });
    test('one person in two lists is refused', () => {
        assert.ok(after(f => { f.notImported[0].name = 'A. Example'; }).includes('duplicate-person'));
        assert.ok(after(f => { f.absentFromWorkbook.push('D. Example'); }).includes('duplicate-person'));
        assert.ok(after(f => { f.people.push({ ...f.people[1] }); }).includes('duplicate-person'));
    });
    test('a reason that is not a code is refused (no free text reaches the screen)', () => {
        assert.ok(after(f => { f.notImported[0].reason = 'left in March'; }).includes('bad-field'));
    });
});

describe('the sums: the file must agree with the sheet’s own printed figures', () => {
    /** @param {(f: any) => void} edit @returns {string[]} */
    const after = edit => { const f = sample(); edit(f); return codes(f); };

    test('a grid day dropped while the file was made fails Used — it does not pass on Stage 1’s word', () => {
        assert.deepEqual(after(f => { f.days.splice(0, 1); }), ['sum-used']);
    });
    test('an over-quota day dropped fails column E', () => {
        assert.deepEqual(after(f => { f.days.splice(3, 1); }), ['sum-column-e']);
    });
    test('the dated count must be the column-E days themselves, even where the parts still add up', () => {
        // One day dated in column E, the parts 1 + 0 + 0 + 0 = the printed 1 — but the file says two.
        assert.deepEqual(after(f => { f.people[0].columnE.datedDays = 2; }), ['sum-column-e']);
    });
    test('`because` must name exactly what changed the corrected figure — not a reason with no day behind it', () => {
        assert.deepEqual(after(f => { f.people[0].corrected.because = ['sunday-counted']; }), ['sum-corrected']);
    });
    test('column E’s undated parts must make up the printed figure', () => {
        assert.deepEqual(after(f => { f.people[0].columnE.lump = 1; }), ['sum-column-e']);
        assert.deepEqual(after(f => {
            f.people[0].sheetRows[0].printed = printed({ columnE: 3, remaining: 26 });
            f.people[0].columnE.unexplained = 2;
            f.people[0].corrected.remaining = 26;
        }), []);
    });
    test('the sheet’s own formula must hold on EVERY row, the unused one too', () => {
        assert.deepEqual(after(f => { f.people[0].sheetRows[1].printed.remaining = 27; }), ['sum-remaining']);
    });
    test('a misspelt day still counts: the corrected figure takes it off and says why', () => {
        const misspelt = { name: 'A. Example', date: '2026-03-03', kind: 'leave', foundIn: 'grid-misspelt', countedBySheet: false };
        assert.deepEqual(after(f => { f.days.push(misspelt); }), ['sum-corrected']);
        assert.deepEqual(after(f => { f.days.push(misspelt); f.people[0].corrected = { remaining: 27, because: ['grid-misspelt'] }; }), []);
    });
    test('a dated over-quota day with a blank count, and a Sunday the sheet charges', () => {
        assert.deepEqual(after(f => {
            f.days.push({ name: 'A. Example', date: '2026-03-03', kind: 'leave', foundIn: 'column-e-uncounted', countedBySheet: false });
            f.days.push({ name: 'A. Example', date: '2026-03-01', kind: 'sunday-counted', foundIn: 'grid', countedBySheet: true });
            f.people[0].sheetRows[0].printed = printed({ used: 4, remaining: 27 });
            f.people[0].sheetRows[1].printed = printed({ used: 4, remaining: 27 });
            f.people[0].corrected = { remaining: 27, because: ['sunday-counted', 'column-e-blank'] };
        }), []);
    });
    test('somebody with no totals row has no figures, and every leave day of theirs says so', () => {
        assert.deepEqual(after(f => { f.days[5].foundIn = 'grid-misspelt'; }), ['sum-no-row']);
        assert.deepEqual(after(f => { f.people[1].corrected = { remaining: 0, because: [] }; }), ['bad-field']);
    });
    test('exactly one row is the used one', () => {
        assert.deepEqual(after(f => { f.people[0].sheetRows[1].used = true; delete f.people[0].sheetRows[1].why; }), ['bad-field']);
    });
    test('a person’s grade is the grade of the row their figures come from — an unused row may be another’s', () => {
        // The card shows the grade beside figures read from that row's block; the two must agree.
        assert.deepEqual(after(f => { f.people[0].grade = 'CES'; }), ['bad-field']);
        assert.deepEqual(after(f => { f.people[0].sheetRows[0].grade = 'DISP'; }), ['bad-field']);
        // A stale row in another grade is the cross-grade duplicate (AL_WORKBOOK.md §8 defect 1): fine.
        assert.deepEqual(after(f => { f.people[0].sheetRows[1].grade = 'CES'; }), []);
    });
});

test('refusals are capped, and the cap says how many more there were', () => {
    const f = sample();
    for (let i = 0; i < 40; i++) f.days.push({ name: 'Z. Nobody', date: '2026-04-01', kind: 'leave', foundIn: 'grid', countedBySheet: true });
    const r = validateLeaveFile(f);
    assert.equal(r.length, 26);
    assert.deepEqual(r.at(-1), { code: 'more', field: '15' });
});

describe('the age of the clerks’ copy', () => {
    test('whole days from their last save; null when the file does not know it', () => {
        const f = sample();
        assert.equal(leaveFileAgeDays(f, '2026-11-14'), 8);
        assert.equal(leaveFileAgeDays(f, '2026-11-06'), 0);
        assert.equal(leaveFileAgeDays({ source: { clerksLastSaved: null } }, '2026-11-14'), null);
        assert.equal(leaveFileAgeDays(f, 'today'), null);
        // The clerks' day is London's: 00:30 on a summer night is 23:30 the day before in UTC (review, 15 Nov 2026).
        const late = (/** @type {string} */ at) => ({ source: { clerksLastSaved: at } });
        assert.equal(leaveFileAgeDays(late('2026-07-20T23:30:00Z'), '2026-07-21'), 0, 'saved at 00:30 on 21 July, so today');
        assert.equal(leaveFileAgeDays(late('2026-11-20T23:30:00Z'), '2026-11-21'), 1, 'in winter London is UTC: 23:30 on 20 Nov');
        assert.equal(londonDayOf('2026-07-20T23:30:00Z'), '2026-07-21');
        assert.equal(londonDayOf('2026-03-29T00:30:00Z'), '2026-03-29', 'the night the clocks go forward');
        assert.equal(londonDayOf('not a time'), null);
        assert.equal(LEAVE_FILE_MAX_AGE_DAYS, 14);   // the owner's figure (14 Nov 2026) — a change is a decision
    });
});

test('every refusal the readers can return has its own sentence, and none falls through to the default', async () => {
    const emitted = new Set(['empty', 'too-large', 'not-json', 'not-a-leave-file', 'newer-version', 'unknown-version',
        'not-sealed', 'changed-since-made', 'cannot-check-seal', 'duplicate-person', 'unknown-person', 'bad-date', 'bad-day',
        'duplicate-day', 'outside-sheet', 'sunday-leave', 'christmas-leave', 'bad-leave-year', 'more', 'bad-field',
        'sum-used', 'sum-column-e', 'sum-remaining', 'sum-corrected', 'sum-no-row']);
    // Every `code: '…'` and `sum-…` in the module is in the list above, so a new refusal without words fails here.
    const src = (await import('node:fs')).readFileSync(new URL('./al-leave-file.js', REPO_ROOT_URL), 'utf8');
    for (const m of src.matchAll(/code: '([a-z-]+)'/g)) assert.ok(emitted.has(m[1]), `no sentence checked for ${m[1]}`);
    for (const m of src.matchAll(/out\.push\('([a-z-]+)'\)/g)) assert.ok(emitted.has(`sum-${m[1]}`), `no sentence checked for sum-${m[1]}`);
    const fallback = describeRefusal({ code: 'never-a-code' });
    for (const code of emitted) {
        const line = describeRefusal({ code, name: 'A. Example', date: '2026-02-06', field: '3' });
        assert.notEqual(line, fallback, code);
        assert.ok(!/!/.test(line), `calm, no exclamation: ${code}`);
    }
});
