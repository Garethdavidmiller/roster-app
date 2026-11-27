// @lane unit
// @ts-nocheck
/**
 * paycalc-migrations.test.mjs — per-member localStorage namespacing (v14.11).
 *
 * Covers:
 *   - pcPrefix / setPaycalcNamespace / SK rebuild and the per-key helpers
 *   - runMigrations' one-shot namespace migration: member-financial keys move into
 *     the member segment, device-level keys stay put, guard flag is set, and the
 *     migration is idempotent across reloads.
 *
 * Uses a Map-backed localStorage stub (length/key(i) enumeration) so lsKeys() and
 * the migration behave exactly as in the browser. No DOM, no Firebase.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    pcPrefix, setPaycalcNamespace, SK, memberSlug,
    periodKey, hppEstKey, hppActualKey, ytdPayKey, ytdTaxKey,
    runMigrations, hasPendingLegacyMigration, resolveLegacyMigration,
    parseSavedPeriod, readSavedPeriod, keyOwnerSlug,
    writePayslipActuals, clearPayslipActuals, readPayslipActuals, DEVICE_KEYS,
} from '../paycalc-migrations.js';
import { teamMembers } from '../roster-data.js';

// Mirror of the private _memberSlug() in paycalc-migrations.js: lowercase, alphanumerics only.
const slug = (/** @type {string} */ name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Every member has a namespace of their own (test audit, 7 Nov 2026) ─────────────────────────
// memberSlug's own comment says unique names mean unique slugs. They do not: punctuation and case
// are dropped, so 'Q. Example' and 'Q Example' are the same slug. Two members sharing one would share
// every key on a shared device and pass each other's backup identity check, and nothing checked the
// roster for it. Hidden members count: a leaver's data can still be on a shared device.
describe('memberSlug — one namespace per member', () => {
    test('punctuation and case are not part of a slug, so the ROSTER is what keeps them apart', () => {
        assert.equal(memberSlug('Q. Example'), memberSlug('Q Example'));
        assert.equal(memberSlug('Q. Example'), memberSlug('q.example'));
    });

    test('no two roster names share a slug, and none is empty', () => {
        /** @type {Map<string, string>} */
        const seen = new Map();
        for (const m of teamMembers) {
            const s = memberSlug(m.name);
            assert.ok(s, `${m.name} has an empty slug`);
            assert.ok(!seen.has(s), `${m.name} and ${seen.get(s)} would share the namespace myb_pc_${s}_`);
            seen.set(s, m.name);
        }
    });
});

// ── localStorage stub ─────────────────────────────────────────────────────────
function makeLocalStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(k)    { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        key(i)        { return Array.from(store.keys())[i] ?? null; },
        get length()  { return store.size; },
        dump()        { return Object.fromEntries(store); },
    };
}

// Deps for runMigrations. No periods (so the legacy cea/pension per-period loops are
// empty); a single CEA member with no startDate (so no joiner pension patch).
const MEMBER = { name: 'G. Miller', role: 'CEA', currentWeek: 3, rosterType: 'main' };
function deps(member) {
    return {
        getPeriods: () => [],
        getLoggedMember: () => member,
        getPensionDefault: () => 147.36,
    };
}

beforeEach(() => {
    setPaycalcNamespace(undefined);   // reset module namespace state to unnamespaced
    global.localStorage = makeLocalStorage();
});
afterEach(() => { delete global.localStorage; });

// ── pure key helpers ──────────────────────────────────────────────────────────
describe('pcPrefix / setPaycalcNamespace', () => {
    test('defaults to the legacy unnamespaced prefix', () => {
        assert.equal(pcPrefix(), 'myb_pc_');
        assert.equal(SK.rate, 'myb_pc_rate');
        assert.equal(periodKey(43), 'myb_pc_p43');
        assert.equal(hppEstKey({ label: '2025/26' }), 'myb_pc_hpp_est_2025_26');
        assert.equal(ytdPayKey({ label: '2026/27' }), 'myb_pc_ytd_pay_2026_27');
    });

    test('a member name slugs into the prefix and rebuilds SK + key helpers', () => {
        setPaycalcNamespace('G. Miller');
        assert.equal(pcPrefix(), 'myb_pc_gmiller_');
        assert.equal(SK.rate, 'myb_pc_gmiller_rate');
        assert.equal(SK.grade, 'myb_pc_gmiller_grade');
        assert.equal(periodKey(43), 'myb_pc_gmiller_p43');
        assert.equal(hppActualKey({ label: '2025/26' }), 'myb_pc_gmiller_hpp_actual_2025_26');
        assert.equal(ytdTaxKey({ label: '2025/26' }), 'myb_pc_gmiller_ytd_tax_2025_26');
    });

    test('strips punctuation/spaces consistently and is reversible to unnamespaced', () => {
        setPaycalcNamespace('C. Francisco-Charles');
        assert.equal(pcPrefix(), 'myb_pc_cfranciscocharles_');
        setPaycalcNamespace('');           // back to legacy
        assert.equal(pcPrefix(), 'myb_pc_');
        assert.equal(SK.rate, 'myb_pc_rate');
    });
});

// ── per-member namespace ownership (v14.25 prompt) ────────────────────────────
describe('per-member namespace ownership', () => {
    // Seed shared (unnamespaced) member data plus device-level flags. Pre-set the
    // cea/pension guards so only the namespace logic is exercised.
    function seedShared() {
        global.localStorage = makeLocalStorage({
            'myb_pc_rate':            '20.74',
            'myb_pc_p43':             '{"std":140}',
            'myb_pc_setup_2025_26':   '1',
            'myb_pc_snap_43':         'a,b,c',
            'myb_pc_ytd_notice_shown':  '1',   // device-level — must stay
            'myb_pc_cea_migrated':      '1',
            'myb_pc_pension_v882_migrated': '1',
        });
    }

    test('runMigrations only ACTIVATES the namespace — it does NOT silently claim shared data', () => {
        seedShared();
        runMigrations(deps(MEMBER));
        const ls = global.localStorage;
        assert.equal(pcPrefix(), 'myb_pc_gmiller_');            // namespace active
        assert.equal(ls.getItem('myb_pc_rate'), '20.74');       // shared data left in place
        assert.equal(ls.getItem('myb_pc_gmiller_rate'), null);  // NOT moved
        assert.equal(ls.getItem('myb_pc_ns_migrated'), null);   // guard NOT set — prompt still pending
    });

    test('hasPendingLegacyMigration: true with shared data + a member; false with no member', () => {
        seedShared();
        assert.equal(hasPendingLegacyMigration('G. Miller'), true);
        assert.equal(hasPendingLegacyMigration(undefined), false);
        assert.equal(hasPendingLegacyMigration(''), false);
    });

    test('a RETIRED device flag never re-triggers the ownership prompt (v19.37 regression)', () => {
        // The bug v19.36 shipped. `myb_pc_pay_welcome_shown` was dropped from DEVICE_KEYS when the
        // welcome lightbox was retired — but the flag still SITS on every device that ever dismissed
        // it. With the declaration gone it stopped being a device flag and started looking like
        // unnamespaced member data, so `hasPendingLegacyMigration` said true and the "Is this your
        // pay data?" prompt fired at people who have no legacy data at all.
        //
        // Worst hit: anyone who first used paycalc AFTER v14.11 namespacing. Their data was
        // namespaced from the start, so the ownership prompt never ran, so `ns_migrated` — the guard
        // that short-circuits this — was never set. Nothing protected them.
        global.localStorage = makeLocalStorage({
            'myb_pc_pay_welcome_shown': '1',      // retired flag, still present in the wild
            'myb_pc_ytd_notice_shown':  '1',
            'myb_pc_gmiller_rate':      '21.49',  // their data — correctly namespaced already
            'myb_pc_gmiller_p16':       '{"std":140}',
            // deliberately NO myb_pc_ns_migrated: the prompt never ran for this member
        });
        assert.equal(hasPendingLegacyMigration('G. Miller'), false,
            'a retired device flag is still a DEVICE flag — it must never read as claimable pay data');
    });

    test('hasPendingLegacyMigration: false on a clean device (only device-level keys)', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_ytd_notice_shown': '1',
            'myb_pc_cea_migrated': '1',
        });
        assert.equal(hasPendingLegacyMigration('G. Miller'), false);
    });

    test("'mine' moves shared data into the member's namespace, keeps device keys, sets guard", () => {
        seedShared();
        resolveLegacyMigration('G. Miller', 'mine');
        const ls = global.localStorage;
        assert.equal(pcPrefix(), 'myb_pc_gmiller_');
        assert.equal(ls.getItem('myb_pc_gmiller_rate'), '20.74');
        assert.equal(ls.getItem('myb_pc_gmiller_p43'), '{"std":140}');
        assert.equal(ls.getItem('myb_pc_gmiller_snap_43'), 'a,b,c');
        assert.equal(ls.getItem('myb_pc_rate'), null);                  // shared original removed
        assert.equal(ls.getItem('myb_pc_ytd_notice_shown'), '1');       // device-level kept
        assert.equal(ls.getItem('myb_pc_gmiller_ytd_notice_shown'), null); // not namespaced
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');            // guard set
        assert.equal(hasPendingLegacyMigration('G. Miller'), false);
    });

    test("'fresh' discards shared data, keeps device keys, sets guard", () => {
        seedShared();
        resolveLegacyMigration('G. Miller', 'fresh');
        const ls = global.localStorage;
        assert.equal(ls.getItem('myb_pc_rate'), null);
        assert.equal(ls.getItem('myb_pc_p43'), null);
        assert.equal(ls.getItem('myb_pc_snap_43'), null);
        assert.equal(ls.getItem('myb_pc_gmiller_rate'), null);          // not moved either
        assert.equal(ls.getItem('myb_pc_ytd_notice_shown'), '1');       // device-level kept
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');            // guard set
        assert.equal(hasPendingLegacyMigration('G. Miller'), false);
    });

    test('once resolved, a different member on the same device is not prompted', () => {
        seedShared();
        resolveLegacyMigration('G. Miller', 'mine');
        assert.equal(hasPendingLegacyMigration('S. Silva'), false); // guard short-circuits
    });

    test('with no logged-in member, runMigrations leaves data shared and the namespace legacy', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_rate': '20.74',
            'myb_pc_cea_migrated': '1',
            'myb_pc_pension_v882_migrated': '1',
        });
        runMigrations(deps(null));
        assert.equal(pcPrefix(), 'myb_pc_');
        assert.equal(global.localStorage.getItem('myb_pc_rate'), '20.74');
        assert.equal(global.localStorage.getItem('myb_pc_ns_migrated'), null);
    });

    // ── Regression: must never touch ANOTHER member's namespaced data (v14.27 review) ──
    // G. Miller and COLLEAGUE are both real teamMembers, so their slugs are recognised
    // and their namespaced keys are never mistaken for unclaimed legacy data. The colleague is
    // chosen by shape, not written down: the keys below hold a pay rate, and the Pages mirror
    // serves this file (payroll-anonymity.test.mjs).
    const COLLEAGUE = /** @type {string} */ (teamMembers.find(m => !m.hidden && !m.managerOnly && m.name !== 'G. Miller')?.name);
    const COLLEAGUE_RATE = `myb_pc_${memberSlug(COLLEAGUE)}_rate`;

    test("another member's namespaced data does NOT trigger the prompt", () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_gmiller_rate': '20.74',      // G. Miller's own namespaced data
            'myb_pc_gmiller_p43':  '{"std":140}',
            'myb_pc_cea_migrated': '1',
            'myb_pc_pension_v882_migrated': '1',
        });
        // The colleague opens the calc on the same device — must NOT be asked to claim it.
        assert.equal(hasPendingLegacyMigration(COLLEAGUE), false);
    });

    test("'fresh' never deletes another member's namespaced data", () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_gmiller_rate': '20.74',      // belongs to G. Miller
            'myb_pc_rate':         '99',         // genuine unnamespaced legacy
        });
        resolveLegacyMigration(COLLEAGUE, 'fresh');
        assert.equal(global.localStorage.getItem('myb_pc_gmiller_rate'), '20.74'); // preserved
        assert.equal(global.localStorage.getItem('myb_pc_rate'), null);            // legacy cleared
    });

    test("'mine' moves only genuine legacy, never another member's namespaced data", () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_gmiller_rate': '20.74',      // belongs to G. Miller
            'myb_pc_rate':         '99',         // genuine legacy
        });
        resolveLegacyMigration(COLLEAGUE, 'mine');
        assert.equal(global.localStorage.getItem(COLLEAGUE_RATE), '99');   // legacy → the colleague
        assert.equal(global.localStorage.getItem('myb_pc_gmiller_rate'), '20.74'); // Miller untouched
        assert.equal(global.localStorage.getItem('myb_pc_rate'), null);
    });

    test('a device with multiple member namespaces stays intact (no false prompt)', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_gmiller_rate':  '20.74',
            [COLLEAGUE_RATE]: '21.81',
        });
        assert.equal(hasPendingLegacyMigration('G. Miller'), false);
        assert.equal(hasPendingLegacyMigration(COLLEAGUE), false);
    });
});

// Leavers are kept in teamMembers with hidden: true (never hard-deleted). Their slug
// therefore stays in the known-member set, so their namespaced paycalc data on a shared
// device is still recognised as OWNED — never offered to the next person as claimable
// "legacy" data. This pins the one migration edge case surfaced in the v14.36 review:
// hard-deleting a member from teamMembers would silently reclassify their data as legacy.
describe('hidden (leaver) member data is never treated as claimable legacy', () => {
    test("a hidden member's namespaced key is recognised as owned, not legacy", () => {
        const hidden = teamMembers.find(m => m.hidden);
        assert.ok(hidden, 'expected at least one hidden member in teamMembers');
        global.localStorage = makeLocalStorage({
            [`myb_pc_${slug(hidden.name)}_rate`]: '20.74',   // owned by a hidden leaver
        });
        // No genuinely-unnamespaced data exists, so no member should be prompted.
        assert.equal(hasPendingLegacyMigration('G. Miller'), false);
    });

    test('genuinely unnamespaced data still triggers the prompt (contrast)', () => {
        global.localStorage = makeLocalStorage({ 'myb_pc_rate': '20.74' }); // no owner slug
        assert.equal(hasPendingLegacyMigration('G. Miller'), true);
    });
});

// ── A NAMESPACE THE ROSTER NO LONGER NAMES (paycalc-3-5) ─────────────────────────────────────────
// The block above relies on leavers staying on the roster as `hidden`. A RENAMED member (or a row
// removed outright) leaves their pay data under a slug the roster no longer holds, and it was classed
// as legacy: offered to whoever signed in next, re-keyed by "Yes, it's mine" to `myb_pc_<new>_<old>_…`
// — keys nothing reads, so the calculator opened empty and the question never came back — and
// deleted outright by another member's "No — delete it". It is somebody's namespaced data: its
// remainder is a key this app writes, while the whole tail is not one. So it is never claimable, and
// it stays where it is until a rename has a carry-over of its own.
describe('a member namespace the roster no longer names is never claimable', () => {
    const OLD = 'aoldname';   // synthetic: nobody on the roster
    const FORMER = {
        [`myb_pc_${OLD}_code`]: 'CODE-X',
        [`myb_pc_${OLD}_p55`]: JSON.stringify({ satH: 8 }),
        [`myb_pc_${OLD}_ytd_pay_2026_27`]: 'YTD-X',
        [`myb_pc_${OLD}_setup`]: '1',
    };

    test('premise: the slug is nobody on the roster', () => {
        assert.ok(!teamMembers.some(m => memberSlug(m.name) === OLD));
    });

    test('it is owned, not legacy — so nobody is asked to claim it', () => {
        global.localStorage = makeLocalStorage(FORMER);
        for (const k of Object.keys(FORMER)) assert.equal(keyOwnerSlug(k), OLD, k);
        assert.equal(hasPendingLegacyMigration('G. Miller'), false, 'a former member\'s pay data was offered to somebody else');
    });

    test('"Yes, it\'s mine" never re-keys it, and "No — delete it" never deletes it', () => {
        global.localStorage = makeLocalStorage({ ...FORMER, 'myb_pc_rate': '99' });   // genuine legacy alongside
        resolveLegacyMigration('G. Miller', 'mine');
        const moved = global.localStorage.dump();
        assert.equal(moved['myb_pc_gmiller_rate'], '99', 'premise: genuine legacy data still moves');
        for (const [k, v] of Object.entries(FORMER)) assert.equal(moved[k], v, `${k} was moved`);
        assert.ok(!Object.keys(moved).some(k => k.startsWith(`myb_pc_gmiller_${OLD}_`)), 're-keyed with the old slug left in');

        global.localStorage = makeLocalStorage({ ...FORMER, 'myb_pc_rate': '99' });
        resolveLegacyMigration('A. Panchal', 'fresh');
        const kept = global.localStorage.dump();
        assert.equal(kept['myb_pc_rate'], undefined, 'premise: genuine legacy data is still cleared');
        for (const [k, v] of Object.entries(FORMER)) assert.equal(kept[k], v, `${k} was deleted by somebody else's "No — delete it"`);
    });

    test('CONTROL: every genuine legacy key shape is still legacy', () => {
        for (const k of ['myb_pc_rate', 'myb_pc_code', 'myb_pc_p43', 'myb_pc_ytd_pay', 'myb_pc_ytd_pay_2026_27',
            'myb_pc_setup_2025_26', 'myb_pc_setup_years_migrated', 'myb_pc_hpp_est_2025_26', 'myb_pc_hpp_actual',
            'myb_pc_bp_state', 'myb_pc_bp_state_2026_27', 'myb_pc_pension_timeline', 'myb_pc_pension_optout',
            'myb_pc_sl_paid_off', 'myb_pc_pg_loan', 'myb_pc_snap_55', 'myb_pc_actuals']) {
            assert.equal(keyOwnerSlug(k), null, `${k} is unnamespaced legacy data`);
        }
    });
});

// ── parseSavedPeriod — the shared saved-period decoder (back-pay + HPP) ────────

// ── THE RATE IS NEVER STORED, SO NOTHING BUILDS ONE (invariant 8; contracts-b-6, paycalc-3-15) ─────
// `runMigrations` still turned a legacy single `rate` into a per-tax-year `rates` key on every
// device that had one — a key nothing has read since the rate became fixed by grade (v17.87), and one
// every backup then carried as "your settings". A stale rate in storage is the failure class
// invariant 8 exists to end; the app must not be manufacturing more of it.
describe('the retired rate keys', () => {
    test('a legacy rate is left alone: no per-year rates key is built from it', () => {
        global.localStorage = makeLocalStorage({ 'myb_pc_rate': '19.99' });
        runMigrations(deps(MEMBER));
        assert.equal(global.localStorage.getItem('myb_pc_rates'), null, 'a stale rate was copied into a new key');
    });
});

describe('parseSavedPeriod', () => {
    test('treats null / empty raw as "never saved", not an error', () => {
        assert.deepEqual(parseSavedPeriod(null),      { data: null, error: false });
        assert.deepEqual(parseSavedPeriod(undefined), { data: null, error: false });
        assert.deepEqual(parseSavedPeriod(''),        { data: null, error: false });
    });

    test('parses valid JSON into data with no error', () => {
        assert.deepEqual(parseSavedPeriod('{"sat":5,"rdw":8}'), { data: { sat: 5, rdw: 8 }, error: false });
        assert.deepEqual(parseSavedPeriod('{}'),                { data: {}, error: false });
    });

    test('flags malformed JSON as an error (never throws, never silently drops)', () => {
        assert.deepEqual(parseSavedPeriod('{bad json'),   { data: null, error: true });
        assert.deepEqual(parseSavedPeriod('not json'),    { data: null, error: true });
        assert.deepEqual(parseSavedPeriod('{"a":1,,}'),   { data: null, error: true });
    });

    test('valid JSON of the wrong SHAPE is damaged, never an empty payslip', () => {
        // `[]` read as a saved period with nothing in it, so the Pay screen showed the ordinary empty
        // state over it. A period is an object of fields; the shape check is shared with the backup's
        // damage preflight (isSavedPeriodShape, paycalc-inventory.js).
        for (const raw of ['[]', '[1,2]', '"text"', 'null', '42', 'true']) {
            assert.deepEqual(parseSavedPeriod(raw), { data: null, error: true }, `a period holding ${raw}`);
        }
    });

    test('through the real reader: a damaged period is reported, and left exactly as it is', () => {
        global.localStorage = makeLocalStorage({ myb_pc_p16: '[]', myb_pc_p17: '{"satH":8}' });
        assert.deepEqual(readSavedPeriod(16), { data: null, error: true });
        assert.deepEqual(readSavedPeriod(17), { data: { satH: 8 }, error: false });
        assert.deepEqual(readSavedPeriod(18), { data: null, error: false }, 'a period never saved is not damaged');
        assert.equal(global.localStorage.getItem('myb_pc_p16'), '[]', 'reading it rewrote or removed it');
    });
});

describe('back-pay per-year migration (v17.86)', () => {
    test('moves the single bp_state blob to its award-year key, preserving the tick', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_gmiller_bp_state': JSON.stringify({ year: '2026/27', inc: '1', oldR: '20.74', newR: '21.49' }),
            'myb_pc_cea_migrated': '1',
            'myb_pc_pension_v882_migrated': '1',
        });
        runMigrations(deps(MEMBER));
        const ls = global.localStorage;
        assert.equal(ls.getItem('myb_pc_gmiller_bp_state'), null, 'old single-blob key removed');
        const moved = JSON.parse(ls.getItem('myb_pc_gmiller_bp_state_2026_27') || 'null');
        assert.ok(moved, 'blob re-homed under the award-year key');
        assert.equal(moved.inc, '1', 'include-tick preserved');
        assert.equal(moved.newR, '21.49', 'entered rate preserved');
    });

    test('no old blob → no-op (does not throw, creates nothing)', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_cea_migrated': '1', 'myb_pc_pension_v882_migrated': '1',
        });
        runMigrations(deps(MEMBER));
        assert.equal(global.localStorage.getItem('myb_pc_gmiller_bp_state'), null);
    });

    test('a year-key blob already present is not overwritten', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_gmiller_bp_state': JSON.stringify({ year: '2026/27', newR: '99.99' }),
            'myb_pc_gmiller_bp_state_2026_27': JSON.stringify({ year: '2026/27', newR: '21.49' }),
            'myb_pc_cea_migrated': '1', 'myb_pc_pension_v882_migrated': '1',
        });
        runMigrations(deps(MEMBER));
        const kept = JSON.parse(global.localStorage.getItem('myb_pc_gmiller_bp_state_2026_27'));
        assert.equal(kept.newR, '21.49', 'existing year-key blob preserved');
        assert.equal(global.localStorage.getItem('myb_pc_gmiller_bp_state'), null, 'old key still cleaned up');
    });
});

// ── FAULT-INJECTED STORAGE: a migration must never delete what it could not move ────────────────
//
// Added v21.86, after an external audit REPRODUCED permanent data loss here. The mechanism is not
// exotic and it is not rare: `lsSet` swallows a storage exception on purpose (iOS private mode, a
// full quota, a locked-down browser), so a write that failed looked exactly like one that worked.
// The migration then deleted the source and wrote its completion marker, which guaranteed it would
// never be retried. Old key gone, new key absent, question closed.
//
// These cases inject that failure directly, because it cannot be reached any other way: every
// happy-path browser test and every ordinary run has working storage, so the destructive branch is
// invisible right up until somebody's tax code disappears.
//
// Two failure SHAPES, deliberately, because they are not the same bug:
//   · setItem THROWS — quota exceeded, private mode.
//   · setItem silently does nothing — the shape a read-back catches and a try/catch does not.

/** A localStorage stub where writes to keys matching `failOn` fail in the given way. */
function makeFailingStorage(initial = {}, failOn = () => false, mode = 'throw') {
    const store = new Map(Object.entries(initial));
    return {
        getItem(k)    { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) {
            if (failOn(k)) {
                if (mode === 'throw') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
                return;                       // silent no-op — the nastier shape
            }
            store.set(k, String(v));
        },
        removeItem(k) { store.delete(k); },
        key(i)        { return Array.from(store.keys())[i] ?? null; },
        get length()  { return store.size; },
        dump()        { return Object.fromEntries(store); },
    };
}

describe('a migration that cannot write does not delete', () => {
    // `SK` is REBUILT when the namespace changes, and runMigrations activates the member's
    // namespace as its last step — so reading `SK.code` afterwards names a different key from the
    // one the migration wrote. The first draft of these tests did exactly that and two assertions
    // passed for the wrong reason: they checked a member-namespaced key that had never existed in
    // any run, failing or not. Capture the unnamespaced names BEFORE running.
    const legacyNames = () => {
        setPaycalcNamespace(undefined);
        return { code: SK.code, ytdPay: SK.ytdPay, ytdTax: SK.ytdTax };
    };

    for (const mode of ['throw', 'silent']) {
        test(`CEA key migration keeps the old key when the new one fails (${mode})`, () => {
            // The audit's exact reproduction: a tax code, and a write that does not land.
            const KEY = legacyNames().code;
            global.localStorage = makeFailingStorage(
                { cea_code: '1257L' }, (k) => k === KEY, mode);
            runMigrations(deps(MEMBER));

            const after = global.localStorage.dump();
            assert.equal(after.cea_code, '1257L', 'the source survives — it is the only copy');
            assert.equal(after[KEY], undefined, 'and the destination genuinely did not take it');
            assert.equal(after.myb_pc_cea_migrated, undefined,
                'so the migration is NOT recorded as done, and runs again next load');
        });

        test(`namespace migration keeps the legacy key when the member key fails (${mode})`, () => {
            const memberKey = `myb_pc_${slug(MEMBER.name)}_code`;
            global.localStorage = makeFailingStorage(
                { myb_pc_code: '1257L' }, (k) => k === memberKey, mode);
            setPaycalcNamespace(undefined);

            assert.equal(hasPendingLegacyMigration(MEMBER.name), true, 'precondition: it would ask');
            resolveLegacyMigration(MEMBER.name, 'mine');

            const after = global.localStorage.dump();
            assert.equal(after.myb_pc_code, '1257L', 'the legacy value is still there');
            assert.equal(after[memberKey], undefined);
            assert.equal(after.myb_pc_ns_migrated, undefined,
                'and the one-shot guard is withheld, so the member is asked again');
        });
    }

    test('the Year to Date figures are not lost half-way', () => {
        // Two independent values sharing one migration. The tax half failing must not take the pay
        // half's source with it, and vice versa — they are deleted separately for that reason.
        // Built from the REAL legacy year, via the real key helper — a hand-written slug
        // here would pass while the production key moved somewhere else entirely.
        const L = legacyNames();
        const payKey = ytdPayKey({ label: '2025/26' });   // the legacy year, by label (LEGACY_TAX_YEAR)
        const taxKey = ytdTaxKey({ label: '2025/26' });
        global.localStorage = makeFailingStorage(
            { [L.ytdPay]: '12345.67', [L.ytdTax]: '2345.67', myb_pc_cea_migrated: '1' },
            (k) => k === taxKey);
        runMigrations(deps(MEMBER));

        const after = global.localStorage.dump();
        assert.equal(after[payKey], '12345.67', 'the half that worked moved');
        assert.equal(after[L.ytdPay], undefined, 'and its source was cleaned up');
        assert.equal(after[L.ytdTax], '2345.67', 'the half that failed kept its source');
    });

    test('with working storage every one of them still migrates', () => {
        // The other direction. A guard that is too cautious would leave a healthy device stuck on
        // legacy keys for ever, which is a slower version of the same problem.
        const KEY = legacyNames().code;
        global.localStorage = makeFailingStorage({ cea_code: '1257L', cea_grade: 'CEA' });
        runMigrations(deps(MEMBER));

        const after = global.localStorage.dump();
        assert.equal(after.cea_code, undefined, 'source removed');
        assert.equal(after[KEY], '1257L', 'destination populated');
        assert.equal(after.myb_pc_cea_migrated, '1', 'and the migration is recorded as done');
    });
    // THE OTHER HALF: THE COPY LANDS, THE SOURCE WILL NOT GO (external audit of v26.92). Nothing is
    // lost — both copies are there. The copy is DONE, so the flag is set and names the source still
    // to go; the next load only removes it (review of v26.95 — waiting re-ran the copy).
    test('a source that will not be removed is LISTED, not retried — and the tidy never writes over a NEWER destination', () => {
        const KEY = legacyNames().code;
        const storage = makeFailingStorage({ cea_code: '1257L' });
        const realRemove = storage.removeItem;
        storage.removeItem = () => {};                    // removals silently refused
        global.localStorage = storage;
        runMigrations(deps(MEMBER));
        let after = global.localStorage.dump();
        assert.equal(after.cea_code, '1257L', 'the source is still there');
        assert.equal(after[KEY], '1257L', 'and so is the copy');
        assert.deepEqual(JSON.parse(after.myb_pc_cea_migrated), ['cea_code'],
            'so the copy is recorded as done, with the source listed for removal');

        // Between loads the member changes their code; then storage lets removals through again.
        storage.setItem(KEY, '1263L');
        storage.removeItem = realRemove;
        setPaycalcNamespace(undefined);
        runMigrations(deps(MEMBER));
        after = global.localStorage.dump();
        assert.equal(after[KEY], '1263L', 'the tidy kept the newer code — it never wrote the old one back over it');
        assert.equal(after.cea_code, undefined, 'the source is gone now');
        assert.equal(after.myb_pc_cea_migrated, '1', 'and nothing is left to tidy');
    });
});

// ── A SOURCE THAT WILL NOT GO, LOAD AFTER LOAD (review of v26.95) ───────────────────────────────
// v26.95 made a move whose source would not be removed count as unfinished, so the one-shot flags
// waited — and both migrations then re-ran over data that had ALREADY been copied:
//   · on a shared phone, member B was asked "Is this your pay data?" about the tax code member A had
//     just claimed, and "Yes" copied it into B's namespace (invariant 3);
//   · the CEA rename copied `cea_code` back into `myb_pc_code` after the member's "No — delete it",
//     where, with the ownership question closed, nothing would ever offer or clear it again.
// The one test that reached a retry turned removal back ON before it, so neither branch was ever run
// with the refusal still in force. These keep it refused across loads, and record every write.

/** A storage whose removals are refused for keys `ctl.refuse` names, for as long as it says so, and
 *  whose writes throw for keys `ctl.failSet` names. Every successful write is logged in `writes`. */
function makeStubbornStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    /** @type {string[]} */
    const writes = [];
    const ctl = { refuse: (/** @type {string} */ _k) => true, failSet: (/** @type {string} */ _k) => false };
    return {
        ctl, writes,
        getItem(k)    { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) {
            if (ctl.failSet(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
            writes.push(k); store.set(k, String(v));
        },
        removeItem(k) { if (!ctl.refuse(k)) store.delete(k); },
        key(i)        { return Array.from(store.keys())[i] ?? null; },
        get length()  { return store.size; },
        dump()        { return Object.fromEntries(store); },
    };
}

/** One page load: a fresh module namespace, then the real migrations. */
function load(member) {
    setPaycalcNamespace(undefined);
    runMigrations(deps(member));
}

describe('a legacy source that will not be removed, load after load', () => {
    const A = MEMBER;
    const B = { name: /** @type {string} */ (teamMembers.find(m => !m.hidden && !m.managerOnly && m.name !== A.name)?.name), role: 'CEA' };
    const nsOf = (/** @type {{name:string}} */ m) => `myb_pc_${memberSlug(m.name)}_`;
    const FLAGS = { myb_pc_cea_migrated: '1', myb_pc_pension_v882_migrated: '1' };
    const LEGACY = { myb_pc_code: '1257L', myb_pc_p43: '{"std":140}' };

    // Two starting points: a first claim, and a phone v26.95–v26.98 left with BOTH copies and no flag
    // (the copy landed, the source stayed, the flag waited) — which takes the "already there" branch.
    const SEEDS = {
        'a first claim': () => ({ ...FLAGS, ...LEGACY }),
        'a v26.95 phone holding both copies': () => ({ ...FLAGS, ...LEGACY,
            [`${nsOf(A)}code`]: '1257L', [`${nsOf(A)}p43`]: '{"std":140}' }),
    };

    for (const [label, seed] of Object.entries(SEEDS)) {
        test(`shared phone (${label}): after A claims, B is never asked and never receives A's figures; A is not re-asked`, () => {
            const ls = makeStubbornStorage(seed());
            global.localStorage = ls;
            load(A);
            assert.equal(hasPendingLegacyMigration(A.name), true, 'premise: A is asked');
            resolveLegacyMigration(A.name, 'mine');
            assert.equal(ls.getItem(`${nsOf(A)}code`), '1257L', 'premise: A has the tax code');
            assert.equal(ls.getItem('myb_pc_code'), '1257L', 'premise: the legacy source would not go');

            load(A);
            assert.equal(hasPendingLegacyMigration(A.name), false, 'A was asked again about data already claimed');
            load(B);
            assert.equal(hasPendingLegacyMigration(B.name), false, "B was asked about A's pay data");
            resolveLegacyMigration(B.name, 'mine');   // a stale prompt, or any caller that did not ask first
            load(B);
            const bKeys = Object.keys(ls.dump()).filter(k => k.startsWith(nsOf(B)));
            assert.deepEqual(bKeys, [], "A's figures reached B's namespace");
            assert.equal(ls.getItem(`${nsOf(A)}code`), '1257L', "A's own copy is untouched");
        });

        test(`CEA rename (${label === 'a first claim' ? 'a first copy' : 'a v26.95 phone holding both copies'}) then "No — delete it": the deleted figure never comes back`, () => {
            const initial = label === 'a first claim'
                ? { cea_code: '1257L' }
                : { cea_code: '1257L', myb_pc_code: '1257L' };   // copied by v26.95, flag withheld
            const ls = makeStubbornStorage(initial);
            ls.ctl.refuse = k => k.startsWith('cea_');           // only the CEA source is stuck
            global.localStorage = ls;
            load(A);
            assert.equal(hasPendingLegacyMigration(A.name), true, 'premise: the renamed code is offered');
            resolveLegacyMigration(A.name, 'fresh');
            assert.equal(ls.getItem('myb_pc_code'), null, 'premise: "No — delete it" deleted it');

            for (let i = 0; i < 3; i++) {
                const wrote = ls.writes.length;
                load(A);
                assert.equal(ls.getItem('myb_pc_code'), null, `load ${i + 2}: the deleted tax code was copied back`);
                assert.equal(ls.writes.length, wrote, `load ${i + 2}: a tidy that removed nothing still rewrote storage`);
                assert.equal(hasPendingLegacyMigration(A.name), false);
            }
            assert.ok(!ls.writes.slice(ls.writes.indexOf('myb_pc_ns_migrated')).includes('myb_pc_code'),
                'nothing wrote the tax code after the answer');
            assert.equal(ls.getItem('cea_code'), '1257L', 'premise: the source is still refused');
        });
    }

    for (const [label, initial] of Object.entries({
        'a first copy': { cea_code: '1257L', myb_pc_p43: '{"std":140}' },
        // v26.95 already copied both, so each takes the "already there" branch
        'a v26.95 phone holding both copies': { cea_code: '1257L', myb_pc_code: '1257L',
            myb_pc_p43: '{"std":140}', [`${nsOf(A)}p43`]: '{"std":140}' },
    })) test(`removal starts working (${label}): the leftovers go, and nothing is copied a second time`, () => {
        const ls = makeStubbornStorage(initial);
        global.localStorage = ls;
        load(A);
        resolveLegacyMigration(A.name, 'mine');
        assert.equal(ls.getItem(`${nsOf(A)}code`), '1257L', 'premise: the code reached A');
        assert.equal(ls.getItem(`${nsOf(A)}p43`), '{"std":140}', 'premise: the payslip reached A');
        ls.setItem(`${nsOf(A)}code`, '1263L');               // A corrects the code before the next load

        const before = ls.writes.length;
        ls.ctl.refuse = () => false;                         // storage behaves again
        load(A);
        const after = ls.dump();
        for (const k of ['cea_code', 'myb_pc_code', 'myb_pc_p43']) assert.equal(after[k], undefined, `${k} was not tidied`);
        assert.equal(after[`${nsOf(A)}code`], '1263L', "A's newer code was overwritten");
        assert.equal(after.myb_pc_cea_migrated, '1');
        assert.equal(after.myb_pc_ns_migrated, '1');
        assert.deepEqual(ls.writes.slice(before).sort(), ['myb_pc_cea_migrated', 'myb_pc_ns_migrated'],
            'the tidy wrote something other than its own flags');

        const settled = ls.writes.length;
        load(A);
        assert.deepEqual(ls.writes.slice(settled), [], 'a settled device still writes on every load');
        assert.equal(hasPendingLegacyMigration(B.name), false);
    });

    test('"No — delete it" over legacy keys that will not go: nobody is asked again, and a later load clears them', () => {
        const ls = makeStubbornStorage({ ...FLAGS, ...LEGACY });
        global.localStorage = ls;
        load(A);
        resolveLegacyMigration(A.name, 'fresh');
        assert.equal(ls.getItem('myb_pc_code'), '1257L', 'premise: the delete was refused');
        load(B);
        assert.equal(hasPendingLegacyMigration(B.name), false, 'B was offered data A said to delete');

        ls.ctl.refuse = () => false;
        load(B);
        assert.equal(ls.getItem('myb_pc_code'), null, 'the refused delete was never tried again');
        assert.equal(ls.getItem('myb_pc_p43'), null);
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    test('a COPY that fails still withholds the flag and loses nothing — even beside a source that will not go', () => {
        const ls = makeStubbornStorage({ ...FLAGS, ...LEGACY });
        ls.ctl.failSet = k => k === `${nsOf(A)}code`;        // quota: the tax code cannot be written
        global.localStorage = ls;
        load(A);
        resolveLegacyMigration(A.name, 'mine');
        let after = ls.dump();
        assert.equal(after.myb_pc_ns_migrated, undefined, 'the question was closed over a value that never arrived');
        assert.equal(after.myb_pc_code, '1257L', 'the tax code was lost');
        assert.equal(after.myb_pc_p43, '{"std":140}', 'the payslip that DID copy kept its source too');
        // A answered: A is not asked again — the copy is carried forward on A's next load instead.
        assert.equal(hasPendingLegacyMigration(A.name), false, 'A was asked a question A had already answered');
        ls.ctl.failSet = () => false;
        ls.ctl.refuse = () => false;
        load(A);
        assert.equal(ls.getItem(`${nsOf(A)}code`), '1257L', "A's next load finishes the copy");
        assert.equal(ls.getItem('myb_pc_code'), null, 'and removes the source');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1', 'and only then closes the question');

        // CEA: one copy fails, another lands beside a source that will not go — still deferred.
        const cea = makeStubbornStorage({ cea_code: '1257L', cea_grade: 'cea' });
        cea.ctl.failSet = k => k === 'myb_pc_code';
        global.localStorage = cea;
        load(A);
        after = cea.dump();
        assert.equal(after.myb_pc_cea_migrated, undefined, 'the CEA rename was recorded as done with a value missing');
        assert.equal(after.cea_code, '1257L', 'the tax code was lost');
        cea.ctl.failSet = () => false;
        load(A);
        assert.equal(cea.getItem('myb_pc_code'), '1257L', 'the retry copies what did not land');
        assert.ok(cea.getItem('myb_pc_cea_migrated'), 'and only then is it recorded');
    });

    test('a tidy removes only what it listed, and only while it is still a legacy source', () => {
        const ls = makeStubbornStorage({
            myb_pc_cea_migrated: JSON.stringify(['cea_code', `${nsOf(A)}code`]),
            myb_pc_ns_migrated:  JSON.stringify(['myb_pc_p43', `${nsOf(B)}code`, 'myb_pc_cea_migrated']),
            cea_code: 'x', myb_pc_p43: 'y', myb_pc_p44: 'later',
            [`${nsOf(A)}code`]: 'A', [`${nsOf(B)}code`]: 'B', myb_pc_pension_v882_migrated: '1',
        });
        ls.ctl.refuse = () => false;
        global.localStorage = ls;
        load(A);
        const after = ls.dump();
        assert.equal(after.cea_code, undefined);
        assert.equal(after.myb_pc_p43, undefined);
        assert.equal(after.myb_pc_p44, 'later', 'a legacy key nobody listed was swept up');
        assert.equal(after[`${nsOf(A)}code`], 'A', "a member's own key was deleted from a list");
        assert.equal(after[`${nsOf(B)}code`], 'B', "another member's key was deleted from a list");
        assert.equal(after.myb_pc_cea_migrated, '1');
        assert.equal(after.myb_pc_ns_migrated, '1');
    });
});

// ── A "MINE" THAT DOES NOT FINISH STAYS THE CLAIMANT'S (invariant 3) ────────────────────────────
// Member A answered "mine"; one copy landed beside a source that would not go, another copy failed.
// The withheld flag then read exactly like an unanswered question: once storage recovered, member B
// was asked, and B's "mine" copied A's tax code and loan setting into B's namespace. The claim is
// now recorded first — who answered, and what is left — and these drive every step of that story.
//
// And a READ that failed is not an ABSENT value: one transient failure deleted the only copy,
// overwrote a newer value with an older one, or closed the question over keys nothing enumerated.

/** A storage whose reads, writes, removals and enumeration can each be made to fail by predicate.
 *  `ctl.get(k, present)` throws a read; `ctl.set` throws a write; `ctl.silentSet` drops one without a
 *  word; `ctl.del` throws a removal; `ctl.enumerate()` throws `length`/`key()`. */
function makeFaultStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    const never = () => false;
    const ctl = { get: never, set: never, silentSet: never, del: never, enumerate: never };
    const boom = (/** @type {string} */ what) => { const e = new Error(`${what} refused`); e.name = 'SecurityError'; throw e; };
    return {
        ctl,
        getItem(k)    { if (ctl.get(k, store.has(k))) boom('read'); return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { if (ctl.set(k)) boom('write'); if (!ctl.silentSet(k)) store.set(k, String(v)); },
        removeItem(k) { if (ctl.del(k)) boom('removal'); store.delete(k); },
        key(i)        { if (ctl.enumerate()) boom('key'); return Array.from(store.keys())[i] ?? null; },
        get length()  { if (ctl.enumerate()) boom('length'); return store.size; },
        dump()        { return Object.fromEntries(store); },
    };
}

/** A predicate that answers true the first time `pred` does, and never again. */
const once = (/** @type {(...a: any[]) => boolean} */ pred) => {
    let fired = false;
    return (/** @type {any[]} */ ...a) => (!fired && pred(...a) ? (fired = true) : false);
};

describe('a "mine" that does not finish stays the claimant\'s', () => {
    const A = MEMBER;
    const B = { name: /** @type {string} */ (teamMembers.find(m => !m.hidden && !m.managerOnly && m.name !== A.name)?.name), role: 'CEA' };
    const nsOf = (/** @type {{name:string}} */ m) => `myb_pc_${memberSlug(m.name)}_`;
    const FLAGS = { myb_pc_cea_migrated: '1', myb_pc_pension_v882_migrated: '1' };
    const bKeys = (/** @type {any} */ ls) => Object.keys(ls.dump()).filter(k => k.startsWith(nsOf(B)));

    test('the claim record is a device key, never somebody\'s pay data', () => {
        assert.ok(DEVICE_KEYS.has('myb_pc_ns_claim'));
    });

    test('A → a partial failure → B → A: B is never asked and never receives A\'s figures; A finishes without being asked', () => {
        const ls = makeFaultStorage({ ...FLAGS, myb_pc_code: 'A-code', myb_pc_sl: 'A-loan' });
        global.localStorage = ls;
        load(A);
        assert.equal(hasPendingLegacyMigration(A.name), true, 'premise: A is asked');

        // The copy of the loan setting throws; the tax code copies but its source will not go.
        ls.ctl.set = k => k === `${nsOf(A)}sl`;
        ls.ctl.del = k => k === 'myb_pc_code';
        resolveLegacyMigration(A.name, 'mine');
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'A-code', 'premise: the tax code reached A');
        assert.equal(ls.getItem(`${nsOf(A)}sl`), null, 'premise: the loan setting did not');
        assert.equal(ls.getItem('myb_pc_sl'), 'A-loan', 'the loan setting was lost');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), null, 'the question was closed over a value that never arrived');
        assert.equal(JSON.parse(/** @type {string} */ (ls.getItem('myb_pc_ns_claim'))).by, memberSlug(A.name), 'the claim names A');
        assert.equal(hasPendingLegacyMigration(A.name), false, 'A was asked again after answering');
        assert.equal(hasPendingLegacyMigration(B.name), false, "B was asked about A's pay data");

        // Storage recovers. B signs in on the same phone.
        ls.ctl.set = () => false;
        ls.ctl.del = () => false;
        const before = ls.dump();
        load(B);
        assert.deepEqual(ls.dump(), before, "B's load carried A's claim forward — only A's own load may");
        assert.equal(hasPendingLegacyMigration(B.name), false, "B was asked about A's pay data once storage recovered");
        resolveLegacyMigration(B.name, 'mine');   // a stale prompt, or any caller that did not ask first
        assert.deepEqual(ls.dump(), before, "B's \"mine\" changed storage during A's claim");
        resolveLegacyMigration(B.name, 'fresh');
        assert.deepEqual(ls.dump(), before, "B's \"No — delete it\" changed storage during A's claim");
        load(B);
        assert.deepEqual(bKeys(ls), [], "A's figures reached B's namespace");
        assert.deepEqual(ls.dump(), before, "B's load carried A's claim forward");

        // A signs in again: the copy finishes, without a question.
        load(A);
        assert.equal(hasPendingLegacyMigration(A.name), false, 'A was asked again');
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'A-code');
        assert.equal(ls.getItem(`${nsOf(A)}sl`), 'A-loan', "A's next load did not finish the copy");
        assert.equal(ls.getItem('myb_pc_code'), null);
        assert.equal(ls.getItem('myb_pc_sl'), null);
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1', 'and the question is closed');
        assert.equal(ls.getItem('myb_pc_ns_claim'), null, 'and the claim is cleared');

        load(B);
        assert.equal(hasPendingLegacyMigration(B.name), false);
        assert.deepEqual(bKeys(ls), [], "A's figures reached B's namespace after all");
    });

    test('a legacy key made AFTER the answer (the Year to Date re-home) joins the claim, never left behind', () => {
        const ls = makeFaultStorage({ ...FLAGS, myb_pc_code: 'A-code' });
        global.localStorage = ls;
        load(A);
        ls.ctl.set = k => k === `${nsOf(A)}code`;              // the copy fails: the claim stands
        resolveLegacyMigration(A.name, 'mine');
        assert.deepEqual(JSON.parse(/** @type {string} */ (ls.getItem('myb_pc_ns_claim'))).keys, ['myb_pc_code'], 'premise: the claim lists one key');
        ls.ctl.set = () => false;
        ls.setItem('myb_pc_ytd_pay_2025_26', '12345');          // what a later load's re-home writes, unnamespaced
        load(A);
        assert.equal(ls.getItem(`${nsOf(A)}ytd_pay_2025_26`), '12345', "the re-homed figure did not reach A's namespace");
        assert.equal(ls.getItem('myb_pc_ytd_pay_2025_26'), null, 'and it was left unnamespaced');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    test('the claim outlives a closing flag that did not land, so B is still never asked', () => {
        const ls = makeFaultStorage({ ...FLAGS, myb_pc_code: 'A-code' });
        global.localStorage = ls;
        load(A);
        ls.ctl.silentSet = k => k === 'myb_pc_ns_migrated';   // the copy works; the answer will not stay
        resolveLegacyMigration(A.name, 'mine');
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'A-code', 'premise: the copy landed');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), null, 'premise: the flag did not');
        assert.notEqual(ls.getItem('myb_pc_ns_claim'), null, 'the claim went before the flag held');
        load(B);
        assert.equal(hasPendingLegacyMigration(B.name), false);
        ls.ctl.silentSet = () => false;
        load(A);
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
        assert.equal(ls.getItem('myb_pc_ns_claim'), null);
    });

    for (const [label, arm] of Object.entries({
        'the write throws':     (/** @type {any} */ ls) => { ls.ctl.set = (/** @type {string} */ k) => k === 'myb_pc_ns_claim'; },
        'the write is dropped': (/** @type {any} */ ls) => { ls.ctl.silentSet = (/** @type {string} */ k) => k === 'myb_pc_ns_claim'; },
        'the read-back fails':  (/** @type {any} */ ls) => { ls.ctl.get = once((/** @type {string} */ k, /** @type {boolean} */ present) => k === 'myb_pc_ns_claim' && present); },
    })) test(`a claim that cannot be recorded (${label}) changes nothing, and A is asked again`, () => {
        const seed = { ...FLAGS, myb_pc_code: 'A-code', myb_pc_sl: 'A-loan' };
        const ls = makeFaultStorage(seed);
        global.localStorage = ls;
        load(A);
        arm(ls);
        resolveLegacyMigration(A.name, 'mine');
        assert.deepEqual(ls.dump(), seed, 'something changed without a claim on record');
        ls.ctl.set = ls.ctl.silentSet = ls.ctl.get = () => false;
        assert.equal(hasPendingLegacyMigration(A.name), true, 'the question was closed, or claimed, without a record');
        resolveLegacyMigration(A.name, 'mine');
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'A-code', 'with storage working the answer goes through');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    test('a claim record that cannot be READ asks nobody and moves nothing; once it can be read, A finishes', () => {
        const seed = { ...FLAGS, myb_pc_code: 'A-code', myb_pc_ns_claim: JSON.stringify({ by: memberSlug(A.name), keys: ['myb_pc_code'] }) };
        const ls = makeFaultStorage(seed);
        ls.ctl.get = k => k === 'myb_pc_ns_claim';
        global.localStorage = ls;
        load(B);
        assert.equal(hasPendingLegacyMigration(B.name), false, 'an unreadable claim was taken for no claim');
        resolveLegacyMigration(B.name, 'mine');
        load(A);
        assert.deepEqual(ls.dump(), seed, 'something moved while the claim could not be read');
        ls.ctl.get = () => false;
        load(A);
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'A-code');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    test('a claim record that will not parse blocks everybody and resumes for nobody', () => {
        const seed = { ...FLAGS, myb_pc_code: 'A-code', myb_pc_ns_claim: '{not json' };
        const ls = makeFaultStorage(seed);
        global.localStorage = ls;
        for (const m of [A, B]) {
            load(m);
            assert.equal(hasPendingLegacyMigration(m.name), false, `${m === A ? 'A' : 'B'} was asked over a damaged claim`);
            resolveLegacyMigration(m.name, 'mine');
        }
        assert.deepEqual(ls.dump(), seed);
    });

    test('a claim left beside a closed question is tidied away, and copies nothing', () => {
        const ls = makeFaultStorage({ ...FLAGS, myb_pc_ns_migrated: '1', myb_pc_code: 'later',
            myb_pc_ns_claim: JSON.stringify({ by: memberSlug(A.name), keys: ['myb_pc_code'] }) });
        global.localStorage = ls;
        load(A);
        assert.equal(ls.getItem('myb_pc_ns_claim'), null);
        assert.equal(ls.getItem(`${nsOf(A)}code`), null, 'a stale claim copied data into A');
        assert.equal(ls.getItem('myb_pc_code'), 'later');
    });

    // ── an unreadable value is not an absent one ──
    test('a source read that fails once: the only copy is kept, and the question is not closed', () => {
        const ls = makeFaultStorage({ ...FLAGS, myb_pc_code: '1257L' });
        global.localStorage = ls;
        load(A);
        ls.ctl.get = once(k => k === 'myb_pc_code');
        resolveLegacyMigration(A.name, 'mine');
        assert.equal(ls.getItem('myb_pc_code'), '1257L', 'one failed read deleted the only copy');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), null, 'and recorded the migration finished');
        load(A);
        assert.equal(ls.getItem(`${nsOf(A)}code`), '1257L', "A's next load finishes it");
        assert.equal(ls.getItem('myb_pc_code'), null);
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    test('a destination read that fails once: the member\'s newer value is never overwritten', () => {
        const ls = makeFaultStorage({ ...FLAGS, myb_pc_code: 'OLD', [`${nsOf(A)}code`]: 'NEWER' });
        global.localStorage = ls;
        load(A);
        ls.ctl.get = once(k => k === `${nsOf(A)}code`);
        resolveLegacyMigration(A.name, 'mine');
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'NEWER', 'the older legacy value overwrote the newer one');
        assert.equal(ls.getItem('myb_pc_code'), 'OLD', 'both are left as they were');
        assert.equal(ls.getItem('myb_pc_ns_migrated'), null);
        load(A);
        assert.equal(ls.getItem(`${nsOf(A)}code`), 'NEWER');
        assert.equal(ls.getItem('myb_pc_code'), null);
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    for (const choice of /** @type {const} */ (['mine', 'fresh'])) {
        test(`an enumeration that fails ("${choice}"): nothing changes and the question stays open`, () => {
            const seed = { ...FLAGS, myb_pc_code: '1257L' };
            const ls = makeFaultStorage(seed);
            global.localStorage = ls;
            load(A);
            ls.ctl.enumerate = once(() => true);
            resolveLegacyMigration(A.name, choice);
            assert.deepEqual(ls.dump(), seed, 'the question was closed over keys nothing listed');
            assert.equal(hasPendingLegacyMigration(A.name), true);
        });
    }

    test('an answered question that cannot be read is not reopened for anybody', () => {
        const seed = { ...FLAGS, myb_pc_ns_migrated: JSON.stringify(['myb_pc_code']), myb_pc_code: 'A-code', [`${nsOf(A)}code`]: 'A-code' };
        const ls = makeFaultStorage(seed);
        ls.ctl.get = k => k === 'myb_pc_ns_migrated';
        global.localStorage = ls;
        load(B);
        assert.equal(hasPendingLegacyMigration(B.name), false, 'an unreadable answer was taken for no answer');
        resolveLegacyMigration(B.name, 'mine');
        assert.deepEqual(bKeys(ls), [], "A's leftover reached B");
    });
});

describe('the other migrations: a read that fails decides nothing', () => {
    const legacy = () => { setPaycalcNamespace(undefined); return { code: SK.code, ytdPay: SK.ytdPay, ytdTax: SK.ytdTax }; };

    test('CEA rename: an unreadable flag copies nothing back over a deleted value', () => {
        const ls = makeFaultStorage({ myb_pc_cea_migrated: JSON.stringify(['cea_code']), cea_code: '1257L',
            myb_pc_ns_migrated: '1', myb_pc_pension_v882_migrated: '1' });
        ls.ctl.get = once(k => k === 'myb_pc_cea_migrated');
        ls.ctl.del = k => k === 'cea_code';
        global.localStorage = ls;
        load(MEMBER);
        assert.equal(ls.getItem(legacy().code), null, 'the deleted tax code was copied back');
    });

    test('CEA rename: an unreadable source or destination waits — nothing lost, nothing overwritten', () => {
        const L = legacy();
        let ls = makeFaultStorage({ cea_code: '1257L' });
        ls.ctl.get = once(k => k === 'cea_code');
        global.localStorage = ls;
        load(MEMBER);
        assert.equal(ls.getItem('cea_code'), '1257L');
        assert.equal(ls.getItem('myb_pc_cea_migrated'), null, 'the rename closed over a value it never read');

        ls = makeFaultStorage({ cea_code: 'OLD', [L.code]: 'NEWER' });
        ls.ctl.get = once(k => k === L.code);
        global.localStorage = ls;
        load(MEMBER);
        assert.equal(ls.getItem(L.code), 'NEWER', 'the older CEA value overwrote the newer one');
        assert.equal(ls.getItem('myb_pc_cea_migrated'), null);
        load(MEMBER);
        assert.equal(ls.getItem(L.code), 'NEWER');
        assert.equal(ls.getItem('cea_code'), null);
        assert.equal(ls.getItem('myb_pc_cea_migrated'), '1');
    });

    test('Year to Date and the premium: an unreadable per-year key is never written over', () => {
        const L = legacy();
        const payKey = ytdPayKey({ label: '2025/26' });
        const hppKey = hppActualKey({ label: '2025/26' });
        const ls = makeFaultStorage({ myb_pc_cea_migrated: '1', myb_pc_pension_v882_migrated: '1',
            [L.ytdPay]: '100.00', [payKey]: '9999.00', cea_hpp_actual: '12.00', [hppKey]: '345.00' });
        ls.ctl.get = (k) => k === payKey || k === hppKey;
        global.localStorage = ls;
        load(MEMBER);
        ls.ctl.get = () => false;
        assert.equal(ls.getItem(payKey), '9999.00', 'an older Year to Date figure overwrote the newer one');
        assert.equal(ls.getItem(L.ytdPay), '100.00', 'and its source was removed');
        assert.equal(ls.getItem(hppKey), '345.00', 'an older premium overwrote the newer one');
        assert.equal(ls.getItem('cea_hpp_actual'), '12.00');

        ls.ctl.get = once(k => k === L.ytdPay);
        load(MEMBER);
        assert.equal(ls.getItem(L.ytdPay), '100.00', 'an unreadable source was acted on');
        load(MEMBER);
        assert.equal(ls.getItem(L.ytdPay), null, 'with reads working the source goes');
        assert.equal(ls.getItem(payKey), '9999.00');
        assert.equal(ls.getItem(hppKey), '345.00');
    });

    test('Year to Date: one figure unreadable beside the other is never taken for an absent one', () => {
        // With Tax Paid present the migration runs, and an unreadable Taxable Pay read as absent wrote
        // '' into its per-year key and removed the legacy figure — the only copy.
        const L = legacy();
        const payKey = ytdPayKey({ label: '2025/26' });
        const taxKey = ytdTaxKey({ label: '2025/26' });
        const ls = makeFaultStorage({ myb_pc_cea_migrated: '1', myb_pc_pension_v882_migrated: '1',
            [L.ytdPay]: '12345.67', [L.ytdTax]: '2345.67' });
        ls.ctl.get = once(k => k === L.ytdPay);
        global.localStorage = ls;
        load(MEMBER);
        assert.equal(ls.getItem(L.ytdPay), '12345.67', 'the only copy of Taxable Pay was removed');
        assert.equal(ls.getItem(payKey), null, 'an empty figure was written in its place');
        load(MEMBER);
        assert.equal(ls.getItem(payKey), '12345.67');
        assert.equal(ls.getItem(taxKey), '2345.67');
        assert.equal(ls.getItem(L.ytdPay), null);
    });

    test('pension patch: a payslip that could not be read keeps the marker waiting', () => {
        const P = { num: 60, payday: new Date(2026, 5, 5), start: new Date(2026, 4, 1), cutoff: new Date(2026, 4, 28) };
        const ls = makeFaultStorage({ myb_pc_cea_migrated: '1', myb_pc_ns_migrated: '1', myb_pc_p60: '{"pension":154.77}' });
        ls.ctl.get = once(k => k === 'myb_pc_p60');
        global.localStorage = ls;
        const d = { getPeriods: () => [P], getLoggedMember: () => null, getPensionDefault: () => 147.36 };
        setPaycalcNamespace(undefined); runMigrations(d);
        assert.equal(ls.getItem('myb_pc_pension_v882_migrated'), null, 'the marker was stamped over a payslip never read');
        setPaycalcNamespace(undefined); runMigrations(d);
        assert.equal(JSON.parse(/** @type {string} */ (ls.getItem('myb_pc_p60'))).pension, 147.36);
        assert.equal(ls.getItem('myb_pc_pension_v882_migrated'), '1');
    });

    test('back pay: an unreadable year key is never written over by the old blob', () => {
        const ns = `myb_pc_${memberSlug(MEMBER.name)}_`;
        const old = JSON.stringify({ year: '2026/27', newR: 'OLD' });
        const ls = makeFaultStorage({ myb_pc_cea_migrated: '1', myb_pc_pension_v882_migrated: '1', myb_pc_ns_migrated: '1',
            [`${ns}bp_state`]: old, [`${ns}bp_state_2026_27`]: JSON.stringify({ year: '2026/27', newR: 'NEWER' }) });
        ls.ctl.get = once(k => k === `${ns}bp_state_2026_27`);
        global.localStorage = ls;
        load(MEMBER);
        assert.equal(JSON.parse(/** @type {string} */ (ls.getItem(`${ns}bp_state_2026_27`))).newR, 'NEWER');
        assert.equal(ls.getItem(`${ns}bp_state`), old, 'the old blob was dropped without its year key being read');
        load(MEMBER);
        assert.equal(JSON.parse(/** @type {string} */ (ls.getItem(`${ns}bp_state_2026_27`))).newR, 'NEWER');
        assert.equal(ls.getItem(`${ns}bp_state`), null);
    });
});

// ── THE PAYSLIP ACTUALS IMPORT: success is what storage reads back ──────────────────────────────
describe('payslip actuals — saved and cleared only when storage confirms it', () => {
    const MAP = { '2025-04-11': { gross: 1, tax: 2, ni: 3, net: 4 } };
    test('a write that throws, or is dropped, is not a save', () => {
        for (const how of ['set', 'silentSet']) {
            const ls = makeFaultStorage();
            ls.ctl[how] = () => true;
            global.localStorage = ls;
            assert.equal(writePayslipActuals(MAP), false, `${how}: a failed write was reported as saved`);
            assert.deepEqual(readPayslipActuals(), {});
        }
    });
    test('a write that reads back is a save; a clear that reads back empty is a clear', () => {
        const ls = makeFaultStorage();
        global.localStorage = ls;
        assert.equal(writePayslipActuals(MAP), true);
        assert.deepEqual(readPayslipActuals(), MAP);
        ls.ctl.del = () => true;
        assert.equal(clearPayslipActuals(), false, 'a refused removal was reported as cleared');
        assert.deepEqual(readPayslipActuals(), MAP);
        ls.ctl.del = () => false;
        assert.equal(clearPayslipActuals(), true);
        assert.deepEqual(readPayslipActuals(), {});
    });
});
