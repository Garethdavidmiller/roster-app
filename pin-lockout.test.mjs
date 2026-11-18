// @ts-check
/**
 * pin-lockout.test.mjs — the staff PIN's station-wide block, TOLD (functions/pin-lockout.js, Nov 2026):
 * the record, the once-a-day notice, who it reaches and what it says — executed against a fake
 * Firestore, a fake Auth and a recording push transport. The rules it asks are pinned on their own in
 * calendar-viewer-auth.test.mjs; the handler that calls it is index-endpoints.test.mjs's. This is the
 * part between: "the rule tested, the wiring not" is the named risk.
 *
 * Run with: npm run test:functions   (needs firebase-admin from functions/node_modules)
 *
 * Organised by what a wrong answer COSTS: the notice reaching anyone but the admin, or saying the
 * PIN; the admin's phone rung on every trip; and a notice that holds up, or changes, the 401.
 * The admin names here are INVENTED and handed in — never the real roster's.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const fnDir = new URL('./functions/', import.meta.url).pathname;
const firePath = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
const authPath = require.resolve('firebase-admin/auth', { paths: [fnDir] });
const pushPath = require.resolve('./functions/push.js');
const lockoutPath = require.resolve('./functions/pin-lockout.js');
const { nameToEmail } = require('./functions/roster-parse-helpers.js');
const { LOCKOUT_RECORD_KEY, GLOBAL_SOURCE_KEY, GLOBAL_THROTTLE, reserveAttempt, refundAttempt } = require('./functions/calendar-viewer-auth.js');

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 16, 14, 5);           // 14:05 GMT, Mon 16 Nov 2026
const UNTIL = T0 + GLOBAL_THROTTLE.blockMs;          // 14:20
const SITE = 'https://myb-roster.web.app';
const ADMINS = ['Q. Example', 'R. Sample'];          // invented
const PIN_LIKE = /\b\d{4}\b/;

/**
 * A fresh world. `accounts` maps an invented name to its account record (absent → not found).
 * `sweepHang` makes the sweep's collection read never answer. `door` is the all-sources throttle row
 * (`GLOBAL_SOURCE_KEY`) — the block itself; `trip` writes it as the wrong PIN's charge did, first.
 * @param {{ record?: any, accounts?: Record<string, any>, accepted?: number, hang?: boolean, txFail?: boolean, sweepHang?: boolean }} [o]
 */
function world({ record = null, accounts, accepted = 1, hang = false, txFail = false, sweepHang = false } = {}) {
    const w = {
        record: record && { ...record },
        /** @type {any} */ door: null,
        /** @type {{ payload: any, uids: string[], tag: string, opts: any }[]} */ sends: [],
        /** @type {string[]} */ lookups: [],
        broadcasts: 0,
        /** @type {string[]} */ collections: [],
    };
    const accts = accounts ?? Object.fromEntries(ADMINS.map((n, i) => [n, { uid: `uid-${i}`, disabled: false, customClaims: { admin: true } }]));
    const byEmail = new Map(Object.entries(accts).map(([n, u]) => [nameToEmail(n), u]));
    let chain = Promise.resolve();
    /** The two documents this module may read, each backed by its field of `w`. */
    const FIELD = { [LOCKOUT_RECORD_KEY]: 'record', [GLOBAL_SOURCE_KEY]: 'door' };
    const snap = (/** @type {string} */ id) => {
        const v = /** @type {any} */ (w)[FIELD[id]];
        return { exists: v !== null, data: () => v && { ...v } };
    };
    const refOf = (/** @type {string} */ id) => {
        assert.ok(id in FIELD, `an unexpected document: ${id}`);
        return { id, get: async () => snap(id) };
    };
    const db = {
        collection: (/** @type {string} */ name) => {
            w.collections.push(name);
            return {
                doc: refOf,
                limit: () => ({ get: () => (sweepHang ? new Promise(() => {}) : Promise.resolve({ docs: [] })) }),
            };
        },
        runTransaction: (/** @type {(tx: any) => Promise<any>} */ fn) => {
            if (txFail) return Promise.reject(Object.assign(new Error('unavailable'), { code: 14 }));
            // One at a time, as Firestore's serialisable transactions behave to their callers.
            const run = chain.then(() => fn({
                get: async (/** @type {{ id: string }} */ r) => snap(r.id),
                set: (/** @type {{ id: string }} */ r, /** @type {any} */ data) => {
                    assert.equal(r.id, LOCKOUT_RECORD_KEY, 'the notice writes its record, never the throttle row');
                    w.record = { ...data };
                },
            }));
            chain = run.catch(() => {});
            return run;
        },
    };
    const stub = (/** @type {string} */ p, /** @type {any} */ exports) => {
        require.cache[p] = /** @type {any} */ ({ id: p, filename: p, loaded: true, exports });
    };
    stub(firePath, { getFirestore: () => db });
    stub(authPath, { getAuth: () => ({ getUserByEmail: async (/** @type {string} */ email) => {
        w.lookups.push(email);
        const u = byEmail.get(email);
        if (!u) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return u;
    } }) });
    stub(pushPath, {
        setupWebPush: () => {},
        fanOutPush: async () => { w.broadcasts++; throw new Error('the lockout notice was BROADCAST'); },
        sendTargetedPush: async (/** @type {any} */ payload, /** @type {string[]} */ uids, /** @type {string} */ tag, /** @type {any} */ opts) => {
            w.sends.push({ payload, uids, tag, opts });
            if (hang) return new Promise(() => {});
            return accepted;
        },
    });
    delete require.cache[lockoutPath];
    const L = require('./functions/pin-lockout.js');
    const notify = L.buildPinLockoutNotifier({ VAPID_PRIVATE_KEY: { value: () => 'k' }, VAPID_PUBLIC_KEY: 'p', STAFF_SITE_URL: SITE, adminNames: ADMINS });
    /** The wrong PIN whose charge reached the ceiling: the block it wrote, then what it does next. */
    const trip = (/** @type {number} */ now = T0, /** @type {number} */ budgetMs) => {
        w.door = { failures: GLOBAL_THROTTLE.maxFailures, windowStart: now - 60_000, blockedUntil: now + GLOBAL_THROTTLE.blockMs };
        return L.noteStationBlock({ now, blockedUntil: now + GLOBAL_THROTTLE.blockMs, notify, ...(budgetMs ? { budgetMs } : {}) });
    };
    return Object.assign(w, { L, notify, trip });
}

describe('who is told: the admin\'s own enabled accounts, and nobody else', () => {
    test('the notice reaches each admin account — targeted, never a broadcast', async () => {
        const w = world();
        const out = await w.trip();
        assert.deepEqual(out, { recorded: true, alert: true, accepted: 1 });
        assert.equal(w.sends.length, 1);
        assert.deepEqual(w.sends[0].uids, ['uid-0', 'uid-1']);
        assert.equal(w.broadcasts, 0);
        assert.deepEqual(w.lookups, ADMINS.map(nameToEmail), 'the server-owned names, nothing from a request');
    });

    test('an account at an admin address without the claim, or disabled, is dropped — and nothing widens', async () => {
        const w = world({ accounts: {
            'Q. Example': { uid: 'uid-0', disabled: false, customClaims: { name: 'Q. Example', member: 'Q. Example' } },
            'R. Sample':  { uid: 'uid-1', disabled: true, customClaims: { admin: true } },
        } });
        const out = await w.trip();
        assert.equal(out.alert, true, 'a notice was due');
        assert.equal(out.accepted, 0);
        assert.equal(w.sends.length, 0, 'no admin account left: nothing sent, to anyone');
        assert.equal(w.broadcasts, 0);
    });
});

describe('what it says: a count and a time, in the notification language', () => {
    test('the exact payload, through the one builder', async () => {
        const w = world();
        await w.trip();
        assert.deepEqual(w.sends[0].payload, {
            title: '🔢 Staff PIN — blocked station-wide',
            body:  `${GLOBAL_THROTTLE.maxFailures} wrong entries in 15 minutes. It reopens by itself at 14:20.`,
            tag:   'pin-lockout',
            url:   `${SITE}/operations.html#login-accounts`,
        });
        assert.equal(w.sends[0].tag, '[pinLockout]');
        assert.ok(w.sends[0].opts.timeoutMs <= 4_000, 'each send bounded well inside the 401\'s budget');
    });

    test('in London time — 15:20 in summer for the same instant\'s hour', async () => {
        const w = world();
        const summer = Date.UTC(2026, 6, 16, 14, 5);
        await w.trip(summer);
        assert.match(w.sends[0].payload.body, /at 15:20\.$/);
    });

    test('no PIN-shaped number, no address, no exclamation mark, within the length budgets', async () => {
        const w = world();
        await w.trip();
        const { title, body } = w.sends[0].payload;
        assert.doesNotMatch(`${title} ${body.replace(/\d{2}:\d{2}/, '')}`, PIN_LIKE);
        assert.doesNotMatch(`${title} ${body}`, /!|\d+\.\d+\.\d+\.\d+|@/);
        assert.ok([...title].length <= 40, title);
        assert.ok(body.length <= 80, body);
    });
});

describe('at most once a day, and the record says when and how often — never from where', () => {
    test('a second trip inside the day is recorded, and sends nothing', async () => {
        const w = world();
        await w.trip(T0);
        const second = await w.trip(T0 + 2 * HOUR);
        assert.deepEqual(second, { recorded: true, alert: false, accepted: 0 });
        assert.equal(w.sends.length, 1);
        assert.deepEqual(w.record.blocks, [T0, T0 + 2 * HOUR]);
        assert.equal(w.record.alertedAt, T0);
        assert.deepEqual(Object.keys(w.record).sort(), ['alertedAt', 'blockedUntil', 'blocks']);
    });

    test('a day later it is news again', async () => {
        const w = world();
        await w.trip(T0);
        assert.equal((await w.trip(T0 + 24 * HOUR)).alert, true);
        assert.equal(w.sends.length, 2);
    });

    test('two instances tripping it together ring the phone ONCE', async () => {
        const w = world();
        const both = await Promise.all([w.trip(T0), w.trip(T0 + 10)]);
        assert.deepEqual(both.map(b => b.alert).sort(), [false, true]);
        assert.equal(w.sends.length, 1);
        assert.equal(w.record.blocks.length, 2);
    });

    test('a block a right PIN\'s refund has already lifted is not news: nothing recorded, nobody told', async () => {
        // At 198, a right PIN is charged (199), then a wrong one (200: the block), and the right PIN's
        // refund lands before the wrong one's record — taking the block back with its charge. The door
        // is open and 199 were wrong; a notice would say 200, and the strip would show a block.
        const w = world();
        const at = { failures: GLOBAL_THROTTLE.maxFailures - 2, windowStart: T0 - 60_000, blockedUntil: 0 };
        const right = /** @type {any} */ (reserveAttempt(null, at, T0).global);
        const wrong = /** @type {any} */ (reserveAttempt(null, right, T0 + 5).global);
        assert.ok(wrong.blockedUntil > T0, 'premise: the wrong PIN tripped the block');
        w.door = refundAttempt(wrong, right, GLOBAL_THROTTLE);
        assert.equal(w.door.blockedUntil, 0, 'premise: the refund lifted it');
        const out = await w.L.noteStationBlock({ now: T0 + 5, blockedUntil: wrong.blockedUntil, notify: w.notify });
        assert.deepEqual(out, { recorded: false, alert: false, accepted: 0 });
        assert.equal(w.record, null, 'a block nobody meets was recorded');
        assert.equal(w.sends.length, 0, 'the admin was told of a block that had gone');
        // …and with no all-sources row at all there is no block either.
        w.door = null;
        assert.equal((await w.L.noteStationBlock({ now: T0 + 5, blockedUntil: wrong.blockedUntil, notify: w.notify })).recorded, false);
    });

    test('the record lives in viewerAttempts, under the one closed rule, and nowhere else', async () => {
        const w = world();
        await w.trip();
        assert.deepEqual([...new Set(w.collections)], ['viewerAttempts']);
    });
});

describe('it can cost the notice, never the 401', () => {
    test('a push service that never answers is given up on within the budget', async () => {
        const w = world({ hang: true });
        const started = Date.now();
        const out = await w.trip(T0, 50);
        assert.ok(Date.now() - started < 1_000, 'bounded');
        assert.equal(out.recorded, true);
        assert.equal(out.accepted, 0);
    });

    test('a record that cannot be written sends nothing and throws nothing', async () => {
        const w = world({ txFail: true });
        const out = await w.trip();
        assert.deepEqual(out, { recorded: false, alert: false, accepted: 0 });
        assert.equal(w.sends.length, 0);
    });

    // The sweep runs on the same path, before the 401, and had no bound of its own (review, Nov 2026):
    // a collection read that stalled held the wrong PIN's answer until the platform killed the request,
    // and the caller got a 5xx where every wrong PIN gets the same 401.
    test('a sweep whose read never answers is given up on within its budget, and throws nothing', { timeout: 5_000 }, async () => {
        const w = world({ sweepHang: true });
        const started = Date.now();
        await w.L.sweepExpiredThrottleRows(T0, { budgetMs: 50 });
        assert.ok(Date.now() - started < 1_000, 'bounded');
    });

    test('the sweep and the notice together stay inside the endpoint\'s own time limit', () => {
        const w = world();
        const index = readFileSync(new URL('./functions/index.js', import.meta.url), 'utf8');
        const handler = index.slice(index.indexOf('exports.unlockCalendarViewer = onRequest('));
        const limitSeconds = Number((/timeoutSeconds:\s*(\d+)/.exec(handler) || [])[1]);
        assert.ok(limitSeconds > 0, 'could not read the endpoint\'s timeoutSeconds — this checks nothing');
        assert.ok(w.L.SWEEP_BUDGET_MS + w.L.LOCKOUT_NOTICE_BUDGET_MS < limitSeconds * 1000,
            'a wrong PIN could wait out both budgets and still be killed by the platform');
    });
});

describe('what Operations reads', () => {
    test('readPinLockout: null with no record, the summary with one', async () => {
        const w = world();
        assert.equal(await w.L.readPinLockout(T0), null);
        await w.trip(T0);
        assert.deepEqual(await w.L.readPinLockout(T0 + 60_000),
            { active: true, blockedUntil: UNTIL, lastBlockedAt: T0, blocks: 1 });
    });
});
