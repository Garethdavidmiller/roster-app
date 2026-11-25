// @ts-check
// @lane hygiene
/**
 * nav-gates.test.mjs — the pills the drawer DRAWS for a person are the pages the page policy LETS THEM
 * OPEN, in both directions, for every name on the roster and for nobody (signed out).
 * Run: node scripts/run-tests.mjs test/nav-gates.test.mjs   (part of `npm run test:hygiene` — needs nothing installed)
 *
 * The behaviour, through the REAL functions: `navGatesFor` (auth-policy.js, which every page spreads
 * into `initNavPanel`), `visiblePills` over the real `NAV_PAGES` (nav-destinations.js), against
 * `requirePage` (auth-policy.js) and Overtime's pause switch. The two ways they can disagree are not
 * equally visible:
 *
 *   pill shown, page refuses   → the member taps and is turned away. Annoying, and obvious.
 *   pill HIDDEN, page admits   → the page is reachable by typing its URL and by nothing else. Silent,
 *                                and it has happened (the Overtime pill, drawn only on its own page).
 *
 * A signed-in member sees exactly the pages they may open. Signed out, every
 * ungated pill is drawn ON PURPOSE (owner, 11 Nov 2026: each opens with the person's own sign-in, and
 * hiding them from a station would hide that they exist) and every gated one is hidden.
 *
 * Roles the real lists hold nobody in today (a Links designer who is not the admin, an Overtime beta
 * participant) are given to a real member for the test and taken back, so the roles are exercised by
 * the real code rather than by roles made up for the test.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_PAGES, PILL_GATES, visiblePills } from '../nav-destinations.js';
import { navGatesFor, requirePage, overtimeEnabled, PAGE_POLICIES } from '../auth-policy.js';
import { CONFIG, teamMembers } from '../roster-data.js';

const g = /** @type {any} */ (globalThis);
const restores = /** @type {Array<() => void>} */ ([]);
const PILL_IDS = NAV_PAGES.map(p => p.id);
/** The one gate that takes pills AWAY from a grade rather than giving them to a role: an Other Staff login loses
 *  Admin and Pay (owner, 23 Nov 2026). Everybody else, nobody signed in included, keeps them. */
const EXCLUDING = ['otherStaffHidden'];
/** Pills only a ROLE opens. */
const GATED = NAV_PAGES.filter(p => Object.keys(PILL_GATES).some(f => !EXCLUDING.includes(f) && /** @type {any} */ (p)[f])).map(p => p.id);
/** Pills an Other Staff login does not see. */
const NOT_FOR_OTHER_STAFF = NAV_PAGES.filter(p => /** @type {any} */ (p).otherStaffHidden).map(p => p.id);

/** An INVENTED "Other Staff" row for one test (tests use invented people only); `afterEach` takes it back. */
function withOtherStaff(/** @type {string} */ name) {
    teamMembers.push(/** @type {any} */ ({ name, currentWeek: 1, rosterType: 'main', role: 'Other Staff', hidden: true, otherStaff: true }));
    restores.push(() => { const i = teamMembers.findIndex(m => m.name === name); if (i !== -1) teamMembers.splice(i, 1); });
}

/** The pills the drawer draws for this member, by id. */
const drawn = (/** @type {string|null} */ member) => visiblePills(NAV_PAGES, navGatesFor(member), 'calendar').map(p => p.id);
/** The pages with a pill this member may open, as the page itself decides: its policy, and Overtime's pause. */
const admitted = (/** @type {string} */ member) => PILL_IDS.filter(id =>
    requirePage({ status: 'named', member }, id).decision === 'allow' && (id !== 'overtime' || overtimeEnabled()));

/** Give `member` a place on a CONFIG list for one test; `afterEach` takes it back. */
function withRole(/** @type {'LINKS_DESIGNERS'|'OVERTIME_BETA'|'NEWLINK_PREVIEW'} */ list, /** @type {string} */ member) {
    const before = [.../** @type {any} */ (CONFIG)[list]];
    /** @type {any} */ (CONFIG)[list] = [...before, member];
    restores.push(() => { /** @type {any} */ (CONFIG)[list] = before; });
}

/** A current member found on the roster rather than named, so a leaver cannot break the test. */
function someone(/** @type {string} */ what, /** @type {(m: any) => boolean} */ f) {
    const m = teamMembers.find(x => !x.hidden && !CONFIG.ADMIN_NAMES.includes(x.name) && !(CONFIG.MANAGER_NAMES || []).includes(x.name) && f(x));
    assert.ok(m, `the roster has ${what}`);
    return /** @type {string} */ (m.name);
}

/** Every person the test asks about: the whole roster (managers included), and the representatives by name. */
const everyone = () => [...new Set([...teamMembers.map(m => m.name), ...CONFIG.ADMIN_NAMES, ...(CONFIG.MANAGER_NAMES || [])])];

for (const paused of [true, false]) {
    describe(`the pills drawn are the pages the policy admits — Overtime ${paused ? 'PAUSED' : 'switched on'}`, () => {
        // The browser suites' own seam (auth-policy.js → `overtimeEnabled`): both states of the switch, so the
        // Overtime gate is checked while it is paused AND as it will be when it returns.
        const seam = () => { g.__E2E = { overtimeEnabled: !paused }; };
        afterEach(() => { restores.splice(0).forEach(fn => fn()); delete g.__E2E; });

        test('the premises: the gate set, the switch, and a role the policy gates', () => {
            seam();
            assert.equal(overtimeEnabled(), !paused);
            assert.ok(GATED.length >= 4, `expected the four gated pills, read ${GATED}`);
            for (const id of GATED) assert.ok(PAGE_POLICIES[id]?.role?.length, `${id}'s pill is gated, so its page policy must name a role`);
            assert.deepEqual(NOT_FOR_OTHER_STAFF, ['admin', 'paycalc'], 'an Other Staff login loses exactly Admin and Pay');
            for (const id of NOT_FOR_OTHER_STAFF) assert.ok(!PAGE_POLICIES[id]?.otherStaff, `${id} is hidden from Other Staff, so its policy must not admit them`);
            for (const id of PILL_IDS.filter(x => !NOT_FOR_OTHER_STAFF.includes(x) && !GATED.includes(x))) {
                assert.ok(PAGE_POLICIES[id]?.otherStaff, `${id} is drawn for Other Staff, so its policy must admit them`);
            }
        });

        test('an Other Staff login (invented): exactly the Calendar, Trains and Settings, drawn ⇔ admitted', () => {
            const name = 'Q. Example';
            withOtherStaff(name);
            seam();
            assert.deepEqual(drawn(name), admitted(name), 'the pills drawn and the pages admitted differ');
            assert.deepEqual(drawn(name), ['calendar', 'trains', 'settings'],
                'what the staff PIN read until it was retired (23 Nov 2026), and Settings beside it');
        });

        test('every name on the roster: drawn ⇔ admitted, in both directions', () => {
            seam();
            /** @type {string[]} */ const wrong = [];
            for (const member of everyone()) {
                const d = drawn(member), a = admitted(member);
                const shownRefused = d.filter(id => !a.includes(id));
                const hiddenAdmitted = a.filter(id => !d.includes(id));
                if (shownRefused.length) wrong.push(`${member}: drawn but the page refuses — ${shownRefused.join(', ')}`);
                if (hiddenAdmitted.length) wrong.push(`${member}: the page admits but no pill is drawn — ${hiddenAdmitted.join(', ')}`);
            }
            assert.deepEqual(wrong, []);
        });

        test('the representatives: admin, manager, Links designer, Overtime beta, a plain member', () => {
            const admin = CONFIG.ADMIN_NAMES[0];
            const manager = /** @type {string} */ ((CONFIG.MANAGER_NAMES || [])[0]);
            const designer = someone('a member to make a Links designer', m => m.role === 'CEA');
            const beta = someone('a member to invite to the Overtime beta', m => m.role === 'CEA' && m.name !== designer);
            const plain = someone('a plain member (a Dispatcher)', m => m.role === 'Dispatcher');
            withRole('LINKS_DESIGNERS', designer);
            withRole('OVERTIME_BETA', beta);
            seam();
            for (const member of [admin, manager, designer, beta, plain]) {
                assert.deepEqual(drawn(member), admitted(member), `${member}: the pills drawn and the pages admitted differ`);
            }
            // …and the roles really do move the pills, so the equalities above are not all one answer.
            assert.ok(drawn(admin).includes('operations') && !drawn(manager).includes('operations'), 'Operations is the admin\'s alone');
            assert.ok(drawn(designer).includes('links') && !drawn(plain).includes('links'), 'Links is the designers\'');
            assert.equal(drawn(beta).includes('overtime'), !paused, 'an Overtime beta participant sees Overtime exactly while it is on');
            assert.equal(drawn(manager).includes('overtime'), !paused, 'and so does a reviewer');
            assert.equal(drawn(plain).includes('overtime'), false, 'never a member with neither');
            assert.ok(!drawn(plain).includes('newlink'), 'a Dispatcher is not the new link\'s audience');
        });

        test('nobody signed in: every ungated pill drawn, every gated one hidden', () => {
            seam();
            assert.deepEqual(drawn(null), PILL_IDS.filter(id => !GATED.includes(id)),
                'a signed-out drawer shows Admin, Pay and Settings on purpose (each asks for a sign-in), and no role-gated page');
            assert.deepEqual(navGatesFor(null), { isAdmin: false, isLinksDesigner: false, canOpenOvertime: false, canOpenNewlink: false, isNotOtherStaff: true });
            assert.deepEqual(navGatesFor(undefined), navGatesFor(null));
        });
    });
}

describe('visiblePills — the one filter', () => {
    test('the current page is drawn as current, never omitted', () => {
        const pills = visiblePills(NAV_PAGES, {}, 'settings');
        assert.deepEqual(pills.filter(p => p.current).map(p => p.id), ['settings']);
        assert.ok(pills.length > 1, 'the rest of the map is still drawn');
    });
    test('each flag reads its own gate, and only its own', () => {
        for (const [flag, gate] of Object.entries(PILL_GATES)) {
            const page = NAV_PAGES.find(p => /** @type {any} */ (p)[flag]);
            assert.ok(page, `a NAV_PAGES entry carries ${flag}`);
            assert.ok(visiblePills(NAV_PAGES, { [gate]: true }, '').some(p => p.id === page.id), `${flag} opens on ${gate}`);
            const others = Object.fromEntries(Object.values(PILL_GATES).filter(x => x !== gate).map(x => [x, true]));
            assert.ok(!visiblePills(NAV_PAGES, others, '').some(p => p.id === page.id), `${flag} stays shut on every other gate`);
        }
    });
});
