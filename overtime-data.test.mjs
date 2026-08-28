/**
 * overtime-data.test.mjs — THE CLOCK, AND WHAT A CALL SAYS WHEN IT DOES NOT COME BACK.
 * Run with: node --experimental-test-module-mocks --test overtime-data.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `clockOffset` and `submitDisposition` are pure and pinned in `overtime-format.test.mjs`. Neither
 * can see the thing that decides whether a member is offered Submit in the minutes around a noon
 * deadline, because that is not a calculation — it is whether the corrected clock this module keeps
 * was ever actually fed. An offset that is computed and dropped leaves `correctedNow()` reading the
 * device clock, and a phone ten minutes fast then hides the Submit button from somebody who is in
 * time. Nothing errors, and the member has no way to tell that from a form that is simply closed.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 *   1. THE CLOCK IS WRONG. Silent, and it decides a deadline.
 *   2. A TIMEOUT REPORTED AS A FAILURE. Aborting stops us waiting; it does not stop the server
 *      writing. Telling a member their availability did not save, while it is saving, is the one
 *      wrong answer here that makes them act — they re-submit, or they give up.
 *   3. A SUBMISSION THAT CANNOT BE RECONCILED. Every device of a member shares one Firebase uid, so
 *      `clientMutationId` is the only thing that can recognise THIS phone's lost request.
 *
 * ── THE FAKES ───────────────────────────────────────────────────────────────────────────────────
 *
 * `fetch-timeout.js` is the REAL module and `globalThis.fetch` is the fake, so the three-way error
 * classification under test is the shipped one rather than a restatement of it. `overtime-format.js`
 * is real too — it is pure, and mocking `clockOffset` would test the mock.
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE NETWORK ────────────────────────────────────────────────────────────────────────────
/** @type {Array<{ url: string, options: any, body: any }>} */
let _calls = [];
/** @type {(req: any) => Promise<any>} */
let _respond = async () => ({ ok: true, status: 200, json: async () => ({}) });

globalThis.fetch = async (/** @type {string} */ url, /** @type {any} */ options) => {
    const req = { url, options, body: JSON.parse(options?.body ?? '{}') };
    _calls.push(req);
    // Honour the signal exactly as a real fetch does, so the bound and a caller's cancellation both
    // reach `fetchWithTimeout` the way they would in a browser.
    const sig = options?.signal;
    const result = _respond(req);
    if (!sig) return result;
    return Promise.race([
        result,
        new Promise((_res, rej) => {
            if (sig.aborted) return rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            sig.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    ]);
};

/** A response that never arrives on its own — the only way to reach the bound. */
const NEVER = () => new Promise(() => {});

/** Let the queued microtasks run. Load-bearing before any `tick`: `post` awaits a fresh ID token
 *  BEFORE it opens the request, so the bound's timer does not exist yet at the moment the call
 *  returns its promise — ticking first advances a clock nothing is waiting on, and the test hangs. */
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

// ── THE REST OF THE APP ─────────────────────────────────────────────────────────────────────────
/** @type {null | { getIdToken: () => Promise<string> }} */
let _user = { getIdToken: async () => 'tok-1' };

mock.module('./firebase-client.js', {
    namedExports: {
        auth: { get currentUser() { return _user; } },
        db: {}, collection: () => ({}), doc: () => ({}), getDocs: async () => ({ forEach() {} }),
    },
});
mock.module('./overtime-roster.js', { namedExports: { loadRosterForMembers: async () => ({}) } });

/** The clock is only mocked for `setTimeout`, never for `Date`. Mocking Date here wedged the
 *  runner — and the assertions do not need it: the correction is asserted as a DIFFERENCE from the
 *  device clock, to a tolerance far below the minutes a wrong offset produces. */
const NEAR_MS = 1000;
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ msg) =>
    assert.equal(Math.abs(a - b) < NEAR_MS, true, `${msg} (${a} vs ${b})`);

let _n = 0;
/** A module instance with its own offset — the offset is module state with no public reset. */
const freshData = () => import(`./overtime-data.js?n=${++_n}`);

beforeEach(() => {
    _calls = [];
    _user = { getIdToken: async () => 'tok-1' };
    _respond = async () => ({ ok: true, status: 200, json: async () => ({}) });
    mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => { mock.timers.reset(); });


describe('1 · the clock is wrong', () => {
    test('before any call it is the device clock, plainly', async () => {
        const data = await freshData();
        near(data.correctedNow(), Date.now(), 'no correction has been offered yet');
    });

    test('a read moves it onto the server’s clock', async () => {
        const data = await freshData();
        const serverNow = Date.now() + 10 * 60_000;      // the device is ten minutes SLOW
        _respond = async () => ({ ok: true, status: 200, json: async () => ({ serverNow }) });

        await data.getMyOvertimeState();
        // What is pinned here is that the offset was FED, not the arithmetic — that is clockOffset's
        // suite. A dropped offset leaves the device clock in charge, ten minutes out.
        near(data.correctedNow(), serverNow, 'the read moved the clock onto the server');
        assert.equal(data.correctedNow() - Date.now() > 9 * 60_000, true, 'and away from the device');
    });

    test('a response WITHOUT serverNow leaves the correction alone', async () => {
        // Resetting to the device clock here would undo a good correction on any endpoint that does
        // not send one — a submission, say — and put a fast phone back in charge of the deadline.
        const data = await freshData();
        const serverNow = Date.now() + 10 * 60_000;
        _respond = async () => ({ ok: true, status: 200, json: async () => ({ serverNow }) });
        await data.getMyOvertimeState();

        _respond = async () => ({ ok: true, status: 200, json: async () => ({ accepted: true }) });
        await data.submitOvertimeAvailability('2026-09-05', {}, 1);
        near(data.correctedNow(), serverNow, 'the earlier correction survives');
    });

    test('a REFUSED response still corrects the clock', async () => {
        // The offset is fed before `res.ok` is consulted, deliberately: a 409 conflict is a perfectly
        // good clock reading, and the next thing the member does is decide whether they are in time.
        const data = await freshData();
        const serverNow = Date.now() + 7 * 60_000;
        _respond = async () => ({ ok: false, status: 409, json: async () => ({ error: 'revision-conflict', serverNow }) });

        const r = await data.submitOvertimeAvailability('2026-09-05', {}, 1);
        assert.equal(r.ok, false);
        assert.equal(/** @type {any} */ (r).code, 'revision-conflict', 'the server’s own machine code, not http-409');
        near(data.correctedNow(), serverNow, 'a 409 is a perfectly good clock reading');
    });

    test('a body that is not JSON at all does not poison the clock', async () => {
        const data = await freshData();
        _respond = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
        const r = await data.getMyOvertimeState();
        assert.equal(/** @type {any} */ (r).code, 'http-502');
        near(data.correctedNow(), Date.now(), 'an unreadable body corrects nothing');
    });
});


describe('2 · a timeout reported as a failure', () => {
    test('the bound fires as `timeout`, never as `network`', async () => {
        const data = await freshData();
        _respond = NEVER;
        const p = data.submitOvertimeAvailability('2026-09-05', {}, 1);
        await flush();
        mock.timers.tick(70_000);
        const r = await p;
        assert.equal(/** @type {any} */ (r).code, 'timeout',
            'the two want opposite copy: go and check, versus it did not happen');
    });

    test('the budget is ABOVE the endpoint’s own 60s ceiling', async () => {
        // A client that gives up first turns a slow-but-succeeding write into a reported failure.
        const data = await freshData();
        _respond = NEVER;
        const p = data.submitOvertimeAvailability('2026-09-05', {}, 1);
        let settled = false;
        p.then(() => { settled = true; });
        await flush();
        mock.timers.tick(60_000);
        await flush();
        assert.equal(settled, false, 'still waiting at the server’s own ceiling');
        mock.timers.tick(10_000);
        await p;
    });

    test('the caller’s own cancellation is `cancelled`, and is not the bound', async () => {
        const data = await freshData();
        _respond = NEVER;
        const ctrl = new AbortController();
        const p = data.getMyOvertimeState({ signal: ctrl.signal });
        await flush();
        ctrl.abort();
        const r = await p;
        assert.equal(/** @type {any} */ (r).code, 'cancelled',
            'a request the caller withdrew is the only one that may be reported as nothing at all');
    });

    test('a transport failure is `network`, and is not a timeout', async () => {
        const data = await freshData();
        _respond = async () => { throw new TypeError('Failed to fetch'); };
        const r = await data.getMyOvertimeState();
        assert.equal(/** @type {any} */ (r).code, 'network');
    });

    test('no Firebase session sends nothing at all', async () => {
        const data = await freshData();
        _user = null;
        const r = await data.getMyOvertimeState();
        assert.equal(/** @type {any} */ (r).code, 'no-session');
        assert.equal(_calls.length, 0, 'an unauthenticated call would only be refused by the server');
    });

    test('a token that cannot be minted is a no-session, not a crash', async () => {
        const data = await freshData();
        _user = { getIdToken: async () => { throw new Error('token revoked'); } };
        const r = await data.getMyOvertimeState();
        assert.equal(/** @type {any} */ (r).code, 'no-session');
        assert.equal(_calls.length, 0);
    });

    test('every call carries a bearer token', async () => {
        const data = await freshData();
        await data.getMyOvertimeState();
        await data.createOvertimeWindow('2026-09-05', { dryRun: true });
        await data.withdrawOvertimeParticipant('2026-09-05', 'A. One', true);
        assert.equal(_calls.length, 3);
        for (const c of _calls) assert.equal(c.options.headers.Authorization, 'Bearer tok-1');
    });
});


describe('3 · a submission that cannot be reconciled', () => {
    test('every submission carries a mutation id, and the caller is given it back', async () => {
        const data = await freshData();
        const r = await data.submitOvertimeAvailability('2026-09-05', { '2026-09-01': {} }, 3);
        const sent = _calls[0].body;
        assert.equal(typeof sent.clientMutationId, 'string');
        assert.match(sent.clientMutationId, /^[A-Za-z0-9_-]{8,64}$/, 'the server’s accepted alphabet');
        assert.equal(/** @type {any} */ (r).mutationId, sent.clientMutationId,
            'the caller cannot recognise its own lost write without it');
    });

    test('a TIMED-OUT submission still returns its mutation id', async () => {
        // This is the case the id exists for. A result that drops it on the one path where the
        // response never arrives makes reconciliation impossible exactly when it is needed.
        const data = await freshData();
        _respond = NEVER;
        const p = data.submitOvertimeAvailability('2026-09-05', {}, 1);
        await flush();
        mock.timers.tick(70_000);
        const r = await p;
        assert.equal(/** @type {any} */ (r).code, 'timeout');
        assert.equal(/** @type {any} */ (r).mutationId, _calls[0].body.clientMutationId);
    });

    test('two submissions never share an id', async () => {
        // Without the Math.random fallback a browser with no crypto left the buffer all zeroes, so
        // every submission from that device carried the same id — which still passes the server's
        // format check and quietly breaks the one thing the id is for.
        const data = await freshData();
        await data.submitOvertimeAvailability('2026-09-05', {}, 1);
        await data.submitOvertimeAvailability('2026-09-05', {}, 2);
        assert.notEqual(_calls[0].body.clientMutationId, _calls[1].body.clientMutationId);
    });

    test('an id is minted even where the platform has no crypto', async () => {
        // `globalThis.crypto` is getter-only in Node, so it is redefined rather than assigned.
        const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        try {
            Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
            const data = await freshData();
            await data.submitOvertimeAvailability('2026-09-05', {}, 1);
            const id = _calls[0].body.clientMutationId;
            assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
            assert.notEqual(id, '0'.repeat(32), 'an all-zero buffer is the shipped defect');
        } finally { if (real) Object.defineProperty(globalThis, 'crypto', real); }
    });

    test('the preview and the commit are the same call with one flag', async () => {
        const data = await freshData();
        await data.createOvertimeWindow('2026-09-05', { dryRun: true });
        await data.createOvertimeWindow('2026-09-05');
        assert.equal(_calls[0].url, _calls[1].url, 'a preview that is a separate prediction can drift from it');
        assert.equal(_calls[0].body.dryRun, true);
        assert.equal(_calls[1].body.dryRun, false);
    });
});
