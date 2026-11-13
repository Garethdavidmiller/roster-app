// @ts-check
/**
 * error-log-notify.test.mjs — the admin's Error Log notification EXECUTED (functions/error-log-notify.js,
 * v26.04): the real check against a fake Firestore, a fake Auth and a recording push transport, then the
 * real schedule in documents.js. The rules it asks are pinned on their own in error-log-notice.test.mjs;
 * this proves the wiring does what they say — "the rule tested, the wiring not" is the named risk.
 *
 * Run with: npm run test:functions   (needs firebase-admin/firebase-functions from functions/node_modules)
 *
 * Organised by what a wrong answer COSTS: a notice reaching anyone but the admin; a phone rung every
 * fifteen minutes; an entry announced every hour for ever, or never; and a send that reached nobody
 * being taken for one that did.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fnDir = new URL('./functions/', import.meta.url).pathname;
const firePath    = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
const authPath    = require.resolve('firebase-admin/auth', { paths: [fnDir] });
const storagePath = require.resolve('firebase-admin/storage', { paths: [fnDir] });
const pushPath    = require.resolve('./functions/push.js');
const notifyPath  = require.resolve('./functions/error-log-notify.js');
const docsPath    = require.resolve('./functions/documents.js');
const payPath     = require.resolve('./functions/pay-reminder.js');
const ROSTER = require('./functions/roster-members.json');
const { nameToEmail } = require('./functions/roster-parse-helpers.js');
const { NOTICE_SCAN_LIMIT } = require('./functions/error-log-notice.js');

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 13, 20, 0);
const SITE = 'https://myb-roster.web.app';
const SERVER_TS = { __serverTimestamp: true };

/** A Firestore Timestamp: milliseconds AND the nanoseconds a millisecond cannot hold. */
class Ts {
    /** @param {number} ms @param {number} [nanos] */
    constructor(ms, nanos = 0) { this.ms = ms; this.nanos = nanos; }
    toMillis() { return this.ms; }
}
const later = (/** @type {Ts} */ a, /** @type {Ts} */ b) => a.ms > b.ms || (a.ms === b.ms && a.nanos > b.nanos);

/** An Error Log entry as the reporter writes it, at `ms` (+ sub-millisecond `nanos`). */
const entry = (/** @type {number} */ ms, /** @type {string} */ message, extra = {}) => ({
    memberName: 'A. Hared', page: 'admin.html', message, appVersion: '26.03', userAgent: 'x', stack: '',
    resolved: false, timestamp: new Ts(ms, 123_456), ...extra,
});
const SLOW = 'Slow save (diagnostic): the save took 8.1s to be confirmed — a save while the phone said it was online';

/**
 * The Auth world: one account per roster name, at the email that name derives to, with the claims Set up
 * accounts stamps — the admin's carrying `admin: true`.
 * @param {(name: string, user: any) => any} [edit]  change (or replace) one name's record
 */
function accounts(edit) {
    const byEmail = new Map();
    for (const name of new Set([...ROSTER.activeMembers, ...ROSTER.roles.admin, ...ROSTER.roles.manager])) {
        const claims = ROSTER.roles.admin.includes(name) ? { admin: true, name, member: name }
            : ROSTER.roles.manager.includes(name) ? { manager: true, name, member: name } : { name, member: name };
        const user = { uid: `uid:${name}`, disabled: false, customClaims: claims };
        byEmail.set(nameToEmail(name).toLowerCase(), edit ? edit(name, user) : user);
    }
    return async (/** @type {string} */ email) => {
        const user = byEmail.get(String(email).toLowerCase());
        if (!user) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return user;
    };
}

/**
 * A fresh world: the record, the log, the accounts and a recording transport.
 * @param {{ state?: any, entries?: any[], accepted?: (uids: string[]) => number, edit?: (name: string, user: any) => any }} [o]
 */
function world({ state = null, entries = [], accepted = (uids) => uids.length, edit } = {}) {
    const w = {
        now: T0,
        state: state && { ...state },
        entries,
        /** @type {{payload: any, uids: string[], tag: string}[]} */ sends: [],
        /** @type {{after: any, limit: number}[]} */ queries: [],
        /** Runs once, inside the next transaction, before its read: a check that overlapped claimed first. */
        /** @type {(() => void)|null} */ beforeClaim: null,
    };
    const resolve = (/** @type {any} */ v) => (v === SERVER_TS ? new Ts(w.now) : v);
    const stateRef = {
        get: async () => ({ exists: w.state !== null, data: () => (w.state ? { ...w.state } : undefined) }),
        set: async (/** @type {any} */ data) => { w.state = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, resolve(v)])); },
        update: async (/** @type {any} */ data) => {
            if (!w.state) throw Object.assign(new Error('no document to update'), { code: 5 });
            for (const [k, v] of Object.entries(data)) w.state[k] = resolve(v);
        },
    };
    const db = {
        collection: (/** @type {string} */ name) => {
            if (name === 'errorLogNotice') {
                return { doc: (/** @type {string} */ id) => { assert.equal(id, 'state'); return stateRef; } };
            }
            assert.equal(name, 'clientErrors', `the notification read the ${name} collection`);
            return {
                where: (/** @type {string} */ field, /** @type {string} */ op, /** @type {any} */ after) => {
                    assert.equal(field, 'timestamp');
                    assert.equal(op, '>', 'strictly AFTER the line: ">=" would announce the last entry again');
                    return { orderBy: (/** @type {string} */ f) => {
                        assert.equal(f, 'timestamp');
                        return { limit: (/** @type {number} */ n) => ({ get: async () => {
                            w.queries.push({ after, limit: n });
                            const hits = w.entries.filter(e => later(e.timestamp, after))
                                .sort((a, b) => (later(a.timestamp, b.timestamp) ? 1 : -1)).slice(0, n);
                            return { docs: hits.map(e => ({ data: () => ({ ...e }) })) };
                        } }) };
                    } };
                },
            };
        },
        runTransaction: async (/** @type {(tx: any) => Promise<any>} */ fn) => {
            const hook = w.beforeClaim; w.beforeClaim = null; hook?.();
            /** @type {[any, any][]} */ const writes = [];
            const result = await fn({ get: (/** @type {any} */ ref) => ref.get(), update: (/** @type {any} */ ref, /** @type {any} */ d) => { writes.push([ref, d]); } });
            for (const [ref, d] of writes) await ref.update(d);
            return result;
        },
    };
    const stub = (/** @type {string} */ p, /** @type {any} */ exports) => {
        require.cache[p] = /** @type {any} */ ({ id: p, filename: p, loaded: true, exports });
    };
    stub(firePath, { getFirestore: () => db, FieldValue: { serverTimestamp: () => SERVER_TS } });
    stub(authPath, { getAuth: () => ({ getUserByEmail: accounts(edit) }) });
    stub(storagePath, { getStorage: () => ({ bucket: () => ({}) }) });
    stub(pushPath, {
        setupWebPush: () => {},
        fanOutPush: async () => { throw new Error('the Error Log notice was BROADCAST'); },
        sendTargetedPush: async (/** @type {any} */ payload, /** @type {string[]} */ uids, /** @type {string} */ tag) => {
            w.sends.push({ payload, uids, tag });
            return accepted(uids);
        },
    });
    delete require.cache[notifyPath];
    const { notifyAdminOfErrorLog } = require('./functions/error-log-notify.js');
    const check = () => notifyAdminOfErrorLog({ vapidPrivate: { value: () => 'k' }, vapidPublic: 'p', STAFF_SITE_URL: SITE,
        roster: ROSTER, now: () => w.now });
    return Object.assign(w, { check });
}

/** A world already past its first check: the line at T0 − 1 h, nothing attempted yet. */
const seeded = (/** @type {any} */ o = {}) => world({ ...o, state: { announcedThrough: new Ts(T0 - HOUR), lastAttemptAt: null } });

describe('the first check starts the line and tells nobody', () => {
    test('no record: the line starts now, the backlog is not announced', async () => {
        const w = world({ entries: [entry(T0 - 10 * HOUR, 'old'), entry(T0 - HOUR, SLOW)] });
        assert.deepEqual(await w.check(), { outcome: 'seeded' });
        assert.equal(w.sends.length, 0);
        assert.equal(w.queries.length, 0, 'the seed reads nothing');
        assert.ok(w.state.announcedThrough instanceof Ts && w.state.announcedThrough.ms === T0, 'the line is the server\'s now');
        assert.equal(w.state.lastAttemptAt, null);
    });
});

describe('who is told: the admin, and nobody else', () => {
    test('new entries reach the ADMIN\'s devices only — never a manager\'s, never a broadcast', async () => {
        const w = seeded({ entries: [entry(T0 - 30_000, 'TypeError: boom'), entry(T0 - 20_000, SLOW), entry(T0 - 10_000, SLOW)] });
        assert.deepEqual(await w.check(), { outcome: 'sent', accepted: 1 });
        assert.equal(w.sends.length, 1);
        assert.deepEqual(w.sends[0].uids, ROSTER.roles.admin.map((/** @type {string} */ n) => `uid:${n}`));
        assert.deepEqual(w.sends[0].uids, ['uid:G. Miller'], 'the master admin, today the owner alone');
        assert.deepEqual(w.sends[0].payload, {
            title: '🐛 Error Log — 3 new',
            body:  '1 error and 2 slow saves. Tap to open the Error Log.',
            tag:   'error-log',
            url:   `${SITE}/operations.html#error-log`,
        });
    });

    test('nothing an entry says reaches the lock screen', async () => {
        const w = seeded({ entries: [
            entry(T0 - 20_000, 'TypeError: cannot read K. Jedlinski', { memberName: 'K. Jedlinski', page: 'paycalc.html' }),
            entry(T0 - 10_000, SLOW, { memberName: 'J. Sumaili' }),
        ] });
        await w.check();
        const shown = JSON.stringify(w.sends[0].payload);
        for (const secret of ['Jedlinski', 'Sumaili', 'Hared', 'paycalc', 'TypeError', '8.1s']) {
            assert.ok(!shown.includes(secret), `"${secret}" reached the notification`);
        }
    });

    test('an admin account without the admin claim is NOT told, and nothing widens to anyone else', async () => {
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')],
            edit: (name, user) => (name === 'G. Miller' ? { ...user, customClaims: { name, member: name } } : user) });
        assert.deepEqual(await w.check(), { outcome: 'unreached', accepted: 0 });
        assert.equal(w.sends.length, 0, 'no account left: nothing sent, to anyone');
    });

    test('a DISABLED admin account is not told', async () => {
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')],
            edit: (name, user) => (name === 'G. Miller' ? { ...user, disabled: true } : user) });
        assert.equal((await w.check()).outcome, 'unreached');
        assert.equal(w.sends.length, 0);
    });

    test('an admin name with no account is not told', async () => {
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')],
            edit: (name, user) => (name === 'G. Miller' ? undefined : user) });
        assert.equal((await w.check()).outcome, 'unreached');
        assert.equal(w.sends.length, 0);
    });
});

describe('at most one an hour', () => {
    test('a burst rings once; the entries after it wait for the hour, then come as ONE notice', async () => {
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')] });
        await w.check();
        w.entries.push(entry(T0 + 60_000, 'bang'), entry(T0 + 120_000, SLOW));
        for (const minutes of [15, 30, 45]) {
            w.now = T0 + minutes * 60_000;
            assert.deepEqual(await w.check(), { outcome: 'wait' }, `${minutes} minutes on`);
        }
        assert.equal(w.sends.length, 1, 'one notice in the first hour');
        w.now = T0 + HOUR;
        assert.equal((await w.check()).outcome, 'sent');
        assert.equal(w.sends.length, 2);
        assert.equal(w.sends[1].payload.title, '🐛 Error Log — 2 new', 'the second notice counts only what came after the first');
        assert.equal(w.sends[1].payload.body, '1 error and 1 slow save. Tap to open the Error Log.');
    });

    test('a quiet hour sends nothing', async () => {
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')] });
        await w.check();
        w.now = T0 + 2 * HOUR;
        assert.deepEqual(await w.check(), { outcome: 'nothing new' });
        assert.equal(w.sends.length, 1);
    });

    test('two checks that overlap ring once: the second finds the first one\'s claim', async () => {
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')] });
        // Another check stamped its attempt between this one's read and its claim.
        w.beforeClaim = () => { w.state.lastAttemptAt = new Ts(T0 - 1_000); };
        assert.deepEqual(await w.check(), { outcome: 'claimed elsewhere' });
        assert.equal(w.sends.length, 0);
    });
});

describe('the line: every entry announced once', () => {
    test('the line is the last entry\'s OWN timestamp, microseconds and all — never one rebuilt from milliseconds', async () => {
        const last = entry(T0 - 10_000, SLOW);
        const w = seeded({ entries: [entry(T0 - 20_000, 'boom'), last] });
        await w.check();
        assert.equal(w.state.announcedThrough, last.timestamp,
            'a line rounded to the millisecond would find this entry "new" again, and announce it every hour for ever');
        w.now = T0 + 2 * HOUR;
        assert.deepEqual(await w.check(), { outcome: 'nothing new' });
        assert.equal(w.sends.length, 1);
    });

    test('a notice that reached NO device does not move the line: the same entries are counted again in an hour', async () => {
        let reach = 0;
        const w = seeded({ entries: [entry(T0 - 10_000, 'boom')], accepted: () => reach });
        assert.deepEqual(await w.check(), { outcome: 'unreached', accepted: 0 });
        assert.equal(w.state.announcedThrough.ms, T0 - HOUR, 'the line stayed');
        assert.ok(w.state.lastAttemptAt instanceof Ts, 'the attempt is stamped, so it is not retried every fifteen minutes');
        w.now = T0 + 15 * 60_000;
        assert.deepEqual(await w.check(), { outcome: 'wait' });
        reach = 1;
        w.now = T0 + HOUR;
        assert.equal((await w.check()).outcome, 'sent');
        assert.equal(w.sends.at(-1)?.payload.title, '🐛 Error Log — 1 new', 'the unreached entry is announced, not lost');
    });

    test('entries the admin already resolved are not news, and the line moves past them without a notice', async () => {
        const w = seeded({ entries: [entry(T0 - 20_000, 'boom', { resolved: true }), entry(T0 - 10_000, SLOW, { resolved: true })] });
        assert.deepEqual(await w.check(), { outcome: 'all resolved' });
        assert.equal(w.sends.length, 0);
        assert.equal(w.state.announcedThrough, w.entries[1].timestamp);
        assert.equal(w.state.lastAttemptAt, null, 'no attempt, so no hour starts');
    });

    test('a flood: one notice says "more than", and the rest are counted next time', async () => {
        const flood = Array.from({ length: NOTICE_SCAN_LIMIT + 5 }, (_, i) => entry(T0 - 1_000_000 + i * 1_000, 'boom'));
        const w = seeded({ entries: flood });
        await w.check();
        assert.equal(w.queries[0].limit, NOTICE_SCAN_LIMIT + 1, 'one more than the limit, to PROVE "more than"');
        assert.equal(w.sends[0].payload.title, `🐛 Error Log — ${NOTICE_SCAN_LIMIT}+ new`);
        assert.equal(w.state.announcedThrough, flood[NOTICE_SCAN_LIMIT - 1].timestamp, 'the line stops at the last entry it covered');
        w.now = T0 + HOUR;
        await w.check();
        assert.equal(w.sends[1].payload.title, '🐛 Error Log — 5 new');
    });
});

describe('the schedule in documents.js runs this check', () => {
    test('sendErrorLogNotification seeds, then tells the admin, with the deploy\'s own site address', async () => {
        const w = world({ entries: [] });
        delete require.cache[payPath];
        delete require.cache[docsPath];
        const { buildDocumentEndpoints } = require('./functions/documents.js');
        const eps = buildDocumentEndpoints({
            HUDDLE_SECRET: { value: () => 'h' }, VAPID_PRIVATE_KEY: { value: () => 'k' }, VAPID_PUBLIC_KEY: 'p',
            STAFF_SITE_URL: SITE, readRawBody: async () => '', nowInLondon: () => ({ year: 2026, month: 10, day: 13 }),
            isRetriableFirestoreError: () => false, MAX_FILE_BYTES: 1, MAX_HUDDLE_HTML_CHARS: 1,
            ADMIN_FUNCTION_ORIGINS: [SITE], rosterMembers: ROSTER,
        });
        await eps.sendErrorLogNotification.run(/** @type {any} */ ({}));
        assert.ok(w.state && w.state.announcedThrough instanceof Ts, 'the first scheduled run seeded the record');
        w.entries.push(entry(Date.now() + HOUR, SLOW));   // after the seed, whatever the real clock says
        w.now = Date.now() + 2 * HOUR;
        // The schedule reads the real clock, so the record is moved back past the hour by hand.
        w.state.lastAttemptAt = null;
        w.state.announcedThrough = new Ts(0);
        await eps.sendErrorLogNotification.run(/** @type {any} */ ({}));
        assert.equal(w.sends.length, 1);
        assert.deepEqual(w.sends[0].uids, ['uid:G. Miller']);
        assert.equal(w.sends[0].payload.url, `${SITE}/operations.html#error-log`);
    });
});
