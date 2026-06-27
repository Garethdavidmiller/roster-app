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
    pcPrefix, setPaycalcNamespace, SK,
    periodKey, hppEstKey, hppActualKey, ytdPayKey, ytdTaxKey,
    runMigrations, hasPendingLegacyMigration, resolveLegacyMigration,
} from './paycalc-migrations.js';

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
            'myb_pc_pay_welcome_shown': '1',   // device-level — must stay
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

    test('hasPendingLegacyMigration: false on a clean device (only device-level keys)', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_pay_welcome_shown': '1',
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
        assert.equal(ls.getItem('myb_pc_pay_welcome_shown'), '1');      // device-level kept
        assert.equal(ls.getItem('myb_pc_gmiller_pay_welcome_shown'), null); // not namespaced
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
        assert.equal(ls.getItem('myb_pc_pay_welcome_shown'), '1');      // device-level kept
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
});
