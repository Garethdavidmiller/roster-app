// @lane hygiene
/**
 * Unit tests for paycalc-transfer.js — pay-data backup and restore.
 * Run: node scripts/run-tests.mjs test/paycalc-transfer.test.mjs   (part of `npm run test:hygiene`)
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
    applyRestore, restoredLine, collectBackupEntries, unreadableBackupLine,
} from '../paycalc-transfer.js';
import { PAY_DATA_GENERATION, keyOwnerSlug, memberSlug } from '../paycalc-migrations.js';
import { teamMembers } from '../roster-data.js';
import { periodByNum } from '../paycalc-periods.js';
import { fdLong } from '../paycalc-format.js';

/** The ROSTER's name for a slug the fixtures below use — read, never written here. @param {string} slug */
const rosterNameOf = (slug) => /** @type {string} */ (teamMembers.find(m => memberSlug(m.name) === slug)?.name);

const PREFIX = 'myb_pc_gmiller_';
const SLUG = 'gmiller';

/**
 * A representative spread: periods, settings, per-tax-year state, a roster snapshot.
 *
 * **KEEP THIS CURRENT WITH THE APP'S OWN SCHEMA** (v22.14, external review). A backup fixture that
 * describes an older paycalc still passes every assertion here — it exercises the rules, which do
 * not care what a value means — while quietly proving nothing about the fields staff actually have.
 * It had drifted to the v19 vocabulary: no pension TIMELINE (the v21.78 shape that replaced a
 * boolean, and the one whose mis-handling put £115.92 onto a historical take-home), no payslip
 * COMPARISON figures (`actualGross`/`actualTax`/`actualNi`/`actualPension`, v22.06), and no
 * device-local actuals map. Those are exactly the values a member would lose on a new phone.
 */
const SAMPLE = {
    [`${PREFIX}p16`]: '{"satH":7,"satM":30,"pension":null,"actualNet":1234.56,'
                    + '"actualGross":2100.10,"actualTax":312.40,"actualNi":148.22,"actualPension":151.86}',
    [`${PREFIX}p20`]: '{"satH":0,"satM":0,"pension":0}',
    [`${PREFIX}grade`]: 'cea',
    [`${PREFIX}code`]: '1257L',
    [`${PREFIX}sl_paid_off`]: '20',
    [`${PREFIX}pension_timeline`]: '[{"at":53,"inScheme":false}]',
    [`${PREFIX}hpp_est_2026_27`]: '1843.01',
    [`${PREFIX}bp_state_2026_27`]: '{"inc":true}',
    [`${PREFIX}ytd_pay_2026_27`]: '21758.94',
    [`${PREFIX}snap_16`]: '{"sat":1}',
    [`${PREFIX}actuals`]: '{"2026-07-03":{"gross":2100.1,"net":1638.4}}',
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

// ── WHAT GOES OUT MUST BE WHAT COMES BACK IN ─────────────────────────────────────────────────────
//
// `selectBackupKeys` and `validateBackup` each hold their own idea of what a pay key is — the export
// filter (`startsWith(prefix) && !DEVICE_KEYS.has(k) && KEY_RE.test(k)`) and the import refusal
// (`!KEY_RE.test(k) || DEVICE_KEYS.has(k)`). They are two statements of one rule, written twice, in
// opposite polarity, in two functions nothing compares. Both surviving mutations in this file's
// mutation sweep were one half of one of them, and the cost is different at each end:
//
//   · EXPORT too WIDE — a key shape the importer refuses is written into the file, and the whole
//     backup is then rejected on restore. The member is holding their only copy of their pay history
//     and the app will not read it. No partial restore, no way to fix it from the phone.
//   · IMPORT too WIDE — a browser flag is accepted as pay data (see the legacy cases above).
//
// Neither end can see the other, so the property is asserted rather than the two filters separately:
// a key is exportable if and only if it is importable, over a candidate set that includes the shapes
// nobody writes TODAY. That last part is the point — `selectBackupKeys` is a prefix scan precisely so
// a key type invented later is picked up for free, and "invented later" is where a hyphen or a dot
// enters (a per-date key would carry them naturally). The guard has to run against shapes the app
// does not yet produce, or it only checks the past.
describe('the export filter and the import filter are one rule', () => {
    const CANDIDATES = [
        // real shapes, under the bare legacy prefix so both ends see the same universe
        'myb_pc_p16', 'myb_pc_grade', 'myb_pc_hpp_est_2026_27', 'myb_pc_snap_16', 'myb_pc_actuals',
        'myb_pc_some_future_thing_2028_29',
        // device flags, active and retired
        'myb_pc_ns_migrated', 'myb_pc_cea_migrated', 'myb_pc_ytd_notice_2_shown', 'myb_pc_hpp_notice_2526_shown',
        'myb_pc_pay_welcome_shown', 'myb_pc_ytd_notice_shown',
        // shapes the app does not write today — a key type added later could
        'myb_pc_snap_2026-07-03', 'myb_pc_a.b', 'myb_pc_a b', 'myb_pc_',
    ];

    const importable = (k) => {
        const blob = JSON.stringify(buildBackup({
            entries: { [k]: '{}' }, member: '', slug: '', appVersion: '19.16',
            exportedAt: '2026-07-28T16:40:00.000Z', prefix: 'myb_pc_',
        }));
        return validateBackup(blob, { currentSlug: SLUG }).ok;
    };

    test('every key the export takes, the import accepts — and no other', () => {
        for (const k of CANDIDATES) {
            const exported = selectBackupKeys([k], 'myb_pc_').length === 1;
            assert.equal(exported, importable(k),
                exported
                    ? `${k} is written into backups the app will then refuse to restore`
                    : `${k} is accepted on restore but never exported — the two filters disagree`);
        }
    });

    test('and the candidate set actually straddles the line', () => {
        // Guard-on-the-guard: an all-yes or all-no list would satisfy the property trivially.
        const taken = CANDIDATES.filter(k => selectBackupKeys([k], 'myb_pc_').length === 1);
        assert.ok(taken.length >= 6, 'no real pay keys in the set — the property proves nothing');
        assert.ok(taken.length < CANDIDATES.length, 'nothing is refused — the property proves nothing');
    });
});

describe('summary — stated in payslips, not key counts', () => {
    test('counts periods and distinct tax years', () => {
        const s = summarise(Object.keys(SAMPLE), PREFIX);
        assert.equal(s.periods, 2);
        assert.equal(s.taxYears, 1);
        assert.equal(s.keys, Object.keys(SAMPLE).length);
    });

    test('a tax year is counted whatever kind of key reveals it (v22.14)', () => {
        // THE SHIPPED DEFECT. The old regex named five of the nine per-year key types, so a year
        // whose only data was a confirmed setup, a recorded HPP actual, an HPP opt-in or a
        // Year-to-Date source was invisible — and the card that exists to say what you are
        // carrying to a new phone simply reported a smaller number, with nothing to say so.
        for (const tail of ['setup_2024_25', 'hpp_actual_2024_25', 'hpp_inc_2024_25', 'ytd_src_2024_25']) {
            assert.equal(summarise([PREFIX + tail], PREFIX).taxYears, 1, `${tail} did not count as a tax year`);
        }
        // …and together with a fifth year's key, all five are seen at once.
        const mixed = ['setup_2024_25', 'hpp_actual_2025_26', 'ytd_src_2026_27'].map(t => PREFIX + t);
        assert.equal(summarise(mixed, PREFIX).taxYears, 3);
    });

    test('the blob COUNTS shape stays flat — it is read by app versions that do not exist yet', () => {
        const s = summarise(Object.keys(SAMPLE), PREFIX);
        assert.deepEqual(Object.keys(s).sort(), ['keys', 'periods', 'taxYears']);
        assert.equal(typeof s.taxYears, 'number', 'counts.taxYears is a NUMBER in the file format');
    });
});

describe('the data generation — the shape of the VALUES, not of the file', () => {
    test('a backup records the generation its values were written by', () => {
        const blob = JSON.parse(makeBlob());
        assert.equal(blob.dataGeneration, PAY_DATA_GENERATION);
        assert.notEqual(blob.dataGeneration, blob.version,
            'if these two ever coincide the test proves nothing — pick a case where they differ');
    });

    test('values from a NEWER paycalc are refused, even in a file shape we understand', () => {
        const res = validateBackup(makeBlob({ dataGeneration: PAY_DATA_GENERATION + 1 }), { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /newer version/);
    });

    test('an older generation restores — that is the entire point of recording it', () => {
        const res = validateBackup(makeBlob({ dataGeneration: 1 }), { currentSlug: SLUG });
        assert.equal(res.ok, true);
    });

    test('a backup written before v22.14 has no generation and is not refused for it', () => {
        // Absence means "no later than us", which is true of every backup that predates the field.
        const blob = JSON.parse(makeBlob());
        delete blob.dataGeneration;
        assert.equal(validateBackup(JSON.stringify(blob), { currentSlug: SLUG }).ok, true);
    });
});

describe('the semantic preflight — what is damaged, named before it is written', () => {
    test('a healthy backup reports nothing damaged', () => {
        const res = validateBackup(makeBlob(), { currentSlug: SLUG });
        assert.equal(res.ok, true);
        assert.deepEqual(res.damaged, []);
    });

    test('an unparseable payslip is named, and the restore is still ALLOWED', () => {
        // Deliberately not a refusal: a backup is routinely the only copy left, and a corrupt
        // period restores visibly (parseSavedPeriod surfaces it) where a refusal leaves the
        // member with nothing at all. See damagedEntries in paycalc-inventory.js.
        const blob = JSON.parse(makeBlob());
        blob.data[`${PREFIX}p16`] = '{"satH":7,';
        const res = validateBackup(JSON.stringify(blob), { currentSlug: SLUG });
        assert.equal(res.ok, true, 'damage must not refuse the restore');
        assert.deepEqual(res.damaged.map(d => d.label), ['payslip 16']);
    });

    test('the pension TIMELINE is checked, and the pension AMOUNT is not', () => {
        // A mixed kind, and the fixture now carries both. The timeline is a JSON array whose
        // mis-reading is a money bug (v21.78); the amount is `151.86`, which is not JSON at all.
        const blob = JSON.parse(makeBlob());
        blob.data[`${PREFIX}pension_timeline`] = '[{"at":53,';
        const res = validateBackup(JSON.stringify(blob), { currentSlug: SLUG });
        assert.equal(res.ok, true);
        assert.deepEqual(res.damaged.map(d => d.label), ['your pension history']);
    });

    test('a tax code is never called damaged', () => {
        // `code` holds `1257L` and `rate` holds `21.49`. Parsing those as JSON would report every
        // healthy member in the app as corrupt — the preflight asks only the structured kinds.
        const res = validateBackup(makeBlob(), { currentSlug: SLUG });
        assert.ok(res.ok && !res.damaged.some(d => /code|rate/.test(d.tail)));
    });

    test('the result carries the rich inventory the card names both sides with', () => {
        const res = validateBackup(makeBlob(), { currentSlug: SLUG });
        assert.equal(res.ok, true);
        assert.equal(res.inventory.periods, 2);
        assert.deepEqual(res.inventory.taxYears, ['2026/27']);
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
        // Which source was chosen, in the shape `saveHppState` (paycalc-hpp.js) writes — a JSON
        // object. A bare 'hours' is a value the app never stores, and its reader reads it as damage.
        REAL[`${PREFIX}hpp_mode_${yr}`]   = '{"mode":"hours","exact":""}';
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
        // ⚠️ THIS CASE ALONE DOES NOT REACH THE DEVICE-KEY RULE, and for eight releases nothing did.
        // The blob `makeBlob` builds claims slug "gmiller", so `myb_pc_ns_migrated` — which carries no
        // slug segment — is caught two checks later by the "does not sit under the claimed slug" rule,
        // and `ok: false` is `ok: false` whichever refused it. Deleting `|| DEVICE_KEYS.has(k)` from
        // validateBackup left this green. Naming the refusal is what makes it bite; the legacy blob
        // below is where the rule is actually the only thing standing there.
        const err = reject({ 'myb_pc_ns_migrated': '1' }, 'device flags must never be importable');
        assert.match(err, /isn't pay data/, 'refused for the wrong reason — the device-key rule was not what stopped it');
    });

    test('a LEGACY backup carrying a device flag is refused — the one blob where nothing else would', () => {
        // An unnamespaced (pre-v14.11) backup claims `slug: ''`, so its own prefix IS the bare
        // `myb_pc_` and a device flag sits legitimately under it: the stray check cannot see it, and
        // the shape check cannot either (every device key is plain `myb_pc_<word>`). The device-key
        // rule is the only gate, and legacy blobs are exactly the ones where it matters — restoring
        // `myb_pc_ns_migrated` re-keys it into the member's namespace, where it stops being a browser
        // flag and becomes an unrecognised entry counted by the card whose whole job is to say what
        // the member is carrying, and copied into every backup they take afterwards.
        for (const flag of ['myb_pc_ns_migrated', 'myb_pc_cea_migrated', 'myb_pc_ytd_notice_2_shown', 'myb_pc_hpp_notice_2526_shown']) {
            const legacy = JSON.stringify(buildBackup({
                entries: { 'myb_pc_p16': '{}', [flag]: '1' },
                member: '', slug: '', appVersion: '19.16',
                exportedAt: '2026-07-28T16:40:00.000Z', prefix: 'myb_pc_',
            }));
            const res = validateBackup(legacy, { currentSlug: SLUG });
            assert.equal(res.ok, false, `${flag} reached the member's namespace`);
            assert.match(res.error, /isn't pay data/);
            assert.match(res.error, new RegExp(flag), 'the refusal must name the key, or the member cannot fix the file');
        }
    });

    test('a RETIRED device flag is refused too — the set is not the active list', () => {
        // RETIRED_DEVICE_KEYS exists because deleting a flag the app stopped writing reclassifies it
        // as member data (v19.36 → v19.37). The same reclassification happens here, arriving by file
        // instead of by edit, and it is the retired ones that are still sitting on real devices.
        const legacy = JSON.stringify(buildBackup({
            entries: { 'myb_pc_p16': '{}', 'myb_pc_pay_welcome_shown': '1' },
            member: '', slug: '', appVersion: '19.16',
            exportedAt: '2026-07-28T16:40:00.000Z', prefix: 'myb_pc_',
        }));
        const res = validateBackup(legacy, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /isn't pay data/);
    });

    test('…and a legacy blob with no device flag still restores — this is a gate, not a ban on legacy files', () => {
        // The guard-on-the-guard. Without it every case above would pass equally on an import path
        // that had simply stopped accepting unnamespaced backups, which is the population that needs
        // it most: their data predates namespacing and this is the only way it reaches a new phone.
        const legacy = JSON.stringify(buildBackup({
            entries: { 'myb_pc_p16': '{}', 'myb_pc_grade': 'cea' },
            member: '', slug: '', appVersion: '19.16',
            exportedAt: '2026-07-28T16:40:00.000Z', prefix: 'myb_pc_',
        }));
        const res = validateBackup(legacy, { currentSlug: SLUG });
        assert.equal(res.ok, true, res.ok === false ? res.error : '');
        assert.equal(res.unnamespaced, true);
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

    // A KEY QUOTED BACK IS THE FILE'S OWN TEXT (17 Nov 2026). Each refusal names the key so the member can
    // find it, and the owner's name was already capped — the four keys a refusal quotes were not, so a
    // 5,000-character key stretched the card by 5,000 characters. Every quoting refusal, one by one.
    test('a pathological KEY is capped before any refusal quotes it', () => {
        const long = (/** @type {string} */ c) => c.repeat(5000);
        const cases = [
            ['not pay data', makeBlob({ data: { [`myb_pc_${long('a')}-`]: '1' } }), /isn't pay data/],
            ['damaged', makeBlob({ data: { [`${PREFIX}${long('b')}`]: /** @type {any} */ ({ nested: true }) } }), /damaged/],
            ['not under the slug', makeBlob({ data: { [`myb_pc_${long('c')}`]: '1' } }), /inconsistent/],
            ['the importer\'s own keys, slug stripped', makeBlob({ slug: '', member: '', data: { [`${PREFIX}${long('d')}`]: '1' } }), /inconsistent/],
        ];
        for (const [name, blob, refusal] of cases) {
            const res = validateBackup(/** @type {string} */ (blob), { currentSlug: SLUG });
            assert.equal(res.ok, false, `${name}: premise — refused`);
            assert.match(res.error, /** @type {RegExp} */ (refusal), `${name}: premise — refused by the rule that quotes the key`);
            assert.ok(res.error.length < 160, `${name}: the refusal was ${res.error.length} characters`);
            assert.match(res.error, /…\)/, `${name}: the cut is marked`);
        }
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

    // NAMED FROM THE ROSTER, NEVER FROM THE FILE (18 Nov 2026). The slug matched a roster member, and
    // the refusal quoted the file's own `member` text instead — so a made-up backup could put any words
    // it liked into "That backup belongs to …", in the app's voice.
    test("the refusal names the roster's member for the slug — never words the file carries", () => {
        const crafted = 'your manager. They say: restore it anyway';
        const other = JSON.stringify({
            ...JSON.parse(makeBlob()), member: crafted, slug: 'ssilva',
            data: { 'myb_pc_ssilva_p16': '{}' },
        });
        const res = validateBackup(other, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.ok(rosterNameOf('ssilva'), 'premise: the slug is a roster member\'s');
        assert.ok(!res.error.includes(crafted) && !res.error.includes('restore it anyway'), `the file's words reached the card: ${res.error}`);
        assert.equal(res.error, `That backup belongs to ${rosterNameOf('ssilva')}. Sign in as them to restore it.`);
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

    test('a pathological member name never reaches the card', () => {
        // Capped at 40 characters until the refusal stopped quoting the file at all (18 Nov 2026).
        const other = JSON.stringify({
            ...JSON.parse(makeBlob()), member: 'x'.repeat(5000), slug: 'ssilva',
            data: { 'myb_pc_ssilva_p16': '{}' },
        });
        const res = validateBackup(other, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.ok(res.error.length < 120, `error was ${res.error.length} chars`);
        assert.doesNotMatch(res.error, /xxx/);
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

    // THE OWNERLESS DOOR (72-hour review). Stripping `slug` from ANOTHER member's backup made it
    // read as legacy: accepted, re-keyed under `myb_pc_gmiller_ssilva_…`, and — the restore being a
    // REPLACE — the importing member's own history deleted to make room for keys nothing reads. A
    // real legacy key never starts with a member's slug (that is exactly how the ownership prompt
    // tells the two apart), so one that does is not legacy.
    test("an 'ownerless' backup whose keys belong to another member is refused, and says so", () => {
        const stripped = JSON.stringify({
            format: BACKUP_FORMAT, version: BACKUP_VERSION, member: 'S. Silva',
            data: { 'myb_pc_ssilva_p50': '{"satH":8}', 'myb_pc_ssilva_code': '1257L' },
        });
        const res = validateBackup(stripped, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        // "belongs to someone else. Sign in as them" until 18 Nov 2026 — an instruction naming nobody.
        // The keys name a roster member, so the refusal names them, from the roster.
        assert.equal(res.error, `That backup belongs to ${rosterNameOf('ssilva')}. Sign in as them to restore it.`);
    });

    test("…and so is the importer's OWN namespaced data with the slug stripped — it would be double-keyed", () => {
        const stripped = JSON.stringify({
            format: BACKUP_FORMAT, version: BACKUP_VERSION, member: 'G. Miller',
            data: { 'myb_pc_gmiller_p50': '{"satH":8}' },
        });
        const res = validateBackup(stripped, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /inconsistent/);
    });

    // THE SAME DOOR, FOR A NAME THE ROSTER DOES NOT HOLD (paycalc-2-19). The check above knows only
    // the roster's own slugs, so a file saved under any other name — a member's FORMER name, or
    // somebody since removed from the roster — read as legacy once its slug was stripped: re-keyed
    // to `myb_pc_gmiller_zformer_…`, and the replace deleted the importer's history for keys
    // nothing reads.
    test("an 'ownerless' backup whose keys sit under a name the roster does not hold is refused", () => {
        assert.equal(keyOwnerSlug('myb_pc_zformer_'), null, 'premise: zformer is nobody on the roster');
        const stripped = JSON.stringify({
            format: BACKUP_FORMAT, version: BACKUP_VERSION, member: '',
            data: { 'myb_pc_zformer_p50': '{"satH":8}', 'myb_pc_zformer_code': '1257L' },
        });
        const res = validateBackup(stripped, { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /doesn't recognise/);
    });

    test('…while genuine legacy keys — underscores, unknown kinds and all — still restore', () => {
        // The control for the test above: a legacy key whose tail holds an underscore is one of OUR
        // kinds whole, and a kind this version has never heard of is carried, not taken for a name.
        const legacy = JSON.stringify({
            format: BACKUP_FORMAT, version: BACKUP_VERSION, slug: '', member: '',
            data: {
                'myb_pc_p16': '{}', 'myb_pc_hpp_est_2025_26': '1700.00', 'myb_pc_sl_paid_off': '20',
                'myb_pc_pension_timeline': '[]', 'myb_pc_bp_state': '{}', 'myb_pc_some_future_kind': 'x',
            },
        });
        const res = validateBackup(legacy, { currentSlug: SLUG });
        assert.equal(res.ok, true, res.ok ? '' : res.error);
        assert.equal(res.ok && res.unnamespaced, true);
    });

    test('a backup saved under a name the roster no longer holds says what to do — not "sign in as them"', () => {
        // paycalc-2-19 (b). A member renamed on the roster finds their own earlier copy naming a slug
        // nobody holds now, and "Sign in as them" was an instruction nobody could follow.
        const former = JSON.stringify({
            ...JSON.parse(makeBlob()), member: 'Z. Former', slug: 'zformer',
            data: { 'myb_pc_zformer_p16': '{}' },
        });
        const res = validateBackup(former, { currentSlug: SLUG });
        assert.equal(res.ok, false, 'still refused: whose figures these are cannot be told');
        assert.doesNotMatch(res.error, /Sign in as them/);
        assert.match(res.error, /contact the admin/);
    });

    test('a slug that is present but not a string is refused — it would mangle every key', () => {
        for (const slug of [7, true, ['gmiller'], { s: 'gmiller' }]) {
            const res = validateBackup(makeBlob({ slug }), { currentSlug: SLUG });
            assert.equal(res.ok, false, `slug ${JSON.stringify(slug)} was accepted`);
            assert.match(res.error, /damaged/);
        }
    });

    test('the slug the ladder CHECKED is the one handed back to re-key with', () => {
        const own = validateBackup(makeBlob(), { currentSlug: SLUG });
        assert.equal(own.ok && own.srcSlug, SLUG);
        const legacy = validateBackup(JSON.stringify({
            format: BACKUP_FORMAT, version: BACKUP_VERSION, slug: '', member: '', data: { 'myb_pc_p16': '{}' },
        }), { currentSlug: SLUG });
        assert.equal(legacy.ok && legacy.srcSlug, '');
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

    test('a version that is not a version is DAMAGE — never "update this device" (paycalc-2-15)', () => {
        // A missing or garbled version used to read as "made by a newer version of the app. Update this
        // device first" — sending the member to update a phone that is already current.
        for (const version of [undefined, null, '1', 0, 1.5, 'x']) {
            const res = validateBackup(makeBlob({ version }), { currentSlug: SLUG });
            assert.equal(res.ok, false, `version ${JSON.stringify(version)}`);
            assert.match(res.error, /damaged \(its version record\)/, `version ${JSON.stringify(version)}`);
        }
    });

    test('a data generation sent as text is refused, not waved past the newer-than-us check', () => {
        // "9" > 3 is true in JS, but `typeof … === 'number'` skipped the check entirely for text.
        const res = validateBackup(makeBlob({ dataGeneration: '9' }), { currentSlug: SLUG });
        assert.equal(res.ok, false);
        assert.match(res.error, /damaged \(its data record\)/);
    });

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
    test('the date is the day it is on this device, not in UTC (paycalc-2-21)', () => {
        // 00:30 on 15 July in the UK is 23:30 on the 14th in UTC, and named from the ISO instant the
        // copy carried the 14th. The zone is FORCED: CI runs in UTC and the no-install lane in Los
        // Angeles, and in neither does this instant change day, so the old code would pass there.
        const was = process.env.TZ;
        process.env.TZ = 'Europe/London';
        try {
            const when = new Date(2026, 6, 15, 0, 30);
            assert.equal(when.toISOString().slice(0, 10), '2026-07-14', 'premise: still the 14th in UTC');
            assert.equal(backupFilename('G. Miller', when), 'myb-pay-backup-gmiller-2026-07-15.json');
        } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
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
    /**
     * A fake localStorage whose writes, deletes and READS can be made to fail for chosen keys. `read` is
     * the CHECKED read the card passes (`lsGetChecked`): `{ ok: false }` for a refused read, never a null
     * that looks like an absent key. `failReadsOnce` refuses the first read of each key named; `failReadAt`
     * refuses the Nth read of a key (1-based). `failWritesAfter` refuses every write to a key once it has
     * been written once — a rollback whose put-back is refused. `writes` records every write attempted.
     */
    function fakeStore(initial = {}, {
        failWrites = [], failDeletes = [], failReadsOnce = [], failReadAt = {}, failWritesAfter = [],
    } = /** @type {any} */ ({})) {
        const map = new Map(Object.entries(initial));
        /** @type {Map<string, number>} */ const reads = new Map();
        const once = new Set(failReadsOnce);
        const written = new Set();
        /** @type {[string, string][]} */ const writes = [];
        return {
            map, writes,
            read: (/** @type {string} */ k) => {
                const n = (reads.get(k) ?? 0) + 1;
                reads.set(k, n);
                if (once.delete(k) || /** @type {any} */ (failReadAt)[k] === n) return { ok: false, value: null };
                return { ok: true, value: map.has(k) ? map.get(k) : null };
            },
            set: (/** @type {string} */ k, /** @type {string} */ v) => {
                writes.push([k, v]);
                if (failWrites.includes(k) || (failWritesAfter.includes(k) && written.has(k))) return;
                written.add(k);
                map.set(k, v);
            },
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
        assert.equal(r.reason, 'part-restored', 'a result of its own, which the card words as part-restored');
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

    // ── A READ THAT FAILS IS NOT AN ABSENT KEY (Nov 2026) ─────────────────────────────────────────
    // With `lsGet` as the reader, the snapshot took a refused read for "nothing there": one refused read
    // of an existing payslip, then one refused write, and the rollback "put it back" by DELETING it, then
    // agreed with itself and reported restored:true — the card's "nothing was changed".

    test('THE DEFECT: an original read once refused, then a refused write — the original survives and nothing is written', () => {
        const st = fakeStore({ A: 'origA', B: 'origB' }, { failReadsOnce: ['A'], failWrites: ['B'] });
        const r = applyRestore({ ...st, existing: ['A', 'B'], entries: { A: 'newA', B: 'newB' } });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'unreadable');
        assert.deepEqual(/** @type {any} */ (r).unreadable, ['A']);
        assert.equal(st.writes.length, 0, 'nothing is written before every original has been read');
        assert.equal(st.map.get('A'), 'origA', 'the original was deleted by the rollback before');
        assert.equal(st.map.get('B'), 'origB');
    });

    test('an original that cannot be read at all stops the restore with nothing written', () => {
        const st = fakeStore({ A: 'origA' }, { failReadAt: { A: 1 } });
        const r = applyRestore({ ...st, existing: ['A'], entries: { A: 'newA', C: 'newC' } });
        assert.equal(r.reason, 'unreadable');
        assert.equal(r.restored, true, 'true only because nothing was touched');
        assert.equal(st.writes.length, 0);
        assert.equal(st.map.has('C'), false);
    });

    test('a key confirmed ABSENT before the restore is deleted on rollback, and the result is verified', () => {
        const st = fakeStore({ A: 'origA' }, { failWrites: ['B'] });
        const r = applyRestore({ ...st, existing: ['A'], entries: { A: 'newA', C: 'newC', B: 'newB' } });
        assert.equal(r.reason, 'write-failed');
        assert.equal(r.restored, true);
        assert.equal(st.map.has('C'), false, 'a key the restore created goes again');
        assert.equal(st.map.get('A'), 'origA');
    });

    test('refused writes on two different keys over two pre-existing values roll back to exactly what was there', () => {
        const st = fakeStore({ A: 'origA', B: 'origB', S: 'surplus' }, { failWrites: ['B', 'C'] });
        const r = applyRestore({ ...st, existing: ['A', 'B', 'S'], entries: { A: 'newA', B: 'newB', C: 'newC', D: 'newD' } });
        assert.equal(r.reason, 'write-failed');
        assert.equal(r.restored, true);
        assert.deepEqual(Object.fromEntries(st.map), { A: 'origA', B: 'origB', S: 'surplus' }, 'the device as it was, byte for byte');
    });

    test('a rollback write that is itself refused is PART-RESTORED, never "nothing was changed"', () => {
        // A takes the backup's figure, B is refused, and putting A's original back is refused too.
        const st = fakeStore({ A: 'origA', B: 'origB' }, { failWrites: ['B'], failWritesAfter: ['A'] });
        const r = applyRestore({ ...st, existing: ['A', 'B'], entries: { A: 'newA', B: 'newB' } });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'part-restored');
        assert.equal(r.restored, false);
        assert.deepEqual(/** @type {any} */ (r).unverified, ['A']);
        assert.equal(st.map.get('A'), 'newA', 'premise: the device really is part-restored');
    });

    test('a rollback whose check cannot READ a key is part-restored too — unknown is not restored', () => {
        // A: read 1 (the original), read 2 (the write check), read 3 (the rollback check) refused.
        const st = fakeStore({ A: 'origA' }, { failWrites: ['B'], failReadAt: { A: 3 } });
        const r = applyRestore({ ...st, existing: ['A'], entries: { A: 'newA', B: 'newB' } });
        assert.equal(r.reason, 'part-restored');
        assert.equal(st.map.get('A'), 'origA', 'premise: it was in fact put back, but nothing could confirm it');
    });

    test('a write whose check cannot READ it counts as failed, and is rolled back', () => {
        const st = fakeStore({ A: 'origA' }, { failReadAt: { B: 2 } });
        const r = applyRestore({ ...st, existing: ['A'], entries: { A: 'newA', B: 'newB' } });
        assert.equal(r.reason, 'write-failed');
        assert.equal(r.restored, true);
        assert.equal(st.map.get('A'), 'origA');
        assert.equal(st.map.has('B'), false);
    });

    test('a surplus key whose removal cannot be confirmed by a read is not reported as removed', () => {
        const st = fakeStore({ A: 'origA', S: 'old' }, { failReadAt: { S: 2 } });
        const r = applyRestore({ ...st, existing: ['A', 'S'], entries: { A: 'newA' } });
        assert.equal(r.reason, 'surplus-remains');
    });
});

// ── A BACKUP IS WHOLE OR IT IS NOT MADE (Nov 2026) ───────────────────────────────────────────────
// The card read each value with `lsGet` and skipped the nulls, so a refused read of one payslip left it
// out of a file that counted the rest and downloaded under the ordinary message. The card's use is
// driven in a browser (e2e/paycalc-backup.spec.js → "a payslip that cannot be read stops the backup").
describe('collectBackupEntries and the line a refused backup ends on', () => {
    const P52 = `${PREFIX}p52`, P53 = `${PREFIX}p53`;
    /** @param {Record<string,string>} data @param {string[]} [refuse] @param {boolean} [listOk] */
    const io = (data, refuse = [], listOk = true) => ({
        listKeys: () => (listOk ? { ok: true, keys: Object.keys(data) } : { ok: false, keys: [] }),
        read: (/** @type {string} */ k) => (refuse.includes(k) ? { ok: false, value: null } : { ok: true, value: data[k] ?? null }),
        prefix: PREFIX,
    });

    test('every value read: the entries, whole', () => {
        const r = collectBackupEntries(io({ [P52]: 'a', [P53]: 'b', myb_pc_ns_migrated: '1' }));
        assert.deepEqual(r, { ok: true, entries: { [P52]: 'a', [P53]: 'b' } });
    });

    test('THE DEFECT: one payslip unreadable — no entries at all, and that payslip named', () => {
        const r = collectBackupEntries(io({ [P52]: 'a', [P53]: 'b' }, [P53]));
        assert.equal(r.ok, false);
        assert.deepEqual(r, { ok: false, reason: 'read-failed', unreadable: [P53] });
        assert.equal(/** @type {any} */ (r).entries, undefined, 'never a partial set to build a file from');
    });

    test('a list that cannot be taken is no backup either', () => {
        assert.deepEqual(collectBackupEntries(io({ [P52]: 'a' }, [], false)), { ok: false, reason: 'list-failed' });
    });

    test('a key listed and then found gone is left out — that read worked', () => {
        const r = collectBackupEntries({ ...io({ [P52]: 'a' }), listKeys: () => ({ ok: true, keys: [P52, P53] }) });
        assert.deepEqual(r, { ok: true, entries: { [P52]: 'a' } });
    });

    test('a payslip is named by its payday first, as every payslip list names one', () => {
        assert.equal(fdLong(periodByNum(53).payday), '3 July 2026', 'premise: internal payslip 53 is paid 3 July 2026');
        assert.equal(unreadableBackupLine({ reason: 'read-failed', unreadable: [P53] }, PREFIX, 'Download backup', 'Nothing was saved.'),
            "The payslip paid 3 July 2026 (P16) couldn't be read on this device, so a backup made now would be missing it. "
            + 'Nothing was saved. Tap Download backup to try again.');
    });

    test('several are listed, other kinds by their own names, and a long list is cut short', () => {
        const two = unreadableBackupLine({ reason: 'read-failed', unreadable: [P52, `${PREFIX}bp_state_2026_27`] },
            PREFIX, 'Copy as text', 'Nothing was copied.');
        assert.equal(two, "The payslip paid 5 June 2026 (P12) and back pay 2026/27 couldn't be read on this device, so a "
            + 'backup made now would be missing them. Nothing was copied. Tap Copy as text to try again.');
        const six = unreadableBackupLine({ reason: 'read-failed', unreadable: [50, 51, 52, 53, 54, 55].map(n => `${PREFIX}p${n}`) },
            PREFIX, 'Download backup', 'Nothing was saved.');
        assert.match(six, /^The payslip paid 10 April 2026 \(P4\), the payslip paid 8 May 2026 \(P8\), .* and 2 more couldn't be read/);
        const snap = unreadableBackupLine({ reason: 'read-failed', unreadable: [`${PREFIX}snap_53`] }, PREFIX, 'Download backup', 'Nothing was saved.');
        assert.match(snap, /^The figures filled from your calendar for the payslip paid 3 July 2026 \(P16\) couldn't be read/);
    });

    test('a payslip number the grid does not hold falls back to its plain name', () => {
        assert.match(unreadableBackupLine({ reason: 'read-failed', unreadable: [`${PREFIX}p16`] }, PREFIX, 'Download backup', 'Nothing was saved.'),
            /^Payslip 16 couldn't be read on this device/);
    });

    test('a refused list says so, and offers the same retry', () => {
        assert.equal(unreadableBackupLine({ reason: 'list-failed' }, PREFIX, 'Download backup', 'Nothing was saved.'),
            "This device wouldn't list the pay data saved on it, so a backup made now could be missing some of it. "
            + 'Nothing was saved. Tap Download backup to try again.');
    });
});

// ── THE LINE A RESTORE ENDS ON (17 Nov 2026) ──────────────────────────────────────────────────────
// A backup can hold no payslips at all — settings and Year to Date figures only — and the card said
// "Restored 0 payslips", which reads as a restore that did nothing. The card's use of it is driven in a
// browser (e2e/paycalc-backup.spec.js → "a backup with no payslips").
describe('the line a restore ends on', () => {
    test('a backup with no payslips says it was restored, not "Restored 0 payslips"', () => {
        const settingsOnly = makeBlob({ data: { [`${PREFIX}code`]: '1257L', [`${PREFIX}ytd_pay_2026_27`]: '21758.94' } });
        const res = validateBackup(settingsOnly, { currentSlug: SLUG });
        assert.equal(res.ok, true, 'premise: a settings-only backup restores');
        assert.equal(restoredLine(/** @type {any} */ (res).counts), 'Restored your backup — it held no payslips. Reloading…');
    });

    test('payslips are counted, one and many', () => {
        assert.equal(restoredLine({ periods: 1 }), 'Restored 1 payslip. Reloading…');
        assert.equal(restoredLine({ periods: 12 }), 'Restored 12 payslips. Reloading…');
    });
});
