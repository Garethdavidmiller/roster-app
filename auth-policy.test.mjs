/**
 * Unit tests for auth-policy.js — the page-authorisation layer (Phase 3).
 * `requirePageAuth` is pure (explicit roles); `requirePage`/`rolesFor` read the real CONFIG.
 * No mocks. Part of test:hygiene.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { requirePageAuth, requirePage, rolesFor, isOvertimeReviewer, canOpenOvertime, overtimeEnabled, admitsStaffPin,
    PAGE_POLICIES, DECISIONS } from './auth-policy.js';
import { CONFIG } from './roster-data.js';

// Real role names, derived from CONFIG so the tests don't hard-code (and don't break if a name
// changes). A synthetic name guaranteed to hold NO role.
const ADMIN     = CONFIG.ADMIN_NAMES[0];
const MANAGER   = CONFIG.MANAGER_NAMES[0];
// The Links designers. The admin alone since 9 Nov 2026 (owner: "hide the link designer page from everyone apart from
// me"), so no real name is a designer and nothing else any more: the designer rows below run over the whole list, and
// the designer-but-not-admin seat is held by claimsForTier (roster-parse-helpers.test.mjs) and by the browser specs,
// which give themselves a designer list of their own (e2e/fixtures.js → withLinksDesigners).
const DESIGNERS = CONFIG.LINKS_DESIGNERS;
const PLAIN     = 'Z. Nobody';   // in no role list

const ROLES = { admin: { admin: true }, manager: { manager: true }, designer: { designer: true }, none: {} };
const snap  = (status, member = null) => ({ status, member });

describe('rolesFor (real CONFIG)', () => {
    test('admin name → admin true', () => assert.equal(rolesFor(ADMIN).admin, true));
    test('manager name → manager true, admin false', () => {
        const r = rolesFor(MANAGER);
        assert.equal(r.manager, true); assert.equal(r.admin, false);
    });
    test('designer follows LINKS_DESIGNERS: every name on it, and nobody outside it', () => {
        assert.ok(DESIGNERS.length > 0, 'somebody can open the Links workspace');
        for (const n of DESIGNERS) assert.equal(rolesFor(n).designer, true, `${n} is on the list`);
        assert.ok(!DESIGNERS.includes(MANAGER), 'premise: the manager below is not a designer');
        assert.equal(rolesFor(MANAGER).designer, false, 'a manager is not thereby a designer');
        assert.equal(rolesFor(PLAIN).designer, false);
    });
    // deepEqual, not a per-flag check: the SHAPE is the contract. `requirePageAuth` reads
    // `roles[r]` for each name in a page's role list, so a flag that quietly stops being returned
    // makes every page requiring it fail closed — and a flag that quietly appears is a new
    // privilege nobody reviewed. Either way the shape is what has to be pinned.
    const NO_ROLES = { admin: false, manager: false, designer: false, overtimeBeta: false, newlinkPreview: false, newlinkAudience: false };
    test('a name in no list → all false', () => assert.deepEqual(rolesFor(PLAIN), NO_ROLES));
    test('null/undefined → all false', () => {
        assert.deepEqual(rolesFor(null), NO_ROLES);
        assert.deepEqual(rolesFor(undefined), NO_ROLES);
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
    test('links: every designer → allow, a non-designer → forbidden', () => {
        for (const n of DESIGNERS) assert.equal(requirePage(snap('named', n), 'links').decision, 'allow', n);
        assert.equal(requirePage(snap('named', MANAGER), 'links').decision, 'forbidden');
        assert.equal(requirePage(snap('named', PLAIN),   'links').decision, 'forbidden');
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
    // WHY AN ORDINARY UNKNOWN NAME CANNOT SEE THIS GUARD. `requirePage` looks a page up with
    // `Object.prototype.hasOwnProperty.call`, and the block above — `'bogus'` — answers the same
    // under every wrong spelling of that lookup: `'bogus' in PAGE_POLICIES` is false, and
    // `PAGE_POLICIES['bogus']` is undefined, so the strict default is reached either way. Replacing
    // the guard with a bare index left every one of those assertions green (measured).
    //
    // The names that separate them are the ones JavaScript hands out for free. `PAGE_POLICIES` is an
    // object literal, so it inherits `toString`, `constructor`, `valueOf`, `hasOwnProperty` and
    // `__proto__` — all truthy. A bare index returns one of those as the "policy", `requireNamed` is
    // then undefined on it, and `requirePageAuth` reads that as a PUBLIC page: **allow, to an
    // anonymous visitor.** The guard's whole purpose is that inversion, so this is the only shape of
    // test that can fail when it goes.
    const PROTOTYPE_NAMES = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'];
    test('a page named after an Object.prototype member fails closed, like any other unknown page', () => {
        for (const page of PROTOTYPE_NAMES) {
            assert.equal(requirePage(snap('anonymous'), page).decision, 'login',
                `anonymous/${page} must not be answered as a public page`);
            assert.equal(requirePage(snap('named', PLAIN), page).decision, 'forbidden',
                `named non-admin/${page} must not be allowed`);
            assert.equal(requirePage(snap('named', ADMIN), page).decision, 'allow',
                `${page} must still clear for an admin — fail-closed, not fail-broken`);
        }
    });
    test('and the inherited members really are reachable on PAGE_POLICIES — or the case above is vacuous', () => {
        // The guard-on-the-guard. If PAGE_POLICIES ever became a null-prototype object or a Map,
        // every assertion above would pass without exercising anything, and the lookup could quietly
        // revert to a bare index with nothing to say so.
        for (const page of PROTOTYPE_NAMES) {
            assert.ok(/** @type {any} */ (PAGE_POLICIES)[page],
                `PAGE_POLICIES no longer inherits "${page}" — the prototype-name cases are vacuous`);
            assert.ok(!Object.prototype.hasOwnProperty.call(PAGE_POLICIES, page),
                `"${page}" is now a real page — pick a different inherited name for this case`);
        }
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

describe('the Overtime beta participant — invited to ANSWER, never to look', () => {
    // Two audiences reach one page and they must not converge. A beta member fills in their own
    // availability; a reviewer sees everybody's. The v20.76 addition of the first beta CEA is what
    // surfaced that the page had only ever had the reviewer answer — the pill was reviewer-gated
    // and this very policy demanded an admin/manager role, so a member the SERVER fully intended
    // to ask would have found no link in the drawer and a "not open to everyone yet" panel if she
    // typed the URL. Her form would have been sitting on the server the whole time.
    //
    // The live list can be EMPTY (7 Oct 2026: both participants withdrawn). The two predicates still
    // have to stay apart for the next person invited, so when nobody is on the list a stand-in is
    // invited for the length of this block and removed after — a real roster CEA, so the name
    // resolves exactly as an invited one would. Skipping instead would leave the safety property
    // below unpinned for precisely as long as nobody is watching it.
    const live = CONFIG.OVERTIME_BETA || [];
    const beta = live[0] ?? 'T. Bibi';
    const ordinary = 'A. Nobody';
    const invited = !live.length;
    // SWITCHED ON for this block (Overtime is paused, Nov 2026): these are the audience rules the
    // feature returns with, so they are pinned with the switch on, through the same seam the browser
    // suites use. The pause itself is pinned in its own block below.
    const seamWas = /** @type {any} */ (globalThis).__E2E;
    before(() => {
        if (invited) CONFIG.OVERTIME_BETA = [beta];
        /** @type {any} */ (globalThis).__E2E = { ...(seamWas || {}), overtimeEnabled: true };
    });
    after(() => {
        if (invited) CONFIG.OVERTIME_BETA = live;
        /** @type {any} */ (globalThis).__E2E = seamWas;
    });

    test('a beta member may OPEN Overtime', () => {
        assert.ok(beta, 'no beta member to pin');
        assert.equal(canOpenOvertime(beta), true);
        assert.equal(requirePage({ status: 'named', member: beta }, 'overtime').decision, 'allow');
    });

    test('and is NOT a reviewer — the two predicates stay apart', () => {
        // The whole safety property. If a future edit widens `isOvertimeReviewer` to include the
        // beta list "so the pill works", this member starts seeing colleagues' declarations.
        assert.equal(isOvertimeReviewer(beta), false);
        assert.equal(rolesFor(beta).admin, false);
        assert.equal(rolesFor(beta).manager, false);
        assert.equal(rolesFor(beta).overtimeBeta, true);
    });

    test('an ordinary member is still refused the page entirely', () => {
        assert.equal(canOpenOvertime(ordinary), false);
        assert.equal(rolesFor(ordinary).overtimeBeta, false);
        assert.equal(requirePage({ status: 'named', member: ordinary }, 'overtime').decision, 'forbidden');
    });

    test('a reviewer can still open it, by the reviewer route', () => {
        const manager = (CONFIG.MANAGER_NAMES || [])[0];
        assert.equal(isOvertimeReviewer(manager), true);
        assert.equal(canOpenOvertime(manager), true);
    });

    test('the beta list opens no OTHER role-gated page', () => {
        // It is not a role, and a page policy that happened to accept it would be a privilege
        // escalation through a list nobody thinks of as one.
        //
        // The page list is DERIVED from PAGE_POLICIES rather than written here, so a role-gated
        // page added later is covered without anyone remembering. Writing it by hand also got this
        // wrong first time: `admin` looked like an obvious inclusion and is in fact `role: null` —
        // the staff self-service portal every named member uses — so the assertion failed on
        // correct code. A derived list cannot make that mistake.
        //
        // The property is that the LIST changes nothing, so each page is decided twice — with the member on the list and
        // with them taken off — and the two must agree. Asserting 'forbidden' outright stopped being the property at v25.60,
        // when the new link page opened to every colleague on a normal CEA contract: the stand-in is one, and reaches that
        // page as a colleague, not as an invitee.
        const gated = Object.entries(PAGE_POLICIES)
            .filter(([name, p]) => name !== 'overtime' && p.role && p.role.length)
            .map(([name]) => name);
        assert.ok(gated.length >= 2, `expected other role-gated pages, found ${gated.join(',')}`);
        const decide = (/** @type {string} */ page) => requirePage({ status: 'named', member: beta }, page).decision;
        const listed = CONFIG.OVERTIME_BETA;
        for (const page of gated) {
            const onTheList = decide(page);
            CONFIG.OVERTIME_BETA = listed.filter(n => n !== beta);
            let offTheList;
            try { offTheList = decide(page); } finally { CONFIG.OVERTIME_BETA = listed; }
            assert.equal(onTheList, offTheList, `${page}: the Overtime beta list changed the decision`);
        }
        assert.ok(gated.some(page => decide(page) === 'forbidden'), 'no role-gated page refuses the stand-in, so the check above proves nothing');
    });
});

describe('Overtime paused (owner, Nov 2026) — closed to everyone, the admin included', () => {
    // CONFIG.OVERTIME_ENABLED is the one switch. While it is false, `canOpenOvertime` is false for
    // every audience, so the pill leaves every menu; the page asks `overtimeEnabled()` itself.
    const admin = (CONFIG.ADMIN_NAMES || [])[0];
    const manager = (CONFIG.MANAGER_NAMES || [])[0];
    const seamWas = /** @type {any} */ (globalThis).__E2E;
    after(() => { /** @type {any} */ (globalThis).__E2E = seamWas; });

    test('switched off, nobody can open Overtime — not the admin, not a manager, not an invited member', () => {
        /** @type {any} */ (globalThis).__E2E = { overtimeEnabled: false };
        for (const who of [admin, manager, 'T. Bibi', null]) assert.equal(canOpenOvertime(who), false, String(who));
    });

    test('with no seam, the answer is the committed switch — and only an explicit true is on', () => {
        // Holds either way the switch sits, so switching Overtime back on needs no test edit here.
        /** @type {any} */ (globalThis).__E2E = undefined;
        assert.equal(overtimeEnabled(), CONFIG.OVERTIME_ENABLED === true);
    });

    test('the test seam switches it on only with a real boolean', () => {
        /** @type {any} */ (globalThis).__E2E = { overtimeEnabled: true };
        assert.equal(overtimeEnabled(), true);
        assert.equal(canOpenOvertime(admin), true, 'switched on, the admin reaches it again by the reviewer route');
        // A non-boolean seam is IGNORED, so the committed switch decides — tried at BOTH committed
        // values, set on CONFIG here and put back, never by editing the source (test audit, 7 Nov 2026).
        // This asserted that a seam of 'yes' reads false, which holds only while the switch is off,
        // so following "To bring it back" failed here despite the docs promising no test edit.
        const committed = CONFIG.OVERTIME_ENABLED;
        try {
            for (const sw of [false, true]) {
                CONFIG.OVERTIME_ENABLED = sw;
                for (const junk of ['yes', 'false', 1, 0, null]) {
                    /** @type {any} */ (globalThis).__E2E = { overtimeEnabled: junk };
                    assert.equal(overtimeEnabled(), sw, `a seam of ${JSON.stringify(junk)} overrode a committed ${sw}`);
                }
                /** @type {any} */ (globalThis).__E2E = { overtimeEnabled: !sw };
                assert.equal(overtimeEnabled(), !sw, `a real boolean seam must override a committed ${sw}`);
            }
        } finally {
            CONFIG.OVERTIME_ENABLED = committed;
        }
    });
});

describe('the station PIN — which pages it may read (v24.84)', () => {
    // The PIN is a capability, not a person, so it is a flag beside the policy rather than a value of
    // `named`: requirePageAuth never sees it. Trains joined the Calendar on 22 Oct 2026 (owner). A
    // flag that crept onto a page with member data would let the station PC keep its PIN there —
    // the page would still show its sign-in, so only this list can see it happen.
    test('the Calendar and Trains, and nothing else', () => {
        const admitted = Object.keys(PAGE_POLICIES).filter(admitsStaffPin);
        assert.deepEqual(admitted.sort(), ['calendar', 'trains']);
        assert.equal(admitsStaffPin('no-such-page'), false, 'an unknown page admits nothing');
    });
    test('admitting the PIN changes nothing about who counts as a member there', () => {
        assert.equal(requirePage({ status: 'signedOut', member: null }, 'trains').decision, 'login',
            'Trains still asks a signed-out browser to sign in — the PIN is asked for separately, first');
    });
});
