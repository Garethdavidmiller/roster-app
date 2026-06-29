/**
 * Unit tests for auth-policy.js — the page-authorisation layer (Phase 3).
 * `requirePageAuth` is pure (explicit roles); `requirePage`/`rolesFor` read the real CONFIG.
 * No mocks. Part of test:hygiene.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requirePageAuth, requirePage, rolesFor, PAGE_POLICIES, DECISIONS } from './auth-policy.js';
import { CONFIG } from './roster-data.js';

// Real role names, derived from CONFIG so the tests don't hard-code (and don't break if a name
// changes). A synthetic name guaranteed to hold NO role.
const ADMIN     = CONFIG.ADMIN_NAMES[0];
const MANAGER   = CONFIG.MANAGER_NAMES[0];
const DESIGNER  = CONFIG.LINKS_DESIGNERS.find(n => !CONFIG.ADMIN_NAMES.includes(n));   // a non-admin designer
const PLAIN     = 'Z. Nobody';   // in no role list

const ROLES = { admin: { admin: true }, manager: { manager: true }, designer: { designer: true }, none: {} };
const snap  = (status, member = null) => ({ status, member });

describe('rolesFor (real CONFIG)', () => {
    test('admin name → admin true', () => assert.equal(rolesFor(ADMIN).admin, true));
    test('manager name → manager true, admin false', () => {
        const r = rolesFor(MANAGER);
        assert.equal(r.manager, true); assert.equal(r.admin, false);
    });
    test('designer name → designer true, admin/manager false', () => {
        const r = rolesFor(DESIGNER);
        assert.equal(r.designer, true); assert.equal(r.admin, false); assert.equal(r.manager, false);
    });
    test('a name in no list → all false', () => assert.deepEqual(rolesFor(PLAIN), { admin: false, manager: false, designer: false }));
    test('null/undefined → all false', () => {
        assert.deepEqual(rolesFor(null), { admin: false, manager: false, designer: false });
        assert.deepEqual(rolesFor(undefined), { admin: false, manager: false, designer: false });
    });
});

describe('requirePageAuth — public pages', () => {
    for (const status of ['initialising', 'resolving', 'named', 'anonymous', 'signedOut', 'degraded', 'error']) {
        test(`calendar allows any status (${status})`, () => {
            assert.equal(requirePageAuth(snap(status), PAGE_POLICIES.calendar, ROLES.none).decision, 'allow');
        });
    }
    test('guides allow with no auth', () => assert.equal(requirePageAuth(snap('signedOut'), PAGE_POLICIES.guides).decision, 'allow'));
});

describe('requirePageAuth — soft page (paycalc) never blocks', () => {
    test('named → allow (full access)', () => assert.equal(requirePageAuth(snap('named', ADMIN), PAGE_POLICIES.paycalc).decision, 'allow'));
    for (const status of ['initialising', 'resolving', 'anonymous', 'signedOut', 'degraded', 'error']) {
        test(`${status} → soft-allow (local calculator still works)`, () => {
            assert.equal(requirePageAuth(snap(status), PAGE_POLICIES.paycalc).decision, 'soft-allow');
        });
    }
});

describe('requirePageAuth — hard page, no role (admin / settings)', () => {
    const policy = PAGE_POLICIES.admin;   // requireNamed, role null
    test('named (any member) → allow', () => assert.equal(requirePageAuth(snap('named', PLAIN), policy, ROLES.none).decision, 'allow'));
    test('signedOut → login', () => assert.equal(requirePageAuth(snap('signedOut'), policy).decision, 'login'));
    test('anonymous → login (named required)', () => assert.equal(requirePageAuth(snap('anonymous'), policy).decision, 'login'));
    test('error → login', () => assert.equal(requirePageAuth(snap('error'), policy).decision, 'login'));
    for (const status of ['initialising', 'resolving', 'degraded']) {
        test(`${status} → pending (still establishing / transient)`, () => {
            assert.equal(requirePageAuth(snap(status), policy).decision, 'pending');
        });
    }
});

describe('requirePageAuth — hard page WITH role (operations: admin only)', () => {
    const policy = PAGE_POLICIES.operations;   // role ['admin']
    test('named + admin → allow', () => assert.equal(requirePageAuth(snap('named', ADMIN), policy, ROLES.admin).decision, 'allow'));
    test('named + manager → forbidden (managers are NOT admin)', () => assert.equal(requirePageAuth(snap('named', MANAGER), policy, ROLES.manager).decision, 'forbidden'));
    test('named + plain staff → forbidden', () => assert.equal(requirePageAuth(snap('named', PLAIN), policy, ROLES.none).decision, 'forbidden'));
    test('signedOut → login (not forbidden — they could sign in as admin)', () => assert.equal(requirePageAuth(snap('signedOut'), policy).decision, 'login'));
    test('degraded → pending (NOT allow — degraded grants no authority)', () => assert.equal(requirePageAuth(snap('degraded', ADMIN), policy, ROLES.admin).decision, 'pending'));
});

describe('requirePage — convenience over real CONFIG', () => {
    test('operations: admin → allow, manager → forbidden, staff → forbidden', () => {
        assert.equal(requirePage(snap('named', ADMIN),   'operations').decision, 'allow');
        assert.equal(requirePage(snap('named', MANAGER), 'operations').decision, 'forbidden');
        assert.equal(requirePage(snap('named', PLAIN),   'operations').decision, 'forbidden');
    });
    test('links: designer → allow, non-designer → forbidden', () => {
        assert.equal(requirePage(snap('named', DESIGNER), 'links').decision, 'allow');
        assert.equal(requirePage(snap('named', MANAGER),  'links').decision, 'forbidden');
    });
    test('admin / settings: any named user → allow', () => {
        assert.equal(requirePage(snap('named', PLAIN), 'admin').decision, 'allow');
        assert.equal(requirePage(snap('named', PLAIN), 'settings').decision, 'allow');
    });
    test('calendar public, paycalc soft, guides open', () => {
        assert.equal(requirePage(snap('anonymous'), 'calendar').decision, 'allow');
        assert.equal(requirePage(snap('signedOut'), 'paycalc').decision, 'soft-allow');
        assert.equal(requirePage(snap('error'), 'guides').decision, 'allow');
    });
    test('unknown page FAILS CLOSED (named admin required)', () => {
        assert.equal(requirePage(snap('named', ADMIN), 'bogus').decision, 'allow');     // admin clears the strict default
        assert.equal(requirePage(snap('named', PLAIN), 'bogus').decision, 'forbidden'); // non-admin denied
        assert.equal(requirePage(snap('signedOut'),    'bogus').decision, 'login');
    });
});

describe('invariants', () => {
    test('every decision is one of DECISIONS', () => {
        const all = [];
        for (const page of Object.keys(PAGE_POLICIES)) {
            for (const status of ['initialising', 'resolving', 'named', 'anonymous', 'signedOut', 'degraded', 'error']) {
                all.push(requirePage(snap(status, ADMIN), page).decision);
            }
        }
        for (const d of all) assert.ok(DECISIONS.includes(d), `"${d}" not a valid decision`);
    });
    test('degraded NEVER yields allow on a hard page (no authority while degraded)', () => {
        for (const page of ['admin', 'settings', 'operations', 'links']) {
            const d = requirePage(snap('degraded', ADMIN), page).decision;
            assert.notEqual(d, 'allow', `${page} must not allow under degraded`);
        }
    });
    test('soft page never yields login/forbidden/pending', () => {
        for (const status of ['initialising', 'resolving', 'named', 'anonymous', 'signedOut', 'degraded', 'error']) {
            const d = requirePage(snap(status, ADMIN), 'paycalc').decision;
            assert.ok(d === 'allow' || d === 'soft-allow', `paycalc/${status} → ${d}`);
        }
    });
    test('public page always allows', () => {
        for (const status of ['initialising', 'named', 'anonymous', 'signedOut', 'degraded', 'error']) {
            assert.equal(requirePage(snap(status), 'calendar').decision, 'allow');
        }
    });
    test('every decision carries a non-empty reason string', () => {
        const d = requirePage(snap('named', ADMIN), 'operations');
        assert.equal(typeof d.reason, 'string');
        assert.ok(d.reason.length > 0);
        assert.ok(Object.isFrozen(d));
    });
});
