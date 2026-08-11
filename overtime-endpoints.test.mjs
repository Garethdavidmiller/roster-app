/**
 * overtime-endpoints.test.mjs — the Overtime endpoints, actually EXECUTED.
 * Run with: npm run test:functions   (needs firebase-admin/firebase-functions from functions/node_modules)
 *
 * ── WHY THIS EXISTS, SPECIFICALLY ───────────────────────────────────────────────────────────────
 * v20.50 is the standing lesson: `unlockCalendarViewer` was dark-deployed, signed off on a GET→405
 * and a wrong-PIN→401, and neither of those reaches `createCustomToken` — so the minting path had
 * never run in production, and it 500'd the moment a real PIN arrived. `functions-surface.test.mjs`
 * would not have caught it either: it loads the module and reads `Object.keys`, which proves the
 * handlers were DEFINED, not that any of them works.
 *
 * So this suite drives each handler end to end against a fake Firestore and a fake token verifier.
 * Everything between the HTTP boundary and the database is real code: the auth ladder, the phase
 * decision, the batch, the transaction, the conflict payload.
 *
 * ORGANISED BY WHAT GOES WRONG. Each block is a way this layer can be broken while every pure test
 * in overtime-core.test.mjs stays green — because the rules being right is not the same as the
 * orchestration calling them.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const OT = require('./functions/overtime-core.js');

// ── Fake boundaries ─────────────────────────────────────────────────────────────────────────────

/** A fixed instant the fake server timestamp resolves to, so revisions have a readable acceptedAt. */
const SERVER_NOW = Date.parse('2026-08-17T09:00:00Z');

/**
 * Minimal Firestore: paths → data, with the four shapes this module uses.
 *
 * `onRead` wraps EVERY collection read, however it was reached. Instrumenting `db.collection` from
 * outside does not work — `windowCounts` reaches its subcollections through a DOC ref, so an
 * external wrapper sees only the one top-level read and reports a concurrency of 1 for code that
 * is fully parallel. That false negative is exactly what this hook exists to prevent.
 */
function makeDb(seed = {}, onRead = null) {
    const store = new Map(Object.entries(seed));
    const snap = (path) => ({
        id: path.split('/').pop(),
        exists: store.has(path),
        ref: docRef(path),
        data: () => store.get(path),
    });
    function collRef(path) {
        return {
            path,
            doc: (id) => docRef(`${path}/${id}`),
            get: async () => {
                const done = onRead ? onRead(path) : null;
                // A real read is never synchronous. Yielding is what lets the harness observe
                // overlap at all — without it every "parallel" read resolves before the next starts.
                await new Promise(r => setImmediate(r));
                const prefix = `${path}/`;
                const docs = [...store.keys()]
                    .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                    .sort()
                    .map(snap);
                if (done) done();
                return { docs, size: docs.length };
            },
        };
    }
    function docRef(path) {
        return {
            path,
            id: path.split('/').pop(),
            collection: (name) => collRef(`${path}/${name}`),
            get: async () => snap(path),
            update: async (patch) => { store.set(path, { ...store.get(path), ...patch }); },
            set: async (data, opts) => {
                store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
            },
        };
    }
    return {
        _store: store,
        collection: collRef,
        batch: () => {
            const ops = [];
            return {
                set: (ref, data) => ops.push([ref.path, data]),
                // Commit is all-or-nothing here too, so a test that expects atomicity is testing
                // the same property production relies on rather than a looser fake.
                commit: async () => { for (const [p, d] of ops) store.set(p, d); },
            };
        },
        runTransaction: async (fn) => fn({
            get: async (ref) => snap(ref.path),
            set: (ref, data, opts) => store.set(ref.path,
                opts?.merge ? { ...(store.get(ref.path) || {}), ...data } : data),
            update: (ref, patch) => store.set(ref.path, { ...store.get(ref.path), ...patch }),
        }),
    };
}

/** Install a fake `firebase-admin` into the CommonJS cache before overtime.js requires it. */
function installFakeAdmin(db, tokens) {
    const adminPath = require.resolve('firebase-admin', { paths: [new URL('./functions/', import.meta.url).pathname] });
    const stamp = () => ({ toMillis: () => SERVER_NOW });
    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: stamp };
    firestore.Timestamp  = { fromMillis: (ms) => ({ toMillis: () => ms }) };
    const fake = {
        auth: () => ({
            verifyIdToken: async (token, checkRevoked) => {
                // Revocation checking is MANDATORY here, so the fake refuses to answer without it —
                // a handler that dropped the flag would fail loudly rather than silently accepting
                // an hour-stale token from a disabled account.
                assert.equal(checkRevoked, true, 'verifyIdToken must be called with checkRevoked');
                if (!tokens[token]) throw new Error('invalid token');
                return tokens[token];
            },
        }),
        firestore,
    };
    require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fake };
    return fake;
}

/**
 * Express-ish response capture.
 *
 * Fuller than it looks necessary, and deliberately so: `onRequest` wraps the handler in a Promise
 * that resolves on the response's `finish` event and runs the `cors` middleware first, so a plain
 * `{status, json}` stub throws `res.on is not a function` before a single line of our code runs —
 * which would make this whole suite pass vacuously if it ever silently caught the error.
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
        vary()      { return res; },
        writeHead(c) { out.code = c; return res; },
        end() {
            if (!done) { done = true; process.nextTick(() => res.emit('finish')); }
            return res;
        },
    });
    return { res, out };
}

const req = (body, token = 'tok_member', method = 'POST') => ({
    method,
    headers: { authorization: `Bearer ${token}`, origin: 'https://myb-roster.web.app' },
    body,
    url: '/', path: '/', query: {},
    get(h)    { return this.headers[String(h).toLowerCase()]; },
    header(h) { return this.get(h); },
});

// Identities, mirroring the real claim tiers.
const TOKENS = {
    tok_member:  { name: 'G. Miller', uid: 'uid_g', admin: true },     // rostered Master Admin
    tok_plain:   { name: 'S. Silva',  uid: 'uid_s' },                  // ordinary member
    tok_manager: { name: 'H. Croft',  uid: 'uid_h', manager: true },   // reviewer, not a participant
    tok_viewer:  { uid: 'calendar-viewer', calendarViewer: true },     // the shared PIN identity
};

const ROSTER = {
    maxRosterYear: 2030,
    roles: { admin: ['G. Miller'] },
    overtimeEligibleMembers: [
        { name: 'L. Springer', grade: 'CEA', startDate: null, rosterOrder: 0 },
        { name: 'G. Miller',   grade: 'CEA', startDate: null, rosterOrder: 2 },
        { name: 'S. Silva',    grade: 'CEA', startDate: null, rosterOrder: 5 },
    ],
};

const WEEK = '2026-09-05';
const M = OT.deriveMilestones(WEEK);
const DATES = OT.weekDates(M.weekStart);
const allDay = () => Object.fromEntries(DATES.map(d => [d, { mode: 'all_day' }]));
const noDays = () => Object.fromEntries(DATES.map(d => [d, { mode: 'unavailable' }]));

/** Build the endpoints against a fresh fake world. Returns handlers + the store for assertions. */
function build(seed = {}) {
    const db = makeDb(seed);
    installFakeAdmin(db, TOKENS);
    // Require AFTER the cache injection, and fresh each time, so the module binds the fake.
    delete require.cache[require.resolve('./functions/overtime.js')];
    const { buildOvertimeEndpoints } = require('./functions/overtime.js');
    const eps = buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS: ['https://myb-roster.web.app'], rosterMembers: ROSTER });
    return { db, eps };
}

/** Invoke an onRequest handler and return { code, body }. */
async function call(handler, request) {
    const { res, out } = makeRes();
    await handler(request, res);
    return out;
}

/** A seeded, created window with G. Miller as its single restricted participant. */
function seededWindow(extra = {}) {
    return {
        [`overtimeWindows/${WEEK}`]: {
            weekEnding: WEEK, weekStart: M.weekStart,
            initialDeadlineAt: { toMillis: () => M.initialDeadlineAt },
            draftRosterDate: M.draftRosterDate,
            finalDeadlineAt: { toMillis: () => M.finalDeadlineAt },
            finalRosterDate: M.finalRosterDate,
            retentionUntil: { toMillis: () => M.retentionUntil },
            policyVersion: 1, audience: 'restricted',
        },
        [`overtimeWindows/${WEEK}/participants/G. Miller`]: {
            memberName: 'G. Miller', grade: 'CEA', rosterOrder: 2, uid: null,
        },
        ...extra,
    };
}

// Every test runs against the frozen clock below unless it says otherwise.
let realNow;
beforeEach(() => { realNow = Date.now; });
function freeze(ms) { Date.now = () => ms; }
function unfreeze() { Date.now = realNow; }

describe('the auth ladder — the same four rungs on every endpoint', () => {
    test('a GET is refused before anything else happens', async () => {
        const { eps } = build();
        for (const h of Object.values(eps)) {
            const r = await call(h, req({}, 'tok_member', 'GET'));
            assert.equal(r.code, 405);
        }
    });

    test('an unverifiable token is 401 on every endpoint', async () => {
        const { eps } = build();
        for (const h of Object.values(eps)) {
            assert.equal((await call(h, req({}, 'nonsense'))).code, 401);
        }
    });

    test('the Calendar viewer is refused everywhere, by name', async () => {
        // It holds `calendarViewer` and no `name`, so it falls out with every other non-member —
        // but the v20.12 audit's lesson is that "it obviously has no access" is what turns out to
        // be wrong, so it is asserted rather than inferred.
        const { eps } = build(seededWindow());
        for (const h of Object.values(eps)) {
            assert.equal((await call(h, req({ weekEnding: WEEK }, 'tok_viewer'))).code, 403);
        }
    });

    test('an ordinary member is refused the two reviewer endpoints and allowed the two member ones', async () => {
        const { eps } = build(seededWindow());
        assert.equal((await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }, 'tok_plain'))).code, 403);
        assert.equal((await call(eps.getOvertimeManagerOverview, req({}, 'tok_plain'))).code, 403);
        assert.equal((await call(eps.getMyOvertimeState, req({}, 'tok_plain'))).code, 200);
    });
});

describe('createOvertimeWindow — one code path, previewed or committed', () => {
    test('dryRun previews the exact derivation and writes NOTHING', async () => {
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK, dryRun: true }));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.dryRun, true);
        assert.equal(r.body.window.weekStart, '2026-08-30');
        assert.equal(r.body.window.expectedCount, 1, 'restricted → the admin submitter only');
        assert.equal(db._store.size, 0, 'a preview must leave no trace');
    });

    test('a real create commits the parent and every participant in ONE batch', async () => {
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.body.created, true);
        assert.ok(db._store.has(`overtimeWindows/${WEEK}`));
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/G. Miller`));
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/H. Croft`), false,
            'a manager is a reviewer, never a participant');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/participants/S. Silva`), false,
            'restricted beta excludes ordinary members');
    });

    test('the preview and the committed window agree, field for field', async () => {
        // The entire reason there is no separate preview endpoint. If these ever diverge, a Manager
        // has approved a set of dates and participants that is not what was created.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        const preview = (await call(eps.createOvertimeWindow, req({ weekEnding: WEEK, dryRun: true }))).body.window;
        await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        const stored = db._store.get(`overtimeWindows/${WEEK}`);
        assert.equal(stored.weekStart, preview.weekStart);
        assert.equal(stored.draftRosterDate, preview.draftRosterDate);
        assert.equal(stored.finalRosterDate, preview.finalRosterDate);
        assert.equal(stored.initialDeadlineAt.toMillis(), preview.initialDeadlineAt);
        assert.equal(stored.finalDeadlineAt.toMillis(), preview.finalDeadlineAt);
        assert.equal(stored.audience, preview.audience);
    });

    test('creating the same week twice returns the existing window and does NOT re-freeze it', async () => {
        // Two reviewers pressing Create at once. The frozen participant snapshot is historical
        // truth; a second create that rewrote it would silently rewrite who was asked.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/participants/SOMEONE ELSE`]: { memberName: 'SOMEONE ELSE' },
        }));
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.body.existed, true);
        assert.ok(db._store.has(`overtimeWindows/${WEEK}/participants/SOMEONE ELSE`),
            'the original snapshot must survive a duplicate create');
    });

    test('validation refusals come back as machine codes, before any write', async () => {
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const { db, eps } = build();
        for (const [weekEnding, code] of [['2026-09-04', 'not-saturday'], ['2026-02-30', 'invalid-date'], ['2031-01-04', 'beyond-horizon']]) {
            const r = await call(eps.createOvertimeWindow, req({ weekEnding }));
            assert.equal(r.code, 400);
            assert.equal(r.body.error, code);
        }
        unfreeze();
        assert.equal(db._store.size, 0);
    });

    test('a population beyond the single-batch bound FAILS rather than half-creating a window', async () => {
        // A Firestore batch caps at 500 operations and creation is 1 parent + N participants. Split
        // across two batches, a window can half-exist — and a half-frozen participant population is
        // not a smaller truth, it is a false one that then reports colleagues as non-responders for
        // ever. Contrived at today's roster of ~44, which is the point: the guard has to hold when
        // nobody is thinking about it.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const many = Array.from({ length: OT.MAX_PARTICIPANTS_PER_WINDOW + 1 },
            (_, i) => ({ name: `Member ${i}`, grade: 'CEA', startDate: null, rosterOrder: i }));
        const db = makeDb();
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({
            ADMIN_FUNCTION_ORIGINS: [],
            rosterMembers: { maxRosterYear: 2030, roles: { admin: many.map(m => m.name) }, overtimeEligibleMembers: many },
        });
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.code, 507);
        assert.equal(r.body.error, 'too-many-participants');
        assert.equal(db._store.size, 0, 'and nothing at all was written');
    });

    test('a window with NO participants is refused, not created empty', async () => {
        // An empty window can never receive a submission, and its counts read "0 of 0 received" —
        // which looks like a completed week rather than one nobody was asked about. The realistic
        // cause is the restricted selector finding no admin entitlement, which fails closed by
        // design, so this is where that shows up as something a reviewer can act on.
        freeze(Date.parse('2026-08-01T09:00:00Z'));
        const db = makeDb();
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({
            ADMIN_FUNCTION_ORIGINS: [],
            rosterMembers: { maxRosterYear: 2030, roles: { admin: [] }, overtimeEligibleMembers: ROSTER.overtimeEligibleMembers },
        });
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'no-participants');
        assert.equal(db._store.size, 0);
    });

    test('a week whose final deadline has passed cannot be created', async () => {
        freeze(M.finalDeadlineAt + 1);
        const { eps } = build();
        const r = await call(eps.createOvertimeWindow, req({ weekEnding: WEEK }));
        unfreeze();
        assert.equal(r.body.error, 'final-deadline-passed');
    });
});

describe('getOvertimeManagerOverview — the missing window is the point', () => {
    test('six planning rows come back from an EMPTY database, escalating across the horizon', async () => {
        // The single most important assertion in this file. A horizon built from existing documents
        // can only ever show what exists; the thing worth seeing is what does not.
        //
        // And the states are NOT uniform, which is the part worth pinning: the horizon starts at
        // the CURRENT week, whose deadlines went weeks ago, so a Manager opening a neglected page
        // sees the whole ladder at once — two weeks already missed, one still recoverable, three
        // still ahead. An earlier version of this test asserted all six were 'not-created' and
        // failed, correctly.
        freeze(Date.parse('2026-08-19T09:00:00Z'));   // a Wednesday
        const { eps } = build();
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.planningWeeks.length, 6);
        assert.ok(r.body.planningWeeks.every(w => w.exists === false));
        assert.deepEqual(r.body.planningWeeks.map(w => [w.weekEnding, w.state]), [
            ['2026-08-22', 'missed'],
            ['2026-08-29', 'missed'],
            ['2026-09-05', 'not-created-initial-passed'],
            ['2026-09-12', 'not-created'],
            ['2026-09-19', 'not-created'],
            ['2026-09-26', 'not-created'],
        ]);
    });

    test('a missed week offers no Create, and a recoverable one does', async () => {
        // `canCreate` and `state` are computed separately, so they can disagree — and a Create
        // button on a week the server would refuse is a button that reports a failure the Manager
        // cannot act on.
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const { eps } = build();
        const rows = (await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'))).body.planningWeeks;
        unfreeze();
        const byWeek = Object.fromEntries(rows.map(w => [w.weekEnding, w]));
        assert.equal(byWeek['2026-08-22'].canCreate, false, 'missed → no Create');
        assert.equal(byWeek['2026-09-05'].canCreate, true, 'initial passed but final still open → still creatable');
        assert.equal(byWeek['2026-09-26'].canCreate, true);
    });

    test('an existing week is marked created and carries derived counts', async () => {
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const { eps } = build(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find(w => w.weekEnding === WEEK);
        assert.equal(row.exists, true);
        assert.equal(row.state, 'created');
        assert.equal(row.expected, 1);
        assert.equal(row.received, 0);
        assert.equal(row.noResponse, 1, 'one participant, no submission — no response, not "unavailable"');
    });

    test('counts are DERIVED, so a submission moves them without anything being recalculated', async () => {
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const { eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/submissions/G. Miller`]: { memberName: 'G. Miller', currentRevision: 1, days: allDay() },
        }));
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        const row = r.body.planningWeeks.find(w => w.weekEnding === WEEK);
        assert.equal(row.received, 1);
        assert.equal(row.noResponse, 0);
    });

    test('a created window keeps the milestones it was CREATED with, not freshly derived ones', async () => {
        // The frozen-timetable invariant, at the boundary. A window stored under an older policy
        // must not silently acquire today's dates when a Manager opens the page.
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const odd = seededWindow();
        odd[`overtimeWindows/${WEEK}`].finalRosterDate = '1999-01-01';
        const { eps } = build(odd);
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.body.planningWeeks.find(w => w.weekEnding === WEEK).finalRosterDate, '1999-01-01');
    });

    test('expired windows are omitted from the retained list', async () => {
        freeze(M.retentionUntil + 1);
        const { eps } = build(seededWindow());
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.body.retained.length, 0,
            'behaviour must not depend on whether the purge has run');
    });

    test('per-week counts are fetched in parallel, not one week after another', async () => {
        // Six weeks × two subcollection reads, awaited in a loop, is twelve sequential round trips
        // before a Manager sees anything — for data with no ordering between weeks. The fake
        // records the ORDER reads are ISSUED in: parallel means every read starts before any
        // resolves, which a sequential loop can never produce.
        freeze(Date.parse('2026-08-19T09:00:00Z'));
        const seed = {};
        for (const w of ['2026-08-22', '2026-08-29', '2026-09-05']) {
            seed[`overtimeWindows/${w}`] = { ...seededWindow()[`overtimeWindows/${WEEK}`], weekEnding: w };
            seed[`overtimeWindows/${w}/participants/G. Miller`] = { memberName: 'G. Miller' };
        }
        // MEASURE the concurrency rather than assert the answers — correct counts come out of a
        // sequential loop too, so an assertion on them proves nothing about the thing under test.
        let inFlight = 0, maxInFlight = 0;
        const db = makeDb(seed, () => {
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            return () => { inFlight--; };
        });
        installFakeAdmin(db, TOKENS);
        delete require.cache[require.resolve('./functions/overtime.js')];
        const { buildOvertimeEndpoints } = require('./functions/overtime.js');
        const eps = buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS: [], rosterMembers: ROSTER });
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        const counted = r.body.planningWeeks.filter((/** @type {any} */ w) => w.exists);
        assert.equal(counted.length, 3, 'all three seeded weeks were counted');
        assert.ok(counted.every((/** @type {any} */ w) => w.expected === 1));
        // Each week's own pair is already concurrent, so a sequential OUTER loop peaks at 2.
        // Anything above that can only come from the weeks overlapping each other.
        assert.ok(maxInFlight > 2,
            `reads peaked at ${maxInFlight} concurrent — the weeks are being counted one after another`);
    });

    test('serverNow comes back, because no client clock may decide what is shown', async () => {
        freeze(1234567890);
        const { eps } = build();
        const r = await call(eps.getOvertimeManagerOverview, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.body.serverNow, 1234567890);
    });
});

describe('getMyOvertimeState — the member sees their own windows and nobody else', () => {
    test('a participant gets the window, its phase and their submission', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/submissions/G. Miller`]: {
                memberName: 'G. Miller', currentRevision: 2, days: allDay(),
                updatedAt: { toMillis: () => SERVER_NOW }, lastMutationId: 'abcdefgh', schemaVersion: 1,
            },
        }));
        const r = await call(eps.getMyOvertimeState, req({}));
        unfreeze();
        assert.equal(r.body.windows.length, 1);
        assert.equal(r.body.windows[0].phase, 'INITIAL_OPEN');
        assert.equal(r.body.windows[0].submission.currentRevision, 2);
        assert.equal(r.body.windows[0].participant.grade, 'CEA');
    });

    test('a NON-participant gets an empty list, not an error', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_plain'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.windows, []);
    });

    test('a MANAGER correctly gets an empty list — and that is not a bug to fix', async () => {
        // Managers review; they do not submit. Reinterpreting manager status as participation here
        // would put a personal form in front of somebody who must not have one.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}, 'tok_manager'));
        unfreeze();
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.windows, []);
        assert.equal(typeof r.body.serverNow, 'number', 'but they still get the server clock');
    });

    test('a colleague\'s submission never appears in a member\'s state', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow({
            [`overtimeWindows/${WEEK}/participants/S. Silva`]: { memberName: 'S. Silva', grade: 'CEA', rosterOrder: 5 },
            [`overtimeWindows/${WEEK}/submissions/S. Silva`]: { memberName: 'S. Silva', currentRevision: 1, days: noDays() },
        }));
        const r = await call(eps.getMyOvertimeState, req({}));
        unfreeze();
        assert.equal(JSON.stringify(r.body).includes('S. Silva'), false,
            'no part of a colleague may leak into a member payload');
    });

    test('an expired window is omitted even though the document still exists', async () => {
        freeze(M.retentionUntil + 1);
        const { eps } = build(seededWindow());
        const r = await call(eps.getMyOvertimeState, req({}));
        unfreeze();
        assert.deepEqual(r.body.windows, []);
    });

    test('the phase reported is the SERVER\'s, and it moves as time passes', async () => {
        const seed = seededWindow();
        for (const [at, expected] of [[M.initialDeadlineAt - 1, 'INITIAL_OPEN'], [M.initialDeadlineAt, 'FINAL_OPEN'], [M.finalDeadlineAt, 'CLOSED']]) {
            freeze(at);
            const { eps } = build(seed);
            const r = await call(eps.getMyOvertimeState, req({}));
            unfreeze();
            assert.equal(r.body.windows[0].phase, expected);
        }
    });
});

describe('submitOvertimeAvailability — the only mutation', () => {
    const good = (over = {}) => ({
        weekEnding: WEEK, days: allDay(), ifRevision: 0, clientMutationId: 'mutation-0001', ...over,
    });

    test('a first submission writes the head AND revision 000001, together', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.revision, 1);
        const head = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`);
        const rev  = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller/revisions/000001`);
        assert.ok(head && rev, 'a head without its revision would make the audit trail a fiction');
        assert.equal(head.currentRevision, rev.revision);
        assert.equal(rev.weekEnding, WEEK, 'the revision carries its own context from day one');
        assert.equal(rev.memberName, 'G. Miller');
        assert.equal(rev.mutationId, 'mutation-0001');
    });

    test('a genuine amendment appends a revision and leaves the old one untouched', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: noDays(), ifRevision: 1, clientMutationId: 'mutation-0002' })));
        unfreeze();
        assert.equal(r.body.revision, 2);
        const first = db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller/revisions/000001`);
        assert.equal(first.days[DATES[0]].mode, 'all_day', 'history is immutable');
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`).currentRevision, 2);
    });

    test('an identical retry with a STALE baseline succeeds, creates nothing, and records its mutation id', async () => {
        // The timeout path, end to end. The first attempt committed, its response was lost, and the
        // client retries with the baseline it last confirmed. The recorded mutation id is what lets
        // that client then prove to itself that the submission is saved.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        const r = await call(eps.submitOvertimeAvailability, req(good({ ifRevision: 0, clientMutationId: 'retry-000001' })));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.noop, true);
        assert.equal(r.body.revision, 1);
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/G. Miller/revisions/000002`), false);
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/submissions/G. Miller`).lastMutationId, 'retry-000001');
    });

    test('a stale baseline with DIFFERENT content is a 409 carrying what is actually stored', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: noDays(), ifRevision: 0, clientMutationId: 'mutation-0003' })));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'revision-conflict');
        assert.equal(r.body.currentRevision, 1);
        assert.ok(r.body.days, 'the client needs the authoritative content to show, not just a refusal');
    });

    test('the 409 names the mutation that won, so "somebody else" can be told from "you, earlier"', async () => {
        // The interaction two features apart: a member times out, EDITS, and retries. The content
        // now differs and the baseline is stale, so it is a genuine conflict — with their own
        // earlier successful submission. Telling them "changed on another device" would be false.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good({ clientMutationId: 'timed-out-one' })));
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: noDays(), ifRevision: 0, clientMutationId: 'the-retry-xx' })));
        unfreeze();
        assert.equal(r.body.lastMutationId, 'timed-out-one');
    });

    test('after the final deadline nothing is accepted', async () => {
        freeze(M.finalDeadlineAt);
        const { db, eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 409);
        assert.equal(r.body.error, 'closed');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/G. Miller`), false);
    });

    test('a first submission is still accepted in the FINAL_OPEN phase', async () => {
        freeze(M.initialDeadlineAt + 1);
        const { eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 200);
        assert.equal(r.body.phase, 'FINAL_OPEN');
    });

    test('a non-participant cannot submit, even as Master Admin', async () => {
        // Oversight is not permission to file somebody else's declaration. The only name in play is
        // the token's, so there is no body field to try this with — the identity IS the check.
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const r = await call(eps.submitOvertimeAvailability, req(good(), 'tok_plain'));
        unfreeze();
        assert.equal(r.code, 403);
        assert.equal(r.body.error, 'not-a-participant');
        assert.equal(db._store.has(`overtimeWindows/${WEEK}/submissions/S. Silva`), false);
    });

    test('a malformed week is refused with the reason and the offending date', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        const partial = allDay(); delete partial[DATES[4]];
        const r = await call(eps.submitOvertimeAvailability, req(good({ days: partial })));
        unfreeze();
        assert.equal(r.code, 400);
        assert.equal(r.body.error, 'wrong-day-count');
        assert.equal(db._store.size, 2, 'nothing written');
    });

    test('a missing or malformed mutation id is refused — reconciliation depends on it', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build(seededWindow());
        for (const id of ['', 'short', 'x'.repeat(65), 'has spaces!!']) {
            const r = await call(eps.submitOvertimeAvailability, req(good({ clientMutationId: id })));
            assert.equal(r.body.error, 'invalid-mutation-id', `"${id}"`);
        }
        unfreeze();
    });

    test('a submission to a window that does not exist is 404, not a created one', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { eps } = build();
        const r = await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(r.code, 404);
    });

    test('the participant uid is stamped on first contact, as the rename recovery route', async () => {
        freeze(Date.parse('2026-08-17T09:00:00Z'));
        const { db, eps } = build(seededWindow());
        await call(eps.submitOvertimeAvailability, req(good()));
        unfreeze();
        assert.equal(db._store.get(`overtimeWindows/${WEEK}/participants/G. Miller`).uid, 'uid_g');
    });
});
