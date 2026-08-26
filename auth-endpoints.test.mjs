/**
 * auth-endpoints.test.mjs — WHO the reset-request notification reaches (v21.83).
 *
 * Run: node --test auth-endpoints.test.mjs   (part of `npm run test:functions`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `requestPasswordReset` is the app's only public unauthenticated endpoint, and its notification is
 * the ONE push in the whole app that must not be a broadcast: "N. Surname is locked out" sent to
 * fifty staff is a leak, not a notification. `.claude/rules/notifications.md` says so in those
 * words, and `functions/push.js` implements `sendTargetedPush` to fail closed at every step with
 * deliberately no fall-back-to-everyone branch.
 *
 * None of that was tested. What existed was the deploy-surface pin (the function is EXPORTED) and
 * the Firestore rules for its collection (who may READ the queue). Nothing asserted where the push
 * goes — so the rule lived entirely in prose and in the care of whoever edited the file next.
 *
 * Found by a wiring audit after external review, 26 Aug 2026, whose finding was that this repo
 * tests its RULES thoroughly and its WIRING hardly at all: three defects shipped in v21.79 where a
 * well-tested helper was called with the wrong argument, from the wrong context, or not at all.
 * This is that shape at its highest stakes — the helper is careful, and nothing checked it is the
 * helper being called.
 *
 * The test drives the REAL handler against a fake Firestore, a fake Auth and a recording push
 * transport, so what it asserts is what production would send.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// REAL time, not a pinned instant: the endpoint's throttle and coalescing windows are measured
// against `Date.now()` inside the module, so a fixture dated to a fixed day would sit hours outside
// every window and the throttled case would quietly test the un-throttled path instead.
const NOW = Date.now();

const ADMIN = 'G. Miller';
const MEMBER = 'L. Springer';          // on the roster, and not the admin
const ADMIN_UID = 'uid_admin_gm';
const emailFor = (n) => `${n[0].toLowerCase()}.${n.split('. ')[1].toLowerCase()}@myb-roster.local`;

/** A Firestore fake with only what this endpoint touches: one doc, a transaction, and a select(). */
function makeDb(seedStamps = {}) {
    const store = new Map(Object.entries(seedStamps));   // memberName → requestedAt millis
    const snapOf = (id) => ({
        id,
        exists: store.has(id),
        data: () => ({ requestedAt: { toMillis: () => store.get(id) } }),
    });
    const db = {
        collection() {
            return {
                doc: (id) => ({ id }),
                select: () => ({ get: async () => ({ size: store.size, docs: [...store.keys()].map(snapOf) }) }),
            };
        },
        async runTransaction(fn) {
            return fn({
                get: async (ref) => snapOf(ref.id),
                set: (ref) => { store.set(ref.id, NOW); },
            });
        },
    };
    return { db, store };
}

/**
 * Build the endpoints against a fake world.
 *
 * Both fakes go into `require.cache` BEFORE auth-endpoints.js is required, because the module
 * destructures `sendTargetedPush` at load time — patching the export afterwards would leave the
 * handler holding the real function and this suite passing while testing nothing.
 */
function build({ adminResolves = true, seedStamps = {} } = {}) {
    const sends = [];
    const fnDir = new URL('./functions/', import.meta.url).pathname;
    const adminPath = require.resolve('firebase-admin', { paths: [fnDir] });
    const pushPath  = require.resolve('./functions/push.js');
    const { db, store } = makeDb(seedStamps);

    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => 'STAMP', increment: (n) => ({ inc: n }) };
    const fakeAdmin = {
        auth: () => ({
            getUserByEmail: async (email) => {
                if (email === emailFor(ADMIN)) {
                    if (!adminResolves) { const e = new Error('nope'); e.code = 'auth/user-not-found'; throw e; }
                    return { uid: ADMIN_UID };
                }
                if (email === emailFor(MEMBER)) return { uid: 'uid_member' };
                const e = new Error('nope'); e.code = 'auth/user-not-found'; throw e;
            },
        }),
        firestore,
    };
    fakeAdmin.firestore.FieldValue = firestore.FieldValue;

    require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fakeAdmin };
    require.cache[pushPath]  = { id: pushPath, filename: pushPath, loaded: true, exports: {
        setupWebPush: () => {},
        sendTargetedPush: async (payload, uids, tag) => { sends.push({ payload, uids, tag }); },
        // Present so a handler that reached for the broadcast would RUN and be caught by an
        // assertion, rather than throwing an import error that reads like a broken test.
        fanOutPush: async (payload) => { sends.push({ payload, uids: 'EVERYONE' }); },
    } };
    delete require.cache[require.resolve('./functions/auth-endpoints.js')];
    const { buildAuthEndpoints } = require('./functions/auth-endpoints.js');
    const eps = buildAuthEndpoints({
        VAPID_PRIVATE_KEY: { value: () => 'private' },
        VAPID_PUBLIC_KEY: 'public',
        STAFF_SITE_URL: 'https://myb-roster.web.app',
        ADMIN_FUNCTION_ORIGINS: ['https://myb-roster.web.app'],
    });
    return { eps, sends, store };
}

function makeRes() {
    const out = { code: 200, body: null };
    const res = new EventEmitter();
    let done = false;
    Object.assign(res, {
        status(c) { out.code = c; return res; },
        json(b) { out.body = b; res.end(); return res; },
        send(b) { out.body = b; res.end(); return res; },
        setHeader() { return res; }, getHeader() { return undefined; }, removeHeader() { return res; },
        set() { return res; }, vary() { return res; }, writeHead(c) { out.code = c; return res; },
        end() { if (!done) { done = true; process.nextTick(() => res.emit('finish')); } return res; },
    });
    return { res, out };
}

const reqFor = (member) => ({
    method: 'POST',
    headers: { origin: 'https://myb-roster.web.app' },
    body: { member },
    url: '/', path: '/', query: {},
    get(h) { return this.headers[String(h).toLowerCase()]; },
    header(h) { return this.get(h); },
});

describe('the reset request tells the ADMIN, and only the admin', () => {
    test('the push is addressed to the admin uid — never to everyone', async () => {
        const { eps, sends } = build();
        const { res, out } = makeRes();
        await eps.requestPasswordReset(reqFor(MEMBER), res);

        assert.equal(out.code, 200);
        assert.equal(sends.length, 1, 'exactly one push');
        assert.deepEqual(sends[0].uids, [ADMIN_UID], 'the resolved admin uid, and nothing else');
        assert.notEqual(sends[0].uids, 'EVERYONE');
        // The body names the member who asked — which is precisely why it must not be broadcast.
        assert.match(String(sends[0].payload.body), new RegExp(MEMBER));
    });

    test('an admin whose uid cannot be resolved sends NOTHING, rather than falling back', async () => {
        // The failure direction that matters: "no targets" must mean silence. A fall-back-to-
        // everyone here would broadcast a named colleague's lockout at the exact moment the
        // addressing failed — the worst possible time to widen an audience.
        const { eps, sends } = build({ adminResolves: false });
        const { res, out } = makeRes();
        await eps.requestPasswordReset(reqFor(MEMBER), res);

        assert.equal(sends.length, 0);
        // ...and the REQUEST still succeeds. The row in Firestore is the doorbell; the push is a
        // courtesy on top, and losing the courtesy must never lose the request.
        assert.equal(out.code, 200);
    });

    test('a throttled repeat does not ring the admin again', async () => {
        // The per-member throttle is the notification's rate limit too — without that, anyone with
        // the URL could ring the admin's phone at will.
        const { eps, sends } = build({ seedStamps: { [MEMBER]: NOW } });
        const { res } = makeRes();
        await eps.requestPasswordReset(reqFor(MEMBER), res);
        assert.equal(sends.length, 0);
    });
});

test('the module never reaches for a broadcast sender', () => {
    // A static twin of the first case. The handler could acquire `fanOutPush` in a refactor that no
    // behavioural test happens to exercise — an error path, a "no targets" fallback — and the cost
    // of finding that out in production is a leak, so the import surface is pinned as well.
    const src = readFileSync(new URL('./functions/auth-endpoints.js', import.meta.url), 'utf8');
    assert.ok(!/fanOutPush/.test(src),
        'auth-endpoints.js must not reference fanOutPush — this notification names one person');
});
