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
/** Click handlers the notices attach, by `<id>:<type>` — so a test can take the CTA (block 5). */
/** @type {Map<string, Function>} */ let _listeners = new Map();
function fakeEl(/** @type {string} */ id) {
    return { id, addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) { _listeners.set(`${id}:${type}`, fn); } };
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
    _reads = []; _writes = []; _archived = []; _openedViaHelper = []; _directOpens = 0; _listeners = new Map();
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
    await drain();
    mock.timers.tick(2000);
}
/** The gate chains a SECOND await after access (`after` — the forced set-password step, v23.21),
 *  so one microtask is no longer enough to reach the defer. Drain a handful rather than count
 *  hops: a count is the kind of number that is right until the next await is added. */
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

// THE CLOCK IS PINNED, and to a date rather than to "today", because a notice has a life: the
// members-audience one expires 90 days after posting and the audience matrix below can only be exercised
// while more than one audience is live. Pinning it also removes the class of bug this repo has
// already had twice — an assertion that is true on the day it is written.
//
// A notice posted AFTER this date fails these tests loudly rather than quietly dropping out of the
// matrix. That is the intended behaviour: move the date, do not delete the case.
const PINNED_NOW = new Date(2026, 8, 10, 9, 0);   // after al-booking-2026's 8 Sep 2026 posting

/** Every notice this module carries, as the pairing that decides who sees it. Read from the source
 *  so a notice added later joins the matrix instead of being missed by it. */
const NOTICES = [...SOURCE.matchAll(/getElementById\('(\w+NoticeLb)'\)[\s\S]*?_openWhenAudienceAllows\(lb, '([a-z-]+)'\)/g)]
    .map(m => ({ overlay: m[1], audience: m[2] }));

/** The notice's own done key, read from the IIFE that declares the overlay — never guessed from its id. */
function DONE_KEY_OF(/** @type {{overlay: string}} */ n) {
    const iife = SOURCE.slice(SOURCE.indexOf(`getElementById('${n.overlay}')`) - 800, SOURCE.indexOf(`getElementById('${n.overlay}')`));
    const m = /const DONE_KEY\s*=\s*'([^']+)'/.exec(iife);
    if (!m) throw new Error(`no DONE_KEY declared before ${n.overlay}`);
    return m[1];
}

/** The real rule — pure, so mocking it would only test the mock. */
const { noticeAudienceAllows } = await import('./calendar-access-core.js');

/**
 * An access type at least one live notice is addressed to, DERIVED rather than written down.
 *
 * Block 2 below is about WHEN a notice opens, not who for, so it needs an access type that shows
 * something — and which one that is depends on the notices that happen to be live. It was `'none'`
 * while `sign-in-2026` was `'signed-out'`; retiring it at v23.23 left only a `'members'` notice and
 * turned three timing tests into assertions that nothing opens, which they would have passed
 * whatever the timing did. Deriving it means the next notice cannot repeat that.
 */
const SHOWING_ACCESS = /** @type {const} */ (['named', 'viewer', 'none'])
    .find(t => NOTICES.some(n => noticeAudienceAllows(n.audience, t)));
assert.ok(SHOWING_ACCESS, 'no live notice is addressed to any access type — block 2 would prove nothing');

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
    function expectedFor(accessType) {
        return NOTICES.filter(n => noticeAudienceAllows(n.audience, accessType)).map(n => n.overlay).sort();
    }

    test('the matrix has notices to be about, and says what it can prove with them', () => {
        // WHAT THE ROWS BELOW PROVE DEPENDS ON HOW MANY AUDIENCES ARE LIVE, and that changed at
        // v23.23 when `sign-in-2026` was retired, leaving one notice and one audience.
        //
        // With one audience the rows still catch a module that never checks at all: a `'members'`
        // notice must be shown to `named` and withheld from `viewer`/`none`, so an ungated module
        // fails three rows. What they can no longer distinguish is a module that HARDCODES
        // members-only from one that reads each notice's declared audience — the two behave
        // identically until a second audience exists. That gap is closed statically instead, by
        // the forwarding contract in block 4, and it closes itself the moment a `'signed-out'`
        // notice returns, because this matrix is derived from the source rather than hand-kept.
        assert.equal(NOTICES.length >= 1, true, `found ${NOTICES.length} notices`);
        assert.deepEqual(NOTICES.filter(n => !n.audience), [], 'every notice declares an audience');
    });

    for (const accessType of /** @type {const} */ (['named', 'viewer', 'none'])) {
        test(`${accessType}: exactly the notices addressed to it`, async () => {
            assert.deepEqual(await shownTo(accessType), expectedFor(accessType));
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
        await wire({ accessType: SHOWING_ACCESS });
        mock.timers.tick(10_000);                          // all the defer in the world
        await Promise.resolve();
        assert.equal(_openedViaHelper.length, 0, 'at wiring time every device looks the same');
        await settleAccess();
        assert.equal(_openedViaHelper.length > 0, true);
    });

    test('nothing opens before the 1500ms defer, which keeps it off the Huddle auto-open', async () => {
        await wire({ accessType: SHOWING_ACCESS });
        _access.decide();
        await _access.promise;
        await drain();
        mock.timers.tick(1400);
        assert.equal(_openedViaHelper.length, 0);
        mock.timers.tick(200);
        assert.equal(_openedViaHelper.length > 0, true);
    });

    test('a notice opens through openNoticeIfClear, never lightbox.open()', async () => {
        // v19.53: with two overlays up, one Escape ran BOTH onClose callbacks — the buried notice was
        // archived and flagged seen by somebody who never saw it.
        await wire({ accessType: SHOWING_ACCESS });
        await settleAccess();
        assert.equal(_directOpens, 0);
        assert.equal(_openedViaHelper.length > 0, true);
    });
});


describe('3 · one notice silencing another', () => {
    // THE BEHAVIOURAL FORM OF THIS NEEDS TWO NOTICES, and since v23.23 there is one. It is kept as
    // a contract on the STRUCTURE that makes it true, which is the same move the module header's
    // own promise takes: each notice bails with `return`, so as plain blocks those returns would
    // leave `initCalendarNotices` and the first dismissed notice would silence every later one —
    // silently, and only on the devices that had dismissed it. The IIFE is the scope those returns
    // need, and it is checkable with any number of notices, including the next one added.
    test('each notice is its own IIFE, so a `return` cannot leave initCalendarNotices', () => {
        const ids   = SOURCE.match(/const NOTICE_ID\s*=/g) ?? [];
        const iifes = SOURCE.match(/\(function \(\) \{/g) ?? [];
        assert.equal(ids.length > 0, true, 'the fixture must not pass by finding no notices');
        assert.equal(iifes.length, ids.length,
            'one IIFE per notice — a notice written as a plain block silences every one after it');
    });

    test('a dismissed notice is not re-read, and does not stop the wiring', async () => {
        // The behavioural half that survives one notice: a device that has dismissed it is left
        // alone, nothing opens, and `initCalendarNotices` still completes rather than throwing.
        // READ FROM THE SOURCE, not derived from the overlay id. This line used to build
        // `myb_notice_al_done` from `alNoticeLb` — a key nothing reads — so the store was ignored,
        // the notice ran normally, and the assertion passed only because the mocked opener never
        // reaches `onOpen`. A test that passes on the wrong key is the shape this repo keeps finding.
        const done = DONE_KEY_OF(NOTICES[0]);
        await wire({ accessType: 'named', store: { [done]: '1' } });
        await settleAccess();
        assert.equal(_writes.length, 0, 'a dismissed notice writes nothing further');
    });

    test('a missing overlay element skips only its own notice', async () => {
        // With one notice this proves the skip is clean — no open, no write, no throw. With two or
        // more it proves the stronger thing: the notice whose markup IS present still runs.
        const [first, ...rest] = NOTICES;
        await wire({ accessType: SHOWING_ACCESS, present: [first.overlay] });   // any rest's markup absent
        await settleAccess();
        assert.equal(_openedViaHelper.length, noticeAudienceAllows(first.audience, SHOWING_ACCESS) ? 1 : 0,
            'the notice whose markup IS present is unaffected by the ones that are not');

        await wire({ accessType: SHOWING_ACCESS, present: [] });        // every notice's markup absent
        await settleAccess();
        assert.equal(_openedViaHelper.length, 0, 'no markup, no notice — and no throw');
        assert.deepEqual(_writes, [], 'a notice with no markup must not flag the device seen');
        assert.equal(rest.length >= 0, true);
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

    test('the gate FORWARDS each notice\'s declared audience rather than hardcoding one', () => {
        // THE CONTRACT THE ONE-AUDIENCE MATRIX LEANS ON (v23.23 — see block 1). While every live
        // notice is `'members'`, a module that ignored the declaration and demanded a named session
        // would behave identically and pass every behavioural row. What distinguishes them is that
        // the parameter reaches the rule, so that is asserted directly: `noticeAudienceAllows` must
        // be called with the `audience` ARGUMENT, never with a literal.
        const body = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
        assert.match(body, /noticeAudienceAllows\(\s*audience\s*,/,
            'the declared audience must reach the rule — a literal here silently pins every notice to one audience');
        assert.equal((body.match(/noticeAudienceAllows\(/g) ?? []).length, 1,
            'one call, inside _openWhenAudienceAllows — a second is a second policy');
    });

    test('every audience named is one the rule understands', async () => {
        const named = [...SOURCE.matchAll(/_openWhenAudienceAllows\(lb, '([a-z-]+)'\)/g)].map(m => m[1]);
        assert.equal(named.length > 0, true);
        for (const a of named) {
            // An unrecognised audience must not silently behave like 'everyone'.
            const seenBySomebody = ['named', 'viewer', 'none'].some(t => noticeAudienceAllows(a, /** @type {any} */ (t)));
            const seenByEverybody = ['named', 'viewer', 'none'].every(t => noticeAudienceAllows(a, /** @type {any} */ (t)));
            assert.equal(seenBySomebody, true, `audience '${a}' reaches nobody`);
            assert.equal(seenByEverybody, a === 'everyone', `audience '${a}' reaches everybody`);
        }
    });
});


describe('5 · the leave reminder is a ONE-OFF (v23.60, owner decision)', () => {
    // It shipped on the actionable pattern — a 7-day snooze on any dismissal, a day on the CTA,
    // repeating until its 90-day expiry — and the owner ruled it a heads-up, not a nag. Organised by
    // what a wrong answer COSTS: COMING BACK is the shipped defect and the quiet one (a member who
    // has read it is told again next week, and the week after, and reads the app as nagging), while
    // NEVER SHOWING is what a careless fix produces — the notice deleted rather than made one-off.
    const LEAVE  = NOTICES.find(n => n.overlay === 'alNoticeLb');
    const DONE   = DONE_KEY_OF(LEAVE);
    const SNOOZE = /const SNOOZE_KEY\s*=\s*'([^']+)'/.exec(SOURCE)[1];
    const GO_ID  = LEAVE.overlay.replace(/Lb$/, 'Go');
    // Its audience is 'members', so a named session shows it. The CTA element has to EXIST in the
    // fake page for the notice to attach its handler — `present` defaults to the overlays alone.
    const SHOWN  = { accessType: 'named', present: [LEAVE.overlay, GO_ID] };

    test('the keys came from the source and are the notice\'s own', () => {
        assert.match(DONE, /^myb_notice_al_booking_2026_done$/);
        assert.match(SNOOZE, /^myb_notice_al_booking_2026_snooze$/);
    });

    test('a device that has never dismissed it still gets it, ONCE — the fix must not delete the notice', async () => {
        await wire(SHOWN);
        await settleAccess();
        assert.equal(_openedViaHelper.length, 1, 'it opens');
        assert.deepEqual(_writes, [], 'and nothing is flagged until the member dismisses it');
    });

    test('closing it — the ×, the backdrop, Escape or "Not now" — marks it DONE and writes no snooze', async () => {
        await wire(SHOWN);
        await settleAccess();
        _openedViaHelper[0]._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']], 'exactly one write: done. A snooze here is the defect coming back');
    });

    test('taking the CTA marks it DONE too — the member acted and does not need telling again', async () => {
        await wire(SHOWN);
        await settleAccess();
        const go = _listeners.get(`${GO_ID}:click`);
        assert.ok(go, `the CTA (#${GO_ID}) has a click handler`);
        go();
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('a snooze left by the OLD rule is a dismissal: promoted to done, nothing shown', async () => {
        // A snooze can only have been written by somebody who closed the notice, so under the new
        // rule they have seen it. Both a live snooze and a LAPSED one — the lapsed one is exactly
        // the device that would have been nagged again on its next open.
        for (const offsetDays of [+3, -1]) {
            const stamp = new Date(Date.now() + offsetDays * 86_400_000).toISOString();
            await wire({ ...SHOWN, store: { [SNOOZE]: stamp } });
            await settleAccess();
            assert.equal(_openedViaHelper.length, 0, `snooze ${offsetDays}d: not shown`);
            assert.deepEqual(_writes, [[DONE, '1']], `snooze ${offsetDays}d: promoted to done`);
        }
    });

    test('once done, it stays done', async () => {
        await wire({ ...SHOWN, store: { [DONE]: '1' } });
        await settleAccess();
        assert.equal(_openedViaHelper.length, 0);
        assert.deepEqual(_writes, []);
    });
});
