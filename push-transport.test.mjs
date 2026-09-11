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
 *
 * ── WHAT THE MUTATION SWEEP FOUND, AND WHY IT SURVIVED (F7, Sep 2026) ───────────────────────────
 *
 * The cleanup rule was tested on ONE sender. Inverting `shouldDeleteSubscription(...)` to `true`
 * inside `sendTargetedPush` failed a test; the identical mutation inside `fanOutPush` did not —
 * and `fanOutPush` is the one that touches every device in the project. The test that was supposed
 * to cover it was called "fanOutPush applies the same rule" and fed it a 410: it asserted the
 * DELETE half and never the KEEP half, so the only code path it could see was the one where
 * deleting is correct.
 *
 * The cost of that gap is the v16.15 regression restored on the broadcast path. A bad VAPID key
 * does not fail one device, it returns 401 for EVERY device — so a single Huddle fan-out would
 * empty `pushSubscriptions` for the whole roster. Nothing errors, nothing is recoverable, and
 * every member has to find the bell and turn it back on. The status table is therefore a LOOP over
 * both senders, and its failure message names which sender and which status code disagreed.
 *
 * The same sweep found `sendTargetedPush`'s uid hygiene untested in both halves. The `new Set(...)`
 * is not tidiness: a uid listed twice sends the member two identical notifications and returns 2,
 * and that number is what `requestPasswordReset` writes down as "the admin was reached". The
 * `typeof u === 'string' && u` filter is what keeps a junk entry from becoming a Firestore query
 * the admin SDK refuses outright — which would reject the whole `Promise.all` and lose a
 * legitimately-addressed notification along with it. Both are asserted on the QUERIES ISSUED,
 * because that is where each one is visible.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fnDir = new URL('./functions/', import.meta.url).pathname;
const firePath    = require.resolve('firebase-admin/firestore', { paths: [fnDir] });
const webpushPath = require.resolve('web-push', { paths: [fnDir] });
const pushPath    = require.resolve('./functions/push.js');

/**
 * Build push.js against a fake Firestore and a fake web-push.
 *
 * `queries` records every equality filter the module actually issued, in order. That is the only
 * place the uid hygiene in `sendTargetedPush` is visible: a duplicate uid and a junk one both
 * produce a perfectly ordinary-looking result set, and what they cost is an extra round trip the
 * real SDK may refuse (`undefined` is not a valid query constraint) and an extra send counted as
 * an extra acceptance.
 *
 * @param {Array<{id: string, owner?: string, endpoint: string}>} subs   what pushSubscriptions holds
 * @param {(endpoint: string) => number|undefined} statusFor  HTTP status to fail an endpoint with
 */
function build(subs, statusFor = () => undefined) {
    const sent = [];
    const deleted = [];
    const queries = [];
    const docFor = (s) => ({
        id: s.id,
        data: () => ({ endpoint: s.endpoint, keys: { p256dh: 'p', auth: 'a' }, owner: s.owner }),
        ref: { delete: async () => { deleted.push(s.id); } },
    });
    const collection = () => ({
        get: async () => ({ docs: subs.map(docFor), size: subs.length, empty: subs.length === 0 }),
        where: (field, _op, value) => {
            queries.push(value);
            return {
                get: async () => {
                    const hit = subs.filter((s) => s[field] === value);
                    return { docs: hit.map(docFor), size: hit.length, empty: hit.length === 0 };
                },
            };
        },
    });
    require.cache[firePath] = { id: firePath, filename: firePath, loaded: true,
        exports: { getFirestore: () => ({ collection }) } };
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
    return { mod, sent, deleted, queries };
}

const sub = (id, owner, endpoint = `https://push.example/${id}`) => ({ id, owner, endpoint });
const PAYLOAD = { title: 'x', body: 'y', tag: 'reset-request', url: 'https://myb-roster.web.app/' };

beforeEach(() => { for (const p of [firePath, webpushPath, pushPath]) delete require.cache[p]; });

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

// BOTH senders, every status code. The cleanup rule is written out twice in `push.js` — once per
// sender — and until this loop existed only one copy was tested. Deleting is correct for exactly two
// statuses and catastrophic for the rest, so each sender is driven through all four rather than
// through the one status that happens to prove the branch the test author had in mind.
const SENDERS = [
    { name: 'sendTargetedPush', run: (mod) => mod.sendTargetedPush(PAYLOAD, ['uid_admin'], '[t]') },
    { name: 'fanOutPush',       run: (mod) => mod.fanOutPush(PAYLOAD, '[f]') },
];

describe('dead-subscription cleanup keeps its 410-vs-401 distinction — in BOTH senders', () => {
    // A 401 is a VAPID misconfiguration, not a dead endpoint. Deleting on 401 would empty the whole
    // collection on any key error — silently, and permanently for every member.
    for (const { name, run } of SENDERS) {
        for (const [code, shouldDelete] of [[410, true], [404, true], [401, false], [500, false]]) {
            test(`${name}: HTTP ${code} ${shouldDelete ? 'deletes' : 'keeps'} the subscription`, async () => {
                const { mod, deleted } = build([sub('x', 'uid_admin')], () => code);
                await run(mod);
                assert.deepEqual(deleted, shouldDelete ? ['x'] : [],
                    `${name} got the wrong answer for HTTP ${code}`);
            });
        }
    }

    test('a VAPID key error — 401 on EVERY device — deletes nothing on a fan-out', async () => {
        // The v16.15 regression, written as the shape it actually arrives in. A rotated or mistyped
        // key does not fail one endpoint; it fails all of them at once, so the sender that reaches
        // every device is the one where "delete on any error" empties the collection. One Huddle,
        // and every member has to find the bell again.
        const { mod, deleted, sent } = build(
            [sub('a', 'uid_a'), sub('b', 'uid_b'), sub('c', undefined)], () => 401);
        await mod.fanOutPush(PAYLOAD, '[f]');
        assert.deepEqual(deleted, [], 'a key error must never be read as three dead endpoints');
        assert.deepEqual(sent, [], 'and nothing was delivered — which is the visible half');
    });

    test('a fan-out separates the dead device from the misconfigured one in the same pass', async () => {
        // The mixed case, which is the only one where the two halves of the rule are exercised
        // against each other: one genuinely-gone endpoint, one auth failure, one healthy phone.
        const { mod, deleted, sent } = build(
            [sub('gone', 'uid_a'), sub('badkey', 'uid_b'), sub('fine', 'uid_c')],
            (ep) => (ep.endsWith('/gone') ? 410 : ep.endsWith('/badkey') ? 401 : undefined),
        );
        await mod.fanOutPush(PAYLOAD, '[f]');
        assert.deepEqual(deleted, ['gone'], 'only the 410 is removed');
        assert.equal(sent.length, 1, 'and the healthy device still got it');
    });
});

describe('sendTargetedPush cleans its uid list before it queries — both halves', () => {
    // Asserted on the QUERIES ISSUED, because that is where each half is visible: the result sets
    // look ordinary either way, and the cost lands elsewhere.

    test('a uid listed twice is queried once, sent once, and counted once', async () => {
        // Without the `new Set(...)` the member's phone buzzes twice for one event and `accepted`
        // comes back 2 — the number `requestPasswordReset` stamps as "the admin was reached", and
        // the number that then coalesces the next locked-out colleague into silence.
        const { mod, sent, queries } = build([sub('phone', 'uid_admin')]);
        const accepted = await mod.sendTargetedPush(PAYLOAD, ['uid_admin', 'uid_admin'], '[t]');
        assert.deepEqual(queries, ['uid_admin'], 'one query per distinct uid');
        assert.equal(sent.length, 1, 'one notification, not two');
        assert.equal(accepted, 1, 'and one acceptance — the caller writes this number down');
    });

    test('a junk entry never becomes a query', async () => {
        // `undefined` is not a valid Firestore query constraint — the admin SDK throws on it, which
        // would reject the whole `Promise.all` and lose the real recipient beside it. An empty
        // string and a null are merely wasted round trips. None of them may reach the collection.
        const { mod, sent, queries } = build([sub('phone', 'uid_admin')]);
        const accepted = await mod.sendTargetedPush(
            PAYLOAD, ['uid_admin', '', null, undefined, 0, 42, {}], '[t]');
        assert.deepEqual(queries, ['uid_admin'], 'only the real uid was asked about');
        assert.equal(sent.length, 1, 'and the real recipient still got it');
        assert.equal(accepted, 1);
    });

    test('a list of nothing BUT junk sends nothing and queries nothing', async () => {
        // The fail-closed direction again, reached from the other end: a caller handing over a list
        // of unresolved lookups must produce silence, not a query storm and certainly not a fan-out.
        const { mod, sent, queries } = build([sub('legacy', undefined), sub('phone', 'uid_admin')]);
        assert.equal(await mod.sendTargetedPush(PAYLOAD, [null, undefined, ''], '[t]'), 0);
        assert.deepEqual(queries, []);
        assert.deepEqual(sent, []);
    });
});

test('fanOutPush reaches EVERY subscription, owner stamp or not', async () => {
    // The contrast that gives the targeted sender its meaning. A document arrival is for everybody,
    // including the legacy devices `sendTargetedPush` deliberately refuses to guess about.
    const { mod, sent } = build([sub('a', 'uid_a'), sub('b', undefined), sub('c', 'uid_c')]);
    await mod.fanOutPush(PAYLOAD, '[f]');
    assert.equal(sent.length, 3);
});
