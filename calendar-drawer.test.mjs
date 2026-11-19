// @ts-check
/**
 * calendar-drawer.test.mjs — the Calendar's menu is built for the session saved when it is built, and
 * a rebuild takes the old one down first and builds it for the session saved NOW.
 * Run with: node --test --experimental-test-module-mocks calendar-drawer.test.mjs
 *
 * The drawer itself (`nav-panel.js`) is replaced by a recorder, so these assert what the Calendar ASKS
 * for and in what order: a rebuild that built before resetting would leave two drawers, and one that
 * reused the load-time identity would show the person who signed in a menu with no name and no
 * Sign out — the gap the in-place sign-in (v26.40, calendar-access.js → `finishSignIn`) depends on this closing.
 * The roster and the page-access rules are the real ones, so the admin and member cases are the
 * roster's own.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** Everything the drawer was asked to do, in order. @type {Array<{ op: string, opts?: any }>} */
let calls = [];
/** @type {{ name: string }|null} */ let session = null;

mock.module('./nav-panel.js', { namedExports: {
    initNavPanel: (/** @type {any} */ opts) => { calls.push({ op: 'init', opts }); },
    resetNavPanel: () => { calls.push({ op: 'reset' }); },
} });
mock.module('./session.js', { namedExports: { getSession: () => session } });

const { CONFIG, teamMembers } = await import('./roster-data.js');
const { canOpenNewlink } = await import('./auth-policy.js');
const drawer = await import('./calendar-drawer.js');

const ADMIN = CONFIG.ADMIN_NAMES[0];
/** A current member who is no admin, no Links designer and no manager — an ordinary colleague. */
const MEMBER = /** @type {any} */ (teamMembers.find((/** @type {any} */ m) => !m.hidden
    && !CONFIG.ADMIN_NAMES.includes(m.name) && !CONFIG.LINKS_DESIGNERS.includes(m.name)
    && !(CONFIG.MANAGER_NAMES ?? []).includes(m.name))).name;

/** Page hooks that record their use. */
function hooks() {
    const used = /** @type {string[]} */ ([]);
    return {
        used,
        deps: {
            authReady: Promise.resolve(),
            onLogoClick: () => used.push('about'),
            onSignOut: () => used.push('signOut'),
            isViewer: () => false,
            lock: () => { used.push('lock'); },
            canReadDocuments: () => true,
        },
    };
}

beforeEach(() => { calls = []; session = null; });

describe('calendarDrawerOptions — the drawer a session gets', () => {
    test('nobody signed in (locked, or the staff PIN): no name, no Sign out, no admin pills', () => {
        const { deps } = hooks();
        const o = drawer.calendarDrawerOptions(null, deps);
        assert.equal(o?.memberName, null);
        assert.equal(o?.onSignOut, null, 'no member footer for nobody');
        assert.equal(o?.isAdmin, false);
        assert.equal(o?.isLinksDesigner, false);
        assert.equal(o?.currentPage, 'calendar');
        assert.equal(o?.onLockCalendar?.isViewer, deps.isViewer, 'the PIN\'s Lock Calendar is offered either way, read at open');
    });

    test('a member: their name, and a Sign out that runs the page\'s own sign-out', () => {
        const { deps, used } = hooks();
        const o = drawer.calendarDrawerOptions({ name: MEMBER }, deps);
        assert.equal(o?.memberName, MEMBER);
        assert.equal(o?.isAdmin, false);
        assert.equal(o?.canOpenNewlink, canOpenNewlink(MEMBER), 'pill gates come from the page-access rules');
        assert.equal(typeof o?.onSignOut, 'function');
        o?.onSignOut?.();
        assert.deepEqual(used, ['signOut']);
    });

    test('the admin gets the admin and Links pills', () => {
        const o = drawer.calendarDrawerOptions({ name: ADMIN }, hooks().deps);
        assert.equal(o?.isAdmin, true);
        assert.equal(o?.isLinksDesigner, CONFIG.LINKS_DESIGNERS.includes(ADMIN));
    });

    test('the hooks pass through unchanged — they do not depend on who is signed in', () => {
        const { deps } = hooks();
        const o = drawer.calendarDrawerOptions({ name: MEMBER }, deps);
        assert.equal(o?.authReady, deps.authReady);
        assert.equal(o?.onLogoClick, deps.onLogoClick);
        assert.equal(o?.canReadDocuments, deps.canReadDocuments);
        assert.equal(o?.onLockCalendar?.lock, deps.lock);
    });
});

describe('wiring and rebuilding', () => {
    test('a rebuild before the page has wired the drawer does nothing', async () => {
        const fresh = await import('./calendar-drawer.js?unwired');
        assert.equal(fresh.rewireCalendarDrawer(), false);
        assert.deepEqual(calls, [], 'no reset of a drawer that was never built');
    });

    test('the page\'s one call builds the drawer for the session saved then', () => {
        session = null;
        drawer.wireCalendarDrawer(hooks().deps);
        assert.deepEqual(calls.map(c => c.op), ['init']);
        assert.equal(calls[0].opts.memberName, null);
    });

    test('after a sign-in without a reload, a rebuild takes the old drawer down FIRST, then builds it for the member', () => {
        const { deps, used } = hooks();
        session = null;                               // the Calendar loaded locked
        drawer.wireCalendarDrawer(deps);
        session = { name: ADMIN };                     // signed in in place
        assert.equal(drawer.rewireCalendarDrawer(), true);
        assert.deepEqual(calls.map(c => c.op), ['init', 'reset', 'init'], 'reset before init, or two drawers');
        const rebuilt = calls[2].opts;
        assert.equal(rebuilt.memberName, ADMIN, 'the name read NOW, not the one the page loaded with');
        assert.equal(rebuilt.isAdmin, true);
        assert.equal(typeof rebuilt.onSignOut, 'function');
        rebuilt.onLogoClick();
        rebuilt.onSignOut();
        assert.deepEqual(used, ['about', 'signOut'], 'the same page hooks as the first build');
    });

    test('a rebuild after the session has gone builds the signed-out drawer again', () => {
        session = { name: MEMBER };
        drawer.wireCalendarDrawer(hooks().deps);
        session = null;
        drawer.rewireCalendarDrawer();
        assert.equal(calls.at(-1)?.opts.memberName, null);
        assert.equal(calls.at(-1)?.opts.onSignOut, null);
    });
});
