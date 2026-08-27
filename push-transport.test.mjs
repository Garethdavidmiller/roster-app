/**
 * push-transport.test.mjs — the two SENDERS, driven for real (v21.85).
 *
 * Run: node --test push-transport.test.mjs   (part of `npm run test:functions`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `functions/push.js` is the one place a notification actually leaves the building, and it had no
 * tests at all. Everything around it was covered — the payload builder's wording, the deploy
 * surface, who the reset notice is addressed to — while the code that decides whether an addressed
 * notice reaches one person or fifty was held together by a careful module header.
 *
 * That mattered more from v21.85, when `sendTargetedPush`'s RETURN VALUE became load-bearing: the
 * reset endpoint now writes "the admin was notified" into Firestore based on it, and coalesces the
 * next locked-out member's notification behind that record. If this function goes back to counting
 * ATTEMPTS rather than acceptances, the endpoint records a delivery that never happened and
 * silences a real request — with every test in `auth-endpoints.test.mjs` still green, because they
 * fake this module. This file is the other half of that seam.
 *
 * Organised by the two ways a send is wrong, which are not symmetrical:
 *   · **Too WIDE** is a leak. "N. Surname is locked out" reaching fifty colleagues cannot be undone,
 *     so every fail-closed branch is asserted by name.
 *   · **Miscounted** is a lie the caller then acts on. Cheap to fix, invisible from here, and the
 *     consequence lands somewhere else entirely.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fnDir = new URL('./functions/', import.meta.url).pathname;
const adminPath   = require.resolve('firebase-admin', { paths: [fnDir] });
const webpushPath = require.resolve('web-push', { paths: [fnDir] });
const pushPath    = require.resolve('./functions/push.js');

/**
 * Build push.js against a fake Firestore and a fake web-push.
 *
 * @param {Array<{id: string, owner?: string, endpoint: string}>} subs   what pushSubscriptions holds
 * @param {(endpoint: string) => number|undefined} statusFor  HTTP status to fail an endpoint with
 */
function build(subs, statusFor = () => undefined) {
    const sent = [];
    const deleted = [];
    const docFor = (s) => ({
        id: s.id,
        data: () => ({ endpoint: s.endpoint, keys: { p256dh: 'p', auth: 'a' }, owner: s.owner }),
        ref: { delete: async () => { deleted.push(s.id); } },
    });
    const collection = () => ({
        get: async () => ({ docs: subs.map(docFor), size: subs.length, empty: subs.length === 0 }),
        where: (field, _op, value) => ({
            get: async () => {
                const hit = subs.filter((s) => s[field] === value);
                return { docs: hit.map(docFor), size: hit.length, empty: hit.length === 0 };
            },
        }),
    });
    require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true,
        exports: { firestore: () => ({ collection }) } };
    require.cache[webpushPath] = { id: webpushPath, filename: webpushPath, loaded: true, exports: {
        setVapidDetails: () => {},
        sendNotification: async (sub, payload) => {
            const code = statusFor(sub.endpoint);
            if (code) { const e = new Error(`HTTP ${code}`); e.statusCode = code; throw e; }
            sent.push({ endpoint: sub.endpoint, payload });
        },
    } };
    delete require.cache[pushPath];
    const mod = require('./functions/push.js');
    mod.setupWebPush({ value: () => 'private' }, 'public');
    return { mod, sent, deleted };
}

const sub = (id, owner, endpoint = `https://push.example/${id}`) => ({ id, owner, endpoint });
const PAYLOAD = { title: 'x', body: 'y', tag: 'reset-request', url: 'https://myb-roster.web.app/' };

beforeEach(() => { for (const p of [adminPath, webpushPath, pushPath]) delete require.cache[p]; });

describe('sendTargetedPush fails CLOSED — an addressed notice never widens', () => {
    test('no target uids sends nothing', async () => {
        // There is deliberately no "no targets → fall back to everyone" branch. This asserts the
        // absence of the single most dangerous line that could be added to this file.
        const { mod, sent } = build([sub('a', 'uid_admin'), sub('b', 'uid_other')]);
        assert.equal(await mod.sendTargetedPush(PAYLOAD, [], '[t]'), 0);
        assert.deepEqual(sent, []);
    });

    test('a subscription with no owner stamp is skipped, never assumed', async () => {
        // Legacy docs written before v17.76 carry no `owner`. Guessing that an unowned device
        // belongs to the target is how a private notice reaches a shared office PC.
        const { mod, sent } = build([sub('legacy', undefined)]);
        assert.equal(await mod.sendTargetedPush(PAYLOAD, ['uid_admin'], '[t]'), 0);
        assert.deepEqual(sent, []);
    });

    test('only the named uid s own devices are sent to', async () => {
        const { mod, sent } = build([
            sub('admin1', 'uid_admin'), sub('admin2', 'uid_admin'), sub('someone', 'uid_other'),
        ]);
        assert.equal(await mod.sendTargetedPush(PAYLOAD, ['uid_admin'], '[t]'), 2);
        assert.deepEqual(sent.map((s) => s.endpoint).sort(),
            ['https://push.example/admin1', 'https://push.example/admin2']);
    });
});

describe('the returned count means ACCEPTED, because a caller writes it down', () => {
    test('a send that failed is not counted', async () => {
        // The number the reset endpoint stamps `notifiedAt` from. Counting the attempt here would
        // record a notification nobody received and coalesce the next member behind it.
        const { mod } = build(
            [sub('good', 'uid_admin'), sub('bad', 'uid_admin')],
            (ep) => (ep.endsWith('/bad') ? 500 : undefined),
        );
        assert.equal(await mod.sendTargetedPush(PAYLOAD, ['uid_admin'], '[t]'), 1);
    });

    test('every send failing returns zero, not the number tried', async () => {
        const { mod } = build([sub('a', 'uid_admin'), sub('b', 'uid_admin')], () => 500);
        assert.equal(await mod.sendTargetedPush(PAYLOAD, ['uid_admin'], '[t]'), 0,
            'zero is the direction a caller is entitled to rely on');
    });
});

describe('dead-subscription cleanup keeps its 410-vs-401 distinction', () => {
    // A 401 is a VAPID misconfiguration, not a dead endpoint. Deleting on 401 would empty the whole
    // collection on any key error — silently, and permanently for every member.
    for (const [code, shouldDelete] of [[410, true], [404, true], [401, false], [500, false]]) {
        test(`HTTP ${code} ${shouldDelete ? 'deletes' : 'keeps'} the subscription`, async () => {
            const { mod, deleted } = build([sub('x', 'uid_admin')], () => code);
            await mod.sendTargetedPush(PAYLOAD, ['uid_admin'], '[t]');
            assert.deepEqual(deleted, shouldDelete ? ['x'] : []);
        });
    }

    test('fanOutPush applies the same rule', async () => {
        const { mod, deleted, sent } = build([sub('x', 'uid_a'), sub('y', 'uid_b')],
            (ep) => (ep.endsWith('/x') ? 410 : undefined));
        await mod.fanOutPush(PAYLOAD, '[f]');
        assert.deepEqual(deleted, ['x']);
        assert.equal(sent.length, 1, 'and the healthy device still got it');
    });
});

test('fanOutPush reaches EVERY subscription, owner stamp or not', async () => {
    // The contrast that gives the targeted sender its meaning. A document arrival is for everybody,
    // including the legacy devices `sendTargetedPush` deliberately refuses to guess about.
    const { mod, sent } = build([sub('a', 'uid_a'), sub('b', undefined), sub('c', 'uid_c')]);
    await mod.fanOutPush(PAYLOAD, '[f]');
    assert.equal(sent.length, 3);
});
