/**
 * firebase-client.test.mjs — the Firestore and Auth I/O layer, driven through the REAL module.
 *
 * Run: node scripts/run-tests.mjs firebase-client.test.mjs   (part of `npm run test:unit`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `firebase-client.js` was the one part of the client no test could reach. It imports the Firebase
 * SDK from the gstatic CDN, Node refuses an `https:` specifier at resolution, and `mock.module`
 * resolves before it replaces — so every page module was tested with THIS file mocked away, and the
 * file itself was not tested at all (KNOWN_LIMITATIONS → "Test coverage gaps"). The rules
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
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

register('./test-fixtures/firebase-sdk/resolve-gstatic.mjs', import.meta.url);

const { state, resetState, signIn } = await import('./test-fixtures/firebase-sdk/state.mjs');
const { SERVER_TS, fakeTimestamp } = await import('./test-fixtures/firebase-sdk/firebase-firestore.mjs');
const { monthKey, prevMonthKey, dayKey, originKey } = await import('./usage-stats.js');
const { perfSampleKey } = await import('./perf-stats.js');

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
    test('with no owner session it REFUSES at once and writes nothing (48-hour review)', async () => {
        // No user, an anonymous one or the PIN viewer can never satisfy the owner-only delete rule;
        // the caller (releaseDevicePush) needs to know NOW, not after a round trip, to drop the
        // browser subscription instead.
        await assert.rejects(fc.deletePushSubscription('https://push.example/abc'), /no-owner-session/);
        signIn().isAnonymous = true;
        await assert.rejects(fc.deletePushSubscription('https://push.example/abc'), /no-owner-session/);
        assert.deepEqual(writes('pushSubscriptions/'), [], 'a doomed delete is not attempted');
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

describe('every member\'s password status (the admin\'s table)', () => {
    test('a row is named by its document id — a stored `memberName` field can never rename it', async () => {
        // The id is what the rules bind and what the table acts on; getResetRequests put the id last
        // for this reason at v18.94, and this read still put the stored field over it.
        signIn();
        state.docs.set(`passwordStatus/${MEMBER}`, { memberName: 'Somebody Else', passwordSetAt: fakeTimestamp(5) });
        const rows = await fc.getAllPasswordStatus();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].memberName, MEMBER);
        assert.equal(rows[0].passwordSetAt.toMillis(), 5, 'and the rest of the record is kept');
    });
});

// A deadline belongs on the password change alone (settings-ops-2): the stamp is a Firestore write that
// settles only when the server acknowledges it, and timed with the change it turned a changed password
// into "we couldn't confirm" wherever commits were slow. The forced overlay times this call.
describe('changing your own password, with the stamp left to finish on its own', () => {
    test('resolves once the password has changed, while its stamp is still unacknowledged', async () => {
        signIn({ uid: 'uid_springer' });
        /** @type {(v?: any) => void} */ let acknowledge = () => {};
        state.holdNext.set('passwordStatus/', new Promise((r) => { acknowledge = r; }));
        // Raced, so a call that waits for the stamp FAILS here rather than hanging the file.
        const out = await Promise.race([fc.changeOwnPassword(MEMBER, 'a-new-passphrase'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('it waited for the stamp')), 1000))]);
        assert.deepEqual(state.authOps.find((o) => o.op === 'updatePassword'), { op: 'updatePassword', uid: 'uid_springer', pw: 'a-new-passphrase' });
        let settled = false;
        out.stamp.then(() => { settled = true; });
        await new Promise((r) => setImmediate(r));
        assert.equal(settled, false, 'premise: the stamp is still on its way');
        // …and every page's update reload waits for it (review, 11 Nov 2026): the forced change, on any
        // page, used to leave it to a reload that could drop it.
        const { backgroundWritesInFlight } = await import('./claim-retry.js');
        assert.equal(backgroundWritesInFlight(), 1, 'the record is not counted, so a release could reload over it');
        acknowledge();
        assert.equal(await out.stamp, true, 'and it is recorded once acknowledged');
        assert.equal(backgroundWritesInFlight(), 0, 'and no longer counted');
        assert.deepEqual(writes('passwordStatus/').map((w) => w.data), [{ passwordSetAt: SERVER_TS }]);
    });

    test('a stamp that fails settles false — it never rejects, because the password changed', async () => {
        signIn();
        state.failNext.set('passwordStatus/', 'unavailable');
        const out = await fc.changeOwnPassword(MEMBER, 'a-new-passphrase');
        assert.equal(await out.stamp, false);
    });

    test('signed out, nothing is attempted', async () => {
        await assert.rejects(fc.changeOwnPassword(MEMBER, 'x'), /Not signed in/);
        assert.equal(state.authOps.filter((o) => o.op === 'updatePassword').length, 0);
        assert.deepEqual(writes('passwordStatus/'), []);
    });

    test('a password change that fails rejects, and starts no stamp', async () => {
        signIn();
        state.reauthRejects.set('update:a-new-passphrase', 'auth/requires-recent-login');
        await assert.rejects(fc.changeOwnPassword(MEMBER, 'a-new-passphrase'), /requires-recent-login/);
        assert.deepEqual(writes('passwordStatus/'), [], 'no passwordSetAt for a password that did not change');
    });
});

// own-password.js is a factory firebase-client.js builds ONCE, at module load — so the one thing the
// re-export could get wrong is WHOSE password: a user captured at build would be nobody, for good.
describe('own-password.js — the factory behind the two re-exports', () => {
    test('it reads the signed-in user at CALL time, never one captured when it was built', async () => {
        const { buildPasswordClient } = await import('./own-password.js');
        const auth = { currentUser: /** @type {any} */ (null) };
        /** @type {any[]} */ const updates = [];
        const client = buildPasswordClient({ auth, reauthenticateWithCredential: async () => {},
            EmailAuthProvider: { credential: (/** @type {string} */ e, /** @type {string} */ p) => ({ e, p }) },
            updatePassword: async (/** @type {any} */ u, /** @type {string} */ pw) => { updates.push([u.uid, pw]); },
            savePasswordSetAt: async () => {}, trackBackgroundWrite: (/** @type {any} */ p) => p });
        await assert.rejects(client.changeOwnPassword(MEMBER, 'a-new-passphrase'), /Not signed in/);
        auth.currentUser = { uid: 'uid_later', email: 'l.springer@myb-roster.local' };
        await client.changeOwnPassword(MEMBER, 'a-new-passphrase');
        assert.deepEqual(updates, [['uid_later', 'a-new-passphrase']]);
    });
});

// Another tab on a shared browser can change `auth.currentUser`, while the page's member comes from its
// local session; the forced change calls changeOwnPassword with no re-authentication. Without the check,
// a colleague's password could be set to what this member typed — and stamped as this member's.
describe('the password calls act on the page member\'s OWN account, or send nothing (audit A3/B4)', () => {
    const coded = (/** @type {any} */ e) => e?.code === 'myb/account-mismatch';
    for (const [who, user] of /** @type {const} */ ([
        ['a colleague signed in from another tab', { uid: 'uid_colleague', email: 'g.miller@myb-roster.local' }],
        ['an account with no email (the staff PIN)', { uid: 'calendar-viewer', email: null }],
    ])) {
        test(`${who}: both refuse, coded, before anything is sent`, async () => {
            signIn(/** @type {any} */ (user));
            await assert.rejects(fc.changeOwnPassword(MEMBER, 'a-new-passphrase'), coded);
            await assert.rejects(fc.reauthenticateWithPassword(MEMBER, 'SPRINGER'), coded);
            assert.deepEqual(state.authOps.filter((o) => o.op === 'updatePassword' || o.op === 'reauthenticate'), [],
                'a credential call went to an account that is not the page member\'s');
            assert.deepEqual(writes('passwordStatus/'), [], 'a stamp was started for a password that was not changed');
        });
    }

    test('no member named is nobody\'s account either — refused the same way, not a TypeError', async () => {
        signIn();
        await assert.rejects(fc.changeOwnPassword(/** @type {any} */ (undefined), 'a-new-passphrase'), coded);
        assert.deepEqual(state.authOps.filter((o) => o.op === 'updatePassword'), []);
    });

    test('…and both pages word the refusal through their shared ladder — never as a wrong password', async () => {
        // A credential rejection reads "Current password incorrect … ask the admin to reset it", which
        // would send a member whose password is fine to an admin reset.
        const { passwordChangeFailure, isCredentialRejection } = await import('./auth-identity.js');
        assert.equal(isCredentialRejection('myb/account-mismatch'), false);
        for (const reauthed of [false, true]) {
            assert.doesNotMatch(passwordChangeFailure('myb/account-mismatch', reauthed).message, /incorrect/i);
        }
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
        { name: 'resetMemberPassword', run: () => fc.resetMemberPassword(MEMBER), method: 'POST', url: /\/resetMemberPassword$/ },
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

    test('the reset carries exactly the member — a reset always signs them out, so there is no choice to send', async () => {
        // The `revoke` option and its body field went with the server's (functions-core, Nov 2026):
        // the "Phase-2 migration nudge" they served never did anything (PASSWORD_DESIGN.md §7).
        signIn();
        await fc.resetMemberPassword(MEMBER);
        assert.deepEqual(JSON.parse(fetches[0].init.body), { member: MEMBER });
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
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            fc.recordPageView('calendar');
            fc.recordActiveAccount({ month: '2026-09', day: '2026-09-25' });
            fc.recordOriginUse({ day: '2026-09-25', origin: 'https://myb-roster.web.app', installed: true });
            fc.recordPerfSample({ page: 'calendar', metric: 'ready', bucket: 'lt1s', mode: 'browser', conn: '4g' });
            mock.timers.tick(1000);   // the perf batch's flush (see the next test)
        } finally { mock.timers.reset(); }
        await new Promise((r) => setImmediate(r));
        const text = JSON.stringify(writes('analytics/'));
        assert.equal(writes('analytics/').length, 4);
        for (const id of ['uid_springer', 'springer', 'Springer']) assert.ok(!text.includes(id), `found ${id}`);
    });

    test('perf samples from one open go as ONE merged write, after the burst (review F5)', async () => {
        // A Calendar open records a dozen or more samples; each used to be its own setDoc on
        // Firestore's single queue beside the roster's own reads.
        signIn({ uid: 'uid_springer', email: 'l.springer@myb-roster.local' });
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            fc.recordPerfSample({ page: 'calendar', metric: 'fcp',   bucket: 'lt500ms', mode: 'browser', conn: '4g' });
            fc.recordPerfSample({ page: 'calendar', metric: 'ready', bucket: '1-3s',    mode: 'browser', conn: '4g' });
            fc.recordPerfSample({ page: 'calendar', metric: 'ready', bucket: '1-3s',    mode: 'browser', conn: '4g' });
            await new Promise((r) => setImmediate(r));
            assert.deepEqual(writes('analytics/perf_'), [], 'nothing is written while the page is still starting');
            mock.timers.tick(1000);
        } finally { mock.timers.reset(); }
        await new Promise((r) => setImmediate(r));
        const perf = writes('analytics/perf_');
        assert.equal(perf.length, 1, 'one write for the whole open');
        const samples = perf[0].data.samples;
        assert.equal(Object.keys(samples).length, 2);
        assert.deepEqual(Object.values(samples).map((v) => v.n).sort(), [1, 2], 'a repeated sample is counted, not dropped');
        assert.deepEqual(perf[0].opts, { merge: true }, 'merge — never a replace of the month\'s counters');
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ADMIN SCREENS' READS (26 Sep 2026) — the gap KNOWN_LIMITATIONS recorded after the first pass.
// Each of the three is the only thing between the admin and a wrong picture: the Error Log is where
// problems are SEEN, and the two cards are how the app's own health and adoption are judged. The
// arithmetic under them is unit-tested in client-errors / usage-stats / perf-stats; what is tested
// here is the Firestore I/O around it — which documents, which query, and that housekeeping never
// takes the read down with it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const DAY = 24 * 60 * 60 * 1000;
/** Seed one clientErrors record. */
function seedError(id, { resolved = false, ageMs = 0, resolvedAgoMs = null } = {}) {
    state.docs.set(`clientErrors/${id}`, {
        message: `err ${id}`, page: 'calendar', resolved,
        timestamp: fakeTimestamp(Date.now() - ageMs),
        ...(resolvedAgoMs === null ? {} : { resolvedAt: fakeTimestamp(Date.now() - resolvedAgoMs) }),
    });
}
const settle = () => new Promise((r) => setImmediate(r));

describe('the Error Log read', () => {
    test('unresolved errors come first, newest first, and a resolved one never hides them', async () => {
        seedError('old-open', { ageMs: 5 * DAY });
        seedError('new-open', { ageMs: 1 * DAY });
        seedError('fixed',    { resolved: true, ageMs: 0, resolvedAgoMs: DAY });   // newer than both
        const { errors, truncated } = await fc.getClientErrors();
        assert.deepEqual(errors.map((e) => e.id), ['new-open', 'old-open', 'fixed']);
        assert.equal(truncated, false);
    });

    test('it asks for ONE MORE unresolved row than it shows — the only way to know more exist', async () => {
        await fc.getClientErrors();
        const open = state.reads.find((q) => q.wheres.some((w) => w.field === 'resolved' && w.value === false));
        assert.equal(open?.limit, 101, 'limit(100) cannot tell "exactly 100" from "hundreds"');
    });

    test('101 open errors: 100 shown and the card is told there are more', async () => {
        for (let i = 0; i < 101; i++) seedError(`e${i}`, { ageMs: i * 1000 });
        const { errors, truncated } = await fc.getClientErrors();
        assert.equal(errors.length, 100);
        assert.equal(truncated, true, 'a silently hidden error is the failure this card exists to prevent');
    });

    test('exactly 100 open errors is NOT reported as truncated', async () => {
        for (let i = 0; i < 100; i++) seedError(`e${i}`, { ageMs: i * 1000 });
        const { truncated } = await fc.getClientErrors();
        assert.equal(truncated, false);
    });

    test('the retention sweep deletes only RESOLVED records past 90 days, never an open one', async () => {
        seedError('ancient-open',  { ageMs: 400 * DAY });
        seedError('expired-fixed', { resolved: true, ageMs: 200 * DAY, resolvedAgoMs: 91 * DAY });
        seedError('recent-fixed',  { resolved: true, ageMs: 60 * DAY,  resolvedAgoMs: 30 * DAY });
        seedError('legacy-fixed',  { resolved: true, ageMs: 400 * DAY });   // no resolvedAt: left alone
        const { errors } = await fc.getClientErrors();
        await settle();
        assert.deepEqual(state.ops.filter((o) => o.op === 'delete').map((o) => o.path), ['clientErrors/expired-fixed']);
        assert.ok(!errors.some((e) => e.id === 'expired-fixed'), 'and it is not shown either');
        assert.ok(errors.some((e) => e.id === 'ancient-open'), 'an unresolved error is never aged out');
    });

    test('a sweep that fails does not take the Error Log down with it', async () => {
        seedError('expired-fixed', { resolved: true, ageMs: 200 * DAY, resolvedAgoMs: 91 * DAY });
        seedError('open', { ageMs: DAY });
        state.failNext.set('clientErrors/expired-fixed', 'permission-denied');
        const { errors } = await fc.getClientErrors();
        await settle();
        assert.deepEqual(errors.map((e) => e.id), ['open']);
    });
});

describe('the App Speed read', () => {
    const now = new Date();
    const key = (bucket, metric = 'ready', page = 'calendar') =>
        perfSampleKey({ version: '24.26', page, metric, bucket, mode: 'pwa', conn: '4g' });

    test('it reads THIS month and LAST month, each from its own document', async () => {
        state.docs.set(`analytics/perf_${monthKey(now)}`,     { samples: { [key('lt500ms')]: 3, [key('over8s')]: 1 } });
        state.docs.set(`analytics/perf_${prevMonthKey(now)}`, { samples: { [key('1-3s')]: 2 } });
        const { thisMonth, lastMonth } = await fc.getPerfStats();
        assert.equal(thisMonth.month, monthKey(now));
        assert.equal(lastMonth.month, prevMonthKey(now));
        assert.equal(thisMonth.ready.total, 4);
        assert.deepEqual([thisMonth.ready.overall.quick, thisMonth.ready.overall.slow], [3, 1]);
        assert.equal(lastMonth.ready.total, 2, 'last month is last month\'s samples, not this month\'s again');
    });

    test('each journey is its own metric — a sign-in sample is never counted as a page load', async () => {
        state.docs.set(`analytics/perf_${monthKey(now)}`, { samples: {
            [key('lt500ms', 'loginTotal')]: 5, [key('3-8s', 'fcp')]: 2, [key('1-3s', 'domReady')]: 7, [key('over8s', 'ready')]: 1,
        } });
        const { thisMonth } = await fc.getPerfStats();
        assert.deepEqual([thisMonth.login.total, thisMonth.fcp.total, thisMonth.pages.total, thisMonth.ready.total], [5, 2, 7, 1]);
        assert.equal(Object.keys(thisMonth.samples).length, 4, 'the raw map is carried through for the breakdown');
    });

    test('a month with no document is an empty window, not an error', async () => {
        const { thisMonth, lastMonth } = await fc.getPerfStats();
        assert.equal(thisMonth.ready.total, 0);
        assert.equal(lastMonth.pages.total, 0);
        assert.deepEqual(thisMonth.samples, {});
    });
});

describe('the Usage read', () => {
    const now = new Date();
    const daysAgo = (n) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

    test('page counts are this month\'s and last month\'s, busiest first', async () => {
        state.docs.set(`analytics/pv_${monthKey(now)}`,     { counts: { admin: 3, calendar: 40, paycalc: 12 } });
        state.docs.set(`analytics/pv_${prevMonthKey(now)}`, { counts: { calendar: 9 } });
        const u = await fc.getUsageStats();
        assert.deepEqual(u.pageCounts.map((r) => r.page), ['calendar', 'paycalc', 'admin']);
        assert.deepEqual(u.prevPageCounts, [{ page: 'calendar', count: 9 }]);
    });

    test('accounts this month and in the last 30 days come from the right buckets', async () => {
        state.docs.set('analytics/activeAccounts', {
            months: { [monthKey(now)]: 21, [prevMonthKey(now)]: 30 },
            daily:  { [daysAgo(0)]: 4, [daysAgo(10)]: 5, [daysAgo(40)]: 99 },   // 40 days ago is outside the window
        });
        const u = await fc.getUsageStats();
        assert.equal(u.accountsThisMonth, 21);
        assert.equal(u.accountsLast30, 9);
    });

    test('the daily prune removes stale keys by FieldPath — a dotted path would break the whole card', async () => {
        // A day key like 2026-08-01 is an INVALID dotted field path; the real SDK throws synchronously
        // on `daily.2026-08-01` and the Usage card goes blank. So the delete must name its segments.
        state.docs.set('analytics/activeAccounts', { months: {}, daily: { [daysAgo(1)]: 2, [daysAgo(60)]: 7 } });
        await fc.getUsageStats();
        await settle();
        const prunes = state.ops.filter((o) => o.op === 'update' && o.path === 'analytics/activeAccounts');
        assert.deepEqual(prunes.map((o) => o.segments), [['daily', daysAgo(60)]]);
        assert.equal(prunes[0].value?.__fake, 'deleteField');
        assert.equal(state.docs.get('analytics/activeAccounts').daily[daysAgo(1)], 2, 'a recent day is kept');
    });

    test('the per-address counters are read, summarised and pruned the same way', async () => {
        state.docs.set('analytics/origins', { daily: {
            [originKey(daysAgo(2), 'web')]: 6, [originKey(daysAgo(2), 'web', true)]: 4,
            [originKey(daysAgo(3), 'pages')]: 9, [originKey(daysAgo(50), 'pages')]: 1, 'junk-key': 3,
        } });
        const u = await fc.getUsageStats();
        await settle();
        assert.deepEqual(u.origins, [{ origin: 'pages', accounts: 9, installed: 0 }, { origin: 'web', accounts: 6, installed: 4 }]);
        const pruned = state.ops.filter((o) => o.op === 'update' && o.path === 'analytics/origins').map((o) => o.segments[1]).sort();
        assert.deepEqual(pruned, [originKey(daysAgo(50), 'pages'), 'junk-key'].sort());
    });

    test('nothing recorded yet is the empty picture, not an error', async () => {
        const u = await fc.getUsageStats();
        assert.deepEqual([u.pageCounts, u.accountsThisMonth, u.accountsLast30, u.origins], [[], 0, 0, []]);
    });

    test('a failed prune, or an unreadable origins document, never breaks the read', async () => {
        state.docs.set('analytics/activeAccounts', { months: { [monthKey(now)]: 3 }, daily: { [daysAgo(60)]: 1 } });
        state.failNext.set('analytics/activeAccounts', 'permission-denied');   // the prune's write
        state.failNext.set('read:analytics/origins', 'unavailable');           // the origins read
        const u = await fc.getUsageStats();
        await settle();
        assert.equal(u.accountsThisMonth, 3);
        assert.deepEqual(u.origins, []);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A READ THE OFFLINE CACHE ANSWERED IS A FAILED LOAD (settings-ops-1, Nov 2026). Offline, the SDK does
// not fail these reads: it answers from this device's cache, as of whenever it last heard — an empty
// reset queue included. Operations painted that as the server's answer: "✓ No outstanding requests"
// beside a member who was locked out, and "0/51" on a device that had never held the table. Each read
// now rejects with `unavailable`, the SDK's own offline code, so every card's "Couldn't load … Try
// again" path answers instead. The cards themselves are driven in e2e/operations.spec.js.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The SDK's own code for "the client is offline" — what an uncached read already rejects with. */
const offline = (/** @type {any} */ e) => e?.code === 'unavailable';

describe('a read the offline cache answered is a failed load (settings-ops-1)', () => {
    const REQUEST = { requestedAt: fakeTimestamp(5), count: 1, provisioned: true };
    const EMAIL = 'a@chilternrailways.co.uk';

    test('an EMPTY reset queue from the cache is not "no outstanding requests"', async () => {
        // The case the card is worst at: a request that arrived after this device last heard.
        state.fromCache = true;
        await assert.rejects(fc.getResetRequests(), offline);
    });

    test('nor is a request the cache still holds presented as current', async () => {
        state.docs.set(`resetRequests/${MEMBER}`, REQUEST);
        state.fromCache = true;
        await assert.rejects(fc.getResetRequests(), offline);
    });

    test('Account status refuses both of its reads — the work emails and the password stamps', async () => {
        state.docs.set(`staffContact/${MEMBER}`, { memberName: MEMBER, workEmail: EMAIL });
        state.docs.set(`passwordStatus/${MEMBER}`, { passwordSetAt: fakeTimestamp(5) });
        state.fromCache = true;
        await assert.rejects(fc.getAllStaffContacts(), offline);
        await assert.rejects(fc.getAllPasswordStatus(), offline);
    });

    test('online, the same three reads answer exactly as before', async () => {
        state.docs.set(`resetRequests/${MEMBER}`, REQUEST);
        state.docs.set(`staffContact/${MEMBER}`, { memberName: MEMBER, workEmail: EMAIL });
        state.docs.set(`passwordStatus/${MEMBER}`, { passwordSetAt: fakeTimestamp(5) });
        assert.deepEqual((await fc.getResetRequests()).map((r) => r.memberName), [MEMBER]);
        assert.deepEqual((await fc.getAllStaffContacts()).map((c) => c.workEmail), [EMAIL]);
        assert.deepEqual((await fc.getAllPasswordStatus()).map((s) => s.memberName), [MEMBER]);
    });

    test('the claim-retry passes it straight through — not retried as a stale claim, not reworded', async () => {
        // Operations reads through withClaimRetry. A retry would spend a forced token refresh on a
        // device that is offline, and a changed code would cost the card its failed-load path.
        signIn();
        state.fromCache = true;
        await assert.rejects(fc.withClaimRetry(fc.getResetRequests), (e) => offline(e) && /offline cache/.test(e.message));
        assert.equal(state.reads.filter((r) => r.col === 'resetRequests').length, 1, 'read once');
        assert.deepEqual(state.authOps.filter((o) => o.op === 'getIdToken'), [], 'no token refresh');
    });

    test('the Error Log, App Speed and Usage refuse it through the real wiring, and prune nothing from it', async () => {
        // Every document is SEEDED: offline, a document the cache lacks already rejects, so only a
        // cached one can show whether the reader looks at where its answer came from.
        const now = new Date();
        seedError('open', { ageMs: DAY });
        seedError('expired-fixed', { resolved: true, ageMs: 200 * DAY, resolvedAgoMs: 91 * DAY });
        for (const m of [monthKey(now), prevMonthKey(now)]) {
            state.docs.set(`analytics/perf_${m}`, { samples: {} });
            state.docs.set(`analytics/pv_${m}`, { counts: { calendar: 4 } });
        }
        state.docs.set('analytics/activeAccounts', { months: {}, daily: { '2020-01-01': 3 } });
        state.docs.set('analytics/origins', { daily: { '2020-01-01|web': 1 } });
        state.fromCache = true;
        await assert.rejects(fc.getClientErrors(), offline);
        await assert.rejects(fc.getPerfStats(), offline);
        await assert.rejects(fc.getUsageStats(), offline);
        await settle();
        assert.deepEqual(state.ops, [], 'no delete and no prune decided on the cache\'s copy');
    });
});

// ── WHERE A RESTORED SESSION IS KEPT IS DECIDED BY WHO IT IS (sign-in check, 11 Nov 2026) ───────────
// `authBootstrap` migrates whoever this browser restored: the shared PIN account to THIS TAB
// (sessionStorage, so it goes when the browser closes — AUTH_AND_SESSIONS 12) and a member to this
// DEVICE (IndexedDB). Inverting that one condition survived thirteen suites: the PIN would have outlived
// the browser on a station PC, and a member would have been signed out with the tab. A fresh copy of the
// module boots against each user, because the copy the file imported booted with nobody signed in.
describe('authBootstrap — who was restored decides where the session lives', () => {
    const persistenceCalls = () => state.authOps.filter((o) => o.op === 'setPersistence').map((o) => o.type);

    test('the PIN account is kept to this tab', async () => {
        state.currentUser = { uid: 'calendar-viewer' };   // the uid isViewerUser recognises
        const boot = await (await import('./firebase-client.js?boot-viewer')).authBootstrap;
        assert.equal(boot.persistence, 'session');
        assert.equal(boot.user, state.currentUser, 'and the restored user is handed on, not re-asked');
        assert.deepEqual(persistenceCalls(), ['session']);
    });

    test('a member is kept on this device', async () => {
        signIn();
        const boot = await (await import('./firebase-client.js?boot-member')).authBootstrap;
        assert.equal(boot.persistence, 'indexeddb');
        assert.deepEqual(persistenceCalls(), ['indexeddb']);
    });
});

// ── THE RESET PROBE THAT COULD NOT ASK SAYS "UNKNOWN", NEVER "NEVER RESET" (sign-in check) ──────────
// 0 means "never reset", which lets a silent sign-in go ahead on the surname default; null means it
// could not be confirmed, and the caller withholds that (AUTH_AND_SESSIONS 23). The catch answering 0
// survived fourteen suites — a phone that lost the network mid-probe would have been let back in.
describe('probeResetAtMs — every way the probe ends', () => {
    const EMAIL = 'l.springer@myb-roster.local';
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    const replies = (...rs) => { fetchReply = () => { const r = rs.shift(); if (r instanceof Error) throw r; return r; }; };

    test('a network failure is unknown', async () => {
        replies(new TypeError('Failed to fetch'));
        assert.equal(await fc.probeResetAtMs(EMAIL, 'springer', MEMBER, 2_000), null);
    });
    test('a failure on the second request is unknown too', async () => {
        replies(json(200, { idToken: 'rest-token' }), new TypeError('Failed to fetch'));
        assert.equal(await fc.probeResetAtMs(EMAIL, 'springer', MEMBER, 2_000), null);
    });
    test('a rejected password, and a throttle, are named as such', async () => {
        replies(json(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }));
        assert.equal(await fc.probeResetAtMs(EMAIL, 'springer', MEMBER, 2_000), 'credential');
        replies(json(400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }));
        assert.equal(await fc.probeResetAtMs(EMAIL, 'springer', MEMBER, 2_000), 'throttled');
    });
    test('a member never reset is 0, and a reset is its time — read with the probe\'s own token', async () => {
        replies(json(200, { idToken: 'rest-token' }), json(404, {}));
        assert.equal(await fc.probeResetAtMs(EMAIL, 'springer', MEMBER, 2_000), 0);
        replies(json(200, { idToken: 'rest-token' }), json(200, { fields: { resetAt: { timestampValue: '2026-11-01T09:00:00Z' } } }));
        assert.equal(await fc.probeResetAtMs(EMAIL, 'springer', MEMBER, 2_000), Date.parse('2026-11-01T09:00:00Z'));
        assert.equal(fetches.at(-1).init.headers.Authorization, 'Bearer rest-token');
        assert.match(fetches.at(-1).url, /passwordStatus\/L\.%20Springer$/);
    });
});

// ── a checked write first waits for this device's own queued writes (v25.95) ─────────────────────
// The rule (bounded, a rejection passed on) is ownWritesSent in claim-retry.js, tested there. What is
// tested HERE is the wiring: that the export asks the SDK about the app's own Firestore — a wait
// pointed at another instance would answer "nothing queued" at once, and every check would run
// exactly as it did before the fix, green.
describe('whenOwnWritesSent — the wait a checked write makes before it reads the server', () => {
    const waits = () => state.ops.filter((o) => o.op === 'waitForPendingWrites');

    test('nothing queued: true at once, asked about the app\'s own Firestore', async () => {
        assert.equal(await fc.whenOwnWritesSent(50), true);
        assert.equal(waits().length, 1);
        assert.equal(waits()[0].db, fc.db);
    });
    test('a queue that drains in time: true', async () => {
        /** @type {() => void} */ let send = () => {};
        state.pendingWrites = new Promise((r) => { send = () => r(undefined); });
        const answer = fc.whenOwnWritesSent(2_000);
        setTimeout(send, 10);
        assert.equal(await answer, true);
    });
    test('a queue that does not drain in time: false — the caller answers as offline', async () => {
        state.pendingWrites = new Promise(() => {});
        const started = Date.now();
        assert.equal(await fc.whenOwnWritesSent(20), false);
        assert.ok(Date.now() - started < 1_000, 'the limit it was given was not the one it kept');
    });
});
