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
                    // The content blocks are recorded, not discarded — "a harness that discards is
                    // a harness that cannot see" (CLAUDE.md). Without this nothing could assert
                    // WHICH input the model was handed, and the geometry path's whole guarantee is
                    // that it is handed cells rather than the PDF. The base64 document body is
                    // dropped on the way in: its TYPE is the fact worth keeping, and storing a few
                    // hundred KB per call is not.
                    const blocks = ((body && body.messages && body.messages[0] || {}).content || [])
                        .map(b => ({ type: b.type, text: b.type === 'text' ? b.text : undefined }));
                    AI.calls.push({ kind: 'create', model: body && body.model, blocks });
                    if (AI.throws) throw new Error(AI.throws);
                    return { content: [{ type: 'text', text: AI.reply }] };
                },
            };
        }
    },
});

// ── FORCING THE GEOMETRY PATH (v24.12) ─────────────────────────────────────────────────────────
//
// `parseRosterPDF` has TWO paths and only one of them was ever executed here. The fixture PDF below
// is deliberately unopenable, so the geometry read fails OPEN and every existing case runs the
// legacy path — which is why v24.04 could ship a coordinator that rejected every geometry-path
// upload with "The AI returned an unexpected format" and leave all ~3,000 tests green.
//
// Taking the real path needs a real roster PDF, and those are staff data that must never enter this
// repository. So the one input that decides the path — `buildCellTable`'s answer — is stubbed, and
// NOTHING else is: the handler, its validation, `buildSafeEntries`, the cross-checks and the witness
// all run for real. `GEO.usable` is flipped per test and restored in a `finally`.
const REAL_ROSTER_PROMPT = require('./functions/roster-prompt.js');
const GEO = { usable: false, real: false };
const GEO_ROW = {
    memberName: 'L. Springer',
    cells: ['', '05:30-11:30', 'RD', 'RD', '05:30-11:30', 'RD', 'RD'],
};
stub(require.resolve('./roster-prompt', { paths: [fnDir] }), {
    ...REAL_ROSTER_PROMPT,
    // `GEO.real` hands the call straight back to the REAL implementation, which is what the
    // full-path test below uses: with a genuinely openable PDF in the request, `extractRosterGeometry`,
    // `awaitGeometryWithin` and `buildCellTable` then ALL run for real, and the stub's shape stops
    // being something this file asserts about itself. See the "end to end" block at the bottom.
    buildCellTable: (geometry, memberNames) => (GEO.real
        ? REAL_ROSTER_PROMPT.buildCellTable(geometry, memberNames)
        : GEO.usable
            ? { usable: true, rows: [GEO_ROW], unmatched: [], reason: '' }
            : { usable: false, rows: [], unmatched: ['forced'], reason: 'forced off for the legacy-path cases' }),
});

import { rosterPage, buildPdf, DATES } from './test-fixtures/roster-pdf.mjs';

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
    /** Transactions run one at a time, as Firestore's serialisable transactions behave to the caller:
     *  without this, concurrent requests would interleave inside "one" transaction and a test of the
     *  concurrent-guess race could not tell a fixed handler from a broken one. */
    let txChain = Promise.resolve();
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
            const run = txChain.then(() => fn({
                get: async (ref) => {
                    reads.push(`tx:${ref.id}`);
                    if (failRead) throw boom('unavailable');
                    return snap(ref.id);
                },
                set: (ref, data) => { writes.push({ id: ref.id, data }); store.set(ref.id, data); },
                delete: (ref) => { writes.push({ id: ref.id, data: null }); store.delete(ref.id); },
            }));
            txChain = run.catch(() => {});
            return run;
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
            // `viewerExists` may be the RECORD itself, for the cases where a PIN holder changed it.
            if (viewerExists) return typeof viewerExists === 'object' ? { uid, ...viewerExists } : { uid };
            throw Object.assign(new Error('no such user'), { code: 'auth/user-not-found' });
        },
        // `authFail.deleteUser` / `.createUser` are Firebase error CODES — the races a concurrent
        // unlock produces (the other request deleted, or recreated, the account first).
        deleteUser: async (uid) => { ops.push({ op: 'deleteUser', uid }); if (authFail.deleteUser) throw Object.assign(new Error('x'), { code: authFail.deleteUser }); },
        createUser: async (props) => { ops.push({ op: 'createUser', props }); if (authFail.createUser) throw Object.assign(new Error('x'), { code: authFail.createUser }); return { uid: props.uid }; },
        updateUser: async (uid, props) => { ops.push({ op: 'updateUser', uid, props }); if (authFail.updateUser) throw new Error(authFail.updateUser); return { uid }; },
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
        // (The read is inside the charging transaction since the Sep 2026 review, so this is the
        // transaction failing on its read — the answer must not change.)
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

    test('a correct PIN leaves NOTHING behind (rule 3) — charged first, then refunded', async () => {
        // Since the Sep 2026 review every attempt is charged BEFORE the compare, so a right PIN is
        // charged too — and refunded. A refund to zero DELETES the row: the collection can still
        // never be read as a record of who opened the roster and when.
        const { writes, deletes, store } = build();
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));

        assert.equal(out.code, 200);
        assert.deepEqual(writes.filter((w) => w.data).map((w) => w.id).sort(), [STATION_KEY, GLOBAL_SOURCE_KEY].sort(),
            'the attempt was charged before it was compared');
        assert.equal(store.has(STATION_KEY), false, 'and refunded: no row dates the unlock');
        assert.equal(store.has(GLOBAL_SOURCE_KEY), false);
        assert.deepEqual(deletes, [], 'no sweep on the success path');
    });

    test('a correct PIN refunds only its OWN charge — earlier failures stay counted', async () => {
        const { store } = build({ seed: { [STATION_KEY]: { failures: 5, windowStart: Date.now() - 1000, blockedUntil: 0 } } });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(out.code, 200);
        assert.equal(store.get(STATION_KEY).failures, 5);
    });

    test('a correct PIN whose charge reached the limit does not leave the station blocked', async () => {
        const { store } = build({ seed: { [STATION_KEY]: { failures: 29, windowStart: Date.now() - 1000, blockedUntil: 0 } } });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(out.code, 200, 'the attempt that reaches the limit is still compared');
        assert.equal(store.get(STATION_KEY).failures, 29);
        assert.equal(store.get(STATION_KEY).blockedUntil, 0, 'the block its own charge tripped is lifted with the refund');
    });

    test('CONCURRENT guesses cannot all be compared before any is counted (Sep 2026 review)', async () => {
        // One guess left in the window. Five requests arrive together. The old handler read the
        // bucket with a plain get before comparing and charged afterwards, so all five read "not
        // blocked" and all five had their guess compared — the limit bounded the rate of CHARGING,
        // not the number of guesses. Charged inside the transaction that checks, only one gets in.
        build({ seed: { [STATION_KEY]: { failures: 29, windowStart: Date.now() - 1000, blockedUntil: 0 } } });
        const outs = await Promise.all(Array.from({ length: 5 }, () => call(index.unlockCalendarViewer, pinRequest(WRONG_PIN))));
        const codes = outs.map((o) => o.code).sort();
        assert.deepEqual(codes, [401, 429, 429, 429, 429], `five concurrent guesses were answered ${codes}`);
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

    test('a viewer account somebody LINKED a way in to is rebuilt from nothing (Sep 2026 review)', async () => {
        // Any PIN holder can link an email/password to the shared account from their own session.
        // A password sign-in on it would otherwise carry the viewer claim past every PIN rotation.
        for (const tampered of [
            { email: 'someone@myb-roster.local', providerData: [{ providerId: 'password' }] },
            { phoneNumber: '+447700900123', providerData: [] },
            { disabled: true, providerData: [] },
        ]) {
            const { ops } = build({ viewerExists: tampered });
            const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
            assert.equal(out.code, 200, JSON.stringify(tampered));
            const i = (op) => ops.findIndex((o) => o.op === op);
            assert.ok(i('deleteUser') > -1, `not rebuilt: ${JSON.stringify(tampered)}`);
            assert.ok(i('createUser') > i('deleteUser'), 'recreated after the delete');
            assert.ok(i('createCustomToken') > i('createUser'), 'and only then is a token minted');
            assert.deepEqual(ops.find((o) => o.op === 'createUser').props, { uid: CALENDAR_VIEWER_UID, disabled: false });
        }
    });

    test('a rebuild that RACES a concurrent unlock still unlocks (Sep 2026 re-review)', async () => {
        // Two right PINs arriving together both see the tampered account: one deletes and recreates
        // it, and the other's delete finds nothing (user-not-found) or its create finds it already
        // back (uid-already-exists). Either way the account is what the rebuild wanted, so the second
        // member must not be told "Could not unlock" for a race they could not see.
        for (const authFail of [{ deleteUser: 'auth/user-not-found' }, { createUser: 'auth/uid-already-exists' }]) {
            const { ops } = build({ viewerExists: { disabled: true, providerData: [] }, authFail });
            const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
            assert.equal(out.code, 200, `a concurrent rebuild refused the unlock: ${JSON.stringify(authFail)}`);
            assert.ok(minted(ops), 'no token minted');
        }
        // A create that races the FIRST-ever unlock (no account yet) is the same case.
        const { ops } = build({ viewerExists: false, authFail: { createUser: 'auth/uid-already-exists' } });
        assert.equal((await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN))).code, 200);
        assert.ok(minted(ops), 'no token minted');
    });

    test('any OTHER rebuild failure still fails closed', async () => {
        for (const authFail of [{ deleteUser: 'auth/internal-error' }, { createUser: 'auth/internal-error' }]) {
            const { ops } = build({ viewerExists: { disabled: true, providerData: [] }, authFail });
            const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
            assert.equal(out.code, 500, JSON.stringify(authFail));
            assert.equal(minted(ops), undefined);
        }
    });

    test('an untouched viewer account is NOT rebuilt', async () => {
        const { ops } = build({ viewerExists: { providerData: [], disabled: false } });
        await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.deepEqual(ops.filter((o) => o.op === 'deleteUser' || o.op === 'createUser'), []);
    });

    test('a claims stamp that fails still refuses — only the name clear is best-effort', async () => {
        const { ops } = build({ viewerExists: true, authFail: { setCustomUserClaims: 'boom' } });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(out.code, 500);
        assert.equal(minted(ops), undefined);
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
        // …and NO display name (v24.23): Firebase copies it into every token's `name`, which is the
        // field member rules key on. The old label made every PIN session look like a named member.
        assert.equal('displayName' in made.props, false, 'the viewer account must not be created with a display name');
    });

    test('every unlock CLEARS the shared account\'s display name (v24.23)', async () => {
        // A PIN holder can rename this shared account from their own session; before v24.23 that
        // name reached every later PIN token. Clearing it on each unlock means one holder's choice
        // cannot outlive their own session.
        const { ops } = build({ viewerExists: true });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(out.code, 200);
        const cleared = ops.find((o) => o.op === 'updateUser');
        assert.ok(cleared, 'the unlock did not touch the account\'s profile');
        assert.equal(cleared.uid, CALENDAR_VIEWER_UID);
        assert.deepEqual(cleared.props, { displayName: null });
    });

    test('a failed display-name clear does NOT refuse a right PIN (v24.26)', async () => {
        // The rules stopped believing this field at v24.23, so it is housekeeping. Inside the 500 it
        // turned a transient Admin SDK error into a locked-out Calendar for somebody with the PIN.
        const { ops } = build({ viewerExists: true, authFail: { updateUser: 'transient' } });
        const out = await call(index.unlockCalendarViewer, pinRequest(FIXTURE_PIN));
        assert.equal(out.code, 200);
        assert.ok(out.body.token, 'the unlock still hands out its token');
        assert.ok(ops.some((o) => o.op === 'updateUser'), 'the clear was still attempted');
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


// ── THE GEOMETRY PATH, EXECUTED (v24.12) ───────────────────────────────────────────────────────
//
// The reply below is EXACTLY what `buildCellPrompt`'s own OUTPUT FORMAT block asks the model for:
// `parsed` alone, keyed by full day names, with no `columnHeaders`, `columnScan` or `sundayScan` —
// because on this path the grid already decided the day and there was no table to read headers off.
// Before v24.12 the coordinator required `columnHeaders` unconditionally and answered this with a
// 502, so phase 2 could not succeed on any real upload: the better the grid read, the more certain
// the failure.
describe('parseRosterPDF — the geometry path', () => {
    const GEOMETRY_REPLY = JSON.stringify({
        parsed: [{
            memberName: 'L. Springer',
            Sunday: 'BLANK', Monday: '05:30-11:30', Tuesday: 'RD', Wednesday: 'RD',
            Thursday: '05:30-11:30', Friday: 'RD', Saturday: 'RD',
        }],
    });

    /** Run one request with the geometry path forced on, and always put it back. */
    const onGeometryPath = async (opts = {}) => {
        GEO.usable = true;
        try {
            build({ aiReply: GEOMETRY_REPLY, ...opts });
            return await call(index.parseRosterPDF, rosterRequest());
        } finally {
            GEO.usable = false;
        }
    };

    test('a reply carrying no columnHeaders is ACCEPTED — the grid supplied the days', async () => {
        const out = await onGeometryPath();
        assert.equal(out.code, 200,
            `the geometry path was rejected (${out.code}: ${JSON.stringify(out.body)}) — the `
            + 'coordinator is requiring something buildCellPrompt never asks the model for');
    });

    test('and the days land where the GRID put them, not where a header row would', async () => {
        const out = await onGeometryPath();
        const row = (out.body.parsed || []).find(e => e.memberName === 'L. Springer');
        assert.ok(row, `no L. Springer in the response: ${JSON.stringify(out.body).slice(0, 300)}`);
        // Sunday is the week's first date and was BLANK; Monday carries the duty. A one-day drift
        // — the defect the whole geometry programme exists to remove — moves the duty to Sunday.
        assert.equal(row.shifts['2026-08-30'], 'RD', 'Sunday BLANK should resolve to a rest day');
        assert.equal(row.shifts['2026-08-31'], '05:30-11:30', 'Monday should carry the duty');
    });

    test('the model is sent the CELLS and never the PDF — it must not re-read the table', async () => {
        await onGeometryPath();
        const blocks = modelCalls().at(-1).blocks;
        assert.ok(blocks.length > 0, 'the harness recorded no content blocks');
        assert.ok(blocks.some(b => b.type === 'text' && b.text.includes('ALREADY been separated into cells')),
            'the cell prompt was not the input — the geometry path sent something else');
        assert.ok(!blocks.some(b => b.type === 'document'),
            'the PDF was attached on the geometry path — the model can re-read the table and '
            + 'undo the grid\'s day assignment, which is the one thing this path exists to prevent');
    });

    test('a grid-placed read is not flagged as "couldn\'t be double-checked" (v24.23)', async () => {
        // The cell prompt asks for no column re-read, so the cross-check never runs on this path —
        // and 'unavailable' made the review tell the admin to double-check every day by hand on the
        // one path where the PDF's own grid placed each of them.
        const out = await onGeometryPath();
        assert.equal(out.body.crossCheck, 'not-applicable');
    });

    test('the LEGACY path still requires columnHeaders — the guard was narrowed, not removed', async () => {
        build({ aiReply: JSON.stringify({ parsed: [PARSED_ROW] }) });   // GEO.usable stays false
        const out = await call(index.parseRosterPDF, rosterRequest());
        assert.equal(out.code, 502,
            'a legacy-path reply with no columnHeaders was accepted — there IS a header row on that '
            + 'path and nothing else decides the day');
    });
});

// ── END TO END: A REAL PDF, THE REAL EXTRACTOR, THE REAL HANDLER (v24.15) ───────────────────────
//
// Asked for by name in the v24.14 external review, and it closes a seam the block above cannot.
//
// Everything so far proves ONE HALF each. `roster-geometry.test.mjs` drives a hand-built PDF
// through the real `pdfjs` and proves the ADAPTER reads a drawn grid. The geometry-path tests above
// stub `buildCellTable` and prove the COORDINATOR behaves once a grid is usable. Neither asks
// whether the two AGREE — and a stub returning a shape the real extractor never produces leaves
// both green with the wiring broken.
//
// That is not hypothetical. It is exactly what v24.12 had to fix: phase 2 geometry was present and
// the coordinator rejected every document it placed, because it still demanded `columnHeaders` the
// cell prompt does not ask the model for. Roughly 3,000 tests passed throughout.
//
// So here nothing between the HTTP boundary and the model is stubbed: `extractRosterGeometry` opens
// a real PDF with real pdfjs, `awaitGeometryWithin` races it, and the REAL `buildCellTable` matches
// real roster names against the rows it found. Only the model is faked, because it must be.
//
// THE PDF CARRIES THE WHOLE CEA ROSTER, and it has to. `buildCellTable` is all-or-nothing per
// document — a single unplaced member makes it `usable: false` — so a two-row fixture would take
// the legacy path and quietly test nothing. The names are read from `roster-members.json` at run
// time rather than typed here, so the fixture tracks the roster instead of rotting against it.
describe('end to end: a real PDF through the real extractor and the real handler', () => {
    const CEA = require('./functions/roster-members.json').cea;

    /** Every CEA on one page. Sunday is left PHYSICALLY EMPTY for the first member. */
    const rowsFor = (names) => [
        ['Sunday', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        ...names.map((n, i) => i === 0
            ? [n, '', 'RD', '06:20-14:20', '06:20-14:20', 'RD', '07:00-16:00', '07:00-15:00']
            : [n, '08:00-16:00', 'RD', 'RD', '08:00-16:00', '08:00-16:00', '08:00-16:00', '08:00-16:00']),
    ];

    // 26 bands have to fit between the vertical rules (y 100..800), so the rows are shorter than
    // the 50pt the two-row fixtures use. The extractor reads bands, not a fixed height.
    const realPdf = () => buildPdf([rosterPage(rowsFor(CEA), { top: 800, rowH: 25 })]);

    /** A model reply that echoes the cells back, keyed by the full day names the cell table stamps. */
    const replyFor = (names) => JSON.stringify({
        parsed: names.map((n, i) => (i === 0
            ? { memberName: n, Sunday: 'BLANK', Monday: 'RD', Tuesday: '06:20-14:20', Wednesday: '06:20-14:20', Thursday: 'RD', Friday: '07:00-16:00', Saturday: '07:00-15:00' }
            : { memberName: n, Sunday: '08:00-16:00', Monday: 'RD', Tuesday: 'RD', Wednesday: '08:00-16:00', Thursday: '08:00-16:00', Friday: '08:00-16:00', Saturday: '08:00-16:00' })),
    });

    /** One request with the REAL extractor in the loop, always put back. */
    const throughRealGeometry = async () => {
        GEO.real = true;
        try {
            build({ aiReply: replyFor(CEA) });
            const req = rosterRequest();
            req.rawBody = Buffer.from(realPdf().toString('base64'), 'utf8');
            return await call(index.parseRosterPDF, req);
        } finally {
            GEO.real = false;
        }
    };

    test('the real grid places every roster row, and the handler accepts it', async () => {
        const out = await throughRealGeometry();
        assert.equal(out.code, 200,
            `the real geometry path was rejected (${out.code}: ${JSON.stringify(out.body).slice(0, 400)}). `
            + 'Either the extractor is no longer placing every row, or the coordinator is demanding '
            + 'something buildCellPrompt does not ask the model for — the v24.12 defect.');
    });

    test('and the model was sent CELLS, which is the proof the real path was taken', async () => {
        await throughRealGeometry();
        const blocks = modelCalls().at(-1).blocks;
        assert.ok(blocks.some(b => b.type === 'text' && b.text.includes('ALREADY been separated into cells')),
            'the cell prompt was not used — the real extractor fell back to the legacy path, so this '
            + 'whole block silently stopped testing what it claims to');
        assert.ok(!blocks.some(b => b.type === 'document'),
            'the PDF was attached as well: on the geometry path the model must not re-read the table');
    });

    test('a physically EMPTY Sunday resolves to a rest day, and Monday keeps its own cell', async () => {
        const out = await throughRealGeometry();
        const row = (out.body.parsed || []).find(e => e.memberName === CEA[0]);
        assert.ok(row, `no ${CEA[0]} in the response: ${JSON.stringify(out.body).slice(0, 300)}`);
        // The one-day drift this programme exists to remove would move the duty onto Sunday.
        assert.equal(row.shifts[DATES[0]], 'RD', 'the blank Sunday should resolve to a rest day');
        assert.equal(row.shifts[DATES[1]], 'RD', 'Monday should keep its own cell');
        assert.equal(row.shifts[DATES[2]], '06:20-14:20', 'Tuesday should carry the duty');
    });
});

// ── The Sunday repair, through the handler (v24.28 review) ─────────────────────────────────────
//
// `settleDisputedSundays` is a SECOND call placed after the witness, so the helper tests cannot see
// the wiring: delete the call and every one of them stays green. These drive the legacy path (the
// fake PDF fails the grid open, so the witness does not run) and assert on the days RETURNED.
describe('parseRosterPDF: a left-shifted row is repaired or sent to review, never written a day out', () => {
    const SUN = '2026-08-30';
    const reply = (row) => JSON.stringify({ columnHeaders: DAY_HEADERS, parsed: [{ memberName: 'L. Springer', ...row }],
        sundayScan: { 'L. Springer': 'BLANK' } });
    const DRIFTED = { Sun: '05:30-11:30', Mon: 'RD', Tue: 'RD', Wed: '05:30-11:30', Thu: 'RD', Fri: 'RD' };

    test('an empty Saturday reported as BLANK is the trailing slot — the week is realigned', async () => {
        build({ aiReply: reply({ ...DRIFTED, Sat: 'BLANK' }) });
        const out = await call(index.parseRosterPDF, rosterRequest());
        assert.equal(out.code, 200);
        const s = out.body.parsed[0].shifts;
        assert.deepEqual(['2026-08-30', '2026-08-31', '2026-09-03', '2026-09-05'].map(d => s[d]),
            ['RD', '05:30-11:30', '05:30-11:30', 'RD']);
    });

    test('an occupied Saturday leaves Sunday a QUESTION when the grid could not look at it', async () => {
        build({ aiReply: reply({ ...DRIFTED, Sat: '06:00-14:00' }) });
        const out = await call(index.parseRosterPDF, rosterRequest());
        assert.equal(out.code, 200);
        assert.match(out.body.parsed[0].shifts[SUN], /^UNKNOWN\|05:30-11:30 was read for Sunday/,
            'a disputed Sunday the witness did not check must reach the admin, not be written either way');
    });
});
