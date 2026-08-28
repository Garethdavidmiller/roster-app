/**
 * calendar-notices.test.mjs — WHO A NOTICE IS ADDRESSED TO, AND WHETHER IT ASKS.
 * Run with: node --experimental-test-module-mocks --test calendar-notices.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `noticeAudienceAllows` is pure and already pinned in `calendar-access-core.test.mjs`. That rule
 * was never the defect: the defect (v21.81) was that every notice on this page opened on the
 * PIN-unlocked station PC, because no notice ASKED. The rule was right and unwired — the named risk
 * in CLAUDE.md, in the one place where being unwired shows a colleague's business to whoever is
 * standing at a shared machine.
 *
 * So the contracts here are about the WIRING, and they are of two kinds on purpose:
 *
 *   · BEHAVIOURAL, driven through `initCalendarNotices` with a fake page and a controllable access
 *     decision — because "does it wait for the decision, and does it leave an out-of-audience device
 *     untouched?" are properties of when things run, not of what any function returns.
 *   · STATIC, over the module's own source — because the module header's promise is about a notice
 *     that does not exist yet ("a notice added later cannot skip the check"), and no behavioural test
 *     can be written against code nobody has written. A notice also has a LIFE: the members-audience
 *     one live when this was written retires at a fixed clock time, and a suite that could only see
 *     the audience gate through it would quietly stop seeing it at all.
 *
 * ── THE FAKES ───────────────────────────────────────────────────────────────────────────────────
 *
 * `calendar-access-core.js` is the REAL module — it is pure, so mocking it would only test the mock.
 * Everything else is faked so the page, the clock and the access decision can be placed exactly.
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./calendar-notices.js', import.meta.url), 'utf8');

// ── THE PAGE ────────────────────────────────────────────────────────────────────────────────────
/** @type {Set<string>} */ let _present = new Set();
function fakeEl(/** @type {string} */ id) {
    return { id, addEventListener() {} };
}
global.document = {
    getElementById: (/** @type {string} */ id) => (_present.has(id) ? fakeEl(id) : null),
};

// ── THE ACCESS DECISION ─────────────────────────────────────────────────────────────────────────
// A thenable rather than a promise, so each test can supply its own gate even though the module
// captures `calendarAccessReady` once, at import.
/** @type {{ promise: Promise<void>, decide: () => void }} */
let _access;
function newAccessGate() {
    /** @type {() => void} */ let decide = () => {};
    const promise = new Promise(res => { decide = () => res(); });
    return { promise, decide };
}
/** @type {'named'|'viewer'|'none'} */
let _accessType = 'none';

// ── THE REST OF THE APP ─────────────────────────────────────────────────────────────────────────
/** @type {Record<string, string>} */ let _store = {};
/** @type {string[]} */              let _reads = [];
/** @type {Array<[string, string]>} */ let _writes = [];
/** @type {any[]} */                 let _archived = [];
/** @type {any[]} */                 let _openedViaHelper = [];
let _directOpens = 0;
let _expired = false;

mock.module('./roster-data.js', { namedExports: { CONFIG: { SIGN_IN_NOTICE_DAYS: 90 } } });
mock.module('./ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => { _reads.push(k); return _store[k] ?? null; },
        lsSet: (/** @type {string} */ k, /** @type {string} */ v) => { _writes.push([k, v]); _store[k] = v; },
    },
});
mock.module('./nav-panel.js', {
    namedExports: {
        archiveNotice: (/** @type {any} */ n) => { _archived.push(n); },
        isNoticeExpired: () => _expired,
    },
});
mock.module('./overlay.js', {
    namedExports: {
        createLightbox: (/** @type {any} */ cfg) => ({
            _cfg: cfg,
            open() { _directOpens += 1; },      // must never be reached — see the v19.53 rule
            close() {},
        }),
        openNoticeIfClear: (/** @type {any} */ lb) => { _openedViaHelper.push(lb); },
    },
});
mock.module('./calendar-access.js', {
    namedExports: {
        calendarAccessReady: { then: (/** @type {any} */ fn) => _access.promise.then(fn) },
        getAccessType: () => _accessType,
    },
});

let _n = 0;
/** Wire the notices with the timers under test control, then let the access decision land. */
async function wire({ accessType = 'none', present = NOTICES.map(n => n.overlay), store = {}, expired = false } = {}) {
    _present = new Set(present);
    _accessType = accessType;
    _store = { ...store };
    _reads = []; _writes = []; _archived = []; _openedViaHelper = []; _directOpens = 0;
    _expired = expired;
    _access = newAccessGate();
    const mod = await import(`./calendar-notices.js?n=${++_n}`);
    mod.initCalendarNotices();
    return mod;
}
/** Let the access promise settle, then run the notices' 1500ms defer. */
async function settleAccess() {
    _access.decide();
    await _access.promise;
    await Promise.resolve();
    mock.timers.tick(2000);
}

// THE CLOCK IS PINNED, and to a date rather than to "today", because a notice has a life: the
// members-audience one carries a hard cutoff and the audience matrix below can only be exercised
// while more than one audience is live. Pinning it also removes the class of bug this repo has
// already had twice — an assertion that is true on the day it is written.
//
// A notice posted AFTER this date fails these tests loudly rather than quietly dropping out of the
// matrix. That is the intended behaviour: move the date, do not delete the case.
const PINNED_NOW = new Date(2026, 7, 25, 9, 0);

/** Every notice this module carries, as the pairing that decides who sees it. Read from the source
 *  so a notice added later joins the matrix instead of being missed by it. */
const NOTICES = [...SOURCE.matchAll(/getElementById\('(\w+NoticeLb)'\)[\s\S]*?_openWhenAudienceAllows\(lb, '([a-z-]+)'\)/g)]
    .map(m => ({ overlay: m[1], audience: m[2] }));

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PINNED_NOW }); });
afterEach(() => { mock.timers.reset(); });


describe('1 · a notice reaching somebody it is not addressed to', () => {
    /** @param {'named'|'viewer'|'none'} accessType */
    async function shownTo(accessType) {
        await wire({ accessType });
        await settleAccess();
        return _openedViaHelper.map(lb => lb._cfg.overlay.id).sort();
    }
    /** @param {'named'|'viewer'|'none'} accessType */
    async function expectedFor(accessType) {
        const { noticeAudienceAllows } = await import('./calendar-access-core.js');
        return NOTICES.filter(n => noticeAudienceAllows(n.audience, accessType)).map(n => n.overlay).sort();
    }

    test('the module carries more than one audience, or this matrix proves nothing', () => {
        assert.equal(NOTICES.length >= 2, true, `found ${NOTICES.length} notices`);
        assert.equal(new Set(NOTICES.map(n => n.audience)).size >= 2, true,
            'with one audience every row below would pass on a module that never checks');
    });

    for (const accessType of /** @type {const} */ (['named', 'viewer', 'none'])) {
        test(`${accessType}: exactly the notices addressed to it`, async () => {
            assert.deepEqual(await shownTo(accessType), await expectedFor(accessType));
        });
    }

    test('a device outside the audience is NOT flagged seen', async () => {
        // The whole point of refusing rather than dismissing: the notice has to survive to arrive
        // when that device is signed in. Flagging it here would burn it on somebody who never saw it.
        await wire({ accessType: 'viewer' });
        await settleAccess();
        const refused = NOTICES.filter(n => !_openedViaHelper.some(lb => lb._cfg.overlay.id === n.overlay));
        assert.equal(refused.length > 0, true, 'the fixture needs a refused notice to be about anything');
        assert.deepEqual(_writes, [], 'a refused notice writes nothing about this device');
    });
});


describe('2 · a notice arriving at the wrong moment', () => {
    test('nothing opens before the access decision lands', async () => {
        await wire({ accessType: 'none' });
        mock.timers.tick(10_000);                          // all the defer in the world
        await Promise.resolve();
        assert.equal(_openedViaHelper.length, 0, 'at wiring time every device looks the same');
        await settleAccess();
        assert.equal(_openedViaHelper.length > 0, true);
    });

    test('nothing opens before the 1500ms defer, which keeps it off the Huddle auto-open', async () => {
        await wire({ accessType: 'none' });
        _access.decide();
        await _access.promise;
        await Promise.resolve();
        mock.timers.tick(1400);
        assert.equal(_openedViaHelper.length, 0);
        mock.timers.tick(200);
        assert.equal(_openedViaHelper.length > 0, true);
    });

    test('a notice opens through openNoticeIfClear, never lightbox.open()', async () => {
        // v19.53: with two overlays up, one Escape ran BOTH onClose callbacks — the buried notice was
        // archived and flagged seen by somebody who never saw it.
        await wire({ accessType: 'none' });
        await settleAccess();
        assert.equal(_directOpens, 0);
        assert.equal(_openedViaHelper.length > 0, true);
    });
});


describe('3 · one notice silencing another', () => {
    test('a dismissed notice does not stop the ones after it being considered', async () => {
        // Each notice is its own IIFE because their bodies bail with `return`. As plain blocks those
        // returns left initCalendarNotices, so the first dismissed notice silenced every later one —
        // silently, and only for the devices that had dismissed it.
        const first = 'myb_notice_sign_in_2026_done';
        await wire({ accessType: 'none', store: { [first]: '1' } });
        await settleAccess();
        const later = _reads.filter(k => k !== first);
        assert.equal(later.length > 0, true, 'a later notice still reads its own key');
    });

    test('a missing overlay element skips only its own notice', async () => {
        const [first, ...rest] = NOTICES;
        assert.equal(rest.length > 0, true, 'needs a second notice to be about anything');
        await wire({ accessType: 'none', present: [first.overlay] });   // the rest's markup absent
        await settleAccess();
        const { noticeAudienceAllows } = await import('./calendar-access-core.js');
        assert.equal(_openedViaHelper.length, noticeAudienceAllows(first.audience, 'none') ? 1 : 0,
            'the notice whose markup IS present is unaffected by the ones that are not');
    });
});


describe('4 · a notice added later skipping the check', () => {
    // The module header promises this, and the promise is about code nobody has written yet — so it
    // is kept over the source. Both contracts are teeth: each fires on the shape the defect takes.
    test('every notice routes through _openWhenAudienceAllows', async () => {
        const notices = SOURCE.match(/const NOTICE_ID\s*=/g) ?? [];
        const gated   = SOURCE.match(/_openWhenAudienceAllows\(/g) ?? [];
        assert.equal(notices.length > 0, true, 'the fixture must not pass by finding no notices');
        assert.equal(gated.length, notices.length + 1, 'one call per notice, plus the declaration');
    });

    test('nothing opens a notice by any other route', async () => {
        const body = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
        assert.doesNotMatch(body, /\blb\.open\(/, 'openNoticeIfClear is the only way in (v19.53)');
        // openNoticeIfClear itself may appear exactly once — inside _openWhenAudienceAllows.
        assert.equal((body.match(/openNoticeIfClear\(/g) ?? []).length, 1,
            'calling it per notice would let the next one be wired without the audience check');
    });

    test('every audience named is one the rule understands', async () => {
        const named = [...SOURCE.matchAll(/_openWhenAudienceAllows\(lb, '([a-z-]+)'\)/g)].map(m => m[1]);
        assert.equal(named.length > 0, true);
        const { noticeAudienceAllows } = await import('./calendar-access-core.js');
        for (const a of named) {
            // An unrecognised audience must not silently behave like 'everyone'.
            const seenBySomebody = ['named', 'viewer', 'none'].some(t => noticeAudienceAllows(a, /** @type {any} */ (t)));
            const seenByEverybody = ['named', 'viewer', 'none'].every(t => noticeAudienceAllows(a, /** @type {any} */ (t)));
            assert.equal(seenBySomebody, true, `audience '${a}' reaches nobody`);
            assert.equal(seenByEverybody, a === 'everyone', `audience '${a}' reaches everybody`);
        }
    });
});
