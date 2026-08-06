/**
 * Unit tests for paycalc-transfer.js — pay-data backup and restore.
 * Run: node --test paycalc-transfer.test.mjs   (part of `npm run test:hygiene`)
 *
 * The import path decides whether to overwrite a member's entire pay history, and the blob it acts
 * on is a FILE the member obtained from somewhere. So the two things worth testing hardest are the
 * trust boundary (a backup must never be a way to write arbitrary localStorage) and the round trip
 * (what comes back must be byte-identical to what went in — pay figures, not approximations).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    BACKUP_FORMAT, BACKUP_VERSION,
    selectBackupKeys, summarise, buildBackup, validateBackup, rekeyEntries, backupFilename,
    applyRestore,
} from './paycalc-transfer.js';

const PREFIX = 'myb_pc_gmiller_';
const SLUG = 'gmiller';

/** A representative spread: periods, settings, per-tax-year state, a roster snapshot. */
const SAMPLE = {
    [`${PREFIX}p16`]: '{"satH":7,"satM":30,"pension":null,"actualNet":1234.56}',
    [`${PREFIX}p20`]: '{"satH":0,"satM":0,"pension":0}',
    [`${PREFIX}grade`]: 'cea',
    [`${PREFIX}code`]: '1257L',
    [`${PREFIX}sl_paid_off`]: '20',
    [`${PREFIX}hpp_est_2026_27`]: '1843.01',
    [`${PREFIX}bp_state_2026_27`]: '{"inc":true}',
    [`${PREFIX}ytd_pay_2026_27`]: '21758.94',
    [`${PREFIX}snap_16`]: '{"sat":1}',
};

const makeBlob = (over = {}) => JSON.stringify({
    ...buildBackup({
        entries: SAMPLE, member: 'G. Miller', slug: SLUG,
        appVersion: '19.16', exportedAt: '2026-07-28T16:40:00.000Z', prefix: PREFIX,
    }),
    ...over,
});

describe('selecting what to back up', () => {
    test('takes the member namespace and nothing else', () => {
        const keys = selectBackupKeys([
            `${PREFIX}p16`, `${PREFIX}grade`,
            'myb_pc_ssilva_p16',          // another member on a shared device
            'myb_notif_prompt_done',      // a different feature entirely
            'myb_team_view',
        ], PREFIX);
        assert.deepEqual(keys, [`${PREFIX}grade`, `${PREFIX}p16`]);
    });

    test('never exports a DEVICE key — those describe the browser, not the member', () => {
        // Carrying ns_migrated onto a fresh device would suppress the legacy-ownership prompt on a
        // device that genuinely needs it.
        const keys = selectBackupKeys([`${PREFIX}p16`, 'myb_pc_ns_migrated', 'myb_pc_cea_migrated'], 'myb_pc_');
        assert.deepEqual(keys, [`${PREFIX}p16`]);
    });

    test('picks up a key type invented after this test was written', () => {
        // The selection is a PREFIX SCAN, not an enumerated list — an enumerated list would silently
        // drop a new key type, which is how the SW precache list has bitten this repo before.
        const keys = selectBackupKeys([`${PREFIX}some_future_thing_2028_29`], PREFIX);
        assert.deepEqual(keys, [`${PREFIX}some_future_thing_2028_29`]);
    });

    test('output is sorted, so an unchanged backup is byte-identical between runs', () => {
        const a = selectBackupKeys([`${PREFIX}p9`, `${PREFIX}grade`, `${PREFIX}p16`], PREFIX);
        assert.deepEqual(a, [`${PREFIX}grade`, `${PREFIX}p16`, `${PREFIX}p9`]);
    });
});

describe('summary — stated in payslips, not key counts', () => {
    test('counts periods and distinct tax years', () => {
        const s = summarise(Object.keys(SAMPLE), PREFIX);
        assert.equal(s.periods, 2);
        assert.equal(s.taxYears, 1);
        assert.equal(s.keys, Object.keys(SAMPLE).length);
    });
});

describe('round trip', () => {
    test('every value survives byte-identically — these are pay figures', () => {
        const res = validateBackup(makeBlob(), { currentSlug: SLUG });
        assert.equal(res.ok, true);
        const out = rekeyEntries(res.blob.data, res.blob.slug, SLUG);
        assert.deepEqual(out, SAMPLE);
    });

    test('values are carried as raw strings, never re-parsed', () => {
        // A backup must survive a paycalc schema change it predates, so interpretation stays in the
        // app that reads it. If this module ever JSON.parsed a period, that guarantee is gone.
        const blob = JSON.parse(makeBlob());
        assert.equal(typeof blob.data[`${PREFIX}p16`], 'string');
        assert.equal(blob.data[`${PREFIX}p16`], SAMPLE[`${PREFIX}p16`]);
    });

    test('re-keys into the importing member and leaves the tail alone', () => {
        const out = rekeyEntries({ 'myb_pc_gmiller_hpp_est_2026_27': '1' }, 'gmiller', 'ssilva');
        assert.deepEqual(out, { 'myb_pc_ssilva_hpp_est_2026_27': '1' });
    });

    test('re-keys LEGACY unnamespaced data without mangling an ambiguous tail', () => {
        // `myb_pc_ytd_pay_2026_27` cannot be split into slug + tail by inspection — is the slug
        // "ytd"? The source slug is recorded in the blob precisely so this is not a guess.
        const out = rekeyEntries({ 'myb_pc_ytd_pay_2026_27': '9' }, '', 'gmiller');
        assert.deepEqual(out, { 'myb_pc_gmiller_ytd_pay_2026_27': '9' });
    });
});

describe('what a real member actually carries', () => {
    // Asked directly by the owner: does this include HPP and back pay, and for years down the line?
    // The answer has to stay yes without anyone remembering to update a list — which is why
    // selection is a PREFIX SCAN. This test states the guarantee in the app's own vocabulary so a
    // later refactor to an enumerated list fails here rather than silently shipping a partial backup.
    const YEARS = ['2024_25', '2025_26', '2026_27'];
    const REAL = {};
    for (const yr of YEARS) {
        REAL[`${PREFIX}hpp_est_${yr}`]    = '1843.01';   // the estimate
        REAL[`${PREFIX}hpp_actual_${yr}`] = '1901.44';   // the confirmed figure off the payslip
        REAL[`${PREFIX}hpp_mode_${yr}`]   = 'hours';     // which source was chosen
        REAL[`${PREFIX}hpp_inc_${yr}`]    = '1';         // the include tick
        REAL[`${PREFIX}bp_state_${yr}`]   = '{"mode":"manual","manual":"512.30","inc":"1"}';
        REAL[`${PREFIX}ytd_pay_${yr}`]    = '21758.94';
        REAL[`${PREFIX}ytd_tax_${yr}`]    = '3120.00';
    }
    REAL[`${PREFIX}p16`] = '{"satH":7,"satM":30}';
    REAL[`${PREFIX}sl_paid_off`] = '20';

    test('every HPP and back-pay key is carried, for EVERY tax year', () => {
        const picked = selectBackupKeys(Object.keys(REAL), PREFIX);
        for (const yr of YEARS) {
            for (const kind of ['hpp_est', 'hpp_actual', 'hpp_mode', 'hpp_inc', 'bp_state']) {
                assert.ok(picked.includes(`${PREFIX}${kind}_${yr}`), `${kind}_${yr} must be backed up`);
            }
        }
        assert.equal(picked.length, Object.keys(REAL).length, 'nothing may be dropped');
    });

    test('a tax year that does not exist yet is carried too', () => {
        // The whole point of the prefix scan: no code change when the app rolls into a new year.
        const picked = selectBackupKeys([`${PREFIX}hpp_est_2031_32`, `${PREFIX}bp_state_2031_32`], PREFIX);
        assert.equal(picked.length, 2);
    });

    test('the whole set survives the round trip byte-identically', () => {
        const blob = buildBackup({
            entries: REAL, member: 'G. Miller', slug: SLUG,
            appVersion: '19.19', exportedAt: '2026-07-29T00:00:00.000Z', prefix: PREFIX,
        });
        const res = validateBackup(JSON.stringify(blob), { currentSlug: SLUG });
        assert.equal(res.ok, true);
        assert.deepEqual(rekeyEntries(res.blob.data, res.blob.slug, SLUG), REAL);
    });
});

describe('the trust boundary — a backup must not write arbitrary storage', () => {
    const reject = (data, why) => {
        const res = validateBackup(makeBlob({ data }), { currentSlug: SLUG });
        assert.equal(res.ok, false, why);
        return res.error;
    };

    test('a key outside the paycalc namespace is refused', () => {
        const err = reject({ 'myb_notif_prompt_done': '1' }, 'a foreign key must not be written');
        assert.match(err, /isn't pay data/);
    });

    test('a DEVICE key smuggled into the data is refused', () => {
        reject({ 'myb_pc_ns_migrated': '1' }, 'device flags must never be importable');
    });

    test('path-traversal-looking and punctuation keys are refused', () => {
        for (const k of ['myb_pc_../evil', 'myb_pc_a-b', 'myb_pc_a.b', 'myb_pc_a b', '__proto__']) {
            reject({ [k]: 'x' }, `${k} must be refused`);
        }
    });

    test('a non-string value is refused', () => {
        const res = validateBackup(makeBlob({ data: { [`${PREFIX}p16`]: { nested: true } } }), { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /damaged/);
    });

    test('a key that does not sit under the claimed slug is refused', () => {
        // Otherwise re-keying would mangle it into something meaningless.
        const res = validateBackup(makeBlob({ slug: 'gmiller', data: { 'myb_pc_ssilva_p16': '{}' } }), { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /inconsistent/);
    });
});

describe('the identity rule (option A — refuse a different member)', () => {
    test("another member's backup is refused, and says whose it is", () => {
        const other = JSON.stringify({
            ...JSON.parse(makeBlob()),
            member: 'S. Silva', slug: 'ssilva',
            data: { 'myb_pc_ssilva_p16': '{}' },
        });
        const res = validateBackup(other, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /belongs to S\. Silva/);
    });

    test('NO importing identity is refused outright — fail closed', () => {
        // Reachable on paycalc when the session name is no longer on the roster (a leaver, a
        // rename): getLoggedMember() returns null, the per-member namespace never activates, and
        // `pcPrefix()` falls back to the bare `myb_pc_` — which spans EVERY member on a shared
        // device. Before v19.17 this path accepted the blob and the card deleted two people's pay
        // history, then wrote the payload unnamespaced. Verified in a browser, both ways.
        const res = validateBackup(makeBlob(), { currentSlug: '' });
        assert.equal(res.ok, false);
        assert.match(res.error, /can't tell whose pay data/);
    });

    test("a foreign backup is refused even against an empty slug — the check can't be bypassed", () => {
        const other = JSON.stringify({
            ...JSON.parse(makeBlob()), member: 'S. Silva', slug: 'ssilva',
            data: { 'myb_pc_ssilva_p16': '{}' },
        });
        assert.equal(validateBackup(other, { currentSlug: '' }).ok, false);
    });

    test('a pathological member name is capped before it reaches the card', () => {
        const other = JSON.stringify({
            ...JSON.parse(makeBlob()), member: 'x'.repeat(5000), slug: 'ssilva',
            data: { 'myb_pc_ssilva_p16': '{}' },
        });
        const res = validateBackup(other, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.ok(res.error.length < 120, `error was ${res.error.length} chars`);
    });

    test('the same member is accepted', () => {
        assert.equal(validateBackup(makeBlob(), { currentSlug: SLUG }).ok, true);
    });

    test('LEGACY unnamespaced data is accepted but flagged for confirmation', () => {
        // Pre-namespacing data has no owner recorded — the one case where we cannot tell whose
        // figures these are, so the caller must ask rather than the module deciding.
        const legacy = JSON.stringify({
            format: BACKUP_FORMAT, version: BACKUP_VERSION, slug: '', member: '',
            data: { 'myb_pc_p16': '{}' },
        });
        const res = validateBackup(legacy, { currentSlug: SLUG });
        assert.equal(res.ok, true);
        assert.equal(res.unnamespaced, true);
    });
});

describe('malformed input is refused in the member\'s own terms', () => {
    const cases = [
        ['not json at all',              'x', /couldn't be read/],
        ['a truncated paste',            makeBlob().slice(0, 60), /couldn't be read/],
        ['a JSON array',                 '[]', /doesn't look like a backup/],
        ['null',                         'null', /doesn't look like a backup/],
        ['someone else\'s JSON file',    '{"hello":"world"}', /not a pay calculator backup/],
        ['no data block',                JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), /no pay data/],
        ['an empty backup',              JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: {} }), /nothing to restore/],
    ];
    for (const [name, text, re] of cases) {
        test(name, () => {
            const res = validateBackup(text, { currentSlug: SLUG });
            assert.equal(res.ok, false);
            assert.match(res.error, re);
        });
    }

    test('a backup from a NEWER app version is refused, not half-understood', () => {
        const res = validateBackup(makeBlob({ version: BACKUP_VERSION + 1 }), { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /newer version/);
    });
});

describe('filename', () => {
    test('names the member and the date, so it is recognisable months later', () => {
        assert.equal(backupFilename('G. Miller', '2026-07-28T16:40:00.000Z'), 'myb-pay-backup-gmiller-2026-07-28.json');
    });
    test('falls back when there is no member', () => {
        assert.equal(backupFilename('', '2026-07-28T16:40:00.000Z'), 'myb-pay-backup-device-2026-07-28.json');
    });
});

// ── applyRestore — the all-or-nothing REPLACE over a storage with no transactions (v19.84) ──────
// Found by external review. The inline ladder this replaced snapshotted only the keys that ALREADY
// EXISTED, so a rollback could not undo a key the backup had CREATED: it left that key in place,
// checked the original keys, found them intact, and told the member "nothing was changed" over a
// pay history that had silently gained a period.
//
// Every case here needs a storage that fails ON DEMAND, which is exactly what a browser will not do
// to order — and is why the io is injected rather than importing ls.js.
describe('applyRestore', () => {
    /** A fake localStorage whose writes/deletes can be made to fail for chosen keys. */
    function fakeStore(initial = {}, { failWrites = [], failDeletes = [] } = {}) {
        const map = new Map(Object.entries(initial));
        return {
            map,
            get: (/** @type {string} */ k) => (map.has(k) ? map.get(k) : null),
            set: (/** @type {string} */ k, /** @type {string} */ v) => { if (!failWrites.includes(k)) map.set(k, v); },
            del: (/** @type {string} */ k) => { if (!failDeletes.includes(k)) map.delete(k); },
        };
    }

    test('the happy path replaces: new keys written, surplus removed', () => {
        const st = fakeStore({ 'myb_pc_g_miller_p1': 'old', 'myb_pc_g_miller_gone': 'x' });
        const r = applyRestore({
            ...st,
            existing: ['myb_pc_g_miller_p1', 'myb_pc_g_miller_gone'],
            entries: { 'myb_pc_g_miller_p1': 'new', 'myb_pc_g_miller_p2': 'fresh' },
        });
        assert.equal(r.ok, true);
        assert.equal(st.map.get('myb_pc_g_miller_p1'), 'new');
        assert.equal(st.map.get('myb_pc_g_miller_p2'), 'fresh');
        assert.equal(st.map.has('myb_pc_g_miller_gone'), false, 'a key the backup lacks must genuinely disappear');
    });

    test('THE DEFECT: a key the backup CREATED is removed on rollback', () => {
        // The exact scenario from the review — first new key lands, second fails.
        const st = fakeStore({ 'old-period': 'keep' }, { failWrites: ['new-2'] });
        const r = applyRestore({
            ...st,
            existing: ['old-period'],
            entries: { 'old-period': 'updated', 'new-1': 'a', 'new-2': 'b' },
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'write-failed');
        assert.equal(st.map.has('new-1'), false, 'a created key must be DELETED on rollback, not left behind');
        assert.equal(st.map.get('old-period'), 'keep', 'an existing key must be restored byte-for-byte');
        assert.equal(r.restored, true, 'and with the union whole again, this is a true "nothing was changed"');
    });

    test('a rollback that cannot put everything back reports restored:false', () => {
        // NOTE the shape. A write that fails WITHOUT changing the value leaves the device genuinely
        // intact, so `restored: true` is the honest answer there — the first draft of this test
        // asserted false and was wrong about the product, not the other way round. The real
        // not-restored case is a creation that lands and then cannot be deleted again.
        const st = fakeStore({}, { failWrites: ['new2'], failDeletes: ['new1'] });
        const r = applyRestore({ ...st, existing: [], entries: { 'new1': 'a', 'new2': 'b' } });
        assert.equal(r.ok, false);
        assert.equal(r.restored, false, 'a created key that will not delete means the device was left changed');
        assert.equal(st.map.get('new1'), 'a');
    });

    test('a surplus key that will not delete is a FAILED replace, not a success', () => {
        // Everything the backup carries landed, but the old data would not go — that is a merge.
        const st = fakeStore({ 'p1': 'old', 'stale': 'y' }, { failDeletes: ['stale'] });
        const r = applyRestore({ ...st, existing: ['p1', 'stale'], entries: { 'p1': 'new' } });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'surplus-remains');
        assert.equal(st.map.get('stale'), 'y');
    });

    test('values survive byte-for-byte — these are pay figures, not approximations', () => {
        const st = fakeStore({});
        const v = '{"gross":"1234.56","hrs":"07:30","neg":"-12.00"}';
        applyRestore({ ...st, existing: [], entries: { 'myb_pc_x_p1': v } });
        assert.equal(st.map.get('myb_pc_x_p1'), v);
    });

    test('a prototype-named key does not survive a replace', () => {
        // `Object.hasOwn`, not `k in entries` — `in` walks the prototype chain, so `constructor`
        // would report as present and escape the surplus sweep.
        const st = fakeStore({ 'constructor': 'sneaky' });
        const r = applyRestore({ ...st, existing: ['constructor'], entries: { 'p1': 'a' } });
        assert.equal(r.ok, true);
        assert.equal(st.map.has('constructor'), false);
    });
});
