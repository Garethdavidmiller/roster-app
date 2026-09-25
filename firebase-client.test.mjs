/**
 * firebase-client.test.mjs — the Firestore and Auth I/O layer, driven through the REAL module.
 *
 * Run: node --test firebase-client.test.mjs   (part of `npm run test:unit`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `firebase-client.js` was the one part of the client no test could reach. It imports the Firebase
 * SDK from the gstatic CDN, Node refuses an `https:` specifier at resolution, and `mock.module`
 * resolves before it replaces — so every page module was tested with THIS file mocked away, and the
 * file itself was not tested at all (KNOWN_LIMITATIONS → "Still genuinely untested"). The rules
 * were tested in the emulator and the pure helpers in Node; the lines that decide WHAT is written,
 * UNDER WHICH DOCUMENT, WITH WHOSE TOKEN were covered by nothing.
 *
 * A resolve hook (`test-fixtures/firebase-sdk/resolve-gstatic.mjs`) now answers those URLs with a
 * recording fake of the three SDK modules, so the real `firebase-client.js` loads and runs here.
 *
 * ── WHAT IS COVERED, AND WHY THOSE ──────────────────────────────────────────────────────────────
 *
 * Not everything: a test for every export would be brittle code by the yard. The calls chosen are
 * the ones where a wrong answer costs ACCESS, IDENTITY or a CREDENTIAL, organised by that cost —
 *
 *   · a push subscription carries its OWNER, or nobody can ever delete it but an admin;
 *   · a work email and a password stamp land under the MEMBER'S OWN document, and a stale claim is
 *     refreshed once and retried rather than failing for good;
 *   · a password that has changed is never reported as unchanged because a bookkeeping write failed;
 *   · a transient failure during re-authentication does not burn the surname candidate;
 *   · the admin endpoints are called with a FORCE-REFRESHED token, and the public reset request is
 *     called with NONE;
 *   · the fire-and-forget writers never throw into the page that called them.
 */
import { register } from 'node:module';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

register('./test-fixtures/firebase-sdk/resolve-gstatic.mjs', import.meta.url);

const { state, resetState, signIn } = await import('./test-fixtures/firebase-sdk/state.mjs');
const { SERVER_TS } = await import('./test-fixtures/firebase-sdk/firebase-firestore.mjs');

// fetch is global in the browser and the module calls it through fetch-timeout.js; record every call.
/** @type {Array<{ url: string, init: any }>} */
const fetches = [];
let fetchReply = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
globalThis.fetch = async (url, init = {}) => { fetches.push({ url: String(url), init }); return fetchReply(); };

const fc = await import('./firebase-client.js');

const MEMBER = 'L. Springer';
beforeEach(() => {
    resetState();
    fetches.length = 0;
    fetchReply = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const writes = (prefix) => state.ops.filter((o) => o.path.startsWith(prefix));
const keyBytes = (n, fill) => new Uint8Array(n).fill(fill).buffer;
const subscription = (endpoint, { p256dh = keyBytes(65, 1), auth = keyBytes(16, 2) } = {}) =>
    ({ endpoint, getKey: (k) => (k === 'p256dh' ? p256dh : auth) });

// ── push subscriptions ────────────────────────────────────────────────────────────────────────

describe('a push subscription carries its owner', () => {
    test('the signed-in uid is stamped, so only that identity can delete it', async () => {
        signIn({ uid: 'uid_springer' });
        await fc.savePushSubscription(subscription('https://push.example/abc'));
        const [w] = writes('pushSubscriptions/');
        assert.equal(w.data.owner, 'uid_springer');
        assert.equal(w.data.subscribedAt, SERVER_TS, 'the server clock, never the device');
    });

    test('signed out, the field is ABSENT rather than null', async () => {
        // The rule treats `owner` as optional for old documents; a written null would be a value the
        // rule has to reason about, and a delete check against it would be a question with no owner.
        await fc.savePushSubscription(subscription('https://push.example/abc'));
        const [w] = writes('pushSubscriptions/');
        assert.equal('owner' in w.data, false);
    });

    test('the document id is a hash of the endpoint, not the endpoint', async () => {
        // An endpoint is a bearer capability for pushing to that device; the id is readable in
        // places the payload is not.
        signIn();
        await fc.savePushSubscription(subscription('https://push.example/secret-path'));
        const [w] = writes('pushSubscriptions/');
        assert.match(w.path, /^pushSubscriptions\/[0-9a-f]{20}$/);
        assert.ok(!w.path.includes('secret-path'));
    });

    test('keys are URL-safe base64, which is what the push transport decodes', async () => {
        signIn();
        await fc.savePushSubscription(subscription('https://push.example/abc', { p256dh: keyBytes(65, 0xfb), auth: keyBytes(16, 0xff) }));
        const [w] = writes('pushSubscriptions/');
        for (const v of Object.values(w.data.keys)) assert.match(v, /^[A-Za-z0-9_-]+$/, 'no +, / or = padding');
    });

    test('a subscription without keys THROWS and writes nothing', async () => {
        // A silent skip used to let the caller mark the device subscribed with no server record.
        signIn();
        await assert.rejects(fc.savePushSubscription(subscription('https://push.example/abc', { p256dh: null })), /missing-keys/);
        assert.deepEqual(writes('pushSubscriptions/'), []);
    });

    test('deleting removes the document the save wrote', async () => {
        signIn();
        await fc.savePushSubscription(subscription('https://push.example/abc'));
        await fc.deletePushSubscription('https://push.example/abc');
        const [save, del] = writes('pushSubscriptions/');
        assert.equal(del.op, 'delete');
        assert.equal(del.path, save.path, 'the same hashed id both ways');
    });
});

// ── a member's own documents ──────────────────────────────────────────────────────────────────

describe('a work email is written under the member it belongs to', () => {
    test('doc id and field agree, the time is the server\'s, and other fields survive', async () => {
        signIn();
        state.docs.set(`staffContact/${MEMBER}`, { memberName: MEMBER, workEmail: 'old@chilternrailways.co.uk', note: 'kept' });
        await fc.saveStaffContact(MEMBER, 'new@chilternrailways.co.uk');
        const [w] = writes('staffContact/');
        assert.equal(w.path, `staffContact/${MEMBER}`);
        assert.deepEqual(w.data, { memberName: MEMBER, workEmail: 'new@chilternrailways.co.uk', updatedAt: SERVER_TS });
        assert.deepEqual(w.opts, { merge: true });
        assert.equal(state.docs.get(`staffContact/${MEMBER}`).note, 'kept');
    });

    test('a stale claim is refreshed ONCE and the write retried', async () => {
        // A member provisioned since their token was minted holds no name claim yet; without the
        // retry their first save is refused until the hourly refresh.
        signIn();
        state.failNext.set('staffContact/', 'permission-denied');
        await fc.saveStaffContact(MEMBER, 'a@chilternrailways.co.uk');
        assert.equal(writes('staffContact/').length, 2, 'refused, then retried');
        assert.deepEqual(state.authOps.filter((o) => o.op === 'getIdToken'), [{ op: 'getIdToken', force: true }]);
    });

    test('a refusal that survives the refresh is surfaced, not swallowed', async () => {
        signIn();
        state.failNext.set('staffContact/', { code: 'permission-denied', times: 2 });
        await assert.rejects(fc.saveStaffContact(MEMBER, 'a@chilternrailways.co.uk'), (e) => e.code === 'permission-denied');
        assert.equal(writes('staffContact/').length, 2, 'one retry, not a loop');
    });

    test('signed out, a refusal is NOT retried — there is no token to refresh', async () => {
        state.failNext.set('staffContact/', 'permission-denied');
        await assert.rejects(fc.saveStaffContact(MEMBER, 'a@chilternrailways.co.uk'));
        assert.equal(writes('staffContact/').length, 1);
    });
});

describe('the password stamp', () => {
    test('writes ONLY passwordSetAt, on the server clock, merged so a server resetAt survives', async () => {
        signIn();
        state.docs.set(`passwordStatus/${MEMBER}`, { resetAt: 'server-wrote-this' });
        await fc.savePasswordSetAt(MEMBER);
        const [w] = writes('passwordStatus/');
        assert.equal(w.path, `passwordStatus/${MEMBER}`);
        assert.deepEqual(w.data, { passwordSetAt: SERVER_TS });
        assert.deepEqual(w.opts, { merge: true });
        assert.equal(state.docs.get(`passwordStatus/${MEMBER}`).resetAt, 'server-wrote-this');
    });
});

// ── credentials ───────────────────────────────────────────────────────────────────────────────

describe('setting your own password', () => {
    test('changes the password, then stamps it', async () => {
        signIn({ uid: 'uid_springer' });
        const out = await fc.setOwnPassword(MEMBER, 'a-new-passphrase');
        assert.deepEqual(out, { statusRecorded: true });
        assert.deepEqual(state.authOps.find((o) => o.op === 'updatePassword'), { op: 'updatePassword', uid: 'uid_springer', pw: 'a-new-passphrase' });
        assert.equal(writes('passwordStatus/').length, 1);
    });

    test('a failed stamp NEVER reports the change as failed — the password already changed', async () => {
        // Rejecting here would tell the member to retry with a password that no longer exists.
        signIn();
        state.failNext.set('passwordStatus/', 'unavailable');
        const out = await fc.setOwnPassword(MEMBER, 'a-new-passphrase');
        assert.deepEqual(out, { statusRecorded: false });
        assert.equal(state.authOps.filter((o) => o.op === 'updatePassword').length, 1);
    });

    test('signed out, nothing is attempted', async () => {
        await assert.rejects(fc.setOwnPassword(MEMBER, 'x'), /Not signed in/);
        assert.equal(state.authOps.filter((o) => o.op === 'updatePassword').length, 0);
        assert.deepEqual(writes('passwordStatus/'), []);
    });
});

describe('re-authentication before a password change', () => {
    test('a wrong-password on the typed text falls through to the surname candidate', async () => {
        signIn();
        state.reauthRejects.set('SPRINGER', 'auth/wrong-password');
        await fc.reauthenticateWithPassword(MEMBER, 'SPRINGER');
        const tried = state.authOps.filter((o) => o.op === 'reauthenticate').map((o) => o.pw);
        assert.equal(tried.length, 2);
        assert.equal(tried[0], 'SPRINGER');
    });

    test('a TRANSIENT failure stops at once — the surname is not tried behind a network error', async () => {
        // Retrying on a rate-limit or an outage duplicates traffic and ends on a misleading error.
        signIn();
        state.reauthRejects.set('SPRINGER', 'auth/network-request-failed');
        await assert.rejects(fc.reauthenticateWithPassword(MEMBER, 'SPRINGER'), (e) => e.code === 'auth/network-request-failed');
        assert.equal(state.authOps.filter((o) => o.op === 'reauthenticate').length, 1);
    });

    test('it re-authenticates the SIGNED-IN account, with that account\'s email', async () => {
        signIn({ email: 'l.springer@myb-roster.local' });
        await fc.reauthenticateWithPassword(MEMBER, 'my-password');
        assert.equal(state.authOps.find((o) => o.op === 'reauthenticate').email, 'l.springer@myb-roster.local');
    });
});

// ── the server endpoints ──────────────────────────────────────────────────────────────────────

describe('admin endpoints are called with a FORCE-REFRESHED token', () => {
    // A token minted before the admin claim was revoked is still valid by signature for up to an
    // hour; forcing the refresh is the client half of `checkRevoked` on the server.
    const cases = [
        { name: 'resetMemberPassword', run: () => fc.resetMemberPassword(MEMBER, { revoke: false }), method: 'POST', url: /\/resetMemberPassword$/ },
        { name: 'getSignInStats', run: () => fc.getSignInStats(), method: 'GET', url: /\/getSignInStats$/ },
        { name: 'getAccountSetupGaps', run: () => fc.getAccountSetupGaps(), method: 'GET', url: /\/getAccountSetupGaps$/ },
    ];
    for (const c of cases) {
        test(`${c.name}: forced refresh, bearer header, ${c.method}`, async () => {
            signIn({ token: 'fresh-admin-token' });
            await c.run();
            assert.deepEqual(state.authOps.filter((o) => o.op === 'getIdTokenResult'), [{ op: 'getIdTokenResult', force: true }]);
            assert.equal(fetches.length, 1);
            assert.match(fetches[0].url, c.url);
            assert.equal(fetches[0].init.method, c.method);
            assert.equal(fetches[0].init.headers.Authorization, 'Bearer fresh-admin-token');
        });
        test(`${c.name}: signed out, nothing is sent`, async () => {
            await assert.rejects(c.run(), /Not signed in/);
            assert.equal(fetches.length, 0);
        });
        test(`${c.name}: a refusal from the server is an error, never a result`, async () => {
            signIn();
            fetchReply = () => new Response('Forbidden', { status: 403 });
            await assert.rejects(c.run(), /Server responded 403/);
        });
    }

    test('the reset carries exactly the member and the revoke choice', async () => {
        signIn();
        await fc.resetMemberPassword(MEMBER, { revoke: false });
        assert.deepEqual(JSON.parse(fetches[0].init.body), { member: MEMBER, revoke: false });
    });

    test('the two reads carry no body at all', async () => {
        signIn();
        await fc.getSignInStats();
        await fc.getAccountSetupGaps();
        assert.ok(fetches.every((f) => f.init.body === undefined));
    });
});

describe('the public reset request sends NO token', () => {
    test('even when a session exists, no Authorization header leaves the device', async () => {
        // The endpoint is unauthenticated by design; attaching a token would hand the one public
        // door a credential it never needed.
        signIn({ token: 'should-not-travel' });
        await fc.requestPasswordReset(MEMBER);
        assert.equal(fetches.length, 1);
        assert.equal(fetches[0].init.headers.Authorization, undefined);
        assert.deepEqual(JSON.parse(fetches[0].init.body), { member: MEMBER });
        assert.equal(state.authOps.filter((o) => /^getIdToken/.test(o.op)).length, 0);
    });
});

describe('the short-lived document URL', () => {
    // Held twice, and a mutation proved it: deleting the `if (!user) return null` guard leaves this
    // green, because the token getter then fails and document-url.js turns that into null before any
    // request. The guard buys a signed-out visitor an instant open; the CONTRACT below — no request,
    // fall back to the stored URL — is what this asserts, and it holds either way.
    test('signed out, there is no request — the stored URL is used', async () => {
        assert.equal(await fc.fetchSignedDocumentUrl('huddle'), null);
        assert.equal(fetches.length, 0);
    });
});

// ── the fire-and-forget writers ───────────────────────────────────────────────────────────────

describe('fire-and-forget writers never throw into the page', () => {
    test('logClientError records the error, unresolved, on the server clock', async () => {
        fc.logClientError({ memberName: MEMBER, page: 'calendar', message: 'm', stack: 's', appVersion: '1', userAgent: 'ua' });
        await new Promise((r) => setImmediate(r));
        const [w] = writes('clientErrors/');
        assert.deepEqual(w.data, { memberName: MEMBER, page: 'calendar', message: 'm', stack: 's', appVersion: '1', userAgent: 'ua', timestamp: SERVER_TS, resolved: false });
    });

    test('a refused error write is swallowed', async () => {
        state.failNext.set('clientErrors/', 'permission-denied');
        assert.doesNotThrow(() => fc.logClientError({ memberName: MEMBER, page: 'p', message: 'm', stack: '', appVersion: '1', userAgent: '' }));
        await new Promise((r) => setImmediate(r));   // an unhandled rejection would fail the run here
    });

    test('a page view increments one counter in this month\'s document', async () => {
        fc.recordPageView('calendar');
        await new Promise((r) => setImmediate(r));
        const [w] = writes('analytics/');
        assert.match(w.path, /^analytics\/pv_\d{4}-\d{2}$/);
        assert.deepEqual(w.data.counts, { calendar: { __fake: 'increment', n: 1 } });
        assert.deepEqual(w.opts, { merge: true });
    });

    test('an active-account mark with neither a month nor a day writes nothing', async () => {
        fc.recordActiveAccount({});
        await new Promise((r) => setImmediate(r));
        assert.deepEqual(writes('analytics/'), []);
    });

    test('the analytics writers carry no identity', async () => {
        // The Usage card is deliberately anonymous: the server receives increments and never learns
        // who. A member name reaching one of these documents would reverse that design.
        signIn({ uid: 'uid_springer', email: 'l.springer@myb-roster.local' });
        fc.recordPageView('calendar');
        fc.recordActiveAccount({ month: '2026-09', day: '2026-09-25' });
        fc.recordOriginUse({ day: '2026-09-25', origin: 'https://myb-roster.web.app', installed: true });
        fc.recordPerfSample({ page: 'calendar', metric: 'ready', bucket: 'lt1s', mode: 'browser', conn: '4g' });
        await new Promise((r) => setImmediate(r));
        const text = JSON.stringify(writes('analytics/'));
        assert.equal(writes('analytics/').length, 4);
        for (const id of ['uid_springer', 'springer', 'Springer']) assert.ok(!text.includes(id), `found ${id}`);
    });
});
