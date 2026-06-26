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
    runMigrations,
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

// ── one-shot migration ────────────────────────────────────────────────────────
describe('runMigrations — per-member namespace migration', () => {
    // Seed shared (unnamespaced) member data plus device-level flags. Pre-set the
    // cea/pension guards so only the namespace migration is exercised.
    function seedShared() {
        global.localStorage = makeLocalStorage({
            'myb_pc_rate':            '20.74',
            'myb_pc_p43':             '{"std":140}',
            'myb_pc_setup_2025_26':   '1',
            'myb_pc_snap_43':         'a,b,c',
            'myb_pc_pay_welcome_shown': '1',   // device-level — must stay
            'myb_pc_ytd_notice_shown':  '1',   // device-level — must stay
            'myb_pc_cea_migrated':      '1',   // skip legacy cea migration
            'myb_pc_pension_v882_migrated': '1', // skip legacy pension migration
        });
    }

    test('moves member-financial keys into the member segment, keeps device keys', () => {
        seedShared();
        runMigrations(deps(MEMBER));
        const ls = global.localStorage;

        assert.equal(pcPrefix(), 'myb_pc_gmiller_');
        // moved
        assert.equal(ls.getItem('myb_pc_gmiller_rate'), '20.74');
        assert.equal(ls.getItem('myb_pc_gmiller_p43'), '{"std":140}');
        assert.equal(ls.getItem('myb_pc_gmiller_setup_2025_26'), '1');
        assert.equal(ls.getItem('myb_pc_gmiller_snap_43'), 'a,b,c');
        // shared originals removed
        assert.equal(ls.getItem('myb_pc_rate'), null);
        assert.equal(ls.getItem('myb_pc_p43'), null);
        assert.equal(ls.getItem('myb_pc_snap_43'), null);
        // device-level keys untouched and NOT duplicated into the namespace
        assert.equal(ls.getItem('myb_pc_pay_welcome_shown'), '1');
        assert.equal(ls.getItem('myb_pc_ytd_notice_shown'), '1');
        assert.equal(ls.getItem('myb_pc_gmiller_pay_welcome_shown'), null);
        // guard set
        assert.equal(ls.getItem('myb_pc_ns_migrated'), '1');
    });

    test('is idempotent across a second (fresh) page load — no resurrection of shared keys', () => {
        seedShared();
        runMigrations(deps(MEMBER));
        const before = global.localStorage.dump();

        setPaycalcNamespace(undefined);    // simulate a fresh module load (_nsSeg reset)
        runMigrations(deps(MEMBER));        // guard already set → migration is a no-op

        assert.equal(global.localStorage.getItem('myb_pc_rate'), null);          // not recreated
        assert.equal(global.localStorage.getItem('myb_pc_gmiller_rate'), '20.74'); // still there
        assert.equal(pcPrefix(), 'myb_pc_gmiller_');
        assert.deepEqual(global.localStorage.dump(), before);                    // nothing changed
    });

    test('with no logged-in member it defers: data stays shared, guard not set', () => {
        global.localStorage = makeLocalStorage({
            'myb_pc_rate': '20.74',
            'myb_pc_cea_migrated': '1',
            'myb_pc_pension_v882_migrated': '1',
        });
        runMigrations(deps(null));

        assert.equal(pcPrefix(), 'myb_pc_');                       // unnamespaced
        assert.equal(global.localStorage.getItem('myb_pc_rate'), '20.74'); // not moved
        assert.equal(global.localStorage.getItem('myb_pc_ns_migrated'), null); // deferred
    });
});
