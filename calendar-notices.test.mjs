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
// The Year to Date notice asks whose Pay Calculator this is, through the session, when it OPENS.
// `roster-data.js` is left REAL — it is pure, and the roles it holds are the thing being asked.
/** @type {{ name: string } | null} */ let _session = null;
mock.module('./session.js', {
    namedExports: { getSession: () => _session },
});
mock.module('./calendar-access.js', {
    namedExports: {
        calendarAccessReady: { then: (/** @type {any} */ fn) => _access.promise.then(fn) },
        getAccessType: () => _accessType,
    },
});

let _n = 0;
/** Wire the notices with the timers under test control, then let the access decision land.
 *  A named access carries a member's session — a CEA, whom the Pay Calculator prices — and the PIN
 *  and a locked page carry none, which is what each of those really holds. */
async function wire({ accessType = 'none', present = NOTICES.map(n => n.overlay), store = {}, expired = false,
                      session = accessType === 'named' ? { name: 'G. Miller' } : null } = {}) {
    _present = new Set(present);
    _accessType = accessType;
    _session = session;
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
// Moved on (v24.82) from 10 Sep 2026, when timetable-2026 was posted on 21 Oct — still inside
// al-booking-2026's 90 days, so both live notices are in the matrix.
const PINNED_NOW = new Date(2026, 9, 22, 9, 0);   // after timetable-2026's 21 Oct 2026 posting

/** Every notice this module carries, as the pairing that decides who sees it. Read from the source
 *  so a notice added later joins the matrix instead of being missed by it. A notice may pass the gate
 *  a further condition (`[,)]` — v24.86), and may FOLLOW another: it is wired only once that
 *  notice's done flag was set on an earlier load, and the matrix has to know which those are. */
const NOTICES = [...SOURCE.matchAll(/getElementById\('(\w+NoticeLb)'\)[\s\S]*?_openWhenAudienceAllows\(lb, '([a-z-]+)'[,)]/g)]
    .map(m => ({ overlay: m[1], audience: m[2], follows: FOLLOWS_OF(m[1]) }));

/** The IIFE that declares a notice's overlay — its own scope, so a key read from it is that notice's.
 *  (This was an 800-character window before the overlay line, which is right until a notice with a
 *  long comment sits after a short one and the window reaches back into its neighbour.) */
function IIFE_OF(/** @type {string} */ overlay) {
    const at = SOURCE.indexOf(`getElementById('${overlay}')`);
    if (at < 0) throw new Error(`no notice declares ${overlay}`);
    return SOURCE.slice(SOURCE.lastIndexOf('(function () {', at), SOURCE.indexOf('}());', at));
}

/** The notice's own done key, read from the IIFE that declares the overlay — never guessed from its id. */
function DONE_KEY_OF(/** @type {{overlay: string}} */ n) {
    const m = /const DONE_KEY\s*=\s*'([^']+)'/.exec(IIFE_OF(n.overlay));
    if (!m) throw new Error(`no DONE_KEY declared in ${n.overlay}'s notice`);
    return m[1];
}

/** The done key of the notice this one waits behind, or null for a notice that waits for none. */
function FOLLOWS_OF(/** @type {string} */ overlay) {
    return /const FOLLOWS\s*=\s*'([^']+)'/.exec(IIFE_OF(overlay))?.[1] ?? null;
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
    /** @param {'named'|'viewer'|'none'} accessType @param {Record<string, string>} [store] */
    async function shownTo(accessType, store = {}) {
        await wire({ accessType, store });
        await settleAccess();
        return _openedViaHelper.map(lb => lb._cfg.overlay.id).sort();
    }
    /** Addressed to this access type, not already done, and — for a notice that follows another —
     *  behind one that IS done. @param {'named'|'viewer'|'none'} accessType @param {Record<string, string>} [store] */
    function expectedFor(accessType, store = {}) {
        return NOTICES.filter(n => noticeAudienceAllows(n.audience, accessType)
            && !store[DONE_KEY_OF(n)] && (!n.follows || !!store[n.follows])).map(n => n.overlay).sort();
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
        // A notice whose gate call the pattern cannot read would silently drop out of every row.
        assert.equal(NOTICES.length, (SOURCE.match(/const NOTICE_ID\s*=/g) ?? []).length,
            'every notice the module declares is in the matrix');
    });

    for (const accessType of /** @type {const} */ (['named', 'viewer', 'none'])) {
        test(`${accessType}: exactly the notices addressed to it`, async () => {
            assert.deepEqual(await shownTo(accessType), expectedFor(accessType));
        });
    }

    // A NOTICE THAT FOLLOWS ANOTHER IS ABSENT FROM THE ROWS ABOVE BY DESIGN — they run on a device
    // that has dismissed nothing, which is exactly where a follower stays unwired. So it gets rows of
    // its own, on a device whose earlier load set the flags it waits for; without them the audience
    // gate would be proved for every notice except the one that waits (v24.86).
    for (const accessType of /** @type {const} */ (['named', 'viewer', 'none'])) {
        test(`${accessType}: a notice that follows another, once that one is done`, async () => {
            const store = Object.fromEntries(NOTICES.filter(n => n.follows).map(n => [/** @type {string} */ (n.follows), '1']));
            assert.ok(Object.keys(store).length > 0, 'no live notice follows another — this row would prove nothing');
            assert.deepEqual(await shownTo(accessType, store), expectedFor(accessType, store));
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

    test('a dismissed notice does not silence the one after it — the behavioural form, back with two (v24.82)', async () => {
        // The shape the IIFE contract above guards, driven for real now that two notices are live:
        // the first is dismissed on this device, and the second must still open.
        assert.ok(NOTICES.length >= 2, `needs two notices to be about anything, found ${NOTICES.length}`);
        const [first, second] = NOTICES;
        await wire({ accessType: 'named', store: { [DONE_KEY_OF(first)]: '1' } });
        await settleAccess();
        const opened = _openedViaHelper.map(lb => lb._cfg.overlay.id);
        assert.ok(!opened.includes(first.overlay), 'the dismissed one stays dismissed');
        assert.ok(opened.includes(second.overlay), 'the one after it still opens — a plain block would have returned out of the wiring');
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
        const named = [...SOURCE.matchAll(/_openWhenAudienceAllows\(lb, '([a-z-]+)'[,)]/g)].map(m => m[1]);
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


/** The last day the October notices are offered, as the module declares it. */
const OCTOBER_LAST_DAY = /** @type {RegExpExecArray} */ (/const OCTOBER_LAST_DAY = '([^']+)'/.exec(SOURCE))[1];

describe('6 · the timetable notice: a one-off from the start, offered to the end of October (v24.82; v24.86)', () => {
    // Owner request, 21 Oct 2026: tell members a new timetable is coming and send them to the Trains
    // page to learn it. One-off on the rule block 5 settled, so the costs are the same two: coming
    // back nags, never showing means nobody is told.
    const TT    = /** @type {{ overlay: string, audience: string }} */ (NOTICES.find(n => n.overlay === 'timetableNoticeLb'));
    const DONE  = DONE_KEY_OF(TT);
    const GO_ID = 'timetableNoticeGo';
    const SHOWN = { accessType: /** @type {const} */ ('named'), present: [TT.overlay, GO_ID] };
    const IIFE  = (() => {
        const start = SOURCE.indexOf("NOTICE_ID   = 'timetable-2026'");
        return SOURCE.slice(start, SOURCE.indexOf('}());', start));
    })();

    test('it is in the matrix, addressed to members, with its own key and no snooze', () => {
        assert.ok(TT, 'found by the same pattern as every other notice');
        assert.equal(TT.audience, 'members', 'the Trains page signs people in — on the PIN its link would meet only a sign-in');
        assert.match(DONE, /^myb_notice_timetable_2026_done$/);
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
    });

    test('it is offered to the end of 31 October, the Year to Date notice\'s last day too (owner, 22 Oct 2026)', () => {
        // It shipped running 53 days to 13 December, the day the timetable starts; the owner brought
        // it forward to end with the notice that waits behind it. A DATE, not a count from posting —
        // the clocks go back on 25 October, and a count from the 21st would have ended at 23:00 on
        // the 31st. That `isNoticeExpired(day, 1)` keeps all of that day is pinned in nav-panel.test.mjs.
        assert.equal(OCTOBER_LAST_DAY, '31 Oct 2026');
        assert.match(IIFE, /isNoticeExpired\(OCTOBER_LAST_DAY, 1\)/, 'the shared last day, not a count of its own');
        assert.doesNotMatch(IIFE, /isNoticeExpired\(NOTICE_DATE/, 'no second end date beside the shared one');
    });

    test('a member who has not seen it gets it, and nothing is flagged until they act', async () => {
        await wire(SHOWN);
        await settleAccess();
        assert.equal(_openedViaHelper.length, 1);
        assert.deepEqual(_writes, []);
    });

    test('every close — the ×, the backdrop, Escape, "Not now" — marks it done, and nothing else', async () => {
        await wire(SHOWN);
        await settleAccess();
        _openedViaHelper[0]._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('taking the link to the Trains page marks it done too', async () => {
        await wire(SHOWN);
        await settleAccess();
        const go = _listeners.get(`${GO_ID}:click`);
        assert.ok(go, `the link (#${GO_ID}) has a click handler`);
        go();
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('archived on OPEN, so the drawer keeps it after the link has taken the member away', async () => {
        await wire(SHOWN);
        await settleAccess();
        _openedViaHelper[0]._cfg.onOpen();
        assert.deepEqual(_archived.map(n => [n.id, n.section, n.date]), [['timetable-2026', 'Trains', '21 Oct 2026']]);
    });

    test('past its life, a device that never saw it is flagged and shown nothing', async () => {
        await wire({ ...SHOWN, expired: true });
        await settleAccess();
        assert.equal(_openedViaHelper.length, 0);
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('once done, it stays done', async () => {
        await wire({ ...SHOWN, store: { [DONE]: '1' } });
        await settleAccess();
        assert.equal(_openedViaHelper.length, 0);
        assert.deepEqual(_writes, []);
    });
});


describe('7 · the Year to Date notice: the load AFTER the timetable one, to members the Pay Calculator prices (v24.86)', () => {
    // Owner request, 22 Oct 2026: teach the Pay Calculator's Year to Date figures, link to the card,
    // and only "the time after the trains app notice". Organised by what a wrong answer costs:
    // arriving on the SAME load stacks two notices on one visit (what the owner asked to avoid);
    // arriving at a Dispatcher or a manager advertises a page that refuses them; never arriving at
    // all means the colleague who would gain most from the figures is never told they exist.
    const YTD   = /** @type {{ overlay: string, audience: string, follows: string|null }} */ (NOTICES.find(n => n.overlay === 'ytdNoticeLb'));
    const TT    = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'timetableNoticeLb'));
    const DONE  = DONE_KEY_OF(YTD);
    const GO_ID = 'ytdNoticeGo';
    const IIFE  = IIFE_OF('ytdNoticeLb');
    /** A device whose earlier load dismissed the timetable notice, with a CEA signed in. */
    const SHOWN = { accessType: /** @type {const} */ ('named'), present: [YTD.overlay, GO_ID],
                    store: { [DONE_KEY_OF(TT)]: '1' } };
    const ytdOpened = () => _openedViaHelper.some(lb => lb._cfg.overlay.id === YTD.overlay);

    test('it is in the matrix, addressed to members, with its own key, no snooze, behind the REAL timetable key', () => {
        assert.ok(YTD, 'found by the same pattern as every other notice');
        assert.equal(YTD.audience, 'members', 'it is about your pay — on the PIN it addresses nobody');
        assert.match(DONE, /^myb_notice_ytd_figures_2026_done$/);
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
        // FOLLOWS restates the timetable notice's key. A renamed key on either side would leave this
        // notice waiting for a flag nothing writes — silently, for as long as it is live.
        assert.equal(YTD.follows, DONE_KEY_OF(TT));
        assert.match(IIFE, /isNoticeExpired\(OCTOBER_LAST_DAY, 1\)/, 'it ends with the timetable notice');
    });

    test('NOT on the load that dismisses the timetable notice — even after that notice is closed', async () => {
        await wire({ accessType: 'named', present: [TT.overlay, YTD.overlay, GO_ID] });
        await settleAccess();
        const tt = _openedViaHelper.find(lb => lb._cfg.overlay.id === TT.overlay);
        assert.ok(tt, 'the timetable notice opens first');
        tt._cfg.onClose();                                   // dismissed: its flag is written now…
        assert.deepEqual(_writes, [[DONE_KEY_OF(TT), '1']]);
        mock.timers.tick(10_000);                            // …and nothing follows it up this visit
        await drain();
        assert.equal(ytdOpened(), false, 'the follower was never wired on this load');
    });

    test('the load after, it opens — and nothing is flagged until the member acts', async () => {
        await wire(SHOWN);
        await settleAccess();
        assert.equal(ytdOpened(), true);
        assert.deepEqual(_writes, []);
    });

    test('for a CES too: the grade the Pay Calculator prices is the test, not one role', async () => {
        await wire({ ...SHOWN, session: { name: 'F. Mohamed' } });   // a CES on the roster
        await settleAccess();
        assert.equal(ytdOpened(), true);
    });

    test('never to a member the Pay Calculator turns away — and never flagged for them', async () => {
        // Its own refusal is `gradeForRole`; the same function decides here. A refused member is left
        // unflagged, like an out-of-audience device: the notice is not theirs to have seen.
        for (const name of ['D. Minto', 'S. Stewart', 'Z. Nobody']) {          // Dispatcher · manager · not on the roster
            await wire({ ...SHOWN, session: { name } });
            await settleAccess();
            assert.equal(ytdOpened(), false, `${name}: not offered`);
            assert.deepEqual(_writes, [], `${name}: not flagged`);
        }
    });

    test('whose calculator it is, is read when the notice OPENS — a front-door sign-in on this load', async () => {
        // At wiring time a member signing in at the Calendar's front door has no session yet. Read
        // then, the notice would be refused on exactly the load they signed in on.
        await wire({ ...SHOWN, session: null });
        _session = { name: 'G. Miller' };                    // signed in before access is decided
        await settleAccess();
        assert.equal(ytdOpened(), true);
    });

    test('every close — the ×, the backdrop, Escape, "Not now" — marks it done, and nothing else', async () => {
        await wire(SHOWN);
        await settleAccess();
        /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === YTD.overlay))._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('taking the link to the Year to Date card marks it done too', async () => {
        await wire(SHOWN);
        await settleAccess();
        const go = _listeners.get(`${GO_ID}:click`);
        assert.ok(go, `the link (#${GO_ID}) has a click handler`);
        go();
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('archived on OPEN, so the drawer keeps it after the link has taken the member away', async () => {
        await wire(SHOWN);
        await settleAccess();
        /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === YTD.overlay))._cfg.onOpen();
        assert.deepEqual(_archived.map(n => [n.id, n.section, n.date]), [['ytd-figures-2026', 'Pay', '22 Oct 2026']]);
    });

    test('past 31 October, a device that never saw it is flagged and shown nothing', async () => {
        await wire({ ...SHOWN, expired: true });
        await settleAccess();
        assert.equal(ytdOpened(), false);
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('once done, it stays done', async () => {
        await wire({ ...SHOWN, store: { ...SHOWN.store, [DONE]: '1' } });
        await settleAccess();
        assert.equal(ytdOpened(), false);
        assert.deepEqual(_writes, []);
    });

    test('its link names the card the Pay Calculator opens by that name', () => {
        // The journey itself is e2e (paycalc.spec.js); this catches a rename on either page.
        const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
        const href = /id="ytdNoticeGo"/.test(page) && /href="\.\/paycalc\.html#(\w+)" id="ytdNoticeGo"/.exec(page)?.[1];
        assert.equal(href, 'payslipCard');
        assert.match(readFileSync(new URL('./paycalc.html', import.meta.url), 'utf8'), /id="payslipCard"/);
        assert.match(readFileSync(new URL('./paycalc-app.js', import.meta.url), 'utf8'),
            /openCardNamedByHash\('payslipCard', 'payslipCardBody', 'payslipCardToggle'\)/);
    });
});
