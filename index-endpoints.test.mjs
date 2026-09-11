/**
 * index-endpoints.test.mjs — the two handlers that stayed in `functions/index.js`, EXECUTED.
 * Run with: npm run test:functions   (needs firebase-admin/firebase-functions from functions/node_modules)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * A repo-wide mutation sweep found the two endpoints the v20.55 domain split deliberately left in
 * the composition root — `parseRosterPDF` and `unlockCalendarViewer` — to be the only handlers in
 * the estate with NO executing test at all. Six separate mutations survived both `npm test` and
 * `npm run test:functions`:
 *
 *   · `parseRosterPDF`'s admin check reduced to `if (false)`. Every holder of a valid ID token for
 *     this project — every signed-in member, and the shared PIN station token — could then POST any
 *     PDF, spend the ANTHROPIC_API_KEY on it, and read the model's account of it back.
 *   · `unlockCalendarViewer`'s two FAIL-CLOSED catches (rule 5) each continuing instead of
 *     answering 503, so a guess that could not be counted is answered anyway.
 *   · its all-sources ceiling (v20.35) deleted, leaving only the per-source bucket a forged
 *     forwarding header can multiply at will.
 *   · `createCustomToken(uid, viewerClaims())` reduced to `createCustomToken(uid)` — the claimless
 *     token that signs in perfectly and then has every override read denied.
 *   · its missing-or-malformed-secret guard reduced to `if (false)`, turning a deployment fault
 *     into a flat "PIN not recognised" for the whole station.
 *
 * This is the shape CLAUDE.md names as the repo's blind spot: `functions/calendar-viewer-auth.js`
 * is exemplary and every probe against it was caught, because the rules are right. What nothing
 * asked was whether the handler CALLS them, in the right order, and acts on the answers. And the
 * standing lesson is this very endpoint — the v20.50 outage, signed off on a GET→405 and a wrong
 * PIN→401, neither of which reaches `createCustomToken`, so the minting path had never once run.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * `functions/index.js` is not a factory: it is the composition root, and its handlers are defined
 * at load. So the fakes go into `require.cache` BEFORE it is required, and `getAuth`/`getFirestore`
 * resolve a per-test world through a mutable binding — the module is loaded once and every test
 * swaps the world underneath it. Everything between the HTTP boundary and the SDK is real code:
 * the CORS wrapper, the auth ladder, the throttle round trip, the transaction, the mint.
 *
 * Every fake RECORDS. "Refused with 403" and "spent the API key and then returned 403" are the same
 * status line, and only the recording tells them apart.
 *
 * ORGANISED BY WHAT A WRONG ANSWER COSTS, not one block per function.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);

// The SDK's production-credential probing is silenced the same way functions-surface.test.mjs does
// it; the module's top level only DEFINES endpoints, so requiring it touches no network.
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.ANTHROPIC_API_KEY  = 'test-key-never-used';

const VIEWER = require('./functions/calendar-viewer-auth.js');
const { CALENDAR_VIEWER_UID, GLOBAL_SOURCE_KEY, sourceKeyFor } = VIEWER;

// ── The fake world ──────────────────────────────────────────────────────────────────────────────

/**
 * The current test's world. `getAuth()`/`getFirestore()` read it at CALL time, which is what lets
 * one load of index.js serve every test — and is also the only option, since a composition root
 * re-required per test would re-register every one of the nineteen deployed functions.
 */
let W = null;

/** What the lazily-required Anthropic SDK saw. Reset by `build()`. */
const AI = { calls: [], reply: '', throws: null };

const fnDir = new URL('./functions/', import.meta.url).pathname;
const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

// Injected at the MODULAR entry points — since the firebase-admin v14 migration the root export no
// longer carries `auth`/`firestore`, so a fake left there would be required by nobody and this whole
// suite would run against the real SDK while passing.
stub(require.resolve('firebase-admin/app',       { paths: [fnDir] }), { initializeApp: () => ({}) });
stub(require.resolve('firebase-admin/auth',      { paths: [fnDir] }), { getAuth: () => W.auth });
stub(require.resolve('firebase-admin/firestore', { paths: [fnDir] }), {
    getFirestore: () => W.db,
    FieldValue: { serverTimestamp: () => ({ toMillis: () => Date.now() }), increment: (n) => ({ inc: n }) },
    Timestamp:   { fromMillis: (ms) => ({ toMillis: () => ms }) },
});
// The one runtime dependency `parseRosterPDF` lazy-requires. Faking it is not merely about avoiding
// a network call: an unstubbed SDK would REFUSE the request for want of a real key, so the
// refusal tests below would pass on the wrong 4xx and the positive control could not exist at all.
stub(require.resolve('@anthropic-ai/sdk', { paths: [fnDir] }), {
    Anthropic: class {
        constructor(opts) { AI.calls.push({ kind: 'construct', opts }); }
        get messages() {
            return {
                create: async (body) => {
                    AI.calls.push({ kind: 'create', model: body && body.model });
                    if (AI.throws) throw new Error(AI.throws);
                    return { content: [{ type: 'text', text: AI.reply }] };
                },
            };
        }
    },
});

const index = require('./functions/index.js');

/**
 * The `viewerAttempts` collection, recording every read and write.
 *
 * `writes` is what makes rule 3 testable at all — "only FAILURES touch the throttle store" is a
 * statement about what did NOT happen, and a fake that merely applied the writes could not answer
 * it. The three `fail` seams are the failure modes the handler's two fail-closed catches exist for;
 * none of them is reachable by ordering real calls differently.
 */
function makeAttempts({ seed = {}, failRead = false, failTx = false, failSweep = false } = {}) {
    const store = new Map(Object.entries(seed));
    const reads = [];
    const writes = [];
    const deletes = [];
    const boom = (code) => Object.assign(new Error('firestore unavailable'), { code });
    const snap = (id) => ({
        id,
        exists: store.has(id),
        data: () => store.get(id),
        ref: { id },
    });
    const docRef = (id) => ({
        id,
        get: async () => {
            reads.push(id);
            if (failRead) throw boom('unavailable');
            return snap(id);
        },
    });
    const db = {
        collection(name) {
            assert.equal(name, 'viewerAttempts', 'the PIN handler touches exactly one collection');
            return {
                doc: docRef,
                limit: (n) => ({
                    get: async () => {
                        if (failSweep) throw boom('deadline-exceeded');
                        return { docs: [...store.keys()].slice(0, n).map(snap) };
                    },
                }),
            };
        },
        async runTransaction(fn) {
            if (failTx) throw boom('aborted');
            return fn({
                get: async (ref) => { reads.push(`tx:${ref.id}`); return snap(ref.id); },
                set: (ref, data) => { writes.push({ id: ref.id, data }); store.set(ref.id, data); },
            });
        },
        batch() {
            const pending = [];
            return {
                delete: (ref) => pending.push(ref.id),
                commit: async () => {
                    if (failSweep) throw boom('aborted');
                    for (const id of pending) { deletes.push(id); store.delete(id); }
                },
            };
        },
    };
    return { db, store, reads, writes, deletes };
}

/** Every Auth call the handlers make, in order — plus the seams each one can fail at. */
function makeAuth({ token = { admin: true, name: 'G. Miller' }, viewerExists = false, authFail = {} } = {}) {
    const ops = [];
    const auth = {
        verifyIdToken: async (bearer, checkRevoked) => {
            ops.push({ op: 'verifyIdToken', bearer, checkRevoked });
            if (!token) throw new Error('token verification failed');
            return token;
        },
        getUser: async (uid) => {
            ops.push({ op: 'getUser', uid });
            if (viewerExists) return { uid };
            throw Object.assign(new Error('no such user'), { code: 'auth/user-not-found' });
        },
        createUser: async (props) => { ops.push({ op: 'createUser', props }); return { uid: props.uid }; },
        setCustomUserClaims: async (uid, claims) => {
            ops.push({ op: 'setCustomUserClaims', uid, claims });
            if (authFail.setCustomUserClaims) throw new Error(authFail.setCustomUserClaims);
        },
        createCustomToken: async (uid, claims) => {
            // `claims` is recorded EXACTLY as passed — `undefined` included, because that is the
            // whole of mutation 4: `createCustomToken(uid)` mints a perfectly valid token with no
            // capability in it, and every override read the client then issues is denied.
            ops.push({ op: 'createCustomToken', uid, claims });
            if (authFail.createCustomToken) throw new Error(authFail.createCustomToken);
            return 'custom-token-value';
        },
    };
    return { auth, ops };
}

/** Stand up one world. Everything either handler can reach comes from here. */
function build(opts = {}) {
    const attempts = makeAttempts(opts);
    const { auth, ops } = makeAuth(opts);
    W = { auth, db: attempts.db };
    AI.calls.length = 0;
    AI.reply = opts.aiReply ?? AI_REPLY;
    AI.throws = opts.aiThrows ?? null;
    if ('pin' in opts) {
        if (opts.pin === undefined) delete process.env.CALENDAR_VIEWER_PIN;
        else process.env.CALENDAR_VIEWER_PIN = opts.pin;
    } else {
        process.env.CALENDAR_VIEWER_PIN = FIXTURE_PIN;
    }
    return { ...attempts, auth, ops };
}

/**
 * Express-ish response capture.
 *
 * Fuller than it looks necessary: `onRequest` wraps the handler in a Promise that resolves on the
 * response's `finish` event and runs the CORS middleware first, so a plain `{status, json}` stub
 * throws before a line of product code runs.
 */
function makeRes() {
    const out = { code: 200, body: null, headers: {} };
    const res = new EventEmitter();
    let done = false;
    Object.assign(res, {
        status(c) { out.code = c; return res; },
        json(b)   { out.body = b; res.end(); return res; },
        send(b)   { out.body = b; res.end(); return res; },
        setHeader(k, v) { out.headers[k] = v; return res; },
        getHeader(k)    { return out.headers[k]; },
        removeHeader(k) { delete out.headers[k]; return res; },
        set(k, v) { out.headers[k] = v; return res; },
        vary()    { return res; },
        writeHead(c) { out.code = c; return res; },
        end() { if (!done) { done = true; process.nextTick(() => res.emit('finish')); } return res; },
    });
    return { res, out };
}

const withHelpers = (req) => Object.assign(req, {
    url: '/', path: '/', query: {},
    get(h)    { return this.headers[String(h).toLowerCase()]; },
    header(h) { return this.get(h); },
});

/** Invoke an onRequest handler and give back { code, body, headers }. */
async function call(handler, req) {
    const { res, out } = makeRes();
    await handler(req, res);
    return out;
}

// ── parseRosterPDF fixtures ─────────────────────────────────────────────────────────────────────

const WEEK_ENDING = '2026-09-05';                       // a Saturday, as the header demands
const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PARSED_ROW  = {
    memberName: 'L. Springer',                          // a real name in roster-members.json → cea
    Sun: 'BLANK', Mon: '05:30-11:30', Tue: 'RD', Wed: 'RD',
    Thu: '05:30-11:30', Fri: 'RD', Sat: 'RD',
};
const AI_REPLY = JSON.stringify({ columnHeaders: DAY_HEADERS, parsed: [PARSED_ROW] });

// A byte string that passes `fileSignatureMatches(buf, 'pdf')`. The geometry witness will fail to
// open it and fail OPEN, which is its documented behaviour and exactly what a test of the AUTH
// ladder wants: nothing downstream may decide the outcome of a refusal.
const FAKE_PDF_BASE64 = Buffer
    .concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(256, 0x20)])
    .toString('base64');

/**
 * ONE request builder for every parseRosterPDF case, varying only the bearer token.
 *
 * This is what gives the refusals their teeth. A refusal test that quietly sent a malformed body
 * would go on passing with the admin check deleted — it would simply fail one line further down —
 * so every refusal below is asserted against a request the positive control proves is accepted.
 */
const rosterRequest = ({ auth = 'Bearer tok' } = {}) => withHelpers({
    method: 'POST',
    headers: {
        origin: 'https://myb-roster.web.app',
        ...(auth === null ? {} : { authorization: auth }),
        'x-week-ending': WEEK_ENDING,
        'x-roster-type': 'cea',
    },
    rawBody: Buffer.from(FAKE_PDF_BASE64, 'utf8'),
});

const modelCalls = () => AI.calls.filter((c) => c.kind === 'create');

// ── unlockCalendarViewer fixtures ───────────────────────────────────────────────────────────────

// INVENTED VALUES, and named so on purpose. The live PIN is not in this repository and must not
// become discoverable from it — `calendar-viewer-parity.test.mjs` Contract B bans a test file
// holding anything that reads as a verifier, because that is the file class the real one once
// reached. These two exist only to be equal and unequal to whatever `build()` puts in the env.
const FIXTURE_PIN = '4821';
const WRONG_PIN   = '1357';
const STATION_IP  = '203.0.113.9';
const STATION_KEY = sourceKeyFor(STATION_IP);
const HOUR        = 60 * 60 * 1000;

/** A bucket that is blocked for the next hour — the shape `recordFailure` writes when it trips. */
const blockedBucket = () => ({
    failures: 30, windowStart: Date.now() - 1000, blockedUntil: Date.now() + HOUR,
});

const pinRequest = (pin, { ip = STATION_IP, method = 'POST' } = {}) => withHelpers({
    method,
    headers: { origin: 'https://myb-roster.web.app', 'x-forwarded-for': ip },
    body: pin === undefined ? {} : { pin },
});

const minted = (ops) => ops.find((o) => o.op === 'createCustomToken');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// parseRosterPDF — the cost is somebody else's API key, and the model's reading of their document
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('parseRosterPDF: only an admin may spend the AI key', () => {
    // The guard is one line and had no test of any kind. What it holds back is not a write — this
    // endpoint writes nothing — but an unbounded spend on a secret key, and a general-purpose
    // document reader answering to anyone the project will issue a token to. Every refusal below
    // therefore asserts on the MODEL CALLS, not only on the status: returning 403 after asking
    // Claude would satisfy any status-code assertion ever written about this handler.

    test('an admin\'s upload really is accepted — the control every refusal below leans on', async () => {
        const { ops } = build();
        const out = await call(index.parseRosterPDF, rosterRequest());

        assert.equal(out.code, 200);
        assert.equal(modelCalls().length, 1, 'the model was asked exactly once');
        assert.equal(out.body.weekEnding, WEEK_ENDING);
        assert.deepEqual(out.body.parsed.map((e) => e.memberName), ['L. Springer']);
        assert.ok(ops.some((o) => o.op === 'verifyIdToken'));
    });

    test('an ordinary member is refused, and the model is never asked', async () => {
        // The commonest holder of a valid token by a wide margin: every member signed in on the
        // app has one, and it is sitting in their browser.
        const { ops } = build({ token: { name: 'L. Springer' } });
        const out = await call(index.parseRosterPDF, rosterRequest());

        assert.equal(out.code, 403);
        assert.deepEqual(modelCalls(), [], 'no API key was spent on the way to the refusal');
        assert.deepEqual(ops.filter((o) => o.op !== 'verifyIdToken'), [],
            'and nothing else happened either');
    });

    test('the shared Calendar PIN token is refused too', async () => {
        // The one that is handed out for four digits at a shared station PC, to anybody who asks.
        // It is a capability with exactly one entry in it, and this endpoint is not that entry.
        build({ token: { calendarViewer: true, uid: CALENDAR_VIEWER_UID } });
        const out = await call(index.parseRosterPDF, rosterRequest());

        assert.equal(out.code, 403);
        assert.deepEqual(modelCalls(), []);
    });

    test('a manager claim is not enough — only admin', async () => {
        // `manager` writes overrides on members' behalf all day, so it is the tier most plausibly
        // mistaken for "senior enough". It has no business spending the AI key.
        build({ token: { manager: true, name: 'S. Stewart' } });
        const out = await call(index.parseRosterPDF, rosterRequest());

        assert.equal(out.code, 403);
        assert.deepEqual(modelCalls(), []);
    });

    test('a falsy-but-present admin claim is not an admin claim', async () => {
        // The check is `!== true` rather than `!token.admin`, and that is deliberate: a claim set
        // to a truthy string by some future provisioning bug must not read as administration.
        build({ token: { admin: 'yes', name: 'L. Springer' } });
        const out = await call(index.parseRosterPDF, rosterRequest());

        assert.equal(out.code, 403);
        assert.deepEqual(modelCalls(), []);
    });

    test('no bearer token at all is refused before anything is read', async () => {
        const { ops } = build();
        const out = await call(index.parseRosterPDF, rosterRequest({ auth: null }));

        assert.equal(out.code, 401);
        assert.deepEqual(modelCalls(), []);
        assert.deepEqual(ops, [], 'not even a verification attempt — there was nothing to verify');
    });

    test('a token that will not verify is refused', async () => {
        build({ token: null });
        const out = await call(index.parseRosterPDF, rosterRequest());

        assert.equal(out.code, 401);
        assert.deepEqual(modelCalls(), []);
    });

    test('the token is checked for REVOCATION, not merely for signature', async () => {
        // A leaver's — or a compromised admin's — ID token stays cryptographically valid for up to
        // an hour after the account is disabled. checkRevoked is the difference between "was an
        // admin" and "is an admin" on the one endpoint that spends money.
        const { ops } = build();
        await call(index.parseRosterPDF, rosterRequest());

        assert.equal(ops.find((o) => o.op === 'verifyIdToken').checkRevoked, true);
    });

    test('a refusal never reveals what the upload was', async () => {
        // A 403 that echoed the roster type or the week back would turn a refused call into a
        // probe of what the endpoint accepts. It says one thing and stops.
        build({ token: { name: 'L. Springer' } });
        const out = await call(index.parseRosterPDF, rosterRequest());
        assert.deepEqual(Object.keys(out.body), ['error']);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// unlockCalendarViewer — the cost is the whole roster, against a secret with 10,000 values in it
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('an UNCOUNTED guess is never answered (rule 5)', () => {
    // Both of these failed OPEN until an external review at v20.45, on the argument that refusing
    // access while Firestore struggles locks the station out. The argument that won is that the
    // roster lives in the same Firestore — so the availability being protected did not exist —
    // while the throttle is the only thing between 10,000 guesses and the whole roster.
    //
    // Each is a bare `catch` around a return, which is the easiest thing in this file to delete by
    // accident and the hardest to notice: the endpoint goes on working perfectly.

    test('a throttle store that cannot be READ refuses, even for the right PIN', async () => {
        const { ops, writes } = build({ failRead: true });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 503, 'a PIN that cannot be rate-limited is not compared');
        assert.equal(minted(ops), undefined, 'and no token is handed out on a path it could not verify');
        assert.deepEqual(writes, [], 'nothing was recorded either — the store is the thing that is down');
    });

    test('a failure that cannot be RECORDED refuses too, rather than answering 401', async () => {
        // The subtle one. 401 here is correct about the PIN and catastrophic as a policy: a caller
        // who can induce write failures guesses for ever without spending a single unit of the
        // budget the transaction exists to charge.
        const { writes } = build({ failTx: true });
        const out = await call(index.unlockCalendarViewer, pinRequest(WRONG_PIN));

        assert.equal(out.code, 503);
        assert.notEqual(out.code, 401, 'the guess went uncounted, so it does not get an answer');
        assert.deepEqual(writes, [], 'and by definition nothing was charged');
    });

    test('503 tells the caller nothing about whether the PIN was right', async () => {
        // Rule 2, applied to the failure path: the two 503s must be indistinguishable, or the
        // outage becomes an oracle.
        build({ failTx: true });
        const wrong = await call(index.unlockCalendarViewer, pinRequest(WRONG_PIN));
        build({ failRead: true });
        const right = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(wrong.code, 503);
        assert.equal(right.code, 503);
        assert.deepEqual(wrong.body, right.body, 'one message, whichever stage fell over');
    });

    test('a failed SWEEP, by contrast, changes nothing', async () => {
        // The opposite direction, and the reason the two catches are not interchangeable: the
        // opportunistic cleanup is best-effort housekeeping the member has already earned an
        // answer past. Turning it into a 503 would make a full collection look like an outage.
        const { writes } = build({ failSweep: true });
        const out = await call(index.unlockCalendarViewer, pinRequest(WRONG_PIN));

        assert.equal(out.code, 401, 'the answer the attempt earned');
        assert.equal(writes.length, 2, 'and the failure was still charged to both buckets');
    });
});

describe('both ceilings hold, and the all-sources one is the backstop', () => {
    // The per-source key is derived from a forwarding header. It is derived from the END of it,
    // because a caller can only PREPEND — but the whole per-source scheme still rests on
    // attribution being right, and v20.35 added a ceiling that does not.

    test('a blocked source is refused before its guess is compared', async () => {
        const { ops } = build({ seed: { [STATION_KEY]: blockedBucket() } });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 429);
        assert.ok(Number(out.headers['Retry-After']) > 0, 'and told when to come back');
        assert.equal(minted(ops), undefined, 'a blocked source gets no token even with the right PIN');
    });

    test('the ALL-SOURCES ceiling blocks a source whose own bucket is spotless', async () => {
        // The whole point of the second bucket. Delete the one line that consults it and this is
        // the only case in the file that changes: a caller manufacturing a fresh source identity
        // per request has an unbounded supply of clean per-source buckets, and nothing else here
        // would notice.
        const { ops, store } = build({ seed: { [GLOBAL_SOURCE_KEY]: blockedBucket() } });
        assert.equal(store.has(STATION_KEY), false, 'this source has never failed');

        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 429, 'the ceiling is a ceiling, not an average');
        assert.equal(minted(ops), undefined);
    });

    test('a wrong PIN charges BOTH buckets in one transaction', async () => {
        // Either `tx.set` could be dropped and the endpoint would keep working; the per-source one
        // going would disarm the limit staff actually meet, the global one going would disarm the
        // backstop silently and for ever, since nothing normal ever reaches it.
        const { writes } = build();
        const out = await call(index.unlockCalendarViewer, pinRequest(WRONG_PIN));

        assert.equal(out.code, 401);
        assert.deepEqual(writes.map((w) => w.id).sort(), [STATION_KEY, GLOBAL_SOURCE_KEY].sort());
        for (const w of writes) assert.equal(w.data.failures, 1, 'each bucket counted the one attempt');
    });

    test('a correct PIN writes NOTHING (rule 3)', async () => {
        // Two properties in one: the normal path stays free of writes, and the collection can never
        // be read as a record of who opened the roster and when.
        const { writes, deletes } = build();
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 200);
        assert.deepEqual(writes, []);
        assert.deepEqual(deletes, []);
    });
});

describe('the token is the entire product, and a claimless one is indistinguishable', () => {
    // v20.50 is the standing lesson and it lived exactly here: the endpoint was signed off on a
    // GET→405 and a wrong PIN→401, and neither reaches this code. A token minted without its
    // claim signs in perfectly, and then every override read is denied — so the symptom is an
    // unlocked Calendar with no shifts on it and nothing in the console to say why.

    test('a correct PIN mints a token CARRYING the viewer claim', async () => {
        const { ops } = build();
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 200);
        assert.equal(out.body.token, 'custom-token-value');
        const mint = minted(ops);
        assert.equal(mint.uid, CALENDAR_VIEWER_UID);
        assert.deepEqual(mint.claims, { calendarViewer: true },
            'the claims are baked into the custom token — there is no retry net on the first read');
    });

    test('and the claim set carries none of the privileged ones, by name', async () => {
        const { ops } = build();
        await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        const mint = minted(ops);

        for (const forbidden of ['name', 'admin', 'manager', 'linksDesigner']) {
            assert.equal(forbidden in mint.claims, false, `the viewer token must not carry ${forbidden}`);
        }
        assert.deepEqual(Object.keys(mint.claims), ['calendarViewer'], 'exactly one capability');
    });

    test('the account\'s claims are RE-APPLIED on every unlock, not trusted from history', async () => {
        // `setCustomUserClaims` replaces the whole set, so this is what guarantees the shared
        // account cannot accumulate a claim by any route and keep it.
        const { ops } = build({ viewerExists: true });
        await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        const applied = ops.find((o) => o.op === 'setCustomUserClaims');
        assert.deepEqual(applied, { op: 'setCustomUserClaims', uid: CALENDAR_VIEWER_UID, claims: { calendarViewer: true } });
        assert.deepEqual(ops.filter((o) => o.op === 'createUser'), [], 'an existing account is not recreated');
    });

    test('a missing viewer account is created on the spot, with no email and no password', async () => {
        // It is a capability, not a person — and an emailless account is invisible to the two
        // places that enumerate staff, which is why neither the orphan sweep nor the sign-in
        // statistics ever see it.
        const { ops } = build({ viewerExists: false });
        await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        const made = ops.find((o) => o.op === 'createUser');
        assert.equal(made.props.uid, CALENDAR_VIEWER_UID);
        assert.equal('email' in made.props, false);
        assert.equal('password' in made.props, false);
    });

    test('a mint that fails hands out nothing (rule 4)', async () => {
        const { ops } = build({ authFail: { createCustomToken: 'IAM not configured' } });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 500);
        assert.equal(out.body.token, undefined);
        assert.ok(minted(ops), 'it was attempted — this is the failure path, not the refusal one');
    });
});

describe('a deployment fault is not a wrong PIN', () => {
    // v20.39, audit §31. A secret set to five digits by a slipped keystroke can never match a
    // four-digit entry, so without this guard every member at the station is told their PIN is
    // wrong — the one symptom that leads nowhere near the cause, and the one that would have the
    // whole shift hunting for a code that cannot work.

    test('an unconfigured secret is a 503, and charges nobody', async () => {
        const { writes, ops } = build({ pin: '' });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 503);
        assert.notEqual(out.code, 401);
        assert.equal(minted(ops), undefined);
        assert.deepEqual(writes, [], 'our own misconfiguration must not spend the station\'s budget');
    });

    test('a MALFORMED secret is a 503 as well — the gap the audit found', async () => {
        // Five digits. Every entry at the station is four, so every one of them would be answered
        // "PIN not recognised" by a handler that only checked for emptiness.
        const { writes } = build({ pin: '12345' });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 503);
        assert.deepEqual(writes, []);
    });

    test('a non-numeric secret is malformed too', async () => {
        const { writes } = build({ pin: 'abcd' });
        const out = await call(index.unlockCalendarViewer, pinRequest('abcd'));

        assert.equal(out.code, 503, 'even an entry that MATCHES it must not be let through');
        assert.deepEqual(writes, []);
    });

    test('a secret of nothing but whitespace is unconfigured, not a PIN', async () => {
        const { writes } = build({ pin: '   ' });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 503);
        assert.deepEqual(writes, []);
    });
});

describe('the endpoint tells a guesser nothing (rules 1 and 2)', () => {
    test('wrong SHAPE and wrong VALUE are the same answer', async () => {
        // Or the endpoint becomes an oracle for the PIN's length, which is four of the ten
        // thousand combinations' worth of work done for free.
        build();
        const badShape = await call(index.unlockCalendarViewer, pinRequest('7'));
        build();
        const badValue = await call(index.unlockCalendarViewer, pinRequest(WRONG_PIN));
        build();
        const notAPin  = await call(index.unlockCalendarViewer, pinRequest(undefined));

        assert.equal(badShape.code, 401);
        assert.equal(badValue.code, 401);
        assert.equal(notAPin.code, 401);
        assert.deepEqual(badShape.body, badValue.body);
        assert.deepEqual(badValue.body, notAPin.body);
    });

    test('no response ever echoes the submitted PIN', async () => {
        build();
        const rejected = await call(index.unlockCalendarViewer, pinRequest(WRONG_PIN));
        assert.equal(JSON.stringify(rejected.body).includes(WRONG_PIN), false);

        build();
        const accepted = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(JSON.stringify(accepted.body).includes(FIXTURE_PIN), false);
        assert.deepEqual(Object.keys(accepted.body), ['token'],
            'and the success body is the minimum the client needs — no claims echo, no uid');
    });

    test('the response carrying a credential is never cached', async () => {
        build();
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(out.headers['Cache-Control'], 'no-store');
    });

    test('a GET is refused without touching the throttle store', async () => {
        const { reads, writes } = build();
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN, { method: 'GET' }));

        assert.equal(out.code, 405);
        assert.deepEqual(reads, []);
        assert.deepEqual(writes, []);
    });
});
