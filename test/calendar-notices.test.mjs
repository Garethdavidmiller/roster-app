// @lane unit
/**
 * calendar-notices.test.mjs — WHO A NOTICE IS ADDRESSED TO, AND WHETHER IT ASKS.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs test/calendar-notices.test.mjs
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

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const SOURCE = readFileSync(new URL('./calendar-notices.js', REPO_ROOT_URL), 'utf8');

// ── THE PAGE ────────────────────────────────────────────────────────────────────────────────────
/** @type {Set<string>} */ let _present = new Set();
/** Click handlers the notices attach, by `<id>:<type>` — so a test can take the CTA (blocks 5–7). */
/** @type {Map<string, Function>} */ let _listeners = new Map();
/** One element per id for the whole wiring, so a line the install notice hides STAYS hidden (block 5). */
/** @type {Map<string, any>} */ let _els = new Map();
/** Every element a notice pressed (`el.click()`), in order — the Team View notice presses the page's own button. */
/** @type {string[]} */ let _clicks = [];
function fakeEl(/** @type {string} */ id) {
    return { id, hidden: undefined,
             click() { _clicks.push(id); },
             addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) { _listeners.set(`${id}:${type}`, fn); } };
}
global.document = {
    getElementById: (/** @type {string} */ id) => {
        if (!_present.has(id)) return null;
        if (!_els.has(id)) _els.set(id, fakeEl(id));
        return _els.get(id);
    },
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
/** @type {string[]} */              let _closed = [];
/** Every expiry question's answer: one flag for all of them, or — for a case that needs a notice past its end
 *  while another is not (block 12) — a function of the arguments the module passes `isNoticeExpired`.
 *  @type {boolean | ((day: string, days: number) => boolean)} */
let _expired = false;

mock.module('../ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => { _reads.push(k); return _store[k] ?? null; },
        lsSet: (/** @type {string} */ k, /** @type {string} */ v) => { _writes.push([k, v]); _store[k] = v; },
        // Storage that keeps a flag (block 15 turns it off): with none, no notice is wired at all.
        lsAvailable: () => _storageWorks,
    },
});
/** Whether storage keeps what is written — false is Safari with every cookie blocked, or a full quota. */
let _storageWorks = true;
/** Every record `reviseArchivedNotice` was handed, on this wiring. @type {any[]} */
let _revised = [];
mock.module('../notice-archive.js', {
    namedExports: {
        archiveNotice: (/** @type {any} */ n) => { _archived.push(n); },
        reviseArchivedNotice: (/** @type {any} */ n) => { _revised.push(n); },
        isNoticeExpired: (/** @type {string} */ day, /** @type {number} */ days) => typeof _expired === 'function' ? _expired(day, days) : _expired,
    },
});
/** The screen is already taken when a notice's moment comes — `openNoticeIfClear` refuses, as the real one
 *  does with another notice or overlay up. @type {boolean} */
let _screenTaken = false;
/** The first notice to open takes the screen, so every later one is refused — the real helper on one load. */
let _oneScreen = false;
/** Every click a notice's link handed to `followLinkOutOf`, with the notice it was handed for (18 Nov 2026). @type {Array<{ lb: any, e: any }>} */
let _followed = [];
mock.module('../overlay.js', {
    namedExports: {
        createLightbox: (/** @type {any} */ cfg) => ({
            _cfg: cfg,
            open() { _directOpens += 1; },      // must never be reached — see the v19.53 rule
            close() { _closed.push(cfg.overlay.id); },
        }),
        // The real one replaces the notice's history entry with the link's page; that is overlay-history.test.mjs's.
        followLinkOutOf: (/** @type {any} */ lb, /** @type {any} */ e) => { _followed.push({ lb, e }); return true; },
        // Its real contract: true when it opened the notice, false when the screen was not clear.
        openNoticeIfClear: (/** @type {any} */ lb) => {
            if (_screenTaken) return false;
            _openedViaHelper.push(lb);
            if (_oneScreen) _screenTaken = true;
            return true;
        },
    },
});
// The Year to Date notice asks whose Pay Calculator this is, through the session, when it OPENS.
// `roster-data.js` is left REAL — it is pure, and the roles it holds are the thing being asked.
/** @type {{ name: string } | null} */ let _session = null;
mock.module('../session.js', {
    namedExports: { getSession: () => _session },
});
// The install notice asks install-prompt.js what this browser can do, and tells it when to stand the
// strip down. Faked so a test can BE an iPhone, the mirror or a desktop; the real detection is driven
// in a browser (e2e/calendar-notices.spec.js). Every call is recorded, in order.
/** @type {{ how: 'prompt'|'ios'|'menu', mirror: boolean } | null} */
let _route = { how: 'menu', mirror: false };
/** @type {string[]} */ let _installCalls = [];
/** Is the page served from the GitHub Pages mirror? Only the "move to the main address" notice asks, on every device.
 *  Off by default; the move notice's block turns it on. */
let _onMirror = false;
mock.module('../install-prompt.js', {
    namedExports: {
        installRoute: () => _route,
        onPagesMirror: () => _onMirror,
        promptInstall: () => { _installCalls.push('prompt'); return true; },
        yieldToInstallNotice: () => { _installCalls.push('yield'); },
        releaseInstallNoticeYield: () => { _installCalls.push('release'); },
        retireInstallStrip: () => { _installCalls.push('retire'); },
    },
});
mock.module('../calendar-access.js', {
    namedExports: {
        calendarAccessReady: { then: (/** @type {any} */ fn) => _access.promise.then(fn) },
        getAccessType: () => _accessType,
    },
});

/** The default expiry answer since the two October notices were retired (22 Nov 2026): their shared end, the
 *  whole of 31 October, has passed once the (mocked) clock passes it — as the real `isNoticeExpired` would say,
 *  and what lets the install notice stop waiting for them (`FOLLOWED_ENDS`). Every other notice is live unless a
 *  test says otherwise. On PINNED_NOW, 22 October, this is the same answer `false` gave. */
const OCTOBER_OVER_BY_THE_CLOCK = (/** @type {string} */ day, /** @type {number} */ days) =>
    day === '31 Oct 2026' && days === 1 && Date.now() >= new Date(2026, 10, 1).getTime();

let _n = 0;
/** Wire the notices with the timers under test control, then let the access decision land.
 *  A named access carries a member's session — a CEA, whom the Pay Calculator prices — and the PIN
 *  and a locked page carry none, which is what each of those really holds. */
async function wire({ accessType = 'none', present = NOTICES.map(n => n.overlay), store = {}, expired = /** @type {typeof _expired} */ (OCTOBER_OVER_BY_THE_CLOCK),
                      session = accessType === 'named' ? { name: 'G. Miller' } : null,
                      route = /** @type {typeof _route} */ ({ how: 'menu', mirror: false }), storageWorks = true, mirror = false } = {}) {
    _storageWorks = storageWorks;
    _onMirror = mirror;
    _revised = [];
    _present = new Set(present);
    _accessType = accessType;
    _session = session;
    _route = route;
    _store = { ...store };
    _reads = []; _writes = []; _archived = []; _openedViaHelper = []; _directOpens = 0; _listeners = new Map();
    _els = new Map(); _closed = []; _installCalls = []; _screenTaken = false; _oneScreen = false; _followed = [];
    _clicks = [];
    _expired = expired;
    _access = newAccessGate();
    const mod = await import(`../calendar-notices.js?n=${++_n}`);
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
// Moved on (v24.82) from 10 Sep 2026, when timetable-2026 was posted on 21 Oct. install-app-2026 was
// posted on the 22nd, the day this already reads, so every live notice is in the matrix.
const PINNED_NOW = new Date(2026, 9, 22, 9, 0);   // after timetable-2026's posting and on install-app-2026's
/** The timetable notice's first day, after the October notices ended: a day on which a fresh device is offered
 *  a live notice (blocks 2 and 3). */
const LIVE_DAY = new Date(2026, 10, 16, 9, 0).getTime();

/** Every notice this module carries, as the pairing that decides who sees it. Read from the source
 *  so a notice added later joins the matrix instead of being missed by it. A notice may pass the gate
 *  a further condition (`[,)]` — v24.86), and may FOLLOW another: it is wired only once that
 *  notice's done flag was set on an earlier load, and the matrix has to know which those are. It may
 *  also wait for the Year to Date notice only where that one is the member's to get (`followsPay`,
 *  v24.91) — the Pay Calculator's own test decides, as it does for that notice itself — or for the
 *  install notice only where that one is this DEVICE's to get (`followsInstall`, v25.61), or for the
 *  New link notice only where that one is the MEMBER's (`followsNewlink`, v26.21). A notice may also
 *  have a final week from which it waits for none of them (`finalWeek`, v26.21). */
const NOTICES = [...SOURCE.matchAll(/getElementById\('(\w+NoticeLb)'\)[\s\S]*?_openWhenAudienceAllows\(lb, '([a-z-]+)'[,)]/g)]
    .map(m => ({ overlay: m[1], audience: m[2], follows: FOLLOWS_OF(m[1]), followsPay: FOLLOWS_PAY_OF(m[1]),
                 followsInstall: FOLLOWS_INSTALL_OF(m[1]), followsNewlink: FOLLOWS_NEWLINK_OF(m[1]),
                 starts: STARTS_OF(m[1]), finalWeek: FINAL_WEEK_OF(m[1]) }));

/** The two October notices' done keys (`timetable-2026`, `ytd-figures-2026`). Both were RETIRED on 22 Nov 2026 —
 *  markup and code gone, three weeks after they went inert — so no IIFE declares them any more; the install notice
 *  still names them (`FOLLOWS`, `FOLLOWS_PAY`) and their ends stay in `FOLLOWED_ENDS` (block 12), which is what
 *  lets every device stop waiting for them. Read from that table, never restated. */
const FOLLOWED_ENDS_SRC = /const FOLLOWED_ENDS = \{([\s\S]*?)\n\};/.exec(SOURCE)?.[1] ?? '';
const OCT_TIMETABLE_KEY = /** @type {string} */ (/(myb_notice_timetable_2026_done):/.exec(FOLLOWED_ENDS_SRC)?.[1]);
const OCT_YTD_KEY       = /** @type {string} */ (/(myb_notice_ytd_figures_2026_done):/.exec(FOLLOWED_ENDS_SRC)?.[1]);
assert.ok(OCT_TIMETABLE_KEY && OCT_YTD_KEY, 'FOLLOWED_ENDS no longer records the two October notices the install notice follows');

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

/** The done key of a notice this one waits for only where the Pay Calculator is the member's. */
function FOLLOWS_PAY_OF(/** @type {string} */ overlay) {
    return /const FOLLOWS_PAY\s*=\s*'([^']+)'/.exec(IIFE_OF(overlay))?.[1] ?? null;
}

/** The done key of the install notice, which this one waits for only where that notice is this device's —
 *  a phone or tablet in a browser (`installRoute()`), never a desktop or the installed app (v25.61). */
function FOLLOWS_INSTALL_OF(/** @type {string} */ overlay) {
    return /const FOLLOWS_INSTALL\s*=\s*'([^']+)'/.exec(IIFE_OF(overlay))?.[1] ?? null;
}

/** The done key of the New link notice, which this one waits for only where that notice is the member's —
 *  somebody the New link page lets in (`canOpenNewlink`, v26.21). */
function FOLLOWS_NEWLINK_OF(/** @type {string} */ overlay) {
    return /const FOLLOWS_NEWLINK\s*=\s*'([^']+)'/.exec(IIFE_OF(overlay))?.[1] ?? null;
}

/** The local midnight a notice starts on (`const STARTS = new Date(y, m, d)`), as a time, or null for one
 *  that starts when it ships (v24.94 — the second timetable notice was the first to have one). A notice
 *  not yet due is left out of the rows below and gets rows of its own with the clock moved to its week. */
function STARTS_OF(/** @type {string} */ overlay) {
    const m = /const STARTS\s*=\s*new Date\((\d+),\s*(\d+),\s*(\d+)\)/.exec(IIFE_OF(overlay));
    return m ? new Date(+m[1], +m[2], +m[3]).getTime() : null;
}
/** Is this notice's start behind the (mocked) clock? */
const due = (/** @type {{ starts: number|null }} */ n) => n.starts === null || Date.now() >= n.starts;

/** The local midnight from which a notice waits for neither the install nor the New link notice
 *  (`const FINAL_WEEK = new Date(y, m, d)` — v26.21, the timetable notice's last week), or null. */
function FINAL_WEEK_OF(/** @type {string} */ overlay) {
    const m = /const FINAL_WEEK\s*=\s*new Date\((\d+),\s*(\d+),\s*(\d+)\)/.exec(IIFE_OF(overlay));
    return m ? new Date(+m[1], +m[2], +m[3]).getTime() : null;
}
/** Has this notice reached the week in which it waits for nobody? */
const inFinalWeek = (/** @type {{ finalWeek: number|null }} */ n) => n.finalWeek !== null && Date.now() >= n.finalWeek;

/** Would the Pay Calculator price this session's member? The real test (pay-audience.js, by the role
 *  at the time — today's, as the notices ask it), from the real roster. */
const { teamMembers, CONFIG, isOtherStaff } = await import('../roster-data.js');
const { payCalculatorPrices } = await import('../pay-audience.js');
function payCalcFor(/** @type {{ name: string } | null} */ session) {
    return payCalculatorPrices(teamMembers.find(m => m.name === session?.name) ?? null);
}
/** The role of the REAL roster row a case leans on. The cases below name real people because the
 *  rule under test reads the real roster, so each one first asserts the person is still the kind of
 *  member the case is about (test audit, 7 Nov 2026): when S. Stewart left at v25.05 the manager case
 *  silently became a second "not on the roster" one, green whatever the manager rule did. */
const rosterRole = (/** @type {string} */ name) => teamMembers.find(m => m.name === name)?.role;

/** The real rule — pure, so mocking it would only test the mock. */
const { noticeAudienceAllows } = await import('../calendar-access-core.js');
/** The New link page's own door — real, as the module under test uses it, so a case that leans on it asks it. */
const { canOpenNewlink } = await import('../auth-policy.js');

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
     *  behind one that IS done, or that is not this member's to get. The session is the one `wire`
     *  gives each access type. @param {'named'|'viewer'|'none'} accessType @param {Record<string, string>} [store] */
    function expectedFor(accessType, store = {}) {
        const session = accessType === 'named' ? { name: 'G. Miller' } : null;
        // `followsInstall`: every row here runs on wire()'s default route, a phone browser, where the install notice
        // IS this device's to get — so the wait always applies; block 11 has the desk and the installed app.
        // `followsNewlink` waits only where the New link page would let this member in; `finalWeek` ends both waits.
        return NOTICES.filter(n => noticeAudienceAllows(n.audience, accessType)
            && due(n) && !store[DONE_KEY_OF(n)] && (!n.follows || !!store[n.follows])
            && (!n.followsPay || !!store[n.followsPay] || !payCalcFor(session))
            && (inFinalWeek(n) || ((!n.followsInstall || !!store[n.followsInstall])
                && (!n.followsNewlink || !!store[n.followsNewlink] || !canOpenNewlink(session?.name)))))
            .map(n => n.overlay).sort();
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
        assert.equal(NOTICES.length, (SOURCE.match(/const DONE_KEY\s*=/g) ?? []).length,
            'every notice the module declares is in the matrix');
    });

    for (const accessType of /** @type {const} */ (['named', 'viewer', 'none'])) {
        test(`${accessType}: exactly the notices addressed to it`, async () => {
            assert.deepEqual(await shownTo(accessType), expectedFor(accessType));
        });
    }

    // A NOTICE THAT FOLLOWS ANOTHER IS ABSENT FROM THE ROWS ABOVE BY DESIGN — they run on a device
    // that has dismissed nothing, which is exactly where a follower stays unwired. So each follower
    // gets rows of its own, on a device whose earlier loads set exactly the flags IT waits for;
    // without them the audience gate would be proved for every notice except the ones that wait
    // (v24.86). One store for all of them stopped working at v24.91, when a follower began waiting
    // for another follower: its flag marks that one done, so neither could be seen in one row.
    test('at least one live notice follows another — or the rows below prove nothing', () => {
        assert.ok(NOTICES.some(n => n.follows), 'no live notice follows another');
    });
    for (const f of NOTICES.filter(n => n.follows || n.followsInstall || n.followsNewlink)) {
        for (const accessType of /** @type {const} */ (['named', 'viewer', 'none'])) {
            test(`${accessType}: ${f.overlay}, once the notices it waits for are done`, async () => {
                const store = Object.fromEntries([f.follows, f.followsPay, f.followsInstall, f.followsNewlink].filter(Boolean)
                    .map(k => [/** @type {string} */ (k), '1']));
                const shown = await shownTo(accessType, store);
                assert.deepEqual(shown, expectedFor(accessType, store));
                assert.equal(shown.includes(f.overlay), due(f) && noticeAudienceAllows(f.audience, accessType),
                    'the follower itself opens exactly where its audience allows');
            });
        }
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
    // On 22 October nothing live opens on a fresh device any more — the install notice waited for the two
    // October notices, retired since — so these run on 16 November, when the October notices have ended.
    beforeEach(() => { mock.timers.setTime(LIVE_DAY); });
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

    test('access taken back INSIDE the defer: nothing opens over the lock card, and nothing is flagged (cal-docs-11)', async () => {
        // Granted, the gate passed, the 1500ms timer armed — then re-locked ("Calendar access has
        // expired"), as a member whose first read is refused is. The audience was asked once, at the
        // grant; the open itself must ask again, or the notice lands on the card it waits to avoid.
        await wire({ accessType: SHOWING_ACCESS });
        _access.decide();
        await _access.promise;
        await drain();
        _accessType = 'none';
        mock.timers.tick(2000);
        assert.equal(_openedViaHelper.length, 0, 'no notice opened on a re-locked Calendar');
        const doneKeys = new Set(NOTICES.map(DONE_KEY_OF));
        assert.deepEqual(_writes.filter(([k]) => doneKeys.has(k)), [],
            'and none is flagged seen, so each arrives intact the next time this device is let in');
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
    beforeEach(() => { mock.timers.setTime(LIVE_DAY); });   // block 2 says why
    // THE BEHAVIOURAL FORM OF THIS NEEDS TWO NOTICES, and since v23.23 there is one. It is kept as
    // a contract on the STRUCTURE that makes it true, which is the same move the module header's
    // own promise takes: each notice bails with `return`, so as plain blocks those returns would
    // leave `initCalendarNotices` and the first dismissed notice would silence every later one —
    // silently, and only on the devices that had dismissed it. The IIFE is the scope those returns
    // need, and it is checkable with any number of notices, including the next one added.
    test('each notice is its own IIFE, so a `return` cannot leave initCalendarNotices', () => {
        const ids   = SOURCE.match(/const DONE_KEY\s*=/g) ?? [];
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
        // On 16 November the October notices have ended (their ends are in FOLLOWED_ENDS), so the install notice
        // waits for nothing but the timetable notice's turn, dismissed here.
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
        const [first] = NOTICES;
        // Whatever it waits for answered on earlier loads, so its own markup is the only thing that decides.
        const waitedFor = Object.fromEntries([first.follows, first.followsPay, first.followsInstall, first.followsNewlink]
            .filter(Boolean).map(k => [/** @type {string} */ (k), '1']));
        await wire({ accessType: SHOWING_ACCESS, present: [first.overlay], store: waitedFor });   // any rest's markup absent
        await settleAccess();
        assert.equal(_openedViaHelper.length, noticeAudienceAllows(first.audience, SHOWING_ACCESS) ? 1 : 0,
            'the notice whose markup IS present is unaffected by the ones that are not');

        await wire({ accessType: SHOWING_ACCESS, present: [] });        // every notice's markup absent
        await settleAccess();
        assert.equal(_openedViaHelper.length, 0, 'no markup, no notice — and no throw');
        assert.deepEqual(_writes, [], 'a notice with no markup must not flag the device seen');
    });
});


describe('4 · a notice added later skipping the check', () => {
    // The module header promises this, and the promise is about code nobody has written yet — so it
    // is kept over the source. Both contracts are teeth: each fires on the shape the defect takes.
    test('every notice routes through _openWhenAudienceAllows', async () => {
        const notices = SOURCE.match(/const DONE_KEY\s*=/g) ?? [];
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


describe('5 · the install notice: a phone browser, third in line, and the right "how" (v24.91)', () => {
    // Owner, 22 Oct 2026: remind everyone to install the app on their phone rather than use the web
    // address. Organised by what a wrong answer costs. On a desktop, or inside the installed app, it
    // asks for the impossible. On the load another notice is dismissed it stacks two asks on one
    // visit, which the owner has ruled out. On the GitHub Pages mirror a plain "install" makes installs
    // on the address the app is moving staff off. And a wrong "how" tells a member to press something
    // that is not there — the one failure they cannot work around from the notice itself.
    const INST  = /** @type {{ overlay: string, audience: string, follows: string|null, followsPay: string|null }} */ (NOTICES.find(n => n.overlay === 'installNoticeLb'));
    const DONE  = DONE_KEY_OF(INST);
    const IIFE  = IIFE_OF('installNoticeLb');
    /** The lines it chooses between as it opens — read from the module, so a line added there is in. */
    const LINES = [...SOURCE.matchAll(/^\s+(installNotice\w+):\s/gm)].map(m => m[1]);
    /** A member's phone browser whose earlier loads dismissed the timetable and Year to Date notices. */
    const SHOWN = { accessType: /** @type {const} */ ('named'), present: [INST.overlay, ...LINES, 'installNoticeLater'],
                    store: { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' } };
    const opened = () => /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === INST.overlay));
    /** Its lines that are showing, once it has opened. */
    const showing = () => LINES.filter(id => _els.get(id)?.hidden === false).sort();

    test('it is in the matrix, addressed to members, with its own key, no snooze, behind the REAL keys', () => {
        assert.ok(INST, 'found by the same pattern as every other notice');
        assert.equal(INST.audience, 'members', 'the station PC is not a person — nobody should install the staff roster on it');
        assert.match(DONE, /^myb_notice_install_app_2026_done$/);
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
        // Restated keys: a rename on either side would leave this notice waiting for a flag nothing writes.
        assert.equal(INST.follows, OCT_TIMETABLE_KEY);
        assert.equal(INST.followsPay, OCT_YTD_KEY);
        assert.match(IIFE, /isNoticeExpired\(NOTICE_DATE, 90\)/, '90 days — it does not end with the October notices');
    });

    test('on a member\'s phone browser, the load after the Year to Date notice, it opens — nothing flagged yet', async () => {
        await wire(SHOWN);
        await settleAccess();
        assert.ok(opened());
        assert.deepEqual(_writes, []);
    });

    test('for a member the Year to Date notice is not for, it waits for the timetable one alone', async () => {
        // A Dispatcher never gets the Year to Date notice, so waiting for its flag would hold this one
        // back until that notice expires and is flagged on 1 November.
        assert.equal(rosterRole('D. Minto'), 'Dispatcher', 'precondition: D. Minto is no longer a Dispatcher — name a current one');
        await wire({ ...SHOWN, store: { [OCT_TIMETABLE_KEY]: '1' }, session: { name: 'D. Minto' } });
        await settleAccess();
        assert.ok(opened());
    });

    test('never before the timetable notice has been dismissed', async () => {
        await wire({ ...SHOWN, store: { [OCT_YTD_KEY]: '1' } });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_installCalls, [], 'not decided, so the strip is left alone');
    });

    test('not on a desktop or in the installed app — and NOT flagged, so their phone\'s browser still gets it', async () => {
        await wire({ ...SHOWN, route: null });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, []);
        assert.deepEqual(_installCalls, [], 'not decided, so the strip keeps its own ask');
    });

    test('not on the shared PIN station — and not flagged there', async () => {
        await wire({ ...SHOWN, accessType: 'viewer', session: null });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, []);
        assert.deepEqual(_installCalls, []);
    });

    test('decided, it stands the strip down AT ONCE — not 1500ms later, on top of it', async () => {
        await wire(SHOWN);
        _access.decide();
        await _access.promise;
        await drain();
        assert.deepEqual(_installCalls, ['yield'], 'the strip leaves the screen as the notice is decided');
        assert.equal(opened(), undefined, 'while the notice itself is still on its defer');
        mock.timers.tick(1600);
        assert.ok(opened());
        assert.deepEqual(_installCalls, ['yield'], 'opened, it keeps the visit: nothing is given back');
    });

    // REFUSED AT ITS OPEN, IT GIVES THE VISIT BACK (whole-app check, 17 Nov 2026). From 6 December the
    // timetable notice is wired first and waits for nobody, so on a phone browser still owed this one it
    // takes the screen and this one is refused (`openNoticeIfClear`) — after the strip and the
    // notification ask had already left for the visit. Neither came back: no notice, no strip, no ask.
    test('refused at its open — the screen already taken — the strip and the ask are given back, and nothing is flagged', async () => {
        await wire(SHOWN);
        _screenTaken = true;
        await settleAccess();
        assert.equal(opened(), undefined, 'premise: it did not open');
        assert.deepEqual(_installCalls, ['yield', 'release'], 'the strip and the notification ask stayed gone for a visit this notice did not have');
        assert.deepEqual(_writes, [], 'and it is not flagged: it comes back next load');
    });

    test('in the timetable notice\'s final week both are due: it takes the screen, and this one gives the visit back', async () => {
        mock.timers.setTime(new Date(2026, 11, 7, 9, 0).getTime());   // Monday 7 December, its final week
        const TT_SOON = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'timetableSoonNoticeLb'));
        await wire({ ...SHOWN, present: [...SHOWN.present, TT_SOON.overlay] });
        _oneScreen = true;                                    // the first to open has the screen, as on a phone
        await settleAccess();
        assert.deepEqual(_openedViaHelper.map((/** @type {any} */ lb) => lb._cfg.overlay.id), [TT_SOON.overlay],
            'premise: the time-critical reminder goes first, and this one is refused');
        assert.deepEqual(_installCalls, ['yield', 'release'], 'the visit was left with no notice of its own, no strip and no ask');
    });

    /** @type {Array<[NonNullable<typeof _route>, string[], string]>} */
    const ROUTES = [
        [{ how: 'prompt', mirror: false }, ['installNoticeActions', 'installNoticeInstall', 'installNoticePayLead'],
            'Chromium has handed over its offer: one tap, and no "already installed" line, since it offers only where it is not'],
        [{ how: 'menu', mirror: false }, ['installNoticeHave', 'installNoticeMenu', 'installNoticePayLead'],
            'any other phone browser: its own menu'],
        // Two more lines since the iPhone audit (7 Nov 2026): an email or chat app cannot add it, and the
        // Home Screen app's storage is its own. Android shares one storage, so its routes carry neither.
        // "Already on your home screen?" is folded into the iPhone's own line (22 Nov 2026), so the card fits an SE.
        [{ how: 'ios', mirror: false }, ['installNoticeIos', 'installNoticeIosStore', 'installNoticePayIos', 'installNoticePayLead', 'installNoticeSafari'],
            'an iPhone or iPad: Share, then Add to Home Screen — and what does not come with it'],
        // The mirror gets no steps of its own: the main address shows them once the member is there,
        // and with them the card ran past a phone's screen and hid its one button.
        [{ how: 'ios', mirror: true }, ['installNoticeActions', 'installNoticeGo', 'installNoticeMirror', 'installNoticePay', 'installNoticePayLead'],
            'the mirror on an iPhone: the main address, and the pay figures that stay behind'],
        [{ how: 'menu', mirror: true }, ['installNoticeActions', 'installNoticeGo', 'installNoticeMirror', 'installNoticePay', 'installNoticePayLead'],
            'the mirror on Android: the same — never the menu, which would install the mirror'],
    ];
    for (const [route, lines, what] of ROUTES) {
        test(`it says what this browser does — ${what}`, async () => {
            await wire({ ...SHOWN, route });
            await settleAccess();
            opened()._cfg.onOpen();
            assert.deepEqual(showing(), [...lines].sort());
        });
    }

    // NO PAY WORDS FOR SOMEBODY THE PAY PAGE DOES NOT PRICE (App Notices review, 24 Nov 2026). The install notice told an
    // Other Staff login, and a Dispatcher, about "the pay figures you save" and Move Your Pay Data — a page they cannot use.
    // Asked of the Pay page's own function, for the first such member on the roster; on every route, on screen and in
    // App Notices alike.
    const NOT_PRICED = /** @type {string} */ (teamMembers.find(m => !m.hidden && !payCalcFor({ name: m.name }))?.name);
    for (const route of /** @type {Array<NonNullable<typeof _route>>} */ ([{ how: 'ios', mirror: false }, { how: 'menu', mirror: true }, { how: 'prompt', mirror: false }])) {
        test(`no Pay Calculator words for a member the Pay page does not price — ${route.how}${route.mirror ? ' on the mirror' : ''}`, async () => {
            assert.ok(NOT_PRICED, 'precondition: the roster has somebody the Pay page does not price');
            await wire({ ...SHOWN, route, session: { name: NOT_PRICED } });
            await settleAccess();
            opened()._cfg.onOpen();
            assert.deepEqual(showing().filter(id => /Pay/.test(id)), [], 'no line about pay figures');
            // …but the iPhone's sign-in fact is everybody's (review of v26.67): it went with the pay words.
            if (route.how === 'ios' && !route.mirror) assert.ok(showing().includes('installNoticeIosStore'), 'the Home Screen app needs its own sign-in');
            const filed = _archived.find(n => n.id === 'install-app-2026');
            assert.ok(filed, 'archived on open');
            assert.doesNotMatch(filed.body, /pay|Pay Calculator/i, `App Notices keeps no pay words either: "${filed.body}"`);
        });
    }
    test('a member the Pay page prices keeps them, in App Notices too', async () => {
        await wire({ ...SHOWN, route: { how: 'ios', mirror: false } });
        await settleAccess();
        opened()._cfg.onOpen();
        const filed = _archived.find(n => n.id === 'install-app-2026');
        assert.match(filed.body, /pay figures you save/);
        assert.match(filed.body, /Move Your Pay Data/);
    });

    test('the route is read as it OPENS — an offer that arrives after the gate still gets its one tap', async () => {
        await wire(SHOWN);                                    // a phone browser with no offer yet
        _access.decide();
        await _access.promise;
        await drain();
        _route = { how: 'prompt', mirror: false };            // Chromium fires inside the 1500ms
        mock.timers.tick(1600);
        opened()._cfg.onOpen();
        assert.ok(showing().includes('installNoticeInstall'));
    });

    test('should the browser stop answering before it opens, the route the gate saw is used — the mirror stays the mirror', async () => {
        // A tablet whose keyboard is attached in the 1500ms between the gate and the open reads as
        // no route at all. Falling back to a generic "use the menu" there would tell a member on the
        // mirror to install the mirror.
        await wire({ ...SHOWN, route: { how: 'menu', mirror: true } });
        _access.decide();
        await _access.promise;
        await drain();
        _route = null;
        mock.timers.tick(1600);
        opened()._cfg.onOpen();
        assert.deepEqual(showing(), ['installNoticeActions', 'installNoticeGo', 'installNoticeMirror', 'installNoticePay', 'installNoticePayLead']);
    });

    test('the one-tap button spends the offer FIRST, then answers the notice and retires the strip', async () => {
        await wire({ ...SHOWN, route: { how: 'prompt', mirror: false } });
        await settleAccess();
        opened()._cfg.onOpen();
        const tap = _listeners.get('installNoticeInstall:click');
        assert.ok(tap, 'the button has a click handler');
        _installCalls = [];
        tap();
        assert.deepEqual(_installCalls, ['prompt', 'retire'], 'the browser wants the tap behind its prompt, so nothing goes before it');
        assert.deepEqual(_writes, [[DONE, '1']]);
        assert.deepEqual(_closed, [INST.overlay], 'and the notice gets out of the way of the browser\'s dialog');
    });

    test('the mirror\'s link answers it too — the member has acted', async () => {
        await wire({ ...SHOWN, route: { how: 'ios', mirror: true } });
        await settleAccess();
        const go = _listeners.get('installNoticeGo:click');
        assert.ok(go, 'the link has a click handler');
        _installCalls = [];
        go({ type: 'click', button: 0 });
        assert.deepEqual(_writes, [[DONE, '1']]);
        assert.deepEqual(_installCalls, ['retire']);
        assert.equal(_followed.length, 1, 'the mirror\'s link to the main address replaces the notice\'s history entry too');
    });

    test('every close — the ×, the backdrop, Escape, "Not now" — answers it, and the strip does not ask again', async () => {
        // A member who has read the whole case and said "Not now" is not asked again next visit by the
        // one-line version of it. Settings keeps its install card as the place to find it.
        await wire(SHOWN);
        await settleAccess();
        _installCalls = [];
        opened()._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']]);
        assert.deepEqual(_installCalls, ['retire']);
    });

    test('archived on OPEN, with the "how" this browser was shown — and the mirror\'s never says install here', async () => {
        /** @type {Array<[NonNullable<typeof _route>, RegExp]>} */
        const cases = [[{ how: 'ios', mirror: false }, /Share button, then Add to Home Screen/],
                       [{ how: 'menu', mirror: false }, /browser’s menu/],
                       [{ how: 'prompt', mirror: false }, /browser’s menu/],          // the button is spent once used
                       [{ how: 'menu', mirror: true }, /myb-roster\.web\.app/]];
        for (const [route, how] of cases) {
            await wire({ ...SHOWN, route });
            await settleAccess();
            opened()._cfg.onOpen();
            assert.deepEqual(_archived.map(n => [n.id, n.section, n.date]), [['install-app-2026', 'General', '22 Oct 2026']]);
            assert.match(_archived[0].body, how, JSON.stringify(route));
            if (route.mirror) assert.doesNotMatch(_archived[0].body, /browser’s menu|Share/, 'on the mirror the record sends them to the main address');
        }
    });

    // ── WHAT AN iPHONE IS TOLD (iPhone audit, 7 Nov 2026) ──────────────────────────────────────────
    // A Home Screen app on an iPhone keeps storage of its own: the sign-in and the Pay Calculator's
    // figures stay in the browser it was added from. The notice promised the opposite — "your saved
    // pay figures are far less likely to be cleared" — and gave the iPhone only "Share, then Add to
    // Home Screen", which on iOS 26 is behind ••• and in an email or chat app is not there at all.
    /** The text of one of the notice's lines, as the markup gives it. @param {string} id */
    const lineText = (id) => {
        const page = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const m = new RegExp(`<p class="notice-body" id="${id}" hidden>([\\s\\S]*?)</p>`).exec(page);
        assert.ok(m, `#${id} is not a notice line in index.html`);
        return (m?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    };

    test('it promises durability only for what is saved IN the home screen app — never for what is already saved', async () => {
        const page  = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const block = page.slice(page.indexOf('id="installNoticeLb"'), page.indexOf('<!-- Annual Leave lightbox'))
            .replace(/<!--[\s\S]*?-->/g, ' ');
        assert.doesNotMatch(block, /your saved pay figures are far less likely/, 'the old promise is back on screen');
        assert.match(block, /pay figures you save in the home screen app are far less likely to be cleared/);
        for (const route of [{ how: 'ios', mirror: false }, { how: 'menu', mirror: false }, { how: 'prompt', mirror: false }, { how: 'menu', mirror: true }]) {
            await wire({ ...SHOWN, route: /** @type {typeof _route} */ (route) });
            await settleAccess();
            opened()._cfg.onOpen();
            assert.doesNotMatch(_archived[0].body, /your saved pay figures are far less likely/, `the App Notices record still promises it (${JSON.stringify(route)})`);
            assert.match(_archived[0].body, /pay figures you save in the home screen app/);
        }
    });

    test('on an iPhone it says where Share is on iOS 26, to open the roster in Safari first, and what stays behind', () => {
        assert.match(lineText('installNoticeIos'), /Tap Share, then Add to Home Screen — on iOS 26 or later, Share is under •••/);
        assert.match(lineText('installNoticeIos'), /Already there\? Open it from your home screen: notifications work only there/,
            'the iPhone line carries "already installed" and where notifications work — there is no separate line for them on this route');
        assert.match(lineText('installNoticeSafari'), /email or a chat\? Open it in Safari first/);
        const pay = lineText('installNoticeIosStore');
        assert.match(pay, /keeps its own storage/, 'it must say WHY the figures do not follow');
        assert.match(pay, /sign in there once/, 'the member is signed out in the Home Screen app, and is not told');
        assert.match(pay, /copy them first with 💾 Move Your Pay Data on the Pay page/, 'and the card that carries them across');
        // The Pay page's card is called exactly this; a renamed card leaves the notice naming nothing.
        assert.match(readFileSync(new URL('./paycalc.html', REPO_ROOT_URL), 'utf8'), /Move Your Pay Data/);
    });

    test('the App Notices record keeps the iPhone lines too — and Android\'s record carries none of them', async () => {
        await wire({ ...SHOWN, route: { how: 'ios', mirror: false } });
        await settleAccess();
        opened()._cfg.onOpen();
        const ios = _archived[0].body;
        for (const said of [/under •••/, /Open it in Safari first/, /sign in there once/, /Move Your Pay Data/]) assert.match(ios, said);
        for (const route of [{ how: 'menu', mirror: false }, { how: 'prompt', mirror: false }]) {
            await wire({ ...SHOWN, route: /** @type {typeof _route} */ (route) });
            await settleAccess();
            opened()._cfg.onOpen();
            assert.doesNotMatch(_archived[0].body, /•••|Safari|sign in there once/, `Android shares one storage — ${route.how} says none of it`);
        }
    });

    test('past its 90 days, a device that never saw it is flagged and shown nothing', async () => {
        await wire({ ...SHOWN, expired: true });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, [[DONE, '1']]);
    });

    test('once done, it stays done', async () => {
        await wire({ ...SHOWN, store: { ...SHOWN.store, [DONE]: '1' } });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, []);
        assert.deepEqual(_installCalls, []);
    });

    test('every line the markup gives it is one the module shows or hides — none is stranded', () => {
        // A line added to index.html and not here would stay `hidden` on every phone for ever.
        const page  = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const block = page.slice(page.indexOf('id="installNoticeLb"'), page.indexOf('<!-- Annual Leave lightbox'));
        const ids   = [...block.matchAll(/id="(installNotice\w+)"/g)].map(m => m[1])
            .filter(id => !/^installNotice(Lb|Content|Close|Later)$/.test(id));
        assert.deepEqual([...ids].sort(), [...LINES].sort());
        assert.ok(LINES.length >= 8, `found ${LINES.length} lines — the pattern reading the module has stopped matching`);
    });

    test('the mirror\'s link is the app\'s main address — the one notifications are sent from', () => {
        const page = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const href = /<a href="([^"]+)" id="installNoticeGo"/.exec(page)?.[1];
        const site = /const STAFF_SITE_URL\s*=\s*'([^']+)'/.exec(readFileSync(new URL('./functions/index.js', REPO_ROOT_URL), 'utf8'))?.[1];
        assert.ok(site, 'STAFF_SITE_URL is still declared where this reads it');
        assert.equal(href, `${site}/`);
    });
});


describe('8 · the timetable notice: from 16 November behind the install and New link notices, first from 6 December, gone on the 13th, members only (v24.94; v26.21)', () => {
    // Owner, 23 Oct 2026: the October notice ended six weeks before the change, and from then nothing in the app said
    // the day was coming. It was to be offered 6–12 December; on 16 Nov 2026 the owner brought it forward to that day,
    // after the two notices already running, and first again in its final week (v26.21). Organised by what a wrong
    // answer costs: early, and it opens before it was posted; late, and it tells people about a Sunday that has passed;
    // flagged on a device that arrives early or is still waiting its turn, and that device never sees it; shown to the
    // PIN station, and a shared PC is told about "your" page; on the load another notice is answered, and two asks
    // share one visit, which the owner has ruled out; waiting for a notice that is never coming, and it is held back
    // until that one ends; and still waiting in its final week, and a phone that never answers the install notice is
    // not told about the Sunday until after it.
    const SOON = /** @type {{ overlay: string, audience: string, follows: string|null, followsInstall: string|null, followsNewlink: string|null, starts: number|null, finalWeek: number|null }} */ (NOTICES.find(n => n.overlay === 'timetableSoonNoticeLb'));
    const INST = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'installNoticeLb'));
    const NL   = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'newlinkNoticeLb'));
    const DONE = DONE_KEY_OF(SOON);
    const IIFE = IIFE_OF('timetableSoonNoticeLb');
    /** The notice for this overlay, if it asked for the screen on this load. @param {string} overlay */
    const asked = (overlay) => /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === overlay));
    const opened = () => asked(SOON.overlay);
    /** Every notice that asked for the screen on this load, in the order it asked. The first one takes it:
     *  openNoticeIfClear refuses a second while one is up, leaving that one unflagged for the next load. */
    const askedInOrder = () => _openedViaHelper.map(lb => lb._cfg.overlay.id);
    const NOV_15 = new Date(2026, 10, 15, 21, 0).getTime(), NOV_27 = new Date(2026, 10, 27, 9, 0).getTime()   // after the New link vote notice's posting day (26 Nov), which this waits for;
    const DEC_5  = new Date(2026, 11, 5, 21, 0).getTime(),  DEC_6  = new Date(2026, 11, 6, 9, 0).getTime();
    const DEC_12 = new Date(2026, 11, 12, 23, 0).getTime();

    /** A device after October: the two October notices ended on the 31st and flagged themselves as they did. The
     *  harness answers every expiry question with one flag, so a case later in the year carries their flags instead. */
    const AFTER_OCTOBER = { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' };
    /** A member the New link page lets in (the e2e admin seed), and one it turns away — FOUND, so a leaver cannot
     *  quietly turn one case into the other (the test audit's lesson, 7 Nov 2026). Asked of the page's real door. */
    const FOR_NEWLINK = 'G. Miller';
    const NOT_NEWLINK = /** @type {string} */ (teamMembers.find(m => !m.hidden && !canOpenNewlink(m.name))?.name);
    /** A desk, where there is nothing to install — the installed app is the same — and a phone in a browser. */
    const DESK  = { accessType: /** @type {const} */ ('named'), route: null, store: AFTER_OCTOBER };
    const PHONE = { accessType: /** @type {const} */ ('named'), route: /** @type {typeof _route} */ ({ how: 'menu', mirror: false }), store: AFTER_OCTOBER };

    test('in the matrix, members only, its own key, no snooze, 16 November to the end of 12 December, behind the REAL install and New link keys, wired before the install notice', () => {
        assert.ok(SOON, 'found by the same pattern as every other notice');
        assert.equal(SOON.audience, 'members');
        assert.equal(DONE, 'myb_notice_timetable_soon_2026_done');
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
        assert.equal(SOON.starts, new Date(2026, 10, 16).getTime(), 'STARTS is its posting day, read from the source');
        assert.match(IIFE, /Date\.now\(\) < STARTS\.getTime\(\)\) return;/, 'an early device is left unflagged, not dismissed');
        assert.match(IIFE, /isNoticeExpired\(CHANGE_EVE, 1\)/, 'offered through the whole of the Saturday, gone on the day');
        assert.match(IIFE, /const CHANGE_EVE\s*=\s*'12 Dec 2026'/);
        assert.equal(SOON.finalWeek, new Date(2026, 11, 6).getTime(), 'its final week starts on Sunday 6 December, read from the source');
        assert.equal(SOON.follows, null, 'it waits for nothing unconditionally — a desk never gets the install notice');
        // Restated keys: a rename on either side would leave this notice waiting for a flag nothing writes.
        assert.equal(SOON.followsInstall, DONE_KEY_OF(INST));
        assert.equal(SOON.followsNewlink, DONE_KEY_OF(NL));
        // The New link notice's own question, asked of whoever is signed in when it OPENS — never a list of its own.
        assert.match(IIFE, /canOpenNewlink\(getSession\(\)\?\.name\)/);
        // FIRST in its final week: where it and the install notice are both due, the first to ask takes the screen.
        assert.ok(NOTICES.indexOf(/** @type {any} */ (SOON)) < NOTICES.indexOf(/** @type {any} */ (INST)),
            'wired before the install notice (v24.96)');
        assert.equal(rosterRole(FOR_NEWLINK) !== undefined && canOpenNewlink(FOR_NEWLINK), true, `precondition: the New link page lets ${FOR_NEWLINK} in`);
        assert.ok(NOT_NEWLINK, 'precondition: the roster has somebody the New link page turns away');
    });

    test('every day it is offered, its words are true: they name the date, never "Sunday" or "this weekend" alone (whole-app review, 10 Nov 2026)', () => {
        // Its run holds three Sundays, 22 and 29 November and 6 December. "The new timetable starts on Sunday" read, on
        // each of them, as TODAY, and "This weekend Chiltern’s trains move…" named the wrong weekend on all but its last
        // days; "Sunday 13 December" is true on every day it runs. Read from the page and the module, so the dialog's
        // name, the title on screen and the App Notices record are held together.
        const HTML = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const at = HTML.indexOf(`id="${SOON.overlay}"`);
        const block = HTML.slice(at, HTML.indexOf('<!-- One-time notice', at));
        const text = (/** @type {string} */ s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        const label = block.match(/aria-label="([^"]+)"/)?.[1] ?? '';
        const title = text(block.match(/class="lightbox-app-name">([\s\S]*?)<\/div>/)?.[1] ?? '');
        // The App Notices record is the module's TIMETABLE_SOON_RECORD, which outlives the run by months.
        const archived = /const TIMETABLE_SOON_RECORD = \{[\s\S]*?title: '([^']+)'/.exec(SOURCE)?.[1] ?? '';
        assert.ok(block.length > 200, 'guard: the notice markup was found');
        for (const [where, words] of [['the dialog name', label], ['the title', title], ['the App Notices record', archived]]) {
            assert.match(words, /Sunday 13 December/, `${where} must name the date: "${words}"`);
        }
        // TENSE-NEUTRAL, unlike the card (App Notices review, 24 Nov 2026): App Notices lists it for 180 days, and
        // "starts on Sunday 13 December" is false from that Sunday on.
        assert.doesNotMatch(archived, /\bstarts\b/, 'the App Notices record must stay true after the 13th');
        assert.doesNotMatch(text(block), /this weekend/i, 'on any day but its last six "this weekend" is the wrong one');
        assert.doesNotMatch(text(block), /\b(?:on|this|next) Sunday\b(?! 13 December)/i, 'a Sunday with no date reads as today on a Sunday');
    });

    test('it names the Trains page\'s new columns by the heading they carry there, every day it runs (lightbox review, 22 Nov 2026)', async () => {
        // It said "the times in the Trains page's second column", and the new times are second only in the train
        // list: the station table opens with a label column, and the last-trains table puts them third. The page
        // heads every such column with `newLabel` (trains-change.js → `timetablePhase`, through trains-cards.js),
        // so the notice names that heading — asked of the page's own function on each day of the run.
        const { timetablePhase } = await import('../trains-change.js');
        const { CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL } = await import('../trains-data.js');
        const HTML = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const at = HTML.indexOf(`id="${SOON.overlay}"`);
        const body = HTML.slice(at, HTML.indexOf('<!-- One-time notice', at))
            .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        const dates = { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL };   // trains-cards.js's own
        const labels = new Set();
        for (let d = new Date(2026, 10, 16); d <= new Date(2026, 11, 12); d.setDate(d.getDate() + 1)) {
            labels.add(timetablePhase(new Date(d), dates).newLabel);
        }
        assert.equal(labels.size, 1, `the page's heading changes during the notice's run: ${[...labels].join(', ')}`);
        const [heading] = labels;
        assert.match(body, new RegExp(`the times in the Trains page’s ${heading} columns are the ones running`),
            `the notice must name the columns the Trains page heads "${heading}"`);
        assert.doesNotMatch(body, /\b(?:first|second|third|fourth|fifth) column\b/i, 'a column by its position is true of one table only');
    });

    test('posted on one date, everywhere — and its button names where it goes, the drawer\'s own route, unbroken (v26.21)', async () => {
        // The polish the owner asked for with the move. The date is the day it went up, in the module, on screen and in
        // App Notices. The button names its destination, as the New link notice's "Open the New link page →" does. And
        // the menu route never wraps between its two halves, on screen or in App Notices.
        const here = new URL('.', REPO_ROOT_URL);
        const HTML = readFileSync(new URL('./index.html', here), 'utf8');
        const at = HTML.indexOf(`id="${SOON.overlay}"`);
        const block = HTML.slice(at, HTML.indexOf('<!-- One-time notice', at));
        assert.match(SOURCE, /const TIMETABLE_SOON_RECORD = \{\s*id: 'timetable-soon-2026', section: 'Trains', date: '16 Nov 2026',/);
        assert.match(block, /<div class="notice-date">Posted 16 November 2026<\/div>/, 'the card writes the month in full; the record keeps the expiry key');
        const { NAV_PAGES } = await import('../nav-destinations.js');
        const trainsPill = NAV_PAGES.find(p => p.id === 'trains');
        assert.ok(trainsPill, 'the drawer still has a Trains pill');
        const pill = [null, trainsPill.label, trainsPill.url];   // [, label, url], as the reads below index it
        const cta = /<a href="([^"]+)" id="timetableSoonNoticeGo" class="notice-cta">([^<]+)<\/a>/.exec(block);
        assert.ok(cta, 'the button is still a link');
        assert.equal(cta[1], pill[2], 'the link goes where the pill goes');
        assert.equal(cta[2], 'Open the Trains page &rarr;', 'a destination, like the New link notice\'s button');
        assert.ok(block.includes(`<div class="notice-badge notice-badge--trains">${pill[1]}</div>`), 'the badge is the pill, word for word');
        assert.ok(block.includes(`☰&nbsp;then ${pill[1].replace(' ', '&nbsp;')}.`), 'the body names the pill, unbroken');
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, session: { name: NOT_NEWLINK } });
        await settleAccess();
        opened()._cfg.onOpen();                               // the harness records an open; the lightbox would run this itself
        const filed = _archived.find(n => n.id === 'timetable-soon-2026');
        assert.ok(filed, 'archived on OPEN');
        assert.equal(filed.date, '16 Nov 2026', 'App Notices dates it as the card does');
        assert.ok(filed.body.includes(`☰\u00a0then ${pill[1].replace(' ', '\u00a0')}.`), 'and keeps the route unbroken too');
    });

    test('from 16 November, on a desk, for a member the New link page turns away: it opens at once — nothing flagged yet', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, session: { name: NOT_NEWLINK } });
        await settleAccess();
        assert.deepEqual(askedInOrder(), [SOON.overlay], 'nothing else is theirs to wait for');
        assert.deepEqual(_writes, []);
    });

    test('for a member the New link page lets in, the New link notice first — this one is NOT opened and NOT flagged', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, session: { name: FOR_NEWLINK } });
        await settleAccess();
        assert.deepEqual(askedInOrder(), [NL.overlay]);
        assert.deepEqual(_writes, []);
    });

    test('NOT on the load the New link notice is answered — that flag is read at wiring time — and the load after, it opens', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, session: { name: FOR_NEWLINK } });
        await settleAccess();
        asked(NL.overlay)._cfg.onClose();                     // answered: its flag is written now…
        mock.timers.tick(10_000);                             // …and nothing follows it up this visit
        await drain();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, [[DONE_KEY_OF(NL), '1']], 'this notice is not flagged — it comes next time');
        await wire({ ...DESK, session: { name: FOR_NEWLINK }, store: { ..._store } });
        await settleAccess();
        assert.deepEqual(askedInOrder(), [SOON.overlay]);
    });

    /** @type {Array<[string, string, string[]]>} */
    const PHONE_ORDERS = [
        // …and the Team View notice last of all, for a member on the roster (block 16).
        ['lets in', FOR_NEWLINK, [INST.overlay, NL.overlay, SOON.overlay, 'teamNoticeLb']],
        ['turns away', NOT_NEWLINK, [INST.overlay, SOON.overlay, 'teamNoticeLb']],
    ];
    for (const [page, name, order] of PHONE_ORDERS) {
        test(`on a phone, for a member the New link page ${page}: ${order.join(', then ')} — one a load, each the load after the last`, async () => {
            mock.timers.setTime(NOV_27);
            /** @type {Record<string, string>} */ let store = { ...AFTER_OCTOBER };
            for (const next of order) {
                await wire({ ...PHONE, session: { name }, store });
                await settleAccess();
                assert.deepEqual(askedInOrder(), [next], `only ${next} asks for the screen on its load`);
                asked(next)._cfg.onClose();
                store = { ..._store };
            }
            await wire({ ...PHONE, session: { name }, store });
            await settleAccess();
            assert.deepEqual(askedInOrder(), [], 'every one answered: nothing more');
        });
    }

    test('the evening before its posting day: not opened, and NOT flagged, so the same device sees it on the 16th', async () => {
        mock.timers.setTime(NOV_15);
        await wire({ ...DESK, session: { name: NOT_NEWLINK } });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes.filter(([k]) => k === DONE), []);
    });

    test('the evening before its final week it still waits for the install notice', async () => {
        mock.timers.setTime(DEC_5);
        await wire({ ...PHONE, session: { name: NOT_NEWLINK } });
        await settleAccess();
        assert.deepEqual(askedInOrder(), [INST.overlay]);
    });

    test('from Sunday 6 December it waits for nobody: on a phone that never answered the install notice it asks FIRST, and that one comes the load after', async () => {
        mock.timers.setTime(DEC_6);
        await wire({ ...PHONE, session: { name: NOT_NEWLINK } });
        await settleAccess();
        assert.deepEqual(askedInOrder(), [SOON.overlay, INST.overlay], 'both due, and the time-critical one asks first');
        assert.deepEqual(_writes, []);
        opened()._cfg.onClose();
        await wire({ ...PHONE, session: { name: NOT_NEWLINK }, store: { ..._store } });
        await settleAccess();
        assert.deepEqual(askedInOrder(), [INST.overlay], 'the install notice keeps until January, and comes back now');
    });

    test('nor for the New link notice — which has ended by then, and would come second if it had not', async () => {
        // The harness answers every expiry question with one flag, so the New link notice is still wired here. On a real
        // device it was flagged on the 6th; this is the half of the final week that a wrong date would show first.
        mock.timers.setTime(DEC_6);
        await wire({ ...DESK, session: { name: FOR_NEWLINK } });
        await settleAccess();
        assert.equal(askedInOrder()[0], SOON.overlay, 'it no longer waits for the New link notice to be answered');
    });

    test('late on Saturday 12 December it is still offered', async () => {
        mock.timers.setTime(DEC_12);
        await wire({ ...PHONE, session: { name: FOR_NEWLINK } });
        await settleAccess();
        assert.ok(opened());
    });

    test('once expired, a device that never saw it is flagged and shown nothing', async () => {
        // The harness answers every expiry question with one flag, so every notice retires here; the
        // claim is about THIS one: flagged, not opened.
        mock.timers.setTime(new Date(2026, 11, 13, 9, 0).getTime());
        await wire({ accessType: 'named', expired: true });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.ok(_writes.some(([k, v]) => k === DONE && v === '1'), 'flagged done without being shown');
    });

    test('not on the shared PIN station, in either part of its run — and not flagged there', async () => {
        for (const day of [NOV_27, DEC_6]) {
            mock.timers.setTime(day);
            await wire({ ...DESK, accessType: 'viewer', session: null });
            await settleAccess();
            assert.equal(opened(), undefined);
            assert.deepEqual(_writes, []);
        }
    });

    test('every dismissal marks it done: the link, Not now, and the close', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, session: { name: NOT_NEWLINK }, present: [SOON.overlay, 'timetableSoonNoticeGo', 'timetableSoonNoticeLater'] });
        await settleAccess();
        const lb = opened();
        assert.ok(lb);
        _listeners.get('timetableSoonNoticeGo:click')?.();
        assert.deepEqual(_writes, [[DONE, '1']], 'the link marks it done before the page is left');
        _writes = [];
        lb._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']], 'so does a close');
        lb._cfg.onOpen();                                     // the harness records an open; the lightbox would run this itself
        assert.ok(_archived.some(n => n.id === 'timetable-soon-2026'), 'archived on OPEN, before the link can take the member away');
    });
});

describe('9 · every notice key is pre-dismissed by the browser suites\' session seeders (v24.96)', () => {
    // A notice the seeders do not pre-dismiss opens over every real-clock browser journey during its
    // window and intercepts the clicks after it — and the Hosting deploy runs that suite. The final-week
    // notice (6–12 Dec 2026) shipped without its key in the seeders; the 72-hour review found it with a
    // pinned clock before the week did. The keys are read from the notices' own source, so a notice
    // added later joins this contract by existing.
    const KEYS = [...SOURCE.matchAll(/const DONE_KEY\s*=\s*'([^']+)'/g)].map(m => m[1]);
    const here = new URL('.', REPO_ROOT_URL);
    const SEEDERS = {
        'e2e/helpers.js':          { text: readFileSync(new URL('./e2e/helpers.js', here), 'utf8'),          atLeast: 3 },   // seedSession, seedMemberSession and the third seeder
        'e2e/visual-harness.js':   { text: readFileSync(new URL('./e2e/visual-harness.js', here), 'utf8'),   atLeast: 1 },
        'e2e/calendar-access.spec.js': { text: readFileSync(new URL('./e2e/calendar-access.spec.js', here), 'utf8'), atLeast: 1 },  // heldSessionWithReset
    };
    test('the scan is reading real keys', () => {
        assert.ok(KEYS.length >= 3, `found ${KEYS.length} DONE_KEYs in calendar-notices.js`);
        assert.ok(KEYS.every(k => /^myb_notice_[a-z0-9_]+_done$/.test(k)), KEYS.join(', '));
    });
    for (const [file, { text, atLeast }] of Object.entries(SEEDERS)) {
        test(`${file} sets every notice key`, () => {
            // A seeder calls setItem with the key, or lists it in a flags map the harness then writes.
            const missing = KEYS.filter(k => (text.match(new RegExp(`setItem\\(['"]${k}['"]|['"]${k}['"]\\s*:\\s*['"]1['"]`, 'g')) ?? []).length < atLeast);
            assert.deepEqual(missing, [], `${file} must pre-dismiss ${missing.join(', ')} (at least ${atLeast} seeder(s)) or the notice opens over every journey in its window`);
        });
    }
});

describe('10 · every section a notice archives under has its colour in App Notices (v25.00)', async () => {
    // The drawer's App Notices list colours each notice's section chip from `SECTION_MODS`
    // (nav-destinations.js). A section missing there falls back to the neutral grey — which is how both
    // Trains notices, the first of their section, arrived uncoloured. Read from EVERY file that archives
    // a notice, found by searching the tree for the call, so the next page's first notice joins this
    // contract by existing rather than by somebody remembering to list its file here.
    const here = new URL('.', REPO_ROOT_URL);
    const { readdirSync } = await import('node:fs');
    const { SECTION_MODS } = await import('../nav-destinations.js');
    const ARCHIVERS = readdirSync(here).filter(f => f.endsWith('.js') && f !== 'notice-archive.js')
        .filter(f => /\barchiveNotice\(/.test(readFileSync(new URL(`./${f}`, here), 'utf8')));
    const sections = new Set(ARCHIVERS.flatMap(f =>
        [...readFileSync(new URL(`./${f}`, here), 'utf8').matchAll(/(?:archiveNotice\(\{|_RECORD = \{)[^}]*?section:\s*'([^']+)'/gs)].map(m => m[1])));
    const css = readFileSync(new URL('./shared.css', here), 'utf8');
    test('the scan is reading real sections, from the files that archive', () => {
        for (const f of ['calendar-notices.js', 'paycalc-lightboxes.js', 'links-app.js']) assert.ok(ARCHIVERS.includes(f), `${f} archives a notice: ${ARCHIVERS}`);
        assert.ok(sections.has('Trains') && sections.has('Pay'), [...sections].join(', '));
        assert.equal(SECTION_MODS.Pay, 'pay');
    });
    test('each one (bar "General", deliberately neutral) has a SECTION_MODS entry and a colour', () => {
        const missing = [...sections].filter(s => s !== 'General').filter(s => {
            const mod = SECTION_MODS[s];
            return !mod || !new RegExp(`\\.notices-item-section--${mod}\\s*\\{[^}]*color:`).test(css);
        });
        assert.deepEqual(missing, [], `App Notices would show ${missing.join(', ')} in the neutral grey`);
    });
});

describe('11 · the New link notice: only where the page would let them in, after the install notice, 26 Nov – 5 Dec (v25.61; the vote notice, v26.90)', () => {
    // Owner, 9 Nov 2026: "a third in sequence on calendar advertising the new links page with a description and link
    // to that page, but only for those who can view that page." Replaced on 26 Nov by the vote notice, in the same place,
    // for the same people, on a new key (owner: "voting starts soon … familiarise yourself with them now"). Organised by what a wrong answer costs. Shown to
    // somebody the page turns away, it advertises a door that is shut to them — a CEA on a bilingual contract, whose
    // links stay their own, or a Dispatcher. Waiting for the install notice where that notice is never coming, it
    // reaches nobody at a desk or in the installed app — the managers it is partly for are mostly at a desk. Sharing a
    // visit with another notice breaks the one-at-a-time the owner asked for. And flagged where it was refused, the
    // device that should see it never does.
    const NL     = /** @type {{ overlay: string, audience: string, follows: string|null, followsInstall: string|null, starts: number|null }} */ (NOTICES.find(n => n.overlay === 'newlinkNoticeLb'));
    const INST   = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'installNoticeLb'));
    const DONE   = DONE_KEY_OF(NL);
    const IIFE   = IIFE_OF('newlinkNoticeLb');
    const NOV_27 = new Date(2026, 10, 27, 9, 0).getTime();   // the day after its posting
    const opened = () => /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === NL.overlay));

    /** Somebody on the roster who fits — FOUND rather than named, so a leaver cannot quietly turn one case into
     *  another (the test audit's lesson: S. Stewart's leaving made a manager case a second "not on the roster" one). */
    function someone(/** @type {string} */ what, /** @type {(m: any) => boolean} */ fits) {
        const m = teamMembers.find(x => !x.hidden && fits(x));
        assert.ok(m, `the roster has no ${what}`);
        return /** @type {any} */ (m).name;
    }
    const roles = (/** @type {string} */ n) => [...CONFIG.ADMIN_NAMES, ...(CONFIG.MANAGER_NAMES || []), ...(CONFIG.NEWLINK_PREVIEW || [])].includes(n);
    const NORMAL_CEA = someone('CEA on a normal contract outside every role list', m => m.role === 'CEA' && !m.bilingualContract && !m.managerOnly && !roles(m.name));
    const BILINGUAL  = someone('CEA on a bilingual contract', m => m.role === 'CEA' && m.bilingualContract && !roles(m.name));
    const DISPATCHER = someone('Dispatcher', m => m.role === 'Dispatcher' && !roles(m.name));
    const MANAGER    = /** @type {string} */ ((CONFIG.MANAGER_NAMES || [])[0]);

    /** A colleague's desktop on 27 November: nothing to install there, so nothing to wait for. */
    const DESK = { accessType: /** @type {const} */ ('named'), session: { name: NORMAL_CEA }, route: null,
                   present: [NL.overlay, 'newlinkNoticeGo', 'newlinkNoticeLater'] };

    test('in the matrix, members only, its own key, no snooze, 26 November to the end of 5 December, behind the REAL install key, and wired last', () => {
        assert.ok(NL, 'found by the same pattern as every other notice');
        assert.equal(NL.audience, 'members', 'the page is signed-in only, so the station PIN is never told about it');
        assert.equal(DONE, 'myb_notice_newlink_vote_2026_done', 'a NEW key: the first notice\'s would hide this from all who closed that one');
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
        assert.equal(NL.starts, new Date(2026, 10, 26).getTime(), 'STARTS is its posting day, read from the source');
        assert.match(IIFE, /Date\.now\(\) < STARTS\.getTime\(\)\) return;/, 'an early device is left unflagged, not dismissed');
        assert.match(IIFE, /const LAST_DAY\s*=\s*'5 Dec 2026'/, 'gone before the timetable notice\'s final week, when that one stops waiting for it');
        assert.match(IIFE, /isNoticeExpired\(LAST_DAY, 1\)/, 'offered through the whole of the Saturday, gone on the Sunday');
        assert.equal(NL.follows, null, 'it waits for nothing unconditionally — a desk never gets the install notice');
        // Restated key: a rename on either side would leave this notice waiting for a flag nothing writes.
        assert.equal(NL.followsInstall, DONE_KEY_OF(INST));
        // The page's own question, asked of whoever is signed in when it OPENS — never a list of its own.
        assert.match(IIFE, /canOpenNewlink\(getSession\(\)\?\.name\)/);
        assert.match(SOURCE, /import \{ canOpenNewlink \} from '\.\/auth-policy\.js'/);
        // LAST of the notices it could share a load with: on a load where anything else is due, that one takes the
        // screen and this one comes back next time. Only the Team View notice is wired after it, and that one follows
        // the timetable notice, which waits for this one until it has ended — so the two are never due together.
        const after = NOTICES.slice(NOTICES.findIndex(n => n.overlay === NL.overlay) + 1).map(n => n.overlay);
        assert.deepEqual(after, ['teamNoticeLb'], 'wired last but for the Team View notice, so it yields to every other one');
    });

    test('before 26 November nothing in the matrix is about it — it gets its rows here instead', () => {
        assert.equal(due(NL), false, 'the pinned clock (22 Oct) is before its posting day');
        assert.equal(roles(NORMAL_CEA) || BILINGUAL === NORMAL_CEA, false, 'precondition: three different people, none on a role list');
        assert.equal(rosterRole(DISPATCHER), 'Dispatcher');
        assert.ok(MANAGER, 'precondition: the roster still names a manager');
    });

    test('on a colleague\'s desktop on 27 November it opens — and nothing is flagged yet', async () => {
        mock.timers.setTime(NOV_27);
        await wire(DESK);
        await settleAccess();
        assert.ok(opened());
        assert.deepEqual(_writes, []);
    });

    test('it opens for EXACTLY the people the page lets in — every name on the roster, asked as the page asks', async () => {
        // The entry point, not the helper: the real notice driven through the real gate, once per member, against the
        // page's own answer. newlink-config.test.mjs holds canOpenNewlink to the page's door for the same names.
        const { canOpenNewlink } = await import('../auth-policy.js');
        const wrong = [];
        for (const m of teamMembers.filter(x => !x.hidden)) {
            mock.timers.setTime(NOV_27);
            await wire({ ...DESK, session: { name: m.name } });
            await settleAccess();
            if (!!opened() !== canOpenNewlink(m.name)) wrong.push(`${m.name}: ${opened() ? 'told' : 'not told'}`);
            if (!opened() && _writes.length) wrong.push(`${m.name}: refused AND flagged`);
        }
        assert.deepEqual(wrong, []);
    });

    test('not for a CEA on a bilingual contract, nor a Dispatcher — and NOT flagged for either', async () => {
        for (const name of [BILINGUAL, DISPATCHER]) {
            mock.timers.setTime(NOV_27);
            await wire({ ...DESK, session: { name } });
            await settleAccess();
            assert.equal(opened(), undefined, `${name} is turned away by the page, so is not told about it`);
            assert.deepEqual(_writes, [], `${name}'s device is left unflagged`);
        }
    });

    test('a manager is told — the page is theirs too', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, session: { name: MANAGER } });
        await settleAccess();
        assert.ok(opened(), `${MANAGER} is a manager, and the page opened to the managers at v25.60`);
    });

    test('on a phone browser it waits for the install notice — and is NOT flagged', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, route: { how: 'menu', mirror: false } });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, []);
    });

    test('on a phone browser, the load after the install notice was answered, it opens', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, route: { how: 'ios', mirror: false }, store: { [DONE_KEY_OF(INST)]: '1' } });
        await settleAccess();
        assert.ok(opened());
    });

    test('NOT on the load the install notice is answered — that flag is read at wiring time', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, route: { how: 'menu', mirror: false }, present: [...DESK.present, INST.overlay],
                     store: { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' } });
        await settleAccess();
        const install = /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === INST.overlay));
        assert.ok(install, 'the install notice comes first');
        assert.equal(opened(), undefined, 'and this one is not decided on that load');
        install._cfg.onClose();                               // answered: its flag is written now…
        mock.timers.tick(10_000);                             // …and nothing follows it up this visit
        await drain();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, [[DONE_KEY_OF(INST), '1']], 'this notice is not flagged — it comes next time');
    });

    test('not on the shared PIN station — and not flagged there', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...DESK, accessType: 'viewer', session: null });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, []);
    });

    test('the evening before its posting day: not opened, and NOT flagged, so the same device sees it on the 9th', async () => {
        mock.timers.setTime(new Date(2026, 10, 8, 21, 0).getTime());
        await wire(DESK);
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes.filter(([k]) => k === DONE), []);
    });

    test('late on Saturday 5 December it is still offered', async () => {
        mock.timers.setTime(new Date(2026, 11, 5, 23, 0).getTime());
        await wire(DESK);
        await settleAccess();
        assert.ok(opened());
    });

    test('once expired, a device that never saw it is flagged and shown nothing', async () => {
        mock.timers.setTime(new Date(2026, 11, 6, 9, 0).getTime());
        await wire({ ...DESK, expired: true });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.ok(_writes.some(([k, v]) => k === DONE && v === '1'), 'flagged done without being shown');
    });

    test('every dismissal marks it done, and it is archived on OPEN under its own section', async () => {
        mock.timers.setTime(NOV_27);
        await wire(DESK);
        await settleAccess();
        const lb = opened();
        assert.ok(lb);
        const click = { type: 'click', button: 0 };
        _listeners.get('newlinkNoticeGo:click')?.(click);
        assert.deepEqual(_writes, [[DONE, '1']], 'the link marks it done before the page is left');
        // …and is followed by REPLACING this notice's history entry, never left to stack the page on top of it.
        assert.equal(_followed.length, 1, 'the link was left to the browser, which leaves a dead step in Back');
        assert.equal(_followed[0].lb, lb, 'handed over with its OWN notice, whose entry it replaces');
        assert.equal(_followed[0].e, click);
        _writes = [];
        lb._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']], 'so does a close');
        lb._cfg.onOpen();                                     // the harness records an open; the lightbox would run this itself
        const filed = _archived.find(n => n.id === 'newlink-vote-2026');
        assert.ok(filed, 'archived on OPEN, before the link can take the member away');
        assert.equal(filed.section, 'New link', 'filed under the page it is about — coloured in App Notices (block 10)');
    });

    test('its words say what the page says, and its menu route is the real pill', async () => {
        // A notice that names a month, a number and a menu entry is three facts that can drift from the page. Each is
        // read from where the page keeps it: the month from newlink-config.js (a test may import it; the Calendar may
        // not — newlink-boundary.test.mjs), the number from the page's own heading, the route from the drawer's pill.
        const here = new URL('.', REPO_ROOT_URL);
        const html = readFileSync(new URL('./index.html', here), 'utf8');
        const block = html.slice(html.indexOf('id="newlinkNoticeLb"'), html.indexOf('<!--', html.indexOf('id="newlinkNoticeLb"')));
        const text = block.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&rarr;/g, '→').replace(/\s+/g, ' ');
        const { STARTS } = await import('../newlink-config.js');
        const [y, mo] = String(STARTS).split('-').map(Number);
        const month = new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'long' });
        assert.match(text, new RegExp(`starts in ${month} ${y}\\b`), `the page starts the link in ${month} ${y} (newlink-config.js → STARTS)`);
        const page = readFileSync(new URL('./newlink.html', here), 'utf8');
        assert.match(page, /<h2><span[^>]*>[^<]*<\/span> The new link: three proposals<\/h2>/, 'the page still heads itself "three proposals"');
        assert.match(text, /\bthe three proposals\b/);
        const { NAV_PAGES } = await import('../nav-destinations.js');
        const newlinkPill = NAV_PAGES.find(p => p.id === 'newlink');
        assert.ok(newlinkPill, 'the drawer still has a New link pill');
        const pill = [null, newlinkPill.label, newlinkPill.url];   // [, label, url], as the reads below index it
        assert.ok(text.includes(`then ${pill[1]}`), `the menu route names the pill as the drawer labels it: ${pill[1]}`);
        assert.ok(block.includes(`href="${pill[2]}"`), `the link goes where the pill goes: ${pill[2]}`);
        assert.ok(block.includes(`<div class="notice-badge notice-badge--newlink">${pill[1]}</div>`), 'the badge is the pill, word for word');
        // A vote decides it (owner, 26 Nov 2026), and HOW it is run is not settled, so nothing is said about that.
        assert.match(text, /decided by a vote/);
        assert.doesNotMatch(text, /ballot|online|in person|polling|\badmin\b|how to vote/i, 'it says nothing about how the vote is run, nor who builds the page');
        // App Notices keeps the record for 180 days, long after voting has begun: it never says "soon".
        mock.timers.setTime(NOV_27);
        await wire(DESK);
        await settleAccess();
        opened()?._cfg.onOpen();
        const filed = _archived.find(n => n.id === 'newlink-vote-2026');
        assert.ok(filed, 'premise: it was archived');
        assert.doesNotMatch(filed.title + filed.body, /\bsoon\b|starts (on|in) /i, 'the record says what stays true after the vote has begun');
    });
});

describe('12 · a follower never waits on a retired notice\'s code (16 Nov 2026)', () => {
    // A follower waited for the followed notice's done flag ALONE, and only that notice's own IIFE sets it — on
    // a dismissal, or as it reaches its expiry branch. The monthly cleanup deletes a notice's markup and code 180
    // days after posting; from then a device that had never answered it would never get the flag, and the
    // notice behind it would wait for ever. The followed notice's END now stands in for its flag
    // (`FOLLOWED_ENDS`), and outlives its code.
    const ENDS = Object.fromEntries([...(/const FOLLOWED_ENDS = \{([\s\S]*?)\n\};/.exec(SOURCE)?.[1] ?? '')
        .matchAll(/(myb_\w+_done):\s*\[([^,\]]+),\s*(\d+)\]/g)].map(m => [m[1], [m[2].trim(), Number(m[3])]]));
    /** A constant's string value, read from the notice's own IIFE first and the module second. @param {string} scope @param {string} expr */
    const value = (scope, expr) => {
        if (/^'[^']*'$/.test(expr)) return expr.slice(1, -1);
        const re = new RegExp(`const ${expr}\\s*=\\s*'([^']+)'`);
        return re.exec(scope)?.[1] ?? re.exec(SOURCE)?.[1] ?? null;
    };
    const INST = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'installNoticeLb'));
    const LINES = [...SOURCE.matchAll(/^\s+(installNotice\w+):\s/gm)].map(m => m[1]);
    /** Past the end of 31 October, and nothing else: the two October notices are over, the install notice is not. */
    const PAST_OCTOBER = (/** @type {string} */ day, /** @type {number} */ days) => day === '31 Oct 2026' && days === 1;
    const opened = () => _openedViaHelper.some(lb => lb._cfg.overlay.id === INST.overlay);

    test('every key a live notice follows has an end recorded', () => {
        const followed = new Set(NOTICES.flatMap(n => [n.follows, n.followsPay, n.followsInstall, n.followsNewlink]).filter(Boolean));
        assert.ok(followed.size > 0, 'guard: some notice follows another');
        for (const key of followed) assert.ok(ENDS[/** @type {string} */ (key)], `${key} is followed and has no end in FOLLOWED_ENDS`);
    });

    test('each recorded end is the one the live notice itself expires on', () => {
        let checked = 0;
        for (const n of NOTICES) {
            const end = ENDS[DONE_KEY_OF(n)];
            if (!end) continue;
            const scope = IIFE_OF(n.overlay);
            const own = /isNoticeExpired\((\w+|'[^']*'),\s*(\d+)\)/.exec(scope);
            assert.ok(own, `${n.overlay} declares no expiry`);
            assert.deepEqual([value(scope, own[1]), Number(own[2])], [value(scope, end[0]), end[1]],
                `${n.overlay}: FOLLOWED_ENDS says a follower may stop waiting on a different day from the one the notice ends`);
            checked++;
        }
        assert.ok(checked >= 2, `guard: only ${checked} live notices were held to their end`);
    });

    test('with the two October notices RETIRED — markup and code gone, flags never set — the install notice still comes', async () => {
        await wire({ accessType: 'named', present: [INST.overlay, ...LINES, 'installNoticeLater'], expired: PAST_OCTOBER });
        await settleAccess();
        assert.ok(opened(), 'the install notice waited for a flag only a deleted notice could set');
        assert.deepEqual(_writes, [], 'nothing flagged on the retired notices\' behalf, and nothing on its own until answered');
    });

    test('…but while the followed notice could still be offered, its flag is still what the follower waits for', async () => {
        await wire({ accessType: 'named', present: [INST.overlay, ...LINES, 'installNoticeLater'], expired: false });
        await settleAccess();
        assert.equal(opened(), false);
        await wire({ accessType: 'named', present: [INST.overlay, ...LINES, 'installNoticeLater'], expired: false,
                     store: { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' } });
        await settleAccess();
        assert.ok(opened(), 'premise: with both flags it opens');
    });
});

// ── A NOTICE'S LINK LEAVES NO DEAD STEP IN BACK (18 Nov 2026) ─────────────────────────────────────────────
// A notice's call to action was a plain <a href> whose listener only answered the notice, so the page it opened
// stacked on top of the notice's own history entry, and one Back from there landed on a step of the Calendar that
// nothing answered. Every link is wired through `_wireNoticeLink` now, which hands the click to `followLinkOutOf`
// (overlay.js: replace that entry with the page — overlay-history.test.mjs drives it). Read from the MARKUP, so a
// notice added later is held to it; the browser journey is e2e/calendar-notices.spec.js.
describe('13 · every notice\'s link replaces the notice\'s history entry rather than stacking on it', () => {
    const page = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
    const links = [...page.matchAll(/<a [^>]*\bid="(\w+NoticeGo)"/g)].map(m => m[1]);

    test('premise: the notices carry links', () => {
        assert.ok(links.length >= 2, `index.html: found ${links.length} notice links`);
    });
    for (const id of links) {
        test(`#${id} is wired through _wireNoticeLink, with its own notice`, () => {
            assert.match(SOURCE, new RegExp(`_wireNoticeLink\\('${id}', lb, \\w+\\);`), `#${id} is not wired through the one helper`);
        });
    }
    test('no notice wires its link by hand', () => {
        assert.doesNotMatch(SOURCE, /NoticeGo'\)\?\.addEventListener\(/, 'a hand-wired link is left to the browser, which stacks the page on the notice');
    });
});

describe('14 · where storage will not keep a flag, no notice opens — and archived words are corrected (App Notices review, 24 Nov 2026)', () => {
    // A storage that fails every write silently (Safari with every cookie blocked, a full quota) never kept a done flag,
    // so each "one-time" notice opened on every load. And App Notices lists a record for 180 days, longer than some of
    // their words stay true: the records are corrected on every load, whether or not the notice is still offered.
    test('no storage: nothing is wired, opened or written', async () => {
        mock.timers.setTime(LIVE_DAY);
        await wire({ accessType: 'named', storageWorks: false });
        await settleAccess();
        assert.deepEqual(_openedViaHelper, [], 'not one notice opened');
        assert.deepEqual(_writes, [], 'and nothing written');
    });
    test('the control: with storage, the same device gets its notice', async () => {
        mock.timers.setTime(LIVE_DAY);
        await wire({ accessType: 'named' });
        await settleAccess();
        assert.ok(_openedViaHelper.length > 0, 'a notice opened');
    });
    test('every load corrects the two records whose words went out of date — with or without storage', async () => {
        for (const storageWorks of [true, false]) {
            await wire({ accessType: 'named', storageWorks, store: { myb_notice_timetable_soon_2026_done: '1', myb_notice_newlink_vote_2026_done: '1' } });
            assert.deepEqual(_revised.map(r => r.id).sort(), ['newlink-2026', 'timetable-soon-2026']);
            for (const r of _revised) {
                assert.doesNotMatch(r.title + r.body, /\bstarts on Sunday|Nothing is decided/, `${r.id} still says what will stop being true`);
            }
        }
    });
    test('the record a notice files is the record it corrects', async () => {
        mock.timers.setTime(LIVE_DAY);
        await wire({ accessType: 'named', present: ['timetableSoonNoticeLb'], store: { myb_notice_install_app_2026_done: '1', myb_notice_newlink_vote_2026_done: '1' } });
        await settleAccess();
        const lb = /** @type {any} */ (_openedViaHelper.find(l => l._cfg.overlay.id === 'timetableSoonNoticeLb'));
        assert.ok(lb, 'premise: the timetable notice opened');
        lb._cfg.onOpen();
        const filed = _archived.find(n => n.id === 'timetable-soon-2026');
        assert.deepEqual(filed, _revised.find(n => n.id === 'timetable-soon-2026'));
    });
});

describe('15 · move to the main address: only on the GitHub Pages copy, after the timetable notice, 26 Nov – 31 Dec (v26.90)', () => {
    // Owner, 26 Nov 2026: "a sequential app notice on calendar" for those still on the GitHub Pages copy — reinstall
    // from the main address, and how to move their pay data. Organised by what a wrong answer costs: shown on the main
    // address it tells somebody already there to move; missing a desk or the installed app on the mirror misses the
    // stragglers it is for; sharing a visit breaks one-at-a-time; and flagged where refused, that device never sees it.
    const MV   = /** @type {{ overlay: string, audience: string, follows: string|null, followsInstall: string|null, starts: number|null }} */ (NOTICES.find(n => n.overlay === 'moveNoticeLb'));
    const SOON = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'timetableSoonNoticeLb'));
    const INST = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'installNoticeLb'));
    const DONE = DONE_KEY_OF(MV);
    const IIFE = IIFE_OF('moveNoticeLb');
    const NOV_27 = new Date(2026, 10, 27, 9, 0).getTime();
    const opened = () => /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === MV.overlay));
    /** The timetable notice answered on an earlier load, and the October notices ended: the move notice's turn. */
    const AFTER_TIMETABLE = { [DONE_KEY_OF(SOON)]: '1', [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' };
    const ON_MIRROR = { accessType: /** @type {const} */ ('named'), mirror: true, route: null, store: AFTER_TIMETABLE,
                        present: [MV.overlay, 'moveNoticeGo', 'moveNoticeLater', 'moveNoticePay'] };

    test('in the matrix, members only, its own key, no snooze, 26 November to the end of 31 December, after the REAL timetable and install keys', () => {
        assert.ok(MV, 'found by the same pattern as every other notice');
        assert.equal(MV.audience, 'members');
        assert.equal(DONE, 'myb_notice_move_to_main_2026_done');
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
        assert.equal(MV.starts, new Date(2026, 10, 26).getTime(), 'STARTS is its posting day, read from the source');
        assert.match(IIFE, /const LAST_DAY\s*=\s*'31 Dec 2026'/);
        assert.match(IIFE, /isNoticeExpired\(LAST_DAY, 1\)/);
        // Restated keys: a rename on either side would leave this notice waiting for a flag nothing writes.
        assert.equal(MV.follows, DONE_KEY_OF(SOON));
        assert.equal(MV.followsInstall, DONE_KEY_OF(INST));
        assert.match(IIFE, /if \(!followedDone\(FOLLOWS\)\) return;/, 'the timetable notice, through its END too — never its flag alone');
        assert.match(IIFE, /onPagesMirror\(\)/, 'the mirror is asked on every device, not through installRoute()');
    });

    test('on the mirror it opens on a desk, in the installed app and in a phone browser after the install notice', async () => {
        mock.timers.setTime(NOV_27);
        for (const [what, route, extra] of /** @type {const} */ ([
            ['a desk', null, {}],
            ['the installed app', null, {}],
            ['a phone browser, install notice answered', { how: 'menu', mirror: true }, { [DONE_KEY_OF(INST)]: '1' }],
        ])) {
            await wire({ ...ON_MIRROR, route: /** @type {any} */ (route), store: { ...AFTER_TIMETABLE, ...extra } });
            await settleAccess();
            assert.ok(opened(), `not offered on ${what}`);
            assert.deepEqual(_writes, [], `${what}: nothing flagged before an answer`);
        }
    });

    test('on the main address it never opens — and nothing is flagged', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...ON_MIRROR, mirror: false });
        await settleAccess();
        assert.equal(opened(), undefined, 'it told somebody already on the main address to move');
        assert.ok(!_writes.some(([k]) => k === DONE), 'refused, so left unflagged');
    });

    test('in a mirror phone browser it waits for the install notice, unflagged', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...ON_MIRROR, route: { how: 'menu', mirror: true } });
        await settleAccess();
        assert.equal(opened(), undefined, 'it shared a visit with the install notice');
        assert.ok(!_writes.some(([k]) => k === DONE));
    });

    test('it waits for the timetable notice, and is not even wired on the load that one is still to come', async () => {
        mock.timers.setTime(NOV_27);
        await wire({ ...ON_MIRROR, store: { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' } });
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.ok(!_writes.some(([k]) => k === DONE));
    });

    test('before 26 November nothing is offered', async () => {
        mock.timers.setTime(new Date(2026, 10, 25, 9, 0).getTime());
        await wire(ON_MIRROR);
        await settleAccess();
        assert.equal(opened(), undefined);
    });

    test('every dismissal marks it done; it is archived on OPEN, and its link replaces the notice\'s history entry', async () => {
        mock.timers.setTime(NOV_27);
        await wire(ON_MIRROR);
        await settleAccess();
        const lb = opened();
        assert.ok(lb);
        const click = { type: 'click', button: 0 };
        _listeners.get('moveNoticeGo:click')?.(click);
        assert.deepEqual(_writes, [[DONE, '1']], 'the link marks it done before the page is left');
        assert.equal(_followed.length, 1);
        assert.equal(_followed[0].lb, lb);
        _writes = [];
        lb._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']], 'so does a close');
        lb._cfg.onOpen();
        const filed = _archived.find(n => n.id === 'move-to-main-2026');
        assert.ok(filed, 'archived on OPEN, before the link takes the member to the other address');
        assert.equal(filed.section, 'General');
        assert.doesNotMatch(filed.title + filed.body, /\bsoon\b|will close|github\.io/i, 'the record says what stays true after the move');
    });

    // PAY WORDS ONLY WHERE THE PAY PAGE PRICES THE MEMBER (external review of v26.92), as the install notice does: a
    // Dispatcher or an Other Staff login has no Pay Calculator figures to move. On screen and in App Notices alike.
    test('a member the Pay page does not price is told nothing about moving pay figures — on screen or in App Notices', async () => {
        const notPriced = teamMembers.find(m => !m.hidden && !payCalcFor({ name: m.name }))?.name;
        assert.ok(notPriced, 'precondition: the roster has somebody the Pay page does not price');
        mock.timers.setTime(NOV_27);
        await wire({ ...ON_MIRROR, session: { name: notPriced } });
        await settleAccess();
        opened()._cfg.onOpen();
        assert.equal(_els.get('moveNoticePay')?.hidden, true, 'the pay paragraph is hidden');
        const filed = _archived.find(n => n.id === 'move-to-main-2026');
        assert.doesNotMatch(filed.body, /pay/i, `App Notices keeps no pay words either: "${filed.body}"`);
        assert.match(filed.body, /myb-roster\.web\.app/);
    });

    // A COPY FILED UNDER THE OLD WORDS IS CORRECTED FOR ITS READER (review of v26.94). Before v26.94 every reader's
    // record carried the pay paragraph, and `moveRecord(pay)` reached only copies filed after it. The words depend on
    // who reads, and a front-door sign-in has no session at wiring time, so the correction waits for access — and for
    // a member it can name. It runs whether or not the notice is still due (its done flag set here), as the record
    // outlives the notice.
    test('an archived copy is revised to this reader\'s words once access is decided — never before, never for nobody', async () => {
        const notPriced = teamMembers.find(m => !m.hidden && !payCalcFor({ name: m.name }))?.name;
        assert.ok(notPriced, 'precondition: the roster has somebody the Pay page does not price');
        assert.ok(payCalcFor({ name: 'G. Miller' }), 'precondition: G. Miller is somebody the Pay page prices');
        const moveRevisions = () => _revised.filter(r => r.id === 'move-to-main-2026');
        for (const [name, pay] of /** @type {const} */ ([[notPriced, false], ['G. Miller', true]])) {
            mock.timers.setTime(NOV_27);
            await wire({ ...ON_MIRROR, session: { name }, store: { ...AFTER_TIMETABLE, [DONE]: '1' } });
            assert.deepEqual(moveRevisions(), [], `${name}: not at wiring time, when a front-door sign-in has no session`);
            await settleAccess();
            const [r] = moveRevisions();
            assert.equal(moveRevisions().length, 1, `${name}: revised once`);
            assert.equal(opened(), undefined, 'premise: the notice itself is done and did not open');
            assert.equal(r.date, '26 Nov 2026', 'the date the archived copy carries, which `reviseArchivedNotice` matches on');
            assert.equal(/pay/i.test(r.body), pay, `${name}: "${r.body}"`);
        }
        // Nobody to name — a locked page, or a member grant whose session cannot be read: the record is left alone,
        // rather than stripped of a priced member's pay words.
        for (const [what, extra] of /** @type {const} */ ([['no access', { accessType: 'none' }], ['no session', { session: null }]])) {
            await wire({ ...ON_MIRROR, ...extra, store: { ...AFTER_TIMETABLE, [DONE]: '1' } });
            await settleAccess();
            assert.deepEqual(moveRevisions(), [], `${what}: nothing revised`);
        }
    });

    test('a member the Pay page prices is told, and told WHERE to restore — never "there"', async () => {
        mock.timers.setTime(NOV_27);
        await wire(ON_MIRROR);
        await settleAccess();
        opened()._cfg.onOpen();
        assert.equal(_els.get('moveNoticePay')?.hidden, false, 'the pay paragraph shows');
        const filed = _archived.find(n => n.id === 'move-to-main-2026');
        assert.match(filed.body, /Move Your Pay\u00a0Data/);
        assert.match(filed.body, /restore it at myb-roster\.web\.app/);
        const html = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        assert.match(html, /<p id="moveNoticePay" class="notice-body" hidden>/, 'hidden in the markup until a member is known');
        assert.match(html, /then restore it at <strong class="notice-address">myb-roster\.web\.app<\/strong>\./);
    });

    test('its words name both addresses and the Pay page\'s own card, and its link is the install notice\'s', () => {
        const here = new URL('.', REPO_ROOT_URL);
        const html = readFileSync(new URL('./index.html', here), 'utf8');
        const at = html.indexOf('id="moveNoticeLb"');
        const block = html.slice(at, html.indexOf('<!--', at));
        const text = block.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        assert.match(text, /garethdavidmiller\.github\.io/);
        assert.match(text, /myb-roster\.web\.app/);
        // Notifications on at the main address AND off here, or each one arrives twice (owner, 26 Nov 2026).
        assert.match(text, /turn notifications on there in ☰ then ⚙️ Settings\. Then turn them off here, or you will get each one twice\./);
        // The card's name as the Pay page heads it, emoji and all: a renamed card would send people looking for nothing.
        const pay = readFileSync(new URL('./paycalc.html', here), 'utf8');
        const card = /<h2><span aria-hidden="true">([^<]+)<\/span> (Move Your Pay Data)<\/h2>/.exec(pay);
        assert.ok(card, 'the Pay page still has its Move Your Pay Data card');
        assert.ok(text.includes(`${card[1]} ${card[2]}`), `the notice names the card as the Pay page does: ${card[1]} ${card[2]}`);
        const href = (/** @type {string} */ id) => new RegExp(`href="([^"]+)" id="${id}"`).exec(html)?.[1];
        assert.equal(href('moveNoticeGo'), href('installNoticeGo'), 'one main address, written the same in both notices');
    });
});

describe('16 · see who you are on duty with: Team View, last in the queue, for members on the roster, from 27 Nov (owner, 27 Nov 2026)', () => {
    // "An in sequence app notice on calendar to explain team view — see who you are on duty with or could swap shifts
    // with." Organised by what a wrong answer costs: sharing a visit breaks one-at-a-time; offered to an Other Staff
    // login it asks somebody with no line who they are on with; flagged where refused, that device never sees it; and
    // a button that toggles Team View when it is already showing takes the reader back to the month.
    const TV   = /** @type {{ overlay: string, audience: string, follows: string|null, followsInstall: string|null, starts: number|null }} */ (NOTICES.find(n => n.overlay === 'teamNoticeLb'));
    const SOON = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'timetableSoonNoticeLb'));
    const INST = /** @type {{ overlay: string }} */ (NOTICES.find(n => n.overlay === 'installNoticeLb'));
    const DONE = DONE_KEY_OF(TV);
    const IIFE = IIFE_OF('teamNoticeLb');
    const NOV_27 = new Date(2026, 10, 27, 9, 0).getTime();
    const opened = () => /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === TV.overlay));
    const AFTER_TIMETABLE = { [DONE_KEY_OF(SOON)]: '1', [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' };
    const ON_DESK = { accessType: /** @type {const} */ ('named'), route: null, store: AFTER_TIMETABLE,
                      present: [TV.overlay, 'teamNoticeShow', 'teamNoticeLater', 'teamViewBtn'] };

    test('in the matrix, members only, its own key, no snooze, from 27 November for 90 days, after the REAL timetable and install keys, wired last', () => {
        assert.ok(TV, 'found by the same pattern as every other notice');
        assert.equal(TV.audience, 'members');
        assert.equal(DONE, 'myb_notice_team_view_2026_done');
        assert.doesNotMatch(IIFE, /SNOOZE_KEY/, 'a one-off declares no snooze');
        assert.equal(TV.starts, new Date(2026, 10, 27).getTime(), 'STARTS is its posting day, read from the source');
        assert.match(IIFE, /const NOTICE_DATE\s*=\s*'27 Nov 2026'/);
        assert.match(IIFE, /isNoticeExpired\(NOTICE_DATE, 90\)/);
        assert.equal(TV.follows, DONE_KEY_OF(SOON), 'after the timetable notice, which itself waits for the install and New link ones');
        assert.equal(TV.followsInstall, DONE_KEY_OF(INST));
        assert.match(IIFE, /if \(!followedDone\(FOLLOWS\)\) return;/, 'the timetable notice, through its END too — never its flag alone');
        assert.equal(NOTICES[NOTICES.length - 1].overlay, TV.overlay, 'wired last, so it yields to every other notice');
    });

    test('on a desk, after the timetable notice, it opens for a member on the roster — nothing flagged yet', async () => {
        mock.timers.setTime(NOV_27);
        await wire(ON_DESK);
        await settleAccess();
        assert.ok(opened());
        assert.deepEqual(_writes, []);
    });

    test('not for an Other Staff login, nor a name not on the roster — and NOT flagged for either', async () => {
        const other = teamMembers.find(m => isOtherStaff(m))?.name;
        assert.ok(other, 'precondition: the roster has an Other Staff login');
        for (const name of [other, 'Not On The Roster']) {
            mock.timers.setTime(NOV_27);
            await wire({ ...ON_DESK, session: { name } });
            await settleAccess();
            assert.equal(opened(), undefined, `${name}: offered`);
            assert.ok(!_writes.some(([k]) => k === DONE), `${name}: refused, so left unflagged`);
        }
    });

    test('it waits for the timetable notice, and on a phone browser for the install notice — unflagged', async () => {
        mock.timers.setTime(NOV_27);
        for (const [what, extra] of /** @type {const} */ ([
            ['the timetable notice still to come', { store: { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1' } }],
            ['a phone browser before the install notice', { route: { how: 'menu', mirror: false } }],
        ])) {
            await wire({ ...ON_DESK, ...extra });
            await settleAccess();
            assert.equal(opened(), undefined, `it shared a visit with ${what}`);
            assert.ok(!_writes.some(([k]) => k === DONE));
        }
    });

    test('NOT on the load the timetable notice is answered — that flag is read at wiring time — and the load after, it opens', async () => {
        mock.timers.setTime(NOV_27);
        // The vote notice answered, so the timetable notice — which waits for it until 6 December — has this load.
        const VOTE = DONE_KEY_OF(/** @type {any} */ (NOTICES.find(n => n.overlay === 'newlinkNoticeLb')));
        await wire({ ...ON_DESK, present: [...ON_DESK.present, SOON.overlay], store: { [OCT_TIMETABLE_KEY]: '1', [OCT_YTD_KEY]: '1', [VOTE]: '1' } });
        await settleAccess();
        const soon = /** @type {any} */ (_openedViaHelper.find(lb => lb._cfg.overlay.id === SOON.overlay));
        assert.ok(soon, 'premise: the timetable notice has this load');
        soon._cfg.onClose();
        assert.equal(opened(), undefined, 'the second notice of one visit');
        await wire({ ...ON_DESK, store: { ..._store } });
        await settleAccess();
        assert.ok(opened(), 'the next load is its turn');
    });

    test('before 27 November nothing is offered, and nothing flagged', async () => {
        mock.timers.setTime(new Date(2026, 10, 26, 21, 0).getTime());
        await wire(ON_DESK);
        await settleAccess();
        assert.equal(opened(), undefined);
        assert.deepEqual(_writes, []);
    });

    test('"Open Team Week View" answers it, closes it and presses the page\'s own 👥 Team button; Not now and the close answer it', async () => {
        mock.timers.setTime(NOV_27);
        await wire(ON_DESK);
        await settleAccess();
        const lb = opened();
        _listeners.get('teamNoticeShow:click')?.();
        assert.deepEqual(_writes, [[DONE, '1']]);
        assert.deepEqual(_closed, [TV.overlay]);
        assert.deepEqual(_clicks, ['teamViewBtn'], 'Team View through its own button — its guards and announcement are its own');
        _writes = [];
        lb._cfg.onClose();
        assert.deepEqual(_writes, [[DONE, '1']], 'any close answers it');
        _listeners.get('teamNoticeLater:click')?.();
        assert.deepEqual(_closed, [TV.overlay, TV.overlay], 'Not now closes it');
    });

    test('with Team View already showing, the button leaves it showing — never toggles back to the month', async () => {
        mock.timers.setTime(NOV_27);
        await wire(ON_DESK);
        await settleAccess();
        const doc = /** @type {any} */ (global.document);
        doc.body = { classList: { contains: (/** @type {string} */ c) => c === 'team-view-active' } };
        try {
            _listeners.get('teamNoticeShow:click')?.();
            assert.deepEqual(_clicks, [], 'pressed Team while Team View was up');
            assert.deepEqual(_writes, [[DONE, '1']]);
        } finally { delete doc.body; }
    });

    test('archived on open, in words that stay true — and its body names where Team is, so Not now loses nothing', async () => {
        mock.timers.setTime(NOV_27);
        await wire(ON_DESK);
        await settleAccess();
        opened()._cfg.onOpen();
        const filed = _archived.find(n => n.id === 'team-view-2026');
        assert.ok(filed);
        assert.equal(filed.section, 'Calendar');
        assert.equal(filed.date, '27 Nov 2026');
        assert.match(filed.body, /👥\u00a0Team above your calendar/);
        assert.doesNotMatch(filed.title + filed.body, /\bnew\b|\bsoon\b|\btoday\b/i, 'nothing that dates');
        const html = readFileSync(new URL('./index.html', REPO_ROOT_URL), 'utf8');
        const at = html.indexOf('id="teamNoticeLb"');
        const text = html.slice(at, html.indexOf('</div>\n    </div>', at)).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        assert.match(text, /👥 Team , above your calendar/, 'where the button is');
        assert.match(text, /📅 Month brings your calendar back/, 'and the way back, in the words the button then shows');
        // The screen's own name, as its About badge and the Team button's spoken label give it.
        assert.match(text, /Open Team Week View/);
        assert.match(readFileSync(new URL('./calendar-team-view.js', REPO_ROOT_URL), 'utf8'), /'Switch to Team Week View'/);
        assert.doesNotMatch(text, /resting/, 'one word for it: "on a rest day", the app\'s own');
    });
});
